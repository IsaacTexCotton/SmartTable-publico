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
  const LIMITE_TITULO = 40;
  const LIMITE_PARCELA = 20;
  const pendentes = new Map();
  let observerInstalacao = null;
  let modalAtual = null;

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

    const botao = estilizar(elemento('button', 'Enviar ao Systextil'), {
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
    const titulo = estilizar(elemento('strong', 'Enviar título para o Systextil'), {
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

    const descricao = estilizar(elemento('p', 'Selecione um título elegível da cobrança. A transferência prepara somente o número e a parcela; a consulta e as demais ações continuam manuais.'), {
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

  function instalarBotao() {
    if (!document.body || document.getElementById(ID_BOTAO)) return;
    const ancora = document.getElementById('aviso-cobranca-botao');
    if (!ancora || !ancora.parentElement) return;

    const botao = estilizar(elemento('button', 'Enviar título ao Systextil'), {
      marginLeft: '8px',
      padding: '6px 12px',
      background: '#0F766E',
      color: '#FFFFFF',
      border: '0',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      fontFamily: '-apple-system, Segoe UI, Arial, sans-serif',
    });
    botao.id = ID_BOTAO;
    botao.type = 'button';
    botao.addEventListener('click', abrirModal);
    ancora.insertAdjacentElement('afterend', botao);
  }

  function observarInstalacao() {
    instalarBotao();
    if (document.getElementById(ID_BOTAO) || observerInstalacao || !document.body) return;
    observerInstalacao = new MutationObserver(() => {
      instalarBotao();
      if (document.getElementById(ID_BOTAO) && observerInstalacao) {
        observerInstalacao.disconnect();
        observerInstalacao = null;
      }
    });
    observerInstalacao.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observerInstalacao?.disconnect();
      observerInstalacao = null;
    }, 20000);
  }

  window.__smartTableSystextilDebug = Object.freeze({
    montarPedido,
    validarCodigo,
    validarCnpj,
    coletarTitulos,
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
