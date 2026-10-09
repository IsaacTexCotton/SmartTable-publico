/* =========================================================================
 * MÓDULO 23: CARTEIRA — HISTÓRICO (fotografia, análises, resultado e backup)
 * -------------------------------------------------------------------------
 * O que o painel da Carteira (Alt+M, Módulo 14) calcula e faz com o
 * histórico gravado pelo Módulo 22:
 *   - a FOTOGRAFIA do dia (captura da lista de clientes, validação, gravação e
 *     o resultado de cada tentativa);
 *   - comparação, CURA (quem quitou), PONTE (por que o vencido mudou), cura
 *     semanal, lacunas de dia útil e lembrete de backup;
 *   - RÉGUA x RESULTADO: cruza o diário (Módulo 8: faixa do Alt+U, hora do
 *     contato) com quem quitou em até 7 dias (descritivo, não causal);
 *   - RESULTADO do período (APIs do Alt+D, Módulo 10: dashboard-consolidado e
 *     a lista de promessas, cumpridas pelo dia do pagamento) e previsão de
 *     entrada das promessas;
 *   - EXPORTAÇÃO em CSV e BACKUP/restauração do histórico.
 *
 * Extraído do Módulo 14 na v1.64.0 sem mudar comportamento: o código foi
 * movido como estava. Depende do Módulo 22 (window.__carteiraDados) e, na hora
 * do uso, do Módulo 10 (buscarConsolidado) e do Módulo 8 (diário). Expõe
 * window.__carteiraHistorico (congelado), usado pelo Módulo 14.
 * Precisa carregar DEPOIS do 22 e ANTES do 14.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__carteiraHistoricoCarregado) return;
  window.__carteiraHistoricoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Carteira: Histórico');

  if (!window.__carteiraDados) {
    console.error('[Carteira] O Módulo 22 (Carteira: Dados) não carregou antes deste. Atualize o script no Tampermonkey.');
    window.__smartTableUtil?.toast?.('SmartTable: falta o módulo de dados da Carteira (Módulo 22). Atualize o script no Tampermonkey.', 12000);
    return;
  }

  const {
    CONFIG_CARTEIRA,
    util,
    isoDe,
    dataDeIso,
    diasEntre,
    somarDias,
    ddmm,
    isoDoDiario,
    ehDataIso,
    numero,
    diasDe,
    hashCnpj,
    ehDaCarteira,
    clientesDaCarteira,
    filtrosAtivosNaLista,
    indiceFaixa,
    estadoDe,
    quitou,
    montarRegistro,
    descreverAlerta,
    lerStatus,
    gravarStatus,
    pedirPersistencia,
    estaUsandoMemoria,
    lerDia,
    gravarDia,
    listarDias,
    apagarDias,
    lerRegistros,
    decodificar,
    lerHistorico,
    agregadoDe,
    migrarLocalStorage,
  } = window.__carteiraDados;

  /* ---------------------------------------------------------------------
   * FOTOGRAFIA DO DIA
   * --------------------------------------------------------------------- */

  let capturaEmAndamento = null;

  /**
   * Tira a fotografia do dia a partir da lista, se houver lista. Grava o
   * BRUTO; nenhum cálculo acontece antes da gravação. Registra o resultado
   * (sucesso ou falha) no status e avisa por toast quando falha.
   *
   * Duas chamadas ao mesmo tempo (carga da página + Alt+M) viram uma só.
   *
   * @param {{lista?: object[], hoje?: Date}} [opcoes]
   * @returns {Promise<object|null>} O agregado do dia (calculado DEPOIS de
   *   gravar), ou null se não havia lista.
   */
  function capturarFotografia(opcoes = {}) {
    if (capturaEmAndamento && !opcoes.lista && !opcoes.forcar) return capturaEmAndamento;
    const execucao = capturarAgora(opcoes).finally(() => {
      if (capturaEmAndamento === execucao) capturaEmAndamento = null;
    });
    if (!opcoes.lista) capturaEmAndamento = execucao;
    return execucao;
  }

  async function capturarAgora(opcoes) {
    const lista = opcoes.lista ?? window.CLIENTES;
    if (!Array.isArray(lista) || lista.length === 0) return null;
    // Lista de outra pessoa (ex.: atendendo pela conta da colega): não é
    // a carteira configurada, não fotografa.
    if (clientesDaCarteira(lista).length === 0) return null;

    const agora = opcoes.hoje ?? new Date();
    const hojeIso = isoDe(agora);
    gravarStatus({ ultimaTentativa: agora.toISOString() });

    const filtros = filtrosAtivosNaLista(lista);
    if (filtros) {
      gravarStatus({ ultimaListaFiltrada: { quando: agora.toISOString(), data: hojeIso, filtros } });
      console.warn(`[Carteira] Lista com filtro (${filtros.join(', ')}) -- a fotografia do dia só é tirada da lista completa.`);
      // Avisa na tela só enquanto o dia ainda não tem fotografia: com ela já
      // tirada, abrir a lista filtrada é o uso normal e não precisa de aviso.
      let semFotoHoje = true;
      try {
        semFotoHoje = !(await lerDia(hojeIso));
      } catch (erro) {
        semFotoHoje = true;
      }
      if (semFotoHoje) {
        util()?.toast?.(`Carteira: a fotografia de hoje só é tirada com a lista SEM filtro (ligado: ${filtros.join(', ')}). Abra a lista sem filtro uma vez hoje.`, 8000);
      }
      return null;
    }

    let registro;
    try {
      ({ registro } = montarRegistro(lista, agora));
      await migrarLocalStorage();
      const existente = decodificar(await lerDia(hojeIso));
      // forcar: "Tirar nova fotografia de hoje" substitui mesmo com menos
      // clientes (a primeira pode ter saído errada). Fica registrado no status.
      const substitui = opcoes.forcar || !existente || existente.legado || registro.totalLista > existente.totalLista;
      if (opcoes.forcar && existente) {
        gravarStatus({ fotografiaRefeita: { quando: agora.toISOString(), data: hojeIso, antes: existente.totalLista, depois: registro.totalLista } });
      }
      if (substitui) {
        await gravarDia(registro);
        registro.alertas.forEach((a) => console.warn(`[Carteira] Alerta nos dados de ${ddmm(hojeIso)}: ${descreverAlerta(a)}`));
      } else {
        registro = null;
      }
      gravarStatus({
        ultimoSucesso: { quando: agora.toISOString(), data: hojeIso, clientes: lista.length, gravou: substitui },
        ultimoErro: null,
      });
    } catch (erro) {
      const mensagem = erro?.message ?? String(erro);
      gravarStatus({ ultimoErro: { quando: agora.toISOString(), data: hojeIso, mensagem } });
      console.warn('[Carteira] A fotografia de hoje NÃO foi gravada.', erro);
      util()?.toast?.(`Carteira: a fotografia de hoje não foi gravada (${mensagem}). Abra o Alt+M.`);
      return null;
    }

    // Limpeza e persistência DEPOIS de gravar: nada disso pode impedir a
    // gravação, e uma falha aqui não apaga o sucesso acima.
    try {
      const datas = await listarDias();
      await apagarDias(datas.filter((d) => {
        const idade = diasEntre(d, hojeIso);
        return idade === null || idade > CONFIG_CARTEIRA.DIAS_RETENCAO;
      }));
    } catch (erro) {
      console.warn('[Carteira] Falha ao apagar fotografias antigas (sem perda de dados).', erro?.message);
    }
    // Sem IndexedDB a fotografia só existe na memória da aba e some no reload: avisa na hora, uma vez por dia.
    if (estaUsandoMemoria() && lerStatus().ultimoAvisoMemoria !== hojeIso) {
      util()?.toast?.('Carteira: este navegador não deixou usar o armazenamento local. A fotografia de hoje vale só nesta aba e se perde ao recarregar.', 9000);
      gravarStatus({ ultimoAvisoMemoria: hojeIso });
    }
    const persistente = await pedirPersistencia();
    if (persistente !== null) gravarStatus({ persistente });

    // Lembrete de backup, no máximo uma vez por dia, na abertura da lista.
    try {
      const status = lerStatus();
      const s = situacaoBackup(status, (await listarDias())[0] ?? null, agora);
      if (s.atrasado && status.ultimoLembreteBackup !== hojeIso) {
        util()?.toast?.(textoLembreteBackup(s), 8000);
        gravarStatus({ ultimoLembreteBackup: hojeIso });
      }
    } catch (erro) {
      console.warn('[Carteira] Falha ao conferir o backup (sem perda de dados).', erro?.message);
    }

    try {
      return agregadoDe(decodificar(registro ?? await lerDia(hojeIso)));
    } catch (erro) {
      console.warn('[Carteira] Fotografia gravada, mas o cálculo falhou.', erro);
      return null;
    }
  }

  /* ---------------------------------------------------------------------
   * COMPARAÇÃO, CURA E PONTE (calculadas na leitura)
   * --------------------------------------------------------------------- */

  function datasDo(historico) {
    return Object.keys(historico.dias).sort();
  }

  /**
   * Data de referência pra comparação: a mais recente com pelo menos
   * DIAS_COMPARACAO dias. Sem nenhuma, a mais antiga (a tela diz a data).
   * `compativelCom`: só datas com clientes no mesmo esquema de hash (pra
   * cura e ponte).
   */
  function dataDeComparacao(historicoOuDatas, hojeIso, compativelCom = null) {
    let datas = Array.isArray(historicoOuDatas) ? [...historicoOuDatas].sort() : datasDo(historicoOuDatas);
    if (compativelCom && !Array.isArray(historicoOuDatas)) {
      datas = datas.filter((d) => {
        const dia = historicoOuDatas.dias[d];
        return Array.isArray(dia?.clientes) && dia.hashVersao === compativelCom.hashVersao;
      });
    }
    const anteriores = datas.filter((d) => d < hojeIso);
    if (anteriores.length === 0) return null;
    const limite = somarDias(hojeIso, -CONFIG_CARTEIRA.DIAS_COMPARACAO);
    const elegiveis = anteriores.filter((d) => d <= limite);
    return elegiveis.length > 0 ? elegiveis[elegiveis.length - 1] : anteriores[0];
  }

  /** Clientes da carteira de um dia, indexados pelo hash. */
  function mapaDoDia(dia) {
    return new Map((dia?.clientes ?? []).filter(ehDaCarteira).map((c) => [c.h, c]));
  }

  /** Os dois dias existem, têm clientes e o mesmo esquema de hash? */
  function comparaveis(a, b) {
    return Boolean(a && b && Array.isArray(a.clientes) && Array.isArray(b.clientes) && a.hashVersao === b.hashVersao);
  }

  /**
   * CURA: quem estava no escopo na origem, onde está no destino
   * (quitaram / seguem / analista), por faixa de origem.
   * @returns {object|null}
   */
  function calcularCura(historico, deIso, ateIso) {
    const a = historico.dias[deIso];
    const b = historico.dias[ateIso];
    if (!comparaveis(a, b)) return null;
    const destino = mapaDoDia(b);
    const vazia = (rotulo) => ({ rotulo, clientes: 0, pagaram: 0, seguem: 0, analista: 0, valorOrigem: 0, valorCurado: 0, valorAnalista: 0 });
    const faixas = CONFIG_CARTEIRA.FAIXAS_AGING.map((f) => vazia(f.rotulo));
    const total = vazia('Total');
    mapaDoDia(a).forEach((c, h) => {
      if (estadoDe(c) !== 'escopo') return;
      const vencida = numero(c.dividaVencida);
      const i = indiceFaixa(diasDe(c));
      const depois = estadoDe(destino.get(h));
      let para = 'seguem';
      if (quitou(depois)) para = 'pagaram';
      else if (depois === 'analista') para = 'analista';
      [total, faixas[i]].forEach((l) => {
        l.clientes += 1;
        l.valorOrigem += vencida;
        l[para] += 1;
        if (para === 'pagaram') l.valorCurado += vencida;
        if (para === 'analista') l.valorAnalista += vencida;
      });
    });
    return { de: deIso, ate: ateIso, janela: diasEntre(deIso, ateIso), faixas, total };
  }

  /**
   * PONTE: vencido de A + entraram + aumentaram − parcial − quitaram −
   * analista = vencido de B. Fecha por construção; `diferenca` ~0.
   * @returns {object|null}
   */
  function calcularPonte(historico, deIso, ateIso) {
    const a = historico.dias[deIso];
    const b = historico.dias[ateIso];
    if (!comparaveis(a, b)) return null;
    const mapaA = mapaDoDia(a);
    const mapaB = mapaDoDia(b);
    const noEscopo = (c) => (estadoDe(c) === 'escopo' ? numero(c.dividaVencida) : 0);
    const cat = () => ({ clientes: 0, valor: 0 });
    const p = {
      de: deIso, ate: ateIso, janela: diasEntre(deIso, ateIso),
      inicial: cat(), entraram: cat(), aumentaram: cat(), reduziram: cat(), pagaram: cat(), analista: cat(), final: cat(),
    };
    const somar = (categoria, valor) => { p[categoria].clientes += 1; p[categoria].valor += valor; };
    new Set([...mapaA.keys(), ...mapaB.keys()]).forEach((h) => {
      const va = noEscopo(mapaA.get(h));
      const vb = noEscopo(mapaB.get(h));
      if (va > 0) somar('inicial', va);
      if (vb > 0) somar('final', vb);
      if (va > 0 && vb > 0) {
        if (vb > va) somar('aumentaram', vb - va);
        else if (vb < va) somar('reduziram', va - vb);
      } else if (vb > 0) {
        somar('entraram', vb);
      } else if (va > 0) {
        if (estadoDe(mapaB.get(h)) === 'analista') somar('analista', va);
        else somar('pagaram', va);
      }
    });
    const arred = (v) => Math.round(v * 100) / 100;
    Object.values(p).forEach((v) => { if (v && typeof v === 'object') v.valor = arred(v.valor); });
    p.diferenca = arred(p.inicial.valor + p.entraram.valor + p.aumentaram.valor
      - p.reduziram.valor - p.pagaram.valor - p.analista.valor - p.final.valor);
    return p;
  }

  /** Cura compacta (pra série semanal e CSV). */
  function resumoDaCura(cura) {
    if (!cura) return null;
    const t = cura.total;
    return {
      de: cura.de,
      janela: cura.janela,
      clientes: t.clientes,
      pagaram: t.pagaram,
      seguem: t.seguem,
      analista: t.analista,
      valorOrigem: Math.round(t.valorOrigem * 100) / 100,
      valorCurado: Math.round(t.valorCurado * 100) / 100,
      valorAnalista: Math.round(t.valorAnalista * 100) / 100,
      faixas: cura.faixas.map((f) => [f.clientes, f.pagaram, f.seguem, f.analista]),
    };
  }

  /**
   * Ponte e cura de um dia contra a sua comparação (7+ dias antes, mesmo
   * esquema de hash). Legado: usa o que foi gravado na época, se houver.
   */
  function ponteECuraDe(historico, data) {
    const dia = historico.dias[data];
    if (!dia) return { ponte: null, cura: null };
    if (dia.legado) {
      return { ponte: dia.agregadoLegado?.ponte ?? null, cura: dia.agregadoLegado?.cura ?? null, legado: true };
    }
    const comparacao = dataDeComparacao(historico, data, dia);
    if (!comparacao || diasEntre(comparacao, data) < CONFIG_CARTEIRA.DIAS_COMPARACAO) return { ponte: null, cura: null };
    return {
      ponte: calcularPonte(historico, comparacao, data),
      cura: resumoDaCura(calcularCura(historico, comparacao, data)),
    };
  }

  /** Cura semana a semana: a última fotografia de cada semana com cura. */
  function curaSemanal(historico, limite = CONFIG_CARTEIRA.SEMANAS_CURA) {
    const u = util();
    const porSemana = new Map();
    datasDo(historico).forEach((data) => {
      const { cura } = ponteECuraDe(historico, data);
      if (!cura) return;
      const semana = u?.semanaSabadoASexta?.(dataDeIso(data))?.inicioIso ?? data;
      porSemana.set(semana, { semana, dia: data, ...cura });
    });
    return [...porSemana.values()].sort((a, b) => (a.semana < b.semana ? 1 : -1)).slice(0, limite);
  }

  /**
   * Dias úteis (seg–sex) sem fotografia nos últimos DIAS_LACUNAS dias, a
   * partir da primeira fotografia (antes dela não é lacuna, é "ainda não
   * existia"). Hoje só conta se já passou do meio-dia -- de manhã a lista
   * pode simplesmente ainda não ter sido aberta.
   */
  function lacunas(datas, agora) {
    if (datas.length === 0) return [];
    const hojeIso = isoDe(agora);
    const tem = new Set(datas);
    const primeira = [...datas].sort()[0];
    const faltam = [];
    for (let i = CONFIG_CARTEIRA.DIAS_LACUNAS; i >= 0; i -= 1) {
      const d = somarDias(hojeIso, -i);
      if (d < primeira || tem.has(d)) continue;
      const semana = dataDeIso(d).getDay();
      if (semana === 0 || semana === 6) continue;
      if (d === hojeIso && agora.getHours() < 12) continue;
      faltam.push(d);
    }
    return faltam;
  }

  /**
   * O backup está em dia? Referência: o último backup baixado; sem nenhum,
   * a primeira fotografia (antes de existir histórico não há o que perder).
   *
   * @param {object} status lerStatus()
   * @param {string|null} primeiraData Primeira fotografia (AAAA-MM-DD).
   * @param {Date} agora
   * @returns {{atrasado: boolean, dias: number|null, ultimo: string|null}}
   */
  function situacaoBackup(status, primeiraData, agora) {
    const ultimo = ehDataIso(status?.ultimoBackup?.data) ? status.ultimoBackup.data : null;
    const referencia = ultimo ?? primeiraData;
    if (!referencia) return { atrasado: false, dias: null, ultimo };
    const dias = diasEntre(referencia, isoDe(agora));
    return { atrasado: dias !== null && dias >= CONFIG_CARTEIRA.DIAS_LEMBRETE_BACKUP, dias, ultimo };
  }

  function textoLembreteBackup(s) {
    return s.ultimo
      ? `Carteira: o último backup do histórico foi há ${s.dias} dias. Abra o Alt+M e clique em "Baixar backup".`
      : `Carteira: o histórico (${s.dias} dias) ainda não tem nenhum backup. Abra o Alt+M e clique em "Baixar backup".`;
  }

  /* ---------------------------------------------------------------------
   * RÉGUA x RESULTADO (diário do Módulo 8 x fotografias)
   * --------------------------------------------------------------------- */

  function faixaDeHorario(minutos) {
    const i = CONFIG_CARTEIRA.FAIXAS_HORARIO.findIndex((f) => minutos < f.ate);
    return i >= 0 ? i : CONFIG_CARTEIRA.FAIXAS_HORARIO.length - 1;
  }

  /**
   * Para cada cliente na fila do Alt+U num dia D (régua atual), se QUITOU
   * em até JANELA_RESULTADO_DIAS pelas fotografias (formato 3). Janela
   * ainda aberta fica fora da taxa; sem fotografia de base no escopo, é
   * ignorado. Por faixa (contatado x não) e por hora do primeiro contato.
   */
  function analisarRegua(historico, eventos, versaoRegua) {
    const datas = datasDo(historico).filter((d) => historico.dias[d].formato === 3);
    const ultima = datas[datas.length - 1] ?? null;
    const mapas = new Map(datas.map((d) => [d, mapaDoDia(historico.dias[d])]));

    const contatos = new Map();
    eventos.filter((e) => e?.t === 'contato' && e.c).forEach((e) => {
      const chave = `${hashCnpj(e.c)}|${e.d}`;
      const hora = typeof e.h === 'number' ? e.h : 0;
      const atual = contatos.get(chave);
      if (atual === undefined || hora < atual) contatos.set(chave, hora);
    });

    const atribuicoes = new Map();
    eventos.filter((e) => e?.t === 'fila' && e.c && (versaoRegua == null || e.r === versaoRegua)).forEach((e) => {
      const chave = `${hashCnpj(e.c)}|${e.d}`;
      if (!atribuicoes.has(chave)) atribuicoes.set(chave, e);
    });

    const faixasMap = new Map();
    const horarios = CONFIG_CARTEIRA.FAIXAS_HORARIO.map((f) => ({ rotulo: f.rotulo, contatos: 0, base: 0, pagou: 0 }));
    const novaFaixa = (f) => ({ faixa: f, naFila: 0, contatados: 0, baseContatados: 0, pagouContatados: 0, baseNao: 0, pagouNao: 0 });
    let semBase = 0;
    let abertos = 0;

    atribuicoes.forEach((e, chave) => {
      const hash = Number(chave.split('|')[0]);
      const dia = isoDoDiario(e.d);
      if (!dia) return;
      const linhaFaixa = faixasMap.get(e.f) ?? novaFaixa(e.f);
      faixasMap.set(e.f, linhaFaixa);
      linhaFaixa.naFila += 1;
      const hora = contatos.get(chave);
      const contatado = hora !== undefined;
      if (contatado) linhaFaixa.contatados += 1;

      const baseDia = datas.filter((d) => d <= dia && diasEntre(d, dia) <= 3).pop();
      if (!baseDia || estadoDe(mapas.get(baseDia).get(hash)) !== 'escopo') {
        semBase += 1;
        return;
      }
      const fim = somarDias(dia, CONFIG_CARTEIRA.JANELA_RESULTADO_DIAS);
      const pagou = datas.some((d) => d > dia && d <= fim && quitou(estadoDe(mapas.get(d).get(hash))));
      if (!pagou && (ultima === null || ultima < fim)) {
        abertos += 1;
        return;
      }
      if (contatado) {
        linhaFaixa.baseContatados += 1;
        if (pagou) linhaFaixa.pagouContatados += 1;
        const hz = horarios[faixaDeHorario(hora)];
        hz.contatos += 1;
        hz.base += 1;
        if (pagou) hz.pagou += 1;
      } else {
        linhaFaixa.baseNao += 1;
        if (pagou) linhaFaixa.pagouNao += 1;
      }
    });

    return {
      faixas: [...faixasMap.values()].sort((a, b) => a.faixa - b.faixa),
      horarios,
      semBase,
      abertos,
      atribuicoes: atribuicoes.size,
    };
  }

  function eventosDoDiario() {
    try {
      const d = window.__diario;
      if (!d || typeof d.eventos !== 'function') return [];
      return d.eventos({ ultimosDias: CONFIG_CARTEIRA.DIAS_DIARIO }) ?? [];
    } catch (erro) {
      console.warn('[Carteira] Não consegui ler o diário.', erro?.message);
      return [];
    }
  }

  /* ---------------------------------------------------------------------
   * RESULTADO DO PERÍODO (API do Alt+D) E PREVISÃO
   * --------------------------------------------------------------------- */

  function linhaDe(dados, secao, nomes) {
    const u = util();
    const lista = dados?.[secao]?.porUsuario;
    if (!Array.isArray(lista)) return [];
    return lista.filter((item) => nomes.includes(u?.primeiroNomeDeUsuario?.(item?.usuario) ?? ''));
  }

  function somaCampo(linhas, campo) {
    return linhas.reduce((s, l) => s + numero(l?.[campo]), 0);
  }

  /**
   * Resultado de um período para as PESSOAS. Cumprimento por VALOR, só
   * entre as decididas: cumprido / (cumprido + quebrado).
   *
   * RECUPERADO: as promessas cumpridas vêm de `pagas` -- a MESMA apuração do
   * Alt+D (Módulo 10), pelo dia estimado do pagamento. O `cumprido` do
   * consolidado agrupa pela data da promessa (outro número, mesmo rótulo) e
   * fica só na taxa de cumprimento, que é por promessa.
   * @param {object} dados O `data` do consolidado.
   * @param {{valor: number, quantidade: number, semValor: number}|{erro: string}} [pagas]
   *   Sem `pagas` (ou com erro), o recuperado fica null (indisponível), nunca parcial.
   */
  function resumirPeriodo(dados, pagas) {
    const nomes = CONFIG_CARTEIRA.PESSOAS;
    const dep = linhaDe(dados, 'depositos', nomes);
    const prom = linhaDe(dados, 'promessas', nomes);
    const aco = linhaDe(dados, 'acordos', nomes);
    const con = linhaDe(dados, 'contatos', nomes);
    const cumprido = somaCampo(prom, 'cumprido');
    const quebrado = somaCampo(prom, 'quebrado');
    const decididas = cumprido + quebrado;
    const depositos = somaCampo(dep, 'valor');
    const pagasValidas = pagas && typeof pagas.valor === 'number' && Number.isFinite(pagas.valor) ? pagas : null;
    return {
      depositos,
      recuperado: pagasValidas ? depositos + pagasValidas.valor : null,
      cumpridasPeloPagamento: pagasValidas ?? { erro: pagas?.erro ?? 'não lida' },
      promessas: {
        quantidade: somaCampo(prom, 'quantidade'),
        prometido: somaCampo(prom, 'prometido'),
        cumprido,
        quebrado,
        emAberto: somaCampo(prom, 'emAberto'),
        cumprimento: decididas > 0 ? cumprido / decididas : null,
      },
      acordos: {
        quantidade: somaCampo(aco, 'quantidade'),
        valor: somaCampo(aco, 'valor'),
        pagos: somaCampo(aco, 'pagos'),
        pendente: somaCampo(aco, 'pendente'),
      },
      contatos: {
        unicos: somaCampo(con, 'contatosUnicos'),
        registros: somaCampo(con, 'registrosTotais'),
      },
    };
  }

  function periodos(hoje) {
    const u = util();
    const base = hoje ?? new Date();
    const hojeIso = isoDe(base);
    const semana = u?.semanaSabadoASexta?.(base);
    return [
      { chave: 'semana', rotulo: 'Semana', inicioIso: semana?.inicioIso ?? hojeIso, fimIso: semana?.fimIso ?? hojeIso },
      { chave: 'mes', rotulo: 'Mês', inicioIso: `${hojeIso.slice(0, 8)}01`, fimIso: hojeIso },
      {
        chave: 'taxa',
        rotulo: `Últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias`,
        inicioIso: somarDias(hojeIso, -(CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO - 1)),
        fimIso: hojeIso,
      },
    ];
  }

  /**
   * Promessas cumpridas no período pelo critério do Alt+D (dia estimado do
   * pagamento), só das PESSOAS. Nunca lança: erro vira `{erro}` e o painel
   * mostra "indisponível" no lugar do número.
   */
  async function cumpridasPeloPagamento(periodo) {
    const buscarPromessas = window.__recebidoSemana?.buscarPromessasDaSemana;
    if (typeof buscarPromessas !== 'function') return { erro: 'o Alt+D desta versão não lê promessas (atualize o SmartTable)' };
    try {
      const r = await buscarPromessas({ inicio: dataDeIso(periodo.inicioIso), inicioIso: periodo.inicioIso, fimIso: periodo.fimIso });
      const minhas = (r?.porPessoa ?? []).filter((p) => CONFIG_CARTEIRA.PESSOAS.includes(p.nome));
      return {
        valor: minhas.reduce((s, p) => s + numero(p.valor), 0),
        quantidade: minhas.reduce((s, p) => s + numero(p.quantidade), 0),
        semValor: numero(r?.semValor),
      };
    } catch (erro) {
      console.warn('[Carteira] Falha ao ler as promessas cumpridas do período:', erro?.message);
      return { erro: erro?.message ?? String(erro) };
    }
  }

  async function buscarResultado(hoje) {
    const buscar = window.__recebidoSemana?.buscarConsolidado;
    if (typeof buscar !== 'function') throw new Error('O Módulo 10 (Alt+D) não carregou -- sem acesso à API de resultado.');
    const lista = periodos(hoje);
    const [respostas, pagas] = await Promise.all([
      Promise.all(lista.map((p) => buscar(p.inicioIso, p.fimIso))),
      // A janela de 90 dias só serve para a taxa de cumprimento: não busca.
      Promise.all(lista.map((p) => (p.chave === 'taxa' ? null : cumpridasPeloPagamento(p)))),
    ]);
    return lista.map((p, i) => ({ ...p, resumo: resumirPeriodo(respostas[i], pagas[i] ?? undefined) }));
  }

  /** Promessas com data em até N dias × taxa real de cumprimento (90 dias). */
  function preverEntrada(agregado, taxa) {
    const proximos = agregado?.promessasPendentes?.proximos ?? {};
    return CONFIG_CARTEIRA.DIAS_PREVISAO.map((n) => {
      const bruto = proximos[n] ?? { clientes: 0, valor: 0 };
      return { dias: n, clientes: bruto.clientes, prometido: bruto.valor, esperado: taxa === null ? null : bruto.valor * taxa };
    });
  }

  /* ---------------------------------------------------------------------
   * EXPORTAÇÃO (CSV) E BACKUP
   * --------------------------------------------------------------------- */

  /**
   * Série diária (agregado + cura + ponte), CALCULADA AGORA a partir do
   * bruto de cada dia. Separador ';' e vírgula decimal. Só números.
   */
  function montarCsv(historico) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '');
    const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? num(v * 100) : '');
    const inteiro = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
    const razao = (a, b) => (b > 0 ? a / b : null);
    const colunas = [
      ['data', (a) => a.data],
      ['formato', (a, x) => (x.legado ? 'legado' : 'bruto')],
      ['clientes', (a) => inteiro(a.clientes)],
      ['divida_total_devedores', (a) => num(a.carteira)],
      ['vencido', (a) => num(a.vencido)],
      ['a_vencer', (a) => num(a.aVencer)],
      ['pct_em_cobranca', (a) => pct(a.pctVencido)],
      ['clientes_com_vencido', (a) => inteiro(a.clientesComVencido)],
      ['titulos_vencidos', (a) => inteiro(a.titulosVencidos)],
      ['scpc_clientes', (a) => inteiro(a.scpc?.clientes)],
      ['scpc_valor', (a) => num(a.scpc?.valor)],
      ['suspensos_clientes', (a) => inteiro(a.suspensos?.clientes)],
      ['suspensos_valor', (a) => num(a.suspensos?.valor)],
      ['promessas_pendentes', (a) => inteiro(a.promessasPendentes?.clientes)],
      ['promessas_pendentes_valor', (a) => num(a.promessasPendentes?.valor)],
      ...CONFIG_CARTEIRA.DIAS_PREVISAO.map((n) => [`promessas_proximos_${n}d_valor`, (a) => num(a.promessasPendentes?.proximos?.[n]?.valor)]),
      ['promessas_data_passada_valor', (a) => num(a.promessasPendentes?.valorVencidas)],
      ['acordos_inadimplentes', (a) => inteiro(a.acordosInadimplentes?.clientes)],
      ['acordos_inadimplentes_valor', (a) => num(a.acordosInadimplentes?.valor)],
      ['cobertura_7d_pct', (a) => pct(a.cobertura?.pct)],
      ['sem_movimentacao_30d', (a) => inteiro(a.semMovimentacao)],
      ['concentracao_top10_pct', (a) => pct(a.concentracaoTop)],
      ['fora_ate_1o_dia_clientes', (a) => inteiro(a.fora?.primeiroDia?.clientes)],
      ['fora_ate_1o_dia_valor', (a) => num(a.fora?.primeiroDia?.valor)],
      ['fora_analista_clientes', (a) => inteiro(a.fora?.analista?.clientes)],
      ['fora_analista_valor', (a) => num(a.fora?.analista?.valor)],
      ...CONFIG_CARTEIRA.FAIXAS_AGING.flatMap((f, i) => {
        const nome = f.min === f.max ? String(f.min) : `${f.min}_${f.max}`;
        return [
          [`aging_${nome}_clientes`, (a) => inteiro(a.faixas?.[i]?.clientes)],
          [`aging_${nome}_valor`, (a) => num(a.faixas?.[i]?.valor)],
        ];
      }),
      ['cura_desde', (a, x) => x.cura?.de ?? ''],
      ['cura_janela_dias', (a, x) => inteiro(x.cura?.janela)],
      ['cura_clientes', (a, x) => inteiro(x.cura?.clientes)],
      ['cura_pagaram', (a, x) => inteiro(x.cura?.pagaram)],
      ['cura_seguem', (a, x) => inteiro(x.cura?.seguem)],
      ['cura_analista', (a, x) => inteiro(x.cura?.analista)],
      ['cura_pct_pagaram', (a, x) => pct(razao(x.cura?.pagaram, x.cura?.clientes))],
      ['cura_pct_analista', (a, x) => pct(razao(x.cura?.analista, x.cura?.clientes))],
      ['cura_valor_curado', (a, x) => num(x.cura?.valorCurado)],
      ['cura_valor_analista', (a, x) => num(x.cura?.valorAnalista)],
      ...['inicial', 'entraram', 'aumentaram', 'reduziram', 'pagaram', 'analista', 'final']
        .map((k) => [`ponte_${k}_valor`, (a, x) => num(x.ponte?.[k]?.valor)]),
      ['alertas_dados', (a, x) => inteiro(x.alertas)],
    ];
    const linhas = [colunas.map(([nome]) => nome).join(';')];
    datasDo(historico).forEach((data) => {
      const dia = historico.dias[data];
      const a = agregadoDe(dia);
      if (!a) return;
      const { ponte, cura } = ponteECuraDe(historico, data);
      const extra = { legado: dia.legado, ponte, cura, alertas: dia.alertas.length };
      linhas.push(colunas.map(([, f]) => f(a, extra)).join(';'));
    });
    return linhas.join('\r\n');
  }

  function baixar(nome, conteudo, tipo) {
    const blob = new window.Blob([conteudo], { type: tipo });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(url);
      } catch {
        // liberar o link é faxina: se falhar, o arquivo já foi entregue
      }
    }, 1000);
  }

  async function exportarCsv() {
    const historico = await lerHistorico({ tudo: true });
    baixar(`carteira-${isoDe(new Date())}.csv`, '﻿' + montarCsv(historico), 'text/csv;charset=utf-8');
  }

  /** Backup completo: os registros EXATAMENTE como estão gravados. */
  async function montarBackup() {
    const registros = await lerRegistros(null);
    return JSON.stringify({
      tipo: 'smarttable-carteira-backup',
      versao: 1,
      geradoEm: new Date().toISOString(),
      registros: registros.sort((a, b) => (a.data < b.data ? -1 : 1)),
    });
  }

  async function exportarBackup() {
    const agora = new Date();
    baixar(`carteira-backup-${isoDe(agora)}.json`, await montarBackup(), 'application/json');
    // Registrado DEPOIS de o arquivo ser entregue ao navegador: se montar o
    // backup falhar, o lembrete continua valendo.
    gravarStatus({ ultimoBackup: { quando: agora.toISOString(), data: isoDe(agora) } });
  }

  /** O registro de um backup tem forma aceitável? */
  function registroValido(r) {
    if (!r || typeof r !== 'object' || !ehDataIso(r.data)) return false;
    if (r.formato === 3) {
      return Array.isArray(r.campos) && r.campos.every((c) => typeof c === 'string')
        && Array.isArray(r.linhas) && r.linhas.every((l) => Array.isArray(l) && l.length === r.campos.length + 3);
    }
    return Boolean(r.agregado && typeof r.agregado === 'object');
  }

  /**
   * Restaura um backup SEM apagar nada: dia que não existe entra; dia que
   * existe só é trocado se o do backup for estritamente mais completo
   * (bruto contra legado, ou mais clientes no mesmo formato).
   *
   * @param {string} texto Conteúdo do arquivo.
   * @returns {Promise<{importados: number, mantidos: number, invalidos: number}>}
   * @throws {Error} Se o arquivo não é um backup da Carteira.
   */
  async function importarBackup(texto) {
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error('O arquivo não é JSON.');
    }
    if (dados?.tipo !== 'smarttable-carteira-backup' || !Array.isArray(dados.registros)) {
      throw new Error('O arquivo não é um backup da Carteira.');
    }
    const resultado = { importados: 0, mantidos: 0, invalidos: 0 };
    for (const r of dados.registros) {
      if (!registroValido(r)) {
        resultado.invalidos += 1;
        continue;
      }
      const existente = decodificar(await lerDia(r.data));
      const novo = decodificar(r);
      const melhor = !existente
        || (existente.legado && !novo.legado)
        || (existente.legado === novo.legado && novo.totalLista > existente.totalLista);
      if (melhor) {
        await gravarDia(r);
        resultado.importados += 1;
      } else {
        resultado.mantidos += 1;
      }
    }
    return resultado;
  }

  window.__carteiraHistorico = Object.freeze({
    capturarFotografia,
    datasDo,
    dataDeComparacao,
    calcularCura,
    calcularPonte,
    ponteECuraDe,
    curaSemanal,
    lacunas,
    situacaoBackup,
    analisarRegua,
    eventosDoDiario,
    resumirPeriodo,
    periodos,
    buscarResultado,
    preverEntrada,
    montarCsv,
    exportarCsv,
    montarBackup,
    exportarBackup,
    importarBackup,
  });
})();
