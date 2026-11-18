// ==UserScript==
// @name         SmartTable — Ponte do Plano de Regularização (CRM ↔ painel local)
// @namespace    https://github.com/IsaacTexCotton/SmartTable
// @version      0.1.0
// @description  Liga o painel local "CRM Diário" ao CRM: o painel pede, esta ponte aciona o SmartTable na aba do CRM e devolve o andamento e o plano ao painel. Só lê.
// @match        https://texhub.texcotton.com.br/crm/*
// @match        file:///*
// @updateURL    https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/plano-regularizacao-ponte.user.js
// @downloadURL  https://raw.githubusercontent.com/IsaacTexCotton/SmartTable-publico/main/integracoes/plano-regularizacao-ponte.user.js
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==

/*
 * COMO FUNCIONA (pedido do usuário, 18/11/2026: o painel faz tudo sozinho e mostra o processo)
 *
 * O painel é um arquivo local (sem rede, sem acesso ao CRM). Esta ponte roda nas DUAS janelas e conversa por
 * armazenamento compartilhado do Tampermonkey (mesmo padrão da ponte do WhatsApp):
 *
 *   painel  --evento "crm-plano:pedir"-->  ponte(painel)  --GM pedido-->  ponte(CRM)  --window.__planoCarteira.coletar-->  SmartTable
 *   painel  <--evento "crm-plano:estado"--  ponte(painel)  <--GM estado--  ponte(CRM)  <-------- etapas, progresso e plano --------
 *
 *   - A aba do CRM avisa que está viva (batimento) para o painel mostrar "CRM conectado".
 *   - Se várias abas do CRM receberem o pedido, só UMA executa (disputa com confirmação).
 *   - O plano contém nomes e valores de clientes: fica no armazenamento só enquanto trafega e é apagado assim
 *     que o painel o recebe. Nada é gravado no CRM.
 *   - Na janela do painel só age se for mesmo o "CRM Diário" (tem window.CRMBridge e o título certo).
 *
 * REQUISITO: para o Tampermonkey rodar em arquivo local, ligar "Permitir acesso a URLs de arquivo" nas
 * configurações da extensão no Chrome.
 */
