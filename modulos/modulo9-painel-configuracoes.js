/* =========================================================================
 * MÓDULO 9: PAINEL DE CONFIGURAÇÕES (Alt+O) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Uma janelinha com interruptores, aberta e fechada pelo Alt+O.
 *
 * POR QUE EXISTE: até aqui, toda escolha de comportamento virava constante
 * no código -- pra trocar era preciso editar um módulo e publicar uma
 * versão. O primeiro caso concreto foi o canal do WhatsApp (app Desktop x
 * web.whatsapp.com), que precisa mudar por MÁQUINA e às vezes por DIA:
 * atender pela conta de outra pessoa sem desvincular a sua do app.
 *
 * FEITO PRA SER REUTILIZADO, a pedido do usuário. Este arquivo não conhece
 * nenhuma configuração específica: ele lê `window.__smartTableUtil.config`
 * e desenha o que estiver declarado lá. Acrescentar um interruptor novo é
 * uma entrada em DEFINICOES no Módulo 0 -- nada aqui muda.
 *
 * ONDE COLAR: depois do Módulo 0 (de quem lê as definições) e antes ou
 * depois do Módulo 4 -- o atalho do Módulo 4 chama por
 * window.__painelConfiguracoes, checando existência, então a ordem entre os
 * dois não importa.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__painelConfiguracoesCarregado) return;
  window.__painelConfiguracoesCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Painel de Configurações');

  const CONFIG_PAINEL = {
    ID_PAINEL: 'smarttable-painel-config',
    // Mesmo z-index do painel de novidades (Módulo 4): ABAIXO dos modais do
    // CRM, que usam z-50. Já tivemos o bug de um elemento nosso cortando um
    // modal do CRM ao meio; a regra é essa e não se abre exceção sem motivo.
    // (O banner de grupo do Módulo 5, que seguia a mesma regra, saiu na
    // v1.14.0.)
    Z_INDEX: 30,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    ligado: '#1B6B4A',
    desligado: '#d0d5dd',
    fundo: '#ffffff',
  };

  let painelEl = null;

  /**
   * A configuração compartilhada do Módulo 0.
   *
   * Lida na hora do uso, e não no carregamento: se o Módulo 0 falhar, o
   * painel avisa na tela em vez de estourar um TypeError no meio da
   * cobrança.
   *
   * @returns {object|null}
   */
  function obterConfig() {
    return window.__smartTableUtil?.config ?? null;
  }

  /**
   * Desenha o interruptor em si (a "pilha" que desliza).
   *
   * @param {boolean} ligado Estado inicial.
   * @returns {{el: HTMLElement, pintar: (ligado: boolean) => void}}
   */
  function criarInterruptor(ligado) {
    const trilho = document.createElement('span');
    Object.assign(trilho.style, {
      display: 'inline-block',
      position: 'relative',
      width: '38px',
      height: '22px',
      borderRadius: '11px',
      flexShrink: '0',
      transition: 'background-color .18s ease',
    });

    const bolinha = document.createElement('span');
    Object.assign(bolinha.style, {
      position: 'absolute',
      top: '3px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      transition: 'left .18s ease',
    });
    trilho.appendChild(bolinha);

    const pintar = (estaLigado) => {
      trilho.style.background = estaLigado ? CORES.ligado : CORES.desligado;
      bolinha.style.left = estaLigado ? '19px' : '3px';
    };
    pintar(ligado);

    return { el: trilho, pintar };
  }

  /**
   * Uma linha do painel: título, descrição e interruptor.
   *
   * @param {string} chave Chave da definição no Módulo 0.
   * @param {object} definicao {titulo, descricao, padrao}.
   * @param {object} config O `config` do Módulo 0.
   * @returns {HTMLElement}
   */
  function criarLinha(chave, definicao, config) {
    const linha = document.createElement('div');
    linha.setAttribute('role', 'switch');
    linha.setAttribute('tabindex', '0');
    linha.dataset.chave = chave;
    Object.assign(linha.style, {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '10px 2px',
      borderTop: `1px solid ${CORES.linha}`,
      cursor: 'pointer',
    });

    const textos = document.createElement('div');
    textos.style.flex = '1';

    const titulo = document.createElement('div');
    titulo.textContent = definicao.titulo;
    Object.assign(titulo.style, { color: CORES.tinta, fontWeight: '600', fontSize: '13px' });
    textos.appendChild(titulo);

    const descricao = document.createElement('div');
    descricao.textContent = definicao.descricao;
    Object.assign(descricao.style, {
      color: CORES.apagado, fontSize: '11.5px', lineHeight: '1.45', marginTop: '3px',
    });
    textos.appendChild(descricao);

    linha.appendChild(textos);

    const ligadoAgora = config.ligado(chave);
    const interruptor = criarInterruptor(ligadoAgora);
    linha.appendChild(interruptor.el);
    linha.setAttribute('aria-checked', String(ligadoAgora));

    const alternar = () => {
      // O valor pintado é o que config.alternar DEVOLVE, não o que a gente
      // imagina que ficou. Se o localStorage recusar a gravação (cota cheia,
      // aba anônima), ele devolve o valor que continua em vigor -- e o
      // interruptor não desliza. A tela nunca mente sobre o que está valendo.
      const agora = config.alternar(chave);
      interruptor.pintar(agora);
      linha.setAttribute('aria-checked', String(agora));
    };

    linha.addEventListener('click', alternar);
    linha.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        alternar();
      }
    });

    return linha;
  }

  /** @param {string} texto @returns {HTMLElement} */
  function criarAviso(texto) {
    const el = document.createElement('div');
    el.textContent = texto;
    Object.assign(el.style, {
      color: '#B42318', fontSize: '12px', lineHeight: '1.5', padding: '8px 0',
    });
    return el;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function abrirPainel() {
    // Só um painel flutuante nosso na tela por vez (ver registrarPainel no
    // Módulo 0 e o defeito que motivou isso).
    window.__smartTableUtil?.fecharOutrosPaineis?.('configuracoes');

    const config = obterConfig();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_PAINEL.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      bottom: '112px',
      left: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_PAINEL.Z_INDEX,
      width: '420px',
      maxWidth: '90vw',
      maxHeight: '60vh',
      overflowY: 'auto',
    });

    const titulo = document.createElement('div');
    titulo.textContent = 'Configurações';
    Object.assign(titulo.style, {
      color: CORES.tinta, fontWeight: '700', fontSize: '14px',
      paddingBottom: '6px', position: 'sticky', top: '0', background: CORES.fundo,
    });
    painelEl.appendChild(titulo);

    if (!config) {
      painelEl.appendChild(criarAviso(
        'O Módulo 0 (utilitários compartilhados) não carregou, então não dá pra ler nem gravar ' +
        'configuração. Confira o console: provavelmente é cache antigo do Tampermonkey.'
      ));
    } else {
      const chaves = Object.keys(config.DEFINICOES);
      if (chaves.length === 0) {
        const vazio = document.createElement('div');
        vazio.textContent = 'Nenhuma configuração disponível nesta versão.';
        Object.assign(vazio.style, { color: CORES.apagado, fontSize: '12px', padding: '10px 0' });
        painelEl.appendChild(vazio);
      } else {
        chaves.forEach((chave) => {
          painelEl.appendChild(criarLinha(chave, config.DEFINICOES[chave], config));
        });
      }
    }

    const dica = document.createElement('div');
    dica.textContent = 'Vale na hora, sem recarregar a página — Alt+O ou Esc pra fechar';
    Object.assign(dica.style, {
      marginTop: '6px', paddingTop: '8px', borderTop: `1px solid ${CORES.linha}`,
      color: CORES.apagado, fontSize: '11px', textAlign: 'center',
      position: 'sticky', bottom: '0', background: CORES.fundo,
    });
    painelEl.appendChild(dica);

    document.body.appendChild(painelEl);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(painelEl);
  }

  /**
   * Abre se estiver fechado, fecha se estiver aberto.
   * É o que o Alt+O chama.
   */
  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel();
  }

  // Esc fecha. Registrado uma vez só, na carga do módulo, porque um listener
  // por abertura vazaria a cada Alt+O -- e este script fica aberto o dia
  // inteiro na mesma aba.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  window.__smartTableUtil?.registrarPainel?.('configuracoes', fecharPainel);

  window.__painelConfiguracoes = {
    alternarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelEl !== null,
    CONFIG_PAINEL,
  };
})();
