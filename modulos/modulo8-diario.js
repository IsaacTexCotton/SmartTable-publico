/* =========================================================================
 * MÓDULO 8: DIÁRIO DE COBRANÇA — CRM TexCotton
 * -------------------------------------------------------------------------
 * Registra o que aconteceu, pra permitir responder uma pergunta que hoje
 * ninguém consegue responder: a régua de prioridade do Alt+U funciona?
 *
 * O QUE ELE GRAVA (três tipos de evento):
 *   - 'fila'    : um por candidato, a cada rodada do Alt+U. Guarda a faixa
 *                 calculada e a POSIÇÃO final na fila.
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
 *      qualquer ordem. O diário mede COBERTURA (quem é chamado, quem nunca
 *      é), não o efeito da ORDEM. O grupo de controle, que mediria isso
 *      sorteando posições, foi REMOVIDO a pedido do usuário (28/09/2026).
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
    // Maior número de faixa SE o Módulo 7 não estiver carregado. Com ele, o
    // limite vem da própria régua (faixaMaxima) -- na régua v3 (28/09) as
    // faixas foram de 12 pra 15 e um número fixo aqui acusaria as novas
    // como "faixa inválida" na autoconferência.
    FAIXA_MAXIMA: 15,
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
      // Só o NOME do erro: a mensagem de um JSON.parse pode trazer trecho do conteúdo (CNPJ, nome).
      console.warn('[Diário] Não consegui listar o localStorage.', erro?.name);
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
      console.warn(`[Diário] Dia ${diaNumerico} ilegível -- tratando como vazio.`, erro?.name);
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
        erro?.name
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
   * 4. HASH ESTÁVEL (base dos apelidos censurados, ver apelido())
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
   * @returns {object} Totais e linhas por faixa.
   */
  function analisar(opcoes = {}) {
    const janela = opcoes.janelaBaixaDias ?? 7;
    const todos = eventos({ ultimosDias: opcoes.ultimosDias });

    // DEDUPLICA por (cnpj, dia): o mesmo cliente pode ter VÁRIAS atribuições
    // no mesmo dia, e contar todas infla "na fila" e derruba a taxa de
    // contato pela metade -- números descritivos errados, justamente os que
    // o diário existe pra dar.
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
    for (let faixa = 1; faixa <= faixaMaxima(); faixa += 1) {
      const doTier = daReguaAtual.filter((l) => l.faixa === faixa);
      if (doTier.length > 0) porFaixa[faixa] = resumir(doTier);
    }

    return {
      janelaBaixaDias: janela,
      totalAtribuicoes: linhas.length,
      atribuicoesRepetidas,
      atribuicoesReguaAnterior: linhas.length - daReguaAtual.length,
      porFaixa,
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

    console.log(
      '\n%cComo ler isto:%c\n' +
      '  • A tabela POR FAIXA não diz se a régua é boa. As faixas contêm clientes\n' +
      '    diferentes por construção -- quem está 2 dias atrasado paga mais que quem\n' +
      '    está 30 em qualquer ordem. Ela serve pra ver cobertura (quem nunca é chamado).\n' +
      '  • Estes dados não respondem "a ordem da régua ajuda?": isso exigiria sortear\n' +
      '    posições (grupo de controle), que foi removido por decisão do usuário.\n' +
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
        const linha = { p: e.p, f: e.f, s: e.s, a: e.a };
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

  /** Maior faixa da régua atual (Módulo 7); sem ele, o valor de reserva. */
  function faixaMaxima() {
    const numeros = Object.keys(window.filaPrioridadeDebug?.NOMES_PRIORIDADE ?? {}).map(Number).filter(Number.isFinite);
    return numeros.length > 0 ? Math.max(...numeros) : CONFIG_DIARIO.FAIXA_MAXIMA;
  }

  /* ---------------------------------------------------------------------
   * 8. AUTOCONFERÊNCIA (window.__conferir)
   * -----------------------------------------------------------------
   * Checa invariantes contra o estado REAL da página e do storage.
   *
   * POR QUE ISTO EXISTE, e por que não é "mais um teste": os bugs que
   * chegaram a atrapalhar a cobrança de verdade não foram pegos pela suíte.
   * Foram pegos quando o usuário exportou a fila e alguém olhou --
   * a régua reordenando errado, o grupo de controle (hoje removido) nunca alcançando o fim
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
  /**
   * Dois clientes vizinhos da MESMA faixa estão na ordem da régua v3?
   * Espelha compararPelaRegua do Módulo 7 (tests/diario.test.js confere que
   * os dois concordam em milhares de pares): na faixa SCPC antes do
   * aviso de suspensão, mais dias primeiro; nas demais, contato mais antigo (sem contato
   * = antes de todos), depois maior valor vencido, depois mais dias.
   *
   * BUG REAL (v1.49.2, achado na revisão de comentários): até a v1.49.1 esta
   * checagem ainda era a da régua v2 (contato, depois dias) e acusava como
   * "invariante quebrado" uma fila v3 correta -- SCPC antes do aviso (então
   * a faixa 14) e empates
   * decididos pelo valor vencido.
   *
   * @returns {boolean|null} true = em ordem; false = quebra; null = falta o
   *   valor vencido (fila montada antes da v1.49.2) pra decidir o empate.
   */
  function vizinhosNaOrdemDaRegua(anterior, atual) {
    const faixaDiasPrimeiro = window.filaPrioridadeDebug?.FAIXA_SCPC_ANTES_DO_AVISO ?? 10;
    const dias = (atual.diasAtraso ?? 0) - (anterior.diasAtraso ?? 0);
    if (atual.prioridadeTier === faixaDiasPrimeiro && dias !== 0) return dias < 0;
    const contatoAnt = anterior.ultimoContatoIso ?? '';
    const contato = atual.ultimoContatoIso ?? '';
    if (contatoAnt !== contato) return contatoAnt < contato;
    if (anterior.valorVencido === undefined || atual.valorVencido === undefined) return null;
    const valor = (atual.valorVencido ?? 0) - (anterior.valorVencido ?? 0);
    if (valor !== 0) return valor < 0;
    return dias <= 0;
  }

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

      let quebrasFaixa = 0;
      let quebrasDias = 0;
      let semValorPraDesempate = 0;
      for (let i = 1; i < c.length; i += 1) {
        if (c[i].prioridadeTier < c[i - 1].prioridadeTier) quebrasFaixa += 1;
        // Dentro da faixa: a ordem da régua v3 (ver vizinhosNaOrdemDaRegua).
        if (c[i].prioridadeTier === c[i - 1].prioridadeTier) {
          const emOrdem = vizinhosNaOrdemDaRegua(c[i - 1], c[i]);
          if (emOrdem === false) quebrasDias += 1;
          else if (emOrdem === null) semValorPraDesempate += 1;
        }
      }
      exigir(quebrasFaixa === 0, `A ordem de faixa quebra ${quebrasFaixa} vez(es).`);
      exigir(
        quebrasDias === 0,
        `O desempate dentro da faixa (SCPC antes do aviso: mais dias; demais: contato mais antigo, maior valor vencido, mais dias) quebra ${quebrasDias} vez(es).`
      );
      observar(
        semValorPraDesempate === 0,
        `${semValorPraDesempate} empate(s) de contato não conferido(s): a fila foi montada antes da v1.49.2, sem o valor vencido. Um Alt+U novo resolve.`
      );
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

      const maxima = faixaMaxima();
      const faixaInvalida = filasHoje.filter((e) => !(e.f >= 1 && e.f <= maxima)).length;
      exigir(faixaInvalida === 0, `${faixaInvalida} registro(s) de fila com faixa fora de 1..${maxima}.`);
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

  /* ---------------------------------------------------------------------
   * 9. RITMO DO OPERADOR (window.__diag.qualidade / ritmo / filaDefasada)
   * -----------------------------------------------------------------
   * PEDIDO DO USUÁRIO (28/09/2026, depois da discussão com o advogado do
   * diabo): antes de mexer no fluxo pra "ganhar segundos", MEDIR onde o
   * tempo do operador vai. Só o operador deste navegador conta (o usuário
   * pediu "apenas eu"): o negociador com mais contatos gravados; qualquer
   * outro entra só como contagem.
   *
   * O QUE CADA UM RESPONDE
   *   - qualidade():    dá pra confiar nos números? (dias, eventos sem
   *                     negociador, intervalos de zero minuto...). É o
   *                     PORTÃO: sem 10 dias válidos, nada abaixo conclui.
   *   - ritmo():        cobertura da fila (clientes distintos), cobertura
   *                     por terço da fila (o que sobra é o fim dela?),
   *                     intervalo entre contatos consecutivos e pausas,
   *                     horários em blocos de 30 min e a fração de contatos
   *                     depois do fim do expediente (17:15).
   *   - filaDefasada(): (só na página da LISTA) quantos clientes da fila
   *                     salva já não estão na lista de vencidos e ainda não
   *                     foram contatados hoje.
   *
   * LIMITES QUE ESTA MEDIÇÃO TEM (o advogado do diabo insistiu nisto):
   *   - 'contato' marca a ABERTURA do WhatsApp, não o envio: a cobertura é
   *     um TETO. O Alt+N (promessa) não conta como contato: vira "buraco".
   *   - A resolução do relógio é 1 minuto; por isso p25/mediana/p75 e a
   *     fração de intervalos de 0 ou 1 minuto, nunca só a mediana.
   *   - O ciclo entre dois contatos mistura Alt+A, WhatsApp e tudo o mais:
   *     este diagnóstico NÃO mede a espera do Alt+A nem o custo das
   *     colagens (isso pede cronômetro manual).
   *   - Dias antes e depois de mudança de fluxo (ex.: v1.52.0, Alt+S) entram
   *     juntos; a leitura por recorte (segunda x demais) ajuda, a de versão
   *     do script não existe no diário.
   *
   * PRIVACIDADE (regra do projeto + red team): tudo sai por sanitizarSaida,
   * que só deixa passar número, booleano, null e textos de uma lista fechada
   * -- estrutural, não depende de o autor lembrar. Contagens por célula
   * abaixo de 5 saem como "<5"; percentil só com 20 intervalos ou mais;
   * nunca mínimo nem máximo; horários em blocos de 30 min; nada por dia
   * nem por cliente. SOMENTE LEITURA: não grava nada (nem no diário, nem
   * apaga a fila de ontem) e não imprime nenhum objeto de erro.
   *
   * ACEITO DE PROPÓSITO (revisão do guardião de privacidade): os horários do
   * operador (primeiro/último contato, depois das 17:15) descrevem a jornada
   * de UMA pessoa. O usuário pediu "apenas eu" e os dados são do navegador dele;
   * se um dia esse diagnóstico for usado em máquina compartilhada, revisar.
   * fila_total e lista_total saem exatos (agregados, sem identidade).
   * --------------------------------------------------------------------- */
  const RITMO = Object.freeze({
    DIAS_MINIMOS: 10,
    CONTATOS_MINIMOS_POR_DIA: 30,
    LIMITES_DE_PAUSA_MIN: Object.freeze([10, 20, 30]),
    K_MINIMO: 5,
    N_MINIMO_PERCENTIL: 20,
    FIM_DO_EXPEDIENTE_MIN: 17 * 60 + 15,
    BLOCO_MIN: 30,
    VARIACAO_MAXIMA_ENTRE_LIMITES: 0.2,
  });
  const TEXTOS_PERMITIDOS_NO_DIAGNOSTICO = new Set(['<5', 'n<20', 'sem dados', '0', '1 a 4', '5 ou mais']);

  /**
   * Filtro final de tudo que sai dos diagnósticos de ritmo: número finito,
   * booleano, null, texto da lista fechada, lista, ou objeto de chaves
   * minúsculas do próprio código. Qualquer outra coisa lança.
   */
  function sanitizarSaida(valor, nivel = 0) {
    if (nivel > 6) throw new Error('saida_invalida');
    if (valor === null || typeof valor === 'boolean') return valor;
    if (typeof valor === 'number') {
      // Limite: um número enorme poderia carregar dígitos de outra coisa (CNPJ) por fora da lista de textos.
      if (!Number.isFinite(valor) || Math.abs(valor) >= 1e6) throw new Error('saida_invalida');
      return valor;
    }
    if (typeof valor === 'string') {
      if (!TEXTOS_PERMITIDOS_NO_DIAGNOSTICO.has(valor)) throw new Error('saida_invalida');
      return valor;
    }
    if (Array.isArray(valor)) return valor.map((item) => sanitizarSaida(item, nivel + 1));
    if (typeof valor === 'object') {
      return Object.fromEntries(Object.entries(valor).map(([chave, item]) => {
        if (!/^[a-z][a-z0-9_]*$/.test(chave)) throw new Error('saida_invalida');
        return [chave, sanitizarSaida(item, nivel + 1)];
      }));
    }
    throw new Error('saida_invalida');
  }

  /** Monta a saída e a passa pelo filtro; se algo não passa, devolve só um código fixo. */
  function saidaSegura(montar) {
    try {
      return sanitizarSaida(montar());
    } catch (erro) {
      return { saida_invalida: true };
    }
  }

  const arredondar = (x, casas = 3) => Math.round(x * 10 ** casas) / 10 ** casas;
  const celulaK = (n) => (n < RITMO.K_MINIMO ? '<5' : n);
  const faixaDeContagem = (n) => (n === 0 ? '0' : n < RITMO.K_MINIMO ? '1 a 4' : '5 ou mais');
  const blocoDe = (minutos) => Math.floor(minutos / RITMO.BLOCO_MIN) * RITMO.BLOCO_MIN;

  function percentilDe(valores, p) {
    if (!valores.length) return null;
    const ordenados = [...valores].sort((a, b) => a - b);
    return ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1))];
  }

  /** p25/mediana/p75 só com n suficiente; nunca mínimo nem máximo. */
  function estatisticaDeMinutos(intervalos) {
    const n = intervalos.length;
    const pequenos = n === 0 ? 0 : intervalos.filter((m) => m <= 1).length / n;
    if (n < RITMO.N_MINIMO_PERCENTIL) {
      return { n, p25: 'n<20', mediana: 'n<20', p75: 'n<20', fracao_0_ou_1_min: arredondar(pequenos) };
    }
    return {
      n,
      p25: percentilDe(intervalos, 0.25),
      mediana: percentilDe(intervalos, 0.5),
      p75: percentilDe(intervalos, 0.75),
      fracao_0_ou_1_min: arredondar(pequenos),
    };
  }

  function diaDaSemanaDe(dia) {
    return new Date(Math.floor(dia / 10000), (Math.floor(dia / 100) % 100) - 1, dia % 100).getDay();
  }

  /**
   * Lê o diário (só leitura) e devolve, por dia anterior a hoje, o que o
   * ritmo precisa -- do operador (negociador com mais contatos) apenas.
   */
  function lerDiasParaRitmo() {
    const hoje = chaveDia();
    const dias = chavesExistentes().map(diaDaChave).filter((d) => d < hoje);
    const eventosPorDia = new Map(dias.map((d) => [d, lerDia(d)]));

    const contagemPorNegociador = new Map();
    let contatosSemNegociador = 0;
    let totalContatos = 0;
    eventosPorDia.forEach((eventosDoDia) => eventosDoDia.filter((e) => e.t === 'contato').forEach((e) => {
      totalContatos += 1;
      const n = String(e.n ?? '');
      if (!n) contatosSemNegociador += 1;
      else contagemPorNegociador.set(n, (contagemPorNegociador.get(n) ?? 0) + 1);
    }));
    const ordenados = [...contagemPorNegociador.entries()].sort((a, b) => b[1] - a[1]);
    const operador = ordenados[0]?.[0] ?? null;

    let contatosDeOutros = 0;
    contagemPorNegociador.forEach((quantidade, nome) => { if (nome !== operador) contatosDeOutros += quantidade; });

    const lista = dias.map((dia) => {
      const eventosDoDia = eventosPorDia.get(dia);
      const fila = new Map();
      let filaRepetida = false;
      let regua = null;
      eventosDoDia.filter((e) => e.t === 'fila').forEach((e) => {
        if (fila.has(e.c)) { filaRepetida = true; return; }
        fila.set(e.c, Number(e.p) || 0);
        if (regua === null) regua = e.r ?? 1;
      });
      // Primeiro contato de cada cliente no dia, só do operador.
      const contatos = new Map();
      eventosDoDia.filter((e) => e.t === 'contato' && String(e.n ?? '') === operador).forEach((e) => {
        const h = Number(e.h);
        // Hora em minutos desde a meia-noite: inteiro de 0 a 1439; outra coisa é dado corrompido e não entra.
        if (!Number.isInteger(h) || h < 0 || h > 1439) return;
        if (!contatos.has(e.c) || h < contatos.get(e.c)) contatos.set(e.c, h);
      });
      const valido = fila.size > 0 && contatos.size >= RITMO.CONTATOS_MINIMOS_POR_DIA;
      return { dia, fila, filaRepetida, regua, contatos, valido };
    });

    return { hoje, lista, operador, totalContatos, contatosSemNegociador, contatosDeOutros, outros: Math.max(0, contagemPorNegociador.size - (operador ? 1 : 0)) };
  }

  /** Portão: dá pra confiar nos números? Só contagens. */
  function qualidadeDiario() {
    return saidaSegura(() => {
      const dados = lerDiasParaRitmo();
      let intervalosZero = 0;
      let diasComFilaRepetida = 0;
      let diasSemFila = 0;
      const diasPorRegua = {};
      dados.lista.forEach((d) => {
        if (d.filaRepetida) diasComFilaRepetida += 1;
        if (d.fila.size === 0) diasSemFila += 1;
        else {
          // A chave vem do campo `r` do diário: só um inteiro pequeno vira parte do nome.
          const chave = Number.isInteger(d.regua) && d.regua >= 0 && d.regua < 100 ? `regua_${d.regua}` : 'regua_outra';
          diasPorRegua[chave] = (diasPorRegua[chave] ?? 0) + 1;
        }
        const horas = [...d.contatos.entries()].filter(([c]) => d.fila.has(c)).map(([, h]) => h).sort((a, b) => a - b);
        for (let i = 1; i < horas.length; i += 1) if (horas[i] === horas[i - 1]) intervalosZero += 1;
      });
      const diasValidos = dados.lista.filter((d) => d.valido).length;
      return {
        versao_diagnostico: 1,
        hoje_excluido: true,
        dias_no_diario: dados.lista.length,
        dias_validos: diasValidos,
        // Contagens pequenas de pessoas/eventos raros saem em FAIXA ("0", "1 a 4", "5 ou mais"):
        // "o outro negociador fez 2 contatos" descreve alguém, e por subtração daria o número exato do operador.
        dias_sem_fila: faixaDeContagem(diasSemFila),
        dias_com_fila_repetida: faixaDeContagem(diasComFilaRepetida),
        dias_por_regua: diasPorRegua,
        contatos_no_total: dados.totalContatos,
        contatos_sem_negociador: faixaDeContagem(dados.contatosSemNegociador),
        contatos_de_outros_negociadores: faixaDeContagem(dados.contatosDeOutros),
        outros_negociadores: faixaDeContagem(dados.outros),
        intervalos_de_zero_minuto: faixaDeContagem(intervalosZero),
        dias_minimos_para_concluir: RITMO.DIAS_MINIMOS,
        pode_concluir: diasValidos >= RITMO.DIAS_MINIMOS,
      };
    });
  }

  function resumoDoRecorte(diasValidos) {
    if (diasValidos.length < RITMO.DIAS_MINIMOS) return { dias: diasValidos.length, resultado: 'sem dados' };

    // Cobertura: clientes DISTINTOS da fila do dia que receberam contato.
    const coberturas = [];
    const tercos = [[0, 0], [0, 0], [0, 0]]; // [clientes na fila, contatados]
    let contatosNoTotal = 0;
    let contatosDepoisDoExpediente = 0;
    let diasComContatoDepoisDoExpediente = 0;
    const filas = [];
    const contatosPorDia = [];
    const primeirosBlocos = [];
    const ultimosBlocos = [];
    diasValidos.forEach((d) => {
      const maiorPosicao = Math.max(...d.fila.values(), 1);
      let cobertos = 0;
      d.fila.forEach((posicao, cliente) => {
        const terco = Math.min(2, Math.floor(((posicao || 1) - 1) * 3 / maiorPosicao));
        tercos[terco][0] += 1;
        if (d.contatos.has(cliente)) { cobertos += 1; tercos[terco][1] += 1; }
      });
      coberturas.push(cobertos / d.fila.size);
      filas.push(d.fila.size);
      contatosPorDia.push(d.contatos.size);
      const horas = [...d.contatos.values()].sort((a, b) => a - b);
      primeirosBlocos.push(blocoDe(horas[0]));
      ultimosBlocos.push(blocoDe(horas[horas.length - 1]));
      const depois = horas.filter((h) => h > RITMO.FIM_DO_EXPEDIENTE_MIN).length;
      contatosNoTotal += horas.length;
      contatosDepoisDoExpediente += depois;
      if (depois > 0) diasComContatoDepoisDoExpediente += 1;
    });

    const porLimite = {};
    const medianasAtivas = [];
    RITMO.LIMITES_DE_PAUSA_MIN.forEach((limite) => {
      const ativos = [];
      const ativoPorDia = [];
      const pausaPorDia = [];
      const spanPorDia = [];
      const fracaoPausaPorDia = [];
      let pausas = 0;
      diasValidos.forEach((d) => {
        // Só pares em que os DOIS contatos são de clientes da fila do dia.
        const horas = [...d.contatos.entries()].filter(([c]) => d.fila.has(c)).map(([, h]) => h).sort((a, b) => a - b);
        let ativo = 0;
        let pausa = 0;
        for (let i = 1; i < horas.length; i += 1) {
          const intervalo = horas[i] - horas[i - 1];
          if (intervalo <= limite) { ativos.push(intervalo); ativo += intervalo; } else { pausas += 1; pausa += intervalo; }
        }
        const span = horas.length > 1 ? horas[horas.length - 1] - horas[0] : 0;
        ativoPorDia.push(ativo);
        pausaPorDia.push(pausa);
        spanPorDia.push(span);
        fracaoPausaPorDia.push(span > 0 ? pausa / span : 0);
      });
      const estatistica = estatisticaDeMinutos(ativos);
      if (typeof estatistica.mediana === 'number') medianasAtivas.push(estatistica.mediana);
      porLimite[`limite_${limite}_min`] = {
        intervalos_ativos: estatistica,
        pausas_no_total: pausas,
        tempo_ativo_min_mediano_por_dia: percentilDe(ativoPorDia, 0.5),
        tempo_pausa_min_mediano_por_dia: percentilDe(pausaPorDia, 0.5),
        span_min_mediano_por_dia: percentilDe(spanPorDia, 0.5),
        fracao_de_pausa_mediana: arredondar(percentilDe(fracaoPausaPorDia, 0.5)),
      };
    });
    const menor = Math.min(...medianasAtivas);
    const maior = Math.max(...medianasAtivas);
    const dominadoPorPausas = medianasAtivas.length < RITMO.LIMITES_DE_PAUSA_MIN.length
      || menor === 0
      || (maior - menor) / menor > RITMO.VARIACAO_MAXIMA_ENTRE_LIMITES;

    return {
      dias: diasValidos.length,
      fila_mediana: percentilDe(filas, 0.5),
      contatos_distintos_mediano: percentilDe(contatosPorDia, 0.5),
      cobertura_mediana: arredondar(percentilDe(coberturas, 0.5)),
      fracao_de_dias_com_cobertura_90: arredondar(coberturas.filter((c) => c >= 0.9).length / coberturas.length),
      fracao_de_dias_com_cobertura_95: arredondar(coberturas.filter((c) => c >= 0.95).length / coberturas.length),
      cobertura_por_terco_da_fila: tercos.map(([naFila, contatados]) => (naFila < RITMO.K_MINIMO
        ? { clientes: '<5', cobertura: '<5' }
        : { clientes: celulaK(naFila), cobertura: arredondar(contatados / naFila) })),
      primeiro_contato_bloco_mediano_min: percentilDe(primeirosBlocos, 0.5),
      ultimo_contato_bloco_mediano_min: percentilDe(ultimosBlocos, 0.5),
      fim_do_expediente_min: RITMO.FIM_DO_EXPEDIENTE_MIN,
      fracao_de_contatos_depois_do_expediente: arredondar(contatosDepoisDoExpediente / contatosNoTotal),
      fracao_de_dias_com_contato_depois_do_expediente: arredondar(diasComContatoDepoisDoExpediente / diasValidos.length),
      ritmo_por_limite_de_pausa: porLimite,
      conclusao_indeterminada_por_pausas: dominadoPorPausas,
    };
  }

  /** Cobertura e ritmo do operador deste navegador, por recorte (todos / segunda / demais). */
  function relatorioRitmo() {
    const saida = saidaSegura(() => {
      const dados = lerDiasParaRitmo();
      const validos = dados.lista.filter((d) => d.valido);
      const segundas = validos.filter((d) => diaDaSemanaDe(d.dia) === 1);
      const demais = validos.filter((d) => diaDaSemanaDe(d.dia) !== 1);
      return {
        versao_diagnostico: 1,
        hoje_excluido: true,
        dias_validos: validos.length,
        operador_unico: dados.outros === 0,
        outros_negociadores: faixaDeContagem(dados.outros),
        cobertura_e_teto: true,
        recortes: {
          todos: resumoDoRecorte(validos),
          segunda_feira: resumoDoRecorte(segundas),
          demais_dias: resumoDoRecorte(demais),
        },
      };
    });
    console.log(JSON.stringify(saida));
    console.log('%c^ Pode colar: só números. Contato = abertura do WhatsApp (cobertura é um TETO).', 'color:#1B6B4A;font-weight:bold;');
    return saida;
  }

  /** Portão de qualidade do diário, pronto pra colar. */
  function relatorioQualidade() {
    const saida = qualidadeDiario();
    console.log(JSON.stringify(saida));
    console.log('%c^ Pode colar: só contagens.', 'color:#1B6B4A;font-weight:bold;');
    return saida;
  }

  /**
   * A fila salva, lida SEM efeitos: obterFila() do Módulo 3 apaga a fila de
   * ontem (removeItem) e imprime o erro do JSON.parse (com CNPJs) -- o que
   * quebraria "somente leitura" e a censura. Aqui o parse é próprio, silencioso,
   * e usa o mesmo critério de dia (uma fila de outro dia não conta).
   */
  function lerFilaSemEfeitos() {
    try {
      const chave = window.filaDebug?.CONFIG?.CHAVE_STORAGE;
      if (!chave) return null;
      const bruto = localStorage.getItem(chave);
      const fila = bruto ? JSON.parse(bruto) : null;
      if (!fila || !Array.isArray(fila.clientes)) return null;
      if (chaveDia(new Date(fila.iniciadoEm)) !== chaveDia()) return null;
      return fila;
    } catch (erro) {
      return null;
    }
  }

  /**
   * Só na página da LISTA (window.CLIENTES só existe lá): quantos clientes da
   * fila salva já não estão na lista de vencidos e ainda NÃO foram contatados
   * hoje. Quem pagou depois de receber a mensagem de hoje é sucesso da
   * cobrança e não conta. Saída em faixas ("0", "1 a 4", "5 ou mais").
   */
  function relatorioFilaDefasada() {
    const saida = saidaSegura(() => {
      const lista = Array.isArray(window.CLIENTES) ? window.CLIENTES : null;
      const fila = lerFilaSemEfeitos();
      const clientes = Array.isArray(fila?.clientes) ? fila.clientes : null;
      if (!lista || !clientes) return { versao_diagnostico: 1, lista_disponivel: lista !== null, fila_disponivel: clientes !== null };
      const naLista = new Set(lista.map((c) => c?.cnpj).filter(Boolean));
      const atendidos = window.filaDebug?.obterAtendidosHoje?.() ?? new Set();
      const foraDaLista = clientes.filter((c) => !naLista.has(c.cnpj));
      const pendentes = foraDaLista.filter((c) => !atendidos.has(c.cnpj));
      const filtros = window.__smartTableUtil?.filtrosAtivosNaListaDeClientes?.(lista) ?? null;
      return {
        versao_diagnostico: 1,
        lista_disponivel: true,
        fila_disponivel: true,
        fila_total: clientes.length,
        lista_total: lista.length,
        filtro_ativo_na_lista: filtros !== null,
        fora_da_lista: faixaDeContagem(foraDaLista.length),
        fora_da_lista_e_ainda_nao_contatados_hoje: faixaDeContagem(pendentes.length),
      };
    });
    console.log(JSON.stringify(saida));
    console.log('%c^ Pode colar: só números e faixas.', 'color:#1B6B4A;font-weight:bold;');
    return saida;
  }

  const bytes = tamanho();
  if (bytes > CONFIG_DIARIO.LIMITE_AVISO_BYTES) {
    console.warn(
      `[Diário] Já são ~${(bytes / 1_000_000).toFixed(1)} MB guardados. ` +
      'Rode window.__diario.exportar() e depois window.__diario.limpar() pra não esbarrar na cota do navegador.'
    );
  }

  // Atalho curto: é pra ser digitado no console sem consultar documentação.
  window.__conferir = conferir;

  // Namespace curto pros diagnósticos que saem da tela. Tudo aqui já sai
  // censurado -- a ideia é poder colar sem ter que pensar nisso.
  window.__diag = {
    fila: relatorioFila,
    grupo: relatorioGrupo,
    apelido,
    censurar: censurarTexto,
    qualidade: relatorioQualidade,
    ritmo: relatorioRitmo,
    filaDefasada: relatorioFilaDefasada,
  };

  window.__diario = {
    registrar,
    registrarLote,
    conferir,
    vizinhosNaOrdemDaRegua,
    faixaMaxima,
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
    eventos,
    tamanho,
    exportar,
    limpar,
    chaveDia,
    hashEstavel,
    qualidadeDiario,
    relatorioRitmo,
    relatorioFilaDefasada,
    sanitizarSaida,
    saidaSegura,
    ritmoInterno: { RITMO, estatisticaDeMinutos, celulaK, faixaDeContagem, blocoDe },
    CONFIG_DIARIO,
  };
})();
