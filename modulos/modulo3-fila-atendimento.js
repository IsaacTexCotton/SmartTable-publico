/* =========================================================================
 * MÓDULO 3: FILA DE ATENDIMENTO — CRM TexCotton
 * -------------------------------------------------------------------------
 * O que faz: mantém a lista de clientes a atender e sua posição nela. Ao
 * detectar que "Registrar e Enviar" (Módulo 2) teve sucesso (WhatsApp
 * abriu), marca o cliente atual como atendido -- mas NÃO navega sozinho
 * pro próximo. O avanço de fato é sempre uma decisão sua: Alt+P ou o botão
 * "Próximo →" no painel, quando você estiver pronto.
 *
 * Onde colar: anexado ao FINAL do smart-table.js, depois dos módulos
 * "Aviso de Cobrança" (v4) e "Registrar e Enviar". Não substitui nada.
 *
 * Como usar no dia a dia:
 *   1. Abra a página que lista os clientes que você vai atender.
 *   2. Clique no botão flutuante "▶ Iniciar Fila de Atendimento" (canto
 *      inferior esquerdo). Isso te leva direto pro primeiro cliente.
 *   3. Em cada cliente, use o fluxo normal (ver títulos, gerar relatório,
 *      "Registrar e Enviar"). Ao detectar que o WhatsApp abriu, o cliente
 *      fica marcado como atendido -- a página continua a mesma até você
 *      decidir ir pro próximo.
 *   4. Quando quiser seguir, aperte Alt+P (ou clique "Próximo →" no painel).
 *      Se o cliente atual já foi registrado, ele conta como "atendido" no
 *      resumo final; senão conta como "pulado".
 *   5. Avançou rápido demais ou quer revisitar o anterior? Alt+V (ou
 *      "← Voltar" no painel) volta um cliente, desfazendo a contagem
 *      daquele passo pra não inflar o resumo final se você for e voltar
 *      várias vezes.
 *   6. Quando a fila acabar, aparece um aviso e o painel some sozinho.
 *
 * Matriz e filial da mesma empresa (mesma raiz de CNPJ, os 8 primeiros
 * dígitos) contam como UM cliente só na fila -- CONFIRMADO com o usuário
 * depois de reproduzir na prática (duas empresas apareceram duplicadas,
 * cada uma com CNPJs de matriz/filial diferentes). Mantém a entrada mais
 * urgente (mais dias de atraso) entre as duplicatas.
 *
 * IMPORTANTE — calibração inicial:
 *   A fila NÃO depende de <a href> (a lista real não usa links — a linha
 *   navega via JavaScript). Em vez disso, ela lê o texto
 *   "Controle: {grupoId}|{cnpj}" de cada linha e remonta a URL de destino
 *   (confirmado com exemplo real, CNPJ trocado por um fictício: Controle: 0|12345678/0001-99 ->
 *   /crm/clientes/grupo/0?cnpj=12345678%2F0001-99). Se o formato da lista
 *   mudar no futuro, ajuste CONFIG.REGEX_CONTROLE e/ou
 *   window.__smartTableUtil.montarUrlCliente (Módulo 0).
 * ========================================================================= */
