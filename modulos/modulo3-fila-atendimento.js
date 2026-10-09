/* =========================================================================
 * MÓDULO 3: FILA DE ATENDIMENTO — CRM TexCotton
 * -------------------------------------------------------------------------
 * O que faz: mantém a lista de clientes a atender e a posição nela. Quando
 * "Registrar e Enviar" (Módulo 2) tem sucesso, marca o cliente como
 * atendido, mas NÃO navega sozinho. O avanço é sempre decisão do operador:
 * Alt+P ou botão "Próximo →". Alt+V ou "← Voltar" volta um cliente e
 * desfaz a contagem daquele passo (ir e voltar não infla o resumo final).
 * Ao acabar a fila, aparece um aviso e o painel some.
 *
 * Depende de: Módulo 0 (window.__smartTableUtil: toast, montarUrlCliente),
 * carregado ANTES deste no @require do wrapper. Módulo 8 (window.__diario)
 * é opcional. Módulo 4 usa window.filaDebug (ver o fim do arquivo).
 * Expõe também o evento 'smarttable:contato-registrado' (detail.cnpj).
 *
 * Matriz e filial (mesma raiz de CNPJ, 8 primeiros dígitos) contam como UM
 * cliente na fila -- confirmado com o usuário. Fica a entrada com mais dias
 * de atraso.
 *
 * A lista de clientes NÃO usa <a href> (a linha navega via JavaScript). A
 * fila lê "Controle: {grupoId}|{cnpj}" de cada linha e remonta a URL
 * (confirmado no CRM: Controle: 0|12345678/0001-99 ->
 * /crm/clientes/grupo/0?cnpj=12345678%2F0001-99). Se o formato mudar,
 * ajuste CONFIG.REGEX_CONTROLE e/ou __smartTableUtil.montarUrlCliente.
 * ========================================================================= */
