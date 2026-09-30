/* =========================================================================
 * MÓDULO 14: CARTEIRA (Alt+M) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Painel de MIS/BI da carteira em quatro abas:
 *   Hoje      -> fotografia: vencido, % da dívida em cobrança, SCPC, promessas,
 *                cobertura, concentração, aging, fora do painel e saúde do
 *                histórico (gravações, lacunas, alertas de dados).
 *   Evolução  -> ponte (por que o vencido mudou), cura, cura semanal, tendência.
 *   Resultado -> API do CRM (semana/mês) e previsão de entrada das promessas.
 *   Régua     -> cruza o diário (faixa do Alt+U, hora do contato) com quem
 *                quitou em até 7 dias.
 *
 * Aqui mora só o painel (desenho, abas, botões, atalho Esc) e a carga inicial
 * (tira a fotografia do dia e migra o localStorage antigo ao carregar). Os
 * números vêm de dois módulos, separados na v1.64.0 sem mudar comportamento:
 *   - Módulo 22 (Carteira: Dados): regras, escopo, registro bruto, IndexedDB.
 *     O PRINCÍPIO CENTRAL (grava-se o bruto; todo número é calculado na
 *     leitura), a origem dos números, o escopo e os formatos de registro
 *     estão descritos no cabeçalho dele.
 *   - Módulo 23 (Carteira: Histórico): fotografia, cura, ponte, régua,
 *     resultado do período, CSV e backup.
 *
 * NÃO MOSTRA DE PROPÓSITO: valor em cartório separado (não existe em
 * window.CLIENTES); inadimplência sobre faturamento ou carteira inteira (sem
 * fonte); valoresAcordo da API (sem porUsuario, misturaria outras pessoas);
 * parcelas de acordo na previsão (a lista só traz o valor TOTAL).
 *
 * ONDE COLAR: depois dos Módulos 0, 10, 22 e 23. Lê o diário (Módulo 8) e os
 * nomes das faixas (Módulo 7) só ao abrir o painel.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__carteiraCarregado) return;
  window.__carteiraCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Carteira');

  // Módulos de que o painel depende (carregam antes deste no @require). Sem
  // eles não há o que mostrar: avisa alto em vez de quebrar no Alt+M.
  const modulosFaltando = [
    ['__carteiraDados', 'Módulo 22 (Carteira: Dados)'],
    ['__carteiraHistorico', 'Módulo 23 (Carteira: Histórico)'],
  ].filter(([global]) => !window[global]).map(([, nome]) => nome);
  if (modulosFaltando.length > 0) {
    console.error(`[Carteira] Faltam módulos que deveriam carregar antes deste: ${modulosFaltando.join('; ')}. Atualize o script no Tampermonkey.`);
    window.__smartTableUtil?.toast?.(`SmartTable: faltam módulos da Carteira (${modulosFaltando.join('; ')}). Atualize o script no Tampermonkey.`, 12000);
    return;
  }

  const {
    CONFIG_CARTEIRA,
    CAMPOS_BRUTOS,
    util,
    isoDe,
    somarDias,
    ddmm,
    numeroFlex,
    hashCnpj,
    clientesDaCarteira,
    filtrosAtivosNaLista,
    estadoDe,
    resumirCarteira,
    montarRegistro,
    descreverAlerta,
    lerStatus,
    estaUsandoMemoria,
    lerDia,
    gravarDia,
    listarDias,
    decodificar,
    montarHistorico,
    lerHistorico,
    agregadoDe,
    migrarLocalStorage,
  } = window.__carteiraDados;
  const {
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
  } = window.__carteiraHistorico;

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    bom: '#1B6B4A',
    ruim: '#B42318',
    alerta: '#B45309',
    fundo: '#ffffff',
    cartao: '#f8fafc',
    barra: '#313A8C',
  };

  let painelEl = null;
  let abaAtiva = 'hoje';

  /* ---------------------------------------------------------------------
   * DESENHO
   * --------------------------------------------------------------------- */

  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  function moeda(v) {
    return util()?.formatarMoeda?.(v) ?? String(v);
  }

  /** R$ sem centavos, pra caber nos cartões. */
  function moedaCurta(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function percentual(v, casas = 0) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
  }

  /**
   * "▲ 6%" / "▼ R$ 1.200" colorido pelo que é BOM para aquela métrica.
   *
   * @param {number} atual @param {number|undefined} anterior
   * @param {{bomQuandoCai?: boolean, formato?: 'relativo'|'pontos'|'inteiro'}} opcoes
   * @returns {HTMLElement|null}
   */
  function criarDelta(atual, anterior, { bomQuandoCai = true, formato = 'relativo' } = {}) {
    if (typeof anterior !== 'number' || !Number.isFinite(anterior)) return null;
    const diferenca = atual - anterior;
    let texto;
    if (formato === 'pontos') texto = `${Math.abs(diferenca * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`;
    else if (formato === 'inteiro') texto = String(Math.abs(diferenca));
    // De zero pra algo não tem porcentagem: é "novo".
    else texto = anterior !== 0 ? percentual(Math.abs(diferenca / anterior)) : 'novo';
    const igual = Math.abs(diferenca) < 1e-9;
    const bom = igual ? null : (diferenca < 0) === bomQuandoCai;
    return criarDiv(igual ? '= igual' : (texto === 'novo' ? '▲ novo' : `${diferenca > 0 ? '▲' : '▼'} ${texto}`), {
      fontSize: '11px',
      fontWeight: '600',
      color: bom === null ? CORES.apagado : bom ? CORES.bom : CORES.ruim,
    });
  }

  function criarCartao(rotulo, valor, detalhe, delta) {
    const cartao = criarDiv('', {
      background: CORES.cartao, border: `1px solid ${CORES.linha}`, borderRadius: '8px',
      padding: '8px 10px', minWidth: '0',
    });
    cartao.appendChild(criarDiv(rotulo, { color: CORES.apagado, fontSize: '11px', marginBottom: '2px' }));
    const linha = criarDiv('', { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' });
    linha.appendChild(criarDiv(valor, {
      color: CORES.tinta, fontWeight: '700', fontSize: '15px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }));
    if (delta) linha.appendChild(delta);
    cartao.appendChild(linha);
    if (detalhe) cartao.appendChild(criarDiv(detalhe, { color: CORES.texto, fontSize: '11px', marginTop: '2px' }));
    return cartao;
  }

  function criarTitulo(texto, detalhe) {
    const bloco = criarDiv('', { margin: '14px 0 6px' });
    bloco.appendChild(criarDiv(texto, { color: CORES.tinta, fontWeight: '700', fontSize: '13px' }));
    if (detalhe) bloco.appendChild(criarDiv(detalhe, { color: CORES.apagado, fontSize: '11px' }));
    return bloco;
  }

  /** Tabela simples: cabeçalho + linhas de texto; colunas 1+ alinhadas à direita. */
  function criarTabela(cabecalho, linhas) {
    const tabela = document.createElement('table');
    Object.assign(tabela.style, { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
    const tr = document.createElement('tr');
    cabecalho.forEach((texto, i) => {
      const th = document.createElement('th');
      th.textContent = texto;
      Object.assign(th.style, {
        textAlign: i === 0 ? 'left' : 'right', color: CORES.apagado, fontWeight: '600', fontSize: '11px',
        padding: '3px 4px', borderBottom: `1px solid ${CORES.borda}`, whiteSpace: 'nowrap',
      });
      tr.appendChild(th);
    });
    tabela.appendChild(tr);
    linhas.forEach((celulas, iLinha) => {
      const linha = document.createElement('tr');
      celulas.forEach((conteudo, i) => {
        const td = document.createElement('td');
        // Rótulo começando com dois espaços = sub-linha (composição da linha
        // de cima). Recuo por CSS, porque o HTML colapsa os espaços.
        const subLinha = i === 0 && typeof conteudo === 'string' && conteudo.startsWith('  ');
        if (conteudo instanceof window.Node) td.appendChild(conteudo);
        else td.textContent = subLinha ? conteudo.trim() : conteudo;
        Object.assign(td.style, {
          textAlign: i === 0 ? 'left' : 'right', padding: '3px 4px', color: CORES.texto, whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          borderBottom: iLinha === linhas.length - 1 ? 'none' : `1px solid ${CORES.linha}`,
        });
        if (subLinha) Object.assign(td.style, { paddingLeft: '16px', color: CORES.apagado });
        linha.appendChild(td);
      });
      tabela.appendChild(linha);
    });
    return tabela;
  }

  /** Barra proporcional dentro da célula do aging. */
  function criarBarra(fracao) {
    const trilho = criarDiv('', {
      display: 'inline-block', width: '60px', height: '6px', background: CORES.linha, borderRadius: '3px',
      verticalAlign: 'middle', overflow: 'hidden',
    });
    trilho.appendChild(criarDiv('', {
      width: `${Math.max(0, Math.min(1, fracao)) * 100}%`, height: '100%', background: CORES.barra,
    }));
    return trilho;
  }

  /** Linha do vencido nos últimos DIAS_TENDENCIA dias, calculada agora (SVG). */
  function criarTendencia(historico, hojeIso) {
    const inicio = somarDias(hojeIso, -CONFIG_CARTEIRA.DIAS_TENDENCIA);
    const pontos = datasDo(historico)
      .filter((d) => d >= inicio && d <= hojeIso)
      .map((d) => ({ d, v: agregadoDe(historico.dias[d])?.vencido }))
      .filter((p) => typeof p.v === 'number');
    if (pontos.length < 2) {
      return criarDiv('A linha aparece a partir da segunda fotografia (abra a lista amanhã).', {
        color: CORES.apagado, fontSize: '11.5px',
      });
    }
    const largura = 480;
    const altura = 48;
    const valores = pontos.map((p) => p.v);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const faixa = max - min || 1;
    const coords = pontos.map((p, i) => {
      const x = (i / (pontos.length - 1)) * (largura - 4) + 2;
      const y = altura - 4 - ((p.v - min) / faixa) * (altura - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(altura));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Vencido por dia');
    const linha = document.createElementNS(ns, 'polyline');
    linha.setAttribute('points', coords.join(' '));
    linha.setAttribute('fill', 'none');
    linha.setAttribute('stroke', CORES.barra);
    linha.setAttribute('stroke-width', '2');
    svg.appendChild(linha);

    const bloco = criarDiv('', {});
    bloco.appendChild(svg);
    const legenda = criarDiv('', { display: 'flex', justifyContent: 'space-between', color: CORES.apagado, fontSize: '11px' });
    legenda.appendChild(criarDiv(`${ddmm(pontos[0].d)} · ${moedaCurta(pontos[0].v)}`));
    legenda.appendChild(criarDiv(`mín ${moedaCurta(min)} · máx ${moedaCurta(max)}`));
    legenda.appendChild(criarDiv(`${ddmm(pontos[pontos.length - 1].d)} · ${moedaCurta(pontos[pontos.length - 1].v)}`));
    bloco.appendChild(legenda);
    return bloco;
  }

  function aviso(textoAviso, cor = CORES.apagado) {
    return criarDiv(textoAviso, { color: cor, fontSize: '11.5px', lineHeight: '1.45' });
  }

  function comPct(parte, total) {
    return `${parte} (${percentual(total ? parte / total : 0)})`;
  }

  /** Taxa com amostra mínima: abaixo dela é ruído, e a tela diz "--". */
  function taxa(parte, base) {
    if (!(base >= CONFIG_CARTEIRA.AMOSTRA_MINIMA)) return base > 0 ? `-- (${parte}/${base})` : '--';
    return `${percentual(parte / base)} (${parte}/${base})`;
  }

  /** A fotografia mais recente até hoje e a de comparação. */
  function pontasDe(historico, hojeIso) {
    const dia = datasDo(historico).filter((d) => d <= hojeIso).pop() ?? null;
    const a = dia ? agregadoDe(historico.dias[dia]) : null;
    const comparacao = dia ? dataDeComparacao(historico, dia) : null;
    const b = comparacao ? agregadoDe(historico.dias[comparacao]) : null;
    return { dia, a, comparacao, b };
  }

  const horaDe = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /**
   * "Tirar nova fotografia de hoje". Só na lista de clientes e só com a lista
   * COMPLETA (mesma regra da captura automática). Substitui a de hoje depois de
   * confirmar, mesmo com menos clientes. Dias anteriores não se refazem.
   */
  function criarBotaoNovaFotografia() {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Tirar nova fotografia de hoje';
    botao.dataset.papel = 'nova-fotografia';
    Object.assign(botao.style, {
      marginTop: '6px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer',
      border: `1px solid ${CORES.linha}`, background: '#fff', fontSize: '12px', fontWeight: '600',
    });
    const naLista = Array.isArray(window.CLIENTES) && clientesDaCarteira(window.CLIENTES).length > 0;
    if (!naLista) {
      botao.disabled = true;
      botao.title = 'Abra a lista de clientes';
      botao.style.cursor = 'not-allowed';
      botao.style.opacity = '0.5';
    }
    botao.addEventListener('click', () => {
      tirarNovaFotografia().catch((erro) => console.warn('[Carteira] Falha ao tirar a nova fotografia.', erro));
    });
    return botao;
  }

  async function tirarNovaFotografia() {
    const lista = window.CLIENTES;
    if (!Array.isArray(lista) || clientesDaCarteira(lista).length === 0) {
      util()?.toast?.('Abra a lista de clientes pra tirar a fotografia.');
      return false;
    }
    const filtros = filtrosAtivosNaLista(lista);
    if (filtros) {
      util()?.toast?.(`A lista está com filtro (${filtros.join(', ')}). Limpe os filtros e tente de novo.`, 8000);
      return false;
    }
    let existente = null;
    try {
      existente = decodificar(await lerDia(isoDe(new Date())));
    } catch (erro) {
      existente = null;
    }
    const pergunta = existente
      ? `Substituir a fotografia de hoje (${existente.totalLista} clientes${existente.capturadoEm ? `, tirada às ${horaDe(existente.capturadoEm)}` : ''}) pela lista atual (${lista.length} clientes)?`
      : `Tirar a fotografia de hoje com a lista atual (${lista.length} clientes)?`;
    if (!window.confirm(pergunta)) return false;
    await capturarFotografia({ forcar: true });
    if (painelEl) await abrirPainel();
    return true;
  }

  /**
   * Saúde do histórico: resultado da última gravação, lacunas, persistência,
   * alertas de dados do dia. É o "nenhum erro passa em silêncio" na tela.
   */
  function desenharSaude(corpo, historico, dia, agora) {
    const status = lerStatus();
    const bloco = criarDiv('', { marginTop: '12px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}` });
    bloco.dataset.papel = 'saude';
    bloco.appendChild(criarTitulo('Saúde do histórico'));

    const erro = status.ultimoErro;
    const sucesso = status.ultimoSucesso;
    if (erro && (!sucesso || erro.quando > sucesso.quando)) {
      bloco.appendChild(aviso(
        `A ÚLTIMA GRAVAÇÃO FALHOU (${new Date(erro.quando).toLocaleString('pt-BR')}): ${erro.mensagem}. ` +
          'Abra a lista de novo; se repetir, faça um backup e me avise.',
        CORES.ruim
      ));
    } else if (sucesso) {
      bloco.appendChild(aviso(`Última leitura da lista: ${new Date(sucesso.quando).toLocaleString('pt-BR')} · ${sucesso.clientes} clientes · ` +
        (sucesso.gravou ? 'gravada' : 'mantida a fotografia de abertura do dia')));
    }
    const filtrada = status.ultimaListaFiltrada;
    // Só enquanto o dia não tem fotografia (olhando o HISTÓRICO, que é a
    // fonte da verdade): depois dela, lista filtrada é uso normal.
    if (filtrada && filtrada.data === isoDe(agora) && !datasDo(historico).includes(filtrada.data)) {
      bloco.appendChild(aviso(
        `A lista estava com filtro (${filtrada.filtros.join(', ')}) e não foi fotografada. ` +
          'A fotografia do dia só sai da lista completa: abra a lista sem filtro.',
        CORES.alerta
      ));
    }
    const refeita = status.fotografiaRefeita;
    if (refeita && refeita.data === isoDe(agora)) {
      bloco.appendChild(aviso(`Fotografia de hoje refeita às ${horaDe(refeita.quando)} (antes ${refeita.antes}, agora ${refeita.depois} clientes).`));
    }
    bloco.appendChild(criarBotaoNovaFotografia());
    if (estaUsandoMemoria()) {
      bloco.appendChild(aviso('Sem IndexedDB neste navegador: o histórico vive só nesta aba e se perde ao fechar.', CORES.ruim));
    }
    if (status.persistente === false) {
      bloco.appendChild(aviso('O navegador não garantiu o armazenamento como permanente: sob falta de espaço em disco ele pode apagar o histórico. Faça backup de vez em quando.', CORES.alerta));
    }
    const backup = situacaoBackup(status, datasDo(historico)[0] ?? null, agora);
    const haQuanto = backup.dias === 0 ? 'hoje' : `há ${backup.dias} dia${backup.dias === 1 ? '' : 's'}`;
    const quandoBackup = backup.ultimo ? `Último backup: ${ddmm(backup.ultimo)} (${haQuanto})` : 'Nenhum backup ainda';
    const linhaBackup = aviso(
      backup.atrasado
        ? `${quandoBackup}. Baixe um backup agora (botão "Baixar backup" abaixo) -- o histórico mora só neste navegador.`
        : `${quandoBackup}.`,
      backup.atrasado ? CORES.alerta : CORES.apagado
    );
    linhaBackup.dataset.papel = 'backup';
    bloco.appendChild(linhaBackup);

    const faltam = lacunas(datasDo(historico), agora);
    bloco.appendChild(aviso(
      faltam.length === 0
        ? `Sem lacunas nos últimos ${CONFIG_CARTEIRA.DIAS_LACUNAS} dias (dias úteis).`
        : `Dias úteis sem fotografia (últimos ${CONFIG_CARTEIRA.DIAS_LACUNAS}): ${faltam.map(ddmm).join(', ')}. A lista não foi aberta nesses dias.`,
      faltam.length === 0 ? CORES.apagado : CORES.alerta
    ));

    const doDia = dia ? historico.dias[dia] : null;
    if (doDia?.legado) {
      bloco.appendChild(aviso('A fotografia deste dia é do formato antigo (números já calculados, sem o bruto). Abra a lista hoje pra ela ser refeita no formato novo.', CORES.alerta));
    }
    const alertas = doDia?.alertas ?? [];
    if (alertas.length > 0) {
      bloco.appendChild(aviso(`Alertas nos dados de ${ddmm(dia)} (o bruto está gravado; nada foi descartado):`, CORES.alerta));
      alertas.forEach((a) => bloco.appendChild(aviso(`• ${descreverAlerta(a)}`, CORES.alerta)));
    }
    corpo.appendChild(bloco);
  }

  function desenharHoje(corpo, historico, hojeIso, agora) {
    const { dia, a, comparacao, b } = pontasDe(historico, hojeIso);
    if (!a) {
      corpo.appendChild(criarDiv(
        'Ainda não há fotografia da carteira. Abra a lista de clientes uma vez -- a fotografia é tirada sozinha e o painel passa a funcionar em qualquer página.',
        { color: CORES.texto, lineHeight: '1.5', padding: '6px 0' }
      ));
      desenharSaude(corpo, historico, dia, agora);
      return;
    }

    const quando = a.capturadoEm ? new Date(a.capturadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    corpo.appendChild(criarDiv(
      `Posição de ${ddmm(dia)}${quando ? ' às ' + quando : ''}${dia !== hojeIso ? ' (abra a lista pra atualizar)' : ''} · ${a.clientes} clientes · ` +
        (b ? `setas comparam com ${ddmm(comparacao)}` : 'sem fotografia anterior pra comparar ainda'),
      { color: CORES.apagado, fontSize: '11.5px', paddingBottom: '8px', borderBottom: `1px solid ${CORES.linha}` }
    ));

    const pp = a.promessasPendentes ?? {};
    const grade = criarDiv('', { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginTop: '10px' });
    grade.appendChild(criarCartao('Vencido em cobrança', moedaCurta(a.vencido),
      `${a.clientesComVencido} clientes · ${a.titulosVencidos} títulos`, criarDelta(a.vencido, b?.vencido)));
    grade.appendChild(criarCartao('% da dívida em cobrança', percentual(a.pctVencido, 1),
      `de ${moedaCurta(a.carteira)} que os ${a.clientes} clientes em atraso devem · a vencer ${moedaCurta(a.aVencer)}`,
      criarDelta(a.pctVencido, b?.pctVencido, { formato: 'pontos' })));
    grade.appendChild(criarCartao('Negativado (SCPC)', moedaCurta(a.scpc?.valor),
      `${a.scpc?.clientes ?? 0} clientes · ${a.suspensos?.clientes ?? 0} suspensos` + (a.deveSuspender ? ` · ${a.deveSuspender} a suspender` : ''),
      criarDelta(a.scpc?.valor, b?.scpc?.valor)));
    grade.appendChild(criarCartao('Promessas pendentes', moedaCurta(pp.valor),
      `${pp.clientes ?? 0} clientes · ${pp.venceHoje ?? 0} vencem hoje` + (pp.vencidas ? ` · ${pp.vencidas} com data passada` : ''),
      null));
    grade.appendChild(criarCartao(`Cobertura (${CONFIG_CARTEIRA.DIAS_COBERTURA} dias)`, percentual(a.cobertura?.pct),
      `${a.cobertura?.cobertos ?? 0} de ${a.clientesComVencido} com movimentação · ${a.semMovimentacao ?? 0} parados há +${CONFIG_CARTEIRA.DIAS_SEM_MOVIMENTACAO}d`,
      criarDelta(a.cobertura?.pct, b?.cobertura?.pct, { bomQuandoCai: false, formato: 'pontos' })));
    grade.appendChild(criarCartao(`Concentração (top ${CONFIG_CARTEIRA.TOP_CONCENTRACAO})`, percentual(a.concentracaoTop),
      `do vencido em ${CONFIG_CARTEIRA.TOP_CONCENTRACAO} clientes` +
        (a.acordosInadimplentes?.clientes ? ` · ${a.acordosInadimplentes.clientes} acordos inadimplentes` : ''),
      null));
    corpo.appendChild(grade);

    corpo.appendChild(criarTitulo(
      'Aging do vencido',
      `do ${CONFIG_CARTEIRA.DIA_INICIO_ESCOPO}º ao ${CONFIG_CARTEIRA.DIA_FIM_ESCOPO}º dia · cliente classificado pelo título mais antigo`
    ));
    const linhasAging = (a.faixas ?? []).map((f, i) => [
      f.rotulo,
      String(f.clientes),
      moedaCurta(f.valor),
      criarBarra(a.vencido > 0 ? f.valor / a.vencido : 0),
      percentual(a.vencido > 0 ? f.valor / a.vencido : 0),
      criarDelta(f.valor, b?.faixas?.[i]?.valor) ?? '',
    ]);
    corpo.appendChild(criarTabela(['Faixa', 'Cli.', 'Vencido', '', '%', b ? `vs ${ddmm(comparacao)}` : ''], linhasAging));
    const fora = a.fora ?? { primeiroDia: { clientes: 0, valor: 0 }, analista: { clientes: 0, valor: 0 } };
    corpo.appendChild(criarDiv(
      `Fora do painel: até o 1º dia — ${fora.primeiroDia.clientes} cli · ${moedaCurta(fora.primeiroDia.valor)}` +
        ` · com o analista (${CONFIG_CARTEIRA.DIA_FIM_ESCOPO + 1}+ dias) — ${fora.analista.clientes} cli · ${moedaCurta(fora.analista.valor)}`,
      { color: CORES.apagado, fontSize: '11px', marginTop: '4px' }
    ));
    desenharSaude(corpo, historico, dia, agora);
  }

  function desenharPonte(corpo, ponte) {
    const linha = (sinal, rotulo, cat) => [`${sinal} ${rotulo}`, String(cat.clientes), `${sinal === '−' ? '−' : ''}${moedaCurta(cat.valor)}`];
    corpo.appendChild(criarTabela(['', 'Cli.', 'R$'], [
      [`Vencido em ${ddmm(ponte.de)}`, String(ponte.inicial.clientes), moedaCurta(ponte.inicial.valor)],
      linha('+', 'entraram na cobrança', ponte.entraram),
      linha('+', 'aumentaram (título novo)', ponte.aumentaram),
      linha('−', 'pagamento parcial', ponte.reduziram),
      linha('−', 'quitaram', ponte.pagaram),
      linha('−', 'foram pro analista', ponte.analista),
      [`= Vencido em ${ddmm(ponte.ate)}`, String(ponte.final.clientes), moedaCurta(ponte.final.valor)],
    ]));
  }

  function desenharEvolucao(corpo, historico, hojeIso) {
    const { dia, a } = pontasDe(historico, hojeIso);
    if (!a) {
      corpo.appendChild(aviso('Sem fotografia ainda.'));
      return;
    }
    const primeira = datasDo(historico)[0];
    const disponivelEm = ddmm(somarDias(primeira ?? dia, CONFIG_CARTEIRA.DIAS_COMPARACAO));
    const { ponte, cura } = ponteECuraDe(historico, dia);

    corpo.appendChild(criarTitulo('Ponte da carteira', ponte ? `por que o vencido mudou em ${ponte.janela} dias` : null));
    if (ponte) desenharPonte(corpo, ponte);
    else corpo.appendChild(aviso(`Precisa de duas fotografias no formato novo com ${CONFIG_CARTEIRA.DIAS_COMPARACAO} dias de distância -- disponível a partir de ${disponivelEm}.`));

    corpo.appendChild(criarTitulo('Cura', cura ? `quem estava em cobrança em ${ddmm(cura.de)}: onde está ${cura.janela} dias depois` : null));
    if (!cura) {
      corpo.appendChild(aviso(`Disponível a partir de ${disponivelEm}.`));
    } else {
      const linhasCura = CONFIG_CARTEIRA.FAIXAS_AGING
        .map((f, i) => {
          const [clientes, pagaram, seguem, analista] = cura.faixas?.[i] ?? [0, 0, 0, 0];
          return { rotulo: f.rotulo, clientes, pagaram, seguem, analista };
        })
        .filter((l) => l.clientes > 0)
        .concat([{ rotulo: 'Total', ...cura }])
        .map((l) => [l.rotulo, String(l.clientes), comPct(l.pagaram, l.clientes), String(l.seguem), comPct(l.analista, l.clientes)]);
      corpo.appendChild(criarTabela(['Estava em', 'Cli.', 'Quitaram', 'Seguem', 'Analista'], linhasCura));
      corpo.appendChild(aviso(
        `R$ curado ${moedaCurta(cura.valorCurado)} · R$ que foi pro analista ${moedaCurta(cura.valorAnalista)} · ` +
          'quem sumiu da lista conta como quitou (a lista só mostra quem deve)'
      ));
    }

    const semanas = curaSemanal(historico);
    corpo.appendChild(criarTitulo('Cura semana a semana', 'última fotografia de cada semana (sáb–sex)'));
    if (semanas.length === 0) {
      corpo.appendChild(aviso('A série começa com a primeira cura.'));
    } else {
      corpo.appendChild(criarTabela(['Semana de', 'Janela', 'Cli.', '% quitaram', '% analista', 'R$ curado'], semanas.map((s) => [
        ddmm(s.semana),
        `${s.janela}d`,
        String(s.clientes),
        percentual(s.clientes ? s.pagaram / s.clientes : 0),
        percentual(s.clientes ? s.analista / s.clientes : 0),
        moedaCurta(s.valorCurado),
      ])));
    }

    corpo.appendChild(criarTitulo(`Vencido nos últimos ${CONFIG_CARTEIRA.DIAS_TENDENCIA} dias`));
    corpo.appendChild(criarTendencia(historico, dia));
  }

  function desenharResultado(bloco, resultados, agregado) {
    bloco.textContent = '';
    const [s, m, t] = resultados.map((r) => r.resumo);
    const fmtPct = (v) => (v === null ? '--' : percentual(v));
    const fmtRecuperado = (v) => (v === null ? 'indisponível' : moeda(v));
    const fmtPagas = (p) => {
      if (p?.erro) return `indisponível (${p.erro})`;
      return p.semValor > 0 ? `${moeda(p.valor)} (+${p.semValor} sem valor lido)` : moeda(p.valor);
    };
    bloco.appendChild(criarTitulo('Resultado', 'da API do CRM (a mesma do Alt+D) · recuperado = depósitos + promessas cumpridas pelo dia do pagamento, como no Alt+D · tudo o que você recebeu, sem o filtro de 2º–20º dia'));
    bloco.appendChild(criarTabela(
      ['', `Semana (${ddmm(resultados[0].inicioIso)}–${ddmm(resultados[0].fimIso)})`, `Mês (desde ${ddmm(resultados[1].inicioIso)})`],
      [
        ['Recuperado', fmtRecuperado(s.recuperado), fmtRecuperado(m.recuperado)],
        ['  depósitos', moeda(s.depositos), moeda(m.depositos)],
        ['  promessas cumpridas', fmtPagas(s.cumpridasPeloPagamento), fmtPagas(m.cumpridasPeloPagamento)],
        ['Promessas feitas', `${s.promessas.quantidade} · ${moedaCurta(s.promessas.prometido)}`, `${m.promessas.quantidade} · ${moedaCurta(m.promessas.prometido)}`],
        ['Cumprimento (valor)', fmtPct(s.promessas.cumprimento), fmtPct(m.promessas.cumprimento)],
        ['Promessas quebradas', moedaCurta(s.promessas.quebrado), moedaCurta(m.promessas.quebrado)],
        ['Acordos fechados', `${s.acordos.quantidade} · ${moedaCurta(s.acordos.valor)}`, `${m.acordos.quantidade} · ${moedaCurta(m.acordos.valor)}`],
        ['Clientes contatados', String(s.contatos.unicos), String(m.contatos.unicos)],
      ]
    ));

    const taxaCumprimento = t.promessas.cumprimento;
    bloco.appendChild(criarTitulo(
      'Previsão de entrada (promessas)',
      taxaCumprimento === null
        ? `sem promessa decidida nos últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias -- só o valor prometido`
        : `prometido × ${percentual(taxaCumprimento)} de cumprimento (por valor) nos últimos ${CONFIG_CARTEIRA.DIAS_TAXA_CUMPRIMENTO} dias`
    ));
    if (!agregado) {
      bloco.appendChild(aviso('Precisa da fotografia da lista.'));
      return;
    }
    const previsao = preverEntrada(agregado, taxaCumprimento);
    bloco.appendChild(criarTabela(['Janela', 'Cli.', 'Prometido', 'Esperado'], previsao.map((p) => [
      `até ${p.dias} dias`,
      String(p.clientes),
      moedaCurta(p.prometido),
      p.esperado === null ? '--' : moedaCurta(p.esperado),
    ])));
    const passadas = agregado.promessasPendentes?.valorVencidas ?? 0;
    bloco.appendChild(aviso(
      `Fora da previsão: ${moedaCurta(passadas)} em promessas com data já passada (na prática, quebradas) e as parcelas de acordo (a lista só traz o valor total do acordo).`
    ));
  }

  function desenharRegua(corpo, historico) {
    const eventos = eventosDoDiario();
    const versao = window.filaPrioridadeDebug?.CONFIG?.VERSAO_REGUA ?? null;
    const nomes = window.filaPrioridadeDebug?.NOMES_PRIORIDADE ?? {};
    const r = analisarRegua(historico, eventos, versao);

    corpo.appendChild(aviso(
      `Quem entrou na fila do Alt+U (régua atual) e quitou em até ${CONFIG_CARTEIRA.JANELA_RESULTADO_DIAS} dias, pela fotografia. ` +
        'É descritivo, não causal: faixas diferentes têm clientes diferentes. Compare contatado com não contatado DENTRO da mesma faixa.'
    ));
    if (r.atribuicoes === 0) {
      corpo.appendChild(criarDiv('Ainda não há atribuições de fila no diário (use o Alt+U e volte depois).', { color: CORES.texto, padding: '8px 0' }));
      return;
    }
    corpo.appendChild(criarTitulo('Por faixa da régua', `taxa com menos de ${CONFIG_CARTEIRA.AMOSTRA_MINIMA} casos aparece como "--"`));
    corpo.appendChild(criarTabela(['Faixa', 'Na fila', 'Contatados', 'Quitou (contat.)', 'Quitou (não contat.)'], r.faixas.map((f) => [
      `${f.faixa} ${nomes[f.faixa] ?? ''}`.trim(),
      String(f.naFila),
      String(f.contatados),
      taxa(f.pagouContatados, f.baseContatados),
      taxa(f.pagouNao, f.baseNao),
    ])));
    corpo.appendChild(criarTitulo('Por hora do primeiro contato do dia'));
    corpo.appendChild(criarTabela(['Horário', 'Contatos', 'Quitou'], r.horarios
      .filter((h) => h.contatos > 0)
      .map((h) => [h.rotulo, String(h.contatos), taxa(h.pagou, h.base)])));
    corpo.appendChild(aviso(
      `${r.atribuicoes} atribuições nos últimos ${CONFIG_CARTEIRA.DIAS_DIARIO} dias · ${r.abertos} ainda com a janela aberta · ` +
        `${r.semBase} sem fotografia de base (dia sem lista aberta, formato antigo, ou fora do 2º–20º dia).`
    ));
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  const ABAS = [
    { chave: 'hoje', rotulo: 'Hoje' },
    { chave: 'evolucao', rotulo: 'Evolução' },
    { chave: 'resultado', rotulo: 'Resultado' },
    { chave: 'regua', rotulo: 'Régua' },
  ];

  function criarAbas(conteudos) {
    const barra = criarDiv('', { display: 'flex', gap: '4px', margin: '8px 0 4px', borderBottom: `1px solid ${CORES.borda}` });
    barra.setAttribute('role', 'tablist');
    const botoes = ABAS.map((aba) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = aba.rotulo;
      b.dataset.aba = aba.chave;
      b.id = `${CONFIG_CARTEIRA.ID_PAINEL}-aba-${aba.chave}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `${CONFIG_CARTEIRA.ID_PAINEL}-conteudo-${aba.chave}`);
      Object.assign(b.style, {
        border: 'none', background: 'transparent', padding: '6px 10px', fontSize: '12.5px', cursor: 'pointer',
        borderBottom: '2px solid transparent', marginBottom: '-1px', color: CORES.texto,
      });
      b.addEventListener('click', () => mostrar(aba.chave));
      barra.appendChild(b);
      return b;
    });
    function mostrar(chave) {
      abaAtiva = chave;
      botoes.forEach((b) => {
        const ativo = b.dataset.aba === chave;
        b.setAttribute('aria-selected', String(ativo));
        b.style.borderBottomColor = ativo ? CORES.barra : 'transparent';
        b.style.color = ativo ? CORES.tinta : CORES.texto;
        b.style.fontWeight = ativo ? '700' : '500';
      });
      Object.entries(conteudos).forEach(([k, el]) => { el.style.display = k === chave ? 'block' : 'none'; });
    }
    return { barra, mostrar };
  }

  function criarBotao(rotulo, aoClicar) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = rotulo;
    Object.assign(botao.style, {
      border: `1px solid ${CORES.borda}`, background: CORES.fundo, color: CORES.tinta, borderRadius: '6px',
      padding: '4px 8px', fontSize: '12px', cursor: 'pointer',
    });
    botao.addEventListener('click', aoClicar);
    return botao;
  }

  /**
   * Abre o painel. Resolve quando TUDO foi desenhado (fotografia, régua e
   * resultado da API) -- é o que os testes aguardam.
   */
  async function abrirPainel({ hoje } = {}) {
    // Chamado com o painel já aberto (duas chamadas seguidas): reabre, não
    // empilha um segundo painel por cima do primeiro.
    fecharPainel();
    window.__smartTableUtil?.fecharOutrosPaineis?.('carteira');
    const base = hoje ?? new Date();
    const hojeIso = isoDe(base);

    const meuPainel = document.createElement('div');
    painelEl = meuPainel;
    meuPainel.id = CONFIG_CARTEIRA.ID_PAINEL;
    meuPainel.setAttribute('role', 'dialog');
    meuPainel.setAttribute('aria-label', 'Carteira');
    Object.assign(meuPainel.style, {
      position: 'fixed', bottom: '16px', left: '16px', background: CORES.fundo,
      border: `1px solid ${CORES.borda}`, borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)', fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', zIndex: CONFIG_CARTEIRA.Z_INDEX, width: '560px', maxWidth: '94vw',
      maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box',
    });
    meuPainel.appendChild(criarDiv('Carteira', { color: CORES.tinta, fontWeight: '700', fontSize: '15px' }));

    const conteudos = Object.fromEntries(ABAS.map((aba) => {
      const el = criarDiv('Carregando...', { color: CORES.apagado, paddingTop: '4px' });
      el.dataset.papel = aba.chave;
      // Papéis de acessibilidade: os testes E2E acham tudo por papel e nome.
      el.id = `${CONFIG_CARTEIRA.ID_PAINEL}-conteudo-${aba.chave}`;
      el.setAttribute('role', 'tabpanel');
      el.setAttribute('aria-labelledby', `${CONFIG_CARTEIRA.ID_PAINEL}-aba-${aba.chave}`);
      return [aba.chave, el];
    }));
    const { barra, mostrar } = criarAbas(conteudos);
    meuPainel.appendChild(barra);
    Object.values(conteudos).forEach((el) => meuPainel.appendChild(el));
    mostrar(abaAtiva);

    const rodape = criarDiv('', {
      display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px',
      paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`, gap: '6px',
    });
    const botoes = criarDiv('', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    const avisoRodape = criarDiv('Alt+M ou Esc pra fechar', { color: CORES.apagado, fontSize: '11px' });
    const falhou = (acao) => (erro) => {
      avisoRodape.textContent = `${acao} falhou: ${erro?.message ?? erro}`;
      avisoRodape.style.color = CORES.ruim;
      console.warn(`[Carteira] ${acao} falhou.`, erro);
    };
    // Um ano de histórico leva segundos pra recalcular: a tela avisa que está
    // trabalhando em vez de parecer travada.
    const comEspera = (rotulo, acao) => async () => {
      avisoRodape.textContent = `${rotulo}...`;
      avisoRodape.style.color = CORES.apagado;
      try {
        await acao();
        avisoRodape.textContent = 'Alt+M ou Esc pra fechar';
      } catch (erro) {
        falhou(rotulo)(erro);
      }
    };
    botoes.appendChild(criarBotao('Exportar CSV', comEspera('Gerando o CSV', exportarCsv)));
    botoes.appendChild(criarBotao('Baixar backup', comEspera('Gerando o backup', async () => {
      await exportarBackup();
      const linha = meuPainel.querySelector('[data-papel="backup"]');
      if (linha) {
        linha.textContent = `Último backup: ${ddmm(isoDe(new Date()))} (agora).`;
        linha.style.color = CORES.apagado;
      }
    })));
    const arquivo = document.createElement('input');
    arquivo.type = 'file';
    arquivo.accept = '.json,application/json';
    arquivo.style.display = 'none';
    arquivo.addEventListener('change', async () => {
      const f = arquivo.files?.[0];
      arquivo.value = '';
      if (!f) return;
      try {
        const r = await importarBackup(await f.text());
        avisoRodape.textContent = `Backup restaurado: ${r.importados} dia(s) importado(s), ${r.mantidos} mantido(s), ${r.invalidos} inválido(s). Reabra o painel.`;
        avisoRodape.style.color = CORES.bom;
      } catch (erro) {
        falhou('Restaurar backup')(erro);
      }
    });
    botoes.appendChild(criarBotao('Restaurar backup', () => arquivo.click()));
    botoes.appendChild(arquivo);
    rodape.appendChild(botoes);
    rodape.appendChild(avisoRodape);
    meuPainel.appendChild(rodape);
    document.body.appendChild(meuPainel);
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(meuPainel);

    const vivo = () => painelEl === meuPainel;
    const resultadoApi = buscarResultado(base).then((r) => ({ r }), (erro) => ({ erro }));

    const desenhar = (chave, fn) => {
      conteudos[chave].textContent = '';
      conteudos[chave].style.color = '';
      try {
        fn(conteudos[chave]);
      } catch (erro) {
        conteudos[chave].appendChild(criarDiv(`Falha ao desenhar: ${erro.message}`, { color: CORES.ruim }));
        console.warn('[Carteira]', erro);
      }
    };

    let historico;
    try {
      await capturarFotografia({ hoje: base });
      historico = await lerHistorico({ hoje: base });
    } catch (erro) {
      // Erro de leitura NÃO vira "ainda não há fotografia": diz o que houve.
      if (!vivo()) return;
      console.warn('[Carteira] Falha ao ler o histórico.', erro);
      ['hoje', 'evolucao', 'regua'].forEach((k) => desenhar(k, (el) => {
        el.appendChild(criarDiv(`Não consegui ler o histórico: ${erro?.message ?? erro}. Nada foi apagado -- feche e abra o painel de novo.`, {
          color: CORES.ruim, lineHeight: '1.5', padding: '6px 0',
        }));
      }));
      historico = { dias: {} };
    }
    if (!vivo()) return;

    if (Object.keys(historico.dias).length > 0 || conteudos.hoje.textContent === 'Carregando...') {
      desenhar('hoje', (el) => desenharHoje(el, historico, hojeIso, base));
      desenhar('evolucao', (el) => desenharEvolucao(el, historico, hojeIso));
      desenhar('regua', (el) => desenharRegua(el, historico));
    }

    const { r, erro } = await resultadoApi;
    if (!vivo()) return;
    if (erro) {
      conteudos.resultado.textContent = erro.message;
      conteudos.resultado.style.color = CORES.ruim;
      console.warn('[Carteira]', erro);
      return;
    }
    desenhar('resultado', (el) => desenharResultado(el, r, pontasDe(historico, hojeIso).a));
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel().catch((erro) => console.warn('[Carteira] Falha ao abrir o painel.', erro));
  }

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('carteira', fecharPainel);

  const cargaInicial = capturarFotografia()
    .then(() => migrarLocalStorage())
    .catch((erro) => console.warn('[Carteira] Falha ao tirar a fotografia do dia.', erro?.message));

  window.__carteira = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    cargaInicial,
    clientesDaCarteira,
    filtrosAtivosNaLista,
    tirarNovaFotografia,
    resumirCarteira,
    montarRegistro,
    decodificar,
    montarHistorico,
    agregadoDe,
    descreverAlerta,
    numeroFlex,
    hashCnpj,
    estadoDe,
    capturarFotografia,
    lerHistorico,
    lerDia,
    gravarDia,
    listarDias,
    lerStatus,
    dataDeComparacao,
    calcularCura,
    calcularPonte,
    ponteECuraDe,
    curaSemanal,
    lacunas,
    situacaoBackup,
    exportarBackup,
    analisarRegua,
    resumirPeriodo,
    periodos,
    preverEntrada,
    montarCsv,
    montarBackup,
    importarBackup,
    usandoMemoria: estaUsandoMemoria,
    CONFIG_CARTEIRA,
    CAMPOS_BRUTOS,
  };
})();
