/* =========================================================================
 * MÓDULO 30: CATÁLOGO DE MENSAGENS (os TEXTOS do Alt+A) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Projeto do catálogo de mensagens editáveis (05/10/2026): o texto da mensagem do Alt+A sai do código do Módulo 19
 * para cá, e o usuário passa a poder ajustá-lo sem pedir código. Este módulo guarda:
 *
 *   1. o REGISTRO dos textos (imutável, no código): cada texto tem chave, bloco, título, "quando aparece", as FORMAS
 *      (singular/plural, com/sem relatório...), as variáveis permitidas, as regras de conteúdo e o texto PADRÃO;
 *   2. o MOTOR `T(chave, { forma, vars, semente })`: devolve o texto da forma pedida, com as variáveis trocadas;
 *   3. a LEITURA do catálogo salvo neste navegador (`smarttable_catalogo_mensagens_v1`, só o que o usuário publicou),
 *      validada texto a texto, sempre com o padrão embutido como reserva.
 *
 * REGRAS QUE NÃO SE NEGOCIAM:
 *   - O Alt+A NUNCA deixa de montar a mensagem por causa do catálogo: catálogo ausente, ilegível, de esquema novo ou com
 *     um texto inválido cai no PADRÃO (por texto, quando só um é inválido) e avisa uma vez. Nada é apagado aqui.
 *   - Os textos padrão são CÓPIA EXATA do que o Módulo 19 tinha embutido (provado por tests/mensagens-golden.test.js,
 *     22 mil cenários). Texto novo ou alterado só entra com aprovação do usuário.
 *   - Só texto e variáveis: nunca dado de cliente. Nada vai para o console além de chave e motivo.
 *   - A montagem é sempre por texto puro (nunca HTML) e a troca de variáveis é por função (sem `$&`).
 *
 * R1 só LIA. A R2 acrescenta o RASCUNHO (o que o editor guarda enquanto o usuário digita, separado do publicado e NUNCA usado
 * pelo Alt+A: só o editor e a prévia o leem). Etapa 4: `publicar` (o rascunho inteiro vira o texto em uso; erro de CONTEÚDO bloqueia, o de tamanho não),
 * o HISTÓRICO das últimas 20 publicações (só o que mudou) e `restaurarVersao` (volta a uma versão criando uma publicação nova). O backup vem na próxima etapa.
 *
 * Depende de: Módulo 0 (toast e escolherVariante, opcionais). Precisa carregar ANTES do Módulo 19.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__catalogoMensagensCarregado) return;
  window.__catalogoMensagensCarregado = true;

  const CHAVE_ARMAZENAMENTO = 'smarttable_catalogo_mensagens_v1';
  const VERSAO_ESQUEMA = 1;
  const MAX_VARIANTES = 12;
  const MAX_CARACTERES = 400;
  /**
   * Forma ESPECIAL de todo texto do registro (fora de `formas`): o ESTADO dele, guardado como lista de 3 textos `[ativo, nome, nota]`
   * (`ativo` = '1' ou '0'). Passa pelo mesmo rascunho, publicação, histórico e "voltar versão" das frases; o padrão é `['1', título, quando]`.
   * Desativado, o texto sai da mensagem (`T` devolve ''). O nome e a nota só aparecem no editor: não mudam a mensagem.
   */
  const FORMA_ESTADO = '_estado';
  const MAX_NOME = 80;
  const MAX_NOTA_TEXTO = 300;
  // Teto do que o validador percorre num catálogo salvo (o registro tem 35 textos e no máximo 6 formas por texto).
  const MAX_CHAVES_SALVAS = 500;
  const MAX_FORMAS_SALVAS = 50;
  // Rascunho: o que está sendo digitado ainda não precisa passar nas regras (isso é na hora de publicar), mas tem teto de tamanho.
  const MAX_CARACTERES_RASCUNHO = 2000;
  /** Quantas publicações o histórico guarda (as mais novas) e o tamanho máximo da nota de cada uma. */
  const MAX_HISTORICO = 20;
  const MAX_NOTA = 120;
  // Se o catálogo salvo não puder ser lido e o editor for gravar, o original é guardado sob esta chave (+ instante): nunca se apaga.
  const PREFIXO_ILEGIVEL = `${CHAVE_ARMAZENAMENTO}_ilegivel_`;

  // Variáveis que a substituição final do Módulo 19 (substituirVariaveisDaFrase) resolve com os dados do cliente.
  // `saudacao` e `saudacao_com_nome` ficam de fora de propósito: dentro de um texto duplicariam a saudação.
  // Valem em todo texto, EXCETO nos que `semGlobais` marca (a saudação é resolvida antes da substituição das globais).
  const VARIAVEIS_GLOBAIS = Object.freeze([
    'cliente_nome', 'quantidade_titulos_vencidos', 'quantidade_titulos_protestados', 'valor_total_vencido', 'data_vencimento',
  ]);

  const BLOCOS = Object.freeze({
    1: 'Perguntas finais', 2: 'Linhas fixas', 3: 'Contexto da conversa', 4: 'Situação dos títulos', 5: 'Acordo e legenda do relatório',
  });

  /* ---------------------------------------------------------------------
   * REGISTRO. `formas`: lista { id, rotulo, padrao: [texto...] } (todo texto aceita até 12 variantes). `rodizio` (true em todos): a lista de
   * variantes é escolhida por hash(cliente|dia). `pergunta`: 'obrigatoria' (todo texto tem "?"), 'proibida' (nenhum tem: a
   * pergunta final da mensagem já cumpre o papel, ver precisaDePerguntaFinal no Módulo 19) ou 'livre'. `exigir`/`evitar`:
   * regras de conteúdo JÁ documentadas (tests/rotacao-frases.test.js e comentários do Módulo 19, decisões do usuário).
   * --------------------------------------------------------------------- */
  const unico = (...textos) => [{ id: 'unico', rotulo: 'Texto', padrao: textos }];
  // `variaveis` (opcional): as variáveis que ESTA forma recebe; sem ela vale a lista do texto (`variaveis` de t()).
  const forma = (id, rotulo, texto, variaveis) => ({ id, rotulo, padrao: [texto], ...(variaveis ? { variaveis } : {}) });
  const t = (chave, bloco, titulo, quando, formas, opcoes = {}) => ({
    chave, bloco, titulo, quando, formas, variaveis: [], semGlobais: false, rodizio: true, pergunta: 'livre', exigir: [], evitar: [], semDesativar: false, ...opcoes,
  });
  // `semDesativar` (true): o texto é um PEDAÇO de frase (uma palavra ou um trecho que entra dentro de outra frase): vazio, a frase em volta sairia quebrada.
  // Esses só podem ser renomeados; o interruptor "Usar este trecho" não existe para eles (decisão do usuário, 06/10/2026).

  const REGISTRO = [
    // ---- Bloco 1: perguntas finais (rodízio) e retomada ----
    t('cta.generico', 1, 'Pergunta final — atraso comum', 'Título em atraso ou no prazo final, sem promessa para hoje.',
      unico(
        'Podemos agendar para hoje o pagamento do débito em aberto?',
        'Consegue regularizar ainda hoje?',
        'Como podemos resolver isso hoje?',
        'Consegue me confirmar se dá para acertar hoje?',
      ), { pergunta: 'obrigatoria' }),
    t('cta.ultimoDia', 1, 'Pergunta final — último dia', 'Título no último dia de pagamento antes do encaminhamento.',
      unico(
        'Consegue regularizar hoje para evitarmos o encaminhamento?',
        'Conseguimos quitar isso hoje antes que o título siga para o encaminhamento?',
        'Consegue acertar hoje para o título não seguir para encaminhamento?',
      ), { pergunta: 'obrigatoria', exigir: [{ padrao: /encaminhamento/i, motivo: 'a pergunta do último dia fala do encaminhamento' }] }),
    t('cta.cartorio', 1, 'Pergunta final — em cartório', 'Título já em cartório (e negativado fora das janelas do aviso).',
      unico(
        'Consegue regularizar hoje para eu confirmar a baixa da restrição?',
        'Assim que o pagamento for confirmado, sinalizo em nosso sistema. Consegue regularizar hoje?',
        'Consegue fechar isso hoje? Confirmado o pagamento, já sinalizo a baixa.',
      ), { pergunta: 'obrigatoria', exigir: [{ padrao: /baixa|sinaliz/i, motivo: 'a pergunta do cartório fala da baixa ou da sinalização' }] }),
    t('cta.suspensaoScpc', 1, 'Pergunta final — SCPC do 16º ao 18º dia', 'Negativado de 16 a 18 dias: a suspensão ainda NÃO é hoje.',
      unico(
        'Consegue regularizar hoje para evitarmos a suspensão do cadastro?',
        'A suspensão do cadastro é automática se o pagamento não for identificado. Consegue resolver hoje?',
        'Regularizando hoje, o cadastro segue ativo normalmente. Conseguimos agendar?',
      ), {
        pergunta: 'obrigatoria',
        exigir: [{ padrao: /cadastro/i, motivo: 'a pergunta da suspensão fala do cadastro' }],
        evitar: [{ padrao: /at[ée] o fim do dia/i, nivel: 'erro', motivo: 'nos dias 16 a 18 o prazo ainda não é hoje: "até o fim do dia" seria falso' }],
      }),
    t('cta.ultimoDiaScpc', 1, 'Pergunta final — SCPC no 19º dia', 'Negativado no 19º dia: o prazo é real.',
      unico(
        'Consegue regularizar hoje, o último dia antes da suspensão?',
        'Sem a identificação do pagamento até o fim do dia o cadastro é suspenso automaticamente. Consegue resolver hoje?',
      ), { pergunta: 'obrigatoria' }),
    t('cta.promessaDia', 1, 'Pergunta final — dia da promessa', 'Hoje é o dia combinado para o pagamento (promessa ativa).',
      unico('Assim que efetuar, pode me enviar o comprovante?'), { pergunta: 'obrigatoria' }),
    t('cta.promessaParcial', 1, 'Pergunta final — pagamento parcial', 'Promessa com pagamento parcial já identificado.',
      unico('Consegue quitar o restante hoje?'), { pergunta: 'obrigatoria' }),
    t('retomada', 1, 'Retomada do contato', 'Contato de ontem (ou do dia útil anterior) sem promessa, pagamento nem outro negociador.',
      unico(
        'Retomando o contato de {{referencia}}, já que ainda não obtivemos retorno.',
        'Voltando aqui sobre o contato de {{referencia}}.',
        'Dando sequência ao contato de {{referencia}}.',
      ), {
        variaveis: ['referencia'],
        pergunta: 'proibida',
        exigir: [{ padrao: /\{\{\s*referencia\s*\}\}/, motivo: 'a retomada precisa dizer de quando foi o contato ({{referencia}})' }],
      }),

    // ---- Bloco 2: linhas fixas ----
    t('saudacao', 2, 'Saudação', 'Abre a mensagem; muda com o horário do relógio e com ter ou não o primeiro nome do responsável.', [
      forma('manha|semNome', 'Manhã, sem nome', 'Bom dia, tudo bem?', []),
      forma('manha|comNome', 'Manhã, com nome', 'Bom dia, {{nome}}, tudo bem?', ['nome']),
      forma('tarde|semNome', 'Tarde, sem nome', 'Boa tarde, tudo bem?', []),
      forma('tarde|comNome', 'Tarde, com nome', 'Boa tarde, {{nome}}, tudo bem?', ['nome']),
      forma('noite|semNome', 'Noite, sem nome', 'Boa noite, tudo bem?', []),
      forma('noite|comNome', 'Noite, com nome', 'Boa noite, {{nome}}, tudo bem?', ['nome']),
    ], { semGlobais: true, semDesativar: true }),
    t('apresentacao', 2, 'Apresentação', 'Cliente com contato só de outro negociador, ou contato antigo; e no primeiro contato.',
      unico('Sou {{nome_negociador}}, do financeiro da Tex Cotton (Animê, Bimbi, Youccie, Authoria e Momi).'),
      { variaveis: ['nome_negociador'], pergunta: 'proibida' }),
    t('relatorio.segue', 2, 'Legenda — "Segue o relatório"', 'Abre a legenda da imagem do relatório.', [
      forma('umaRazao', 'Só esta razão social', 'Segue o relatório atualizado da razão social {{cliente_nome}}.'),
      forma('cadaRazao', 'Outras razões do grupo vencidas', 'Segue o relatório atualizado com os débitos em aberto de cada razão social.'),
    ]),
    t('primeiroContato.pergunta', 2, 'Primeiro contato — pergunta do responsável', 'Cliente sem nenhum contato registrado (a mensagem só se identifica e pergunta).',
      unico('Este é o contato responsável pela razão social {{cliente_nome}}?'), { pergunta: 'obrigatoria' }),
    t('ressalva.diaNaoUtil', 2, 'Ressalva — pagamento no fim de semana ou feriado', 'Primeiro dia útil depois de fim de semana ou feriado, título mais atrasado com 2 a 4 dias.',
      unico('Caso já tenha pago {{periodo}}, por gentileza nos encaminhar o comprovante para sinalizar em nosso sistema.'),
      { variaveis: ['periodo'] }),

    // ---- Bloco 3: contexto da conversa ----
    t('agradecimento', 3, 'Agradecimento por pagamento', 'Houve baixa de título desde o último contato (e sem promessa ativa).', [
      forma('semLista', 'Sem número de título', 'Recebemos a baixa de um dos títulos em aberto, obrigado!', []),
      forma('singular', 'Um título', 'Recebemos a baixa do título {{titulos}}, obrigado!'),
      forma('plural', 'Vários títulos', 'Recebemos a baixa dos títulos {{titulos}}, obrigado!'),
    ], { variaveis: ['titulos'], pergunta: 'proibida' }),
    t('promessa.diaDaPromessa', 3, 'Promessa — dia combinado', 'Hoje é o dia combinado para o pagamento.', [
      forma('singular', 'Um título', 'Lembramos que hoje é o dia combinado para o pagamento do título {{titulos}}.'),
      forma('plural', 'Vários títulos', 'Lembramos que hoje é o dia combinado para o pagamento dos títulos {{titulos}}.'),
    ], { variaveis: ['titulos'], pergunta: 'proibida' }),
    t('promessa.quebrada', 3, 'Promessa — não identificada', 'A data combinada passou e o pagamento não foi identificado.', [
      forma('singular', 'Um título', 'Notamos que o pagamento combinado para {{data_prometida}}, referente ao título {{titulos}}, não foi identificado. Já foi realizado? Se sim, pode nos enviar o comprovante para conferência.'),
      forma('plural', 'Vários títulos', 'Notamos que o pagamento combinado para {{data_prometida}}, referente aos títulos {{titulos}}, não foi identificado. Já foi realizado? Se sim, pode nos enviar o comprovante para conferência.'),
    ], { variaveis: ['data_prometida', 'titulos'], pergunta: 'obrigatoria' }),
    t('promessa.parcial', 3, 'Promessa — pagamento parcial', 'Pagamento parcial do combinado identificado (a pergunta final fica a cargo de "Pergunta final — pagamento parcial").', [
      forma('regularizados', 'Tudo regularizado', 'Identificamos o pagamento parcial do combinado para {{data_prometida}}; os títulos combinados já foram regularizados.', ['data_prometida']),
      forma('restaUm', 'Resta um título', 'Identificamos o pagamento parcial do combinado para {{data_prometida}}; ainda resta 1 título em aberto.', ['data_prometida']),
      forma('restamVarios', 'Restam vários títulos', 'Identificamos o pagamento parcial do combinado para {{data_prometida}}; ainda restam {{quantidade}} títulos em aberto.'),
    ], { variaveis: ['data_prometida', 'quantidade'], pergunta: 'proibida' }),
    t('glossario.ontem', 3, 'Glossário — "ontem"', 'Palavra que entra na retomada quando o último contato foi literalmente ontem.',
      unico('ontem'), { pergunta: 'proibida', semDesativar: true }),

    // ---- Bloco 4: situação dos títulos ----
    t('situacao.semProtesto', 4, 'Situação — "não protestar" vencido', 'Título "não protestar" vencido: sem cartório, prazo final nem encaminhamento.', [
      forma('singular', 'Um título', 'O título vencido em {{datas}} está em aberto.'),
      forma('plural', 'Vários títulos', 'Os títulos vencidos em {{datas}} estão em aberto.'),
    ], {
      variaveis: ['datas'],
      pergunta: 'proibida',
      evitar: [{ padrao: /cart[óo]rio|prazo final|encaminh/i, nivel: 'erro', motivo: 'este título nunca vai a cartório: não fale de cartório, prazo final nem encaminhamento' }],
    }),
    t('situacao.ultimoDia', 4, 'Situação — último dia', 'Título no último dia de pagamento, quando a mensagem NÃO leva o relatório (com negativado a mensagem não fala dele).', [
      forma('singular', 'Um título', 'O título vencido em {{datas}} está no prazo final antes de ser encaminhado {{destino}}.'),
      forma('plural', 'Vários títulos', 'Os títulos vencidos em {{datas}} estão no prazo final antes de serem encaminhados {{destino}}.'),
    ], {
      variaveis: ['datas', 'destino'],
      pergunta: 'proibida',
      evitar: [{ padrao: /^Lembramos que/, nivel: 'aviso', motivo: 'esta linha pode vir logo depois da promessa do dia combinado, que já abre com "Lembramos que"' }],
    }),
    t('situacao.emCartorio', 4, 'Situação — em cartório', 'Título já em cartório (principal da mensagem; só aparece quando a mensagem NÃO leva o relatório: com o relatório, a legenda cita a cor).', [
      forma('unico', 'Texto', 'Os títulos vencidos em {{datas}} já estão em cartório -- o pagamento do restante ainda é possível via boleto.'),
    ], { variaveis: ['datas'], pergunta: 'proibida' }),
    t('situacao.emCartorioAdicional', 4, 'Situação — também em cartório', 'Há títulos em cartório além do principal e a mensagem NÃO leva o relatório (com o relatório, a legenda explica o amarelo).', [
      forma('singular', 'Um título', 'O título vencido em {{datas}} também já está em cartório -- o pagamento do restante ainda é possível via boleto.'),
      forma('plural', 'Vários títulos', 'Os títulos vencidos em {{datas}} também já estão em cartório -- o pagamento do restante ainda é possível via boleto.'),
    ], { variaveis: ['datas'], pergunta: 'proibida' }),
    t('scpc.aviso.janela', 4, 'Aviso SCPC — janela do 16º ao 18º dia', 'Negativado de 16 a 18 dias de atraso.',
      unico('Lembramos que, após o {{dia_limite_scpc}}º dia de atraso, o cadastro é suspenso e os faturamentos podem ser cancelados.'), {
        variaveis: ['dia_limite_scpc'],
        pergunta: 'proibida',
        evitar: [{ padrao: /ser[ãa]o cancelados/i, nivel: 'erro', motivo: 'o cancelamento dos faturamentos é só possibilidade ("podem ser cancelados"); afirmar o que não é certo queima o aviso' }],
      }),
    t('scpc.aviso.ultimoDia', 4, 'Aviso SCPC — 19º dia', 'Negativado no 19º dia de atraso.',
      unico('Hoje é o último dia para pagamento antes que o cadastro seja suspenso e o caso seja encaminhado a um de nossos analistas. Após essa data, os faturamentos podem ser cancelados.'), {
        pergunta: 'proibida',
        evitar: [{ padrao: /ser[ãa]o cancelados/i, nivel: 'erro', motivo: 'o cancelamento dos faturamentos é só possibilidade ("podem ser cancelados")' }],
      }),
    t('scpc.aviso.ultimoDiaCurto', 4, 'Aviso SCPC — 19º dia (versão curta)', 'O mesmo aviso do 19º dia quando há outras linhas na mensagem (cabe em menos linhas no celular).',
      unico('Hoje é o último dia antes da suspensão do cadastro; depois dela, os faturamentos podem ser cancelados.'), {
        pergunta: 'proibida',
        evitar: [{ padrao: /ser[ãa]o cancelados/i, nivel: 'erro', motivo: 'o cancelamento dos faturamentos é só possibilidade ("podem ser cancelados")' }],
      }),
    t('scpc.aviso.generico', 4, 'Aviso SCPC — demais dias', 'Negativado fora das janelas do aviso específico.',
      unico('Lembramos que a regularização dos débitos negativados no SCPC permite a baixa das restrições.'), { pergunta: 'proibida' }),
    t('glossario.destino', 4, 'Glossário — destino do encaminhamento', 'Entra em "{{destino}}" na situação do último dia.', [
      forma('scpc', 'Fluxo SCPC', 'ao SCPC'),
      forma('cartorio', 'Fluxo cartório', 'para cartório'),
    ], { pergunta: 'proibida', semDesativar: true }),

    // ---- Bloco 5: acordo e legenda do relatório ----
    t('acordo.lembreteParcela', 5, 'Acordo — lembrete da parcela', 'Todos os títulos em acordo ativo, parcela em dia (sem relatório).',
      unico('Passando para lembrar da parcela {{parcela_numero}} do nosso acordo, de {{parcela_valor}}, com vencimento em {{parcela_data}}. Posso contar com o pagamento na data?'),
      { variaveis: ['parcela_numero', 'parcela_valor', 'parcela_data'], pergunta: 'obrigatoria' }),
    t('acordo.parcelaAtrasada', 5, 'Acordo — parcela atrasada', 'Todos os títulos em acordo ativo, parcela atrasada (sem relatório).',
      unico('A parcela {{parcela_numero}} do nosso acordo, de {{parcela_valor}}, venceu em {{parcela_data}} e ainda não identificamos o pagamento. Consegue regularizar hoje para manter o acordo em dia?'),
      { variaveis: ['parcela_numero', 'parcela_valor', 'parcela_data'], pergunta: 'obrigatoria' }),
    t('acordo.misto.emDia', 5, 'Acordo (com outros títulos) — em dia', 'Há acordo ativo e outros títulos sendo cobrados; parcela em dia.',
      unico('O acordo segue em dia: próxima parcela de {{parcela_valor}} em {{parcela_data}}.'),
      { variaveis: ['parcela_valor', 'parcela_data'], pergunta: 'proibida' }),
    t('acordo.misto.atrasada', 5, 'Acordo (com outros títulos) — parcela atrasada', 'Há acordo ativo e outros títulos sendo cobrados; parcela atrasada (só a afirmação; a pergunta final pede a ação).',
      unico('A parcela {{parcela_numero}} do acordo ({{parcela_valor}}) venceu em {{parcela_data}}.'),
      { variaveis: ['parcela_numero', 'parcela_valor', 'parcela_data'], pergunta: 'proibida' }),
    t('acordo.misto.inadimplente', 5, 'Acordo (com outros títulos) — não cumprido', 'Acordo inadimplente: os títulos dele voltaram para a cobrança.',
      unico('O acordo feito em {{acordo_data}} não foi cumprido, e os títulos voltaram para a cobrança.'),
      { variaveis: ['acordo_data'], pergunta: 'proibida' }),
    t('cores.vermelho', 5, 'Legenda — o que é o vermelho', 'Pedaço da legenda das cores: título no último dia (entra em "Em vermelho, ...").', [
      forma('singular|scpc', 'Um título, fluxo SCPC', 'o título no prazo final antes do SCPC'),
      forma('singular|cartorio', 'Um título, fluxo cartório', 'o título no prazo final antes do cartório'),
      forma('plural|scpc', 'Vários títulos, fluxo SCPC', 'os títulos no prazo final antes do SCPC'),
      forma('plural|cartorio', 'Vários títulos, fluxo cartório', 'os títulos no prazo final antes do cartório'),
    ], { semDesativar: true }),
    t('cores.amarelo', 5, 'Legenda — o que é o amarelo', 'Pedaço da legenda das cores: título em cartório (entra em "em amarelo, ...").',
      unico('o que já está em cartório (o restante ainda pode ser pago via boleto)'), { semDesativar: true }),
    t('cores.composta', 5, 'Legenda — frase das cores', 'Junta o vermelho e o amarelo na legenda da imagem do relatório.', [
      forma('vermelhoEAmarelo', 'Vermelho e amarelo', 'Em vermelho, {{vermelho}}; em amarelo, {{amarelo}}.', ['vermelho', 'amarelo']),
      forma('soVermelho', 'Só vermelho', 'Em vermelho, {{vermelho}}.', ['vermelho']),
      forma('soAmarelo', 'Só amarelo', 'Em amarelo, {{amarelo}}.', ['amarelo']),
    ]),
  ];

  /**
   * ORGANIZAÇÃO das situações (sprint 3, RN-B1 e RN-B2): é só como a TELA agrupa os textos; nenhuma mensagem muda. Mora no mesmo catálogo, como um
   * pseudo-texto `_organizacao` (fora do REGISTRO: só o editor o conhece) com uma forma `unico` de linhas, que passa pelo rascunho, publicação,
   * histórico e "voltar versão" como qualquer texto. Linhas: `S|id|nome` (uma situação, na ordem da tela; id '1' a '5' = as 5 de hoje, que não se
   * apagam; id `n<número>` = criada pelo usuário) e `M|chave|id` (o texto `chave` foi movido para a situação `id`). Forma canônica: todas as S, depois
   * as M na ordem do registro; mover um texto de volta à situação de origem apaga a linha M. O `T()` nunca lê isto.
   */
  const CHAVE_ORGANIZACAO = '_organizacao';
  const MAX_SITUACOES = 20;
  const MAX_NOME_SITUACAO = 60;
  const ORGANIZACAO_PADRAO = Object.freeze(Object.keys(BLOCOS).map((id) => `S|${id}|${BLOCOS[id]}`));
  const DEF_ORGANIZACAO = Object.freeze({
    chave: CHAVE_ORGANIZACAO, bloco: 0, titulo: 'Organização das situações', quando: '', variaveis: [], semGlobais: true, rodizio: false, maxItens: MAX_SITUACOES + REGISTRO.length,
    pergunta: 'livre', exigir: [], evitar: [], semDesativar: true, organizacao: true,
    formas: [Object.freeze({ id: 'unico', rotulo: 'Organização', padrao: ORGANIZACAO_PADRAO })],
  });
  const POR_CHAVE = new Map([...REGISTRO.map((d) => [d.chave, d]), [CHAVE_ORGANIZACAO, DEF_ORGANIZACAO]]);
  const RE_ID_SITUACAO = /^(?:[1-5]|n\d{1,4})$/;
  const RE_VARIAVEL = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

  const util = () => window.__smartTableUtil;

  /** O estado padrão de um texto: ligado, com o nome e a nota que o registro traz. */
  const estadoPadrao = (def) => ['1', def.titulo, def.quando];
  const ehEstado = (formaId) => formaId === FORMA_ESTADO;
  /** A forma do registro, ou o estado (que não está em `formas`). `padrao` é o que `padrao()` devolve. */
  const formaDe = (def, formaId) => (ehEstado(formaId) ? { id: FORMA_ESTADO, padrao: estadoPadrao(def) } : def.formas.find((f) => f.id === formaId));
  const formaConhecida = (def, formaId) => !!formaDe(def, formaId);

  /* ---------------------------------------------------------------------
   * VALIDAÇÃO (usada na leitura do catálogo salvo e, na R2, pelo editor ao publicar)
   * --------------------------------------------------------------------- */
  const variaveisPermitidas = (def, formaId) => {
    const f = def.formas.find((x) => x.id === formaId);
    return new Set([...(f?.variaveis ?? def.variaveis), ...(def.semGlobais ? [] : VARIAVEIS_GLOBAIS)]);
  };

  /** As variáveis que ESTA forma aceita (as dela + as globais, menos nos textos `semGlobais`), na ordem em que o editor as oferece. */
  function variaveisDaForma(chave, formaId = 'unico') {
    const def = POR_CHAVE.get(chave);
    if (!def || !def.formas.some((f) => f.id === formaId)) return null;
    return Object.freeze([...variaveisPermitidas(def, formaId)]);
  }

  function placeholdersDe(texto) {
    const nomes = [];
    String(texto).replace(RE_VARIAVEL, (_, nome) => { nomes.push(nome); return ''; });
    return nomes;
  }

  /**
   * @param {string} [formaId] a forma do registro (as variáveis permitidas são por forma); sem ela vale a lista do texto.
   * @returns {{erros: string[], avisos: string[]}} problemas de UM texto de uma forma do registro.
   */
  function validarTexto(def, texto, formaId) {
    const erros = [];
    const avisos = [];
    if (typeof texto !== 'string') return { erros: ['o texto não é texto'], avisos };
    const limpo = texto.trim();
    if (!limpo) erros.push('texto vazio');
    if (texto.length > MAX_CARACTERES) erros.push(`passa de ${MAX_CARACTERES} caracteres`);
    if (/[\r\n]/.test(texto)) erros.push('tem quebra de linha');
    const restante = texto.replace(RE_VARIAVEL, '');
    if (/\{\{|\}\}/.test(restante)) erros.push('tem {{ }} mal fechado');
    // Endereço de internet e e-mail não vão numa mensagem de cobrança escrita aqui (o catálogo é texto da empresa; link e contato mudam por cliente).
    if (/(?:https?:\/\/|www\.)\S/i.test(restante) || /[^\s@]+@[^\s@]+\.[^\s@]/.test(restante)) erros.push('não coloque endereço de internet nem e-mail no texto');
    const permitidas = variaveisPermitidas(def, formaId);
    placeholdersDe(texto).forEach((nome) => {
      if (!permitidas.has(nome)) erros.push(`variável não permitida neste texto: {{${nome}}}`);
    });
    if (def.pergunta === 'obrigatoria' && !texto.includes('?')) erros.push('precisa ser uma pergunta (ter "?")');
    if (def.pergunta === 'proibida' && texto.includes('?')) erros.push('não pode ter pergunta (a pergunta final da mensagem já cumpre esse papel)');
    def.exigir.forEach((r) => { if (!r.padrao.test(texto)) erros.push(`regra: ${r.motivo}`); });
    def.evitar.forEach((r) => {
      if (r.padrao.test(texto)) (r.nivel === 'erro' ? erros : avisos).push(`${r.nivel === 'erro' ? 'regra' : 'atenção'}: ${r.motivo}`);
    });
    return { erros, avisos };
  }

  /** Valida o ESTADO `[ativo, nome, nota]`: nome com 1 a MAX_NOME caracteres, nota com até MAX_NOTA_TEXTO, os dois numa linha só; texto "semDesativar" não desliga. */
  function validarEstado(def, lista) {
    const erros = [];
    if (!Array.isArray(lista) || lista.length !== 3 || !lista.every((x) => typeof x === 'string')) return { erros: ['estado do texto em formato inválido'], avisos: [] };
    const [ativo, nome, nota] = lista;
    if (ativo !== '1' && ativo !== '0') erros.push('estado do texto em formato inválido');
    if (ativo === '0' && def.semDesativar) erros.push('este texto é um pedaço de frase e não pode ser desativado');
    if (!nome.trim()) erros.push('o nome não pode ficar vazio');
    if (nome.length > MAX_NOME) erros.push(`o nome passa de ${MAX_NOME} caracteres`);
    if (nota.length > MAX_NOTA_TEXTO) erros.push(`a nota passa de ${MAX_NOTA_TEXTO} caracteres`);
    if (/[\r\n]/.test(nome) || /[\r\n]/.test(nota)) erros.push('o nome e a nota têm de ficar numa linha só');
    return { erros, avisos: [] };
  }

  /**
   * Lê as linhas da organização (sem validar): `{ situacoes: [{ id, nome, base }], movidos: { chave: id } }`. Linha que não entende é ignorada
   * (quem confere é `validarOrganizacao`); o nome é tudo depois do segundo `|`.
   */
  function organizacaoDe(lista) {
    const situacoes = [];
    const movidos = Object.create(null);
    (Array.isArray(lista) ? lista : []).forEach((linha) => {
      if (typeof linha !== 'string') return;
      const partes = linha.split('|');
      if (partes[0] === 'S' && partes.length >= 3) situacoes.push({ id: partes[1], nome: partes.slice(2).join('|'), base: /^[1-5]$/.test(partes[1]) });
      else if (partes[0] === 'M' && partes.length === 3) movidos[partes[1]] = partes[2];
    });
    return { situacoes, movidos };
  }

  /** O inverso: as linhas canônicas (todas as S, depois as M na ordem do registro). */
  function listaDaOrganizacao({ situacoes, movidos }) {
    return [
      ...situacoes.map((s) => `S|${s.id}|${s.nome}`),
      ...REGISTRO.filter((d) => movidos[d.chave] !== undefined).map((d) => `M|${d.chave}|${movidos[d.chave]}`),
    ];
  }

  /** A situação (id) em que o texto de `def` aparece, dada a organização lida: a que ele foi movido ou a de origem. */
  const situacaoDoTexto = (def, org) => org.movidos[def.chave] ?? String(def.bloco);

  /** Valida as linhas da organização. Só a ESTRUTURA e os nomes; apagar só situação vazia é garantido pelo editor (a linha M de um texto sempre aponta para uma situação que existe). */
  function validarOrganizacao(lista) {
    const erros = [];
    if (!Array.isArray(lista) || lista.length === 0 || !lista.every((l) => typeof l === 'string')) return { erros: ['organização em formato inválido'], avisos: [] };
    if (lista.length > DEF_ORGANIZACAO.maxItens) return { erros: ['organização grande demais'], avisos: [] };
    const ids = new Set();
    const nomes = new Set();
    const movidas = new Set();
    const movimentos = [];
    lista.forEach((linha) => {
      const partes = linha.split('|');
      if (partes[0] === 'S' && partes.length >= 3) {
        const id = partes[1];
        const nome = partes.slice(2).join('|');
        if (!RE_ID_SITUACAO.test(id)) { erros.push('situação com identificador inválido'); return; }
        if (ids.has(id)) erros.push('situação repetida');
        ids.add(id);
        if (!nome.trim()) erros.push('o nome da situação não pode ficar vazio');
        if (nome !== nome.trim() || /\s{2,}/.test(nome)) erros.push('o nome da situação tem espaços sobrando');
        if (nome.length > MAX_NOME_SITUACAO) erros.push(`o nome da situação passa de ${MAX_NOME_SITUACAO} caracteres`);
        if (/[\r\n]/.test(nome)) erros.push('o nome da situação tem de ficar numa linha só');
        if (/(?:https?:\/\/|www\.)\S/i.test(nome) || /[^\s@]+@[^\s@]+\.[^\s@]/.test(nome)) erros.push('não coloque endereço de internet nem e-mail no nome da situação');
        const chaveNome = nome.trim().toLowerCase();
        if (nomes.has(chaveNome)) erros.push('duas situações com o mesmo nome');
        nomes.add(chaveNome);
      } else if (partes[0] === 'M' && partes.length === 3) {
        movimentos.push(partes);
      } else {
        erros.push('linha da organização em formato inválido');
      }
    });
    if (ids.size > MAX_SITUACOES) erros.push(`mais de ${MAX_SITUACOES} situações`);
    Object.keys(BLOCOS).forEach((id) => { if (!ids.has(id)) erros.push('as situações que já existem não podem ser apagadas'); });
    movimentos.forEach(([, chave, id]) => {
      const def = REGISTRO.find((d) => d.chave === chave);
      if (!def) { erros.push('texto movido não existe'); return; }
      if (!ids.has(id)) erros.push('texto movido para uma situação que não existe');
      if (movidas.has(chave)) erros.push('texto movido duas vezes');
      movidas.add(chave);
      if (id === String(def.bloco)) erros.push('texto movido para a situação onde já está');
    });
    return { erros: [...new Set(erros)], avisos: [] };
  }

  /** Valida a lista de textos (variantes) de uma forma: TODAS as variantes precisam passar. */
  function validarLista(def, lista, formaId) {
    if (ehEstado(formaId)) return validarEstado(def, lista);
    if (def.organizacao) return validarOrganizacao(lista);
    if (!Array.isArray(lista) || lista.length === 0) return { erros: ['a forma não tem texto'], avisos: [] };
    const max = def.rodizio ? MAX_VARIANTES : 1;
    // Estourou o limite: nem percorre (uma lista gigante não pode travar a leitura).
    if (lista.length > max) return { erros: [def.rodizio ? `mais de ${MAX_VARIANTES} variantes` : 'este texto não tem variantes: só um texto'], avisos: [] };
    const erros = [];
    const avisos = [];
    lista.forEach((texto, i) => {
      const r = validarTexto(def, texto, formaId);
      const prefixo = lista.length > 1 ? `variante ${i + 1}: ` : '';
      r.erros.forEach((e) => erros.push(prefixo + e));
      r.avisos.forEach((a) => avisos.push(prefixo + a));
    });
    return { erros, avisos };
  }

  /* ---------------------------------------------------------------------
   * LEITURA DO CATÁLOGO SALVO (com cache pelo texto bruto e validação por forma)
   * --------------------------------------------------------------------- */
  let cache = { bruto: Symbol('nunca-lido'), resultado: null };
  const jaAvisou = new Set();

  function avisarUmaVez(codigo, mensagem, aoUsuario) {
    if (jaAvisou.has(codigo)) return;
    jaAvisou.add(codigo);
    // O aviso nunca pode derrubar a leitura (e com ela o Alt+A): console ou toast quebrados são ignorados.
    try {
      console.warn(`[Catálogo] ${mensagem}`);
      if (aoUsuario) util()?.toast?.(aoUsuario, 9000);
    } catch (_) { /* sem aviso, mas a mensagem sai com o padrão */ }
  }

  /** Congela objetos e listas em toda a profundidade (expressões regulares ficam como estão). */
  function congelarProfundo(o) {
    if (o && typeof o === 'object' && !(o instanceof RegExp) && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(congelarProfundo);
    }
    return o;
  }

  const vazio = (estado) => congelarProfundo({ estado, publicado: Object.create(null), invalidos: [], rev: 0, rascunho: null, rascunhoInvalidos: [], historico: [] });

  const ehObjeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const temPropria = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /** `o[k]` é objeto E é do próprio `o` (um protótipo poluído não conta). */
  const objetoProprio = (o, k) => temPropria(o, k) && ehObjeto(o[k]);
  /** Número de revisão salvo: inteiro >= 0, senão 0 (catálogos antigos ou editados à mão). */
  const revDe = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  /**
   * O esquema salvo é MAIS NOVO que este código (só leitura, nada é sobrescrito): número maior que o conhecido, ou texto que é esse número
   * ("2"). Qualquer outra coisa que não seja a versão 1 (objeto, lista, 0, negativo, texto sem número...) é lixo: "ilegível".
   */
  const ehVersaoNova = (v) => (typeof v === 'number' && v > VERSAO_ESQUEMA) || (typeof v === 'string' && Number(v) > VERSAO_ESQUEMA);

  /**
   * @returns {{estado: 'ausente'|'ok'|'ilegivel'|'versao-nova'|'sem-armazenamento', publicado: Object, invalidos: Array<{chave: string, forma: string, motivo: string}>,
   *   rev: number, rascunho: ({baseRev: number, textos: Object}|null), rascunhoInvalidos: Array<{chave: string, forma: string, motivo: string}>}}
   *   `publicado`: só as formas JÁ VALIDADAS ({ chave: { forma: [texto...] } }); o resto usa o padrão. Resultado imutável.
   *   `rascunho`: o que o editor guardou (só a ESTRUTURA é conferida; as regras de conteúdo ficam para o publicar). O Alt+A não o lê.
   *   `historico`: as últimas publicações, da mais nova para a mais velha: `{ rev, em, nota, antes, depois }` (`antes` e `depois`: `{ chave: { forma: [texto...] | null } }`, só as formas
   *   que mudaram; `null` = o texto padrão). Entrada de formato estranho é descartada. O Alt+A não o lê.
   *   Nunca lança: o que o JSON salvo tiver de estranho cai em 'ilegivel' (o Alt+A segue com o padrão).
   */
  function lerCatalogo() {
    let bruto = null;
    try {
      bruto = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
    } catch (_) {
      return vazio('sem-armazenamento');
    }
    if (bruto === cache.bruto) return cache.resultado;
    let resultado;
    try {
      resultado = interpretar(bruto);
    } catch (_) {
      avisarUmaVez('ilegivel', 'O catálogo de mensagens salvo não pôde ser lido: usando os textos padrão.', 'Catálogo de mensagens ilegível: usando os textos padrão.');
      resultado = vazio('ilegivel');
    }
    cache = { bruto, resultado };
    return resultado;
  }

  function interpretar(bruto) {
    if (bruto === null || bruto === '') return vazio('ausente');
    let dados;
    try {
      dados = JSON.parse(bruto);
    } catch (_) {
      dados = null;
    }
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
      avisarUmaVez('ilegivel', 'O catálogo de mensagens salvo não pôde ser lido: usando os textos padrão.', 'Catálogo de mensagens ilegível: usando os textos padrão.');
      return vazio('ilegivel');
    }
    // O valor de `versao` NÃO vai para a mensagem: vem do JSON salvo (dado do usuário) e nem sempre é texto.
    if (ehVersaoNova(dados.versao)) {
      avisarUmaVez('versao-nova', 'O catálogo de mensagens salvo é de outra versão: usando os textos padrão.', 'Catálogo de mensagens de outra versão: usando os textos padrão.');
      return vazio('versao-nova');
    }
    if (dados.versao !== VERSAO_ESQUEMA) {
      avisarUmaVez('ilegivel', 'O catálogo de mensagens salvo não pôde ser lido: usando os textos padrão.', 'Catálogo de mensagens ilegível: usando os textos padrão.');
      return vazio('ilegivel');
    }
    const publicado = Object.create(null);
    const invalidos = [];
    const salvo = dados.publicado && typeof dados.publicado === 'object' && !Array.isArray(dados.publicado) ? dados.publicado : {};
    // Chave e forma desconhecidas vêm do JSON salvo: ficam fora do console e do toast (só o motivo aparece).
    const chaves = Object.keys(salvo);
    if (chaves.length > MAX_CHAVES_SALVAS) invalidos.push({ chave: '', forma: '', motivo: `mais de ${MAX_CHAVES_SALVAS} textos no catálogo salvo: o excesso foi ignorado` });
    chaves.slice(0, MAX_CHAVES_SALVAS).forEach((chave) => {
      const def = POR_CHAVE.get(chave);
      if (!def) { invalidos.push({ chave: '', forma: '', motivo: 'chave desconhecida' }); return; }
      const formasSalvas = salvo[chave];
      if (!formasSalvas || typeof formasSalvas !== 'object' || Array.isArray(formasSalvas)) {
        invalidos.push({ chave, forma: '', motivo: 'formato inválido' });
        return;
      }
      Object.keys(formasSalvas).slice(0, MAX_FORMAS_SALVAS).forEach((formaId) => {
        if (!formaConhecida(def, formaId)) { invalidos.push({ chave, forma: '', motivo: 'forma desconhecida' }); return; }
        const r = validarLista(def, formasSalvas[formaId], formaId);
        if (r.erros.length > 0) { invalidos.push({ chave, forma: formaId, motivo: r.erros[0] }); return; }
        (publicado[chave] ||= Object.create(null))[formaId] = [...formasSalvas[formaId]];
      });
    });
    invalidos.forEach((i) => avisarUmaVez(
      `invalido:${i.chave}:${i.forma}:${i.motivo}`,
      `${i.chave ? `Texto "${i.chave}${i.forma ? ` (${i.forma})` : ''}"` : 'Catálogo salvo'} inválido (${i.motivo}): usando o padrão.`,
      `Um texto do catálogo de mensagens é inválido${i.chave ? ` (${i.chave})` : ''}: usei o padrão dele.`,
    ));
    const historico = lerHistorico(dados.historico);
    const { rascunho, rascunhoInvalidos } = lerRascunho(dados.rascunho);
    rascunhoInvalidos.forEach((i) => avisarUmaVez(`rascunho:${i.chave}:${i.forma}:${i.motivo}`,
      `Rascunho${i.chave ? ` de "${i.chave}${i.forma ? ` (${i.forma})` : ''}"` : ''} ignorado (${i.motivo}).`));
    return congelarProfundo({ estado: 'ok', publicado, invalidos, rev: revDe(dados.rev), rascunho, rascunhoInvalidos, historico });
  }

  /** O formato de UMA lista de rascunho (a mesma regra na leitura e na gravação): 1 a N textos (N = 12 com rodízio, 1 sem), cada um com até 2000 caracteres. */
  function formatoDoRascunhoOk(def, lista, formaId) {
    if (ehEstado(formaId)) return Array.isArray(lista) && lista.length === 3 && lista.every((t) => typeof t === 'string' && t.length <= MAX_CARACTERES_RASCUNHO);
    const max = def.maxItens ?? (def.rodizio ? MAX_VARIANTES : 1);
    return Array.isArray(lista) && lista.length >= 1 && lista.length <= max && lista.every((t) => typeof t === 'string' && t.length <= MAX_CARACTERES_RASCUNHO);
  }

  /**
   * O rascunho salvo: `{ baseRev, textos: { chave: { forma: [texto...] } } }`. Só a estrutura é conferida (chave e forma do registro,
   * lista de textos, tamanho); o conteúdo pode estar incompleto ou inválido, é para isso que ele existe.
   * Chave e forma desconhecidas vêm do JSON salvo: ficam fora do console (só o motivo).
   */
  function lerRascunho(bruto) {
    const rascunhoInvalidos = [];
    if (!ehObjeto(bruto)) return { rascunho: null, rascunhoInvalidos };
    if (!ehObjeto(bruto.textos)) {
      rascunhoInvalidos.push({ chave: '', forma: '', motivo: 'formato inválido' });
      return { rascunho: null, rascunhoInvalidos };
    }
    const textos = Object.create(null);
    const chaves = Object.keys(bruto.textos);
    if (chaves.length > MAX_CHAVES_SALVAS) rascunhoInvalidos.push({ chave: '', forma: '', motivo: `mais de ${MAX_CHAVES_SALVAS} textos: o excesso foi ignorado` });
    chaves.slice(0, MAX_CHAVES_SALVAS).forEach((chave) => {
      const def = POR_CHAVE.get(chave);
      if (!def) { rascunhoInvalidos.push({ chave: '', forma: '', motivo: 'chave desconhecida' }); return; }
      if (!ehObjeto(bruto.textos[chave])) { rascunhoInvalidos.push({ chave, forma: '', motivo: 'formato inválido' }); return; }
      Object.keys(bruto.textos[chave]).slice(0, MAX_FORMAS_SALVAS).forEach((formaId) => {
        if (!formaConhecida(def, formaId)) { rascunhoInvalidos.push({ chave, forma: '', motivo: 'forma desconhecida' }); return; }
        const lista = bruto.textos[chave][formaId];
        if (!formatoDoRascunhoOk(def, lista, formaId)) { rascunhoInvalidos.push({ chave, forma: formaId, motivo: 'formato inválido' }); return; }
        (textos[chave] ||= Object.create(null))[formaId] = [...lista];
      });
    });
    if (Object.keys(textos).length === 0) return { rascunho: null, rascunhoInvalidos };
    return { rascunho: { baseRev: revDe(bruto.baseRev), textos }, rascunhoInvalidos };
  }

  /**
   * Um lado ("antes" ou "depois") de uma publicação: `{ chave: { forma: [texto...] | null } }`, com chave e forma do registro (`null` = o padrão).
   * Qualquer coisa fora do formato invalida o lado inteiro (devolve null): o histórico é só registro, nunca vale pela metade.
   */
  function lerLadoDoHistorico(bruto) {
    if (!bruto) return null;
    const lado = Object.create(null);
    let formas = 0;
    for (const chave of Object.keys(bruto)) {
      const def = POR_CHAVE.get(chave);
      if (!def || !bruto[chave]) return null;
      lado[chave] = Object.create(null);
      for (const formaId of Object.keys(bruto[chave])) {
        if (!formaConhecida(def, formaId)) return null;
        const lista = bruto[chave][formaId];
        if (lista !== null && !formatoDoRascunhoOk(def, lista, formaId)) return null;
        lado[chave][formaId] = lista;
        formas += 1;
      }
    }
    return formas > 0 ? lado : null; // um lado sem nenhuma forma não registra mudança nenhuma
  }

  /**
   * O histórico salvo: da publicação mais nova para a mais velha, no máximo MAX_HISTORICO. Entrada inválida (revisão, hora, lados) ou com a
   * revisão repetida é descartada; a nota vira texto de uma linha com até MAX_NOTA caracteres. Nunca lança.
   */
  function lerHistorico(bruto) {
    if (!Array.isArray(bruto)) return [];
    const entradas = [];
    for (const e of bruto) {
      if (!ehObjeto(e) || !Number.isInteger(e.rev) || e.rev < 1 || !Number.isFinite(e.em) || e.em < 0) continue;
      const antes = lerLadoDoHistorico(e.antes);
      const depois = lerLadoDoHistorico(e.depois);
      if (!antes || !depois) continue;
      entradas.push({ rev: e.rev, em: e.em, nota: textoDaNota(e.nota), antes, depois });
    }
    entradas.sort((a, b) => b.rev - a.rev);
    return entradas.filter((e, i) => i === 0 || e.rev !== entradas[i - 1].rev).slice(0, MAX_HISTORICO);
  }

  /** A nota de uma publicação: uma linha só, sem espaços sobrando, com até MAX_NOTA caracteres (não-texto vira vazio). */
  const textoDaNota = (nota) => (typeof nota === 'string' ? nota.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTA) : '');

  /* ---------------------------------------------------------------------
   * MOTOR
   * --------------------------------------------------------------------- */
  const defDe = (chave) => POR_CHAVE.get(chave) ?? null;

  /** O texto PADRÃO (embutido) de uma forma: lista congelada de variantes. */
  function padrao(chave, formaId = 'unico') {
    const def = defDe(chave);
    const f = def ? formaDe(def, formaId) : null;
    return f ? Object.freeze([...f.padrao]) : null;
  }

  /**
   * MODO PRÉVIA: só vale DENTRO de uma chamada síncrona de `comRascunho` (o editor, na prévia da mensagem). O Alt+A nunca o liga,
   * então nunca lê rascunho. `rascunhoDaPrevia` = { chave: { forma: [texto...] } } ou null.
   */
  let rascunhoDaPrevia = null;
  /** O catálogo salvo, lido UMA vez ao entrar na prévia (dentro dela nada o muda: a chamada é síncrona). */
  let catalogoDaPrevia = null;
  /** Variante forçada por texto na prévia: { chave: índice }. Só vale dentro da prévia; ausente = o rodízio normal (pela semente). */
  let variantesDaPrevia = null;

  /**
   * Foto do rascunho que a prévia recebeu, tirada ao entrar: só chave e forma PRÓPRIAS, só listas de textos (o resto é ignorado), listas
   * COPIADAS (a foto é privada do módulo: nada a congelar). Quem chamou pode seguir mexendo no objeto dele sem mudar a montagem em andamento, e um
   * protótipo poluído não entra.
   */
  function fotografarRascunho(textos) {
    if (!ehObjeto(textos)) return null;
    const foto = Object.create(null);
    Object.keys(textos).forEach((chave) => {
      if (!ehObjeto(textos[chave])) return;
      Object.keys(textos[chave]).forEach((formaId) => {
        const lista = textos[chave][formaId];
        if (!Array.isArray(lista) || lista.length === 0 || !lista.every((t) => typeof t === 'string')) return;
        (foto[chave] ||= Object.create(null))[formaId] = [...lista];
      });
    });
    return foto;
  }

  /** Foto das variantes forçadas: índices inteiros >= 0 ou 'maior' (a frase mais longa da lista: o "Pior caso" da prévia), de chaves PRÓPRIAS do objeto. */
  function fotografarVariantes(variantes) {
    if (!ehObjeto(variantes)) return null;
    const foto = Object.create(null);
    Object.keys(variantes).forEach((chave) => {
      if (variantes[chave] === 'maior' || (Number.isInteger(variantes[chave]) && variantes[chave] >= 0)) foto[chave] = variantes[chave];
    });
    return foto;
  }

  /** O texto da prévia para uma forma, ou null. */
  const textosDaPrevia = (chave, formaId) => rascunhoDaPrevia?.[chave]?.[formaId] ?? null;

  /** O que está VALENDO de verdade para o Alt+A: o publicado válido ou o padrão (nunca o rascunho da prévia). */
  function textosEmUsoReal(chave, formaId, cat = catalogoDaPrevia ?? lerCatalogo()) {
    const publicado = cat.publicado[chave]?.[formaId];
    return publicado ?? padrao(chave, formaId);
  }

  /** As variantes em uso (na prévia: o rascunho, se houver; senão o publicado válido; senão o padrão). */
  function textosEmUso(chave, formaId, cat) {
    return textosDaPrevia(chave, formaId) ?? textosEmUsoReal(chave, formaId, cat);
  }

  /**
   * Roda `fn` (SÍNCRONA) com o rascunho valendo no `T()`: precedência rascunho > publicado > padrão. Serve à prévia da mensagem do editor.
   * Volta ao normal sempre, mesmo se `fn` lançar; aninhado, volta ao rascunho de fora quando o de dentro termina. Não grava nada.
   * Um aninhado com `textos` que não é objeto (null, undefined, lixo) DESLIGA o rascunho lá dentro: não herda o de fora.
   * O rascunho entra como está (mesmo incompleto ou inválido: a prévia mostra o que o usuário digitou). Entrada que não é lista de
   * textos é ignorada (vale o publicado ou o padrão daquela forma).
   * `fn` assíncrona (devolver uma Promise) é erro de programação: o modo prévia acaba quando `fn` devolve, e o que rodasse depois do
   * primeiro `await` não veria o rascunho (a "prévia" sairia igual ao "antes", calada). Por isso lança.
   * `opcoes.variantes` = { chave: índice (inteiro >= 0) }: força a variante do rodízio mostrada nesses textos (o índice dá a volta se a
   * lista for menor); sem ele, o rodízio normal pela semente. Vale para o texto em uso e para o rascunho. Entrada que não é índice é ignorada.
   * @param {Object|null} textos { chave: { forma: [texto...] } }
   * @param {() => *} fn
   * @param {{variantes?: Object}} [opcoes]
   */
  function comRascunho(textos, fn, opcoes) {
    const anterior = rascunhoDaPrevia;
    const catalogoAnterior = catalogoDaPrevia;
    const variantesAnterior = variantesDaPrevia;
    rascunhoDaPrevia = fotografarRascunho(textos);
    variantesDaPrevia = fotografarVariantes(opcoes?.variantes);
    catalogoDaPrevia = lerCatalogo();
    try {
      const resultado = fn();
      if (resultado && typeof resultado.then === 'function') throw new TypeError('comRascunho: a função precisa ser síncrona (devolveu uma Promise)');
      return resultado;
    } finally {
      rascunhoDaPrevia = anterior;
      catalogoDaPrevia = catalogoAnterior;
      variantesDaPrevia = variantesAnterior;
    }
  }

  /** Quando a prévia pede, guarda as chaves dos textos desativados que a montagem tentou usar (para avisar "este trecho está desativado"). */
  let coletorDeDesativados = null;
  /** Textos que a prévia deve tratar como ATIVOS mesmo desativados (serve a "este trecho muda a mensagem?"). */
  let forcadosAtivos = null;
  /** Roda `fn` (síncrona) com os textos `chaves` ligados, mesmo que estejam desativados (nada é gravado). */
  function comTextosAtivos(chaves, fn) {
    const anterior = forcadosAtivos;
    forcadosAtivos = new Set(chaves);
    try {
      return fn();
    } finally {
      forcadosAtivos = anterior;
    }
  }

  /** Roda `fn` (síncrona) coletando os textos desativados que `T` devolveu vazios. @returns {{resultado: *, desativados: string[]}} */
  function comColetaDeDesativados(fn) {
    const anterior = coletorDeDesativados;
    const meu = new Set();
    coletorDeDesativados = meu;
    try {
      return { resultado: fn(), desativados: [...meu] };
    } finally {
      coletorDeDesativados = anterior;
    }
  }

  function substituir(texto, vars) {
    return texto.replace(RE_VARIAVEL, (trecho, nome) => {
      if (Object.prototype.hasOwnProperty.call(vars, nome) && vars[nome] !== null && vars[nome] !== undefined) return String(vars[nome]);
      return trecho; // fica para a substituição final do Módulo 19 (variáveis do cliente); se ninguém resolver, ela avisa
    });
  }

  /**
   * O texto de uma forma, com as variáveis trocadas.
   * @param {string} chave
   * @param {{forma?: string, vars?: Object, semente?: string|(() => string)}} [opcoes]
   *   `semente`: escolhe a variante nos textos com rodízio; função = só é chamada quando há mais de uma variante.
   * @returns {string} '' (com erro no console) só para chave ou forma que NÃO existe no registro: erro de programação.
   */
  function T(chave, { forma: formaId = 'unico', vars = {}, semente } = {}) {
    const cat = catalogoDaPrevia ?? lerCatalogo(); // UMA leitura por T (a mesma para o texto e para o estado)
    const lista = textosEmUso(chave, formaId, cat);
    // Desativado (só vale em texto que pode ser desativado): a mensagem sai sem este trecho.
    if (lista && !defDe(chave).semDesativar && !forcadosAtivos?.has(chave) && textosEmUso(chave, FORMA_ESTADO, cat)?.[0] === '0') {
      coletorDeDesativados?.add(chave);
      return '';
    }
    if (!lista) {
      console.error(`[Catálogo] Texto "${chave}" (forma "${formaId}") não existe no registro.`);
      return '';
    }
    let texto = lista[0];
    if (lista.length > 1) {
      const escolher = util()?.escolherVariante;
      const forcada = variantesDaPrevia?.[chave];
      if (forcada === 'maior') {
        texto = lista.reduce((m, f) => (f.length > m.length ? f : m), lista[0]); // "Pior caso": a frase mais longa (empate: a primeira)
      } else if (forcada !== undefined) {
        texto = lista[forcada % lista.length]; // prévia: o usuário escolheu qual variante ver (o índice dá a volta se a lista for menor)
      } else {
        texto = typeof escolher === 'function'
          ? escolher(typeof semente === 'function' ? semente() : (semente ?? ''), lista)
          : lista[0];
      }
    }
    return substituir(texto, vars);
  }

  /* ---------------------------------------------------------------------
   * RASCUNHO: gravação (só o editor chama; o Alt+A nunca lê o rascunho)
   * ---------------------------------------------------------------------
   * Cada gravação RELÊ o catálogo salvo, muda só a entrada do rascunho e grava de volta: o publicado, a revisão, o histórico e
   * qualquer campo que não conhecemos ficam como estavam (a outra aba pode ter publicado enquanto este editor estava aberto).
   * Retorna sempre `{ ok: true, ... }` ou `{ ok: false, motivo }`, e nada fica pela metade: o catálogo é gravado numa chamada só.
   * Motivos: 'sem-armazenamento', 'versao-nova' (esquema mais novo que este código: só leitura), 'cota' (não coube ou o navegador
   * recusou), 'texto-desconhecido', 'formato'. Nenhum texto digitado vai para o console.
   */
  const novoCatalogo = () => ({ versao: VERSAO_ESQUEMA, rev: 0, publicado: {} });

  /** O catálogo salvo, pronto para mudar: `{ dados, preservar }` (preservar = o texto ilegível a guardar antes de sobrescrever) ou `{ erro }`. */
  function carregarParaEscrita() {
    let bruto = null;
    try {
      bruto = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
    } catch (_) {
      return { erro: 'sem-armazenamento' };
    }
    if (bruto === null || bruto === '') return { dados: novoCatalogo(), preservar: null };
    let dados = null;
    try {
      dados = JSON.parse(bruto);
    } catch (_) {
      dados = null;
    }
    if (ehObjeto(dados)) {
      if (ehVersaoNova(dados.versao)) return { erro: 'versao-nova' };
      if (dados.versao === VERSAO_ESQUEMA) return { dados, preservar: null };
    }
    return { dados: novoCatalogo(), preservar: bruto }; // ilegível: começa um novo, guardando o original
  }

  /** Guarda o original ilegível sob outra chave (nunca apaga; o mesmo conteúdo não é guardado duas vezes). Lança se não couber. */
  function guardarOriginalIlegivel(bruto) {
    const armazenamento = window.localStorage;
    const existentes = [];
    for (let i = 0; i < armazenamento.length; i += 1) {
      const k = armazenamento.key(i);
      if (typeof k === 'string' && k.startsWith(PREFIXO_ILEGIVEL)) existentes.push(k);
    }
    if (existentes.some((k) => armazenamento.getItem(k) === bruto)) return;
    let n = Date.now();
    while (existentes.includes(`${PREFIXO_ILEGIVEL}${n}`)) n += 1;
    armazenamento.setItem(`${PREFIXO_ILEGIVEL}${n}`, bruto);
  }

  function gravarCatalogo(dados, preservar) {
    try {
      if (preservar !== null) guardarOriginalIlegivel(preservar);
      window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(dados));
      return true;
    } catch (_) {
      return false;
    }
  }

  const iguais = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((t, i) => t === b[i]);

  /**
   * Guarda o rascunho de UMA forma. Um rascunho igual ao texto em uso (publicado ou padrão) não é rascunho: é retirado.
   * @param {string} chave @param {string} formaId @param {string[]} lista as variantes (1 só nos textos sem rodízio)
   * @returns {{ok: true, removido: boolean}|{ok: false, motivo: string}}
   */
  function salvarRascunho(chave, formaId, lista) {
    const def = defDe(chave);
    if (!def || !formaConhecida(def, formaId)) return { ok: false, motivo: 'texto-desconhecido' };
    if (!formatoDoRascunhoOk(def, lista, formaId)) return { ok: false, motivo: 'formato' };
    // Compara com o que vale DE VERDADE (publicado ou padrão), mesmo se chamada de dentro de uma prévia.
    return alterarRascunho(chave, formaId, iguais(lista, textosEmUsoReal(chave, formaId)) ? null : [...lista]);
  }

  /** Descarta o rascunho de uma forma (sem rascunho nela: nada é gravado). */
  function descartarRascunho(chave, formaId) {
    const def = defDe(chave);
    if (!def || !formaConhecida(def, formaId)) return { ok: false, motivo: 'texto-desconhecido' };
    return alterarRascunho(chave, formaId, null);
  }

  /** Descarta o rascunho inteiro. */
  function descartarRascunhoTudo() {
    const carga = carregarParaEscrita();
    if (carga.erro) return { ok: false, motivo: carga.erro };
    if (!ehObjeto(carga.dados) || !temPropria(carga.dados, 'rascunho')) return { ok: true, removido: false };
    delete carga.dados.rascunho;
    return gravarCatalogo(carga.dados, carga.preservar) ? { ok: true, removido: true } : { ok: false, motivo: 'cota' };
  }

  /** `lista` null = retirar a forma do rascunho. */
  function alterarRascunho(chave, formaId, lista) {
    const carga = carregarParaEscrita();
    if (carga.erro) return { ok: false, motivo: carga.erro };
    const { dados, preservar } = carga;
    let rascunho = ehObjeto(dados.rascunho) && ehObjeto(dados.rascunho.textos) ? dados.rascunho : null;
    const jaTinha = !!rascunho && objetoProprio(rascunho.textos, chave) && temPropria(rascunho.textos[chave], formaId);
    if (lista === null && !jaTinha) return { ok: true, removido: false }; // nada a retirar: nada a gravar
    if (lista !== null) {
      // A revisão em que o rascunho nasceu (o publicar usa para avisar que outra aba publicou antes).
      rascunho ||= { baseRev: revDe(dados.rev), textos: {} };
      dados.rascunho = rascunho;
      if (!objetoProprio(rascunho.textos, chave)) rascunho.textos[chave] = {};
      rascunho.textos[chave][formaId] = lista;
    } else {
      delete rascunho.textos[chave][formaId];
      if (Object.keys(rascunho.textos[chave]).length === 0) delete rascunho.textos[chave];
      if (Object.keys(rascunho.textos).length === 0) delete dados.rascunho;
    }
    return gravarCatalogo(dados, preservar) ? { ok: true, removido: lista === null } : { ok: false, motivo: 'cota' };
  }

  /* ---------------------------------------------------------------------
   * PUBLICAR, HISTÓRICO E VOLTAR VERSÃO (só o editor chama; o Alt+A só LÊ o publicado)
   * ---------------------------------------------------------------------
   * Cada publicação relê o catálogo salvo, muda só o `publicado`, a `rev`, o `rascunho` e o `historico` e grava de volta numa chamada só: nada fica pela
   * metade (cota cheia = nada muda). O histórico guarda só o que mudou (`antes` e `depois` das formas tocadas), então "o estado depois da versão X" se
   * reconstrói desfazendo as publicações mais novas; só dá para voltar às versões que ainda estão nas MAX_HISTORICO.
   * Retornos `{ ok: true, ... }` ou `{ ok: false, motivo }`. Motivos: 'sem-armazenamento', 'versao-nova', 'cota' (como no rascunho), 'nada-a-publicar',
   * 'bloqueado' (erro de CONTEÚDO em algum texto: `problemas`), 'outra-aba' (outra aba publicou depois que o rascunho nasceu: `rev` e `baseRev`;
   * `forcar: true` publica por cima), 'versao-desconhecida', 'historico-incompleto' e 'ja-e-esta' (voltar à versão que já é a em uso).
   * O tamanho da mensagem NÃO bloqueia: quem avisa é a prévia do editor.
   */

  /** Os dois lados são iguais? `null` (o padrão) só é igual a `null`. */
  const mesmoTexto = (a, b) => (a === null || b === null ? a === b : iguais(a, b));

  /** Lista igual ao padrão da forma vira `null` (o padrão não precisa ficar no publicado). */
  const comoGuardado = (chave, formaId, lista) => (lista !== null && iguais(lista, padrao(chave, formaId)) ? null : lista);

  /** O publicado de hoje (o que o Alt+A usa), para ler: `lista` ou `null` (padrão). */
  const publicadoDe = (cat, chave, formaId) => cat.publicado[chave]?.[formaId] ?? null;

  /** Erros e avisos de CONTEÚDO de uma lista de mudanças `{ chave, formaId, depois }` (só as que não voltam ao padrão). */
  function problemasDe(mudancas) {
    const problemas = [];
    const avisos = [];
    mudancas.forEach(({ chave, formaId, depois }) => {
      if (depois === null) return;
      const r = validarLista(defDe(chave), depois, formaId);
      if (r.erros.length > 0) problemas.push({ chave, forma: formaId, motivos: r.erros });
      if (r.avisos.length > 0) avisos.push({ chave, forma: formaId, motivos: r.avisos });
    });
    return { problemas, avisos };
  }

  /**
   * Aplica as mudanças ao catálogo que vai ser gravado (`dados`, lido para escrita): muda o `publicado`, sobe a `rev`, acrescenta ao histórico (só as
   * MAX_HISTORICO mais novas). `mudancas`: `[{ chave, formaId, antes, depois }]` (`null` = padrão). Devolve a revisão nova.
   */
  function aplicarPublicacao(dados, mudancas, nota) {
    const novaRev = revDe(dados.rev) + 1;
    if (!ehObjeto(dados.publicado)) dados.publicado = {};
    const antes = Object.create(null);
    const depois = Object.create(null);
    mudancas.forEach(({ chave, formaId, antes: a, depois: d }) => {
      (antes[chave] ||= Object.create(null))[formaId] = a;
      (depois[chave] ||= Object.create(null))[formaId] = d;
      if (d === null) {
        if (objetoProprio(dados.publicado, chave)) {
          delete dados.publicado[chave][formaId];
          if (Object.keys(dados.publicado[chave]).length === 0) delete dados.publicado[chave];
        }
      } else {
        if (!objetoProprio(dados.publicado, chave)) dados.publicado[chave] = {};
        dados.publicado[chave][formaId] = d;
      }
    });
    dados.rev = novaRev;
    dados.historico = [{ rev: novaRev, em: Date.now(), nota: textoDaNota(nota), antes, depois }, ...lerHistorico(dados.historico)].slice(0, MAX_HISTORICO);
    return novaRev;
  }

  /**
   * Tira do rascunho gravado o que o leitor entende (foi publicado ou é igual ao que já vale). O que ele ignorou (texto ou forma de uma versão
   * diferente do script) fica: publicar não apaga em silêncio o que não publicou. Sem nada sobrando, o rascunho some.
   */
  function retirarDoRascunho(dados) {
    const { rascunho } = lerRascunho(dados.rascunho); // (há mudança a publicar: o rascunho é válido)
    Object.keys(rascunho.textos).forEach((chave) => {
      Object.keys(rascunho.textos[chave]).forEach((formaId) => delete dados.rascunho.textos[chave][formaId]);
      if (Object.keys(dados.rascunho.textos[chave]).length === 0) delete dados.rascunho.textos[chave];
    });
    if (Object.keys(dados.rascunho.textos).length === 0) delete dados.rascunho;
  }

  /**
   * O que publicar faria AGORA, sem gravar nada: as mudanças (o rascunho que difere do texto em uso), os problemas de CONTEÚDO que bloqueiam, os avisos e a
   * revisão do catálogo e do rascunho. `carga` é o resultado de `carregarParaEscrita()` sem erro.
   */
  function planejarPublicacao({ dados }) {
    const { rascunho } = lerRascunho(dados.rascunho);
    const cat = lerCatalogo();
    const mudancas = [];
    if (rascunho) {
      Object.keys(rascunho.textos).forEach((chave) => Object.keys(rascunho.textos[chave]).forEach((formaId) => {
        const lista = rascunho.textos[chave][formaId];
        const emUso = publicadoDe(cat, chave, formaId);
        if (iguais(lista, emUso ?? padrao(chave, formaId))) return; // igual ao que já vale: não é mudança
        mudancas.push({ chave, formaId, antes: emUso, depois: comoGuardado(chave, formaId, lista) });
      }));
    }
    const { problemas, avisos } = problemasDe(mudancas);
    const revAtual = revDe(dados.rev);
    return { mudancas, problemas, avisos, revAtual, baseRev: rascunho ? rascunho.baseRev : revAtual };
  }

  /**
   * Para a tela Publicar: o que publicar faria agora, SEM gravar. `mudancas`: `[{ chave, forma, antes, depois }]` (`null` = o texto padrão), `problemas` (erros
   * de conteúdo, que bloqueiam) e `avisos` (`[{ chave, forma, motivos }]`), `rev` (a do catálogo), `baseRev` (a do rascunho) e `outraAba` (as duas diferem:
   * outra aba publicou depois que o rascunho nasceu). Sem mudança nenhuma: `{ ok: false, motivo: 'nada-a-publicar' }`; as falhas de armazenamento, como em `publicar`.
   */
  function prepararPublicacao() {
    const carga = carregarParaEscrita();
    if (carga.erro) return { ok: false, motivo: carga.erro };
    const plano = planejarPublicacao(carga);
    if (plano.mudancas.length === 0) return { ok: false, motivo: 'nada-a-publicar' };
    return {
      ok: true,
      mudancas: plano.mudancas.map(({ chave, formaId, antes, depois }) => ({ chave, forma: formaId, antes, depois })),
      problemas: plano.problemas,
      avisos: plano.avisos,
      rev: plano.revAtual,
      baseRev: plano.baseRev,
      outraAba: plano.baseRev !== plano.revAtual,
    };
  }

  /**
   * Publica o RASCUNHO inteiro: o que difere do texto em uso passa a valer no Alt+A, o rascunho é retirado e a publicação entra no histórico.
   * @param {{nota?: string, forcar?: boolean}} [opcoes] `forcar`: publica mesmo que outra aba tenha publicado depois que o rascunho nasceu
   * @returns {{ok: true, rev: number, mudancas: number, avisos: Array}|{ok: false, motivo: string, problemas?: Array, rev?: number, baseRev?: number}}
   */
  function publicar({ nota = '', forcar = false } = {}) {
    const carga = carregarParaEscrita();
    if (carga.erro) return { ok: false, motivo: carga.erro };
    const { dados, preservar } = carga;
    const { mudancas, problemas, avisos, revAtual, baseRev } = planejarPublicacao(carga);
    if (mudancas.length === 0) return { ok: false, motivo: 'nada-a-publicar' };
    if (problemas.length > 0) return { ok: false, motivo: 'bloqueado', problemas };
    if (!forcar && baseRev !== revAtual) return { ok: false, motivo: 'outra-aba', rev: revAtual, baseRev };
    const novaRev = aplicarPublicacao(dados, mudancas, nota);
    retirarDoRascunho(dados);
    return gravarCatalogo(dados, preservar) ? { ok: true, rev: novaRev, mudancas: mudancas.length, avisos } : { ok: false, motivo: 'cota' };
  }

  /**
   * Volta ao estado que valia DEPOIS da publicação `rev`: cria uma publicação NOVA (nunca apaga histórico) com a nota "Voltou para a versão N".
   * Só as formas que hoje diferem daquele estado mudam. O rascunho fica como está (o `baseRev` dele acompanha a revisão nova só se estava em dia com o catálogo).
   */
  function restaurarVersao(rev) {
    const carga = carregarParaEscrita();
    if (carga.erro) return { ok: false, motivo: carga.erro };
    const { dados, preservar } = carga;
    const historico = lerHistorico(dados.historico);
    if (!historico.some((h) => h.rev === rev)) return { ok: false, motivo: 'versao-desconhecida' };
    const revAtual = revDe(dados.rev);
    const posteriores = historico.filter((h) => h.rev > rev); // da mais nova para a mais velha
    // Para desfazer da atual até `rev`, TODAS as publicações entre as duas têm de estar no histórico.
    if (posteriores.length !== revAtual - rev || posteriores.some((h, i) => h.rev !== revAtual - i)) return { ok: false, motivo: 'historico-incompleto' };
    const cat = lerCatalogo();
    const alvo = Object.create(null); // o estado depois da versão `rev`: { chave: { forma: lista | null } }
    Object.keys(cat.publicado).forEach((chave) => {
      alvo[chave] = Object.create(null);
      Object.keys(cat.publicado[chave]).forEach((formaId) => { alvo[chave][formaId] = cat.publicado[chave][formaId]; });
    });
    posteriores.forEach((h) => Object.keys(h.antes).forEach((chave) => Object.keys(h.antes[chave]).forEach((formaId) => {
      (alvo[chave] ||= Object.create(null))[formaId] = h.antes[chave][formaId];
    })));
    const mudancas = [];
    Object.keys(alvo).forEach((chave) => Object.keys(alvo[chave]).forEach((formaId) => {
      const antes = comoGuardado(chave, formaId, publicadoDe(cat, chave, formaId));
      const depois = comoGuardado(chave, formaId, alvo[chave][formaId]);
      if (!mesmoTexto(antes, depois)) mudancas.push({ chave, formaId, antes, depois });
    }));
    if (mudancas.length === 0) return { ok: false, motivo: 'ja-e-esta' };
    // O que volta tem de passar nas regras DE HOJE (o leitor ignora texto publicado que elas recusam).
    const { problemas } = problemasDe(mudancas);
    if (problemas.length > 0) return { ok: false, motivo: 'bloqueado', problemas };
    const novaRev = aplicarPublicacao(dados, mudancas, `Voltou para a versão ${rev}`);
    // O rascunho que estava em dia com o catálogo continua em dia (foi esta aba que publicou); o de uma revisão mais velha segue acusando "outra aba".
    if (ehObjeto(dados.rascunho) && revDe(dados.rascunho.baseRev) === revAtual) dados.rascunho.baseRev = novaRev;
    return gravarCatalogo(dados, preservar) ? { ok: true, rev: novaRev, mudancas: mudancas.length } : { ok: false, motivo: 'cota' };
  }

  window.__catalogoMensagens = Object.freeze({
    T,
    padrao,
    defDe,
    lerCatalogo,
    comRascunho,
    comColetaDeDesativados,
    comTextosAtivos,
    salvarRascunho,
    descartarRascunho,
    descartarRascunhoTudo,
    prepararPublicacao,
    publicar,
    restaurarVersao,
    validarTexto,
    validarLista,
    placeholdersDe,
    variaveisDaForma,
    REGISTRO: congelarProfundo(REGISTRO),
    BLOCOS,
    CHAVE_ORGANIZACAO,
    MAX_SITUACOES,
    MAX_NOME_SITUACAO,
    organizacaoDe,
    listaDaOrganizacao,
    situacaoDoTexto,
    VARIAVEIS_GLOBAIS,
    CHAVE_ARMAZENAMENTO,
    VERSAO_ESQUEMA,
    FORMA_ESTADO,
    MAX_NOME,
    MAX_NOTA_TEXTO,
    MAX_VARIANTES,
    MAX_CARACTERES,
    MAX_CARACTERES_RASCUNHO,
    MAX_HISTORICO,
    MAX_NOTA,
    PREFIXO_ILEGIVEL,
  });

  // Só depois de montar o REGISTRO e a API: se algo acima lançar, o módulo não aparece como carregado.
  window.__smartTableUtil?.registrarModuloCarregado?.('Catálogo de Mensagens');
})();
