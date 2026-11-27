/* =========================================================================
 * MÓDULO 47: DESEMPENHO (GRAVADOR DE NÚMEROS) — CRM TexCotton
 * -------------------------------------------------------------------------
 * ORIGEM (27/11/2026): uma usuária, em outro computador e com outro login do CRM, tem períodos de espera longos ao entrar numa tela, "do nada", depois de
 * 30 min a 2 h de uso; regerar a fila (Shift+Alt+U) ou reinstalar resolve por um tempo. Medido no PC dela (docs/pendencias.md): com o SmartTable
 * desligado, ou em janela anônima, fica rápido; ligado, fica lento. Na amostra lenta, quatro pedidos do próprio CRM esperaram ~2,4 s DENTRO do navegador
 * (fila antes de o pedido sair; o servidor respondeu em 6 a 14 ms) e o JavaScript custou pouco. A causa não foi achada, e o PC dela nem sempre está à mão.
 * Este módulo deixa o SmartTable guardar sozinho, a cada página, a evidência do momento lento.
 *
 * O QUE FAZ: ~3 s depois do carregamento da página (ou ao sair dela, se for antes), grava UM registro de números: tempos da navegação (espera do
 * servidor, primeira pintura, DOMContentLoaded, load), a FILA dos pedidos do CRM (o `requestStart - startTime` do Resource Timing, que é a espera dentro do
 * navegador) com os três piores, os quadros longos com o tempo por origem do script (CRM, sem arquivo, outro), o tamanho do armazenamento, a hora em que
 * ESTE módulo foi entregue à página (`script_iniciou_ms`, se o Tampermonkey demora a injetar) e a memória. Guarda os últimos 30 registros em
 * `localStorage` (`smarttable_desempenho_v1`, só neste navegador).
 *
 * COMO LER (console de qualquer página do CRM; o resultado vai para a área de transferência, só números):
 *   copy(JSON.stringify(__desempenho.ler(), null, 1))
 * `lenta: true` marca o registro com fila de pedido acima de 1 s, primeira pintura acima de 3 s ou quadro longo acima de 500 ms.
 *
 * PRIVACIDADE (regra 2, literal): só números, formatos e caminhos CENSURADOS. Do endereço de um recurso vão no máximo três segmentos, e só segmento em
 * minúsculas (`^[a-z][a-z0-9_-]*$`) é mantido; o resto vira "#" (CNPJ, nome em maiúsculas, número). Nunca a query. Recurso de outra origem vira "externa".
 * Nada de nome, razão social, CNPJ, telefone, e-mail, valor ou token. Não envia nada para fora: não faz requisição e não usa a área de transferência.
 *
 * LIMITES CONHECIDOS: duas abas gravando no mesmo instante podem perder um registro (lê e regrava a lista); o buffer do Resource Timing do navegador
 * guarda 250 recursos (as páginas do CRM têm ~30); `long-animation-frame` só existe no Chrome 123+ (sem ele os quadros vêm zerados e o resto funciona).
 * Depende só do Módulo 0 (e dele apenas o registro do módulo e a contagem). Expõe window.__desempenho.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__desempenhoCarregado) return;
  window.__desempenhoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Desempenho');

  // Hora em que o Tampermonkey entregou este módulo à página, em ms desde o início da navegação. Antes de qualquer outra coisa deste arquivo.
  const inicioDoModuloMs = (() => {
    try { return window.performance.now(); } catch (_) { return null; }
  })();

  const CONFIG = Object.freeze({
    CHAVE: 'smarttable_desempenho_v1',
    MAXIMO_REGISTROS: 30,
    ESPERA_APOS_CARGA_MS: 3000, // deixa os pedidos que o CRM faz depois do load entrarem no registro
    LIMITE_FILA_LENTA_MS: 1000,
    LIMITE_PINTURA_LENTA_MS: 3000,
    LIMITE_QUADRO_LENTO_MS: 500,
    MAXIMO_PIORES: 3,
    SEGMENTOS_DO_CAMINHO: 3,
  });

  const arredondar = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
  // Marcos acumulados da navegação valem 0 enquanto o evento não aconteceu: 0 é "ainda não", nunca "instantâneo".
  const marco = (n) => (typeof n === 'number' && n > 0 ? Math.round(n) : null);

  /* ---------------------------------------------------------------------
   * 1. CENSURA DO CAMINHO
   * --------------------------------------------------------------------- */
  /**
   * Caminho de um recurso sem nada que identifique alguém: no máximo três segmentos, só os em minúsculas (palavras do próprio CRM); o resto vira "#".
   * Sem query nem fragmento. Outra origem vira "externa".
   */
  function caminhoCensurado(url, origem = window.location.origin) {
    let u;
    try { u = new URL(url, origem); } catch (_) { return '?'; }
    if (u.origin !== origem) return 'externa';
    const segmentos = u.pathname.split('/').filter(Boolean).slice(0, CONFIG.SEGMENTOS_DO_CAMINHO);
    return segmentos.map((s) => (/^[a-z][a-z0-9_-]{0,30}$/.test(s) ? s : '#')).join('/') || '/';
  }

  const mesmaOrigem = (url, origem) => {
    try { return new URL(url, origem).origin === origem; } catch (_) { return false; }
  };

  /* ---------------------------------------------------------------------
   * 2. RESUMOS (funções puras sobre as entradas do Performance API)
   * --------------------------------------------------------------------- */
  function resumirNavegacao(nav, pinturaMs) {
    if (!nav) return null;
    return {
      tipo: typeof nav.type === 'string' ? nav.type : null,
      protocolo: nav.nextHopProtocol || null,
      ate_pedido_ms: arredondar(nav.requestStart),
      espera_servidor_ms: arredondar(nav.responseStart - nav.requestStart),
      download_ms: arredondar(nav.responseEnd - nav.responseStart),
      pintura_ms: marco(pinturaMs),
      dcl_ms: marco(nav.domContentLoadedEventEnd),
      load_ms: marco(nav.loadEventEnd),
    };
  }

  /**
   * A fila do pedido (`requestStart - startTime`) é o tempo que ele esperou DENTRO do navegador antes de sair; `espera_servidor_ms` é a resposta do
   * servidor. Só entra recurso da mesma origem com `requestStart` > 0: do cache ou de outra origem sem Timing-Allow-Origin o navegador devolve 0, e
   * contar esse 0 daria uma fila negativa falsa.
   */
  function resumirRede(recursos, origem = window.location.origin) {
    const lista = Array.isArray(recursos) ? recursos : [];
    const medidos = [];
    let esperaMax = 0;
    for (const r of lista) {
      if (!r || typeof r.name !== 'string' || !mesmaOrigem(r.name, origem) || !(r.requestStart > 0)) continue;
      const espera = r.responseStart - r.requestStart;
      if (Number.isFinite(espera)) esperaMax = Math.max(esperaMax, espera);
      medidos.push({
        tipo: typeof r.initiatorType === 'string' ? r.initiatorType : null,
        onde: caminhoCensurado(r.name, origem),
        inicio_ms: arredondar(r.startTime),
        fila_ms: arredondar(r.requestStart - r.startTime),
        espera_servidor_ms: arredondar(espera),
        duracao_ms: arredondar(r.duration),
      });
    }
    medidos.sort((a, b) => (b.fila_ms ?? 0) - (a.fila_ms ?? 0));
    return {
      total: lista.length,
      medidos: medidos.length,
      fila_max_ms: medidos.length ? (medidos[0].fila_ms ?? 0) : 0,
      fila_lentos: medidos.filter((m) => (m.fila_ms ?? 0) > CONFIG.LIMITE_FILA_LENTA_MS).length,
      espera_servidor_max_ms: arredondar(esperaMax) ?? 0,
      piores: medidos.slice(0, CONFIG.MAXIMO_PIORES),
    };
  }

  /** Quadros longos (`long-animation-frame`), com o tempo de script somado por origem: CRM, "sem arquivo" (código injetado) e outro. */
  function resumirQuadros(quadros, origem = window.location.origin) {
    const lista = Array.isArray(quadros) ? quadros : [];
    const soma = { quadros_longos: lista.length, bloqueio_total_ms: 0, maior_ms: 0, script_do_crm_ms: 0, script_sem_arquivo_ms: 0, script_outro_ms: 0 };
    for (const q of lista) {
      if (!q) continue;
      soma.bloqueio_total_ms += Number(q.blockingDuration) || 0;
      soma.maior_ms = Math.max(soma.maior_ms, Number(q.duration) || 0);
      for (const s of Array.isArray(q.scripts) ? q.scripts : []) {
        const duracao = Number(s && s.duration) || 0;
        if (!s || !s.sourceURL) soma.script_sem_arquivo_ms += duracao;
        else if (mesmaOrigem(s.sourceURL, origem)) soma.script_do_crm_ms += duracao;
        else soma.script_outro_ms += duracao;
      }
    }
    Object.keys(soma).forEach((k) => { soma[k] = Math.round(soma[k]); });
    return soma;
  }

  /** Tamanho do armazenamento: total do site e a parte do SmartTable (chaves `smarttable_*`), com o nome da maior sem os números. Nunca o conteúdo. */
  function resumirArmazenamento(armazem) {
    try {
      let total = 0;
      let nosso = 0;
      let maior = null;
      for (let i = 0; i < armazem.length; i += 1) {
        const chave = armazem.key(i);
        const bytes = (chave.length + (armazem.getItem(chave) || '').length) * 2;
        total += bytes;
        if (chave.startsWith('smarttable_')) {
          nosso += bytes;
          if (!maior || bytes > maior.bytes) maior = { chave: chave.replace(/\d+/g, '#'), bytes };
        }
      }
      return {
        chaves: armazem.length,
        total_kb: Math.round(total / 1024),
        smarttable_kb: Math.round(nosso / 1024),
        maior_smarttable: maior ? { chave: maior.chave, kb: Math.round(maior.bytes / 1024) } : null,
      };
    } catch (_) {
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * 3. COLETA
   * --------------------------------------------------------------------- */
  /** As entradas do navegador, num objeto simples (os testes passam um igual, inventado). */
  function lerFonteDoNavegador() {
    const p = window.performance;
    const entradas = (tipo) => {
      try { return p.getEntriesByType(tipo); } catch (_) { return []; }
    };
    const pintura = entradas('paint').find((e) => e.name === 'first-contentful-paint');
    const conexao = window.navigator && window.navigator.connection;
    return {
      navegacao: entradas('navigation')[0] ?? null,
      pinturaMs: pintura ? pintura.startTime : null,
      recursos: entradas('resource'),
      quadros: entradas('long-animation-frame'),
      agoraMs: p.now(),
      memoriaMb: p.memory ? p.memory.usedJSHeapSize / 1048576 : null,
      rttMs: conexao ? conexao.rtt : null,
      tipoRede: conexao ? conexao.effectiveType : null,
    };
  }

  function coletarAgora(fonte = lerFonteDoNavegador(), { parcial = false } = {}) {
    const origem = window.location.origin;
    const navegacao = resumirNavegacao(fonte.navegacao, fonte.pinturaMs);
    const rede = resumirRede(fonte.recursos, origem);
    const quadros = resumirQuadros(fonte.quadros, origem);
    const lenta = rede.fila_max_ms > CONFIG.LIMITE_FILA_LENTA_MS
      || (navegacao?.pintura_ms ?? 0) > CONFIG.LIMITE_PINTURA_LENTA_MS
      || quadros.maior_ms > CONFIG.LIMITE_QUADRO_LENTO_MS;
    return {
      quando: new Date().toISOString().slice(0, 19),
      tela: caminhoCensurado(window.location.href, origem),
      parametros_na_url: Array.from(new URLSearchParams(window.location.search).keys()).length,
      parcial,
      lenta,
      script_iniciou_ms: arredondar(inicioDoModuloMs),
      registrado_ms: arredondar(fonte.agoraMs),
      aba_oculta: Boolean(window.document.hidden),
      navegacao,
      rede,
      quadros,
      armazenamento: resumirArmazenamento(window.localStorage),
      memoria_js_mb: arredondar(fonte.memoriaMb),
      rtt_ms: arredondar(fonte.rttMs),
      rede_do_pc: fonte.tipoRede ?? null,
      modulos: window.__smartTableUtil?.modulosCarregados?.().length ?? null,
      nucleos: (window.navigator && window.navigator.hardwareConcurrency) ?? null,
    };
  }

  /* ---------------------------------------------------------------------
   * 4. GRAVAÇÃO (nunca lança: o gravador não pode atrapalhar a cobrança)
   * --------------------------------------------------------------------- */
  function ler() {
    try {
      const lista = JSON.parse(window.localStorage.getItem(CONFIG.CHAVE) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (_) {
      return [];
    }
  }

  function limpar() {
    try { window.localStorage.removeItem(CONFIG.CHAVE); } catch (_) { /* sem armazenamento: nada a limpar */ }
  }

  /** Coleta e grava um registro, mantendo só os últimos MAXIMO_REGISTROS. Devolve o registro, ou null se falhou. */
  function registrar({ fonte, parcial = false } = {}) {
    try {
      const registro = coletarAgora(fonte, { parcial });
      const lista = ler();
      lista.push(registro);
      window.localStorage.setItem(CONFIG.CHAVE, JSON.stringify(lista.slice(-CONFIG.MAXIMO_REGISTROS)));
      return registro;
    } catch (_) {
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * 5. QUANDO GRAVAR: uma vez por página
   * --------------------------------------------------------------------- */
  let jaRegistrou = false;
  function registrarUmaVez(parcial) {
    if (jaRegistrou) return null;
    jaRegistrou = true;
    return registrar({ parcial });
  }

  // Só a página principal: um iframe do mesmo endereço também carrega o userscript e gravaria um registro que não é da tela.
  function ehQuadroPrincipal(janela = window) {
    try { return janela.top === janela.self; } catch (_) { return false; }
  }

  function agendar(esperaMs = CONFIG.ESPERA_APOS_CARGA_MS) {
    if (!ehQuadroPrincipal()) return;
    const depoisDoLoad = () => window.setTimeout(() => registrarUmaVez(false), esperaMs);
    if (window.document.readyState === 'complete') depoisDoLoad();
    else window.addEventListener('load', depoisDoLoad, { once: true });
    // Saiu da página antes do tempo (a lentidão faz isso acontecer): grava o que já existe, marcado como parcial.
    window.addEventListener('pagehide', () => registrarUmaVez(true), { once: true });
  }

  try {
    agendar();
  } catch (_) { /* o gravador nunca derruba o resto do SmartTable */ }

  window.__desempenho = Object.freeze({
    CONFIG,
    ler,
    limpar,
    registrar,
    coletarAgora,
    agendar,
    ehQuadroPrincipal,
    caminhoCensurado,
    resumirNavegacao,
    resumirRede,
    resumirQuadros,
    resumirArmazenamento,
    lerFonteDoNavegador,
  });
})();
