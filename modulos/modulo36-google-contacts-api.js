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
    if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
    if (biblioteca) return biblioteca;
    biblioteca = new Promise((resolve, reject) => {
      let script = document.getElementById(ID_SCRIPT);
      if (!script) {
        script = document.createElement('script');
        script.id = ID_SCRIPT;
        script.src = URL_GIS;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      const timer = window.setTimeout(() => reject(new Error('O Google Identity Services não carregou. Verifique a conexão e a política de segurança do CRM.')), 15000);
      script.addEventListener('load', () => {
        window.clearTimeout(timer);
        const oauth = window.google?.accounts?.oauth2;
        if (oauth) resolve(oauth);
        else reject(new Error('A biblioteca de autorização do Google carregou sem a API OAuth esperada.'));
      }, { once: true });
      script.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('Não foi possível carregar a biblioteca de autorização do Google. Verifique se accounts.google.com está permitido.')); 
      }, { once: true });
      if (window.google?.accounts?.oauth2) {
        window.clearTimeout(timer);
        resolve(window.google.accounts.oauth2);
      }
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
      pedidoToken = { resolve, reject };
      try {
        clienteToken = oauth.initTokenClient({
          client_id: clientId,
          scope: ESCOPO,
          callback: (resposta) => {
            const pendente = pedidoToken;
            pedidoToken = null;
            if (resposta?.error || !resposta?.access_token) {
              token = null;
              tokenExpiraEm = 0;
              pendente?.reject(new Error('O Google não autorizou o acesso aos contatos' + (resposta?.error ? ' (' + resposta.error + ')' : '') + '.'));
              return;
            }
            token = resposta.access_token;
            tokenExpiraEm = Date.now() + Math.max(60, Number(resposta.expires_in) || 3600) * 1000;
            pendente?.resolve(status());
          },
          error_callback: (erro) => {
            const pendente = pedidoToken;
            pedidoToken = null;
            token = null;
            tokenExpiraEm = 0;
            const detalhe = erro?.type === 'popup_failed_to_open'
              ? 'O navegador bloqueou a janela de autorização. Permita pop-ups para o CRM e tente novamente.'
              : 'A autorização do Google foi interrompida' + (erro?.type ? ' (' + erro.type + ')' : '') + '.';
            pendente?.reject(new Error(detalhe));
          },
        });
        clienteToken.requestAccessToken({ prompt: token ? '' : 'consent' });
      } catch (erro) {
        pedidoToken = null;
        reject(new Error(erro?.message || 'Não foi possível iniciar a autorização do Google.'));
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

  async function requisicaoJson(url, opcoes) {
    const cabecalhos = Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + tokenValido() }, opcoes?.headers || {});
    if (opcoes?.body && !cabecalhos['Content-Type']) cabecalhos['Content-Type'] = 'application/json';
    let resposta;
    try {
      resposta = await window.fetch(url, Object.assign({}, opcoes || {}, { headers: cabecalhos }));
    } catch {
      throw new Error('Falha de rede ao acessar o Google Contacts.');
    }
    let json = null;
    try { json = await resposta.json(); } catch { /* corpo vazio/não JSON */ }
    if (!resposta.ok) {
      if (resposta.status === 401) {
        token = null;
        tokenExpiraEm = 0;
        throw new Error('O Google recusou a autorização. Conecte a conta novamente.');
      }
      if (resposta.status === 403) throw new Error('O Google recusou o acesso. Confira se a People API está habilitada e se o consentimento inclui contatos.');
      if (resposta.status === 429) throw new Error('O Google limitou temporariamente as consultas. Aguarde antes de tentar novamente.');
      const razao = json?.error?.status || json?.error?.errors?.[0]?.reason || '';
      if (resposta.status === 400 && /failedPrecondition|etag|condition/i.test(razao + ' ' + (json?.error?.message || ''))) {
        const conflito = new Error('O contato mudou no Google desde a última leitura. Atualize a prévia e confirme novamente.');
        conflito.conflito = true;
        throw conflito;
      }
      throw new Error('Google Contacts retornou HTTP ' + resposta.status + (json?.error?.message ? ': ' + json.error.message : '.'));
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

  // Pré-carrega a biblioteca antes do primeiro clique; assim o pedido OAuth parte de uma interação do usuário.
  window.__googleContactsApi = {
    configurarClientId,
    prepararBiblioteca: () => carregarBiblioteca(),
    getClientId: () => clientId,
    status,
    conectar,
    desconectar,
    listarContatos,
    obterContato,
    atualizarContato,
    ehContatoEditavel,
    origemContato,
    aplicarAlteracoes,
    CHAVE_CLIENT_ID,
    ESCOPO,
  };
})();