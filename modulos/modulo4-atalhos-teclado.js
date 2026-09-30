/* =========================================================================
 * MÓDULO 4: ATALHOS DE TECLADO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Atalhos de teclado, todos com Alt (não colidem com o navegador/CRM).
 * A lista completa é LISTA_ATALHOS (alimenta o aviso do console e o painel
 * Alt+H). Também monta a mensagem personalizada do Alt+A e o envio em
 * sequência do Alt+S.
 *
 * Fluxo típico: Alt+C (contato) -> Alt+F (frase) -> Alt+S (registra e envia)
 * -> Alt+P (próximo da fila; o Módulo 3 nunca navega sozinho).
 *
 * Depende de: Módulo 0 (window.__smartTableUtil), Módulo 3
 * (window.filaDebug.iniciarFila/irParaProximo/irParaAnterior), Módulo 7
 * (window.filaPrioridadeDebug.iniciar, Alt+U) e Módulo 5
 * (window.__alertaGrupo, linha de grupo na mensagem e Alt+G). Todos precisam
 * ser carregados ANTES deste arquivo.
 *
 * Alt+C não tem ID confirmado: procura o botão por TEXTO
 * (CONFIG_ATALHOS.TEXTO_BOTAO_CONTATO). Alt+F, Alt+R e Alt+S usam classe/ID
 * confirmados no CRM real.
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
    // Tetos de segurança: o Alt+A espera o SINAL real (caixa de observações
    // existir, botão de relatório reabilitar), não um tempo fixo.
    TIMEOUT_AGUARDAR_CAIXA_OBSERVACOES_MS: 5000,
    // Espera pelo Módulo 5 ler a aba "Grupo" (ele desiste em 2,5s).
    TIMEOUT_AGUARDAR_GRUPO_MS: 3000,
    // Alt+A com outras razões do grupo vencidas: espera pelo botão de
    // relatório em cada aba de fundo e intervalo do polling (também usado
    // pra esperar o relatório terminar).
    TIMEOUT_CARREGAMENTO_OUTRA_RAZAO_MS: 8000,
    INTERVALO_POLL_OUTRA_RAZAO_MS: 200,
    // O botão de relatório só reabilita depois de captura + blob + clipboard
    // + download; confirmado com o usuário que 2000ms fixos não bastavam.
    TIMEOUT_AGUARDAR_RELATORIO_PRONTO_MS: 10000,
    // Intervalo entre a cópia de uma parte da mensagem e a próxima: faz o
    // Windows (Win+V) registrar cada parte como entrada SEPARADA do
    // histórico (ver copiarPartesParaAreaDeTransferencia). 250ms era pouco.
    // A causa principal de partes faltando é o foco da aba (ver aguardarFoco).
    INTERVALO_COPIA_PARTES_MS: 400,
    // Tentativas de cópia por parte e pela imagem. Só conta como copiado
    // quando a promessa do clipboard resolve. Espera entre tentativas:
    // INTERVALO_NOVA_TENTATIVA_COPIA_MS x número da tentativa.
    TENTATIVAS_COPIA: 3,
    INTERVALO_NOVA_TENTATIVA_COPIA_MS: 500,
    // Teto da espera do Alt+S pela imagem ficar no Ctrl+V antes de clicar em
    // "Registrar e Enviar" (o Módulo 2 recarrega a página logo depois).
    // Fica dentro da janela de ativação do navegador (~5 s).
    TIMEOUT_IMAGEM_CTRL_V_MS: 1500,
    INTERVALO_TENTATIVA_IMAGEM_CTRL_V_MS: 150,
    // Trechos de texto (minúsculo). Relatório e Registrar têm ID confirmado:
    // o texto é plano B. Só TEXTO_BOTAO_CONTATO não tem ID confirmado.
    TEXTO_BOTAO_RELATORIO: 'relatório',
    TEXTO_BOTAO_CONTATO: 'contato',
    TEXTO_BOTAO_REGISTRAR: 'registrar e enviar',
    // Confirmado no CRM real: cada frase padrão é um botão com esta classe,
    // e a ordem deles muda (o mais recente/favoritado aparece primeiro).
    SELETOR_BOTAO_FRASE: '.btn-inserir-frase',
    // IDs confirmados via diagnóstico real (mais confiável que texto/classe).
    ID_BOTAO_REGISTRAR: 'btn-registrar-enviar',
    ID_CAIXA_OBSERVACOES: 'contato-resumo',
    // Id do botão de relatório, criado pelo Módulo 1. Buscar por ID (não por
    // texto) sobrevive à troca do rótulo pra "Gerando..." durante a geração.
    ID_BOTAO_RELATORIO: 'aviso-cobranca-botao',
    // Id do overlay da busca rápida (Alt+B); estaDigitando() precisa
    // conhecê-lo pra o próprio Alt+B conseguir fechar a busca.
    ID_OVERLAY_BUSCA: 'smarttable-busca-rapida',
    // Última versão cujo log já foi lido (marca como NOVO o que veio depois).
    CHAVE_ULTIMA_VERSAO_VISTA: 'smarttable_ultima_versao_vista',
    // Números diferentes (seção 3.0e): intervalo mínimo entre abrir um número
    // e o próximo. Evita Alt+S duplo por reflexo abrir o número seguinte por
    // cima da conversa ainda não enviada.
    INTERVALO_MINIMO_ENTRE_ENVIOS_MS: 3000,
    // Espera do Alt+S pelo Módulo 3 confirmar o registro do 1º envio.
    TIMEOUT_CONFIRMAR_REGISTRO_MS: 60000,
    // Envio em sequência armado e nunca confirmado: até quando ainda vale
    // avisar na tela que os números extras não abriram.
    JANELA_AVISO_NAO_CONFIRMADO_MS: 120000,
  };

  // Fonte única da lista de atalhos (aviso do console e painel Alt+H).
  const LISTA_ATALHOS = [
    { tecla: 'Alt+I', descricao: 'Iniciar Fila de Atendimento' },
    { tecla: 'Alt+U', descricao: 'Fila por Prioridade: continua a de hoje; só monta do zero se não houver' },
    { tecla: 'Shift+Alt+U', descricao: 'Refazer a fila por prioridade do zero (tira quem já foi contatado hoje)' },
    { tecla: 'Alt+R', descricao: 'Gerar Relatório' },
    { tecla: 'Alt+C', descricao: 'Entrar na tela de contato' },
    { tecla: 'Alt+F', descricao: 'Selecionar a 1ª frase padrão' },
    { tecla: 'Alt+A', descricao: 'Atendimento rápido (relatório(s) de outra(s) razão(ões) do grupo, se houver, + relatório + contato + mensagem personalizada)' },
    // Texto aprovado pelo usuário.
    { tecla: 'Alt+S', descricao: 'Registrar e Enviar. Logo depois do Alt+A, espera a mensagem e o relatório irem para a área de transferência e envia sozinho; se a cópia falhar, não envia até "Copiar de novo" dar certo. Com "Números diferentes" marcado: cada Alt+S abre o próximo número' },
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

  // Única definição de "visível" do arquivo.
  function elementoVisivel(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // doc opcional: default é o document desta aba; aceita o de outra janela
  // same-origin (ver gerarRelatoriosDasOutrasRazoes).
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

  // Espera (polling) o botão aparecer em OUTRA janela same-origin. Lê
  // janela.document a cada tentativa: o document de uma aba recém-aberta
  // começa como about:blank e é trocado quando a navegação termina.
  // Resolve com o elemento, ou null se a aba fechar ou o tempo esgotar.
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

  // Igual à anterior, mas pra qualquer condição. Resolve true quando ela
  // bate, false se a aba fechar ou o tempo esgotar.
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

  // O finally de aoClicar() (Módulo 1) só reabilita o botão depois de
  // captura, cópia e download: botão habilitado = relatório pronto. Usa a
  // referência do botão, não busca por texto (que vira "Gerando...").
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
    // O DOM do React guarda as props numa chave "__reactProps$xxxxx" (17+) ou
    // "__reactEventHandlers$xxxxx" (16); de lá vem o onClick real.
    const chave = Object.keys(elemento).find(
      (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
    );
    return chave ? elemento[chave] : null;
  }

  function simularCliqueCompleto(elemento) {
    // NÃO chamar elemento.focus(): num modal com "focus trap" o app redireciona
    // o foco pra outro campo e trava os atalhos seguintes.

    // Estratégia 1: onClick interno do React, subindo até 4 ancestrais (o
    // texto pode estar num <span> dentro do botão). Não depende do navegador
    // reconhecer o clique como legítimo.
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
    // Tira o foco de uma caixa de texto presa por "focus trap"; senão o
    // PRÓXIMO atalho se autobloqueia (estaDigitando()). Seguro: o keydown já
    // confirmou que o usuário não estava digitando.
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

  // Abre cada outra razão do grupo com saldo vencido em nova aba; o relatório
  // de cada uma continua sendo Alt+R manual. Confirmado com o usuário: um
  // relatório por página, sem combinar numa imagem (exigiria mexer no Módulo 1).
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
      // Alt+G é gesto do usuário, mas aba faltando pode ser bloqueador de popup.
      window.open(empresa.url, '_blank', 'noopener,noreferrer');
    });
  }

  // Alt+A com outras razões do grupo vencidas: visita cada uma em aba de
  // fundo, gera o relatório e fecha a aba, antes de seguir na razão original
  // (que nunca sai do lugar).
  //
  // Todas as abas abrem DE UMA VEZ, síncronas, dentro do gesto do usuário:
  // com await entre elas o navegador bloqueia como popup. Só a espera pelo
  // botão em cada aba é sequencial.
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
   * Acha o botão de gerar relatório. Busca primeiro por ID (o Módulo 1 troca
   * o rótulo pra "Gerando..." durante a geração, e a busca por texto falha).
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
  /*
   * O Módulo 1 guarda UMA imagem (a do último relatório, de qualquer
   * cliente). Este módulo lembra DE QUEM foi o último relatório (Alt+A, Alt+R
   * ou clique) e só deixa a imagem no Ctrl+V quando é do cliente da tela;
   * senão o Alt+S colaria a imagem de outro cliente.
   */
  let cnpjDoUltimoRelatorio = null;

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

    // Já gerando (o Módulo 1 desabilita o botão): devolve o botão pra quem
    // chamou esperar a geração em curso.
    if (botao.disabled) {
      console.log('[Atalhos] Relatório já está sendo gerado -- aguardando o que já está em andamento.');
      return botao;
    }

    cnpjDoUltimoRelatorio = cnpjDaPagina();
    simularCliqueCompleto(botao);
    return botao;
  }

  /** Clique de MOUSE no botão de relatório: também é um relatório novo (de quem está na tela). */
  function aoClicarNoBotaoDeRelatorio(evento) {
    if (evento?.target?.closest?.(`#${CONFIG_ATALHOS.ID_BOTAO_RELATORIO}`)) cnpjDoUltimoRelatorio = cnpjDaPagina();
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
   * O título que "representa" o cliente segue a mesma regra do Módulo 2
   * (resumo do CRM), centralizada em __smartTableUtil.escolherTituloRepresentativo.
   * O Módulo 2 mantém cópia local (protegido); este módulo e o Módulo 7 usam
   * a compartilhada, pra nota do CRM e mensagem baterem sobre o mesmo título.
   * --------------------------------------------------------------------- */

  // Datas de vencimento (curtas, sem duplicata) dos títulos de uma situação.
  // Só quando o relatório é OMITIDO (ver deveOmitirRelatorio): sem relatório
  // não dá pra dizer "grifado abaixo"; confirmado com o usuário, cita a data.
  function obterDatasVencimentoPorSituacao(dados, situacaoKey) {
    const datas = dados.registros
      .filter((r) => r.situacaoKey === situacaoKey)
      .sort((a, b) => b.diasAtrasoReal - a.diasAtrasoReal)
      .map((r) => encurtarData(r.vencimentoTexto));
    return [...new Set(datas)];
  }

  // Aviso de suspensão SCPC por nível de atraso; serve à linha principal e à
  // complementar (obterLinhaNegativadoScpcAdicional).
  function textoAvisoScpc(dias) {
    // Confirmado com o usuário: aviso específico só na janela final; fora
    // dela, a frase genérica. Após o 19º dia a suspensão é certa, mas o
    // cancelamento dos faturamentos é só POSSIBILIDADE ("podem ser
    // cancelados"); afirmar o que não é certo queima o aviso. Diz "após"
    // (não "a partir do") porque o 19º dia ainda é o último de pagamento.
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
      return `Lembramos que, após o ${DIAS_ULTIMO_DIA_SUSPENSAO_SCPC}º dia de atraso, o cadastro é suspenso e os faturamentos podem ser cancelados.`;
    }
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
      return 'Hoje é o último dia para pagamento antes que o cadastro seja suspenso e o caso seja encaminhado a um de nossos analistas. Após essa data, os faturamentos podem ser cancelados.';
    }
    return 'Lembramos que a regularização dos débitos negativados no SCPC permite a baixa das restrições.';
  }

  // Urgência entre NEGATIVADO_SCPC, mesma lógica de escolherTituloRepresentativo:
  // dia 19 exato > janela 16-18 > outro.
  function prioridadeUrgenciaScpc(dias) {
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) return 3;
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) return 2;
    return 1;
  }

  // Linha de contexto por situação (adaptada das frases padrão do usuário).
  // Retorna '' (sem linha extra), texto, ou null (sem mensagem automática).
  function obterLinhaContexto(escolhido, dados, omitirRelatorio) {
    switch (escolhido.situacaoKey) {
      case 'EM_ATRASO':
      case 'PRAZO_FINAL':
        return '';
      case 'SEM_PROTESTO': {
        // Texto aprovado pelo usuário: título "não protestar" vencido, sem
        // cartório, prazo final ou encaminhamento. Com relatório a linha nem
        // chega à mensagem (a linha do relatório é neutra); sem ele, as datas
        // ancoram. Pergunta final: a do estágio inicial (default).
        const datas = obterDatasVencimentoPorSituacao(dados, 'SEM_PROTESTO');
        return datas.length > 1
          ? `Os títulos vencidos em ${datas.join(', ')} estão em aberto.`
          : `O título vencido em ${datas[0]} está em aberto.`;
      }
      case 'ULTIMO_DIA': {
        const destino = dados.fluxo === 'SCPC' ? 'ao SCPC' : 'para cartório';
        // Sem "Lembramos que": esta linha pode vir logo após a de promessa
        // DIA_DA_PROMESSA, que já abre assim; abertura repetida soa robótica.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'ULTIMO_DIA');
          const datasTexto = datas.join(', ');
          return datas.length > 1
            ? `Os títulos vencidos em ${datasTexto} estão no prazo final antes de serem encaminhados ${destino}.`
            : `O título vencido em ${datasTexto} está no prazo final antes de ser encaminhado ${destino}.`;
        }
        // Com relatório, basta citar a cor (último dia = vermelho).
        const quantidade = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA').length;
        return quantidade > 1
          ? `Os títulos grifados em vermelho no relatório abaixo estão no prazo final antes de serem encaminhados ${destino}.`
          : `O título grifado em vermelho no relatório abaixo está no prazo final antes de ser encaminhado ${destino}.`;
      }
      case 'NEGATIVADO_SCPC':
        return textoAvisoScpc(escolhido.diasAtrasoReal);
      case 'EM_CARTORIO': {
        // Confirmado com o usuário: citar a cor (amarelo). A linha convive com
        // as outras; montarMensagemPersonalizada empilha cada uma independente.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'EM_CARTORIO');
          return `Os títulos vencidos em ${datas.join(', ')} já estão em cartório -- o pagamento do restante ainda é possível via boleto.`;
        }
        return 'Os títulos grifados em amarelo no relatório abaixo já estão em cartório -- o pagamento do restante ainda é possível via boleto.';
      }
      default:
        // VERIFICAR_POSICAO ou situação desconhecida: incerta demais; decisão
        // do usuário: sem mensagem automática, não inventar texto.
        return null;
    }
  }

  // obterLinhaContexto descreve UMA situação só. Quando EM_CARTORIO não é a
  // escolhida mas existe entre os títulos (ex.: ULTIMO_DIA escolhido), o
  // amarelo do relatório ficaria sem explicação: esta linha complementa a
  // principal, não a substitui (ver montarMensagemPersonalizada).
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

  // Mesmo caso, para NEGATIVADO_SCPC (destacado em índigo no relatório) não
  // escolhido: sem esta linha o aviso de suspensão (inclusive o do dia 19)
  // ficaria omitido.
  function obterLinhaNegativadoScpcAdicional(escolhido, dados) {
    if (escolhido.situacaoKey === 'NEGATIVADO_SCPC') return ''; // já coberto pela linha principal

    const negativados = dados.registros.filter((r) => r.situacaoKey === 'NEGATIVADO_SCPC');
    if (negativados.length === 0) return '';

    return textoAvisoScpc(maisUrgenteEntreNegativados(negativados).diasAtrasoReal);
  }

  /** O título negativado mais urgente da lista: dia 19 > janela 16-18 > qualquer outro; empate, mais dias. */
  function maisUrgenteEntreNegativados(negativados) {
    return negativados.reduce((a, b) => {
      const pa = prioridadeUrgenciaScpc(a.diasAtrasoReal);
      const pb = prioridadeUrgenciaScpc(b.diasAtrasoReal);
      if (pb !== pa) return pb > pa ? b : a;
      return b.diasAtrasoReal > a.diasAtrasoReal ? b : a;
    });
  }

  /*
   * Decisão do usuário: cliente SCPC com título de ÚLTIMO DIA e título
   * NEGATIVADO -- a mensagem segue o negativado:
   *   - vale qualquer dia de atraso do negativado até o 19º (acima disso o
   *     título de último dia segue sendo o assunto);
   *   - a frase "Em vermelho, o título no prazo final antes do SCPC" fica;
   *   - o aviso do negativado ABRE (vem antes do vermelho);
   *   - a PERGUNTA FINAL segue o negativado. Com vários, vale o mais urgente.
   *
   * Só a MENSAGEM muda: escolherTituloRepresentativo (Módulo 0) mantém
   * ULTIMO_DIA na frente, pois também decide a faixa da fila (Alt+U) e a
   * nota do contato no CRM.
   *
   * @returns {object|null} O negativado que manda, ou null (escolhido não é
   *   de último dia, ou sem negativado até o 19º).
   */
  function tituloNegativadoQueManda(escolhido, dados) {
    if (escolhido?.situacaoKey !== 'ULTIMO_DIA') return null;
    const candidatos = (dados?.registros ?? []).filter(
      (r) => r.situacaoKey === 'NEGATIVADO_SCPC' && r.diasAtrasoReal <= DIAS_ULTIMO_DIA_SUSPENSAO_SCPC
    );
    return candidatos.length > 0 ? maisUrgenteEntreNegativados(candidatos) : null;
  }

  /* ---------------------------------------------------------------------
   * 2b. VARIANTES DE FRASE (rotação por cliente + dia)
   * -----------------------------------------------------------------
   * Cada lista tem variantes do MESMO papel, firmeza e pedido: trocar entre
   * elas nunca muda o estágio da cobrança (CTA de último dia jamais vira leve).
   * Escolha determinística por (cnpj, dia), ver escolherVariante no Módulo 0.
   *
   * Frases SELECIONADAS PELO USUÁRIO, uma a uma. Não acrescente frase por
   * conta própria.
   * --------------------------------------------------------------------- */
  const FRASES = Object.freeze({
    // EM_ATRASO / PRAZO_FINAL, sem promessa ativa.
    ctaGenerico: Object.freeze([
      'Podemos agendar para hoje o pagamento do débito em aberto?',
      'Consegue regularizar ainda hoje?',
      // Única pergunta ABERTA: não se responde com sim/não e puxa mais retorno.
      'Como podemos resolver isso hoje?',
      'Consegue me confirmar se dá para acertar hoje?',
    ]),

    ctaUltimoDia: Object.freeze([
      'Consegue regularizar hoje para evitarmos o encaminhamento?',
      'Conseguimos quitar isso hoje antes que o título siga para o encaminhamento?',
      'Consegue acertar hoje para o título não seguir para encaminhamento?',
    ]),

    // EM_CARTORIO: fato consumado. Toda variante nomeia o caminho de volta e
    // nenhuma promete o que não se controla.
    ctaCartorio: Object.freeze([
      'Consegue regularizar hoje para eu confirmar a baixa da restrição?',
      'Assim que o pagamento for confirmado, sinalizo em nosso sistema. Consegue regularizar hoje?',
      'Consegue fechar isso hoje? Confirmado o pagamento, já sinalizo a baixa.',
    ]),

    // SCPC 16 a 18 dias: a suspensão ainda NÃO é hoje. Nunca cravar prazo
    // "até o fim do dia" aqui (falso antes do 19º; queima o aviso). Essa
    // frase vive só em ctaUltimoDiaScpc.
    ctaSuspensaoScpc: Object.freeze([
      'Consegue regularizar hoje para evitarmos a suspensão do cadastro?',
      'A suspensão do cadastro é automática se o pagamento não for identificado. Consegue resolver hoje?',
      'Regularizando hoje, o cadastro segue ativo normalmente. Conseguimos agendar?',
    ]),

    // SCPC no 19º dia: o prazo é real.
    ctaUltimoDiaScpc: Object.freeze([
      'Consegue regularizar hoje, o último dia antes da suspensão?',
      'Sem a identificação do pagamento até o fim do dia o cadastro é suspenso automaticamente. Consegue resolver hoje?',
    ]),

    // Retomada de contato. A primeira AFIRMA que o cliente não retornou (errado
    // se ele respondeu e não pagou); fica por decisão do usuário. As outras
    // duas não afirmam nada sobre o cliente.
    retomada: Object.freeze([
      'Retomando o contato de {{referencia}}, já que ainda não obtivemos retorno.',
      'Voltando aqui sobre o contato de {{referencia}}.',
      'Dando sequência ao contato de {{referencia}}.',
    ]),
  });

  /**
   * Semente da rotação: o cliente da página e o dia de hoje.
   *
   * Sem cnpj (página fora do padrão), usa só o dia: todos recebem a mesma
   * variante naquele dia, sem estourar.
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

    // Avisa em vez de degradar calado: a mensagem segue correta, então sem o
    // aviso a rotação morreria sem ninguém notar se o CRM renomear o parâmetro.
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

  // Confirmado com o usuário: perto do encaminhamento, negativado ou em
  // cartório o CTA é mais específico e urgente, sem ameaça: só nomeia a
  // consequência real (evitar encaminhamento, baixa da restrição, suspensão).
  function obterPerguntaFinal(escolhido, dados) {
    // Último dia + negativado: segue o negativado (tituloNegativadoQueManda).
    // Sem `dados`, comportamento padrão.
    const referencia = tituloNegativadoQueManda(escolhido, dados) ?? escolhido;
    switch (referencia.situacaoKey) {
      case 'ULTIMO_DIA':
        return frase(FRASES.ctaUltimoDia);
      case 'EM_CARTORIO':
        return frase(FRASES.ctaCartorio);
      case 'NEGATIVADO_SCPC': {
        const dias = referencia.diasAtrasoReal;
        if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
          return frase(FRASES.ctaSuspensaoScpc);
        }
        if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
          return frase(FRASES.ctaUltimoDiaScpc);
        }
        return frase(FRASES.ctaCartorio);
      }
      default: // EM_ATRASO, PRAZO_FINAL, SEM_PROTESTO -- estágio inicial, sem pressão
        return obterPerguntaFinalConsiderandoPromessa();
    }
  }

  /**
   * Pergunta final do estágio inicial (EM_ATRASO/PRAZO_FINAL), considerando
   * a promessa ativa: a promessa é o compromisso mais específico e decide o
   * pedido (quem prometeu pagar hoje não recebe "Podemos agendar para hoje?").
   *
   * Só troca a pergunta GENÉRICA. As de ULTIMO_DIA, EM_CARTORIO e
   * NEGATIVADO_SCPC valem com promessa ativa: pedem ação, não agendamento.
   *
   * QUEBRADA não passa por aqui: a linha dela já termina em pergunta.
   *
   * @returns {string}
   */
  function obterPerguntaFinalConsiderandoPromessa() {
    const tipo = window.__contextoAdicional?.promessa?.tipo;

    // Confirmado com o usuário: presume boa-fé; o comprovante fecha o ciclo
    // (permite dar baixa).
    if (tipo === 'DIA_DA_PROMESSA') return 'Assim que efetuar, pode me enviar o comprovante?';

    // Confirmado com o usuário: reconhece que já houve pagamento parcial.
    if (tipo === 'PARCIAL') return 'Consegue quitar o restante hoje?';

    return frase(FRASES.ctaGenerico);
  }

  /*
   * Pedido do usuário: no primeiro dia útil depois de fim de semana/feriado,
   * quem tem o título MAIS atrasado no 2º a 4º dia pode ter pago sem aparecer
   * no CRM. A pergunta final ganha a ressalva pedindo o comprovante. O período
   * ("no fim de semana", "no feriado" ou os dois) vem do Módulo 6
   * (periodoNaoUtilAntesDeHoje).
   *
   * Fora com promessa para hoje (DIA_DA_PROMESSA): a pergunta dela já pede
   * o comprovante.
   */
  const DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL = Object.freeze({ MIN: 2, MAX: 4 });

  function obterRessalvaPagamentoEmDiaNaoUtil(dados) {
    const ctx = window.__contextoAdicional;
    const periodo = ctx?.periodoNaoUtilAntesDeHoje;
    if (!periodo) return '';
    if (ctx?.promessa?.tipo === 'DIA_DA_PROMESSA') return '';
    const dias = (dados?.registros ?? []).map((r) => r.diasAtrasoReal).filter(Number.isFinite);
    if (dias.length === 0) return '';
    const maior = Math.max(...dias);
    if (maior < DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL.MIN || maior > DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL.MAX) return '';
    return `Caso já tenha pago ${periodo}, por gentileza nos encaminhar o comprovante para sinalizar em nosso sistema.`;
  }

  /* ---------------------------------------------------------------------
   * 3.0c LINHAS DE CONTEXTO ADICIONAL (Módulo 6) -- promessa e contato
   * -----------------------------------------------------------------
   * Lê window.__contextoAdicional (Módulo 6). Sem o Módulo 6 ou sem nada
   * relevante, as funções devolvem '' e a mensagem segue sem essas linhas.
   * --------------------------------------------------------------------- */
  // Apresentação: o cliente TEM contato registrado (zero contatos vira
  // mensagem só de identificação, ver semContatoAnterior). Vai logo após a
  // saudação, sem a pergunta de confirmação de responsável.
  //
  // Dois motivos levam à mesma linha (confirmado com o usuário: coexistem):
  //   - contatoAntigo: contato anterior à data de corte (Módulo 6); ele não
  //     deve lembrar.
  //   - nuncaContatadoPorMim: só OUTRO negociador falou com ele; pra ele é a
  //     primeira vez desta pessoa, cabe se apresentar.

  // Nome usado quando o Módulo 6 não está carregado; carregado, vem de
  // ctx.nomeNegociador (usuário logado no CRM).
  const NOME_NEGOCIADOR_PADRAO = 'Isaac';

  // Confirmado: a parte antes do ponto no código do CRM é o primeiro nome
  // ("BIANCA.03665" -> "Bianca"). Sem artigo ("Sou Isaac", não "Sou o
  // Isaac") de propósito: o artigo depende do gênero, que o código não sabe.
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

  // Confirmado com o usuário: com outra razão do grupo vencida, a frase do
  // relatório diz "de cada razão social", sem citar nome/valor. Lê
  // window.__alertaGrupo (Módulo 5, carregado ANTES).
  function temOutraRazaoComVencido() {
    const grupo = window.__alertaGrupo;
    return !!(grupo && grupo.empresasComVencido && grupo.empresasComVencido.length > 0);
  }

  function obterLinhaContatoRecente() {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente) return '';

    // Confirmado com o usuário: "ainda não obtivemos retorno" é falso quando
    // o último contato gerou promessa, qualquer que seja o status atual dela.
    // ctx.promessa só cobre promessa ativa; houvePromessaNoUltimoContato
    // (Módulo 6) cobre a já paga/resolvida. Título que sumiu desde a última
    // visita também é retorno (contradiria o agradecimento de pagamento).
    if (ctx.promessa || ctx.houvePromessaNoUltimoContato || ctx.houveTituloPagoDesdeUltimaVisita) return '';

    // Decisão do usuário: se só OUTRO negociador falou ontem, vale a
    // apresentação e o contato dele não é citado (senão a mensagem se
    // apresenta como primeira vez E retoma conversa alheia). Exclusão
    // explícita: nuncaContatadoPorMim é ortogonal à data de contatoRecente.
    if (ctx.nuncaContatadoPorMim) return '';

    // Confirmado com o usuário: só vale quando o último contato foi EXATAMENTE
    // o dia útil anterior (o Módulo 6 garante; senão contatoRecente não vem).
    // "Ontem" só se for literal; senão o dia da semana (hoje segunda, contato
    // sexta).
    const { ehOntemLiteral, diaSemanaTexto } = ctx.contatoRecente;
    const referencia = ehOntemLiteral ? 'ontem' : diaSemanaTexto;
    return frase(FRASES.retomada).replace('{{referencia}}', referencia);
  }

  // Reconhecer o pagamento antes de cobrar o resto gera cooperação. Só agradece
  // na mesma janela do recontato (contatoRecente, dia útil anterior, Módulo 6).
  // Fora com promessa ativa: a linha de promessa já comenta o pagamento.
  function obterLinhaAgradecimentoPagamento(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.houveTituloPagoDesdeUltimaVisita) return '';
    if (ctx.promessa) return '';

    // Nunca agradece baixa de título ainda aberto nos dados ao vivo: o retrato
    // do Módulo 6 é comparado no carregamento, e com a tabela ainda vazia
    // títulos abertos pareciam "sumidos". Título que saiu da cobrança sem
    // pagamento (acordo, NÃO COBRAR/CARTEIRA, fora do relatório) também não
    // é baixa.
    const informados = ctx.titulosPagosDesdeUltimaVisita || [];
    const abertos = new Set(
      [dados?.registros, dados?.emAcordo, dados?.naoCobrar, dados?.foraDoRelatorio]
        .flatMap((lista) => (Array.isArray(lista) ? lista : []))
        .map((r) => r?.tituloCompleto)
    );
    const titulos = informados.filter((t) => !abertos.has(t));
    if (informados.length > 0 && titulos.length === 0) return '';
    if (titulos.length === 0) return 'Recebemos a baixa de um dos títulos em aberto, obrigado!';
    const titulosTexto = titulos.join(', ');
    return titulos.length > 1
      ? `Recebemos a baixa dos títulos ${titulosTexto}, obrigado!`
      : `Recebemos a baixa do título ${titulosTexto}, obrigado!`;
  }

  /**
   * Converte "dd/mm/aaaa" para Date ao MEIO-DIA (normalizarData, Módulo 0),
   * como o Módulo 6 faz com contatoRecente.data. Meia-noite quebraria o ">="
   * de deveOmitirRelatorio (00:00 >= 12:00 é false) e omitiria o relatório
   * no dia em que apareceu dívida nova.
   *
   * @param {string} texto Data no formato "dd/mm/aaaa".
   * @returns {Date|null} Data ao meio-dia, ou null se o texto não bater no formato.
   */
  function converterDataBrParaDate(texto) {
    const m = (texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return normalizarData(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }

  // Confirmado com o usuário: recontato sem título NOVO vencido desde o
  // último contato não reenvia o relatório (o cliente já viu). Compara o
  // vencimento de cada título com a data do contato mais recente (só existe
  // quando foi no dia útil anterior; ver calcularContextoContato, Módulo 6).
  function deveOmitirRelatorio(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.contatoRecente.data) return false;

    // Confirmado: título que SUMIU da lista (provável pagamento) também é
    // informação nova. Vem do retrato no localStorage por CNPJ (Módulo 6);
    // o CRM não dá a data de pagamento sem trocar o filtro da tabela.
    if (ctx.houveTituloPagoDesdeUltimaVisita) return false;

    // Confirmado: se o contato de ontem já foi recontato (recontatoConsecutivo,
    // Módulo 6), não omite 2+ dias seguidos: volta a enviar o relatório.
    if (ctx.contatoRecente.recontatoConsecutivo) return false;

    const dataUltimoContato = ctx.contatoRecente.data;
    // ">=" (não ">"): título só entra em "registros" com 1+ dia de atraso
    // (DIAS_ATRASO_MIN, Módulo 1); vencimento IGUAL à data do contato não
    // estava atrasado naquele dia e só aparece depois, logo é novo.
    const temTituloNovo = dados.registros.some((r) => {
      const vencimento = converterDataBrParaDate(r.vencimentoTexto);
      return vencimento && vencimento.getTime() >= dataUltimoContato.getTime();
    });
    return !temTituloNovo;
  }

  const FORMAS_CONCORDANCIA_TITULO = Object.freeze({
    do: ['do título', 'dos títulos'],
    ao: ['ao título', 'aos títulos'],
  });

  /**
   * Concorda preposição + "título" com a quantidade real (nunca "do(s)
   * título(s)"). Preposição desconhecida devolve forma neutra em vez de
   * lançar TypeError e derrubar a montagem da mensagem inteira.
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
        // Aprovado pelo usuário: só a quantidade; os números já estão no relatório.
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
   * Junta numa frase só a SITUAÇÃO dos títulos: a linha do representativo
   * mais as complementares de cartório e SCPC.
   *
   * @returns {string|null} Frase montada, ou null quando a situação do
   *   título escolhido não deve gerar mensagem automática.
   */
  function montarLinhaSituacao(escolhido, dados, omitirRelatorio) {
    const linhaContexto = obterLinhaContexto(escolhido, dados, omitirRelatorio);
    if (linhaContexto === null) return null;

    // Complementam (não substituem) a linha principal.
    const cartorioAdicional = obterLinhaEmCartorioAdicional(escolhido, dados, omitirRelatorio);
    const negativadoAdicional = obterLinhaNegativadoScpcAdicional(escolhido, dados);
    // Último dia + negativado (até o 19º): o aviso do negativado ABRE.
    const negativadoAbre = tituloNegativadoQueManda(escolhido, dados) !== null;
    const frases = (negativadoAbre
      ? [negativadoAdicional, linhaContexto, cartorioAdicional]
      : [linhaContexto, cartorioAdicional, negativadoAdicional]
    ).filter(Boolean);
    // Como na legenda (montarLegendaRelatorio): com outras situações, o aviso
    // do 19º dia vai curto.
    const aviso19 = textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC);
    return (frases.length > 1 ? frases.map((f) => (f === aviso19 ? AVISO_ULTIMO_DIA_SCPC_CURTO : f)) : frases).join(' ');
  }

  /**
   * Bloco de contexto da conversa (apresentação, agradecimento, retomada,
   * promessa), uma linha por assunto; cada função decide se tem algo a dizer.
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

  // Confirmado: com 2+ razões vencidas a frase diz "cada razão social"; é
  // frase fechada, não lead-in com ":".
  function montarLinhaRelatorio() {
    return temOutraRazaoComVencido()
      ? 'Segue o relatório atualizado com os débitos em aberto de cada razão social.'
      : 'Segue o relatório atualizado da razão social {{cliente_nome}}.';
  }

  /**
   * O que as cores do relatório significam, numa frase só (vai na legenda da
   * imagem, ver montarLegendaRelatorio; pedido do usuário: mensagens curtas).
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
   * da imagem no WhatsApp.
   */
  function montarLegendaRelatorio(escolhido, dados) {
    const cores = descreverCoresDoRelatorio(dados);
    let avisoScpc = escolhido.situacaoKey === 'NEGATIVADO_SCPC'
      ? textoAvisoScpc(escolhido.diasAtrasoReal)
      : obterLinhaNegativadoScpcAdicional(escolhido, dados);
    // Aprovado pelo usuário: o aviso do 19º dia (175 caracteres) somado às
    // cores passava de 8 linhas no celular; com cores vai a versão curta,
    // mesmo conteúdo. Uma ideia por linha (lê melhor no celular).
    if (cores && avisoScpc === textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC)) avisoScpc = AVISO_ULTIMO_DIA_SCPC_CURTO;
    // Último dia + negativado (até o 19º): o aviso do negativado vem ANTES do vermelho.
    const negativadoAbre = tituloNegativadoQueManda(escolhido, dados) !== null;
    return (negativadoAbre
      ? [montarLinhaRelatorio(), avisoScpc, cores]
      : [montarLinhaRelatorio(), cores, avisoScpc]
    ).filter(Boolean).join('\n');
  }

  const AVISO_ULTIMO_DIA_SCPC_CURTO =
    'Hoje é o último dia antes da suspensão do cadastro; depois dela, os faturamentos podem ser cancelados.';

  /**
   * Decide se a pergunta final entra na mensagem. O critério é "o conteúdo já
   * pede alguma coisa" (só a promessa QUEBRADA embute pergunta), não "já
   * existe conteúdo": senão, sem relatório, as situações graves (linha nunca
   * vazia) ficariam sem pedido de ação.
   */
  function precisaDePerguntaFinal(linhaSituacao, blocoContexto) {
    return !/\?/.test(linhaSituacao) && !/\?/.test(blocoContexto);
  }

  /**
   * Decide se o relatório entra, respeitando a omissão por recontato.
   *
   * Sem nenhuma âncora (linha de situação e bloco sobre a dívida vazios), o
   * cliente receberia só saudação + pergunta genérica sem saber do que se
   * trata: o relatório volta mesmo com omitirRelatorio=true.
   *
   * A âncora é o que fala da DÍVIDA: a apresentação diz quem fala, não do
   * que se trata, e não conta (aprovado pelo usuário). A linha de recontato
   * ("Dando sequência ao contato de ontem.") CONTA: é ela que permite omitir
   * o relatório no recontato; sem ela o relatório voltaria sempre.
   */
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
   * A mesma mensagem como texto corrido: balões separados por linha em
   * branco, sem o marcador da imagem. Derivada das partes (nunca uma segunda
   * montagem, que poderia divergir).
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string|null}
   */
  function montarMensagemPersonalizada(dados) {
    const partes = montarPartesMensagemPersonalizada(dados);
    return partes ? partes.filter((p) => p !== MARCADOR_IMAGEM_RELATORIO).join('\n\n') : null;
  }

  /* ---------------------------------------------------------------------
   * ACORDOS (Módulo 16) -- frases APROVADAS pelo usuário, textuais.
   * Títulos de acordo ATIVA/CONCLUIDA já chegam FORA de dados.registros
   * (Módulo 1 os põe em dados.emAcordo); aqui só se decide o que dizer.
   * --------------------------------------------------------------------- */
  function moeda(valor) {
    // Sem o espaço inseparável do toLocaleString, igual ao texto aprovado
    // ("R$ 770,49").
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
   * Aprovado pelo usuário: frases curtas, TODAS num balão só (um balão por
   * frase estourava 5 balões / 600 caracteres em muitas combinações).
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

  /**
   * Mesma mensagem de montarMensagemPersonalizada, como LISTA DE PARTES (um
   * balão do WhatsApp cada), reaproveitando as mesmas funções de linha.
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string[]|null} Partes com variáveis substituídas (a do
   *   relatório vem como MARCADOR_IMAGEM_RELATORIO), ou null quando não há
   *   mensagem automática.
   */
  function montarPartesMensagemPersonalizada(dados) {
    const ctx = window.__contextoAdicional;

    // Aprovado pelo usuário: a saudação divide o balão com a primeira frase
    // (saudação sozinha seria um balão e uma notificação sem conteúdo).
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

    // omitirRelatorio antes da linha de situação (o texto dela muda sem
    // relatório). blocoContexto só alimenta precisaDePerguntaFinal; cada linha
    // vira sua própria parte.
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

    // A legenda vem DEPOIS do marcador: no WhatsApp cola-se a imagem e, na
    // prévia, a legenda, ambas pelo Win+V (ver textoAvisoDasPartes).
    if (precisaDoRelatorio(omitirRelatorio, linhaSituacao, montarBlocoSobreADivida(dados))) {
      partes.push(MARCADOR_IMAGEM_RELATORIO);
      partes.push(montarLegendaRelatorio(escolhido, dados));
    } else if (linhaSituacao) {
      partes.push(linhaSituacao);
    }
    if (precisaDePerguntaFinal(linhaSituacao, blocoContexto)) {
      const pergunta = obterPerguntaFinal(escolhido, dados);
      const ressalva = obterRessalvaPagamentoEmDiaNaoUtil(dados);
      partes.push(ressalva ? `${pergunta} ${ressalva}` : pergunta);
    }

    return partes.map((parte) => (parte === MARCADOR_IMAGEM_RELATORIO ? parte : substituirVariaveisDaFrase(parte, dados)));
  }

  /*
   * CÓPIA DAS PARTES PRO Win+V (ver copiarPartesParaAreaDeTransferencia).
   *
   * Copia cada parte de texto, em sequência, na ORDEM INVERSA (última primeiro,
   * parte 1 por último): o Win+V mostra a mais recente no topo, então a
   * leitura bate com a ordem de envio.
   *
   * A IMAGEM entra no lugar do MARCADOR_IMAGEM_RELATORIO, via `copiarImagem`
   * (recopiarUltimaImagem, Módulo 1), pra o Win+V ficar na ordem em que o
   * cliente recebe: contexto, imagem, legenda, pergunta. Sem `copiarImagem`,
   * o marcador é pulado.
   *
   * Roda em segundo plano (o Alt+A não espera); o Alt+S ESPERA a confirmação
   * (ver "CONFIRMAÇÃO DA CÓPIA DO Alt+A"). Sem navigator.clipboard (jsdom,
   * navegador antigo), sai calada e o resto do fluxo segue.
   *
   * O navegador EXIGE o documento em foco pro writeText(). Com a aba sem
   * foco (operador foi colar no WhatsApp Desktop no meio do laço) a escrita
   * falha e o clipboard fica com a cópia ANTERIOR: parte duplicada + parte
   * faltando. Por isso, antes de cada cópia, espera document.hasFocus()
   * (aguardarFoco): pausa e retoma quando a aba volta a ter foco.
   */

  /**
   * Espera a aba ter foco (a API de área de transferência exige documento
   * em foco). Resolve na hora se já tem; senão, no próximo evento "focus".
   *
   * @returns {Promise<void>}
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
   * O laço de cópia roda em segundo plano; a escrita de segurança do Alt+S
   * (instalarCorrecaoTextoWhatsApp) não pode competir com ele pela mesma área
   * de transferência, senão uma cópia em voo sobrescreve o texto certo.
   * Por isso toda escrita passa por UMA fila (filaEscritasClipboard) e cada
   * cópia carrega a "geração" em que nasceu (geracaoAtualClipboard): a
   * correção do Alt+S incrementa a geração ANTES de entrar na fila, e as
   * cópias pendentes do laço se veem "velhas" e desistem.
   *
   * O Alt+S primeiro ESPERA a cópia do Alt+A (aguardarCopiaEEnviar), então
   * a escrita de segurança roda com o laço concluído; o cancelamento por
   * geração vale para um NOVO Alt+A no meio do laço.
   */
  let filaEscritasClipboard = Promise.resolve();
  let geracaoAtualClipboard = 0;

  function enfileirarEscritaClipboard(tarefa) {
    filaEscritasClipboard = filaEscritasClipboard.catch(() => {}).then(tarefa);
    return filaEscritasClipboard;
  }

  /*
   * CONFIRMAÇÃO DA CÓPIA DO Alt+A
   * -----------------------------------------------------------------
   * Decidido com o usuário:
   *  - cada parte (e a imagem) tem até TENTATIVAS_COPIA tentativas e só conta
   *    como copiada quando o navegador confirma a escrita;
   *  - o Alt+S apertado durante a cópia ESPERA (aviso "Aguardando o relatório
   *    ir para a área de transferência (k de N)") e segue sozinho;
   *  - se uma parte falha em todas as tentativas, o Alt+S NÃO envia e fica um
   *    aviso vermelho com "Copiar de novo" (ou um novo Alt+A).
   * O estado vale só pro cliente em que o Alt+A foi apertado (a página não
   * recarrega ao trocar de cliente).
   *
   * PRIVACIDADE: o console mostra só posição, tipo (texto/imagem), número da
   * tentativa e o NOME do erro, nunca o texto copiado. CNPJ e partes ficam num
   * WeakMap (internoDaCopia), fora do estado: __atalhosDebug.copiaDoAltADestaPagina()
   * expõe só números e a situação.
   */
  let copiaDoAltA = null;
  const ouvintesDaCopia = new Set();
  const internoDaCopia = new WeakMap(); // estado -> { cnpj, partes, copiarImagem }

  const cnpjDaCopia = (estado) => internoDaCopia.get(estado)?.cnpj;

  function avisarMudancaDaCopia(estado) {
    ouvintesDaCopia.forEach((ouvinte) => {
      try {
        ouvinte(estado);
      } catch (erro) {
        console.warn('[Atalhos] Falha ao atualizar o aviso da cópia:', erro?.name || 'erro');
      }
    });
  }

  /** A cópia do Alt+A deste cliente, ou null (outro cliente / nenhuma). Só consulta. */
  function copiaDoAltADestaPagina() {
    if (!copiaDoAltA || cnpjDaCopia(copiaDoAltA) !== cnpjDaPagina()) return null;
    return copiaDoAltA;
  }

  /** O aviso vermelho é de outro cliente (a página não recarrega ao trocar): sai da tela. */
  function limparAvisoDeOutroCliente() {
    if (copiaDoAltA && cnpjDaCopia(copiaDoAltA) !== cnpjDaPagina()) removerAvisoDaCopia(ID_AVISO_COPIA_FALHOU);
  }

  async function copiarUmaParteComTentativas(parte, copiarImagem, geracao, posicao, total) {
    const ehImagem = parte === MARCADOR_IMAGEM_RELATORIO;
    const tipo = ehImagem ? 'imagem' : 'texto';
    const maximo = CONFIG_ATALHOS.TENTATIVAS_COPIA;
    for (let tentativa = 1; tentativa <= maximo; tentativa++) {
      if (geracao !== geracaoAtualClipboard) return 'cancelada';
      await aguardarFoco();
      if (geracao !== geracaoAtualClipboard) return 'cancelada';
      let motivo = null;
      try {
        if (ehImagem) {
          if ((await copiarImagem()) !== true) motivo = 'imagem não confirmada';
        } else {
          await navigator.clipboard.writeText(parte);
        }
      } catch (erro) {
        motivo = erro?.name || 'erro';
      }
      if (!motivo) {
        if (tentativa > 1) console.log(`[Atalhos] Parte ${posicao} de ${total} (${tipo}) copiada na tentativa ${tentativa}.`);
        return 'ok';
      }
      const semFoco = document.hasFocus() ? '' : ', aba sem foco';
      console.warn(`[Atalhos] Parte ${posicao} de ${total} (${tipo}): tentativa ${tentativa} de ${maximo} falhou (${motivo}${semFoco}).`);
      if (tentativa < maximo) await esperar(CONFIG_ATALHOS.INTERVALO_NOVA_TENTATIVA_COPIA_MS * tentativa);
    }
    return 'falhou';
  }

  /**
   * Copia as partes pra área de transferência, uma a uma, com confirmação.
   *
   * @param {string[]} partes
   * @param {(() => Promise<boolean>)|null} copiarImagem
   * @returns {Promise<'ok'|'falhou'|'cancelada'|'sem-api'>}
   */
  async function copiarPartesParaAreaDeTransferencia(partes, copiarImagem = null) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return 'sem-api';

    const minhaGeracao = ++geracaoAtualClipboard;
    // Ordem de envio invertida: a última cópia fica no topo do Win+V.
    const sequencia = [...partes]
      .reverse()
      .filter((parte) => parte !== MARCADOR_IMAGEM_RELATORIO || typeof copiarImagem === 'function');
    let resolverConclusao = () => {};
    const estado = {
      geracao: minhaGeracao,
      total: sequencia.length,
      confirmadas: 0,
      situacao: 'copiando',
      comImagem: sequencia.includes(MARCADOR_IMAGEM_RELATORIO),
      concluida: null,
    };
    internoDaCopia.set(estado, { cnpj: cnpjDaPagina(), partes, copiarImagem });
    estado.concluida = new Promise((resolve) => { resolverConclusao = resolve; });
    copiaDoAltA = estado;
    removerAvisoDaCopia(ID_AVISO_COPIA_FALHOU);

    const encerrar = (situacao) => {
      estado.situacao = situacao;
      // O aviso na tela nunca pode impedir a espera do Alt+S de terminar.
      try {
        if (situacao === 'falhou') mostrarAvisoFalhaDaCopia(estado);
        avisarMudancaDaCopia(estado);
      } catch (erro) {
        console.warn('[Atalhos] Falha ao atualizar o aviso da cópia:', erro?.name || 'erro');
      }
      resolverConclusao(situacao);
      return situacao;
    };

    for (let i = 0; i < sequencia.length; i++) {
      if (minhaGeracao !== geracaoAtualClipboard) return encerrar('cancelada'); // uma geração mais nova já assumiu (novo Alt+A)
      const parte = sequencia[i];
      const resultado = await enfileirarEscritaClipboard(
        () => copiarUmaParteComTentativas(parte, copiarImagem, minhaGeracao, i + 1, sequencia.length)
      );
      if (resultado !== 'ok') return encerrar(resultado);
      estado.confirmadas++;
      avisarMudancaDaCopia(estado);
      if (i < sequencia.length - 1) await esperar(CONFIG_ATALHOS.INTERVALO_COPIA_PARTES_MS);
    }
    return encerrar('ok');
  }

  /* Avisos da cópia (textos aprovados pelo usuário). */
  const ID_AVISO_COPIA_AGUARDANDO = 'smarttable-aviso-copia-aguardando';
  const ID_AVISO_COPIA_FALHOU = 'smarttable-aviso-copia-falhou';

  function removerAvisoDaCopia(id) {
    document.getElementById(id)?.remove();
  }

  function colocarAvisoFixo(el) {
    const naPilha = window.__smartTableUtil?.colocarNaPilha;
    if (typeof naPilha === 'function') {
      naPilha(el, { fixo: true });
      return;
    }
    Object.assign(el.style, { position: 'fixed', bottom: '150px', right: '24px', zIndex: 999999 });
    document.body.appendChild(el);
  }

  function textoAguardandoCopia(estado) {
    const oQue = estado.comImagem ? 'o relatório' : 'a mensagem';
    return `Aguardando ${oQue} ir para a área de transferência (${estado.confirmadas} de ${estado.total})`;
  }

  function mostrarAvisoAguardandoCopia(estado) {
    let el = document.getElementById(ID_AVISO_COPIA_AGUARDANDO);
    if (!el) {
      el = document.createElement('div');
      el.id = ID_AVISO_COPIA_AGUARDANDO;
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
        pointerEvents: 'none',
      });
      colocarAvisoFixo(el);
    }
    el.textContent = textoAguardandoCopia(estado);
  }

  function mostrarAvisoFalhaDaCopia(estado) {
    removerAvisoDaCopia(ID_AVISO_COPIA_FALHOU);
    const el = document.createElement('div');
    el.id = ID_AVISO_COPIA_FALHOU;
    el.setAttribute('role', 'alert');
    Object.assign(el.style, {
      background: '#FDF3F1',
      color: '#8A2A16',
      border: '1px solid #E8C7BE',
      borderLeft: '5px solid #8A2A16',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '360px',
      pointerEvents: 'auto',
    });
    const titulo = document.createElement('div');
    titulo.dataset.papel = 'titulo';
    titulo.style.fontWeight = '700';
    titulo.textContent = estado.comImagem
      ? 'Relatório não foi para a área de transferência'
      : 'Mensagem não foi para a área de transferência';
    const detalhe = document.createElement('div');
    detalhe.style.marginTop = '4px';
    detalhe.textContent = 'O Alt+S não envia até a cópia dar certo.';
    const botoes = document.createElement('div');
    Object.assign(botoes.style, { display: 'flex', gap: '8px', marginTop: '10px' });
    const estiloBotao = (botao, principal) => Object.assign(botao.style, {
      padding: '6px 12px',
      borderRadius: '6px',
      border: '1px solid #8A2A16',
      background: principal ? '#8A2A16' : 'transparent',
      color: principal ? '#fff' : '#8A2A16',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
    });
    const copiarDeNovo = document.createElement('button');
    copiarDeNovo.type = 'button';
    copiarDeNovo.dataset.papel = 'copiar-de-novo';
    copiarDeNovo.textContent = 'Copiar de novo';
    estiloBotao(copiarDeNovo, true);
    // Clique = gesto do operador com a aba em foco: melhor condição pro clipboard.
    copiarDeNovo.addEventListener('click', () => {
      el.remove();
      const interno = internoDaCopia.get(estado);
      if (!interno || interno.cnpj !== cnpjDaPagina()) return;
      copiarPartesParaAreaDeTransferencia(interno.partes, interno.copiarImagem).catch(falhaInesperadaEmSegundoPlano);
    });
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.dataset.papel = 'fechar';
    fechar.textContent = 'Fechar';
    estiloBotao(fechar, false);
    fechar.addEventListener('click', () => el.remove());
    botoes.append(copiarDeNovo, fechar);
    el.append(titulo, detalhe, botoes);
    colocarAvisoFixo(el);
  }

  // Um Alt+S esperando por vez: apertar de novo durante a espera não
  // agenda um segundo envio.
  let envioAguardandoCopia = null;

  /*
   * O navegador só deixa abrir o WhatsApp por alguns segundos depois da tecla
   * ("ativação do usuário", ~5 s no Chrome), e o Módulo 2 registra o contato
   * ANTES de abri-lo: envio automático fora do prazo registraria e avançaria
   * a fila sem abrir nada. Então o Alt+S só segue sozinho com a ativação
   * válida; depois pede um Alt+S novo (aprovado pelo usuário). Sem a API
   * (jsdom, navegador antigo), segue direto.
   */
  const TEXTO_COPIA_CONFIRMADA_APERTE_ALT_S = 'Cópia confirmada. Aperte Alt+S para enviar.';

  /** Chamadas em segundo plano (sem await): um erro inesperado vira aviso, nunca rejeição sem tratamento. */
  const falhaInesperadaEmSegundoPlano = (erro) => {
    console.warn('[Atalhos] Falha inesperada no envio/cópia:', erro?.name || 'erro');
  };

  function aindaPodeAbrirOWhatsApp() {
    const ativacao = navigator.userActivation;
    return !ativacao || ativacao.isActive === true;
  }

  async function aguardarCopiaEEnviar(copia) {
    if (envioAguardandoCopia === copia) {
      mostrarAvisoAguardandoCopia(copia);
      return;
    }
    envioAguardandoCopia = copia;
    const inicio = Date.now();
    const ouvinte = (estado) => {
      if (estado === copia && estado.situacao === 'copiando') mostrarAvisoAguardandoCopia(copia);
    };
    ouvintesDaCopia.add(ouvinte);
    mostrarAvisoAguardandoCopia(copia);
    let situacao;
    let euSouAEspera = false;
    try {
      situacao = await copia.concluida;
    } finally {
      ouvintesDaCopia.delete(ouvinte);
      // Se um Alt+A novo + Alt+S criaram uma espera mais nova, a trava e o aviso
      // são DELA: o fim desta não pode derrubá-los (um terceiro Alt+S
      // registraria o contato em dobro).
      euSouAEspera = envioAguardandoCopia === copia;
      if (euSouAEspera) {
        removerAvisoDaCopia(ID_AVISO_COPIA_AGUARDANDO);
        envioAguardandoCopia = null;
      }
    }
    if (!euSouAEspera) return; // uma espera mais nova assumiu: ela decide o envio e os avisos
    const podeAbrir = aindaPodeAbrirOWhatsApp();
    console.log(`[Atalhos] Alt+S esperou ${Date.now() - inicio} ms pela cópia do Alt+A (${situacao}; ativação ${podeAbrir ? 'ainda válida' : 'expirada'}).`);
    if (situacao === 'ok') {
      if (cnpjDaCopia(copia) !== cnpjDaPagina()) return; // trocou de cliente durante a espera
      if (!podeAbrir) {
        window.__smartTableUtil?.toast?.(TEXTO_COPIA_CONFIRMADA_APERTE_ALT_S, 8000);
        return;
      }
      acionarRegistrarEEnviar();
      return;
    }
    if (situacao === 'cancelada') {
      window.__smartTableUtil?.toast?.('Alt+S cancelado: o Alt+A foi apertado de novo. Aperte o Alt+S quando a nova cópia terminar.', 8000);
    }
    // 'falhou': o aviso vermelho já está na tela (encerrar).
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

    // Só a parte 1 vai pra caixa: é ela que window.abrirWhatsAppCliente() (da
    // página) lê pro link do WhatsApp (Alt+S, Módulo 2). As demais partes e a
    // imagem ficam no Win+V (ver copiarPartesParaAreaDeTransferencia).
    definirValorControlado(caixa, partes[0]);
    dispararEventosDeMudanca(caixa);
    // A imagem entra no laço, dentro da fila e da geração (recopiar fora da
    // fila cobriria a parte 1 que o Alt+S copiou). O Alt+S no meio do laço
    // ESPERA a confirmação (aguardarCopiaEEnviar).
    const recopiarImagem = window.__avisoCobranca?.recopiarUltimaImagem;
    copiarPartesParaAreaDeTransferencia(partes, typeof recopiarImagem === 'function' ? recopiarImagem : null);
    console.log(
      `[Atalhos] Mensagem dividida em ${partes.length} parte(s) -- parte 1 na caixa de observações, demais em sequência na área de transferência (Win+V).`
    );
    window.__smartTableUtil?.toast?.(textoAvisoDasPartes(partes));
  }

  /**
   * O aviso que aparece depois do Alt+A. Se o texto disser Ctrl+V pra imagem,
   * confira instalarCorrecaoTextoWhatsApp: sem imagem do cliente no Ctrl+V, o
   * Alt+S recopia a parte 1 e a imagem só sai pelo Win+V.
   *
   * @param {string[]} partes
   * @returns {string}
   */
  function textoAvisoDasPartes(partes) {
    return partes.includes(MARCADOR_IMAGEM_RELATORIO)
      ? `Mensagem em ${partes.length} partes -- no WhatsApp, cole a imagem com Ctrl+V e, na legenda dela, o texto que começa com "Segue o relatório" (Win+V).`
      : `Mensagem em ${partes.length} partes -- use o Win+V no WhatsApp pra colar cada uma.`;
  }

  /**
   * Espera o Módulo 5 terminar de ler a aba "Grupo" (até o teto).
   *
   * Com 2+ empresas no grupo, window.__alertaGrupo só aparece até ~2,5s
   * depois da carga; antes disso o Alt+A leria "sem grupo" (sem relatório das
   * outras razões, "razão social X" em vez de "cada razão social"). Mesmo
   * sinal do Módulo 7 (esperarAbaPronta). Sem o Módulo 5, não espera.
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

  // Trava contra Alt+A com o primeiro ainda rodando: sem ela, "Entrar em
  // contato" seria clicado 2x e as abas das outras razões abririam em dobro.
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
    // Acordos (Módulo 16): sem saber o que está em acordo, relatório e mensagem
    // poderiam cobrar título negociado. Espera com teto.
    if (window.__negociacoes?.aguardar) await window.__negociacoes.aguardar();
    // Leitura de acordo que falhou (ou parcela desconhecida): decisão do
    // usuário, avisar e perguntar se segue. O aviso da abertura some em
    // segundos; sem a pergunta, títulos de acordo iriam como vencidos comuns.
    // Mesmo padrão do window.confirm do Módulo 8.
    const avisoAcordos = window.__negociacoes?.avisoPendente?.();
    if (avisoAcordos && !window.confirm(`${avisoAcordos}\n\nSeguir com o Alt+A mesmo assim?`)) return;

    // Passo 0: relatório das outras razões vencidas, em aba de fundo (resolve
    // na hora sem outra razão).
    await gerarRelatoriosDasOutrasRazoes();

    const ctx = window.__contextoAdicional;
    // Tudo em acordo: só a parcela, sem relatório (decisão do usuário).
    let soAcordo = false;
    try {
      const dadosAgora = window.__avisoCobranca?.simular?.();
      soAcordo = !!dadosAgora && dadosAgora.registros.length === 0 && (dadosAgora.emAcordo?.length ?? 0) > 0;
    } catch (erro) {
      soAcordo = false;
    }
    const semRelatorio = !!(ctx && ctx.semContatoAnterior) || soAcordo;

    // Espera a caixa de observações existir de verdade (não um tempo fixo: o
    // modal pode demorar e a escrita desistiria em silêncio) e avisa na tela
    // (toast) se nem assim aparecer.
    async function abrirContatoEEscrever() {
      // Passo 2: abre a tela de contato (mesma ação do Alt+C); pára se não
      // achou o botão.
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

      // Passo 3: escreve a mensagem na caixa e para, pra revisão antes do Alt+S.
      escreverMensagemPersonalizada();
      liberarFocoInvoluntario();
    }

    if (semRelatorio) {
      // Primeiro contato / só acordo não citam relatório: pula pro passo 2.
      await abrirContatoEEscrever();
      return;
    }

    // Passo 1: gera o relatório (mesma ação do Alt+R) e espera o SINAL de
    // término (botão reabilitado, ver esperarRelatorioProntoNaJanela). Espera
    // fixa não serve: o html2canvas baixa de um CDN no clique, e com a
    // biblioteca fria o modal de contato abria por cima da captura em curso.
    // O teto evita travar o Alt+A.
    const botaoRelatorio = acionarGerarRelatorio();

    if (!botaoRelatorio) {
      // Sem botão, segue: não perde a mensagem por causa do relatório.
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
   * Decisão do usuário: o Alt+S abre o APP DESKTOP (como abrirWhatsAppCliente()
   * faz), sem forçar web.whatsapp.com nem abas separadas. Fica só a rede de
   * segurança: copia a mensagem, pra um Ctrl+V resolver se o app abrir sem o
   * texto (o handoff ocasionalmente perde).
   * --------------------------------------------------------------------- */
  /*
   * IMAGEM DESTE CLIENTE NO Ctrl+V (aprovado pelo usuário)
   * -----------------------------------------------------------------
   * Imagens de clientes anteriores ficam no Win+V (nenhuma página apaga) e as
   * miniaturas se parecem: o relatório já foi pro cliente errado. Quando a
   * cópia do Alt+A deste cliente foi confirmada e tem imagem, o Alt+S deixa
   * como ÚLTIMO item copiado a imagem DESTE cliente (Ctrl+V no WhatsApp). A
   * parte 1 continua logo abaixo no histórico; se o operador editou a caixa,
   * o texto editado é copiado antes da imagem.
   *
   * A imagem só é escrita com a aba EM FOCO, na hora do Alt+S; sem foco,
   * desiste (copiar depois deixaria no Ctrl+V a imagem de cliente já enviado).
   *
   * @returns {Promise<boolean>|null} null quando não há imagem a deixar no
   *   Ctrl+V (segue o fluxo antigo, só texto); senão, se a imagem ficou.
   */
  function instalarCorrecaoTextoWhatsApp() {
    const caixa = encontrarCaixaDeObservacoes();
    const mensagem = caixa ? caixa.value.trim() : '';
    if (!mensagem) return null; // nada pra copiar: o fluxo normal segue (e avisa o erro)
    const copia = copiaDoAltADestaPagina();
    const interno = copia ? internoDaCopia.get(copia) : null;
    if (copia?.situacao === 'ok' && copia.comImagem && typeof interno?.copiarImagem === 'function') {
      if (cnpjDoUltimoRelatorio === cnpjDaPagina()) return copiarMensagemEImagem(mensagem, interno);
      console.warn('[Atalhos] O último relatório gerado nesta página não é deste cliente -- a imagem não vai para o Ctrl+V.');
      window.__smartTableUtil?.toast?.(TEXTO_IMAGEM_FORA_DO_CTRL_V, 8000);
    }
    copiarMensagemAgora(mensagem);
    return null;
  }

  function copiarMensagemEImagem(mensagem, interno) {
    const geracao = ++geracaoAtualClipboard;
    const parte1 = String(interno.partes?.[0] ?? '').trim();
    return enfileirarEscritaClipboard(async () => {
      if (mensagem !== parte1 && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(mensagem);
        } catch (erro) {
          console.warn('[Atalhos] Não consegui copiar a mensagem editada:', erro?.name || 'erro');
        }
      }
      return copiarImagemParaOCtrlV(interno.copiarImagem, geracao);
    });
  }

  async function copiarImagemParaOCtrlV(copiarImagem, geracao) {
    const maximo = CONFIG_ATALHOS.TENTATIVAS_COPIA;
    for (let tentativa = 1; tentativa <= maximo; tentativa++) {
      if (geracao !== geracaoAtualClipboard) return false;
      if (!document.hasFocus()) {
        console.warn(`[Atalhos] Imagem para o Ctrl+V: aba sem foco na tentativa ${tentativa} -- não copio depois (evita imagem de outro cliente no Ctrl+V).`);
        return false;
      }
      let motivo = null;
      try {
        if ((await copiarImagem()) !== true) motivo = 'imagem não confirmada';
      } catch (erro) {
        motivo = erro?.name || 'erro';
      }
      if (!motivo) return true;
      console.warn(`[Atalhos] Imagem para o Ctrl+V: tentativa ${tentativa} de ${maximo} falhou (${motivo}).`);
      if (tentativa < maximo) await esperar(CONFIG_ATALHOS.INTERVALO_TENTATIVA_IMAGEM_CTRL_V_MS);
    }
    return false;
  }

  const TEXTO_IMAGEM_FORA_DO_CTRL_V = 'A imagem não ficou no Ctrl+V -- no WhatsApp, cole a imagem pelo Win+V.';

  // Um envio por vez enquanto o Alt+S espera a imagem: um segundo Alt+S
  // nesse intervalo registraria o MESMO contato duas vezes.
  let envioEsperandoImagem = false;

  async function concluirEnvioDepoisDaImagem(imagemNoCtrlV) {
    envioEsperandoImagem = true;
    try {
      let temporizador = null;
      const teto = new Promise((resolve) => { temporizador = setTimeout(() => resolve('tempo'), CONFIG_ATALHOS.TIMEOUT_IMAGEM_CTRL_V_MS); });
      let resultado;
      try {
        resultado = await Promise.race([imagemNoCtrlV, teto]);
      } finally {
        clearTimeout(temporizador);
      }
      if (resultado !== true) {
        console.warn(`[Atalhos] A imagem do relatório não ficou no Ctrl+V (${resultado === 'tempo' ? 'passou do tempo' : 'falhou'}).`);
        window.__smartTableUtil?.toast?.(TEXTO_IMAGEM_FORA_DO_CTRL_V, 8000);
      }
      if (!aindaPodeAbrirOWhatsApp()) {
        window.__smartTableUtil?.toast?.(TEXTO_COPIA_CONFIRMADA_APERTE_ALT_S, 8000);
        return;
      }
      clicarRegistrarEEnviar();
    } finally {
      envioEsperandoImagem = false;
    }
  }

  function copiarMensagemAgora(mensagem) {
    // Cancela cópias pendentes do laço do Alt+A (por geração). Sem
    // aguardarFoco() de propósito: a aba está em foco agora e esperar
    // atrasaria a escrita pra depois de o WhatsApp roubar o foco.
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
   * 3.0e NÚMEROS DIFERENTES -- Alt+S em sequência
   * -----------------------------------------------------------------
   * Com "Números diferentes" marcado (Módulo 5) e outra razão do grupo com
   * vencido, a mesma mensagem vai pra 1 + N números:
   *
   *   1º Alt+S -> o de sempre: Módulo 2 registra e abre o WhatsApp no número
   *               do cliente. Antes do clique grava a "ponte" (localStorage,
   *               síncrono) com mensagem e números; só vale depois que o
   *               Módulo 3 confirma o registro (evento
   *               smarttable:contato-registrado, disparado ANTES do
   *               location.reload() do Módulo 2).
   *   2º Alt+S -> após o reload, abre o 1º número extra, SEM registro (o
   *               Módulo 2 nem é chamado).
   *   3º em diante -> os demais, na ordem inserida.
   *
   * Cada número espera um Alt+S porque o navegador só abre o WhatsApp a
   * partir de gesto do usuário, e não há aba do WhatsApp pra "esperar
   * fechar" (Desktop não abre aba; Web reaproveita uma só). O Alt+S de quem
   * voltou pro CRM é o sinal de que a mensagem anterior foi.
   *
   * Não toca o Módulo 2 (protegido).
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
    // Mesmo critério do banner do Módulo 1: sobrou só NÃO COBRAR / CARTEIRA
    // (ou tudo em cartório, tratado igual).
    if (dados && (dados.registros?.length ?? 0) === 0 && (dados.naoCobrar?.length ?? 0) > 0) {
      return 'títulos em NÃO COBRAR / CARTEIRA';
    }
    // Tudo que sobrou está "fora do relatório" no ⚠ Alerta: decisão do
    // usuário, fora da cobrança INTEIRA, inclusive das outras razões do grupo.
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

    // Sem saber se há outra razão vencida, não dá pra decidir entre 1 e 1+N
    // envios; errar pra menos perderia cobrança calada.
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
   * Grava a ponte ANTES do clique e a confirma quando o Módulo 3 avisa que o
   * registro deu certo. Sem confirmação, depois do reload nada abre (ver
   * retomarEnvioMultiplo).
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
    id?.unref?.(); // só nos testes (Node)
  }

  // Indireção só pra teste: o jsdom não navega pra whatsapp://.
  const navegacao = {
    ir(url) {
      window.location.href = url;
    },
  };

  /**
   * Abre o WhatsApp num número extra pelo MESMO canal do Módulo 2 (Desktop
   * por padrão, Web com o interruptor do Alt+O). MANTER SINCRONIZADO com
   * construirUrlProtocoloWhatsApp / construirUrlWhatsAppWeb do Módulo 2
   * (protegido, não reusado). O 55 é o prefixo de abrirWhatsAppCliente().
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

    // Avança a ponte ANTES de abrir: no pior caso pula um número (visível),
    // nunca manda em dobro.
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
   * reload. Nunca abre nada sozinho (gesto do usuário, ver cabeçalho).
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
   * 3.0f CLIQUE COM O MOUSE em "Registrar e Enviar" (aprovado: só avisar)
   * -----------------------------------------------------------------
   * Os números diferentes só andam pelo Alt+S. O clique vai direto ao Módulo 2
   * (protegido) e manda só pro número do cliente. Um ouvinte na fase de
   * CAPTURA vê o clique antes dele e NÃO o impede; só avisa. O Alt+S clica por
   * script (isTrusted=false) e não passa por aqui.
   *
   * O Módulo 2 recarrega a página depois do envio: o aviso vai pra
   * sessionStorage e reaparece na volta.
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
    // Envio em sequência já em andamento: abre o próximo número, sem novo registro.
    const cnpj = cnpjDaPagina();
    const pendente = window.__numerosDiferentes?.lerPendente?.();
    if (pendente && pendente.confirmado && cnpj && pendente.cnpj === cnpj) {
      enviarProximoNumero(pendente);
      return;
    }

    if (envioEsperandoImagem) {
      console.log('[Atalhos] Alt+S já está deixando a imagem no Ctrl+V -- ignorado pra não registrar em dobro.');
      window.__smartTableUtil?.toast?.('Registro em andamento -- aguarde.');
      return;
    }

    // O Módulo 2 desabilita o botão durante o POST, mas simularCliqueCompleto
    // pode chamar o handler direto, passando por cima do `disabled`: um 2º
    // Alt+S registraria o MESMO contato duas vezes no CRM.
    const botaoRegistrar = document.getElementById(CONFIG_ATALHOS.ID_BOTAO_REGISTRAR);
    if (botaoRegistrar && botaoRegistrar.disabled) {
      console.log('[Atalhos] Registro já em andamento -- Alt+S ignorado pra não registrar em dobro.');
      window.__smartTableUtil?.toast?.('Registro em andamento -- aguarde.');
      return;
    }

    // O Alt+S só envia com a cópia do Alt+A deste cliente confirmada: espera
    // se ainda copia, recusa se falhou.
    limparAvisoDeOutroCliente();
    const copia = copiaDoAltADestaPagina();
    if (copia?.situacao === 'copiando') {
      aguardarCopiaEEnviar(copia).catch(falhaInesperadaEmSegundoPlano);
      return;
    }
    if (copia?.situacao === 'falhou') {
      console.warn('[Atalhos] Alt+S não enviou: a cópia do Alt+A falhou em todas as tentativas.');
      mostrarAvisoFalhaDaCopia(copia);
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
      // Sem mensagem o Módulo 2 recusa sozinho, então nada a repetir nos extras.
      if (mensagem) armarEnvioMultiplo(cnpj, plano.numeros, mensagem);
    }

    const imagemNoCtrlV = instalarCorrecaoTextoWhatsApp();
    if (imagemNoCtrlV) {
      concluirEnvioDepoisDaImagem(imagemNoCtrlV).catch(falhaInesperadaEmSegundoPlano);
      return;
    }
    clicarRegistrarEEnviar();
  }

  function clicarRegistrarEEnviar() {
    // Chama o gancho do Módulo 3 ANTES do clique: ele arma a interceptação do
    // window.open qualquer que seja a estratégia de clique (onClick direto do
    // React não dispara evento DOM e o avanço da fila falharia em silêncio).
    // Seguro se o listener antigo também disparar (dupla chamada protegida lá).
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
   * O CRM real usa botões ".btn-inserir-frase"; o <select> é fallback. Sem
   * nenhum dos dois, o atalho avisa no console.
   * --------------------------------------------------------------------- */
  function definirValorControlado(elemento, valor) {
    // Setar .value direto não dispara o onChange de campos controlados pelo
    // React; o setter nativo contorna. Cada tipo tem seu prototype
    // (HTMLTextAreaElement, HTMLInputElement...): o errado não acha o setter.
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
   * O texto de data-texto é escrito DIRETO na caixa (não clicamos no botão
   * real, ver acionarSelecionarPrimeiraFrase), então a substituição de
   * variáveis que o app faria no clique é feita aqui.
   *
   * Fonte de dados: window.__avisoCobranca.simular() (Módulo 1).
   *
   * Variáveis SEM resolvedor ({{responsavel_nome}}, {{chave_pix}},
   * {{valor_protestado_atualizado}}: decisão consciente, o CRM não as expõe)
   * ficam com o {{...}} visível na caixa e geram aviso no console, sem
   * adivinhar valor. Vale também pra variável nova sem resolvedor: nunca
   * falha em silêncio.
   * --------------------------------------------------------------------- */
  // Datas pro cliente sem o ano ("vencido em 04/09"), como o usuário escreve.
  // Fora do formato esperado, devolve como veio.
  function encurtarData(textoData) {
    const m = (textoData || '').match(/^(\d{2}\/\d{2})\/\d{4}$/);
    return m ? m[1] : (textoData || '');
  }

  function converterMoedaBrParaNumero(texto) {
    if (!texto) return null;
    // Formato esperado: "R$ 1.234,56".
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

  // Cada resolvedor recebe o retorno de simular() e devolve a string da frase,
  // ou null/undefined se não conseguir. Variável nova = uma linha aqui.
  const RESOLVEDORES_VARIAVEL = {
    cliente_nome: (dados) => {
      const primeiro = dados.registros[0];
      return primeiro ? primeiro.razaoSocial : null;
    },
    quantidade_titulos_vencidos: (dados) => String(dados.registros.length),
    quantidade_titulos_protestados: (dados) =>
      String(dados.registros.filter((r) => r.situacaoKey === 'EM_CARTORIO').length),
    // Falha fechada: se QUALQUER saldo não for entendido, a variável não é
    // resolvida (o {{valor_total_vencido}} fica visível e o console avisa).
    // Tratar saldo ilegível como 0 mandaria valor financeiro ERRADO ao
    // cliente sem nenhum sinal.
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
    // Saudação por horário do relógio (não depende do cliente).
    saudacao: () => {
      const hora = new Date().getHours();
      if (hora < 12) return 'Bom dia, tudo bem?';
      if (hora < 18) return 'Boa tarde, tudo bem?';
      return 'Boa noite, tudo bem?';
    },
    // Vencimento do título escolhido por escolherTituloRepresentativo() (seção 3.0b).
    data_vencimento: (dados) => {
      const escolhido = escolherTituloRepresentativo(dados);
      return escolhido ? encurtarData(escolhido.vencimentoTexto) : null;
    },
  };

  function substituirVariaveisDaFrase(texto, dadosPreCalculados) {
    if (!texto || texto.indexOf('{{') === -1) {
      return texto;
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
    // Estratégia 1 (confirmada no CRM real): botões ".btn-inserir-frase". A
    // ordem muda (o mais recente/favoritado vem primeiro): vale o primeiro
    // visível no momento do atalho.
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

      // Variáveis {{ }} substituídas aqui (seção 3.0a).
      const texto = substituirVariaveisDaFrase(textoOriginal);

      // NÃO clicar no botão da frase: o clique real foca a caixa de
      // observações e trava os atalhos seguintes (briga de foco). Escreve o
      // texto direto na caixa, sem dar foco.
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
   * A URL da lista aceita ?search=... (confirmado: /crm/clientes?search=&
   * negociador=...&filtroScpc=). Preserva os outros parâmetros da URL atual
   * e só troca/adiciona o "search".
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
      // Não deixa Enter/Escape vazarem pro listener global de atalhos.
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
   * A LISTA mora no Módulo 18 (modulo18-log-atualizacoes.js); aqui fica só o
   * painel. O Módulo 18 carrega ANTES deste (ordem do @require); sem ele o
   * painel abre vazio em vez de quebrar.
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
      return null; // localStorage bloqueado: só perde a marcação de NOVO
    }
  }

  function marcarLogComoLido() {
    try {
      if (LOG_ATUALIZACOES[0]) localStorage.setItem(CONFIG_ATALHOS.CHAVE_ULTIMA_VERSAO_VISTA, LOG_ATUALIZACOES[0].versao);
    } catch (erro) {
      /* o log continua abrindo, só repete o "NOVO" */
    }
  }

  /**
   * Versões do log que chegaram depois da última leitura.
   * Primeira vez (nada salvo): nenhuma é marcada (tudo "NOVO" não informa nada).
   *
   * @returns {Set<string>}
   */
  function versoesNaoLidas() {
    const vista = lerUltimaVersaoVista();
    if (!vista) return new Set();
    return new Set(LOG_ATUALIZACOES.filter((e) => compararVersoes(e.versao, vista) > 0).map((e) => e.versao));
  }

  /**
   * Pontes pros painéis dos módulos 9 (Alt+O), 10 (Alt+D), 13 (Alt+K), 14
   * (Alt+M) e 17 (Alt+N): checam a existência em vez de assumir; módulo que
   * não carregou (cache antigo, @require 404) avisa e não derruba os outros.
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

  function alternarPainelConfiguracoes() {
    const painel = window.__painelConfiguracoes;
    if (!painel || typeof painel.alternarPainel !== 'function') {
      console.warn('[Atalhos] O Módulo 9 (painel de configurações) não carregou -- Alt+O sem efeito.');
      window.__smartTableUtil?.toast?.('Painel de configurações não carregou (veja o console).');
      return;
    }
    painel.alternarPainel();
  }

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
      // Mesmo z-index do banner de grupo (Módulo 5): ABAIXO dos modais do CRM (z-50).
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
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(painelNovidadesEl);

    // Marca como lido só DEPOIS de montar: se algo falhar, o "NOVO" não some
    // sem ter sido visto.
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
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(painelAjudaEl);
  }

  /* ---------------------------------------------------------------------
   * 4. LISTENER DE TECLADO
   * --------------------------------------------------------------------- */
  document.addEventListener(
    'keydown',
    function (e) {
      // Única exceção com Shift: Shift+Alt+U REFAZ a fila por prioridade (Alt+U
      // sozinho continua a de hoje). Vem antes da guarda abaixo, que barra
      // Shift. Refazer descarta a fila em andamento e abre ~140 abas de
      // fundo: a tecla extra impede que aconteça por reflexo.
      if (
        e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.repeat &&
        e.code === CONFIG_ATALHOS.TECLA_FILA_PRIORIDADE && !estaDigitando()
      ) {
        e.preventDefault();
        acionarFilaPorPrioridade({ reconstruir: true });
        return;
      }

      // Só Alt sozinho (sem Ctrl/Shift/Meta), pra não colidir com navegador/CRM.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.repeat) return;

      // Exceção só pro Alt+B: com a busca aberta o foco está no input dela e
      // estaDigitando() barraria o próprio toggle. Qualquer outro Alt+letra
      // segue bloqueado enquanto digita (um Alt+S no meio da pesquisa
      // registraria e enviaria a cobrança).
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
          return; // sem a limpeza de foco: o foco na busca é intencional
        default:
          return; // não é atalho nosso
      }

      // Rede de segurança: libera foco preso numa caixa de texto (focus trap)
      // pra o PRÓXIMO atalho não se autobloquear. Repete com atraso porque
      // alguns apps focam campos de forma assíncrona (após re-render).
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

  // Os dois painéis deste módulo entram no registro dos painéis dos Módulos
  // 9 e 10: abrir um fecha os outros.
  window.__smartTableUtil?.registrarPainel?.('novidades', fecharPainelNovidades);
  window.__smartTableUtil?.registrarPainel?.('ajuda', fecharPainelAjuda);

  try {
    retomarEnvioMultiplo();
  } catch (erro) {
    console.warn('[Atalhos] Não consegui retomar o envio pros números diferentes.', erro);
  }
  document.addEventListener('click', aoClicarNoDocumento, true);
  document.addEventListener('click', aoClicarNoBotaoDeRelatorio, true);
  try {
    mostrarAvisoDeCliqueManualPendente();
  } catch (erro) {
    console.warn('[Atalhos] Não consegui mostrar o aviso do clique no botão.', erro);
  }

  // Hook de teste (como window.filaDebug, Módulo 3): expõe a montagem da
  // mensagem do Alt+A e afins sem simular o teclado.
  window.__atalhosDebug = {
    FRASES,
    frase,
    sementeDaFrase,
    montarMensagemPersonalizada,
    montarPartesMensagemPersonalizada,
    textoAvisoDasPartes,
    copiarPartesParaAreaDeTransferencia,
    instalarCorrecaoTextoWhatsApp,
    copiaDoAltADestaPagina,
    tituloNegativadoQueManda,
    TEXTO_IMAGEM_FORA_DO_CTRL_V,
    obterRessalvaPagamentoEmDiaNaoUtil,
    LISTA_ATALHOS,
    alternarPainelAjuda,
    TEXTO_COPIA_CONFIRMADA_APERTE_ALT_S,
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
