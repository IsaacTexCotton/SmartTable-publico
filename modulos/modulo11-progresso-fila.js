/* =========================================================================
 * MÓDULO 11: PROGRESSO DA FILA POR PRIORIDADE (botão discreto) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Uma barra por faixa de prioridade (Módulo 7), mostrando quanto já foi
 * cobrado hoje dentro dela: "23/56" -- cobrados sobre o total da faixa.
 *
 * PEDIDO EXPLÍCITO DO USUÁRIO: um BOTÃO, não um atalho de teclado -- "muito
 * bem localizado e escondido". Por isso este módulo não entra no mapa de
 * teclas do Módulo 4: o gatilho é um elemento visual próprio, quase
 * invisível (opacidade baixa) numa borda da tela sem nada nosso hoje
 * (esquerda-inferior já tem o botão "Continuar fila" e os painéis;
 * direita-inferior já tem os toasts do Módulo 7). Fica na borda direita,
 * centralizado na vertical -- único ponto ainda livre.
 *
 * DE ONDE VÊM OS NÚMEROS: o SNAPSHOT da primeira fila por prioridade do
 * dia (window.filaPrioridadeDebug.lerSnapshotProgresso(), gravado pelo
 * Módulo 7) -- NÃO a fila "ao vivo" do Módulo 3, que encolhe conforme os
 * clientes são atendidos (ver montarProgresso). Este módulo não calcula
 * prioridade nem confere resultado, só AGRUPA o snapshot por prioridadeTier
 * e cruza com quem já foi contatado hoje (window.filaDebug.obterAtendidosHoje()).
 * Nomes e cores das faixas vêm do Módulo 7 (NOMES_PRIORIDADE/CORES_PRIORIDADE)
 * -- não duplicados aqui, pra nunca divergir se uma faixa mudar de nome.
 *
 * NÃO É AO VIVO: assim como os outros painéis (Alt+O, Alt+D, Alt+H, Alt+L),
 * o número é calculado no momento em que o painel abre, não atualizado
 * sozinho enquanto fica na tela. Como cada cliente da fila é uma navegação
 * de página cheia (recarrega), não haveria como manter o painel aberto
 * durante o trabalho de qualquer forma -- reabrir é o próprio mecanismo de
 * atualização.
 *
 * ONDE COLAR: depois do Módulo 0 (registro de painéis, formatação), do
 * Módulo 3 (window.filaDebug) e do Módulo 7 (window.filaPrioridadeDebug,
 * NOMES_PRIORIDADE, CORES_PRIORIDADE) -- os três precisam já estar carregados.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__progressoFilaCarregado) return;
  window.__progressoFilaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Progresso da Fila');

  const CONFIG_PROGRESSO = {
    ID_BOTAO: 'smarttable-gatilho-progresso',
    ID_PAINEL: 'smarttable-painel-progresso',
    // Mesmo z-index dos outros painéis nossos (Módulo 9/10): ABAIXO dos
    // modais do CRM (z-50).
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
   * Agrupa o SNAPSHOT do dia (ver Módulo 7, CHAVE_SNAPSHOT_PROGRESSO) por
   * prioridadeTier e cruza com quem já foi contatado hoje. Separado do DOM
   * de propósito -- é aqui que mora a única aritmética do módulo, e é o que
   * os testes exercitam sem navegador.
   *
   * PEDIDO DO USUÁRIO (v1.25.0): o "total" de cada faixa vem do SNAPSHOT da
   * PRIMEIRA fila por prioridade do dia, não da fila "ao vivo" -- que
   * encolhe conforme clientes são atendidos/removidos (Shift+Alt+U
   * reclassifica, retomarFilaDeHoje tira quem já mexeu hoje por fora do
   * SmartTable). O snapshot fica fixo o dia inteiro; só "cobrados" muda,
   * conforme atendidosHoje cresce.
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
      // Ajuda extra: se já existe uma fila hoje mas ela é do Alt+I (sem
      // prioridade), o motivo de não ter snapshot é outro -- avisa qual,
      // em vez da mensagem genérica.
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

    // Snapshot de OUTRA régua (ex.: o da manhã do dia em que a régua v3
    // entrou, sem versão gravada): os NÚMEROS das faixas querem dizer outra
    // coisa, então nome e cor saem pelo NOME gravado com ele. CORRIGIDO
    // (relatado pelo usuário, "por que está cinza todas as cores?"): a 1ª
    // versão deixava tudo cinza nesse caso, até as faixas que não mudaram.
    const nomesAtuais = prioridadeDebug.NOMES_PRIORIDADE || {};
    const coresAtuais = prioridadeDebug.CORES_PRIORIDADE || {};
    const mesmaRegua = snapshot.versaoRegua != null && snapshot.versaoRegua === prioridadeDebug.CONFIG?.VERSAO_REGUA;
    const nomes = mesmaRegua ? nomesAtuais : {};
    const cores = mesmaRegua ? coresAtuais : {};
    const corPorNome = new Map(Object.entries(nomesAtuais).map(([faixa, nome]) => [nome, coresAtuais[faixa]]));
    // Nome da faixa 9 até a régua v4 (na v5 virou "... há 14 dias ou mais"):
    // um snapshot gravado com o nome antigo, no dia da atualização, mantém a
    // cor da faixa em vez de cair no cinza.
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

    // PEDIDO DO USUÁRIO: mostrar em qual estágio (faixa de prioridade) está
    // o cliente que você está cobrando AGORA -- cruza o CNPJ da página
    // atual com o snapshot do dia (não a fila ao vivo: esse cliente pode já
    // ter sido removido dela por movimentação hoje, mesmo estando na tela).
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

  // PEDIDO DO USUÁRIO: mostrar o estágio (faixa de prioridade) do cliente
  // que está sendo cobrado agora -- uma linha de destaque logo no topo,
  // antes do resumo geral, pra responder de cara "onde eu estou".
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
      // Destaca a faixa do cliente atual, sem precisar repetir o nome dela
      // duas vezes na tela -- só um indício visual a mais.
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
   * "USAR A FILA ATUAL" (pedido do usuário, v1.43.0): a referência do
   * progresso é a PRIMEIRA fila do dia e nunca muda sozinha. Se ela saiu
   * errada (lista filtrada, por exemplo), este botão troca pela fila que
   * está valendo agora -- sem perder quem já foi cobrado (Módulo 7,
   * usarFilaAtualComoReferencia). Só aparece com fila por prioridade.
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
   * O gatilho: quase invisível em repouso, evidente ao passar o mouse ou
   * focar por teclado (Tab). É um <button> de verdade -- Enter/Espaço
   * ativam sozinhos, sem precisar reimplementar navegação por teclado.
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
