/* =========================================================================
 * MÓDULO 24: BUSCA RÁPIDA (Alt+B) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Busca por nome, CNPJ ou celular. O celular é comparado aos campos usuais
 * do cadastro e ao celular do responsável financeiro, lido da ficha individual
 * pelo leitor já existente no Módulo 29. Até quatro fichas são consultadas em
 * paralelo; falhas são indicadas e nunca viram 'não encontrado' conclusivo.
 *
 * A ponte opcional integracoes/whatsapp-crm-bridge.user.js envia, por clique
 * explícito, o número visível no cabeçalho/perfil do WhatsApp Web. O Módulo 24
 * recebe o evento smarttable:buscar-celular-whatsapp e usa esta mesma busca.
 * O telefone não é posto na URL nem registrado no console.
 *
 * Com resultados conclusivos: zero -> aviso; um -> abre diretamente; vários ->
 * lista para escolha. A busca por nome/CNPJ conserva o comportamento antigo.
 *
 * FATOS CONFIRMADOS NO CRM (diagnóstico censurado do usuário, 30/09/2026):
 *   - /crm/clientes?search=... já vem FILTRADO pelo servidor, com a lista
 *     `var CLIENTES = [...]` embutida na própria página (mesmo formato de
 *     window.CLIENTES), em ~200 ms. A tabela só é desenhada no navegador, então
 *     a contagem sai de CLIENTES, não das linhas do HTML.
 *   - A lista só tem quem DEVE: cliente sem dívida dá zero (o aviso diz isso).
 *   - A busca por celular consulta a lista disponível sem `search` e compara
 *     telefones normalizados localmente; respeita os demais filtros do CRM.
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
    // Busca por nome/CNPJ mantém o teto curto; celular também consulta fichas individuais.
    TIMEOUT_MS: 8000,
    TIMEOUT_CELULAR_MS: 60000,
    TEXTO_ZERO: 'Nenhum cliente com dívida encontrado com esses dados.',
    TEXTO_ZERO_CELULAR: 'Nenhum cliente com esse celular encontrado na lista disponível.',
  };

  // Indireção só para os testes: navegar de verdade não roda no jsdom.
  const navegacao = {
    ir(url) { window.location.href = url; },
  };

  let overlayEl = null;
  let cancelarBuscaEmAndamento = null;
  const fontesCelular = new Map();
  const cacheResponsavel = new Map();
  const CACHE_RESPONSAVEL_TTL_MS = 5 * 60 * 1000;
  let diagnosticoBuscaCelular = { total: 0, fichasConsultadas: 0, falhasDeLeitura: 0 };

  /** Endereço da lista nativa com o termo, preservando os outros parâmetros da URL atual. */
  function urlDaLista(termo) {
    const params = new URLSearchParams(location.search);
    params.set('search', termo);
    return `${location.origin}/crm/clientes?${params.toString()}`;
  }

  /** Lista atual do CRM sem o termo de busca; preserva os outros filtros. */
  function urlDaListaSemBusca() {
    const params = new URLSearchParams(location.search);
    params.delete('search');
    // cnpj é parâmetro da ficha individual, não filtro da lista. A ponte pode
    // ser acionada mesmo quando o CRM está aberto dentro de um cadastro.
    params.delete('cnpj');
    const query = params.toString();
    return `${location.origin}/crm/clientes${query ? `?${query}` : ''}`;
  }

  // Campos já usados pelo CRM/SmartTable para localizar telefone do cliente.
  const CAMPOS_TELEFONE_CLIENTE = ['celular', 'telefoneCelular', 'telefoneContato', 'telefone'];

  /** Normaliza telefone brasileiro para DDD+número, aceitando entrada com +55. */
  function normalizarCelular(valor) {
    let digitos = String(valor ?? '').replace(/\D/g, '');
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
      digitos = digitos.slice(2);
    }
    return digitos.length === 10 || digitos.length === 11 ? digitos : '';
  }

  function telefoneDoCliente(cliente) {
    for (const campo of CAMPOS_TELEFONE_CLIENTE) {
      const valor = cliente?.[campo];
      if (valor === null || valor === undefined || String(valor).trim() === '') continue;
      if (normalizarCelular(valor)) return String(valor).trim();
    }
    return '';
  }

  function clienteTemCelular(cliente, celularNormalizado) {
    return CAMPOS_TELEFONE_CLIENTE.some((campo) =>
      normalizarCelular(cliente?.[campo]) === celularNormalizado
    );
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
  function decidir(clientes, opcoes = {}) {
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
    if (unicos.length > CONFIG_BUSCA.MAX_NO_POPUP && opcoes?.permitirListaGrande !== true) return { acao: 'lista-nativa', clientes: unicos };
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

  /**
   * Pesquisa o número na lista atual do CRM, sem depender do filtro textual
   * nativo (que pode não pesquisar telefone). O número não vai para o console.
   */
  async function lerCelularResponsavel(cliente, sinal) {
    const chave = String(cliente?.cnpj || '') + '|' + String(cliente?.controleCliente ?? '');
    const cacheado = cacheResponsavel.get(chave);
    if (cacheado && Date.now() - cacheado.lidoEm < CACHE_RESPONSAVEL_TTL_MS) {
      return { celular: cacheado.celular, erro: null, cache: true };
    }

    try {
      // Reutiliza primeiro o leitor já existente no Módulo 29.
      const leitor = window.__contatosGoogleLista?.lerPaginaDoCliente;
      if (typeof leitor === 'function') {
        const leitura = await leitor(cliente, sinal);
        if (!leitura?.crm) return { celular: '', erro: leitura?.erro || 'formato', cache: false };
        const celular = normalizarCelular(leitura.crm.celular);
        cacheResponsavel.set(chave, { celular, lidoEm: Date.now() });
        return { celular, erro: null, cache: false };
      }

      // Fallback para o leitor do Módulo 28 caso a API do Módulo 29 não esteja exposta.
      const util = window.__smartTableUtil;
      const contatos = window.__contatosGoogle;
      if (!util?.montarUrlCliente || typeof contatos?.lerResponsavelDoHtml !== 'function') {
        return { celular: '', erro: 'leitor-indisponivel', cache: false };
      }
      const url = util.montarUrlCliente(Number(cliente.controleCliente), cliente.cnpj);
      const resposta = await window.fetch(url, { credentials: 'same-origin', signal: sinal });
      if (!resposta.ok) return { celular: '', erro: 'http', cache: false };
      const lido = contatos.lerResponsavelDoHtml(await resposta.text());
      if (!lido || lido.erro) return { celular: '', erro: lido?.erro || 'formato', cache: false };
      const celular = normalizarCelular(lido.celular);
      cacheResponsavel.set(chave, { celular, lidoEm: Date.now() });
      return { celular, erro: null, cache: false };
    } catch (erro) {
      return { celular: '', erro: erro?.name === 'AbortError' ? 'cancelada' : 'rede', cache: false };
    }
  }

  /**
   * Pesquisa primeiro os telefones do cadastro e depois os responsáveis das
   * demais fichas (4 consultas simultâneas). A lista/fichas são somente leitura.
   * Retorna null apenas se a própria lista base não puder ser lida.
   */
  async function contarClientesPorCelular(celularNormalizado, sinal, aoProgresso) {
    fontesCelular.clear();
    diagnosticoBuscaCelular = { total: 0, fichasConsultadas: 0, falhasDeLeitura: 0 };

    try {
      const resposta = await window.fetch(urlDaListaSemBusca(), { credentials: 'same-origin', signal: sinal });
      if (!resposta.ok) return null;
      const lista = lerClientesDoHtml(await resposta.text());
      if (!Array.isArray(lista)) return null;

      const encontrados = new Map();
      for (const cliente of lista) {
        if (!clienteTemCelular(cliente, celularNormalizado)) continue;
        const chave = String(cliente?.cnpj || cliente?.controleCliente || '');
        if (!encontrados.has(chave)) {
          encontrados.set(chave, cliente);
          fontesCelular.set(chave, { fonte: 'cadastro do cliente', telefone: telefoneDoCliente(cliente) });
        }
      }

      const candidatos = [];
      const vistos = new Set();
      let falhas = 0;
      for (const cliente of lista) {
        const chave = String(cliente?.cnpj || cliente?.controleCliente || '');
        if (encontrados.has(chave) || vistos.has(chave)) continue;
        vistos.add(chave);
        if (!clienteAbrivel(cliente)) {
          falhas += 1;
          continue;
        }
        candidatos.push(cliente);
      }

      let proximo = 0;
      let feitos = 0;
      const trabalhador = async () => {
        while (proximo < candidatos.length && !sinal?.aborted) {
          const cliente = candidatos[proximo++];
          const leitura = await lerCelularResponsavel(cliente, sinal);
          feitos += 1;
          if (leitura.erro) {
            if (leitura.erro !== 'cancelada') falhas += 1;
          } else if (leitura.celular === celularNormalizado) {
            const chave = String(cliente?.cnpj || cliente?.controleCliente || '');
            if (!encontrados.has(chave)) {
              encontrados.set(chave, cliente);
              fontesCelular.set(chave, { fonte: 'responsável financeiro', telefone: leitura.celular });
            }
          }
          aoProgresso?.(feitos, candidatos.length);
        }
      };

      await Promise.all(Array.from({ length: 4 }, () => trabalhador()));
      diagnosticoBuscaCelular = {
        total: lista.length,
        fichasConsultadas: feitos,
        falhasDeLeitura: falhas,
      };
      if (sinal?.aborted) return null;
      return [...encontrados.values()];
    } catch (erro) {
      if (erro?.name !== 'AbortError') {
        console.warn('[Busca] Não consegui consultar a lista para pesquisar celular.', erro?.name);
      }
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
    const telefone = telefoneDoCliente(c);
    if (telefone) partes.push(`Celular: ${telefone}`);
    const chaveCorrespondencia = String(c?.cnpj || c?.controleCliente || '');
    const correspondencia = fontesCelular.get(chaveCorrespondencia);
    if (correspondencia?.fonte === 'responsável financeiro' && correspondencia.telefone) {
      partes.push(`Responsável financeiro: ${correspondencia.telefone}`);
    }
    if (correspondencia?.fonte) partes.push(`Correspondência: ${correspondencia.fonte}`);
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
    titulo.textContent = 'Buscar cliente (nome, CNPJ ou celular)';
    Object.assign(titulo.style, {
      fontSize: '12px', fontWeight: '600', color: '#667085', marginBottom: '8px',
      textTransform: 'uppercase', letterSpacing: '.03em',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Digite nome, CNPJ ou celular e aperte Enter...';
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

    function mostrarLista(achados, avisoExtra = '') {
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
      mostrarAviso(`${achados.length} clientes encontrados.${avisoExtra ? ' ' + avisoExtra : ''}`, avisoExtra ? '#B54708' : undefined);
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
      const celularBusca = normalizarCelular(termo);
      const controle = new window.AbortController();
      const tetoMs = celularBusca ? CONFIG_BUSCA.TIMEOUT_CELULAR_MS : CONFIG_BUSCA.TIMEOUT_MS;
      const teto = setTimeout(() => controle.abort(), tetoMs);
      cancelarBuscaEmAndamento = () => { clearTimeout(teto); controle.abort(); };
      const achados = celularBusca
        ? await contarClientesPorCelular(celularBusca, controle.signal, (feitos, total) => {
          if (overlayEl === overlay) mostrarAviso(`Consultando responsáveis financeiros: ${feitos}/${total} fichas...`);
        })
        : await contarClientes(termo, controle.signal);
      clearTimeout(teto);
      ocupado = false;
      // A caixa foi fechada (Esc, clique fora, Alt+B) enquanto buscava: não faz mais nada.
      if (overlayEl !== overlay) return;
      cancelarBuscaEmAndamento = null;

      if (celularBusca && achados === null) {
        mostrarAviso('Não foi possível consultar a lista do CRM. Tente novamente; a busca não foi concluída.', '#B42308');
        input.focus();
        return;
      }

      const decisao = decidir(achados, { permitirListaGrande: Boolean(celularBusca) });
      if (decisao.acao === 'nenhum') {
        if (celularBusca && diagnosticoBuscaCelular.falhasDeLeitura > 0) {
          mostrarAviso(`Busca incompleta: ${diagnosticoBuscaCelular.falhasDeLeitura} fichas não puderam ser verificadas; não é possível confirmar ausência de correspondência.`, '#B54708');
        } else {
          mostrarAviso(celularBusca ? CONFIG_BUSCA.TEXTO_ZERO_CELULAR : CONFIG_BUSCA.TEXTO_ZERO, '#B42318');
        }
        input.focus();
        input.select();
      } else if (decisao.acao === 'direto') {
        if (celularBusca && diagnosticoBuscaCelular.falhasDeLeitura > 0) {
          mostrarLista(decisao.clientes, `Busca parcial: ${diagnosticoBuscaCelular.falhasDeLeitura} fichas não puderam ser verificadas; confirme o cadastro antes de abrir.`);
          return;
        }
        fecharBuscaRapida();
        navegacao.ir(urlDoCliente(decisao.clientes[0]));
      } else if (decisao.acao === 'popup') {
        const extra = celularBusca && diagnosticoBuscaCelular.falhasDeLeitura > 0
          ? `Busca parcial: ${diagnosticoBuscaCelular.falhasDeLeitura} fichas não puderam ser verificadas.`
          : '';
        mostrarLista(decisao.clientes, extra);
      } else {
        if (celularBusca) {
          mostrarAviso('Não consegui abrir esses resultados com segurança porque faltam identificadores de cliente. Confira a lista do CRM manualmente.', '#B54708');
        } else {
          fecharBuscaRapida();
          buscarCliente(termo);
        }
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

  function buscarCelularExterno(valor) {
    const celular = normalizarCelular(valor);
    if (!celular) {
      window.__smartTableUtil?.toast?.('O WhatsApp não forneceu um telefone válido para pesquisar.', 5000);
      return false;
    }
    if (overlayEl) fecharBuscaRapida();
    abrirBuscaRapida();
    const campo = overlayEl?.querySelector('input');
    if (!campo) return false;
    campo.value = celular;
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    campo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  }

  document.addEventListener('smarttable:buscar-celular-whatsapp', (evento) => {
    // O bridge envia somente uma string; valida novamente antes de usar.
    buscarCelularExterno(typeof evento.detail === 'string' ? evento.detail : '');
  });

  window.__buscaRapida = Object.freeze({
    abrirBuscaRapida,
    fecharBuscaRapida,
    estaBuscaRapidaAberta,
    buscarCliente,
    decidir,
    urlDaLista,
    urlDaListaSemBusca,
    urlDoCliente,
    normalizarCelular,
    telefoneDoCliente,
    clienteTemCelular,
    lerCelularResponsavel,
    contarClientesPorCelular,
    buscarCelularExterno,
    lerClientesDoHtml,
    CONFIG_BUSCA,
    navegacao,
  });
})();
