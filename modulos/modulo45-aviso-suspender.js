/* =========================================================================
 * MÓDULO 45: AVISO "!" DE SUSPENSÃO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (24/11/2026): uma prioridade no Progresso da fila para os clientes que têm, na lista de clientes, o "!" da situação
 * (`span.aviso-suspender`: "Tem título protestado com saldo ou vencido há mais de 20 dias. Pela regra deveria estar com crédito Suspenso (2) e
 * cobrança Devedor Tex (4)."), "da mesma maneira" que o grupo "Verificar no banco" (Módulos 7, 11 e 44). Decisões do usuário (24/11/2026): o "!" não
 * se retira à mão, então a barra anda por um botão "Verificado" no cliente; marcado, ele sai da pendência até o "!" ser retirado e inserido de novo;
 * o total do dia fica fixo; o grupo vem abaixo do "Verificar no banco"; botão em cartão na página do cliente, no padrão do aviso do Módulo 44.
 *
 * ONDE O "!" NASCE (diagnóstico do usuário, docs/recursos/aviso-suspender.md): na LISTA de clientes, coluna "Situação". O JavaScript da lista o
 * desenha quando `row.deveSuspender` é verdadeiro; o HTML baixado não o traz. Este módulo lê esse MESMO campo em `window.CLIENTES`. CONFIRMADO no CRM
 * real (24/11/2026, console do usuário, só números): `deveSuspender` é booleano nas 234 linhas de `window.CLIENTES`, e os 14 verdadeiros são os 14 "!" da
 * tela. Se um dia NENHUMA linha tiver o campo (o CRM mudou), o resultado é "sem leitura" e nada é gravado (nunca um "0 clientes" falso).
 *
 * REGRA DE ENTRADA NO GRUPO (decisão do usuário, 24/11/2026): quem tem o "!" entra, EXCETO o cliente de CARTÓRIO (SCPC "n" na lista, o mesmo critério do
 * fluxo Cartório do Alt+U) com menos de 28 dias de atraso (`diasAtraso` da lista; 28 entra, 27 não; sem número, fica de fora). SCPC "S"/"s" segue só o "!" do CRM.
 * A versão dessa regra (`REGRA_DO_GRUPO`) vai gravada no grupo do dia: grupo gravado com outra regra não vale e é refeito na próxima lista completa.
 *
 * ALT+P NO GRUPO (decisão do usuário, 24/11/2026: "não está sendo possível ir para o próximo cliente nesta prioridade"): entrar pelo clique na barra do grupo
 * (Módulo 11) liga o "modo grupo" (sessionStorage, desta aba, do dia); com ele, o Alt+P (Módulo 4) vai ao próximo cliente do grupo ainda sem "Verificado" em vez
 * de seguir a fila do Alt+U. O modo acaba sozinho: Alt+U, clique numa faixa ou no outro grupo, o fim do grupo, ou o cliente da página não ser do grupo.
 *
 * O QUE FAZ: (1) na lista, grava o grupo do dia (cnpj e endereço de quem tem o "!"), SÓ na primeira lista completa do dia (como o snapshot do
 * progresso: o total fica fixo), e apaga a marca de quem já não tem o "!" (assim o "!" que volta pede verificação de novo); (2) na página do cliente do
 * grupo, ainda sem marca, mostra o cartão com o botão "Verificado". Só lê a página; nada é enviado nem gravado no CRM. Guarda em `localStorage`
 * (só neste navegador): o grupo do dia e as marcas (CNPJ completo -> data). Carga: depois dos Módulos 0 e 44. Expõe window.__avisoSuspender.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__avisoSuspenderCarregado) return;
  window.__avisoSuspenderCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Aviso de Suspensão');

  const CONFIG = Object.freeze({
    CHAVE_DIA: 'smarttable_aviso_suspender_dia_v1',
    CHAVE_MARCAS: 'smarttable_aviso_suspender_v1',
    ID_AVISO: 'smarttable-aviso-suspender',
    ID_AVISO_VERIFICAR_BANCO: 'smarttable-aviso-verificar-banco',
    CAMPO_DO_CRM: 'deveSuspender',
    REPETIR_REGISTRO_MS: 1500,
    ESPACO_ENTRE_AVISOS_PX: 12,
    BORDA_PX: 20,
    FOLGA_TOPO_PX: 8, // distância mínima entre o cartão e o cabeçalho fixo do CRM
    ALTURA_MINIMA_PX: 160,
    // Cliente de cartório (SCPC "n" na lista): só entra no grupo com este atraso mínimo, em dias (>=).
    DIAS_MINIMOS_CARTORIO: 28,
    // Versão da regra de entrada no grupo (1 = só o "!"; 2 = mais o mínimo de 28 dias para cartório). Grupo gravado com outra versão não vale.
    REGRA_DO_GRUPO: 2,
    CHAVE_MODO: 'smarttable_aviso_suspender_modo_v1', // sessionStorage: o "modo grupo" do Alt+P, por aba
    ESPERA_NAVEGAR_MS: 350, // o toast aparece antes da página trocar (como o Próximo do Módulo 3)
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  });

  // Classes NATIVAS do CRM, as MESMAS do aviso do Módulo 44 (vistas nas fixtures reais; o teste confere cada uma e que são iguais às do 44).
  const CLASSES = Object.freeze({
    avisoCartao: 'fixed bottom-5 right-5 bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col',
    topo: 'px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0',
    topoEsquerda: 'flex items-center gap-2.5',
    iconeCaixa: 'p-1.5 bg-gray-100 rounded-lg',
    icone: 'w-4 h-4 text-gray-400',
    titulo: 'text-sm font-semibold text-gray-800',
    corpo: 'overflow-y-auto px-5 py-4 flex-1 space-y-4',
    rodape: 'flex flex-col sm:flex-row sm:justify-between gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0',
    rodapeDireita: 'flex justify-end gap-3',
    botaoSecundario: 'px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition',
    botaoPrimario: 'px-5 py-2 text-sm bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-200 disabled:cursor-not-allowed text-gray-800 rounded-lg font-semibold transition flex items-center gap-2',
    nota: 'flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg',
    notaTexto: 'text-xs text-gray-700',
    texto: 'text-sm text-gray-700',
    erro: 'bg-red-100 text-red-800 rounded-lg px-3 py-2 text-sm',
  });

  /* ---------------------------------------------------------------------
   * IDENTIDADE E LEITURA DA LISTA
   * --------------------------------------------------------------------- */
  const cnpjCompleto = (v) => window.__smartTableUtil?.cnpjCompleto?.(v) ?? String(v ?? '').replace(/\D/g, '');
  const cnpjDaPagina = () => {
    try { return new URLSearchParams(window.location.search).get('cnpj') || ''; } catch { return ''; }
  };
  const hojeIso = () => window.__smartTableUtil?.dataIso?.(new Date()) ?? '';
  const temCampo = (linha) => Boolean(linha) && typeof linha === 'object' && linha[CONFIG.CAMPO_DO_CRM] !== undefined;

  /** Cliente do fluxo Cartório: SCPC "n" na lista (vem em caixa mista: "n", "S", "s"). Sem o campo, não é cartório (vale só o "!" do CRM). */
  const ehCartorio = (linha) => String(linha?.scpc ?? '').trim().toLowerCase() === 'n';
  /** Cartório precisa de atraso numérico >= o mínimo; atraso ausente não prova nada e fica de fora. */
  const atrasoSuficiente = (linha) => typeof linha?.diasAtraso === 'number' && linha.diasAtraso >= CONFIG.DIAS_MINIMOS_CARTORIO;

  function urlDoCliente(linha) {
    const controle = Number(linha?.controleCliente);
    if (!Number.isFinite(controle) || !linha?.cnpj) return null;
    return window.__smartTableUtil?.montarUrlCliente?.(controle, linha.cnpj) ?? null;
  }

  /**
   * Quem tem o "!" na lista aberta. `null` = não dá para ler (sem `window.CLIENTES`, lista vazia, ou NENHUMA linha com o campo do CRM): diferente de
   * `[]` (leu e ninguém tem o "!"). Verdadeiro/falso como o CRM decide (`row.deveSuspender` truthy).
   * @returns {{lidos: number, foraPeloMinimo: number, clientes: {cnpj: string, url: string|null}[]}|null}
   *   `foraPeloMinimo` = quantos têm o "!" mas são de cartório com menos de 28 dias (não entram).
   */
  function lerDaLista() {
    const lista = window.CLIENTES;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    if (!lista.some(temCampo)) return null;
    const comAviso = lista.filter((c) => c && c.cnpj && Boolean(c[CONFIG.CAMPO_DO_CRM]));
    const entram = comAviso.filter((c) => !ehCartorio(c) || atrasoSuficiente(c));
    return {
      lidos: lista.length,
      foraPeloMinimo: comAviso.length - entram.length,
      clientes: entram.map((c) => ({ cnpj: c.cnpj, url: urlDoCliente(c) })),
    };
  }

  /* ---------------------------------------------------------------------
   * GRUPO DO DIA (a "primeira lista completa do dia")
   * --------------------------------------------------------------------- */
  /** O grupo gravado hoje; null se não há, é de outro dia ou está corrompido. */
  function lerDoDia() {
    let dados;
    try {
      const cru = window.localStorage.getItem(CONFIG.CHAVE_DIA);
      if (!cru) return null;
      dados = JSON.parse(cru);
    } catch { return null; }
    if (!dados || dados.dia !== hojeIso() || !Array.isArray(dados.clientes)) return null;
    if (dados.regra !== CONFIG.REGRA_DO_GRUPO) return null; // gravado com outra regra de entrada: não vale, a próxima lista completa o refaz
    return dados;
  }

  /**
   * Grava o grupo SÓ SE ainda não há um de hoje e a lista é COMPLETA (sem filtro; mesma detecção do cache da fila, do Módulo 7). Falha fechada: sem
   * o detector, ou com filtro, não grava (lista parcial gravada como "o dia" é o erro caro). Nunca sobrescreve no dia: o total fica fixo.
   * @returns {boolean} true se gravou agora.
   */
  function registrarDoDia() {
    if (cnpjDaPagina()) return false; // página de cliente: a lista é a outra tela
    if (lerDoDia()) return false;
    const detectar = window.filaPrioridadeDebug?.filtrosAtivosNaListaAtual;
    if (typeof detectar !== 'function') return false;
    let filtros;
    try { filtros = detectar(); } catch { return false; }
    if (filtros) return false;
    const lida = lerDaLista();
    if (!lida) return false;
    try {
      window.localStorage.setItem(CONFIG.CHAVE_DIA, JSON.stringify({ dia: hojeIso(), regra: CONFIG.REGRA_DO_GRUPO, geradoEm: Date.now(), lidos: lida.lidos, foraPeloMinimo: lida.foraPeloMinimo, clientes: lida.clientes }));
      return true;
    } catch { return false; }
  }

  const estaNoGrupoDoDia = (cnpj) => (lerDoDia()?.clientes ?? []).some((c) => cnpjCompleto(c?.cnpj) === cnpjCompleto(cnpj));

  /* ---------------------------------------------------------------------
   * MODO GRUPO: o Alt+P segue o grupo (por aba; acaba sozinho)
   * --------------------------------------------------------------------- */
  // Troca de página: nos testes o jsdom não navega, então o destino é trocável.
  const ganchos = {
    navegar: (url) => { window.location.href = url; },
  };

  function modoAtivo() {
    try {
      const m = JSON.parse(window.sessionStorage.getItem(CONFIG.CHAVE_MODO) || 'null');
      return Boolean(m) && m.dia === hojeIso();
    } catch { return false; }
  }
  function iniciarModo() {
    try { window.sessionStorage.setItem(CONFIG.CHAVE_MODO, JSON.stringify({ dia: hojeIso(), iniciadoEm: Date.now() })); return true; } catch { return false; }
  }
  function encerrarModo() {
    try { window.sessionStorage.removeItem(CONFIG.CHAVE_MODO); } catch { /* sem armazenamento: nada a apagar */ }
  }

  /**
   * O próximo cliente do grupo para quem está em `cnpjAtual`: o primeiro DEPOIS dele (ordem da lista) ainda sem "Verificado" e com endereço; sem nenhum depois,
   * o primeiro antes dele. `estado`: "ok" (com `alvo` e `restantes`), "fora" (o atual não é do grupo), "todos-verificados" ou "sem-outro" (há pendente, mas só o atual
   * ou sem endereço).
   */
  function proximoDoGrupo(cnpjAtual) {
    const grupo = lerDoDia()?.clientes ?? [];
    const atual = cnpjCompleto(cnpjAtual);
    const i = grupo.findIndex((c) => cnpjCompleto(c?.cnpj) === atual);
    if (i === -1) return { estado: 'fora' };
    const pendente = (c) => Boolean(c) && Boolean(c.url) && cnpjCompleto(c.cnpj) !== atual && !clienteVerificado(c.cnpj);
    const alvo = grupo.slice(i + 1).find(pendente) || grupo.slice(0, i).find(pendente) || null;
    if (alvo) return { estado: 'ok', alvo, restantes: grupo.filter(pendente).length };
    return { estado: grupo.every((c) => clienteVerificado(c?.cnpj)) ? 'todos-verificados' : 'sem-outro' };
  }

  /**
   * Chamado pelo Alt+P (Módulo 4) ANTES da fila: em modo grupo, vai ao próximo cliente do grupo sem "Verificado".
   * @returns {boolean} true se tratou o Alt+P (o Módulo 4 não segue a fila); false se não está em modo grupo ou saiu do grupo (o modo é desligado).
   */
  function irParaProximoDoGrupo() {
    if (!modoAtivo()) return false;
    const r = proximoDoGrupo(cnpjDaPagina());
    if (r.estado === 'fora') { encerrarModo(); return false; }
    if (r.estado === 'ok') {
      window.__smartTableUtil?.toast?.(`Aviso de suspensão: próximo cliente (restam ${r.restantes} sem verificação).`);
      setTimeout(() => ganchos.navegar(r.alvo.url), CONFIG.ESPERA_NAVEGAR_MS);
      return true;
    }
    encerrarModo();
    window.__smartTableUtil?.toast?.(r.estado === 'todos-verificados'
      ? 'Aviso de suspensão: todos os clientes do grupo já foram verificados.'
      : 'Aviso de suspensão: não há outro cliente sem verificação no grupo.');
    return true;
  }

  /* ---------------------------------------------------------------------
   * MARCAS "VERIFICADO" (CNPJ completo -> data)
   * --------------------------------------------------------------------- */
  function lerMarcas() {
    try {
      const bruto = JSON.parse(window.localStorage.getItem(CONFIG.CHAVE_MARCAS) || '{}');
      return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    } catch { return {}; }
  }
  const clienteVerificado = (cnpj) => Boolean(lerMarcas()[cnpjCompleto(cnpj)]);

  /** Marca o cliente como verificado. @returns {boolean} false se não deu para guardar (a marca NÃO vale). */
  function marcar(cnpj, hoje) {
    const chave = cnpjCompleto(cnpj);
    if (!chave) return false;
    const marcas = lerMarcas();
    marcas[chave] = { verificadoEm: window.__smartTableUtil?.dataIso?.(window.__smartTableUtil?.normalizarData?.(hoje ?? new Date()) ?? new Date()) ?? '' };
    try { window.localStorage.setItem(CONFIG.CHAVE_MARCAS, JSON.stringify(marcas)); return true; } catch { return false; }
  }

  /**
   * Apaga a marca de quem, na lista aberta, JÁ NÃO tem o "!" (linha achada, com o campo do CRM, falso): se o "!" voltar, o cliente volta a pedir
   * verificação. Cliente que não está na lista aberta (filtro, outra carteira) mantém a marca: não dá para saber. @returns {number} marcas apagadas.
   */
  function podarMarcas() {
    const lista = window.CLIENTES;
    if (!Array.isArray(lista) || !lista.some(temCampo)) return 0;
    const marcas = lerMarcas();
    let apagadas = 0;
    Object.keys(marcas).forEach((chave) => {
      const linha = lista.find((c) => c && cnpjCompleto(c.cnpj) === chave);
      if (linha && temCampo(linha) && !linha[CONFIG.CAMPO_DO_CRM]) { delete marcas[chave]; apagadas += 1; }
    });
    if (apagadas === 0) return 0;
    try { window.localStorage.setItem(CONFIG.CHAVE_MARCAS, JSON.stringify(marcas)); } catch { return 0; }
    return apagadas;
  }

  /* ---------------------------------------------------------------------
   * CARTÃO NA PÁGINA DO CLIENTE
   * --------------------------------------------------------------------- */
  /** Elemento com `classe` (as nativas, de CLASSES), texto (textContent) e filhos. */
  function no(tag, classe, texto, filhos) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    (filhos || []).forEach((f) => { if (f) e.appendChild(f); });
    return e;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CAMINHO_AVISO = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
  function icone(classe) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', CAMINHO_AVISO);
    svg.appendChild(path);
    return svg;
  }

  let avisoEl = null;
  let observador = null;

  /**
   * Fica ACIMA do aviso do "Verificar no banco" quando os dois aparecem (o do 44 mantém o canto): `bottom` = altura dele + o espaço. A altura máxima é o
   * espaço que sobra entre esse ponto e o cabeçalho fixo do CRM (o corpo do cartão rola; o rodapé com os botões fica à vista): sem isso, os dois cartões
   * empilhados numa tela baixa invadiam o cabeçalho. Refeito quando o outro aviso entra, sai ou é redesenhado (observa a lista de filhos do body) e
   * quando a janela muda de tamanho.
   */
  function posicionar() {
    if (!avisoEl) return;
    const outro = document.getElementById(CONFIG.ID_AVISO_VERIFICAR_BANCO);
    const baixo = CONFIG.BORDA_PX + (outro ? outro.offsetHeight + CONFIG.ESPACO_ENTRE_AVISOS_PX : 0);
    avisoEl.style.bottom = outro ? `${baixo}px` : '';
    const cabecalho = window.__smartTableUtil?.alturaCabecalho?.() ?? 0;
    const livre = Math.floor(window.innerHeight - baixo - cabecalho - CONFIG.FOLGA_TOPO_PX);
    avisoEl.style.maxHeight = `${Math.max(livre, CONFIG.ALTURA_MINIMA_PX)}px`;
  }

  function fecharAviso() {
    window.removeEventListener('resize', posicionar);
    observador?.disconnect();
    observador = null;
    avisoEl?.remove();
    avisoEl = null;
  }

  function aoVerificar() {
    if (!marcar(cnpjDaPagina())) {
      if (!avisoEl.querySelector('[data-erro]')) {
        const erro = no('p', CLASSES.erro, 'Não consegui guardar a verificação neste navegador. O cliente continua pendente.');
        erro.dataset.erro = 'guardar';
        avisoEl.querySelector('[data-corpo]').appendChild(erro);
      }
      return;
    }
    fecharAviso();
  }

  function renderAviso() {
    if (avisoEl) return;
    avisoEl = no('div', CLASSES.avisoCartao);
    avisoEl.id = CONFIG.ID_AVISO;
    avisoEl.setAttribute('role', 'region');
    avisoEl.setAttribute('aria-label', 'Aviso de suspensão');
    Object.assign(avisoEl.style, { zIndex: CONFIG.Z_INDEX_POPUP, width: 'min(400px, calc(100vw - 2.5rem))' });

    const topo = no('div', CLASSES.topo, null, [no('div', CLASSES.topoEsquerda, null, [no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone)]), no('h3', CLASSES.titulo, 'Aviso de suspensão')])]);
    const corpo = no('div', CLASSES.corpo, null, [
      no('p', CLASSES.texto, 'Este cliente está com o "!" na lista: tem título protestado com saldo ou vencido há mais de 20 dias e, pela regra, deveria estar com crédito Suspenso (2) e cobrança Devedor Tex (4). Verifique o motivo.'),
      no('div', CLASSES.nota, null, [no('p', CLASSES.notaTexto, 'Some até o "!" ser retirado e voltar.')]),
    ]);
    corpo.dataset.corpo = '1';
    const depois = no('button', CLASSES.botaoSecundario, 'Lembrar depois');
    depois.type = 'button';
    depois.dataset.acao = 'lembrar-depois';
    depois.addEventListener('click', fecharAviso);
    const verificado = no('button', CLASSES.botaoPrimario, 'Verificado');
    verificado.type = 'button';
    verificado.dataset.acao = 'verificado';
    verificado.addEventListener('click', aoVerificar);
    const rodape = no('div', CLASSES.rodape, null, [no('span'), no('div', CLASSES.rodapeDireita, null, [depois, verificado])]);
    avisoEl.append(topo, corpo, rodape);
    document.body.appendChild(avisoEl);

    posicionar();
    window.addEventListener('resize', posicionar);
    if (typeof window.MutationObserver === 'function') {
      observador = new window.MutationObserver(posicionar);
      observador.observe(document.body, { childList: true });
    }
  }

  /* ---------------------------------------------------------------------
   * CARGA
   * --------------------------------------------------------------------- */
  function iniciar() {
    if (cnpjDaPagina()) {
      // Página do cliente: só o cartão, e só para quem estava no grupo do dia e ainda não foi marcado.
      if (document.getElementById(CONFIG.ID_AVISO)) return; // idempotente
      if (estaNoGrupoDoDia(cnpjDaPagina()) && !clienteVerificado(cnpjDaPagina())) renderAviso();
      return;
    }
    // Lista: apaga a marca de quem perdeu o "!" e grava o grupo do dia. O detector de filtro depende do usuário logado já desenhado: tenta de novo
    // uma vez, um pouco depois, se a primeira tentativa não gravou (idempotente).
    podarMarcas();
    if (!registrarDoDia() && !lerDoDia() && Array.isArray(window.CLIENTES)) setTimeout(registrarDoDia, CONFIG.REPETIR_REGISTRO_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  window.__avisoSuspender = {
    CONFIG,
    CLASSES,
    lerDaLista,
    lerDoDia,
    registrarDoDia,
    estaNoGrupoDoDia,
    clienteVerificado,
    marcar,
    podarMarcas,
    ehCartorio,
    modoAtivo,
    iniciarModo,
    encerrarModo,
    proximoDoGrupo,
    irParaProximoDoGrupo,
    ganchos,
    renderAviso,
    fecharAviso,
    avisoAberto: () => avisoEl !== null,
  };
})();
