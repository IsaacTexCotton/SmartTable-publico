// ===== INICIO - Registrar e Enviar (contato padronizado) =====
//
// Adiciona um botao novo no modal "Registrar Contato", ao lado de
// "Salvar Contato". Ao clicar:
//
//   1. Calcula um resumo padronizado ("Enviado cobranca Xo dia.") a partir
//      da classificacao que o modulo de Aviso de Cobranca ja calcula.
//      Prioridade: titulo no ULTIMO_DIA (6o dia, fluxo cartorio) vence o
//      titulo mais vencido do cliente. EXCECAO: cliente sem nenhum contato
//      registrado ainda registra "Primeiro contato - Tentativa" em vez do
//      dia de atraso (ver ehPrimeiroContato).
//   2. Registra o contato via API com esse resumo (canal=WHATSAPP,
//      resultado=REGISTRO), sem depender do formulario nem do texto que
//      esta na caixa de observacao.
//   3. Abre o WhatsApp com a mensagem que estava na caixa de observacao
//      (a frase padrao que o operador escolheu manualmente) - essa caixa
//      NAO e alterada por este script. Por padrao NENHUMA aba nova e
//      aberta -- navega a propria aba do CRM pro protocolo do WhatsApp
//      Desktop (whatsapp://send?...), que nao troca de pagina (pedido do
//      usuario: Alt-Tab nao pode mais cair numa aba de WhatsApp). Com o
//      interruptor "Enviar pelo WhatsApp Web" ligado no painel Alt+O
//      (Modulo 9), vai pro web.whatsapp.com numa aba FIXA em vez do app.
//
// Depende de duas coisas que ja existem na pagina:
//   - window.__avisoCobranca.simular()  (modulo de Aviso de Cobranca)
//   - window.abrirWhatsAppCliente()     (script proprio da pagina)
// Se qualquer uma faltar, o botao avisa e nao quebra o resto da tela.
//
// Tambem adiciona, logo abaixo do botao "Atencao" (fora da secao de
// Promessa, a pedido do usuario), 3 botoes de agendamento rapido: cada um
// insere uma frase pronta na observacao (reaproveitando o mecanismo nativo
// de "Frases padrao" quando a frase ja existe la) e seleciona a data de
// hoje no campo "Data Prometida" da promessa, num clique so.
//
(function () {
    'use strict';

    if (window.__registrarEEnviarInstalado) return;
    window.__registrarEEnviarInstalado = true;
    window.__smartTableUtil?.registrarModuloCarregado?.('Registrar e Enviar');

    const ENDPOINT_CONTATOS = '/api/crm/contatos';

    // ============================================================
    // RESUMO PADRONIZADO
    // ============================================================

    function maiorAtraso(lista) {
        return lista.reduce((a, b) => (b.diasAtrasoReal > a.diasAtrasoReal ? b : a));
    }

    // PEDIDO DO USUARIO: cliente sem NENHUM contato registrado ainda nao
    // esta em regua de cobranca -- registrar "Enviado cobranca Xo dia."
    // nesse caso conta uma historia errada no CRM (o dia de atraso do
    // titulo nao e o dia de cobranca do cliente). O Alt+A ja trata esse
    // caso na mensagem (so se apresenta e confirma o responsavel, ver
    // semContatoAnterior no Modulo 4), entao a nota do CRM passa a bater
    // com o que foi de fato enviado.
    //
    // semContatoAnterior vem do Modulo 6 (total de .contato-item na aba
    // Contatos === 0). Se o Modulo 6 nao estiver disponivel, cai no
    // comportamento de sempre -- este modulo nunca dependeu dele, entao a
    // ausencia nao pode quebrar nada.
    const RESUMO_PRIMEIRO_CONTATO = 'Primeiro contato - Tentativa';

    function ehPrimeiroContato() {
        return !!(window.__contextoAdicional && window.__contextoAdicional.semContatoAnterior);
    }

    // Reaproveita a classificacao ja calculada pelo modulo de Aviso de
    // Cobranca, em vez de duplicar aqui o calculo de prazos e feriados.
    function calcularResumoPadronizado() {
        if (ehPrimeiroContato()) return RESUMO_PRIMEIRO_CONTATO;

        if (!window.__avisoCobranca || typeof window.__avisoCobranca.simular !== 'function') {
            console.warn('[registrar-enviar] Módulo de Aviso de Cobrança indisponível; usando resumo genérico.');
            return 'Enviado cobrança.';
        }

        let dados;
        try {
            dados = window.__avisoCobranca.simular();
        } catch (erro) {
            console.warn('[registrar-enviar] Falha ao classificar títulos:', erro);
            return 'Enviado cobrança.';
        }

        const registros = dados.registros || [];
        // ACORDO (v1.41.0, AUTORIZADO pelo usuário): com todos os títulos
        // num acordo ATIVA (Módulo 16), a mensagem só fala da parcela -- a
        // nota do CRM conta a mesma história, e não "Enviado cobrança.".
        if (registros.length === 0) {
            const ativa = window.__negociacoes && window.__negociacoes.resumoDeCobranca
                ? window.__negociacoes.resumoDeCobranca().ativa
                : null;
            if (ativa) {
                return ativa.atrasada
                    ? 'Cobrança da parcela ' + ativa.parcela.numero + ' do acordo #' + ativa.acordo.id + '.'
                    : 'Lembrete do acordo #' + ativa.acordo.id + ' - parcela ' + ativa.parcela.numero + '.';
            }
            return 'Enviado cobrança.';
        }

        // CORRIGIDO (bug real, relatado pelo usuário): o criterio antigo so
        // priorizava ULTIMO_DIA -- um titulo em NEGATIVADO_SCPC bem no 19o
        // dia (aviso de suspensao de cadastro) perdia pra qualquer outro
        // titulo do mesmo cliente com mais dias de atraso (ex.: ja em
        // EM_CARTORIO ha mais tempo), fazendo a nota do CRM (e a mensagem
        // do Modulo 4, que espelha esta logica de proposito) citar o
        // titulo errado -- sem nenhuma mencao ao aviso mais urgente do dia.
        // A janela de aviso SCPC (16 a 19 dias -- mesmos limiares do
        // Modulo 4, MANTER SINCRONIZADO se um dia mudarem) agora tem a
        // MESMA prioridade que ULTIMO_DIA.
        const emUltimoDia = registros.filter(r => r.situacaoKey === 'ULTIMO_DIA');
        let escolhido;
        if (emUltimoDia.length > 0) {
            escolhido = maiorAtraso(emUltimoDia);
        } else {
            const emAvisoSuspensaoScpc = registros.filter(
                r => r.situacaoKey === 'NEGATIVADO_SCPC' && r.diasAtrasoReal >= 16 && r.diasAtrasoReal <= 19
            );
            if (emAvisoSuspensaoScpc.length > 0) {
                escolhido = maiorAtraso(emAvisoSuspensaoScpc);
            } else {
                // CORRIGIDO (bug real, relatado pelo usuário): título já
                // EM_CARTORIO saiu da cobrança amigável -- a prioridade de
                // pagamento é sempre um título que AINDA NÃO foi pra
                // cartório, mesmo que ele tenha menos dias de atraso do que
                // o título em cartório. Sem essa regra, um título em
                // cartório há 45 dias vencia um título em atraso inicial há
                // apenas 3 dias só por ter mais dias, fazendo a nota do CRM
                // (e a mensagem do Módulo 4, que espelha esta lógica de
                // propósito) citar o título errado. Só cai pra um título em
                // cartório se literalmente não sobrar nenhum outro.
                const naoCartorio = registros.filter(r => r.situacaoKey !== 'EM_CARTORIO');
                escolhido = naoCartorio.length > 0 ? maiorAtraso(naoCartorio) : maiorAtraso(registros);
            }
        }

        return 'Enviado cobrança ' + escolhido.diasAtrasoReal + 'º dia.';
    }

    // ============================================================
    // FEEDBACK (toast proprio, nao bloqueante - sem alert())
    // ============================================================

    function toast(mensagem, tipo) {
        if (typeof window.showToast === 'function') {
            window.showToast(mensagem, tipo);
            return;
        }
        const cores = tipo === 'error'
            ? { fundo: '#FDF3F1', borda: '#E8C7BE', texto: '#8A2A16' }
            : { fundo: '#EFF6F1', borda: '#B9D9C4', texto: '#1B6B4A' };

        const el = document.createElement('div');
        el.textContent = mensagem;
        Object.assign(el.style, {
            position: 'fixed', bottom: '20px', left: '20px', zIndex: '999999',
            maxWidth: '360px', padding: '12px 16px', borderRadius: '8px',
            background: cores.fundo, border: '1px solid ' + cores.borda, color: cores.texto,
            fontSize: '13px', fontFamily: '-apple-system, Segoe UI, Arial, sans-serif',
            boxShadow: '0 4px 14px rgba(21,26,33,0.18)', lineHeight: '1.4',
            opacity: '0', transition: 'opacity 180ms ease-out'
        });
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 200);
        }, tipo === 'error' ? 6000 : 3500);
    }

    // ============================================================
    // ABRIR WHATSAPP SEM NOVA ABA (item pedido pelo usuário)
    // ============================================================
    // DUAS TENTATIVAS ANTERIORES (removidas, o usuário confirmou que
    // nenhuma resolvia o problema real):
    //   1. Fechar a aba via window.close() num temporizador fixo (1.5s) --
    //      não confiável quando o link dispara o handoff pro app desktop
    //      (diálogo nativo do Chrome compete com o fechamento por script).
    //   2. Reaproveitar a aba com um nome fixo de alvo -- resolvia
    //      "acumular abas", mas não o problema de verdade: mesmo
    //      reaproveitada, a aba SEMPRE rouba o foco ao abrir (comportamento
    //      do navegador -- não tem como um site pedir "abra em segundo
    //      plano", o Chrome bloqueia isso de propósito). O pedido real do
    //      usuário era outro: ao apertar Alt-Tab depois de mandar a
    //      mensagem no app, ele caía nessa aba, não na guia do CRM.
    //
    // ABORDAGEM NOVA (a URL do protocolo foi testada e confirmada AO VIVO
    // pelo usuário antes de implementar -- ver conversa): em vez de abrir
    // QUALQUER aba, navega a própria aba do CRM direto pro protocolo do
    // WhatsApp Desktop (whatsapp://send?phone=...&text=...). Como não é um
    // endereço http(s), o navegador não troca de página -- só entrega pro
    // sistema operacional abrir o app, e a aba do CRM continua exatamente
    // onde estava. Sem aba nova, não existe nada pro Alt-Tab "errar".
    //
    // window.abrirWhatsAppCliente() (função própria da página, fora dos
    // nossos módulos) já faz toda a validação e montagem do telefone
    // (responsável -> celular -> telefone do cadastro, prefixo 55, mínimo
    // de dígitos) antes de chamar window.open(url, '_blank', ...) com a
    // URL do wa.me pronta (https://wa.me/<telefone>?text=<mensagem>).
    // Interceptamos só essa chamada final pra reaproveitar o telefone/
    // mensagem já validados, sem duplicar essa lógica -- se as regras de
    // validação mudarem na página, continuamos sincronizados sem precisar
    // mexer aqui.
    // Separado de abrirWhatsAppSemNovaAba só pra ser testável isoladamente
    // (função pura -- dada a URL do wa.me, devolve a URL do protocolo do
    // WhatsApp Desktop) sem precisar simular a navegação de verdade.
    function construirUrlProtocoloWhatsApp(urlWaMe) {
        const urlAnalisada = new URL(urlWaMe, window.location.href);
        const telefone = urlAnalisada.pathname.replace(/^\/+/, '');
        const mensagem = urlAnalisada.searchParams.get('text') || '';
        return 'whatsapp://send?phone=' + telefone + '&text=' + encodeURIComponent(mensagem);
    }

    // Mesma URL, mas pro WhatsApp WEB (https://web.whatsapp.com/send?...).
    // Pura, pelo mesmo motivo da irmã acima: testável sem simular navegação.
    //
    // PRA QUE SERVE: atender pela conta de OUTRA pessoa sem desvincular a
    // sua do app Desktop. O app tem uma conta logada por vez; o navegador
    // não. Com o interruptor ligado num perfil separado do Chrome, a
    // mensagem sai pela conta logada NAQUELE perfil, e o seu WhatsApp
    // Desktop nunca é tocado. CONFIRMADO AO VIVO pelo usuário antes de
    // implementar: a URL abre a conversa com o texto já preenchido.
    function construirUrlWhatsAppWeb(urlWaMe) {
        const urlAnalisada = new URL(urlWaMe, window.location.href);
        const telefone = urlAnalisada.pathname.replace(/^\/+/, '');
        const mensagem = urlAnalisada.searchParams.get('text') || '';
        return 'https://web.whatsapp.com/send?phone=' + telefone + '&text=' + encodeURIComponent(mensagem);
    }

    // Devolve true se a página chegou a abrir o WhatsApp (chamou window.open
    // com a URL do wa.me). REVISÃO GERAL (29/09/2026, AUTORIZADO pelo
    // usuário, lote D): abrirWhatsAppCliente() pode voltar sem abrir nada
    // (telefone ou mensagem que a página recusa), e o Registrar e Enviar
    // dizia "Contato registrado" como se a mensagem tivesse saído.
    function abrirWhatsAppSemNovaAba() {
        const openOriginal = window.open;
        let abriu = false;

        window.open = function (url) {
            abriu = true;
            // O canal é lido AQUI, no clique, e não no carregamento do
            // módulo: assim virar o interruptor no painel (Alt+O) vale na
            // próxima mensagem, sem recarregar a página. O padrão é o
            // comportamento de sempre (app Desktop) -- quem nunca abriu o
            // painel não tem nada mudando embaixo dos pés, e se o Módulo 0
            // não carregar o `?.` devolve undefined e cai no Desktop.
            if (window.__smartTableUtil?.config?.ligado('usarWhatsAppWeb')) {
                // Aba NOMEADA: a mesma conversa (e as seguintes) reusam
                // sempre esta aba, em vez de empilhar uma por cliente.
                openOriginal(construirUrlWhatsAppWeb(url), 'smarttable_zap');
                return null;
            }
            window.location.href = construirUrlProtocoloWhatsApp(url);
            return null; // valor de retorno não é usado por abrirWhatsAppCliente()
        };

        try {
            window.abrirWhatsAppCliente();
        } finally {
            window.open = openOriginal; // restaura sempre, mesmo se der erro lá dentro
        }
        return abriu;
    }

    // ============================================================
    // ACAO DO BOTAO
    // ============================================================

    async function aoClicarRegistrarEEnviar(evento) {
        evento.preventDefault();
        const botao = evento.currentTarget;

        const textarea = document.getElementById('contato-resumo');
        const mensagem = textarea ? textarea.value.trim() : '';
        if (!mensagem) {
            toast('Selecione uma frase padrão (ou digite a mensagem) antes de registrar e enviar.', 'error');
            return;
        }

        const form = document.getElementById('form-contato');
        const inputCliente = form ? form.querySelector('[name="clienteCodigo"]') : null;
        const clienteCodigo = inputCliente ? inputCliente.value : null;
        if (!clienteCodigo) {
            toast('Não foi possível identificar o cliente. Recarregue a página.', 'error');
            return;
        }

        const checkFixar = document.getElementById('check-fixar-contato');
        const fixado = !!(checkFixar && checkFixar.checked);

        const rotuloOriginal = botao.textContent;
        botao.disabled = true;
        botao.style.opacity = '0.6';
        botao.style.cursor = 'wait';
        botao.textContent = 'Registrando...';

        try {
            const resumoPadronizado = calcularResumoPadronizado();

            const resposta = await fetch(ENDPOINT_CONTATOS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clienteCodigo,
                    canal: 'WHATSAPP',
                    resultado: 'REGISTRO',
                    resumo: resumoPadronizado,
                    fixado: fixado
                })
            });

            const tipoConteudo = resposta.headers.get('content-type') || '';
            if (!tipoConteudo.includes('application/json')) {
                throw new Error('Sessão expirada. Recarregue a página e faça login novamente.');
            }

            const json = await resposta.json();
            if (!resposta.ok || !json.success) {
                throw new Error((json.error && json.error.message) || json.message || 'Erro ao registrar contato.');
            }

            // Abre o WhatsApp com a mensagem que ja estava na caixa de
            // observacao (a frase padrao escolhida pelo operador). A caixa
            // nao foi alterada, entao a funcao da propria pagina le o texto
            // normalmente.
            let whatsAppAbriu = false;
            if (typeof window.abrirWhatsAppCliente === 'function') {
                whatsAppAbriu = abrirWhatsAppSemNovaAba();
            } else {
                console.warn('[registrar-enviar] abrirWhatsAppCliente() não encontrada nesta página.');
            }

            // O contato JÁ está no CRM, mas a mensagem não saiu: nada de
            // "registrado" verde, nada de fechar o contato nem recarregar (a
            // mensagem continua na caixa, pra enviar à mão). O botão fica
            // travado: um segundo clique registraria o contato de novo.
            if (!whatsAppAbriu) {
                toast('O contato FOI registrado no CRM, mas o WhatsApp não abriu (telefone ou mensagem recusados pela página). ' +
                    'Envie a mensagem à mão; não clique de novo, senão o contato é registrado outra vez.', 'error');
                botao.textContent = rotuloOriginal;
                botao.style.cursor = 'not-allowed';
                return;
            }

            toast('Contato registrado: "' + resumoPadronizado + '"', 'success');

            if (typeof window.closeModalContato === 'function') {
                window.closeModalContato();
            }

            // Mesma convencao do "Salvar Contato": recarrega para o novo
            // registro aparecer na aba Contatos/Timeline.
            window.location.hash = 'contatos';
            window.location.reload();

        } catch (erro) {
            console.error('[registrar-enviar]', erro);
            toast(erro.message || 'Não foi possível registrar o contato.', 'error');
            botao.disabled = false;
            botao.style.opacity = '';
            botao.style.cursor = 'pointer';
            botao.textContent = rotuloOriginal;
        }
    }

    // ============================================================
    // AGENDAMENTO RAPIDO (observacao + data de pagamento = hoje)
    // ============================================================
    // PEDIDO DO USUARIO: 3 botoes com frases prontas pra quando o cliente
    // ja avisou algo sobre o pagamento (comprovante, confirmacao verbal ou
    // agendamento) -- cada um preenche a observacao com a frase certa E
    // seleciona a data de hoje no campo "Data Prometida" da promessa, sem
    // precisar digitar nem abrir o seletor de data manualmente.

    const FRASES_AGENDAMENTO_RAPIDO = [
        { rotulo: 'Comprovante enviado', frase: 'Cliente enviou comprovante de pagamento.' },
        { rotulo: 'Cliente informou que pagou', frase: 'Cliente informou que pagou' },
        { rotulo: 'Pagamento agendado', frase: 'Cliente agendou o pagamento.' }
    ];

    function dataDeHojeIso() {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const dia = String(hoje.getDate()).padStart(2, '0');
        return ano + '-' + mes + '-' + dia;
    }

    // Reaproveita o botao nativo de "Frases padrao" quando a frase ja existe
    // la (confirmado com o usuario: as 3 frases usadas aqui ja existem) --
    // evita duplicar o comportamento de insercao (separador, formatacao)
    // que nao e nosso. Comparacao exata em vez de selecionar por atributo
    // (title) pra nao precisar escapar aspas/caracteres especiais da frase.
    function encontrarBotaoFraseNativo(frase) {
        const botoes = document.querySelectorAll('.btn-inserir-frase');
        for (let i = 0; i < botoes.length; i++) {
            if (botoes[i].title === frase) return botoes[i];
        }
        return null;
    }

    function inserirFraseNaObservacao(frase) {
        const botaoNativo = encontrarBotaoFraseNativo(frase);
        if (botaoNativo) {
            botaoNativo.click();
            return;
        }

        // Fallback defensivo, caso a frase deixe de existir na lista nativa
        // -- ainda funciona (acrescenta na observacao), so sem o
        // comportamento exato que a lista nativa teria.
        console.warn('[registrar-enviar] Frase "' + frase + '" não encontrada nas Frases padrão -- inserindo direto na observação.');
        const textarea = document.getElementById('contato-resumo');
        if (!textarea) return;
        const atual = textarea.value.trim();
        textarea.value = atual ? atual + '\n' + frase : frase;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function selecionarDataDePagamentoHoje() {
        const inputData = document.getElementById('input-data-promessa');
        if (!inputData) return;
        inputData.value = dataDeHojeIso();
        // Dispara o onchange nativo (atualizarValorPromessaContato) -- sem
        // isso, o "Valor calculado" (saldo + juros/multa até a data) fica
        // desatualizado, porque so recalcula em resposta a esse evento.
        inputData.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // BUG REAL (relatado pelo usuário): os botões preenchiam a observação e
    // a data, mas a seção de promessa (com a lista de títulos pra marcar)
    // só aparece depois de selecionar "Promessa de Pagamento" como
    // resultado do contato -- sem isso, o campo de data ficava preenchido
    // só que escondido, e não dava pra selecionar título nenhum. Clica no
    // botão nativo de resultado (mesmo que um clique manual do operador
    // faria) pra abrir a seção antes de preencher o resto.
    function selecionarResultadoPromessaDePagamento() {
        const botaoResultado = document.getElementById('btn-resultado-PROMESSA_PAGAMENTO');
        if (!botaoResultado) return;
        botaoResultado.click();
    }

    function aoClicarAgendamentoRapido(frase) {
        selecionarResultadoPromessaDePagamento();
        inserirFraseNaObservacao(frase);
        selecionarDataDePagamentoHoje();
        toast('Promessa de Pagamento selecionada, observação preenchida e data definida para hoje.', 'success');
    }

    function criarBotoesAgendamentoRapido() {
        if (document.getElementById('agendamento-rapido-wrap')) return;

        const btnAtencao = document.getElementById('btn-resultado-ATENCAO');
        if (!btnAtencao || !btnAtencao.parentElement) return;

        // NOTA: classes Tailwind aqui sao restritas de proposito as que ja
        // aparecem literalmente em algum lugar do HTML real da pagina
        // (confirmado via diagnostico ao vivo) -- o build do CRM e
        // pre-compilado e purgado, e uma classe que nenhum template do
        // servidor usa simplesmente nao existe no CSS final, sem erro
        // nenhum (ja aconteceu de verdade neste projeto com "h-64", ver
        // comentario no HTML de Frases padrao). Por isso "indigo-200"/
        // "indigo-50"/"indigo-900" (usados em #valores-por-razao-wrap) e o
        // hover "yellow-400"/"yellow-50" (usado em .resultado-btn,
        // .canal-btn e no proprio botao Atencao) -- nunca uma cor nova so
        // porque "combinaria melhor".
        const wrap = document.createElement('div');
        wrap.id = 'agendamento-rapido-wrap';
        wrap.className = 'mt-2 border-t border-gray-100 space-y-2';

        const rotulo = document.createElement('label');
        rotulo.className = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
        rotulo.textContent = 'Agendar pagamento (observação + data de hoje)';
        wrap.appendChild(rotulo);

        FRASES_AGENDAMENTO_RAPIDO.forEach(function (item) {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-200 ' +
                              'bg-indigo-50 text-indigo-900 text-xs font-medium text-left transition ' +
                              'hover:border-yellow-400 hover:bg-yellow-50';
            botao.title = item.frase + ' (e seleciona a data de hoje)';

            const icone = document.createElement('span');
            icone.textContent = '📅';
            icone.className = 'flex-shrink-0';

            const texto = document.createElement('span');
            texto.textContent = item.rotulo;

            botao.appendChild(icone);
            botao.appendChild(texto);
            botao.addEventListener('click', function () {
                aoClicarAgendamentoRapido(item.frase);
            });

            wrap.appendChild(botao);
        });

        btnAtencao.parentElement.insertBefore(wrap, btnAtencao.nextSibling);
    }

    // ============================================================
    // INSTALACAO DO BOTAO NO MODAL
    // ============================================================

    function criarBotao() {
        if (document.getElementById('btn-registrar-enviar')) return;

        const btnSalvar = document.getElementById('btn-salvar-contato');
        if (!btnSalvar || !btnSalvar.parentElement) return;

        const botao = document.createElement('button');
        botao.type = 'button';
        botao.id = 'btn-registrar-enviar';
        botao.textContent = 'Registrar e Enviar';
        botao.title = 'Registra um resumo padronizado e abre o WhatsApp com a mensagem selecionada.';
        botao.className = 'px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 ' +
                          'text-white rounded-lg font-semibold transition flex items-center gap-2';
        botao.addEventListener('click', aoClicarRegistrarEEnviar);

        // Insere entre "Cancelar" e "Salvar Contato", no mesmo grupo de botoes.
        btnSalvar.parentElement.insertBefore(botao, btnSalvar);
    }

    let _observerInstalacao = null;

    function instalar() {
        if (!document.body) {
            setTimeout(instalar, 100);
            return;
        }

        if (document.getElementById('btn-salvar-contato')) {
            criarBotao();
            criarBotoesAgendamentoRapido();
            return;
        }

        // O modal de contato normalmente ja esta no HTML desde o carregamento
        // da pagina, mas observa por seguranca caso isso mude no futuro.
        if (_observerInstalacao) return;
        _observerInstalacao = new MutationObserver(() => {
            if (document.getElementById('btn-salvar-contato')) {
                _observerInstalacao.disconnect();
                _observerInstalacao = null;
                criarBotao();
                criarBotoesAgendamentoRapido();
            }
        });
        _observerInstalacao.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            if (_observerInstalacao) {
                _observerInstalacao.disconnect();
                _observerInstalacao = null;
            }
        }, 20000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalar);
    } else {
        instalar();
    }

})();
// ===== FIM - Registrar e Enviar (contato padronizado) =====
