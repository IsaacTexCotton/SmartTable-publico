/* =========================================================================
 * MÓDULO 13: CONSOLE DE DIAGNÓSTICO (Alt+K) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Janela única com o resumo de diagnóstico (módulos, fila/progresso de hoje,
 * avisos e erros recentes) e botões para a autoconferência (Módulo 8).
 * A autoconferência só roda a pedido: rodar ao abrir poluiria o log recente
 * com o próprio diagnóstico.
 *
 * Nada é recalculado aqui, tudo vem de outros módulos:
 *   - módulos: window.__smartTableUtil.modulosCarregados()/modulosFaltando()
 *     (Módulo 0);
 *   - fila: window.filaDebug (Módulo 3); progresso: window.__progressoFila
 *     .montarProgresso() (Módulo 11);
 *   - avisos/erros: este módulo envolve console.warn/console.error ao
 *     carregar (ring buffer, CONFIG_CONSOLE.LIMITE_LOG). Só cobre o que for
 *     emitido DEPOIS do carregamento;
 *   - autoconferência: window.__conferir() e window.__diag.* (Módulo 8).
 *
 * Expõe window.__consoleDiagnostico. Carregar depois dos Módulos 0, 3 e 11.
 * O atalho Alt+K vive no Módulo 4 e chama __consoleDiagnostico.alternarPainel()
 * em tempo de uso, então a ordem em relação ao Módulo 4 não importa.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__consoleDiagnosticoCarregado) return;
  window.__consoleDiagnosticoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Console de Diagnóstico');

  const CONFIG_CONSOLE = {
    ID_PAINEL: 'smarttable-console-diagnostico',
    // Mesmo z-index dos outros painéis nossos: ABAIXO dos modais do CRM (z-50).
    Z_INDEX: 30,
    // Ring buffer só em memória, nunca em localStorage.
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

  /* CAPTURA DE AVISOS/ERROS: espelha console.warn/error num buffer, sempre
   * chamando o original (a saída no DevTools não muda). */
  const logRecente = [];

  // Campos que carregam dado de cliente quando um OBJETO vai pro console (ex.:
  // aviso do Módulo 1). O regex do Módulo 8 só reconhece o FORMATO de
  // CNPJ/CPF/telefone; título, nome e valor só pelo nome do campo.
  const CAMPOS_SENSIVEIS = /^(titulo|tituloCompleto|titulos|cnpj|cpf|razaoSocial|nomeFantasia|label|cliente|nome|telefone|email|saldo|saldoTexto|valor|valorEmAberto|vencido)$/i;

  /** Serializa pro painel trocando o valor dos campos sensíveis por apelido. */
  function serializarCensurado(valor) {
    const apelido = (v) => window.__smartTableUtil?.apelidoParaLog?.(v) ?? 'cli.????';
    return JSON.stringify(valor, (chave, v) => {
      if (!chave || !CAMPOS_SENSIVEIS.test(chave) || v == null) return v;
      if (Array.isArray(v)) return v.map((x) => (x != null && typeof x !== 'object' ? apelido(x) : x));
      if (typeof v === 'object') return v; // objeto: os campos de dentro passam por aqui também
      return apelido(v);
    });
  }

  function registrarLog(nivel, args) {
    const mensagem = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return serializarCensurado(a) ?? String(a);
        } catch (erro) {
          return String(a);
        }
      })
      .join(' ');
    // Privacidade: o painel mostra na tela o que qualquer script logou.
    // CNPJ/CPF/telefone viram apelido (Módulo 8) antes de guardar; a origem
    // continua sendo o lugar certo de não logar dado de cliente
    // (tests/privacidade-logs.test.js).
    let censurada = mensagem;
    try {
      censurada = window.__diario?.censurarTexto?.(mensagem) ?? mensagem;
    } catch (erro) {
      censurada = mensagem;
    }
    logRecente.push({ nivel, mensagem: censurada, quando: Date.now() });
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

  /* MONTAGEM DOS DADOS: separada do DOM de propósito (padrão dos Módulos
   * 10/11); é a única lógica do módulo e o que os testes exercitam. */

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
   *   posicao?: number, total?: number, totalAtendidos?: number,
   *   totalPulados?: number, progresso?: object}}
   */
  function montarFilaEProgresso() {
    const filaDebug = window.filaDebug;
    if (!filaDebug || typeof filaDebug.obterFila !== 'function') {
      return { disponivel: false, motivo: 'A fila (Módulo 3) não carregou nesta página.' };
    }

    const fila = filaDebug.obterFila();
    const progressoFila = window.__progressoFila;
    // Mesma aritmética do painel de progresso (Módulo 11); não recalcular aqui.
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
   * Retrato completo, usado pelo painel e por consulta via console.
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

  /* DESENHO */

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
   * Roda window.__conferir() (Módulo 8) e mostra o resultado inline, a pedido.
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

  /* RITMO DO OPERADOR: cada botão chama um diagnóstico do Módulo 8
   * (window.__diag.qualidade/ritmo/filaDefasada) e mostra uma linha de leitura
   * mais o JSON, que já sai do filtro de privacidade dele (só número,
   * booleano e textos de lista fechada). "Copiar" copia esse mesmo JSON. */
  const porcento = (x) => `${Math.round(x * 1000) / 10}%`;

  /** Uma linha de leitura por diagnóstico, sem esconder o JSON completo logo abaixo. */
  const LEITURAS_DO_RITMO = {
    qualidade: (o) => (o.pode_concluir
      ? `${o.dias_validos} dia(s) válido(s) (mínimo ${o.dias_minimos_para_concluir}): já dá para concluir.`
      : `${o.dias_validos} dia(s) válido(s) de ${o.dias_minimos_para_concluir} necessários: ainda NÃO dá para concluir.`),
    ritmo: (o) => {
      const todos = o.recortes?.todos;
      if (!todos || todos.resultado === 'sem dados') {
        return `Sem dados: só ${o.dias_validos} dia(s) válido(s). Precisa de 10 (dias com 30 contatos de clientes da fila).`;
      }
      return `Cobertura mediana ${porcento(todos.cobertura_mediana)} em ${todos.dias} dias; ${porcento(todos.fracao_de_dias_com_cobertura_95)} dos dias com 95% ou mais. (É um teto: contato = WhatsApp aberto.)`;
    },
    filaDefasada: (o) => {
      if (o.lista_disponivel === false) return 'Abra a página da LISTA de clientes para rodar este.';
      if (o.fila_disponivel === false) return 'Não há fila de hoje salva.';
      const avisos = [];
      if (o.fila_inteira_fora_da_lista) avisos.push('a fila inteira parece fora da lista (formato de CNPJ diferente?): não confie no número');
      if (o.filtro_ativo_na_lista) avisos.push('há filtro ativo na lista');
      return `Da fila, fora da lista e ainda não contatados hoje: ${o.fora_da_lista_e_ainda_nao_contatados_hoje}.${avisos.length ? ` Atenção: ${avisos.join('; ')}.` : ''}`;
    },
  };

  /**
   * Roda um diagnóstico do Módulo 8 e mostra o resultado no painel. Erro
   * inesperado: só o NOME do erro (a mensagem poderia trazer conteúdo).
   */
  function rodarDiagnosticoDoRitmo(nome, area) {
    area.textContent = '';
    const funcao = window.__diag?.[nome];
    if (typeof funcao !== 'function') {
      area.appendChild(criarDiv('Não disponível (o Módulo 8 não carregou).', { color: CORES.erro, fontSize: '12px' }));
      return;
    }
    let saida;
    try {
      saida = funcao();
    } catch (erro) {
      area.appendChild(criarDiv(`Falhou (${erro?.name || 'erro'}).`, { color: CORES.erro, fontSize: '12px' }));
      return;
    }
    if (saida?.saida_invalida) {
      area.appendChild(criarDiv('Saída bloqueada pelo filtro de privacidade do Módulo 8.', { color: CORES.erro, fontSize: '12px', fontWeight: '600' }));
      return;
    }
    const json = JSON.stringify(saida);
    area.appendChild(criarDiv(LEITURAS_DO_RITMO[nome](saida), { color: CORES.tinta, fontSize: '12px', fontWeight: '600', marginBottom: '6px' }));

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(saida, null, 1);
    Object.assign(pre.style, {
      margin: '0 0 6px', padding: '6px 8px', background: CORES.linha, border: `1px solid ${CORES.borda}`,
      borderRadius: '6px', fontSize: '10.5px', lineHeight: '1.4', maxHeight: '160px', overflow: 'auto',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: CORES.texto,
    });
    area.appendChild(pre);

    const copiar = document.createElement('button');
    copiar.type = 'button';
    copiar.dataset.papel = 'copiar-diagnostico';
    copiar.textContent = 'Copiar (só números)';
    Object.assign(copiar.style, {
      cursor: 'pointer', border: `1px solid ${CORES.borda}`, background: CORES.fundo,
      color: CORES.tinta, padding: '4px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: '600',
    });
    const retorno = criarDiv('', { display: 'inline-block', marginLeft: '8px', fontSize: '11.5px' });
    copiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(json);
        retorno.textContent = 'Copiado.';
        retorno.style.color = CORES.ok;
      } catch (erro) {
        retorno.textContent = 'Não consegui copiar (aba sem foco?).';
        retorno.style.color = CORES.erro;
      }
    });
    area.append(copiar, retorno);
  }

  function criarSecaoRitmoDoOperador() {
    const bloco = criarSecao('Ritmo do operador');
    bloco.appendChild(criarDiv('Só números, prontos para colar. Rode "Qualidade" primeiro.', { color: CORES.apagado, fontSize: '11.5px', marginBottom: '6px' }));

    [
      ['qualidade', 'Qualidade do diário'],
      ['ritmo', 'Ritmo (cobertura e intervalos)'],
      ['filaDefasada', 'Fila defasada (só na lista)'],
    ].forEach(([nome, rotulo]) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.dataset.papel = `diagnostico-${nome}`;
      botao.textContent = rotulo;
      Object.assign(botao.style, {
        cursor: 'pointer', border: `1px solid ${CORES.borda}`, background: CORES.fundo,
        color: CORES.tinta, padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
        fontWeight: '600', width: '100%', marginTop: '4px',
      });
      const area = criarDiv('', { marginTop: '6px' });
      botao.addEventListener('click', () => rodarDiagnosticoDoRitmo(nome, area));
      bloco.append(botao, area);
    });
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
    painelEl.appendChild(criarSecaoRitmoDoOperador());

    painelEl.appendChild(criarDiv('Alt+K ou Esc pra fechar', {
      marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    }));

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
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
    rodarDiagnosticoDoRitmo,
    LEITURAS_DO_RITMO,
    CONFIG_CONSOLE,
  };
})();
