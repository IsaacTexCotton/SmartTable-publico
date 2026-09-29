/* =========================================================================
 * MÓDULO 17: PROMESSA RÁPIDA (Alt+N) — CRM TexCotton
 * -------------------------------------------------------------------------
 * PEDIDO DO USUÁRIO (v1.42.0): "registrar uma promessa de uma maneira mais
 * fácil". O que incomodava era a junção de três coisas no modal do CRM:
 * abrir o contato, achar os títulos na lista e escolher a data.
 *
 * DECISÕES (desafiadas antes de escrever -- red team com o usuário):
 *   - O CRM continua sendo quem grava. O painel só ESCOLHE; quem registra é
 *     o próprio modal "Registrar Contato", preenchido como um operador faria
 *     e salvo pelo botão "Salvar Contato" dele. Assim o CRM segue ligando os
 *     títulos à promessa, calculando juros e multa (o "Valor calculado") e
 *     validando -- nada disso é copiado aqui. Gravar direto pela API foi
 *     descartado: uma promessa aceita SEM títulos some da fila em silêncio
 *     (o Módulo 6 só considera promessa com título ainda aberto).
 *   - Nenhum título vem marcado, a não ser quando só existe UM vencido
 *     ("se ele tem um, com certeza é só ele"). Na maioria das vezes o
 *     cliente promete um ou alguns, e marcar todos por padrão viraria
 *     cobrança de "pagamento parcial" pra quem pagou o que combinou.
 *   - A data não tem padrão escondido: H (hoje), A (amanhã) ou outra. Sem
 *     data, não registra.
 *   - Título já em outra promessa: o CRM avisa ("encerrar a anterior e
 *     registrar esta"). O atalho PARA ali e devolve o modal pra você
 *     decidir -- nunca encerra promessa de ninguém sozinho. Idem com
 *     títulos de mais de uma razão (uma promessa por razão, cada uma com
 *     seu valor) e com qualquer "Confirmar ação" do CRM.
 *   - Depois de salvar, CONFERE: a promessa nova tem que aparecer na aba
 *     Promessas com a data e os títulos. Aparecendo, aviso verde; não
 *     aparecendo (ou o CRM mostrando "Promessa não criada"), aviso vermelho
 *     -- nunca silêncio. Se a página recarregar, a conferência continua
 *     depois do reload (ponte em localStorage, só com CNPJ, títulos e data).
 *
 * TELA (confirmada na captura em lote do CRM real, 25/09/2026):
 *   - A lista de títulos da promessa já vem pronta no HTML, com o modal
 *     fechado: #lista-titulos-promessa > .titulo-item-promessa, cada uma com
 *     input.titulo-checkbox-contato-promessa[value="915249/2"][data-atraso]
 *     [data-vencimento][data-cnpj][data-razao]. Títulos de outras razões do
 *     grupo têm .titulo-outra-razao e ficam escondidos até marcar
 *     #check-grupo-contato-promessa.
 *   - #btn-resultado-PROMESSA_PAGAMENTO abre #secao-promessa;
 *     #input-data-promessa (onchange recalcula) e #input-valor-promessa
 *     (preenchido pelo CRM); #select-forma-pagamento-contato (BOLETO por
 *     padrão); #conflitos-promessa-aviso; #valores-por-razao-wrap/-erro;
 *     #btn-salvar-contato (type=submit do form POST /crm/contatos).
 *   - Falha do CRM: #modal-aviso-promessa ("Promessa não criada", com a
 *     mensagem em #modal-aviso-promessa-mensagem).
 *
 * REGRA DO CARTÓRIO (v1.58.0, pedido do usuário, texto e visual aprovados em
 * 29/09/2026): não deixa registrar promessa para um título que, NA DATA
 * ESCOLHIDA, já estará em cartório. "Estará em cartório" = a data escolhida é
 * o dia seguinte ao último dia para pagamento (dataEncaminhamento, do Módulo
 * 1) ou depois; título que JÁ está em cartório também não agenda. Aviso
 * vermelho no painel (com a data máxima) E botão travado. NÃO vale para
 * cliente SCPC (fluxo SCPC) nem para título com posição "NAO PROTESTAR", que
 * nunca vai a cartório. Só cobre este painel: o campo de data do próprio CRM
 * (que não valida nada) e os botões do Módulo 2 (data de hoje) ficam de fora.
 *
 * NÃO conta como cobrança enviada no progresso da fila -- do mesmo jeito
 * que o "Salvar Contato" manual nunca contou (o Módulo 3 conta o Registrar e
 * Enviar, que é a cobrança saindo pelo WhatsApp).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__promessaRapidaCarregado) return;
  window.__promessaRapidaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Promessa Rápida');

  const CONFIG_PROMESSA = {
    ID_PAINEL: 'smarttable-painel-promessa',
    // Ponte pro reload: { cnpj, titulos, data, criadoEm }. Só isso.
    CHAVE_PONTE: 'smarttable_promessa_pendente_v1',
    VALIDADE_PONTE_MS: 3 * 60 * 1000,
    Z_INDEX: 30,
    // Esperas pelo CRM: o modal abrir, a seção de promessa aparecer, o
    // valor ser calculado, e o resultado do "Salvar Contato".
    TIMEOUT_MODAL_MS: 5000,
    TIMEOUT_VALOR_MS: 5000,
    TIMEOUT_RESULTADO_MS: 12000,
    TIMEOUT_CONFERENCIA_MS: 6000,
    INTERVALO_MS: 100,
    // A mesma frase das "Frases padrão" do CRM e do botão 📅 do Módulo 2.
    FRASE_OBSERVACAO: 'Cliente agendou o pagamento.',
    MAX_NUMERADOS: 9,
  };

  const SEL = {
    LISTA: '#lista-titulos-promessa',
    CHECK: '.titulo-checkbox-contato-promessa',
    LINHA: '.titulo-item-promessa',
    OUTRA_RAZAO: 'titulo-outra-razao',
    CHECK_GRUPO: '#check-grupo-contato-promessa',
    MODAL: '#modal-contato',
    ABRIR_CONTATO: 'openModalContato',
    RESULTADO_PROMESSA: '#btn-resultado-PROMESSA_PAGAMENTO',
    SECAO: '#secao-promessa',
    DATA: '#input-data-promessa',
    VALOR: '#input-valor-promessa',
    QTD: '#contato-promessa-qtd',
    FORMA: '#select-forma-pagamento-contato',
    RESUMO: '#contato-resumo',
    SALVAR: '#btn-salvar-contato',
    CONFLITO: '#conflitos-promessa-aviso',
    ERRO_RAZAO: '#valores-por-razao-erro',
    AVISO_NAO_CRIADA: '#modal-aviso-promessa',
    AVISO_NAO_CRIADA_MSG: '#modal-aviso-promessa-mensagem',
    CONFIRMAR_ACAO: '#modal-confirmar-acao',
  };

  const CORES = {
    tinta: '#16232F', texto: '#344054', apagado: '#98a2b3', borda: '#d0d5dd', fundo: '#ffffff',
    marca: '#1f5f8b', fundoMarca: '#eef4f9', alerta: '#B45309', fundoAlerta: '#FEF3E2',
    ok: '#1B6B4A', fundoOk: '#EFF6F1', perigo: '#B42318', fundoPerigo: '#FDF3F1',
  };
  const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  let painelEl = null;
  let registrando = false;

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
      const cs = getComputedStyle(x);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function esperarAte(condicao, timeoutMs) {
    return new Promise((resolve) => {
      const prazo = Date.now() + timeoutMs;
      (function tentar() {
        let r = null;
        try { r = condicao(); } catch (_) { r = null; }
        if (r) return resolve(r);
        if (Date.now() >= prazo) return resolve(null);
        setTimeout(tentar, CONFIG_PROMESSA.INTERVALO_MS);
      })();
    });
  }

  const hojeIso = (agora = new Date()) => window.__smartTableUtil.dataIso(agora);

  function dataDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }
  const isoMaisDias = (iso, dias) => { const d = dataDeIso(iso); d.setDate(d.getDate() + dias); return hojeIso(d); };
  const dataBr = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
  const dataCurta = (iso) => window.__smartTableUtil.dataCurtaDeIso(iso);

  /** "hoje, 25/09", "amanhã, 26/09" ou "seg, 28/09". */
  function rotuloDaData(iso, agora = new Date()) {
    const hoje = hojeIso(agora);
    if (iso === hoje) return `hoje, ${dataCurta(iso)}`;
    if (iso === isoMaisDias(hoje, 1)) return `amanhã, ${dataCurta(iso)}`;
    return `${DIAS_SEMANA[dataDeIso(iso).getDay()]}, ${dataCurta(iso)}`;
  }

  /** Hoje, amanhã e os três dias úteis (seg a sex) seguintes. */
  function datasSugeridas(agora = new Date()) {
    const hoje = hojeIso(agora);
    const lista = [hoje, isoMaisDias(hoje, 1)];
    let d = isoMaisDias(hoje, 1);
    while (lista.length < 5) {
      d = isoMaisDias(d, 1);
      const dia = dataDeIso(d).getDay();
      if (dia !== 0 && dia !== 6) lista.push(d);
    }
    return lista;
  }

  function cnpjDaUrl() {
    try { return new URL(location.href).searchParams.get('cnpj') || ''; } catch (_) { return ''; }
  }

  /* ---------------------------------------------------------------------
   * 1b. REGRA DO CARTÓRIO (ver o cabeçalho): dados do Módulo 1 da própria página
   * --------------------------------------------------------------------- */
  const ehNaoProtestar = (posicao) => /NAO\s+PROTESTAR/.test(String(posicao ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
  const isoDeData = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? hojeIso(d) : null);

  /** O que o Módulo 1 sabe desta página (títulos com situação e prazos), ou null sem ele. */
  function lerDadosDeCobranca() {
    try {
      return window.__avisoCobranca?.simular?.() ?? null;
    } catch (erro) {
      console.warn('[Promessa Rápida] Não consegui ler a situação dos títulos (regra do cartório desligada nesta leitura):', erro?.name);
      return null;
    }
  }

  /**
   * Títulos marcados que, na data escolhida, estarão em cartório.
   *
   * @param {string[]} valores  títulos marcados ("915249/2")
   * @param {string|null} iso   data escolhida (AAAA-MM-DD); sem data só pega quem já está em cartório
   * @param {object|null} dados retorno do simular() do Módulo 1
   * @returns {{valor: string, motivo: 'ja'|'data', encaminhamentoIso: string|null, ultimoDiaIso: string|null}[]}
   */
  function avaliarCartorioDaPromessa(valores, iso, dados) {
    if (!dados || dados.fluxo === 'SCPC') return [];
    const todos = [...(dados.registros ?? []), ...(dados.foraDoRelatorio ?? []), ...(dados.naoCobrar ?? [])];
    const porTitulo = new Map(todos.map((r) => [String(r.tituloCompleto), r]));
    const bloqueados = [];
    for (const valor of valores) {
      const r = porTitulo.get(String(valor));
      if (!r || ehNaoProtestar(r.posicao)) continue;
      const encaminhamentoIso = isoDeData(r.prazos?.dataEncaminhamento);
      const ultimoDiaIso = isoDeData(r.prazos?.dataLimitePagamento);
      if (r.situacaoKey === 'EM_CARTORIO') bloqueados.push({ valor, motivo: 'ja', encaminhamentoIso, ultimoDiaIso });
      else if (iso && encaminhamentoIso && iso >= encaminhamentoIso) bloqueados.push({ valor, motivo: 'data', encaminhamentoIso, ultimoDiaIso });
    }
    return bloqueados;
  }

  /** As frases do aviso vermelho (no máximo 3 títulos, depois "+N"). */
  function frasesDoBloqueio(bloqueios) {
    const linhas = bloqueios.slice(0, 3).map((b) => (b.motivo === 'ja'
      ? `Título ${b.valor} já está em cartório: não dá pra agendar.`
      : `Título ${b.valor} estará em cartório em ${dataBr(b.encaminhamentoIso)}; escolha até ${b.ultimoDiaIso ? dataBr(b.ultimoDiaIso) : 'o último dia para pagamento'}.`));
    if (bloqueios.length > 3) linhas.push(`+ ${bloqueios.length - 3} título(s) na mesma situação.`);
    linhas.push('Desmarque o título ou escolha outra data.');
    return linhas;
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA DA LISTA DO CRM (sem abrir o modal)
   * --------------------------------------------------------------------- */
  function titulosDaPromessaPendente() {
    // Títulos que já estão numa promessa PENDENTE (Módulo 6). Só informativo:
    // quem decide o conflito é o CRM, no modal.
    const mapa = new Map();
    try {
      const promessas = window.__contextoAdicionalDebug?.lerPromessas?.() || [];
      promessas.filter((p) => p.status === 'PENDENTE').forEach((p) => {
        (p.titulos || []).forEach((t) => mapa.set(String(t).replace('-', '/'), p.dataPrometidaTexto));
      });
    } catch (_) { /* sem o Módulo 6, sem a marca */ }
    return mapa;
  }

  /**
   * Títulos da lista de promessa do CRM, na ordem: os da razão do cliente
   * antes dos de outras razões do grupo; dentro de cada uma, vencidos (mais
   * dias primeiro) e depois os que ainda vão vencer. A numeração do painel
   * segue esta ordem -- e o separador "Outras razões do grupo" só funciona
   * se o grupo vier depois, mesmo quando um título dele está mais atrasado.
   */
  function lerTitulos() {
    const lista = document.querySelector(SEL.LISTA);
    if (!lista) return null;
    const emPromessa = titulosDaPromessaPendente();
    const titulos = [...lista.querySelectorAll(SEL.CHECK)].map((cb) => {
      const linha = cb.closest(SEL.LINHA);
      const spans = linha ? [...linha.querySelectorAll('span')] : [];
      const valorTela = spans.map((s) => s.textContent.trim()).reverse().find((t) => /^R\$/.test(t)) || '';
      const situacao = spans.map((s) => s.textContent.trim()).find((t) => /^[A-Z][A-Z ]{3,}$/.test(t) && !/LTDA|EIRELI|\bME\b/.test(t)) || '';
      return {
        valor: cb.value,
        atraso: Number(cb.dataset.atraso) || 0,
        vencimento: cb.dataset.vencimento || '',
        cnpj: cb.dataset.cnpj || '',
        razao: cb.dataset.razao || '',
        outraRazao: !!(linha && linha.classList.contains(SEL.OUTRA_RAZAO)),
        situacao,
        valorTela,
        promessaPendente: emPromessa.get(cb.value) || null,
      };
    });
    return titulos.sort((a, b) => (a.outraRazao - b.outraRazao) || ((b.atraso > 0) - (a.atraso > 0)) ||
      (b.atraso - a.atraso) || a.vencimento.localeCompare(b.vencimento));
  }

  /* ---------------------------------------------------------------------
   * 3. PAINEL
   * --------------------------------------------------------------------- */
  const estado = { titulos: [], marcados: new Set(), data: null, forma: null, mostrarAVencer: false, bloqueios: [] };

  function titulosVisiveis() {
    return estado.titulos.filter((t) => t.atraso > 0 || estado.mostrarAVencer || estado.marcados.has(t.valor));
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  /** Recalcula a regra do cartório com o que está marcado e a data escolhida agora. */
  function recalcularBloqueios() {
    estado.bloqueios = estado.marcados.size ? avaliarCartorioDaPromessa([...estado.marcados], estado.data, lerDadosDeCobranca()) : [];
    return estado.bloqueios;
  }

  function podeRegistrar() {
    return estado.marcados.size > 0 && !!estado.data && !registrando && estado.bloqueios.length === 0;
  }

  function resumoConfirmacao() {
    const marcados = estado.titulos.filter((t) => estado.marcados.has(t.valor));
    if (!marcados.length) return 'Marque o(s) título(s) que o cliente prometeu pagar.';
    if (estado.bloqueios.length) return 'Registro bloqueado: veja o aviso em vermelho.';
    if (!estado.data) return 'Escolha a data do pagamento (H, A ou outra).';
    const forma = document.querySelector(`${SEL.FORMA} option[value="${estado.forma}"]`)?.textContent.trim() || estado.forma || '';
    const razoes = new Set(marcados.map((t) => t.cnpj)).size;
    return `${rotuloDaData(estado.data)} · ${marcados.length === 1 ? '1 título' : `${marcados.length} títulos`}: ` +
      `${marcados.map((t) => t.valor).join(', ')}${forma ? ` · ${forma}` : ''}` +
      (razoes > 1 ? ` · ${razoes} razões (o CRM cria uma promessa por razão)` : '');
  }

  function desenhar() {
    if (!painelEl) return;
    const corpo = painelEl.querySelector('[data-papel="corpo"]');
    corpo.replaceChildren();

    recalcularBloqueios();

    // Títulos
    const visiveis = titulosVisiveis();
    const cab = el('div', { textContent: 'Títulos · 1 a 9 marcam e desmarcam' }, { fontSize: '11px', fontWeight: '700', color: CORES.apagado, textTransform: 'uppercase', margin: '0 0 6px' });
    corpo.appendChild(cab);
    const lista = el('div', {}, { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '40vh', overflowY: 'auto' });
    lista.setAttribute('role', 'group');
    lista.setAttribute('aria-label', 'Títulos da promessa');
    if (!visiveis.length) {
      lista.appendChild(el('div', { textContent: 'Nenhum título vencido neste cliente. T mostra os que ainda vão vencer.' }, { fontSize: '12px', color: CORES.apagado }));
    }
    let separouGrupo = false;
    visiveis.forEach((t, i) => {
      if (t.outraRazao && !separouGrupo) {
        separouGrupo = true;
        lista.appendChild(el('div', { textContent: 'Outras razões do grupo' }, { fontSize: '11px', fontWeight: '700', color: CORES.apagado, margin: '6px 0 0' }));
      }
      const marcado = estado.marcados.has(t.valor);
      const item = el('label', {}, {
        display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
        border: `1px solid ${marcado ? CORES.marca : CORES.borda}`, background: marcado ? CORES.fundoMarca : CORES.fundo,
      });
      const cb = el('input', { type: 'checkbox', checked: marcado }, { marginTop: '2px' });
      cb.addEventListener('change', () => alternarTitulo(t.valor));
      const numero = el('span', { textContent: i < CONFIG_PROMESSA.MAX_NUMERADOS ? String(i + 1) : '·' }, { fontWeight: '700', color: CORES.marca, minWidth: '10px' });
      const texto = el('div', {}, { flex: '1', minWidth: '0', fontSize: '12px', color: CORES.tinta });
      const dias = t.atraso > 0 ? `${t.atraso} ${t.atraso === 1 ? 'dia' : 'dias'}` : `vence ${dataCurta(t.vencimento)}`;
      texto.appendChild(el('div', { textContent: `${t.valor} · ${dias}${t.situacao ? ` · ${t.situacao}` : ''}${t.valorTela ? ` · ${t.valorTela}` : ''}` }, { fontWeight: '600' }));
      if (t.outraRazao && t.razao) texto.appendChild(el('div', { textContent: t.razao }, { color: CORES.apagado, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
      if (t.promessaPendente) {
        texto.appendChild(el('div', { textContent: `⚠ já está numa promessa pendente (${t.promessaPendente}) — o CRM vai pedir pra você decidir` }, { color: CORES.alerta }));
      }
      item.appendChild(cb);
      item.appendChild(numero);
      item.appendChild(texto);
      lista.appendChild(item);
    });
    corpo.appendChild(lista);
    const aVencer = estado.titulos.filter((t) => t.atraso <= 0).length;
    if (aVencer) {
      corpo.appendChild(el('div', { textContent: `T — ${estado.mostrarAVencer ? 'esconder' : 'mostrar'} os que ainda vão vencer (${aVencer})` }, { fontSize: '11px', color: CORES.apagado, margin: '4px 0 0' }));
    }

    // Data
    corpo.appendChild(el('div', { textContent: 'Data do pagamento · H hoje · A amanhã · D outra' }, { fontSize: '11px', fontWeight: '700', color: CORES.apagado, textTransform: 'uppercase', margin: '12px 0 6px' }));
    const datas = el('div', {}, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    datasSugeridas().forEach((iso) => {
      const ativo = estado.data === iso;
      const b = el('button', { type: 'button', textContent: rotuloDaData(iso) }, {
        padding: '4px 8px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
        border: `1px solid ${ativo ? CORES.marca : CORES.borda}`, background: ativo ? CORES.marca : CORES.fundo, color: ativo ? '#fff' : CORES.tinta,
      });
      b.setAttribute('aria-pressed', String(ativo));
      b.addEventListener('click', () => escolherData(iso));
      datas.appendChild(b);
    });
    const outra = el('input', { type: 'date', min: hojeIso(), value: estado.data && !datasSugeridas().includes(estado.data) ? estado.data : '' }, {
      padding: '3px 6px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', fontSize: '12px', color: CORES.tinta,
    });
    outra.dataset.papel = 'outra-data';
    outra.setAttribute('aria-label', 'Outra data');
    outra.addEventListener('change', () => { if (outra.value) escolherData(outra.value); });
    datas.appendChild(outra);
    corpo.appendChild(datas);

    // Regra do cartório: aviso vermelho (o botão de registrar fica travado).
    if (estado.bloqueios.length) {
      const caixa = el('div', {}, {
        marginTop: '10px', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', lineHeight: '1.4',
        color: CORES.perigo, background: CORES.fundoPerigo, border: `1px solid ${CORES.perigo}`,
      });
      caixa.dataset.papel = 'bloqueio-cartorio';
      caixa.setAttribute('role', 'alert');
      frasesDoBloqueio(estado.bloqueios).forEach((linha) => caixa.appendChild(el('div', { textContent: linha })));
      corpo.appendChild(caixa);
    }

    // Forma de pagamento (as opções do próprio CRM)
    const opcoes = [...document.querySelectorAll(`${SEL.FORMA} option`)];
    if (opcoes.length) {
      const forma = el('select', {}, { marginTop: '10px', padding: '4px 6px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', fontSize: '12px', color: CORES.tinta });
      forma.setAttribute('aria-label', 'Forma de pagamento');
      opcoes.forEach((o) => forma.appendChild(el('option', { value: o.value, textContent: o.textContent.trim(), selected: o.value === estado.forma })));
      forma.addEventListener('change', () => { estado.forma = forma.value; atualizarRodape(); });
      const rot = el('label', { textContent: 'Forma de pagamento ' }, { display: 'block', fontSize: '12px', color: CORES.texto });
      rot.appendChild(forma);
      corpo.appendChild(rot);
    }
    atualizarRodape();
  }

  function atualizarRodape() {
    if (!painelEl) return;
    painelEl.querySelector('[data-papel="resumo"]').textContent = resumoConfirmacao();
    const botao = painelEl.querySelector('[data-papel="registrar"]');
    botao.disabled = !podeRegistrar();
    botao.style.opacity = botao.disabled ? '0.5' : '1';
    botao.style.cursor = botao.disabled ? 'not-allowed' : 'pointer';
  }

  function alternarTitulo(valor) {
    if (estado.marcados.has(valor)) estado.marcados.delete(valor);
    else estado.marcados.add(valor);
    desenhar();
  }

  function escolherData(iso) {
    if (!dataDeIso(iso) || iso < hojeIso()) return;
    estado.data = iso;
    desenhar();
  }

  function aoTeclar(e) {
    const alvo = e.target;
    const emCampo = alvo && (alvo.tagName === 'INPUT' && alvo.type !== 'checkbox' || alvo.tagName === 'SELECT');
    if (e.key === 'Escape') { e.preventDefault(); fecharPainel(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (podeRegistrar()) registrar();
      return;
    }
    if (emCampo || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (n) {
      const t = titulosVisiveis()[Number(n[1]) - 1];
      if (t) { e.preventDefault(); alternarTitulo(t.valor); }
      return;
    }
    if (e.code === 'KeyH') { e.preventDefault(); escolherData(hojeIso()); }
    else if (e.code === 'KeyA') { e.preventDefault(); escolherData(isoMaisDias(hojeIso(), 1)); }
    else if (e.code === 'KeyT') { e.preventDefault(); estado.mostrarAVencer = !estado.mostrarAVencer; desenhar(); }
    else if (e.code === 'KeyD') { e.preventDefault(); painelEl.querySelector('[data-papel="outra-data"]')?.focus(); }
  }

  function abrirPainel() {
    const titulos = lerTitulos();
    if (!titulos) {
      avisar('A promessa rápida (Alt+N) funciona na página de um cliente.', 'erro');
      return;
    }
    if (visivel(document.querySelector(SEL.MODAL))) {
      avisar('Há um contato aberto: salve ou feche antes de registrar a promessa (Alt+N).', 'erro');
      return;
    }
    window.__smartTableUtil?.fecharOutrosPaineis?.('promessaRapida');
    fecharPainel();

    const vencidos = titulos.filter((t) => t.atraso > 0);
    estado.titulos = titulos;
    estado.marcados = new Set(vencidos.length === 1 ? [vencidos[0].valor] : []);
    estado.data = null;
    estado.forma = document.querySelector(SEL.FORMA)?.value || null;
    estado.mostrarAVencer = vencidos.length === 0;
    estado.bloqueios = [];

    painelEl = el('div', { id: CONFIG_PROMESSA.ID_PAINEL, tabIndex: -1 }, {
      position: 'fixed', top: '96px', left: '16px', zIndex: CONFIG_PROMESSA.Z_INDEX,
      width: '380px', maxWidth: '92vw', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', boxSizing: 'border-box',
      background: CORES.fundo, border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 8px 24px rgba(16,24,40,0.18)', fontFamily: 'system-ui, -apple-system, sans-serif', color: CORES.texto, outline: 'none',
    });
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-label', 'Registrar promessa');

    const topo = el('div', {}, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
    topo.appendChild(el('div', { textContent: '📅 Registrar promessa' }, { fontWeight: '700', fontSize: '15px', color: CORES.tinta }));
    const fechar = el('button', { type: 'button', textContent: '✕' }, { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: CORES.apagado });
    fechar.setAttribute('aria-label', 'Fechar (Esc)');
    fechar.addEventListener('click', fecharPainel);
    topo.appendChild(fechar);
    painelEl.appendChild(topo);

    const ctx = window.__contextoAdicional;
    if (ctx?.promessa?.tipo === 'DIA_DA_PROMESSA') {
      painelEl.appendChild(el('div', { textContent: 'Este cliente já tem promessa pendente pra hoje.' }, {
        fontSize: '12px', color: CORES.alerta, background: CORES.fundoAlerta, borderRadius: '6px', padding: '6px 8px', marginBottom: '8px',
      }));
    }

    const corpo = el('div');
    corpo.dataset.papel = 'corpo';
    painelEl.appendChild(corpo);

    const rodape = el('div', {}, { borderTop: `1px solid ${CORES.borda}`, marginTop: '12px', paddingTop: '10px' });
    const resumo = el('div', {}, { fontSize: '12px', color: CORES.tinta, minHeight: '16px' });
    resumo.dataset.papel = 'resumo';
    resumo.setAttribute('aria-live', 'polite');
    const botao = el('button', { type: 'button', textContent: 'Enter · Registrar promessa' }, {
      marginTop: '8px', width: '100%', padding: '8px 10px', border: 'none', borderRadius: '6px',
      background: CORES.tinta, color: '#fff', fontSize: '13px', fontWeight: '600',
    });
    botao.dataset.papel = 'registrar';
    botao.addEventListener('click', () => { if (podeRegistrar()) registrar(); });
    rodape.appendChild(resumo);
    rodape.appendChild(botao);
    painelEl.appendChild(rodape);

    painelEl.addEventListener('keydown', (e) => { e.stopPropagation(); aoTeclar(e); });
    document.body.appendChild(painelEl);
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
    desenhar();
    painelEl.focus();
  }

  function alternarPainel() {
    if (registrando) { avisar('Registrando a promessa, aguarde.', 'info'); return; }
    if (painelEl) fecharPainel();
    else abrirPainel();
  }

  /* ---------------------------------------------------------------------
   * 4. AVISOS (na pilha do Módulo 0, com cor: verde, vermelho, âmbar)
   * --------------------------------------------------------------------- */
  function avisar(texto, tipo = 'info', duracaoMs) {
    const cor = { ok: [CORES.ok, CORES.fundoOk], erro: [CORES.perigo, CORES.fundoPerigo], alerta: [CORES.alerta, CORES.fundoAlerta], info: [CORES.tinta, '#F2F4F7'] }[tipo] || [CORES.tinta, '#F2F4F7'];
    const aviso = el('div', { textContent: texto }, {
      maxWidth: '380px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.4',
      color: cor[0], background: cor[1], border: `1px solid ${cor[0]}`, boxShadow: '0 4px 14px rgba(16,24,40,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif', marginTop: '8px',
    });
    aviso.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    aviso.dataset.promessaRapida = tipo;
    if (window.__smartTableUtil?.colocarNaPilha) window.__smartTableUtil.colocarNaPilha(aviso);
    else {
      Object.assign(aviso.style, { position: 'fixed', right: '16px', bottom: '150px', zIndex: '999999' });
      document.body.appendChild(aviso);
    }
    const ms = duracaoMs || (tipo === 'erro' ? 12000 : 6000);
    setTimeout(() => aviso.remove(), ms);
    return aviso;
  }

  /* ---------------------------------------------------------------------
   * 5. REGISTRO: preenche o modal do CRM e salva pelo botão dele
   * --------------------------------------------------------------------- */
  function abrirModalContato() {
    const gatilho = [...document.querySelectorAll('[onclick]')].find((e) => new RegExp(`^\\s*${SEL.ABRIR_CONTATO}\\s*\\(`).test(e.getAttribute('onclick')));
    if (gatilho) { gatilho.click(); return true; }
    if (typeof window[SEL.ABRIR_CONTATO] === 'function') { window[SEL.ABRIR_CONTATO](); return true; }
    return false;
  }

  function lerPonte() {
    try { return JSON.parse(localStorage.getItem(CONFIG_PROMESSA.CHAVE_PONTE) || 'null'); } catch (_) { return null; }
  }
  function gravarPonte(ponte) {
    try { localStorage.setItem(CONFIG_PROMESSA.CHAVE_PONTE, JSON.stringify(ponte)); } catch (_) { /* sem ponte, confere só sem reload */ }
  }
  function apagarPonte() {
    try { localStorage.removeItem(CONFIG_PROMESSA.CHAVE_PONTE); } catch (_) { /* nada a fazer */ }
  }

  /** Para o fluxo e devolve o modal aberto pro operador, com o motivo. */
  function devolver(motivo, tipo = 'alerta') {
    avisar(motivo, tipo, 15000);
    return { ok: false, motivo };
  }

  async function registrar() {
    if (registrando) return { ok: false, motivo: 'já registrando' };
    const escolha = {
      titulos: estado.titulos.filter((t) => estado.marcados.has(t.valor)),
      data: estado.data,
      forma: estado.forma,
    };
    if (!escolha.titulos.length || !escolha.data) return { ok: false, motivo: 'faltou título ou data' };
    if (recalcularBloqueios().length) return { ok: false, motivo: 'título em cartório na data escolhida' };
    registrando = true;
    fecharPainel();
    try {
      return await preencherESalvar(escolha);
    } finally {
      registrando = false;
    }
  }

  async function preencherESalvar(escolha) {
    // 1. Abre o contato e escolhe "Promessa de Pagamento".
    if (!abrirModalContato()) return devolver('Não achei o botão que abre o contato nesta página.', 'erro');
    const botaoResultado = await esperarAte(() => {
      const b = document.querySelector(SEL.RESULTADO_PROMESSA);
      return visivel(document.querySelector(SEL.MODAL)) && b ? b : null;
    }, CONFIG_PROMESSA.TIMEOUT_MODAL_MS);
    if (!botaoResultado) return devolver('O contato não abriu a tempo. Tente o Alt+N de novo.', 'erro');
    botaoResultado.click();
    if (!(await esperarAte(() => visivel(document.querySelector(SEL.SECAO)), CONFIG_PROMESSA.TIMEOUT_MODAL_MS))) {
      return devolver('A seção de promessa não apareceu no contato. Confira o modal.', 'erro');
    }

    // 2. Títulos: os de outra razão só aparecem com o grupo incluído.
    if (escolha.titulos.some((t) => t.outraRazao)) {
      const grupo = document.querySelector(SEL.CHECK_GRUPO);
      if (grupo && !grupo.checked) grupo.click();
    }
    const checks = [...document.querySelectorAll(`${SEL.LISTA} ${SEL.CHECK}`)];
    const faltando = [];
    escolha.titulos.forEach((t) => {
      const cb = checks.find((c) => c.value === t.valor);
      if (!cb) faltando.push(t.valor);
      else if (!cb.checked) cb.click();
    });
    if (faltando.length) return devolver(`Não achei no contato: ${faltando.join(', ')}. Nada foi salvo; confira o modal.`, 'erro');

    // 3. Data (o CRM recalcula o valor no change) e forma de pagamento.
    const data = document.querySelector(SEL.DATA);
    if (!data) return devolver('Não achei o campo de data da promessa. Nada foi salvo.', 'erro');
    data.value = escolha.data;
    data.dispatchEvent(new Event('input', { bubbles: true }));
    data.dispatchEvent(new Event('change', { bubbles: true }));
    const forma = document.querySelector(SEL.FORMA);
    if (forma && escolha.forma && forma.value !== escolha.forma) {
      forma.value = escolha.forma;
      forma.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 4. O CRM precisa ter calculado o valor antes de salvar.
    const valorOk = await esperarAte(() => {
      const v = document.querySelector(SEL.VALOR);
      return v && /\d/.test(v.value) && !/^0*[.,]?0*$/.test(v.value.replace(/[^\d.,]/g, '')) ? v : null;
    }, CONFIG_PROMESSA.TIMEOUT_VALOR_MS);

    // 5. Onde o CRM pede decisão, quem decide é o operador.
    if (visivel(document.querySelector(SEL.CONFLITO))) {
      return devolver('Título já está em outra promessa. O CRM está perguntando o que fazer: decida no contato e clique em Salvar Contato.');
    }
    if (visivel(document.querySelector(SEL.ERRO_RAZAO))) {
      return devolver('O CRM apontou um problema nos valores por razão. Confira no contato antes de salvar.');
    }
    if (!valorOk) return devolver('O valor da promessa não foi calculado. Confira no contato antes de salvar.');
    if (new Set(escolha.titulos.map((t) => t.cnpj)).size > 1) {
      return devolver('Títulos de mais de uma razão: o CRM cria uma promessa por razão. Confira os valores no contato e clique em Salvar Contato.');
    }

    // 6. Observação: a frase padrão, sem apagar nada que já esteja lá.
    const resumo = document.querySelector(SEL.RESUMO);
    if (resumo && !resumo.value.includes(CONFIG_PROMESSA.FRASE_OBSERVACAO)) {
      resumo.value = resumo.value.trim() ? `${resumo.value.trim()}\n${CONFIG_PROMESSA.FRASE_OBSERVACAO}` : CONFIG_PROMESSA.FRASE_OBSERVACAO;
      resumo.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 7. Salva pelo botão do CRM -- e confere.
    const salvar = document.querySelector(SEL.SALVAR);
    if (!salvar || salvar.disabled) return devolver('O botão Salvar Contato está desabilitado. Confira o contato.', 'erro');
    const ponte = { cnpj: cnpjDaUrl(), titulos: escolha.titulos.map((t) => t.valor), data: escolha.data, criadoEm: Date.now() };
    gravarPonte(ponte);
    salvar.click();
    return acompanharResultado(ponte);
  }

  /** A promessa da ponte já está na aba Promessas? */
  function promessaApareceu(ponte) {
    const lerPromessas = window.__contextoAdicionalDebug?.lerPromessas;
    if (typeof lerPromessas !== 'function') return false;
    const dataBrPonte = dataBr(ponte.data);
    return lerPromessas().some((p) => p.dataPrometidaTexto === dataBrPonte &&
      ponte.titulos.every((t) => (p.titulos || []).map((x) => String(x).replace('-', '/')).includes(t)));
  }

  function textoSucesso(ponte) {
    return `✓ Promessa registrada: ${rotuloDaData(ponte.data)} · ${ponte.titulos.join(', ')}.`;
  }

  async function acompanharResultado(ponte) {
    const resultado = await esperarAte(() => {
      if (visivel(document.querySelector(SEL.AVISO_NAO_CRIADA))) return 'nao-criada';
      if (visivel(document.querySelector(SEL.CONFIRMAR_ACAO))) return 'confirmar';
      if (promessaApareceu(ponte)) return 'ok';
      return null;
    }, CONFIG_PROMESSA.TIMEOUT_RESULTADO_MS);

    if (resultado === 'ok') {
      apagarPonte();
      avisar(textoSucesso(ponte), 'ok');
      return { ok: true };
    }
    if (resultado === 'nao-criada') {
      apagarPonte();
      const msg = document.querySelector(SEL.AVISO_NAO_CRIADA_MSG)?.textContent.trim();
      return devolver(`O CRM não criou a promessa${msg ? `: ${msg}` : '.'}`, 'erro');
    }
    if (resultado === 'confirmar') {
      // A ponte fica: se você confirmar e a página recarregar, a conferência segue.
      return devolver('O CRM pediu uma confirmação. Decida no aviso dele; depois eu confiro se a promessa apareceu.');
    }
    // Sem reload, sem aviso e sem a promessa na aba: não afirma nada.
    apagarPonte();
    return devolver('Não consegui confirmar se a promessa foi criada. Confira a aba Promessas antes de seguir.', 'erro');
  }

  /** Depois do reload do "Salvar Contato": confere a ponte deixada antes do clique. */
  async function conferirDepoisDoReload() {
    const ponte = lerPonte();
    if (!ponte) return;
    const idade = Date.now() - (ponte.criadoEm || 0);
    if (!(idade >= 0 && idade <= CONFIG_PROMESSA.VALIDADE_PONTE_MS) || ponte.cnpj !== cnpjDaUrl()) {
      // De outro cliente ou velha demais: não diz nada de ninguém.
      if (idade > CONFIG_PROMESSA.VALIDADE_PONTE_MS) apagarPonte();
      return;
    }
    apagarPonte();
    const apareceu = await esperarAte(() => promessaApareceu(ponte), CONFIG_PROMESSA.TIMEOUT_CONFERENCIA_MS);
    if (apareceu) avisar(textoSucesso(ponte), 'ok');
    else avisar(`A promessa de ${rotuloDaData(ponte.data)} (${ponte.titulos.join(', ')}) não apareceu na aba Promessas. Confira antes de seguir.`, 'erro', 20000);
  }

  /* ---------------------------------------------------------------------
   * 6. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  let iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    conferirDepoisDoReload();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('promessaRapida', fecharPainel);

  window.__promessaRapida = {
    abrirPainel,
    fecharPainel,
    alternarPainel,
    registrar,
    lerTitulos,
    avaliarCartorioDaPromessa,
    frasesDoBloqueio,
    datasSugeridas,
    rotuloDaData,
    conferirDepoisDoReload,
    estaAberto: () => painelEl !== null,
    estaRegistrando: () => registrando,
    estado,
    CONFIG_PROMESSA,
  };
})();