(function () {
  'use strict';

  const NS = 'smarttable.plano.regularizacao.v1';
  const KEY_PEDIDO = NS + '.pedido';
  const KEY_DISPUTA = NS + '.disputa';
  const KEY_ESTADO = NS + '.estado';
  const KEY_CRM = NS + '.crm';
  const EVENTO_PEDIR = 'crm-plano:pedir';
  const EVENTO_ESTADO = 'crm-plano:estado';
  const TITULO_DO_PAINEL = 'CRM Diário';

  const PADRAO = Object.freeze({
    BATIMENTO_MS: 4000,
    VIVO_MS: 12000,
    DISPUTA_MS: 250,
    PEDIDO_VALE_MS: 2 * 60 * 1000,
    SEM_CRM_MS: 8000,
  });

  /**
   * @param {{GM: {set: Function, get: Function, onChange: Function}, pagina: object, documento: Document, agora?: Function, config?: object}} deps
   *   `pagina` é a janela da página (no Tampermonkey, `unsafeWindow`); `documento` é onde os eventos trafegam.
   */
  function criarPonte({ GM, pagina, documento, agora = () => Date.now(), config = {} }) {
    const cfg = { ...PADRAO, ...config };
    const idAba = `${agora()}-${Math.random().toString(36).slice(2, 10)}`;
    let seq = 0;

    // -------------------------------------------------------------- lado do CRM
    function iniciarNoCrm() {
      const bater = () => GM.set(KEY_CRM, {
        aba: idAba,
        em: agora(),
        pronto: !!(pagina.__planoCarteira && pagina.__planoRegularizacao),
        naLista: Array.isArray(pagina.CLIENTES),
      });
      bater();
      const timer = setInterval(bater, cfg.BATIMENTO_MS);

      const publicar = (pedidoId, evento) => { seq += 1; GM.set(KEY_ESTADO, { pedidoId, seq, aba: idAba, evento }); };

      const executar = async (pedido) => {
        if (!pagina.__planoCarteira || !pagina.__planoRegularizacao) {
          publicar(pedido.id, { tipo: 'erro', mensagem: 'O SmartTable desta aba não tem o plano de regularização (atualize o SmartTable para a versão 1.127.0 ou mais nova).' });
          return;
        }
        try {
          const pacote = await pagina.__planoCarteira.coletar({ onEvento: (e) => publicar(pedido.id, e) });
          publicar(pedido.id, { tipo: 'resultado', pacote });
        } catch (erro) {
          publicar(pedido.id, { tipo: 'erro', mensagem: String(erro?.message || erro).slice(0, 200) });
        } finally {
          if (GM.get(KEY_PEDIDO, null)?.id === pedido.id) GM.set(KEY_PEDIDO, null);
        }
      };

      GM.onChange(KEY_PEDIDO, (_chave, _antigo, novo) => {
        if (!novo || typeof novo.id !== 'string') return;
        if (agora() - novo.em > cfg.PEDIDO_VALE_MS) return;
        // Disputa: cada aba escreve o seu nome; quem ainda for o nome gravado depois da espera executa.
        GM.set(KEY_DISPUTA, { pedidoId: novo.id, aba: idAba, em: agora() });
        setTimeout(() => {
          const d = GM.get(KEY_DISPUTA, null);
          if (d?.pedidoId === novo.id && d.aba === idAba) executar(novo);
        }, cfg.DISPUTA_MS);
      });
      return () => clearInterval(timer);
    }

    // -------------------------------------------------------------- lado do painel
    function iniciarNoPainel() {
      const emitir = (detalhe) => documento.dispatchEvent(new documento.defaultView.CustomEvent(EVENTO_ESTADO, { detail: JSON.stringify(detalhe) }));
      let pedidoAtual = null;
      let ultimaSeq = -1;
      let timerSemCrm = null;

      const crmVivo = () => {
        const c = GM.get(KEY_CRM, null);
        return !!c && agora() - c.em < cfg.VIVO_MS ? c : null;
      };
      const anunciarCrm = () => {
        const c = crmVivo();
        emitir({ tipo: 'crm', conectado: !!c, pronto: !!c?.pronto, naLista: !!c?.naLista });
      };
      GM.onChange(KEY_CRM, anunciarCrm);
      const timerCrm = setInterval(anunciarCrm, cfg.BATIMENTO_MS);
      anunciarCrm();

      GM.onChange(KEY_ESTADO, (_chave, _antigo, novo) => {
        if (!novo || novo.pedidoId !== pedidoAtual || novo.seq === ultimaSeq) return;
        ultimaSeq = novo.seq;
        clearTimeout(timerSemCrm);
        emitir(novo.evento);
        if (novo.evento.tipo === 'resultado' || novo.evento.tipo === 'erro') {
          // O plano tem dados de cliente: apaga do armazenamento assim que entregou.
          GM.set(KEY_ESTADO, null);
          pedidoAtual = null;
        }
      });

      documento.addEventListener(EVENTO_PEDIR, () => {
        if (pedidoAtual) return emitir({ tipo: 'aviso', mensagem: 'Já há um plano sendo montado.' });
        pedidoAtual = `${agora()}-${Math.random().toString(36).slice(2, 8)}`;
        ultimaSeq = -1;
        GM.set(KEY_ESTADO, null);
        GM.set(KEY_PEDIDO, { id: pedidoAtual, em: agora() });
        emitir({ tipo: 'pedido', id: pedidoAtual });
        clearTimeout(timerSemCrm);
        const id = pedidoAtual;
        timerSemCrm = setTimeout(() => {
          if (pedidoAtual !== id) return;
          emitir({ tipo: 'erro', mensagem: 'Nenhuma aba do CRM respondeu. Abra o CRM (logado) em outra aba, com o SmartTable ativo, e tente de novo.' });
          GM.set(KEY_PEDIDO, null);
          pedidoAtual = null;
        }, cfg.SEM_CRM_MS);
      });
      return () => { clearInterval(timerCrm); clearTimeout(timerSemCrm); };
    }

    return { iniciarNoCrm, iniciarNoPainel, idAba };
  }

  /** É a janela do painel "CRM Diário"? */
  function ehOPainel(pagina, documento) {
    return typeof pagina.CRMBridge === 'object' && pagina.CRMBridge !== null
      && typeof pagina.CRMBridge.offer === 'function'
      && String(documento.title || '').startsWith(TITULO_DO_PAINEL);
  }

  function iniciar(pagina, documento, GM, config) {
    const ponte = criarPonte({ GM, pagina, documento, config });
    if (pagina.location.protocol === 'file:') {
      if (ehOPainel(pagina, documento)) ponte.iniciarNoPainel();
    } else if (pagina.location.hostname === 'texhub.texcotton.com.br') {
      ponte.iniciarNoCrm();
    }
    return ponte;
  }

  if (typeof window !== 'undefined' && window.ST_TEST_MODE) {
    window.__smartTablePlanoPonteTest = { criarPonte, ehOPainel, iniciar, NS, PADRAO };
  } else if (typeof GM_setValue === 'function') {
    const pagina = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    iniciar(pagina, document, {
      set: (k, v) => GM_setValue(k, v),
      get: (k, padrao) => GM_getValue(k, padrao),
      onChange: (k, fn) => GM_addValueChangeListener(k, fn),
    });
  }
})();
