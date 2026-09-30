/* =========================================================================
 * MÓDULO 19: MENSAGENS DE COBRANÇA (texto do Alt+A) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Decide o TEXTO da mensagem de cobrança: qual título representa o cliente,
 * as frases por situação (atraso, prazo final, último dia, cartório, SCPC,
 * NAO PROTESTAR), a linha de promessa, contato recente, acordo e grupo
 * econômico, a pergunta final, a legenda do relatório e a substituição das
 * variáveis {{ }} das frases padrão. Só monta texto: não toca no DOM, na área
 * de transferência nem em atalho (isso é do Módulo 4).
 *
 * Extraído do Módulo 4 sem mudar comportamento: o código foi movido como
 * estava. Expõe window.__mensagensCobranca (as funções abaixo, congeladas);
 * o Módulo 4 as usa e as repassa em window.__atalhosDebug, que os testes
 * continuam lendo.
 *
 * Depende de: Módulo 0 (window.__smartTableUtil). Lê, se existirem,
 * window.__avisoCobranca (Módulo 1), window.__contextoAdicional (Módulo 6),
 * window.__alertaGrupo (Módulo 5) e window.__negociacoes (Módulo 16).
 * Precisa ser carregado ANTES do Módulo 4 (ordem do @require no wrapper).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__mensagensCobrancaCarregado) return;
  window.__mensagensCobrancaCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Mensagens de Cobrança');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  const {
    escolherTituloRepresentativo,
    normalizarData,
    DIAS_AVISO_SUSPENSAO_SCPC_MIN,
    DIAS_AVISO_SUSPENSAO_SCPC_MAX,
    DIAS_ULTIMO_DIA_SUSPENSAO_SCPC,
  } = window.__smartTableUtil;


  /* ---------------------------------------------------------------------
   * 3.0b MENSAGEM PERSONALIZADA (Alt+A) -- escolha do título e do texto
   * -----------------------------------------------------------------
   * O título que "representa" o cliente segue a mesma regra do Módulo 2
   * (resumo do CRM), centralizada em __smartTableUtil.escolherTituloRepresentativo.
   * O Módulo 2 mantém cópia local (protegido); este módulo e o Módulo 7 usam
   * a compartilhada, pra nota do CRM e mensagem baterem sobre o mesmo título.
   * --------------------------------------------------------------------- */

  // Datas de vencimento (curtas, sem duplicata) dos títulos de uma situação.
  // Só quando o relatório é OMITIDO (ver deveOmitirRelatorio): sem relatório
  // não dá pra dizer "grifado abaixo"; confirmado com o usuário, cita a data.
  function obterDatasVencimentoPorSituacao(dados, situacaoKey) {
    const datas = dados.registros
      .filter((r) => r.situacaoKey === situacaoKey)
      .sort((a, b) => b.diasAtrasoReal - a.diasAtrasoReal)
      .map((r) => encurtarData(r.vencimentoTexto));
    return [...new Set(datas)];
  }

  // Aviso de suspensão SCPC por nível de atraso; serve à linha principal e à
  // complementar (obterLinhaNegativadoScpcAdicional).
  function textoAvisoScpc(dias) {
    // Confirmado com o usuário: aviso específico só na janela final; fora
    // dela, a frase genérica. Após o 19º dia a suspensão é certa, mas o
    // cancelamento dos faturamentos é só POSSIBILIDADE ("podem ser
    // cancelados"); afirmar o que não é certo queima o aviso. Diz "após"
    // (não "a partir do") porque o 19º dia ainda é o último de pagamento.
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
      return `Lembramos que, após o ${DIAS_ULTIMO_DIA_SUSPENSAO_SCPC}º dia de atraso, o cadastro é suspenso e os faturamentos podem ser cancelados.`;
    }
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
      return 'Hoje é o último dia para pagamento antes que o cadastro seja suspenso e o caso seja encaminhado a um de nossos analistas. Após essa data, os faturamentos podem ser cancelados.';
    }
    return 'Lembramos que a regularização dos débitos negativados no SCPC permite a baixa das restrições.';
  }

  // Urgência entre NEGATIVADO_SCPC, mesma lógica de escolherTituloRepresentativo:
  // dia 19 exato > janela 16-18 > outro.
  function prioridadeUrgenciaScpc(dias) {
    if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) return 3;
    if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) return 2;
    return 1;
  }

  // Linha de contexto por situação (adaptada das frases padrão do usuário).
  // Retorna '' (sem linha extra), texto, ou null (sem mensagem automática).
  function obterLinhaContexto(escolhido, dados, omitirRelatorio) {
    switch (escolhido.situacaoKey) {
      case 'EM_ATRASO':
      case 'PRAZO_FINAL':
        return '';
      case 'SEM_PROTESTO': {
        // Texto aprovado pelo usuário: título "não protestar" vencido, sem
        // cartório, prazo final ou encaminhamento. Com relatório a linha nem
        // chega à mensagem (a linha do relatório é neutra); sem ele, as datas
        // ancoram. Pergunta final: a do estágio inicial (default).
        const datas = obterDatasVencimentoPorSituacao(dados, 'SEM_PROTESTO');
        return datas.length > 1
          ? `Os títulos vencidos em ${datas.join(', ')} estão em aberto.`
          : `O título vencido em ${datas[0]} está em aberto.`;
      }
      case 'ULTIMO_DIA': {
        const destino = dados.fluxo === 'SCPC' ? 'ao SCPC' : 'para cartório';
        // Sem "Lembramos que": esta linha pode vir logo após a de promessa
        // DIA_DA_PROMESSA, que já abre assim; abertura repetida soa robótica.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'ULTIMO_DIA');
          const datasTexto = datas.join(', ');
          return datas.length > 1
            ? `Os títulos vencidos em ${datasTexto} estão no prazo final antes de serem encaminhados ${destino}.`
            : `O título vencido em ${datasTexto} está no prazo final antes de ser encaminhado ${destino}.`;
        }
        // Com relatório, basta citar a cor (último dia = vermelho).
        const quantidade = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA').length;
        return quantidade > 1
          ? `Os títulos grifados em vermelho no relatório abaixo estão no prazo final antes de serem encaminhados ${destino}.`
          : `O título grifado em vermelho no relatório abaixo está no prazo final antes de ser encaminhado ${destino}.`;
      }
      case 'NEGATIVADO_SCPC':
        return textoAvisoScpc(escolhido.diasAtrasoReal);
      case 'EM_CARTORIO': {
        // Confirmado com o usuário: citar a cor (amarelo). A linha convive com
        // as outras; montarMensagemPersonalizada empilha cada uma independente.
        if (omitirRelatorio) {
          const datas = obterDatasVencimentoPorSituacao(dados, 'EM_CARTORIO');
          return `Os títulos vencidos em ${datas.join(', ')} já estão em cartório -- o pagamento do restante ainda é possível via boleto.`;
        }
        return 'Os títulos grifados em amarelo no relatório abaixo já estão em cartório -- o pagamento do restante ainda é possível via boleto.';
      }
      default:
        // VERIFICAR_POSICAO ou situação desconhecida: incerta demais; decisão
        // do usuário: sem mensagem automática, não inventar texto.
        return null;
    }
  }

  // obterLinhaContexto descreve UMA situação só. Quando EM_CARTORIO não é a
  // escolhida mas existe entre os títulos (ex.: ULTIMO_DIA escolhido), o
  // amarelo do relatório ficaria sem explicação: esta linha complementa a
  // principal, não a substitui (ver montarMensagemPersonalizada).
  function obterLinhaEmCartorioAdicional(escolhido, dados, omitirRelatorio) {
    if (escolhido.situacaoKey === 'EM_CARTORIO') return ''; // já coberto pela linha principal

    const emCartorio = dados.registros.filter((r) => r.situacaoKey === 'EM_CARTORIO');
    if (emCartorio.length === 0) return '';

    if (omitirRelatorio) {
      const datas = obterDatasVencimentoPorSituacao(dados, 'EM_CARTORIO');
      const datasTexto = datas.join(', ');
      return datas.length > 1
        ? `Os títulos vencidos em ${datasTexto} também já estão em cartório -- o pagamento do restante ainda é possível via boleto.`
        : `O título vencido em ${datasTexto} também já está em cartório -- o pagamento do restante ainda é possível via boleto.`;
    }

    return emCartorio.length > 1
      ? 'Os títulos grifados em amarelo no relatório abaixo também já estão em cartório -- o pagamento do restante ainda é possível via boleto.'
      : 'O título grifado em amarelo no relatório abaixo também já está em cartório -- o pagamento do restante ainda é possível via boleto.';
  }

  // Mesmo caso, para NEGATIVADO_SCPC (destacado em índigo no relatório) não
  // escolhido: sem esta linha o aviso de suspensão (inclusive o do dia 19)
  // ficaria omitido.
  function obterLinhaNegativadoScpcAdicional(escolhido, dados) {
    if (escolhido.situacaoKey === 'NEGATIVADO_SCPC') return ''; // já coberto pela linha principal

    const negativados = dados.registros.filter((r) => r.situacaoKey === 'NEGATIVADO_SCPC');
    if (negativados.length === 0) return '';

    return textoAvisoScpc(maisUrgenteEntreNegativados(negativados).diasAtrasoReal);
  }

  /** O título negativado mais urgente da lista: dia 19 > janela 16-18 > qualquer outro; empate, mais dias. */
  function maisUrgenteEntreNegativados(negativados) {
    return negativados.reduce((a, b) => {
      const pa = prioridadeUrgenciaScpc(a.diasAtrasoReal);
      const pb = prioridadeUrgenciaScpc(b.diasAtrasoReal);
      if (pb !== pa) return pb > pa ? b : a;
      return b.diasAtrasoReal > a.diasAtrasoReal ? b : a;
    });
  }

  /*
   * Decisão do usuário: cliente SCPC com título de ÚLTIMO DIA e título
   * NEGATIVADO -- a mensagem segue o negativado:
   *   - vale qualquer dia de atraso do negativado até o 19º (acima disso o
   *     título de último dia segue sendo o assunto);
   *   - a frase "Em vermelho, o título no prazo final antes do SCPC" fica;
   *   - o aviso do negativado ABRE (vem antes do vermelho);
   *   - a PERGUNTA FINAL segue o negativado. Com vários, vale o mais urgente.
   *
   * Só a MENSAGEM muda: escolherTituloRepresentativo (Módulo 0) mantém
   * ULTIMO_DIA na frente, pois também decide a faixa da fila (Alt+U) e a
   * nota do contato no CRM.
   *
   * @returns {object|null} O negativado que manda, ou null (escolhido não é
   *   de último dia, ou sem negativado até o 19º).
   */
  function tituloNegativadoQueManda(escolhido, dados) {
    if (escolhido?.situacaoKey !== 'ULTIMO_DIA') return null;
    const candidatos = (dados?.registros ?? []).filter(
      (r) => r.situacaoKey === 'NEGATIVADO_SCPC' && r.diasAtrasoReal <= DIAS_ULTIMO_DIA_SUSPENSAO_SCPC
    );
    return candidatos.length > 0 ? maisUrgenteEntreNegativados(candidatos) : null;
  }

  /* ---------------------------------------------------------------------
   * 2b. VARIANTES DE FRASE (rotação por cliente + dia)
   * -----------------------------------------------------------------
   * Cada lista tem variantes do MESMO papel, firmeza e pedido: trocar entre
   * elas nunca muda o estágio da cobrança (CTA de último dia jamais vira leve).
   * Escolha determinística por (cnpj, dia), ver escolherVariante no Módulo 0.
   *
   * Frases SELECIONADAS PELO USUÁRIO, uma a uma. Não acrescente frase por
   * conta própria.
   * --------------------------------------------------------------------- */
  const FRASES = Object.freeze({
    // EM_ATRASO / PRAZO_FINAL, sem promessa ativa.
    ctaGenerico: Object.freeze([
      'Podemos agendar para hoje o pagamento do débito em aberto?',
      'Consegue regularizar ainda hoje?',
      // Única pergunta ABERTA: não se responde com sim/não e puxa mais retorno.
      'Como podemos resolver isso hoje?',
      'Consegue me confirmar se dá para acertar hoje?',
    ]),

    ctaUltimoDia: Object.freeze([
      'Consegue regularizar hoje para evitarmos o encaminhamento?',
      'Conseguimos quitar isso hoje antes que o título siga para o encaminhamento?',
      'Consegue acertar hoje para o título não seguir para encaminhamento?',
    ]),

    // EM_CARTORIO: fato consumado. Toda variante nomeia o caminho de volta e
    // nenhuma promete o que não se controla.
    ctaCartorio: Object.freeze([
      'Consegue regularizar hoje para eu confirmar a baixa da restrição?',
      'Assim que o pagamento for confirmado, sinalizo em nosso sistema. Consegue regularizar hoje?',
      'Consegue fechar isso hoje? Confirmado o pagamento, já sinalizo a baixa.',
    ]),

    // SCPC 16 a 18 dias: a suspensão ainda NÃO é hoje. Nunca cravar prazo
    // "até o fim do dia" aqui (falso antes do 19º; queima o aviso). Essa
    // frase vive só em ctaUltimoDiaScpc.
    ctaSuspensaoScpc: Object.freeze([
      'Consegue regularizar hoje para evitarmos a suspensão do cadastro?',
      'A suspensão do cadastro é automática se o pagamento não for identificado. Consegue resolver hoje?',
      'Regularizando hoje, o cadastro segue ativo normalmente. Conseguimos agendar?',
    ]),

    // SCPC no 19º dia: o prazo é real.
    ctaUltimoDiaScpc: Object.freeze([
      'Consegue regularizar hoje, o último dia antes da suspensão?',
      'Sem a identificação do pagamento até o fim do dia o cadastro é suspenso automaticamente. Consegue resolver hoje?',
    ]),

    // Retomada de contato. A primeira AFIRMA que o cliente não retornou (errado
    // se ele respondeu e não pagou); fica por decisão do usuário. As outras
    // duas não afirmam nada sobre o cliente.
    retomada: Object.freeze([
      'Retomando o contato de {{referencia}}, já que ainda não obtivemos retorno.',
      'Voltando aqui sobre o contato de {{referencia}}.',
      'Dando sequência ao contato de {{referencia}}.',
    ]),
  });

  /**
   * Semente da rotação: o cliente da página e o dia de hoje.
   *
   * Sem cnpj (página fora do padrão), usa só o dia: todos recebem a mesma
   * variante naquele dia, sem estourar.
   *
   * @returns {string}
   */
  let jaAvisouSementeSemCnpj = false;
  function sementeDaFrase() {
    let cnpj = '';
    try {
      cnpj = new URLSearchParams(location.search).get('cnpj') || '';
    } catch (erro) {
      cnpj = '';
    }

    // Avisa em vez de degradar calado: a mensagem segue correta, então sem o
    // aviso a rotação morreria sem ninguém notar se o CRM renomear o parâmetro.
    if (!cnpj && !jaAvisouSementeSemCnpj) {
      jaAvisouSementeSemCnpj = true;
      console.warn(
        '[Atalhos] Não achei o cnpj na URL pra variar as frases. Todas as mensagens de hoje vão usar ' +
        'a mesma variante. As frases seguem corretas -- só param de alternar entre clientes.'
      );
    }

    const util = window.__smartTableUtil;
    const dia = util && typeof util.dataIso === 'function' ? util.dataIso(new Date()) : '';
    return `${cnpj}|${dia}`;
  }

  /**
   * @param {string[]} variantes Uma das listas de FRASES.
   * @returns {string}
   */
  function frase(variantes) {
    const util = window.__smartTableUtil;
    if (!util || typeof util.escolherVariante !== 'function') return variantes[0];
    return util.escolherVariante(sementeDaFrase(), variantes);
  }

  // Confirmado com o usuário: perto do encaminhamento, negativado ou em
  // cartório o CTA é mais específico e urgente, sem ameaça: só nomeia a
  // consequência real (evitar encaminhamento, baixa da restrição, suspensão).
  function obterPerguntaFinal(escolhido, dados) {
    // Último dia + negativado: segue o negativado (tituloNegativadoQueManda).
    // Sem `dados`, comportamento padrão.
    const referencia = tituloNegativadoQueManda(escolhido, dados) ?? escolhido;
    switch (referencia.situacaoKey) {
      case 'ULTIMO_DIA':
        return frase(FRASES.ctaUltimoDia);
      case 'EM_CARTORIO':
        return frase(FRASES.ctaCartorio);
      case 'NEGATIVADO_SCPC': {
        const dias = referencia.diasAtrasoReal;
        if (dias >= DIAS_AVISO_SUSPENSAO_SCPC_MIN && dias <= DIAS_AVISO_SUSPENSAO_SCPC_MAX) {
          return frase(FRASES.ctaSuspensaoScpc);
        }
        if (dias === DIAS_ULTIMO_DIA_SUSPENSAO_SCPC) {
          return frase(FRASES.ctaUltimoDiaScpc);
        }
        return frase(FRASES.ctaCartorio);
      }
      default: // EM_ATRASO, PRAZO_FINAL, SEM_PROTESTO -- estágio inicial, sem pressão
        return obterPerguntaFinalConsiderandoPromessa();
    }
  }

  /**
   * Pergunta final do estágio inicial (EM_ATRASO/PRAZO_FINAL), considerando
   * a promessa ativa: a promessa é o compromisso mais específico e decide o
   * pedido (quem prometeu pagar hoje não recebe "Podemos agendar para hoje?").
   *
   * Só troca a pergunta GENÉRICA. As de ULTIMO_DIA, EM_CARTORIO e
   * NEGATIVADO_SCPC valem com promessa ativa: pedem ação, não agendamento.
   *
   * QUEBRADA não passa por aqui: a linha dela já termina em pergunta.
   *
   * @returns {string}
   */
  function obterPerguntaFinalConsiderandoPromessa() {
    const tipo = window.__contextoAdicional?.promessa?.tipo;

    // Confirmado com o usuário: presume boa-fé; o comprovante fecha o ciclo
    // (permite dar baixa).
    if (tipo === 'DIA_DA_PROMESSA') return 'Assim que efetuar, pode me enviar o comprovante?';

    // Confirmado com o usuário: reconhece que já houve pagamento parcial.
    if (tipo === 'PARCIAL') return 'Consegue quitar o restante hoje?';

    return frase(FRASES.ctaGenerico);
  }

  /*
   * Pedido do usuário: no primeiro dia útil depois de fim de semana/feriado,
   * quem tem o título MAIS atrasado no 2º a 4º dia pode ter pago sem aparecer
   * no CRM. A pergunta final ganha a ressalva pedindo o comprovante. O período
   * ("no fim de semana", "no feriado" ou os dois) vem do Módulo 6
   * (periodoNaoUtilAntesDeHoje).
   *
   * Fora com promessa para hoje (DIA_DA_PROMESSA): a pergunta dela já pede
   * o comprovante.
   */
  const DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL = Object.freeze({ MIN: 2, MAX: 4 });

  function obterRessalvaPagamentoEmDiaNaoUtil(dados) {
    const ctx = window.__contextoAdicional;
    const periodo = ctx?.periodoNaoUtilAntesDeHoje;
    if (!periodo) return '';
    if (ctx?.promessa?.tipo === 'DIA_DA_PROMESSA') return '';
    const dias = (dados?.registros ?? []).map((r) => r.diasAtrasoReal).filter(Number.isFinite);
    if (dias.length === 0) return '';
    const maior = Math.max(...dias);
    if (maior < DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL.MIN || maior > DIAS_ATRASO_RESSALVA_DIA_NAO_UTIL.MAX) return '';
    return `Caso já tenha pago ${periodo}, por gentileza nos encaminhar o comprovante para sinalizar em nosso sistema.`;
  }

  /* ---------------------------------------------------------------------
   * 3.0c LINHAS DE CONTEXTO ADICIONAL (Módulo 6) -- promessa e contato
   * -----------------------------------------------------------------
   * Lê window.__contextoAdicional (Módulo 6). Sem o Módulo 6 ou sem nada
   * relevante, as funções devolvem '' e a mensagem segue sem essas linhas.
   * --------------------------------------------------------------------- */
  // Apresentação: o cliente TEM contato registrado (zero contatos vira
  // mensagem só de identificação, ver semContatoAnterior). Vai logo após a
  // saudação, sem a pergunta de confirmação de responsável.
  //
  // Dois motivos levam à mesma linha (confirmado com o usuário: coexistem):
  //   - contatoAntigo: contato anterior à data de corte (Módulo 6); ele não
  //     deve lembrar.
  //   - nuncaContatadoPorMim: só OUTRO negociador falou com ele; pra ele é a
  //     primeira vez desta pessoa, cabe se apresentar.

  // Nome usado quando o Módulo 6 não está carregado; carregado, vem de
  // ctx.nomeNegociador (usuário logado no CRM).
  const NOME_NEGOCIADOR_PADRAO = 'Isaac';

  // Confirmado: a parte antes do ponto no código do CRM é o primeiro nome
  // ("BIANCA.03665" -> "Bianca"). Sem artigo ("Sou Isaac", não "Sou o
  // Isaac") de propósito: o artigo depende do gênero, que o código não sabe.
  function montarApresentacao() {
    const nome = window.__contextoAdicional?.nomeNegociador || NOME_NEGOCIADOR_PADRAO;
    return `Sou ${nome}, do financeiro da Tex Cotton (Animê, Bimbi, Youccie, Authoria e Momi).`;
  }

  function obterLinhaApresentacao() {
    const ctx = window.__contextoAdicional;
    if (!ctx) return '';
    if (!ctx.contatoAntigo && !ctx.nuncaContatadoPorMim) return '';
    return montarApresentacao();
  }

  // Confirmado com o usuário: com outra razão do grupo vencida, a frase do
  // relatório diz "de cada razão social", sem citar nome/valor. Lê
  // window.__alertaGrupo (Módulo 5, carregado ANTES).
  function temOutraRazaoComVencido() {
    const grupo = window.__alertaGrupo;
    return !!(grupo && grupo.empresasComVencido && grupo.empresasComVencido.length > 0);
  }

  function obterLinhaContatoRecente() {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente) return '';

    // Confirmado com o usuário: "ainda não obtivemos retorno" é falso quando
    // o último contato gerou promessa, qualquer que seja o status atual dela.
    // ctx.promessa só cobre promessa ativa; houvePromessaNoUltimoContato
    // (Módulo 6) cobre a já paga/resolvida. Título que sumiu desde a última
    // visita também é retorno (contradiria o agradecimento de pagamento).
    if (ctx.promessa || ctx.houvePromessaNoUltimoContato || ctx.houveTituloPagoDesdeUltimaVisita) return '';

    // Decisão do usuário: se só OUTRO negociador falou ontem, vale a
    // apresentação e o contato dele não é citado (senão a mensagem se
    // apresenta como primeira vez E retoma conversa alheia). Exclusão
    // explícita: nuncaContatadoPorMim é ortogonal à data de contatoRecente.
    if (ctx.nuncaContatadoPorMim) return '';

    // Confirmado com o usuário: só vale quando o último contato foi EXATAMENTE
    // o dia útil anterior (o Módulo 6 garante; senão contatoRecente não vem).
    // "Ontem" só se for literal; senão o dia da semana (hoje segunda, contato
    // sexta).
    const { ehOntemLiteral, diaSemanaTexto } = ctx.contatoRecente;
    const referencia = ehOntemLiteral ? 'ontem' : diaSemanaTexto;
    return frase(FRASES.retomada).replace('{{referencia}}', referencia);
  }

  // Reconhecer o pagamento antes de cobrar o resto gera cooperação. Só agradece
  // na mesma janela do recontato (contatoRecente, dia útil anterior, Módulo 6).
  // Fora com promessa ativa: a linha de promessa já comenta o pagamento.
  function obterLinhaAgradecimentoPagamento(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.houveTituloPagoDesdeUltimaVisita) return '';
    if (ctx.promessa) return '';

    // Nunca agradece baixa de título ainda aberto nos dados ao vivo: o retrato
    // do Módulo 6 é comparado no carregamento, e com a tabela ainda vazia
    // títulos abertos pareciam "sumidos". Título que saiu da cobrança sem
    // pagamento (acordo, NÃO COBRAR/CARTEIRA, fora do relatório) também não
    // é baixa.
    const informados = ctx.titulosPagosDesdeUltimaVisita || [];
    const abertos = new Set(
      [dados?.registros, dados?.emAcordo, dados?.naoCobrar, dados?.foraDoRelatorio]
        .flatMap((lista) => (Array.isArray(lista) ? lista : []))
        .map((r) => r?.tituloCompleto)
    );
    const titulos = informados.filter((t) => !abertos.has(t));
    if (informados.length > 0 && titulos.length === 0) return '';
    if (titulos.length === 0) return 'Recebemos a baixa de um dos títulos em aberto, obrigado!';
    const titulosTexto = titulos.join(', ');
    return titulos.length > 1
      ? `Recebemos a baixa dos títulos ${titulosTexto}, obrigado!`
      : `Recebemos a baixa do título ${titulosTexto}, obrigado!`;
  }

  /**
   * Converte "dd/mm/aaaa" para Date ao MEIO-DIA (normalizarData, Módulo 0),
   * como o Módulo 6 faz com contatoRecente.data. Meia-noite quebraria o ">="
   * de deveOmitirRelatorio (00:00 >= 12:00 é false) e omitiria o relatório
   * no dia em que apareceu dívida nova.
   *
   * @param {string} texto Data no formato "dd/mm/aaaa".
   * @returns {Date|null} Data ao meio-dia, ou null se o texto não bater no formato.
   */
  function converterDataBrParaDate(texto) {
    const m = (texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return normalizarData(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }

  // Confirmado com o usuário: recontato sem título NOVO vencido desde o
  // último contato não reenvia o relatório (o cliente já viu). Compara o
  // vencimento de cada título com a data do contato mais recente (só existe
  // quando foi no dia útil anterior; ver calcularContextoContato, Módulo 6).
  function deveOmitirRelatorio(dados) {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.contatoRecente || !ctx.contatoRecente.data) return false;

    // Confirmado: título que SUMIU da lista (provável pagamento) também é
    // informação nova. Vem do retrato no localStorage por CNPJ (Módulo 6);
    // o CRM não dá a data de pagamento sem trocar o filtro da tabela.
    if (ctx.houveTituloPagoDesdeUltimaVisita) return false;

    // Confirmado: se o contato de ontem já foi recontato (recontatoConsecutivo,
    // Módulo 6), não omite 2+ dias seguidos: volta a enviar o relatório.
    if (ctx.contatoRecente.recontatoConsecutivo) return false;

    const dataUltimoContato = ctx.contatoRecente.data;
    // ">=" (não ">"): título só entra em "registros" com 1+ dia de atraso
    // (DIAS_ATRASO_MIN, Módulo 1); vencimento IGUAL à data do contato não
    // estava atrasado naquele dia e só aparece depois, logo é novo.
    const temTituloNovo = dados.registros.some((r) => {
      const vencimento = converterDataBrParaDate(r.vencimentoTexto);
      return vencimento && vencimento.getTime() >= dataUltimoContato.getTime();
    });
    return !temTituloNovo;
  }

  const FORMAS_CONCORDANCIA_TITULO = Object.freeze({
    do: ['do título', 'dos títulos'],
    ao: ['ao título', 'aos títulos'],
  });

  /**
   * Concorda preposição + "título" com a quantidade real (nunca "do(s)
   * título(s)"). Preposição desconhecida devolve forma neutra em vez de
   * lançar TypeError e derrubar a montagem da mensagem inteira.
   *
   * @param {'do'|'ao'} preposicao
   * @param {number} quantidade
   * @returns {string}
   */
  function concordarTitulos(preposicao, quantidade) {
    const formas = FORMAS_CONCORDANCIA_TITULO[preposicao];
    if (!formas) {
      console.warn(`[Atalhos] Preposição "${preposicao}" não tem forma de concordância definida -- usando forma neutra.`);
      return pluralizarTitulo(quantidade);
    }
    const [singular, plural] = formas;
    return quantidade === 1 ? singular : plural;
  }

  function pluralizarTitulo(quantidade) {
    return quantidade === 1 ? 'título' : 'títulos';
  }

  function obterLinhaPromessa() {
    const ctx = window.__contextoAdicional;
    if (!ctx || !ctx.promessa) return '';

    const { tipo, promessa } = ctx.promessa;
    const titulosTexto = promessa.titulos.join(', ');

    switch (tipo) {
      case 'DIA_DA_PROMESSA':
        return `Lembramos que hoje é o dia combinado para o pagamento ${concordarTitulos('do', promessa.titulos.length)} ${titulosTexto}.`;
      case 'QUEBRADA':
        return (
          `Notamos que o pagamento combinado para ${encurtarData(promessa.dataPrometidaTexto)}, referente ${concordarTitulos('ao', promessa.titulos.length)} ` +
          `${titulosTexto}, não foi identificado. Já foi realizado? Se sim, pode nos enviar o comprovante para conferência.`
        );
      case 'PARCIAL': {
        const pendentes =
          typeof ctx.calcularTitulosPendentes === 'function'
            ? ctx.calcularTitulosPendentes(promessa.titulos)
            : promessa.titulos;
        // Aprovado pelo usuário: só a quantidade; os números já estão no relatório.
        const restante = pendentes.length === 0
          ? 'os títulos combinados já foram regularizados'
          : `ainda ${pendentes.length === 1 ? 'resta 1 título' : `restam ${pendentes.length} títulos`} em aberto`;
        return `Identificamos o pagamento parcial do combinado para ${encurtarData(promessa.dataPrometidaTexto)}; ${restante}.`;
      }
      default:
        return '';
    }
  }

  /**
   * Junta numa frase só a SITUAÇÃO dos títulos: a linha do representativo
   * mais as complementares de cartório e SCPC.
   *
   * @returns {string|null} Frase montada, ou null quando a situação do
   *   título escolhido não deve gerar mensagem automática.
   */
  function montarLinhaSituacao(escolhido, dados, omitirRelatorio) {
    const linhaContexto = obterLinhaContexto(escolhido, dados, omitirRelatorio);
    if (linhaContexto === null) return null;

    // Complementam (não substituem) a linha principal.
    const cartorioAdicional = obterLinhaEmCartorioAdicional(escolhido, dados, omitirRelatorio);
    const negativadoAdicional = obterLinhaNegativadoScpcAdicional(escolhido, dados);
    // Último dia + negativado (até o 19º): o aviso do negativado ABRE.
    const negativadoAbre = tituloNegativadoQueManda(escolhido, dados) !== null;
    const frases = (negativadoAbre
      ? [negativadoAdicional, linhaContexto, cartorioAdicional]
      : [linhaContexto, cartorioAdicional, negativadoAdicional]
    ).filter(Boolean);
    // Como na legenda (montarLegendaRelatorio): com outras situações, o aviso
    // do 19º dia vai curto.
    const aviso19 = textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC);
    return (frases.length > 1 ? frases.map((f) => (f === aviso19 ? AVISO_ULTIMO_DIA_SCPC_CURTO : f)) : frases).join(' ');
  }

  /**
   * Bloco de contexto da conversa (apresentação, agradecimento, retomada,
   * promessa), uma linha por assunto; cada função decide se tem algo a dizer.
   *
   * @returns {string} Linhas separadas por quebra simples, ou string vazia.
   */
  function montarBlocoContexto(dados) {
    return [
      obterLinhaApresentacao(),
      obterLinhaAgradecimentoPagamento(dados),
      obterLinhaContatoRecente(),
      obterLinhaPromessa(),
    ]
      .filter(Boolean)
      .join('\n');
  }

  // Confirmado: com 2+ razões vencidas a frase diz "cada razão social"; é
  // frase fechada, não lead-in com ":".
  function montarLinhaRelatorio() {
    return temOutraRazaoComVencido()
      ? 'Segue o relatório atualizado com os débitos em aberto de cada razão social.'
      : 'Segue o relatório atualizado da razão social {{cliente_nome}}.';
  }

  /**
   * O que as cores do relatório significam, numa frase só (vai na legenda da
   * imagem, ver montarLegendaRelatorio; pedido do usuário: mensagens curtas).
   *
   * @returns {string} Frase pronta, ou '' quando nenhum título tem cor.
   */
  function descreverCoresDoRelatorio(dados) {
    const noUltimoDia = dados.registros.filter((r) => r.situacaoKey === 'ULTIMO_DIA').length;
    const emCartorio = dados.registros.some((r) => r.situacaoKey === 'EM_CARTORIO');
    const destino = dados.fluxo === 'SCPC' ? 'do SCPC' : 'do cartório';
    const vermelho = `${noUltimoDia > 1 ? 'os títulos' : 'o título'} no prazo final antes ${destino}`;
    const amarelo = 'o que já está em cartório (o restante ainda pode ser pago via boleto)';

    if (noUltimoDia && emCartorio) return `Em vermelho, ${vermelho}; em amarelo, ${amarelo}.`;
    if (noUltimoDia) return `Em vermelho, ${vermelho}.`;
    if (emCartorio) return `Em amarelo, ${amarelo}.`;
    return '';
  }

  /**
   * Legenda da imagem do relatório: "Segue o relatório..." + o que as cores
   * significam + o aviso SCPC, quando houver. Um balão só, colado na legenda
   * da imagem no WhatsApp.
   */
  function montarLegendaRelatorio(escolhido, dados) {
    const cores = descreverCoresDoRelatorio(dados);
    let avisoScpc = escolhido.situacaoKey === 'NEGATIVADO_SCPC'
      ? textoAvisoScpc(escolhido.diasAtrasoReal)
      : obterLinhaNegativadoScpcAdicional(escolhido, dados);
    // Aprovado pelo usuário: o aviso do 19º dia (175 caracteres) somado às
    // cores passava de 8 linhas no celular; com cores vai a versão curta,
    // mesmo conteúdo. Uma ideia por linha (lê melhor no celular).
    if (cores && avisoScpc === textoAvisoScpc(DIAS_ULTIMO_DIA_SUSPENSAO_SCPC)) avisoScpc = AVISO_ULTIMO_DIA_SCPC_CURTO;
    // Último dia + negativado (até o 19º): o aviso do negativado vem ANTES do vermelho.
    const negativadoAbre = tituloNegativadoQueManda(escolhido, dados) !== null;
    return (negativadoAbre
      ? [montarLinhaRelatorio(), avisoScpc, cores]
      : [montarLinhaRelatorio(), cores, avisoScpc]
    ).filter(Boolean).join('\n');
  }

  const AVISO_ULTIMO_DIA_SCPC_CURTO =
    'Hoje é o último dia antes da suspensão do cadastro; depois dela, os faturamentos podem ser cancelados.';

  /**
   * Decide se a pergunta final entra na mensagem. O critério é "o conteúdo já
   * pede alguma coisa" (só a promessa QUEBRADA embute pergunta), não "já
   * existe conteúdo": senão, sem relatório, as situações graves (linha nunca
   * vazia) ficariam sem pedido de ação.
   */
  function precisaDePerguntaFinal(linhaSituacao, blocoContexto) {
    return !/\?/.test(linhaSituacao) && !/\?/.test(blocoContexto);
  }

  /**
   * Decide se o relatório entra, respeitando a omissão por recontato.
   *
   * Sem nenhuma âncora (linha de situação e bloco sobre a dívida vazios), o
   * cliente receberia só saudação + pergunta genérica sem saber do que se
   * trata: o relatório volta mesmo com omitirRelatorio=true.
   *
   * A âncora é o que fala da DÍVIDA: a apresentação diz quem fala, não do
   * que se trata, e não conta (aprovado pelo usuário). A linha de recontato
   * ("Dando sequência ao contato de ontem.") CONTA: é ela que permite omitir
   * o relatório no recontato; sem ela o relatório voltaria sempre.
   */
  function precisaDoRelatorio(omitirRelatorio, linhaSituacao, blocoSobreADivida) {
    const semNenhumaAncora = !blocoSobreADivida && !linhaSituacao;
    return !omitirRelatorio || semNenhumaAncora;
  }

  /** O bloco de contexto sem a apresentação (só o que fala da dívida/do contato). */
  function montarBlocoSobreADivida(dados) {
    return [obterLinhaAgradecimentoPagamento(dados), obterLinhaContatoRecente(), obterLinhaPromessa()]
      .filter(Boolean)
      .join('\n');
  }

  const MARCADOR_IMAGEM_RELATORIO = '__IMAGEM_RELATORIO__';

  /**
   * A mesma mensagem como texto corrido: balões separados por linha em
   * branco, sem o marcador da imagem. Derivada das partes (nunca uma segunda
   * montagem, que poderia divergir).
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string|null}
   */
  function montarMensagemPersonalizada(dados) {
    const partes = montarPartesMensagemPersonalizada(dados);
    return partes ? partes.filter((p) => p !== MARCADOR_IMAGEM_RELATORIO).join('\n\n') : null;
  }

  /* ---------------------------------------------------------------------
   * ACORDOS (Módulo 16) -- frases APROVADAS pelo usuário, textuais.
   * Títulos de acordo ATIVA/CONCLUIDA já chegam FORA de dados.registros
   * (Módulo 1 os põe em dados.emAcordo); aqui só se decide o que dizer.
   * --------------------------------------------------------------------- */
  function moeda(valor) {
    // Sem o espaço inseparável do toLocaleString, igual ao texto aprovado
    // ("R$ 770,49").
    return (window.__smartTableUtil?.formatarMoeda?.(valor) ?? String(valor)).replace(/\u00a0/g, ' ');
  }

  function dataCurtaIso(iso) {
    return window.__negociacoes?.dataCurta?.(iso) ?? '';
  }

  /** A: tudo em acordo, parcela em dia. */
  function fraseLembreteParcela(p) {
    return `Passando para lembrar da parcela ${p.numero} do nosso acordo, de ${moeda(p.valor)}, com vencimento em ${dataCurtaIso(p.dataVencimento)}. Posso contar com o pagamento na data?`;
  }

  /** B: tudo em acordo, parcela atrasada. */
  function fraseParcelaAtrasada(p) {
    return `A parcela ${p.numero} do nosso acordo, de ${moeda(p.valor)}, venceu em ${dataCurtaIso(p.dataVencimento)} e ainda não identificamos o pagamento. Consegue regularizar hoje para manter o acordo em dia?`;
  }

  /**
   * Linha do acordo quando HÁ outros títulos sendo cobrados (caso misto).
   *   C: parcela em dia.
   *   Parcela atrasada: só a afirmação -- "segue em dia" (C) seria falso,
   *   e a pergunta final da mensagem já pede a ação.
   *   D: acordo INADIMPLENTE (os títulos dele voltaram pra cobrança).
   *
   * Aprovado pelo usuário: frases curtas, TODAS num balão só (um balão por
   * frase estourava 5 balões / 600 caracteres em muitas combinações).
   *
   * @returns {string[]} zero ou um balão
   */
  function linhasDoAcordoNoCasoMisto(resumo) {
    const frases = [];
    if (resumo?.ativa) {
      const p = resumo.ativa.parcela;
      frases.push(resumo.ativa.atrasada
        ? `A parcela ${p.numero} do acordo (${moeda(p.valor)}) venceu em ${dataCurtaIso(p.dataVencimento)}.`
        : `O acordo segue em dia: próxima parcela de ${moeda(p.valor)} em ${dataCurtaIso(p.dataVencimento)}.`);
    }
    if (resumo?.inadimplente) {
      frases.push(`O acordo feito em ${dataCurtaIso(resumo.inadimplente.dataCriacao)} não foi cumprido, e os títulos voltaram para a cobrança.`);
    }
    return frases.length > 0 ? [frases.join(' ')] : [];
  }

  /** Tudo em acordo ATIVA: sem relatório, só a parcela (A ou B). */
  function partesSoAcordo(dados, ativa) {
    const linhas = [obterLinhaApresentacao(), obterLinhaContatoRecente()].filter(Boolean);
    const frase = ativa.atrasada ? fraseParcelaAtrasada(ativa.parcela) : fraseLembreteParcela(ativa.parcela);
    return [linhas.length > 0 ? `{{saudacao}} ${linhas[0]}` : '{{saudacao}}', ...linhas.slice(1), frase]
      .map((parte) => substituirVariaveisDaFrase(parte, dados));
  }

  /**
   * Mesma mensagem de montarMensagemPersonalizada, como LISTA DE PARTES (um
   * balão do WhatsApp cada), reaproveitando as mesmas funções de linha.
   *
   * @param {object} dados Retorno de window.__avisoCobranca.simular().
   * @returns {string[]|null} Partes com variáveis substituídas (a do
   *   relatório vem como MARCADOR_IMAGEM_RELATORIO), ou null quando não há
   *   mensagem automática.
   */
  function montarPartesMensagemPersonalizada(dados) {
    const ctx = window.__contextoAdicional;

    // Aprovado pelo usuário: a saudação divide o balão com a primeira frase
    // (saudação sozinha seria um balão e uma notificação sem conteúdo).
    if (ctx?.semContatoAnterior) {
      return [
        `{{saudacao}} ${montarApresentacao()}`,
        'Este é o contato responsável pela razão social {{cliente_nome}}?',
      ].map((parte) => substituirVariaveisDaFrase(parte, dados));
    }

    const resumoAcordos = window.__negociacoes?.resumoDeCobranca?.(dados?.registros ?? []) ?? null;
    const escolhido = escolherTituloRepresentativo(dados);
    if (!escolhido) {
      if (resumoAcordos?.ativa) return partesSoAcordo(dados, resumoAcordos.ativa);
      if ((dados?.emAcordo?.length ?? 0) > 0) {
        console.warn('[Atalhos] Todos os títulos vencidos estão em acordo já quitado -- nada a cobrar.');
        window.__smartTableUtil?.toast?.('Acordo quitado: os títulos aguardam a baixa -- nada a cobrar.', 6000);
        return null;
      }
      console.warn('[Atalhos] Nenhum título vencido encontrado para este cliente -- mensagem personalizada não gerada.');
      return null;
    }

    // omitirRelatorio antes da linha de situação (o texto dela muda sem
    // relatório). blocoContexto só alimenta precisaDePerguntaFinal; cada linha
    // vira sua própria parte.
    const omitirRelatorio = deveOmitirRelatorio(dados);
    const linhaSituacao = montarLinhaSituacao(escolhido, dados, omitirRelatorio);
    if (linhaSituacao === null) {
      console.warn(
        `[Atalhos] Situação "${escolhido.situacaoKey}" não gera mensagem automática (situação incerta demais) -- escreva manualmente.`
      );
      return null;
    }
    const blocoContexto = montarBlocoContexto(dados);

    const linhasContexto = [
      obterLinhaApresentacao(),
      obterLinhaAgradecimentoPagamento(dados),
      obterLinhaContatoRecente(),
      obterLinhaPromessa(),
      ...linhasDoAcordoNoCasoMisto(resumoAcordos),
    ].filter(Boolean);
    const partes = [
      linhasContexto.length > 0 ? `{{saudacao}} ${linhasContexto[0]}` : '{{saudacao}}',
      ...linhasContexto.slice(1),
    ];

    // A legenda vem DEPOIS do marcador: no WhatsApp cola-se a imagem e, na
    // prévia, a legenda, ambas pelo Win+V (ver textoAvisoDasPartes).
    if (precisaDoRelatorio(omitirRelatorio, linhaSituacao, montarBlocoSobreADivida(dados))) {
      partes.push(MARCADOR_IMAGEM_RELATORIO);
      partes.push(montarLegendaRelatorio(escolhido, dados));
    } else if (linhaSituacao) {
      partes.push(linhaSituacao);
    }
    if (precisaDePerguntaFinal(linhaSituacao, blocoContexto)) {
      const pergunta = obterPerguntaFinal(escolhido, dados);
      const ressalva = obterRessalvaPagamentoEmDiaNaoUtil(dados);
      partes.push(ressalva ? `${pergunta} ${ressalva}` : pergunta);
    }

    return partes.map((parte) => (parte === MARCADOR_IMAGEM_RELATORIO ? parte : substituirVariaveisDaFrase(parte, dados)));
  }

  /* ---------------------------------------------------------------------
   * 3.0a SUBSTITUIÇÃO DE VARIÁVEIS {{ }} NAS FRASES PADRÃO
   * -----------------------------------------------------------------
   * O texto de data-texto é escrito DIRETO na caixa (não clicamos no botão
   * real, ver acionarSelecionarPrimeiraFrase), então a substituição de
   * variáveis que o app faria no clique é feita aqui.
   *
   * Fonte de dados: window.__avisoCobranca.simular() (Módulo 1).
   *
   * Variáveis SEM resolvedor ({{responsavel_nome}}, {{chave_pix}},
   * {{valor_protestado_atualizado}}: decisão consciente, o CRM não as expõe)
   * ficam com o {{...}} visível na caixa e geram aviso no console, sem
   * adivinhar valor. Vale também pra variável nova sem resolvedor: nunca
   * falha em silêncio.
   * --------------------------------------------------------------------- */
  // Datas pro cliente sem o ano ("vencido em 04/09"), como o usuário escreve.
  // Fora do formato esperado, devolve como veio.
  function encurtarData(textoData) {
    const m = (textoData || '').match(/^(\d{2}\/\d{2})\/\d{4}$/);
    return m ? m[1] : (textoData || '');
  }

  function converterMoedaBrParaNumero(texto) {
    if (!texto) return null;
    // Formato esperado: "R$ 1.234,56".
    const limpo = String(texto)
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const numero = parseFloat(limpo);
    return Number.isFinite(numero) ? numero : null;
  }


  function obterDadosParaSubstituicao() {
    if (!window.__avisoCobranca || typeof window.__avisoCobranca.simular !== 'function') {
      console.warn('[Atalhos] Módulo de Aviso de Cobrança (Módulo 1) indisponível -- variáveis da frase não serão substituídas.');
      return null;
    }
    try {
      return window.__avisoCobranca.simular();
    } catch (erro) {
      console.warn('[Atalhos] Não foi possível calcular os dados do cliente para substituir variáveis:', erro.message);
      return null;
    }
  }

  // Cada resolvedor recebe o retorno de simular() e devolve a string da frase,
  // ou null/undefined se não conseguir. Variável nova = uma linha aqui.
  const RESOLVEDORES_VARIAVEL = {
    cliente_nome: (dados) => {
      const primeiro = dados.registros[0];
      return primeiro ? primeiro.razaoSocial : null;
    },
    quantidade_titulos_vencidos: (dados) => String(dados.registros.length),
    quantidade_titulos_protestados: (dados) =>
      String(dados.registros.filter((r) => r.situacaoKey === 'EM_CARTORIO').length),
    // Falha fechada: se QUALQUER saldo não for entendido, a variável não é
    // resolvida (o {{valor_total_vencido}} fica visível e o console avisa).
    // Tratar saldo ilegível como 0 mandaria valor financeiro ERRADO ao
    // cliente sem nenhum sinal.
    valor_total_vencido: (dados) => {
      let soma = 0;
      for (const r of dados.registros) {
        const valor = converterMoedaBrParaNumero(r.saldoTexto);
        if (valor === null) {
          // Censurado: só o FORMATO do saldo (dígitos viram #), sem o título.
          console.warn(
            `[Atalhos] Não consegui interpretar um saldo (formato "${window.__diario?.valorMascarado?.(r.saldoTexto) ?? 'oculto'}") -- ` +
            'total não será preenchido automaticamente pra não enviar valor errado.'
          );
          return null;
        }
        soma += valor;
      }
      return window.__smartTableUtil.formatarMoeda(soma);
    },
    // Saudação por horário do relógio (não depende do cliente).
    saudacao: () => {
      const hora = new Date().getHours();
      if (hora < 12) return 'Bom dia, tudo bem?';
      if (hora < 18) return 'Boa tarde, tudo bem?';
      return 'Boa noite, tudo bem?';
    },
    // Vencimento do título escolhido por escolherTituloRepresentativo() (seção 3.0b).
    data_vencimento: (dados) => {
      const escolhido = escolherTituloRepresentativo(dados);
      return escolhido ? encurtarData(escolhido.vencimentoTexto) : null;
    },
  };

  function substituirVariaveisDaFrase(texto, dadosPreCalculados) {
    if (!texto || texto.indexOf('{{') === -1) {
      return texto;
    }

    const dados = dadosPreCalculados || obterDadosParaSubstituicao();
    const naoResolvidas = [];

    const resultado = texto.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (trechoOriginal, nomeVariavel) => {
      const resolvedor = RESOLVEDORES_VARIAVEL[nomeVariavel];
      if (!resolvedor || !dados) {
        naoResolvidas.push(nomeVariavel);
        return trechoOriginal; // deixa "{{nomeVariavel}}" visível na caixa
      }
      try {
        const valor = resolvedor(dados);
        if (valor === null || valor === undefined || valor === '') {
          naoResolvidas.push(nomeVariavel);
          return trechoOriginal;
        }
        return valor;
      } catch (erro) {
        console.warn(`[Atalhos] Erro ao calcular a variável "${nomeVariavel}":`, erro.message);
        naoResolvidas.push(nomeVariavel);
        return trechoOriginal;
      }
    });

    if (naoResolvidas.length > 0) {
      console.warn(
        `[Atalhos] Variável(is) não preenchida(s) automaticamente -- confira a mensagem antes de enviar (Alt+S): ${naoResolvidas.join(', ')}`
      );
    }

    return resultado;
  }

  window.__mensagensCobranca = Object.freeze({
    tituloNegativadoQueManda,
    FRASES,
    sementeDaFrase,
    frase,
    obterPerguntaFinal,
    obterRessalvaPagamentoEmDiaNaoUtil,
    temOutraRazaoComVencido,
    deveOmitirRelatorio,
    concordarTitulos,
    MARCADOR_IMAGEM_RELATORIO,
    montarMensagemPersonalizada,
    linhasDoAcordoNoCasoMisto,
    montarPartesMensagemPersonalizada,
    obterDadosParaSubstituicao,
    substituirVariaveisDaFrase,
  });
})();
