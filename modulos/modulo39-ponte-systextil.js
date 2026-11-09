/* =========================================================================
 * MÓDULO 39: TRANSFERÊNCIA DE TÍTULO CRM → SYSTEXTIL
 * -------------------------------------------------------------------------
 * Lê a lista elegível pelo classificador do Módulo 1 e transfere um título
 * escolhido pelo operador para o painel de segunda via do Systextil.
 *
 * O transporte é feito por evento DOM consumido pelo userscript separado
 * "SmartTable → Systextil". Este módulo não acessa GM_* nem altera o ERP.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__smartTableSystextilCarregado) return;
  window.__smartTableSystextilCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Ponte CRM → Systextil');

  const EVENTO_ENVIAR = 'smarttable:systextil:enviar-titulo';
  const EVENTO_RESULTADO = 'smarttable:systextil:resultado';
  const ID_BOTAO = 'smarttable-systextil-transferir';
  const ID_MODAL = 'smarttable-systextil-modal';
  const TEMPO_ESPERA_GRUPO_MS = 4500;
  const TTL_PEDIDO_MS = 5 * 60 * 1000;
  const TTL_ACOMPANHAMENTO_MS = 10 * 60 * 1000;
  const LIMITE_TITULO = 40;
  const LIMITE_PARCELA = 20;
  const pendentes = new Map();
  let observerInstalacao = null;
  let modalAtual = null;
  let timerDisponibilidade = null;
  let sondagemInicial = null;

  function cnpjAtual() {
    let valor = '';
    try {
      valor = new URLSearchParams(window.location.search).get('cnpj') || '';
    } catch (_) {
      return '';
    }
    const digitos = String(valor).replace(/\D/g, '');
    return /^\d{14}$/.test(digitos) ? digitos : '';
  }

  function validarCodigo(valor, limite, rotulo) {
    const codigo = String(valor ?? '').trim();
    if (!codigo || codigo.length > limite || !/^[A-Za-z0-9_-]+$/.test(codigo)) {
      throw new Error(rotulo + ' ausente ou com formato inválido. O título não foi enviado.');
    }
    return codigo;
  }

  function validarCnpj(valor) {
    const digitos = String(valor ?? '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(digitos)) {
      throw new Error('Não foi possível identificar o CNPJ completo da empresa no CRM.');
    }
    return digitos;
  }

  function criarId() {
    try {
      if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) {
      // Usa identificador local alternativo quando randomUUID não estiver disponível.
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  function montarPedido(registro, empresa) {
    const cnpj = validarCnpj(empresa?.cnpj);
    const titulo = validarCodigo(registro?.titulo, LIMITE_TITULO, 'Número do título');
    const parcela = validarCodigo(registro?.parcela, LIMITE_PARCELA, 'Parcela/sequência');
    const razaoSocial = String(empresa?.razaoSocial ?? registro?.razaoSocial ?? '').trim();

    if (!razaoSocial || razaoSocial.length > 180) {
      throw new Error('A razão social não está disponível para conferência.');
    }

    return {
      schema: 1,
      id: criarId(),
      createdAt: Date.now(),
      source: 'smarttable-crm',
      cnpj,
      razaoSocial,
      titulo,
      parcela,
      vencimento: String(registro?.vencimentoTexto ?? '').trim().slice(0, 20),
      saldo: String(registro?.saldoTexto ?? '').trim().slice(0, 40),
      diasAtraso: Number.isInteger(registro?.diasAtrasoReal) ? registro.diasAtrasoReal : null,
      situacao: String(registro?.situacaoKey ?? '').trim().slice(0, 40),
      fluxo: String(registro?.fluxo ?? '').trim().slice(0, 20),
    };
  }

  function validarConjunto(dados, cnpj, razaoSocial, origem) {
    if (!dados || !Array.isArray(dados.registros)) {
      throw new Error('O CRM não retornou uma lista de títulos válida.');
    }
    if (!Array.isArray(dados.ignorados)) {
      throw new Error('O CRM não confirmou o estado de leitura de todas as linhas. A transferência foi bloqueada.');
    }
    if (dados.ignorados.length > 0) {
      throw new Error('Há título(s) que o CRM não conseguiu ler. A transferência foi bloqueada para evitar dados parciais.');
    }
    return dados.registros.map((registro) => ({
      registro,
      empresa: {
        cnpj,
        razaoSocial: String(razaoSocial || registro?.razaoSocial || '').trim(),
        origem,
      },
    }));
  }

  async function aguardarLeituraGrupo() {
    const limite = Date.now() + TEMPO_ESPERA_GRUPO_MS;
    while (!window.__alertaGrupo && Date.now() < limite) {
      await new Promise((resolver) => window.setTimeout(resolver, 100));
    }
    if (!window.__alertaGrupo) {
      throw new Error('A leitura do grupo econômico ainda não terminou. Aguarde o CRM concluir e abra a transferência novamente.');
    }
    return window.__alertaGrupo;
  }

  async function coletarTitulos() {
    const api = window.__avisoCobranca;
    if (typeof api?.simular !== 'function') {
      throw new Error('O classificador de cobrança do SmartTable não está disponível.');
    }

    const cnpj = validarCnpj(cnpjAtual());
    const dadosAtuais = api.simular();
    const atuais = validarConjunto(dadosAtuais, cnpj, '', 'empresa atual');
    const todos = [...atuais];

    const grupo = await aguardarLeituraGrupo();
    if (grupo.leituraIncompleta) {
      throw new Error('O CRM não conseguiu ler todas as empresas do grupo. A transferência foi bloqueada.');
    }

    const empresasComVencido = Array.isArray(grupo.empresasComVencido)
      ? grupo.empresasComVencido
      : null;
    if (!empresasComVencido) {
      throw new Error('A lista de empresas do grupo está incompleta. A transferência foi bloqueada.');
    }

    if (empresasComVencido.length > 0) {
      if (typeof window.__grupoEconomico?.buscarDadosParaRelatorio !== 'function') {
        throw new Error('O leitor de títulos das outras empresas do grupo não está disponível.');
      }
      const fontes = await window.__grupoEconomico.buscarDadosParaRelatorio(new Date());
      if (!Array.isArray(fontes)) {
        throw new Error('A leitura das outras empresas do grupo retornou um formato inválido.');
      }
      fontes.forEach((fonte) => {
        const cnpjFonte = validarCnpj(fonte?.cnpj);
        const razao = String(fonte?.razaoSocial ?? '').trim();
        if (!razao) throw new Error('Uma empresa do grupo está sem razão social identificável.');
        todos.push(...validarConjunto(fonte.dados, cnpjFonte, razao, 'grupo econômico'));
      });
    }

    const vistos = new Set();
    const resultado = [];
    for (const item of todos) {
      const pedido = montarPedido(item.registro, item.empresa);
      const chave = pedido.cnpj + '|' + pedido.titulo + '|' + pedido.parcela;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      resultado.push({ pedido, registro: item.registro });
    }
    return resultado;
  }

  function elemento(tag, texto, classe) {
    const node = document.createElement(tag);
    if (texto !== undefined) node.textContent = String(texto);
    if (classe) node.className = classe;
    return node;
  }

  function estilizar(node, regras) {
    Object.assign(node.style, regras);
    return node;
  }

  function fecharModal() {
    if (modalAtual) modalAtual.remove();
    modalAtual = null;
  }

  function mostrarStatus(mensagem, erro = false) {
    if (!modalAtual) {
      window.__smartTableUtil?.toast?.(mensagem, 5000);
      return;
    }
    const status = modalAtual.querySelector('[data-papel="status"]');
    if (!status) return;
    status.textContent = mensagem;
    status.style.color = erro ? '#B42318' : '#176B4D';
  }

  function receberResultado(evento) {
    let resultado;
    try {
      resultado = typeof evento?.detail === 'string'
        ? JSON.parse(evento.detail)
        : evento?.detail;
    } catch (_) {
      return;
    }
    if (!resultado || typeof resultado.id !== 'string') return;
    const pendente = pendentes.get(resultado.id);
    if (!pendente) return;
    if (pendente?.timer) {
      window.clearTimeout(pendente.timer);
      pendente.timer = null;
    }
    if (resultado.status === 'aguardando') {
      const restante = Math.max(0, Number(pendente.expiraEm) - Date.now());
      if (restante === 0) {
        pendentes.delete(resultado.id);
        mostrarStatus('A solicitação expirou antes de ser recebida pelo Systextil. Confira a aba de destino e envie novamente.', true);
        if (pendente.botao?.isConnected) {
          pendente.botao.disabled = false;
          pendente.botao.textContent = 'Tentar novamente';
        }
        return;
      }

      if (pendente.botao?.isConnected) {
        pendente.botao.textContent = 'Aguardando Systextil...';
      }
      mostrarStatus(
        'Solicitação guardada. No Systextil, abra o painel de segunda via (Ctrl+Alt+B). Os campos serão preparados quando o painel aparecer.'
      );
      pendente.timer = window.setTimeout(() => {
        if (pendentes.get(resultado.id) !== pendente) return;
        pendentes.delete(resultado.id);
        mostrarStatus('A solicitação expirou ou o Systextil não confirmou o preenchimento. Confira a aba de destino antes de reenviar.', true);
        if (pendente.botao?.isConnected) {
          pendente.botao.disabled = false;
          pendente.botao.textContent = 'Tentar novamente';
        }
      }, restante + 250);
      return;
    }
    const etapasEmAndamento = {
      processando: {
        botao: 'Processando no Systextil...',
        mensagem: 'O Systextil iniciou o preenchimento e a consulta do título.',
      },
      'emissao-solicitada': {
        botao: 'Emissão solicitada...',
        mensagem: 'Título conferido e emissão solicitada ao Systextil.',
      },
      baixando: {
        botao: 'Baixando PDF...',
        mensagem: 'O processo foi concluído. O PDF está sendo salvo.',
      },
    };
    const etapa = etapasEmAndamento[resultado.status];
    if (etapa) {
      if (pendente.botao?.isConnected) {
        pendente.botao.textContent = etapa.botao;
      }
      mostrarStatus(resultado.mensagem || etapa.mensagem);
      pendente.timer = window.setTimeout(() => {
        if (pendentes.get(resultado.id) !== pendente) return;
        pendentes.delete(resultado.id);
        const mensagem = 'O SmartTable não recebeu a confirmação final do Systextil. Confira Processos agendados e a pasta Downloads antes de qualquer nova tentativa.';
        if (pendente.botao?.isConnected) {
          pendente.botao.textContent = 'Conferência necessária';
          pendente.botao.title = mensagem;
        }
        mostrarStatus(mensagem, true);
      }, TTL_ACOMPANHAMENTO_MS);
      return;
    }
    if (resultado.status === 'concluido') {
      pendentes.delete(resultado.id);
      const sucessoConfirmado = resultado.ok === true;
      const mensagem = sucessoConfirmado
        ? (resultado.mensagem || 'Segunda via concluída no Systextil. PDF salvo na pasta Downloads.')
        : 'O Systextil informou conclusão sem confirmar o sucesso. Confira Processos agendados e Downloads antes de tentar novamente.';
      if (pendente.botao?.isConnected) {
        pendente.botao.disabled = true;
        pendente.botao.textContent = sucessoConfirmado ? '2ª via concluída' : 'Conferência necessária';
        pendente.botao.title = mensagem;
      }
      mostrarStatus(mensagem, !sucessoConfirmado);
      return;
    }
    if (resultado.status === 'indeterminado') {
      pendentes.delete(resultado.id);
      const mensagem = resultado.mensagem ||
        'O Systextil não confirmou o resultado da emissão. Confira Processos agendados e Downloads manualmente antes de tentar novamente.';
      if (pendente.botao?.isConnected) {
        pendente.botao.disabled = true;
        pendente.botao.textContent = 'Conferência necessária';
        pendente.botao.title = mensagem;
      }
      mostrarStatus(mensagem, true);
      return;
    }
    if (resultado.status === 'preenchido') {
      pendentes.delete(resultado.id);
      if (pendente.botao?.isConnected) {
        pendente.botao.textContent = 'Transferido — confira no Systextil';
      }
      mostrarStatus('Número do título e parcela inseridos no painel do Systextil. Confira a razão social e os dados antes de preencher no ERP.');
      return;
    }
    if (resultado.status === 'erro') {
      pendentes.delete(resultado.id);
      if (pendente?.botao?.isConnected) {
        pendente.botao.disabled = false;
        pendente.botao.textContent = 'Tentar novamente';
      }
      mostrarStatus(resultado.mensagem || 'A ponte não conseguiu preparar os campos no Systextil.', true);
    }
  }

  document.addEventListener(EVENTO_RESULTADO, receberResultado);

  function enviarPedido(pedido, botao) {
    if (botao.disabled) return;
    // Cada tentativa recebe identidade e TTL próprios. Reutilizar createdAt
    // faria um retry após cinco minutos ser recusado como pedido expirado.
    const pedidoEnvio = {
      ...pedido,
      id: criarId(),
      createdAt: Date.now(),
    };
    botao.disabled = true;
    botao.textContent = 'Enviando...';
    pendentes.set(pedidoEnvio.id, {
      timer: null,
      botao,
      expiraEm: pedidoEnvio.createdAt + TTL_PEDIDO_MS,
    });
    const evento = new window.CustomEvent(EVENTO_ENVIAR, {
      detail: JSON.stringify(pedidoEnvio),
      bubbles: false,
    });
    document.dispatchEvent(evento);

    const pendente = pendentes.get(pedidoEnvio.id);
    if (pendente) {
      pendente.timer = window.setTimeout(() => {
        if (pendentes.get(pedidoEnvio.id) !== pendente) return;
        pendentes.delete(pedidoEnvio.id);
        mostrarStatus('A ponte não respondeu. Confira se o userscript de integração está instalado e habilitado no CRM e no Systextil.', true);
        if (botao.isConnected) {
          botao.disabled = false;
          botao.textContent = 'Tentar novamente';
        }
      }, 8000);
    }
    mostrarStatus('Enviando a solicitação para o Tampermonkey...');
  }

  function criarLinha(item) {
    const { pedido } = item;
    const linha = estilizar(elemento('article'), {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) auto',
      gap: '12px',
      alignItems: 'center',
      padding: '10px 12px',
      borderBottom: '1px solid #E4E7EC',
      background: '#FFFFFF',
    });

    const detalhes = elemento('div');
    const titulo = estilizar(elemento('strong', 'Título ' + pedido.titulo + ' · Parcela ' + pedido.parcela), {
      display: 'block',
      color: '#16232F',
      fontSize: '13px',
    });
    const linhaCliente = estilizar(elemento('div', pedido.razaoSocial + ' · CNPJ ' + pedido.cnpj), {
      color: '#475467',
      fontSize: '12px',
      marginTop: '3px',
      overflowWrap: 'anywhere',
    });
    const linhaInfo = [
      pedido.vencimento ? 'Venc. ' + pedido.vencimento : '',
      pedido.saldo ? 'Saldo ' + pedido.saldo : '',
      Number.isInteger(pedido.diasAtraso) ? pedido.diasAtraso + ' dias de atraso' : '',
      pedido.situacao,
    ].filter(Boolean).join(' · ');
    const info = estilizar(elemento('div', linhaInfo), {
      color: '#667085',
      fontSize: '11px',
      marginTop: '3px',
    });
    detalhes.append(titulo, linhaCliente, info);

    const botao = estilizar(elemento('button', 'Preparar no Systextil'), {
      border: '0',
      borderRadius: '6px',
      padding: '8px 11px',
      background: '#0F766E',
      color: '#FFFFFF',
      fontWeight: '600',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    botao.type = 'button';
    botao.addEventListener('click', () => enviarPedido(pedido, botao));
    linha.append(detalhes, botao);
    return linha;
  }

  async function abrirModal() {
    if (document.getElementById(ID_BOTAO)?.disabled) return;
    if (modalAtual) {
      fecharModal();
      return;
    }
    const overlay = estilizar(elemento('div'), {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      background: 'rgba(16,24,40,.46)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '18px',
      boxSizing: 'border-box',
    });
    overlay.id = ID_MODAL;
    const caixa = estilizar(elemento('section'), {
      width: 'min(720px, 96vw)',
      maxHeight: '84vh',
      overflow: 'auto',
      background: '#FFFFFF',
      borderRadius: '12px',
      boxShadow: '0 14px 42px rgba(16,24,40,.28)',
      padding: '18px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#16232F',
    });
    const cabecalho = estilizar(elemento('div'), {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '8px',
    });
    const titulo = estilizar(elemento('strong', 'Preparar 2ª via no Systextil'), {
      fontSize: '16px',
    });
    const fechar = estilizar(elemento('button', 'Fechar'), {
      border: '1px solid #D0D5DD',
      background: '#FFFFFF',
      borderRadius: '6px',
      padding: '6px 10px',
      cursor: 'pointer',
    });
    fechar.type = 'button';
    fechar.addEventListener('click', fecharModal);
    cabecalho.append(titulo, fechar);

    const descricao = estilizar(elemento('p', 'Selecione um título vencido elegível. O SmartTable prepara somente o número e a parcela no painel do Systextil; a conferência e a emissão continuam manuais.'), {
      margin: '0 0 12px',
      color: '#475467',
      fontSize: '13px',
      lineHeight: '1.45',
    });
    const status = estilizar(elemento('p', 'Lendo os títulos elegíveis do CRM...'), {
      margin: '8px 0 0',
      color: '#667085',
      fontSize: '12px',
      minHeight: '18px',
    });
    status.dataset.papel = 'status';
    const lista = elemento('div');
    const rodape = estilizar(elemento('p', 'A razão social e o CNPJ são enviados apenas como referência de conferência. Eles não substituem a validação do título no Systextil.'), {
      margin: '10px 0 0',
      color: '#667085',
      fontSize: '11px',
    });

    caixa.append(cabecalho, descricao, lista, status, rodape);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);
    modalAtual = overlay;

    try {
      const itens = await coletarTitulos();
      lista.replaceChildren();
      if (itens.length === 0) {
        status.textContent = 'Não há títulos elegíveis para transferência nesta empresa ou grupo.';
        return;
      }
      itens.forEach((item) => lista.appendChild(criarLinha(item)));
      status.textContent = itens.length + ' título(s) elegível(is). Escolha um para transferir.';
    } catch (erro) {
      lista.replaceChildren();
      status.textContent = erro?.message || 'Não foi possível ler os títulos do CRM.';
      status.style.color = '#B42318';
    }
  }

  function avaliarDisponibilidade() {
    const api = window.__avisoCobranca;
    if (typeof api?.simular !== 'function') {
      return { estado: 'verificando', disponivel: false, mensagem: 'Aguardando a leitura dos títulos vencidos pelo SmartTable.' };
    }

    let dados;
    try {
      dados = api.simular();
    } catch (_) {
      return { estado: 'erro', disponivel: false, mensagem: 'Não foi possível ler os títulos. Atualize a página e tente novamente.' };
    }

    if (!dados || !Array.isArray(dados.registros) || !Array.isArray(dados.ignorados)) {
      return { estado: 'verificando', disponivel: false, mensagem: 'Verificando a leitura dos títulos vencidos...' };
    }
    if (dados.ignorados.length > 0) {
      return {
        estado: 'bloqueado',
        disponivel: false,
        mensagem: 'Há título(s) que não puderam ser lidos. A preparação está bloqueada para evitar dados incompletos.',
      };
    }

    const grupo = window.__alertaGrupo;
    if (!grupo) {
      return { estado: 'verificando', disponivel: false, mensagem: 'Aguardando a conferência do grupo econômico...' };
    }
    if (grupo.leituraIncompleta) {
      return {
        estado: 'bloqueado',
        disponivel: false,
        mensagem: 'A leitura do grupo econômico ficou incompleta. A preparação está bloqueada.',
      };
    }
    if (!Array.isArray(grupo.empresasComVencido)) {
      return { estado: 'verificando', disponivel: false, mensagem: 'Aguardando a conferência do grupo econômico...' };
    }

    const existemTitulos = dados.registros.length > 0 || grupo.empresasComVencido.length > 0;
    if (!existemTitulos) {
      return {
        estado: 'sem-titulos',
        disponivel: false,
        mensagem: 'Não há títulos vencidos elegíveis nesta empresa ou grupo econômico.',
      };
    }
    return { estado: 'disponivel', disponivel: true, mensagem: 'Preparar número e parcela no Systextil.' };
  }

  function atualizarDisponibilidade() {
    const botao = document.getElementById(ID_BOTAO);
    const status = document.getElementById('smarttable-systextil-status');
    if (!botao || !status) return;
    const estado = avaliarDisponibilidade();
    botao.disabled = !estado.disponivel;
    botao.dataset.estado = estado.estado;
    botao.title = estado.mensagem;
    botao.setAttribute('aria-label', 'Preparar 2ª via no Systextil. ' + estado.mensagem);
    botao.style.opacity = estado.disponivel ? '1' : '0.52';
    botao.style.cursor = estado.disponivel ? 'pointer' : 'not-allowed';
    const mensagemStatus = estado.disponivel ? '' : estado.mensagem;
    if (status.textContent !== mensagemStatus) status.textContent = mensagemStatus;
    status.hidden = estado.disponivel;
  }

  function agendarAtualizacaoDisponibilidade() {
    if (timerDisponibilidade) window.clearTimeout(timerDisponibilidade);
    timerDisponibilidade = window.setTimeout(() => {
      timerDisponibilidade = null;
      atualizarDisponibilidade();
    }, 120);
  }

  function instalarBotao() {
    if (!document.body) return false;
    const raizTabela = document.getElementById('tabela-titulos-ds');
    if (!raizTabela) return false;
    // No CRM, #tabela-titulos-ds pode ser o contêiner da SmartTable, não a
    // <table> em si. Ancorar no primeiro elemento interno mantém a ação
    // dentro do card de títulos vencidos, inclusive quando a tabela é criada
    // depois do contêiner.
    const referencia = raizTabela.matches('table')
      ? raizTabela
      : raizTabela.querySelector('table') || raizTabela.firstElementChild || raizTabela;
    if (!referencia.parentElement) return false;

    let barra = document.getElementById('smarttable-systextil-acoes');
    if (!barra) {
      barra = estilizar(elemento('div'), {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '8px 0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      });
      barra.id = 'smarttable-systextil-acoes';

      const botao = estilizar(elemento('button', 'Preparar 2ª via'), {
        padding: '7px 11px',
        background: '#0F766E',
        color: '#FFFFFF',
        border: '0',
        borderRadius: '7px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        fontFamily: 'inherit',
      });
      botao.id = ID_BOTAO;
      botao.type = 'button';
      botao.addEventListener('click', abrirModal);

      const status = estilizar(elemento('span'), {
        color: '#667085',
        fontSize: '12px',
        lineHeight: '1.4',
      });
      status.id = 'smarttable-systextil-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');

      barra.append(botao, status);
    }

    if (!barra.isConnected || barra.nextElementSibling !== referencia) {
      referencia.insertAdjacentElement('beforebegin', barra);
    }
    atualizarDisponibilidade();
    return true;
  }

  function observarInstalacao() {
    instalarBotao();
    if (observerInstalacao || !document.body) return;

    observerInstalacao = new MutationObserver(() => {
      const raizTabela = document.getElementById('tabela-titulos-ds');
      if (!raizTabela) return;
      const referencia = raizTabela.matches('table')
        ? raizTabela
        : raizTabela.querySelector('table') || raizTabela.firstElementChild || raizTabela;
      const barra = document.getElementById('smarttable-systextil-acoes');
      // Só reconstrói/reancora a barra quando o nó de referência mudou ou
      // o CRM removeu a interface. A disponibilidade é recalculada com debounce.
      if (!barra?.isConnected || barra.nextElementSibling !== referencia) instalarBotao();
      agendarAtualizacaoDisponibilidade();
    });
    observerInstalacao.observe(document.body, {
      childList: true,
      subtree: true,
    });

    if (!sondagemInicial) {
      let tentativas = 0;
      sondagemInicial = window.setInterval(() => {
        tentativas += 1;
        instalarBotao();
        const estado = avaliarDisponibilidade();
        if (estado.estado !== 'verificando' || tentativas >= 30) {
          window.clearInterval(sondagemInicial);
          sondagemInicial = null;
        }
      }, 400);
    }
  }

  window.__smartTableSystextilDebug = Object.freeze({
    montarPedido,
    validarCodigo,
    validarCnpj,
    coletarTitulos,
    avaliarDisponibilidade,
    atualizarDisponibilidade,
    receberResultado,
    ID_BOTAO,
    ID_MODAL,
    EVENTO_ENVIAR,
    EVENTO_RESULTADO,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observarInstalacao, { once: true });
  } else {
    observarInstalacao();
  }
})();
