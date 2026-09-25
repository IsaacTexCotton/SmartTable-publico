/* =========================================================================
 * MÓDULO 15: ALERTAS GERAIS — CRM TexCotton
 * -------------------------------------------------------------------------
 * PEDIDO DO USUÁRIO (v1.40.0): um lembrete geral, sem cliente -- "hoje
 * faço um pra quarta e amanhã um pra segunda". Decisões dele (perguntadas
 * antes de implementar):
 *
 *   - ONDE: botão "🔔 Alertas gerais" na LISTA de clientes (só lá), ao lado
 *     de "▶ Iniciar Fila de Atendimento". Abre um painel com o formulário
 *     (descrição + data + Confirmar) em cima e os alertas em cards embaixo,
 *     cada um com um X pra excluir. Acumula quantos quiser.
 *   - NO DIA: o aviso aparece só na lista de clientes (não nas outras
 *     telas), toda vez que ela abre enquanto houver alerta pra hoje -- até
 *     você excluir o alerta ou fechar o aviso.
 *   - DEPOIS: o alerta some sozinho no dia seguinte ao da data.
 *   - NOME: "Alertas gerais", pra não confundir com o "⚠ Alerta" da tela do
 *     cliente (Módulo 12, não cobrar + observação daquele cliente), que
 *     continua exatamente como está.
 *
 * ARMAZENAMENTO: localStorage (smarttable_alertas_gerais_v1), só neste
 * navegador -- mesmo lugar dos alertas do cliente. Lista de
 * { id, descricao, data: 'AAAA-MM-DD', criadoEm }.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__alertasGeraisCarregado) return;
  window.__alertasGeraisCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Alertas Gerais');

  const CONFIG_ALERTAS_GERAIS = {
    CHAVE_STORAGE: 'smarttable_alertas_gerais_v1',
    ID_BOTAO: 'smarttable-botao-alertas-gerais',
    ID_PAINEL: 'smarttable-painel-alertas-gerais',
    ID_AVISO: 'smarttable-aviso-alertas-gerais',
    // Mesmo z-index dos outros painéis nossos: abaixo dos modais do CRM.
    Z_INDEX: 30,
    MAX_DESCRICAO: 300,
    // Quantos alertas de hoje o aviso lista antes de "e mais N".
    MAX_NO_AVISO: 3,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    fundo: '#ffffff',
    hoje: '#B45309',
    fundoHoje: '#FEF3E2',
    perigo: '#B42318',
  };

  const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  let painelEl = null;
  let avisoEl = null;

  /* ---------------------------------------------------------------------
   * 1. DATAS
   * --------------------------------------------------------------------- */
  function hojeIso(agora = new Date()) {
    return window.__smartTableUtil.dataIso(agora);
  }

  /** 'AAAA-MM-DD' -> Date ao meio-dia local (convenção do projeto), ou null. */
  function dataDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    // Recusa 2026-02-31 & cia (o Date "corrige" pra março).
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }

  /** "Hoje", "Amanhã" ou "qua, 30/09". */
  function rotuloDaData(iso, agora = new Date()) {
    const d = dataDeIso(iso);
    if (!d) return iso;
    const hoje = dataDeIso(hojeIso(agora));
    const dias = Math.round((d - hoje) / 86400000);
    if (dias === 0) return 'Hoje';
    if (dias === 1) return 'Amanhã';
    return `${DIAS_SEMANA[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /* ---------------------------------------------------------------------
   * 2. ARMAZENAMENTO
   * --------------------------------------------------------------------- */
  function alertaValido(a) {
    return a && typeof a === 'object' &&
      typeof a.id === 'string' && a.id &&
      typeof a.descricao === 'string' && a.descricao.trim() &&
      dataDeIso(a.data) !== null;
  }

  function gravar(lista) {
    try {
      if (lista.length === 0) localStorage.removeItem(CONFIG_ALERTAS_GERAIS.CHAVE_STORAGE);
      else localStorage.setItem(CONFIG_ALERTAS_GERAIS.CHAVE_STORAGE, JSON.stringify(lista));
      return true;
    } catch (erro) {
      console.warn('[Alertas Gerais] Não consegui gravar os alertas.', erro?.message);
      return false;
    }
  }

  /**
   * Os alertas de hoje em diante, em ordem de data. Os de dias anteriores
   * são apagados aqui mesmo ("some sozinho no dia seguinte"), e um item
   * ilegível é descartado com aviso no console -- nunca derruba a lista.
   *
   * @param {Date} [agora] Injetável pra teste.
   * @returns {{id: string, descricao: string, data: string, criadoEm: number}[]}
   */
  function lerAlertas(agora = new Date()) {
    let bruto = null;
    try {
      bruto = JSON.parse(localStorage.getItem(CONFIG_ALERTAS_GERAIS.CHAVE_STORAGE) || '[]');
    } catch (erro) {
      console.warn('[Alertas Gerais] Alertas salvos ilegíveis -- tratando como vazio.', erro?.message);
      bruto = [];
    }
    const lista = Array.isArray(bruto) ? bruto : [];
    const hoje = hojeIso(agora);
    const validos = lista.filter(alertaValido);
    if (validos.length !== lista.length) console.warn('[Alertas Gerais] Um alerta salvo estava em formato inválido e foi descartado.');
    const vigentes = validos
      .filter((a) => a.data >= hoje)
      .sort((a, b) => (a.data === b.data ? (a.criadoEm ?? 0) - (b.criadoEm ?? 0) : a.data < b.data ? -1 : 1));
    if (vigentes.length !== lista.length) gravar(vigentes);
    return vigentes;
  }

  /**
   * @param {string} descricao
   * @param {string} data 'AAAA-MM-DD' (valor do <input type="date">)
   * @param {Date} [agora]
   * @returns {{ok: true, alerta: object} | {ok: false, erro: string}}
   */
  function adicionarAlerta(descricao, data, agora = new Date()) {
    const texto = String(descricao ?? '').trim();
    if (!texto) return { ok: false, erro: 'Escreva a descrição do alerta.' };
    if (texto.length > CONFIG_ALERTAS_GERAIS.MAX_DESCRICAO) {
      return { ok: false, erro: `Descrição muito longa (máximo ${CONFIG_ALERTAS_GERAIS.MAX_DESCRICAO} caracteres).` };
    }
    if (!dataDeIso(data)) return { ok: false, erro: 'Escolha a data do alerta.' };
    if (data < hojeIso(agora)) return { ok: false, erro: 'A data não pode ser no passado.' };

    const alerta = {
      id: `${agora.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      descricao: texto,
      data,
      criadoEm: agora.getTime(),
    };
    const lista = [...lerAlertas(agora), alerta];
    if (!gravar(lista)) return { ok: false, erro: 'Não consegui salvar (armazenamento do navegador bloqueado ou cheio).' };
    return { ok: true, alerta };
  }

  function excluirAlerta(id, agora = new Date()) {
    const lista = lerAlertas(agora);
    const restantes = lista.filter((a) => a.id !== id);
    return restantes.length !== lista.length && gravar(restantes);
  }

  function alertasDeHoje(agora = new Date()) {
    const hoje = hojeIso(agora);
    return lerAlertas(agora).filter((a) => a.data === hoje);
  }

  /* ---------------------------------------------------------------------
   * 3. DESENHO
   * --------------------------------------------------------------------- */
  function el(tag, props, estilo) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    if (estilo) Object.assign(e.style, estilo);
    return e;
  }

  // A lista de clientes -- a mesma rota que a Carteira (Módulo 14) fotografa.
  function naListaDeClientes() {
    return /^\/crm\/clientes\/?$/.test(location.pathname);
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function fecharAviso() {
    if (!avisoEl) return;
    avisoEl.remove();
    avisoEl = null;
  }

  function atualizarBotao() {
    const botao = document.getElementById(CONFIG_ALERTAS_GERAIS.ID_BOTAO);
    if (!botao) return;
    const total = lerAlertas().length;
    const hoje = alertasDeHoje().length;
    botao.textContent = hoje > 0
      ? `🔔 Alertas gerais · ${hoje} hoje`
      : `🔔 Alertas gerais${total > 0 ? ` (${total})` : ''}`;
    Object.assign(botao.style, hoje > 0
      ? { background: CORES.fundoHoje, borderColor: CORES.hoje, color: CORES.hoje }
      : { background: CORES.fundo, borderColor: CORES.borda, color: CORES.texto });
  }

  function criarCard(alerta) {
    const ehHoje = alerta.data === hojeIso();
    const card = el('div', {}, {
      display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderRadius: '8px',
      border: `1px solid ${CORES.borda}`, borderLeft: `4px solid ${ehHoje ? CORES.hoje : CORES.borda}`,
      background: ehHoje ? CORES.fundoHoje : CORES.fundo,
    });
    card.setAttribute('role', 'listitem');
    const corpo = el('div', {}, { flex: '1', minWidth: '0' });
    corpo.appendChild(el('div', { textContent: rotuloDaData(alerta.data) }, {
      fontSize: '11px', fontWeight: '700', color: ehHoje ? CORES.hoje : CORES.apagado, textTransform: 'uppercase', letterSpacing: '.03em',
    }));
    corpo.appendChild(el('div', { textContent: alerta.descricao }, {
      fontSize: '13px', color: CORES.tinta, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: '2px',
    }));
    const excluir = el('button', { type: 'button', textContent: '✕' }, {
      border: 'none', background: 'transparent', color: CORES.apagado, cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: '1',
    });
    excluir.setAttribute('aria-label', `Excluir alerta de ${rotuloDaData(alerta.data)}: ${alerta.descricao.slice(0, 40)}`);
    excluir.addEventListener('click', () => {
      excluirAlerta(alerta.id);
      desenharCards();
      atualizarBotao();
      if (alertasDeHoje().length === 0) fecharAviso();
    });
    card.appendChild(corpo);
    card.appendChild(excluir);
    return card;
  }

  function desenharCards() {
    const lista = painelEl?.querySelector('[data-papel="lista-alertas"]');
    if (!lista) return;
    lista.replaceChildren();
    const alertas = lerAlertas();
    if (alertas.length === 0) {
      lista.appendChild(el('div', { textContent: 'Nenhum alerta.' }, { color: CORES.apagado, fontSize: '12px', padding: '4px 0' }));
      return;
    }
    alertas.forEach((a) => lista.appendChild(criarCard(a)));
  }

  function abrirPainel() {
    window.__smartTableUtil?.fecharOutrosPaineis?.('alertasGerais');
    fecharPainel();

    painelEl = el('div', { id: CONFIG_ALERTAS_GERAIS.ID_PAINEL }, {
      position: 'fixed', bottom: '112px', left: '16px', zIndex: CONFIG_ALERTAS_GERAIS.Z_INDEX,
      width: '340px', maxWidth: '92vw', maxHeight: '70vh', overflowY: 'auto', boxSizing: 'border-box',
      background: CORES.fundo, border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 8px 24px rgba(16,24,40,0.18)', fontFamily: 'system-ui, -apple-system, sans-serif', color: CORES.texto,
    });
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-label', 'Alertas gerais');

    const topo = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
    topo.appendChild(el('div', { textContent: '🔔 Alertas gerais' }, { fontWeight: '700', fontSize: '15px', color: CORES.tinta }));
    const fechar = el('button', { type: 'button', textContent: '✕' }, {
      border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: CORES.apagado,
    });
    fechar.setAttribute('aria-label', 'Fechar alertas gerais');
    fechar.addEventListener('click', fecharPainel);
    topo.appendChild(fechar);
    painelEl.appendChild(topo);

    const campoEstilo = {
      width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: `1px solid ${CORES.borda}`,
      borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', color: CORES.tinta, background: CORES.fundo,
    };
    const rotulo = (texto, campo) => {
      const r = el('label', {}, { display: 'block', fontSize: '11px', fontWeight: '600', color: CORES.apagado, textTransform: 'uppercase', margin: '0 0 4px' });
      r.textContent = texto;
      r.appendChild(campo);
      campo.style.marginTop = '4px';
      return r;
    };
    const descricao = el('textarea', { rows: 2, maxLength: CONFIG_ALERTAS_GERAIS.MAX_DESCRICAO, placeholder: 'Ex.: ligar pro financeiro da Loja X' }, { ...campoEstilo, resize: 'vertical' });
    const data = el('input', { type: 'date', min: hojeIso(), value: hojeIso() }, campoEstilo);
    const erro = el('div', {}, { color: CORES.perigo, fontSize: '12px', minHeight: '0' });
    erro.setAttribute('role', 'alert');
    const confirmar = el('button', { type: 'button', textContent: 'Confirmar' }, {
      marginTop: '8px', width: '100%', padding: '7px 10px', border: 'none', borderRadius: '6px',
      background: CORES.tinta, color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
    });
    confirmar.addEventListener('click', () => {
      const r = adicionarAlerta(descricao.value, data.value);
      if (!r.ok) {
        erro.textContent = r.erro;
        return;
      }
      erro.textContent = '';
      descricao.value = '';
      desenharCards();
      atualizarBotao();
      descricao.focus();
    });

    const form = el('div', {}, { paddingBottom: '12px', marginBottom: '12px', borderBottom: `1px solid ${CORES.borda}` });
    form.appendChild(rotulo('Descrição', descricao));
    form.appendChild(el('div', {}, { height: '8px' }));
    form.appendChild(rotulo('Data', data));
    form.appendChild(erro);
    form.appendChild(confirmar);
    painelEl.appendChild(form);

    const lista = el('div', {}, { display: 'flex', flexDirection: 'column', gap: '6px' });
    lista.dataset.papel = 'lista-alertas';
    lista.setAttribute('role', 'list');
    lista.setAttribute('aria-label', 'Alertas agendados');
    painelEl.appendChild(lista);

    document.body.appendChild(painelEl);
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
    desenharCards();
    descricao.focus();
  }

  function alternarPainel() {
    if (painelEl) fecharPainel();
    else abrirPainel();
  }

  /** O aviso "alertas de hoje", na pilha de avisos, até excluir ou fechar. */
  function mostrarAvisoDeHoje() {
    const hoje = alertasDeHoje();
    if (hoje.length === 0 || avisoEl) return;

    avisoEl = el('div', { id: CONFIG_ALERTAS_GERAIS.ID_AVISO }, {
      background: CORES.fundo, color: CORES.tinta, border: `1px solid ${CORES.hoje}`, borderLeft: `5px solid ${CORES.hoje}`,
      borderRadius: '8px', padding: '10px 14px', width: '320px', maxWidth: '90vw', boxSizing: 'border-box',
      boxShadow: '0 6px 20px rgba(16,24,40,0.2)', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px',
      pointerEvents: 'auto',
    });
    avisoEl.setAttribute('role', 'status');
    avisoEl.appendChild(el('div', { textContent: hoje.length === 1 ? '🔔 Alerta de hoje' : `🔔 ${hoje.length} alertas de hoje` }, {
      fontWeight: '700', color: CORES.hoje, marginBottom: '4px',
    }));
    hoje.slice(0, CONFIG_ALERTAS_GERAIS.MAX_NO_AVISO).forEach((a) => {
      avisoEl.appendChild(el('div', { textContent: `• ${a.descricao}` }, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: '2px' }));
    });
    if (hoje.length > CONFIG_ALERTAS_GERAIS.MAX_NO_AVISO) {
      avisoEl.appendChild(el('div', { textContent: `e mais ${hoje.length - CONFIG_ALERTAS_GERAIS.MAX_NO_AVISO}` }, { color: CORES.apagado, marginTop: '2px' }));
    }
    const botoes = el('div', {}, { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' });
    const ver = el('button', { type: 'button', textContent: 'Ver alertas' }, {
      border: 'none', background: 'transparent', color: CORES.tinta, fontWeight: '700', cursor: 'pointer', fontSize: '12px', padding: '0',
    });
    ver.addEventListener('click', () => { fecharAviso(); abrirPainel(); });
    const fechar = el('button', { type: 'button', textContent: 'Fechar' }, {
      border: 'none', background: 'transparent', color: CORES.apagado, cursor: 'pointer', fontSize: '12px', padding: '0',
    });
    fechar.addEventListener('click', fecharAviso);
    botoes.appendChild(ver);
    botoes.appendChild(fechar);
    avisoEl.appendChild(botoes);

    const naPilha = window.__smartTableUtil?.colocarNaPilha;
    if (typeof naPilha === 'function') naPilha(avisoEl, { fixo: true });
    else {
      Object.assign(avisoEl.style, { position: 'fixed', bottom: '150px', right: '24px', zIndex: 999999 });
      document.body.appendChild(avisoEl);
    }
  }

  function criarBotao() {
    if (document.getElementById(CONFIG_ALERTAS_GERAIS.ID_BOTAO)) return;
    const botao = el('button', { type: 'button', id: CONFIG_ALERTAS_GERAIS.ID_BOTAO }, {
      border: `1px solid ${CORES.borda}`, cursor: 'pointer',
    });
    botao.addEventListener('click', alternarPainel);

    // Mesma barra do "▶ Iniciar Fila de Atendimento" (Módulo 3), com a
    // mesma classe nativa dos botões dela.
    const ancora = window.filaDebug?.ancoraToolbarLista?.() ?? null;
    if (ancora) {
      botao.className = 'pbi-btn pbi-btn-quiet';
      ancora.appendChild(botao);
    } else {
      Object.assign(botao.style, {
        position: 'fixed', bottom: '104px', left: '16px', zIndex: 999997, padding: '10px 16px', borderRadius: '8px',
        fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
      });
      document.body.appendChild(botao);
      window.__smartTableUtil?.acompanharMenuLateral?.(botao);
    }
    atualizarBotao();
  }

  /* ---------------------------------------------------------------------
   * 4. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  function iniciar() {
    lerAlertas(); // apaga os de dias anteriores, em qualquer tela
    if (!naListaDeClientes()) return;
    criarBotao();
    mostrarAvisoDeHoje();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('alertasGerais', fecharPainel);

  window.__alertasGerais = {
    lerAlertas,
    adicionarAlerta,
    excluirAlerta,
    alertasDeHoje,
    rotuloDaData,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    mostrarAvisoDeHoje,
    estaAberto: () => painelEl !== null,
    CONFIG_ALERTAS_GERAIS,
  };
})();
