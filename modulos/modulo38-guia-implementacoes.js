/* =========================================================================
 * MÓDULO 38: GUIA DE IMPLEMENTAÇÕES (Shift+Alt+I) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Tela pesquisável com o catálogo funcional do SmartTable e o histórico
 * completo de versões já publicado no Módulo 18 (Alt+L).
 *
 * O catálogo explica os comportamentos atuais. O histórico é reutilizado
 * de window.__logAtualizacoes, sem duplicar a lista de versões.
 * Depende do Módulo 0 e, para o histórico, do Módulo 18.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__guiaImplementacoesCarregado) return;
  window.__guiaImplementacoesCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Guia de Implementações');

  const CATEGORIAS = [
    {
      nome: 'Atendimento e cobrança',
      resumo: 'Geração de relatório, preparação do atendimento e envio.',
      itens: [
        {
          titulo: 'Atendimento rápido', atalho: 'Alt+A',
          resumo: 'Prepara relatório, contato e mensagem personalizada em sequência.',
          detalhes: 'Quando há outras razões vencidas do mesmo grupo econômico, tenta gerar os relatórios delas antes do relatório da razão atual. Se o relatório necessário falhar, não for encontrado ou não confirmar sucesso, o fluxo é interrompido para evitar preparar uma cobrança incompleta.'
        },
        {
          titulo: 'Gerar relatório', atalho: 'Alt+R',
          resumo: 'Gera uma imagem visual dos títulos em atraso.',
          detalhes: 'A renderização tenta html2canvas-pro por duas origens de CDN, com a mesma verificação de integridade. Se as duas falharem, o sistema informa o erro em vez de usar o renderizador legado do CRM, que pode produzir formatação incorreta. A geração depende de uma dessas origens estar acessível.'
        },
        {
          titulo: 'Registrar e enviar', atalho: 'Alt+S',
          resumo: 'Coordena o registro do contato e o envio pelo WhatsApp.',
          detalhes: 'Confere se a cópia necessária da mensagem e do relatório foi concluída. Evita duplicar o registro de contato no mesmo dia e não envia quando a cópia obrigatória falha. Com a opção de números diferentes ativa, cada acionamento segue a regra de avançar para o próximo número.'
        },
        {
          titulo: 'Abrir tela de contato', atalho: 'Alt+C',
          resumo: 'Aciona a entrada de contato do CRM.',
          detalhes: 'É um passo separado do atendimento rápido. O próprio CRM continua sendo a origem do formulário e do registro do contato.'
        },
        {
          titulo: 'Negociações e títulos em acordo', atalho: 'Automático',
          resumo: 'Evita tratar títulos negociados como vencidos comuns.',
          detalhes: 'Para acordos ativos ou concluídos aguardando a baixa, os títulos originais ficam fora da cobrança comum; um acordo ativo pode gerar lembrete de parcela, e parcelas atrasadas continuam sendo consideradas. Acordos inadimplentes são cobrados com menção ao acordo; propostas enviadas e canceladas seguem a cobrança normal.'
        }
      ]
    },
    {
      nome: 'Fila e prioridade',
      resumo: 'Organização, navegação e busca dos clientes.',
      itens: [
        {
          titulo: 'Fila por prioridade', atalho: 'Alt+U',
          resumo: 'Continua a fila do dia ou monta uma fila quando necessário.',
          detalhes: 'Aplica a régua de prioridade e organiza a sequência de atendimento. O sistema registra a faixa e a posição para permitir análises posteriores de cobertura.'
        },
        {
          titulo: 'Refazer fila por prioridade', atalho: 'Shift+Alt+U',
          resumo: 'Reconstrói a fila do zero.',
          detalhes: 'É uma ação deliberada, separada do Alt+U para evitar refazer a fila por engano. Retira da nova fila os clientes que já foram contatados hoje, conforme as regras do módulo.'
        },
        {
          titulo: 'Navegar pela fila', atalho: 'Alt+P / Alt+V',
          resumo: 'Vai ao próximo cliente ou volta ao cliente anterior.',
          detalhes: 'A navegação é acionada pelo operador; o módulo da fila não percorre clientes automaticamente por conta própria.'
        },
        {
          titulo: 'Busca rápida de cliente', atalho: 'Alt+B',
          resumo: 'Abre uma busca rápida dentro do fluxo do SmartTable.',
          detalhes: 'Pesquisa por nome, CNPJ ou celular. A comparação telefônica aceita celulares com e sem o nono dígito quando aplicável; números sem formatação que também possam ser documento mantêm fallback para a busca textual do CRM. Mostra correspondências do cadastro principal imediatamente e permite continuar nos responsáveis financeiros, com até quatro leituras em paralelo e uma retentativa para falhas transitórias de rede/HTTP. Cancelamento, consulta incompleta e timeout são sinalizados. A ponte opcional WhatsApp Web fica em integracoes/whatsapp-crm-bridge.user.js e deve ser instalada separadamente; tenta o telefone visível e, quando ausente, usa a raiz do CNPJ no padrão do nome do chat ou a primeira palavra. Recusa grupos reconhecidos e não consulta o histórico. O atalho também fecha a busca quando ela já está aberta.'
        },
        {
          titulo: 'Progresso da fila', atalho: 'Automático',
          resumo: 'Mostra o andamento da fila em execução.',
          detalhes: 'O indicador acompanha o processamento da fila e ajuda a perceber progresso sem depender de uma navegação manual pela lista.'
        }
      ]
    },
    {
      nome: 'Promessas, retornos e registro',
      resumo: 'Acompanhamento de promessas e contatos já realizados.',
      itens: [
        {
          titulo: 'Registrar promessa', atalho: 'Alt+N',
          resumo: 'Seleciona títulos e uma data para registrar a promessa.',
          detalhes: 'O fluxo usa as teclas numéricas de 1 a 9 para selecionar títulos e H/A para escolher hoje ou amanhã, conforme o diálogo. Preenche o registro do CRM e confere o resultado; não trata uma tentativa incerta como gravação confirmada.'
        },
        {
          titulo: 'Checagem de Retornos', atalho: 'Shift+Alt+R',
          resumo: 'Cria uma fila local de clientes contatados hoje.',
          detalhes: 'Permite iniciar, pausar, navegar entre clientes e marcar Retornou ou Sem retorno pelo formulário nativo do CRM. A saída da fila depende de confirmação do novo registro. Se a gravação for incerta, o fluxo não a repete automaticamente.'
        },
        {
          titulo: 'Registro Rápido e frases fixadas', atalho: 'No perfil do cliente',
          resumo: 'Reaproveita observações sem registrar automaticamente.',
          detalhes: 'As frases fixadas aparecem dentro do formulário. Clicar numa frase preenche somente a observação e preserva o resultado selecionado. O contato só é salvo quando o operador aciona Registrar contato.'
        }
      ]
    },
    {
      nome: 'Perfil e contatos',
      resumo: 'Informações do responsável financeiro e integração com contatos.',
      itens: [
        {
          titulo: 'Informações de Contato', atalho: 'No perfil do cliente',
          resumo: 'Reúne dados e ações úteis para o contato.',
          detalhes: 'O cartão organiza informações do cliente, responsável financeiro, alertas e ações relacionadas. O layout se ajusta à área principal disponível e se adapta a telas mais estreitas.'
        },
        {
          titulo: 'Nome padronizado do contato', atalho: 'Copiar no perfil',
          resumo: 'Prepara um nome consistente para WhatsApp e Google Contacts.',
          detalhes: 'O nome é montado a partir das informações disponíveis do responsável financeiro. A regra remove o CNPJ completo e sufixos societários finais, preservando a raiz empresarial para identificação.'
        },
        {
          titulo: 'Contatos do Google por CSV', atalho: 'Alt+J',
          resumo: 'Importa um CSV exportado e confere contatos da lista.',
          detalhes: 'O checkup identifica contatos ausentes, diferenças e falhas de leitura. Também permite preparar um CSV de novos contatos com os dados disponíveis do responsável financeiro; os dados precisam ser conferidos antes de salvar no CRM ou no Google.'
        },
        {
          titulo: 'Sincronização direta com Google Contacts', atalho: 'Pelo painel de contatos',
          resumo: 'Prepara correções de nome e celular com prévia antes de gravar.',
          detalhes: 'Exige configuração OAuth e acesso à People API. Só grava os campos selecionados após confirmação explícita, cria backup JSON antes de alterações e permite desfazer enquanto a versão do contato não tiver mudado. Contatos ambíguos, conflitos e falhas de autorização interrompem a gravação.'
        }
      ]
    },
    {
      nome: 'Mensagens e alertas',
      resumo: 'Textos reutilizáveis, contexto e avisos de cobrança.',
      itens: [
        {
          titulo: 'Editor de mensagens', atalho: 'Alt+X',
          resumo: 'Edita mensagens como rascunho, mostra prévia e publica versões.',
          detalhes: 'Permite consultar os textos do Alt+A, visualizar a mensagem completa, publicar alterações, consultar o histórico e restaurar uma versão anterior.'
        },
        {
          titulo: 'Alerta de grupo econômico', atalho: 'Integrado ao atendimento',
          resumo: 'Identifica outras razões do grupo com títulos vencidos.',
          detalhes: 'Ajuda a preparar os relatórios das outras razões. Razões marcadas como Não cobrar não recebem relatório de cobrança, conforme as regras aplicáveis.'
        },
        {
          titulo: 'Contexto de promessa e contato recente', atalho: 'Automático no perfil',
          resumo: 'Apresenta contexto relevante de promessas e contatos.',
          detalhes: 'Verifica promessas pendentes para hoje e promessas vencidas sem contato posterior identificado, ajudando a explicar a situação ao abrir o cliente.'
        },
        {
          titulo: 'Lembretes de bloqueio', atalho: 'Alt+E',
          resumo: 'Consulta e configura regras que geram lembretes.',
          detalhes: 'Este recurso é informativo: o lembrete não bloqueia a cobrança por conta própria. O painel permite ajustar as opções que foram disponibilizadas na configuração.'
        }
      ]
    },
    {
      nome: 'Indicadores e confiabilidade',
      resumo: 'Recebimentos, carteira, diário, diagnóstico e atualização.',
      itens: [
        {
          titulo: 'Recebido na semana e meta', atalho: 'Alt+D',
          resumo: 'Mostra os recebimentos do período semanal e a meta.',
          detalhes: 'A semana usada pelo sistema vai de sábado a sexta. A visão contempla os recebimentos atribuídos a Isaac e Bianca, conforme os dados disponíveis no CRM.'
        },
        {
          titulo: 'Painel Carteira', atalho: 'Alt+M',
          resumo: 'Reúne vencido, aging, evolução, cura e resultado.',
          detalhes: 'O painel tem abas Hoje, Evolução, Resultado e Régua, com métricas calculadas a partir do diário e das fontes do CRM. Indicadores sem uma fonte confiável não são inventados nem exibidos como números confirmados.'
        },
        {
          titulo: 'Diário de cobrança', atalho: 'Registro automático',
          resumo: 'Guarda eventos de fila, contato e títulos que saíram da lista.',
          detalhes: 'Os dados ajudam a analisar cobertura e ritmo do atendimento. Um título que sumiu da lista de vencidos é apenas uma inferência de baixa: renegociação, baixa manual e mudança de situação podem produzir o mesmo sinal.'
        },
        {
          titulo: 'Diagnósticos censurados', atalho: 'window.__diag no console',
          resumo: 'Ajuda a verificar fila, grupo e qualidade do diário.',
          detalhes: 'A saída é censurada por padrão para reduzir exposição de dados. Mantém informações como contagens, situações, faixas e formatos necessários à análise. Isso é pseudonimização, não anonimato criptográfico.'
        },
        {
          titulo: 'Ajuda e novidades', atalho: 'Alt+H / Alt+L',
          resumo: 'Consulta os atalhos e as mudanças registradas por versão.',
          detalhes: 'A ajuda lista os atalhos existentes. As novidades descrevem mudanças em linguagem funcional, sem depender apenas da mensagem técnica dos commits.'
        },
        {
          titulo: 'Distribuição e atualização', atalho: 'Tampermonkey',
          resumo: 'Carrega os módulos versionados do espelho público.',
          detalhes: 'O fluxo automatizado de publicação depende de testes verdes. A atualização pode demorar por causa do cache do raw.githubusercontent.com. Alguns recursos também dependem do CRM real, permissões do navegador ou serviços externos.'
        }
      ]
    }
  ];

  let painelEl = null;
  let abaAtiva = 'funcoes';
  let botaoFuncoes = null;
  let botaoHistorico = null;

  const CORES = {
    tinta: '#16232F', texto: '#344054', apagado: '#667085', borda: '#d0d5dd',
    linha: '#eaecf0', fundo: '#ffffff', fundoSuave: '#f8fafc',
    destaque: '#e8eef4', azul: '#244b69'
  };

  function normalizarTexto(valor) {
    return String(valor == null ? '' : valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
  }

  function criarElemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }

  function estilizar(el, estilos) {
    Object.assign(el.style, estilos);
    return el;
  }

  function obterHistorico() {
    return Array.isArray(window.__logAtualizacoes) ? window.__logAtualizacoes : [];
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  function estaAberto() {
    return !!painelEl;
  }

  function corresponde(texto, busca) {
    return !busca || normalizarTexto(texto).includes(busca);
  }

  function criarBotaoAba(texto, aba, contador) {
    const botao = criarElemento('button', 'smarttable-guia-aba', texto + ' (' + contador + ')');
    botao.type = 'button';
    botao.dataset.smarttableAba = aba;
    botao.setAttribute('aria-pressed', String(abaAtiva === aba));
    estilizar(botao, {
      border: '1px solid ' + (abaAtiva === aba ? CORES.azul : CORES.borda),
      background: abaAtiva === aba ? CORES.destaque : CORES.fundo,
      color: abaAtiva === aba ? CORES.tinta : CORES.texto,
      borderRadius: '8px', padding: '9px 12px',
      font: '600 13px system-ui, -apple-system, sans-serif',
      cursor: 'pointer', whiteSpace: 'nowrap'
    });
    botao.addEventListener('click', function () {
      abaAtiva = aba;
      pintarAbas();
      renderizarConteudo();
    });
    return botao;
  }

  function pintarAbas() {
    [[botaoFuncoes, 'funcoes'], [botaoHistorico, 'historico']].forEach(function (par) {
      const botao = par[0];
      if (!botao) return;
      const ativo = abaAtiva === par[1];
      botao.setAttribute('aria-pressed', String(ativo));
      botao.style.borderColor = ativo ? CORES.azul : CORES.borda;
      botao.style.background = ativo ? CORES.destaque : CORES.fundo;
      botao.style.color = ativo ? CORES.tinta : CORES.texto;
    });
  }

  function criarCartao(item) {
    const card = criarElemento('article', 'smarttable-guia-cartao');
    card.dataset.smarttableCard = '1';
    estilizar(card, {
      border: '1px solid ' + CORES.linha, borderRadius: '10px',
      background: CORES.fundo, padding: '14px', minWidth: '0',
      boxShadow: '0 1px 2px rgba(16,24,40,.04)'
    });
    const topo = estilizar(criarElemento('div', 'smarttable-guia-cartao-topo'), {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: '10px', marginBottom: '7px'
    });
    const titulo = estilizar(criarElemento('h3', '', item.titulo), {
      margin: '0', color: CORES.tinta,
      font: '700 14px/1.35 system-ui, -apple-system, sans-serif'
    });
    topo.appendChild(titulo);
    if (item.atalho) {
      topo.appendChild(estilizar(criarElemento('span', '', item.atalho), {
        flex: '0 0 auto', background: CORES.fundoSuave,
        border: '1px solid ' + CORES.borda, borderRadius: '6px',
        padding: '3px 6px', color: CORES.azul,
        font: '600 11px ui-monospace, SFMono-Regular, Consolas, monospace',
        whiteSpace: 'nowrap'
      }));
    }
    card.appendChild(topo);
    card.appendChild(estilizar(criarElemento('p', '', item.resumo), {
      margin: '0 0 8px', color: CORES.texto,
      font: '500 13px/1.45 system-ui, -apple-system, sans-serif'
    }));
    card.appendChild(estilizar(criarElemento('p', 'smarttable-guia-detalhes', item.detalhes), {
      margin: '0', color: CORES.apagado,
      font: '12px/1.55 system-ui, -apple-system, sans-serif'
    }));
    return card;
  }

  function renderizarFuncoes(conteudo, busca) {
    let total = 0;
    CATEGORIAS.forEach(function (categoria) {
      const itens = categoria.itens.filter(function (item) {
        return corresponde([
          categoria.nome, categoria.resumo, item.titulo, item.atalho, item.resumo, item.detalhes
        ].join(' '), busca);
      });
      if (itens.length === 0) return;

      const secao = criarElemento('section', 'smarttable-guia-secao');
      secao.dataset.smarttableCategoria = categoria.nome;
      secao.appendChild(estilizar(criarElemento('h2', '', categoria.nome), {
        margin: '0 0 4px', color: CORES.tinta,
        font: '700 16px/1.35 system-ui, -apple-system, sans-serif'
      }));
      secao.appendChild(estilizar(criarElemento('p', '', categoria.resumo), {
        margin: '0 0 12px', color: CORES.apagado,
        font: '12px/1.45 system-ui, -apple-system, sans-serif'
      }));
      const grade = estilizar(criarElemento('div', 'smarttable-guia-grade'), {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
        gap: '10px'
      });
      itens.forEach(function (item) {
        grade.appendChild(criarCartao(item));
        total += 1;
      });
      secao.appendChild(grade);
      conteudo.appendChild(secao);
    });

    if (total === 0) {
      conteudo.appendChild(estilizar(criarElemento('p', '', 'Nenhuma funcionalidade corresponde à busca.'), {
        margin: '20px 0', color: CORES.apagado, textAlign: 'center',
        font: '13px system-ui, -apple-system, sans-serif'
      }));
    }
    return total;
  }

  function renderizarHistorico(conteudo, busca) {
    const historico = obterHistorico();
    const entradas = historico.filter(function (entrada) {
      return corresponde([
        entrada.versao, entrada.data,
        Array.isArray(entrada.mudancas) ? entrada.mudancas.join(' ') : ''
      ].join(' '), busca);
    });

    if (entradas.length === 0) {
      const mensagem = historico.length === 0
        ? 'O histórico de versões não carregou. As funcionalidades continuam disponíveis na outra aba.'
        : 'Nenhuma versão corresponde à busca.';
      conteudo.appendChild(estilizar(criarElemento('p', '', mensagem), {
        margin: '20px 0', color: CORES.apagado, textAlign: 'center',
        font: '13px system-ui, -apple-system, sans-serif'
      }));
      return 0;
    }

    entradas.forEach(function (entrada) {
      const item = criarElemento('article', 'smarttable-guia-historico');
      item.dataset.smarttableHistoryEntry = entrada.versao;
      estilizar(item, {
        border: '1px solid ' + CORES.linha, borderRadius: '10px',
        padding: '13px 15px', marginBottom: '10px', background: CORES.fundo
      });
      const topo = estilizar(criarElemento('div', ''), {
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        alignItems: 'center', gap: '8px', marginBottom: '8px'
      });
      topo.appendChild(estilizar(criarElemento('h3', '', 'Versão ' + entrada.versao), {
        margin: '0', color: CORES.tinta,
        font: '700 14px/1.35 system-ui, -apple-system, sans-serif'
      }));
      topo.appendChild(estilizar(criarElemento('span', '', entrada.data || 'Data não informada'), {
        color: CORES.apagado, font: '12px system-ui, -apple-system, sans-serif'
      }));
      item.appendChild(topo);

      const lista = estilizar(criarElemento('ul', ''), {
        margin: '0', paddingLeft: '20px', color: CORES.texto,
        font: '12px/1.6 system-ui, -apple-system, sans-serif'
      });
      (Array.isArray(entrada.mudancas) ? entrada.mudancas : []).forEach(function (mudanca) {
        lista.appendChild(criarElemento('li', '', mudanca));
      });
      item.appendChild(lista);
      conteudo.appendChild(item);
    });
    return entradas.length;
  }

  function renderizarConteudo() {
    if (!painelEl) return;
    const conteudo = painelEl.querySelector('[data-smarttable-conteudo]');
    const campoBusca = painelEl.querySelector('[data-smarttable-busca]');
    const contador = painelEl.querySelector('[data-smarttable-contador]');
    if (!conteudo || !campoBusca || !contador) return;

    conteudo.replaceChildren();
    const busca = normalizarTexto(campoBusca.value.trim());
    const total = abaAtiva === 'funcoes'
      ? renderizarFuncoes(conteudo, busca)
      : renderizarHistorico(conteudo, busca);
    contador.textContent = total + (abaAtiva === 'funcoes'
      ? (total === 1 ? ' funcionalidade encontrada' : ' funcionalidades encontradas')
      : (total === 1 ? ' versão encontrada' : ' versões encontradas'));
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }

    window.__smartTableUtil?.fecharOutrosPaineis?.('implementacoes');
    abaAtiva = 'funcoes';

    painelEl = estilizar(criarElemento('div', 'smarttable-guia-overlay'), {
      position: 'fixed', inset: '0', zIndex: '2147483000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '12px', boxSizing: 'border-box',
      background: 'rgba(16, 24, 40, .58)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    });
    painelEl.id = 'smarttable-painel-implementacoes';
    painelEl.addEventListener('click', function (evento) {
      if (evento.target === painelEl) fecharPainel();
    });

    const dialogo = estilizar(criarElemento('div', 'smarttable-guia-dialogo'), {
      display: 'flex', flexDirection: 'column', width: 'min(1120px, 100%)',
      maxHeight: '100%', overflow: 'hidden',
      border: '1px solid ' + CORES.borda, borderRadius: '14px',
      background: CORES.fundo, boxShadow: '0 18px 60px rgba(0,0,0,.28)'
    });
    dialogo.setAttribute('role', 'dialog');
    dialogo.setAttribute('aria-modal', 'true');
    dialogo.setAttribute('aria-labelledby', 'smarttable-guia-titulo');
    painelEl.appendChild(dialogo);

    const cabecalho = estilizar(criarElemento('div', 'smarttable-guia-cabecalho'), {
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: '16px', padding: '18px 20px 14px',
      borderBottom: '1px solid ' + CORES.linha,
      background: CORES.fundo, flex: '0 0 auto'
    });
    const textos = estilizar(criarElemento('div', ''), { minWidth: '0' });
    const tituloGuia = estilizar(criarElemento('h1', '', 'Guia de Implementações'), {
      margin: '0 0 5px', color: CORES.tinta,
      font: '750 21px/1.25 system-ui, -apple-system, sans-serif'
    });
    tituloGuia.id = 'smarttable-guia-titulo';
    textos.appendChild(tituloGuia);
    textos.appendChild(estilizar(criarElemento('p', '', 'O que cada recurso faz, como acessá-lo e quais são seus limites.'), {
      margin: '0', color: CORES.apagado,
      font: '12px/1.5 system-ui, -apple-system, sans-serif'
    }));
    cabecalho.appendChild(textos);

    const fechar = estilizar(criarElemento('button', '', 'Fechar'), {
      flex: '0 0 auto', border: '1px solid ' + CORES.borda,
      borderRadius: '8px', padding: '8px 11px', background: CORES.fundo,
      color: CORES.texto, font: '600 12px system-ui, -apple-system, sans-serif',
      cursor: 'pointer'
    });
    fechar.type = 'button';
    fechar.setAttribute('aria-label', 'Fechar guia de implementações');
    fechar.addEventListener('click', fecharPainel);
    cabecalho.appendChild(fechar);
    dialogo.appendChild(cabecalho);

    const controles = estilizar(criarElemento('div', 'smarttable-guia-controles'), {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px',
      padding: '12px 20px', borderBottom: '1px solid ' + CORES.linha,
      background: CORES.fundoSuave, flex: '0 0 auto'
    });
    botaoFuncoes = criarBotaoAba('Funcionalidades', 'funcoes',
      CATEGORIAS.reduce(function (n, categoria) { return n + categoria.itens.length; }, 0));
    botaoHistorico = criarBotaoAba('Histórico de versões', 'historico', obterHistorico().length);
    const abas = estilizar(criarElemento('div', 'smarttable-guia-abas'), {
      display: 'flex', flexWrap: 'wrap', gap: '7px'
    });
    abas.appendChild(botaoFuncoes);
    abas.appendChild(botaoHistorico);
    controles.appendChild(abas);

    const busca = estilizar(criarElemento('input', 'smarttable-guia-busca'), {
      flex: '1 1 260px', minWidth: '180px', boxSizing: 'border-box',
      border: '1px solid ' + CORES.borda, borderRadius: '8px',
      padding: '10px 12px', color: CORES.tinta, background: CORES.fundo,
      font: '13px system-ui, -apple-system, sans-serif'
    });
    busca.type = 'search';
    busca.placeholder = 'Buscar função, atalho, palavra ou versão...';
    busca.setAttribute('aria-label', 'Buscar no guia de implementações');
    busca.dataset.smarttableBusca = '1';
    busca.addEventListener('input', renderizarConteudo);
    controles.appendChild(busca);
    dialogo.appendChild(controles);

    const area = estilizar(criarElemento('div', 'smarttable-guia-area'), {
      overflow: 'auto', padding: '18px 20px 10px',
      flex: '1 1 auto', minHeight: '0', background: CORES.fundo
    });
    const conteudo = criarElemento('div', 'smarttable-guia-conteudo');
    conteudo.dataset.smarttableConteudo = '1';
    area.appendChild(conteudo);
    dialogo.appendChild(area);

    const rodape = estilizar(criarElemento('div', 'smarttable-guia-rodape'), {
      display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
      gap: '8px', padding: '10px 20px',
      borderTop: '1px solid ' + CORES.linha,
      color: CORES.apagado, background: CORES.fundoSuave,
      font: '11px/1.45 system-ui, -apple-system, sans-serif',
      flex: '0 0 auto'
    });
    const contador = criarElemento('span', '');
    contador.dataset.smarttableContador = '1';
    rodape.appendChild(contador);
    rodape.appendChild(criarElemento('span', '', 'Shift+Alt+I abre/fecha · Esc fecha · o histórico vem do registro do Alt+L'));
    dialogo.appendChild(rodape);

    document.body.appendChild(painelEl);
    pintarAbas();
    renderizarConteudo();
    busca.focus();
  }

  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && painelEl) {
      evento.preventDefault();
      fecharPainel();
    }
  }, true);

  window.__painelImplementacoes = {
    alternarPainel: alternarPainel,
    fecharPainel: fecharPainel,
    estaAberto: estaAberto,
    quantidadeFuncionalidades: function () {
      return CATEGORIAS.reduce(function (n, categoria) { return n + categoria.itens.length; }, 0);
    }
  };
  window.__smartTableUtil?.registrarPainel?.('implementacoes', fecharPainel);
})();