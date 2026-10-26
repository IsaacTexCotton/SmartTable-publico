/* =========================================================================
 * MÓDULO 37: CHECAGEM DE RETORNOS — CRM TexCotton
 * -------------------------------------------------------------------------
 * Fila baseada nos eventos "contato" do dia no Módulo 8. O estado é local e
 * independente. Só marca como verificado depois de observar o item novo na
 * aba Contatos ou de o operador confirmar manualmente uma operação incerta.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__checagemRetornosCarregada) return;
  window.__checagemRetornosCarregada = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Checagem de Retornos');

  const VERSAO_SCHEMA = 1;
  const PREFIXO_CHAVE_DIA = 'smarttable_checagem_retornos_v1_';
  const CHAVE_HISTORICO = 'smarttable_checagem_retornos_historico_v1';
  const ID_BOTAO = 'smarttable-checagem-retornos-abrir';
  const ID_PAINEL = 'smarttable-checagem-retornos-painel';
  const ID_ESTILOS = 'smarttable-checagem-retornos-estilos';
  const LIMITE_RESUMO_CRM = 250;
  const TEMPO_CONFIRMACAO_MS = 9000;
  const DIAS_RETENCAO_ESTADO = 120;
  const RESULTADOS = Object.freeze({
    RETORNOU: 'RETORNOU',
    SEM_RETORNO: 'SEM_RETORNO',
    NAO_VERIFICAVEL: 'NAO_VERIFICAVEL',
    PENDENTE: 'PENDENTE',
  });
  const ESTADOS = Object.freeze({
    PENDENTE: 'pendente',
    NAO_VERIFICAVEL: 'naoVerificavel',
    VERIFICADO_RETORNOU: 'verificadoRetornou',
    VERIFICADO_SEM_RETORNO: 'verificadoSemRetorno',
  });
  const IDS_RESULTADO_CRM = Object.freeze({
    RETORNOU: 'btn-resultado-REGISTRO',
    SEM_RETORNO: 'btn-resultado-CAIXA_POSTAL',
  });

  let painel = null;
  let resultadoSelecionado = '';
  let sequenciaOperacao = 0;
  let mensagemStatus = '';

  function normalizarCnpj(valor) {
    return String(valor == null ? '' : valor).replace(/\D/g, '');
  }
  function chaveDia(data) {
    const d = data || new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function formatarHora(minutos) {
    if (!Number.isInteger(minutos) || minutos < 0 || minutos > 1439) return '--:--';
    return String(Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0');
  }
  function horaAtual() {
    const agora = new Date();
    return String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');
  }
  function estadoDiaVazio(dia) {
    return { versao: VERSAO_SCHEMA, dia: dia, clientes: {}, clienteAtivo: '' };
  }
  function estadoClienteVazio(evento) {
    return { estado: ESTADOS.PENDENTE, eventoDia: evento.d, eventoHora: evento.h, nome: '', url: '', operacao: null };
  }

  // Função pura: o evento mais recente do cliente é a referência; empates
  // usam a posição original no diário, e a ordenação final é pelo horário.
  function construirFila(eventos, estadoDia, dia) {
    const maisRecentes = new Map();
    (Array.isArray(eventos) ? eventos : []).forEach(function (evento, indice) {
      if (!evento || evento.t !== 'contato' || evento.d !== dia) return;
      const cnpj = normalizarCnpj(evento.c);
      if (!/^\d{14}$/.test(cnpj)) return;
      if (!Number.isInteger(evento.h) || evento.h < 0 || evento.h > 1439) return;
      const anterior = maisRecentes.get(cnpj);
      // A ordem do array do Diário é a ordem de gravação; não substituí-la
      // pela maior hora protege contra relógio alterado dentro do mesmo dia.
      maisRecentes.set(cnpj, { cnpj: cnpj, h: evento.h, d: evento.d, ordem: anterior ? anterior.ordem : indice });
    });
    const clientes = estadoDia && estadoDia.clientes && typeof estadoDia.clientes === 'object'
      ? estadoDia.clientes : {};
    return Array.from(maisRecentes.values()).map(function (evento) {
      const local = clientes[evento.cnpj] || {};
      return {
        cnpj: evento.cnpj, dia: evento.d, hora: evento.h,
        nome: typeof local.nome === 'string' ? local.nome : '',
        url: typeof local.url === 'string' ? local.url : '',
        estado: local.estado || ESTADOS.PENDENTE,
        operacao: local.operacao || null,
        ordem: evento.ordem,
      };
    }).filter(function (cliente) {
      return cliente.estado !== ESTADOS.VERIFICADO_RETORNOU &&
        cliente.estado !== ESTADOS.VERIFICADO_SEM_RETORNO;
    }).sort(function (a, b) {
      return a.hora - b.hora || a.ordem - b.ordem;
    });
  }

  // Função pura: Não foi possível verificar é distinto de Sem retorno.
  function transicionarEstado(estadoAtual, resultado) {
    if (resultado === RESULTADOS.NAO_VERIFICAVEL) return ESTADOS.NAO_VERIFICAVEL;
    if (resultado === RESULTADOS.RETORNOU) return ESTADOS.VERIFICADO_RETORNOU;
    if (resultado === RESULTADOS.SEM_RETORNO) return ESTADOS.VERIFICADO_SEM_RETORNO;
    if (resultado === RESULTADOS.PENDENTE) return ESTADOS.PENDENTE;
    return estadoAtual || ESTADOS.PENDENTE;
  }
  function montarObservacao(resultado, hora, observacaoOpcional) {
    let marca;
    if (resultado === RESULTADOS.RETORNOU) {
      marca = 'Checagem de retorno (WhatsApp) — cliente retornou às ' + hora + '.';
    } else if (resultado === RESULTADOS.SEM_RETORNO) {
      marca = 'Checagem de retorno (WhatsApp) — sem resposta às ' + hora + '.';
    } else {
      return '';
    }
    const extra = String(observacaoOpcional || '').trim();
    return marca + (extra ? ' ' + extra : '');
  }
  function validarObservacao(texto, limite) {
    const valor = String(texto == null ? '' : texto);
    const maximo = Number.isInteger(limite) && limite > 0 ? limite : LIMITE_RESUMO_CRM;
    return { ok: valor.length <= maximo, tamanho: valor.length, limite: maximo };
  }

  function lerEstadoDia(dia) {
    try {
      const bruto = window.localStorage.getItem(PREFIXO_CHAVE_DIA + dia);
      if (!bruto) return estadoDiaVazio(dia);
      const salvo = JSON.parse(bruto);
      if (!salvo || salvo.versao !== VERSAO_SCHEMA || salvo.dia !== dia ||
          !salvo.clientes || typeof salvo.clientes !== 'object' || Array.isArray(salvo.clientes)) {
        return estadoDiaVazio(dia);
      }
      if (typeof salvo.clienteAtivo !== 'string') salvo.clienteAtivo = '';
      return salvo;
    } catch (erro) {
      return estadoDiaVazio(dia);
    }
  }
  function lerHistorico() {
    try {
      const bruto = window.localStorage.getItem(CHAVE_HISTORICO);
      if (!bruto) return {};
      const salvo = JSON.parse(bruto);
      return salvo && typeof salvo === 'object' && !Array.isArray(salvo) ? salvo : {};
    } catch (erro) {
      return {};
    }
  }
  function persistirPar(estadoDia, historico) {
    const chave = PREFIXO_CHAVE_DIA + estadoDia.dia;
    let anteriorDia;
    let anteriorHistorico;
    try {
      anteriorDia = window.localStorage.getItem(chave);
      anteriorHistorico = window.localStorage.getItem(CHAVE_HISTORICO);
      window.localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(historico));
      window.localStorage.setItem(chave, JSON.stringify(estadoDia));
      return true;
    } catch (erro) {
      try {
        if (anteriorHistorico == null) window.localStorage.removeItem(CHAVE_HISTORICO);
        else window.localStorage.setItem(CHAVE_HISTORICO, anteriorHistorico);
        if (anteriorDia == null) window.localStorage.removeItem(chave);
        else window.localStorage.setItem(chave, anteriorDia);
      } catch (erroRollback) {
        // O armazenamento pode estar bloqueado; a tela continua sem declarar sucesso.
      }
      return false;
    }
  }
  function persistirEstado(estadoDia) {
    try {
      window.localStorage.setItem(PREFIXO_CHAVE_DIA + estadoDia.dia, JSON.stringify(estadoDia));
      return true;
    } catch (erro) {
      return false;
    }
  }
  function limparChavesAntigas() {
    const limite = chaveDia(new Date(Date.now() - DIAS_RETENCAO_ESTADO * 86400000));
    try {
      const remover = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const chave = window.localStorage.key(i);
        if (!chave || !chave.startsWith(PREFIXO_CHAVE_DIA)) continue;
        const dia = Number(chave.slice(PREFIXO_CHAVE_DIA.length));
        if (!Number.isInteger(dia) || dia < limite) remover.push(chave);
      }
      remover.forEach(function (chave) {
        try { window.localStorage.removeItem(chave); } catch (erro) { /* tenta novamente na próxima carga */ }
      });
    } catch (erro) {
      // Storage bloqueado não impede que a tela abra.
    }
  }

  function lerCnpjAtual() {
    try { return normalizarCnpj(new URL(window.location.href).searchParams.get('cnpj')); }
    catch (erro) { return ''; }
  }
  function resolverCliente(cnpj) {
    const alvo = normalizarCnpj(cnpj);
    if (lerCnpjAtual() === alvo) {
      const titulos = Array.from(document.querySelectorAll('h1, h2, [data-nome-cliente]'));
      const titulo = titulos.find(function (el) {
        const texto = (el.getAttribute('data-nome-cliente') || el.textContent || '').trim();
        return texto && !/^(clientes|cliente|smarttable)$/i.test(texto);
      });
      return {
        cnpj: alvo,
        nome: titulo ? (titulo.getAttribute('data-nome-cliente') || titulo.textContent || '').trim().slice(0, 120) : '',
        url: window.location.href,
      };
    }
    for (const linha of document.querySelectorAll('table tbody tr')) {
      const texto = linha.textContent || '';
      const match = texto.match(/Controle:\s*(\d+)\|([\d.\/-]+)/);
      if (!match || normalizarCnpj(match[2]) !== alvo) continue;
      const url = window.__smartTableUtil?.montarUrlCliente?.(match[1], match[2]);
      if (url) return { cnpj: alvo, nome: texto.split('Controle:')[0].trim().slice(0, 120), url: url };
    }
    return null;
  }

  function sincronizarEstadoComDiario() {
    const dia = chaveDia();
    const estadoDia = lerEstadoDia(dia);
    const historico = lerHistorico();
    let mudou = false;
    const eventos = window.__diario && typeof window.__diario.eventos === 'function'
      ? window.__diario.eventos({ tipo: 'contato' }) : [];
    const filaInicial = construirFila(eventos, estadoDia, dia);
    filaInicial.forEach(function (item) {
      let local = estadoDia.clientes[item.cnpj];
      if (!local) {
        local = estadoClienteVazio({ d: item.dia, h: item.hora });
        estadoDia.clientes[item.cnpj] = local;
        mudou = true;
      }
      if (local.eventoDia !== item.dia || local.eventoHora !== item.hora) {
        local.eventoDia = item.dia;
        local.eventoHora = item.hora;
        mudou = true;
      }
      const resolvido = resolverCliente(item.cnpj);
      if (resolvido) {
        if (resolvido.nome && local.nome !== resolvido.nome) { local.nome = resolvido.nome; mudou = true; }
        if (resolvido.url && local.url !== resolvido.url) { local.url = resolvido.url; mudou = true; }
      }
    });
    if (mudou) persistirPar(estadoDia, historico);
    return { dia: dia, estadoDia: estadoDia, historico: historico, eventos: eventos };
  }

  function avisar(mensagem, duracao) {
    try {
      if (typeof window.__smartTableUtil?.toast === 'function') {
        window.__smartTableUtil.toast(mensagem, duracao || 4000);
        return;
      }
    } catch (erro) { /* fallback abaixo */ }
    mensagemStatus = mensagem;
    if (painel) renderizarPainel();
  }
  function elemento(tag, texto, classe) {
    const el = document.createElement(tag);
    if (texto !== undefined && texto !== null) el.textContent = String(texto);
    if (classe) el.className = classe;
    return el;
  }
  function criarBotao(texto, acao, classe, desabilitado) {
    const botao = elemento('button', texto, classe || 'smt-cr-btn');
    botao.type = 'button';
    botao.disabled = !!desabilitado;
    botao.addEventListener('click', acao);
    return botao;
  }
  function instalarEstilos() {
    if (document.getElementById(ID_ESTILOS)) return;
    const style = document.createElement('style');
    style.id = ID_ESTILOS;
    style.textContent = [
      '#smarttable-checagem-retornos-abrir{position:fixed;right:16px;bottom:18px;z-index:999996;border:1px solid #344054;background:#16232f;color:#fff;border-radius:9px;padding:10px 14px;font:600 13px system-ui;box-shadow:0 3px 12px #0002;cursor:pointer}',
      '#smarttable-checagem-retornos-painel{position:fixed;right:16px;bottom:66px;width:min(660px,calc(100vw - 32px));max-height:82vh;overflow:auto;z-index:999997;background:#fff;color:#182230;border:1px solid #cfd5df;border-radius:12px;box-shadow:0 8px 34px #0003;padding:16px;font:14px/1.45 system-ui,-apple-system,sans-serif}',
      '#smarttable-checagem-retornos-painel *{box-sizing:border-box}',
      '.smt-cr-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid #eaecf0;padding-bottom:12px;margin-bottom:12px}',
      '.smt-cr-title{font-size:18px;font-weight:700;margin:0 0 4px}',
      '.smt-cr-muted{color:#667085;font-size:12px;margin:4px 0}',
      '.smt-cr-btn{border:1px solid #cfd5df;border-radius:7px;padding:7px 10px;background:#fff;color:#182230;cursor:pointer;font:600 12px system-ui}',
      '.smt-cr-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.smt-cr-primary{background:#16232f;color:#fff;border-color:#16232f}',
      '.smt-cr-list{display:flex;flex-direction:column;gap:8px;margin:10px 0 16px}',
      '.smt-cr-card{border:1px solid #e4e7ec;border-radius:9px;padding:10px;display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.smt-cr-client{font-weight:650;overflow-wrap:anywhere}',
      '.smt-cr-details{min-width:0}',
      '.smt-cr-status{font-size:12px;color:#475467;margin-top:3px}',
      '.smt-cr-section{font-size:14px;font-weight:700;margin:16px 0 8px}',
      '.smt-cr-form{border:1px solid #d0d5dd;border-radius:10px;padding:12px;margin:12px 0}',
      '.smt-cr-label{display:block;font-size:12px;font-weight:650;margin:10px 0 5px}',
      '.smt-cr-textarea{width:100%;min-height:64px;resize:vertical;border:1px solid #cfd5df;border-radius:7px;padding:9px;font:13px/1.4 system-ui}',
      '.smt-cr-results{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}',
      '.smt-cr-choice{display:flex;gap:6px;align-items:center;border:1px solid #d0d5dd;border-radius:7px;padding:8px;font-size:12px}',
      '.smt-cr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.smt-cr-warning{padding:9px;border:1px solid #e4a11b;border-radius:8px;background:#fffaeb;color:#7a2e0e;margin:10px 0;font-size:12px}',
      '.smt-cr-error{padding:9px;border:1px solid #fda29b;border-radius:8px;background:#fef3f2;color:#912018;margin:10px 0;font-size:12px}',
      '.smt-cr-empty{padding:12px;color:#667085;border:1px dashed #d0d5dd;border-radius:8px}',
      '@media(max-width:520px){.smt-cr-card{align-items:flex-start;flex-direction:column}.smt-cr-title{font-size:16px}}',
    ].join('\n');
    document.head.appendChild(style);
  }
  function instalarBotaoAbrir() {
    if (document.getElementById(ID_BOTAO) || !document.body) return;
    const botao = criarBotao('Checagem de Retornos', function () {
      if (painel && painel.isConnected) fecharPainel();
      else abrirPainel();
    }, '');
    botao.id = ID_BOTAO;
    document.body.appendChild(botao);
  }
  function fecharPainel() {
    document.removeEventListener('keydown', aoTeclar);
    if (painel) painel.remove();
    painel = null;
    resultadoSelecionado = '';
  }
  function abrirPainel() {
    instalarEstilos();
    window.__smartTableUtil?.fecharOutrosPaineis?.('checagemRetornos');
    fecharPainel();
    painel = elemento('section');
    painel.id = ID_PAINEL;
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-modal', 'true');
    painel.setAttribute('aria-labelledby', 'smt-cr-titulo');
    document.body.appendChild(painel);
    document.addEventListener('keydown', aoTeclar);
    renderizarPainel();
    painel.querySelector('[data-smt-cr-fechar]')?.focus();
  }
  function aoTeclar(evento) {
    if (evento.key === 'Escape' && painel && painel.isConnected) fecharPainel();
  }

  function statusLegivel(estado, operacao) {
    if (operacao && operacao.status === 'em_andamento') return 'Salvamento em andamento; aguardando confirmação do CRM';
    if (operacao && operacao.status === 'incerta') return 'Confirmação pendente — confira a aba Contatos';
    if (estado === ESTADOS.NAO_VERIFICAVEL) return 'Não foi possível verificar';
    if (estado === ESTADOS.VERIFICADO_RETORNOU) return 'Verificado hoje: Retornou';
    if (estado === ESTADOS.VERIFICADO_SEM_RETORNO) return 'Verificado hoje: Sem retorno na checagem';
    return 'Pendente';
  }
  function assinaturaContato(item) {
    const bruto = [item.dataset.data || '', item.dataset.resumo || '', item.dataset.usuario || '', item.textContent || ''].join('\u0000');
    let hash = 2166136261;
    for (let i = 0; i < bruto.length; i += 1) {
      hash ^= bruto.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  function contatosAtuais() {
    return Array.from(document.querySelectorAll('#content-contatos .contato-item'));
  }
  function textoContato(item) {
    return String(item.dataset.resumo || '') + '\n' + String(item.textContent || '');
  }
  function procurarNovoContato(operacao) {
    if (!operacao || !operacao.marca) return null;
    const contatos = contatosAtuais();
    const marcados = contatos.filter(function (item) { return textoContato(item).includes(operacao.marca); });
    const totalAntes = Number.isInteger(operacao.contagemContatosAntes) ? operacao.contagemContatosAntes : contatos.length;
    const marcadosAntes = Number.isInteger(operacao.quantidadeMarcaAntes) ? operacao.quantidadeMarcaAntes : 0;
    // Contagem + marca evita que duas checagens legítimas no mesmo minuto
    // sejam confundidas quando seus resumos e assinaturas forem idênticos.
    if (contatos.length > totalAntes && marcados.length > marcadosAntes) return marcados[marcados.length - 1] || null;
    return null;
  }
  function obterOperacao(cnpj, id) {
    const estadoDia = lerEstadoDia(chaveDia());
    const cliente = estadoDia.clientes[cnpj];
    return cliente && cliente.operacao && cliente.operacao.id === id ? cliente.operacao : null;
  }
  function atualizarHistorico(historico, cnpj, id, mudancas) {
    const lista = Array.isArray(historico[cnpj]) ? historico[cnpj] : [];
    const indice = lista.findIndex(function (item) { return item.id === id; });
    if (indice >= 0) Object.assign(lista[indice], mudancas);
    historico[cnpj] = lista;
  }
  function concluirOperacao(cnpj, id, confirmada, manual) {
    const dia = chaveDia();
    const estadoDia = lerEstadoDia(dia);
    const historico = lerHistorico();
    const cliente = estadoDia.clientes[cnpj];
    if (!cliente || !cliente.operacao || cliente.operacao.id !== id) return false;
    if (!confirmada) {
      cliente.operacao.status = 'incerta';
      cliente.operacao.motivo = 'Não apareceu um novo item correspondente na aba Contatos.';
      atualizarHistorico(historico, cnpj, id, { statusGravacao: 'incerta', atualizadoEm: new Date().toISOString() });
      if (!persistirPar(estadoDia, historico)) {
        avisar('Não consegui salvar o estado local. Confira o CRM antes de qualquer nova tentativa.');
        return false;
      }
      mensagemStatus = 'Não consegui confirmar a gravação. O cliente continua na fila; confira a aba Contatos antes de decidir.';
      renderizarPainel();
      return false;
    }
    cliente.estado = transicionarEstado(cliente.estado, cliente.operacao.resultado);
    cliente.operacao.status = manual ? 'confirmadaManualmente' : 'confirmada';
    cliente.operacao.confirmadoEm = new Date().toISOString();
    cliente.operacao.motivo = manual ? 'Confirmação informada pelo operador após conferir o CRM.' : '';
    atualizarHistorico(historico, cnpj, id, {
      statusGravacao: manual ? 'confirmadaManualmente' : 'confirmada',
      atualizadoEm: new Date().toISOString(),
    });
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'O CRM mostrou a gravação, mas falhou a persistência local. Não vou declarar sucesso local nem repetir a gravação; confira a aba Contatos.';
      renderizarPainel();
      return false;
    }
    mensagemStatus = manual
      ? 'O operador confirmou manualmente o registro na aba Contatos.'
      : 'Novo registro confirmado na aba Contatos.';
    avancarApos(cnpj);
    return true;
  }
  function observarOperacao(cnpj, id, iniciarPrazo) {
    const op = obterOperacao(cnpj, id);
    if (!op) return;
    if (procurarNovoContato(op)) {
      concluirOperacao(cnpj, id, true, false);
      return;
    }
    if (op.status === 'incerta') { renderizarPainel(); return; }
    const alvo = document.getElementById('content-contatos');
    if (!alvo) {
      if (iniciarPrazo) concluirOperacao(cnpj, id, false, false);
      return;
    }
    if (!iniciarPrazo) return;
    let encerrado = false;
    let observador = null;
    let temporizador = null;
    function finalizarEspera() {
      if (encerrado) return;
      encerrado = true;
      if (observador) observador.disconnect();
      if (temporizador) window.clearTimeout(temporizador);
    }
    function conferir() {
      if (encerrado) return;
      const operacao = obterOperacao(cnpj, id);
      if (!operacao) { finalizarEspera(); return; }
      if (procurarNovoContato(operacao)) {
        finalizarEspera();
        concluirOperacao(cnpj, id, true, false);
      }
    }
    observador = new MutationObserver(conferir);
    observador.observe(alvo, { childList: true, subtree: true, attributes: true, characterData: true });
    temporizador = window.setTimeout(function () {
      finalizarEspera();
      concluirOperacao(cnpj, id, false, false);
    }, TEMPO_CONFIRMACAO_MS);
    conferir();
  }

  function criarRegistroHistorico(historico, cnpj, registro) {
    if (!Array.isArray(historico[cnpj])) historico[cnpj] = [];
    historico[cnpj].push(registro);
  }
  function gerarIdOperacao(historico, cnpj, dataHora) {
    sequenciaOperacao += 1;
    const lista = Array.isArray(historico[cnpj]) ? historico[cnpj] : [];
    return String(Date.parse(dataHora)) + '-' + String(lista.length) + '-' + String(sequenciaOperacao);
  }
  function elementoVisivel(el) {
    if (!el || !el.isConnected) return false;
    let atual = el;
    while (atual && atual.nodeType === 1) {
      if (atual.hidden || atual.getAttribute('aria-hidden') === 'true') return false;
      if (atual.style && (atual.style.display === 'none' || atual.style.visibility === 'hidden')) return false;
      try {
        const estilo = window.getComputedStyle(atual);
        if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
      } catch (erro) { /* estilo indisponível: segue com a estrutura */ }
      atual = atual.parentElement;
    }
    return true;
  }
  function obterFormContato(cnpj) {
    if (lerCnpjAtual() !== cnpj) return { ok: false, mensagem: 'A página aberta não corresponde ao cliente selecionado.' };
    let form = document.getElementById('form-contato');
    if (!form || !elementoVisivel(form)) {
      const abrir = document.querySelector('[onclick^="openModalContato"]');
      if (abrir) abrir.click();
      form = document.getElementById('form-contato');
    }
    if (!form || !elementoVisivel(form)) {
      return { ok: false, mensagem: 'Abra o formulário nativo de contato do cliente antes de registrar a checagem.' };
    }
    const codigo = form.querySelector('[name="clienteCodigo"]');
    const resumo = document.getElementById('contato-resumo');
    const salvar = document.getElementById('btn-salvar-contato');
    const contatos = document.getElementById('content-contatos');
    if (!codigo || !String(codigo.value || '').trim() || !resumo || !salvar || !contatos) {
      return { ok: false, mensagem: 'O formulário não está completo ou a aba Contatos não pode ser monitorada. Nenhum registro foi enviado.' };
    }
    return { ok: true, form: form, codigo: String(codigo.value), resumo: resumo, salvar: salvar, contatos: contatos };
  }

  function falharAntesDoEnvio(cnpj, id, mensagem) {
    const dia = chaveDia();
    const estadoDia = lerEstadoDia(dia);
    const historico = lerHistorico();
    const cliente = estadoDia.clientes[cnpj];
    if (!cliente || !cliente.operacao || cliente.operacao.id !== id) return;
    cliente.estado = cliente.operacao.estadoAnterior || ESTADOS.PENDENTE;
    cliente.operacao.status = 'naoEnviada';
    cliente.operacao.motivo = mensagem;
    atualizarHistorico(historico, cnpj, id, {
      statusGravacao: 'naoEnviada',
      motivo: mensagem,
      atualizadoEm: new Date().toISOString(),
    });
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'O formulário não recebeu o salvamento e não consegui atualizar o estado local. Recarregue e confira o CRM antes de qualquer nova tentativa.';
      renderizarPainel();
      return;
    }
    mensagemStatus = mensagem;
    renderizarPainel();
  }

  function iniciarGravacao(cnpj, resultado, textoOpcional) {
    const prep = obterFormContato(cnpj);
    if (!prep.ok) { mensagemStatus = prep.mensagem; renderizarPainel(); return; }
    const botaoResultado = document.getElementById(IDS_RESULTADO_CRM[resultado]);
    if (!botaoResultado || !prep.form.contains(botaoResultado) ||
        !prep.form.contains(prep.resumo) || !prep.form.contains(prep.salvar)) {
      mensagemStatus = 'O botão de resultado, o resumo e Salvar Contato precisam pertencer ao mesmo formulário nativo. Nenhum registro foi enviado.';
      renderizarPainel();
      return;
    }
    if (resultado === RESULTADOS.RETORNOU && !/registro/i.test(botaoResultado.textContent || '')) {
      mensagemStatus = 'O botão Registro não corresponde ao resultado esperado. Nenhum registro foi enviado.';
      renderizarPainel();
      return;
    }
    if (resultado === RESULTADOS.SEM_RETORNO && !/sem\s*retorno/i.test(botaoResultado.textContent || '')) {
      mensagemStatus = 'O botão Sem Retorno não corresponde ao resultado esperado. Nenhum registro foi enviado.';
      renderizarPainel();
      return;
    }
    const hora = horaAtual();
    const marca = montarObservacao(resultado, hora, '');
    const resumo = montarObservacao(resultado, hora, textoOpcional);
    const validacao = validarObservacao(resumo, LIMITE_RESUMO_CRM);
    if (!validacao.ok) {
      mensagemStatus = 'A observação tem ' + validacao.tamanho + ' caracteres; o limite é ' + validacao.limite + '. Reduza o texto antes de registrar.';
      renderizarPainel();
      return;
    }

    const estadoDia = lerEstadoDia(chaveDia());
    const historico = lerHistorico();
    if (!estadoDia.clientes[cnpj]) {
      const entrada = construirFila(window.__diario?.eventos?.({ tipo: 'contato' }) || [], estadoDia, chaveDia())
        .find(function (item) { return item.cnpj === cnpj; });
      if (!entrada) {
        mensagemStatus = 'Este cliente não tem um evento de contato elegível no diário de hoje.';
        renderizarPainel();
        return;
      }
      estadoDia.clientes[cnpj] = estadoClienteVazio({ d: entrada.dia, h: entrada.hora });
    }
    const cliente = estadoDia.clientes[cnpj];
    if (cliente.operacao && (cliente.operacao.status === 'em_andamento' || cliente.operacao.status === 'incerta')) {
      mensagemStatus = 'Existe uma gravação anterior sem confirmação. Confira a aba Contatos antes de iniciar outra.';
      renderizarPainel();
      return;
    }

    const dataHora = new Date().toISOString();
    const id = gerarIdOperacao(historico, cnpj, dataHora);
    const contatosAntes = contatosAtuais();
    const assinaturasAntes = contatosAntes.map(assinaturaContato);
    const quantidadeMarcaAntes = contatosAntes.filter(function (item) { return textoContato(item).includes(marca); }).length;
    criarRegistroHistorico(historico, cnpj, {
      id: id, dataHora: dataHora, data: chaveDia(), hora: hora, resultado: resultado,
      canal: 'WhatsApp', observacao: String(textoOpcional || '').trim(),
      marca: marca, resumo: resumo, statusGravacao: 'em_andamento',
    });
    cliente.operacao = {
      id: id, resultado: resultado, marca: marca, resumo: resumo,
      assinaturasAntes: assinaturasAntes, contagemContatosAntes: contatosAntes.length,
      quantidadeMarcaAntes: quantidadeMarcaAntes, estadoAnterior: cliente.estado || ESTADOS.PENDENTE,
      status: 'em_andamento', iniciadaEm: dataHora,
    };
    estadoDia.clienteAtivo = cnpj;
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'Não consegui preparar o estado local com segurança. Nenhum registro foi enviado.';
      renderizarPainel();
      return;
    }

    resultadoSelecionado = '';
    mensagemStatus = 'Salvamento acionado pelo formulário nativo; aguardando confirmação na aba Contatos.';
    renderizarPainel();
    const botaoRegistrar = painel?.querySelector('[data-smt-cr-registrar]');
    if (botaoRegistrar) botaoRegistrar.disabled = true;
    try {
      botaoResultado.click();
      prep.resumo.value = resumo;
      prep.resumo.dispatchEvent(new window.Event('input', { bubbles: true }));
      prep.resumo.dispatchEvent(new window.Event('change', { bubbles: true }));
      if (lerCnpjAtual() !== cnpj || !prep.form.isConnected ||
          document.getElementById('btn-salvar-contato') !== prep.salvar ||
          String(prep.form.querySelector('[name="clienteCodigo"]')?.value || '') !== prep.codigo) {
        falharAntesDoEnvio(cnpj, id, 'O formulário do CRM mudou durante a preparação. Nenhum salvamento foi acionado.');
        return;
      }
      // O Módulo 34 também aguarda um ciclo antes de clicar: o CRM pode
      // atualizar o botão nativo após os eventos input/change.
      window.setTimeout(function () {
        const operacao = obterOperacao(cnpj, id);
        if (!operacao || operacao.status !== 'em_andamento') return;
        const codigoAtual = prep.form.querySelector('[name="clienteCodigo"]');
        if (lerCnpjAtual() !== cnpj || !prep.form.isConnected ||
            document.getElementById('form-contato') !== prep.form ||
            document.getElementById('btn-salvar-contato') !== prep.salvar ||
            !prep.form.contains(botaoResultado) || !prep.form.contains(prep.resumo) ||
            !prep.form.contains(prep.salvar) || !codigoAtual ||
            String(codigoAtual.value || '') !== prep.codigo || prep.salvar.disabled) {
          falharAntesDoEnvio(cnpj, id, 'O CRM não manteve o formulário correto ou não liberou Salvar Contato. Nenhum salvamento foi acionado.');
          return;
        }
        try {
          prep.salvar.click();
          observarOperacao(cnpj, id, true);
        } catch (erro) {
          // Depois de iniciar o clique, o resultado pode ser incerto: não repetir.
          concluirOperacao(cnpj, id, false, false);
        }
      }, 0);
    } catch (erro) {
      // Falha antes do botão Salvar: nenhum registro foi enviado.
      falharAntesDoEnvio(cnpj, id, 'Não consegui preparar o formulário nativo do CRM. Nenhum salvamento foi acionado.');
    }
  }

  function verificarManual(cnpj, id, gravado) {
    const estadoDia = lerEstadoDia(chaveDia());
    const historico = lerHistorico();
    const cliente = estadoDia.clientes[cnpj];
    if (!cliente || !cliente.operacao || cliente.operacao.id !== id || cliente.operacao.status !== 'incerta') return;
    if (gravado) { concluirOperacao(cnpj, id, true, true); return; }
    cliente.operacao.status = 'conferidaNaoGravada';
    cliente.operacao.motivo = 'Operador conferiu o CRM e informou que não há registro.';
    cliente.estado = cliente.operacao.estadoAnterior || ESTADOS.PENDENTE;
    atualizarHistorico(historico, cnpj, id, {
      statusGravacao: 'conferidaNaoGravadaPeloOperador', atualizadoEm: new Date().toISOString(),
    });
    cliente.operacao = null;
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'Não consegui salvar a confirmação local. Confira o CRM e recarregue antes de tentar novamente.';
      renderizarPainel();
      return;
    }
    mensagemStatus = 'Tentativa anterior encerrada por confirmação do operador. Agora é possível iniciar uma nova tentativa manual.';
    renderizarPainel();
  }

  function registrarSemVerificacao(cnpj, textoOpcional) {
    const estadoDia = lerEstadoDia(chaveDia());
    const historico = lerHistorico();
    const fila = construirFila(window.__diario?.eventos?.({ tipo: 'contato' }) || [], estadoDia, chaveDia());
    const item = fila.find(function (cliente) { return cliente.cnpj === cnpj; });
    if (!item) { mensagemStatus = 'Este cliente não está na fila elegível de hoje.'; renderizarPainel(); return; }
    const cliente = estadoDia.clientes[cnpj] || estadoClienteVazio({ d: item.dia, h: item.hora });
    if (cliente.operacao && (cliente.operacao.status === 'em_andamento' || cliente.operacao.status === 'incerta')) {
      mensagemStatus = 'Existe uma gravação anterior sem confirmação. Confira a aba Contatos antes de mudar o estado.';
      renderizarPainel();
      return;
    }
    const agora = new Date();
    criarRegistroHistorico(historico, cnpj, {
      id: gerarIdOperacao(historico, cnpj, agora.toISOString()), dataHora: agora.toISOString(),
      data: chaveDia(), hora: horaAtual(), resultado: RESULTADOS.NAO_VERIFICAVEL, canal: 'WhatsApp',
      observacao: String(textoOpcional || '').trim(), statusGravacao: 'naoAplicavel',
    });
    cliente.estado = ESTADOS.NAO_VERIFICAVEL;
    cliente.operacao = null;
    estadoDia.clientes[cnpj] = cliente;
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'Não consegui salvar a checagem local. Nenhum dado foi enviado ao CRM.';
      renderizarPainel();
      return;
    }
    mensagemStatus = 'Marcado como não verificável. Nada foi gravado no CRM; o cliente permanece na fila.';
    avancarApos(cnpj);
  }

  function deixarPendente(cnpj) {
    const estadoDia = lerEstadoDia(chaveDia());
    const cliente = estadoDia.clientes[cnpj];
    if (cliente && cliente.operacao && (cliente.operacao.status === 'em_andamento' || cliente.operacao.status === 'incerta')) {
      mensagemStatus = 'Há uma gravação sem confirmação. Confira a aba Contatos antes de deixar pendente.';
      renderizarPainel();
      return;
    }
    if (cliente) cliente.estado = ESTADOS.PENDENTE;
    estadoDia.clienteAtivo = cnpj;
    mensagemStatus = persistirEstado(estadoDia)
      ? 'Cliente mantido como pendente. Nenhum registro foi feito no CRM.'
      : 'Não consegui salvar o estado pendente neste navegador.';
    renderizarPainel();
  }
  function reabrirCliente(cnpj) {
    const estadoDia = lerEstadoDia(chaveDia());
    const historico = lerHistorico();
    const cliente = estadoDia.clientes[cnpj];
    if (!cliente) return;
    cliente.estado = ESTADOS.PENDENTE;
    cliente.operacao = null;
    estadoDia.clienteAtivo = cnpj;
    mensagemStatus = '';
    resultadoSelecionado = '';
    if (!persistirPar(estadoDia, historico)) {
      mensagemStatus = 'Não consegui reabrir o cliente no estado local.';
      renderizarPainel();
      return;
    }
    navegarParaCliente(cnpj);
  }
  function setAtivo(cnpj) {
    const estadoDia = lerEstadoDia(chaveDia());
    if (!estadoDia.clientes[cnpj]) {
      const fila = construirFila(window.__diario?.eventos?.({ tipo: 'contato' }) || [], estadoDia, chaveDia());
      const item = fila.find(function (cliente) { return cliente.cnpj === cnpj; });
      if (!item) return false;
      estadoDia.clientes[cnpj] = estadoClienteVazio({ d: item.dia, h: item.hora });
    }
    estadoDia.clienteAtivo = cnpj;
    if (!persistirEstado(estadoDia)) {
      avisar('Não consegui salvar a seleção do cliente. Confira o armazenamento local.');
      return false;
    }
    return true;
  }
  function navegarParaCliente(cnpj) {
    if (lerCnpjAtual() === cnpj) {
      if (painel) renderizarPainel();
      else abrirPainel();
      return;
    }
    const estadoDia = lerEstadoDia(chaveDia());
    const cliente = estadoDia.clientes[cnpj];
    const resolvido = resolverCliente(cnpj);
    const url = (resolvido && resolvido.url) || (cliente && cliente.url) || '';
    if (!url) {
      mensagemStatus = 'Não encontrei a URL deste cliente na lista atual. Volte à lista do CRM e abra a Checagem de Retornos.';
      if (painel) renderizarPainel(); else abrirPainel();
      return;
    }
    let destino;
    try { destino = new URL(url, window.location.href); } catch (erro) { destino = null; }
    if (!destino || destino.origin !== window.location.origin || !destino.pathname.startsWith('/crm/')) {
      mensagemStatus = 'A URL do cliente não passou na validação de navegação. Nada foi aberto.';
      renderizarPainel();
      return;
    }
    if (!setAtivo(cnpj)) return;
    window.location.href = destino.href;
  }

  function abrirWhatsApp(cnpj) {
    if (lerCnpjAtual() !== cnpj) {
      mensagemStatus = 'Abra primeiro a página do cliente correspondente.';
      renderizarPainel();
      return;
    }
    const fn = window.abrirWhatsAppCliente;
    if (typeof fn !== 'function') {
      mensagemStatus = 'O CRM não disponibilizou a função nativa de abertura do WhatsApp nesta página.';
      renderizarPainel();
      return;
    }
    let resumo = document.getElementById('contato-resumo');
    if (!resumo || !String(resumo.value || '').trim()) {
      const abrir = document.querySelector('[onclick^="openModalContato"]');
      if (abrir) abrir.click();
      resumo = document.getElementById('contato-resumo');
      if (!resumo || !String(resumo.value || '').trim()) {
        mensagemStatus = 'Abra o formulário de contato e prepare a mensagem no CRM antes de abrir o WhatsApp. A Checagem não envia mensagens.';
        renderizarPainel();
        return;
      }
    }
    const flagAnterior = window.__checagemRetornosAbrindoWhatsApp;
    window.__checagemRetornosAbrindoWhatsApp = true;
    try {
      fn();
      mensagemStatus = 'Comando de abertura acionado. Confirme a conversa no WhatsApp; esta ação não registra uma checagem.';
    } catch (erro) {
      mensagemStatus = 'O CRM não conseguiu abrir a conversa. O cliente continua na fila.';
    } finally {
      if (flagAnterior === undefined) delete window.__checagemRetornosAbrindoWhatsApp;
      else window.__checagemRetornosAbrindoWhatsApp = flagAnterior;
    }
    renderizarPainel();
  }

  function avancarApos(cnpjAtual) {
    const snapshot = sincronizarEstadoComDiario();
    const proximo = construirFila(snapshot.eventos, snapshot.estadoDia, snapshot.dia)
      .find(function (cliente) { return cliente.cnpj !== cnpjAtual; });
    if (proximo && (proximo.url || snapshot.estadoDia.clientes[proximo.cnpj]?.url)) {
      snapshot.estadoDia.clienteAtivo = proximo.cnpj;
      if (!persistirEstado(snapshot.estadoDia)) {
        mensagemStatus += ' Não consegui persistir o próximo cliente; a fila permanece disponível.';
        renderizarPainel();
        return;
      }
      navegarParaCliente(proximo.cnpj);
      return;
    }
    const estadoDia = lerEstadoDia(chaveDia());
    estadoDia.clienteAtivo = '';
    persistirEstado(estadoDia);
    renderizarPainel();
  }

  function criarCabecalho() {
    const cabecalho = elemento('div', undefined, 'smt-cr-header');
    const grupo = elemento('div');
    const titulo = elemento('h2', 'Checagem de Retornos', 'smt-cr-title');
    titulo.id = 'smt-cr-titulo';
    grupo.appendChild(titulo);
    grupo.appendChild(elemento('p', 'Contatos de hoje, do mais antigo ao mais recente. Abrir o WhatsApp não confirma resposta.', 'smt-cr-muted'));
    const fechar = criarBotao('Fechar', fecharPainel, 'smt-cr-btn');
    fechar.dataset.smtCrFechar = '1';
    cabecalho.append(grupo, fechar);
    return cabecalho;
  }
  function criarCartaoCliente(cliente, ativo) {
    const cartao = elemento('div', undefined, 'smt-cr-card');
    const detalhes = elemento('div', undefined, 'smt-cr-details');
    detalhes.appendChild(elemento('div', cliente.nome || cliente.cnpj, 'smt-cr-client'));
    detalhes.appendChild(elemento('div', 'CNPJ ' + cliente.cnpj, 'smt-cr-muted'));
    detalhes.appendChild(elemento('div', 'Contato de referência: ' + formatarHora(cliente.hora), 'smt-cr-status'));
    detalhes.appendChild(elemento('div', statusLegivel(cliente.estado, cliente.operacao), 'smt-cr-status'));
    const acoes = elemento('div', undefined, 'smt-cr-actions');
    if (lerCnpjAtual() === cliente.cnpj) {
      acoes.appendChild(criarBotao(ativo ? 'Selecionado' : 'Verificar', function () {
        mensagemStatus = '';
        setAtivo(cliente.cnpj);
        resultadoSelecionado = '';
        renderizarPainel();
      }, 'smt-cr-btn' + (ativo ? ' smt-cr-primary' : '')));
    } else {
      acoes.appendChild(criarBotao('Abrir cliente', function () {
        mensagemStatus = '';
        navegarParaCliente(cliente.cnpj);
      }, 'smt-cr-btn smt-cr-primary', !cliente.url));
    }
    cartao.append(detalhes, acoes);
    return cartao;
  }

  function criarFormularioChecagem(cliente) {
    const form = elemento('div', undefined, 'smt-cr-form');
    form.appendChild(elemento('div', (cliente.nome || 'Cliente') + ' — ' + cliente.cnpj, 'smt-cr-client'));
    form.appendChild(elemento('div', 'Horário do contato: ' + formatarHora(cliente.hora), 'smt-cr-muted'));

    if (cliente.operacao && cliente.operacao.status === 'em_andamento') {
      form.appendChild(elemento('div', 'Aguardando o CRM mostrar o novo registro na aba Contatos. Não clique novamente.', 'smt-cr-warning'));
      return form;
    }
    if (cliente.operacao && cliente.operacao.status === 'incerta') {
      form.appendChild(elemento('div', 'A gravação não foi confirmada automaticamente. Confira a aba Contatos antes de escolher uma ação. Nenhuma repetição automática será feita.', 'smt-cr-warning'));
      const acoes = elemento('div', undefined, 'smt-cr-actions');
      acoes.appendChild(criarBotao('Confirmei que está gravado', function () {
        verificarManual(cliente.cnpj, cliente.operacao.id, true);
      }, 'smt-cr-btn smt-cr-primary'));
      acoes.appendChild(criarBotao('Conferi: não foi gravado', function () {
        verificarManual(cliente.cnpj, cliente.operacao.id, false);
      }, 'smt-cr-btn'));
      form.appendChild(acoes);
      return form;
    }

    form.appendChild(criarBotao('Abrir conversa no WhatsApp', function () {
      abrirWhatsApp(cliente.cnpj);
    }, 'smt-cr-btn'));
    form.appendChild(elemento('label', 'Resultado da checagem', 'smt-cr-label'));
    const escolhas = elemento('div', undefined, 'smt-cr-results');
    [
      { valor: RESULTADOS.RETORNOU, texto: 'Retornou' },
      { valor: RESULTADOS.SEM_RETORNO, texto: 'Sem retorno na checagem' },
      { valor: RESULTADOS.NAO_VERIFICAVEL, texto: 'Não foi possível verificar' },
    ].forEach(function (opcao) {
      const label = elemento('label', undefined, 'smt-cr-choice');
      const radio = elemento('input');
      radio.type = 'radio';
      radio.name = 'smt-cr-resultado';
      radio.value = opcao.valor;
      radio.checked = resultadoSelecionado === opcao.valor;
      radio.setAttribute('aria-label', opcao.texto);
      radio.addEventListener('change', function () {
        resultadoSelecionado = opcao.valor;
        atualizarContador();
      });
      label.append(radio, document.createTextNode(opcao.texto));
      escolhas.appendChild(label);
    });
    form.appendChild(escolhas);

    const labelObservacao = elemento('label', 'Observação opcional (gravada no CRM somente para Retornou/Sem retorno)', 'smt-cr-label');
    labelObservacao.htmlFor = 'smt-cr-observacao';
    form.appendChild(labelObservacao);
    const textarea = elemento('textarea', undefined, 'smt-cr-textarea');
    textarea.id = 'smt-cr-observacao';
    textarea.setAttribute('aria-label', 'Observação opcional da checagem');
    textarea.placeholder = 'Texto adicional depois da marca da checagem';
    form.appendChild(textarea);

    const contador = elemento('div', '0/' + LIMITE_RESUMO_CRM + ' caracteres no texto completo', 'smt-cr-muted');
    form.appendChild(contador);
    function atualizarContador() {
      const texto = textarea.value.trim();
      const completo = resultadoSelecionado === RESULTADOS.NAO_VERIFICAVEL
        ? texto : (resultadoSelecionado ? montarObservacao(resultadoSelecionado, horaAtual(), texto) : texto);
      const somenteLocal = resultadoSelecionado === RESULTADOS.NAO_VERIFICAVEL;
      const limite = somenteLocal ? Number.MAX_SAFE_INTEGER : LIMITE_RESUMO_CRM;
      const validacao = validarObservacao(completo, limite);
      contador.textContent = somenteLocal
        ? validacao.tamanho + ' caracteres; esta observação ficará somente no histórico local'
        : validacao.tamanho + '/' + validacao.limite + ' caracteres no texto completo';
      contador.style.color = validacao.ok ? '#667085' : '#b42318';
      const botao = painel?.querySelector('[data-smt-cr-registrar]');
      if (botao) botao.disabled = !resultadoSelecionado || !validacao.ok;
    }
    textarea.addEventListener('input', atualizarContador);

    const acoes = elemento('div', undefined, 'smt-cr-actions');
    let acaoEnviada = false;
    const registrar = criarBotao('Registrar e avançar', function () {
      if (acaoEnviada) return;
      const valor = textarea.value.trim();
      if (!resultadoSelecionado) {
        mensagemStatus = 'Escolha um resultado antes de avançar.';
        renderizarPainel();
        return;
      }
      const validacao = resultadoSelecionado === RESULTADOS.NAO_VERIFICAVEL
        ? validarObservacao(valor, Number.MAX_SAFE_INTEGER)
        : validarObservacao(montarObservacao(resultadoSelecionado, horaAtual(), valor), LIMITE_RESUMO_CRM);
      if (!validacao.ok) {
        mensagemStatus = 'O texto completo excede 250 caracteres. Ajuste a observação; nenhum texto será cortado.';
        renderizarPainel();
        return;
      }
      acaoEnviada = true;
      if (resultadoSelecionado === RESULTADOS.NAO_VERIFICAVEL) registrarSemVerificacao(cliente.cnpj, valor);
      else iniciarGravacao(cliente.cnpj, resultadoSelecionado, valor);
    }, 'smt-cr-btn smt-cr-primary', true);
    registrar.dataset.smtCrRegistrar = '1';
    acoes.append(registrar, criarBotao('Deixar pendente', function () { deixarPendente(cliente.cnpj); }, 'smt-cr-btn'));
    form.appendChild(acoes);
    return form;
  }

  function renderizarPainel() {
    if (!painel || !painel.isConnected) return;
    const snapshot = sincronizarEstadoComDiario();
    const estadoDia = snapshot.estadoDia;
    const fila = construirFila(snapshot.eventos, estadoDia, snapshot.dia);
    const verificados = Object.keys(estadoDia.clientes).map(function (cnpj) {
      const cliente = estadoDia.clientes[cnpj];
      return {
        cnpj: cnpj, dia: cliente.eventoDia, hora: cliente.eventoHora,
        nome: cliente.nome || '', url: cliente.url || '', estado: cliente.estado,
        operacao: cliente.operacao || null,
      };
    }).filter(function (cliente) {
      return cliente.estado === ESTADOS.VERIFICADO_RETORNOU || cliente.estado === ESTADOS.VERIFICADO_SEM_RETORNO;
    }).sort(function (a, b) { return (a.hora || 0) - (b.hora || 0); });

    painel.replaceChildren();
    painel.appendChild(criarCabecalho());
    painel.appendChild(elemento('div', 'Na fila: ' + fila.length + ' · Verificados hoje: ' + verificados.length, 'smt-cr-muted'));
    if (mensagemStatus) {
      const erro = /não consegui|não foi possível|falha|incerta|não encontrei|não localizei|excede|não corresponde/i.test(mensagemStatus);
      const status = elemento('div', mensagemStatus, erro ? 'smt-cr-error' : 'smt-cr-warning');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      painel.appendChild(status);
    }
    const atual = lerCnpjAtual();
    const ativo = estadoDia.clienteAtivo;
    const selecionado = atual && ativo === atual
      ? fila.find(function (cliente) { return cliente.cnpj === atual; }) ||
        verificados.find(function (cliente) { return cliente.cnpj === atual; })
      : null;
    if (selecionado) painel.appendChild(criarFormularioChecagem(selecionado));

    painel.appendChild(elemento('h3', 'Fila de hoje', 'smt-cr-section'));
    const lista = elemento('div', undefined, 'smt-cr-list');
    if (!fila.length) lista.appendChild(elemento('div', 'Não há clientes elegíveis pendentes hoje.', 'smt-cr-empty'));
    else fila.forEach(function (cliente) { lista.appendChild(criarCartaoCliente(cliente, cliente.cnpj === ativo)); });
    painel.appendChild(lista);

    painel.appendChild(elemento('h3', 'Verificados hoje', 'smt-cr-section'));
    const listaVerificados = elemento('div', undefined, 'smt-cr-list');
    if (!verificados.length) listaVerificados.appendChild(elemento('div', 'Nenhuma checagem confirmada hoje.', 'smt-cr-empty'));
    else verificados.forEach(function (cliente) {
      const cartao = criarCartaoCliente(cliente, false);
      cartao.querySelector('.smt-cr-actions').replaceChildren(criarBotao('Reabrir', function () {
        reabrirCliente(cliente.cnpj);
      }, 'smt-cr-btn'));
      listaVerificados.appendChild(cartao);
    });
    painel.appendChild(listaVerificados);
  }

  function iniciar() {
    limparChavesAntigas();
    instalarEstilos();
    instalarBotaoAbrir();
    window.__smartTableUtil?.registrarPainel?.('checagemRetornos', fecharPainel);
    const cnpjAtual = lerCnpjAtual();
    const estadoDia = lerEstadoDia(chaveDia());
    if (cnpjAtual && estadoDia.clienteAtivo === cnpjAtual) abrirPainel();
    const cliente = cnpjAtual ? estadoDia.clientes[cnpjAtual] : null;
    if (cliente && cliente.operacao && cliente.operacao.status === 'em_andamento') {
      window.setTimeout(function () { observarOperacao(cnpjAtual, cliente.operacao.id, true); }, 0);
    } else if (cliente && cliente.operacao && cliente.operacao.status === 'incerta') {
      window.setTimeout(function () { observarOperacao(cnpjAtual, cliente.operacao.id, false); }, 0);
    }
  }

  window.__checagemRetornosPure = Object.freeze({
    normalizarCnpj: normalizarCnpj,
    chaveDia: chaveDia,
    construirFila: construirFila,
    transicionarEstado: transicionarEstado,
    montarObservacao: montarObservacao,
    validarObservacao: validarObservacao,
    RESULTADOS: RESULTADOS,
    ESTADOS: ESTADOS,
    LIMITE_RESUMO_CRM: LIMITE_RESUMO_CRM,
  });
  window.__checagemRetornos = Object.freeze({
    abrir: abrirPainel,
    fechar: fecharPainel,
    renderizar: renderizarPainel,
    obterEstadoHoje: function () { return lerEstadoDia(chaveDia()); },
    obterHistorico: lerHistorico,
    abrirWhatsApp: abrirWhatsApp,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
