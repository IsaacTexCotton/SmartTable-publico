/* =========================================================================
 * MÓDULO 12: ALERTA DO CLIENTE (botão, não atalho) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Um botão na página do cliente ("Alerta") que abre um formulário com:
 *   - checkbox "Não cobrar" -- ao marcar, aparece um campo de intervalo em
 *     DIAS (padrão 1). Enquanto o intervalo não expira, este cliente é
 *     EXCLUÍDO da fila por prioridade (Módulo 7, Alt+U) -- só dela, o Alt+I
 *     original (Módulo 3) não foi mencionado no pedido e continua igual.
 *   - campo de observação (texto livre).
 *   - botão Confirmar.
 *
 * PEDIDO EXPLÍCITO DO USUÁRIO: um BOTÃO, igual ao Módulo 11 -- mas ESTE não
 * é escondido (o Módulo 11 é; aqui nada foi pedido nesse sentido).
 *
 * ONDE O BOTÃO FICA (v1.21.2, pedido do usuário com o HTML real do card do
 * cliente): DENTRO do card de informações do cliente, logo depois do botão
 * "Responsável financeiro" (`button[onclick="abrirModalResponsavel()"]`) --
 * mesmo container flex, herda as classes Tailwind já compiladas na página
 * (rounded-lg/border/text-[11px]/font-medium/etc., confirmadas ao vivo no
 * mesmo trecho de HTML) pra não depender de cor Tailwind que pode não estar
 * no CSS compilado da página; a cor em si é sempre inline. SE essa âncora
 * não existir na página (layout diferente, ainda não carregou), cai pro
 * botão flutuante fixo de antes (abaixo do cabeçalho -- ver próximo
 * parágrafo) em vez de simplesmente não aparecer.
 *
 * ACHADO AO VIVO na v1.21.0 (histórico -- só importa pro fallback acima): o
 * cabeçalho do CRM (`#sit-header`) cobre a largura inteira da tela do topo
 * até y=80px, com z-index 50 -- MESMO nível dos modais do CRM. `top:16px`
 * (canto superior esquerdo "de verdade") ficava embaixo dele por completo.
 * Ver CONFIG_ALERTA.TOPO_BOTAO/TOPO_PAINEL.
 *
 * O AVISO AUTOMÁTICO AO ABRIR A PÁGINA (v1.21.2, corrigido -- ANTES só
 * avisava com observação SEM "não cobrar" marcado, de propósito; relatado
 * pelo usuário como errado): agora avisa sempre que existir alerta ativo
 * pra este cliente, "não cobrar" ou observação ou os dois -- é exatamente
 * ao entrar num cliente marcado "não cobrar" que o aviso mais importa, pra
 * não ligar por hábito mesmo saindo da fila automática.
 *
 * ARMAZENAMENTO: um objeto por CNPJ em localStorage, sobrescrito inteiro a
 * cada "Confirmar" (não é um log -- é o estado ATUAL do alerta desse
 * cliente). Confirmar com o checkbox desmarcado e observação vazia REMOVE o
 * registro -- é assim que se limpa um alerta.
 *
 * "Não cobrar" usa timestamp corrido (Date.now() + dias*24h), não a
 * convenção de meio-dia do resto do projeto (normalizarData) -- de
 * propósito: normalizarData serve pra comparar DATAS DE CALENDÁRIO
 * (vencimento, promessa), e aqui o pedido é uma DURAÇÃO rolante ("por 1
 * dia a partir de agora"), não um dia específico do calendário.
 *
 * TÍTULOS EM CARTÓRIO FORA DO RELATÓRIO (v1.47.0, pedido do usuário, com as
 * decisões dele): no painel, uma caixinha por título em cartório. Marcado,
 * o título sai da cobrança INTEIRA -- relatório, mensagem do Alt+A, nota do
 * Alt+S e Alt+U (o Módulo 1 consulta tituloForaDoRelatorio no mesmo ponto em
 * que consulta os títulos em acordo). Fica marcado ATÉ CONSTAR COMO PAGO:
 * ao abrir a página do cliente, título que aparece em __TITULOS_PAGOS__ do
 * CRM é desmarcado sozinho. Se ele só sumir dos abertos (acordo, baixa) e
 * voltar depois, a marcação continua valendo. Guardado por CNPJ (só
 * dígitos) em smarttable_cartorio_fora_relatorio_v1, neste navegador.
 *
 * ONDE COLAR: depois do Módulo 0 (config/registro de painéis) e ANTES do
 * Módulo 7 (que consulta estaSuprimidoDaPrioridade ao montar a fila -- se
 * este módulo não tiver carregado, o Módulo 7 degrada silenciosamente pra
 * "ninguém suprimido", nunca lança exceção).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__alertaClienteCarregado) return;
  window.__alertaClienteCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Alerta do Cliente');

  const MS_POR_DIA = 24 * 60 * 60 * 1000;

  const CONFIG_ALERTA = {
    CHAVE_STORAGE: 'smarttable_alerta_cliente_v1',
    CHAVE_FORA_RELATORIO: 'smarttable_cartorio_fora_relatorio_v1',
    ID_BOTAO: 'smarttable-botao-alerta-cliente',
    ID_PAINEL: 'smarttable-painel-alerta-cliente',
    ID_AVISO: 'smarttable-aviso-observacao-cliente',
    // Mesmo z-index dos outros painéis nossos (Módulo 9/10/11): ABAIXO dos
    // modais do CRM (z-50).
    Z_INDEX: 30,
    INTERVALO_PADRAO_DIAS: 1,
    // CONFIRMADO AO VIVO (relatado pelo usuário): o cabeçalho do CRM
    // (`#sit-header`) cobre toda a largura da tela, do topo até y=80px, com
    // z-index 50 -- MESMO nível dos modais do CRM. O canto superior
    // esquerdo (top:16px, onde o botão nasceu) fica embaixo dele por
    // completo; `document.elementFromPoint` naquele ponto devolvia o botão
    // de recolher menu do próprio CRM (#sidebar-toggle-btn), nunca o nosso.
    // Subir nosso z-index acima de 50 pra vencer resolveria isso, mas
    // quebraria a regra que todo painel daqui segue: nunca competir com
    // modal de verdade. A solução é geométrica, não de z-index: ficar
    // inteiramente ABAIXO da faixa do cabeçalho (80px + folga).
    TOPO_BOTAO: '96px',
    TOPO_PAINEL: '150px',
    // Confirmado ao vivo com o usuário (HTML real do card do cliente): o
    // onclick é o identificador mais estável desse botão -- não depende de
    // classe Tailwind (que pode mudar em redesign visual) nem de texto
    // (que pode ser traduzido/reformulado).
    SELETOR_ANCORA: 'button[onclick="abrirModalResponsavel()"]',
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    fundo: '#ffffff',
    alerta: '#B45309',
    perigo: '#B42318',
  };

  let painelEl = null;
  let avisoEl = null;
  let botaoEl = null;
  let botaoInjetadoNoDom = false;

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(location.search).get('cnpj') || '';
    } catch {
      return '';
    }
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO
   * --------------------------------------------------------------------- */

  function lerTodos() {
    try {
      const raw = localStorage.getItem(CONFIG_ALERTA.CHAVE_STORAGE);
      const dados = raw ? JSON.parse(raw) : {};
      return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    } catch {
      return {};
    }
  }

  /** @returns {boolean} false quando o localStorage recusou a gravação. */
  function salvarTodos(dados) {
    try {
      localStorage.setItem(CONFIG_ALERTA.CHAVE_STORAGE, JSON.stringify(dados));
      return true;
    } catch (erro) {
      console.warn('[Alerta Cliente] Não consegui salvar no localStorage.', erro?.name);
      return false;
    }
  }

  /** @returns {{observacao: string, naoCobrarAte: number|null, atualizadoEm: number}|null} */
  function obterAlerta(cnpj) {
    if (!cnpj) return null;
    return lerTodos()[cnpj] || null;
  }

  /**
   * Grava (ou remove, se ficar sem efeito) o alerta de um cliente.
   *
   * @param {string} cnpj
   * @param {{naoCobrar: boolean, intervaloDias?: number, observacao?: string, naoCobrarAte?: number}} opcoes
   *   naoCobrarAte: mantém um prazo que já existia (o painel passa quando o
   *   operador não mexeu nos dias), em vez de recontar a partir de agora.
   * @param {number} [agora] Injetável pra teste.
   * @returns {boolean} false quando não gravou (sem CNPJ ou localStorage recusou).
   */
  function salvarAlerta(cnpj, opcoes, agora) {
    if (!cnpj) return false;
    const observacaoLimpa = (opcoes.observacao || '').trim();
    const naoCobrar = !!opcoes.naoCobrar;

    const todos = lerTodos();

    if (!naoCobrar && !observacaoLimpa) {
      // Sem checkbox e sem observação não é um alerta -- é a forma de
      // LIMPAR um alerta anterior.
      delete todos[cnpj];
      return salvarTodos(todos);
    }

    const dias = Number.isFinite(opcoes.intervaloDias) && opcoes.intervaloDias > 0
      ? opcoes.intervaloDias
      : CONFIG_ALERTA.INTERVALO_PADRAO_DIAS;

    const instante = agora ?? Date.now();
    const prazoMantido = Number.isFinite(opcoes.naoCobrarAte) && opcoes.naoCobrarAte > instante ? opcoes.naoCobrarAte : null;
    todos[cnpj] = {
      observacao: observacaoLimpa,
      naoCobrarAte: naoCobrar ? (prazoMantido ?? instante + dias * MS_POR_DIA) : null,
      atualizadoEm: instante,
    };
    return salvarTodos(todos);
  }

  /**
   * A pergunta que o Módulo 7 faz ao montar a fila por prioridade: este
   * cliente está com "não cobrar" ativo agora? Nunca lança -- ausência de
   * dado (deste módulo não carregado, cliente sem alerta, JSON corrompido)
   * sempre significa "não suprimido", nunca "suprimido por engano".
   *
   * @param {string} cnpj
   * @param {number} [agora] Injetável pra teste.
   * @returns {boolean}
   */
  function estaSuprimidoDaPrioridade(cnpj, agora) {
    const alerta = obterAlerta(cnpj);
    if (!alerta || alerta.naoCobrarAte == null) return false;
    return (agora ?? Date.now()) < alerta.naoCobrarAte;
  }

  /* ---------------------------------------------------------------------
   * TÍTULOS EM CARTÓRIO FORA DO RELATÓRIO (v1.47.0)
   * --------------------------------------------------------------------- */

  const soDigitos = (cnpj) => String(cnpj ?? '').replace(/\D/g, '');

  /** @returns {Object<string, Object<string, {marcadoEm: number}>>} por CNPJ (dígitos) -> título */
  function lerForaDoRelatorio() {
    try {
      const raw = localStorage.getItem(CONFIG_ALERTA.CHAVE_FORA_RELATORIO);
      const dados = raw ? JSON.parse(raw) : {};
      return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    } catch {
      return {};
    }
  }

  function salvarForaDoRelatorio(dados) {
    try {
      localStorage.setItem(CONFIG_ALERTA.CHAVE_FORA_RELATORIO, JSON.stringify(dados));
      return true;
    } catch (erro) {
      console.warn('[Alerta Cliente] Não consegui salvar os títulos fora do relatório.', erro?.message);
      return false;
    }
  }

  /** Títulos ("123456/1") deste cliente marcados fora do relatório. */
  function titulosForaDoRelatorio(cnpj) {
    const doCliente = lerForaDoRelatorio()[soDigitos(cnpj)];
    return doCliente && typeof doCliente === 'object' ? Object.keys(doCliente) : [];
  }

  /**
   * Marca (ou desmarca) um título deste cliente como fora do relatório.
   * @returns {boolean} false se não conseguiu gravar
   */
  function marcarForaDoRelatorio(cnpj, tituloCompleto, fora, agora) {
    const chave = soDigitos(cnpj);
    const titulo = String(tituloCompleto ?? '').trim();
    if (!chave || !titulo) return false;
    const todos = lerForaDoRelatorio();
    const doCliente = { ...(todos[chave] || {}) };
    if (fora) doCliente[titulo] = doCliente[titulo] ?? { marcadoEm: agora ?? Date.now() };
    else delete doCliente[titulo];
    if (Object.keys(doCliente).length > 0) todos[chave] = doCliente;
    else delete todos[chave];
    return salvarForaDoRelatorio(todos);
  }

  /** A pergunta do Módulo 1 pra UM cliente: "este título está fora do relatório?" */
  function predicadoForaDoRelatorio(cnpj) {
    const marcados = new Set(titulosForaDoRelatorio(cnpj));
    return (tituloCompleto) => marcados.has(String(tituloCompleto ?? '').trim());
  }

  /** A mesma pergunta pra página aberta (o Módulo 1 da tela usa esta). */
  function tituloForaDoRelatorio(tituloCompleto) {
    return predicadoForaDoRelatorio(cnpjDaPagina())(tituloCompleto);
  }

  /**
   * Desmarca os títulos que já constam como PAGOS (decisão do usuário: "até
   * constar como pago").
   * @param {string} cnpj
   * @param {string[]} titulosPagos no formato "123456/1"
   * @returns {number} quantos foram desmarcados
   */
  function desmarcarPagos(cnpj, titulosPagos) {
    const pagos = new Set((titulosPagos || []).map((t) => String(t).trim()));
    const aDesmarcar = titulosForaDoRelatorio(cnpj).filter((t) => pagos.has(t));
    aDesmarcar.forEach((t) => marcarForaDoRelatorio(cnpj, t, false));
    if (aDesmarcar.length > 0) {
      console.log(`[Alerta Cliente] ${aDesmarcar.length} título(s) fora do relatório constam como pagos -- marcação removida (${window.__smartTableUtil?.apelidoParaLog?.(cnpj) ?? 'cli.????'}).`);
    }
    return aDesmarcar.length;
  }

  /**
   * Lê __TITULOS_PAGOS__ da página aberta (mesmos campos de
   * __TITULOS_ABERTOS__: numeroTitulo, sequencia -- diagnóstico de 25/09) e
   * desmarca os pagos. Sem a lista (página sem ela, formato inesperado):
   * não desmarca NADA -- nunca devolve à cobrança por engano.
   */
  function desmarcarPagosDaPagina(cnpj) {
    let pagos;
    try {
      pagos = window.__smartTableUtil?.lerVariavelDoScript?.(document, '__TITULOS_PAGOS__');
    } catch (erro) {
      return 0;
    }
    if (!Array.isArray(pagos)) return 0;
    const titulos = pagos
      .filter((t) => t && t.numeroTitulo != null && t.sequencia != null)
      .map((t) => `${String(t.numeroTitulo).trim()}/${String(t.sequencia).trim()}`);
    return desmarcarPagos(cnpj, titulos);
  }

  /**
   * Os títulos que a seção do painel mostra: os em cartório agora (marcados
   * ou não) e os já marcados que ainda estão em aberto.
   * @returns {{tituloCompleto: string, vencimentoTexto: string, fora: boolean}[]}
   */
  function titulosDoPainelForaDoRelatorio() {
    let dados;
    try {
      dados = window.__avisoCobranca?.simular?.();
    } catch (erro) {
      return [];
    }
    if (!dados) return [];
    const vistos = new Set();
    const lista = [];
    const incluir = (r, fora) => {
      if (!r?.tituloCompleto || vistos.has(r.tituloCompleto)) return;
      vistos.add(r.tituloCompleto);
      lista.push({ tituloCompleto: r.tituloCompleto, vencimentoTexto: r.vencimentoTexto || '', fora });
    };
    (dados.foraDoRelatorio || []).forEach((r) => incluir(r, true));
    [...(dados.registros || []), ...(dados.naoCobrar || [])]
      .filter((r) => r.situacaoKey === 'EM_CARTORIO')
      .forEach((r) => incluir(r, false));
    return lista;
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

  /** O que o registro de painéis do Módulo 0 chama -- fecha o que estiver aberto dos dois. */
  function fecharTudo() {
    fecharAviso();
    fecharPainel();
  }

  function atualizarBadgeDoBotao(cnpj) {
    if (!botaoEl) return;
    const alerta = obterAlerta(cnpj);
    const ativo = !!alerta;
    if (botaoInjetadoNoDom) {
      // Aqui o botão herda classes Tailwind da página (layout) -- só a cor
      // é nossa, e sempre inline (nunca uma classe de cor Tailwind que
      // pode não estar no CSS compilado desta página).
      Object.assign(botaoEl.style, ativo
        ? { background: '#FEF3E2', borderColor: CORES.alerta, color: CORES.alerta }
        : { background: '#ffffff', borderColor: CORES.borda, color: CORES.texto });
    } else {
      botaoEl.style.background = ativo ? CORES.alerta : CORES.tinta;
    }
    botaoEl.title = ativo
      ? 'Alerta do cliente (ativo) -- clique pra ver ou editar'
      : 'Alerta do cliente';
  }

  /**
   * @param {string} cnpj
   * @param {{observacao: string, naoCobrarAte: number|null}} alerta
   * @param {boolean} naoCobrarAtivo
   */
  function mostrarAviso(cnpj, alerta, naoCobrarAtivo) {
    window.__smartTableUtil?.fecharOutrosPaineis?.('alertaCliente');
    fecharPainel();

    const cor = naoCobrarAtivo ? CORES.perigo : CORES.alerta;

    avisoEl = document.createElement('div');
    avisoEl.id = CONFIG_ALERTA.ID_AVISO;
    Object.assign(avisoEl.style, {
      position: 'fixed',
      // "Um pouco acima do centro da tela": 50% seria o centro exato.
      top: '42%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderLeft: `5px solid ${cor}`,
      borderRadius: '10px',
      padding: '16px 18px',
      boxShadow: '0 10px 34px rgba(0,0,0,0.28)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_ALERTA.Z_INDEX,
      width: '360px',
      maxWidth: '90vw',
    });

    avisoEl.appendChild(criarDiv(naoCobrarAtivo ? '🚫 NÃO COBRAR este cliente' : '⚠ Observação deste cliente', {
      color: cor, fontWeight: '700', fontSize: '13px', marginBottom: '8px',
    }));

    if (naoCobrarAtivo) {
      const ate = new Date(alerta.naoCobrarAte).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      avisoEl.appendChild(criarDiv(`Marcado pra não cobrar até ${ate}.`, {
        color: CORES.texto, lineHeight: '1.5', marginBottom: alerta.observacao ? '6px' : '12px', fontWeight: '600',
      }));
    }
    if (alerta.observacao) {
      avisoEl.appendChild(criarDiv(alerta.observacao, {
        color: CORES.texto, lineHeight: '1.5', marginBottom: '12px', whiteSpace: 'pre-wrap',
      }));
    }

    const botaoOk = document.createElement('button');
    botaoOk.type = 'button';
    botaoOk.textContent = 'Entendi';
    Object.assign(botaoOk.style, {
      background: CORES.tinta, color: '#fff', border: 'none', borderRadius: '6px',
      padding: '7px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: '600',
    });
    botaoOk.addEventListener('click', fecharAviso);
    avisoEl.appendChild(botaoOk);

    document.body.appendChild(avisoEl);
    void cnpj; // não usado no texto -- mantido no parâmetro por simetria com o resto do módulo
  }

  /**
   * Avisa SEMPRE que houver alerta ativo pra este cliente -- "não cobrar"
   * ativo ou observação, os dois, ou só um. Antes da v1.21.2 só avisava com
   * observação sem "não cobrar" (assimetria); relatado pelo usuário como
   * errado: entrar num cliente marcado "não cobrar" é exatamente o momento
   * em que o aviso mais importa, pra não ligar por hábito.
   */
  function mostrarAvisoSeNecessario(cnpj) {
    const alerta = obterAlerta(cnpj);
    if (!alerta) return;
    const naoCobrarAtivo = alerta.naoCobrarAte != null && Date.now() < alerta.naoCobrarAte;
    if (!naoCobrarAtivo && !alerta.observacao) return;
    mostrarAviso(cnpj, alerta, naoCobrarAtivo);
  }

  function abrirPainel(cnpj) {
    window.__smartTableUtil?.fecharOutrosPaineis?.('alertaCliente');
    fecharAviso();

    const existente = obterAlerta(cnpj);
    const naoCobrarAtivo = !!(existente && existente.naoCobrarAte != null && Date.now() < existente.naoCobrarAte);
    const diasRestantes = naoCobrarAtivo
      ? Math.max(1, Math.ceil((existente.naoCobrarAte - Date.now()) / MS_POR_DIA))
      : CONFIG_ALERTA.INTERVALO_PADRAO_DIAS;

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_ALERTA.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      top: CONFIG_ALERTA.TOPO_PAINEL,
      left: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_ALERTA.Z_INDEX,
      width: '300px',
      maxWidth: '92vw',
    });

    painelEl.appendChild(criarDiv('Alerta do cliente', {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px', marginBottom: '10px',
    }));

    // Checkbox "Não cobrar"
    const linhaCheckbox = criarDiv('', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });
    const checkboxNaoCobrar = document.createElement('input');
    checkboxNaoCobrar.type = 'checkbox';
    checkboxNaoCobrar.id = 'smarttable-alerta-checkbox-nao-cobrar';
    checkboxNaoCobrar.checked = naoCobrarAtivo;
    const rotuloCheckbox = document.createElement('label');
    rotuloCheckbox.htmlFor = checkboxNaoCobrar.id;
    rotuloCheckbox.textContent = 'Não cobrar';
    Object.assign(rotuloCheckbox.style, { color: CORES.texto, cursor: 'pointer' });
    linhaCheckbox.appendChild(checkboxNaoCobrar);
    linhaCheckbox.appendChild(rotuloCheckbox);
    painelEl.appendChild(linhaCheckbox);

    // Intervalo em dias -- só visível com o checkbox marcado.
    const linhaDias = criarDiv('', {
      display: naoCobrarAtivo ? 'flex' : 'none', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingLeft: '24px',
    });
    linhaDias.appendChild(criarDiv('Por quantos dias:', { color: CORES.apagado, fontSize: '12px' }));
    const inputDias = document.createElement('input');
    inputDias.type = 'number';
    inputDias.min = '1';
    inputDias.step = '1';
    inputDias.value = String(diasRestantes);
    Object.assign(inputDias.style, {
      width: '56px', padding: '4px 6px', border: `1px solid ${CORES.borda}`, borderRadius: '6px', fontSize: '12px',
    });
    linhaDias.appendChild(inputDias);
    painelEl.appendChild(linhaDias);

    checkboxNaoCobrar.addEventListener('change', () => {
      linhaDias.style.display = checkboxNaoCobrar.checked ? 'flex' : 'none';
    });

    // Observação
    painelEl.appendChild(criarDiv('Observação', { color: CORES.apagado, fontSize: '12px', marginBottom: '4px' }));
    const textareaObservacao = document.createElement('textarea');
    textareaObservacao.value = (existente && existente.observacao) || '';
    textareaObservacao.rows = 3;
    Object.assign(textareaObservacao.style, {
      width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: `1px solid ${CORES.borda}`,
      borderRadius: '6px', fontSize: '12.5px', fontFamily: 'inherit', resize: 'vertical', marginBottom: '10px',
    });
    painelEl.appendChild(textareaObservacao);

    // Títulos em cartório fora do relatório (v1.47.0) -- só aparece se o
    // cliente tiver algum título em cartório (ou já marcado).
    const caixasForaDoRelatorio = [];
    const titulosCartorio = titulosDoPainelForaDoRelatorio();
    if (titulosCartorio.length > 0) {
      const secao = criarDiv('', { marginBottom: '10px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}` });
      secao.setAttribute('data-papel', 'fora-do-relatorio');
      secao.appendChild(criarDiv('Títulos em cartório fora do relatório', {
        color: CORES.tinta, fontWeight: '600', fontSize: '12.5px', marginBottom: '2px',
      }));
      secao.appendChild(criarDiv('Marcado: sai do relatório e da cobrança até constar como pago.', {
        color: CORES.apagado, fontSize: '11px', marginBottom: '6px', lineHeight: '1.4',
      }));
      titulosCartorio.forEach((t, i) => {
        const linha = criarDiv('', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.id = `smarttable-alerta-fora-relatorio-${i}`;
        caixa.checked = t.fora;
        caixa.dataset.titulo = t.tituloCompleto;
        const rotulo = document.createElement('label');
        rotulo.htmlFor = caixa.id;
        rotulo.textContent = t.vencimentoTexto ? `${t.tituloCompleto} · venc. ${t.vencimentoTexto}` : t.tituloCompleto;
        Object.assign(rotulo.style, { color: CORES.texto, cursor: 'pointer', fontSize: '12.5px' });
        linha.appendChild(caixa);
        linha.appendChild(rotulo);
        secao.appendChild(linha);
        caixasForaDoRelatorio.push(caixa);
      });
      painelEl.appendChild(secao);
    }

    const botaoConfirmar = document.createElement('button');
    botaoConfirmar.type = 'button';
    botaoConfirmar.textContent = 'Confirmar';
    Object.assign(botaoConfirmar.style, {
      background: CORES.tinta, color: '#fff', border: 'none', borderRadius: '6px',
      padding: '7px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: '600', width: '100%',
    });
    botaoConfirmar.addEventListener('click', () => {
      // Revisão geral (29/09/2026): mudar só a observação regravava o prazo
      // como "agora + dias arredondados para cima" e esticava o "não cobrar"
      // (2,1 dias restantes viravam 3). Sem mexer nos dias, o prazo fica.
      const manterPrazo = naoCobrarAtivo && checkboxNaoCobrar.checked && inputDias.value === String(diasRestantes);
      const alertaGravado = salvarAlerta(cnpj, {
        naoCobrar: checkboxNaoCobrar.checked,
        intervaloDias: parseInt(inputDias.value, 10),
        observacao: textareaObservacao.value,
        naoCobrarAte: manterPrazo ? existente.naoCobrarAte : undefined,
      });
      const titulosGravados = caixasForaDoRelatorio
        .map((caixa) => marcarForaDoRelatorio(cnpj, caixa.dataset.titulo, caixa.checked))
        .every(Boolean);
      atualizarBadgeDoBotao(cnpj);
      // Falha de gravação NÃO fecha o painel como se tivesse salvo: o
      // operador acharia que o título saiu da cobrança e ele continuaria entrando.
      if (!alertaGravado || !titulosGravados) {
        window.__smartTableUtil?.toast?.('Não consegui salvar o alerta (o navegador recusou a gravação). Confira as marcações e confirme de novo.', 8000);
        return;
      }
      fecharPainel();
    });
    painelEl.appendChild(botaoConfirmar);

    painelEl.appendChild(criarDiv('Esc pra fechar sem salvar', {
      marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    }));

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
  }

  /**
   * Tenta encaixar o botão dentro do card do cliente, logo depois do botão
   * "Responsável financeiro" -- mesmo container flex, mesma linha. Devolve
   * true se conseguiu (o elemento já está no DOM nesse caso).
   *
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function inserirNoCardDoCliente(el) {
    const ancora = document.querySelector(CONFIG_ALERTA.SELETOR_ANCORA);
    if (!ancora || !ancora.parentElement) return false;
    ancora.insertAdjacentElement('afterend', el);
    return true;
  }

  function criarBotao(cnpj) {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = CONFIG_ALERTA.ID_BOTAO;
    el.textContent = '⚠ Alerta';

    botaoInjetadoNoDom = inserirNoCardDoCliente(el);

    if (botaoInjetadoNoDom) {
      // Classes de LAYOUT copiadas do botão vizinho (garantidas presentes
      // no CSS compilado da página, porque ele mesmo já as usa). A cor
      // nunca vem daqui -- ver atualizarBadgeDoBotao.
      el.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition';
      Object.assign(el.style, { cursor: 'pointer', fontFamily: 'inherit', borderStyle: 'solid', borderWidth: '1px' });
    } else {
      // Sem a âncora nesta página (layout diferente, ou ainda não
      // carregou) -- cai pro botão flutuante de antes, abaixo do
      // cabeçalho do CRM (ver TOPO_BOTAO). Nunca fica sem opção nenhuma.
      Object.assign(el.style, {
        position: 'fixed',
        top: CONFIG_ALERTA.TOPO_BOTAO,
        left: '16px',
        background: CORES.tinta,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '7px 14px',
        fontSize: '12.5px',
        fontWeight: '600',
        cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
        zIndex: CONFIG_ALERTA.Z_INDEX,
      });
      document.body.appendChild(el);
      window.__smartTableUtil?.acompanharMenuLateral?.(el);
    }

    el.addEventListener('click', () => {
      if (painelEl) {
        fecharPainel();
        return;
      }
      abrirPainel(cnpj);
    });
    return el;
  }

  function aoCarregar() {
    const cnpj = cnpjDaPagina();
    if (!cnpj) return; // só faz sentido na página do cliente

    desmarcarPagosDaPagina(cnpj);
    botaoEl = criarBotao(cnpj);
    atualizarBadgeDoBotao(cnpj);
    mostrarAvisoSeNecessario(cnpj);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aoCarregar);
  } else {
    aoCarregar();
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (painelEl) fecharPainel();
    else if (avisoEl) fecharAviso();
  });

  window.__smartTableUtil?.registrarPainel?.('alertaCliente', fecharTudo);

  window.__alertaCliente = {
    obterAlerta,
    salvarAlerta,
    estaSuprimidoDaPrioridade,
    titulosForaDoRelatorio,
    marcarForaDoRelatorio,
    predicadoForaDoRelatorio,
    tituloForaDoRelatorio,
    desmarcarPagos,
    desmarcarPagosDaPagina,
    titulosDoPainelForaDoRelatorio,
    abrirPainel,
    fecharPainel,
    mostrarAvisoSeNecessario,
    fecharAviso,
    estaAberto: () => painelEl !== null,
    avisoEstaAberto: () => avisoEl !== null,
    CONFIG_ALERTA,
  };
})();
