// ==UserScript==
// @name         SmartTable — Automação de Cobrança TexCotton
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      1.79.0
// @description  Automação do fluxo de cobrança no CRM TexCotton: classificação de títulos vencidos, relatório, registrar e enviar, fila de atendimento (normal e por prioridade), atalhos de teclado, alerta de grupo econômico, contexto adicional (promessas/contatos), promessa rápida (Alt+N), painel da carteira e console de diagnóstico.
// @author       Isaac
// @match        https://texhub.texcotton.com.br/crm/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/smart-table.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/smart-table.user.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo0-utilitarios-compartilhados.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo9-painel-configuracoes.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo10-recebido-na-semana.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo26-meta-semanal.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo22-carteira-dados.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo23-carteira-historico.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo14-carteira.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo8-diario.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo16-negociacoes.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo1-aviso-cobranca.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo2-registrar-enviar.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo3-fila-atendimento.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo12-alerta-cliente.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo15-alertas-gerais.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo25-lembretes-bloqueio.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo7-fila-prioridade.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo11-progresso-fila.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo13-console-diagnostico.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo5-alerta-grupo.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo17-promessa-rapida.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo18-log-atualizacoes.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo30-catalogo-mensagens.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo19-mensagens-cobranca.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo20-dom-atalhos.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo21-envio-copia.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo24-busca-rapida.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo27-copiar-titulos.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo28-contatos-google.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo29-contatos-google-lista.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo31-editor-mensagens.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo4-atalhos-teclado.js
// @require      https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/modulos/modulo6-contexto-adicional.js
// ==/UserScript==

// Este arquivo é só o "invólucro" do Tampermonkey (metadados + @require dos
// módulos reais, que continuam em modulos/*.js — fonte única de verdade).
// Não colar lógica aqui: qualquer mudança de comportamento deve ir no módulo
// correspondente em modulos/, e este arquivo só precisa de @version novo
// pra distribuir a atualização pro time.
