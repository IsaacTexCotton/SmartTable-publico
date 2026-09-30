/* =========================================================================
 * MÓDULO 7: FILA POR PRIORIDADE (Alt+U) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Monta uma fila de atendimento (mesmo formato e mecanismo do Módulo 3:
 * navegação, painel, Alt+P/Alt+V, "continuar fila anterior") ORDENADA por uma
 * régua de prioridade de negócio, não só por dias de atraso. O Alt+I original
 * não muda.
 *
 * Expõe window.filaPrioridadeDebug (iniciar, determinarPrioridade,
 * compararPelaRegua, cache e snapshot do dia, modo sombra...). O atalho Alt+U
 * fica no Módulo 4, que chama window.filaPrioridadeDebug.iniciar().
 * Depende do Módulo 0 (window.__smartTableUtil: toast, normalizarData,
 * escolherTituloRepresentativo) e do Módulo 3 (window.filaDebug:
 * construirFilaAPartirDaPagina, salvarFila, obterFila, CONFIG); precisa vir
 * DEPOIS deles no @require.
 *
 * RÉGUA DE PRIORIDADE (confirmada com o usuário; ver CONFIG.VERSAO_REGUA).
 * Cada cliente entra na PRIMEIRA faixa que se aplicar:
 *   1. Cartório -- último dia (situação ULTIMO_DIA, fluxo Cartório)
 *   2. Cluster "Novo" -- vale em QUALQUER situação de título, inclusive já em
 *      cartório, e por isso é a ÚNICA faixa isenta do teto DIAS_ATRASO_MAX em
 *      filtrarPorRegrasDaLista. Decisão do usuário: cliente novo com título em
 *      cartório tem que aparecer, porque a cobrança bloqueia o faturamento dele.
 *   3. Segundo dia de atraso (EM_ATRASO, dia 2 exato, e NENHUM título do
 *      cliente com mais dias, cartório incluído)
 *   4. Sem nenhum contato -- a aba Contatos está VAZIA: ninguém, de nenhum
 *      usuário, nunca registrou contato (confirmado com o usuário; é o
 *      semContatoAnterior do Módulo 6, o mesmo dado que faz o Alt+A se apresentar)
 *   5. Dia da promessa de pagamento (prometeu pagar HOJE e o título continua
 *      em aberto -- DIA_DA_PROMESSA, Módulo 6)
 *   6. Promessa não cumprida (vencida sem pagamento identificado e sem contato
 *      depois do vencimento -- QUEBRADA/PARCIAL, Módulo 6)
 *   7. Aviso final antes da suspensão (NEGATIVADO_SCPC, dia 19 exato -- mesmo
 *      limiar do Módulo 4)
 *   8. Antes do aviso final (NEGATIVADO_SCPC, dias 16 a 18)
 *   9. Sem contato OU sem movimentação há 14 dias ou mais (corridos; cliente
 *      "esquecido"). Entra se QUALQUER um chegar a 14: o contato mais recente
 *      da aba Contatos (de qualquer pessoa) ou a última movimentação da conta
 *      (lista de clientes).
 *  10. Atraso inicial, 3º ao 4º dia (EM_ATRASO) E NENHUM título do cliente com
 *      mais dias, cartório incluído (confirmado com o usuário: "também conta").
 *      Dia 1 NÃO é dia de cobrança (fica fora da lista); dia 2 tem faixa
 *      própria. Fica ACIMA dos dois SCPC abaixo (decisão do usuário, mantida
 *      depois de avisado que o SCPC último dia fica no fim da fila).
 *  11. SCPC negativado antes do aviso de suspensão (NEGATIVADO_SCPC, abaixo do
 *      16º dia). Dentro dela, quem está mais perto do 16º dia vem primeiro.
 *  12. SCPC -- último dia (ULTIMO_DIA, fluxo SCPC); posição decidida pelo usuário.
 *  13. Título em cartório + outro vencido fora do cartório (ainda há título
 *      que dá pra evitar)
 *  14. 5º dia de atraso (EM_ATRASO, dia 5 -- amanhã vira "último dia")
 *  15. Demais dias (tudo que não caiu acima)
 *
 * DENTRO DA MESMA FAIXA (confirmado com o usuário): do contato mais ANTIGO pro
 * mais recente -- quem está há mais tempo sem ser procurado vem primeiro; quem
 * nunca teve contato vem antes de todos. Empate: maior valor vencido, depois
 * mais dias de atraso. Na faixa 11, antes de tudo, mais dias. Ver compararPelaRegua.
 *
 * ANTES de qualquer faixa, o botão "Alerta" da página do cliente (Módulo 12)
 * pode suprimir o cliente por N dias (padrão 1): ele nem entra em
 * filtrarPorRegrasDaLista. É decisão humana explícita e vence até a isenção do
 * Cluster Novo.
 *
 * POR QUE AS FAIXAS 4 E 5 FICAM ACIMA DE SCPC-ÚLTIMO-DIA E DO AVISO DE
 * SUSPENSÃO (decisão explicada ao usuário): são clientes que JÁ SE
 * COMPROMETERAM -- quem prometeu pagar hoje só converte se for lembrado hoje
 * (janela de um dia), e quem quebrou a promessa é o contato de maior conversão.
 * O dado vem de window.__contextoAdicional.promessa, que o Módulo 6 já calcula
 * na mesma visita em aba de fundo.
 *
 * A metade "movimentação" da faixa 9 usa movimentacaoDataIso (window.CLIENTES),
 * o mesmo campo que exclui quem mexeu HOJE; aqui acha quem está PARADO.
 *
 * EXCLUSÕES (nunca entram, em nenhuma faixa):
 *   - Mais de 19 dias de atraso
 *   - Dia 1 de atraso
 *   - Última movimentação é HOJE
 *   - Alguma promessa (qualquer status) com data prometida DEPOIS de hoje
 *   - Qualquer título dispara "não cobrar" no Módulo 1 (NAO COBRAR/CARTEIRA, ou
 *     todos em cartório -- critério do banner avisarSeNaoCobrar): exclui o
 *     CLIENTE inteiro, não só o título.
 *   - Confirmado com o usuário: quando 2+ clientes do MESMO grupo econômico
 *     têm título em aberto, só a representante MAIS URGENTE entra; as demais
 *     são cobradas por tabela a partir dessa visita (filtrarPorGrupoEconomico).
 *     O grupo vem de window.__alertaGrupo (Módulo 5, aba "Grupo" de verdade),
 *     NÃO do grupoId da lista, que é outro campo sem relação com grupo econômico.
 *
 * POR QUE VISITAR CADA CLIENTE: a lista só mostra dias de atraso, cluster e
 * data da última movimentação. A situação real do título (ULTIMO_DIA/
 * NEGATIVADO_SCPC) e o fluxo (Cartório/SCPC) só existem depois da classificação
 * do Módulo 1, que depende do campo "SCPC:" da PÁGINA DE DETALHE. Promessas
 * também só existem lá. Por isso cada candidato é visitado em aba de fundo e a
 * fila só é montada depois de classificar todos.
 *
 * POR QUE ABA -- alternativas testadas ao vivo com o usuário, derrubadas por dado real:
 *   - API de cliente: NÃO EXISTE (só /api/notificacoes/contagem e /api/perfil/foto).
 *   - iframe oculto: o CRM responde X-Frame-Options: deny.
 *   - fetch + DOMParser: o HTML baixado não traz a tabela de títulos nem
 *     SCPC/promessa/grupo prontos, mas os dados vêm embutidos em <script>
 *     (__TITULOS_ABERTOS__ e companhia). Isso alimenta o MODO SOMBRA, mais
 *     abaixo; a fila continua montada pelas abas, e a página baixada roda
 *     junto só para comparar.
 *
 * CONCORRÊNCIA: CONFIG.CONCORRENCIA_CLASSIFICACAO (4) abas ao mesmo tempo; o
 * teto é conservador de propósito (~92 cargas de página contra o CRM).
 *
 * POP-UP: os `window.open` a partir do segundo não estão mais no gesto de
 * teclado. Se o navegador bloquear, o cliente fica de fora (sem travar o
 * resto), e um disjuntor (3 bloqueios sem nenhum sucesso) para tudo e avisa. A
 * varredura AQUECE sequencialmente até o primeiro sucesso antes de paralelizar
 * (senão o disjuntor afrouxa: no 3º bloqueio já há outras abas em voo). A
 * correção é permitir pop-ups pra este site (ação única).
 *
 * CACHE DO DIA: a classificação é gravada em CONFIG.CHAVE_CACHE_CLASSIFICACAO e
 * o Alt+U a reaproveita: roda UMA vez por dia (Shift+Alt+U força outra).
 * DECISÃO DO USUÁRIO, e é tentador "melhorar" isto: NÃO existe disparo
 * automático de manhã. Foi desenhado e recusado -- userscript não roda com o
 * navegador fechado e a classificação só funciona na página da LISTA, de onde
 * lê os candidatos. Um Shift+Alt+U ao chegar resolve o mesmo.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__filaPrioridadeCarregada) return;
  window.__filaPrioridadeCarregada = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Fila por Prioridade');

  // Módulo 0: precisa estar carregado ANTES deste arquivo no @require.
  const { toast, normalizarData, escolherTituloRepresentativo } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO
   * --------------------------------------------------------------------- */
  const CONFIG = {
    SELETOR_LINHA: 'table tbody tr',
    REGEX_CONTROLE: /Controle:\s*(\d+)\|([\d.\/-]+)/,
    VALOR_CLUSTER_NOVO: 'novo',
    // Exclusões (confirmadas com o usuário).
    DIAS_ATRASO_MAX: 19,
    DIA_ATRASO_MIN_CONSIDERADO: 2, // dia 1 não é considerado dia de cobrança
    // Prioridade 3: dia 2 de EM_ATRASO, sozinho (faixa própria, contato bem cedo).
    DIA_PRIORIDADE_SEGUNDO_DIA: 2,
    // Prioridade 10: 3º ao 4º dia de EM_ATRASO (dia 2 já saiu pra faixa própria acima).
    //
    // O 5º dia fica de fora de propósito (confirmado com o usuário): tem faixa
    // própria (14), abaixo desta. Não é lacuna esquecida. Acrescentar o 5 aqui
    // derruba o teste "EM_ATRASO dia 5 NÃO é atraso inicial" em
    // tests/fila-prioridade.test.js; mudança assim vai ao usuário, não é bug.
    DIAS_PRIORIDADE_ATRASO_INICIAL: [3, 4],
    // Prioridade 14: o 5º dia tem faixa PRÓPRIA, abaixo do atraso inicial.
    DIA_PRIORIDADE_QUINTO_DIA: 5,
    // Sobe toda vez que a NUMERAÇÃO das faixas muda. Vai gravada em cada cliente
    // da fila (versaoRegua) e em cada registro do diário (campo r), pra fila ou
    // histórico com a numeração antiga nunca ser lido com os nomes da nova.
    VERSAO_REGUA: 6,
    // Prioridade 9: última movimentação OU último contato há tantos dias corridos
    // OU MAIS (>=). A Carteira (Módulo 14) tem limite próprio (30) e não acompanha.
    DIAS_MOVIMENTACAO_ANTIGA: 14,
    // Limiares do aviso de suspensão SCPC, vindos do Módulo 0. O Módulo 2
    // (protegido) ainda tem cópia própria: manter sincronizado se divergir.
    DIA_ULTIMO_DIA_SUSPENSAO_SCPC: window.__smartTableUtil.DIAS_ULTIMO_DIA_SUSPENSAO_SCPC,
    DIA_INICIO_AVISO_SUSPENSAO_SCPC: window.__smartTableUtil.DIAS_AVISO_SUSPENSAO_SCPC_MIN,
    // Tempo esperando cada aba de fundo ficar pronta pra ler (Módulo 1 +
    // Módulo 6 carregados) -- mesma ordem de grandeza do Alt+A.
    TIMEOUT_CLASSIFICACAO_MS: 8000,
    INTERVALO_POLL_MS: 200,
    // Abas de fundo abertas AO MESMO TEMPO. Conservador de propósito: são ~92
    // cargas de página contra o CRM da empresa. Subir é decisão de operação, não de código.
    CONCORRENCIA_CLASSIFICACAO: 4,
    // Cache da classificação do dia. SEPARADO da fila de propósito: gravar por
    // cima dela destruiria a posição em que o operador parou.
    CHAVE_CACHE_CLASSIFICACAO: 'smarttable_classificacao_v2',
    // Snapshot da PRIMEIRA fila por prioridade do dia, que o painel de progresso
    // (Módulo 11) mostra (pedido do usuário). Gravado uma vez por dia e nunca
    // reescrito no mesmo dia, nem pelo Shift+Alt+U: a fila ao vivo encolhe
    // conforme se atende. Ver gravarSnapshotProgressoSeForOPrimeiroDoDia.
    CHAVE_SNAPSHOT_PROGRESSO: 'smarttable_progresso_dia_v2',
    // MODO SOMBRA: a classificação pela página baixada roda junto com as abas e
    // é comparada. Só troca de caminho com zero diferença nos dias reais.
    CHAVE_SOMBRA_ULTIMA: 'smarttable_sombra_alt_u_v1',
    CHAVE_SOMBRA_HISTORICO: 'smarttable_sombra_alt_u_historico_v1',
    SOMBRA_CONCORRENCIA: 4,
    SOMBRA_TIMEOUT_PAGINA_MS: 15000,
    // Espera máxima pela sombra antes de montar a fila: a fila nunca atrasa além disso.
    SOMBRA_ESPERA_MAXIMA_MS: 20000,
    SOMBRA_DIAS_HISTORICO: 30,
  };

  const NOMES_PRIORIDADE = {
    1: 'Cartório — último dia',
    2: 'Cluster Novo',
    3: 'Segundo dia',
    4: 'Sem nenhum contato',
    5: 'Dia da promessa de pagamento',
    6: 'Promessa não cumprida',
    7: 'Aviso final antes da suspensão',
    8: 'Antes do aviso final (16º–18º dia)',
    9: 'Sem contato ou movimentação há 14 dias ou mais',
    10: 'Atraso inicial (3º–4º dia)',
    11: 'SCPC antes do aviso de suspensão',
    12: 'SCPC — último dia',
    13: 'Título em cartório e outro vencido',
    14: '5º dia de atraso',
    15: 'Demais dias',
  };

  // Faixa em que, dentro dela, quem tem MAIS dias vem primeiro (mais perto
  // do 16º dia, quando começa o aviso de suspensão) -- ver compararPelaRegua.
  const FAIXA_SCPC_ANTES_DO_AVISO = 11;

  // Cor de cada faixa: borda do aviso de troca de prioridade e barra/ponto do
  // painel de progresso (Módulo 11). Critérios: contraste >= 3:1 sobre o branco
  // (WCAG 1.4.11); só tons da escala do Untitled UI; maximiza a menor diferença
  // CIEDE2000 entre faixas (14,2 visão normal, 4,8 deuteranopia). Quando uma
  // faixa muda de posição a cor segue o NOME dela. Famílias: vermelho = último
  // dia (1, 12), roxo = Cluster Novo, ciano/verde-azulado = contato (3, 4),
  // verde = promessa no dia, rosa = promessa quebrada, índigo = janela SCPC
  // (7, 8, 11), musgo = conta esquecida, laranja/âmbar/ocre = atraso e
  // cartório (10, 13, 14), cinza = demais dias.
  // A cor nunca é o único sinal (WCAG 1.4.1): a faixa sempre tem número e nome.
  // tests/fila-prioridade.test.js confere contraste e que nenhuma cor se repete.
  const CORES_PRIORIDADE = {
    1: '#D92D20',
    2: '#9F1AB1',
    3: '#088AB2',
    4: '#125D56',
    5: '#067647',
    6: '#DD2590',
    7: '#3538CD',
    8: '#6172F3',
    9: '#335015',
    10: '#93370D',
    11: '#363F72',
    12: '#E31B54',
    13: '#A15C07',
    14: '#CA8504',
    15: '#667085',
  };

  /* ---------------------------------------------------------------------
   * 2. ESTADO
   * --------------------------------------------------------------------- */
  let classificandoEmAndamento = false;
  let indicadorEl = null;

  /* ---------------------------------------------------------------------
   * 3. UTILITÁRIOS DE UI (toast + indicador de progresso persistente)
   * --------------------------------------------------------------------- */
  // Indicador único e persistente (não empilha toasts) -- atualizado in
  // place enquanto a classificação roda, já que pode levar minutos.
  /**
   * Pilha de avisos do Módulo 0. Sem ele (não deveria acontecer: carrega
   * primeiro), cai no canto inferior direito de antes.
   */
  function colocarNaPilha(el, opcoes) {
    const naPilha = window.__smartTableUtil?.colocarNaPilha;
    if (typeof naPilha === 'function') {
      naPilha(el, opcoes);
      return;
    }
    Object.assign(el.style, { position: 'fixed', bottom: '24px', right: '24px', zIndex: 999999 });
    document.body.appendChild(el);
  }

  function atualizarIndicadorProgresso(texto) {
    if (!indicadorEl) {
      indicadorEl = document.createElement('div');
      Object.assign(indicadorEl.style, {
        background: '#16232F',
        color: '#fff',
        padding: '12px 18px',
        borderRadius: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        fontSize: '14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '360px',
      });
      // "fixo": fica até a classificação acabar, nunca sai pra dar lugar a aviso novo.
      colocarNaPilha(indicadorEl, { fixo: true });
    }
    indicadorEl.textContent = texto;
  }

  function removerIndicadorProgresso() {
    if (indicadorEl) {
      indicadorEl.remove();
      indicadorEl = null;
    }
  }

  // Aviso de troca de prioridade (pedido do usuário): mesma base visual do toast
  // genérico, com borda colorida por faixa (CORES_PRIORIDADE), rótulo pequeno +
  // nome em negrito e animação leve de entrada.
  function toastTrocaPrioridade(prefixo, prioridadeTier, prioridadeNome, duracaoMs) {
    duracaoMs = duracaoMs || 5000;
    const cor = CORES_PRIORIDADE[prioridadeTier] || '#16232F';

    const el = document.createElement('div');
    Object.assign(el.style, {
      background: '#16232F',
      color: '#fff',
      padding: '14px 20px 14px 16px',
      borderRadius: '8px',
      borderLeft: '5px solid ' + cor,
      boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '360px',
      opacity: '0',
      transform: 'translateY(6px)',
      transition: 'opacity .25s ease, transform .25s ease',
      pointerEvents: 'none',
    });

    const rotulo = document.createElement('div');
    rotulo.textContent = (prefixo + ' ' + prioridadeTier).toUpperCase();
    Object.assign(rotulo.style, {
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '.05em',
      color: cor,
      marginBottom: '4px',
    });

    const nome = document.createElement('div');
    nome.textContent = prioridadeNome;
    Object.assign(nome.style, {
      fontSize: '15px',
      fontWeight: '600',
      lineHeight: '1.3',
    });

    el.appendChild(rotulo);
    el.appendChild(nome);
    colocarNaPilha(el);

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duracaoMs);
  }

  /* ---------------------------------------------------------------------
   * 4. LEITURA DA LISTA (fase 1 -- síncrona, reaproveitando o Módulo 3)
   * --------------------------------------------------------------------- */
  // Reaproveita construirFilaAPartirDaPagina (Módulo 3: deduplica matriz/filial
  // mantendo o mais atrasado e pula quem já foi atendido hoje) e enriquece cada
  // candidato com cluster, data da última movimentação e diasAtraso.
  //
  // A fonte confiável é window.CLIENTES (var CLIENTES = [...] num <script> da
  // página, confirmado no HTML real; com @grant none o acesso é direto). NÃO
  // ler do texto renderizado: span.pbi-meta é situacaoCobrancaDescricao, não o
  // cluster, e a "última data visível" da linha não é a movimentação real.
  function obterMapaClientes() {
    if (!Array.isArray(window.CLIENTES)) return null;
    const mapa = new Map();
    window.CLIENTES.forEach((c) => {
      if (c && c.cnpj) mapa.set(c.cnpj, c);
    });
    return mapa;
  }

  function candidatosEnriquecidos() {
    if (!window.filaDebug || typeof window.filaDebug.construirFilaAPartirDaPagina !== 'function') {
      console.warn('[Fila Prioridade] Módulo de Fila (Módulo 3) não encontrado -- confirme se foi colado ANTES deste arquivo.');
      return null;
    }

    const base = window.filaDebug.construirFilaAPartirDaPagina();
    const mapaClientes = obterMapaClientes();
    if (!mapaClientes) {
      console.warn(
        '[Fila Prioridade] window.CLIENTES não encontrado nesta página (a lista pode ter mudado de estrutura) -- ' +
        'seguindo sem cluster nem checagem de última movimentação (ninguém será excluído por isso, e ninguém ' +
        'entra na prioridade 2 por cluster). Me avise se isso acontecer -- não deveria.'
      );
    }

    let semCorrespondenciaNoMapa = 0;

    const enriquecidos = base.map((cliente) => {
      const dadosCliente = mapaClientes ? mapaClientes.get(cliente.cnpj) : null;
      if (mapaClientes && !dadosCliente) semCorrespondenciaNoMapa++;
      return Object.assign({}, cliente, {
        cluster: dadosCliente ? (dadosCliente.cluster || '') : '',
        // ISO ("2026-09-11T08:00:11.523327"): compara-se só "AAAA-MM-DD" por
        // string, como o script da página, evitando fuso na conversão pra Date.
        movimentacaoDataIso: dadosCliente ? (dadosCliente.dataUltimaMovimentacao || null) : null,
        // O diasAtraso de construirFilaAPartirDaPagina vem de regex no texto da
        // linha, que tem mais de um "N dias" (diasAtraso e diasAtrasoMedio são
        // campos separados) e inflava a exclusão ">19 dias". O valor estruturado
        // de window.CLIENTES sobrescreve o da regex sempre que existe.
        diasAtraso:
          dadosCliente && typeof dadosCliente.diasAtraso === 'number' ? dadosCliente.diasAtraso : cliente.diasAtraso,
      });
    });

    // CNPJ que não bate com window.CLIENTES cai no valor da regex (menos
    // confiável); avisa pra isso não passar em silêncio.
    if (semCorrespondenciaNoMapa > 0) {
      console.warn(
        `[Fila Prioridade] ${semCorrespondenciaNoMapa} candidato(s) não bateram com nenhum CNPJ em window.CLIENTES -- ` +
        'esses ficaram com cluster/movimentação/diasAtraso extraídos por regex da linha (menos confiável). ' +
        'Se isso acontecer com frequência, me avise -- pode indicar formato de CNPJ diferente entre os dois.'
      );
    }

    return enriquecidos;
  }

  function movimentacaoEhHoje(movimentacaoDataIso) {
    if (!movimentacaoDataIso) return false;
    const dataStr = String(movimentacaoDataIso).split('T')[0];
    const hoje = new Date();
    const hojeStr =
      hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
    return dataStr === hojeStr;
  }

  // "AAAA-MM-DD" de movimentacaoDataIso -> Date normalizado (meio-dia). Usa
  // new Date(ano, mes-1, dia), NÃO new Date("AAAA-MM-DD"): esta é UTC meia-noite
  // e pode virar o dia errado conforme o fuso (mesmo cuidado de converterDataBr, Módulo 6).
  function dataDaMovimentacao(movimentacaoDataIso) {
    if (!movimentacaoDataIso) return null;
    const dataStr = String(movimentacaoDataIso).split('T')[0];
    const m = dataStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return normalizarData(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  // Prioridade 9: data (movimentação ou contato) com DIAS_MOVIMENTACAO_ANTIGA
  // dias corridos OU MAIS (>=). hoje já vem normalizado de quem chama.
  function semMovimentoHaDuasSemanas(movimentacaoDataIso, hoje) {
    const data = dataDaMovimentacao(movimentacaoDataIso);
    if (!data || !hoje) return false;
    const diasCorridos = (hoje.getTime() - data.getTime()) / (24 * 60 * 60 * 1000);
    return diasCorridos >= CONFIG.DIAS_MOVIMENTACAO_ANTIGA;
  }

  // Regra única (trim + minúsculas) de cluster novo, pra não existir em dois lugares.
  function ehClusterNovo(cluster) {
    return (cluster || '').trim().toLowerCase() === CONFIG.VALOR_CLUSTER_NOVO;
  }

  // Exclusões decidíveis só com o que a lista mostra, sem visitar ninguém.
  //
  // Exceção (decisão do usuário): Cluster Novo NÃO é cortado pelo teto de dias.
  // Cliente novo com título em cartório passa dos 19 dias e precisa aparecer,
  // pois a cobrança bloqueia o faturamento dele. Saber "é cartório?" exigiria
  // visitar, então a isenção vale para o cluster inteiro.
  function filtrarPorRegrasDaLista(candidatos) {
    const sobreviventes = [];
    const excluidos = { dias: 0, diaUm: 0, movimentacaoHoje: 0, semDias: 0, naoCobrarTemporario: 0 };

    candidatos.forEach((c) => {
      // "Não cobrar" do botão Alerta (Módulo 12) é decisão humana e vence toda
      // regra automática, inclusive a isenção do Cluster Novo. Sem o Módulo 12
      // carregado, ninguém é suprimido (degrada, não quebra).
      if (window.__alertaCliente?.estaSuprimidoDaPrioridade?.(c.cnpj)) {
        excluidos.naoCobrarTemporario++;
        return;
      }
      if (c.diasAtraso === null || c.diasAtraso === undefined) {
        excluidos.semDias++;
        return;
      }
      if (c.diasAtraso > CONFIG.DIAS_ATRASO_MAX && !ehClusterNovo(c.cluster)) {
        excluidos.dias++;
        return;
      }
      if (c.diasAtraso < CONFIG.DIA_ATRASO_MIN_CONSIDERADO) {
        excluidos.diaUm++;
        return;
      }
      if (movimentacaoEhHoje(c.movimentacaoDataIso)) {
        excluidos.movimentacaoHoje++;
        return;
      }
      sobreviventes.push(c);
    });

    return { sobreviventes, excluidos };
  }

  /* ---------------------------------------------------------------------
   * 5. CLASSIFICAÇÃO REAL (fase 2 -- visita cada candidato em aba de fundo)
   * --------------------------------------------------------------------- */
  // Título representativo: escolherTituloRepresentativo (Módulo 0, mesma regra do
  // Módulo 4). ULTIMO_DIA vence, depois a janela SCPC 16-19, depois o maior atraso real.

  // Espera a aba de fundo ter o Módulo 1 pronto pra simular() e o Módulo 6 com
  // __contextoAdicional calculado (mesmo que no fallback de erro): nunca ler pela metade.
  function esperarAbaPronta(janela, timeoutMs, intervaloMs) {
    return new Promise((resolve) => {
      const prazoFinal = Date.now() + timeoutMs;
      (function tentar() {
        if (janela.closed) return resolve(false);
        let pronto = false;
        try {
          pronto = !!(
            janela.__avisoCobranca &&
            typeof janela.__avisoCobranca.simular === 'function' &&
            janela.__contextoAdicional &&
            janela.__alertaGrupo &&
            // Acordos (Módulo 16): simular() só separa os títulos em acordo depois
            // que a leitura dos acordos termina. Sem o módulo na aba, não espera.
            (janela.__negociacoesCarregado !== true || janela.__negociacoes?.estaPronto?.() === true)
          );
        } catch (erro) {
          return resolve(false); // cross-origin ou janela em estado estranho
        }
        if (pronto) return resolve(true);
        if (Date.now() >= prazoFinal) return resolve(false);
        setTimeout(tentar, intervaloMs);
      })();
    });
  }

  // Primeira faixa que se aplicar vence: a ordem das checagens segue a numeração (1 a 15).
  //
  // contextoPromessa é window.__contextoAdicional.promessa da aba (Módulo 6):
  // { tipo: 'DIA_DA_PROMESSA' | 'QUEBRADA' | 'PARCIAL', promessa } ou null.
  // null inclui promessa já resolvida (título pago) ou com contato depois do
  // vencimento.
  //
  // movimentacaoDataIso e hoje são opcionais; sem eles a faixa 9 não casa.
  //
  // extras (opcional):
  //   - semContato: aba Contatos vazia (faixa 4). Ausente = false.
  //   - maiorAtrasoDoCliente: maior diasAtrasoReal entre TODOS os títulos,
  //     cartório incluído (faixas 3 e 10). Ausente = o do título escolhido.
  //   - ultimoContatoIso: AAAA-MM-DD do contato mais recente, de qualquer
  //     pessoa (faixa 9). Ausente = só a movimentação decide.
  //   - temTituloEmCartorio: há título EM_CARTORIO entre os em cobrança (faixa 13).
  //   - temNegativadoNoDiaDaSuspensao: há título NEGATIVADO_SCPC no 19º dia (faixa 7).
  function determinarPrioridade(escolhido, fluxo, cluster, contextoPromessa, movimentacaoDataIso, hoje, extras = {}) {
    const tipoPromessa = contextoPromessa ? contextoPromessa.tipo : null;
    const { situacaoKey, diasAtrasoReal } = escolhido;
    const maiorAtrasoDoCliente = extras.maiorAtrasoDoCliente ?? diasAtrasoReal;

    if (situacaoKey === 'ULTIMO_DIA' && fluxo === 'CARTORIO') return 1;
    if (ehClusterNovo(cluster)) return 2;
    // Faixa 3 exige que NENHUM título do cliente tenha mais dias (cartório
    // conta): o título escolhido deixa o cartório de fora, e sem isso um cliente
    // com título de 2 dias + outro em cartório há semanas entraria aqui.
    if (
      situacaoKey === 'EM_ATRASO' &&
      diasAtrasoReal === CONFIG.DIA_PRIORIDADE_SEGUNDO_DIA &&
      maiorAtrasoDoCliente <= diasAtrasoReal
    ) {
      return 3;
    }
    if (extras.semContato === true) return 4;
    if (tipoPromessa === 'DIA_DA_PROMESSA') return 5;
    if (tipoPromessa === 'QUEBRADA' || tipoPromessa === 'PARCIAL') return 6;
    if (situacaoKey === 'NEGATIVADO_SCPC' && diasAtrasoReal === CONFIG.DIA_ULTIMO_DIA_SUSPENSAO_SCPC) return 7;
    // Último dia + outro título negativado no 19º dia (decisão do usuário): o
    // escolhido é o de último dia (Módulo 0), mas a mensagem do Alt+A já fala da
    // suspensão de hoje (Módulo 4, tituloNegativadoQueManda), então a fila trata
    // como faixa 7, não 12. Negativados de 1 a 18 dias ficam de fora (não decididos).
    if (situacaoKey === 'ULTIMO_DIA' && extras.temNegativadoNoDiaDaSuspensao === true) return 7;
    if (
      situacaoKey === 'NEGATIVADO_SCPC' &&
      diasAtrasoReal >= CONFIG.DIA_INICIO_AVISO_SUSPENSAO_SCPC &&
      diasAtrasoReal < CONFIG.DIA_ULTIMO_DIA_SUSPENSAO_SCPC
    ) {
      return 8;
    }
    // Mesma régua (>= 14 dias corridos) pras duas datas (AAAA-MM-DD). Contato
    // ausente nunca casa sozinho: quem nunca teve contato já ficou na faixa 4.
    if (semMovimentoHaDuasSemanas(movimentacaoDataIso, hoje) || semMovimentoHaDuasSemanas(extras.ultimoContatoIso, hoje)) return 9;
    // O atraso inicial vem ANTES dos dois SCPC (decisão do usuário). As três
    // situações são exclusivas (cada uma é a do MESMO título escolhido): o que
    // ordena é o número devolvido, não a ordem destas checagens.
    if (
      situacaoKey === 'EM_ATRASO' &&
      CONFIG.DIAS_PRIORIDADE_ATRASO_INICIAL.includes(diasAtrasoReal) &&
      maiorAtrasoDoCliente <= diasAtrasoReal
    ) {
      return 10;
    }
    // SCPC antes do aviso vem ANTES do SCPC último dia e de "cartório e outro vencido" (13).
    if (situacaoKey === 'NEGATIVADO_SCPC' && diasAtrasoReal < CONFIG.DIA_INICIO_AVISO_SUSPENSAO_SCPC) return FAIXA_SCPC_ANTES_DO_AVISO;
    if (situacaoKey === 'ULTIMO_DIA' && fluxo === 'SCPC') return 12;
    // Faixas 13 e 14: subdivisão do que seria "Demais dias".
    if (extras.temTituloEmCartorio === true && situacaoKey !== 'EM_CARTORIO') return 13;
    if (situacaoKey === 'EM_ATRASO' && diasAtrasoReal === CONFIG.DIA_PRIORIDADE_QUINTO_DIA) return 14;
    return 15;
  }

  /** Soma do saldo dos títulos em cobrança (desempate da régua v3); 0 se nada legível. */
  function valorVencidoEntre(registros) {
    return (registros || []).reduce((soma, r) => soma + (window.__smartTableUtil.numeroDeMoedaBr(r?.saldoTexto) ?? 0), 0);
  }

  // Maior atraso real entre TODOS os títulos do cliente -- sem filtro de
  // situação, de propósito (cartório conta, ver faixa 10).
  function maiorAtrasoEntreTodos(registros) {
    return (registros || []).reduce(
      (maior, r) => (typeof r.diasAtrasoReal === 'number' && r.diasAtrasoReal > maior ? r.diasAtrasoReal : maior),
      -Infinity
    );
  }

  // Data (AAAA-MM-DD) do contato mais recente da aba Contatos, de qualquer
  // usuário, efetivo ou não -- é o que ordena DENTRO de cada faixa. null
  // quando não há contato nenhum (ou o Módulo 6 da aba não expôs a leitura).
  function lerUltimoContatoIso(aba) {
    try {
      const recente = aba.__contextoAdicionalDebug?.lerContatoMaisRecente?.();
      return recente?.data ? window.__smartTableUtil.dataIso(recente.data) : null;
    } catch (erro) {
      // Não engole em silêncio: sem o contato, o cliente é ordenado como
      // "nunca contatado" -- um contrato quebrado entre módulos apareceria
      // só como ordem errada na fila.
      console.warn('[Fila Prioridade] Falha ao ler o contato mais recente -- cliente ordenado como sem contato:', erro?.message);
      return null;
    }
  }

  // Visita UM candidato: abre a aba, espera ficar pronta, lê situação +
  // fluxo (Módulo 1) e promessas (Módulo 6), fecha a aba, devolve o
  // resultado. Nunca lança -- qualquer falha vira { erro: '...' } pra não
  // travar o restante do lote.
  async function classificarCliente(cliente) {
    const aba = window.open(cliente.url, '_blank');
    if (!aba) {
      console.warn(`[Fila Prioridade] Não consegui abrir aba para ${window.__smartTableUtil.apelidoParaLog(cliente.cnpj)} -- pop-up bloqueado? Permita pop-ups pra este site e tente de novo.`);
      return { cliente, erro: 'popup-bloqueado' };
    }

    try {
      const pronto = await esperarAbaPronta(aba, CONFIG.TIMEOUT_CLASSIFICACAO_MS, CONFIG.INTERVALO_POLL_MS);
      if (!pronto) {
        console.warn(`[Fila Prioridade] ${window.__smartTableUtil.apelidoParaLog(cliente.cnpj)} não carregou a tempo -- deixando de fora da lista.`);
        return { cliente, erro: 'timeout' };
      }
      return classificarAPartirDaAba(cliente, aba);
    } finally {
      try {
        if (!aba.closed) aba.close();
      } catch (erro) {
        // aba pode já ter sido fechada manualmente -- ignora.
      }
    }
  }

  /**
   * A classificação em si, a partir de uma aba PRONTA: a de verdade
   * (classificarCliente) ou a "aba virtual" da página baixada (montarAbaVirtual,
   * modo sombra). Função única pros dois caminhos: a diferença possível fica só
   * nos DADOS, que é o que o modo sombra mede.
   */
  function classificarAPartirDaAba(cliente, aba) {
    let dadosTitulos;
    try {
      dadosTitulos = aba.__avisoCobranca.simular();
    } catch (erro) {
      console.warn(`[Fila Prioridade] Falha ao ler títulos de ${window.__smartTableUtil.apelidoParaLog(cliente.cnpj)}:`, erro.message);
      return { cliente, erro: 'falha-titulos' };
    }

    // Confirmado com o usuário: cliente com QUALQUER título em "não cobrar"
    // (NAO COBRAR/CARTEIRA, ou todos em cartório -- ver POSICOES_EXCLUIDAS_DE_COBRANCA
    // e avisarSeNaoCobrar, Módulo 1) fica fora da fila inteira, não só o título.
    // dadosTitulos.naoCobrar já vem da mesma simulação, sem custo de visita.
    if (dadosTitulos.naoCobrar && dadosTitulos.naoCobrar.length > 0) {
      return { cliente, excluidoPorNaoCobrar: true };
    }

    // Acordos (decisão do usuário): todos os títulos vencidos em acordo
    // ATIVA/CONCLUIDA -> fora da fila se as parcelas estão em dia; parcela
    // atrasada -> faixa 6 (a de "promessa não cumprida"). Misto: régua normal pelos demais.
    let prioridadeForcada = null;
    let registrosParaEscolha = dadosTitulos;
    if ((dadosTitulos.registros?.length ?? 0) === 0 && (dadosTitulos.emAcordo?.length ?? 0) > 0) {
      const ativa = aba.__negociacoes?.resumoDeCobranca?.()?.ativa;
      if (!ativa || !ativa.atrasada) return { cliente, excluidoPorAcordo: true };
      prioridadeForcada = 6;
      registrosParaEscolha = { ...dadosTitulos, registros: dadosTitulos.emAcordo };
    }

    const escolhido = escolherTituloRepresentativo(registrosParaEscolha);
    if (!escolhido) {
      return { cliente, erro: 'sem-titulo-representativo' };
    }

    let promessas = [];
    if (aba.__contextoAdicionalDebug && typeof aba.__contextoAdicionalDebug.lerPromessas === 'function') {
      try {
        promessas = aba.__contextoAdicionalDebug.lerPromessas();
      } catch (erro) {
        console.warn(`[Fila Prioridade] Falha ao ler promessas de ${window.__smartTableUtil.apelidoParaLog(cliente.cnpj)} -- seguindo sem checar promessa futura:`, erro.message);
      }
    }

    const hoje = normalizarData(new Date());
    const temPromessaFutura = promessas.some(
      (p) => p.dataPrometida && p.dataPrometida.getTime() > hoje.getTime()
    );
    if (temPromessaFutura) {
      return { cliente, excluidoPorPromessaFutura: true };
    }

    // Promessa ATIVA calculada pelo Módulo 6 nesta aba (decide as faixas 5 e 6).
    // Diferente de `promessas` (leitura crua, usada só pra excluir promessa futura).
    const contextoPromessa = (aba.__contextoAdicional && aba.__contextoAdicional.promessa) || null;

    const ultimoContatoIso = lerUltimoContatoIso(aba);
    const prioridade = prioridadeForcada ?? determinarPrioridade(
      escolhido,
      dadosTitulos.fluxo,
      cliente.cluster,
      contextoPromessa,
      cliente.movimentacaoDataIso,
      hoje,
      {
        semContato: aba.__contextoAdicional?.semContatoAnterior === true,
        maiorAtrasoDoCliente: maiorAtrasoEntreTodos(dadosTitulos.registros),
        ultimoContatoIso,
        temTituloEmCartorio: dadosTitulos.registros.some((r) => r.situacaoKey === 'EM_CARTORIO'),
        temNegativadoNoDiaDaSuspensao: dadosTitulos.registros.some(
          (r) => r.situacaoKey === 'NEGATIVADO_SCPC' && r.diasAtrasoReal === CONFIG.DIA_ULTIMO_DIA_SUSPENSAO_SCPC
        ),
      }
    );

    // Confirmado com o usuário: se outra empresa do mesmo grupo econômico também
    // tem título vencido, só a representante mais urgente entra na fila (as
    // outras são cobradas por tabela via essa visita; Alt+A/Alt+G, Módulos 4/5).
    // O Módulo 5 lê a aba "Grupo" de verdade (não o grupoId da lista) em toda
    // visita, então window.__alertaGrupo já está disponível nesta aba.
    const empresasComVencido = (aba.__alertaGrupo && aba.__alertaGrupo.empresasComVencido) || [];

    const valorVencido = valorVencidoEntre(dadosTitulos.registros);
    return { cliente, escolhido, fluxo: dadosTitulos.fluxo, prioridade, empresasComVencido, ultimoContatoIso, valorVencido };
  }

  // Só dígitos: compara CNPJ entre fontes com formatação diferente.
  function normalizarCnpj(cnpj) {
    return (cnpj || '').replace(/\D/g, '');
  }

  // Mais urgente = quem vem primeiro em compararPelaRegua, o MESMO critério da
  // ordenação final: representante do grupo e posição na fila nunca discordam.
  // Empate total: fica o primeiro.
  function maisUrgente(a, b) {
    return compararPelaRegua(a, b) <= 0 ? a : b;
  }

  // Confirmado com o usuário: quando 2+ clientes do MESMO grupo econômico têm
  // título em aberto, só a representante mais urgente entra na fila. Só dá pra
  // saber quem é do grupo DEPOIS de classificar (empresasComVencido), por isso
  // roda depois do laço de classificação.
  //
  // Agrupamento por união de CNPJ cruzado: dois resultados entram no mesmo
  // cluster se o CNPJ de QUALQUER um aparece em empresasComVencido do outro
  // (tolera a tabela do grupo não listar os dois lados de forma simétrica).
  function filtrarPorGrupoEconomico(resultados) {
    const indicePorCnpj = new Map();
    resultados.forEach((r, i) => {
      const cnpj = normalizarCnpj(r.cliente.cnpj);
      if (cnpj) indicePorCnpj.set(cnpj, i);
    });

    // Union-Find simples (path compression); são dezenas de candidatos por rodada.
    const pai = resultados.map((_, i) => i);
    function encontrar(i) {
      while (pai[i] !== i) {
        pai[i] = pai[pai[i]];
        i = pai[i];
      }
      return i;
    }
    function unir(i, j) {
      const raizI = encontrar(i);
      const raizJ = encontrar(j);
      if (raizI !== raizJ) pai[raizI] = raizJ;
    }

    resultados.forEach((r, i) => {
      (r.empresasComVencido || []).forEach((empresa) => {
        const j = indicePorCnpj.get(normalizarCnpj(empresa.cnpj));
        if (j !== undefined && j !== i) unir(i, j);
      });
    });

    const clusters = new Map(); // raiz -> array de índices
    resultados.forEach((_, i) => {
      const raiz = encontrar(i);
      if (!clusters.has(raiz)) clusters.set(raiz, []);
      clusters.get(raiz).push(i);
    });

    const sobreviventes = [];
    let excluidosPorGrupo = 0;

    clusters.forEach((indices) => {
      if (indices.length === 1) {
        sobreviventes.push(resultados[indices[0]]);
        return;
      }
      const vencedor = indices.map((i) => resultados[i]).reduce(maisUrgente);
      sobreviventes.push(vencedor);
      excluidosPorGrupo += indices.length - 1;
    });

    return { sobreviventes, excluidosPorGrupo };
  }

  /* ---------------------------------------------------------------------
   * 6. ORQUESTRAÇÃO (Alt+U)
   * --------------------------------------------------------------------- */
  /**
   * Ordena pela régua: faixa 1 primeiro; dentro da faixa, contato mais ANTIGO
   * primeiro (quem nunca teve contato na frente de todos); empate, MAIOR VALOR
   * VENCIDO, depois mais dias de atraso (confirmado com o usuário). Na faixa 11,
   * mais dias vem ANTES de tudo (mais perto do 16º dia).
   *
   * ultimoContatoIso é AAAA-MM-DD, então comparar como texto é comparar como data.
   */
  function compararPelaRegua(a, b) {
    if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
    const dias = b.escolhido.diasAtrasoReal - a.escolhido.diasAtrasoReal;
    if (a.prioridade === FAIXA_SCPC_ANTES_DO_AVISO && dias !== 0) return dias;
    const contatoA = a.ultimoContatoIso ?? '';
    const contatoB = b.ultimoContatoIso ?? '';
    if (contatoA !== contatoB) return contatoA < contatoB ? -1 : 1;
    const valor = (b.valorVencido ?? 0) - (a.valorVencido ?? 0);
    if (valor !== 0) return valor;
    return dias;
  }

  /**
   * A fila salva foi montada por ESTE módulo?
   *
   * Módulos 3 (Alt+I) e 7 (Alt+U) gravam na MESMA chave do localStorage; o que
   * distingue é o prioridadeTier, só presente na fila por prioridade. Sem a
   * checagem, o Alt+U "retomaria" uma fila do Alt+I cuja ordem não é a da régua.
   *
   * @param {object|null} fila
   * @returns {boolean}
   */
  function ehFilaDePrioridade(fila) {
    return Boolean(fila?.clientes?.some((c) => c && c.prioridadeTier != null));
  }

  /**
   * A fila por prioridade salva foi montada com a régua ATUAL?
   *
   * Fila de régua anterior tem números de faixa da numeração velha; retomá-la
   * mostraria a faixa com o nome da nova. Nesse caso o Alt+U monta outra.
   *
   * @param {object|null} fila
   * @returns {boolean}
   */
  function ehDaReguaAtual(fila) {
    return ehFilaDePrioridade(fila) &&
      fila.clientes.some((c) => c && c.versaoRegua === CONFIG.VERSAO_REGUA);
  }

  /**
   * A DECISÃO de retomar, sem efeito colateral. Separada de retomarFilaDeHoje()
   * porque navegar não é testável no jsdom; assim a regra (que fila serve, onde
   * continuar, quantos faltam) fica coberta. Mesmo padrão de
   * construirUrlProtocoloWhatsApp (Módulo 2) e montarExportacao (Módulo 8).
   *
   * @returns {{url: string, cnpj: string, restantes: number, total: number,
   *   jaEstouNele: boolean}|null} null quando não há o que retomar.
   */
  function alvoDeRetomada() {
    if (!window.filaDebug || typeof window.filaDebug.obterFila !== 'function') return null;

    // obterFila() já devolve null pra fila de outro dia -- a janela de
    // validade é o dia, e ela é do Módulo 3.
    const fila = window.filaDebug.obterFila();
    if (!fila || !ehDaReguaAtual(fila)) return null;

    const indice = Math.max(0, fila.indiceAtual);
    const restantes = fila.clientes.length - indice;
    if (restantes <= 0) return null; // fila terminada: reconstruir é o certo

    const alvo = fila.clientes[indice];
    if (!alvo || !alvo.url) return null;

    // Se já está no cliente onde parou, navegar seria um reload que apaga o que
    // estiver na tela (inclusive observação digitada pela metade).
    const cnpjAtual = window.filaDebug.extrairCnpjDaUrl(location.href);

    return {
      url: alvo.url,
      cnpj: alvo.cnpj,
      restantes,
      total: fila.clientes.length,
      jaEstouNele: Boolean(cnpjAtual) && cnpjAtual === alvo.cnpj,
    };
  }

  /**
   * Atualiza a fila retomada sem um Shift+Alt+U completo (pedido do usuário):
   * tira, a partir da posição atual, quem já teve movimentação HOJE segundo
   * window.CLIENTES (contatado por fora do SmartTable, por exemplo). O
   * histórico (clientes[0..indiceAtual-1]) fica intacto.
   *
   * Puro (não grava em localStorage), como alvoDeRetomada(); quem chama decide
   * se salva.
   *
   * @param {object} fila
   * @param {Map<string, object>|null} mapaClientes window.CLIENTES por cnpj
   *   (ver obterMapaClientes). null quando a página atual não tem
   *   window.CLIENTES (ex.: Alt+U chamado fora da lista) -- nesse caso
   *   devolve a fila como está, sem filtrar nada (degrada, não quebra).
   * @returns {{fila: object, removidos: number}}
   */
  function removerAtendidosHojeDaFila(fila, mapaClientes) {
    if (!mapaClientes) return { fila, removidos: 0 };

    const indice = Math.max(0, fila.indiceAtual);
    const historico = fila.clientes.slice(0, indice);
    const restante = fila.clientes.slice(indice);

    const sobreviventes = restante.filter((c) => {
      const dados = mapaClientes.get(c.cnpj);
      return !movimentacaoEhHoje(dados ? dados.dataUltimaMovimentacao : null);
    });

    const removidos = restante.length - sobreviventes.length;
    if (removidos === 0) return { fila, removidos: 0 };

    return {
      fila: Object.assign({}, fila, { clientes: [...historico, ...sobreviventes] }),
      removidos,
    };
  }

  /**
   * Tenta continuar a fila por prioridade de HOJE em vez de refazer tudo
   * (pedido do usuário): reconstruir custa abrir ~140 abas e sobrescreveria a
   * fila da manhã, perdendo a posição. NÃO usa o botão "Continuar fila
   * anterior" do Módulo 3: confirmado com o usuário que ele é só do Alt+I.
   *
   * @returns {boolean} true se retomou (quem chamou não deve reconstruir).
   */
  function retomarFilaDeHoje() {
    if (window.filaDebug && typeof window.filaDebug.obterFila === 'function') {
      const filaAtual = window.filaDebug.obterFila();
      if (filaAtual && ehDaReguaAtual(filaAtual)) {
        // Retomar não passa por finalizarFila, então o snapshot do progresso é
        // garantido aqui: sem ele o painel (Módulo 11) ficaria "indisponível" o
        // dia todo. A fila retomada é a melhor aproximação da primeira do dia.
        // Fila de lista filtrada fica de fora: não grava referência de propósito.
        if (filaAtual.filtrada !== true) gravarSnapshotProgressoSeForOPrimeiroDoDia(filaAtual.clientes);

        const { fila: filaAtualizada, removidos } = removerAtendidosHojeDaFila(filaAtual, obterMapaClientes());
        if (removidos > 0) {
          window.filaDebug.salvarFila(filaAtualizada);
          console.log(`[Fila Prioridade] ${removidos} cliente(s) removido(s) da fila retomada -- já tinham movimentação hoje.`);
        }
      }
    }

    const alvo = alvoDeRetomada();
    if (!alvo) return false;

    toast(`Fila de hoje: ${alvo.restantes} de ${alvo.total} restantes. Shift+Alt+U refaz.`);
    if (!alvo.jaEstouNele) window.location.href = alvo.url;
    return true;
  }

  /* ---------------------------------------------------------------------
   * 5b. CLASSIFICAÇÃO EM LOTE E CACHE DO DIA
   * --------------------------------------------------------------------- */

  /**
   * Classifica vários clientes com N abas abertas ao mesmo tempo.
   *
   * A ordem do RESULTADO acompanha a da ENTRADA (resultados[i] = clientes[i]),
   * não a de chegada: a fila é ordenada pela régua logo depois, e ordem
   * instável entre empates faria execuções do mesmo dia gerarem filas diferentes.
   *
   * @param {object[]} clientes
   * @param {(feitos: number, total: number) => void} aoProgredir
   * @param {(cliente: object) => Promise<object>} [classificar] Costura de
   *   teste (abrir aba não acontece no jsdom): permite cobrir a concorrência e o
   *   disjuntor. Em produção nunca é passado.
   * @returns {Promise<{resultados: object[], abortouPorPopup: boolean}>}
   */
  async function classificarEmLote(clientes, aoProgredir, classificar) {
    const classificarUm = classificar || classificarCliente;
    const resultados = new Array(clientes.length);
    let proximo = 0;
    let feitos = 0;
    let bloqueados = 0;
    let sucessos = 0;
    let abortouPorPopup = false;

    // DISJUNTOR DE POP-UP: em paralelo "3 seguidos" perde o sentido (a ordem de
    // chegada é indeterminada); a regra equivalente é 3 bloqueios e NENHUM
    // sucesso, que caracteriza bloqueio sistemático.
    const LIMITE_BLOQUEIOS = 3;

    async function umCliente() {
      if (abortouPorPopup) return false;
      const i = proximo;
      proximo += 1;
      if (i >= clientes.length) return false;

      const resultado = await classificarUm(clientes[i]);
      resultados[i] = resultado;

      if (resultado.erro === 'popup-bloqueado') {
        bloqueados += 1;
        if (bloqueados >= LIMITE_BLOQUEIOS && sucessos === 0) {
          abortouPorPopup = true;
          return false;
        }
      } else if (!resultado.erro) {
        sucessos += 1;
      }

      feitos += 1;
      aoProgredir(feitos, clientes.length);
      return true;
    }

    async function trabalhador() {
      for (;;) {
        const seguiu = await umCliente();
        if (!seguiu) return;
      }
    }
    trabalhador.chamadaUnica = umCliente;

    // AQUECIMENTO SEQUENCIAL até o primeiro sucesso: sem ele o disjuntor afrouxa
    // (com 4 trabalhadores, no 3º bloqueio já há outras abas em voo; o teste do
    // disjuntor pega isso). Também prova que pop-up está liberado antes de pedir
    // quatro abas de uma vez.
    while (sucessos === 0 && !abortouPorPopup && proximo < clientes.length) {
      await trabalhador.chamadaUnica();
    }

    if (abortouPorPopup || proximo >= clientes.length) {
      return { resultados: resultados.filter(Boolean), abortouPorPopup };
    }

    const quantos = Math.max(1, Math.min(CONFIG.CONCORRENCIA_CLASSIFICACAO, clientes.length - proximo));
    await Promise.all(Array.from({ length: quantos }, trabalhador));

    return { resultados: resultados.filter(Boolean), abortouPorPopup };
  }

  /**
   * O cache guarda só os campos que o pipeline DEPOIS da classificação
   * consome. O resultado inteiro tem Date (não sobrevive ao JSON) e campos que
   * ninguém lê, o que faria o caminho do cache divergir do fresco.
   *
   * Há teste travando que os dois caminhos produzem a MESMA fila.
   *
   * @param {object} r Resultado de classificarCliente.
   */
  function paraOCache(r) {
    return {
      cliente: r.cliente,
      prioridade: r.prioridade,
      empresasComVencido: r.empresasComVencido || [],
      ultimoContatoIso: r.ultimoContatoIso ?? null,
      valorVencido: r.valorVencido ?? 0,
      escolhido: {
        diasAtrasoReal: r.escolhido.diasAtrasoReal,
        situacaoKey: r.escolhido.situacaoKey,
      },
    };
  }

  /** @param {object[]} resultados */
  function gravarCacheClassificacao(resultados) {
    try {
      localStorage.setItem(CONFIG.CHAVE_CACHE_CLASSIFICACAO, JSON.stringify({
        dia: window.__smartTableUtil.dataIso(new Date()),
        geradoEm: Date.now(),
        // As faixas do cache só valem na régua em que foram calculadas.
        versaoRegua: CONFIG.VERSAO_REGUA,
        resultados: resultados.map(paraOCache),
      }));
      return true;
    } catch (erro) {
      console.warn('[Fila Prioridade] Não consegui gravar o cache da classificação.', erro);
      return false;
    }
  }

  /**
   * @returns {{resultados: object[], geradoEm: number}|null} null quando não
   *   há cache, ele é de outro dia, ou está corrompido.
   */
  function lerCacheClassificacao() {
    let cru = null;
    try {
      cru = localStorage.getItem(CONFIG.CHAVE_CACHE_CLASSIFICACAO);
    } catch (erro) {
      return null;
    }
    if (!cru) return null;

    let dados;
    try {
      dados = JSON.parse(cru);
    } catch (erro) {
      console.warn('[Fila Prioridade] Cache da classificação corrompido -- descartando.');
      return null;
    }

    if (!dados || dados.dia !== window.__smartTableUtil.dataIso(new Date())) return null;
    if (dados.versaoRegua !== CONFIG.VERSAO_REGUA) {
      console.warn('[Fila Prioridade] Classificação do dia feita com outra régua de faixas -- reclassificando.');
      return null;
    }
    if (!Array.isArray(dados.resultados) || dados.resultados.length === 0) return null;

    // Defesa contra formato antigo: se faltar campo que o pipeline usa, é
    // melhor reclassificar do que montar uma fila silenciosamente errada.
    const valido = dados.resultados.every(
      (r) => r && r.cliente && typeof r.cliente.cnpj === 'string' &&
        r.prioridade != null && r.escolhido && r.escolhido.diasAtrasoReal != null
    );
    if (!valido) {
      console.warn('[Fila Prioridade] Cache da classificação em formato antigo -- descartando.');
      return null;
    }

    return { resultados: dados.resultados, geradoEm: dados.geradoEm };
  }

  /**
   * Lê o snapshot de progresso do dia (ver CHAVE_SNAPSHOT_PROGRESSO); null se
   * não existir, for de outro dia ou estiver corrompido. Mesmo critério de dia
   * (dataIso) do cache de classificação.
   *
   * @returns {{dia: string, geradoEm: number,
   *   clientes: {cnpj: string, prioridadeTier: number, prioridadeNome: string}[]}|null}
   */
  function lerSnapshotProgresso() {
    let cru = null;
    try {
      cru = localStorage.getItem(CONFIG.CHAVE_SNAPSHOT_PROGRESSO);
    } catch (erro) {
      return null;
    }
    if (!cru) return null;

    let dados;
    try {
      dados = JSON.parse(cru);
    } catch (erro) {
      console.warn('[Fila Prioridade] Snapshot de progresso corrompido -- descartando.');
      return null;
    }

    if (!dados || dados.dia !== window.__smartTableUtil.dataIso(new Date())) return null;
    if (!Array.isArray(dados.clientes)) return null;

    return dados;
  }

  /**
   * Grava o snapshot de progresso SÓ SE ainda não existir um de hoje (pedido do
   * usuário): o painel (Módulo 11) mostra sempre a PRIMEIRA fila por prioridade
   * do dia. Nunca sobrescreve o de hoje, nem no Shift+Alt+U; só quando o dia
   * vira a próxima fila grava um novo.
   *
   * @param {object[]} clientesDaFila Mesmo array salvo em fila.clientes
   *   (já com prioridadeTier/prioridadeNome resolvidos).
   */
  function gravarSnapshotProgressoSeForOPrimeiroDoDia(clientesDaFila) {
    if (lerSnapshotProgresso()) return; // já existe um de hoje -- não mexe

    try {
      localStorage.setItem(CONFIG.CHAVE_SNAPSHOT_PROGRESSO, JSON.stringify({
        dia: window.__smartTableUtil.dataIso(new Date()),
        geradoEm: Date.now(),
        // Com a versão da régua, o painel (Módulo 11) sabe se as faixas ainda valem.
        versaoRegua: CONFIG.VERSAO_REGUA,
        clientes: clientesDaFila.map((c) => ({
          cnpj: c.cnpj,
          prioridadeTier: c.prioridadeTier,
          prioridadeNome: c.prioridadeNome,
        })),
      }));
    } catch (erro) {
      console.warn('[Fila Prioridade] Não consegui gravar o snapshot de progresso do dia.', erro);
    }
  }

  /* ---------------------------------------------------------------------
   * MODO SOMBRA -- Alt+U SEM ABRIR ABA
   * -----------------------------------------------------------------
   * A página do cliente baixada por fetch (~0,13 s, sem aba nem pop-up,
   * confirmado ao vivo) traz os títulos em __TITULOS_ABERTOS__, o parágrafo
   * "SCPC:", Promessas/Contatos e a aba Negociações; o grupo econômico vem de
   * GET /api/crm/negociacoes/grupo-outros-com-divida?cliente=<CNPJ>. A "aba
   * virtual" junta isso com a MESMA interface de uma aba de verdade, e
   * classificarAPartirDaAba() classifica. Cada fonte tem teste de equivalência
   * contra a leitura da tela (titulos-da-pagina, pagina-baixada-contexto,
   * negociacoes, grupo-api); o risco que sobra é dado real diferente, que a
   * comparação daqui mede cliente a cliente.
   * --------------------------------------------------------------------- */

  // Leitor de variável de script: mora no Módulo 0 (o Módulo 12 também o usa).
  const lerVariavelDoScript = (doc, nome) => window.__smartTableUtil.lerVariavelDoScript(doc, nome);

  /** SCPC da página baixada -- a MESMA leitura do Módulo 1 (obterValorScpc). */
  function lerScpcDaPagina(doc) {
    for (const p of doc.querySelectorAll('p.text-sm.text-gray-700.mt-1')) {
      const spans = p.querySelectorAll('span');
      for (let i = 0; i < spans.length; i++) {
        if (spans[i].textContent.trim().toUpperCase() === 'SCPC:' && spans[i + 1]) return spans[i + 1].textContent.trim().toLowerCase();
      }
    }
    return null;
  }

  /**
   * A "aba virtual": o que classificarAPartirDaAba() lê de uma aba, montado
   * da página baixada. Lança se faltar qualquer fonte obrigatória -- nunca
   * classifica com dado pela metade.
   */
  async function montarAbaVirtual(cliente, hoje = normalizarData(new Date())) {
    const controle = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    const limite = setTimeout(() => controle?.abort(), CONFIG.SOMBRA_TIMEOUT_PAGINA_MS);
    let html;
    try {
      const r = await window.fetch(cliente.url, { credentials: 'same-origin', signal: controle?.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    } finally {
      clearTimeout(limite);
    }
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const titulos = lerVariavelDoScript(doc, '__TITULOS_ABERTOS__');
    if (!Array.isArray(titulos)) throw new Error('página sem __TITULOS_ABERTOS__');

    const acordos = window.__negociacoes?.acordosDaPaginaBaixada ? await window.__negociacoes.acordosDaPaginaBaixada(doc) : null;
    // Títulos em cartório "fora do relatório" (Módulo 12): mesma marcação da aba de verdade, pelo CNPJ.
    const tituloForaDoRelatorio = window.__alertaCliente?.predicadoForaDoRelatorio?.(cliente.cnpj);
    const dados = window.__avisoCobranca.simularTitulos({ titulos, scpc: lerScpcDaPagina(doc), tituloEmAcordo: acordos?.tituloEmAcordo, tituloForaDoRelatorio }, hoje);
    const contexto = window.__contextoAdicionalDebug.contextoDaPaginaBaixada(doc, dados.registros, hoje);
    const grupoId = (/\/crm\/clientes\/grupo\/([^/?#]+)/.exec(cliente.url) || [])[1] ?? null;
    const empresasComVencido = await window.__grupoEconomico.buscarOutrasEmpresasComVencido(cliente.cnpj, grupoId);

    return {
      closed: false,
      close() {},
      __avisoCobranca: { simular: () => dados },
      __negociacoes: acordos ? { resumoDeCobranca: acordos.resumoDeCobranca } : undefined,
      __contextoAdicional: contexto.__contextoAdicional,
      __contextoAdicionalDebug: contexto.__contextoAdicionalDebug,
      __alertaGrupo: { empresasComVencido },
    };
  }

  /** Classifica pela página baixada. Nunca lança (igual a classificarCliente). */
  async function classificarPelaPaginaBaixada(cliente) {
    try {
      return classificarAPartirDaAba(cliente, await montarAbaVirtual(cliente));
    } catch (erro) {
      return { cliente, erro: `pagina-baixada: ${String(erro?.message || erro).slice(0, 80)}` };
    }
  }

  /** O que a comparação olha de um resultado (o que decide a fila). */
  function resumoParaComparar(r) {
    const destino = r.erro ? 'erro' : r.excluidoPorNaoCobrar ? 'nao-cobrar' : r.excluidoPorAcordo ? 'acordo-em-dia'
      : r.excluidoPorPromessaFutura ? 'promessa-futura' : 'fila';
    return {
      destino,
      faixa: r.prioridade ?? null,
      fluxo: r.fluxo ?? null,
      situacao: r.escolhido?.situacaoKey ?? null,
      dias: r.escolhido?.diasAtrasoReal ?? null,
      titulo: r.escolhido?.tituloCompleto ?? null,
      grupo: (r.empresasComVencido || []).map((e) => String(e?.cnpj || '').replace(/\D/g, '')).sort().join(','),
      ultimoContato: r.ultimoContatoIso ?? null,
    };
  }

  /**
   * Valor de um campo do resumo como ele SAI no relatório (console e
   * localStorage): título e grupo viram apelido estável (privacidade). A
   * COMPARAÇÃO usa o valor real -- censurar antes de comparar deixaria dois
   * grupos diferentes iguais quando o apelido não está disponível.
   */
  function valorCensurado(campo, valor) {
    const apelido = window.__smartTableUtil.apelidoParaLog;
    if (valor == null || valor === '') return valor;
    if (campo === 'titulo') return apelido(valor);
    if (campo === 'grupo') return String(valor).split(',').map((c) => apelido(c)).join(',');
    return valor;
  }

  /**
   * Compara aba x página baixada, cliente a cliente. Resultado de aba com
   * erro (pop-up, timeout) não tem com o que comparar -- conta à parte.
   */
  function compararSombra(pelaAba, pelaPagina) {
    const relatorio = { comparados: 0, iguais: 0, semComparacao: 0, errosDaPagina: 0, diferencas: [] };
    pelaAba.forEach((a, i) => {
      const b = pelaPagina[i];
      if (!a || !b || a.erro) { relatorio.semComparacao += 1; return; }
      if (b.erro) relatorio.errosDaPagina += 1;
      relatorio.comparados += 1;
      const ra = resumoParaComparar(a);
      const rb = resumoParaComparar(b);
      const campos = Object.keys(ra).filter((k) => ra[k] !== rb[k]);
      if (campos.length === 0) { relatorio.iguais += 1; return; }
      relatorio.diferencas.push({
        // Só o apelido: nada de CNPJ nem razão social no relatório.
        id: window.__smartTableUtil.apelidoParaLog(String(a.cliente?.cnpj ?? '').replace(/\D/g, '')),
        campos: Object.fromEntries(campos.map((k) => [k, { aba: valorCensurado(k, ra[k]), pagina: valorCensurado(k, rb[k]) }])),
        erroDaPagina: b.erro ?? null,
      });
    });
    return relatorio;
  }

  function gravarRelatorioSombra(relatorio) {
    const dia = window.__smartTableUtil.dataIso(new Date());
    try {
      localStorage.setItem(CONFIG.CHAVE_SOMBRA_ULTIMA, JSON.stringify({ dia, geradoEm: Date.now(), ...relatorio }));
      let historico = [];
      try { historico = JSON.parse(localStorage.getItem(CONFIG.CHAVE_SOMBRA_HISTORICO) || '[]'); } catch (erro) { historico = []; }
      if (!Array.isArray(historico)) historico = [];
      // UMA entrada por dia: a mesma data substitui a anterior; o limite é de DIAS, não de rodadas.
      historico = historico.filter((h) => h?.dia !== dia);
      historico.push({ dia, comparados: relatorio.comparados, diferencas: relatorio.diferencas.length, errosDaPagina: relatorio.errosDaPagina });
      localStorage.setItem(CONFIG.CHAVE_SOMBRA_HISTORICO, JSON.stringify(historico.slice(-CONFIG.SOMBRA_DIAS_HISTORICO)));
    } catch (erro) {
      console.warn('[Fila Prioridade] Modo sombra: não consegui gravar o relatório.', erro);
    }
  }

  /**
   * O modo sombra roda UMA vez por dia: cada rodada baixa a página de todos os
   * clientes elegíveis. Só conta rodada que gravou relatório.
   */
  function sombraJaRodouHoje(hoje = new Date()) {
    try {
      const ultimo = JSON.parse(localStorage.getItem(CONFIG.CHAVE_SOMBRA_ULTIMA) || 'null');
      return ultimo?.dia === window.__smartTableUtil.dataIso(hoje);
    } catch (erro) {
      return false;
    }
  }

  /** O último relatório e o histórico, pra conferir (console / diagnóstico). */
  function relatorioSombra() {
    try {
      return {
        ultimo: JSON.parse(localStorage.getItem(CONFIG.CHAVE_SOMBRA_ULTIMA) || 'null'),
        historico: JSON.parse(localStorage.getItem(CONFIG.CHAVE_SOMBRA_HISTORICO) || '[]'),
      };
    } catch (erro) {
      return { ultimo: null, historico: [] };
    }
  }

  /** Classifica pela página baixada, com a mesma concorrência limitada. */
  async function rodarSombra(clientes) {
    const resultados = new Array(clientes.length);
    let proximo = 0;
    async function trabalhador() {
      while (proximo < clientes.length) {
        const i = proximo;
        proximo += 1;
        resultados[i] = await classificarPelaPaginaBaixada(clientes[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONFIG.SOMBRA_CONCORRENCIA, clientes.length) }, trabalhador));
    return resultados;
  }

  /** Espera a sombra no máximo o teto; null se não terminou a tempo. */
  function esperarSombra(promessa) {
    return Promise.race([
      promessa.catch((erro) => { console.warn('[Fila Prioridade] Modo sombra falhou.', erro); return null; }),
      new Promise((r) => { const id = setTimeout(() => r(null), CONFIG.SOMBRA_ESPERA_MAXIMA_MS); id?.unref?.(); }),
    ]);
  }

  /**
   * "USAR A FILA ATUAL" (pedido do usuário, botão no painel de progresso): se
   * a PRIMEIRA fila do dia saiu errada (lista filtrada, por exemplo), o
   * progresso ficaria errado o dia todo, pois a referência não muda sozinha.
   * Troca a referência pela fila por prioridade que está valendo agora.
   *
   * Quem já foi cobrado hoje CONTINUA contando, na faixa que tinha: o
   * Shift+Alt+U tira os atendidos da fila nova, e copiar só ela os faria sumir da conta.
   *
   * @param {{gravar?: boolean}} [opcoes] gravar: false só calcula (a prévia
   *   da confirmação); true grava.
   * @returns {{ok: false, motivo: string} | {ok: true, total: number,
   *   mantidosCobrados: number, antes: {total: number, geradoEm: number}|null}}
   */
  function usarFilaAtualComoReferencia(opcoes = {}) {
    const fila = window.filaDebug?.obterFila?.();
    if (!fila || !Array.isArray(fila.clientes) || fila.clientes.length === 0) {
      return { ok: false, motivo: 'Nenhuma fila em andamento agora. Alt+U monta uma.' };
    }
    if (!ehFilaDePrioridade(fila)) {
      return { ok: false, motivo: 'A fila atual foi montada pelo Alt+I (sem prioridade). Use o Alt+U.' };
    }
    const antigo = lerSnapshotProgresso();
    const atendidos = window.filaDebug.obterAtendidosHoje?.() ?? new Set();
    const porCnpj = new Map();
    fila.clientes.forEach((c) => {
      if (c?.cnpj && c.prioridadeTier != null && !porCnpj.has(c.cnpj)) {
        porCnpj.set(c.cnpj, { cnpj: c.cnpj, prioridadeTier: c.prioridadeTier, prioridadeNome: c.prioridadeNome });
      }
    });
    // Referência antiga de OUTRA régua: o número da faixa quer dizer outra coisa.
    // O cobrado mantido vai pra faixa atual de MESMO NOME; sem faixa com esse
    // nome, sai da conta (misturar números de duas réguas errava a faixa em silêncio).
    const mesmaRegua = antigo?.versaoRegua === CONFIG.VERSAO_REGUA;
    const faixaPorNome = new Map(Object.entries(NOMES_PRIORIDADE).map(([faixa, nome]) => [nome, Number(faixa)]));
    faixaPorNome.set('Sem contato ou movimentação há mais de um mês', 9); // nome da faixa 9 até a régua v4
    let semFaixaNaReguaAtual = 0;
    const mantidos = (antigo?.clientes ?? [])
      .filter((c) => c?.cnpj && atendidos.has(c.cnpj) && !porCnpj.has(c.cnpj))
      .map((c) => {
        if (mesmaRegua) return { cnpj: c.cnpj, prioridadeTier: c.prioridadeTier, prioridadeNome: c.prioridadeNome };
        const faixa = faixaPorNome.get(c.prioridadeNome);
        if (faixa == null) { semFaixaNaReguaAtual += 1; return null; }
        return { cnpj: c.cnpj, prioridadeTier: faixa, prioridadeNome: NOMES_PRIORIDADE[faixa] };
      })
      .filter(Boolean);
    if (semFaixaNaReguaAtual > 0) {
      console.warn(`[Fila Prioridade] ${semFaixaNaReguaAtual} cliente(s) cobrado(s) da referência antiga sem faixa com o mesmo nome na régua atual -- fora da conta.`);
    }
    const clientes = [...porCnpj.values(), ...mantidos];
    const resumo = {
      ok: true,
      total: clientes.length,
      mantidosCobrados: mantidos.length,
      antes: antigo ? { total: antigo.clientes.length, geradoEm: antigo.geradoEm } : null,
    };
    if (!opcoes.gravar) return resumo;

    try {
      const agora = Date.now();
      localStorage.setItem(CONFIG.CHAVE_SNAPSHOT_PROGRESSO, JSON.stringify({
        dia: window.__smartTableUtil.dataIso(new Date()),
        geradoEm: agora,
        trocadoEm: agora,
        versaoRegua: CONFIG.VERSAO_REGUA,
        clientes,
      }));
    } catch (erro) {
      console.warn('[Fila Prioridade] Não consegui trocar a referência do progresso.', erro);
      return { ok: false, motivo: 'Não consegui gravar a nova referência (armazenamento do navegador).' };
    }
    return resumo;
  }

  /**
   * @param {{reconstruir?: boolean}} [opcoes] reconstruir: true ignora a
   *   fila de hoje E o cache, e refaz do zero (Shift+Alt+U).
   */
  async function iniciar(opcoes) {
    if (classificandoEmAndamento) {
      toast('Já tem uma classificação em andamento -- aguarde terminar.');
      return;
    }

    // Continuar é o caso comum; refazer é o raro e vem pedido explicitamente.
    // Reconstruir reaplica o filtro de "já contatado hoje", que vem do
    // construirFilaAPartirDaPagina() do Módulo 3 (pula atendidosHoje).
    if (!opcoes?.reconstruir && retomarFilaDeHoje()) return;

    // Segundo atalho, antes das ~92 visitas: a classificação de hoje pode estar
    // no cache. Ordem: fila em andamento > cache do dia > classificar agora; ir
    // direto ao cache descartaria a posição em que o operador parou.
    if (!opcoes?.reconstruir) {
      const cache = lerCacheClassificacao();
      if (cache) {
        // O cache é um retrato da manhã, quando quase ninguém tinha sido atendido.
        // A fila some ao terminar (limparFila, Módulo 3), então sem reaplicar as
        // exclusões o cache reentregaria quem acabou de ser cobrado. O caminho
        // fresco não tem o problema: construirFilaAPartirDaPagina já exclui
        // atendidosHoje. Reaplica também as exclusões da lista que mudam durante
        // o dia: "não cobrar" do botão Alerta (Módulo 12, decisão humana que vence
        // a régua) e movimentação de hoje por fora do SmartTable.
        const atendidos = window.filaDebug.obterAtendidosHoje();
        const mapaClientes = obterMapaClientes();
        const aindaAbertos = cache.resultados.filter((r) => {
          const cnpj = r.cliente?.cnpj;
          if (atendidos.has(cnpj)) return false;
          if (window.__alertaCliente?.estaSuprimidoDaPrioridade?.(cnpj)) return false;
          const dados = mapaClientes ? mapaClientes.get(cnpj) : null;
          return !movimentacaoEhHoje(dados ? dados.dataUltimaMovimentacao : null);
        });

        if (aindaAbertos.length === 0) {
          toast('Todos os clientes classificados hoje já foram contatados (ou estão marcados pra não cobrar). Shift+Alt+U refaz do zero.', 6000);
          return;
        }

        // Um toast só: o resumo do finalizarFila vem logo atrás e cobria este.
        // A idade da classificação vai pro console.
        const minutos = Math.round((Date.now() - cache.geradoEm) / 60000);
        console.log(
          `[Fila Prioridade] Fila montada do cache de hoje (${minutos} min atrás): ` +
          `${aindaAbertos.length} de ${cache.resultados.length} ainda não contatados.`
        );
        finalizarFila(aindaAbertos, {}, null);
        return;
      }
    }

    const candidatos = candidatosEnriquecidos();
    if (candidatos === null) return; // aviso já foi ao console
    if (candidatos.length === 0) {
      toast('⚠️ Nenhum cliente encontrado nesta página com os seletores atuais.');
      return;
    }

    const { sobreviventes, excluidos } = filtrarPorRegrasDaLista(candidatos);
    // Logs em JSON.stringify de propósito: o Chrome mostra objeto cru como só
    // "Object" quando o console é copiado como texto. O detalhamento permite
    // saber se um resultado baixo é esperado ou se algum filtro exclui demais.
    console.log('[Fila Prioridade] Candidatos após construirFilaAPartirDaPagina:', candidatos.length);
    console.log('[Fila Prioridade] Detalhamento dos filtros da lista:', JSON.stringify({
      sobreviventes: sobreviventes.length,
      excluidos_mais_de_19_dias: excluidos.dias,
      excluidos_dia_1: excluidos.diaUm,
      excluidos_movimentacao_hoje: excluidos.movimentacaoHoje,
      excluidos_sem_dias_reconhecidos: excluidos.semDias,
    }));
    if (sobreviventes.length === 0) {
      toast('Nenhum cliente elegível depois dos filtros (dias de atraso, dia 1, movimentação de hoje).');
      return;
    }

    classificandoEmAndamento = true;
    // A trava vale até o FIM: durante a espera da sombra (até 20 s) ainda não há
    // fila nem cache gravados, e um segundo Alt+U começaria outra classificação inteira.
    try {
      atualizarIndicadorProgresso(`Classificando 0/${sobreviventes.length}...`);

      // MODO SOMBRA: corre JUNTO com as abas e é comparada no fim. Não entra na fila.
      const sombra = window.__avisoCobranca?.simularTitulos && window.__grupoEconomico && window.__contextoAdicionalDebug?.contextoDaPaginaBaixada && !sombraJaRodouHoje()
        ? rodarSombra(sobreviventes)
        : null;

      const resultados = [];
      let lote;
      try {
        lote = await classificarEmLote(
          sobreviventes,
          (feitos, total) => atualizarIndicadorProgresso(`Classificando ${feitos}/${total}...`)
        );
      } catch (erro) {
        // Sem isto uma exceção deixava a trava e o indicador ligados até recarregar
        // ("já tem uma classificação em andamento").
        console.error('[Fila Prioridade] Erro inesperado na classificação -- abortando esta rodada.', erro);
        toast('Erro ao classificar a fila (veja o console). Tente Shift+Alt+U de novo.', 6000);
        return;
      } finally {
        removerIndicadorProgresso();
      }
      const { resultados: todos, abortouPorPopup } = lote;

      if (sombra) {
        const pelaPagina = await esperarSombra(sombra);
        if (pelaPagina) {
          const relatorio = compararSombra(todos, pelaPagina);
          gravarRelatorioSombra(relatorio);
          console.log('[Fila Prioridade] Modo sombra (página baixada x aba):', JSON.stringify(relatorio));
          const n = relatorio.diferencas.length;
          toast(n === 0
            ? `Modo sombra: ${relatorio.comparados} clientes comparados, nenhuma diferença.`
            : `Modo sombra: ${n} diferença(s) em ${relatorio.comparados} clientes -- detalhes no console (a fila usa as abas, como sempre).`, 7000);
        } else {
          console.warn('[Fila Prioridade] Modo sombra não terminou a tempo -- comparação desta rodada descartada.');
        }
      }

      if (abortouPorPopup) {
        console.warn('[Fila Prioridade] Parando cedo: pop-ups bloqueados de forma sistemática.');
        toast(
          '⚠️ O navegador está bloqueando as abas de fundo. Permita pop-ups para texhub.texcotton.com.br ' +
          '(ícone na barra de endereço, ou chrome://settings/content/popups) e tente Shift+Alt+U de novo.',
          9000
        );
        return;
      }

      const contadores = {
        excluidosPorPromessa: todos.filter((r) => r.excluidoPorPromessaFutura).length,
        excluidosPorNaoCobrar: todos.filter((r) => r.excluidoPorNaoCobrar).length,
        excluidosPorAcordo: todos.filter((r) => r.excluidoPorAcordo).length,
        comPopupBloqueado: todos.filter((r) => r.erro === 'popup-bloqueado').length,
        comOutroErro: todos.filter((r) => r.erro && r.erro !== 'popup-bloqueado').length,
      };
      todos.filter((r) => !r.erro && !r.excluidoPorPromessaFutura && !r.excluidoPorNaoCobrar && !r.excluidoPorAcordo)
        .forEach((r) => resultados.push(r));

      // Lista filtrada (decisão do usuário): a fila vale pra agora, mas NÃO vira
      // a classificação do dia (o cache seria reaproveitado sem filtro e
      // entregaria só parte da carteira), nem a referência do progresso
      // (Módulo 11), nem a atribuição do diário.
      const filtrosNaLista = filtrosAtivosNaListaAtual();
      if (filtrosNaLista) {
        console.warn(`[Fila Prioridade] Lista com filtro (${filtrosNaLista.join(', ')}) -- fila montada só com esses clientes; cache do dia, progresso e diário NÃO gravados.`);
        toast(`Lista com filtro (${filtrosNaLista.join(', ')}): esta fila tem só os clientes do filtro. A classificação do dia e o progresso só são gravados com a lista completa.`, 9000);
        finalizarFila(resultados, contadores, excluidos, { registrarAtribuicao: false, gravarReferenciaDoProgresso: false });
        return;
      }

      // Grava o cache ANTES de montar a fila: se a montagem falhar por algum
      // motivo, o trabalho caro (as ~92 visitas) não se perde.
      gravarCacheClassificacao(resultados);

      finalizarFila(resultados, contadores, excluidos, { registrarAtribuicao: true });
    } finally {
      classificandoEmAndamento = false;
    }
  }

  /**
   * Filtros do CRM ligados na lista (Módulo 0; mesma regra da Carteira), ou
   * null. FALHA FECHADA: sem o detector, trata como filtrada (a fila sai igual,
   * mas sem gravar cache do dia, progresso nem diário; gravar lista parcial
   * como "o dia" é o erro caro).
   */
  function filtrosAtivosNaListaAtual() {
    const detectar = window.__smartTableUtil?.filtrosAtivosNaListaDeClientes;
    if (typeof detectar !== 'function') return ['não deu pra conferir os filtros (atualize o SmartTable)'];
    return detectar(window.CLIENTES, { pessoas: window.__carteira?.CONFIG_CARTEIRA?.PESSOAS });
  }

  /**
   * Tudo que acontece DEPOIS da classificação: dedupe de grupo econômico,
   * ordenação pela régua, diário, gravação da fila e navegação.
   *
   * Tem DOIS caminhos de entrada (fresco e cache do dia); fica num só lugar pra
   * eles não divergirem em silêncio. Há teste travando saída idêntica.
   *
   * @param {object[]} resultados Classificados com sucesso.
   * @param {object} contadores Para o resumo na tela (zeros vindo do cache).
   * @param {object} excluidos Exclusões da lista, para o mesmo resumo.
   * @param {{registrarAtribuicao?: boolean, gravarReferenciaDoProgresso?: boolean}} [opcoesDaFila]
   *   registrarAtribuicao grava a atribuição do dia no diário. Só o caminho
   *   FRESCO passa true -- ver a guarda lá embaixo e o porquê.
   *   gravarReferenciaDoProgresso: false quando a lista estava filtrada.
   */
  function finalizarFila(resultados, contadores, excluidos, opcoesDaFila) {
    const {
      excluidosPorPromessa = 0,
      excluidosPorNaoCobrar = 0,
      excluidosPorAcordo = 0,
      comPopupBloqueado = 0,
      comOutroErro = 0,
    } = contadores || {};

    // Uma chamada só -- a união-find do grupo econômico não é barata.
    // `let` porque a ordenação pela régua (mais abaixo) devolve uma lista nova.
    const filtradoPorGrupo = filtrarPorGrupoEconomico(resultados);
    const { excluidosPorGrupo } = filtradoPorGrupo;
    let resultadosSemDuplicataDeGrupo = filtradoPorGrupo.sobreviventes;

    console.log('[Fila Prioridade] Detalhamento da classificação:', JSON.stringify({
      classificados_com_sucesso: resultados.length,
      excluidos_por_promessa_futura: excluidosPorPromessa,
      excluidos_por_nao_cobrar: excluidosPorNaoCobrar,
      excluidos_por_acordo_em_dia: excluidosPorAcordo,
      pulados_por_popup_bloqueado: comPopupBloqueado,
      com_outro_erro_timeout: comOutroErro,
      excluidos_por_grupo_economico_ja_representado: excluidosPorGrupo,
    }));

    if (resultadosSemDuplicataDeGrupo.length === 0) {
      toast('Classificação terminou, mas nenhum cliente ficou elegível pra fila.', 5000);
      return;
    }

    // Ordena pela régua (faixa 1 primeiro; desempates em compararPelaRegua). A
    // fila sai 100% na ordem da régua: o grupo de controle com posição sorteada
    // foi REMOVIDO a pedido do usuário, que não quer o mecanismo no código.
    resultadosSemDuplicataDeGrupo = resultadosSemDuplicataDeGrupo.slice().sort(compararPelaRegua);
    const diario = window.__diario;

    const clientesDaFila = resultadosSemDuplicataDeGrupo.map((r) => Object.assign({}, r.cliente, {
      diasAtraso: r.escolhido.diasAtrasoReal,
      prioridadeTier: r.prioridade,
      prioridadeNome: NOMES_PRIORIDADE[r.prioridade],
      versaoRegua: CONFIG.VERSAO_REGUA,
      ultimoContatoIso: r.ultimoContatoIso ?? null,
      // Gravado pra autoconferência do Diário (Módulo 8) do desempate por valor.
      // Fica só no localStorage.
      valorVencido: r.valorVencido ?? 0,
    }));

    // Registra a ATRIBUIÇÃO do dia (faixa, posição final e grupo) num lote só,
    // com um acesso ao localStorage. Sem o diário carregado, segue sem ele.
    //
    // SÓ NA PRIMEIRA VEZ DO DIA: finalizarFila tem dois chamadores (fresco e
    // cache), e sem a guarda a remontagem gravaria uma segunda atribuição do
    // mesmo dia. analisar() deduplica por (cnpj, dia), mas o contador
    // atribuicoesRepetidas existe pra denunciar isso; dispará-lo todo dia
    // aposenta o alarme.
    //
    // O padrão é NÃO registrar: chamador novo que precise tem que pedir. Dado
    // faltando é recuperável; dado duplicado contamina em silêncio.
    if (diario && opcoesDaFila?.registrarAtribuicao) {
      diario.registrarLote(
        'fila',
        resultadosSemDuplicataDeGrupo.map((r, indice) => ({
          c: r.cliente.cnpj,
          f: r.prioridade,
          r: CONFIG.VERSAO_REGUA,
          p: indice + 1,
          s: r.escolhido.situacaoKey,
          a: r.escolhido.diasAtrasoReal,
        }))
      );
    }

    const fila = {
      versao: window.filaDebug.CONFIG.VERSAO_SCHEMA,
      clientes: clientesDaFila,
      indiceAtual: -1,
      totalAtendidos: 0,
      totalPulados: 0,
      iniciadoEm: Date.now(),
    };
    // Marca da lista filtrada: a retomada (retomarFilaDeHoje) lê isto para
    // não transformar a fila parcial na referência do progresso.
    if (opcoesDaFila?.gravarReferenciaDoProgresso === false) fila.filtrada = true;
    window.filaDebug.salvarFila(fila);

    // Painel de progresso (Módulo 11) preso ao resultado desta fila SE for a
    // primeira do dia (pedido do usuário). Fila de lista filtrada nunca vira referência.
    if (opcoesDaFila?.gravarReferenciaDoProgresso !== false) gravarSnapshotProgressoSeForOPrimeiroDoDia(clientesDaFila);

    const resumoPartes = [`▶ Fila por prioridade: ${clientesDaFila.length} cliente(s)`];
    if (excluidos && (excluidos.dias || excluidos.diaUm || excluidos.movimentacaoHoje)) {
      resumoPartes.push(
        `${excluidos.dias + excluidos.diaUm + excluidos.movimentacaoHoje} excluído(s) pela lista (dias/dia 1/movimentação hoje)`
      );
    }
    if (excluidosPorPromessa) resumoPartes.push(`${excluidosPorPromessa} excluído(s) por promessa futura`);
    if (excluidosPorNaoCobrar) resumoPartes.push(`${excluidosPorNaoCobrar} excluído(s) por alerta de não cobrar`);
    if (excluidosPorAcordo) resumoPartes.push(`${excluidosPorAcordo} fora por acordo em dia`);
    if (comPopupBloqueado) resumoPartes.push(`${comPopupBloqueado} pulado(s) por pop-up bloqueado`);
    if (comOutroErro) resumoPartes.push(`${comOutroErro} com erro/timeout`);
    if (excluidosPorGrupo) resumoPartes.push(`${excluidosPorGrupo} excluído(s) por já ter representante do grupo na fila`);
    const duracaoResumoMs = 6000;
    toast(resumoPartes.join(' -- '), duracaoResumoMs);

    console.log(
      '[Fila Prioridade] Fila montada:',
      JSON.stringify(clientesDaFila.map((c) => ({ id: window.__smartTableUtil.apelidoParaLog(c.cnpj), diasAtraso: c.diasAtraso, prioridadeTier: c.prioridadeTier, prioridadeNome: c.prioridadeNome })))
    );

    // Espera o toast terminar antes de navegar: o resumo tem informação que precisa ser lida.
    setTimeout(() => {
      window.location.href = clientesDaFila[0].url;
    }, duracaoResumoMs);
  }

  /* ---------------------------------------------------------------------
   * 7. AVISO DE TROCA DE PRIORIDADE (roda em toda página, como o Módulo 3)
   * --------------------------------------------------------------------- */
  // Só reage a filas deste módulo (clientes com prioridadeTier); fila do Alt+I
  // nunca dispara. Avisa se a prioridade mudou em relação ao cliente anterior,
  // avançando ou voltando. Depende do Módulo 3 já ter rodado sincronizarPosicao()
  // nesta carga (atualiza fila.indiceAtual), por isso vem DEPOIS dele no @require.
  function avisarSeTrocouDePrioridade() {
    if (!window.filaDebug || typeof window.filaDebug.obterFila !== 'function') return;
    const fila = window.filaDebug.obterFila();
    if (!fila || fila.indiceAtual == null || fila.indiceAtual < 0) return;

    const atual = fila.clientes[fila.indiceAtual];
    if (!atual || atual.prioridadeTier == null) return; // não é uma fila por prioridade

    if (fila.indiceAtual === 0) {
      toastTrocaPrioridade('Prioridade', atual.prioridadeTier, atual.prioridadeNome);
      return;
    }

    const anterior = fila.clientes[fila.indiceAtual - 1];
    if (anterior && anterior.prioridadeTier !== atual.prioridadeTier) {
      toastTrocaPrioridade('Entrando na prioridade', atual.prioridadeTier, atual.prioridadeNome);
    }
  }

  /* ---------------------------------------------------------------------
   * 8. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  function aoCarregar() {
    // Dá tempo do Módulo 3 rodar sincronizarPosicao() primeiro; o @require já
    // garante a ordem, o setTimeout(0) é rede de segurança.
    setTimeout(() => {
      try {
        avisarSeTrocouDePrioridade();
      } catch (erro) {
        console.error('[Fila Prioridade] Erro ao checar troca de prioridade -- continuando mesmo assim.', erro);
      }
    }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aoCarregar);
  } else {
    aoCarregar();
  }

  window.filaPrioridadeDebug = {
    ehFilaDePrioridade,
    usarFilaAtualComoReferencia,
    filtrosAtivosNaListaAtual,
    classificarAPartirDaAba,
    montarAbaVirtual,
    classificarPelaPaginaBaixada,
    compararSombra,
    relatorioSombra,
    gravarRelatorioSombra,
    sombraJaRodouHoje,
    lerVariavelDoScript,
    ehDaReguaAtual,
    alvoDeRetomada,
    retomarFilaDeHoje,
    removerAtendidosHojeDaFila,
    obterMapaClientes,
    lerSnapshotProgresso,
    gravarSnapshotProgressoSeForOPrimeiroDoDia,
    classificarEmLote,
    lerCacheClassificacao,
    gravarCacheClassificacao,
    paraOCache,
    finalizarFila,
    CONFIG,
    NOMES_PRIORIDADE,
    FAIXA_SCPC_ANTES_DO_AVISO,
    CORES_PRIORIDADE,
    compararPelaRegua,
    iniciar,
    candidatosEnriquecidos,
    filtrarPorRegrasDaLista,
    determinarPrioridade,
    maiorAtrasoEntreTodos,
    valorVencidoEntre,
    ehClusterNovo,
    semMovimentoHaDuasSemanas,
    filtrarPorGrupoEconomico,
    escolherTituloRepresentativo,
  };
})();
