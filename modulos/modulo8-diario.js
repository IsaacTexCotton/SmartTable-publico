/* =========================================================================
 * MÓDULO 8: DIÁRIO DE COBRANÇA — CRM TexCotton
 * -------------------------------------------------------------------------
 * Registra o que aconteceu, pra permitir responder uma pergunta que hoje
 * ninguém consegue responder: a régua de prioridade do Alt+U funciona?
 *
 * O QUE ELE GRAVA (três tipos de evento):
 *   - 'fila'    : um por candidato, a cada rodada do Alt+U. Guarda a faixa
 *                 calculada, a POSIÇÃO final na fila e se o cliente caiu no
 *                 grupo de controle daquele dia.
 *   - 'contato' : quando a cobrança REALMENTE saiu (Módulo 3 confirma que o
 *                 WhatsApp abriu), com a hora -- é ela que diz se ser chamado
 *                 cedo muda alguma coisa.
 *   - 'baixa'   : quando o Módulo 6 detecta título que sumiu da lista.
 *
 * O QUE ELE NÃO É: não é prova de causa. Ver a seção "LIMITES" no fim deste
 * cabeçalho -- está lá de propósito, pra ninguém ler o relatório como se
 * fosse mais do que é.
 *
 * SEGURANÇA: isto é instrumentação em cima de uma ferramenta de cobrança em
 * produção. NADA aqui pode derrubar o fluxo -- toda gravação é try/catch, e
 * falha vira aviso no console, nunca exceção que suba pro chamador.
 *
 * ARMAZENAMENTO: uma chave de localStorage POR DIA
 * ("smarttable_diario_v1_20260917"). Com ~290 eventos/dia, um array único
 * exigiria JSON.parse + stringify de megabytes A CADA evento -- inviável
 * durante uma rodada de Alt+U que grava 150 de uma vez. Por dia, cada blob
 * fica na casa das dezenas de KB. Limpeza é apagar chave antiga, sem
 * reescrever nada.
 *
 * Onde colar: logo depois do Módulo 0 -- os módulos 3, 6 e 7 dependem dele.
 *
 * LIMITES (ler antes de tirar conclusão):
 *   1. "Pagou" é INFERÊNCIA. O que o sistema vê é título que sumiu da lista
 *      de vencidos. Renegociação, baixa manual e mudança pra NÃO COBRAR
 *      produzem o mesmo sinal.
 *   2. Comparar faixa 3 com faixa 9 NÃO diz se a régua é boa. As faixas
 *      contêm clientes diferentes por construção (dias de atraso, SCPC,
 *      promessa). Quem está 2 dias atrasado paga mais que quem está 30 em
 *      qualquer ordem. Por isso existe o GRUPO DE CONTROLE: só a comparação
 *      controle vs. régua isola o efeito da ORDEM.
 *   3. Cada negociador tem seu próprio localStorage. Os dados não se juntam
 *      sozinhos -- use exportar() nos dois e junte fora.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__diarioCarregado) return;
  window.__diarioCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Diário');

  const CONFIG_DIARIO = {
    PREFIXO_CHAVE: 'smarttable_diario_v1_',
    // Quantos dias de evento cru manter. Com ~290 eventos/dia a ~90 bytes,
    // 120 dias ficam perto de 3 MB -- dentro do orçamento típico de 5 MB do
    // localStorage, já contando o que os Módulos 3 e 6 guardam.
    DIAS_RETENCAO: 120,
    // A partir daqui, avisa no console pra exportar e limpar.
    LIMITE_AVISO_BYTES: 3_500_000,
    // LIGA/DESLIGA o grupo de controle (a parte que reordena 20% da fila).
    //
    // DESLIGADO por decisão do usuário. O raciocínio: gravar é de graça e não
    // tem risco, mas reordenar tem um custo que se paga TODO DIA -- ~18 dos
    // ~92 clientes da fila são chamados fora da ordem da régua -- enquanto o
    // benefício só chega em semanas, e só se alguma decisão for tomada a
    // partir do resultado. Somando a isso que o desenho do sorteio já saiu
    // errado uma vez (a chave era sorteada no espaço das faixas, e o controle
    // nunca alcançava o fim da fila -- achado só quando o usuário mandou uma
    // fila real), a conta não fechava ainda.
    //
    // Com isso desligado, o diário continua gravando tudo e responde as
    // perguntas DESCRITIVAS (quanto da fila é atendido, quais faixas nunca
    // são chamadas, o que cai em "Demais dias"). O que se perde é a pergunta
    // CAUSAL -- "a ordem da régua ajuda?" -- que só o grupo de controle
    // responde.
    //
    // Pra religar: true aqui, e window.__diario.limpar() antes, pra não
    // misturar período com e sem experimento na mesma análise.
    ATIVAR_GRUPO_CONTROLE: false,
    // 1 em cada 5 clientes entra no grupo de controle (posição sorteada em
    // vez de posição pela régua). Confirmado com o usuário.
    PROPORCAO_CONTROLE: 5,
    // Maior número de faixa válido na régua atual do Módulo 7 (régua v2: 12
    // faixas). Usado na análise e na autoconferência.
    FAIXA_MAXIMA: 12,
  };

  /* ---------------------------------------------------------------------
   * 1. DATA E CHAVE
   * --------------------------------------------------------------------- */
  /**
   * Data no formato compacto AAAAMMDD, que é como as chaves são nomeadas e
   * como o campo `d` de cada evento é gravado.
   *
   * @param {Date} [data] Padrão: agora.
   * @returns {number} Ex.: 20260917.
   */
  function chaveDia(data) {
    const d = data ?? new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function nomeDaChave(diaNumerico) {
    return CONFIG_DIARIO.PREFIXO_CHAVE + diaNumerico;
  }

  /** Todas as chaves do diário hoje presentes no localStorage. */
  function chavesExistentes() {
    const chaves = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG_DIARIO.PREFIXO_CHAVE)) chaves.push(k);
      }
    } catch (erro) {
      console.warn('[Diário] Não consegui listar o localStorage.', erro);
    }
    return chaves.sort();
  }

  function diaDaChave(chave) {
    return Number(chave.slice(CONFIG_DIARIO.PREFIXO_CHAVE.length));
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA E ESCRITA (nunca lançam)
   * --------------------------------------------------------------------- */
  function lerDia(diaNumerico) {
    try {
      const bruto = localStorage.getItem(nomeDaChave(diaNumerico));
      if (!bruto) return [];
      const lista = JSON.parse(bruto);
      return Array.isArray(lista) ? lista : [];
    } catch (erro) {
      console.warn(`[Diário] Dia ${diaNumerico} ilegível -- tratando como vazio.`, erro);
      return [];
    }
  }

  function gravarDia(diaNumerico, eventos) {
    try {
      localStorage.setItem(nomeDaChave(diaNumerico), JSON.stringify(eventos));
      return true;
    } catch (erro) {
      // Cota estourada é o caso esperado aqui. Não pode derrubar a cobrança:
      // avisa, sugere o caminho de saída e segue.
      console.warn(
        '[Diário] Não consegui gravar (cota do localStorage?). O registro deste evento foi perdido, ' +
        'mas a cobrança segue normal. Rode window.__diario.exportar() e depois window.__diario.limpar().',
        erro
      );
      return false;
    }
  }

  /**
   * Apaga dias além da janela de retenção. Roda uma vez por carregamento de
   * página, não a cada evento -- varrer o localStorage 150 vezes durante uma
   * rodada de Alt+U seria desperdício puro.
   */
  function limparAntigos() {
    const limite = chaveDia(new Date(Date.now() - CONFIG_DIARIO.DIAS_RETENCAO * 86400000));
    chavesExistentes().forEach((chave) => {
      if (diaDaChave(chave) < limite) {
        try {
          localStorage.removeItem(chave);
        } catch (erro) {
          /* sem drama -- tenta de novo no próximo carregamento */
        }
      }
    });
  }

  /* ---------------------------------------------------------------------
   * 3. REGISTRO
   * --------------------------------------------------------------------- */
  /**
   * Grava um evento no dia de hoje.
   *
   * Campos curtos de propósito: com ~290 eventos por dia, nome de chave é
   * volume. `t` tipo, `d` dia, `h` hora (minutos desde a meia-noite), `c`
   * cnpj, `n` negociador -- o resto vem de `dados`.
   *
   * @param {'fila'|'contato'|'baixa'} tipo
   * @param {object} dados Campos específicos do tipo.
   * @returns {boolean} true se gravou.
   */
  function registrar(tipo, dados) {
    try {
      const agora = new Date();
      const dia = chaveDia(agora);
      const evento = Object.assign(
        {
          t: tipo,
          d: dia,
          h: agora.getHours() * 60 + agora.getMinutes(),
          n: window.__contextoAdicional?.nomeNegociador ?? '',
        },
        dados ?? {}
      );
      const eventos = lerDia(dia);
      eventos.push(evento);
      return gravarDia(dia, eventos);
    } catch (erro) {
      console.warn('[Diário] Falha inesperada ao registrar evento -- ignorando.', erro);
      return false;
    }
  }

  /**
   * Grava vários eventos de uma vez, num único acesso ao localStorage.
   * É o caminho do Alt+U: 150 candidatos numa rodada só.
   *
   * @param {'fila'|'contato'|'baixa'} tipo
   * @param {object[]} listaDeDados
   * @returns {number} Quantos foram gravados (0 se a gravação falhou).
   */
  function registrarLote(tipo, listaDeDados) {
    if (!Array.isArray(listaDeDados) || listaDeDados.length === 0) return 0;
    try {
      const agora = new Date();
      const dia = chaveDia(agora);
      const h = agora.getHours() * 60 + agora.getMinutes();
      const n = window.__contextoAdicional?.nomeNegociador ?? '';
      const eventos = lerDia(dia);
      listaDeDados.forEach((dados) => eventos.push(Object.assign({ t: tipo, d: dia, h, n }, dados)));
      return gravarDia(dia, eventos) ? listaDeDados.length : 0;
    } catch (erro) {
      console.warn('[Diário] Falha inesperada ao registrar lote -- ignorando.', erro);
      return 0;
    }
  }

  /* ---------------------------------------------------------------------
   * 4. GRUPO DE CONTROLE (o que torna a medição interpretável)
   * --------------------------------------------------------------------- */
  /**
   * Hash determinístico e estável de string (variante de cyrb53, sem
   * dependência externa). Mesma entrada, mesmo número, sempre -- inclusive
   * entre recarregamentos e entre máquinas.
   *
   * @param {string} texto
   * @returns {number} Inteiro não negativo.
   */
  function hashEstavel(texto) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < texto.length; i += 1) {
      const ch = texto.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  /**
   * Decide se um cliente entra no grupo de controle NESTE dia.
   *
   * Determinístico por (cnpj, dia): rodar o Alt+U duas vezes no mesmo dia dá
   * o mesmo sorteio, então reprocessar não contamina o experimento. Muda de
   * um dia pro outro, então nenhum cliente fica preso no controle pra sempre.
   *
   * @param {string} cnpj
   * @param {number} [dia] AAAAMMDD; padrão hoje.
   * @returns {boolean}
   */
  function ehGrupoControle(cnpj, dia) {
    // Lido em tempo de chamada, não no carregamento: assim dá pra ligar e
    // desligar pelo console (window.__diario.CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE)
    // sem recarregar a página.
    if (!CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE) return false;
    const chave = `${cnpj}|${dia ?? chaveDia()}`;
    return hashEstavel(chave) % CONFIG_DIARIO.PROPORCAO_CONTROLE === 0;
  }

  /**
   * Número pseudoaleatório em [0,1), estável por (cnpj, dia). Usado pra dar
   * ao cliente de controle uma posição na fila INDEPENDENTE da faixa dele --
   * que é justamente o que torna a comparação capaz de isolar o efeito da
   * ordem.
   *
   * @param {string} cnpj
   * @param {number} [dia]
   * @returns {number}
   */
  function sorteioEstavel(cnpj, dia) {
    return (hashEstavel(`pos|${cnpj}|${dia ?? chaveDia()}`) % 1000000) / 1000000;
  }

  /* ---------------------------------------------------------------------
   * 5. LEITURA PRA ANÁLISE
   * --------------------------------------------------------------------- */
  /**
   * Todos os eventos guardados, do mais antigo pro mais recente.
   *
   * @param {object} [filtro]
   * @param {'fila'|'contato'|'baixa'} [filtro.tipo]
   * @param {number} [filtro.ultimosDias]
   * @returns {object[]}
   */
  function eventos(filtro = {}) {
    const limite = filtro.ultimosDias
      ? chaveDia(new Date(Date.now() - filtro.ultimosDias * 86400000))
      : 0;

    return chavesExistentes()
      .map(diaDaChave)
      .filter((dia) => dia >= limite)
      .flatMap((dia) => lerDia(dia))
      .filter((e) => !filtro.tipo || e.t === filtro.tipo);
  }

  /** Tamanho aproximado do diário em bytes. */
  function tamanho() {
    return chavesExistentes().reduce((total, chave) => {
      try {
        return total + (localStorage.getItem(chave) ?? '').length;
      } catch (erro) {
        return total;
      }
    }, 0);
  }

  /**
   * Baixa o diário como JSON.
   *
   * CENSURADO POR PADRÃO: o diário guarda o CNPJ de cada cliente, e arquivo
   * exportado é justamente o que acaba anexado num e-mail ou num chat. O
   * apelido é estável, então juntar os dados de duas máquinas e detectar
   * duplicata continua funcionando -- só não dá pra saber QUEM é.
   *
   * Pra exportar com CNPJ de verdade (uso interno, nunca pra fora):
   * window.__diario.exportar({ censurado: false }).
   *
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.censurado] Padrão true.
   */
  /**
   * Monta o conteúdo da exportação, sem baixar nada.
   *
   * Separado de exportar() de propósito: o que precisa de garantia é O QUE
   * SAI, não o mecanismo de download. Grudados, só dava pra testar a censura
   * atravessando Blob e createObjectURL -- e um teste que depende de
   * encanamento é um teste que não protege o que importa.
   *
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.censurado] Padrão true.
   * @returns {{exportadoEm: string, censurado: boolean, eventos: object[]}}
   */
  function montarExportacao(opcoes = {}) {
    const censurado = opcoes.censurado !== false;
    const lista = eventos().map((e) => {
      if (!censurado) return e;
      const copia = Object.assign({}, e, { c: apelido(e.c) });
      delete copia.tt; // números de título identificam o cliente no ERP
      return copia;
    });
    return { exportadoEm: new Date().toISOString(), censurado, eventos: lista };
  }

  function exportar(opcoes = {}) {
    const dados = montarExportacao(opcoes);
    const censurado = dados.censurado;
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diario-smarttable-${chaveDia()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log(
      `[Diário] Exportados ${dados.eventos.length} eventos` +
      (censurado
        ? ' (censurado -- sem CNPJ nem número de título).'
        : ' SEM CENSURA -- contém CNPJ e número de título. Não envie pra fora.')
    );
  }

  /** Apaga TUDO. Pede confirmação, porque dado de medição não volta. */
  function limpar() {
    const total = eventos().length;
    if (!window.confirm(`Apagar o diário inteiro (${total} eventos)? Isso não tem volta.`)) return;
    chavesExistentes().forEach((chave) => {
      try {
        localStorage.removeItem(chave);
      } catch (erro) {
        /* ignora */
      }
    });
    console.log('[Diário] Diário apagado.');
  }

  /* ---------------------------------------------------------------------
   * 6. ANÁLISE
   * --------------------------------------------------------------------- */
  /**
   * Cruza os três tipos de evento e devolve os números crus.
   *
   * A junção é por (cnpj, dia): pra cada atribuição de fila, procura um
   * contato no MESMO dia e uma baixa dentro da janela de acompanhamento.
   *
   * @param {object} [opcoes]
   * @param {number} [opcoes.ultimosDias] Recorte da análise.
   * @param {number} [opcoes.janelaBaixaDias] Dias após a cobrança em que uma
   *   baixa ainda é atribuída a ela. Padrão 7.
   * @returns {object} Linhas por faixa e o par régua/controle.
   */
  function analisar(opcoes = {}) {
    const janela = opcoes.janelaBaixaDias ?? 7;
    const todos = eventos({ ultimosDias: opcoes.ultimosDias });

    // DEDUPLICA por (cnpj, dia): o mesmo cliente pode ter VÁRIAS atribuições
    // no mesmo dia, e contar todas infla "na fila" e derruba a taxa de
    // contato pela metade -- números descritivos errados, justamente os que
    // sobraram depois do grupo de controle ser desligado.
    //
    // Duas causas, uma delas legítima:
    //   1. BUG (corrigido): o Módulo 7 chamava registrarLote duas vezes por
    //      rodada, sobra de um refactor. Achado num relatório real do usuário,
    //      onde as posições 1-36 apareciam repetidas.
    //   2. LEGÍTIMA: rodar o Alt+U mais de uma vez no dia. A fila encolhe
    //      conforme o dia passa (quem já teve movimentação hoje sai), então
    //      92 de manhã viram 36 à tarde -- e quem estava nas duas aparece
    //      duas vezes, com posições diferentes.
    //
    // Fica a PRIMEIRA atribuição do dia: é ela que reflete a ordem com que o
    // dia foi planejado, sobre a fila inteira. As rodadas seguintes são
    // recálculos sobre o que sobrou, com posições que não correspondem à
    // decisão de ordem que de fato valeu.
    const vistos = new Set();
    const filas = [];
    let atribuicoesRepetidas = 0;
    todos.filter((e) => e.t === 'fila').forEach((e) => {
      const chave = `${e.c}|${e.d}`;
      if (vistos.has(chave)) { atribuicoesRepetidas += 1; return; }
      vistos.add(chave);
      filas.push(e);
    });
    const contatos = new Set(todos.filter((e) => e.t === 'contato').map((e) => `${e.c}|${e.d}`));

    // Baixas indexadas por cnpj, em ordem de dia, pra procurar dentro da janela.
    const baixasPorCnpj = new Map();
    todos.filter((e) => e.t === 'baixa').forEach((e) => {
      if (!baixasPorCnpj.has(e.c)) baixasPorCnpj.set(e.c, []);
      baixasPorCnpj.get(e.c).push(e.d);
    });

    /** Distância em dias entre dois AAAAMMDD (aproximada via Date). */
    function distanciaEmDias(de, ate) {
      const d1 = new Date(Math.floor(de / 10000), (Math.floor(de / 100) % 100) - 1, de % 100);
      const d2 = new Date(Math.floor(ate / 10000), (Math.floor(ate / 100) % 100) - 1, ate % 100);
      return Math.round((d2 - d1) / 86400000);
    }

    /** Primeira baixa do cliente dentro da janela depois da cobrança. */
    function diasAteBaixa(cnpj, diaFila) {
      const dias = baixasPorCnpj.get(cnpj) ?? [];
      const candidatos = dias
        .map((d) => distanciaEmDias(diaFila, d))
        .filter((delta) => delta >= 0 && delta <= janela);
      return candidatos.length > 0 ? Math.min(...candidatos) : null;
    }

    const linhas = filas.map((e) => ({
      faixa: e.f,
      // Registros anteriores à régua v2 não têm o campo -- são da v1.
      versaoRegua: e.r ?? 1,
      posicao: e.p,
      controle: e.k === 1,
      contatado: contatos.has(`${e.c}|${e.d}`),
      diasAteBaixa: diasAteBaixa(e.c, e.d),
    }));

    /** Agrega um conjunto de linhas em contadores legíveis. */
    function resumir(conjunto) {
      const contatados = conjunto.filter((l) => l.contatado);
      const comBaixa = conjunto.filter((l) => l.diasAteBaixa !== null);
      const prazos = comBaixa.map((l) => l.diasAteBaixa).sort((a, b) => a - b);
      return {
        atribuicoes: conjunto.length,
        contatados: contatados.length,
        taxaContato: conjunto.length ? contatados.length / conjunto.length : 0,
        comBaixa: comBaixa.length,
        taxaBaixa: conjunto.length ? comBaixa.length / conjunto.length : 0,
        medianaDiasAteBaixa: prazos.length ? prazos[Math.floor(prazos.length / 2)] : null,
        posicaoMediana: conjunto.length
          ? conjunto.map((l) => l.posicao).sort((a, b) => a - b)[Math.floor(conjunto.length / 2)]
          : null,
      };
    }

    // A tabela por faixa só junta registros da régua ATUAL: a numeração
    // mudou entre versões (a faixa 5 da v1 é "Promessa não cumprida", a da
    // v2 é "Dia da promessa") e somar as duas misturaria coisas diferentes
    // sob o mesmo nome. Sem o Módulo 7 carregado não há como saber a versão
    // atual -- aí entra tudo, como antes.
    const versaoAtual = window.filaPrioridadeDebug?.CONFIG?.VERSAO_REGUA ?? null;
    const daReguaAtual = versaoAtual == null ? linhas : linhas.filter((l) => l.versaoRegua === versaoAtual);
    const porFaixa = {};
    for (let faixa = 1; faixa <= CONFIG_DIARIO.FAIXA_MAXIMA; faixa += 1) {
      const doTier = daReguaAtual.filter((l) => l.faixa === faixa);
      if (doTier.length > 0) porFaixa[faixa] = resumir(doTier);
    }

    return {
      janelaBaixaDias: janela,
      totalAtribuicoes: linhas.length,
      atribuicoesRepetidas,
      atribuicoesReguaAnterior: linhas.length - daReguaAtual.length,
      porFaixa,
      // A comparação que de fato isola o efeito da ORDEM.
      regua: resumir(linhas.filter((l) => !l.controle)),
      controle: resumir(linhas.filter((l) => l.controle)),
    };
  }

  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  /**
   * Imprime a análise no console, com os limites de interpretação junto --
   * não separados num documento que ninguém abre na hora de decidir.
   *
   * @param {object} [opcoes] Mesmas de analisar().
   */
  function relatorio(opcoes = {}) {
    const a = analisar(opcoes);

    if (a.totalAtribuicoes === 0) {
      console.log('[Diário] Nenhuma atribuição de fila registrada ainda. Rode o Alt+U por alguns dias.');
      return a;
    }

    console.log(`\n=== DIÁRIO DE COBRANÇA — ${a.totalAtribuicoes} atribuições de fila ===`);
    console.log(`Janela para atribuir uma baixa à cobrança: ${a.janelaBaixaDias} dias.`);
    if (a.atribuicoesRepetidas > 0) {
      console.log(
        `${a.atribuicoesRepetidas} atribuição(ões) repetida(s) foram agrupadas -- normal quando o Alt+U ` +
        'roda mais de uma vez no mesmo dia; vale a primeira rodada do dia.'
      );
    }
    console.log('');

    if (a.atribuicoesReguaAnterior > 0) {
      console.log(
        `${a.atribuicoesReguaAnterior} atribuição(ões) de uma régua anterior (outra numeração de faixas) ` +
        'ficaram fora da tabela por faixa -- continuam contando no total.'
      );
    }
    console.log('--- Por faixa da régua (OBSERVACIONAL — ver aviso no fim) ---');
    console.table(
      Object.fromEntries(
        Object.entries(a.porFaixa).map(([faixa, r]) => [
          `${faixa}. ${window.filaPrioridadeDebug?.NOMES_PRIORIDADE?.[faixa] ?? ''}`.trim(),
          {
            'na fila': r.atribuicoes,
            'contatados': `${r.contatados} (${pct(r.taxaContato)})`,
            'com baixa': `${r.comBaixa} (${pct(r.taxaBaixa)})`,
            'mediana dias p/ baixa': r.medianaDiasAteBaixa ?? '—',
          },
        ])
      )
    );

    if (!CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE && a.controle.atribuicoes === 0) {
      console.log(
        '\n--- Régua vs. Controle: DESLIGADO ---\n' +
        '  O grupo de controle está desativado, então a fila sai 100% na ordem da régua.\n' +
        '  Sem ele não dá pra responder "a ordem da régua ajuda?" -- as faixas contêm\n' +
        '  clientes diferentes por construção, e comparar uma com a outra mede o cliente,\n' +
        '  não a régua. A tabela acima continua valendo pra COBERTURA (quem nunca é\n' +
        '  chamado, o que cai em "Demais dias").\n' +
        '  Pra ligar: window.__diario.CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE = true\n' +
        '  (rode window.__diario.limpar() antes, pra não misturar os dois períodos).'
      );
      return a;
    }

    console.log('\n--- Régua vs. Controle (é ESTA comparação que responde a pergunta) ---');
    console.table({
      'Ordenado pela régua': {
        'na fila': a.regua.atribuicoes,
        'posição mediana': a.regua.posicaoMediana ?? '—',
        'contatados': pct(a.regua.taxaContato),
        'com baixa': pct(a.regua.taxaBaixa),
        'mediana dias p/ baixa': a.regua.medianaDiasAteBaixa ?? '—',
      },
      'Posição sorteada (controle)': {
        'na fila': a.controle.atribuicoes,
        'posição mediana': a.controle.posicaoMediana ?? '—',
        'contatados': pct(a.controle.taxaContato),
        'com baixa': pct(a.controle.taxaBaixa),
        'mediana dias p/ baixa': a.controle.medianaDiasAteBaixa ?? '—',
      },
    });

    const MINIMO_PRA_COMPARAR = 300;
    if (a.controle.atribuicoes < MINIMO_PRA_COMPARAR) {
      console.warn(
        `[Diário] Ainda são só ${a.controle.atribuicoes} casos no controle. Abaixo de ~${MINIMO_PRA_COMPARAR} ` +
        'a diferença entre os dois grupos é ruído com aparência de resultado. Deixe acumular antes de concluir.'
      );
    }

    console.log(
      '\n%cComo ler isto:%c\n' +
      '  • A tabela POR FAIXA não diz se a régua é boa. As faixas contêm clientes\n' +
      '    diferentes por construção -- quem está 2 dias atrasado paga mais que quem\n' +
      '    está 30 em qualquer ordem. Ela serve pra ver cobertura (quem nunca é chamado).\n' +
      '  • A comparação RÉGUA vs CONTROLE é a que isola o efeito da ordem, porque o\n' +
      '    controle tem posição sorteada, independente da faixa.\n' +
      '  • "com baixa" é INFERÊNCIA: título que sumiu da lista de vencidos. Renegociação\n' +
      '    e baixa manual produzem o mesmo sinal.\n' +
      '  • Os dados são deste navegador. Use exportar() em cada máquina e junte fora.',
      'font-weight:bold', 'font-weight:normal'
    );

    return a;
  }

  /* ---------------------------------------------------------------------
   * 7. DIAGNÓSTICO CENSURADO (window.__diag)
   * -----------------------------------------------------------------
   * Tudo que é feito pra sair da tela e ir parar num chat, num e-mail ou num
   * print PASSA POR AQUI. A censura não pode depender de alguém lembrar de
   * apagar o CNPJ antes de colar -- basta esquecer uma vez.
   *
   * O QUE É PRESERVADO, porque é o que serve pra diagnosticar:
   *   - identidade ESTÁVEL (o mesmo cliente vira sempre o mesmo apelido),
   *     que é o que permite detectar duplicata e cruzar eventos -- foi
   *     exatamente assim que o bug da fila gravada 2x apareceu;
   *   - o FORMATO dos valores ("R$ #.###,##"), que revela erro de parsing
   *     sem revelar o valor;
   *   - tamanhos, contagens, situações, faixas, datas -- nada identifica.
   *
   * RESSALVA HONESTA: isto é PSEUDONIMIZAÇÃO, não anonimato criptográfico.
   * O apelido é um hash com sal aleatório guardado só neste navegador, o que
   * impede reverter por força bruta de fora -- mas o objetivo é não vazar
   * dado de cliente por descuido, não resistir a adversário determinado.
   * --------------------------------------------------------------------- */
  const CHAVE_SAL_DIAG = 'smarttable_sal_diagnostico';

  /**
   * Sal aleatório por instalação. Sem ele o apelido seria só o hash do CNPJ
   * -- e o espaço de CNPJs é pequeno o bastante pra alguém de fora testar
   * todos e reverter. Com sal local, o apelido só faz sentido neste
   * navegador, que é exatamente onde ele precisa fazer sentido.
   *
   * @returns {string}
   */
  function obterSalDiagnostico() {
    try {
      let sal = localStorage.getItem(CHAVE_SAL_DIAG);
      if (!sal) {
        sal = String(Math.random()).slice(2) + String(Date.now());
        localStorage.setItem(CHAVE_SAL_DIAG, sal);
      }
      return sal;
    } catch (erro) {
      return 'sessao'; // storage bloqueado: apelidos consistentes só nesta página
    }
  }

  /**
   * Apelido estável e não reversível pra um identificador (CNPJ, documento).
   *
   * @param {string} valor
   * @returns {string} Ex.: "cli.k3f9"
   */
  function apelido(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return '(vazio)';
    return 'cli.' + hashEstavel(obterSalDiagnostico() + '|' + texto).toString(36).slice(-4);
  }

  /**
   * Troca os dígitos de um valor monetário, preservando o FORMATO -- que é
   * o que denuncia erro de separador decimal, milhar ou moeda.
   *
   * @param {string} texto
   * @returns {string} Ex.: "R$ 1.778,69" -> "R$ #.###,##"
   */
  function valorMascarado(texto) {
    const original = String(texto ?? '').trim();
    if (!original) return '(vazio)';
    return original.replace(/\d/g, '#');
  }

  /**
   * Oculta um nome preservando o tamanho -- útil pra flagrar truncamento ou
   * espaço colado, sem expor o nome.
   *
   * @param {string} texto
   * @returns {string} Ex.: "nome.17car"
   */
  function nomeMascarado(texto) {
    const original = String(texto ?? '');
    if (!original.trim()) return '(vazio)';
    return 'nome.' + original.length + 'car';
  }

  /**
   * Mantém a FORMA da URL (caminho e quais parâmetros existem) e remove os
   * valores, que são o que identifica o cliente.
   *
   * @param {string} url
   * @returns {string}
   */
  function urlMascarada(url) {
    const texto = String(url ?? '');
    if (!texto) return '(vazio)';
    try {
      const u = new URL(texto, location.origin);
      const caminho = u.pathname.replace(/\d+/g, '<id>');
      const params = [...u.searchParams.keys()].map((k) => k + '=<oculto>').join('&');
      return u.origin + caminho + (params ? '?' + params : '');
    } catch (erro) {
      return '(url ilegivel)';
    }
  }

  /**
   * Varre texto livre atrás de CNPJ, CPF e telefone e troca por apelido.
   * Rede de segurança pra mensagem montada em qualquer lugar -- não
   * substitui censurar na origem, mas evita vazar por descuido.
   *
   * @param {string} texto
   * @returns {string}
   */
  function censurarTexto(texto) {
    return String(texto ?? '')
      .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, (m) => apelido(m))
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => apelido(m))
      .replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '(tel oculto)');
  }

  /**
   * Relatório da fila do dia, pronto pra colar em qualquer lugar. Mesmos
   * campos que já vinham sendo pedidos à mão -- agora sem o passo manual de
   * apagar CNPJ e razão social.
   *
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.comApelido] Inclui o apelido estável de cada
   *   cliente, que é o que permite detectar duplicata. Padrão true.
   * @returns {object}
   */
  function relatorioFila(opcoes = {}) {
    const comApelido = opcoes.comApelido !== false;
    const hoje = chaveDia();
    const linhas = lerDia(hoje)
      .filter((e) => e.t === 'fila')
      .map((e) => {
        const linha = { p: e.p, f: e.f, k: e.k, s: e.s, a: e.a };
        if (comApelido) linha.id = apelido(e.c);
        return linha;
      });

    const saida = { dia: hoje, total: linhas.length, linhas };
    console.log(JSON.stringify(saida));
    console.log('%c^ Pode colar: sem CNPJ, sem razao social, sem valor.', 'color:#1B6B4A;font-weight:bold;');
    return saida;
  }

  /**
   * Relatório do alerta de grupo econômico, censurado -- inclui o estado
   * VISUAL do banner, que é onde o último problema real estava (ele existia
   * no DOM e mesmo assim não aparecia).
   *
   * @returns {object}
   */
  function relatorioGrupo() {
    const grupo = window.__alertaGrupo;
    const banner = document.getElementById('alerta-grupo-vencido');
    const cabecalho = document.querySelector('header');

    let infoBanner = { existe: false };
    if (banner) {
      const r = banner.getBoundingClientRect();
      const cs = getComputedStyle(banner);
      const alvo = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2)
      );
      infoBanner = {
        existe: true,
        rect: { top: Math.round(r.top), altura: Math.round(r.height), largura: Math.round(r.width) },
        estilo: { position: cs.position, top: cs.top, zIndex: cs.zIndex, display: cs.display, visibility: cs.visibility, opacity: cs.opacity },
        quemEstaNaFrente: alvo ? alvo.tagName + '#' + (alvo.id || '-') : null,
        ehOProprioBanner: banner.contains(alvo),
      };
    }

    const saida = {
      modulo5Carregado: window.__alertaGrupoCarregado === true,
      showTabEhFuncao: typeof window.showTab === 'function',
      empresasComVencido: (grupo && grupo.empresasComVencido ? grupo.empresasComVencido : []).map((e) => ({
        id: apelido(e.cnpj),
        razaoSocial: nomeMascarado(e.razaoSocial),
        vencido: valorMascarado(e.vencido),
        url: urlMascarada(e.url),
      })),
      banner: infoBanner,
      header: cabecalho
        ? {
            altura: Math.round(cabecalho.getBoundingClientRect().height),
            position: getComputedStyle(cabecalho).position,
            zIndex: getComputedStyle(cabecalho).zIndex,
          }
        : null,
    };

    console.log(JSON.stringify(saida, null, 2));
    console.log('%c^ Pode colar: sem CNPJ, sem razao social, sem valor.', 'color:#1B6B4A;font-weight:bold;');
    return saida;
  }

  /* ---------------------------------------------------------------------
   * 8. AUTOCONFERÊNCIA (window.__conferir)
   * -----------------------------------------------------------------
   * Checa invariantes contra o estado REAL da página e do storage.
   *
   * POR QUE ISTO EXISTE, e por que não é "mais um teste": os bugs que
   * chegaram a atrapalhar a cobrança de verdade não foram pegos pela suíte.
   * Foram pegos quando o usuário exportou a fila e alguém olhou --
   * a régua reordenando errado, o grupo de controle nunca alcançando o fim
   * da fila, o Alt+U gravando tudo duas vezes. Todos invisíveis em jsdom,
   * porque moram em código que abre aba de fundo e depende de dado real.
   *
   * Esta função transforma aquele "exportar e pedir pra alguém olhar" num
   * comando só, que o próprio operador roda. Ela não substitui os testes --
   * cobre justamente o que eles não alcançam.
   * --------------------------------------------------------------------- */

  /**
   * Roda as conferências e imprime o resultado no console.
   *
   * @returns {{problemas: string[], avisos: string[], checagens: number}}
   */
  function conferir() {
    const problemas = [];
    const avisos = [];
    let checagens = 0;

    const exigir = (condicao, mensagem) => { checagens += 1; if (!condicao) problemas.push(mensagem); };
    const observar = (condicao, mensagem) => { checagens += 1; if (!condicao) avisos.push(mensagem); };

    // --- 1. Módulos carregados ---------------------------------------
    // CORRIGIDO (bug real, achado em revisão): esta checagem lia
    // window.__contextoAdicionalDebug.FLAGS_DOS_MODULOS -- uma variável que
    // foi removida do Módulo 6 quando "quais módulos existem" passou a ser
    // respondido pelo registro central do Módulo 0 (registrarModuloCarregado/
    // modulosFaltando, ver tests/registro-modulos.test.js). Como ela nunca
    // mais existiu, o "if (flags)" sempre caía no else e __conferir() avisava
    // "Módulo 6 não carregou" mesmo com ele carregado -- e nunca checava de
    // fato quem estava faltando. Usa o registro do Módulo 0 diretamente, que
    // é a fonte de verdade atual e nem depende do Módulo 6 ter carregado.
    const util = window.__smartTableUtil;
    if (util && typeof util.modulosFaltando === 'function') {
      const faltando = util.modulosFaltando();
      exigir(faltando.length === 0, `Módulo(s) não carregado(s): ${faltando.join(', ')}. Cache antigo do Tampermonkey?`);
    } else {
      avisos.push('Módulo 0 não carregou -- não deu pra conferir a lista de módulos.');
    }

    // --- 2. Contrato de data entre módulos ---------------------------
    // O Módulo 4 já comparou data de vencimento (meia-noite) com esta
    // (meio-dia) e omitiu relatório por engano. A convenção é meio-dia.
    const ctx = window.__contextoAdicional;
    if (ctx?.contatoRecente?.data instanceof Date) {
      exigir(
        ctx.contatoRecente.data.getHours() === 12,
        `contatoRecente.data está às ${ctx.contatoRecente.data.getHours()}h, não ao meio-dia -- ` +
        'comparações de data entre módulos vão divergir.'
      );
    }
    if (ctx) {
      const indefinidos = Object.keys(ctx).filter((k) => ctx[k] === undefined);
      exigir(indefinidos.length === 0, `Campos undefined no contexto: ${indefinidos.join(', ')}`);
    }

    // --- 3. Fila salva ------------------------------------------------
    let fila = null;
    try { fila = window.filaDebug?.obterFila?.() ?? null; } catch (erro) { fila = null; }

    if (fila?.clientes?.length) {
      const c = fila.clientes;

      const cnpjs = c.map((x) => x.cnpj);
      exigir(new Set(cnpjs).size === cnpjs.length, `A fila tem CNPJ repetido (${cnpjs.length - new Set(cnpjs).size} duplicata(s)).`);

      const regua = c.filter((x) => !x.grupoControle);
      let quebrasFaixa = 0;
      let quebrasDias = 0;
      for (let i = 1; i < regua.length; i += 1) {
        if (regua[i].prioridadeTier < regua[i - 1].prioridadeTier) quebrasFaixa += 1;
        // Régua v2: dentro da faixa, contato mais antigo primeiro (sem
        // contato = antes de todos); empate de contato, mais dias primeiro.
        if (regua[i].prioridadeTier === regua[i - 1].prioridadeTier) {
          const contatoAnt = regua[i - 1].ultimoContatoIso ?? '';
          const contato = regua[i].ultimoContatoIso ?? '';
          if (contato < contatoAnt) quebrasDias += 1;
          else if (contato === contatoAnt && regua[i].diasAtraso > regua[i - 1].diasAtraso) quebrasDias += 1;
        }
      }
      exigir(quebrasFaixa === 0, `A ordem de faixa quebra ${quebrasFaixa} vez(es) entre os clientes fora do grupo de controle.`);
      exigir(quebrasDias === 0, `O desempate (contato mais antigo, depois dias de atraso) quebra ${quebrasDias} vez(es) dentro de uma mesma faixa.`);

      const noControle = c.filter((x) => x.grupoControle).length;
      if (!CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE) {
        exigir(noControle === 0, `O grupo de controle está DESLIGADO, mas ${noControle} cliente(s) na fila estão marcados como controle.`);
      } else if (c.length >= 30) {
        const esperado = c.length / CONFIG_DIARIO.PROPORCAO_CONTROLE;
        observar(
          noControle > esperado * 0.5 && noControle < esperado * 1.5,
          `Grupo de controle com ${noControle} de ${c.length} (esperado perto de ${Math.round(esperado)}).`
        );
      }
    } else {
      avisos.push('Nenhuma fila salva pra conferir -- rode o Alt+I ou Alt+U antes.');
    }

    // --- 4. Diário de hoje --------------------------------------------
    const hoje = chaveDia();
    const filasHoje = lerDia(hoje).filter((e) => e.t === 'fila');

    if (filasHoje.length > 0) {
      // Uma rodada grava posições 1..N sem repetir. Posição repetida = a
      // mesma rodada gravada duas vezes (foi exatamente o bug do Alt+U).
      const porRodada = new Map();
      filasHoje.forEach((e) => {
        const n = porRodada.get(e.p) ?? 0;
        porRodada.set(e.p, n + 1);
      });
      const maxRepeticao = Math.max(...porRodada.values());
      observar(
        maxRepeticao <= 1,
        `A posição 1 da fila aparece ${maxRepeticao}x hoje. Se você rodou o Alt+U ${maxRepeticao}x, é normal; ` +
        'se rodou uma vez só, a fila está sendo gravada em duplicidade.'
      );

      const semCnpj = filasHoje.filter((e) => !e.c).length;
      exigir(semCnpj === 0, `${semCnpj} registro(s) de fila sem CNPJ -- não dá pra cruzar com contato nem com baixa.`);

      const faixaInvalida = filasHoje.filter((e) => !(e.f >= 1 && e.f <= CONFIG_DIARIO.FAIXA_MAXIMA)).length;
      exigir(faixaInvalida === 0, `${faixaInvalida} registro(s) de fila com faixa fora de 1..${CONFIG_DIARIO.FAIXA_MAXIMA}.`);
    }

    // --- 5. Tamanho do diário -----------------------------------------
    const bytes = tamanho();
    observar(
      bytes < CONFIG_DIARIO.LIMITE_AVISO_BYTES,
      `O diário está com ${(bytes / 1_000_000).toFixed(1)} MB. Rode exportar() e depois limpar().`
    );

    // --- Saída ---------------------------------------------------------
    if (problemas.length === 0 && avisos.length === 0) {
      console.log(`%c[Conferência] ${checagens} checagens, nenhum problema.`, 'color:#1B6B4A;font-weight:bold;');
    } else {
      console.log(`%c[Conferência] ${checagens} checagens.`, 'font-weight:bold;');
      problemas.forEach((p) => console.error('  ✗ ' + p));
      avisos.forEach((a) => console.warn('  ! ' + a));
      if (problemas.length > 0) {
        console.log('%cOs itens com ✗ são invariantes quebrados -- vale reportar.', 'color:#A3251A;font-weight:bold;');
      }
    }

    return { problemas, avisos, checagens };
  }

  /* ---------------------------------------------------------------------
   * 9. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  limparAntigos();

  const bytes = tamanho();
  if (bytes > CONFIG_DIARIO.LIMITE_AVISO_BYTES) {
    console.warn(
      `[Diário] Já são ~${(bytes / 1_000_000).toFixed(1)} MB guardados. ` +
      'Rode window.__diario.exportar() e depois window.__diario.limpar() pra não esbarrar na cota do navegador.'
    );
  }

  if (CONFIG_DIARIO.ATIVAR_GRUPO_CONTROLE) {
    console.log(
      `%c[Diário] Grupo de controle LIGADO -- 1 em cada ${CONFIG_DIARIO.PROPORCAO_CONTROLE} clientes recebe posição sorteada na fila.`,
      'color:#8A2A16;font-weight:bold;'
    );
  }

  // Atalho curto: é pra ser digitado no console sem consultar documentação.
  window.__conferir = conferir;

  // Namespace curto pros diagnósticos que saem da tela. Tudo aqui já sai
  // censurado -- a ideia é poder colar sem ter que pensar nisso.
  window.__diag = { fila: relatorioFila, grupo: relatorioGrupo, apelido, censurar: censurarTexto };

  window.__diario = {
    registrar,
    registrarLote,
    conferir,
    apelido,
    valorMascarado,
    nomeMascarado,
    urlMascarada,
    censurarTexto,
    montarExportacao,
    relatorioFila,
    relatorioGrupo,
    analisar,
    relatorio,
    ehGrupoControle,
    sorteioEstavel,
    eventos,
    tamanho,
    exportar,
    limpar,
    chaveDia,
    hashEstavel,
    CONFIG_DIARIO,
  };
})();
