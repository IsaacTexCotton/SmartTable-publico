/* =========================================================================
 * MÓDULO 31: EDITOR DE MENSAGENS DO ALT+A (Alt+X) — CRM TexCotton
 * -------------------------------------------------------------------------
 * R2 do catálogo de mensagens (projeto de 05/10/2026). Este módulo é SÓ a tela: o registro dos textos, a leitura do
 * catálogo salvo e a validação moram no Módulo 30 (`window.__catalogoMensagens`).
 *
 * v1.79.0: o diálogo abre e fecha com Alt+X e lista os textos do registro por bloco; cada FORMA (singular, plural, com nome...) mostra o
 * texto em uso e, se foi editado no catálogo publicado, o padrão ao lado, com o selo "editado" (senão, "padrão"). A busca filtra por
 * título e texto (em uso, padrão e rascunho), sem diferenciar acento nem maiúscula.
 * v1.80.0 (R2, etapa 2): EDITA como RASCUNHO. "Editar" abre, na forma, uma caixa por variante (adicionar/remover nos textos com
 * rodízio, com o aviso fixo de que mudar a quantidade muda a frase do dia de cada cliente), botões que inserem as variáveis da forma no
 * cursor, e os problemas (erros e avisos do Módulo 30) ao lado, enquanto digita. O rascunho é gravado sozinho pelo Módulo 30
 * (`salvarRascunho`: atraso, sair do campo, trocar de forma, Fechar edição, Esc e Alt+X) e a forma ganha o selo "rascunho". O Alt+A
 * NUNCA lê o rascunho. Publicar, prévia, histórico e backup vêm nas próximas etapas.
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
    // Atraso entre a última tecla e a gravação do rascunho (a gravação também sai ao sair do campo, trocar de forma e fechar).
    ATRASO_RASCUNHO_MS: 400,
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
  let catalogo = null; // foto do catálogo salvo, lida ao abrir e atualizada a cada gravação do rascunho
  let edicao = null; // a forma em edição: { chave, formaId, def, forma, areas, timer, ultimoFoco, ... } (uma por vez)
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
   * 2. A LISTA DOS TEXTOS E A EDIÇÃO DO RASCUNHO
   * --------------------------------------------------------------------- */

  /** Texto em uso de uma forma: o publicado (já validado pelo Módulo 30) ou o padrão embutido. */
  function emUsoDe(def, forma) {
    return catalogo.publicado[def.chave]?.[forma.id] ?? forma.padrao;
  }
  const foiEditado = (def, forma) => !!catalogo.publicado[def.chave]?.[forma.id];
  /** O rascunho guardado desta forma (lista de variantes) ou null. */
  const rascunhoDe = (def, forma) => catalogo.rascunho?.textos?.[def.chave]?.[forma.id] ?? null;
  /** Esquema salvo mais novo que este código, ou sem armazenamento: o editor fica só para leitura (o Módulo 30 recusaria a gravação). */
  const somenteLeitura = () => catalogo.estado === 'versao-nova' || catalogo.estado === 'sem-armazenamento';

  const SELOS = {
    padrao: ['padrão', CORES.ok, CORES.fundoOk],
    editado: ['editado', CORES.alerta, CORES.fundoAlerta],
    rascunho: ['rascunho', CORES.marca, CORES.fundoMarca],
  };
  function selo(tipo) {
    const [texto, cor, fundo] = SELOS[tipo];
    const e = el('span', { textContent: texto }, {
      fontSize: '11px', fontWeight: '600', padding: '1px 8px', borderRadius: '999px', whiteSpace: 'nowrap', color: cor, background: fundo, border: `1px solid ${cor}`,
    });
    e.dataset.papel = 'selo';
    e.dataset.selo = tipo;
    return e;
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

  /** Tudo o que a busca enxerga de um texto: título e os textos (em uso, padrão e rascunho) de todas as formas. */
  function indexar(def) {
    const palavras = [def.titulo];
    def.formas.forEach((forma) => palavras.push(...emUsoDe(def, forma), ...forma.padrao, ...(rascunhoDe(def, forma) ?? [])));
    indiceDeBusca.set(def.chave, semAcento(palavras.join(' ')));
  }

  /** Os selos de uma forma: editado/padrão (do publicado) e, se há rascunho, "rascunho". */
  function desenharSelos(def, forma, destino) {
    destino.replaceChildren(selo(foiEditado(def, forma) ? 'editado' : 'padrao'), ...(rascunhoDe(def, forma) ? [selo('rascunho')] : []));
  }

  /** Linha de UMA forma: no modo de leitura, as colunas; no de edição, o formulário. */
  function linhaDaForma(def, forma) {
    const editando = !!edicao && edicao.chave === def.chave && edicao.formaId === forma.id;
    const linha = el('div', {}, { marginTop: '8px' });
    linha.dataset.forma = forma.id;
    const cab = el('div', {}, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' });
    const esquerda = el('div', {}, { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
    if (def.formas.length > 1) esquerda.appendChild(el('span', { textContent: forma.rotulo }, { fontSize: '12px', fontWeight: '600', color: CORES.texto }));
    const selos = el('span', {}, { display: 'inline-flex', gap: '6px' });
    selos.dataset.papel = 'selos';
    desenharSelos(def, forma, selos);
    esquerda.appendChild(selos);
    cab.appendChild(esquerda);
    if (!editando && !somenteLeitura()) {
      const botao = botaoTexto('Editar', () => abrirEdicao(def, forma), 'editar');
      botao.setAttribute('aria-label', `Editar: ${def.titulo}${def.formas.length > 1 ? ` — ${forma.rotulo}` : ''}`);
      cab.appendChild(botao);
    }
    linha.appendChild(cab);
    if (editando) {
      edicao.selosEl = selos;
      linha.appendChild(formularioDeEdicao(def, forma));
      return linha;
    }
    // Lado a lado quando cabe; as colunas empilham em tela estreita.
    const colunas = el('div', {}, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 12px' });
    colunas.appendChild(colunaDeTextos('Em uso', emUsoDe(def, forma), 'em-uso'));
    if (foiEditado(def, forma)) colunas.appendChild(colunaDeTextos('Padrão', forma.padrao, 'padrao'));
    if (rascunhoDe(def, forma)) colunas.appendChild(colunaDeTextos('Rascunho', rascunhoDe(def, forma), 'rascunho'));
    linha.appendChild(colunas);
    return linha;
  }

  function cartaoDoTexto(def) {
    const cartao = el('section', {}, { padding: '10px 0 12px', borderBottom: `1px solid ${CORES.borda}` });
    cartao.dataset.chave = def.chave;
    cartao.appendChild(el('div', { textContent: def.titulo }, { fontWeight: '600', fontSize: '14px', color: CORES.tinta }));
    cartao.appendChild(el('div', { textContent: def.quando }, { fontSize: '12px', color: CORES.apagado, marginTop: '1px' }));
    def.formas.forEach((forma) => cartao.appendChild(linhaDaForma(def, forma)));
    indexar(def);
    return cartao;
  }

  /** A linha (no DOM) de uma forma de um texto, ou undefined. */
  function acharLinha(chave, formaId) {
    const cartao = [...painelEl.querySelectorAll('section[data-chave]')].find((c) => c.dataset.chave === chave);
    return cartao && [...cartao.querySelectorAll('[data-forma]')].find((l) => l.dataset.forma === formaId);
  }

  /** Redesenha só a linha de uma forma (o resto da lista, a rolagem e a busca ficam como estão). */
  function substituirLinha(def, forma) {
    acharLinha(def.chave, forma.id)?.replaceWith(linhaDaForma(def, forma));
    indexar(def);
  }

  const botaoTexto = (texto, aoClicar, papel) => {
    const b = el('button', { type: 'button', textContent: texto }, {
      padding: '5px 10px', borderRadius: '8px', border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.texto, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
    });
    b.dataset.papel = papel;
    b.addEventListener('click', aoClicar);
    return b;
  };

  /* ---- edição: uma forma por vez; o rascunho é gravado sozinho (com um pequeno atraso e ao sair do campo) ---- */
  const MOTIVOS_DA_GRAVACAO = {
    cota: 'Não consegui guardar o rascunho: o navegador está sem espaço.',
    'sem-armazenamento': 'Este navegador não deixa guardar o rascunho.',
    'versao-nova': 'O catálogo salvo é de uma versão mais nova que este script: não dá para guardar o rascunho.',
  };
  const MOTIVO_PADRAO_DA_GRAVACAO = 'Não consegui guardar o rascunho.';

  const textosDaEdicao = () => edicao.areas.map((a) => a.ta.value);

  function desenharProblemas() {
    const { erros, avisos } = C.validarLista(edicao.def, textosDaEdicao(), edicao.formaId);
    const itens = [
      ...erros.map((t) => ['erro', `✕ ${t}`, CORES.perigo, CORES.fundoPerigo]),
      ...avisos.map((t) => ['aviso', `⚠ ${t}`, CORES.alerta, CORES.fundoAlerta]),
    ].map(([nivel, texto, cor, fundo]) => {
      const e = el('div', { textContent: texto }, { fontSize: '12px', color: cor, background: fundo, borderRadius: '6px', padding: '4px 8px', margin: '4px 0 0', overflowWrap: 'anywhere' });
      e.dataset.nivel = nivel;
      return e;
    });
    // Só troca quando o conjunto de mensagens mudou: a região é anunciada ao leitor de tela, e trocar a cada tecla repetiria tudo a cada letra.
    const assinatura = itens.map((i) => i.textContent).join('\n');
    if (assinatura === edicao.assinaturaDosProblemas) return;
    edicao.assinaturaDosProblemas = assinatura;
    edicao.problemasEl.replaceChildren(...itens);
  }

  function mostrarErroDaGravacao(texto) {
    edicao.erroEl.textContent = texto;
    edicao.erroEl.hidden = !texto;
  }

  /** Grava o rascunho agora. @returns {boolean} gravou (ou não havia o que gravar) */
  function salvarAgora() {
    if (!edicao) return true;
    clearTimeout(edicao.timer);
    edicao.timer = null;
    const r = C.salvarRascunho(edicao.chave, edicao.formaId, textosDaEdicao());
    if (!r.ok) {
      mostrarErroDaGravacao(MOTIVOS_DA_GRAVACAO[r.motivo] ?? MOTIVO_PADRAO_DA_GRAVACAO);
      return false;
    }
    catalogo = C.lerCatalogo();
    mostrarErroDaGravacao('');
    desenharSelos(edicao.def, edicao.forma, edicao.selosEl);
    edicao.descartarEl.disabled = !rascunhoDe(edicao.def, edicao.forma);
    indexar(edicao.def);
    return true;
  }

  function aoMudarTexto() {
    desenharProblemas();
    clearTimeout(edicao.timer);
    edicao.timer = setTimeout(salvarAgora, CONFIG_EDITOR.ATRASO_RASCUNHO_MS);
  }

  function inserirVariavel(nome) {
    const ta = edicao.ultimoFoco?.isConnected ? edicao.ultimoFoco : edicao.areas[0].ta;
    const trecho = `{{${nome}}}`;
    const ini = ta.selectionStart ?? ta.value.length;
    const fim = ta.selectionEnd ?? ini;
    // O que couber depois de trocar a seleção (a seleção sai, então conta como espaço livre).
    if (ta.value.length - (fim - ini) + trecho.length > C.MAX_CARACTERES_RASCUNHO) return;
    ta.value = ta.value.slice(0, ini) + trecho + ta.value.slice(fim);
    ta.setSelectionRange(ini + trecho.length, ini + trecho.length);
    ta.focus();
    aoMudarTexto();
  }

  function renumerarVariantes() {
    const varias = edicao.areas.length > 1;
    edicao.areas.forEach((a, i) => {
      a.ta.setAttribute('aria-label', edicao.def.rodizio ? `Variante ${i + 1}` : `Texto: ${edicao.def.titulo}${edicao.def.formas.length > 1 ? ` — ${edicao.forma.rotulo}` : ''}`);
      a.rotuloEl.textContent = `Variante ${i + 1}`;
      a.rotuloEl.hidden = !edicao.def.rodizio;
      a.remover.hidden = !edicao.def.rodizio;
      a.remover.disabled = !varias;
      a.remover.setAttribute('aria-label', `Remover variante ${i + 1}`);
    });
    edicao.adicionarEl.disabled = edicao.areas.length >= C.MAX_VARIANTES;
  }

  function adicionarArea(valor) {
    const wrap = el('div', {}, { margin: '6px 0 0' });
    const rotuloEl = el('div', {}, { fontSize: '11px', fontWeight: '600', color: CORES.apagado, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' });
    rotuloEl.dataset.papel = 'rotulo-variante';
    const ta = el('textarea', { value: valor, rows: 2, maxLength: C.MAX_CARACTERES_RASCUNHO, spellcheck: true }, {
      width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '13px', lineHeight: '1.45', fontFamily: 'inherit', color: CORES.tinta,
      border: `1px solid ${CORES.borda}`, borderRadius: '6px', background: CORES.fundo, resize: 'vertical', minHeight: '52px',
    });
    ta.dataset.papel = 'campo';
    ta.addEventListener('input', aoMudarTexto);
    ta.addEventListener('focus', () => { edicao.ultimoFoco = ta; });
    ta.addEventListener('blur', () => { if (edicao?.timer) salvarAgora(); });
    // A mensagem é uma linha só por balão: Enter não abre outra linha (um texto colado com quebra de linha é recusado pela validação).
    // (Enter que confirma uma composição de IME/tecla morta, e Ctrl/Alt/Meta+Enter, ficam como estão.)
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
    });
    const remover = botaoTexto('Remover', () => removerArea(area), 'remover-variante');
    Object.assign(remover.style, { marginTop: '4px' });
    const area = { wrap, ta, rotuloEl, remover };
    wrap.append(rotuloEl, ta, remover);
    edicao.areas.push(area);
    edicao.areasEl.appendChild(wrap);
    return area;
  }

  function removerArea(area) {
    if (edicao.areas.length <= 1) return;
    const i = edicao.areas.indexOf(area);
    edicao.areas.splice(i, 1);
    area.wrap.remove();
    if (edicao.ultimoFoco === area.ta) edicao.ultimoFoco = null;
    renumerarVariantes();
    edicao.areas[Math.min(i, edicao.areas.length - 1)].ta.focus();
    aoMudarTexto();
  }

  function formularioDeEdicao(def, forma) {
    const caixa = el('div', {}, { marginTop: '6px', padding: '10px 12px', border: `1px solid ${CORES.marca}`, borderRadius: '8px', background: '#FAFCFE' });
    caixa.dataset.papel = 'edicao';
    if (def.rodizio) {
      const aviso = el('div', { textContent: 'Mudar a quantidade de variantes muda a frase que cada cliente recebe no dia.' }, {
        fontSize: '12px', color: CORES.alerta, background: CORES.fundoAlerta, borderRadius: '6px', padding: '4px 8px',
      });
      aviso.dataset.papel = 'aviso-rodizio';
      caixa.appendChild(aviso);
    }
    edicao.areasEl = el('div');
    caixa.appendChild(edicao.areasEl);
    edicao.areas = [];
    edicao.valoresIniciais.forEach((v) => adicionarArea(v));
    edicao.adicionarEl = botaoTexto('Adicionar variante', () => {
      if (edicao.areas.length >= C.MAX_VARIANTES) return;
      const nova = adicionarArea('');
      renumerarVariantes();
      nova.ta.focus();
      aoMudarTexto();
    }, 'adicionar-variante');
    Object.assign(edicao.adicionarEl.style, { marginTop: '8px' });
    edicao.adicionarEl.hidden = !def.rodizio;
    caixa.appendChild(edicao.adicionarEl);

    const variaveis = C.variaveisDaForma(def.chave, forma.id) ?? [];
    if (variaveis.length) {
      const faixa = el('div', {}, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '10px' });
      faixa.dataset.papel = 'variaveis';
      faixa.appendChild(el('span', { textContent: 'Variáveis:' }, { fontSize: '12px', color: CORES.apagado }));
      variaveis.forEach((nome) => {
        const b = botaoTexto(`{{${nome}}}`, () => inserirVariavel(nome), 'variavel');
        b.dataset.variavel = nome;
        b.setAttribute('aria-label', `Inserir {{${nome}}}`);
        faixa.appendChild(b);
      });
      caixa.appendChild(faixa);
    }

    edicao.problemasEl = el('div');
    edicao.problemasEl.dataset.papel = 'problemas';
    edicao.problemasEl.setAttribute('role', 'status');
    edicao.problemasEl.setAttribute('aria-live', 'polite');
    caixa.appendChild(edicao.problemasEl);
    edicao.erroEl = el('div', { hidden: true }, { fontSize: '12px', color: CORES.perigo, background: CORES.fundoPerigo, border: `1px solid ${CORES.perigo}`, borderRadius: '6px', padding: '4px 8px', margin: '6px 0 0' });
    edicao.erroEl.dataset.papel = 'erro-gravacao';
    edicao.erroEl.setAttribute('role', 'alert');
    caixa.appendChild(edicao.erroEl);

    const botoes = el('div', {}, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' });
    edicao.descartarEl = botaoTexto('Descartar rascunho', descartarEdicao, 'descartar-rascunho');
    edicao.descartarEl.disabled = !rascunhoDe(def, forma);
    botoes.append(edicao.descartarEl, botaoTexto('Fechar edição', () => fecharEdicao(), 'fechar-edicao'));
    caixa.appendChild(botoes);
    renumerarVariantes();
    return caixa;
  }

  function abrirEdicao(def, forma) {
    if (edicao && !fecharEdicao({ devolverFoco: false })) {
      // A gravação da forma aberta foi recusada: ela fica aberta e o aviso dela é trazido à vista (senão o clique em "Editar" pareceria quebrado).
      edicao.erroEl.scrollIntoView?.({ block: 'nearest' });
      edicao.ultimoFoco?.focus?.();
      return;
    }
    edicao = { chave: def.chave, formaId: forma.id, def, forma, timer: null, ultimoFoco: null, valoresIniciais: [...(rascunhoDe(def, forma) ?? emUsoDe(def, forma))] };
    substituirLinha(def, forma);
    edicao.areas[0].ta.focus();
    desenharProblemas();
  }

  /** Sai da edição (grava antes, a não ser que `salvar` seja false). Com a gravação recusada a edição fica aberta. @returns {boolean} saiu */
  function fecharEdicao({ salvar = true, devolverFoco = true } = {}) {
    const anterior = edicao;
    if (!anterior) return true;
    if (salvar && !salvarAgora()) return false;
    clearTimeout(anterior.timer);
    edicao = null;
    substituirLinha(anterior.def, anterior.forma);
    if (devolverFoco) {
      acharLinha(anterior.chave, anterior.formaId)?.querySelector('[data-papel="editar"]')?.focus();
    }
    return true;
  }

  function descartarEdicao() {
    clearTimeout(edicao.timer);
    const r = C.descartarRascunho(edicao.chave, edicao.formaId);
    if (!r.ok) { mostrarErroDaGravacao(MOTIVOS_DA_GRAVACAO[r.motivo] ?? MOTIVO_PADRAO_DA_GRAVACAO); return; }
    catalogo = C.lerCatalogo();
    fecharEdicao({ salvar: false });
  }

  /**
   * O diálogo vai fechar: grava o que estiver pendente (o rascunho nunca se perde por fechar rápido).
   * Se a gravação for RECUSADA (cota cheia...): quando quem fecha é o usuário (`podeRecusar`), o diálogo NÃO fecha, o aviso da edição vem à
   * vista e o texto digitado fica; quando o fechamento é forçado (outro painel abrindo), o texto se perde e isso é dito num aviso.
   * @returns {boolean} pode fechar
   */
  function descarregarEdicao(podeRecusar) {
    if (!edicao) return true;
    let gravou = false;
    try { gravou = salvarAgora(); } catch (_) { gravou = false; }
    if (!gravou) {
      if (podeRecusar) {
        edicao.erroEl.scrollIntoView?.({ block: 'nearest' });
        edicao.ultimoFoco?.focus?.();
        return false;
      }
      window.__smartTableUtil?.toast?.('Não consegui guardar o rascunho que você estava digitando: o painel foi fechado e esse texto se perdeu.', 9000);
    }
    clearTimeout(edicao.timer);
    edicao = null;
    return true;
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
    if (somenteLeitura()) {
      const aviso = el('div', {
        textContent: catalogo.estado === 'versao-nova'
          ? 'O catálogo salvo é de uma versão mais nova que este script: o editor está só para leitura.'
          : 'Este navegador não deixa guardar rascunhos: o editor está só para leitura.',
      }, { fontSize: '12px', color: CORES.alerta, background: CORES.fundoAlerta, borderRadius: '8px', padding: '6px 10px', marginTop: '10px' });
      aviso.dataset.papel = 'aviso-somente-leitura';
      aviso.setAttribute('role', 'status');
      corpo.appendChild(aviso);
    }
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
    // Esc, ✕, Fechar, clique fora e Alt+X passam devolverFoco (é o usuário fechando); o fechamento forçado por outro painel, não.
    if (!descarregarEdicao(devolverFoco)) return;
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
      // Grava o pendente antes de montar o percurso: a gravação habilita "Descartar rascunho", que precisa entrar nele.
      if (edicao?.timer) salvarAgora();
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
    rodape.appendChild(el('div', { textContent: 'As edições ficam como rascunho neste navegador; publicar vem a seguir. Esc fecha.' }, { fontSize: '12px', color: CORES.apagado }));
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
