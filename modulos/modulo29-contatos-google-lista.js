/* =========================================================================
 * MÓDULO 29: CONTATOS DO GOOGLE NA LISTA DE CLIENTES (botão) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (02/10/2026): em vez de entrar cliente por cliente, um botão na lista
 * de clientes com a relação dos contatos do Google que são DIFERENTES do que está no
 * "Responsável financeiro" do CRM, comparando também a razão social, com interruptores
 * Nome e Celular para escolher o que comparar.
 *
 * Como funciona (o Módulo 28 guarda os contatos e sabe comparar; este só monta a lista):
 *   1. A lista de clientes (window.CLIENTES) traz CNPJ, razão social e o "Controle" de cada
 *      cliente, mas NÃO o responsável (confirmado no diagnóstico do usuário). Para cada cliente
 *      que tem contato na raiz do CNPJ, este módulo baixa a página do cliente por fetch (sem
 *      abrir aba, ~100 a 250 ms cada, 4 por vez) e lê `__RESPONSAVEL__ = { nome, celular }`
 *      (Módulo 28, lerResponsavelDoHtml). Quem não tem contato não é baixado.
 *   2. Para cada contato, compara com o CRM (nome e/ou celular, conforme os interruptores) e
 *      mostra só as DIFERENÇAS, com a confiança do casamento: raiz do CNPJ + razão social
 *      (a razão do cliente e o nome fantasia contra a razão guardada no contato).
 *   3. "Abrir cliente" abre a página dele em outra aba; lá o aviso do Módulo 28 oferece o
 *      "Preencher" (o usuário confere e salva; o CRM grava). Nada é gravado em lote.
 *
 * Erro nunca passa em silêncio: página que não deu para baixar ou ler vira "sem leitura" na
 * contagem e na lista (com "Abrir cliente"). Nada de dado de cliente vai para o console.
 *
 * ONDE COLAR: depois do Módulo 28 (e do 3, que dá a barra de filtros da lista) e ANTES do 4.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__contatosGoogleListaCarregado) return;
  window.__contatosGoogleListaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Contatos do Google: Lista');

  const CONFIG_LISTA = {
    ID_BOTAO: 'smarttable-contatos-google-lista-botao',
    ID_PAINEL: 'smarttable-contatos-google-lista-painel',
    // Páginas de cliente baixadas ao mesmo tempo.
    SIMULTANEAS: 4,
    TIMEOUT_PAGINA_MS: 15000,
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    destaque: '#1B6B4A',
    erro: '#B42318',
    aviso: '#B54708',
    fundo: '#ffffff',
  };

  const util = () => window.__smartTableUtil;
  const G = () => window.__contatosGoogle;

  let painelEl = null;
  let controlador = null;

  const naListaDeClientes = () => /^\/crm\/clientes\/?$/.test(window.location.pathname);

  /** Endereço da página do cliente (o N de /grupo/N é o `controleCliente`, confirmado no Alt+B). */
  function enderecoDoCliente(c) {
    if (c?.controleCliente == null || !c?.cnpj) return null;
    return `/crm/clientes/grupo/${encodeURIComponent(c.controleCliente)}?cnpj=${encodeURIComponent(c.cnpj)}`;
  }

  /**
   * Baixa a página do cliente e lê o responsável.
   * @returns {Promise<{crm: {nome: string, celular: string}} | {erro: 'rede'|'http'|'sem-variavel'|'formato'|'sem-endereco'}>}
   */
  async function lerPaginaDoCliente(c, sinalDeFora) {
    const endereco = enderecoDoCliente(c);
    if (!endereco) return { erro: 'sem-endereco' };
    const ctl = new window.AbortController();
    const aoCancelar = () => ctl.abort();
    sinalDeFora?.addEventListener?.('abort', aoCancelar);
    const relogio = setTimeout(() => ctl.abort(), CONFIG_LISTA.TIMEOUT_PAGINA_MS);
    try {
      const r = await window.fetch(endereco, { credentials: 'same-origin', signal: ctl.signal });
      if (!r.ok) return { erro: 'http' };
      const lido = G().lerResponsavelDoHtml(await r.text());
      return lido.erro ? { erro: lido.erro } : { crm: lido };
    } catch {
      return { erro: 'rede' };
    } finally {
      clearTimeout(relogio);
      sinalDeFora?.removeEventListener?.('abort', aoCancelar);
    }
  }

  /**
   * Junta a lista de clientes aos contatos guardados e baixa o responsável de quem tem contato.
   * @param {{aoProgresso?: (feitos: number, total: number) => void, sinal?: AbortSignal}} [opcoes]
   * @returns {Promise<{semContatos: boolean, totalNaLista: number, candidatos: Array<{cliente: object, itens: object[], crm: object|null, erro: string|null}>}>}
   */
  async function levantar({ aoProgresso, sinal } = {}) {
    const lista = Array.isArray(window.CLIENTES) ? window.CLIENTES : [];
    const meta = G().lerMeta();
    if (!meta) return { semContatos: true, totalNaLista: lista.length, candidatos: [] };
    const candidatos = [];
    for (const cliente of lista) {
      const itens = await G().buscarPorRaiz(G().raizDoCnpj(cliente.cnpj));
      if (itens.length > 0) candidatos.push({ cliente, itens, crm: null, erro: null });
    }
    aoProgresso?.(0, candidatos.length);
    let proximo = 0;
    let feitos = 0;
    const trabalhador = async () => {
      while (proximo < candidatos.length && !sinal?.aborted) {
        const alvo = candidatos[proximo++];
        const r = await lerPaginaDoCliente(alvo.cliente, sinal);
        if (r.crm) alvo.crm = r.crm; else alvo.erro = r.erro;
        feitos += 1;
        aoProgresso?.(feitos, candidatos.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONFIG_LISTA.SIMULTANEAS, candidatos.length) }, trabalhador));
    return { semContatos: false, totalNaLista: lista.length, candidatos };
  }

  /**
   * As linhas da tela: um par cliente x contato por diferença, conforme o modo (Nome / Celular).
   * `confere`: a razão do contato bate com a razão social ou o nome fantasia do cliente? (true / false / null = sem como dizer)
   */
  function calcularLinhas(levantamento, modo = G().lerModo()) {
    const linhas = [];
    const semLeitura = [];
    let iguais = 0;
    levantamento.candidatos.forEach((cand) => {
      if (!cand.crm) { semLeitura.push(cand); return; }
      const antes = linhas.length;
      cand.itens.forEach((item) => {
        const novidades = G().novidadesDoContato(item, cand.crm, modo);
        if (!novidades.nome && !novidades.celular) return;
        linhas.push({
          cliente: cand.cliente, item, crm: cand.crm, novidades,
          confere: G().razaoConfere(item.razao, cand.cliente.razaoSocial, cand.cliente.nomeFantasia),
        });
      });
      if (linhas.length === antes) iguais += 1;
    });
    // "Razão diferente" por último: é o que mais precisa de olho.
    const peso = (l) => (l.confere === false ? 2 : l.confere === null ? 1 : 0);
    linhas.sort((a, b) => peso(a) - peso(b) || String(a.cliente.razaoSocial).localeCompare(String(b.cliente.razaoSocial), 'pt-BR'));
    return {
      linhas, semLeitura, iguais,
      resumo: {
        totalNaLista: levantamento.totalNaLista,
        comContato: levantamento.candidatos.length,
        comDiferenca: new Set(linhas.map((l) => l.cliente)).size,
        iguais,
        semLeitura: semLeitura.length,
      },
    };
  }

  /* ---------------------------------------------------------------------
   * INTERFACE
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

  function criarLinkAbrir(cliente) {
    const endereco = enderecoDoCliente(cliente);
    if (!endereco) return criarDiv('sem endereço', { color: CORES.apagado, fontSize: '11.5px' });
    const a = document.createElement('a');
    a.href = endereco;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.acao = 'abrir-cliente';
    a.textContent = 'Abrir cliente';
    Object.assign(a.style, {
      display: 'inline-block', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${CORES.borda}`,
      color: CORES.tinta, fontSize: '12px', fontWeight: '600', textDecoration: 'none', whiteSpace: 'nowrap',
    });
    return a;
  }

  const ROTULO_CONFIANCA = {
    true: { texto: 'CNPJ e razão conferem', cor: CORES.destaque },
    false: { texto: 'Razão diferente: conferir', cor: CORES.aviso },
    null: { texto: 'Só o CNPJ (sem razão para comparar)', cor: CORES.apagado },
  };

  function textoDoCrm(crm) {
    return `${crm.nome.trim() || 'sem nome'} · ${crm.celular.trim() || 'sem celular'}`;
  }

  function desenharLinha(l) {
    const cel = l.item.celulares.map((c) => G().formatarCelular(c)).join(' · ');
    const linha = criarDiv('', {
      display: 'grid', gridTemplateColumns: 'minmax(150px,1.3fr) minmax(150px,1.2fr) minmax(150px,1.2fr) minmax(130px,.9fr) auto',
      gap: '10px', alignItems: 'center', padding: '8px 2px', borderBottom: `1px solid ${CORES.linha}`,
    });
    linha.dataset.papel = 'linha';
    const cliente = criarDiv('', {});
    cliente.appendChild(criarDiv(l.cliente.razaoSocial || '(sem razão social)', { color: CORES.tinta, fontWeight: '700', fontSize: '12.5px' }));
    const etiquetas = [l.novidades.nome ? 'nome' : null, l.novidades.celular ? 'celular' : null].filter(Boolean).join(' e ');
    cliente.appendChild(criarDiv('Difere: ' + etiquetas, { color: CORES.aviso, fontSize: '11.5px' }));
    linha.appendChild(cliente);
    linha.appendChild(criarDiv('No CRM: ' + textoDoCrm(l.crm), { color: CORES.texto, fontSize: '12px' }));
    linha.appendChild(criarDiv(`No Google: ${l.item.nome || '(sem nome)'}${cel ? ' · ' + cel : ''}`, { color: CORES.texto, fontSize: '12px' }));
    const conf = ROTULO_CONFIANCA[String(l.confere)];
    linha.appendChild(criarDiv(conf.texto, { color: conf.cor, fontSize: '11.5px', fontWeight: '600' }));
    linha.appendChild(criarLinkAbrir(l.cliente));
    return linha;
  }

  const MENSAGEM_ERRO = {
    http: 'o CRM recusou a página (sessão expirada?)',
    rede: 'a página não carregou',
    'sem-variavel': 'a página não trouxe o responsável',
    formato: 'o responsável veio num formato desconhecido',
    'sem-endereco': 'o cliente não tem endereço na lista',
  };

  function desenharResultado(destino, calculo) {
    destino.textContent = '';
    const r = calculo.resumo;
    destino.appendChild(criarDiv(
      `${r.totalNaLista} cliente(s) na lista · ${r.comContato} com contato no Google · ${r.comDiferenca} com diferença · ${r.iguais} já iguais · ${r.semLeitura} sem leitura`,
      { color: CORES.texto, fontSize: '12.5px', margin: '4px 0 8px', fontWeight: '600' },
    )).dataset.papel = 'resumo';
    if (calculo.linhas.length === 0) {
      destino.appendChild(criarDiv('Nenhuma diferença encontrada para o que está ligado (Nome / Celular).', { color: CORES.destaque, margin: '8px 0' })).dataset.papel = 'vazio';
    }
    const lista = criarDiv('', { borderTop: `1px solid ${CORES.linha}` });
    lista.dataset.papel = 'diferencas';
    calculo.linhas.forEach((l) => lista.appendChild(desenharLinha(l)));
    destino.appendChild(lista);
    if (calculo.semLeitura.length > 0) {
      const caixa = criarDiv('', { marginTop: '10px' });
      caixa.dataset.papel = 'sem-leitura';
      caixa.appendChild(criarDiv(`Não consegui ler o responsável de ${calculo.semLeitura.length} cliente(s) (não entram na comparação):`, { color: CORES.erro, fontSize: '12px', fontWeight: '600', marginBottom: '4px' }));
      calculo.semLeitura.forEach((c) => {
        const linha = criarDiv('', { display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px', borderBottom: `1px solid ${CORES.linha}` });
        linha.appendChild(criarDiv(`${c.cliente.razaoSocial || '(sem razão social)'}: ${MENSAGEM_ERRO[c.erro] ?? 'erro'}`, { color: CORES.texto, fontSize: '12px' }));
        linha.appendChild(criarLinkAbrir(c.cliente));
        caixa.appendChild(linha);
      });
      destino.appendChild(caixa);
    }
  }

  function fecharPainel() {
    // Cancela os pedidos em andamento. O que ainda chegar só mexe nos elementos do painel antigo, já fora da tela.
    controlador?.abort();
    controlador = null;
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  async function abrirPainel() {
    if (!G()) {
      util()?.toast?.('Contatos do Google não carregou (veja o console).');
      return;
    }
    util()?.fecharOutrosPaineis?.('contatosGoogleLista');
    fecharPainel();
    controlador = new window.AbortController();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_LISTA.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed', bottom: '112px', left: '16px', background: CORES.fundo, border: `1px solid ${CORES.borda}`,
      borderRadius: '10px', padding: '14px 16px', boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px', zIndex: CONFIG_LISTA.Z_INDEX_POPUP,
      width: '920px', maxWidth: '92vw', maxHeight: '75vh', overflowY: 'auto', boxSizing: 'border-box',
    });
    painelEl.appendChild(criarDiv('Contatos do Google: diferenças do responsável', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    painelEl.appendChild(criarDiv('Clientes desta lista cujo contato do Google difere do "Responsável financeiro" do CRM. "Abrir cliente" abre a página dele, onde você confere e salva.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 8px',
    }));

    let levantamento = null;
    const resultado = criarDiv('');
    resultado.dataset.papel = 'resultado';
    const recalcular = () => { if (levantamento) desenharResultado(resultado, calcularLinhas(levantamento)); };
    painelEl.appendChild(G().criarInterruptoresDoModo(recalcular));
    const andamento = criarDiv('Lendo...', { color: CORES.texto, fontSize: '12px', margin: '4px 0' });
    andamento.dataset.papel = 'andamento';
    painelEl.appendChild(andamento);
    painelEl.appendChild(resultado);
    const rodape = criarDiv('', { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' });
    const fechar = criarBotao('Fechar', 'fechar', true);
    fechar.addEventListener('click', fecharPainel);
    rodape.appendChild(fechar);
    painelEl.appendChild(rodape);
    painelEl.appendChild(criarDiv('Esc para fechar', { color: CORES.apagado, fontSize: '11px', textAlign: 'center', marginTop: '6px' }));
    document.body.appendChild(painelEl);
    util()?.acompanharMenuLateral?.(painelEl);

    try {
      levantamento = await levantar({
        sinal: controlador.signal,
        aoProgresso: (feitos, total) => {
          andamento.textContent = `Lendo o responsável no CRM: ${feitos} de ${total} cliente(s) com contato...`;
        },
      });
    } catch {
      andamento.style.color = CORES.erro;
      andamento.textContent = 'Não consegui ler os contatos guardados neste navegador (abra o Alt+J e importe de novo).';
      return;
    }
    if (levantamento.semContatos) {
      andamento.style.color = CORES.aviso;
      andamento.textContent = 'Nenhum contato guardado: importe o CSV do Google Contatos no Alt+J.';
      return;
    }
    if (levantamento.totalNaLista === 0) {
      andamento.style.color = CORES.aviso;
      andamento.textContent = 'A lista de clientes está vazia.';
      return;
    }
    andamento.textContent = '';
    desenharResultado(resultado, calcularLinhas(levantamento));
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return Promise.resolve();
    }
    return abrirPainel();
  }

  function criarBotaoDaLista() {
    if (document.getElementById(CONFIG_LISTA.ID_BOTAO)) return;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.id = CONFIG_LISTA.ID_BOTAO;
    botao.textContent = '📇 Contatos do Google';
    Object.assign(botao.style, { border: `1px solid ${CORES.borda}`, cursor: 'pointer' });
    botao.addEventListener('click', alternarPainel);
    // Mesma barra e classe nativa dos botões do Módulo 3 e do Módulo 15.
    const ancora = window.filaDebug?.ancoraToolbarLista?.() ?? null;
    if (ancora) {
      botao.className = 'pbi-btn pbi-btn-quiet';
      ancora.appendChild(botao);
    } else {
      Object.assign(botao.style, {
        position: 'fixed', bottom: '156px', left: '16px', zIndex: 999997, padding: '10px 16px', borderRadius: '8px',
        fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 2px 10px rgba(0,0,0,0.15)', background: '#fff',
      });
      document.body.appendChild(botao);
      util()?.acompanharMenuLateral?.(botao);
    }
  }

  let iniciou = false;
  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    if (naListaDeClientes()) criarBotaoDaLista();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  // Esc fecha. Registrado uma vez só: um listener por abertura vazaria.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  util()?.registrarPainel?.('contatosGoogleLista', fecharPainel);

  window.__contatosGoogleLista = {
    enderecoDoCliente,
    lerPaginaDoCliente,
    levantar,
    calcularLinhas,
    criarBotaoDaLista,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    estaAberto: () => painelEl !== null,
    CONFIG_LISTA,
  };
})();
