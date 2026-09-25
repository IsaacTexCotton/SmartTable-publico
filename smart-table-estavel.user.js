// ==UserScript==
// @name         SmartTable — Automação de Cobrança TexCotton (estável)
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      1.46.0
// @description  Canal ESTÁVEL do SmartTable: os módulos vêm do branch `estavel`, não da branch main. Só muda quando uma versão nova é publicada de propósito.
// @author       Isaac
// @match        https://texhub.texcotton.com.br/crm/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/main/smart-table-estavel.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/main/smart-table-estavel.user.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo0-utilitarios-compartilhados.js#sha256=d1dd94a8d3faa300e60f8e4e3b63eb2dbc467a675656e8350c79a1fa56ffe474
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo9-painel-configuracoes.js#sha256=43d414640c03c05b3356a79f23eff11bc5dee34dc5fd4e53659a88fbb14cde2b
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo10-recebido-na-semana.js#sha256=241853ff156a8e22c7e9d7b37ab3a77d0ca8ce17dd34dcaba6cf1b6877720307
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo14-carteira.js#sha256=1f160d29f95e035e1247cadc7b7a7da0b38684244462ac1f27195dd5ea7cc209
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo8-diario.js#sha256=5323223fe5f76d31f2e998defb01babba35e07ca41b9bfe9651b084a1bd40149
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo16-negociacoes.js#sha256=b64b01d87ca9ce4a0e6c1444af1e9004ce958cbccd0dc6f754f81fa53916f94b
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo1-aviso-cobranca.js#sha256=42bfb3031d5288d3604f5308c167368a5c32f997dcd50ac564ad4ed4d092bc0a
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo2-registrar-enviar.js#sha256=9408282b236bffbe7413a71f31ff821f25ea1e4a2665099bb0d84b08333fc5c2
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo3-fila-atendimento.js#sha256=ef4166b194cd361615cddf6377af5598436d9b50202bc1a4da03276ddc260353
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo12-alerta-cliente.js#sha256=fc25576245f0a12bd7d410ac0fef04c2b48bf7496a060a8674153a643c8ff6b6
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo15-alertas-gerais.js#sha256=318f3ca057427aa42f0891e77ad528f7a12f68063562f5bb3e30353292ded0c1
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo7-fila-prioridade.js#sha256=12a8fb511273e8074276a7f058e301b57ad5542c591ef05e2ee9cae34b8bebcb
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo11-progresso-fila.js#sha256=e101138eaa692826f7b7e2fb1d7a1e64be74710a4aa8069c1e50c24bc74cdaf5
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo13-console-diagnostico.js#sha256=17f16bd670e162dd59ccffb61cc540b062aa5d9b0d8b8654197be53446048ddd
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo5-alerta-grupo.js#sha256=4b7771f19fcf16459a64e184b0ef8d6654fa8b472b4d22ed3151b75cadece16d
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo17-promessa-rapida.js#sha256=c1cafebd1650bdbff276177295fe074aeb8ab5996a9d1a91488659f104637a8a
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo18-log-atualizacoes.js#sha256=6b0e3edec9a0c0bb8e73827d6ee8857467a8ae53d66e699a9b5aec0b96abe7a4
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo4-atalhos-teclado.js#sha256=76aa169555311ba8143cd7f1dc7aa31f357d37725b1dbb2fb4883ec2e9c74b8e
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable/estavel/modulos/modulo6-contexto-adicional.js#sha256=6650dc4dfd9b5ef14cc95a02ae3bb831b13641c154724ab74b771beb90060823
// ==/UserScript==

// CANAL ESTÁVEL — é este que outra pessoa da equipe instala.
//
// A diferença pro smart-table.user.js está só nas URLs acima:
//
//   - @require apontam pro branch `estavel`, que só anda quando uma versão é
//     publicada de propósito. Um push em main não muda nada pra quem está
//     neste canal.
//   - @updateURL/@downloadURL apontam pra main, porque é assim que o
//     Tampermonkey descobre que existe versão nova. Este arquivo é o único
//     que muda em main numa publicação.
//
// POR QUE BRANCH E NÃO TAG (decisão registrada, com o custo à vista): tag é
// imutável, e era o desenho original. Mas a sessão que mantém este projeto
// consegue criar branches e NÃO consegue criar tags (403 do GitHub), então
// com tag toda publicação dependeria de uma ação manual do usuário. Com
// branch, publicar é automatizável de ponta a ponta.
//
// O que se perde: a garantia de que uma versão publicada nunca muda. O que
// se mantém, que era o objetivo real: este canal não se move quando o main
// anda. Só `npm run release` move o branch `estavel`.
//
// NÃO EDITAR À MÃO: o @version deste arquivo é reescrito por
// `npm run release -- <versao>` (scripts/release.js), e tests/wrappers.test.js
// falha se algo sair de sincronia com o smart-table.user.js.
