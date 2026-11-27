/* =========================================================================
 * MÓDULO 39: 2ª VIA NO SYSTEXTIL (CRM → Systextil)
 * -------------------------------------------------------------------------
 * Lista os títulos ABERTOS (a vencer e vencidos) da empresa e das outras razões do grupo, deixa o operador marcar até
 * MAX_ITENS_LOTE e, depois da confirmação, envia UM pedido em lote ao userscript do Systextil (systextil-segunda-via.user.js,
 * repositório Systextil-envio-mensagem). Esse userscript consulta e emite todos os boletos na Consulta de títulos (um a cada
 * ~3 minutos, para cada processo ter um horário só dele) e, DEPOIS, vai a Processos agendados e baixa os PDFs.
 *
 * Fonte dos títulos: `__TITULOS_ABERTOS__` da página (empresa aberta) e `__grupoEconomico.buscarTitulosAbertosDoGrupo` (Módulo 5).
 * As travas são as do Módulo 1: "Não cobrar"/"Carteira", em acordo (Módulo 16) e fora do relatório (Módulo 12) aparecem na
 * lista com o motivo e SEM seleção. Título já emitido nesta sessão também não pode ser marcado de novo.
 *
 * O transporte é por evento DOM consumido pelo userscript. Este módulo não acessa GM_* nem altera o ERP.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__smartTableSystextilCarregado) return;
  window.__smartTableSystextilCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Ponte CRM → Systextil');

  const CONFIG = Object.freeze({
    EVENTO_ENVIAR: 'smarttable:systextil:enviar-titulo',
    EVENTO_RESULTADO: 'smarttable:systextil:resultado',
    ID_BOTAO: 'smarttable-systextil-transferir',
    ID_MODAL: 'smarttable-systextil-modal',
    ID_BARRA: 'smarttable-systextil-acoes',
    ID_STATUS_BARRA: 'smarttable-systextil-status',
    // Mesmo teto do userscript do Systextil: o 1º PDF só é baixado depois da última emissão e uma solicitação com mais de
    // 30 min não é mais associada a um processo.
    MAX_ITENS_LOTE: 6,
    MINUTOS_ENTRE_BOLETOS: 3,
    TTL_PEDIDO_MS: 5 * 60 * 1000,
    TTL_ACOMPANHAMENTO_MS: 10 * 60 * 1000,
    ESPERA_PONTE_MS: 8000,
    // Sem nenhum sinal do Systextil por tanto tempo, no meio do lote, o painel avisa (ele manda sinais a cada ~10 s na espera).
    SEM_SINAL_MS: 90 * 1000,
    LIMITE_MOTIVO: 800,
    LIMITE_TITULO: 40,
    LIMITE_PARCELA: 20,
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  });

  // Classes NATIVAS do CRM, as mesmas dos modais do Plano (Módulo 43) e do Celular (Módulo 46), vistas nas fixtures reais.
  const CLASSES = Object.freeze({
    fundo: 'fixed inset-0 bg-gray-900/40 backdrop-blur-sm items-center justify-center z-50 py-4 flex outline-none',
    cartao: 'bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 my-auto border border-gray-200 flex flex-col max-h-[calc(100vh-2rem)]',
    topo: 'px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0',
    topoEsquerda: 'flex items-center gap-2.5',
    iconeCaixa: 'p-1.5 bg-gray-100 rounded-lg',
    icone: 'w-4 h-4 text-gray-400',
    titulo: 'text-sm font-semibold text-gray-800',
    subtitulo: 'text-xs text-gray-500 mt-0.5',
    fechar: 'text-gray-400 hover:text-gray-600 transition',
    iconeFechar: 'w-5 h-5',
    corpo: 'overflow-y-auto px-5 py-4 flex-1 space-y-4',
    botaoDoCartao: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition disabled:opacity-50 disabled:cursor-not-allowed',
    iconeDoBotao: 'w-3.5 h-3.5',
    rodape: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0',
    rodapeDireita: 'flex justify-end gap-3',
    botaoSecundario: 'px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition whitespace-nowrap',
    botaoPrimario: 'px-5 py-2 text-sm text-white bg-gray-800 hover:bg-gray-900 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
    texto: 'text-sm text-gray-700',
    apagado: 'text-xs text-gray-500',
    nota: 'flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg',
    notaTexto: 'text-xs text-gray-700',
    erro: 'bg-red-100 text-red-800 rounded-lg px-3 py-2 text-sm',
    sucesso: 'bg-green-100 text-green-800 rounded-lg px-3 py-2 text-sm',
    andamento: 'bg-blue-100 text-blue-800 rounded-lg px-3 py-2 text-sm',
    aviso: 'bg-yellow-100 text-yellow-800 rounded-lg px-3 py-2 text-sm',
    negrito: 'font-semibold',
    linha: 'flex items-center gap-2 flex-wrap',
    checkbox: 'rounded border-gray-300 text-gray-700 focus:ring-yellow-400',
    // Tabela dos títulos (st-*), dentro de .pbi-scope, como o CRM desenha.
    escopoPbi: 'pbi-scope',
    tabelaEscopo: 'st-scope',
    tabelaWrap: 'st-table-wrap st-dense',
    tabela: 'st-table',
    th: 'st-th',
    thInterno: 'st-th-inner',
    thRotulo: 'st-th-label',
    tr: 'st-row',
    td: 'st-td',
    tdNumero: 'st-td-mono',
    tdConteudo: 'st-td-content',
    badge: 'pbi-badge',
    badgeNeutro: 'pbi-badge-neutral',
    badgeInfo: 'pbi-badge-info',
    badgePerigo: 'pbi-badge-danger',
    cnpj: 'font-mono text-xs text-gray-500',
    nomeEmpresa: 'text-sm text-gray-800',
  });

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CAMINHO_DOCUMENTO = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  const CAMINHO_X = 'M6 18L18 6M6 6l12 12';

  // Estados que o userscript do Systêxtil publica. Qualquer outro (por exemplo `preenchido`, da ponte antiga já aposentada) é
  // ignorado sem mexer na tela.
  const ESTADOS_CONHECIDOS = new Set([
    'aguardando', 'abrindo-tela', 'abrir-tela-manual', 'processando', 'emissao-solicitada',
    'baixando', 'concluido', 'indeterminado', 'erro',
  ]);
  // Estado de cada título dentro do lote (lista fechada do userscript) mais `enviado`, que só existe aqui.
  const ESTADOS_ITEM = new Set([
    'na-fila', 'consultando', 'aguardando-intervalo', 'emitido', 'nao-emitido', 'baixando', 'concluido', 'indeterminado', 'erro',
  ]);
  // Título que NÃO pode ser marcado de novo nesta sessão: já foi enviado, está em andamento ou já teve a emissão solicitada.
  // `nao-emitido` fica livre: o userscript garante que nada foi emitido.
  const TEXTO_DO_ESTADO = Object.freeze({
    enviado: 'Enviado',
    'na-fila': 'Na fila',
    consultando: 'Consultando…',
    'aguardando-intervalo': 'Aguardando intervalo',
    emitido: 'Emitido',
    baixando: 'Baixando PDF…',
    concluido: 'PDF salvo',
    'nao-emitido': 'Não emitido',
    indeterminado: 'Conferir no Systextil',
    erro: 'PDF não baixado',
  });
  // Erros em que repetir o pedido não adianta: o Systextil recusaria de novo.
  const CODIGOS_SEM_NOVA_TENTATIVA = new Set(['pedido-pendente', 'bloqueio-persistido']);
  const CODIGOS_CONHECIDOS = new Set(['pedido-pendente', 'bloqueio-persistido', 'expirado', 'tela-ausente']);
  // As mesmas posições que o Módulo 1 (protegido) não cobra. Um teste confere que a lista continua igual à dele.
  const POSICOES_NAO_COBRAR = Object.freeze(['NAO COBRAR', 'CARTEIRA']);

  // Histórico só em memória e censurado por construção: estados e códigos de listas fechadas, booleano e milissegundos.
  // Nunca título, CNPJ, nome ou mensagem.
  const LIMITE_HISTORICO = 40;
  const historicoEventos = [];
  let contadorPedidos = 0;

  const lotes = new Map(); // id do pedido -> acompanhamento
  const estadoDoTitulo = new Map(); // chave do título -> estado nesta sessão (ver TEXTO_DO_ESTADO)
  const motivoDoTitulo = new Map(); // chave do título -> por que o Systextil não o emitiu (texto fixo do userscript)
  const restanteDoTitulo = new Map(); // chave do título -> segundos que faltam do intervalo entre emissões
  const ESTADOS_COM_MOTIVO = new Set(['nao-emitido', 'indeterminado', 'erro']);
  const estado = {
    linhas: [],
    avisos: [],
    selecionadas: new Set(),
    carregando: false,
    lendoGrupo: false,
    confirmando: false,
    bloqueadoPorConferencia: false,
    mensagem: null, // { texto, tipo }
  };
  let modalEl = null;
  let corpoEl = null;
  let rodapeEl = null;
  let focoAnterior = null;
  let observerInstalacao = null;
  let timerDisponibilidade = null;
  let sondagemInicial = null;
  let tokenDeAbertura = 0;

  /* ---------------------------------------------------------------------
   * HISTÓRICO CENSURADO
   * --------------------------------------------------------------------- */
  function codigoSeguro(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    return CODIGOS_CONHECIDOS.has(valor) ? valor : 'outro';
  }

  function registrarHistorico(lote, estadoDoEvento, ok, codigo) {
    historicoEventos.push(Object.freeze({
      n: lote?.n ?? 0,
      estado: estadoDoEvento,
      ok: ok === true,
      codigo: codigo || null,
      msDesdeEnvio: lote?.enviadoEm ? Math.max(0, Date.now() - lote.enviadoEm) : null,
    }));
    if (historicoEventos.length > LIMITE_HISTORICO) historicoEventos.shift();
  }

  function historico() {
    return historicoEventos.map((evento) => ({ ...evento }));
  }

  /* ---------------------------------------------------------------------
   * LEITURA DOS TÍTULOS (funções puras sobre os dados do CRM)
   * --------------------------------------------------------------------- */
  const util = () => window.__smartTableUtil;

  function cnpjAtual() {
    let valor = '';
    try {
      valor = new URLSearchParams(window.location.search).get('cnpj') || '';
    } catch (_) {
      return '';
    }
    const digitos = String(valor).replace(/\D/g, '');
    return /^\d{14}$/.test(digitos) ? digitos : '';
  }

  function validarCodigo(valor, limite, rotulo) {
    const codigo = String(valor ?? '').trim();
    if (!codigo || codigo.length > limite || !/^[A-Za-z0-9_-]+$/.test(codigo)) {
      throw new Error(rotulo + ' ausente ou com formato inválido. O título não foi enviado.');
    }
    return codigo;
  }

  function validarCnpj(valor) {
    const digitos = String(valor ?? '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(digitos)) {
      throw new Error('Não foi possível identificar o CNPJ completo da empresa no CRM.');
    }
    return digitos;
  }

  function criarId() {
    try {
      if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) {
      // Usa identificador local alternativo quando randomUUID não estiver disponível.
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  const normalizarCodigo = (valor) => {
    const codigo = String(valor ?? '').trim();
    return /^\d+$/.test(codigo) ? (codigo.replace(/^0+/, '') || '0') : codigo.toUpperCase();
  };

  const semAcento = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  function lerDataIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return null;
    const data = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return data.getFullYear() === Number(m[1]) && data.getMonth() === Number(m[2]) - 1 && data.getDate() === Number(m[3]) ? data : null;
  }

  const dataBr = (data) => [String(data.getDate()).padStart(2, '0'), String(data.getMonth() + 1).padStart(2, '0'), data.getFullYear()].join('/');

  function moeda(valor) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return '';
    if (typeof util()?.formatarMoeda === 'function') return util().formatarMoeda(valor);
    return 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function hoje() {
    const agora = new Date();
    return typeof util()?.normalizarData === 'function' ? util().normalizarData(agora) : new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12);
  }

  /**
   * Por que o título NÃO pode ser emitido, ou null. Mesmas travas do Módulo 1: não cobrar/carteira, em acordo (Módulo 16) e fora
   * do relatório (Módulo 12), mais a do cliente marcado como "Não cobrar" no Alerta e os dados que o Systextil exige.
   */
  function motivoDeBloqueio(linha, bruto, empresa) {
    try {
      validarCodigo(linha.titulo, CONFIG.LIMITE_TITULO, 'Número do título');
      validarCodigo(linha.parcela, CONFIG.LIMITE_PARCELA, 'Parcela/sequência');
    } catch (_) {
      return { codigo: 'codigo-invalido', texto: 'Título inválido', detalhe: 'Título ou parcela com formato inválido' };
    }
    if (empresa.suprimida === true) return { codigo: 'cliente-nao-cobrar', texto: 'Cliente em Não cobrar', detalhe: 'Cliente marcado como Não cobrar no Alerta' };
    const posicao = semAcento(bruto?.posicaoDescricao);
    if (POSICOES_NAO_COBRAR.some((p) => posicao.includes(p))) return { codigo: 'nao-cobrar', texto: 'Não cobrar', detalhe: 'O CRM marca este título como "Não cobrar" ou "Carteira"' };
    if (bruto?.emAcordo === true) return { codigo: 'em-acordo', texto: 'Em acordo' };
    if (bruto?.foraDoRelatorio === true) return { codigo: 'fora-do-relatorio', texto: 'Fora do relatório' };
    if (linha.diasAtraso === null) return { codigo: 'vencimento-ilegivel', texto: 'Vencimento ilegível' };
    if (!linha.razaoSocial || linha.razaoSocial.length > 180) return { codigo: 'sem-razao-social', texto: 'Sem razão social', detalhe: 'A razão social da empresa não está disponível' };
    if (!/^\d{14}$/.test(linha.cnpj)) return { codigo: 'sem-cnpj', texto: 'CNPJ incompleto', detalhe: 'Não foi possível identificar o CNPJ completo da empresa' };
    return null;
  }

  /** Uma linha da lista a partir de um título cru do CRM (`__TITULOS_ABERTOS__`) e da empresa dele. */
  function montarLinha(bruto, empresa, referencia) {
    const titulo = String(bruto?.numeroTitulo ?? '').trim();
    const parcela = String(bruto?.sequencia ?? '').trim();
    const cnpj = String(empresa.cnpj ?? '').replace(/\D/g, '');
    const vencimento = lerDataIso(bruto?.dataVencimento);
    const dias = vencimento ? Math.round((referencia.getTime() - vencimento.getTime()) / 86400000) : null;
    const linha = {
      chave: cnpj + '|' + normalizarCodigo(titulo) + '|' + normalizarCodigo(parcela),
      cnpj,
      razaoSocial: String(empresa.razaoSocial || bruto?.razaoSocial || '').trim(),
      titulo,
      parcela,
      vencimentoOrdem: vencimento ? vencimento.getTime() : Infinity,
      vencimentoTexto: vencimento ? dataBr(vencimento) : '',
      valorTexto: moeda(bruto?.valorEmAberto),
      diasAtraso: dias,
      // Mesmo critério do Módulo 1 (DIAS_ATRASO_MIN = 1): vence hoje ainda é "a vencer".
      vencido: dias !== null && dias >= 1,
      doGrupo: empresa.doGrupo === true,
      bloqueio: null,
    };
    linha.bloqueio = motivoDeBloqueio(linha, bruto, empresa);
    return linha;
  }

  function ordenarLinhas(linhas) {
    return linhas
      .map((linha, posicao) => ({ linha, posicao }))
      .sort((a, b) => (a.linha.doGrupo - b.linha.doGrupo) || (a.linha.vencimentoOrdem - b.linha.vencimentoOrdem) || (a.posicao - b.posicao))
      .map((item) => item.linha);
  }

  /** Os títulos abertos da empresa da página, já com as travas. Lança se a página não trouxe a lista. */
  function coletarTitulosDaEmpresaAtual() {
    const lista = window.__TITULOS_ABERTOS__;
    if (!Array.isArray(lista)) throw new Error('O CRM não trouxe a lista de títulos desta empresa.');
    const cnpj = validarCnpj(cnpjAtual());
    const emAcordo = window.__negociacoes?.tituloEmAcordo;
    const foraDoRelatorio = window.__alertaCliente?.tituloForaDoRelatorio;
    let suprimida = false;
    try {
      suprimida = window.__alertaCliente?.estaSuprimidoDaPrioridade?.(cnpj) === true;
    } catch (_) {
      throw new Error('Não foi possível verificar a regra "Não cobrar" desta empresa.');
    }
    const referencia = hoje();
    const vistos = new Set();
    const linhas = [];
    lista.forEach((bruto) => {
      const completo = String(bruto?.numeroTitulo ?? '').trim() + '/' + String(bruto?.sequencia ?? '').trim();
      const linha = montarLinha({
        ...bruto,
        emAcordo: typeof emAcordo === 'function' ? emAcordo(completo) === true : false,
        foraDoRelatorio: typeof foraDoRelatorio === 'function' ? foraDoRelatorio(completo) === true : false,
      }, { cnpj, razaoSocial: '', suprimida }, referencia);
      if (vistos.has(linha.chave)) return;
      vistos.add(linha.chave);
      linhas.push(linha);
    });
    return ordenarLinhas(linhas);
  }

  /** Os títulos abertos das outras razões do grupo (Módulo 5). Lança se a leitura falhar: nada de lista parcial calada. */
  async function coletarTitulosDoGrupo() {
    if (typeof window.__grupoEconomico?.buscarTitulosAbertosDoGrupo !== 'function') {
      throw new Error('O leitor das outras razões do grupo não está disponível.');
    }
    const empresas = await window.__grupoEconomico.buscarTitulosAbertosDoGrupo();
    if (!Array.isArray(empresas)) throw new Error('A leitura das outras razões do grupo retornou um formato inválido.');
    const referencia = hoje();
    const linhas = [];
    empresas.forEach((empresa) => {
      (empresa.titulos || []).forEach((bruto) => {
        linhas.push(montarLinha(bruto, { cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, suprimida: empresa.suprimida === true, doGrupo: true }, referencia));
      });
    });
    return linhas;
  }

  /** Empresa da página e grupo juntos, sem repetir título. Falha do grupo vira aviso (nunca silêncio); a empresa atual vale sozinha. */
  async function coletarTitulosAbertos() {
    const atuais = coletarTitulosDaEmpresaAtual();
    const avisos = [];
    let grupo = [];
    try {
      grupo = await coletarTitulosDoGrupo();
    } catch (erro) {
      avisos.push('Não foi possível ler as outras razões do grupo: ' + (erro?.message || 'falha na leitura') + ' A lista mostra só esta empresa.');
    }
    const vistos = new Set(atuais.map((linha) => linha.chave));
    const outros = grupo.filter((linha) => !vistos.has(linha.chave) && vistos.add(linha.chave));
    return { linhas: [...atuais, ...ordenarLinhas(outros)], avisos };
  }

  /* ---------------------------------------------------------------------
   * PEDIDO EM LOTE (schema 2)
   * --------------------------------------------------------------------- */
  function montarItemDoPedido(linha) {
    return {
      cnpj: validarCnpj(linha.cnpj),
      razaoSocial: linha.razaoSocial,
      titulo: validarCodigo(linha.titulo, CONFIG.LIMITE_TITULO, 'Número do título'),
      parcela: validarCodigo(linha.parcela, CONFIG.LIMITE_PARCELA, 'Parcela/sequência'),
      vencimento: linha.vencimentoTexto,
      saldo: linha.valorTexto,
      diasAtraso: Number.isInteger(linha.diasAtraso) ? Math.max(0, linha.diasAtraso) : null,
      situacao: linha.vencido ? 'EM_ATRASO' : 'A_VENCER',
      fluxo: '',
    };
  }

  function montarPedidoLote(linhas) {
    if (!Array.isArray(linhas) || linhas.length < 1) throw new Error('Nenhum título foi selecionado.');
    if (linhas.length > CONFIG.MAX_ITENS_LOTE) throw new Error('O lote aceita no máximo ' + CONFIG.MAX_ITENS_LOTE + ' títulos.');
    const vistos = new Set();
    linhas.forEach((linha) => {
      if (linha.bloqueio) throw new Error('Um título bloqueado foi selecionado. Nada foi enviado.');
      if (vistos.has(linha.chave)) throw new Error('O mesmo título foi selecionado duas vezes.');
      vistos.add(linha.chave);
    });
    return {
      schema: 2,
      id: criarId(),
      createdAt: Date.now(),
      source: 'smarttable-crm',
      itens: linhas.map(montarItemDoPedido),
    };
  }

  /* ---------------------------------------------------------------------
   * ESTADO DE CADA TÍTULO E SELEÇÃO
   * --------------------------------------------------------------------- */
  const existeEmAndamento = () => {
    for (const lote of lotes.values()) {
      if (!lote.erro) return true;
    }
    return false;
  };

  /** O título já foi enviado, está em andamento ou já teve a emissão solicitada nesta sessão: não pode ser marcado de novo. */
  function jaEnviado(linha) {
    const atual = estadoDoTitulo.get(linha.chave);
    return atual !== undefined && atual !== 'nao-emitido';
  }

  const podeSelecionar = (linha) => !linha.bloqueio && !jaEnviado(linha);
  const linhasSelecionadas = () => estado.linhas.filter((linha) => estado.selecionadas.has(linha.chave) && podeSelecionar(linha));

  function selecionarPrimeiras(linhas) {
    const elegiveis = linhas.filter(podeSelecionar);
    estado.selecionadas = new Set(elegiveis.slice(0, CONFIG.MAX_ITENS_LOTE).map((linha) => linha.chave));
    estado.mensagem = elegiveis.length > CONFIG.MAX_ITENS_LOTE
      ? { tipo: 'aviso', texto: 'O lote aceita no máximo ' + CONFIG.MAX_ITENS_LOTE + ' títulos. Marquei os primeiros; os outros ficam para o próximo lote.' }
      : null;
  }

  /* ---------------------------------------------------------------------
   * ACOMPANHAMENTO DO LOTE
   * --------------------------------------------------------------------- */
  function definirMensagem(texto, tipo) {
    estado.mensagem = texto ? { texto, tipo } : null;
  }

  function avisarFora(texto) {
    if (!modalEl) util()?.toast?.(texto, 5000);
  }

  function armarTimer(lote, ms, aoDisparar) {
    if (lote.timer) window.clearTimeout(lote.timer);
    lote.timer = window.setTimeout(() => {
      lote.timer = null;
      if (lotes.get(lote.id) !== lote) return;
      aoDisparar();
    }, ms);
  }

  /** Libera os títulos que o userscript garante não terem sido emitidos (ainda não consultados ou só enviados). */
  function liberarNaoIniciados(lote) {
    lote.chaves.forEach((chave) => {
      const atual = estadoDoTitulo.get(chave);
      if (['enviado', 'na-fila', 'consultando', 'aguardando-intervalo'].includes(atual)) estadoDoTitulo.delete(chave);
    });
  }

  function aplicarItens(lote, itens) {
    if (!Array.isArray(itens)) return;
    itens.forEach((item) => {
      if (!Number.isInteger(item?.indice) || item.indice < 0 || item.indice >= lote.chaves.length) return;
      if (!ESTADOS_ITEM.has(item.estado)) return;
      const chave = lote.chaves[item.indice];
      estadoDoTitulo.set(chave, item.estado);
      // O motivo é um texto fixo do userscript (sem dado do cliente); só vale para os estados em que algo não saiu como esperado.
      if (ESTADOS_COM_MOTIVO.has(item.estado) && typeof item.motivo === 'string' && item.motivo.trim()) motivoDoTitulo.set(chave, item.motivo.trim().slice(0, CONFIG.LIMITE_MOTIVO));
      else motivoDoTitulo.delete(chave);
      if (item.estado === 'aguardando-intervalo' && Number.isInteger(item.restanteSegundos) && item.restanteSegundos >= 0) restanteDoTitulo.set(chave, item.restanteSegundos);
      else restanteDoTitulo.delete(chave);
    });
    // Aba do Systextil em segundo plano: o navegador atrasa (ou congela) os temporizadores dela e o lote pode parar de andar.
    lote.segundoPlano = itens.some((item) => item && item.segundoPlano === true);
  }

  const ETAPAS = Object.freeze({
    'abrindo-tela': { tipo: 'andamento', texto: 'Abrindo a Consulta de títulos (crec_f090) no Systextil…' },
    'abrir-tela-manual': { tipo: 'aviso', texto: 'O Systextil não abriu a Consulta de títulos sozinho. Abra essa tela; a automação continua quando ela aparecer.' },
    processando: { tipo: 'andamento', texto: 'O Systextil está consultando e emitindo os boletos.' },
    'emissao-solicitada': { tipo: 'andamento', texto: 'Boletos emitidos. O Systextil vai a Processos agendados baixar os PDFs.' },
    baixando: { tipo: 'andamento', texto: 'Baixando os PDFs para a pasta Downloads.' },
  });

  /** Depois de cada sinal de andamento, espera outro; se ele não vier em SEM_SINAL_MS, o painel avisa (sem mexer em nada do lote). */
  function armarSinal(lote) {
    if (lote.timerSinal) window.clearTimeout(lote.timerSinal);
    lote.timerSinal = window.setTimeout(() => {
      lote.timerSinal = null;
      if (lotes.get(lote.id) !== lote || lote.erro) return;
      lote.semSinal = true;
      renderTudo();
    }, CONFIG.SEM_SINAL_MS);
  }

  function marcarParaConferir(lote) {
    lote.chaves.forEach((chave) => {
      const atual = estadoDoTitulo.get(chave);
      if (atual && atual !== 'concluido' && atual !== 'nao-emitido') estadoDoTitulo.set(chave, 'indeterminado');
    });
    estado.bloqueadoPorConferencia = true;
  }

  function receberResultado(evento) {
    let resultado;
    try {
      resultado = typeof evento?.detail === 'string' ? JSON.parse(evento.detail) : evento?.detail;
    } catch (_) {
      return;
    }
    if (!resultado || typeof resultado.id !== 'string') return;
    const lote = lotes.get(resultado.id);
    if (!lote) return;
    if (!ESTADOS_CONHECIDOS.has(resultado.status)) return;
    const codigo = resultado.status === 'erro' ? codigoSeguro(resultado.codigo) : null;
    registrarHistorico(lote, resultado.status, resultado.ok, codigo);
    if (lote.timer) {
      window.clearTimeout(lote.timer);
      lote.timer = null;
    }
    if (lote.timerSinal) {
      window.clearTimeout(lote.timerSinal);
      lote.timerSinal = null;
    }
    lote.semSinal = false;
    aplicarItens(lote, resultado.itens);

    if (resultado.status === 'erro') {
      let mensagem = resultado.mensagem || 'O Systextil não conseguiu iniciar a segunda via.';
      if (/versão ou a origem da solicitação/i.test(mensagem)) {
        mensagem += ' Atualize o userscript do Systextil para a versão 1.1.0 ou superior.';
      }
      if (CODIGOS_SEM_NOVA_TENTATIVA.has(codigo)) {
        // Repetir seria recusado de novo: pede conferência em vez de oferecer nova tentativa.
        lotes.delete(lote.id);
        liberarNaoIniciados(lote);
        estado.bloqueadoPorConferencia = true;
      } else {
        // O pedido segue guardado no Tampermonkey e pode ser atendido depois (por exemplo, quando o operador abre a tela). O erro
        // não encerra o acompanhamento: se chegar andamento do mesmo pedido até a validade, a tela volta a mostrá-lo.
        lote.erro = true;
        liberarNaoIniciados(lote);
        if (codigo === 'expirado') lotes.delete(lote.id);
        else {
          armarTimer(lote, Math.max(0, lote.expiraEm - Date.now()) + 250, () => { lotes.delete(lote.id); renderTudo(); });
        }
      }
      definirMensagem(mensagem, 'erro');
      avisarFora(mensagem);
      renderTudo();
      return;
    }

    // Qualquer estado que não seja erro retoma o acompanhamento do pedido.
    lote.erro = false;
    lote.chaves.forEach((chave) => { if (!estadoDoTitulo.has(chave)) estadoDoTitulo.set(chave, 'enviado'); });

    if (resultado.status === 'aguardando') {
      const restante = Math.max(0, lote.expiraEm - Date.now());
      if (restante === 0) {
        lotes.delete(lote.id);
        liberarNaoIniciados(lote);
        definirMensagem('A solicitação expirou antes de ser recebida pelo Systextil. Confira a aba de destino e envie novamente.', 'erro');
        renderTudo();
        return;
      }
      definirMensagem(resultado.mensagem || 'Título recebido. A automação começa quando uma aba do Systextil estiver na Consulta de títulos.', 'andamento');
      armarTimer(lote, restante + 250, () => {
        lotes.delete(lote.id);
        liberarNaoIniciados(lote);
        definirMensagem('A solicitação expirou sem o Systextil iniciar a consulta. Confira a aba de destino antes de reenviar.', 'erro');
        renderTudo();
      });
      renderTudo();
      return;
    }

    const etapa = ETAPAS[resultado.status];
    if (etapa) {
      definirMensagem(resultado.mensagem || etapa.texto, etapa.tipo);
      armarTimer(lote, CONFIG.TTL_ACOMPANHAMENTO_MS, () => {
        lotes.delete(lote.id);
        marcarParaConferir(lote);
        definirMensagem('O SmartTable não recebeu a confirmação final do Systextil. Confira Processos agendados e a pasta Downloads antes de qualquer nova emissão.', 'erro');
        renderTudo();
      });
      if (['processando', 'emissao-solicitada', 'baixando'].includes(resultado.status)) armarSinal(lote);
      renderTudo();
      return;
    }

    // `concluido` ou `indeterminado`: o lote terminou.
    lotes.delete(lote.id);
    if (resultado.status === 'concluido') {
      if (resultado.ok === true) {
        definirMensagem(resultado.mensagem || 'Segunda via concluída no Systextil. PDFs salvos na pasta Downloads.', 'sucesso');
      } else {
        const incerto = lote.chaves.some((chave) => estadoDoTitulo.get(chave) === 'indeterminado');
        if (incerto) estado.bloqueadoPorConferencia = true;
        definirMensagem(resultado.mensagem || 'O Systextil informou conclusão sem confirmar o sucesso. Confira Processos agendados e Downloads antes de tentar novamente.', 'aviso');
      }
    } else {
      marcarParaConferir(lote);
      definirMensagem(resultado.mensagem || 'O Systextil não confirmou o resultado da emissão. Confira Processos agendados e Downloads manualmente antes de tentar novamente.', 'erro');
    }
    avisarFora(estado.mensagem.texto);
    renderTudo();
  }

  document.addEventListener(CONFIG.EVENTO_RESULTADO, receberResultado);

  function enviarLote() {
    if (existeEmAndamento() || estado.bloqueadoPorConferencia) return;
    const linhas = linhasSelecionadas();
    let pedido;
    try {
      pedido = montarPedidoLote(linhas);
    } catch (erro) {
      estado.confirmando = false;
      definirMensagem(erro.message, 'erro');
      renderTudo();
      return;
    }
    contadorPedidos += 1;
    const lote = {
      id: pedido.id,
      n: contadorPedidos,
      chaves: linhas.map((linha) => linha.chave),
      timer: null,
      erro: false,
      enviadoEm: pedido.createdAt,
      expiraEm: pedido.createdAt + CONFIG.TTL_PEDIDO_MS,
    };
    lotes.set(lote.id, lote);
    lote.chaves.forEach((chave) => { estadoDoTitulo.set(chave, 'enviado'); motivoDoTitulo.delete(chave); });
    registrarHistorico(lote, 'enviado', true, null);
    estado.confirmando = false;
    estado.selecionadas = new Set();
    // Texto e aviso de "ponte não respondeu" ficam prontos ANTES do dispatchEvent: ele é síncrono, e a ponte pode responder
    // (por exemplo, recusando um pedido inválido) dentro dele. `receberResultado` desarma este timer e escreve a resposta;
    // nada aqui pode vir depois que a sobrescreva.
    definirMensagem('Enviando a solicitação para o Tampermonkey…', 'andamento');
    armarTimer(lote, CONFIG.ESPERA_PONTE_MS, () => {
      lotes.delete(lote.id);
      registrarHistorico(lote, 'ponte-sem-resposta', false, null);
      liberarNaoIniciados(lote);
      definirMensagem('A ponte não respondeu. Confira se o userscript de integração (versão 1.1.0 ou superior) está instalado e habilitado no CRM e no Systextil.', 'erro');
      renderTudo();
    });
    document.dispatchEvent(new window.CustomEvent(CONFIG.EVENTO_ENVIAR, { detail: JSON.stringify(pedido), bubbles: false }));
    renderTudo();
  }

  /* ---------------------------------------------------------------------
   * DOM (sempre textContent e APIs de DOM: nada de innerHTML com dado do CRM)
   * --------------------------------------------------------------------- */
  function no(tag, classe, texto, filhos, estilo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (estilo) Object.assign(e.style, estilo);
    if (texto !== undefined && texto !== null) e.textContent = texto;
    (filhos || []).forEach((f) => { if (f) e.appendChild(f); });
    return e;
  }

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

  function botao(classe, texto, papel, aoClicar) {
    const el = no('button', classe, texto);
    el.type = 'button';
    el.dataset.papel = papel;
    el.addEventListener('click', aoClicar);
    return el;
  }

  function celulaDaTabela(coluna, conteudo) {
    return no('td', coluna.num ? CLASSES.td + ' ' + CLASSES.tdNumero : CLASSES.td, null, [no('span', CLASSES.tdConteudo, null, [conteudo])], { textAlign: coluna.num ? 'right' : 'left' });
  }

  const COLUNAS = Object.freeze([
    { t: '' }, { t: 'Título' }, { t: 'Empresa' }, { t: 'Vencimento' }, { t: 'Situação' }, { t: 'Valor', num: true },
  ]);

  function situacaoDaLinha(linha) {
    if (linha.bloqueio) {
      const chip = no('span', CLASSES.badge + ' ' + CLASSES.badgeNeutro, linha.bloqueio.texto);
      chip.title = linha.bloqueio.detalhe || linha.bloqueio.texto;
      return chip;
    }
    if (linha.vencido) return no('span', CLASSES.badge + ' ' + CLASSES.badgePerigo, 'Vencido há ' + linha.diasAtraso + (linha.diasAtraso === 1 ? ' dia' : ' dias'));
    const faltam = -linha.diasAtraso;
    return no('span', CLASSES.badge + ' ' + CLASSES.badgeInfo, faltam <= 0 ? 'Vence hoje' : 'A vencer em ' + faltam + (faltam === 1 ? ' dia' : ' dias'));
  }

  function textoDeTempo(segundos) {
    return segundos >= 60 ? Math.floor(segundos / 60) + ' min ' + (segundos % 60) + ' s' : segundos + ' s';
  }

  function textoDaEmissao(linha) {
    const base = TEXTO_DO_ESTADO[estadoDoTitulo.get(linha.chave)] || '';
    return restanteDoTitulo.has(linha.chave) ? base + ' (faltam ' + textoDeTempo(restanteDoTitulo.get(linha.chave)) + ')' : base;
  }

  function linhaDaTabela(linha) {
    const selecionavel = podeSelecionar(linha);
    const travadaPorLote = existeEmAndamento();
    let controle;
    if (selecionavel) {
      controle = no('input', CLASSES.checkbox);
      controle.type = 'checkbox';
      controle.dataset.papel = 'selecionar';
      controle.dataset.chave = linha.chave;
      controle.checked = estado.selecionadas.has(linha.chave);
      controle.disabled = travadaPorLote;
      controle.setAttribute('aria-label', 'Selecionar o título ' + linha.titulo + ', parcela ' + linha.parcela);
      controle.addEventListener('change', () => alternarSelecao(linha.chave, controle));
    } else {
      controle = no('span', CLASSES.apagado, '—');
      controle.title = linha.bloqueio ? (linha.bloqueio.detalhe || linha.bloqueio.texto) : 'Já enviado nesta sessão';
    }
    const empresa = no('div', null, null, [no('div', CLASSES.nomeEmpresa, linha.razaoSocial || 'Empresa'), no('div', CLASSES.cnpj, linha.cnpj)]);
    // O andamento do lote fica sob o número do título: sempre à vista, mesmo em tela estreita onde a tabela rola na horizontal.
    const emissao = no('div', CLASSES.apagado, textoDaEmissao(linha));
    emissao.dataset.papel = 'emissao';
    emissao.dataset.chave = linha.chave;
    const celulas = [
      controle,
      no('div', null, null, [no('div', null, linha.titulo + ' / ' + linha.parcela, null, { fontWeight: '600', color: 'var(--text-heading)' }), emissao]),
      empresa,
      no('span', null, linha.vencimentoTexto || '—'),
      situacaoDaLinha(linha),
      no('span', null, linha.valorTexto || '—'),
    ];
    const tr = no('tr', CLASSES.tr, null, celulas.map((c, i) => celulaDaTabela(COLUNAS[i], c)));
    tr.dataset.chave = linha.chave;
    return tr;
  }

  function tabelaDeTitulos() {
    const cabecalho = no('tr', null, null, COLUNAS.map((coluna) => {
      const th = no('th', CLASSES.th, null, [no('span', CLASSES.thInterno, null, [no('span', CLASSES.thRotulo, coluna.t)])], { textAlign: coluna.num ? 'right' : 'left' });
      th.setAttribute('scope', 'col');
      return th;
    }));
    const tabela = no('table', CLASSES.tabela, null, [no('thead', null, null, [cabecalho]), no('tbody', null, null, estado.linhas.map(linhaDaTabela))]);
    tabela.setAttribute('aria-label', 'Títulos em aberto');
    return no('div', CLASSES.escopoPbi, null, [no('div', CLASSES.tabelaEscopo, null, [no('div', CLASSES.tabelaWrap, null, [tabela], { overflowX: 'auto' })])], { background: 'white' });
  }

  function estimativaEmMinutos(quantidade) {
    return Math.max(2, Math.ceil(((quantidade - 1) * (CONFIG.MINUTOS_ENTRE_BOLETOS * 60 + 5) + 90) / 60));
  }

  /* ---------------------------------------------------------------------
   * MODAL
   * --------------------------------------------------------------------- */
  function capturarFoco() {
    const ativo = document.activeElement;
    if (!modalEl || !ativo || !modalEl.contains(ativo)) return null;
    return { papel: ativo.dataset?.papel || '', chave: ativo.dataset?.chave || '' };
  }

  function restaurarFoco(foco) {
    if (!foco || !modalEl) return;
    const candidatos = Array.from(modalEl.querySelectorAll('[data-papel="' + foco.papel + '"]'));
    const alvo = candidatos.find((el) => (el.dataset.chave || '') === foco.chave && !el.disabled) || candidatos.find((el) => !el.disabled);
    if (alvo) alvo.focus();
  }

  function montarCorpo() {
    corpoEl.replaceChildren();
    corpoEl.appendChild(no('p', CLASSES.texto, 'Marque os títulos. Depois da sua confirmação, o Systextil consulta e emite os boletos e, no fim, baixa os PDFs na pasta Downloads. Deixe uma aba do Systextil aberta neste navegador.'));

    const emAndamento = existeEmAndamento();
    const todos = botao(CLASSES.botaoDoCartao, 'Selecionar todos', 'selecionar-todos', () => { selecionarPrimeiras(estado.linhas); estado.confirmando = false; renderTudo(); });
    const vencidos = botao(CLASSES.botaoDoCartao, 'Só vencidos', 'so-vencidos', () => { selecionarPrimeiras(estado.linhas.filter((l) => l.vencido)); estado.confirmando = false; renderTudo(); });
    const limpar = botao(CLASSES.botaoDoCartao, 'Limpar', 'limpar', () => { estado.selecionadas = new Set(); estado.mensagem = null; estado.confirmando = false; renderTudo(); });
    [todos, vencidos, limpar].forEach((b) => { b.disabled = emAndamento || estado.bloqueadoPorConferencia; });
    const contador = no('span', CLASSES.apagado, linhasSelecionadas().length + ' de até ' + CONFIG.MAX_ITENS_LOTE + ' selecionado(s)');
    contador.dataset.papel = 'contador';
    corpoEl.appendChild(no('div', CLASSES.linha, null, [todos, vencidos, limpar, contador]));

    if (estado.mensagem) {
      const caixa = no('div', CLASSES[estado.mensagem.tipo] || CLASSES.andamento, estado.mensagem.texto);
      caixa.dataset.papel = 'status';
      corpoEl.appendChild(caixa);
    }
    if (estado.bloqueadoPorConferencia) {
      corpoEl.appendChild(no('div', CLASSES.aviso, 'Há título(s) para conferir no Systextil (Processos agendados e Downloads). Depois de conferir, recarregue o CRM para liberar novas emissões.'));
    }
    estado.avisos.forEach((texto) => corpoEl.appendChild(no('div', CLASSES.aviso, texto)));
    const lotesAndando = Array.from(lotes.values()).filter((lote) => !lote.erro);
    if (lotesAndando.some((lote) => lote.segundoPlano)) {
      const aviso = no('div', CLASSES.aviso, 'A aba do Systextil está em segundo plano. O navegador pode atrasar ou pausar o relógio dela: deixe a aba do Systextil visível, de preferência em uma janela própria, até o lote terminar.');
      aviso.dataset.papel = 'segundo-plano';
      corpoEl.appendChild(aviso);
    }
    if (lotesAndando.some((lote) => lote.semSinal)) {
      const aviso = no('div', CLASSES.aviso, 'O Systextil não dá sinal há mais de ' + Math.round(CONFIG.SEM_SINAL_MS / 1000) + ' segundos. Confira a aba dele: ela pode estar em segundo plano (o navegador pausa abas escondidas) ou ter uma janela de confirmação aberta. Não envie de novo antes de conferir: o lote pode estar só parado.');
      aviso.dataset.papel = 'sem-sinal';
      corpoEl.appendChild(aviso);
    }
    const comMotivo = estado.linhas.filter((linha) => ESTADOS_COM_MOTIVO.has(estadoDoTitulo.get(linha.chave)) && motivoDoTitulo.has(linha.chave));
    if (comMotivo.length > 0) {
      const motivos = no('div', CLASSES.aviso, null, [
        no('div', CLASSES.negrito, 'O que o Systextil informou sobre os títulos que não saíram:'),
        ...comMotivo.map((linha) => no('div', null, linha.titulo + ' / ' + linha.parcela + ' (' + TEXTO_DO_ESTADO[estadoDoTitulo.get(linha.chave)] + '): ' + motivoDoTitulo.get(linha.chave))),
      ]);
      motivos.dataset.papel = 'motivos';
      corpoEl.appendChild(motivos);
    }

    if (estado.carregando) {
      corpoEl.appendChild(no('p', CLASSES.apagado, 'Lendo os títulos do CRM…'));
    } else if (estado.linhas.length === 0) {
      corpoEl.appendChild(no('p', CLASSES.texto, 'Não há títulos em aberto nesta empresa.'));
    } else {
      corpoEl.appendChild(tabelaDeTitulos());
    }
    if (estado.lendoGrupo) corpoEl.appendChild(no('p', CLASSES.apagado, 'Lendo as outras razões do grupo…'));
    corpoEl.appendChild(no('div', CLASSES.nota, null, [no('span', CLASSES.notaTexto, 'Razão social e CNPJ servem para conferência: o Systextil só emite se número, parcela e cliente conferirem lá. Fechar este painel não cancela a emissão; para interromper, aperte Esc na aba do Systextil.')]));
  }

  function montarRodape() {
    rodapeEl.replaceChildren();
    const quantidade = linhasSelecionadas().length;
    if (estado.confirmando && quantidade > 0) {
      const texto = 'O Systextil vai consultar e emitir ' + quantidade + (quantidade === 1 ? ' boleto' : ' boletos') + ', um a cada ' + CONFIG.MINUTOS_ENTRE_BOLETOS + ' minutos, e depois baixar os PDFs em Downloads. Tempo estimado: ~' + estimativaEmMinutos(quantidade) + ' min. Deixe uma aba do Systextil aberta.';
      const aviso = no('span', CLASSES.notaTexto + ' flex-1', texto);
      aviso.dataset.papel = 'confirmacao';
      aviso.setAttribute('role', 'alert');
      rodapeEl.appendChild(aviso);
      rodapeEl.appendChild(no('div', CLASSES.rodapeDireita, null, [
        botao(CLASSES.botaoSecundario, 'Voltar', 'voltar', () => { estado.confirmando = false; renderTudo(); }),
        botao(CLASSES.botaoPrimario, 'Confirmar emissão', 'confirmar', enviarLote),
      ]));
      return;
    }
    const fechar = botao(CLASSES.botaoSecundario, 'Fechar', 'fechar-rodape', fecharModal);
    let rotulo = quantidade === 0 ? 'Emitir boletos' : 'Emitir ' + quantidade + (quantidade === 1 ? ' boleto' : ' boletos');
    let bloqueado = quantidade === 0;
    if (existeEmAndamento()) { rotulo = 'Emissão em andamento…'; bloqueado = true; }
    if (estado.bloqueadoPorConferencia) { rotulo = 'Conferência necessária'; bloqueado = true; }
    const emitir = botao(CLASSES.botaoPrimario, rotulo, 'emitir', () => { if (quantidade > 0) { estado.confirmando = true; renderTudo(); } });
    emitir.disabled = bloqueado;
    rodapeEl.appendChild(fechar);
    rodapeEl.appendChild(emitir);
  }

  function renderTudo() {
    if (!modalEl) return;
    const foco = capturarFoco();
    const rolagem = corpoEl.scrollTop;
    montarCorpo();
    montarRodape();
    corpoEl.scrollTop = rolagem;
    restaurarFoco(foco);
  }

  function alternarSelecao(chave, controle) {
    if (controle.checked && estado.selecionadas.size >= CONFIG.MAX_ITENS_LOTE) {
      controle.checked = false;
      definirMensagem('O lote aceita no máximo ' + CONFIG.MAX_ITENS_LOTE + ' títulos.', 'aviso');
      renderTudo();
      return;
    }
    if (controle.checked) estado.selecionadas.add(chave);
    else estado.selecionadas.delete(chave);
    estado.confirmando = false;
    if (estado.mensagem?.tipo === 'aviso') estado.mensagem = null;
    renderTudo();
  }

  async function abrirModal() {
    if (document.getElementById(CONFIG.ID_BOTAO)?.disabled) return;
    if (modalEl) {
      fecharModal();
      return;
    }
    util()?.fecharOutrosPaineis?.('segundaVia');
    focoAnterior = document.activeElement;
    const token = ++tokenDeAbertura;
    const tituloEl = no('h3', CLASSES.titulo, '2ª via no Systextil');
    tituloEl.id = CONFIG.ID_MODAL + '-titulo';
    const esquerda = no('div', CLASSES.topoEsquerda, null, [
      no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone, CAMINHO_DOCUMENTO)]),
      no('div', null, null, [tituloEl, no('p', CLASSES.subtitulo, 'Empresa e grupo')]),
    ]);
    const fechar = no('button', CLASSES.fechar, null, [icone(CLASSES.iconeFechar, CAMINHO_X)]);
    fechar.type = 'button';
    fechar.dataset.papel = 'fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.addEventListener('click', fecharModal);
    corpoEl = no('div', CLASSES.corpo);
    corpoEl.setAttribute('aria-live', 'polite');
    rodapeEl = no('div', CLASSES.rodape);
    modalEl = no('div', CLASSES.fundo, null, [no('div', CLASSES.cartao, null, [no('div', CLASSES.topo, null, [esquerda, fechar]), corpoEl, rodapeEl])], { zIndex: CONFIG.Z_INDEX_POPUP });
    modalEl.id = CONFIG.ID_MODAL;
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', tituloEl.id);
    modalEl.addEventListener('click', (evento) => { if (evento.target === modalEl) fecharModal(); });
    document.body.appendChild(modalEl);
    document.getElementById(CONFIG.ID_BOTAO)?.setAttribute('aria-expanded', 'true');
    modalEl.tabIndex = -1;
    modalEl.focus();

    estado.linhas = [];
    estado.avisos = [];
    estado.selecionadas = new Set();
    estado.confirmando = false;
    estado.carregando = true;
    estado.lendoGrupo = false;
    renderTudo();

    try {
      estado.linhas = coletarTitulosDaEmpresaAtual();
    } catch (erro) {
      estado.carregando = false;
      definirMensagem(erro?.message || 'Não foi possível ler os títulos do CRM.', 'erro');
      renderTudo();
      return;
    }
    estado.carregando = false;
    estado.lendoGrupo = true;
    renderTudo();

    try {
      const grupo = await coletarTitulosDoGrupo();
      if (token !== tokenDeAbertura || !modalEl) return;
      const vistos = new Set(estado.linhas.map((linha) => linha.chave));
      const outros = grupo.filter((linha) => !vistos.has(linha.chave) && vistos.add(linha.chave));
      estado.linhas = [...estado.linhas, ...ordenarLinhas(outros)];
    } catch (erro) {
      if (token !== tokenDeAbertura || !modalEl) return;
      estado.avisos.push('Não foi possível ler as outras razões do grupo: ' + (erro?.message || 'falha na leitura') + ' A lista mostra só esta empresa.');
    }
    estado.lendoGrupo = false;
    renderTudo();
  }

  function fecharModal() {
    if (!modalEl) return;
    tokenDeAbertura += 1;
    modalEl.remove();
    modalEl = null;
    corpoEl = null;
    rodapeEl = null;
    estado.confirmando = false;
    document.getElementById(CONFIG.ID_BOTAO)?.setAttribute('aria-expanded', 'false');
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) focoAnterior.focus();
    focoAnterior = null;
  }

  function prenderTab(evento) {
    const focaveis = Array.from(modalEl.querySelectorAll('button:not([disabled]), input:not([disabled])'));
    if (!focaveis.length) { evento.preventDefault(); return; }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const atual = document.activeElement;
    if (atual === modalEl || !modalEl.contains(atual)) { evento.preventDefault(); (atual === modalEl && evento.shiftKey ? ultimo : primeiro).focus(); return; }
    if (evento.shiftKey && atual === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && atual === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }

  function aoTeclar(evento) {
    if (!modalEl) return;
    if (evento.code === 'Escape') { fecharModal(); return; }
    if (evento.code === 'Tab' && !evento.altKey && !evento.ctrlKey && !evento.metaKey) prenderTab(evento);
  }

  document.addEventListener('keydown', aoTeclar);
  window.__smartTableUtil?.registrarPainel?.('segundaVia', fecharModal);

  /* ---------------------------------------------------------------------
   * BOTÃO "PREPARAR 2ª VIA" (acima da tabela de títulos)
   * --------------------------------------------------------------------- */
  function avaliarDisponibilidade() {
    const lista = window.__TITULOS_ABERTOS__;
    if (!Array.isArray(lista)) {
      return { estado: 'verificando', disponivel: false, mensagem: 'Aguardando a leitura dos títulos em aberto…' };
    }
    if (lista.length === 0) {
      return { estado: 'sem-titulos', disponivel: false, mensagem: 'Não há títulos em aberto nesta empresa.' };
    }
    return { estado: 'disponivel', disponivel: true, mensagem: 'Emitir a 2ª via de títulos no Systextil.' };
  }

  function atualizarDisponibilidade() {
    const el = document.getElementById(CONFIG.ID_BOTAO);
    const status = document.getElementById(CONFIG.ID_STATUS_BARRA);
    if (!el || !status) return;
    const avaliacao = avaliarDisponibilidade();
    el.disabled = !avaliacao.disponivel;
    el.dataset.estado = avaliacao.estado;
    el.title = avaliacao.mensagem;
    el.setAttribute('aria-label', 'Preparar 2ª via no Systextil. ' + avaliacao.mensagem);
    const mensagemStatus = avaliacao.disponivel ? '' : avaliacao.mensagem;
    if (status.textContent !== mensagemStatus) status.textContent = mensagemStatus;
    status.hidden = avaliacao.disponivel;
  }

  function agendarAtualizacaoDisponibilidade() {
    if (timerDisponibilidade) window.clearTimeout(timerDisponibilidade);
    timerDisponibilidade = window.setTimeout(() => {
      timerDisponibilidade = null;
      atualizarDisponibilidade();
    }, 120);
  }

  function referenciaDaTabela() {
    const raizTabela = document.getElementById('tabela-titulos-ds');
    if (!raizTabela) return null;
    // No CRM, #tabela-titulos-ds pode ser o contêiner da SmartTable, não a <table> em si. Ancorar no primeiro elemento interno
    // mantém a ação dentro do card de títulos, inclusive quando a tabela é criada depois do contêiner.
    return raizTabela.matches('table') ? raizTabela : raizTabela.querySelector('table') || raizTabela.firstElementChild || raizTabela;
  }

  function instalarBotao() {
    if (!document.body) return false;
    const referencia = referenciaDaTabela();
    if (!referencia || !referencia.parentElement) return false;

    let barra = document.getElementById(CONFIG.ID_BARRA);
    if (!barra) {
      const el = no('button', CLASSES.botaoDoCartao, null, [icone(CLASSES.iconeDoBotao, CAMINHO_DOCUMENTO), document.createTextNode('Preparar 2ª via')]);
      el.id = CONFIG.ID_BOTAO;
      el.type = 'button';
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-expanded', modalEl ? 'true' : 'false');
      el.addEventListener('click', abrirModal);
      const status = no('span', CLASSES.apagado);
      status.id = CONFIG.ID_STATUS_BARRA;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      barra = no('div', CLASSES.linha, null, [el, status], { padding: '8px 0' });
      barra.id = CONFIG.ID_BARRA;
    }

    if (!barra.isConnected || barra.nextElementSibling !== referencia) {
      referencia.insertAdjacentElement('beforebegin', barra);
    }
    atualizarDisponibilidade();
    return true;
  }

  function observarInstalacao() {
    instalarBotao();
    if (observerInstalacao || !document.body) return;

    observerInstalacao = new MutationObserver(() => {
      const referencia = referenciaDaTabela();
      if (!referencia) return;
      const barra = document.getElementById(CONFIG.ID_BARRA);
      // Só reconstrói/reancora a barra quando o nó de referência mudou ou o CRM removeu a interface. A disponibilidade é
      // recalculada com debounce.
      if (!barra?.isConnected || barra.nextElementSibling !== referencia) instalarBotao();
      agendarAtualizacaoDisponibilidade();
    });
    observerInstalacao.observe(document.body, { childList: true, subtree: true });

    if (!sondagemInicial) {
      let tentativas = 0;
      sondagemInicial = window.setInterval(() => {
        tentativas += 1;
        instalarBotao();
        if (avaliarDisponibilidade().estado !== 'verificando' || tentativas >= 30) {
          window.clearInterval(sondagemInicial);
          sondagemInicial = null;
        }
      }, 400);
    }
  }

  window.__segundaViaSystextil = Object.freeze({
    estaAberto: () => Boolean(modalEl),
    abrirModal,
    fecharModal,
  });

  window.__smartTableSystextilDebug = Object.freeze({
    CONFIG,
    CLASSES,
    POSICOES_NAO_COBRAR,
    montarLinha,
    coletarTitulosDaEmpresaAtual,
    coletarTitulosDoGrupo,
    coletarTitulosAbertos,
    montarItemDoPedido,
    montarPedidoLote,
    validarCodigo,
    validarCnpj,
    avaliarDisponibilidade,
    atualizarDisponibilidade,
    receberResultado,
    historico,
    ID_BOTAO: CONFIG.ID_BOTAO,
    ID_MODAL: CONFIG.ID_MODAL,
    EVENTO_ENVIAR: CONFIG.EVENTO_ENVIAR,
    EVENTO_RESULTADO: CONFIG.EVENTO_RESULTADO,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observarInstalacao, { once: true });
  } else {
    observarInstalacao();
  }
})();
