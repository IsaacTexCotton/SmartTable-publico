/* =========================================================================
 * MÓDULO 25: LEMBRETES DE BLOQUEIO (Alt+E) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Avisa o operador, ao entrar no cliente, que ele precisa ser INSERIDO num
 * bloqueio ou LIBERADO dele. O módulo NÃO bloqueia nada: não toca no CRM, no
 * ERP, no Alt+A nem no Alt+S. É só um lembrete.
 *
 * REGRA (pedido do usuário): cluster (Novo ou Carteira) + situação do título
 * (hoje só "em cartório", QUALQUER título) + o nome do bloqueio, digitado uma
 * vez na regra. Exemplo: "todo cliente Novo com título em cartório, ao entrar,
 * me avise para bloquear no bloqueio X". Painel das regras: Alt+E.
 *
 * "EM CARTÓRIO" é a situação que o Módulo 1 já calcula (a do amarelo no
 * relatório, com o caso do Itaú), lida de window.__avisoCobranca.simular() em
 * registros, naoCobrar e foraDoRelatorio. Título em acordo não conta (o Módulo
 * 1 o tira do relatório).
 *
 * ESTADO POR CLIENTE E REGRA (decisão do usuário: o aviso volta se ele sair do
 * bloqueio e cair na regra de novo):
 *   casa a regra            -> pendente "bloquear", até "Já bloqueei"
 *   "Já bloqueei"           -> bloqueado (sem aviso enquanto continuar casando)
 *   deixou de casar         -> pendente "liberar", até "Já liberei"
 *   "Já liberei"            -> estado apagado; se voltar a casar, avisa de novo
 * "Lembrar depois" só fecha o aviso: o lembrete volta na próxima visita. Só
 * avisa AO ENTRAR no cliente (decisão do usuário).
 *
 * CLUSTER: a página do cliente NÃO traz o cluster (diagnóstico censurado do
 * usuário, 02/10/2026: nenhuma variável, script, elemento ou atributo). Ele só
 * existe na LISTA de clientes (window.CLIENTES.cluster), então a lista, ao
 * abrir, alimenta um cache local por hash do CNPJ (o mesmo da Carteira, sem
 * nome nem CNPJ). Cluster desconhecido ou com mais de DIAS_CLUSTER_VALIDO dias
 * NUNCA falha calado: se a situação casa, o aviso diz que não conseguiu conferir.
 *
 * ARMAZENAMENTO (só neste navegador, nada compartilhado com a Bianca):
 *   smarttable_lembretes_bloqueio_regras_v1   regras
 *   smarttable_lembretes_bloqueio_estados_v1  estado por regra e hash do cliente
 *   smarttable_lembretes_bloqueio_clusters_v1 cluster por hash do cliente
 *
 * ONDE COLAR: depois dos Módulos 0, 1, 12 e 22 (usa o hash do 22 e o
 * simular() do 1) e ANTES do Módulo 4 (que liga o Alt+E).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__lembretesBloqueioCarregado) return;
  window.__lembretesBloqueioCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Lembretes de Bloqueio');

  const CONFIG_LEMBRETES = {
    CHAVE_REGRAS: 'smarttable_lembretes_bloqueio_regras_v1',
    CHAVE_ESTADOS: 'smarttable_lembretes_bloqueio_estados_v1',
    CHAVE_CLUSTERS: 'smarttable_lembretes_bloqueio_clusters_v1',
    ID_PAINEL: 'smarttable-painel-lembretes-bloqueio',
    ID_AVISO: 'smarttable-aviso-lembretes-bloqueio',
    // Aviso e painel são popups: sobem por cima do menu dos atalhos do CRM (Módulo 0).
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
    // A lista é aberta todo dia; uma semana cobre fim de semana e feriado.
    DIAS_CLUSTER_VALIDO: 7,
    DIAS_GUARDAR_CLUSTER: 90,
    MAX_REGRAS: 20,
    MAX_NOME_BLOQUEIO: 60,
    // A tabela de títulos é montada por outro script, depois deste (ver Módulo 1).
    TIMEOUT_TABELA_MS: 20000,
    INTERVALO_TABELA_MS: 500,
    MS_CONFIRMAR_EXCLUSAO: 4000,
  };

  // A chave é o que se compara; o rótulo e a frase são o que o operador lê.
  const CLUSTERS = [
    { chave: 'novo', rotulo: 'Novo' },
    { chave: 'carteira', rotulo: 'Carteira' },
  ];
  const SITUACOES = [
    { chave: 'EM_CARTORIO', rotulo: 'Em cartório', frase: 'com título em cartório' },
  ];

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    fundo: '#ffffff',
    alerta: '#B45309',
    perigo: '#B42318',
    ok: '#067647',
  };

  const util = () => window.__smartTableUtil;
  const rotuloDoCluster = (chave) => CLUSTERS.find((c) => c.chave === chave)?.rotulo ?? chave;
  const situacaoDe = (chave) => SITUACOES.find((s) => s.chave === chave);

  let painelEl = null;
  let avisoEl = null;
  let iniciou = false;
  let contadorDeIds = 0;
  let avisouSemHash = false;

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(location.search).get('cnpj') || '';
    } catch {
      return '';
    }
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO
   * --------------------------------------------------------------------- */

  function lerObjeto(chave) {
    try {
      const raw = localStorage.getItem(chave);
      const dados = raw ? JSON.parse(raw) : null;
      return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    } catch {
      return {};
    }
  }

  /** @returns {boolean} false quando o localStorage recusou a gravação. */
  function gravar(chave, dados) {
    try {
      localStorage.setItem(chave, JSON.stringify(dados));
      return true;
    } catch (erro) {
      console.warn('[Lembretes de bloqueio] Não consegui gravar no localStorage.', erro?.name);
      return false;
    }
  }

  const objetoSimples = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  /** Hash do CNPJ (53 bits, o da Carteira). Sem o Módulo 22 não há como guardar nada: null. */
  function chaveDoCliente(cnpj) {
    const h = window.__carteiraDados?.hashCnpj?.(cnpj);
    if (Number.isFinite(h)) return String(h);
    if (!avisouSemHash) {
      avisouSemHash = true;
      console.warn('[Lembretes de bloqueio] O Módulo 22 (hash do CNPJ) não carregou -- os lembretes ficam desligados.');
    }
    return null;
  }

  const hojeIso = (hoje) => util().dataIso(util().normalizarData(hoje ?? new Date()));

  function diasEntreIso(de, ate) {
    return Math.round((Date.parse(`${ate}T12:00:00`) - Date.parse(`${de}T12:00:00`)) / 86400000);
  }

  /* ---------------------------------------------------------------------
   * REGRAS
   * --------------------------------------------------------------------- */

  function regraValida(r) {
    return !!r && typeof r === 'object'
      && typeof r.id === 'string' && r.id !== ''
      && CLUSTERS.some((c) => c.chave === r.cluster)
      && !!situacaoDe(r.situacao)
      && typeof r.bloqueio === 'string';
  }

  /** Só regra ligada E com o nome do bloqueio preenchido avisa (sem nome o aviso não diria nada). */
  const regraPronta = (r) => regraValida(r) && r.ativa === true && r.bloqueio.trim() !== '';

  /** @returns {{id: string, cluster: string, situacao: string, bloqueio: string, ativa: boolean}[]} */
  function obterRegras() {
    const lista = lerObjeto(CONFIG_LEMBRETES.CHAVE_REGRAS).regras;
    if (!Array.isArray(lista)) return [];
    return lista.filter(regraValida).map((r) => ({
      id: r.id, cluster: r.cluster, situacao: r.situacao, bloqueio: r.bloqueio, ativa: r.ativa === true,
    }));
  }

  /** @returns {boolean} false se não gravou. */
  function salvarRegras(regras) {
    const limpas = (Array.isArray(regras) ? regras : []).filter(regraValida).slice(0, CONFIG_LEMBRETES.MAX_REGRAS).map((r) => ({
      id: r.id,
      cluster: r.cluster,
      situacao: r.situacao,
      bloqueio: r.bloqueio.slice(0, CONFIG_LEMBRETES.MAX_NOME_BLOQUEIO),
      ativa: r.ativa === true,
    }));
    return gravar(CONFIG_LEMBRETES.CHAVE_REGRAS, { versao: 1, regras: limpas });
  }

  function criarRegra(campos = {}) {
    contadorDeIds += 1;
    return {
      id: `r${Date.now().toString(36)}${contadorDeIds.toString(36)}`,
      cluster: campos.cluster ?? CLUSTERS[0].chave,
      situacao: campos.situacao ?? SITUACOES[0].chave,
      bloqueio: campos.bloqueio ?? '',
      ativa: campos.ativa ?? true,
    };
  }

  /* ---------------------------------------------------------------------
   * ESTADO POR REGRA E CLIENTE
   * --------------------------------------------------------------------- */

  const ESTADOS_VALIDOS = ['bloquear', 'bloqueado', 'liberar'];

  function lerEstados() {
    const todos = objetoSimples(lerObjeto(CONFIG_LEMBRETES.CHAVE_ESTADOS).estados);
    const limpo = {};
    Object.keys(todos).forEach((regraId) => {
      const doCliente = objetoSimples(todos[regraId]);
      const validos = {};
      Object.keys(doCliente).forEach((chave) => {
        if (ESTADOS_VALIDOS.includes(doCliente[chave]?.e)) validos[chave] = doCliente[chave];
      });
      if (Object.keys(validos).length > 0) limpo[regraId] = validos;
    });
    return limpo;
  }

  const salvarEstados = (estados) => gravar(CONFIG_LEMBRETES.CHAVE_ESTADOS, { versao: 1, estados });

  /** @returns {'bloquear'|'bloqueado'|'liberar'|null} */
  function estadoDoCliente(regraId, cnpj) {
    const chave = chaveDoCliente(cnpj);
    return chave ? (lerEstados()[regraId]?.[chave]?.e ?? null) : null;
  }

  /** estado null apaga. @returns {boolean} false se não gravou. */
  function definirEstado(regraId, cnpj, estado, hoje) {
    const chave = chaveDoCliente(cnpj);
    if (!chave) return false;
    const estados = lerEstados();
    const doCliente = { ...(estados[regraId] || {}) };
    if (estado) doCliente[chave] = { e: estado, d: hojeIso(hoje) };
    else delete doCliente[chave];
    if (Object.keys(doCliente).length > 0) estados[regraId] = doCliente;
    else delete estados[regraId];
    return salvarEstados(estados);
  }

  /** O operador diz que inseriu o cliente no bloqueio. */
  const confirmarBloqueio = (regraId, cnpj, hoje) => definirEstado(regraId, cnpj, 'bloqueado', hoje);
  /** O operador diz que liberou o cliente do bloqueio: zera o estado. */
  const confirmarLiberacao = (regraId, cnpj) => definirEstado(regraId, cnpj, null);

  /* ---------------------------------------------------------------------
   * CLUSTER (alimentado pela lista de clientes)
   * --------------------------------------------------------------------- */

  /**
   * Guarda o cluster de cada cliente da lista (window.CLIENTES). Só acrescenta
   * ou atualiza: uma lista filtrada não apaga quem ficou de fora do filtro.
   * @param {object[]} lista
   * @param {Date} [hoje]
   * @returns {number} quantos clientes foram guardados
   */
  function registrarClustersDaLista(lista, hoje) {
    if (!Array.isArray(lista)) return 0;
    const dia = hojeIso(hoje);
    const clientes = { ...objetoSimples(lerObjeto(CONFIG_LEMBRETES.CHAVE_CLUSTERS).clientes) };
    let guardados = 0;
    lista.forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const cluster = String(c.cluster ?? '').trim().toLowerCase();
      const chave = cluster ? chaveDoCliente(c.cnpj) : null;
      if (!chave) return;
      clientes[chave] = { c: cluster, v: dia };
      guardados += 1;
    });
    let podou = false;
    Object.keys(clientes).forEach((chave) => {
      const visto = clientes[chave]?.v;
      if (typeof visto !== 'string' || diasEntreIso(visto, dia) > CONFIG_LEMBRETES.DIAS_GUARDAR_CLUSTER) {
        delete clientes[chave];
        podou = true;
      }
    });
    if (guardados > 0 || podou) gravar(CONFIG_LEMBRETES.CHAVE_CLUSTERS, { versao: 1, clientes });
    return guardados;
  }

  /**
   * @returns {{cluster: string|null, idadeDias: number|null, desatualizado: boolean}}
   *   cluster null = este cliente nunca apareceu na lista deste navegador.
   */
  function clusterDoCliente(cnpj, hoje) {
    const chave = chaveDoCliente(cnpj);
    const reg = chave ? objetoSimples(lerObjeto(CONFIG_LEMBRETES.CHAVE_CLUSTERS).clientes)[chave] : null;
    if (!reg || typeof reg.c !== 'string' || typeof reg.v !== 'string') return { cluster: null, idadeDias: null, desatualizado: false };
    const idadeDias = diasEntreIso(reg.v, hojeIso(hoje));
    return { cluster: reg.c, idadeDias, desatualizado: idadeDias > CONFIG_LEMBRETES.DIAS_CLUSTER_VALIDO };
  }

  /** Para o painel: quantos clientes têm cluster guardado e a data mais recente. */
  function resumoDoCache() {
    const clientes = objetoSimples(lerObjeto(CONFIG_LEMBRETES.CHAVE_CLUSTERS).clientes);
    const datas = Object.values(clientes).map((r) => r?.v).filter((v) => typeof v === 'string').sort();
    return { clientes: datas.length, maisRecente: datas.length > 0 ? datas[datas.length - 1] : null };
  }

  /* ---------------------------------------------------------------------
   * SITUAÇÃO DOS TÍTULOS (a que o Módulo 1 já calcula)
   * --------------------------------------------------------------------- */

  /** @returns {Set<string>|null} situações presentes nesta página; null se não deu para ler. */
  function situacoesDaPagina() {
    try {
      const dados = window.__avisoCobranca?.simular?.();
      if (!dados) return null;
      const presentes = new Set();
      [...(dados.registros || []), ...(dados.naoCobrar || []), ...(dados.foraDoRelatorio || [])].forEach((r) => {
        if (r?.situacaoKey) presentes.add(r.situacaoKey);
      });
      return presentes;
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * AVALIAÇÃO
   * --------------------------------------------------------------------- */

  /**
   * Aplica as regras ligadas a UM cliente e devolve o que precisa de aviso.
   * Grava as mudanças de estado.
   *
   * @param {{cnpj: string, situacoes: Set<string>, hoje?: Date}} entrada
   * @returns {{tipo: 'bloquear'|'liberar'|'incerto', regraId: string, bloqueio: string, cluster: string,
   *   situacao: string, motivo?: 'sem-cluster'|'desatualizado', idadeDias?: number|null}[]}
   */
  function avaliarCliente({ cnpj, situacoes, hoje } = {}) {
    const chave = chaveDoCliente(cnpj);
    const regras = obterRegras().filter(regraPronta);
    if (!chave || regras.length === 0 || !(situacoes instanceof Set)) return [];

    const estados = lerEstados();
    const info = clusterDoCliente(cnpj, hoje);
    const pendencias = [];
    let mudou = false;

    const marcar = (regraId, estado) => {
      estados[regraId] = { ...(estados[regraId] || {}) };
      if (estado) estados[regraId][chave] = { e: estado, d: hojeIso(hoje) };
      else delete estados[regraId][chave];
      if (Object.keys(estados[regraId]).length === 0) delete estados[regraId];
      mudou = true;
    };

    regras.forEach((regra) => {
      const base = { regraId: regra.id, bloqueio: regra.bloqueio.trim(), cluster: regra.cluster, situacao: regra.situacao };
      const atual = estados[regra.id]?.[chave]?.e ?? null;
      const naSituacao = situacoes.has(regra.situacao);

      // O cluster só importa quando a situação casa. Sem ele (nunca visto na
      // lista, ou velho demais) o aviso diz que não conseguiu conferir: nunca falha calado.
      if (naSituacao && (!info.cluster || info.desatualizado)) {
        pendencias.push({ ...base, tipo: 'incerto', motivo: info.cluster ? 'desatualizado' : 'sem-cluster', idadeDias: info.idadeDias });
        return;
      }

      const casa = naSituacao && info.cluster === regra.cluster;
      if (casa) {
        if (atual === 'bloqueado') return;
        // Sem estado, ou voltou a casar sem ter liberado: pede o bloqueio (na dúvida, avisa).
        if (atual !== 'bloquear') marcar(regra.id, 'bloquear');
        pendencias.push({ ...base, tipo: 'bloquear' });
        return;
      }

      if (atual === 'bloqueado') {
        marcar(regra.id, 'liberar');
        pendencias.push({ ...base, tipo: 'liberar' });
      } else if (atual === 'liberar') {
        pendencias.push({ ...base, tipo: 'liberar' });
      } else if (atual === 'bloquear') {
        // Nunca chegou a ser bloqueado por aqui e já saiu da regra: não há o que liberar.
        marcar(regra.id, null);
      }
    });

    if (mudou) salvarEstados(estados);
    return pendencias;
  }

  /* ---------------------------------------------------------------------
   * DESENHO
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

  function fecharAviso() {
    if (!avisoEl) return;
    avisoEl.remove();
    avisoEl = null;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  /** O que o registro de painéis do Módulo 0 chama: fecha o aviso e o painel. */
  function fecharTudo() {
    fecharAviso();
    fecharPainel();
  }

  function textoDaPendencia(p) {
    const cluster = rotuloDoCluster(p.cluster);
    const frase = situacaoDe(p.situacao)?.frase ?? '';
    if (p.tipo === 'bloquear') {
      return {
        titulo: `🔒 Inserir este cliente no bloqueio "${p.bloqueio}"`,
        linha: `Cliente ${cluster} ${frase}.`,
        cor: CORES.perigo,
      };
    }
    if (p.tipo === 'liberar') {
      return {
        titulo: `🔓 Liberar este cliente do bloqueio "${p.bloqueio}"`,
        linha: `Ele saiu da regra: cliente ${cluster} ${frase}.`,
        cor: CORES.ok,
      };
    }
    const quando = p.motivo === 'desatualizado'
      ? `o cluster dele foi visto na lista há ${p.idadeDias} dias, e isso é velho demais para confiar`
      : 'ele não apareceu na lista de clientes neste navegador, então não sei o cluster dele';
    return {
      titulo: `⚠ Não consegui conferir a regra "${p.bloqueio}"`,
      linha: `Este cliente tem título em cartório, mas ${quando}. Abra a lista de clientes para atualizar e entre nele de novo.`,
      cor: CORES.alerta,
    };
  }

  /** Embaixo do aviso do Alerta (Módulo 12), se ele estiver aberto; senão, no mesmo lugar dele. */
  function posicionarAviso(el) {
    el.style.left = '50%';
    const idAlerta = window.__alertaCliente?.CONFIG_ALERTA?.ID_AVISO;
    const alerta = idAlerta ? document.getElementById(idAlerta) : null;
    const base = alerta?.getBoundingClientRect?.();
    if (base && base.bottom > 0) {
      el.style.top = `${Math.round(base.bottom + 12)}px`;
      el.style.transform = 'translateX(-50%)';
    } else {
      el.style.top = '42%';
      el.style.transform = 'translate(-50%, -50%)';
    }
  }

  /**
   * Um cartão por pendência, dentro do mesmo aviso. Não fecha os outros
   * painéis: o aviso do Alerta pode estar aberto ao mesmo tempo.
   * @param {ReturnType<typeof avaliarCliente>} pendencias
   * @param {string} cnpj
   */
  function mostrarAviso(pendencias, cnpj) {
    fecharAviso();
    if (!pendencias || pendencias.length === 0) return;

    avisoEl = document.createElement('div');
    avisoEl.id = CONFIG_LEMBRETES.ID_AVISO;
    avisoEl.setAttribute('role', 'alertdialog');
    Object.assign(avisoEl.style, {
      position: 'fixed',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '12px 14px',
      boxShadow: '0 10px 34px rgba(0,0,0,0.28)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_LEMBRETES.Z_INDEX_POPUP,
      width: '380px',
      maxWidth: '90vw',
    });

    pendencias.forEach((p) => {
      const { titulo, linha, cor } = textoDaPendencia(p);
      const cartao = criarDiv('', { borderLeft: `5px solid ${cor}`, padding: '4px 0 4px 10px', marginBottom: '10px' });
      cartao.dataset.papel = `lembrete-${p.tipo}`;
      cartao.dataset.regra = p.regraId;
      cartao.appendChild(criarDiv(titulo, { color: cor, fontWeight: '700', marginBottom: '4px' }));
      cartao.appendChild(criarDiv(linha, { color: CORES.texto, lineHeight: '1.5', marginBottom: '8px' }));

      const botoes = criarDiv('', { display: 'flex', gap: '8px' });
      const resolver = () => {
        cartao.remove();
        if (avisoEl && !avisoEl.querySelector('[data-regra]')) fecharAviso();
      };
      if (p.tipo === 'incerto') {
        const entendi = criarBotao('Entendi', 'entendi', true);
        entendi.addEventListener('click', resolver);
        botoes.appendChild(entendi);
      } else {
        const jaFiz = criarBotao(p.tipo === 'bloquear' ? 'Já bloqueei' : 'Já liberei', 'ja-fiz', true);
        jaFiz.addEventListener('click', () => {
          const gravou = p.tipo === 'bloquear' ? confirmarBloqueio(p.regraId, cnpj) : confirmarLiberacao(p.regraId, cnpj);
          // Falha de gravação NÃO apaga o lembrete: o operador acharia que ficou registrado.
          if (!gravou) {
            util()?.toast?.('Não consegui salvar (o navegador recusou a gravação). O lembrete continua.', 8000);
            return;
          }
          resolver();
        });
        const depois = criarBotao('Lembrar depois', 'depois', false);
        depois.addEventListener('click', resolver);
        botoes.appendChild(jaFiz);
        botoes.appendChild(depois);
      }
      cartao.appendChild(botoes);
      avisoEl.appendChild(cartao);
    });

    document.body.appendChild(avisoEl);
    posicionarAviso(avisoEl);
  }

  /* ---------------------------------------------------------------------
   * PAINEL DAS REGRAS (Alt+E)
   * --------------------------------------------------------------------- */

  function criarSelect(opcoes, valor, campo) {
    const s = document.createElement('select');
    s.dataset.campo = campo;
    opcoes.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.chave;
      opt.textContent = o.rotulo;
      s.appendChild(opt);
    });
    s.value = valor;
    Object.assign(s.style, { padding: '4px 6px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', fontSize: '12.5px', background: '#fff' });
    return s;
  }

  function descreverCache() {
    const { clientes, maisRecente } = resumoDoCache();
    if (clientes === 0) return 'Nenhum cluster guardado ainda: abra a lista de clientes.';
    const [, mes, dia] = (maisRecente || '').split('-');
    return `Cluster guardado de ${clientes} cliente(s), atualizado em ${dia}/${mes}.`;
  }

  function abrirPainel() {
    // Só um painel flutuante nosso por vez (ver registrarPainel, Módulo 0).
    util()?.fecharOutrosPaineis?.('lembretesBloqueio');
    fecharAviso();
    fecharPainel();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_LEMBRETES.ID_PAINEL;
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
      zIndex: CONFIG_LEMBRETES.Z_INDEX_POPUP,
      width: '460px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
    });

    painelEl.appendChild(criarDiv('Regras de lembrete', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    painelEl.appendChild(criarDiv('Só avisam ao entrar no cliente. Não bloqueiam nada.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 10px',
    }));

    const lista = criarDiv('');
    lista.dataset.papel = 'lista-regras';
    painelEl.appendChild(lista);

    let regras = obterRegras();
    const persistir = () => {
      if (!salvarRegras(regras)) {
        util()?.toast?.('Não consegui salvar as regras (o navegador recusou a gravação).', 8000);
        return false;
      }
      return true;
    };

    const desenhar = () => {
      lista.textContent = '';
      if (regras.length === 0) {
        lista.appendChild(criarDiv('Nenhuma regra. Crie uma para ser avisado.', { color: CORES.apagado, fontSize: '12px', padding: '6px 0' }));
      }
      regras.forEach((regra) => {
        const cartao = criarDiv('', { border: `1px solid ${CORES.linha}`, borderRadius: '8px', padding: '10px', marginBottom: '8px' });
        cartao.dataset.regra = regra.id;

        const linha1 = criarDiv('', { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' });
        linha1.appendChild(criarDiv('Cluster', { color: CORES.apagado, fontSize: '12px' }));
        const selCluster = criarSelect(CLUSTERS, regra.cluster, 'cluster');
        linha1.appendChild(selCluster);
        linha1.appendChild(criarDiv('Situação', { color: CORES.apagado, fontSize: '12px' }));
        const selSituacao = criarSelect(SITUACOES, regra.situacao, 'situacao');
        linha1.appendChild(selSituacao);
        linha1.appendChild(criarDiv('(qualquer título)', { color: CORES.apagado, fontSize: '11.5px' }));
        cartao.appendChild(linha1);

        const linha2 = criarDiv('', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' });
        linha2.appendChild(criarDiv('Lembrar de BLOQUEAR em:', { color: CORES.texto, fontSize: '12.5px', whiteSpace: 'nowrap' }));
        const nome = document.createElement('input');
        nome.type = 'text';
        nome.dataset.campo = 'bloqueio';
        nome.maxLength = CONFIG_LEMBRETES.MAX_NOME_BLOQUEIO;
        nome.placeholder = 'nome do bloqueio';
        nome.value = regra.bloqueio;
        Object.assign(nome.style, { flex: '1', minWidth: '0', padding: '4px 8px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', fontSize: '12.5px' });
        linha2.appendChild(nome);
        cartao.appendChild(linha2);

        const dica = criarDiv('Digite o nome do bloqueio: sem ele a regra não avisa.', { color: CORES.perigo, fontSize: '11.5px', marginBottom: '6px' });
        dica.dataset.papel = 'dica-sem-nome';
        const atualizarDica = () => { dica.style.display = nome.value.trim() === '' ? 'block' : 'none'; };
        atualizarDica();
        cartao.appendChild(dica);

        const linha3 = criarDiv('', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });
        const rotuloAtiva = document.createElement('label');
        Object.assign(rotuloAtiva.style, { display: 'flex', alignItems: 'center', gap: '6px', color: CORES.texto, cursor: 'pointer' });
        const ativa = document.createElement('input');
        ativa.type = 'checkbox';
        ativa.dataset.campo = 'ativa';
        ativa.checked = regra.ativa;
        rotuloAtiva.appendChild(ativa);
        rotuloAtiva.appendChild(document.createTextNode('ativa'));
        linha3.appendChild(rotuloAtiva);

        // Excluir pede um segundo clique: apagar a regra apaga os lembretes pendentes dela.
        const excluir = criarBotao('Excluir', 'excluir', false);
        let pedidoEm = 0;
        excluir.addEventListener('click', () => {
          if (Date.now() - pedidoEm > CONFIG_LEMBRETES.MS_CONFIRMAR_EXCLUSAO) {
            pedidoEm = Date.now();
            excluir.textContent = 'Confirmar exclusão';
            excluir.style.color = CORES.perigo;
            return;
          }
          regras = regras.filter((r) => r.id !== regra.id);
          if (persistir()) {
            const estados = lerEstados();
            if (estados[regra.id]) {
              delete estados[regra.id];
              salvarEstados(estados);
            }
          }
          desenhar();
        });
        linha3.appendChild(excluir);
        cartao.appendChild(linha3);

        const alterar = (campos) => {
          Object.assign(regra, campos);
          persistir();
        };
        selCluster.addEventListener('change', () => alterar({ cluster: selCluster.value }));
        selSituacao.addEventListener('change', () => alterar({ situacao: selSituacao.value }));
        nome.addEventListener('change', () => { alterar({ bloqueio: nome.value.trim() }); atualizarDica(); });
        // Grava a cada tecla: fechar o painel (Alt+E ou Esc) com o foco no campo não pode perder o nome.
        nome.addEventListener('input', () => { atualizarDica(); alterar({ bloqueio: nome.value.trim() }); });
        ativa.addEventListener('change', () => alterar({ ativa: ativa.checked }));

        lista.appendChild(cartao);
      });
    };
    desenhar();

    const nova = criarBotao('+ Nova regra', 'nova-regra', true);
    nova.style.width = '100%';
    nova.addEventListener('click', () => {
      if (regras.length >= CONFIG_LEMBRETES.MAX_REGRAS) {
        util()?.toast?.(`No máximo ${CONFIG_LEMBRETES.MAX_REGRAS} regras.`);
        return;
      }
      regras.push(criarRegra());
      persistir();
      desenhar();
    });
    painelEl.appendChild(nova);

    painelEl.appendChild(criarDiv(descreverCache(), { marginTop: '10px', color: CORES.apagado, fontSize: '11.5px', lineHeight: '1.4' }));
    painelEl.appendChild(criarDiv('Alt+E ou Esc para fechar', {
      marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    }));

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe.
    util()?.acompanharMenuLateral?.(painelEl);
  }

  /** Abre se estiver fechado, fecha se estiver aberto. É o que o Alt+E chama. */
  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel();
  }

  /* ---------------------------------------------------------------------
   * CARGA DA PÁGINA
   * --------------------------------------------------------------------- */

  /** Espera a tabela de títulos (montada por outro script, depois deste). null no teto. */
  async function aguardarSituacoes() {
    if (typeof window.__avisoCobranca?.simular !== 'function') return null;
    const limite = Date.now() + CONFIG_LEMBRETES.TIMEOUT_TABELA_MS;
    for (;;) {
      const presentes = situacoesDaPagina();
      if (presentes) return presentes;
      if (Date.now() >= limite) return null;
      await util().esperar(CONFIG_LEMBRETES.INTERVALO_TABELA_MS);
    }
  }

  /**
   * Na página de um cliente: avalia as regras e mostra o aviso. Sem regra
   * pronta, não faz nada. Não avalia sem confirmar os acordos (o título em
   * acordo sai da conta): melhor pedir para reabrir do que avisar errado.
   */
  async function avaliarPaginaDoCliente({ hoje } = {}) {
    const cnpj = cnpjDaPagina();
    if (!cnpj || !obterRegras().some(regraPronta)) return [];

    if (window.__negociacoes?.aguardar) {
      const acordosLidos = await window.__negociacoes.aguardar();
      if (acordosLidos === false) {
        util()?.toast?.('Lembretes de bloqueio: ainda estou lendo os acordos deste cliente. Entre nele de novo em instantes.', 8000);
        return [];
      }
    }
    const situacoes = await aguardarSituacoes();
    if (!situacoes) {
      util()?.toast?.('Lembretes de bloqueio: não consegui ler os títulos deste cliente. Entre nele de novo.', 8000);
      return [];
    }
    const pendencias = avaliarCliente({ cnpj, situacoes, hoje });
    mostrarAviso(pendencias, cnpj);
    return pendencias;
  }

  function aoCarregar() {
    // O harness de teste dispara DOMContentLoaded a cada módulo: iniciar uma vez só.
    if (iniciou) return;
    iniciou = true;
    try {
      if (Array.isArray(window.CLIENTES)) registrarClustersDaLista(window.CLIENTES);
    } catch (erro) {
      console.warn('[Lembretes de bloqueio] Não consegui guardar o cluster da lista.', erro?.name);
    }
    if (cnpjDaPagina()) {
      avaliarPaginaDoCliente().catch((erro) => {
        console.warn(`[Lembretes de bloqueio] Falha ao avaliar o cliente ${util()?.apelidoParaLog?.(cnpjDaPagina()) ?? 'cli.????'}.`, erro?.name);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aoCarregar);
  } else {
    aoCarregar();
  }

  // Esc fecha. Registrado uma vez só: um listener por abertura vazaria.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (painelEl) fecharPainel();
    else if (avisoEl) fecharAviso();
  });

  util()?.registrarPainel?.('lembretesBloqueio', fecharTudo);

  window.__lembretesBloqueio = {
    obterRegras,
    salvarRegras,
    criarRegra,
    estadoDoCliente,
    confirmarBloqueio,
    confirmarLiberacao,
    registrarClustersDaLista,
    clusterDoCliente,
    resumoDoCache,
    situacoesDaPagina,
    avaliarCliente,
    avaliarPaginaDoCliente,
    mostrarAviso,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    fecharAviso,
    estaAberto: () => painelEl !== null,
    avisoEstaAberto: () => avisoEl !== null,
    CONFIG_LEMBRETES,
    CLUSTERS,
    SITUACOES,
  };
})();
