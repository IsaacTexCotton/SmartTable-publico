/* =========================================================================
 * MÓDULO 4: ATALHOS DE TECLADO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Atalhos (todos com Alt, pra não colidir com atalhos do navegador/CRM):
 *
 *   Alt + I  -> Iniciar Fila de Atendimento   (na página de lista)
 *   Alt + U  -> Iniciar Fila por Prioridade   (na página de lista -- visita
 *               cada cliente em aba de fundo pra classificar por situação
 *               real, pode levar minutos; ver Módulo 7)
 *   Alt + R  -> Gerar Relatório               (na página do cliente)
 *   Alt + C  -> Entrar na tela de contato     (na página do cliente)
 *   Alt + F  -> Selecionar a 1ª frase padrão  (dentro da tela de contato)
 *   Alt + A  -> Atendimento rápido            (gera relatório + abre contato + escreve mensagem personalizada pra situação do cliente)
 *   Alt + S  -> Registrar e Enviar            (dentro da tela de contato)
 *   Alt + P  -> Ir para o próximo da fila     (conta como "atendido" se você já
 *                                              registrou este cliente, senão como "pulado")
 *   Alt + V  -> Voltar um cliente na fila     (desfaz a contagem do passo revertido)
 *   Alt + G  -> Abrir em nova aba as outras razões do grupo com saldo
 *               vencido (uma aba por razão -- gerar o relatório de cada
 *               uma continua sendo Alt+R manual, dentro de cada aba)
 *   Alt + B  -> Busca rápida de cliente       (por nome ou CNPJ, sem sair
 *               da lista -- reescreve o ?search= da URL atual)
 *   Alt + L  -> Ver o que mudou nas últimas versões (log de atualização,
 *               com marcação do que chegou desde a sua última leitura)
 *   Alt + H  -> Abrir/fechar painel de ajuda  (mostra esta lista na tela)
 *
 * Fluxo típico com teclado: Alt+C (abre contato) -> Alt+F (escolhe frase)
 * -> Alt+S (registra e envia, cliente fica marcado como atendido) -> Alt+P
 * quando você quiser seguir pro próximo da fila (Módulo 3 não navega
 * sozinho mais -- isso é sempre uma decisão sua).
 *
 * Onde colar: anexado ao FINAL do smart-table.js, depois dos módulos 0
 * (Utilitários Compartilhados), 1, 2, 3 (Fila de Atendimento), 7 (Fila por
 * Prioridade) e 5 (Alerta de Grupo). Depende do Módulo 0 (window.__smartTableUtil
 * -- esperar/escolherTituloRepresentativo/constantes SCPC), do Módulo 3
 * estar carregado antes (usa window.filaDebug.iniciarFila / irParaProximo /
 * irParaAnterior), do Módulo 7 (usa window.filaPrioridadeDebug.iniciar pro
 * Alt+U) e do Módulo 5 (usa window.__alertaGrupo pra linha de grupo com
 * vencido na mensagem e pro Alt+G).
 * * IMPORTANTE — dois atalhos ainda precisam de confirmação sua:
 *   "Gerar Relatório" e "Entrar na tela de contato" não têm uma função
 *   global exposta que eu conheça, então este módulo procura o botão certo
 *   por TEXTO (ver CONFIG_ATALHOS.TEXTO_BOTAO_RELATORIO e
 *   TEXTO_BOTAO_CONTATO). Se um atalho não fizer nada, olhe o console: vai
 *   aparecer um aviso "[Atalhos] Não encontrei...". Me diga o texto real e
 *   eu ajusto a linha certa. (Alt+F e Alt+S já estão confirmados com o
 *   HTML real do CRM.)
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__atalhosTecladoCarregados) return;
  window.__atalhosTecladoCarregados = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Atalhos de Teclado');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  const {
    escolherTituloRepresentativo,
    normalizarData,
    esperar,
    DIAS_AVISO_SUSPENSAO_SCPC_MIN,
    DIAS_AVISO_SUSPENSAO_SCPC_MAX,
    DIAS_ULTIMO_DIA_SUSPENSAO_SCPC,
  } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO
   * --------------------------------------------------------------------- */
  const CONFIG_ATALHOS = {
    // Teclas físicas (event.code), sempre combinadas com Alt.
    TECLA_INICIAR_FILA: 'KeyI',
    TECLA_FILA_PRIORIDADE: 'KeyU',
    TECLA_GERAR_RELATORIO: 'KeyR',
    TECLA_ABRIR_CONTATO: 'KeyC',
    TECLA_PROXIMO_DA_FILA: 'KeyP',
    TECLA_VOLTAR_FILA: 'KeyV',
    TECLA_SELECIONAR_FRASE: 'KeyF',
    TECLA_REGISTRAR_ENVIAR: 'KeyS',
    TECLA_AJUDA: 'KeyH',
    TECLA_NOVIDADES: 'KeyL',
    TECLA_BUSCA_RAPIDA: 'KeyB',
    TECLA_ATENDIMENTO_RAPIDO: 'KeyA',
    TECLA_ABRIR_GRUPO_VENCIDO: 'KeyG',
    TECLA_CONFIGURACOES: 'KeyO',
    TECLA_RECEBIDO_SEMANA: 'KeyD',
    TECLA_CARTEIRA: 'KeyM',
    TECLA_CONSOLE_DIAGNOSTICO: 'KeyK',
    TECLA_PROMESSA_RAPIDA: 'KeyN',
    // MELHORIA (pedido do usuário: "tem horas que tenho que apertar Alt+A
    // de novo pra pegar as frases"): antes, o Alt+A esperava um tempo FIXO
    // (150ms) entre clicar em "Entrar em contato" e escrever a mensagem.
    // Se o modal demorasse mais que isso pra montar a caixa de observações,
    // a escrita rodava cedo demais e desistia em silêncio. Agora espera o
    // SINAL real (a caixa existir de verdade) -- este valor é só o TETO de
    // segurança, pro caso raro do modal nunca terminar de abrir.
    TIMEOUT_AGUARDAR_CAIXA_OBSERVACOES_MS: 5000,
    // Teto da espera pelo Módulo 5 ler a aba "Grupo" (ele mesmo desiste em
    // 2,5s -- ver aguardarLeituraDoGrupo).
    TIMEOUT_AGUARDAR_GRUPO_MS: 3000,
    // Alt+A com outra(s) razão(ões) do grupo com saldo vencido: tempo
    // máximo (ms) esperando o botão de relatório aparecer em cada aba de
    // fundo depois de aberta, e intervalo (ms) entre tentativas de polling
    // (reaproveitado também pra esperar o relatório TERMINAR de gerar --
    // ver TIMEOUT_AGUARDAR_RELATORIO_PRONTO_MS).
    TIMEOUT_CARREGAMENTO_OUTRA_RAZAO_MS: 8000,
    INTERVALO_POLL_OUTRA_RAZAO_MS: 200,
    // MELHORIA (pedido do usuário): antes, esperava um tempo FIXO depois
    // de clicar em "Gerar Relatório" (folga generosa pro pior caso --
    // captura de tela + conversão pra blob + clipboard.write + download,
    // tudo assíncrono -- CONFIRMADO com o usuário: 2000ms não era
    // suficiente, por isso a folga). Agora espera o SINAL real de que
    // terminou (o próprio botão só reabilita depois que tudo -- inclusive
    // a cópia pra área de transferência -- já aconteceu, ver
    // esperarRelatorioProntoNaJanela), então o caso comum fica bem mais
    // rápido que a folga fixa de antes. Este valor é só o TETO de
    // segurança, pro caso raro do botão nunca reabilitar.
    TIMEOUT_AGUARDAR_RELATORIO_PRONTO_MS: 10000,
    // PEDIDO DO USUÁRIO: colar a mensagem inteira manda uma parede de texto
    // num balão só do WhatsApp -- ele repartia isso na mão. Cada parte vai
    // pra área de transferência em sequência (ver copiarPartesParaAreaDeTransferencia);
    // este intervalo entre uma cópia e outra é o que faz o Windows (Win+V)
    // registrar cada uma como uma entrada SEPARADA do histórico, em vez de
    // uma só sobrescrevendo a anterior rápido demais pra contar.
    //
    // BUG REAL (relatado pelo usuário: partes faltando ou duplicadas no
    // histórico): 250ms às vezes não dava folga suficiente pro Windows
    // registrar cada cópia como entrada própria -- aumentado pra dar mais
    // margem. A causa principal, porém, era outra (foco da aba -- ver
    // aguardarFoco), este valor é só reforço.
    INTERVALO_COPIA_PARTES_MS: 400,
    // Trechos de texto (minúsculo) usados pra achar os botões que ainda
    // não têm uma função global conhecida. AJUSTAR SE NÃO FUNCIONAR.
    TEXTO_BOTAO_RELATORIO: 'relatório',
    TEXTO_BOTAO_CONTATO: 'contato',
    TEXTO_BOTAO_REGISTRAR: 'registrar e enviar',
    // Confirmado no CRM real: cada frase padrão é um botão com esta classe,
    // e a ordem deles muda (o mais recente/favoritado aparece primeiro).
    SELETOR_BOTAO_FRASE: '.btn-inserir-frase',
    // IDs confirmados via diagnóstico real (mais confiável que texto/classe).
    ID_BOTAO_REGISTRAR: 'btn-registrar-enviar',
    ID_CAIXA_OBSERVACOES: 'contato-resumo',
    // Id do botão de relatório, criado pelo Módulo 1 (criarBotao). Buscar por
    // ID em vez de por texto é o que sobrevive à troca de rótulo: durante a
    // geração, aoClicar() muda o texto pra "Gerando...", que não contém
    // "relatório" -- e a busca por texto não achava mais o botão.
    ID_BOTAO_RELATORIO: 'aviso-cobranca-botao',
    // Id do overlay da busca rápida (Alt+B) -- precisa ser conhecido por
    // estaDigitando() pra que o próprio Alt+B consiga fechar a busca.
    ID_OVERLAY_BUSCA: 'smarttable-busca-rapida',
    // Última versão cujo log de atualização já foi lido -- é o que permite
    // marcar como NOVO só o que chegou depois da sua última olhada.
    CHAVE_ULTIMA_VERSAO_VISTA: 'smarttable_ultima_versao_vista',
    // NÚMEROS DIFERENTES (v1.36.0, ver seção 3.0e): intervalo mínimo entre
    // abrir um número e o próximo. Protege contra Alt+S apertado duas vezes
    // seguidas por reflexo -- o 2º abriria o número seguinte por cima da
    // conversa que ainda não foi mandada.
    INTERVALO_MINIMO_ENTRE_ENVIOS_MS: 3000,
    // Quanto tempo o Alt+S espera o Módulo 3 confirmar o registro do 1º
    // envio (o POST do Módulo 2 costuma levar menos de 1s).
    TIMEOUT_CONFIRMAR_REGISTRO_MS: 60000,
    // Envio em sequência armado mas nunca confirmado: até quanto tempo
    // depois ainda vale avisar na tela que os números extras não abriram.
    JANELA_AVISO_NAO_CONFIRMADO_MS: 120000,
  };

  // Fonte única de verdade pra lista de atalhos — usada tanto no aviso do
  // console quanto no painel de ajuda visual (Alt+H), pra nunca ficarem
  // desalinhados entre si.
  const LISTA_ATALHOS = [
    { tecla: 'Alt+I', descricao: 'Iniciar Fila de Atendimento' },
    { tecla: 'Alt+U', descricao: 'Fila por Prioridade: continua a de hoje; só monta do zero se não houver' },
    { tecla: 'Shift+Alt+U', descricao: 'Refazer a fila por prioridade do zero (tira quem já foi contatado hoje)' },
    { tecla: 'Alt+R', descricao: 'Gerar Relatório' },
    { tecla: 'Alt+C', descricao: 'Entrar na tela de contato' },
    { tecla: 'Alt+F', descricao: 'Selecionar a 1ª frase padrão' },
    { tecla: 'Alt+A', descricao: 'Atendimento rápido (relatório(s) de outra(s) razão(ões) do grupo, se houver, + relatório + contato + mensagem personalizada)' },
    { tecla: 'Alt+S', descricao: 'Registrar e Enviar (com "Números diferentes" marcado: cada Alt+S abre o próximo número)' },
    { tecla: 'Alt+N', descricao: 'Registrar promessa: marque o(s) título(s) (1 a 9), escolha a data (H hoje, A amanhã) e Enter -- o SmartTable preenche o contato do CRM, salva e confere' },
    { tecla: 'Alt+P', descricao: 'Ir para o próximo da fila' },
    { tecla: 'Alt+V', descricao: 'Voltar um cliente na fila' },
    { tecla: 'Alt+G', descricao: 'Abrir em nova aba as outras razões do grupo com saldo vencido' },
    { tecla: 'Alt+B', descricao: 'Busca rápida de cliente' },
    { tecla: 'Alt+L', descricao: 'Ver o que mudou nas últimas versões' },
    { tecla: 'Alt+D', descricao: 'Quanto entrou na semana (sáb a sex), Isaac e Bianca' },
    { tecla: 'Alt+M', descricao: 'Carteira: vencido, aging, tendência, cura e resultado do período' },
    { tecla: 'Alt+O', descricao: 'Abrir/fechar as configurações (interruptores)' },
    { tecla: 'Alt+K', descricao: 'Abrir/fechar o console de diagnóstico' },
    { tecla: 'Alt+H', descricao: 'Abrir/fechar esta ajuda' },
  ];

  /* ---------------------------------------------------------------------
   * 2. ESTADO
   * --------------------------------------------------------------------- */
  let painelAjudaEl = null;

  /* ---------------------------------------------------------------------
   * 3. UTILITÁRIOS
   * --------------------------------------------------------------------- */
  function estaDigitando() {
    // Não dispara atalhos enquanto o usuário está digitando em algum campo
    // (busca, filtro, textarea de observação, etc.).
    const el = document.activeElement;
    if (!el) return false;

    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }

  // ÚNICA definição de "visível" no arquivo (correção de DRY -- antes esta
  // mesma função-seta estava duplicada em 3 lugares diferentes).
  function elementoVisivel(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // doc opcional -- default é o document desta aba, mas pode receber o
  // document de outra janela same-origin (ver gerarRelatoriosDasOutrasRazoes).
  function encontrarElementoVisivelPorTexto(seletorBase, trecho, doc) {
    const documento = doc || document;
    const alvo = trecho.trim().toLowerCase();
    if (!alvo) return null;

    const candidatos = Array.from(documento.querySelectorAll(seletorBase));
    return (
      candidatos.find((el) => elementoVisivel(el) && (el.textContent || '').trim().toLowerCase().includes(alvo)) ||
      null
    );
  }

  function clicarBotaoPorTexto(trecho, doc) {
    const encontrado = encontrarElementoVisivelPorTexto('button, a[role="button"], [role="button"]', trecho, doc);
    if (encontrado) {
      simularCliqueCompleto(encontrado);
      return true;
    }
    return false;
  }

  // Espera (com polling) o botão aparecer em OUTRA janela same-origin já
  // aberta -- lê janela.document a cada tentativa (não guarda uma
  // referência fixa), porque o document de uma aba recém-aberta com
  // window.open(url) começa como about:blank e é substituído por um objeto
  // novo quando a navegação real termina. Resolve com o elemento encontrado,
  // ou com null se a aba fechar sozinha ou o tempo esgotar.
  function esperarElementoVisivelPorTextoNaJanela(seletorBase, trecho, janela, timeoutMs, intervaloMs) {
    return new Promise((resolve) => {
      const prazoFinal = Date.now() + timeoutMs;
      (function tentar() {
        if (janela.closed) return resolve(null);
        let el = null;
        try {
          el = encontrarElementoVisivelPorTexto(seletorBase, trecho, janela.document);
        } catch (erro) {
          return resolve(null);
        }
        if (el) return resolve(el);
        if (Date.now() >= prazoFinal) return resolve(null);
        setTimeout(tentar, intervaloMs);
      })();
    });
  }

  // Generaliza esperarElementoVisivelPorTextoNaJanela pra qualquer condição
  // (não só "elemento existe") -- usada pra esperar um SINAL real de que
  // uma operação assíncrona em OUTRA janela terminou, em vez de uma espera
  // fixa arbitrária (ver esperarRelatorioProntoNaJanela abaixo). Resolve
  // true quando a condição bate, false se a aba fechar ou o tempo esgotar.
  function esperarCondicaoNaJanela(condicao, janela, timeoutMs, intervaloMs) {
    return new Promise((resolve) => {
      const prazoFinal = Date.now() + timeoutMs;
      (function tentar() {
        if (janela.closed) return resolve(false);
        let pronto = false;
        try {
          pronto = !!condicao();
        } catch (erro) {
          return resolve(false);
        }
        if (pronto) return resolve(true);
        if (Date.now() >= prazoFinal) return resolve(false);
        setTimeout(tentar, intervaloMs);
      })();
    });
  }

  // PEDIDO DO USUÁRIO: em vez de esperar um tempo fixo (que precisava de
  // folga generosa pra cobrir o pior caso -- captura de tela + conversão
  // pra blob + clipboard.write + download, tudo assíncrono), espera o
  // SINAL real de que terminou. aoClicar() do Módulo 1 é assíncrono e o
  // finally dele só reabilita o botão DEPOIS que a Promise inteira resolve
  // -- captura, cópia pra área de transferência e download já aconteceram.
  // Usa o próprio botão (referência já obtida) em vez de buscar de novo
  // por texto, porque o texto dele muda pra "Gerando..." durante a
  // operação.
  function esperarRelatorioProntoNaJanela(botao, janela, timeoutMs, intervaloMs) {
    return esperarCondicaoNaJanela(() => botao.disabled === false, janela, timeoutMs, intervaloMs);
  }

  function dispararEventoDeMouse(elemento, tipo) {
    const opcoes = { bubbles: true, cancelable: true, view: window, button: 0 };
    let evento;
    try {
      evento = new PointerEvent(tipo, opcoes);
    } catch (e) {
      evento = new MouseEvent(tipo, opcoes);
    }
    elemento.dispatchEvent(evento);
  }

  function extrairPropsReact(elemento) {
    // Em apps React, o elemento DOM guarda uma referência às props internas
    // numa chave tipo "__reactProps$xxxxx" (React 17+) ou
    // "__reactEventHandlers$xxxxx" (React 16). É de lá que pegamos a função
    // onClick de verdade, sem depender do sistema de eventos sintéticos.
    const chave = Object.keys(elemento).find(
      (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
    );
    return chave ? elemento[chave] : null;
  }

  function simularCliqueCompleto(elemento) {
    // NOTA: propositalmente NÃO chamamos elemento.focus() aqui. Em modais
    // com "focus trap", forçar foco no botão pode ser redirecionado pelo
    // próprio app para outro campo (ex.: a caixa de observações), deixando
    // o foco preso lá e travando os atalhos seguintes.

    // Estratégia 1: onClick interno do React, subindo até 4 ancestrais
    // (o texto pode estar num <span> dentro do botão real). É o método
    // mais confiável em apps React — chama a função direto, sem depender
    // do navegador "reconhecer" o clique como legítimo.
    let alvo = elemento;
    for (let i = 0; i < 4 && alvo; i++) {
      const props = extrairPropsReact(alvo);
      if (props && typeof props.onClick === 'function') {
        const eventoFalso = {
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          isDefaultPrevented: () => false,
          isPropagationStopped: () => false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() {},
          persist() {},
          target: elemento,
          currentTarget: alvo,
          nativeEvent: new MouseEvent('click', { bubbles: true }),
        };
        console.log('[Atalhos] Clique disparado via onClick interno do React.');
        props.onClick(eventoFalso);
        liberarFocoInvoluntario();
        return;
      }
      alvo = alvo.parentElement;
    }

    // Estratégia 2: onclick "clássico" (atribuído via propriedade, não framework).
    if (typeof elemento.onclick === 'function') {
      console.log('[Atalhos] Clique disparado via elemento.onclick.');
      elemento.onclick(new MouseEvent('click', { bubbles: true, cancelable: true }));
      liberarFocoInvoluntario();
      return;
    }

    // Estratégia 3 (fallback): sequência completa de eventos nativos de mouse.
    console.log('[Atalhos] Clique disparado via sequência de eventos de mouse (fallback).');
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((tipo) => {
      dispararEventoDeMouse(elemento, tipo);
    });
    liberarFocoInvoluntario();
  }

  function liberarFocoInvoluntario() {
    // Se alguma ação acima acabou deixando o foco preso numa caixa de texto
    // (efeito colateral de um "focus trap" no modal, por exemplo), tira o
    // foco de lá — senão o PRÓXIMO atalho se autobloqueia, porque
    // estaDigitando() vai achar que você está digitando de verdade.
    // Seguro fazer isso aqui: só chegamos até este ponto porque
    // estaDigitando() já confirmou, no momento do keydown, que você NÃO
    // estava digitando antes de apertar o atalho.
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.blur();
    }
  }

  /* ---------------------------------------------------------------------
   * 3.1 AÇÕES
   * --------------------------------------------------------------------- */
  function acionarIniciarFila() {
    if (window.filaDebug && typeof window.filaDebug.iniciarFila === 'function') {
      window.filaDebug.iniciarFila();
    } else {
      console.warn('[Atalhos] Módulo de Fila (Módulo 3) não encontrado. Confirme se ele foi colado ANTES deste arquivo.');
    }
  }

  /** @param {{reconstruir?: boolean}} [opcoes] */
  function acionarFilaPorPrioridade(opcoes) {
    if (window.filaPrioridadeDebug && typeof window.filaPrioridadeDebug.iniciar === 'function') {
      window.filaPrioridadeDebug.iniciar(opcoes);
    } else {
      console.warn('[Atalhos] Módulo de Fila por Prioridade (Módulo 7) não encontrado. Confirme se ele foi colado ANTES deste arquivo.');
    }
  }

  function acionarProximoDaFila() {
    if (window.filaDebug && typeof window.filaDebug.irParaProximo === 'function') {
      window.filaDebug.irParaProximo('pulado');
    } else {
      console.warn('[Atalhos] Módulo de Fila (Módulo 3) não encontrado. Confirme se ele foi colado ANTES deste arquivo.');
    }
  }

  function acionarVoltarFila() {
    if (window.filaDebug && typeof window.filaDebug.irParaAnterior === 'function') {
      window.filaDebug.irParaAnterior();
    } else {
      console.warn('[Atalhos] Módulo de Fila (Módulo 3) não encontrado, ou está desatualizado (sem irParaAnterior). Confirme se ele foi colado ANTES deste arquivo.');
    }
  }

  // Abre cada outra razão do grupo com saldo vencido em nova aba -- não
  // gera o relatório sozinho (isso continua sendo Alt+R, manual, em cada
  // aba que abrir), só poupa a busca manual pelo cliente. CONFIRMADO com o
  // usuário: dois relatórios separados, um por página -- sem combinar numa
  // imagem só (isso exigiria mexer no Módulo 1, que não pode ser editado
  // sem confirmação explícita).
  function acionarAbrirGrupoComVencido() {
    const grupo = window.__alertaGrupo;
    if (!grupo || !grupo.empresasComVencido || grupo.empresasComVencido.length === 0) {
      console.warn('[Atalhos] Nenhuma outra razão do grupo com saldo vencido nesta página (ou o Módulo 5 ainda não carregou -- confirme se ele foi colado ANTES deste arquivo).');
      return;
    }
    grupo.empresasComVencido.forEach((empresa) => {
      if (!empresa.url) {
        console.warn(`[Atalhos] Não consegui montar a URL de ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)} -- pulando.`);
        return;
      }
      // Navegador pode bloquear popups além do primeiro fora de um clique
      // direto -- Alt+G é um gesto real do usuário, então isso costuma
      // passar, mas se faltar alguma aba, pode ser o bloqueador de popup.
      window.open(empresa.url, '_blank', 'noopener,noreferrer');
    });
  }

  // Automação pedida pelo usuário: quando o cliente tem outra(s) razão(ões)
  // do grupo com saldo vencido, o Alt+A visita cada uma em aba de fundo,
  // gera o relatório lá e fecha a aba sozinho, antes de continuar com o
  // resto do Alt+A na razão original -- que nunca perde o foco/sai do
  // lugar (por isso "voltar" não precisa de navegação nenhuma aqui).
  //
  // IMPORTANTE sobre bloqueio de popup: todas as abas são abertas de uma
  // vez, de forma síncrona, ainda dentro do gesto do usuário (Alt+A) --
  // mesma tática do Alt+G. Se abríssemos cada aba só depois de esperar a
  // anterior carregar (com await no meio), o navegador não reconheceria
  // mais isso como gesto do usuário e bloquearia como popup. Só a ESPERA
  // pelo botão em cada aba já aberta acontece em sequência.
  async function gerarRelatoriosDasOutrasRazoes() {
    const grupo = window.__alertaGrupo;
    if (!grupo || !grupo.empresasComVencido || grupo.empresasComVencido.length === 0) {
      return;
    }

    const tentativas = grupo.empresasComVencido
      .filter((empresa) => {
        if (!empresa.url) {
          console.warn(`[Atalhos] Não consegui montar a URL de ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)} -- pulando.`);
          return false;
        }
        return true;
      })
      .map((empresa) => ({ empresa, aba: window.open(empresa.url, '_blank') }));

    for (const { empresa, aba } of tentativas) {
      if (!aba) {
        console.warn(`[Atalhos] Não consegui abrir aba para ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)} -- popup bloqueado?`);
        continue;
      }
      try {
        const botao = await esperarElementoVisivelPorTextoNaJanela(
          'button, a[role="button"], [role="button"]',
          CONFIG_ATALHOS.TEXTO_BOTAO_RELATORIO,
          aba,
          CONFIG_ATALHOS.TIMEOUT_CARREGAMENTO_OUTRA_RAZAO_MS,
          CONFIG_ATALHOS.INTERVALO_POLL_OUTRA_RAZAO_MS
        );
        if (botao) {
          simularCliqueCompleto(botao);
          const terminou = await esperarRelatorioProntoNaJanela(
            botao,
            aba,
            CONFIG_ATALHOS.TIMEOUT_AGUARDAR_RELATORIO_PRONTO_MS,
            CONFIG_ATALHOS.INTERVALO_POLL_OUTRA_RAZAO_MS
          );
          if (terminou) {
            console.log(`[Atalhos] Relatório gerado em aba de fundo para ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)}.`);
          } else {
            console.warn(
              `[Atalhos] Não confirmei que o relatório de ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)} terminou de gerar a tempo -- fechando mesmo assim.`
            );
          }
        } else {
          console.warn(
            `[Atalhos] Não encontrei o botão de relatório em ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)} a tempo (aba fechada ou demorou demais) -- fechando mesmo assim.`
          );
        }
      } catch (erro) {
        console.warn(`[Atalhos] Erro gerando relatório em aba de fundo para ${window.__smartTableUtil.apelidoParaLog(empresa.cnpj)}:`, erro);
      } finally {
        try {
          if (!aba.closed) aba.close();
        } catch (erro) {
          // aba pode já ter sido fechada manualmente -- ignora.
        }
      }
    }
  }

  /**
   * Acha o botão de gerar relatório.
   *
   * BUG REAL (intermitente, relatado pelo usuário): a busca era só por
   * TEXTO, e o Módulo 1 troca o rótulo do botão pra "Gerando..." durante a
   * geração. Apertar Alt+A enquanto um relatório anterior ainda rodava não
   * encontrava botão nenhum -- e o relatório novo não saía, sem erro claro.
   * O ID é criado pelo próprio Módulo 1 e não muda.
   *
   * @returns {HTMLElement|null}
   */
  function encontrarBotaoRelatorio() {
    const porId = document.getElementById(CONFIG_ATALHOS.ID_BOTAO_RELATORIO);
    if (porId) return porId;
    return encontrarElementoVisivelPorTexto(
      'button, a[role="button"], [role="button"]',
      CONFIG_ATALHOS.TEXTO_BOTAO_RELATORIO
    );
  }

  /**
   * Dispara a geração do relatório (mesma ação do Alt+R).
   *
   * @returns {HTMLElement|null} O botão acionado, pra quem precisar esperar
   *   a geração terminar (ver acionarAtendimentoRapido).
   */
  function acionarGerarRelatorio() {
    const botao = encontrarBotaoRelatorio();
    if (!botao) {
      console.warn(
        `[Atalhos] Não encontrei o botão de relatório (#${CONFIG_ATALHOS.ID_BOTAO_RELATORIO} ` +
        `nem um botão visível com "${CONFIG_ATALHOS.TEXTO_BOTAO_RELATORIO}" no texto). ` +
        'Confirme se a tabela de títulos carregou nesta página.'
      );
      return null;
    }

    // Já está gerando: clicar de novo não faz nada (o Módulo 1 desabilita o
    // botão) e só confundiria. Devolve mesmo assim, pra quem chamou esperar
    // a geração em curso terminar em vez de seguir por cima dela.
    if (botao.disabled) {
      console.log('[Atalhos] Relatório já está sendo gerado -- aguardando o que já está em andamento.');
      return botao;
    }

    simularCliqueCompleto(botao);
    return botao;
  }

  function acionarAbrirContato() {
    const encontrado = clicarBotaoPorTexto(CONFIG_ATALHOS.TEXTO_BOTAO_CONTATO);
    if (!encontrado) {
      console.warn(
        `[Atalhos] Não encontrei um botão visível com "${CONFIG_ATALHOS.TEXTO_BOTAO_CONTATO}" no texto. ` +
        'Me diga o texto exato do botão/link que abre a tela de contato pra eu ajustar CONFIG_ATALHOS.TEXTO_BOTAO_CONTATO.'
      );
    }
    return encontrado;
  }

  /* ---------------------------------------------------------------------
   * 3.0b MENSAGEM PERSONALIZADA (Alt+A) -- escolha do título e do texto
   * -----------------------------------------------------------------
   * Prioridade de qual título "representa" o cliente na mensagem: MESMA
   * regra que o Módulo 2 já usa pra montar o resumo do CRM -- centralizada
   * no Módulo 0 (window.__smartTableUtil.escolherTituloRepresentativo).
   * Módulo 2 continua com sua própria cópia local (não pode ser editado
   * sem confirmação explícita do usuário), mas todos os outros consumidores
   * dessa regra (este módulo e o Módulo 7) usam a versão compartilhada, pra
   * nota do CRM e mensagem do cliente sempre baterem sobre o mesmo título.
   * --------------------------------------------------------------------- */

  // Datas de vencimento (formato curto, sem duplicatas) dos títulos numa
  // dada situação -- usado só quando o relatório está sendo OMITIDO (ver
  // deveOmitirRelatorio): nesse caso a linha de situação não pode mais
  // dizer "grifado no relatório abaixo", porque nenhum relatório está
  // sendo enviado -- CONFIRMADO com o usuário, volta a citar a data.
  function obterDatasVencimentoPorSituacao(dados, situacaoKey) {
    const datas = dados.registros
      .filter((r) => r.situacaoKey === situacaoKey)
      .sort((a, b) => b.diasAtrasoReal - a.diasAtrasoReal)
      .map((r) => encurtarData(r.vencimentoTexto));
    return [...new Set(datas)];
  }

  // Texto do aviso de suspensão SCPC pra um dado nível de atraso -- extraído
  // pra ser reaproveitado tanto na linha principal (quando NEGATIVADO_SCPC é
  // a situação escolhida) quanto na linha complementar (quando NÃO é a
  // escolhida, mas ainda existe entre os títulos do cliente -- ver
  // obterLinhaNegativadoScpcAdicional).
  function textoAvisoScpc(dias) {
    // CONFIRMADO com o usuário: aviso específico nos últimos dias antes
    // da suspensão de cadastro por SCPC -- fora dessa janela, segue a
    // frase genérica de sempre.
    //
    // REGRA DE NEGÓCIO ALTERADA (v1.36.1, confirmada com o usuário): depois
    // do 19º dia a suspensão do cadastro continua CERTA, mas o cancelamento
    // dos faturamentos é só uma POSSIBILIDADE -- "podem ser cancelados",
    // nunca "deixam de ser faturados". Afirmar como certo o que não é queima
    // o aviso. E "após" (não "a partir do"): o 19º dia ainda é o último dia
    // de pagamento, como a frase do próprio dia 19 já dizia.
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
      return `Lembramos que, após o ${DIAS_ULTIMO_DIA_SUSPENSAO_SCPC}º dia de atraso, o cadastro é suspenso e os faturamentos podem ser cancelados.`;
    }
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
      return 'Hoje é o último dia para pagamento antes que o cadastro seja suspenso e o caso seja encaminhado a um de nossos analistas. Após essa data, os faturamentos podem ser cancelados.';
    }
    return 'Lembramos que a regularização dos débitos negativados no SCPC permite a baixa das restrições.';
  }

  // Prioridade de urgência entre títulos NEGATIVADO_SCPC -- MESMA lógica de
  // escolherTituloRepresentativo (dia 19 exato > janela 16-18 > qualquer
  // outro), usada aqui só pra decidir qual texto usar quando mais de um
  // título negativado sobrou sem ser o escolhido (ver
  // obterLinhaNegativadoScpcAdicional).
  function prioridadeUrgenciaScpc(dias) {
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) return 3;
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) return 2;
    return 1;
  }

  // Linha de contexto por situação -- extraída/adaptada das frases padrão
  // reais do usuário (não escrita do zero). Retorna:
  //   - string vazia: sem linha extra, mensagem segue direto pro fechamento
  //   - string com texto: linha extra
  //   - null: situação não deve gerar mensagem automática (ver chamador)
  function obterLinhaContexto(escolhido, dados, omitirRelatorio) {
    switch (escolhido.situacaoKey) {
      case 'EM_ATRASO':
      case 'PRAZO_FINAL':
        return '';
      case 'ULTIMO_DIA': {
        const destino = dados.fluxo === 'SCPC' ? 'ao SCPC' : 'para cartório';
        // CORRIGIDO (achado real via bateria de cobrança digna): sem
        // "Lembramos que" aqui -- essa frase pode ficar logo atrás da linha
        // de promessa DIA_DA_PROMESSA, que já abre com "Lembramos que...",
        // e duas frases seguidas com a mesma abertura soam repetitivas/
        // robóticas (ver skill cobrança-digna, princípio 3). Sem o prefixo
        // fica igual claro sozinha e nunca duplica quando combinada.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'ULTIMO_DIA');
          const datasTexto = datas.join(', ');
          return datas.length > 1
            ? `Os títulos vencidos em ${datasTexto} estão no prazo final antes de serem encaminhados ${destino}.`
            : `O título vencido em ${datasTexto} está no prazo final antes de ser encaminhado ${destino}.`;
        }
        // Com relatório sendo enviado, basta referenciar a cor -- os
        // títulos em último dia já aparecem grifados em vermelho nele.
        const quantidade = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA').length;
        return quantidade > 1
          ? `Os títulos grifados em vermelho no relatório abaixo estão no prazo final antes de serem encaminhados ${destino}.`
          : `O título grifado em vermelho no relatório abaixo está no prazo final antes de ser encaminhado ${destino}.`;
      }
      case 'NEGATIVADO_SCPC':
        return textoAvisoScpc(escolhido.diasAtrasoReal);
      case 'EM_CARTORIO': {
        // CONFIRMADO com o usuário: referenciar a cor (amarelo) em vez de só
        // "aparecem destacados" -- e essa linha continua junto de qualquer
        // outra (ex.: "retomando o contato de ontem"), nunca é removida por
        // causa delas -- ver montarMensagemPersonalizada, que empilha cada
        // linha de forma independente.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'EM_CARTORIO');
          return `Os títulos vencidos em ${datas.join(', ')} já estão em cartório -- o pagamento do restante ainda é possível via boleto.`;
        }
        return 'Os títulos grifados em amarelo no relatório abaixo já estão em cartório -- o pagamento do restante ainda é possível via boleto.';
      }
      default:
        // VERIFICAR_POSICAO (ou qualquer situação nova/desconhecida): situação
        // incerta demais pra afirmar algo pro cliente -- decisão do usuário foi
        // não gerar mensagem automática nesse caso, não inventar texto.
        return null;
    }
  }

  // BUG REAL (relatado pelo usuário): cliente com títulos em MAIS de uma
  // situação ao mesmo tempo (ex.: um em ULTIMO_DIA + outro já EM_CARTORIO)
  // recebia uma mensagem que só falava do título escolhido como
  // representante (ULTIMO_DIA sempre vence -- ver escolherTituloRepresentativo
  // no Módulo 0) -- os títulos já em cartório apareciam grifados em amarelo
  // no relatório, mas a mensagem nunca explicava esse destaque, porque
  // obterLinhaContexto só descreve UMA situação por vez. Esta função cobre
  // o caso em que EM_CARTORIO não é a situação escolhida mas ainda assim
  // está presente entre os títulos do cliente -- complementa linhaContexto
  // em vez de substituí-la (ver montarMensagemPersonalizada).
  function obterLinhaEmCartorioAdicional(escolhido, dados, omitirRelatorio) {
    if (escolhido.situacaoKey === 'EM_CARTORIO') return ''; // já coberto pela linha principal

    const emCartorio = dados.registros.filter((r) => r.situacaoKey === 'EM_CARTORIO');
    if (emCartorio.length === 0) return '';

    if (omitirRelatorio) {
      const datas = obterDatasVencimentoPorSituacao(dados, 'EM_CARTORIO');
      const datasTexto = datas.join(', ');
      return datas.length > 1
        ? `Os títulos vencidos em ${datasTexto} também já estão em cartório -- o pagamento do restante ainda é possível via boleto.`
        : `O título vencido em ${datasTexto} também já está em cartório -- o pagamento do restante ainda é possível via boleto.`;
    }

    return emCartorio.length > 1
      ? 'Os títulos grifados em amarelo no relatório abaixo também já estão em cartório -- o pagamento do restante ainda é possível via boleto.'
      : 'O título grifado em amarelo no relatório abaixo também já está em cartório -- o pagamento do restante ainda é possível via boleto.';
  }

  // MESMA CLASSE DE BUG do EM_CARTORIO acima, achada ao auditar
  // sistematicamente outras combinações de situações simultâneas (pedido do
  // usuário, depois do bug real relatado): cliente com título em ULTIMO_DIA
  // (ou outra situação de maior atraso) escolhido como representante, e
  // OUTRO título já NEGATIVADO_SCPC -- inclusive no último dia antes da
  // suspensão de cadastro (dia 19) -- tinha esse aviso inteiramente
  // omitido, mesmo com o título aparecendo destacado (índigo) no relatório.
  function obterLinhaNegativadoScpcAdicional(escolhido, dados) {
    if (escolhido.situacaoKey === 'NEGATIVADO_SCPC') return ''; // já coberto pela linha principal

    const negativados = dados.registros.filter((r) => r.situacaoKey === 'NEGATIVADO_SCPC');
    if (negativados.length === 0) return '';

    // Entre os títulos negativados que sobraram, o mais urgente decide o
    // texto (dia 19 exato > janela 16-18 > qualquer outro).
    const maisUrgente = negativados.reduce((a, b) => {
      const pa = prioridadeUrgenciaScpc(a.diasAtrasoReal);
      const pb = prioridadeUrgenciaScpc(b.diasAtrasoReal);
      if (pb !== pa) return pb > pa ? b : a;
      return b.diasAtrasoReal > a.diasAtrasoReal ? b : a;
    });
    return textoAvisoScpc(maisUrgente.diasAtrasoReal);
  }

  /* ---------------------------------------------------------------------
   * 2b. VARIANTES DE FRASE (rotação por cliente + dia)
   * -----------------------------------------------------------------
   * Cada lista tem variantes do MESMO papel, com a MESMA firmeza e o MESMO
   * pedido. Trocar entre elas nunca pode mudar o estágio da cobrança: um
   * CTA de último dia jamais vira um CTA leve.
   *
   * A escolha é determinística por (cnpj, dia) -- ver escolherVariante no
   * Módulo 0 e o porquê de não ser sorteio.
   *
   * SELECIONADAS PELO USUÁRIO, uma a uma. Não acrescente frase aqui por
   * conta própria: cada uma dessas passou pelo crivo de quem fala com o
   * cliente do outro lado.
   * --------------------------------------------------------------------- */
  const FRASES = Object.freeze({
    // EM_ATRASO / PRAZO_FINAL, sem promessa ativa. Era 83% de todas as
    // mensagens numa frase só.
    ctaGenerico: Object.freeze([
      'Podemos agendar para hoje o pagamento do débito em aberto?',
      'Consegue regularizar ainda hoje?',
      // A única pergunta ABERTA do conjunto: não se responde com sim ou não,
      // e é a que mais puxa retorno de quem estava sumindo.
      'Como podemos resolver isso hoje?',
      'Consegue me confirmar se dá para acertar hoje?',
    ]),

    ctaUltimoDia: Object.freeze([
      'Consegue regularizar hoje para evitarmos o encaminhamento?',
      'Conseguimos quitar isso hoje antes que o título siga para o encaminhamento?',
      'Consegue acertar hoje para o título não seguir para encaminhamento?',
    ]),

    // EM_CARTORIO: fato já consumado. Toda variante nomeia o caminho de
    // volta, e nenhuma promete o que não se controla.
    ctaCartorio: Object.freeze([
      'Consegue regularizar hoje para eu confirmar a baixa da restrição?',
      'Assim que o pagamento for confirmado, sinalizo em nosso sistema. Consegue regularizar hoje?',
      'Consegue fechar isso hoje? Confirmado o pagamento, já sinalizo a baixa.',
    ]),

    // SCPC 16 a 18 dias: a suspensão ainda NÃO é hoje.
    //
    // CORRIGIDO ANTES DE ENTRAR: a variante proposta dizia "sem a
    // identificação do pagamento ATÉ O FIM DO DIA o cadastro é suspenso".
    // Isso é falso nos dias 16 e 17 -- o cliente tem até o 19º. Dizer um
    // prazo que não se cumpre queima o aviso: na próxima vez ele já sabe que
    // não acontece nada. A frase com prazo cravado foi movida pro dia 19,
    // onde é literalmente verdade.
    ctaSuspensaoScpc: Object.freeze([
      'Consegue regularizar hoje para evitarmos a suspensão do cadastro?',
      'A suspensão do cadastro é automática se o pagamento não for identificado. Consegue resolver hoje?',
      'Regularizando hoje, o cadastro segue ativo normalmente. Conseguimos agendar?',
    ]),

    // SCPC exatamente no 19º dia -- aqui o prazo é real.
    ctaUltimoDiaScpc: Object.freeze([
      'Consegue regularizar hoje, o último dia antes da suspensão?',
      'Sem a identificação do pagamento até o fim do dia o cadastro é suspenso automaticamente. Consegue resolver hoje?',
    ]),

    // Retomada de contato.
    //
    // A primeira AFIRMA que o cliente não retornou, e isso fica errado
    // quando ele respondeu e só não pagou -- são coisas diferentes. Ela
    // continua na rotação por decisão do usuário; as outras duas não fazem
    // nenhuma afirmação sobre o que o cliente fez.
    retomada: Object.freeze([
      'Retomando o contato de {{referencia}}, já que ainda não obtivemos retorno.',
      'Voltando aqui sobre o contato de {{referencia}}.',
      'Dando sequência ao contato de {{referencia}}.',
    ]),
  });

  /**
   * Semente da rotação: o cliente da página e o dia de hoje.
   *
   * Sem cnpj (página fora do padrão), cai numa semente só do dia -- todos os
   * clientes recebem a mesma variante naquele dia, o que ainda é melhor que
   * a frase única de sempre, e nunca estoura.
   *
   * @returns {string}
   */
  let jaAvisouSementeSemCnpj = false;
  function sementeDaFrase() {
    let cnpj = '';
    try {
      cnpj = new URLSearchParams(location.search).get('cnpj') || '';
    } catch (erro) {
      cnpj = '';
    }

    // AVISA em vez de degradar calado: sem cnpj a semente vira só o dia, e
    // TODOS os clientes passam a receber a mesma variante naquele dia. A
    // mensagem continua correta, então nada quebra na tela -- e é justamente
    // por isso que precisa aparecer no console, senão a rotação morre sem
    // ninguém notar no dia em que o CRM renomear o parâmetro da URL.
    if (!cnpj && !jaAvisouSementeSemCnpj) {
      jaAvisouSementeSemCnpj = true;
      console.warn(
        '[Atalhos] Não achei o cnpj na URL pra variar as frases. Todas as mensagens de hoje vão usar ' +
        'a mesma variante. As frases seguem corretas -- só param de alternar entre clientes.'
      );
    }

    const util = window.__smartTableUtil;
    const dia = util && typeof util.dataIso === 'function' ? util.dataIso(new Date()) : '';
    return `${cnpj}|${dia}`;
  }

  /**
   * @param {string[]} variantes Uma das listas de FRASES.
   * @returns {string}
   */
  function frase(variantes) {
    const util = window.__smartTableUtil;
    if (!util || typeof util.escolherVariante !== 'function') return variantes[0];
    return util.escolherVariante(sementeDaFrase(), variantes);
  }

  // CONFIRMADO com o usuário: a pergunta final não deve ser sempre a
  // mesma ("podemos agendar...") -- perto do encaminhamento (último dia)
  // ou já negativado/em cartório, o CTA pode ser mais específico e
  // urgente, sem virar ameaça: só nomeia a consequência real (evitar o
  // encaminhamento, confirmar a baixa da restrição, evitar a suspensão).
  function obterPerguntaFinal(escolhido) {
    switch (escolhido.situacaoKey) {
      case 'ULTIMO_DIA':
        return frase(FRASES.ctaUltimoDia);
      case 'EM_CARTORIO':
        return frase(FRASES.ctaCartorio);
      case 'NEGATIVADO_SCPC': {
        const dias = escolhido.diasAtrasoReal;
        if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
          return frase(FRASES.ctaSuspensaoScpc);
        }
        if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
          return frase(FRASES.ctaUltimoDiaScpc);
        }
        return frase(FRASES.ctaCartorio);
      }
      default: // EM_ATRASO, PRAZO_FINAL -- estágio inicial, sem pressão
        return obterPerguntaFinalConsiderandoPromessa();
    }
  }

  /**
   * Pergunta final do estágio inicial (EM_ATRASO/PRAZO_FINAL), levando em
   * conta a promessa ativa.
   *
   * BUG REAL (relatado pelo usuário): a pergunta olhava SÓ a situação do
   * título e ignorava a promessa. Cliente que combinou pagar HOJE recebia
   * "Lembramos que hoje é o dia combinado para o pagamento do título X."
   * e, três linhas abaixo, "Podemos agendar para hoje o pagamento do débito
   * em aberto?" -- pedindo pra agendar o que já estava agendado. A promessa
   * é o compromisso mais recente e mais específico, então é ela que decide o
   * pedido final.
   *
   * Só troca a pergunta GENÉRICA. As perguntas de ULTIMO_DIA, EM_CARTORIO e
   * NEGATIVADO_SCPC continuam valendo mesmo com promessa ativa: elas nomeiam
   * uma consequência real e pedem AÇÃO ("consegue regularizar hoje"), não
   * agendamento -- não há contradição com ter prometido pagar hoje.
   *
   * QUEBRADA não passa por aqui: a linha dela já termina em pergunta ("Já
   * foi realizado?..."), então nenhuma pergunta final é acrescentada.
   *
   * @returns {string}
   */
  function obterPerguntaFinalConsiderandoPromessa() {
    const tipo = window.__contextoAdicional?.promessa?.tipo;

    // CONFIRMADO com o usuário: presume boa-fé -- trata o pagamento como algo
    // que vai acontecer, não como algo a renegociar -- e o comprovante é o
    // que fecha o ciclo (é ele que permite dar baixa).
    if (tipo === 'DIA_DA_PROMESSA') return 'Assim que efetuar, pode me enviar o comprovante?';

    // CONFIRMADO com o usuário: reconhece implicitamente que já houve
    // pagamento, em vez de falar do débito como se nada tivesse sido pago.
    if (tipo === 'PARCIAL') return 'Consegue quitar o restante hoje?';

    return frase(FRASES.ctaGenerico);
  }

  /* ---------------------------------------------------------------------
   * 3.0c LINHAS DE CONTEXTO ADICIONAL (Módulo 6) -- promessa e contato
   * -----------------------------------------------------------------
   * Lê window.__contextoAdicional (calculado pelo Módulo 6 já no carregamento
   * da página, sem custo extra aqui). Se o Módulo 6 não estiver carregado ou
   * não achar nada relevante, essas funções devolvem string vazia -- a
   * mensagem segue normal, só sem essas linhas extras.
   * --------------------------------------------------------------------- */
  // CONFIRMADO com o usuário: diferente do caso de zero contatos (que vira
  // uma mensagem só de identificação, sem relatório -- ver semContatoAnterior
  // em montarMensagemPersonalizada), aqui o cliente TEM contato registrado.
  // Mensagem continua normal (relatório, situação, promessa), só ganha essa
  // linha a mais logo após a saudação -- sem a pergunta de confirmação de
  // responsável, já que já houve contato antes.
  //
  // DOIS motivos levam à mesma linha, e CONFIRMADO com o usuário que "as
  // duas devem coexistir":
  //   - contatoAntigo: já falamos com o cliente, mas faz tanto tempo
  //     (anterior à data de corte, Módulo 6) que ele não deve lembrar.
  //   - nuncaContatadoPorMim (PEDIDO DO USUÁRIO): o cliente já foi contatado
  //     por OUTRO negociador, mas nunca por este -- do lado dele é a
  //     primeira vez que esta pessoa fala com ele, então cabe se apresentar.

  // Nome usado quando o Módulo 6 não está carregado (a mensagem continua
  // saindo, só sem saber quem está logado). Com ele carregado, o nome vem
  // de ctx.nomeNegociador, derivado do usuário logado no CRM.
  const NOME_NEGOCIADOR_PADRAO = 'Isaac';

  // PEDIDO DO USUÁRIO: o nome sai do negociador logado, não mais fixo no
  // código -- CONFIRMADO que a parte antes do ponto no código do CRM é o
  // primeiro nome ("BIANCA.03665" -> "Bianca").
  //
  // Sem artigo antes do nome ("Sou Isaac", não "Sou o Isaac") de propósito:
  // o artigo depende do gênero da pessoa, que o código não tem como saber a
  // partir do nome -- "Sou o Bianca" sairia errado. Sem artigo funciona pra
  // qualquer nome.
  function montarApresentacao() {
    const nome = window.__contextoAdicional?.nomeNegociador || NOME_NEGOCIADOR_PADRAO;
    return `Sou ${nome}, do financeiro da Tex Cotton (Animê, Bimbi, Youccie, Authoria e Momi).`;
  }

  function obterLinhaApresentacao() {
    const ctx = window.__contextoAdicional;
    if (!ctx) return '';
    if (!ctx.contatoAntigo && !ctx.nuncaContatadoPorMim) return '';
    return montarApresentacao();
  }

  // CONFIRMADO com o usuário (substituiu a linha "Notamos que a empresa
  // X..." de uma versão anterior, que ficava ruim na mensagem): quando há
  // outra razão do grupo com saldo vencido, a frase do relatório fala "de
  // cada razão social" em vez de citar nome/valor específico. Lê
  // window.__alertaGrupo (Módulo 5) -- precisa dele carregado ANTES deste
  // arquivo.
  function temOutraRazaoComVencido() {
    const grupo = window.__alertaGrupo;
    return !!(grupo && grupo.empresasComVencido && grupo.empresasComVencido.length > 0);
  }

  function obterLinhaContatoRecente() {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente) return '';

    // CONFIRMADO com o usuário (bug real, 2 rodadas): "ainda não obtivemos
    // retorno" fica errado sempre que o último contato resultou numa
    // promessa -- independente do status ATUAL dela. ctx.promessa só cobre
    // promessa ainda ativa (pendente/quebrada/parcial); se a promessa do
    // último contato já foi paga/resolvida, ctx.promessa vem null mas o
    // cliente CONTINUA tendo retornado naquele contato -- daí
    // houvePromessaNoUltimoContato (Módulo 6), que checa qualquer promessa
    // datada pro mesmo dia do último contato, sem olhar status.
    // CORRIGIDO (mesma lógica, achado ao implementar o agradecimento de
    // pagamento): um título que sumiu desde a última visita (pago sem
    // nenhuma promessa associada) também É retorno do cliente -- dizer
    // "ainda não obtivemos retorno" bem ao lado de um agradecimento de
    // pagamento seria contraditório na mesma mensagem.
    if (ctx.promessa || ctx.houvePromessaNoUltimoContato || ctx.houveTituloPagoDesdeUltimaVisita) return '';

    // BUG REAL (achado na revisão de código, CONFIRMADO com o usuário):
    // quando OUTRO negociador falou com o cliente ontem e eu nunca falei, a
    // mensagem saía se apresentando ("Sou o Isaac do financeiro...") E
    // dizendo "Retomando o contato de ontem" ao mesmo tempo -- me apresento
    // como se fosse a primeira vez e cobro continuidade de uma conversa que
    // não foi minha, na mesma mensagem. Decisão do usuário: nesse caso vale
    // a apresentação, e o contato de ontem (de outra pessoa) não é citado.
    //
    // Isso NÃO acontecia antes de nuncaContatadoPorMim existir porque
    // contatoAntigo (contato mais recente ANTES da data de corte) e
    // contatoRecente (contato mais recente ONTEM) são mutuamente
    // exclusivos por construção -- a flag nova é ortogonal à data, então
    // precisa desta exclusão explícita.
    if (ctx.nuncaContatadoPorMim) return '';

    // REVERTIDO (confirmado com o usuário): a variação de 3 níveis puxava
    // datas velhas demais, sem relação com a cobrança atual -- volta a
    // valer só quando o contato mais recente foi EXATAMENTE o dia útil
    // anterior (garantido pelo Módulo 6 agora -- se não for, contatoRecente
    // nem vem preenchido). "Ontem" só quando é literalmente verdade (dia
    // útil anterior = dia de calendário anterior); senão, nome do dia da
    // semana (ex.: hoje é segunda, contato foi sexta).
    const { ehOntemLiteral, diaSemanaTexto } = ctx.contatoRecente;
    const referencia = ehOntemLiteral ? 'ontem' : diaSemanaTexto;
    return frase(FRASES.retomada).replace('{{referencia}}', referencia);
  }

  // NOVO (achado da revisão contra a skill cobrança-digna: reconhecer o
  // pagamento antes de cobrar o resto gera mais cooperação -- princípio de
  // reciprocidade -- do que só mandar a lista atualizada sem comentário).
  // Só agradece dentro da MESMA janela que o resto do recontato já usa --
  // contato mais recente exatamente no dia útil anterior (ctx.contatoRecente
  // só vem preenchido nesse caso, ver Módulo 6) -- pra não abrir uma janela
  // de tempo nova e inconsistente com o resto da régua.
  // Fica de fora quando há promessa ativa (ctx.promessa) porque a própria
  // linha de promessa (QUEBRADA/PARCIAL/DIA_DA_PROMESSA) já comenta o
  // pagamento daquele título -- agradecer de novo aqui duplicaria o assunto
  // e deixaria a mensagem maior do que precisa.
  function obterLinhaAgradecimentoPagamento(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.houveTituloPagoDesdeUltimaVisita) return '';
    if (ctx.promessa) return '';

    // Nunca agradece a baixa de um título que continua aberto nos dados ao
    // vivo (o mesmo relatório que vai junto). O retrato do Módulo 6 é
    // comparado no carregamento da página; se naquele instante a tabela
    // ainda não tinha as linhas, títulos abertos pareciam "sumidos".
    const informados = ctx.titulosPagosDesdeUltimaVisita || [];
    const abertos = new Set((dados?.registros || []).map((r) => r.tituloCompleto));
    const titulos = informados.filter((t) => !abertos.has(t));
    if (informados.length > 0 && titulos.length === 0) return '';
    if (titulos.length === 0) return 'Recebemos a baixa de um dos títulos em aberto, obrigado!';
    const titulosTexto = titulos.join(', ');
    return titulos.length > 1
      ? `Recebemos a baixa dos títulos ${titulosTexto}, obrigado!`
      : `Recebemos a baixa do título ${titulosTexto}, obrigado!`;
  }

  /**
   * Converte "dd/mm/aaaa" para Date, na MESMA convenção de horário que todo
   * o resto do sistema (meio-dia, via normalizarData do Módulo 0).
   *
   * BUG REAL (achado em revisão): esta função construía a data à MEIA-NOITE
   * enquanto o Módulo 6 normaliza contatoRecente.data ao MEIO-DIA. As 12h de
   * diferença anulavam silenciosamente a correção do ">=" em
   * deveOmitirRelatorio -- um título vencido EXATAMENTE na data do último
   * contato comparava 00:00 >= 12:00 (false) e deixava de contar como
   * título novo, omitindo o relatório justo no dia em que apareceu dívida
   * nova. É exatamente o risco que o cabeçalho do Módulo 0 documenta
   * ("nunca meia-noite, sob risco de comparações inconsistentes entre
   * módulos").
   *
   * @param {string} texto Data no formato "dd/mm/aaaa".
   * @returns {Date|null} Data ao meio-dia, ou null se o texto não bater no formato.
   */
  function converterDataBrParaDate(texto) {
    const m = (texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return normalizarData(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }

  // CONFIRMADO com o usuário (bug real): recontato em dias seguidos sem
  // nenhum título NOVO ter vencido desde o último contato não deve
  // reenviar o relatório -- o cliente já viu a mesma informação. Compara
  // a data de vencimento de cada título com a data do contato mais
  // recente (só disponível quando o contato foi no dia útil anterior --
  // ver calcularContextoContato no Módulo 6).
  function deveOmitirRelatorio(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.contatoRecente.data) return false;

    // CONFIRMADO com o usuário: título que SUMIU da lista desde a última
    // visita (bem provavelmente pago) também é informação nova -- não só
    // título que apareceu. houveTituloPagoDesdeUltimaVisita vem do Módulo
    // 6 (retrato salvo no localStorage, por CNPJ -- não há como ler a
    // data de pagamento direto do CRM sem trocar o filtro visível da
    // tabela).
    if (ctx.houveTituloPagoDesdeUltimaVisita) return false;

    // MELHORIA (confirmada pelo usuário): se o contato de ontem já foi,
    // ele próprio, um recontato (o relatório provavelmente já tinha sido
    // omitido ontem também -- ver recontatoConsecutivo no Módulo 6), hoje
    // não repete a omissão por 2+ dias seguidos -- volta a enviar o
    // relatório atualizado, mesmo sem título novo.
    if (ctx.contatoRecente.recontatoConsecutivo) return false;

    const dataUltimoContato = ctx.contatoRecente.data;
    // CORREÇÃO (bug real, confirmado pelo usuário): comparação era ">" --
    // um título só entra em "registros" a partir de 1 dia de atraso (ver
    // DIAS_ATRASO_MIN no Módulo 1), ou seja, um título com vencimento
    // IGUAL à data do último contato ainda não estava atrasado (e por
    // isso não aparecia) NAQUELE dia -- só passou a aparecer no dia
    // seguinte. ">" tratava esse caso como "não é novo" por engano, por
    // vencimento e contato caírem na mesma data. ">=" reconhece
    // corretamente como novo.
    const temTituloNovo = dados.registros.some((r) => {
      const vencimento = converterDataBrParaDate(r.vencimentoTexto);
      return vencimento && vencimento.getTime() >= dataUltimoContato.getTime();
    });
    return !temTituloNovo;
  }

  // Concorda "do/dos" ou "ao/aos" + "título/títulos" com a quantidade real,
  // em vez do "(s)" genérico (ex.: "do(s) título(s)") que ficava estranho
  // tanto no singular quanto no plural.
  const FORMAS_CONCORDANCIA_TITULO = Object.freeze({
    do: ['do título', 'dos títulos'],
    ao: ['ao título', 'aos títulos'],
  });

  /**
   * Concorda preposição + "título" com a quantidade real, em vez do "(s)"
   * genérico (ex.: "do(s) título(s)"), que ficava estranho nos dois números.
   *
   * Preposição desconhecida devolve uma forma neutra em vez de estourar --
   * antes, `const [a, b] = formas[preposicao]` lançava TypeError e derrubava
   * a montagem da mensagem inteira na primeira frase nova que usasse outra
   * preposição.
   *
   * @param {'do'|'ao'} preposicao
   * @param {number} quantidade
   * @returns {string}
   */
  function concordarTitulos(preposicao, quantidade) {
    const formas = FORMAS_CONCORDANCIA_TITULO[preposicao];
    if (!formas) {
      console.warn(`[Atalhos] Preposição "${preposicao}" não tem forma de concordância definida -- usando forma neutra.`);
      return pluralizarTitulo(quantidade);
    }
    const [singular, plural] = formas;
    return quantidade === 1 ? singular : plural;
  }

  function pluralizarTitulo(quantidade) {
    return quantidade === 1 ? 'título' : 'títulos';
  }

  function obterLinhaPromessa() {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.promessa) return '';

    const { tipo, promessa } = ctx.promessa;
    const titulosTexto = promessa.titulos.join(', ');

    switch (tipo) {
      case 'DIA_DA_PROMESSA':
        return `Lembramos que hoje é o dia combinado para o pagamento ${concordarTitulos('do', promessa.titulos.length)} ${titulosTexto}.`;
      case 'QUEBRADA':
        return (
          `Notamos que o pagamento combinado para ${encurtarData(promessa.dataPrometidaTexto)}, referente ${concordarTitulos('ao', promessa.titulos.length)} ` +
          `${titulosTexto}, não foi identificado. Já foi realizado? Se sim, pode nos enviar o comprovante para conferência.`
        );
      case 'PARCIAL': {
        const pendentes =
          typeof ctx.calcularTitulosPendentes === 'function'
            ? ctx.calcularTitulosPendentes(promessa.titulos)
            : promessa.titulos;
        // Ajuste B (aprovado pelo usuário, v1.37.0): sem repetir os números
        // dos títulos -- eles já estão no relatório. Só a quantidade.
        const restante = pendentes.length === 0
          ? 'os títulos combinados já foram regularizados'
          : `ainda ${pendentes.length === 1 ? 'resta 1 título' : `restam ${pendentes.length} títulos`} em aberto`;
        return `Identificamos o pagamento parcial do combinado para ${encurtarData(promessa.dataPrometidaTexto)}; ${restante}.`;
      }
      default:
        return '';
    }
  }

  /**
   * Mensagem de primeiro contato: cliente sem NENHUM registro na aba
   * Contatos. Só se identifica e confirma o responsável -- relatório,
   * situação do título e promessa não fazem sentido antes desse passo.
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string} Mensagem pronta, com as variáveis já substituídas.
   */
  /**
   * Junta, numa frase só, tudo que descreve a SITUAÇÃO dos títulos: a linha
   * do título representativo mais as complementares de cartório e SCPC,
   * quando esses títulos existem sem ter sido o escolhido.
   *
   * @returns {string|null} Frase montada, ou null quando a situação do
   *   título escolhido não deve gerar mensagem automática.
   */
  function montarLinhaSituacao(escolhido, dados, omitirRelatorio) {
    const linhaContexto = obterLinhaContexto(escolhido, dados, omitirRelatorio);
    if (linhaContexto === null) return null;

    // Complementam (não substituem) a linha principal -- ver
    // obterLinhaEmCartorioAdicional e obterLinhaNegativadoScpcAdicional.
    const frases = [
      linhaContexto,
      obterLinhaEmCartorioAdicional(escolhido, dados, omitirRelatorio),
      obterLinhaNegativadoScpcAdicional(escolhido, dados),
    ].filter(Boolean);
    // Mesmo ajuste D da legenda (montarLegendaRelatorio): somado a outras
    // situações, o aviso do 19º dia vai na versão curta.
    const aviso19 = textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC);
    return (frases.length > 1 ? frases.map((f) => (f === aviso19 ? AVISO_ULTIMO_DIA_SCPC_CURTO : f)) : frases).join(' ');
  }

  /**
   * Bloco de contexto da conversa (apresentação, agradecimento de pagamento,
   * retomada de contato e promessa), uma linha por assunto. Cada função
   * decide sozinha se tem algo a dizer; aqui só empilhamos o que sobrou.
   *
   * @returns {string} Linhas separadas por quebra simples, ou string vazia.
   */
  function montarBlocoContexto(dados) {
    return [
      obterLinhaApresentacao(),
      obterLinhaAgradecimentoPagamento(dados),
      obterLinhaContatoRecente(),
      obterLinhaPromessa(),
    ]
      .filter(Boolean)
      .join('\n');
  }

  // CONFIRMADO com o usuário: com 2+ razões com saldo vencido, a frase fala
  // de "cada razão social" em vez de citar a específica -- e é frase fechada,
  // não um lead-in com ":" pra uma linha só.
  function montarLinhaRelatorio() {
    return temOutraRazaoComVencido()
      ? 'Segue o relatório atualizado com os débitos em aberto de cada razão social.'
      : 'Segue o relatório atualizado da razão social {{cliente_nome}}.';
  }

  /**
   * O que as cores do relatório significam, numa frase só.
   *
   * PEDIDO DO USUÁRIO (v1.37.0, "algumas cobranças ficam muito extensas e
   * muitas mensagens"): antes, cada estágio tinha a sua frase inteira ("O
   * título grifado em vermelho no relatório abaixo está...", "O título
   * grifado em amarelo no relatório abaixo também já está..."), num balão
   * próprio depois da imagem. Agora elas vão juntas, resumidas, na legenda
   * da própria imagem -- ver montarLegendaRelatorio.
   *
   * @returns {string} Frase pronta, ou '' quando nenhum título tem cor.
   */
  function descreverCoresDoRelatorio(dados) {
    const noUltimoDia = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA').length;
    const emCartorio = dados.registros.some((r) => r.situacaoKey === 'EM_CARTORIO');
    const destino = dados.fluxo === 'SCPC' ? 'do SCPC' : 'do cartório';
    const vermelho = `${noUltimoDia > 1 ? 'os títulos' : 'o título'} no prazo final antes ${destino}`;
    const amarelo = 'o que já está em cartório (o restante ainda pode ser pago via boleto)';

    if (noUltimoDia && emCartorio) return `Em vermelho, ${vermelho}; em amarelo, ${amarelo}.`;
    if (noUltimoDia) return `Em vermelho, ${vermelho}.`;
    if (emCartorio) return `Em amarelo, ${amarelo}.`;
    return '';
  }

  /**
   * Legenda da imagem do relatório: "Segue o relatório..." + o que as cores
   * significam + o aviso SCPC, quando houver. Um balão só, colado na legenda
   * da imagem no WhatsApp (pedido do usuário, v1.37.0).
   */
  function montarLegendaRelatorio(escolhido, dados) {
    const cores = descreverCoresDoRelatorio(dados);
    let avisoScpc = escolhido.situacaoKey === 'NEGATIVADO_SCPC'
      ? textoAvisoScpc(escolhido.diasAtrasoReal)
      : obterLinhaNegativadoScpcAdicional(escolhido, dados);
    // Ajuste D (aprovado pelo usuário, v1.37.0): o aviso do 19º dia tem 175
    // caracteres. Sozinho ele cabe; somado às cores de outros títulos, a
    // legenda passava de 8 linhas no celular. Nesse caso vai a versão
    // curta, com o mesmo conteúdo: último dia, suspensão certa,
    // cancelamento dos faturamentos só possível.
    if (cores && avisoScpc === textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC)) avisoScpc = AVISO_ULTIMO_DIA_SCPC_CURTO;
    // Uma ideia por linha: no celular, três linhas curtas leem melhor que
    // um parágrafo corrido.
    return [montarLinhaRelatorio(), cores, avisoScpc].filter(Boolean).join('\n');
  }

  const AVISO_ULTIMO_DIA_SCPC_CURTO =
    'Hoje é o último dia antes da suspensão do cadastro; depois dela, os faturamentos podem ser cancelados.';

  /**
   * Decide se a pergunta final entra na mensagem.
   *
   * BUG REAL achado via teste combinatório: a versão antiga usava
   * `!omitirRelatorio || !temConteudoAcionavel`, e por isso a pergunta sumia
   * sempre que o relatório era omitido E havia linha de contexto -- ou seja,
   * justamente nas situações mais graves (ULTIMO_DIA, EM_CARTORIO,
   * NEGATIVADO_SCPC), cuja linha nunca é vazia. A mensagem virava um aviso
   * solto, sem nenhum pedido de ação. O critério certo não é "já existe
   * conteúdo", é "esse conteúdo já pede alguma coisa" -- só a promessa
   * QUEBRADA embute isso ("Já foi realizado?...").
   */
  function precisaDePerguntaFinal(linhaSituacao, blocoContexto) {
    return !/\?/.test(linhaSituacao) && !/\?/.test(blocoContexto);
  }

  /**
   * Decide se o relatório entra, respeitando a omissão por recontato.
   *
   * CORRIGIDO (bateria de cobrança digna): blocoContexto e linhaSituacao
   * podem ficar os dois vazios ao mesmo tempo (ex.: EM_ATRASO + recontato sem
   * título novo + sem promessa ativa + promessa do último contato já
   * resolvida). Sem relatório e sem nenhuma dessas linhas, sobrava só
   * saudação + pergunta genérica, sem citar título, valor nem situação -- o
   * cliente não tinha como saber do que se tratava. Nesse caso o relatório
   * volta, mesmo com omitirRelatorio=true: é a única âncora que resta.
   */
  //
  // CORRIGIDO (v1.46.4, revisor-de-mensagens, APROVADO pelo usuário: "Pode
  // ajustar"): a âncora é o que fala da DÍVIDA -- a apresentação ("Sou
  // Isaac, do financeiro...") diz quem fala, não do que se trata. Com ela
  // contando, o cliente que eu nunca contatei, recontatado sem título novo,
  // recebia só apresentação + "Podemos agendar...?", sem título, valor nem
  // relatório. A linha de recontato ("Dando sequência ao contato de
  // ontem.") CONTINUA contando: ela é o que permite omitir o relatório no
  // recontato, como o usuário pediu -- tirá-la faria o relatório voltar em
  // todo recontato (testado).
  function precisaDoRelatorio(omitirRelatorio, linhaSituacao, blocoSobreADivida) {
    const semNenhumaAncora = !blocoSobreADivida && !linhaSituacao;
    return !omitirRelatorio || semNenhumaAncora;
  }

  /** O bloco de contexto sem a apresentação (só o que fala da dívida/do contato). */
  function montarBlocoSobreADivida(dados) {
    return [obterLinhaAgradecimentoPagamento(dados), obterLinhaContatoRecente(), obterLinhaPromessa()]
      .filter(Boolean)
      .join('\n');
  }

  const MARCADOR_IMAGEM_RELATORIO = '__IMAGEM_RELATORIO__';

  /**
   * A mesma mensagem como texto corrido: os balões separados por linha em
   * branco, sem o marcador da imagem.
   *
   * Até a v1.36 esta era uma SEGUNDA montagem, paralela à das partes, e um
   * teste inteiro (partes-mensagem) existia só pra vigiar que as duas não
   * divergissem. Agora é derivada das partes: divergir deixou de ser
   * possível.
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string|null}
   */
  function montarMensagemPersonalizada(dados) {
    const partes = montarPartesMensagemPersonalizada(dados);
    return partes ? partes.filter((p) => p !== MARCADOR_IMAGEM_RELATORIO).join('\n\n') : null;
  }

  /**
   * Mesma mensagem de montarMensagemPersonalizada, mas como LISTA DE PARTES
   * -- uma por balão do WhatsApp, em vez de um parágrafo só. PEDIDO DO
   * USUÁRIO (o WhatsApp cola tudo como bloco único; repartir na mão era o
   * trabalho manual que sobrava depois que o resto do fluxo já foi
   * automatizado). Reaproveita as MESMAS funções de linha que
   * montarMensagemPersonalizada -- nenhuma regra de negócio nova aqui, só
   * uma forma diferente de agrupar o resultado delas.
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string[]|null} Partes já com variáveis substituídas (a de
   *   índice do relatório vem como MARCADOR_IMAGEM_RELATORIO), ou null nos
   *   mesmos casos em que montarMensagemPersonalizada devolve null.
   */
  /* ---------------------------------------------------------------------
   * ACORDOS (Módulo 16, v1.41.0) -- frases APROVADAS pelo usuário, textuais.
   * Títulos de acordo ATIVA/CONCLUIDA já chegam FORA de dados.registros
   * (Módulo 1 os põe em dados.emAcordo); aqui só se decide o que dizer.
   * --------------------------------------------------------------------- */
  function moeda(valor) {
    // Sem o espaço inseparável do toLocaleString: no WhatsApp é igual, e o
    // texto fica idêntico ao aprovado ("R$ 770,49").
    return (window.__smartTableUtil?.formatarMoeda?.(valor) ?? String(valor)).replace(/\u00a0/g, ' ');
  }

  function dataCurtaIso(iso) {
    return window.__negociacoes?.dataCurta?.(iso) ?? '';
  }

  /** A: tudo em acordo, parcela em dia. */
  function fraseLembreteParcela(p) {
    return `Passando para lembrar da parcela ${p.numero} do nosso acordo, de ${moeda(p.valor)}, com vencimento em ${dataCurtaIso(p.dataVencimento)}. Posso contar com o pagamento na data?`;
  }

  /** B: tudo em acordo, parcela atrasada. */
  function fraseParcelaAtrasada(p) {
    return `A parcela ${p.numero} do nosso acordo, de ${moeda(p.valor)}, venceu em ${dataCurtaIso(p.dataVencimento)} e ainda não identificamos o pagamento. Consegue regularizar hoje para manter o acordo em dia?`;
  }

  /**
   * Linha do acordo quando HÁ outros títulos sendo cobrados (caso misto).
   *   C: parcela em dia.
   *   Parcela atrasada: só a afirmação -- "segue em dia" (C) seria falso,
   *   e a pergunta final da mensagem já pede a ação.
   *   D: acordo INADIMPLENTE (os títulos dele voltaram pra cobrança).
   *
   * PROPOSTA A (aprovada pelo usuário, v1.41.4): frases curtas e TODAS num
   * balão só. Com um balão por frase e o texto longo, 2.239 das 8.968
   * combinações do teste de tamanho passavam de 5 balões / 600 caracteres.
   *
   * @returns {string[]} zero ou um balão
   */
  function linhasDoAcordoNoCasoMisto(resumo) {
    const frases = [];
    if (resumo?.ativa) {
      const p = resumo.ativa.parcela;
      frases.push(resumo.ativa.atrasada
        ? `A parcela ${p.numero} do acordo (${moeda(p.valor)}) venceu em ${dataCurtaIso(p.dataVencimento)}.`
        : `O acordo segue em dia: próxima parcela de ${moeda(p.valor)} em ${dataCurtaIso(p.dataVencimento)}.`);
    }
    if (resumo?.inadimplente) {
      frases.push(`O acordo feito em ${dataCurtaIso(resumo.inadimplente.dataCriacao)} não foi cumprido, e os títulos voltaram para a cobrança.`);
    }
    return frases.length > 0 ? [frases.join(' ')] : [];
  }

  /** Tudo em acordo ATIVA: sem relatório, só a parcela (A ou B). */
  function partesSoAcordo(dados, ativa) {
    const linhas = [obterLinhaApresentacao(), obterLinhaContatoRecente()].filter(Boolean);
    const frase = ativa.atrasada ? fraseParcelaAtrasada(ativa.parcela) : fraseLembreteParcela(ativa.parcela);
    return [linhas.length > 0 ? `{{saudacao}} ${linhas[0]}` : '{{saudacao}}', ...linhas.slice(1), frase]
      .map((parte) => substituirVariaveisDaFrase(parte, dados));
  }

  function montarPartesMensagemPersonalizada(dados) {
    const ctx = window.__contextoAdicional;

    // Ajuste A (aprovado pelo usuário, v1.37.0): a saudação divide o balão
    // com a primeira frase -- "Boa tarde, tudo bem?" sozinho era um balão (e
    // uma notificação no celular do cliente) sem conteúdo nenhum.
    if (ctx?.semContatoAnterior) {
      return [
        `{{saudacao}} ${montarApresentacao()}`,
        'Este é o contato responsável pela razão social {{cliente_nome}}?',
      ].map((parte) => substituirVariaveisDaFrase(parte, dados));
    }

    const resumoAcordos = window.__negociacoes?.resumoDeCobranca?.(dados?.registros ?? []) ?? null;
    const escolhido = escolherTituloRepresentativo(dados);
    if (!escolhido) {
      if (resumoAcordos?.ativa) return partesSoAcordo(dados, resumoAcordos.ativa);
      if ((dados?.emAcordo?.length ?? 0) > 0) {
        console.warn('[Atalhos] Todos os títulos vencidos estão em acordo já quitado -- nada a cobrar.');
        window.__smartTableUtil?.toast?.('Acordo quitado: os títulos aguardam a baixa -- nada a cobrar.', 6000);
        return null;
      }
      console.warn('[Atalhos] Nenhum título vencido encontrado para este cliente -- mensagem personalizada não gerada.');
      return null;
    }

    // Mesma ordem de dependência de montarMensagemPersonalizada: omitirRelatorio
    // antes da linha de situação (o texto dela muda sem relatório), e
    // blocoContexto só pra alimentar precisaDoRelatorio/precisaDePerguntaFinal
    // -- aqui NÃO usamos o texto unido, cada linha vira sua própria parte.
    const omitirRelatorio = deveOmitirRelatorio(dados);
    const linhaSituacao = montarLinhaSituacao(escolhido, dados, omitirRelatorio);
    if (linhaSituacao === null) {
      console.warn(
        `[Atalhos] Situação "${escolhido.situacaoKey}" não gera mensagem automática (situação incerta demais) -- escreva manualmente.`
      );
      return null;
    }
    const blocoContexto = montarBlocoContexto(dados);

    const linhasContexto = [
      obterLinhaApresentacao(),
      obterLinhaAgradecimentoPagamento(dados),
      obterLinhaContatoRecente(),
      obterLinhaPromessa(),
      ...linhasDoAcordoNoCasoMisto(resumoAcordos),
    ].filter(Boolean);
    const partes = [
      linhasContexto.length > 0 ? `{{saudacao}} ${linhasContexto[0]}` : '{{saudacao}}',
      ...linhasContexto.slice(1),
    ];

    // A legenda vem DEPOIS do marcador: no WhatsApp, cola-se a imagem e, na
    // tela de prévia, a legenda -- as duas pelo Win+V (ver
    // textoAvisoDasPartes: depois do Alt+S, o Ctrl+V cola a parte 1).
    if (precisaDoRelatorio(omitirRelatorio, linhaSituacao, montarBlocoSobreADivida(dados))) {
      partes.push(MARCADOR_IMAGEM_RELATORIO);
      partes.push(montarLegendaRelatorio(escolhido, dados));
    } else if (linhaSituacao) {
      partes.push(linhaSituacao);
    }
    if (precisaDePerguntaFinal(linhaSituacao, blocoContexto)) partes.push(obterPerguntaFinal(escolhido));

    return partes.map((parte) => (parte === MARCADOR_IMAGEM_RELATORIO ? parte : substituirVariaveisDaFrase(parte, dados)));
  }

  /**
   * Copia cada parte de texto pra área de transferência, em sequência, na
   * ORDEM INVERSA (última parte primeiro, parte 1 por último). Motivo: o
   * histórico do Windows (Win+V) mostra a cópia mais recente no topo, então
   * a ordem de leitura no Win+V bate com a ordem de envio.
   *
   * A IMAGEM entra na sequência no lugar dela (v1.41.3, revisão item 2):
   * no MARCADOR_IMAGEM_RELATORIO, chama `copiarImagem` (recopiarUltimaImagem
   * do Módulo 1). Antes, a imagem era recolocada no TOPO depois do laço, e
   * com frase de contexto (promessa, contato recente, acordo) o Win+V ficava
   * "imagem, parte 1, contexto, legenda, pergunta" -- a imagem ANTES do
   * contexto que é enviado antes dela. Agora, de cima pra baixo, o Win+V
   * tem a ordem em que o cliente recebe: contexto, imagem, legenda,
   * pergunta. (O Ctrl+V que colava a imagem logo após o Alt+A já não valia
   * no WhatsApp desde a v1.37.1: o Alt+S recopia a parte 1.) Sem
   * `copiarImagem`, o marcador é só pulado.
   *
   * Roda em segundo plano (quem chama não espera) -- não atrasa o clique em
   * "Registrar e Enviar". Mesma rede de segurança de sempre: se
   * navigator.clipboard não existir (jsdom, alguma versão de navegador),
   * sai calada -- o restante do fluxo (caixa de observações) segue normal.
   *
   * BUG REAL (relatado pelo usuário: "vem embaralhado, às vezes faltam ou
   * frases estão duplicadas"): a API de área de transferência do navegador
   * EXIGE que o documento esteja em foco -- uma chamada de writeText() com
   * a aba sem foco falha (silenciosamente, só cai no catch abaixo). Como
   * este laço roda em segundo plano por até ~2s (N partes x intervalo), e
   * o operador com frequência já foi pro WhatsApp Desktop nesse meio tempo
   * (é literalmente pra lá que ele vai colar), as últimas cópias do laço
   * caíam com a aba sem foco: a escrita falha e a área de transferência
   * continua com o texto da cópia ANTERIOR -- que é exatamente "uma frase
   * duplicada" (reaparece no lugar da que devia ter entrado) seguida de
   * "uma frase faltando" (a que devia ter entrado nunca chegou a existir
   * em nenhuma entrada própria do histórico).
   *
   * CORREÇÃO: antes de cada cópia, espera a aba estar em foco de verdade
   * (document.hasFocus()) -- se o operador foi pro WhatsApp no meio do
   * laço, ele PAUSA em vez de continuar escrevendo pro vazio, e retoma
   * sozinho assim que a aba volta a ter foco (Alt-Tab de volta, o que o
   * operador faria de qualquer forma pra continuar registrando o próximo
   * cliente).
   *
   * @param {string[]} partes Lista devolvida por montarPartesMensagemPersonalizada.
   */
  function aguardarFoco() {
    if (document.hasFocus()) return Promise.resolve();
    return new Promise((resolve) => {
      const aoGanharFoco = () => {
        window.removeEventListener('focus', aoGanharFoco);
        resolve();
      };
      window.addEventListener('focus', aoGanharFoco);
    });
  }

  /*
   * BUG REAL (relatado pelo usuário): "mensagens intervaladas embaralhadas/
   * duplicadas/não geradas" quando o Alt+S é apertado rápido demais depois
   * do Alt+A. CAUSA: o laço acima roda em segundo plano (fire-and-forget,
   * até ~(N-1) x INTERVALO_COPIA_PARTES_MS) escrevendo as partes na área de
   * transferência. instalarCorrecaoTextoWhatsApp() (abaixo, acionada pelo
   * Alt+S) faz sua própria escrita de segurança -- SEM esperar o laço
   * terminar e sem qualquer coordenação com ele. Se o operador aperta Alt+S
   * enquanto o laço ainda está no meio, as duas escritas competem pela
   * mesma área de transferência: a escrita de correção pode ser sobrescrita
   * por uma cópia de parte que ainda estava em voo, deixando o texto errado
   * (ou repetido) bem na hora que o operador cola no WhatsApp.
   *
   * CORREÇÃO: toda escrita na área de transferência passa por uma fila
   * única (filaEscritasClipboard), então nunca há duas escritas rodando ao
   * mesmo tempo -- e cada cópia do laço carrega o número da "geração" em
   * que nasceu (geracaoAtualClipboard). A correção do Alt+S incrementa essa
   * geração ANTES de entrar na fila: qualquer cópia do laço ainda pendente
   * se vê "velha" e desiste sem escrever, garantindo que a última coisa na
   * área de transferência seja sempre a mensagem que o Alt+S mandou abrir.
   */
  let filaEscritasClipboard = Promise.resolve();
  let geracaoAtualClipboard = 0;

  function enfileirarEscritaClipboard(tarefa) {
    filaEscritasClipboard = filaEscritasClipboard.catch(() => {}).then(tarefa);
    return filaEscritasClipboard;
  }

  async function copiarPartesParaAreaDeTransferencia(partes, copiarImagem = null) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;

    const minhaGeracao = ++geracaoAtualClipboard;
    // Ordem de envio invertida: a última cópia fica no topo do Win+V.
    const sequencia = [...partes]
      .reverse()
      .filter((parte) => parte !== MARCADOR_IMAGEM_RELATORIO || typeof copiarImagem === 'function');
    for (let i = 0; i < sequencia.length; i++) {
      if (minhaGeracao !== geracaoAtualClipboard) return; // uma geração mais nova já assumiu (Alt+S ou novo Alt+A)
      const parte = sequencia[i];
      await enfileirarEscritaClipboard(async () => {
        if (minhaGeracao !== geracaoAtualClipboard) return;
        await aguardarFoco();
        if (minhaGeracao !== geracaoAtualClipboard) return;
        try {
          if (parte === MARCADOR_IMAGEM_RELATORIO) await copiarImagem();
          else await navigator.clipboard.writeText(parte);
        } catch (erro) {
          console.warn('[Atalhos] Não consegui copiar uma parte da mensagem pra área de transferência:', erro);
        }
      });
      if (i < sequencia.length - 1) await esperar(CONFIG_ATALHOS.INTERVALO_COPIA_PARTES_MS);
    }
  }

  function escreverMensagemPersonalizada() {
    const dados = obterDadosParaSubstituicao();
    if (!dados) {
      console.warn('[Atalhos] Não foi possível calcular a situação do cliente -- mensagem personalizada não gerada.');
      return;
    }

    const partes = montarPartesMensagemPersonalizada(dados);
    if (!partes || partes.length === 0) return; // aviso específico já foi ao console acima

    const caixa = encontrarCaixaDeObservacoes();
    if (!caixa) {
      console.warn(
        `[Atalhos] Não encontrei a caixa de observações (#${CONFIG_ATALHOS.ID_CAIXA_OBSERVACOES}) pra escrever a mensagem personalizada.`
      );
      return;
    }

    // Só a parte 1 vai pra caixa -- é ela que window.abrirWhatsAppCliente()
    // (a função da própria página) lê pra montar o link do WhatsApp (Alt+S,
    // Módulo 2). As demais partes (e a imagem, já copiada pelo Alt+R) ficam
    // no histórico do Win+V pro operador colar uma a uma, cada uma como seu
    // próprio balão -- ver copiarPartesParaAreaDeTransferencia.
    definirValorControlado(caixa, partes[0]);
    dispararEventosDeMudanca(caixa);
    // A imagem do relatório entra no laço, no lugar dela na mensagem (ver
    // copiarPartesParaAreaDeTransferencia). Dentro da fila e da geração: um
    // Alt+S no meio do laço cancela a imagem também -- antes, a recópia
    // rodava DEPOIS do laço, fora da fila, e podia cobrir a parte 1 que o
    // Alt+S acabou de copiar.
    const recopiarImagem = window.__avisoCobranca?.recopiarUltimaImagem;
    copiarPartesParaAreaDeTransferencia(partes, typeof recopiarImagem === 'function' ? recopiarImagem : null);
    console.log(
      `[Atalhos] Mensagem dividida em ${partes.length} parte(s) -- parte 1 na caixa de observações, demais em sequência na área de transferência (Win+V).`
    );
    window.__smartTableUtil?.toast?.(textoAvisoDasPartes(partes));
  }

  /**
   * O aviso que aparece depois do Alt+A.
   *
   * CORRIGIDO (v1.37.1, achado em revisão): a v1.37.0 dizia "cole a imagem
   * (Ctrl+V)". Só que o Alt+S, que vem ANTES de chegar no WhatsApp, copia de
   * novo a parte 1 pra área de transferência (rede de segurança de
   * instalarCorrecaoTextoWhatsApp) -- no WhatsApp, o Ctrl+V cola esse texto,
   * não a imagem. A imagem continua no histórico: é pelo Win+V.
   *
   * @param {string[]} partes
   * @returns {string}
   */
  function textoAvisoDasPartes(partes) {
    return partes.includes(MARCADOR_IMAGEM_RELATORIO)
      ? `Mensagem em ${partes.length} partes -- no WhatsApp, cole a imagem pelo Win+V e, na legenda dela, o texto que começa com "Segue o relatório".`
      : `Mensagem em ${partes.length} partes -- use o Win+V no WhatsApp pra colar cada uma.`;
  }

  /**
   * Espera o Módulo 5 terminar de ler a aba "Grupo" (até o teto).
   *
   * Em cliente com 2+ empresas no grupo, window.__alertaGrupo só aparece
   * até ~2,5s depois da página carregar (o Módulo 5 abre a aba, espera a
   * tabela e volta). Um Alt+A apertado nesse intervalo lia "sem grupo":
   * não gerava o relatório das outras razões e escrevia "razão social X"
   * em vez de "cada razão social". Mesmo sinal que o Módulo 7 já usa
   * (esperarAbaPronta). Sem o Módulo 5 carregado, não espera nada.
   */
  function aguardarLeituraDoGrupo() {
    if (window.__alertaGrupo || window.__alertaGrupoCarregado !== true) return Promise.resolve(true);
    return esperarCondicaoNaJanela(
      () => !!window.__alertaGrupo,
      window,
      CONFIG_ATALHOS.TIMEOUT_AGUARDAR_GRUPO_MS,
      CONFIG_ATALHOS.INTERVALO_POLL_OUTRA_RAZAO_MS
    );
  }

  // Trava contra Alt+A apertado de novo com o primeiro ainda rodando (o
  // próprio toast de timeout sugere "aperte Alt+A de novo"). Sem ela, os
  // dois rodavam juntos: "Entrar em contato" clicado duas vezes e, com
  // grupo econômico, as abas das outras razões abertas em dobro.
  let atendimentoRapidoEmAndamento = false;

  async function acionarAtendimentoRapido() {
    if (atendimentoRapidoEmAndamento) {
      console.log('[Atalhos] Alt+A já está em andamento -- ignorando o segundo aperto.');
      window.__smartTableUtil?.toast?.('Alt+A já está em andamento -- aguarde terminar.');
      return;
    }
    atendimentoRapidoEmAndamento = true;
    try {
      await executarAtendimentoRapido();
    } finally {
      atendimentoRapidoEmAndamento = false;
    }
  }

  async function executarAtendimentoRapido() {
    await aguardarLeituraDoGrupo();
    // Acordos (Módulo 16): sem saber o que está em acordo, o relatório e a
    // mensagem poderiam cobrar título negociado. Espera com teto.
    if (window.__negociacoes?.aguardar) await window.__negociacoes.aguardar();
    // Leitura de acordo que falhou (ou parcela com situação desconhecida):
    // decisão do usuário, "avisar e perguntar se deseja seguir". O aviso da
    // abertura da página some em segundos e o Alt+A pode vir bem depois --
    // sem a pergunta, os títulos do acordo iriam no relatório como vencidos
    // comuns sem ninguém notar. Mesmo padrão do window.confirm do Módulo 8.
    const avisoAcordos = window.__negociacoes?.avisoPendente?.();
    if (avisoAcordos && !window.confirm(`${avisoAcordos}\n\nSeguir com o Alt+A mesmo assim?`)) return;

    // Passo 0 (se houver outra razão do grupo com saldo vencido): gera o
    // relatório de cada uma em aba de fundo antes de seguir com o resto --
    // ver gerarRelatoriosDasOutrasRazoes acima. Sem outra razão, resolve
    // na hora e o fluxo segue exatamente como antes.
    await gerarRelatoriosDasOutrasRazoes();

    const ctx = window.__contextoAdicional;
    // Tudo em acordo: a mensagem só fala da parcela (v1.41.0) -- relatório
    // nenhum, decisão do usuário.
    let soAcordo = false;
    try {
      const dadosAgora = window.__avisoCobranca?.simular?.();
      soAcordo = !!dadosAgora && dadosAgora.registros.length === 0 && (dadosAgora.emAcordo?.length ?? 0) > 0;
    } catch (erro) {
      soAcordo = false;
    }
    const semRelatorio = !!(ctx && ctx.semContatoAnterior) || soAcordo;

    // BUG REAL (relatado pelo usuário: "tem horas que tenho que apertar
    // Alt+A de novo pra pegar as frases"): este passo esperava um tempo
    // FIXO (150ms) entre clicar em "Entrar em contato" e escrever a
    // mensagem -- o mesmo problema que o passo do relatório logo abaixo já
    // tinha resolvido, só que a correção nunca chegou até aqui. Se o modal
    // de contato demorasse mais que 150ms pra montar a caixa de
    // observações, escreverMensagemPersonalizada() rodava cedo demais, não
    // encontrava a caixa (encontrarCaixaDeObservacoes() retornando null) e
    // desistia em silêncio -- só um aviso no console, nenhuma mensagem
    // escrita. Na segunda tentativa (Alt+A de novo) o modal já estava
    // aberto, por isso "funcionava da segunda vez". Agora espera a caixa
    // aparecer de verdade (mesma técnica do relatório), e avisa na tela
    // (toast) se nem assim conseguir, em vez de falhar sem ninguém notar.
    async function abrirContatoEEscrever() {
      // Passo 2: abre a tela de contato (mesma ação do Alt+C). Pára aqui se
      // não achou o botão -- não faz sentido tentar esperar/escrever depois.
      const contatoAbriu = acionarAbrirContato();
      if (!contatoAbriu) return;

      const caixaPronta = await esperarCondicaoNaJanela(
        () => !!encontrarCaixaDeObservacoes(),
        window,
        CONFIG_ATALHOS.TIMEOUT_AGUARDAR_CAIXA_OBSERVACOES_MS,
        CONFIG_ATALHOS.INTERVALO_POLL_OUTRA_RAZAO_MS
      );
      if (!caixaPronta) {
        console.warn(
          '[Atalhos] A caixa de observações não apareceu a tempo -- a mensagem não foi escrita. Aperte Alt+A de novo ou escreva manualmente.'
        );
        window.__smartTableUtil?.toast?.('Não consegui escrever a mensagem a tempo -- aperte Alt+A de novo.');
        return;
      }

      // Passo 3: monta a mensagem personalizada (situação do cliente +
      // variáveis) e escreve na caixa -- para aí, igual ao fluxo manual,
      // pra revisão antes do Alt+S.
      escreverMensagemPersonalizada();
      liberarFocoInvoluntario();
    }

    if (semRelatorio) {
      // Mensagem de primeiro contato não menciona relatório -- pula direto
      // pro passo 2, sem gerar nada.
      await abrirContatoEEscrever();
      return;
    }

    // Passo 1: gera o relatório (mesma ação do Alt+R).
    //
    // HISTÓRICO (bug real, intermitente, relatado pelo usuário): aqui havia
    // uma espera FIXA de 150ms antes de abrir a tela de contato. Mas a
    // geração é assíncrona e pode demorar segundos -- o html2canvas é
    // baixado de um CDN no momento do clique. Com a biblioteca fria, o
    // modal de contato abria POR CIMA da página enquanto a captura ainda
    // estava rodando, e o relatório saía errado ou falhava. Com ela quente,
    // dava tempo -- por isso falhava "às vezes".
    //
    // Agora espera o SINAL real de término, a mesma técnica que as abas de
    // fundo já usavam: o Módulo 1 desabilita o botão no início de aoClicar()
    // e só reabilita no finally, depois que captura, cópia e download
    // terminaram. O teto de tempo evita travar o Alt+A se algo der errado
    // lá dentro.
    const botaoRelatorio = acionarGerarRelatorio();

    if (!botaoRelatorio) {
      // Sem botão, não há o que esperar -- segue com o resto do Alt+A pra
      // não perder a mensagem por causa do relatório.
      await abrirContatoEEscrever();
      return;
    }

    const terminou = await esperarCondicaoNaJanela(
      () => botaoRelatorio.disabled === false,
      window,
      CONFIG_ATALHOS.TIMEOUT_AGUARDAR_RELATORIO_PRONTO_MS,
      CONFIG_ATALHOS.INTERVALO_POLL_OUTRA_RAZAO_MS
    );
    if (!terminou) {
      console.warn(
        '[Atalhos] O relatório não confirmou término a tempo -- seguindo com a tela de contato mesmo assim.'
      );
      window.__smartTableUtil?.toast?.('Relatório pode não ter gerado -- confira antes de enviar.');
    }

    await abrirContatoEEscrever();
  }

  /* ---------------------------------------------------------------------
   * 3.0d COPIAR A MENSAGEM PRA ÁREA DE TRANSFERÊNCIA (Alt+S)
   * -----------------------------------------------------------------
   * HISTÓRICO: chegamos a forçar web.whatsapp.com (em vez do link wa.me
   * de abrirWhatsAppCliente(), que aciona o app desktop e perde o texto
   * nesse handoff) e, depois, a abrir mensagens em aba separada uma a
   * uma -- CONFIRMADO com o usuário: reverter as duas coisas, ele
   * prefere que o Alt+S continue abrindo o APP DESKTOP (como
   * abrirWhatsAppCliente() já faz por conta própria, sem mexer na URL).
   * Fica só a rede de segurança abaixo: copia a mensagem pra área de
   * transferência, então se o app abrir sem o texto (o handoff
   * ocasionalmente perde), um Ctrl+V resolve sem precisar achar/cortar
   * da caixa de observações.
   * --------------------------------------------------------------------- */
  function instalarCorrecaoTextoWhatsApp() {
    const caixa = encontrarCaixaDeObservacoes();
    const mensagem = caixa ? caixa.value.trim() : '';
    if (!mensagem) return; // nada pra copiar -- deixa o fluxo normal (e o aviso de erro dele) seguir
    copiarMensagemAgora(mensagem);
  }

  function copiarMensagemAgora(mensagem) {
    // Cancela qualquer cópia do laço de Alt+A ainda pendente na fila --
    // ver comentário grande acima de copiarPartesParaAreaDeTransferencia.
    // Não passa por aguardarFoco() de propósito: a aba ainda está em foco
    // agora (é o clique do próprio operador que disparou isso), e esperar
    // aqui atrasaria a escrita pro depois que o WhatsApp já roubou o foco.
    geracaoAtualClipboard++;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      enfileirarEscritaClipboard(async () => {
        try {
          await navigator.clipboard.writeText(mensagem);
        } catch (erro) {
          console.warn('[Atalhos] Não consegui copiar a mensagem pra área de transferência automaticamente:', erro);
        }
      });
    }
  }

  /* ---------------------------------------------------------------------
   * 3.0e NÚMEROS DIFERENTES -- Alt+S em sequência (pedido do usuário, v1.36.0)
   * -----------------------------------------------------------------
   * Com "Números diferentes" marcado (Módulo 5) e outra razão do grupo com
   * vencido, a mesma mensagem vai pra 1 + N números:
   *
   *   1º Alt+S -> o de sempre: Módulo 2 registra o contato e abre o
   *               WhatsApp no número do cliente. Antes do clique, gravamos a
   *               "ponte" (localStorage, síncrono) com a mensagem e os
   *               números; ela só vale depois que o Módulo 3 confirma o
   *               registro (evento smarttable:contato-registrado, disparado
   *               ANTES do location.reload() do Módulo 2).
   *   2º Alt+S -> depois do reload, abre o 1º número informado. SEM
   *               registro: o Módulo 2 nem é chamado.
   *   3º Alt+S em diante -> os demais, na ordem em que foram inseridos.
   *
   * POR QUE CADA NÚMERO ESPERA UM Alt+S, E NÃO ABRE SOZINHO: o navegador só
   * deixa abrir o WhatsApp (whatsapp:// ou uma aba do web.whatsapp.com) a
   * partir de um gesto do usuário -- tecla ou clique. Não existe aba do
   * WhatsApp pra "esperar fechar": no modo Desktop nenhuma aba é aberta, e
   * no Web a aba é uma só, reaproveitada. O Alt+S de quem voltou pro CRM é
   * o sinal de que a mensagem anterior já foi.
   *
   * Nada disso toca o Módulo 2 (protegido).
   * --------------------------------------------------------------------- */
  const EVENTO_CONTATO_REGISTRADO = 'smarttable:contato-registrado';

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(location.search).get('cnpj') || '';
    } catch (erro) {
      return '';
    }
  }

  function hojeIso() {
    const util = window.__smartTableUtil;
    return util && typeof util.dataIso === 'function' ? util.dataIso(new Date()) : '';
  }

  /**
   * Regra NÃO COBRAR / CARTEIRA: se vale pra este cliente, nenhum envio
   * acontece -- nem o do cliente, nem os números extras.
   *
   * @param {string} cnpj
   * @returns {string|null} O motivo, pra mostrar na tela; null = liberado.
   */
  function motivoDeBloqueio(cnpj) {
    try {
      if (window.__alertaCliente?.estaSuprimidoDaPrioridade?.(cnpj)) return 'cliente marcado "Não cobrar" no Alerta';
    } catch (erro) {
      console.warn('[Atalhos] Não consegui ler o Alerta do cliente (Módulo 12).', erro);
    }
    let dados = null;
    try {
      dados = window.__avisoCobranca?.simular?.() ?? null;
    } catch (erro) {
      console.warn('[Atalhos] Não consegui classificar os títulos pra conferir NÃO COBRAR.', erro);
    }
    // Mesmo critério do banner do Módulo 1: sobrou só título em NÃO
    // COBRAR / CARTEIRA (ou tudo em cartório, que ele trata igual).
    if (dados && (dados.registros?.length ?? 0) === 0 && (dados.naoCobrar?.length ?? 0) > 0) {
      return 'títulos em NÃO COBRAR / CARTEIRA';
    }
    // v1.47.0 (revisor): tudo que sobrou foi marcado "fora do relatório" no
    // ⚠ Alerta -- decisão do usuário: fora da cobrança INTEIRA, inclusive
    // dos números das outras razões do grupo.
    if (dados && (dados.registros?.length ?? 0) === 0 && (dados.foraDoRelatorio?.length ?? 0) > 0) {
      return 'títulos em cartório marcados fora do relatório no ⚠ Alerta';
    }
    return null;
  }

  /**
   * O que o Alt+S faz com os números diferentes deste cliente.
   *
   * @param {string} cnpj
   * @returns {{tipo: 'normal'} | {tipo: 'multiplo', numeros: string[]} | {tipo: 'recusar', aviso: string}}
   */
  function planoDoEnvio(cnpj) {
    const nd = window.__numerosDiferentes;
    const numeros = cnpj && nd ? nd.numerosAtivos(cnpj) : [];
    if (numeros.length === 0) return { tipo: 'normal' };

    // Sem saber ainda se há outra razão com vencido, não dá pra decidir
    // entre 1 e 1+N envios -- e errar pra menos é perder cobrança calada.
    if (!window.__alertaGrupo) {
      return { tipo: 'recusar', aviso: 'Ainda lendo o grupo econômico -- aperte Alt+S de novo em 2 segundos.' };
    }
    if (!temOutraRazaoComVencido()) {
      window.__smartTableUtil?.toast?.('Nenhuma outra razão do grupo tem vencido hoje -- enviando só pro cliente (os números continuam salvos).', 6000);
      return { tipo: 'normal' };
    }
    const bloqueio = motivoDeBloqueio(cnpj);
    if (bloqueio) return { tipo: 'recusar', aviso: `Envio bloqueado: ${bloqueio}. Nenhuma mensagem foi enviada.` };
    return { tipo: 'multiplo', numeros };
  }

  /**
   * Grava a ponte ANTES do clique e a confirma quando o Módulo 3 avisa que
   * o registro deu certo. Sem confirmação (POST falhou, sessão expirou),
   * depois do reload nada abre -- ver retomarEnvioMultiplo.
   */
  function armarEnvioMultiplo(cnpj, numeros, mensagem) {
    const nd = window.__numerosDiferentes;
    const criadoEm = Date.now();
    nd.gravarPendente({
      cnpj, dia: hojeIso(), mensagem, numeros, proximo: 0,
      confirmado: false, criadoEm, ultimoEnvioEm: null,
    });

    function aoRegistrar(evento) {
      if ((evento?.detail?.cnpj || '') !== cnpj) return;
      window.removeEventListener(EVENTO_CONTATO_REGISTRADO, aoRegistrar);
      const p = nd.lerPendente();
      if (!p || p.cnpj !== cnpj || p.criadoEm !== criadoEm) return;
      nd.gravarPendente({ ...p, confirmado: true, ultimoEnvioEm: Date.now() });
    }
    window.addEventListener(EVENTO_CONTATO_REGISTRADO, aoRegistrar);
    const id = setTimeout(
      () => window.removeEventListener(EVENTO_CONTATO_REGISTRADO, aoRegistrar),
      CONFIG_ATALHOS.TIMEOUT_CONFIRMAR_REGISTRO_MS
    );
    id?.unref?.(); // só nos testes (Node) -- não segura o processo aberto
  }

  // Indireção só pra teste: o jsdom não navega pra whatsapp://.
  const navegacao = {
    ir(url) {
      window.location.href = url;
    },
  };

  /**
   * Abre o WhatsApp num número extra, pelo MESMO canal que o Módulo 2 usa
   * pro cliente (Desktop por padrão, Web com o interruptor do Alt+O).
   * MANTER SINCRONIZADO com construirUrlProtocoloWhatsApp /
   * construirUrlWhatsAppWeb do Módulo 2 (protegido, por isso não reusamos).
   * O 55 é o mesmo prefixo que abrirWhatsAppCliente() da página põe.
   */
  function abrirWhatsAppNoNumero(numero, mensagem) {
    const telefone = '55' + numero;
    const texto = encodeURIComponent(mensagem);
    if (window.__smartTableUtil?.config?.ligado('usarWhatsAppWeb')) {
      window.open('https://web.whatsapp.com/send?phone=' + telefone + '&text=' + texto, 'smarttable_zap');
      return;
    }
    navegacao.ir('whatsapp://send?phone=' + telefone + '&text=' + texto);
  }

  function enviarProximoNumero(p) {
    const nd = window.__numerosDiferentes;
    const toast = window.__smartTableUtil?.toast;
    const agora = Date.now();

    if (agora - (p.ultimoEnvioEm ?? 0) < CONFIG_ATALHOS.INTERVALO_MINIMO_ENTRE_ENVIOS_MS) {
      toast?.('Mande a mensagem anterior no WhatsApp e volte -- o próximo número abre no próximo Alt+S.');
      return;
    }
    const bloqueio = motivoDeBloqueio(p.cnpj);
    if (bloqueio) {
      nd.limparPendente();
      nd.desenhar?.();
      toast?.(`Envio bloqueado: ${bloqueio}. Os números restantes NÃO foram abertos.`, 8000);
      return;
    }

    const numero = p.numeros[p.proximo];
    const posicao = p.proximo + 2;
    const total = p.numeros.length + 1;
    const restantes = p.numeros.length - (p.proximo + 1);

    // Avança a ponte ANTES de abrir: se algo der errado ao abrir, o pior
    // caso é pular um número (visível na tela), nunca mandar em dobro.
    if (restantes > 0) nd.gravarPendente({ ...p, proximo: p.proximo + 1, ultimoEnvioEm: agora });
    else nd.limparPendente();

    copiarMensagemAgora(p.mensagem);
    abrirWhatsAppNoNumero(numero, p.mensagem);
    nd.desenhar?.();
    toast?.(
      `Envio ${posicao} de ${total} aberto, sem novo registro. ` +
      (restantes > 0 ? 'Alt+S abre o próximo.' : 'Todos os números deste cliente foram abertos.'),
      5000
    );
  }

  /**
   * Na carga da página: decide o que fazer com uma ponte que sobreviveu ao
   * reload. Nunca abre nada sozinho (ver cabeçalho desta seção).
   */
  function retomarEnvioMultiplo() {
    const nd = window.__numerosDiferentes;
    const p = nd?.lerPendente?.();
    if (!p) return;
    const toast = window.__smartTableUtil?.toast;
    const cnpj = cnpjDaPagina();
    const faltam = p.numeros.length - p.proximo;

    if (p.dia !== hojeIso()) {
      nd.limparPendente();
      toast?.(`Ficaram ${faltam} número(s) diferente(s) sem abrir num envio de outro dia -- descartados.`, 8000);
      return;
    }
    if (!p.confirmado) {
      nd.limparPendente();
      if (cnpj === p.cnpj && Date.now() - p.criadoEm < CONFIG_ATALHOS.JANELA_AVISO_NAO_CONFIRMADO_MS) {
        toast?.('Não confirmei o registro do 1º envio -- os números diferentes NÃO foram abertos. Confira a aba Contatos antes de tentar de novo.', 9000);
      }
      return;
    }
    if (!cnpj) return; // lista ou outra tela: a ponte espera a volta ao cliente
    if (cnpj !== p.cnpj) {
      nd.limparPendente();
      toast?.(`Faltou abrir ${faltam} número(s) diferente(s) do cliente anterior -- descartados.`, 8000);
      return;
    }
    toast?.(`Números diferentes: falta abrir ${faltam} de ${p.numeros.length}. Mande a mensagem e aperte Alt+S pro próximo.`, 8000);
  }

  /* ---------------------------------------------------------------------
   * 3.0f CLIQUE COM O MOUSE em "Registrar e Enviar" (revisão v1.37.0, item
   * 3, aprovado: só avisar na tela)
   * -----------------------------------------------------------------
   * Os números diferentes só andam pelo Alt+S. O clique no botão vai direto
   * pro Módulo 2 (protegido): registra e manda só pro número do cliente --
   * até aqui, sem aviso nenhum. Um ouvinte na fase de CAPTURA vê o clique
   * antes do Módulo 2 e NÃO o impede; só avisa. O Alt+S clica por script
   * (isTrusted=false) e não passa por aqui.
   *
   * O Módulo 2 recarrega a página logo depois do envio, e o aviso sumiria
   * junto: ele é guardado na sessionStorage e mostrado de novo na volta.
   * --------------------------------------------------------------------- */
  const CHAVE_AVISO_CLIQUE_MANUAL = 'smarttable_aviso_clique_manual_v1';
  const JANELA_AVISO_CLIQUE_MANUAL_MS = 60 * 1000;
  const TEXTO_AVISO_CLIQUE_MANUAL =
    'O clique no botão enviou só pro número do cliente -- os números diferentes NÃO foram abertos. ' +
    'Com "Números diferentes" marcado, use o Alt+S.';

  function aoClicarNoDocumento(evento) {
    if (!evento?.isTrusted) return;
    const botao = evento.target?.closest?.(`#${CONFIG_ATALHOS.ID_BOTAO_REGISTRAR}`);
    if (!botao) return; // botão desabilitado não recebe clique no navegador
    const cnpj = cnpjDaPagina();
    const numeros = cnpj ? window.__numerosDiferentes?.numerosAtivos?.(cnpj) ?? [] : [];
    if (numeros.length === 0 || !temOutraRazaoComVencido()) return;
    console.warn('[Atalhos] "Registrar e Enviar" clicado com o mouse com "Números diferentes" ativo -- só o cliente recebe.');
    window.__smartTableUtil?.toast?.(TEXTO_AVISO_CLIQUE_MANUAL, 9000);
    try {
      window.sessionStorage.setItem(CHAVE_AVISO_CLIQUE_MANUAL, JSON.stringify({ cnpj, em: Date.now() }));
    } catch (erro) {
      console.warn('[Atalhos] Não consegui guardar o aviso do clique pra depois do recarregamento.', erro?.message);
    }
  }

  /** Na carga da página: repete o aviso de um clique com o mouse de antes do recarregamento. */
  function mostrarAvisoDeCliqueManualPendente() {
    let dado = null;
    try {
      dado = JSON.parse(window.sessionStorage.getItem(CHAVE_AVISO_CLIQUE_MANUAL) || 'null');
      window.sessionStorage.removeItem(CHAVE_AVISO_CLIQUE_MANUAL);
    } catch (erro) {
      return;
    }
    if (!dado || dado.cnpj !== cnpjDaPagina() || !(Date.now() - dado.em <= JANELA_AVISO_CLIQUE_MANUAL_MS)) return;
    window.__smartTableUtil?.toast?.(TEXTO_AVISO_CLIQUE_MANUAL, 9000);
  }

  function acionarRegistrarEEnviar() {
    // Envio em sequência deste cliente já em andamento: o Alt+S abre o
    // próximo número e não registra nada de novo.
    const cnpj = cnpjDaPagina();
    const pendente = window.__numerosDiferentes?.lerPendente?.();
    if (pendente && pendente.confirmado && cnpj && pendente.cnpj === cnpj) {
      enviarProximoNumero(pendente);
      return;
    }

    // O Módulo 2 desabilita o botão enquanto o POST do contato está no ar.
    // simularCliqueCompleto pode chamar o handler direto (props do React,
    // elemento.onclick), passando por cima do `disabled` -- um segundo Alt+S
    // nesse intervalo registraria o MESMO contato duas vezes no CRM.
    const botaoRegistrar = document.getElementById(CONFIG_ATALHOS.ID_BOTAO_REGISTRAR);
    if (botaoRegistrar && botaoRegistrar.disabled) {
      console.log('[Atalhos] Registro já em andamento -- Alt+S ignorado pra não registrar em dobro.');
      window.__smartTableUtil?.toast?.('Registro em andamento -- aguarde.');
      return;
    }

    const plano = planoDoEnvio(cnpj);
    if (plano.tipo === 'recusar') {
      console.warn(`[Atalhos] ${plano.aviso}`);
      window.__smartTableUtil?.toast?.(plano.aviso, 8000);
      return;
    }
    if (plano.tipo === 'multiplo') {
      const caixa = encontrarCaixaDeObservacoes();
      const mensagem = caixa ? caixa.value.trim() : '';
      // Sem mensagem o Módulo 2 recusa sozinho (com o aviso dele) -- não
      // há o que repetir nos outros números.
      if (mensagem) armarEnvioMultiplo(cnpj, plano.numeros, mensagem);
    }

    instalarCorrecaoTextoWhatsApp();

    // CORREÇÃO (revisão de arquitetura, item C1): antes, o avanço da fila
    // só acontecia se o clique simulado abaixo disparasse um evento real de
    // DOM que borbulhasse até o listener do Módulo 3. Isso falha em
    // silêncio se uma estratégia de clique que NÃO dispara evento (ex.:
    // chamar onClick do React direto) for a que "vencer". Chamamos o
    // gancho explícito do Módulo 3 primeiro, ANTES do clique -- ele arma a
    // interceptação do window.open não importa qual estratégia de clique
    // seja usada a seguir. Seguro chamar mesmo se o clique real também
    // disparar o listener antigo depois (dupla chamada é protegida lá).
    if (window.filaDebug && typeof window.filaDebug.prepararEAguardarEnvio === 'function') {
      window.filaDebug.prepararEAguardarEnvio();
    }

    // Estratégia 1 (confirmada no CRM real): ID fixo do botão.
    const porId = document.getElementById(CONFIG_ATALHOS.ID_BOTAO_REGISTRAR);
    if (porId) {
      simularCliqueCompleto(porId);
      return;
    }

    // Estratégia 2 (fallback): busca por texto, caso o ID mude no futuro.
    if (!clicarBotaoPorTexto(CONFIG_ATALHOS.TEXTO_BOTAO_REGISTRAR)) {
      console.warn(
        `[Atalhos] Não encontrei o botão #${CONFIG_ATALHOS.ID_BOTAO_REGISTRAR} nem um botão com ` +
        `"${CONFIG_ATALHOS.TEXTO_BOTAO_REGISTRAR}" no texto. Confirme se a tela de contato está aberta.`
      );
    }
  }

  /* ---------------------------------------------------------------------
   * 3.4 SELECIONAR PRIMEIRA FRASE PADRÃO
   * -----------------------------------------------------------------
   * Cobre o caso mais comum (um <select> de frases). Se a tela de contato
   * usar uma LISTA de itens clicáveis em vez de dropdown, este atalho vai
   * avisar no console — me diga o formato real que eu ajusto.
   * --------------------------------------------------------------------- */
  function definirValorControlado(elemento, valor) {
    // Setar .value direto não dispara o onChange interno de campos
    // controlados por frameworks tipo React. Usar o "setter nativo" contorna
    // isso e funciona igual em campos não controlados também.
    // IMPORTANTE: <textarea> tem seu próprio prototype (HTMLTextAreaElement),
    // diferente de <input> (HTMLInputElement) — usar o errado faz o setter
    // não ser encontrado e o valor não "colar" de verdade em React.
    let proto;
    if (elemento.tagName === 'SELECT') {
      proto = window.HTMLSelectElement.prototype;
    } else if (elemento.tagName === 'TEXTAREA') {
      proto = window.HTMLTextAreaElement.prototype;
    } else {
      proto = window.HTMLInputElement.prototype;
    }
    const descritor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descritor && descritor.set) {
      descritor.set.call(elemento, valor);
    } else {
      elemento.value = valor;
    }
  }

  function dispararEventosDeMudanca(elemento) {
    elemento.dispatchEvent(new Event('input', { bubbles: true }));
    elemento.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function encontrarSelectDeFrase() {
    // Estratégia 1: select cujo id/name/aria-label sugira "frase" ou "mensagem".
    const porAtributo = document.querySelector(
      'select[id*="frase" i], select[name*="frase" i], select[aria-label*="frase" i], ' +
      'select[id*="mensagem" i], select[name*="mensagem" i], select[aria-label*="mensagem" i]'
    );
    if (porAtributo) return porAtributo;

    // Estratégia 2: <label> com texto "frase" -> pega o select associado.
    const labelFrase = Array.from(document.querySelectorAll('label')).find((l) =>
      (l.textContent || '').toLowerCase().includes('frase')
    );
    if (labelFrase) {
      if (labelFrase.htmlFor) {
        const el = document.getElementById(labelFrase.htmlFor);
        if (el && el.tagName === 'SELECT') return el;
      }
      const selectProximo = labelFrase.parentElement ? labelFrase.parentElement.querySelector('select') : null;
      if (selectProximo) return selectProximo;
    }

    return null;
  }

  function selecionarPrimeiraOpcaoValida(select) {
    const opcaoValida = Array.from(select.options).find((op) => {
      const texto = (op.textContent || '').trim().toLowerCase();
      const vazio = !op.value || texto === '' || texto.includes('selecione') || texto.includes('escolha');
      return !vazio;
    });
    if (!opcaoValida) return false;

    definirValorControlado(select, opcaoValida.value);
    select.selectedIndex = opcaoValida.index;
    dispararEventosDeMudanca(select);
    return true;
  }

  function encontrarCaixaDeObservacoes() {
    // Estratégia 1 (confirmada no CRM real): ID fixo da caixa.
    const porId = document.getElementById(CONFIG_ATALHOS.ID_CAIXA_OBSERVACOES);
    if (porId) return porId;

    // Estratégia 2 (fallback): campo cujo id/name/placeholder sugira "observa".
    const porAtributo = document.querySelector(
      'textarea[id*="observa" i], textarea[name*="observa" i], textarea[placeholder*="observa" i]'
    );
    if (porAtributo) return porAtributo;

    // Estratégia 3: <label> com texto "observa" -> textarea associado.
    const labelObs = Array.from(document.querySelectorAll('label')).find((l) =>
      (l.textContent || '').toLowerCase().includes('observa')
    );
    if (labelObs) {
      if (labelObs.htmlFor) {
        const el = document.getElementById(labelObs.htmlFor);
        if (el && el.tagName === 'TEXTAREA') return el;
      }
      const proximo = labelObs.parentElement ? labelObs.parentElement.querySelector('textarea') : null;
      if (proximo) return proximo;
    }

    // Estratégia 4 (último recurso): se só existe UM textarea visível agora.
    const textareasVisiveis = Array.from(document.querySelectorAll('textarea')).filter(elementoVisivel);
    if (textareasVisiveis.length === 1) return textareasVisiveis[0];

    return null;
  }

  /* ---------------------------------------------------------------------
   * 3.0a SUBSTITUIÇÃO DE VARIÁVEIS {{ }} NAS FRASES PADRÃO
   * -----------------------------------------------------------------
   * Antes desta correção, o botão de frase escrevia data-texto DIRETO na
   * caixa de observações (ver comentário na função abaixo sobre por que não
   * clicamos no botão real). Isso pulava a substituição de variáveis que o
   * próprio app faria dentro do handler de clique original -- por isso
   * {{cliente_nome}} etc. apareciam literalmente na mensagem.
   *
   * Fonte de dados: window.__avisoCobranca.simular() (Módulo 1), já
   * calculado pra classificação de títulos -- não duplicamos lógica aqui.
   *
   * Variáveis SEM resolvedor (ex.: {{responsavel_nome}}, {{chave_pix}},
   * {{valor_protestado_atualizado}} -- decisão consciente, não são dado que
   * o CRM expõe automaticamente) ficam com o {{...}} visível na própria
   * caixa de texto e geram aviso no console, em vez de tentar adivinhar um
   * valor. Isso vale também pra qualquer variável nova que apareça em frase
   * futura antes de alguém adicionar o resolvedor correspondente aqui --
   * fica visível, nunca falha em silêncio.
   * --------------------------------------------------------------------- */
  // Datas em mensagem pro cliente ficam mais naturais sem o ano (mesmo
  // padrão que o próprio usuário já usa nas frases reais dele, ex.: "vencido
  // em 04/09"). Se o texto não bater no formato esperado, devolve como veio
  // em vez de arriscar cortar errado.
  function encurtarData(textoData) {
    const m = (textoData || '').match(/^(\d{2}\/\d{2})\/\d{4}$/);
    return m ? m[1] : (textoData || '');
  }

  function converterMoedaBrParaNumero(texto) {
    if (!texto) return null;
    // Formato esperado: "R$ 1.234,56" -- remove tudo que não é dígito/vírgula/
    // ponto/sinal, tira separador de milhar (.), troca vírgula decimal por ponto.
    const limpo = String(texto)
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const numero = parseFloat(limpo);
    return Number.isFinite(numero) ? numero : null;
  }


  function obterDadosParaSubstituicao() {
    if (!window.__avisoCobranca || typeof window.__avisoCobranca.simular !== 'function') {
      console.warn('[Atalhos] Módulo de Aviso de Cobrança (Módulo 1) indisponível -- variáveis da frase não serão substituídas.');
      return null;
    }
    try {
      return window.__avisoCobranca.simular();
    } catch (erro) {
      console.warn('[Atalhos] Não foi possível calcular os dados do cliente para substituir variáveis:', erro.message);
      return null;
    }
  }

  // Cada resolvedor recebe o retorno de simular() ({registros, fluxo, scpc,
  // ignorados, divergentes}) e devolve a string pronta pra entrar na frase,
  // ou null/undefined se não conseguir. Adicionar variável nova = adicionar
  // uma linha aqui, sem mexer no resto da lógica de substituição.
  const RESOLVEDORES_VARIAVEL = {
    cliente_nome: (dados) => {
      const primeiro = dados.registros[0];
      return primeiro ? primeiro.razaoSocial : null;
    },
    quantidade_titulos_vencidos: (dados) => String(dados.registros.length),
    quantidade_titulos_protestados: (dados) =>
      String(dados.registros.filter((r) => r.situacaoKey === 'EM_CARTORIO').length),
    // CORRIGIDO (achado de revisão): antes, um saldo que o parser não
    // entendesse virava 0 em silêncio (`acumulado + (valor || 0)`) e a soma
    // saía errada -- no limite, "R$ 0,00" na mensagem do cliente. E como a
    // string não é vazia, nem entrava no aviso de "variável não preenchida".
    // Era o único ponto do sistema em que um valor financeiro ERRADO chegava
    // ao cliente sem nenhum sinal. Agora, se QUALQUER saldo não for
    // entendido, a variável não é resolvida: o {{valor_total_vencido}} fica
    // visível na caixa e o aviso do console aponta o problema -- mesmo
    // critério de "falhar à vista, nunca em silêncio" que o resto do módulo
    // já segue.
    valor_total_vencido: (dados) => {
      let soma = 0;
      for (const r of dados.registros) {
        const valor = converterMoedaBrParaNumero(r.saldoTexto);
        if (valor === null) {
          // Censurado: só o FORMATO do saldo (dígitos viram #), sem o título.
          console.warn(
            `[Atalhos] Não consegui interpretar um saldo (formato "${window.__diario?.valorMascarado?.(r.saldoTexto) ?? 'oculto'}") -- ` +
            'total não será preenchido automaticamente pra não enviar valor errado.'
          );
          return null;
        }
        soma += valor;
      }
      return window.__smartTableUtil.formatarMoeda(soma);
    },
    // Saudação por horário do relógio -- usada na mensagem personalizada do
    // Alt+A. Não depende de dados do cliente, só ignora o parâmetro.
    saudacao: () => {
      const hora = new Date().getHours();
      if (hora < 12) return 'Bom dia, tudo bem?';
      if (hora < 18) return 'Boa tarde, tudo bem?';
      return 'Boa noite, tudo bem?';
    },
    // Data de vencimento do título "representativo" do cliente -- mesmo
    // título escolhido por escolherTituloRepresentativo() (ver seção 3.0b).
    data_vencimento: (dados) => {
      const escolhido = escolherTituloRepresentativo(dados);
      return escolhido ? encurtarData(escolhido.vencimentoTexto) : null;
    },
  };

  function substituirVariaveisDaFrase(texto, dadosPreCalculados) {
    if (!texto || texto.indexOf('{{') === -1) {
      return texto; // frase sem variável -- maioria dos casos, sai rápido
    }

    const dados = dadosPreCalculados || obterDadosParaSubstituicao();
    const naoResolvidas = [];

    const resultado = texto.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (trechoOriginal, nomeVariavel) => {
      const resolvedor = RESOLVEDORES_VARIAVEL[nomeVariavel];
      if (!resolvedor || !dados) {
        naoResolvidas.push(nomeVariavel);
        return trechoOriginal; // deixa "{{nomeVariavel}}" visível na caixa
      }
      try {
        const valor = resolvedor(dados);
        if (valor === null || valor === undefined || valor === '') {
          naoResolvidas.push(nomeVariavel);
          return trechoOriginal;
        }
        return valor;
      } catch (erro) {
        console.warn(`[Atalhos] Erro ao calcular a variável "${nomeVariavel}":`, erro.message);
        naoResolvidas.push(nomeVariavel);
        return trechoOriginal;
      }
    });

    if (naoResolvidas.length > 0) {
      console.warn(
        `[Atalhos] Variável(is) não preenchida(s) automaticamente -- confira a mensagem antes de enviar (Alt+S): ${naoResolvidas.join(', ')}`
      );
    }

    return resultado;
  }

  function acionarSelecionarPrimeiraFrase() {
    // Estratégia 1 (confirmada no CRM real): botões ".btn-inserir-frase".
    // A ordem muda com o tempo (o mais recente/favoritado vem primeiro),
    // então a regra é sempre "o primeiro visível no momento do atalho".
    const botoesDeFrase = Array.from(
      document.querySelectorAll(CONFIG_ATALHOS.SELETOR_BOTAO_FRASE)
    ).filter(elementoVisivel);

    if (botoesDeFrase.length > 0) {
      const botao = botoesDeFrase[0];
      const textoOriginal = botao.dataset ? botao.dataset.texto : null;

      if (!textoOriginal) {
        console.warn('[Atalhos] O botão de frase não tem o atributo data-texto esperado.');
        return;
      }

      // CORREÇÃO (bug reportado): antes o texto ia direto pra caixa, sem
      // substituir {{cliente_nome}} etc. -- ver seção 3.0a acima.
      const texto = substituirVariaveisDaFrase(textoOriginal);

      // IMPORTANTE: propositalmente NÃO clicamos no botão da frase. O clique
      // real aciona uma lógica do próprio app que foca a caixa de
      // observações — o que causava exatamente o travamento que resolvemos
      // agora. Em vez disso, escrevemos o texto direto na caixa (usando o
      // ID confirmado), sem nunca dar foco nela. Sem clique, sem foco,
      // sem briga de foco com o atalho seguinte.
      const caixa = encontrarCaixaDeObservacoes();
      if (caixa) {
        definirValorControlado(caixa, texto);
        dispararEventosDeMudanca(caixa);
        console.log('[Atalhos] Texto da frase escrito direto na caixa de observações (sem clicar no botão da frase).');
      } else {
        console.warn(
          `[Atalhos] Não encontrei a caixa de observações (#${CONFIG_ATALHOS.ID_CAIXA_OBSERVACOES}) pra escrever o texto da frase.`
        );
      }
      return;
    }

    // Estratégia 2 (fallback): select de frase, caso apareça em outra tela.
    const select = encontrarSelectDeFrase();
    if (select) {
      if (selecionarPrimeiraOpcaoValida(select)) return;
      console.warn('[Atalhos] Achei um <select> de frase, mas não consegui escolher uma opção válida nele (todas pareciam placeholder).');
      return;
    }

    console.warn(
      `[Atalhos] Não encontrei nenhum botão "${CONFIG_ATALHOS.SELETOR_BOTAO_FRASE}" nem um <select> de frase. ` +
      'Confirme se a tela de contato está aberta antes de usar Alt+F.'
    );
  }

  /* ---------------------------------------------------------------------
   * 3.2 BUSCA RÁPIDA (Alt+B) — pula direto pra um cliente por nome/CNPJ
   * -----------------------------------------------------------------
   * A URL da lista já aceita ?search=... (confirmado: /crm/clientes?
   * search=&negociador=ANA.01574&filtroScpc=). Preservamos os outros
   * parâmetros que já estiverem na URL atual (negociador, filtroScpc etc.)
   * e só trocamos/adicionamos o "search".
   * --------------------------------------------------------------------- */
  let overlayBuscaEl = null;

  function buscarCliente(termo) {
    const alvo = (termo || '').trim();
    if (!alvo) return;

    const params = new URLSearchParams(location.search);
    params.set('search', alvo);

    window.location.href = `${location.origin}/crm/clientes?${params.toString()}`;
  }

  function fecharBuscaRapida() {
    if (overlayBuscaEl) {
      overlayBuscaEl.remove();
      overlayBuscaEl = null;
    }
  }

  function abrirBuscaRapida() {
    if (overlayBuscaEl) {
      fecharBuscaRapida();
      return;
    }

    overlayBuscaEl = document.createElement('div');
    overlayBuscaEl.id = CONFIG_ATALHOS.ID_OVERLAY_BUSCA;
    Object.assign(overlayBuscaEl.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(22, 35, 47, 0.35)',
      zIndex: 9999999,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '15vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const caixa = document.createElement('div');
    Object.assign(caixa.style, {
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
      padding: '16px',
      width: '420px',
      maxWidth: '90vw',
    });

    const titulo = document.createElement('div');
    titulo.textContent = 'Buscar cliente (nome ou CNPJ)';
    Object.assign(titulo.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: '#667085',
      marginBottom: '8px',
      textTransform: 'uppercase',
      letterSpacing: '.03em',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Digite e aperte Enter...';
    Object.assign(input.style, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px 12px',
      fontSize: '15px',
      border: '1px solid #d0d5dd',
      borderRadius: '8px',
      outline: 'none',
    });

    input.addEventListener('keydown', (e) => {
      // Impede que Enter/Escape aqui dentro vazem pro listener global de
      // atalhos (senão um "Enter" poderia disparar outro atalho por engano).
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        buscarCliente(input.value);
        fecharBuscaRapida();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        fecharBuscaRapida();
      }
    });

    overlayBuscaEl.addEventListener('mousedown', (e) => {
      if (e.target === overlayBuscaEl) fecharBuscaRapida(); // clicar fora fecha
    });

    caixa.appendChild(titulo);
    caixa.appendChild(input);
    overlayBuscaEl.appendChild(caixa);
    document.body.appendChild(overlayBuscaEl);

    input.focus();
  }

  /* ---------------------------------------------------------------------
   * 3.3a LOG DE ATUALIZAÇÃO (Alt+L)
   * -----------------------------------------------------------------
   * A LISTA mora no Módulo 18 (modulo18-log-atualizacoes.js) desde a
   * v1.46.0 (revisão de código): eram ~600 linhas de texto no meio do
   * código dos atalhos, e todo bump de versão mexia neste arquivo. Aqui
   * fica só o painel. O Módulo 18 carrega ANTES deste (ordem do @require);
   * sem ele, o painel abre vazio em vez de quebrar.
   * --------------------------------------------------------------------- */
  const LOG_ATUALIZACOES = Array.isArray(window.__logAtualizacoes) ? window.__logAtualizacoes : [];

  let painelNovidadesEl = null;

  /**
   * Compara duas versões semver. Devolve >0 se `a` for mais nova que `b`.
   *
   * @param {string} a @param {string} b @returns {number}
   */
  function compararVersoes(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  function lerUltimaVersaoVista() {
    try {
      return localStorage.getItem(CONFIG_ATALHOS.CHAVE_ULTIMA_VERSAO_VISTA);
    } catch (erro) {
      return null; // localStorage bloqueado -- só perde a marcação de NOVO
    }
  }

  function marcarLogComoLido() {
    try {
      if (LOG_ATUALIZACOES[0]) localStorage.setItem(CONFIG_ATALHOS.CHAVE_ULTIMA_VERSAO_VISTA, LOG_ATUALIZACOES[0].versao);
    } catch (erro) {
      /* sem drama -- o log continua abrindo, só repete o "NOVO" da próxima vez */
    }
  }

  /**
   * Versões do log que chegaram depois da última leitura.
   * Primeira vez (nada salvo): nenhuma é marcada, senão abriria com tudo
   * piscando "NOVO", o que não informa nada.
   *
   * @returns {Set<string>}
   */
  function versoesNaoLidas() {
    const vista = lerUltimaVersaoVista();
    if (!vista) return new Set();
    return new Set(LOG_ATUALIZACOES.filter((e) => compararVersoes(e.versao, vista) > 0).map((e) => e.versao));
  }

  /**
   * Ponte pro painel do Módulo 10 (Alt+D). Mesma checagem de existência da
   * ponte do Alt+O: módulo que não carregou avisa, não derruba os outros.
   */
  function alternarPainelRecebido() {
    const painel = window.__recebidoSemana;
    if (!painel || typeof painel.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 10 (recebido na semana) não carregou -- Alt+D sem efeito.');
      window.__smartTableUtil?.toast?.('Painel de recebimentos não carregou (veja o console).');
      return;
    }
    painel.alternarPainel();
  }

  /**
   * Ponte pro painel do Módulo 14 (Alt+M). Mesma checagem de existência das
   * outras pontes: módulo que não carregou avisa, não derruba os outros.
   */
  function alternarPromessaRapida() {
    const promessa = window.__promessaRapida;
    if (!promessa || typeof promessa.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 17 (promessa rápida) não carregou -- Alt+N sem efeito.');
      window.__smartTableUtil?.toast?.('Promessa rápida não carregou (veja o console).');
      return;
    }
    promessa.alternarPainel();
  }

  function alternarPainelCarteira() {
    const painel = window.__carteira;
    if (!painel || typeof painel.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 14 (carteira) não carregou -- Alt+M sem efeito.');
      window.__smartTableUtil?.toast?.('Painel da carteira não carregou (veja o console).');
      return;
    }
    painel.alternarPainel();
  }

  /**
   * Ponte pro painel do Módulo 9 (Alt+O).
   *
   * Checa a existência em vez de assumir: se o Módulo 9 não carregar (cache
   * antigo do Tampermonkey, @require com 404), o atalho avisa e o resto dos
   * atalhos continua funcionando. É o mesmo cuidado que os outros módulos
   * tomam com as dependências entre si.
   */
  function alternarPainelConfiguracoes() {
    const painel = window.__painelConfiguracoes;
    if (!painel || typeof painel.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 9 (painel de configurações) não carregou -- Alt+O sem efeito.');
      window.__smartTableUtil?.toast?.('Painel de configurações não carregou (veja o console).');
      return;
    }
    painel.alternarPainel();
  }

  /**
   * Ponte pro painel do Módulo 13 (Alt+K). Mesmo cuidado dos outros: checa
   * a existência em vez de assumir, pra um @require faltando avisar em vez
   * de travar o atalho em silêncio.
   */
  function alternarConsoleDiagnostico() {
    const painel = window.__consoleDiagnostico;
    if (!painel || typeof painel.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 13 (console de diagnóstico) não carregou -- Alt+K sem efeito.');
      window.__smartTableUtil?.toast?.('Console de diagnóstico não carregou (veja o console).');
      return;
    }
    painel.alternarPainel();
  }

  function fecharPainelNovidades() {
    if (!painelNovidadesEl) return;
    painelNovidadesEl.remove();
    painelNovidadesEl = null;
  }

  function alternarPainelNovidades() {
    if (painelNovidadesEl) {
      fecharPainelNovidades();
      return;
    }
    // Só um painel flutuante nosso por vez (registrarPainel, Módulo 0).
    window.__smartTableUtil?.fecharOutrosPaineis?.('novidades');

    const naoLidas = versoesNaoLidas();

    painelNovidadesEl = document.createElement('div');
    Object.assign(painelNovidadesEl.style, {
      position: 'fixed',
      bottom: '112px',
      left: '16px',
      background: '#ffffff',
      border: '1px solid #d0d5dd',
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      // Mesmo z-index do banner de grupo (Módulo 5): fica ABAIXO dos modais
      // do CRM, que usam z-50, pra nunca cortar um modal ao meio.
      zIndex: 30,
      width: '420px',
      maxWidth: '90vw',
      maxHeight: '60vh',
      overflowY: 'auto',
    });

    const titulo = document.createElement('div');
    titulo.textContent = `O que mudou — você está na v${LOG_ATUALIZACOES[0]?.versao ?? '?'}`;
    Object.assign(titulo.style, {
      color: '#16232F', fontWeight: '700', fontSize: '14px',
      marginBottom: '10px', borderBottom: '1px solid #eef2f6', paddingBottom: '6px',
      position: 'sticky', top: '0', background: '#fff',
    });
    painelNovidadesEl.appendChild(titulo);

    LOG_ATUALIZACOES.forEach((entrada) => {
      const bloco = document.createElement('div');
      bloco.style.marginBottom = '12px';

      const cabecalho = document.createElement('div');
      Object.assign(cabecalho.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });

      const versao = document.createElement('span');
      versao.textContent = `v${entrada.versao}`;
      Object.assign(versao.style, {
        fontFamily: 'ui-monospace, monospace', background: '#eef2f6', color: '#16232F',
        padding: '2px 7px', borderRadius: '5px', fontWeight: '600', fontSize: '12px',
      });
      cabecalho.appendChild(versao);

      const data = document.createElement('span');
      data.textContent = entrada.data;
      Object.assign(data.style, { color: '#98a2b3', fontSize: '11px' });
      cabecalho.appendChild(data);

      if (naoLidas.has(entrada.versao)) {
        const novo = document.createElement('span');
        novo.textContent = 'NOVO';
        Object.assign(novo.style, {
          background: '#1B6B4A', color: '#fff', padding: '1px 6px',
          borderRadius: '4px', fontSize: '10px', fontWeight: '700', letterSpacing: '.04em',
        });
        cabecalho.appendChild(novo);
      }

      bloco.appendChild(cabecalho);

      entrada.mudancas.forEach((texto) => {
        const linha = document.createElement('div');
        linha.textContent = `• ${texto}`;
        Object.assign(linha.style, { color: '#344054', lineHeight: '1.45', paddingLeft: '2px', marginTop: '2px' });
        bloco.appendChild(linha);
      });

      painelNovidadesEl.appendChild(bloco);
    });

    const dica = document.createElement('div');
    dica.textContent = 'Alt+L de novo pra fechar';
    Object.assign(dica.style, {
      marginTop: '4px', paddingTop: '6px', borderTop: '1px solid #eef2f6',
      color: '#98a2b3', fontSize: '11px', textAlign: 'center',
      position: 'sticky', bottom: '0', background: '#fff',
    });
    painelNovidadesEl.appendChild(dica);

    document.body.appendChild(painelNovidadesEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(painelNovidadesEl);

    // Marca como lido só DEPOIS de montar: se algo acima falhar, o "NOVO"
    // continua na próxima abertura em vez de sumir sem ter sido visto.
    marcarLogComoLido();
  }

  /* ---------------------------------------------------------------------
   * 3.3 PAINEL DE AJUDA (Alt+H) — lista visual dos atalhos, liga/desliga
   * --------------------------------------------------------------------- */
  function fecharPainelAjuda() {
    if (!painelAjudaEl) return;
    painelAjudaEl.remove();
    painelAjudaEl = null;
  }

  function alternarPainelAjuda() {
    if (painelAjudaEl) {
      fecharPainelAjuda();
      return;
    }
    window.__smartTableUtil?.fecharOutrosPaineis?.('ajuda');

    painelAjudaEl = document.createElement('div');
    Object.assign(painelAjudaEl.style, {
      position: 'fixed',
      bottom: '112px', // acima do botão "Continuar fila anterior" (Módulo 3), evita sobrepor
      left: '16px',
      background: '#ffffff',
      border: '1px solid #d0d5dd',
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: 999999,
      minWidth: '260px',
    });

    const titulo = document.createElement('div');
    titulo.textContent = 'Atalhos de teclado';
    Object.assign(titulo.style, {
      color: '#16232F',
      fontWeight: '700',
      fontSize: '14px',
      marginBottom: '8px',
      borderBottom: '1px solid #eef2f6',
      paddingBottom: '6px',
    });
    painelAjudaEl.appendChild(titulo);

    LISTA_ATALHOS.forEach((item) => {
      const linha = document.createElement('div');
      Object.assign(linha.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        padding: '4px 0',
      });

      const tecla = document.createElement('span');
      tecla.textContent = item.tecla;
      Object.assign(tecla.style, {
        fontFamily: 'ui-monospace, monospace',
        background: '#eef2f6',
        color: '#16232F',
        padding: '2px 7px',
        borderRadius: '5px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
      });

      const desc = document.createElement('span');
      desc.textContent = item.descricao;
      desc.style.color = '#344054';
      desc.style.textAlign = 'right';

      linha.appendChild(tecla);
      linha.appendChild(desc);
      painelAjudaEl.appendChild(linha);
    });

    const dica = document.createElement('div');
    dica.textContent = 'Alt+H de novo pra fechar';
    Object.assign(dica.style, {
      marginTop: '8px',
      paddingTop: '6px',
      borderTop: '1px solid #eef2f6',
      color: '#98a2b3',
      fontSize: '11px',
      textAlign: 'center',
    });
    painelAjudaEl.appendChild(dica);

    document.body.appendChild(painelAjudaEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(painelAjudaEl);
  }

  /* ---------------------------------------------------------------------
   * 4. LISTENER DE TECLADO
   * --------------------------------------------------------------------- */
  document.addEventListener(
    'keydown',
    function (e) {
      // EXCEÇÃO DIRIGIDA, e a única com Shift: Shift+Alt+U REFAZ a fila por
      // prioridade, enquanto Alt+U sozinho continua a de hoje.
      //
      // Precisa vir antes da guarda abaixo, que barra Shift de propósito. O
      // Shift aqui não é enfeite: refazer descarta a fila em andamento e
      // custa abrir ~140 abas de fundo. Exigir uma tecla a mais pra isso é o
      // que impede de acontecer por reflexo -- e evita um atalho novo,
      // dentro do orçamento de tela e de teclas do projeto.
      if (
        e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.repeat &&
        e.code === CONFIG_ATALHOS.TECLA_FILA_PRIORIDADE && !estaDigitando()
      ) {
        e.preventDefault();
        acionarFilaPorPrioridade({ reconstruir: true });
        return;
      }

      // Só reage a Alt sozinho (sem Ctrl/Shift/Meta), pra minimizar colisão
      // com outros atalhos do navegador ou do próprio CRM.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.repeat) return; // ignora repetição ao segurar a tecla

      // EXCEÇÃO DIRIGIDA (corrige código morto achado em revisão): com a
      // busca rápida aberta, o foco está no input dela, então estaDigitando()
      // barrava o próprio Alt+B -- o toggle
      // `if (overlayBuscaEl) fecharBuscaRapida()` era inalcançável e só
      // Escape/clique fora fechavam. A exceção é só pra ESTA tecla: qualquer
      // outro Alt+letra continua bloqueado enquanto você digita, senão um
      // Alt+S no meio de uma pesquisa registraria e enviaria a cobrança.
      if (e.code === CONFIG_ATALHOS.TECLA_BUSCA_RAPIDA && overlayBuscaEl) {
        e.preventDefault();
        fecharBuscaRapida();
        return;
      }

      if (estaDigitando()) return;

      switch (e.code) {
        case CONFIG_ATALHOS.TECLA_INICIAR_FILA:
          e.preventDefault();
          acionarIniciarFila();
          break;
        case CONFIG_ATALHOS.TECLA_FILA_PRIORIDADE:
          e.preventDefault();
          acionarFilaPorPrioridade();
          break;
        case CONFIG_ATALHOS.TECLA_GERAR_RELATORIO:
          e.preventDefault();
          acionarGerarRelatorio();
          break;
        case CONFIG_ATALHOS.TECLA_ABRIR_CONTATO:
          e.preventDefault();
          acionarAbrirContato();
          break;
        case CONFIG_ATALHOS.TECLA_PROXIMO_DA_FILA:
          e.preventDefault();
          acionarProximoDaFila();
          break;
        case CONFIG_ATALHOS.TECLA_VOLTAR_FILA:
          e.preventDefault();
          acionarVoltarFila();
          break;
        case CONFIG_ATALHOS.TECLA_ABRIR_GRUPO_VENCIDO:
          e.preventDefault();
          acionarAbrirGrupoComVencido();
          break;
        case CONFIG_ATALHOS.TECLA_SELECIONAR_FRASE:
          e.preventDefault();
          acionarSelecionarPrimeiraFrase();
          break;
        case CONFIG_ATALHOS.TECLA_ATENDIMENTO_RAPIDO:
          e.preventDefault();
          acionarAtendimentoRapido();
          break;
        case CONFIG_ATALHOS.TECLA_REGISTRAR_ENVIAR:
          e.preventDefault();
          acionarRegistrarEEnviar();
          break;
        case CONFIG_ATALHOS.TECLA_AJUDA:
          e.preventDefault();
          alternarPainelAjuda();
          break;
        case CONFIG_ATALHOS.TECLA_NOVIDADES:
          e.preventDefault();
          alternarPainelNovidades();
          break;
        case CONFIG_ATALHOS.TECLA_CONFIGURACOES:
          e.preventDefault();
          alternarPainelConfiguracoes();
          break;
        case CONFIG_ATALHOS.TECLA_CONSOLE_DIAGNOSTICO:
          e.preventDefault();
          alternarConsoleDiagnostico();
          break;
        case CONFIG_ATALHOS.TECLA_RECEBIDO_SEMANA:
          e.preventDefault();
          alternarPainelRecebido();
          break;
        case CONFIG_ATALHOS.TECLA_CARTEIRA:
          e.preventDefault();
          alternarPainelCarteira();
          break;
        case CONFIG_ATALHOS.TECLA_PROMESSA_RAPIDA:
          e.preventDefault();
          alternarPromessaRapida();
          break;
        case CONFIG_ATALHOS.TECLA_BUSCA_RAPIDA:
          e.preventDefault();
          abrirBuscaRapida();
          return; // sai sem rodar a limpeza de foco abaixo -- aqui o foco
                   // no campo de busca é intencional, não um efeito colateral
        default:
          return; // não é um dos nossos atalhos — não faz nada, nem a limpeza abaixo
      }

      // Rede de segurança geral: qualquer atalho que tenha, por efeito
      // colateral, deixado o foco preso numa caixa de texto (focus trap de
      // modal, por exemplo) libera esse foco aqui — assim o PRÓXIMO atalho
      // não se autobloqueia achando que você está digitando. Repetimos
      // algumas vezes com atraso porque alguns apps focam campos de forma
      // assíncrona (depois de um re-render), então uma limpeza só no
      // instante do clique pode ser cedo demais.
      liberarFocoInvoluntario();
      setTimeout(liberarFocoInvoluntario, 60);
      setTimeout(liberarFocoInvoluntario, 250);
    },
    true
  );

  console.log(
    '%c[Atalhos] ' + LISTA_ATALHOS.map((a) => `${a.tecla}: ${a.descricao}`).join(' | '),
    'color:#16232F;font-weight:bold;'
  );

  // Hook de depuração/teste (mesmo padrão do window.filaDebug no Módulo 3 e
  // window.__contextoAdicionalDebug no Módulo 6) -- expõe a montagem da
  // mensagem personalizada do Alt+A pra validação automatizada sem precisar
  // simular o atalho de teclado inteiro.
  // Os dois painéis deste módulo entram no mesmo registro dos painéis do
  // Módulo 9 e do Módulo 10 -- abrir qualquer um fecha os outros três.
  window.__smartTableUtil?.registrarPainel?.('novidades', fecharPainelNovidades);
  window.__smartTableUtil?.registrarPainel?.('ajuda', fecharPainelAjuda);

  try {
    retomarEnvioMultiplo();
  } catch (erro) {
    console.warn('[Atalhos] Não consegui retomar o envio pros números diferentes.', erro);
  }
  document.addEventListener('click', aoClicarNoDocumento, true);
  try {
    mostrarAvisoDeCliqueManualPendente();
  } catch (erro) {
    console.warn('[Atalhos] Não consegui mostrar o aviso do clique no botão.', erro);
  }

  window.__atalhosDebug = {
    FRASES,
    frase,
    sementeDaFrase,
    montarMensagemPersonalizada,
    montarPartesMensagemPersonalizada,
    textoAvisoDasPartes,
    copiarPartesParaAreaDeTransferencia,
    instalarCorrecaoTextoWhatsApp,
    aoClicarNoDocumento,
    TEXTO_AVISO_CLIQUE_MANUAL,
    aguardarFoco,
    MARCADOR_IMAGEM_RELATORIO,
    deveOmitirRelatorio,
    gerarRelatoriosDasOutrasRazoes,
    esperarRelatorioProntoNaJanela,
    esperarCondicaoNaJanela,
    encontrarCaixaDeObservacoes,
    substituirVariaveisDaFrase,
    concordarTitulos,
    acionarGerarRelatorio,
    encontrarBotaoRelatorio,
    LOG_ATUALIZACOES,
    linhasDoAcordoNoCasoMisto,
    alternarPainelNovidades,
    versoesNaoLidas,
    compararVersoes,
    obterPerguntaFinal,
    acionarAtendimentoRapido,
    acionarRegistrarEEnviar,
    planoDoEnvio,
    motivoDeBloqueio,
    retomarEnvioMultiplo,
    navegacao,
    CONFIG_ATALHOS,
    abrirBuscaRapida,
    fecharBuscaRapida,
    estaBuscaRapidaAberta: () => overlayBuscaEl !== null,
  };
})();
