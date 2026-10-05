/* =========================================================================
 * MÓDULO 31: EDITOR DE MENSAGENS DO ALT+A (Alt+X) — CRM TexCotton
 * -------------------------------------------------------------------------
 * R2 do catálogo de mensagens (projeto de 05/10/2026). Este módulo é SÓ a tela: o registro dos textos, a leitura do
 * catálogo salvo e a validação moram no Módulo 30 (`window.__catalogoMensagens`).
 *
 * v1.79.0 (SÓ LEITURA: nada é gravado e o Alt+A não muda): o diálogo abre e fecha com Alt+X e lista os textos do registro
 * por bloco; cada FORMA (singular, plural, com nome...) mostra o texto em uso e, se foi editado no catálogo publicado, o padrão
 * ao lado, com o selo "editado" (senão, o selo "padrão").
 * A busca filtra por título e texto (em uso e padrão), sem diferenciar acento nem maiúscula. A edição, o rascunho e o
 * publicar vêm nas próximas etapas da R2.
 *
 * VISUAL aprovado pelo usuário (05/10/2026): diálogo centralizado com fundo escurecido, como o Alt+N (Módulo 17): o fundo
 * cobre só a área abaixo do cabeçalho do CRM e fica na camada dos popups (Módulo 0). Esc, "Fechar", ✕ e clique fora fecham;
 * o Tab fica preso no diálogo e, se o foco cair no body, o diálogo reassume.
 *
 * Regras: tudo montado por textContent (nunca HTML); nada de dado de cliente (só os textos do catálogo); sem o Módulo 30
 * o módulo não se registra (o Módulo 4 avisa no Alt+X).
 *
 * Depende de: Módulo 0 (camada dos popups, registro de painéis) e Módulo 30. Carrega antes do Módulo 4.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__editorMensagensCarregado) return;
  if (!window.__catalogoMensagens) {
    console.error('[Editor] O Módulo 30 (catálogo de mensagens) não carregou: o editor (Alt+X) não pode abrir. Atualize o script no Tampermonkey.');
    return;
  }
  window.__editorMensagensCarregado = true;

  const CONFIG_EDITOR = {
    ID_PAINEL: 'smarttable-editor-mensagens',
    ID_FUNDO: 'smarttable-fundo-editor-mensagens',
    // Cabeçalho do CRM (confirmado): header#sit-header, fixo, ~80px, z-50.
    ID_CABECALHO: 'sit-header',
    ALTURA_CABECALHO_PADRAO: 80,
    LARGURA_PAINEL: 760,
    // Camada dos popups nossos: acima do menu dos atalhos e do cabeçalho do CRM (ver Módulo 0).
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  };

  const CORES = {
    tinta: '#16232F', texto: '#344054', apagado: '#98a2b3', borda: '#d0d5dd', fundo: '#ffffff',
    marca: '#1f5f8b', fundoMarca: '#eef4f9', alerta: '#B45309', fundoAlerta: '#FEF3E2',
    ok: '#1B6B4A', fundoOk: '#EFF6F1', perigo: '#B42318', fundoPerigo: '#FDF3F1',
  };

  const C = window.__catalogoMensagens;

  let painelEl = null;
  let fundoEl = null;
  let focoAnterior = null;
  let catalogo = null; // foto do catálogo salvo, lida ao abrir
  let indiceDeBusca = new Map(); // chave do texto -> título + textos (em uso e padrão), sem acento e em minúsculas

  /* ---------------------------------------------------------------------
   * 1. UTILIDADES
   * --------------------------------------------------------------------- */
  function el(tag, props = {}, estilo = {}) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    Object.assign(e.style, estilo);
    return e;
  }

  function visivel(e) {
    if (!e || !e.isConnected) return false;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      if (x.hidden || x.classList.contains('hidden')) return false;
      const cs = window.getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------------
   * 2. A LISTA DOS TEXTOS (só leitura)
   * --------------------------------------------------------------------- */

  /** Texto em uso de uma forma: o publicado (já validado pelo Módulo 30) ou o padrão embutido. */
  function emUsoDe(def, forma) {
    return catalogo.publicado[def.chave]?.[forma.id] ?? forma.padrao;
  }
  const foiEditado = (def, forma) => !!catalogo.publicado[def.chave]?.[forma.id];

  function selo(editado) {
    return el('span', { textContent: editado ? 'editado' : 'padrão' }, {
      fontSize: '11px', fontWeight: '600', padding: '1px 8px', borderRadius: '999px', whiteSpace: 'nowrap',
      color: editado ? CORES.alerta : CORES.ok, background: editado ? CORES.fundoAlerta : CORES.fundoOk,
      border: `1px solid ${editado ? CORES.alerta : CORES.ok}`,
    });
  }

  /** Coluna com as variantes de um texto (uma linha por variante, numeradas quando há mais de uma). */
  function colunaDeTextos(rotulo, textos, papel) {
    const col = el('div', {}, { minWidth: '0' });
    col.dataset.papel = papel;
    col.appendChild(el('div', { textContent: rotulo }, { fontSize: '11px', fontWeight: '600', color: CORES.apagado, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0 2px' }));
    textos.forEach((texto, i) => {
      col.appendChild(el('div', { textContent: textos.length > 1 ? `${i + 1}. ${texto}` : texto }, {
        fontSize: '13px', lineHeight: '1.45', color: CORES.tinta, padding: '4px 8px', margin: '2px 0', borderRadius: '6px', background: '#F7F8FA', border: `1px solid ${CORES.borda}`, overflowWrap: 'anywhere',
      }));
    });
    return col;
  }

  /** Sem acento e em minúsculas: a busca não diferencia "Cartório" de "cartorio". */
  const semAcento = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function cartaoDoTexto(def) {
    const cartao = el('section', {}, { padding: '10px 0 12px', borderBottom: `1px solid ${CORES.borda}` });
    cartao.dataset.chave = def.chave;
    cartao.appendChild(el('div', { textContent: def.titulo }, { fontWeight: '600', fontSize: '14px', color: CORES.tinta }));
    cartao.appendChild(el('div', { textContent: def.quando }, { fontSize: '12px', color: CORES.apagado, marginTop: '1px' }));
    const palavras = [def.titulo];
    def.formas.forEach((forma) => {
      palavras.push(...emUsoDe(def, forma), ...forma.padrao);
      const editado = foiEditado(def, forma);
      const linha = el('div', {}, { marginTop: '8px' });
      linha.dataset.forma = forma.id;
      const cab = el('div', {}, { display: 'flex', alignItems: 'center', gap: '8px' });
      if (def.formas.length > 1) cab.appendChild(el('span', { textContent: forma.rotulo }, { fontSize: '12px', fontWeight: '600', color: CORES.texto }));
      cab.appendChild(selo(editado));
      linha.appendChild(cab);
      // Lado a lado quando cabe; as colunas empilham em tela estreita.
      const colunas = el('div', {}, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 12px' });
      colunas.appendChild(colunaDeTextos('Em uso', emUsoDe(def, forma), 'em-uso'));
      if (editado) colunas.appendChild(colunaDeTextos('Padrão', forma.padrao, 'padrao'));
      linha.appendChild(colunas);
      cartao.appendChild(linha);
    });
    indiceDeBusca.set(def.chave, semAcento(palavras.join(' ')));
    return cartao;
  }

  /** Mostra só os textos que têm TODAS as palavras buscadas; blocos sem texto visível somem. */
  function filtrarLista() {
    const termos = semAcento(painelEl.querySelector('[data-papel="busca"]').value).split(/\s+/).filter(Boolean);
    let visiveis = 0;
    painelEl.querySelectorAll('section[data-chave]').forEach((cartao) => {
      const indice = indiceDeBusca.get(cartao.dataset.chave) ?? '';
      const casa = termos.every((t) => indice.includes(t));
      cartao.hidden = !casa;
      if (casa) visiveis += 1;
    });
    painelEl.querySelectorAll('[data-bloco]').forEach((bloco) => {
      bloco.hidden = !bloco.querySelector('section[data-chave]:not([hidden])');
    });
    painelEl.querySelector('[data-papel="sem-resultado"]').hidden = visiveis > 0;
  }

  function campoDeBusca() {
    const faixa = el('div', {}, { padding: '10px 18px', borderBottom: `1px solid ${CORES.borda}`, background: '#FAFBFC' });
    const campo = el('input', { type: 'search', placeholder: 'Buscar texto…', autocomplete: 'off', spellcheck: false }, {
      width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '13px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', color: CORES.tinta, background: CORES.fundo,
    });
    campo.dataset.papel = 'busca';
    campo.setAttribute('aria-label', 'Buscar texto');
    campo.addEventListener('input', filtrarLista);
    faixa.appendChild(campo);
    return faixa;
  }

  /** Monta a lista inteira: um cabeçalho por bloco (na ordem 1 a 5) e um cartão por texto. */
  function desenharLista(corpo) {
    indiceDeBusca = new Map();
    const lista = el('div');
    lista.dataset.papel = 'lista';
    Object.keys(C.BLOCOS).map(Number).sort((a, b) => a - b).forEach((bloco) => {
      const defs = C.REGISTRO.filter((d) => d.bloco === bloco);
      if (!defs.length) return;
      const secao = el('div', {}, { marginTop: '14px' });
      secao.dataset.bloco = String(bloco);
      const cab = el('h3', { textContent: C.BLOCOS[bloco] }, { margin: '0', fontSize: '13px', fontWeight: '700', color: CORES.marca, textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: '2px', borderBottom: `2px solid ${CORES.fundoMarca}` });
      secao.appendChild(cab);
      defs.forEach((def) => secao.appendChild(cartaoDoTexto(def)));
      lista.appendChild(secao);
    });
    corpo.appendChild(lista);
    const vazio = el('div', { textContent: 'Nenhum texto encontrado.', hidden: true }, { padding: '24px 0', textAlign: 'center', fontSize: '13px', color: CORES.apagado });
    vazio.dataset.papel = 'sem-resultado';
    vazio.setAttribute('role', 'status');
    corpo.appendChild(vazio);
  }

  /* ---------------------------------------------------------------------
   * 3. O DIÁLOGO
   * --------------------------------------------------------------------- */

  /** Fecha o diálogo e o fundo. Só Esc, ✕, Fechar e clique fora devolvem o foco a quem abriu. */
  function fecharPainel({ devolverFoco = false } = {}) {
    if (!painelEl) return;
    fundoEl?.remove();
    painelEl.remove();
    painelEl = null;
    fundoEl = null;
    catalogo = null;
    indiceDeBusca = new Map();
    const volta = focoAnterior;
    focoAnterior = null;
    if (devolverFoco && volta?.isConnected) {
      try { volta.focus({ preventScroll: true }); } catch (_) { /* sem foco a devolver */ }
    }
  }

  /** Base do diálogo: a faixa abaixo do cabeçalho do CRM (fato: header#sit-header, z-50, ~80px). */
  function alturaDoCabecalho() {
    const base = document.getElementById(CONFIG_EDITOR.ID_CABECALHO)?.getBoundingClientRect().bottom;
    return Number.isFinite(base) && base > 0 && base < 200 ? Math.round(base) : CONFIG_EDITOR.ALTURA_CABECALHO_PADRAO;
  }

  /** Folga à esquerda do fundo: 16px, e mais só se o diálogo centralizado de verdade encostaria no menu lateral do CRM. */
  function folgaEsquerda() {
    const menu = window.__smartTableUtil?.margemMenuLateral?.() ?? 0;
    const largura = Math.min(CONFIG_EDITOR.LARGURA_PAINEL, window.innerWidth - 32);
    const esquerdaCentral = (window.innerWidth - largura) / 2;
    return menu > 0 && esquerdaCentral < menu + 16 ? menu + 16 : 16;
  }

  /** O que dá pra focar dentro do diálogo (pro Tab não sair dele). */
  function focaveisDoPainel() {
    return [...painelEl.querySelectorAll('button, input, select, textarea, [data-papel="corpo"]')].filter((e) => !e.disabled && visivel(e));
  }

  /**
   * Rolagem pelo teclado: com o foco no diálogo (ou na lista), as setas, PageUp/PageDown, Home/End e Espaço rolam A LISTA.
   * Sem isto, o navegador rola a página do CRM que está atrás do diálogo (o diálogo tem overflow oculto). Nos campos e botões
   * as teclas seguem nativas (cursor da busca, Espaço no botão).
   */
  function rolarPelaTecla(e) {
    const corpo = painelEl.querySelector('[data-papel="corpo"]');
    if (!corpo || (e.target !== painelEl && e.target !== corpo) || e.altKey || e.ctrlKey || e.metaKey) return false;
    const pagina = Math.max(40, Math.round(corpo.clientHeight * 0.9));
    const passos = {
      ArrowDown: () => corpo.scrollBy(0, 40), ArrowUp: () => corpo.scrollBy(0, -40),
      PageDown: () => corpo.scrollBy(0, pagina), PageUp: () => corpo.scrollBy(0, -pagina),
      Home: () => { corpo.scrollTop = 0; }, End: () => { corpo.scrollTop = corpo.scrollHeight; },
      ' ': () => corpo.scrollBy(0, e.shiftKey ? -pagina : pagina),
    };
    const passo = passos[e.key];
    if (!passo) return false;
    e.preventDefault();
    passo();
    return true;
  }

  function aoTeclar(e) {
    // O Módulo 4 pode fechar o diálogo (Alt+X) na fase de captura e a tecla ainda chegar ao campo que já saiu da tela.
    if (!painelEl) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharPainel({ devolverFoco: true }); return; }
    if (rolarPelaTecla(e)) return;
    if (e.key === 'Tab') {
      // Tab conduzido por nós (mesmo cuidado do Alt+N): o nativo do Chromium às vezes passa por "nenhum elemento".
      const focaveis = focaveisDoPainel();
      e.preventDefault();
      if (!focaveis.length) return;
      const i = focaveis.indexOf(document.activeElement);
      const proximo = i === -1
        ? (e.shiftKey ? focaveis.length - 1 : 0)
        : (i + (e.shiftKey ? -1 : 1) + focaveis.length) % focaveis.length;
      focaveis[proximo].focus();
    }
  }

  function abrirPainel() {
    // Quem tinha o foco antes de abrir (com o diálogo já aberto, vale o da primeira abertura).
    const quemAbriu = painelEl ? focoAnterior : (typeof document.activeElement?.focus === 'function' ? document.activeElement : null);
    window.__smartTableUtil?.fecharOutrosPaineis?.('editorMensagens');
    fecharPainel();
    focoAnterior = quemAbriu;
    catalogo = C.lerCatalogo();

    fundoEl = el('div', { id: CONFIG_EDITOR.ID_FUNDO }, {
      position: 'fixed', top: `${alturaDoCabecalho()}px`, left: '0', right: '0', bottom: '0', zIndex: CONFIG_EDITOR.Z_INDEX_POPUP,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `16px 16px 16px ${folgaEsquerda()}px`, boxSizing: 'border-box',
      background: 'rgba(16, 24, 40, 0.35)',
    });
    // Clique fora do diálogo fecha.
    fundoEl.addEventListener('mousedown', (e) => { if (e.target === fundoEl && e.button === 0) fecharPainel({ devolverFoco: true }); });

    painelEl = el('div', { id: CONFIG_EDITOR.ID_PAINEL, tabIndex: -1 }, {
      display: 'flex', flexDirection: 'column', width: `${CONFIG_EDITOR.LARGURA_PAINEL}px`, maxWidth: '100%', maxHeight: '100%', boxSizing: 'border-box',
      background: CORES.fundo, border: `1px solid ${CORES.borda}`, borderRadius: '12px', overflow: 'hidden',
      boxShadow: '0 20px 48px rgba(16,24,40,0.28)', fontFamily: 'system-ui, -apple-system, sans-serif', color: CORES.texto, outline: 'none',
    });
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-modal', 'true');
    painelEl.setAttribute('aria-label', 'Mensagens do Alt+A');

    const topo = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', padding: '14px 18px 10px', borderBottom: `1px solid ${CORES.borda}` });
    topo.appendChild(el('div', { textContent: 'Mensagens do Alt+A' }, { fontWeight: '700', fontSize: '16px', color: CORES.tinta }));
    const x = el('button', { type: 'button', textContent: '✕' }, { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', color: CORES.apagado, padding: '2px 4px' });
    x.setAttribute('aria-label', 'Fechar (Esc)');
    x.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    topo.appendChild(x);
    painelEl.appendChild(topo);

    painelEl.appendChild(campoDeBusca());

    const meio = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '8px 18px 14px' });
    meio.dataset.papel = 'corpo';
    // Focável (Tab e leitor de tela chegam à lista): a rolagem pelo teclado precisa de foco nela ou no diálogo.
    meio.tabIndex = 0;
    meio.setAttribute('role', 'region');
    meio.setAttribute('aria-label', 'Lista de textos');
    desenharLista(meio);
    painelEl.appendChild(meio);

    const rodape = el('div', {}, { borderTop: `1px solid ${CORES.borda}`, padding: '10px 18px 14px', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    rodape.appendChild(el('div', { textContent: 'Só leitura nesta versão: a edição vem a seguir. Esc fecha.' }, { fontSize: '12px', color: CORES.apagado }));
    const fechar = el('button', { type: 'button', textContent: 'Fechar' }, {
      padding: '9px 14px', borderRadius: '8px', border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.texto, fontSize: '13px', cursor: 'pointer',
    });
    fechar.dataset.papel = 'fechar';
    fechar.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    rodape.appendChild(fechar);
    painelEl.appendChild(rodape);

    painelEl.addEventListener('keydown', (e) => { e.stopPropagation(); aoTeclar(e); });
    fundoEl.appendChild(painelEl);
    document.body.appendChild(fundoEl);
    painelEl.focus();
  }

  function alternarPainel() {
    if (painelEl) fecharPainel({ devolverFoco: true });
    else abrirPainel();
  }

  document.addEventListener('keydown', (e) => {
    if (!painelEl) return;
    if (e.code === 'Escape') { fecharPainel({ devolverFoco: true }); return; }
    // Foco perdido pra página (nenhum elemento focado): o diálogo reassume e trata a tecla.
    if (e.target === document.body || e.target === document.documentElement) {
      painelEl.focus({ preventScroll: true });
      aoTeclar(e);
    }
  });

  window.__smartTableUtil?.registrarPainel?.('editorMensagens', fecharPainel);
  window.__smartTableUtil?.registrarModuloCarregado?.('Editor de Mensagens');

  window.__editorMensagens = {
    abrirPainel,
    fecharPainel,
    alternarPainel,
    estaAberto: () => painelEl !== null,
    CONFIG_EDITOR,
  };
})();
