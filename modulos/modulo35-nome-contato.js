/* =========================================================================
 * MÓDULO 35: NOME PADRONIZADO DO CONTATO
 * Monta no perfil do cliente o nome para cadastro no WhatsApp/Google Contacts.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__nomeContatoCarregado) return;
  window.__nomeContatoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Nome Padronizado do Contato');

  const ID_CAMPO = 'smarttable-nome-padronizado';
  let observador = null;

  function texto(valor) {
    return String(valor || '').replace(/\s+/g, ' ').trim();
  }

  function elemento(tag, classe, conteudo) {
    const item = document.createElement(tag);
    if (classe) item.className = classe;
    if (conteudo !== undefined) item.textContent = conteudo;
    return item;
  }

  function obterRazao(raiz) {
    const titulos = Array.isArray(window.__TITULOS_ABERTOS__) ? window.__TITULOS_ABERTOS__ : [];
    const razoes = new Map();
    titulos.forEach(function (titulo) {
      const razao = texto(titulo && titulo.razaoSocial);
      if (!razao) return;
      const chave = razao.toLocaleUpperCase('pt-BR');
      const atual = razoes.get(chave) || { nome: razao, quantidade: 0, cliente: false };
      atual.quantidade += 1;
      const cnpjTitulo = String(titulo.cnpj || '').replace(/\D/g, '');
      if (raiz && cnpjTitulo.slice(0, 8) === raiz) atual.cliente = true;
      razoes.set(chave, atual);
    });
    return Array.from(razoes.values()).sort(function (a, b) {
      return Number(b.cliente) - Number(a.cliente) || b.quantidade - a.quantidade;
    })[0]?.nome || '';
  }

  function obterDados() {
    const url = new URL(window.location.href);
    const cnpj = url.searchParams.get('cnpj') || window.__CLIENTE_CNPJ__ || '';
    const raiz = String(cnpj).replace(/\D/g, '').slice(0, 8);
    const cidadeEstado = Array.from(document.querySelectorAll('#perfil-restante > div')).find(function (campo) {
      return texto(campo.querySelector(':scope > p')?.textContent).toLocaleLowerCase('pt-BR') === 'cidade/estado';
    });
    const localidade = texto(cidadeEstado?.querySelectorAll(':scope > p')[1]?.textContent);
    const ufMatch = localidade.match(/\b([A-Z]{2})\s*$/i);
    const grupoMatch = url.pathname.match(/\/grupo\/(\d+)/i);
    const grupo = grupoMatch && Number(grupoMatch[1]) > 0 ? 'GP ' + grupoMatch[1] : '';
    const responsavel = texto(window.__RESPONSAVEL__?.nome || document.getElementById('resp-nome-valor')?.textContent)
      .replace(/^(não cadastrado|nao cadastrado|não informado|nao informado)$/i, '');
    return [obterRazao(raiz), raiz, ufMatch ? ufMatch[1].toLocaleUpperCase('pt-BR') : '', grupo, responsavel]
      .filter(Boolean).join(' - ');
  }

  function avisar(mensagem) {
    if (typeof window.__smartTableUtil?.toast === 'function') {
      window.__smartTableUtil.toast(mensagem, 3200);
    } else {
      console.info('[Nome Padronizado] ' + mensagem);
    }
  }

  function instalarCampo() {
    const grade = document.getElementById('perfil-restante');
    if (!grade || !grade.querySelector('#resp-nome-valor')) return;
    let campo = document.getElementById(ID_CAMPO);
    if (!campo) {
      campo = elemento('div', 'smt-retorno-dado smt-retorno-nome-padronizado');
      campo.id = ID_CAMPO;
      const rotulo = elemento('p', '', 'Nome padronizado');
      const linha = elemento('div', 'smt-retorno-valor-linha');
      const valor = elemento('p', 'smt-retorno-valor');
      valor.id = ID_CAMPO + '-valor';
      const acoes = elemento('span', 'smt-retorno-dado-acoes smt-retorno-cadastrar-wrap');
      const botao = elemento('button', 'smt-retorno-icone-acao smt-retorno-acao-copiar');
      botao.type = 'button';
      botao.title = 'Copiar nome padronizado';
      botao.setAttribute('aria-label', botao.title);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('aria-hidden', 'true');
      const retangulo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      retangulo.setAttribute('x', '9'); retangulo.setAttribute('y', '9');
      retangulo.setAttribute('width', '11'); retangulo.setAttribute('height', '11');
      retangulo.setAttribute('rx', '2');
      const caminho = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      caminho.setAttribute('d', 'M5 15V6a2 2 0 0 1 2-2h9');
      svg.append(retangulo, caminho);
      botao.appendChild(svg);
      botao.addEventListener('click', function () {
        const valorCopiar = botao.dataset.valorCopiar || '';
        if (!valorCopiar) return;
        const clipboard = window.navigator && window.navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          avisar('A cópia não está disponível neste navegador.');
          return;
        }
        clipboard.writeText(valorCopiar).then(
          function () { avisar('Nome padronizado copiado.'); },
          function () { avisar('Não foi possível copiar o nome.'); }
        );
      });
      acoes.appendChild(botao);
      linha.append(valor, acoes);
      campo.append(rotulo, linha);
      grade.appendChild(campo);
    }
    const nome = obterDados();
    const exibicao = nome || 'Dados insuficientes';
    const valor = campo.querySelector('#' + ID_CAMPO + '-valor');
    const botao = campo.querySelector('button');
    if (valor && valor.textContent !== exibicao) valor.textContent = exibicao;
    if (botao) {
      botao.dataset.valorCopiar = nome;
      botao.disabled = !nome;
      botao.title = nome ? 'Copiar nome padronizado' : 'Nome padronizado indisponível';
      botao.setAttribute('aria-label', botao.title);
    }
  }

  function instalar() {
    if (!document.body) {
      window.setTimeout(instalar, 100);
      return;
    }
    instalarCampo();
    if (observador) return;
    observador = new MutationObserver(instalarCampo);
    observador.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar);
  else instalar();
})();
