/* =========================================================================
 * MÓDULO 11: PROGRESSO DA FILA POR PRIORIDADE — CRM TexCotton
 * Uma barra por faixa de prioridade (Módulo 7): cobrados hoje / total da faixa.
 *
 * Gatilho é um BOTÃO discreto (decisão do usuário: "muito bem localizado e
 * escondido"), não atalho de teclado; por isso não entra no mapa do Módulo 4.
 * Fica na borda direita, centralizado na vertical: único ponto livre
 * (esquerda-inferior tem "Continuar fila"; direita-inferior tem os toasts).
 *
 * Números: SNAPSHOT da primeira fila por prioridade do dia
 * (window.filaPrioridadeDebug.lerSnapshotProgresso(), gravado pelo Módulo 7),
 * NÃO a fila ao vivo do Módulo 3, que encolhe. O módulo só agrupa por
 * prioridadeTier e cruza com window.filaDebug.obterAtendidosHoje(). Nomes e
 * cores das faixas vêm do Módulo 7 (NOMES_PRIORIDADE/CORES_PRIORIDADE), sem
 * duplicar aqui.
 *
 * Não é ao vivo: como os outros painéis (Alt+O/D/H/L), calcula ao abrir.
 * Cada cliente é navegação de página cheia; reabrir é a atualização.
 *
 * Carregar depois dos Módulos 0 (registro de painéis), 3 (window.filaDebug)
 * e 7 (window.filaPrioridadeDebug, NOMES_PRIORIDADE, CORES_PRIORIDADE).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__progressoFilaCarregado) return;
  window.__progressoFilaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Progresso da Fila');

  const CONFIG_PROGRESSO = {
    ID_BOTAO: 'smarttable-gatilho-progresso',
    ID_PAINEL: 'smarttable-painel-progresso',
    // Igual aos painéis dos Módulos 9/10: abaixo dos modais do CRM (z-50).
    Z_INDEX: 30,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    destaque: '#1B6B4A',
    fundo: '#ffffff',
  };

  let painelEl = null;
  let botaoEl = null;

  /**
   * Agrupa o SNAPSHOT do dia (Módulo 7, CHAVE_SNAPSHOT_PROGRESSO) por
   * prioridadeTier e cruza com quem já foi contatado hoje. Sem DOM: é a única
   * aritmética do módulo e os testes a exercitam sem navegador.
   *
   * Decisão do usuário: o "total" da faixa vem do snapshot da PRIMEIRA fila
   * do dia, fixo o dia inteiro (a fila ao vivo encolhe: Shift+Alt+U
   * reclassifica, retomarFilaDeHoje tira quem já mexeu por fora). Só
   * "cobrados" muda.
   *
   * @returns {{disponivel: boolean, motivo?: string, faixas?: object[],
   *            totalGeral?: number, cobradosGeral?: number,
   *            estagioAtual?: {tier: number, nome: string, cor: string}|null}}
   */
  function montarProgresso() {
    const filaDebug = window.filaDebug;
    const prioridadeDebug = window.filaPrioridadeDebug;

    if (!filaDebug || !prioridadeDebug || typeof prioridadeDebug.lerSnapshotProgresso !== 'function') {
      return { disponivel: false, motivo: 'A fila (Módulo 3/7) não carregou nesta página.' };
    }

    const snapshot = prioridadeDebug.lerSnapshotProgresso();
    if (!snapshot) {
      // Fila do Alt+I (sem prioridade) tem motivo próprio, não o genérico.
      const filaAoVivo = filaDebug.obterFila();
      if (filaAoVivo && !prioridadeDebug.ehFilaDePrioridade(filaAoVivo)) {
        return { disponivel: false, motivo: 'A fila de hoje foi montada pelo Alt+I (não por prioridade). Use Alt+U pra ver o progresso por faixa.' };
      }
      return { disponivel: false, motivo: 'Nenhuma fila por prioridade gerada hoje ainda. Alt+U monta uma.' };
    }

    const atendidos = typeof filaDebug.obterAtendidosHoje === 'function'
      ? filaDebug.obterAtendidosHoje()
      : new Set();

    const porTier = new Map();
    snapshot.clientes.forEach((c) => {
      if (!c || c.prioridadeTier == null) return;
      const tier = c.prioridadeTier;
      if (!porTier.has(tier)) porTier.set(tier, { total: 0, cobrados: 0, nomeGravado: c.prioridadeNome || null });
      const registro = porTier.get(tier);
      registro.total += 1;
      if (c.cnpj && atendidos.has(c.cnpj)) registro.cobrados += 1;
    });

    // Snapshot de OUTRA régua (versão diferente ou sem versão gravada): os
    // números das faixas significam outra coisa, então nome e cor saem pelo
    // NOME gravado no snapshot (nunca tudo cinza, nem nas faixas inalteradas).
    const nomesAtuais = prioridadeDebug.NOMES_PRIORIDADE || {};
    const coresAtuais = prioridadeDebug.CORES_PRIORIDADE || {};
    const mesmaRegua = snapshot.versaoRegua != null && snapshot.versaoRegua === prioridadeDebug.CONFIG?.VERSAO_REGUA;
    const nomes = mesmaRegua ? nomesAtuais : {};
    const cores = mesmaRegua ? coresAtuais : {};
    const corPorNome = new Map(Object.entries(nomesAtuais).map(([faixa, nome]) => [nome, coresAtuais[faixa]]));
    // Nome antigo da faixa 9 (régua v4): snapshot gravado com ele mantém a cor.
    corPorNome.set('Sem contato ou movimentação há mais de um mês', coresAtuais[9]);

    const faixas = Array.from(porTier.entries())
      .map(([tier, { total, cobrados, nomeGravado }]) => ({
        tier,
        nome: nomes[tier] || nomeGravado || `Faixa ${tier}`,
        cor: cores[tier] || corPorNome.get(nomeGravado) || CORES.apagado,
        total,
        cobrados,
      }))
      .sort((a, b) => a.tier - b.tier);

    // Faixa do cliente da página atual: cruza o CNPJ com o snapshot, não com
    // a fila ao vivo (o cliente pode já ter saído dela por movimentação hoje).
    let estagioAtual = null;
    const cnpjAtual = typeof filaDebug.extrairCnpjDaUrl === 'function' ? filaDebug.extrairCnpjDaUrl(location.href) : null;
    const clienteAtual = cnpjAtual ? snapshot.clientes.find((c) => c.cnpj === cnpjAtual) : null;
    if (clienteAtual && clienteAtual.prioridadeTier != null) {
      estagioAtual = {
        tier: clienteAtual.prioridadeTier,
        nome: nomes[clienteAtual.prioridadeTier] || clienteAtual.prioridadeNome || `Faixa ${clienteAtual.prioridadeTier}`,
        cor: cores[clienteAtual.prioridadeTier] || corPorNome.get(clienteAtual.prioridadeNome) || CORES.apagado,
      };
    }

    return {
      disponivel: true,
      faixas,
      totalGeral: faixas.reduce((soma, f) => soma + f.total, 0),
      cobradosGeral: faixas.reduce((soma, f) => soma + f.cobrados, 0),
      estagioAtual,
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

  function criarResumoGeral(resumo) {
    const linha = criarDiv('', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginBottom: '10px', paddingBottom: '8px', borderBottom: `1px solid ${CORES.linha}`,
    });
    linha.appendChild(criarDiv('Hoje', { color: CORES.tinta, fontWeight: '700', fontSize: '13px' }));
    linha.appendChild(criarDiv(`${resumo.cobradosGeral}/${resumo.totalGeral}`, {
      fontFamily: 'ui-monospace, monospace', color: CORES.destaque, fontWeight: '700', fontSize: '14px',
    }));
    return linha;
  }

  // Destaque no topo: em que faixa está o cliente cobrado agora.
  function criarEstagioAtual(estagio) {
    const linha = criarDiv('', {
      display: 'flex', alignItems: 'center', gap: '8px',
      marginBottom: '10px', padding: '6px 10px',
      borderRadius: '8px', background: CORES.linha,
    });
    linha.appendChild(criarDiv('', {
      width: '8px', height: '8px', borderRadius: '50%', flexShrink: '0', background: estagio.cor,
    }));
    linha.appendChild(criarDiv(`Cobrando agora: ${estagio.nome}`, {
      color: CORES.tinta, fontSize: '12px', fontWeight: '600',
    }));
    return linha;
  }

  function criarBarraFaixa(faixa, emAndamento) {
    const bloco = criarDiv('', {
      marginBottom: '10px',
      // Destaque visual da faixa do cliente atual.
      paddingLeft: emAndamento ? '8px' : '0',
      borderLeft: emAndamento ? `3px solid ${faixa.cor}` : 'none',
    });

    const cabecalho = criarDiv('', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', gap: '10px',
    });
    cabecalho.appendChild(criarDiv(faixa.nome, { color: CORES.texto, fontSize: '12px', fontWeight: emAndamento ? '700' : '400' }));
    cabecalho.appendChild(criarDiv(`${faixa.cobrados}/${faixa.total}`, {
      fontFamily: 'ui-monospace, monospace', color: CORES.tinta, fontWeight: '600', fontSize: '12px', whiteSpace: 'nowrap',
    }));
    bloco.appendChild(cabecalho);

    const trilha = criarDiv('', {
      height: '8px', borderRadius: '4px', background: CORES.linha, overflow: 'hidden',
    });
    const preenchido = criarDiv('', {
      height: '100%',
      width: `${Math.round((faixa.cobrados / faixa.total) * 100)}%`,
      background: faixa.cor,
      borderRadius: '4px',
    });
    trilha.appendChild(preenchido);
    bloco.appendChild(trilha);

    return bloco;
  }

  const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /**
   * "Usar a fila atual": a referência é a primeira fila do dia e nunca muda
   * sozinha; se saiu errada (ex.: lista filtrada), o botão a troca sem perder
   * quem já foi cobrado (Módulo 7, usarFilaAtualComoReferencia). Só aparece
   * com fila por prioridade.
   */
  function criarSecaoTrocaDeReferencia() {
    const prioridadeDebug = window.filaPrioridadeDebug;
    if (typeof prioridadeDebug?.usarFilaAtualComoReferencia !== 'function') return null;
    const previa = prioridadeDebug.usarFilaAtualComoReferencia({ gravar: false });
    const snapshot = prioridadeDebug.lerSnapshotProgresso?.();
    if (!previa.ok && !snapshot?.trocadoEm) return null;

    const secao = criarDiv('', { marginTop: '6px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}` });
    if (snapshot?.trocadoEm) {
      secao.appendChild(criarDiv(`Referência trocada às ${hora(snapshot.trocadoEm)}`, { color: CORES.apagado, fontSize: '11px', marginBottom: '6px' }));
    }
    if (previa.ok) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = 'Usar a fila atual';
      botao.title = 'Troca a referência do progresso de hoje pela fila por prioridade atual. Quem já foi cobrado continua contando.';
      Object.assign(botao.style, {
        width: '100%', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
        border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.tinta, fontSize: '12px', fontWeight: '600',
      });
      botao.addEventListener('click', trocarReferencia);
      secao.appendChild(botao);
    }
    return secao;
  }

  function trocarReferencia() {
    const prioridadeDebug = window.filaPrioridadeDebug;
    const previa = prioridadeDebug.usarFilaAtualComoReferencia({ gravar: false });
    if (!previa.ok) {
      window.__smartTableUtil?.toast?.(previa.motivo);
      return;
    }
    const pergunta = previa.antes
      ? `Trocar a referência do progresso (fila das ${hora(previa.antes.geradoEm)}, ${previa.antes.total} clientes) pela fila atual (${previa.total} clientes)? Quem você já cobrou hoje continua contando.`
      : `Usar a fila atual (${previa.total} clientes) como referência do progresso de hoje?`;
    if (!window.confirm(pergunta)) return;
    const r = prioridadeDebug.usarFilaAtualComoReferencia({ gravar: true });
    if (!r.ok) {
      window.__smartTableUtil?.toast?.(r.motivo);
      return;
    }
    fecharPainel();
    abrirPainel();
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function abrirPainel() {
    window.__smartTableUtil?.fecharOutrosPaineis?.('progressoFila');

    const resultado = montarProgresso();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_PROGRESSO.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      bottom: '112px',
      right: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_PROGRESSO.Z_INDEX,
      width: '300px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
    });

    painelEl.appendChild(criarDiv('Progresso da fila', {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px', marginBottom: '8px',
    }));

    if (!resultado.disponivel) {
      painelEl.appendChild(criarDiv(resultado.motivo, { color: CORES.apagado, lineHeight: '1.5' }));
    } else if (resultado.faixas.length === 0) {
      painelEl.appendChild(criarDiv('A fila de hoje está vazia.', { color: CORES.apagado }));
    } else {
      if (resultado.estagioAtual) painelEl.appendChild(criarEstagioAtual(resultado.estagioAtual));
      painelEl.appendChild(criarResumoGeral(resultado));
      resultado.faixas.forEach((faixa) => {
        const emAndamento = Boolean(resultado.estagioAtual) && faixa.tier === resultado.estagioAtual.tier;
        painelEl.appendChild(criarBarraFaixa(faixa, emAndamento));
      });
    }

    const secaoTroca = criarSecaoTrocaDeReferencia();
    if (secaoTroca) painelEl.appendChild(secaoTroca);

    painelEl.appendChild(criarDiv('Esc pra fechar', {
      marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    }));

    document.body.appendChild(painelEl);
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel();
  }

  /**
   * Gatilho quase invisível em repouso, evidente com mouse ou foco (Tab).
   * <button> de verdade: Enter/Espaço funcionam sem código extra.
   */
  function criarBotaoGatilho() {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = CONFIG_PROGRESSO.ID_BOTAO;
    el.title = 'Progresso da fila por prioridade';
    el.setAttribute('aria-label', 'Progresso da fila por prioridade');
    Object.assign(el.style, {
      position: 'fixed',
      top: '50%',
      right: '0',
      transform: 'translateY(-50%)',
      width: '10px',
      height: '44px',
      padding: '0',
      margin: '0',
      border: 'none',
      borderRadius: '6px 0 0 6px',
      background: CORES.tinta,
      opacity: '0.15',
      cursor: 'pointer',
      zIndex: CONFIG_PROGRESSO.Z_INDEX,
      transition: 'opacity .15s ease, width .15s ease',
    });

    const destacar = () => { el.style.opacity = '0.85'; el.style.width = '16px'; };
    const apagar = () => { el.style.opacity = '0.15'; el.style.width = '10px'; };
    el.addEventListener('mouseenter', destacar);
    el.addEventListener('mouseleave', apagar);
    el.addEventListener('focus', destacar);
    el.addEventListener('blur', apagar);
    el.addEventListener('click', alternarPainel);

    document.body.appendChild(el);
    return el;
  }

  function aoCarregar() {
    botaoEl = criarBotaoGatilho();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aoCarregar);
  } else {
    aoCarregar();
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('progressoFila', fecharPainel);

  window.__progressoFila = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    montarProgresso,
    CONFIG_PROGRESSO,
    obterBotao: () => botaoEl,
  };
})();
