/* =========================================================================
 * MÓDULO 34: RETORNO RÁPIDO — CRM TexCotton
 * -------------------------------------------------------------------------
 * Frases reutilizáveis por operador, guardadas no localStorage deste navegador.
 * Cada frase associa um nome, um resultado nativo e uma observação. No perfil,
 * os atalhos fixados inserem apenas a observação no Registro Rápido; o operador
 * confirma o resultado e salva explicitamente. O painel Retorno mantém o fluxo
 * de gestão e aplicação de frases já existente.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__retornoRapidoCarregado) return;
  window.__retornoRapidoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Retorno Rápido');

  const ID_BOTAO = 'smarttable-retorno-abrir';
  const ID_DIALOGO = 'smarttable-retorno-dialogo';
  const ID_ESTILOS = 'smarttable-retorno-estilos';
  const ID_LAYOUT_PERFIL = 'smarttable-retorno-layout';
  const ID_COLUNA_ESQUERDA = 'smarttable-retorno-coluna-esquerda';
  const ID_COLUNA_DIREITA = 'smarttable-retorno-coluna-direita';
  const ID_FIXADAS = 'smarttable-retorno-fixadas';
  const ID_REGISTRO_RAPIDO = 'smarttable-retorno-registro-rapido';
  const ID_ATALHOS_LINHA = 'smarttable-retorno-atalhos-linha';
  const ID_LISTA_FIXADAS = 'smarttable-retorno-fixadas-lista';
  const POR_PAGINA = 5;
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
  let paginaFixadas = 0;
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

  function valorCSSNumerico(estilo, propriedade) {
    const valor = Number.parseFloat(estilo?.getPropertyValue?.(propriedade) || estilo?.[propriedade] || '0');
    return Number.isFinite(valor) ? valor : 0;
  }

  function definirVariavelCSS(elementoAlvo, nome, valor) {
    const atual = elementoAlvo.style.getPropertyValue(nome);
    if (valor == null) {
      if (atual) elementoAlvo.style.removeProperty(nome);
      return;
    }
    if (atual !== valor) elementoAlvo.style.setProperty(nome, valor);
  }

  function contemNavegacaoLateral(elementoAlvo) {
    const seletor = 'aside, [role="navigation"], [class*="sidebar"], [id*="sidebar"]';
    return elementoAlvo.matches?.(seletor) || !!elementoAlvo.querySelector?.(seletor);
  }

  function existeCorteHorizontalEntre(elementoAlvo, ancestralAlvo) {
    let atual = elementoAlvo.parentElement;
    while (atual && atual !== ancestralAlvo) {
      const overflow = window.getComputedStyle(atual).overflowX;
      if (overflow === 'hidden' || overflow === 'clip' || overflow === 'auto' || overflow === 'scroll') return true;
      atual = atual.parentElement;
    }
    return atual !== ancestralAlvo;
  }

  function localizarAreaPrincipal(cartao, larguraBase) {
    const larguraViewport = document.documentElement.clientWidth || window.innerWidth || 0;
    let melhor = null;
    for (let ancestral = cartao.parentElement;
      ancestral && ancestral !== document.body && ancestral !== document.documentElement;
      ancestral = ancestral.parentElement) {
      const caixa = ancestral.getBoundingClientRect();
      if (!Number.isFinite(caixa.width) || caixa.width <= larguraBase + 80) continue;
      // Não usar o shell da aplicação/viewport inteira: ele pode incluir a sidebar.
      if (larguraViewport && caixa.width >= larguraViewport - 16) continue;
      if (contemNavegacaoLateral(ancestral)) continue;
      if (existeCorteHorizontalEntre(cartao, ancestral)) continue;
      if (!melhor || caixa.width > melhor.caixa.width) melhor = { elemento: ancestral, caixa: caixa };
    }
    return melhor;
  }

  function ajustarLarguraCartao(cartao) {
    const pai = cartao?.parentElement;
    if (!pai) return false;
    const caixaPai = pai.getBoundingClientRect();
    const larguraBase = caixaPai.width;
    const larguraViewport = document.documentElement.clientWidth || window.innerWidth || 0;
    if (!(larguraBase > 0) || !(larguraViewport > 0)) {
      definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', null);
      definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', null);
      return false;
    }

    const area = localizarAreaPrincipal(cartao, larguraBase);
    if (!area) {
      definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', null);
      definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', null);
      return false;
    }

    const estiloArea = window.getComputedStyle(area.elemento);
    const esquerdaArea = area.caixa.left +
      valorCSSNumerico(estiloArea, 'border-left-width') +
      valorCSSNumerico(estiloArea, 'padding-left');
    const direitaArea = area.caixa.right -
      valorCSSNumerico(estiloArea, 'border-right-width') -
      valorCSSNumerico(estiloArea, 'padding-right');
    const larguraUtil = direitaArea - esquerdaArea;
    if (!(larguraUtil > larguraBase + 32)) {
      definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', null);
      definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', null);
      return false;
    }

    // Usa a caixa útil do conteúdo (não a viewport completa), deixando 24 px
    // em cada lado e respeitando o limite de desenho de 1180 px.
    let larguraFinal = Math.min(1180, larguraUtil - 48, larguraViewport - 48);
    if (!(larguraFinal > larguraBase + 16)) {
      definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', null);
      definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', null);
      return false;
    }
    let esquerdaFinal = esquerdaArea + (larguraUtil - larguraFinal) / 2;
    esquerdaFinal = Math.max(24, Math.min(esquerdaFinal, larguraViewport - 24 - larguraFinal));
    larguraFinal = Math.min(larguraFinal, direitaArea - 24 - esquerdaFinal, larguraViewport - 24 - esquerdaFinal);
    if (!(larguraFinal > 0)) {
      definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', null);
      definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', null);
      return false;
    }

    const estiloPai = window.getComputedStyle(pai);
    const inicioPai = caixaPai.left +
      valorCSSNumerico(estiloPai, 'border-left-width') +
      valorCSSNumerico(estiloPai, 'padding-left');
    const larguraFormatada = (Math.round(larguraFinal * 100) / 100) + 'px';
    const deslocamentoFormatado = (Math.round((esquerdaFinal - inicioPai) * 100) / 100) + 'px';
    definirVariavelCSS(cartao, '--smt-retorno-cartao-largura', larguraFormatada);
    definirVariavelCSS(cartao, '--smt-retorno-cartao-deslocamento', deslocamentoFormatado);
    return true;
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
      '[data-smt-retorno-cartao="true"]{width:var(--smt-retorno-cartao-largura,100%)!important;max-width:none!important;margin:0 0 16px!important;margin-left:var(--smt-retorno-cartao-deslocamento,0px)!important;position:static!important;left:auto!important;transform:none!important;padding:14px 18px 16px!important;background:#fff!important;border:1px solid #e2e5ea!important;border-radius:10px!important;box-shadow:none!important;box-sizing:border-box!important;color:#1b2330!important;}',
      '[data-smt-retorno-resumo="true"]{display:grid!important;grid-template-columns:minmax(220px,300px) minmax(0,1fr)!important;gap:16px!important;align-items:start!important;padding-bottom:14px!important;}',
      '[data-smt-retorno-identificacao="true"] h2{margin:0!important;font-size:17px!important;line-height:1.25!important;font-weight:650!important;color:#1b2330!important;}',
      '[data-smt-retorno-identificacao="true"] p{margin:5px 0 0!important;font-size:12px!important;line-height:1.45!important;color:#556072!important;}',
      '[data-smt-retorno-kpis="true"]{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;gap:6px!important;margin:0!important;}',
      '[data-smt-retorno-kpis="true"]>div{min-width:0;padding:6px 8px!important;border:1px solid #e2e5ea!important;border-radius:7px!important;background:#fff!important;text-align:center!important;}',
      '[data-smt-retorno-kpis="true"]>div>p:first-child{margin:0!important;font-size:11px!important;font-weight:500!important;line-height:1.25!important;color:#556072!important;}',
      '[data-smt-retorno-kpis="true"]>div>p:last-child{margin:2px 0 0!important;font-size:14px!important;font-weight:650!important;font-variant-numeric:tabular-nums;color:#1b2330!important;}',
      '[data-smt-retorno-kpi="alerta"]{background:#fdecea!important;border-color:#f2b8b2!important;}[data-smt-retorno-kpi="alerta"]>p{color:#8c1d14!important;}[data-smt-retorno-kpi="alerta"]>p:last-child{font-size:16px!important;color:#b42318!important;}',
      '[data-smt-retorno-kpi="zero"]{background:#f7f8fa!important;}[data-smt-retorno-kpi="zero"]>p:last-child{color:#7b8596!important;font-weight:500!important;}',
      '[data-smt-retorno-kpi="aviso"]{background:#fff4dc!important;border-color:#f0d48f!important;}[data-smt-retorno-kpi="aviso"]>p{color:#8a5a00!important;}[data-smt-retorno-kpi="aviso"]>p:last-child{font-size:16px!important;color:#8a5a00!important;}',
      '[data-smt-retorno-contato="true"]{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(320px,380px)!important;gap:14px!important;margin:0!important;padding:14px 0 0!important;border-top:1px solid #e2e5ea!important;}',
      '[data-smt-retorno-contato="true"]>[data-smt-retorno-cabecalho="true"]{grid-column:1;grid-row:1;display:flex!important;align-items:center!important;justify-content:space-between!important;flex-wrap:wrap!important;gap:8px!important;margin:0 0 4px!important;padding:0!important;}',
      '[data-smt-retorno-contato="true"]>[data-smt-retorno-cabecalho="true"] h3{font-size:13px!important;letter-spacing:0!important;text-transform:none!important;color:#1b2330!important;}',
      '[data-smt-retorno-contato="true"]>#smarttable-retorno-layout{grid-column:2;grid-row:1/3;display:block!important;min-width:0!important;}',
      '[data-smt-retorno-contato="true"]>#perfil-restante{grid-column:1;grid-row:2;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0 14px!important;margin:0!important;padding:0!important;border:0!important;}',
      '[data-smt-retorno-coluna-esquerda]{display:none!important;}',
      '#smarttable-retorno-coluna-direita{display:block!important;width:100%!important;min-width:0!important;}',
      '#smarttable-retorno-atalhos-linha{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:12px;}',
      '#smarttable-retorno-registro-rapido{padding:12px 14px;border:1px solid #e2e5ea;border-radius:8px;background:#f7f8fa;}',
      '.smt-retorno-rapido-titulo{font-size:13px;letter-spacing:0;text-transform:none;color:#1b2330;}',
      '.smt-retorno-rapido-label{display:block;margin:0 0 4px;font-size:12px;font-weight:600;color:#1b2330;}',
      '.smt-retorno-rapido-ajuda{font-size:11px;font-weight:400;color:#556072;}',
      '.smt-retorno-rapido-frase{min-height:84px;resize:vertical;}',
      '#smarttable-retorno-fixadas{align-content:start;padding:12px 14px;border:1px solid #e2e5ea;border-radius:8px;background:#fff;}',
      '.smt-retorno-fixadas-ajuda{margin-left:auto;font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;color:#556072;}',
      '[data-smt-retorno-cabecalho="true"]{display:block!important;margin:0 0 18px!important;padding:0!important;border:0!important;}',
      '[data-smt-retorno-cabecalho="true"] h3{margin:0!important;font-family:inherit!important;font-size:11px!important;font-weight:600!important;letter-spacing:.07em!important;text-transform:uppercase!important;color:#8a919e!important;line-height:1.45!important;}',
      '#smarttable-retorno-layout{display:flex;width:100%;min-width:0;box-sizing:border-box;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:20px 40px;margin:0;}',
      '#smarttable-retorno-coluna-esquerda{display:flex;flex:1 1 240px;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;}',
      '#smarttable-retorno-coluna-esquerda > button{font-family:inherit!important;font-size:12.5px!important;font-weight:500!important;color:#3d434e!important;cursor:pointer!important;height:32px!important;padding:0 12px!important;display:inline-flex!important;align-items:center!important;gap:8px!important;background:#fff!important;border:1px solid #d3d7de!important;border-radius:8px!important;transition:background .15s,border-color .15s,color .15s;white-space:nowrap;}',
      '#smarttable-retorno-coluna-esquerda > button:not(#smarttable-botao-alerta-cliente):hover{background:#f7f8fa!important;border-color:#8a919e!important;color:#13161c!important;}',
      '#smarttable-retorno-coluna-esquerda > #smarttable-botao-alerta-cliente{font-family:inherit!important;font-size:12.5px!important;font-weight:500!important;cursor:pointer!important;height:32px!important;padding:0 12px!important;display:inline-flex!important;align-items:center!important;gap:8px!important;border-radius:8px!important;white-space:nowrap;}',
      '#smarttable-retorno-coluna-direita{width:min(460px,100%);display:grid;gap:12px;justify-items:end;align-content:start;min-width:0;}',
      '#smarttable-retorno-abrir{align-self:auto;margin:0!important;height:32px!important;padding:0 12px!important;display:inline-flex!important;align-items:center!important;gap:8px!important;font-family:inherit!important;font-size:12.5px!important;font-weight:500!important;color:#3d434e!important;cursor:pointer!important;background:#fff!important;border:1px solid #d3d7de!important;border-radius:8px!important;white-space:nowrap;line-height:1.2;}',
      '#smarttable-retorno-abrir:hover{background:#f7f8fa!important;border-color:#8a919e!important;color:#13161c!important;}',
      '#smarttable-retorno-abrir svg{width:14px;height:14px;flex:none;}',
      '#smarttable-retorno-fixadas{width:100%;display:grid;gap:6px;min-width:0;margin:0;}',
      '#smarttable-retorno-fixadas[hidden]{display:none!important;}',
      '.smt-retorno-fixadas-cabecalho{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:16px;margin:0 0 2px;}',
      '.smt-retorno-fixadas-titulacao{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#8a919e;}',
      '.smt-retorno-fixadas-titulacao svg{width:14px;height:14px;}',
      '.smt-retorno-fixadas-titulo{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#8a919e;}',
      '.smt-retorno-fixadas-contador{min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:#edf2ff;color:#2f5bea;display:inline-grid;place-items:center;font-size:11px;font-weight:600;letter-spacing:0;}',
      '#smarttable-retorno-paginacao{display:flex;align-items:center;justify-content:flex-end;gap:3px;flex:0 0 auto;}',
      '.smt-retorno-pagina{min-width:24px;height:24px;padding:0 5px!important;font-size:14px!important;line-height:1!important;border-radius:6px!important;}',
      '.smt-retorno-pagina:disabled{opacity:.35;cursor:default;}',
      '.smt-retorno-pagina-texto{font-size:10px;color:#8a919e;white-space:nowrap;}',
      '#smarttable-retorno-fixadas-lista{display:grid;grid-template-columns:minmax(0,1fr);align-items:stretch;gap:6px;width:100%;min-width:0;}',
      '#smarttable-retorno-atalhos-linha{width:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:18px;min-width:0;}',
      '#smarttable-retorno-registro-rapido{display:grid;gap:7px;min-width:0;padding:11px;border:1px solid #e6e8ec;border-radius:9px;background:#f9fafb;}',
      '.smt-retorno-rapido-titulo{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#667085;}',
      '.smt-retorno-rapido-campo{width:100%;min-width:0;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:6px;background:#fff;color:#344054;padding:7px 8px;font-family:inherit;font-size:12px;}',
      '#smarttable-retorno-registro-rapido textarea{min-height:62px;resize:vertical;}',
      '#smarttable-retorno-registro-rapido button{justify-self:start;border:1px solid #1f5f8b;background:#1f5f8b;color:#fff;border-radius:7px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer;}',
      '#smarttable-retorno-registro-rapido button:disabled{opacity:.5;cursor:default;}',
      '@media(max-width:760px){#smarttable-retorno-atalhos-linha{grid-template-columns:minmax(0,1fr);}}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-atalhos-linha{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:12px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido{padding:12px 14px;border:1px solid #e2e5ea;border-radius:8px;background:#f7f8fa;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-titulo{font-size:13px;letter-spacing:0;text-transform:none;color:#1b2330;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-label{display:block;margin:0 0 4px;font-size:12px;font-weight:600;color:#1b2330;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-ajuda{font-size:11px;font-weight:400;color:#556072;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido textarea{min-height:84px;resize:vertical;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-acoes{display:flex;justify-content:flex-end;align-items:center;gap:8px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido select:focus-visible,#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido textarea:focus-visible,#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-atalho-fixado:focus-visible{outline:3px solid #7fb2d6;outline-offset:2px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas{align-content:start;justify-items:stretch;padding:12px 14px;border:1px solid #e2e5ea;border-radius:8px;background:#fff;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-fixadas-ajuda{margin-left:auto;font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;color:#556072;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas-lista{grid-template-columns:minmax(0,1fr);}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-sem-fixadas{margin:0;padding:9px;border:1px dashed #e2e5ea;border-radius:7px;color:#556072;font-size:12px;}',
      '@media(max-width:760px){#smarttable-retorno-coluna-direita #smarttable-retorno-atalhos-linha{grid-template-columns:minmax(0,1fr);}}',
      '.smt-retorno-fixar{min-width:34px;display:inline-flex;align-items:center;justify-content:center;}',
      '.smt-retorno-fixar[aria-pressed="true"]{border-color:#d6a243;background:#fff8e7;color:#805b15;}',
      '.smt-retorno-fixar svg{width:14px;height:14px;display:block;}',
      '.smt-retorno-atalho-fixado{width:100%!important;min-width:0;box-sizing:border-box;display:flex!important;align-items:center;gap:7px;padding:7px 9px!important;min-height:36px;height:auto;white-space:normal!important;text-align:left!important;line-height:1.3!important;background:#fff!important;border:1px solid #e2e5ea!important;border-radius:7px!important;color:#1b2330!important;font-family:inherit!important;font-size:12px!important;font-weight:500!important;cursor:pointer;transition:background .15s,border-color .15s,color .15s;}',
      '.smt-retorno-atalho-fixado:hover,.smt-retorno-atalho-fixado:focus-visible{background:#f7f8fa!important;border-color:#d3d7de!important;color:#13161c!important;outline:none;}',
      '.smt-retorno-atalho-texto{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;color:inherit;}',
      '.smt-retorno-atalho-chevron{flex:0 0 auto;width:14px;height:14px;display:flex;align-items:center;justify-content:center;color:#d3d7de;transition:transform .15s,color .15s;font-size:18px;line-height:1;}',
      '.smt-retorno-atalho-fixado:hover .smt-retorno-atalho-chevron{color:#8a919e;transform:translateX(2px);}',
      '.smt-retorno-pin-wrap{width:14px;height:14px;flex:0 0 14px;display:inline-flex;align-items:center;justify-content:center;color:#2f5bea;}',
      '.smt-retorno-pin-icone{width:14px;height:14px;flex:0 0 auto;}',
      '[data-smt-retorno-grade="true"]{margin:26px 0 0!important;padding:22px 0 0!important;border-top:1px solid #e6e8ec!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:24px 28px!important;}',
      '[data-smt-retorno-grade="true"] > div{min-width:0;}',
      '[data-smt-retorno-grade="true"] > div > p:first-child{margin:0 0 6px!important;font-size:10.5px!important;font-weight:600!important;letter-spacing:.07em!important;text-transform:uppercase!important;color:#8a919e!important;line-height:1.4!important;}',
      '[data-smt-retorno-grade="true"] > div > p:not(:first-child){margin:0!important;min-height:30px;display:flex;align-items:center;gap:6px;min-width:0;font-size:14px!important;font-weight:500!important;color:#13161c!important;line-height:1.45!important;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-valor-linha{display:flex;align-items:center;gap:6px;min-height:30px;min-width:0;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-valor{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0!important;font-size:14px!important;font-weight:500!important;color:#13161c!important;line-height:1.45!important;}',
      '[data-smt-retorno-grade="true"] .text-gray-400.italic{color:#8a919e!important;font-style:italic!important;font-weight:400!important;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-dado-acoes{display:flex;align-items:center;gap:2px;flex:0 0 auto;opacity:0;transition:opacity .15s;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-dado:hover .smt-retorno-dado-acoes,[data-smt-retorno-grade="true"] .smt-retorno-dado:focus-within .smt-retorno-dado-acoes{opacity:1;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-dado-acoes.smt-retorno-cadastrar-wrap{opacity:1;}',
      '.smt-retorno-icone-acao{width:28px;height:28px;display:inline-grid;place-items:center;color:#8a919e;background:none;border:0;border-radius:7px;padding:0;cursor:pointer;text-decoration:none;transition:background .15s,color .15s;}',
      '.smt-retorno-icone-acao:hover{background:#edf2ff;color:#2f5bea;}',
      '.smt-retorno-icone-acao:focus-visible,.smt-retorno-cadastrar:focus-visible{outline:2px solid #2f5bea;outline-offset:2px;}',
      '.smt-retorno-icone-acao svg{width:14px;height:14px;flex:none;}',
      '.smt-retorno-cadastrar{font:inherit!important;font-size:12px!important;font-weight:500!important;color:#2f5bea!important;background:none!important;border:0!important;padding:3px 6px!important;border-radius:6px!important;cursor:pointer;white-space:nowrap;}',
      '.smt-retorno-cadastrar:hover{background:#edf2ff!important;}',
      '.smt-retorno-who{display:flex;align-items:center;gap:9px;min-height:30px;min-width:0;}',
      '.smt-retorno-av{width:24px;height:24px;border-radius:50%;background:#edf2ff;color:#2f5bea;display:grid;place-items:center;font-size:11px;font-weight:600;flex:none;}',
      '.smt-retorno-who-text{display:flex;flex-direction:column;gap:2px;min-width:0;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-negociador-nome{margin:0!important;min-height:0!important;display:block!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px!important;font-weight:500!important;color:#13161c!important;line-height:1.2!important;}',
      '[data-smt-retorno-grade="true"] .smt-retorno-negociador-codigo{margin:0!important;min-height:0!important;display:block!important;font-size:11.5px!important;color:#8a919e!important;line-height:1.2!important;}',
      '@media(max-width:1000px){[data-smt-retorno-grade="true"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;}}',
      '@media(max-width:1100px){[data-smt-retorno-resumo="true"]{grid-template-columns:minmax(0,1fr)!important;}[data-smt-retorno-kpis="true"]{grid-template-columns:repeat(4,minmax(0,1fr))!important;}[data-smt-retorno-contato="true"]{grid-template-columns:minmax(0,1fr)!important;}[data-smt-retorno-contato="true"]>[data-smt-retorno-cabecalho="true"],[data-smt-retorno-contato="true"]>#smarttable-retorno-layout,[data-smt-retorno-contato="true"]>#perfil-restante{grid-column:1;grid-row:auto;}}',
      '@media(max-width:760px){#smarttable-retorno-atalhos-linha{grid-template-columns:minmax(0,1fr);}[data-smt-retorno-kpis="true"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;}[data-smt-retorno-contato="true"]>#perfil-restante{grid-template-columns:minmax(0,1fr)!important;}[data-smt-retorno-cartao="true"]{padding:14px 12px 16px!important;}}',
      '@media(hover:none){[data-smt-retorno-grade="true"] .smt-retorno-dado-acoes{opacity:1;}}',
      '@media(prefers-reduced-motion:reduce){[data-smt-retorno-cartao="true"] *{transition:none!important;}}',
      '.smt-retorno-form-wrap{border-top:1px solid #e4e7ec;margin-top:14px;padding-top:14px;}',
      '.smt-retorno-form-titulo{font-size:14px;font-weight:700;color:#16232f;margin:0 0 12px;}',
      '.smt-retorno-campo{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}',
      '.smt-retorno-label{font-size:12px;font-weight:600;color:#344054;}',
      '.smt-retorno-input,.smt-retorno-select,.smt-retorno-textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:8px;padding:9px 10px;font:inherit;font-size:13px;color:#344054;background:#fff;}',
      '.smt-retorno-textarea{resize:vertical;min-height:86px;}',
      '.smt-retorno-form-acoes{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;}',
      '.smt-retorno-form-wrap[hidden]{display:none!important;}',
      '@media(max-width:520px){.smt-retorno-dialog{padding:14px;max-height:90vh;}.smt-retorno-item{grid-template-columns:1fr;}.smt-retorno-acoes{flex-direction:row;justify-content:flex-end;}.smt-retorno-toolbar{align-items:flex-start;flex-direction:column;}}',
      /* Registro Rápido e frases fixadas compartilham o mesmo painel. */
      '#smarttable-retorno-coluna-direita{width:100%!important;max-width:none!important;display:block!important;min-width:0!important;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-atalhos-linha{display:block!important;width:100%;min-width:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-content:start;width:100%;min-width:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 2px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-resultado-linha{display:grid;grid-template-columns:62px minmax(0,1fr);align-items:center;gap:8px;min-width:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-resultado-linha label{margin:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-resultado-linha select{min-width:0;margin:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-acoes{display:flex;justify-content:flex-end;align-items:center;gap:8px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas{display:grid!important;gap:6px;align-content:start;justify-items:stretch;width:100%;min-width:0;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;margin:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-fixadas-cabecalho{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;min-height:0;margin:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-fixadas-titulacao{display:flex;align-items:center;gap:5px;min-width:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas .smt-retorno-fixadas-ajuda{display:none;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas-lista{display:flex!important;flex-wrap:wrap;align-items:flex-start;justify-content:flex-start;gap:6px;width:100%;min-width:0;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-fixadas-lista .smt-retorno-sem-fixadas{flex:1 1 100%;margin:0;padding:8px;border:1px dashed #e2e5ea;border-radius:7px;color:#556072;font-size:12px;}',
      '#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido textarea{min-height:56px;resize:vertical;}',
      '.smt-retorno-atalho-fixado{display:inline-flex!important;align-items:center;flex:0 1 auto;width:auto!important;max-width:100%;min-width:0;min-height:28px;height:auto;padding:5px 8px!important;white-space:normal!important;text-align:left!important;line-height:1.3!important;background:#fff!important;border:1px solid #e2e5ea!important;border-radius:999px!important;color:#1b2330!important;font-family:inherit!important;font-size:12px!important;font-weight:500!important;cursor:pointer;}',
      '.smt-retorno-chip-mais{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:13px;height:13px;color:#1f5f8b;font-size:16px;line-height:1;}',
      '.smt-retorno-atalho-texto{display:block;max-width:250px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;color:inherit;}',
      '.smt-retorno-atalho-fixado:hover,.smt-retorno-atalho-fixado:focus-visible{background:#e8f1f8!important;border-color:#1f5f8b!important;color:#1b2330!important;outline:none;}',
      '#smarttable-retorno-abrir{font-size:12px!important;height:28px!important;min-height:28px!important;padding:0 8px!important;}',
      '@media(max-width:1100px){[data-smt-retorno-contato="true"]>[data-smt-retorno-cabecalho="true"]{grid-column:1;grid-row:1;}[data-smt-retorno-contato="true"]>#perfil-restante{grid-column:1;grid-row:2;}[data-smt-retorno-contato="true"]>#smarttable-retorno-layout{grid-column:1;grid-row:3;}}',
      '@media(max-width:760px){#smarttable-retorno-coluna-direita #smarttable-retorno-registro-rapido .smt-retorno-rapido-resultado-linha{grid-template-columns:minmax(0,1fr);gap:4px;}}',
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

  function iconeAlfinete() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('smt-retorno-pin-icone');
    const corpo = document.createElementNS(ns, 'path');
    corpo.setAttribute('d', 'm16 3 5 5-5 1-4 5v3l-2 2v-5l-5-5 4-1 5-5z');
    const haste = document.createElementNS(ns, 'path');
    haste.setAttribute('d', 'M2 22 9 15');
    svg.append(corpo, haste);
    return svg;
  }

  function iconeDaInterface(tipo, classe) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (classe) svg.classList.add(classe);

    if (tipo === 'retorno') {
      const caminho = document.createElementNS(ns, 'path');
      caminho.setAttribute('d', 'M9 14 4 9l5-5M4 9h10a6 6 0 1 1 0 12h-3');
      svg.appendChild(caminho);
    } else if (tipo === 'copiar') {
      const retangulo = document.createElementNS(ns, 'rect');
      retangulo.setAttribute('x', '9');
      retangulo.setAttribute('y', '9');
      retangulo.setAttribute('width', '11');
      retangulo.setAttribute('height', '11');
      retangulo.setAttribute('rx', '2');
      const caminho = document.createElementNS(ns, 'path');
      caminho.setAttribute('d', 'M5 15V6a2 2 0 0 1 2-2h9');
      svg.append(retangulo, caminho);
    } else if (tipo === 'whatsapp') {
      const contorno = document.createElementNS(ns, 'path');
      contorno.setAttribute('d', 'M4 20l1.3-4.2A8 8 0 1 1 8.3 18.8L4 20Z');
      const mensagem = document.createElementNS(ns, 'path');
      mensagem.setAttribute('d', 'M9 9.5c.5 2 2.5 4 5 5l1.5-1.5-2-1-1 .8c-.8-.4-1.6-1.2-2-2l.8-1-1-2L9 9.5Z');
      svg.append(contorno, mensagem);
    }
    return svg;
  }

  function copiarTextoPerfil(texto) {
    if (!texto) {
      avisar('Não encontrei um dado para copiar.');
      return;
    }
    try {
      const clipboard = window.navigator && window.navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(texto).then(
          function () { avisar('Copiado.'); },
          function () { avisar('Não foi possível copiar.'); }
        );
        return;
      }
    } catch (erro) {
      // A indisponibilidade da área de transferência não pode afetar o CRM.
    }
    avisar('A cópia não está disponível neste navegador.');
  }

  function criarBotaoCopiar(rotulo) {
    const botao = elemento('button', 'smt-retorno-icone-acao smt-retorno-acao-copiar');
    botao.type = 'button';
    botao.title = 'Copiar ' + rotulo;
    botao.setAttribute('aria-label', 'Copiar ' + rotulo);
    botao.appendChild(iconeDaInterface('copiar'));
    botao.addEventListener('click', function (evento) {
      evento.preventDefault();
      evento.stopPropagation();
      copiarTextoPerfil(botao.dataset.valorCopiar || '');
    });
    return botao;
  }

  function obterTextoCopiavel(rotulo, valor) {
    const texto = (valor.querySelector('span') || valor).textContent.replace(/\s+/g, ' ').trim();
    if (rotulo === 'e-mail') {
      const email = texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return email ? email[0] : '';
    }
    const telefone = texto.match(/\+?[\d(][\d\s().-]{7,}\d/);
    return telefone ? telefone[0].trim() : '';
  }

  function garantirLinhaValor(campo, valor) {
    let linha = valor.parentElement;
    if (!linha || !linha.classList.contains('smt-retorno-valor-linha')) {
      linha = elemento('div', 'smt-retorno-valor-linha');
      campo.insertBefore(linha, valor);
      linha.appendChild(valor);
    }
    valor.classList.add('smt-retorno-valor');
    return linha;
  }

  function garantirGrupoAcoes(linha, cadastrar) {
    let grupo = linha.querySelector(':scope > .smt-retorno-dado-acoes');
    if (!grupo) {
      grupo = elemento('span', 'smt-retorno-dado-acoes');
      linha.appendChild(grupo);
    }
    grupo.classList.toggle('smt-retorno-cadastrar-wrap', !!cadastrar);
    return grupo;
  }

  function prepararCamposPerfil(grade) {
    if (!grade) return;
    const botaoResponsavel = document.querySelector('button[onclick="abrirModalResponsavel()"]');
    Array.from(grade.children).forEach(function (campo) {
      if (campo.tagName !== 'DIV') return;
      campo.classList.add('smt-retorno-dado');

      const paragrafosDiretos = Array.from(campo.children).filter(function (filho) {
        return filho.tagName === 'P';
      });
      const rotuloEl = paragrafosDiretos[0];
      if (!rotuloEl) return;
      const rotulo = rotuloEl.textContent.replace(/\\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
      let valor = campo.querySelector(':scope > .smt-retorno-valor-linha > .smt-retorno-valor');
      if (!valor) valor = campo.querySelector(':scope > .smt-retorno-who .smt-retorno-negociador-nome');
      if (!valor) {
        const atuais = Array.from(campo.children).filter(function (filho) { return filho.tagName === 'P'; });
        valor = atuais[1] || null;
      }
      if (!valor) return;

      if (rotulo === 'negociador') {
        let grupo = campo.querySelector(':scope > .smt-retorno-who');
        if (!grupo) {
          const paragrafos = Array.from(campo.children).filter(function (filho) { return filho.tagName === 'P'; });
          const nome = paragrafos[1];
          const codigo = paragrafos[2];
          if (!nome) return;
          nome.classList.add('smt-retorno-negociador-nome');
          if (codigo) codigo.classList.add('smt-retorno-negociador-codigo');
          grupo = elemento('div', 'smt-retorno-who');
          const avatar = elemento('span', 'smt-retorno-av');
          const texto = elemento('div', 'smt-retorno-who-text');
          campo.insertBefore(grupo, nome);
          grupo.append(avatar, texto);
          texto.appendChild(nome);
          if (codigo) texto.appendChild(codigo);
        }
        const nomeAtual = grupo.querySelector('.smt-retorno-negociador-nome');
        const avatarAtual = grupo.querySelector('.smt-retorno-av');
        if (nomeAtual && avatarAtual) {
          const iniciais = nomeAtual.textContent.trim();
          const inicial = iniciais ? iniciais.slice(0, 1).toLocaleUpperCase('pt-BR') : '?';
          if (avatarAtual.textContent !== inicial) avatarAtual.textContent = inicial;
        }
        return;
      }

      if (['telefone', 'celular', 'e-mail'].includes(rotulo)) {
        const linha = garantirLinhaValor(campo, valor);
        const grupo = garantirGrupoAcoes(linha, false);
        let copiar = grupo.querySelector('.smt-retorno-acao-copiar');
        if (!copiar) {
          copiar = criarBotaoCopiar(rotulo);
          grupo.appendChild(copiar);
        }
        copiar.dataset.valorCopiar = obterTextoCopiavel(rotulo, valor);
        const telefone = obterTextoCopiavel(rotulo, valor);
        let whatsapp = grupo.querySelector('.smt-retorno-acao-whatsapp');
        const digitos = telefone.replace(/\D/g, '');
        const numeroWhatsApp = digitos.length === 10 || digitos.length === 11
          ? '55' + digitos
          : (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')
            ? digitos
            : '';
        if (rotulo === 'celular' && numeroWhatsApp) {
          if (!whatsapp) {
            whatsapp = elemento('a', 'smt-retorno-icone-acao smt-retorno-acao-whatsapp');
            whatsapp.target = '_blank';
            whatsapp.rel = 'noopener noreferrer';
            whatsapp.setAttribute('aria-label', 'Abrir conversa no WhatsApp');
            whatsapp.title = 'Abrir conversa no WhatsApp';
            whatsapp.appendChild(iconeDaInterface('whatsapp'));
            grupo.appendChild(whatsapp);
          }
          whatsapp.href = 'https://wa.me/' + numeroWhatsApp;
        } else if (whatsapp) {
          whatsapp.remove();
        }
        return;
      }

      if (rotulo === 'responsável financeiro' || rotulo === 'celular responsável') {
        const textoValor = valor.textContent.replace(/\\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
        const vazio = !textoValor || /não cadastrado|nao cadastrado|não informado|nao informado/.test(textoValor);
        const linha = garantirLinhaValor(campo, valor);
        let grupo = linha.querySelector(':scope > .smt-retorno-dado-acoes');
        if (vazio && botaoResponsavel) {
          grupo = garantirGrupoAcoes(linha, true);
          let cadastrar = grupo.querySelector('.smt-retorno-cadastrar');
          if (!cadastrar) {
            cadastrar = elemento('button', 'smt-retorno-cadastrar', 'Cadastrar');
            cadastrar.type = 'button';
            cadastrar.addEventListener('click', function (evento) {
              evento.preventDefault();
              evento.stopPropagation();
              const abrir = document.querySelector('button[onclick="abrirModalResponsavel()"]');
              if (abrir) abrir.click();
            });
            grupo.appendChild(cadastrar);
          }
        } else if (grupo && grupo.querySelector('.smt-retorno-cadastrar')) {
          grupo.remove();
        }
      }
    });
  }

  function renderizarFixadasPerfil() {
    const container = document.getElementById(ID_FIXADAS);
    if (!container) return;

    while (container.firstChild) container.removeChild(container.firstChild);
    const frases = lerFrases().filter(function (frase) { return frase.fixada === true; });
    container.hidden = false;
    const totalPaginas = Math.max(1, Math.ceil(frases.length / POR_PAGINA));
    paginaFixadas = Math.max(0, Math.min(paginaFixadas, totalPaginas - 1));

    // O título, a contagem e a paginação dividem a mesma linha para economizar altura.
    const cabecalho = elemento('div', 'smt-retorno-fixadas-cabecalho');
    const titulacao = elemento('div', 'smt-retorno-fixadas-titulacao');
    const pinTitulo = elemento('span', 'smt-retorno-pin-wrap');
    pinTitulo.appendChild(iconeAlfinete());
    titulacao.appendChild(pinTitulo);
    titulacao.appendChild(elemento('span', 'smt-retorno-fixadas-titulo', 'Frases fixadas'));
    const contador = elemento('span', 'smt-retorno-fixadas-contador', String(frases.length));
    contador.setAttribute('aria-label', frases.length + ' frases fixadas');
    titulacao.appendChild(contador);
    titulacao.appendChild(elemento('span', 'smt-retorno-fixadas-ajuda', 'Clique para inserir (não registra)'));
    cabecalho.appendChild(titulacao);

    if (totalPaginas > 1) {
      const paginacao = elemento('div', '');
      paginacao.id = 'smarttable-retorno-paginacao';
      const anterior = elemento('button', 'smt-retorno-btn smt-retorno-pagina', '‹');
      anterior.type = 'button';
      anterior.id = 'smarttable-retorno-pagina-anterior';
      anterior.title = 'Ver página anterior de frases fixadas';
      anterior.setAttribute('aria-label', 'Página anterior');
      anterior.disabled = paginaFixadas === 0;
      anterior.addEventListener('click', function () {
        if (paginaFixadas === 0) return;
        paginaFixadas -= 1;
        renderizarFixadasPerfil();
      });

      const pagina = elemento('span', 'smt-retorno-pagina-texto', 'Página ' + (paginaFixadas + 1) + ' de ' + totalPaginas);
      pagina.setAttribute('aria-live', 'polite');

      const proxima = elemento('button', 'smt-retorno-btn smt-retorno-pagina', '›');
      proxima.type = 'button';
      proxima.id = 'smarttable-retorno-pagina-proxima';
      proxima.title = 'Ver próxima página de frases fixadas';
      proxima.setAttribute('aria-label', 'Próxima página');
      proxima.disabled = paginaFixadas >= totalPaginas - 1;
      proxima.addEventListener('click', function () {
        if (paginaFixadas >= totalPaginas - 1) return;
        paginaFixadas += 1;
        renderizarFixadasPerfil();
      });
      paginacao.append(anterior, pagina, proxima);
      cabecalho.appendChild(paginacao);
    }
    container.appendChild(cabecalho);

    const lista = elemento('div', '');
    lista.id = ID_LISTA_FIXADAS;
    if (frases.length === 0) {
      lista.appendChild(elemento('p', 'smt-retorno-sem-fixadas', 'Nenhuma frase fixada ainda. Fixe frases no painel Retorno.'));
    }
    frases.slice(paginaFixadas * POR_PAGINA, (paginaFixadas + 1) * POR_PAGINA).forEach(function (frase) {
      const atalho = elemento('button', 'smt-retorno-atalho-fixado');
      atalho.type = 'button';
      atalho.title = 'Inserir no campo Observação: ' + frase.observacao;
      atalho.setAttribute('aria-label', 'Inserir frase fixada: ' + frase.rotulo);

      const mais = elemento('span', 'smt-retorno-chip-mais', '＋');
      mais.setAttribute('aria-hidden', 'true');
      const texto = elemento('span', 'smt-retorno-atalho-texto', frase.observacao);
      atalho.append(mais, texto);
      atalho.addEventListener('click', function () {
        const campoObservacao = document.getElementById('smarttable-retorno-rapido-observacao');
        if (!campoObservacao) return;
        // Atalho é apenas inserção de texto: não muda o resultado e não registra.
        campoObservacao.value = frase.observacao;
        campoObservacao.dispatchEvent(new window.Event('input', { bubbles: true }));
        campoObservacao.focus();
      });
      lista.appendChild(atalho);
    });
    container.appendChild(lista);
  }

  function alternarFixacao(frase) {
    const atuais = lerFrases();
    const alvo = atuais.find(function (item) { return item.id === frase.id; });
    if (!alvo) {
      avisar('Esta frase não existe mais no armazenamento. Feche e tente novamente.');
      return;
    }
    const fixada = !alvo.fixada;
    const novos = atuais.map(function (item) {
      return item.id === frase.id ? Object.assign({}, item, { fixada: fixada }) : item;
    });
    if (!gravarFrases(novos)) return;
    const totalFixadas = novos.filter(function (item) { return item.fixada === true; }).length;
    paginaFixadas = Math.min(paginaFixadas, Math.max(0, Math.ceil(totalFixadas / POR_PAGINA) - 1));
    renderizarLista();
    avisar(fixada ? 'Frase fixada no perfil do cliente.' : 'Frase desafixada do perfil do cliente.');
  }

  function renderizarLista() {
    if (!listaFrases) return;
    while (listaFrases.firstChild) listaFrases.removeChild(listaFrases.firstChild);
    const frases = lerFrases();
    renderizarFixadasPerfil();
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
      const fixar = elemento('button', 'smt-retorno-btn smt-retorno-fixar');
      fixar.type = 'button';
      const estaFixada = frase.fixada === true;
      fixar.title = estaFixada ? 'Desafixar do perfil do cliente' : 'Fixar no perfil do cliente';
      fixar.setAttribute('aria-label', fixar.title);
      fixar.setAttribute('aria-pressed', String(estaFixada));
      fixar.appendChild(iconeAlfinete());
      fixar.addEventListener('click', function () { alternarFixacao(frase); });
      const excluir = elemento('button', 'smt-retorno-btn smt-retorno-btn-perigo', 'Excluir');
      excluir.type = 'button';
      excluir.addEventListener('click', function () {
        const restantes = lerFrases().filter(function (itemSalvo) { return itemSalvo.id !== frase.id; });
        if (gravarFrases(restantes)) {
          renderizarLista();
          avisar('Frase excluída.');
        }
      });
      acoes.append(editar, fixar, excluir);
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
        return { id: item.id, rotulo: rotulo, resultadoId: resultadoId, observacao: observacao, fixada: item.fixada === true };
      });
    } else {
      novos = atuais.concat([{ id: gerarId(), rotulo: rotulo, resultadoId: resultadoId, observacao: observacao, fixada: false }]);
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

  function registrarContato(resultadoId, textoObservacao) {
    if (registroEmAndamento) {
      avisar('Já há um registro em andamento. Aguarde a resposta do CRM.');
      return;
    }
    const botaoResultado = document.getElementById(PREFIXO_RESULTADO + resultadoId);
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
      observacao.value = textoObservacao;
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

  function aplicarFrase(frase) {
    registrarContato(frase.resultadoId, frase.observacao);
  }

  function criarRegistroRapido() {
    let formularioRapido = document.getElementById(ID_REGISTRO_RAPIDO);
    if (formularioRapido) return formularioRapido;

    formularioRapido = elemento('form', '');
    formularioRapido.id = ID_REGISTRO_RAPIDO;
    const topo = elemento('div', 'smt-retorno-rapido-top');
    topo.appendChild(elemento('p', 'smt-retorno-rapido-titulo', 'Registro rápido'));
    formularioRapido.appendChild(topo);
    const rotuloResultado = elemento('label', 'smt-retorno-rapido-label', 'Resultado do contato');
    rotuloResultado.htmlFor = 'smarttable-retorno-rapido-resultado';
    const seletor = elemento('select', 'smt-retorno-rapido-campo');
    seletor.id = 'smarttable-retorno-rapido-resultado';
    seletor.setAttribute('aria-label', 'Resultado do contato no CRM');
    const placeholder = elemento('option', '', 'Resultado do contato no CRM');
    placeholder.value = '';
    seletor.appendChild(placeholder);
    const resultados = extrairResultados();
    resultados.forEach(function (resultado) {
      const opcao = elemento('option', '', resultado.rotulo);
      opcao.value = resultado.id;
      seletor.appendChild(opcao);
    });
    if (resultados.some(function (resultado) { return resultado.id === 'REGISTRO'; })) {
      seletor.value = 'REGISTRO';
    }
    const linhaResultado = elemento('div', 'smt-retorno-rapido-resultado-linha');
    linhaResultado.append(rotuloResultado, seletor);
    const rotuloObservacao = elemento('label', 'smt-retorno-rapido-label');
    rotuloObservacao.htmlFor = 'smarttable-retorno-rapido-observacao';
    rotuloObservacao.appendChild(document.createTextNode('Observação '));
    rotuloObservacao.appendChild(elemento('span', 'smt-retorno-rapido-ajuda', '· será salva no histórico'));
    const campo = elemento('textarea', 'smt-retorno-rapido-campo');
    campo.id = 'smarttable-retorno-rapido-observacao';
    campo.classList.add('smt-retorno-rapido-frase');
    campo.setAttribute('aria-label', 'Frase que será registrada na observação');
    campo.placeholder = 'Ex.: cliente confirmou pagamento pelo boleto do portal.';
    const enviar = elemento('button', '', 'Registrar contato');
    enviar.id = 'smarttable-retorno-rapido-salvar';
    enviar.type = 'submit';
    const acoes = elemento('div', 'smt-retorno-rapido-acoes');
    acoes.appendChild(enviar);
    formularioRapido.append(linhaResultado, rotuloObservacao, campo, acoes);
    formularioRapido.addEventListener('submit', function (evento) {
      evento.preventDefault();
      const resultadoId = seletor.value;
      const observacao = campo.value.trim();
      if (!resultadoId || !observacao) {
        avisar('Informe o resultado do contato e a frase da observação.');
        return;
      }
      if (!extrairResultados().some(function (resultado) { return resultado.id === resultadoId; })) {
        avisar('O resultado escolhido não está mais disponível no CRM. Selecione outro.');
        return;
      }
      registrarContato(resultadoId, observacao);
    });
    return formularioRapido;
  }

  function criarBotaoRetorno() {
    // A identificação e os indicadores ficam no topo do cartão; contato e
    // registro rápido formam a área inferior. Os handlers nativos são mantidos.
    const responsavel = document.querySelector('button[onclick="abrirModalResponsavel()"]');
    const alerta = document.getElementById('smarttable-botao-alerta-cliente');
    if (!responsavel || !alerta || !responsavel.isConnected || !alerta.isConnected || !responsavel.parentElement) return false;

    // Os estilos do layout de perfil precisam existir desde a primeira renderização,
    // não apenas depois que o operador abrir o painel Retorno.
    instalarEstilos();

    let botao = document.getElementById(ID_BOTAO);
    if (!botao) {
      botao = elemento('button', alerta.className || 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition', '');
      botao.append(iconeDaInterface('retorno'), document.createTextNode('Retorno'));
      botao.id = ID_BOTAO;
      botao.type = 'button';
      botao.title = 'Abrir frases de retorno rápido e registrar contato no CRM.';
      botao.addEventListener('click', abrirPainel);
      // Cores e medidas seguem o botão nativo Alerta, sem herdar a cor de estado dele.
      Object.assign(botao.style, {
        cursor: 'pointer',
        fontFamily: 'inherit',
        borderStyle: 'solid',
        borderWidth: '1px',
        background: '#ffffff',
        borderColor: '#d0d5dd',
        color: '#344054',
        margin: '0',
      });
    }

    const cabecalhoOriginal = responsavel.parentElement;
    let layout = document.getElementById(ID_LAYOUT_PERFIL);
    if (!layout) {
      layout = elemento('div', '');
      layout.id = ID_LAYOUT_PERFIL;
      const esquerda = elemento('div', '');
      esquerda.id = ID_COLUNA_ESQUERDA;
      const direita = elemento('div', '');
      direita.id = ID_COLUNA_DIREITA;
      layout.append(esquerda, direita);
      // O CRM põe o título e os botões dentro do mesmo cabeçalho flex.
      // A faixa de ações fica como irmã do cabeçalho, antes da grade de dados.
      cabecalhoOriginal.insertAdjacentElement('afterend', layout);
    } else if (layout.parentElement !== cabecalhoOriginal.parentElement || layout.previousElementSibling !== cabecalhoOriginal) {
      cabecalhoOriginal.insertAdjacentElement('afterend', layout);
    }

    cabecalhoOriginal.dataset.smtRetornoCabecalho = 'true';
    const cartaoInfo = cabecalhoOriginal.parentElement;
    if (cartaoInfo) {
      cartaoInfo.dataset.smtRetornoContato = 'true';
      const cartaoCliente = cartaoInfo.parentElement;
      const resumoCliente = cartaoInfo.previousElementSibling;
      if (cartaoCliente && resumoCliente) {
        cartaoCliente.dataset.smtRetornoCartao = 'true';
        ajustarLarguraCartao(cartaoCliente);
        resumoCliente.dataset.smtRetornoResumo = 'true';
        const identificacao = resumoCliente.querySelector(':scope > div:first-child');
        const indicadores = resumoCliente.querySelector(':scope > div:nth-child(2)');
        if (identificacao) identificacao.dataset.smtRetornoIdentificacao = 'true';
        if (indicadores) {
          indicadores.dataset.smtRetornoKpis = 'true';
          Array.from(indicadores.children).forEach(function (indicador) {
            const rotulo = indicador.querySelector('p:first-child')?.textContent.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
            const valor = indicador.querySelector('p:last-child')?.textContent || '';
            if (rotulo.includes('vencido nao negociado') && /[1-9]/.test(valor.replace(/[^\d]/g, ''))) {
              indicador.dataset.smtRetornoKpi = 'alerta';
            } else if (rotulo.includes('atraso atual')) {
              indicador.dataset.smtRetornoKpi = 'aviso';
            } else if (rotulo.includes('vencido negociado') && !/[1-9]/.test(valor.replace(/[^\d]/g, ''))) {
              indicador.dataset.smtRetornoKpi = 'zero';
            }
          });
        }
      } else {
        cartaoInfo.dataset.smtRetornoCartao = 'true';
      }
    }

    let esquerda = document.getElementById(ID_COLUNA_ESQUERDA);
    let direita = document.getElementById(ID_COLUNA_DIREITA);
    if (!esquerda || !direita) return false;

    if (responsavel.parentElement !== cabecalhoOriginal) cabecalhoOriginal.appendChild(responsavel);
    if (alerta.parentElement !== cabecalhoOriginal) cabecalhoOriginal.appendChild(alerta);
    if (!direita.contains(botao)) direita.insertBefore(botao, direita.firstChild);

    let linhaAtalhos = document.getElementById(ID_ATALHOS_LINHA);
    if (!linhaAtalhos) {
      linhaAtalhos = elemento('div', '');
      linhaAtalhos.id = ID_ATALHOS_LINHA;
      direita.appendChild(linhaAtalhos);
    }
    const registroRapido = criarRegistroRapido();
    if (registroRapido.parentElement !== linhaAtalhos) linhaAtalhos.appendChild(registroRapido);
    const cabecalhoRapido = registroRapido.querySelector('.smt-retorno-rapido-top');
    if (cabecalhoRapido && botao.parentElement !== cabecalhoRapido) cabecalhoRapido.appendChild(botao);

    let fixadas = document.getElementById(ID_FIXADAS);
    if (!fixadas) {
      fixadas = elemento('div', '');
      fixadas.id = ID_FIXADAS;
      fixadas.hidden = true;
    }
    const rotuloObservacaoRapida = registroRapido.querySelector('label[for="smarttable-retorno-rapido-observacao"]');
    if (rotuloObservacaoRapida &&
      (fixadas.parentElement !== registroRapido || fixadas.nextElementSibling !== rotuloObservacaoRapida)) {
      registroRapido.insertBefore(fixadas, rotuloObservacaoRapida);
    }
    if (fixadas.dataset.inicializado !== 'true') {
      fixadas.dataset.inicializado = 'true';
      renderizarFixadasPerfil();
    }

    // Só adapta a grade de campos quando os identificadores reais do CRM
    // estão presentes; nunca cria valores fictícios nem substitui os dados.
    const gradeDados = layout.nextElementSibling;
    if (gradeDados && gradeDados.querySelector('#resp-nome-valor')) {
      gradeDados.dataset.smtRetornoGrade = 'true';
      prepararCamposPerfil(gradeDados);
    }
    return true;
  }

  function instalar() {
    if (!document.body) {
      window.setTimeout(instalar, 100);
      return;
    }
    criarBotaoRetorno();
    if (observador) return;
    window.addEventListener('resize', criarBotaoRetorno, { passive: true });
    // O listener delegado detecta abertura/fechamento de navegação sem observar
    // cada atributo de cada campo da página, o que criaria reentrância no CRM.
    document.addEventListener('click', function (evento) {
      const alvo = evento.target?.nodeType === 1 ? evento.target : evento.target?.parentElement;
      if (!alvo?.closest?.('aside, nav, [role="navigation"], [class*="sidebar"], [id*="sidebar"], [aria-controls], [aria-expanded], [data-sidebar]')) return;
      window.setTimeout(criarBotaoRetorno, 0);
    }, true);
    observador = new MutationObserver(function (mutacoes) {
      const seletorSmartTable = [
        '#' + ID_DIALOGO,
        '#' + ID_LAYOUT_PERFIL,
        '#' + ID_ATALHOS_LINHA,
        '#' + ID_FIXADAS,
        '#' + ID_REGISTRO_RAPIDO,
        '[data-smt-retorno-cabecalho="true"]',
        '[data-smt-retorno-grade="true"]',
        '.smt-retorno-dado',
        '.smt-retorno-valor-linha',
        '.smt-retorno-dado-acoes',
        '.smt-retorno-who',
      ].join(',');
      const mutacaoDoModulo = function (mutacao) {
        const alvo = mutacao.target?.nodeType === 1 ? mutacao.target : mutacao.target?.parentElement;
        return !!alvo?.closest?.(seletorSmartTable);
      };
      // Não reagir às próprias mutações de layout/painel; observar as alterações
      // estruturais do CRM evita que a preparação de campos gere um ciclo.
      if (mutacoes.some(function (mutacao) {
        return mutacao.type === 'childList' && !mutacaoDoModulo(mutacao);
      })) criarBotaoRetorno();
    });
    observador.observe(document.body, { childList: true, subtree: true });
  }

  window.__smartTableUtil?.registrarPainel?.('retornoRapido', function () { fecharPainel(false); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalar);
  } else {
    instalar();
  }
})();
