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
 *   3. Cada linha tem botões "Adicionar/Trocar nome", "Adicionar/Trocar número" e "ambos": ao clicar,
 *      o SmartTable GRAVA o responsável no CRM (PUT /api/crm/cliente-responsavel, como a própria página
 *      do cliente faz) sem abrir o cliente. É a única escrita do módulo, só com clique explícito, uma
 *      linha por vez, e com estas proteções:
 *        - relê a página do cliente imediatamente antes e RECUSA se o CRM mudou desde a leitura;
 *        - "Adicionar" só onde o campo do CRM está vazio; onde há outro valor o botão diz "Trocar" e
 *          pede um segundo clique, mostrando "de" e "para";
 *        - colocar um celular sob um NOME DIFERENTE (o celular é o do WhatsApp) também pede confirmação;
 *        - depois de gravar, relê a página para CONFERIR e mostra "Gravado" ou o aviso do que o CRM tem;
 *        - cada gravação fica numa lista "Gravados" com "Desfazer" (devolve o que havia, se o CRM não
 *          mudou depois).
 *      "Abrir cliente" continua em cada linha para quem prefere conferir no modal.
 *
 * Erro nunca passa em silêncio: página que não deu para baixar ou ler vira "sem leitura" na
 * contagem e na lista (com "Abrir cliente"); falha de gravação aparece na própria linha. Nada de
 * dado de cliente vai para o console.
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
    // O "Clique de novo para confirmar" volta ao normal depois disto.
    TEMPO_CONFIRMAR_MS: 6000,
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
  // Uma gravação por vez, mesmo se o painel for fechado e reaberto no meio: a flag só cai quando a gravação termina.
  let gravando = false;

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
    if (sinalDeFora?.aborted) ctl.abort(); // já cancelado antes de começar (o evento "abort" não repete)
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
   * GRAVAR NO CRM (Adicionar / Trocar / Desfazer)
   * --------------------------------------------------------------------- */

  const comPonto = (t) => String(t).replace(/[.!?]?\s*$/, '.');
  const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
  const textoDoCrm = (crm) => `${String(crm.nome ?? '').trim() || 'sem nome'} · ${String(crm.celular ?? '').trim() || 'sem celular'}`;
  const modoDaAcao = (acao) => ({ nome: acao !== 'celular', celular: acao !== 'nome' });
  /** Mesmo responsável? Nome sem acento/caixa/espaços sobrando (o CRM pode normalizar ao gravar) e celular pelos dígitos. */
  const mesmoCrm = (a, b) => (String(a.nome ?? '').trim() === String(b.nome ?? '').trim() || G().mesmoNome(a.nome, b.nome))
    && soDigitos(a.celular) === soDigitos(b.celular);

  /** Botões de uma linha: depende do que difere e de o campo do CRM estar vazio ("Adicionar") ou ter outro valor ("Trocar"). */
  function acoesDaLinha(l) {
    const verboNome = String(l.crm.nome ?? '').trim() ? 'Trocar' : 'Adicionar';
    const verboCelular = String(l.crm.celular ?? '').trim() ? 'Trocar' : 'Adicionar';
    const acoes = [];
    if (l.novidades.nome) acoes.push({ acao: 'nome', rotulo: `${verboNome} nome` });
    if (l.novidades.celular) acoes.push({ acao: 'celular', rotulo: `${verboCelular} número` });
    if (l.novidades.nome && l.novidades.celular) {
      acoes.push({ acao: 'ambos', rotulo: verboNome === 'Adicionar' && verboCelular === 'Adicionar' ? 'Adicionar ambos' : 'Trocar ambos' });
    }
    return acoes;
  }

  /**
   * O que a ação exigiria: nada, ou uma confirmação (um segundo clique).
   *   'trocar'     = há valor diferente no CRM que seria substituído;
   *   'outro-nome' = o celular entraria sob um nome diferente do do contato.
   * @returns {{modo: {nome: boolean, celular: boolean}, precisa: null|'trocar'|'outro-nome'}}
   */
  function planejarAcao(l, acao, celular) {
    const modo = modoDaAcao(acao);
    const sem = G().decidirPreenchimento(l.item, celular, l.crm.nome ?? '', l.crm.celular ?? '', false, modo);
    // "Ambos" troca o nome junto com o celular: não mistura pessoas, é uma troca (confirmação de "trocar", com de → para).
    if (sem.motivo === 'outro-nome' && !modo.nome) return { modo, precisa: 'outro-nome' };
    const com = G().decidirPreenchimento(l.item, celular, l.crm.nome ?? '', l.crm.celular ?? '', true, modo);
    return { modo, precisa: sem.nome !== com.nome || sem.celular !== com.celular ? 'trocar' : null };
  }

  /** Texto da confirmação: o que muda de verdade (de → para), inclusive o celular que seria substituído. */
  function textoDaConfirmacao(l, plano, celular) {
    const decisao = G().decidirPreenchimento(l.item, celular, l.crm.nome ?? '', l.crm.celular ?? '', true, plano.modo);
    const celularAntigo = String(l.crm.celular ?? '').trim();
    const trocaCelular = decisao.celular && celularAntigo ? ` (troca o celular "${celularAntigo}" por "${G().formatarCelular(celular)}")` : '';
    if (plano.precisa === 'outro-nome') {
      return `O CRM tem outro responsável (${String(l.crm.nome).trim()}). Colocar o celular de ${l.item.nome} sob esse nome${trocaCelular}? Clique de novo para confirmar.`;
    }
    const partes = [];
    if (decisao.nome) partes.push(`nome "${String(l.crm.nome).trim() || 'vazio'}" → "${l.item.nome}"`);
    if (decisao.celular) partes.push(`celular "${celularAntigo || 'vazio'}" → "${G().formatarCelular(celular)}"`);
    return `Trocar no CRM: ${partes.join(' e ')}. Clique de novo para confirmar.`;
  }

  /**
   * Depois de mandar o PUT, o que fazer com a resposta e com a releitura da página. Serve à gravação e ao "Desfazer".
   * `r` é a resposta de gravarResponsavelNoCrm; `esperado` o que a página deve mostrar; `anterior` o que havia antes.
   * As leituras daqui NÃO usam o sinal do painel: fechar o painel não pode cortar a conferência de um PUT já enviado.
   * @returns {Promise<{ok: true, conferido: object, viaConferencia: boolean} | {ok: false, tipo: string, texto: string}>}
   */
  async function conferirDepoisDoPut(l, cand, r, esperado, anterior, verbo) {
    if (r.erro && !r.incerto) return { ok: false, tipo: 'erro', texto: `${comPonto(r.erro)} Nada foi ${verbo}.` };
    const conferido = await lerPaginaDoCliente(l.cliente);
    if (!conferido.crm) {
      const motivo = MENSAGEM_ERRO[conferido.erro] ?? 'erro';
      return {
        ok: false, tipo: 'aviso',
        texto: r.erro
          ? `${comPonto(r.erro)} E não consegui reler a página para saber se o CRM gravou (${motivo}). Abra o cliente e confira.`
          : `O CRM aceitou, mas não consegui reler a página para conferir (${motivo}). Abra o cliente e confira.`,
      };
    }
    cand.crm = conferido.crm;
    // Resposta incerta e o valor novo é "o mesmo" que o antigo para a comparação (só caixa/acento/formato): a releitura
    // não prova nada, então não dá para dizer que gravou nem que não gravou.
    if (r.erro && mesmoCrm(esperado, anterior)) {
      return { ok: false, tipo: 'aviso', texto: `${comPonto(r.erro)} Não dá para saber se o CRM gravou (o valor novo só difere em maiúsculas, acento ou formato). Abra o cliente e confira.` };
    }
    if (mesmoCrm(conferido.crm, esperado)) return { ok: true, conferido: conferido.crm, viaConferencia: Boolean(r.erro) };
    if (r.erro && mesmoCrm(conferido.crm, anterior)) {
      return { ok: false, tipo: 'erro', texto: `${comPonto(r.erro)} Conferi relendo a página: o CRM não gravou.` };
    }
    const mostra = `página mostra: ${textoDoCrm(conferido.crm)}. Abra o cliente e confira.`;
    return { ok: false, tipo: 'aviso', texto: r.erro ? `${comPonto(r.erro)} A ${mostra}` : `O CRM respondeu, mas a ${mostra}` };
  }

  /**
   * Grava uma linha (um contato de um cliente). Devolve { ok: true, ... } ou { ok: false, tipo, texto } para a própria linha.
   * `confirmado`: o usuário já deu o segundo clique (permite trocar valor existente e celular sob outro nome).
   * `estado.feitos` recebe a gravação (para o "Desfazer"); o responsável lido de novo vai para `cand.crm`.
   */
  async function gravarLinha(estado, l, acao, celular, confirmado, sinal) {
    const cand = estado.levantamento.candidatos.find((c) => c.cliente === l.cliente);
    // Ainda nada foi enviado: esta leitura pode ser cancelada pelo painel.
    const fresco = await lerPaginaDoCliente(l.cliente, sinal);
    if (!fresco.crm) return { ok: false, tipo: 'erro', texto: `Não consegui reler o responsável antes de gravar (${MENSAGEM_ERRO[fresco.erro] ?? 'erro'}). Nada foi gravado.` };
    if (!mesmoCrm(fresco.crm, l.crm)) {
      cand.crm = fresco.crm;
      return { ok: false, tipo: 'aviso', texto: `O CRM mudou desde a leitura (agora: ${textoDoCrm(fresco.crm)}). A linha foi atualizada: confira e clique de novo. Nada foi gravado.` };
    }
    const decisao = G().decidirPreenchimento(l.item, celular, fresco.crm.nome ?? '', fresco.crm.celular ?? '', confirmado, modoDaAcao(acao));
    if (decisao.motivo) return { ok: false, tipo: 'aviso', texto: 'Nada a gravar com o que está ligado (o CRM já tem esses valores ou falta confirmar).' };
    const antes = { nome: String(fresco.crm.nome ?? ''), celular: String(fresco.crm.celular ?? '') };
    const enviar = {
      nome: decisao.nome ? l.item.nome : antes.nome,
      celular: decisao.celular ? G().formatarCelular(celular) : antes.celular,
    };
    const r = await G().gravarResponsavelNoCrm(l.cliente.cnpj, enviar.nome, enviar.celular);
    const c = await conferirDepoisDoPut(l, cand, r, enviar, antes, 'alterado');
    if (!c.ok) return c;
    estado.feitos.push({ cliente: l.cliente, item: l.item, cand, antes, depois: enviar });
    return { ok: true, tipo: 'ok', texto: c.viaConferencia ? `Gravado (a resposta do CRM falhou, mas a página mostra os valores): ${textoDoCrm(enviar)}.` : `Gravado: ${textoDoCrm(enviar)}.` };
  }

  /** Devolve o que o CRM tinha antes, se ele ainda está como ficou depois da gravação. */
  async function desfazerGravacao(estado, entrada, sinal) {
    const fresco = await lerPaginaDoCliente(entrada.cliente, sinal);
    if (!fresco.crm) return { ok: false, tipo: 'erro', texto: `Não consegui reler o responsável (${MENSAGEM_ERRO[fresco.erro] ?? 'erro'}). Nada foi desfeito.` };
    if (!mesmoCrm(fresco.crm, entrada.depois)) {
      entrada.cand.crm = fresco.crm;
      return { ok: false, tipo: 'aviso', texto: `O CRM mudou depois da gravação (agora: ${textoDoCrm(fresco.crm)}). Não desfiz para não apagar uma alteração nova.` };
    }
    const r = await G().gravarResponsavelNoCrm(entrada.cliente.cnpj, entrada.antes.nome, entrada.antes.celular);
    const c = await conferirDepoisDoPut({ cliente: entrada.cliente }, entrada.cand, r, entrada.antes, entrada.depois, 'desfeito');
    if (!c.ok) return c;
    estado.feitos.splice(estado.feitos.indexOf(entrada), 1);
    return { ok: true, tipo: 'ok', texto: `Desfeito: ${textoDoCrm(entrada.antes)}.` };
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

  const MENSAGEM_ERRO = {
    http: 'o CRM recusou a página (sessão expirada?)',
    rede: 'a página não carregou',
    'sem-variavel': 'a página não trouxe o responsável',
    formato: 'o responsável veio num formato desconhecido',
    'sem-endereco': 'o cliente não tem endereço na lista',
  };

  const COR_DA_MENSAGEM = { ok: CORES.destaque, aviso: CORES.aviso, erro: CORES.erro };

  function criarMensagem(msg) {
    const m = criarDiv(msg.texto, { gridColumn: '1 / -1', color: COR_DA_MENSAGEM[msg.tipo], fontSize: '12px', fontWeight: '600' });
    m.dataset.papel = 'mensagem';
    return m;
  }

  /** O painel que este estado desenhou ainda é o painel na tela? (Fechar e reabrir cria um painel e um estado novos.) */
  const painelDoEstadoAberto = (estado) => painelEl !== null && painelEl === estado.painel;

  /** Cancela a confirmação armada (e a mensagem dela) e o relógio que a faria expirar. */
  function desarmar(estado) {
    clearTimeout(estado.relogioDaConfirmacao);
    if (estado.armado) estado.mensagens.delete(estado.armado.item);
    estado.armado = null;
  }

  /** Os botões de uma linha: Adicionar/Trocar nome, número, ambos, e "Abrir cliente". */
  function criarAcoes(l, estado) {
    const caixa = criarDiv('', { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch', minWidth: '150px' });
    // O número escolhido sobrevive aos redesenhos (cada clique redesenha a lista): fica guardado por contato.
    const escolhido = estado.escolhidos.get(l.item) ?? l.item.celulares[0] ?? null;
    if (l.novidades.celular && l.item.celulares.length > 1) {
      const seletor = document.createElement('select');
      seletor.dataset.campo = 'celular-escolhido';
      Object.assign(seletor.style, { fontSize: '11.5px', padding: '2px', border: `1px solid ${CORES.borda}`, borderRadius: '4px' });
      l.item.celulares.forEach((c) => {
        const op = document.createElement('option');
        op.value = c;
        op.textContent = G().formatarCelular(c);
        seletor.appendChild(op);
      });
      seletor.value = escolhido;
      seletor.disabled = gravando;
      seletor.addEventListener('change', () => {
        estado.escolhidos.set(l.item, seletor.value);
        // Outro número: a confirmação que o usuário viu era do número anterior.
        if (estado.armado && estado.armado.item === l.item) { desarmar(estado); estado.redesenhar(); }
      });
      caixa.appendChild(seletor);
    }
    acoesDaLinha(l).forEach(({ acao, rotulo }) => {
      const armado = Boolean(estado.armado) && estado.armado.item === l.item && estado.armado.acao === acao;
      const b = criarBotao(armado ? 'Confirmar' : rotulo, `acao-${acao}`, acao === 'ambos' || armado);
      if (armado) b.style.background = CORES.erro;
      b.disabled = gravando;
      if (gravando) b.style.opacity = '0.5';
      b.addEventListener('click', () => aoClicarAcao(estado, l, acao));
      caixa.appendChild(b);
    });
    caixa.appendChild(criarLinkAbrir(l.cliente));
    return caixa;
  }

  function desenharLinha(l, estado) {
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
    linha.appendChild(criarAcoes(l, estado));
    const msg = estado.mensagens.get(l.item);
    if (msg) linha.appendChild(criarMensagem(msg));
    return linha;
  }

  /** Termina uma gravação: solta a trava, mostra o resultado (na linha ou, com o painel fechado, num aviso). */
  function terminarGravacao(estado, item, r) {
    gravando = false;
    estado.mensagens.set(item, { tipo: r.tipo, texto: r.texto });
    if (painelDoEstadoAberto(estado)) estado.redesenhar();
    else util()?.toast?.(r.texto, 9000); // o painel foi fechado (ou fechado e reaberto) no meio: o resultado não pode se perder
  }

  /** Clique num botão da linha: pede confirmação quando precisa; senão grava. */
  async function aoClicarAcao(estado, l, acao) {
    if (gravando) return;
    const celular = estado.escolhidos.get(l.item) ?? l.item.celulares[0] ?? null;
    // A confirmação vale para ESTE contato e esta ação (trocar o número escolhido também a cancela); qualquer outro clique a cancela.
    const jaArmado = Boolean(estado.armado) && estado.armado.item === l.item && estado.armado.acao === acao;
    if (estado.armado && !jaArmado) desarmar(estado);
    const plano = planejarAcao(l, acao, celular);
    if (plano.precisa && !jaArmado) {
      estado.armado = { item: l.item, acao };
      estado.mensagens.set(l.item, { tipo: 'aviso', texto: textoDaConfirmacao(l, plano, celular) });
      // Um clique casual depois não pode gravar: a confirmação expira.
      estado.relogioDaConfirmacao = setTimeout(() => {
        if (estado.armado && estado.armado.item === l.item) {
          desarmar(estado);
          if (painelDoEstadoAberto(estado)) estado.redesenhar();
        }
      }, CONFIG_LISTA.TEMPO_CONFIRMAR_MS);
      estado.redesenhar();
      return;
    }
    desarmar(estado); // solta o relógio da confirmação também (a mensagem é trocada logo abaixo)
    gravando = true;
    estado.mensagens.set(l.item, { tipo: 'aviso', texto: 'Gravando...' });
    estado.redesenhar();
    let r;
    try {
      r = await gravarLinha(estado, l, acao, celular, Boolean(plano.precisa), controlador?.signal);
    } catch {
      r = { ok: false, tipo: 'erro', texto: 'Erro inesperado ao gravar. Abra o cliente e confira.' };
    }
    terminarGravacao(estado, l.item, r);
  }

  async function aoClicarDesfazer(estado, entrada) {
    if (gravando) return;
    desarmar(estado); // o CRM vai mudar: a confirmação armada mostraria um de → para defasado
    gravando = true;
    estado.mensagens.set(entrada.item, { tipo: 'aviso', texto: 'Desfazendo...' });
    estado.redesenhar();
    let r;
    try {
      r = await desfazerGravacao(estado, entrada, controlador?.signal);
    } catch {
      r = { ok: false, tipo: 'erro', texto: 'Erro inesperado ao desfazer. Abra o cliente e confira.' };
    }
    terminarGravacao(estado, entrada.item, r);
  }

  function desenharResultado(destino, calculo, estado) {
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
    calculo.linhas.forEach((l) => lista.appendChild(desenharLinha(l, estado)));
    destino.appendChild(lista);

    if (estado.feitos.length > 0) {
      const caixa = criarDiv('', { marginTop: '12px' });
      caixa.dataset.papel = 'gravados';
      caixa.appendChild(criarDiv(`Gravados nesta abertura (${estado.feitos.length}):`, { color: CORES.destaque, fontSize: '12px', fontWeight: '600', marginBottom: '4px' }));
      estado.feitos.forEach((entrada) => {
        const linha = criarDiv('', { display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', padding: '5px 2px', borderBottom: `1px solid ${CORES.linha}` });
        linha.dataset.papel = 'gravado';
        const texto = criarDiv('', { fontSize: '12px', color: CORES.texto });
        texto.appendChild(criarDiv(entrada.cliente.razaoSocial || '(sem razão social)', { color: CORES.tinta, fontWeight: '700' }));
        texto.appendChild(criarDiv(`Agora: ${textoDoCrm(entrada.depois)} · Antes: ${textoDoCrm(entrada.antes)}`, {}));
        linha.appendChild(texto);
        const desfazer = criarBotao('Desfazer', 'desfazer', false);
        desfazer.disabled = gravando;
        desfazer.addEventListener('click', () => aoClicarDesfazer(estado, entrada));
        linha.appendChild(desfazer);
        const msg = estado.mensagens.get(entrada.item);
        if (msg) linha.appendChild(criarMensagem(msg));
        caixa.appendChild(linha);
      });
      destino.appendChild(caixa);
    }

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
    painelEl.appendChild(criarDiv('Clientes desta lista cujo contato do Google difere do "Responsável financeiro" do CRM. Os botões gravam no CRM, um cliente por vez: o celular é o número que o CRM usa para abrir o WhatsApp. "Abrir cliente" abre a página dele para conferir no modal.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 8px',
    }));

    const estado = { painel: painelEl, levantamento: null, feitos: [], mensagens: new Map(), escolhidos: new Map(), armado: null, relogioDaConfirmacao: null, redesenhar: () => {} };
    const resultado = criarDiv('');
    resultado.dataset.papel = 'resultado';
    const recalcular = () => { if (estado.levantamento) desenharResultado(resultado, calcularLinhas(estado.levantamento), estado); };
    estado.redesenhar = recalcular;
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

    let levantamento = null;
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
    estado.levantamento = levantamento;
    recalcular();
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
    acoesDaLinha,
    planejarAcao,
    conferirDepoisDoPut,
    gravarLinha,
    desfazerGravacao,
    criarBotaoDaLista,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    estaAberto: () => painelEl !== null,
    CONFIG_LISTA,
  };
})();
