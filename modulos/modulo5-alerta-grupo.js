/* =========================================================================
 * MÓDULO 5: DETECÇÃO DE GRUPO ECONÔMICO COM VENCIDO — CRM TexCotton
 * -------------------------------------------------------------------------
 * O que faz: ao entrar na página de um cliente, lê a tabela "Clientes do
 * grupo" (aba "Grupo") e publica quais OUTRAS empresas do mesmo grupo
 * econômico têm título vencido. Não depende de clicar na aba "Grupo" — lê a
 * tabela direto do HTML da página, mesmo escondida (display:none).
 *
 *   window.__alertaGrupo = { empresasComVencido: [{cnpj, razaoSocial,
 *                            vencido, url}, ...] }   (sempre presente)
 *
 * A DETECÇÃO NÃO DESENHA NADA. Ele já mostrou um banner no topo da página;
 * o banner saiu na v1.14.0, quando o próprio CRM passou a avisar ("1 CNPJ do
 * grupo vencido", ao lado do grupo, na página do cliente). Manter dois
 * avisos da mesma coisa é ruído, e o nosso carregava toda a lógica de
 * posicionamento (z-index, acompanhar a barra de navegação rápida,
 * ResizeObserver) que sozinha causou três bugs -- a parte mais difícil de
 * testar do projeto.
 *
 * O QUE O BANNER MOSTRAVA E O AVISO DO CRM NÃO MOSTRA: quem e quanto. Isso
 * continua a uma tecla de distância, no Alt+G, que abre todas as razões com
 * vencido de uma vez.
 *
 * QUEM DEPENDE DESTE MÓDULO (é por isso que ele continua existindo):
 *   - Módulo 4, Alt+G            -> abre as outras razões com vencido.
 *   - Módulo 4, temOutraRazaoComVencido() -> muda a frase do relatório na
 *     MENSAGEM QUE O CLIENTE RECEBE ("de cada razão social").
 *   - Módulo 7, fila por prioridade -> só a razão mais urgente do grupo
 *     entra na fila; sem isso o mesmo grupo seria cobrado em duplicidade.
 *   - Módulo 8, conferir().
 *
 * A ÚNICA COISA QUE ESTE MÓDULO DESENHA (v1.36.0): o checkbox "Números
 * diferentes", logo ao lado do aviso do próprio CRM ("N CNPJ do grupo
 * vencido"). Algumas filiais do grupo atendem num WhatsApp diferente do
 * cliente principal; os números ficam salvos por CNPJ do cliente principal
 * e o Alt+S (Módulo 4) manda a mesma mensagem pra cada um, em sequência,
 * com UM registro de contato só. Ver seção 4 abaixo e
 * window.__numerosDiferentes.
 *
 * Onde colar: depois do Módulo 0 e ANTES do Módulo 4.
 *
 * IMPORTANTE — baseado em UM exemplo real de HTML da tabela "Clientes do
 * grupo". Se a estrutura variar (ex.: cliente sem grupo, mais colunas em
 * outra tela), ajuste CONFIG_GRUPO abaixo ou me manda o HTML que não bateu.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__alertaGrupoCarregado) return;
  window.__alertaGrupoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Alerta de Grupo Econômico');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  const { montarUrlCliente } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO
   * --------------------------------------------------------------------- */
  const CONFIG_GRUPO = {
    // Texto usado pra localizar o título "Clientes do grupo" (minúsculo).
    TEXTO_TITULO_GRUPO: 'clientes do grupo',
    // Classe confirmada que marca a linha do cliente ATUAL na tabela —
    // essa linha é ignorada na checagem (não faz sentido alertar sobre o
    // próprio cliente que você já está vendo).
    CLASSE_LINHA_ATUAL: 'bg-yellow-50',
    // Índice das colunas da tabela (0 = primeira). Confirmado no HTML real:
    // CNPJ, Razão Social, Cidade/UF, Vencido, A Vencer, Ações.
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

    // No HTML confirmado: o <h3> fica dentro de uma <div class="mb-4">, que
    // é irmã da <div class="overflow-x-auto"> que contém a <table>. Subimos
    // até o container comum e procuramos a tabela dentro dele.
    const containerDoTitulo = tituloGrupo.closest('div');
    const container = containerDoTitulo ? containerDoTitulo.parentElement : null;
    if (!container) return null;

    return container.querySelector('table');
  }

  /**
   * Normaliza a célula "Vencido" da tabela de grupo: devolve o texto original
   * quando há saldo vencido de verdade, ou null quando não há.
   *
   * ENDURECIDO (achado de revisão): antes, QUALQUER texto que não fosse
   * vazio nem travessão contava como "tem vencido" -- inclusive um
   * "R$ 0,00". Se o CRM renderizar zero assim em vez de "—" (não confirmado
   * ao vivo), TODA empresa do grupo entraria em empresasComVencido, mudando
   * a mensagem do Alt+A e fazendo o Alt+A abrir abas de fundo à toa. Zero
   * não é saldo vencido em nenhuma das duas formas de renderizar, então
   * tratar os dois casos é correto independentemente de qual o CRM usa.
   *
   * @param {string} texto Conteúdo cru da célula.
   * @returns {string|null} O texto original, ou null se não houver vencido.
   */
  function limparValorMonetario(texto) {
    const limpo = (texto || '').trim();
    if (!limpo || limpo === '—' || limpo === '-' || limpo === '--') return null;

    // "R$ 1.234,56" -> 1234.56. Se não sobrar número nenhum (texto
    // inesperado), mantém o comportamento antigo de confiar no texto -- na
    // dúvida, avisar a mais é mais seguro que deixar passar um vencido.
    const numero = parseFloat(limpo.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(numero) && numero === 0) return null;

    return limpo;
  }

  // Mesmo padrão de URL confirmado e já usado no Módulo 3 (fila): múltiplos
  // CNPJs podem compartilhar o mesmo grupoId, e como a outra razão está no
  // MESMO grupo da página atual, o grupoId já está na própria URL corrente.
  function extrairGrupoIdDaUrl() {
    const m = location.pathname.match(/\/crm\/clientes\/grupo\/(\d+)/);
    return m ? m[1] : null;
  }

  function verificarOutrasEmpresasComVencido() {
    const tabela = encontrarTabelaDoGrupo();
    if (!tabela) return []; // sem tabela de grupo nesta página -- nada a avisar

    const grupoId = extrairGrupoIdDaUrl();
    const linhas = Array.from(tabela.querySelectorAll('tbody tr'));
    const comVencido = [];

    linhas.forEach((linha) => {
      // Ignora a linha do cliente ATUAL -- não faz sentido "avisar" sobre
      // o próprio cliente que a página já está mostrando.
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
   * 4. NÚMEROS DIFERENTES (pedido do usuário, v1.36.0)
   * -----------------------------------------------------------------
   * Algumas outras razões do grupo com título em aberto atendem num
   * WhatsApp diferente do cliente principal. O operador marca "Números
   * diferentes" e informa um número por razão. Os números ficam salvos
   * pelo CNPJ do cliente principal (o mesmo `?cnpj=` da URL que os Módulos
   * 3 e 12 usam) até o checkbox ser desmarcado ou os números removidos.
   *
   * QUEM ENVIA é o Módulo 4 (Alt+S): 1º o número do cliente, pelo Módulo 2
   * de sempre (com o registro de contato), depois cada número daqui, na
   * ordem em que foram inseridos, sem registro nenhum. Este módulo só
   * guarda os números, a "ponte" do envio em andamento (que precisa
   * sobreviver ao location.reload() do Módulo 2) e desenha o controle.
   * --------------------------------------------------------------------- */
  const CONFIG_NUMEROS = {
    // { [cnpj]: { numeros: ['11987654321', ...], atualizadoEm } }. Existir
    // entrada = checkbox marcado.
    CHAVE_NUMEROS: 'smarttable_numeros_diferentes_v1',
    // Envio em sequência em andamento -- ver Módulo 4, armarEnvioMultiplo.
    CHAVE_PENDENTE: 'smarttable_envio_numeros_pendente_v1',
    // Teto de segurança: um grupo real tem poucas razões. Mais que isso é
    // quase certamente número colado errado, e cada um vira um WhatsApp.
    MAX_NUMEROS: 10,
    // Âncora: o aviso do próprio CRM, ao lado do grupo (confirmado no HTML
    // real, tests/fixtures/cliente-ultimo-dia-scpc.html).
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
   * Aceita a pontuação comum de telefone ("(11) 98765-4321", "+55 11 ...")
   * e guarda SÓ os dígitos, sem o 55 do país -- o Módulo 4 põe o 55 na hora
   * de abrir, igual ao abrirWhatsAppCliente() da página. Letra ou qualquer
   * outro caractere recusa: é sinal de que colaram a coisa errada.
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
    // 55 do país só é tirado com 12+ dígitos: "55 9xxxx-xxxx" com 11 é o
    // DDD 55 (RS), não o código do país.
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
   * Os números salvos deste cliente, já revalidados (um número que não
   * passe mais na validação nunca é enviado -- vira um aviso no console).
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
   * Desmarca: apaga os números deste cliente E qualquer envio em sequência
   * dele ainda pela metade -- desmarcar é "não mande mais pra esses números".
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
   * A ponte do envio em sequência, validada campo a campo. Qualquer coisa
   * fora do formato é descartada: melhor não abrir um número do que abrir o
   * errado.
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
   * Aparece quando há outra razão com vencido OU quando este cliente já tem
   * números salvos/envio pela metade -- pra dar pra desmarcar mesmo no dia
   * em que a outra razão está em dia.
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

    // O aviso do CRM fica dentro de um <p>: o editor (um bloco) vai logo
    // DEPOIS do parágrafo, não dentro dele.
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
  // Exposto pra outros módulos (Módulo 4: linha extra na mensagem do Alt+A
  // e o atalho de abrir as outras razões em nova aba) sem precisar reler a
  // tabela por conta própria. CONFIRMADO com o usuário: mensagem diferente
  // quando outra razão do grupo também tem saldo vencido, e um jeito
  // conveniente de gerar o relatório de cada uma (duas empresas = dois
  // relatórios separados, um por página, sem combinar numa imagem só).
  function expor(empresas) {
    window.__alertaGrupo = { empresasComVencido: empresas };
    // O checkbox "Números diferentes" só faz sentido depois de saber se
    // alguma outra razão tem vencido -- desenha aqui, nunca antes.
    try {
      desenharNumerosDiferentes();
    } catch (erro) {
      console.warn('[Alerta Grupo] Não consegui desenhar "Números diferentes" -- a detecção do grupo segue normal.', erro);
    }
  }

  function checar() {
    expor(verificarOutrasEmpresasComVencido());
  }

  /*
   * GRUPO PELA API (v1.45.0, Alt+U sem abrir aba). A tabela "Clientes do
   * grupo" carrega DEPOIS da página (vem vazia no HTML baixado por fetch).
   * A própria página do CRM chama GET /api/crm/negociacoes/
   * grupo-outros-com-divida?cliente=<CNPJ> -- CONFIRMADO por diagnóstico
   * (25/09/2026): num cliente com "1 CNPJ do grupo vencido", a API devolveu
   * a mesma 1 empresa que a leitura da tabela; data = [{cnpj, razaoSocial,
   * grupoCliente, dividaVencida}]. Resposta fora do formato vira ERRO (nunca
   * "grupo vazio" calado: um grupo não detectado cobra em duplicidade).
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
    // Heurística: entre os botões de aba (.tab-btn com id="tab-XXX"), o
    // botão INATIVO segue o padrão confirmado (classes "text-gray-500" +
    // "border-transparent"). O ativo é o que foge desse padrão.
    const botoes = Array.from(document.querySelectorAll('.tab-btn[id^="tab-"]'));
    const ativo = botoes.find((b) => {
      const classes = b.className || '';
      return !(classes.includes('text-gray-500') && classes.includes('border-transparent'));
    });
    return ativo && ativo.id ? ativo.id.replace(/^tab-/, '') : null;
  }

  // CONFIRMADO no HTML real: quando o cliente tem 2+ empresas no grupo, o
  // botão #tab-grupo ganha um <span class="... rounded-full ..."> extra só
  // com o número. Quando é 1 empresa só (ou sem grupo), esse span não existe.
  // Isso NÃO diz se alguma empresa está vencida (só a tabela de dentro da
  // aba sabe isso) -- mas se só tem 1 empresa, não tem "outra" pra alertar,
  // então dá pra pular a etapa inteira sem abrir aba nenhuma.
  function obterQuantidadeEmpresasNoGrupo() {
    const botaoGrupo = document.getElementById('tab-grupo');
    if (!botaoGrupo) return 0; // nem tem aba de grupo nesta página

    const badge = botaoGrupo.querySelector('.rounded-full');
    if (!badge) return 1; // aba existe mas sem número -- só o próprio cliente

    const numero = parseInt((badge.textContent || '').trim(), 10);
    return Number.isFinite(numero) ? numero : 1;
  }

  function iniciar() {
    // OTIMIZAÇÃO: se o badge do botão "Grupo" mostra 1 empresa (ou não tem
    // badge, ou nem tem a aba), não existe "outra" empresa pra alertar --
    // pula a etapa inteira, sem abrir aba nem esperar nada.
    if (obterQuantidadeEmpresasNoGrupo() <= 1) {
      expor([]); // mantém window.__alertaGrupo sempre presente pros outros módulos
      return;
    }

    // CONFIRMADO: a tabela "Clientes do grupo" só é carregada quando a aba
    // "Grupo" é aberta (não vem pronta no HTML inicial). Por isso, abrimos
    // essa aba sozinhos, checamos, e voltamos pra aba que estava ativa —
    // sem exigir nenhuma ação do usuário.
    const abaOriginal = obterNomeAbaAtiva();

    if (typeof window.showTab !== 'function') {
      console.warn('[Alerta Grupo] window.showTab não encontrada como função global -- checando sem abrir a aba.');
      checar();
      return;
    }

    window.showTab('grupo');

    let finalizado = false;
    let observer = null; // declarada aqui, ANTES de qualquer chamada a finalizar()

    function finalizar() {
      if (finalizado) return;
      finalizado = true;
      if (observer) observer.disconnect();
      checar();

      // CORREÇÃO (item C3): só restaura a aba original se ela ainda for a
      // mesma que deixamos (ou seja, nada mais mudou a aba nesse meio
      // tempo). Sem checar isso, se outra ação (ex.: Alt+C abrindo a tela
      // de contato, caso ela use o mesmo sistema de abas) mudar a aba
      // DURANTE nossa espera, nós forçaríamos a volta por cima dessa ação
      // mais recente -- fechando algo que o usuário acabou de abrir.
      const abaAgora = obterNomeAbaAtiva();
      if (abaOriginal && abaOriginal !== 'grupo' && abaAgora === 'grupo') {
        window.showTab(abaOriginal);
      }
    }

    // Verificação imediata: se os dados já estiverem lá (ex.: aba já tinha
    // sido aberta antes nesta mesma sessão, ou preservada num recarregamento),
    // nem precisa esperar nada.
    if (encontrarTabelaDoGrupo()) {
      finalizar();
      return;
    }

    // EM VEZ DE esperar um tempo fixo "por garantia", observamos o DOM e
    // agimos assim que a tabela aparecer. Isso deixa o "flash" da aba do
    // tamanho real do carregamento, em vez de sempre esperar o pior caso.
    //
    // CORREÇÃO (item A2): o callback do MutationObserver é agrupado com
    // requestAnimationFrame -- sem isso, cada mutação individual de DOM na
    // página (ex.: algum widget de terceiros atualizando algo) dispara uma
    // nova varredura de document.querySelectorAll('h3'), o que pode virar
    // dezenas de buscas no DOM por segundo numa página muito ativa.
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

    // Rede de segurança: se a tabela nunca aparecer (ex.: cliente sem
    // grupo, ou showTab com nome diferente do esperado), desiste depois de
    // um tempo em vez de ficar travado na aba Grupo pra sempre.
    setTimeout(finalizar, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  // Hook de depuração/teste (mesmo padrão do window.filaDebug no Módulo 3
  // e window.__atalhosDebug no Módulo 4).
  window.__alertaGrupoDebug = {
    verificarOutrasEmpresasComVencido,
    limparValorMonetario,
    CONFIG_GRUPO,
  };
})();
