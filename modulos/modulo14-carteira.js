/* =========================================================================
 * MÓDULO 14: CARTEIRA (Alt+M) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Painel de MIS/BI da carteira em quatro abas:
 *   Hoje      -> fotografia: vencido, % da dívida em cobrança, SCPC, promessas,
 *                cobertura, concentração, aging, fora do painel e saúde do
 *                histórico (gravações, lacunas, alertas de dados).
 *   Evolução  -> ponte (por que o vencido mudou), cura, cura semanal, tendência.
 *   Resultado -> API do CRM (semana/mês) e previsão de entrada das promessas.
 *   Régua     -> cruza o diário (faixa do Alt+U, hora do contato) com quem
 *                quitou em até 7 dias.
 *
 * PRINCÍPIO CENTRAL: GRAVA-SE O DADO BRUTO; TODO NÚMERO É CALCULADO NA LEITURA.
 * Decisão do usuário: nenhum erro pode ficar congelado no histórico. Mudar
 * regra (escopo, faixas, "quem some quitou") ou corrigir conta corrige o
 * histórico INTEIRO, retroativamente, sem apagar fotografia.
 *   1. A captura grava os campos da lista como o CRM mandou, só os de
 *      CAMPOS_BRUTOS. Nada é calculado antes de gravar.
 *   2. Agregado, aging, cura, ponte, previsão e régua saem desse bruto a cada
 *      abertura do painel ou geração do CSV.
 *   3. Cada registro guarda a lista de campos que usou (`campos`): campo novo
 *      não quebra registro antigo.
 *   4. Erro não passa em silêncio: a captura valida a lista e grava alertas; o
 *      resultado de cada tentativa (com o motivo da falha) aparece no painel;
 *      dia útil sem fotografia vira lacuna; há backup e restauração.
 *
 * DE ONDE VÊM OS NÚMEROS:
 *   1. FOTOGRAFIA -- window.CLIENTES (campos confirmados ao vivo).
 *      dividaAVencer vem SEMPRE null: "a vencer" é dividaTotal - dividaVencida.
 *      A lista só tem quem deve (confirmado ao vivo: nenhum cliente com
 *      dividaVencida <= 0). Logo, cliente que SOME da lista quitou o vencido
 *      (cura, ponte e régua contam assim), e dividaTotal soma só os clientes
 *      EM ATRASO. Risco aceito: transferência de negociador também faz sumir.
 *      Se a premissa quebrar, a captura grava o alerta 'semVencidoNaLista'.
 *      CORTE: vale a PRIMEIRA leitura completa do dia (posição de abertura).
 *      Uma leitura posterior só substitui se trouxer MAIS clientes ou se a
 *      gravada for do formato antigo (sem bruto).
 *   2. RESULTADO -- APIs do Alt+D, buscadas na hora: dashboard-consolidado e a
 *      lista de promessas (cumpridas pelo dia do pagamento, critério do Alt+D).
 *      Não filtra por escopo: o recuperado é tudo o que se recebeu.
 *   3. RÉGUA -- eventos 'fila' e 'contato' do diário (Módulo 8), casados com as
 *      fotografias pelo hash do CNPJ. Descritivo, não causal.
 *
 * ESCOPO (decisões do usuário): carteira de CONFIG_CARTEIRA.PESSOAS e, nela, só
 * o vencido do 2º ao 20º dia. O 1º dia (e dia 0 ou sem dias) não é referência;
 * do 21º em diante o CLIENTE INTEIRO é do analista; cartório e "não cobrar"
 * contam no vencido; o 20º é da cobrança aqui mesmo com a fila do Alt+U parando
 * no 19º. Fora do escopo aparece na linha "Fora do painel". O escopo é aplicado
 * na leitura.
 *
 * ARMAZENAMENTO: IndexedDB "smarttable_carteira", um registro por dia
 * (~65 KB/dia com 180 clientes), cota própria; o localStorage (~5 MB pro CRM
 * inteiro) fica pro diário e pra fila. Pede armazenamento PERSISTENTE e o
 * painel mostra se aceitou. Nenhum CNPJ, razão social, endereço ou contato é
 * gravado: CNPJ, grupo e representante viram hash de 53 bits (pseudonimização).
 * Sem IndexedDB, o histórico vive na memória da aba e o painel diz isso. O
 * estado da última gravação fica em smarttable_carteira_status (localStorage),
 * pra sobreviver a falha do IndexedDB.
 *
 * FORMATOS DE REGISTRO:
 *   - formato 3: { data, formato: 3, hashVersao: 2, capturadoEm, totalLista,
 *     campos: [...], linhas: [[h, g, r, ...valores]], alertas }.
 *   - legado: { data, agregado, detalhe? } -- números já calculados, hash de 31
 *     bits. Mostrado como estava (tendência e CSV), marcado como legado, fora de
 *     cura, ponte e régua (hash não casa). O legado de HOJE é substituído na
 *     próxima abertura da lista.
 *
 * NÃO MOSTRA DE PROPÓSITO: valor em cartório separado (não existe em
 * window.CLIENTES); inadimplência sobre faturamento ou carteira inteira (sem
 * fonte); valoresAcordo da API (sem porUsuario, misturaria outras pessoas);
 * parcelas de acordo na previsão (a lista só traz o valor TOTAL).
 *
 * ONDE COLAR: depois do Módulo 0 e do Módulo 10 (usa buscarConsolidado de lá).
 * Lê o diário (Módulo 8) e os nomes das faixas (Módulo 7) só ao abrir o painel.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__carteiraCarregado) return;
  window.__carteiraCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Carteira');

  const CONFIG_CARTEIRA = {
    BANCO: 'smarttable_carteira',
    VERSAO_BANCO: 1,
    TABELA: 'dias',
    FORMATO: 3,
    HASH_VERSAO: 2,
    CHAVE_STATUS: 'smarttable_carteira_status',
    // Históricos antigos no localStorage: o v2 é MIGRADO pro IndexedDB (como
    // legado); o v1 só é apagado.
    CHAVE_MIGRAR: 'smarttable_carteira_v2',
    CHAVES_ANTIGAS: ['smarttable_carteira_v1', 'smarttable_carteira_v2'],
    ID_PAINEL: 'smarttable-painel-carteira',
    Z_INDEX: 30,

    // Primeiro nome, minúsculas, sem acento -- mesmo critério do Alt+D.
    // Aplicado na LEITURA: a captura grava a lista inteira.
    PESSOAS: ['isaac'],

    // Retenção (~1 ano): score precisa de ~90 dias com resultado conhecido,
    // e sazonalidade só aparece com um ano.
    DIAS_RETENCAO: 400,
    // Quanto o painel lê (o CSV e o backup leem tudo): régua (60 dias de
    // diário + janela de 7 + base de 3), cura semanal (8 semanas + 7).
    DIAS_LEITURA_PAINEL: 75,

    // ESCOPO -- ver cabeçalho.
    DIA_INICIO_ESCOPO: 2,
    DIA_FIM_ESCOPO: 20,

    // Aging pelo diasAtraso do cliente, cobrindo exatamente o escopo.
    FAIXAS_AGING: [
      { rotulo: '2º dia', min: 2, max: 2 },
      { rotulo: '3–5 dias', min: 3, max: 5 },
      { rotulo: '6–15 dias', min: 6, max: 15 },
      { rotulo: '16–19 dias', min: 16, max: 19 },
      { rotulo: '20º dia', min: 20, max: 20 },
    ],

    DIAS_COMPARACAO: 7,
    DIAS_COBERTURA: 7,
    DIAS_SEM_MOVIMENTACAO: 30,
    TOP_CONCENTRACAO: 10,
    DIAS_TENDENCIA: 30,
    SEMANAS_CURA: 8,
    // Lacunas: dias úteis (seg-sex) sem fotografia nesta janela.
    DIAS_LACUNAS: 30,
    // Lembrete de backup: o histórico mora num navegador só; limpeza de dados do
    // site ou troca de computador levam tudo. Passou disso, painel e lista avisam
    // (uma vez por dia).
    DIAS_LEMBRETE_BACKUP: 7,

    DIAS_PREVISAO: [7, 30],
    DIAS_TAXA_CUMPRIMENTO: 90,

    JANELA_RESULTADO_DIAS: 7,
    DIAS_DIARIO: 60,
    AMOSTRA_MINIMA: 5,
    FAIXAS_HORARIO: [
      { rotulo: 'antes das 9h', ate: 9 * 60 },
      { rotulo: '9h–11h', ate: 11 * 60 },
      { rotulo: '11h–13h', ate: 13 * 60 },
      { rotulo: '13h–15h', ate: 15 * 60 },
      { rotulo: '15h–17h', ate: 17 * 60 },
      { rotulo: '17h ou depois', ate: 24 * 60 },
    ],
  };

  /*
   * CAMPOS GRAVADOS, por lista explícita (whitelist) -- um campo novo do CRM
   * NUNCA entra sozinho no armazenamento (vira só o alerta 'campoNovo').
   * Valores gravados como vieram. Os três identificadores viram hash e vão
   * nas três primeiras posições de cada linha (h, g, r).
   */
  const CAMPOS_BRUTOS = Object.freeze([
    'dividaTotal', 'dividaVencida', 'dividaAVencer', 'dividaVencidaNegociada', 'dividaVencidaNaoNegociada',
    'valorTotalTitulos', 'limiteCredito', 'diasAtraso', 'diasAtrasoMedio', 'qtdTitulosVencidos', 'qtdTitulosTotal',
    'scpc', 'situacao', 'situacaoCredito', 'situacaoCreditoDescricao', 'situacaoCobranca', 'situacaoCobrancaDescricao',
    'dataSituacaoCobranca', 'deveSuspender', 'novosProtestosOntem', 'cluster', 'scorePrioridade', 'negociadorUsuario',
    'negociadorAtribuido', 'tipoAtribuicao', 'valorNegociacaoRecente', 'statusNegociacaoRecente',
    'dataNegociacaoProximaParcela', 'valorPromessaRecente', 'statusPromessaRecente', 'dataPromessaPrometida',
    'dataUltimaMovimentacao', 'tipoUltimaMovimentacao', 'dataUltimoPagamento', 'possuiFat', 'controleCliente',
    'controleClienteDescricao', 'proximaTarefaData', 'proximaTarefaDescricao', 'estado', 'regiao',
  ]);
  // Identificam o cliente: viram hash (h = CNPJ, g = grupo econômico,
  // r = representante). O resto do que identifica NÃO é gravado.
  const CAMPOS_HASH = Object.freeze({ h: 'cnpj', g: 'grupoCliente', r: 'codigoRepresentante' });
  // Conhecidos e DE PROPÓSITO fora do armazenamento (identificam o cliente
  // ou são texto livre de cadastro). Estar aqui só evita o alerta de campo
  // novo.
  const CAMPOS_EXCLUIDOS = Object.freeze([
    'razaoSocial', 'nomeFantasia', 'grupoClienteDescricao', 'endereco', 'numero', 'cep', 'bairro', 'cidade',
    'telefone', 'celular', 'email', 'codigo', 'cnpjFormatado', 'enderecoCompleto', 'primeiraDuplicata',
    'titulosNoDiaFiltrado',
  ]);
  // Campos em que a conta depende. Se SUMIREM de todos os clientes (o CRM
  // renomeou), o dia ainda é gravado, mas com o alerta 'campoSumiu' --
  // e como o bruto está gravado, dá pra corrigir a leitura depois.
  const CAMPOS_ESSENCIAIS = Object.freeze(['cnpj', 'dividaTotal', 'dividaVencida', 'diasAtraso']);
  // Campos que precisam ser número (ou null). Texto aqui vira o alerta
  // 'tipoInesperado' -- e a leitura tenta converter ("1234,56") em vez de
  // zerar em silêncio.
  const CAMPOS_NUMERICOS = Object.freeze([
    'dividaTotal', 'dividaVencida', 'diasAtraso', 'diasAtrasoMedio', 'qtdTitulosVencidos', 'qtdTitulosTotal',
    'scorePrioridade', 'valorPromessaRecente', 'valorNegociacaoRecente',
  ]);

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    bom: '#1B6B4A',
    ruim: '#B42318',
    alerta: '#B45309',
    fundo: '#ffffff',
    cartao: '#f8fafc',
    barra: '#313A8C',
  };

  let painelEl = null;
  let abaAtiva = 'hoje';

  /** @returns {object|null} */
  function util() {
    return window.__smartTableUtil ?? null;
  }

  /* ---------------------------------------------------------------------
   * DATAS -- sempre ao meio-dia (convenção do Módulo 0).
   * --------------------------------------------------------------------- */

  function isoDe(data) {
    const u = util();
    const d = data ?? new Date();
    if (u?.dataIso) return u.dataIso(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** @param {string} iso AAAA-MM-DD (o resto é ignorado). @returns {Date|null} */
  function dataDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }

  function diasEntre(deIso, ateIso) {
    const de = dataDeIso(deIso);
    const ate = dataDeIso(ateIso);
    if (!de || !ate) return null;
    return Math.round((ate - de) / 86400000);
  }

  function somarDias(iso, dias) {
    const d = dataDeIso(iso);
    d.setDate(d.getDate() + dias);
    return isoDe(d);
  }

  function ddmm(iso) {
    const [, mes, dia] = String(iso).split('-');
    return `${dia}/${mes}`;
  }

  /** 20260917 (formato do diário) -> '2026-09-17'. */
  function isoDoDiario(numero) {
    const s = String(numero);
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
  }

  const ehDataIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

  /* ---------------------------------------------------------------------
   * NÚMEROS -- tolerantes, e nunca NaN
   * --------------------------------------------------------------------- */

  /**
   * Número de um valor cru do CRM. Aceita número e texto numérico
   * ("1234.56", "1.234,56", "5"). Devolve null quando não dá pra saber --
   * quem chama decide se isso é zero ou "não informado".
   *
   * @param {unknown} v
   * @returns {number|null}
   */
  function numeroFlex(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim().replace(/^R\$\s*/, '');
    if (t === '') return null;
    let normal = t;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) {
      normal = t.replace(/\./g, '').replace(',', '.'); // 1.234,56 / 12,5
    } else if (!/^-?\d+(\.\d+)?$/.test(t)) {
      return null;
    }
    const n = Number(normal);
    return Number.isFinite(n) ? n : null;
  }

  /** @returns {number} Ausente/ilegível é zero. */
  function numero(v) {
    return numeroFlex(v) ?? 0;
  }

  /** Dias de atraso inteiros (o CRM manda inteiro; se vier 2.5, conta como 2). */
  function diasDe(c) {
    const d = numeroFlex(c?.diasAtraso);
    return d === null ? null : Math.floor(d);
  }

  /* ---------------------------------------------------------------------
   * HASH (53 bits, cyrb53) -- o mesmo pra lista e pro diário
   * --------------------------------------------------------------------- */

  function cyrb53(texto) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < texto.length; i += 1) {
      const ch = texto.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  /**
   * Hash de um identificador. CNPJ com ou sem máscara dá o mesmo hash (só
   * dígitos); identificador sem dígito usa o texto inteiro. Vazio -> null.
   */
  function hashId(tipo, valor) {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    if (texto === '') return null;
    const digitos = texto.replace(/\D/g, '');
    return cyrb53(`carteira:${tipo}:${digitos || texto}`);
  }

  const hashCnpj = (cnpj) => hashId('cnpj', cnpj);

  /* ---------------------------------------------------------------------
   * REGRAS DE NEGÓCIO (aplicadas na leitura)
   * --------------------------------------------------------------------- */

  const texto = (v) => String(v ?? '').trim();
  const ehScpc = (c) => texto(c.scpc).toUpperCase() === 'S';
  const ehSuspenso = (c) => texto(c.situacao).toLowerCase() === 'suspenso';
  const promessaPendente = (c) => texto(c.statusPromessaRecente).toUpperCase() === 'PENDENTE';
  const acordoInadimplente = (c) => texto(c.statusNegociacaoRecente).toUpperCase() === 'INADIMPLENTE';
  const ehClusterNovo = (c) => texto(c.cluster).toLowerCase() === 'novo';

  /**
   * O cliente é da carteira de quem está em PESSOAS? Sem negociadorUsuario,
   * entra (a lista do usuário logado já vem filtrada pelo CRM).
   */
  function ehDaCarteira(c) {
    if (!c || typeof c !== 'object') return false;
    if (!c.negociadorUsuario) return true;
    const u = util();
    const nome = u?.primeiroNomeDeUsuario?.(c.negociadorUsuario) ?? texto(c.negociadorUsuario).split('.')[0].toLowerCase();
    return CONFIG_CARTEIRA.PESSOAS.includes(nome);
  }

  /** Os clientes da lista crua (com CNPJ) da carteira de PESSOAS. */
  function clientesDaCarteira(lista) {
    const base = lista ?? window.CLIENTES;
    if (!Array.isArray(base)) return [];
    return base.filter((c) => c && typeof c === 'object' && c.cnpj && ehDaCarteira(c));
  }

  /*
   * LISTA FILTRADA NÃO É FOTOGRAFADA (decisão do usuário: só a lista completa
   * da carteira, sem filtro). Com filtro do CRM ligado, window.CLIENTES traz
   * parte da carteira: gravada, os de fora contariam como QUITADOS (cura,
   * ponte) e, no dia seguinte, como entradas. A detecção mora no Módulo 0 (a
   * mesma do Alt+U).
   *
   * @param {object[]} lista
   * @param {string} [busca] location.search da página
   * @returns {string[]|null} rótulos dos filtros, como aparecem na tela
   */
  function filtrosAtivosNaLista(lista, busca) {
    const detectar = util()?.filtrosAtivosNaListaDeClientes;
    // FALHA FECHADA: sem o detector (Módulo 0 desatualizado/sem carregar) não dá
    // pra saber se a lista está completa, então trata como filtrada. Fotografar
    // lista parcial é o erro caro; deixar de fotografar é o barato.
    if (typeof detectar !== 'function') return ['não deu pra conferir os filtros (atualize o SmartTable)'];
    return detectar(lista, { busca, pessoas: CONFIG_CARTEIRA.PESSOAS });
  }

  /**
   * Onde um cliente COM vencido está em relação ao escopo.
   * @returns {'primeiroDia'|'analista'|'escopo'} 'primeiroDia' cobre também
   *   dia 0, negativo e sem dias.
   */
  function situacaoNoEscopo(dias) {
    if (!(dias >= CONFIG_CARTEIRA.DIA_INICIO_ESCOPO)) return 'primeiroDia';
    if (dias > CONFIG_CARTEIRA.DIA_FIM_ESCOPO) return 'analista';
    return 'escopo';
  }

  /** Índice em FAIXAS_AGING (dias inteiros), ou -1. */
  function indiceFaixa(dias) {
    const d = Math.floor(dias);
    return CONFIG_CARTEIRA.FAIXAS_AGING.findIndex((f) => d >= f.min && d <= f.max);
  }

  /**
   * Estado de um cliente num dia: ausente da lista, sem vencido, ou onde no
   * escopo. Funciona com o cliente cru da lista e com o gravado.
   * @returns {'ausente'|'semVencido'|'primeiroDia'|'analista'|'escopo'}
   */
  function estadoDe(c) {
    if (!c) return 'ausente';
    if (!(numero(c.dividaVencida) > 0)) return 'semVencido';
    return situacaoNoEscopo(diasDe(c));
  }

  /**
   * O vencido que estava em cobrança foi resolvido: sumiu da lista (a lista
   * só tem quem deve), ficou sem vencido, ou só tem título de 1º dia.
   */
  function quitou(estado) {
    return estado === 'ausente' || estado === 'semVencido' || estado === 'primeiroDia';
  }

  /**
   * TODA a aritmética da fotografia. Pura: recebe clientes (crus ou
   * gravados) e a data, devolve números. Nunca lança por dado estranho:
   * número ilegível é zero, dias ilegíveis ficam fora do escopo.
   *
   * @param {object[]} clientes Já filtrados pela carteira.
   * @param {string} hojeIso
   * @returns {object}
   */
  function resumirCarteira(clientes, hojeIso) {
    const faixas = CONFIG_CARTEIRA.FAIXAS_AGING.map((f) => ({ rotulo: f.rotulo, clientes: 0, valor: 0 }));
    const r = {
      data: hojeIso,
      clientes: clientes.length,
      carteira: 0,
      vencido: 0,
      aVencer: 0,
      pctVencido: 0,
      clientesComVencido: 0,
      titulosVencidos: 0,
      scpc: { clientes: 0, valor: 0 },
      suspensos: { clientes: 0, valor: 0 },
      deveSuspender: 0,
      clusterNovo: { clientes: 0, valor: 0 },
      promessasPendentes: {
        clientes: 0,
        valor: 0,
        venceHoje: 0,
        vencidas: 0,
        valorVencidas: 0,
        proximos: Object.fromEntries(CONFIG_CARTEIRA.DIAS_PREVISAO.map((n) => [n, { clientes: 0, valor: 0 }])),
      },
      acordosInadimplentes: { clientes: 0, valor: 0 },
      cobertura: { cobertos: 0, pct: 0 },
      semMovimentacao: 0,
      concentracaoTop: 0,
      faixas,
      fora: {
        primeiroDia: { clientes: 0, valor: 0 },
        analista: { clientes: 0, valor: 0 },
      },
    };

    const vencidos = [];

    clientes.forEach((c) => {
      const total = numero(c.dividaTotal);
      const vencida = numero(c.dividaVencida);
      r.carteira += total;
      r.aVencer += Math.max(0, total - vencida);

      if (vencida > 0) {
        const onde = situacaoNoEscopo(diasDe(c));
        if (onde !== 'escopo') {
          r.fora[onde].clientes += 1;
          r.fora[onde].valor += vencida;
          return;
        }
      }

      if (promessaPendente(c)) {
        const valor = numero(c.valorPromessaRecente);
        const pp = r.promessasPendentes;
        pp.clientes += 1;
        pp.valor += valor;
        const prometida = texto(c.dataPromessaPrometida).slice(0, 10);
        if (prometida === hojeIso) pp.venceHoje += 1;
        if (ehDataIso(prometida) && prometida < hojeIso) {
          // Data já passou e continua "pendente": na prática, quebrada. Fora
          // da previsão -- entraria como dinheiro esperado sem ser.
          pp.vencidas += 1;
          pp.valorVencidas += valor;
        } else if (ehDataIso(prometida)) {
          const distancia = diasEntre(hojeIso, prometida);
          CONFIG_CARTEIRA.DIAS_PREVISAO.forEach((n) => {
            if (distancia !== null && distancia <= n) {
              pp.proximos[n].clientes += 1;
              pp.proximos[n].valor += valor;
            }
          });
        }
      }
      if (acordoInadimplente(c)) {
        r.acordosInadimplentes.clientes += 1;
        r.acordosInadimplentes.valor += numero(c.valorNegociacaoRecente);
      }

      if (vencida <= 0) return;

      vencidos.push(vencida);
      r.vencido += vencida;
      r.clientesComVencido += 1;
      r.titulosVencidos += numero(c.qtdTitulosVencidos);

      const faixa = faixas[indiceFaixa(diasDe(c))];
      if (faixa) {
        faixa.clientes += 1;
        faixa.valor += vencida;
      }

      if (ehScpc(c)) { r.scpc.clientes += 1; r.scpc.valor += vencida; }
      if (ehSuspenso(c)) { r.suspensos.clientes += 1; r.suspensos.valor += vencida; }
      if (c.deveSuspender === true) r.deveSuspender += 1;
      if (ehClusterNovo(c)) {
        r.clusterNovo.clientes += 1;
        r.clusterNovo.valor += vencida;
      }

      const dias = diasEntre(c.dataUltimaMovimentacao, hojeIso);
      if (dias !== null && dias <= CONFIG_CARTEIRA.DIAS_COBERTURA) r.cobertura.cobertos += 1;
      if (dias === null || dias > CONFIG_CARTEIRA.DIAS_SEM_MOVIMENTACAO) r.semMovimentacao += 1;
    });

    r.pctVencido = r.carteira > 0 ? r.vencido / r.carteira : 0;
    r.cobertura.pct = r.clientesComVencido > 0 ? r.cobertura.cobertos / r.clientesComVencido : 0;
    const topo = vencidos.sort((a, b) => b - a).slice(0, CONFIG_CARTEIRA.TOP_CONCENTRACAO);
    r.concentracaoTop = r.vencido > 0 ? topo.reduce((s, v) => s + v, 0) / r.vencido : 0;
    return r;
  }

  /* ---------------------------------------------------------------------
   * CAPTURA: lista crua -> registro bruto + alertas
   * --------------------------------------------------------------------- */

  /**
   * Um valor cru pode ser gravado como está? Só tipos que o IndexedDB e o
   * JSON do backup guardam sem transformar. Objeto/array/função viram null
   * (e o alerta 'tipoInesperado'): gravar estrutura desconhecida é gravar
   * sabe-se lá o quê -- inclusive dado identificador aninhado.
   */
  function valorGravavel(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    return undefined; // sinal de "não gravável"
  }

  /**
   * Monta o registro bruto do dia e valida a lista. NÃO calcula nenhuma
   * regra de negócio -- a captura não pode falhar por causa de uma conta.
   * Cada cliente é lido isoladamente: um cliente estranho vira alerta, não
   * derruba o dia.
   *
   * @param {object[]} lista window.CLIENTES
   * @param {Date} agora
   * @returns {{registro: object, alertas: object[]}}
   */
  function montarRegistro(lista, agora) {
    const contagem = new Map(); // tipo -> {tipo, campo?, qtd}
    const alertar = (tipo, campo) => {
      const chave = campo ? `${tipo}:${campo}` : tipo;
      const atual = contagem.get(chave) ?? { tipo, ...(campo ? { campo } : {}), qtd: 0 };
      atual.qtd += 1;
      contagem.set(chave, atual);
    };

    const conhecidos = new Set([...CAMPOS_BRUTOS, ...Object.values(CAMPOS_HASH), ...CAMPOS_EXCLUIDOS]);
    const vistos = new Set();
    const hashesVistos = new Set();
    const linhas = [];

    lista.forEach((c) => {
      try {
        if (!c || typeof c !== 'object') {
          alertar('clienteInvalido');
          return;
        }
        Object.keys(c).forEach((k) => {
          vistos.add(k);
          if (!conhecidos.has(k)) alertar('campoNovo', k);
        });
        const h = hashId('cnpj', c.cnpj);
        if (h === null) {
          alertar('semCnpj');
          return;
        }
        if (hashesVistos.has(h)) {
          alertar('cnpjDuplicado');
          return; // o primeiro fica; somar duas vezes inflaria o vencido
        }
        hashesVistos.add(h);

        const linha = [h, hashId('grupo', c.grupoCliente), hashId('representante', c.codigoRepresentante)];
        CAMPOS_BRUTOS.forEach((campo) => {
          const v = valorGravavel(c[campo]);
          if (v === undefined) {
            alertar('tipoInesperado', campo);
            linha.push(null);
          } else {
            linha.push(v);
          }
        });
        CAMPOS_NUMERICOS.forEach((campo) => {
          const v = c[campo];
          if (v !== null && v !== undefined && typeof v !== 'number') alertar('tipoInesperado', campo);
        });
        const vencida = numeroFlex(c.dividaVencida);
        const total = numeroFlex(c.dividaTotal);
        if (!(vencida > 0)) alertar('semVencidoNaLista');
        if (vencida !== null && total !== null && vencida > total + 0.01) alertar('vencidaMaiorQueTotal');
        const dias = numeroFlex(c.diasAtraso);
        if (dias !== null && (dias < 0 || !Number.isInteger(dias))) alertar('diasEstranhos');
        linhas.push(linha);
      } catch (erro) {
        alertar('erroLeitura');
        console.warn('[Carteira] Cliente ilegível na lista -- ficou fora da fotografia.', erro?.message);
      }
    });

    if (lista.length > 0) {
      CAMPOS_ESSENCIAIS.forEach((campo) => {
        if (!vistos.has(campo)) alertar('campoSumiu', campo);
      });
    }

    const alertas = [...contagem.values()];
    const registro = {
      data: isoDe(agora),
      formato: CONFIG_CARTEIRA.FORMATO,
      hashVersao: CONFIG_CARTEIRA.HASH_VERSAO,
      capturadoEm: agora.toISOString(),
      totalLista: lista.length,
      campos: [...CAMPOS_BRUTOS],
      linhas,
      alertas,
    };
    return { registro, alertas };
  }

  /** Texto de um alerta, pra tela e pro console. */
  function descreverAlerta(a) {
    const n = a.qtd;
    switch (a.tipo) {
      case 'campoSumiu': return `o campo "${a.campo}" não veio na lista (o CRM mudou?) -- os números que dependem dele saem zerados até a leitura ser ajustada; o bruto do dia está gravado`;
      case 'campoNovo': return `campo novo na lista: "${a.campo}" (${n} clientes) -- não é gravado até alguém decidir`;
      case 'tipoInesperado': return `"${a.campo}" veio em formato inesperado em ${n} cliente(s) -- gravado como veio; a leitura tenta converter`;
      case 'semCnpj': return `${n} cliente(s) sem CNPJ na lista -- ficaram fora da fotografia`;
      case 'cnpjDuplicado': return `${n} CNPJ(s) repetido(s) na lista -- contado(s) uma vez só`;
      case 'semVencidoNaLista': return `${n} cliente(s) na lista sem vencido -- a premissa "a lista só tem quem deve" quebrou; "sumiu = quitou" pode estar errado`;
      case 'vencidaMaiorQueTotal': return `${n} cliente(s) com vencido maior que a dívida total`;
      case 'diasEstranhos': return `${n} cliente(s) com dias de atraso negativos ou fracionados`;
      case 'clienteInvalido': return `${n} item(ns) da lista não eram clientes`;
      case 'erroLeitura': return `${n} cliente(s) não puderam ser lidos -- ficaram fora da fotografia`;
      default: return `${a.tipo}${a.campo ? ` (${a.campo})` : ''}: ${n}`;
    }
  }

  /* ---------------------------------------------------------------------
   * ESTADO DAS GRAVAÇÕES (localStorage pequeno -- sobrevive a falha do IDB)
   * --------------------------------------------------------------------- */

  function lerStatus() {
    try {
      return JSON.parse(window.localStorage.getItem(CONFIG_CARTEIRA.CHAVE_STATUS) ?? 'null') ?? {};
    } catch {
      return {};
    }
  }

  function gravarStatus(parcial) {
    try {
      const atual = lerStatus();
      window.localStorage.setItem(CONFIG_CARTEIRA.CHAVE_STATUS, JSON.stringify({ ...atual, ...parcial }));
    } catch {
      // sem localStorage: o painel ainda mostra o que o IndexedDB tiver
    }
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO (IndexedDB, com memória como plano B)
   * --------------------------------------------------------------------- */

  let bancoPromessa = null;
  const memoria = new Map();
  let usandoMemoria = false;

  function pedido(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB: erro sem detalhe'));
    });
  }

  /** Espera a transação TERMINAR (é só aí que a gravação está no disco). */
  function fimDaTransacao(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: transação falhou'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transação abortada (cota cheia?)'));
    });
  }

  /** @returns {Promise<IDBDatabase|null>} null = sem IndexedDB (plano B). */
  function abrirBanco() {
    if (bancoPromessa) return bancoPromessa;
    bancoPromessa = new Promise((resolve) => {
      const fabrica = window.indexedDB;
      if (!fabrica || typeof fabrica.open !== 'function') {
        usandoMemoria = true;
        resolve(null);
        return;
      }
      let req;
      try {
        req = fabrica.open(CONFIG_CARTEIRA.BANCO, CONFIG_CARTEIRA.VERSAO_BANCO);
      } catch (erro) {
        console.warn('[Carteira] IndexedDB indisponível -- histórico só nesta aba.', erro?.message);
        usandoMemoria = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CONFIG_CARTEIRA.TABELA)) {
          db.createObjectStore(CONFIG_CARTEIRA.TABELA, { keyPath: 'data' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Uma versão futura aberta em outra aba precisa conseguir atualizar o
        // banco: fechar este e reabrir na próxima operação.
        db.onversionchange = () => {
          db.close();
          bancoPromessa = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        console.warn('[Carteira] Não consegui abrir o IndexedDB -- histórico só nesta aba.', req.error?.message);
        usandoMemoria = true;
        resolve(null);
      };
      req.onblocked = () => console.warn('[Carteira] IndexedDB bloqueado por outra aba com versão antiga aberta.');
    });
    return bancoPromessa;
  }

  /** Pede ao navegador pra não apagar o histórico sob pressão de disco. */
  async function pedirPersistencia() {
    try {
      const s = window.navigator?.storage;
      if (!s?.persist) return null;
      if (s.persisted && await s.persisted()) return true;
      return await s.persist();
    } catch {
      return null;
    }
  }

  async function lerDia(dia) {
    const db = await abrirBanco();
    if (!db) return memoria.get(dia);
    return pedido(db.transaction(CONFIG_CARTEIRA.TABELA, 'readonly').objectStore(CONFIG_CARTEIRA.TABELA).get(dia));
  }

  /** Grava e só resolve quando a transação COMPLETOU. */
  async function gravarDia(registro) {
    const db = await abrirBanco();
    if (!db) {
      memoria.set(registro.data, registro);
      return;
    }
    const tx = db.transaction(CONFIG_CARTEIRA.TABELA, 'readwrite');
    const fim = fimDaTransacao(tx);
    tx.objectStore(CONFIG_CARTEIRA.TABELA).put(registro);
    await fim;
  }

  async function listarDias() {
    const db = await abrirBanco();
    if (!db) return [...memoria.keys()].sort();
    const chaves = await pedido(db.transaction(CONFIG_CARTEIRA.TABELA, 'readonly').objectStore(CONFIG_CARTEIRA.TABELA).getAllKeys());
    return chaves.map(String).sort();
  }

  async function apagarDias(dias) {
    if (dias.length === 0) return;
    const db = await abrirBanco();
    if (!db) {
      dias.forEach((d) => memoria.delete(d));
      return;
    }
    const tx = db.transaction(CONFIG_CARTEIRA.TABELA, 'readwrite');
    const fim = fimDaTransacao(tx);
    const t = tx.objectStore(CONFIG_CARTEIRA.TABELA);
    dias.forEach((d) => t.delete(d));
    await fim;
  }

  /** Registros crus, opcionalmente só a partir de uma data. */
  async function lerRegistros(desdeIso) {
    const db = await abrirBanco();
    if (!db) {
      return [...memoria.values()].filter((r) => !desdeIso || r.data >= desdeIso);
    }
    const t = db.transaction(CONFIG_CARTEIRA.TABELA, 'readonly').objectStore(CONFIG_CARTEIRA.TABELA);
    const faixa = desdeIso && window.IDBKeyRange ? window.IDBKeyRange.lowerBound(desdeIso) : undefined;
    const todos = await pedido(t.getAll(faixa));
    return desdeIso ? todos.filter((r) => r?.data >= desdeIso) : todos;
  }

  /* ---------------------------------------------------------------------
   * LEITURA: registro -> dia (clientes decodificados, agregado sob demanda)
   * --------------------------------------------------------------------- */

  /** Formato compacto do legado (faixas [clientes, valor]) -> objeto. */
  function expandirAgregado(gravado) {
    if (!gravado || !Array.isArray(gravado.faixas)) return gravado;
    return {
      ...gravado,
      faixas: gravado.faixas.map((f, i) => (Array.isArray(f)
        ? { rotulo: CONFIG_CARTEIRA.FAIXAS_AGING[i]?.rotulo ?? `faixa ${i + 1}`, clientes: f[0], valor: f[1] }
        : f)),
    };
  }

  /**
   * Registro gravado -> dia utilizável. Formato 3: clientes como objetos
   * { h, g, r, ...campos }, pela lista de campos DO PRÓPRIO registro.
   * Legado: agregado como estava + detalhe antigo (hash de 31 bits) só pra
   * cura/ponte entre dois legados.
   */
  function decodificar(registro) {
    if (!registro || !ehDataIso(registro.data)) return null;
    if (registro.formato === 3 && Array.isArray(registro.campos) && Array.isArray(registro.linhas)) {
      const campos = registro.campos;
      const clientes = registro.linhas.map((linha) => {
        const c = { h: linha[0], g: linha[1], r: linha[2] };
        campos.forEach((campo, i) => { c[campo] = linha[i + 3]; });
        return c;
      });
      return {
        data: registro.data,
        formato: 3,
        legado: false,
        hashVersao: registro.hashVersao,
        capturadoEm: registro.capturadoEm,
        totalLista: registro.totalLista,
        alertas: Array.isArray(registro.alertas) ? registro.alertas : [],
        clientes,
      };
    }
    const detalhe = Array.isArray(registro.detalhe) ? registro.detalhe : null;
    return {
      data: registro.data,
      formato: 0,
      legado: true,
      hashVersao: 1,
      capturadoEm: registro.agregado?.capturadoEm ?? null,
      totalLista: registro.agregado?.clientes ?? 0,
      alertas: [],
      clientes: detalhe
        ? detalhe.map((l) => ({ h: l[0], dividaVencida: l[1], dividaTotal: l[2], diasAtraso: l[3], qtdTitulosVencidos: l[4] }))
        : null,
      agregadoLegado: expandirAgregado(registro.agregado ?? null),
    };
  }

  /** @returns {{dias: Object<string, object>}} */
  function montarHistorico(registros) {
    const dias = {};
    registros.forEach((r) => {
      const d = decodificar(r);
      if (d) dias[d.data] = d;
    });
    return { dias };
  }

  /** Histórico: por padrão só a janela do painel; `{tudo: true}` pro CSV. */
  async function lerHistorico({ tudo = false, hoje } = {}) {
    await migrarLocalStorage();
    const desde = tudo ? null : somarDias(isoDe(hoje ?? new Date()), -CONFIG_CARTEIRA.DIAS_LEITURA_PAINEL);
    return montarHistorico(await lerRegistros(desde));
  }

  const cacheAgregado = new WeakMap();

  /**
   * O agregado de um dia, calculado AGORA com as regras atuais (formato 3)
   * ou o gravado na época (legado, marcado).
   */
  function agregadoDe(dia) {
    if (!dia) return null;
    if (cacheAgregado.has(dia)) return cacheAgregado.get(dia);
    let a;
    if (dia.formato === 3) {
      a = resumirCarteira(dia.clientes.filter(ehDaCarteira), dia.data);
      a.capturadoEm = dia.capturadoEm;
    } else {
      a = dia.agregadoLegado ? { ...dia.agregadoLegado, legado: true } : null;
    }
    cacheAgregado.set(dia, a);
    return a;
  }

  /* ---------------------------------------------------------------------
   * MIGRAÇÃO do localStorage
   * --------------------------------------------------------------------- */

  let migracao = null;

  function migrarLocalStorage() {
    if (migracao) return migracao;
    migracao = (async () => {
      let bruto = null;
      try {
        bruto = window.localStorage.getItem(CONFIG_CARTEIRA.CHAVE_MIGRAR);
      } catch {
        return;
      }
      try {
        const antigo = bruto ? JSON.parse(bruto) : null;
        if (antigo?.dias && typeof antigo.dias === 'object') {
          const existentes = new Set(await listarDias());
          for (const [dia, conteudo] of Object.entries(antigo.dias)) {
            if (existentes.has(dia) || !conteudo?.agregado || !ehDataIso(dia)) continue;
            await gravarDia({ data: dia, agregado: expandirAgregado(conteudo.agregado), detalhe: conteudo.detalhe });
          }
        }
      } catch (erro) {
        console.warn('[Carteira] Não consegui migrar o histórico antigo -- mantido no localStorage pra próxima tentativa.', erro?.message);
        migracao = null;
        return;
      }
      CONFIG_CARTEIRA.CHAVES_ANTIGAS.forEach((chave) => {
        try {
          window.localStorage.removeItem(chave);
        } catch {
          // sem acesso ao armazenamento: nada a liberar
        }
      });
    })();
    return migracao;
  }

  /* ---------------------------------------------------------------------
   * FOTOGRAFIA DO DIA
   * --------------------------------------------------------------------- */

  let capturaEmAndamento = null;

  /**
   * Tira a fotografia do dia a partir da lista, se houver lista. Grava o
   * BRUTO; nenhum cálculo acontece antes da gravação. Registra o resultado
   * (sucesso ou falha) no status e avisa por toast quando falha.
   *
   * Duas chamadas ao mesmo tempo (carga da página + Alt+M) viram uma só.
   *
   * @param {{lista?: object[], hoje?: Date}} [opcoes]
   * @returns {Promise<object|null>} O agregado do dia (calculado DEPOIS de
   *   gravar), ou null se não havia lista.
   */
  function capturarFotografia(opcoes = {}) {
    if (capturaEmAndamento && !opcoes.lista && !opcoes.forcar) return capturaEmAndamento;
    const execucao = capturarAgora(opcoes).finally(() => {
      if (capturaEmAndamento === execucao) capturaEmAndamento = null;
    });
    if (!opcoes.lista) capturaEmAndamento = execucao;
    return execucao;
  }

  async function capturarAgora(opcoes) {
    const lista = opcoes.lista ?? window.CLIENTES;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    // Lista de outra pessoa (ex.: atendendo pela conta da colega): não é
    // a carteira configurada, não fotografa.
    if (clientesDaCarteira(lista).length === 0) return null;

    const agora = opcoes.hoje ?? new Date();
    const hojeIso = isoDe(agora);
    gravarStatus({ ultimaTentativa: agora.toISOString() });

    const filtros = filtrosAtivosNaLista(lista);
    if (filtros) {
      gravarStatus({ ultimaListaFiltrada: { quando: agora.toISOString(), data: hojeIso, filtros } });
      console.warn(`[Carteira] Lista com filtro (${filtros.join(', ')}) -- a fotografia do dia só é tirada da lista completa.`);
      // Avisa na tela só enquanto o dia ainda não tem fotografia: com ela já
      // tirada, abrir a lista filtrada é o uso normal e não precisa de aviso.
      let semFotoHoje = true;
      try {
        semFotoHoje = !(await lerDia(hojeIso));
      } catch (erro) {
        semFotoHoje = true;
      }
      if (semFotoHoje) {
        util()?.toast?.(`Carteira: a fotografia de hoje só é tirada com a lista SEM filtro (ligado: ${filtros.join(', ')}). Abra a lista sem filtro uma vez hoje.`, 8000);
      }
      return null;
    }

    let registro;
    try {
      ({ registro } = montarRegistro(lista, agora));
      await migrarLocalStorage();
      const existente = decodificar(await lerDia(hojeIso));
      // forcar: "Tirar nova fotografia de hoje" substitui mesmo com menos
      // clientes (a primeira pode ter saído errada). Fica registrado no status.
      const substitui = opcoes.forcar || !existente || existente.legado || registro.totalLista > existente.totalLista;
      if (opcoes.forcar && existente) {
        gravarStatus({ fotografiaRefeita: { quando: agora.toISOString(), data: hojeIso, antes: existente.totalLista, depois: registro.totalLista } });
      }
      if (substitui) {
        await gravarDia(registro);
        registro.alertas.forEach((a) => console.warn(`[Carteira] Alerta nos dados de ${ddmm(hojeIso)}: ${descreverAlerta(a)}`));
      } else {
        registro = null;
      }
      gravarStatus({
        ultimoSucesso: { quando: agora.toISOString(), data: hojeIso, clientes: lista.length, gravou: substitui },
        ultimoErro: null,
      });
    } catch (erro) {
      const mensagem = erro?.message ?? String(erro);
      gravarStatus({ ultimoErro: { quando: agora.toISOString(), data: hojeIso, mensagem } });
      console.warn('[Carteira] A fotografia de hoje NÃO foi gravada.', erro);
      util()?.toast?.(`Carteira: a fotografia de hoje não foi gravada (${mensagem}). Abra o Alt+M.`);
      return null;
    }

    // Limpeza e persistência DEPOIS de gravar: nada disso pode impedir a
    // gravação, e uma falha aqui não apaga o sucesso acima.
    try {
      const datas = await listarDias();
      await apagarDias(datas.filter((d) => {
        const idade = diasEntre(d, hojeIso);
        return idade === null || idade > CONFIG_CARTEIRA.DIAS_RETENCAO;
      }));
    } catch (erro) {
      console.warn('[Carteira] Falha ao apagar fotografias antigas (sem perda de dados).', erro?.message);
    }
    const persistente = await pedirPersistencia();
    if (persistente !== null) gravarStatus({ persistente });

    // Lembrete de backup, no máximo uma vez por dia, na abertura da lista.
    try {
      const status = lerStatus();
      const s = situacaoBackup(status, (await listarDias())[0] ?? null, agora);
      if (s.atrasado && status.ultimoLembreteBackup !== hojeIso) {
        util()?.toast?.(textoLembreteBackup(s), 8000);
        gravarStatus({ ultimoLembreteBackup: hojeIso });
      }
    } catch (erro) {
      console.warn('[Carteira] Falha ao conferir o backup (sem perda de dados).', erro?.message);
    }

    try {
      return agregadoDe(decodificar(registro ?? await lerDia(hojeIso)));
    } catch (erro) {
      console.warn('[Carteira] Fotografia gravada, mas o cálculo falhou.', erro);
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * COMPARAÇÃO, CURA E PONTE (calculadas na leitura)
   * --------------------------------------------------------------------- */

  function datasDo(historico) {
    return Object.keys(historico.dias).sort();
  }

  /**
   * Data de referência pra comparação: a mais recente com pelo menos
   * DIAS_COMPARACAO dias. Sem nenhuma, a mais antiga (a tela diz a data).
   * `compativelCom`: só datas com clientes no mesmo esquema de hash (pra
   * cura e ponte).
   */
  function dataDeComparacao(historicoOuDatas, hojeIso, compativelCom = null) {
    let datas = Array.isArray(historicoOuDatas) ? [...historicoOuDatas].sort() : datasDo(historicoOuDatas);
    if (compativelCom && !Array.isArray(historicoOuDatas)) {
      datas = datas.filter((d) => {
        const dia = historicoOuDatas.dias[d];
        return Array.isArray(dia?.clientes) && dia.hashVersao === compativelCom.hashVersao;
      });
    }
    const anteriores = datas.filter((d) => d < hojeIso);
    if (anteriores.length === 0) return null;
    const limite = somarDias(hojeIso, -CONFIG_CARTEIRA.DIAS_COMPARACAO);
    const elegiveis = anteriores.filter((d) => d <= limite);
    return elegiveis.length > 0 ? elegiveis[elegiveis.length - 1] : anteriores[0];
  }

  /** Clientes da carteira de um dia, indexados pelo hash. */
  function mapaDoDia(dia) {
    return new Map((dia?.clientes ?? []).filter(ehDaCarteira).map((c) => [c.h, c]));
  }

  /** Os dois dias existem, têm clientes e o mesmo esquema de hash? */
  function comparaveis(a, b) {
    return Boolean(a && b && Array.isArray(a.clientes) && Array.isArray(b.clientes) && a.hashVersao === b.hashVersao);
  }

  /**
   * CURA: quem estava no escopo na origem, onde está no destino
   * (quitaram / seguem / analista), por faixa de origem.
   * @returns {object|null}
   */
  function calcularCura(historico, deIso, ateIso) {
    const a = historico.dias[deIso];
    const b = historico.dias[ateIso];
    if (!comparaveis(a, b)) return null;
    const destino = mapaDoDia(b);
    const vazia = (rotulo) => ({ rotulo, clientes: 0, pagaram: 0, seguem: 0, analista: 0, valorOrigem: 0, valorCurado: 0, valorAnalista: 0 });
    const faixas = CONFIG_CARTEIRA.FAIXAS_AGING.map((f) => vazia(f.rotulo));
    const total = vazia('Total');
    mapaDoDia(a).forEach((c, h) => {
      if (estadoDe(c) !== 'escopo') return;
      const vencida = numero(c.dividaVencida);
      const i = indiceFaixa(diasDe(c));
      const depois = estadoDe(destino.get(h));
      let para = 'seguem';
      if (quitou(depois)) para = 'pagaram';
      else if (depois === 'analista') para = 'analista';
      [total, faixas[i]].forEach((l) => {
        l.clientes += 1;
        l.valorOrigem += vencida;
        l[para] += 1;
        if (para === 'pagaram') l.valorCurado += vencida;
        if (para === 'analista') l.valorAnalista += vencida;
      });
    });
    return { de: deIso, ate: ateIso, janela: diasEntre(deIso, ateIso), faixas, total };
  }

  /**
   * PONTE: vencido de A + entraram + aumentaram − parcial − quitaram −
   * analista = vencido de B. Fecha por construção; `diferenca` ~0.
   * @returns {object|null}
   */
  function calcularPonte(historico, deIso, ateIso) {
    const a = historico.dias[deIso];
    const b = historico.dias[ateIso];
    if (!comparaveis(a, b)) return null;
    const mapaA = mapaDoDia(a);
    const mapaB = mapaDoDia(b);
    const noEscopo = (c) => (estadoDe(c) === 'escopo' ? numero(c.dividaVencida) : 0);
    const cat = () => ({ clientes: 0, valor: 0 });
    const p = {
      de: deIso, ate: ateIso, janela: diasEntre(deIso, ateIso),
      inicial: cat(), entraram: cat(), aumentaram: cat(), reduziram: cat(), pagaram: cat(), analista: cat(), final: cat(),
    };
    const somar = (categoria, valor) => { p[categoria].clientes += 1; p[categoria].valor += valor; };
    new Set([...mapaA.keys(), ...mapaB.keys()]).forEach((h) => {
      const va = noEscopo(mapaA.get(h));
      const vb = noEscopo(mapaB.get(h));
      if (va > 0) somar('inicial', va);
      if (vb > 0) somar('final', vb);
      if (va > 0 && vb > 0) {
        if (vb > va) somar('aumentaram', vb - va);
        else if (vb < va) somar('reduziram', va - vb);
      } else if (vb > 0) {
        somar('entraram', vb);
      } else if (va > 0) {
        if (estadoDe(mapaB.get(h)) === 'analista') somar('analista', va);
        else somar('pagaram', va);
      }
    });
    const arred = (v) => Math.round(v * 100) / 100;
    Object.values(p).forEach((v) => { if (v && typeof v === 'object') v.valor = arred(v.valor); });
    p.diferenca = arred(p.inicial.valor + p.entraram.valor + p.aumentaram.valor
      - p.reduziram.valor - p.pagaram.valor - p.analista.valor - p.final.valor);
    return p;
  }

  /** Cura compacta (pra série semanal e CSV). */
  function resumoDaCura(cura) {
    if (!cura) return null;
    const t = cura.total;
    return {
      de: cura.de,
      janela: cura.janela,
      clientes: t.clientes,
      pagaram: t.pagaram,
      seguem: t.seguem,
      analista: t.analista,
      valorOrigem: Math.round(t.valorOrigem * 100) / 100,
      valorCurado: Math.round(t.valorCurado * 100) / 100,
      valorAnalista: Math.round(t.valorAnalista * 100) / 100,
      faixas: cura.faixas.map((f) => [f.clientes, f.pagaram, f.seguem, f.analista]),
    };
  }

  /**
   * Ponte e cura de um dia contra a sua comparação (7+ dias antes, mesmo
   * esquema de hash). Legado: usa o que foi gravado na época, se houver.
   */
  function ponteECuraDe(historico, data) {
    const dia = historico.dias[data];
    if (!dia) return { ponte: null, cura: null };
    if (dia.legado) {
      return { ponte: dia.agregadoLegado?.ponte ?? null, cura: dia.agregadoLegado?.cura ?? null, legado: true };
    }
    const comparacao = dataDeComparacao(historico, data, dia);
    if (!comparacao || diasEntre(comparacao, data) < CONFIG_CARTEIRA.DIAS_COMPARACAO) return { ponte: null, cura: null };
    return {
      ponte: calcularPonte(historico, comparacao, data),
      cura: resumoDaCura(calcularCura(historico, comparacao, data)),
    };
  }

  /** Cura semana a semana: a última fotografia de cada semana com cura. */
  function curaSemanal(historico, limite = CONFIG_CARTEIRA.SEMANAS_CURA) {
    const u = util();
    const porSemana = new Map();
    datasDo(historico).forEach((data) => {
      const { cura } = ponteECuraDe(historico, data);
      if (!cura) return;
      const semana = u?.semanaSabadoASexta?.(dataDeIso(data))?.inicioIso ?? data;
      porSemana.set(semana, { semana, dia: data, ...cura });
    });
    return [...porSemana.values()].sort((a, b) => (a.semana < b.semana ? 1 : -1)).slice(0, limite);
  }

  /**
   * Dias úteis (seg–sex) sem fotografia nos últimos DIAS_LACUNAS dias, a
   * partir da primeira fotografia (antes dela não é lacuna, é "ainda não
   * existia"). Hoje só conta se já passou do meio-dia -- de manhã a lista
   * pode simplesmente ainda não ter sido aberta.
   */
  function lacunas(datas, agora) {
    if (datas.length === 0) return [];
    const hojeIso = isoDe(agora);
    const tem = new Set(datas);
    const primeira = [...datas].sort()[0];
    const faltam = [];
    for (let i = CONFIG_CARTEIRA.DIAS_LACUNAS; i >= 0; i -= 1) {
      const d = somarDias(hojeIso, -i);
      if (d < primeira || tem.has(d)) continue;
      const semana = dataDeIso(d).getDay();
      if (semana === 0 || semana === 6) continue;
      if (d === hojeIso && agora.getHours() < 12) continue;
      faltam.push(d);
    }
    return faltam;
  }

  /**
   * O backup está em dia? Referência: o último backup baixado; sem nenhum,
   * a primeira fotografia (antes de existir histórico não há o que perder).
   *
   * @param {object} status lerStatus()
   * @param {string|null} primeiraData Primeira fotografia (AAAA-MM-DD).
   * @param {Date} agora
   * @returns {{atrasado: boolean, dias: number|null, ultimo: string|null}}
   */
  function situacaoBackup(status, primeiraData, agora) {
    const ultimo = ehDataIso(status?.ultimoBackup?.data) ? status.ultimoBackup.data : null;
    const referencia = ultimo ?? primeiraData;
    if (!referencia) return { atrasado: false, dias: null, ultimo };
    const dias = diasEntre(referencia, isoDe(agora));
    return { atrasado: dias !== null && dias >= CONFIG_CARTEIRA.DIAS_LEMBRETE_BACKUP, dias, ultimo };
  }

  function textoLembreteBackup(s) {
    return s.ultimo
      ? `Carteira: o último backup do histórico foi há ${s.dias} dias. Abra o Alt+M e clique em "Baixar backup".`
      : `Carteira: o histórico (${s.dias} dias) ainda não tem nenhum backup. Abra o Alt+M e clique em "Baixar backup".`;
  }

  /* ---------------------------------------------------------------------
   * RÉGUA x RESULTADO (diário do Módulo 8 x fotografias)
   * --------------------------------------------------------------------- */

  function faixaDeHorario(minutos) {
    const i = CONFIG_CARTEIRA.FAIXAS_HORARIO.findIndex((f) => minutos < f.ate);
    return i >= 0 ? i : CONFIG_CARTEIRA.FAIXAS_HORARIO.length - 1;
  }

  /**
   * Para cada cliente na fila do Alt+U num dia D (régua atual), se QUITOU
   * em até JANELA_RESULTADO_DIAS pelas fotografias (formato 3). Janela
   * ainda aberta fica fora da taxa; sem fotografia de base no escopo, é
   * ignorado. Por faixa (contatado x não) e por hora do primeiro contato.
   */
  function analisarRegua(historico, eventos, versaoRegua) {
    const datas = datasDo(historico).filter((d) => historico.dias[d].formato === 3);
    const ultima = datas[datas.length - 1] ?? null;
    const mapas = new Map(datas.map((d) => [d, mapaDoDia(historico.dias[d])]));

    const contatos = new Map();
    eventos.filter((e) => e?.t === 'contato' && e.c).forEach((e) => {
      const chave = `${hashCnpj(e.c)}|${e.d}`;
      const hora = typeof e.h === 'number' ? e.h : 0;
      const atual = contatos.get(chave);
      if (atual === undefined || hora < atual) contatos.set(chave, hora);
    });

    const atribuicoes = new Map();
    eventos.filter((e) => e?.t === 'fila' && e.c && (versaoRegua == null || e.r === versaoRegua)).forEach((e) => {
      const chave = `${hashCnpj(e.c)}|${e.d}`;
      if (!atribuicoes.has(chave)) atribuicoes.set(chave, e);
    });

    const faixasMap = new Map();
    const horarios = CONFIG_CARTEIRA.FAIXAS_HORARIO.map((f) => ({ rotulo: f.rotulo, contatos: 0, base: 0, pagou: 0 }));
    const novaFaixa = (f) => ({ faixa: f, naFila: 0, contatados: 0, baseContatados: 0, pagouContatados: 0, baseNao: 0, pagouNao: 0 });
    let semBase = 0;
    let abertos = 0;

    atribuicoes.forEach((e, chave) => {
      const hash = Number(chave.split('|')[0]);
      const dia = isoDoDiario(e.d);
      if (!dia) return;
      const linhaFaixa = faixasMap.get(e.f) ?? novaFaixa(e.f);
      faixasMap.set(e.f, linhaFaixa);
      linhaFaixa.naFila += 1;
      const hora = contatos.get(chave);
      const contatado = hora !== undefined;
      if (contatado) linhaFaixa.contatados += 1;

      const baseDia = datas.filter((d) => d <= dia && diasEntre(d, dia) <= 3).pop();
      if (!baseDia || estadoDe(mapas.get(baseDia).get(hash)) !== 'escopo') {
        semBase += 1;
        return;
      }
      const fim = somarDias(dia, CONFIG_CARTEIRA.JANELA_RESULTADO_DIAS);
      const pagou = datas.some((d) => d > dia && d <= fim && quitou(estadoDe(mapas.get(d).get(hash))));
      if (!pagou && (ultima === null || ultima < fim)) {
        abertos += 1;
        return;
      }
      if (contatado) {
        linhaFaixa.baseContatados += 1;
        if (pagou) linhaFaixa.pagouContatados += 1;
        const hz = horarios[faixaDeHorario(hora)];
        hz.contatos += 1;
        hz.base += 1;
        if (pagou) hz.pagou += 1;
      } else {
        linhaFaixa.baseNao += 1;
        if (pagou) linhaFaixa.pagouNao += 1;
      }
    });

    return {
      faixas: [...faixasMap.values()].sort((a, b) => a.faixa - b.faixa),
      horarios,
      semBase,
      abertos,
      atribuicoes: atribuicoes.size,
    };
  }

  function eventosDoDiario() {
    try {
      const d = window.__diario;
      if (!d || typeof d.eventos !== 'function') return [];
      return d.eventos({ ultimosDias: CONFIG_CARTEIRA.DIAS_DIARIO }) ?? [];
    } catch (erro) {
      console.warn('[Carteira] Não consegui ler o diário.', erro?.message);
      return [];
    }
  }

  /* ---------------------------------------------------------------------
   * RESULTADO DO PERÍODO (API do Alt+D) E PREVISÃO
   * --------------------------------------------------------------------- */

  function linhaDe(dados, secao, nomes) {
    const u = util();
    const lista = dados?.[secao]?.porUsuario;
    if (!Array.isArray(lista)) return [];
    return lista.filter((item) => nomes.includes(u?.primeiroNomeDeUsuario?.(item?.usuario) ?? ''));
  }

  function somaCampo(linhas, campo) {
    return linhas.reduce((s, l) => s + numero(l?.[campo]), 0);
  }

  /**
   * Resultado de um período para as PESSOAS. Cumprimento por VALOR, só
   * entre as decididas: cumprido / (cumprido + quebrado).
   *
   * RECUPERADO: as promessas cumpridas vêm de `pagas` -- a MESMA apuração do
   * Alt+D (Módulo 10), pelo dia estimado do pagamento. O `cumprido` do
   * consolidado agrupa pela data da promessa (outro número, mesmo rótulo) e
   * fica só na taxa de cumprimento, que é por promessa.
   * @param {object} dados O `data` do consolidado.
   * @param {{valor: number, quantidade: number, semValor: number}|{erro: string}} [pagas]
   *   Sem `pagas` (ou com erro), o recuperado fica null (indisponível), nunca parcial.
   */
  function resumirPeriodo(dados, pagas) {
    const nomes = CONFIG_CARTEIRA.PESSOAS;
    const dep = linhaDe(dados, 'depositos', nomes);
    const prom = linhaDe(dados, 'promessas', nomes);
    const aco = linhaDe(dados, 'acordos', nomes);
    const con = linhaDe(dados, 'contatos', nomes);
    const cumprido = somaCampo(prom, 'cumprido');
    const quebrado = somaCampo(prom, 'quebrado');
    const decididas = cumprido + quebrado;
    const depositos = somaCampo(dep, 'valor');
    const pagasValidas = pagas && typeof pagas.valor === 'number' && Number.isFinite(pagas.valor) ? pagas : null;
    return {
      depositos,
      recuperado: pagasValidas ? depositos + pagasValidas.valor : null,
      cumpridasPeloPagamento: pagasValidas ?? { erro: pagas?.erro ?? 'não lida' },
      promessas: {
        quantidade: somaCampo(prom, 'quantidade'),
        prometido: somaCampo(prom, 'prometido'),
        cumprido,
        quebrado,
        emAberto: somaCampo(prom, 'emAberto'),
        cumprimento: decididas > 0 ? cumprido / decididas : null,
      },
      acordos: {
        quantidade: somaCampo(aco, 'quantidade'),
        valor: somaCampo(aco, 'valor'),
        pagos: somaCampo(aco, 'pagos'),
        pendente: somaCampo(aco, 'pendente'),
      },
      contatos: {
        unicos: somaCampo(con, 'contatosUnicos'),
        registros: somaCampo(con, 'registrosTotais'),
      },
    };
  }

  function periodos(hoje) {
    const u = util();
    const base = hoje ?? new Date();
    const hojeIso = isoDe(base);
    const semana = u?.semanaSabadoASexta?.(base);
    return [
      { chave: 'semana', rotulo: 'Semana', inicioIso: semana?.inicioIso ?? hojeIso, fimIso: semana?.fimIso ?? hojeIso },
      { chave: 'mes', rotulo: 'Mês', inicioIso: `${hojeIso.slice(0, 8)}01`, fimIso: hojeIso },
      {
        chave: 'taxa',
        rotulo: `Últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias`,
        inicioIso: somarDias(hojeIso, -(CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO - 1)),
        fimIso: hojeIso,
      },
    ];
  }

  /**
   * Promessas cumpridas no período pelo critério do Alt+D (dia estimado do
   * pagamento), só das PESSOAS. Nunca lança: erro vira `{erro}` e o painel
   * mostra "indisponível" no lugar do número.
   */
  async function cumpridasPeloPagamento(periodo) {
    const buscarPromessas = window.__recebidoSemana?.buscarPromessasDaSemana;
    if (typeof buscarPromessas !== 'function') return { erro: 'o Alt+D desta versão não lê promessas (atualize o SmartTable)' };
    try {
      const r = await buscarPromessas({ inicio: dataDeIso(periodo.inicioIso), inicioIso: periodo.inicioIso, fimIso: periodo.fimIso });
      const minhas = (r?.porPessoa ?? []).filter((p) => CONFIG_CARTEIRA.PESSOAS.includes(p.nome));
      return {
        valor: minhas.reduce((s, p) => s + numero(p.valor), 0),
        quantidade: minhas.reduce((s, p) => s + numero(p.quantidade), 0),
        semValor: numero(r?.semValor),
      };
    } catch (erro) {
      console.warn('[Carteira] Falha ao ler as promessas cumpridas do período:', erro?.message);
      return { erro: erro?.message ?? String(erro) };
    }
  }

  async function buscarResultado(hoje) {
    const buscar = window.__recebidoSemana?.buscarConsolidado;
    if (typeof buscar !== 'function') throw new Error('O Módulo 10 (Alt+D) não carregou -- sem acesso à API de resultado.');
    const lista = periodos(hoje);
    const [respostas, pagas] = await Promise.all([
      Promise.all(lista.map((p) => buscar(p.inicioIso, p.fimIso))),
      // A janela de 90 dias só serve para a taxa de cumprimento: não busca.
      Promise.all(lista.map((p) => (p.chave === 'taxa' ? null : cumpridasPeloPagamento(p)))),
    ]);
    return lista.map((p, i) => ({ ...p, resumo: resumirPeriodo(respostas[i], pagas[i] ?? undefined) }));
  }

  /** Promessas com data em até N dias × taxa real de cumprimento (90 dias). */
  function preverEntrada(agregado, taxa) {
    const proximos = agregado?.promessasPendentes?.proximos ?? {};
    return CONFIG_CARTEIRA.DIAS_PREVISAO.map((n) => {
      const bruto = proximos[n] ?? { clientes: 0, valor: 0 };
      return { dias: n, clientes: bruto.clientes, prometido: bruto.valor, esperado: taxa === null ? null : bruto.valor * taxa };
    });
  }

  /* ---------------------------------------------------------------------
   * EXPORTAÇÃO (CSV) E BACKUP
   * --------------------------------------------------------------------- */

  /**
   * Série diária (agregado + cura + ponte), CALCULADA AGORA a partir do
   * bruto de cada dia. Separador ';' e vírgula decimal. Só números.
   */
  function montarCsv(historico) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '');
    const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? num(v * 100) : '');
    const inteiro = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
    const razao = (a, b) => (b > 0 ? a / b : null);
    const colunas = [
      ['data', (a) => a.data],
      ['formato', (a, x) => (x.legado ? 'legado' : 'bruto')],
      ['clientes', (a) => inteiro(a.clientes)],
      ['divida_total_devedores', (a) => num(a.carteira)],
      ['vencido', (a) => num(a.vencido)],
      ['a_vencer', (a) => num(a.aVencer)],
      ['pct_em_cobranca', (a) => pct(a.pctVencido)],
      ['clientes_com_vencido', (a) => inteiro(a.clientesComVencido)],
      ['titulos_vencidos', (a) => inteiro(a.titulosVencidos)],
      ['scpc_clientes', (a) => inteiro(a.scpc?.clientes)],
      ['scpc_valor', (a) => num(a.scpc?.valor)],
      ['suspensos_clientes', (a) => inteiro(a.suspensos?.clientes)],
      ['suspensos_valor', (a) => num(a.suspensos?.valor)],
      ['promessas_pendentes', (a) => inteiro(a.promessasPendentes?.clientes)],
      ['promessas_pendentes_valor', (a) => num(a.promessasPendentes?.valor)],
      ...CONFIG_CARTEIRA.DIAS_PREVISAO.map((n) => [`promessas_proximos_${n}d_valor`, (a) => num(a.promessasPendentes?.proximos?.[n]?.valor)]),
      ['promessas_data_passada_valor', (a) => num(a.promessasPendentes?.valorVencidas)],
      ['acordos_inadimplentes', (a) => inteiro(a.acordosInadimplentes?.clientes)],
      ['acordos_inadimplentes_valor', (a) => num(a.acordosInadimplentes?.valor)],
      ['cobertura_7d_pct', (a) => pct(a.cobertura?.pct)],
      ['sem_movimentacao_30d', (a) => inteiro(a.semMovimentacao)],
      ['concentracao_top10_pct', (a) => pct(a.concentracaoTop)],
      ['fora_ate_1o_dia_clientes', (a) => inteiro(a.fora?.primeiroDia?.clientes)],
      ['fora_ate_1o_dia_valor', (a) => num(a.fora?.primeiroDia?.valor)],
      ['fora_analista_clientes', (a) => inteiro(a.fora?.analista?.clientes)],
      ['fora_analista_valor', (a) => num(a.fora?.analista?.valor)],
      ...CONFIG_CARTEIRA.FAIXAS_AGING.flatMap((f, i) => {
        const nome = f.min === f.max ? String(f.min) : `${f.min}_${f.max}`;
        return [
          [`aging_${nome}_clientes`, (a) => inteiro(a.faixas?.[i]?.clientes)],
          [`aging_${nome}_valor`, (a) => num(a.faixas?.[i]?.valor)],
        ];
      }),
      ['cura_desde', (a, x) => x.cura?.de ?? ''],
      ['cura_janela_dias', (a, x) => inteiro(x.cura?.janela)],
      ['cura_clientes', (a, x) => inteiro(x.cura?.clientes)],
      ['cura_pagaram', (a, x) => inteiro(x.cura?.pagaram)],
      ['cura_seguem', (a, x) => inteiro(x.cura?.seguem)],
      ['cura_analista', (a, x) => inteiro(x.cura?.analista)],
      ['cura_pct_pagaram', (a, x) => pct(razao(x.cura?.pagaram, x.cura?.clientes))],
      ['cura_pct_analista', (a, x) => pct(razao(x.cura?.analista, x.cura?.clientes))],
      ['cura_valor_curado', (a, x) => num(x.cura?.valorCurado)],
      ['cura_valor_analista', (a, x) => num(x.cura?.valorAnalista)],
      ...['inicial', 'entraram', 'aumentaram', 'reduziram', 'pagaram', 'analista', 'final']
        .map((k) => [`ponte_${k}_valor`, (a, x) => num(x.ponte?.[k]?.valor)]),
      ['alertas_dados', (a, x) => inteiro(x.alertas)],
    ];
    const linhas = [colunas.map(([nome]) => nome).join(';')];
    datasDo(historico).forEach((data) => {
      const dia = historico.dias[data];
      const a = agregadoDe(dia);
      if (!a) return;
      const { ponte, cura } = ponteECuraDe(historico, data);
      const extra = { legado: dia.legado, ponte, cura, alertas: dia.alertas.length };
      linhas.push(colunas.map(([, f]) => f(a, extra)).join(';'));
    });
    return linhas.join('\r\n');
  }

  function baixar(nome, conteudo, tipo) {
    const blob = new window.Blob([conteudo], { type: tipo });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(url);
      } catch {
        // liberar o link é faxina: se falhar, o arquivo já foi entregue
      }
    }, 1000);
  }

  async function exportarCsv() {
    const historico = await lerHistorico({ tudo: true });
    baixar(`carteira-${isoDe(new Date())}.csv`, '﻿' + montarCsv(historico), 'text/csv;charset=utf-8');
  }

  /** Backup completo: os registros EXATAMENTE como estão gravados. */
  async function montarBackup() {
    const registros = await lerRegistros(null);
    return JSON.stringify({
      tipo: 'smarttable-carteira-backup',
      versao: 1,
      geradoEm: new Date().toISOString(),
      registros: registros.sort((a, b) => (a.data < b.data ? -1 : 1)),
    });
  }

  async function exportarBackup() {
    const agora = new Date();
    baixar(`carteira-backup-${isoDe(agora)}.json`, await montarBackup(), 'application/json');
    // Registrado DEPOIS de o arquivo ser entregue ao navegador: se montar o
    // backup falhar, o lembrete continua valendo.
    gravarStatus({ ultimoBackup: { quando: agora.toISOString(), data: isoDe(agora) } });
  }

  /** O registro de um backup tem forma aceitável? */
  function registroValido(r) {
    if (!r || typeof r !== 'object' || !ehDataIso(r.data)) return false;
    if (r.formato === 3) {
      return Array.isArray(r.campos) && r.campos.every((c) => typeof c === 'string')
        && Array.isArray(r.linhas) && r.linhas.every((l) => Array.isArray(l) && l.length === r.campos.length + 3);
    }
    return Boolean(r.agregado && typeof r.agregado === 'object');
  }

  /**
   * Restaura um backup SEM apagar nada: dia que não existe entra; dia que
   * existe só é trocado se o do backup for estritamente mais completo
   * (bruto contra legado, ou mais clientes no mesmo formato).
   *
   * @param {string} texto Conteúdo do arquivo.
   * @returns {Promise<{importados: number, mantidos: number, invalidos: number}>}
   * @throws {Error} Se o arquivo não é um backup da Carteira.
   */
  async function importarBackup(texto) {
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error('O arquivo não é JSON.');
    }
    if (dados?.tipo !== 'smarttable-carteira-backup' || !Array.isArray(dados.registros)) {
      throw new Error('O arquivo não é um backup da Carteira.');
    }
    const resultado = { importados: 0, mantidos: 0, invalidos: 0 };
    for (const r of dados.registros) {
      if (!registroValido(r)) {
        resultado.invalidos += 1;
        continue;
      }
      const existente = decodificar(await lerDia(r.data));
      const novo = decodificar(r);
      const melhor = !existente
        || (existente.legado && !novo.legado)
        || (existente.legado === novo.legado && novo.totalLista > existente.totalLista);
      if (melhor) {
        await gravarDia(r);
        resultado.importados += 1;
      } else {
        resultado.mantidos += 1;
      }
    }
    return resultado;
  }

  /* ---------------------------------------------------------------------
   * DESENHO
   * --------------------------------------------------------------------- */

  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  function moeda(v) {
    return util()?.formatarMoeda?.(v) ?? String(v);
  }

  /** R$ sem centavos, pra caber nos cartões. */
  function moedaCurta(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function percentual(v, casas = 0) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
  }

  /**
   * "▲ 6%" / "▼ R$ 1.200" colorido pelo que é BOM para aquela métrica.
   *
   * @param {number} atual @param {number|undefined} anterior
   * @param {{bomQuandoCai?: boolean, formato?: 'relativo'|'pontos'|'inteiro'}} opcoes
   * @returns {HTMLElement|null}
   */
  function criarDelta(atual, anterior, { bomQuandoCai = true, formato = 'relativo' } = {}) {
    if (typeof anterior !== 'number' || !Number.isFinite(anterior)) return null;
    const diferenca = atual - anterior;
    let texto;
    if (formato === 'pontos') texto = `${Math.abs(diferenca * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`;
    else if (formato === 'inteiro') texto = String(Math.abs(diferenca));
    // De zero pra algo não tem porcentagem: é "novo".
    else texto = anterior !== 0 ? percentual(Math.abs(diferenca / anterior)) : 'novo';
    const igual = Math.abs(diferenca) < 1e-9;
    const bom = igual ? null : (diferenca < 0) === bomQuandoCai;
    return criarDiv(igual ? '= igual' : (texto === 'novo' ? '▲ novo' : `${diferenca > 0 ? '▲' : '▼'} ${texto}`), {
      fontSize: '11px',
      fontWeight: '600',
      color: bom === null ? CORES.apagado : bom ? CORES.bom : CORES.ruim,
    });
  }

  function criarCartao(rotulo, valor, detalhe, delta) {
    const cartao = criarDiv('', {
      background: CORES.cartao, border: `1px solid ${CORES.linha}`, borderRadius: '8px',
      padding: '8px 10px', minWidth: '0',
    });
    cartao.appendChild(criarDiv(rotulo, { color: CORES.apagado, fontSize: '11px', marginBottom: '2px' }));
    const linha = criarDiv('', { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' });
    linha.appendChild(criarDiv(valor, {
      color: CORES.tinta, fontWeight: '700', fontSize: '15px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }));
    if (delta) linha.appendChild(delta);
    cartao.appendChild(linha);
    if (detalhe) cartao.appendChild(criarDiv(detalhe, { color: CORES.texto, fontSize: '11px', marginTop: '2px' }));
    return cartao;
  }

  function criarTitulo(texto, detalhe) {
    const bloco = criarDiv('', { margin: '14px 0 6px' });
    bloco.appendChild(criarDiv(texto, { color: CORES.tinta, fontWeight: '700', fontSize: '13px' }));
    if (detalhe) bloco.appendChild(criarDiv(detalhe, { color: CORES.apagado, fontSize: '11px' }));
    return bloco;
  }

  /** Tabela simples: cabeçalho + linhas de texto; colunas 1+ alinhadas à direita. */
  function criarTabela(cabecalho, linhas) {
    const tabela = document.createElement('table');
    Object.assign(tabela.style, { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
    const tr = document.createElement('tr');
    cabecalho.forEach((texto, i) => {
      const th = document.createElement('th');
      th.textContent = texto;
      Object.assign(th.style, {
        textAlign: i === 0 ? 'left' : 'right', color: CORES.apagado, fontWeight: '600', fontSize: '11px',
        padding: '3px 4px', borderBottom: `1px solid ${CORES.borda}`, whiteSpace: 'nowrap',
      });
      tr.appendChild(th);
    });
    tabela.appendChild(tr);
    linhas.forEach((celulas, iLinha) => {
      const linha = document.createElement('tr');
      celulas.forEach((conteudo, i) => {
        const td = document.createElement('td');
        // Rótulo começando com dois espaços = sub-linha (composição da linha
        // de cima). Recuo por CSS, porque o HTML colapsa os espaços.
        const subLinha = i === 0 && typeof conteudo === 'string' && conteudo.startsWith('  ');
        if (conteudo instanceof window.Node) td.appendChild(conteudo);
        else td.textContent = subLinha ? conteudo.trim() : conteudo;
        Object.assign(td.style, {
          textAlign: i === 0 ? 'left' : 'right', padding: '3px 4px', color: CORES.texto, whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          borderBottom: iLinha === linhas.length - 1 ? 'none' : `1px solid ${CORES.linha}`,
        });
        if (subLinha) Object.assign(td.style, { paddingLeft: '16px', color: CORES.apagado });
        linha.appendChild(td);
      });
      tabela.appendChild(linha);
    });
    return tabela;
  }

  /** Barra proporcional dentro da célula do aging. */
  function criarBarra(fracao) {
    const trilho = criarDiv('', {
      display: 'inline-block', width: '60px', height: '6px', background: CORES.linha, borderRadius: '3px',
      verticalAlign: 'middle', overflow: 'hidden',
    });
    trilho.appendChild(criarDiv('', {
      width: `${Math.max(0, Math.min(1, fracao)) * 100}%`, height: '100%', background: CORES.barra,
    }));
    return trilho;
  }

  /** Linha do vencido nos últimos DIAS_TENDENCIA dias, calculada agora (SVG). */
  function criarTendencia(historico, hojeIso) {
    const inicio = somarDias(hojeIso, -CONFIG_CARTEIRA.DIAS_TENDENCIA);
    const pontos = datasDo(historico)
      .filter((d) => d >= inicio && d <= hojeIso)
      .map((d) => ({ d, v: agregadoDe(historico.dias[d])?.vencido }))
      .filter((p) => typeof p.v === 'number');
    if (pontos.length < 2) {
      return criarDiv('A linha aparece a partir da segunda fotografia (abra a lista amanhã).', {
        color: CORES.apagado, fontSize: '11.5px',
      });
    }
    const largura = 480;
    const altura = 48;
    const valores = pontos.map((p) => p.v);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const faixa = max - min || 1;
    const coords = pontos.map((p, i) => {
      const x = (i / (pontos.length - 1)) * (largura - 4) + 2;
      const y = altura - 4 - ((p.v - min) / faixa) * (altura - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(altura));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Vencido por dia');
    const linha = document.createElementNS(ns, 'polyline');
    linha.setAttribute('points', coords.join(' '));
    linha.setAttribute('fill', 'none');
    linha.setAttribute('stroke', CORES.barra);
    linha.setAttribute('stroke-width', '2');
    svg.appendChild(linha);

    const bloco = criarDiv('', {});
    bloco.appendChild(svg);
    const legenda = criarDiv('', { display: 'flex', justifyContent: 'space-between', color: CORES.apagado, fontSize: '11px' });
    legenda.appendChild(criarDiv(`${ddmm(pontos[0].d)} · ${moedaCurta(pontos[0].v)}`));
    legenda.appendChild(criarDiv(`mín ${moedaCurta(min)} · máx ${moedaCurta(max)}`));
    legenda.appendChild(criarDiv(`${ddmm(pontos[pontos.length - 1].d)} · ${moedaCurta(pontos[pontos.length - 1].v)}`));
    bloco.appendChild(legenda);
    return bloco;
  }

  function aviso(textoAviso, cor = CORES.apagado) {
    return criarDiv(textoAviso, { color: cor, fontSize: '11.5px', lineHeight: '1.45' });
  }

  function comPct(parte, total) {
    return `${parte} (${percentual(total ? parte / total : 0)})`;
  }

  /** Taxa com amostra mínima: abaixo dela é ruído, e a tela diz "--". */
  function taxa(parte, base) {
    if (!(base >= CONFIG_CARTEIRA.AMOSTRA_MINIMA)) return base > 0 ? `-- (${parte}/${base})` : '--';
    return `${percentual(parte / base)} (${parte}/${base})`;
  }

  /** A fotografia mais recente até hoje e a de comparação. */
  function pontasDe(historico, hojeIso) {
    const dia = datasDo(historico).filter((d) => d <= hojeIso).pop() ?? null;
    const a = dia ? agregadoDe(historico.dias[dia]) : null;
    const comparacao = dia ? dataDeComparacao(historico, dia) : null;
    const b = comparacao ? agregadoDe(historico.dias[comparacao]) : null;
    return { dia, a, comparacao, b };
  }

  const horaDe = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /**
   * "Tirar nova fotografia de hoje". Só na lista de clientes e só com a lista
   * COMPLETA (mesma regra da captura automática). Substitui a de hoje depois de
   * confirmar, mesmo com menos clientes. Dias anteriores não se refazem.
   */
  function criarBotaoNovaFotografia() {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Tirar nova fotografia de hoje';
    botao.dataset.papel = 'nova-fotografia';
    Object.assign(botao.style, {
      marginTop: '6px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer',
      border: `1px solid ${CORES.linha}`, background: '#fff', fontSize: '12px', fontWeight: '600',
    });
    const naLista = Array.isArray(window.CLIENTES) && clientesDaCarteira(window.CLIENTES).length > 0;
    if (!naLista) {
      botao.disabled = true;
      botao.title = 'Abra a lista de clientes';
      botao.style.cursor = 'not-allowed';
      botao.style.opacity = '0.5';
    }
    botao.addEventListener('click', () => {
      tirarNovaFotografia().catch((erro) => console.warn('[Carteira] Falha ao tirar a nova fotografia.', erro));
    });
    return botao;
  }

  async function tirarNovaFotografia() {
    const lista = window.CLIENTES;
    if (!Array.isArray(lista) || clientesDaCarteira(lista).length === 0) {
      util()?.toast?.('Abra a lista de clientes pra tirar a fotografia.');
      return false;
    }
    const filtros = filtrosAtivosNaLista(lista);
    if (filtros) {
      util()?.toast?.(`A lista está com filtro (${filtros.join(', ')}). Limpe os filtros e tente de novo.`, 8000);
      return false;
    }
    let existente = null;
    try {
      existente = decodificar(await lerDia(isoDe(new Date())));
    } catch (erro) {
      existente = null;
    }
    const pergunta = existente
      ? `Substituir a fotografia de hoje (${existente.totalLista} clientes${existente.capturadoEm ? `, tirada às ${horaDe(existente.capturadoEm)}` : ''}) pela lista atual (${lista.length} clientes)?`
      : `Tirar a fotografia de hoje com a lista atual (${lista.length} clientes)?`;
    if (!window.confirm(pergunta)) return false;
    await capturarFotografia({ forcar: true });
    if (painelEl) await abrirPainel();
    return true;
  }

  /**
   * Saúde do histórico: resultado da última gravação, lacunas, persistência,
   * alertas de dados do dia. É o "nenhum erro passa em silêncio" na tela.
   */
  function desenharSaude(corpo, historico, dia, agora) {
    const status = lerStatus();
    const bloco = criarDiv('', { marginTop: '12px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}` });
    bloco.dataset.papel = 'saude';
    bloco.appendChild(criarTitulo('Saúde do histórico'));

    const erro = status.ultimoErro;
    const sucesso = status.ultimoSucesso;
    if (erro && (!sucesso || erro.quando > sucesso.quando)) {
      bloco.appendChild(aviso(
        `A ÚLTIMA GRAVAÇÃO FALHOU (${new Date(erro.quando).toLocaleString('pt-BR')}): ${erro.mensagem}. ` +
          'Abra a lista de novo; se repetir, faça um backup e me avise.',
        CORES.ruim
      ));
    } else if (sucesso) {
      bloco.appendChild(aviso(`Última leitura da lista: ${new Date(sucesso.quando).toLocaleString('pt-BR')} · ${sucesso.clientes} clientes · ` +
        (sucesso.gravou ? 'gravada' : 'mantida a fotografia de abertura do dia')));
    }
    const filtrada = status.ultimaListaFiltrada;
    // Só enquanto o dia não tem fotografia (olhando o HISTÓRICO, que é a
    // fonte da verdade): depois dela, lista filtrada é uso normal.
    if (filtrada && filtrada.data === isoDe(agora) && !datasDo(historico).includes(filtrada.data)) {
      bloco.appendChild(aviso(
        `A lista estava com filtro (${filtrada.filtros.join(', ')}) e não foi fotografada. ` +
          'A fotografia do dia só sai da lista completa: abra a lista sem filtro.',
        CORES.alerta
      ));
    }
    const refeita = status.fotografiaRefeita;
    if (refeita && refeita.data === isoDe(agora)) {
      bloco.appendChild(aviso(`Fotografia de hoje refeita às ${horaDe(refeita.quando)} (antes ${refeita.antes}, agora ${refeita.depois} clientes).`));
    }
    bloco.appendChild(criarBotaoNovaFotografia());
    if (usandoMemoria) {
      bloco.appendChild(aviso('Sem IndexedDB neste navegador: o histórico vive só nesta aba e se perde ao fechar.', CORES.ruim));
    }
    if (status.persistente === false) {
      bloco.appendChild(aviso('O navegador não garantiu o armazenamento como permanente: sob falta de espaço em disco ele pode apagar o histórico. Faça backup de vez em quando.', CORES.alerta));
    }
    const backup = situacaoBackup(status, datasDo(historico)[0] ?? null, agora);
    const haQuanto = backup.dias === 0 ? 'hoje' : `há ${backup.dias} dia${backup.dias === 1 ? '' : 's'}`;
    const quandoBackup = backup.ultimo ? `Último backup: ${ddmm(backup.ultimo)} (${haQuanto})` : 'Nenhum backup ainda';
    const linhaBackup = aviso(
      backup.atrasado
        ? `${quandoBackup}. Baixe um backup agora (botão "Baixar backup" abaixo) -- o histórico mora só neste navegador.`
        : `${quandoBackup}.`,
      backup.atrasado ? CORES.alerta : CORES.apagado
    );
    linhaBackup.dataset.papel = 'backup';
    bloco.appendChild(linhaBackup);

    const faltam = lacunas(datasDo(historico), agora);
    bloco.appendChild(aviso(
      faltam.length === 0
        ? `Sem lacunas nos últimos ${CONFIG_CARTEIRA.DIAS_LACUNAS} dias (dias úteis).`
        : `Dias úteis sem fotografia (últimos ${CONFIG_CARTEIRA.DIAS_LACUNAS}): ${faltam.map(ddmm).join(', ')}. A lista não foi aberta nesses dias.`,
      faltam.length === 0 ? CORES.apagado : CORES.alerta
    ));

    const doDia = dia ? historico.dias[dia] : null;
    if (doDia?.legado) {
      bloco.appendChild(aviso('A fotografia deste dia é do formato antigo (números já calculados, sem o bruto). Abra a lista hoje pra ela ser refeita no formato novo.', CORES.alerta));
    }
    const alertas = doDia?.alertas ?? [];
    if (alertas.length > 0) {
      bloco.appendChild(aviso(`Alertas nos dados de ${ddmm(dia)} (o bruto está gravado; nada foi descartado):`, CORES.alerta));
      alertas.forEach((a) => bloco.appendChild(aviso(`• ${descreverAlerta(a)}`, CORES.alerta)));
    }
    corpo.appendChild(bloco);
  }

  function desenharHoje(corpo, historico, hojeIso, agora) {
    const { dia, a, comparacao, b } = pontasDe(historico, hojeIso);
    if (!a) {
      corpo.appendChild(criarDiv(
        'Ainda não há fotografia da carteira. Abra a lista de clientes uma vez -- a fotografia é tirada sozinha e o painel passa a funcionar em qualquer página.',
        { color: CORES.texto, lineHeight: '1.5', padding: '6px 0' }
      ));
      desenharSaude(corpo, historico, dia, agora);
      return;
    }

    const quando = a.capturadoEm ? new Date(a.capturadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    corpo.appendChild(criarDiv(
      `Posição de ${ddmm(dia)}${quando ? ' às ' + quando : ''}${dia !== hojeIso ? ' (abra a lista pra atualizar)' : ''} · ${a.clientes} clientes · ` +
        (b ? `setas comparam com ${ddmm(comparacao)}` : 'sem fotografia anterior pra comparar ainda'),
      { color: CORES.apagado, fontSize: '11.5px', paddingBottom: '8px', borderBottom: `1px solid ${CORES.linha}` }
    ));

    const pp = a.promessasPendentes ?? {};
    const grade = criarDiv('', { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginTop: '10px' });
    grade.appendChild(criarCartao('Vencido em cobrança', moedaCurta(a.vencido),
      `${a.clientesComVencido} clientes · ${a.titulosVencidos} títulos`, criarDelta(a.vencido, b?.vencido)));
    grade.appendChild(criarCartao('% da dívida em cobrança', percentual(a.pctVencido, 1),
      `de ${moedaCurta(a.carteira)} que os ${a.clientes} clientes em atraso devem · a vencer ${moedaCurta(a.aVencer)}`,
      criarDelta(a.pctVencido, b?.pctVencido, { formato: 'pontos' })));
    grade.appendChild(criarCartao('Negativado (SCPC)', moedaCurta(a.scpc?.valor),
      `${a.scpc?.clientes ?? 0} clientes · ${a.suspensos?.clientes ?? 0} suspensos` + (a.deveSuspender ? ` · ${a.deveSuspender} a suspender` : ''),
      criarDelta(a.scpc?.valor, b?.scpc?.valor)));
    grade.appendChild(criarCartao('Promessas pendentes', moedaCurta(pp.valor),
      `${pp.clientes ?? 0} clientes · ${pp.venceHoje ?? 0} vencem hoje` + (pp.vencidas ? ` · ${pp.vencidas} com data passada` : ''),
      null));
    grade.appendChild(criarCartao(`Cobertura (${CONFIG_CARTEIRA.DIAS_COBERTURA} dias)`, percentual(a.cobertura?.pct),
      `${a.cobertura?.cobertos ?? 0} de ${a.clientesComVencido} com movimentação · ${a.semMovimentacao ?? 0} parados há +${CONFIG_CARTEIRA.DIAS_SEM_MOVIMENTACAO}d`,
      criarDelta(a.cobertura?.pct, b?.cobertura?.pct, { bomQuandoCai: false, formato: 'pontos' })));
    grade.appendChild(criarCartao(`Concentração (top ${CONFIG_CARTEIRA.TOP_CONCENTRACAO})`, percentual(a.concentracaoTop),
      `do vencido em ${CONFIG_CARTEIRA.TOP_CONCENTRACAO} clientes` +
        (a.acordosInadimplentes?.clientes ? ` · ${a.acordosInadimplentes.clientes} acordos inadimplentes` : ''),
      null));
    corpo.appendChild(grade);

    corpo.appendChild(criarTitulo(
      'Aging do vencido',
      `do ${CONFIG_CARTEIRA.DIA_INICIO_ESCOPO}º ao ${CONFIG_CARTEIRA.DIA_FIM_ESCOPO}º dia · cliente classificado pelo título mais antigo`
    ));
    const linhasAging = (a.faixas ?? []).map((f, i) => [
      f.rotulo,
      String(f.clientes),
      moedaCurta(f.valor),
      criarBarra(a.vencido > 0 ? f.valor / a.vencido : 0),
      percentual(a.vencido > 0 ? f.valor / a.vencido : 0),
      criarDelta(f.valor, b?.faixas?.[i]?.valor) ?? '',
    ]);
    corpo.appendChild(criarTabela(['Faixa', 'Cli.', 'Vencido', '', '%', b ? `vs ${ddmm(comparacao)}` : ''], linhasAging));
    const fora = a.fora ?? { primeiroDia: { clientes: 0, valor: 0 }, analista: { clientes: 0, valor: 0 } };
    corpo.appendChild(criarDiv(
      `Fora do painel: até o 1º dia — ${fora.primeiroDia.clientes} cli · ${moedaCurta(fora.primeiroDia.valor)}` +
        ` · com o analista (${CONFIG_CARTEIRA.DIA_FIM_ESCOPO + 1}+ dias) — ${fora.analista.clientes} cli · ${moedaCurta(fora.analista.valor)}`,
      { color: CORES.apagado, fontSize: '11px', marginTop: '4px' }
    ));
    desenharSaude(corpo, historico, dia, agora);
  }

  function desenharPonte(corpo, ponte) {
    const linha = (sinal, rotulo, cat) => [`${sinal} ${rotulo}`, String(cat.clientes), `${sinal === '−' ? '−' : ''}${moedaCurta(cat.valor)}`];
    corpo.appendChild(criarTabela(['', 'Cli.', 'R$'], [
      [`Vencido em ${ddmm(ponte.de)}`, String(ponte.inicial.clientes), moedaCurta(ponte.inicial.valor)],
      linha('+', 'entraram na cobrança', ponte.entraram),
      linha('+', 'aumentaram (título novo)', ponte.aumentaram),
      linha('−', 'pagamento parcial', ponte.reduziram),
      linha('−', 'quitaram', ponte.pagaram),
      linha('−', 'foram pro analista', ponte.analista),
      [`= Vencido em ${ddmm(ponte.ate)}`, String(ponte.final.clientes), moedaCurta(ponte.final.valor)],
    ]));
  }

  function desenharEvolucao(corpo, historico, hojeIso) {
    const { dia, a } = pontasDe(historico, hojeIso);
    if (!a) {
      corpo.appendChild(aviso('Sem fotografia ainda.'));
      return;
    }
    const primeira = datasDo(historico)[0];
    const disponivelEm = ddmm(somarDias(primeira ?? dia, CONFIG_CARTEIRA.DIAS_COMPARACAO));
    const { ponte, cura } = ponteECuraDe(historico, dia);

    corpo.appendChild(criarTitulo('Ponte da carteira', ponte ? `por que o vencido mudou em ${ponte.janela} dias` : null));
    if (ponte) desenharPonte(corpo, ponte);
    else corpo.appendChild(aviso(`Precisa de duas fotografias no formato novo com ${CONFIG_CARTEIRA.DIAS_COMPARACAO} dias de distância -- disponível a partir de ${disponivelEm}.`));

    corpo.appendChild(criarTitulo('Cura', cura ? `quem estava em cobrança em ${ddmm(cura.de)}: onde está ${cura.janela} dias depois` : null));
    if (!cura) {
      corpo.appendChild(aviso(`Disponível a partir de ${disponivelEm}.`));
    } else {
      const linhasCura = CONFIG_CARTEIRA.FAIXAS_AGING
        .map((f, i) => {
          const [clientes, pagaram, seguem, analista] = cura.faixas?.[i] ?? [0, 0, 0, 0];
          return { rotulo: f.rotulo, clientes, pagaram, seguem, analista };
        })
        .filter((l) => l.clientes > 0)
        .concat([{ rotulo: 'Total', ...cura }])
        .map((l) => [l.rotulo, String(l.clientes), comPct(l.pagaram, l.clientes), String(l.seguem), comPct(l.analista, l.clientes)]);
      corpo.appendChild(criarTabela(['Estava em', 'Cli.', 'Quitaram', 'Seguem', 'Analista'], linhasCura));
      corpo.appendChild(aviso(
        `R$ curado ${moedaCurta(cura.valorCurado)} · R$ que foi pro analista ${moedaCurta(cura.valorAnalista)} · ` +
          'quem sumiu da lista conta como quitou (a lista só mostra quem deve)'
      ));
    }

    const semanas = curaSemanal(historico);
    corpo.appendChild(criarTitulo('Cura semana a semana', 'última fotografia de cada semana (sáb–sex)'));
    if (semanas.length === 0) {
      corpo.appendChild(aviso('A série começa com a primeira cura.'));
    } else {
      corpo.appendChild(criarTabela(['Semana de', 'Janela', 'Cli.', '% quitaram', '% analista', 'R$ curado'], semanas.map((s) => [
        ddmm(s.semana),
        `${s.janela}d`,
        String(s.clientes),
        percentual(s.clientes ? s.pagaram / s.clientes : 0),
        percentual(s.clientes ? s.analista / s.clientes : 0),
        moedaCurta(s.valorCurado),
      ])));
    }

    corpo.appendChild(criarTitulo(`Vencido nos últimos ${CONFIG_CARTEIRA.DIAS_TENDENCIA} dias`));
    corpo.appendChild(criarTendencia(historico, dia));
  }

  function desenharResultado(bloco, resultados, agregado) {
    bloco.textContent = '';
    const [s, m, t] = resultados.map((r) => r.resumo);
    const fmtPct = (v) => (v === null ? '--' : percentual(v));
    const fmtRecuperado = (v) => (v === null ? 'indisponível' : moeda(v));
    const fmtPagas = (p) => {
      if (p?.erro) return `indisponível (${p.erro})`;
      return p.semValor > 0 ? `${moeda(p.valor)} (+${p.semValor} sem valor lido)` : moeda(p.valor);
    };
    bloco.appendChild(criarTitulo('Resultado', 'da API do CRM (a mesma do Alt+D) · recuperado = depósitos + promessas cumpridas pelo dia do pagamento, como no Alt+D · tudo o que você recebeu, sem o filtro de 2º–20º dia'));
    bloco.appendChild(criarTabela(
      ['', `Semana (${ddmm(resultados[0].inicioIso)}–${ddmm(resultados[0].fimIso)})`, `Mês (desde ${ddmm(resultados[1].inicioIso)})`],
      [
        ['Recuperado', fmtRecuperado(s.recuperado), fmtRecuperado(m.recuperado)],
        ['  depósitos', moeda(s.depositos), moeda(m.depositos)],
        ['  promessas cumpridas', fmtPagas(s.cumpridasPeloPagamento), fmtPagas(m.cumpridasPeloPagamento)],
        ['Promessas feitas', `${s.promessas.quantidade} · ${moedaCurta(s.promessas.prometido)}`, `${m.promessas.quantidade} · ${moedaCurta(m.promessas.prometido)}`],
        ['Cumprimento (valor)', fmtPct(s.promessas.cumprimento), fmtPct(m.promessas.cumprimento)],
        ['Promessas quebradas', moedaCurta(s.promessas.quebrado), moedaCurta(m.promessas.quebrado)],
        ['Acordos fechados', `${s.acordos.quantidade} · ${moedaCurta(s.acordos.valor)}`, `${m.acordos.quantidade} · ${moedaCurta(m.acordos.valor)}`],
        ['Clientes contatados', String(s.contatos.unicos), String(m.contatos.unicos)],
      ]
    ));

    const taxaCumprimento = t.promessas.cumprimento;
    bloco.appendChild(criarTitulo(
      'Previsão de entrada (promessas)',
      taxaCumprimento === null
        ? `sem promessa decidida nos últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias -- só o valor prometido`
        : `prometido × ${percentual(taxaCumprimento)} de cumprimento (por valor) nos últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias`
    ));
    if (!agregado) {
      bloco.appendChild(aviso('Precisa da fotografia da lista.'));
      return;
    }
    const previsao = preverEntrada(agregado, taxaCumprimento);
    bloco.appendChild(criarTabela(['Janela', 'Cli.', 'Prometido', 'Esperado'], previsao.map((p) => [
      `até ${p.dias} dias`,
      String(p.clientes),
      moedaCurta(p.prometido),
      p.esperado === null ? '--' : moedaCurta(p.esperado),
    ])));
    const passadas = agregado.promessasPendentes?.valorVencidas ?? 0;
    bloco.appendChild(aviso(
      `Fora da previsão: ${moedaCurta(passadas)} em promessas com data já passada (na prática, quebradas) e as parcelas de acordo (a lista só traz o valor total do acordo).`
    ));
  }

  function desenharRegua(corpo, historico) {
    const eventos = eventosDoDiario();
    const versao = window.filaPrioridadeDebug?.CONFIG?.VERSAO_REGUA ?? null;
    const nomes = window.filaPrioridadeDebug?.NOMES_PRIORIDADE ?? {};
    const r = analisarRegua(historico, eventos, versao);

    corpo.appendChild(aviso(
      `Quem entrou na fila do Alt+U (régua atual) e quitou em até ${CONFIG_CARTEIRA.JANELA_RESULTADO_DIAS} dias, pela fotografia. ` +
        'É descritivo, não causal: faixas diferentes têm clientes diferentes. Compare contatado com não contatado DENTRO da mesma faixa.'
    ));
    if (r.atribuicoes === 0) {
      corpo.appendChild(criarDiv('Ainda não há atribuições de fila no diário (use o Alt+U e volte depois).', { color: CORES.texto, padding: '8px 0' }));
      return;
    }
    corpo.appendChild(criarTitulo('Por faixa da régua', `taxa com menos de ${CONFIG_CARTEIRA.AMOSTRA_MINIMA} casos aparece como "--"`));
    corpo.appendChild(criarTabela(['Faixa', 'Na fila', 'Contatados', 'Quitou (contat.)', 'Quitou (não contat.)'], r.faixas.map((f) => [
      `${f.faixa} ${nomes[f.faixa] ?? ''}`.trim(),
      String(f.naFila),
      String(f.contatados),
      taxa(f.pagouContatados, f.baseContatados),
      taxa(f.pagouNao, f.baseNao),
    ])));
    corpo.appendChild(criarTitulo('Por hora do primeiro contato do dia'));
    corpo.appendChild(criarTabela(['Horário', 'Contatos', 'Quitou'], r.horarios
      .filter((h) => h.contatos > 0)
      .map((h) => [h.rotulo, String(h.contatos), taxa(h.pagou, h.base)])));
    corpo.appendChild(aviso(
      `${r.atribuicoes} atribuições nos últimos ${CONFIG_CARTEIRA.DIAS_DIARIO} dias · ${r.abertos} ainda com a janela aberta · ` +
        `${r.semBase} sem fotografia de base (dia sem lista aberta, formato antigo, ou fora do 2º–20º dia).`
    ));
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  const ABAS = [
    { chave: 'hoje', rotulo: 'Hoje' },
    { chave: 'evolucao', rotulo: 'Evolução' },
    { chave: 'resultado', rotulo: 'Resultado' },
    { chave: 'regua', rotulo: 'Régua' },
  ];

  function criarAbas(conteudos) {
    const barra = criarDiv('', { display: 'flex', gap: '4px', margin: '8px 0 4px', borderBottom: `1px solid ${CORES.borda}` });
    barra.setAttribute('role', 'tablist');
    const botoes = ABAS.map((aba) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = aba.rotulo;
      b.dataset.aba = aba.chave;
      b.id = `${CONFIG_CARTEIRA.ID_PAINEL}-aba-${aba.chave}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `${CONFIG_CARTEIRA.ID_PAINEL}-conteudo-${aba.chave}`);
      Object.assign(b.style, {
        border: 'none', background: 'transparent', padding: '6px 10px', fontSize: '12.5px', cursor: 'pointer',
        borderBottom: '2px solid transparent', marginBottom: '-1px', color: CORES.texto,
      });
      b.addEventListener('click', () => mostrar(aba.chave));
      barra.appendChild(b);
      return b;
    });
    function mostrar(chave) {
      abaAtiva = chave;
      botoes.forEach((b) => {
        const ativo = b.dataset.aba === chave;
        b.setAttribute('aria-selected', String(ativo));
        b.style.borderBottomColor = ativo ? CORES.barra : 'transparent';
        b.style.color = ativo ? CORES.tinta : CORES.texto;
        b.style.fontWeight = ativo ? '700' : '500';
      });
      Object.entries(conteudos).forEach(([k, el]) => { el.style.display = k === chave ? 'block' : 'none'; });
    }
    return { barra, mostrar };
  }

  function criarBotao(rotulo, aoClicar) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = rotulo;
    Object.assign(botao.style, {
      border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.tinta, borderRadius: '6px',
      padding: '4px 8px', fontSize: '12px', cursor: 'pointer',
    });
    botao.addEventListener('click', aoClicar);
    return botao;
  }

  /**
   * Abre o painel. Resolve quando TUDO foi desenhado (fotografia, régua e
   * resultado da API) -- é o que os testes aguardam.
   */
  async function abrirPainel({ hoje } = {}) {
    // Chamado com o painel já aberto (duas chamadas seguidas): reabre, não
    // empilha um segundo painel por cima do primeiro.
    fecharPainel();
    window.__smartTableUtil?.fecharOutrosPaineis?.('carteira');
    const base = hoje ?? new Date();
    const hojeIso = isoDe(base);

    const meuPainel = document.createElement('div');
    painelEl = meuPainel;
    meuPainel.id = CONFIG_CARTEIRA.ID_PAINEL;
    meuPainel.setAttribute('role', 'dialog');
    meuPainel.setAttribute('aria-label', 'Carteira');
    Object.assign(meuPainel.style, {
      position: 'fixed', bottom: '16px', left: '16px', background: CORES.fundo,
      border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)', fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', zIndex: CONFIG_CARTEIRA.Z_INDEX, width: '560px', maxWidth: '94vw',
      maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box',
    });
    meuPainel.appendChild(criarDiv('Carteira', { color: CORES.tinta, fontWeight: '700', fontSize: '15px' }));

    const conteudos = Object.fromEntries(ABAS.map((aba) => {
      const el = criarDiv('Carregando...', { color: CORES.apagado, paddingTop: '4px' });
      el.dataset.papel = aba.chave;
      // Papéis de acessibilidade: os testes E2E acham tudo por papel e nome.
      el.id = `${CONFIG_CARTEIRA.ID_PAINEL}-conteudo-${aba.chave}`;
      el.setAttribute('role', 'tabpanel');
      el.setAttribute('aria-labelledby', `${CONFIG_CARTEIRA.ID_PAINEL}-aba-${aba.chave}`);
      return [aba.chave, el];
    }));
    const { barra, mostrar } = criarAbas(conteudos);
    meuPainel.appendChild(barra);
    Object.values(conteudos).forEach((el) => meuPainel.appendChild(el));
    mostrar(abaAtiva);

    const rodape = criarDiv('', {
      display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px',
      paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`, gap: '6px',
    });
    const botoes = criarDiv('', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    const avisoRodape = criarDiv('Alt+M ou Esc pra fechar', { color: CORES.apagado, fontSize: '11px' });
    const falhou = (acao) => (erro) => {
      avisoRodape.textContent = `${acao} falhou: ${erro?.message ?? erro}`;
      avisoRodape.style.color = CORES.ruim;
      console.warn(`[Carteira] ${acao} falhou.`, erro);
    };
    // Um ano de histórico leva segundos pra recalcular: a tela avisa que está
    // trabalhando em vez de parecer travada.
    const comEspera = (rotulo, acao) => async () => {
      avisoRodape.textContent = `${rotulo}...`;
      avisoRodape.style.color = CORES.apagado;
      try {
        await acao();
        avisoRodape.textContent = 'Alt+M ou Esc pra fechar';
      } catch (erro) {
        falhou(rotulo)(erro);
      }
    };
    botoes.appendChild(criarBotao('Exportar CSV', comEspera('Gerando o CSV', exportarCsv)));
    botoes.appendChild(criarBotao('Baixar backup', comEspera('Gerando o backup', async () => {
      await exportarBackup();
      const linha = meuPainel.querySelector('[data-papel="backup"]');
      if (linha) {
        linha.textContent = `Último backup: ${ddmm(isoDe(new Date()))} (agora).`;
        linha.style.color = CORES.apagado;
      }
    })));
    const arquivo = document.createElement('input');
    arquivo.type = 'file';
    arquivo.accept = '.json,application/json';
    arquivo.style.display = 'none';
    arquivo.addEventListener('change', async () => {
      const f = arquivo.files?.[0];
      arquivo.value = '';
      if (!f) return;
      try {
        const r = await importarBackup(await f.text());
        avisoRodape.textContent = `Backup restaurado: ${r.importados} dia(s) importado(s), ${r.mantidos} mantido(s), ${r.invalidos} inválido(s). Reabra o painel.`;
        avisoRodape.style.color = CORES.bom;
      } catch (erro) {
        falhou('Restaurar backup')(erro);
      }
    });
    botoes.appendChild(criarBotao('Restaurar backup', () => arquivo.click()));
    botoes.appendChild(arquivo);
    rodape.appendChild(botoes);
    rodape.appendChild(avisoRodape);
    meuPainel.appendChild(rodape);
    document.body.appendChild(meuPainel);
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(meuPainel);

    const vivo = () => painelEl === meuPainel;
    const resultadoApi = buscarResultado(base).then((r) => ({ r }), (erro) => ({ erro }));

    const desenhar = (chave, fn) => {
      conteudos[chave].textContent = '';
      conteudos[chave].style.color = '';
      try {
        fn(conteudos[chave]);
      } catch (erro) {
        conteudos[chave].appendChild(criarDiv(`Falha ao desenhar: ${erro.message}`, { color: CORES.ruim }));
        console.warn('[Carteira]', erro);
      }
    };

    let historico;
    try {
      await capturarFotografia({ hoje: base });
      historico = await lerHistorico({ hoje: base });
    } catch (erro) {
      // Erro de leitura NÃO vira "ainda não há fotografia": diz o que houve.
      if (!vivo()) return;
      console.warn('[Carteira] Falha ao ler o histórico.', erro);
      ['hoje', 'evolucao', 'regua'].forEach((k) => desenhar(k, (el) => {
        el.appendChild(criarDiv(`Não consegui ler o histórico: ${erro?.message ?? erro}. Nada foi apagado -- feche e abra o painel de novo.`, {
          color: CORES.ruim, lineHeight: '1.5', padding: '6px 0',
        }));
      }));
      historico = { dias: {} };
    }
    if (!vivo()) return;

    if (Object.keys(historico.dias).length > 0 || conteudos.hoje.textContent === 'Carregando...') {
      desenhar('hoje', (el) => desenharHoje(el, historico, hojeIso, base));
      desenhar('evolucao', (el) => desenharEvolucao(el, historico, hojeIso));
      desenhar('regua', (el) => desenharRegua(el, historico));
    }

    const { r, erro } = await resultadoApi;
    if (!vivo()) return;
    if (erro) {
      conteudos.resultado.textContent = erro.message;
      conteudos.resultado.style.color = CORES.ruim;
      console.warn('[Carteira]', erro);
      return;
    }
    desenhar('resultado', (el) => desenharResultado(el, r, pontasDe(historico, hojeIso).a));
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel().catch((erro) => console.warn('[Carteira] Falha ao abrir o painel.', erro));
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('carteira', fecharPainel);

  const cargaInicial = capturarFotografia()
    .then(() => migrarLocalStorage())
    .catch((erro) => console.warn('[Carteira] Falha ao tirar a fotografia do dia.', erro?.message));

  window.__carteira = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    cargaInicial,
    clientesDaCarteira,
    filtrosAtivosNaLista,
    tirarNovaFotografia,
    resumirCarteira,
    montarRegistro,
    decodificar,
    montarHistorico,
    agregadoDe,
    descreverAlerta,
    numeroFlex,
    hashCnpj,
    estadoDe,
    capturarFotografia,
    lerHistorico,
    lerDia,
    gravarDia,
    listarDias,
    lerStatus,
    dataDeComparacao,
    calcularCura,
    calcularPonte,
    ponteECuraDe,
    curaSemanal,
    lacunas,
    situacaoBackup,
    exportarBackup,
    analisarRegua,
    resumirPeriodo,
    periodos,
    preverEntrada,
    montarCsv,
    montarBackup,
    importarBackup,
    usandoMemoria: () => usandoMemoria,
    CONFIG_CARTEIRA,
    CAMPOS_BRUTOS,
  };
})();
