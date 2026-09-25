/* =========================================================================
 * MÓDULO 16: NEGOCIAÇÕES (títulos em acordo) — CRM TexCotton
 * -------------------------------------------------------------------------
 * PEDIDO DO USUÁRIO (v1.41.0): identificar títulos que estão num acordo, pra
 * não cobrar como vencido comum o que o cliente já negociou. Os títulos
 * originais continuam abertos na tabela até o dia seguinte à confirmação
 * do pagamento -- durante TODO o acordo eles apareciam como vencidos.
 *
 * FONTE (confirmada ao vivo pelo usuário, 24/09/2026 -- nada deduzido):
 *   - A lista de negociações do cliente JÁ VEM na página (aba Negociações,
 *     pré-carregada como Promessas/Contatos): cada linha tem um botão
 *     onclick="abrirModalStatusNeg(ID, 'STATUS', valor)".
 *   - O detalhe de cada uma vem de GET /api/crm/negociacoes/{id} (a mesma
 *     chamada que o "Ver detalhes" do CRM faz): { success, data: { status,
 *     titulos: [{ duplicata: '925585-1', ... }], parcelas: [{ numeroParcela,
 *     valor, dataVencimento, status, vencida, valorPago }], dataCriacao,
 *     saldoRestante, ... } }. Fixture: tests/fixtures/negociacao-detalhes-ativa.html.
 *
 * REGRA (decisões do usuário):
 *   - ATIVA (aceita, em andamento) e CONCLUIDA (paga, aguardando a baixa do
 *     dia seguinte): os títulos do acordo NÃO são cobrados -- saem do
 *     relatório (Módulo 1) e da mensagem (Módulo 4). ATIVA: a mensagem só
 *     relembra a parcela; parcela atrasada é cobrada.
 *   - INADIMPLENTE: títulos cobrados normalmente + menção ao acordo.
 *   - PROPOSTA_ENVIADA / CANCELADA: ignoradas (cobrança normal).
 *
 * Só consulta a API pros status que mudam algo (ATIVA, CONCLUIDA,
 * INADIMPLENTE) -- cliente sem acordo, a maioria, não faz requisição.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__negociacoesCarregado) return;
  window.__negociacoesCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Negociações');

  const CONFIG_NEGOCIACOES = {
    SELETOR_BOTAO_STATUS: '#content-negociacoes [onclick^="abrirModalStatusNeg"]',
    URL_DETALHE: (id) => `/api/crm/negociacoes/${id}`,
    // Status que mudam a cobrança -- só estes são consultados.
    STATUS_CONSULTADOS: ['ATIVA', 'CONCLUIDA', 'INADIMPLENTE'],
    // Títulos destes acordos não são cobrados.
    STATUS_PROTEGEM: ['ATIVA', 'CONCLUIDA'],
    // Status de PARCELA confirmados pelo diagnóstico da API (24/09/2026,
    // acordos ATIVA e CONCLUIDA): "PENDENTE" e "PAGO" -- a tela de detalhes
    // mostra "Paga", mas a API manda PAGO. Lista fechada de propósito:
    // "contém PAG" pegaria AGUARDANDO_PAGAMENTO como paga. Status fora das
    // duas listas conta como PENDENTE (lembra/cobra, nunca some em silêncio)
    // e gera aviso pra conferir.
    STATUS_PARCELA_PAGA: ['PAGO'],
    STATUS_PARCELA_PENDENTE: ['PENDENTE'],
    TIMEOUT_REQUISICAO_MS: 5000,
    // Teto que Alt+A / Alt+R / Alt+U esperam a leitura terminar.
    TIMEOUT_AGUARDAR_MS: 6000,
    SELETOR_LINHAS_TITULOS: '#tabela-titulos-ds tbody tr',
  };

  const estado = {
    pronto: false,
    acordos: [], // lidos da API, validados
    erros: [], // ids que não deu pra ler
    statusDesconhecidos: [], // [{ id, status }] -- parcela com status fora das listas
  };
  let resolverPronto;
  const promessaPronto = new Promise((r) => { resolverPronto = r; });

  /* ---------------------------------------------------------------------
   * 1. NORMALIZAÇÃO
   * --------------------------------------------------------------------- */
  /**
   * "925585-1" (API e tabela), "925585/1" (Módulo 1), "0925585-01" ->
   * "925585-1". null se não tiver número e parcela.
   */
  function chaveDoTitulo(texto) {
    const m = /(\d+)\D+(\d+)/.exec(String(texto ?? ''));
    return m ? `${Number(m[1])}-${Number(m[2])}` : null;
  }

  // Datas: as do Módulo 0 (uma versão só no projeto).
  const dataCurta = (iso) => window.__smartTableUtil.dataCurtaDeIso(iso);

  function numero(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN;
  }

  /** Hoje, yyyy-mm-dd no fuso local (o mesmo formato de dataVencimento). */
  const hojeIso = () => window.__smartTableUtil.dataIso(new Date());

  /** Parcela já paga: status PAGO confirmado, ou valor pago cobrindo o valor. */
  function parcelaPaga(p) {
    if (CONFIG_NEGOCIACOES.STATUS_PARCELA_PAGA.includes(p.status)) return true;
    const valor = numero(p.valor);
    const pago = numero(p.valorPago);
    return valor > 0 && pago >= valor - 0.005;
  }

  /**
   * Parcela atrasada: a API diz que venceu OU a data já passou. Só o
   * "vencida" da API não basta -- com ele atrasado, a frase A sairia
   * "com vencimento em [data passada]. Posso contar com o pagamento na data?".
   */
  function parcelaAtrasada(p) {
    return p.vencida || (p.dataVencimento !== '' && p.dataVencimento < hojeIso());
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA
   * --------------------------------------------------------------------- */
  /** As negociações listadas na página: [{ id, status }]. */
  // `raiz` (v1.45.0): a página de OUTRO cliente baixada por fetch (Alt+U
  // sem abrir aba). Sem argumento, esta página.
  function lerListaDaPagina(raiz = document) {
    const vistos = new Set();
    const lista = [];
    raiz.querySelectorAll(CONFIG_NEGOCIACOES.SELETOR_BOTAO_STATUS).forEach((b) => {
      const m = /abrirModalStatusNeg\(\s*(\d+)\s*,\s*'([A-Z_]+)'/.exec(b.getAttribute('onclick') || '');
      if (!m || vistos.has(m[1])) return;
      vistos.add(m[1]);
      lista.push({ id: Number(m[1]), status: m[2] });
    });
    return lista;
  }

  /**
   * Valida e reduz a resposta da API ao que a cobrança usa. Qualquer coisa
   * fora do formato confirmado vira null (e erro visível) -- nunca um acordo
   * "meio lido" que marcaria os títulos errados.
   */
  function interpretarDetalhe(json, idEsperado) {
    const d = json?.data;
    if (!json?.success || !d || typeof d !== 'object') return null;
    if (typeof d.status !== 'string' || !Array.isArray(d.titulos) || !Array.isArray(d.parcelas)) return null;
    const titulos = d.titulos.map((t) => chaveDoTitulo(t?.duplicata)).filter(Boolean);
    if (titulos.length !== d.titulos.length) return null;
    const parcelas = d.parcelas.map((p) => ({
      numero: p?.numeroParcela,
      valor: numero(p?.valor),
      valorPago: numero(p?.valorPago),
      dataVencimento: typeof p?.dataVencimento === 'string' ? p.dataVencimento.slice(0, 10) : '',
      status: typeof p?.status === 'string' ? p.status.toUpperCase() : '',
      vencida: p?.vencida === true,
    }));
    const conhecidos = [...CONFIG_NEGOCIACOES.STATUS_PARCELA_PAGA, ...CONFIG_NEGOCIACOES.STATUS_PARCELA_PENDENTE];
    return {
      id: Number(d.id ?? idEsperado),
      status: d.status.toUpperCase(),
      titulos,
      parcelas,
      dataCriacao: typeof d.dataCriacao === 'string' ? d.dataCriacao.slice(0, 10) : '',
      saldoRestante: numero(d.saldoRestante),
      statusDesconhecidos: [...new Set(parcelas.map((p) => p.status).filter((st) => !conhecidos.includes(st)))],
    };
  }

  async function buscarDetalhe(id) {
    const controle = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    const limite = setTimeout(() => controle?.abort(), CONFIG_NEGOCIACOES.TIMEOUT_REQUISICAO_MS);
    try {
      // window.fetch explícito: mesma razão do Módulo 10 (fora do navegador o
      // identificador livre cai no fetch do ambiente, não no da janela).
      const r = await window.fetch(CONFIG_NEGOCIACOES.URL_DETALHE(id), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: controle?.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const acordo = interpretarDetalhe(await r.json(), id);
      if (!acordo) throw new Error('resposta fora do formato esperado');
      return acordo;
    } finally {
      clearTimeout(limite);
    }
  }

  /**
   * Busca e valida o detalhe de cada negociação que muda a cobrança. Mesma
   * leitura pra esta página (carregar) e pra uma página baixada.
   * @returns {Promise<{acordos: object[], erros: number[], statusDesconhecidos: {id: number, status: string}[]}>}
   */
  async function lerAcordos(raiz = document) {
    const lido = { acordos: [], erros: [], statusDesconhecidos: [] };
    const lista = lerListaDaPagina(raiz).filter((n) => CONFIG_NEGOCIACOES.STATUS_CONSULTADOS.includes(n.status));
    const resultados = await Promise.allSettled(lista.map((n) => buscarDetalhe(n.id)));
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        lido.acordos.push(r.value);
        r.value.statusDesconhecidos.forEach((status) => {
          lido.statusDesconhecidos.push({ id: r.value.id, status });
          console.warn(`[Negociações] Acordo ${window.__smartTableUtil?.apelidoParaLog?.(r.value.id) ?? '?'}: parcela com status "${status}" não confirmado -- tratada como pendente.`);
        });
      } else {
        lido.erros.push(lista[i].id);
        console.warn(`[Negociações] Não consegui ler o acordo ${window.__smartTableUtil?.apelidoParaLog?.(lista[i].id) ?? '?'}.`, r.reason?.message);
      }
    });
    return lido;
  }

  async function carregar() {
    const lido = await lerAcordos();
    estado.acordos.push(...lido.acordos);
    estado.erros.push(...lido.erros);
    estado.statusDesconhecidos.push(...lido.statusDesconhecidos);
    const aviso = avisoPendente();
    if (aviso) window.__smartTableUtil?.toast?.(aviso, 9000);
    estado.pronto = true;
    resolverPronto(true);
    marcarTitulosNaTabela();
  }

  /**
   * O que o operador precisa conferir antes de cobrar, ou null. Sai ao abrir
   * a página E de novo no Alt+A (o aviso da abertura some em segundos, e o
   * Alt+A pode vir bem depois).
   */
  function avisoPendente() {
    const partes = [];
    if (estado.erros.length > 0) {
      partes.push(`Não consegui ler ${estado.erros.length === 1 ? 'o acordo' : 'os acordos'} #${estado.erros.join(', #')}`);
    }
    if (estado.statusDesconhecidos.length > 0) {
      const lista = estado.statusDesconhecidos.map(({ id, status }) => `#${id} (${status})`).join(', ');
      partes.push(`Parcela com situação que não conheço no acordo ${lista}`);
    }
    return partes.length > 0 ? `${partes.join('. ')} -- confira a aba Negociações antes de cobrar.` : null;
  }

  /* ---------------------------------------------------------------------
   * 3. CONSULTA (o que os outros módulos usam)
   * --------------------------------------------------------------------- */
  /** Acordo ATIVA/CONCLUIDA que contém o título, ou null. */
  function acordoQueProtegeEm(acordos, tituloTexto) {
    const chave = chaveDoTitulo(tituloTexto);
    if (!chave) return null;
    return acordos.find((a) => CONFIG_NEGOCIACOES.STATUS_PROTEGEM.includes(a.status) && a.titulos.includes(chave)) ?? null;
  }

  function acordoQueProtege(tituloTexto) {
    return acordoQueProtegeEm(estado.acordos, tituloTexto);
  }

  /** O título está num acordo que o protege da cobrança? (Módulo 1) */
  function tituloEmAcordo(tituloTexto) {
    return acordoQueProtege(tituloTexto) !== null;
  }

  function parcelaAlvo(acordo) {
    const pendentes = acordo.parcelas
      .filter((p) => !parcelaPaga(p))
      .sort((a, b) => (a.dataVencimento < b.dataVencimento ? -1 : a.dataVencimento > b.dataVencimento ? 1 : 0));
    const atrasada = pendentes.find(parcelaAtrasada);
    return atrasada ? { parcela: atrasada, atrasada: true } : pendentes[0] ? { parcela: pendentes[0], atrasada: false } : null;
  }

  /**
   * O que a cobrança precisa saber dos acordos deste cliente.
   *
   * @returns {{
   *   ativa: {acordo: object, parcela: object, atrasada: boolean} | null,
   *   inadimplente: object | null,
   *   erros: number[],
   * }}
   *   ativa: o acordo ATIVA mais urgente (parcela atrasada primeiro; senão
   *   a próxima a vencer). Acordo ATIVA sem parcela pendente não conta.
   *   inadimplente: o acordo INADIMPLENTE mais recente com algum título entre
   *   os `registros` cobrados AGORA. A aba traz o histórico inteiro: sem
   *   esse filtro, um acordo quebrado em março (títulos já pagos) ou um
   *   título renegociado num acordo novo faria a mensagem dizer "os títulos
   *   voltaram para a cobrança" sem ser verdade.
   * @param {Array<{tituloCompleto: string}>} [registros] títulos cobrados agora (Módulo 1)
   */
  function resumoDeCobranca(registros = []) {
    return resumoDeCobrancaEm(estado.acordos, estado.erros, registros);
  }

  function resumoDeCobrancaEm(acordos, erros, registros = []) {
    const alvos = acordos
      .filter((a) => a.status === 'ATIVA')
      .map((a) => ({ acordo: a, ...parcelaAlvo(a) }))
      .filter((x) => x.parcela);
    alvos.sort((x, y) => {
      if (x.atrasada !== y.atrasada) return x.atrasada ? -1 : 1;
      return x.parcela.dataVencimento < y.parcela.dataVencimento ? -1 : 1;
    });
    const cobrados = new Set((registros ?? []).map((r) => chaveDoTitulo(r?.tituloCompleto)).filter(Boolean));
    const inadimplentes = acordos
      .filter((a) => a.status === 'INADIMPLENTE' && a.titulos.some((t) => cobrados.has(t)))
      .sort((a, b) => (a.dataCriacao < b.dataCriacao ? 1 : -1));
    return { ativa: alvos[0] ?? null, inadimplente: inadimplentes[0] ?? null, erros: [...erros] };
  }

  /**
   * Os acordos de OUTRO cliente, a partir da página dele baixada por fetch
   * (v1.45.0, Alt+U sem abrir aba) -- mesma lista, mesma API, mesma
   * validação e mesmas consultas desta página.
   * @param {Document} raiz
   */
  async function acordosDaPaginaBaixada(raiz) {
    const { acordos, erros, statusDesconhecidos } = await lerAcordos(raiz);
    return {
      tituloEmAcordo: (tituloTexto) => acordoQueProtegeEm(acordos, tituloTexto) !== null,
      resumoDeCobranca: (registros = []) => resumoDeCobrancaEm(acordos, erros, registros),
      acordos,
      erros,
      statusDesconhecidos,
    };
  }

  /** Espera a leitura terminar (ou o teto). Sempre resolve. */
  function aguardar(timeoutMs = CONFIG_NEGOCIACOES.TIMEOUT_AGUARDAR_MS) {
    if (estado.pronto) return Promise.resolve(true);
    return Promise.race([promessaPronto, new Promise((r) => { const id = setTimeout(() => r(false), timeoutMs); id?.unref?.(); })]);
  }

  /* ---------------------------------------------------------------------
   * 4. SELO NA TABELA DE TÍTULOS
   * --------------------------------------------------------------------- */
  const ROTULOS_STATUS = { ATIVA: 'ativa', CONCLUIDA: 'quitado', INADIMPLENTE: 'inadimplente' };

  function chaveDaLinha(tr) {
    // CONFIRMADO no HTML real: o data-key fica no checkbox da linha, não no
    // <tr>: <input class="titulo-check" data-key="915950-2-a-0"> -- número-parcela-...
    const chave = tr.querySelector('input.titulo-check[data-key]')?.dataset.key || '';
    return chaveDoTitulo(/^(\d+-\d+)/.exec(chave)?.[1]);
  }

  /** Índice da coluna "Título" pelo data-key do cabeçalho (o mesmo que o Módulo 1 usa). */
  function indiceColunaTitulo() {
    const ths = Array.from(document.querySelectorAll('#tabela-titulos-ds thead th'));
    const i = ths.findIndex((th) => th.dataset.key === 'numeroTitulo');
    return i >= 0 ? i : 0;
  }

  // O selo NÃO pode ser texto dentro da célula: o Módulo 1 lê o
  // textContent da coluna "Título" pra montar o número do título
  // ("925585/1") -- um <span> ali viraria "925585🤝 Acordo #1947/1" no
  // relatório e na busca do acordo. Por isso o selo é CSS (::after lê um
  // atributo): aparece na tela e fica fora do textContent.
  const ATRIBUTO_SELO = 'data-smarttable-acordo';
  const ATRIBUTO_TIPO = 'data-smarttable-acordo-tipo';

  function injetarEstiloDoSelo() {
    if (document.getElementById('smarttable-estilo-selo-acordo')) return;
    const estilo = document.createElement('style');
    estilo.id = 'smarttable-estilo-selo-acordo';
    estilo.textContent = `
      td[${ATRIBUTO_SELO}]::after {
        content: attr(${ATRIBUTO_SELO});
        display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 9999px;
        font-size: 10px; font-weight: 600; white-space: nowrap; vertical-align: middle;
        background: #E8F3EC; color: #1B6B4A; border: 1px solid #B9D9C4;
      }
      td[${ATRIBUTO_TIPO}="inadimplente"]::after { background: #FEF3E2; color: #B45309; border-color: #F5C98B; }`;
    document.head.appendChild(estilo);
  }

  function marcarTitulosNaTabela() {
    const linhas = document.querySelectorAll(CONFIG_NEGOCIACOES.SELETOR_LINHAS_TITULOS);
    if (linhas.length === 0 || estado.acordos.length === 0) return;
    injetarEstiloDoSelo();
    const coluna = indiceColunaTitulo();
    linhas.forEach((tr) => {
      const chave = chaveDaLinha(tr);
      if (!chave) return;
      // Acordo que protege vence o inadimplente: na renegociação o título
      // está nos dois, e o selo tem que contar o que a cobrança faz com ele.
      const acordo = acordoQueProtege(chave) ?? estado.acordos.find((a) => a.titulos.includes(chave));
      const celula = tr.querySelectorAll('td')[coluna];
      if (!acordo || !celula || celula.hasAttribute(ATRIBUTO_SELO)) return;
      const inadimplente = acordo.status === 'INADIMPLENTE';
      celula.setAttribute(ATRIBUTO_SELO, `${inadimplente ? '⚠' : '🤝'} Acordo #${acordo.id} · ${ROTULOS_STATUS[acordo.status] ?? acordo.status.toLowerCase()}`);
      celula.setAttribute(ATRIBUTO_TIPO, inadimplente ? 'inadimplente' : 'protegido');
      celula.title = inadimplente
        ? 'Acordo não cumprido -- este título voltou pra cobrança.'
        : 'Título em acordo -- fica fora do relatório e da mensagem de cobrança.';
    });
  }

  function vigiarTabela() {
    // A SmartTable do CRM redesenha as linhas ao ordenar/filtrar -- o selo
    // volta. Vigia o contêiner (subtree), não o tbody: se o tbody inteiro
    // for trocado, um observador preso ao antigo ficaria surdo. Marcar só
    // mexe em atributo, então não realimenta este observador (childList).
    const tabela = document.getElementById('tabela-titulos-ds');
    if (!tabela) return;
    new MutationObserver(() => { if (estado.pronto) marcarTitulosNaTabela(); }).observe(tabela, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------------
   * 5. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  let iniciado = false;
  function iniciar() {
    // Uma vez só: rodar de novo duplicaria o observador e as consultas à API.
    if (iniciado) return;
    iniciado = true;
    if (!new URLSearchParams(location.search).get('cnpj')) {
      estado.pronto = true;
      resolverPronto(true);
      return;
    }
    vigiarTabela();
    carregar().catch((erro) => {
      console.warn('[Negociações] Falha inesperada lendo os acordos.', erro);
      estado.pronto = true;
      resolverPronto(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  window.__negociacoes = {
    aguardar,
    estaPronto: () => estado.pronto,
    tituloEmAcordo,
    acordoQueProtege,
    resumoDeCobranca,
    acordosDaPaginaBaixada,
    avisoPendente,
    acordos: () => estado.acordos.map((a) => ({ ...a })),
    chaveDoTitulo,
    dataCurta,
    lerListaDaPagina,
    interpretarDetalhe,
    CONFIG_NEGOCIACOES,
  };
})();
