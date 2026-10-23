/* =========================================================================
 * MÓDULO 36: API DO GOOGLE CONTACTS (People API)
 * OAuth por Google Identity Services. Tokens existem apenas em memória.
 * O Client ID OAuth é público e fica salvo localmente; nenhum segredo OAuth é
 * embutido no SmartTable. Todas as mutações são sequenciais e conferem etag.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__googleContactsApiCarregado) return;
  window.__googleContactsApiCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('API Google Contacts');

  const CHAVE_CLIENT_ID = 'smarttable_google_contacts_client_id_v1';
  const ESCOPO = 'https://www.googleapis.com/auth/contacts';
  const URL_API = 'https://people.googleapis.com/v1';
  const URL_GIS = 'https://accounts.google.com/gsi/client';
  const ID_SCRIPT = 'smarttable-google-identity-services';
  const CAMPOS = 'names,phoneNumbers,organizations,metadata';
  let clientId = lerClientId();
  let token = null;
  let tokenExpiraEm = 0;
  let biblioteca = null;
  let clienteToken = null;
  let pedidoToken = null;
  let filaMutacoes = Promise.resolve();

  function lerClientId() {
    try { return String(window.localStorage.getItem(CHAVE_CLIENT_ID) || '').trim(); }
    catch { return ''; }
  }

  function validarClientId(valor) {
    return /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(String(valor || '').trim());
  }

  function configurarClientId(valor) {
    const novo = String(valor || '').trim();
    if (!validarClientId(novo)) return { ok: false, erro: 'Informe um OAuth Client ID válido terminado em .apps.googleusercontent.com.' };
    try {
      window.localStorage.setItem(CHAVE_CLIENT_ID, novo);
      clientId = novo;
      token = null;
      tokenExpiraEm = 0;
      clienteToken = null;
      return { ok: true };
    } catch {
      return { ok: false, erro: 'O navegador não permitiu salvar o Client ID.' };
    }
  }

  function status() {
    return {
      configurado: validarClientId(clientId),
      conectado: Boolean(token && Date.now() < tokenExpiraEm - 30000),
      clientId: clientId,
      expiraEm: tokenExpiraEm || null,
    };
  }

  function carregarBiblioteca() {
    const oauthAtual = window.unsafeWindow?.google?.accounts?.oauth2 || window.google?.accounts?.oauth2;
    if (oauthAtual) return Promise.resolve(oauthAtual);
    if (biblioteca) return biblioteca;
    biblioteca = new Promise((resolve, reject) => {
      let script = document.getElementById(ID_SCRIPT);
      const novoScript = !script;
      if (!script) {
        script = document.createElement('script');
        script.id = ID_SCRIPT;
        script.src = URL_GIS;
        script.async = true;
        script.defer = true;
      }
      let concluido = false;
      let timer = null;
      const limpar = () => {
        if (timer !== null) window.clearTimeout(timer);
        script.removeEventListener('load', aoCarregar);
        script.removeEventListener('error', aoErro);
      };
      const terminar = (erro, oauth) => {
        if (concluido) return;
        concluido = true;
        limpar();
        if (erro) {
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(erro);
        } else {
          resolve(oauth);
        }
      };
      const aoCarregar = () => {
        const oauth = window.unsafeWindow?.google?.accounts?.oauth2 || window.google?.accounts?.oauth2;
        if (oauth) terminar(null, oauth);
        else terminar(new Error('A biblioteca de autorização do Google carregou sem a API OAuth esperada.'));
      };
      const aoErro = () => terminar(new Error('Não foi possível carregar a biblioteca de autorização do Google. Verifique se accounts.google.com está permitido.'));
      script.addEventListener('load', aoCarregar);
      script.addEventListener('error', aoErro);
      timer = window.setTimeout(() => {
        terminar(new Error('O Google Identity Services não carregou em 15 segundos. Verifique a conexão e a política de segurança do CRM.'));
      }, 15000);
      if (novoScript) document.head.appendChild(script);
      const oauthDepoisDeInserir = window.unsafeWindow?.google?.accounts?.oauth2 || window.google?.accounts?.oauth2;
      if (oauthDepoisDeInserir) terminar(null, oauthDepoisDeInserir);
    }).catch((erro) => {
      biblioteca = null;
      throw erro;
    });
    return biblioteca;
  }

  function conectar() {
    if (!validarClientId(clientId)) return Promise.reject(new Error('Configure primeiro o OAuth Client ID do Google.'));
    return carregarBiblioteca().then((oauth) => new Promise((resolve, reject) => {
      if (pedidoToken) {
        reject(new Error('Já existe uma solicitação de autorização em andamento.'));
        return;
      }
      const pedido = { timer: null };
      const finalizar = (erro, resultado) => {
        if (pedidoToken !== pedido) return;
        pedidoToken = null;
        if (pedido.timer !== null) window.clearTimeout(pedido.timer);
        pedido.timer = null;
        if (erro) reject(erro);
        else resolve(resultado);
      };
      pedidoToken = pedido;
      pedido.timer = window.setTimeout(() => {
        if (pedidoToken !== pedido) return;
        pedidoToken = null;
        pedido.timer = null;
        clienteToken = null;
        token = null;
        tokenExpiraEm = 0;
        reject(new Error('O Google não respondeu à solicitação de autorização em 120 segundos. Inicie uma nova conexão.'));
      }, 120000);
      try {
        clienteToken = oauth.initTokenClient({
          client_id: clientId,
          scope: ESCOPO,
          callback: (resposta) => {
            if (pedidoToken !== pedido) return;
            if (resposta?.error || !resposta?.access_token) {
              token = null;
              tokenExpiraEm = 0;
              finalizar(new Error('O Google não autorizou o acesso aos contatos' + (resposta?.error ? ' (' + resposta.error + ')' : '') + '.'));
              return;
            }
            token = resposta.access_token;
            tokenExpiraEm = Date.now() + Math.max(60, Number(resposta.expires_in) || 3600) * 1000;
            finalizar(null, status());
          },
          error_callback: (erro) => {
            if (pedidoToken !== pedido) return;
            token = null;
            tokenExpiraEm = 0;
            const detalhe = erro?.type === 'popup_failed_to_open'
              ? 'O navegador bloqueou a janela de autorização. Permita pop-ups para o CRM e tente novamente.'
              : 'A autorização do Google foi interrompida' + (erro?.type ? ' (' + erro.type + ')' : '') + '.';
            finalizar(new Error(detalhe));
          },
        });
        clienteToken.requestAccessToken({ prompt: token ? '' : 'consent' });
      } catch (erro) {
        finalizar(new Error(erro?.message || 'Não foi possível iniciar a autorização do Google.'));
      }
    }));
  }

  function desconectar() {
    const antigo = token;
    token = null;
    tokenExpiraEm = 0;
    clienteToken = null;
    if (!antigo || !window.google?.accounts?.oauth2?.revoke) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      try {
        window.google.accounts.oauth2.revoke(antigo, () => resolve({ ok: true }));
        window.setTimeout(() => resolve({ ok: true }), 1500);
      } catch {
        resolve({ ok: true });
      }
    });
  }

  function tokenValido() {
    if (!token || Date.now() >= tokenExpiraEm - 30000) {
      token = null;
      tokenExpiraEm = 0;
      throw new Error('A autorização expirou. Clique em Conectar Google e autorize novamente.');
    }
    return token;
  }

  async function requisicaoJson(url, opcoes = {}) {
    const timeoutMs = Math.max(1000, Number(opcoes.timeoutMs) || 30000);
    const maxTentativas = Math.max(1, Math.min(4, Number(opcoes.maxTentativas) || 4));
    const opcoesFetch = Object.assign({}, opcoes);
    delete opcoesFetch.timeoutMs;
    delete opcoesFetch.maxTentativas;
    let resposta;
    for (let tentativa = 0; tentativa < maxTentativas; tentativa += 1) {
      const cabecalhos = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + tokenValido() }, opcoesFetch.headers || {});
      if (opcoesFetch.body && !cabecalhos['Content-Type']) cabecalhos['Content-Type'] = 'application/json';
      const ctl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
      let timer = null;
      try {
        const pedidoFetch = Object.assign({}, opcoesFetch, { headers: cabecalhos });
        if (ctl) {
          pedidoFetch.signal = ctl.signal;
          timer = window.setTimeout(() => ctl.abort(), timeoutMs);
        }
        resposta = await window.fetch(url, pedidoFetch);
      } catch (erro) {
        if (ctl?.signal?.aborted) throw new Error('A solicitação ao Google Contacts excedeu o limite de ' + Math.round(timeoutMs / 1000) + ' segundos.');
        throw new Error('Falha de rede ao acessar o Google Contacts.');
      } finally {
        if (timer !== null) window.clearTimeout(timer);
      }
      if (resposta.status !== 429 || tentativa + 1 >= maxTentativas) break;
      await new Promise((resolve) => window.setTimeout(resolve, 500 * (2 ** tentativa)));
    }
    let json = null;
    try { json = await resposta.json(); } catch { /* corpo vazio/não JSON */ }
    if (!resposta.ok) {
      if (resposta.status === 401) {
        token = null;
        tokenExpiraEm = 0;
        throw new Error('O Google recusou a autorização (401). Conecte a conta novamente; o lote foi interrompido.');
      }
      if (resposta.status === 403) throw new Error('O Google recusou o acesso (403). Confira se a People API está habilitada e se o consentimento inclui contatos.');
      if (resposta.status === 429) throw new Error('O Google continuou limitando a operação após as tentativas com espera exponencial.');
      const erroApi = json?.error || {};
      const razao = String(erroApi.status || erroApi.errors?.[0]?.reason || '');
      const mensagemApi = String(erroApi.message || '');
      if (resposta.status === 400 && (/^(FAILED_PRECONDITION|failedPrecondition)$/.test(razao) || /etag mismatch|etag does not match|precondition[^.]{0,40}(fail|match)|contact[^.]{0,40}changed/i.test(mensagemApi))) {
        const conflito = new Error('O contato mudou no Google desde a última leitura. Atualize a prévia e confirme novamente.');
        conflito.conflito = true;
        throw conflito;
      }
      throw new Error('Google Contacts retornou HTTP ' + resposta.status + (mensagemApi ? ': ' + mensagemApi : '.'));
    }
    return json || {};
  }

  function origemContato(pessoa) {
    return (pessoa?.metadata?.sources || []).find((origem) => origem?.type === 'CONTACT' && origem?.id && origem?.etag) || null;
  }

  function ehContatoEditavel(pessoa) {
    return Boolean(pessoa?.resourceName && /^people\/[A-Za-z0-9_-]+$/.test(pessoa.resourceName) && origemContato(pessoa));
  }

  async function listarContatos() {
    const contatos = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        personFields: CAMPOS,
        pageSize: '1000',
        sources: 'READ_SOURCE_TYPE_CONTACT',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const resposta = await requisicaoJson(URL_API + '/people/me/connections?' + params.toString());
      (Array.isArray(resposta.connections) ? resposta.connections : []).forEach((pessoa) => {
        if (ehContatoEditavel(pessoa)) contatos.push(pessoa);
      });
      pageToken = resposta.nextPageToken || '';
    } while (pageToken);
    return contatos;
  }

  async function obterContato(resourceName) {
    if (!/^people\/[A-Za-z0-9_-]+$/.test(String(resourceName || ''))) throw new Error('Identificador de contato inválido.');
    const params = new URLSearchParams({ personFields: CAMPOS, sources: 'READ_SOURCE_TYPE_CONTACT' });
    const pessoa = await requisicaoJson(URL_API + '/' + resourceName + '?' + params.toString());
    if (!ehContatoEditavel(pessoa)) throw new Error('O registro não é um contato editável da agenda Google.');
    return pessoa;
  }

  function telefoneLimpo(telefone) {
    const t = {};
    if (telefone?.value) t.value = telefone.value;
    if (telefone?.type) t.type = telefone.type;
    if (telefone?.label && !telefone?.type) t.label = telefone.label;
    return t;
  }

  function aplicarAlteracoes(pessoa, alteracoes) {
    const campos = [];
    const resultado = {
      resourceName: pessoa.resourceName,
      etag: pessoa.etag,
      metadata: {
        sources: pessoa.metadata.sources
          .filter((origem) => origem?.type === 'CONTACT')
          .map((origem) => ({ type: origem.type, id: origem.id, etag: origem.etag })),
      },
    };
    if (Object.prototype.hasOwnProperty.call(alteracoes || {}, 'nome')) {
      const nome = String(alteracoes.nome || '').replace(/\s+/g, ' ').trim();
      if (!nome || nome.length > 150) throw new Error('O nome precisa ter entre 1 e 150 caracteres.');
      // "names" é um campo singular na fonte CONTACT; usar um único Name evita erro 400 da API.
      resultado.names = [{ givenName: nome }];
      campos.push('names');
    }
    if (Object.prototype.hasOwnProperty.call(alteracoes || {}, 'celular')) {
      const celular = String(alteracoes.celular || '').trim();
      const digitos = celular.replace(/\D/g, '');
      if (!celular || digitos.length < 10 || digitos.length > 13) throw new Error('Celular inválido para atualização.');
      const telefones = Array.isArray(pessoa.phoneNumbers) ? pessoa.phoneNumbers.map(telefoneLimpo) : [];
      const indice = alteracoes.indiceTelefone;
      if (Number.isInteger(indice) && indice >= 0) {
        if (indice >= telefones.length) throw new Error('O telefone selecionado mudou. Atualize a prévia.');
        telefones[indice] = Object.assign({}, telefones[indice], { value: celular });
        if (!telefones[indice].type) telefones[indice].type = 'mobile';
      } else {
        const novoDigitos = celular.replace(/\D/g, '');
        const jaExiste = telefones.some((t) => String(t.value || '').replace(/\D/g, '') === novoDigitos);
        if (!jaExiste) telefones.push({ value: celular, type: 'mobile' });
      }
      resultado.phoneNumbers = telefones;
      campos.push('phoneNumbers');
    }
    if (campos.length === 0) throw new Error('Nenhuma alteração foi selecionada.');
    return { pessoa: resultado, campos };
  }

  function atualizarContato(pessoaEsperada, alteracoes) {
    const trabalho = async () => {
      if (!ehContatoEditavel(pessoaEsperada)) throw new Error('O contato selecionado não pode ser editado.');
      const atual = await obterContato(pessoaEsperada.resourceName);
      const origemEsperada = origemContato(pessoaEsperada);
      const origemAtual = origemContato(atual);
      if (!origemEsperada || !origemAtual || origemEsperada.etag !== origemAtual.etag) {
        return { ok: false, conflito: true, pessoa: atual, mensagem: 'O contato mudou no Google desde a prévia. Atualize e revise a alteração antes de tentar novamente.' };
      }
      const preparado = aplicarAlteracoes(atual, alteracoes || {});
      const url = URL_API + '/' + atual.resourceName + ':updateContact?updatePersonFields=' + encodeURIComponent(preparado.campos.join(',')) + '&personFields=' + encodeURIComponent(CAMPOS);
      try {
        const pessoaAtualizada = await requisicaoJson(url, { method: 'PATCH', body: JSON.stringify(preparado.pessoa) });
        return { ok: true, pessoa: pessoaAtualizada };
      } catch (erro) {
        if (erro?.conflito) return { ok: false, conflito: true, pessoa: atual, mensagem: erro.message };
        throw erro;
      }
    };
    const proximo = filaMutacoes.then(trabalho, trabalho);
    filaMutacoes = proximo.then(() => undefined, () => undefined);
    return proximo;
  }

  // Restaura somente nomes e telefones do backup local, validando o etag atual antes do PATCH.
  function restaurarContato(pessoaEsperada, estadoOriginal) {
    const trabalho = async () => {
      if (!ehContatoEditavel(pessoaEsperada)) throw new Error('O contato selecionado não pode ser editado.');
      const atual = await obterContato(pessoaEsperada.resourceName);
      const origemEsperada = origemContato(pessoaEsperada);
      const origemAtual = origemContato(atual);
      if (!origemEsperada || !origemAtual || origemEsperada.etag !== origemAtual.etag) {
        return { ok: false, conflito: true, pessoa: atual, mensagem: 'Desfazer bloqueado: o contato mudou no Google desde a gravação.' };
      }
      const corpo = {
        resourceName: atual.resourceName,
        etag: atual.etag,
        metadata: { sources: atual.metadata.sources.filter((origem) => origem?.type === 'CONTACT').map((origem) => ({ type: origem.type, id: origem.id, etag: origem.etag })) },
        names: Array.isArray(estadoOriginal?.names) ? estadoOriginal.names.map((nome) => Object.assign({}, nome)) : [],
        phoneNumbers: Array.isArray(estadoOriginal?.phoneNumbers) ? estadoOriginal.phoneNumbers.map(telefoneLimpo) : [],
      };
      const url = URL_API + '/' + atual.resourceName + ':updateContact?updatePersonFields=names%2CphoneNumbers&personFields=' + encodeURIComponent(CAMPOS);
      try {
        const pessoaRestaurada = await requisicaoJson(url, { method: 'PATCH', body: JSON.stringify(corpo) });
        return { ok: true, pessoa: pessoaRestaurada };
      } catch (erro) {
        if (erro?.conflito) return { ok: false, conflito: true, pessoa: atual, mensagem: erro.message };
        throw erro;
      }
    };
    const proximo = filaMutacoes.then(trabalho, trabalho);
    filaMutacoes = proximo.then(() => undefined, () => undefined);
    return proximo;
  }

  // A biblioteca é carregada ao iniciar a conexão; o token é solicitado apenas após clique explícito.
  window.__googleContactsApi = Object.freeze({
    configurarClientId,
    prepararBiblioteca: () => carregarBiblioteca(),
    getClientId: () => clientId,
    status,
    conectar,
    desconectar,
    listarContatos,
    obterContato,
    atualizarContato,
    restaurarContato,
    ehContatoEditavel,
    origemContato,
    aplicarAlteracoes,
    CHAVE_CLIENT_ID,
    ESCOPO,
  });
})();