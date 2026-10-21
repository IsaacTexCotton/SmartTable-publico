/* =========================================================================
 * MÓDULO 34: RETORNO RÁPIDO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Frases reutilizáveis por operador, guardadas no localStorage deste navegador.
 * Cada frase associa um nome, um resultado nativo e uma observação. Ao aplicar,
 * clica no resultado e em "Salvar Contato" do próprio CRM; não chama a API.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__retornoRapidoCarregado) return;
  window.__retornoRapidoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Retorno Rápido');

  const ID_BOTAO = 'smarttable-retorno-abrir';
  const ID_DIALOGO = 'smarttable-retorno-dialogo';
  const ID_ESTILOS = 'smarttable-retorno-estilos';
  const CHAVE_FRASES = 'smarttable_retorno_rapido_v1';
  const PREFIXO_RESULTADO = 'btn-resultado-';

  let dialogo = null;
  let listaFrases = null;
  let caixaFormulario = null;
  let formulario = null;
  let campoNome = null;
  let campoResultado = null;
  let campoObservacao = null;
  let botaoSalvarFrase = null;
  let idEmEdicao = null;
  let registroEmAndamento = false;
  let observador = null;

  function avisar(mensagem) {
    try {
      const util = window.__smartTableUtil;
      if (typeof util?.toast === 'function') {
        util.toast(mensagem, 3200);
        return;
      }
    } catch (erro) {
      // O aviso não pode impedir o fluxo do CRM.
    }
    console.info('[Retorno Rápido] ' + mensagem);
  }

  function elemento(tag, classe, texto) {
    const item = document.createElement(tag);
    if (classe) item.className = classe;
    if (texto !== undefined) item.textContent = texto;
    return item;
  }

  function instalarEstilos() {
    if (document.getElementById(ID_ESTILOS) || !document.head) return;
    const estilo = elemento('style');
    estilo.id = ID_ESTILOS;
    estilo.textContent = [
      '.smt-retorno-overlay{position:fixed;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(16,24,40,.38);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.smt-retorno-dialog{display:flex;flex-direction:column;width:min(700px,100%);max-height:86vh;overflow:auto;background:#fff;color:#344054;border:1px solid #d0d5dd;border-radius:14px;box-shadow:0 16px 48px rgba(16,24,40,.25);padding:20px;box-sizing:border-box;}',
      '.smt-retorno-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;}',
      '.smt-retorno-header h2{font-size:18px;font-weight:700;color:#16232f;margin:0;}',
      '.smt-retorno-descricao{font-size:13px;line-height:1.5;color:#667085;margin:0 0 14px;}',
      '.smt-retorno-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;}',
      '.smt-retorno-frases{display:flex;flex-direction:column;gap:8px;}',
      '.smt-retorno-vazio{padding:14px;border:1px dashed #d0d5dd;border-radius:10px;color:#667085;font-size:13px;}',
      '.smt-retorno-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px;border:1px solid #e4e7ec;border-radius:10px;background:#fff;}',
      '.smt-retorno-aplicar{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;text-align:left;background:#f8fafc;border:0;border-radius:7px;padding:9px;cursor:pointer;color:#344054;}',
      '.smt-retorno-aplicar:hover{background:#eef4f9;}',
      '.smt-retorno-item-titulo{font-size:13px;font-weight:700;color:#16232f;overflow-wrap:anywhere;}',
      '.smt-retorno-item-resultado{font-size:11px;font-weight:600;color:#1f5f8b;}',
      '.smt-retorno-item-texto{font-size:12px;line-height:1.45;color:#667085;white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.smt-retorno-acoes{display:flex;flex-direction:column;gap:6px;}',
      '.smt-retorno-btn{border:1px solid #d0d5dd;background:#fff;color:#344054;border-radius:8px;padding:8px 11px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;}',
      '.smt-retorno-btn:hover{background:#f2f4f7;}',
      '.smt-retorno-btn-principal{border-color:#1f5f8b;background:#1f5f8b;color:#fff;}',
      '.smt-retorno-btn-principal:hover{background:#194d70;}',
      '.smt-retorno-btn-perigo{color:#b42318;border-color:#fecdca;}',
      '.smt-retorno-form-wrap{border-top:1px solid #e4e7ec;margin-top:14px;padding-top:14px;}',
      '.smt-retorno-form-titulo{font-size:14px;font-weight:700;color:#16232f;margin:0 0 12px;}',
      '.smt-retorno-campo{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}',
      '.smt-retorno-label{font-size:12px;font-weight:600;color:#344054;}',
      '.smt-retorno-input,.smt-retorno-select,.smt-retorno-textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:8px;padding:9px 10px;font:inherit;font-size:13px;color:#344054;background:#fff;}',
      '.smt-retorno-textarea{resize:vertical;min-height:86px;}',
      '.smt-retorno-form-acoes{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;}',
      '.smt-retorno-form-wrap[hidden]{display:none!important;}',
      '@media(max-width:520px){.smt-retorno-dialog{padding:14px;max-height:90vh;}.smt-retorno-item{grid-template-columns:1fr;}.smt-retorno-acoes{flex-direction:row;justify-content:flex-end;}.smt-retorno-toolbar{align-items:flex-start;flex-direction:column;}}'
    ].join('\n');
    document.head.appendChild(estilo);
  }

  function lerFrases() {
    let bruto;
    try {
      bruto = window.localStorage.getItem(CHAVE_FRASES);
    } catch (erro) {
      return [];
    }
    if (!bruto) return [];
    try {
      const dados = JSON.parse(bruto);
      if (!Array.isArray(dados)) return [];
      return dados.filter(function (frase) {
        return frase && typeof frase.id === 'string' && frase.id &&
          typeof frase.rotulo === 'string' && frase.rotulo.trim() &&
          typeof frase.resultadoId === 'string' && frase.resultadoId &&
          typeof frase.observacao === 'string' && frase.observacao.trim();
      });
    } catch (erro) {
      return [];
    }
  }

  function gravarFrases(frases) {
    try {
      window.localStorage.setItem(CHAVE_FRASES, JSON.stringify(frases));
      return true;
    } catch (erro) {
      avisar('Não foi possível salvar as frases neste navegador.');
      return false;
    }
  }

  function extrairResultados() {
    return Array.from(document.querySelectorAll('button[id^="' + PREFIXO_RESULTADO + '"]'))
      .map(function (botao) {
        const rotulo = botao.querySelector('span.text-sm, span.text-xs') || botao;
        return {
          id: botao.id.slice(PREFIXO_RESULTADO.length),
          rotulo: rotulo.textContent.replace(/\s+/g, ' ').trim()
        };
      })
      .filter(function (resultado) {
        return resultado.id && resultado.rotulo;
      });
  }

  function gerarId() {
    return 'retorno-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function limparFormulario() {
    if (!formulario) return;
    formulario.reset();
    idEmEdicao = null;
    botaoSalvarFrase.textContent = 'Salvar frase';
  }

  function preencherResultados(valor) {
    if (!campoResultado) return;
    while (campoResultado.firstChild) campoResultado.removeChild(campoResultado.firstChild);
    const placeholder = elemento('option', '', 'Selecione um resultado do CRM');
    placeholder.value = '';
    campoResultado.appendChild(placeholder);
    extrairResultados().forEach(function (resultado) {
      const opcao = elemento('option', '', resultado.rotulo);
      opcao.value = resultado.id;
      campoResultado.appendChild(opcao);
    });
    campoResultado.value = valor || '';
  }

  function mostrarFormulario(frase) {
    limparFormulario();
    preencherResultados(frase ? frase.resultadoId : '');
    if (frase) {
      idEmEdicao = frase.id;
      campoNome.value = frase.rotulo;
      campoObservacao.value = frase.observacao;
      botaoSalvarFrase.textContent = 'Salvar alterações';
    }
    caixaFormulario.hidden = false;
    campoNome.focus();
  }

  function cancelarFormulario() {
    limparFormulario();
    caixaFormulario.hidden = true;
  }

  function renderizarLista() {
    if (!listaFrases) return;
    while (listaFrases.firstChild) listaFrases.removeChild(listaFrases.firstChild);
    const frases = lerFrases();
    if (!frases.length) {
      listaFrases.appendChild(elemento('p', 'smt-retorno-vazio', 'Nenhuma frase salva ainda. Use “Criar nova frase” para montar seu primeiro atalho.'));
      return;
    }
    frases.forEach(function (frase) {
      const resultado = extrairResultados().find(function (item) { return item.id === frase.resultadoId; });
      const item = elemento('article', 'smt-retorno-item');
      const aplicar = elemento('button', 'smt-retorno-aplicar');
      aplicar.type = 'button';
      aplicar.title = 'Aplicar a frase, selecionar o resultado e registrar o contato no CRM.';
      aplicar.appendChild(elemento('span', 'smt-retorno-item-titulo', frase.rotulo));
      aplicar.appendChild(elemento('span', 'smt-retorno-item-resultado', resultado ? resultado.rotulo : 'Resultado não disponível no CRM'));
      aplicar.appendChild(elemento('span', 'smt-retorno-item-texto', frase.observacao));
      aplicar.addEventListener('click', function () { aplicarFrase(frase); });
      const acoes = elemento('div', 'smt-retorno-acoes');
      const editar = elemento('button', 'smt-retorno-btn smt-retorno-editar', 'Editar');
      editar.type = 'button';
      editar.addEventListener('click', function () { mostrarFormulario(frase); });
      const excluir = elemento('button', 'smt-retorno-btn smt-retorno-btn-perigo', 'Excluir');
      excluir.type = 'button';
      excluir.addEventListener('click', function () {
        const restantes = lerFrases().filter(function (itemSalvo) { return itemSalvo.id !== frase.id; });
        if (gravarFrases(restantes)) {
          renderizarLista();
          avisar('Frase excluída.');
        }
      });
      acoes.append(editar, excluir);
      item.append(aplicar, acoes);
      listaFrases.appendChild(item);
    });
  }

  function salvarFrase(evento) {
    evento.preventDefault();
    const rotulo = campoNome.value.trim();
    const resultadoId = campoResultado.value;
    const observacao = campoObservacao.value.trim();
    if (!rotulo || !resultadoId || !observacao) {
      avisar('Preencha o nome, o resultado e a observação da frase.');
      return;
    }
    const resultados = extrairResultados();
    if (!resultados.some(function (resultado) { return resultado.id === resultadoId; })) {
      avisar('O resultado escolhido não está mais disponível no CRM. Selecione outro.');
      return;
    }
    const atuais = lerFrases();
    let novos;
    if (idEmEdicao) {
      if (!atuais.some(function (item) { return item.id === idEmEdicao; })) {
        avisar('Esta frase não existe mais no armazenamento. Feche e tente novamente.');
        return;
      }
      novos = atuais.map(function (item) {
        if (item.id !== idEmEdicao) return item;
        return { id: item.id, rotulo: rotulo, resultadoId: resultadoId, observacao: observacao };
      });
    } else {
      novos = atuais.concat([{ id: gerarId(), rotulo: rotulo, resultadoId: resultadoId, observacao: observacao }]);
    }
    if (!gravarFrases(novos)) return;
    renderizarLista();
    cancelarFormulario();
    avisar('Frase salva neste navegador.');
  }

  function fecharPainel(devolverFoco) {
    if (!dialogo) return;
    document.removeEventListener('keydown', aoTeclar);
    dialogo.remove();
    dialogo = null;
    listaFrases = null;
    caixaFormulario = null;
    formulario = null;
    campoNome = null;
    campoResultado = null;
    campoObservacao = null;
    botaoSalvarFrase = null;
    idEmEdicao = null;
    const botao = document.getElementById(ID_BOTAO);
    if (devolverFoco && botao && typeof botao.focus === 'function') {
      try { botao.focus({ preventScroll: true }); } catch (erro) { botao.focus(); }
    }
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      fecharPainel(true);
    }
  }

  function montarPainel() {
    instalarEstilos();
    const util = window.__smartTableUtil;
    util?.fecharOutrosPaineis?.('retornoRapido');

    const topo = typeof util?.alturaCabecalho === 'function' ? util.alturaCabecalho() : 0;
    const esquerda = typeof util?.margemMenuLateral === 'function' ? util.margemMenuLateral() : 0;
    const fundo = elemento('div', 'smt-retorno-overlay');
    fundo.id = ID_DIALOGO;
    Object.assign(fundo.style, {
      top: topo + 'px',
      left: esquerda + 'px',
      right: '0',
      bottom: '0',
      zIndex: String(util?.Z_INDEX_POPUP || 99999)
    });
    fundo.addEventListener('mousedown', function (evento) {
      if (evento.target === fundo) fecharPainel(true);
    });

    const painel = elemento('section', 'smt-retorno-dialog');
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-modal', 'true');
    painel.setAttribute('aria-labelledby', 'smt-retorno-titulo');
    const cabecalho = elemento('div', 'smt-retorno-header');
    const titulo = elemento('h2', '', 'Retorno rápido');
    titulo.id = 'smt-retorno-titulo';
    cabecalho.appendChild(titulo);
    const fechar = elemento('button', 'smt-retorno-btn', 'Fechar');
    fechar.type = 'button';
    fechar.addEventListener('click', function () { fecharPainel(true); });
    cabecalho.appendChild(fechar);
    painel.appendChild(cabecalho);
    painel.appendChild(elemento('p', 'smt-retorno-descricao', 'Escolha uma frase para registrar o contato ou crie e reutilize suas próprias frases.'));

    const toolbar = elemento('div', 'smt-retorno-toolbar');
    toolbar.appendChild(elemento('span', '', 'Frases salvas'));
    const nova = elemento('button', 'smt-retorno-btn smt-retorno-btn-principal', 'Criar nova frase');
    nova.type = 'button';
    nova.id = 'smt-retorno-nova';
    nova.addEventListener('click', function () { mostrarFormulario(null); });
    toolbar.appendChild(nova);
    painel.appendChild(toolbar);

    listaFrases = elemento('div', 'smt-retorno-frases');
    listaFrases.setAttribute('aria-label', 'Frases salvas');
    painel.appendChild(listaFrases);

    caixaFormulario = elemento('div', 'smt-retorno-form-wrap');
    caixaFormulario.hidden = true;
    caixaFormulario.appendChild(elemento('h3', 'smt-retorno-form-titulo', 'Cadastrar frase'));
    formulario = elemento('form', '');
    formulario.id = 'smt-retorno-form';

    const nomeLabel = elemento('label', 'smt-retorno-campo');
    nomeLabel.appendChild(elemento('span', 'smt-retorno-label', 'Nome da frase / atalho'));
    campoNome = elemento('input', 'smt-retorno-input');
    campoNome.id = 'smt-retorno-nome';
    campoNome.name = 'rotulo';
    campoNome.type = 'text';
    campoNome.maxLength = 80;
    campoNome.required = true;
    nomeLabel.appendChild(campoNome);
    formulario.appendChild(nomeLabel);

    const resultadoLabel = elemento('label', 'smt-retorno-campo');
    resultadoLabel.appendChild(elemento('span', 'smt-retorno-label', 'Resultado do contato no CRM'));
    campoResultado = elemento('select', 'smt-retorno-select');
    campoResultado.id = 'smt-retorno-resultado';
    campoResultado.name = 'resultadoId';
    campoResultado.required = true;
    resultadoLabel.appendChild(campoResultado);
    formulario.appendChild(resultadoLabel);

    const observacaoLabel = elemento('label', 'smt-retorno-campo');
    observacaoLabel.appendChild(elemento('span', 'smt-retorno-label', 'Frase que será registrada na observação'));
    campoObservacao = elemento('textarea', 'smt-retorno-textarea');
    campoObservacao.id = 'smt-retorno-observacao';
    campoObservacao.name = 'observacao';
    campoObservacao.rows = 3;
    campoObservacao.maxLength = 2000;
    campoObservacao.required = true;
    observacaoLabel.appendChild(campoObservacao);
    formulario.appendChild(observacaoLabel);

    const acoesFormulario = elemento('div', 'smt-retorno-form-acoes');
    const cancelar = elemento('button', 'smt-retorno-btn', 'Cancelar');
    cancelar.type = 'button';
    cancelar.id = 'smt-retorno-cancelar';
    cancelar.addEventListener('click', cancelarFormulario);
    botaoSalvarFrase = elemento('button', 'smt-retorno-btn smt-retorno-btn-principal', 'Salvar frase');
    botaoSalvarFrase.type = 'submit';
    botaoSalvarFrase.id = 'smt-retorno-salvar';
    acoesFormulario.append(cancelar, botaoSalvarFrase);
    formulario.appendChild(acoesFormulario);
    formulario.addEventListener('submit', salvarFrase);
    caixaFormulario.appendChild(formulario);
    painel.appendChild(caixaFormulario);
    fundo.appendChild(painel);
    document.body.appendChild(fundo);
    dialogo = fundo;
    renderizarLista();
    document.addEventListener('keydown', aoTeclar);
    fechar.focus();
  }

  function abrirPainel() {
    if (!dialogo) montarPainel();
    else renderizarLista();
  }

  function aplicarFrase(frase) {
    if (registroEmAndamento) {
      avisar('Já há um registro em andamento. Aguarde a resposta do CRM.');
      return;
    }
    const botaoResultado = document.getElementById(PREFIXO_RESULTADO + frase.resultadoId);
    const observacao = document.getElementById('contato-resumo');
    const botaoSalvar = document.getElementById('btn-salvar-contato');
    const formContato = document.getElementById('form-contato');
    if (!botaoResultado || !observacao || !botaoSalvar || !formContato) {
      avisar('Não encontrei todos os campos do contato no CRM. Nenhum registro foi enviado.');
      return;
    }

    registroEmAndamento = true;
    try {
      botaoResultado.click();
      observacao.value = frase.observacao;
      observacao.dispatchEvent(new window.Event('input', { bubbles: true }));
      observacao.dispatchEvent(new window.Event('change', { bubbles: true }));
    } catch (erro) {
      registroEmAndamento = false;
      avisar('Não consegui preparar o contato no CRM. Nenhum registro foi enviado.');
      return;
    }

    fecharPainel(false);
    window.setTimeout(function () {
      if (!botaoSalvar.isConnected || botaoSalvar.disabled) {
        registroEmAndamento = false;
        avisar('O CRM não liberou o botão Salvar Contato. Confira o resultado e a observação antes de registrar.');
        return;
      }
      botaoSalvar.click();
      avisar('O registro foi enviado pelo botão nativo do CRM; confira a confirmação exibida pelo próprio sistema.');
      window.setTimeout(function () { registroEmAndamento = false; }, 5000);
    }, 0);
  }

  function criarBotaoRetorno() {
    if (document.getElementById(ID_BOTAO)) return true;
    const atencao = document.getElementById('btn-resultado-ATENCAO');
    if (!atencao || !atencao.parentElement) return false;
    const botao = elemento('button', 'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 text-xs font-medium text-left transition hover:border-yellow-400 hover:bg-yellow-50', 'Retorno');
    botao.id = ID_BOTAO;
    botao.type = 'button';
    botao.title = 'Abrir frases de retorno rápido e registrar contato no CRM.';
    botao.addEventListener('click', abrirPainel);
    atencao.parentElement.insertBefore(botao, atencao.nextSibling);
    return true;
  }

  function instalar() {
    if (!document.body) {
      window.setTimeout(instalar, 100);
      return;
    }
    criarBotaoRetorno();
    if (observador) return;
    observador = new MutationObserver(function () { criarBotaoRetorno(); });
    observador.observe(document.body, { childList: true, subtree: true });
  }

  window.__smartTableUtil?.registrarPainel?.('retornoRapido', function () { fecharPainel(false); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalar);
  } else {
    instalar();
  }
})();