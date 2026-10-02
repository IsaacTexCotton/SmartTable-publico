/* =========================================================================
 * MÓDULO 26: META SEMANAL (dentro do Alt+D) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Um bloco "Meta da semana" no painel "Entrou na semana" (Módulo 10), logo
 * depois do "Total recuperado" e antes de "Promessas feitas hoje". Pedido do
 * usuário: saber se o dia e a semana estão no rumo, com a meta da semana
 * digitada por ele e um valor por dia útil que SE AJUSTA: se hoje entra menos,
 * o valor de amanhã sobe.
 *
 *   Falta             = meta - recebido
 *   Dias úteis        = dias úteis de hoje até a sexta (hoje conta se for útil;
 *                       fim de semana e feriado do Módulo 1 são pulados)
 *   Ritmo por dia útil = Falta / dias úteis, arredondado PARA CIMA no centavo
 *                       (a soma dos dias nunca fica abaixo da falta)
 *
 * RECEBIDO é o "Os dois" do Total recuperado (Isaac + Bianca; depósitos +
 * promessas cumpridas), o mesmo número que o painel mostra. Decisões do usuário
 * (02/10/2026): meta única que vale até ser trocada; bloco só na semana atual;
 * cada navegador guarda a sua (nada é compartilhado).
 *
 * POR QUE "RITMO" E NÃO "META DE HOJE EXATA": as promessas pagas hoje só entram
 * amanhã (a verificação é automática, de madrugada, no dia útil seguinte), então
 * o recebido do dia nunca está completo durante o dia. A tela diz isso. Se os
 * depósitos de hoje já entram na hora no consolidado NÃO foi confirmado: por isso
 * o texto fala só das promessas, e a conta usa o que o painel enxerga agora.
 *
 * Leitura do total com falha: o bloco diz que a meta está indisponível e NÃO
 * mostra número parcial (o Módulo 10 faz o mesmo com o total).
 *
 * ARMAZENAMENTO: smarttable_meta_semanal_v1 = { versao: 1, valor: <número> }.
 * Só o valor da meta (dado do próprio usuário), nada de cliente.
 *
 * Quem desenha o painel é o Módulo 10, que chama window.__metaSemanal.criarBloco
 * (se este módulo estiver carregado; sem ele o painel é o de sempre).
 * ONDE COLAR: depois do Módulo 0 (formatarMoeda, dataIso, normalizarData).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__metaSemanalCarregado) return;
  window.__metaSemanalCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Meta Semanal');

  const CONFIG_META = {
    CHAVE_STORAGE: 'smarttable_meta_semanal_v1',
    // Teto de sanidade: um zero a mais digitado sem querer não vira meta.
    VALOR_MAXIMO: 1e9,
    // Quantos dias olhar à frente ao contar dias úteis (uma semana tem 7).
    MAX_DIAS_DA_SEMANA: 7,
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
    barra: '#d1e7dd',
  };

  const util = () => window.__smartTableUtil;
  const arredondar = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  /** Arredonda PARA CIMA no centavo (e tolera o ruído de ponto flutuante). */
  const paraCimaNoCentavo = (n) => Math.ceil(Math.round(n * 1e6) / 1e4) / 100;

  /* ---------------------------------------------------------------------
   * VALOR DIGITADO
   * --------------------------------------------------------------------- */

  /**
   * "100.000,00", "100000", "R$ 100.000", "100000,5", "100.5" -> número.
   * Ponto com exatamente três dígitos depois é milhar ("100.000"); ponto com 1 ou 2
   * dígitos é decimal ("100.5"). Devolve null para o que não é um valor válido:
   * vazio, letra, negativo, zero, mais de duas casas, acima do teto.
   *
   * @param {unknown} texto
   * @returns {number|null}
   */
  function lerValor(texto) {
    const limpo = String(texto ?? '').replace(/R\$|\s/g, '');
    let numero;
    if (/^\d+$/.test(limpo)) numero = Number(limpo);
    else if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpo)) numero = Number(limpo.replace(/\./g, '').replace(',', '.'));
    else if (/^\d+,\d{1,2}$/.test(limpo)) numero = Number(limpo.replace(',', '.'));
    else if (/^\d+\.\d{1,2}$/.test(limpo)) numero = Number(limpo);
    else return null;
    if (!Number.isFinite(numero) || numero <= 0 || numero > CONFIG_META.VALOR_MAXIMO) return null;
    return arredondar(numero);
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO
   * --------------------------------------------------------------------- */

  /** @returns {number|null} A meta guardada, ou null (sem meta, ou valor corrompido). */
  function obterMeta() {
    try {
      const dados = JSON.parse(localStorage.getItem(CONFIG_META.CHAVE_STORAGE) || 'null');
      const valor = dados?.valor;
      return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 && valor <= CONFIG_META.VALOR_MAXIMO ? valor : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {number|null} valor null remove a meta.
   * @returns {boolean} false se não gravou (valor inválido ou o navegador recusou).
   */
  function salvarMeta(valor) {
    try {
      if (valor === null) {
        localStorage.removeItem(CONFIG_META.CHAVE_STORAGE);
        return true;
      }
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > CONFIG_META.VALOR_MAXIMO) return false;
      localStorage.setItem(CONFIG_META.CHAVE_STORAGE, JSON.stringify({ versao: 1, valor: arredondar(valor) }));
      return true;
    } catch (erro) {
      console.warn('[Meta semanal] Não consegui gravar a meta no localStorage.', erro?.name);
      return false;
    }
  }

  /* ---------------------------------------------------------------------
   * CÁLCULO
   * --------------------------------------------------------------------- */

  const dataDeIso = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0) : null;
  };

  /**
   * Dias úteis de `hojeIso` até `fimIso` (inclusive). Hoje conta se for útil.
   * @returns {{quantidade: number, primeiro: string|null}} primeiro = o primeiro dia útil da contagem
   */
  function diasUteisAte(hojeIso, fimIso, ehDiaUtilIso) {
    const d = dataDeIso(hojeIso);
    if (!d || !dataDeIso(fimIso)) return { quantidade: 0, primeiro: null };
    let quantidade = 0;
    let primeiro = null;
    for (let i = 0; i < CONFIG_META.MAX_DIAS_DA_SEMANA; i += 1) {
      const iso = util().dataIso(d);
      if (iso > fimIso) break;
      if (ehDiaUtilIso(iso)) {
        quantidade += 1;
        primeiro = primeiro ?? iso;
      }
      d.setDate(d.getDate() + 1);
    }
    return { quantidade, primeiro };
  }

  /**
   * @param {{meta: number, recebido: number, hojeIso: string, fimIso: string,
   *   ehDiaUtilIso: (iso: string) => boolean}} entrada
   * @returns {{meta: number, recebido: number, falta: number, excedente: number, batida: boolean,
   *   percentual: number, hojeUtil: boolean, diasUteis: number, primeiroDiaUtil: string|null,
   *   ritmo: number|null}} ritmo null = não sobra dia útil na semana.
   */
  function calcularMeta({ meta, recebido: recebidoBruto, hojeIso, fimIso, ehDiaUtilIso }) {
    // A soma de várias parcelas em ponto flutuante pode dar 99999,99999999999 onde a conta exata dá 100000.
    const recebido = arredondar(recebidoBruto);
    const batida = recebido >= meta;
    const { quantidade, primeiro } = diasUteisAte(hojeIso, fimIso, ehDiaUtilIso);
    const falta = batida ? 0 : arredondar(meta - recebido);
    let ritmo = null;
    if (batida) ritmo = 0;
    else if (quantidade > 0) ritmo = paraCimaNoCentavo(falta / quantidade);
    return {
      meta,
      recebido,
      falta,
      excedente: batida ? arredondar(recebido - meta) : 0,
      batida,
      // 100% só quando a meta foi batida: 99,6% não pode aparecer como 100% com dinheiro ainda faltando.
      percentual: batida ? Math.round((recebido / meta) * 100) : Math.min(99, Math.round((recebido / meta) * 100)),
      hojeUtil: !!ehDiaUtilIso(hojeIso),
      diasUteis: quantidade,
      primeiroDiaUtil: primeiro,
      ritmo,
    };
  }

  /* ---------------------------------------------------------------------
   * DESENHO
   * --------------------------------------------------------------------- */

  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  const moeda = (v) => util()?.formatarMoeda?.(v) ?? String(v);
  const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  function linha(rotulo, valor, estilo = {}) {
    const el = criarDiv('', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' });
    el.appendChild(criarDiv(rotulo, { color: CORES.texto }));
    el.appendChild(criarDiv(valor, { fontFamily: 'ui-monospace, monospace', color: CORES.texto, ...estilo }));
    return el;
  }

  /**
   * O bloco "Meta da semana". Redesenha a si mesmo ao salvar (não busca nada de novo).
   *
   * @param {{resumo: {totalGeral: number, totalIndisponivel: boolean}, semana: {fimIso: string},
   *   hojeIso: string, ehDiaUtilIso: (iso: string) => boolean}} entrada
   * @returns {HTMLElement}
   */
  function criarBloco({ resumo, semana, hojeIso, ehDiaUtilIso }) {
    const bloco = criarDiv('', { marginTop: '14px', paddingTop: '10px', borderTop: `1px solid ${CORES.linha}` });
    bloco.dataset.papel = 'meta-semanal';

    const desenhar = (devolverFoco = false) => {
      bloco.textContent = '';
      bloco.appendChild(criarDiv('Meta da semana', { color: CORES.tinta, fontWeight: '600', fontSize: '13px' }));
      bloco.appendChild(criarDiv('o Total recuperado dos dois contra a meta que você digita', {
        color: CORES.apagado, fontSize: '11px', marginBottom: '6px',
      }));

      const meta = obterMeta();

      // Campo da meta (vazio = sem meta).
      const formulario = criarDiv('', { display: 'flex', alignItems: 'center', gap: '8px', margin: '2px 0 4px' });
      formulario.appendChild(criarDiv('Meta', { color: CORES.texto }));
      const campo = document.createElement('input');
      campo.type = 'text';
      campo.inputMode = 'decimal';
      campo.dataset.campo = 'meta';
      campo.placeholder = 'R$ 0,00';
      campo.setAttribute('aria-label', 'Meta da semana em reais');
      campo.value = meta === null ? '' : moeda(meta);
      Object.assign(campo.style, {
        flex: '1', minWidth: '0', padding: '4px 8px', border: `1px solid ${CORES.borda}`, borderRadius: '6px',
        fontSize: '12.5px', fontFamily: 'ui-monospace, monospace',
      });
      const salvar = document.createElement('button');
      salvar.type = 'button';
      salvar.dataset.acao = 'salvar-meta';
      salvar.textContent = 'Salvar';
      Object.assign(salvar.style, {
        background: CORES.tinta, color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px',
        fontSize: '12.5px', fontWeight: '600', cursor: 'pointer',
      });
      formulario.appendChild(campo);
      formulario.appendChild(salvar);
      bloco.appendChild(formulario);
      // O bloco é redesenhado ao salvar: sem isto o foco iria para o body e o teclado ficaria sem destino.
      if (devolverFoco) campo.focus();

      const erro = criarDiv('', { color: CORES.erro, fontSize: '11.5px', marginBottom: '4px', display: 'none' });
      erro.dataset.papel = 'erro-meta';
      bloco.appendChild(erro);

      const aoSalvar = () => {
        const texto = campo.value.trim();
        if (texto === '') {
          if (salvarMeta(null)) desenhar(true);
          else util()?.toast?.('Não consegui apagar a meta (o navegador recusou a gravação).', 8000);
          return;
        }
        const valor = lerValor(texto);
        if (valor === null) {
          erro.textContent = 'Digite um valor maior que zero, por exemplo 100.000,00.';
          erro.style.display = 'block';
          return;
        }
        if (!salvarMeta(valor)) {
          erro.textContent = 'Não consegui salvar a meta (o navegador recusou a gravação).';
          erro.style.display = 'block';
          return;
        }
        desenhar(true);
      };
      salvar.addEventListener('click', aoSalvar);
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); aoSalvar(); }
      });

      if (resumo.totalIndisponivel) {
        bloco.appendChild(criarDiv('Meta indisponível: o total não pôde ser lido (veja acima).', { color: CORES.erro, fontSize: '12px', padding: '3px 0' }));
        return;
      }
      if (meta === null) {
        bloco.appendChild(criarDiv('Digite a meta da semana (valor dos dois, Isaac e Bianca) e salve.', { color: CORES.apagado, fontSize: '12px', padding: '3px 0' }));
        return;
      }

      const c = calcularMeta({ meta, recebido: resumo.totalGeral, hojeIso, fimIso: semana.fimIso, ehDiaUtilIso });

      const andamento = linha('Recebido', `${moeda(c.recebido)} (${c.percentual}%)`);
      andamento.dataset.papel = 'meta-recebido';
      bloco.appendChild(andamento);
      const trilho = criarDiv('', { height: '6px', borderRadius: '3px', background: CORES.linha, overflow: 'hidden', margin: '2px 0 4px' });
      const preenchido = criarDiv('', { height: '100%', width: `${Math.min(100, Math.max(0, c.percentual))}%`, background: c.batida ? CORES.destaque : CORES.barra });
      preenchido.dataset.papel = 'meta-barra';
      trilho.appendChild(preenchido);
      bloco.appendChild(trilho);

      if (c.batida) {
        bloco.appendChild(criarDiv(`✓ Meta da semana batida: ${moeda(c.excedente)} acima.`, {
          color: CORES.destaque, fontWeight: '700', padding: '3px 0',
        }));
      } else {
        const falta = linha('Falta', moeda(c.falta));
        falta.dataset.papel = 'meta-falta';
        bloco.appendChild(falta);
      }

      if (c.diasUteis === 0) {
        bloco.appendChild(criarDiv('Sem dia útil restante nesta semana.', { color: CORES.apagado, fontSize: '12px', padding: '3px 0' }));
      } else {
        const rotuloDias = c.hojeUtil ? 'Dias úteis restantes (contando hoje)' : 'Dias úteis restantes';
        const dias = linha(rotuloDias, String(c.diasUteis));
        dias.dataset.papel = 'meta-dias';
        bloco.appendChild(dias);
        const rotuloRitmo = c.hojeUtil ? 'Ritmo por dia útil' : `Ritmo para o próximo dia útil (${diaMes(c.primeiroDiaUtil)})`;
        const ritmo = linha(rotuloRitmo, moeda(c.ritmo), { color: CORES.destaque, fontWeight: '700' });
        ritmo.dataset.papel = 'meta-ritmo';
        bloco.appendChild(ritmo);
      }
      bloco.appendChild(criarDiv('As promessas pagas hoje só aparecem amanhã.', { color: CORES.apagado, fontSize: '11px', marginTop: '4px' }));
    };

    desenhar();
    return bloco;
  }

  window.__metaSemanal = {
    lerValor,
    obterMeta,
    salvarMeta,
    calcularMeta,
    diasUteisAte,
    criarBloco,
    CONFIG_META,
  };
})();
