/* =========================================================================
 * MÓDULO 13: CONSOLE DE DIAGNÓSTICO (Alt+K) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Uma janela só, com as principais saídas de diagnóstico do sistema, sem
 * precisar abrir o DevTools nem rodar nada no console manualmente.
 *
 * PEDIDO DO USUÁRIO: "tudo que for importante e não atrapalhe a
 * compreensão" -- por isso o painel abre com um resumo enxuto (módulos,
 * fila/progresso de hoje, avisos e erros recentes) e deixa a
 * autoconferência completa (window.__conferir(), Módulo 8 -- mais
 * detalhada, e ela própria escreve no console) atrás de um botão, em vez
 * de rodar sozinha toda vez que o painel abre.
 *
 * DE ONDE VÊM OS DADOS -- nada é recalculado aqui, tudo é lido de módulos
 * que já existem, pelo mesmo motivo de sempre (nunca duplicar regra de
 * negócio, ver Módulo 0):
 *   - Módulos carregados/faltando: window.__smartTableUtil.modulosCarregados()
 *     / .modulosFaltando() (registro central, Módulo 0).
 *   - Fila e progresso de hoje: window.filaDebug (Módulo 3) e
 *     window.__progressoFila.montarProgresso() (Módulo 11) -- a mesma
 *     aritmética que já alimenta o painel de progresso, só reaproveitada.
 *   - Avisos e erros recentes: este módulo envolve console.warn/console.error
 *     a partir do instante em que carrega (ring buffer -- ver
 *     CONFIG_CONSOLE.LIMITE_LOG) e guarda o que passar por eles. Não é
 *     histórico completo da página: só cobre erros/avisos emitidos DEPOIS
 *     deste módulo carregar. Como ele carrega perto do fim do @require,
 *     cobre a imensa maioria dos avisos reais (a maior parte acontece
 *     dentro de handler de clique/atalho, bem depois do carregamento da
 *     página, não durante ele).
 *   - Autoconferência completa: window.__conferir() (Módulo 8), chamada só
 *     quando o operador pede -- ela própria escreve tabelas no console,
 *     então rodar sozinha ao abrir o painel poluiria o log recente com o
 *     próprio diagnóstico do diagnóstico.
 *
 * ONDE COLAR: depois do Módulo 0 (config/registro de painéis), do Módulo 3
 * (window.filaDebug) e do Módulo 11 (window.__progressoFila) -- os três
 * precisam já estar carregados. Não depende do Módulo 4 (atalhos): o atalho
 * Alt+K vive lá, chamando window.__consoleDiagnostico.alternarPainel() do
 * mesmo jeito que os outros painéis (Alt+O, Alt+D) são acionados -- a ordem
 * entre os dois não importa, é checagem em tempo de uso.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__consoleDiagnosticoCarregado) return;
  window.__consoleDiagnosticoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Console de Diagnóstico');

  const CONFIG_CONSOLE = {
    ID_PAINEL: 'smarttable-console-diagnostico',
    // Mesmo z-index dos outros painéis nossos (Módulo 9/10/11/12): ABAIXO
    // dos modais do CRM (z-50).
    Z_INDEX: 30,
    // Quantos avisos/erros recentes ficam guardados -- um ring buffer, não
    // um log ilimitado (isto fica só em memória, nunca em localStorage).
    LIMITE_LOG: 50,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    ok: '#1B6B4A',
    aviso: '#B45309',
    erro: '#B42318',
    fundo: '#ffffff',
  };

  let painelEl = null;

  /* ---------------------------------------------------------------------
   * CAPTURA DE AVISOS/ERROS -- envolve console.warn/console.error a partir
   * de agora, sem nunca deixar de chamar o original (a saída no DevTools
   * continua idêntica; isto só ESPELHA pra um buffer em memória).
   * --------------------------------------------------------------------- */
  const logRecente = [];

  function registrarLog(nivel, args) {
    const mensagem = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch (erro) {
          return String(a);
        }
      })
      .join(' ');
    logRecente.push({ nivel, mensagem, quando: Date.now() });
    if (logRecente.length > CONFIG_CONSOLE.LIMITE_LOG) logRecente.shift();
  }

  function instalarCapturaDeLog() {
    if (window.__smartTableCapturaLogInstalada) return;
    window.__smartTableCapturaLogInstalada = true;

    const warnOriginal = console.warn.bind(console);
    const errorOriginal = console.error.bind(console);

    console.warn = (...args) => {
      registrarLog('warn', args);
      warnOriginal(...args);
    };
    console.error = (...args) => {
      registrarLog('error', args);
      errorOriginal(...args);
    };
  }

  /* ---------------------------------------------------------------------
   * MONTAGEM DOS DADOS -- separado do DOM de propósito (mesmo padrão dos
   * Módulos 10/11): é aqui que mora a única lógica do módulo, e é o que os
   * testes exercitam sem navegador.
   * --------------------------------------------------------------------- */

  /**
   * @returns {{disponivel: boolean, carregados?: string[], faltando?: string[], total?: number}}
   */
  function montarModulos() {
    const util = window.__smartTableUtil;
    if (!util || typeof util.modulosCarregados !== 'function') {
      return { disponivel: false };
    }
    const carregados = util.modulosCarregados();
    const faltando = util.modulosFaltando();
    return {
      disponivel: true,
      carregados,
      faltando,
      total: carregados.length + faltando.length,
    };
  }

  /**
   * @returns {{disponivel: boolean, motivo?: string, naFila?: boolean,
   *   posicao?: number, total?: number, progresso?: object}}
   */
  function montarFilaEProgresso() {
    const filaDebug = window.filaDebug;
    if (!filaDebug || typeof filaDebug.obterFila !== 'function') {
      return { disponivel: false, motivo: 'A fila (Módulo 3) não carregou nesta página.' };
    }

    const fila = filaDebug.obterFila();
    const progressoFila = window.__progressoFila;
    // Reaproveita a MESMA aritmética do painel de progresso (Módulo 11) --
    // não recalculamos faixa por faixa aqui, só exibimos o resultado dela.
    const progresso = progressoFila && typeof progressoFila.montarProgresso === 'function'
      ? progressoFila.montarProgresso()
      : null;

    if (!fila) {
      return { disponivel: true, naFila: false, progresso };
    }

    return {
      disponivel: true,
      naFila: typeof filaDebug.getPaginaNaFila === 'function' ? filaDebug.getPaginaNaFila() : null,
      posicao: fila.indiceAtual + 1,
      total: fila.clientes.length,
      totalAtendidos: fila.totalAtendidos || 0,
      totalPulados: fila.totalPulados || 0,
      progresso,
    };
  }

  /**
   * @returns {{nivel: string, mensagem: string, quando: number}[]} Mais
   *   recente primeiro.
   */
  function montarLogRecente() {
    return logRecente.slice().reverse();
  }

  /**
   * Retrato completo pra diagnóstico -- usado tanto pelo painel quanto por
   * quem quiser consultar via console sem abrir a tela.
   *
   * @returns {{modulos: object, filaEProgresso: object, log: object[]}}
   */
  function montarDiagnostico() {
    return {
      modulos: montarModulos(),
      filaEProgresso: montarFilaEProgresso(),
      log: montarLogRecente(),
    };
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

  function criarSecao(titulo) {
    const secao = criarDiv('', { marginBottom: '12px' });
    secao.appendChild(criarDiv(titulo, {
      color: CORES.tinta, fontWeight: '700', fontSize: '12px',
      textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px',
    }));
    return secao;
  }

  function formatarHora(timestampMs) {
    return new Date(timestampMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function criarSecaoModulos(modulos) {
    const secao = criarSecao('Módulos');
    if (!modulos.disponivel) {
      secao.appendChild(criarDiv('O Módulo 0 não carregou -- não dá pra checar.', { color: CORES.erro, fontSize: '12px' }));
      return secao;
    }

    secao.appendChild(criarDiv(`${modulos.carregados.length}/${modulos.total} carregados`, {
      color: modulos.faltando.length === 0 ? CORES.ok : CORES.erro,
      fontWeight: '600', fontSize: '13px', marginBottom: '4px',
    }));

    if (modulos.faltando.length > 0) {
      secao.appendChild(criarDiv(`Faltando: ${modulos.faltando.join(', ')}`, {
        color: CORES.erro, fontSize: '11.5px', lineHeight: '1.5',
      }));
    }

    return secao;
  }

  function criarSecaoFila(filaEProgresso) {
    const secao = criarSecao('Fila e progresso de hoje');

    if (!filaEProgresso.disponivel) {
      secao.appendChild(criarDiv(filaEProgresso.motivo, { color: CORES.apagado, fontSize: '12px' }));
      return secao;
    }

    if (!filaEProgresso.naFila && filaEProgresso.total === undefined) {
      secao.appendChild(criarDiv('Nenhuma fila ativa no momento.', { color: CORES.apagado, fontSize: '12px' }));
    } else if (filaEProgresso.total !== undefined) {
      secao.appendChild(criarDiv(
        `Posição ${filaEProgresso.posicao}/${filaEProgresso.total} -- ${filaEProgresso.totalAtendidos} atendido(s), ${filaEProgresso.totalPulados} pulado(s)`,
        { color: CORES.texto, fontSize: '12.5px', marginBottom: '4px' }
      ));
    }

    const progresso = filaEProgresso.progresso;
    if (progresso && progresso.disponivel) {
      secao.appendChild(criarDiv(
        `Progresso do dia: ${progresso.cobradosGeral}/${progresso.totalGeral} cobrados`,
        { color: CORES.texto, fontSize: '12.5px' }
      ));
    } else if (progresso && !progresso.disponivel) {
      secao.appendChild(criarDiv(progresso.motivo, { color: CORES.apagado, fontSize: '11.5px' }));
    }

    return secao;
  }

  function criarSecaoLog(log) {
    const secao = criarSecao(`Avisos e erros recentes (${log.length})`);

    if (log.length === 0) {
      secao.appendChild(criarDiv('Nada registrado desde que este painel carregou.', { color: CORES.apagado, fontSize: '12px' }));
      return secao;
    }

    log.forEach((item) => {
      const linha = criarDiv('', {
        display: 'flex', gap: '6px', alignItems: 'flex-start',
        padding: '3px 0', borderTop: `1px solid ${CORES.linha}`,
      });
      linha.appendChild(criarDiv(formatarHora(item.quando), {
        color: CORES.apagado, fontSize: '10.5px', fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap', paddingTop: '1px',
      }));
      linha.appendChild(criarDiv(item.mensagem, {
        color: item.nivel === 'error' ? CORES.erro : CORES.aviso,
        fontSize: '11.5px', lineHeight: '1.4', wordBreak: 'break-word',
      }));
      secao.appendChild(linha);
    });

    return secao;
  }

  /**
   * Roda window.__conferir() (Módulo 8) e mostra o resultado inline --
   * a pedido, não sozinho (ver cabeçalho do arquivo). Substitui o próprio
   * botão por um resumo, sem fechar o painel.
   *
   * @param {HTMLElement} areaResultado
   */
  function rodarAutoconferencia(areaResultado) {
    areaResultado.textContent = '';

    if (typeof window.__conferir !== 'function') {
      areaResultado.appendChild(criarDiv('window.__conferir() não está disponível (Módulo 8 não carregou).', { color: CORES.erro, fontSize: '12px' }));
      return;
    }

    const r = window.__conferir();

    if (r.problemas.length === 0 && r.avisos.length === 0) {
      areaResultado.appendChild(criarDiv(`${r.checagens} checagem(ns), nenhum problema.`, { color: CORES.ok, fontSize: '12px', fontWeight: '600' }));
      return;
    }

    r.problemas.forEach((p) => {
      areaResultado.appendChild(criarDiv(`✗ ${p}`, { color: CORES.erro, fontSize: '11.5px', lineHeight: '1.5', marginBottom: '2px' }));
    });
    r.avisos.forEach((a) => {
      areaResultado.appendChild(criarDiv(`! ${a}`, { color: CORES.aviso, fontSize: '11.5px', lineHeight: '1.5', marginBottom: '2px' }));
    });
  }

  function criarBotaoAutoconferencia() {
    const bloco = criarSecao('Autoconferência completa');

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Rodar window.__conferir()';
    Object.assign(botao.style, {
      cursor: 'pointer', border: `1px solid ${CORES.borda}`, background: CORES.fundo,
      color: CORES.tinta, padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
      fontWeight: '600', width: '100%',
    });
    bloco.appendChild(botao);

    const areaResultado = criarDiv('', { marginTop: '8px' });
    bloco.appendChild(areaResultado);

    botao.addEventListener('click', () => rodarAutoconferencia(areaResultado));

    return bloco;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function abrirPainel() {
    window.__smartTableUtil?.fecharOutrosPaineis?.('consoleDiagnostico');

    const diagnostico = montarDiagnostico();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_CONSOLE.ID_PAINEL;
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
      zIndex: CONFIG_CONSOLE.Z_INDEX,
      width: '440px',
      maxWidth: '92vw',
      maxHeight: '72vh',
      overflowY: 'auto',
    });

    painelEl.appendChild(criarDiv('Console de Diagnóstico', {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px', marginBottom: '10px',
    }));

    painelEl.appendChild(criarSecaoModulos(diagnostico.modulos));
    painelEl.appendChild(criarSecaoFila(diagnostico.filaEProgresso));
    painelEl.appendChild(criarSecaoLog(diagnostico.log));
    painelEl.appendChild(criarBotaoAutoconferencia());

    painelEl.appendChild(criarDiv('Alt+K ou Esc pra fechar', {
      marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    }));

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel();
  }

  instalarCapturaDeLog();

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('consoleDiagnostico', fecharPainel);

  window.__consoleDiagnostico = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    montarDiagnostico,
    montarModulos,
    montarFilaEProgresso,
    montarLogRecente,
    registrarLog,
    CONFIG_CONSOLE,
  };
})();
