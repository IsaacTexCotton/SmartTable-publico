/* =========================================================================
 * MÓDULO 16: NEGOCIAÇÕES (títulos em acordo) -- CRM TexCotton
 * Identifica títulos que estão num acordo, pra não cobrar como vencido
 * comum o que o cliente já negociou (os originais seguem abertos na tabela
 * até o dia seguinte à confirmação do pagamento).
 *
 * FONTE (confirmada ao vivo, nada deduzido):
 *   - A lista de negociações já vem na página (aba Negociações): cada linha
 *     tem onclick="abrirModalStatusNeg(ID, 'STATUS', valor)".
 *   - Detalhe: GET /api/crm/negociacoes/{id} -> { success, data: { status,
 *     titulos: [{ duplicata: '925585-1' }], parcelas: [{ numeroParcela, valor,
 *     dataVencimento, status, vencida, valorPago }], dataCriacao,
 *     saldoRestante } }. Fixture: tests/fixtures/negociacao-detalhes-ativa.html.
 *
 * REGRA (decisão do usuário):
 *   - ATIVA e CONCLUIDA (paga, aguardando a baixa do dia seguinte): títulos
 *     NÃO são cobrados -- saem do relatório (Módulo 1) e da mensagem
 *     (Módulo 4). ATIVA: a mensagem relembra a parcela; parcela atrasada é
 *     cobrada.
 *   - INADIMPLENTE: títulos cobrados normalmente + menção ao acordo.
 *   - PROPOSTA_ENVIADA / CANCELADA: ignoradas (cobrança normal).
 * Só consulta a API pros status que mudam algo; cliente sem acordo não faz
 * requisição.
 *
 * Expõe window.__negociacoes (objeto no fim). Usa o Módulo 0
 * (window.__smartTableUtil).
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
    // Status que o CRM tem hoje e que não mudam a cobrança (confirmados no filtro da aba Negociações). Um status FORA destas
    // duas listas é novo: nunca é ignorado em silêncio (gera aviso, sem mudar quem é cobrado).
    STATUS_IGNORADOS: ['PROPOSTA_ENVIADA', 'CANCELADA'],
    // Títulos destes acordos não são cobrados.
    STATUS_PROTEGEM: ['ATIVA', 'CONCLUIDA'],
    // Status de PARCELA confirmados na API: "PENDENTE" e "PAGO" (a tela mostra
    // "Paga"). Lista fechada: "contém PAG" pegaria AGUARDANDO_PAGAMENTO.
    // Status fora das listas conta como PENDENTE (nunca some em silêncio) e
    // gera aviso.
    STATUS_PARCELA_PAGA: ['PAGO'],
    STATUS_PARCELA_PENDENTE: ['PENDENTE'],
    TIMEOUT_REQUISICAO_MS: 5000,
    // Teto que Alt+A / Alt+R / Alt+U esperam a leitura.
    TIMEOUT_AGUARDAR_MS: 6000,
    SELETOR_LINHAS_TITULOS: '#tabela-titulos-ds tbody tr',
  };

  const estado = {
    pronto: false,
    acordos: [], // lidos da API, validados
    erros: [], // ids que não deu pra ler
    statusDesconhecidos: [], // [{ id, status }] -- parcela com status fora das listas
    negociacoesDesconhecidas: [], // [{ id, status }] -- NEGOCIAÇÃO com status fora das listas (nem consultada nem ignorada de propósito)
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
   * "vencida" não basta: a frase A sairia com data passada.
   */
  function parcelaAtrasada(p) {
    return p.vencida || (p.dataVencimento !== '' && p.dataVencimento < hojeIso());
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA
   * --------------------------------------------------------------------- */
  /**
   * As negociações listadas na página: [{ id, status }]. `raiz`: a página de
   * OUTRO cliente baixada por fetch (Alt+U); sem argumento, esta página.
   */
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
   * Valida e reduz a resposta da API ao que a cobrança usa. Fora do formato
   * confirmado vira null (erro visível) -- falha fechada, nunca um acordo
   * "meio lido" que marcaria títulos errados.
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
      // window.fetch explícito: mesma razão do Módulo 10 (nos testes o
      // identificador livre é o fetch do ambiente, não o da janela).
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
   * Busca e valida o detalhe de cada negociação que muda a cobrança. Serve
   * a esta página e a uma página baixada.
   * @returns {Promise<{acordos: object[], erros: number[], statusDesconhecidos: {id: number, status: string}[], negociacoesDesconhecidas: {id: number, status: string}[]}>}
   */
  async function lerAcordos(raiz = document) {
    const lido = { acordos: [], erros: [], statusDesconhecidos: [], negociacoesDesconhecidas: [] };
    const todas = lerListaDaPagina(raiz);
    todas
      .filter((n) => !CONFIG_NEGOCIACOES.STATUS_CONSULTADOS.includes(n.status) && !CONFIG_NEGOCIACOES.STATUS_IGNORADOS.includes(n.status))
      .forEach((n) => {
        lido.negociacoesDesconhecidas.push({ id: n.id, status: n.status });
        console.warn(`[Negociações] Acordo ${window.__smartTableUtil?.apelidoParaLog?.(n.id) ?? '?'}: situação "${n.status}" não confirmada -- não consultei a API.`);
      });
    const lista = todas.filter((n) => CONFIG_NEGOCIACOES.STATUS_CONSULTADOS.includes(n.status));
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
    estado.negociacoesDesconhecidas.push(...lido.negociacoesDesconhecidas);
    const aviso = avisoPendente();
    if (aviso) window.__smartTableUtil?.toast?.(aviso, 9000);
    estado.pronto = true;
    resolverPronto(true);
    marcarTitulosNaTabela();
  }

  /**
   * O que o operador precisa conferir antes de cobrar, ou null. Sai ao abrir
   * a página e de novo no Alt+A (o toast da abertura some logo).
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
    if (estado.negociacoesDesconhecidas.length > 0) {
      const lista = estado.negociacoesDesconhecidas.map(({ id, status }) => `#${id} (${status})`).join(', ');
      partes.push(`Acordo com situação que não conheço: ${lista}`);
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
   *   os `registros` cobrados AGORA. A aba traz o histórico inteiro: sem o
   *   filtro, acordo antigo (títulos já pagos) ou título renegociado faria a
   *   mensagem dizer "voltaram para a cobrança" sem ser verdade.
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
   * (Alt+U): mesma lista, API, validação e consultas desta página.
   * @param {Document} raiz
   */
  async function acordosDaPaginaBaixada(raiz) {
    const { acordos, erros, statusDesconhecidos, negociacoesDesconhecidas } = await lerAcordos(raiz);
    return {
      tituloEmAcordo: (tituloTexto) => acordoQueProtegeEm(acordos, tituloTexto) !== null,
      resumoDeCobranca: (registros = []) => resumoDeCobrancaEm(acordos, erros, registros),
      acordos,
      erros,
      statusDesconhecidos,
      negociacoesDesconhecidas,
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
    // Confirmado no HTML real: o data-key fica no checkbox, não no <tr>:
    // <input class="titulo-check" data-key="915950-2-a-0"> (número-parcela-...).
    const chave = tr.querySelector('input.titulo-check[data-key]')?.dataset.key || '';
    return chaveDoTitulo(/^(\d+-\d+)/.exec(chave)?.[1]);
  }

  /** Índice da coluna "Título" pelo data-key do cabeçalho (o mesmo que o Módulo 1 usa). */
  function indiceColunaTitulo() {
    const ths = Array.from(document.querySelectorAll('#tabela-titulos-ds thead th'));
    const i = ths.findIndex((th) => th.dataset.key === 'numeroTitulo');
    return i >= 0 ? i : 0;
  }

  // O selo NÃO pode ser texto na célula: o Módulo 1 lê o textContent da
  // coluna "Título" pra montar o número ("925585/1"). Por isso é CSS
  // (::after lê um atributo): aparece na tela e fica fora do textContent.
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
      // Acordo que protege vence o inadimplente (renegociação: o título está
      // nos dois); o selo tem que refletir o que a cobrança faz.
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
    // O CRM redesenha as linhas ao ordenar/filtrar. Vigia o contêiner
    // (subtree), não o tbody: trocado o tbody, o observador ficaria surdo.
    // Marcar só mexe em atributo, então não realimenta o observador.
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
