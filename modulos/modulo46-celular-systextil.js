/* =========================================================================
 * MÓDULO 46: CELULAR DO RESPONSÁVEL NO SYSTÊXTIL
 * -------------------------------------------------------------------------
 * Na página do cliente, compara o "Celular" do CADASTRO com o "Celular Responsável". Só quando os dois
 * DIVERGEM (e o do responsável é um celular completo: DDD + 9 dígitos, o 1º é 9) aparece o botão
 * "Celular no Systêxtil", ao lado do Plano. O modal mostra os dois números MASCARADOS e, no clique em
 * "Enviar ao Systêxtil", entrega o pedido por evento DOM ao userscript "SmartTable → Systêxtil (celular)"
 * (integracoes/systextil-celular-bridge.user.js), que preenche o campo Celular na tela Cadastro de Clientes
 * (pedi_f010). QUEM GRAVA É O OPERADOR, com F9: este módulo e a ponte nunca salvam nada no ERP.
 *
 * Decisões do usuário (25/11/2026): vale o Celular Responsável; um cliente por vez; responsável vazio
 * (ou que não é celular completo) = o botão não aparece; DDD divergente: não fazer nada (só o número
 * de 9 dígitos vai); o botão só aparece quando os números divergem.
 *
 * Só lê a página. Nada é gravado no CRM. O número nunca vai para log, console nem armazenamento daqui:
 * só no evento do clique. Carga: depois dos Módulos 0, 28 (chaveDoCelular) e 43 (âncora do botão).
 * Expõe window.__celularSystextil.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__celularSystextilCarregado) return;
  window.__celularSystextilCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Celular no Systêxtil');

  const CONFIG = Object.freeze({
    ID_BOTAO: 'smarttable-botao-celular-systextil',
    ID_PAINEL: 'smarttable-painel-celular-systextil',
    ID_BOTAO_PLANO: 'smarttable-botao-plano-cliente',
    ID_BOTAO_ALERTA: 'smarttable-botao-alerta-cliente',
    SELETOR_ANCORA: 'button[onclick="abrirModalResponsavel()"]',
    EVENTO_ENVIAR: 'smarttable:systextil:atualizar-celular',
    EVENTO_RESULTADO: 'smarttable:systextil:celular-resultado',
    SCHEMA: 1,
    TTL_PEDIDO_MS: 5 * 60 * 1000,
    ESPERA_PONTE_MS: 8000,
    TOPO_BOTAO_FLUTUANTE: '172px',
    ATRASO_REAVALIAR_MS: 150,
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  });

  // Classes NATIVAS do CRM, as mesmas do modal do Plano (Módulo 43), vistas nas fixtures reais.
  const CLASSES = Object.freeze({
    fundo: 'fixed inset-0 bg-gray-900/40 backdrop-blur-sm items-center justify-center z-50 py-4 flex outline-none',
    cartao: 'bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 my-auto border border-gray-200 flex flex-col max-h-[calc(100vh-2rem)]',
    topo: 'px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0',
    topoEsquerda: 'flex items-center gap-2.5',
    iconeCaixa: 'p-1.5 bg-gray-100 rounded-lg',
    icone: 'w-4 h-4 text-gray-400',
    titulo: 'text-sm font-semibold text-gray-800',
    subtitulo: 'text-xs text-gray-500 mt-0.5',
    fechar: 'text-gray-400 hover:text-gray-600 transition',
    iconeFechar: 'w-5 h-5',
    corpo: 'overflow-y-auto px-5 py-4 flex-1 space-y-4',
    botaoDoCartao: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-[11px] font-medium text-gray-600 hover:text-gray-900 transition',
    iconeDoBotao: 'w-3.5 h-3.5',
    rodape: 'flex flex-col sm:flex-row sm:justify-end gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0',
    botaoSecundario: 'px-5 py-2 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium transition',
    botaoPrimario: 'px-5 py-2 text-sm text-white bg-gray-800 hover:bg-gray-900 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
    indicador: 'bg-white border border-gray-200 rounded-xl px-4 py-3',
    indicadorRotulo: 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1',
    indicadorValor: 'text-lg font-semibold text-gray-800',
    grade: 'grid grid-cols-1 sm:grid-cols-2 gap-2',
    texto: 'text-sm text-gray-700',
    apagado: 'text-xs text-gray-500',
    nota: 'flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg',
    notaTexto: 'text-xs text-gray-700',
    erro: 'bg-red-100 text-red-800 rounded-lg px-3 py-2 text-sm',
    sucesso: 'bg-green-100 text-green-800 rounded-lg px-3 py-2 text-sm',
    andamento: 'bg-blue-100 text-blue-800 rounded-lg px-3 py-2 text-sm',
  });

  /* ---------------------------------------------------------------------
   * LEITURA E COMPARAÇÃO (funções puras sobre texto; nada de rede)
   * --------------------------------------------------------------------- */
  const SEM_VALOR = /n[ãa]o cadastrado|n[ãa]o informado/i;

  /** CNPJ da URL da página do cliente (14 caracteres; a raiz pode ser alfanumérica). '' fora da tela do cliente. */
  function cnpjDaPagina() {
    let bruto = '';
    try { bruto = new URLSearchParams(window.location.search).get('cnpj') || ''; } catch (_) { return ''; }
    const limpo = String(bruto).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return /^[0-9A-Z]{12}[0-9]{2}$/.test(limpo) ? limpo : '';
  }

  const digitos = (valor) => String(valor ?? '').replace(/\D/g, '');

  /**
   * O celular do responsável é completo para o Systêxtil? DDD + 9 dígitos, o 1º é 9 (11 dígitos, com ou sem 55 na frente).
   * Devolve só os 9 dígitos do número (sem DDD, que o Systêxtil guarda à parte) ou '' se não for completo.
   */
  function numeroLocalCompleto(valor) {
    let d = digitos(valor);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    return d.length === 11 && d[2] === '9' ? d.slice(2) : '';
  }

  /** Texto do telefone dentro de um elemento do CRM (ignora o selo WHATS, que fica em outro span). */
  function textoDoTelefone(elemento) {
    if (!elemento) return '';
    const texto = (elemento.querySelector('span') || elemento).textContent.replace(/\s+/g, ' ').trim();
    if (!texto || SEM_VALOR.test(texto)) return '';
    const achado = texto.match(/\+?[\d(][\d\s().-]{7,}\d/);
    return achado ? achado[0].trim() : '';
  }

  /** "Celular" do CADASTRO, na grade nativa de contato. null = não achei o campo (sem leitura); '' = campo vazio. */
  function lerCelularCadastro() {
    const rotulos = Array.from(document.querySelectorAll('p'));
    const rotulo = rotulos.find((p) => p.textContent.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR') === 'celular');
    if (!rotulo || !rotulo.parentElement) return null;
    const campo = rotulo.parentElement;
    const valor = campo.querySelector('.smt-retorno-valor')
      || Array.from(campo.querySelectorAll('p')).find((p) => p !== rotulo)
      || null;
    return valor ? textoDoTelefone(valor) : null;
  }

  /** "Celular Responsável": a variável do CRM (confirmada) ou, sem ela, o texto da tela. null = sem leitura. */
  function lerCelularResponsavel() {
    const variavel = window.__RESPONSAVEL__;
    if (variavel && typeof variavel === 'object') {
      return typeof variavel.celular === 'string' ? variavel.celular.trim() : '';
    }
    const el = document.getElementById('resp-celular-valor');
    return el ? textoDoTelefone(el) : null;
  }

  /** Máscara para a tela: DDD visível, só os 4 últimos dígitos. Nunca devolve o número inteiro. */
  function mascarar(valor) {
    const d = digitos(valor);
    if (!d) return 'não cadastrado';
    const ate11 = (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d;
    if (ate11.length === 11) return '(' + ate11.slice(0, 2) + ') *****-' + ate11.slice(-4);
    if (ate11.length === 10) return '(' + ate11.slice(0, 2) + ') ****-' + ate11.slice(-4);
    return '(formato não reconhecido)';
  }

  /**
   * Decide se o botão aparece. Estados: 'sem-leitura' (não consegui ler algum dos dois ou falta o Módulo 28),
   * 'sem-responsavel' (vazio ou não é celular completo), 'igual' (mesmo número) e 'diverge'.
   * Só 'diverge' mostra o botão. Cadastro vazio com responsável completo conta como divergência.
   */
  function avaliar() {
    const chave = window.__contatosGoogle?.chaveDoCelular;
    if (typeof chave !== 'function') return { estado: 'sem-leitura' };
    const cadastro = lerCelularCadastro();
    const responsavel = lerCelularResponsavel();
    if (cadastro === null || responsavel === null) return { estado: 'sem-leitura' };
    const numero = numeroLocalCompleto(responsavel);
    if (!numero) return { estado: 'sem-responsavel' };
    const chaveResp = chave(responsavel);
    const chaveCad = chave(cadastro);
    if (chaveResp !== null && chaveResp === chaveCad) return { estado: 'igual' };
    return {
      estado: 'diverge',
      numeroLocal: numero,
      mascaraCadastro: mascarar(cadastro),
      mascaraResponsavel: mascarar(responsavel),
    };
  }

  function criarId() {
    try { if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID(); } catch (_) { /* id alternativo */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  /** Pedido para a ponte. Lança se a tela ou os números não servem (nunca envia pela metade). */
  function montarPedido(avaliacao) {
    const cnpj = cnpjDaPagina();
    if (!cnpj) throw new Error('Não identifiquei o CNPJ completo do cliente nesta página.');
    if (!avaliacao || avaliacao.estado !== 'diverge' || !/^9\d{8}$/.test(avaliacao.numeroLocal || '')) {
      throw new Error('Os números não divergem ou o celular do responsável não está completo.');
    }
    const agora = Date.now();
    return { schema: CONFIG.SCHEMA, id: criarId(), cnpj, celular: avaliacao.numeroLocal, criadoEm: agora, expiraEm: agora + CONFIG.TTL_PEDIDO_MS };
  }

  /* ---------------------------------------------------------------------
   * DOM
   * --------------------------------------------------------------------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CAMINHO_CELULAR = 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z';
  const CAMINHO_X = 'M6 18L18 6M6 6l12 12';

  function no(tag, classe, texto, filhos, estilo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (estilo) Object.assign(e.style, estilo);
    if (texto !== undefined && texto !== null) e.textContent = texto;
    (filhos || []).forEach((f) => { if (f) e.appendChild(f); });
    return e;
  }

  function icone(classe, caminho) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', caminho);
    svg.appendChild(path);
    return svg;
  }

  let botaoEl = null;
  let painelEl = null;
  let corpoEl = null;
  let enviarEl = null;
  let assinaturaRenderizada = '';
  const assinatura = (a) => [a.estado, a.mascaraCadastro, a.mascaraResponsavel].join('|');
  let focoAnterior = null;
  let envio = null; // { id, pedido, estado, timer } do pedido em andamento neste modal

  /* ---------------------------------------------------------------------
   * MODAL
   * --------------------------------------------------------------------- */
  // Texto por estado da ponte. A resposta da ponte NUNCA vira texto direto: só o código escolhe uma destas frases.
  const FRASES = Object.freeze({
    // Só deste lado: o pedido saiu, mas a ponte ainda não confirmou nada (não afirmo "entregue" antes disso).
    enviado: ['andamento', 'Pedido enviado. Aguardando a ponte confirmar o recebimento…'],
    recebido: ['andamento', 'Pedido entregue à ponte. Abra a tela Cadastro de Clientes (pedi_f010) do Systêxtil, se ainda não estiver aberta.'],
    'aguardando-systextil': ['andamento', 'Aguardando a tela Cadastro de Clientes (pedi_f010) do Systêxtil. Abra-a numa aba deste navegador.'],
    'cnpj-preenchido': ['andamento', 'CNPJ preenchido no Systêxtil. Pesquisando (F7)…'],
    'f7-manual': ['andamento', 'O CNPJ foi preenchido, mas o F7 não carregou o cliente sozinho. Aperte F7 na tela do Systêxtil.'],
    'cliente-conferido': ['andamento', 'Cliente carregado e conferido pelo CNPJ. Preenchendo o celular…'],
    preenchido: ['sucesso', 'Celular preenchido no Systêxtil. Confira na tela e aperte F9 para salvar. Nada foi gravado ainda.'],
    'tela-nao-encontrada': ['erro', 'A tela Cadastro de Clientes (pedi_f010) não foi encontrada no Systêxtil. Nada foi preenchido.'],
    'cnpj-diferente': ['erro', 'O cliente carregado no Systêxtil não tem o CNPJ deste cliente. Nada foi preenchido no celular.'],
    'cliente-nao-carregou': ['erro', 'O cliente não carregou no Systêxtil. Nada foi preenchido no celular.'],
    'campo-ausente': ['erro', 'O campo Celular não foi encontrado na tela do Systêxtil. Nada foi preenchido.'],
    expirado: ['erro', 'O pedido expirou (5 minutos). Nada foi preenchido. Envie de novo.'],
    'sem-ponte': ['erro', 'Nenhuma resposta da ponte. Confira se o userscript "SmartTable → Systêxtil (celular)" está instalado e ativo nesta aba do CRM.'],
    // Falha deste lado (os números mudaram entre abrir o modal e clicar): nada saiu daqui.
    'pedido-invalido': ['erro', 'Os números mudaram ou não foi possível montar o pedido. Nada foi enviado.'],
    'tela-ocupada': ['erro', 'A tela do Systêxtil já tem outro cliente carregado. Volte a uma consulta em branco e envie de novo. Nada foi alterado.'],
    'valor-nao-ficou': ['erro', 'O Systêxtil não aceitou o valor no campo Celular. Nada foi preenchido.'],
    'ja-igual': ['sucesso', 'O Systêxtil já tem este número no campo Celular. Não há o que salvar.'],
  });
  const FINAIS = new Set(['preenchido', 'ja-igual', 'tela-nao-encontrada', 'tela-ocupada', 'cnpj-diferente', 'cliente-nao-carregou', 'campo-ausente', 'valor-nao-ficou', 'expirado', 'sem-ponte', 'pedido-invalido']);
  const SUCESSOS = new Set(['preenchido', 'ja-igual']);
  // Estados que só este módulo cria: a ponte não pode mandá-los.
  const SO_LOCAIS = new Set(['enviado', 'sem-ponte']);

  function render(avaliacaoPronta) {
    if (!corpoEl) return;
    corpoEl.replaceChildren();
    const avaliacao = avaliacaoPronta || avaliar();
    assinaturaRenderizada = assinatura(avaliacao);
    if (envio) {
      const [tipo, texto] = FRASES[envio.estado] || FRASES.recebido;
      corpoEl.appendChild(no('div', CLASSES[tipo === 'sucesso' ? 'sucesso' : tipo === 'erro' ? 'erro' : 'andamento'], texto));
    }
    if (avaliacao.estado === 'diverge') {
      corpoEl.appendChild(no('p', CLASSES.texto, 'O Celular do cadastro do cliente está diferente do Celular Responsável. Enviar o do responsável ao Systêxtil?'));
      corpoEl.appendChild(no('div', CLASSES.grade, null, [
        no('div', CLASSES.indicador, null, [no('span', CLASSES.indicadorRotulo, 'Celular (cadastro)'), no('span', CLASSES.indicadorValor, avaliacao.mascaraCadastro)]),
        no('div', CLASSES.indicador, null, [no('span', CLASSES.indicadorRotulo, 'Celular Responsável'), no('span', CLASSES.indicadorValor, avaliacao.mascaraResponsavel)]),
      ]));
    } else if (!envio) {
      corpoEl.appendChild(no('p', CLASSES.texto, 'Os números não divergem mais. Não há o que enviar.'));
    }
    corpoEl.appendChild(no('div', CLASSES.nota, null, [no('span', CLASSES.notaTexto, 'O SmartTable só preenche o campo Celular na tela Cadastro de Clientes do Systêxtil (só o número, sem o DDD). Quem salva é você, com F9.')]));
    const emAndamento = envio && !FINAIS.has(envio.estado);
    if (enviarEl) enviarEl.disabled = !(avaliacao.estado === 'diverge') || Boolean(emAndamento);
  }

  function abrirPainel() {
    if (painelEl) return;
    const avaliacaoDeAbertura = avaliar();
    if (avaliacaoDeAbertura.estado !== 'diverge') return; // o botão nem existe sem divergência; o atalho de API também não abre
    window.__smartTableUtil?.fecharOutrosPaineis?.('celularSystextil');
    focoAnterior = document.activeElement;
    const tituloEl = no('h3', CLASSES.titulo, 'Celular no Systêxtil');
    tituloEl.id = CONFIG.ID_PAINEL + '-titulo';
    const esquerda = no('div', CLASSES.topoEsquerda, null, [
      no('div', CLASSES.iconeCaixa, null, [icone(CLASSES.icone, CAMINHO_CELULAR)]),
      no('div', null, null, [tituloEl, no('p', CLASSES.subtitulo, 'Cadastro de Clientes (pedi_f010)')]),
    ]);
    const fechar = no('button', CLASSES.fechar, null, [icone(CLASSES.iconeFechar, CAMINHO_X)]);
    fechar.type = 'button';
    fechar.dataset.acao = 'fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.addEventListener('click', fecharPainel);
    corpoEl = no('div', CLASSES.corpo);
    corpoEl.setAttribute('aria-live', 'polite');
    enviarEl = no('button', CLASSES.botaoPrimario, 'Enviar ao Systêxtil');
    enviarEl.type = 'button';
    enviarEl.dataset.acao = 'enviar';
    enviarEl.addEventListener('click', enviar);
    const cancelar = no('button', CLASSES.botaoSecundario, 'Fechar');
    cancelar.type = 'button';
    cancelar.dataset.acao = 'fechar-rodape';
    cancelar.addEventListener('click', fecharPainel);
    const rodape = no('div', CLASSES.rodape, null, [cancelar, enviarEl]);
    painelEl = no('div', CLASSES.fundo, null, [no('div', CLASSES.cartao, null, [no('div', CLASSES.topo, null, [esquerda, fechar]), corpoEl, rodape])], { zIndex: CONFIG.Z_INDEX_POPUP });
    painelEl.id = CONFIG.ID_PAINEL;
    painelEl.setAttribute('role', 'dialog');
    painelEl.setAttribute('aria-modal', 'true');
    painelEl.setAttribute('aria-labelledby', tituloEl.id);
    painelEl.addEventListener('click', (evento) => { if (evento.target === painelEl) fecharPainel(); });
    document.body.appendChild(painelEl);
    botaoEl?.setAttribute('aria-expanded', 'true');
    painelEl.tabIndex = -1;
    painelEl.focus();
    render(avaliacaoDeAbertura);
  }

  function fecharPainel() {
    if (!painelEl) return;
    if (envio?.timer) clearTimeout(envio.timer);
    envio = null;
    painelEl.remove();
    painelEl = null;
    corpoEl = null;
    enviarEl = null;
    botaoEl?.setAttribute('aria-expanded', 'false');
    if (focoAnterior && typeof focoAnterior.focus === 'function' && focoAnterior.isConnected) focoAnterior.focus();
    focoAnterior = null;
  }

  function prenderTab(evento) {
    const botoes = Array.from(painelEl.querySelectorAll('button:not([disabled])'));
    if (!botoes.length) { evento.preventDefault(); return; }
    const primeiro = botoes[0];
    const ultimo = botoes[botoes.length - 1];
    const atual = document.activeElement;
    if (atual === painelEl || !painelEl.contains(atual)) { evento.preventDefault(); (atual === painelEl && evento.shiftKey ? ultimo : primeiro).focus(); return; }
    if (evento.shiftKey && atual === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && atual === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }

  function aoTeclar(evento) {
    if (!painelEl) return;
    if (evento.code === 'Escape') { fecharPainel(); return; }
    if (evento.code === 'Tab' && !evento.altKey && !evento.ctrlKey && !evento.metaKey) prenderTab(evento);
  }

  /* ---------------------------------------------------------------------
   * ENVIO E RESPOSTA DA PONTE
   * --------------------------------------------------------------------- */
  function enviar() {
    if (envio && !FINAIS.has(envio.estado)) return; // um pedido por vez
    let pedido;
    try {
      pedido = montarPedido(avaliar()); // reavalia no clique: o que vale é o que está na tela agora
    } catch (erro) {
      envio = { id: null, estado: 'pedido-invalido', timer: null };
      render();
      return;
    }
    const atual = { id: pedido.id, estado: 'enviado', timer: null };
    envio = atual;
    // Sem resposta nenhuma da ponte em ESPERA_PONTE_MS: userscript não instalado ou desligado nesta aba.
    atual.timer = setTimeout(() => {
      if (envio === atual && atual.estado === 'enviado') { atual.estado = 'sem-ponte'; render(); }
    }, CONFIG.ESPERA_PONTE_MS);
    render();
    try {
      document.dispatchEvent(new window.CustomEvent(CONFIG.EVENTO_ENVIAR, { detail: JSON.stringify(pedido) }));
    } catch (_) {
      clearTimeout(atual.timer);
      atual.estado = 'sem-ponte';
      render();
    }
  }

  function receberResultado(evento) {
    let dados = null;
    try {
      dados = typeof evento.detail === 'string' ? JSON.parse(evento.detail) : evento.detail;
    } catch (_) { return; }
    if (!envio || !dados || dados.schema !== CONFIG.SCHEMA || dados.id !== envio.id) return; // resposta de outro pedido: ignora
    if (typeof dados.status !== 'string' || !Object.prototype.hasOwnProperty.call(FRASES, dados.status) || SO_LOCAIS.has(dados.status)) return;
    // Os sucessos só valem com ok === true: o "ok" é da ponte, e sem ele não afirmo nada.
    if (SUCESSOS.has(dados.status) && dados.ok !== true) return;
    if (FINAIS.has(envio.estado)) return; // final é final: resposta atrasada não reabre
    if (envio.timer) clearTimeout(envio.timer);
    envio.estado = dados.status;
    render();
  }

  /* ---------------------------------------------------------------------
   * BOTÃO (só com divergência)
   * --------------------------------------------------------------------- */
  function criarBotao() {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = CONFIG.ID_BOTAO;
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false');
    el.title = 'O Celular do cadastro difere do Celular Responsável: atualizar no Systêxtil';
    const plano = document.getElementById(CONFIG.ID_BOTAO_PLANO);
    const alerta = document.getElementById(CONFIG.ID_BOTAO_ALERTA);
    const ancora = plano || alerta || document.querySelector(CONFIG.SELETOR_ANCORA);
    const flutuante = (plano || alerta)?.style.position === 'fixed';
    if (ancora && !flutuante) {
      el.className = CLASSES.botaoDoCartao;
      el.appendChild(icone(CLASSES.iconeDoBotao, CAMINHO_CELULAR));
      el.appendChild(document.createTextNode('Celular no Systêxtil'));
      ancora.insertAdjacentElement('afterend', el);
    } else if (ancora) {
      el.textContent = 'Celular no Systêxtil';
      Object.assign(el.style, {
        position: 'fixed', top: CONFIG.TOPO_BOTAO_FLUTUANTE, left: '16px', background: '#16232F', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 14px', fontSize: '12.5px',
        fontWeight: '600', cursor: 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', zIndex: (plano || alerta)?.style.zIndex || '',
      });
      document.body.appendChild(el);
      window.__smartTableUtil?.acompanharMenuLateral?.(el);
    } else {
      return null; // sem cartão nem botões vizinhos: não sei onde pôr, então não ponho
    }
    el.addEventListener('click', () => (painelEl ? fecharPainel() : abrirPainel()));
    return el;
  }

  /** Mostra o botão só com divergência; some quando os números passam a bater (ex.: o operador corrigiu o responsável). */
  function atualizarBotao() {
    if (!cnpjDaPagina()) return;
    const avaliacao = avaliar(); // uma avaliação por ciclo (antes: até três)
    const diverge = avaliacao.estado === 'diverge';
    const existente = document.getElementById(CONFIG.ID_BOTAO);
    if (diverge && !existente) botaoEl = criarBotao();
    else if (!diverge && existente) {
      if (painelEl && !(envio && !FINAIS.has(envio.estado))) fecharPainel();
      existente.remove();
      botaoEl = null;
    } else if (painelEl && assinaturaRenderizada !== assinatura(avaliacao)) render(avaliacao); // só repinta se o que o modal mostra mudou
  }

  let timerReavaliar = null;
  function agendarReavaliacao() {
    // O render do modal também muda o DOM e acorda este observador; quem impede o laço é a assinatura em atualizarBotao.
    if (timerReavaliar) clearTimeout(timerReavaliar);
    timerReavaliar = setTimeout(() => { timerReavaliar = null; atualizarBotao(); }, CONFIG.ATRASO_REAVALIAR_MS);
  }

  function aoCarregar() {
    if (!cnpjDaPagina()) return; // só faz sentido na página do cliente
    atualizarBotao();
    // O CRM repinta o responsável ao salvar e o Módulo 34 reescreve a grade: reavalia em vez de confiar só na carga. Só a GRADE de contato importa
    // (é onde mudam o Celular e o Celular Responsável): vigiar o body inteiro reavaliava a cada mudança de qualquer lugar da página (revisão de
    // 26/11/2026). Sem a grade na carga, cai no body (nunca pior que antes).
    const observador = new window.MutationObserver(agendarReavaliacao);
    observador.observe(gradeDeContato() || document.body, { childList: true, subtree: true, characterData: true });
  }

  /** O contêiner da grade nativa de contato (o ancestral de #resp-celular-valor que agrupa os campos), ou null. */
  function gradeDeContato() {
    const resp = document.getElementById('resp-celular-valor');
    return (resp && (resp.closest('.grid') || (resp.parentElement && resp.parentElement.parentElement))) || null;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aoCarregar);
  else aoCarregar();
  document.addEventListener('keydown', aoTeclar);
  document.addEventListener(CONFIG.EVENTO_RESULTADO, receberResultado);
  window.__smartTableUtil?.registrarPainel?.('celularSystextil', fecharPainel);

  window.__celularSystextil = {
    CONFIG,
    CLASSES,
    FRASES,
    avaliar,
    montarPedido,
    mascarar,
    numeroLocalCompleto,
    lerCelularCadastro,
    lerCelularResponsavel,
    cnpjDaPagina,
    abrirPainel,
    fecharPainel,
    atualizarBotao,
    estaAberto: () => painelEl !== null,
  };
})();
