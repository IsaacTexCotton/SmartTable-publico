/* =========================================================================
 * MÓDULO 7: FILA POR PRIORIDADE — CRM TexCotton
 * -------------------------------------------------------------------------
 * O que faz: monta uma fila de atendimento (mesmo formato/mecanismo do
 * Módulo 3 -- navegação, painel, Alt+P/Alt+V, "continuar fila anterior")
 * mas ORDENADA por uma régua de prioridade de negócio, em vez de só por
 * dias de atraso. Atalho separado (Alt+U) -- o Alt+I original continua
 * exatamente como está, sem nenhuma mudança de comportamento.
 *
 * REGRA DE PRIORIDADE (CONFIRMADA com o usuário -- 3ª revisão, 23/09/2026;
 * faixas 12 a 15 na 4ª, 28/09/2026 -- régua v3; SCPC antes do aviso subiu
 * para a faixa 10 no mesmo dia -- régua v4; régua v5, 29/09/2026: a faixa 9
 * passou de 30 para 14 dias e o atraso inicial subiu para a 10, com os dois
 * SCPC abaixo dele -- ver CONFIG.VERSAO_REGUA),
 * em ordem -- cada cliente entra na
 * PRIMEIRA faixa que se aplicar a ele:
 *   1. Cartório -- último dia (situação ULTIMO_DIA, fluxo Cartório)
 *   2. Cluster "Novo" -- vale em QUALQUER situação de título, inclusive já
 *      em cartório, e por isso é a ÚNICA faixa isenta do teto de
 *      DIAS_ATRASO_MAX no filtro da lista (ver filtrarPorRegrasDaLista):
 *      PEDIDO DO USUÁRIO -- um cliente novo com título em cartório precisa
 *      continuar aparecendo na fila porque a cobrança é quem bloqueia o
 *      faturamento desse cliente.
 *   3. Segundo dia de atraso (situação EM_ATRASO, dia 2 exato, e NENHUM
 *      título do cliente com mais dias, cartório incluído -- v1.47.1)
 *   4. Sem nenhum contato -- a aba Contatos do cliente está VAZIA: ninguém,
 *      de nenhum usuário, nunca registrou contato (CONFIRMADO com o usuário:
 *      "nenhum contato, de ninguém" -- é o semContatoAnterior do Módulo 6,
 *      o mesmo dado que faz o Alt+A se apresentar)
 *   5. Dia da promessa de pagamento (o cliente combinou pagar HOJE e o
 *      título continua em aberto -- ver DIA_DA_PROMESSA no Módulo 6)
 *   6. Promessa não cumprida (promessa vencida sem pagamento identificado
 *      e ainda sem nenhum contato registrado depois do vencimento -- ver
 *      QUEBRADA/PARCIAL no Módulo 6)
 *   7. Aviso final antes da suspensão (situação NEGATIVADO_SCPC, dia 19
 *      exato -- mesmo limiar usado pelo Módulo 4 pra mensagem)
 *   8. Antes do aviso final (situação NEGATIVADO_SCPC, dias 16 a 18 -- o
 *      resto da janela de aviso de suspensão)
 *   9. Sem contato OU sem movimentação há 14 dias ou mais (duas semanas
 *      corridas -- cliente "esquecido"). Entra se QUALQUER um dos dois
 *      chegar a 14 dias: o contato mais recente da aba Contatos (de qualquer
 *      pessoa) ou a última movimentação da conta (lista de clientes).
 *      Régua v5 (29/09/2026), pedido do usuário: era "mais de um mês" (30
 *      dias, v1.39.0 ampliou pra incluir o contato); agora é ">= 14".
 *   10. Atraso inicial, 3º ao 4º dia (situação EM_ATRASO, dias 3-4) -- E
 *      NENHUM título do cliente com mais dias de atraso, inclusive os já em
 *      cartório (CONFIRMADO com o usuário: "também conta"). Dia 1 NÃO conta
 *      como dia de cobrança, fica de fora da lista; dia 2 tem faixa própria.
 *      Régua v5: subiu da 12 para a 10, ACIMA dos dois SCPC abaixo -- decisão
 *      do usuário (29/09/2026), mantida depois de avisado que o SCPC último
 *      dia fica no fim da fila.
 *   11. SCPC negativado antes do aviso de suspensão (NEGATIVADO_SCPC, abaixo
 *      do 16º dia). Dentro dela, quem está mais perto do 16º dia vem primeiro.
 *   12. SCPC -- último dia (situação ULTIMO_DIA, fluxo SCPC). Era a faixa 6
 *      na régua v1, a 10 até a v3 e a 11 na v4; a descida foi decisão do
 *      usuário.
 *   13. Título em cartório + outro vencido fora do cartório (ainda há
 *      título que dá pra evitar) -- régua v3, 28/09/2026. Medido na fila
 *      real: 8 dos 34 "Demais dias", mais os de 2º dia com cartório.
 *   14. 5º dia de atraso (situação EM_ATRASO, dia 5 -- amanhã vira "último
 *      dia") -- régua v3. Era "Demais dias" de propósito até a v2; 12 dos 34.
 *   15. Demais dias (tudo que não caiu em nenhuma faixa acima)
 *
 * DENTRO DA MESMA FAIXA (CONFIRMADO com o usuário na régua v2; valor na v3):
 * do contato mais ANTIGO pro mais recente -- quem está há mais tempo sem ser
 * procurado vem primeiro; quem nunca teve contato vem antes de todos. Empate:
 * maior valor vencido primeiro (v3), depois mais dias de atraso. Na faixa 11,
 * antes de tudo, mais dias (mais perto do 16º). Ver compararPelaRegua.
 *
 * ANTES de qualquer faixa, um cliente pode ser suprimido de vez desta fila:
 * o botão "Alerta" na página do cliente (Módulo 12) marca "não cobrar" por
 * um número de dias escolhido pelo operador (padrão 1). Enquanto ativo, o
 * cliente nem entra em filtrarPorRegrasDaLista -- é decisão humana
 * explícita, vence até a isenção do Cluster Novo. Ver Módulo 12 pro
 * porquê e pro formulário.
 *
 * POR QUE AS FAIXAS 4 E 5 FICAM ACIMA DE SCPC-ÚLTIMO-DIA E DO AVISO DE
 * SUSPENSÃO (decisão explicada pro usuário): são os clientes que JÁ SE
 * COMPROMETERAM -- quem prometeu pagar hoje só converte se for lembrado
 * hoje (janela de um dia só), e quem quebrou a promessa é o contato de
 * maior conversão da carteira. O dado vem de
 * window.__contextoAdicional.promessa, que o Módulo 6 já calcula na mesma
 * visita em aba de fundo -- custo zero de tempo.
 *
 * A metade "movimentação" da faixa 9 usa o mesmo campo
 * movimentacaoDataIso já lido da lista (window.CLIENTES) pra excluir quem
 * mexeu HOJE -- aqui serve o propósito oposto, achar quem está PARADO há
 * muito tempo (14 dias corridos ou mais, régua v5), pra não deixar conta esquecida se
 * perder entre as de rotina.
 *
 * EXCLUSÕES (nunca entram na lista, em nenhuma faixa):
 *   - Mais de 19 dias de atraso
 *   - Dia 1 de atraso (não é considerado dia de cobrança ainda)
 *   - Última movimentação (a data mais recente mostrada na linha da
 *     lista) é HOJE
 *   - Existe alguma promessa (qualquer status) com data prometida DEPOIS
 *     de hoje
 *   - Qualquer título do cliente dispara alerta de "não cobrar" no Módulo 1
 *     (posição NAO COBRAR/CARTEIRA, ou todos os títulos já em cartório --
 *     mesmo critério do banner avisarSeNaoCobrar) -- exclui o CLIENTE
 *     inteiro, não só o título específico.
 *   - CONFIRMADO com o usuário: quando 2+ clientes do MESMO grupo econômico
 *     (confirmado via window.__alertaGrupo, lido pelo Módulo 5 na aba
 *     "Grupo" de verdade de cada cliente -- NÃO é o grupoId da lista, que é
 *     outro campo sem relação com grupo econômico) têm título em aberto, só
 *     a representante MAIS URGENTE do grupo entra na fila -- as demais já
 *     serão cobradas por tabela a partir dessa visita (ver
 *     filtrarPorGrupoEconomico).
 *
 * POR QUE PRECISA VISITAR CADA CLIENTE: a lista de clientes (página de
 * lista) só mostra dias de atraso, cluster e a data da última movimentação
 * -- NÃO mostra a situação real do título (ULTIMO_DIA/NEGATIVADO_SCPC) nem
 * o fluxo (Cartório/SCPC), porque esses dois só existem depois de rodar a
 * classificação de verdade (Módulo 1), que por sua vez depende de um campo
 * ("SCPC:") que só aparece na PÁGINA DE DETALHE de cada cliente. Promessas
 * também só existem na aba "Promessas" da página de detalhe. Por isso este
 * módulo visita cada candidato em aba de fundo e só monta a fila depois de
 * classificar todo mundo.
 *
 * POR QUE ABA, e não algo melhor -- três alternativas testadas AO VIVO com o
 * usuário em 18/09/2026, todas derrubadas por dado real:
 *
 *   - API de cliente: NÃO EXISTE. Um reload completo com Preserve log no
 *     DevTools mostrou dois endpoints, /api/notificacoes/contagem e
 *     /api/perfil/foto. Nada de títulos, promessa ou grupo.
 *   - iframe oculto (seria invisível, paralelo, e não encostaria no Módulo 1
 *     protegido, já que nossos módulos são injetados em frames): o CRM
 *     responde X-Frame-Options: deny.
 *   - fetch + DOMParser (X-Frame-Options não se aplica a fetch): o HTML
 *     baixado vem SEM a tabela de títulos, sem o parágrafo do SCPC, sem
 *     promessa e sem grupo NO HTML. A hipótese levantada então -- a página
 *     montar o conteúdo no navegador a partir de dados embutidos num
 *     <script>, como a lista já faz com window.CLIENTES -- foi perseguida
 *     depois e funcionou: ver MODO SOMBRA (v1.45.0), mais abaixo, que lê
 *     __TITULOS_ABERTOS__ e companhia da página baixada. A fila continua
 *     sendo montada pelas abas; a página baixada roda junto só para
 *     comparar.
 *
 * CONCORRÊNCIA: as abas abrem de CONFIG.CONCORRENCIA_CLASSIFICACAO em
 * CONCORRENCIA_CLASSIFICACAO (4), não mais uma de cada vez -- com ~92
 * candidatos, sequencial custava 3 a 5 minutos. O teto é conservador de
 * propósito: são ~92 cargas de página contra o CRM da empresa.
 *
 * SOBRE POPUP: os `window.open` a partir do segundo já não estão dentro do
 * gesto original de teclado. SE o navegador bloquear, o cliente fica de fora
 * (sem travar o resto), e há um disjuntor: 3 bloqueios sem nenhum sucesso
 * param tudo e avisam. Por isso a varredura AQUECE sequencialmente até o
 * primeiro sucesso antes de paralelizar -- sem isso o disjuntor afrouxa,
 * porque quando o 3º bloqueio é contabilizado já há outras abas em voo. A
 * correção, quando acontece, é permitir pop-ups pra este site (ação única).
 *
 * CACHE DO DIA: a classificação é gravada em
 * CONFIG.CHAVE_CACHE_CLASSIFICACAO e o Alt+U a reaproveita, então ela roda
 * UMA vez por dia (Shift+Alt+U força outra). DECISÃO DO USUÁRIO, registrada
 * porque é tentador "melhorar" isto depois: NÃO existe disparo automático de
 * manhã. Chegou a ser desenhado e foi recusado quando ficaram claras as duas
 * limitações -- userscript não roda com o navegador fechado (o horário vira
 * "primeira carga de página a partir dele") e a classificação só funciona na
 * página da LISTA, de onde lê os candidatos. Um Shift+Alt+U ao chegar
 * resolve o mesmo, sem trava entre abas nem abas abrindo sozinhas.
 *
 * Onde colar: anexado ao FINAL do smart-table.js, depois do Módulo 0
 * (Utilitários Compartilhados -- usa window.__smartTableUtil.toast/
 * normalizarData/escolherTituloRepresentativo) e do Módulo 3 (Fila de
 * Atendimento) -- usa window.filaDebug.construirFilaAPartirDaPagina,
 * .salvarFila, .obterFila e .CONFIG. O atalho de teclado (Alt+U) em si fica
 * no Módulo 4, que chama window.filaPrioridadeDebug.iniciar() -- mesmo
 * padrão usado pro Alt+I chamar window.filaDebug.iniciarFila().
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__filaPrioridadeCarregada) return;
  window.__filaPrioridadeCarregada = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Fila por Prioridade');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  // `esperar` saiu daqui: estava importado e nunca usado (achado pelo ESLint).
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
    // O 5º DIA FICA DE FORA DESTA FAIXA DE PROPÓSITO -- CONFIRMADO com o usuário
    // depois de conferir uma fila real, onde 14 dos 92 clientes eram justamente
    // dia 5. Na régua v3 ele ganhou faixa própria (14 na v4), ABAIXO desta. NÃO é lacuna esquecida entre o dia 2 e os
    // dias 3-4: é a régua como ela foi desenhada. Quem for "consertar" isso
    // acrescentando o 5 aqui vai derrubar o teste
    // "EM_ATRASO dia 5 NÃO é atraso inicial" em tests/fila-prioridade.test.js,
    // e deve trazer a mudança pro usuário em vez de tratar como bug.
    DIAS_PRIORIDADE_ATRASO_INICIAL: [3, 4],
    // Prioridade 14 (régua v3, 28/09/2026, pedido do usuário depois de medir
    // a faixa "Demais dias" numa fila real): o 5º dia ganhou faixa PRÓPRIA,
    // abaixo do atraso inicial -- continua fora da faixa 10, como decidido.
    DIA_PRIORIDADE_QUINTO_DIA: 5,
    // Versão da régua de faixas. Sobe toda vez que a NUMERAÇÃO das faixas
    // muda: vai gravada em cada cliente da fila (versaoRegua) e em cada
    // registro do diário (campo r), pra que uma fila ou um histórico montado
    // com a numeração antiga nunca seja lido com os nomes da nova -- a faixa
    // "5" da v1 (Promessa não cumprida) é outra coisa na v2 (Dia da promessa).
    VERSAO_REGUA: 6,
    // Prioridade 9: última movimentação OU último contato há tantos dias
    // corridos OU MAIS (régua v5, 29/09/2026, pedido do usuário: "duas
    // semanas", e ">= 14"). Era 30 e "mais de" (> 30) até a v4. A Carteira
    // (Módulo 14) tem o seu próprio limite de 30 e NÃO acompanha.
    DIAS_MOVIMENTACAO_ANTIGA: 14,
    // Prioridade 5 e escolha do título representativo: mesmos limiares do
    // aviso de suspensão de cadastro SCPC usados em todo o resto do sistema
    // -- vêm do Módulo 0 (window.__smartTableUtil), não são mais uma cópia
    // local. MANTER SINCRONIZADO manualmente só se um dia o Módulo 2
    // (protegido, ainda com sua própria cópia) divergir.
    DIA_ULTIMO_DIA_SUSPENSAO_SCPC: window.__smartTableUtil.DIAS_ULTIMO_DIA_SUSPENSAO_SCPC,
    DIA_INICIO_AVISO_SUSPENSAO_SCPC: window.__smartTableUtil.DIAS_AVISO_SUSPENSAO_SCPC_MIN,
    // Tempo esperando cada aba de fundo ficar pronta pra ler (Módulo 1 +
    // Módulo 6 carregados) -- mesma ordem de grandeza do Alt+A.
    TIMEOUT_CLASSIFICACAO_MS: 8000,
    INTERVALO_POLL_MS: 200,
    // Quantas abas de fundo abrem AO MESMO TEMPO.
    //
    // Era 1 (estritamente sequencial). Com ~92 sobreviventes e 1-3s por
    // página, isso dava 3 a 5 minutos -- e a única forma de ver a fila era
    // pagar esse preço inteiro.
    //
    // 4 é conservador de propósito: são 92 cargas de página contra o CRM da
    // empresa, e acelerar demais transforma uma automação de cobrança em
    // algo que o servidor pode legitimamente achar abusivo. Subir isso é
    // decisão de operação, não de código.
    CONCORRENCIA_CLASSIFICACAO: 4,
    // Cache da classificação do dia. SEPARADO da fila de propósito: gravar
    // por cima da fila destruiria a posição em que você parou -- o mesmo bug
    // que a v1.16.0 acabou de consertar.
    CHAVE_CACHE_CLASSIFICACAO: 'smarttable_classificacao_v2',
    // PEDIDO DO USUÁRIO: o painel de progresso (Módulo 11) precisa mostrar
    // sempre o resultado da PRIMEIRA fila por prioridade do dia -- não a
    // fila "ao vivo", que encolhe conforme clientes são atendidos/removidos
    // (Shift+Alt+U reclassifica, retomarFilaDeHoje tira quem já mexeu hoje).
    // Esse snapshot é gravado uma vez só por dia (ver
    // gravarSnapshotProgressoSeForOPrimeiroDoDia) e só é substituído quando
    // o dia muda -- exatamente como o cache acima, mas nunca reescrito
    // dentro do mesmo dia, nem pelo Shift+Alt+U.
    CHAVE_SNAPSHOT_PROGRESSO: 'smarttable_progresso_dia_v2',
    // MODO SOMBRA (v1.45.0): o Alt+U continua abrindo abas; a classificação
    // pela página BAIXADA roda junto e o resultado é comparado. Só troca de
    // caminho quando a comparação der zero diferença nos dias reais.
    CHAVE_SOMBRA_ULTIMA: 'smarttable_sombra_alt_u_v1',
    CHAVE_SOMBRA_HISTORICO: 'smarttable_sombra_alt_u_historico_v1',
    SOMBRA_CONCORRENCIA: 4,
    SOMBRA_TIMEOUT_PAGINA_MS: 15000,
    // Depois que as abas terminam, espera a sombra no máximo isto antes de
    // montar a fila -- a fila NUNCA atrasa por causa da sombra além disso.
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

  // Cor de cada faixa: borda do aviso de troca de prioridade (ver
  // toastTrocaPrioridade abaixo) e barra/ponto do painel de progresso
  // (Módulo 11). Paleta v1.48.1, aprovada pelo usuário em 28/09, escolhida
  // por critério e não por gosto:
  //  - contraste de pelo menos 3:1 sobre o branco do painel (WCAG 2.1,
  //    critério 1.4.11, contraste de elementos gráficos);
  //  - todos os tons da escala publicada do Untitled UI (derivada do
  //    Tailwind), nenhum inventado;
  //  - escolhidos por otimização para maximizar a menor diferença
  //    perceptível (CIEDE2000) entre duas faixas quaisquer: 14,2 com visão
  //    normal e 4,8 simulando deuteranopia (antes: 0, faixas 1 e 10 iguais);
  //    na régua v4 (mesmo dia) cada cor seguiu o NOME da faixa que mudou de
  //    posição -- nenhuma cor nova, então as medidas continuam valendo; o mesmo
  //    na v5 (29/09/2026);
  //  - uma família por significado: vermelho = último dia (1 e 12), roxo =
  //    Cluster Novo, ciano/verde-azulado = contato (3 e 4), verde = promessa
  //    no dia, rosa = promessa quebrada, índigo = janela SCPC (7, 8, 11),
  //    musgo = conta esquecida, laranja/âmbar/ocre = atraso e cartório
  //    (10, 13, 14), cinza = demais dias.
  // A cor nunca é o único sinal: a faixa sempre aparece com número e nome
  // (WCAG 1.4.1). tests/fila-prioridade.test.js confere contraste e que
  // nenhuma cor se repete.
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
      // Na pilha de avisos (Módulo 0, v1.38.0) -- antes nascia no mesmo
      // ponto dos avisos e ficava por cima/por baixo deles. "fixo": fica até
      // a classificação acabar, nunca sai pra dar lugar a um aviso novo.
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

  // PEDIDO DO USUÁRIO: aviso de troca de prioridade mais aparente, sem
  // destoar do resto do app -- mesma base visual do toast genérico (fundo
  // escuro, cantos arredondados, mesma fonte, mesma posição), só que com
  // borda de destaque colorida por prioridade (ver CORES_PRIORIDADE),
  // texto em duas linhas (rótulo pequeno + nome em negrito, maior que o
  // toast normal) e uma leve animação de entrada -- deixa mais chamativo
  // sem virar um elemento estranho ao resto da interface.
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
  // Reaproveita construirFilaAPartirDaPagina (já cuida de deduplicar
  // matriz/filial mantendo o mais atrasado, e de pular quem já foi
  // atendido hoje) e enriquece cada candidato com cluster + data da última
  // movimentação.
  //
  // CORRIGIDO (bug real, achado ao vivo): a primeira versão tentava adivinhar
  // esses dois campos lendo texto renderizado (span.pbi-meta pro cluster, a
  // "última data visível" na linha pra movimentação) -- as duas suposições
  // eram erradas. pbi-meta é na verdade situacaoCobrancaDescricao, e a
  // "última data" só coincidia por sorte com a real na maioria dos casos,
  // mas não dava pra confiar (67 de 133 clientes bateram "hoje", muitos
  // deles claramente por coincidência de posição, não pela data certa).
  //
  // A CORREÇÃO: window.CLIENTES é um array com os dados brutos do cliente
  // que a própria página já usa pra renderizar a tabela (confirmado via
  // HTML/JS real -- var CLIENTES = [...] dentro de um <script> da página).
  // Como o script roda com @grant none, temos acesso direto a esse array --
  // ler os campos ali (cluster, dataUltimaMovimentacao) é muito mais
  // confiável do que tentar re-derivar a mesma informação a partir do HTML
  // já renderizado.
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
        // Formato ISO ("2026-09-11T08:00:11.523327") -- comparamos só a
        // parte "AAAA-MM-DD" por string, mesmo padrão que o próprio script
        // da página usa (ver isBeforeOrToday/isBeforeToday no HTML real) --
        // evita qualquer pegadinha de fuso horário na conversão pra Date.
        movimentacaoDataIso: dadosCliente ? (dadosCliente.dataUltimaMovimentacao || null) : null,
        // BUG REAL (relatado pelo usuário, achado ao vivo): o diasAtraso que
        // vem de construirFilaAPartirDaPagina() é extraído por regex do
        // texto INTEIRO da linha (primeira ocorrência de "N dias") -- a
        // linha tem MAIS de um número seguido de "dias" (ex.: diasAtraso e
        // diasAtrasoMedio são campos separados em window.CLIENTES, e nada
        // garante que o regex pega o certo). Isso inflou a exclusão de
        // ">19 dias" bem além do real (62 de 65 candidatos, número que o
        // usuário confirmou não bater com a carteira de verdade).
        // window.CLIENTES[].diasAtraso é o valor estruturado e correto --
        // sobrescreve o valor extraído por regex sempre que disponível.
        diasAtraso:
          dadosCliente && typeof dadosCliente.diasAtraso === 'number' ? dadosCliente.diasAtraso : cliente.diasAtraso,
      });
    });

    // Se window.CLIENTES existe mas algum CNPJ específico não bate com
    // nada nele, esses candidatos caem de volta no valor extraído por
    // regex (mesmo bug antigo) sem avisar nada -- isso deixaria passar em
    // silêncio a mesma classe de problema que acabamos de corrigir.
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

  // Converte a parte "AAAA-MM-DD" de movimentacaoDataIso num Date normalizado
  // (meio-dia, mesma convenção de normalizarData do Módulo 0) -- construído
  // via new Date(ano, mes-1, dia) e NÃO via new Date("AAAA-MM-DD") de
  // propósito: essa segunda forma é interpretada como UTC meia-noite pelo
  // motor JS, podendo virar o dia errado dependendo do fuso do navegador
  // (mesma pegadinha já evitada em converterDataBr no Módulo 6).
  function dataDaMovimentacao(movimentacaoDataIso) {
    if (!movimentacaoDataIso) return null;
    const dataStr = String(movimentacaoDataIso).split('T')[0];
    const m = dataStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return normalizarData(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  // Prioridade 9 (pedido do usuário): data (movimentação ou contato) que já
  // tem CONFIG.DIAS_MOVIMENTACAO_ANTIGA dias corridos OU MAIS (>=, v5) --
  // conta "esquecida", sem nenhum toque recente. hoje já vem normalizado
  // (normalizarData) de quem chama, pra bater com a mesma meia-noite/
  // meio-dia usados no resto do sistema.
  function semMovimentoHaDuasSemanas(movimentacaoDataIso, hoje) {
    const data = dataDaMovimentacao(movimentacaoDataIso);
    if (!data || !hoje) return false;
    const diasCorridos = (hoje.getTime() - data.getTime()) / (24 * 60 * 60 * 1000);
    return diasCorridos >= CONFIG.DIAS_MOVIMENTACAO_ANTIGA;
  }

  // Extraído pra não duplicar a mesma normalização (trim + minúsculas) que
  // determinarPrioridade já fazia inline -- é exatamente o tipo de regra
  // copiada em dois lugares que este projeto paga caro quando um dos dois
  // fica pra trás (ver Módulo 2/Módulo 4, título representativo).
  function ehClusterNovo(cluster) {
    return (cluster || '').trim().toLowerCase() === CONFIG.VALOR_CLUSTER_NOVO;
  }

  // Exclusões que já dá pra decidir só com o que a lista mostra -- não
  // precisa visitar ninguém pra isso.
  //
  // EXCEÇÃO PEDIDA PELO USUÁRIO (Cluster Novo não é cortado pelo teto de
  // dias): um cliente Cluster Novo com título já em cartório passa dos 19
  // dias de sobra e seria excluído aqui -- mas ele PRECISA aparecer na fila,
  // porque a cobrança é quem bloqueia o faturamento pra esse cliente. Cluster
  // Novo já vira prioridade 2 em QUALQUER situação de título
  // (determinarPrioridade não olha o código da situação pra essa faixa), e
  // como este filtro roda ANTES de visitar o cliente e descobrir se o título
  // está mesmo em cartório, a exceção precisa valer pro cluster inteiro --
  // não dá pra saber "é cartório?" sem visitar, e visitar é exatamente o que
  // este filtro existe pra evitar fazer em quem não vai entrar na fila mesmo.
  function filtrarPorRegrasDaLista(candidatos) {
    const sobreviventes = [];
    const excluidos = { dias: 0, diaUm: 0, movimentacaoHoje: 0, semDias: 0, naoCobrarTemporario: 0 };

    candidatos.forEach((c) => {
      // PEDIDO DO USUÁRIO (Módulo 12, botão "Alerta" na página do cliente):
      // "não cobrar" marcado ali é uma decisão HUMANA explícita, e vence
      // qualquer regra automática desta fila -- inclusive a isenção do
      // Cluster Novo logo abaixo. Optional chaining: sem o Módulo 12
      // carregado, ninguém é suprimido por isso (degrada, não quebra).
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
  // Mesma regra do Módulo 4 -- agora centralizada no Módulo 0
  // (window.__smartTableUtil.escolherTituloRepresentativo). ULTIMO_DIA
  // sempre vence, senão a janela de aviso de suspensão SCPC (16-19 dias),
  // senão o título de maior atraso real. Ver histórico completo do bug de
  // priorização no Módulo 0.

  // Espera a aba de fundo carregar os módulos necessários pra classificar
  // (Módulo 1 pronto pra simular() + Módulo 6 já com __contextoAdicional
  // calculado, mesmo que tenha caído no fallback de erro -- o que importa
  // é não ler pela metade).
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
            // Acordos (Módulo 16, v1.41.0): o simular() só separa os títulos
            // em acordo depois que a leitura dos acordos terminou. Sem o
            // módulo na aba (cache antigo), não espera nada.
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

  // Primeira faixa que se aplicar vence -- por isso a ordem de checagem
  // aqui segue exatamente a numeração das prioridades (1 a 15, régua v3).
  //
  // contextoPromessa é o window.__contextoAdicional.promessa da aba de
  // fundo (Módulo 6): { tipo: 'DIA_DA_PROMESSA' | 'QUEBRADA' | 'PARCIAL',
  // promessa } ou null. Vem null quando não há promessa ativa -- inclusive
  // quando o Módulo 6 já considerou a promessa resolvida (título pago) ou
  // quando já houve contato depois do vencimento, que é exatamente quando
  // ela deixa de ser o assunto mais urgente do cliente.
  //
  // movimentacaoDataIso e hoje são opcionais (testes antigos chamam esta
  // função sem eles) -- sem os dois, a faixa 9 simplesmente nunca casa,
  // caindo nas faixas seguintes normalmente (semMovimentoHaDuasSemanas já
  // trata ausência de qualquer um dos dois como "não aplica").
  //
  // extras (régua v2, também opcional):
  //   - semContato: a aba Contatos está vazia (faixa 4). Ausente = false.
  //   - maiorAtrasoDoCliente: maior diasAtrasoReal entre TODOS os títulos
  //     do cliente, cartório incluído (faixas 3 e 10). Ausente = o do próprio
  //     título escolhido, ou seja, não bloqueia a faixa.
  //   - ultimoContatoIso: data (AAAA-MM-DD) do contato mais recente, de
  //     qualquer pessoa (faixa 9). Ausente = só a movimentação decide.
  //   - temTituloEmCartorio: o cliente tem título EM_CARTORIO entre os em
  //     cobrança (faixa 13, régua v3/v4). Ausente = false.
  //   - temNegativadoNoDiaDaSuspensao: o cliente tem título NEGATIVADO_SCPC
  //     exatamente no 19º dia (faixa 7, régua v6). Ausente = false.
  function determinarPrioridade(escolhido, fluxo, cluster, contextoPromessa, movimentacaoDataIso, hoje, extras = {}) {
    const tipoPromessa = contextoPromessa ? contextoPromessa.tipo : null;
    const { situacaoKey, diasAtrasoReal } = escolhido;
    const maiorAtrasoDoCliente = extras.maiorAtrasoDoCliente ?? diasAtrasoReal;

    if (situacaoKey === 'ULTIMO_DIA' && fluxo === 'CARTORIO') return 1;
    if (ehClusterNovo(cluster)) return 2;
    // CORRIGIDO (v1.47.1, relatado pelo usuário: "nesta prioridade é apenas
    // títulos em segundo dia de atraso"): o título escolhido deixa o cartório
    // de fora (regra da mensagem), então um cliente com título de 2 dias +
    // outro em cartório há semanas entrava aqui. Agora exige, como a faixa
    // 10, que NENHUM título do cliente tenha mais dias (cartório conta).
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
    // Régua v6 (29/09/2026, decisão do usuário): último dia + outro título
    // negativado no 19º dia. O título escolhido é o de último dia (Módulo 0),
    // mas a mensagem do Alt+A já fala da suspensão de hoje (Módulo 4,
    // tituloNegativadoQueManda); a fila passa a tratar como o dia 19 (faixa 7)
    // em vez da 12. Os negativados de 16 a 18 e de 1 a 15 ficaram de fora
    // (não decididos pelo usuário).
    if (situacaoKey === 'ULTIMO_DIA' && extras.temNegativadoNoDiaDaSuspensao === true) return 7;
    if (
      situacaoKey === 'NEGATIVADO_SCPC' &&
      diasAtrasoReal >= CONFIG.DIA_INICIO_AVISO_SUSPENSAO_SCPC &&
      diasAtrasoReal < CONFIG.DIA_ULTIMO_DIA_SUSPENSAO_SCPC
    ) {
      return 8;
    }
    // Mesma régua de 14 dias corridos (ou mais) pras duas datas (as duas chegam como
    // AAAA-MM-DD). Contato ausente (null) nunca casa sozinho: quem nunca
    // teve contato já ficou na faixa 4.
    if (semMovimentoHaDuasSemanas(movimentacaoDataIso, hoje) || semMovimentoHaDuasSemanas(extras.ultimoContatoIso, hoje)) return 9;
    // Régua v5 (29/09/2026, pedido do usuário): o atraso inicial vem ANTES
    // dos dois SCPC. As três situações são exclusivas entre si (cada uma é a
    // situação do MESMO título escolhido), então a ordem destas checagens não
    // muda quem cai onde; o que ordena é o número devolvido.
    if (
      situacaoKey === 'EM_ATRASO' &&
      CONFIG.DIAS_PRIORIDADE_ATRASO_INICIAL.includes(diasAtrasoReal) &&
      maiorAtrasoDoCliente <= diasAtrasoReal
    ) {
      return 10;
    }
    // Régua v4 (28/09/2026): o SCPC antes do aviso de suspensão vem ANTES do
    // SCPC último dia -- e, como a checagem é feita aqui, também antes de
    // "cartório e outro vencido" (faixa 13), que na v3 ficava na frente dele.
    if (situacaoKey === 'NEGATIVADO_SCPC' && diasAtrasoReal < CONFIG.DIA_INICIO_AVISO_SUSPENSAO_SCPC) return FAIXA_SCPC_ANTES_DO_AVISO;
    if (situacaoKey === 'ULTIMO_DIA' && fluxo === 'SCPC') return 12;
    // Régua v3 (28/09/2026): o que era "Demais dias", separado pela fila real.
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
   * A classificação em si, a partir de uma aba PRONTA -- a de verdade
   * (classificarCliente) ou a "aba virtual" montada da página baixada
   * (v1.45.0, modo sombra: montarAbaVirtual). Uma função só pros dois
   * caminhos: a única diferença possível entre eles fica nos DADOS, que é
   * exatamente o que o modo sombra mede.
   */
  function classificarAPartirDaAba(cliente, aba) {
    let dadosTitulos;
    try {
      dadosTitulos = aba.__avisoCobranca.simular();
    } catch (erro) {
      console.warn(`[Fila Prioridade] Falha ao ler títulos de ${window.__smartTableUtil.apelidoParaLog(cliente.cnpj)}:`, erro.message);
      return { cliente, erro: 'falha-titulos' };
    }

    // CONFIRMADO com o usuário: cliente com QUALQUER título em "não
    // cobrar" (NAO COBRAR/CARTEIRA no CRM, ou todos os títulos já em
    // cartório -- ver POSICOES_EXCLUIDAS_DE_COBRANCA e o banner
    // avisarSeNaoCobrar no Módulo 1) fica de fora da fila inteira, não só
    // o título específico -- precisa de atenção manual, não de uma
    // automação de urgência. dadosTitulos.naoCobrar já vem pronto do
    // Módulo 1 na mesma simulação, sem custo extra de visita.
    if (dadosTitulos.naoCobrar && dadosTitulos.naoCobrar.length > 0) {
      return { cliente, excluidoPorNaoCobrar: true };
    }

    // ACORDOS (v1.41.0, decisão do usuário): todos os títulos vencidos em
    // acordo ATIVA/CONCLUIDA -> fora da fila se as parcelas estão em dia
    // (não há o que cobrar); parcela atrasada -> faixa 6, a mesma de
    // "promessa não cumprida". Caso misto: régua normal pelos demais.
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

    // Promessa ATIVA calculada pelo Módulo 6 nesta mesma aba de fundo
    // (já esperada por esperarAbaPronta) -- é o que decide as faixas 4 e
    // 5 da régua. Diferente de `promessas` acima (leitura crua, usada só
    // pra excluir quem tem promessa com data futura), aqui já vem a
    // decisão pronta e cruzada com os títulos ainda em aberto.
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

    // CONFIRMADO com o usuário: se outra empresa do mesmo grupo econômico
    // também tem título vencido, só UMA representante do grupo deve
    // entrar na fila (a mais urgente) -- as outras já serão cobradas por
    // tabela via essa mesma visita (ver Alt+A/Alt+G, Módulo 4/5). O
    // Módulo 5 já lê a aba "Grupo" de verdade em toda visita à página do
    // cliente (não é o grupoId da lista, que é outro campo, confirmado
    // via diagnóstico ao vivo) -- window.__alertaGrupo já está disponível
    // de graça nesta mesma aba de fundo, sem custo extra de visita.
    const empresasComVencido = (aba.__alertaGrupo && aba.__alertaGrupo.empresasComVencido) || [];

    const valorVencido = valorVencidoEntre(dadosTitulos.registros);
    return { cliente, escolhido, fluxo: dadosTitulos.fluxo, prioridade, empresasComVencido, ultimoContatoIso, valorVencido };
  }

  // Só os dígitos -- mesmo padrão usado em outros pontos do sistema pra
  // comparar CNPJ entre fontes com formatação diferente (o da URL do
  // candidato vem com barra/traço, o lido da tabela "Clientes do grupo"
  // pode vir só com pontuação, etc.).
  function normalizarCnpj(cnpj) {
    return (cnpj || '').replace(/\D/g, '');
  }

  // Mais urgente = quem vem primeiro na régua (compararPelaRegua) -- o
  // MESMO critério da ordenação final da fila, pra "representante do grupo"
  // e "posição na fila" nunca discordarem. Empate total: fica o primeiro.
  function maisUrgente(a, b) {
    return compararPelaRegua(a, b) <= 0 ? a : b;
  }

  // CONFIRMADO com o usuário: quando 2+ clientes do MESMO grupo econômico
  // têm título em aberto, só a representante mais urgente do grupo entra
  // na fila -- as demais já serão cobradas por tabela ao atender essa
  // primeira (Alt+G/Alt+A já cobrem "outras razões do grupo" a partir dela).
  // Só dá pra saber quem é do mesmo grupo DEPOIS de classificar cada um
  // (ver empresasComVencido em classificarCliente), por isso roda aqui,
  // depois do laço de classificação, nunca antes.
  //
  // Agrupamento via união por CNPJ cruzado: dois resultados entram no mesmo
  // cluster se o CNPJ de QUALQUER um aparece na lista empresasComVencido do
  // outro (união também nas duas mãos, pra tolerar o caso da tabela do
  // grupo não listar os dois lados de forma simétrica).
  function filtrarPorGrupoEconomico(resultados) {
    const indicePorCnpj = new Map();
    resultados.forEach((r, i) => {
      const cnpj = normalizarCnpj(r.cliente.cnpj);
      if (cnpj) indicePorCnpj.set(cnpj, i);
    });

    // Union-Find simples (path compression) -- número de candidatos por
    // rodada é pequeno (dezenas), não precisa de nada mais sofisticado.
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
   * Ordena pela régua: faixa 1 primeiro; dentro da faixa, do contato mais
   * ANTIGO pro mais recente (CONFIRMADO com o usuário, régua v2), com quem
   * nunca teve contato na frente de todos; empate, MAIOR VALOR VENCIDO
   * primeiro (régua v3), depois mais dias de atraso. Na faixa 11 (SCPC antes
   * do aviso), mais dias vem ANTES de tudo -- mais perto do 16º dia.
   *
   * ultimoContatoIso é AAAA-MM-DD, então comparar como texto já é comparar
   * como data.
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
   * Módulo 3 (Alt+I) e Módulo 7 (Alt+U) gravam na MESMA chave do
   * localStorage -- uma sobrescreve a outra. O que distingue é o
   * prioridadeTier, que só a fila por prioridade carrega (mesmo critério já
   * usado em avisarSeTrocouDePrioridade).
   *
   * Sem esta checagem, o Alt+U "retomaria" uma fila do Alt+I e chamaria de
   * fila por prioridade -- os clientes até existiriam, mas a ordem não seria
   * a da régua, e nada na tela diria isso.
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
   * Uma fila da régua anterior (montada antes da atualização chegar, no
   * mesmo dia) tem os números de faixa da numeração velha -- retomá-la
   * mostraria "faixa 5" com o nome da faixa 5 nova. Não serve pra retomar:
   * o Alt+U monta uma nova.
   *
   * @param {object|null} fila
   * @returns {boolean}
   */
  function ehDaReguaAtual(fila) {
    return ehFilaDePrioridade(fila) &&
      fila.clientes.some((c) => c && c.versaoRegua === CONFIG.VERSAO_REGUA);
  }

  /**
   * Tenta continuar a fila por prioridade de HOJE em vez de refazer tudo.
   *
   * POR QUE EXISTE (pedido do usuário): iniciar() sempre reconstruía, e
   * reconstruir custa abrir ~140 abas de fundo, com até 8s de espera cada.
   * Apertar Alt+U às 14h só pra voltar pra fila refazia a varredura inteira
   * E sobrescrevia a fila da manhã, perdendo a posição onde você estava.
   *
   * A fila JÁ ficava salva o dia todo (Módulo 3 só descarta no dia
   * seguinte). Nunca houve decisão de "sempre reconstruir" -- o caminho de
   * continuar simplesmente não existia.
   *
   * NÃO usa o botão "Continuar fila anterior" do Módulo 3: CONFIRMADO com o
   * usuário que aquele botão é do Alt+I e continua sendo só dele.
   *
   * @returns {boolean} true se retomou (e quem chamou não deve reconstruir).
   */
  /**
   * A DECISÃO de retomar, sem efeito colateral nenhum.
   *
   * Separada de retomarFilaDeHoje() porque navegar não é testável fora do
   * navegador (o jsdom não implementa navegação), e sem essa separação a
   * regra -- que fila serve, onde continuar, quantos faltam -- ficaria sem
   * cobertura. Mesmo padrão já usado em construirUrlProtocoloWhatsApp
   * (Módulo 2) e montarExportacao (Módulo 8).
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

    // Se você JÁ está no cliente onde parou, navegar seria só um reload que
    // apaga o que estiver na tela -- inclusive uma observação digitada pela
    // metade.
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
   * PEDIDO DO USUÁRIO: poder "atualizar" a fila retomada a qualquer momento
   * (sem precisar de um Shift+Alt+U completo, que reabre ~140 abas) -- tira
   * da fila, a partir da posição atual, quem já teve movimentação HOJE
   * segundo window.CLIENTES (ex.: foi contatado por fora do SmartTable,
   * direto no CRM, ou por outro negociador). Só mexe no que ainda falta; o
   * histórico (clientes[0..indiceAtual-1], já contado em totalAtendidos/
   * totalPulados) fica intacto.
   *
   * Puro (não grava em localStorage) de propósito -- mesmo padrão de
   * alvoDeRetomada(), pra dar pra testar sem depender de navegação. Quem
   * chama decide se salva.
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

  function retomarFilaDeHoje() {
    if (window.filaDebug && typeof window.filaDebug.obterFila === 'function') {
      const filaAtual = window.filaDebug.obterFila();
      if (filaAtual && ehDaReguaAtual(filaAtual)) {
        // BUG REAL (relatado pelo usuário: "o progresso da barra não está
        // contando"): gravarSnapshotProgressoSeForOPrimeiroDoDia() só era
        // chamada dentro de finalizarFila() -- mas RETOMAR uma fila já em
        // andamento nunca passa por ali. Qualquer fila por prioridade que
        // exista hoje sem ter passado por finalizarFila NESTA sessão (ex.:
        // foi montada antes desta versão do script chegar, ou qualquer
        // outro caminho que a gente não previu) deixava o painel de
        // progresso preso em "indisponível" o dia inteiro, porque nenhum
        // snapshot nunca era criado. Reforça aqui também: se ainda não
        // existe snapshot de hoje, usa a própria fila retomada como base --
        // é a melhor aproximação disponível de "a primeira fila do dia".
        // EXCETO fila de lista filtrada (revisão geral, 29/09/2026): o caminho
        // filtrado não grava a referência de propósito, e esta retomada a
        // gravava mesmo assim -- o progresso do dia passava a medir só os
        // clientes do filtro até a meia-noite.
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
   * A ordem do RESULTADO acompanha a ordem da ENTRADA, não a de chegada --
   * `resultados[i]` corresponde a `clientes[i]`. Isso não é detalhe: a fila
   * final é ordenada pela régua logo depois, e uma ordem de entrada instável
   * faria duas execuções do mesmo dia produzirem filas diferentes entre
   * empates, contaminando o diário.
   *
   * @param {object[]} clientes
   * @param {(feitos: number, total: number) => void} aoProgredir
   * @param {(cliente: object) => Promise<object>} [classificar] Costura de
   *   teste: a concorrência e o disjuntor são o ponto desta função, e sem
   *   poder substituir o classificador eles ficariam sem cobertura -- abrir
   *   aba de verdade não acontece no jsdom. Em produção nunca é passado.
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

    // DISJUNTOR DE POP-UP, adaptado do laço sequencial. Lá a regra era "3
    // bloqueios SEGUIDOS"; em paralelo "seguidos" perde o sentido, porque a
    // ordem de chegada é indeterminada. A regra equivalente e sem ambiguidade
    // é: 3 bloqueios e NENHUM sucesso -- o que caracteriza bloqueio
    // sistemático, que é o que o disjuntor existe pra detectar cedo.
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

    // AQUECIMENTO SEQUENCIAL, até o primeiro sucesso.
    //
    // Sem isto, o disjuntor afrouxa: com 4 trabalhadores, quando o 3º bloqueio
    // é contabilizado já há outras abas em voo, e o laço tenta ~6 antes de
    // desistir -- foi exatamente o que o teste do disjuntor pegou.
    //
    // Abrir UMA aba primeiro também é mais educado com o servidor e mais
    // honesto com o navegador: prova que pop-up está liberado antes de pedir
    // quatro de uma vez. Custa uma carga de página no caminho feliz.
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
   * consome. Guardar o resultado inteiro seria mais fácil e pior: ele tem
   * Date, que não sobrevive ao JSON, e campos que ninguém lê -- convidando
   * o caminho do cache a divergir do caminho fresco sem ninguém perceber.
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
        // As faixas do cache só valem na régua em que foram calculadas: com a
        // numeração nova, reclassifica (senão "12" antiga e "12" nova se
        // misturariam na mesma fila).
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
   * Lê o snapshot de progresso do dia (ver CHAVE_SNAPSHOT_PROGRESSO) --
   * devolve null se não existir, for de outro dia, ou estiver corrompido.
   * Mesmo padrão de dia (dataIso) do cache de classificação acima, de
   * propósito -- um único jeito de "o que é hoje" no módulo inteiro.
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
   * Grava o snapshot de progresso SÓ SE ainda não existir um de hoje --
   * PEDIDO DO USUÁRIO: o painel de progresso (Módulo 11) tem que mostrar
   * sempre o resultado da PRIMEIRA fila por prioridade do dia, e continuar
   * assim até a primeira fila do dia SEGUINTE, sem mudar no meio do
   * caminho. Por isso nunca sobrescreve um snapshot já existente de hoje --
   * nem o Shift+Alt+U, que reclassifica tudo, mexe nele. Só quando o dia
   * vira (lerSnapshotProgresso passa a devolver null pra um snapshot de
   * ontem) é que a próxima fila gerada grava um novo, naturalmente.
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
        // Com a versão da régua, o painel (Módulo 11) sabe se os números das
        // faixas deste snapshot ainda querem dizer o mesmo (régua v3, 28/09).
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
   * MODO SOMBRA -- Alt+U SEM ABRIR ABA (v1.45.0)
   * -----------------------------------------------------------------
   * DIAGNÓSTICO (25/09/2026, confirmado ao vivo): a página do cliente
   * baixada por fetch (~0,13 s, sem aba, sem pop-up) traz os títulos em
   * __TITULOS_ABERTOS__, o parágrafo "SCPC:", Promessas/Contatos e a aba
   * Negociações; o grupo econômico vem de GET /api/crm/negociacoes/
   * grupo-outros-com-divida?cliente=<CNPJ>. A "aba virtual" junta isso com a
   * MESMA interface de uma aba de verdade, e classificarAPartirDaAba() -- a
   * mesma função da aba -- classifica. Cada fonte tem teste de equivalência
   * contra a leitura da tela (titulos-da-pagina, pagina-baixada-contexto,
   * negociacoes, grupo-api); o que sobra de risco é dado real diferente, e
   * é isso que a comparação daqui mede, cliente a cliente.
   * --------------------------------------------------------------------- */

  // Leitor de variável de script: mora no Módulo 0 (v1.47.0) -- o Módulo 12
  // também lê __TITULOS_PAGOS__ com ele.
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
    // Títulos em cartório marcados "fora do relatório" (Módulo 12, v1.47.0):
    // a mesma marcação que a aba de verdade usa, pelo CNPJ deste cliente.
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
      // UMA entrada por dia (v1.46.0): a mesma data substitui a anterior, e
      // o limite de SOMBRA_DIAS_HISTORICO passa a ser de DIAS, não de rodadas.
      historico = historico.filter((h) => h?.dia !== dia);
      historico.push({ dia, comparados: relatorio.comparados, diferencas: relatorio.diferencas.length, errosDaPagina: relatorio.errosDaPagina });
      localStorage.setItem(CONFIG.CHAVE_SOMBRA_HISTORICO, JSON.stringify(historico.slice(-CONFIG.SOMBRA_DIAS_HISTORICO)));
    } catch (erro) {
      console.warn('[Fila Prioridade] Modo sombra: não consegui gravar o relatório.', erro);
    }
  }

  /**
   * O modo sombra roda UMA vez por dia (v1.46.0, revisão de código): cada
   * rodada baixa a página de todos os clientes elegíveis, e uma comparação
   * por dia basta pra medir. Só conta rodada que gravou relatório -- a que
   * não terminou a tempo não impede a próxima.
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
   * "USAR A FILA ATUAL" (pedido do usuário, v1.43.0 -- botão no painel de
   * progresso): quando a PRIMEIRA fila do dia saiu errada (lista filtrada,
   * por exemplo), o progresso ficaria errado o dia todo, porque a
   * referência nunca muda sozinha. Isto troca a referência pela fila por
   * prioridade que está valendo agora.
   *
   * Quem já foi cobrado hoje CONTINUA contando, na faixa que tinha: um
   * Shift+Alt+U tira os já atendidos da fila nova, e copiar só ela faria os
   * cobrados sumirem da conta.
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
    // Referência antiga de OUTRA régua (revisão geral, 29/09/2026): o número
    // da faixa dela quer dizer outra coisa. O cobrado mantido vai para a faixa
    // atual de MESMO NOME; sem faixa com esse nome, sai da conta (misturar
    // números de duas réguas punha o cliente na faixa errada, sem aviso).
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

    // Continuar é o caso comum; refazer é o raro. Quem refaz pede
    // explicitamente.
    //
    // Reconstruir também é o que APLICA de novo o filtro de "já contatado
    // hoje": ele vem de graça do construirFilaAPartirDaPagina() do Módulo 3,
    // que pula quem está em atendidosHoje. Não existe filtro duplicado aqui.
    if (!opcoes?.reconstruir && retomarFilaDeHoje()) return;

    // SEGUNDO atalho, antes de gastar as ~92 visitas: a classificação de hoje
    // já pode estar pronta. Monta a fila do cache e pronto -- instantâneo.
    //
    // A ordem importa: fila em andamento > cache do dia > classificar agora.
    // Pular direto pro cache descartaria a posição em que você parou.
    if (!opcoes?.reconstruir) {
      const cache = lerCacheClassificacao();
      if (cache) {
        // DEFEITO REAL, achado em revisão antes de chegar no seu dia: o
        // caminho do cache montava a fila com os resultados COMO ESTAVAM na
        // classificação da manhã. Como a fila se apaga sozinha ao terminar
        // (limparFila no Módulo 3), a sequência normal do dia era: classifica
        // 92, atende os 92, a fila some, você aperta Alt+U -- e o cache
        // reentregava os MESMOS 92, incluindo todo mundo que você acabou de
        // cobrar.
        //
        // O caminho fresco nunca teve esse problema porque
        // construirFilaAPartirDaPagina (Módulo 3) já exclui atendidosHoje. O
        // do cache precisa reaplicar, porque o cache é um retrato de um
        // momento em que quase ninguém tinha sido atendido ainda.
        // Pelo mesmo motivo, reaplica as duas exclusões da lista que mudam
        // durante o dia: "não cobrar" marcado no botão Alerta (Módulo 12)
        // depois da classificação -- decisão humana que vence qualquer regra
        // da fila -- e movimentação de hoje por fora do SmartTable.
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

        // Um toast só: o resumo do finalizarFila vem logo atrás e cobria este
        // antes de dar tempo de ler. O que interessa (de quando é a
        // classificação) entra no console, que é onde se investiga.
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
    // Log detalhado (achado real: sem isso, um resultado final baixo não
    // dá pra saber SE é esperado -- ex.: maioria já mexida hoje de verdade
    // -- ou SE é algum filtro errado excluindo demais, sem precisar pedir
    // mais um diagnóstico manual toda vez).
    // JSON.stringify de propósito, não o objeto cru -- achado real: o
    // Chrome mostra objeto cru como só "Object" quando o console é copiado
    // como texto (precisa expandir clicando ali mesmo, o que não sobrevive
    // a um copiar/colar). Como string, o conteúdo aparece direto.
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
    // A trava vale até o FIM (revisão geral, 29/09/2026): antes ela era solta
    // logo depois das abas, e durante a espera da sombra (até 20 s) não havia
    // fila nem cache gravados -- um segundo Alt+U começava outra
    // classificação inteira, com o dobro de abas contra o CRM.
    try {
      atualizarIndicadorProgresso(`Classificando 0/${sobreviventes.length}...`);

      // MODO SOMBRA (v1.45.0): a classificação pela página baixada corre JUNTO
      // com as abas e é comparada no fim. Não entra na fila.
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
        // Sem isto, uma exceção inesperada deixava a trava ligada e o
        // indicador na tela até recarregar: todo Alt+U seguinte respondia
        // "já tem uma classificação em andamento".
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

      // LISTA FILTRADA (v1.43.0, decisão do usuário): com um filtro do CRM
      // ligado, os candidatos são só os do filtro. A fila vale pra agora, mas
      // NÃO vira a classificação do dia (o cache seria reaproveitado pelos
      // próximos Alt+U, já sem filtro, entregando só parte da carteira), nem a
      // referência do progresso (Módulo 11), nem a atribuição do diário.
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
   * null. FALHA FECHADA (v1.46.0): sem o detector, trata como filtrada -- a
   * fila sai igual, só não grava o cache do dia, o progresso nem o diário
   * (gravar uma lista parcial como "o dia" é o erro caro).
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
   * Extraída de iniciar() porque agora tem DOIS caminhos de entrada -- o
   * fresco (abas de fundo) e o do cache do dia. Se cada um montasse a fila
   * do seu jeito, eles divergiriam em silêncio, e "a fila do cache" deixaria
   * de ser a mesma fila. Há teste travando que os dois produzem saída
   * idêntica.
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

    // Ordena por prioridade (1 primeiro) e, dentro da mesma prioridade, pelo
    // desempate da régua v3/v4 (faixa 11: mais dias; demais: contato mais
    // antigo, maior valor vencido, mais dias) -- ver compararPelaRegua.
    //
    // A fila sai 100% na ordem da régua. O grupo de controle (1 em cada 5
    // com posição sorteada, para o Diário medir o efeito da ordem) foi
    // REMOVIDO a pedido do usuário em 28/09/2026 -- estava desligado desde a
    // decisão anterior e ele não quer o mecanismo no código.
    resultadosSemDuplicataDeGrupo = resultadosSemDuplicataDeGrupo.slice().sort(compararPelaRegua);
    const diario = window.__diario;

    const clientesDaFila = resultadosSemDuplicataDeGrupo.map((r) => Object.assign({}, r.cliente, {
      diasAtraso: r.escolhido.diasAtrasoReal,
      prioridadeTier: r.prioridade,
      prioridadeNome: NOMES_PRIORIDADE[r.prioridade],
      versaoRegua: CONFIG.VERSAO_REGUA,
      ultimoContatoIso: r.ultimoContatoIso ?? null,
      // v1.49.2: gravado pra autoconferência do Diário (Módulo 8) conseguir
      // conferir o desempate por valor da régua v3. Fica só no localStorage.
      valorVencido: r.valorVencido ?? 0,
    }));

    // Registra a ATRIBUIÇÃO do dia: faixa, posição final e grupo. Um lote só,
    // um acesso ao localStorage -- gravar 150 vezes seguidas durante o Alt+U
    // seria desperdício. Se o diário não estiver carregado, segue sem ele.
    //
    // SÓ NA PRIMEIRA VEZ DO DIA. finalizarFila passou a ter DOIS chamadores
    // (a classificação fresca e a remontagem a partir do cache), e sem esta
    // guarda a remontagem gravava uma segunda atribuição do mesmo dia para os
    // mesmos clientes -- o mesmo defeito corrigido na v1.9.2, por um caminho
    // novo. A análise sobreviveria (analisar() deduplica por (cnpj, dia) e
    // mantém a primeira), mas o contador atribuicoesRepetidas existe
    // justamente pra denunciar isso: fazê-lo disparar todo dia é aposentar o
    // alarme.
    //
    // O padrão é NÃO registrar: chamador novo que precise registrar tem que
    // pedir. Dado faltando é recuperável; dado duplicado contamina em
    // silêncio.
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

    // PEDIDO DO USUÁRIO: o painel de progresso (Módulo 11) fica preso ao
    // resultado desta fila SE for a primeira do dia -- não sobrescreve se
    // já existir uma (ver gravarSnapshotProgressoSeForOPrimeiroDoDia). Fila
    // de lista filtrada nunca vira referência (v1.43.0).
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

    // CORRIGIDO (bug real: o resumo acima mal dava tempo de aparecer antes
    // da navegação apagar a página) -- espera o toast terminar de verdade
    // antes de navegar, em vez dos 400ms que bastavam só pro "fila
    // iniciada" simples do Alt+I (sem nada crítico pra ler ali).
    setTimeout(() => {
      window.location.href = clientesDaFila[0].url;
    }, duracaoResumoMs);
  }

  /* ---------------------------------------------------------------------
   * 7. AVISO DE TROCA DE PRIORIDADE (roda em toda página, como o Módulo 3)
   * --------------------------------------------------------------------- */
  // Só reage a filas montadas por ESTE módulo (clientes com prioridadeTier
  // definido) -- uma fila comum do Alt+I nunca tem esse campo, então isso
  // nunca dispara pra ela. Compara o cliente atual com o anterior na fila;
  // se a prioridade mudou (pra qualquer direção -- avançando ou voltando),
  // avisa. Depende do Módulo 3 já ter rodado sincronizarPosicao() nesta
  // mesma carga de página (é o que atualiza fila.indiceAtual pra bater com
  // a URL atual) -- por isso este módulo precisa vir DEPOIS do Módulo 3 no
  // @require.
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
    // Dá tempo do Módulo 3 rodar sincronizarPosicao() primeiro (mesmo
    // documento, ordem de @require já garante isso na prática, mas o
    // setTimeout(0) é uma rede de segurança barata contra reordenação
    // futura por engano).
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
