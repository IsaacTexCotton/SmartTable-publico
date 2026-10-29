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
 *        - "Adicionar" só onde o campo do CRM está vazio; onde há outro valor o botão diz "Trocar";
 *        - os botões que mexem no NOME (nome e ambos) abrem um editor na própria linha, com o nome do
 *          Google já preenchido: o usuário pode alterá-lo e "Gravar" (Enter) ou "Cancelar" (Esc). A linha
 *          "Vai gravar no CRM: ... de → para ..." acompanha o que se digita e o "Gravar" é a confirmação
 *          (não há segundo clique). O nome editado vale só para esta gravação: o contato do Google e o
 *          que foi importado não mudam. Os botões de número seguem sem editor: o "Trocar número" pede
 *          um segundo clique, mostrando "de" e "para";
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
  // O campo "Nome do responsável" do CRM aceita no máximo isto (maxlength confirmado no diagnóstico): o mesmo limite do Módulo 28.
  const maxNome = () => G()?.CONFIG_CONTATOS?.MAX_NOME ?? 150;
  const CSV_MOTIVO_AUSENTE = 'ausente';
  const CSV_MOTIVO_PADRONIZACAO = 'padronizacao';

  /** Mantém a mesma regra de nome usada pelo CSV e pela sincronização direta CRM → Google. */
  function nomePadronizadoDoCliente(cliente, crm, ufContato = '') {
    const raiz = G().raizDoCnpj(cliente.cnpj);
    const grupo = Number(cliente.controleCliente) > 0 ? 'GP ' + cliente.controleCliente : '';
    const uf = String(cliente.uf || cliente.estado || ufContato || '').trim().toLocaleUpperCase('pt-BR');
    const razao = cliente.razaoSocial || cliente.nomeFantasia || '';
    const responsavel = String(crm?.nome ?? '').replace(/\s+/g, ' ').trim();
    const dados = { razao, raiz, uf, grupo: uf ? grupo : '', responsavel: uf ? responsavel : '' };
    return window.__nomeContatoPadronizado?.montarNome?.(dados)
      || [String(razao).trim(), raiz, uf, uf ? grupo : '', uf ? responsavel : ''].filter(Boolean).join(' - ');
  }

  function celularPadronizadoDoCrm(crm) {
    const celular = G().normalizarCelular(crm?.celular);
    return celular ? G().formatarCelular(celular) : '';
  }

  function celularParaExibicaoDoCrm(crm) {
    const bruto = String(crm?.celular ?? '').trim();
    const celular = G().normalizarCelular(bruto);
    return celular ? G().formatarCelular(celular) : bruto;
  }

  let painelEl = null;
  // O estado do painel aberto (o Esc, registrado uma vez no document, precisa saber se há editor aberto).
  let estadoDoPainel = null;
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
   * Confere todos os clientes da lista contra os contatos guardados e lê o responsável financeiro.
   * @param {{aoProgresso?: (feitos: number, total: number) => void, sinal?: AbortSignal}} [opcoes]
   * @returns {Promise<{semContatos: boolean, totalNaLista: number, candidatos: Array<{cliente: object, itens: object[], crm: object|null, erro: string|null}>}>}
   */
  /**
   * Indexa raízes dos clientes que aparecem na agenda Google atual.
   * Usa raiz CNPJ nos nomes como correspondência forte e, sem raiz, só aceita
   * nome de organização que identifique uma única raiz de cliente.
   */
  function mapearRaizesPresentesNoGoogle(pessoas, clientes) {
    const raizesPresentes = new Set();
    const raizesClientes = new Set(
      clientes.map((cliente) => G().raizDoCnpj(cliente.cnpj)).filter(Boolean)
    );
    for (const pessoa of pessoas) {
      const nomes = (Array.isArray(pessoa?.names) ? pessoa.names : []).flatMap((n) => [
        n?.displayName,
        [n?.givenName, n?.middleName, n?.familyName].filter(Boolean).join(' '),
      ]).filter(Boolean);
      const organizacoes = (Array.isArray(pessoa?.organizations) ? pessoa.organizations : [])
        .map((o) => String(o?.name || '').trim()).filter(Boolean);
      // Uma raiz válida no nome é a chave mais confiável e não depende da base CSV importada.
      for (const texto of [...nomes, ...organizacoes]) {
        const parsed = G().interpretarNome(texto);
        const raiz = parsed?.raiz ? String(parsed.raiz).replace(/[^0-9A-Z]/gi, '').toUpperCase() : '';
        if (raiz && raizesClientes.has(raiz)) raizesPresentes.add(raiz);
      }
      // Alguns contatos existentes têm a empresa em "Organization Name", mas não têm CNPJ no nome.
      // Só fazemos vínculo por razão social quando a organização aponta para uma única raiz de cliente.
      for (const organizacao of organizacoes) {
        const parsed = G().interpretarNome(organizacao);
        if (parsed?.raiz) continue;
        const raizesCompativeis = new Set();
        clientes.forEach((cliente) => {
          const raiz = G().raizDoCnpj(cliente.cnpj);
          if (raiz && G().razaoConfere(organizacao, cliente.razaoSocial, cliente.nomeFantasia)) {
            raizesCompativeis.add(raiz);
          }
        });
        if (raizesCompativeis.size === 1) raizesPresentes.add([...raizesCompativeis][0]);
      }
    }
    return raizesPresentes;
  }

  /**
   * Cruza a lista com a base CSV e, se a API já estiver conectada, confirma a presença
   * contra a agenda Google atual. Uma falha da API nunca vira ausência confirmada nem CSV exportável.
   */
  async function levantar({ aoProgresso, sinal } = {}) {
    const lista = Array.isArray(window.CLIENTES) ? window.CLIENTES : [];
    const meta = G().lerMeta();
    const api = window.__googleContactsApi;
    let tentouConsultaGoogle = false;
    let consultaGoogleAtual = false;
    let erroConsultaGoogle = '';
    let totalContatosGoogle = null;
    let raizesGoogle = new Set();

    if (api?.status?.().conectado && typeof api.listarContatos === 'function') {
      tentouConsultaGoogle = true;
      try {
        const pessoas = await api.listarContatos();
        if (sinal?.aborted) return {
          semContatos: !meta, precisaReimportar: Boolean(meta && meta.formatoNomeVerificado !== 1),
          totalNaLista: lista.length, candidatos: [], consultaGoogleAtual: false,
          tentouConsultaGoogle, erroConsultaGoogle: 'Consulta cancelada.',
        };
        raizesGoogle = mapearRaizesPresentesNoGoogle(pessoas, lista);
        totalContatosGoogle = pessoas.length;
        consultaGoogleAtual = true;
      } catch {
        erroConsultaGoogle = 'Não foi possível consultar a agenda Google atual. Nenhum contato será marcado como ausente confirmado nem exportado até a leitura funcionar.';
      }
    }

    const candidatos = [];
    for (const cliente of lista) {
      if (sinal?.aborted) break;
      const raiz = G().raizDoCnpj(cliente.cnpj);
      const itens = await G().buscarPorRaiz(raiz);
      candidatos.push({
        cliente, raiz, itens, crm: null, erro: null,
        consultaGoogleAtual,
        contatoGoogleAtual: Boolean(consultaGoogleAtual && raiz && raizesGoogle.has(raiz)),
      });
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
    return {
      semContatos: !meta,
      precisaReimportar: Boolean(meta && meta.formatoNomeVerificado !== 1),
      totalNaLista: lista.length,
      candidatos,
      consultaGoogleAtual,
      tentouConsultaGoogle,
      erroConsultaGoogle,
      totalContatosGoogle,
    };
  }

  /**
   * Verifica se algum telefone do responsável ou do cadastro já aparece no índice do CSV.
   * A conferência é somente leitura e usa a mesma chave canônica do índice global.
   */
  function clienteTemCelularNoIndiceGlobal(cand, indice) {
    if (!indice?.disponivel || !indice.chaves || typeof indice.chaves.has !== 'function') return false;
    const Gc = G();
    const chaves = new Set();
    const responsavel = Gc.chaveCelularValido(cand?.crm?.celular);
    if (responsavel) chaves.add(responsavel);
    let diagnostico = null;
    try {
      diagnostico = window.__buscaRapida?.diagnosticarCelularesDoCliente?.(cand?.cliente) || null;
    } catch { /* campo não disponível: tenta os campos usuais abaixo */ }
    if (Array.isArray(diagnostico?.telefones)) {
      diagnostico.telefones.forEach((telefone) => { if (telefone?.chave) chaves.add(telefone.chave); });
    } else {
      ['celular', 'telefoneCelular', 'telefoneContato', 'telefone'].forEach((campo) => {
        const chave = Gc.chaveCelularValido(cand?.cliente?.[campo]);
        if (chave) chaves.add(chave);
      });
    }
    return Array.from(chaves).some((chave) => indice.chaves.has(chave));
  }

  /**
   * As linhas da tela: um par cliente x contato por diferença, conforme o modo (Nome / Celular).
   * `confere`: a razão do contato bate com a razão social ou o nome fantasia do cliente? (true / false / null = sem como dizer)
   */
  function calcularLinhas(levantamento, modo = G().lerModo(), indiceGlobalTelefones = null) {
    const linhas = [];
    const semLeitura = [];
    const semContato = [];
    const semCorrespondenciaCsv = [];
    const semConfirmacaoGoogle = [];
    const csvNovos = [];
    const chavesCsv = new Set();
    const googleConectado = Boolean(window.__googleContactsApi?.status?.().conectado);
    const fonteGoogleAtual = Boolean(levantamento.consultaGoogleAtual);
    const indiceGlobalDisponivel = Boolean(indiceGlobalTelefones?.disponivel && indiceGlobalTelefones.chaves && typeof indiceGlobalTelefones.chaves.has === 'function');
    const adicionarCsv = (nome, celular, motivo, celularExibicao = celular) => {
      const chave = String(nome) + '\u0000' + String(celular);
      if (chavesCsv.has(chave)) return;
      chavesCsv.add(chave);
      csvNovos.push({ nome, celular, motivo, celularExibicao });
    };
    let iguais = 0;
    levantamento.candidatos.forEach((cand) => {
      const celularNoIndice = indiceGlobalDisponivel && clienteTemCelularNoIndiceGlobal(cand, indiceGlobalTelefones);
      const contatoNaFonte = fonteGoogleAtual ? cand.contatoGoogleAtual : cand.itens.length > 0;
      const contatoExiste = Boolean(celularNoIndice || contatoNaFonte);
      const consultaFalhouSemBase = Boolean(!celularNoIndice && levantamento.erroConsultaGoogle && cand.itens.length === 0);
      if (consultaFalhouSemBase) semConfirmacaoGoogle.push(cand);
      else if (!contatoExiste) semContato.push(cand);
      else if (!celularNoIndice && fonteGoogleAtual && cand.contatoGoogleAtual && cand.itens.length === 0) semCorrespondenciaCsv.push(cand);

      if (!cand.crm) { semLeitura.push(cand); return; }
      // Se a consulta live falhou e não há CSV nem telefone no índice para fallback, não declarar ausência nem exportar.
      if (consultaFalhouSemBase) return;
      if (!contatoExiste) {
        const nome = String(cand.crm.nome ?? '').trim();
        const celularValido = G().normalizarCelular(cand.crm.celular);
        if (nome || celularValido) {
          adicionarCsv(
            nomePadronizadoDoCliente(cand.cliente, cand.crm),
            celularPadronizadoDoCrm(cand.crm),
            CSV_MOTIVO_AUSENTE,
            celularParaExibicaoDoCrm(cand.crm),
          );
        }
        return;
      }
      // O contato existe na agenda atual, mas não faz parte da base CSV importada.
      // Não exportar como ausente nem comparar campos que não foram importados.
      if (cand.itens.length === 0) return;

      const antes = linhas.length;
      let precisaContatoPadronizado = false;
      cand.itens.forEach((item, indice) => {
        const confere = G().razaoConfere(item.razao, cand.cliente.razaoSocial, cand.cliente.nomeFantasia);
        if (item.formatoPadrao === false && confere !== false) precisaContatoPadronizado = true;
        const novidades = G().novidadesDoContato(item, cand.crm, modo);
        const faltandoNoGoogle = {
          nome: modo.nome && Boolean(String(cand.crm.nome ?? '').trim()) && !item.nome,
          celular: modo.celular && Boolean(String(cand.crm.celular ?? '').trim()) && item.celulares.length === 0,
        };
        if (!novidades.nome && !novidades.celular && !faltandoNoGoogle.nome && !faltandoNoGoogle.celular) return;
        linhas.push({
          chave: String(cand.cliente.cnpj) + '#' + indice,
          cliente: cand.cliente, item, crm: cand.crm, novidades, faltandoNoGoogle,
          confere,
        });
      });
      if (precisaContatoPadronizado) {
        const temDadoParaContato = String(cand.crm.nome ?? '').trim() || G().normalizarCelular(cand.crm.celular);
        const ufEsperada = String(cand.cliente.uf || cand.cliente.estado || cand.itens.find((i) => i.uf)?.uf || '').trim().toLocaleUpperCase('pt-BR');
        const nomeEsperadoSemUf = nomePadronizadoDoCliente(cand.cliente, cand.crm);
        const jaExistePadronizado = cand.itens.some((item) => (item.formatoPadrao === true || item.temVersaoPadronizada === true) && (
          (Boolean(ufEsperada) && String(item.uf || '').toLocaleUpperCase('pt-BR') === ufEsperada)
          || (!ufEsperada && !item.uf && G().normalizarNomeParaComparacao(G().textoCanonico(item)) === G().normalizarNomeParaComparacao(nomeEsperadoSemUf))
        ));
        if (temDadoParaContato && !jaExistePadronizado && !googleConectado && !celularNoIndice) {
          adicionarCsv(
            nomePadronizadoDoCliente(cand.cliente, cand.crm, cand.itens.find((item) => item.uf)?.uf),
            celularPadronizadoDoCrm(cand.crm),
            CSV_MOTIVO_PADRONIZACAO,
            celularParaExibicaoDoCrm(cand.crm),
          );
        }
      }
      if (linhas.length === antes) iguais += 1;
    });
    const peso = (l) => (l.confere === false ? 2 : l.confere === null ? 1 : 0);
    linhas.sort((a, b) => peso(a) - peso(b) || String(a.cliente.razaoSocial).localeCompare(String(b.cliente.razaoSocial), 'pt-BR'));
    return {
      linhas, semLeitura, semContato, semCorrespondenciaCsv, semConfirmacaoGoogle, csvNovos, iguais,
      consultaGoogleAtual: fonteGoogleAtual,
      erroConsultaGoogle: levantamento.erroConsultaGoogle || '',
      resumo: {
        totalNaLista: levantamento.totalNaLista,
        comContato: fonteGoogleAtual
          ? levantamento.candidatos.filter((c) => c.contatoGoogleAtual).length
          : levantamento.candidatos.filter((c) => c.itens.length > 0).length,
        comContatoCsv: levantamento.candidatos.filter((c) => c.itens.length > 0).length,
        semContato: semContato.length,
        semCorrespondenciaCsv: semCorrespondenciaCsv.length,
        semConfirmacaoGoogle: semConfirmacaoGoogle.length,
        comDiferenca: new Set(linhas.map((l) => l.cliente)).size,
        iguais,
        semLeitura: semLeitura.length,
      },
    };
  }

  /**
   * Confere separadamente o celular do responsável e o celular cadastral contra TODOS
   * os telefones válidos importados. Esta função é somente leitura e não usa a API Google.
   */
  function calcularConferenciaCelulares(levantamento, indice) {
    const candidatos = Array.isArray(levantamento?.candidatos) ? levantamento.candidatos : [];
    const baseResumo = {
      totalClientes: candidatos.length,
      clientesLidos: candidatos.filter((c) => Boolean(c?.crm)).length,
      numerosPresentes: 0,
      contatosAusentesExportaveis: 0,
      contatosResponsavelExportaveis: 0,
      contatosClienteExportaveis: 0,
      invalidosOuAusentes: 0,
      clientesSemLeitura: candidatos.filter((c) => !c?.crm).length,
      numerosAmbiguos: 0,
      clientesSemCamposTelefone: 0,
    };
    const indiceDisponivel = Boolean(indice?.disponivel && indice.chaves && typeof indice.chaves.has === 'function');
    const chavesIndice = indiceDisponivel ? indice.chaves : new Set();
    const Gc = G();
    const resolverTelefoneCliente = window.__buscaRapida?.diagnosticarCelularDoCliente;
    const resolverTelefonesCliente = window.__buscaRapida?.diagnosticarCelularesDoCliente;
    const entradas = [];
    candidatos.forEach((cand, indiceCliente) => {
      if (!cand?.crm) return;
      const cliente = cand.cliente || {};
      const cnpj = String(cliente.cnpj ?? '').toLocaleUpperCase('pt-BR').replace(/[^0-9A-Z]/g, '');
      const identidade = cnpj ? 'cnpj:' + cnpj
        : cliente.controleCliente != null ? 'controle:' + String(cliente.controleCliente)
          : 'linha:' + String(indiceCliente);
      const razao = String(cliente.razaoSocial || cliente.nomeFantasia || '(empresa sem razão social)').trim();
      const adicionar = (tipo, bruto, chave) => {
        const numero = Gc.formatarCelularValido(bruto) || String(bruto ?? '').trim();
        const nomeResponsavel = nomePadronizadoDoCliente(cliente, cand.crm);
        const nomeClienteBase = nomePadronizadoDoCliente(cliente, { nome: '' });
        const nomeCliente = (nomeClienteBase || '').trim() ? nomeClienteBase : 'Celular do cliente';
        entradas.push({
          identidade, cliente, razao, chave, bruto: String(bruto ?? '').trim(), numero,
          tipo, cand, nomeResponsavel, nomeCliente,
          nome: tipo === 'responsavel' ? nomeResponsavel : nomeCliente,
        });
      };

      const brutoResponsavel = String(cand.crm.celular ?? '').trim();
      const chaveResponsavel = brutoResponsavel ? Gc.chaveCelularValido(brutoResponsavel) : null;
      if (chaveResponsavel) adicionar('responsavel', brutoResponsavel, chaveResponsavel);
      else baseResumo.invalidosOuAusentes += 1;

      let diagnostico = null;
      try {
        diagnostico = typeof resolverTelefonesCliente === 'function'
          ? resolverTelefonesCliente(cliente)
          : resolverTelefoneCliente?.(cliente) ?? null;
      } catch { diagnostico = null; }
      if (!diagnostico || diagnostico.camposDisponiveis === false) baseResumo.clientesSemCamposTelefone += 1;
      const telefonesValidos = Array.isArray(diagnostico?.telefones)
        ? diagnostico.telefones.filter((telefone) => telefone?.chave && telefone?.valor)
        : diagnostico?.status === 'valido' && diagnostico.chave
          ? [{ campo: diagnostico.campo, valor: diagnostico.valor, chave: diagnostico.chave }]
          : [];
      if (telefonesValidos.length > 0) {
        telefonesValidos.forEach((telefone) => adicionar('cliente', telefone.valor, telefone.chave));
      } else {
        baseResumo.invalidosOuAusentes += 1;
      }
    });

    const porChave = new Map();
    const chavesPresentes = new Set();
    entradas.forEach((entrada) => {
      if (!porChave.has(entrada.chave)) porChave.set(entrada.chave, []);
      porChave.get(entrada.chave).push(entrada);
      if (chavesIndice.has(entrada.chave)) chavesPresentes.add(entrada.chave);
    });

    const linhas = [];
    const exportaveis = [];
    let ambiguos = 0;
    porChave.forEach((grupo, chave) => {
      const porCliente = new Map();
      grupo.forEach((entrada) => {
        if (!porCliente.has(entrada.identidade)) porCliente.set(entrada.identidade, []);
        porCliente.get(entrada.identidade).push(entrada);
      });
      const linhasCliente = Array.from(porCliente.values()).map((itens) => {
        const responsavel = itens.find((item) => item.tipo === 'responsavel');
        const clienteTelefone = itens.find((item) => item.tipo === 'cliente');
        const tipos = new Set(itens.map((item) => item.tipo));
        const escolhido = responsavel || clienteTelefone || itens[0];
        return {
          chave,
          identidade: escolhido.identidade,
          cliente: escolhido.cliente,
          empresa: escolhido.razao,
          categoria: tipos.has('responsavel') && tipos.has('cliente')
            ? 'Responsável financeiro + celular do cliente'
            : tipos.has('responsavel') ? 'Responsável financeiro' : 'Celular do cliente',
          celular: escolhido.numero,
          status: '',
          nome: responsavel ? responsavel.nomeResponsavel : escolhido.nomeCliente,
          fontes: Array.from(tipos),
          marcadorCliente: tipos.has('cliente') && !tipos.has('responsavel'),
          telefoneExportacao: Gc.formatarCelularValido(escolhido.bruto) || escolhido.bruto,
        };
      });
      const ambiguo = linhasCliente.length > 1;
      if (ambiguo) ambiguos += 1;
      linhasCliente.forEach((linha) => {
        if (ambiguo) {
          linha.status = !indiceDisponivel
            ? 'Ambíguo/compartilhado — CSV não conferido; reimporte'
            : chavesIndice.has(chave)
              ? 'Ambíguo/compartilhado — número também encontrado no CSV'
              : 'Ambíguo/compartilhado — conferência manual';
          linha.exportavel = false;
        } else if (!indiceDisponivel) {
          linha.status = 'Não classificado — reimporte o CSV';
          linha.exportavel = false;
        } else if (chavesIndice.has(chave)) {
          linha.status = 'Encontrado no CSV importado';
          linha.exportavel = false;
        } else {
          linha.status = 'Ausente no CSV importado';
          linha.exportavel = true;
          exportaveis.push({
            nome: linha.nome,
            celular: linha.telefoneExportacao,
            chave: linha.chave,
            fontes: linha.fontes.slice(),
            marcadorCliente: linha.marcadorCliente,
          });
        }
        linhas.push(linha);
      });
    });

    baseResumo.numerosPresentes = chavesPresentes.size;
    baseResumo.numerosAmbiguos = ambiguos;
    baseResumo.contatosAusentesExportaveis = exportaveis.length;
    baseResumo.contatosResponsavelExportaveis = exportaveis.filter((c) => c.fontes.includes('responsavel')).length;
    baseResumo.contatosClienteExportaveis = exportaveis.filter((c) => c.fontes.includes('cliente')).length;
    return { disponivel: indiceDisponivel, motivo: indiceDisponivel ? null : (indice?.motivo || 'reimportar'), resumo: baseResumo, linhas, exportaveis };
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

  /** Nome digitado no editor: sem espaços nas pontas nem repetidos no meio (o CRM guarda o texto como veio). */
  const normalizarNomeEditado = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

  /**
   * O que o editor de nome vai gravar com o texto digitado (acao 'nome' ou 'ambos'). Uma só fonte para a linha
   * "Vai gravar no CRM..." e para o botão Gravar: o que se vê é o que vai. Usa a mesma regra de decisão do
   * Módulo 28 com o nome JÁ editado e `substituir` ligado (o Gravar é a confirmação do "Trocar").
   * @returns {{ok: boolean, nome: string, texto: string}} `ok: false` = o Gravar fica desligado e `texto` diz por quê.
   */
  function avaliarEdicao(l, acao, celular, digitado) {
    const nome = normalizarNomeEditado(digitado);
    if (!nome) return { ok: false, nome, texto: 'Digite o nome do responsável.' };
    if (nome.length > maxNome()) {
      return { ok: false, nome, texto: `O CRM aceita até ${maxNome()} caracteres no nome (são ${nome.length}).` };
    }
    const decisao = G().decidirPreenchimento({ ...l.item, nome }, celular, l.crm.nome ?? '', l.crm.celular ?? '', true, modoDaAcao(acao));
    if (!decisao.nome && !decisao.celular) return { ok: false, nome, texto: 'O CRM já tem esses valores: nada a gravar.' };
    const celularAntigo = String(l.crm.celular ?? '').trim();
    const partes = [];
    if (decisao.nome) partes.push(`nome "${String(l.crm.nome ?? '').trim() || 'vazio'}" → "${nome}"`);
    if (decisao.celular) partes.push(`celular "${celularAntigo || 'vazio'}" → "${G().formatarCelular(celular)}"`);
    return { ok: true, nome, texto: `Vai gravar no CRM: ${partes.join(' e ')}.` };
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
   * `nomeEditado` (opcional): o nome que o usuário escreveu no editor, no lugar do nome do Google. É validado
   * aqui de novo (vazio e tamanho): quem chama o editor já validou, mas a gravação não confia só nisso.
   */
  async function gravarLinha(estado, l, acao, celular, confirmado, sinal, nomeEditado) {
    const editou = nomeEditado !== undefined && nomeEditado !== null;
    const nomeFinal = editou ? normalizarNomeEditado(nomeEditado) : l.item.nome;
    if (editou && (!nomeFinal || nomeFinal.length > maxNome())) {
      return { ok: false, tipo: 'erro', texto: `O nome ${nomeFinal ? 'passa de ' + maxNome() + ' caracteres' : 'está vazio'}. Nada foi gravado.` };
    }
    const item = editou ? { ...l.item, nome: nomeFinal } : l.item;
    const cand = estado.levantamento.candidatos.find((c) => c.cliente === l.cliente);
    // Ainda nada foi enviado: esta leitura pode ser cancelada pelo painel.
    const fresco = await lerPaginaDoCliente(l.cliente, sinal);
    if (!fresco.crm) return { ok: false, tipo: 'erro', texto: `Não consegui reler o responsável antes de gravar (${MENSAGEM_ERRO[fresco.erro] ?? 'erro'}). Nada foi gravado.` };
    if (!mesmoCrm(fresco.crm, l.crm)) {
      cand.crm = fresco.crm;
      return { ok: false, tipo: 'aviso', texto: `O CRM mudou desde a leitura (agora: ${textoDoCrm(fresco.crm)}). A linha foi atualizada: confira e clique de novo. Nada foi gravado.` };
    }
    const decisao = G().decidirPreenchimento(item, celular, fresco.crm.nome ?? '', fresco.crm.celular ?? '', confirmado, modoDaAcao(acao));
    if (decisao.motivo) return { ok: false, tipo: 'aviso', texto: 'Nada a gravar com o que está ligado (o CRM já tem esses valores ou falta confirmar).' };
    const antes = { nome: String(fresco.crm.nome ?? ''), celular: String(fresco.crm.celular ?? '') };
    const enviar = {
      nome: decisao.nome ? item.nome : antes.nome,
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
        // O editor de nome mostra o número que vai junto ("ambos"): a linha "Vai gravar..." precisa do número novo.
        else if (estado.editando && estado.editando.chave === l.chave) { estado.redesenhar(); focarEditor(estado); }
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

  const celularEscolhido = (estado, l) => estado.escolhidos.get(l.item) ?? l.item.celulares[0] ?? null;

  /** O texto do editor: o que o usuário digitou neste contato (guardado até gravar ou cancelar) ou o nome do Google. */
  const textoDoEditor = (estado, l) => (estado.textosDigitados.has(l.chave) ? estado.textosDigitados.get(l.chave) : l.item.nome);

  /**
   * Fecha o editor. O texto digitado só é esquecido quando o usuário desiste (cancelar, outro clique, linha que saiu);
   * numa gravação que falha ele fica, para a próxima abertura não obrigar a digitar de novo.
   */
  function encerrarEditor(estado, manterTexto = false) {
    if (estado.editando && !manterTexto) estado.textosDigitados.delete(estado.editando.chave);
    estado.editando = null;
  }

  /** Foca o campo do editor (depois de abrir ou de um redesenho); o navegador já deixa o cursor no fim do texto. */
  function focarEditor(estado) {
    if (!painelDoEstadoAberto(estado)) return;
    const campo = estado.painel.querySelector('[data-campo="nome-editado"]');
    if (!campo) return;
    campo.focus();
  }

  /**
   * O editor do nome, dentro da linha: campo com o nome do Google já preenchido, a linha "Vai gravar no CRM"
   * (de → para, atualizada a cada tecla SEM redesenhar a lista, que apagaria o foco), Gravar e Cancelar.
   * O texto vive em `estado.editando`: sobrevive a qualquer redesenho (trocar o número, o interruptor, outra gravação).
   */
  function criarEditor(l, estado) {
    const ed = estado.editando;
    const caixa = criarDiv('', {
      gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px 10px',
      background: '#f6faf8', border: `1px solid ${CORES.borda}`, borderRadius: '6px',
    });
    caixa.dataset.papel = 'editor-nome';
    caixa.appendChild(criarDiv('Nome a gravar no CRM (pode alterar antes de gravar):', { color: CORES.texto, fontSize: '11.5px', fontWeight: '600' }));
    const linhaDoCampo = criarDiv('', { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.value = textoDoEditor(estado, l);
    campo.maxLength = maxNome();
    campo.autocomplete = 'off';
    campo.dataset.campo = 'nome-editado';
    campo.setAttribute('aria-label', 'Nome do responsável a gravar no CRM');
    Object.assign(campo.style, {
      flex: '1 1 260px', minWidth: '200px', padding: '6px 8px', fontSize: '13px', border: `1px solid ${CORES.borda}`,
      borderRadius: '6px', boxSizing: 'border-box',
    });
    const gravar = criarBotao('Gravar', 'gravar-edicao', true);
    const cancelar = criarBotao('Cancelar', 'cancelar-edicao', false);
    const previa = criarDiv('', { fontSize: '12px', fontWeight: '600' });
    previa.dataset.papel = 'previa-edicao';
    const atualizar = () => {
      const av = avaliarEdicao(l, ed.acao, celularEscolhido(estado, l), campo.value);
      previa.textContent = av.texto;
      previa.style.color = av.ok ? CORES.texto : CORES.aviso;
      gravar.disabled = !av.ok;
      gravar.style.opacity = gravar.disabled ? '0.5' : '1';
    };
    campo.addEventListener('input', () => { estado.textosDigitados.set(l.chave, campo.value); atualizar(); });
    // Enter grava, mas NUNCA a repetição de uma tecla mantida apertada (o 1º Enter abriu o editor e levou o foco ao campo: as
    // repetições seguintes cairiam aqui e gravariam o nome do Google sem o usuário ter visto o "Vai gravar").
    // O Esc é tratado no document (cancela o editor de qualquer foco dentro do painel).
    campo.addEventListener('keydown', (e) => {
      if (e.isComposing || e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.repeat) aoGravarEdicao(estado, l, campo.value);
    });
    gravar.addEventListener('click', () => aoGravarEdicao(estado, l, campo.value));
    cancelar.addEventListener('click', () => cancelarEdicao(estado));
    linhaDoCampo.appendChild(campo);
    linhaDoCampo.appendChild(gravar);
    linhaDoCampo.appendChild(cancelar);
    caixa.appendChild(linhaDoCampo);
    caixa.appendChild(previa);
    atualizar();
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
    const etiquetas = [
      l.novidades.nome ? 'nome' : null,
      l.novidades.celular ? 'celular' : null,
      l.faltandoNoGoogle?.nome ? 'Google sem nome' : null,
      l.faltandoNoGoogle?.celular ? 'Google sem celular' : null,
      l.confere === false ? 'razão diferente' : null,
    ].filter(Boolean).join(' · ');
    cliente.appendChild(criarDiv('Difere: ' + (etiquetas || 'conferir contato'), { color: CORES.aviso, fontSize: '11.5px' }));
    linha.appendChild(cliente);
    linha.appendChild(criarDiv('No CRM: ' + textoDoCrm(l.crm), { color: CORES.texto, fontSize: '12px' }));
    linha.appendChild(criarDiv(`No Google: ${l.item.nome || '(sem nome)'}${cel ? ' · ' + cel : ''}`, { color: CORES.texto, fontSize: '12px' }));
    const conf = ROTULO_CONFIANCA[String(l.confere)];
    linha.appendChild(criarDiv(conf.texto, { color: conf.cor, fontSize: '11.5px', fontWeight: '600' }));
    linha.appendChild(criarAcoes(l, estado));
    // Editor aberto nesta linha (só se a ação ainda existe: desligar o interruptor Nome tira o botão e o editor).
    if (estado.editando && estado.editando.chave === l.chave && acoesDaLinha(l).some((a) => a.acao === estado.editando.acao)) {
      linha.appendChild(criarEditor(l, estado));
      estado.editorVisivel = true;
    }
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

  /** Grava uma linha (com o nome editado, se houver): trava, mostra "Gravando...", grava e mostra o resultado. */
  async function executarGravacao(estado, l, acao, celular, confirmado, nomeEditado) {
    desarmar(estado); // solta o relógio da confirmação também (a mensagem é trocada logo abaixo)
    encerrarEditor(estado, true);
    gravando = true;
    estado.mensagens.set(l.item, { tipo: 'aviso', texto: 'Gravando...' });
    estado.redesenhar();
    let r;
    try {
      r = await gravarLinha(estado, l, acao, celular, confirmado, controlador?.signal, nomeEditado);
    } catch {
      r = { ok: false, tipo: 'erro', texto: 'Erro inesperado ao gravar. Abra o cliente e confira.' };
    }
    if (r.ok) estado.textosDigitados.delete(l.chave);
    terminarGravacao(estado, l.item, r);
  }

  /**
   * Botões que mexem no nome (nome e ambos): abre o editor na linha, com o nome do Google. Reabrir a mesma ação
   * só devolve o foco; trocar de ação na mesma linha mantém o que já foi digitado; outra linha começa do zero.
   */
  function abrirEditor(estado, l, acao) {
    const mesmaAcao = estado.editando && estado.editando.chave === l.chave && estado.editando.acao === acao;
    if (!mesmaAcao) {
      if (estado.editando && estado.editando.chave !== l.chave) encerrarEditor(estado); // outro contato: o anterior foi abandonado
      desarmar(estado);
      estado.mensagens.delete(l.item);
      estado.editando = { chave: l.chave, acao };
      estado.redesenhar();
    }
    focarEditor(estado);
  }

  function cancelarEdicao(estado) {
    if (!estado.editando) return;
    encerrarEditor(estado);
    estado.redesenhar();
  }

  /** Gravar do editor: grava o nome como está no campo (já validado) e o número escolhido, e só o que a linha mostrou. */
  async function aoGravarEdicao(estado, l, texto) {
    if (gravando) return;
    const ed = estado.editando;
    if (!ed || ed.chave !== l.chave) return;
    const celular = celularEscolhido(estado, l);
    const av = avaliarEdicao(l, ed.acao, celular, texto);
    if (!av.ok) return;
    // O "Gravar" é a confirmação: a linha "Vai gravar no CRM" já mostrou o de → para (inclusive o que seria substituído).
    await executarGravacao(estado, l, ed.acao, celular, true, av.nome);
  }

  /** Clique num botão da linha: nome e ambos abrem o editor; número pede confirmação quando precisa; senão grava. */
  async function aoClicarAcao(estado, l, acao) {
    if (gravando) return;
    if (acao !== 'celular') { abrirEditor(estado, l, acao); return; }
    encerrarEditor(estado); // outro clique cancela o editor aberto (o redesenho vem logo abaixo)
    const celular = celularEscolhido(estado, l);
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
    await executarGravacao(estado, l, acao, celular, Boolean(plano.precisa));
  }

  async function aoClicarDesfazer(estado, entrada) {
    if (gravando) return;
    encerrarEditor(estado);
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
      `${r.totalNaLista} cliente(s) conferidos · ${r.comContato} com contato no Google · ${r.semContato} sem contato · ${r.comDiferenca} com diferença · ${r.iguais} já iguais · ${r.semLeitura} sem leitura`,
      { color: CORES.texto, fontSize: '12.5px', margin: '4px 0 8px', fontWeight: '600' },
    )).dataset.papel = 'resumo';
    if (calculo.linhas.length === 0) {
      destino.appendChild(criarDiv('Nenhuma diferença encontrada para o que está ligado (Nome / Celular).', { color: CORES.destaque, margin: '8px 0' })).dataset.papel = 'vazio';
    }
    const lista = criarDiv('', { borderTop: `1px solid ${CORES.linha}` });
    lista.dataset.papel = 'diferencas';
    estado.editorVisivel = false;
    calculo.linhas.forEach((l) => lista.appendChild(desenharLinha(l, estado)));
    // O cliente do editor saiu da lista (ex.: desligou o interruptor): não deixa o editor "fantasma" no estado.
    if (estado.editando && !estado.editorVisivel) encerrarEditor(estado);
    destino.appendChild(lista);

    // Exportação de ausentes e padronização ficam em telas separadas da central.

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

  function serializarCsvNovos(contatos) {
    const citar = (valor) => {
      const texto = String(valor ?? '');
      return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };
    const linhas = [['First Name', 'Phone 1 - Value', 'Notes'], ...contatos.map((c) => [
      c.nome,
      c.celular,
      c.marcadorCliente ? '[SMARTTABLE:CELULAR-CLIENTE:v1]' : '',
    ])];
    return '\uFEFF' + linhas.map((linha) => linha.map(citar).join(',')).join('\r\n') + '\r\n';
  }

  function baixarCsvNovos(contatos, nomeArquivo = 'contatos-google-novos.csv') {
    const Gc = G();
    if (!Gc) return;
    const texto = serializarCsvNovos(contatos);
    const blob = new window.Blob([texto], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }


  function baixarBackupGoogle(linhas) {
    try {
      const backup = {
        geradoEm: new Date().toISOString(),
        contatos: linhas.map((linha) => ({
          resourceName: String(linha.pessoa?.resourceName || ''),
          names: Array.isArray(linha.pessoa?.names) ? linha.pessoa.names.map((nome) => Object.assign({}, nome)) : [],
          phoneNumbers: Array.isArray(linha.pessoa?.phoneNumbers) ? linha.pessoa.phoneNumbers.map((telefone) => ({
            value: String(telefone?.value || ''),
            ...(telefone?.type ? { type: String(telefone.type) } : {}),
            ...(telefone?.label && !telefone?.type ? { label: String(telefone.label) } : {}),
          })) : [],
        })),
      };
      const json = JSON.stringify(backup, null, 2);
      const nomeArquivo = 'smarttable-google-contacts-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      let url;
      let blobUrl = false;
      if (typeof window.URL?.createObjectURL === 'function') {
        url = window.URL.createObjectURL(new window.Blob([json], { type: 'application/json;charset=utf-8' }));
        blobUrl = true;
      } else {
        url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivo;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (blobUrl) window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      return true;
    } catch {
      return false;
    }
  }

  async function desfazerCorrecoesGoogle(estado) {
    const api = window.__googleContactsApi;
    if (!api?.restaurarContato || estado.googleGravando) return;
    const fila = Array.isArray(estado.ultimaRodadaUndo) ? [...estado.ultimaRodadaUndo] : [];
    if (fila.length === 0) return;
    if (!window.confirm('Desfazer as alterações da última rodada em ' + fila.length + ' contato(s)? O Google bloqueará qualquer restauração cujo ETag tenha mudado desde a gravação.')) return;
    estado.googleGravando = true;
    let restaurados = 0;
    let conflitos = 0;
    let falhas = 0;
    const pendentes = [];
    for (const entrada of fila.reverse()) {
      const linha = entrada.linha;
      linha.estadoOperacao = 'atualizando';
      linha.status = 'Desfazendo alteração…';
      if (estado.redesenharGoogle) estado.redesenharGoogle();
      try {
        const r = await api.restaurarContato(entrada.pessoaAtualizada, entrada.original);
        if (r.ok) {
          linha.pessoa = r.pessoa;
          calcularDiferencasGoogle(linha);
          linha.confirmada = false;
          linha.estadoOperacao = 'desfeito';
          linha.status = 'Alteração desfeita; nome e telefones anteriores foram restaurados.';
          restaurados += 1;
        } else {
          linha.pessoa = r.pessoa || linha.pessoa;
          linha.estadoOperacao = 'falha';
          linha.status = r.mensagem || 'Não foi possível desfazer a alteração.';
          if (r.conflito) conflitos += 1;
          else { falhas += 1; pendentes.unshift(entrada); }
        }
      } catch (erro) {
        linha.estadoOperacao = 'falha';
        linha.status = erro?.message || 'Falha de rede ao desfazer a alteração.';
        falhas += 1;
        pendentes.unshift(entrada);
      }
    }
    estado.ultimaRodadaUndo = pendentes;
    estado.googleGravando = false;
    estado.googleResumo = 'Desfazer: ' + restaurados + ' contato(s) restaurado(s); ' + conflitos + ' conflito(s) de ETag (bloqueados); ' + falhas + ' falha(s) recuperáveis.';
    if (estado.redesenharGoogle) estado.redesenharGoogle();
  }

  /* ---------------------------------------------------------------------
   * SINCRONIZAÇÃO DIRETA COM GOOGLE CONTACTS (People API)
   * --------------------------------------------------------------------- */
  function nomeVisivelGoogle(pessoa) {
    const nomes = Array.isArray(pessoa?.names) ? pessoa.names : [];
    const nome = nomes.find((n) => n?.metadata?.primary) || nomes[0] || {};
    return String(nome.givenName || nome.unstructuredName || nome.displayName || nome.familyName || '').trim();
  }

  function parsePessoaGoogle(pessoa) {
    const textos = [];
    (pessoa?.names || []).forEach((n) => {
      [n?.givenName, n?.unstructuredName, n?.displayName].forEach((v) => {
        if (v && !textos.includes(String(v))) textos.push(String(v));
      });
    });
    (pessoa?.organizations || []).forEach((o) => {
      if (o?.name && !textos.includes(String(o.name))) textos.push(String(o.name));
    });
    const interpretados = textos.map((t) => ({ texto: t, contato: G().interpretarNome(t) })).filter((x) => x.contato?.raiz);
    return interpretados.find((x) => x.contato.uf) || interpretados[0] || null;
  }

  function ufDoCliente(c, fallback) {
    return String(c?.uf || c?.estado || fallback || '').trim().toLocaleUpperCase('pt-BR');
  }

  function grupoDoCliente(c, fallback) {
    const n = Number(c?.controleCliente);
    return n > 0 ? 'GP ' + n : String(fallback || '').trim();
  }

  function escolherClienteDaRaiz(parsed, candidatos) {
    if (candidatos.length === 0) return { cliente: null, seguro: false, motivo: 'Nenhum cliente desta lista tem a mesma raiz do CNPJ.' };
    const exatos = candidatos.filter((c) => G().razaoConfere(parsed.razao, c.razaoSocial, c.nomeFantasia) === true);
    const pontuar = (c) => {
      let pontos = 0;
      const uf = ufDoCliente(c);
      if (parsed.uf && uf) pontos += parsed.uf === uf ? 3 : -2;
      const grupo = grupoDoCliente(c);
      if (parsed.grupo && grupo) {
        const numeroContato = parsed.grupo.match(/\d+/)?.[0] || '';
        const numeroCliente = grupo.match(/\d+/)?.[0] || '';
        pontos += numeroContato && numeroContato === numeroCliente ? 4 : -1;
      }
      return pontos;
    };
    if (exatos.length === 1) return { cliente: exatos[0], seguro: true, motivo: '' };
    if (exatos.length > 1) {
      const ordenados = exatos.map((cliente) => ({ cliente, pontos: pontuar(cliente) })).sort((a, b) => b.pontos - a.pontos);
      if (ordenados[0].pontos > 0 && ordenados[0].pontos > ordenados[1].pontos) {
        return { cliente: ordenados[0].cliente, seguro: true, motivo: '' };
      }
      return { cliente: null, seguro: false, motivo: 'Mais de um cliente tem razão social compatível com esta raiz; vínculo ambíguo.' };
    }
    if (candidatos.length === 1) {
      return { cliente: candidatos[0], seguro: false, motivo: 'A raiz coincide, mas a razão social não foi confirmada. Revise o vínculo antes de alterar.' };
    }
    return { cliente: null, seguro: false, motivo: 'A raiz aparece em vários clientes e a razão social não identificou um único vínculo.' };
  }

  function montarNomeGoogleDesejado(cliente, parsed, crm) {
    if (!String(crm?.nome || '').replace(/\s+/g, ' ').trim()) return '';
    return nomePadronizadoDoCliente(cliente, crm, parsed?.uf);
  }

  function celularesGoogle(pessoa) {
    return (pessoa?.phoneNumbers || []).map((p) => ({
      value: String(p?.value || '').trim(),
      tipo: String(p?.type || p?.formattedType || 'telefone'),
      celular: G().normalizarCelular(p?.value),
    }));
  }

  function calcularDiferencasGoogle(linha) {
    const crmCelular = G().normalizarCelular(linha.crm?.celular);
    linha.nomeAtual = nomeVisivelGoogle(linha.pessoa);
    linha.telefones = celularesGoogle(linha.pessoa);
    linha.celularCrm = crmCelular;
    linha.nomeDesejado = montarNomeGoogleDesejado(linha.cliente, linha.parsed, linha.crm);
    linha.celularDesejado = crmCelular ? G().formatarCelular(crmCelular) : '';
    linha.difereNome = Boolean(linha.nomeDesejado && linha.nomeAtual !== linha.nomeDesejado);
    linha.difereCelular = Boolean(crmCelular && !linha.telefones.some((p) => p.celular === crmCelular));
    linha.aplicarNome = false;
    linha.aplicarCelular = false;
    linha.indiceTelefone = -1; // Padrão: adicionar, preservando todos os números que já existem.
    linha.dadosInsuficientes = !linha.nomeDesejado && !crmCelular;
    if (linha.dadosInsuficientes) linha.avisoDados = 'Dados insuficientes no CRM: faltam nome do responsável e celular brasileiro válido.';
    else if (!linha.nomeDesejado) linha.avisoDados = 'O CRM não tem nome do responsável suficiente para padronizar este contato.';
    else if (!crmCelular) linha.avisoDados = 'O celular do CRM não é um celular brasileiro válido; não será atualizado.';
    return linha;
  }

  async function prepararLinhasGoogle(pessoas, estado, aoProgresso) {
    const clientes = Array.isArray(window.CLIENTES) ? window.CLIENTES : [];
    const porRaiz = new Map();
    clientes.forEach((cliente) => {
      const raiz = G().raizDoCnpj(cliente.cnpj);
      if (!raiz) return;
      if (!porRaiz.has(raiz)) porRaiz.set(raiz, []);
      porRaiz.get(raiz).push(cliente);
    });
    const linhas = [];
    let semPadrao = 0;
    let semVinculo = 0;
    for (const pessoa of pessoas) {
      const achado = parsePessoaGoogle(pessoa);
      if (!achado) { semPadrao += 1; continue; }
      const candidatos = porRaiz.get(achado.contato.raiz) || [];
      const vinculo = escolherClienteDaRaiz(achado.contato, candidatos);
      if (!vinculo.cliente) {
        semVinculo += 1;
        linhas.push({
          pessoa, parsed: achado.contato, textoGoogle: achado.texto, cliente: null, crm: null,
          seguro: false, precisaConfirmar: true, confirmada: false, status: vinculo.motivo,
          telefones: celularesGoogle(pessoa), nomeAtual: nomeVisivelGoogle(pessoa),
          difereNome: false, difereCelular: false, editavel: false,
        });
        continue;
      }
      linhas.push({
        pessoa, parsed: achado.contato, textoGoogle: achado.texto, cliente: vinculo.cliente, crm: null,
        seguro: vinculo.seguro, precisaConfirmar: !vinculo.seguro, confirmada: false,
        status: vinculo.motivo, telefones: [], nomeAtual: '', difereNome: false,
        difereCelular: false, editavel: false,
      });
    }

    const clientesParaLer = [...new Map(linhas.filter((l) => l.cliente).map((l) => [String(l.cliente.cnpj), l.cliente])).values()];
    let proximo = 0;
    let feitos = 0;
    const responsaveis = new Map();
    const trabalhador = async () => {
      while (proximo < clientesParaLer.length && !estado.signal?.aborted) {
        const cliente = clientesParaLer[proximo++];
        const lido = await lerPaginaDoCliente(cliente, estado.signal);
        responsaveis.set(String(cliente.cnpj), lido);
        feitos += 1;
        aoProgresso?.(feitos, clientesParaLer.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONFIG_LISTA.SIMULTANEAS, clientesParaLer.length) }, trabalhador));

    const porCliente = new Map();
    linhas.filter((l) => l.cliente).forEach((l) => {
      const chave = String(l.cliente.cnpj);
      porCliente.set(chave, (porCliente.get(chave) || 0) + 1);
    });
    linhas.filter((l) => l.cliente).forEach((l) => {
      const lido = responsaveis.get(String(l.cliente.cnpj));
      if (!lido?.crm) {
        l.status = lido?.erro ? (MENSAGEM_ERRO[lido.erro] || 'Não foi possível ler os dados do CRM.') : 'Não foi possível ler os dados do CRM.';
        l.erroLeitura = true;
        return;
      }
      l.crm = lido.crm;
      if ((porCliente.get(String(l.cliente.cnpj)) || 0) > 1) {
        l.seguro = false;
        l.precisaConfirmar = true;
        l.confirmada = false;
        l.status = 'Há mais de um contato Google com a mesma empresa. Confirme que este é o registro correto antes de alterá-lo.';
      }
      calcularDiferencasGoogle(l);
      l.editavel = Boolean(l.pessoa?.resourceName && (l.difereNome || l.difereCelular));
      const nomeCanonicoGoogle = G().normalizarNomeParaComparacao(G().textoCanonico(l.parsed));
      const nomeOriginalGoogle = String(l.textoGoogle || '').replace(/\s+/g, ' ').trim();
      const nomeOriginalNormalizado = G().normalizarNomeParaComparacao
        ? G().normalizarNomeParaComparacao(nomeOriginalGoogle)
        : nomeOriginalGoogle;
      const nomeForaDoPadrao = nomeOriginalNormalizado !== nomeCanonicoGoogle;
      // Com OAuth conectado, sugerir a renomeação no fluxo direto em vez de gerar duplicata via CSV.
      l.aplicarNome = Boolean(window.__googleContactsApi?.status?.().conectado && l.difereNome && nomeForaDoPadrao);
      if (l.dadosInsuficientes) l.status = 'Dados insuficientes no CRM; não é possível afirmar que o contato já confere.';
      else if (!l.editavel && !l.precisaConfirmar) l.status = 'Nome e celular já conferem com o CRM.';
      if (l.precisaConfirmar && !l.status) l.status = 'Revise a associação antes de permitir qualquer alteração.';
    });

    const comDiferenca = linhas.filter((l) => l.cliente && l.crm && (l.difereNome || l.difereCelular)).length;
    const dadosInsuficientes = linhas.filter((l) => l.cliente && l.crm && l.dadosInsuficientes).length;
    const jaIguais = linhas.filter((l) => l.cliente && l.crm && !l.dadosInsuficientes && !l.difereNome && !l.difereCelular && !l.precisaConfirmar && !l.erroLeitura).length;
    return { linhas, semPadrao, semVinculo, comDiferenca, dadosInsuficientes, jaIguais, clientesLidos: clientesParaLer.length };
  }

  function criarCheckboxSync(rotulo, marcado, desabilitado, aoMudar) {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: CORES.texto, marginTop: '4px' });
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(marcado);
    input.disabled = Boolean(desabilitado);
    input.addEventListener('change', () => aoMudar(input.checked));
    label.appendChild(input);
    label.appendChild(document.createTextNode(rotulo));
    return label;
  }

  function desenharLinhasGoogle(destino, estado, resumo) {
    destino.textContent = '';
    const linhas = estado.googleLinhas || [];
    const visiveisTodas = linhas.filter((l) => !l.cliente || l.erroLeitura || l.precisaConfirmar || l.dadosInsuficientes || l.difereNome || l.difereCelular || ['atualizando', 'atualizado', 'falha', 'desfeito'].includes(l.estadoOperacao));
    const tamanhoPagina = 50;
    const totalPaginas = Math.max(1, Math.ceil(visiveisTodas.length / tamanhoPagina));
    estado.googlePagina = Math.max(0, Math.min(Number(estado.googlePagina) || 0, totalPaginas - 1));
    const visiveis = visiveisTodas.slice(estado.googlePagina * tamanhoPagina, (estado.googlePagina + 1) * tamanhoPagina);
    const textoResumo = resumo || ('Contatos Google: ' + linhas.length + ' com raiz reconhecida; ' +
      linhas.filter((l) => l.cliente).length + ' associados a cliente; ' +
      linhas.filter((l) => l.cliente && l.crm && (l.difereNome || l.difereCelular)).length + ' com diferenças; ' +
      linhas.filter((l) => l.cliente && l.crm && l.dadosInsuficientes).length + ' com dados insuficientes; ' +
      linhas.filter((l) => l.cliente && l.crm && !l.dadosInsuficientes && !l.difereNome && !l.difereCelular && !l.precisaConfirmar && !l.erroLeitura).length + ' já conferem.');
    destino.appendChild(criarDiv(textoResumo, { color: CORES.texto, fontSize: '12px', fontWeight: '600', margin: '4px 0 8px' }));
    if (estado.googleResumo) {
      destino.appendChild(criarDiv(estado.googleResumo, { color: CORES.apagado, fontSize: '11px', marginBottom: '8px' }));
    }
    if (linhas.length || (estado.ultimaRodadaUndo || []).length) {
      const desfazerRodada = criarBotao('Desfazer última rodada (' + (estado.ultimaRodadaUndo || []).length + ')', 'desfazer-google-rodada', false);
      desfazerRodada.disabled = !(estado.ultimaRodadaUndo || []).length || estado.googleGravando;
      desfazerRodada.addEventListener('click', () => desfazerCorrecoesGoogle(estado));
      destino.appendChild(desfazerRodada);
    }
    if (visiveis.length === 0) {
      destino.appendChild(criarDiv('Nenhuma divergência segura para exibir. Se houver contatos sem padrão ou vínculo ambíguo, confira os contadores acima.', { color: CORES.destaque, fontSize: '12px', padding: '8px 0' }));
      return;
    }
    visiveis.forEach((l) => {
      const item = criarDiv('', {
        border: '1px solid ' + CORES.borda, borderRadius: '7px', padding: '9px', marginBottom: '8px',
        display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) minmax(200px,1.2fr) minmax(220px,1.2fr)',
        gap: '8px', alignItems: 'start',
      });
      const empresa = criarDiv('', {});
      empresa.appendChild(criarDiv(l.cliente?.razaoSocial || l.parsed.razao || '(empresa não identificada)', { color: CORES.tinta, fontWeight: '700', fontSize: '12px' }));
      empresa.appendChild(criarDiv('Google: ' + (l.nomeAtual || '(sem nome)') , { color: CORES.texto, fontSize: '11.5px', marginTop: '4px', overflowWrap: 'anywhere' }));
      const celulares = (l.telefones || []).map((p) => p.value + (p.tipo ? ' (' + p.tipo + ')' : '')).filter(Boolean).join(' · ');
      empresa.appendChild(criarDiv('Telefones Google: ' + (celulares || '(nenhum)'), { color: CORES.texto, fontSize: '11px', marginTop: '3px', overflowWrap: 'anywhere' }));
      const destinoAtual = criarDiv('', {});
      destinoAtual.appendChild(criarDiv('CRM: ' + (l.crm ? String(l.crm.nome || '(sem nome)') + ' · ' + String(l.crm.celular || '(sem celular)') : 'não disponível'), { color: CORES.texto, fontSize: '11.5px', overflowWrap: 'anywhere' }));
      destinoAtual.appendChild(criarDiv('Nome desejado: ' + (l.nomeDesejado || '(dados insuficientes)'), { color: l.difereNome ? CORES.aviso : CORES.texto, fontSize: '11.5px', marginTop: '4px', overflowWrap: 'anywhere' }));
      destinoAtual.appendChild(criarDiv('Celular desejado: ' + (l.celularDesejado || '(sem celular válido no CRM)'), { color: l.difereCelular ? CORES.aviso : CORES.texto, fontSize: '11.5px', marginTop: '4px' }));
      const controles = criarDiv('', { display: 'flex', flexDirection: 'column', gap: '3px' });
      if (l.avisoDados) {
        controles.appendChild(criarDiv(l.avisoDados, { color: CORES.aviso, fontSize: '11px', marginBottom: '3px' }));
      }
      if (l.precisaConfirmar) {
        controles.appendChild(criarDiv('Revisão necessária: ' + (l.status || 'confirme a correspondência.'), { color: CORES.aviso, fontSize: '11px', marginBottom: '3px' }));
        if (l.cliente && l.crm && !l.erroLeitura) {
          controles.appendChild(criarCheckboxSync('Confirmo que este contato pertence a este cliente', l.confirmada, false, (v) => { l.confirmada = v; desenharLinhasGoogle(destino, estado); }));
        }
      } else if (l.status) {
        controles.appendChild(criarDiv(l.status, { color: l.erroLeitura ? CORES.erro : CORES.destaque, fontSize: '11px', marginBottom: '3px' }));
      }
      const podeAplicar = Boolean(l.cliente && l.crm && l.editavel && !l.erroLeitura && (!l.precisaConfirmar || l.confirmada));
      if (l.difereNome) controles.appendChild(criarCheckboxSync('Atualizar nome', l.aplicarNome, !podeAplicar, (v) => { l.aplicarNome = v; desenharLinhasGoogle(destino, estado); }));
      if (l.difereCelular) {
        controles.appendChild(criarCheckboxSync('Atualizar celular', l.aplicarCelular, !podeAplicar, (v) => { l.aplicarCelular = v; desenharLinhasGoogle(destino, estado); }));
        const seletor = document.createElement('select');
        Object.assign(seletor.style, { width: '100%', marginTop: '4px', fontSize: '11px', padding: '4px', border: '1px solid ' + CORES.borda, borderRadius: '4px' });
        const adicionar = document.createElement('option');
        adicionar.value = '-1';
        adicionar.textContent = 'Adicionar celular e preservar os atuais';
        seletor.appendChild(adicionar);
        l.telefones.forEach((p, i) => {
          if (!p.celular) return;
          const op = document.createElement('option');
          op.value = String(i);
          op.textContent = 'Substituir ' + p.value;
          seletor.appendChild(op);
        });
        seletor.value = String(l.indiceTelefone ?? -1);
        seletor.disabled = !podeAplicar;
        seletor.addEventListener('change', () => { l.indiceTelefone = Number(seletor.value); desenharLinhasGoogle(destino, estado); });
        controles.appendChild(seletor);
      }
      if (l.cliente) controles.appendChild(criarLinkAbrir(l.cliente));
      item.append(empresa, destinoAtual, controles);
      destino.appendChild(item);
    });
    if (totalPaginas > 1) {
      const navegacao = criarDiv('', { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', margin: '8px 0' });
      const anterior = criarBotao('Página anterior', 'pagina-google-anterior', false);
      anterior.disabled = estado.googlePagina === 0;
      anterior.addEventListener('click', () => { estado.googlePagina = Math.max(0, estado.googlePagina - 1); desenharLinhasGoogle(destino, estado, resumo); });
      const contador = criarDiv('Página ' + (estado.googlePagina + 1) + ' de ' + totalPaginas + ' · ' + visiveisTodas.length + ' linhas', { color: CORES.apagado, fontSize: '11px' });
      const proxima = criarBotao('Próxima página', 'pagina-google-proxima', false);
      proxima.disabled = estado.googlePagina >= totalPaginas - 1;
      proxima.addEventListener('click', () => { estado.googlePagina = Math.min(totalPaginas - 1, estado.googlePagina + 1); desenharLinhasGoogle(destino, estado, resumo); });
      navegacao.append(anterior, contador, proxima);
      destino.appendChild(navegacao);
    }
    const selecionadas = linhas.filter((l) => l.cliente && l.editavel && !l.erroLeitura && (!l.precisaConfirmar || l.confirmada) && (l.aplicarNome || l.aplicarCelular));
    const aplicar = criarBotao('Aplicar correções selecionadas no Google (' + selecionadas.length + ')', 'aplicar-google-selecionados', true);
    aplicar.disabled = selecionadas.length === 0 || estado.googleGravando;
    aplicar.style.opacity = aplicar.disabled ? '0.5' : '1';
    aplicar.addEventListener('click', () => aplicarCorrecoesGoogle(estado));
    destino.appendChild(aplicar);
    if (estado.googleGravando) destino.appendChild(criarDiv('Atualizando contatos no Google em sequência…', { color: CORES.texto, fontSize: '12px', marginTop: '6px' }));
  }

  async function aplicarCorrecoesGoogle(estado) {
    const api = window.__googleContactsApi;
    if (!api || estado.googleGravando) return;
    const selecionadas = (estado.googleLinhas || []).filter((l) => l.cliente && l.editavel && !l.erroLeitura && !l.dadosInsuficientes && (!l.precisaConfirmar || l.confirmada) && (l.aplicarNome || l.aplicarCelular));
    if (selecionadas.length === 0) return;

    const resumirTelefones = (valores) => (valores || []).map((telefone) => String(telefone?.value || '')).filter(Boolean).join(' · ') || '(nenhum)';
    const telefonesDepois = (linha) => {
      const valores = Array.isArray(linha.pessoa?.phoneNumbers) ? linha.pessoa.phoneNumbers.map((telefone) => ({ value: String(telefone?.value || ''), type: telefone?.type })) : [];
      if (!linha.aplicarCelular) return resumirTelefones(valores);
      if (Number.isInteger(linha.indiceTelefone) && linha.indiceTelefone >= 0) {
        if (linha.indiceTelefone < valores.length) valores[linha.indiceTelefone] = Object.assign({}, valores[linha.indiceTelefone], { value: linha.celularDesejado });
      } else {
        const digitosDesejados = String(linha.celularDesejado || '').replace(/\D/g, '');
        if (!valores.some((telefone) => String(telefone.value || '').replace(/\D/g, '') === digitosDesejados)) valores.push({ value: linha.celularDesejado, type: 'mobile' });
      }
      return resumirTelefones(valores);
    };
    const amostra = selecionadas.slice(0, 5).map((linha) => {
      const nomeAntes = linha.nomeAtual || '(sem nome)';
      const nomeDepois = linha.aplicarNome ? linha.nomeDesejado : nomeAntes;
      const telefonesAntes = resumirTelefones(linha.pessoa?.phoneNumbers);
      const telefonesNovos = telefonesDepois(linha);
      return (linha.cliente.razaoSocial || linha.parsed.razao || linha.pessoa.resourceName) +
        '\n  Antes: ' + nomeAntes + ' | ' + telefonesAntes +
        '\n  Depois: ' + nomeDepois + ' | ' + telefonesNovos;
    }).join('\n');
    const sufixoAmostra = selecionadas.length > 5 ? '\n… e mais ' + (selecionadas.length - 5) + ' contato(s).' : '';
    if (!window.confirm('Prévia de ' + selecionadas.length + ' contato(s) que seriam atualizados no Google. Campos não selecionados serão preservados.\n\n' + amostra + sufixoAmostra + '\n\nContinuar para gerar o backup JSON antes de gravar?')) return;

    if (!baixarBackupGoogle(selecionadas)) {
      estado.googleResumo = 'Nenhuma alteração enviada: não foi possível preparar o backup JSON. Tente novamente antes de aplicar.';
      if (estado.redesenharGoogle) estado.redesenharGoogle();
      return;
    }
    if (!window.confirm('O SmartTable solicitou o download do backup JSON com os nomes e telefones originais de ' + selecionadas.length + ' contato(s). Confirme que o arquivo foi salvo antes de continuar com as gravações. Deseja aplicar as correções agora?')) {
      estado.googleResumo = 'Nenhuma alteração enviada. O lote foi cancelado após a etapa de backup.';
      if (estado.redesenharGoogle) estado.redesenharGoogle();
      return;
    }

    estado.googleGravando = true;
    estado.ultimaRodadaUndo = [];
    if (estado.redesenharGoogle) estado.redesenharGoogle();
    let sucesso = 0;
    let falha = 0;
    let paradasPorAutorizacao = false;
    let restantesNaoEnviadas = 0;
    for (let indice = 0; indice < selecionadas.length; indice += 1) {
      const linha = selecionadas[indice];
      const alteracoes = {};
      const original = {
        names: Array.isArray(linha.pessoa?.names) ? linha.pessoa.names.map((nome) => Object.assign({}, nome)) : [],
        phoneNumbers: Array.isArray(linha.pessoa?.phoneNumbers) ? linha.pessoa.phoneNumbers.map((telefone) => ({
          value: String(telefone?.value || ''),
          ...(telefone?.type ? { type: telefone.type } : {}),
          ...(telefone?.label && !telefone?.type ? { label: telefone.label } : {}),
        })) : [],
      };
      // Guarda o estado anterior antes de enviar o PATCH; se houver timeout ambíguo, o ETag do undo decide.
      const registroUndo = { linha, pessoaAtualizada: linha.pessoa, original };
      estado.ultimaRodadaUndo.push(registroUndo);
      if (linha.aplicarNome) alteracoes.nome = linha.nomeDesejado;
      if (linha.aplicarCelular) {
        alteracoes.celular = linha.celularDesejado;
        alteracoes.indiceTelefone = Number.isInteger(linha.indiceTelefone) && linha.indiceTelefone >= 0 ? linha.indiceTelefone : null;
      }
      linha.estadoOperacao = 'atualizando';
      linha.status = 'Atualizando no Google…';
      if (estado.redesenharGoogle) estado.redesenharGoogle();
      try {
        const r = await api.atualizarContato(linha.pessoa, alteracoes);
        if (r.ok) {
          linha.pessoa = r.pessoa;
          linha.status = 'Atualização aceita pelo Google.';
          linha.estadoOperacao = 'atualizado';
          calcularDiferencasGoogle(linha);
          linha.confirmada = false;
          linha.estadoOperacao = 'atualizado';
          linha.status = 'Atualização aplicada; desfazer disponível enquanto o ETag não mudar.';
          registroUndo.pessoaAtualizada = r.pessoa;
          sucesso += 1;
        } else {
          linha.status = r.mensagem || 'O Google não confirmou a atualização.';
          linha.pessoa = r.pessoa || linha.pessoa;
          linha.erroLeitura = Boolean(r.conflito);
          linha.estadoOperacao = 'falha';
          linha.aplicarNome = false;
          linha.aplicarCelular = false;
          estado.ultimaRodadaUndo = estado.ultimaRodadaUndo.filter((entrada) => entrada !== registroUndo);
          falha += 1;
        }
      } catch (erro) {
        linha.status = erro?.message || 'Falha ao atualizar o contato no Google.';
        linha.estadoOperacao = 'falha';
        linha.aplicarNome = false;
        linha.aplicarCelular = false;
        falha += 1;
        const mensagem = String(erro?.message || '');
        if (/\b401\b|\b403\b|recusou o acesso|recusou a autorização|autorização expirou/i.test(mensagem)) {
          estado.ultimaRodadaUndo = estado.ultimaRodadaUndo.filter((entrada) => entrada !== registroUndo);
        }
        if (/\b401\b|autorização expirou|recusou a autorização/i.test(mensagem) || !api.status().conectado) {
          paradasPorAutorizacao = true;
          restantesNaoEnviadas = selecionadas.length - indice - 1;
          break;
        }
      }
      if (indice < selecionadas.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    estado.googleGravando = false;
    estado.googleResumo = 'Resultado desta rodada: ' + sucesso + ' contato(s) atualizado(s); ' + falha + ' falha(s)/conflito(s).' +
      (paradasPorAutorizacao ? ' Lote interrompido por falha de autorização; ' + restantesNaoEnviadas + ' atualização(ões) restante(s) não foram enviadas.' : '') +
      ' Backup JSON gerado antes da gravação. Use “Desfazer última rodada” para restaurar os dados, desde que o ETag não tenha mudado.';
    if (estado.redesenharGoogle) estado.redesenharGoogle();
  }

  function criarSincronizacaoGoogle(painel, estado) {
    const api = window.__googleContactsApi;
    if (!api) return false;
    const secao = criarDiv('', { border: '1px solid ' + CORES.borda, borderRadius: '8px', padding: '10px', margin: '8px 0' });
    secao.dataset.papel = 'sincronizacao-direta-google';
    secao.appendChild(criarDiv('Sincronização direta com Google Contacts', { color: CORES.tinta, fontWeight: '700', fontSize: '13px' }));
    secao.appendChild(criarDiv('Compara os nomes e celulares atuais do Google com o responsável financeiro do CRM. Marque os campos que deseja corrigir; nada é gravado até você confirmar. O CSV para novos contatos continua disponível no fluxo abaixo.', { color: CORES.apagado, fontSize: '11.5px', margin: '3px 0 8px' }));
    const linhaId = criarDiv('', { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });
    const campoId = document.createElement('input');
    campoId.type = 'text';
    campoId.value = api.getClientId();
    campoId.placeholder = 'OAuth Client ID (*.apps.googleusercontent.com)';
    campoId.setAttribute('aria-label', 'OAuth Client ID do Google');
    Object.assign(campoId.style, { flex: '1 1 320px', minWidth: '220px', padding: '6px 8px', border: '1px solid ' + CORES.borda, borderRadius: '5px', fontSize: '11.5px' });
    const salvarId = criarBotao('Salvar Client ID', 'salvar-google-client-id', false);
    linhaId.append(campoId, salvarId);
    secao.appendChild(linhaId);
    secao.appendChild(criarDiv('Configure no Google Cloud a People API e um OAuth Client ID do tipo Web para a origem https://texhub.texcotton.com.br. O escopo solicitado é contacts. O Client ID não é um segredo; o token de acesso permanece somente na memória desta página.', { color: CORES.apagado, fontSize: '10.5px', margin: '5px 0 8px' }));
    const acoes = criarDiv('', { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });
    const conectar = criarBotao('Conectar Google', 'conectar-google', true);
    const desconectar = criarBotao('Desconectar', 'desconectar-google', false);
    const lerGoogle = criarBotao('Ler contatos e preparar correções', 'ler-google-contatos', false);
    acoes.append(conectar, desconectar, lerGoogle);
    secao.appendChild(acoes);
    const statusEl = criarDiv('', { color: CORES.texto, fontSize: '11.5px', margin: '6px 0' });
    statusEl.dataset.papel = 'status-google-api';
    secao.appendChild(statusEl);
    const resultado = criarDiv('');
    resultado.dataset.papel = 'resultado-google-api';
    secao.appendChild(resultado);
    function atualizarStatus(texto, { manterTexto = false } = {}) {
      const st = api.status();
      if (texto) statusEl.textContent = texto;
      else if (!manterTexto) {
        if (estado.googleErroBiblioteca) statusEl.textContent = estado.googleErroBiblioteca;
        else if (st.conectado) statusEl.textContent = 'Google conectado nesta sessão. Tokens não são persistidos.';
        else if (!estado.googleBibliotecaPronta) statusEl.textContent = st.configurado
          ? 'Client ID configurado. Clique em Conectar Google para carregar a biblioteca; depois clique novamente para autorizar.'
          : 'Configure o OAuth Client ID; a biblioteca será carregada ao iniciar a conexão.';
        else if (st.configurado) statusEl.textContent = 'Client ID configurado. Conecte a conta Google para ler e atualizar contatos.';
        else statusEl.textContent = 'Configure o OAuth Client ID antes de conectar.';
      }
      conectar.disabled = !st.configurado || estado.googleGravando || estado.googleLendo;
      desconectar.disabled = !st.conectado || estado.googleGravando || estado.googleLendo;
      lerGoogle.disabled = !st.conectado || estado.googleGravando || estado.googleLendo;
      salvarId.disabled = estado.googleGravando || estado.googleLendo;
    }
    estado.googleLinhas = [];
    estado.googleResumo = '';
    estado.googleResumoInicial = '';
    estado.googlePagina = 0;
    estado.ultimaRodadaUndo = [];
    estado.googleGravando = false;
    estado.googleLendo = false;
    estado.googleBibliotecaPronta = Boolean(window.google?.accounts?.oauth2);
    estado.googleErroBiblioteca = '';
    estado.redesenharGoogle = () => {
      desenharLinhasGoogle(resultado, estado, estado.googleResumoInicial || undefined);
      atualizarStatus();
    };
    salvarId.addEventListener('click', () => {
      const r = api.configurarClientId(campoId.value);
      atualizarStatus(r.ok ? 'Client ID salvo neste navegador.' : r.erro);
      if (!r.ok) util()?.toast?.(r.erro, 5000);
    });
    conectar.addEventListener('click', async () => {
      if (!api.status().configurado) { atualizarStatus('Configure primeiro o OAuth Client ID.'); return; }
      if (!estado.googleBibliotecaPronta) {
        estado.googleLendo = true;
        atualizarStatus('Carregando a biblioteca de autorização do Google…');
        try {
          await api.prepararBiblioteca();
          estado.googleBibliotecaPronta = true;
          estado.googleErroBiblioteca = '';
          atualizarStatus('Biblioteca pronta. Clique em Conectar Google novamente para autorizar.');
        } catch (erro) {
          estado.googleErroBiblioteca = erro?.message || 'Não foi possível carregar a biblioteca de autorização do Google.';
          atualizarStatus(estado.googleErroBiblioteca);
        } finally {
          estado.googleLendo = false;
          atualizarStatus('', { manterTexto: true });
        }
        return;
      }
      conectar.disabled = true;
      atualizarStatus('Aguardando autorização do Google…');
      try {
        await api.conectar();
        atualizarStatus('Google conectado nesta sessão. Tokens não são persistidos.');
      } catch (erro) {
        atualizarStatus(erro?.message || 'Falha ao conectar a conta Google.');
      } finally { atualizarStatus('', { manterTexto: true }); }
    });
    desconectar.addEventListener('click', async () => {
      await api.desconectar();
      estado.googleLinhas = [];
      estado.googleResumo = '';
      resultado.textContent = '';
      atualizarStatus('Conta Google desconectada nesta sessão.');
    });
    lerGoogle.addEventListener('click', async () => {
      if (!api.status().conectado) { atualizarStatus('Conecte a conta Google antes de consultar os contatos.'); return; }
      if (estado.googleLendo) return;
      estado.googleLendo = true;
      atualizarStatus('Lendo contatos do Google…');
      resultado.textContent = '';
      try {
        const pessoas = await api.listarContatos();
        if (!painelDoEstadoAberto(estado)) return;
        atualizarStatus('Foram lidos ' + pessoas.length + ' contatos editáveis. Relacionando aos clientes do CRM…');
        const montado = await prepararLinhasGoogle(pessoas, estado, (feitos, total) => atualizarStatus('Lendo responsáveis no CRM: ' + feitos + ' de ' + total + '…'));
        if (!painelDoEstadoAberto(estado)) return;
        estado.googleLinhas = montado.linhas;
        estado.googlePagina = 0;
        estado.googleResumoInicial = pessoas.length + ' contato(s) Google lidos · ' + montado.comDiferenca + ' com divergência · ' + (montado.dadosInsuficientes || 0) + ' com dados insuficientes · ' + montado.jaIguais + ' já conferem · ' + montado.clientesLidos + ' cliente(s) consultados no CRM.';
        estado.googleResumo = montado.semPadrao + ' contato(s) sem CNPJ padronizado; ' + montado.semVinculo + ' sem vínculo inequívoco. Esses casos não são alterados sem revisão.';
        desenharLinhasGoogle(resultado, estado, estado.googleResumoInicial);
        atualizarStatus('Prévia pronta. Selecione os campos e confirme a aplicação no Google.');
      } catch (erro) {
        atualizarStatus(erro?.message || 'Não foi possível consultar o Google Contacts.');
      } finally {
        estado.googleLendo = false;
        atualizarStatus('', { manterTexto: true });
      }
    });
    painel.appendChild(secao);
    atualizarStatus();
    return true;
  }

  function fecharPainel() {
    // Aborta leituras e remove o CSS isolado da central de página inteira.
    controlador?.abort();
    controlador = null;
    document.getElementById(CONFIG_LISTA.ID_PAINEL + '-styles')?.remove();
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
    estadoDoPainel = null;
  }

  async function abrirPainel() {
    if (!G()) {
      util()?.toast?.('Contatos do Google não carregou (veja o console).');
      return;
    }
    util()?.fecharOutrosPaineis?.('contatosGoogleLista');
    fecharPainel();
    controlador = new window.AbortController();

    const estiloId = CONFIG_LISTA.ID_PAINEL + '-styles';
    document.getElementById(estiloId)?.remove();
    const estilo = document.createElement('style');
    estilo.id = estiloId;
    estilo.textContent = '.stcg-app{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;overflow:hidden;background:#f4f7fb;color:#1c3046;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.stcg-app *{box-sizing:border-box}.stcg-top{height:60px;flex:0 0 60px;background:#fff;border-bottom:1px solid #e3eaf1;display:flex;align-items:center;justify-content:space-between;padding:0 22px;gap:12px}.stcg-brand{display:flex;align-items:center;gap:10px}.stcg-logo{width:36px;height:36px;display:grid;place-items:center;background:#194b7d;border-radius:10px;color:#fff;font-weight:800;font-size:18px}.stcg-brand b{display:block;font-size:14px;color:#1b3047}.stcg-brand small{display:block;color:#8391a2;font-size:10px;margin-top:1px}.stcg-top-right{display:flex;align-items:center;gap:12px}.stcg-top-status{border:1px solid #e2e9f1;border-radius:6px;background:#f8fafc;color:#6d7f93;padding:5px 9px;font-size:10px;font-weight:700}.stcg-close,.stcg-menu{height:33px;width:33px;display:grid;place-items:center;border:1px solid #e0e7ee;background:#fff;border-radius:7px;color:#667a90;font-size:19px;cursor:pointer}.stcg-menu{display:none}.stcg-body{display:grid;grid-template-columns:235px minmax(0,1fr);flex:1;min-height:0}.stcg-sidebar{display:flex;flex-direction:column;background:#fff;border-right:1px solid #e3eaf1;min-height:0;padding:16px 12px;overflow:auto}.stcg-nav-caption{font-size:9px;font-weight:800;letter-spacing:1px;color:#9aa5b2;padding:8px 10px 10px}.stcg-nav{display:flex;flex-direction:column;gap:4px}.stcg-nav button{width:100%;display:flex;align-items:center;gap:10px;min-height:41px;border:0;background:transparent;border-radius:7px;padding:0 10px;color:#697b8e;text-align:left;font:500 11.5px system-ui,sans-serif;cursor:pointer}.stcg-nav button:hover{background:#f5f8fc;color:#245783}.stcg-nav button.active{background:#edf4fd;color:#1e5287;font-weight:750}.stcg-nav-icon{width:20px;text-align:center;font-size:16px}.stcg-nav-label{flex:1}.stcg-count{background:#eef2f6;color:#718197;border-radius:5px;padding:2px 6px;font-size:9px;font-weight:800}.stcg-count.warn{background:#fff0dc;color:#af7022}.stcg-sidebar-space{flex:1;min-height:24px}.stcg-private-note{border:1px solid #e8edf3;background:#f8fafc;border-radius:8px;padding:11px;margin:14px 2px 10px;color:#8291a1;font-size:10px;line-height:1.55}.stcg-private-note b{display:block;color:#41566e;font-size:10.5px;margin-bottom:4px}.stcg-side-foot{border-top:1px solid #edf1f5;padding:10px 8px 0;color:#9aa5b2;font-size:9px;line-height:1.5}.stcg-stage{min-height:0;min-width:0;overflow:auto;padding:24px 27px 18px}.stcg-view{display:none;max-width:1500px;margin:0 auto}.stcg-view.active{display:block}.stcg-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:15px;margin-bottom:17px}.stcg-eyebrow{color:#7d8da0;font-size:9px;font-weight:800;letter-spacing:1px;margin-bottom:7px}.stcg-page-title{font-size:25px;line-height:1.2;font-weight:800;letter-spacing:-.7px;color:#1b3046;margin:0}.stcg-page-desc{font-size:11px;color:#8592a1;margin:7px 0 0;line-height:1.55}.stcg-actions{display:flex;align-items:center;gap:7px}.stcg-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;border:1px solid #dce4ed;border-radius:7px;padding:8px 12px;background:#fff;color:#455970;font:650 10.5px system-ui,sans-serif;cursor:pointer;white-space:nowrap}.stcg-btn:hover{background:#f8fafc;border-color:#c5d3e1}.stcg-btn.primary{background:#1d4f82;color:#fff;border-color:#1d4f82}.stcg-btn.primary:hover{background:#173f6b}.stcg-btn.soft{background:#f2f7fd;border-color:#dae7f5;color:#2e6395}.stcg-btn:disabled{opacity:.45;cursor:not-allowed}.stcg-alert{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid #e4eaf1;background:#fff;border-radius:8px;color:#718297;font-size:10.5px;line-height:1.55;margin-bottom:14px}.stcg-alert.warn{background:#fff9ef;border-color:#f0e2c9;color:#916b35}.stcg-alert.good{background:#f2faf5;border-color:#dcefe3;color:#43815e}.stcg-alert.error{background:#fff3f2;border-color:#f1d9d6;color:#a54f49}.stcg-panel{background:#fff;border:1px solid #e4eaf1;border-radius:10px;box-shadow:0 2px 5px #1b304506;min-width:0;overflow:hidden}.stcg-panel-head{padding:15px 16px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.stcg-panel-title{font-size:12px;font-weight:800;color:#30475f}.stcg-panel-sub{font-size:10px;color:#8794a3;margin-top:4px;line-height:1.55}.stcg-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:11px;margin-bottom:15px}.stcg-metric{padding:13px 13px 11px;border:1px solid #e4eaf1;background:#fff;border-radius:9px;min-width:0}.stcg-metric-label{font-size:10px;font-weight:650;color:#75869a;line-height:1.35;min-height:27px}.stcg-metric-value{font-size:25px;font-weight:800;line-height:1.2;letter-spacing:-.6px;color:#223950;margin-top:5px}.stcg-metric-foot{color:#929eac;font-size:9px;margin-top:6px;line-height:1.45}.stcg-metric.warn .stcg-metric-value{color:#b47927}.stcg-metric.danger .stcg-metric-value{color:#ad5e58}.stcg-metric.good .stcg-metric-value{color:#39815b}.stcg-dash-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(250px,.8fr);gap:14px;align-items:start}.stcg-dash-card{padding:16px}.stcg-dash-desc{color:#8794a3;font-size:10px;line-height:1.55;margin-top:5px}.stcg-progress-head{display:flex;justify-content:space-between;gap:9px;margin:15px 0 7px;color:#8090a0;font-size:10px}.stcg-progress-head b{color:#3d566e}.stcg-progress{height:6px;background:#edf1f5;border-radius:8px;overflow:hidden}.stcg-progress span{display:block;height:100%;width:0;background:#4b986d;border-radius:8px}.stcg-detail-line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #edf1f5;margin-top:10px;font-size:10px;color:#7f8d9d}.stcg-detail-line b{color:#40576e;font-size:10px}.stcg-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:14px}.stcg-shortcut{display:flex;align-items:flex-start;gap:10px;text-align:left;min-width:0;padding:12px;border:1px solid #e5ebf2;background:#fff;border-radius:8px;cursor:pointer}.stcg-shortcut:hover{background:#f9fbfe;border-color:#bfd0e3}.stcg-shortcut-icon{flex-shrink:0;display:grid;place-items:center;width:30px;height:30px;background:#edf4fd;color:#356da5;border-radius:8px;font-size:16px}.stcg-shortcut b{display:block;color:#344c65;font-size:10.5px;margin:1px 0 4px}.stcg-shortcut small{display:block;color:#8b98a6;font-size:9.5px;line-height:1.45}.stcg-status{display:inline-flex;align-items:center;gap:6px;padding:5px 7px;border-radius:5px;font-size:9px;font-weight:750;white-space:nowrap}.stcg-status:before{content:\"\";width:5px;height:5px;border-radius:50%;background:currentColor}.stcg-status.ready{color:#39815b;background:#edf8f1}.stcg-status.review{color:#ad7527;background:#fff5e5}.stcg-status.blocked{color:#ad5b57;background:#fff0ef}.stcg-status.neutral{color:#718197;background:#f0f3f7}.stcg-toolbar{display:flex;align-items:center;gap:8px;padding:0 15px 12px;flex-wrap:wrap}.stcg-search{display:flex;align-items:center;flex:1;min-width:190px;gap:8px;min-height:35px;border:1px solid #dfe6ee;border-radius:7px;padding:0 10px}.stcg-search input{min-width:0;flex:1;border:0;outline:none;background:transparent;color:#314a63;font:10.5px system-ui,sans-serif}.stcg-tabs{display:flex;gap:16px;padding:0 16px;overflow:auto;border-bottom:1px solid #e9edf2}.stcg-tabs button{position:relative;background:transparent;border:0;padding:10px 0;color:#8592a1;font:650 10px system-ui,sans-serif;white-space:nowrap;cursor:pointer}.stcg-tabs button.active{color:#235c93}.stcg-tabs button.active:after{content:\"\";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:#2a68a4}.stcg-table-wrap{overflow:auto;width:100%}.stcg-table{width:100%;min-width:720px;border-collapse:collapse;text-align:left}.stcg-table th{padding:10px 9px;background:#fafbfd;border-bottom:1px solid #edf0f4;color:#98a3b1;font-size:8px;letter-spacing:.4px;white-space:nowrap}.stcg-table td{padding:12px 9px;border-bottom:1px solid #eff2f5;color:#5d6e82;font-size:10px;vertical-align:middle}.stcg-table tbody tr:hover{background:#fbfdff}.stcg-table input[type=checkbox]{width:14px;height:14px;accent-color:#245f99}.stcg-company{font-size:10.5px;font-weight:750;color:#2f465d}.stcg-cnpj{font-size:9px;color:#98a4b1;margin-top:3px}.stcg-person{display:flex;align-items:center;gap:7px;white-space:nowrap}.stcg-avatar{width:24px;height:24px;border-radius:7px;background:#edf3f9;color:#456888;display:grid;place-items:center;font-size:8px;font-weight:800;flex-shrink:0}.stcg-row-action{border:0;background:transparent;color:#2d679f;font-size:9.5px;font-weight:750;cursor:pointer}.stcg-list{display:flex;flex-direction:column}.stcg-item{display:flex;align-items:flex-start;gap:11px;padding:13px 16px;border-top:1px solid #edf1f5}.stcg-item-main{flex:1;min-width:0}.stcg-item-title{font-size:10.5px;font-weight:750;color:#30465d}.stcg-item-desc{font-size:10px;line-height:1.55;color:#8290a0;margin-top:4px;overflow-wrap:anywhere}.stcg-item-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}.stcg-empty{padding:34px 15px;text-align:center;color:#8d9aa8;font-size:10.5px;line-height:1.6}.stcg-empty b{display:block;color:#485d73;font-size:12px;margin-bottom:5px}.stcg-csv-card{display:flex;align-items:flex-start;gap:13px;padding:16px;border-bottom:1px solid #edf1f5}.stcg-csv-card:last-child{border-bottom:0}.stcg-csv-icon{display:grid;place-items:center;flex-shrink:0;width:39px;height:39px;border-radius:9px;background:#edf5ff;color:#477cb8;font-size:18px}.stcg-csv-icon.amber{background:#fff4e3;color:#b77b29}.stcg-csv-icon.green{background:#ebf8f0;color:#428e63}.stcg-csv-main{flex:1;min-width:0}.stcg-csv-main b{color:#344c63;font-size:11.5px}.stcg-csv-main p{color:#8491a0;font-size:10.5px;line-height:1.6;margin:5px 0 10px;max-width:680px}.stcg-csv-status{color:#658b71;font-size:10px;margin-top:8px;min-height:15px;line-height:1.5}.stcg-csv-status.error{color:#ad5d56}.stcg-file-input{display:none}.stcg-api-container{padding:0 0 12px;overflow-x:auto}.stcg-api-container>div{max-width:none!important}.stcg-footer{padding-top:14px;text-align:center;color:#99a4b1;font-size:9px}@media(max-width:1200px){.stcg-stage{padding:20px}.stcg-body{grid-template-columns:220px minmax(0,1fr)}.stcg-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.stcg-dash-grid{grid-template-columns:1fr}.stcg-metric:nth-child(4),.stcg-metric:nth-child(5){min-height:94px}}@media(max-width:760px){.stcg-top{height:55px;flex-basis:55px;padding:0 11px}.stcg-brand small,.stcg-top-status{display:none}.stcg-menu{display:grid}.stcg-body{display:block;position:relative}.stcg-sidebar{position:absolute;inset:0 auto 0 0;z-index:10;width:255px;max-width:85vw;transform:translateX(-105%);transition:transform .18s;box-shadow:none}.stcg-sidebar.mobile-open{transform:translateX(0);box-shadow:10px 0 30px #18304730}.stcg-stage{height:100%;padding:16px 12px}.stcg-page-head{align-items:flex-start;flex-direction:column;gap:12px}.stcg-page-title{font-size:22px}.stcg-actions{width:100%;flex-wrap:wrap}.stcg-actions .stcg-btn{flex:1}.stcg-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.stcg-metric{padding:11px}.stcg-metric-value{font-size:22px}.stcg-shortcuts{grid-template-columns:1fr}.stcg-toolbar{padding:0 11px 11px}.stcg-search{flex-basis:100%}.stcg-csv-card{padding:13px}.stcg-csv-main{flex-basis:calc(100% - 55px)}.stcg-item{padding:12px;gap:8px}.stcg-item-side{max-width:105px}.stcg-tabs{gap:13px}.stcg-footer{text-align:left;line-height:1.5}}';
    document.head.appendChild(estilo);

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_LISTA.ID_PAINEL;
    painelEl.className = 'stcg-app';

    const el = (tag, classe, texto) => {
      const n = document.createElement(tag);
      if (classe) n.className = classe;
      if (texto !== undefined && texto !== null) n.textContent = String(texto);
      return n;
    };
    const botao = (texto, classe, acao) => {
      const b = el('button', 'stcg-btn ' + (classe || ''), texto);
      b.type = 'button';
      if (acao) b.addEventListener('click', acao);
      return b;
    };
    const cabecalhoPagina = (secao, titulo, descricao) => {
      const cab = el('div', 'stcg-page-head');
      const texto = el('div', '');
      texto.append(el('div', 'stcg-eyebrow', 'SMARTTABLE  /  CONTATOS GOOGLE'));
      texto.append(el('h1', 'stcg-page-title', titulo));
      texto.append(el('p', 'stcg-page-desc', descricao));
      cab.append(texto);
      secao.append(cab);
    };
    const criarView = (id, titulo, descricao) => {
      const secao = el('section', 'stcg-view');
      secao.dataset.view = id;
      cabecalhoPagina(secao, titulo, descricao);
      return secao;
    };

    const topo = el('header', 'stcg-top');
    const marca = el('div', 'stcg-brand');
    const menuMobile = el('button', 'stcg-menu', '☰');
    menuMobile.type = 'button';
    menuMobile.setAttribute('aria-label', 'Abrir menu');
    const logo = el('div', 'stcg-logo', 'S');
    const marcaTexto = el('div', '');
    marcaTexto.append(el('b', '', 'SmartTable · Contatos'));
    marcaTexto.append(el('small', '', 'Central de conferência e sincronização'));
    marca.append(menuMobile, logo, marcaTexto);
    const topDireita = el('div', 'stcg-top-right');
    const estadoGoogle = el('span', 'stcg-top-status', 'Base local não importada');
    const fechar = el('button', 'stcg-close', '×');
    fechar.type = 'button';
    fechar.title = 'Fechar (Esc)';
    fechar.setAttribute('aria-label', 'Fechar Contatos do Google');
    fechar.addEventListener('click', fecharPainel);
    topDireita.append(estadoGoogle, fechar);
    topo.append(marca, topDireita);

    const corpo = el('div', 'stcg-body');
    const lateral = el('aside', 'stcg-sidebar');
    lateral.append(el('div', 'stcg-nav-caption', 'ÁREA DE TRABALHO'));
    const nav = el('nav', 'stcg-nav');
    nav.setAttribute('aria-label', 'Seções de Contatos do Google');
    const configsNav = [
      { id: 'overview', icon: '▦', label: 'Visão geral' },
      { id: 'comparacao', icon: '⇄', label: 'Google CSV → CRM' },
      { id: 'ausentes', icon: '◎', label: 'Sem contato do Google' },
      { id: 'celulares', icon: '▣', label: 'Conferir celulares' },
      { id: 'sincronizar', icon: '↔', label: 'Google direto (API)' },
      { id: 'arquivos', icon: '▤', label: 'Importar / exportar CSV' },
    ];
    const navBtns = {};
    const views = {
      overview: criarView('overview', 'Central de contatos', 'Resumo da base, qualidade dos dados e ações que precisam de atenção.'),
      comparacao: criarView('comparacao', 'Google CSV → CRM', 'Compare os contatos importados com o responsável financeiro de cada cliente.'),
      ausentes: criarView('ausentes', 'Sem contato do Google', 'Revise os clientes sem correspondência e exporte somente os registros elegíveis.'),
      celulares: criarView('celulares', 'Conferência de celulares', 'Compare os dois celulares do CRM com todos os números do CSV importado, sem gravar dados em sistemas externos.'),
      sincronizar: criarView('sincronizar', 'Sincronização direta Google', 'Consulte a agenda real e revise as diferenças antes de aplicar qualquer alteração.'),
      arquivos: criarView('arquivos', 'Importar e exportar CSV', 'Cada arquivo tem uma finalidade separada para evitar misturar novos contatos com correções.'),
    };
    let desenharConferenciaCelulares = () => {};
    const selecionarView = (id) => {
      if (!views[id]) return;
      Object.keys(views).forEach((key) => views[key].classList.toggle('active', key === id));
      Object.keys(navBtns).forEach((key) => navBtns[key].classList.toggle('active', key === id));
      if (window.innerWidth <= 760) lateral.classList.remove('mobile-open');
      if (id === 'ausentes' && estado.levantamento) renderizarAusentes(calcularLinhas(estado.levantamento, undefined, estado.indiceGlobalTelefones));
      if (id === 'celulares') desenharConferenciaCelulares();
    };
    configsNav.forEach((cfg) => {
      const b = el('button', '', '');
      b.type = 'button';
      b.dataset.viewTarget = cfg.id;
      b.append(el('span', 'stcg-nav-icon', cfg.icon), el('span', 'stcg-nav-label', cfg.label));
      if (cfg.id === 'ausentes') {
        const count = el('span', 'stcg-count warn', '0');
        count.dataset.role = 'count-ausentes';
        b.append(count);
      }
      b.addEventListener('click', () => selecionarView(cfg.id));
      navBtns[cfg.id] = b;
      nav.append(b);
    });
    lateral.append(nav);
    const lateralSpace = el('div', 'stcg-sidebar-space');
    const notaPrivacidade = el('div', 'stcg-private-note', '');
    notaPrivacidade.append(el('b', '', 'Dados protegidos'));
    notaPrivacidade.append(el('span', '', 'CSV lido no navegador. A API só grava no Google após prévia, confirmação e backup.'));
    lateral.append(lateralSpace, notaPrivacidade, el('div', 'stcg-side-foot', 'Módulos 28 · 29 · 33 · 36'));
    const palco = el('main', 'stcg-stage');
    Object.values(views).forEach((v) => palco.append(v));

    const estado = {
      painel: painelEl, signal: controlador.signal, levantamento: null, feitos: [], mensagens: new Map(),
      escolhidos: new Map(), armado: null, relogioDaConfirmacao: null, editando: null,
      textosDigitados: new Map(), editorVisivel: false, redesenhar: () => {}, lendo: false,
    };
    estadoDoPainel = estado;

    const overviewHeader = views.overview.querySelector('.stcg-page-head');
    const overviewActions = el('div', 'stcg-actions');
    const atualizarBtn = botao('Atualizar conferência', 'soft', () => executarLeitura('Atualizando a conferência do CRM…'));
    atualizarBtn.disabled = true;
    overviewActions.append(atualizarBtn);
    overviewHeader?.append(overviewActions);

    const statusOverview = el('div', 'stcg-alert warn');
    const iconOverview = el('span', '', '◷');
    const textoOverview = el('div', '', 'Consultando a lista de clientes do CRM…');
    statusOverview.append(iconOverview, textoOverview);
    views.overview.append(statusOverview);

    const metricas = el('div', 'stcg-metrics');
    const metricRefs = {};
    [
      ['total', 'Clientes na lista', 'Lista atual do CRM', ''],
      ['google', 'Com contato na base', 'Raiz encontrada no CSV', 'good'],
      ['ausentes', 'Sem contato Google', 'Requerem revisão / exportação', 'warn'],
      ['diferencas', 'Com divergências', 'Nome ou celular diferente', 'danger'],
      ['leitura', 'Sem leitura do CRM', 'Consulta não concluída', ''],
    ].forEach(([key, label, foot, style]) => {
      const card = el('div', 'stcg-metric ' + style);
      card.append(el('div', 'stcg-metric-label', label));
      const value = el('div', 'stcg-metric-value', '—');
      value.dataset.metric = key;
      card.append(value, el('div', 'stcg-metric-foot', foot));
      metricRefs[key] = value;
      metricas.append(card);
    });
    views.overview.append(metricas);

    const gridResumo = el('div', 'stcg-dash-grid');
    const cardBase = el('div', 'stcg-panel stcg-dash-card');
    cardBase.append(el('div', 'stcg-panel-title', 'Estado da conferência'));
    cardBase.append(el('div', 'stcg-dash-desc', 'Resumo atualizado conforme a leitura do CRM termina.'));
    const linhaProgresso = el('div', 'stcg-progress-head');
    const progressLabel = el('span', '', 'Clientes com contato na base CSV');
    const progressValue = el('b', '', '—');
    linhaProgresso.append(progressLabel, progressValue);
    const progress = el('div', 'stcg-progress');
    const progressFill = el('span', '');
    progress.append(progressFill);
    cardBase.append(linhaProgresso, progress);
    const statusBaseLine = el('div', 'stcg-detail-line');
    statusBaseLine.append(el('span', '', 'Base CSV'));
    const statusBaseValue = el('b', '', 'Verificando…');
    statusBaseLine.append(statusBaseValue);
    const statusCrmLine = el('div', 'stcg-detail-line');
    statusCrmLine.append(el('span', '', 'Consulta CRM'));
    const statusCrmValue = el('b', '', 'Em andamento');
    statusCrmLine.append(statusCrmValue);
    cardBase.append(statusBaseLine, statusCrmLine);
    const shortcuts = el('div', 'stcg-shortcuts');
    [
      ['⇄', 'Comparar Google CSV', 'Ver diferenças nos responsáveis.', 'comparacao'],
      ['◎', 'Criar contatos ausentes', 'Gerar CSV dos clientes sem correspondência.', 'ausentes'],
      ['▣', 'Conferir celulares', 'Comparar responsável e cadastro com todos os números importados.', 'celulares'],
      ['▤', 'Gerenciar arquivos', 'Importar, exportar ou corrigir CSV.', 'arquivos'],
      ['↔', 'Sincronização direta', 'Conferir agenda e revisar antes de gravar.', 'sincronizar'],
    ].forEach(([icon, title, desc, target]) => {
      const b = el('button', 'stcg-shortcut');
      b.type = 'button';
      b.append(el('span', 'stcg-shortcut-icon', icon));
      const t = el('div', '');
      t.append(el('b', '', title), el('small', '', desc));
      b.append(t);
      b.addEventListener('click', () => selecionarView(target));
      shortcuts.append(b);
    });
    cardBase.append(shortcuts);

    const cardAlertas = el('div', 'stcg-panel stcg-dash-card');
    cardAlertas.append(el('div', 'stcg-panel-title', 'Pontos de atenção'));
    cardAlertas.append(el('div', 'stcg-dash-desc', 'As tarefas estão separadas por objetivo.'));
    const alertasRefs = {};
    [['ausentes', 'Clientes sem contato'], ['diferencas', 'Contatos divergentes'], ['leitura', 'Clientes sem leitura']].forEach(([key, label]) => {
      const row = el('div', 'stcg-detail-line');
      row.append(el('span', '', label));
      const value = el('b', '', '—');
      row.append(value);
      alertasRefs[key] = value;
      cardAlertas.append(row);
    });
    const notaSeguranca = el('div', 'stcg-alert');
    notaSeguranca.style.marginTop = '13px';
    notaSeguranca.append(el('span', '', '◈'), el('div', '', 'O CSV apenas prepara um arquivo para importação manual. A sincronização direta exige revisão, backup e confirmação.'));
    cardAlertas.append(notaSeguranca);
    gridResumo.append(cardBase, cardAlertas);
    views.overview.append(gridResumo);

    const avisoComparacao = el('div', 'stcg-alert');
    avisoComparacao.append(el('span', '', 'i'), el('div', '', 'Esta tela compara a base CSV importada com o responsável financeiro do CRM. Clientes sem correspondência ficam na seção “Sem contato do Google”.'));
    views.comparacao.append(avisoComparacao);
    const caixaModo = el('div', 'stcg-panel');
    const cabModo = el('div', 'stcg-panel-head');
    cabModo.append(el('div', 'stcg-panel-title', 'Campos comparados: nome e celular'));
    caixaModo.append(cabModo);
    views.comparacao.append(caixaModo);
    const resultado = el('div', '');
    resultado.dataset.papel = 'resultado';
    const andamento = el('div', 'stcg-alert warn');
    andamento.append(el('span', '', '◷'));
    const textoAndamento = el('div', '', 'Consultando os responsáveis no CRM…');
    andamento.append(textoAndamento);
    views.comparacao.append(andamento, resultado);

    const avisoAusentes = el('div', 'stcg-alert warn');
    avisoAusentes.append(el('span', '', '!'), el('div', '', 'Só entram no CSV clientes cujo CRM foi lido e tem dados úteis. Sem telefone válido, o contato pode sair apenas com nome; números não são inventados.'));
    views.ausentes.append(avisoAusentes);
    const cardAusentes = el('div', 'stcg-panel');
    const headAusentes = el('div', 'stcg-panel-head');
    const titulosAusentes = el('div', '');
    titulosAusentes.append(el('div', 'stcg-panel-title', 'Clientes identificados como ausentes'));
    titulosAusentes.append(el('div', 'stcg-panel-sub', 'Revise os dados do CRM e exporte apenas os registros elegíveis.'));
    const acaoAusentes = el('div', 'stcg-actions');
    const baixarAusentes = botao('Baixar CSV dos ausentes', 'primary', () => {
      const calc = estado.levantamento ? calcularLinhas(estado.levantamento, undefined, estado.indiceGlobalTelefones) : null;
      const ausentesCsv = calc ? calc.csvNovos.filter((c) => c.motivo === CSV_MOTIVO_AUSENTE) : [];
      if (!calc?.consultaGoogleAtual && ausentesCsv.length && !window.confirm('A agenda Google não foi verificada em tempo real. O CSV é baseado apenas na última importação local e pode estar desatualizado, gerando duplicatas. Deseja exportar mesmo assim?')) return;
      baixarCsvNovos(ausentesCsv, 'contatos-google-ausentes.csv');
    });
    baixarAusentes.disabled = true;
    acaoAusentes.append(baixarAusentes);
    headAusentes.append(titulosAusentes, acaoAusentes);
    cardAusentes.append(headAusentes);
    const resumoAusentes = el('div', 'stcg-alert');
    resumoAusentes.dataset.role = 'resumo-ausentes';
    cardAusentes.append(resumoAusentes);
    const listaAusentes = el('div', 'stcg-list');
    listaAusentes.dataset.role = 'lista-ausentes';
    cardAusentes.append(listaAusentes);
    views.ausentes.append(cardAusentes);

    const avisoCelulares = el('div', 'stcg-alert');
    avisoCelulares.append(
      el('span', '', 'i'),
      el('div', '', 'Esta conferência compara somente a importação local do Google CSV. Não verifica a agenda em tempo real, não altera o CRM e não cria contatos automaticamente.'),
    );
    views.celulares.append(avisoCelulares);
    const cardCelulares = el('div', 'stcg-panel');
    const cabecalhoCelulares = el('div', 'stcg-panel-head');
    const tituloCelulares = el('div', '');
    tituloCelulares.append(
      el('div', 'stcg-panel-title', 'Prévia dos celulares a conferir'),
      el('div', 'stcg-panel-sub', 'Um contato é exportado por número válido ausente; números compartilhados entre clientes são bloqueados para conferência manual.'),
    );
    const acoesCelulares = el('div', 'stcg-actions');
    const baixarCelulares = botao('Baixar CSV dos celulares ausentes', 'primary', () => {
      if (!estado.conferenciaCelulares?.disponivel) return;
      baixarCsvNovos(estado.conferenciaCelulares.exportaveis, 'contatos-celulares-clientes-ausentes.csv');
    });
    baixarCelulares.disabled = true;
    acoesCelulares.append(baixarCelulares);
    cabecalhoCelulares.append(tituloCelulares, acoesCelulares);
    cardCelulares.append(cabecalhoCelulares);
    const statusCelulares = el('div', 'stcg-alert warn');
    statusCelulares.dataset.role = 'status-conferencia-celulares';
    statusCelulares.append(el('span', '', '◷'), el('div', '', 'Aguardando leitura do CRM…'));
    cardCelulares.append(statusCelulares);
    const resumoCelulares = el('div', 'stcg-panel-sub');
    resumoCelulares.dataset.role = 'resumo-conferencia-celulares';
    resumoCelulares.style.padding = '0 16px 12px';
    cardCelulares.append(resumoCelulares);
    const tabelaCelulares = el('div', 'stcg-table-wrap');
    tabelaCelulares.dataset.role = 'tabela-conferencia-celulares';
    cardCelulares.append(tabelaCelulares);
    views.celulares.append(cardCelulares);

    desenharConferenciaCelulares = async () => {
      const numeroExecucao = (estado.execucaoConferenciaCelulares || 0) + 1;
      estado.execucaoConferenciaCelulares = numeroExecucao;
      const levantamentoAtual = estado.levantamento;
      baixarCelulares.disabled = true;
      tabelaCelulares.textContent = '';
      if (!levantamentoAtual) {
        statusCelulares.className = 'stcg-alert warn';
        statusCelulares.replaceChildren(el('span', '', '◷'), el('div', '', 'A leitura dos clientes do CRM ainda não terminou.'));
        resumoCelulares.textContent = '';
        estado.conferenciaCelulares = null;
        return;
      }
      let indice;
      try {
        indice = await G().lerIndiceGlobalTelefones();
      } catch {
        indice = { disponivel: false, motivo: 'reimportar', chaves: new Set() };
      }
      if (numeroExecucao !== estado.execucaoConferenciaCelulares || levantamentoAtual !== estado.levantamento) return;
      const calculo = calcularConferenciaCelulares(levantamentoAtual, indice);
      estado.conferenciaCelulares = calculo;
      const r = calculo.resumo;
      const metaIndice = G().lerMeta();
      resumoCelulares.textContent = [
        'Clientes analisados: ' + r.totalClientes,
        'Lidos corretamente: ' + r.clientesLidos,
        'Celulares únicos no índice: ' + (indice.disponivel ? indice.chaves.size : 0),
        'CSV importado em: ' + (metaIndice?.importadoEm || 'data indisponível'),
        'Números encontrados no CSV: ' + r.numerosPresentes,
        'Contatos ausentes exportáveis: ' + r.contatosAusentesExportaveis,
        'Para responsável financeiro: ' + r.contatosResponsavelExportaveis,
        'Para celular do cliente: ' + r.contatosClienteExportaveis,
        'Números inválidos ou ausentes no CRM: ' + r.invalidosOuAusentes,
        'Clientes sem leitura: ' + r.clientesSemLeitura,
        'Números ambíguos/compartilhados: ' + r.numerosAmbiguos,
      ].join(' · ');

      let textoStatus = '';
      let classeStatus = 'stcg-alert good';
      if (!calculo.disponivel) {
        classeStatus = 'stcg-alert warn';
        textoStatus = calculo.motivo === 'nao-importado'
          ? 'Importe o CSV do Google Contatos antes de conferir. Nenhum número foi classificado como ausente.'
          : 'A base local não tem o índice telefônico global desta versão. Reimporte o CSV do Google Contatos no Alt+J; nenhuma ausência foi concluída a partir da base antiga.';
      } else {
        textoStatus = 'Comparação concluída com a base local do CSV importado. Isso não confirma o estado atual da agenda Google.';
        if (Number(indice.chavesInvalidasDescartadas || 0) > 0) {
          textoStatus += ' Foram descartadas ' + Number(indice.chavesInvalidasDescartadas) + ' chave(s) inválida(s) do índice; exemplos mascarados: ' + (indice.exemplosChavesInvalidas || []).slice(0, 3).join(', ') + '. Reimporte o CSV para reconstruir o índice.';
          classeStatus = 'stcg-alert warn';
        }
      }
      if (r.clientesSemCamposTelefone > 0) {
        classeStatus = 'stcg-alert warn';
        textoStatus += ' Os campos de telefone do cadastro não estavam disponíveis em ' + r.clientesSemCamposTelefone + ' cliente(s); nenhum número foi inventado.';
      }
      if (r.clientesSemLeitura > 0) {
        classeStatus = 'stcg-alert warn';
        textoStatus += ' Clientes sem leitura da página foram excluídos da classificação de ausência.';
      }
      statusCelulares.className = classeStatus;
      statusCelulares.replaceChildren(el('span', '', classeStatus.includes('warn') ? '!' : '✓'), el('div', '', textoStatus));

      if (calculo.linhas.length === 0) {
        tabelaCelulares.append(el('div', 'stcg-empty', calculo.disponivel
          ? 'Nenhum celular válido disponível para comparação.'
          : 'Reimporte o CSV para habilitar a comparação global de telefones.'));
      } else {
        const tabela = el('table', 'stcg-table');
        const thead = el('thead', '');
        const trCab = el('tr', '');
        ['Empresa', 'Categoria do telefone', 'Número formatado', 'Chave canônica', 'Classificação'].forEach((rotulo) => trCab.append(el('th', '', rotulo)));
        thead.append(trCab);
        const tbody = el('tbody', '');
        calculo.linhas.forEach((linha) => {
          const tr = el('tr', '');
          [linha.empresa, linha.categoria, linha.celular, linha.chave, linha.status].forEach((valor) => tr.append(el('td', '', valor)));
          tbody.append(tr);
        });
        tabela.append(thead, tbody);
        tabelaCelulares.append(tabela);
      }
      baixarCelulares.disabled = !calculo.disponivel || calculo.exportaveis.length === 0;
    };

    const apiContainer = el('div', 'stcg-api-container');
    if (!criarSincronizacaoGoogle(apiContainer, estado)) {
      const falhaApi = el('div', 'stcg-alert warn');
      falhaApi.append(el('span', '', '!'), el('div', '', 'O Módulo 36 (Google Contacts API) não está carregado nesta página.'));
      apiContainer.append(falhaApi);
    }
    views.sincronizar.append(apiContainer);

    const csvImportPanel = el('div', 'stcg-panel');
    const csvImportHead = el('div', 'stcg-panel-head');
    csvImportHead.append(el('div', 'stcg-panel-title', '1. Importar Google CSV'), el('span', 'stcg-status neutral', 'Atualiza a base local'));
    csvImportPanel.append(csvImportHead);
    const importRow = el('div', 'stcg-csv-card');
    importRow.append(el('div', 'stcg-csv-icon green', '⇧'));
    const importMain = el('div', 'stcg-csv-main');
    importMain.append(el('b', '', 'Carregar arquivo exportado do Google Contatos'));
    importMain.append(el('p', '', 'O arquivo é validado e lido no navegador. Importar substitui a base anterior armazenada neste navegador, mas não altera contatos no Google.'));
    const importInput = el('input', 'stcg-file-input');
    importInput.type = 'file';
    importInput.accept = '.csv,text/csv';
    importInput.setAttribute('aria-label', 'Arquivo Google CSV');
    const importStatus = el('div', 'stcg-csv-status', '');
    const importBtn = botao('Selecionar arquivo CSV', 'primary', () => importInput.click());
    importMain.append(importBtn, importInput, importStatus);
    importRow.append(importMain);
    csvImportPanel.append(importRow);
    views.arquivos.append(csvImportPanel);

    const csvAbsentPanel = el('div', 'stcg-panel');
    csvAbsentPanel.style.marginTop = '14px';
    const absentRow = el('div', 'stcg-csv-card');
    absentRow.append(el('div', 'stcg-csv-icon amber', '↓'));
    const absentMain = el('div', 'stcg-csv-main');
    absentMain.append(el('b', '', '2. Exportar contatos de clientes ausentes'));
    absentMain.append(el('p', '', 'Cria um CSV separado dos contatos ausentes no Google. Contatos que só precisam de padronização não entram neste arquivo.'));
    absentMain.append(botao('Revisar clientes ausentes', 'soft', () => selecionarView('ausentes')));
    absentRow.append(absentMain);
    csvAbsentPanel.append(absentRow);
    views.arquivos.append(csvAbsentPanel);

    const csvFixPanel = el('div', 'stcg-panel');
    csvFixPanel.style.marginTop = '14px';
    const fixRow = el('div', 'stcg-csv-card');
    fixRow.append(el('div', 'stcg-csv-icon', '✎'));
    const fixMain = el('div', 'stcg-csv-main');
    fixMain.append(el('b', '', '3. Corrigir CSV existente'));
    fixMain.append(el('p', '', 'Reorganiza somente nomes reconhecidos sem inventar nem remover letras ou números. Contatos pessoais não entram no arquivo de correção.'));
    const fixInput = el('input', 'stcg-file-input');
    fixInput.type = 'file';
    fixInput.accept = '.csv,text/csv';
    fixInput.setAttribute('aria-label', 'CSV a corrigir');
    const fixStatus = el('div', 'stcg-csv-status', '');
    fixMain.append(botao('Selecionar CSV para corrigir', '', () => fixInput.click()), fixInput, fixStatus);
    fixRow.append(fixMain);
    csvFixPanel.append(fixRow);
    views.arquivos.append(csvFixPanel);

    const atualizarDashboard = (calc) => {
      if (!calc || !estado.levantamento) return;
      metricRefs.total.textContent = Number(calc.resumo.totalNaLista || 0).toLocaleString('pt-BR');
      metricRefs.google.textContent = Number(calc.resumo.comContato || 0).toLocaleString('pt-BR');
      const labelContato = metricRefs.google.parentElement?.querySelector('.stcg-metric-label');
      if (labelContato) labelContato.textContent = calc.consultaGoogleAtual ? 'Encontrados no Google atual' : 'Contatos na base CSV';
      metricRefs.ausentes.textContent = Number(calc.resumo.semContato || 0).toLocaleString('pt-BR');
      metricRefs.diferencas.textContent = Number(calc.resumo.comDiferenca || 0).toLocaleString('pt-BR');
      metricRefs.leitura.textContent = Number(calc.resumo.semLeitura || 0).toLocaleString('pt-BR');
      progressValue.textContent = (calc.resumo.comContato || 0) + ' de ' + (calc.resumo.totalNaLista || 0);
      progressFill.style.width = (calc.resumo.totalNaLista ? Math.min(100, calc.resumo.comContato / calc.resumo.totalNaLista * 100) : 0) + '%';
      alertasRefs.ausentes.textContent = String(calc.resumo.semContato || 0);
      alertasRefs.diferencas.textContent = String(calc.resumo.comDiferenca || 0);
      alertasRefs.leitura.textContent = String(calc.resumo.semLeitura || 0);
      statusBaseValue.textContent = G().lerMeta() ? 'CSV importado' : 'Não importada';
      statusCrmValue.textContent = calc.resumo.semLeitura ? 'Parcial' : 'Concluída';
      estadoGoogle.textContent = calc.consultaGoogleAtual ? 'Agenda Google verificada' : (G().lerMeta() ? 'Base CSV importada' : 'Base CSV não importada');
      const badge = nav.querySelector('[data-role="count-ausentes"]');
      if (badge) badge.textContent = String(calc.resumo.semContato || 0);
    };

    function renderizarAusentes(calc) {
      listaAusentes.textContent = '';
      const candidatas = Array.isArray(calc.semContato) ? calc.semContato : [];
      const foraDaBase = Array.isArray(calc.semCorrespondenciaCsv) ? calc.semCorrespondenciaCsv : [];
      const semConfirmacao = Array.isArray(calc.semConfirmacaoGoogle) ? calc.semConfirmacaoGoogle : [];
      const exportaveis = calc.csvNovos.filter((c) => c.motivo === CSV_MOTIVO_AUSENTE);
      const textoAusencia = calc.consultaGoogleAtual ? ' ausência(s) confirmada(s) na agenda Google' : ' cliente(s) não encontrados na base CSV';
      resumoAusentes.textContent = candidatas.length + textoAusencia + ' · ' +
        foraDaBase.length + ' contato(s) encontrados na agenda atual, mas fora do CSV · ' +
        exportaveis.length + ' elegível(is) para CSV · ' +
        Math.max(0, candidatas.length - exportaveis.length) + ' para revisão' +
        (semConfirmacao.length ? ' · ' + semConfirmacao.length + ' sem confirmação da agenda' : '') + '.';
      baixarAusentes.disabled = exportaveis.length === 0;

      if (!calc.consultaGoogleAtual && !calc.erroConsultaGoogle && !G().lerMeta()) {
        const alerta = el('div', 'stcg-alert warn');
        alerta.append(el('span', '', '!'), el('div', '', 'A agenda Google não está conectada e não há CSV importado. A lista não pode confirmar quais contatos já existem no Google. Conecte a agenda ou importe um CSV atualizado antes de criar contatos.'));
        listaAusentes.append(alerta);
      } else if (!calc.consultaGoogleAtual && !calc.erroConsultaGoogle) {
        const alerta = el('div', 'stcg-alert warn');
        alerta.append(el('span', '', '!'), el('div', '', 'Esta lista usa a última base CSV importada, não uma consulta ao Google em tempo real. Se você criou contatos depois da importação, atualize o CSV antes de exportar para evitar duplicatas.'));
        listaAusentes.append(alerta);
      }
      if (calc.erroConsultaGoogle) {
        const alerta = el('div', 'stcg-alert error');
        alerta.append(el('span', '', '!'), el('div', '', calc.erroConsultaGoogle));
        listaAusentes.append(alerta);
      }

      if (candidatas.length === 0 && foraDaBase.length === 0 && semConfirmacao.length === 0) {
        const vazio = el('div', 'stcg-empty');
        vazio.append(el('b', '', 'Nenhum cliente confirmado como ausente'), el('span', '', calc.consultaGoogleAtual
          ? 'A agenda atual foi consultada. Revise abaixo os contatos localizados que ainda não estão na base CSV.'
          : 'Não há ausências na base atual, ou a agenda ainda precisa ser atualizada.'));
        listaAusentes.append(vazio);
      }
      if (candidatas.length > 0) {
        const titulo = el('div', 'stcg-panel-head');
        titulo.append(el('div', 'stcg-panel-title', calc.consultaGoogleAtual ? 'Não encontrados na agenda Google atual' : 'Não encontrados na base CSV importada'));
        listaAusentes.append(titulo);
      }
      candidatas.forEach((cand) => {
        const nome = String(cand.crm?.nome || '').trim();
        const bruto = String(cand.crm?.celular || '').trim();
        const celular = G().normalizarCelular(bruto);
        const elegivel = Boolean(cand.crm && (nome || celular));
        const item = el('div', 'stcg-item');
        item.append(el('span', 'stcg-shortcut-icon', '◎'));
        const info = el('div', 'stcg-item-main');
        info.append(el('div', 'stcg-item-title', cand.cliente.razaoSocial || cand.cliente.nomeFantasia || '(sem razão social)'));
        info.append(el('div', 'stcg-cnpj', 'CNPJ: ' + String(cand.cliente.cnpj || 'não informado')));
        const detalhe = !cand.crm
          ? 'Não foi possível ler o responsável no CRM; este cliente não será exportado até a consulta ser corrigida.'
          : 'Responsável: ' + (nome || 'não informado') + ' · Celular: ' + (celular ? G().formatarCelular(celular) : (bruto || 'não informado / inválido'));
        info.append(el('div', 'stcg-item-desc', detalhe));
        item.append(info);
        const lado = el('div', 'stcg-item-side');
        lado.append(el('span', 'stcg-status ' + (elegivel ? 'ready' : 'review'), elegivel ? 'Elegível' : 'Revisar CRM'));
        if (!elegivel) lado.append(el('span', 'stcg-item-desc', 'Fora do CSV'));
        item.append(lado);
        listaAusentes.append(item);
      });

      if (foraDaBase.length > 0) {
        const titulo = el('div', 'stcg-panel-head');
        titulo.style.borderTop = '1px solid #edf1f5';
        titulo.append(el('div', 'stcg-panel-title', 'Encontrados no Google, mas fora da base CSV'));
        listaAusentes.append(titulo);
        foraDaBase.forEach((cand) => {
          const item = el('div', 'stcg-item');
          item.append(el('span', 'stcg-shortcut-icon', '✓'));
          const info = el('div', 'stcg-item-main');
          info.append(el('div', 'stcg-item-title', cand.cliente.razaoSocial || cand.cliente.nomeFantasia || '(sem razão social)'));
          info.append(el('div', 'stcg-cnpj', 'CNPJ: ' + String(cand.cliente.cnpj || 'não informado')));
          info.append(el('div', 'stcg-item-desc', 'Um contato foi localizado na agenda Google atual pela raiz do CNPJ ou pelo nome inequívoco da organização. Não será exportado como novo. Importe um CSV atualizado para habilitar a comparação detalhada.'));
          item.append(info);
          const lado = el('div', 'stcg-item-side');
          lado.append(el('span', 'stcg-status ready', 'Contato localizado'));
          item.append(lado);
          listaAusentes.append(item);
        });
      }
      if (semConfirmacao.length > 0) {
        const titulo = el('div', 'stcg-panel-head');
        titulo.style.borderTop = '1px solid #edf1f5';
        titulo.append(el('div', 'stcg-panel-title', 'Aguardando confirmação da agenda'));
        listaAusentes.append(titulo);
        semConfirmacao.forEach((cand) => {
          const item = el('div', 'stcg-item');
          item.append(el('span', 'stcg-shortcut-icon', '!'));
          const info = el('div', 'stcg-item-main');
          info.append(el('div', 'stcg-item-title', cand.cliente.razaoSocial || cand.cliente.nomeFantasia || '(sem razão social)'));
          info.append(el('div', 'stcg-item-desc', 'A consulta ao Google não confirmou se já existe um contato. Este cliente foi bloqueado da exportação para evitar duplicatas.'));
          item.append(info);
          const lado = el('div', 'stcg-item-side');
          lado.append(el('span', 'stcg-status review', 'Não confirmado'));
          item.append(lado);
          listaAusentes.append(item);
        });
      }
    }


    const recalcular = () => {
      if (!estado.levantamento) return;
      const calc = calcularLinhas(estado.levantamento, undefined, estado.indiceGlobalTelefones);
      desenharResultado(resultado, calc, estado);
      atualizarDashboard(calc);
      renderizarAusentes(calc);
    };
    estado.redesenhar = recalcular;
    caixaModo.append(G().criarInterruptoresDoModo(recalcular));

    const executarLeitura = async (mensagem) => {
      if (estado.lendo) return;
      estado.lendo = true;
      textoOverview.textContent = mensagem || 'Consultando as páginas dos clientes no CRM…';
      statusOverview.className = 'stcg-alert warn';
      textoAndamento.textContent = 'Consultando responsáveis no CRM…';
      andamento.className = 'stcg-alert warn';
      statusCrmValue.textContent = 'Em andamento';
      try {
        const levantamento = await levantar({
          sinal: controlador.signal,
          aoProgresso: (feitos, total) => {
            const texto = 'Conferindo clientes: ' + feitos + ' de ' + total + '…';
            textoOverview.textContent = texto;
            textoAndamento.textContent = texto;
          },
        });
        if (!painelEl?.isConnected || estadoDoPainel !== estado) return;
        estado.levantamento = levantamento;
        try {
          estado.indiceGlobalTelefones = await G().lerIndiceGlobalTelefones();
        } catch {
          estado.indiceGlobalTelefones = { disponivel: false, motivo: 'reimportar', chaves: new Set() };
        }
        statusOverview.className = levantamento.erroConsultaGoogle ? 'stcg-alert error' : (levantamento.semContatos && !levantamento.consultaGoogleAtual ? 'stcg-alert warn' : 'stcg-alert good');
        iconOverview.textContent = levantamento.erroConsultaGoogle || (levantamento.semContatos && !levantamento.consultaGoogleAtual) ? '!' : '✓';
        if (!levantamento.totalNaLista) textoOverview.textContent = 'A lista de clientes do CRM está vazia.';
        else if (levantamento.erroConsultaGoogle) textoOverview.textContent = levantamento.erroConsultaGoogle;
        else if (levantamento.consultaGoogleAtual) textoOverview.textContent = 'Agenda Google atual consultada: ' + Number(levantamento.totalContatosGoogle || 0) + ' contato(s). A lista de ausentes foi validada contra a agenda atual; contatos não incluídos no CSV aparecem para revisão, não para exportação.';
        else if (levantamento.semContatos) textoOverview.textContent = 'Nenhuma base CSV foi importada neste navegador. Para confirmar quais clientes já têm contato no Google, conecte a agenda atual ou importe um CSV atualizado antes de exportar.';
        else if (levantamento.precisaReimportar) textoOverview.textContent = 'A importação guardada é antiga. Reimporte o Google CSV para atualizar a comparação.';
        else textoOverview.textContent = 'Conferência concluída a partir da base CSV importada. Para confirmar a agenda atual, conecte o Google na seção de sincronização.';
        andamento.className = levantamento.totalNaLista ? 'stcg-alert good' : 'stcg-alert warn';
        textoAndamento.textContent = levantamento.totalNaLista
          ? 'Conferência concluída · ' + levantamento.totalNaLista + ' cliente(s) analisado(s).' + (levantamento.consultaGoogleAtual ? ' Agenda Google verificada.' : (levantamento.erroConsultaGoogle ? ' Ausências não confirmadas pela agenda.' : ''))
          : 'A lista de clientes está vazia.';
        recalcular();
        desenharConferenciaCelulares();
      } catch (erro) {
        if (!painelEl?.isConnected || estadoDoPainel !== estado) return;
        statusOverview.className = 'stcg-alert error';
        iconOverview.textContent = '!';
        textoOverview.textContent = 'Não foi possível concluir a leitura. Confira a sessão do CRM e tente atualizar a visão.';
        andamento.className = 'stcg-alert error';
        textoAndamento.textContent = 'Falha ao consultar a lista do CRM. Tente novamente.';
      } finally {
        estado.lendo = false;
        if (painelEl?.isConnected && estadoDoPainel === estado) atualizarBtn.disabled = false;
      }
    };

    importInput.addEventListener('change', async () => {
      const arquivo = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!arquivo) return;
      if (estado.lendo) {
        importStatus.textContent = 'A conferência do CRM ainda está em andamento. Aguarde terminar e selecione o arquivo novamente.';
        return;
      }
      if (G().lerMeta() && !window.confirm('Importar este Google CSV substituirá a base guardada neste navegador. Deseja continuar?')) {
        importStatus.textContent = 'Importação cancelada; a base atual não foi alterada.';
        return;
      }
      importStatus.className = 'stcg-csv-status';
      importStatus.textContent = 'Validando e importando o arquivo…';
      try {
        const r = await G().importarCsv(await arquivo.text());
        if (r.erro) {
          importStatus.className = 'stcg-csv-status error';
          importStatus.textContent = r.erro;
          return;
        }
        const resumo = r.resumo || {};
        const exemplosRejeitados = Array.isArray(resumo.exemplosTelefonesRejeitados) && resumo.exemplosTelefonesRejeitados.length
          ? ' · Exemplos mascarados: ' + resumo.exemplosTelefonesRejeitados.slice(0, 3).join(', ')
          : '';
        const chavesInvalidas = Number(resumo.chavesInvalidasDescartadas || r.chavesInvalidasDescartadas || 0);
        importStatus.textContent = 'Importação concluída · ' + Number(resumo.lidos || 0) + ' contato(s) lido(s) · '
          + Number(resumo.reconhecidos || 0) + ' reconhecido(s) · '
          + Number(resumo.foraDoPadrao || 0) + ' fora do padrão · '
          + Number(resumo.telefonesIndexados || r.telefones || 0) + ' celular(es) único(s) indexado(s) · '
          + Number(resumo.telefonesRejeitados || 0) + ' valor(es) de telefone rejeitado(s)'
          + (chavesInvalidas ? ' · ' + chavesInvalidas + ' chave(s) inválida(s) descartada(s)' : '')
          + exemplosRejeitados
          + (r.naMemoria ? ' · ATENÇÃO: IndexedDB bloqueado/indisponível; o índice fica só nesta aba. Feche as outras abas do CRM e reimporte.' : '.');
        await executarLeitura('CSV importado. Atualizando a comparação com o CRM…');
        selecionarView('comparacao');
      } catch (erro) {
        importStatus.className = 'stcg-csv-status error';
        importStatus.textContent = 'Não foi possível ler/importar o arquivo. Verifique se é um Google CSV válido.';
      }
    });

    fixInput.addEventListener('change', async () => {
      const arquivo = fixInput.files && fixInput.files[0];
      fixInput.value = '';
      if (!arquivo) return;
      fixStatus.className = 'stcg-csv-status';
      fixStatus.textContent = 'Analisando o arquivo…';
      try {
        if (!window.__corretorCsv?.corrigirCsv || !window.__corretorCsv?.baixar) {
          fixStatus.className = 'stcg-csv-status error';
          fixStatus.textContent = 'O corretor CSV (Módulo 33) não está carregado.';
          return;
        }
        const r = window.__corretorCsv.corrigirCsv(await arquivo.text());
        if (r.erro) {
          fixStatus.className = 'stcg-csv-status error';
          fixStatus.textContent = r.erro;
        } else if (!r.csv) {
          fixStatus.textContent = 'Nenhum contato precisa de correção; nada foi baixado.';
        } else {
          window.__corretorCsv.baixar(window.__corretorCsv.NOME_ARQUIVO, r.csv);
          fixStatus.textContent = Number(r.resumo.corrigidos || 0) + ' corrigido(s) · ' + Number(r.resumo.jaNoPadrao || 0) + ' já no padrão · ' + Number(r.resumo.semComoCorrigir || 0) + ' para revisão. Arquivo baixado.';
        }
      } catch (erro) {
        fixStatus.className = 'stcg-csv-status error';
        fixStatus.textContent = 'Não foi possível processar o arquivo.';
      }
    });

    menuMobile.addEventListener('click', () => lateral.classList.toggle('mobile-open'));
    corpo.append(lateral, palco);
    painelEl.append(topo, corpo);
    document.body.append(painelEl);
    navBtns.overview.classList.add('active');
    views.overview.classList.add('active');
    await executarLeitura('Consultando a lista de clientes do CRM…');
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
    if (e.code !== 'Escape' || !painelEl) return;
    // Com o editor do nome aberto o Esc só o cancela, com o foco onde estiver dentro do painel (campo, Gravar, Cancelar,
    // interruptor, seletor de número); sem editor, fecha o painel. Durante a composição de acento/IME o Esc é do teclado.
    if (estadoDoPainel && estadoDoPainel.editando) {
      if (!e.isComposing) { e.preventDefault(); cancelarEdicao(estadoDoPainel); }
      return;
    }
    fecharPainel();
  });

  util()?.registrarPainel?.('contatosGoogleLista', fecharPainel);

  window.__contatosGoogleLista = {
    enderecoDoCliente,
    lerPaginaDoCliente,
    levantar,
    calcularLinhas,
    calcularConferenciaCelulares,
    serializarCsvNovos,
    acoesDaLinha,
    planejarAcao,
    avaliarEdicao,
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
