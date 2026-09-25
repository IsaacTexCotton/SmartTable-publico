// REMOVIDO (v1.46.0, revisão de código, AUTORIZADO pelo usuário): este
// arquivo começava com uma cópia de ~700 linhas do componente de tabela
// "SmartTable" (o do CRM, que desenha a tabela de títulos) e a publicava em
// window.SmartTable -- SOBRESCREVENDO a do próprio CRM, que a página já
// carrega de /js/components/smart-table.js. Nenhum módulo nosso usava a
// classe; o efeito era só o CRM passar a usar a nossa cópia (possivelmente
// desatualizada) em toda tabela criada depois do carregamento do script.
// O usuário confirmou que não é uma biblioteca dele.

// ===== INICIO - Aviso de Cobranca (v4) =====
//
// Modulo de classificacao e geracao do relatorio de cobranca.
//
// MUDANCAS EM RELACAO A v3:
//   - Paleta refeita: cada situacao passa a ter TINT (fundo da linha) e RAIL
//     (barra saturada de 3px + cor do texto do badge). Codificacao em dois
//     canais sobrevive a compressao do WhatsApp e a impressao em preto e branco.
//   - Todas as combinacoes de fundo/texto validadas em WCAG AA (4.5:1); a
//     maioria em AAA. Tabela de contrastes no comentario de cada situacao.
//   - "Prazo final" saiu do lilas para cinza-quente: o ambar passa a pertencer
//     exclusivamente ao trilho cartorio, eliminando uma colisao em deuteranopia.
//   - Cabecalho em azul-petroleo (#16232F) no lugar de preto.
//   - Numeros com tabular-nums: casas decimais alinhadas em coluna.
//   - Rotulo interno "Verificar posicao" nao vaza para o documento do cliente
//     (ver ROTULOS_INTERNOS_NO_DOCUMENTO abaixo).
//
(function () {
    'use strict';

    if (window.__avisoCobrancaInstalado) return;
    window.__avisoCobrancaInstalado = true;
    window.__smartTableUtil?.registrarModuloCarregado?.('Aviso de Cobrança');

    // ============================================================
    // CONFIGURACAO
    // ============================================================

    // v1.5.8 (usada até a v1.29.13) tem bug de renderização confirmado em
    // elementos inline com padding/border -- o próprio pacote marca a serie
    // 1.5.x como deprecated ("Known rendering bugs exist"). Reproduzido aqui
    // com Playwright + Chromium real, comparando contra o layout nativo do
    // navegador: a 1.5.8 desenha a borda torta/cortando o texto, a 2.4.4
    // (atual) desenha igual ao navegador. Nenhuma das seis rodadas de ajuste
    // de CSS no badge (flexbox, inline-block, span+padding, td com fundo,
    // NBSP, line-height) era necessária -- o defeito sempre esteve na
    // biblioteca, não no HTML/CSS do relatório.
    const HTML2CANVAS_URL =
        'https://unpkg.com/html2canvas-pro@2.4.4/dist/html2canvas-pro.min.js';
    // SEGURANÇA (v1.46.0, revisão de código, AUTORIZADO pelo usuário): o
    // script roda num iframe da MESMA origem do CRM (acesso à sessão). Sem
    // integridade, um pacote/CDN comprometido rodaria como o operador. Hash
    // SHA-384 do arquivo oficial do pacote no npm (html2canvas-pro 2.4.4,
    // dist/html2canvas-pro.min.js -- o mesmo que o unpkg serve). Trocar a
    // versão = recalcular: openssl dgst -sha384 -binary ARQ | openssl base64 -A
    // Arquivo diferente do hash: o navegador recusa, onerror dispara e o
    // relatório cai no plano B (a lib que o próprio CRM já carrega).
    const HTML2CANVAS_INTEGRIDADE = 'sha384-p1jiYALFnUMa2gZZSne9+5HrPM/5ByRopgI0w/sKXu8PNCSFPaaZpZyq+mXGToaD';

    const SELETOR_TABELA = '#tabela-titulos-ds table';

    // BUG REAL (relatado pelo usuário: "o relatório baixa mas às vezes não
    // vai pra área de transferência"): navigator.clipboard.write() exige
    // que o documento esteja em foco -- se o operador já foi pro WhatsApp
    // Desktop (ou qualquer outra janela) enquanto o html2canvas ainda
    // estava capturando a tela, a escrita falhava em silêncio, e só o
    // download (que não depende de foco) acontecia. Teto de segurança pra
    // esperar o foco voltar antes de tentar copiar -- ver aguardarFoco.
    const TIMEOUT_AGUARDAR_FOCO_MS = 8000;

    // "Verificar posicao" e um estado OPERACIONAL: quem verifica e o negociador,
    // nao o cliente. Como a imagem vai por WhatsApp para o devedor, por padrao o
    // documento mostra um rotulo neutro e o termo interno fica apenas no destaque
    // da tela e no console.
    // Coloque true se preferir que o rotulo interno apareca tambem na imagem.
    const ROTULOS_INTERNOS_NO_DOCUMENTO = false;

    // Colunas exigidas, pelo data-key emitido pela SmartTable.
    const COLUNAS_EXIGIDAS = [
        'numeroTitulo',
        'razaoSocial',
        'dataVencimento',
        'posicaoDescricao',
        'valorEmAberto',
        'diasAtraso',
        'portadorDescricao',
        'sequencia'
    ];

    // Portadores que sabidamente demoram mais de 1 dia útil pra atualizar a
    // posicaoDescricao pra CARTORIO no sistema, mesmo com o título já
    // protestado de fato. Comparação sem acento/caixa (ver normalizarTexto).
    const PORTADORES_CARTORIO_LENTO_PARA_ATUALIZAR = ['ITAU'];

    // Valores de posicaoDescricao que significam "não cobrar este título",
    // confirmados com o usuário. Comparação sem acento/caixa (normalizarTexto).
    const POSICOES_EXCLUIDAS_DE_COBRANCA = ['NAO COBRAR', 'CARTEIRA'];

    // Prazo-base em dias corridos a partir do vencimento (vencimento = dia 0).
    const DIAS_PRAZO_BASE = 6;

    // Faixa de atraso considerada "inicial", antes do prazo-base.
    const DIAS_ATRASO_MIN = 1;
    const DIAS_ATRASO_MAX = 5;

    // Feriados especificos da empresa ou do municipio, no formato AAAA-MM-DD.
    // Bancos fechados em feriado municipal contam para o prazo.
    const FERIADOS_ADICIONAIS = [];

    // Feriados nacionais de data fixa.
    const FERIADOS_FIXOS = [
        '01-01', // Confraternizacao Universal
        '04-21', // Tiradentes
        '05-01', // Dia Mundial do Trabalho
        '09-07', // Independencia do Brasil
        '10-12', // Nossa Senhora Aparecida
        '11-02', // Finados
        '11-15', // Proclamacao da Republica
        '12-25'  // Natal
    ];

    // Consciencia Negra so passou a ser feriado nacional em 2024 (Lei 14.759/2023).
    const CONSCIENCIA_NEGRA = { mesDia: '11-20', vigenteA_partir_de: 2024 };

    // ============================================================
    // TOKENS VISUAIS
    // ============================================================
    //
    // Contrastes sobre papel branco:
    //   tinta      17.48:1  AAA
    //   tinta2      6.40:1  AA
    //   branco sobre cabecalho  15.96:1  AAA
    //   atencao     7.18:1  AAA
    //
    const TOKENS = {
        papel:      '#FFFFFF',
        superficie: '#F6F8FA',
        cabecalho:  '#16232F',  // azul-petroleo: le como extrato bancario, nao como template
        tinta:      '#151A21',
        tinta2:     '#55606D',
        divisor:    '#DFE3E8',
        atencao:    '#8A6608'   // marcador de divergencia de dias
    };

    // ============================================================
    // REGISTRO DE SITUACOES
    // ============================================================
    //
    // Fonte unica de verdade: cores, rotulo, ordem na legenda e aviso.
    //
    // Codificacao em dois canais:
    //   tint = fundo da linha        -> agrupamento visual
    //   rail = barra 3px + cor texto -> diferenciacao que sobrevive a P&B
    //
    // Trilhos semanticos (matiz != gravidade):
    //   neutro frio / quente = informativo
    //   vermelho             = acao necessaria hoje
    //   ambar                = trilho cartorio
    //   indigo               = trilho SCPC
    //   violeta              = flag operacional interno
    //
    const SITUACOES = {
        // texto/tint 15.4 AAA | rail/tint 5.96 AA
        EM_ATRASO: {
            ordem: 1,
            rotulo: () => 'Em atraso',
            rotuloLegenda: 'Em atraso (1 a 5 dias)',
            tint: '#EDF1F5', rail: '#4E5D6C', corTexto: '#151A21',
            pintaTela: false
        },
        // texto/tint 15.5 AAA | rail/tint 5.51 AA
        PRAZO_FINAL: {
            ordem: 2,
            rotulo: (reg) => 'Prazo final em ' + formatarDataBr(reg.prazos.dataLimitePagamento),
            rotuloLegenda: 'Prazo final prorrogado (6º dia em dia não útil)',
            tint: '#F5F1EA', rail: '#6B5F52', corTexto: '#151A21',
            pintaTela: false
        },
        // texto/tint 14.9 AAA | rail/tint 6.30 AA
        // Rail e o mais escuro do conjunto (L=9.2%): urgencia por profundidade,
        // nao por vermelho berrante.
        ULTIMO_DIA: {
            ordem: 3,
            rotulo: () => 'Último dia para pagamento',
            rotuloLegenda: 'Último dia para pagamento',
            tint: '#FBE9E3', rail: '#A3251A', corTexto: '#151A21',
            pintaTela: true,
            aviso: {
                titulo: 'Cartório — Último dia para pagamento',
                texto: 'Último dia para regularização. Caso o pagamento não seja identificado ' +
                       'até o final do expediente bancário de hoje, o título será encaminhado ' +
                       'automaticamente para cartório.',
                borda: '#E8D4CC', fundo: '#FDF6F3'
            },
            avisoScpc: {
                titulo: 'SCPC — Último dia antes da negativação',
                texto: 'Após o último dia para ' +
                       'pagamento, o título será encaminhado automaticamente para negativação ' +
                       'junto ao SCPC.',
                borda: '#CDD3EA', fundo: '#F4F6FC'
            }
        },
        // texto/tint 14.2 AAA | rail/tint 5.17 AA
        EM_CARTORIO: {
            ordem: 4,
            rotulo: () => 'Em cartório',
            rotuloLegenda: 'Em cartório',
            tint: '#F8E7B0', rail: '#7A5A0C', corTexto: '#151A21',
            pintaTela: true
        },
        // texto/tint 14.6 AAA | rail/tint 8.28 AAA
        NEGATIVADO_SCPC: {
            ordem: 5,
            rotulo: () => 'Negativado (SCPC)',
            rotuloLegenda: 'Negativado (SCPC)',
            tint: '#E7EAF6', rail: '#313A8C', corTexto: '#151A21',
            pintaTela: true
        },
        // texto/tint 14.8 AAA | rail/tint 7.39 AAA
        VERIFICAR_POSICAO: {
            ordem: 6,
            rotulo: () => 'Verificar posição',
            // Rotulo neutro usado no documento que vai para o cliente.
            rotuloCliente: () => 'Vencido',
            rotuloLegenda: 'Verificar posição no sistema',
            rotuloLegendaCliente: 'Vencido',
            tint: '#EFEAF4', rail: '#54407C', corTexto: '#151A21',
            pintaTela: true
        }
    };

    // Rotulo do badge no documento, respeitando o flag de rotulos internos.
    function rotuloDocumento(situacao, registro) {
        if (!ROTULOS_INTERNOS_NO_DOCUMENTO && situacao.rotuloCliente) {
            return situacao.rotuloCliente(registro);
        }
        return situacao.rotulo(registro);
    }

    function rotuloLegendaDocumento(situacao) {
        if (!ROTULOS_INTERNOS_NO_DOCUMENTO && situacao.rotuloLegendaCliente) {
            return situacao.rotuloLegendaCliente;
        }
        return situacao.rotuloLegenda;
    }

    // ============================================================
    // CALENDARIO
    // ============================================================

    // Meio-dia evita que horario de verao empurre a data para o dia anterior.
    function normalizarData(data) {
        const d = new Date(data);
        d.setHours(12, 0, 0, 0);
        return d;
    }

    function chaveData(data) {
        const ano = data.getFullYear();
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const dia = String(data.getDate()).padStart(2, '0');
        return ano + '-' + mes + '-' + dia;
    }

    function formatarDataBr(data) {
        const dia = String(data.getDate()).padStart(2, '0');
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        return dia + '/' + mes;
    }

    function adicionarDias(data, quantidade) {
        const d = normalizarData(data);
        d.setDate(d.getDate() + quantidade);
        return normalizarData(d);
    }

    function mesmaData(a, b) {
        return normalizarData(a).getTime() === normalizarData(b).getTime();
    }

    function compararDatas(a, b) {
        const ta = normalizarData(a).getTime();
        const tb = normalizarData(b).getTime();
        return ta < tb ? -1 : (ta > tb ? 1 : 0);
    }

    function diferencaEmDias(maior, menor) {
        const ms = normalizarData(maior).getTime() - normalizarData(menor).getTime();
        return Math.round(ms / 86400000);
    }

    // Algoritmo de Meeus/Butcher. Base para os tres feriados moveis brasileiros.
    function calcularPascoa(ano) {
        const a = ano % 19;
        const b = Math.floor(ano / 100);
        const c = ano % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mes = Math.floor((h + l - 7 * m + 114) / 31);
        const dia = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
    }

    // Memoiza por ano: com milhares de linhas, recalcular a cada consulta pesa.
    const _feriadosPorAno = new Map();

    function feriadosDoAno(ano) {
        if (_feriadosPorAno.has(ano)) return _feriadosPorAno.get(ano);

        const pascoa = calcularPascoa(ano);
        const aPartirDaPascoa = (offset) => chaveData(adicionarDias(pascoa, offset));

        const datas = FERIADOS_FIXOS.map(md => ano + '-' + md);

        if (ano >= CONSCIENCIA_NEGRA.vigenteA_partir_de) {
            datas.push(ano + '-' + CONSCIENCIA_NEGRA.mesDia);
        }

        datas.push(aPartirDaPascoa(-48)); // Carnaval (segunda)
        datas.push(aPartirDaPascoa(-47)); // Carnaval (terca)
        datas.push(aPartirDaPascoa(-2));  // Sexta-feira Santa
        datas.push(aPartirDaPascoa(60));  // Corpus Christi

        FERIADOS_ADICIONAIS.forEach(d => datas.push(d));

        const conjunto = new Set(datas);
        _feriadosPorAno.set(ano, conjunto);
        return conjunto;
    }

    function ehFeriado(data) {
        return feriadosDoAno(data.getFullYear()).has(chaveData(data));
    }

    function ehDiaUtil(data) {
        const diaSemana = data.getDay();
        if (diaSemana === 0 || diaSemana === 6) return false;
        return !ehFeriado(data);
    }

    // Se a propria data ja for util, ela e retornada.
    function primeiroDiaUtilAPartirDe(data) {
        let d = normalizarData(data);
        let guarda = 0;
        while (!ehDiaUtil(d)) {
            d = adicionarDias(d, 1);
            if (++guarda > 30) {
                throw new Error('Não foi possível encontrar dia útil a partir de ' + chaveData(data));
            }
        }
        return d;
    }

    // Sempre procura um dia util DEPOIS da data informada.
    function proximoDiaUtil(data) {
        return primeiroDiaUtilAPartirDe(adicionarDias(data, 1));
    }

    function calcularPrazos(dataVencimento) {
        const vencimento = normalizarData(dataVencimento);
        const dataSextoDia = adicionarDias(vencimento, DIAS_PRAZO_BASE);
        const dataLimitePagamento = primeiroDiaUtilAPartirDe(dataSextoDia);
        const dataEncaminhamento = proximoDiaUtil(dataLimitePagamento);
        return { dataVencimento: vencimento, dataSextoDia, dataLimitePagamento, dataEncaminhamento };
    }

    // ============================================================
    // LEITURA DO DOM
    // ============================================================

    // Remove acentos e padroniza caixa -- usado pra comparar texto vindo do
    // CRM (ex.: nome de portador) sem depender de como cada banco foi
    // digitado ("Itaú" vs "ITAU S/A" vs "itau").
    function normalizarTexto(texto) {
        return (texto || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
    }

    function esc(texto) {
        if (texto == null) return '';
        return String(texto).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    function extrairDias(texto) {
        if (!texto) return null;
        const m = texto.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    function converterDataBrasileira(texto) {
        if (!texto) return null;
        const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return null;

        const dia = parseInt(m[1], 10);
        const mes = parseInt(m[2], 10);
        let ano = parseInt(m[3], 10);
        if (ano < 100) ano += 2000;

        const data = new Date(ano, mes - 1, dia, 12, 0, 0, 0);
        const valida = data.getFullYear() === ano
                    && data.getMonth() === mes - 1
                    && data.getDate() === dia;
        return valida ? data : null;
    }

    function localizarTabela() {
        const direta = document.querySelector(SELETOR_TABELA);
        if (direta) return direta;

        // Fallback: le apenas o cabecalho, nao o textContent da tabela inteira.
        const candidatas = document.querySelectorAll('table');
        for (const t of candidatas) {
            const cab = (t.querySelector('thead') || {}).textContent || '';
            const up = cab.toUpperCase();
            if (up.includes('ATRASO') && up.includes('RAZ')) return t;
        }
        return null;
    }

    // Deriva os indices do data-key emitido pela SmartTable, em vez de fixar
    // numeros. Se uma coluna for adicionada, removida ou reordenada, continua
    // funcionando; se sumir de vez, falha com mensagem clara.
    function mapearColunas(tabela) {
        const idx = {};
        tabela.querySelectorAll('thead th[data-key]').forEach((th, i) => {
            idx[th.dataset.key] = i;
        });

        const faltando = COLUNAS_EXIGIDAS.filter(k => idx[k] === undefined);
        if (faltando.length > 0) {
            throw new Error('Coluna não encontrada na tabela: ' + faltando.join(', ') +
                            '. Verifique se a tela de títulos foi alterada.');
        }
        return idx;
    }

    // O campo SCPC fica no cabecalho do cliente. Ha dois <p> com a mesma classe,
    // entao a busca localiza o rotulo "SCPC:" e le o span seguinte.
    function obterValorScpc() {
        const paragrafos = document.querySelectorAll('p.text-sm.text-gray-700.mt-1');
        for (const p of paragrafos) {
            const spans = p.querySelectorAll('span');
            for (let i = 0; i < spans.length; i++) {
                if (spans[i].textContent.trim().toUpperCase() === 'SCPC:') {
                    const valor = spans[i + 1];
                    if (valor) return valor.textContent.trim().toLowerCase();
                }
            }
        }
        return null;
    }

    // ============================================================
    // CLASSIFICACAO
    // ============================================================
    //
    // Funcao pura: mesma entrada, mesma saida. Nao toca no DOM.
    //
    // Ordem de decisao:
    //   1. Posicao CARTORIO no CRM vence qualquer inferencia por data.
    //   2. Antes do prazo-base (1 a 5 dias): atraso inicial.
    //   3. Hoje e a data limite: ultimo dia.
    //   4. Ainda nao chegou na data limite: prazo prorrogado.
    //   5. Passou da data limite: negativado (SCPC) ou verificar posicao (cartorio).
    //
    function classificar(titulo, fluxo, hoje) {
        const { posicao, prazos, diasAtrasoReal, portador } = titulo;

        // posicao já vem em caixa alta (ver coletarRegistros), mas pode
        // chegar acentuada ("CARTÓRIO"); comparamos as duas formas aqui em
        // vez de chamar normalizarTexto() pra não alterar o formato usado
        // no resto da função.
        if (posicao.includes('CARTORIO') || posicao.includes('CARTÓRIO')) return 'EM_CARTORIO';

        if (diasAtrasoReal >= DIAS_ATRASO_MIN && diasAtrasoReal <= DIAS_ATRASO_MAX) {
            return 'EM_ATRASO';
        }

        const comparacao = compararDatas(hoje, prazos.dataLimitePagamento);

        if (comparacao === 0) return 'ULTIMO_DIA';
        if (comparacao < 0) return 'PRAZO_FINAL';

        // Passou do prazo.
        if (fluxo === 'SCPC') return 'NEGATIVADO_SCPC';

        // Fluxo cartorio: o prazo venceu mas o CRM ainda mostra COBRANCA.
        //
        // CORREÇÃO (regra de negócio confirmada pelo usuário): alguns
        // portadores -- Itaú confirmado -- demoram mais de um dia útil pra
        // atualizar a posicaoDescricao pra CARTORIO no sistema, mesmo com o
        // título já protestado de fato. Pra esses portadores, uma vez que o
        // prazo já passou, tratamos como EM_CARTORIO mesmo sem essa
        // confirmação explícita do CRM -- em vez de esperar um dado que,
        // pra esses bancos, sabidamente chega atrasado.
        const portadorNormalizado = normalizarTexto(portador);
        const ehPortadorLentoParaAtualizar = PORTADORES_CARTORIO_LENTO_PARA_ATUALIZAR.some(
            (nome) => portadorNormalizado.includes(nome)
        );
        if (ehPortadorLentoParaAtualizar) return 'EM_CARTORIO';

        // Outros portadores: nao assumimos que foi para cartorio; sinalizamos
        // para conferencia manual.
        return 'VERIFICAR_POSICAO';
    }

    // ============================================================
    // COLETA
    // ============================================================

    // FONTE DOS TÍTULOS (v1.45.0, AUTORIZADO pelo usuário: "aceitar uma
    // lista de títulos, sem mudar nenhuma regra de classificação"). A
    // página do cliente baixada por fetch (Alt+U sem abrir aba) não tem a
    // tabela desenhada -- ela traz os MESMOS dados em __TITULOS_ABERTOS__, que
    // a SmartTable do CRM usa pra desenhar a tabela. Cada título vira aqui o
    // MESMO texto que a célula mostraria (confirmado na fixture real:
    // "14/09/2026", "7 dias"/"Em dia", posição/portador como vêm), e passa
    // pelo MESMO laço e pela MESMA classificar() da tabela da tela.
    function isoParaDataBrasileira(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    function textoDoTituloComoNaTabela(t, chave) {
        const v = t ? t[chave] : undefined;
        if (chave === 'dataVencimento') return isoParaDataBrasileira(v);
        if (chave === 'diasAtraso') return (typeof v === 'number' && v > 0) ? v + ' dias' : 'Em dia';
        if (chave === 'valorEmAberto') {
            return typeof v === 'number' && isFinite(v)
                ? 'R$\u00a0' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '';
        }
        return v === null || v === undefined ? '' : String(v).trim();
    }

    /**
     * @param {Date} hoje
     * @param {{titulos: object[], scpc: string|null, tituloEmAcordo?: Function}} [fonte]
     *   Sem fonte: a tabela desta página (o de sempre). Com fonte: a lista
     *   de títulos de outra página (__TITULOS_ABERTOS__), o SCPC dela ("s"/"n")
     *   e quem responde "este título está em acordo?" pra ELA.
     */
    function coletarRegistros(hoje, fonte) {
        let linhasFonte;
        let scpc;
        let tituloEmAcordo = window.__negociacoes?.tituloEmAcordo;
        if (fonte) {
            if (!Array.isArray(fonte.titulos)) throw new Error('Lista de títulos inválida.');
            linhasFonte = fonte.titulos.map((t) => ({ linha: null, ler: (chave) => textoDoTituloComoNaTabela(t, chave) }));
            scpc = typeof fonte.scpc === 'string' ? fonte.scpc.trim().toLowerCase() : null;
            tituloEmAcordo = fonte.tituloEmAcordo;
        } else {
            const tabela = localizarTabela();
            if (!tabela) {
                throw new Error('Tabela de títulos não encontrada nesta página.');
            }
            const idx = mapearColunas(tabela);
            scpc = obterValorScpc();
            linhasFonte = [];
            tabela.querySelectorAll('tbody tr').forEach((linha) => {
                const celulas = linha.querySelectorAll('td');
                linhasFonte.push({
                    linha,
                    vazia: celulas.length === 0,
                    ler: (chave) => (celulas[idx[chave]] ? celulas[idx[chave]].textContent.trim() : ''),
                });
            });
        }
        const fluxo = scpc === 's' ? 'SCPC' : 'CARTORIO';

        const registros = [];
        const ignorados = [];
        const naoCobrar = [];
        // ACORDO (v1.41.0, AUTORIZADO pelo usuário: "tirar do relatório os
        // títulos que estão no acordo"): título de acordo ATIVA ou CONCLUIDA
        // (Módulo 16) não é cobrado -- fica aqui, fora do relatório e da
        // mensagem. Sem o Módulo 16, nada muda.
        const emAcordo = [];

        linhasFonte.forEach(({ linha, vazia, ler }, ordem) => {
            try {
                if (vazia) return;

                const vencimentoTexto = ler('dataVencimento');
                const dataVencimento = converterDataBrasileira(vencimentoTexto);

                if (!dataVencimento) {
                    ignorados.push({ ordem, motivo: 'vencimento ilegível: "' + vencimentoTexto + '"' });
                    return;
                }

                const diasAtrasoReal = diferencaEmDias(hoje, dataVencimento);

                // Titulo a vencer nao entra no relatorio.
                if (diasAtrasoReal < DIAS_ATRASO_MIN) return;

                const diasInformados = extrairDias(ler('diasAtraso'));

                const registro = {
                    linha,
                    ordem,
                    titulo: ler('numeroTitulo'),
                    parcela: ler('sequencia'),
                    // Formato "901968/4" -- mesmo padrão usado na tela de
                    // Promessas, pra permitir cruzar título da promessa
                    // com título da tabela principal.
                    tituloCompleto: ler('numeroTitulo') + '/' + ler('sequencia'),
                    razaoSocial: ler('razaoSocial'),
                    vencimentoTexto,
                    saldoTexto: ler('valorEmAberto'),
                    posicao: ler('posicaoDescricao').toUpperCase(),
                    portador: ler('portadorDescricao'),
                    diasAtrasoReal,
                    diasInformados,
                    // Divergencia entre o que o CRM mostra e o que calculamos aqui.
                    // Costuma indicar dado desatualizado no ERP.
                    divergenciaDias: diasInformados !== null && diasInformados !== diasAtrasoReal,
                    prazos: calcularPrazos(dataVencimento),
                    fluxo
                };

                // SEGURANÇA (bug real reportado pelo usuário: cliente foi
                // cobrado por engano com título marcado "NÃO COBRAR" no CRM).
                // Confirmado no HTML real: "NAO COBRAR" e "CARTEIRA" são
                // valores possíveis de posicaoDescricao (junto de
                // "COBRANCA"/"CARTORIO") -- confirmado com o usuário que
                // AMBOS significam "não cobrar este título". Nunca entram em
                // registros -- ficam de fora do relatório, da mensagem do
                // Alt+A e da nota do Módulo 2, não importa os dias de
                // atraso. Guardados à parte só pra rastreabilidade/aviso
                // visual (ver avisarSeNaoCobrar mais abaixo).
                const posicaoNormalizada = normalizarTexto(registro.posicao);
                const motivoExclusao = POSICOES_EXCLUIDAS_DE_COBRANCA.find((p) => posicaoNormalizada.includes(p));
                if (motivoExclusao) {
                    naoCobrar.push(registro);
                    return;
                }

                registro.situacaoKey = classificar(registro, fluxo, hoje);
                if (tituloEmAcordo?.(registro.tituloCompleto)) {
                    emAcordo.push(registro);
                    return;
                }
                registros.push(registro);

            } catch (erro) {
                ignorados.push({ ordem, motivo: erro.message });
            }
        });

        if (ignorados.length > 0) {
            console.warn('[aviso-cobranca] ' + ignorados.length + ' linha(s) ignorada(s):', ignorados);
        }

        // SEGURANÇA (regra de negócio confirmada pelo usuário): se TODOS os
        // títulos vencidos do cliente já estão em cartório (nenhum em outra
        // situação), não cobramos -- o processo já saiu da cobrança
        // amigável. Mesmo tratamento que NAO COBRAR/CARTEIRA acima: os
        // títulos saem de "registros" e entram em "naoCobrar", disparando o
        // banner fixo (avisarSeNaoCobrar) e tirando o cliente da mensagem
        // automática do Alt+A. Só com 1+ título -- cliente sem nenhum
        // título vencido não teria "registros" mesmo antes desta regra.
        if (registros.length > 0 && registros.every(r => r.situacaoKey === 'EM_CARTORIO')) {
            naoCobrar.push(...registros);
            registros.length = 0;
        }

        const divergentes = registros.filter(r => r.divergenciaDias);
        if (divergentes.length > 0) {
            console.warn('[aviso-cobranca] Divergência entre dias do CRM e dias calculados:',
                divergentes.map(r => ({
                    titulo: r.titulo,
                    crm: r.diasInformados,
                    calculado: r.diasAtrasoReal,
                    vencimento: r.vencimentoTexto
                })));
        }

        return { registros, fluxo, scpc, ignorados, divergentes, naoCobrar, emAcordo };
    }

    // ============================================================
    // DESTAQUE NA TELA
    // ============================================================
    //
    // Usa classe CSS em vez de style inline: a SmartTable recria o tbody ao
    // ordenar ou filtrar. O box-shadow inset desenha o rail sem deslocar o
    // layout de colunas ja calculado pela SmartTable.
    //
    let _estiloInjetado = false;

    function injetarEstilos() {
        if (_estiloInjetado) return;
        _estiloInjetado = true;

        const regras = Object.keys(SITUACOES)
            .filter(k => SITUACOES[k].pintaTela)
            .map(k => {
                const s = SITUACOES[k];
                const cls = '.cob-' + k.toLowerCase();
                return cls + ' > td {' +
                       ' background-color: ' + s.tint + ' !important;' +
                       ' color: ' + s.corTexto + ' !important; }\n' +
                       cls + ' > td:first-child {' +
                       ' box-shadow: inset 3px 0 0 ' + s.rail + '; }';
            })
            .join('\n');

        const estilo = document.createElement('style');
        estilo.id = 'aviso-cobranca-estilos';
        estilo.textContent = regras;
        document.head.appendChild(estilo);
    }

    function limparDestaques(tabela) {
        tabela.querySelectorAll('tbody tr').forEach(tr => {
            tr.className = tr.className.replace(/\bcob-\S+/g, '').trim();
            tr.style.backgroundColor = '';
        });
    }

    function aplicarDestaques(registros) {
        registros.forEach(r => {
            const s = SITUACOES[r.situacaoKey];
            if (s.pintaTela && r.linha && r.linha.isConnected) {
                r.linha.classList.add('cob-' + r.situacaoKey.toLowerCase());
            }
        });
    }

    // A SmartTable recria as linhas em cada ordenacao/filtro, o que apagaria os
    // destaques. O observer reaplica pelo indice da linha.
    let _observer = null;

    function observarTabela(tabela, registros) {
        if (_observer) _observer.disconnect();

        const tbody = tabela.querySelector('tbody');
        if (!tbody) return;

        const porOrdem = new Map(registros.map(r => [r.ordem, r.situacaoKey]));

        _observer = new MutationObserver(() => {
            tbody.querySelectorAll('tr').forEach((tr, i) => {
                const key = porOrdem.get(i);
                if (key && SITUACOES[key].pintaTela) {
                    tr.classList.add('cob-' + key.toLowerCase());
                }
            });
        });

        _observer.observe(tbody, { childList: true });
    }

    // ============================================================
    // RELATORIO
    // ============================================================

    function montarLinhas(registros) {
        return registros.map(r => {
            const s = SITUACOES[r.situacaoKey];
            const celula = 'padding:11px 14px; border-bottom:1px solid ' + TOKENS.divisor +
                           '; color:' + s.corTexto + ';';
            // nowrap: com razão social longa, a tabela (layout automático)
            // espreme as demais colunas até a largura mínima do conteúdo --
            // sem isso "R$ 1.651,96" e o badge "Negativado (SCPC)" quebravam
            // em duas linhas. A coluna Cliente absorve a quebra no lugar.
            const numerica = celula + ' font-variant-numeric:tabular-nums; white-space:nowrap;';

            // Marcador discreto quando o CRM e o calculo divergem.
            const marca = r.divergenciaDias
                ? ' <span title="Dias informados pelo CRM: ' + r.diasInformados + '" ' +
                  'style="color:' + TOKENS.atencao + '; font-weight:700;">*</span>'
                : '';

            return '<tr style="background:' + s.tint + ';">' +
                // Rail: barra de cor a esquerda. Segundo canal de diferenciacao,
                // legivel mesmo em preto e branco ou sob compressao.
                '<td style="' + celula + ' font-weight:600; border-left:3px solid ' + s.rail + ';">' +
                    esc(r.titulo) + '</td>' +
                '<td style="' + numerica + ' text-align:center;">' + esc(r.parcela) + '</td>' +
                '<td style="' + celula + '">' + esc(r.razaoSocial) + '</td>' +
                '<td style="' + numerica + ' text-align:center;">' + esc(r.vencimentoTexto) + '</td>' +
                '<td style="' + numerica + ' text-align:right;">' + esc(r.saldoTexto) + '</td>' +
                '<td style="' + numerica + ' text-align:center;">' +
                    r.diasAtrasoReal + ' dias' + marca + '</td>' +
                // CAUSA RAIZ DE VERDADE (depois de seis rodadas de ajuste de
                // CSS que não resolviam de vez): não era o HTML/CSS do badge,
                // era a versão da lib html2canvas-pro (ver comentário em
                // HTML2CANVAS_URL). Confirmado reproduzindo com Playwright +
                // Chromium real -- o badge original (com padding/border-
                // radius) renderiza perfeito na 2.4.4. Badge vazado: contorno
                // + texto no rail. Le melhor que fundo solido sobre uma
                // linha que ja e colorida.
                '<td style="' + celula + ' text-align:center; white-space:nowrap;">' +
                    '<span style="padding:3px 9px; border-radius:3px; ' +
                    'font-size:11.5px; font-weight:700; letter-spacing:0.01em; ' +
                    'border:1px solid ' + s.rail + '; color:' + s.rail + '; ' +
                    'background:rgba(255,255,255,0.55);">' +
                    esc(rotuloDocumento(s, r)) + '</span>' +
                '</td>' +
            '</tr>';
        }).join('');
    }

    function montarLegenda(registros) {
        const usadas = new Set(registros.map(r => r.situacaoKey));

        return Object.keys(SITUACOES)
            .filter(k => usadas.has(k))
            .sort((a, b) => SITUACOES[a].ordem - SITUACOES[b].ordem)
            .map(k => {
                const s = SITUACOES[k];
                return '<div style="display:flex; align-items:center; gap:6px; font-size:11px; ' +
                    'color:' + TOKENS.tinta2 + ';">' +
                    // Amostra reproduz o par tint+rail da linha, nao um quadrado chapado.
                    '<span style="width:16px; height:12px; border-radius:2px; flex-shrink:0; ' +
                    'background:' + s.tint + '; border-left:3px solid ' + s.rail + ';"></span>' +
                    esc(rotuloLegendaDocumento(s)) + '</div>';
            })
            .join('');
    }

    function montarAvisos(registros, fluxo, hoje) {
        // O aviso so aparece quando hoje e de fato o ultimo dia de algum titulo.
        const temUltimoDia = registros.some(r =>
            r.situacaoKey === 'ULTIMO_DIA' && mesmaData(r.prazos.dataLimitePagamento, hoje)
        );
        if (!temUltimoDia) return '';

        const cfg = fluxo === 'SCPC' ? SITUACOES.ULTIMO_DIA.avisoScpc : SITUACOES.ULTIMO_DIA.aviso;
        const corBarra = fluxo === 'SCPC'
            ? SITUACOES.NEGATIVADO_SCPC.rail
            : SITUACOES.ULTIMO_DIA.rail;

        return '<div style="display:flex; gap:10px; margin-top:16px; width:100%; ' +
            'flex-wrap:wrap; box-sizing:border-box;">' +
            '<div style="flex:1; min-width:280px; padding:11px 13px; border:1px solid ' + cfg.borda +
            '; border-left:3px solid ' + corBarra + '; background:' + cfg.fundo +
            '; border-radius:4px; box-sizing:border-box;">' +
                '<div style="font-size:11.5px; font-weight:700; color:' + corBarra +
                '; margin-bottom:4px;">' + esc(cfg.titulo) + '</div>' +
                '<div style="font-size:10.5px; line-height:1.45; color:' + TOKENS.tinta2 + ';">' +
                    esc(cfg.texto) + '</div>' +
            '</div></div>';
    }

    function montarRodape(divergentes) {
        if (divergentes.length === 0) return '';
        return '<div style="margin-top:10px; font-size:10px; color:' + TOKENS.tinta2 + ';">' +
            '<span style="color:' + TOKENS.atencao + '; font-weight:700;">*</span> ' +
            'Dias de atraso calculados a partir da data de vencimento. ' +
            divergentes.length + ' título(s) apresentam contagem diferente da exibida no sistema.' +
            '</div>';
    }

    // Converte texto de moeda em formato brasileiro ("R$ 1.234,56") pra
    // número -- remove separador de milhar (.) e troca a vírgula decimal
    // por ponto. Retorna null se não conseguir reconhecer um número.
    function converterMoedaBrasileira(texto) {
        if (!texto) return null;
        const limpo = String(texto).replace(/[^\d,.-]/g, '').trim();
        if (!limpo) return null;
        const numerico = limpo.replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(numerico);
        return Number.isFinite(valor) ? valor : null;
    }

    function formatarMoedaBrasileira(valor) {
        return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // Cartão de total: só faz sentido com 2+ títulos (com 1 só, seria igual
    // ao saldo já mostrado na própria linha) -- CONFIRMADO com o usuário.
    function montarTotalizador(registros) {
        if (registros.length <= 1) return '';

        const valores = registros.map(r => converterMoedaBrasileira(r.saldoTexto));
        const semValorReconhecido = valores.filter(v => v === null).length;
        if (semValorReconhecido > 0) {
            console.warn('[aviso-cobranca] ' + semValorReconhecido + ' saldo(s) não reconhecido(s) como valor ' +
                'monetário -- ficaram de fora do Valor Total do relatório.');
        }

        const total = valores.reduce((soma, v) => soma + (v || 0), 0);

        // Cartão de resumo, não uma linha "grudada" na tabela -- mesma
        // linguagem visual do cabeçalho (fundo escuro, texto branco) pra
        // ler como o total de um extrato, não como um dado jogado a mais.
        return '<div style="display:flex; justify-content:space-between; align-items:center; ' +
            'margin-top:12px; padding:9px 16px; background:' + TOKENS.cabecalho + '; ' +
            'border-radius:6px; box-sizing:border-box;">' +
                '<div style="font-size:11px; font-weight:600; letter-spacing:0.03em; ' +
                'color:rgba(255,255,255,0.7); text-transform:uppercase;">' +
                    registros.length + ' títulos vencidos</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-size:10px; font-weight:600; letter-spacing:0.03em; ' +
                    'color:rgba(255,255,255,0.7); text-transform:uppercase; margin-bottom:1px;">' +
                        'Valor total</div>' +
                    '<div style="font-size:16px; font-weight:700; color:#FFFFFF; ' +
                    'font-variant-numeric:tabular-nums;">' +
                        esc(formatarMoedaBrasileira(total)) + '</div>' +
                '</div>' +
            '</div>';
    }

    function montarRelatorio(dados, hoje) {
        const { registros, fluxo, divergentes } = dados;

        const dataHora = new Date().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const th = 'padding:11px 14px; color:#FFFFFF; font-weight:600; font-size:11.5px;';

        return '<div style="width:900px; font-family:-apple-system,\'Segoe UI\',Arial,sans-serif; ' +
            'background:' + TOKENS.papel + '; padding:32px; box-sizing:border-box; ' +
            'color:' + TOKENS.tinta + ';">' +

            // CABECALHO
            '<div style="display:flex; justify-content:space-between; align-items:flex-end; ' +
            'border-bottom:2px solid ' + TOKENS.cabecalho + '; padding-bottom:16px; ' +
            'margin-bottom:22px;">' +
                '<div>' +
                    '<div style="font-size:21px; font-weight:700; color:' + TOKENS.tinta +
                    '; letter-spacing:-0.2px;">Relatório</div>' +
                    '<div style="font-size:13px; color:' + TOKENS.tinta2 + '; margin-top:4px;">' +
                        'Títulos vencidos em aberto</div>' +
                '</div>' +
                '<div style="font-size:12px; color:' + TOKENS.tinta2 + '; text-align:right;">' +
                    'Gerado em<br>' +
                    '<strong style="color:' + TOKENS.tinta + '; font-variant-numeric:tabular-nums;">' +
                    dataHora + '</strong></div>' +
            '</div>' +

            // TABELA
            '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
                '<thead><tr style="background:' + TOKENS.cabecalho + ';">' +
                    '<th style="' + th + ' text-align:left;">Título</th>' +
                    '<th style="' + th + ' text-align:center;">Parcela</th>' +
                    '<th style="' + th + ' text-align:left;">Cliente</th>' +
                    '<th style="' + th + ' text-align:center;">Vencimento</th>' +
                    '<th style="' + th + ' text-align:right;">Saldo</th>' +
                    '<th style="' + th + ' text-align:center;">Atraso</th>' +
                    '<th style="' + th + ' text-align:center;">Situação</th>' +
                '</tr></thead>' +
                '<tbody>' + montarLinhas(registros) + '</tbody>' +
            '</table>' +

            montarTotalizador(registros) +

            // LEGENDA
            '<div style="display:flex; gap:16px; margin-top:14px; padding:10px 12px; ' +
            'background:' + TOKENS.superficie + '; border-radius:4px; flex-wrap:wrap;">' +
                montarLegenda(registros) + '</div>' +

            montarAvisos(registros, fluxo, hoje) +
            montarRodape(divergentes) +

        '</div>';
    }

    // ============================================================
    // EXPORTACAO
    // ============================================================

    // BUG REAL (diagnosticado no console do operador, v1.29.14): o CRM já
    // carrega um html2canvas 1.x PRÓPRIO na página (typeof window.html2canvas
    // === 'function' antes do SmartTable carregar qualquer coisa, e nenhuma
    // <script> nossa existia no DOM). A versão antiga desta função fazia
    // "if (typeof html2canvas !== 'undefined') return window.html2canvas" --
    // ou seja, reaproveitava em silêncio a lib do CRM, que tem o bug de borda
    // torta em elementos inline, e NUNCA carregava a versão fixada em
    // HTML2CANVAS_URL. Agora a nossa versão é carregada DENTRO do iframe de
    // captura (window próprio, sem conflito de global): o CRM continua com a
    // lib dele intocada (não quebra o botão de Print nativo) e o relatório
    // sempre usa a versão que a gente escolheu e testou.
    const TIMEOUT_CARREGAR_HTML2CANVAS_MS = 15000;
    let _origemUltimaCaptura = null;

    function carregarHtml2CanvasNoIframe(iframe) {
        return new Promise((resolver, rejeitar) => {
            const doc = iframe.contentDocument;
            const script = doc.createElement('script');
            const timer = setTimeout(() => {
                rejeitar(new Error('tempo esgotado carregando ' + HTML2CANVAS_URL));
            }, TIMEOUT_CARREGAR_HTML2CANVAS_MS);
            script.integrity = HTML2CANVAS_INTEGRIDADE;
            script.crossOrigin = 'anonymous';
            script.src = HTML2CANVAS_URL;
            script.onload = () => {
                clearTimeout(timer);
                const lib = iframe.contentWindow.html2canvas;
                if (typeof lib === 'function') resolver(lib);
                else rejeitar(new Error('script carregou mas não definiu html2canvas'));
            };
            script.onerror = () => {
                clearTimeout(timer);
                rejeitar(new Error('falha de rede/CSP carregando ' + HTML2CANVAS_URL));
            };
            doc.head.appendChild(script);
        });
    }

    // Plano B: se a nossa versão não carregar (CSP do CRM bloqueando o CDN,
    // rede fora), usa a lib que já estiver na página -- o relatório sai com
    // o visual antigo, mas sai. Melhor que não gerar relatório nenhum.
    function carregarHtml2CanvasDaPagina() {
        if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
        return Promise.reject(new Error('Não foi possível carregar a biblioteca de captura. ' +
                                        'Verifique a conexão.'));
    }

    async function obterHtml2Canvas(iframe) {
        try {
            const lib = await carregarHtml2CanvasNoIframe(iframe);
            _origemUltimaCaptura = HTML2CANVAS_URL;
            return lib;
        } catch (erro) {
            console.warn('[aviso-cobranca] Não consegui carregar a versão própria do html2canvas (' +
                         erro.message + ') -- usando a da página, o visual do relatório pode sair torto.');
            const lib = await carregarHtml2CanvasDaPagina();
            _origemUltimaCaptura = 'html2canvas da própria página (plano B)';
            return lib;
        }
    }

    // Aquece o cache HTTP do navegador sem EXECUTAR o script (executar na
    // janela principal sobrescreveria o html2canvas do CRM).
    function aquecerHtml2Canvas() {
        if (document.querySelector('link[data-smarttable-html2canvas]')) return;
        const link = document.createElement('link');
        link.rel = 'prefetch';
        // Mesmo modo (CORS) do <script> com integrity: senão o cache aquecido
        // não serve pra ele.
        link.crossOrigin = 'anonymous';
        link.href = HTML2CANVAS_URL;
        link.setAttribute('data-smarttable-html2canvas', '');
        document.head.appendChild(link);
    }

    function gerarNomeArquivo() {
        const agora = new Date();
        const p = n => String(n).padStart(2, '0');
        return 'relatorio-cobranca-' +
               agora.getFullYear() + p(agora.getMonth() + 1) + p(agora.getDate()) + '-' +
               p(agora.getHours()) + p(agora.getMinutes()) + '.png';
    }

    // Cópia local -- o Módulo 4 tem a sua própria versão desta mesma função
    // (aguardarFoco), e módulos protegidos mantêm cópias locais de
    // propósito (ver README). Resolve assim que o documento tem foco, ou
    // depois que o timeout esgota (nesse caso a tentativa de copiar segue
    // mesmo assim -- pode falhar de novo, mas não trava o Alt+A/Alt+R pra
    // sempre esperando um foco que talvez nunca volte).
    function aguardarFoco(timeoutMs) {
        if (document.hasFocus()) return Promise.resolve();
        return new Promise((resolve) => {
            let resolvido = false;
            const finalizar = () => {
                if (resolvido) return;
                resolvido = true;
                window.removeEventListener('focus', aoGanharFoco);
                resolve();
            };
            const aoGanharFoco = () => finalizar();
            window.addEventListener('focus', aoGanharFoco);
            setTimeout(finalizar, timeoutMs);
        });
    }

    // Guarda a última imagem gerada -- ver recopiarUltimaImagem logo abaixo.
    let _ultimaImagemBlob = null;

    // BUG REAL (relatado pelo usuário, com prints: badge "Em atraso" cortado
    // e deslocado no canto direito da tabela -- duas correções anteriores,
    // v1 (wrapper flexbox) e v2 (remover inline-block), NÃO resolveram, e a
    // v2 até piorou). CAUSA RAIZ: capturarEExportar anexava o container
    // direto em document.body -- ou seja, DENTRO do mesmo documento da
    // página do CRM. Como o HTML do relatório usa tags soltas (table, tr,
    // td, span) sem classe nenhuma, QUALQUER regra CSS do CRM que mire
    // essas tags genericamente (ex.: "table { table-layout: fixed }" da
    // grade de títulos, encolhendo a coluna Situação abaixo da largura do
    // badge) valia também pro nosso relatório -- por isso nenhuma das duas
    // correções anteriores, focadas só no CSS do PRÓPRIO badge, resolvia:
    // o problema nunca esteve lá. Um <iframe> tem um DOCUMENTO separado --
    // nenhuma regra CSS da página cruza essa fronteira (garantido pela
    // especificação, não é um truque frágil), então o relatório fica imune
    // a qualquer estilo do CRM, atual ou futuro.
    async function capturarEExportar(html) {
        const iframe = document.createElement('iframe');
        Object.assign(iframe.style, {
            position: 'fixed', top: '-9999px', left: '-9999px', border: '0', width: '1000px', height: '3000px',
        });
        document.body.appendChild(iframe);

        try {
            const doc = iframe.contentDocument;
            doc.open();
            doc.write('<!doctype html><html><head></head><body style="margin:0;"></body></html>');
            doc.close();
            doc.body.innerHTML = html;
            const container = doc.body.firstElementChild;

            const lib = await obterHtml2Canvas(iframe);
            const canvas = await lib(container, {
                backgroundColor: TOKENS.papel,
                scale: 2,
                width: container.scrollWidth,
                height: container.scrollHeight,
                windowWidth: container.scrollWidth,
                windowHeight: container.scrollHeight,
            });
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            if (!blob) throw new Error('Falha ao converter o relatório em imagem.');
            _ultimaImagemBlob = blob;

            let copiado = false;
            if (navigator.clipboard && window.ClipboardItem) {
                try {
                    await aguardarFoco(TIMEOUT_AGUARDAR_FOCO_MS);
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    copiado = true;
                } catch (erro) {
                    console.warn('[aviso-cobranca] Cópia para a área de transferência falhou:', erro);
                }
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = gerarNomeArquivo();
            link.href = url;
            document.body.appendChild(link);
            link.click();
            link.remove();
            // Revogar de imediato pode abortar o download em alguns navegadores.
            setTimeout(() => URL.revokeObjectURL(url), 10000);

            return { copiado };
        } finally {
            iframe.remove();
        }
    }

    // BUG REAL, PRIORIDADE TOTAL (relatado pelo usuário: "no Alt+R sempre
    // copia, no Alt+A a maioria das vezes não vai pra área de
    // transferência"): o Alt+A gera o relatório (imagem vai pra área de
    // transferência) e, logo em seguida, escreve a mensagem -- que dispara
    // um laço em segundo plano (Módulo 4, copiarPartesParaAreaDeTransferencia)
    // copiando cada PARTE DE TEXTO da mensagem pra área de transferência,
    // uma de cada vez, pro histórico do Win+V. Cada escrita de texto
    // SUBSTITUI o conteúdo atual -- então, poucos segundos depois do
    // relatório ser copiado com sucesso, a última parte de texto
    // sobrescreve a imagem. Um Ctrl+V logo depois do Alt+A cola texto, não
    // a imagem -- ela só continua acessível via Win+V (histórico), que nem
    // todo operador usa por hábito. Alt+R sozinho nunca aciona esse laço de
    // texto, por isso nunca sofre disso.
    //
    // Chamado pelo Módulo 4 depois que o laço de texto termina, pra
    // recolocar a imagem como conteúdo ATUAL da área de transferência --
    // ela continua disponível no histórico do Win+V também, então nada se
    // perde, só a ORDEM final muda: imagem por cima, não uma parte de
    // texto qualquer.
    async function recopiarUltimaImagem() {
        if (!_ultimaImagemBlob) return false;
        if (!navigator.clipboard || !window.ClipboardItem) return false;
        try {
            await aguardarFoco(TIMEOUT_AGUARDAR_FOCO_MS);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': _ultimaImagemBlob })]);
            return true;
        } catch (erro) {
            console.warn('[aviso-cobranca] Não consegui recolocar a imagem do relatório na área de transferência:', erro);
            return false;
        }
    }

        // ============================================================
    // FEEDBACK
    // ============================================================

    let _toastAtual = null;

    function notificar(mensagem, tipo) {
        // Se a pagina tiver seu proprio sistema de toast, aproveita ele.
        if (typeof window.showToast === 'function') {
            window.showToast(mensagem, tipo);
            return;
        }
        exibirToastProprio(mensagem, tipo);
    }

    // Aviso proprio, nao bloqueante: aparece e some sozinho. Nunca usa alert(),
    // que trava a tela ate o usuario clicar e era a causa da lentidao percebida.
    function exibirToastProprio(mensagem, tipo) {
        // Remove um toast anterior ainda visivel, para nao empilhar varios.
        if (_toastAtual) {
            clearTimeout(_toastAtual._timer);
            _toastAtual.remove();
            _toastAtual = null;
        }

        const cores = tipo === 'error'
            ? { fundo: '#FDF3F1', borda: '#E8C7BE', texto: '#8A2A16' }
            : { fundo: '#EFF6F1', borda: '#B9D9C4', texto: '#1B6B4A' };

        const toast = document.createElement('div');
        toast.textContent = mensagem;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '78px', right: '20px', zIndex: '999999',
            maxWidth: '360px', padding: '12px 16px', borderRadius: '8px',
            background: cores.fundo, border: '1px solid ' + cores.borda, color: cores.texto,
            fontSize: '13px', fontFamily: '-apple-system, Segoe UI, Arial, sans-serif',
            boxShadow: '0 4px 14px rgba(21,26,33,0.18)', lineHeight: '1.4',
            opacity: '0', transition: 'opacity 180ms ease-out'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });

        const tempoVisivel = tipo === 'error' ? 6000 : 3500;
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
            if (_toastAtual === toast) _toastAtual = null;
        }, tempoVisivel);

        _toastAtual = toast;
    }

    // ============================================================
    // ORQUESTRACAO
    // ============================================================

    async function gerarRelatorio() {
        // Limpa a imagem em cache ANTES de tentar gerar uma nova -- se esta
        // tentativa falhar antes de capturar nada, recopiarUltimaImagem não
        // deve devolver a imagem de um cliente/tentativa anterior (a página
        // não recarrega ao trocar de cliente, ver instalarBotao/aguardarTabelaEInstalar).
        _ultimaImagemBlob = null;

        // Acordos (Módulo 16, v1.41.0): o relatório só sai depois de saber
        // quais títulos estão em acordo -- nunca uma imagem com título
        // negociado por ter gerado cedo demais. Espera com teto, sempre.
        if (window.__negociacoes?.aguardar) await window.__negociacoes.aguardar();

        const hoje = normalizarData(new Date());
        const dados = coletarRegistros(hoje);

        if (dados.registros.length === 0) {
            throw new Error(dados.emAcordo.length > 0
                ? 'Todos os títulos vencidos estão em acordo -- sem relatório (veja a aba Negociações).'
                : 'Nenhum título vencido encontrado para este cliente.');
        }

        const tabela = localizarTabela();
        injetarEstilos();
        limparDestaques(tabela);
        aplicarDestaques(dados.registros);
        observarTabela(tabela, dados.registros);

        const html = montarRelatorio(dados, hoje);
        const resultado = await capturarEExportar(html);

        return {
            total: dados.registros.length,
            copiado: resultado.copiado,
            divergentes: dados.divergentes.length,
            ignorados: dados.ignorados.length
        };
    }

    async function aoClicar(evento) {
        const botao = evento.currentTarget;
        const rotulo = botao.textContent;

        botao.disabled = true;
        botao.style.opacity = '0.6';
        botao.style.cursor = 'wait';
        botao.textContent = 'Gerando...';

        try {
            const r = await gerarRelatorio();

            let msg = r.total + ' título(s) no relatório. ';
            msg += r.copiado ? 'Imagem copiada e baixada.' : 'Imagem baixada.';
            if (r.divergentes > 0) {
                msg += ' ' + r.divergentes + ' com contagem divergente do sistema.';
            }
            notificar(msg, 'success');

        } catch (erro) {
            console.error('[aviso-cobranca]', erro);
            notificar(erro.message || 'Não foi possível gerar o relatório.', 'error');

        } finally {
            botao.disabled = false;
            botao.style.opacity = '';
            botao.style.cursor = 'pointer';
            botao.textContent = rotulo;
        }
    }

       // ============================================================
    // INSTALACAO
    // ============================================================

    let _observerInstalacao = null;

    // Banner fixo, SEM botão de fechar -- de propósito. O bug que motivou
    // isso foi justamente cobrar por falta de atenção; um aviso que dá pra
    // fechar e esquecer não protege contra isso.
    //
    // PEDIDO DO USUÁRIO (prévia visual aprovada antes de aplicar): mesma
    // urgência (vermelho, sem botão de fechar), mas com hierarquia melhor
    // -- selo com ícone, título curto em destaque, detalhe secundário --
    // em vez de uma única frase corrida em negrito.
    function avisarSeNaoCobrar() {
        if (document.getElementById('aviso-nao-cobrar-banner')) return; // já existe, não duplica

        let dados;
        try {
            dados = coletarRegistros(normalizarData(new Date()));
        } catch (erro) {
            return; // sem tabela ainda ou erro -- não é o momento de travar nada por isso
        }

        if (!dados.naoCobrar || dados.naoCobrar.length === 0) return;

        const banner = document.createElement('div');
        banner.id = 'aviso-nao-cobrar-banner';
        Object.assign(banner.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            zIndex: 999998,
            background: 'linear-gradient(180deg, #2A1414 0%, #1F0F0F 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '14px 22px',
            fontFamily: '-apple-system, Segoe UI, Arial, sans-serif',
        });

        const selo = document.createElement('div');
        Object.assign(selo.style, {
            flexShrink: '0',
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 4px rgba(220,38,38,0.18)',
        });
        // Ícone estático (sem dado dinâmico interpolado) -- seguro usar
        // innerHTML aqui, diferente do texto dos títulos abaixo (nomes de
        // posição vêm do CRM e continuam usando nós de texto).
        selo.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" ' +
            'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>' +
            '<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/></svg>';

        const corpo = document.createElement('div');
        corpo.style.lineHeight = '1.35';

        const titulo = document.createElement('div');
        titulo.textContent = 'Não cobrar este cliente';
        Object.assign(titulo.style, {
            fontSize: '13px',
            fontWeight: '700',
            letterSpacing: '.04em',
            color: '#FCA5A5',
            textTransform: 'uppercase',
            marginBottom: '2px',
        });

        // Nós de texto reais, sem innerHTML -- mesmo padrão de segurança já
        // usado no Módulo 5 (item A1): tituloCompleto/posicao vêm do CRM.
        const detalhe = document.createElement('div');
        detalhe.style.fontSize = '14px';
        detalhe.style.color = '#F1E4E4';
        detalhe.append('Título(s) ');
        dados.naoCobrar.forEach((r, i) => {
            if (i > 0) detalhe.append(', ');
            const destaque = document.createElement('b');
            destaque.style.color = '#fff';
            destaque.style.fontWeight = '600';
            destaque.textContent = `${r.tituloCompleto} (${r.posicao})`;
            detalhe.appendChild(destaque);
        });
        detalhe.append(' -- não entre em contato de cobrança sobre ele(s).');

        corpo.appendChild(titulo);
        corpo.appendChild(detalhe);
        banner.appendChild(selo);
        banner.appendChild(corpo);

        document.body.appendChild(banner);
    }

    function criarBotao() {
        // Evita duplicar se, por algum motivo, a instalacao rodar duas vezes.
        if (document.getElementById('aviso-cobranca-botao')) return;

        const botao = document.createElement('button');
        botao.id = 'aviso-cobranca-botao';
        botao.type = 'button';
        botao.textContent = 'Gerar Relatório';
        botao.onmouseenter = () => { if (!botao.disabled) botao.style.background = '#22394D'; };
        botao.onmouseleave = () => { if (!botao.disabled) botao.style.background = TOKENS.cabecalho; };
        botao.addEventListener('click', aoClicar);

        // Tenta encaixar na mesma linha de ações nativas do CRM (Contato /
        // Negociação / Tarefa) em vez de flutuar por cima da tela. Se o
        // seletor não bater (CRM mudou o layout), cai pro position: fixed
        // antigo -- nunca deixa de aparecer.
        const ancora = document.querySelector('[onclick^="openModalContato"]')?.parentElement
            || document.getElementById('fluxo-cobranca')?.parentElement
            || null;

        if (ancora) {
            Object.assign(botao.style, {
                padding: '6px 12px', background: TOKENS.cabecalho, color: '#FFFFFF',
                border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                cursor: 'pointer', fontFamily: '-apple-system, Segoe UI, Arial, sans-serif'
            });
            ancora.appendChild(botao);
        } else {
            Object.assign(botao.style, {
                position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
                padding: '12px 20px', background: TOKENS.cabecalho, color: '#FFFFFF',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(21,26,33,0.25)',
                fontFamily: '-apple-system, Segoe UI, Arial, sans-serif'
            });
            document.body.appendChild(botao);
        }

        aquecerHtml2Canvas();
    }

    // A tabela de titulos e montada por OUTRO script (o que chama
    // "new SmartTable('#tabela-titulos-ds', ...)"), que roda DEPOIS deste
    // arquivo no carregamento da pagina. Se checarmos so uma vez no
    // DOMContentLoaded, corremos o risco de checar ANTES da tabela existir e
    // desistir para sempre. Por isso observamos o DOM ate ela aparecer.
    function aguardarTabelaEInstalar() {
        if (_observerInstalacao) return; // ja esta observando, nao duplica

        _observerInstalacao = new MutationObserver(() => {
            if (localizarTabela()) {
                _observerInstalacao.disconnect();
                _observerInstalacao = null;
                criarBotao();
                avisarSeNaoCobrar();
            }
        });
        _observerInstalacao.observe(document.body, { childList: true, subtree: true });

        // Rede de seguranca: em paginas do CRM que nunca vao ter essa tabela
        // (Dashboard, Negociacoes, etc.), para de observar apos 20s em vez de
        // ficar rodando para sempre.
        setTimeout(() => {
            if (_observerInstalacao) {
                _observerInstalacao.disconnect();
                _observerInstalacao = null;
            }
        }, 20000);
    }

    function instalarBotao() {
        if (!document.body) {
            setTimeout(instalarBotao, 100);
            return;
        }

        if (localizarTabela()) {
            criarBotao();
            avisarSeNaoCobrar();
        } else {
            aguardarTabelaEInstalar();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', instalarBotao);
    } else {
        instalarBotao();
    }

    // Exposto para conferencia manual pelo console, sem gerar imagem.
      window.__avisoCobranca = {
        simular: () => coletarRegistros(normalizarData(new Date())),
        // v1.45.0: a mesma classificação a partir da lista de títulos de
        // outra página (Alt+U sem abrir aba). Ver coletarRegistros.
        simularTitulos: (fonte, hoje) => coletarRegistros(normalizarData(hoje || new Date()), fonte),
        prazosDe: (dataBr) => calcularPrazos(converterDataBrasileira(dataBr)),
        feriados: (ano) => Array.from(feriadosDoAno(ano)).sort(),
        tokens: TOKENS,
        situacoes: SITUACOES,
        instalarBotao: instalarBotao,   // <-- linha nova
        aguardarFoco,
        recopiarUltimaImagem,
        // Diagnóstico no console: qual html2canvas gerou o último relatório.
        origemHtml2Canvas: () => _origemUltimaCaptura,
        HTML2CANVAS_URL,
        HTML2CANVAS_INTEGRIDADE,
    };

})();
// ===== FIM - Aviso de Cobranca (v4) =====