(function () {
  'use strict';

  // Evita inicializar duas vezes se o arquivo for injetado/recarregado mais de uma vez.
  if (window.__filaAtendimentoCarregado) return;
  window.__filaAtendimentoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Fila de Atendimento');

  // Utilitários compartilhados (Módulo 0) -- precisa estar carregado ANTES
  // deste arquivo no @require do wrapper.
  const { toast, montarUrlCliente } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO — únicos pontos que talvez precisem de ajuste.
   * --------------------------------------------------------------------- */
  const CONFIG = {
    // Seletor das linhas candidatas na página de LISTA de clientes.
    SELETOR_LINHA: 'table tbody tr',
    // A lista não usa <a href>: a linha não é um link, o clique nela navega
    // via JavaScript. Em compensação, cada linha traz o texto
    // "Controle: {grupoId}|{cnpj}" — é esse padrão que usamos pra
    // reconstruir a URL de destino sem precisar de link nenhum.
    REGEX_CONTROLE: /Controle:\s*(\d+)\|([\d.\/-]+)/,
    // Texto usado para identificar o botão "Registrar e Enviar" (o script
    // procura esse trecho, em minúsculas, dentro do texto de qualquer botão).
    TEXTO_BOTAO_REGISTRAR: 'registrar e enviar',
    // Tempo máximo (ms) esperando o WhatsApp abrir (window.open) depois do
    // clique, antes de desistir de considerar que deu certo.
    TIMEOUT_SUCESSO_MS: 1200,
    // Intervalo (ms) da sondagem que reembrulha window.abrirWhatsAppCliente
    // se a página redefinir -- ver instalarDeteccaoAbrirWhatsApp. Curto o
    // bastante pra nunca perder um clique real (a folga entre a página
    // redefinir a função e o operador clicar é sempre de vários segundos,
    // não milissegundos), barato o bastante pra rodar o tempo todo sem
    // custo perceptível (só uma comparação de flag booleana por tique).
    SONDAGEM_ABRIR_WHATSAPP_MS: 200,
    // Regex pra extrair "X dias" do texto da linha, usado pra priorizar a
    // fila por urgência (mais dias de atraso primeiro). Ajuste se a lista
    // mostrar esse dado com outro texto (ex.: "15d" em vez de "15 dias").
    REGEX_DIAS_ATRASO: /(\d+)\s*dias?/i,
    // Chave usada no localStorage (não sessionStorage -- ver nota abaixo).
    CHAVE_STORAGE: 'filaAtendimento_v1',
    // Chave separada pra lembrar quem já foi atendido HOJE (evita cobrar o
    // mesmo cliente duas vezes no mesmo dia, mesmo em filas diferentes).
    CHAVE_ATENDIDOS_HOJE: 'filaAtendidosHoje_v1',
    // Versão do formato salvo no localStorage. Se um dia o formato mudar,
    // incremente isso -- qualquer fila salva com versão diferente é
    // descartada automaticamente em vez de causar erro (ver validarFila).
    VERSAO_SCHEMA: 1,
  };

  /* ---------------------------------------------------------------------
   * 2. ESTADO DO MÓDULO
   * --------------------------------------------------------------------- */
  let painelEl = null;      // referência ao painel flutuante "Fila: X/Y"
  let paginaNaFila = false; // true se a página atual corresponde a uma posição conhecida da fila
  let avancando = false;    // trava contra cliques duplicados enquanto aguardamos o WhatsApp abrir
  // Trava contra dupla marcação do MESMO sucesso (ver marcarSucessoDoRegistro).
  // SEPARADA de "avancando" de propósito -- ver BUG REAL no comentário de
  // marcarSucessoDoRegistro logo abaixo.
  let sucessoJaProcessado = false;

  /* ---------------------------------------------------------------------
   * 3. UTILITÁRIOS
   * --------------------------------------------------------------------- */
  function extrairCnpjDaUrl(url) {
    // O cnpj é o identificador real do cliente na URL (o grupoId pode se
    // repetir entre clientes do mesmo grupo econômico, então não serve
    // sozinho pra saber "em qual cliente da fila eu estou").
    try {
      const u = new URL(url, location.href);
      return u.searchParams.get('cnpj') || '';
    } catch (e) {
      return '';
    }
  }

  function validarFormatoDaFila(fila) {
    // Defesa contra dado corrompido/desatualizado no localStorage (ex.: um
    // formato antigo de uma versão anterior deste script). Sem isso, um
    // único registro mal-formado pode lançar exceção em sincronizarPosicao()
    // -- que roda em TODA página -- e travar a automação inteira da sessão
    // ANTES do listener de clique ser registrado.
    if (!fila || typeof fila !== 'object') return false;
    if (fila.versao !== CONFIG.VERSAO_SCHEMA) return false;
    if (!Array.isArray(fila.clientes)) return false;
    if (typeof fila.indiceAtual !== 'number') return false;
    return fila.clientes.every(
      (c) => c && typeof c.url === 'string' && typeof c.cnpj === 'string'
    );
  }

  function obterFila() {
    try {
      const raw = localStorage.getItem(CONFIG.CHAVE_STORAGE);
      const fila = raw ? JSON.parse(raw) : null;
      if (!fila) return null;

      if (!validarFormatoDaFila(fila)) {
        console.warn('[Fila] Fila salva no localStorage está em formato inválido/desatualizado -- descartando.');
        limparFila();
        return null;
      }

      // Uma fila de um dia anterior é descartada automaticamente -- não faz
      // sentido "continuar" uma fila de ontem sem avisar.
      if (!mesmoDiaDeHoje(fila.iniciadoEm)) {
        limparFila();
        return null;
      }
      return fila;
    } catch (e) {
      console.warn('[Fila] Não consegui ler o localStorage -- tratando como se não houvesse fila.', e);
      return null;
    }
  }

  function salvarFila(fila) {
    try {
      localStorage.setItem(CONFIG.CHAVE_STORAGE, JSON.stringify(fila));
    } catch (e) {
      console.warn('[Fila] Não consegui salvar no localStorage.', e);
    }
  }

  function limparFila() {
    try {
      localStorage.removeItem(CONFIG.CHAVE_STORAGE);
    } catch (e) {
      // silencioso — não é crítico
    }
  }

  function mesmoDiaDeHoje(timestampMs) {
    if (!timestampMs) return false;
    const d1 = new Date(timestampMs);
    const d2 = new Date();
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  // "Atendidos hoje": persiste separado da fila (localStorage também), pra
  // sobreviver mesmo depois de uma fila terminar ou ser trocada por outra.
  // Reseta sozinho quando o dia vira -- não precisa de faxina manual.
  function obterAtendidosHoje() {
    try {
      const raw = localStorage.getItem(CONFIG.CHAVE_ATENDIDOS_HOJE);
      if (!raw) return new Set();
      const dados = JSON.parse(raw);
      if (!mesmoDiaDeHoje(dados.data)) return new Set();
      return new Set(dados.cnpjs || []);
    } catch (e) {
      return new Set();
    }
  }

  function marcarComoAtendidoHoje(cnpj) {
    if (!cnpj) return;
    try {
      const atuais = obterAtendidosHoje();
      atuais.add(cnpj);
      localStorage.setItem(
        CONFIG.CHAVE_ATENDIDOS_HOJE,
        JSON.stringify({ data: Date.now(), cnpjs: Array.from(atuais) })
      );
    } catch (e) {
      console.warn('[Fila] Não consegui salvar em "atendidos hoje".', e);
    }
  }

  function extrairDiasAtraso(texto) {
    const match = (texto || '').match(CONFIG.REGEX_DIAS_ATRASO);
    return match ? parseInt(match[1], 10) : 0;
  }

  /* ---------------------------------------------------------------------
   * 3.5. ANCORAGEM EM PONTOS NATURAIS DO LAYOUT
   * Em vez de flutuar (position: fixed) por cima da tela, tenta encaixar
   * os botões/painel da fila dentro de áreas que já existem no CRM --
   * confirmado com HTML real da página de cliente e da lista (usuário
   * forneceu). Se o seletor não bater (CRM mudou o layout), cada ponto de
   * uso cai de volta pro position: fixed antigo -- nunca quebra, só fica
   * menos integrado visualmente.
   * --------------------------------------------------------------------- */
  // Página de CLIENTE: a linha de ações (Contato / Negociação / Tarefa e,
  // quando existe, o "Fluxo de Cobrança" nativo com Anterior/Próximo) --
  // é o lugar mais natural pro painel de fila, que faz a mesma coisa
  // (navegar por uma sequência de clientes).
  function ancoraAcoesCliente() {
    const btnContato = document.querySelector('[onclick^="openModalContato"]');
    if (btnContato?.parentElement) return btnContato.parentElement;
    const fluxo = document.getElementById('fluxo-cobranca');
    if (fluxo?.parentElement) return fluxo.parentElement;
    return null;
  }

  // Página de LISTA: a barra de filtros (onde já vivem "Filtros avançados"
  // e "Limpar") ou, faltando ela, a toolbar da própria tabela de clientes.
  function ancoraToolbarLista() {
    return document.querySelector('.pbi-filters-row')
      || document.querySelector('.pbi-filters-bar')
      || document.querySelector('#tabela-clientes .st-toolbar')
      || null;
  }

  /* ---------------------------------------------------------------------
   * 4. PAINEL FLUTUANTE (mostra "Fila: X/Y" enquanto está ativa)
   * --------------------------------------------------------------------- */
  function removerPainel() {
    if (painelEl) {
      painelEl.remove();
      painelEl = null;
    }
  }

  function atualizarPainel() {
    const fila = obterFila();
    if (!fila || !paginaNaFila) {
      removerPainel();
      return;
    }

    if (!painelEl) {
      painelEl = document.createElement('div');
      const ancora = ancoraAcoesCliente();
      if (ancora) {
        Object.assign(painelEl.style, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '10px',
          background: '#ffffff',
          border: '1px solid #d0d5dd',
          borderRadius: '8px',
          padding: '6px 10px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
        });
        ancora.appendChild(painelEl);
      } else {
        // Fallback: seletor de ancoragem não encontrado -- volta pro
        // comportamento antigo (flutuante) em vez de não mostrar nada.
        Object.assign(painelEl.style, {
          position: 'fixed',
          // Abaixo do cabeçalho fixo do CRM (80px), não por cima dele (v1.38.0).
          top: `${(window.__smartTableUtil?.alturaCabecalho?.() ?? 0) + 16}px`,
          right: '16px',
          background: '#ffffff',
          border: '1px solid #d0d5dd',
          borderRadius: '10px',
          padding: '10px 14px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          zIndex: 999998,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        });
        document.body.appendChild(painelEl);
      }
    }

    const posicao = fila.indiceAtual + 1;
    const total = fila.clientes.length;

    painelEl.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = `Fila: ${posicao}/${total}`;
    label.style.color = '#16232F';
    label.style.fontWeight = '600';
    label.style.whiteSpace = 'nowrap';

    const btnVoltar = document.createElement('button');
    btnVoltar.type = 'button';
    btnVoltar.textContent = '← Voltar';
    Object.assign(btnVoltar.style, {
      cursor: 'pointer', border: 'none', background: '#eef2f6',
      color: '#16232F', padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
    });
    if (fila.indiceAtual === 0) {
      btnVoltar.disabled = true;
      btnVoltar.style.opacity = '0.4';
      btnVoltar.style.cursor = 'default';
    }
    btnVoltar.onclick = () => irParaAnterior();

    const btnPular = document.createElement('button');
    btnPular.type = 'button';
    btnPular.textContent = 'Próximo →';
    Object.assign(btnPular.style, {
      cursor: 'pointer', border: 'none', background: '#eef2f6',
      color: '#16232F', padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
    });
    btnPular.onclick = () => irParaProximo('pulado');

    const btnEncerrar = document.createElement('button');
    btnEncerrar.type = 'button';
    btnEncerrar.textContent = 'Encerrar';
    Object.assign(btnEncerrar.style, {
      cursor: 'pointer', border: 'none', background: 'transparent',
      color: '#b42318', padding: '6px 8px', borderRadius: '6px', fontSize: '12px',
    });
    btnEncerrar.onclick = () => {
      limparFila();
      removerPainel();
      toast('Fila encerrada.');
    };

    painelEl.appendChild(label);
    painelEl.appendChild(btnVoltar);
    painelEl.appendChild(btnPular);
    painelEl.appendChild(btnEncerrar);
  }

  /* ---------------------------------------------------------------------
   * 5. CONSTRUÇÃO DA FILA (rodado na página de LISTA de clientes)
   * --------------------------------------------------------------------- */
  // Raiz do CNPJ (8 primeiros dígitos) -- comum entre matriz e TODAS as
  // filiais da mesma empresa (só o número de ordem e o dígito verificador
  // depois da barra mudam). Ignora pontuação, pra não depender de como o
  // CRM formata em cada linha.
  function extrairRaizCnpj(cnpj) {
    return (cnpj || '').replace(/\D/g, '').slice(0, 8);
  }

  // BUG REAL (relatado pelo usuário): o botão "▶ Iniciar Fila de Atendimento"
  // era criado incondicionalmente em toda página do CRM (iniciar() chamava
  // criarBotaoIniciarFila() sem checar nada antes) -- aparecia até em telas
  // onde não faz sentido nenhum e clicar nele só mostrava "nenhum cliente
  // encontrado". Confirmado com o usuário que a navegação aqui é
  // multi-página (recarrega de verdade a cada tela), então um único check
  // síncrono na carga da página já resolve -- sem precisar de
  // MutationObserver nem detectar troca de rota. Usa exatamente o mesmo
  // critério que construirFilaAPartirDaPagina() usa de verdade (linha com
  // "Controle: X|Y" reconhecível), pra nunca divergir do que a fila
  // realmente consegue montar.
  function paginaTemClientesParaFila() {
    const linhas = document.querySelectorAll(CONFIG.SELETOR_LINHA);
    for (const linha of linhas) {
      if (CONFIG.REGEX_CONTROLE.test(linha.textContent || '')) return true;
    }
    return false;
  }

  function construirFilaAPartirDaPagina() {
    const linhas = document.querySelectorAll(CONFIG.SELETOR_LINHA);
    // Chave = raiz do CNPJ, valor = melhor candidato encontrado até agora
    // pra essa empresa. CONFIRMADO com o usuário (reproduzido na fila real:
    // "CORREA CALÇADOS INFANTIS LTDA" e "ZIGGI COMERCIO DE ITENS INFANTIS
    // LTDA" apareceram duas vezes cada, matriz e filial com CNPJs
    // diferentes mas mesma raiz) -- matriz/filial contam como UM cliente só
    // na fila, mantendo a entrada com mais dias de atraso entre elas.
    const porRaizCnpj = new Map();
    const vistos = new Set(); // defesa extra contra a MESMA linha aparecer 2x no DOM
    const atendidosHoje = obterAtendidosHoje();
    let pulosPorJaAtendido = 0;
    let unificadosPorMatrizFilial = 0;

    linhas.forEach((linha) => {
      const texto = linha.textContent || '';
      const match = texto.match(CONFIG.REGEX_CONTROLE);
      if (!match) return; // linha sem "Controle: X|Y" reconhecível — ignora

      const grupoId = match[1];
      const cnpj = match[2];

      if (vistos.has(cnpj)) return;
      vistos.add(cnpj);

      if (atendidosHoje.has(cnpj)) {
        pulosPorJaAtendido += 1;
        return; // já foi atendido hoje -- não bota na fila de novo
      }

      const url = montarUrlCliente(grupoId, cnpj);
      const nome = texto.split('Controle:')[0].trim().slice(0, 60) || 'Cliente';
      const diasAtraso = extrairDiasAtraso(texto);
      const candidato = { url, cnpj, label: nome, diasAtraso };

      const raiz = extrairRaizCnpj(cnpj);
      const existente = porRaizCnpj.get(raiz);
      if (!existente) {
        porRaizCnpj.set(raiz, candidato);
      } else {
        unificadosPorMatrizFilial += 1;
        if (candidato.diasAtraso > existente.diasAtraso) {
          porRaizCnpj.set(raiz, candidato); // essa filial está mais atrasada -- vira a representante
        }
      }
    });

    const clientes = Array.from(porRaizCnpj.values());

    // Prioriza por urgência: mais dias de atraso primeiro. Quem não tem
    // "X dias" reconhecível fica com diasAtraso=0, então vai pro final.
    clientes.sort((a, b) => b.diasAtraso - a.diasAtraso);

    if (pulosPorJaAtendido > 0) {
      console.log(`[Fila] ${pulosPorJaAtendido} cliente(s) já atendido(s) hoje foram pulados na montagem da fila.`);
    }
    if (unificadosPorMatrizFilial > 0) {
      console.log(`[Fila] ${unificadosPorMatrizFilial} entrada(s) de matriz/filial da mesma empresa foram unificadas na montagem da fila.`);
    }

    return clientes;
  }

  function iniciarFila() {
    const clientes = construirFilaAPartirDaPagina();

    if (clientes.length === 0) {
      toast('⚠️ Nenhum cliente encontrado nesta página com os seletores atuais. Rode o diagnóstico e ajuste CONFIG.');
      console.warn('[Fila] construirFilaAPartirDaPagina() não encontrou nada. Verifique se CONFIG.SELETOR_LINHA ainda encontra as linhas e se o texto delas ainda contém "Controle: X|Y" no formato esperado por CONFIG.REGEX_CONTROLE.');
      return;
    }

    const fila = {
      versao: CONFIG.VERSAO_SCHEMA,
      clientes,
      indiceAtual: -1,
      totalAtendidos: 0,
      totalPulados: 0,
      iniciadoEm: Date.now(),
    };

    salvarFila(fila);
    toast(`▶ Fila iniciada com ${clientes.length} cliente(s). Indo para o primeiro...`);

    setTimeout(() => {
      window.location.href = clientes[0].url;
    }, 400);
  }

  function criarBotaoIniciarFila() {
    if (document.getElementById('fila-btn-iniciar')) return;

    const btn = document.createElement('button');
    btn.id = 'fila-btn-iniciar';
    btn.type = 'button';
    btn.textContent = '▶ Iniciar Fila de Atendimento';
    btn.onclick = iniciarFila;

    const ancora = ancoraToolbarLista();
    if (ancora) {
      // Reaproveita a classe dos botões nativos da barra de filtros
      // (mesmo visual de "Filtros avançados"), só trocando a cor de fundo
      // pra destacar que é uma ação, não um filtro.
      btn.className = 'pbi-btn pbi-btn-quiet';
      Object.assign(btn.style, {
        background: '#16232F',
        borderColor: '#16232F',
        color: '#fff',
      });
      ancora.appendChild(btn);
      return;
    }

    // Fallback: seletor de ancoragem não encontrado -- volta pro
    // comportamento antigo (flutuante).
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      background: '#16232F',
      color: '#fff',
      border: 'none',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      cursor: 'pointer',
      zIndex: 999997,
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    document.body.appendChild(btn);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(btn);
  }

  function removerBotaoRetomar() {
    const el = document.getElementById('fila-btn-retomar');
    if (el) el.remove();
  }

  function criarBotaoRetomar(fila) {
    if (document.getElementById('fila-btn-retomar')) return;

    // BUG REAL (relatado pelo usuário): o clique mandava pra
    // clientes[indiceAtual + 1] -- ou seja, sempre PULAVA o cliente onde a
    // pessoa realmente tinha parado (ex.: fechou o navegador ou navegou pra
    // fora da fila no meio do atendimento) e ia direto pro próximo. indiceAtual
    // é sincronizado (sincronizarPosicao) toda vez que a página bate com um
    // cliente da fila -- ele já É "onde eu parei", não precisa de +1.
    // indiceAtual só fica -1 se a fila foi criada mas a pessoa nunca chegou
    // a visitar o primeiro cliente (caso raríssimo) -- Math.max cobre isso
    // voltando pro início em vez de tentar acessar um índice negativo.
    const indiceRetomada = Math.max(0, fila.indiceAtual);
    const restantes = fila.clientes.length - indiceRetomada;
    if (restantes <= 0) return; // não sobrou nada pra retomar

    const btn = document.createElement('button');
    btn.id = 'fila-btn-retomar';
    btn.type = 'button';
    btn.textContent = `↻ Continuar fila anterior (${restantes} restante${restantes > 1 ? 's' : ''})`;
    btn.onclick = () => {
      const clienteParaRetomar = fila.clientes[indiceRetomada];
      if (clienteParaRetomar) window.location.href = clienteParaRetomar.url;
    };

    const ancora = ancoraToolbarLista();
    if (ancora) {
      // Ação secundária (retomar é menos comum que iniciar do zero) --
      // usa o estilo "ghost", mais discreto, também já usado na barra
      // (mesmo padrão do botão "Limpar").
      btn.className = 'pbi-btn pbi-btn-ghost';
      Object.assign(btn.style, {
        color: '#B45309',
        borderColor: '#B45309',
      });
      ancora.appendChild(btn);
      return;
    }

    // Fallback: seletor de ancoragem não encontrado -- volta pro
    // comportamento antigo (flutuante).
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '60px',
      left: '16px',
      background: '#B45309',
      color: '#fff',
      border: 'none',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      cursor: 'pointer',
      zIndex: 999997,
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    document.body.appendChild(btn);
    // Fora do menu lateral do CRM, e acompanhando quando ele recolhe (v1.38.0).
    window.__smartTableUtil?.acompanharMenuLateral?.(btn);
  }

  /* ---------------------------------------------------------------------
   * 6. AVANÇO NA FILA (rodado na página de DETALHE do cliente)
   * --------------------------------------------------------------------- */
  function irParaProximo(motivo) {
    const fila = obterFila();
    if (!fila || fila.indiceAtual === -1 || fila.indiceAtual === null) return;

    const clienteAtual = fila.clientes[fila.indiceAtual];
    // Se o cliente atual já foi registrado com sucesso (Alt+S ou clique
    // manual em "Registrar e Enviar"), conta como "atendido" mesmo que
    // você tenha avançado pelo botão "Próximo →" (que também serve pra
    // pular sem registrar) -- ver registrarSucessoSemAvancar().
    const jaRegistrado = fila.indiceRegistrado === fila.indiceAtual;
    const motivoEfetivo = jaRegistrado ? 'atendido' : motivo;

    if (motivoEfetivo === 'atendido') {
      fila.totalAtendidos = (fila.totalAtendidos || 0) + 1;
      if (clienteAtual && !jaRegistrado) marcarComoAtendidoHoje(clienteAtual.cnpj);
    } else {
      fila.totalPulados = (fila.totalPulados || 0) + 1;
    }

    // Guarda o que este passo contou, pra irParaAnterior() poder desfazer
    // exatamente essa contagem se você voltar depois -- sem isso, ir e
    // voltar repetidas vezes infla o resumo final.
    fila.ultimoMotivo = motivoEfetivo;
    fila.indiceAtual += 1;
    delete fila.indiceRegistrado;

    if (fila.indiceAtual >= fila.clientes.length) {
      const msg = `🎉 Fila concluída! ${fila.totalAtendidos || 0} atendido(s), ${fila.totalPulados || 0} pulado(s).`;
      toast(msg, 4500);
      limparFila();
      paginaNaFila = false;
      removerPainel();
      return;
    }

    salvarFila(fila);
    const proximo = fila.clientes[fila.indiceAtual];
    toast(`→ ${proximo.label}`);

    // Aqui não há nenhum reload de terceiros competindo (diferente do
    // registro bem-sucedido, que é seguido de location.reload() pelo
    // Módulo 2) -- navegar direto é seguro.
    setTimeout(() => {
      window.location.href = proximo.url;
    }, 350);
  }

  // Contraparte de irParaProximo(): volta um cliente na fila, desfazendo a
  // contagem do passo que está sendo revertido (ver fila.ultimoMotivo). Se
  // o cliente que você está deixando tinha sido registrado nesta visita,
  // isso também é desfeito -- ao chegar de volta no cliente anterior,
  // sincronizarPosicao() restaura indiceRegistrado sozinho se ele já
  // estiver em "atendidos hoje" (registro real já foi enviado ao CRM).
  function irParaAnterior() {
    const fila = obterFila();
    if (!fila || fila.indiceAtual === -1 || fila.indiceAtual === null) return;

    if (fila.indiceAtual === 0) {
      toast('Já está no primeiro cliente da fila.');
      return;
    }

    if (fila.ultimoMotivo === 'atendido') {
      fila.totalAtendidos = Math.max(0, (fila.totalAtendidos || 0) - 1);
    } else if (fila.ultimoMotivo === 'pulado') {
      fila.totalPulados = Math.max(0, (fila.totalPulados || 0) - 1);
    }
    delete fila.ultimoMotivo;
    delete fila.indiceRegistrado;

    fila.indiceAtual -= 1;
    salvarFila(fila);

    const anterior = fila.clientes[fila.indiceAtual];
    toast(`← ${anterior.label}`);

    // Mesma lógica do avanço manual: nenhum reload de terceiros competindo
    // aqui, navegar direto é seguro.
    setTimeout(() => {
      window.location.href = anterior.url;
    }, 350);
  }

  // Chamado quando "Registrar e Enviar" tem sucesso (WhatsApp abriu). NÃO
  // navega e NÃO avança fila.indiceAtual -- só marca que este cliente já
  // foi registrado, pra "atendidos hoje" e pro resumo final da fila. Você
  // decide quando seguir pro próximo (Alt+P / botão "Próximo →").
  //
  // BUG REAL (relatado pelo usuário: "a barra de progresso não está
  // contando"): esta função marcava fila.clientes[fila.indiceAtual] como
  // atendido -- ou seja, confiava na posição PARADA da fila, não na página
  // onde você está de verdade. Isso sempre bateu certo enquanto
  // sincronizarPosicao() realinhava indiceAtual com qualquer página
  // visitada -- mas agora que a posição só muda por Próximo/Voltar
  // (correção anterior, pedida pelo usuário), visitar um cliente da fila
  // por qualquer outro caminho (ex.: Fluxo de Cobrança nativo do CRM,
  // busca, lista) e mandar WhatsApp ali marcava o cliente ERRADO --
  // exatamente onde a fila tinha parado, não quem foi realmente
  // contatado. Corrigido: usa o CNPJ da PRÓPRIA URL atual, sempre o
  // cliente certo, não importa como você chegou nele.
  //
  // Roda de forma síncrona, dentro da interceptação de window.open (ver
  // aguardarEAvancar), porque o Módulo 2 chama location.reload() quase
  // instantaneamente depois do window.open() -- rápido demais pra qualquer
  // setTimeout nosso vencer essa corrida. marcarComoAtendidoHoje() e
  // salvarFila() gravam em localStorage, que sobrevive ao reload sem
  // precisar de nenhuma "ponte".
  function registrarSucessoSemAvancar() {
    if (!paginaNaFila) return;

    const fila = obterFila();
    if (!fila) return;

    const cnpjAtual = extrairCnpjDaUrl(location.href);
    if (!cnpjAtual) return;

    marcarComoAtendidoHoje(cnpjAtual);

    // indiceRegistrado só faz sentido gravar quando a página atual É a
    // posição parada da fila -- é o que irParaProximo() consulta pra saber
    // se o passo que está avançando já foi registrado (jaRegistrado). Se
    // você registrou um cliente fora da posição parada, esse controle não
    // se aplica a ele -- só ao próximo passo de Alt+P/Alt+V de verdade.
    const idxDaPagina = fila.clientes.findIndex((c) => c.cnpj === cnpjAtual);
    if (idxDaPagina !== -1 && idxDaPagina === fila.indiceAtual) {
      fila.indiceRegistrado = fila.indiceAtual;
      salvarFila(fila);
    }

    toast('✓ Registrado. Use Alt+P (ou "Próximo →") quando quiser seguir.');
  }

  // Tudo que acontece no INSTANTE em que sabemos que o registro deu certo
  // -- diário + atendidos hoje. Chamada por DOIS detectores independentes
  // (ver instalarDeteccaoAbrirWhatsApp e aguardarEAvancar logo abaixo);
  // sucessoJaProcessado é o cadeado compartilhado que garante só processar
  // uma vez, não importa qual dos dois disparar primeiro.
  //
  // BUG REAL (relatado pelo usuário: "o contato é gerado, mas o progresso
  // não registra" -- reproduzido com um script isolado, não só suspeita):
  // esta trava usava a mesma variável "avancando" que aguardarEAvancar()
  // seta pra TRUE no INSTANTE DO CLIQUE, antes de qualquer sucesso -- e o
  // Alt+S arma aguardarEAvancar() (via prepararEAguardarEnvio) ANTES do
  // clique de verdade, de propósito. Como o registro real (fetch + abrir
  // WhatsApp) quase sempre termina bem antes dos
  // CONFIG.TIMEOUT_SUCESSO_MS (1200ms) de aguardarEAvancar() resetarem
  // "avancando", esta função sempre encontrava avancando=true e saía sem
  // processar nada -- o bug acontecia em TODO Alt+S, não só em algum
  // cenário raro. As duas travas tinham propósitos diferentes (uma é
  // "clique em andamento", a outra é "este sucesso específico já foi
  // processado") e nunca deveriam ter sido a mesma variável.
  const EVENTO_CONTATO_REGISTRADO = 'smarttable:contato-registrado';

  function marcarSucessoDoRegistro() {
    if (sucessoJaProcessado) return; // já processado pelo outro detector
    sucessoJaProcessado = true;

    // Sinal visível no console -- PEDIDO DO USUÁRIO (indiretamente, depois
    // de duas rodadas de diagnóstico manual pra achar bug de detecção):
    // dá pra conferir NA HORA, olhando o console durante o próprio clique,
    // se a detecção disparou -- sem precisar rodar script de diagnóstico
    // depois.
    console.log('[Fila] ✓ Sucesso do registro detectado -- marcando atendido hoje.');

    // DIÁRIO (Módulo 8): este é o instante EXATO em que sabemos que a
    // cobrança saiu de verdade. Registra antes do resto porque o Módulo 2
    // dispara location.reload() logo em seguida -- só grava em
    // localStorage, que sobrevive ao reload.
    //
    // Fica AQUI, e não dentro de registrarSucessoSemAvancar(), porque
    // aquela função sai cedo quando a página não faz parte de uma fila --
    // e pra medir interessa toda cobrança enviada, dentro da fila ou fora
    // dela.
    if (window.__diario) {
      try {
        const cnpjAtual = new URL(location.href).searchParams.get('cnpj') || '';
        window.__diario.registrar('contato', { c: cnpjAtual });
      } catch (erro) {
        console.warn('[Fila] Não consegui registrar o contato no diário -- cobrança segue normal.', erro);
      }
    }

    // NÚMEROS DIFERENTES (Módulo 4, v1.36.0): o Alt+S que manda pra mais de
    // um número só pode seguir pros números extras depois de SABER que o
    // registro do 1º envio deu certo. Este é o único ponto que sabe disso
    // -- e ainda de forma síncrona, antes do location.reload() do Módulo 2
    // (protegido, não é tocado). Evento, e não chamada direta, pra que a
    // fila não passe a depender do Módulo 4.
    try {
      window.dispatchEvent(new window.CustomEvent(EVENTO_CONTATO_REGISTRADO, {
        detail: { cnpj: extrairCnpjDaUrl(location.href) },
      }));
    } catch (erro) {
      console.warn('[Fila] Não consegui avisar o registro pros números diferentes -- cobrança segue normal.', erro);
    }

    registrarSucessoSemAvancar();

    setTimeout(() => { sucessoJaProcessado = false; }, CONFIG.TIMEOUT_SUCESSO_MS);
  }

  // BUG REAL (relatado pelo usuário: "a barra de progresso não está
  // contando" -- e o diagnóstico confirmou: o cliente certo, na posição
  // certa da fila, nunca aparecia em "atendidos hoje"). CAUSA: por padrão o
  // "Registrar e Enviar" (Módulo 2, protegido) NÃO abre nenhuma aba nova --
  // ele navega a própria aba pro protocolo whatsapp://send (WhatsApp
  // Desktop), a pedido do usuário. window.open() só é chamado de verdade
  // quando o interruptor "Enviar pelo WhatsApp Web" (Alt+O) está ligado.
  // A detecção antiga (aguardarEAvancar, abaixo) só via window.open --
  // então no caminho padrão (Desktop) ela NUNCA disparava, e o cliente
  // nunca era marcado como atendido, não importa como o botão foi clicado.
  //
  // CORREÇÃO: em vez de depender de COMO o WhatsApp abre depois (que muda
  // com o interruptor), observamos window.abrirWhatsAppCliente() -- a
  // função nativa da própria página que o Módulo 2 já declara depender
  // ("Depende de... window.abrirWhatsAppCliente()"), chamada nos DOIS
  // caminhos (Desktop e Web), sempre e só quando o registro na API já deu
  // certo. Envolvê-la aqui é síncrono -- sem espera de rede, sem correr
  // contra o location.reload() que vem logo depois -- e não depende de
  // "armar" antes de simular nenhum clique: funciona pro Alt+S, pro clique
  // manual, ou qualquer outro jeito de disparar o botão.
  //
  // Não mexe no Módulo 2 (protegido): só envolve uma função que já existe
  // na página (fora dos nossos módulos), chama ela normalmente por dentro,
  // e nunca interfere no retorno nem no comportamento dela.
  //
  // BUG REAL Nº2 (achado depois do primeiro conserto, confirmado com o
  // usuário: mesmo com "abrirWhatsAppClienteEnvolvida: true", um registro
  // de verdade continuava sem marcar atendidosHoje): a tela do CRM
  // provavelmente RE-DEFINE window.abrirWhatsAppCliente em algum momento
  // depois que instalamos o embrulho (comum em telas que recriam funções a
  // cada renderização do modal) -- silenciosamente jogando fora nosso
  // embrulho antes do clique de verdade acontecer, sem erro nenhum pra
  // avisar. Envolver uma vez só (como antes) não sobrevive a isso.
  //
  // CORREÇÃO: em vez de só embrulhar o valor atual, VIGIA a propriedade --
  // por getter/setter quando a página deixa (reage na hora, sem esperar
  // nenhum intervalo), e SEMPRE também por sondagem periódica (confirmado
  // em produção: pelo menos uma tela do CRM define window.abrirWhatsAppCliente
  // como propriedade NÃO-CONFIGURÁVEL -- writable, mas Object.defineProperty
  // pra instalar o getter/setter lança "Cannot redefine property"; a
  // sondagem é a ÚNICA forma de detecção que sobrevive a isso). Não importa
  // quantas vezes a página redefina a função depois, nem de que jeito: o
  // embrulho nunca fica perdido por mais que ~SONDAGEM_ABRIR_WHATSAPP_MS.
  function instalarDeteccaoAbrirWhatsApp() {
    // Idempotente: uma vez instalada (accessor e/ou sondagem), cobre
    // qualquer redefinição futura sozinha -- chamar de novo não tem mais
    // nada a fazer.
    if (window.__smartTableVigiaAbrirWhatsApp) return;
    window.__smartTableVigiaAbrirWhatsApp = true;

    function envolver(fn) {
      if (typeof fn !== 'function' || fn.__smartTableEnvolvida) return fn;
      const envolvida = function (...args) {
        try {
          marcarSucessoDoRegistro();
        } catch (erro) {
          console.error('[Fila] Erro ao processar sucesso do registro -- o WhatsApp abre normalmente mesmo assim.', erro);
        }
        return fn.apply(this, args);
      };
      envolvida.__smartTableEnvolvida = true;
      return envolvida;
    }

    let valorAtual = envolver(window.abrirWhatsAppCliente);
    let instaladaComoAccessor = false;

    try {
      Object.defineProperty(window, 'abrirWhatsAppCliente', {
        configurable: true,
        enumerable: true,
        get() { return valorAtual; },
        set(novoValor) { valorAtual = envolver(novoValor); },
      });
      instaladaComoAccessor = true;
    } catch (erro) {
      // Propriedade não-configurável -- degrada pro embrulho simples (só a
      // atribuição atual). A sondagem abaixo é quem cobre redefinições
      // futuras neste caso.
      //
      // BUG REAL (achado em revisão, sem reproduzir em produção ainda):
      // pelo menos em teoria, uma tela pode ir além de "não-configurável" e
      // marcar a propriedade também como NÃO-GRAVÁVEL (frozen de verdade) --
      // nesse caso esta atribuição também lança (TypeError em modo estrito),
      // e como aqui não havia try/catch, a exceção subia sem ser tratada até
      // iniciar() (ver logo abaixo), derrubando o registro do listener de
      // clique inteiro -- ou seja, NENHUMA detecção de sucesso sobrava, nem
      // a sondagem, nem o clique. Protegido: se nem a atribuição simples for
      // possível, a sondagem abaixo ainda tenta a cada
      // SONDAGEM_ABRIR_WHATSAPP_MS (e também vai falhar silenciosamente
      // nesse caso específico, mas sem nunca comprometer o resto do módulo).
      try {
        window.abrirWhatsAppCliente = valorAtual;
      } catch (erroDeAtribuicao) {
        console.warn(
          '[Fila] window.abrirWhatsAppCliente está totalmente congelada nesta página (nem configurável, nem ' +
          'gravável) -- a detecção de sucesso pode não funcionar aqui. O resto do SmartTable continua normal.',
          erroDeAtribuicao
        );
      }
    }

    // REDE DE SEGURANÇA por sondagem -- roda sempre, mesmo quando o
    // accessor acima funcionou (custo desprezível: só compara uma flag
    // booleana a cada SONDAGEM_ABRIR_WHATSAPP_MS). Cobre tanto a
    // propriedade não-configurável (única defesa possível ali) quanto
    // qualquer jeito de substituir o descriptor inteiro por cima do nosso.
    const idSondagem = setInterval(() => {
      const atual = window.abrirWhatsAppCliente;
      if (typeof atual !== 'function' || atual.__smartTableEnvolvida) return;

      try {
        if (instaladaComoAccessor) {
          valorAtual = envolver(atual); // passa pelo setter -- reaproveita o mesmo caminho
        } else {
          window.abrirWhatsAppCliente = envolver(atual);
        }
      } catch (erro) {
        // Mesma proteção do fallback inicial acima: se a propriedade virou
        // (ou sempre foi) não-gravável, cada tique falharia do mesmo jeito
        // -- sem o try/catch, isso são exceções não tratadas repetidas pra
        // sempre a cada SONDAGEM_ABRIR_WHATSAPP_MS, sem nenhum ganho.
      }
    }, CONFIG.SONDAGEM_ABRIR_WHATSAPP_MS);

    // setInterval no navegador devolve um número; em Node (só acontece nos
    // testes, que rodam o módulo via window.eval() no processo real do
    // Node, não isolado por página) devolve um objeto Timeout com
    // .unref() -- sem isso, cada janela de teste deixava um timer real
    // rodando pra sempre, travando o processo inteiro no fim da suíte. Em
    // produção (navegador) este optional chaining não faz nada.
    idSondagem?.unref?.();
  }

  function aguardarEAvancar() {
    // Rede de segurança: window.abrirWhatsAppCliente() pode ainda não
    // existir no instante em que o Módulo 3 carregou (script da própria
    // página, fora da nossa ordem de carregamento) -- tenta de novo bem
    // antes do clique de verdade acontecer. Idempotente (ver guarda acima).
    instalarDeteccaoAbrirWhatsApp();

    if (avancando) return; // já está processando um clique anterior
    avancando = true;
    // Novo clique -- se sobrou uma trava de sucesso de um clique anterior
    // (não deveria, ela mesma se reseta depois de CONFIG.TIMEOUT_SUCESSO_MS),
    // não deixa isso bloquear a detecção deste clique novo.
    sucessoJaProcessado = false;

    let sucesso = false;
    const openOriginal = window.open;

    // Interceptação temporária e não invasiva, MANTIDA como reforço além
    // de instalarDeteccaoAbrirWhatsApp() acima: não mexe no módulo
    // "Registrar e Enviar" existente, só observa se ele chamou window.open
    // com sucesso (retorno diferente de null = não foi bloqueado por
    // pop-up blocker). Cobre qualquer caminho de sucesso que a gente não
    // tenha previsto -- sucessoJaProcessado (compartilhado com
    // marcarSucessoDoRegistro) garante que só um dos dois processa de
    // verdade.
    window.open = function (...args) {
      const janela = openOriginal.apply(window, args);
      if (janela && !sucesso) {
        sucesso = true;
        marcarSucessoDoRegistro();
      }
      return janela;
    };

    setTimeout(() => {
      window.open = openOriginal; // sempre restaura, independente do resultado
      avancando = false;

      if (!sucesso) {
        console.warn('[Fila] Não detectei o WhatsApp abrindo dentro do tempo esperado — não avancei a fila. Se o registro falhou (ex.: observações vazias ou cliente não identificado), confira o aviso de erro na tela.');
      }
    }, CONFIG.TIMEOUT_SUCESSO_MS);
  }

  /* ---------------------------------------------------------------------
   * 7. SINCRONIZAÇÃO DE POSIÇÃO (roda em qualquer página ao carregar)
   * --------------------------------------------------------------------- */
  function sincronizarPosicao() {
    const fila = obterFila();
    if (!fila) {
      paginaNaFila = false;
      removerPainel();
      removerBotaoRetomar();
      return;
    }

    const cnpjAtual = extrairCnpjDaUrl(location.href);
    const idx = cnpjAtual ? fila.clientes.findIndex((c) => c.cnpj === cnpjAtual) : -1;

    if (idx !== -1) {
      // BUG REAL (relatado pelo usuário): a posição da fila (indiceAtual, o
      // "Fila: X/Y" do painel) mudava sozinha sempre que a página batia com
      // QUALQUER cliente da fila -- inclusive um que você já tinha atendido
      // e só voltou pra conferir algo, fora do fluxo normal de
      // Próximo/Voltar. A posição só deve avançar/recuar por ação explícita
      // (irParaProximo/irParaAnterior, que já gravam o novo indiceAtual
      // ANTES de navegar) ou na primeira visita depois de "Iniciar Fila"
      // (indiceAtual ainda -1, precisa ser inicializado uma vez). Visitar
      // avulso um cliente que também está na fila não deve "puxar" a
      // posição pra cá.
      const primeiraVisita = fila.indiceAtual === -1;
      if (primeiraVisita || idx === fila.indiceAtual) {
        fila.indiceAtual = idx;
        // Se este cliente já consta em "atendidos hoje" (registro real já foi
        // enviado ao CRM, por Alt+S ou clique manual), o próximo avanço deve
        // contar como "atendido" mesmo que tenhamos chegado aqui via Alt+V
        // (voltar) ou qualquer outra navegação, não só pela mesma sequência
        // de cliques que fez o registro original.
        if (obterAtendidosHoje().has(cnpjAtual)) {
          fila.indiceRegistrado = idx;
        }
        salvarFila(fila);
      }
      paginaNaFila = true;
      removerBotaoRetomar(); // já estamos na fila -- não faz sentido "retomar"
    } else {
      // Estamos numa página que não bate com nenhum item conhecido da fila
      // (ex.: navegação manual, ou reabriu o navegador na lista). Se ainda
      // sobra fila pra terminar, oferece continuar sem precisar iniciar de novo.
      paginaNaFila = false;
      criarBotaoRetomar(fila);
    }

    atualizarPainel();
  }

  /* ---------------------------------------------------------------------
   * 8. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  function iniciar() {
    if (paginaTemClientesParaFila()) {
      criarBotaoIniciarFila();
    }

    // Instala o quanto antes (independe de clique) -- se a função da
    // página ainda não existir agora, aguardarEAvancar() tenta de novo
    // bem antes do clique de verdade acontecer.
    //
    // Protegido por try/catch (mesmo raciocínio de sincronizarPosicao()
    // logo abaixo): mesmo com as proteções internas da própria função,
    // nenhuma falha inesperada aqui pode impedir o registro do listener de
    // clique -- é exatamente esse encadeamento (uma exceção nesta chamada
    // pulando o resto de iniciar()) que já foi confirmado como causa real
    // de "a barra de progresso não está contando" numa página com
    // window.abrirWhatsAppCliente totalmente congelada.
    try {
      instalarDeteccaoAbrirWhatsApp();
    } catch (erro) {
      console.error('[Fila] Erro ao instalar a detecção de sucesso do registro -- continuando mesmo assim.', erro);
    }

    // sincronizarPosicao() lê e valida dado do localStorage -- protegido
    // por try/catch aqui porque, mesmo com a validação de schema acima,
    // não queremos que NENHUMA falha inesperada impeça o registro do
    // listener de clique logo abaixo. Sem isso, um erro nesta função
    // desligaria a automação inteira da sessão silenciosamente.
    try {
      sincronizarPosicao();
    } catch (e) {
      console.error('[Fila] Erro ao sincronizar posição da fila -- continuando mesmo assim.', e);
    }

    // Listener em fase de captura, no document: não substitui nem interfere
    // no handler original do botão "Registrar e Enviar", só observa o clique.
    // Cobre o caso de CLIQUE REAL DE MOUSE no botão (sem passar pelo Alt+S).
    document.addEventListener('click', function (e) {
      const botao = e.target.closest('button');
      if (!botao) return;

      const texto = (botao.textContent || '').trim().toLowerCase();
      if (!texto.includes(CONFIG.TEXTO_BOTAO_REGISTRAR)) return;

      aguardarEAvancar();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  // Helpers de depuração e ganchos usados pelo Módulo 4 (Atalhos de
  // Teclado). Acessíveis no console (Isaac já usa o DevTools ativamente).
  window.filaDebug = {
    CONFIG,
    obterFila,
    salvarFila,
    limparFila,
    validarFormatoDaFila,
    construirFilaAPartirDaPagina,
    paginaTemClientesParaFila,
    criarBotaoRetomar,
    iniciarFila,
    irParaProximo,
    irParaAnterior,
    registrarSucessoSemAvancar,
    sincronizarPosicao,
    marcarComoAtendidoHoje,
    obterAtendidosHoje,
    extrairCnpjDaUrl,
    mesmoDiaDeHoje,
    // A barra da lista de clientes -- o Módulo 15 (Alertas gerais) põe o
    // botão dele na mesma barra, sem repetir a busca.
    ancoraToolbarLista,
    getPaginaNaFila: () => paginaNaFila,
    instalarDeteccaoAbrirWhatsApp,
    marcarSucessoDoRegistro,
    // Expõe o "armar" da interceptação do window.open pro Módulo 4 chamar
    // explicitamente ANTES do clique simulado do Alt+S -- garante que a
    // detecção de sucesso funciona não importa qual estratégia de clique
    // seja usada (mesmo uma que não borbulhe evento real de DOM até o
    // listener acima). Chamar isto duas vezes seguidas é seguro
    // (aguardarEAvancar já tem proteção contra chamada dupla via a
    // variável "avancando").
    prepararEAguardarEnvio: aguardarEAvancar,
  };
})();
