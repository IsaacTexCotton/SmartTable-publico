/* =========================================================================
 * MÓDULO 40: MENU + NOVO — AÇÕES NATIVAS DO PERFIL
 * -------------------------------------------------------------------------
 * Agrupa Negociação e Tarefa em um menu compacto no cabeçalho do perfil.
 *
 * O contato já é coberto pelo Registro Rápido do Módulo 34; o botão nativo
 * de Contato fica no DOM, mas oculto para evitar uma segunda entrada.
 * Negociação e Tarefa acionam os controles nativos originais, sem cloná-los.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__menuNovoCarregado) return;
  window.__menuNovoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Menu Novo');

  const ID_CONTAINER = 'smarttable-menu-novo-container';
  const ID_GATILHO = 'smarttable-menu-novo-gatilho';
  const ID_MENU = 'smarttable-menu-novo';
  let observador = null;

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classificarAcao(botao, contatoNativo) {
    if (botao === contatoNativo || /^openModalContato\b/i.test(botao.getAttribute('onclick') || '')) {
      return 'contato';
    }
    const texto = normalizar([
      botao.textContent,
      botao.getAttribute('aria-label'),
      botao.getAttribute('title'),
      botao.getAttribute('onclick'),
    ].filter(Boolean).join(' '));
    if (/negocia/.test(texto)) return 'negociacao';
    if (/tarefa/.test(texto)) return 'tarefa';
    if (/\bcontato\b/.test(texto)) return 'contato';
    return null;
  }

  function encontrarAcoes(container, contatoNativo) {
    const encontradas = new Map();
    const candidatas = Array.from(container.querySelectorAll('button, a'));
    candidatas.forEach((botao) => {
      if (botao.closest('#' + ID_CONTAINER)) return;
      const tipo = classificarAcao(botao, contatoNativo);
      if (!tipo || encontradas.has(tipo)) return;
      encontradas.set(tipo, botao);
    });

    return [
      ['negociacao', 'Negociação', 'Criar negociação'],
      ['tarefa', 'Tarefa', 'Criar tarefa'],
    ].filter(([tipo]) => encontradas.has(tipo))
      .map(([tipo, rotulo, descricao]) => ({ tipo, rotulo, descricao, original: encontradas.get(tipo) }));
  }

  function fecharMenu() {
    const menu = document.getElementById(ID_MENU);
    const gatilho = document.getElementById(ID_GATILHO);
    if (!menu || !gatilho) return;
    menu.hidden = true;
    menu.style.display = 'none';
    gatilho.setAttribute('aria-expanded', 'false');
  }

  function criarItem(acao) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = acao.rotulo;
    item.title = acao.descricao;
    item.setAttribute('role', 'menuitem');
    item.disabled = !!acao.original.disabled;
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      border: '0',
      borderRadius: '6px',
      background: '#FFFFFF',
      color: '#344054',
      fontFamily: 'inherit',
      fontSize: '12px',
      fontWeight: '500',
      textAlign: 'left',
      cursor: item.disabled ? 'not-allowed' : 'pointer',
      opacity: item.disabled ? '0.5' : '1',
    });
    item.addEventListener('mouseenter', () => {
      if (!item.disabled) item.style.background = '#F2F4F7';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = '#FFFFFF';
    });
    item.addEventListener('click', (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      if (item.disabled || !acao.original.isConnected || acao.original.disabled) return;
      fecharMenu();
      // Mantém o alvo nativo e seu caminho original de propagação no DOM.
      acao.original.click();
    });
    return item;
  }

  function instalar() {
    if (!document.body) return false;
    const contatoNativo = document.querySelector('[onclick^="openModalContato"]');
    if (!contatoNativo?.parentElement) return false;
    // Não remover o acesso nativo a Contato até o Registro Rápido do Módulo 34
    // estar efetivamente montado nesta página.
    if (!document.getElementById('smarttable-retorno-registro-rapido')) return false;
    const cabecalho = contatoNativo.parentElement;

    const existentes = document.getElementById(ID_CONTAINER);
    if (existentes?.parentElement === cabecalho) return true;
    existentes?.remove();

    const acoes = encontrarAcoes(cabecalho, contatoNativo);
    // Sem pelo menos duas ações identificadas no mesmo grupo não alteramos
    // o CRM: é mais seguro manter os controles originais do que adivinhar.
    if (acoes.length < 2) return false;

    const container = document.createElement('div');
    container.id = ID_CONTAINER;
    Object.assign(container.style, {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      fontFamily: 'inherit',
    });

    const gatilho = document.createElement('button');
    gatilho.id = ID_GATILHO;
    gatilho.type = 'button';
    gatilho.textContent = '+ Novo';
    gatilho.setAttribute('aria-haspopup', 'menu');
    gatilho.setAttribute('aria-expanded', 'false');
    gatilho.setAttribute('aria-label', 'Criar nova negociação ou tarefa');
    Object.assign(gatilho.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      height: '32px',
      padding: '0 12px',
      border: '1px solid #D0D5DD',
      borderRadius: '8px',
      background: '#FFFFFF',
      color: '#344054',
      fontFamily: 'inherit',
      fontSize: '12.5px',
      fontWeight: '600',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });

    const menu = document.createElement('div');
    menu.id = ID_MENU;
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Criar novo');
    Object.assign(menu.style, {
      display: 'none',
      position: 'absolute',
      top: 'calc(100% + 7px)',
      right: '0',
      zIndex: window.__smartTableUtil?.Z_INDEX_POPUP ?? 55,
      minWidth: '176px',
      padding: '5px',
      background: '#FFFFFF',
      border: '1px solid #D0D5DD',
      borderRadius: '9px',
      boxShadow: '0 8px 24px rgba(16,24,40,.16)',
    });

    // Contato é atendido pelo Registro Rápido do Módulo 34; o botão
    // nativo permanece no DOM para não afetar a estrutura do CRM.
    contatoNativo.dataset.smartTableAcaoOculta = '1';
    contatoNativo.style.display = 'none';

    acoes.forEach((acao) => {
      const item = criarItem(acao);
      menu.appendChild(item);
      // Não move nem clona o controle nativo: preserva listeners e delegação.
      acao.original.dataset.smartTableAcaoOculta = '1';
      acao.original.style.display = 'none';
    });

    gatilho.addEventListener('click', () => {
      const abrir = menu.hidden;
      menu.hidden = !abrir;
      menu.style.display = abrir ? 'block' : 'none';
      gatilho.setAttribute('aria-expanded', String(abrir));
    });

    container.append(gatilho, menu);
    cabecalho.appendChild(container);
    return true;
  }

  function observar() {
    instalar();
    if (observador || !document.body) return;
    observador = new MutationObserver(() => {
      if (!document.getElementById(ID_CONTAINER)) instalar();
    });
    observador.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('pointerdown', (evento) => {
      const container = document.getElementById(ID_CONTAINER);
      if (container && !container.contains(evento.target)) fecharMenu();
    }, true);
    document.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Escape') return;
      const menu = document.getElementById(ID_MENU);
      if (!menu || menu.hidden) return;
      fecharMenu();
      document.getElementById(ID_GATILHO)?.focus();
    });
  }

  window.__menuNovoDebug = Object.freeze({
    instalar,
    encontrarAcoes,
    classificarAcao,
    ID_CONTAINER,
    ID_GATILHO,
    ID_MENU,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observar, { once: true });
  } else {
    observar();
  }
})();
