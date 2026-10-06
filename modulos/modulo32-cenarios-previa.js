/* =========================================================================
 * MÓDULO 32: CENÁRIOS DA PRÉVIA DA MENSAGEM DO ALT+A — CRM TexCotton
 * -------------------------------------------------------------------------
 * R2, etapa 3 do catálogo de mensagens (projeto de 05/10/2026). A prévia do editor (Módulo 31) mostra a mensagem COMPLETA que o cliente
 * receberia, com o rascunho aplicado, em situações FICTÍCIAS. Este módulo guarda essas situações (só dados inventados: nenhum cliente real) e
 * as monta pelo código REAL do Alt+A (Módulo 19), dentro do ambiente injetável dele (`comAmbiente`) e do modo prévia do catálogo
 * (`comRascunho`, Módulo 30): nada da página é lido e nada é gravado.
 *
 * Biblioteca: os 12 cenários aprovados pelo usuário (atraso comum, último dia SCPC e cartório, em cartório, negativado 16 a 18 dias e 19º dia,
 * promessa do dia, promessa quebrada, pagamento parcial, acordo em dia e atrasado, primeiro contato) + os cenários-limite (o PIOR CASO
 * MEDIDO com o nome mais longo possível, sem e com acordo: varridas 103.680 combinações de títulos e contexto com os textos de hoje) + cenários de APOIO, que existem para que TODO texto do catálogo apareça em pelo menos um cenário (recontato,
 * agradecimento, apresentação, ressalva de fim de semana, outras razões do grupo, acordo com outros títulos, saudação por hora e com nome...).
 * A prévia só MOSTRA os cenários que o rascunho muda ("afetados"), então os de apoio não poluem a tela.
 *
 * Limites combinados com o usuário (v1.37.0, tests/tamanho-mensagem.test.js): no máximo 5 balões (a imagem do relatório e a legenda contam
 * como UM), nenhum balão de texto com mais de 320 caracteres e no máximo 600 de texto na mensagem inteira. COM acordo o total pode ir até 750
 * (teto definido pelo usuário em 06/10/2026): de 601 a 750 é só AVISO e acima de 750 é erro; os outros limites são erro em qualquer cenário.
 * O pior caso medido hoje: 591 caracteres sem acordo (cabe) e 736 com acordo (aviso de total; 5 balões e o maior balão com 261 caracteres).
 *
 * Depende de: Módulo 19 (montagem, `comAmbiente`) e Módulo 30 (`comRascunho`). Carrega depois do 19 e antes do Módulo 31.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__cenariosPreviaCarregado) return;
  if (!window.__mensagensCobranca?.comAmbiente || !window.__catalogoMensagens?.comRascunho) {
    console.error('[Prévia] Os Módulos 19 e 30 (com o ambiente da montagem e o modo prévia) não carregaram antes do Módulo 32: a prévia da mensagem não funciona. Atualize o script no Tampermonkey.');
    return;
  }
  window.__cenariosPreviaCarregado = true;

  const LIMITES = Object.freeze({ BALOES: 5, CARACTERES_POR_BALAO: 320, CARACTERES_TOTAL: 600, CARACTERES_TOTAL_COM_ACORDO: 750 });
  const NOME_MAIS_LONGO = 'Maximilianaalexandra';
  const CNPJ_FICTICIO = 'A00';
  // "Hoje" dos cenários: terça-feira, 15/09/2026 (o dia útil anterior é a segunda, 14/09). HOJE_SEGUNDA: segunda-feira 14/09 (a sexta 11/09 é o dia útil anterior,
  // e há "fim de semana" antes de hoje).
  const HOJE = Object.freeze([2026, 8, 15]);
  const HOJE_SEGUNDA = Object.freeze([2026, 8, 14]);
  const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const RAZAO = 'CLIENTE EXEMPLO LTDA';
  const PARCELA = Object.freeze({ numero: 12, valor: 4321.5, dataVencimento: '2026-09-30' });
  const PARCELA_ATRASADA = Object.freeze({ numero: 12, valor: 4321.5, dataVencimento: '2026-09-10' });

  const dois = (n) => String(n).padStart(2, '0');
  const ddmmaaaa = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
  const meioDia = (y, m, d) => new Date(y, m, d, 12, 0, 0);
  const diasAntes = (hoje, dias) => meioDia(hoje[0], hoje[1], hoje[2] - dias);

  /* ---------------------------------------------------------------------
   * Os cenários (dados puros). Campos:
   *   id, rotulo, grupo (agrupador na tela), titulos: [[situacaoKey, diasDeAtraso], ...], fluxo ('CARTORIO' | 'SCPC'),
   *   contato ('ontem' | 'sexta' | 'recontato'), promessa { tipo, titulos, pendentes }, pago (0 a 3), primeiro, antigo, nunca, periodo,
   *   outrasRazoes (grupo com outra razão vencida), acordo ('emDia' | 'atrasada' | 'quebrado' | 'emDiaEQuebrado'), soAcordo,
   *   responsavel (nome cru), hora (0 a 23), numerosDiferentes, novoTitulo, hoje.
   * --------------------------------------------------------------------- */
  const SITUACAO = 'Situação do título';
  const CONTEXTO = 'Contexto da conversa';
  const PROMESSAS = 'Promessa';
  const ACORDOS = 'Acordo';
  const SAUDACAO = 'Saudação';
  const LIMITE = 'Limite de tamanho';

  const PIOR_CASO_TITULOS = [['EM_ATRASO', 3], ['EM_CARTORIO', 40], ['NEGATIVADO_SCPC', 19]];

  const CENARIOS_BRUTOS = [
    // ---- os 12 aprovados ----
    { id: 'atraso-comum', rotulo: 'Atraso comum (3 dias)', grupo: SITUACAO, titulos: [['EM_ATRASO', 3]] },
    { id: 'ultimo-dia-scpc', rotulo: 'Último dia, fluxo SCPC', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6]], fluxo: 'SCPC' },
    { id: 'ultimo-dia-cartorio', rotulo: 'Último dia, fluxo cartório', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6]] },
    { id: 'em-cartorio', rotulo: 'Título em cartório', grupo: SITUACAO, titulos: [['EM_CARTORIO', 30]] },
    { id: 'scpc-17', rotulo: 'Negativado no SCPC (17 dias)', grupo: SITUACAO, titulos: [['NEGATIVADO_SCPC', 17]], fluxo: 'SCPC' },
    { id: 'scpc-19', rotulo: 'Negativado no SCPC (19º dia)', grupo: SITUACAO, titulos: [['NEGATIVADO_SCPC', 19]], fluxo: 'SCPC' },
    { id: 'promessa-do-dia', rotulo: 'Promessa para hoje', grupo: PROMESSAS, titulos: [['EM_ATRASO', 3]], promessa: { tipo: 'DIA_DA_PROMESSA', titulos: 1 } },
    { id: 'promessa-quebrada', rotulo: 'Promessa não identificada', grupo: PROMESSAS, titulos: [['EM_ATRASO', 5]], promessa: { tipo: 'QUEBRADA', titulos: 1 } },
    { id: 'pagamento-parcial', rotulo: 'Pagamento parcial (restam 2 títulos)', grupo: PROMESSAS, titulos: [['EM_ATRASO', 5], ['EM_ATRASO', 4]], promessa: { tipo: 'PARCIAL', titulos: 2, pendentes: 2 } },
    { id: 'acordo-em-dia', rotulo: 'Acordo em dia (só acordo)', grupo: ACORDOS, soAcordo: true, acordo: 'emDia' },
    { id: 'acordo-atrasado', rotulo: 'Acordo com parcela atrasada (só acordo)', grupo: ACORDOS, soAcordo: true, acordo: 'atrasada' },
    { id: 'primeiro-contato', rotulo: 'Primeiro contato (sem contato registrado)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], primeiro: true },
    // ---- os cenários-limite: o nome mais longo possível e vários títulos, com o pior contexto que a medição achou (sem e com acordo) ----
    { id: 'limite-sem-acordo', rotulo: 'Limite: o pior caso medido (nome mais longo, 3 situações de título, promessa parcial, contato antigo e outras razões)', grupo: LIMITE, titulos: PIOR_CASO_TITULOS, fluxo: 'SCPC', responsavel: NOME_MAIS_LONGO, hora: 20, promessa: { tipo: 'PARCIAL', titulos: 2, pendentes: 2 }, antigo: true, outrasRazoes: true },
    { id: 'limite-com-acordo', rotulo: 'Limite com acordo: o pior caso, com acordo em dia e outro não cumprido', grupo: LIMITE, titulos: PIOR_CASO_TITULOS, fluxo: 'SCPC', responsavel: NOME_MAIS_LONGO, hora: 20, promessa: { tipo: 'PARCIAL', titulos: 2, pendentes: 2 }, antigo: true, outrasRazoes: true, acordo: 'emDiaEQuebrado' },
    // ---- apoio: situação do título ----
    { id: 'atraso-dois-titulos', rotulo: 'Atraso comum, 2 títulos', grupo: SITUACAO, titulos: [['EM_ATRASO', 4], ['EM_ATRASO', 2]] },
    { id: 'ultimo-dia-scpc-2-titulos', rotulo: 'Último dia SCPC, 2 títulos', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6], ['ULTIMO_DIA', 6]], fluxo: 'SCPC' },
    { id: 'ultimo-dia-cartorio-2-titulos', rotulo: 'Último dia cartório, 2 títulos', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6], ['ULTIMO_DIA', 6]] },
    { id: 'ultimo-dia-mais-cartorio', rotulo: 'Último dia + título em cartório (legenda vermelho e amarelo)', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6], ['EM_CARTORIO', 40]] },
    { id: 'ultimo-dia-mais-cartorios', rotulo: 'Último dia + 2 títulos em cartório', grupo: SITUACAO, titulos: [['ULTIMO_DIA', 6], ['EM_CARTORIO', 40], ['EM_CARTORIO', 35]] },
    { id: 'em-cartorio-2-titulos', rotulo: 'Em cartório, 2 títulos', grupo: SITUACAO, titulos: [['EM_CARTORIO', 30], ['EM_CARTORIO', 31]] },
    { id: 'sem-protesto', rotulo: 'Título "não protestar" vencido', grupo: SITUACAO, titulos: [['SEM_PROTESTO', 8]] },
    { id: 'sem-protesto-2-titulos', rotulo: 'Títulos "não protestar" vencidos (2)', grupo: SITUACAO, titulos: [['SEM_PROTESTO', 8], ['SEM_PROTESTO', 9]] },
    { id: 'scpc-3', rotulo: 'Negativado no SCPC (3 dias)', grupo: SITUACAO, titulos: [['NEGATIVADO_SCPC', 3]], fluxo: 'SCPC' },
    { id: 'scpc-19-mais-cartorio', rotulo: 'SCPC 19º dia + título em cartório (aviso curto)', grupo: SITUACAO, titulos: [['NEGATIVADO_SCPC', 19], ['EM_CARTORIO', 40]], fluxo: 'SCPC' },
    // ---- apoio: contexto da conversa ----
    { id: 'contato-ontem', rotulo: 'Retomada do contato de ontem (sem relatório)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'ontem' },
    { id: 'contato-sexta', rotulo: 'Retomada do contato de sexta-feira (sem relatório)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 4]], contato: 'sexta', hoje: HOJE_SEGUNDA },
    { id: 'recontato-ultimo-dia-scpc', rotulo: 'Recontato, último dia SCPC (sem relatório)', grupo: CONTEXTO, titulos: [['ULTIMO_DIA', 6]], fluxo: 'SCPC', contato: 'ontem' },
    { id: 'recontato-ultimo-dia-cartorio-2', rotulo: 'Recontato, último dia cartório, 2 títulos (sem relatório)', grupo: CONTEXTO, titulos: [['ULTIMO_DIA', 6], ['ULTIMO_DIA', 7]], contato: 'ontem' },
    { id: 'recontato-ultimo-dia-mais-cartorio', rotulo: 'Recontato, último dia + em cartório (sem relatório)', grupo: CONTEXTO, titulos: [['ULTIMO_DIA', 6], ['EM_CARTORIO', 40]], contato: 'ontem' },
    { id: 'recontato-ultimo-dia-mais-cartorios', rotulo: 'Recontato, último dia + 2 em cartório (sem relatório)', grupo: CONTEXTO, titulos: [['ULTIMO_DIA', 6], ['EM_CARTORIO', 40], ['EM_CARTORIO', 35]], contato: 'ontem' },
    { id: 'recontato-em-cartorio', rotulo: 'Recontato, título em cartório (sem relatório)', grupo: CONTEXTO, titulos: [['EM_CARTORIO', 30]], contato: 'ontem' },
    { id: 'recontato-sem-protesto', rotulo: 'Recontato, "não protestar" (sem relatório)', grupo: CONTEXTO, titulos: [['SEM_PROTESTO', 8]], contato: 'ontem' },
    { id: 'recontato-sem-protesto-2', rotulo: 'Recontato, 2 títulos "não protestar" (sem relatório)', grupo: CONTEXTO, titulos: [['SEM_PROTESTO', 8], ['SEM_PROTESTO', 9]], contato: 'ontem' },
    { id: 'recontato-titulo-novo', rotulo: 'Recontato com título novo vencido (o relatório volta)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'ontem', novoTitulo: true },
    { id: 'recontato-consecutivo', rotulo: 'Recontato seguido (o relatório volta)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'recontato' },
    { id: 'agradecimento-um-titulo', rotulo: 'Agradecimento por pagamento (1 título)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'ontem', pago: 1 },
    { id: 'agradecimento-dois-titulos', rotulo: 'Agradecimento por pagamento (2 títulos)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'ontem', pago: 2 },
    { id: 'agradecimento-sem-numero', rotulo: 'Agradecimento por pagamento (sem número de título)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], contato: 'ontem', pago: 3 },
    { id: 'apresentacao-contato-antigo', rotulo: 'Apresentação (contato antigo)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], antigo: true },
    { id: 'apresentacao-nunca-contatado', rotulo: 'Apresentação (nunca contatado por você)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], nunca: true },
    { id: 'ressalva-fim-de-semana', rotulo: 'Ressalva de pagamento no fim de semana (segunda-feira)', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], periodo: 'no fim de semana', hoje: HOJE_SEGUNDA },
    { id: 'outras-razoes-do-grupo', rotulo: 'Outras razões do grupo vencidas ("de cada razão social")', grupo: CONTEXTO, titulos: [['EM_ATRASO', 3]], outrasRazoes: true },
    // ---- apoio: promessa ----
    { id: 'promessa-do-dia-2-titulos', rotulo: 'Promessa para hoje, 2 títulos', grupo: PROMESSAS, titulos: [['EM_ATRASO', 3], ['EM_ATRASO', 4]], promessa: { tipo: 'DIA_DA_PROMESSA', titulos: 2 } },
    { id: 'promessa-quebrada-2-titulos', rotulo: 'Promessa não identificada, 2 títulos', grupo: PROMESSAS, titulos: [['EM_ATRASO', 5], ['EM_ATRASO', 4]], promessa: { tipo: 'QUEBRADA', titulos: 2 } },
    { id: 'pagamento-parcial-resta-um', rotulo: 'Pagamento parcial (resta 1 título)', grupo: PROMESSAS, titulos: [['EM_ATRASO', 5], ['EM_ATRASO', 4]], promessa: { tipo: 'PARCIAL', titulos: 2, pendentes: 1 } },
    { id: 'pagamento-parcial-regularizado', rotulo: 'Pagamento parcial (tudo regularizado)', grupo: PROMESSAS, titulos: [['EM_ATRASO', 5], ['EM_ATRASO', 4]], promessa: { tipo: 'PARCIAL', titulos: 2, pendentes: 0 } },
    // ---- apoio: acordo com outros títulos ----
    { id: 'acordo-e-atraso-em-dia', rotulo: 'Acordo em dia + atraso comum', grupo: ACORDOS, titulos: [['EM_ATRASO', 3]], acordo: 'emDia' },
    { id: 'acordo-e-atraso-atrasado', rotulo: 'Acordo atrasado + atraso comum', grupo: ACORDOS, titulos: [['EM_ATRASO', 3]], acordo: 'atrasada' },
    { id: 'acordo-quebrado-e-atraso', rotulo: 'Acordo não cumprido + atraso comum', grupo: ACORDOS, titulos: [['EM_ATRASO', 3]], acordo: 'quebrado' },
    // ---- apoio: saudação por hora e com nome ----
    { id: 'saudacao-manha-com-nome', rotulo: 'Saudação da manhã com o nome do responsável', grupo: SAUDACAO, titulos: [['EM_ATRASO', 3]], responsavel: 'Maria Silva' },
    { id: 'saudacao-tarde', rotulo: 'Saudação da tarde', grupo: SAUDACAO, titulos: [['EM_ATRASO', 3]], hora: 15 },
    { id: 'saudacao-tarde-com-nome', rotulo: 'Saudação da tarde com nome', grupo: SAUDACAO, titulos: [['EM_ATRASO', 3]], hora: 15, responsavel: 'Maria Silva' },
    { id: 'saudacao-noite', rotulo: 'Saudação da noite', grupo: SAUDACAO, titulos: [['EM_ATRASO', 3]], hora: 20 },
    { id: 'saudacao-noite-com-nome', rotulo: 'Saudação da noite com nome', grupo: SAUDACAO, titulos: [['EM_ATRASO', 3]], hora: 20, responsavel: 'Maria Silva' },
  ];

  /* ---------------------------------------------------------------------
   * Montagem das entradas de um cenário (dados da cobrança + ambiente do Módulo 19)
   * --------------------------------------------------------------------- */
  // Fábricas: um objeto NOVO a cada chamada (o Módulo 19 não pode alterar o resumo de um cenário e contaminar o seguinte).
  const ACORDOS_RESUMO = {
    emDia: () => ({ ativa: { acordo: { id: 1 }, parcela: { ...PARCELA }, atrasada: false }, inadimplente: null, erros: [] }),
    atrasada: () => ({ ativa: { acordo: { id: 1 }, parcela: { ...PARCELA_ATRASADA }, atrasada: true }, inadimplente: null, erros: [] }),
    quebrado: () => ({ ativa: null, inadimplente: { id: 2, dataCriacao: '2026-08-12' }, erros: [] }),
    emDiaEQuebrado: () => ({ ativa: { acordo: { id: 1 }, parcela: { ...PARCELA }, atrasada: false }, inadimplente: { id: 2, dataCriacao: '2026-08-12' }, erros: [] }),
  };

  function registro(hoje, [situacaoKey, dias], i) {
    const venc = diasAntes(hoje, dias);
    return {
      titulo: String(90001 + i), parcela: '1', tituloCompleto: `${90001 + i}/1`, razaoSocial: RAZAO, vencimentoTexto: ddmmaaaa(venc),
      saldoTexto: 'R$ 1.000,00', diasAtrasoReal: dias, diasInformados: dias, divergenciaDias: false, situacaoKey,
    };
  }

  function contatoRecente(tipo, hoje) {
    // O objeto que o Módulo 6 entregaria: a data do contato ao MEIO-DIA, o dia útil anterior a "hoje".
    // 'sexta' = o dia útil anterior de uma SEGUNDA-feira (3 dias antes de "hoje"); só faz sentido com `hoje: HOJE_SEGUNDA`.
    const dataDoContato = diasAntes(hoje, tipo === 'sexta' ? 3 : 1);
    return {
      data: dataDoContato, dataTexto: ddmmaaaa(dataDoContato), ehOntemLiteral: tipo !== 'sexta',
      diaSemanaTexto: DIAS_SEMANA[dataDoContato.getDay()], recontatoConsecutivo: tipo === 'recontato',
    };
  }

  function entradasDe(c) {
    const hoje = c.hoje ?? HOJE;
    const registros = (c.titulos ?? []).map((t, i) => registro(hoje, t, i));
    const fluxo = c.fluxo ?? 'CARTORIO';
    const dados = c.soAcordo
      ? { registros: [], emAcordo: [registro(hoje, ['EM_ATRASO', 3], 0)], naoCobrar: [], foraDoRelatorio: [], fluxo }
      : { registros, emAcordo: [], naoCobrar: [], foraDoRelatorio: [], fluxo };
    if (c.novoTitulo) dados.registros.push(registro(hoje, ['EM_ATRASO', 1], 8));
    const pagos = [[], ['60001/1'], ['60001/1', '60002/1'], []][c.pago ?? 0];
    const promessa = c.promessa
      ? {
        tipo: c.promessa.tipo,
        promessa: { titulos: dados.registros.slice(0, c.promessa.titulos).map((r) => r.tituloCompleto), dataPrometidaTexto: ddmmaaaa(diasAntes(hoje, 5)) },
      }
      : null;
    const pendentes = c.promessa?.pendentes ?? 2;
    const contexto = {
      promessa, contatoRecente: c.contato ? contatoRecente(c.contato, hoje) : null, houvePromessaNoUltimoContato: false,
      houveTituloPagoDesdeUltimaVisita: (c.pago ?? 0) > 0, titulosPagosDesdeUltimaVisita: pagos, semContatoAnterior: !!c.primeiro,
      contatoAntigo: !!c.antigo, nuncaContatadoPorMim: !!c.nunca, nomeNegociador: 'Isaac', periodoNaoUtilAntesDeHoje: c.periodo,
      calcularTitulosPendentes: (t) => t.slice(0, pendentes),
    };
    const resumoAcordo = c.acordo ? ACORDOS_RESUMO[c.acordo]() : null;
    const ambiente = {
      contexto,
      grupo: { empresasComVencido: c.outrasRazoes ? [{ cnpj: '2', razaoSocial: 'OUTRA EXEMPLO LTDA', vencido: 'R$ 1,00', url: 'u' }] : [] },
      negociacoes: resumoAcordo ? { resumoDeCobranca: () => resumoAcordo, dataCurta: (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}` } : null,
      numerosDiferentes: c.numerosDiferentes ? { numerosAtivos: () => ['numero-ficticio'] } : null,
      responsavelNome: c.responsavel ?? null,
      cnpj: CNPJ_FICTICIO,
      agora: new Date(hoje[0], hoje[1], hoje[2], c.hora ?? 10, 0, 0),
    };
    return { dados, ambiente, temAcordo: !!c.acordo };
  }

  /* ---------------------------------------------------------------------
   * Contagem de balões e limites
   * --------------------------------------------------------------------- */

  /**
   * Os balões de uma mensagem (as partes do Módulo 19): texto puro e a imagem do relatório COM a legenda que vem logo depois (um balão só).
   * @returns {{baloes: Array<{tipo: 'texto'|'imagem', texto: string}>, totais: {baloes: number, caracteres: number, maiorBalao: number}}}
   */
  function contarBaloes(partes) {
    const marcador = window.__mensagensCobranca.MARCADOR_IMAGEM_RELATORIO;
    const baloes = [];
    for (let i = 0; i < partes.length; i += 1) {
      if (partes[i] !== marcador) {
        baloes.push({ tipo: 'texto', texto: partes[i] });
        continue;
      }
      const temLegenda = i + 1 < partes.length && partes[i + 1] !== marcador;
      baloes.push({ tipo: 'imagem', texto: temLegenda ? partes[i + 1] : '' });
      if (temLegenda) i += 1; // a legenda é do MESMO balão da imagem
    }
    const textos = partes.filter((p) => p !== marcador);
    return {
      baloes,
      totais: { baloes: baloes.length, caracteres: textos.join('\n').length, maiorBalao: textos.reduce((m, t) => Math.max(m, t.length), 0) },
    };
  }

  /**
   * Os limites estourados: [{ codigo: 'baloes'|'balao'|'total', nivel: 'erro'|'aviso', valor, limite }]. O TOTAL sem acordo passa de 600 = erro; COM acordo,
   * de 601 a 750 = aviso (`limite` 600 e `teto` 750, com `comAcordo: true`) e acima de 750 = erro (`limite` 750, com `comAcordo: true`). Balões e
   * balão são erro sempre. (Só avisam: o erro de tamanho não bloqueia o Publicar.)
   */
  function avaliarLimites(totais, temAcordo) {
    const alertas = [];
    if (totais.baloes > LIMITES.BALOES) alertas.push({ codigo: 'baloes', nivel: 'erro', valor: totais.baloes, limite: LIMITES.BALOES });
    if (totais.maiorBalao > LIMITES.CARACTERES_POR_BALAO) alertas.push({ codigo: 'balao', nivel: 'erro', valor: totais.maiorBalao, limite: LIMITES.CARACTERES_POR_BALAO });
    const tetoDoTotal = temAcordo ? LIMITES.CARACTERES_TOTAL_COM_ACORDO : LIMITES.CARACTERES_TOTAL;
    if (totais.caracteres > tetoDoTotal) {
      alertas.push({ codigo: 'total', nivel: 'erro', valor: totais.caracteres, limite: tetoDoTotal, comAcordo: temAcordo });
    } else if (totais.caracteres > LIMITES.CARACTERES_TOTAL) {
      // (só chega aqui COM acordo: sem acordo o teto já é 600 e o ramo de cima pegou)
      alertas.push({ codigo: 'total', nivel: 'aviso', valor: totais.caracteres, limite: LIMITES.CARACTERES_TOTAL, teto: LIMITES.CARACTERES_TOTAL_COM_ACORDO, comAcordo: true });
    }
    return alertas;
  }

  /* ---------------------------------------------------------------------
   * Execução
   * --------------------------------------------------------------------- */
  const CENARIOS = Object.freeze(CENARIOS_BRUTOS.map((c) => Object.freeze({ id: c.id, rotulo: c.rotulo, grupo: c.grupo })));
  const PORID = new Map(CENARIOS_BRUTOS.map((c) => [c.id, c]));

  /**
   * Monta a mensagem de UM cenário pelo código do Alt+A (sem ler nada da página e sem gravar nada).
   * @param {string} id
   * @param {{textos?: Object, variantes?: Object}} [opcoes] `textos`: o rascunho ({ chave: { forma: [texto...] } }), que vale por cima do
   *   publicado e do padrão; sem ele, o que está EM USO. `variantes`: { chave: índice } força a variante do rodízio.
   * @returns {{partes: string[], baloes: Array, totais: Object, alertas: Array}|null} null = o Alt+A não gera mensagem nesse cenário
   */
  function rodarCenario(id, { textos = null, variantes } = {}) {
    if (!PORID.has(id)) return null;
    return window.__catalogoMensagens.comRascunho(textos, () => montar(PORID.get(id)), { variantes });
  }

  // A montagem de um cenário, SEM abrir o modo prévia do catálogo (quem chama já está dentro de um `comRascunho`).
  function montar(c) {
    const { dados, ambiente, temAcordo } = entradasDe(c);
    const partes = window.__mensagensCobranca.comAmbiente(ambiente, () => window.__mensagensCobranca.montarPartesMensagemPersonalizada(dados));
    if (!Array.isArray(partes)) return null;
    const { baloes, totais } = contarBaloes(partes);
    return { partes, baloes, totais, alertas: avaliarLimites(totais, temAcordo) };
  }

  const tentar = (fn) => {
    try {
      return { r: fn() };
    } catch (e) {
      return { erro: String(e?.message ?? e) };
    }
  };

  /**
   * Todos os cenários antes (o que está em uso) e depois (com o rascunho). `afetado` = a mensagem muda por causa do rascunho. O catálogo é
   * lido UMA vez para os "antes" e UMA vez para os "depois" (não uma por cenário). Sem rascunho (null ou {}) não há "depois" a calcular:
   * ele é igual ao "antes" (mesmo objeto). Um cenário que quebra não derruba a lista: vem com `erro` (texto) e `afetado: true`.
   * @returns {Array<{id: string, rotulo: string, grupo: string, antes: Object|null, depois: Object|null, afetado: boolean, erro: string|null}>}
   */
  function rodarTodos({ textos = null, variantes } = {}) {
    const { comRascunho } = window.__catalogoMensagens;
    const rodar = (t) => comRascunho(t, () => CENARIOS.map((c) => tentar(() => montar(PORID.get(c.id)))), { variantes });
    const vazio = !textos || Object.keys(textos).length === 0;
    const antes = rodar(null);
    const depois = vazio ? antes : rodar(textos);
    return CENARIOS.map((c, i) => {
      const a = antes[i];
      const d = depois[i];
      const erro = a.erro ?? d.erro ?? null;
      const afetado = erro !== null || JSON.stringify(a.r?.partes ?? null) !== JSON.stringify(d.r?.partes ?? null);
      return { id: c.id, rotulo: c.rotulo, grupo: c.grupo, antes: a.r ?? null, depois: d.r ?? null, afetado, erro };
    });
  }

  window.__smartTableUtil?.registrarModuloCarregado?.('Cenários da Prévia');

  window.__cenariosPrevia = Object.freeze({ CENARIOS, LIMITES, NOME_MAIS_LONGO, rodarCenario, rodarTodos, contarBaloes, avaliarLimites });
})();
