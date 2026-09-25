// ==UserScript==
// @name         SmartTable — Captura para o Claude (desenvolvimento)
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      2.1.2
// @description  Gera fixtures anonimizadas das telas do CRM para os testes do SmartTable: uma área, a página inteira ou tudo de uma tela num .zip, sem gravar nada no CRM. Shift+Alt+C abre o painel. Ferramenta de desenvolvimento, não é para operadores.
// @author       Isaac
// @match        https://texhub.texcotton.com.br/crm/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/captura-fixture.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/captura-fixture.user.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/scripts/captura-fixture-devtools.js
// ==/UserScript==

// Invólucro do Tampermonkey para scripts/captura-fixture-devtools.js, que
// continua sendo a fonte única (e segue funcionando colado no DevTools).
//
// Instalado À PARTE do SmartTable, só por quem gera fixture: não entra no
// smart-table.user.js nem no canal estável, e nenhum operador recebe.
// tests/wrappers.test.js trava isso.
//
// Com o Tampermonkey o painel não abre sozinho: Shift+Alt+C abre e fecha.
// @grant none pelo mesmo motivo do SmartTable: a captura precisa do window
// da página (showTab, openModalContato, o fetch e o XHR que ela trava).
//
// Para distribuir uma mudança do snippet: suba o @version aqui e o
// VERSAO_CAPTURA de lá juntos. Sem @version novo o Tampermonkey não baixa o
// arquivo de novo.
