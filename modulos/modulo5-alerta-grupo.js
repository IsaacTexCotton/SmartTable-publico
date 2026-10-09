/* =========================================================================
 * MÓDULO 5: DETECÇÃO DE GRUPO ECONÔMICO COM VENCIDO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Lê a tabela "Clientes do grupo" direto do HTML da página (mesmo escondida,
 * display:none; não depende de clicar na aba "Grupo") e publica quais OUTRAS
 * empresas do grupo têm título vencido.
 *
 *   window.__alertaGrupo = { empresasComVencido: [{cnpj, razaoSocial,
 *                            vencido, url}, ...] }   (sempre presente)
 *   window.__grupoEconomico.buscarOutrasEmpresasComVencido(cnpj, grupoId)
 *   window.__numerosDiferentes (seção 4)
 *
 * A detecção não desenha nada: o CRM já avisa "N CNPJ do grupo vencido".
 * Quem e quanto o Alt+A mostra no relatório. A única coisa desenhada é o checkbox
 * "Números diferentes" (seção 4), ao lado do aviso do CRM.
 *
 * Quem depende deste módulo:
 *   - Módulo 4: Alt+A (gera o relatório das outras razões com vencido);
 *     temOutraRazaoComVencido() (muda a frase da MENSAGEM QUE O CLIENTE
 *     RECEBE, "de cada razão social"); Alt+S (envia aos números diferentes).
 *   - Módulo 7: só a razão mais urgente do grupo entra na fila; sem isso o
 *     mesmo grupo seria cobrado em duplicidade.
 *   - Módulo 8, conferir().
 *
 * Depende do Módulo 0. Ordem de carga: depois do Módulo 0 e ANTES do 4.
 * Baseado em UM exemplo real de HTML da tabela; se a estrutura variar,
 * ajuste CONFIG_GRUPO ou peça o HTML que não bateu.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__alertaGrupoCarregado) return;
  window.__alertaGrupoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Alerta de Grupo Econômico');

  // Módulo 0 precisa estar carregado ANTES (ordem do @require).
  const { montarUrlCliente } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO
   * --------------------------------------------------------------------- */
  const CONFIG_GRUPO = {
    TEXTO_TITULO_GRUPO: 'clientes do grupo',
    // Classe confirmada da linha do cliente ATUAL (ignorada na checagem).
    CLASSE_LINHA_ATUAL: 'bg-yellow-50',
    // Colunas confirmadas no HTML real: CNPJ, Razão Social, Cidade/UF,
    // Vencido, A Vencer, Ações.
    INDICE_COLUNA_CNPJ: 0,
    INDICE_COLUNA_RAZAO_SOCIAL: 1,
    INDICE_COLUNA_VENCIDO: 3,
  };

  /* ---------------------------------------------------------------------
   * 2. LOCALIZAR E LER A TABELA DE GRUPO
   * --------------------------------------------------------------------- */
  function encontrarTabelaDoGrupo() {
    const titulos = Array.from(document.querySelectorAll('h3'));
    const tituloGrupo = titulos.find((h) =>
      (h.textContent || '').toLowerCase().includes(CONFIG_GRUPO.TEXTO_TITULO_GRUPO)
    );
    if (!tituloGrupo) return null;

    // HTML confirmado: o <h3> fica numa <div class="mb-4">, irmã da
    // <div class="overflow-x-auto"> com a <table>. Sobe ao container comum.
    const containerDoTitulo = tituloGrupo.closest('div');
    const container = containerDoTitulo ? containerDoTitulo.parentElement : null;
    if (!container) return null;

    return container.querySelector('table');
  }

  /**
   * Normaliza a célula "Vencido": devolve o texto original quando há saldo
   * vencido de verdade, ou null.
   *
   * "R$ 0,00" também é null: não confirmado se o CRM renderiza zero assim
   * ou como "—"; tratar os dois evita que toda empresa do grupo entre em
   * empresasComVencido (mudaria a mensagem e abriria abas à toa).
   *
   * @param {string} texto Conteúdo cru da célula.
   * @returns {string|null} O texto original, ou null se não houver vencido.
   */
  function limparValorMonetario(texto) {
    const limpo = (texto || '').trim();
    if (!limpo || limpo === '—' || limpo === '-' || limpo === '--') return null;

    // "R$ 1.234,56" -> 1234.56. Texto sem número: confia no texto (na
    // dúvida, avisar a mais é mais seguro que deixar passar um vencido).
    const numero = parseFloat(limpo.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(numero) && numero === 0) return null;

    return limpo;
  }

  // Padrão de URL confirmado (igual ao Módulo 3): CNPJs do mesmo grupo
  // compartilham o grupoId, que já está na URL corrente.
  function extrairGrupoIdDaUrl() {
    const m = location.pathname.match(/\/crm\/clientes\/grupo\/(\d+)/);
    return m ? m[1] : null;
  }

  function verificarOutrasEmpresasComVencido() {
    const tabela = encontrarTabelaDoGrupo();
    if (!tabela) return [];

    const grupoId = extrairGrupoIdDaUrl();
    const linhas = Array.from(tabela.querySelectorAll('tbody tr'));
    const comVencido = [];

    linhas.forEach((linha) => {
      if (linha.classList.contains(CONFIG_GRUPO.CLASSE_LINHA_ATUAL)) return;

      const celulas = linha.querySelectorAll('td');
      if (celulas.length <= CONFIG_GRUPO.INDICE_COLUNA_VENCIDO) return;

      const cnpj = (celulas[CONFIG_GRUPO.INDICE_COLUNA_CNPJ].textContent || '').trim();
      const celulaRazao = celulas[CONFIG_GRUPO.INDICE_COLUNA_RAZAO_SOCIAL];
      const spanNome = celulaRazao ? celulaRazao.querySelector('span') : null;
      const razaoSocial = ((spanNome ? spanNome.textContent : celulaRazao.textContent) || '').trim();

      const vencido = limparValorMonetario(celulas[CONFIG_GRUPO.INDICE_COLUNA_VENCIDO].textContent);

      if (vencido) {
        comVencido.push({
          cnpj,
          razaoSocial,
          vencido,
          url: grupoId && cnpj ? montarUrlCliente(grupoId, cnpj) : null,
        });
      }
    });

    return comVencido;
  }

  /* ---------------------------------------------------------------------
   * 4. NÚMEROS DIFERENTES
   * -----------------------------------------------------------------
   * Algumas outras razões do grupo atendem num WhatsApp diferente do
   * cliente principal. O operador marca "Números diferentes" e informa um
   * número por razão, salvo pelo CNPJ do cliente principal (o `?cnpj=` da
   * URL, como nos Módulos 3 e 12) até desmarcar ou remover.
   *
   * Quem ENVIA é o Módulo 4 (Alt+S): 1º o número do cliente, pelo Módulo 2
   * (com registro de contato), depois cada número daqui, em ordem, sem
   * registro. Este módulo só guarda os números, a "ponte" do envio em
   * andamento (sobrevive ao location.reload() do Módulo 2) e desenha o
   * controle.
   * --------------------------------------------------------------------- */
  const CONFIG_NUMEROS = {
    // { [cnpj]: { numeros: [...], atualizadoEm } }. Entrada = checkbox marcado.
    CHAVE_NUMEROS: 'smarttable_numeros_diferentes_v1',
    // Envio em sequência em andamento -- ver Módulo 4, armarEnvioMultiplo.
    CHAVE_PENDENTE: 'smarttable_envio_numeros_pendente_v1',
    // Teto: mais que isso é quase certamente número colado errado.
    MAX_NUMEROS: 10,
    // Âncora: aviso do CRM (confirmado no HTML real,
    // tests/fixtures/cliente-ultimo-dia-scpc.html).
    TEXTO_AVISO_CRM: 'do grupo vencido',
    ID_CONTROLE: 'smarttable-numeros-diferentes',
    ID_CHECKBOX: 'smarttable-numeros-diferentes-check',
    ID_EDITOR: 'smarttable-numeros-diferentes-editor',
    ID_ENTRADA: 'smarttable-numeros-diferentes-entrada',
  };

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(location.search).get('cnpj') || '';
    } catch (erro) {
      return '';
    }
  }

  /**
   * Valida e normaliza um número de WhatsApp digitado pelo operador.
   *
   * Aceita pontuação comum de telefone e guarda SÓ os dígitos, sem o 55 do
   * país (o Módulo 4 põe o 55 ao abrir). Letra ou outro caractere recusa.
   *
   * @param {string} texto
   * @returns {{ok: true, numero: string} | {ok: false, erro: string}}
   */
  function normalizarNumero(texto) {
    const bruto = String(texto ?? '').trim();
    if (!bruto) return { ok: false, erro: 'Digite o número com DDD.' };
    if (/[^\d\s().+-]/.test(bruto)) {
      return { ok: false, erro: 'Use só números, com DDD (ex.: 11987654321).' };
    }
    let digitos = bruto.replace(/\D/g, '');
    // 55 só sai com 12+ dígitos: com 11 é o DDD 55 (RS), não o país.
    if (digitos.length >= 12 && digitos.startsWith('55')) digitos = digitos.slice(2);
    if (digitos.length !== 10 && digitos.length !== 11) {
      return { ok: false, erro: 'O número precisa de DDD + 8 ou 9 dígitos (10 ou 11 números no total).' };
    }
    if (!/^[1-9][1-9]/.test(digitos)) {
      return { ok: false, erro: 'DDD inválido -- digite sem o 0 na frente (ex.: 11, 21, 47).' };
    }
    if (digitos.length === 11 && digitos[2] !== '9') {
      return { ok: false, erro: 'Celular com 11 números começa com 9 depois do DDD.' };
    }
    return { ok: true, numero: digitos };
  }

  /** @param {string} digitos 10 ou 11 dígitos, já normalizados. */
  function formatarNumero(digitos) {
    const ddd = digitos.slice(0, 2);
    const resto = digitos.slice(2);
    const corte = resto.length === 9 ? 5 : 4;
    return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }

  function lerJson(chave) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : null;
    } catch (erro) {
      console.warn(`[Números diferentes] Dado ilegível em ${chave} -- tratando como vazio.`, erro?.message);
      return null;
    }
  }

  function gravarJson(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (erro) {
      console.warn(`[Números diferentes] Não consegui gravar ${chave}.`, erro?.message);
      window.__smartTableUtil?.toast?.('Não consegui salvar os números diferentes (armazenamento do navegador bloqueado ou cheio).', 6000);
      return false;
    }
  }

  function lerTodos() {
    const dados = lerJson(CONFIG_NUMEROS.CHAVE_NUMEROS);
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  }

  /**
   * Números salvos deste cliente, revalidados (inválido nunca é enviado).
   *
   * @param {string} cnpj
   * @returns {{ativo: boolean, numeros: string[]}}
   */
  function lerConfig(cnpj) {
    const entrada = cnpj ? lerTodos()[cnpj] : null;
    if (!entrada || typeof entrada !== 'object') return { ativo: false, numeros: [] };
    const brutos = Array.isArray(entrada.numeros) ? entrada.numeros : [];
    const numeros = [];
    brutos.forEach((n) => {
      const r = normalizarNumero(n);
      if (r.ok && !numeros.includes(r.numero)) numeros.push(r.numero);
      else console.warn('[Números diferentes] Um número salvo não é válido e foi ignorado.');
    });
    return { ativo: true, numeros };
  }

  function gravarConfig(cnpj, numeros) {
    const todos = lerTodos();
    if (numeros === null) delete todos[cnpj];
    else todos[cnpj] = { numeros, atualizadoEm: Date.now() };
    return gravarJson(CONFIG_NUMEROS.CHAVE_NUMEROS, Object.keys(todos).length ? todos : null);
  }

  /** Marca o checkbox: cria a entrada (ainda sem números) se não existir. */
  function ativar(cnpj) {
    if (!cnpj) return false;
    const atual = lerConfig(cnpj);
    return atual.ativo ? true : gravarConfig(cnpj, []);
  }

  /**
   * Desmarca: apaga os números E qualquer envio em sequência pela metade
   * deste cliente.
   */
  function desativar(cnpj) {
    if (!cnpj) return false;
    const pendente = lerPendente();
    if (pendente && pendente.cnpj === cnpj) limparPendente();
    return gravarConfig(cnpj, null);
  }

  /**
   * @param {string} cnpj
   * @param {string} texto O que o operador digitou.
   * @returns {{ok: true, numero: string} | {ok: false, erro: string}}
   */
  function adicionarNumero(cnpj, texto) {
    if (!cnpj) return { ok: false, erro: 'Não identifiquei o cliente desta página.' };
    const r = normalizarNumero(texto);
    if (!r.ok) return r;
    const { numeros } = lerConfig(cnpj);
    if (numeros.includes(r.numero)) return { ok: false, erro: 'Esse número já está na lista.' };
    if (numeros.length >= CONFIG_NUMEROS.MAX_NUMEROS) {
      return { ok: false, erro: `Máximo de ${CONFIG_NUMEROS.MAX_NUMEROS} números por cliente.` };
    }
    if (!gravarConfig(cnpj, [...numeros, r.numero])) return { ok: false, erro: 'Não consegui salvar (armazenamento do navegador).' };
    return r;
  }

  function removerNumero(cnpj, numero) {
    const { ativo, numeros } = lerConfig(cnpj);
    if (!ativo) return false;
    return gravarConfig(cnpj, numeros.filter((n) => n !== numero));
  }

  /** Os números que o Alt+S deve usar: vazio se desmarcado ou sem números. */
  function numerosAtivos(cnpj) {
    return lerConfig(cnpj).numeros;
  }

  /**
   * A ponte do envio em sequência, validada campo a campo. Fora do formato
   * é descartada (melhor não abrir um número do que abrir o errado).
   *
   * @returns {{cnpj: string, dia: string, mensagem: string, numeros: string[],
   *   proximo: number, confirmado: boolean, criadoEm: number,
   *   ultimoEnvioEm: number|null} | null}
   */
  function lerPendente() {
    const p = lerJson(CONFIG_NUMEROS.CHAVE_PENDENTE);
    if (!p) return null;
    const valido =
      typeof p === 'object' &&
      typeof p.cnpj === 'string' && p.cnpj &&
      typeof p.dia === 'string' &&
      typeof p.mensagem === 'string' && p.mensagem.trim() &&
      Array.isArray(p.numeros) && p.numeros.length > 0 &&
      p.numeros.every((n) => normalizarNumero(n).ok && normalizarNumero(n).numero === n) &&
      Number.isInteger(p.proximo) && p.proximo >= 0 && p.proximo < p.numeros.length &&
      typeof p.confirmado === 'boolean' &&
      Number.isFinite(p.criadoEm);
    if (!valido) {
      console.warn('[Números diferentes] Envio em andamento salvo num formato inválido -- descartado.');
      limparPendente();
      return null;
    }
    return p;
  }

  function gravarPendente(p) {
    return gravarJson(CONFIG_NUMEROS.CHAVE_PENDENTE, p);
  }

  function limparPendente() {
    return gravarJson(CONFIG_NUMEROS.CHAVE_PENDENTE, null);
  }

  /* --- desenho ---------------------------------------------------------- */

  const CORES_ND = {
    texto: '#16232F',
    suave: '#667085',
    borda: '#D0D5DD',
    fundo: '#FFFFFF',
    perigo: '#B42318',
    destaque: '#1B6B4A',
  };

  function el(tag, props, estilo) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    if (estilo) Object.assign(e.style, estilo);
    return e;
  }

  function encontrarAvisoDoCrm() {
    const botoes = Array.from(document.querySelectorAll('button'));
    return botoes.find((b) => (b.textContent || '').toLowerCase().includes(CONFIG_NUMEROS.TEXTO_AVISO_CRM)) || null;
  }

  function removerControle() {
    document.getElementById(CONFIG_NUMEROS.ID_CONTROLE)?.remove();
    document.getElementById(CONFIG_NUMEROS.ID_EDITOR)?.remove();
  }

  /**
   * Desenha (ou redesenha do zero) o checkbox e, marcado, o editor.
   * Aparece com outra razão com vencido OU números salvos/envio pela metade
   * (para dar pra desmarcar mesmo com a outra razão em dia).
   *
   * @param {{focarEntrada?: boolean, erro?: string}} [opcoes]
   */
  function desenharNumerosDiferentes(opcoes = {}) {
    const cnpj = cnpjDaPagina();
    const ancora = encontrarAvisoDoCrm();
    const config = lerConfig(cnpj);
    const pendente = lerPendente();
    const pendenteDaqui = pendente && pendente.cnpj === cnpj ? pendente : null;
    const temVencido = (window.__alertaGrupo?.empresasComVencido?.length ?? 0) > 0;

    removerControle();
    if (!cnpj || !ancora || !(temVencido || config.ativo || pendenteDaqui)) return;

    const controle = el(
      'label',
      { id: CONFIG_NUMEROS.ID_CONTROLE, title: 'Mandar a mesma cobrança também pro WhatsApp das outras razões do grupo (Alt+S)' },
      {
        marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle',
        fontSize: '11px', fontWeight: '600', color: CORES_ND.texto, cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }
    );
    const check = el('input', { type: 'checkbox', id: CONFIG_NUMEROS.ID_CHECKBOX, checked: config.ativo });
    check.addEventListener('change', () => {
      if (check.checked) ativar(cnpj);
      else desativar(cnpj);
      desenharNumerosDiferentes({ focarEntrada: check.checked });
    });
    controle.appendChild(check);
    controle.appendChild(document.createTextNode('Números diferentes'));
    if (config.numeros.length) controle.appendChild(document.createTextNode(` (${config.numeros.length})`));
    ancora.insertAdjacentElement('afterend', controle);

    if (!config.ativo) return;

    const editor = el(
      'div',
      { id: CONFIG_NUMEROS.ID_EDITOR },
      {
        margin: '6px 0 4px', padding: '8px 10px', maxWidth: '460px',
        background: CORES_ND.fundo, border: `1px solid ${CORES_ND.borda}`, borderRadius: '8px',
        fontSize: '12px', color: CORES_ND.texto, fontFamily: 'system-ui, -apple-system, sans-serif',
      }
    );
    editor.setAttribute('role', 'group');
    editor.setAttribute('aria-label', 'Números diferentes');

    editor.appendChild(el('div', { textContent: 'Ordem do Alt+S (um registro de contato só, no 1º envio):' }, { color: CORES_ND.suave, marginBottom: '4px' }));

    const lista = el('ol', {}, { margin: '0 0 6px', paddingLeft: '20px' });
    lista.appendChild(el('li', { textContent: 'Número do cliente, já selecionado no CRM' }));
    config.numeros.forEach((numero) => {
      const item = el('li', {}, { padding: '1px 0' });
      item.appendChild(el('span', { textContent: formatarNumero(numero) }, { fontFamily: 'ui-monospace, monospace', marginRight: '8px' }));
      const remover = el('button', { type: 'button', textContent: 'Remover' }, {
        border: 'none', background: 'transparent', color: CORES_ND.perigo, cursor: 'pointer', fontSize: '11px', padding: '0',
      });
      remover.setAttribute('aria-label', `Remover ${formatarNumero(numero)}`);
      remover.addEventListener('click', () => {
        removerNumero(cnpj, numero);
        desenharNumerosDiferentes();
      });
      item.appendChild(remover);
      lista.appendChild(item);
    });
    editor.appendChild(lista);

    const linha = el('div', {}, { display: 'flex', gap: '6px', alignItems: 'center' });
    const entrada = el('input', { type: 'text', id: CONFIG_NUMEROS.ID_ENTRADA, placeholder: 'DDD + número', inputMode: 'tel', autocomplete: 'off' }, {
      flex: '1', minWidth: '0', padding: '4px 8px', border: `1px solid ${CORES_ND.borda}`, borderRadius: '6px', fontSize: '12px',
    });
    entrada.setAttribute('aria-label', 'Número da outra razão, com DDD');
    const adicionar = el('button', { type: 'button', textContent: 'Adicionar' }, {
      padding: '4px 10px', border: 'none', borderRadius: '6px', background: CORES_ND.texto, color: '#fff', fontSize: '12px', cursor: 'pointer',
    });
    const confirmar = () => {
      const r = adicionarNumero(cnpj, entrada.value);
      desenharNumerosDiferentes({ focarEntrada: true, erro: r.ok ? '' : r.erro, rascunho: r.ok ? '' : entrada.value });
    };
    adicionar.addEventListener('click', confirmar);
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmar();
      }
    });
    linha.appendChild(entrada);
    linha.appendChild(adicionar);
    editor.appendChild(linha);

    if (opcoes.rascunho) entrada.value = opcoes.rascunho;
    if (opcoes.erro) {
      const erro = el('div', { textContent: opcoes.erro }, { color: CORES_ND.perigo, marginTop: '4px' });
      erro.setAttribute('role', 'alert');
      editor.appendChild(erro);
    }

    if (config.numeros.length === 0) {
      editor.appendChild(el('div', { textContent: 'Sem números, o Alt+S funciona como sempre.' }, { color: CORES_ND.suave, marginTop: '4px' }));
    } else if (!temVencido) {
      editor.appendChild(el('div', { textContent: 'Nenhuma outra razão do grupo tem vencido hoje: o Alt+S envia só pro cliente (os números continuam salvos).' }, { color: CORES_ND.suave, marginTop: '4px' }));
    }

    if (pendenteDaqui && pendenteDaqui.confirmado) {
      const total = pendenteDaqui.numeros.length + 1;
      const posicao = pendenteDaqui.proximo + 2;
      const aviso = el('div', {}, {
        marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${CORES_ND.borda}`, color: CORES_ND.destaque, fontWeight: '600',
      });
      aviso.setAttribute('role', 'status');
      aviso.dataset.papel = 'envio-pendente';
      aviso.appendChild(document.createTextNode(
        `Próximo: envio ${posicao} de ${total}, ${formatarNumero(pendenteDaqui.numeros[pendenteDaqui.proximo])}. ` +
        'Mande a mensagem anterior no WhatsApp e aperte Alt+S. '
      ));
      const cancelar = el('button', { type: 'button', textContent: 'Cancelar envios restantes' }, {
        border: 'none', background: 'transparent', color: CORES_ND.perigo, cursor: 'pointer', fontSize: '11px', padding: '0', fontWeight: '600',
      });
      cancelar.addEventListener('click', () => {
        limparPendente();
        desenharNumerosDiferentes();
        window.__smartTableUtil?.toast?.('Envios restantes cancelados.');
      });
      aviso.appendChild(cancelar);
      editor.appendChild(aviso);
    }

    // O aviso do CRM fica num <p>: o editor (bloco) vai DEPOIS dele.
    const paragrafo = ancora.closest('p') || ancora.parentElement;
    paragrafo.insertAdjacentElement('afterend', editor);

    if (opcoes.focarEntrada) entrada.focus();
  }

  window.__numerosDiferentes = {
    normalizarNumero,
    formatarNumero,
    lerConfig,
    ativar,
    desativar,
    adicionarNumero,
    removerNumero,
    numerosAtivos,
    lerPendente,
    gravarPendente,
    limparPendente,
    desenhar: desenharNumerosDiferentes,
    CONFIG_NUMEROS,
  };

  /* ---------------------------------------------------------------------
   * 3. EXPOSIÇÃO E INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  // Exposto ao Módulo 4 (linha extra do Alt+A). Decisão do usuário:
  // com outra razão vencida a mensagem muda e cada razão gera seu próprio
  // relatório (um por página, sem combinar numa imagem só).
  function expor(empresas, leituraIncompleta = false) {
    window.__alertaGrupo = { empresasComVencido: empresas, leituraIncompleta };
    // O checkbox só faz sentido depois de saber se há vencido: desenha aqui.
    try {
      desenharNumerosDiferentes();
    } catch (erro) {
      console.warn('[Alerta Grupo] Não consegui desenhar "Números diferentes" -- a detecção do grupo segue normal.', erro);
    }
  }

  function checar(leituraIncompleta = false) {
    expor(verificarOutrasEmpresasComVencido(), leituraIncompleta);
  }

  /*
   * GRUPO PELA API (Alt+U sem abrir aba). A tabela "Clientes do grupo"
   * carrega DEPOIS da página (vem vazia no HTML baixado por fetch). O CRM
   * chama GET /api/crm/negociacoes/grupo-outros-com-divida?cliente=<CNPJ>;
   * confirmado por diagnóstico: data = [{cnpj, razaoSocial, grupoCliente,
   * dividaVencida}], mesmas empresas da tabela. Resposta fora do formato
   * vira ERRO (nunca "grupo vazio" calado: grupo não detectado cobra em
   * duplicidade).
   */
  const TIMEOUT_API_GRUPO_MS = 5000;

  /**
   * @param {string} cnpj do cliente (como na URL)
   * @param {string|null} [grupoId] o da URL do cliente, pra montar a URL das outras
   * @returns {Promise<{cnpj: string, razaoSocial: string, vencido: string, url: string}[]>}
   */
  async function buscarOutrasEmpresasComVencido(cnpj, grupoId = null) {
    const controle = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    const limite = setTimeout(() => controle?.abort(), TIMEOUT_API_GRUPO_MS);
    try {
      const r = await window.fetch(`/api/crm/negociacoes/grupo-outros-com-divida?cliente=${encodeURIComponent(cnpj)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: controle?.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json || json.success !== true || !Array.isArray(json.data)) throw new Error('resposta do grupo fora do formato esperado');
      const util = window.__smartTableUtil;
      return json.data
        .filter((e) => e && typeof e.cnpj === 'string' && e.cnpj && Number(e.dividaVencida) > 0)
        .map((e) => ({
          cnpj: e.cnpj,
          razaoSocial: typeof e.razaoSocial === 'string' ? e.razaoSocial : '',
          vencido: util?.formatarMoeda ? util.formatarMoeda(Number(e.dividaVencida)) : String(e.dividaVencida),
          url: grupoId && util?.montarUrlCliente ? util.montarUrlCliente(grupoId, e.cnpj) : '',
        }));
    } finally {
      clearTimeout(limite);
    }
  }

  window.__grupoEconomico = { buscarOutrasEmpresasComVencido };

  function obterNomeAbaAtiva() {
    // O botão INATIVO tem o padrão confirmado ("text-gray-500" +
    // "border-transparent"); o ativo é o que foge dele.
    const botoes = Array.from(document.querySelectorAll('.tab-btn[id^="tab-"]'));
    const ativo = botoes.find((b) => {
      const classes = b.className || '';
      return !(classes.includes('text-gray-500') && classes.includes('border-transparent'));
    });
    return ativo && ativo.id ? ativo.id.replace(/^tab-/, '') : null;
  }

  // Confirmado no HTML real: com 2+ empresas no grupo, #tab-grupo ganha um
  // <span class="... rounded-full ..."> com o número; com 1 (ou sem grupo)
  // não. Não diz quem está vencido, mas com 1 empresa não há "outra".
  function obterQuantidadeEmpresasNoGrupo() {
    const botaoGrupo = document.getElementById('tab-grupo');
    if (!botaoGrupo) return 0;

    const badge = botaoGrupo.querySelector('.rounded-full');
    if (!badge) return 1;

    const numero = parseInt((badge.textContent || '').trim(), 10);
    return Number.isFinite(numero) ? numero : 1;
  }

  function iniciar() {
    // Sem "outra" empresa: pula a etapa, sem abrir aba.
    if (obterQuantidadeEmpresasNoGrupo() <= 1) {
      expor([]); // window.__alertaGrupo tem que existir sempre
      return;
    }

    // Confirmado: a tabela só carrega quando a aba "Grupo" é aberta. Abre,
    // checa e volta à aba que estava ativa.
    const abaOriginal = obterNomeAbaAtiva();

    if (typeof window.showTab !== 'function') {
      console.warn('[Alerta Grupo] window.showTab não encontrada como função global -- checando sem abrir a aba.');
      checar();
      return;
    }

    window.showTab('grupo');

    let finalizado = false;
    let observer = null; // declarada ANTES de qualquer chamada a finalizar()

    function finalizar(porTempo = false) {
      if (finalizado) return;
      finalizado = true;
      if (observer) observer.disconnect();
      // Rodada C (09/10/2026, autorizado): desistir por tempo SEM a tabela do grupo publicava "nenhuma outra razão com vencido" como se
      // fosse certeza. Agora avisa (console e tela); o aviso do CRM ("N CNPJ do grupo vencido") continua valendo como conferência.
      const semTabela = porTempo === true && !encontrarTabelaDoGrupo();
      checar(semTabela);
      if (semTabela) {
        console.warn('[Alerta Grupo] A tabela "Clientes do grupo" não carregou a tempo: não sei se outra razão do grupo tem vencido.');
        window.__smartTableUtil?.toast?.('Não consegui ler o grupo a tempo: não sei se outra razão tem vencido. Confira o aviso do CRM antes de cobrar (Alt+A).', 9000);
      }

      // Só restaura se a aba ainda for a que deixamos; senão sobrescreveria
      // algo aberto nesse meio tempo (ex.: Alt+C).
      const abaAgora = obterNomeAbaAtiva();
      if (abaOriginal && abaOriginal !== 'grupo' && abaAgora === 'grupo') {
        window.showTab(abaOriginal);
      }
    }

    // Dados já presentes: não precisa esperar.
    if (encontrarTabelaDoGrupo()) {
      finalizar();
      return;
    }

    // Observa o DOM em vez de esperar tempo fixo (o "flash" da aba dura só o
    // carregamento). O callback é agrupado com requestAnimationFrame: sem
    // isso cada mutação dispara uma varredura de querySelectorAll('h3').
    let verificacaoAgendada = false;
    observer = new MutationObserver(() => {
      if (verificacaoAgendada || finalizado) return;
      verificacaoAgendada = true;
      requestAnimationFrame(() => {
        verificacaoAgendada = false;
        if (encontrarTabelaDoGrupo()) {
          finalizar();
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Rede de segurança: se a tabela nunca aparecer, desiste em vez de
    // ficar preso na aba Grupo.
    setTimeout(() => finalizar(true), 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  // Hook de depuração/teste (como window.filaDebug e window.__atalhosDebug).
  window.__alertaGrupoDebug = {
    verificarOutrasEmpresasComVencido,
    limparValorMonetario,
    CONFIG_GRUPO,
  };
})();
