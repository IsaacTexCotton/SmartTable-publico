/* =========================================================================
 * MÓDULO 28: CONTATOS DO GOOGLE -> RESPONSÁVEL FINANCEIRO (Alt+J) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (02/10/2026): a base de números fica no Google Contatos, vários
 * com o nome de quem atende; passar esses nomes para o "Responsável financeiro" do
 * CRM da forma mais certeira possível.
 *
 * Como funciona:
 *   1. Alt+J abre o painel: o usuário escolhe o CSV exportado do Google Contatos
 *      ("Google CSV"). O arquivo é lido AQUI, no navegador; não vai para lugar nenhum.
 *   2. Cada contato cujo nome segue o padrão do usuário
 *        RAZÃO - RAIZ DO CNPJ - UF [- GP n] [- nome do responsável]
 *      vira um registro por RAIZ DO CNPJ (os 8 primeiros dígitos): UF, grupo, nome e
 *      celulares. Isso é guardado só neste navegador (IndexedDB), por decisão do usuário.
 *      Importar de novo SUBSTITUI tudo (o CSV novo é a verdade).
 *   3. Ao abrir um cliente, a raiz do CNPJ dele procura os contatos. Se houver algo a
 *      oferecer, aparece um aviso: "Preencher" abre o modal do CRM, preenche o nome e o
 *      celular e deixa o usuário CONFERIR e clicar em Salvar. QUEM GRAVA É O CRM
 *      (`salvarResponsavel`, PUT /api/crm/cliente-responsavel): este módulo só digita
 *      nos dois campos do modal, como o Alt+N faz no contato.
 *
 * Regras de segurança:
 *   - A chave é a raiz do CNPJ, não o telefone. Vários contatos na mesma raiz: o aviso
 *     lista todos e o usuário escolhe; nunca escolhe sozinho.
 *   - Só preenche o que está VAZIO no modal (o que o CRM mostra é a fonte da verdade). Para
 *     trocar o que já está lá, o usuário marca "Substituir o que já está no CRM".
 *   - Celular só se for celular de verdade: DDD + 9 dígitos começando com 9 (fixo não entra).
 *   - O celular do responsável é o número que o CRM usa para abrir o WhatsApp (selo
 *     "WHATS"): por isso a conferência no modal é obrigatória e o módulo nunca salva sozinho.
 *   - Contato fora do padrão é ignorado e só CONTADO. Nada de contato, nome, telefone ou
 *     CNPJ vai para o console; o painel mostra apenas contagens.
 *
 * ARMAZENAMENTO: IndexedDB `smarttable_contatos_google` (tabela `raizes`, uma linha por raiz) e,
 * no localStorage, só contagens e a data da importação (`smarttable_contatos_google_meta_v1`).
 *
 * ONDE COLAR: depois do Módulo 0 e ANTES do Módulo 4 (que liga o Alt+J).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__contatosGoogleCarregado) return;
  window.__contatosGoogleCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Contatos do Google');

  const CONFIG_CONTATOS = {
    BANCO: 'smarttable_contatos_google',
    VERSAO_BANCO: 1,
    TABELA: 'raizes',
    CHAVE_META: 'smarttable_contatos_google_meta_v1',
    ID_PAINEL: 'smarttable-contatos-google-painel',
    ID_AVISO: 'smarttable-contatos-google-aviso',
    // maxlength do campo "Nome do responsável" no modal do CRM (confirmado no diagnóstico).
    MAX_NOME: 150,
    // Quanto esperar o CRM atualizar o responsável depois do Salvar.
    TIMEOUT_CONFIRMACAO_MS: 8000,
    // Quanto esperar a página definir window.__RESPONSAVEL__ antes de seguir sem ele (o momento não foi confirmado).
    TIMEOUT_RESPONSAVEL_MS: 2500,
    INTERVALO_RESPONSAVEL_MS: 100,
    // O "Clique de novo para apagar" volta ao normal depois disto.
    TEMPO_CONFIRMAR_APAGAR_MS: 4000,
    INTERVALO_CONFIRMACAO_MS: 200,
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

  // Raiz do CNPJ num trecho do nome: 8 dígitos (com ou sem pontos) ou 8 caracteres alfanuméricos com ao
  // menos um dígito (CNPJ alfanumérico; uma palavra de 8 letras da razão, como "COMERCIO", não é raiz).
  const PADRAO_RAIZ = /^(\d{2}\.?\d{3}\.?\d{3}|(?=[0-9A-Z]*\d)[0-9A-Z]{8})$/;

  const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

  const util = () => window.__smartTableUtil;

  let painelEl = null;
  let avisoEl = null;
  let iniciou = false;
  // Ouvinte do submit do modal que vai conferir o Salvar; um só por vez (o anterior sai ao preencher de novo).
  let ouvinteEnvio = null;

  /* ---------------------------------------------------------------------
   * CSV E NOME DO CONTATO (funções puras)
   * --------------------------------------------------------------------- */

  /**
   * CSV (aspas, vírgula, quebra de linha dentro de aspas, BOM) -> linhas de campos.
   * @returns {{linhas: string[][], aspasAbertas: boolean}}
   */
  function lerCsv(texto) {
    const t = String(texto ?? '').replace(/^\uFEFF/, '');
    const linhas = [];
    let linha = [];
    let campo = '';
    let aspas = false;
    const fechaLinha = () => {
      linha.push(campo);
      campo = '';
      if (!(linha.length === 1 && linha[0] === '')) linhas.push(linha);
      linha = [];
    };
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (aspas) {
        if (c === '"') {
          if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
        } else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') fechaLinha(); // "\r\n" fecha uma linha e uma vazia (ignorada)
      else campo += c;
    }
    if (campo !== '' || linha.length > 0) fechaLinha();
    return { linhas, aspasAbertas: aspas };
  }

  /**
   * "EMPRESA - 12345678 - SP - GP 3 - Maria" -> { raiz, uf, grupo, nome }.
   * Raiz = 8 caracteres (com ou sem pontos, "12.345.678"), logo seguida de uma UF válida; a
   * razão pode ter " - " dentro (a raiz é a primeira que vem com UF depois) e, sem razão, a raiz
   * ainda identifica a empresa sem ambiguidade. Depois da UF:
   * um trecho "GP ..." (grupo, opcional) e o resto é o nome (opcional). null se não casar.
   */
  function interpretarNome(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const partes = t.split(/\s+-\s+/);
    for (let i = 0; i < partes.length - 1; i++) {
      if (!PADRAO_RAIZ.test(partes[i])) continue;
      const raiz = partes[i].replace(/\./g, '');
      const uf = partes[i + 1].toUpperCase();
      if (!UFS.has(uf) || partes[i + 1] !== partes[i + 1].toUpperCase()) continue;
      const resto = partes.slice(i + 2);
      let grupo = null;
      if (resto.length > 0 && /^GP(\s|$)/i.test(resto[0])) grupo = resto.shift();
      const nome = resto.join(' - ').trim();
      return { raiz, uf, grupo, nome: nome || null };
    }
    return null;
  }

  /**
   * Por que um texto de contato NÃO segue o padrão (só para contar; nunca mostra o texto):
   *   'vazio' = o contato não tem nome nem organização; 'sem-raiz' = nenhum trecho parece raiz de CNPJ
   *   (PADRAO_RAIZ); 'raiz-sem-uf' = tem a raiz, mas depois dela não vem uma UF válida.
   */
  function motivoForaDoPadrao(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return 'vazio';
    const partes = t.split(/\s+-\s+/);
    const temRaiz = partes.some((p) => PADRAO_RAIZ.test(p));
    return temRaiz ? 'raiz-sem-uf' : 'sem-raiz';
  }

  /** "+55 (DD) 9XXXX-XXXX" (com ou sem máscara) -> "DD9XXXXXXXX"; null se não for celular (DDD + 9 dígitos, o 1º é 9). */
  function normalizarCelular(valor) {
    let d = String(valor ?? '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    return d.length === 11 && d[2] === '9' ? d : null;
  }

  /** "DD9XXXXXXXX" -> "(DD) 9XXXX-XXXX" (o formato do campo do CRM). */
  function formatarCelular(digitos) {
    const d = String(digitos ?? '');
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  /**
   * Linhas do "Google CSV" -> contatos reconhecidos + contagens. Só colunas em inglês, como o
   * Google exporta (confirmado pelo cabeçalho do usuário); sem elas, erro com o motivo.
   * O nome do contato pode estar em First/Middle/Last Name juntos, em File As ou em Organization Name.
   *
   * @returns {{erro: string} | {contatos: Array<{raiz: string, uf: string, grupo: string|null, nome: string|null, celulares: string[]}>,
   *   resumo: {lidos: number, reconhecidos: number, foraDoPadrao: number, foraVazio: number, foraSemRaiz: number,
   *   foraRaizSemUf: number, semNome: number, semCelular: number, nomeLongo: number}}}
   */
  function contatosDoCsv(texto) {
    const { linhas, aspasAbertas } = lerCsv(texto);
    if (linhas.length === 0) return { erro: 'O arquivo está vazio.' };
    if (aspasAbertas) return { erro: 'O arquivo parece cortado ou corrompido (aspas sem fechar).' };
    const cab = linhas[0].map((c) => c.trim());
    const idx = (nome) => cab.indexOf(nome);
    const colunasDeNome = ['Name Prefix', 'First Name', 'Middle Name', 'Last Name', 'Name Suffix'].map(idx);
    const colFileAs = idx('File As');
    const colOrg = idx('Organization Name');
    const colunasDeTelefone = cab.map((c, i) => (/^Phone \d+ - Value$/.test(c) ? i : -1)).filter((i) => i >= 0);
    const faltando = [];
    if (idx('First Name') < 0) faltando.push('First Name');
    if (colunasDeTelefone.length === 0) faltando.push('Phone 1 - Value');
    if (faltando.length > 0) {
      return { erro: `Não parece um CSV do Google Contatos (faltam as colunas: ${faltando.join(', ')}). Exporte como "Google CSV".` };
    }

    const resumo = { lidos: 0, reconhecidos: 0, foraDoPadrao: 0, foraVazio: 0, foraSemRaiz: 0, foraRaizSemUf: 0, semNome: 0, semCelular: 0, nomeLongo: 0 };
    const vistos = new Set();
    const contatos = [];
    linhas.slice(1).forEach((linha) => {
      if (linha.every((c) => c.trim() === '')) return;
      resumo.lidos += 1;
      const celula = (i) => (i >= 0 && linha[i] ? linha[i].trim() : '');
      const composto = colunasDeNome.map(celula).filter(Boolean).join(' ');
      const textos = [composto, celula(colFileAs), celula(colOrg)];
      const achado = textos.map(interpretarNome).find(Boolean);
      if (!achado) {
        resumo.foraDoPadrao += 1;
        // O motivo é o do texto "mais promissor": vazio só se NENHUMA fonte tem texto; raiz-sem-uf se alguma tem a raiz.
        const motivos = textos.filter((x) => x.trim()).map(motivoForaDoPadrao);
        if (motivos.length === 0) resumo.foraVazio += 1;
        else if (motivos.includes('raiz-sem-uf')) resumo.foraRaizSemUf += 1;
        else resumo.foraSemRaiz += 1;
        return;
      }
      const celulares = [];
      colunasDeTelefone.forEach((i) => celula(i).split(':::').forEach((v) => {
        const c = normalizarCelular(v);
        if (c && !celulares.includes(c)) celulares.push(c);
      }));
      let nome = achado.nome;
      if (nome && nome.length > CONFIG_CONTATOS.MAX_NOME) { nome = null; resumo.nomeLongo += 1; }
      if (!nome) resumo.semNome += 1;
      if (celulares.length === 0) resumo.semCelular += 1;
      resumo.reconhecidos += 1;
      const chave = [achado.raiz, achado.uf, achado.grupo, nome, celulares.join(',')].join('|');
      if (vistos.has(chave)) return;
      vistos.add(chave);
      contatos.push({ raiz: achado.raiz, uf: achado.uf, grupo: achado.grupo, nome, celulares });
    });
    return { contatos, resumo };
  }

  /** Raiz do CNPJ (8 primeiros caracteres) de um CNPJ com ou sem máscara; '' se não tiver 14. */
  function raizDoCnpj(cnpj) {
    const limpo = String(cnpj ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    return limpo.length === 14 ? limpo.slice(0, 8) : '';
  }

  const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Dígitos do celular como o CRM mostra ("+55 (DD) 9XXXX-XXXX" -> "DD9XXXXXXXX"). */
  const digitosDoCelular = (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  };
  const mesmoNome = (a, b) => Boolean(semAcento(a)) && semAcento(a) === semAcento(b);

  /**
   * O que este contato ainda tem a oferecer ao CRM? crm = { nome, celular } (null = não deu para ler).
   * Nome conta se o contato tem nome diferente do que está no CRM; celular conta se o contato tem
   * algum celular e o do CRM não é nenhum deles.
   */
  function temNovidade(item, crm) {
    if (!crm) return Boolean(item.nome) || item.celulares.length > 0;
    const nomeNovo = Boolean(item.nome) && !mesmoNome(item.nome, crm.nome);
    const celularNovo = item.celulares.length > 0 && !item.celulares.includes(digitosDoCelular(crm.celular));
    return nomeNovo || celularNovo;
  }

  /**
   * O que "Preencher" deve digitar no modal, olhando o que o MODAL mostra agora (a fonte da verdade).
   * Nome e celular andam JUNTOS: se o CRM já tem OUTRO nome e o usuário não marcou "Substituir", nada é
   * digitado (só o celular deixaria o número de uma pessoa sob o nome de outra, e o celular é o do WhatsApp).
   * @returns {{nome: boolean, celular: boolean, motivo?: 'outro-nome'|'nada'}}
   */
  function decidirPreenchimento(item, celular, nomeAtual, celularAtual, substituir) {
    const nomeVazio = String(nomeAtual ?? '').trim() === '';
    const celularVazio = String(celularAtual ?? '').trim() === '';
    if (item.nome && !nomeVazio && !mesmoNome(item.nome, nomeAtual) && !substituir) return { nome: false, celular: false, motivo: 'outro-nome' };
    const nome = Boolean(item.nome) && (nomeVazio || (substituir && !mesmoNome(item.nome, nomeAtual)));
    const cel = Boolean(celular) && (celularVazio || (substituir && digitosDoCelular(celularAtual) !== celular));
    return nome || cel ? { nome, celular: cel } : { nome: false, celular: false, motivo: 'nada' };
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO (IndexedDB; plano B na memória da aba)
   * --------------------------------------------------------------------- */

  let bancoPromessa = null;
  const memoria = new Map();
  let usandoMemoria = false;

  function pedido(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB: erro sem detalhe'));
    });
  }

  function fimDaTransacao(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: transação falhou'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transação abortada (cota cheia?)'));
    });
  }

  /** @returns {Promise<IDBDatabase|null>} null = sem IndexedDB (plano B). */
  function abrirBanco() {
    if (bancoPromessa) return bancoPromessa;
    bancoPromessa = new Promise((resolve) => {
      const fabrica = window.indexedDB;
      if (!fabrica || typeof fabrica.open !== 'function') {
        usandoMemoria = true;
        resolve(null);
        return;
      }
      let req;
      try {
        req = fabrica.open(CONFIG_CONTATOS.BANCO, CONFIG_CONTATOS.VERSAO_BANCO);
      } catch {
        usandoMemoria = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CONFIG_CONTATOS.TABELA)) db.createObjectStore(CONFIG_CONTATOS.TABELA, { keyPath: 'raiz' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); bancoPromessa = null; };
        resolve(db);
      };
      req.onerror = () => { usandoMemoria = true; resolve(null); };
    });
    return bancoPromessa;
  }

  const agruparPorRaiz = (contatos) => {
    const mapa = new Map();
    contatos.forEach((c) => {
      if (!mapa.has(c.raiz)) mapa.set(c.raiz, []);
      mapa.get(c.raiz).push({ uf: c.uf, grupo: c.grupo, nome: c.nome, celulares: c.celulares });
    });
    return mapa;
  };

  /** Substitui TUDO pelo que veio do CSV (numa transação só: ou troca tudo, ou nada). */
  async function guardarContatos(contatos) {
    const mapa = agruparPorRaiz(contatos);
    const db = await abrirBanco();
    if (!db) {
      memoria.clear();
      mapa.forEach((itens, raiz) => memoria.set(raiz, itens));
      return { raizes: mapa.size, naMemoria: true };
    }
    const tx = db.transaction(CONFIG_CONTATOS.TABELA, 'readwrite');
    const loja = tx.objectStore(CONFIG_CONTATOS.TABELA);
    loja.clear();
    mapa.forEach((itens, raiz) => loja.put({ raiz, itens }));
    await fimDaTransacao(tx);
    return { raizes: mapa.size, naMemoria: false };
  }

  async function buscarPorRaiz(raiz) {
    if (!raiz) return [];
    const db = await abrirBanco();
    if (!db) return memoria.get(raiz) ?? [];
    const registro = await pedido(db.transaction(CONFIG_CONTATOS.TABELA).objectStore(CONFIG_CONTATOS.TABELA).get(raiz));
    return registro?.itens ?? [];
  }

  async function apagarTudo() {
    const db = await abrirBanco();
    memoria.clear();
    if (db) {
      const tx = db.transaction(CONFIG_CONTATOS.TABELA, 'readwrite');
      tx.objectStore(CONFIG_CONTATOS.TABELA).clear();
      await fimDaTransacao(tx);
    }
    metaNaMemoria = null;
    gravarMeta(null);
  }

  // Plano B (sem IndexedDB): os contatos somem ao recarregar, então a data também NÃO pode sobreviver.
  let metaNaMemoria = null;

  function lerMeta() {
    if (usandoMemoria) return metaNaMemoria;
    try {
      const m = JSON.parse(window.localStorage.getItem(CONFIG_CONTATOS.CHAVE_META) || 'null');
      return m && m.versao === 1 ? m : null;
    } catch {
      return null;
    }
  }

  function gravarMeta(meta) {
    try {
      if (meta) window.localStorage.setItem(CONFIG_CONTATOS.CHAVE_META, JSON.stringify({ versao: 1, ...meta }));
      else window.localStorage.removeItem(CONFIG_CONTATOS.CHAVE_META);
    } catch { /* só a data de exibição: sem ela o painel diz "importado" sem a data */ }
  }

  /**
   * Lê o texto do CSV, guarda e devolve o resumo. Nunca guarda nada se o CSV for inválido.
   * @returns {Promise<{erro: string} | {resumo: object, raizes: number, naMemoria: boolean}>}
   */
  async function importarCsv(texto) {
    const lido = contatosDoCsv(texto);
    if (lido.erro) return lido;
    if (lido.contatos.length === 0) {
      return { erro: 'Nenhum contato no padrão "RAZÃO - RAIZ DO CNPJ - UF" foi encontrado. Nada foi alterado.', resumo: lido.resumo };
    }
    try {
      const { raizes, naMemoria } = await guardarContatos(lido.contatos);
      const meta = { importadoEm: util().dataIso(util().normalizarData(new Date())), contatos: lido.contatos.length, raizes };
      if (naMemoria) metaNaMemoria = { versao: 1, ...meta };
      else gravarMeta(meta);
      return { resumo: lido.resumo, raizes, naMemoria };
    } catch (erro) {
      return { erro: 'O navegador recusou a gravação dos contatos (' + (erro?.name || 'erro') + '). Nada foi alterado.' };
    }
  }

  /* ---------------------------------------------------------------------
   * PÁGINA DO CLIENTE: sugestão e preenchimento do modal do CRM
   * --------------------------------------------------------------------- */

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(window.location.search).get('cnpj') || window.__CLIENTE_CNPJ__ || '';
    } catch {
      return window.__CLIENTE_CNPJ__ || '';
    }
  }

  /** O responsável que o CRM tem agora ({nome, celular}); null se a página não expõe. */
  function responsavelDoCrm() {
    const r = window.__RESPONSAVEL__;
    return r && typeof r === 'object' ? { nome: r.nome || '', celular: r.celular || '' } : null;
  }

  function definirCampo(el, valor) {
    el.value = valor;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  const avisar = (mensagem, ms) => util()?.toast?.(mensagem, ms);

  /** Depois do Salvar do CRM: confere se o responsável da página passou a ser o que foi digitado. */
  function conferirDepoisDoSalvar(nomeDigitado, celularDigitado) {
    const iguais = (r) => Boolean(r) && r.nome.trim() === nomeDigitado.trim()
      && digitosDoCelular(r.celular) === digitosDoCelular(celularDigitado);
    // Já igual ANTES de o CRM responder: não dá para dizer que ele gravou (o PUT pode até ter falhado).
    if (iguais(responsavelDoCrm())) {
      avisar('O CRM já tinha este nome e este celular: nada mudou.');
      return;
    }
    const limite = Date.now() + CONFIG_CONTATOS.TIMEOUT_CONFIRMACAO_MS;
    const tentar = () => {
      if (iguais(responsavelDoCrm())) {
        avisar('Responsável conferido no CRM: nome e celular batem.');
        return;
      }
      if (Date.now() >= limite) {
        avisar('O CRM não confirmou o responsável. Abra o "Responsável financeiro" e confira antes de seguir.', 9000);
        return;
      }
      setTimeout(tentar, CONFIG_CONTATOS.INTERVALO_CONFIRMACAO_MS);
    };
    tentar();
  }

  function aguardarEnvio(form) {
    if (ouvinteEnvio) ouvinteEnvio.form.removeEventListener('submit', ouvinteEnvio.fn, true);
    const fn = () => {
      form.removeEventListener('submit', fn, true);
      ouvinteEnvio = null;
      // Lê os campos NO MOMENTO do envio: é o que o CRM vai gravar.
      conferirDepoisDoSalvar(document.getElementById('resp-nome-input')?.value ?? '', document.getElementById('resp-celular-input')?.value ?? '');
    };
    form.addEventListener('submit', fn, true);
    ouvinteEnvio = { form, fn };
  }

  /**
   * Abre o modal do CRM e preenche. O que já está no modal só é trocado com `substituir`.
   * NÃO salva: o usuário confere e clica em Salvar (o CRM grava e este módulo confere depois).
   * @returns {{ok: boolean, motivo?: string, nome?: boolean, celular?: boolean}}
   */
  function preencherModal(item, celular, substituir) {
    if (typeof window.abrirModalResponsavel !== 'function') {
      avisar('Não achei o "Responsável financeiro" do CRM nesta página.', 6000);
      return { ok: false, motivo: 'sem-modal' };
    }
    window.abrirModalResponsavel();
    const nomeEl = document.getElementById('resp-nome-input');
    const celEl = document.getElementById('resp-celular-input');
    if (!nomeEl || !celEl) {
      avisar('O modal do responsável mudou: não achei os campos. Preencha à mão.', 8000);
      return { ok: false, motivo: 'sem-campos' };
    }
    const decisao = decidirPreenchimento(item, celular, nomeEl.value, celEl.value, substituir);
    if (decisao.motivo === 'outro-nome') {
      const nomeAtual = nomeEl.value.trim();
      window.fecharModalResponsavel?.();
      avisar(`O CRM já tem outro nome (${nomeAtual}). Para não misturar o nome de uma pessoa com o celular de outra, nada foi digitado. Marque "Substituir o que já está no CRM" se quiser trocar.`, 10000);
      return { ok: false, motivo: 'outro-nome' };
    }
    if (decisao.motivo === 'nada') {
      window.fecharModalResponsavel?.();
      avisar('Nada a preencher: o CRM já tem esses campos. Marque "Substituir o que já está no CRM" para trocar.', 7000);
      return { ok: false, motivo: 'nada-a-preencher' };
    }
    const resultado = { ok: true, nome: decisao.nome, celular: decisao.celular };
    if (decisao.nome) definirCampo(nomeEl, item.nome);
    if (decisao.celular) definirCampo(celEl, formatarCelular(celular));
    const salvar = document.getElementById('resp-btn-salvar');
    if (salvar) salvar.focus();
    avisar('Preenchido. Confira o nome e o celular (o celular é o do WhatsApp) e clique em Salvar.', 7000);

    const form = document.getElementById('form-responsavel');
    if (form) aguardarEnvio(form);
    return resultado;
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

  /** Aviso da página do cliente: um cartão por contato, na pilha de avisos (fica até o usuário fechar). */
  function mostrarAviso(itens, crm) {
    fecharAviso();
    if (!itens || itens.length === 0) return;
    avisoEl = document.createElement('div');
    avisoEl.id = CONFIG_CONTATOS.ID_AVISO;
    avisoEl.setAttribute('role', 'alertdialog');
    Object.assign(avisoEl.style, {
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '12px 14px',
      boxShadow: '0 10px 34px rgba(0,0,0,0.28)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      width: '380px',
      maxWidth: '90vw',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
      pointerEvents: 'auto',
    });
    avisoEl.appendChild(criarDiv('Contato do Google Contatos para este cliente', { color: CORES.tinta, fontWeight: '700', marginBottom: '8px' }));
    if (!crm) {
      avisoEl.appendChild(criarDiv('Não consegui ler o responsável atual do CRM: o que já estiver no modal não será trocado.', {
        color: CORES.aviso, fontSize: '12px', marginBottom: '8px',
      }));
    }

    itens.forEach((item) => {
      const cartao = criarDiv('', { borderLeft: `5px solid ${CORES.destaque}`, padding: '4px 0 4px 10px', marginBottom: '10px' });
      cartao.dataset.papel = 'contato';
      cartao.appendChild(criarDiv(item.nome || '(contato sem o nome do responsável)', { color: CORES.tinta, fontWeight: '700' }));
      cartao.appendChild(criarDiv([item.uf, item.grupo].filter(Boolean).join(' · '), { color: CORES.apagado, fontSize: '11.5px', marginBottom: '4px' }));

      const nomeCrm = crm?.nome?.trim() || '';
      const celCrm = crm?.celular?.trim() || '';
      if (crm && (nomeCrm || celCrm)) {
        cartao.appendChild(criarDiv(`No CRM: ${nomeCrm || 'sem nome'} · ${celCrm || 'sem celular'}`, { color: CORES.texto, fontSize: '12px', marginBottom: '4px' }));
      }
      const celularesDoItem = item.celulares.map((c) => formatarCelular(c));
      if (celularesDoItem.length > 0) {
        cartao.appendChild(criarDiv('Celular no contato: ' + celularesDoItem.join(' · '), { color: CORES.texto, fontSize: '12px', marginBottom: '6px' }));
      }

      // "Substituir" só aparece quando há algo no CRM que o contato trocaria.
      const trocaria = Boolean(nomeCrm && item.nome && !mesmoNome(nomeCrm, item.nome))
        || Boolean(celCrm && item.celulares.length > 0 && !item.celulares.includes(digitosDoCelular(celCrm)));
      let substituirEl = null;
      if (trocaria) {
        const rotulo = document.createElement('label');
        Object.assign(rotulo.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: CORES.aviso, margin: '0 0 6px', cursor: 'pointer' });
        substituirEl = document.createElement('input');
        substituirEl.type = 'checkbox';
        substituirEl.dataset.campo = 'substituir';
        rotulo.appendChild(substituirEl);
        rotulo.appendChild(document.createTextNode('Substituir o que já está no CRM'));
        cartao.appendChild(rotulo);
      }

      const botoes = criarDiv('', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
      const aoPreencher = (celular) => {
        const r = preencherModal(item, celular, Boolean(substituirEl?.checked));
        if (r.ok) fecharAviso();
      };
      if (item.celulares.length === 0) {
        const b = criarBotao('Preencher o nome', 'preencher', true);
        b.addEventListener('click', () => aoPreencher(null));
        botoes.appendChild(b);
      } else {
        item.celulares.forEach((c) => {
          const b = criarBotao(item.nome ? `Preencher · ${formatarCelular(c)}` : `Preencher o celular · ${formatarCelular(c)}`, 'preencher', true);
          b.addEventListener('click', () => aoPreencher(c));
          botoes.appendChild(b);
        });
      }
      cartao.appendChild(botoes);
      avisoEl.appendChild(cartao);
    });

    const ignorar = criarBotao('Ignorar', 'ignorar', false);
    ignorar.addEventListener('click', fecharAviso);
    avisoEl.appendChild(criarDiv('', { display: 'flex', justifyContent: 'flex-end' })).appendChild(ignorar);
    if (typeof util()?.colocarNaPilha === 'function') {
      util().colocarNaPilha(avisoEl, { fixo: true });
    } else {
      // Módulo 0 antigo em cache: sem a pilha, o aviso ainda precisa aparecer.
      Object.assign(avisoEl.style, { position: 'fixed', right: '24px', bottom: '150px', zIndex: CONFIG_CONTATOS.Z_INDEX_POPUP });
      document.body.appendChild(avisoEl);
    }
  }

  async function avaliarPagina() {
    let itens;
    try {
      // Sem raiz (lista, busca...), buscarPorRaiz devolve vazio sem nem abrir o banco.
      itens = await buscarPorRaiz(raizDoCnpj(cnpjDaPagina()));
    } catch {
      avisar('Contatos do Google: não consegui ler os contatos guardados neste navegador (abra o Alt+J e importe de novo).', 8000);
      return;
    }
    if (itens.length === 0) return;
    // A página pode definir o responsável um pouco depois do userscript: espera antes de decidir "sem leitura".
    const limite = Date.now() + CONFIG_CONTATOS.TIMEOUT_RESPONSAVEL_MS;
    while (!responsavelDoCrm() && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG_CONTATOS.INTERVALO_RESPONSAVEL_MS));
    }
    const crm = responsavelDoCrm();
    mostrarAviso(itens.filter((i) => temNovidade(i, crm)), crm);
  }

  function dataBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  function descreverGuardados() {
    const meta = lerMeta();
    if (!meta) return 'Nenhum contato guardado.';
    const data = dataBr(meta.importadoEm);
    return `Guardados: ${meta.contatos} contato(s) de ${meta.raizes} empresa(s)${data ? ', importados em ' + data : ''}.`;
  }

  function lerArquivo(arquivo) {
    return new Promise((resolve, reject) => {
      const leitor = new window.FileReader();
      leitor.onload = () => resolve(String(leitor.result ?? ''));
      leitor.onerror = () => reject(leitor.error ?? new Error('leitura falhou'));
      leitor.readAsText(arquivo, 'utf-8');
    });
  }

  function textoDoResumo(r) {
    const partes = [
      `${r.resumo.lidos} contato(s) lido(s)`,
      `${r.resumo.reconhecidos} no padrão`,
      `${r.resumo.foraDoPadrao} fora do padrão, ignorados (${r.resumo.foraSemRaiz} sem raiz de CNPJ, ${r.resumo.foraRaizSemUf} com raiz mas sem UF válida, ${r.resumo.foraVazio} sem nome)`,
      `${r.resumo.semNome} sem o nome do responsável`,
      `${r.resumo.semCelular} sem celular`,
    ];
    if (r.resumo.nomeLongo > 0) partes.push(`${r.resumo.nomeLongo} com nome longo demais (sem o nome)`);
    return partes.join(' · ');
  }

  function abrirPainel() {
    util()?.fecharOutrosPaineis?.('contatosGoogle');
    fecharPainel();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_CONTATOS.ID_PAINEL;
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
      zIndex: CONFIG_CONTATOS.Z_INDEX_POPUP,
      width: '440px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
    });

    painelEl.appendChild(criarDiv('Contatos do Google', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    painelEl.appendChild(criarDiv('Escolha o CSV exportado do Google Contatos ("Google CSV"). O arquivo é lido aqui e os contatos ficam só neste navegador.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 8px',
    }));
    painelEl.appendChild(criarDiv('Padrão do nome do contato: RAZÃO - RAIZ DO CNPJ - UF - GP n - nome do responsável (grupo e nome são opcionais).', {
      color: CORES.texto, fontSize: '12px', marginBottom: '8px',
    }));

    const status = criarDiv(descreverGuardados(), { color: CORES.texto, margin: '0 0 8px' });
    status.dataset.papel = 'status';
    painelEl.appendChild(status);
    if (usandoMemoria) {
      painelEl.appendChild(criarDiv('O navegador não deixou usar o armazenamento local: os contatos valem só nesta aba.', { color: CORES.aviso, fontSize: '12px', marginBottom: '8px' }));
    }

    const resultado = criarDiv('', { fontSize: '12px', margin: '8px 0', lineHeight: '1.5' });
    resultado.dataset.papel = 'resultado';

    const arquivoEl = document.createElement('input');
    arquivoEl.type = 'file';
    arquivoEl.accept = '.csv,text/csv';
    arquivoEl.dataset.campo = 'arquivo';
    arquivoEl.addEventListener('change', async () => {
      const arquivo = arquivoEl.files && arquivoEl.files[0];
      if (!arquivo) return;
      resultado.style.color = CORES.texto;
      resultado.textContent = 'Lendo...';
      let r;
      try {
        r = await importarCsv(await lerArquivo(arquivo));
      } catch {
        r = { erro: 'Não consegui ler o arquivo.' };
      }
      // Sem limpar, escolher o MESMO arquivo de novo (reexportado, corrigido) não dispara "change".
      arquivoEl.value = '';
      if (r.erro) {
        resultado.style.color = CORES.erro;
        resultado.textContent = r.erro + (r.resumo ? ' (' + textoDoResumo(r) + ')' : '');
        return;
      }
      resultado.style.color = CORES.destaque;
      resultado.textContent = `Importado: ${r.raizes} empresa(s). ${textoDoResumo(r)}.` + (r.naMemoria ? ' (só nesta aba)' : '');
      status.textContent = descreverGuardados();
    });
    painelEl.appendChild(arquivoEl);
    painelEl.appendChild(resultado);
    painelEl.appendChild(criarDiv('Importar de novo substitui tudo o que estava guardado.', { color: CORES.apagado, fontSize: '11.5px' }));

    const rodape = criarDiv('', { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
    let confirmando = false;
    let relogio = null;
    const apagar = criarBotao('Apagar contatos guardados', 'apagar', false);
    const desarmar = () => {
      clearTimeout(relogio);
      confirmando = false;
      apagar.textContent = 'Apagar contatos guardados';
      apagar.style.color = CORES.texto;
    };
    apagar.addEventListener('click', async () => {
      if (!confirmando) {
        confirmando = true;
        apagar.textContent = 'Clique de novo para apagar';
        apagar.style.color = CORES.erro;
        // Um clique casual horas depois não pode apagar a base: a confirmação expira.
        relogio = setTimeout(desarmar, CONFIG_CONTATOS.TEMPO_CONFIRMAR_APAGAR_MS);
        return;
      }
      desarmar();
      try {
        await apagarTudo();
        status.textContent = descreverGuardados();
        resultado.textContent = '';
      } catch {
        resultado.style.color = CORES.erro;
        resultado.textContent = 'O navegador recusou apagar. Tente de novo.';
      }
    });
    rodape.appendChild(apagar);
    const fechar = criarBotao('Fechar', 'fechar', true);
    fechar.addEventListener('click', fecharPainel);
    rodape.appendChild(fechar);
    painelEl.appendChild(rodape);
    painelEl.appendChild(criarDiv('Alt+J ou Esc para fechar', { color: CORES.apagado, fontSize: '11px', textAlign: 'center', marginTop: '8px' }));

    document.body.appendChild(painelEl);
    util()?.acompanharMenuLateral?.(painelEl);
  }

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

  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    avaliarPagina();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  // Esc fecha o painel. Registrado uma vez só: um listener por abertura vazaria.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  util()?.registrarPainel?.('contatosGoogle', fecharPainel);

  window.__contatosGoogle = {
    lerCsv,
    interpretarNome,
    motivoForaDoPadrao,
    normalizarCelular,
    formatarCelular,
    contatosDoCsv,
    raizDoCnpj,
    temNovidade,
    importarCsv,
    guardarContatos,
    buscarPorRaiz,
    apagarTudo,
    lerMeta,
    avaliarPagina,
    mostrarAviso,
    fecharAviso,
    preencherModal,
    abrirPainel,
    fecharPainel,
    alternarPainel,
    estaAberto: () => painelEl !== null,
    avisoEstaAberto: () => avisoEl !== null,
    estaUsandoMemoria: () => usandoMemoria,
    CONFIG_CONTATOS,
  };
})();
