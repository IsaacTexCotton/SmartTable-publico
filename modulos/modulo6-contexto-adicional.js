/* =========================================================================
 * MÓDULO 6: CONTEXTO ADICIONAL (Promessas + Contato Recente) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Ao entrar na página do cliente, lê as abas "Promessas" e "Contatos" (já
 * pré-carregadas no HTML, confirmado; não precisa abrir aba como o Módulo 5)
 * e calcula:
 *
 *   1. Hoje é o dia combinado de alguma promessa (status ainda "Pendente").
 *   2. Alguma promessa venceu sem pagamento identificado ("Pendente" vencida,
 *      "Quebrada" ou "Parcial") e NÃO houve nenhum contato desde o vencimento.
 *      Confirmado: a mensagem é só no primeiro contato depois do vencimento,
 *      sem exigir dia útil e sem limite de dias passados.
 *   3. O contato mais recente foi efetivo e no último dia útil ("retomando o
 *      contato de ontem").
 *
 * Expõe window.__contextoAdicional (lido pelo Alt+A, Módulo 4) e
 * window.__contextoAdicionalDebug.
 *
 * Carga: anexado ao FINAL do smart-table.js, depois dos módulos 1 a 5.
 * Depende de window.__smartTableUtil (Módulo 0) e, para feriados e cruzar
 * títulos pendentes, de window.__avisoCobranca (Módulo 1); sem o Módulo 1
 * degrada com aviso no console.
 *
 * PREMISSAS NÃO CONFIRMADAS (revisar se o comportamento real divergir):
 *   - "Já houve contato desde o vencimento" conta QUALQUER contato registrado
 *     (efetivo ou não) posterior à data prometida.
 *   - "Título pendente" no caso Parcial é por cruzamento: título da promessa
 *     que sumiu da lista de abertos do Módulo 1 é considerado pago. Título
 *     renegociado/cancelado também vira "pago" -- risco aceito, sem dado
 *     para diferenciar.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__contextoAdicionalCarregado) return;
  window.__contextoAdicionalCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Contexto Adicional');

  // Módulo 0: precisa estar carregado ANTES deste arquivo no @require.
  const { normalizarData } = window.__smartTableUtil;

  // MANTER SINCRONIZADO MANUALMENTE com @version em smart-table.user.js. O
  // wrapper pode estar numa versão nova com os @require ainda em cache antigo;
  // este toast confirma qual versão carregou. Só este módulo faz o aviso.
  const VERSAO_SMARTTABLE = '1.70.0';

  // Cada módulo se anuncia no Módulo 0 (registrarModuloCarregado); aqui só se
  // LÊ o registro, sem lista própria de módulos (cópias locais já ficaram para
  // trás). Ver MODULOS_ESPERADOS no Módulo 0.
  function avisarVersaoCarregada() {
    const u = window.__smartTableUtil;
    const carregados = u?.modulosCarregados?.() ?? [];
    const faltando = u?.modulosFaltando?.() ?? [];
    const total = carregados.length + faltando.length;
    console.log(
      `%c[SmartTable] v${VERSAO_SMARTTABLE} carregado (${carregados.length}/${total} módulos)`,
      'color:#16232F;font-weight:bold;font-size:12px;'
    );
    if (faltando.length > 0) {
      console.warn(
        `[SmartTable] ${faltando.length} módulo(s) NÃO carregaram: ${faltando.join(', ')}. ` +
        'Pode ser cache antigo do Tampermonkey ou erro em um @require -- confira o console acima.'
      );
    }

    if (!document.body) return; // segurança extra, não deveria acontecer em document-idle

    const el = document.createElement('div');
    el.textContent = `SmartTable v${VERSAO_SMARTTABLE} ✓`;
    Object.assign(el.style, {
      position: 'fixed',
      // Abaixo do cabeçalho fixo do CRM e fora do menu lateral.
      top: `${(window.__smartTableUtil?.alturaCabecalho?.() ?? 0) + 16}px`,
      left: '16px',
      background: '#16232F',
      color: '#fff',
      padding: '6px 12px',
      borderRadius: '8px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      zIndex: 999999,
      opacity: '0',
      transition: 'opacity .25s ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    window.__smartTableUtil?.acompanharMenuLateral?.(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  avisarVersaoCarregada();

  const CONFIG_CONTEXTO = {
    SELETOR_ITEM_PROMESSA: '#content-promessas .promessa-item',
    SELETOR_ITEM_CONTATO: '#content-contatos .contato-item',
    STATUS_DIA_DA_PROMESSA: 'PENDENTE',
    // Decisão do usuário: "Pendente" vencida entra junto de "Quebrada" e
    // "Parcial" (o CRM às vezes não atualiza o status a tempo, mas o pagamento
    // combinado segue sem ser identificado). "Cumprida"/"Cumprida Parcial"
    // ficam de fora de propósito.
    STATUS_NAO_PAGAMENTO: ['PENDENTE', 'QUEBRADA', 'PARCIAL'],
    // Decisão do usuário: cliente com contatos, mas cujo mais recente é
    // ANTERIOR a esta data, recebe linha de apresentação extra (contatoAntigo).
    DATA_CORTE_CONTATO_ANTIGO: { ano: 2026, mes: 8, dia: 10 }, // 10/08/2026
    // Código do negociador no formato de data-usuario de cada .contato-item
    // (confirmado: "ISAAC.03876"). É só o FALLBACK: o usuário logado é lido
    // da página (lerUsuarioLogado). Não precisa trocar ao mudar de negociador:
    // a régua e o nome na mensagem saem do usuário logado de verdade.
    USUARIO_NEGOCIADOR: 'ISAAC.03876',
    // Âncora do usuário logado no header; confirmado que existe na lista e na
    // página de cliente e tem id próprio (classe Tailwind já nos traiu).
    SELETOR_BOTAO_USUARIO: '#user-menu-btn',
    // Formato do código do usuário dentro desse botão ("ISAAC.03876").
    REGEX_CODIGO_USUARIO: /^[A-Za-zÀ-ÿ0-9_-]+\.\d+$/,
  };

  /* ---------------------------------------------------------------------
   * 1. CALENDÁRIO -- feriados vêm do Módulo 1 (window.__avisoCobranca), mas
   * a direção "dia útil ANTERIOR" só existe aqui (o Módulo 1 só anda pra
   * frente).
   * --------------------------------------------------------------------- */
  function chaveData(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return ano + '-' + mes + '-' + dia;
  }

  function adicionarDias(data, quantidade) {
    const d = new Date(data);
    d.setDate(d.getDate() + quantidade);
    return normalizarData(d);
  }

  function mesmaData(a, b) {
    return !!(a && b && chaveData(a) === chaveData(b));
  }

  function obterFeriadosDoAno(ano) {
    if (window.__avisoCobranca && typeof window.__avisoCobranca.feriados === 'function') {
      try {
        return window.__avisoCobranca.feriados(ano);
      } catch (erro) {
        console.warn('[Contexto Adicional] Falha ao obter feriados do Módulo 1:', erro.message);
      }
    }
    return [];
  }

  function ehDiaUtil(data) {
    const diaSemana = data.getDay();
    if (diaSemana === 0 || diaSemana === 6) return false;
    return obterFeriadosDoAno(data.getFullYear()).indexOf(chaveData(data)) === -1;
  }

  // Sempre estritamente ANTES da data informada.
  function diaUtilAnterior(data) {
    let d = adicionarDias(data, -1);
    let guarda = 0;
    while (!ehDiaUtil(d)) {
      d = adicionarDias(d, -1);
      if (++guarda > 30) throw new Error('Não encontrei o dia útil anterior a ' + chaveData(data));
    }
    return d;
  }

  /**
   * No primeiro dia útil depois de fim de semana e/ou feriado, o cliente pode
   * ter pago sem o pagamento aparecer ainda no CRM; o Alt+A acrescenta uma
   * ressalva (ver obterRessalvaPagamentoEmDiaNaoUtil no Módulo 4).
   * Feriado em sábado/domingo conta como fim de semana. Sem o Módulo 1, só o
   * fim de semana é reconhecido.
   *
   * @param {Date} hoje
   * @returns {'no fim de semana'|'no feriado'|'no fim de semana ou no feriado'|null}
   *   null quando hoje não é dia útil ou quando ontem foi dia útil.
   */
  function periodoNaoUtilAntesDe(hoje) {
    if (!ehDiaUtil(hoje)) return null;
    let d = adicionarDias(hoje, -1);
    let fimDeSemana = false;
    let feriado = false;
    let guarda = 0;
    while (!ehDiaUtil(d)) {
      const diaSemana = d.getDay();
      if (diaSemana === 0 || diaSemana === 6) fimDeSemana = true;
      else feriado = true;
      d = adicionarDias(d, -1);
      if (++guarda > 30) return null;
    }
    if (fimDeSemana && feriado) return 'no fim de semana ou no feriado';
    if (fimDeSemana) return 'no fim de semana';
    if (feriado) return 'no feriado';
    return null;
  }

  function formatarDataBr(data) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    return dia + '/' + mes + '/' + data.getFullYear();
  }

  const NOMES_DIA_SEMANA = [
    'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado',
  ];

  function nomeDiaSemana(data) {
    return NOMES_DIA_SEMANA[data.getDay()];
  }

  function converterDataBr(texto) {
    // Aceita "26/08/2026" (promessa) ou "10/09/2026 16:08" (contato);
    // usa só a data.
    const m = (texto || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const [, dia, mes, ano] = m;
    return normalizarData(new Date(Number(ano), Number(mes) - 1, Number(dia)));
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA: PROMESSAS
   * --------------------------------------------------------------------- */
  function lerTitulosDoItem(item) {
    // Acha o container pelo texto do rótulo ("Títulos:"), não pela classe
    // Tailwind (mesmo princípio dos módulos 4 e 5).
    const containerTitulos = Array.from(item.querySelectorAll('div')).find((d) => {
      const rotulo = d.querySelector('span');
      return rotulo && rotulo.textContent.trim() === 'Títulos:';
    });
    if (!containerTitulos) return [];
    return Array.from(containerTitulos.querySelectorAll('span.bg-gray-100')).map((s) => s.textContent.trim());
  }

  // `raiz`: a página do cliente baixada por fetch (Alt+U sem abrir aba) tem o
  // mesmo HTML de Promessas/Contatos. Sem argumento, lê esta página.
  function lerPromessas(raiz = document) {
    const itens = raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_PROMESSA);
    return Array.from(itens)
      .map((item) => {
        // Confirmado no HTML real: "data-status" está num filho
        // (<div class="flex-1 cursor-pointer" data-status="PENDENTE">), não
        // no ".promessa-item"; item.dataset.status direto dá vazio.
        const elementoComStatus = item.querySelector('[data-status]');
        const status = ((elementoComStatus && elementoComStatus.dataset.status) || '').toUpperCase();
        const spanData = item.querySelector('p.text-xs.text-gray-500 span');
        const dataPrometidaTexto = spanData ? spanData.textContent.trim() : null;
        return {
          status,
          dataPrometidaTexto,
          dataPrometida: dataPrometidaTexto ? converterDataBr(dataPrometidaTexto) : null,
          titulos: lerTitulosDoItem(item),
        };
      })
      .filter((p) => p.dataPrometida); // descarta se não conseguiu ler a data
  }

  /* ---------------------------------------------------------------------
   * 3. LEITURA: CONTATO MAIS RECENTE
   * --------------------------------------------------------------------- */
  // Varre TODOS os ".contato-item" e escolhe a data mais recente: a ordem do
  // DOM não é confirmada, e assumir que o primeiro é o mais novo dava a mesma
  // linha "contato de ontem" para clientes contatados em dias diferentes.
  function lerContatoMaisRecente(raiz = document) {
    const itens = raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_CONTATO);
    let maisRecente = null;

    itens.forEach((item) => {
      const data = converterDataBr(item.dataset.data); // ex.: "10/09/2026 16:08"
      if (!data) return;
      if (!maisRecente || data.getTime() > maisRecente.data.getTime()) {
        maisRecente = { data, efetivo: item.dataset.efetivo === 'true' };
      }
    });

    return maisRecente;
  }

  // Histórico completo, para saber se JÁ houve contato depois do vencimento.
  // Inclui não efetivos de propósito (ver PREMISSAS no cabeçalho).
  function lerTodosContatos(raiz = document) {
    const itens = raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_CONTATO);
    return Array.from(itens)
      .map((item) => ({
        data: converterDataBr(item.dataset.data),
        efetivo: item.dataset.efetivo === 'true',
        // Quem registrou o contato (data-usuario, confirmado no HTML real).
        // Em maiúsculas: se o CRM mudar a caixa, a comparação com
        // USUARIO_NEGOCIADOR falharia em silêncio e o operador se apresentaria
        // para todo mundo.
        usuario: (item.dataset.usuario || '').trim().toUpperCase(),
      }))
      .filter((c) => c.data);
  }

  /* ---------------------------------------------------------------------
   * 4. CÁLCULO DO CONTEXTO DE HOJE
   * --------------------------------------------------------------------- */
  /**
   * @param {Date} hoje
   * @param {Document|Element} [raiz] página de onde ler (padrão: esta)
   * @param {Set<string>} [abertos] títulos ainda em aberto NAQUELA página
   *   (padrão: o Módulo 1 desta página)
   */
  function calcularContextoPromessa(hoje, raiz = document, abertos) {
    const promessas = lerPromessas(raiz);

    // O status da promessa no CRM ("Pendente") demora a virar "Cumprida"
    // depois da baixa. Confiar só nele trataria como ativa uma promessa já
    // paga: bloquearia o agradecimento (Módulo 4, via ctx.promessa) e diria
    // "hoje é o dia combinado" para título pago. Por isso cruza com os títulos
    // realmente abertos (Módulo 1).
    function temTituloAindaAberto(titulosDaPromessa) {
      return calcularTitulosPendentes(titulosDaPromessa, abertos).length > 0;
    }

    // Prioridade 1: promessa para hoje, ainda pendente.
    const paraHoje = promessas.find(
      (p) =>
        mesmaData(hoje, p.dataPrometida) &&
        p.status === CONFIG_CONTEXTO.STATUS_DIA_DA_PROMESSA &&
        temTituloAindaAberto(p.titulos)
    );
    if (paraHoje) return { tipo: 'DIA_DA_PROMESSA', promessa: paraHoje };

    // Prioridade 2: promessa vencida sem pagamento identificado. Confirmado:
    // cobra só se NENHUM contato foi registrado depois do vencimento,
    // independente de quantos dias (úteis ou não) passaram. Após o primeiro
    // contato pós-vencimento a mensagem some, mesmo com a promessa sem
    // resolução no CRM.
    const contatos = lerTodosContatos(raiz);
    const vencidasSemPagamento = promessas
      .filter(
        (p) =>
          CONFIG_CONTEXTO.STATUS_NAO_PAGAMENTO.indexOf(p.status) !== -1 &&
          p.dataPrometida.getTime() < hoje.getTime() &&
          // Promessa QUEBRADA/PARCIAL com TODOS os títulos já pagos está
          // resolvida (CRM sem atualizar o status).
          temTituloAindaAberto(p.titulos)
      )
      // A mais antiga primeiro: espera resposta há mais tempo.
      .sort((a, b) => a.dataPrometida.getTime() - b.dataPrometida.getTime());

    for (const p of vencidasSemPagamento) {
      const jaContatadoDepoisDoVencimento = contatos.some(
        (c) => c.data.getTime() > p.dataPrometida.getTime()
      );
      if (!jaContatadoDepoisDoVencimento) {
        // "Pendente" vencida usa a frase de "Quebrada": para o cliente é a
        // mesma situação.
        const tipo = p.status === 'PARCIAL' ? 'PARCIAL' : 'QUEBRADA';
        return { tipo, promessa: p };
      }
    }

    return null;
  }

  // Decisão do usuário: só vale quando o contato mais recente foi EXATAMENTE
  // o dia útil anterior. Intervalo maior puxava datas velhas e desconectadas
  // da cobrança atual ("retomando nosso contato de [data antiga]").
  function calcularContextoContato(hoje) {
    const contato = lerContatoMaisRecente();
    if (!contato || !contato.data || !contato.efetivo) return null;

    let diaAnterior;
    try {
      diaAnterior = diaUtilAnterior(hoje);
    } catch (erro) {
      return null;
    }

    if (!mesmaData(contato.data, diaAnterior)) return null;

    // "Ontem" só é literal quando o dia útil anterior é o dia de calendário
    // anterior. Após fim de semana ou feriado o Módulo 4 usa diaSemanaTexto
    // (ex.: "sexta-feira") em vez de "ontem".
    const ontemCalendario = adicionarDias(hoje, -1);

    // Decisão do usuário: se ontem já foi um recontato (havia contato no dia
    // útil anterior a ele), o relatório provavelmente já foi omitido ontem
    // (deveOmitirRelatorio, Módulo 4). Não omite 2+ dias seguidos.
    let recontatoConsecutivo = false;
    try {
      const diaAntesDoAnterior = diaUtilAnterior(diaAnterior);
      recontatoConsecutivo = lerTodosContatos().some((c) => mesmaData(c.data, diaAntesDoAnterior));
    } catch (erro) {
      recontatoConsecutivo = false;
    }

    return {
      data: contato.data,
      dataTexto: formatarDataBr(contato.data),
      ehOntemLiteral: mesmaData(contato.data, ontemCalendario),
      diaSemanaTexto: nomeDiaSemana(contato.data),
      recontatoConsecutivo,
    };
  }

  // Cruza os títulos da promessa com os que AINDA estão em aberto no Módulo 1;
  // o que sumiu presume-se pago (ver PREMISSAS no cabeçalho).
  function calcularTitulosPendentes(titulosDaPromessa, abertosInformados) {
    if (abertosInformados instanceof Set) return titulosDaPromessa.filter((t) => abertosInformados.has(t));
    if (!window.__avisoCobranca || typeof window.__avisoCobranca.simular !== 'function') {
      return titulosDaPromessa; // sem dado do Módulo 1, assume tudo pendente
    }
    try {
      const dados = window.__avisoCobranca.simular();
      const abertos = new Set(dados.registros.map((r) => r.tituloCompleto));
      return titulosDaPromessa.filter((t) => abertos.has(t));
    } catch (erro) {
      console.warn('[Contexto Adicional] Não foi possível cruzar títulos pendentes:', erro.message);
      return titulosDaPromessa;
    }
  }

  /* ---------------------------------------------------------------------
   * 4b. DETECÇÃO DE PAGAMENTO SEM PROMESSA (retrato de títulos vencidos)
   * -----------------------------------------------------------------
   * Decisão do usuário: título que sumiu da lista de vencidos desde a última
   * abertura da página (provavelmente pago) mantém o relatório no recontato;
   * deveOmitirRelatorio (Módulo 4) só detectava título NOVO.
   *
   * A coluna "Dt. pagamento" não é lida do CRM: exigiria trocar o filtro
   * visível da tabela para "Pagos", e a tabela é RECONSTRUÍDA por filtro
   * (mudaria a tela do operador). Em vez disso, guarda-se no localStorage,
   * por CNPJ, os títulos vencidos da última visita e compara-se com a atual.
   *
   * RISCO ACEITO: só funciona neste navegador (sem sincronia entre máquinas)
   * e é inferência (renegociação ou baixa manual também fazem o título
   * sumir). Não gera informação financeira errada: só decide SE o relatório é
   * reenviado; o conteúdo vem sempre dos dados ao vivo, nunca do retrato.
   * --------------------------------------------------------------------- */
  const CHAVE_SNAPSHOT_TITULOS = 'smarttable_snapshot_titulos_v1';
  // Entradas de clientes não revisitados há mais que isso são descartadas a
  // cada gravação, para o objeto no localStorage não crescer sem limite.
  const DIAS_EXPIRACAO_SNAPSHOT_TITULOS = 30;

  function obterCnpjDaPagina() {
    try {
      return new URLSearchParams(location.search).get('cnpj');
    } catch (erro) {
      return null;
    }
  }

  function lerSnapshotsTitulos() {
    try {
      const raw = localStorage.getItem(CHAVE_SNAPSHOT_TITULOS);
      const dados = raw ? JSON.parse(raw) : {};
      return dados && typeof dados === 'object' ? dados : {};
    } catch (erro) {
      console.warn('[Contexto Adicional] Não consegui ler o retrato de títulos do localStorage -- tratando como vazio.', erro);
      return {};
    }
  }

  function salvarSnapshotsTitulos(snapshots) {
    try {
      localStorage.setItem(CHAVE_SNAPSHOT_TITULOS, JSON.stringify(snapshots));
    } catch (erro) {
      console.warn('[Contexto Adicional] Não consegui salvar o retrato de títulos no localStorage.', erro);
    }
  }

  // Compara com o retrato da visita anterior ANTES de sobrescrevê-lo com o
  // atual (sempre as duas coisas juntas, nessa ordem) e aproveita para
  // descartar entradas antigas.
  // Retorna { houve, titulos }: titulos são os tituloCompleto que sumiram
  // (provavelmente pagos), para agradecer pelo número certo (ver
  // obterLinhaAgradecimentoPagamento no Módulo 4).
  function verificarESalvarSnapshotTitulos() {
    const cnpj = obterCnpjDaPagina();
    if (!cnpj) return { houve: false, titulos: [] };
    if (!window.__avisoCobranca || typeof window.__avisoCobranca.simular !== 'function') {
      return { houve: false, titulos: [] };
    }

    let dados;
    try {
      dados = window.__avisoCobranca.simular();
    } catch (erro) {
      return { houve: false, titulos: [] }; // tabela de títulos ainda não carregou nesta visita -- sem dado pra comparar
    }

    const titulosAtuais = dados.registros.map((r) => r.tituloCompleto);
    // Título que SAI da cobrança sem ser pago (acordo, CARTEIRA/NÃO COBRAR,
    // "fora do relatório") também some de `registros`; agradecer a "baixa"
    // dele seria errado. Só conta como sumido o que não está em NENHUMA lista
    // da tabela.
    const aindaNaTabela = new Set(
      [dados.registros, dados.emAcordo, dados.naoCobrar, dados.foraDoRelatorio]
        .flatMap((lista) => (Array.isArray(lista) ? lista : []))
        .map((r) => r?.tituloCompleto)
    );
    const snapshots = lerSnapshotsTitulos();
    const anterior = snapshots[cnpj];

    const sumidosAgora =
      anterior && Array.isArray(anterior.titulos)
        ? anterior.titulos.filter((t) => !aindaNaTabela.has(t))
        : [];

    // A comparação é destrutiva (o retrato é sobrescrito a cada carga) e o
    // agradecimento só é montado no Alt+A. Sem persistência, um F5 entre a
    // detecção e a cobrança apagaria a linha "Recebemos a baixa do título X".
    // Por isso a detecção fica "grudada" no retrato pelo resto do DIA. Não
    // precisa de limpeza: ao registrar o contato de hoje, contatoRecente vira
    // null e a linha sai sozinha (ver obterLinhaAgradecimentoPagamento no
    // Módulo 4).
    const hojeChave = chaveData(new Date());

    // Diário (Módulo 8): registra só o que sumiu AGORA, nunca o acumulado do
    // dia. Gravar `titulosSumidos` duplicaria o evento a cada recarga, e o
    // Alt+U visita cada cliente em aba de fundo.
    if (sumidosAgora.length > 0 && window.__diario) {
      window.__diario.registrar('baixa', { c: cnpj, tt: sumidosAgora });
    }
    const sumidosDeHoje =
      anterior && Array.isArray(anterior.sumidos) && anterior.sumidosEm === hojeChave
        ? anterior.sumidos
        : [];
    const titulosSumidos = [...new Set([...sumidosDeHoje, ...sumidosAgora])].filter((t) => !aindaNaTabela.has(t));

    const agora = Date.now();
    const limiteMs = DIAS_EXPIRACAO_SNAPSHOT_TITULOS * 24 * 60 * 60 * 1000;
    const snapshotsLimpos = {};
    Object.keys(snapshots).forEach((chaveCnpj) => {
      const entrada = snapshots[chaveCnpj];
      if (entrada && typeof entrada.salvoEm === 'number' && (agora - entrada.salvoEm) < limiteMs) {
        snapshotsLimpos[chaveCnpj] = entrada;
      }
    });
    snapshotsLimpos[cnpj] = {
      titulos: titulosAtuais,
      salvoEm: agora,
      // OPCIONAIS: retrato antigo ({titulos, salvoEm}) continua legível.
      sumidos: titulosSumidos,
      sumidosEm: hojeChave,
    };
    salvarSnapshotsTitulos(snapshotsLimpos);

    return { houve: titulosSumidos.length > 0, titulos: titulosSumidos };
  }

  // true quando há contato registrado e o mais recente é anterior à data de
  // corte (checar só o mais recente cobre "todos são anteriores").
  function calcularContatoAntigo(totalContatos) {
    if (totalContatos === 0) return false;
    const maisRecente = lerContatoMaisRecente();
    if (!maisRecente) return false;
    const { ano, mes, dia } = CONFIG_CONTEXTO.DATA_CORTE_CONTATO_ANTIGO;
    const dataCorte = normalizarData(new Date(ano, mes - 1, dia));
    return maisRecente.data.getTime() < dataCorte.getTime();
  }

  // Lê o código do usuário LOGADO do header do CRM. Confirmado: #user-menu-btn
  // existe na lista e na página de cliente e contém um <div> folha com o
  // código ("ISAAC.03876"); só um elemento bate o padrão NOME.NUMERO.
  // Devolve null se não achar (quem chama usa o fallback do CONFIG).
  function lerUsuarioLogado() {
    const botao = document.querySelector(CONFIG_CONTEXTO.SELETOR_BOTAO_USUARIO);
    if (!botao) return null;
    const codigo = Array.from(botao.querySelectorAll('div'))
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || '').trim())
      .find((texto) => CONFIG_CONTEXTO.REGEX_CODIGO_USUARIO.test(texto));
    return codigo ? codigo.toUpperCase() : null;
  }

  /**
   * Primeiro nome do negociador a partir do código do CRM.
   * Confirmado: a parte antes do ponto é o nome
   * ("ISAAC.03876" -> "Isaac", "BIANCA.03665" -> "Bianca").
   * @param {string|null|undefined} codigo Código no formato NOME.NUMERO.
   * @returns {string} Nome capitalizado, ou '' se o código não bater o formato.
   */
  function nomeDoNegociador(codigo) {
    const texto = (codigo ?? '').trim();
    if (!CONFIG_CONTEXTO.REGEX_CODIGO_USUARIO.test(texto)) return '';
    const nome = texto.split('.')[0];
    if (!nome) return '';
    return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
  }

  // Quem conta como "eu" na comparação com data-usuario: o usuário logado, com
  // o CONFIG só como fallback se a leitura do header falhar.
  // Avisa uma vez por carga quando o fallback é usado ou quando logado e
  // configurado divergem (não é erro, mas o operador deve saber que a sessão
  // não é a de sempre antes de enviar).
  let jaAvisouDivergenciaDeUsuario = false;
  let jaAvisouUsuarioIlegivel = false;
  function obterUsuarioNegociador() {
    const fixo = CONFIG_CONTEXTO.USUARIO_NEGOCIADOR.trim().toUpperCase();
    const logado = lerUsuarioLogado();
    if (!logado) {
      // Não cair no fallback calado: na máquina de outra pessoa a mensagem
      // sairia assinada com o nome do fallback sem ninguém saber.
      if (!jaAvisouUsuarioIlegivel) {
        jaAvisouUsuarioIlegivel = true;
        console.warn(
          `[Contexto Adicional] Não consegui ler o usuário logado (${CONFIG_CONTEXTO.SELETOR_BOTAO_USUARIO}). ` +
          `Usando "${fixo}" -- as mensagens vão se apresentar como "${nomeDoNegociador(fixo)}". ` +
          'Confira antes de enviar se não for você.'
        );
      }
      return fixo;
    }
    if (logado !== fixo && !jaAvisouDivergenciaDeUsuario) {
      jaAvisouDivergenciaDeUsuario = true;
      console.warn(
        `[Contexto Adicional] Usuário logado ("${logado}") é diferente do configurado ("${fixo}"). ` +
        `As mensagens vão se apresentar como "${nomeDoNegociador(logado)}" e a régua de "nunca contatado ` +
        'por mim" vai seguir esse usuário -- confira se é essa a sessão que você quer usar.'
      );
    }
    return logado;
  }

  // Cliente COM contato registrado, mas nenhum feito pelo usuário logado: é o
  // primeiro contato DELE, então cabe se apresentar. Cliente com ZERO contatos
  // fica de fora de propósito: já tem mensagem própria (semContatoAnterior),
  // que também se apresenta; contar os dois duplicaria a apresentação.
  // Decisão do usuário: convive com contatoAntigo ("as duas devem coexistir");
  // aqui é "nunca falei com você", lá é "faz muito tempo".
  function calcularNuncaContatadoPorMim(totalContatos) {
    if (totalContatos === 0) return false;
    const contatos = lerTodosContatos();
    if (contatos.length === 0) return false;
    // Os dois lados em maiúsculas (ver lerTodosContatos).
    const eu = obterUsuarioNegociador();
    return !contatos.some((c) => c.usuario === eu);
  }

  // Confirmado: promessa datada no mesmo dia do último contato, QUALQUER que
  // seja o status atual (mesmo paga/resolvida, fora de calcularContextoPromessa),
  // indica que o cliente retornou naquele contato; "retomando o contato de
  // ontem, já que ainda não obtivemos retorno" ficaria errado.
  function houvePromessaNaDataDoUltimoContato(contatoRecente) {
    if (!contatoRecente || !contatoRecente.data) return false;
    const promessas = lerPromessas();
    return promessas.some((p) => mesmaData(p.dataPrometida, contatoRecente.data));
  }

  /**
   * Nome do negociador sem lançar: usa o logado e só cai no CONFIG se a
   * leitura falhar. Assinar sempre com o CONFIG faria a mensagem sair com o
   * nome errado na máquina de outro operador (falha no cálculo ou espera de
   * 5 s estourada).
   * @returns {string}
   */
  function nomeDoNegociadorSemFalhar() {
    try {
      return nomeDoNegociador(obterUsuarioNegociador());
    } catch (erro) {
      console.warn('[Contexto Adicional] Falha ao ler o usuário logado:', erro?.name);
      return nomeDoNegociador(CONFIG_CONTEXTO.USUARIO_NEGOCIADOR);
    }
  }

  /**
   * Contexto "neutro": mesma forma de calcularContexto(), com todas as regras
   * desligadas. Usado quando não dá pra calcular (erro, ou página sem as abas).
   * Único literal do fallback: campo novo se acrescenta aqui e em
   * calcularContexto(); esquecer aqui faz o Módulo 4 receber `undefined` no
   * caminho de fallback, sem teste que pegue.
   * @returns {object}
   */
  function contextoVazio() {
    return {
      promessa: null,
      contatoRecente: null,
      houvePromessaNoUltimoContato: false,
      houveTituloPagoDesdeUltimaVisita: false,
      titulosPagosDesdeUltimaVisita: [],
      semContatoAnterior: false,
      contatoAntigo: false,
      nuncaContatadoPorMim: false,
      periodoNaoUtilAntesDeHoje: null,
      nomeNegociador: nomeDoNegociadorSemFalhar(),
      calcularTitulosPendentes,
    };
  }

  function calcularContexto() {
    const hoje = normalizarData(new Date());
    const totalContatos = document.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_CONTATO).length;
    const contatoRecente = calcularContextoContato(hoje);
    const infoPagamento = verificarESalvarSnapshotTitulos();
    return {
      promessa: calcularContextoPromessa(hoje),
      contatoRecente,
      houvePromessaNoUltimoContato: houvePromessaNaDataDoUltimoContato(contatoRecente),
      houveTituloPagoDesdeUltimaVisita: infoPagamento.houve,
      titulosPagosDesdeUltimaVisita: infoPagamento.titulos,
      semContatoAnterior: totalContatos === 0,
      contatoAntigo: calcularContatoAntigo(totalContatos),
      nuncaContatadoPorMim: calcularNuncaContatadoPorMim(totalContatos),
      periodoNaoUtilAntesDeHoje: periodoNaoUtilAntesDe(hoje),
      // Nome de quem está logado, pra mensagem do Alt+A se apresentar certo.
      nomeNegociador: nomeDoNegociador(obterUsuarioNegociador()),
      calcularTitulosPendentes,
    };
  }

  /* ---------------------------------------------------------------------
   * 5. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  /**
   * O que o log do contexto pode mostrar: tipos, sim/não e contagens.
   * LISTA FECHADA de propósito (privacidade): nunca espalhar `...ctx`, que
   * vazaria números de títulos e datas prometidas. Campo novo só aparece
   * aqui se alguém o puser na lista.
   * @param {object|null|undefined} ctx Contexto calculado.
   * @returns {object} Resumo sem dado de cliente.
   */
  function resumoDoContextoParaLog(ctx) {
    return {
      promessa: ctx?.promessa?.tipo ?? null,
      titulosDaPromessa: ctx?.promessa?.promessa?.titulos?.length ?? 0,
      contatoRecente: Boolean(ctx?.contatoRecente),
      contatoRecenteEfetivo: ctx?.contatoRecente?.efetivo ?? null,
      houvePromessaNoUltimoContato: Boolean(ctx?.houvePromessaNoUltimoContato),
      houveTituloPagoDesdeUltimaVisita: Boolean(ctx?.houveTituloPagoDesdeUltimaVisita),
      titulosPagosDesdeUltimaVisita: ctx?.titulosPagosDesdeUltimaVisita?.length ?? 0,
      semContatoAnterior: Boolean(ctx?.semContatoAnterior),
      contatoAntigo: Boolean(ctx?.contatoAntigo),
      nuncaContatadoPorMim: Boolean(ctx?.nuncaContatadoPorMim),
      periodoNaoUtilAntesDeHoje: Boolean(ctx?.periodoNaoUtilAntesDeHoje),
      negociadorLido: Boolean(ctx?.nomeNegociador),
    };
  }

  function montarEExpor() {
    try {
      window.__contextoAdicional = calcularContexto();
      console.log('[Contexto Adicional] Calculado:', resumoDoContextoParaLog(window.__contextoAdicional));
    } catch (erro) {
      console.warn('[Contexto Adicional] Falha ao calcular -- Alt+A segue funcionando sem essas linhas extras:', erro.message);
      window.__contextoAdicional = contextoVazio();
    }
  }

  function aguardarConteudoEExecutar() {
    // Confirmado: Promessas/Contatos já vêm pré-carregados no HTML (diferente
    // do Grupo, no Módulo 5). O observer é só rede de segurança.
    if (document.getElementById('content-promessas') && document.getElementById('content-contatos')) {
      montarEExpor();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.getElementById('content-promessas') && document.getElementById('content-contatos')) {
        observer.disconnect();
        montarEExpor();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      if (!window.__contextoAdicional) {
        console.warn(
          '[Contexto Adicional] Containers de Promessas/Contatos não encontrados nesta página -- normal fora da tela de cliente.'
        );
        window.__contextoAdicional = contextoVazio();
      }
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aguardarConteudoEExecutar);
  } else {
    aguardarConteudoEExecutar();
  }

  // Hooks de depuração (mesmo padrão de window.filaDebug no Módulo 3 e de
  // window.__avisoCobranca no Módulo 1). Rodar no console da página do cliente:
  //   window.__contextoAdicionalDebug.lerPromessas()
  //     -> status, data e títulos extraídos de cada .promessa-item. Array
  //        vazio ou dataPrometida:null = seletor não bateu com o DOM.
  //   window.__contextoAdicionalDebug.calcularContextoPromessa(new Date())
  //     -> decisão final (DIA_DA_PROMESSA / QUEBRADA / PARCIAL / null).
  /**
   * O que a fila por prioridade (Módulo 7) lê de uma aba de cliente, a partir
   * da página BAIXADA (Alt+U sem abrir aba): mesmas funções da tela, com a
   * página baixada como raiz e os títulos em aberto DELA.
   *
   * @param {Document} raiz página do cliente (DOMParser)
   * @param {object[]} registrosAbertos registros do Módulo 1 daquela página
   * @param {Date} [hoje]
   */
  function contextoDaPaginaBaixada(raiz, registrosAbertos, hoje = normalizarData(new Date())) {
    const abertos = new Set((registrosAbertos || []).map((r) => r.tituloCompleto));
    return {
      __contextoAdicional: {
        promessa: calcularContextoPromessa(hoje, raiz, abertos),
        semContatoAnterior: raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_CONTATO).length === 0,
      },
      __contextoAdicionalDebug: {
        lerPromessas: () => lerPromessas(raiz),
        lerContatoMaisRecente: () => lerContatoMaisRecente(raiz),
      },
    };
  }

  window.__contextoAdicionalDebug = {
    contextoDaPaginaBaixada,
    lerPromessas,
    lerContatoMaisRecente,
    lerTodosContatos,
    calcularContextoPromessa,
    calcularContextoContato,
    calcularContatoAntigo,
    calcularNuncaContatadoPorMim,
    periodoNaoUtilAntesDe,
    lerUsuarioLogado,
    obterUsuarioNegociador,
    nomeDoNegociador,
    CHAVE_SNAPSHOT_TITULOS,
    DIAS_EXPIRACAO_SNAPSHOT_TITULOS,
    lerSnapshotsTitulos,
    salvarSnapshotsTitulos,
    verificarESalvarSnapshotTitulos,
    obterCnpjDaPagina,
    contextoVazio,
    calcularContexto,
  };
})();
