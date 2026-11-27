// ==UserScript==
// @name         SmartTable — Ponte Celular CRM / Systêxtil
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      0.2.0
// @description  Leva, por clique explícito no CRM, o DDD e o celular do responsável para os campos da tela Cadastro de Clientes (pedi_f010) do Systêxtil. SÓ PREENCHE: quem salva (F9) é o operador.
// @match        https://texhub.texcotton.com.br/crm/*
// @match        *://*/systextil/*
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/systextil-celular-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/systextil-celular-bridge.user.js
// @run-at       document-idle
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==

/* =========================================================================
 * Um userscript, dois lados (mesmo padrão de whatsapp-crm-bridge.user.js):
 *
 *  CRM (texhub.texcotton.com.br): recebe o evento do Módulo 46 (`smarttable:systextil:atualizar-celular`, detail em
 *  texto JSON), valida e entrega o pedido ao armazenamento compartilhado do Tampermonkey; devolve ao Módulo 46 o
 *  andamento (`smarttable:systextil:celular-resultado`).
 *
 *  Systêxtil (tela Cadastro de Clientes, pedi_f010): preenche o CNPJ (3 campos), tecla F7 para pesquisar, CONFERE que o
 *  cliente carregado tem o CNPJ do pedido e só então preenche o DDD do celular ("00" + DDD) e o campo Celular. Nunca tecla F9, nunca clica em botão
 *  (nem em "Consultar cnpj"). Nunca mexe numa tela que já tem OUTRO cliente carregado.
 *
 *  Privacidade: o número só existe no pedido (valor do Tampermonkey, apagado ao terminar ou expirar, validade de 5
 *  minutos) e no campo da tela. Nada vai para log, console nem para o resultado devolvido ao CRM.
 *
 *  Os nomes dos campos (`cgc_r.`, `cgc_o.`, `cgc_2.`, `nome_cliente.`, `celular_cliente.`) vêm de diagnóstico censurado
 *  do usuário na tela pedi_f010 (25/11 e 27/11/2026). No teste real de 27/11/2026 o Systêxtil consultou o cliente com o F7
 *  simulado; o que falhava era o sinal de "cliente carregado" (ver `clienteCarregado`). Se o F7 não valer, a ponte avisa e
 *  espera o operador apertar F7. O agente não alcança o Systêxtil.
 * ========================================================================= */
