/* =========================================================================
 * MÓDULO 43: PLANO DE REGULARIZAÇÃO NA TELA DO CLIENTE — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (18/11/2026): um planejador que leia os títulos vencidos e a vencer do cliente e monte o cronograma de
 * regularização POR GRUPO DE EMPRESAS, para a assistente de cobranças usar na tela do cliente. Decisão do usuário (19/11/2026):
 * tudo dentro do CRM de cobrança (o painel local "CRM Diário" e a ponte saíram) e no PADRÃO DO FRONTEND NATIVO do CRM.
 * Desenho aprovado: botão "Plano" ao lado do "⚠ Alerta" (ou abaixo dele, se o Alerta for flutuante) e atalho Shift+Alt+P; o plano é
 * lido SÓ quando se abre, não no carregamento.
 *
 * PADRÃO NATIVO (rule 3: nada de CSS inventado). Tudo abaixo vem do HTML real, visto nas fixtures de tests/fixtures/: o modal é o do
 * "Registrar Contato" (fundo escurecido com desfoque, cartão branco arredondado, cabeçalho com ícone, título e subtítulo, X para fechar,
 * corpo que rola); a tabela é a dos títulos (`st-scope > st-table-wrap > st-table`, `st-th`, `st-row`, `st-td`, `st-td-mono`); o botão é
 * idêntico ao vizinho do Alerta (o do Responsável financeiro); chips, rótulos e botões usam `pbi-*` e as cores de chip do Tailwind do CRM.
 * Todas as classes ficam em `CLASSES` e `tests/plano-cliente.test.js` confere que cada uma existe em alguma fixture real.
 *
 * As contas são do Módulo 41 e a leitura das empresas do grupo (a página aberta + as de mesma raiz de CNPJ) é do Módulo 42
 * (`coletarGrupoDoCliente`). Este módulo só desenha: DOM seguro (textContent, nunca innerHTML com dado do CRM) e nada é gravado.
 *
 * Carga: depois dos Módulos 12, 41 e 42. Expõe window.__planoCliente.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__planoClienteCarregado) return;
  window.__planoClienteCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Plano do Cliente');

  const CONFIG = Object.freeze({
    ID_BOTAO: 'smarttable-botao-plano-cliente',
    ID_PAINEL: 'smarttable-painel-plano-cliente',
    ID_BOTAO_ALERTA: 'smarttable-botao-alerta-cliente',
    SELETOR_ANCORA: 'button[onclick="abrirModalResponsavel()"]',
    // Abaixo do botão Alerta flutuante (que fica em 96px).
    TOPO_BOTAO_FLUTUANTE: '134px',
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  });

  // Classes NATIVAS do CRM (vistas nas fixtures reais; ver o cabeçalho). Nada aqui foi inventado.
  const CLASSES = Object.freeze({
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
    // Botões
    botaoDoCartao: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition',
    iconeDoBotao: 'w-3.5 h-3.5',
    // Rodapé do modal (o do "Registrar Contato"): faixa cinza com o botão secundário à esquerda e o "Cancelar" à direita.
    rodape: 'flex flex-col sm:flex-row sm:justify-between gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0',
    rodapeDireita: 'flex justify-end gap-3',
    botaoSecundarioComIcone: 'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
    botaoSecundario: 'px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition',
    iconeRodape: 'w-4 h-4',
    // Indicadores e texto
    grade: 'grid grid-cols-1 sm:grid-cols-3 gap-2',
    indicador: 'bg-white border border-gray-200 rounded-xl px-4 py-3',
    indicadorRotulo: 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1',
    indicadorValor: 'text-lg font-semibold text-gray-800',
    // Caixa de bloco (a de "Negociação") e as duas caixas de apoio do modal: a linha de aviso ("Atenção") e a nota cinza ("Fixar mensagem").
    caixa: 'bg-white border border-gray-200 rounded-xl p-4 space-y-4',
    aviso: 'flex items-center gap-1.5 px-2.5 py-2 rounded-lg border-2 border-gray-200 bg-white text-gray-700 text-xs font-medium',
    iconeAviso: 'w-4 h-4 text-yellow-600 flex-shrink-0',
    nota: 'flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg',
    notaTexto: 'text-xs text-gray-700',
    texto: 'text-sm text-gray-700',
    apagado: 'text-xs text-gray-500',
    nomeEmpresa: 'text-sm font-semibold text-gray-800',
    cnpj: 'font-mono text-xs text-gray-500',
    linha: 'flex items-center gap-2 flex-wrap',
    espaco1: 'space-y-1',
    espaco2: 'space-y-2',
    espaco4: 'space-y-4',
    margemTopo: 'mt-2',
    margemEsquerda: 'ml-2',
    negrito: 'font-semibold',
    // Chips
    chipBase: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
    chipAtencao: 'bg-yellow-100 text-yellow-800',
    chipRisco: 'bg-red-100 text-red-800',
    badge: 'pbi-badge',
    badgeNeutro: 'pbi-badge-neutral',
    badgeInfo: 'pbi-badge-info',
    badgeAviso: 'pbi-badge-warning',
    badgePerigo: 'pbi-badge-danger',
    // Chips fora da tabela (não dependem de escopo): os do Tailwind do CRM.
    chipAzul: 'bg-blue-100 text-blue-800',
    chipCinza: 'bg-gray-100 text-gray-800',
    // Aviso de erro (o vermelho dos chips do CRM, em bloco)
    erro: 'bg-red-100 text-red-800 rounded-lg px-3 py-2 text-sm',
    // Tabela dos títulos (st-*)
    // O CRM envolve a tabela de títulos em `.pbi-scope` (as regras `.pbi-badge` e as variáveis de cor vivem sob ele) e, dentro, o `.st-scope`.
    escopoPbi: 'pbi-scope',
    tabelaEscopo: 'st-scope',
    // `st-dense` é a variante compacta da tabela no CSS real (`.st-scope .st-dense .st-th/.st-td`: padding 7x8); a de nove colunas não cabe com o padding cheio.
    tabelaWrap: 'st-table-wrap st-dense',
    tabela: 'st-table',
    th: 'st-th',
    thInterno: 'st-th-inner',
    thRotulo: 'st-th-label',
    tr: 'st-row',
    td: 'st-td',
    tdNumero: 'st-td-mono',
    tdConteudo: 'st-td-content',
  });
  // Variante do `pbi-badge` por fase do título (as do CSS real do CRM): azul = a vencer, amarelo = no prazo de pagamento direto, vermelho = situação que pede atenção do analista.
  const CHIP_DA_FASE = { A_VENCER: 'info', PRAZO_DIRETO: 'aviso', SEM_PROTESTO: 'neutro', INTIMACAO: 'perigo', PROTESTADO: 'perigo', NEGATIVADO: 'perigo', SUSPENSO: 'perigo' };

  // Rótulos de tela (os códigos vêm do Módulo 41).
  const FASES = {
    A_VENCER: 'A vencer', PRAZO_DIRETO: 'No prazo de pagamento direto', INTIMACAO: 'Em intimação: só pelo cartório', PROTESTADO: 'Protestado: pagar direto, sem prazo',
    SEM_PROTESTO: 'Não protestar: pagar direto', NEGATIVADO: 'Negativado: pagar direto', SUSPENSO: 'Cadastro suspenso: caso do analista',
  };
  const CANAIS = { DIRETO: 'Direto à TexCotton', CARTORIO: 'Pelo cartório (+ custas)', ANALISTA: 'Analista' };
  const TIPOS = {
    VENCIMENTO: 'Vencimento', LIMITE_ANTES_DO_CARTORIO: 'Último dia antes do cartório', LIMITE_ANTES_DA_NEGATIVACAO: 'Último dia antes da negativação',
    ULTIMO_DIA_SEM_SUSPENSAO: 'Último dia sem suspensão',
  };
  const ALERTAS = {
    CUSTAS_A_CONFIRMAR: ['atencao', 'Custas de cartório a confirmar'], CADASTRO_SUSPENSO: ['risco', 'Cadastro suspenso'], TITULOS_IGNORADOS: ['atencao', 'Títulos ilegíveis'],
    CALENDARIO_INCOMPLETO: ['atencao', 'Feriados indisponíveis'], MODALIDADE_INDETERMINADA: ['atencao', 'Modalidade indeterminada'],
  };
  const FORA = { 'NAO COBRAR': 'Não cobrar', CARTEIRA: 'Carteira', ACORDO: 'Em acordo', FORA_DO_RELATORIO: 'Fora do relatório' };
  const SEM_DATA = {
    AGUARDANDO_CARTORIO: 'Aguardando o cartório (prazo da intimação não informado pelo CRM)', SEM_PRAZO: 'Sem data-limite: pagar o quanto antes',
    FORA_DO_ESCOPO_ANALISTA: 'Fora do escopo: caso do analista',
  };
  const PASSOS = [['lista', 'Lendo a lista de clientes'], ['titulos', 'Lendo os títulos de cada empresa do grupo'], ['regras', 'Calculando prazos, multa e juros']];
  const RODAPE = 'Valores com multa de 2% e juros de 3% ao mês, proporcionais aos dias de atraso. Título pago inteiro. Custas de cartório e prazo da intimação não são conhecidos e não entram nos números. Nada foi gravado no CRM.';

  let botaoEl = null;
  let painelEl = null;
  let subtituloEl = null;
  let corpoEl = null;
  let focoAnterior = null;
  let estado = novoEstado();

  function novoEstado() {
    return { rodando: false, passos: {}, progresso: null, erro: null, pacote: null, sinal: null };
  }

  /* ---------------------------------------------------------------------
   * FORMATAÇÃO E DOM
   * --------------------------------------------------------------------- */
  const money = (v) => (window.__smartTableUtil?.formatarMoeda?.(v) ?? String(v)).replace(/ /g, ' ');
  function dataBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  }
  const cnpjDaPagina = () => {
    try { return new URLSearchParams(window.location.search).get('cnpj') || ''; } catch { return ''; }
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

  // Ícones no traço do CRM (inline, currentColor, 24x24, como os do modal nativo); `caminho` é só o desenho.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CAMINHO_CALENDARIO = 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z';
  const CAMINHO_X = 'M6 18L18 6M6 6l12 12';
  const CAMINHO_ATUALIZAR = 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15';
  const CAMINHO_AVISO = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
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

  const apagado = (texto) => no('p', CLASSES.apagado, texto);
  /** Uma seção do corpo: rótulo no estilo dos rótulos do modal nativo e o conteúdo (o `space-y-4` do corpo separa as seções). */
  const secao = (titulo, filhos) => no('section', null, null, [no('p', CLASSES.rotulo, titulo), ...filhos]);
  const chip = (texto, nivel) => no('span', `${CLASSES.chipBase} ${nivel === 'risco' ? CLASSES.chipRisco : CLASSES.chipAtencao}`, texto);
  const VARIANTE_BADGE = { info: 'badgeInfo', aviso: 'badgeAviso', neutro: 'badgeNeutro', perigo: 'badgePerigo' };
  /** O chip da fase DENTRO da tabela: `pbi-badge` + a variante (só funciona sob `.pbi-scope`, que a tabela traz). */
  function chipDaFase(fase, texto) {
    return no('span', `${CLASSES.badge} ${CLASSES[VARIANTE_BADGE[CHIP_DA_FASE[fase] || 'neutro']]}`, texto);
  }

  /**
   * Tabela no padrão nativo dos títulos (`st-scope > st-table-wrap > st-table`). `colunas` = [{t, num}]; cada célula é texto,
   * `{texto, forte}` (o negrito do título e do valor, como no CRM) ou `{no}` (um elemento já montado). Números em fonte mono, à direita.
   */
  function tabela(colunas, linhas, nome) {
    const alinhamento = (c) => ({ textAlign: c.num ? 'right' : 'left' });
    const cabecalho = no('tr', null, null, colunas.map((c) => { const th = no('th', CLASSES.th, null, [no('span', CLASSES.thInterno, null, [no('span', CLASSES.thRotulo, c.t)])], alinhamento(c)); th.setAttribute('scope', 'col'); return th; }));
    const corpo = linhas.map((l) => no('tr', CLASSES.tr, null, l.map((v, i) => {
      const c = colunas[i];
      const conteudo = v && typeof v === 'object' && v.no ? v.no : no('span', null, v && typeof v === 'object' ? v.texto : String(v), null, v && v.forte ? { fontWeight: '600', color: 'var(--text-heading)' } : null);
      return no('td', c.num ? `${CLASSES.td} ${CLASSES.tdNumero}` : CLASSES.td, null, [no('span', CLASSES.tdConteudo, null, [conteudo])], alinhamento(c));
    })));
    const t = no('table', CLASSES.tabela, null, [no('thead', null, null, [cabecalho]), no('tbody', null, null, corpo)]);
    if (nome) t.setAttribute('aria-label', nome); // nome da tabela para leitor de tela (a classe sr-only não existe no CSS do CRM)
    return no('div', CLASSES.escopoPbi, null, [no('div', CLASSES.tabelaEscopo, null, [no('div', CLASSES.tabelaWrap, null, [t], { overflowX: 'auto' })])], { background: 'white' });
  }

  /* ---------------------------------------------------------------------
   * CONTEÚDO DO PLANO
   * --------------------------------------------------------------------- */
  function cartoes(resumo) {
    const dados = [['Vencido hoje', money(resumo.totalVencidoHoje)], ['A vencer', money(resumo.totalAVencer)], ['Custo de esperar 1 dia', money(resumo.custoPorDia)]];
    return no('div', CLASSES.grade, null, dados.map(([rotulo, valor]) => no('div', CLASSES.indicador, null, [no('p', CLASSES.indicadorRotulo, rotulo), no('p', CLASSES.indicadorValor, valor)])));
  }
  /**
   * A próxima data-limite do grupo, na caixa da linha "Atenção" do modal nativo: é o que o operador mais precisa ver (quando vence o prazo e quanto custa
   * pagar nesse dia). Texto corrido com a data e o valor em negrito, sem pontos médios; sem data pela frente, diz isso.
   */
  function proximaDataLimite(m) {
    const icon = icone(CLASSES.iconeAviso, CAMINHO_CALENDARIO);
    if (!m) return no('div', CLASSES.aviso, null, [icon, no('span', null, 'Nenhuma data-limite pela frente neste grupo.')]);
    const texto = no('span', null, null, [
      document.createTextNode('Próxima data-limite: '), no('span', CLASSES.negrito, dataBr(m.data)),
      document.createTextNode(`, ${(TIPOS[m.tipo] || m.tipo).toLowerCase()}. Valor nesse dia: `), no('span', CLASSES.negrito, money(m.valorNaData)),
    ]);
    return no('div', CLASSES.aviso, null, [icon, texto]);
  }
  function tagsDoGrupo(grupo) {
    const vistos = new Set();
    const tags = [];
    grupo.empresas.forEach((e) => (e.alertas || []).forEach((a) => {
      if (vistos.has(a.codigo)) return;
      vistos.add(a.codigo);
      const [nivel, texto] = ALERTAS[a.codigo] || ['atencao', a.codigo];
      tags.push(chip(texto, nivel));
    }));
    return tags;
  }
  function blocoDaEmpresa(e) {
    const modalidade = e.fluxo === 'SCPC' ? 'SCPC' : 'Cartório';
    const filhos = [no('div', CLASSES.linha, null, [
      no('span', CLASSES.nomeEmpresa, e.nome || 'Empresa'), no('span', CLASSES.cnpj, e.cnpj),
      no('span', `${CLASSES.chipBase} ${e.fluxo === 'SCPC' ? CLASSES.chipAzul : CLASSES.chipCinza}`, modalidade),
    ])];
    if (e.titulos.length) {
      filhos.push(tabela(
        // "Devido hoje" logo depois dos dias: em tela estreita a tabela rola na horizontal (nowrap, como no CRM) e o número que importa não pode ficar escondido.
        [{ t: 'Título' }, { t: 'Situação' }, { t: 'Como pagar' }, { t: 'Vencimento' }, { t: 'Dias', num: true }, { t: 'Devido hoje', num: true }, { t: 'Principal', num: true }, { t: 'Multa', num: true }, { t: 'Juros', num: true }],
        e.titulos.map((t) => [{ texto: t.id, forte: true }, { no: chipDaFase(t.fase, FASES[t.fase] || t.fase) }, (CANAIS[t.canal] || t.canal) + (t.custasAConfirmar && t.canal !== 'CARTORIO' ? ' (+ custas a confirmar)' : ''),
          dataBr(t.vencimento), String(t.diasAtraso), { texto: money(t.valorHoje), forte: true }, money(t.principal), money(t.multa), money(t.juros)]),
        `Títulos de ${e.nome || e.cnpj}`,
      ));
    }
    (e.semData || []).forEach((s) => filhos.push(apagado(`${s.id}: ${SEM_DATA[s.motivo] || s.motivo}`)));
    (e.foraDoPlano || []).forEach((f) => filhos.push(apagado(`${f.id}: fora do plano (${FORA[f.motivo] || f.motivo})`)));
    (e.alertas || []).forEach((a) => filhos.push(no('div', CLASSES.aviso, null, [icone(CLASSES.iconeAviso, CAMINHO_AVISO), no('span', null, a.texto)])));
    return no('div', CLASSES.caixa, null, filhos);
  }
  function cronograma(grupo) {
    if (!grupo.cronograma.length) return null;
    const varias = grupo.empresas.length > 1;
    const nomeDe = (id) => (grupo.empresas.find((e) => e.cnpj === id)?.nome || '');
    return secao('Cronograma de datas-limite', [tabela(
      [{ t: 'Data' }, { t: 'O que acontece' }, { t: 'Título' }, { t: 'Como pagar' }, { t: 'Valor nessa data', num: true }],
      grupo.cronograma.map((c) => [dataBr(c.data), TIPOS[c.tipo] || c.tipo, varias && nomeDe(c.empresaId) ? { no: no('span', null, null, [no('span', `${CLASSES.negrito}`, c.tituloId), no('span', `${CLASSES.apagado} ${CLASSES.margemEsquerda}`, nomeDe(c.empresaId))]) } : { texto: c.tituloId, forte: true }, CANAIS[c.canal] || c.canal, money(c.valorNaData)]),
      'Cronograma de datas-limite',
    )]);
  }
  function conteudoDoPlano(pacote) {
    const g = pacote.grupo;
    const blocos = [];
    if (g.vazio) {
      blocos.push(secao(`Resumo em ${dataBr(pacote.hoje)}`, [no('p', CLASSES.texto, 'Nenhum título vencido ou a vencer encontrado para este grupo.')]));
    } else {
      blocos.push(secao(`Resumo em ${dataBr(pacote.hoje)}`, [proximaDataLimite(g.resumo.proximoMarco), no('div', `${CLASSES.margemTopo}`, null, [cartoes(g.resumo)]), no('div', `${CLASSES.linha} ${CLASSES.margemTopo}`, null, tagsDoGrupo(g))]));
      blocos.push(secao(`Empresas do grupo (${g.empresas.length})`, [no('div', CLASSES.espaco4, null, g.empresas.map(blocoDaEmpresa))]));
      blocos.push(cronograma(g));
    }
    if (pacote.falhas.length) {
      blocos.push(secao(`Empresas do grupo que não puderam ser lidas (${pacote.falhas.length})`, [
        apagado('Ficam fora do plano para não montar nada com dado pela metade. Use "Atualizar" para tentar de novo.'),
        tabela([{ t: 'CNPJ' }, { t: 'Motivo' }], pacote.falhas.map((f) => [f.cnpj, f.motivo]), 'Empresas do grupo que não puderam ser lidas'),
      ]));
    }
    blocos.push(secao('Como ler este plano', [no('div', CLASSES.nota, null, [no('p', CLASSES.notaTexto, RODAPE)])]));
    return blocos.filter(Boolean);
  }
  function conteudoDoAndamento() {
    const itens = PASSOS.map(([id, rotulo]) => {
      const p = estado.passos[id] || { estado: 'espera', texto: '' };
      const icone = p.estado === 'ok' ? '✓' : p.estado === 'erro' ? '!' : p.estado === 'andamento' ? '…' : '·';
      // Uma linha por passo: o texto que o Módulo 42 manda (o que está lendo, ou o que achou) ou, enquanto o passo não começou, o nome dele.
      const texto = p.estado === 'espera' ? rotulo : (p.texto || rotulo);
      return no('li', p.estado === 'erro' ? `${CLASSES.texto} ${CLASSES.chipRisco}` : CLASSES.texto, `${icone} ${texto}`, null, { listStyle: 'none' });
    });
    const pr = estado.progresso;
    const barra = pr && pr.total ? apagado(`Empresas lidas: ${pr.feito} de ${pr.total}${pr.falhas ? ` (${pr.falhas} com falha)` : ''}`) : null;
    return [secao('Montando o plano', [no('ol', CLASSES.espaco1, null, itens, { margin: 0, padding: 0 }), barra])];
  }

  function render() {
    if (!corpoEl) return;
    const filhos = [];
    if (estado.erro) {
      const aviso = no('div', CLASSES.erro, null, [no('strong', null, 'Não foi possível montar o plano. '), document.createTextNode(`${estado.erro} Use Atualizar para tentar de novo.`)]);
      aviso.setAttribute('role', 'alert');
      filhos.push(aviso);
    }
    if (estado.rodando) filhos.push(...conteudoDoAndamento());
    else if (estado.pacote) filhos.push(...conteudoDoPlano(estado.pacote));
    corpoEl.replaceChildren(...filhos);
    if (subtituloEl) {
      const g = estado.pacote?.grupo;
      subtituloEl.textContent = g ? (g.nome || 'Grupo') : '';
    }
    const botaoAtualizar = painelEl?.querySelector('[data-acao="atualizar"]');
    if (botaoAtualizar) botaoAtualizar.disabled = estado.rodando;
  }

  /* ---------------------------------------------------------------------
   * LEITURA (Módulo 42)
   * --------------------------------------------------------------------- */
  async function carregar() {
    if (estado.rodando) return;
    const coletor = window.__planoCarteira?.coletarGrupoDoCliente;
    if (typeof coletor !== 'function') {
      estado = { ...novoEstado(), erro: 'O SmartTable desta aba não tem o coletor do plano (Módulos 41 e 42). Atualize o SmartTable e recarregue a página.' };
      render();
      return;
    }
    const sinal = { aborted: false };
    estado = { ...novoEstado(), rodando: true, sinal };
    render();
    try {
      const pacote = await coletor({
        sinal,
        onEvento: (e) => {
          if (sinal.aborted) return;
          if (e.tipo === 'etapa') estado.passos[e.id] = { estado: e.estado, texto: e.texto || '' };
          else if (e.tipo === 'progresso') estado.progresso = { feito: e.feito, total: e.total, falhas: e.falhas };
          render();
        },
      });
      if (sinal.aborted) return;
      estado = { ...novoEstado(), pacote };
    } catch (erro) {
      if (sinal.aborted) return;
      // Só a mensagem (já escrita sem dado de cliente pelo Módulo 42); nada com nome ou valor vai para o console.
      console.warn('[Plano do Cliente] Não consegui montar o plano.', erro?.name);
      estado = { ...novoEstado(), erro: String(erro?.message || 'Erro desconhecido.').slice(0, 200) };
    }
    render();
  }

  /* ---------------------------------------------------------------------
   * PAINEL (o modal nativo)
   * --------------------------------------------------------------------- */
  function abrirPainel() {
    if (painelEl) return;
    window.__smartTableUtil?.fecharOutrosPaineis?.('planoCliente');
    focoAnterior = document.activeElement;
    const tituloEl = no('h3', CLASSES.titulo, 'Plano de regularização');
    tituloEl.id = `${CONFIG.ID_PAINEL}-titulo`;
    subtituloEl = no('p', CLASSES.subtitulo, '');
    const esquerda = no('div', CLASSES.topoEsquerda, null, [no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone, CAMINHO_CALENDARIO)]), no('div', null, null, [tituloEl, subtituloEl])]);
    const fechar = no('button', CLASSES.fechar, null, [icone(CLASSES.iconeFechar, CAMINHO_X)]);
    fechar.type = 'button';
    fechar.dataset.acao = 'fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.addEventListener('click', fecharPainel);
    const topo = no('div', CLASSES.topo, null, [esquerda, fechar]);
    corpoEl = no('div', CLASSES.corpo);
    corpoEl.setAttribute('aria-live', 'polite');
    // Rodapé como o do "Registrar Contato": o botão secundário à esquerda ("Abrir WhatsApp" lá, "Atualizar" aqui) e o "Cancelar" ("Fechar" aqui) à direita.
    const atualizar = no('button', CLASSES.botaoSecundarioComIcone, null, [icone(CLASSES.iconeRodape, CAMINHO_ATUALIZAR), document.createTextNode('Atualizar')]);
    atualizar.type = 'button';
    atualizar.dataset.acao = 'atualizar';
    atualizar.addEventListener('click', () => { estado.pacote = null; carregar(); });
    const fecharRodape = no('button', CLASSES.botaoSecundario, 'Fechar');
    fecharRodape.type = 'button';
    fecharRodape.dataset.acao = 'fechar-rodape';
    fecharRodape.addEventListener('click', fecharPainel);
    const rodape = no('div', CLASSES.rodape, null, [atualizar, no('div', CLASSES.rodapeDireita, null, [fecharRodape])]);
    // O fundo escurecido É o painel (id, role e fechar-ao-clicar-fora), como nos modais do CRM; só a camada vem do Módulo 0 (acima do cabeçalho e do menu).
    painelEl = no('div', CLASSES.fundo, null, [no('div', CLASSES.cartao, null, [topo, corpoEl, rodape])], { zIndex: CONFIG.Z_INDEX_POPUP });
    painelEl.id = CONFIG.ID_PAINEL;
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-modal', 'true');
    painelEl.setAttribute('aria-labelledby', tituloEl.id);
    painelEl.addEventListener('click', (evento) => { if (evento.target === painelEl) fecharPainel(); });
    document.body.appendChild(painelEl);
    botaoEl?.setAttribute('aria-expanded', 'true');
    painelEl.tabIndex = -1;
    painelEl.focus(); // o foco inicial é o próprio diálogo (padrão de modal acessível); o primeiro Tab chega ao X
    if (estado.pacote) render();
    else carregar();
  }

  function fecharPainel() {
    if (!painelEl) return;
    if (estado.sinal) estado.sinal.aborted = true;
    estado = novoEstado();
    painelEl.remove();
    painelEl = null;
    corpoEl = null;
    subtituloEl = null;
    botaoEl?.setAttribute('aria-expanded', 'false');
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) focoAnterior.focus();
    focoAnterior = null;
  }

  const alternarPainel = () => (painelEl ? fecharPainel() : abrirPainel());

  /* ---------------------------------------------------------------------
   * BOTÃO E ATALHO
   * --------------------------------------------------------------------- */
  function criarBotao() {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = CONFIG.ID_BOTAO;
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false');
    el.title = 'Plano de regularização do grupo (Shift+Alt+P)';

    const alerta = document.getElementById(CONFIG.ID_BOTAO_ALERTA);
    const ancora = alerta || document.querySelector(CONFIG.SELETOR_ANCORA);
    const alertaFlutuante = alerta && alerta.style.position === 'fixed';
    if (ancora && !alertaFlutuante) {
      // No cartão do cliente, ao lado do Alerta, com as MESMAS classes do botão vizinho (o do Responsável financeiro) e o mesmo traço de ícone.
      el.className = CLASSES.botaoDoCartao;
      el.appendChild(icone(CLASSES.iconeDoBotao, CAMINHO_CALENDARIO));
      el.appendChild(document.createTextNode('Plano'));
      ancora.insertAdjacentElement('afterend', el);
    } else {
      el.textContent = 'Plano';
      Object.assign(el.style, {
        position: 'fixed', top: CONFIG.TOPO_BOTAO_FLUTUANTE, left: '16px', background: '#16232F', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px',
        fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', zIndex: alerta?.style.zIndex || '', // a mesma camada baixa do Alerta (botão fixo, abaixo do cabeçalho do CRM); só o painel usa a dos popups
      });
      document.body.appendChild(el);
      window.__smartTableUtil?.acompanharMenuLateral?.(el);
    }
    el.addEventListener('click', alternarPainel);
    return el;
  }

  /** Tab fica dentro do modal (aria-modal): circula entre os botões dele. */
  function prenderTab(evento) {
    const botoes = [...painelEl.querySelectorAll('button:not([disabled])')];
    if (!botoes.length) { evento.preventDefault(); return; }
    const primeiro = botoes[0];
    const ultimo = botoes[botoes.length - 1];
    const atual = document.activeElement;
    // O foco inicial é o próprio diálogo: Tab vai ao primeiro botão e Shift+Tab ao último (nunca sai do modal).
    if (atual === painelEl || !painelEl.contains(atual)) { evento.preventDefault(); (atual === painelEl && evento.shiftKey ? ultimo : primeiro).focus(); return; }
    if (evento.shiftKey && atual === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && atual === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }

  function aoTeclar(evento) {
    if (painelEl && evento.code === 'Escape') {
      fecharPainel();
      return;
    }
    if (painelEl && evento.code === 'Tab' && !evento.altKey && !evento.ctrlKey && !evento.metaKey) {
      prenderTab(evento);
      return;
    }
    if (!evento.altKey || !evento.shiftKey || evento.ctrlKey || evento.metaKey || evento.repeat || evento.code !== 'KeyP') return;
    if (window.__editorMensagens?.estaAberto?.() || window.__promessaRapida?.estaAberto?.()) return;
    if (!painelEl && window.__atalhosDom?.estaDigitando?.()) return;
    if (!cnpjDaPagina()) return; // só na tela do cliente
    evento.preventDefault();
    alternarPainel();
  }

  function aoCarregar() {
    if (!cnpjDaPagina()) return; // só faz sentido na página do cliente
    if (document.getElementById(CONFIG.ID_BOTAO)) return; // idempotente: um segundo DOMContentLoaded não duplica o botão
    botaoEl = criarBotao();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aoCarregar);
  else aoCarregar();
  document.addEventListener('keydown', aoTeclar);
  window.__smartTableUtil?.registrarPainel?.('planoCliente', fecharPainel);

  window.__planoCliente = {
    CONFIG,
    CLASSES,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    carregar,
    estaAberto: () => painelEl !== null,
  };
})();
