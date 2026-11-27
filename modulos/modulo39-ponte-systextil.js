/* =========================================================================
 * MÓDULO 39: TRANSFERÊNCIA DE TÍTULO CRM → SYSTEXTIL
 * -------------------------------------------------------------------------
 * Lê a lista elegível pelo classificador do Módulo 1 e envia ao Systextil o
 * título que o operador escolher e CONFIRMAR na própria linha. Depois do
 * pedido, o userscript do Systextil (systextil-segunda-via.user.js, repositório
 * Systextil-envio-mensagem) consulta, emite e baixa o PDF sozinho.
 *
 * O transporte é feito por evento DOM consumido por esse userscript. Este
 * módulo não acessa GM_* nem altera o ERP.
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
  // Estados que o userscript do Systêxtil publica. Qualquer outro (por exemplo
  // `preenchido`, da ponte antiga já aposentada) é ignorado sem mexer na tela.
  const ESTADOS_CONHECIDOS = new Set([
    'aguardando', 'abrindo-tela', 'abrir-tela-manual', 'processando',
    'emissao-solicitada', 'baixando', 'concluido', 'indeterminado', 'erro',
  ]);
  // Erros em que repetir o pedido não adianta: o Systêxtil recusaria de novo.
  const CODIGOS_SEM_NOVA_TENTATIVA = new Set(['pedido-pendente', 'bloqueio-persistido']);
  const CODIGOS_CONHECIDOS = new Set(['pedido-pendente', 'bloqueio-persistido', 'expirado', 'tela-ausente']);
  // Histórico só em memória e censurado por construção: estados e códigos de
  // listas fechadas, booleano e milissegundos. Nunca título, CNPJ, nome ou mensagem.
  const LIMITE_HISTORICO = 40;
  const historicoEventos = [];
  let contadorPedidos = 0;
  let observerInstalacao = null;
  let modalAtual = null;
  let timerDisponibilidade = null;
  let sondagemInicial = null;

  function codigoSeguro(valor) {
    if (typeof valor !== 'string' || !valor) return null;
    return CODIGOS_CONHECIDOS.has(valor) ? valor : 'outro';
  }

  function registrarHistorico(pendente, estado, ok, codigo) {
    historicoEventos.push(Object.freeze({
      n: pendente?.n ?? 0,
      estado,
      ok: ok === true,
      codigo: codigo || null,
      msDesdeEnvio: pendente?.enviadoEm ? Math.max(0, Date.now() - pendente.enviadoEm) : null,
    }));
    if (historicoEventos.length > LIMITE_HISTORICO) historicoEventos.shift();
  }

  function historico() {
    return historicoEventos.map((evento) => ({ ...evento }));
  }

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

  function existeEmAndamento() {
    for (const pendente of pendentes.values()) {
      if (!pendente.erro) return true;
    }
    return false;
  }

  // O Systêxtil só aceita um título por vez: enquanto há um em andamento, os
  // botões livres das outras linhas ficam desabilitados.
  function sincronizarBotoes() {
    if (!modalAtual) return;
    const ocupado = existeEmAndamento();
    modalAtual.querySelectorAll('button[data-papel="emitir"]').forEach((botao) => {
      if (botao.dataset.livre !== '1') return;
      botao.disabled = ocupado;
      botao.title = ocupado ? 'Aguarde o título em andamento terminar.' : '';
    });
  }

  function liberarBotao(botao, texto) {
    botao.dataset.livre = '1';
    botao.textContent = texto;
    botao.disabled = false;
  }

  function travarBotao(botao, texto, titulo) {
    botao.dataset.livre = '0';
    botao.textContent = texto;
    botao.disabled = true;
    if (titulo) botao.title = titulo;
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
    if (!ESTADOS_CONHECIDOS.has(resultado.status)) return;
    const botao = pendente.botao;
    const codigo = resultado.status === 'erro' ? codigoSeguro(resultado.codigo) : null;
    registrarHistorico(pendente, resultado.status, resultado.ok, codigo);
    if (pendente.timer) {
      window.clearTimeout(pendente.timer);
      pendente.timer = null;
    }

    if (resultado.status === 'erro') {
      const mensagem = resultado.mensagem || 'O Systextil não conseguiu iniciar a segunda via.';
      if (CODIGOS_SEM_NOVA_TENTATIVA.has(codigo)) {
        // Repetir seria recusado de novo: a linha pede conferência em vez de "Tentar novamente".
        pendentes.delete(resultado.id);
        if (botao?.isConnected) {
          travarBotao(
            botao,
            codigo === 'bloqueio-persistido' ? 'Conferência necessária' : 'Aguarde o pedido anterior',
            mensagem
          );
        }
      } else {
        // O pedido segue guardado no Tampermonkey e pode ser atendido depois (por exemplo,
        // quando o operador abre a tela). O erro não encerra o acompanhamento: se chegar
        // andamento do mesmo pedido até a validade, a linha volta a mostrá-lo.
        pendente.erro = true;
        if (codigo === 'expirado') {
          pendentes.delete(resultado.id);
        } else {
          pendente.timer = window.setTimeout(() => {
            if (pendentes.get(resultado.id) !== pendente) return;
            pendentes.delete(resultado.id);
            sincronizarBotoes();
          }, Math.max(0, Number(pendente.expiraEm) - Date.now()) + 250);
        }
        if (botao?.isConnected) liberarBotao(botao, 'Tentar novamente');
      }
      mostrarStatus(mensagem, true);
      sincronizarBotoes();
      return;
    }

    // Qualquer estado que não seja erro retoma o acompanhamento do pedido.
    pendente.erro = false;
    if (botao?.isConnected) {
      botao.disabled = true;
      botao.dataset.livre = '0';
    }

    if (resultado.status === 'aguardando') {
      const restante = Math.max(0, Number(pendente.expiraEm) - Date.now());
      if (restante === 0) {
        pendentes.delete(resultado.id);
        mostrarStatus('A solicitação expirou antes de ser recebida pelo Systextil. Confira a aba de destino e envie novamente.', true);
        if (botao?.isConnected) liberarBotao(botao, 'Tentar novamente');
        sincronizarBotoes();
        return;
      }

      if (botao?.isConnected) botao.textContent = 'Aguardando Systextil...';
      mostrarStatus(
        resultado.mensagem ||
        'Título recebido. A automação começa quando uma aba do Systextil estiver na Consulta de títulos.'
      );
      pendente.timer = window.setTimeout(() => {
        if (pendentes.get(resultado.id) !== pendente) return;
        pendentes.delete(resultado.id);
        mostrarStatus('A solicitação expirou sem o Systextil iniciar a consulta. Confira a aba de destino antes de reenviar.', true);
        if (botao?.isConnected) liberarBotao(botao, 'Tentar novamente');
        sincronizarBotoes();
      }, restante + 250);
      sincronizarBotoes();
      return;
    }
    const etapasEmAndamento = {
      'abrindo-tela': {
        botao: 'Abrindo a tela...',
        mensagem: 'Abrindo a Consulta de títulos (crec_f090) no Systextil…',
      },
      'abrir-tela-manual': {
        botao: 'Abra a Consulta de títulos',
        mensagem: 'O Systextil não abriu a Consulta de títulos sozinho. Abra essa tela; a automação continua quando ela aparecer.',
      },
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
      if (botao?.isConnected) botao.textContent = etapa.botao;
      mostrarStatus(resultado.mensagem || etapa.mensagem);
      pendente.timer = window.setTimeout(() => {
        if (pendentes.get(resultado.id) !== pendente) return;
        pendentes.delete(resultado.id);
        const mensagem = 'O SmartTable não recebeu a confirmação final do Systextil. Confira Processos agendados e a pasta Downloads antes de qualquer nova tentativa.';
        if (botao?.isConnected) {
          botao.textContent = 'Conferência necessária';
          botao.title = mensagem;
        }
        mostrarStatus(mensagem, true);
        sincronizarBotoes();
      }, TTL_ACOMPANHAMENTO_MS);
      sincronizarBotoes();
      return;
    }
    if (resultado.status === 'concluido') {
      pendentes.delete(resultado.id);
      const sucessoConfirmado = resultado.ok === true;
      const mensagem = sucessoConfirmado
        ? (resultado.mensagem || 'Segunda via concluída no Systextil. PDF salvo na pasta Downloads.')
        : 'O Systextil informou conclusão sem confirmar o sucesso. Confira Processos agendados e Downloads antes de tentar novamente.';
      if (botao?.isConnected) {
        travarBotao(botao, sucessoConfirmado ? '2ª via concluída' : 'Conferência necessária', mensagem);
      }
      mostrarStatus(mensagem, !sucessoConfirmado);
      sincronizarBotoes();
      return;
    }
    // Resta `indeterminado`.
    pendentes.delete(resultado.id);
    const mensagem = resultado.mensagem ||
      'O Systextil não confirmou o resultado da emissão. Confira Processos agendados e Downloads manualmente antes de tentar novamente.';
    if (botao?.isConnected) travarBotao(botao, 'Conferência necessária', mensagem);
    mostrarStatus(mensagem, true);
    sincronizarBotoes();
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
    botao.dataset.livre = '0';
    botao.textContent = 'Enviando...';
    contadorPedidos += 1;
    const novoPendente = {
      timer: null,
      botao,
      expiraEm: pedidoEnvio.createdAt + TTL_PEDIDO_MS,
      erro: false,
      n: contadorPedidos,
      enviadoEm: pedidoEnvio.createdAt,
    };
    pendentes.set(pedidoEnvio.id, novoPendente);
    registrarHistorico(novoPendente, 'enviado', true, null);
    sincronizarBotoes();
    // O texto e o aviso de "ponte não respondeu" ficam prontos ANTES do dispatchEvent: ele é
    // síncrono, e a ponte pode responder (por exemplo, recusando um pedido inválido) dentro dele.
    // `receberResultado` desarma este timer e escreve a resposta; nada aqui pode vir depois.
    mostrarStatus('Enviando a solicitação para o Tampermonkey...');
    novoPendente.timer = window.setTimeout(() => {
      if (pendentes.get(pedidoEnvio.id) !== novoPendente) return;
      pendentes.delete(pedidoEnvio.id);
      registrarHistorico(novoPendente, 'ponte-sem-resposta', false, null);
      mostrarStatus('A ponte não respondeu. Confira se o userscript de integração está instalado e habilitado no CRM e no Systextil.', true);
      if (botao.isConnected) liberarBotao(botao, 'Tentar novamente');
      sincronizarBotoes();
    }, 8000);
    const evento = new window.CustomEvent(EVENTO_ENVIAR, {
      detail: JSON.stringify(pedidoEnvio),
      bubbles: false,
    });
    document.dispatchEvent(evento);
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

    const botao = estilizar(elemento('button', 'Emitir 2ª via'), {
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
    botao.dataset.papel = 'emitir';
    botao.dataset.livre = '1';
    botao.addEventListener('click', () => abrirConfirmacao(linha, pedido, botao));
    linha.append(detalhes, botao);
    return linha;
  }

  // O userscript do Systêxtil consulta, emite e baixa sozinho depois do pedido:
  // o envio só acontece depois deste segundo clique, na própria linha.
  function abrirConfirmacao(linha, pedido, botao) {
    if (botao.disabled || linha.querySelector('[data-papel="confirmacao"]')) return;
    botao.disabled = true;
    botao.dataset.livre = '0';
    const painel = estilizar(elemento('div'), {
      gridColumn: '1 / -1',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 10px',
      borderRadius: '6px',
      background: '#FFF7E6',
      border: '1px solid #F5C77E',
    });
    painel.dataset.papel = 'confirmacao';
    painel.setAttribute('role', 'group');
    painel.setAttribute('aria-label', 'Confirmar a emissão da 2ª via');
    const aviso = estilizar(elemento('span', 'O Systextil vai consultar este título, solicitar a emissão e salvar o PDF em Downloads.'), {
      flex: '1 1 240px',
      fontSize: '12px',
      lineHeight: '1.4',
      color: '#7A4A00',
    });
    const confirmar = estilizar(elemento('button', 'Confirmar emissão'), {
      border: '0',
      borderRadius: '6px',
      padding: '7px 11px',
      background: '#0F766E',
      color: '#FFFFFF',
      fontWeight: '600',
      cursor: 'pointer',
    });
    confirmar.type = 'button';
    confirmar.dataset.papel = 'confirmar';
    const cancelar = estilizar(elemento('button', 'Cancelar'), {
      border: '1px solid #D0D5DD',
      borderRadius: '6px',
      padding: '6px 10px',
      background: '#FFFFFF',
      cursor: 'pointer',
    });
    cancelar.type = 'button';
    cancelar.dataset.papel = 'cancelar';
    cancelar.addEventListener('click', () => {
      painel.remove();
      botao.dataset.livre = '1';
      sincronizarBotoes();
    });
    confirmar.addEventListener('click', () => {
      painel.remove();
      if (existeEmAndamento()) {
        mostrarStatus('Aguarde o título em andamento terminar antes de emitir outro.', true);
        botao.dataset.livre = '1';
        sincronizarBotoes();
        return;
      }
      botao.disabled = false;
      enviarPedido(pedido, botao);
    });
    painel.append(aviso, confirmar, cancelar);
    linha.appendChild(painel);
    cancelar.focus();
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

    const descricao = estilizar(elemento('p', 'Selecione um título vencido elegível. Depois da sua confirmação, o Systextil consulta o título, solicita a emissão e salva o PDF na pasta Downloads. Deixe uma aba do Systextil aberta neste navegador.'), {
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
    const rodape = estilizar(elemento('p', 'Razão social e CNPJ servem para conferência: o Systextil só emite se número, parcela e cliente conferirem lá.'), {
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
        status.textContent = 'Não há títulos elegíveis para emitir a 2ª via nesta empresa ou grupo.';
        return;
      }
      itens.forEach((item) => lista.appendChild(criarLinha(item)));
      sincronizarBotoes();
      status.textContent = itens.length + ' título(s) elegível(is). Escolha um para emitir a 2ª via.';
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
    return { estado: 'disponivel', disponivel: true, mensagem: 'Emitir a 2ª via de um título no Systextil.' };
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
    historico,
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
