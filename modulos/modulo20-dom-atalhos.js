/* =========================================================================
 * MÓDULO 20: DOM DOS ATALHOS — CRM TexCotton
 * -------------------------------------------------------------------------
 * Ferramentas de DOM que os atalhos usam: saber se o operador está digitando,
 * achar elemento visível por texto, clicar como o React espera (onClick
 * interno primeiro, depois eventos de mouse), esperar condição em outra aba
 * same-origin e soltar o foco que o CRM prende num campo.
 *
 * Extraído do Módulo 4 sem mudar comportamento: o código foi movido como
 * estava. Não depende de nenhum outro módulo. Expõe window.__atalhosDom
 * (congelado); é usado pelos Módulos 4 e 21.
 * Precisa ser carregado ANTES do Módulo 21 e do Módulo 4.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__atalhosDomCarregado) return;
  window.__atalhosDomCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('DOM dos Atalhos');


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

  window.__atalhosDom = Object.freeze({
    estaDigitando,
    elementoVisivel,
    encontrarElementoVisivelPorTexto,
    clicarBotaoPorTexto,
    esperarElementoVisivelPorTextoNaJanela,
    esperarCondicaoNaJanela,
    esperarRelatorioProntoNaJanela,
    simularCliqueCompleto,
    liberarFocoInvoluntario,
  });
})();
