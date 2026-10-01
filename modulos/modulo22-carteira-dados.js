/* =========================================================================
 * MÓDULO 22: CARTEIRA — DADOS (regras, captura do registro e IndexedDB)
 * -------------------------------------------------------------------------
 * A base do painel da Carteira (Alt+M, Módulo 14): as constantes, as regras
 * de negócio aplicadas na leitura, a montagem do registro bruto de um dia e
 * o armazenamento (IndexedDB, com memória como plano B), a leitura que
 * decodifica o registro e a migração do localStorage antigo.
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
 *   4. Erro não passa em silêncio: a captura valida a lista e grava alertas.
 *
 * FOTOGRAFIA -- window.CLIENTES (campos confirmados ao vivo).
 *   dividaAVencer vem SEMPRE null: "a vencer" é dividaTotal - dividaVencida.
 *   A lista só tem quem deve (confirmado ao vivo: nenhum cliente com
 *   dividaVencida <= 0). Logo, cliente que SOME da lista quitou o vencido
 *   (cura, ponte e régua contam assim), e dividaTotal soma só os clientes EM
 *   ATRASO. Risco aceito: transferência de negociador também faz sumir. Se a
 *   premissa quebrar, a captura grava o alerta 'semVencidoNaLista'.
 *   CORTE: vale a PRIMEIRA leitura completa do dia (posição de abertura). Uma
 *   leitura posterior só substitui se trouxer MAIS clientes ou se a gravada
 *   for do formato antigo (sem bruto).
 *
 * ESCOPO (decisões do usuário): carteira de CONFIG_CARTEIRA.PESSOAS e, nela,
 * só o vencido do 2º ao 20º dia. O 1º dia (e dia 0 ou sem dias) não é
 * referência; do 21º em diante o CLIENTE INTEIRO é do analista; cartório e
 * "não cobrar" contam no vencido; o 20º é da cobrança aqui mesmo com a fila do
 * Alt+U parando no 19º. Fora do escopo aparece na linha "Fora do painel". O
 * escopo é aplicado na leitura.
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
 *     bits. Mostrado como estava (tendência e CSV), marcado como legado, fora
 *     de cura, ponte e régua (hash não casa). O legado de HOJE é substituído
 *     na próxima abertura da lista.
 *
 * Extraído do Módulo 14 na v1.64.0 sem mudar comportamento: o código foi
 * movido como estava. Não depende de outro módulo (só lê window.__smartTableUtil
 * na hora do uso). Expõe window.__carteiraDados (congelado); usado pelos
 * Módulos 23 e 14. Precisa carregar ANTES deles.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__carteiraDadosCarregado) return;
  window.__carteiraDadosCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Carteira: Dados');


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
    // Camada dos popups nossos: acima do menu dos atalhos e do cabeçalho do CRM (ver Módulo 0).
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,

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

  /** @returns {boolean} true quando o IndexedDB falhou e o histórico vive só na memória da aba. */
  function estaUsandoMemoria() {
    return usandoMemoria;
  }

  window.__carteiraDados = Object.freeze({
    CONFIG_CARTEIRA,
    CAMPOS_BRUTOS,
    util,
    isoDe,
    dataDeIso,
    diasEntre,
    somarDias,
    ddmm,
    isoDoDiario,
    ehDataIso,
    numeroFlex,
    numero,
    diasDe,
    hashCnpj,
    ehDaCarteira,
    clientesDaCarteira,
    filtrosAtivosNaLista,
    indiceFaixa,
    estadoDe,
    quitou,
    resumirCarteira,
    montarRegistro,
    descreverAlerta,
    lerStatus,
    gravarStatus,
    estaUsandoMemoria,
    pedirPersistencia,
    lerDia,
    gravarDia,
    listarDias,
    apagarDias,
    lerRegistros,
    decodificar,
    montarHistorico,
    lerHistorico,
    agregadoDe,
    migrarLocalStorage,
  });
})();
