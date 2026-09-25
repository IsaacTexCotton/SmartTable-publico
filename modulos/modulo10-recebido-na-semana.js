/* =========================================================================
 * MÓDULO 10: RECEBIDO NA SEMANA (Alt+D) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Mostra quanto entrou na carteira do Isaac e da Bianca na semana vigente
 * (SÁBADO a SEXTA), sem sair da página em que você está.
 *
 * DE ONDE VEM O NÚMERO: da API que o próprio dashboard consolidado usa --
 * GET /api/crm/dashboard-consolidado?inicio=AAAA-MM-DD&fim=AAAA-MM-DD.
 * Descoberta ao vivo com o usuário, espionando a rede do dashboard. Ela já
 * devolve tudo AGREGADO POR USUÁRIO, então este módulo não precisa visitar
 * cliente nenhum: é uma chamada só.
 *
 * Isto é um marco no projeto: é o primeiro número FINANCEIRO que o SmartTable
 * mostra vindo de dado de verdade. Todo o resto que toca pagamento (ver o
 * retrato de títulos no Módulo 6) é INFERÊNCIA -- "o título sumiu da lista,
 * provavelmente foi pago". Aqui não se infere nada.
 *
 * SÃO DOIS NÚMEROS, NÃO DOIS CANDIDATOS AO MESMO (definição do usuário):
 *   - Depósitos          -> dinheiro recuperado por NEGOCIAÇÕES.
 *   - Promessas cumpridas-> dinheiro recuperado por PROMESSAS feitas na
 *                           cobrança.
 * Eles vêm de seções diferentes da API e medem origens diferentes, e o
 * painel mostra os dois separados. O TOTAL RECUPERADO soma os dois.
 *
 * Essa soma foi uma decisão explícita do usuário, revertendo a minha: eu
 * tinha me recusado a somar porque nada na resposta da API prova que as
 * duas sejam conjuntos disjuntos. Quem conhece o negócio definiu que são
 * origens distintas, então somar é o certo. As parcelas continuam na tela
 * para que dê pra conferir uma contra a outra -- se o total um dia parecer
 * alto demais, sobreposição é o primeiro suspeito, e ela NÃO é verificável
 * por este endpoint (ele devolve totais por usuário, não pagamento a
 * pagamento).
 *
 * ONDE COLAR: depois do Módulo 0 (usa semanaSabadoASexta, dataIso,
 * primeiroNomeDeUsuario e formatarMoeda de lá).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__recebidoSemanaCarregado) return;
  window.__recebidoSemanaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Recebido na Semana');

  const CONFIG_RECEBIDO = {
    ENDPOINT: '/api/crm/dashboard-consolidado',
    ID_PAINEL: 'smarttable-painel-recebido',
    // Mesmo z-index dos outros painéis nossos: ABAIXO dos modais do CRM
    // (z-50), que já nos custou um alerta invisível uma vez.
    Z_INDEX: 30,
    TIMEOUT_MS: 15000,

    // Quem aparece no painel, pelo PRIMEIRO NOME (ver primeiroNomeDeUsuario
    // no Módulo 0 e o porquê de ser o primeiro nome, e não o identificador
    // inteiro). Minúsculas, sem acento -- é assim que a comparação é feita.
    //
    // Pra acompanhar outra pessoa: acrescente aqui. O painel desenha uma
    // linha por nome desta lista, e quem não teve movimento na semana
    // aparece com R$ 0,00 -- nunca some da tabela nem vira erro.
    PESSOAS: ['isaac', 'bianca'],

    // As duas métricas, cada uma apontando pra sua seção e seu campo na
    // resposta da API. Acrescentar uma métrica é uma entrada aqui.
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
        detalhe: 'recuperado por promessas da cobrança',
        secao: 'promessas',
        campo: 'cumprido',
      },
    ],
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

  let painelEl = null;

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

    // AbortController em vez de confiar no timeout do navegador: sem isto, um
    // backend lento deixa o painel em "Carregando..." pra sempre, e o
    // operador não sabe se espera ou desiste.
    //
    // window.fetch / window.AbortController com o prefixo EXPLÍCITO, e não
    // como identificador livre. No navegador dá no mesmo; fora dele, não:
    // identificador livre resolve pro global do ambiente, e o teste acaba
    // exercitando o fetch do Node (que recusa URL relativa) em vez do que a
    // janela expõe. É a mesma armadilha que já mascarou bug de localStorage
    // e de Blob neste projeto -- dependência explícita é o que a torna
    // testável de verdade.
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

    let corpo;
    try {
      corpo = await resposta.json();
    } catch {
      throw new Error('A resposta do CRM não veio em JSON.');
    }

    if (!corpo?.data) throw new Error('A resposta do CRM veio sem o campo "data".');
    return corpo.data;
  }

  /**
   * O valor de uma métrica para uma pessoa.
   *
   * Pessoa sem movimento na semana simplesmente NÃO aparece em porUsuario --
   * conferido ao vivo, as seções vêm com contagens diferentes (7, 5, 4, 6).
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
   * Monta a tabela de números. Separado do DOM pra poder ser testado sem
   * navegador -- é aqui que mora a única aritmética do módulo.
   *
   * @param {object} dados O `data` da API.
   * @returns {{metricas: object[], pessoas: string[]}}
   */
  function montarResumo(dados) {
    const metricas = CONFIG_RECEBIDO.METRICAS.map((metrica) => {
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

    // TOTAL RECUPERADO = depósitos + promessas cumpridas.
    //
    // DECISÃO DO USUÁRIO, e ela reverte uma minha. A primeira versão deste
    // módulo se recusava a somar as duas métricas, porque nada na resposta
    // da API prova que elas sejam conjuntos disjuntos -- um pagamento
    // contado duas vezes infla o número sem deixar rastro. O usuário, que é
    // quem conhece o negócio, definiu que são origens diferentes: depósito
    // é o recuperado por NEGOCIAÇÕES, promessa cumprida é o recuperado por
    // PROMESSAS feitas na cobrança. Com isso, somar é o certo.
    //
    // O QUE CONTINUA VALENDO, se o número um dia parecer alto demais: este
    // é o primeiro suspeito, e a sobreposição NÃO É VERIFICÁVEL por aqui --
    // o endpoint devolve totais por usuário, não pagamento a pagamento. As
    // duas parcelas continuam na tela, separadas, justamente pra que dê pra
    // conferir uma contra a outra.
    const totalPorPessoa = CONFIG_RECEBIDO.PESSOAS.map((nome) => ({
      nome,
      valor: metricas.reduce(
        (soma, m) => soma + (m.porPessoa.find((p) => p.nome === nome)?.valor ?? 0),
        0
      ),
    }));

    return {
      metricas,
      pessoas: CONFIG_RECEBIDO.PESSOAS,
      totalPorPessoa,
      totalGeral: totalPorPessoa.reduce((soma, p) => soma + p.valor, 0),
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
  function criarEsqueleto(semana) {
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
      zIndex: CONFIG_RECEBIDO.Z_INDEX,
      width: '460px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
    });

    const titulo = criarDiv('Entrou na semana', {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px',
    });
    painelEl.appendChild(titulo);

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
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
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

    metrica.porPessoa.forEach((pessoa) => {
      const linha = criarDiv('', {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '3px 0',
      });
      const nome = criarDiv(pessoa.nome.charAt(0).toUpperCase() + pessoa.nome.slice(1), {
        color: CORES.texto,
      });
      // Ausente na semana é ZERO, e a tela DIZ que é zero por ausência -- não
      // deixa no ar se o número é zero ou se a busca falhou.
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

    return bloco;
  }

  /**
   * O bloco do TOTAL RECUPERADO: depósitos + promessas cumpridas, por
   * pessoa e no conjunto. Destacado, porque é o número que a pergunta
   * original queria.
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
    // A composição fica escrita: quem olhar o total daqui a três meses
    // sabe do que ele é feito sem precisar abrir o código.
    bloco.appendChild(criarDiv('depósitos + promessas cumpridas', {
      color: CORES.apagado, fontSize: '11px', marginBottom: '6px',
    }));

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

  /** @param {HTMLElement} corpo @param {object} resumo */
  function desenharResumo(corpo, resumo) {
    corpo.textContent = '';
    resumo.metricas.forEach((metrica) => corpo.appendChild(criarBlocoMetrica(metrica)));

    corpo.appendChild(criarBlocoTotal(resumo));
  }

  async function abrirPainel() {
    window.__smartTableUtil?.fecharOutrosPaineis?.('recebidoSemana');

    const u = util();
    if (!u || typeof u.semanaSabadoASexta !== 'function') {
      painelEl = criarDiv('O Módulo 0 não carregou — não dá pra calcular a semana.', {
        position: 'fixed', bottom: '112px', left: '16px', background: CORES.fundo,
        border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
        color: CORES.erro, fontSize: '13px', zIndex: CONFIG_RECEBIDO.Z_INDEX,
        fontFamily: 'system-ui, sans-serif',
      });
      painelEl.id = CONFIG_RECEBIDO.ID_PAINEL;
      document.body.appendChild(painelEl);
      window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
      return;
    }

    const semana = u.semanaSabadoASexta();
    const corpo = criarEsqueleto(semana);
    corpo.appendChild(criarDiv('Consultando o CRM...', { color: CORES.apagado, padding: '6px 0' }));

    try {
      const dados = await buscarConsolidado(semana.inicioIso, semana.fimIso);
      // O painel pode ter sido fechado enquanto a resposta vinha. Sem esta
      // guarda, escreveríamos num elemento já removido -- sem estourar, mas
      // deixando o trabalho invisível e o código mentindo sobre o que fez.
      if (!painelEl || !corpo.isConnected) return;
      desenharResumo(corpo, montarResumo(dados));
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
    abrirPainel();
  }

  // Registrado uma vez na carga, não por abertura -- esta aba fica aberta o
  // dia inteiro e um listener por abertura vazaria a cada Alt+D.
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
    montarResumo,
    valorDaPessoa,
    CONFIG_RECEBIDO,
  };
})();
