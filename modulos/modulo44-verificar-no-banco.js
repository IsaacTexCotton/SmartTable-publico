/* =========================================================================
 * MÓDULO 44: VERIFICAR NO BANCO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (23/11/2026): "montar algo que me lembre de verificar estes títulos no banco e registrar a informação depois". "Estes
 * títulos" são os que o CRM marca com o ícone `span.titulo-alerta` ("Vencido há N dias e não está negativado, em cartório nem protestado.
 * Verificar o motivo."). Decisões do usuário: gatilho AUTOMÁTICO (todo título com o alerta do CRM vira pendência); lembrete AO ABRIR O
 * CLIENTE; resultado escolhido numa lista fechada de quatro opções; depois de "Registrar" o título some do aviso até o alerta mudar (se o
 * alerta sumir e voltar, avisa de novo); o texto vai para a ÁREA DE TRANSFERÊNCIA e o usuário cola no "Registrar Contato" (nada é preenchido
 * nem gravado no CRM por este módulo). Texto e desenho aprovados pelo usuário em 23/11/2026.
 *
 * A REGRA DO ALERTA é a do próprio CRM, lida no código dele (diagnóstico censurado do usuário, 23/11/2026; ver docs/recursos/verificar-no-banco.md):
 *   quitado (`__pago`) não alerta; `diasAtraso` > 15; precisa de `sitCobrancaCodigo`; sem `posicaoCodigo` ALERTA; com posição, alerta quando o
 *   código NÃO está em [2, 3, 5, 6, 9, 10, 11, 12, 13]. Como as constantes são do CRM e podem mudar, o aviso confere o resultado contra os
 *   ícones da tela (quando a tabela está desenhada) e diz se divergirem.
 *
 * PADRÃO NATIVO: o aviso e o formulário usam só classes que existem no HTML/CSS reais do CRM (as fixtures de tests/fixtures/); o formulário
 * é o modal do "Registrar Contato" (botões de resultado, textarea e botão amarelo de salvar são os dele). `tests/verificar-no-banco.test.js`
 * confere que cada classe de `CLASSES` existe. DOM seguro: textContent, nunca innerHTML com dado do CRM.
 *
 * O que fica guardado (localStorage, só neste navegador): por cliente (CNPJ completo) e título (número/sequência): o resultado, a observação
 * e a data. Nada vai a sistema externo. Carga: depois do Módulo 0. Expõe window.__verificarBanco.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__verificarBancoCarregado) return;
  window.__verificarBancoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Verificar no Banco');

  const CONFIG = Object.freeze({
    CHAVE_STORAGE: 'smarttable_verificar_banco_v1',
    ID_AVISO: 'smarttable-aviso-verificar-banco',
    ID_FORMULARIO: 'smarttable-formulario-verificar-banco',
    // Regra do CRM (ver o cabeçalho): copiada do código dele, não inventada.
    DIAS_PARA_ALERTA: 15,
    POSICOES_SEM_ALERTA: Object.freeze([2, 3, 5, 6, 9, 10, 11, 12, 13]),
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  });

  const RESULTADOS = Object.freeze([
    { codigo: 'EM_CARTORIO_PROTESTO', rotulo: 'Já está em cartório/protesto' },
    { codigo: 'PAGO_AGUARDANDO_BAIXA', rotulo: 'Pago, aguardando baixa' },
    { codigo: 'NEGATIVADO_SCPC', rotulo: 'Negativado/SCPC' },
    { codigo: 'AGUARDANDO_BANCO', rotulo: 'Aguardando o banco / sem retorno' },
  ]);

  // Classes NATIVAS do CRM (vistas nas fixtures reais; o teste confere). Nada aqui foi inventado.
  const CLASSES = Object.freeze({
    // Aviso: o cartão do modal (rounded-2xl, borda, sombra) na posição do toast nativo (fixed bottom-5 right-5).
    avisoCartao: 'fixed bottom-5 right-5 bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col',
    // Modal (o do "Registrar Contato")
    fundo: 'fixed inset-0 bg-gray-900/40 backdrop-blur-sm items-center justify-center z-50 py-4 flex outline-none',
    cartao: 'bg-white rounded-2xl shadow-xl w-full max-w-6xl mx-4 my-auto border border-gray-200 flex flex-col max-h-[calc(100vh-2rem)]',
    topo: 'px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0',
    topoEsquerda: 'flex items-center gap-2.5',
    iconeCaixa: 'p-1.5 bg-gray-100 rounded-lg',
    icone: 'w-4 h-4 text-gray-400',
    titulo: 'text-sm font-semibold text-gray-800',
    subtitulo: 'text-xs text-gray-500 mt-0.5',
    fechar: 'text-gray-400 hover:text-gray-600 transition',
    iconeFechar: 'w-5 h-5',
    corpo: 'overflow-y-auto px-5 py-4 flex-1 space-y-4',
    rotulo: 'block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide',
    rodape: 'flex flex-col sm:flex-row sm:justify-between gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0',
    rodapeDireita: 'flex justify-end gap-3',
    botaoSecundario: 'px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition',
    botaoPrimario: 'px-5 py-2 text-sm bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-200 disabled:cursor-not-allowed text-gray-800 rounded-lg font-semibold transition flex items-center gap-2',
    // Botão pequeno do cartão do cliente (o do Responsável financeiro): "Registrar" em cada linha do aviso.
    botaoDoCartao: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition',
    // Botões de resultado do "Registrar Contato" (e o selecionado, no estilo do botão de canal selecionado).
    opcao: 'w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg border-2 border-gray-200 bg-white text-gray-700 text-left transition hover:border-yellow-400 hover:bg-yellow-50',
    opcaoSelecionada: 'w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg border-2 transition border-yellow-400 bg-yellow-50 text-yellow-700',
    textarea: 'w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 resize-none text-sm',
    // Linhas do aviso e textos
    caixa: 'bg-white border border-gray-200 rounded-xl px-4 py-3',
    linhaTitulo: 'flex items-center justify-between gap-3',
    nota: 'flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg',
    notaTexto: 'text-xs text-gray-700',
    texto: 'text-sm text-gray-700',
    apagado: 'text-xs text-gray-500',
    negrito: 'font-semibold',
    espaco2: 'space-y-2',
    erro: 'bg-red-100 text-red-800 rounded-lg px-3 py-2 text-sm',
  });

  /* ---------------------------------------------------------------------
   * REGRA DO ALERTA (a do CRM) E IDENTIDADE DO TÍTULO
   * --------------------------------------------------------------------- */
  /** Espelho de `precisaAlerta(row)` do CRM. Não lança: dado estranho = sem alerta. */
  function precisaAlerta(titulo) {
    if (!titulo || typeof titulo !== 'object' || titulo.__pago) return false;
    if (!(titulo.diasAtraso > CONFIG.DIAS_PARA_ALERTA)) return false;
    if (!titulo.sitCobrancaCodigo) return false;
    const posicao = titulo.posicaoCodigo;
    if (posicao === null || posicao === undefined) return true; // o comentário do CRM diz o contrário, mas o código dele dá alerta
    return CONFIG.POSICOES_SEM_ALERTA.indexOf(Number(posicao)) === -1;
  }

  const textoSimples = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const chaveDoTitulo = (t) => `${textoSimples(t?.numeroTitulo)}/${textoSimples(t?.sequencia)}`;
  const cnpjDaPagina = () => {
    try { return new URLSearchParams(window.location.search).get('cnpj') || ''; } catch { return ''; }
  };
  const cnpjCompleto = (v) => window.__smartTableUtil?.cnpjCompleto?.(v) ?? String(v ?? '').replace(/\D/g, '');
  const chaveDoCliente = () => cnpjCompleto(cnpjDaPagina());

  /** Os títulos com alerta da página aberta (sem repetidos), do mais atrasado para o menos. `null` se a página não trouxe a lista. */
  function titulosComAlerta() {
    const lista = window.__TITULOS_ABERTOS__;
    if (!Array.isArray(lista)) return null;
    const vistos = new Set();
    return lista.filter((t) => {
      if (!precisaAlerta(t)) return false;
      const k = chaveDoTitulo(t);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).sort((a, b) => b.diasAtraso - a.diasAtraso);
  }

  /* ---------------------------------------------------------------------
   * GUARDA (localStorage, por cliente e título)
   * --------------------------------------------------------------------- */
  function lerTudo() {
    try {
      const bruto = JSON.parse(window.localStorage.getItem(CONFIG.CHAVE_STORAGE) || '{}');
      return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    } catch { return {}; }
  }
  function gravarTudo(todos) {
    try { window.localStorage.setItem(CONFIG.CHAVE_STORAGE, JSON.stringify(todos)); return true; } catch { return false; }
  }
  const registrosDoCliente = () => {
    const r = lerTudo()[chaveDoCliente()];
    return r && typeof r === 'object' ? r : {};
  };

  function registrarVerificacao(titulo, resultado, observacao, hoje) {
    const cliente = chaveDoCliente();
    if (!cliente) return false;
    const todos = lerTudo();
    const doCliente = todos[cliente] && typeof todos[cliente] === 'object' ? todos[cliente] : {};
    doCliente[chaveDoTitulo(titulo)] = { resultado, observacao, verificadoEm: dataIso(hoje) };
    todos[cliente] = doCliente;
    return gravarTudo(todos);
  }

  /** Tira do registro o título que deixou de alertar (quitado, em cartório...): se o alerta voltar, avisa de novo. */
  function podarRegistros(comAlerta) {
    const cliente = chaveDoCliente();
    if (!cliente || !Array.isArray(comAlerta) || !Array.isArray(window.__TITULOS_ABERTOS__) || window.__TITULOS_ABERTOS__.length === 0) return;
    const todos = lerTudo();
    const doCliente = todos[cliente];
    if (!doCliente || typeof doCliente !== 'object') return;
    const vivos = new Set(comAlerta.map(chaveDoTitulo));
    let mudou = false;
    Object.keys(doCliente).forEach((k) => { if (!vivos.has(k)) { delete doCliente[k]; mudou = true; } });
    if (!mudou) return;
    if (Object.keys(doCliente).length === 0) delete todos[cliente];
    gravarTudo(todos);
  }

  function pendentes() {
    const comAlerta = titulosComAlerta();
    if (!comAlerta) return [];
    const feitos = registrosDoCliente();
    return comAlerta.filter((t) => !feitos[chaveDoTitulo(t)]);
  }

  /**
   * Para o progresso da fila (Módulos 7 e 11): as chaves (número/sequência, sem repetidas) dos títulos de uma lista qualquer que a regra do CRM
   * marca com o alerta. Pura: não lê a página aberta nem o registro. Lista que não é lista = `null` (leitura impossível, diferente de "nenhum").
   */
  function chavesComAlerta(lista) {
    if (!Array.isArray(lista)) return null;
    const chaves = [];
    lista.forEach((t) => {
      if (!precisaAlerta(t)) return;
      const k = chaveDoTitulo(t);
      if (!chaves.includes(k)) chaves.push(k);
    });
    return chaves;
  }

  /**
   * O cliente (CNPJ em qualquer formatação) está verificado quando TODAS as chaves dadas têm registro neste navegador. Sem chaves = falso
   * (não há o que verificar, então não conta como verificado). Só lê o registro; nunca grava.
   */
  function clienteVerificado(cnpj, chaves) {
    if (!Array.isArray(chaves) || chaves.length === 0) return false;
    const feitos = lerTudo()[cnpjCompleto(cnpj)];
    if (!feitos || typeof feitos !== 'object') return false;
    return chaves.every((k) => Boolean(feitos[k]));
  }

  /* ---------------------------------------------------------------------
   * TEXTO PARA O CRM
   * --------------------------------------------------------------------- */
  function dataIso(data) {
    const d = window.__smartTableUtil?.normalizarData?.(data ?? new Date()) ?? (data ?? new Date());
    return window.__smartTableUtil?.dataIso?.(d) ?? '';
  }
  function dataBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
  const rotuloDoResultado = (codigo) => RESULTADOS.find((r) => r.codigo === codigo)?.rotulo || '';

  /** "Verificado no banco em DD/MM/AAAA: título N/S — Resultado. Obs.: ..." (a observação só entra se foi escrita). */
  function montarTexto({ titulo, resultado, observacao, hoje }) {
    const rotulo = rotuloDoResultado(resultado);
    if (!rotulo) return '';
    const obs = textoSimples(observacao);
    return `Verificado no banco em ${dataBr(dataIso(hoje))}: título ${chaveDoTitulo(titulo)} — ${rotulo}.${obs ? ` Obs.: ${obs}` : ''}`;
  }

  async function copiar(texto) {
    try {
      const clipboard = window.navigator?.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        await clipboard.writeText(texto);
        return true;
      }
    } catch { /* cai para o plano B */ }
    try {
      const area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      Object.assign(area.style, { position: 'fixed', top: '-1000px', opacity: '0' });
      document.body.appendChild(area);
      area.select();
      const ok = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
      area.remove();
      return ok;
    } catch { return false; }
  }

  /* ---------------------------------------------------------------------
   * DOM
   * --------------------------------------------------------------------- */
  const money = (v) => {
    const n = Number(v);
    return (Number.isFinite(n) ? (window.__smartTableUtil?.formatarMoeda?.(n) ?? String(n)) : '—').replace(/ /g, ' ');
  };

  /** Elemento com `classe` (as nativas, de CLASSES), texto (textContent), filhos e, só no que classe nenhuma resolve, estilo. */
  function no(tag, classe, texto, filhos, estilo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (estilo) Object.assign(e.style, estilo);
    if (texto !== undefined && texto !== null) e.textContent = texto;
    (filhos || []).forEach((f) => { if (f) e.appendChild(f); });
    return e;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CAMINHO_AVISO = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
  const CAMINHO_X = 'M6 18L18 6M6 6l12 12';
  function icone(classe, caminho) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', caminho);
    svg.appendChild(path);
    return svg;
  }

  let avisoEl = null;
  let formularioEl = null;
  let focoAnterior = null;
  let notaDoAviso = '';

  /** Quantos ícones o CRM desenhou x quantos a regra achou. Só compara com a tabela inteira desenhada; senão `null` (não dá para saber). */
  function conferirComATela() {
    const lista = window.__TITULOS_ABERTOS__;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    const linhas = document.querySelectorAll('#tabela-titulos-ds tbody tr.st-row');
    if (linhas.length !== lista.length) return null;
    const tela = document.querySelectorAll('#tabela-titulos-ds tbody .titulo-alerta').length;
    const calculado = (titulosComAlerta() || []).length;
    return { tela, calculado, confere: tela === calculado };
  }

  /* ---------------------------------------------------------------------
   * AVISO (ao abrir o cliente)
   * --------------------------------------------------------------------- */
  function renderAviso() {
    const lista = pendentes();
    if (lista.length === 0 && !notaDoAviso) { fecharAviso(); return; }
    if (!avisoEl) {
      avisoEl = no('div', CLASSES.avisoCartao, null, null, { zIndex: CONFIG.Z_INDEX_POPUP, width: 'min(400px, calc(100vw - 2.5rem))', maxHeight: 'calc(100vh - 2.5rem)' });
      avisoEl.id = CONFIG.ID_AVISO;
      avisoEl.setAttribute('role', 'region');
      avisoEl.setAttribute('aria-label', 'Verificar no banco');
      document.body.appendChild(avisoEl);
    }
    const titulo = no('h3', CLASSES.titulo, lista.length ? `Verificar no banco (${lista.length})` : 'Verificar no banco');
    const subtitulo = no('p', CLASSES.subtitulo, lista.length ? `Estes títulos estão vencidos há mais de ${CONFIG.DIAS_PARA_ALERTA} dias, sem negativação, cartório ou protesto.` : '');
    const topo = no('div', CLASSES.topo, null, [no('div', CLASSES.topoEsquerda, null, [no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone, CAMINHO_AVISO)]), no('div', null, null, [titulo, subtitulo])])]);
    const linhas = lista.map((t) => {
      const botao = no('button', CLASSES.botaoDoCartao, 'Registrar');
      botao.type = 'button';
      botao.dataset.acao = 'registrar';
      botao.dataset.titulo = chaveDoTitulo(t);
      botao.addEventListener('click', () => abrirFormulario(t));
      const dias = `vencido há ${t.diasAtraso} dias`;
      const descricao = no('div', null, null, [
        no('p', `${CLASSES.texto} ${CLASSES.negrito}`, `Título ${chaveDoTitulo(t)}`),
        no('p', CLASSES.apagado, `${dias} · ${money(t.valorEmAberto)}`),
      ]);
      const linha = no('div', CLASSES.caixa, null, [no('div', CLASSES.linhaTitulo, null, [descricao, botao])]);
      linha.dataset.titulo = chaveDoTitulo(t);
      return linha;
    });
    const filhos = [...linhas];
    if (notaDoAviso) {
      const nota = no('div', CLASSES.nota, null, [no('p', CLASSES.notaTexto, notaDoAviso)]);
      nota.dataset.nota = 'copiado';
      filhos.push(nota);
    }
    const conf = conferirComATela();
    if (conf && !conf.confere) {
      const dif = no('div', CLASSES.nota, null, [no('p', CLASSES.notaTexto, `A regra do CRM pode ter mudado: o SmartTable achou ${conf.calculado} título(s) com alerta e a tela mostra ${conf.tela}.`)]);
      dif.dataset.nota = 'divergencia';
      filhos.push(dif);
    }
    const corpo = no('div', CLASSES.corpo, null, filhos);
    const depois = no('button', CLASSES.botaoSecundario, lista.length ? 'Lembrar depois' : 'Fechar');
    depois.type = 'button';
    depois.dataset.acao = 'lembrar-depois';
    depois.addEventListener('click', fecharAviso);
    const rodape = no('div', CLASSES.rodape, null, [no('span'), no('div', CLASSES.rodapeDireita, null, [depois])]);
    avisoEl.replaceChildren(topo, corpo, rodape);
  }

  function fecharAviso() {
    avisoEl?.remove();
    avisoEl = null;
    notaDoAviso = '';
  }

  /* ---------------------------------------------------------------------
   * FORMULÁRIO (o modal do "Registrar Contato")
   * --------------------------------------------------------------------- */
  function abrirFormulario(titulo, opcoes = {}) {
    if (formularioEl) return;
    window.__smartTableUtil?.fecharOutrosPaineis?.('verificarBanco');
    focoAnterior = document.activeElement;
    let escolhido = null;
    const hoje = opcoes.hoje;

    const tituloEl = no('h3', CLASSES.titulo, 'Verificação no banco');
    tituloEl.id = `${CONFIG.ID_FORMULARIO}-titulo`;
    const esquerda = no('div', CLASSES.topoEsquerda, null, [no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone, CAMINHO_AVISO)]), no('div', null, null, [tituloEl, no('p', CLASSES.subtitulo, `Título ${chaveDoTitulo(titulo)}`)])]);
    const fechar = no('button', CLASSES.fechar, null, [icone(CLASSES.iconeFechar, CAMINHO_X)]);
    fechar.type = 'button';
    fechar.dataset.acao = 'fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.addEventListener('click', fecharFormulario);
    const topo = no('div', CLASSES.topo, null, [esquerda, fechar]);

    const confirmar = no('button', CLASSES.botaoPrimario, 'Copiar texto e marcar como verificado');
    confirmar.type = 'button';
    confirmar.dataset.acao = 'confirmar';
    confirmar.disabled = true;
    const botoesOpcao = RESULTADOS.map((r) => {
      const b = no('button', CLASSES.opcao, r.rotulo);
      b.type = 'button';
      b.dataset.resultado = r.codigo;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        escolhido = r.codigo;
        botoesOpcao.forEach((o) => {
          const ativo = o.dataset.resultado === escolhido;
          o.className = ativo ? CLASSES.opcaoSelecionada : CLASSES.opcao;
          o.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
        confirmar.disabled = false;
      });
      return b;
    });
    const observacao = no('textarea', CLASSES.textarea);
    observacao.rows = 3;
    observacao.id = `${CONFIG.ID_FORMULARIO}-observacao`;
    observacao.dataset.campo = 'observacao';
    const rotuloObs = no('label', CLASSES.rotulo, 'Observação (opcional)');
    rotuloObs.setAttribute('for', observacao.id);
    const erro = no('div', CLASSES.erro, '');
    erro.hidden = true;
    erro.setAttribute('role', 'alert');
    const corpo = no('div', CLASSES.corpo, null, [
      no('section', null, null, [no('p', CLASSES.rotulo, 'Resultado'), no('div', CLASSES.espaco2, null, botoesOpcao)]),
      no('section', null, null, [rotuloObs, observacao]),
      erro,
    ]);

    const cancelar = no('button', CLASSES.botaoSecundario, 'Cancelar');
    cancelar.type = 'button';
    cancelar.dataset.acao = 'cancelar';
    cancelar.addEventListener('click', fecharFormulario);
    const rodape = no('div', CLASSES.rodape, null, [no('span'), no('div', CLASSES.rodapeDireita, null, [cancelar, confirmar])]);

    let enviando = false;
    confirmar.addEventListener('click', async () => {
      if (!escolhido || enviando) return;
      enviando = true;
      confirmar.disabled = true;
      erro.hidden = true;
      const texto = montarTexto({ titulo, resultado: escolhido, observacao: observacao.value, hoje });
      const copiou = await copiar(texto);
      if (!formularioEl) return; // fechado enquanto copiava
      if (!copiou) {
        erro.textContent = 'Não consegui copiar o texto. O título continua pendente: tente de novo.';
        erro.hidden = false;
        enviando = false;
        confirmar.disabled = false;
        return;
      }
      const gravou = registrarVerificacao(titulo, escolhido, textoSimples(observacao.value), hoje);
      if (!gravou) {
        erro.textContent = 'O texto foi copiado, mas não consegui guardar a verificação neste navegador. O título continua pendente.';
        erro.hidden = false;
        enviando = false;
        confirmar.disabled = false;
        return;
      }
      notaDoAviso = 'Texto copiado para a área de transferência. Cole no Registrar Contato do CRM.';
      fecharFormulario();
      renderAviso();
    });

    formularioEl = no('div', CLASSES.fundo, null, [no('div', CLASSES.cartao, null, [topo, corpo, rodape])], { zIndex: CONFIG.Z_INDEX_POPUP });
    formularioEl.id = CONFIG.ID_FORMULARIO;
    formularioEl.setAttribute('role', 'dialog');
    formularioEl.setAttribute('aria-modal', 'true');
    formularioEl.setAttribute('aria-labelledby', tituloEl.id);
    formularioEl.addEventListener('click', (evento) => { if (evento.target === formularioEl) fecharFormulario(); });
    document.body.appendChild(formularioEl);
    formularioEl.tabIndex = -1;
    formularioEl.focus();
  }

  function fecharFormulario() {
    if (!formularioEl) return;
    formularioEl.remove();
    formularioEl = null;
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) focoAnterior.focus();
    focoAnterior = null;
  }

  /** Tab fica dentro do formulário (aria-modal): circula entre os controles dele. */
  function prenderTab(evento) {
    const controles = [...formularioEl.querySelectorAll('button:not([disabled]), textarea')];
    if (!controles.length) { evento.preventDefault(); return; }
    const primeiro = controles[0];
    const ultimo = controles[controles.length - 1];
    const atual = document.activeElement;
    if (atual === formularioEl || !formularioEl.contains(atual)) { evento.preventDefault(); (atual === formularioEl && evento.shiftKey ? ultimo : primeiro).focus(); return; }
    if (evento.shiftKey && atual === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && atual === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }

  function aoTeclar(evento) {
    if (!formularioEl) return;
    if (evento.code === 'Escape') { fecharFormulario(); return; }
    if (evento.code === 'Tab' && !evento.altKey && !evento.ctrlKey && !evento.metaKey) prenderTab(evento);
  }

  /* ---------------------------------------------------------------------
   * CARGA
   * --------------------------------------------------------------------- */
  function iniciar() {
    if (!chaveDoCliente()) return; // só na tela do cliente
    const comAlerta = titulosComAlerta();
    if (comAlerta) podarRegistros(comAlerta);
    if (document.getElementById(CONFIG.ID_AVISO)) return; // idempotente: um segundo DOMContentLoaded não duplica o aviso
    if (pendentes().length > 0) renderAviso();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
  document.addEventListener('keydown', aoTeclar);
  window.__smartTableUtil?.registrarPainel?.('verificarBanco', fecharFormulario);

  window.__verificarBanco = {
    CONFIG,
    CLASSES,
    RESULTADOS,
    precisaAlerta,
    titulosComAlerta,
    chavesComAlerta,
    clienteVerificado,
    pendentes,
    montarTexto,
    conferirComATela,
    abrirFormulario,
    fecharFormulario,
    renderAviso,
    fecharAviso,
    estaAberto: () => formularioEl !== null,
    avisoAberto: () => avisoEl !== null,
  };
})();
