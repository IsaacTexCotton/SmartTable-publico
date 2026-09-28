/* =========================================================================
 * MÓDULO 6: CONTEXTO ADICIONAL (Promessas + Contato Recente) — CRM TexCotton
 * -------------------------------------------------------------------------
 * O que faz: ao entrar na página do cliente, lê as abas "Promessas" e
 * "Contatos" (que já vêm pré-carregadas no HTML, confirmado -- não precisa
 * abrir aba igual ao Módulo 5) e calcula:
 *
 *   1. Se hoje é o dia combinado de alguma promessa de pagamento (status
 *      ainda "Pendente").
 *   2. Se alguma promessa já venceu (status "Pendente" vencida, "Quebrada"
 *      ou "Parcial" -- pro cliente dá na mesma: o pagamento combinado não
 *      foi identificado) E ainda não houve NENHUM contato registrado desde
 *      o vencimento. CONFIRMADO com o usuário: a mensagem é só no primeiro
 *      contato depois que a promessa vence -- não um dia específico (nem
 *      precisa ser dia útil), e sem limite de quantos dias já se passaram.
 *      Não repete em toda visita seguinte, só até o primeiro contato
 *      registrado depois do vencimento.
 *   3. Se o contato mais recente do cliente foi no último dia útil (e foi
 *      efetivo), pra permitir uma linha de "retomando o contato de ontem".
 *
 * O resultado fica em window.__contextoAdicional, pronto pra ser consultado
 * pelo Alt+A (Módulo 4) sem precisar trocar de aba na hora do atalho.
 *
 * Onde colar: anexado ao FINAL do smart-table.js, depois dos módulos 1 a 5.
 * Depende só de window.__avisoCobranca (Módulo 1) pra feriados e pra cruzar
 * títulos pendentes -- se ele não estiver carregado, degrada com avisos no
 * console em vez de quebrar.
 *
 * PREMISSAS AINDA NÃO CONFIRMADAS COM O USUÁRIO (documentadas de propósito,
 * revisar se o comportamento real divergir):
 *   - "Já houve contato desde o vencimento" conta QUALQUER contato
 *     registrado (efetivo ou não) com data posterior à data prometida --
 *     não só contato efetivo. Decisão: uma tentativa de contato já
 *     registrada é suficiente pra não repetir o lembrete, mesmo sem
 *     resposta do cliente. Revisar se o usuário preferir outro critério.
 *   - "Título pendente" no caso Parcial é calculado por cruzamento: título
 *     da promessa que já não aparece mais na lista de abertos do Módulo 1
 *     é considerado pago. Isso também classificaria como "pago" um título
 *     renegociado/cancelado por outro motivo -- risco aceito, não há como
 *     diferenciar com o dado disponível hoje.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__contextoAdicionalCarregado) return;
  window.__contextoAdicionalCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Contexto Adicional');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  const { normalizarData } = window.__smartTableUtil;

  // Confirmação visual de que a versão certa carregou -- resposta direta pro
  // problema de "o Tampermonkey atualizou mesmo?" que já causou confusão
  // (o wrapper pode estar em @version novo enquanto os @require ainda estão
  // em cache antigo). MANTER SINCRONIZADO MANUALMENTE com @version em
  // smart-table.user.js a cada bump -- é o único módulo que faz esse aviso,
  // de propósito, pra não repetir o toast em cada um dos 6 módulos.
  const VERSAO_SMARTTABLE = '1.46.4';

  // Cada módulo se anuncia sozinho no Módulo 0 (registrarModuloCarregado,
  // mesma linha em que já seta sua própria flag de "já carreguei") -- este
  // arquivo só LÊ o registro, não mantém uma lista própria dele.
  //
  // HISTÓRICO: até a v1.22.x este arquivo tinha uma cópia própria
  // (FLAGS_DOS_MODULOS) das flags de todos os módulos, e ela ficou pra trás
  // duas vezes na mesma sessão de manutenção (o Módulo 11 nunca entrou
  // nela). Antes disso, o total também já tinha sido fixo no código ("7
  // módulos"), e igualmente ficou pra trás. Os dois eram o mesmo problema:
  // uma verdade sobre "quais módulos existem" copiada num arquivo que não
  // tem nada a ver com o módulo novo sendo criado. Ver Módulo 0
  // (MODULOS_ESPERADOS / registrarModuloCarregado) pro porquê disso não
  // resolver 100% sozinho -- ainda precisa de um humano lembrando de
  // chamar a função no módulo novo -- mas move o lugar certo de editar pra
  // dentro do próprio arquivo do módulo, e avisa na hora se o nome não
  // bater.
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
      // Abaixo do cabeçalho fixo do CRM e fora do menu lateral (v1.38.0):
      // antes ficava a 16px do canto, por cima dos dois.
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
    // Qualquer um destes remete a "não pagamento" pro cliente -- CONFIRMADO
    // com o usuário que "Pendente" vencida entra junto de "Quebrada" e
    // "Parcial" (o CRM às vezes não atualiza o status a tempo, mas o
    // pagamento combinado segue sem ser identificado do mesmo jeito).
    // "Cumprida"/"Cumprida Parcial" ficam de fora de propósito (resolvidas).
    STATUS_NAO_PAGAMENTO: ['PENDENTE', 'QUEBRADA', 'PARCIAL'],
    // CONFIRMADO com o usuário: cliente com pelo menos um contato registrado,
    // mas cujo contato mais recente é ANTERIOR a essa data (ou seja, todos
    // os contatos são anteriores -- checar só o mais recente já cobre isso),
    // recebe uma linha de apresentação extra na mensagem (ver contatoAntigo).
    DATA_CORTE_CONTATO_ANTIGO: { ano: 2026, mes: 8, dia: 10 }, // 10/08/2026
    // Código do negociador dono desta carteira, no formato que o CRM grava
    // em data-usuario de cada .contato-item (confirmado ao vivo:
    // "ISAAC.03876", "BIANCA.03665"). Cliente já contatado por OUTRA pessoa
    // mas nunca por este usuário recebe a linha de apresentação (ver
    // nuncaContatadoPorMim) -- é o primeiro contato DELE com o cliente,
    // mesmo que o cliente já conheça a empresa.
    //
    // Este valor é só o FALLBACK: o usuário logado é lido da própria página
    // (ver lerUsuarioLogado) e só cai aqui se a leitura falhar. Serve também
    // de referência pra avisar no console quando a sessão logada não é a de
    // sempre.
    //
    // NÃO precisa ser trocado ao mudar de negociador: tanto a régua quanto o
    // nome que aparece na mensagem ("Sou Isaac do financeiro...", ver
    // nomeDoNegociador) saem do usuário logado de verdade.
    USUARIO_NEGOCIADOR: 'ISAAC.03876',
    // Âncora do usuário logado no header do CRM -- confirmado ao vivo que
    // existe tanto na lista quanto na página de cliente, e que tem id
    // próprio (nada de classe Tailwind, que já nos traiu neste projeto).
    SELETOR_BOTAO_USUARIO: '#user-menu-btn',
    // Formato do código do usuário dentro desse botão ("ISAAC.03876").
    REGEX_CODIGO_USUARIO: /^[A-Za-zÀ-ÿ0-9_-]+\.\d+$/,
  };

  /* ---------------------------------------------------------------------
   * 1. CALENDÁRIO -- reaproveita feriados do Módulo 1 (window.__avisoCobranca),
   * mas precisa da direção "dia útil ANTERIOR", que não existe lá (Módulo 1
   * só tem "a partir de"/"próximo", sempre pra frente no tempo).
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

  // Sempre estritamente ANTES da data informada -- direção nova que o
  // Módulo 1 não tem (só anda pra frente no tempo).
  function diaUtilAnterior(data) {
    let d = adicionarDias(data, -1);
    let guarda = 0;
    while (!ehDiaUtil(d)) {
      d = adicionarDias(d, -1);
      if (++guarda > 30) throw new Error('Não encontrei o dia útil anterior a ' + chaveData(data));
    }
    return d;
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
    // Aceita "26/08/2026" (promessa) ou "10/09/2026 16:08" (contato) --
    // usa só a parte da data, ignora hora se vier.
    const m = (texto || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const [, dia, mes, ano] = m;
    return normalizarData(new Date(Number(ano), Number(mes) - 1, Number(dia)));
  }

  /* ---------------------------------------------------------------------
   * 2. LEITURA: PROMESSAS
   * --------------------------------------------------------------------- */
  function lerTitulosDoItem(item) {
    // Procura o container pelo texto do rótulo ("Títulos:"), não pela
    // classe Tailwind -- mais resistente a mudança de estilo, mesmo
    // princípio já usado nos módulos 4 e 5 pra achar elemento por texto.
    const containerTitulos = Array.from(item.querySelectorAll('div')).find((d) => {
      const rotulo = d.querySelector('span');
      return rotulo && rotulo.textContent.trim() === 'Títulos:';
    });
    if (!containerTitulos) return [];
    return Array.from(containerTitulos.querySelectorAll('span.bg-gray-100')).map((s) => s.textContent.trim());
  }

  // `raiz` (v1.45.0): a página do cliente BAIXADA por fetch (Alt+U sem abrir
  // aba) tem o mesmo HTML de Promessas/Contatos -- mesma leitura, outra raiz.
  // Sem argumento, lê esta página, como sempre.
  function lerPromessas(raiz = document) {
    const itens = raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_PROMESSA);
    return Array.from(itens)
      .map((item) => {
        // CONFIRMADO com outerHTML real: "data-status" não está no próprio
        // ".promessa-item", está num filho (<div class="flex-1 cursor-pointer"
        // data-status="PENDENTE" ...>). Ler item.dataset.status direto sempre
        // dava vazio -- por isso a linha de promessa nunca aparecia, mesmo com
        // data e títulos lidos certinho.
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
  // Varre TODOS os ".contato-item" e escolhe o de data mais recente, em vez
  // de confiar que o primeiro do DOM já é o mais novo -- essa suposição não
  // era confirmada (ver nota no cabeçalho do arquivo) e causava inconsistência
  // real: clientes contatados em dias diferentes (ex.: quinta e sexta)
  // acabavam recebendo a mesma linha "contato de ontem", porque o item
  // pego não era de fato o contato mais recente de cada um.
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

  // Histórico completo (não só o mais recente) -- necessário pra saber se
  // JÁ houve algum contato depois do vencimento de uma promessa, não só
  // qual foi o último. Inclui contatos não efetivos de propósito (ver nota
  // "PREMISSA AINDA NÃO CONFIRMADA" no cabeçalho do arquivo).
  function lerTodosContatos(raiz = document) {
    const itens = raiz.querySelectorAll(CONFIG_CONTEXTO.SELETOR_ITEM_CONTATO);
    return Array.from(itens)
      .map((item) => ({
        data: converterDataBr(item.dataset.data),
        efetivo: item.dataset.efetivo === 'true',
        // Quem registrou o contato ("ISAAC.03876", "BIANCA.03665") --
        // confirmado ao vivo no HTML real (data-usuario). Normalizado em
        // maiúsculas igual ao status da promessa logo acima: se o CRM um dia
        // mudar a caixa do código, a comparação com USUARIO_NEGOCIADOR
        // falharia em silêncio e eu me apresentaria pra todo mundo.
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

    // BUG REAL (relatado pelo usuário): cliente cumpriu a promessa (título
    // já tinha sumido da lista de abertos do Módulo 1, baixa lançada), mas
    // a frase de agradecimento não apareceu -- porque o status da promessa
    // no CRM ("Pendente") ainda não tinha sido atualizado pra "Cumprida"
    // no instante da mensagem (o CRM não atualiza isso na hora). Essa
    // promessa "tecnicamente pendente" continuava sendo tratada como ativa
    // aqui, bloqueando obterLinhaAgradecimentoPagamento (Módulo 4) via
    // ctx.promessa -- e pior, teria mostrado "hoje é o dia combinado" pra
    // um título que JÁ foi pago. CORRIGIDO: cruza com os títulos ainda
    // abertos de verdade (Módulo 1, mesma fonte que calcularTitulosPendentes
    // já usa pro caso Parcial) antes de considerar qualquer promessa ativa
    // -- confiar no status do CRM sozinho não é suficiente.
    function temTituloAindaAberto(titulosDaPromessa) {
      return calcularTitulosPendentes(titulosDaPromessa, abertos).length > 0;
    }

    // Prioridade 1: alguma promessa é justamente pra hoje (e ainda não foi
    // resolvida antes da hora -- só faz sentido lembrar se ainda pendente).
    const paraHoje = promessas.find(
      (p) =>
        mesmaData(hoje, p.dataPrometida) &&
        p.status === CONFIG_CONTEXTO.STATUS_DIA_DA_PROMESSA &&
        temTituloAindaAberto(p.titulos)
    );
    if (paraHoje) return { tipo: 'DIA_DA_PROMESSA', promessa: paraHoje };

    // Prioridade 2: alguma promessa já venceu (data prometida no passado) e
    // continua sem pagamento identificado (Pendente vencida, Quebrada ou
    // Parcial). CONFIRMADO com o usuário: não é "só no dia útil seguinte" --
    // é "só no primeiro contato depois do vencimento", não importa quantos
    // dias (úteis ou não) já se passaram. Por isso cobra se NENHUM contato
    // foi registrado com data posterior ao vencimento; assim que o primeiro
    // contato pós-vencimento é registrado, a mensagem para de aparecer nas
    // visitas seguintes (mesmo que a promessa continue sem resolução no CRM).
    const contatos = lerTodosContatos(raiz);
    const vencidasSemPagamento = promessas
      .filter(
        (p) =>
          CONFIG_CONTEXTO.STATUS_NAO_PAGAMENTO.indexOf(p.status) !== -1 &&
          p.dataPrometida.getTime() < hoje.getTime() &&
          // Mesma correção do caso "paraHoje" acima: só considera ativa se
          // sobrar pelo menos 1 título ainda aberto de verdade -- uma
          // promessa QUEBRADA/PARCIAL com TODOS os títulos já pagos (CRM
          // sem atualizar o status a tempo) está de fato resolvida.
          temTituloAindaAberto(p.titulos)
      )
      // Promessa mais antiga primeiro -- a que está esperando resposta há
      // mais tempo é a mais relevante quando há mais de uma vencida.
      .sort((a, b) => a.dataPrometida.getTime() - b.dataPrometida.getTime());

    for (const p of vencidasSemPagamento) {
      const jaContatadoDepoisDoVencimento = contatos.some(
        (c) => c.data.getTime() > p.dataPrometida.getTime()
      );
      if (!jaContatadoDepoisDoVencimento) {
        // "Pendente" vencida usa a mesma frase de "Quebrada" -- pro cliente
        // é a mesma situação (pagamento combinado não identificado), o CRM
        // só não atualizou o status ainda.
        const tipo = p.status === 'PARCIAL' ? 'PARCIAL' : 'QUEBRADA';
        return { tipo, promessa: p };
      }
    }

    return null;
  }

  // REVERTIDO (confirmado com o usuário): a tentativa de reconhecer
  // recontato com intervalo maior que "ontem" (dia útil anterior) estava
  // puxando datas velhas demais, sem relação com a cobrança atual --
  // "retomando nosso contato de [data antiga]" ficava estranho e
  // desconectado do que estava sendo cobrado agora. Volta a valer só
  // quando o contato mais recente foi EXATAMENTE o dia útil anterior.
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

    // "Ontem" só é literalmente verdade quando o dia útil anterior cai no
    // dia de calendário anterior (terça a sexta, sem feriado no meio). Numa
    // segunda-feira -- ou terça após feriado na segunda -- o dia útil
    // anterior pula um fim de semana e "ontem" fica incorreto; nesses casos
    // o Módulo 4 usa diaSemanaTexto (ex.: "sexta-feira") em vez de "ontem".
    const ontemCalendario = adicionarDias(hoje, -1);

    // MELHORIA (confirmada pelo usuário): se o contato de ontem (dia útil
    // anterior) já foi, ele próprio, precedido por outro contato no dia
    // útil anterior a ele -- ou seja, ontem já era um recontato -- o
    // relatório provavelmente já tinha sido omitido ontem também (ver
    // deveOmitirRelatorio no Módulo 4). Hoje não repete essa omissão por
    // 2+ dias seguidos: volta a enviar o relatório atualizado, mesmo sem
    // título novo.
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

  // Cruza os títulos de uma promessa com os títulos que AINDA aparecem em
  // aberto no Módulo 1 -- o que sumiu da lista, presumimos pago (ver
  // ressalva no cabeçalho do arquivo sobre esse presumível).
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
   * CONFIRMADO com o usuário: se um título sumiu da lista de vencidos
   * desde a última vez que esta página foi aberta (bem provavelmente
   * porque foi pago), o relatório deve continuar sendo enviado no
   * recontato -- deveOmitirRelatorio (Módulo 4) só detectava título
   * NOVO, não título que sumiu.
   *
   * Não há como ler a coluna "Dt. pagamento" direto do CRM sem trocar o
   * filtro visível da tabela de títulos pra "Pagos" (investigado com o
   * usuário: a tabela é RECONSTRUÍDA por filtro, não é só esconder
   * linhas -- mexer nisso trocaria o que está na tela do operador).
   * Alternativa combinada com o usuário: guardamos no localStorage, por
   * CNPJ, quais títulos estavam vencidos na última vez que a página foi
   * aberta, e comparamos com a visita atual.
   *
   * RISCO ACEITO (avisado ao usuário): só funciona neste navegador/
   * computador -- não sincroniza entre máquinas -- e é uma inferência (o
   * título pode ter sumido por outro motivo, não só pagamento -- ex.:
   * renegociação, baixa manual). Mas nunca gera informação financeira
   * ERRADA: isso só decide SE o relatório é reenviado -- o conteúdo do
   * relatório em si sempre é montado com os dados ao vivo da página no
   * momento do envio, nunca a partir do retrato salvo.
   * --------------------------------------------------------------------- */
  const CHAVE_SNAPSHOT_TITULOS = 'smarttable_snapshot_titulos_v1';
  // Entradas de clientes não revisitados há mais que isso são descartadas
  // a cada gravação -- sem isso, o objeto no localStorage só cresce.
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

  // Compara com o retrato salvo da visita anterior (se houver) ANTES de
  // sobrescrever com o retrato atual -- sempre roda as duas coisas juntas,
  // nessa ordem. Aproveita a gravação pra descartar entradas antigas de
  // outros clientes.
  // Retorna { houve, titulos } -- titulos é a lista dos tituloCompleto que
  // sumiram desde o retrato anterior (provavelmente pagos), pra dar pra
  // agradecer o pagamento pelo número certo em vez de só um boolean genérico
  // (ver obterLinhaAgradecimentoPagamento no Módulo 4).
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
    const snapshots = lerSnapshotsTitulos();
    const anterior = snapshots[cnpj];

    const sumidosAgora =
      anterior && Array.isArray(anterior.titulos)
        ? anterior.titulos.filter((t) => titulosAtuais.indexOf(t) === -1)
        : [];

    // BUG REAL (achado em revisão, com repro): a comparação é destrutiva --
    // toda vez que a página CARREGA, o retrato é sobrescrito. Como o
    // agradecimento de pagamento só é montado quando o operador aperta
    // Alt+A, bastava um F5 (ou sair e voltar pra página do cliente) entre a
    // detecção e a cobrança pra linha "Recebemos a baixa do título X,
    // obrigado!" sumir pra sempre -- o segundo carregamento comparava contra
    // o retrato já atualizado pelo primeiro e não via mais nada sumido.
    //
    // Correção: a detecção fica "grudada" no retrato pelo resto do DIA em
    // que aconteceu, então recarregar a página quantas vezes for não apaga
    // mais nada. Não precisa de limpeza explícita: o agradecimento só sai
    // quando contatoRecente existe (último contato = dia útil anterior), e
    // no instante em que o operador registra o contato de hoje o contato
    // mais recente passa a ser HOJE, contatoRecente vira null e a linha sai
    // de cena sozinha (ver obterLinhaAgradecimentoPagamento no Módulo 4).
    const hojeChave = chaveData(new Date());

    // DIÁRIO (Módulo 8): registra só o que sumiu AGORA, nunca o acumulado do
    // dia. A detecção fica grudada no retrato pelo resto do dia (ver acima),
    // então gravar `titulosSumidos` aqui geraria um evento duplicado a cada
    // recarregamento da página -- e o Alt+U visita cada cliente em aba de
    // fundo, o que multiplicaria isso ainda mais.
    if (sumidosAgora.length > 0 && window.__diario) {
      window.__diario.registrar('baixa', { c: cnpj, tt: sumidosAgora });
    }
    const sumidosDeHoje =
      anterior && Array.isArray(anterior.sumidos) && anterior.sumidosEm === hojeChave
        ? anterior.sumidos
        : [];
    const titulosSumidos = [...new Set([...sumidosDeHoje, ...sumidosAgora])];

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
      // Campos novos e OPCIONAIS -- retrato gravado por uma versão anterior
      // (só {titulos, salvoEm}) continua sendo lido sem erro, então não há
      // quebra de formato salvo.
      sumidos: titulosSumidos,
      sumidosEm: hojeChave,
    };
    salvarSnapshotsTitulos(snapshotsLimpos);

    return { houve: titulosSumidos.length > 0, titulos: titulosSumidos };
  }

  // true quando há pelo menos um contato registrado, mas o mais recente
  // deles é anterior à data de corte -- checar só o mais recente já cobre
  // "todos são anteriores", já que por definição nenhum outro pode ser
  // mais novo que ele.
  function calcularContatoAntigo(totalContatos) {
    if (totalContatos === 0) return false;
    const maisRecente = lerContatoMaisRecente();
    if (!maisRecente) return false;
    const { ano, mes, dia } = CONFIG_CONTEXTO.DATA_CORTE_CONTATO_ANTIGO;
    const dataCorte = normalizarData(new Date(ano, mes - 1, dia));
    return maisRecente.data.getTime() < dataCorte.getTime();
  }

  // Lê o código do usuário LOGADO direto do header do CRM, em vez de
  // confiar num valor fixo no código. Confirmado ao vivo: o botão
  // #user-menu-btn existe na lista E na página de cliente, e contém um
  // <div> folha com o código ("ISAAC.03876") -- só um elemento da página
  // bate o padrão NOME.NUMERO, então não há ambiguidade.
  // Devolve null se não achar (aí quem chama usa o fallback do CONFIG).
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
   * CONFIRMADO com o usuário: a parte antes do ponto é o nome da pessoa
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

  // Quem conta como "eu" na comparação com o data-usuario dos contatos:
  // o usuário logado de verdade, com o valor do CONFIG como fallback só
  // quando a leitura do header falha (ver lerUsuarioLogado).
  //
  // Avisa (uma vez por carga de página) quando os dois divergem -- não é
  // erro (a régua E o nome na mensagem seguem o logado), mas é bom saber
  // que a sessão não é a de sempre antes de sair mandando mensagem.
  let jaAvisouDivergenciaDeUsuario = false;
  let jaAvisouUsuarioIlegivel = false;
  function obterUsuarioNegociador() {
    const fixo = CONFIG_CONTEXTO.USUARIO_NEGOCIADOR.trim().toUpperCase();
    const logado = lerUsuarioLogado();
    if (!logado) {
      // Antes caía no fallback calado: na máquina de outra pessoa, a
      // mensagem sairia assinada com o nome do fallback sem ninguém saber.
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

  // PEDIDO DO USUÁRIO: cliente que JÁ tem contato registrado, mas nenhum
  // deles feito por ele (o usuário logado, ver obterUsuarioNegociador) -- do ponto de
  // vista do cliente a empresa já falou com ele, mas do ponto de vista do
  // negociador é o primeiro contato dele com aquele cliente, então cabe se
  // apresentar. Cliente com ZERO contatos não entra aqui de propósito: esse
  // caso já tem mensagem própria (ver semContatoAnterior), que também se
  // apresenta -- contar os dois juntos duplicaria a apresentação.
  //
  // Convive com contatoAntigo (CONFIRMADO com o usuário: "as duas devem
  // coexistir") -- são motivos diferentes pra mesma linha: aqui é "nunca
  // falei com você", lá é "faz muito tempo que falei com você".
  function calcularNuncaContatadoPorMim(totalContatos) {
    if (totalContatos === 0) return false;
    const contatos = lerTodosContatos();
    if (contatos.length === 0) return false;
    // Os dois lados normalizados em maiúsculas (ver lerTodosContatos).
    const eu = obterUsuarioNegociador();
    return !contatos.some((c) => c.usuario === eu);
  }

  // CONFIRMADO com o usuário (bug real): se existe uma promessa datada
  // pro mesmo dia do último contato -- INDEPENDENTE do status atual dela
  // (mesmo já paga/resolvida, então fora de calcularContextoPromessa) --
  // é porque o cliente retornou naquele contato. "Retomando o contato de
  // ontem, já que ainda não obtivemos retorno" fica errado nesse caso.
  function houvePromessaNaDataDoUltimoContato(contatoRecente) {
    if (!contatoRecente || !contatoRecente.data) return false;
    const promessas = lerPromessas();
    return promessas.some((p) => mesmaData(p.dataPrometida, contatoRecente.data));
  }

  /**
   * Contexto "neutro": mesma forma que calcularContexto() devolve, com todas
   * as regras desligadas. Usado quando não dá pra calcular (erro, ou página
   * sem as abas de Promessas/Contatos).
   *
   * CORRIGIDO (achado de revisão): este objeto era um literal DUPLICADO em
   * dois pontos do arquivo. Quem acrescentasse um campo novo ao contexto
   * tinha que lembrar de editar os dois -- esquecer um não quebra teste
   * nenhum, só faz o Módulo 4 receber `undefined` naquele campo e mudar de
   * comportamento em silêncio, justamente no caminho de fallback (o menos
   * testado). Agora existe um lugar só.
   *
   * @returns {object} Contexto neutro, com o nome do negociador vindo do
   *   CONFIG (o header do CRM não está disponível nesse caminho).
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
      nomeNegociador: nomeDoNegociador(CONFIG_CONTEXTO.USUARIO_NEGOCIADOR),
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
      // Primeiro nome de quem está logado, pra mensagem do Alt+A se
      // apresentar com o nome certo em vez de um nome fixo no código.
      nomeNegociador: nomeDoNegociador(obterUsuarioNegociador()),
      calcularTitulosPendentes,
    };
  }

  /* ---------------------------------------------------------------------
   * 5. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  function montarEExpor() {
    try {
      window.__contextoAdicional = calcularContexto();
      // Censurado: os títulos pagos desde a última visita saem só como contagem.
      const ctx = window.__contextoAdicional;
      console.log('[Contexto Adicional] Calculado:', { ...ctx, titulosPagosDesdeUltimaVisita: ctx?.titulosPagosDesdeUltimaVisita?.length ?? 0 });
    } catch (erro) {
      console.warn('[Contexto Adicional] Falha ao calcular -- Alt+A segue funcionando sem essas linhas extras:', erro.message);
      window.__contextoAdicional = contextoVazio();
    }
  }

  function aguardarConteudoEExecutar() {
    // Confirmado com o usuário: Promessas/Contatos já vêm pré-carregados no
    // HTML (diferente do Grupo, no Módulo 5) -- na maioria das vezes isso já
    // resolve na primeira checagem. O observer é só rede de segurança pro
    // instante inicial de carregamento da página.
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

  // Hooks de depuração (mesmo padrão do window.filaDebug no Módulo 3 e do
  // window.__avisoCobranca no Módulo 1). Rodar no console, na página do
  // cliente, pra diagnosticar sem precisar copiar HTML manualmente:
  //   window.__contextoAdicionalDebug.lerPromessas()
  //     -> mostra o que foi de fato extraído de cada .promessa-item (status,
  //        data lida, títulos). Array vazio ou dataPrometida:null aqui
  //        indica que os seletores (baseados em classes Tailwind nunca
  //        confirmadas com HTML real) não bateram com a estrutura da
  //        página -- não é problema de data/status, é de leitura do DOM.
  //   window.__contextoAdicionalDebug.calcularContextoPromessa(new Date())
  //     -> roda a decisão final (DIA_DA_PROMESSA / QUEBRADA / PARCIAL / null)
  //        com a data de agora, sem esperar o carregamento da página.
  /**
   * O que a fila por prioridade (Módulo 7) lê de uma aba de cliente, a
   * partir da página BAIXADA (v1.45.0, Alt+U sem abrir aba). Mesmas funções
   * da tela, com a página baixada como raiz e os títulos em aberto DELA.
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
