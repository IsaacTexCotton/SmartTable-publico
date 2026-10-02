/* =========================================================================
 * MÓDULO 27: COPIAR TÍTULOS UM POR UM (Alt+T) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (02/10/2026): para consultar um título individualmente
 * ele copiava os números à mão, um por um. Aqui o SmartTable lê a tabela de
 * títulos da página do cliente e entrega o número e a parcela de cada título,
 * UM de cada vez, na área de transferência (e, portanto, no Win+V).
 *
 * Decisões do usuário:
 *   - número do título e parcela são copiados SEPARADOS (dois valores);
 *   - quais títulos: todos, só os vencidos ou selecionados um a um;
 *   - entrega "um por vez": cada Alt+T copia o PRÓXIMO valor;
 *   - ordem: a que aparece na tabela; tecla: Alt+T.
 *
 * Como funciona: Alt+T abre o painel (marque quais títulos e clique em
 * "Começar"). "Começar" copia o número do primeiro título; a partir daí cada
 * Alt+T copia o próximo valor: número, parcela, número do título seguinte,
 * parcela... Acabando a lista, o Alt+T volta a abrir o painel. Shift+Alt+T
 * abre o painel no meio da lista (para recomeçar ou recopiar o último).
 *
 * LEITURA: só a tabela de títulos que o Módulo 1 também lê (colunas pelo
 * data-key, sem posição fixa). Vencido = vencimento anterior a hoje (o mesmo
 * critério do Módulo 1: vence hoje ainda não é atraso). Vencimento ilegível
 * não entra em "Vencidos" e vem marcado na lista, nunca em silêncio. Se a
 * tabela mostra menos títulos do que a página tem em aberto (paginação), o
 * painel avisa. O módulo NÃO escreve nada no CRM e não guarda nada: a lista
 * em andamento vive só na memória desta página (recarregar a página a zera).
 *
 * Privacidade: nada vai para o console. Os números aparecem só na tela do
 * operador (painel e aviso), como já aparecem na tabela.
 *
 * ONDE COLAR: depois do Módulo 0 e ANTES do Módulo 4 (que liga o Alt+T).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__copiarTitulosCarregado) return;
  window.__copiarTitulosCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Copiar Títulos');

  const CONFIG_COPIAR = {
    ID_PAINEL: 'smarttable-copiar-titulos-painel',
    SELETOR_TABELA: '#tabela-titulos-ds table',
    // Colunas (data-key) sem as quais não dá para copiar com segurança.
    COLUNAS_EXIGIDAS: ['numeroTitulo', 'sequencia', 'dataVencimento'],
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
    DURACAO_AVISO_MS: 4500,
  };

  const MODOS = Object.freeze({ TODOS: 'todos', VENCIDOS: 'vencidos', SELECIONAR: 'selecionar' });

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    erro: '#B42318',
    aviso: '#B54708',
    fundo: '#ffffff',
  };

  const util = () => window.__smartTableUtil;

  let painelEl = null;
  // Lista em andamento: { passos: [{ valor, texto }], posicao } (só na memória).
  let sequencia = null;
  let copiando = false;

  /* ---------------------------------------------------------------------
   * LEITURA DA TABELA
   * --------------------------------------------------------------------- */

  /** "25/09/2026" -> Date ao meio-dia; null se não for uma data válida. */
  function lerDataBr(texto) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim());
    if (!m) return null;
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const ano = Number(m[3]);
    const data = new Date(ano, mes - 1, dia, 12, 0, 0, 0);
    const valida = data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
    return valida ? data : null;
  }

  /** Quantos títulos a página diz ter em aberto (null se não der para saber). */
  function totalEmAbertoDaPagina() {
    try {
      const abertos = util()?.lerVariavelDoScript?.(document, '__TITULOS_ABERTOS__');
      return Array.isArray(abertos) ? abertos.length : null;
    } catch {
      return null;
    }
  }

  /**
   * Os títulos da tabela, na ordem em que aparecem.
   *
   * @param {Date} [agora]
   * @returns {{titulos: Array<{numero: string, parcela: string, vencimento: string, vencido: boolean|null}>,
   *            totalNaPagina: number|null} | {erro: string}}
   */
  function lerTitulos(agora) {
    const tabela = document.querySelector(CONFIG_COPIAR.SELETOR_TABELA);
    if (!tabela) return { erro: 'Não achei a tabela de títulos nesta página.' };

    const idx = {};
    tabela.querySelectorAll('thead th[data-key]').forEach((th, i) => { idx[th.dataset.key] = i; });
    const faltando = CONFIG_COPIAR.COLUNAS_EXIGIDAS.filter((k) => idx[k] === undefined);
    if (faltando.length > 0) {
      return { erro: 'Coluna não encontrada na tabela: ' + faltando.join(', ') + '.' };
    }

    const hoje = util().normalizarData(agora ?? new Date());
    const celula = (celulas, chave) => (celulas[idx[chave]] ? celulas[idx[chave]].textContent.trim() : '');
    const titulos = [];
    tabela.querySelectorAll('tbody tr').forEach((tr) => {
      const celulas = tr.querySelectorAll('td');
      const numero = celula(celulas, 'numeroTitulo');
      if (!numero) return; // linha sem título (ex.: "nenhum registro")
      const vencimento = celula(celulas, 'dataVencimento');
      const data = lerDataBr(vencimento);
      titulos.push({
        numero,
        parcela: celula(celulas, 'sequencia'),
        vencimento,
        vencido: data ? data.getTime() < hoje.getTime() : null,
      });
    });
    return { titulos, totalNaPagina: totalEmAbertoDaPagina() };
  }

  /* ---------------------------------------------------------------------
   * SEQUÊNCIA: número, parcela, número, parcela...
   * --------------------------------------------------------------------- */

  /**
   * @param {Array<{numero: string, parcela: string}>} titulos os escolhidos, na ordem da tabela
   * @returns {Array<{valor: string, texto: string, ultimo: boolean}>}
   */
  function montarPassos(titulos) {
    const passos = [];
    titulos.forEach((t, i) => {
      const ordem = `Título ${i + 1}/${titulos.length}`;
      const proximo = i === titulos.length - 1 ? 'Fim da lista.' : 'Alt+T: próximo título.';
      const temParcela = t.parcela !== '';
      passos.push({
        valor: t.numero,
        texto: `${ordem}: número ${t.numero} copiado.` + (temParcela ? ' Alt+T: parcela.' : ` Sem parcela. ${proximo}`),
      });
      if (temParcela) {
        passos.push({ valor: t.parcela, texto: `${ordem}: parcela ${t.parcela} copiada. ${proximo}` });
      }
    });
    return passos;
  }

  async function escreverNaAreaDeTransferencia(valor) {
    try {
      // Sem a API (contexto inseguro) ou aba sem foco: tudo cai no catch e vira "não copiou".
      await window.navigator.clipboard.writeText(valor);
      return true;
    } catch {
      return false;
    }
  }

  const avisar = (mensagem) => util()?.toast?.(mensagem, CONFIG_COPIAR.DURACAO_AVISO_MS);

  /**
   * Copia o valor atual da lista e avança. Só avança se a cópia deu certo (senão o
   * mesmo Alt+T de novo tenta o mesmo valor). Devolve false se nada foi copiado.
   */
  async function copiarProximo() {
    if (!sequencia) return false;
    if (copiando) return false; // Alt+T duplo por reflexo não pula um valor
    copiando = true;
    let copiou = false;
    const passo = sequencia.passos[sequencia.posicao];
    try {
      copiou = await escreverNaAreaDeTransferencia(passo.valor);
    } finally {
      copiando = false;
    }
    if (!copiou) {
      avisar('Não consegui copiar (a aba precisa estar em foco). Aperte Alt+T de novo.');
      return false;
    }
    sequencia.posicao += 1;
    avisar(passo.texto);
    if (sequencia.posicao >= sequencia.passos.length) sequencia = null;
    return true;
  }

  /** Recopia o último valor copiado, sem avançar. */
  async function recopiarUltimo() {
    if (!sequencia) {
      avisar('Ainda não copiei nenhum valor desta lista.');
      return false;
    }
    const passo = sequencia.passos[sequencia.posicao - 1];
    if (await escreverNaAreaDeTransferencia(passo.valor)) {
      avisar('Recopiado: ' + passo.valor);
      return true;
    }
    avisar('Não consegui copiar (a aba precisa estar em foco).');
    return false;
  }

  /** Começa uma lista nova com os títulos escolhidos e já copia o primeiro valor. */
  async function comecar(titulos) {
    if (!Array.isArray(titulos) || titulos.length === 0) {
      avisar('Marque pelo menos um título.');
      return false;
    }
    sequencia = { passos: montarPassos(titulos), posicao: 0 };
    const ok = await copiarProximo();
    if (!ok) sequencia = null; // não deixa uma lista "em andamento" que nunca começou
    return ok;
  }

  /* ---------------------------------------------------------------------
   * PAINEL
   * --------------------------------------------------------------------- */

  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  function criarBotao(texto, acao, primario) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.dataset.acao = acao;
    Object.assign(b.style, primario
      ? { background: CORES.tinta, color: '#fff', border: 'none' }
      : { background: '#fff', color: CORES.texto, border: `1px solid ${CORES.borda}` });
    Object.assign(b.style, { borderRadius: '6px', padding: '6px 12px', fontSize: '12.5px', cursor: 'pointer', fontWeight: '600' });
    return b;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function abrirPainel() {
    // Só um painel flutuante nosso por vez (ver registrarPainel, Módulo 0).
    util()?.fecharOutrosPaineis?.('copiarTitulos');
    fecharPainel();

    const leitura = lerTitulos();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_COPIAR.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      bottom: '112px',
      left: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_COPIAR.Z_INDEX_POPUP,
      width: '420px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
    });

    painelEl.appendChild(criarDiv('Copiar títulos, um por um', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    painelEl.appendChild(criarDiv('Cada Alt+T copia o próximo valor: número do título, depois a parcela.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 10px',
    }));

    if (leitura.erro) {
      painelEl.appendChild(criarDiv(leitura.erro, { color: CORES.erro, margin: '6px 0 10px' }));
      painelEl.appendChild(criarDiv('Alt+T ou Esc para fechar', { color: CORES.apagado, fontSize: '11px', textAlign: 'center' }));
      document.body.appendChild(painelEl);
      util()?.acompanharMenuLateral?.(painelEl);
      return;
    }

    const { titulos, totalNaPagina } = leitura;
    const qtdVencidos = titulos.filter((t) => t.vencido === true).length;
    const ilegiveis = titulos.filter((t) => t.vencido === null).length;

    if (titulos.length === 0) {
      painelEl.appendChild(criarDiv('A tabela não tem nenhum título.', { color: CORES.erro, margin: '6px 0 10px' }));
    }
    if (totalNaPagina !== null && totalNaPagina !== titulos.length) {
      painelEl.appendChild(criarDiv(
        `A tabela mostra ${titulos.length} título(s) e a página tem ${totalNaPagina} em aberto. Confira antes de copiar.`,
        { color: CORES.aviso, margin: '0 0 8px', fontSize: '12px' },
      ));
    }
    if (ilegiveis > 0) {
      painelEl.appendChild(criarDiv(
        `${ilegiveis} título(s) com vencimento ilegível: não entram em "Vencidos".`,
        { color: CORES.aviso, margin: '0 0 8px', fontSize: '12px' },
      ));
    }
    if (sequencia) {
      painelEl.appendChild(criarDiv(
        `Lista em andamento: ${sequencia.posicao} de ${sequencia.passos.length} valores copiados. Começar de novo a substitui.`,
        { color: CORES.texto, margin: '0 0 8px', fontSize: '12px' },
      ));
    }

    // Modo (Todos / Vencidos / Selecionar) e a lista com uma caixa por título.
    const caixas = [];
    const marcados = () => titulos.filter((_, i) => caixas[i].checked);
    let botaoComecar = null;
    const atualizarBotao = () => {
      if (!botaoComecar) return;
      const n = marcados().length;
      botaoComecar.textContent = `Começar (${n})`;
      botaoComecar.disabled = n === 0;
      botaoComecar.style.opacity = n === 0 ? '0.5' : '1';
    };

    const linhaModos = criarDiv('', { display: 'flex', gap: '14px', margin: '0 0 8px', flexWrap: 'wrap' });
    const radios = {};
    const opcoesDeModo = [
      [MODOS.TODOS, `Todos (${titulos.length})`],
      [MODOS.VENCIDOS, `Vencidos (${qtdVencidos})`],
      [MODOS.SELECIONAR, 'Selecionar'],
    ];
    function aplicarModo(modo) {
      if (modo === MODOS.TODOS) titulos.forEach((_, i) => { caixas[i].checked = true; });
      if (modo === MODOS.VENCIDOS) titulos.forEach((t, i) => { caixas[i].checked = t.vencido === true; });
      // Selecionar não mexe nas marcas: a escolha é do operador.
      atualizarBotao();
    }
    opcoesDeModo.forEach(([modo, rotulo]) => {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: CORES.texto });
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'smarttable-copiar-titulos-modo';
      radio.value = modo;
      radio.checked = modo === MODOS.TODOS;
      radio.addEventListener('change', () => aplicarModo(modo));
      radios[modo] = radio;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(rotulo));
      linhaModos.appendChild(label);
    });
    painelEl.appendChild(linhaModos);

    const lista = criarDiv('', { borderTop: `1px solid ${CORES.linha}`, maxHeight: '260px', overflowY: 'auto' });
    lista.dataset.papel = 'lista-titulos';
    titulos.forEach((t, i) => {
      const label = document.createElement('label');
      Object.assign(label.style, {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 2px', cursor: 'pointer',
        borderBottom: `1px solid ${CORES.linha}`, color: CORES.texto,
      });
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.checked = true;
      caixa.dataset.indice = String(i);
      // Mexer numa caixa à mão é "Selecionar".
      caixa.addEventListener('change', () => { radios[MODOS.SELECIONAR].checked = true; atualizarBotao(); });
      caixas.push(caixa);
      const situacao = t.vencido === true ? 'vencido' : t.vencido === false ? 'a vencer' : 'vencimento ilegível';
      const texto = document.createElement('span');
      texto.textContent = `${t.numero}${t.parcela ? ' · parcela ' + t.parcela : ' · sem parcela'} · venc. ${t.vencimento || '?'} (${situacao})`;
      label.appendChild(caixa);
      label.appendChild(texto);
      lista.appendChild(label);
    });
    painelEl.appendChild(lista);

    const rodape = criarDiv('', { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px', flexWrap: 'wrap' });
    if (sequencia && sequencia.posicao > 0) {
      const recopiar = criarBotao('Recopiar o último', 'recopiar', false);
      recopiar.addEventListener('click', () => { recopiarUltimo(); });
      rodape.appendChild(recopiar);
    }
    const fechar = criarBotao('Fechar', 'fechar', false);
    fechar.addEventListener('click', fecharPainel);
    rodape.appendChild(fechar);
    botaoComecar = criarBotao('Começar', 'comecar', true);
    botaoComecar.addEventListener('click', async () => {
      const escolhidos = marcados(); // o botão fica desabilitado com 0 marcados
      // Fecha ANTES de copiar: o foco volta à página, que o clipboard exige.
      fecharPainel();
      await comecar(escolhidos);
    });
    rodape.appendChild(botaoComecar);
    painelEl.appendChild(rodape);
    atualizarBotao();

    painelEl.appendChild(criarDiv('Alt+T ou Esc para fechar', {
      color: CORES.apagado, fontSize: '11px', textAlign: 'center', marginTop: '8px',
    }));

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe.
    util()?.acompanharMenuLateral?.(painelEl);
    if (titulos.length > 0) botaoComecar.focus();
  }

  /**
   * O que o Alt+T chama (Shift+Alt+T passa `painel: true`):
   *   - painel aberto: fecha;
   *   - Shift ou nenhuma lista em andamento: abre o painel;
   *   - lista em andamento: copia o próximo valor.
   */
  function aoAtalho({ painel = false } = {}) {
    if (painelEl) {
      fecharPainel();
      return Promise.resolve(false);
    }
    if (painel || !sequencia) {
      abrirPainel();
      return Promise.resolve(false);
    }
    return copiarProximo();
  }

  // Esc fecha. Registrado uma vez só: um listener por abertura vazaria.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  util()?.registrarPainel?.('copiarTitulos', fecharPainel);

  window.__copiarTitulos = {
    lerTitulos,
    montarPassos,
    comecar,
    copiarProximo,
    recopiarUltimo,
    abrirPainel,
    fecharPainel,
    aoAtalho,
    estaAberto: () => painelEl !== null,
    emAndamento: () => (sequencia ? { posicao: sequencia.posicao, total: sequencia.passos.length } : null),
    CONFIG_COPIAR,
    MODOS,
  };
})();
