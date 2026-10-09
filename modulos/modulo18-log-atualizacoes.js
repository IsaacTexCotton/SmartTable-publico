/* =========================================================================
 * MÓDULO 18: LOG DE ATUALIZAÇÃO (Alt+L) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Só DADOS: o que mudou em cada versão, em linguagem de quem USA o script --
 * não mensagem de commit. A entrada mais recente fica em primeiro. O painel
 * que mostra isto é do Módulo 4 (Alt+L), que lê window.__logAtualizacoes.
 *
 * Separado do Módulo 4 na v1.46.0 (revisão de código): eram ~600 linhas de
 * texto no meio do código dos atalhos, e todo bump de versão mexia nele.
 *
 * MANTER ATUALIZADO a cada bump: tests/changelog.test.js FALHA se a versão
 * do topo desta lista não for a mesma de VERSAO_SMARTTABLE (Módulo 6) e do
 * @version do wrapper. É de propósito -- changelog que envelhece em silêncio
 * é pior que não ter, porque passa a mentir sobre o que está rodando.
 *
 * Carrega ANTES do Módulo 4 (ordem do @require no wrapper).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__logAtualizacoesCarregado) return;
  window.__logAtualizacoesCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Log de Atualização');

  const LOG_ATUALIZACOES = [
    {
      versao: '1.100.1', data: '09/10/2026',
      mudancas: [
        'Alt+U: o cliente cujo acordo tem parcela atrasada voltou para a faixa "Promessa não cumprida" (a 7). Na renumeração da régua ele tinha caído sem querer em "Dia da promessa de pagamento" (a 6).',
        'Alt+U: cliente acima de 19 dias sem nenhum título em cobrança (por exemplo, tudo "fora do relatório") sai como excluído por dias, e não mais como "erro/timeout" no resumo.',
        'Detecção de pagamento (baixa de título): se a tabela de títulos ainda está sendo montada quando a página carrega, o retrato dos títulos do cliente não é mais apagado, e nenhum título é dado como pago por engano.',
      ],
    },
    {
      versao: '1.100.0', data: '09/10/2026',
      mudancas: [
        'Alt+N (promessa rápida): título que JÁ está em cartório deixa de ser recusado, já que o cliente só-cartório agora é cobrado. A recusa continua só para o título que ainda não está em cartório mas já estará na data escolhida (aviso vermelho com a data máxima).',
      ],
    },
    {
      versao: '1.99.0', data: '09/10/2026',
      mudancas: [
        'Aviso "Não cobrar este cliente": agora acompanha a tabela. Se as linhas chegam depois da página ou mudam sem recarregar, o aviso aparece, troca de título ou sai sozinho. Título "NÃO COBRAR"/"CARTEIRA" com vencimento ilegível também dispara o aviso.',
        'Registrar e Enviar: o telefone enviado ao WhatsApp (app e web) leva só dígitos; "+", espaço, parênteses e traço não quebram mais o endereço.',
        'Contatos do Google: tratamentos antes do nome (Sr., Sra., Dr., Dra., Dona, Prof.) são ignorados: "Sr. João" vira "João".',
        'Carteira: sem IndexedDB no navegador, um aviso diário diz na hora que a fotografia vale só nesta aba. O texto livre "próxima tarefa" deixa de ser gravado nas novas fotografias.',
      ],
    },
    {
      versao: '1.98.0', data: '09/10/2026',
      mudancas: [
        'Alt+S: o bloqueio de "não cobrar" agora vale também no Alt+S comum. Antes só barrava quando "Números diferentes" estava ligado; um cliente com "Não cobrar" no Alerta (ou com todos os títulos "fora do relatório") recebia o envio normalmente. Agora aparece "Envio bloqueado: ..." e nada é enviado.',
        'Alt+S: se a leitura de um acordo falhou e você não passou pelo Alt+A (que pergunta se quer seguir), o Alt+S não envia mais; avisa para apertar o Alt+A ou recarregar.',
        'Alt+A: a outra razão do grupo que está com "Não cobrar" no Alerta não ganha mais relatório em aba de fundo.',
        'Alerta do cliente: o "Não cobrar" passa a valer para o mesmo CNPJ escrito com ou sem pontos e traços (antes dependia de a lista e a página escreverem igual).',
      ],
    },
    {
      versao: '1.97.0', data: '09/10/2026',
      mudancas: [
        'Alt+U: o teto de 19 dias de atraso deixou de cortar o cliente de cartório. Cliente do fluxo Cartório com todos os títulos vencidos em cartório entra na fila (faixa 16, por último) mesmo com mais de 19 dias. O teto continua valendo para o fluxo de negativação (SCPC) e para quem tem algum título fora do cartório; Cluster Novo continua isento. Efeito: o Alt+U passa a visitar também os clientes acima de 19 dias para saber o fluxo, então a primeira montagem do dia demora mais.',
      ],
    },
    {
      versao: '1.96.0', data: '09/10/2026',
      mudancas: [
        'Cliente com TODOS os títulos vencidos em cartório deixou de ser "não cobrar": não aparece mais o banner vermelho "Não cobrar este cliente", e o Alt+A, o Alt+S e o registro funcionam normalmente para ele. Quem tem título em NÃO COBRAR / CARTEIRA, ou "Não cobrar" marcado no Alerta, continua bloqueado como antes.',
        'Alt+U: faixa nova, a 16, "Todos os títulos em cartório", por último na fila (depois de "Demais dias"), com cor própria. Só cai nela quem nenhuma faixa de cima pegou: Cluster Novo, sem contato, promessa etc. continuam na frente. A numeração das faixas de 1 a 15 não mudou.',
      ],
    },
    {
      versao: '1.95.1', data: '08/10/2026',
      mudancas: [
        'Corrigir CSV e baixar (Alt+J): o corretor não reescreve mais um contato quando isso perderia texto. Uma razão social com mais de 120 letras (o Alt+J guarda só as 120 primeiras) agora fica de fora e entra em "sem como corrigir", em vez de ir cortada para o arquivo que você importa no Google. O mesmo vale para "SP GP 3 Maria", em que sem hífen não dá para saber onde o grupo termina: fica para você corrigir à mão.',
        'Corrigir CSV e baixar (Alt+J): o contato que o Alt+J já lê pelo File As ou pela Organization Name passa a contar em "já estavam no padrão" (antes entrava em "sem como corrigir"). Um defeito interno do corretor passa a aparecer no console do navegador (só o tipo e a mensagem do erro).',
      ],
    },
    {
      versao: '1.95.0', data: '08/10/2026',
      mudancas: [
        'Contatos do Google (Alt+J): novo botão "Corrigir CSV e baixar". Você escolhe o CSV exportado do Google e ele baixa um CSV SÓ com os contatos que o Alt+J consegue arrumar (por exemplo "RAZÃO - 12345678 - SP Maria" ou "RAZÃO - 12345678-SP-Maria"), com o nome inteiro no padrão "RAZÃO - RAIZ - UF - nome" na coluna First Name; as outras colunas não mudam. Contato que já está no padrão, contato sem UF e contato de pessoa não entram no arquivo. O arquivo é lido e baixado no seu navegador, nada é enviado. Antes de importar o arquivo no Google, teste com 2 contatos para ver se ele duplica ou atualiza.',
        'Contatos do Google (Alt+J): o resumo da importação explica os contatos "sem o nome do responsável" (o Google não tem nome depois da UF) e a linha do padrão diz que também vale só "RAZÃO - RAIZ", sem a UF.',
      ],
    },
    {
      versao: '1.94.0', data: '08/10/2026',
      mudancas: [
        'Contatos do Google (Alt+J): o contato que traz só a razão e a raiz do CNPJ, sem a UF ("RAZÃO - 12345678"), agora é reconhecido e liga ao cliente pela raiz; o cartão do aviso mostra o contato sem a linha de UF. Vale só quando a raiz é o ÚLTIMO trecho e há uma razão antes: um número de 8 dígitos sozinho, ou uma raiz seguida de algo que não é UF ("12345678 - XX - Maria"), continua fora do padrão. Para valer nos contatos já guardados, importe o CSV de novo no Alt+J.',
      ],
    },
    {
      versao: '1.93.0', data: '08/10/2026',
      mudancas: [
        'Contatos do Google (Alt+J): o nome do contato passa a ser entendido também quando o padrão vem com um detalhe fora do lugar. "RAZÃO - 12345678 - SP Maria" (nome colado na UF só por espaço), "RAZÃO - 12345678-SP" e "RAZÃO - 12345678-SP-Maria" (hífen sem espaços) agora são reconhecidos, em vez de caírem em "fora do padrão". Continua valendo: a raiz tem 8 caracteres, a UF é uma sigla de verdade em MAIÚSCULAS e vem logo depois da raiz. Para valer nos contatos já guardados, importe o CSV de novo no Alt+J.',
      ],
    },
    {
      versao: '1.92.0', data: '08/10/2026',
      mudancas: [
        'Limpeza pedida por você: saíram os atalhos Alt+F (selecionar a 1ª frase padrão), Alt+G (abrir em abas as outras razões do grupo), Alt+K (console de diagnóstico) e Alt+T (copiar títulos um por um, com o Shift+Alt+T). O Alt+A segue gerando o relatório das outras razões do grupo.',
        'Os comandos de diagnóstico do ritmo do operador continuam no console do navegador (window.__diag.qualidade(), .ritmo() e .filaDefasada()); só o painel do Alt+K, que tinha botões para eles, saiu.',
      ],
    },
    {
      versao: '1.91.0', data: '08/10/2026',
      mudancas: [
        'Lista de clientes: o botão "▶ Iniciar Fila de Atendimento" saiu da barra. A fila de atendimento original continua no atalho Alt+I (e a fila por prioridade no Alt+U); o botão "Continuar fila anterior" segue onde estava.',
      ],
    },
    {
      versao: '1.90.0', data: '08/10/2026',
      mudancas: [
        'Contatos do Google (Alt+J e botão da lista): o nome do responsável passa a ser só o PRIMEIRO NOME do contato. "ANA PAULA SOUZA" vira "Ana" ao preencher o CRM; palavra toda em maiúsculas ou minúsculas ganha só a inicial maiúscula. Números, parênteses e separadores (/ , & ;) antes do nome são ignorados.',
        'A comparação com o CRM usa o primeiro nome (sem acento nem maiúscula): "Ana" e "Ana Paula" são o mesmo responsável, então deixam de aparecer como diferença. Contatos importados antes desta versão já valem assim, sem importar de novo.',
      ],
    },
    {
      versao: '1.89.0', data: '08/10/2026',
      mudancas: [
        'Alt+X: botão "Limites…" ao lado de "+ Nova situação". Você escolhe o máximo de situações (de 5 a 200) e o máximo de caracteres no nome de uma situação (de 10 a 200). Vale na hora, sem Publicar, e nenhuma mensagem muda.',
        'Os limites nunca ficam abaixo do que já está em uso (rascunho ou publicado): a tela diz até onde dá para baixar. "Voltar ao padrão" restaura 20 situações e 60 caracteres.',
      ],
    },
    {
      versao: '1.88.0', data: '08/10/2026',
      mudancas: [
        'Alt+A, Celular: o nome do cliente aparece no cabeçalho (quando todos os títulos são da mesma razão social, e então some das linhas). Os cards ficam com fundo neutro: a cor está na barra e no selo, que sai cheio em último dia, cartório e SCPC.',
        'Alt+A, Celular: a imagem ficou mais estreita (360px) e nenhum texto fica abaixo de 12px, para ler melhor no WhatsApp. A legenda do fim saiu, porque cada selo já diz a situação.',
        'Alt+A, Celular: a ordem muda. Fora do SCPC: último dia, em atraso, em cartório (mais dias primeiro em cada grupo). Cliente SCPC: só os dias de atraso, do maior para o menor. O Desktop continua na ordem da tabela.',
        'O seletor virou um botão só, "Formato: Celular ⇄", que alterna. O botão passa a dizer o formato do próximo relatório ("Gerar Relatório · Celular"). Desktop: nada mudou.',
      ],
    },
    {
      versao: '1.87.0', data: '08/10/2026',
      mudancas: [
        'Alt+A: ao lado do botão "Gerar Relatório" agora você escolhe o Formato, Celular ou Desktop. A escolha fica salva neste navegador e só vale na próxima geração (trocar não gera nada).',
        'Celular: imagem vertical própria. Até 5 títulos saem em cards (título, saldo e dias de atraso em destaque); com 6 ou mais, em lista compacta, com a razão social na terceira linha. O total fica no topo.',
        'Desktop: o relatório continua exatamente como era. Nenhuma regra de cobrança mudou.',
      ],
    },
    {
      versao: '1.86.0', data: '07/10/2026',
      mudancas: [
        'Alt+X: agora você organiza as situações (os grupos da lista). "+ Nova situação" cria uma vazia; "Renomear", "↑" e "↓" mudam o nome e a ordem de qualquer uma, inclusive das 5 de sempre.',
        'Alt+X: cada texto ganhou "Mover para", para trocá-lo de situação. "Restaurar o padrão" também devolve o texto à situação de origem.',
        'Só situação criada por você e vazia pode ser apagada (com confirmação). As 5 de sempre não se apagam. Vale só depois de publicar, e a versão anterior volta pelo Histórico.',
        'É só organização da tela: nenhuma mensagem do Alt+A muda. O Publicar mostra a organização à parte dos textos que mudam.',
      ],
    },
    {
      versao: '1.85.0', data: '06/10/2026',
      mudancas: [
        'Alt+X: cada texto ganhou o interruptor "Usar este trecho na mensagem". Desativado, a mensagem do Alt+A sai sem aquele trecho (vale só depois de publicar; "Reativar" volta). Nas perguntas finais pede confirmação, porque sem elas a mensagem sai sem pergunta.',
        'Alt+X: novo botão "Renomear" em cada texto, para mudar o nome e a nota (a nota não muda quando a frase vale; é só um lembrete seu). "Restaurar o padrão" também reativa o trecho e devolve o nome e a nota originais.',
        'Pedaços de uma frase maior (a saudação, "ontem", o destino do encaminhamento e as cores da legenda) só podem ser renomeados: vazios, a frase em volta sairia quebrada.',
        'A prévia avisa nas situações em que o trecho desativado faz diferença, e a tela Publicar conta quantos trechos ficam desativados (é só um lembrete: não impede de publicar).',
        'Correção: com a pergunta final, a apresentação ou uma frase do acordo desativadas, a mensagem não sai mais com espaço sobrando nem balão vazio.',
      ],
    },
    {
      versao: '1.84.0', data: '06/10/2026',
      mudancas: [
        'Alt+X: novo botão "Editar por texto" em cada texto. Junta todas as frases numa caixa só, uma por linha (linha vazia é ignorada, e a partir da 13ª frase as linhas são cortadas com aviso). "Voltar para as caixas" devolve as caixas de sempre.',
        'A prévia ganhou a opção "Pior caso (frase mais longa)" no seletor: cada texto usa a sua frase mais longa, para você ver o maior tamanho que um cliente pode receber.',
        'A tela Publicar agora mede o tamanho (5 balões, 320 por balão, 600 no total, 750 com acordo) nesse pior caso. É só um lembrete: nunca impede de publicar.',
      ],
    },
    {
      versao: '1.83.0', data: '06/10/2026',
      mudancas: [
        'Alt+X: todo texto agora aceita até 12 frases, não só as perguntas finais. Em "Editar", qualquer texto mostra "Adicionar variante" e "Remover". Com mais de uma frase, o Alt+A escolhe por cliente e dia (o mesmo cliente recebe a mesma frase no dia; clientes diferentes recebem frases diferentes). Com uma frase só, a mensagem é a mesma de antes.',
      ],
    },
    {
      versao: '1.82.0', data: '06/10/2026',
      mudancas: [
        'Alt+X agora publica: na prévia, o botão "Publicar…" abre uma tela com o que muda ("Em uso" e "Novo"), os erros que impedem a publicação, os avisos de tamanho (que não impedem) e uma nota opcional. Depois de publicado, o texto passa a valer no Alt+A, neste navegador.',
        'Novo botão "Histórico": lista as últimas 20 publicações, mostra o que cada uma mudou e deixa voltar a uma versão (isso cria uma publicação nova; nada é apagado). "Restaurar o padrão", em cada texto, põe o texto padrão como rascunho: você ainda precisa publicar.',
        'Com acordo, a mensagem pode ter até 750 caracteres: de 601 a 750 é só aviso. O backup (exportar e importar) vem na próxima versão.',
      ],
    },
    {
      versao: '1.81.0', data: '06/10/2026',
      mudancas: [
        'Alt+X agora tem o botão "Ver prévia": mostra a mensagem COMPLETA que o Alt+A montaria com os seus rascunhos, balão por balão, em situações inventadas (atraso comum, último dia, cartório, SCPC, promessa, acordo, primeiro contato...). Compara "Antes (em uso)" com "Depois (rascunho)" e mostra só as situações que o seu rascunho muda; "Ver todas as situações" mostra todas, cada uma com o grupo ao lado do título.',
        'O balão novo (azul) e o que saiu (vermelho) ficam em destaque. Cada lado mostra quantos balões, quantos caracteres e o tamanho do maior balão. Se a mensagem passa de 5 balões, de 320 caracteres num balão ou de 600 no total, aparece o aviso (nos casos com acordo, passar de 600 é só aviso). O seletor "Variante da frase" compara a mesma variante em todos os textos com sorteio de frases.',
        'Nada muda no Alt+A: a prévia só lê, não grava nada e não usa dados de cliente. Publicar, o histórico e o backup vêm nas próximas versões.',
      ],
    },
    {
      versao: '1.80.1', data: '05/10/2026',
      mudancas: [
        'Ajustes internos na biblioteca de situações de exemplo que a prévia da mensagem vai usar (ainda sem tela): os casos de tamanho máximo agora são os piores de verdade, medidos em mais de 100 mil combinações. Nada muda no Alt+A.',
      ],
    },
    {
      versao: '1.80.0', data: '05/10/2026',
      mudancas: [
        'Alt+X agora permite EDITAR os textos da mensagem do Alt+A, como rascunho. Em cada texto, o botão "Editar" abre uma caixa por variante (nos textos com sorteio de frases, dá para adicionar e remover variantes), com botões para inserir as variáveis permitidas ({{nome}}, {{titulos}}...) no ponto onde está o cursor.',
        'Enquanto você digita, a janela mostra os problemas ao lado: erros em vermelho (texto vazio, variável que não vale naquele texto, pergunta que falta, frase proibida, endereço de internet ou e-mail) e avisos em âmbar. O rascunho é guardado sozinho, mesmo incompleto, e a forma ganha o selo "rascunho". "Descartar rascunho" volta ao texto em uso.',
        'Nada muda no Alt+A: o rascunho fica só neste navegador e não é usado nas mensagens. Publicar, a prévia da mensagem completa e o backup vêm nas próximas versões.',
      ],
    },
    {
      versao: '1.79.0', data: '05/10/2026',
      mudancas: [
        'Novo atalho Alt+X: abre "Mensagens do Alt+A", uma janela no centro da tela com todos os textos que o Alt+A usa para montar a mensagem, separados em 5 grupos (perguntas finais, linhas fixas, contexto da conversa, situação dos títulos, acordo e legenda do relatório). Cada texto mostra quando ele aparece e o que está sendo usado agora.',
        'Se um texto foi alterado no catálogo, ele aparece com o selo "editado" e o texto padrão ao lado; os demais aparecem com o selo "padrão". Há um campo de busca que procura no título e no texto, sem diferenciar acento nem maiúscula. Esc, Fechar, o X ou um clique fora fecham a janela, e Alt+X de novo também.',
        'Por enquanto a janela é só para ler: nada é gravado e o Alt+A monta a mensagem exatamente como antes. A edição, com rascunho, prévia e publicar, vem nas próximas versões.',
      ],
    },
    {
      versao: '1.78.0', data: '05/10/2026',
      mudancas: [
        'Interno, sem mudança nas mensagens: os textos do Alt+A (saudação, perguntas finais, linhas de situação, acordo e legenda do relatório) saíram do código e agora ficam num catálogo (novo Módulo 30), com o texto de sempre como padrão. Conferido em mais de 22 mil situações diferentes: a mensagem sai idêntica à da versão anterior.',
        'Prepara a próxima etapa: editar os textos pelo próprio CRM, com rascunho, prévia e histórico. Nesta versão nada muda para quem usa. Se um dia o catálogo salvo estiver ilegível ou algum texto dele for inválido, o Alt+A usa o texto padrão e avisa na tela.',
      ],
    },
    {
      versao: '1.77.0', data: '05/10/2026',
      mudancas: [
        'Novo no Alt+A: a saudação agora usa o primeiro nome do Responsável financeiro do cliente, quando ele está cadastrado e parece nome de pessoa. Exemplo: "Bom dia, Maria, tudo bem?" (e "Boa tarde" / "Boa noite" no horário certo). O relatório e o resto da mensagem não mudam. Só vale o primeiro nome: "Maria Silva", "MARIA SILVA" e "maria silva" viram "Maria".',
        'Sem nome cadastrado, ou com um texto que não serve (cargo ou setor como "Financeiro", dois nomes, título como "Dona" ou "Dr.", número, o próprio nome da empresa), a saudação é a de sempre, sem aviso e sem atraso. O primeiro contato (cliente sem nenhum contato registrado) continua SEM nome, porque ali o Alt+A ainda pergunta quem é o responsável. Com "Números diferentes" ativo para o cliente a saudação também sai sem nome, porque aquela mesma mensagem é enviada para outros números do grupo, que podem ser outras pessoas.',
      ],
    },
    {
      versao: '1.76.0', data: '05/10/2026',
      mudancas: [
        'Novo na lista "Contatos do Google": os botões que mexem no NOME ("Adicionar nome", "Trocar nome", "Adicionar ambos" e "Trocar ambos") agora abrem um campo na própria linha, com o nome do Google já preenchido, para você alterar antes de gravar. Uma linha embaixo mostra o que vai para o CRM ("nome ... → ..."), e "Gravar" (ou Enter) grava; "Cancelar" (ou Esc) fecha sem gravar. O "Gravar" já é a confirmação do "Trocar": não precisa mais do segundo clique.',
        'O nome que você escreve vale só para aquela gravação: o contato do Google e o que foi importado não mudam. Nome vazio não grava, o limite é de 150 caracteres (o do CRM), e se o nome digitado já é o que o CRM tem, o botão avisa que não há o que gravar. Se a gravação falhar, o texto que você digitou fica para a próxima tentativa.',
        'Sem mudança: "Adicionar número" e "Trocar número" continuam como eram (o "Trocar número" ainda pede o segundo clique), e continuam valendo as proteções de reler o CRM antes de gravar, conferir depois e o "Desfazer".',
      ],
    },
    {
      versao: '1.75.2', data: '02/10/2026',
      mudancas: [
        'Corrigido nos botões da lista "Contatos do Google": se você fecha o painel e abre de novo enquanto uma gravação está em andamento, o resultado ("Gravado..." ou "abra o cliente e confira") agora aparece num aviso, em vez de se perder no painel antigo.',
        'Corrigido: o relógio de uma confirmação antiga não derruba mais uma confirmação nova (antes, depois de uma gravação recusada, uma segunda confirmação podia sumir antes do tempo), e o "Desfazer" agora cancela a confirmação armada em outra linha, que mostraria um "de → para" defasado.',
        'Textos: quando a resposta do CRM não é JSON (login, erro 502...) o aviso agora diz "o CRM não respondeu como esperado (sessão expirada ou CRM instável)", sem afirmar que a sessão expirou; a frase "A página mostra..." sai com a maiúscula certa; e, se o valor novo só difere do antigo em maiúsculas, acento ou formato, o SmartTable diz que não dá para saber se gravou, em vez de afirmar.',
      ],
    },
    {
      versao: '1.75.1', data: '02/10/2026',
      mudancas: [
        'Corrigido nos botões da lista "Contatos do Google": com mais de um celular no contato, o "Confirmar" agora grava o MESMO número que a confirmação mostrou (antes a lista era redesenhada e o seletor voltava ao primeiro número). Mudar o número depois de armar a confirmação cancela a confirmação.',
        'Corrigido: a confirmação agora vale para cada contato, não para o cliente inteiro. Se a mesma empresa tem dois contatos, clicar no segundo não grava direto com a confirmação do primeiro. A confirmação "celular sob outro nome" agora mostra também o celular antigo que será trocado, e qualquer outro clique cancela a confirmação armada (sem deixar o texto "clique de novo" sobrando).',
        'Corrigido: se a resposta do CRM ao gravar falhar (rede cortada, sem resposta em 30 segundos, sessão expirada), o SmartTable não diz mais "nada foi alterado": ele lê a página de novo e informa o que de fato ficou (gravou, não gravou, ou "abra o cliente e confira"). Fechar o painel no meio de uma gravação não corta mais a conferência: o resultado aparece num aviso. A conferência também tolera o CRM normalizar o nome (maiúsculas) ou guardar o celular só com dígitos.',
      ],
    },
    {
      versao: '1.75.0', data: '02/10/2026',
      mudancas: [
        'Novo na lista "Contatos do Google": botões "Adicionar nome", "Adicionar número" e "Adicionar ambos" em cada linha. Eles gravam o responsável financeiro direto no CRM, sem abrir o cliente, um cliente por vez. Onde o campo do CRM já tem outro valor o botão diz "Trocar" e pede um segundo clique, mostrando de → para (a confirmação some sozinha em 6 segundos).',
        'Proteções: antes de gravar o SmartTable lê a página do cliente de novo e RECUSA se o CRM mudou desde a leitura; colocar só o celular sob um nome diferente também pede confirmação (o celular é o número do WhatsApp); depois de gravar ele lê de novo para conferir e só então mostra "Gravado" (se o CRM respondeu ok mas a página não mostra o valor, avisa); o campo que você não escolheu vai com o valor atual do CRM, sem mudar; e só uma gravação acontece por vez.',
        'Cada gravação entra em "Gravados nesta abertura" com "Desfazer", que devolve o que havia antes (se o CRM ainda estiver como ficou). Se o contato tiver mais de um celular, você escolhe qual gravar. Falhas (o CRM recusou o valor, sessão expirada, sem rede) aparecem na própria linha, com "Nada foi alterado". Não existe gravação em lote.',
      ],
    },
    {
      versao: '1.74.0', data: '02/10/2026',
      mudancas: [
        'Novo: botão "Contatos do Google" na lista de clientes (ao lado dos outros botões da barra). Ele abre um painel com os clientes da lista cujo contato do Google é DIFERENTE do "Responsável financeiro" do CRM, sem você entrar cliente por cliente: o SmartTable lê o responsável de cada cliente que tem contato (só desses, sem abrir aba) e mostra "No CRM" e "No Google" lado a lado, com "Abrir cliente" em cada linha.',
        'O casamento agora também confere a razão social: o contato é comparado com a razão social e o nome fantasia do cliente, e cada linha diz "CNPJ e razão conferem", "Razão diferente: conferir" ou "Só o CNPJ". A comparação ignora LTDA, LTA, ME e "de/da/do" e perdoa um erro de digitação (junihno = juninho). Para isso importe o CSV de novo no Alt+J (a razão do contato passa a ser guardada).',
        'Novo: interruptores "Nome do responsável" e "Celular" (no Alt+J e no painel da lista) para escolher o que comparar e preencher: só nomes, só celulares ou os dois (sempre pelo menos um ligado). Valem também para o aviso ao abrir o cliente. O celular de 10 dígitos do CRM (sem o 9 da frente) agora é reconhecido como o mesmo número do contato com 11 dígitos. Módulo novo: o 29 (Contatos do Google: Lista).',
      ],
    },
    {
      versao: '1.73.1', data: '02/10/2026',
      mudancas: [
        'Corrigido nos Contatos do Google (Alt+J): "Preencher" agora trata nome e celular juntos. Se o CRM já tem OUTRO nome e você não marcou "Substituir o que já está no CRM", nada é digitado (antes só o celular era preenchido e o número de uma pessoa ficava sob o nome de outra, com o selo WHATS apontando para ele). O aviso diz qual nome está no CRM.',
        'Corrigido: se a página do cliente define o responsável um instante depois do SmartTable, ele espera antes de decidir (antes podia mostrar um aviso para quem já estava igual ao contato). O "Responsável conferido no CRM" só aparece quando o CRM de fato passou a ter o valor: se já era igual antes do Salvar, o aviso diz "nada mudou". Fechar o modal sem salvar não deixa a conferência presa.',
        'Corrigido: escolher o mesmo arquivo CSV de novo agora importa (o seletor é limpo); sem IndexedDB a data da importação não sobrevive ao recarregar (como os contatos); uma palavra de 8 letras da razão social (ex.: COMERCIO) não é mais confundida com a raiz do CNPJ; "Clique de novo para apagar" volta ao normal depois de 4 segundos; falha ao ler os contatos guardados passa a avisar.',
      ],
    },
    {
      versao: '1.73.0', data: '02/10/2026',
      mudancas: [
        'Novo: Alt+J abre "Contatos do Google". Você escolhe o CSV exportado do Google Contatos ("Google CSV"); o arquivo é lido no próprio navegador e os contatos no padrão RAZÃO - RAIZ DO CNPJ - UF - GP n - nome ficam guardados só neste navegador. O painel mostra só contagens (lidos, no padrão, fora do padrão e por quê). Importar de novo substitui tudo, e há um botão para apagar.',
        'Ao abrir um cliente, o SmartTable procura os contatos pela raiz do CNPJ e, se houver nome ou celular a oferecer, mostra um aviso: "Preencher" abre o "Responsável financeiro" do CRM, digita o nome e o celular e deixa você CONFERIR e clicar em Salvar (quem grava é o CRM). Com vários contatos na mesma raiz, todos aparecem e você escolhe.',
        'Só preenche o que está vazio no modal; para trocar o que já está lá, marque "Substituir o que já está no CRM". O celular só entra se for celular de verdade (DDD + 9 dígitos), porque ele é o número que o CRM usa para abrir o WhatsApp. Depois do Salvar o SmartTable confere se o CRM guardou. Módulo novo: o 28 (Contatos do Google).',
      ],
    },
    {
      versao: '1.72.0', data: '02/10/2026',
      mudancas: [
        'Novo: Alt+T copia os títulos do cliente um por um para a área de transferência (e para o Win+V), no lugar de copiar número por número à mão. Alt+T abre uma lista com os títulos da tabela, na ordem em que aparecem; escolha "Todos", "Vencidos" ou "Selecionar" (marque um a um) e clique em Começar.',
        'O número do título e a parcela vão separados. "Começar" já copia o número do primeiro título; cada Alt+T seguinte copia o próximo valor: parcela, depois o número do título seguinte, e assim por diante. Um aviso mostra qual valor foi copiado e qual vem depois. Acabando a lista, o Alt+T volta a abrir a escolha.',
        'Shift+Alt+T reabre a escolha no meio da lista, para recomeçar ou recopiar o último valor sem avançar. Se a cópia falhar (a aba sem foco), o Alt+T não pula o valor: aperte de novo. A lista em andamento fica só na memória da página (recarregar a página a zera). Módulo novo: o 27 (Copiar Títulos).',
      ],
    },
    {
      versao: '1.71.1', data: '02/10/2026',
      mudancas: [
        'Corrigido na Meta da semana (Alt+D): o Enter do teclado numérico agora salva a meta (antes só o Enter principal salvava), e depois de salvar ou apagar o foco volta ao campo, para continuar pelo teclado.',
        'Corrigido: a soma do recebido podia sair com uma diferença minúscula de arredondamento (por exemplo, R$ 99.999,99999999999 contra uma meta de R$ 100.000), e a meta não aparecia como batida. Agora o recebido é arredondado ao centavo antes da comparação. O mesmo cuidado vale para o ritmo: faltando R$ 1,10 em um dia, o ritmo é R$ 1,10, e não R$ 1,11.',
        'O percentual só chega a 100% quando a meta foi batida: recebido de 99,6% da meta aparece como 99% (antes aparecia 100%, com R$ 400 ainda faltando). Se você abre o Alt+D perto da meia-noite, o dia usado na conta é o da abertura.',
      ],
    },
    {
      versao: '1.71.0', data: '02/10/2026',
      mudancas: [
        'Novo: "Meta da semana" dentro do Alt+D (Entrou na semana), logo depois do Total recuperado. Você digita a meta da semana (o valor dos dois, Isaac e Bianca) e o painel mostra quanto já foi recebido (o "Os dois" do Total recuperado), quanto falta, quantos dias úteis restam (contando hoje, sem fim de semana nem feriado) e o ritmo por dia útil para chegar lá.',
        'O ritmo se ajusta sozinho: se hoje entra menos, amanhã ele sobe. Se hoje não é dia útil, ele vale para o próximo dia útil. Batida a meta, o bloco mostra quanto passou, e sem dia útil restante mostra só o que falta.',
        'Atenção: as promessas pagas hoje só aparecem amanhã (a verificação é de madrugada), então o ritmo usa o que o painel já enxerga naquele momento. O aviso está na própria tela. Se o total não puder ser lido, a meta fica indisponível, sem número parcial.',
        'A meta é um valor só, que vale até você mudar (deixe o campo vazio e salve para apagar), e o bloco só aparece na semana atual. Fica guardada neste navegador: cada um (você e a Bianca) digita a sua. Módulo novo: o 26 (Meta Semanal).',
      ],
    },
    {
      versao: '1.70.1', data: '02/10/2026',
      mudancas: [
        'Corrigido nos lembretes de bloqueio (Alt+E): se o SmartTable não conseguisse ler uma linha da tabela de títulos, ou lesse a tabela antes de ela terminar de carregar, um cliente que já estava bloqueado recebia o aviso "Liberar do bloqueio" por engano. Agora, com leitura incompleta, ele não avalia nem grava nada e avisa por mensagem que não conseguiu ler. Cliente que quitou tudo continua recebendo o aviso de liberar normalmente.',
        'Também não avalia quando algum acordo do cliente não pôde ser lido (o título em acordo sai da conta) e não avalia nas abas de fundo que o Alt+U abre: espera a aba ficar à vista, para uma aba de fundo não regravar o que você acabou de confirmar em outra.',
        'O aviso de "Liberar" passa a citar o bloqueio em que o cliente foi inserido, mesmo que você tenha renomeado a regra depois. O aviso agora rola em tela baixa em vez de cortar os botões, e sobe para o topo se o aviso do Alerta ocupar quase a tela. Falhas de gravação (cluster, estado, regras) e erros inesperados agora aparecem por mensagem, não só no console.',
      ],
    },
    {
      versao: '1.70.0', data: '02/10/2026',
      mudancas: [
        'Novo: Alt+E abre as "Regras de lembrete". Cada regra junta um cluster (Novo ou Carteira), uma situação de título (por ora, em cartório) e o nome de um bloqueio. Exemplo: todo cliente Novo com título em cartório, ao entrar nele, o SmartTable avisa para inserir no bloqueio que você nomeou.',
        'O lembrete só AVISA: não bloqueia nada no CRM, não trava o Alt+A nem o Alt+S. "Em cartório" é a mesma situação que o relatório pinta de amarelo, e vale qualquer título do cliente nessa situação.',
        'O aviso tem "Já bloqueei" e "Lembrar depois". Quando o cliente deixa de cair na regra (o título saiu do cartório, por exemplo), vem o aviso inverso, "Liberar do bloqueio", com "Já liberei". Se ele voltar a cair na regra depois de liberado, o aviso de bloquear volta. O aviso aparece só quando você ENTRA no cliente.',
        'O cluster do cliente só aparece na lista de clientes, não na página dele. Por isso, a cada vez que a lista abre, o SmartTable guarda o cluster de cada cliente neste navegador (sem nome nem CNPJ, só um código). Se a regra casa e o cluster do cliente não é conhecido ou tem mais de 7 dias, o aviso diz que não conseguiu conferir, em vez de ficar quieto: abra a lista para atualizar.',
        'Tudo fica só neste navegador (as regras, o estado de cada cliente e o cluster). Módulo novo: o 25 (Lembretes de Bloqueio). Se o Tampermonkey não carregar o Alt+E, é cache do script: atualize o SmartTable.',
      ],
    },
    {
      versao: '1.69.1', data: '01/10/2026',
      mudancas: [
        'Corrigido: os popups do SmartTable passavam POR BAIXO do menu dos atalhos do módulo do CRM (a faixa com Dashboard, Clientes, Promessas...). O painel da Carteira, por exemplo, ficava coberto pelo menu. Agora os painéis (Configurações, Recebido na semana, Carteira, Progresso da fila, Console de diagnóstico, Alertas gerais, novidades), o aviso e o painel de Observação do cliente e a tela da Promessa rápida abrem por cima dele.',
        'Os popups ficam acima do menu, do cabeçalho e dos modais comuns do CRM, mas ainda abaixo dos modais de confirmação, do aviso de grupo e da senha do CRM. Os botões fixos (a barra do Progresso na borda direita e o botão Alerta) não mudaram de camada.',
      ],
    },
    {
      versao: '1.69.0', data: '01/10/2026',
      mudancas: [
        'Mensagem de cobrança (Alt+A): cliente SCPC com algum título negativado, de qualquer dia de atraso, não recebe mais nenhuma menção ao título de último dia. Saem a frase "Em vermelho, o título no prazo final antes do SCPC" da legenda do relatório e a linha do título de último dia no texto sem imagem. A mensagem fica com o aviso do negativado e a pergunta final que segue o negativado.',
        'O título de último dia continua grifado em vermelho na imagem do relatório; só a explicação por escrito saiu. Se o cliente também tem título em cartório, a legenda continua explicando o amarelo.',
        'Antes, só valia para negativado de até 19 dias. Agora vale para qualquer negativado, e a pergunta final também segue o negativado (nos de mais de 19 dias, a mesma de quem só tem negativado). No 19º dia, sem a explicação das cores, o aviso sai por inteiro, igual ao de quem só tem negativado.',
      ],
    },
    {
      versao: '1.68.0', data: '01/10/2026',
      mudancas: [
        'Fila por prioridade (Alt+U): a faixa "Sem contato ou movimentação há 14 dias ou mais" subiu para logo depois do Cluster Novo, ACIMA de "Segundo dia". O resto da ordem não mudou. Nova ordem do topo: Cartório último dia, Cluster Novo, Sem contato ou movimentação há 14 dias ou mais, Segundo dia, Sem nenhum contato, Dia da promessa, Promessa não cumprida, Aviso final antes da suspensão, Antes do aviso final.',
        'Atenção: como vale a primeira faixa que se aplica, quem está há 14 dias ou mais sem contato ou movimentação passa na frente das faixas que ficaram abaixo dela, inclusive promessa do dia, promessa não cumprida e aviso final de suspensão. O Cartório último dia e o Cluster Novo continuam na frente.',
        'Como a numeração das faixas mudou (3 a 9), a fila e a classificação de hoje feitas antes da atualização são refeitas: aperte Shift+Alt+U para montar de novo. O painel de progresso do dia continua mostrando as faixas com os nomes e as cores de antes.',
      ],
    },
    {
      versao: '1.67.0', data: '01/10/2026',
      mudancas: [
        'Progresso da fila: cada faixa agora é clicável. O clique leva ao primeiro cliente ainda não cobrado da faixa; se todos já foram cobrados, leva ao primeiro cliente dela. Se o cliente está na fila de hoje, o "Próximo" continua a partir dele. Ao passar o mouse, a faixa ganha um fundo leve, e o texto do título diz para onde o clique vai.',
        'A referência do progresso passa a guardar o endereço de cada cliente. A referência de hoje, gravada antes desta versão, não tem esse dado: para quem já saiu da fila, o aviso pede "Usar a fila atual", que grava a referência de novo.',
      ],
    },
    {
      versao: '1.66.0', data: '30/09/2026',
      mudancas: [
        'Alt+B (busca rápida): ao apertar Enter, o SmartTable conta quantos clientes a busca acha antes de sair da página. Nenhum: a caixa continua aberta e avisa "Nenhum cliente com dívida encontrado com esses dados." (a lista do CRM só tem quem deve). Um: entra direto na página do cliente. De 2 a 5: abre uma lista no centro da tela com razão social, CNPJ, dias de atraso e valor vencido; as setas ↑ ↓ trocam o cliente, Enter abre, Esc volta ao campo e o clique num item também abre. Mais de 5: abre a lista nativa do CRM, como antes.',
        'Se a contagem não puder ser feita (o CRM não respondeu em 8 segundos, sessão expirada, resposta diferente do esperado), a busca cai na lista nativa do CRM: nunca fica pior que antes. A caixa agora fica no centro da tela, e o texto digitado não vai para o console.',
        'Organização interna: a busca rápida saiu do Módulo 4 para um módulo novo, o 24 (Busca Rápida). Se o Tampermonkey atualizar o script pela metade e ele faltar, o aviso vermelho diz qual módulo falta.',
      ],
    },
    {
      versao: '1.65.0', data: '30/09/2026',
      mudancas: [
        'Relatório (Alt+A e Alt+R): o arquivo .png não é mais baixado quando a imagem foi copiada para a área de transferência (a cópia já basta para colar no WhatsApp). O aviso passa a dizer só "Imagem copiada.".',
        'Plano B: se a cópia falhar (a aba ficou sem foco até o tempo limite, por exemplo), o arquivo ainda é baixado, para você nunca ficar sem a imagem, e o aviso fica vermelho dizendo que a imagem NÃO foi copiada e que o arquivo foi baixado no lugar. Nesse caso o Ctrl+V não cola o relatório.',
      ],
    },
    {
      versao: '1.64.0', data: '30/09/2026',
      mudancas: [
        'Organização interna, sem mudança no que você vê: o painel da Carteira (Alt+M) foi dividido em três módulos. O Módulo 14 ficou só com o desenho do painel e a carga inicial; o Módulo 22 (Carteira: Dados) guarda as regras, o escopo e o armazenamento (IndexedDB); o Módulo 23 (Carteira: Histórico) cuida da fotografia do dia, da cura, da ponte, da régua, do resultado do período, do CSV e do backup. O código foi movido como estava; os testes da Carteira e os E2E (F5, backup, restauração, duas abas) passam sem alteração.',
        'Se o Tampermonkey atualizar o script pela metade e faltar o Módulo 22 ou o 23, o Alt+M não abre pela metade: aparece um aviso vermelho dizendo qual falta e pedindo para atualizar o script.',
      ],
    },
    {
      versao: '1.63.1', data: '30/09/2026',
      mudancas: [
        'Organização interna, sem mudança no que você vê: a cópia da mensagem para a área de transferência (Win+V, imagem no Ctrl+V), o Alt+S, o envio para "números diferentes" e o aviso do clique manual em "Registrar e Enviar" saíram do Módulo 4 para um módulo novo, o 21 (Envio e Cópia). As ferramentas de DOM dos atalhos (achar botão por texto, clicar como o React espera, esperar condição em outra aba) foram para o Módulo 20. O código foi movido como estava e os testes de cópia, Alt+S e números diferentes passam sem alteração.',
        'Se o Tampermonkey atualizar o script pela metade e faltar qualquer um dos módulos novos (19, 20 ou 21), o aviso vermelho diz quais faltam e pede para atualizar o script.',
      ],
    },
    {
      versao: '1.63.0', data: '30/09/2026',
      mudancas: [
        'Organização interna, sem mudança no que você vê: o texto da mensagem do Alt+A (frases, promessa, acordo, grupo, pergunta final, variáveis) saiu do Módulo 4 para um módulo novo, o 19 (Mensagens de Cobrança). O código foi movido como estava; os testes de mensagens continuam os mesmos e passam.',
        'Se o Tampermonkey atualizar o script pela metade e o módulo de mensagens faltar, aparece um aviso vermelho na tela e no console dizendo para atualizar o script (antes, um erro solto no meio do Alt+A).',
        'Comentários enxutos em quase todos os módulos: o porquê fica no código, a história das mudanças fica no histórico do git.',
      ],
    },
    {
      versao: '1.62.1', data: '29/09/2026',
      mudancas: [
        'Registrar e Enviar: se o WhatsApp não abrir (a página recusou o telefone ou a mensagem), não aparece mais "Contato registrado" em verde. Aparece um aviso vermelho dizendo que o contato FOI registrado no CRM e a mensagem não saiu; o contato fica aberto com a mensagem na caixa e o botão fica travado, para não registrar duas vezes.',
        'Relatório (Alt+R e Alt+A): se a leitura dos acordos (aba Negociações) ainda não terminou, o relatório não é gerado e pede para tentar de novo em alguns segundos. Antes ele saía com os títulos do acordo como vencidos comuns.',
        'Relatório: o aviso depois de gerar diz o que ficou de fora: linhas da tabela com vencimento ilegível, saldos que não entraram no "Valor total" e acordos que não puderam ser lidos. Nesses casos o aviso é vermelho, não verde. A imagem do relatório não mudou.',
        'Tabela de títulos: as cores de "Último dia", "Em cartório" e "SCPC" acompanham o título certo depois de ordenar ou filtrar a tabela (antes podiam cair em outra linha).',
        'Aviso "NÃO COBRAR": se o SmartTable não conseguir conferir a tabela (por exemplo, o CRM mudou as colunas), aparece um aviso vermelho pedindo para conferir antes de cobrar. Antes o banner simplesmente não aparecia.',
        'Privacidade: os avisos do console sobre dias divergentes e linhas ignoradas não mostram mais o número do título, o vencimento nem o texto da célula.',
      ],
    },
    {
      versao: '1.62.0', data: '29/09/2026',
      mudancas: [
        'Fila do Alt+U (régua v6): cliente no último dia do SCPC que também tem um título negativado no 19º dia (a mensagem do Alt+A já fala da suspensão de hoje) sobe para a faixa 7, "Aviso final antes da suspensão". Antes ficava na 12, "SCPC — último dia". A classificação do dia feita antes desta versão é refeita no próximo Alt+U.',
        'Alt+N: se o contato do CRM abrir com outro título já marcado, o SmartTable desmarca antes de salvar (antes ele entrava na promessa). Se não conseguir desmarcar, não salva e diz qual título ficou marcado.',
        'Alt+N: o "✓ Promessa registrada" só aparece quando surge uma promessa NOVA na aba Promessas. Uma promessa antiga com a mesma data e os mesmos títulos (quebrada ou cumprida) não confirma mais o registro antes de o CRM responder.',
        'Alt+U: apertar Alt+U de novo enquanto a rodada anterior termina a comparação do modo sombra não abre mais uma segunda rodada de abas; aparece "já tem uma classificação em andamento".',
        'Progresso (Usar a fila atual): a referência trocada leva a versão da régua, e os clientes já cobrados que vinham de uma referência de outra régua vão para a faixa de mesmo nome na régua atual.',
      ],
    },
    {
      versao: '1.61.1', data: '29/09/2026',
      mudancas: [
        'Alt+A: não agradece mais a "baixa" de um título que saiu da cobrança sem ser pago. Título que entrou em acordo, virou CARTEIRA/NÃO COBRAR ou foi marcado "fora do relatório" no Alerta sumia da lista e era tratado como pago ("Recebemos a baixa do título X, obrigado!").',
        'Alt+M (Resultado): "promessas cumpridas" e o "Recuperado" agora usam o mesmo critério do Alt+D (a semana ou o mês do dia estimado do pagamento). Antes o Alt+M agrupava pela data da promessa e mostrava outro número com o mesmo nome. A taxa de cumprimento continua por promessa. Se a leitura das promessas falhar, aparece "indisponível" em vez de um total parcial.',
        'Alt+U: uma fila montada com filtro do CRM ligado não vira mais a referência do progresso do dia quando é retomada no Alt+U seguinte (antes o progresso passava a medir só os clientes do filtro até a meia-noite).',
        'Alerta (não cobrar): mudar só a observação não prorroga mais o prazo do "não cobrar" (2,1 dias restantes viravam 3). Se o navegador recusar a gravação, o painel continua aberto e avisa, em vez de fechar como se tivesse salvo.',
        'Alt+D: se o CRM devolver menos promessas por página do que o pedido, as outras páginas continuam sendo lidas (antes a soma podia ficar menor, sem aviso).',
        'Mensagem do Alt+A: quando o cálculo do contexto falha, ela se apresenta com o nome de quem está logado, e não com o nome fixo da configuração.',
        'Privacidade: o log "[Contexto Adicional] Calculado" do console mostra só tipos, sim/não e contagens (antes, com promessa ativa, mostrava os números dos títulos e a data prometida). O Alt+L tinha três versões com a data de amanhã; corrigido.',
      ],
    },
    {
      versao: '1.61.0', data: '29/09/2026',
      mudancas: [
        'Alt+D: as promessas cumpridas agora contam pela semana em que o cliente PAGOU, e não pela semana da verificação. O CRM não guarda o dia do pagamento; a verificação é automática, de madrugada, no dia útil seguinte, então o dia do pagamento é estimado como o dia útil ANTERIOR à verificação (fim de semana e feriado pulados). Paga na sexta e verificada na segunda conta na semana da sexta.',
        'Alt+D: novo botão "◀ semana anterior" (e "semana atual ▶" para voltar). Na semana anterior o painel mostra os mesmos blocos daquela semana; o bloco "Promessas feitas hoje" só aparece na semana atual. O Alt+D sempre abre na semana atual. Na segunda de manhã o total da semana atual é menor do que era antes desta versão, porque o que foi pago na sexta agora pertence à semana passada.',
        'Alt+D: o texto do bloco de promessas passou a dizer como o pagamento é estimado ("dia útil anterior à verificação"). Pagamento de sábado ou domingo (raro) é contado como de sexta.',
      ],
    },
    {
      versao: '1.60.0', data: '29/09/2026',
      mudancas: [
        'Alt+D: novo bloco "Promessas feitas hoje", depois do Total recuperado: quantas promessas foram criadas hoje (de qualquer status e para qualquer data prometida) e o valor prometido, por pessoa e nos dois. É valor prometido, pode incluir juros e multa, e NÃO entra no Total recuperado.',
        'Alt+D: a busca de promessas agora olha também até 90 dias depois da sexta. Uma promessa agendada para a semana que vem e verificada (paga) esta semana passa a entrar na soma desta semana; antes ela nem era lida.',
      ],
    },
    {
      versao: '1.59.1', data: '29/09/2026',
      mudancas: [
        'Alt+D (Entrou na semana): "Promessas cumpridas" agora conta pela semana em que a promessa foi VERIFICADA (o CRM não guarda o dia do pagamento; o pagamento consta no sistema no dia útil seguinte) e não mais pela semana em que foi criada. Uma promessa criada na semana passada e verificada esta semana entra nesta semana. Entram as cumpridas, as cumpridas parciais e as parciais (o valor efetivamente pago), no nome de quem CRIOU a promessa.',
        'Alt+D: o valor vem da lista de promessas do CRM (a mesma da tela Promessas). Se essa leitura falhar, o painel diz o erro no lugar do número e não mostra o Total recuperado (antes ele mostraria um total incompleto). Os depósitos continuam como estavam.',
      ],
    },
    {
      versao: '1.59.0', data: '29/09/2026',
      mudancas: [
        'Alt+N (promessa rápida): a tela agora abre no CENTRO, com o fundo escurecido abaixo do cabeçalho do CRM, e ficou mais clara: uma linha por título com o código, os dias de atraso, a situação (Cobrança, Último dia, Em cartório, Negativado ou Não protestar) e o valor sem quebrar de linha; o nome do cliente no topo; as teclas H, A, D, T, Enter e Esc aparecem como teclas; e o rodapé mostra o total marcado (valor em aberto, sem juros e multa: o CRM calcula o valor final ao salvar).',
        'Alt+N: cada título mostra em que dia vai a cartório ("cartório: não checado" quando o sistema não lê o título), e os botões de data que já cairiam em cartório ficam marcados em vermelho. Clique fora da janela, X, Esc e Cancelar fecham. O Tab não sai mais da janela e, se o foco for parar na página, as teclas 1, A e Enter continuam funcionando. A sequência Alt+N, 1, A, Enter não mudou.',
      ],
    },
    {
      versao: '1.58.0', data: '29/09/2026',
      mudancas: [
        'Alt+N (promessa rápida): não deixa mais registrar promessa para um título que, na data escolhida, já estará em cartório (a partir do dia seguinte ao último dia para pagamento) nem para título que já está em cartório. Aparece um aviso em vermelho no painel, dizendo o dia do cartório e até quando escolher ("Título 90001/1 estará em cartório em 01/10/2026; escolha até 30/09/2026."), e o botão de registrar fica travado até você trocar a data ou desmarcar o título.',
        'A regra não vale para cliente SCPC nem para título com posição "NAO PROTESTAR". Ela só cobre o painel do Alt+N: o campo de data do próprio CRM e os botões "Agendar pagamento" do Registrar e Enviar não foram alterados.',
      ],
    },
    {
      versao: '1.57.0', data: '29/09/2026',
      mudancas: [
        'Título com posição "NAO PROTESTAR" agora é cobrado: a partir do 6º dia de atraso (sem SCPC) ele vira "Vencido", em vez de "em cartório". Antes, no Itaú, o cliente com só títulos "não protestar" era tratado como "tudo em cartório" e sumia da fila do Alt+U e do Alt+A.',
        'Alt+A para esses títulos: a mensagem não fala de cartório, prazo final nem encaminhamento; é a mensagem de um título vencido comum ("Segue o relatório atualizado...", ou "O título vencido em 10/09 está em aberto." quando o relatório é omitido) com a pergunta "Consegue regularizar hoje?" e afins. No relatório a linha aparece como "Vencido", com a cor do atraso comum.',
        'Fila do Alt+U: esses clientes seguem a régua normal (sem contato há 14 dias ou mais vai para a 9; sem outra regra, "Demais dias"). Quem passa de 19 dias de atraso continua fora da lista, como antes. Com SCPC nada muda.',
      ],
    },
    {
      versao: '1.56.0', data: '29/09/2026',
      mudancas: [
        'Régua do Alt+U (v5): "Sem contato ou movimentação" passou de mais de um mês para 14 dias ou mais (vale para o último contato de qualquer pessoa e para a última movimentação da conta). A Carteira continua com o limite dela, de 30 dias.',
        'Régua do Alt+U (v5): o atraso inicial (3º e 4º dia) agora vem ANTES dos dois SCPC, que ficaram logo abaixo dele: faixa 10 atraso inicial, 11 SCPC antes do aviso de suspensão, 12 SCPC último dia. As faixas 13 a 15 não mudaram e as cores acompanham o nome de cada faixa. A fila e a classificação de hoje montadas com a régua anterior são descartadas: use Shift+Alt+U para refazer.',
      ],
    },
    {
      versao: '1.55.0', data: '29/09/2026',
      mudancas: [
        'Alt+A: cliente SCPC com um título no último dia para pagar e outro negativado (até o 19º dia de atraso) agora tem a pergunta final e a ordem da legenda seguindo o título negativado: o aviso do SCPC vem antes da frase do vermelho, e a pergunta pede a regularização hoje conforme o dia da suspensão. A frase do vermelho continua na mensagem. Acima do 19º dia nada muda. A fila do Alt+U e a nota do CRM não mudam.',
      ],
    },
    {
      versao: '1.54.2', data: '29/09/2026',
      mudancas: [
        'Alt+K: nova seção "Ritmo do operador" com os três diagnósticos (Qualidade do diário, Ritmo e Fila defasada). Cada botão mostra uma linha de leitura e o resultado em números, com o botão "Copiar (só números)" para colar no chat. Antes, só existiam como comandos no console do navegador.',
      ],
    },
    {
      versao: '1.54.1', data: '28/09/2026',
      mudancas: [
        'Alt+S e Alt+A: se você apertar Alt+A de novo e Alt+S em seguida enquanto a cópia anterior ainda termina, o fim da espera antiga não derruba mais a espera nova (antes, um terceiro Alt+S podia registrar o contato em dobro).',
        'A imagem do Ctrl+V só é deixada se o último relatório gerado na página for o do cliente da tela. Se não for (por exemplo, você gerou o relatório de outro cliente e voltou), aparece o aviso para colar pelo Win+V.',
        'Alt+D/Alt+K (autoconferência): uma fila montada com a régua anterior deixa de acusar erro de desempate falso e mostra um aviso pedindo o Shift+Alt+U.',
        'Diagnósticos de ritmo: um dia só conta como válido com 30 contatos de clientes da fila; o filtro de privacidade rejeita números enormes; avisos de leitura do diário mostram só o nome do erro; contagens de outros negociadores saem em faixas; filaDefasada avisa quando o formato do CNPJ na fila e na lista parece diferente.',
      ],
    },
    {
      versao: '1.54.0', data: '28/09/2026',
      mudancas: [
        'Diagnósticos do ritmo de cobrança (console, só números, prontos para colar): window.__diag.qualidade() diz se o diário é confiável, window.__diag.ritmo() mostra cobertura da fila (por terço), intervalos entre contatos, pausas e horários, e window.__diag.filaDefasada() (na página da lista) conta quem saiu da lista de vencidos. Não muda nada no seu fluxo.',
      ],
    },
    {
      versao: '1.53.0', data: '28/09/2026',
      mudancas: [
        'Régua do Alt+U: "SCPC antes do aviso de suspensão" passou a vir ANTES de "SCPC — último dia" (nova faixa 10; o último dia SCPC é a 11, e as faixas 12 a 14 seguem: atraso inicial, cartório e outro vencido, 5º dia).',
        'Por isso, um cliente SCPC com menos de 16 dias que também tem título em cartório agora entra na faixa 10 (antes ia para "Título em cartório e outro vencido").',
        'A numeração das faixas mudou: a fila e a classificação de hoje são refeitas no próximo Alt+U (leva alguns minutos). As cores das faixas seguiram o nome de cada uma.',
      ],
    },
    {
      versao: '1.52.0', data: '28/09/2026',
      mudancas: [
        'Relatório no cliente certo: ao apertar Alt+S, a imagem do relatório DESTE cliente fica como último item copiado. No WhatsApp, cole a imagem com Ctrl+V, sem procurar no Win+V (onde ficam as imagens dos clientes anteriores). A legenda e a pergunta continuam pelo Win+V.',
        'Se a imagem não ficar no Ctrl+V (aba sem foco ou falha na cópia), aparece o aviso "A imagem não ficou no Ctrl+V -- no WhatsApp, cole a imagem pelo Win+V." e o envio segue.',
      ],
    },
    {
      versao: '1.51.0', data: '28/09/2026',
      mudancas: [
        'Alt+A no primeiro dia útil depois de fim de semana ou feriado: se o título mais atrasado do cliente está no 2º, 3º ou 4º dia, a frase final ganha "Caso já tenha pago no fim de semana, por gentileza nos encaminhar o comprovante para sinalizar em nosso sistema." (ou "no feriado", ou "no fim de semana ou no feriado", conforme o caso).',
        'Não entra quando a promessa de pagamento é para hoje: a frase final dela já pede o comprovante.',
      ],
    },
    {
      versao: '1.50.1', data: '28/09/2026',
      mudancas: [
        'Ajuda (Alt+H): a linha do Alt+S explica que, logo depois do Alt+A, ele espera a cópia para a área de transferência e envia sozinho, e que não envia se a cópia falhar.',
      ],
    },
    {
      versao: '1.50.0', data: '28/09/2026',
      mudancas: [
        'Grupo de controle removido: a fila do Alt+U sai sempre na ordem da régua. O mecanismo (1 em cada 5 clientes com posição sorteada) estava desligado e saiu do código.',
        'Diário (Alt+D): o relatório deixa de mostrar a comparação régua x controle. Os registros antigos continuam contando na tabela por faixa.',
      ],
    },
    {
      versao: '1.49.2', data: '28/09/2026',
      mudancas: [
        'Diário (Alt+D): a autoconferência da fila usa a ordem da régua nova. Antes, ela acusava como erro uma fila correta (faixa 14 por dias de atraso, empate decidido pelo valor vencido).',
      ],
    },
    {
      versao: '1.49.1', data: '28/09/2026',
      mudancas: [
        'Alt+S que esperou a cópia: só envia sozinho enquanto o navegador ainda permite abrir o WhatsApp. Se a espera passou disso (por exemplo, você foi para outra janela), aparece "Cópia confirmada. Aperte Alt+S para enviar." em vez de registrar o contato sem abrir a conversa.',
        'Privacidade: a informação da cópia exposta para diagnóstico não guarda mais CNPJ nem o texto da mensagem.',
      ],
    },
    {
      versao: '1.49.0', data: '28/09/2026',
      mudancas: [
        'Alt+A: cada parte da mensagem e a imagem do relatório têm até 3 tentativas de ir para a área de transferência, e só contam como copiadas quando o navegador confirma.',
        'Alt+S apertado enquanto a cópia ainda está em andamento: espera, mostra "Aguardando o relatório ir para a área de transferência (k de N)" e envia sozinho quando tudo foi confirmado. Antes, ele cancelava o que faltava copiar, inclusive a imagem.',
        'Se a cópia falhar nas 3 tentativas, o Alt+S não envia e aparece o aviso "Relatório não foi para a área de transferência", com o botão "Copiar de novo".',
      ],
    },
    {
      versao: '1.48.1', data: '28/09/2026',
      mudancas: [
        'Progresso da fila: as faixas voltam a aparecer coloridas no dia da troca da régua. Na 1.48.0, a fila montada antes da atualização aparecia toda em cinza.',
        'Cores das faixas refeitas por critério: nenhuma cor repetida (Cartório e SCPC no último dia agora se diferenciam), contraste mínimo de acessibilidade em todas e distinção mantida para quem tem daltonismo vermelho-verde.',
      ],
    },
    {
      versao: '1.48.0', data: '28/09/2026',
      mudancas: [
        'Alt+U, régua de prioridade com 15 faixas: o antigo "Demais dias" foi separado em 12 Título em cartório e outro vencido, 13 5º dia de atraso, 14 SCPC antes do aviso de suspensão (quem está mais perto do 16º dia primeiro) e 15 Demais dias.',
        'Dentro de cada faixa, com o mesmo último contato, o cliente com maior valor vencido vem primeiro.',
        'A classificação do dia feita antes da atualização é refeita automaticamente no próximo Alt+U, para não misturar a numeração antiga com a nova.',
      ],
    },
    {
      versao: '1.47.1', data: '28/09/2026',
      mudancas: [
        'Alt+U, prioridade "Segundo dia": só entra quem tem o título mais atrasado no 2º dia. Antes, um cliente com título de 2 dias e outro já em cartório entrava nessa faixa. A fila do dia já montada só muda depois de um Shift+Alt+U.',
      ],
    },
    {
      versao: '1.47.0', data: '28/09/2026',
      mudancas: [
        'Painel "⚠ Alerta" do cliente: nova seção "Títulos em cartório fora do relatório", com uma caixinha por título em cartório. Marcado e confirmado, o título sai do relatório, da mensagem do Alt+A, da nota do Alt+S e da fila do Alt+U. Se todos os títulos que sobraram estiverem marcados, o Alt+S também não envia para os números das outras razões do grupo.',
        'A marcação fica salva neste computador até o título constar como pago no CRM -- aí ela some sozinha ao abrir a página do cliente. Se o título só sair da lista de abertos e voltar depois, continua marcado.',
      ],
    },
    {
      versao: '1.46.4', data: '28/09/2026',
      mudancas: [
        'Alt+A: no primeiro contato seu com um cliente que outro negociador já contatou, sem título novo desde então, a mensagem passa a levar o relatório. Antes saía só "Sou Isaac, do financeiro..." e a pergunta, sem dizer de qual débito se tratava. O recontato de um cliente que você mesmo já contatou continua sem relatório, como antes.',
      ],
    },
    {
      versao: '1.46.3', data: '25/09/2026',
      mudancas: [
        'Painel Alt+K: nome, CNPJ e número de título também ficam escondidos quando aparecem dentro de um aviso detalhado (antes só o CNPJ e o telefone escritos por extenso eram escondidos).',
        'O apelido de um cliente (cli.xxxx) passa a ser o mesmo com ou sem a pontuação do CNPJ, então dá pra acompanhar o mesmo cliente de um aviso para outro.',
      ],
    },
    {
      versao: '1.46.2', data: '25/09/2026',
      mudancas: [
        'Privacidade: os avisos que o SmartTable escreve no console não trazem mais nome de cliente, CNPJ, número de título nem saldo -- no lugar aparece um apelido (cli.xxxx). Vale também para o relatório do modo sombra do Alt+U. (Dois avisos do cálculo de títulos ainda mostram o número do título no console do navegador; o painel Alt+K já esconde, ver 1.46.3.)',
      ],
    },
    {
      versao: '1.46.1', data: '25/09/2026',
      mudancas: [
        'O SmartTable passa a ser baixado de um endereço novo (repositório SmartTable-publico, só com os módulos). A troca é automática nesta atualização: nada muda no uso.',
      ],
    },
    {
      versao: '1.46.0', data: '25/09/2026',
      mudancas: [
        'Alt+U, modo sombra: a comparação com a página baixada roda uma vez por dia (a primeira classificação do dia). Os Alt+U seguintes não baixam as páginas de novo, e o histórico guarda um resultado por dia.',
        'Lista de clientes: se o SmartTable não conseguir conferir os filtros da lista, ele age como se ela estivesse filtrada -- a fila é montada, mas não vira a classificação do dia, o progresso nem a fotografia da Carteira.',
        'Segurança: a biblioteca que desenha a imagem do relatório (Alt+R/Alt+A) só roda se for exatamente a versão conferida; o canal estável também confere cada módulo antes de carregar. Removida uma cópia antiga do componente de tabela que o SmartTable carregava sem usar.',
      ],
    },
    {
      versao: '1.45.0', data: '25/09/2026',
      mudancas: [
        'Alt+U, modo sombra (primeiro passo para classificar sem abrir abas): na classificação do dia, além das abas de sempre, o SmartTable baixa a página de cada cliente em segundo plano -- sem abrir aba nem pop-up -- e classifica também por ela. No fim aparece "Modo sombra: N clientes comparados, nenhuma diferença" (ou quantas houve). A fila continua vindo das abas, como sempre; a troca só acontece depois de dias seguidos sem diferença.',
      ],
    },
    {
      versao: '1.44.0', data: '25/09/2026',
      mudancas: [
        'Carteira (Alt+M): novo botão "Tirar nova fotografia de hoje", no bloco "Saúde do histórico". Substitui a fotografia de hoje pela lista atual (depois de confirmar), mesmo que ela tenha menos clientes -- pra quando a primeira saiu errada. Só funciona na lista de clientes, sem filtro, e o painel mostra quando a fotografia foi refeita.',
        'Progresso da fila: novo botão "Usar a fila atual". O progresso conta a PRIMEIRA fila do dia; se ela saiu errada (lista filtrada, por exemplo), o botão troca pela fila por prioridade que está valendo agora, sem perder quem você já cobrou.',
        'Alt+U com a lista filtrada (Dias de atraso, Buscar, SCPC...): a fila é montada só com os clientes do filtro, mas não vira mais a classificação do dia nem a referência do progresso -- antes, os próximos Alt+U, já sem filtro, reaproveitavam essa classificação parcial.',
      ],
    },
    {
      versao: '1.43.0', data: '25/09/2026',
      mudancas: [
        'Carteira (Alt+M): a fotografia do dia só é tirada da lista COMPLETA da sua carteira. Com qualquer filtro do CRM ligado (o novo "Dias de atraso", Buscar, SCPC, Apenas novos, Bloqueio 97, Com fiador, ou o negociador de outra pessoa), ela não é tirada -- antes, a lista filtrada era gravada como se fosse a carteira inteira, e quem ficou de fora do filtro contava como quitado.',
        'Enquanto o dia não tiver fotografia, abrir a lista filtrada mostra um aviso dizendo qual filtro está ligado, e o painel do Alt+M também avisa. Abrindo a lista sem filtro uma vez, a fotografia sai normalmente e os avisos somem.',
      ],
    },
    {
      versao: '1.42.0', data: '25/09/2026',
      mudancas: [
        'Novo: Alt+N registra uma promessa de pagamento sem passar pelo modal na mão. Na página do cliente, aparece a lista dos títulos vencidos, numerados: aperte 1 a 9 pra marcar os que o cliente prometeu (se ele tem um só vencido, já vem marcado), escolha a data (H hoje, A amanhã, D outra) e Enter. O SmartTable abre o contato do CRM, escolhe "Promessa de Pagamento", marca os mesmos títulos, põe a data e a observação "Cliente agendou o pagamento." e clica em Salvar Contato -- o CRM continua calculando juros e multa.',
        'Depois de salvar, ele confere se a promessa apareceu na aba Promessas com a data e os títulos: aviso verde se apareceu, vermelho se não (ou se o CRM disser "Promessa não criada").',
        'Onde o CRM pede decisão, o Alt+N para e deixa o contato aberto pra você: título que já está em outra promessa, títulos de mais de uma razão do grupo (uma promessa por razão) e qualquer "Confirmar ação". Ele nunca encerra uma promessa anterior sozinho.',
      ],
    },
    {
      versao: '1.41.4', data: '25/09/2026',
      mudancas: [
        'Acordos, mensagem mais curta: quando o cliente tem títulos fora e dentro de acordo, a frase do acordo ficou menor e vem num balão só. "O acordo segue em dia: próxima parcela de R$ X em dd/mm." / "A parcela N do acordo (R$ X) venceu em dd/mm." / "O acordo feito em dd/mm não foi cumprido, e os títulos voltaram para a cobrança." Com isso, nenhuma mensagem passa de 5 balões.',
      ],
    },
    {
      versao: '1.41.3', data: '24/09/2026',
      mudancas: [
        'Win+V na ordem em que o cliente recebe: com frase de contexto (promessa, contato recente, acordo), a imagem do relatório aparecia ANTES dela no Win+V. Agora, de cima pra baixo: a frase de contexto, a imagem, a legenda ("Segue o relatório...") e a pergunta final. A imagem não fica mais como o último item copiado -- ela fica no lugar dela na lista.',
        'Com "Números diferentes" marcado, clicar em "Registrar e Enviar" com o mouse manda só pro número do cliente. Agora aparece um aviso dizendo que os outros números não foram abertos (inclusive depois que a página recarrega). Pra enviar pra todos, continue usando o Alt+S.',
        'Acordo não cumprido: a frase agora diz "Como o acordo feito em dd/mm não foi cumprido..." (antes, "firmado"). O CRM não informa a data do aceite, só a de criação do acordo.',
      ],
    },
    {
      versao: '1.41.2', data: '24/09/2026',
      mudancas: [
        'Acordos: parcela paga voltou a ser reconhecida como paga (o CRM manda "PAGO"). Na 1.41.1, cliente com parcela de acordo já paga mostrava um aviso de "situação que não conheço" e o Alt+A perguntava se queria seguir sem motivo.',
      ],
    },
    {
      versao: '1.41.1', data: '24/09/2026',
      mudancas: [
        'Acordos: a frase "o acordo não foi cumprido, os títulos voltaram para a cobrança" só aparece quando os títulos desse acordo estão sendo cobrados agora. Antes, qualquer acordo quebrado do histórico (até um antigo, já pago) fazia a frase aparecer.',
        'Renegociação (título num acordo quebrado e num acordo novo): o selo mostra o acordo que vale ("🤝 Acordo #N · ativa") e a mensagem não diz mais que o título voltou pra cobrança.',
        'Parcela do acordo com vencimento no passado é tratada como atrasada mesmo que o CRM ainda não a marque como vencida -- a mensagem nunca mais pergunta "posso contar com o pagamento na data?" sobre uma data que já passou.',
        'Se algum acordo não pôde ser lido (ou tem parcela numa situação que o SmartTable não conhece), o Alt+A agora pergunta se você quer seguir mesmo assim, em vez de só um aviso na abertura da página.',
      ],
    },
    {
      versao: '1.41.0', data: '24/09/2026',
      mudancas: [
        'Títulos negociados: o SmartTable lê a aba Negociações do cliente. Título de acordo ativo ou quitado (aguardando a baixa) ganha o selo "🤝 Acordo #N" na tabela e sai do relatório e da mensagem de cobrança. Acordo em proposta (ainda não aceito) não muda nada: cobrança normal.',
        'Tudo em acordo ativo: o Alt+A não gera relatório; a mensagem só lembra a parcela do acordo (valor e vencimento) ou, se ela venceu, pede a regularização. A nota do CRM diz qual parcela de qual acordo. Tudo em acordo quitado: nada a cobrar, só um aviso na tela.',
        'Cliente com títulos dentro e fora de acordo: relatório e cobrança normais só dos de fora, mais uma linha sobre o acordo em andamento. Acordo não cumprido (inadimplente): os títulos voltam para a cobrança, com o selo "⚠ Acordo #N · inadimplente" e uma linha avisando que o acordo não foi cumprido.',
        'Fila por prioridade (Alt+U): cliente com tudo em acordo e parcelas em dia fica fora da fila; com parcela do acordo atrasada, entra na faixa 6 (a de promessa não cumprida). Se a leitura de um acordo falhar, aparece um aviso pedindo pra conferir a aba Negociações antes de cobrar.',
      ],
    },
    {
      versao: '1.40.0', data: '24/09/2026',
      mudancas: [
        'Novo: "🔔 Alertas gerais", na lista de clientes (ao lado de "Iniciar Fila"). Lembretes seus, sem cliente: descrição, data e Confirmar. Dá pra acumular vários (um pra quarta, outro pra segunda); aparecem em cards, do mais próximo pro mais distante, cada um com um X pra excluir.',
        'No dia do alerta, ao abrir a lista de clientes aparece um aviso com a descrição (e o botão mostra "· N hoje"). No dia seguinte o alerta some sozinho. O "⚠ Alerta" da tela do cliente continua como estava.',
      ],
    },
    {
      versao: '1.39.0', data: '23/09/2026',
      mudancas: [
        'Fila por prioridade (Alt+U): a faixa 9 virou "Sem contato ou movimentação há mais de um mês". Antes só contava a última movimentação da conta, e um cliente sem contato havia mais de um mês caía em "Demais dias" (12) se a conta tivesse qualquer movimentação recente. Agora entra na 9 se o último contato (de qualquer pessoa) OU a última movimentação passar de 30 dias. A ordem das faixas não mudou; vale a partir do próximo Shift+Alt+U (a fila de hoje já montada continua como está).',
      ],
    },
    {
      versao: '1.38.0', data: '23/09/2026',
      mudancas: [
        'Avisos não ficam mais um em cima do outro: todos os avisos do SmartTable saem numa pilha no canto inferior direito (o mais novo embaixo, no máximo 3), acima do aviso verde do relatório -- inclusive o progresso e os avisos do Alt+U.',
        'Painéis (Alt+M, Alt+D, Alt+O, Alt+K, Alt+L, Alt+H e o do Alerta) abrem à direita do menu lateral do CRM, em vez de por baixo dele. Recolher ou expandir o menu com um painel aberto faz o painel acompanhar na hora.',
        'O selo "SmartTable vX ✓" aparece abaixo do cabeçalho do CRM e fora do menu, em vez de por cima dos dois.',
      ],
    },
    {
      versao: '1.37.1', data: '23/09/2026',
      mudancas: [
        'Corrigido: o aviso depois do Alt+A mandava colar a imagem com Ctrl+V. Depois do Alt+S, o Ctrl+V cola o texto da primeira parte (é a segurança para o WhatsApp que abre sem texto). A imagem e a legenda ("Segue o relatório...") são coladas pelo Win+V -- o aviso agora diz isso.',
      ],
    },
    {
      versao: '1.37.0', data: '23/09/2026',
      mudancas: [
        'Mensagens do Alt+A mais curtas: antes chegavam a 7 balões e 814 caracteres; agora no máximo 4 balões e 600 caracteres, em qualquer combinação de situação (um teste confere todas).',
        'O "Segue o relatório..." virou a LEGENDA da imagem, e a situação dos títulos entra nela, resumida: uma frase só para as cores (vermelho e amarelo) e o aviso SCPC numa linha própria. No WhatsApp: a imagem e, na tela de prévia, a legenda, as duas pelo Win+V.',
        'A saudação vai no mesmo balão da primeira frase; a promessa parcial diz só quantos títulos faltam (os números já estão no relatório); "Segue o relatório atualizado da razão social X."; quando o 19º dia do SCPC se soma a outras situações, o aviso vai na versão curta.',
      ],
    },
    {
      versao: '1.36.1', data: '23/09/2026',
      mudancas: [
        'Mensagem do Alt+A no SCPC (regra de negócio nova): depois do 19º dia o cadastro continua sendo suspenso, mas o cancelamento dos faturamentos é só uma possibilidade. Do 16º ao 18º dia a frase passa a ser "após o 19º dia de atraso, o cadastro é suspenso e os faturamentos podem ser cancelados" (antes dizia que os pedidos deixavam de ser faturados). No 19º dia, a frase do último dia ganha "Após essa data, os faturamentos podem ser cancelados."',
      ],
    },
    {
      versao: '1.36.0', data: '23/09/2026',
      mudancas: [
        'Novo: "Números diferentes", ao lado do aviso "CNPJ do grupo vencido" na página do cliente. Marque quando outra razão do grupo atende num WhatsApp diferente e informe o número de cada uma (com DDD). Os números ficam salvos pra esse cliente até você desmarcar ou remover.',
        'Com números informados, o Alt+S passa a enviar em sequência: o 1º Alt+S registra o contato e abre o WhatsApp do cliente (como sempre); cada Alt+S seguinte abre o próximo número, na ordem em que você inseriu, sem registrar de novo. Um contato registrado só, no 1º envio. A página mostra qual é o próximo, com opção de cancelar os restantes.',
        'Cliente com NÃO COBRAR / CARTEIRA (ou "Não cobrar" no Alerta) não recebe nenhum envio. Sem números, ou desmarcado, o Alt+S funciona exatamente como antes.',
      ],
    },
    {
      versao: '1.35.0', data: '23/09/2026',
      mudancas: [
        'Lembrete de backup da Carteira: o histórico mora só neste navegador (limpar os dados do site ou trocar de computador leva tudo junto). Se passar 7 dias sem baixar um backup, aparece um aviso ao abrir a lista de clientes (no máximo uma vez por dia), e o painel do Alt+M mostra, em "Saúde do histórico", quando foi o último backup e pede um novo. Baixar o backup ("Baixar backup", no rodapé do painel) zera o lembrete.',
      ],
    },
    {
      versao: '1.34.1', data: '23/09/2026',
      mudancas: [
        'Sem mudança visual: o painel da Carteira (Alt+M) e os avisos que aparecem no canto da tela passam a ser anunciados corretamente por leitores de tela (painel, abas e avisos identificados como tal). Isso também permitiu testar o painel num navegador de verdade, clicando como um usuário clicaria.',
      ],
    },
    {
      versao: '1.34.0', data: '23/09/2026',
      mudancas: [
        'Carteira (Alt+M): a fotografia do dia agora grava os dados da lista EXATAMENTE como o CRM mandou, e todos os números do painel são calculados na hora de abrir. Mudar uma regra (escopo, faixas) ou corrigir um erro de conta passa a valer pra todo o histórico, sem precisar apagar nenhuma fotografia.',
        'Nenhum erro passa em silêncio: se a gravação da fotografia falhar, aparece um aviso na tela e o motivo fica no painel ("Saúde do histórico"). Dado estranho na lista (campo que sumiu ou mudou de nome, número vindo como texto, CNPJ repetido, cliente sem vencido) não impede a gravação do dia: vira um alerta visível. Dias úteis sem fotografia aparecem como lacuna.',
        'Corrigido: um único cliente com dias de atraso fracionados fazia a fotografia do dia inteiro não ser gravada; valores vindos como texto ("1.234,56") eram contados como zero; abrir o painel duas vezes seguidas empilhava dois painéis; erro ao ler o histórico aparecia como "ainda não há fotografia".',
        'Novos botões "Baixar backup" e "Restaurar backup" no rodapé do painel: guardam e trazem de volta o histórico inteiro. Restaurar nunca apaga nada e nunca troca um dia por uma versão menos completa.',
      ],
    },
    {
      versao: '1.33.1', data: '23/09/2026',
      mudancas: [
        'Carteira (Alt+M): a lista de clientes só mostra quem está devendo, então cliente que SOME da lista quitou. Na cura e na ponte, ele agora conta como "quitaram" (antes caía numa coluna "saíram", que deixava a taxa de cura perto de zero).',
        'Corrigido: na aba Régua, quem pagou tudo e sumiu da lista contava como "não pagou". Agora conta como pagou.',
        'O cartão "% da carteira em cobrança" virou "% da dívida em cobrança": a soma é do que os clientes EM ATRASO devem (quem está em dia não aparece na lista), e o cartão diz isso.',
      ],
    },
    {
      versao: '1.33.0', data: '23/09/2026',
      mudancas: [
        'Painel da Carteira (Alt+M) agora tem quatro abas: Hoje, Evolução, Resultado e Régua.',
        'Evolução: a PONTE da carteira explica por que o vencido mudou na semana (quanto entrou na cobrança, quanto pagou, quanto foi pro analista, pagamentos parciais) e fecha centavo a centavo. A cura passa a ficar gravada todo dia, com a janela real em dias, e aparece semana a semana (também no CSV).',
        'Resultado: previsão de entrada das promessas para 7 e 30 dias, usando a sua taxa real de cumprimento (por valor) dos últimos 90 dias. Promessas com data já passada ficam fora da previsão.',
        'Régua: cruza a faixa do Alt+U e a hora do primeiro contato com quem pagou em até 7 dias, separando contatados de não contatados.',
        'A fotografia do dia passa a ser a da ABERTURA (a primeira leitura completa da lista), pra comparar sempre o mesmo momento. Vencido com dia 0 saiu do painel (vai para "Fora do painel", junto com o 1º dia).',
        'O histórico da Carteira saiu do armazenamento que a fila do Alt+U usa e foi para um banco próprio do navegador (IndexedDB), com espaço pra 1 ano. Passa a guardar também os dados pra um score de pagamento no futuro (score do CRM, atraso médio, último pagamento, caução/fiador), sem CNPJ nem nome. O histórico que já existia é trazido automaticamente.',
      ],
    },
    {
      versao: '1.32.0', data: '23/09/2026',
      mudancas: [
        'Painel da Carteira (Alt+M) agora mede só o vencido que está com a cobrança: do 2º ao 20º dia de atraso. O 1º dia e quem já passou do 20º (com o analista) saíram do aging e de todos os indicadores (vencido, SCPC, cobertura, promessas, concentração) e aparecem numa linha à parte, "Fora do painel", pra que as contas continuem fechando com o CRM.',
        'Aging com as faixas 2º dia, 3–5, 6–15, 16–19 e 20º dia. A cura ganhou a coluna "Analista": dos clientes que estavam em cobrança na semana passada, quantos passaram do 20º dia sem pagar.',
        'O histórico gravado pela versão anterior (com a definição antiga) é apagado, pra tendência e setas não darem um salto falso. A primeira fotografia nova sai na próxima vez que a lista abrir.',
      ],
    },
    {
      versao: '1.31.1', data: '23/09/2026',
      mudancas: [
        'Painel da Carteira (Alt+M) ocupa menos espaço no navegador (um ano de histórico caiu de ~690 KB pra ~530 KB) e tem um teto: se passar dele, o detalhe mais antigo por cliente sai primeiro. O espaço é dividido com a fila do Alt+U, que assim nunca fica sem lugar pra gravar por causa do painel.',
      ],
    },
    {
      versao: '1.31.0', data: '23/09/2026',
      mudancas: [
        'Novo: Alt+M abre o painel da Carteira -- quanto está vencido (e que % da carteira isso é), quanto está no SCPC, promessas pendentes, cobertura (quem teve movimentação nos últimos 7 dias), concentração nos 10 maiores devedores e o aging do vencido por faixa de dias, com setas comparando com a semana passada.',
        'A fotografia da carteira é tirada sozinha uma vez por dia, quando a lista de clientes abre, e fica guardada neste navegador (sem CNPJ nem nome -- só números). Com 7 dias de histórico o painel passa a mostrar a CURA: dos clientes que estavam vencidos na semana passada, quantos pagaram, por faixa de atraso.',
        'O painel também traz o resultado da semana e do mês pela API do CRM (a mesma do Alt+D): recuperado, promessas feitas, taxa de cumprimento por valor, promessas quebradas, acordos e clientes contatados. Botão "Exportar CSV" baixa o histórico diário pra abrir no Excel ou Power BI.',
      ],
    },
    {
      versao: '1.30.0', data: '23/09/2026',
      mudancas: [
        'Régua de prioridade do Alt+U reorganizada (12 faixas): 1 Cartório último dia, 2 Cluster Novo, 3 Segundo dia, 4 Sem nenhum contato (NOVA -- cliente que ninguém nunca contatou), 5 Dia da promessa, 6 Promessa não cumprida, 7 Aviso final antes da suspensão (dia 19), 8 Antes do aviso final (NOVA -- SCPC dias 16 a 18), 9 Última movimentação há mais de um mês, 10 SCPC último dia (desceu), 11 Atraso inicial (dias 3-4), 12 Demais dias.',
        'Atraso inicial (faixa 11) agora só vale se NENHUM título do cliente tiver mais dias de atraso -- inclusive os que já estão em cartório. Quem tem um título de 3 dias e outro mais velho vai pra "Demais dias".',
        'Dentro de cada faixa a ordem agora é do contato mais ANTIGO pro mais recente (quem nunca teve contato vem primeiro). Empate no dia do último contato: mais dias de atraso primeiro.',
        'No dia da atualização, a fila por prioridade montada com a régua antiga não é retomada: o primeiro Alt+U classifica de novo com a régua nova (a barra de progresso também recomeça).',
      ],
    },
    {
      versao: '1.29.17', data: '23/09/2026',
      mudancas: [
        'Corrigido: no relatório do Alt+A/Alt+R, com razão social longa, o badge "Negativado (SCPC)" (e às vezes o saldo) quebrava em duas linhas e o texto vazava da caixa. Agora badge, saldo, datas e atraso ficam sempre numa linha só -- quem quebra é o nome do cliente.',
      ],
    },
    {
      versao: '1.29.16', data: '22/09/2026',
      mudancas: [
        'Corrigido (revisão completa do projeto): Alt+S apertado de novo enquanto o primeiro registro ainda estava sendo enviado podia registrar o MESMO contato duas vezes no CRM. Agora, com o registro em andamento, o segundo Alt+S é ignorado (aviso "Registro em andamento").',
        'Corrigido: Alt+A apertado de novo com o primeiro ainda rodando fazia tudo em dobro (clicava duas vezes em "Entrar em contato" e, com grupo econômico, abria as abas das outras razões duas vezes). Agora o segundo aperto é ignorado até o primeiro terminar.',
        'Corrigido: Alt+A apertado logo depois de abrir um cliente com grupo econômico (nos ~2 primeiros segundos) não gerava o relatório das outras razões e escrevia "razão social X" em vez de "cada razão social" -- a leitura da aba Grupo ainda não tinha terminado. Agora o Alt+A espera essa leitura (no máximo 3s).',
        'Corrigido: a mensagem do Alt+A nunca mais agradece a baixa ("Recebemos a baixa do título X, obrigado!") de um título que continua em aberto no próprio relatório -- só agradece os que sumiram de verdade.',
        'Corrigido: a fila por prioridade remontada a partir da classificação do dia (Alt+U sem refazer) trazia de volta clientes marcados "não cobrar" no botão Alerta depois da classificação, e clientes que já tiveram movimentação hoje por fora do SmartTable. Agora os dois ficam de fora, igual à fila montada do zero.',
        'Corrigido: um erro inesperado durante a classificação do Alt+U deixava o indicador "Classificando..." preso na tela e todo Alt+U seguinte respondia "já tem uma classificação em andamento" até recarregar a página.',
        'Aviso novo no console: quando não dá pra ler o usuário logado no cabeçalho do CRM, a mensagem se apresentaria com o nome padrão sem ninguém saber -- agora isso aparece no console (e no Alt+K).',
      ],
    },
    {
      versao: '1.29.15', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1 (relatado pelo usuário: badge continuava torto mesmo na v1.29.14). Diagnosticado no console do operador: o CRM já carrega um html2canvas 1.x PRÓPRIO na página, e o carregador do SmartTable reaproveitava esse global em silêncio ("se já existe html2canvas, usa ele") -- por isso a versão 2.4.4 fixada na v1.29.14 nunca chegou a ser usada em produção. Agora a nossa versão é carregada DENTRO do iframe de captura (janela própria): o relatório sempre usa a 2.4.4, e o html2canvas do CRM fica intocado (não quebra o botão de Print nativo). Se o CDN estiver bloqueado, cai no html2canvas da página como plano B (relatório sai, com o visual antigo) e avisa no console. Pra conferir qual lib gerou o último relatório: __avisoCobranca.origemHtml2Canvas() no console. Validado rodando o Módulo 1 real num Chromium com um html2canvas antigo pré-carregado na página, igual ao CRM.',
      ],
    },
    {
      versao: '1.29.14', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1, causa raiz de verdade (relatado pelo usuário: "continua a mesma coisa" mesmo depois de seis rodadas de ajuste de CSS no badge -- flexbox, remover inline-block, iframe, chip com span+padding, fundo no td, NBSP+line-height). Nenhuma das seis era o problema: reproduzido com Playwright + Chromium real que o defeito é um bug de renderização confirmado na lib html2canvas-pro@1.5.8 (o próprio pacote marca a série 1.5.x como deprecated, "Known rendering bugs exist") -- comparado lado a lado com o layout nativo do navegador, a 1.5.8 desenha bordas de elementos inline tortas/cortando texto, a 2.4.4 desenha igual ao navegador. Atualizada a versão da lib (HTML2CANVAS_URL) pra 2.4.4 e revertido o badge pro design original com contorno arredondado -- confirmado renderizando limpo na 2.4.4 antes de publicar.',
      ],
    },
    {
      versao: '1.29.13', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1 (relatado pelo usuário: na v1.29.12 a borda do badge aparecia descolada pra cima do texto, cortando as letras no meio): causado pelo line-height:2.1 usado pra dar respiro vertical -- line-height alto infla a linha, mas a borda de um elemento inline não acompanha isso direito no html2canvas. Removido o line-height -- a borda volta a abraçar o texto rente (só o respiro horizontal dos NBSPs continua).',
      ],
    },
    {
      versao: '1.29.12', data: '22/09/2026',
      mudancas: [
        'Melhorado no Módulo 1 (relatado pelo usuário: o fundo direto no <td> da v1.29.11 corrigiu o desalinhamento, mas ficou "grudado"/sem graça, cobrindo a célula inteira): volta o badge com contorno arredondado (visual original, antes de toda a investigação), mas o respiro ao redor do texto agora é feito com espaços (NBSP) e line-height, nunca com a propriedade padding -- que se provou, em cinco rodadas de teste, ser a real causa do defeito no html2canvas (não o border-radius).',
      ],
    },
    {
      versao: '1.29.11', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1, de vez (relatado pelo usuário: o chip da v1.29.10 continuava torto/cortado): o fio condutor de TODAS as tentativas com defeito (flexbox, remover inline-block, iframe, chip com span+padding) era padding num elemento <span> inline -- com ou sem border-radius, com ou sem border, sempre saía errado no html2canvas. A única versão que renderizou limpo foi texto puro sem padding (v1.29.9), e o cabeçalho da tabela (fundo colorido direto no <th>, sem span) nunca teve problema em nenhum print. O fundo do chip agora vai direto no <td> da Situação -- mesmo padrão comprovado do cabeçalho, sem span, sem padding extra.',
      ],
    },
    {
      versao: '1.29.10', data: '22/09/2026',
      mudancas: [
        'Melhorado no Módulo 1 (relatado pelo usuário, confirmando que o corte/deslocamento da v1.29.9 sumiu, mas achando o texto puro sem graça): badge da coluna "Situação" agora é um chip sólido -- fundo cheio na cor da situação, texto branco em negrito, cantos retos (sem border/border-radius, continua imune ao bug do html2canvas descrito na v1.29.9).',
      ],
    },
    {
      versao: '1.29.9', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1, resolvido do zero (relatado pelo usuário: badge da coluna "Situação" continuava cortado/deslocado mesmo depois de isolar o relatório num iframe na v1.29.8): border-radius combinado com border num elemento inline é um bug conhecido e recorrente do html2canvas (várias issues abertas no projeto, em versões diferentes, nunca totalmente corrigido) -- as três correções anteriores (flexbox, remover inline-block, isolar em iframe) nunca tocavam nisso, por isso nenhuma resolvia. Trocado o badge com caixa arredondada por texto simples, negrito, na cor do rail da situação -- sem border nem border-radius, centralizado via text-align:center no <td> (texto puro é o caminho mais confiável do html2canvas).',
      ],
    },
    {
      versao: '1.29.8', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1 (relatado pelo usuário, com print: badge "Em atraso" cortado e deslocado no canto direito da tabela -- piorou depois da correção da v1.29.7): a causa real nunca foi o CSS do próprio badge (nem v1.29.5 com flexbox, nem v1.29.7 removendo inline-block resolveram porque o problema não estava ali). capturarEExportar anexava o relatório direto em document.body, ou seja, DENTRO do mesmo documento da página do CRM -- como o HTML do relatório usa tags soltas (table/tr/td/span) sem classe, qualquer CSS do CRM que mire essas tags genericamente (ex.: table-layout:fixed da grade de títulos, encolhendo a coluna Situação abaixo da largura do badge) valia também pro relatório. Agora o relatório é montado dentro de um <iframe> isolado (documento separado, sem herdar CSS nenhum da página) antes de ser capturado pelo html2canvas -- fica imune a qualquer estilo do CRM, atual ou futuro.',
      ],
    },
    {
      versao: '1.29.7', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1 (relatado pelo usuário: badge da coluna "Situação" continuava desalinhado à esquerda mesmo depois da correção da v1.29.5 com flexbox): a causa real não era a falta de centralização do container, era o display:inline-block do badge -- o html2canvas calcula a largura de um inline-block como se fosse a da célula inteira (em vez de abraçar só o texto), então o badge "nascia gordo" e o texto dentro dele caía à esquerda, com ou sem flexbox em volta. Removido o inline-block -- um <span> comum (inline, o padrão) sempre abraça só o conteúdo em qualquer motor de renderização, e continua aceitando padding/border/border-radius normalmente.',
      ],
    },
    {
      versao: '1.29.6', data: '22/09/2026',
      mudancas: [
        'Corrigido, PRIORIDADE TOTAL (relatado pelo usuário: "no Alt+R sempre copia na área de transferência, mas no Alt+A a maioria das vezes não vai"): o Alt+A copia a imagem do relatório e, logo em seguida, escreve a mensagem -- o que dispara um laço em segundo plano copiando cada PARTE DE TEXTO pra área de transferência (pro histórico do Win+V). Cada escrita de texto substitui o conteúdo atual, então a última parte sobrescrevia a imagem poucos segundos depois dela ter sido copiada com sucesso -- um Ctrl+V logo após o Alt+A colava texto, não a imagem. Alt+R sozinho nunca aciona esse laço, por isso nunca sofria disso. Agora, assim que o laço de texto termina, a imagem do relatório é recolocada como conteúdo atual da área de transferência (Módulo 1: recopiarUltimaImagem) -- ela continua no histórico do Win+V também, só a ordem final muda.',
      ],
    },
    {
      versao: '1.29.5', data: '22/09/2026',
      mudancas: [
        'Corrigido no Módulo 1 (relatado pelo usuário: badge da coluna "Situação" saindo desalinhado à esquerda na imagem do relatório): text-align:center na célula + display:inline-block no badge centraliza certinho em qualquer navegador normal, mas o html2canvas (a lib que captura o relatório em imagem) não respeita essa combinação de forma confiável. Centralizado com flexbox num <div> em volta do badge, que o html2canvas trata de forma mais previsível.',
        'Corrigido no Módulo 1 (relatado pelo usuário: "o relatório baixa mas às vezes não vai pra área de transferência"): navigator.clipboard.write() exige que o documento esteja em foco -- se o operador já foi pro WhatsApp Desktop (ou qualquer outra janela) enquanto o html2canvas ainda estava capturando a tela, a cópia falhava em silêncio e só o download (que não depende de foco) acontecia. Agora espera o foco voltar antes de tentar copiar, com um teto de segurança pra não travar o Alt+A/Alt+R pra sempre.',
      ],
    },
    {
      versao: '1.29.4', data: '22/09/2026',
      mudancas: [
        'Corrigido (relatado pelo usuário: "tem horas que tenho que apertar Alt+A de novo pra pegar as frases"): depois de abrir a tela de contato, o Alt+A esperava um tempo FIXO (150ms) antes de escrever a mensagem -- o mesmo problema que já tinha sido corrigido no passo do relatório (espera por sinal real, não tempo fixo), só que a correção nunca chegou até este passo. Se o modal de contato demorasse mais que 150ms pra montar a caixa de observações, a escrita rodava cedo demais, não encontrava a caixa e desistia em silêncio -- nenhuma mensagem, nenhum aviso na tela. Na segunda tentativa funcionava porque o modal já estava aberto. Agora espera a caixa aparecer de verdade antes de escrever, e avisa com um toast (não só no console) se mesmo assim não conseguir a tempo -- tanto aqui quanto no passo do relatório, que também ficava silencioso quando o teto de segurança era atingido.',
      ],
    },
    {
      versao: '1.29.3', data: '22/09/2026',
      mudancas: [
        'Revertido (pedido do usuário): a tentativa de gerar o relatório pelo botão NATIVO do CRM ("Print dos títulos vencidos", versões 1.29.0 a 1.29.2) esbarrou num erro dentro do próprio código do CRM ("Cannot read properties of null (reading \'cabecalho\')" em print-cobranca.js) que não foi possível contornar por aqui -- confirmado que acontecia de forma consistente, não só por timing. Alt+R/Alt+A voltam a gerar o relatório do jeito que já funcionava antes: botão próprio do SmartTable, captura via html2canvas. Se o CRM corrigir o problema do lado dele no futuro, dá pra reavaliar a integração nativa de novo.',
      ],
    },
    {
      versao: '1.28.2', data: '22/09/2026',
      mudancas: [
        'Corrigido (causa raiz de "mensagens intervaladas embaralhadas/duplicadas/não geradas" quando o Alt+S vinha rápido demais depois do Alt+A): a escrita de segurança do Alt+S na área de transferência rodava sem NENHUMA coordenação com o laço de cópia de partes do Alt+A, que continua em segundo plano por até ~2s. Se o Alt+S chegasse com o laço ainda no meio, as duas escritas competiam pela mesma área de transferência -- uma cópia de parte que ainda estava em voo podia sobrescrever a correção do Alt+S DEPOIS dela. Agora toda escrita passa por uma fila única, e o Alt+S cancela qualquer cópia do laço ainda pendente antes de escrever a sua, garantindo que a mensagem certa sempre fique por último.',
      ],
    },
    {
      versao: '1.28.1', data: '22/09/2026',
      mudancas: [
        'Corrigido (causa raiz do progresso não contar mesmo com o contato sendo gerado -- Alt+A + Alt+S): a marcação de "atendido hoje" usava a MESMA trava que Alt+S seta no instante do clique, antes de qualquer sucesso -- então, quase sempre, o sucesso de verdade chegava com essa trava já ocupada e era ignorado. Acontecia em praticamente todo Alt+S, não só em algum caso raro. Agora são duas travas separadas.',
        'Reforço (ainda não confirmado em produção, achado em revisão): se alguma tela do CRM tornar window.abrirWhatsAppCliente totalmente congelada (nem configurável, nem gravável), a detecção agora degrada com um aviso no console em vez de quebrar o restante da automação do Módulo 3.',
      ],
    },
    {
      versao: '1.28.0', data: '22/09/2026',
      mudancas: [
        'Novo: Console de Diagnóstico (Alt+K) -- uma janela só com módulos carregados/faltando, a posição na fila e o progresso do dia, e os avisos/erros recentes do próprio SmartTable, sem precisar abrir o DevTools. Um botão dentro dela roda a autoconferência completa (window.__conferir()) e mostra o resultado na tela.',
      ],
    },
    {
      versao: '1.27.4', data: '22/09/2026',
      mudancas: [
        'Corrigido: window.__conferir() (Módulo 8) nunca detectava módulo faltando de verdade -- ele lia uma variável (FLAGS_DOS_MODULOS) que tinha sido removida do Módulo 6 numa limpeza anterior, então sempre caía num aviso genérico ("Módulo 6 não carregou") em vez de checar a lista real. Agora usa o mesmo registro central que todo o resto do sistema já usa.',
      ],
    },
    {
      versao: '1.27.3', data: '21/09/2026',
      mudancas: [
        'Corrigido: em pelo menos uma tela do CRM, a detecção de sucesso do registro não conseguia se proteger contra a página redefinir a função do WhatsApp depois (erro real no console: "Cannot redefine property"). Agora, além de tentar reagir na hora, o SmartTable confere periodicamente (a cada fração de segundo, sem custo perceptível) se a função continua sob vigilância, e reinstala sozinho se a página trocar -- funciona mesmo quando o outro método não é possível.',
      ],
    },
    {
      versao: '1.27.2', data: '21/09/2026',
      mudancas: [
        'Corrigido: as mensagens em partes (Alt+A) às vezes vinham com frase faltando ou duplicada no histórico do Win+V. Causa: copiar pra área de transferência exige a aba em foco, e o operador com frequência já tinha ido pro WhatsApp nesse meio tempo -- as últimas cópias falhavam em silêncio. Agora, se o foco se perder no meio da cópia, ela pausa e retoma sozinha quando você volta pra aba, sem perder nem repetir nenhuma parte.',
      ],
    },
    {
      versao: '1.27.1', data: '21/09/2026',
      mudancas: [
        'Corrigido: mesmo com a correção anterior, alguns registros continuavam sem marcar "atendido hoje" -- a tela do CRM provavelmente redefine a função que abre o WhatsApp em algum momento (ex.: reabrir o modal), o que apagava nossa detecção em silêncio. Agora a detecção sobrevive a quantas vezes a página quiser redefinir essa função. Também aparece um aviso "✓ Sucesso do registro detectado" no console (F12) na hora do registro, pra dar pra conferir na hora em vez de precisar rodar diagnóstico depois.',
      ],
    },
    {
      versao: '1.27.0', data: '21/09/2026',
      mudancas: [
        'Alt+A não escreve mais a mensagem inteira num bloco só -- ela sai em partes (uma por assunto: saudação, contexto, relatório, situação, pergunta final).',
        'A caixa de observações (e o que o Alt+S manda pro WhatsApp) agora tem só a primeira parte (a saudação); as demais são copiadas em sequência pra área de transferência -- use o histórico do Windows (Win+V) pra colar cada uma como seu próprio balão.',
        'A imagem do relatório continua exatamente como antes (Alt+R, cópia automática) -- ela também fica disponível no histórico do Win+V junto com as partes de texto.',
      ],
    },
    {
      versao: '1.26.0', data: '21/09/2026',
      mudancas: [
        'Corrigido (causa raiz da série de bugs no progresso da fila): por padrão, "Registrar e Enviar" abre o WhatsApp Desktop sem abrir nenhuma aba nova -- a detecção de sucesso só sabia observar aba nova, então nunca disparava nesse caminho (o mais comum), e o cliente nunca era marcado como atendido. Agora a detecção observa o instante certo, funciona nos dois modos (Desktop e WhatsApp Web) e não depende mais de como o botão foi clicado.',
      ],
    },
    {
      versao: '1.25.1', data: '21/09/2026',
      mudancas: [
        'Corrigido: o painel de progresso ficava travado em "indisponível" o dia inteiro se a primeira coisa que o Alt+U fizesse no dia fosse RETOMAR uma fila já em andamento (em vez de montar uma nova) -- agora retomar também garante que existe um retrato do dia pra contar em cima.',
      ],
    },
    {
      versao: '1.25.0', data: '21/09/2026',
      mudancas: [
        'O painel de progresso da fila (borda direita) agora mostra "Cobrando agora: <faixa>" quando você está num cliente que faz parte da fila de hoje, e destaca a barra da faixa correspondente.',
        'O "total" de cada faixa no painel de progresso fica travado no resultado da PRIMEIRA fila por prioridade do dia -- Shift+Alt+U (reclassificar) ou retomar a fila mais tarde não mudam mais os números já mostrados. Só o "cobrados" continua ao vivo. Reseta sozinho na primeira fila do dia seguinte.',
      ],
    },
    {
      versao: '1.24.2', data: '21/09/2026',
      mudancas: [
        'Corrigido: a barra de progresso da fila (painel discreto na borda direita) não contava um cliente que você tinha acabado de mandar WhatsApp -- se você chegou nele por qualquer caminho fora do "Próximo"/"Voltar" do SmartTable (ex.: o Fluxo de Cobrança nativo do CRM), o sistema estava creditando o cliente ONDE A FILA TINHA PARADO, não o que você realmente atendeu.',
      ],
    },
    {
      versao: '1.24.1', data: '21/09/2026',
      mudancas: [
        'Corrigido: depois de ancorar os botões da fila dentro da tela do CRM (versão anterior), "Continuar fila anterior" e os outros botões da fila pararam de navegar pra qualquer cliente -- só davam reload na página. O clique estava sendo "roubado" por um formulário do CRM que fica por trás desses botões.',
      ],
    },
    {
      versao: '1.24.0', data: '21/09/2026',
      mudancas: [
        'Corrigido: a posição da fila (Fila: X/Y) mudava sozinha sempre que você abria um cliente que já estava na fila só pra conferir algo -- agora só muda de verdade quando você usa "Próximo"/"Voltar".',
        'Alt+U (retomar a fila de hoje) agora também tira, na hora, quem já teve movimentação hoje no CRM -- dá pra "atualizar" a fila a qualquer momento sem precisar de um Shift+Alt+U completo (que reabre todas as abas).',
        'Gerar Relatório, Iniciar Fila de Atendimento, o painel de Voltar/Próximo/Encerrar e Continuar fila anterior deixaram de flutuar por cima da tela -- agora tentam se encaixar em pontos naturais do layout do CRM (cai pro botão flutuante de antes se não encontrar onde encaixar).',
      ],
    },
    {
      versao: '1.22.1', data: '18/09/2026',
      mudancas: [
        'Bastidores: a lista de "quais módulos existem" (usada só no diagnóstico do console) deixou de ser copiada à mão -- cada módulo se anuncia sozinho agora. Sem mudança visível pra quem usa.',
      ],
    },
    {
      versao: '1.22.0', data: '18/09/2026',
      mudancas: [
        'O botão "Alerta" agora entra dentro do card do cliente, logo depois do botão "Responsável financeiro" -- some o problema de posição de vez. Sem essa referência na página, ainda cai pro botão flutuante de antes.',
        'Corrigido: entrar num cliente marcado "não cobrar" não mostrava aviso nenhum. Agora o aviso aparece sempre que houver "não cobrar" e/ou observação ativos -- antes só avisava com observação sozinha.',
      ],
    },
    {
      versao: '1.21.1', data: '18/09/2026',
      mudancas: [
        'Corrigido: o botão "Alerta" nascia invisível -- o cabeçalho do CRM cobre a tela inteira até 80px do topo, no mesmo z-index dos modais, e escondia o botão por completo. Movido pra baixo do cabeçalho.',
      ],
    },
    {
      versao: '1.21.0', data: '18/09/2026',
      mudancas: [
        'Novo: botão "Alerta" na página do cliente -- marca "não cobrar" por um número de dias (padrão 1, esse cliente some da fila por prioridade enquanto durar) e/ou uma observação livre.',
        'Cliente com observação mas sem "não cobrar" marcado recebe um aviso automático, um pouco acima do centro da tela, toda vez que a página dele é aberta.',
      ],
    },
    {
      versao: '1.20.0', data: '18/09/2026',
      mudancas: [
        'Corrigido: Cluster Novo com título já em cartório era excluído da fila por prioridade por causa do teto de dias de atraso -- agora aparece sempre, porque é a cobrança quem bloqueia o faturamento desse cliente.',
      ],
    },
    {
      versao: '1.19.0', data: '18/09/2026',
      mudancas: [
        'Novo: um botão discreto na borda direita da tela mostra o progresso da fila de hoje, uma barra por prioridade (ex.: 23/56 cobrados).',
        'Não é atalho de teclado de propósito -- é um botão, sempre no mesmo lugar, quase invisível até passar o mouse.',
      ],
    },
    {
      versao: '1.18.1', data: '18/09/2026',
      mudancas: [
        'Corrigido: depois de terminar a fila, o Alt+U remontava a MESMA lista do dia -- incluindo todo mundo que você já tinha cobrado.',
        'Corrigido: remontar a fila gravava uma segunda atribuição do dia no diário, o que fazia o alarme de repetição disparar à toa.',
      ],
    },
    {
      versao: '1.18.0', data: '18/09/2026',
      mudancas: [
        'As frases da cobrança passam a variar: cada papel tem 2 a 4 versões, escolhidas por cliente e por dia.',
        'O mesmo cliente não lê mais a mesma pergunta final todo dia -- antes 83% das mensagens terminavam igual.',
        'Dentro do mesmo dia a frase NÃO muda: apertar Alt+A duas vezes no mesmo cliente dá o mesmo texto.',
      ],
    },
    {
      versao: '1.17.0', data: '18/09/2026',
      mudancas: [
        'A classificação da fila passa a abrir 4 abas de fundo ao mesmo tempo, em vez de uma por vez: de ~4 minutos para ~1.',
        'O resultado fica guardado no dia. Alt+U monta a fila do que já foi classificado, sem revisitar ninguém.',
        'Shift+Alt+U continua refazendo tudo do zero quando você quiser.',
      ],
    },
    {
      versao: '1.16.0', data: '18/09/2026',
      mudancas: [
        'Alt+U agora CONTINUA a fila de hoje em vez de refazer tudo -- ele volta direto pro cliente onde você parou.',
        'Shift+Alt+U refaz a fila do zero, quando você quiser mesmo. Refazer já tira quem foi contatado hoje.',
        'Antes, apertar Alt+U às 14h revisitava ~140 clientes e ainda apagava a fila da manhã com a sua posição nela.',
      ],
    },
    {
      versao: '1.15.1', data: '18/09/2026',
      mudancas: [
        'Corrigido: os painéis de Ajuda, Novidades, Configurações e Entrou na semana abriam todos no mesmo canto, um por cima do outro.',
        'Agora abrir um fecha os outros -- só um painel flutuante na tela por vez.',
      ],
    },
    {
      versao: '1.15.0', data: '18/09/2026',
      mudancas: [
        'O Alt+D passa a mostrar o Total recuperado: depósitos + promessas cumpridas, por pessoa e somando os dois.',
        'As duas parcelas continuam na tela separadas, pra dar pra conferir o total contra as origens dele.',
      ],
    },
    {
      versao: '1.14.0', data: '18/09/2026',
      mudancas: [
        'O banner de grupo econômico saiu: o próprio CRM passou a avisar ("1 CNPJ do grupo vencido", na página do cliente).',
        'A detecção continua igual -- o Alt+G, a frase do relatório e a fila por prioridade não mudam em nada.',
        'O que o aviso do CRM não diz (quem e quanto) continua a uma tecla: Alt+G abre todas as razões com vencido.',
      ],
    },
    {
      versao: '1.13.0', data: '18/09/2026',
      mudancas: [
        'Novo atalho Alt+D: quanto entrou na semana vigente (sábado a sexta), seu e da Bianca, sem sair da página.',
        'Sai do dashboard consolidado do próprio CRM -- é o primeiro número financeiro que o SmartTable mostra sem inferir nada.',
        'São DOIS números: Depósitos (recuperado por negociações) e Promessas cumpridas (recuperado por promessas da cobrança). Eles não se somam.',
      ],
    },
    {
      versao: '1.12.0', data: '17/09/2026',
      mudancas: [
        'Novo atalho Alt+O: painel de configurações com interruptores, que valem na hora e ficam salvos neste navegador.',
        'Primeiro interruptor: "Enviar pelo WhatsApp Web" -- a mensagem abre em web.whatsapp.com numa aba fixa, em vez do app Desktop.',
        'Serve pra atender pela conta de outra pessoa sem desvincular a sua do app. Desligado por padrão: nada muda pra quem não mexer.',
      ],
    },
    {
      versao: '1.11.2', data: '17/09/2026',
      mudancas: [
        'Corrigido: ao FECHAR a barra de navegação rápida, o alerta de grupo não subia junto e ficava com um vão.',
      ],
    },
    {
      versao: '1.11.1', data: '17/09/2026',
      mudancas: [
        'Corrigido: o alerta de grupo econômico existia mas ficava escondido atrás da barra de navegação rápida do CRM.',
        'Ele agora se posiciona abaixo da área fixa inteira do topo, e acompanha quando você abre ou fecha essa barra.',
      ],
    },
    {
      versao: '1.11.0', data: '17/09/2026',
      mudancas: [
        'Novos window.__diag.fila() e window.__diag.grupo(): diagnósticos que já saem CENSURADOS, sem CNPJ, razão social nem valor.',
        'A exportação do diário passa a ser censurada por padrão -- o arquivo é justamente o que vira anexo de e-mail.',
      ],
    },
    {
      versao: '1.10.0', data: '17/09/2026',
      mudancas: [
        'Novo window.__conferir() no console: checa a fila, o diário e o contexto contra dado REAL e aponta o que estiver inconsistente.',
        'É a resposta aos bugs que a suíte não pegava -- eles viviam em código que abre aba de fundo e só quebra com dado de verdade.',
      ],
    },
    {
      versao: '1.9.2', data: '17/09/2026',
      mudancas: [
        'Corrigido: cada Alt+U gravava a fila DUAS vezes no diário, o que dobrava "na fila" e derrubava a taxa de contato pela metade.',
        'A análise passa a agrupar atribuições repetidas do mesmo dia -- rodar o Alt+U mais de uma vez por dia não distorce mais os números.',
      ],
    },
    {
      versao: '1.9.1', data: '17/09/2026',
      mudancas: [
        'Registrado que o 5º dia de atraso cai em "Demais dias" DE PROPÓSITO -- é a régua como foi desenhada, não uma faixa esquecida.',
      ],
    },
    {
      versao: '1.9.0', data: '17/09/2026',
      mudancas: [
        'Novo atalho Alt+L: mostra este log de atualização, com o que chegou desde a sua última leitura marcado como NOVO.',
      ],
    },
    {
      versao: '1.8.0', data: '17/09/2026',
      mudancas: [
        'A fila do Alt+U volta a sair 100% na ordem da régua -- o sorteio de posição que reordenava 1 em cada 5 clientes foi desligado.',
        'O diário continua gravando tudo; só a comparação "a ordem da régua ajuda?" fica em suspenso.',
      ],
    },
    {
      versao: '1.7.0', data: '17/09/2026',
      mudancas: [
        'Corrigido: o sorteio de posição nunca alcançava o fim da fila, o que enviesava a medição a favor da régua.',
      ],
    },
    {
      versao: '1.6.0', data: '17/09/2026',
      mudancas: [
        'Cliente que prometeu pagar HOJE não recebe mais "Podemos agendar para hoje?" -- agora pede o comprovante.',
        'Pagamento parcial passa a pedir "Consegue quitar o restante hoje?" em vez de falar do débito como se nada tivesse sido pago.',
      ],
    },
    {
      versao: '1.5.1', data: '17/09/2026',
      mudancas: [
        'Corrigido: o Alt+A às vezes não gerava o relatório. Agora ele espera a geração TERMINAR antes de abrir a tela de contato.',
        'Efeito colateral: a tela de contato abre alguns segundos depois no primeiro Alt+A do dia. É o preço de não perder o relatório.',
      ],
    },
    {
      versao: '1.5.0', data: '17/09/2026',
      mudancas: [
        'Novo diário de cobrança: registra a fila, a cobrança enviada e a baixa detectada.',
        'Veja a análise com window.__diario.relatorio() no console.',
      ],
    },
    {
      versao: '1.4.0', data: '17/09/2026',
      mudancas: [
        'Corrigido: o relatório era omitido por engano quando um título vencia no mesmo dia do último contato.',
        'Corrigido: o agradecimento de pagamento sumia se você recarregasse a página antes do Alt+A.',
        'Corrigido: um saldo ilegível virava R$ 0,00 em silêncio na mensagem. Agora a variável fica visível e avisa.',
        'Alt+B passa a fechar a própria busca rápida.',
      ],
    },
    {
      versao: '1.3.0', data: '16/09/2026',
      mudancas: [
        'As mensagens passam a se apresentar com o nome de quem está logado no CRM, não com um nome fixo no código.',
        'A régua de "nunca contatado por mim" também segue o usuário logado.',
      ],
    },
    {
      versao: '1.1.0', data: '16/09/2026',
      mudancas: [
        'Cliente já contatado por outro negociador, mas nunca por você, recebe a linha de apresentação.',
      ],
    },
  ];

  // Congelado: o painel só lê; ninguém reescreve o histórico em tempo de execução.
  window.__logAtualizacoes = Object.freeze(LOG_ATUALIZACOES.map((e) => Object.freeze({ ...e, mudancas: Object.freeze([...e.mudancas]) })));
})();
