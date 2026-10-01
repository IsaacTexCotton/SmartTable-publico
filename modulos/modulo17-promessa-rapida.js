/* =========================================================================
 * MÓDULO 17: PROMESSA RÁPIDA (Alt+N) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Painel central para registrar promessa de pagamento: escolhe títulos e data,
 * preenche o modal "Registrar Contato" do CRM e salva pelo botão dele.
 * Expõe window.__promessaRapida. Lê do Módulo 1 (window.__avisoCobranca.simular),
 * do Módulo 6 (__contextoAdicionalDebug.lerPromessas, __contextoAdicional) e do
 * util (__smartTableUtil). Sem eles, degrada sem quebrar.
 *
 * DECISÕES DO USUÁRIO (não mude sem perguntar):
 *   - O CRM continua sendo quem grava: liga títulos à promessa, calcula juros e
 *     multa e valida. Gravar direto pela API foi descartado: promessa aceita SEM
 *     títulos some da fila em silêncio (o Módulo 6 só considera promessa com
 *     título ainda aberto).
 *   - Nenhum título vem marcado, salvo quando só existe UM vencido. Marcar todos
 *     por padrão viraria cobrança de "pagamento parcial" pra quem pagou o combinado.
 *   - Sem data padrão: H (hoje), A (amanhã) ou outra. Sem data, não registra.
 *   - Conflito com outra promessa, títulos de mais de uma razão (uma promessa por
 *     razão) ou qualquer "Confirmar ação" do CRM: o atalho PARA e devolve o modal
 *     ao operador. Nunca encerra promessa de ninguém sozinho.
 *   - Depois de salvar, CONFERE na aba Promessas (data e títulos): aviso verde se
 *     apareceu, vermelho se não (ou se o CRM mostrar "Promessa não criada"). Nunca
 *     silêncio. Se a página recarregar, a conferência continua via ponte em
 *     localStorage (só CNPJ, títulos e data).
 *   - Não conta como cobrança enviada no progresso da fila (o Módulo 3 conta o
 *     Registrar e Enviar, não o "Salvar Contato").
 *
 * REGRA DO CARTÓRIO (texto e visual aprovados pelo usuário): não registra promessa
 * para título que, NA DATA ESCOLHIDA, já estará em cartório: data >= dataEncaminhamento
 * (Módulo 1) ou título já em cartório. Aviso vermelho com a data máxima E botão
 * travado. Não vale para cliente SCPC nem para posição "NAO PROTESTAR". Só cobre
 * este painel: o campo de data do CRM e os botões do Módulo 2 ficam de fora.
 *
 * TELA DO CRM (confirmada no HTML real):
 *   - Lista pronta com o modal fechado: #lista-titulos-promessa > .titulo-item-promessa,
 *     com input.titulo-checkbox-contato-promessa[value="915249/2"][data-atraso]
 *     [data-vencimento][data-cnpj][data-razao]. Títulos de outras razões do grupo têm
 *     .titulo-outra-razao e ficam escondidos até marcar #check-grupo-contato-promessa.
 *   - #btn-resultado-PROMESSA_PAGAMENTO abre #secao-promessa; #input-data-promessa
 *     (onchange recalcula) e #input-valor-promessa (preenchido pelo CRM);
 *     #select-forma-pagamento-contato (BOLETO por padrão); #conflitos-promessa-aviso;
 *     #valores-por-razao-wrap/-erro; #btn-salvar-contato (submit do POST /crm/contatos).
 *   - Falha: #modal-aviso-promessa ("Promessa não criada"; texto em
 *     #modal-aviso-promessa-mensagem).
 *
 * PAINEL (visual aprovado pelo usuário): diálogo central; o fundo cobre só a área
 * abaixo do cabeçalho do CRM e fica na camada dos popups (Módulo 0, z-55 desde a
 * v1.69.1: cobre o menu lateral z-40 e o menu dos atalhos). Teclas: 1-9, H, A, D, T, Enter, Esc. O Tab fica preso no painel e, se o
 * foco cair no body, o painel reassume (senão 1, A e Enter morrem).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__promessaRapidaCarregado) return;
  window.__promessaRapidaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Promessa Rápida');

  const CONFIG_PROMESSA = {
    ID_PAINEL: 'smarttable-painel-promessa',
    ID_FUNDO: 'smarttable-fundo-promessa',
    // Cabeçalho do CRM (confirmado): header#sit-header, fixo, ~80px, z-50.
    ID_CABECALHO: 'sit-header',
    ALTURA_CABECALHO_PADRAO: 80,
    LARGURA_PAINEL: 560,
    // Ponte pro reload: { cnpj, titulos, data, criadoEm }. Só isso.
    CHAVE_PONTE: 'smarttable_promessa_pendente_v1',
    VALIDADE_PONTE_MS: 3 * 60 * 1000,
    // Camada dos popups nossos: acima do menu dos atalhos e do cabeçalho do CRM (ver Módulo 0).
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
    // Esperas pelo CRM: modal, seção de promessa, valor calculado, resultado do salvar.
    TIMEOUT_MODAL_MS: 5000,
    TIMEOUT_VALOR_MS: 5000,
    TIMEOUT_RESULTADO_MS: 12000,
    TIMEOUT_CONFERENCIA_MS: 6000,
    INTERVALO_MS: 100,
    // A mesma frase das "Frases padrão" do CRM e do botão 📅 do Módulo 2.
    FRASE_OBSERVACAO: 'Cliente agendou o pagamento.',
    MAX_NUMERADOS: 9,
  };

  const SEL = {
    LISTA: '#lista-titulos-promessa',
    CHECK: '.titulo-checkbox-contato-promessa',
    LINHA: '.titulo-item-promessa',
    OUTRA_RAZAO: 'titulo-outra-razao',
    CHECK_GRUPO: '#check-grupo-contato-promessa',
    MODAL: '#modal-contato',
    ABRIR_CONTATO: 'openModalContato',
    RESULTADO_PROMESSA: '#btn-resultado-PROMESSA_PAGAMENTO',
    SECAO: '#secao-promessa',
    DATA: '#input-data-promessa',
    VALOR: '#input-valor-promessa',
    QTD: '#contato-promessa-qtd',
    FORMA: '#select-forma-pagamento-contato',
    RESUMO: '#contato-resumo',
    SALVAR: '#btn-salvar-contato',
    CONFLITO: '#conflitos-promessa-aviso',
    ERRO_RAZAO: '#valores-por-razao-erro',
    AVISO_NAO_CRIADA: '#modal-aviso-promessa',
    AVISO_NAO_CRIADA_MSG: '#modal-aviso-promessa-mensagem',
    CONFIRMAR_ACAO: '#modal-confirmar-acao',
  };

  const CORES = {
    tinta: '#16232F', texto: '#344054', apagado: '#98a2b3', borda: '#d0d5dd', fundo: '#ffffff',
    marca: '#1f5f8b', fundoMarca: '#eef4f9', alerta: '#B45309', fundoAlerta: '#FEF3E2',
    ok: '#1B6B4A', fundoOk: '#EFF6F1', perigo: '#B42318', fundoPerigo: '#FDF3F1',
  };
  const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  let painelEl = null;
  let fundoEl = null;
  let focoAnterior = null;
  let registrando = false;

  /* ---------------------------------------------------------------------
   * 1. UTILIDADES
   * --------------------------------------------------------------------- */
  function el(tag, props = {}, estilo = {}) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    Object.assign(e.style, estilo);
    return e;
  }

  function visivel(e) {
    if (!e || !e.isConnected) return false;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      if (x.hidden || x.classList.contains('hidden')) return false;
      const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function esperarAte(condicao, timeoutMs) {
    return new Promise((resolve) => {
      const prazo = Date.now() + timeoutMs;
      (function tentar() {
        let r = null;
        try { r = condicao(); } catch (_) { r = null; }
        if (r) return resolve(r);
        if (Date.now() >= prazo) return resolve(null);
        setTimeout(tentar, CONFIG_PROMESSA.INTERVALO_MS);
      })();
    });
  }

  const hojeIso = (agora = new Date()) => window.__smartTableUtil.dataIso(agora);

  function dataDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }
  const isoMaisDias = (iso, dias) => { const d = dataDeIso(iso); d.setDate(d.getDate() + dias); return hojeIso(d); };
  const dataBr = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
  const dataCurta = (iso) => window.__smartTableUtil.dataCurtaDeIso(iso);

  /** "hoje, 25/09", "amanhã, 26/09" ou "seg, 28/09". */
  function rotuloDaData(iso, agora = new Date()) {
    const hoje = hojeIso(agora);
    if (iso === hoje) return `hoje, ${dataCurta(iso)}`;
    if (iso === isoMaisDias(hoje, 1)) return `amanhã, ${dataCurta(iso)}`;
    return `${DIAS_SEMANA[dataDeIso(iso).getDay()]}, ${dataCurta(iso)}`;
  }

  /** Hoje, amanhã e os três dias úteis (seg a sex) seguintes. */
  function datasSugeridas(agora = new Date()) {
    const hoje = hojeIso(agora);
    const lista = [hoje, isoMaisDias(hoje, 1)];
    let d = isoMaisDias(hoje, 1);
    while (lista.length < 5) {
      d = isoMaisDias(d, 1);
      const dia = dataDeIso(d).getDay();
      if (dia !== 0 && dia !== 6) lista.push(d);
    }
    return lista;
  }

  function cnpjDaUrl() {
    try { return new URL(location.href).searchParams.get('cnpj') || ''; } catch (_) { return ''; }
  }

  /* ---------------------------------------------------------------------
   * 1b. REGRA DO CARTÓRIO (ver o cabeçalho): dados do Módulo 1 da própria página
   * --------------------------------------------------------------------- */
  const ehNaoProtestar = (posicao) => /NAO\s+PROTESTAR/.test(String(posicao ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
  const isoDeData = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? hojeIso(d) : null);

  /** O que o Módulo 1 sabe desta página (títulos com situação e prazos), ou null sem ele. */
  function lerDadosDeCobranca() {
    try {
      return window.__avisoCobranca?.simular?.() ?? null;
    } catch (erro) {
      console.warn('[Promessa Rápida] Não consegui ler a situação dos títulos (regra do cartório desligada nesta leitura):', erro?.name);
      return null;
    }
  }

  /**
   * Títulos marcados que, na data escolhida, estarão em cartório.
   *
   * @param {string[]} valores  títulos marcados ("915249/2")
   * @param {string|null} iso   data escolhida (AAAA-MM-DD); sem data só pega quem já está em cartório
   * @param {object|null} dados retorno do simular() do Módulo 1
   * @returns {{valor: string, motivo: 'ja'|'data', encaminhamentoIso: string|null, ultimoDiaIso: string|null}[]}
   */
  function avaliarCartorioDaPromessa(valores, iso, dados) {
    if (!dados || dados.fluxo === 'SCPC') return [];
    const todos = [...(dados.registros ?? []), ...(dados.foraDoRelatorio ?? []), ...(dados.naoCobrar ?? [])];
    const porTitulo = new Map(todos.map((r) => [String(r.tituloCompleto), r]));
    const bloqueados = [];
    for (const valor of valores) {
      const r = porTitulo.get(String(valor));
      if (!r || ehNaoProtestar(r.posicao)) continue;
      const encaminhamentoIso = isoDeData(r.prazos?.dataEncaminhamento);
      const ultimoDiaIso = isoDeData(r.prazos?.dataLimitePagamento);
      if (r.situacaoKey === 'EM_CARTORIO') bloqueados.push({ valor, motivo: 'ja', encaminhamentoIso, ultimoDiaIso });
      else if (iso && encaminhamentoIso && iso >= encaminhamentoIso) bloqueados.push({ valor, motivo: 'data', encaminhamentoIso, ultimoDiaIso });
    }
    return bloqueados;
  }

  /** As frases do aviso vermelho (no máximo 3 títulos, depois "+N"). */
  function frasesDoBloqueio(bloqueios) {
    const linhas = bloqueios.slice(0, 3).map((b) => (b.motivo === 'ja'
      ? `Título ${b.valor} já está em cartório: não dá pra agendar.`
      : `Título ${b.valor} estará em cartório em ${dataBr(b.encaminhamentoIso)}; escolha até ${b.ultimoDiaIso ? dataBr(b.ultimoDiaIso) : 'o último dia para pagamento'}.`));
    if (bloqueios.length > 3) linhas.push(`+ ${bloqueios.length - 3} título(s) na mesma situação.`);
    linhas.push('Desmarque o título ou escolha outra data.');
    return linhas;
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA DA LISTA DO CRM (sem abrir o modal)
   * --------------------------------------------------------------------- */
  function titulosDaPromessaPendente() {
    // Títulos já em promessa PENDENTE (Módulo 6). Só informativo: o conflito é decidido pelo CRM.
    const mapa = new Map();
    try {
      const promessas = window.__contextoAdicionalDebug?.lerPromessas?.() || [];
      promessas.filter((p) => p.status === 'PENDENTE').forEach((p) => {
        (p.titulos || []).forEach((t) => mapa.set(String(t).replace('-', '/'), p.dataPrometidaTexto));
      });
    } catch (_) { /* sem o Módulo 6, sem a marca */ }
    return mapa;
  }

  /**
   * Títulos da lista de promessa do CRM, na ordem: os da razão do cliente
   * antes dos de outras razões do grupo; dentro de cada uma, vencidos (mais
   * dias primeiro) e depois os que ainda vão vencer. A numeração do painel
   * segue esta ordem -- e o separador "Outras razões do grupo" só funciona
   * se o grupo vier depois, mesmo quando um título dele está mais atrasado.
   */
  function lerTitulos() {
    const lista = document.querySelector(SEL.LISTA);
    if (!lista) return null;
    const emPromessa = titulosDaPromessaPendente();
    const titulos = [...lista.querySelectorAll(SEL.CHECK)].map((cb) => {
      const linha = cb.closest(SEL.LINHA);
      const spans = linha ? [...linha.querySelectorAll('span')] : [];
      const valorTela = spans.map((s) => s.textContent.trim()).reverse().find((t) => /^R\$/.test(t)) || '';
      const situacao = spans.map((s) => s.textContent.trim()).find((t) => /^[A-Z][A-Z ]{3,}$/.test(t) && !/LTDA|EIRELI|\bME\b/.test(t)) || '';
      return {
        valor: cb.value,
        atraso: Number(cb.dataset.atraso) || 0,
        vencimento: cb.dataset.vencimento || '',
        cnpj: cb.dataset.cnpj || '',
        razao: cb.dataset.razao || '',
        outraRazao: !!(linha && linha.classList.contains(SEL.OUTRA_RAZAO)),
        situacao,
        valorTela,
        promessaPendente: emPromessa.get(cb.value) || null,
      };
    });
    return titulos.sort((a, b) => (a.outraRazao - b.outraRazao) || ((b.atraso > 0) - (a.atraso > 0)) ||
      (b.atraso - a.atraso) || a.vencimento.localeCompare(b.vencimento));
  }

  /* ---------------------------------------------------------------------
   * 3. PAINEL
   * --------------------------------------------------------------------- */
  const estado = { titulos: [], marcados: new Set(), data: null, forma: null, mostrarAVencer: false, bloqueios: [] };

  function titulosVisiveis() {
    return estado.titulos.filter((t) => t.atraso > 0 || estado.mostrarAVencer || estado.marcados.has(t.valor));
  }

  /** Fecha o painel e o fundo. Só Esc, X, Cancelar e clique fora devolvem o foco a quem abriu. */
  function fecharPainel({ devolverFoco = false } = {}) {
    if (!painelEl) return;
    fundoEl?.remove();
    painelEl.remove();
    painelEl = null;
    fundoEl = null;
    const volta = focoAnterior;
    focoAnterior = null;
    if (devolverFoco && volta?.isConnected) {
      try { volta.focus({ preventScroll: true }); } catch (_) { /* sem foco a devolver */ }
    }
  }

  /** Recalcula a regra do cartório com o que está marcado e a data escolhida agora. */
  function recalcularBloqueios() {
    estado.bloqueios = estado.marcados.size ? avaliarCartorioDaPromessa([...estado.marcados], estado.data, lerDadosDeCobranca()) : [];
    return estado.bloqueios;
  }

  function podeRegistrar() {
    return estado.marcados.size > 0 && !!estado.data && !registrando && estado.bloqueios.length === 0;
  }

  function resumoConfirmacao() {
    const marcados = estado.titulos.filter((t) => estado.marcados.has(t.valor));
    if (!marcados.length) return 'Marque o(s) título(s) que o cliente prometeu pagar.';
    if (estado.bloqueios.length) return 'Registro bloqueado: veja o aviso em vermelho.';
    if (!estado.data) return 'Escolha a data do pagamento (H, A ou outra).';
    const forma = document.querySelector(`${SEL.FORMA} option[value="${estado.forma}"]`)?.textContent.trim() || estado.forma || '';
    const razoes = new Set(marcados.map((t) => t.cnpj)).size;
    return `${rotuloDaData(estado.data)} · ${marcados.length === 1 ? '1 título' : `${marcados.length} títulos`}: ` +
      `${marcados.map((t) => t.valor).join(', ')}${forma ? ` · ${forma}` : ''}` +
      (razoes > 1 ? ` · ${razoes} razões (o CRM cria uma promessa por razão)` : '');
  }

  /* ---- Peças visuais ---- */
  const ROTULO_POR_POSICAO = { COBRANCA: 'Cobrança', CARTORIO: 'Em cartório', 'NAO PROTESTAR': 'Não protestar' };
  const CHAVE_DA_SITUACAO = {
    EM_ATRASO: 'EM_ATRASO', PRAZO_FINAL: 'EM_ATRASO', ULTIMO_DIA: 'ULTIMO_DIA', EM_CARTORIO: 'EM_CARTORIO',
    NEGATIVADO_SCPC: 'NEGATIVADO_SCPC', SEM_PROTESTO: 'EM_ATRASO', VERIFICAR_POSICAO: 'VERIFICAR_POSICAO',
  };
  const ROTULO_DA_SITUACAO = {
    EM_ATRASO: 'Cobrança', PRAZO_FINAL: 'Cobrança', ULTIMO_DIA: 'Último dia', EM_CARTORIO: 'Em cartório',
    NEGATIVADO_SCPC: 'Negativado', SEM_PROTESTO: 'Não protestar', VERIFICAR_POSICAO: 'Verificar posição',
  };

  const moedaBr = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');

  /** Mesmo índice da regra do cartório: título ("915249/2") -> o que o Módulo 1 sabe dele. */
  function indiceDosTitulos(dados) {
    if (!dados) return new Map();
    const todos = [...(dados.registros ?? []), ...(dados.foraDoRelatorio ?? []), ...(dados.naoCobrar ?? [])];
    return new Map(todos.map((r) => [String(r.tituloCompleto), r]));
  }

  /** Etiqueta de situação: o que o Módulo 1 classificou; sem ele, só os valores confirmados do CRM; o resto, cru. */
  function situacaoParaExibir(t, registro) {
    if (registro) {
      const chave = ehNaoProtestar(registro.posicao) ? 'SEM_PROTESTO' : registro.situacaoKey;
      if (ROTULO_DA_SITUACAO[chave]) return { rotulo: ROTULO_DA_SITUACAO[chave], chave: CHAVE_DA_SITUACAO[chave] };
    }
    const posicao = String(t.situacao ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const rotulo = ROTULO_POR_POSICAO[posicao];
    if (rotulo) return { rotulo, chave: posicao === 'CARTORIO' ? 'EM_CARTORIO' : 'EM_ATRASO' };
    return { rotulo: t.situacao || '', chave: null };
  }

  /** "vai a cartório em 01/10", "já está em cartório" ou "" (SCPC, NAO PROTESTAR, a vencer). */
  function textoDoCartorioNoTitulo(t, registro, dados) {
    if (!dados || t.atraso <= 0) return '';
    if (!registro) return 'cartório: não checado';
    if (dados.fluxo === 'SCPC' || ehNaoProtestar(registro.posicao)) return '';
    if (registro.situacaoKey === 'EM_CARTORIO') return 'já está em cartório';
    const iso = isoDeData(registro.prazos?.dataEncaminhamento);
    return iso ? `vai a cartório em ${dataCurta(iso)}` : '';
  }

  function tecla(texto) {
    return el('kbd', { textContent: texto }, {
      display: 'inline-block', minWidth: '16px', padding: '1px 5px', marginRight: '5px', textAlign: 'center',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', fontWeight: '700', lineHeight: '16px',
      color: CORES.texto, background: '#F2F4F7', border: `1px solid ${CORES.borda}`, borderBottomWidth: '2px', borderRadius: '4px',
    });
  }

  function legendaDaSecao(texto, tecladoDica) {
    const linha = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 6px' });
    linha.appendChild(el('div', { textContent: texto }, { fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em', color: CORES.apagado, textTransform: 'uppercase' }));
    if (tecladoDica) linha.appendChild(el('div', { textContent: tecladoDica }, { fontSize: '11px', color: CORES.apagado }));
    return linha;
  }

  function etiquetaDaSituacao(situacao) {
    const cores = (situacao.chave && window.__avisoCobranca?.situacoes?.[situacao.chave]) || null;
    return el('span', { textContent: situacao.rotulo }, {
      display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
      color: cores?.corTexto ?? CORES.texto, background: cores?.tint ?? '#F2F4F7', border: `1px solid ${cores?.rail ?? CORES.borda}`,
    });
  }

  function desenhar() {
    if (!painelEl) return;
    const corpo = painelEl.querySelector('[data-papel="corpo"]');
    corpo.replaceChildren();

    recalcularBloqueios();
    const dados = lerDadosDeCobranca();
    const indice = indiceDosTitulos(dados);

    // Títulos
    const visiveis = titulosVisiveis();
    corpo.appendChild(legendaDaSecao('Títulos', '1 a 9 marcam e desmarcam'));
    const lista = el('div', {}, { display: 'flex', flexDirection: 'column', gap: '6px' });
    lista.setAttribute('role', 'group');
    lista.setAttribute('aria-label', 'Títulos da promessa');
    if (!visiveis.length) {
      lista.appendChild(el('div', { textContent: 'Nenhum título vencido neste cliente. T mostra os que ainda vão vencer.' }, { fontSize: '13px', color: CORES.apagado }));
    }
    let separouGrupo = false;
    visiveis.forEach((t, i) => {
      if (t.outraRazao && !separouGrupo) {
        separouGrupo = true;
        lista.appendChild(el('div', { textContent: 'Outras razões do grupo' }, { fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em', textTransform: 'uppercase', color: CORES.apagado, margin: '8px 0 0' }));
      }
      const marcado = estado.marcados.has(t.valor);
      const registro = indice.get(String(t.valor)) ?? null;
      const item = el('label', {}, {
        display: 'grid', gridTemplateColumns: '18px 20px minmax(96px, 1fr) auto auto 92px', columnGap: '10px', alignItems: 'center',
        padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
        border: `1px solid ${marcado ? CORES.marca : CORES.borda}`, background: marcado ? CORES.fundoMarca : CORES.fundo,
      });
      const cb = el('input', { type: 'checkbox', checked: marcado }, { margin: '0' });
      cb.addEventListener('change', () => alternarTitulo(t.valor));
      const numero = el('span', { textContent: i < CONFIG_PROMESSA.MAX_NUMERADOS ? String(i + 1) : '·' }, { fontWeight: '700', color: CORES.marca, textAlign: 'center' });
      const codigo = el('div', {}, { minWidth: '0' });
      codigo.appendChild(el('div', { textContent: t.valor }, { fontWeight: '600', fontSize: '13px', color: CORES.tinta }));
      const cartorio = textoDoCartorioNoTitulo(t, registro, dados);
      const detalhes = [];
      if (t.outraRazao && t.razao) detalhes.push(t.razao);
      if (cartorio) detalhes.push(cartorio);
      if (detalhes.length) codigo.appendChild(el('div', { textContent: detalhes.join(' · ') }, { fontSize: '11px', color: CORES.apagado, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
      if (t.promessaPendente) {
        codigo.appendChild(el('div', { textContent: `⚠ já está numa promessa pendente (${t.promessaPendente}) — o CRM vai pedir pra você decidir` }, { fontSize: '11px', color: CORES.alerta }));
      }
      const dias = el('span', { textContent: t.atraso > 0 ? `${t.atraso} ${t.atraso === 1 ? 'dia' : 'dias'}` : `vence ${dataCurta(t.vencimento)}` }, { fontSize: '12px', color: CORES.texto, whiteSpace: 'nowrap' });
      const situacao = etiquetaDaSituacao(situacaoParaExibir(t, registro));
      const valor = el('span', { textContent: t.valorTela || '' }, { fontSize: '13px', fontWeight: '600', color: CORES.tinta, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
      [cb, numero, codigo, dias, situacao, valor].forEach((parte) => item.appendChild(parte));
      lista.appendChild(item);
    });
    corpo.appendChild(lista);
    const aVencer = estado.titulos.filter((t) => t.atraso <= 0).length;
    if (aVencer) {
      const linhaT = el('div', {}, { fontSize: '12px', color: CORES.apagado, margin: '8px 0 0' });
      linhaT.appendChild(tecla('T'));
      linhaT.appendChild(document.createTextNode(`${estado.mostrarAVencer ? 'esconder' : 'mostrar'} os que ainda vão vencer (${aVencer})`));
      corpo.appendChild(linhaT);
    }

    // Data
    corpo.appendChild(legendaDaSecao('Data do pagamento'));
    const datas = el('div', {}, { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });
    const teclaDaData = (iso, i) => (iso === hojeIso() ? 'H' : (i === 1 ? 'A' : null));
    datasSugeridas().forEach((iso, i) => {
      const ativo = estado.data === iso;
      const emCartorio = estado.marcados.size > 0 && avaliarCartorioDaPromessa([...estado.marcados], iso, dados).length > 0;
      const b = el('button', { type: 'button' }, {
        padding: '5px 10px', borderRadius: '999px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${emCartorio ? CORES.perigo : (ativo ? CORES.marca : CORES.borda)}`,
        background: ativo ? CORES.marca : CORES.fundo, color: ativo ? '#fff' : (emCartorio ? CORES.perigo : CORES.tinta),
      });
      const dica = teclaDaData(iso, i);
      if (dica) b.appendChild(tecla(dica));
      b.appendChild(document.createTextNode(rotuloDaData(iso) + (emCartorio ? ' · cartório' : '')));
      b.setAttribute('aria-pressed', String(ativo));
      b.addEventListener('click', () => escolherData(iso));
      datas.appendChild(b);
    });
    const outra = el('input', { type: 'date', min: hojeIso(), value: estado.data && !datasSugeridas().includes(estado.data) ? estado.data : '' }, {
      padding: '4px 8px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', fontSize: '13px', color: CORES.tinta,
    });
    outra.dataset.papel = 'outra-data';
    outra.setAttribute('aria-label', 'Outra data');
    outra.addEventListener('change', () => { if (outra.value) escolherData(outra.value); });
    const rotuloOutra = el('label', {}, { display: 'inline-flex', alignItems: 'center', fontSize: '12px', color: CORES.apagado });
    rotuloOutra.appendChild(tecla('D'));
    rotuloOutra.appendChild(el('span', { textContent: 'outra' }, { marginRight: '6px' }));
    rotuloOutra.appendChild(outra);
    datas.appendChild(rotuloOutra);
    corpo.appendChild(datas);

    // Regra do cartório: aviso vermelho (o botão fica travado).
    if (estado.bloqueios.length) {
      const caixa = el('div', {}, {
        marginTop: '10px', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.4',
        color: CORES.perigo, background: CORES.fundoPerigo, border: `1px solid ${CORES.perigo}`,
      });
      caixa.dataset.papel = 'bloqueio-cartorio';
      caixa.setAttribute('role', 'alert');
      frasesDoBloqueio(estado.bloqueios).forEach((linha) => caixa.appendChild(el('div', { textContent: linha })));
      corpo.appendChild(caixa);
    }

    // Forma de pagamento (as opções do próprio CRM)
    const opcoes = [...document.querySelectorAll(`${SEL.FORMA} option`)];
    if (opcoes.length) {
      corpo.appendChild(legendaDaSecao('Forma de pagamento'));
      const forma = el('select', {}, { padding: '5px 8px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', fontSize: '13px', color: CORES.tinta });
      forma.setAttribute('aria-label', 'Forma de pagamento');
      opcoes.forEach((o) => forma.appendChild(el('option', { value: o.value, textContent: o.textContent.trim(), selected: o.value === estado.forma })));
      forma.addEventListener('change', () => { estado.forma = forma.value; atualizarRodape(); });
      corpo.appendChild(forma);
    }
    atualizarRodape();
    // desenhar() refaz o miolo: se o foco estava num item que sumiu, volta pro painel (senão 1, A, Enter morrem).
    if (painelEl && !painelEl.contains(document.activeElement)) painelEl.focus({ preventScroll: true });
  }

  /** Soma do valor em aberto dos marcados (o que a lista do CRM mostra: sem juros nem multa). */
  function totalDosMarcados() {
    const marcados = estado.titulos.filter((t) => estado.marcados.has(t.valor));
    const numeros = marcados.map((t) => window.__smartTableUtil?.numeroDeMoedaBr?.(t.valorTela));
    if (!marcados.length) return null;
    if (numeros.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return { texto: '—', incompleto: true };
    return { texto: moedaBr(numeros.reduce((soma, n) => soma + n, 0)), incompleto: false };
  }

  function atualizarRodape() {
    if (!painelEl) return;
    painelEl.querySelector('[data-papel="resumo"]').textContent = resumoConfirmacao();
    const total = totalDosMarcados();
    const totalEl = painelEl.querySelector('[data-papel="total"]');
    totalEl.textContent = total ? `Total marcado: ${total.texto}` : '';
    totalEl.title = 'Valor em aberto dos títulos marcados, sem juros e multa: o CRM calcula o valor final ao salvar.';
    const botao = painelEl.querySelector('[data-papel="registrar"]');
    botao.disabled = !podeRegistrar();
    botao.style.opacity = botao.disabled ? '0.5' : '1';
    botao.style.cursor = botao.disabled ? 'not-allowed' : 'pointer';
  }

  function alternarTitulo(valor) {
    if (estado.marcados.has(valor)) estado.marcados.delete(valor);
    else estado.marcados.add(valor);
    desenhar();
  }

  function escolherData(iso) {
    if (!dataDeIso(iso) || iso < hojeIso()) return;
    estado.data = iso;
    desenhar();
  }

  /** O que dá pra focar dentro do painel (pro Tab não sair dele). */
  function focaveisDoPainel() {
    return [...painelEl.querySelectorAll('button, input, select')].filter((e) => !e.disabled && visivel(e));
  }

  function aoTeclar(e) {
    const alvo = e.target;
    const emCampo = alvo && (alvo.tagName === 'INPUT' && alvo.type !== 'checkbox' || alvo.tagName === 'SELECT');
    if (e.key === 'Escape') { e.preventDefault(); fecharPainel({ devolverFoco: true }); return; }
    if (e.key === 'Tab') {
      // Tab conduzido por nós: o nativo do Chromium às vezes passa por "nenhum elemento" e 1, A e Enter morrem.
      // Só o campo de data segue nativo (o Tab dele percorre dia, mês e ano).
      const focaveis = focaveisDoPainel();
      if (!focaveis.length) { e.preventDefault(); return; }
      const ativo = document.activeElement;
      if (ativo?.tagName === 'INPUT' && ativo.type === 'date') {
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && ativo === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && ativo === ultimo) { e.preventDefault(); primeiro.focus(); }
        return;
      }
      e.preventDefault();
      const i = focaveis.indexOf(ativo);
      const proximo = i === -1
        ? (e.shiftKey ? focaveis.length - 1 : 0)
        : (i + (e.shiftKey ? -1 : 1) + focaveis.length) % focaveis.length;
      focaveis[proximo].focus();
      return;
    }
    if (e.key === 'Enter') {
      // Enter num BOTÃO aciona o botão (senão Enter em "Cancelar" registraria). Fora de botão, Enter registra.
      if (alvo?.tagName === 'BUTTON') return;
      e.preventDefault();
      if (podeRegistrar()) registrar();
      return;
    }
    if (emCampo || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (n) {
      const t = titulosVisiveis()[Number(n[1]) - 1];
      if (t) { e.preventDefault(); alternarTitulo(t.valor); }
      return;
    }
    if (e.code === 'KeyH') { e.preventDefault(); escolherData(hojeIso()); }
    else if (e.code === 'KeyA') { e.preventDefault(); escolherData(isoMaisDias(hojeIso(), 1)); }
    else if (e.code === 'KeyT') { e.preventDefault(); estado.mostrarAVencer = !estado.mostrarAVencer; desenhar(); }
    else if (e.code === 'KeyD') { e.preventDefault(); painelEl.querySelector('[data-papel="outra-data"]')?.focus(); }
  }

  /** Base do painel: a faixa abaixo do cabeçalho do CRM (fato: header#sit-header, z-50, ~80px). */
  function alturaDoCabecalho() {
    const base = document.getElementById(CONFIG_PROMESSA.ID_CABECALHO)?.getBoundingClientRect().bottom;
    return Number.isFinite(base) && base > 0 && base < 200 ? Math.round(base) : CONFIG_PROMESSA.ALTURA_CABECALHO_PADRAO;
  }

  /**
   * Folga à esquerda do fundo: 16px, e mais só se o painel centralizado de verdade encostaria no menu lateral do CRM
   * (z-40; desde a v1.69.1 o fundo o cobre, e a folga segue como estava). Em 1600px o painel fica no centro exato; em telas estreitas se afasta do menu.
   */
  function folgaEsquerda() {
    const menu = window.__smartTableUtil?.margemMenuLateral?.() ?? 0;
    const largura = Math.min(CONFIG_PROMESSA.LARGURA_PAINEL, window.innerWidth - 32);
    const esquerdaCentral = (window.innerWidth - largura) / 2;
    return menu > 0 && esquerdaCentral < menu + 16 ? menu + 16 : 16;
  }

  function abrirPainel() {
    const titulos = lerTitulos();
    if (!titulos) {
      avisar('A promessa rápida (Alt+N) funciona na página de um cliente.', 'erro');
      return;
    }
    if (visivel(document.querySelector(SEL.MODAL))) {
      avisar('Há um contato aberto: salve ou feche antes de registrar a promessa (Alt+N).', 'erro');
      return;
    }
    // Quem tinha o foco antes de abrir (com o painel já aberto, vale o da primeira abertura).
    const quemAbriu = painelEl ? focoAnterior : (typeof document.activeElement?.focus === 'function' ? document.activeElement : null);
    window.__smartTableUtil?.fecharOutrosPaineis?.('promessaRapida');
    fecharPainel();

    const vencidos = titulos.filter((t) => t.atraso > 0);
    estado.titulos = titulos;
    estado.marcados = new Set(vencidos.length === 1 ? [vencidos[0].valor] : []);
    estado.data = null;
    estado.forma = document.querySelector(SEL.FORMA)?.value || null;
    estado.mostrarAVencer = vencidos.length === 0;
    estado.bloqueios = [];
    focoAnterior = quemAbriu;

    fundoEl = el('div', { id: CONFIG_PROMESSA.ID_FUNDO }, {
      position: 'fixed', top: `${alturaDoCabecalho()}px`, left: '0', right: '0', bottom: '0', zIndex: CONFIG_PROMESSA.Z_INDEX_POPUP,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `16px 16px 16px ${folgaEsquerda()}px`, boxSizing: 'border-box',
      background: 'rgba(16, 24, 40, 0.35)',
    });
    // Clique fora do painel fecha (a seleção se perde, como no Esc).
    fundoEl.addEventListener('mousedown', (e) => { if (e.target === fundoEl) fecharPainel({ devolverFoco: true }); });

    painelEl = el('div', { id: CONFIG_PROMESSA.ID_PAINEL, tabIndex: -1 }, {
      display: 'flex', flexDirection: 'column', width: `${CONFIG_PROMESSA.LARGURA_PAINEL}px`, maxWidth: '100%', maxHeight: '100%', boxSizing: 'border-box',
      background: CORES.fundo, border: `1px solid ${CORES.borda}`, borderRadius: '12px', overflow: 'hidden',
      boxShadow: '0 20px 48px rgba(16,24,40,0.28)', fontFamily: 'system-ui, -apple-system, sans-serif', color: CORES.texto, outline: 'none',
    });
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-modal', 'true');
    painelEl.setAttribute('aria-label', 'Registrar promessa');

    const topo = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', padding: '14px 18px 10px', borderBottom: `1px solid ${CORES.borda}` });
    const titulosTopo = el('div', {}, { minWidth: '0' });
    titulosTopo.appendChild(el('div', { textContent: '📅 Registrar promessa' }, { fontWeight: '700', fontSize: '16px', color: CORES.tinta }));
    const cliente = titulos.find((t) => !t.outraRazao && t.razao)?.razao;
    if (cliente) titulosTopo.appendChild(el('div', { textContent: cliente }, { fontSize: '12px', color: CORES.apagado, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
    topo.appendChild(titulosTopo);
    const fechar = el('button', { type: 'button', textContent: '✕' }, { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', color: CORES.apagado, padding: '2px 4px' });
    fechar.setAttribute('aria-label', 'Fechar (Esc)');
    fechar.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    topo.appendChild(fechar);
    painelEl.appendChild(topo);

    const meio = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '2px 18px 14px' });
    const ctx = window.__contextoAdicional;
    if (ctx?.promessa?.tipo === 'DIA_DA_PROMESSA') {
      meio.appendChild(el('div', { textContent: 'Este cliente já tem promessa pendente pra hoje.' }, {
        fontSize: '12px', color: CORES.alerta, background: CORES.fundoAlerta, borderRadius: '8px', padding: '6px 10px', margin: '12px 0 0',
      }));
    }
    const corpo = el('div');
    corpo.dataset.papel = 'corpo';
    meio.appendChild(corpo);
    painelEl.appendChild(meio);

    const rodape = el('div', {}, { borderTop: `1px solid ${CORES.borda}`, padding: '10px 18px 14px', background: '#FAFBFC' });
    const linhaResumo = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' });
    const resumo = el('div', {}, { fontSize: '12px', color: CORES.tinta, minHeight: '16px' });
    resumo.dataset.papel = 'resumo';
    resumo.setAttribute('aria-live', 'polite');
    const total = el('div', {}, { fontSize: '13px', fontWeight: '700', color: CORES.tinta, whiteSpace: 'nowrap' });
    total.dataset.papel = 'total';
    linhaResumo.appendChild(resumo);
    linhaResumo.appendChild(total);
    const botoes = el('div', {}, { display: 'flex', gap: '8px', marginTop: '10px' });
    const botao = el('button', { type: 'button' }, {
      flex: '1', padding: '9px 12px', border: 'none', borderRadius: '8px',
      background: CORES.tinta, color: '#fff', fontSize: '14px', fontWeight: '600',
    });
    botao.appendChild(document.createTextNode('Enter · Registrar promessa'));
    botao.dataset.papel = 'registrar';
    botao.addEventListener('click', () => { if (podeRegistrar()) registrar(); });
    const cancelar = el('button', { type: 'button', textContent: 'Esc · Cancelar' }, {
      padding: '9px 14px', borderRadius: '8px', border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.texto, fontSize: '13px', cursor: 'pointer',
    });
    cancelar.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    botoes.appendChild(botao);
    botoes.appendChild(cancelar);
    rodape.appendChild(linhaResumo);
    rodape.appendChild(botoes);
    painelEl.appendChild(rodape);

    painelEl.addEventListener('keydown', (e) => { e.stopPropagation(); aoTeclar(e); });
    fundoEl.appendChild(painelEl);
    document.body.appendChild(fundoEl);
    desenhar();
    painelEl.focus();
  }

  function alternarPainel() {
    if (registrando) { avisar('Registrando a promessa, aguarde.', 'info'); return; }
    if (painelEl) fecharPainel({ devolverFoco: true });
    else abrirPainel();
  }

  /* ---------------------------------------------------------------------
   * 4. AVISOS (na pilha do Módulo 0, com cor: verde, vermelho, âmbar)
   * --------------------------------------------------------------------- */
  function avisar(texto, tipo = 'info', duracaoMs) {
    const cor = { ok: [CORES.ok, CORES.fundoOk], erro: [CORES.perigo, CORES.fundoPerigo], alerta: [CORES.alerta, CORES.fundoAlerta], info: [CORES.tinta, '#F2F4F7'] }[tipo] || [CORES.tinta, '#F2F4F7'];
    const aviso = el('div', { textContent: texto }, {
      maxWidth: '380px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.4',
      color: cor[0], background: cor[1], border: `1px solid ${cor[0]}`, boxShadow: '0 4px 14px rgba(16,24,40,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '8px',
    });
    aviso.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    aviso.dataset.promessaRapida = tipo;
    if (window.__smartTableUtil?.colocarNaPilha) window.__smartTableUtil.colocarNaPilha(aviso);
    else {
      Object.assign(aviso.style, { position: 'fixed', right: '16px', bottom: '150px', zIndex: '999999' });
      document.body.appendChild(aviso);
    }
    const ms = duracaoMs || (tipo === 'erro' ? 12000 : 6000);
    setTimeout(() => aviso.remove(), ms);
    return aviso;
  }

  /* ---------------------------------------------------------------------
   * 5. REGISTRO: preenche o modal do CRM e salva pelo botão dele
   * --------------------------------------------------------------------- */
  function abrirModalContato() {
    const gatilho = [...document.querySelectorAll('[onclick]')].find((e) => new RegExp(`^\\s*${SEL.ABRIR_CONTATO}\\s*\\(`).test(e.getAttribute('onclick')));
    if (gatilho) { gatilho.click(); return true; }
    if (typeof window[SEL.ABRIR_CONTATO] === 'function') { window[SEL.ABRIR_CONTATO](); return true; }
    return false;
  }

  function lerPonte() {
    try { return JSON.parse(localStorage.getItem(CONFIG_PROMESSA.CHAVE_PONTE) || 'null'); } catch (_) { return null; }
  }
  function gravarPonte(ponte) {
    try { localStorage.setItem(CONFIG_PROMESSA.CHAVE_PONTE, JSON.stringify(ponte)); } catch (_) { /* sem ponte, confere só sem reload */ }
  }
  function apagarPonte() {
    try { localStorage.removeItem(CONFIG_PROMESSA.CHAVE_PONTE); } catch (_) { /* nada a fazer */ }
  }

  /** Para o fluxo e devolve o modal aberto pro operador, com o motivo. */
  function devolver(motivo, tipo = 'alerta') {
    avisar(motivo, tipo, 15000);
    return { ok: false, motivo };
  }

  async function registrar() {
    if (registrando) return { ok: false, motivo: 'já registrando' };
    const escolha = {
      titulos: estado.titulos.filter((t) => estado.marcados.has(t.valor)),
      data: estado.data,
      forma: estado.forma,
    };
    if (!escolha.titulos.length || !escolha.data) return { ok: false, motivo: 'faltou título ou data' };
    if (recalcularBloqueios().length) return { ok: false, motivo: 'título em cartório na data escolhida' };
    registrando = true;
    fecharPainel();
    try {
      return await preencherESalvar(escolha);
    } finally {
      registrando = false;
    }
  }

  async function preencherESalvar(escolha) {
    // 1. Abre o contato e escolhe "Promessa de Pagamento".
    if (!abrirModalContato()) return devolver('Não achei o botão que abre o contato nesta página.', 'erro');
    const botaoResultado = await esperarAte(() => {
      const b = document.querySelector(SEL.RESULTADO_PROMESSA);
      return visivel(document.querySelector(SEL.MODAL)) && b ? b : null;
    }, CONFIG_PROMESSA.TIMEOUT_MODAL_MS);
    if (!botaoResultado) return devolver('O contato não abriu a tempo. Tente o Alt+N de novo.', 'erro');
    botaoResultado.click();
    if (!(await esperarAte(() => visivel(document.querySelector(SEL.SECAO)), CONFIG_PROMESSA.TIMEOUT_MODAL_MS))) {
      return devolver('A seção de promessa não apareceu no contato. Confira o modal.', 'erro');
    }

    // 2. Títulos: os de outra razão só aparecem com o grupo incluído.
    if (escolha.titulos.some((t) => t.outraRazao)) {
      const grupo = document.querySelector(SEL.CHECK_GRUPO);
      if (grupo && !grupo.checked) grupo.click();
    }
    const checks = [...document.querySelectorAll(`${SEL.LISTA} ${SEL.CHECK}`)];
    const faltando = [];
    escolha.titulos.forEach((t) => {
      const cb = checks.find((c) => c.value === t.valor);
      if (!cb) faltando.push(t.valor);
      else if (!cb.checked) cb.click();
    });
    if (faltando.length) return devolver(`Não achei no contato: ${faltando.join(', ')}. Nada foi salvo; confira o modal.`, 'erro');
    // Título já marcado que ninguém escolheu entraria na promessa: desmarca e confere; se não sair, não salva.
    const escolhidos = new Set(escolha.titulos.map((t) => t.valor));
    const sobrando = () => checks.filter((c) => c.checked && !escolhidos.has(c.value));
    sobrando().forEach((c) => c.click());
    if (sobrando().length) {
      return devolver(`O contato está com outro título marcado (${sobrando().map((c) => c.value).join(', ')}) e não consegui desmarcar. Nada foi salvo; confira o modal.`, 'erro');
    }

    // 3. Data (o CRM recalcula o valor no change) e forma de pagamento.
    const data = document.querySelector(SEL.DATA);
    if (!data) return devolver('Não achei o campo de data da promessa. Nada foi salvo.', 'erro');
    data.value = escolha.data;
    data.dispatchEvent(new Event('input', { bubbles: true }));
    data.dispatchEvent(new Event('change', { bubbles: true }));
    const forma = document.querySelector(SEL.FORMA);
    if (forma && escolha.forma && forma.value !== escolha.forma) {
      forma.value = escolha.forma;
      forma.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 4. O CRM precisa ter calculado o valor antes de salvar.
    const valorOk = await esperarAte(() => {
      const v = document.querySelector(SEL.VALOR);
      return v && /\d/.test(v.value) && !/^0*[.,]?0*$/.test(v.value.replace(/[^\d.,]/g, '')) ? v : null;
    }, CONFIG_PROMESSA.TIMEOUT_VALOR_MS);

    // 5. Onde o CRM pede decisão, quem decide é o operador.
    if (visivel(document.querySelector(SEL.CONFLITO))) {
      return devolver('Título já está em outra promessa. O CRM está perguntando o que fazer: decida no contato e clique em Salvar Contato.');
    }
    if (visivel(document.querySelector(SEL.ERRO_RAZAO))) {
      return devolver('O CRM apontou um problema nos valores por razão. Confira no contato antes de salvar.');
    }
    if (!valorOk) return devolver('O valor da promessa não foi calculado. Confira no contato antes de salvar.');
    if (new Set(escolha.titulos.map((t) => t.cnpj)).size > 1) {
      return devolver('Títulos de mais de uma razão: o CRM cria uma promessa por razão. Confira os valores no contato e clique em Salvar Contato.');
    }

    // 6. Observação: a frase padrão, sem apagar nada que já esteja lá.
    const resumo = document.querySelector(SEL.RESUMO);
    if (resumo && !resumo.value.includes(CONFIG_PROMESSA.FRASE_OBSERVACAO)) {
      resumo.value = resumo.value.trim() ? `${resumo.value.trim()}\n${CONFIG_PROMESSA.FRASE_OBSERVACAO}` : CONFIG_PROMESSA.FRASE_OBSERVACAO;
      resumo.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 7. Salva pelo botão do CRM -- e confere.
    const salvar = document.querySelector(SEL.SALVAR);
    if (!salvar || salvar.disabled) return devolver('O botão Salvar Contato está desabilitado. Confira o contato.', 'erro');
    const ponte = { cnpj: cnpjDaUrl(), titulos: escolha.titulos.map((t) => t.valor), data: escolha.data, criadoEm: Date.now() };
    // Promessas IGUAIS já existentes: uma antiga (quebrada, cumprida) não pode passar por "a nova apareceu".
    ponte.jaExistiam = contarPromessasIguais(ponte) ?? 0;
    gravarPonte(ponte);
    salvar.click();
    return acompanharResultado(ponte);
  }

  /**
   * Quantas promessas da aba Promessas têm a data e os títulos da ponte.
   * @returns {number|null} null quando o Módulo 6 não está lá para ler a aba.
   */
  function contarPromessasIguais(ponte) {
    const lerPromessas = window.__contextoAdicionalDebug?.lerPromessas;
    if (typeof lerPromessas !== 'function') return null;
    const dataBrPonte = dataBr(ponte.data);
    return lerPromessas().filter((p) => p.dataPrometidaTexto === dataBrPonte &&
      ponte.titulos.every((t) => (p.titulos || []).map((x) => String(x).replace('-', '/')).includes(t))).length;
  }

  /** A promessa da ponte já está na aba Promessas? (uma a MAIS do que havia antes do clique) */
  function promessaApareceu(ponte) {
    const quantas = contarPromessasIguais(ponte);
    const antes = Number.isFinite(ponte.jaExistiam) ? ponte.jaExistiam : 0;
    return quantas !== null && quantas > antes;
  }

  function textoSucesso(ponte) {
    return `✓ Promessa registrada: ${rotuloDaData(ponte.data)} · ${ponte.titulos.join(', ')}.`;
  }

  async function acompanharResultado(ponte) {
    const resultado = await esperarAte(() => {
      if (visivel(document.querySelector(SEL.AVISO_NAO_CRIADA))) return 'nao-criada';
      if (visivel(document.querySelector(SEL.CONFIRMAR_ACAO))) return 'confirmar';
      if (promessaApareceu(ponte)) return 'ok';
      return null;
    }, CONFIG_PROMESSA.TIMEOUT_RESULTADO_MS);

    if (resultado === 'ok') {
      apagarPonte();
      avisar(textoSucesso(ponte), 'ok');
      return { ok: true };
    }
    if (resultado === 'nao-criada') {
      apagarPonte();
      const msg = document.querySelector(SEL.AVISO_NAO_CRIADA_MSG)?.textContent.trim();
      return devolver(`O CRM não criou a promessa${msg ? `: ${msg}` : '.'}`, 'erro');
    }
    if (resultado === 'confirmar') {
      // A ponte fica: se você confirmar e a página recarregar, a conferência segue.
      return devolver('O CRM pediu uma confirmação. Decida no aviso dele; depois eu confiro se a promessa apareceu.');
    }
    // Sem reload, sem aviso e sem a promessa na aba: não afirma nada.
    apagarPonte();
    return devolver('Não consegui confirmar se a promessa foi criada. Confira a aba Promessas antes de seguir.', 'erro');
  }

  /** Depois do reload do "Salvar Contato": confere a ponte deixada antes do clique. */
  async function conferirDepoisDoReload() {
    const ponte = lerPonte();
    if (!ponte) return;
    const idade = Date.now() - (ponte.criadoEm || 0);
    if (!(idade >= 0 && idade <= CONFIG_PROMESSA.VALIDADE_PONTE_MS) || ponte.cnpj !== cnpjDaUrl()) {
      // De outro cliente ou velha demais: não diz nada de ninguém.
      if (idade > CONFIG_PROMESSA.VALIDADE_PONTE_MS) apagarPonte();
      return;
    }
    apagarPonte();
    const apareceu = await esperarAte(() => promessaApareceu(ponte), CONFIG_PROMESSA.TIMEOUT_CONFERENCIA_MS);
    if (apareceu) avisar(textoSucesso(ponte), 'ok');
    else avisar(`A promessa de ${rotuloDaData(ponte.data)} (${ponte.titulos.join(', ')}) não apareceu na aba Promessas. Confira antes de seguir.`, 'erro', 20000);
  }

  /* ---------------------------------------------------------------------
   * 6. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  let iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    conferirDepoisDoReload();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  document.addEventListener('keydown', (e) => {
    if (!painelEl) return;
    if (e.code === 'Escape') { fecharPainel({ devolverFoco: true }); return; }
    // Foco perdido pra página (nenhum elemento focado): o painel reassume e trata a tecla, senão 1, A e Enter morrem.
    if (e.target === document.body || e.target === document.documentElement) {
      painelEl.focus({ preventScroll: true });
      aoTeclar(e);
    }
  });

  window.__smartTableUtil?.registrarPainel?.('promessaRapida', fecharPainel);

  window.__promessaRapida = {
    abrirPainel,
    fecharPainel,
    alternarPainel,
    registrar,
    lerTitulos,
    avaliarCartorioDaPromessa,
    frasesDoBloqueio,
    datasSugeridas,
    rotuloDaData,
    conferirDepoisDoReload,
    estaAberto: () => painelEl !== null,
    estaRegistrando: () => registrando,
    estado,
    CONFIG_PROMESSA,
  };
})();
