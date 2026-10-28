// ==UserScript==
// @name         SmartTable — Ponte WhatsApp Web / CRM
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      0.2.1
// @description  Transfere, por clique explícito, o telefone visível ou o nome da conversa para a busca do SmartTable no CRM.
// @match        https://web.whatsapp.com/*
// @match        https://texhub.texcotton.com.br/crm/*
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/whatsapp-crm-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/whatsapp-crm-bridge.user.js
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const NS = 'smarttable.whatsapp.crm.v1';
  const KEY_PEDIDO = NS + '.pedido';
  const KEY_RESULTADO = NS + '.resultado';
  const KEY_CONSUMIDOR = NS + '.consumidor';
  const EVENTO_BUSCA = 'smarttable:buscar-celular-whatsapp';
  const MAX_IDADE_MS = 2 * 60 * 1000;
  // Identidade desta aba: se mais de uma aba do CRM receber a solicitação,
  // somente uma deve abrir a busca.
  const ID_ABA = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12);
  const hostname = window.location.hostname;

  function normalizarTelefone(valor) {
    let digitos = String(valor ?? '').replace(/\D/g, '');
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
      digitos = digitos.slice(2);
    }
    return digitos.length === 10 || digitos.length === 11 ? digitos : '';
  }

  function visivel(elemento) {
    if (!elemento) return false;
    const estilo = window.getComputedStyle(elemento);
    const retangulo = elemento.getBoundingClientRect();
    return estilo.display !== 'none'
      && estilo.visibility !== 'hidden'
      && retangulo.width > 0
      && retangulo.height > 0;
  }

  function telefoneNoTexto(texto) {
    const achados = new Set();
    const padrao = /\+?\s*(?:55[\s().-]*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]?\d{4}/g;
    for (const correspondencia of String(texto ?? '').matchAll(padrao)) {
      const telefone = normalizarTelefone(correspondencia[0]);
      if (telefone) achados.add(telefone);
    }
    return [...achados];
  }

  function obterTelefoneDaConversa() {
    const main = document.querySelector('#main');
    if (!main) return { erro: 'Abra uma conversa individual antes de buscar no SmartTable.' };

    const header = main.querySelector('header');
    if (!header) return { erro: 'Não consegui identificar o cabeçalho da conversa atual.' };

    // Não tenta adivinhar um cliente a partir dos participantes de um grupo.
    // Os marcadores do WhatsApp variam; prioriza atributos estruturais e rótulos
    // de ação, sem inferir a partir do nome livre do grupo.
    const marcadorGrupo = header.querySelector(
      '[data-testid="group-info"], [data-testid="group-info-header"], [data-testid="default-group"], [data-icon="default-group"]'
    );
    const rotuloGrupo = [header, ...header.querySelectorAll('[title], [aria-label]')]
      .flatMap((elemento) => [
        elemento.getAttribute?.('title') || '',
        elemento.getAttribute?.('aria-label') || '',
      ])
      .some((rotulo) => /(?:group info|group details|view group|informações do grupo|dados do grupo|ver informações do grupo)/i.test(rotulo));
    if (marcadorGrupo || rotuloGrupo) {
      return { erro: 'Esta parece ser uma conversa em grupo. Abra a conversa individual do cliente e tente novamente.' };
    }

    const candidatos = new Set();
    const adicionar = (texto) => {
      for (const numero of telefoneNoTexto(texto)) candidatos.add(numero);
    };

    // Primeiro, atributos e links do cabeçalho da conversa — nunca mensagens.
    for (const elemento of [header, ...header.querySelectorAll('[title], [aria-label], a[href]')]) {
      adicionar(elemento.getAttribute?.('title'));
      adicionar(elemento.getAttribute?.('aria-label'));
      const href = elemento.getAttribute?.('href') || '';
      if (/^(tel:|https?:\/\/wa\.me\/)/i.test(href)) adicionar(href);
    }
    adicionar(header.textContent);

    // Se o número não aparece no cabeçalho, aceita apenas painel/modal de
    // informações visível. Não percorre a lista de chats nem o histórico.
    if (candidatos.size === 0) {
      const paines = [
        ...document.querySelectorAll('[role="dialog"], [data-testid*="drawer"], aside'),
      ].filter(visivel).filter((el) =>
        !el.closest('#pane-side')
        && !el.querySelector('#pane-side')
        && !el.querySelector('#main')
      );

      for (const painel of paines) {
        for (const elemento of [painel, ...painel.querySelectorAll('[title], [aria-label], a[href]')]) {
          adicionar(elemento.getAttribute?.('title'));
          adicionar(elemento.getAttribute?.('aria-label'));
          const href = elemento.getAttribute?.('href') || '';
          if (/^(tel:|https?:\/\/wa\.me\/)/i.test(href)) adicionar(href);
        }
        adicionar(painel.textContent);
      }
    }

    if (candidatos.size === 0) {
      return { erro: 'Telefone não visível. Abra os dados do contato no WhatsApp e tente novamente.' };
    }
    if (candidatos.size > 1) {
      return { erro: 'Encontrei mais de um telefone na área visível. Confira a conversa individual e tente novamente.' };
    }
    return { telefone: [...candidatos][0] };
  }

  // Lê somente o nome primário do cabeçalho; nunca procura nomes no histórico.
  function nomeVisivelDoCabecalho(header) {
    const seletores = [
      '[data-testid="conversation-info-header-chat-title"]',
      'span[dir="auto"][title]',
      'span[dir="auto"]',
      '[title]',
    ];
    const rotuloInterface = /^(?:pesquisar|search|chamada de voz|chamada de vídeo|voice call|video call|ligação|mais opções|more options|dados do contato|contact info|online|digitando\.\.\.|typing\.\.\.)$/i;
    for (const seletor of seletores) {
      for (const elemento of header.querySelectorAll(seletor)) {
        // O WhatsApp pode envolver o título da conversa em um controle clicável.
        // Aceita seletores específicos do título; os genéricos seguem ignorando botões.
        const seletorDoTitulo = seletor === '[data-testid="conversation-info-header-chat-title"]'
          || seletor === 'span[dir="auto"][title]';
        if (!seletorDoTitulo && elemento.closest('button,[role="button"]')) continue;
        const nome = String(elemento.getAttribute('title') || elemento.textContent || '')
          .replace(/\s+/g, ' ').trim();
        if (!nome || nome.length > 160 || rotuloInterface.test(nome)) continue;
        if (telefoneNoTexto(nome).length) continue;
        return nome;
      }
    }
    return '';
  }

  // No padrão "Razão Social - raiz CNPJ - UF - responsável", usa a raiz
  // (oito dígitos) como termo principal. Fora do padrão, usa a primeira palavra.
  function termoBuscaPorNome(nome) {
    const texto = String(nome ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) return '';
    const partes = texto.split(/\s+-\s+/);
    if (partes.length >= 3) {
      const raiz = partes[1].trim();
      const digitos = raiz.replace(/\D/g, '');
      if (/^[\d.\s]+$/.test(raiz) && digitos.length === 8) return digitos;
    }
    const primeira = texto.match(/^[^\s]+/)?.[0] || '';
    return primeira.length >= 2 ? primeira : '';
  }

  function obterConsultaDaConversa() {
    const leitura = obterTelefoneDaConversa();
    if (leitura.telefone) return { tipo: 'telefone', valor: leitura.telefone };

    // Nunca contorna a proteção de grupos nem resolve múltiplos telefones por adivinhação.
    if (/conversa em grupo|mais de um telefone/i.test(leitura.erro || '')) return leitura;

    const header = document.querySelector('#main header');
    if (!header) return { erro: leitura.erro || 'Não consegui identificar o cabeçalho da conversa atual.' };
    const nome = nomeVisivelDoCabecalho(header);
    const termo = termoBuscaPorNome(nome);
    if (!termo) return { erro: 'Não consegui ler o nome no cabeçalho da conversa. Recarregue o WhatsApp e tente novamente.' };
    return { tipo: 'nome', valor: termo };
  }

  function mostrarAvisoWhatsapp(mensagem, ancora) {
    const id = 'smarttable-whatsapp-bridge-status';
    let aviso = document.getElementById(id);
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.id = id;
      Object.assign(aviso.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '12px 16px',
        borderRadius: '8px',
        background: '#16232F',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        font: '13px/1.45 system-ui, sans-serif',
      });
      document.body.appendChild(aviso);
    }
    aviso.textContent = mensagem;
    if (ancora) aviso.dataset.requestId = ancora;
    clearTimeout(aviso._smartTableTimer);
    aviso._smartTableTimer = window.setTimeout(() => aviso.remove(), 6500);
  }

  function iniciarWhatsapp() {
    let ultimoPedidoId = null;
    let botao = null;
    let timeoutPedido = null;

    function criarBotao(header) {
      if (document.getElementById('smarttable-whatsapp-crm-button')) return;
      botao = document.createElement('button');
      botao.id = 'smarttable-whatsapp-crm-button';
      botao.type = 'button';
      botao.textContent = 'Buscar no SmartTable';
      botao.title = 'Tenta o telefone visível e, se não houver, identifica o cliente pelo nome da conversa.';
      Object.assign(botao.style, {
        marginInline: '8px',
        padding: '7px 10px',
        border: '1px solid #b7c8c2',
        borderRadius: '8px',
        background: '#e8f5ee',
        color: '#174b35',
        font: '600 12px system-ui, sans-serif',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      botao.addEventListener('click', () => {
        const encontrado = obterConsultaDaConversa();
        if (encontrado.erro) {
          mostrarAvisoWhatsapp(encontrado.erro);
          return;
        }
        const pedido = {
          id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10),
          tipo: encontrado.tipo,
          valor: encontrado.valor,
          // Mantém o campo antigo para abas que ainda executem a ponte 0.1.x.
          ...(encontrado.tipo === 'telefone' ? { telefone: encontrado.valor } : {}),
          criadoEm: Date.now(),
        };
        ultimoPedidoId = pedido.id;
        botao.disabled = true;
        botao.textContent = 'Enviando busca…';
        try {
          GM_setValue(KEY_PEDIDO, pedido);
          mostrarAvisoWhatsapp('Identificação enviada; aguardando o CRM.', pedido.id);
          clearTimeout(timeoutPedido);
          timeoutPedido = window.setTimeout(() => {
            if (ultimoPedidoId !== pedido.id) return;
            const pendente = GM_getValue(KEY_PEDIDO, null);
            if (pendente?.id === pedido.id) GM_setValue(KEY_PEDIDO, null);
            if (botao) {
              botao.disabled = false;
              botao.textContent = 'Buscar no SmartTable';
            }
            mostrarAvisoWhatsapp('O CRM não confirmou a solicitação. Deixe uma página do CRM aberta e tente novamente.');
          }, 20000);
        } catch {
          botao.disabled = false;
          botao.textContent = 'Buscar no SmartTable';
          mostrarAvisoWhatsapp('Não consegui comunicar com a ponte do SmartTable. Verifique o gerenciador de userscripts.');
        }
      });
      header.appendChild(botao);
    }

    function atualizarBotao() {
      const header = document.querySelector('#main header');
      if (!header) {
        botao?.remove();
        botao = null;
        return;
      }
      criarBotao(header);
      const existente = document.getElementById('smarttable-whatsapp-crm-button');
      if (existente && existente.parentElement !== header) header.appendChild(existente);
      botao = existente || botao;
    }

    GM_addValueChangeListener(KEY_RESULTADO, (_chave, _antigo, novo) => {
      if (!novo || novo.id !== ultimoPedidoId) return;
      clearTimeout(timeoutPedido);
      if (botao) {
        botao.disabled = false;
        botao.textContent = 'Buscar no SmartTable';
      }
      mostrarAvisoWhatsapp(novo.mensagem || (novo.ok ? 'Solicitação concluída no CRM.' : 'Não foi possível iniciar a busca no CRM.'));
    });

    let atualizacaoAgendada = false;
    const observador = new MutationObserver(() => {
      if (atualizacaoAgendada) return;
      atualizacaoAgendada = true;
      window.requestAnimationFrame(() => {
        atualizacaoAgendada = false;
        if (document.documentElement.isConnected) atualizarBotao();
      });
    });
    observador.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => {
      clearTimeout(timeoutPedido);
      observador.disconnect();
      const aviso = document.getElementById('smarttable-whatsapp-bridge-status');
      if (aviso?._smartTableTimer) clearTimeout(aviso._smartTableTimer);
    }, { once: true });
    atualizarBotao();
  }

  function iniciarCrm() {
    let processandoId = null;
    let encerrado = false;
    window.addEventListener('pagehide', () => { encerrado = true; }, { once: true });

    async function processarPedido(pedido) {
      if (!pedido || typeof pedido !== 'object' || !pedido.id) return;
      if (pedido.id === processandoId) return;
      if (Date.now() - Number(pedido.criadoEm) > MAX_IDADE_MS) {
        GM_setValue(KEY_RESULTADO, { id: pedido.id, ok: false, mensagem: 'A solicitação expirou. Clique novamente no WhatsApp.' });
        GM_setValue(KEY_PEDIDO, null);
        return;
      }

      // Compatível com pedidos antigos (campo "telefone") durante atualizações.
      const tipo = pedido.tipo || 'telefone';
      const valorOriginal = pedido.valor ?? pedido.telefone ?? '';
      const valor = tipo === 'nome'
        ? String(valorOriginal).replace(/\s+/g, ' ').trim()
        : normalizarTelefone(valorOriginal);
      if (!['telefone', 'nome'].includes(tipo) || !valor
        || (tipo === 'nome' && valor.length > 100)) {
        GM_setValue(KEY_RESULTADO, {
          id: pedido.id,
          ok: false,
          mensagem: tipo === 'nome' ? 'O nome recebido não é válido para pesquisa.' : 'O telefone recebido não é válido para pesquisa.',
        });
        GM_setValue(KEY_PEDIDO, null);
        return;
      }

      // Todas as abas do CRM recebem a mesma mudança GM. Escalonar a
      // reivindicação e reler o lock evita processar a mesma solicitação em
      // várias abas abertas simultaneamente.
      await new Promise((resolver) => window.setTimeout(resolver, 40 + Math.random() * 120));
      if (encerrado) return;
      const consumidorAtual = GM_getValue(KEY_CONSUMIDOR, null);
      if (consumidorAtual?.pedidoId === pedido.id
        && Number(consumidorAtual.expiraEm) > Date.now()
        && consumidorAtual.tabId !== ID_ABA) return;

      GM_setValue(KEY_CONSUMIDOR, {
        pedidoId: pedido.id,
        tabId: ID_ABA,
        expiraEm: Date.now() + MAX_IDADE_MS,
      });
      await new Promise((resolver) => window.setTimeout(resolver, 40 + Math.random() * 60));
      const consumidorConfirmado = GM_getValue(KEY_CONSUMIDOR, null);
      if (consumidorConfirmado?.pedidoId !== pedido.id || consumidorConfirmado.tabId !== ID_ABA) return;

      processandoId = pedido.id;
      const pagina = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const limite = Date.now() + 10000;
      while (!encerrado && Date.now() < limite && typeof pagina.__buscaRapida?.buscarCelularExterno !== 'function') {
        await new Promise((resolver) => window.setTimeout(resolver, 200));
      }

      if (encerrado) {
        processandoId = null;
        return;
      }

      if (typeof pagina.__buscaRapida?.buscarCelularExterno !== 'function') {
        GM_setValue(KEY_RESULTADO, { id: pedido.id, ok: false, mensagem: 'SmartTable não está pronto nesta página do CRM. Atualize a página e tente novamente.' });
        GM_setValue(KEY_PEDIDO, null);
        processandoId = null;
        return;
      }

      try {
        // Prefixos mantêm o detail como string entre contextos do userscript.
        // A ponte e o Módulo 24 também aceitam o formato antigo (telefone puro).
        const detalhe = tipo === 'nome' ? 'nome:' + valor : 'telefone:' + valor;
        const evento = new pagina.CustomEvent(EVENTO_BUSCA, { detail: detalhe });
        pagina.document.dispatchEvent(evento);
        if (!pagina.document.getElementById('smarttable-busca-rapida')) {
          GM_setValue(KEY_RESULTADO, { id: pedido.id, ok: false, mensagem: 'O SmartTable recebeu o pedido, mas não abriu a busca. Atualize o CRM e tente novamente.' });
        } else {
          GM_setValue(KEY_RESULTADO, { id: pedido.id, ok: true, mensagem: 'Identificação transferida ao CRM. Confira a busca do SmartTable.' });
        }
      } catch {
        GM_setValue(KEY_RESULTADO, { id: pedido.id, ok: false, mensagem: 'Falha ao entregar a identificação ao SmartTable.' });
      } finally {
        GM_setValue(KEY_PEDIDO, null);
        processandoId = null;
      }
    }

    GM_addValueChangeListener(KEY_PEDIDO, (_chave, _antigo, novo) => {
      if (novo) void processarPedido(novo);
    });

    // Cobre o caso em que o CRM estava fechado quando o botão foi clicado.
    const pendente = GM_getValue(KEY_PEDIDO, null);
    if (pendente) void processarPedido(pendente);
  }

  if (hostname === 'web.whatsapp.com') {
    iniciarWhatsapp();
  } else if (hostname === 'texhub.texcotton.com.br' && /^\/crm(?:\/|$)/.test(window.location.pathname)) {
    iniciarCrm();
  }

  // Exposto apenas para testes locais em que o harness define ST_TEST_MODE.
  if (typeof window !== 'undefined' && window.ST_TEST_MODE === true) {
    window.__smartTableWhatsappBridgeTest = Object.freeze({
      normalizarTelefone,
      telefoneNoTexto,
      obterTelefoneDaConversa,
      nomeVisivelDoCabecalho,
      termoBuscaPorNome,
      obterConsultaDaConversa,
    });
  }
})();