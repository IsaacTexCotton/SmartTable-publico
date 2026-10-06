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
 * NUNCA lê o rascunho. Publicar, histórico e backup vêm nas próximas etapas (a prévia veio na etapa 3, mais abaixo).
 * R2, etapa 3, P4 (prévia): o botão "Ver prévia" do rodapé troca a lista por uma segunda tela, no mesmo diálogo, com a mensagem COMPLETA que o
 * Alt+A montaria em situações FICTÍCIAS (Módulo 32), "Antes (em uso)" e "Depois (rascunho)", só nas situações que o rascunho muda (com a opção
 * de ver todas), o balão novo e o removido em destaque, os contadores (balões, caracteres, maior balão) e um seletor de variante que vale
 * para todos os textos com rodízio. A prévia só LÊ: não grava nada e não toca na página. Esc volta à lista.
 * P5: sob os contadores do "Depois" entra uma faixa por limite de tamanho estourado (5 balões, 320 por balão, 600 no total, ou 750 com acordo: de 601 a 750 é
 * aviso) e as situações vêm por gravidade (quebrou, erro, aviso, o resto). O erro de tamanho só AVISA: nunca bloqueia o "Publicar" (decisão do usuário).
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
    // Na prévia o diálogo alarga (duas colunas lado a lado); em tela estreita as colunas empilham.
    LARGURA_PREVIA: 1040,
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
  let vista = 'lista'; // 'lista' (os textos), 'previa' (a mensagem completa, antes e depois), 'publicar' ou 'historico'
  let pv = null; // os elementos e o estado da tela da prévia: refeitos a cada abertura do diálogo; só valem com ele aberto
  let pb = null; // os elementos e o estado da tela Publicar (idem)
  let hs = null; // os elementos e o estado da tela Histórico (idem)
  let ui = null; // peças do diálogo que mudam com a vista: título, lista, faixa da busca, dica e botão do rodapé (idem)

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

  /** Habilita ou desabilita um botão (e muda a cara dele: opaco e sem mão quando desabilitado). */
  function habilitarBotao(botao, habilitado) {
    botao.disabled = !habilitado;
    botao.style.opacity = habilitado ? '1' : '0.5';
    botao.style.cursor = habilitado ? 'pointer' : 'not-allowed';
  }

  /* ---- edição: uma forma por vez; o rascunho é gravado sozinho (com um pequeno atraso e ao sair do campo) ---- */
  /** O texto de uma falha ao guardar `oQue` ("o rascunho", "a publicação") no armazenamento do navegador; sem motivo conhecido, o genérico. */
  function textoDaFalha(motivo, oQue) {
    return {
      cota: `Não consegui guardar ${oQue}: o navegador está sem espaço.`,
      'sem-armazenamento': `Este navegador não deixa guardar ${oQue}.`,
      'versao-nova': `O catálogo salvo é de uma versão mais nova que este script: não dá para guardar ${oQue}.`,
    }[motivo] ?? `Não consegui guardar ${oQue}.`;
  }

  const textosDaEdicao = () => edicao.areas.map((a) => a.ta.value);

  const TEXTOS_DO_PADRAO = {
    botao: 'Restaurar o padrão',
    confirmar: 'Trocar o texto em uso pelo padrão? Ele entra como rascunho: você ainda precisa publicar.',
    sim: 'Trocar pelo padrão', // derivado: o botão de confirmar não estava na proposta aprovada
    cancelar: 'Cancelar',
  };
  const igualAoPadrao = () => { const texto = textosDaEdicao(); return texto.length === edicao.forma.padrao.length && texto.every((t, i) => t === edicao.forma.padrao[i]); };

  /** A faixa de um problema: erro (✕, vermelho) ou aviso (⚠, âmbar). Serve ao editor (validação ao digitar) e à prévia (alertas de tamanho). */
  function faixaDeProblema(nivel, texto) {
    const erro = nivel === 'erro';
    const e = el('div', { textContent: `${erro ? '✕' : '⚠'} ${texto}` }, {
      fontSize: '12px', color: erro ? CORES.perigo : CORES.alerta, background: erro ? CORES.fundoPerigo : CORES.fundoAlerta, borderRadius: '6px', padding: '4px 8px', margin: '4px 0 0', overflowWrap: 'anywhere',
    });
    e.dataset.nivel = nivel;
    return e;
  }

  function desenharProblemas() {
    const { erros, avisos } = C.validarLista(edicao.def, textosDaEdicao(), edicao.formaId);
    const itens = [...erros.map((t) => faixaDeProblema('erro', t)), ...avisos.map((t) => faixaDeProblema('aviso', t))];
    // Só troca quando o conjunto de mensagens mudou: a região é anunciada ao leitor de tela, e trocar a cada tecla repetiria tudo a cada letra.
    const assinatura = itens.map((i) => i.textContent).join('\n');
    if (assinatura === edicao.assinaturaDosProblemas) return;
    edicao.assinaturaDosProblemas = assinatura;
    edicao.problemasEl.replaceChildren(...itens);
  }

  /** Mostra (ou, com texto vazio, esconde) o alerta de erro de uma tela. */
  function mostrarErro(alerta, texto) {
    alerta.textContent = texto;
    alerta.hidden = !texto;
  }

  /** Grava o rascunho agora. @returns {boolean} gravou (ou não havia o que gravar) */
  function salvarAgora() {
    if (!edicao) return true;
    clearTimeout(edicao.timer);
    edicao.timer = null;
    const r = C.salvarRascunho(edicao.chave, edicao.formaId, textosDaEdicao());
    if (!r.ok) {
      mostrarErro(edicao.erroEl, textoDaFalha(r.motivo, 'o rascunho'));
      return false; // `digitado` segue true: o texto não foi gravado e o botão "Ver prévia" continua valendo
    }
    catalogo = C.lerCatalogo();
    edicao.digitado = false;
    mostrarErro(edicao.erroEl, '');
    desenharSelos(edicao.def, edicao.forma, edicao.selosEl);
    edicao.descartarEl.disabled = !rascunhoDe(edicao.def, edicao.forma);
    indexar(edicao.def);
    atualizarBotoesDoRodape();
    return true;
  }

  function aoMudarTexto() {
    edicao.padraoEl.disabled = igualAoPadrao();
    desenharProblemas();
    clearTimeout(edicao.timer);
    edicao.digitado = true; // há texto que o rascunho gravado ainda não tem (até a próxima gravação que der certo)
    edicao.timer = setTimeout(salvarAgora, CONFIG_EDITOR.ATRASO_RASCUNHO_MS);
    atualizarBotoesDoRodape();
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

    edicao.restauroEl = el('div', { hidden: true }, { margin: '10px 0 0', padding: '8px 10px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', background: '#F7F8FA' });
    edicao.restauroEl.dataset.papel = 'confirmar-padrao';
    edicao.restauroEl.appendChild(el('div', { textContent: TEXTOS_DO_PADRAO.confirmar }, { fontSize: '13px', color: CORES.tinta, marginBottom: '8px' }));
    const botoesDoRestauro = el('div', {}, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    edicao.cancelarRestauroEl = botaoTexto(TEXTOS_DO_PADRAO.cancelar, cancelarRestauro, 'cancelar-padrao');
    botoesDoRestauro.append(botaoTexto(TEXTOS_DO_PADRAO.sim, restaurarPadrao, 'confirmar-padrao-sim'), edicao.cancelarRestauroEl);
    edicao.restauroEl.appendChild(botoesDoRestauro);
    caixa.appendChild(edicao.restauroEl);

    const botoes = el('div', {}, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' });
    edicao.padraoEl = botaoTexto(TEXTOS_DO_PADRAO.botao, pedirRestauro, 'restaurar-padrao');
    edicao.padraoEl.disabled = igualAoPadrao();
    edicao.descartarEl = botaoTexto('Descartar rascunho', descartarEdicao, 'descartar-rascunho');
    edicao.descartarEl.disabled = !rascunhoDe(def, forma);
    botoes.append(edicao.padraoEl, edicao.descartarEl, botaoTexto('Fechar edição', () => fecharEdicao(), 'fechar-edicao'));
    caixa.appendChild(botoes);
    renumerarVariantes();
    return caixa;
  }

  function pedirRestauro() {
    edicao.restauroEl.hidden = false;
    edicao.cancelarRestauroEl.focus();
  }

  function cancelarRestauro() {
    edicao.restauroEl.hidden = true;
    edicao.padraoEl.focus();
  }

  /** Põe o texto padrão nos campos e grava como RASCUNHO (publicar continua sendo um passo do usuário). */
  function restaurarPadrao() {
    edicao.areas.forEach((a) => a.wrap.remove());
    edicao.areas = [];
    edicao.forma.padrao.forEach((texto) => adicionarArea(texto));
    renumerarVariantes();
    edicao.restauroEl.hidden = true;
    aoMudarTexto();
    salvarAgora();
    edicao.areas[0].ta.focus();
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
    edicao.digitado = false; // o que foi descartado não conta como texto digitado
    const r = C.descartarRascunho(edicao.chave, edicao.formaId);
    if (!r.ok) { mostrarErro(edicao.erroEl, textoDaFalha(r.motivo, 'o rascunho')); return; }
    catalogo = C.lerCatalogo();
    atualizarBotoesDoRodape();
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
   * 3. A PRÉVIA DA MENSAGEM COMPLETA (R2, etapa 3, P4)
   * ---------------------------------------------------------------------
   * Segunda tela do MESMO diálogo (a lista fica escondida, não destruída: a busca e a rolagem voltam como estavam). As situações vêm do
   * Módulo 32 (fictícias) e a mensagem é montada pelo código real do Alt+A com o rascunho valendo (Módulo 30, `comRascunho`). Só lê.
   * --------------------------------------------------------------------- */
  const TEXTOS_DA_PREVIA = {
    titulo: 'Prévia da mensagem completa',
    tituloDaLista: 'Mensagens do Alt+A',
    subtitulo: 'Mostra o que o cliente receberia com os seus rascunhos, em situações inventadas. Nada é gravado nem enviado.',
    nota: 'Padrão da prévia não prevê o que um cliente real recebe. Textos com menos variantes repetem a volta.',
    dicaDaLista: 'As edições ficam como rascunho neste navegador; publicar vem a seguir. Esc fecha.',
    dicaDaPrevia: 'A prévia usa situações inventadas e não grava nada. Esc volta à lista.',
    semRascunhoNoBotao: 'Sem rascunho para comparar.',
    semRascunho: 'Você ainda não tem rascunho. Edite um texto para ver a prévia.',
    semMensagem: 'O Alt+A não envia mensagem nesta situação.',
    quebrou: 'Não consegui montar esta situação.',
    imagem: '[imagem do relatório]',
    falhou: 'Não consegui montar a prévia.',
    novoParaLeitor: '(novo) ',
    removidoParaLeitor: '(removido) ',
  };

  /**
   * Os alertas de tamanho de uma situação (Módulo 32, `avaliarLimites`): o texto de cada um. Erro = passa de um limite combinado com o usuário
   * (5 balões, 320 caracteres por balão, 600 no total, ou 750 com acordo); aviso = o total COM acordo entre 601 e 750 (passa do normal, mas cabe no teto
   * do acordo). Nenhum deles bloqueia o Publicar: só avisam.
   */
  const TEXTOS_DOS_ALERTAS = {
    baloes: (a) => `Passa de ${a.limite} balões: esta situação gera ${a.valor}.`,
    balao: (a) => `Um balão passa de ${a.limite} caracteres: o maior tem ${a.valor}.`,
    total: (a) => {
      if (a.nivel === 'aviso') return `Com acordo, a mensagem tem ${a.valor} caracteres (o limite é ${a.limite}; com acordo vale até ${a.teto}).`;
      return a.comAcordo ? `Com acordo, a mensagem passa de ${a.limite} caracteres: tem ${a.valor}.` : `A mensagem passa de ${a.limite} caracteres: tem ${a.valor}.`;
    },
  };

  function alertaDeTamanho(alerta) {
    const e = faixaDeProblema(alerta.nivel, TEXTOS_DOS_ALERTAS[alerta.codigo](alerta));
    e.dataset.papel = 'alerta-tamanho';
    e.dataset.codigo = alerta.codigo;
    return e;
  }

  /** Há algum rascunho guardado neste catálogo? (uma lista de textos em alguma forma de algum texto) */
  const temRascunho = (cat) => Object.values(cat?.rascunho?.textos ?? {}).some((formas) => Object.values(formas ?? {}).some((lista) => Array.isArray(lista) && lista.length > 0));

  const textosComRodizio = () => C.REGISTRO.filter((def) => def.rodizio);
  const chavesComRodizio = () => textosComRodizio().map((def) => def.chave);

  /** A maior quantidade de variantes entre os textos com rodízio (em uso e rascunho; o Módulo 30 já limita cada lista a MAX_VARIANTES): quantas opções o seletor tem. */
  function maiorQuantidadeDeVariantes(cat) {
    let maior = 1;
    textosComRodizio().forEach((def) => def.formas.forEach((forma) => {
      [cat.publicado[def.chave]?.[forma.id] ?? forma.padrao, cat.rascunho?.textos?.[def.chave]?.[forma.id]].forEach((lista) => {
        if (Array.isArray(lista)) maior = Math.max(maior, lista.length);
      });
    }));
    return maior;
  }

  /**
   * Quais balões de cada lado não têm igual no outro (comparando tipo e texto; um balão repetido casa uma vez só).
   * @returns {{antes: boolean[], depois: boolean[]}} true = o balão é diferente (some do outro lado)
   */
  function diferencasEntreBaloes(antes, depois) {
    const chave = (b) => `${b.tipo}\u0000${b.texto}`;
    const marcar = (lado, outro) => {
      const restante = new Map();
      outro.forEach((b) => restante.set(chave(b), (restante.get(chave(b)) ?? 0) + 1));
      return lado.map((b) => {
        const n = restante.get(chave(b)) ?? 0;
        if (n > 0) { restante.set(chave(b), n - 1); return false; }
        return true;
      });
    };
    return { antes: marcar(antes, depois), depois: marcar(depois, antes) };
  }

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function balaoDaPrevia(balao, diferenca) {
    const cores = diferenca === 'novo' ? [CORES.fundoMarca, CORES.marca] : diferenca === 'removido' ? [CORES.fundoPerigo, CORES.perigo] : ['#F7F8FA', CORES.borda];
    const e = el('div', {}, {
      fontSize: '13px', lineHeight: '1.45', color: CORES.tinta, padding: '4px 8px', margin: '2px 0', borderRadius: '6px', background: cores[0],
      border: `1px solid ${CORES.borda}`, borderLeft: `3px solid ${cores[1]}`, overflowWrap: 'anywhere',
      // Uma ideia por linha dentro do balão (o Módulo 19 junta as linhas com "\n"): sem isto o navegador as cola num parágrafo só.
      whiteSpace: 'pre-wrap',
    });
    e.dataset.papel = 'balao';
    e.dataset.tipo = balao.tipo;
    if (diferenca) e.dataset.diferenca = diferenca;
    if (balao.tipo === 'imagem') {
      e.appendChild(el('div', { textContent: TEXTOS_DA_PREVIA.imagem }, { fontSize: '12px', fontWeight: '600', color: CORES.apagado }));
      if (balao.texto) e.appendChild(el('div', { textContent: balao.texto }, { marginTop: '2px' }));
    } else {
      e.textContent = balao.texto;
    }
    if (diferenca) {
      // O destaque é só cor: quem não enxerga a cor (leitor de tela, daltonismo) ouve "(novo)" ou "(removido)" antes do texto. Não ocupa lugar na tela.
      const aviso = el('span', { textContent: diferenca === 'novo' ? TEXTOS_DA_PREVIA.novoParaLeitor : TEXTOS_DA_PREVIA.removidoParaLeitor }, {
        position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
      });
      aviso.dataset.papel = 'aviso-leitor';
      e.prepend(aviso);
    }
    return e;
  }

  /** A prévia não pôde ser montada (não deveria acontecer): o aviso vai para a tela e o erro para o console, nada fica calado. */
  function avisarFalhaDaPrevia(erro) {
    console.error('[Editor] Não consegui montar a prévia:', erro);
    window.__smartTableUtil?.toast?.(TEXTOS_DA_PREVIA.falhou, 6000);
  }

  /** Uma coluna da prévia ("Antes (em uso)" ou "Depois (rascunho)"): os balões na ordem do envio e os contadores. */
  function colunaDaPrevia(papel, rotulo, resultado, marcas, nomeDaDiferenca, comAlertas = false) {
    const col = el('div', {}, { minWidth: '0' });
    col.dataset.papel = papel;
    col.appendChild(el('div', { textContent: rotulo }, { fontSize: '11px', fontWeight: '600', color: CORES.apagado, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0 2px' }));
    if (!resultado) {
      const vazio = el('div', { textContent: TEXTOS_DA_PREVIA.semMensagem }, { fontSize: '12px', color: CORES.apagado, padding: '4px 0' });
      vazio.dataset.papel = 'sem-mensagem';
      col.appendChild(vazio);
      return col;
    }
    resultado.baloes.forEach((balao, i) => col.appendChild(balaoDaPrevia(balao, marcas?.[i] ? nomeDaDiferenca : null)));
    const t = resultado.totais;
    const contadores = el('div', { textContent: `${plural(t.baloes, 'balão', 'balões')} · ${plural(t.caracteres, 'caractere', 'caracteres')} · maior balão ${t.maiorBalao}` }, { fontSize: '12px', color: CORES.apagado, marginTop: '4px' });
    contadores.dataset.papel = 'contadores';
    col.appendChild(contadores);
    // Só o "Depois" leva alerta: o "Antes" é o que já está em uso.
    if (comAlertas) resultado.alertas.forEach((alerta) => col.appendChild(alertaDeTamanho(alerta)));
    return col;
  }

  function cartaoDoCenario(r) {
    const cartao = el('section', {}, { padding: '6px 0 12px', borderBottom: `1px solid ${CORES.borda}` });
    cartao.dataset.cenario = r.id;
    const titulo = el('div', {}, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', marginTop: '6px' });
    titulo.appendChild(el('span', { textContent: r.rotulo }, { fontWeight: '600', fontSize: '14px', color: CORES.tinta }));
    // Pode quebrar linha e nunca passa da largura do corpo (com `nowrap` ela estourava o corpo em tela muito estreita).
    const etiqueta = el('span', { textContent: r.grupo }, {
      fontSize: '11px', fontWeight: '600', padding: '1px 8px', borderRadius: '999px', maxWidth: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere', color: CORES.marca, background: CORES.fundoMarca, border: `1px solid ${CORES.marca}`,
    });
    etiqueta.dataset.papel = 'grupo-previa';
    titulo.appendChild(etiqueta);
    cartao.appendChild(titulo);
    if (r.erro !== null) {
      const quebrou = el('div', { textContent: TEXTOS_DA_PREVIA.quebrou }, { fontSize: '12px', color: CORES.perigo, background: CORES.fundoPerigo, borderRadius: '6px', padding: '4px 8px', marginTop: '6px' });
      quebrou.dataset.papel = 'cenario-quebrou';
      cartao.appendChild(quebrou);
      return cartao;
    }
    // Um lado sem mensagem (o Alt+A não envia): todo balão do outro lado é novo (em "Depois") ou removido (em "Antes").
    const todosDiferentes = (m) => (m ? m.baloes.map(() => true) : null);
    const diferencas = r.antes && r.depois ? diferencasEntreBaloes(r.antes.baloes, r.depois.baloes) : { antes: todosDiferentes(r.antes), depois: todosDiferentes(r.depois) };
    // Lado a lado quando cabe; as colunas empilham em tela estreita.
    const colunas = el('div', {}, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: '0 12px' });
    colunas.appendChild(colunaDaPrevia('antes', 'Antes (em uso)', r.antes, diferencas.antes, 'removido'));
    colunas.appendChild(colunaDaPrevia('depois', 'Depois (rascunho)', r.depois, diferencas.depois, 'novo', true));
    cartao.appendChild(colunas);
    return cartao;
  }

  /** Monta todas as situações (antes e depois) com a variante escolhida. É o trabalho pesado: roda ao abrir e ao trocar a variante, não ao marcar "Ver todas". */
  function calcularPrevia(variante) {
    const forcada = variante === null ? undefined : Object.fromEntries(chavesComRodizio().map((chave) => [chave, variante]));
    pv.todos = window.__cenariosPrevia.rodarTodos({ textos: pv.textos, variantes: forcada });
    pv.variante = variante; // só depois de calcular: se falhar, o estado segue sendo o da escolha que a tela ainda mostra
  }

  /** Desenha o contador e a lista de situações já calculadas, conforme a caixa "Ver todas as situações". */
  function desenharPrevia() {
    const todos = pv.todos;
    const afetadas = todos.filter((r) => r.afetado).length;
    const mostrar = todos.filter((r) => pv.verTodas || r.afetado);
    // O que o usuário precisa ver antes de tudo vem primeiro: situação que quebrou, depois a que estoura um limite (erro), depois a que só avisa;
    // as demais ficam na ordem da biblioteca (a ordenação é estável).
    const gravidade = (r) => {
      if (r.erro !== null) return 0;
      if (r.depois?.alertas.some((a) => a.nivel === 'erro')) return 1;
      return r.depois?.alertas.some((a) => a.nivel === 'aviso') ? 2 : 3;
    };
    const ordenadas = [...mostrar].sort((a, b) => gravidade(a) - gravidade(b));

    pv.contadorEl.textContent = afetadas === 0
      ? `Nenhuma das ${todos.length} situações muda com os seus rascunhos.`
      : `${afetadas} de ${todos.length} ${afetadas === 1 ? 'situação muda' : 'situações mudam'} com os seus rascunhos`;

    // Sem cabeçalho por grupo: a ordem é por gravidade e mistura os grupos, então o grupo vai como etiqueta em cada cartão (decisão do usuário, 06/10/2026).
    pv.corpoEl.replaceChildren(...ordenadas.map(cartaoDoCenario));
  }

  function desenharPreviaVazia() {
    pv.contadorEl.textContent = '';
    pv.controlesEl.style.display = 'none';
    const aviso = el('div', { textContent: TEXTOS_DA_PREVIA.semRascunho }, { padding: '24px 0', textAlign: 'center', fontSize: '13px', color: CORES.apagado });
    aviso.dataset.papel = 'sem-rascunho';
    aviso.setAttribute('role', 'status');
    pv.corpoEl.replaceChildren(aviso);
  }

  /** As peças da tela da prévia (escondida até o "Ver prévia"). */
  function montarPrevia() {
    const raiz = el('div', {}, { flex: '1 1 auto', minHeight: '0', display: 'none', flexDirection: 'column' });
    raiz.dataset.papel = 'previa';

    const faixa = el('div', {}, { flex: '0 0 auto', padding: '10px 18px', borderBottom: `1px solid ${CORES.borda}`, background: '#FAFBFC' });
    const voltarEl = botaoTexto('← Voltar à lista', () => voltarDaPrevia(), 'voltar');
    faixa.appendChild(voltarEl);
    faixa.appendChild(el('div', { textContent: TEXTOS_DA_PREVIA.subtitulo }, { fontSize: '12px', color: CORES.texto, marginTop: '8px' }));

    const controlesEl = el('div', {}, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', marginTop: '8px' });
    controlesEl.dataset.papel = 'controles-previa';
    const rotuloVariante = el('label', {}, { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: CORES.texto });
    rotuloVariante.appendChild(document.createTextNode('Variante da frase:'));
    const selectEl = el('select', {}, { padding: '5px 8px', fontSize: '13px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', color: CORES.tinta, background: CORES.fundo });
    selectEl.dataset.papel = 'variante';
    selectEl.addEventListener('change', () => {
      try {
        calcularPrevia(selectEl.value === '' ? null : Number(selectEl.value));
      } catch (erro) {
        // A tela segue mostrando a escolha anterior: o seletor volta a ela (senão ele mostraria uma variante e a lista outra).
        selectEl.value = pv.variante === null ? '' : String(pv.variante);
        avisarFalhaDaPrevia(erro);
        return;
      }
      desenharPrevia();
    });
    rotuloVariante.appendChild(selectEl);
    const rotuloTodas = el('label', {}, { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: CORES.texto, cursor: 'pointer' });
    const todasEl = el('input', { type: 'checkbox' });
    todasEl.dataset.papel = 'ver-todas';
    todasEl.addEventListener('change', () => { pv.verTodas = todasEl.checked; desenharPrevia(); });
    rotuloTodas.append(todasEl, document.createTextNode('Ver todas as situações'));
    controlesEl.append(rotuloVariante, rotuloTodas);
    faixa.appendChild(controlesEl);
    const nota = el('div', { textContent: TEXTOS_DA_PREVIA.nota }, { fontSize: '11px', color: CORES.apagado, marginTop: '4px' });
    nota.dataset.papel = 'nota-previa';
    faixa.appendChild(nota);
    const contadorEl = el('div', {}, { fontSize: '13px', fontWeight: '600', color: CORES.tinta, marginTop: '8px' });
    contadorEl.dataset.papel = 'contador-previa';
    contadorEl.setAttribute('role', 'status');
    contadorEl.setAttribute('aria-live', 'polite');
    faixa.appendChild(contadorEl);
    raiz.appendChild(faixa);

    const corpoEl = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '4px 18px 14px' });
    corpoEl.dataset.papel = 'corpo-previa';
    corpoEl.tabIndex = 0;
    corpoEl.setAttribute('role', 'region');
    corpoEl.setAttribute('aria-label', 'Situações da prévia');
    raiz.appendChild(corpoEl);

    pv = { raiz, voltarEl, selectEl, todasEl, controlesEl, contadorEl, corpoEl, textos: null, variante: null, verTodas: false, rolagemDaLista: 0 };
    return raiz;
  }

  /** Largura do diálogo e folga do fundo conforme a vista. */
  function ajustarLargura() {
    const largura = vista === 'lista' ? CONFIG_EDITOR.LARGURA_PAINEL : CONFIG_EDITOR.LARGURA_PREVIA;
    painelEl.style.width = `${largura}px`;
    fundoEl.style.padding = `16px 16px 16px ${folgaEsquerda(largura)}px`;
  }

  /** Título, dica e botão do rodapé conforme a vista (só quando a vista muda: o título é anunciado ao leitor de tela). */
  function atualizarRodape() {
    ui.tituloEl.textContent = { lista: TEXTOS_DA_PREVIA.tituloDaLista, previa: TEXTOS_DA_PREVIA.titulo, publicar: TEXTOS_DA_PUBLICACAO.titulo, historico: TEXTOS_DO_HISTORICO.titulo }[vista];
    painelEl.setAttribute('aria-label', ui.tituloEl.textContent);
    ui.dicaEl.textContent = { lista: TEXTOS_DA_PREVIA.dicaDaLista, previa: TEXTOS_DA_PREVIA.dicaDaPrevia, publicar: '', historico: TEXTOS_DO_HISTORICO.rodape }[vista];
    atualizarBotoesDoRodape();
  }

  /**
   * Os botões do rodapé: "Histórico" (só na lista), "Ver prévia" (só na lista; habilitado, dica e aparência mudam a cada tecla digitada e a cada gravação ou descarte do rascunho)
   * e "Publicar…" (só na prévia).
   */
  function atualizarBotoesDoRodape() {
    ui.historicoBotaoEl.style.display = vista === 'lista' ? '' : 'none';
    if (!ui.previaBotaoEl) return;
    ui.publicarBotaoEl.style.display = vista === 'previa' ? '' : 'none';
    // Texto digitado e ainda não gravado (o atraso de 400 ms, ou uma gravação recusada) já conta: abrir a prévia grava antes.
    const sem = !temRascunho(catalogo) && !edicao?.digitado;
    ui.previaBotaoEl.style.display = vista === 'lista' ? '' : 'none';
    habilitarBotao(ui.previaBotaoEl, !sem);
    ui.previaBotaoEl.title = sem ? TEXTOS_DA_PREVIA.semRascunhoNoBotao : '';
  }

  function abrirPrevia() {
    // Grava a edição aberta antes: a prévia tem que ver o que acabou de ser digitado. Com a gravação recusada ela fica aberta (o texto não se perde).
    if (edicao && !fecharEdicao({ devolverFoco: false })) {
      edicao.erroEl.scrollIntoView?.({ block: 'nearest' });
      edicao.ultimoFoco?.focus?.();
      return;
    }
    // O catálogo é relido: outra aba pode ter publicado ou descartado o rascunho depois que este diálogo abriu.
    const fresco = C.lerCatalogo();
    pv.textos = temRascunho(fresco) ? fresco.rascunho.textos : null;
    pv.verTodas = false;
    pv.todasEl.checked = false;
    pv.controlesEl.style.display = 'flex';
    if (pv.textos) {
      const opcoes = [el('option', { value: '', textContent: 'Padrão da prévia' })];
      for (let i = 0; i < maiorQuantidadeDeVariantes(fresco); i += 1) opcoes.push(el('option', { value: String(i), textContent: `Variante ${i + 1}` }));
      pv.selectEl.replaceChildren(...opcoes);
      pv.selectEl.value = '';
      // Se montar a prévia falhar, a vista não muda (nada fica pela metade): aviso na tela e erro no console.
      try {
        calcularPrevia(null);
        desenharPrevia();
      } catch (erro) {
        avisarFalhaDaPrevia(erro);
        ui.previaBotaoEl.focus(); // a edição foi fechada para gravar e o foco estava nela: volta ao botão (senão cairia no body)
        return;
      }
    } else {
      desenharPreviaVazia();
    }
    // Se outra aba mudou o catálogo, a lista (selos "rascunho"/"editado") e o botão ficaram para trás: o que foi relido vira o catálogo daqui e
    // a lista é refeita ao voltar (só nesse caso; senão ela volta exatamente como estava).
    pv.listaDesatualizada = fresco !== catalogo; // o Módulo 30 devolve o MESMO objeto enquanto o texto salvo não muda
    if (pv.listaDesatualizada) catalogo = fresco;
    pv.rolagemDaLista = ui.listaEl.scrollTop;
    vista = 'previa';
    ui.listaEl.hidden = true;
    ui.buscaEl.hidden = true;
    pv.raiz.style.display = 'flex';
    pv.corpoEl.scrollTop = 0;
    ajustarLargura();
    atualizarRodape();
    pv.voltarEl.focus();
  }

  /** Refaz a lista de textos a partir do catálogo atual (a busca digitada continua valendo). */
  function refazerLista() {
    ui.listaEl.replaceChildren();
    desenharLista(ui.listaEl);
    filtrarLista();
  }

  function voltarDaPrevia() {
    vista = 'lista';
    pv.raiz.style.display = 'none';
    if (pv.listaDesatualizada) refazerLista();
    ui.listaEl.hidden = false;
    ui.buscaEl.hidden = false;
    // A largura volta ANTES de restaurar a rolagem: mudar a largura depois reflui a lista e o navegador reajusta o scrollTop (no Chromium a lista voltava ~20 px abaixo).
    ajustarLargura();
    ui.listaEl.scrollTop = pv.rolagemDaLista;
    atualizarRodape();
    (ui.previaBotaoEl && !ui.previaBotaoEl.disabled ? ui.previaBotaoEl : painelEl).focus();
  }

  /** Esc: no Histórico fecha a confirmação aberta e, sem ela, volta à lista; na tela Publicar volta à prévia, na prévia volta à lista; na lista fecha o diálogo. */
  function aoApertarEsc() {
    if (edicao && !edicao.restauroEl.hidden) cancelarRestauro(); // (a edição só existe na lista)
    else if (vista === 'historico') { if (hs.confirmando === null) voltarDoHistorico(); else cancelarConfirmacao(); }
    else if (vista === 'publicar') voltarParaPrevia();
    else if (vista === 'previa') voltarDaPrevia();
    else fecharPainel({ devolverFoco: true });
  }

  /* ---------------------------------------------------------------------
   * 3b. PUBLICAR (R2, etapa 4)
   * ---------------------------------------------------------------------
   * Terceira tela do mesmo diálogo, aberta pelo "Publicar…" da prévia (a prévia é obrigatória). Mostra o que muda (em uso e novo), o que impede de
   * publicar (erro de CONTEÚDO) e os avisos (de conteúdo, de tamanho, e se outra aba publicou antes). O erro de TAMANHO só avisa. Quem publica é o
   * Módulo 30 (`publicar`); depois de publicar a lista é refeita e o diálogo volta a ela.
   * --------------------------------------------------------------------- */
  const TEXTOS_DA_PUBLICACAO = {
    titulo: 'Publicar mensagens',
    botaoDaPrevia: 'Publicar…',
    subtitulo: 'Estes textos passam a valer no Alt+A, neste navegador.',
    tudoCerto: 'Tudo certo para publicar.',
    notaRotulo: 'Nota (opcional)',
    notaExemplo: 'Ex.: pergunta final mais direta',
    publicar: 'Publicar',
    voltar: 'Voltar à prévia',
    publicarMesmoAssim: 'Publicar mesmo assim',
    cancelar: 'Cancelar',
    outraAba: 'Outra aba publicou depois que você começou a editar. Publicar agora vai por cima dela.',
    nadaAPublicar: 'Não há nenhuma mudança para publicar.',
    emUso: 'Em uso',
    novo: 'Novo',
    regiao: 'Textos que mudam',
  };
  const textoDoContador = (n) => `${n} ${n === 1 ? 'texto muda' : 'textos mudam'}`;
  const textoDoAvisoDeAcordo = ({ n, limite, teto }) => `${n} ${n === 1 ? 'situação passa' : 'situações passam'} de ${limite} caracteres e ${n === 1 ? 'cabe' : 'cabem'} no limite do acordo (${teto}). Isso não impede de publicar.`;
  const textoDoTamanho = (n) => `${n} ${n === 1 ? 'situação passa' : 'situações passam'} do limite de tamanho. Isso não impede de publicar.`;

  /** O nome de um texto (e da forma, quando há mais de uma) como a lista o mostra. */
  function tituloDoTexto(chave, formaId) {
    const def = C.defDe(chave);
    return `${def.titulo}${def.formas.length > 1 ? ` — ${def.formas.find((f) => f.id === formaId).rotulo}` : ''}`;
  }

  /** Um texto que muda: o título e, lado a lado, o texto de antes e o de depois (`null` = o texto padrão). `r`: os rótulos e os papéis das duas colunas e do item. */
  function blocoDeMudanca(m, r) {
    const item = el('section', {}, { padding: '10px 0 12px', borderBottom: `1px solid ${CORES.borda}` });
    item.dataset.papel = r.item;
    item.dataset.texto = m.chave;
    item.appendChild(el('div', { textContent: tituloDoTexto(m.chave, m.forma) }, { fontWeight: '600', fontSize: '14px', color: CORES.tinta }));
    const colunas = el('div', {}, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: '0 12px' });
    colunas.appendChild(colunaDeTextos(r.rotuloAntes, m.antes ?? C.padrao(m.chave, m.forma), r.papelAntes));
    colunas.appendChild(colunaDeTextos(r.rotuloDepois, m.depois ?? C.padrao(m.chave, m.forma), r.papelDepois));
    item.appendChild(colunas);
    return item;
  }

  const itemDaPublicacao = (m) => blocoDeMudanca(m, { item: 'item-publicacao', rotuloAntes: TEXTOS_DA_PUBLICACAO.emUso, rotuloDepois: TEXTOS_DA_PUBLICACAO.novo, papelAntes: 'publicar-em-uso', papelDepois: 'publicar-novo' });

  /**
   * Os alertas de tamanho que a publicação deixaria: `erros` = situações (as que o rascunho muda) com erro de tamanho; `acordo` = as que só têm o aviso do total com
   * acordo (`n`, e os limites que o Módulo 32 informou), ou null. Calculado do rascunho de AGORA (o salvo), não do que a prévia mostrou antes: outra aba pode ter
   * mexido nele, e a prévia pode nem ter sido montada (prévia vazia).
   */
  function alertasDeTamanhoDaPublicacao() {
    const textos = C.lerCatalogo().rascunho?.textos; // (sem rascunho nenhuma situação é afetada)
    try {
      const afetadas = window.__cenariosPrevia.rodarTodos({ textos }).filter((r) => r.afetado && r.depois);
      const comErro = afetadas.filter((r) => r.depois.alertas.some((a) => a.nivel === 'erro'));
      const avisos = afetadas.filter((r) => !comErro.includes(r)).map((r) => r.depois.alertas.find((a) => a.nivel === 'aviso')).filter(Boolean);
      return { erros: comErro.length, acordo: avisos.length > 0 ? { n: avisos.length, limite: avisos[0].limite, teto: avisos[0].teto } : null };
    } catch (erro) {
      avisarFalhaDaPrevia(erro); // as faixas de tamanho somem, mas nada impede de publicar
      return { erros: 0, acordo: null };
    }
  }

  /** Desenha a tela Publicar com o que `prepararPublicacao` devolveu (sem gravar nada). */
  function desenharPublicar(plano) {
    const avisos = [];
    mostrarErro(pb.erroEl, '');
    if (!plano.ok) {
      mostrarErro(pb.erroEl, plano.motivo === 'nada-a-publicar' ? TEXTOS_DA_PUBLICACAO.nadaAPublicar : (textoDaFalha(plano.motivo, 'a publicação')));
      pb.contadorEl.textContent = '';
      pb.corpoEl.replaceChildren();
      pb.avisosEl.replaceChildren();
      pb.outraAba = false;
    } else {
      pb.outraAba = plano.outraAba;
      pb.contadorEl.textContent = textoDoContador(plano.mudancas.length);
      if (plano.outraAba) {
        const f = faixaDeProblema('aviso', TEXTOS_DA_PUBLICACAO.outraAba);
        f.dataset.papel = 'outra-aba';
        avisos.push(f);
      }
      if (plano.problemas.length > 0) {
        plano.problemas.forEach((p) => p.motivos.forEach((motivo) => {
          const f = faixaDeProblema('erro', `${tituloDoTexto(p.chave, p.forma)}: ${motivo}`);
          f.dataset.papel = 'problema-publicacao';
          avisos.push(f);
        }));
      } else {
        const certo = el('div', { textContent: TEXTOS_DA_PUBLICACAO.tudoCerto }, { fontSize: '12px', color: CORES.ok, background: CORES.fundoOk, borderRadius: '6px', padding: '4px 8px', margin: '4px 0 0' });
        certo.dataset.papel = 'tudo-certo';
        avisos.push(certo);
      }
      plano.avisos.forEach((a) => a.motivos.forEach((motivo) => {
        const f = faixaDeProblema('aviso', `${tituloDoTexto(a.chave, a.forma)}: ${motivo}`);
        f.dataset.papel = 'aviso-publicacao';
        avisos.push(f);
      }));
      const tamanho = alertasDeTamanhoDaPublicacao();
      if (tamanho.erros > 0) {
        const f = faixaDeProblema('aviso', textoDoTamanho(tamanho.erros));
        f.dataset.papel = 'aviso-tamanho-publicacao';
        avisos.push(f);
      }
      if (tamanho.acordo) {
        const f = faixaDeProblema('aviso', textoDoAvisoDeAcordo(tamanho.acordo));
        f.dataset.papel = 'aviso-acordo-publicacao';
        avisos.push(f);
      }
      pb.avisosEl.replaceChildren(...avisos);
      pb.corpoEl.replaceChildren(...plano.mudancas.map(itemDaPublicacao));
    }
    pb.publicarEl.textContent = pb.outraAba ? TEXTOS_DA_PUBLICACAO.publicarMesmoAssim : TEXTOS_DA_PUBLICACAO.publicar;
    pb.voltarEl.textContent = pb.outraAba ? TEXTOS_DA_PUBLICACAO.cancelar : TEXTOS_DA_PUBLICACAO.voltar;
    habilitarBotao(pb.publicarEl, plano.ok && plano.problemas.length === 0);
  }

  /** As peças da tela Publicar (escondida até o "Publicar…" da prévia). */
  function montarPublicar() {
    const raiz = el('div', {}, { flex: '1 1 auto', minHeight: '0', display: 'none', flexDirection: 'column' });
    raiz.dataset.papel = 'tela-publicar'; // (o botão "Publicar" é data-papel="publicar": nomes diferentes)

    const faixa = el('div', {}, { flex: '0 0 auto', padding: '10px 18px', borderBottom: `1px solid ${CORES.borda}`, background: '#FAFBFC' });
    faixa.appendChild(el('div', { textContent: TEXTOS_DA_PUBLICACAO.subtitulo }, { fontSize: '12px', color: CORES.texto }));
    const contadorEl = el('div', {}, { fontSize: '13px', fontWeight: '600', color: CORES.tinta, marginTop: '8px' });
    contadorEl.dataset.papel = 'contador-publicar';
    contadorEl.setAttribute('role', 'status');
    contadorEl.setAttribute('aria-live', 'polite');
    faixa.appendChild(contadorEl);
    const avisosEl = el('div');
    avisosEl.dataset.papel = 'avisos-publicar';
    avisosEl.setAttribute('role', 'status');
    avisosEl.setAttribute('aria-live', 'polite');
    faixa.appendChild(avisosEl);
    const erroEl = el('div', { hidden: true }, { fontSize: '12px', color: CORES.perigo, background: CORES.fundoPerigo, border: `1px solid ${CORES.perigo}`, borderRadius: '6px', padding: '4px 8px', margin: '6px 0 0' });
    erroEl.dataset.papel = 'erro-publicar';
    erroEl.setAttribute('role', 'alert');
    faixa.appendChild(erroEl);
    raiz.appendChild(faixa);

    const corpoEl = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '4px 18px 14px' });
    corpoEl.dataset.papel = 'corpo-publicar';
    corpoEl.tabIndex = 0;
    corpoEl.setAttribute('role', 'region');
    corpoEl.setAttribute('aria-label', TEXTOS_DA_PUBLICACAO.regiao);
    raiz.appendChild(corpoEl);

    const barra = el('div', {}, { flex: '0 0 auto', padding: '10px 18px', borderTop: `1px solid ${CORES.borda}`, background: '#FAFBFC', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px 12px' });
    const rotuloNota = el('label', {}, { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 240px', fontSize: '12px', color: CORES.texto });
    rotuloNota.appendChild(document.createTextNode(TEXTOS_DA_PUBLICACAO.notaRotulo));
    const notaEl = el('input', { type: 'text', maxLength: C.MAX_NOTA, placeholder: TEXTOS_DA_PUBLICACAO.notaExemplo, autocomplete: 'off' }, {
      padding: '8px 10px', fontSize: '13px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', color: CORES.tinta, background: CORES.fundo, boxSizing: 'border-box', width: '100%',
    });
    notaEl.dataset.papel = 'nota-publicar';
    // Enter publica (menos quando confirma uma composição de IME/tecla morta).
    notaEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); publicarAgora(); }
    });
    rotuloNota.appendChild(notaEl);
    barra.appendChild(rotuloNota);
    const publicarEl = botaoTexto(TEXTOS_DA_PUBLICACAO.publicar, () => publicarAgora(), 'publicar');
    const voltarEl = botaoTexto(TEXTOS_DA_PUBLICACAO.voltar, () => voltarParaPrevia(), 'voltar-previa');
    [publicarEl, voltarEl].forEach((b) => Object.assign(b.style, { padding: '9px 14px', fontSize: '13px' }));
    barra.append(publicarEl, voltarEl);
    raiz.appendChild(barra);

    pb = { raiz, contadorEl, avisosEl, erroEl, corpoEl, notaEl, publicarEl, voltarEl, outraAba: false };
    return raiz;
  }

  function abrirPublicar() {
    const plano = C.prepararPublicacao();
    pb.notaEl.value = '';
    desenharPublicar(plano);
    pv.raiz.style.display = 'none';
    pb.raiz.style.display = 'flex';
    vista = 'publicar';
    pb.corpoEl.scrollTop = 0;
    atualizarRodape();
    (plano.ok ? pb.notaEl : pb.voltarEl).focus();
  }

  function voltarParaPrevia() {
    vista = 'previa';
    pb.raiz.style.display = 'none';
    pv.raiz.style.display = 'flex';
    atualizarRodape();
    ui.publicarBotaoEl.focus();
  }

  /** Publica de verdade (Módulo 30). Com sucesso: aviso na tela, lista refeita e de volta a ela. Se algo mudou no meio do caminho, a tela se refaz. */
  function publicarAgora() {
    if (pb.publicarEl.disabled) return;
    const r = C.publicar({ nota: pb.notaEl.value, forcar: pb.outraAba });
    if (r.ok) {
      window.__smartTableUtil?.toast?.(`Mensagens publicadas (versão ${r.rev}).`, 6000);
      catalogo = C.lerCatalogo();
      pb.raiz.style.display = 'none';
      pv.raiz.style.display = 'none';
      vista = 'lista';
      refazerLista();
      ui.listaEl.hidden = false;
      ui.buscaEl.hidden = false;
      ajustarLargura();
      ui.listaEl.scrollTop = pv.rolagemDaLista;
      atualizarRodape();
      painelEl.focus();
      return;
    }
    if (r.motivo === 'outra-aba' || r.motivo === 'bloqueado' || r.motivo === 'nada-a-publicar') {
      desenharPublicar(C.prepararPublicacao()); // o que mudou desde que a tela abriu passa a aparecer
      // O "Publicar" que tinha o foco pode ter ficado desabilitado: sem isto o foco cai na página e o Esc e o Tab do diálogo param de valer.
      if (pb.publicarEl.disabled && [pb.publicarEl, document.body].includes(document.activeElement)) pb.voltarEl.focus();
      return;
    }
    mostrarErro(pb.erroEl, textoDaFalha(r.motivo, 'a publicação'));
  }

  /* ---------------------------------------------------------------------
   * 3c. HISTÓRICO (R2, etapa 4)
   * ---------------------------------------------------------------------
   * Quarta tela do mesmo diálogo, aberta pelo "Histórico" do rodapé da lista. Lista as últimas publicações (a mais nova primeiro); de cada uma dá para ver
   * o que mudou e voltar à versão dela, o que cria uma publicação NOVA (o histórico nunca perde entrada). A confirmação é dentro do próprio item.
   */
  const TEXTOS_DO_HISTORICO = {
    titulo: 'Histórico de publicações',
    rodape: `Guardamos as últimas ${C.MAX_HISTORICO} publicações.`,
    voltarALista: '← Voltar à lista',
    regiao: 'Publicações',
    vazio: 'Nenhuma publicação ainda.',
    verMudancas: 'Ver mudanças',
    esconderMudancas: 'Esconder mudanças',
    voltarParaVersao: 'Voltar para esta versão',
    cancelar: 'Cancelar',
    jaEmUso: 'Esta versão já é a que está em uso.',
    antes: 'Antes',
    depois: 'Depois',
    confirmar: (rev) => `Voltar para a versão ${rev}? Isso cria uma publicação nova com os textos daquela versão.`,
    // os que não foram aprovados em bloco com os de cima (derivados das falhas do Módulo 30)
    semVersao: 'Essa versão não está mais no histórico.',
    incompleto: 'Não dá para voltar a essa versão: faltam publicações no histórico entre ela e a atual.',
    bloqueado: 'Não dá para voltar a essa versão: ela tem texto que as regras de hoje não aceitam.',
  };

  /** "06/10/2026 14:30", na hora deste navegador. */
  function dataDaPublicacao(ms) {
    const d = new Date(ms);
    const dois = (n) => String(n).padStart(2, '0');
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }

  /** As mudanças de uma publicação: um bloco por texto que ela mexeu, com o antes e o depois. */
  function mudancasDaEntrada(entrada) {
    const blocos = [];
    Object.keys(entrada.depois).forEach((chave) => Object.keys(entrada.depois[chave]).forEach((forma) => {
      blocos.push(blocoDeMudanca({ chave, forma, antes: entrada.antes[chave]?.[forma] ?? null, depois: entrada.depois[chave][forma] }, {
        item: 'item-mudanca', rotuloAntes: TEXTOS_DO_HISTORICO.antes, rotuloDepois: TEXTOS_DO_HISTORICO.depois, papelAntes: 'historico-antes', papelDepois: 'historico-depois',
      }));
    }));
    return blocos;
  }

  function itemDoHistorico(entrada, revAtual) {
    const item = el('section', {}, { padding: '10px 0 12px', borderBottom: `1px solid ${CORES.borda}` });
    item.dataset.papel = 'item-historico';
    item.dataset.rev = String(entrada.rev);
    const linha = `Versão ${entrada.rev} · ${dataDaPublicacao(entrada.em)}${entrada.nota ? ` · ${entrada.nota}` : ''}`;
    const titulo = el('div', { textContent: linha }, { fontWeight: '600', fontSize: '14px', color: CORES.tinta, overflowWrap: 'anywhere' });
    titulo.dataset.papel = 'linha-historico';
    item.appendChild(titulo);

    const acoes = el('div', {}, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', marginTop: '6px' });
    const detalhe = el('div', { hidden: true });
    detalhe.dataset.papel = 'mudancas-historico';
    const verEl = botaoTexto(TEXTOS_DO_HISTORICO.verMudancas, () => {
      const abrir = detalhe.hidden;
      if (abrir) detalhe.replaceChildren(...mudancasDaEntrada(entrada));
      detalhe.hidden = !abrir;
      verEl.textContent = abrir ? TEXTOS_DO_HISTORICO.esconderMudancas : TEXTOS_DO_HISTORICO.verMudancas;
      verEl.setAttribute('aria-expanded', String(abrir));
    }, 'ver-mudancas');
    verEl.setAttribute('aria-expanded', 'false');
    acoes.appendChild(verEl);

    const confirmacao = el('div', { hidden: true }, { margin: '8px 0 0', padding: '8px 10px', border: `1px solid ${CORES.borda}`, borderRadius: '8px', background: '#F7F8FA' });
    confirmacao.dataset.papel = 'confirmar-historico';
    if (entrada.rev === revAtual) {
      const emUso = el('span', { textContent: TEXTOS_DO_HISTORICO.jaEmUso }, { fontSize: '12px', color: CORES.apagado });
      emUso.dataset.papel = 'versao-em-uso';
      acoes.appendChild(emUso);
    } else {
      acoes.appendChild(botaoTexto(TEXTOS_DO_HISTORICO.voltarParaVersao, () => pedirConfirmacao(entrada.rev), 'voltar-versao'));
      confirmacao.appendChild(el('div', { textContent: TEXTOS_DO_HISTORICO.confirmar(entrada.rev) }, { fontSize: '13px', color: CORES.tinta, marginBottom: '8px' }));
      const botoes = el('div', {}, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
      botoes.append(
        botaoTexto(TEXTOS_DO_HISTORICO.voltarParaVersao, () => voltarParaAVersao(entrada.rev), 'confirmar-voltar'),
        botaoTexto(TEXTOS_DO_HISTORICO.cancelar, () => cancelarConfirmacao(), 'cancelar-voltar'),
      );
      confirmacao.appendChild(botoes);
    }
    item.append(acoes, confirmacao, detalhe);
    return item;
  }

  /** Refaz as linhas do histórico a partir do catálogo salvo (relido: outra aba pode ter publicado). */
  function desenharHistorico() {
    const fresco = C.lerCatalogo();
    if (fresco !== catalogo) { catalogo = fresco; hs.listaDesatualizada = true; }
    hs.confirmando = null;
    if (fresco.historico.length === 0) {
      const vazio = el('div', { textContent: TEXTOS_DO_HISTORICO.vazio }, { fontSize: '13px', color: CORES.apagado, padding: '14px 0' });
      vazio.dataset.papel = 'historico-vazio';
      hs.corpoEl.replaceChildren(vazio);
    } else {
      hs.corpoEl.replaceChildren(...fresco.historico.map((e) => itemDoHistorico(e, fresco.rev)));
    }
  }

  const confirmacaoAberta = () => (hs.confirmando === null ? null : hs.corpoEl.querySelector(`[data-papel="item-historico"][data-rev="${hs.confirmando}"] [data-papel="confirmar-historico"]`));

  /** Fecha a confirmação aberta (se há) e devolve o foco ao "Voltar para esta versão" do item. */
  function cancelarConfirmacao() {
    const aberta = confirmacaoAberta();
    hs.confirmando = null;
    if (!aberta) return;
    aberta.hidden = true;
    aberta.parentElement.querySelector('[data-papel="voltar-versao"]')?.focus();
  }

  function pedirConfirmacao(rev) {
    cancelarConfirmacao();
    mostrarErro(hs.erroEl, '');
    hs.confirmando = rev;
    const aberta = confirmacaoAberta();
    aberta.hidden = false;
    aberta.querySelector('[data-papel="cancelar-voltar"]').focus();
  }

  function voltarParaAVersao(rev) {
    const r = C.restaurarVersao(rev);
    if (r.ok) {
      const pendente = C.lerCatalogo().rascunho !== null ? ' O rascunho continua pendente.' : '';
      window.__smartTableUtil?.toast?.(`Voltou para a versão ${rev}. Nova publicação: versão ${r.rev}.${pendente}`, 6000);
      desenharHistorico();
      hs.corpoEl.scrollTop = 0;
      hs.corpoEl.querySelector('[data-papel="ver-mudancas"]')?.focus();
      return;
    }
    const texto = {
      'ja-e-esta': TEXTOS_DO_HISTORICO.jaEmUso,
      'versao-desconhecida': TEXTOS_DO_HISTORICO.semVersao,
      'historico-incompleto': TEXTOS_DO_HISTORICO.incompleto,
      bloqueado: TEXTOS_DO_HISTORICO.bloqueado,
    }[r.motivo] ?? textoDaFalha(r.motivo, 'a publicação');
    desenharHistorico(); // o que mudou desde que a tela abriu passa a aparecer
    mostrarErro(hs.erroEl, texto);
    hs.voltarEl.focus();
  }

  /** As peças da tela Histórico (escondida até o "Histórico" do rodapé). */
  function montarHistorico() {
    const raiz = el('div', {}, { flex: '1 1 auto', minHeight: '0', display: 'none', flexDirection: 'column' });
    raiz.dataset.papel = 'tela-historico';
    const faixa = el('div', {}, { flex: '0 0 auto', padding: '10px 18px', borderBottom: `1px solid ${CORES.borda}`, background: '#FAFBFC' });
    const voltarEl = botaoTexto(TEXTOS_DO_HISTORICO.voltarALista, () => voltarDoHistorico(), 'voltar-historico');
    faixa.appendChild(voltarEl);
    const erroEl = el('div', { hidden: true }, { fontSize: '12px', color: CORES.perigo, background: CORES.fundoPerigo, border: `1px solid ${CORES.perigo}`, borderRadius: '6px', padding: '4px 8px', margin: '8px 0 0' });
    erroEl.dataset.papel = 'erro-historico';
    erroEl.setAttribute('role', 'alert');
    faixa.appendChild(erroEl);
    raiz.appendChild(faixa);
    const corpoEl = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '4px 18px 14px' });
    corpoEl.dataset.papel = 'corpo-historico';
    corpoEl.tabIndex = 0;
    corpoEl.setAttribute('role', 'region');
    corpoEl.setAttribute('aria-label', TEXTOS_DO_HISTORICO.regiao);
    raiz.appendChild(corpoEl);
    hs = { raiz, voltarEl, erroEl, corpoEl, confirmando: null, rolagemDaLista: 0, listaDesatualizada: false };
    return raiz;
  }

  function abrirHistorico() {
    // Grava a edição aberta antes (como a prévia): com a gravação recusada ela fica aberta e o texto não se perde.
    if (edicao && !fecharEdicao({ devolverFoco: false })) {
      edicao.erroEl.scrollIntoView?.({ block: 'nearest' });
      edicao.ultimoFoco?.focus?.();
      return;
    }
    hs.rolagemDaLista = ui.listaEl.scrollTop;
    hs.listaDesatualizada = false;
    mostrarErro(hs.erroEl, '');
    desenharHistorico();
    vista = 'historico';
    ui.listaEl.hidden = true;
    ui.buscaEl.hidden = true;
    hs.raiz.style.display = 'flex';
    hs.corpoEl.scrollTop = 0;
    ajustarLargura();
    atualizarRodape();
    hs.voltarEl.focus();
  }

  function voltarDoHistorico() {
    vista = 'lista';
    hs.raiz.style.display = 'none';
    if (hs.listaDesatualizada) refazerLista();
    ui.listaEl.hidden = false;
    ui.buscaEl.hidden = false;
    ajustarLargura();
    ui.listaEl.scrollTop = hs.rolagemDaLista;
    atualizarRodape();
    ui.historicoBotaoEl.focus();
  }

  /* ---------------------------------------------------------------------
   * 4. O DIÁLOGO
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
    vista = 'lista';
    pv = null; // a árvore da prévia e os resultados das 54 situações não ficam na memória do CRM depois de fechar
    pb = null;
    hs = null;
    ui = null;
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
  function folgaEsquerda(larguraDoPainel = CONFIG_EDITOR.LARGURA_PAINEL) {
    const menu = window.__smartTableUtil?.margemMenuLateral?.() ?? 0;
    const largura = Math.min(larguraDoPainel, window.innerWidth - 32);
    const esquerdaCentral = (window.innerWidth - largura) / 2;
    return menu > 0 && esquerdaCentral < menu + 16 ? menu + 16 : 16;
  }

  /** O que dá pra focar dentro do diálogo (pro Tab não sair dele). */
  function focaveisDoPainel() {
    return [...painelEl.querySelectorAll('button, input, select, textarea, [data-papel="corpo"], [data-papel="corpo-previa"], [data-papel="corpo-publicar"], [data-papel="corpo-historico"]')].filter((e) => !e.disabled && visivel(e));
  }

  /**
   * Rolagem pelo teclado: com o foco no diálogo (ou na lista), as setas, PageUp/PageDown, Home/End e Espaço rolam A LISTA.
   * Sem isto, o navegador rola a página do CRM que está atrás do diálogo (o diálogo tem overflow oculto). Nos campos (a busca, o seletor,
   * as caixas de edição) as teclas seguem nativas. Com o foco num BOTÃO (a prévia abre com o foco em "← Voltar à lista") as setas,
   * PageUp/PageDown, Home e End também rolam a lista, em qualquer botão do diálogo; o Espaço fica com o botão (é o clique dele).
   */
  function rolarPelaTecla(e) {
    const corpo = painelEl.querySelector(`[data-papel="${{ lista: 'corpo', previa: 'corpo-previa', publicar: 'corpo-publicar', historico: 'corpo-historico' }[vista]}"]`);
    // Com o foco num BOTÃO (a prévia abre com o foco em "← Voltar à lista") as setas, PageUp/PageDown, Home e End também rolam a lista; o Espaço
    // fica com o botão (é o clique dele).
    const noBotao = e.target?.tagName === 'BUTTON';
    if (!corpo || (e.target !== painelEl && e.target !== corpo && !noBotao) || (noBotao && e.key === ' ') || e.altKey || e.ctrlKey || e.metaKey) return false;
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
    if (e.key === 'Escape') { e.preventDefault(); aoApertarEsc(); return; }
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
    const tituloEl = el('div', { textContent: TEXTOS_DA_PREVIA.tituloDaLista }, { fontWeight: '700', fontSize: '16px', color: CORES.tinta });
    topo.appendChild(tituloEl);
    const x = el('button', { type: 'button', textContent: '✕' }, { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', color: CORES.apagado, padding: '2px 4px' });
    x.setAttribute('aria-label', 'Fechar (Esc)');
    x.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    topo.appendChild(x);
    painelEl.appendChild(topo);

    const buscaEl = campoDeBusca();
    painelEl.appendChild(buscaEl);

    const meio = el('div', {}, { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '8px 18px 14px' });
    meio.dataset.papel = 'corpo';
    // Focável (Tab e leitor de tela chegam à lista): a rolagem pelo teclado precisa de foco nela ou no diálogo.
    meio.tabIndex = 0;
    meio.setAttribute('role', 'region');
    meio.setAttribute('aria-label', 'Lista de textos');
    desenharLista(meio);
    painelEl.appendChild(meio);
    // A prévia só existe se o Módulo 32 (as situações) carregou; sem ele, o botão "Ver prévia" nem aparece.
    const comPrevia = !!window.__cenariosPrevia;
    if (comPrevia) { painelEl.appendChild(montarPrevia()); painelEl.appendChild(montarPublicar()); }
    painelEl.appendChild(montarHistorico());

    const rodape = el('div', {}, { borderTop: `1px solid ${CORES.borda}`, padding: '10px 18px 14px', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    const dicaEl = el('div', { textContent: TEXTOS_DA_PREVIA.dicaDaLista }, { fontSize: '12px', color: CORES.apagado });
    dicaEl.dataset.papel = 'dica';
    rodape.appendChild(dicaEl);
    const botoesDoRodape = el('div', {}, { display: 'flex', gap: '8px', flex: '0 0 auto' });
    const estiloDoBotao = { padding: '9px 14px', borderRadius: '8px', border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.texto, fontSize: '13px', cursor: 'pointer' };
    const historicoBotaoEl = el('button', { type: 'button', textContent: 'Histórico' }, estiloDoBotao);
    historicoBotaoEl.dataset.papel = 'historico-abrir';
    historicoBotaoEl.addEventListener('click', abrirHistorico);
    botoesDoRodape.appendChild(historicoBotaoEl);
    let previaBotaoEl = null;
    let publicarBotaoEl = null;
    if (comPrevia) {
      previaBotaoEl = el('button', { type: 'button', textContent: 'Ver prévia' }, estiloDoBotao);
      previaBotaoEl.dataset.papel = 'ver-previa';
      previaBotaoEl.addEventListener('click', abrirPrevia);
      botoesDoRodape.appendChild(previaBotaoEl);
      publicarBotaoEl = el('button', { type: 'button', textContent: TEXTOS_DA_PUBLICACAO.botaoDaPrevia }, { ...estiloDoBotao, display: 'none' });
      publicarBotaoEl.dataset.papel = 'publicar-abrir';
      publicarBotaoEl.addEventListener('click', abrirPublicar);
      botoesDoRodape.appendChild(publicarBotaoEl);
    }
    const fechar = el('button', { type: 'button', textContent: 'Fechar' }, estiloDoBotao);
    fechar.dataset.papel = 'fechar';
    fechar.addEventListener('click', () => fecharPainel({ devolverFoco: true }));
    botoesDoRodape.appendChild(fechar);
    rodape.appendChild(botoesDoRodape);
    painelEl.appendChild(rodape);
    ui = { tituloEl, buscaEl, listaEl: meio, dicaEl, historicoBotaoEl, previaBotaoEl, publicarBotaoEl };
    atualizarRodape();

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
    if (e.code === 'Escape') { aoApertarEsc(); return; }
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
