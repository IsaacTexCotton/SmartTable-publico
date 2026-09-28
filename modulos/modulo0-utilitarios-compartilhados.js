/* =========================================================================
 * MÓDULO 0: UTILITÁRIOS COMPARTILHADOS — CRM TexCotton
 * -------------------------------------------------------------------------
 * Funções e constantes usadas por 2+ módulos, extraídas pra um único lugar
 * depois de uma auditoria (/code-reviewer) apontar duplicação real:
 *   - normalizarData: existia em 3 cópias (Módulo 1, Módulo 6, Módulo 7) --
 *     a do Módulo 7 usava meia-noite (setHours(0,0,0,0)) em vez de meio-dia
 *     como as outras duas, causando um BUG REAL: uma promessa datada pra
 *     HOJE podia ser tratada como "futura" só pelo Módulo 7, excluindo o
 *     cliente da Fila por Prioridade por engano.
 *   - toast: existia em 3 cópias (Módulo 2, Módulo 3, Módulo 7), pixel a
 *     pixel idênticas.
 *   - esperar: existia em 2 cópias (Módulo 4, Módulo 7).
 *   - montarUrlCliente: existia em 2 cópias (Módulo 3, Módulo 5).
 *   - escolherTituloRepresentativo/maiorAtraso: a mesma regra de negócio
 *     (qual título "representa" o cliente pra nota do CRM e pra mensagem)
 *     existia em 3 cópias (Módulo 2, Módulo 4, Módulo 7), incluindo os
 *     limiares de dias do aviso de suspensão SCPC.
 *
 * Onde colar: PRIMEIRO módulo no @require do wrapper -- todos os outros
 * dependem de window.__smartTableUtil já existir quando executam.
 *
 * Módulo 1 e Módulo 2 são protegidos (exigem confirmação explícita do
 * usuário pra qualquer edição) e continuam com suas próprias cópias
 * locais de normalizarData / maiorAtraso -- de propósito, não migradas
 * aqui nesta rodada.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__utilitariosCompartilhadosCarregados) return;
  window.__utilitariosCompartilhadosCarregados = true;

  // ============================================================
  // CALENDÁRIO / DATAS
  // ============================================================

  // Meio-dia evita que horário de verão empurre a data para o dia anterior
  // (mesmo motivo do Módulo 1, que introduziu esse padrão primeiro). É a
  // convenção que TODOS os módulos que comparam datas devem seguir -- nunca
  // meia-noite, sob risco de comparações inconsistentes entre módulos (ver
  // histórico do bug corrigido acima).
  function normalizarData(data) {
    const d = new Date(data);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // ============================================================
  // UI: TOAST (não bloqueante, some sozinho)
  // ============================================================
  function toast(mensagem, duracaoMs) {
    duracaoMs = duracaoMs || 3200;
    const el = document.createElement('div');
    el.textContent = mensagem;
    // Leitor de tela anuncia o aviso sem roubar o foco.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    Object.assign(el.style, {
      background: '#16232F',
      color: '#fff',
      padding: '12px 18px',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '360px',
      opacity: '0',
      transition: 'opacity .25s ease',
      pointerEvents: 'none',
    });
    colocarNaPilha(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duracaoMs);
  }

  // ============================================================
  // UI: PILHA DE AVISOS (v1.38.0)
  // ============================================================
  // PEDIDO DO USUÁRIO ("alguns pop-ups ficam um em cima do outro", com
  // print): todo aviso nascia no MESMO ponto do canto inferior direito, e
  // dois seguidos se cobriam -- inclusive o do Alt+A por cima do aviso
  // verde do relatório (Módulo 1). Agora todos entram numa coluna: o mais
  // novo embaixo, os outros sobem, no máximo MAX_AVISOS_NA_PILHA.
  //
  // DISTANCIA_RODAPE_PILHA_PX: o aviso do relatório é do Módulo 1
  // (protegido, não muda de lugar): fica a 78px do rodapé e tem até ~2
  // linhas (topo a ~140px). A pilha começa ACIMA disso.
  const ID_PILHA_AVISOS = 'smarttable-pilha-avisos';
  const MAX_AVISOS_NA_PILHA = 3;
  const DISTANCIA_RODAPE_PILHA_PX = 150;

  function pilhaDeAvisos() {
    let pilha = document.getElementById(ID_PILHA_AVISOS);
    if (pilha) return pilha;
    pilha = document.createElement('div');
    pilha.id = ID_PILHA_AVISOS;
    Object.assign(pilha.style, {
      position: 'fixed',
      right: '24px',
      bottom: `${DISTANCIA_RODAPE_PILHA_PX}px`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '8px',
      zIndex: 999999,
      pointerEvents: 'none',
    });
    document.body.appendChild(pilha);
    return pilha;
  }

  /**
   * Põe um aviso na pilha, abaixo dos que já estão lá.
   *
   * @param {HTMLElement} el O aviso (qualquer estilo visual; a POSIÇÃO é da pilha).
   * @param {{fixo?: boolean}} [opcoes] fixo: um indicador que fica até o dono
   *   remover (ex.: progresso do Alt+U) -- nunca é tirado pra dar lugar a
   *   um aviso novo.
   */
  function colocarNaPilha(el, opcoes = {}) {
    const pilha = pilhaDeAvisos();
    Object.assign(el.style, { position: 'static', top: '', right: '', bottom: '', left: '' });
    if (opcoes.fixo) el.dataset.pilhaFixo = '1';
    pilha.appendChild(el);
    const soltos = Array.from(pilha.children).filter((filho) => !filho.dataset.pilhaFixo);
    while (pilha.children.length > MAX_AVISOS_NA_PILHA && soltos.length > 0) soltos.shift().remove();
  }

  // ============================================================
  // UI: MENU LATERAL E CABEÇALHO DO CRM (v1.38.0)
  // ============================================================
  // CONFIRMADO no CRM real (diagnóstico do usuário, 23/09/2026):
  //   - aside#sidebar: fixo, left 0, abaixo do cabeçalho, 256px (w-64),
  //     camada 40, escondido abaixo de 1024px (hidden lg:flex); o botão
  //     #sidebar-toggle-btn ("Recolher menu lateral") chama toggleSidebar().
  //   - header#sit-header: fixo no topo, 80px de altura, camada 50.
  // Os painéis nossos abriam a 16px da esquerda, numa camada (30) ABAIXO do
  // menu: os primeiros 240px de cada um ficavam escondidos atrás dele.
  //
  // A margem é MEDIDA, nunca fixada em 256: não sabemos como o CRM recolhe
  // o menu (esconde, estreita ou desliza), e medir a borda direita dele
  // serve pros três casos -- e pro menu que some em tela pequena.
  const ID_MENU_LATERAL = 'sidebar';
  const ID_CABECALHO = 'sit-header';
  const FOLGA_MENU_PX = 16;
  // Depois de recolher/expandir, o CRM pode animar o menu -- mede de novo
  // quando a animação costuma ter acabado.
  const ESPERA_ANIMACAO_MENU_MS = 350;

  function elementoVisivel(el) {
    if (!el) return null;
    const estilo = getComputedStyle(el);
    if (estilo.display === 'none' || estilo.visibility === 'hidden') return null;
    const caixa = el.getBoundingClientRect();
    return caixa.width > 0 && caixa.height > 0 ? caixa : null;
  }

  /** Onde termina o menu lateral do CRM, em px (0 = sem menu visível). */
  function margemMenuLateral() {
    const caixa = elementoVisivel(document.getElementById(ID_MENU_LATERAL));
    return caixa && caixa.right > 0 ? Math.round(caixa.right) : 0;
  }

  /** Onde termina o cabeçalho fixo do CRM, em px (0 = sem cabeçalho). */
  function alturaCabecalho() {
    const caixa = elementoVisivel(document.getElementById(ID_CABECALHO));
    return caixa && caixa.bottom > 0 ? Math.round(caixa.bottom) : 0;
  }

  const acompanhados = new Map(); // elemento -> folga em px
  let vigiaDoMenuInstalada = false;

  function reposicionarAcompanhados() {
    const margem = margemMenuLateral();
    for (const [el, folga] of acompanhados) {
      if (!el.isConnected) {
        acompanhados.delete(el);
        continue;
      }
      el.style.left = `${margem + folga}px`;
    }
  }

  function instalarVigiaDoMenu() {
    if (vigiaDoMenuInstalada) return;
    vigiaDoMenuInstalada = true;
    const reagir = () => {
      reposicionarAcompanhados();
      setTimeout(reposicionarAcompanhados, ESPERA_ANIMACAO_MENU_MS);
    };
    window.addEventListener('resize', reposicionarAcompanhados);
    try {
      const vigia = new MutationObserver(reagir);
      // Recolher pode trocar classe/estilo do próprio menu OU de html/body.
      [document.getElementById(ID_MENU_LATERAL), document.documentElement, document.body]
        .filter(Boolean)
        .forEach((alvo) => vigia.observe(alvo, { attributes: true, attributeFilter: ['class', 'style'] }));
      const menu = document.getElementById(ID_MENU_LATERAL);
      if (menu) {
        menu.addEventListener('transitionend', reposicionarAcompanhados);
        if (typeof ResizeObserver === 'function') new ResizeObserver(reposicionarAcompanhados).observe(menu);
      }
    } catch (erro) {
      console.warn('[SmartTable] Não consegui vigiar o menu lateral -- os painéis ficam onde abriram.', erro);
    }
  }

  /**
   * Mantém um elemento fixo logo à direita do menu lateral do CRM, e o move
   * quando o menu é recolhido/expandido. Para de acompanhar sozinho quando
   * o elemento sai da página.
   *
   * @param {HTMLElement} el
   * @param {number} [folga] Distância do menu, em px.
   */
  function acompanharMenuLateral(el, folga = FOLGA_MENU_PX) {
    if (!el) return;
    acompanhados.set(el, folga);
    el.style.left = `${margemMenuLateral() + folga}px`;
    instalarVigiaDoMenu();
  }

  // ============================================================
  // ASSÍNCRONO
  // ============================================================
  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // NAVEGAÇÃO
  // ============================================================
  function montarUrlCliente(grupoId, cnpj) {
    return `${location.origin}/crm/clientes/grupo/${grupoId}?cnpj=${encodeURIComponent(cnpj)}`;
  }

  // ============================================================
  // TÍTULO REPRESENTATIVO (regra de negócio confirmada com o usuário) --
  // qual título "representa" o cliente pra nota padronizada do CRM e pra
  // mensagem automática. Ordem de prioridade (primeira faixa não-vazia
  // decide):
  //   1. ULTIMO_DIA (prazo final antes de cartório/SCPC)
  //   2. NEGATIVADO_SCPC na janela de aviso de suspensão de cadastro
  //   3. Maior atraso real entre todos os títulos (situação normal)
  // ============================================================

  // Dias de atraso em que o SCPC passa a avisar sobre a suspensão de
  // cadastro -- CONFIRMADO com o usuário: 16 a 18 dias avisa que a
  // suspensão vem a caminho; exatamente no 19º dia é o último dia antes da
  // suspensão de verdade (cadastro vai pra um analista).
  const DIAS_AVISO_SUSPENSAO_SCPC_MIN = 16;
  const DIAS_AVISO_SUSPENSAO_SCPC_MAX = 18;
  const DIAS_ULTIMO_DIA_SUSPENSAO_SCPC = 19;

  function maiorAtrasoEntre(lista) {
    return lista.reduce((a, b) => (b.diasAtrasoReal > a.diasAtrasoReal ? b : a));
  }

  function escolherTituloRepresentativo(dados) {
    if (!dados || !dados.registros || dados.registros.length === 0) return null;

    const emUltimoDia = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA');
    if (emUltimoDia.length > 0) return maiorAtrasoEntre(emUltimoDia);

    const emAvisoSuspensaoScpc = dados.registros.filter(
      (r) =>
        r.situacaoKey === 'NEGATIVADO_SCPC' &&
        r.diasAtrasoReal >= DIAS_AVISO_SUSPENSAO_SCPC_MIN &&
        r.diasAtrasoReal <= DIAS_ULTIMO_DIA_SUSPENSAO_SCPC
    );
    if (emAvisoSuspensaoScpc.length > 0) return maiorAtrasoEntre(emAvisoSuspensaoScpc);

    // CONFIRMADO com o usuário: título já EM_CARTORIO saiu da cobrança
    // amigável -- a prioridade de pagamento (e por isso o pedido/CTA da
    // mensagem) é sempre um título que AINDA NÃO foi pra cartório, mesmo
    // que ele tenha menos dias de atraso que o título em cartório. BUG
    // REAL (relatado pelo usuário): antes, "maior atraso real" comparava
    // todos os títulos juntos -- um título em cartório há 45 dias vencia
    // um título em atraso inicial há 3 dias só por ter mais dias,
    // escolhendo o título errado (o que já foi pra cartório, não o que
    // ainda dá pra evitar) e deixando o título realmente prioritário sem
    // nenhuma menção na mensagem. Só cai pra um título em cartório se
    // literalmente não sobrar nenhum outro -- caso raro na prática, já que
    // um cliente com TODOS os títulos em cartório nem chega até aqui (ver
    // avisarSeNaoCobrar no Módulo 1).
    // DECISÃO DO USUÁRIO (28/09): VERIFICAR_POSICAO continua podendo ser o
    // escolhido aqui -- se ele for o mais atrasado, o Alt+A não gera
    // mensagem (situação incerta), mesmo havendo outro título normal. "Esse
    // cliente não é da minha ossada." Travado em tests/mensagens.test.js.
    const naoCartorio = dados.registros.filter((r) => r.situacaoKey !== 'EM_CARTORIO');
    if (naoCartorio.length > 0) return maiorAtrasoEntre(naoCartorio);

    return maiorAtrasoEntre(dados.registros);
  }

  // ============================================================
  // CONFIGURAÇÕES DO USUÁRIO (interruptores do painel Alt+O)
  // ============================================================
  //
  // POR QUE AQUI, e não no módulo que desenha o painel: o Módulo 0 carrega
  // PRIMEIRO, então qualquer módulo pode ler uma configuração no momento em
  // que precisa dela, sem depender de ordem de carregamento. O Módulo 9 só
  // desenha o que estiver declarado aqui.
  //
  // PRA ACRESCENTAR UM INTERRUPTOR NOVO: basta uma entrada em DEFINICOES.
  // O painel aparece sozinho, o teste de configuração cobre sozinho, e
  // quem precisa do valor chama ligado('aChave'). Nada de mexer na UI.
  //
  // O padrão de TODO interruptor tem que ser o comportamento que já existia
  // antes dele. Quem nunca abriu o painel não pode ter nada mudando embaixo
  // dos pés.
  const CHAVE_CONFIG = 'smarttable_config_v1';

  const DEFINICOES = Object.freeze({
    usarWhatsAppWeb: Object.freeze({
      titulo: 'Enviar pelo WhatsApp Web',
      descricao:
        'Desligado (padrão): a mensagem abre no app do WhatsApp Desktop. ' +
        'Ligado: abre em web.whatsapp.com, sempre na mesma aba. ' +
        'Serve pra atender por outra conta sem desvincular a sua do app.',
      padrao: false,
    }),
  });

  /**
   * Lê o objeto de configuração inteiro do localStorage.
   *
   * Nunca lança: localStorage pode estar cheio, bloqueado (aba anônima) ou
   * com JSON corrompido de uma versão anterior. Em qualquer desses casos o
   * script tem que seguir cobrando com os padrões, não parar.
   *
   * @returns {Record<string, boolean>} Só as chaves declaradas em DEFINICOES.
   */
  function lerConfigBruta() {
    let cru = null;
    try {
      cru = window.localStorage.getItem(CHAVE_CONFIG);
    } catch (erro) {
      console.warn('[Util] Não consegui ler as configurações; usando os padrões.', erro);
      return {};
    }
    if (!cru) return {};

    let objeto = null;
    try {
      objeto = JSON.parse(cru);
    } catch (erro) {
      console.warn('[Util] Configurações corrompidas no localStorage; usando os padrões.', erro);
      return {};
    }
    if (!objeto || typeof objeto !== 'object') return {};

    // Só aceita chave declarada e valor booleano -- lixo de versão antiga
    // (ou de alguém editando à mão) não vira comportamento.
    const limpo = {};
    Object.keys(DEFINICOES).forEach((chave) => {
      if (typeof objeto[chave] === 'boolean') limpo[chave] = objeto[chave];
    });
    return limpo;
  }

  /**
   * Valor atual de um interruptor.
   *
   * @param {string} chave Chave declarada em DEFINICOES.
   * @returns {boolean} O valor salvo, ou o padrão da definição.
   */
  function configLigado(chave) {
    const definicao = DEFINICOES[chave];
    if (!definicao) {
      console.warn(`[Util] Configuração desconhecida: "${chave}". Tratando como desligada.`);
      return false;
    }
    const salvo = lerConfigBruta()[chave];
    return typeof salvo === 'boolean' ? salvo : definicao.padrao;
  }

  /**
   * Grava um interruptor.
   *
   * @param {string} chave Chave declarada em DEFINICOES.
   * @param {boolean} valor
   * @returns {boolean} true se gravou; false se a chave não existe ou o
   *   localStorage recusou (cota cheia, modo anônimo).
   */
  function configDefinir(chave, valor) {
    if (!DEFINICOES[chave]) {
      console.warn(`[Util] Configuração desconhecida: "${chave}". Nada foi gravado.`);
      return false;
    }
    const atual = lerConfigBruta();
    atual[chave] = valor === true;
    try {
      window.localStorage.setItem(CHAVE_CONFIG, JSON.stringify(atual));
      return true;
    } catch (erro) {
      console.warn('[Util] Não consegui gravar a configuração.', erro);
      return false;
    }
  }

  /**
   * Inverte um interruptor.
   *
   * @param {string} chave
   * @returns {boolean} O valor que passou a valer. Se a gravação falhar,
   *   devolve o valor que continua valendo -- a tela nunca mente sobre o
   *   que está em vigor.
   */
  function configAlternar(chave) {
    const novo = !configLigado(chave);
    return configDefinir(chave, novo) ? novo : configLigado(chave);
  }

  const config = {
    DEFINICOES,
    CHAVE_CONFIG,
    ligado: configLigado,
    definir: configDefinir,
    alternar: configAlternar,
  };

  // ============================================================
  // SEMANA DE COBRANÇA (sábado a sexta) E IDENTIDADE DE USUÁRIO
  // ============================================================
  //
  // A semana da cobrança NÃO é a semana do calendário: ela vai de SÁBADO a
  // SEXTA (definição do usuário). Quando hoje é sábado, ele é o PRIMEIRO dia
  // da semana nova, não o último da anterior.

  /**
   * Data em AAAA-MM-DD, montada campo a campo.
   *
   * NUNCA usar toISOString() aqui: ele converte pra UTC, e com a convenção
   * de meio-dia deste projeto um fuso negativo devolve o dia ANTERIOR. Seria
   * a terceira vez que data trocada de dia causa bug neste código.
   *
   * @param {Date} data
   * @returns {string}
   */
  function dataIso(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  /**
   * Identificador CENSURADO pra log/console/diagnóstico (regra permanente do
   * usuário: "Para todos os codigos no devstool, codifique de uma maneira
   * que as informações sensíveis sejam censuradas"). Devolve o apelido
   * estável do Módulo 8 ("cli.xxxx": o mesmo valor vira sempre o mesmo
   * apelido, então dá pra cruzar logs), nunca o CNPJ, a razão social ou o
   * número do título. Sem o Módulo 8, um marcador fixo -- nunca o valor.
   *
   * @param {unknown} valor CNPJ, número de título, id de acordo...
   * @returns {string}
   */
  function apelidoParaLog(valor) {
    // CNPJ com ou sem pontuação é o MESMO cliente: normaliza pros dígitos
    // antes, senão "12.345.678/0001-99" e "12345678000199" virariam dois
    // apelidos e os logs não cruzariam (achado do revisor, rodada 2).
    const texto = String(valor ?? '');
    const chave = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(texto.trim()) ? texto.replace(/\D/g, '') : texto;
    try {
      const a = window.__diario?.apelido?.(chave);
      if (typeof a === 'string' && a) return a;
    } catch (erro) {
      /* cai no marcador */
    }
    return 'cli.????';
  }

  /**
   * Lê `nome = [ ... ]` / `{ ... }` de um script da página SEM executar
   * nada: casa colchetes/chaves respeitando texto entre aspas e escape.
   * Serve pro HTML baixado (Alt+U sem aba, Módulo 7) e pra página aberta
   * (__TITULOS_PAGOS__, Módulo 12) -- não depende de como o CRM declara a
   * variável (window.x, const, let).
   * @returns {*} o valor (JSON.parse) ou undefined se não achou
   */
  function lerVariavelDoScript(doc, nome) {
    const padrao = new RegExp(`${nome.replace(/[$]/g, '\\$')}\\s*=\\s*[\\[{]`);
    for (const script of doc.querySelectorAll('script:not([src])')) {
      const t = script.textContent || '';
      const i = t.search(padrao);
      if (i < 0) continue;
      const abre = t.indexOf('=', i) + 1 + t.slice(t.indexOf('=', i) + 1).search(/[[{]/);
      const fecha = t[abre] === '[' ? ']' : '}';
      let profundidade = 0;
      let emTexto = null;
      let escapado = false;
      for (let j = abre; j < t.length; j++) {
        const ch = t[j];
        if (emTexto) {
          if (escapado) escapado = false;
          else if (ch === '\\') escapado = true;
          else if (ch === emTexto) emTexto = null;
          continue;
        }
        if (ch === '"' || ch === "'") { emTexto = ch; continue; }
        if (ch === t[abre]) profundidade += 1;
        else if (ch === fecha) {
          profundidade -= 1;
          if (profundidade === 0) return JSON.parse(t.slice(abre, j + 1));
        }
      }
    }
    return undefined;
  }

  /**
   * 'AAAA-MM-DD' (com ou sem hora depois) -> 'DD/MM'; '' se não for data.
   * Única versão do projeto (v1.46.0, revisão de código): os Módulos 16 e 17
   * tinham cada um a sua, e a do 17 devolvia lixo pra texto vazio.
   *
   * @param {string} iso
   * @returns {string}
   */
  function dataCurtaDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    return m ? `${m[3]}/${m[2]}` : '';
  }

  /**
   * O sábado e a sexta da semana que contém a data de referência.
   *
   * @param {Date} [referencia] Padrão: hoje.
   * @returns {{inicio: Date, fim: Date, inicioIso: string, fimIso: string}}
   */
  function semanaSabadoASexta(referencia) {
    const base = normalizarData(referencia ?? new Date());
    // getDay(): 0=domingo ... 6=sábado. Dias decorridos desde o sábado:
    // sábado=0, domingo=1, segunda=2, ..., sexta=6.
    const desdeSabado = (base.getDay() + 1) % 7;

    const inicio = normalizarData(new Date(base));
    inicio.setDate(base.getDate() - desdeSabado);

    const fim = normalizarData(new Date(inicio));
    fim.setDate(inicio.getDate() + 6);

    return { inicio, fim, inicioIso: dataIso(inicio), fimIso: dataIso(fim) };
  }

  /**
   * O primeiro nome dentro de um identificador de usuário do CRM.
   *
   * POR QUE ISTO EXISTE (achado ao vivo, e teria dado número errado em
   * silêncio): a API do dashboard consolidado devolve DOIS esquemas de
   * identificação na MESMA resposta --
   *
   *   depositos/acordos  -> "isaac.s"      (login: nome.inicial)
   *   promessas/contatos -> "ISAAC.03876"  (código do CRM)
   *
   * Procurar por "ISAAC.03876" acharia a pessoa em duas seções e não acharia
   * nada nas outras duas, devolvendo R$ 0,00 pra quem recebeu de verdade --
   * sem erro na tela. O que vem antes do ponto é igual nos dois esquemas.
   *
   * CONFERIDO com dado real: nas quatro seções, nenhum primeiro nome se
   * repete entre os usuários do time.
   *
   * @param {string|null|undefined} usuario
   * @returns {string} Em minúsculas, ou '' se não der pra extrair.
   */
  function primeiroNomeDeUsuario(usuario) {
    return String(usuario ?? '').trim().split('.')[0].toLowerCase();
  }

  /*
   * LISTA DE CLIENTES FILTRADA? (v1.43.0, usada pela Carteira e pelo Alt+U)
   * Com um filtro do CRM ligado, window.CLIENTES traz só parte da carteira.
   * CONFIRMADO no CRM (diagnóstico de 25/09/2026): o formulário de filtros é
   * GET -- filtro ligado vai pro endereço (?cartorio=true&diasCartorio=6&
   * cartorioModo=QUALQUER); a lista sem filtro não tem parâmetro nenhum. Com
   * o filtro de dia, cada cliente traz titulosNoDiaFiltrado (um número); sem
   * ele, null -- segunda verificação, pelo próprio dado.
   *
   * diasCartorio/cartorioModo só valem com cartorio=true (o formulário os
   * envia mesmo desligados). Parâmetro DESCONHECIDO com valor conta como
   * filtro: melhor recusar e dizer por quê do que gravar parcial calado.
   */
  const FILTROS_LISTA_LIGA_COM_TRUE = { cartorio: 'Dias de atraso (Cartório)', apenasNovos: 'Apenas novos', bloqueio97: 'Bloqueio 97', comFiador: 'Com fiador' };
  const FILTROS_LISTA_COM_VALOR = { search: 'Buscar', filtroScpc: 'SCPC' };
  const PARAMETROS_DO_FILTRO_DE_DIA = ['diasCartorio', 'cartorioModo'];

  /**
   * @param {object[]} lista window.CLIENTES
   * @param {{busca?: string, pessoas?: string[]}} [opcoes] busca: o
   *   location.search; pessoas: primeiros nomes da carteira (o negociador
   *   de uma delas, "Meus" e "Todos" mantêm a lista completa).
   * @returns {string[]|null} rótulos dos filtros ligados, como na tela; null = lista completa
   */
  function filtrosAtivosNaListaDeClientes(lista, opcoes = {}) {
    const pessoas = Array.isArray(opcoes.pessoas) ? opcoes.pessoas : [];
    const filtros = [];
    new URLSearchParams(opcoes.busca ?? window.location.search ?? '').forEach((valorCru, chave) => {
      const valor = String(valorCru).trim();
      if (chave in FILTROS_LISTA_LIGA_COM_TRUE) {
        if (valor === 'true') filtros.push(FILTROS_LISTA_LIGA_COM_TRUE[chave]);
      } else if (chave in FILTROS_LISTA_COM_VALOR) {
        if (valor !== '') filtros.push(FILTROS_LISTA_COM_VALOR[chave]);
      } else if (chave === 'negociador') {
        // Usuário de quem está na carteira mantém; "SEM_NEGOCIADOR" e outra pessoa, não.
        if (!(valor === '' || valor === 'MEUS' || pessoas.includes(primeiroNomeDeUsuario(valor)))) filtros.push('Negociador');
      } else if (!PARAMETROS_DO_FILTRO_DE_DIA.includes(chave) && valor !== '') {
        filtros.push(`"${chave}"`);
      }
    });
    if (Array.isArray(lista) && lista.some((c) => c && c.titulosNoDiaFiltrado !== null && c.titulosNoDiaFiltrado !== undefined)) {
      filtros.push(FILTROS_LISTA_LIGA_COM_TRUE.cartorio);
    }
    const unicos = [...new Set(filtros)];
    return unicos.length > 0 ? unicos : null;
  }

  /**
   * Número em reais. Aceita null/undefined/NaN devolvendo '--' em vez de
   * "R$ NaN" -- um painel que mostra NaN é pior que um que admite não saber.
   *
   * @param {number|null|undefined} valor
   * @returns {string}
   */
  function formatarMoeda(valor) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return '--';
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ============================================================
  // PAINÉIS FLUTUANTES: SÓ UM ABERTO POR VEZ
  // ============================================================
  //
  // DEFEITO REAL que motivou isto: quatro painéis nossos (Ajuda/Alt+H,
  // Novidades/Alt+L, Configurações/Alt+O, Entrou na semana/Alt+D) abriam
  // todos em bottom:112px left:16px. Nenhum fechava os outros, então abrir
  // dois empilhava um por cima do outro -- e fechar o de cima revelava um
  // painel que a pessoa não lembrava de ter aberto.
  //
  // A causa foi copiar coordenadas de um painel pro seguinte. O conserto
  // não é reposicionar (aí a próxima cópia repete o erro num canto novo):
  // é tornar o espaço EXCLUSIVO. Só um painel flutuante nosso na tela, e
  // abrir qualquer um fecha os demais.
  //
  // Isto também é o orçamento de tela do projeto, em código: enquanto todo
  // painel novo passar por aqui, a quantidade de coisa simultânea na tela
  // não cresce, por mais painéis que a gente acrescente.
  const paineisRegistrados = new Map();

  /**
   * Registra o fechador de um painel flutuante.
   *
   * @param {string} nome Identificador do painel (ex.: 'configuracoes').
   * @param {() => void} fechar Função que fecha esse painel.
   */
  function registrarPainel(nome, fechar) {
    paineisRegistrados.set(nome, fechar);
  }

  /**
   * Fecha todos os painéis flutuantes MENOS o que está abrindo.
   *
   * Chamado pelo painel no momento em que ele abre. Erro no fechador de um
   * painel não pode impedir a abertura do outro -- daí o try/catch por
   * item.
   *
   * @param {string} nomeQueAbre
   */
  function fecharOutrosPaineis(nomeQueAbre) {
    paineisRegistrados.forEach((fechar, nome) => {
      if (nome === nomeQueAbre) return;
      try {
        fechar();
      } catch (erro) {
        console.warn(`[Util] Falha ao fechar o painel "${nome}".`, erro);
      }
    });
  }

  // ============================================================
  // REGISTRO DE MÓDULOS CARREGADOS
  // ============================================================
  //
  // MESMO PADRÃO do registro de painéis logo acima: cada módulo se anuncia
  // sozinho, em vez de ser listado à mão num arquivo que não tem nada a ver
  // com ele. Antes disto, "quais módulos existem" era afirmado em TRÊS
  // lugares independentes -- as linhas @require do wrapper, a flag que cada
  // módulo seta (`window.__xCarregado = true`), e um array copiado à mão
  // dentro do Módulo 6 (`FLAGS_DOS_MODULOS`) -- e o terceiro já ficou pra
  // trás duas vezes na mesma sessão de manutenção (o Módulo 11 nunca entrou
  // nele, sem nenhum aviso até alguém rodar a suíte de testes).
  //
  // ISTO NÃO ELIMINA a necessidade de um humano lembrar de anunciar um
  // módulo novo -- MODULOS_ESPERADOS continua sendo uma lista hand-mantida,
  // porque não há como uma página descobrir em runtime quantos @require o
  // Tampermonkey concatenou (isso é metadado do userscript, não algo
  // exposto pro JS). O que muda: o lugar certo de editar quando um módulo
  // novo nasce é O PRÓPRIO ARQUIVO DELE (a mesma linha que já seta a flag),
  // não um arquivo alheio -- e um nome que não bate com o esperado avisa NA
  // HORA, no console, na primeira vez que a página carrega em
  // desenvolvimento, em vez de só quando alguém lembra de rodar
  // `npm run verificar`.
  const MODULOS_ESPERADOS = Object.freeze([
    'Utilitários Compartilhados',
    'Aviso de Cobrança',
    'Registrar e Enviar',
    'Fila de Atendimento',
    'Alerta do Cliente',
    'Fila por Prioridade',
    'Progresso da Fila',
    'Alerta de Grupo Econômico',
    'Atalhos de Teclado',
    'Log de Atualização',
    'Contexto Adicional',
    'Diário',
    'Painel de Configurações',
    'Recebido na Semana',
    'Console de Diagnóstico',
    'Carteira',
    'Alertas Gerais',
    'Negociações',
    'Promessa Rápida',
  ]);

  const modulosCarregadosRegistrados = new Set();

  /**
   * Cada módulo chama isto na mesma linha em que já seta sua própria flag
   * de "já carreguei" (`window.__xCarregado = true`).
   *
   * @param {string} nome Um dos nomes em MODULOS_ESPERADOS.
   */
  function registrarModuloCarregado(nome) {
    if (!MODULOS_ESPERADOS.includes(nome)) {
      console.warn(
        `[Util] registrarModuloCarregado("${nome}") -- esse nome não está em MODULOS_ESPERADOS. ` +
        'Typo, ou esqueceu de acrescentar o nome novo na lista do Módulo 0?'
      );
    }
    modulosCarregadosRegistrados.add(nome);
  }

  /** @returns {string[]} Nomes que já se anunciaram, na ordem em que chegaram. */
  function modulosCarregados() {
    return Array.from(modulosCarregadosRegistrados);
  }

  /** @returns {string[]} Nomes esperados que ainda não se anunciaram. */
  function modulosFaltando() {
    return MODULOS_ESPERADOS.filter((nome) => !modulosCarregadosRegistrados.has(nome));
  }

  // Módulo 0 se anuncia igual a qualquer outro -- não é caso especial, só
  // precisa acontecer DEPOIS de modulosCarregadosRegistrados existir (por
  // isso aqui, e não lá em cima junto da flag __utilitariosCompartilhadosCarregados).
  registrarModuloCarregado('Utilitários Compartilhados');

  // ============================================================
  // ROTAÇÃO DE FRASES (variar sem soar aleatório)
  // ============================================================
  //
  // PROBLEMA MEDIDO: 192 mensagens da matriz de cenários produziam 18
  // distintas, e 83% terminavam na MESMA pergunta final. Com quase toda a
  // carteira sendo contatada diariamente, o mesmo cliente lia a mesma frase
  // todo dia -- que é quando a mensagem deixa de ser lida.
  //
  // A escolha é DETERMINÍSTICA por semente, não sorteada:
  //   - mesmo cliente, dia seguinte  -> frase diferente
  //   - mesmo cliente, mesmo dia     -> frase IDÊNTICA, mesmo apertando
  //                                     Alt+A duas vezes (nada troca no meio
  //                                     de uma conversa em andamento)
  //   - clientes diferentes, mesmo dia -> frases diferentes entre si
  //
  // POR QUE UM HASH PRÓPRIO, e não o hashEstavel do Módulo 8: aquele decide
  // o GRUPO DE CONTROLE do experimento da régua. Se um dia alguém ajustar o
  // hash por causa das frases, remexe a atribuição do experimento sem
  // perceber. São dois usos com requisitos diferentes; ficam separados de
  // propósito.

  /**
   * Hash estável de uma string (FNV-1a). Mesmo texto, mesmo número, sempre
   * -- inclusive entre navegadores e entre dias.
   *
   * @param {string} texto
   * @returns {number} Inteiro não negativo.
   */
  function hashDeFrase(texto) {
    let h = 0x811c9dc5;
    const s = String(texto);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return Math.abs(h | 0);
  }

  /**
   * Escolhe uma variante de frase de forma estável para a semente dada.
   *
   * @param {string} semente Normalmente `${cnpj}|${dia}`.
   * @param {string[]} variantes Todas com a MESMA firmeza e o mesmo pedido.
   * @returns {string} '' quando não há variante (quem chama decide o que fazer).
   */
  function escolherVariante(semente, variantes) {
    if (!Array.isArray(variantes) || variantes.length === 0) return '';
    if (variantes.length === 1) return variantes[0];
    return variantes[hashDeFrase(semente) % variantes.length];
  }

  // ============================================================
  // EXPORT
  // ============================================================
  window.__smartTableUtil = {
    normalizarData,
    toast,
    colocarNaPilha,
    margemMenuLateral,
    alturaCabecalho,
    acompanharMenuLateral,
    esperar,
    montarUrlCliente,
    maiorAtrasoEntre,
    escolherTituloRepresentativo,
    config,
    registrarPainel,
    fecharOutrosPaineis,
    registrarModuloCarregado,
    modulosCarregados,
    modulosFaltando,
    MODULOS_ESPERADOS,
    hashDeFrase,
    escolherVariante,
    dataIso,
    dataCurtaDeIso,
    apelidoParaLog,
    lerVariavelDoScript,
    semanaSabadoASexta,
    primeiroNomeDeUsuario,
    filtrosAtivosNaListaDeClientes,
    formatarMoeda,
    DIAS_AVISO_SUSPENSAO_SCPC_MIN,
    DIAS_AVISO_SUSPENSAO_SCPC_MAX,
    DIAS_ULTIMO_DIA_SUSPENSAO_SCPC,
  };
})();