(function () {
  'use strict';

  // Evita inicializar duas vezes se o arquivo for injetado mais de uma vez.
  if (window.__filaAtendimentoCarregado) return;
  window.__filaAtendimentoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Fila de Atendimento');

  const { toast, montarUrlCliente } = window.__smartTableUtil;

  /* ---------------------------------------------------------------------
   * 1. CONFIGURAÇÃO
   * --------------------------------------------------------------------- */
  const CONFIG = {
    SELETOR_LINHA: 'table tbody tr',
    // Cada linha traz "Controle: {grupoId}|{cnpj}"; é daí que se remonta a
    // URL de destino.
    REGEX_CONTROLE: /Controle:\s*(\d+)\|([\d.\/-]+)/,
    // Procurado, em minúsculas, dentro do texto de qualquer botão.
    TEXTO_BOTAO_REGISTRAR: 'registrar e enviar',
    // Tempo máximo (ms) esperando o WhatsApp abrir depois do clique.
    TIMEOUT_SUCESSO_MS: 1200,
    // Intervalo da sondagem que reembrulha window.abrirWhatsAppCliente se a
    // página redefinir (ver instalarDeteccaoAbrirWhatsApp). Custo: uma
    // comparação de flag por tique.
    SONDAGEM_ABRIR_WHATSAPP_MS: 200,
    // Extrai "X dias" do texto da linha, pra priorizar por urgência.
    REGEX_DIAS_ATRASO: /(\d+)\s*dias?/i,
    // localStorage, não sessionStorage.
    CHAVE_STORAGE: 'filaAtendimento_v1',
    // Quem já foi atendido HOJE (evita cobrar duas vezes no mesmo dia, mesmo
    // em filas diferentes).
    CHAVE_ATENDIDOS_HOJE: 'filaAtendidosHoje_v1',
    // Se o formato salvo mudar, incremente: fila com versão diferente é
    // descartada (ver validarFormatoDaFila).
    VERSAO_SCHEMA: 1,
  };

  /* ---------------------------------------------------------------------
   * 2. ESTADO DO MÓDULO
   * --------------------------------------------------------------------- */
  let painelEl = null;      // painel "Fila: X/Y"
  let paginaNaFila = false; // a página atual corresponde a uma posição conhecida da fila
  let avancando = false;    // "clique em andamento": trava contra cliques duplicados
  // "Este sucesso já foi processado". SEPARADA de "avancando" de propósito:
  // o Alt+S arma "avancando" antes do sucesso, então usar a mesma variável
  // fazia marcarSucessoDoRegistro sair sem processar nada.
  let sucessoJaProcessado = false;

  /* ---------------------------------------------------------------------
   * 3. UTILITÁRIOS
   * --------------------------------------------------------------------- */
  function extrairCnpjDaUrl(url) {
    // O cnpj identifica o cliente; o grupoId se repete dentro do grupo
    // econômico e não serve sozinho.
    try {
      const u = new URL(url, location.href);
      return u.searchParams.get('cnpj') || '';
    } catch (e) {
      return '';
    }
  }

  // Defesa contra dado corrompido/antigo no localStorage. Um registro
  // mal-formado lançaria exceção em sincronizarPosicao(), que roda em toda
  // página, e travaria a automação antes do listener de clique.
  function validarFormatoDaFila(fila) {
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

      // Fila de um dia anterior é descartada.
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

  // "Atendidos hoje" persiste separado da fila, pra sobreviver ao fim ou à
  // troca da fila. Reseta sozinho quando o dia vira.
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
   * Botões e painel encaixam em áreas que já existem no CRM (confirmado no
   * HTML real da página de cliente e da lista). Se o seletor não bater, cada
   * ponto de uso cai pro position: fixed -- nunca quebra.
   * --------------------------------------------------------------------- */
  // Página de CLIENTE: linha de ações (Contato / Negociação / Tarefa e, se
  // existir, o "Fluxo de Cobrança" nativo).
  function ancoraAcoesCliente() {
    const btnContato = document.querySelector('[onclick^="openModalContato"]');
    if (btnContato?.parentElement) return btnContato.parentElement;
    const fluxo = document.getElementById('fluxo-cobranca');
    if (fluxo?.parentElement) return fluxo.parentElement;
    return null;
  }

  // Página de LISTA: barra de filtros ou, faltando ela, a toolbar da tabela.
  function ancoraToolbarLista() {
    return document.querySelector('.pbi-filters-row')
      || document.querySelector('.pbi-filters-bar')
      || document.querySelector('#tabela-clientes .st-toolbar')
      || null;
  }

  /* ---------------------------------------------------------------------
   * 4. PAINEL (mostra "Fila: X/Y" enquanto está ativa)
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
        // Fallback flutuante.
        Object.assign(painelEl.style, {
          position: 'fixed',
          // Abaixo do cabeçalho fixo do CRM, não por cima dele.
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
   * 5. CONSTRUÇÃO DA FILA (página de LISTA de clientes)
   * --------------------------------------------------------------------- */
  // Raiz do CNPJ (8 primeiros dígitos), comum a matriz e filiais. Ignora
  // pontuação pra não depender de como o CRM formata a linha.
  function extrairRaizCnpj(cnpj) {
    return (cnpj || '').replace(/\D/g, '').slice(0, 8);
  }

  function construirFilaAPartirDaPagina() {
    const linhas = document.querySelectorAll(CONFIG.SELETOR_LINHA);
    // Chave = raiz do CNPJ, valor = melhor candidato da empresa. Matriz e
    // filial (CNPJs diferentes, mesma raiz) contam como um cliente só,
    // confirmado com o usuário na fila real; fica quem tem mais dias de atraso.
    const porRaizCnpj = new Map();
    const vistos = new Set(); // defesa contra a MESMA linha aparecer 2x no DOM
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

    // Mais dias de atraso primeiro. Sem "X dias" reconhecível vale 0, vai pro final.
    clientes.sort((a, b) => b.diasAtraso - a.diasAtraso);

    if (pulosPorJaAtendido > 0) {
      console.log(`[Fila] ${pulosPorJaAtendido} cliente(s) já atendido(s) hoje foram pulados na montagem da fila.`);
    }
    if (unificadosPorMatrizFilial > 0) {
      console.log(`[Fila] ${unificadosPorMatrizFilial} entrada(s) de matriz/filial da mesma empresa foram unificadas na montagem da fila.`);
    }

    return clientes;
  }

  function removerBotaoRetomar() {
    const el = document.getElementById('fila-btn-retomar');
    if (el) el.remove();
  }

  function criarBotaoRetomar(fila) {
    if (document.getElementById('fila-btn-retomar')) return;

    // indiceAtual já É "onde parei" (sincronizarPosicao o mantém), então
    // retomar vai pra ele, sem +1 (+1 pularia o cliente onde parou). Só é
    // -1 se nunca visitou o primeiro; Math.max volta pro início.
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
      // Ação secundária: estilo "ghost", como o botão "Limpar".
      btn.className = 'pbi-btn pbi-btn-ghost';
      Object.assign(btn.style, {
        color: '#B45309',
        borderColor: '#B45309',
      });
      ancora.appendChild(btn);
      return;
    }

    // Fallback flutuante.
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
    // Fora do menu lateral do CRM, acompanhando quando ele recolhe.
    window.__smartTableUtil?.acompanharMenuLateral?.(btn);
  }

  /* ---------------------------------------------------------------------
   * 6. AVANÇO NA FILA (página de DETALHE do cliente)
   * --------------------------------------------------------------------- */
  function irParaProximo(motivo) {
    const fila = obterFila();
    if (!fila || fila.indiceAtual === -1 || fila.indiceAtual === null) return;

    const clienteAtual = fila.clientes[fila.indiceAtual];
    // Cliente já registrado conta como "atendido" mesmo avançando por
    // "Próximo →" (que também serve pra pular sem registrar).
    const jaRegistrado = fila.indiceRegistrado === fila.indiceAtual;
    const motivoEfetivo = jaRegistrado ? 'atendido' : motivo;

    if (motivoEfetivo === 'atendido') {
      fila.totalAtendidos = (fila.totalAtendidos || 0) + 1;
      if (clienteAtual && !jaRegistrado) marcarComoAtendidoHoje(clienteAtual.cnpj);
    } else {
      fila.totalPulados = (fila.totalPulados || 0) + 1;
    }

    // Guarda o que este passo contou, pra irParaAnterior() desfazer
    // exatamente essa contagem.
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

    // Nenhum reload de terceiros competindo aqui (ao contrário do registro
    // bem-sucedido, seguido de location.reload() no Módulo 2): navegar
    // direto é seguro.
    setTimeout(() => {
      window.location.href = proximo.url;
    }, 350);
  }

  // Contraparte de irParaProximo(): volta um cliente e desfaz a contagem do
  // passo revertido (fila.ultimoMotivo). Ao chegar no cliente anterior,
  // sincronizarPosicao() restaura indiceRegistrado se ele já estiver em
  // "atendidos hoje".
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

    // Sem reload de terceiros competindo: navegar direto é seguro.
    setTimeout(() => {
      window.location.href = anterior.url;
    }, 350);
  }

  // Chamado quando "Registrar e Enviar" tem sucesso. NÃO navega e NÃO
  // avança indiceAtual: só marca o cliente como registrado (atendidos hoje
  // e resumo final).
  //
  // Usa o CNPJ da PRÓPRIA URL atual, não fila.clientes[indiceAtual]: a
  // posição só muda por Próximo/Voltar, então um cliente visitado por outro
  // caminho (Fluxo de Cobrança nativo, busca, lista) seria marcado errado.
  //
  // Roda síncrona, dentro da interceptação (ver aguardarEAvancar), porque o
  // Módulo 2 chama location.reload() quase junto com o envio, rápido demais
  // pra um setTimeout. O localStorage sobrevive ao reload.
  function registrarSucessoSemAvancar() {
    if (!paginaNaFila) return;

    const fila = obterFila();
    if (!fila) return;

    const cnpjAtual = extrairCnpjDaUrl(location.href);
    if (!cnpjAtual) return;

    marcarComoAtendidoHoje(cnpjAtual);

    // indiceRegistrado só é gravado quando a página atual É a posição parada
    // da fila: é o que irParaProximo() consulta (jaRegistrado).
    const idxDaPagina = fila.clientes.findIndex((c) => c.cnpj === cnpjAtual);
    if (idxDaPagina !== -1 && idxDaPagina === fila.indiceAtual) {
      fila.indiceRegistrado = fila.indiceAtual;
      salvarFila(fila);
    }

    toast('✓ Registrado. Use Alt+P (ou "Próximo →") quando quiser seguir.');
  }

  // Tudo que acontece no instante em que o registro é dado como certo:
  // diário + atendidos hoje. Chamada por DOIS detectores independentes
  // (instalarDeteccaoAbrirWhatsApp e aguardarEAvancar); sucessoJaProcessado
  // garante que só o primeiro processa. Não pode reusar "avancando" (ver
  // o estado do módulo).
  const EVENTO_CONTATO_REGISTRADO = 'smarttable:contato-registrado';

  function marcarSucessoDoRegistro() {
    if (sucessoJaProcessado) return; // já processado pelo outro detector
    sucessoJaProcessado = true;

    // Deixa conferir no console, durante o clique, se a detecção disparou.
    console.log('[Fila] ✓ Sucesso do registro detectado -- marcando atendido hoje.');

    // DIÁRIO (Módulo 8): registra antes do resto porque o Módulo 2 dispara
    // location.reload() logo em seguida (só grava em localStorage). Fica
    // AQUI, e não em registrarSucessoSemAvancar(), porque aquela sai cedo
    // fora de uma fila e o diário mede toda cobrança enviada.
    if (window.__diario) {
      try {
        const cnpjAtual = new URL(location.href).searchParams.get('cnpj') || '';
        window.__diario.registrar('contato', { c: cnpjAtual });
      } catch (erro) {
        console.warn('[Fila] Não consegui registrar o contato no diário -- cobrança segue normal.', erro);
      }
    }

    // NÚMEROS DIFERENTES (Módulo 4): o Alt+S com mais de um número só segue
    // pros extras depois de saber que o 1º registro deu certo, e este é o
    // único ponto que sabe, ainda síncrono antes do reload do Módulo 2.
    // Evento e não chamada direta, pra fila não depender do Módulo 4.
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

  // Detecta o sucesso do registro observando window.abrirWhatsAppCliente(),
  // função nativa da página que o Módulo 2 (protegido) chama nos DOIS
  // caminhos, sempre e só depois que o registro na API deu certo.
  //
  // Por que não window.open: por padrão o Módulo 2 navega a própria aba pro
  // protocolo whatsapp://send (WhatsApp Desktop); window.open só é chamado
  // com "Enviar pelo WhatsApp Web" (Alt+O) ligado. Detectar só window.open
  // nunca disparava no caminho padrão.
  //
  // O embrulho é síncrono (sem corrida com o location.reload()), não
  // depende de "armar" antes e não altera retorno nem comportamento da
  // função. O Módulo 2 não é tocado.
  //
  // A tela do CRM pode REDEFINIR window.abrirWhatsAppCliente depois do
  // embrulho, sem erro nenhum, descartando-o. Por isso a propriedade é
  // vigiada por getter/setter (reage na hora) E sempre por sondagem
  // periódica. Confirmado em produção: pelo menos uma tela define a
  // propriedade como NÃO-CONFIGURÁVEL (defineProperty lança "Cannot redefine
  // property"); ali a sondagem é a única detecção possível. O embrulho
  // nunca fica perdido por mais que ~SONDAGEM_ABRIR_WHATSAPP_MS.
  function instalarDeteccaoAbrirWhatsApp() {
    // Idempotente: depois de instalada, cobre redefinições sozinha.
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
      // Não-configurável: degrada pro embrulho simples; a sondagem cobre as
      // redefinições futuras. A propriedade pode ser também NÃO-GRAVÁVEL
      // (congelada), e aí a atribuição lança TypeError. Sem este try/catch a
      // exceção subiria até iniciar() e derrubaria o registro do listener
      // de clique.
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

    // Rede de segurança por sondagem: roda sempre, mesmo com o accessor
    // funcionando. Cobre a propriedade não-configurável e a troca do
    // descriptor inteiro por cima do nosso.
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
        // Propriedade não-gravável: cada tique falharia igual. Sem o
        // try/catch seriam exceções não tratadas repetidas pra sempre.
      }
    }, CONFIG.SONDAGEM_ABRIR_WHATSAPP_MS);

    // Em Node (testes rodam o módulo no processo real) setInterval devolve
    // Timeout com .unref(); sem isso o timer travava o fim da suíte. No
    // navegador não faz nada.
    idSondagem?.unref?.();
  }

  function aguardarEAvancar() {
    // window.abrirWhatsAppCliente pode não existir quando o módulo carregou
    // (script da própria página, fora da nossa ordem): tenta de novo antes
    // do clique de verdade. Idempotente.
    instalarDeteccaoAbrirWhatsApp();

    if (avancando) return; // já está processando um clique anterior
    avancando = true;
    // Novo clique: uma trava de sucesso que sobrou não pode bloquear a
    // detecção deste.
    sucessoJaProcessado = false;

    let sucesso = false;
    const openOriginal = window.open;

    // Interceptação temporária, MANTIDA como reforço de
    // instalarDeteccaoAbrirWhatsApp(): só observa se o Módulo 2 chamou
    // window.open com sucesso (retorno não-null = sem pop-up blocker).
    // sucessoJaProcessado garante que só um dos dois detectores processa.
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
      // A posição só muda por ação explícita (irParaProximo/irParaAnterior,
      // que gravam o novo indiceAtual ANTES de navegar) ou na primeira
      // visita depois de "Iniciar Fila" (indiceAtual -1). Visitar avulso um
      // cliente que também está na fila não puxa a posição pra cá.
      const primeiraVisita = fila.indiceAtual === -1;
      if (primeiraVisita || idx === fila.indiceAtual) {
        fila.indiceAtual = idx;
        // Cliente já em "atendidos hoje" (registro real já enviado): o
        // próximo avanço conta como "atendido", mesmo chegando por Alt+V
        // ou outra navegação.
        if (obterAtendidosHoje().has(cnpjAtual)) {
          fila.indiceRegistrado = idx;
        }
        salvarFila(fila);
      }
      paginaNaFila = true;
      removerBotaoRetomar(); // já estamos na fila -- não faz sentido "retomar"
    } else {
      // Página fora da fila (navegação manual, ou reabriu o navegador na
      // lista): se sobra fila, oferece continuar.
      paginaNaFila = false;
      criarBotaoRetomar(fila);
    }

    atualizarPainel();
  }

  /* ---------------------------------------------------------------------
   * 8. INICIALIZAÇÃO
   * --------------------------------------------------------------------- */
  function iniciar() {
    // Instala o quanto antes; se a função da página ainda não existir,
    // aguardarEAvancar() tenta de novo. O try/catch é obrigatório: uma
    // exceção aqui pularia o registro do listener de clique (causa
    // confirmada de "atendido não contava" com a função congelada).
    try {
      instalarDeteccaoAbrirWhatsApp();
    } catch (erro) {
      console.error('[Fila] Erro ao instalar a detecção de sucesso do registro -- continuando mesmo assim.', erro);
    }

    // sincronizarPosicao() lê dado do localStorage; mesmo com a validação
    // de schema, nenhuma falha pode impedir o listener de clique abaixo.
    try {
      sincronizarPosicao();
    } catch (e) {
      console.error('[Fila] Erro ao sincronizar posição da fila -- continuando mesmo assim.', e);
    }

    // Captura no document: só observa o clique, sem interferir no handler
    // original de "Registrar e Enviar". Cobre o clique real de mouse (sem Alt+S).
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

  // Depuração no console e ganchos usados pelo Módulo 4 (Atalhos).
  window.filaDebug = {
    CONFIG,
    obterFila,
    salvarFila,
    limparFila,
    validarFormatoDaFila,
    construirFilaAPartirDaPagina,
    criarBotaoRetomar,
    irParaProximo,
    irParaAnterior,
    registrarSucessoSemAvancar,
    sincronizarPosicao,
    marcarComoAtendidoHoje,
    obterAtendidosHoje,
    extrairCnpjDaUrl,
    mesmoDiaDeHoje,
    // A barra da lista: o Módulo 15 põe o botão dele nela, sem repetir a busca.
    ancoraToolbarLista,
    getPaginaNaFila: () => paginaNaFila,
    instalarDeteccaoAbrirWhatsApp,
    marcarSucessoDoRegistro,
    // "Arma" a interceptação de window.open; o Módulo 4 chama ANTES do
    // clique simulado do Alt+S, pra a detecção não depender da estratégia
    // de clique. Chamar duas vezes é seguro (a trava "avancando" cobre).
    prepararEAguardarEnvio: aguardarEAvancar,
  };
})();
