/* =========================================================================
 * MÓDULO 42: PLANO DA CARTEIRA (COLETOR) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (18/11/2026): o painel local "CRM Diário" deve fazer o plano de regularização
 * SOZINHO e mostrar o processo. O painel não alcança o CRM (arquivo local, sem rede); quem alcança é
 * esta página. Este módulo faz o trabalho dentro do CRM e devolve (a) o andamento, etapa por etapa, e
 * (b) o plano pronto. A ponte entre as duas janelas é o userscript
 * `integracoes/plano-regularizacao-ponte.user.js`.
 *
 * O que faz, em ordem (cada passo vira um evento de andamento):
 *   1. LISTA: lê `window.CLIENTES` (na lista de clientes) ou baixa `/crm/clientes` e lê o `var CLIENTES`
 *      embutido (fato confirmado na Busca Rápida, 30/09/2026);
 *   2. TÍTULOS: baixa a página de cada cliente (4 por vez, `credentials: same-origin`, 15 s de limite
 *      cada) e lê `__TITULOS_ABERTOS__` e o parágrafo "SCPC:", como a Fila do Módulo 7;
 *   3. REGRAS: agrupa as empresas pela RAIZ DO CNPJ (matriz e filial contam como um cliente; o
 *      `grupoCliente` não serve, só bate em 72 de 161 linhas) e aplica o Módulo 41 em cada grupo;
 *   4. PLANO: ordena os grupos pelo marco mais próximo e devolve o pacote.
 *
 * Nunca classifica com dado pela metade: o cliente cuja página falha entra em `falhas` (com CNPJ e
 * motivo), não some. Só LÊ: nada é gravado no CRM. Nada de nome ou valor vai para o console.
 *
 * Carga: depois dos Módulos 1, 12, 16 e 41. Expõe window.__planoCarteira.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__planoCarteiraCarregado) return;
  window.__planoCarteiraCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Plano da Carteira');

  const CONFIG = Object.freeze({ SIMULTANEAS: 4, TIMEOUT_PAGINA_MS: 15000, VERSAO_PACOTE: 1 });

  const raizCnpj = (cnpj) => String(cnpj ?? '').replace(/\D/g, '').slice(0, 8);

  /** fetch com limite de tempo. `buscar` é trocável nos testes. */
  async function baixarTexto(url, buscar) {
    const controle = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    const limite = setTimeout(() => controle?.abort(), CONFIG.TIMEOUT_PAGINA_MS);
    try {
      const r = await buscar(url, { credentials: 'same-origin', signal: controle?.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally {
      clearTimeout(limite);
    }
  }

  const lerHtml = (html) => new window.DOMParser().parseFromString(html, 'text/html');

  /** SCPC da página baixada: a MESMA leitura do Módulo 7 / Módulo 1. */
  function lerScpcDaPagina(doc) {
    for (const p of doc.querySelectorAll('p.text-sm.text-gray-700.mt-1')) {
      const spans = p.querySelectorAll('span');
      for (let i = 0; i < spans.length; i += 1) {
        if (spans[i].textContent.trim().toUpperCase() === 'SCPC:' && spans[i + 1]) return spans[i + 1].textContent.trim().toLowerCase();
      }
    }
    return null;
  }

  /** Lista de clientes: da página (se for a lista) ou baixada de /crm/clientes. */
  async function lerListaDeClientes(buscar) {
    if (Array.isArray(window.CLIENTES)) return { clientes: window.CLIENTES, origem: 'página' };
    const doc = lerHtml(await baixarTexto(`${window.location.origin}/crm/clientes`, buscar));
    const lista = window.__smartTableUtil.lerVariavelDoScript(doc, 'CLIENTES');
    if (!Array.isArray(lista)) throw new Error('a lista de clientes não veio na página');
    return { clientes: lista, origem: 'baixada' };
  }

  /** Títulos, SCPC e os predicados (acordo, fora do relatório) de UMA empresa. Lança se faltar a fonte principal. */
  async function lerEmpresa(cliente, buscar) {
    const url = window.__smartTableUtil.montarUrlCliente(cliente.controleCliente, cliente.cnpj);
    const doc = lerHtml(await baixarTexto(url, buscar));
    const titulos = window.__smartTableUtil.lerVariavelDoScript(doc, '__TITULOS_ABERTOS__');
    if (!Array.isArray(titulos)) throw new Error('página sem os títulos');
    let acordos = null;
    try {
      acordos = window.__negociacoes?.acordosDaPaginaBaixada ? await window.__negociacoes.acordosDaPaginaBaixada(doc) : null;
    } catch {
      // Sem os acordos o título em acordo entraria no plano: melhor recusar a empresa inteira do que errar calado.
      throw new Error('não consegui ler os acordos');
    }
    return {
      titulos,
      scpc: lerScpcDaPagina(doc),
      tituloEmAcordo: acordos?.tituloEmAcordo,
      tituloForaDoRelatorio: window.__alertaCliente?.predicadoForaDoRelatorio?.(cliente.cnpj),
    };
  }

  /** Roda `trabalho` sobre `itens` com no máximo `n` ao mesmo tempo; para ao cancelar. */
  async function emParalelo(itens, n, trabalho, cancelado) {
    let proximo = 0;
    const operario = async () => {
      while (!cancelado() && proximo < itens.length) {
        const i = proximo;
        proximo += 1;
        await trabalho(itens[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, operario));
  }

  /**
   * @param {{onEvento?: Function, sinal?: {aborted: boolean}, hoje?: Date, buscar?: Function}} [opcoes]
   *   Eventos: {tipo:'etapa', id, estado:'andamento'|'ok'|'erro', texto} e
   *   {tipo:'progresso', feito, total, falhas}.
   * @returns {Promise<object>} O pacote do plano (versão 1).
   */
  async function coletar(opcoes = {}) {
    const { onEvento = () => {}, sinal = { aborted: false }, buscar = (...a) => window.fetch(...a) } = opcoes;
    const util = window.__smartTableUtil;
    const plano = window.__planoRegularizacao;
    if (!plano) throw new Error('Módulo 41 (regras do plano) não carregado.');
    const hoje = util.normalizarData(opcoes.hoje ?? new Date());
    const etapa = (id, estado, texto) => onEvento({ tipo: 'etapa', id, estado, texto });
    const cancelado = () => sinal.aborted === true;

    // 1. Lista
    etapa('lista', 'andamento', 'Lendo a lista de clientes do CRM');
    let lista;
    try {
      lista = await lerListaDeClientes(buscar);
    } catch (erro) {
      etapa('lista', 'erro', `Não consegui ler a lista de clientes (${erro.message})`);
      throw erro;
    }
    const clientes = lista.clientes.filter((c) => c && c.cnpj && c.controleCliente != null);
    const descartados = lista.clientes.length - clientes.length;
    etapa('lista', 'ok', `${clientes.length} empresas com dívida na lista (${lista.origem})${descartados ? `, ${descartados} sem CNPJ ou controle foram ignoradas` : ''}`);

    // 2. Títulos
    etapa('titulos', 'andamento', 'Lendo os títulos de cada empresa');
    const lidas = new Map();
    const falhas = [];
    let feito = 0;
    await emParalelo(clientes, CONFIG.SIMULTANEAS, async (cliente) => {
      try {
        lidas.set(cliente.cnpj, await lerEmpresa(cliente, buscar));
      } catch (erro) {
        falhas.push({ cnpj: cliente.cnpj, motivo: String(erro?.message || erro).slice(0, 80) });
      }
      feito += 1;
      onEvento({ tipo: 'progresso', feito, total: clientes.length, falhas: falhas.length });
    }, cancelado);
    if (cancelado()) {
      etapa('titulos', 'erro', 'Cancelado antes de terminar');
      throw new Error('cancelado');
    }
    const totalTitulos = [...lidas.values()].reduce((s, e) => s + e.titulos.length, 0);
    etapa('titulos', falhas.length ? 'erro' : 'ok', `${totalTitulos} títulos em ${lidas.size} empresas${falhas.length ? `; ${falhas.length} empresa(s) não puderam ser lidas e ficam de fora` : ''}`);

    // 3. Regras (agrupa pela raiz do CNPJ)
    etapa('regras', 'andamento', 'Aplicando as regras de cartório, SCPC, prazo do dia 6, juros e multa');
    const porGrupo = new Map();
    clientes.forEach((c) => {
      if (!lidas.has(c.cnpj)) return;
      const chave = raizCnpj(c.cnpj);
      if (!porGrupo.has(chave)) porGrupo.set(chave, []);
      porGrupo.get(chave).push(c);
    });
    const grupos = [];
    porGrupo.forEach((empresas, chave) => {
      const g = plano.planejarGrupo(empresas.map((c) => ({ id: c.cnpj, fonte: lidas.get(c.cnpj) })), hoje);
      if (g.empresas.every(({ plano: p }) => p.titulos.length === 0 && p.foraDoPlano.length === 0 && p.ignorados.length === 0)) return;
      const nomes = new Map(empresas.map((c) => [c.cnpj, String(c.razaoSocial ?? '').slice(0, 80)]));
      grupos.push({
        grupoId: chave,
        nome: nomes.get(empresas[0].cnpj),
        empresas: g.empresas.map(({ id, plano: p }) => ({ cnpj: id, nome: nomes.get(id), ...p })),
        cronograma: g.cronograma,
        resumo: g.resumo,
      });
    });
    etapa('regras', 'ok', `${grupos.length} grupos com plano`);

    // 4. Plano
    etapa('plano', 'andamento', 'Ordenando os grupos pelo marco mais próximo');
    const semMarco = '9999-12-31';
    grupos.sort((a, b) => (a.resumo.proximoMarco?.data ?? semMarco).localeCompare(b.resumo.proximoMarco?.data ?? semMarco)
      || b.resumo.totalVencidoHoje - a.resumo.totalVencidoHoje || a.grupoId.localeCompare(b.grupoId));
    const soma = (campo) => Math.round(grupos.reduce((s, g) => s + Math.round(g.resumo[campo] * 100), 0)) / 100;
    const pacote = {
      versao: CONFIG.VERSAO_PACOTE,
      geradoEm: new Date().toISOString(),
      hoje: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
      resumo: {
        grupos: grupos.length,
        empresas: lidas.size,
        titulos: totalTitulos,
        totalVencidoHoje: soma('totalVencidoHoje'),
        totalAVencer: soma('totalAVencer'),
        custoPorDia: soma('custoPorDia'),
        falhas: falhas.length,
      },
      grupos,
      falhas,
    };
    etapa('plano', 'ok', 'Plano pronto');
    return pacote;
  }

  window.__planoCarteira = { CONFIG, coletar, lerScpcDaPagina, raizCnpj };
})();
