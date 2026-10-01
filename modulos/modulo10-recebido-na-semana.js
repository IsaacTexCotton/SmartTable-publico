/* =========================================================================
 * MÓDULO 10: RECEBIDO NA SEMANA (Alt+D) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Mostra quanto entrou na carteira do Isaac e da Bianca na semana vigente
 * (SÁBADO a SEXTA), com botão para a semana anterior.
 *
 * Depósitos: GET /api/crm/dashboard-consolidado?inicio=&fim= (já agregado por
 * usuário; uma chamada só). É dado financeiro real, não inferência.
 *
 * SÃO DOIS NÚMEROS DE ORIGEM DIFERENTE (definição do usuário):
 *   - Depósitos           -> recuperado por NEGOCIAÇÕES (seção `depositos`).
 *   - Promessas cumpridas -> recuperado por PROMESSAS (lista, não o consolidado).
 * O TOTAL RECUPERADO soma os dois (decisão do usuário). Nada na API prova que
 * os conjuntos sejam disjuntos e o endpoint não permite conferir (só traz
 * totais por usuário). Se o total parecer alto, sobreposição é o primeiro
 * suspeito; por isso as duas parcelas continuam na tela.
 *
 * PROMESSAS CUMPRIDAS: o consolidado agrupa pela PROMESSA, não pelo pagamento,
 * então a soma sai da lista GET /api/crm/promessas (a da tela /crm/promessas):
 *   - entram CUMPRIDA, PARCIAL e CUMPRIDA_PARCIAL (valor pago; nas parciais, o
 *     efetivamente pago);
 *   - a semana é a do DIA DO PAGAMENTO estimado (abaixo). Limite conhecido:
 *     verificar de novo uma parcial move o valor de semana;
 *   - o crédito é de quem CRIOU a promessa (`usuarioCriacao`, "ISAAC.03876");
 *   - a busca vai de DIAS_RETROATIVOS antes do início da semana até
 *     DIAS_ADIANTE depois da sexta (promessa agendada para a frente e paga
 *     antes tem data prometida fora da semana). Verificação de promessa mais
 *     antiga que isso fica de fora: aumente DIAS_RETROATIVOS.
 *
 * DATA DO PAGAMENTO (decisão do usuário): o CRM não guarda o dia do pagamento.
 * A verificação é automática, de madrugada, no dia útil DEPOIS do pagamento
 * (diagnóstico do usuário: 95% de um só verificador, 90% entre 0h e 7h). Então
 * o pagamento é estimado como o DIA ÚTIL ANTERIOR à verificação (fim de semana
 * e feriado pulados, calendário do Módulo 1): verificada na segunda, paga na
 * sexta (semana ANTERIOR). Pagamento de sábado/domingo é estimado como sexta.
 * A data da verificação sozinha NÃO decide a semana.
 *
 * PROMESSAS FEITAS HOJE: bloco à parte com quantidade e valor PROMETIDO das
 * promessas CRIADAS hoje (`dataCriacao`), de qualquer status e data prometida,
 * no nome de quem criou. É dinheiro prometido: NÃO entra no Total recuperado.
 * O valor pode incluir juros e multa (como no CRM).
 *
 * ONDE COLAR: depois do Módulo 0 (usa semanaSabadoASexta, dataIso,
 * primeiroNomeDeUsuario e formatarMoeda de lá). Usa o calendário do Módulo 1
 * (`window.__avisoCobranca.feriados`) quando presente.
 * Expõe: window.__recebidoSemana (ver o fim do arquivo).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__recebidoSemanaCarregado) return;
  window.__recebidoSemanaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Recebido na Semana');

  const CONFIG_RECEBIDO = {
    ENDPOINT: '/api/crm/dashboard-consolidado',
    ID_PAINEL: 'smarttable-painel-recebido',
    // Camada dos popups nossos: acima do menu dos atalhos e do cabeçalho do CRM (ver Módulo 0).
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
    TIMEOUT_MS: 15000,

    // Quem aparece no painel, pelo PRIMEIRO NOME (ver primeiroNomeDeUsuario no
    // Módulo 0). Minúsculas, sem acento. Quem não teve movimento aparece com
    // R$ 0,00: nunca some da tabela nem vira erro.
    PESSOAS: ['isaac', 'bianca'],

    // Cada métrica aponta para sua seção e seu campo na resposta da API.
    METRICAS: [
      {
        chave: 'depositos',
        rotulo: 'Depósitos',
        detalhe: 'recuperado por negociações',
        secao: 'depositos',
        campo: 'valor',
      },
      {
        chave: 'promessasCumpridas',
        rotulo: 'Promessas cumpridas',
        detalhe: 'recuperado por promessas (pagamento estimado: dia útil anterior à verificação)',
        // Não vem do consolidado: ver "PROMESSAS CUMPRIDAS" no cabeçalho.
        origem: 'promessasVerificadas',
      },
    ],

    // Lista de promessas do CRM (mesma da tela /crm/promessas; confirmado no CRM).
    PROMESSAS: {
      ENDPOINT: '/api/crm/promessas',
      TAMANHO_PAGINA: 1000,
      MAX_PAGINAS: 10,
      // Data prometida a partir de N dias antes do início da semana.
      DIAS_RETROATIVOS: 60,
      // ...e até N dias depois da sexta (promessa agendada pra frente e paga antes;
      // e as criadas hoje para a semana que vem).
      DIAS_ADIANTE: 90,
      // Cumprida + o efetivamente pago das parciais (definição do usuário).
      STATUS_QUE_ENTRAM: ['CUMPRIDA', 'PARCIAL', 'CUMPRIDA_PARCIAL'],
    },
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    destaque: '#1B6B4A',
    erro: '#B42318',
    fundo: '#ffffff',
  };

  // Os testes trocam `agora` para fixar o dia.
  const relogio = { agora: () => new Date() };
  let painelEl = null;
  // true = semana anterior (botão do painel); volta a false quando o Alt+D abre do zero.
  let semanaAnterior = false;

  /** @returns {object|null} */
  function util() {
    return window.__smartTableUtil ?? null;
  }

  /**
   * Busca o consolidado de um período.
   *
   * @param {string} inicioIso AAAA-MM-DD.
   * @param {string} fimIso AAAA-MM-DD.
   * @returns {Promise<object>} O objeto `data` da resposta.
   * @throws {Error} Com mensagem já legível pra tela.
   */
  async function buscarConsolidado(inicioIso, fimIso) {
    const url = `${CONFIG_RECEBIDO.ENDPOINT}?inicio=${encodeURIComponent(inicioIso)}&fim=${encodeURIComponent(fimIso)}`;
    const corpo = await buscarJson(url);
    if (!corpo?.data) throw new Error('A resposta do CRM veio sem o campo "data".');
    return corpo.data;
  }

  /**
   * GET de um endereço do CRM, com timeout, e o corpo JSON inteiro.
   * Só leitura. Erros já saem com mensagem legível pra tela.
   *
   * @param {string} url Caminho + parâmetros, mesma origem.
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async function buscarJson(url) {
    // AbortController: sem timeout, backend lento deixa o painel em
    // "Carregando..." para sempre.
    // window.fetch/window.AbortController com prefixo EXPLÍCITO: identificador
    // livre resolve para o global do Node nos testes (que recusa URL relativa).
    const controle = new window.AbortController();
    const relogio = setTimeout(() => controle.abort(), CONFIG_RECEBIDO.TIMEOUT_MS);

    let resposta;
    try {
      resposta = await window.fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: controle.signal,
      });
    } catch (erro) {
      throw new Error(
        erro.name === 'AbortError'
          ? `O CRM não respondeu em ${CONFIG_RECEBIDO.TIMEOUT_MS / 1000}s.`
          : `Não consegui falar com o CRM: ${erro.message}`
      );
    } finally {
      clearTimeout(relogio);
    }

    if (!resposta.ok) {
      throw new Error(
        resposta.status === 401 || resposta.status === 403
          ? 'O CRM recusou o acesso (sessão expirada?). Recarregue a página e entre de novo.'
          : `O CRM respondeu ${resposta.status}.`
      );
    }

    try {
      return await resposta.json();
    } catch {
      throw new Error('A resposta do CRM não veio em JSON.');
    }
  }

  /* ---------------------------------------------------------------------
   * PROMESSAS CUMPRIDAS: pelo dia estimado do pagamento, no crédito de quem criou
   * --------------------------------------------------------------------- */

  /** AAAA-MM-DD -> Date ao meio-dia (a convenção de data do projeto). */
  function dataDeIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0) : null;
  }

  /** Feriados (AAAA-MM-DD) do ano, do calendário do Módulo 1; sem ele, só o fim de semana é pulado. */
  function feriadosDoAno(ano) {
    try {
      const lista = window.__avisoCobranca?.feriados?.(ano);
      return Array.isArray(lista) ? lista : [];
    } catch (_) {
      return [];
    }
  }

  function ehDiaUtilIso(iso) {
    const d = dataDeIso(iso);
    if (!d || d.getDay() === 0 || d.getDay() === 6) return false;
    return !feriadosDoAno(d.getFullYear()).includes(iso);
  }

  /**
   * O dia útil imediatamente ANTERIOR a uma data (fim de semana e feriado pulados).
   * @param {string} iso AAAA-MM-DD
   * @returns {string|null}
   */
  function diaUtilAnteriorIso(iso) {
    const d = dataDeIso(iso);
    if (!d) return null;
    for (let i = 0; i < 30; i += 1) {
      d.setDate(d.getDate() - 1);
      const dia = util().dataIso(d);
      if (ehDiaUtilIso(dia)) return dia;
    }
    return null;
  }

  /**
   * O dia (estimado) em que o cliente pagou: o dia útil anterior à verificação.
   * @param {object} item Promessa da API.
   * @returns {string|null} AAAA-MM-DD, ou null sem verificação válida.
   */
  function diaDoPagamentoDaPromessa(item) {
    const verificacao = String(item?.dataVerificacao ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(verificacao) ? diaUtilAnteriorIso(verificacao) : null;
  }

  /** A promessa entra na conta da semana? (status que entra + dia do pagamento estimado dentro da semana) */
  function promessaEntraNaSemana(item, semana) {
    if (!CONFIG_RECEBIDO.PROMESSAS.STATUS_QUE_ENTRAM.includes(item?.status)) return false;
    const dia = diaDoPagamentoDaPromessa(item);
    return dia !== null && dia >= semana.inicioIso && dia <= semana.fimIso;
  }

  /**
   * Soma, por pessoa, o valor pago das promessas que entram na semana.
   * Função pura: separada da rede pra ser testada sem navegador.
   *
   * @param {object[]} itens Promessas da lista da API.
   * @param {{inicioIso: string, fimIso: string}} semana
   * @param {Object<string, number>} [valoresDoDetalhe] valorPago lido no detalhe (por id), pra quem veio sem valor na lista.
   * @returns {{porPessoa: {nome: string, valor: number, quantidade: number, presente: boolean}[], semValor: number}}
   */
  function apurarPromessas(itens, semana, valoresDoDetalhe = {}) {
    const porPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => ({ nome, valor: 0, quantidade: 0, presente: false }));
    let semValor = 0;
    (Array.isArray(itens) ? itens : []).forEach((item) => {
      if (!promessaEntraNaSemana(item, semana)) return;
      // Crédito de quem CRIOU a promessa (decisão do usuário), não de quem verificou.
      const pessoa = porPessoa.find((p) => p.nome === util()?.primeiroNomeDeUsuario(item.usuarioCriacao));
      if (!pessoa) return;
      const bruto = typeof item.valorPago === 'number' ? item.valorPago : valoresDoDetalhe[item.id];
      pessoa.presente = true;
      pessoa.quantidade += 1;
      if (typeof bruto === 'number' && Number.isFinite(bruto)) pessoa.valor += bruto;
      else semValor += 1;
    });
    return { porPessoa, semValor };
  }

  /**
   * Promessas CRIADAS no dia (quantidade e valor prometido), por pessoa: as de qualquer
   * status e para qualquer data prometida, no nome de quem criou. Função pura.
   *
   * @param {object[]} itens Promessas da lista da API.
   * @param {string} hojeIso AAAA-MM-DD.
   * @returns {{porPessoa: {nome: string, quantidade: number, valor: number}[], semValor: number}}
   */
  function apurarPromessasFeitasNoDia(itens, hojeIso) {
    const porPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => ({ nome, quantidade: 0, valor: 0 }));
    let semValor = 0;
    (Array.isArray(itens) ? itens : []).forEach((item) => {
      if (String(item?.dataCriacao ?? '').slice(0, 10) !== hojeIso) return;
      const pessoa = porPessoa.find((p) => p.nome === util()?.primeiroNomeDeUsuario(item.usuarioCriacao));
      if (!pessoa) return;
      pessoa.quantidade += 1;
      if (typeof item.valorPrometido === 'number' && Number.isFinite(item.valorPrometido)) pessoa.valor += item.valorPrometido;
      else semValor += 1;
    });
    return { porPessoa, semValor };
  }

  /**
   * Busca na API as promessas da janela e apura a semana.
   *
   * Serve para qualquer PERÍODO (o Alt+M usa para o mês): a janela vai de
   * DIAS_RETROATIVOS antes do início até DIAS_ADIANTE depois do fim.
   *
   * @param {{inicio: Date, inicioIso: string, fimIso: string}} semana
   * @param {Date} [hoje] Padrão: agora (o dia das "promessas feitas hoje").
   * @returns {Promise<{porPessoa: object[], semValor: number, feitasHoje: object}>}
   * @throws {Error} Com mensagem já legível pra tela.
   */
  async function buscarPromessasDaSemana(semana, hoje = new Date()) {
    const c = CONFIG_RECEBIDO.PROMESSAS;
    const desde = new Date(semana.inicio);
    desde.setDate(desde.getDate() - c.DIAS_RETROATIVOS);
    const desdeIso = util().dataIso(desde);
    const ate = dataDeIso(semana.fimIso);
    if (!ate) throw new Error('Período inválido para a busca de promessas.');
    ate.setDate(ate.getDate() + c.DIAS_ADIANTE);
    const ateIso = util().dataIso(ate);

    const itens = [];
    let completo = false;
    for (let pagina = 0; pagina < c.MAX_PAGINAS && !completo; pagina += 1) {
      const url = `${c.ENDPOINT}?page=${pagina}&size=${c.TAMANHO_PAGINA}&dataInicio=${desdeIso}&dataFim=${ateIso}`;
      const corpo = await buscarJson(url);
      if (!Array.isArray(corpo?.data)) throw new Error('A lista de promessas do CRM veio em formato inesperado.');
      itens.push(...corpo.data);
      // Com totalPages na resposta, só ele decide: se a API limitasse a página
      // abaixo do pedido, "página curta" pareceria o fim e perderia páginas em silêncio.
      const brutoTotal = corpo.pagination?.totalPages;
      const totalPaginas = brutoTotal === null || brutoTotal === '' ? NaN : Number(brutoTotal);
      completo = Number.isFinite(totalPaginas)
        ? pagina + 1 >= totalPaginas
        : corpo.data.length < c.TAMANHO_PAGINA;
    }
    // Melhor recusar do que somar só parte da lista e mostrar como se fosse tudo.
    if (!completo) throw new Error(`Há promessas demais na janela (mais de ${c.MAX_PAGINAS * c.TAMANHO_PAGINA}): a soma ficaria incompleta.`);

    // Quem entra na semana mas veio sem valor pago na lista: lê o detalhe (uma promessa por vez).
    const valoresDoDetalhe = {};
    for (const item of itens) {
      if (!promessaEntraNaSemana(item, semana) || typeof item.valorPago === 'number') continue;
      try {
        const detalhe = await buscarJson(`${c.ENDPOINT}/${encodeURIComponent(item.id)}`);
        if (typeof detalhe?.data?.valorPago === 'number') valoresDoDetalhe[item.id] = detalhe.data.valorPago;
      } catch (_) { /* fica sem valor e é contada em semValor */ }
    }
    return {
      ...apurarPromessas(itens, semana, valoresDoDetalhe),
      feitasHoje: apurarPromessasFeitasNoDia(itens, util().dataIso(hoje)),
    };
  }

  /**
   * O valor de uma métrica para uma pessoa.
   *
   * Pessoa sem movimento NÃO aparece em porUsuario (confirmado no CRM).
   * Ausência é ZERO, nunca erro nem linha em branco.
   *
   * @param {object} dados O `data` da API.
   * @param {object} metrica Entrada de CONFIG_RECEBIDO.METRICAS.
   * @param {string} primeiroNome Já em minúsculas.
   * @returns {{valor: number, presente: boolean}}
   */
  function valorDaPessoa(dados, metrica, primeiroNome) {
    const u = util();
    const lista = dados?.[metrica.secao]?.porUsuario;
    if (!Array.isArray(lista)) return { valor: 0, presente: false };

    const linha = lista.find(
      (item) => u?.primeiroNomeDeUsuario(item?.usuario) === primeiroNome
    );
    if (!linha) return { valor: 0, presente: false };

    const bruto = linha[metrica.campo];
    return { valor: typeof bruto === 'number' && Number.isFinite(bruto) ? bruto : 0, presente: true };
  }

  /**
   * Monta a tabela de números (aritmética do módulo, separada do DOM).
   *
   * @param {object} dados O `data` do consolidado.
   * @param {{porPessoa: object[], semValor?: number}|{erro: string}} [promessas] A apuração de
   *   promessas (buscarPromessasDaSemana). Com `erro`, a métrica aparece como indisponível
   *   e o total NÃO é mostrado (melhor nada do que um total que esconde parte). Ausente =
   *   sem promessas (zero por ausência), como nos testes puros.
   * @returns {{metricas: object[], pessoas: string[]}}
   */
  function montarResumo(dados, promessas) {
    const metricas = CONFIG_RECEBIDO.METRICAS.map((metrica) => {
      if (metrica.origem === 'promessasVerificadas') {
        const porPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => {
          const achada = promessas?.porPessoa?.find((p) => p.nome === nome);
          return { nome, valor: achada?.valor ?? 0, presente: achada?.presente === true };
        });
        return {
          ...metrica,
          porPessoa,
          total: porPessoa.reduce((soma, p) => soma + p.valor, 0),
          semValor: promessas?.semValor ?? 0,
          erro: promessas?.erro ?? null,
        };
      }
      const porPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => ({
        nome,
        ...valorDaPessoa(dados, metrica, nome),
      }));
      return {
        ...metrica,
        porPessoa,
        total: porPessoa.reduce((soma, p) => soma + p.valor, 0),
      };
    });

    // TOTAL RECUPERADO = depósitos + promessas cumpridas (decisão do usuário:
    // origens diferentes; sobreposição não é verificável, ver cabeçalho).
    const totalPorPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => ({
      nome,
      valor: metricas.reduce(
        (soma, m) => soma + (m.porPessoa.find((p) => p.nome === nome)?.valor ?? 0),
        0
      ),
    }));

    // Promessas feitas hoje: bloco à parte, FORA do total recuperado (é valor prometido).
    const feitas = promessas?.feitasHoje?.porPessoa ?? [];
    const feitasHoje = {
      porPessoa: CONFIG_RECEBIDO.PESSOAS.map((nome) => ({
        nome,
        quantidade: feitas.find((p) => p.nome === nome)?.quantidade ?? 0,
        valor: feitas.find((p) => p.nome === nome)?.valor ?? 0,
      })),
      semValor: promessas?.feitasHoje?.semValor ?? 0,
      erro: promessas?.erro ?? null,
    };
    feitasHoje.totalQuantidade = feitasHoje.porPessoa.reduce((t, p) => t + p.quantidade, 0);
    feitasHoje.totalValor = feitasHoje.porPessoa.reduce((t, p) => t + p.valor, 0);

    return {
      metricas,
      feitasHoje,
      pessoas: CONFIG_RECEBIDO.PESSOAS,
      totalPorPessoa,
      totalGeral: totalPorPessoa.reduce((soma, p) => soma + p.valor, 0),
      // Uma métrica sem leitura: o total ficaria parcial sem dizer, então a tela não o mostra.
      totalIndisponivel: metricas.some((m) => m.erro),
    };
  }

  /* ---------------------------------------------------------------------
   * DESENHO
   * --------------------------------------------------------------------- */

  /** @param {string} texto @param {object} estilo @returns {HTMLElement} */
  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  /** @returns {HTMLElement} O corpo, que é trocado quando os dados chegam. */
  function criarEsqueleto(semana, anterior = false) {
    painelEl = document.createElement('div');
    painelEl.id = CONFIG_RECEBIDO.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      bottom: '112px',
      left: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_RECEBIDO.Z_INDEX_POPUP,
      width: '460px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
    });

    const cabecalho = criarDiv('', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' });
    const titulo = criarDiv(anterior ? 'Entrou na semana anterior' : 'Entrou na semana', {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px',
    });
    cabecalho.appendChild(titulo);
    const alternar = document.createElement('button');
    alternar.type = 'button';
    alternar.dataset.papel = 'alternar-semana';
    alternar.textContent = anterior ? 'semana atual ▶' : '◀ semana anterior';
    alternar.setAttribute('aria-label', anterior ? 'Voltar para a semana atual' : 'Ver a semana anterior');
    Object.assign(alternar.style, {
      border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.texto, borderRadius: '6px',
      padding: '3px 8px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
    });
    alternar.addEventListener('click', () => { semanaAnterior = !anterior; abrirPainel(); });
    cabecalho.appendChild(alternar);
    painelEl.appendChild(cabecalho);

    const periodo = criarDiv(
      `${semana.inicio.toLocaleDateString('pt-BR')} (sáb) a ${semana.fim.toLocaleDateString('pt-BR')} (sex)`,
      { color: CORES.apagado, fontSize: '11.5px', marginTop: '2px', paddingBottom: '8px', borderBottom: `1px solid ${CORES.linha}` }
    );
    painelEl.appendChild(periodo);

    const corpo = criarDiv('', { paddingTop: '4px' });
    corpo.dataset.papel = 'corpo';
    painelEl.appendChild(corpo);

    const dica = criarDiv('Alt+D ou Esc pra fechar', {
      marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
    });
    painelEl.appendChild(dica);

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
    return corpo;
  }

  /**
   * Uma métrica: cabeçalho, uma linha por pessoa e o total das duas.
   * @param {object} metrica Item de montarResumo().metricas.
   * @returns {HTMLElement}
   */
  function criarBlocoMetrica(metrica) {
    const u = util();
    const bloco = criarDiv('', { marginBottom: '14px' });

    bloco.appendChild(criarDiv(metrica.rotulo, {
      color: CORES.tinta, fontWeight: '600', fontSize: '13px',
    }));
    bloco.appendChild(criarDiv(metrica.detalhe, {
      color: CORES.apagado, fontSize: '11px', marginBottom: '6px',
    }));

    if (metrica.erro) {
      // Falha na leitura desta métrica: diz aqui, sem números (um zero pareceria "não entrou nada").
      bloco.appendChild(criarDiv(metrica.erro, { color: CORES.erro, fontSize: '12px', lineHeight: '1.5', padding: '3px 0' }));
      return bloco;
    }

    metrica.porPessoa.forEach((pessoa) => {
      const linha = criarDiv('', {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '3px 0',
      });
      const nome = criarDiv(pessoa.nome.charAt(0).toUpperCase() + pessoa.nome.slice(1), {
        color: CORES.texto,
      });
      // A tela diz que é zero por ausência, não por busca que falhou.
      if (!pessoa.presente) {
        nome.textContent += ' (sem movimento)';
        nome.style.color = CORES.apagado;
      }
      linha.appendChild(nome);
      linha.appendChild(criarDiv(u?.formatarMoeda(pessoa.valor) ?? String(pessoa.valor), {
        fontFamily: 'ui-monospace, monospace', color: CORES.texto,
      }));
      bloco.appendChild(linha);
    });

    const total = criarDiv('', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginTop: '4px', paddingTop: '5px', borderTop: `1px solid ${CORES.linha}`,
    });
    total.appendChild(criarDiv('Os dois', { color: CORES.tinta, fontWeight: '600' }));
    total.appendChild(criarDiv(u?.formatarMoeda(metrica.total) ?? String(metrica.total), {
      fontFamily: 'ui-monospace, monospace', color: CORES.destaque, fontWeight: '700',
    }));
    bloco.appendChild(total);

    if (metrica.semValor > 0) {
      bloco.appendChild(criarDiv(
        `${metrica.semValor} promessa(s) verificada(s) sem valor pago lido: o total pode estar baixo.`,
        { color: CORES.erro, fontSize: '11px', marginTop: '4px' }
      ));
    }

    return bloco;
  }

  /**
   * O bloco do TOTAL RECUPERADO: depósitos + promessas cumpridas, por pessoa e no conjunto.
   *
   * @param {object} resumo Saída de montarResumo().
   * @returns {HTMLElement}
   */
  function criarBlocoTotal(resumo) {
    const u = util();
    const bloco = criarDiv('', {
      marginTop: '2px', paddingTop: '10px', borderTop: `2px solid ${CORES.tinta}`,
    });

    bloco.appendChild(criarDiv('Total recuperado', {
      color: CORES.tinta, fontWeight: '700', fontSize: '13px',
    }));
    // A composição fica escrita na tela.
    bloco.appendChild(criarDiv('depósitos + promessas cumpridas', {
      color: CORES.apagado, fontSize: '11px', marginBottom: '6px',
    }));

    if (resumo.totalIndisponivel) {
      bloco.appendChild(criarDiv('Indisponível: uma das leituras falhou (veja acima).', { color: CORES.erro, fontSize: '12px', padding: '3px 0' }));
      return bloco;
    }

    resumo.totalPorPessoa.forEach((pessoa) => {
      const linha = criarDiv('', {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0',
      });
      linha.appendChild(criarDiv(pessoa.nome.charAt(0).toUpperCase() + pessoa.nome.slice(1), {
        color: CORES.texto,
      }));
      linha.appendChild(criarDiv(u?.formatarMoeda(pessoa.valor) ?? String(pessoa.valor), {
        fontFamily: 'ui-monospace, monospace', color: CORES.texto,
      }));
      bloco.appendChild(linha);
    });

    const geral = criarDiv('', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginTop: '5px', paddingTop: '6px', borderTop: `1px solid ${CORES.linha}`,
    });
    geral.appendChild(criarDiv('Os dois', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    geral.appendChild(criarDiv(u?.formatarMoeda(resumo.totalGeral) ?? String(resumo.totalGeral), {
      fontFamily: 'ui-monospace, monospace', color: CORES.destaque, fontWeight: '700', fontSize: '15px',
    }));
    bloco.appendChild(geral);

    return bloco;
  }

  const textoPromessas = (n) => `${n} ${n === 1 ? 'promessa' : 'promessas'}`;

  /**
   * O bloco "Promessas feitas hoje": quantidade e valor prometido das criadas hoje.
   * Fica DEPOIS do total e não entra nele (é dinheiro prometido, não recuperado).
   *
   * @param {object} feitas Saída de montarResumo().feitasHoje.
   * @returns {HTMLElement}
   */
  function criarBlocoFeitasHoje(feitas) {
    const u = util();
    const bloco = criarDiv('', { marginTop: '14px', paddingTop: '10px', borderTop: `1px solid ${CORES.linha}` });
    bloco.appendChild(criarDiv('Promessas feitas hoje', { color: CORES.tinta, fontWeight: '600', fontSize: '13px' }));
    bloco.appendChild(criarDiv('criadas hoje, pelo valor prometido (não é dinheiro que entrou)', {
      color: CORES.apagado, fontSize: '11px', marginBottom: '6px',
    }));
    if (feitas.erro) {
      bloco.appendChild(criarDiv(feitas.erro, { color: CORES.erro, fontSize: '12px', lineHeight: '1.5', padding: '3px 0' }));
      return bloco;
    }
    const linha = (nome, quantidade, valor, estilo = {}) => {
      const el = criarDiv('', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', ...estilo });
      el.appendChild(criarDiv(nome, { color: CORES.texto }));
      el.appendChild(criarDiv(`${textoPromessas(quantidade)} · ${u?.formatarMoeda(valor) ?? String(valor)}`, { fontFamily: 'ui-monospace, monospace', color: CORES.texto }));
      return el;
    };
    feitas.porPessoa.forEach((p) => bloco.appendChild(linha(p.nome.charAt(0).toUpperCase() + p.nome.slice(1), p.quantidade, p.valor)));
    const geral = linha('Os dois', feitas.totalQuantidade, feitas.totalValor, { marginTop: '4px', paddingTop: '5px', borderTop: `1px solid ${CORES.linha}` });
    geral.firstChild.style.color = CORES.tinta;
    geral.firstChild.style.fontWeight = '600';
    bloco.appendChild(geral);
    if (feitas.semValor > 0) {
      bloco.appendChild(criarDiv(`${feitas.semValor} promessa(s) sem valor prometido lido: o valor pode estar baixo.`, { color: CORES.erro, fontSize: '11px', marginTop: '4px' }));
    }
    return bloco;
  }

  /** @param {HTMLElement} corpo @param {object} resumo */
  function desenharResumo(corpo, resumo, { semanaAnterior: anterior = false } = {}) {
    corpo.textContent = '';
    resumo.metricas.forEach((metrica) => corpo.appendChild(criarBlocoMetrica(metrica)));

    corpo.appendChild(criarBlocoTotal(resumo));
    // "Promessas feitas hoje" é do dia de hoje: não faz sentido na semana anterior.
    if (!anterior) corpo.appendChild(criarBlocoFeitasHoje(resumo.feitasHoje));
  }

  async function abrirPainel() {
    window.__smartTableUtil?.fecharOutrosPaineis?.('recebidoSemana');

    const u = util();
    if (!u || typeof u.semanaSabadoASexta !== 'function') {
      painelEl = criarDiv('O Módulo 0 não carregou — não dá pra calcular a semana.', {
        position: 'fixed', bottom: '112px', left: '16px', background: CORES.fundo,
        border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
        color: CORES.erro, fontSize: '13px', zIndex: CONFIG_RECEBIDO.Z_INDEX_POPUP,
        fontFamily: 'system-ui, sans-serif',
      });
      painelEl.id = CONFIG_RECEBIDO.ID_PAINEL;
      document.body.appendChild(painelEl);
      window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
      return;
    }

    const anterior = semanaAnterior;
    // Semana anterior: a semana que contém o mesmo dia da semana passada.
    const referencia = new Date(relogio.agora());
    if (anterior) referencia.setDate(referencia.getDate() - 7);
    const semana = u.semanaSabadoASexta(referencia);
    // Trocar de semana pelo botão refaz o painel (o de antes sai sem devolver nada a ninguém).
    if (painelEl) { painelEl.remove(); painelEl = null; }
    const corpo = criarEsqueleto(semana, anterior);
    corpo.appendChild(criarDiv('Consultando o CRM...', { color: CORES.apagado, padding: '6px 0' }));

    try {
      // As duas leituras andam juntas; se só a das promessas falhar, os depósitos
      // aparecem e as promessas mostram o erro (nunca um zero no lugar).
      const [rDados, rPromessas] = await Promise.allSettled([
        buscarConsolidado(semana.inicioIso, semana.fimIso),
        buscarPromessasDaSemana(semana, relogio.agora()),
      ]);
      // O painel pode ter sido fechado enquanto a resposta vinha.
      if (!painelEl || !corpo.isConnected) return;
      if (rDados.status === 'rejected') throw rDados.reason;
      let promessas;
      if (rPromessas.status === 'fulfilled') {
        promessas = rPromessas.value;
      } else {
        console.warn('[Recebido na semana] Promessas:', rPromessas.reason?.message);
        promessas = { erro: `Não consegui ler as promessas: ${rPromessas.reason?.message ?? 'erro desconhecido'}` };
      }
      desenharResumo(corpo, montarResumo(rDados.value, promessas), { semanaAnterior: anterior });
    } catch (erro) {
      if (!painelEl || !corpo.isConnected) return;
      corpo.textContent = '';
      corpo.appendChild(criarDiv(erro.message, { color: CORES.erro, lineHeight: '1.5', padding: '6px 0' }));
      corpo.appendChild(criarDiv('Alt+D de novo pra tentar outra vez.', { color: CORES.apagado, fontSize: '11px' }));
      console.warn('[Recebido na semana]', erro);
    }
  }

  /** Abre se fechado, fecha se aberto. É o que o Alt+D chama. */
  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    semanaAnterior = false;
    abrirPainel();
  }

  // Registrado uma vez na carga: um listener por abertura vazaria a cada Alt+D.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('recebidoSemana', fecharPainel);

  window.__recebidoSemana = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    buscarConsolidado,
    buscarPromessasDaSemana,
    apurarPromessas,
    apurarPromessasFeitasNoDia,
    promessaEntraNaSemana,
    diaUtilAnteriorIso,
    diaDoPagamentoDaPromessa,
    montarResumo,
    valorDaPessoa,
    CONFIG_RECEBIDO,
    relogio,
  };
})();
