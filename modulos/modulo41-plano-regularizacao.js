/* =========================================================================
 * MÓDULO 41: PLANO DE REGULARIZAÇÃO (REGRAS) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (18/11/2026): um planejador que leia os títulos vencidos e a vencer de um
 * cliente (por GRUPO de empresas) e monte o cronograma de regularização a partir das regras da
 * TexCotton, não uma lista ordenada por vencimento.
 *
 * Este módulo é SÓ REGRAS: funções puras, sem tela, sem rede e sem tocar na página. A tela do plano
 * (painel) é uma etapa à parte e depende da aprovação do desenho pelo usuário (CLAUDE.md, regra 5).
 * A versão 1 só LÊ: nada é gravado no CRM.
 *
 * REGRAS (decisões do usuário, 18/11/2026; nada além delas foi inventado):
 *   - Cada cliente tem UMA modalidade: cartório ou negativação (SCPC). O código lê o `scpc` como o
 *     Módulo 1 ("s" = SCPC; qualquer outra coisa = cartório). Valor ausente vira o alerta
 *     MODALIDADE_INDETERMINADA (continua como o Módulo 1: cartório), em vez de calar.
 *   - Prazo do dia 6: vencimento + 6 dias corridos; se cair em dia não útil, vai para o próximo dia
 *     útil. Esse é o ÚLTIMO DIA para pagar direto à TexCotton antes do encaminhamento. Mesma conta do
 *     `calcularPrazos` do Módulo 1.
 *   - CARTÓRIO: depois do prazo, o título é encaminhado e, no cartório (posição CARTORIO no CRM, ou a
 *     intimação presumida quando o CRM ainda não marcou), só se paga pelo cartório (mais custas, valor
 *     DESCONHECIDO: o plano nunca inventa um número). Só com a posição PROTESTO o título está PROTESTADO:
 *     ainda em aberto, paga-se direto à TexCotton, SEM data-limite. O prazo da intimação não existe no
 *     CRM: o plano nunca inventa uma data para ele.
 *   - SCPC: o pagamento direto é sempre permitido. Último dia sem suspensão = vencimento + 20 dias
 *     corridos, prorrogado para o próximo dia útil se cair em dia não útil (o usuário: "pode deixar
 *     como 20º"). Depois disso o cadastro é suspenso e o caso é do analista: o título sai do escopo.
 *   - Encargos: multa de 2% uma única vez a partir do 1º dia de atraso + juros de 3% ao mês,
 *     proporcionais aos dias de atraso (3% ÷ 30 × dias, simples).
 *   - Pagamento por TÍTULO INTEIRO (sem pagamento parcial).
 *   - Pagamento feito no cartório pode demorar até uma semana para baixar no CRM: o plano só
 *     considera pago o que o CRM já não lista em aberto.
 *   - Títulos `NAO COBRAR` e `CARTEIRA` (e os em acordo ou fora do relatório, quando a fonte informa)
 *     ficam FORA do plano, com o motivo, como já acontece no Módulo 1.
 *
 * NÃO VERIFICADO (conferir com valores reais do CRM antes de usar em produção):
 *   - se `valorEmAberto` já traz juros e multa (aqui é tratado como valor de PRINCIPAL);
 *   - a fórmula dos encargos contra o valor que o CRM mostra na promessa (`valorPrometido`);
 *   - se o último dia sem suspensão do SCPC é mesmo o 20º (o Módulo 1 hoje usa 19 como teto).
 *
 * Entrada (mesmo formato do `simularTitulos` do Módulo 1): `{ titulos, scpc, tituloEmAcordo?,
 * tituloForaDoRelatorio? }`, com cada título `{ numeroTitulo, sequencia, dataVencimento (AAAA-MM-DD),
 * valorEmAberto (número), posicaoDescricao }`. Datas são sempre meio-dia local.
 * Privacidade: nada de nome, CNPJ ou valor vai para o console; o grupo é identificado por apelidos
 * que quem chama escolhe.
 *
 * Carga: depois do Módulo 1 (usa o calendário de feriados dele em tempo de chamada, sem editá-lo).
 * Expõe window.__planoRegularizacao.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__planoRegularizacaoCarregado) return;
  window.__planoRegularizacaoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Plano de Regularização');

  const PARAMETROS = Object.freeze({
    MULTA: 0.02,
    JUROS_MENSAL: 0.03,
    DIAS_DO_MES: 30,
    DIAS_PRAZO_DIRETO: 6,
    DIAS_ULTIMO_DIA_SCPC: 20,
  });

  const POSICOES_FORA = ['NAO COBRAR', 'CARTEIRA'];

  // ---------------------------------------------------------------- datas
  const MS_DIA = 86400000;

  /** AAAA-MM-DD -> Date ao meio-dia local, ou null. */
  function lerIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    // Rejeita 31/02 e afins (o Date rola para o mês seguinte em silêncio).
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }

  function paraIso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function meioDia(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }

  function somarDias(d, n) {
    const r = meioDia(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /** Dias inteiros de `de` até `ate` (positivo se `ate` é depois). Arredonda: imune a horário de verão. */
  function diasEntre(de, ate) {
    return Math.round((meioDia(ate).getTime() - meioDia(de).getTime()) / MS_DIA);
  }

  /**
   * Calendário de dias úteis: fim de semana + os feriados do Módulo 1 (`__avisoCobranca.feriados`).
   * Sem o Módulo 1, só o fim de semana conta, e o plano avisa (CALENDARIO_INCOMPLETO).
   */
  function criarCalendario() {
    const fonte = window.__avisoCobranca?.feriados;
    const completo = typeof fonte === 'function';
    const cache = new Map();
    const feriadosDe = (ano) => {
      if (!cache.has(ano)) cache.set(ano, new Set(completo ? fonte(ano) : []));
      return cache.get(ano);
    };
    const ehDiaUtil = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !feriadosDe(d.getFullYear()).has(paraIso(d));
    const primeiroUtilAPartirDe = (d) => {
      let r = meioDia(d);
      for (let guarda = 0; !ehDiaUtil(r); guarda += 1) {
        if (guarda > 30) throw new Error('Sem dia útil perto de ' + paraIso(d));
        r = somarDias(r, 1);
      }
      return r;
    };
    return { completo, ehDiaUtil, primeiroUtilAPartirDe, proximoUtil: (d) => primeiroUtilAPartirDe(somarDias(d, 1)) };
  }

  // ---------------------------------------------------------------- dinheiro (em centavos)
  const centavos = (reais) => Math.round(reais * 100);
  const reais = (c) => c / 100;

  /**
   * Multa (uma vez, do 1º dia de atraso) + juros pro rata (3% ao mês ÷ 30 × dias).
   * @param {number} principal Valor em reais.
   * @param {number} diasAtraso Dias corridos de atraso (≤ 0 = sem encargos).
   */
  function calcularEncargos(principal, diasAtraso) {
    if (typeof principal !== 'number' || !Number.isFinite(principal) || principal < 0) throw new Error('Valor principal inválido.');
    const p = centavos(principal);
    const dias = Math.max(0, Math.trunc(Number(diasAtraso) || 0));
    const multa = dias >= 1 ? Math.round(p * PARAMETROS.MULTA) : 0;
    const juros = Math.round((p * PARAMETROS.JUROS_MENSAL * dias) / PARAMETROS.DIAS_DO_MES);
    return { principal: reais(p), multa: reais(multa), juros: reais(juros), total: reais(p + multa + juros) };
  }

  /** Total devido em `data` por um título que venceu em `vencimento`. */
  function valorNaData(principal, vencimento, data) {
    return calcularEncargos(principal, diasEntre(vencimento, data)).total;
  }

  // ---------------------------------------------------------------- marcos
  /**
   * @param {Date} vencimento
   * @param {ReturnType<typeof criarCalendario>} cal
   */
  function marcosDoTitulo(vencimento, cal) {
    const limiteDireto = cal.primeiroUtilAPartirDe(somarDias(vencimento, PARAMETROS.DIAS_PRAZO_DIRETO));
    return {
      vencimento,
      limiteDireto,
      encaminhamento: cal.proximoUtil(limiteDireto),
      ultimoDiaSemSuspensao: cal.primeiroUtilAPartirDe(somarDias(vencimento, PARAMETROS.DIAS_ULTIMO_DIA_SCPC)),
    };
  }

  const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

  // ---------------------------------------------------------------- fase e canal
  const FASES = Object.freeze({
    A_VENCER: 'A_VENCER',
    PRAZO_DIRETO: 'PRAZO_DIRETO',
    EM_CARTORIO: 'EM_CARTORIO',
    INTIMACAO: 'INTIMACAO',
    PROTESTADO: 'PROTESTADO',
    SEM_PROTESTO: 'SEM_PROTESTO',
    NEGATIVADO: 'NEGATIVADO',
    SUSPENSO: 'SUSPENSO',
  });

  function faseDoTitulo({ fluxo, posicao, hoje, marcos }) {
    if (diasEntre(marcos.vencimento, hoje) < 1) return FASES.A_VENCER;
    if (hoje <= marcos.limiteDireto) return FASES.PRAZO_DIRETO;
    if (fluxo === 'SCPC') return hoje > marcos.ultimoDiaSemSuspensao ? FASES.SUSPENSO : FASES.NEGATIVADO;
    if (posicao.includes('NAO PROTESTAR')) return FASES.SEM_PROTESTO;
    // Posição PROTESTO = PROTESTADO (decisão do usuário, 18/11/2026; valor confirmado por diagnóstico censurado). Palavra inteira: "NAO PROTESTAR"
    // já saiu acima. Vem ANTES do cartório: o protesto é o estado seguinte.
    if (/(^|[^A-Z])PROTESTO([^A-Z]|$)/.test(posicao)) return FASES.PROTESTADO;
    // Posição CARTORIO = EM CARTORIO, NÃO protestado (correção do usuário, 23/11/2026: "títulos com a posição cartório estão em cartório; só com a
    // posição protesto ele está protestado"). Antes caía em PROTESTADO, o que mostrava "pagar direto, sem prazo" para título que está no cartório.
    if (posicao.includes('CARTORIO')) return FASES.EM_CARTORIO;
    // Passou do prazo do dia 6 e o CRM ainda não marcou cartório nem protesto: o plano ASSUME a intimação (sem confirmação do CRM).
    return FASES.INTIMACAO;
  }

  /** Por onde o título pode ser pago HOJE. */
  function canalDaFase(fase) {
    if (fase === FASES.INTIMACAO || fase === FASES.EM_CARTORIO) return 'CARTORIO';
    if (fase === FASES.SUSPENSO) return 'ANALISTA';
    return 'DIRETO';
  }

  // ---------------------------------------------------------------- ordem do cronograma
  // A MESMA ordem no cronograma de uma empresa e no mesclado do grupo: data, tipo do evento, maior valor, título.
  const ORDEM_TIPO = Object.freeze({ VENCIMENTO: 0, LIMITE_ANTES_DO_CARTORIO: 1, LIMITE_ANTES_DA_NEGATIVACAO: 1, ULTIMO_DIA_SEM_SUSPENSAO: 2 });
  const compararEventos = (a, b) => a.data.localeCompare(b.data) || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]
    || b.valorNaData - a.valorNaData || a.tituloId.localeCompare(b.tituloId);

  // ---------------------------------------------------------------- plano de um cliente (uma empresa)
  /**
   * @param {{titulos: object[], scpc?: string|null, tituloEmAcordo?: Function, tituloForaDoRelatorio?: Function}} fonte
   * @param {Date} hoje
   */
  function planejarEmpresa(fonte, hoje) {
    if (!fonte || !Array.isArray(fonte.titulos)) throw new Error('Lista de títulos inválida.');
    const dia = meioDia(hoje);
    const cal = criarCalendario();
    const scpcInformado = typeof fonte.scpc === 'string' && fonte.scpc.trim() !== '';
    const fluxo = scpcInformado && fonte.scpc.trim().toLowerCase() === 's' ? 'SCPC' : 'CARTORIO';

    const alertas = [];
    if (!cal.completo) alertas.push({ codigo: 'CALENDARIO_INCOMPLETO', texto: 'Feriados indisponíveis (Módulo 1 ausente): só fins de semana foram considerados.' });
    if (!scpcInformado) alertas.push({ codigo: 'MODALIDADE_INDETERMINADA', texto: 'Modalidade (cartório ou SCPC) não informada: tratada como cartório, como no Módulo 1.' });

    const titulos = [];
    const foraDoPlano = [];
    const ignorados = [];
    const cronograma = [];
    const semData = [];

    fonte.titulos.forEach((t, ordem) => {
      const vencimento = lerIso(t?.dataVencimento);
      const principal = t?.valorEmAberto;
      if (!vencimento) return ignorados.push({ ordem, motivo: 'vencimento ilegível' });
      if (typeof principal !== 'number' || !Number.isFinite(principal) || principal < 0) return ignorados.push({ ordem, motivo: 'valor ilegível' });

      // "numero/sequencia", o mesmo texto que o Módulo 1 passa aos predicados (registro.tituloCompleto): os reais
      // (Módulo 16 acordosDaPaginaBaixada, Módulo 12 predicadoForaDoRelatorio) leem TEXTO, não o objeto do título.
      const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
      const id = `${texto(t.numeroTitulo)}/${texto(t.sequencia)}`;
      const posicao = normalizar(t.posicaoDescricao);
      const motivoFora = POSICOES_FORA.find((p) => posicao.includes(p))
        || (typeof fonte.tituloEmAcordo === 'function' && fonte.tituloEmAcordo(id) ? 'ACORDO' : null)
        || (typeof fonte.tituloForaDoRelatorio === 'function' && fonte.tituloForaDoRelatorio(id) ? 'FORA_DO_RELATORIO' : null);
      if (motivoFora) return foraDoPlano.push({ id, motivo: motivoFora });

      const marcos = marcosDoTitulo(vencimento, cal);
      const atraso = diasEntre(vencimento, dia);
      const fase = faseDoTitulo({ fluxo, posicao, hoje: dia, marcos });
      const canal = canalDaFase(fase);
      const enc = calcularEncargos(principal, atraso);
      const custasAConfirmar = fase === FASES.INTIMACAO || fase === FASES.EM_CARTORIO || fase === FASES.PROTESTADO;
      const titulo = {
        id, fluxo, fase, canal, vencimento: paraIso(vencimento), diasAtraso: Math.max(0, atraso),
        principal: enc.principal, multa: enc.multa, juros: enc.juros, valorHoje: enc.total,
        custoPorDia: atraso >= 1 ? reais(Math.round((centavos(principal) * PARAMETROS.JUROS_MENSAL) / PARAMETROS.DIAS_DO_MES)) : 0,
        custasAConfirmar,
        marcos: {
          limiteDireto: paraIso(marcos.limiteDireto),
          encaminhamento: paraIso(marcos.encaminhamento),
          ultimoDiaSemSuspensao: fluxo === 'SCPC' ? paraIso(marcos.ultimoDiaSemSuspensao) : null,
        },
      };
      titulos.push(titulo);

      const evento = (data, tipo, canalEvento) => cronograma.push({
        data: paraIso(data), tipo, tituloId: id, canal: canalEvento, valorNaData: valorNaData(principal, vencimento, data), fluxo,
      });

      if (fase === FASES.A_VENCER || fase === FASES.PRAZO_DIRETO) {
        if (fase === FASES.A_VENCER) evento(vencimento, 'VENCIMENTO', 'DIRETO');
        evento(marcos.limiteDireto, fluxo === 'SCPC' ? 'LIMITE_ANTES_DA_NEGATIVACAO' : 'LIMITE_ANTES_DO_CARTORIO', 'DIRETO');
      }
      if (fluxo === 'SCPC' && fase !== FASES.SUSPENSO) evento(marcos.ultimoDiaSemSuspensao, 'ULTIMO_DIA_SEM_SUSPENSAO', 'DIRETO');
      if (fase === FASES.INTIMACAO || fase === FASES.EM_CARTORIO) semData.push({ id, motivo: 'AGUARDANDO_CARTORIO' });
      if (fase === FASES.PROTESTADO || fase === FASES.SEM_PROTESTO) semData.push({ id, motivo: 'SEM_PRAZO' });
      if (fase === FASES.SUSPENSO) semData.push({ id, motivo: 'FORA_DO_ESCOPO_ANALISTA' });
    });

    if (titulos.some((t) => t.custasAConfirmar)) alertas.push({ codigo: 'CUSTAS_A_CONFIRMAR', texto: 'Há título em cartório: o pagamento tem custas de cartório de valor desconhecido.' });
    if (titulos.some((t) => t.fase === FASES.SUSPENSO)) alertas.push({ codigo: 'CADASTRO_SUSPENSO', texto: 'Há título além do 20º dia no SCPC: cadastro suspenso, caso do analista.' });
    if (ignorados.length) alertas.push({ codigo: 'TITULOS_IGNORADOS', texto: `${ignorados.length} título(s) com dado ilegível ficaram fora do plano.` });

    cronograma.sort(compararEventos);

    const vencidos = titulos.filter((t) => t.diasAtraso >= 1);
    const soma = (lista, campo) => reais(lista.reduce((s, t) => s + centavos(t[campo]), 0));
    const proximo = cronograma.find((e) => e.tipo !== 'VENCIMENTO') || null;

    return {
      fluxo,
      hoje: paraIso(dia),
      titulos,
      cronograma,
      semData,
      foraDoPlano,
      ignorados,
      alertas,
      resumo: {
        qtdVencidos: vencidos.length,
        qtdAVencer: titulos.length - vencidos.length,
        totalVencidoHoje: soma(vencidos, 'valorHoje'),
        totalAVencer: soma(titulos.filter((t) => t.diasAtraso < 1), 'principal'),
        custoPorDia: soma(vencidos, 'custoPorDia'),
        proximoMarco: proximo,
      },
    };
  }

  /**
   * Plano de um GRUPO: uma entrada por empresa (apelido escolhido por quem chama), mais o total
   * e o cronograma mesclado.
   * @param {{id: string, fonte: object}[]} empresas
   * @param {Date} hoje
   */
  function planejarGrupo(empresas, hoje) {
    if (!Array.isArray(empresas)) throw new Error('Lista de empresas inválida.');
    const planos = empresas.map(({ id, fonte }) => ({ id, plano: planejarEmpresa(fonte, hoje) }));
    const cronograma = planos
      .flatMap(({ id, plano }) => plano.cronograma.map((e) => ({ ...e, empresaId: id })))
      .sort((a, b) => compararEventos(a, b) || String(a.empresaId).localeCompare(String(b.empresaId)));
    const somar = (campo) => reais(planos.reduce((s, { plano }) => s + centavos(plano.resumo[campo]), 0));
    return {
      empresas: planos,
      cronograma,
      resumo: {
        totalVencidoHoje: somar('totalVencidoHoje'),
        totalAVencer: somar('totalAVencer'),
        custoPorDia: somar('custoPorDia'),
        proximoMarco: cronograma.find((e) => e.tipo !== 'VENCIMENTO') || null,
      },
    };
  }

  window.__planoRegularizacao = {
    PARAMETROS, FASES, calcularEncargos, valorNaData, marcosDoTitulo: (venc) => marcosDoTitulo(meioDia(venc), criarCalendario()),
    planejarEmpresa, planejarGrupo,
  };
})();
