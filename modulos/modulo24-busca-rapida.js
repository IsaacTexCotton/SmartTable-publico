/* =========================================================================
 * MÓDULO 24: BUSCA RÁPIDA (Alt+B) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Caixa de busca de cliente por nome ou CNPJ. Ao apertar Enter, o módulo
 * descobre quantos clientes a busca acha ANTES de sair da página:
 *   0 clientes   -> a caixa continua aberta, avisando que não achou;
 *   1 cliente    -> entra direto na página dele;
 *   2 a 5        -> lista no centro da tela: setas escolhem, Enter entra;
 *   mais de 5    -> a lista nativa do CRM (?search=...), como sempre foi.
 * Se a contagem não puder ser feita (rede, resposta que não é a lista), cai na
 * lista nativa: nunca fica pior que o comportamento antigo.
 *
 * FATOS CONFIRMADOS NO CRM (diagnóstico censurado do usuário, 30/09/2026):
 *   - /crm/clientes?search=... já vem FILTRADO pelo servidor, com a lista
 *     `var CLIENTES = [...]` embutida na própria página (mesmo formato de
 *     window.CLIENTES), em ~200 ms. A tabela só é desenhada no navegador, então
 *     a contagem sai de CLIENTES, não das linhas do HTML.
 *   - A lista só tem quem DEVE: cliente sem dívida dá zero (o aviso diz isso).
 *   - Os outros parâmetros da URL (negociador, filtroScpc...) valem na busca,
 *     como sempre valeram na navegação.
 *   - O número de /crm/clientes/grupo/N é o campo `controleCliente` (igual em
 *     161 de 161 linhas); `grupoCliente` NÃO é (72 de 161).
 *
 * Só para depuração: nada de dado de cliente vai para o console (nem o termo).
 * Depende do Módulo 0 (window.__smartTableUtil: lerVariavelDoScript,
 * montarUrlCliente, formatarMoeda). Expõe window.__buscaRapida; o Módulo 4
 * chama e cuida da tecla. Precisa carregar ANTES do Módulo 4.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__buscaRapidaCarregada) return;
  window.__buscaRapidaCarregada = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Busca Rápida');

  const CONFIG_BUSCA = {
    // Id do overlay; o Módulo 4 e os testes procuram por ele.
    ID_OVERLAY: 'smarttable-busca-rapida',
    // Até quantos clientes vão para a lista do popup; acima disso, lista nativa.
    MAX_NO_POPUP: 5,
    // Teto da busca em segundo plano (ms); estourou, cai na lista nativa.
    TIMEOUT_MS: 8000,
    TEXTO_ZERO: 'Nenhum cliente com dívida encontrado com esses dados.',
  };

  // Indireção só para os testes: navegar de verdade não roda no jsdom.
  const navegacao = {
    ir(url) { window.location.href = url; },
  };

  let overlayEl = null;
  let cancelarBuscaEmAndamento = null;

  /** Endereço da lista nativa com o termo, preservando os outros parâmetros da URL atual. */
  function urlDaLista(termo) {
    const params = new URLSearchParams(location.search);
    params.set('search', termo);
    return `${location.origin}/crm/clientes?${params.toString()}`;
  }

  /** Lista nativa do CRM (o comportamento de sempre). */
  function buscarCliente(termo) {
    const alvo = (termo || '').trim();
    if (!alvo) return;
    navegacao.ir(urlDaLista(alvo));
  }

  /** O cliente tem o que é preciso para abrir a página dele sem adivinhar? */
  function clienteAbrivel(c) {
    return Boolean(c) && typeof c.cnpj === 'string' && c.cnpj.trim() !== '' && c.controleCliente !== null && c.controleCliente !== undefined && Number.isFinite(Number(c.controleCliente));
  }

  /** Endereço da página do cliente (o N do endereço é o controleCliente). */
  function urlDoCliente(c) {
    return window.__smartTableUtil.montarUrlCliente(Number(c.controleCliente), c.cnpj);
  }

  /**
   * O que fazer com o resultado da busca. Função pura.
   * @param {object[]|null|undefined} clientes CLIENTES da resposta; null/undefined = não deu para ler.
   * @returns {{acao: 'lista-nativa'|'nenhum'|'direto'|'popup', clientes: object[]}}
   */
  function decidir(clientes) {
    if (!Array.isArray(clientes)) return { acao: 'lista-nativa', clientes: [] };
    // Mesmo CNPJ duas vezes é o mesmo cliente; CNPJs diferentes (matriz/filial) são dois.
    const vistos = new Set();
    const unicos = clientes.filter((c) => {
      const chave = typeof c?.cnpj === 'string' ? c.cnpj : null;
      if (chave === null) return true;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
    if (unicos.length === 0) return { acao: 'nenhum', clientes: [] };
    if (unicos.length > CONFIG_BUSCA.MAX_NO_POPUP) return { acao: 'lista-nativa', clientes: unicos };
    // Sem o que abrir a página de algum deles, não adivinha: lista nativa.
    if (!unicos.every(clienteAbrivel)) return { acao: 'lista-nativa', clientes: unicos };
    return { acao: unicos.length === 1 ? 'direto' : 'popup', clientes: unicos };
  }

  /** Lê CLIENTES do HTML da lista (sem executar nada). undefined se não achou. */
  function lerClientesDoHtml(html) {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    return window.__smartTableUtil.lerVariavelDoScript(doc, 'CLIENTES');
  }

  /**
   * Busca em segundo plano e devolve CLIENTES, ou null se não deu para saber
   * (rede, sessão expirada, resposta que não é a lista...).
   */
  async function contarClientes(termo, sinal) {
    try {
      const resposta = await window.fetch(urlDaLista(termo), { credentials: 'same-origin', signal: sinal });
      if (!resposta.ok) return null;
      const lista = lerClientesDoHtml(await resposta.text());
      return Array.isArray(lista) ? lista : null;
    } catch (erro) {
      if (erro?.name !== 'AbortError') console.warn('[Busca] Não consegui contar os clientes; usando a lista do CRM.', erro?.name);
      return null;
    }
  }

  function fecharBuscaRapida() {
    if (cancelarBuscaEmAndamento) {
      cancelarBuscaEmAndamento();
      cancelarBuscaEmAndamento = null;
    }
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function estaBuscaRapidaAberta() {
    return overlayEl !== null;
  }

  function criarItem(c, indice) {
    const util = window.__smartTableUtil;
    const item = document.createElement('div');
    item.id = `smarttable-busca-item-${indice}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.indice = String(indice);
    Object.assign(item.style, { padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', borderLeft: '3px solid transparent' });

    const nome = document.createElement('div');
    nome.textContent = String(c.razaoSocial || c.nomeFantasia || c.cnpj);
    Object.assign(nome.style, { fontSize: '14px', fontWeight: '600', color: '#16232F' });

    const detalhe = document.createElement('div');
    const partes = [c.cnpjFormatado || c.cnpj];
    if (typeof c.diasAtraso === 'number') partes.push(`${c.diasAtraso} dias de atraso`);
    if (typeof c.dividaVencida === 'number') partes.push((util?.formatarMoeda?.(c.dividaVencida) ?? String(c.dividaVencida)).replace(/ /g, ' '));
    detalhe.textContent = partes.join(' · ');
    Object.assign(detalhe.style, { fontSize: '12px', color: '#667085', marginTop: '2px' });

    item.appendChild(nome);
    item.appendChild(detalhe);
    return item;
  }

  function abrirBuscaRapida() {
    if (overlayEl) {
      fecharBuscaRapida();
      return;
    }

    const overlay = document.createElement('div');
    overlayEl = overlay;
    overlay.id = CONFIG_BUSCA.ID_OVERLAY;
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(22, 35, 47, 0.35)',
      zIndex: 9999999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const caixa = document.createElement('div');
    Object.assign(caixa.style, {
      background: '#fff', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
      padding: '16px', width: '460px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
    });

    const titulo = document.createElement('div');
    titulo.textContent = 'Buscar cliente (nome ou CNPJ)';
    Object.assign(titulo.style, {
      fontSize: '12px', fontWeight: '600', color: '#667085', marginBottom: '8px',
      textTransform: 'uppercase', letterSpacing: '.03em',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Digite e aperte Enter...';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'smarttable-busca-lista');
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '15px',
      border: '1px solid #d0d5dd', borderRadius: '8px', outline: 'none',
    });

    const aviso = document.createElement('div');
    aviso.setAttribute('role', 'status');
    Object.assign(aviso.style, { fontSize: '13px', marginTop: '10px', minHeight: '0', color: '#667085' });

    const lista = document.createElement('div');
    lista.id = 'smarttable-busca-lista';
    lista.setAttribute('role', 'listbox');
    Object.assign(lista.style, { marginTop: '8px' });

    const dica = document.createElement('div');
    Object.assign(dica.style, { fontSize: '11px', color: '#98a2b3', marginTop: '8px', display: 'none' });

    let clientes = [];
    let selecionado = -1;
    let ocupado = false;

    function mostrarAviso(texto, cor) {
      aviso.textContent = texto;
      aviso.style.color = cor || '#667085';
    }

    function limparLista() {
      clientes = [];
      selecionado = -1;
      lista.textContent = '';
      dica.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function selecionar(indice) {
      if (clientes.length === 0) return;
      selecionado = (indice + clientes.length) % clientes.length;
      [...lista.children].forEach((el, i) => {
        const ativo = i === selecionado;
        el.setAttribute('aria-selected', String(ativo));
        el.style.background = ativo ? '#EEF2FF' : 'transparent';
        el.style.borderLeftColor = ativo ? '#313A8C' : 'transparent';
      });
      input.setAttribute('aria-activedescendant', lista.children[selecionado].id);
    }

    function abrirCliente(indice) {
      const c = clientes[indice];
      if (!c) return;
      fecharBuscaRapida();
      navegacao.ir(urlDoCliente(c));
    }

    function mostrarLista(achados) {
      limparLista();
      clientes = achados;
      achados.forEach((c, i) => {
        const item = criarItem(c, i);
        // mousedown não tira o foco do campo (as setas continuam valendo).
        item.addEventListener('mousedown', (e) => e.preventDefault());
        item.addEventListener('mousemove', () => { if (selecionado !== i) selecionar(i); });
        item.addEventListener('click', () => abrirCliente(i));
        lista.appendChild(item);
      });
      mostrarAviso(`${achados.length} clientes encontrados.`);
      dica.textContent = '↑ ↓ escolhem · Enter abre o cliente · Esc volta para a busca';
      dica.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
      selecionar(0);
    }

    async function buscar() {
      const termo = input.value.trim();
      if (!termo) {
        fecharBuscaRapida();
        return;
      }
      ocupado = true;
      limparLista();
      mostrarAviso('Buscando...');
      const controle = new window.AbortController();
      const teto = setTimeout(() => controle.abort(), CONFIG_BUSCA.TIMEOUT_MS);
      cancelarBuscaEmAndamento = () => { clearTimeout(teto); controle.abort(); };
      const achados = await contarClientes(termo, controle.signal);
      clearTimeout(teto);
      ocupado = false;
      // A caixa foi fechada (Esc, clique fora, Alt+B) enquanto buscava: não faz mais nada.
      if (overlayEl !== overlay) return;
      cancelarBuscaEmAndamento = null;

      const decisao = decidir(achados);
      if (decisao.acao === 'nenhum') {
        mostrarAviso(CONFIG_BUSCA.TEXTO_ZERO, '#B42318');
        input.focus();
        input.select();
      } else if (decisao.acao === 'direto') {
        fecharBuscaRapida();
        navegacao.ir(urlDoCliente(decisao.clientes[0]));
      } else if (decisao.acao === 'popup') {
        mostrarLista(decisao.clientes);
      } else {
        fecharBuscaRapida();
        buscarCliente(termo);
      }
    }

    input.addEventListener('input', () => {
      // Mexeu no texto: a lista antiga não vale mais.
      if (clientes.length > 0 || aviso.textContent) {
        limparLista();
        mostrarAviso('');
      }
    });

    input.addEventListener('keydown', (e) => {
      // Não deixa Enter/Escape/setas vazarem pro listener global de atalhos.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (clientes.length > 0) {
          limparLista();
          mostrarAviso('');
          input.select();
        } else {
          fecharBuscaRapida();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (ocupado) return;
        if (clientes.length > 0) abrirCliente(selecionado);
        else buscar();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && clientes.length > 0) {
        e.preventDefault();
        selecionar(selecionado + (e.key === 'ArrowDown' ? 1 : -1));
      }
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) fecharBuscaRapida(); // clicar fora fecha
    });

    caixa.appendChild(titulo);
    caixa.appendChild(input);
    caixa.appendChild(aviso);
    caixa.appendChild(lista);
    caixa.appendChild(dica);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    input.focus();
  }

  window.__buscaRapida = Object.freeze({
    abrirBuscaRapida,
    fecharBuscaRapida,
    estaBuscaRapidaAberta,
    buscarCliente,
    decidir,
    urlDaLista,
    urlDoCliente,
    lerClientesDoHtml,
    CONFIG_BUSCA,
    navegacao,
  });
})();
