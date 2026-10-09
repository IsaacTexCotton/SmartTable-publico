/* =========================================================================
 * MÓDULO 21: ENVIO E CÓPIA (Alt+S) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Tudo o que acontece entre a mensagem estar escrita e ela sair: a cópia das
 * partes para a área de transferência (Win+V, na ordem de envio, com foco,
 * tentativas e fila), a imagem do relatório no Ctrl+V, os avisos de cópia,
 * o Alt+S (registrar e enviar, esperando a cópia confirmar), o envio em
 * sequência para "números diferentes" e o aviso do clique manual em
 * "Registrar e Enviar".
 *
 * Extraído do Módulo 4 sem mudar comportamento: o código foi movido como
 * estava. Única diferença de texto: as constantes que só este código usa
 * passaram de CONFIG_ATALHOS para CONFIG_ENVIO (mesmos valores). Expõe
 * window.__envioCopia (congelado); o Módulo 4 chama e repassa em
 * window.__atalhosDebug.
 *
 * Depende de: Módulo 0 (window.__smartTableUtil), Módulo 19
 * (window.__mensagensCobranca), Módulo 20 (window.__atalhosDom). Lê, se
 * existirem, Módulo 1 (recopiarUltimaImagem), Módulo 3 (window.filaDebug) e
 * Módulo 5. Precisa ser carregado ANTES do Módulo 4.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__envioCopiaCarregado) return;
  window.__envioCopiaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Envio e Cópia');

  const { esperar } = window.__smartTableUtil;
  const { temOutraRazaoComVencido, MARCADOR_IMAGEM_RELATORIO } = window.__mensagensCobranca;
  const { elementoVisivel, clicarBotaoPorTexto, simularCliqueCompleto } = window.__atalhosDom;

  /* ---------------------------------------------------------------------
   * CONFIGURAÇÃO (só o que o envio e a cópia usam)
   * --------------------------------------------------------------------- */
  const CONFIG_ENVIO = {
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
    // Texto do botão (minúsculo) e IDs confirmados via diagnóstico real (mais
    // confiável que texto/classe).
    TEXTO_BOTAO_REGISTRAR: 'registrar e enviar',
    ID_BOTAO_REGISTRAR: 'btn-registrar-enviar',
    ID_CAIXA_OBSERVACOES: 'contato-resumo',
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

  /*
   * O Módulo 1 guarda UMA imagem (a do último relatório, de qualquer
   * cliente). Este módulo lembra DE QUEM foi o último relatório (Alt+A, Alt+R
   * ou clique) e só deixa a imagem no Ctrl+V quando é do cliente da tela;
   * senão o Alt+S colaria a imagem de outro cliente.
   */
  let cnpjDoUltimoRelatorio = null;

  // O Módulo 4 avisa aqui de quem foi o último relatório (Alt+A, Alt+R ou clique).
  function definirCnpjDoUltimoRelatorio(cnpj) {
    cnpjDoUltimoRelatorio = cnpj;
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
    const maximo = CONFIG_ENVIO.TENTATIVAS_COPIA;
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
      if (tentativa < maximo) await esperar(CONFIG_ENVIO.INTERVALO_NOVA_TENTATIVA_COPIA_MS * tentativa);
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
      if (i < sequencia.length - 1) await esperar(CONFIG_ENVIO.INTERVALO_COPIA_PARTES_MS);
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
    const maximo = CONFIG_ENVIO.TENTATIVAS_COPIA;
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
      if (tentativa < maximo) await esperar(CONFIG_ENVIO.INTERVALO_TENTATIVA_IMAGEM_CTRL_V_MS);
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
      const teto = new Promise((resolve) => { temporizador = setTimeout(() => resolve('tempo'), CONFIG_ENVIO.TIMEOUT_IMAGEM_CTRL_V_MS); });
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
    // Mesmo critério do banner do Módulo 1: sobrou só NÃO COBRAR / CARTEIRA.
    // Tudo em cartório NÃO bloqueia mais (v1.96.0): é cobrado normalmente.
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
      CONFIG_ENVIO.TIMEOUT_CONFIRMAR_REGISTRO_MS
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

    if (agora - (p.ultimoEnvioEm ?? 0) < CONFIG_ENVIO.INTERVALO_MINIMO_ENTRE_ENVIOS_MS) {
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
      if (cnpj === p.cnpj && Date.now() - p.criadoEm < CONFIG_ENVIO.JANELA_AVISO_NAO_CONFIRMADO_MS) {
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
    const botao = evento.target?.closest?.(`#${CONFIG_ENVIO.ID_BOTAO_REGISTRAR}`);
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
    const botaoRegistrar = document.getElementById(CONFIG_ENVIO.ID_BOTAO_REGISTRAR);
    if (botaoRegistrar && botaoRegistrar.disabled) {
      console.log('[Atalhos] Registro já em andamento -- Alt+S ignorado pra não registrar em dobro.');
      window.__smartTableUtil?.toast?.('Registro em andamento -- aguarde.');
      return;
    }

    // v1.98.0 (revisão de código): o bloqueio de "não cobrar" vale pro Alt+S
    // COMUM, não só com "Números diferentes". Antes, motivoDeBloqueio só era
    // consultado dentro de planoDoEnvio, que sai cedo sem números extras: um
    // cliente com "Não cobrar" no Alerta (ou tudo "fora do relatório") recebia o envio.
    const bloqueio = motivoDeBloqueio(cnpj);
    if (bloqueio) {
      console.warn(`[Atalhos] Alt+S não enviou: ${bloqueio}.`);
      window.__smartTableUtil?.toast?.(`Envio bloqueado: ${bloqueio}. Nenhuma mensagem foi enviada.`, 8000);
      return;
    }

    // Acordo que não deu pra ler: o Alt+A pergunta se segue; o Alt+S sem passar
    // pelo Alt+A (cópia desta página inexistente) não enviava nem avisava.
    const avisoAcordos = window.__negociacoes?.avisoPendente?.();
    if (avisoAcordos && !copiaDoAltADestaPagina()) {
      console.warn('[Atalhos] Alt+S não enviou: leitura de acordos com problema e sem passar pelo Alt+A.');
      window.__smartTableUtil?.toast?.(`Alt+S não enviou. ${avisoAcordos} Aperte Alt+A (ele pergunta se segue) ou recarregue a página.`, 9000);
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
    const porId = document.getElementById(CONFIG_ENVIO.ID_BOTAO_REGISTRAR);
    if (porId) {
      simularCliqueCompleto(porId);
      return;
    }

    // Estratégia 2 (fallback): busca por texto, caso o ID mude no futuro.
    if (!clicarBotaoPorTexto(CONFIG_ENVIO.TEXTO_BOTAO_REGISTRAR)) {
      console.warn(
        `[Atalhos] Não encontrei o botão #${CONFIG_ENVIO.ID_BOTAO_REGISTRAR} nem um botão com ` +
        `"${CONFIG_ENVIO.TEXTO_BOTAO_REGISTRAR}" no texto. Confirme se a tela de contato está aberta.`
      );
    }
  }

  function encontrarCaixaDeObservacoes() {
    // Estratégia 1 (confirmada no CRM real): ID fixo da caixa.
    const porId = document.getElementById(CONFIG_ENVIO.ID_CAIXA_OBSERVACOES);
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

  window.__envioCopia = Object.freeze({
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
  });
})();