(function () {
  'use strict';

  const NS = 'smarttable.systextil.celular.v1';
  const KEY_PEDIDO = NS + '.pedido';
  const KEY_RESULTADO = NS + '.resultado';
  const KEY_RESERVA = NS + '.reserva';
  const EVENTO_ENVIAR = 'smarttable:systextil:atualizar-celular';
  const EVENTO_RESULTADO = 'smarttable:systextil:celular-resultado';
  const HOST_CRM = 'texhub.texcotton.com.br';
  const SCHEMA = 2; // 2 = o pedido leva o DDD (ponte 0.2.0); o schema 1 (ponte antiga do CRM) é recusado
  const TTL_MAX_MS = 5 * 60 * 1000;
  const TOLERANCIA_RELOGIO_MS = 60 * 1000;
  const FINAIS = new Set(['preenchido', 'ja-igual', 'tela-ocupada', 'cnpj-diferente', 'cliente-nao-carregou', 'campo-ausente', 'valor-nao-ficou', 'expirado', 'pedido-invalido']);
  const TEMPOS = Object.assign({
    aguardando: 3000, // sem ninguém no Systêxtil: o CRM mostra "aguardando a tela"
    sonda: 1500, // enquanto há pedido pendente, vê se a tela já está aberta
    f7Automatico: 6000, // espera o F7 simulado carregar o cliente antes de pedir o F7 ao operador
    carregamento: 250,
    estabilizar: 400, // o cliente carregado precisa ficar igual duas leituras seguidas
    confirmarReserva: 80,
    renovarReserva: 10000,
    reservaMorta: 30000,
  }, (typeof window !== 'undefined' && window.ST_TEST_MODE && window.ST_TEST_TIMING) || {});

  const pagina = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const ID_ABA = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12);
  const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
  // Log CENSURADO, para saber onde um pedido parou: só palavras de estado e sim/não. Nunca CNPJ, número, nome nem valor de campo.
  const registrar = (texto) => { try { console.info('[SmartTable ponte celular] ' + texto); } catch (_) { /* sem console */ } };

  /* ---------------------------------------------------------------------
   * PEDIDO (validação rígida: nada de pedido pela metade)
   * --------------------------------------------------------------------- */
  function validarPedido(pedido, agora) {
    if (!pedido || typeof pedido !== 'object') return { ok: false, motivo: 'formato' };
    if (pedido.schema !== SCHEMA) return { ok: false, motivo: 'schema' };
    if (typeof pedido.id !== 'string' || !/^[A-Za-z0-9._-]{8,80}$/.test(pedido.id)) return { ok: false, motivo: 'id' };
    if (typeof pedido.cnpj !== 'string' || !/^[0-9A-Z]{12}[0-9]{2}$/.test(pedido.cnpj)) return { ok: false, motivo: 'cnpj' };
    if (typeof pedido.ddd !== 'string' || !/^[1-9][1-9]$/.test(pedido.ddd)) return { ok: false, motivo: 'ddd' };
    if (typeof pedido.celular !== 'string' || !/^9[0-9]{8}$/.test(pedido.celular)) return { ok: false, motivo: 'celular' };
    if (!Number.isFinite(pedido.criadoEm) || !Number.isFinite(pedido.expiraEm)) return { ok: false, motivo: 'datas' };
    if (pedido.expiraEm - pedido.criadoEm > TTL_MAX_MS + 1000 || pedido.expiraEm <= pedido.criadoEm) return { ok: false, motivo: 'validade' };
    if (pedido.criadoEm > agora + TOLERANCIA_RELOGIO_MS) return { ok: false, motivo: 'relogio' };
    if (pedido.expiraEm <= agora) return { ok: false, motivo: 'expirado' };
    return { ok: true };
  }

  const idValido = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(id);

  function publicar(id, status, ok) {
    if (!idValido(id)) return;
    registrar('systextil: status=' + status);
    GM_setValue(KEY_RESULTADO, { schema: SCHEMA, id, status, ok: ok === true, em: Date.now() });
  }

  function apagarPedido(id) {
    const atual = GM_getValue(KEY_PEDIDO, null);
    if (!atual || atual.id === id) GM_deleteValue(KEY_PEDIDO);
  }

  /** Pedido vencido guardado de uma sessão anterior: apaga (o número não fica no disco do Tampermonkey). */
  function limparPedidoVencido() {
    const guardado = GM_getValue(KEY_PEDIDO, null);
    if (guardado && !(Number.isFinite(guardado.expiraEm) && guardado.expiraEm > Date.now())) GM_deleteValue(KEY_PEDIDO);
  }

  /* ---------------------------------------------------------------------
   * LADO DO CRM
   * --------------------------------------------------------------------- */
  function iniciarLadoCrm() {
    let atual = null; // { id, recebeuResposta, final, timers }

    const encaminhar = (id, status, ok) => {
      registrar('crm: resultado=' + status);
      const evento = new pagina.CustomEvent(EVENTO_RESULTADO, { detail: JSON.stringify({ schema: SCHEMA, id, status, ok: ok === true }) });
      pagina.document.dispatchEvent(evento);
    };
    const encerrar = () => {
      if (!atual) return;
      atual.final = true;
      atual.timers.forEach((t) => clearTimeout(t));
    };

    document.addEventListener(EVENTO_ENVIAR, (evento) => {
      let pedido = null;
      try { pedido = typeof evento.detail === 'string' ? JSON.parse(evento.detail) : null; } catch (_) { registrar('crm: evento ignorado (detail não é JSON)'); return; }
      registrar('crm: evento do SmartTable recebido');
      const validade = validarPedido(pedido, Date.now());
      if (!validade.ok) {
        registrar('crm: pedido recusado (motivo=' + validade.motivo + ')');
        if (idValido(pedido && pedido.id)) encaminhar(pedido.id, validade.motivo === 'expirado' ? 'expirado' : 'pedido-invalido', false);
        return;
      }
      if (atual && !atual.final) { encerrar(); apagarPedido(atual.id); } // um pedido por vez: o novo substitui o que ficou parado
      GM_deleteValue(KEY_RESULTADO);
      GM_setValue(KEY_PEDIDO, pedido);
      const meu = { id: pedido.id, recebeuResposta: false, final: false, timers: [] };
      atual = meu;
      encaminhar(pedido.id, 'recebido', false);
      meu.timers.push(setTimeout(() => {
        if (atual === meu && !meu.final && !meu.recebeuResposta) encaminhar(meu.id, 'aguardando-systextil', false);
      }, TEMPOS.aguardando));
      meu.timers.push(setTimeout(() => {
        if (atual !== meu || meu.final) return;
        encerrar();
        apagarPedido(meu.id);
        encaminhar(meu.id, 'expirado', false);
      }, Math.max(0, pedido.expiraEm - Date.now())));
    });

    GM_addValueChangeListener(KEY_RESULTADO, (_chave, _antigo, novo) => {
      if (!atual || !novo || novo.schema !== SCHEMA || novo.id !== atual.id || typeof novo.status !== 'string') return;
      atual.recebeuResposta = true;
      encaminhar(novo.id, novo.status, novo.ok === true);
      if (FINAIS.has(novo.status)) {
        encerrar();
        apagarPedido(novo.id);
      }
    });
  }

  /* ---------------------------------------------------------------------
   * LADO DO SYSTÊXTIL (tela Cadastro de Clientes)
   * --------------------------------------------------------------------- */
  function campo(nome) {
    return document.querySelector('input[name="' + nome + '"]');
  }

  /** Os cinco campos da tela, ou null se esta aba não está na tela Cadastro de Clientes. */
  function lerTela() {
    const tela = {
      raiz: campo('cgc_r.'),
      ordem: campo('cgc_o.'),
      digitos: campo('cgc_2.'),
      nome: campo('nome_cliente.'),
      celular: campo('celular_cliente.'),
      dddCelular: campo('ddd_cidade_celular.'),
    };
    return Object.values(tela).every(Boolean) ? tela : null;
  }

  const NOMES_CAMPOS = [['cgc_r', 'cgc_r.'], ['cgc_o', 'cgc_o.'], ['cgc_2', 'cgc_2.'], ['nome', 'nome_cliente.'], ['celular', 'celular_cliente.'], ['dddCelular', 'ddd_cidade_celular.']];
  const simNao = (sim) => (sim ? 'sim' : 'não');

  /** Quais dos cinco campos existem nesta aba (sim/não), para o log: mostra o que falta se a tela não for reconhecida. */
  function descreverCampos() {
    return NOMES_CAMPOS.map(([rotulo, nome]) => rotulo + '=' + simNao(campo(nome))).join(', ');
  }

  const cnpjDaTela = (tela) => (tela.raiz.value + tela.ordem.value + tela.digitos.value).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  // Cliente carregado = a razão social apareceu. O `codigo_cliente.` NÃO serve: fica vazio mesmo com o cliente na tela
  // (diagnóstico censurado do usuário, 27/11/2026); na tela sem cliente só `superCountLabel.`, `dynamictext1.` e `mascara.` têm valor.
  const clienteCarregado = (tela) => tela.nome.value.trim() !== '';

  /** Linha CENSURADA (só sim/não e contagens) para quando o F7 parece não ter carregado o cliente: diz se a tela trocou os
   * campos por novos (os lidos antes do F7 saíram da página) ou se há mais de um campo com o mesmo nome. */
  function diagnosticoPosF7(original, pedido) {
    const nova = lerTela();
    const originaisNaPagina = Object.values(original).every((el) => el.isConnected);
    const mesmoElemento = Boolean(nova) && Object.keys(original).every((chave) => nova[chave] === original[chave]);
    const clienteNaTela = Boolean(nova) && clienteCarregado(nova);
    const cnpjConfere = Boolean(nova) && cnpjDaTela(nova) === pedido.cnpj;
    const contagens = NOMES_CAMPOS.map(([rotulo, nome]) => rotulo + '=' + document.querySelectorAll('input[name="' + nome + '"]').length).join(', ');
    return 'systextil: diagnóstico pós-F7 (campos-originais-na-página=' + simNao(originaisNaPagina) + ', mesmo-elemento=' + simNao(mesmoElemento)
      + ', cliente-carregado(nova leitura)=' + simNao(clienteNaTela) + ', cnpj-confere(nova leitura)=' + simNao(cnpjConfere)
      + ', inputs-por-nome ' + contagens + ')';
  }

  /** A tela relida AGORA, só se já tem cliente carregado. O Systêxtil pode trocar os campos por novos ao pesquisar (F7). */
  function telaComCliente() {
    const tela = lerTela();
    return tela && clienteCarregado(tela) ? tela : null;
  }

  /** Escreve como o usuário escreveria (setter nativo + input/change) e confere que o valor ficou. */
  function definirValor(input, valor) {
    if (!input || input.readOnly || input.disabled) return false;
    const prototipo = Object.getPrototypeOf(input);
    const descritor = Object.getOwnPropertyDescriptor(prototipo, 'value') || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    input.focus();
    descritor.set.call(input, valor);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    return input.value === valor;
  }

  /** F7 (pesquisar). Só F7: nenhuma outra tecla de função é enviada por esta ponte. */
  function teclarF7(alvo) {
    ['keydown', 'keyup'].forEach((tipo) => {
      const evento = new window.KeyboardEvent(tipo, { key: 'F7', code: 'F7', keyCode: 118, which: 118, bubbles: true, cancelable: true });
      if (evento.keyCode !== 118) {
        Object.defineProperty(evento, 'keyCode', { get: () => 118 });
        Object.defineProperty(evento, 'which', { get: () => 118 });
      }
      alvo.dispatchEvent(evento);
    });
  }

  async function reservar(id) {
    const antes = GM_getValue(KEY_RESERVA, null);
    if (antes && antes.id === id && antes.aba !== ID_ABA && Date.now() - antes.em < TEMPOS.reservaMorta) return false;
    GM_setValue(KEY_RESERVA, { id, aba: ID_ABA, em: Date.now() });
    await esperar(TEMPOS.confirmarReserva);
    const depois = GM_getValue(KEY_RESERVA, null);
    return Boolean(depois && depois.id === id && depois.aba === ID_ABA);
  }

  async function executar(pedido, tela) {
    const vivo = () => Date.now() < pedido.expiraEm;
    // Cada clique no CRM cria um pedido NOVO e troca o guardado. Se este deixou de ser o vigente, o CRM já seguiu para outro:
    // continuar esperando o F7 do antigo travaria o novo por até 5 minutos.
    const vigente = () => { const guardado = GM_getValue(KEY_PEDIDO, null); return Boolean(guardado && guardado.id === pedido.id); };
    const abandonar = () => {
      registrar('systextil: o pedido deixou de ser o vigente (substituído ou cancelado); abandonado sem escrever nada');
      const reserva = GM_getValue(KEY_RESERVA, null);
      if (reserva && reserva.id === pedido.id && reserva.aba === ID_ABA) GM_deleteValue(KEY_RESERVA);
    };
    const finalizar = (status, ok) => {
      publicar(pedido.id, status, ok);
      apagarPedido(pedido.id);
      GM_deleteValue(KEY_RESERVA);
    };
    let ultimaRenovacao = Date.now();
    const manterReserva = () => {
      if (Date.now() - ultimaRenovacao > TEMPOS.renovarReserva) {
        ultimaRenovacao = Date.now();
        GM_setValue(KEY_RESERVA, { id: pedido.id, aba: ID_ABA, em: ultimaRenovacao });
      }
    };

    const jaCarregado = clienteCarregado(tela);
    if (jaCarregado && cnpjDaTela(tela) !== pedido.cnpj) { finalizar('tela-ocupada', false); return; } // não toca em cliente alheio

    if (!jaCarregado) {
      const preencheu = definirValor(tela.raiz, pedido.cnpj.slice(0, 8))
        && definirValor(tela.ordem, pedido.cnpj.slice(8, 12))
        && definirValor(tela.digitos, pedido.cnpj.slice(12, 14));
      if (!preencheu) { finalizar('campo-ausente', false); return; }
      publicar(pedido.id, 'cnpj-preenchido', false);
      teclarF7(tela.digitos);
      const limiteAutomatico = Date.now() + TEMPOS.f7Automatico;
      let avisouManual = false;
      // Relê a tela a cada volta: os campos lidos antes do F7 podem ter saído da página (e continuariam vazios para sempre).
      while (vivo() && vigente() && !telaComCliente()) {
        if (!avisouManual && Date.now() >= limiteAutomatico) {
          publicar(pedido.id, 'f7-manual', false);
          registrar(diagnosticoPosF7(tela, pedido));
          avisouManual = true;
        }
        manterReserva();
        await esperar(TEMPOS.carregamento);
      }
      if (!vigente()) { abandonar(); return; }
      if (!telaComCliente()) { registrar(diagnosticoPosF7(tela, pedido)); finalizar('expirado', false); return; }
    }

    // O cliente só vale depois de ficar IGUAL em duas leituras seguidas (a tela pode repintar os campos logo após o F7).
    const ler = () => { const t = telaComCliente(); return t ? cnpjDaTela(t) + '|' + t.nome.value : null; };
    const antes = ler();
    await esperar(TEMPOS.estabilizar);
    if (antes === null || ler() !== antes) await esperar(TEMPOS.estabilizar);
    if (!vigente()) { abandonar(); return; } // chegou outro pedido durante a leitura estável: nada é escrito para este
    const atual = telaComCliente(); // a leitura mais recente: confere e preenche nela, nunca nos campos de antes do F7
    if (!atual) { finalizar('cliente-nao-carregou', false); return; }
    if (cnpjDaTela(atual) !== pedido.cnpj) { finalizar('cnpj-diferente', false); return; }
    if (!vivo()) { finalizar('expirado', false); return; }
    publicar(pedido.id, 'cliente-conferido', false);

    // O DDD do celular no Systêxtil tem 4 dígitos: "00" + DDD (diagnóstico do usuário, 27/11/2026).
    const dddDaTela = '00' + pedido.ddd;
    const dddJaIgual = atual.dddCelular.value.trim() === dddDaTela;
    const celularJaIgual = atual.celular.value.replace(/\D/g, '') === pedido.celular;
    if (dddJaIgual && celularJaIgual) { finalizar('ja-igual', true); return; }
    // Os dois campos têm de aceitar escrita ANTES de eu mexer em qualquer um: sem DDD pela metade.
    if ([atual.dddCelular, atual.celular].some((el) => el.readOnly || el.disabled)) { finalizar('valor-nao-ficou', false); return; }
    if (!definirValor(atual.dddCelular, dddDaTela) || !definirValor(atual.celular, pedido.celular)) { finalizar('valor-nao-ficou', false); return; }
    finalizar('preenchido', true); // preenchido, NÃO gravado: o F9 é do operador
  }

  function iniciarLadoSystextil() {
    let processando = false;
    let ultimaDescricao = '';

    async function tentar() {
      if (processando) return;
      const pedido = GM_getValue(KEY_PEDIDO, null);
      if (!pedido) return;
      const validade = validarPedido(pedido, Date.now());
      if (!validade.ok) {
        if (validade.motivo === 'expirado' && idValido(pedido.id)) publicar(pedido.id, 'expirado', false);
        else if (idValido(pedido.id)) publicar(pedido.id, 'pedido-invalido', false);
        GM_deleteValue(KEY_PEDIDO);
        return;
      }
      const tela = lerTela();
      if (!tela) { // esta aba não está no Cadastro de Clientes: outra aba (ou a próxima tela) cuida
        const descricao = descreverCampos();
        if (descricao !== ultimaDescricao) { ultimaDescricao = descricao; registrar('systextil: há pedido pendente, mas a tela Cadastro de Clientes não foi reconhecida nesta aba (' + descricao + ')'); }
        return;
      }
      ultimaDescricao = '';
      processando = true;
      try {
        registrar('systextil: tela reconhecida, há pedido pendente');
        if (await reservar(pedido.id)) await executar(pedido, tela);
        else registrar('systextil: outra aba já reservou o pedido');
      } catch (_) {
        publicar(pedido.id, 'campo-ausente', false);
        apagarPedido(pedido.id);
      } finally {
        processando = false;
      }
    }

    GM_addValueChangeListener(KEY_PEDIDO, () => { tentar(); });
    // O operador pode abrir o Cadastro de Clientes DEPOIS do clique no CRM: enquanto houver pedido, olha de tempos em tempos.
    setInterval(tentar, TEMPOS.sonda);
    tentar();
  }

  /* ---------------------------------------------------------------------
   * PARTIDA
   * --------------------------------------------------------------------- */
  limparPedidoVencido();
  registrar('lado=' + (window.location.hostname === HOST_CRM ? 'crm' : 'systextil') + ', ponte 0.2.0 carregada');
  if (window.location.hostname === HOST_CRM) iniciarLadoCrm();
  else iniciarLadoSystextil();

  if (window.ST_TEST_MODE) {
    window.__smartTableSystextilCelularTest = { validarPedido, definirValor, lerTela, cnpjDaTela, FINAIS, TEMPOS };
  }
})();
