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

  // Módulos que precisam estar carregados ANTES deste no @require do wrapper:
  // 19 (texto da mensagem), 20 (DOM dos atalhos), 21 (envio e cópia) e 24 (busca
  // rápida do Alt+B). Sem
  // eles, nenhum atalho funciona: avisa alto em vez de quebrar em silêncio no
  // meio do Alt+A.
  const modulosFaltando = [
    ['__mensagensCobranca', 'Módulo 19 (Mensagens de Cobrança)'],
    ['__atalhosDom', 'Módulo 20 (DOM dos Atalhos)'],
    ['__envioCopia', 'Módulo 21 (Envio e Cópia)'],
    ['__buscaRapida', 'Módulo 24 (Busca Rápida)'],
  ].filter(([global]) => !window[global]).map(([, nome]) => nome);
  if (modulosFaltando.length > 0) {
    console.error(`[Atalhos] Faltam módulos que deveriam carregar antes deste: ${modulosFaltando.join('; ')}. Atualize o script no Tampermonkey.`);
    window.__smartTableUtil?.toast?.(`SmartTable: faltam módulos (${modulosFaltando.join('; ')}). Atualize o script no Tampermonkey.`, 12000);
    return;
  }
  const {
    tituloNegativadoQueManda,
    FRASES,
    sementeDaFrase,
    frase,
    obterPerguntaFinal,
    obterRessalvaPagamentoEmDiaNaoUtil,
    deveOmitirRelatorio,
    concordarTitulos,
    MARCADOR_IMAGEM_RELATORIO,
    montarMensagemPersonalizada,
    linhasDoAcordoNoCasoMisto,
    montarPartesMensagemPersonalizada,
    obterDadosParaSubstituicao,
    substituirVariaveisDaFrase,
  } = window.__mensagensCobranca;
  const {
    estaDigitando,
    elementoVisivel,
    encontrarElementoVisivelPorTexto,
    clicarBotaoPorTexto,
    esperarElementoVisivelPorTextoNaJanela,
    esperarCondicaoNaJanela,
    esperarRelatorioProntoNaJanela,
    simularCliqueCompleto,
    liberarFocoInvoluntario,
  } = window.__atalhosDom;
  const {
    aguardarFoco,
    copiaDoAltADestaPagina,
    copiarPartesParaAreaDeTransferencia,
    TEXTO_COPIA_CONFIRMADA_APERTE_ALT_S,
    instalarCorrecaoTextoWhatsApp,
    TEXTO_IMAGEM_FORA_DO_CTRL_V,
    cnpjDaPagina,
    motivoDeBloqueio,
    planoDoEnvio,
    navegacao,
    retomarEnvioMultiplo,
    TEXTO_AVISO_CLIQUE_MANUAL,
    aoClicarNoDocumento,
    mostrarAvisoDeCliqueManualPendente,
    acionarRegistrarEEnviar,
    encontrarCaixaDeObservacoes,
    definirCnpjDoUltimoRelatorio,
    CONFIG_ENVIO,
  } = window.__envioCopia;
  const { abrirBuscaRapida, fecharBuscaRapida, estaBuscaRapidaAberta } = window.__buscaRapida;

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
    // Trechos de texto (minúsculo). O relatório tem ID confirmado: o texto é
    // plano B. Só TEXTO_BOTAO_CONTATO não tem ID confirmado.
    TEXTO_BOTAO_RELATORIO: 'relatório',
    TEXTO_BOTAO_CONTATO: 'contato',
    // Confirmado no CRM real: cada frase padrão é um botão com esta classe,
    // e a ordem deles muda (o mais recente/favoritado aparece primeiro).
    SELETOR_BOTAO_FRASE: '.btn-inserir-frase',
    // Id do botão de relatório, criado pelo Módulo 1. Buscar por ID (não por
    // texto) sobrevive à troca do rótulo pra "Gerando..." durante a geração.
    ID_BOTAO_RELATORIO: 'aviso-cobranca-botao',
    // Última versão cujo log já foi lido (marca como NOVO o que veio depois).
    CHAVE_ULTIMA_VERSAO_VISTA: 'smarttable_ultima_versao_vista',
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

    definirCnpjDoUltimoRelatorio(cnpjDaPagina());
    simularCliqueCompleto(botao);
    return botao;
  }

  /** Clique de MOUSE no botão de relatório: também é um relatório novo (de quem está na tela). */
  function aoClicarNoBotaoDeRelatorio(evento) {
    if (evento?.target?.closest?.(`#${CONFIG_ATALHOS.ID_BOTAO_RELATORIO}`)) definirCnpjDoUltimoRelatorio(cnpjDaPagina());
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
        `[Atalhos] Não encontrei a caixa de observações (#${CONFIG_ENVIO.ID_CAIXA_OBSERVACOES}) pra escrever a mensagem personalizada.`
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
          `[Atalhos] Não encontrei a caixa de observações (#${CONFIG_ENVIO.ID_CAIXA_OBSERVACOES}) pra escrever o texto da frase.`
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
      // Camada dos popups nossos: acima do menu dos atalhos e do cabeçalho do CRM (ver Módulo 0).
      zIndex: window.__smartTableUtil?.Z_INDEX_POPUP,
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
      if (e.code === CONFIG_ATALHOS.TECLA_BUSCA_RAPIDA && estaBuscaRapidaAberta()) {
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
    estaBuscaRapidaAberta,
  };
})();
