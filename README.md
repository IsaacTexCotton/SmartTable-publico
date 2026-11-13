# SmartTable — Automação de Cobrança (CRM TexCotton)

Scripts JavaScript injetados via **Local Overrides do Chrome DevTools** no
arquivo `smart-table.js`, servido pelo CRM interno (`texhub.texcotton.com.br`).
Automatiza o fluxo de cobrança: classifica títulos vencidos, gera relatório
visual, monta mensagem personalizada por WhatsApp, registra contato, percorre
uma fila de clientes sozinho, avisa sobre grupo econômico e promessas de
pagamento quebradas, bloqueia cobrança indevida, e roda quase inteiramente por
atalhos de teclado.

Este repositório existe para versionar os módulos. Há duas formas de rodar:

## Integração CRM → Systextil

Na `main` (versão 1.126.1, recuperação do comportamento estável da 1.125.1), o Módulo 39 permite selecionar um título elegível no CRM e acompanhar os estados da segunda via enviados pelo userscript do Systextil. O SmartTable exibe o andamento e marca **2ª via concluída** somente quando recebe `status: 'concluido'` com `ok: true`, após o download confirmado do PDF. A emissão e o download são executados pelo userscript do repositório [Systextil-envio-mensagem](https://github.com/IsaacTexCotton/Systextil-envio-mensagem), não pelo Módulo 39. A documentação está no [guia da integração](https://github.com/IsaacTexCotton/Systextil-envio-mensagem/blob/main/docs/transferencia-crm-systextil.md). A distribuição normal do SmartTable depende da publicação do commit validado no espelho público.

## Opção 1: Tampermonkey (recomendado, permite distribuir pro time)

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no Chrome.
2. Abra
   `https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/smart-table.user.js`
   → o Tampermonkey abre a tela de instalação automaticamente. Confirme.
3. Pronto — o script busca os módulos de `modulos/*.js` via `@require`.
   Quando um módulo for atualizado neste repo, basta subir o `@version` em
   `smart-table.user.js` (e dar "Check for updates" no Tampermonkey, ou
   esperar a checagem automática) pra todo mundo receber a versão nova, sem
   reenviar arquivo.

**Pendente de confirmar em uso real**: o Tampermonkey roda scripts num
contexto isolado por padrão; `@grant none` (já configurado) deveria expor o
mesmo `window` da página, necessário pra `window.showTab`,
`window.abrirWhatsAppCliente`, `window.__avisoCobranca` etc. funcionarem —
mas isso ainda não foi testado no CRM real, só documentado como expectativa.

**Repositório privado + espelho público (v1.46.1)**: o Tampermonkey não envia
credenciais, então os módulos precisam de um endereço público. Este repo
(código, testes, fixtures, histórico) é privado; o workflow "Espelho público"
(`scripts/espelho-publico.js`) copia SÓ `modulos/*.js`, os instaladores e o
snippet de captura para `IsaacTexCotton/SmartTable-publico`, depois dos testes
verdes em `main`. Nada é copiado se aparecer
CNPJ/CPF com dígito válido. O token da cópia é o segredo `ESPELHO_TOKEN`
(restrito ao SmartTable-publico, Contents read/write); quando ele vencer, o
workflow falha dizendo isso — gere outro e troque o segredo. Nunca edite o
SmartTable-publico direto: a próxima cópia apaga.

**Como conferir que uma versão chegou ao espelho (rápido, ~1 s).** Não baixe
os arquivos da `raw.githubusercontent.com` pra comparar: ela guarda cada URL
em cache por 5 minutos (`cache-control: max-age=300`) e o `?t=...` **não**
contorna isso -- é o que fazia a conferência parecer levar ~5 min quando a
cópia real leva ~1min40 (mediana medida em 28/09/2026, 15 publicações). Use o
git, que não passa por esse cache:

```bash
ESP=$(mktemp -d); git -C "$ESP" init -q
git -C "$ESP" fetch -q --depth=1 https://github.com/IsaacTexCotton/SmartTable-publico.git main
git -C "$ESP" log -1 --format='%h %ci %s' FETCH_HEAD     # "Espelho de SmartTable <sha7> (main)"
# um arquivo idêntico tem o mesmo blob nos dois lados:
for f in $(git ls-tree -r --name-only HEAD -- modulos smart-table.user.js captura-fixture.user.js scripts/captura-fixture-devtools.js); do
  [ "$(git rev-parse HEAD:$f)" = "$(git -C "$ESP" rev-parse FETCH_HEAD:$f 2>/dev/null)" ] || echo "DIFERENTE: $f"
done
```

Enquanto o `main` do espelho não trouxer o commit, repita o `fetch` a cada
poucos segundos. O Tampermonkey, porém, baixa pela `raw`: a atualização pode
levar até 5 minutos depois do espelho, e isso o GitHub não deixa mudar.

## Canal único: `main`

Existe **um** arquivo de instalação, `smart-table.user.js`, e os `@require` apontam para o branch `main` do
SmartTable-publico. Todo `git push` em `main` que passa nos testes chega ao navegador na checagem seguinte do
Tampermonkey (o `@updateURL` também fica em `main`; quem decide é o `@version`). O canal estável (arquivo
`smart-table-estavel.user.js`, branch `estavel` e `npm run release`) foi **removido**: decisão do usuário, 02/10/2026
("eu não uso esse conceito de estável"). O branch `estavel` antigo continua existindo no GitHub e NÃO é mexido nem
publicado.

`tests/wrappers.test.js` trava o wrapper: nenhum módulo órfão em `modulos/`, todo `@require` apontando para `main` e
existindo em disco, `@version` igual ao `VERSAO_SMARTTABLE` do Módulo 6, e o instalador de captura separado.

## Medindo se a régua de prioridade funciona

O Módulo 8 grava três eventos: a atribuição de fila (faixa, posição, grupo),
a cobrança efetivamente enviada (com a hora) e a baixa detectada. Para ver:

```js
window.__diario.relatorio()        // análise no console
window.__diario.exportar()         // baixa o JSON, pra juntar os dados de duas máquinas
```

**Onde vai o tempo do operador (v1.54.0, 28/09/2026).** Três diagnósticos
só de leitura e só de números, para colar no chat sem censurar nada à mão
(pedido do usuário, depois de uma discussão com o agente advogado do diabo:
medir antes de mexer no fluxo). Só o operador deste navegador conta.

**Onde rodar: no console do navegador** (o painel do Alt+K, que tinha três botões para isso, foi removido em
08/10/2026; os comandos seguem valendo):

```js
window.__diag.qualidade()      // o diário é confiável? (rode este primeiro; 10 dias válidos)
window.__diag.ritmo()          // cobertura da fila (e por terço), intervalos entre contatos, pausas, horários
window.__diag.filaDefasada()   // SÓ na página da lista: clientes da fila que saíram da lista de vencidos
```

Como ler: `contato` marca a **abertura do WhatsApp**, então a cobertura é um
**teto**; o `ritmo` não mede a espera do Alt+A nem o custo das colagens (isso
pede cronômetro manual, 20 clientes); só vale a conclusão que se mantém nos
três limites de pausa (10, 20 e 30 min); recorte com menos de 10 dias sai
"sem dados". A saída passa por um filtro que só deixa número, booleano e
uma lista fechada de textos, contagem abaixo de 5 vira `"<5"`, percentil só
com 20 intervalos ou mais e horários em blocos de 30 minutos.

**A tabela por faixa não responde se a régua é boa.** As faixas contêm
clientes diferentes por construção — quem está 2 dias atrasado paga mais que
quem está 30 em qualquer ordem que você ligue. Ela serve para ver cobertura:
quais faixas nunca são chamadas.

**Não existe grupo de controle.** A fila sai 100% na ordem da régua. O
mecanismo (1 em cada 5 clientes com posição sorteada, pra medir o efeito da
ordem) ficou desligado por decisão do usuário e foi **removido do código** a
pedido dele em 28/09/2026 (v1.50.0). O diário responde as perguntas
**descritivas** (cobertura por faixa, quais faixas nunca são chamadas, o que
cai em "Demais dias"); a pergunta **causal** — "a ordem da régua ajuda?" —
fica sem resposta, porque as faixas contêm clientes diferentes por
construção. Registros antigos com a marca de controle continuam legíveis e
entram na tabela por faixa como qualquer outro.

**"Pagou" é inferência** — o que o sistema vê é título que sumiu da lista de
vencidos. Renegociação e baixa manual dão o mesmo sinal.

Os dados ficam no `localStorage` de cada navegador, com 120 dias de retenção
(~3 MB no volume atual). Não se juntam sozinhos entre duas pessoas.

## Diagnóstico censurado (`window.__diag`)

Qualquer informação tirada do console pra colar num chat, e-mail ou print sai
por aqui — **já censurada**, sem depender de alguém lembrar de apagar o CNPJ:

```js
window.__diag.fila()      // a fila do dia: faixa, posição, situação, dias
window.__diag.grupo()     // alerta de grupo econômico + estado visual do banner
window.__diario.exportar()  // censurado por padrão
```

O que é **preservado**, porque é o que serve pra diagnosticar: identidade
estável (o mesmo cliente vira sempre o mesmo apelido, o que permite detectar
duplicata e cruzar eventos), o **formato** dos valores (`R$ #.###,##`, que
revela erro de parsing sem revelar o valor), e tamanhos, contagens, situações,
faixas e datas.

**Ressalva honesta:** isto é pseudonimização, não anonimato criptográfico. O
apelido é um hash com sal aleatório guardado só naquele navegador — o objetivo
é não vazar dado de cliente por descuido, não resistir a adversário
determinado. Pra exportar com CNPJ de verdade (uso interno, nunca pra fora):
`window.__diario.exportar({ censurado: false })`.

## Autoconferência (`window.__conferir()`)

Rode no console depois de um Alt+U. Ela checa **invariantes contra o estado
real** — a fila salva, o diário de hoje, o contexto — e aponta o que estiver
quebrado:

```
[Conferência] 14 checagens, nenhum problema.
```

**Por que existe, e por que não é "mais um teste":** as quatro falhas que
chegaram a atrapalhar a cobrança de verdade não foram pegas pela suíte. Foram
pegas quando o operador exportou a fila e alguém olhou — a régua reordenando
errado, o grupo de controle (hoje removido) nunca alcançando o fim da fila, o Alt+U gravando
tudo duas vezes, o Alt+A não gerando relatório. Todas invisíveis em jsdom,
porque moram em código que abre aba de fundo e depende de dado real.

Ela não substitui `npm test` — cobre justamente o que ele não alcança.

## Integração contínua

`.github/workflows/testes.yml` roda `npm ci`, `npm run lint` e `npm test` em
todo push para `main` e em todo pull request, e os E2E (Playwright) num job
separado, com o Chromium em cache (`actions/cache`, chave = hash do
`package-lock.json`). A suíte roda em paralelo (`tests/run-all.js`; ≈1 min):
repositório privado tem cota de minutos de CI.
`SMARTTABLE_TESTES_PARALELOS=1 npm test` roda um arquivo por vez. Localmente, `npm run verificar`
roda os três na mesma ordem.

O primeiro passo (`npm run lock`, que é `npm ci --dry-run`) existe porque essa
falha é **invisível localmente**: `npm test` usa o `node_modules` que já está
instalado e passa alegremente com o `package-lock.json` dessincronizado do
`package.json`. Só o `npm ci` do CI reclama — e foi o que aconteceu ao
adicionar o ESLint com `--no-save`: quatro runs seguidos morreram em 10
segundos sem rodar um teste sequer. Custa meio segundo.

**Sobre o alcance do lint, sem ilusão:** das quatro falhas que chegaram a
atrapalhar a cobrança, o ESLint não teria pegado nenhuma — são de contrato
entre módulos e de lógica, não de sintaxe. Ele está configurado só com regras
que apontam defeito (variável morta, global não declarada, caso duplicado,
código inalcançável), nunca estilo, e os módulos protegidos ficam de fora das
regras que não se pode corrigir neles. É um piso barato, não a rede
principal. Antes disso, as asserções só valiam se alguém lembrasse de
rodar a suíte à mão antes de empurrar.

**Nota sobre a URL de atualização**: no canal de desenvolvimento,
`@updateURL`/`@downloadURL`/`@require` apontam para a branch `main`.

## Skills de desenvolvimento

`.claude/skills/` tem sete skills usadas para desenvolver este projeto — seis
copiadas de [jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills)
sob licença MIT, e uma própria (`alternativa-mais-rapida`).

**Quando usar cada uma, com exemplos reais deste repositório e as ressalvas que
a skill não sabe sozinha** (o projeto não usa ESM, não usa Playwright, e não
escreve ADRs em arquivo separado): ver `.claude/skills/COMO_USAR.md`.

A regra que vale para todas: **skill não substitui dado real.** Os quatro bugs
que de fato atrapalharam a cobrança nesta base foram achados por diagnóstico ao
vivo no CRM, nenhum pela suíte de testes.

## Versionamento

`@version` em `smart-table.user.js` segue `MAJOR.MINOR.PATCH`, com critério
fixo (decidido com o usuário) — em caso de dúvida entre duas categorias,
sempre a MAIS ALTA das duas, nunca a mais baixa:

- **PATCH** (`1.0.x`) — só correção de bug, ajuste de texto/frase, ajuste
  visual (cor, espaçamento) ou refino de teste, sem mudar o que o script FAZ.
  Ex.: corrigir uma frase que saía sem informação, corrigir um banner que
  ficava por cima do modal errado.
- **MINOR** (`1.x.0`) — qualquer atalho, botão, critério de faixa/prioridade
  ou regra de negócio NOVA, e qualquer REORDENAÇÃO/redesenho de uma regra já
  existente (mesmo sem adicionar um recurso novo — mudar a ordem da régua de
  prioridade É uma mudança de comportamento observável, não um ajuste).
  Ex.: os 3 botões de agendamento rápido, a deduplicação por grupo
  econômico, a reordenação da régua de prioridade.
- **MAJOR** (`x.0.0`) — só quando exige atenção do usuário ANTES de
  atualizar: muda o formato salvo no `localStorage` de forma incompatível
  com filas/retratos já salvos, remove ou remapeia um atalho existente, ou
  muda uma mensagem automática de um jeito que o usuário não controla mais
  (ex.: passa a enviar sem revisão manual). Nunca por acúmulo de MINORs --
  só por uma mudança que quebra ou exige leitura do changelog antes de usar.

`VERSAO_SMARTTABLE` no Módulo 6 e a entrada do topo de `LOG_ATUALIZACOES` no
Módulo 18 são bumpados em lockstep, sempre.

## Opção 2: Local Overrides do Chrome DevTools (forma original)

Colar o conteúdo dos 6 módulos, nessa ordem, no Local Override do arquivo
`smart-table.js` servido pelo CRM. Só funciona na máquina onde foi colado, e
exige o DevTools aberto. Ver `contexto-v7.md` para o histórico completo de
decisões, armadilhas e itens em aberto.

## Módulos (`modulos/`), colados nessa ordem no mesmo arquivo

0. `modulo0-utilitarios-compartilhados.js` — funções e constantes usadas por
   2+ módulos (normalização de data, toast, `escolherTituloRepresentativo`,
   limiares de aviso SCPC etc.), extraídas depois de uma auditoria apontar
   duplicação real. Precisa carregar ANTES de todos os outros. Módulo 1 e 2
   (protegidos) mantêm suas próprias cópias locais, de propósito.
1. `modulo1-aviso-cobranca.js` — classifica títulos vencidos, gera relatório
   em imagem, expõe `window.__avisoCobranca`. **Não editar sem confirmação
   explícita do usuário** (não foi escrito por Claude originalmente).
2. `modulo2-registrar-enviar.js` — botão "Registrar e Enviar" no modal de
   contato. `POST /api/crm/contatos`, abre WhatsApp e fecha a aba sozinho.
   **Não editar sem confirmação explícita do usuário.**
3. `modulo3-fila-atendimento.js` — percorre a lista de clientes sozinha,
   priorizada por urgência, avança automaticamente após cada registro.
4. `modulo4-atalhos-teclado.js` — fluxo por teclado (`Alt+letra`). Inclui o
   painel do log de atualização (`Alt+L`); a lista mora no Módulo 18. É o
   dono do mapa de teclas, das buscas e dos painéis (Alt+B, Alt+L, Alt+H) e
   do fluxo do Alt+A. O texto da mensagem mora no Módulo 19, as ferramentas
   de DOM no 20 e a cópia/Alt+S no 21.
5. `modulo5-alerta-grupo.js` — avisa se outra empresa do mesmo grupo
   econômico também tem título vencido. Desde a v1.36.0 também desenha o
   checkbox **"Números diferentes"** ao lado do aviso "N CNPJ do grupo
   vencido" do CRM: números de WhatsApp das outras razões, salvos por CNPJ
   do cliente principal (`smarttable_numeros_diferentes_v1`). Com números,
   o Alt+S (Módulo 4) manda a mesma mensagem pro cliente (com o registro de
   sempre, pelo Módulo 2) e depois, um Alt+S por número, pra cada um deles,
   sem registrar de novo. A sequência sobrevive ao `location.reload()` do
   Módulo 2 pela ponte `smarttable_envio_numeros_pendente_v1`, que só vale
   depois que o Módulo 3 confirma o registro (evento
   `smarttable:contato-registrado`).
6. `modulo6-contexto-adicional.js` — lê Promessas e Contatos ao carregar a
   página do cliente, expõe `window.__contextoAdicional` para o Alt+A
   (mensagem personalizada) consultar sem custo extra. Também identifica o
   negociador logado (`#user-menu-btn`) pra saber se ELE já falou com aquele
   cliente e pra assinar a mensagem com o nome certo — nada de nome fixo no
   código.
8. `modulo8-diario.js` — registra o que aconteceu (atribuição de fila com
   faixa e posição, cobrança enviada com hora, e baixa detectada), pra
   medir a cobertura da régua de prioridade do Alt+U (sem grupo de controle:
   removido em 28/09/2026, v1.50.0). Carrega logo depois do Módulo 0; os módulos 3, 6 e 7
   dependem dele. Análise em `window.__diario.relatorio()`.
7. `modulo7-fila-prioridade.js` — a régua (v5, 16 faixas desde a v1.96.0; lista completa em
   `contexto-v7.md`) tem o 5º dia de atraso em faixa própria (P14), separado
   dos dias 3-4 (P10) **de propósito**, decisão do usuário; não tratar como
   lacuna. O atraso inicial (P10) vem ANTES dos dois SCPC: "SCPC antes do
   aviso de suspensão" (P11) e "SCPC — último dia" (P12), decisão do usuário
   mesmo avisado do risco. A faixa 9 é "sem contato ou movimentação há 14
   dias ou mais" (`>= 14`). Monta uma fila de atendimento ordenada por
   uma régua de prioridade de negócio (Alt+U), visitando cada candidato em
   aba de fundo pra classificar a situação real do título e a promessa de
   pagamento ativa (quem prometeu pagar hoje ou quebrou a promessa sobe na
   fila), e deduplicando por grupo econômico.
12. `modulo12-alerta-cliente.js` — botão "⚠ Alerta" na página do cliente:
    "não cobrar" por N dias (tira o cliente do Alt+U), observação livre e,
    desde a v1.47.0, **títulos em cartório fora do relatório** — uma
    caixinha por título em cartório; marcado, sai do relatório, da mensagem,
    da nota e do Alt+U até constar como pago no CRM (neste navegador).
13. (aposentado em 08/10/2026) o console de diagnóstico do Alt+K foi removido; o número 13 não é reutilizado.
14. `modulo14-carteira.js` — painel da carteira (Alt+M) em quatro abas, só
    com o vencido do 2º ao 20º dia (1º dia/dia 0 e 21+ ficam numa linha
    "fora do painel"). **Hoje**: vencido, % da carteira em cobrança, SCPC,
    promessas, cobertura, concentração, aging. **Evolução**: ponte da
    carteira (entradas, pagamentos, analista), cura gravada por dia e semana
    a semana, tendência. **Resultado**: API do Alt+D e previsão de entrada
    das promessas. **Régua**: faixa do Alt+U e hora do contato x quem pagou
    em 7 dias (diário do Módulo 8). Fotografia de abertura do dia a partir de
    `window.CLIENTES`, gravada como **dado bruto** (os campos da lista como
    vieram, numa lista permitida, sem nome/endereço/contato e com CNPJ em
    hash) no **IndexedDB**, 1 ano; **todo número é calculado na leitura**,
    então mudar regra não exige apagar fotografia. Alertas de qualidade de
    dado gravados junto, falha de gravação visível, lacunas, backup e
    restauração. Exporta CSV (`;` e vírgula decimal). Desde a v1.64.0 este
    arquivo é só o **painel** (desenho, abas, carga inicial); os dados e as
    contas moram nos Módulos 22 e 23, que precisam carregar antes dele.
22. `modulo22-carteira-dados.js` — a base da Carteira: constantes, escopo e
    regras de negócio aplicadas na leitura, montagem do registro bruto de um
    dia e armazenamento (**IndexedDB** com memória como plano B, leitura que
    decodifica, migração do localStorage antigo). Não depende de nenhum
    módulo; expõe `window.__carteiraDados`. Extraído do Módulo 14 na v1.64.0.
23. `modulo23-carteira-historico.js` — o que se faz com o histórico:
    fotografia do dia, cura, ponte, lacunas, régua x resultado, resultado do
    período (APIs do Alt+D), previsão, **CSV e backup/restauração**. Depende
    do Módulo 22; expõe `window.__carteiraHistorico`. Extraído do Módulo 14
    na v1.64.0.
15. `modulo15-alertas-gerais.js` — botão "🔔 Alertas gerais" na lista de
    clientes (mesma barra do "Continuar fila anterior"): lembretes sem cliente, com
    descrição e data, acumuláveis, em cards com X para excluir. No dia, um
    aviso aparece ao abrir a lista (só lá); no dia seguinte o alerta some
    sozinho. `localStorage` (`smarttable_alertas_gerais_v1`). Não tem nada a
    ver com o "⚠ Alerta" do cliente (Módulo 12).
16. `modulo16-negociacoes.js` — títulos negociados. Lê a aba Negociações do
    cliente e o detalhe de cada acordo na API do CRM; título de acordo ativo
    ou quitado ganha o selo "🤝 Acordo #N" e sai do relatório e da mensagem
    (tudo em acordo: o Alt+A só lembra/cobra a parcela, sem relatório).
    Acordo inadimplente devolve os títulos pra cobrança, com aviso. Carrega
    antes do Módulo 1. No Alt+U, acordo em dia fica fora da fila e parcela
    atrasada vai pra faixa 6.
17. `modulo17-promessa-rapida.js` — promessa rápida (**Alt+N**). Na página
    do cliente, um painel lista os títulos vencidos, numerados: 1 a 9 marcam
    os que o cliente prometeu (o único vencido já vem marcado), H/A/D
    escolhem a data (hoje, amanhã, outra) e Enter registra. Quem grava é o
    próprio CRM: o módulo preenche o modal "Registrar Contato" como um
    operador faria e clica no Salvar Contato dele, então juros, multa e o
    vínculo dos títulos continuam do CRM. Onde o CRM pede decisão (título já
    em outra promessa, mais de uma razão do grupo, "Confirmar ação") ele para
    e deixa o contato aberto. Depois de salvar, confere na aba Promessas e
    avisa em verde ou vermelho, inclusive depois do reload. Carrega antes do
    Módulo 4 (dono do mapa de teclas).
18. `modulo18-log-atualizacoes.js` — só dados: a lista `LOG_ATUALIZACOES` do
    log de atualização (`Alt+L`, painel no Módulo 4), separada do Módulo 4 na
    v1.46.0. **Precisa ser atualizada a cada bump de versão** —
    `tests/changelog.test.js` falha se a versão do topo divergir de
    `VERSAO_SMARTTABLE`. Carrega antes do Módulo 4.
19. `modulo19-mensagens-cobranca.js` — o TEXTO da mensagem de cobrança do
    Alt+A (frases por situação, promessa, acordo, grupo, pergunta final,
    legenda do relatório e variáveis `{{ }}`). Só monta texto, sem DOM nem
    área de transferência. Extraído do Módulo 4 na v1.63.0 sem mudar
    comportamento; desde a v1.77.0 a saudação leva o primeiro nome do
    Responsável financeiro (`window.__RESPONSAVEL__`) quando ele serve, e o
    primeiro contato e as frases padrão do CRM seguem sem nome; desde a v1.78.0 o texto vem do catálogo (Módulo 30)
    e este módulo só decide qual texto entra e com quais valores; expõe `window.__mensagensCobranca`. **Precisa carregar
    antes do Módulo 4**, que avisa alto se ele faltar.
24. `modulo24-busca-rapida.js` — **Alt+B**: a caixa de busca de cliente. No
    Enter conta os clientes em segundo plano (a lista do CRM com `?search=`
    já vem filtrada, com `CLIENTES` embutido): 0 avisa, 1 entra direto, 2 a 5
    abre uma lista no centro (setas e Enter), mais de 5 ou qualquer dúvida usa
    a lista nativa. A ponte opcional do WhatsApp encaminha celular ou termo
    textual para essa mesma busca. O N de `/crm/clientes/grupo/N` é
    `controleCliente`. Expõe `window.__buscaRapida`; carrega antes do Módulo 4.
20. `modulo20-dom-atalhos.js` — ferramentas de DOM dos atalhos: achar botão
    visível por texto, clicar como o React espera, esperar condição em outra
    aba, soltar o foco preso pelo CRM. Não depende de nenhum módulo. Extraído
    do Módulo 4 na v1.63.1; expõe `window.__atalhosDom`. Carrega antes do 21
    e do 4.
21. `modulo21-envio-copia.js` — do texto escrito até a mensagem sair: cópia das
    partes para a área de transferência (Win+V, com foco, tentativas e fila),
    imagem do relatório no Ctrl+V, avisos de cópia, **Alt+S** (registrar e
    enviar esperando a cópia confirmar), envio em sequência para "números
    diferentes" e aviso do clique manual. Extraído do Módulo 4 na v1.63.1;
    expõe `window.__envioCopia`; suas constantes ficam em `CONFIG_ENVIO`.
    Depende dos Módulos 0, 19 e 20 e carrega antes do 4.
25. `modulo25-lembretes-bloqueio.js` — **Alt+E**: regras de lembrete (cluster +
    situação do título em cartório + nome do bloqueio). Ao entrar no cliente que
    casa com a regra, avisa para inserir no bloqueio; ao sair da regra, avisa
    para liberar. **Só avisa, não bloqueia nada.** O cluster vem do cache que a
    lista de clientes alimenta (a página do cliente não o traz). Depende dos
    Módulos 0, 1, 12, 16 e 22; expõe `window.__lembretesBloqueio`; carrega antes do 4.
26. `modulo26-meta-semanal.js` — bloco "Meta da semana" dentro do **Alt+D**
    (Módulo 10), depois do Total recuperado: o usuário digita a meta; o bloco
    mostra recebido (o "Os dois"), falta, dias úteis restantes (hoje conta; fim
    de semana e feriado do Módulo 1 pulados) e o **ritmo por dia útil**, que se
    ajusta a cada dia. Só na semana atual. Depende do Módulo 0; o Módulo 10 o
    chama se ele estiver carregado; expõe `window.__metaSemanal`.
27. (aposentado em 08/10/2026) o copiar títulos do Alt+T foi removido; o número 27 não é reutilizado.
28. `modulo28-contatos-google.js` — **Alt+J**: importa o CSV do Google Contatos (lido no
    navegador, guardado só nele, em IndexedDB) e, ao abrir um cliente, sugere o nome e o
    celular do **Responsável financeiro** pela raiz do CNPJ que vem no nome do contato
    (`RAZÃO - RAIZ - UF - GP n - nome`). "Preencher" digita no modal do CRM e deixa o usuário
    conferir e salvar (quem grava é o CRM). Só lê a página e o CSV; nada vai ao console. Depende
    do Módulo 0; expõe `window.__contatosGoogle`; carrega antes do 4. Desde a 1.121.0,
    mantém também um índice global local de celulares válidos de todas as linhas do CSV, independentemente
    do nome/raiz CNPJ; a migração preserva a base por raiz, mas exige reimportar CSV antigo para conferir ausências.
29. `modulo29-contatos-google-lista.js` — botão **"Contatos do Google"** na lista de
    clientes. Mantém o fluxo CSV **Google → CRM** (atualização explícita, releitura antes e
     depois da gravação e "Desfazer") e acrescenta a prévia direta **CRM → Google**: compara
     nomes e celulares atuais pela People API, exige confirmação dos campos selecionados e não
     grava vínculos ambíguos sem confirmação manual. Telefones existentes são preservados; o
     usuário escolhe se adiciona o celular do CRM ou substitui um celular existente. A tela separada
     **Conferir celulares** compara o responsável financeiro e todos os campos de telefone do cadastro contra
     o índice global do CSV, sinaliza números compartilhados e exporta apenas celulares válidos ausentes;
     o celular cadastral recebe um marcador interno na coluna Notes (não no nome) para não virar sugestão
     de responsável em importações futuras. Não consulta a agenda atual nem grava contatos. Depende dos
     Módulos 0, 24, 28 e 36; expõe `window.__contatosGoogleLista`; carrega antes do 4.
30. `modulo30-catalogo-mensagens.js` — o **catálogo dos textos do Alt+A**: registro de todos os textos
    (chave, formas singular/plural, variáveis permitidas, regras de conteúdo e o texto padrão), o motor
    `T(chave, { forma, vars })` e a leitura do catálogo salvo no navegador
    (`smarttable_catalogo_mensagens_v1`), validada texto a texto, com o padrão embutido como reserva (o Alt+A
    nunca deixa de montar a mensagem). Nesta versão só LÊ; o editor (rascunho, publicar, histórico, backup) vem
    depois. Expõe `window.__catalogoMensagens`; **carrega antes do Módulo 19**.
31. `modulo31-editor-mensagens.js` — o **editor das mensagens do Alt+A** (atalho **Alt+X**): diálogo centralizado
    (como o Alt+N) com os textos do catálogo por bloco, o texto em uso e o padrão lado a lado com os selos
    "editado"/"padrão", e busca por título e texto. Nesta versão (1.79.0) é SÓ LEITURA; rascunho, publicar, histórico
    e backup vêm nas próximas etapas da R2. Depende dos Módulos 0 e 30; expõe `window.__editorMensagens`; carrega
    antes do Módulo 4.
    Desde a 1.80.0 também EDITA, como rascunho: botão "Editar" por forma (uma caixa por variante, adicionar/remover variante
    nos textos com rodízio, variáveis por clique), validação ao digitar (regras do Módulo 30), rascunho gravado sozinho
    (`rascunho` no catálogo salvo, que o Alt+A nunca lê) e "Descartar rascunho".
    Desde a 1.81.0 também tem a **prévia da mensagem completa** ("Ver prévia", no rodapé): uma segunda tela do mesmo
    diálogo que mostra, em situações inventadas (Módulo 32), a mensagem que o Alt+A montaria, "Antes (em uso)" e "Depois
    (rascunho)", só nas situações que o rascunho muda ("Ver todas as situações" mostra todas), balão novo e removido em
    destaque (e lidos como "(novo)"/"(removido)" por leitor de tela), contadores de balões e caracteres, faixas de erro e aviso
    de tamanho (5 balões, 320 por balão, 600 no total; com acordo o total vai até 750: de 601 a 750 é aviso) e um seletor de variante para os textos
    com rodízio. A prévia só LÊ (nada é gravado).
    Desde a 1.82.0 também **PUBLICA**: na prévia, "Publicar…" abre a tela Publicar (o que muda, "Em uso" x "Novo", erros de conteúdo
    que bloqueiam, avisos de conteúdo e de tamanho que só avisam, nota opcional e aviso se outra aba publicou antes); publicado, o
    texto passa a valer no Alt+A neste navegador. "Histórico" (rodapé da lista) lista as últimas 20 publicações, mostra o que cada
    uma mudou e permite voltar a uma versão (cria uma publicação nova). "Restaurar o padrão", no formulário de cada forma, põe o texto
    padrão como rascunho (ainda é preciso publicar). Backup (exportar/importar) vem a seguir.
32. `modulo32-cenarios-previa.js` — os **cenários da prévia** da mensagem do Alt+A (só dados inventados: 54 situações, entre elas
    os 12 aprovados e dois casos de tamanho máximo medidos) e o executor que monta cada mensagem pelo código real do Alt+A
    (Módulo 19, em `comAmbiente`) e do catálogo (Módulo 30, em `comRascunho`), sem ler a página nem gravar nada. Conta os balões
    (imagem + legenda = 1) e confere os limites (5 balões, 320 por balão, 600 no total; com acordo o total vai até 750: de 601 a 750 é aviso). A tela
    que mostra isso é a prévia do Módulo 31 (desde a 1.81.0). Carrega depois dos Módulos 19 e 30 e antes do Módulo 31; expõe `window.__cenariosPrevia`.
33. `modulo33-corretor-csv.js` — o **corretor de CSV** dos Contatos do Google (só funções, sem tela): lê o
    "Google CSV", escreve em `First Name` o nome no padrão `RAZÃO - RAIZ - UF - nome` dos contatos que o leitor
    estrito do Módulo 28 não entende (UF colada no nome, hífen sem espaços), esvazia Prefix/Middle/Last/Suffix e
    devolve um CSV só com os corrigidos, para importar de volta no Google. A tela é o botão "Corrigir CSV e baixar"
    do painel do Alt+J. Nada é enviado. Carrega depois do Módulo 29; expõe `window.__corretorCsv`.

36. `modulo36-google-contacts-api.js` — cliente da Google People API e OAuth 2.0 via Google Identity Services. O Client ID OAuth é configurado no painel e guardado localmente; o token de acesso existe só em memória. Lista contatos paginados, consulta a versão atual antes de alterar e usa o `etag` da origem CONTACT para bloquear conflitos. O carregamento GIS tem retentativa; pedidos OAuth e requisições HTTP têm timeout; respostas 429 recebem retentativa limitada com espera exponencial. Carrega após o Módulo 28 e antes do 29. O `@require` usa `SmartTable-publico/main`; o workflow `Espelho público` publica a versão aprovada somente depois que `Testes` fica verde em `main`.

### Configuração inicial da sincronização direta com Google Contacts

1. No Google Cloud, crie/seleciona um projeto, habilite a **People API** e configure a tela de consentimento OAuth.
2. Crie um OAuth Client ID do tipo **Aplicativo da Web** e autorize a origem JavaScript `https://texhub.texcotton.com.br`.
3. Na lista do CRM, abra **Contatos do Google**, cole o Client ID no bloco "Sincronização direta" e clique em **Salvar Client ID**. Depois use **Conectar Google** e autorize o acesso aos contatos.
4. Clique em **Ler contatos e preparar correções**, revise cada correspondência e selecione nome/celular. A confirmação mostra uma amostra de até cinco alterações antes/depois; em seguida, o SmartTable inicia o download de um backup JSON com data, `resourceName`, nomes e telefones originais. Confirme que o arquivo foi salvo antes de autorizar a gravação. O botão **Desfazer última rodada** restaura nomes e telefones usando o ETag devolvido pela gravação; se o contato mudou depois, a restauração é bloqueada.

**Cuidados de segurança e validação**

- O escopo OAuth `https://www.googleapis.com/auth/contacts` permite ler e alterar toda a agenda autorizada. Prefira uma conta Google dedicada ao financeiro, sem contatos pessoais; não use a conta principal sem avaliar esse alcance.
- Antes da agenda real, faça a validação manual com uma conta Google de teste e 3 a 5 contatos: conexão, leitura paginada, atualização de nome, adição e substituição de telefone, backup JSON, desfazer e bloqueio quando o contato muda após a gravação.
- O userscript usa `@grant none`, portanto não habilita o sandbox de privilégios do Tampermonkey no wrapper atual. Ainda assim, confirme manualmente o carregamento GIS no CRM real, pois os testes jsdom não reproduzem a política de segurança do navegador.
- O `@require` do Módulo 36 aponta para `SmartTable-publico/main`. Para publicar uma atualização, primeiro teste e integre a versão no repositório fonte; o workflow `Espelho público` copia os arquivos após `Testes` verde em `main`. Não faça push direto no espelho público nem altere o workflow ou o script de espelho sem pedido explícito.

Referências oficiais: [habilitar a People API](https://developers.google.com/people), [Google Identity Services — modelo de token](https://developers.google.com/identity/oauth2/web/guides/use-token-model) e [people.updateContact](https://developers.google.com/people/api/rest/v1/people/updateContact). A autorização depende da configuração OAuth e da política de acesso da conta Google; a sincronização direta não funciona antes desse cadastro.
### Contexto técnico complementar

Ver `contexto-v7.md` para fatos técnicos confirmados, armadilhas já
encontradas e itens em aberto — não redescobrir do zero.

## Sessões longas do Claude: `/passagem`

O resumo automático da compactação do chat é escrito de memória e pode omitir
ou distorcer. Perto do limite de contexto (ou antes de encerrar uma sessão
longa), rode `/passagem` (`.claude/commands/passagem.md`): o Claude confere o
repositório (git, versões, testes), escreve `passagens/AAAA-MM-DD-HHMM.md` com
o que só existe na conversa (decisões suas, pendências, erros, o que aguarda
teste no CRM real), cada afirmação marcada como verificada, dita pelo usuário,
hipótese ou descartada, e entrega um prompt de abertura de até 6 linhas para o
chat novo. A pasta `passagens/` não vai para o espelho público e passa pelo
detector de dado real. Em conflito, o repositório (`contexto-v7.md`, `git log`)
vence o relatório. `tests/passagem-de-contexto.test.js` trava o prompt.

## Testes (`tests/`)

Testes de regressão em Node + jsdom que rodam contra o código REAL de
`modulos/*.js` (nunca reimplementações à parte), usando os hooks de
depuração que os próprios módulos já expõem (`window.filaDebug`,
`window.__avisoCobranca`, `window.__contextoAdicionalDebug`,
`window.filaPrioridadeDebug`, `window.__atalhosDebug`).

```
npm install
npm test
```

Cada `tests/*.test.js` cobre um módulo (fila de atendimento, mensagens do
Alt+A, fila por prioridade, snapshot de pagamento, contato recente,
aviso de não cobrar, alerta de grupo econômico, geração de relatório de
outras razões, resumo do "Registrar e Enviar", agendamento rápido de
pagamento, contexto de promessa de pagamento, cliente nunca contatado
por este negociador, omissão do relatório em recontato, substituição de
variáveis `{{ }}`/concordância de plural/busca rápida, classificação de
títulos do Módulo 1 — prazos, feriados e as 6 situações —, a consistência
entre os dois wrappers do Tampermonkey, e o diário de cobrança com a
autoconferência da fila). Rode `npm test`
antes de subir qualquer mudança em `modulos/` —

O que não roda no jsdom (captura de imagem, área de transferência, handoff
pro app do WhatsApp, abas de fundo reais, bloqueio de pop-up) está em
`tests/ROTEIRO-MANUAL.md`, como checklist passo a passo.
esses testes já pegaram bugs reais nesta base de código (ex.: o bug crítico
de `normalizarData` corrigido no Módulo 0).

**Regra de fixture (aprendida do jeito difícil)**: teste de um módulo que
consome contexto de OUTRO (ex.: Módulo 4 lendo `window.__contextoAdicional`
do Módulo 6) não escreve esse objeto à mão — pede pro módulo real produzir,
via `tests/helpers/contexto-real.js`. Uma fixture escrita à mão com a data à
meia-noite, enquanto o Módulo 6 entrega meio-dia, deixou um teste de
regressão VERDE por semanas com o bug vivo em produção: os dois erros se
cancelavam dentro do teste.

### Capturando uma fixture HTML nova (`tests/fixtures/*.html`)

As fixtures HTML em `tests/fixtures/` (usadas por `tests/helpers/dom-env.js`
e pelos testes que precisam do HTML real de uma tela do CRM) são geradas com
`scripts/captura-fixture-devtools.js` — **não é um módulo do SmartTable**,
não entra no `@require` dos canais, não roda pra nenhum operador. Dá pra usar
de dois jeitos:

**Pelo Tampermonkey (recomendado pra quem já usa).** Instale à parte o
`captura-fixture.user.js`, abrindo
`https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/captura-fixture.user.js`
e confirmando. Ele carrega o snippet em toda tela do CRM **sem abrir nada**;
**Shift+Alt+C** abre e fecha o painel (o SmartTable só usa Alt sozinho, e
Shift+Alt+U). É um script separado, com `@name` próprio: não mexe na
instalação do SmartTable, e ninguém que não o instale recebe. Pra
distribuir uma mudança do snippet, suba o `@version` dele junto com o
`VERSAO_CAPTURA` do snippet (`tests/wrappers.test.js` confere); sem isso o
Tampermonkey não baixa o arquivo de novo.

**Pelo DevTools, sem instalar nada:**

1. Abra o CRM, `DevTools` (F12) `> Sources > Snippets > New snippet`, cole o
   conteúdo de `scripts/captura-fixture-devtools.js`, `Ctrl+S`.
2. Na tela do CRM que você quer capturar, botão direito no snippet `> Run`
   (ou `Ctrl+Enter`).
3. Um painel aparece no canto inferior direito: escolha **Selecionar área**
   (clique na área da tela), **Página inteira**, ou **Dados dos títulos**
   (captura `window.__TITULOS_ABERTOS__` como JSON). Dê um nome e clique em
   **Baixar arquivo**.
4. Confira a lista de "candidatos a revisar" que aparece no painel — nomes
   que sobraram sem anonimizar viram um aviso ali, pra você reforçar em
   "Nomes extras a ocultar" e baixar de novo antes de commitar.
5. Mova o arquivo baixado para `tests/fixtures/`.

Tudo roda no seu navegador, nada é enviado pra nenhum servidor. Nomes,
CNPJ/CPF, telefones e e-mails viram fictícios (o mesmo dado real sempre vira
o mesmo fictício, e CNPJs da mesma raiz mantêm a raiz, pra grupo econômico
continuar testável); valores monetários são multiplicados por um fator fixo
(ordem e proporções se mantêm, os números exatos não); datas, dias de
atraso, situações dos títulos e bancos continuam reais, porque a lógica dos
módulos depende deles. Campo oculto (`<input type="hidden">`) só mantém o que
é estrutura (`PROMESSA_PAGAMENTO`, `true`, data); número vira número
fictício e o resto some. Token de sessão (CSRF) sai vazio.

Atributos `data-*` são tratados pelo **nome** (desde a 2.1.1, depois que a
primeira captura em lote real mostrou três vazamentos): o índice de busca
(`data-busca`, que o CRM monta com a razão social **em minúsculas**) guarda
só número, data e palavra da tela; valor com ponto decimal (`data-valor="1929.06"`)
é mascarado com o mesmo fator do "R$" da tela; a anotação do contato
(`data-resumo` e o mesmo texto no card) vira `[anotação anonimizada]`, menos as
anotações padrão do SmartTable ("Enviado cobrança 19º dia."); `data-razao` e
parecidos são mascarados como nome. Nome já identificado é trocado em qualquer
lugar **sem diferenciar maiúscula nem acento**. No sentido contrário, texto
feito só de palavras da tela ("12 dias", "Selecionar vencidos", "Promessa de
Pagamento") e rótulo de lista fixa (`<option value="BOLETO">`) não são mais
tomados por nome, nem se espalham para os outros arquivos do lote.
`tests/captura-anonimizacao.test.js` cobre tudo isso na marcação real da
seção de promessa.

### Capturando TUDO de uma tela de uma vez (snippet v2.0+)

No painel (Shift+Alt+C pelo Tampermonkey), **Capturar tudo desta tela
(.zip)** faz sozinho o que antes
eram dezenas de capturas manuais, e baixa um `.zip` só:

- página inteira e área principal;
- cada aba (Títulos, Contatos, Negociações, Promessas, Depósitos, Pedidos,
  Timeline, Grupo), clicada como você faria, esperando o que ela carrega;
- os dados que a página guarda em variáveis (`__TITULOS_ABERTOS__`,
  `CLIENTES`), em JSON;
- os modais abertos por uma **lista permitida** de funções da página (novo
  contato, nova negociação, nova tarefa, responsável financeiro, print de
  cobrança, detalhe do contato, da promessa e da negociação), e o modal de
  contato **uma vez por resultado** (inclusive "Promessa de Pagamento", com a
  seção de títulos e data aberta);
- as respostas `GET /api/...` que a tela buscou no caminho, em JSON;
- o HTML dos modais que ficaram fechados (só a estrutura);
- `LEIAME.txt` e `manifesto.json`: o que saiu, o que não deu pra capturar e
  por quê, e quais chamadas a tela fez (só método e caminho, com número
  virando `N`).

**Nada é gravado no CRM durante o lote.** Enquanto ele roda, `fetch`/XHR que
não seja `GET` é recusado, envio de formulário, `sendBeacon` e `window.open`
também, e sair da página pede confirmação (escolha **Cancelar**). Tudo volta
ao normal no fim. A lista é de funções **permitidas**, não proibidas:
excluir promessa, mudar status de negociação, exportar e ir pro próximo
cliente nunca são clicados. Depois do lote, recarregue a página (F5).

Rode uma vez em cada tipo de tela (um cliente com títulos em situações
variadas, a lista de clientes, o dashboard): o snippet não sobrevive a uma
troca de página. A lista de nomes que sobraram sem anonimizar aparece **só no
painel**, nunca dentro do `.zip`, pra não viajar junto com os arquivos.
Confira antes de enviar.

`tests/captura-lote.test.js` trava as garantias acima com dado sensível
plantado na fixture real; `e2e/captura-lote.spec.js` repete no Chromium de
verdade, com o download real do `.zip`.


## Testes de ponta a ponta (`e2e/`, Playwright)

`npm run e2e` roda o painel da Carteira (Alt+M) no **Chromium de verdade**:
uma página falsa na mesma origem do CRM, com `var CLIENTES = [...]` como a
lista real entrega e os módulos reais carregados depois, como o Tampermonkey
faz. Provam o que o DOM simulado de `npm test` não prova: a fotografia
sobrevive a um F5 no IndexedDB real, duas abas gravando juntas não se
atropelam, a falha de gravação aparece na tela, o CSV e o backup baixam como
arquivo e o backup volta pelo seletor de arquivo depois de o navegador
perder tudo. Qualquer erro de JavaScript na página reprova o teste.

- Seletores por papel e nome acessível (`dialog "Carteira"`, abas, botões),
  num Page Object em `e2e/paginas/`; relógio fixado com `context.clock`.
- **Fora do `npm run verificar` de propósito**: o `verificar` roda o lint e a
  suíte jsdom e não pode exigir navegador baixado. Rode os E2E antes de integrar
  na `main`. Numa máquina nova, uma vez: `npx playwright install chromium`.
- Falhou? `npx playwright show-trace e2e/.resultados/<teste>/trace.zip`.