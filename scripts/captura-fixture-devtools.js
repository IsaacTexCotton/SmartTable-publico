/*
 * Captura de fixture para o Claude — v2.1
 *
 * O que faz: copia o HTML de uma área do CRM (ou a página inteira, ou o
 * window.__TITULOS_ABERTOS__), troca os dados de clientes por dados fictícios
 * e baixa um arquivo pronto para colocar em tests/fixtures/.
 *
 * v2.0 -- "Capturar tudo desta tela": num clique, captura a tela aberta
 * inteira (abas, modais, cada resultado do modal de contato, dados globais e
 * respostas GET da API) num .zip só, com LEIAME e manifesto. Rode uma vez em
 * cada tipo de tela (cliente, lista de clientes, dashboard): o snippet não
 * sobrevive a uma troca de página. Nada é gravado no CRM durante o lote --
 * ver "Captura em lote" mais abaixo.
 *
 * v2.1 -- instalável pelo Tampermonkey (captura-fixture.user.js, à parte do
 * SmartTable): carrega sozinho em toda página do CRM e Shift+Alt+C abre o painel.
 *
 * Como usar pelo Tampermonkey (recomendado):
 *   1. Abra no navegador o endereço "raw" de captura-fixture.user.js no GitHub
 *      e confirme a instalação.
 *   2. Em qualquer tela do CRM, Shift+Alt+C abre e fecha o painel.
 *
 * Como usar pelo DevTools (sem instalar nada):
 *   1. DevTools > Sources > Snippets > New snippet > cole este código > Ctrl+S.
 *   2. Na tela do CRM, clique com o botão direito no snippet > Run (ou Ctrl+Enter).
 *   3. Use o painel que aparece no canto inferior direito da página.
 *
 * Nada é enviado para lugar nenhum: tudo acontece no seu navegador.
 * Capturas feitas na mesma execução usam os mesmos fictícios, então o HTML e o
 * JSON da mesma tela continuam batendo entre si.
 *
 * ONDE ISSO VIVE NO REPO: este arquivo NÃO é um módulo do SmartTable -- não
 * entra no @require de smart-table.user.js, não roda pra operador nenhum.
 * É a ferramenta usada para gerar os HTMLs de tests/fixtures/ (confirmado: o
 * formato do comentário-cabeçalho gerado por cabecalhoHtml() abaixo é o
 * mesmo que já aparece em tests/fixtures/cliente-ultimo-dia-scpc.html e nas
 * outras fixtures existentes). Fica aqui só pra ficar versionado e
 * documentado, em vez de existir só na aba Snippets de alguém.
 */
(() => {
  'use strict';

  // ─── Configuração ──────────────────────────────────────────────────────────
  const CONFIG = {
    // Multiplica valores monetários por um fator fixo: a ordem e as proporções se mantêm.
    mascararValores: true,
    // Textos do sistema que nunca são alterados, porque a lógica dos módulos depende deles.
    preservar: ['NAO COBRAR', 'CARTEIRA', 'EM ATRASO', 'PRAZO FINAL', 'ULTIMO DIA PARA PAGAMENTO',
      'EM CARTORIO', 'NEGATIVADO SCPC', 'VERIFICAR POSICAO', 'SCPC', 'CARTORIO', 'PROTESTO'],
    // Bancos não são dado de cliente, e a classificação dos títulos depende deles.
    bancos: ['BANCO', 'ITAU', 'BRADESCO', 'SANTANDER', 'CAIXA', 'SICOOB', 'SICREDI', 'BANRISUL',
      'SAFRA', 'BTG', 'NUBANK', 'AILOS', 'VIACREDI', 'UNICRED', 'CRESOL', 'DAYCOVAL', 'CITIBANK'],
  };

  // Sobe junto com o @version de captura-fixture.user.js (tests/wrappers.test.js
  // confere): é o @version que faz o Tampermonkey baixar este arquivo de novo.
  const VERSAO_CAPTURA = '2.1.2';

  const ID_PAINEL = '__fx_painel';
  const ID_REALCE = '__fx_realce';
  const L = 'A-Za-zÀ-ÖØ-öø-ÿ'; // letras
  const U = 'A-ZÀ-ÖØ-Þ'; // maiúsculas

  // ─── Utilidades de texto ───────────────────────────────────────────────────
  const semAcento = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const tokens = (s) => semAcento(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2'))
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const slug = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const seq = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  // Todo número do caminho vira N (id do grupo, id da negociação, CNPJ na URL).
  const caminhoCensurado = (p) => String(p).replace(/\d+/g, 'N');

  const PRESERVAR = CONFIG.preservar.map(norm);
  const BANCOS = CONFIG.bancos.map(norm);
  const NUNCA = new Set(['sim', 'nao', 'hoje', 'ontem', 'amanha', 'ativo', 'inativo', 'pendente', 'pago',
    'paga', 'aberto', 'aberta', 'vencido', 'vencida', 'nenhum', 'nenhuma', 'nunca', 'sem contato']);

  // Palavras da própria tela do CRM: nunca são nome de ninguém. Um texto feito
  // só delas não é mascarado nem vira "nome conhecido" -- achado na primeira
  // captura em lote real: "dias" e "Promessa de Pagamento" foram tomados por
  // nome num canto da tela e trocados em TODOS os arquivos seguintes.
  const PALAVRAS_TELA = new Set([
    ...[...NUNCA].flatMap((p) => norm(p).split(' ')), ...PRESERVAR.flatMap((p) => p.split(' ')),
    'A', 'AS', 'O', 'OS', 'E', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'EM', 'NO', 'NA', 'POR', 'PARA', 'COM', 'SEM', 'OU', 'AO', 'AOS', 'UM', 'UMA', 'JA',
    'DIA', 'DIAS', 'MES', 'MESES', 'SEMANA', 'ATRASO', 'PRAZO', 'FINAL', 'ULTIMO', 'VENCIDOS', 'VENCIDAS', 'VENCIMENTO', 'VENCE', 'A VENCER',
    'TITULO', 'TITULOS', 'PARCELA', 'PARCELAS', 'VALOR', 'VALORES', 'DATA', 'SALDO', 'TOTAL', 'JUROS', 'MULTA', 'EMISSAO', 'PORTADOR',
    'SITUACAO', 'POSICAO', 'COBRANCA', 'NEGATIVADO', 'PROTESTADO', 'SUSPENSO', 'SUSPENSAO', 'CADASTRO', 'ABERTOS', 'ABERTAS',
    'CLIENTE', 'CLIENTES', 'RAZAO', 'SOCIAL', 'EMPRESA', 'EMPRESAS', 'GRUPO', 'CONTATO', 'CONTATOS', 'RESPONSAVEL', 'FINANCEIRO',
    'REPRESENTANTE', 'NEGOCIADOR', 'PROMESSA', 'PROMESSAS', 'PAGAMENTO', 'PAGAMENTOS', 'CONFIRMADO', 'CUMPRIDA', 'QUEBRADA', 'PARCIAL',
    'NEGOCIACAO', 'NEGOCIACOES', 'ACORDO', 'ACORDOS', 'LEMBRETE', 'REGISTRO', 'RETORNAR', 'DEPOIS', 'CAIXA', 'POSTAL', 'ATENCAO', 'INICIADA',
    'BOLETO', 'PIX', 'TRANSFERENCIA', 'DEPOSITO', 'DEPOSITOS', 'OUTRO', 'OUTROS', 'OUTRA', 'FORMA',
    'SELECIONAR', 'TODOS', 'TODAS', 'BUSCAR', 'NUMERO', 'NOME', 'TELEFONE', 'EMAIL', 'ENDERECO', 'OBSERVACAO', 'OBSERVACOES', 'HISTORICO',
    'PEDIDO', 'PEDIDOS', 'TIMELINE', 'TAREFA', 'TAREFAS', 'SALVAR', 'CANCELAR', 'ENVIAR', 'REGISTRAR', 'FECHAR', 'DETALHES', 'NOVO', 'NOVA',
    // As anotações padrão que o SmartTable grava (Módulo 2) e as réplicas de grupo
    // do CRM: sem dado pessoal, e úteis na fixture como estão.
    'ENVIADO', 'ENVIADA', 'PRIMEIRO', 'TENTATIVA', 'AGENDOU', 'INFORMOU', 'QUE', 'PAGOU', 'ENVIOU', 'COMPROVANTE',
    'REPLICA', 'ECONOMICO', 'ORIGEM', 'ACORDO', 'PARCELA',
  ].map(norm));
  function soPalavrasDeTela(s) {
    const ps = norm(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return ps.length > 0 && ps.every((p) => PALAVRAS_TELA.has(p) || /^\d+$/.test(p));
  }

  // Palavras que, em id/classe/data-key/cabeçalho, indicam o tipo de dado do campo.
  const CHAVES = [
    ['anotacao', ['observ', 'obs', 'anotac', 'historico', 'comentario', 'ocorrencia']],
    ['endereco', ['endereco', 'logradouro', 'bairro', 'cidade', 'municipio', 'complemento', 'cep']],
    ['contato', ['contato', 'responsavel', 'avalista']],
    ['usuario', ['vendedor', 'representante', 'usuario', 'atendente', 'operador']],
    ['cliente', ['nome', 'cliente', 'razao', 'fantasia', 'sacado', 'pagador', 'devedor']],
  ];
  const CHAVES_VALOR = ['valor', 'vlr', 'saldo', 'juros', 'multa', 'total', 'desconto', 'montante'];
  const CHAVES_DOC = ['telefone', 'fone', 'celular', 'whatsapp', 'tel', 'cel', 'cnpj', 'cpf', 'email', 'cep'];
  const ROTULOS = [...CHAVES.flatMap(([, ks]) => ks), ...CHAVES_DOC];

  const bate = (tok, k) => (k.length <= 3 ? tok === k : tok.startsWith(k));
  const temChave = (toks, lista) => toks.some((t) => lista.some((k) => bate(t, k)));
  function categoriaTokens(toks) {
    for (const [cat, ks] of CHAVES) if (temChave(toks, ks)) return cat;
    return null;
  }

  const ehFalso = (s) => /fict[ií]ci|removid|anonimizad/i.test(s);
  const ehSistema = (s) => { const n = norm(s); return n.length <= 40 && PRESERVAR.some((p) => n.includes(p)); };
  function temBanco(s) {
    const n = ' ' + norm(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    return BANCOS.some((b) => n.includes(' ' + b + ' '));
  }

  // ─── Padrões de dados sensíveis ────────────────────────────────────────────
  const RE = {
    email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    cnpjFmt: /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/g,
    // "12345678/0001-99", sem os pontos: é assim que o CRM escreve o CNPJ em
    // data-cliente e nas réplicas de grupo ("cliente N/N-N"). Até a v2.0 este
    // formato passava direto, e fixtures commitadas saíram com CNPJ real.
    cnpjBarra: /(?<!\d)\d{8}\/\d{4}-\d{2}(?!\d)/g,
    cnpjNum: /(?<!\d)\d{14}(?!\d)/g,
    cpfFmt: /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g,
    cpfTraco: /(?<!\d)\d{9}-\d{2}(?!\d)/g,
    telFmt: /(?:\+?55\s?)?\(?(?<!\d)[1-9]{2}\)?[\s.-]*9?\s?\d{4}[\s.-]\d{4}(?!\d)/g,
    telNum: /(?<!\d)(?:55)?[1-9]{2}9?\d{8}(?!\d)/g,
    cep: /(?<!\d)\d{5}-\d{3}(?!\d)/g,
    valor: /(?<![\d.,])(R\$\s?)?(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d%])(?!\s%)/g,
    empresaAlta: new RegExp(`(?<![${L}0-9&'./-])((?:(?=\\S*[${U}])[${U}0-9&'./-]+\\s+){1,8})(?:LTDA|EIRELI|MEI|ME|EPP|S/A|S\\.A\\.?)(?:\\s*-\\s*(?:ME|EPP))?(?![${L}0-9])`, 'g'),
    empresaMista: new RegExp(`(?<![${L}0-9])((?:(?:[${U}][${L}0-9&'.-]*|d[aeo]s?|e|&)\\s+){1,8})(?:Ltda|LTDA|Eireli|EIRELI)\\.?(?![${L}0-9])`, 'g'),
    data: /(?<!\d)\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?!\d)/g,
    trecho: new RegExp(`[${L}][${L}&'.]*(?:\\s+[${L}][${L}&'.]*)*`, 'g'),
  };
  const SUFIXO_SOLTO = /^(LTDA|Ltda|EIRELI|ME|MEI|EPP|S\.A\.?|S)$/;

  // ─── Estado: fictícios valem para toda a execução do script ────────────────
  const sessao = {
    mapa: new Map(),
    contadores: {},
    literais: new Map(), // original -> fictício, para trocar onde o nome reaparecer
    fator: Math.random() < 0.5 ? 0.62 + Math.random() * 0.25 : 1.18 + Math.random() * 0.3,
  };
  let cap = null; // estatísticas da captura atual

  function novaCaptura(termosTexto) {
    const termos = String(termosTexto || '').split(';').map((t) => t.trim()).filter((t) => t.length >= 2)
      .sort((a, b) => b.length - a.length)
      .map((t) => ({ t, re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }));
    cap = { usados: new Set(), valores: 0, termos };
  }
  const usar = (cat, chave) => cap && cap.usados.add(cat + '|' + chave);
  const proximo = (cat) => (sessao.contadores[cat] = (sessao.contadores[cat] || 0) + 1);

  const NOMES_FALSOS = { cliente: 'Cliente Fictício', contato: 'Contato Fictício', usuario: 'Usuário Fictício',
    endereco: 'Endereço Fictício', termo: 'Nome Removido' };

  function falso(cat, original) {
    const chave = norm(original);
    const k = cat + '|' + chave;
    usar(cat, chave);
    if (!sessao.mapa.has(k)) {
      const n = seq(proximo(cat));
      const f = cat === 'empresa' ? `EMPRESA FICTÍCIA ${n} LTDA` : `${NOMES_FALSOS[cat]} ${n}`;
      sessao.mapa.set(k, f);
      // Só vira "nome conhecido" (trocado onde mais aparecer, em qualquer
      // arquivo do lote) o que tem cara de nome: com maiúscula e não feito só
      // de palavras da tela. Nome extra digitado pelo usuário entra sempre.
      const o = original.trim();
      if (o.length >= 4 && (cat === 'termo' || (/[A-ZÀ-Þ]/.test(o) && !soPalavrasDeTela(o)))) {
        sessao.literais.set(o, f);
        cacheLiterais = null;
      }
    }
    // O fictício acompanha a forma de CADA ocorrência: "CLIENTE FICTÍCIO C" no
    // cabeçalho, "cliente fictício c" no índice de busca (que o CRM põe em minúsculas).
    const f = sessao.mapa.get(k);
    if (cat === 'empresa') return f;
    if (/[A-ZÀ-Þ]/.test(original) && original === original.toUpperCase()) return f.toUpperCase();
    if (/[a-zß-ÿ]/.test(original) && original === original.toLowerCase()) return f.toLowerCase();
    return f;
  }

  const reformatar = (modelo, dig) => { let i = 0; return modelo.replace(/\d/g, () => dig[i++] ?? '0'); };
  function digitosFalsos(cat, digitos) {
    const k = cat + '|' + digitos;
    usar(cat, digitos);
    if (!sessao.mapa.has(k)) sessao.mapa.set(k, String(proximo(cat)).padStart(digitos.length, '0'));
    return sessao.mapa.get(k);
  }
  function trocarCnpj(m) {
    // A raiz (8 primeiros dígitos) vira sempre a mesma raiz fictícia: filiais continuam do mesmo grupo.
    const d = m.replace(/\D/g, '');
    return reformatar(m, digitosFalsos('cnpj', d.slice(0, 8)) + d.slice(8, 12) + '00');
  }
  function trocarCpf(m) {
    const d = m.replace(/\D/g, '');
    return reformatar(m, digitosFalsos('cpf', d.slice(0, 9)) + '00');
  }
  function trocarTelefone(m) {
    const d = m.replace(/\D/g, '');
    const local = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
    const ddi = d.slice(0, d.length - local.length);
    const k = 'telefone|' + local;
    usar('telefone', local);
    if (!sessao.mapa.has(k)) {
      const celular = local.length === 11;
      sessao.mapa.set(k, '11' + (celular ? '9' : '3') + String(proximo('telefone')).padStart(local.length - 3, '0'));
    }
    return reformatar(m, ddi + sessao.mapa.get(k));
  }
  function trocarEmail(m) {
    const k = 'email|' + m.toLowerCase();
    usar('email', m.toLowerCase());
    if (!sessao.mapa.has(k)) sessao.mapa.set(k, `contato.${seq(proximo('email')).toLowerCase()}@exemplo.com`);
    return sessao.mapa.get(k);
  }
  const fmtBR = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escalar = (n) => Math.round(n * sessao.fator * 100) / 100;
  function trocarValor(m, rs, sinal, inteiro, dec) {
    const n = Number(inteiro.replace(/\./g, '') + '.' + dec);
    if (cap) cap.valores++;
    const novo = fmtBR(escalar(n));
    return (rs || '') + sinal + (inteiro.includes('.') ? novo : novo.replace(/\./g, ''));
  }
  function mascararEmpresa(m) {
    if (ehFalso(m) || temBanco(m)) return m;
    const suf = (m.match(/\s*-\s*(?:ME|EPP)\s*$/) || [''])[0];
    return falso('empresa', m.slice(0, m.length - suf.length)) + suf;
  }
  function aplicarTermos(s) {
    if (!cap) return s;
    for (const { t, re } of cap.termos) s = s.replace(re, () => falso('termo', t));
    return s;
  }

  // Troca tudo o que tem formato reconhecível: documentos, telefones, e-mails, valores, empresas.
  function limparPadroes(s) {
    if (typeof s !== 'string' || !s) return s;
    s = aplicarTermos(s);
    if (!/[\d@]|LTDA|EIRELI|\bME\b|EPP|S\/A|S\.A/i.test(s)) return s;
    s = s.replace(RE.email, trocarEmail)
      .replace(RE.cnpjFmt, trocarCnpj).replace(RE.cnpjBarra, trocarCnpj).replace(RE.cnpjNum, trocarCnpj)
      .replace(RE.cpfFmt, trocarCpf).replace(RE.cpfTraco, trocarCpf)
      .replace(RE.telFmt, trocarTelefone).replace(RE.telNum, trocarTelefone)
      .replace(RE.cep, (m) => reformatar(m, digitosFalsos('cep', m.replace(/\D/g, ''))));
    if (CONFIG.mascararValores) s = s.replace(RE.valor, trocarValor);
    return s.replace(RE.empresaAlta, mascararEmpresa).replace(RE.empresaMista, mascararEmpresa);
  }

  // Um texto de campo de nome/contato/endereço deve ser mascarado? (evita rótulos e textos do sistema)
  function mascaravel(texto) {
    const s = texto.trim();
    if (s.length < 3 || !/[A-Za-zÀ-ÿ]{2}/.test(s) || ehSistema(s) || ehFalso(s) || soPalavrasDeTela(s)) return false;
    if (NUNCA.has(semAcento(s).toLowerCase()) || /:$/.test(s)) return false;
    const toks = tokens(s);
    if (!s.includes(':') && toks.length <= 3 && temChave([toks[0]], ROTULOS)) return false; // ex.: "Razão social"
    return true;
  }

  // Campo com nome: preserva rótulos ("Contato:"), separadores e padrões; troca os trechos com letras.
  function mascararCampo(cat, texto) {
    return texto.split(/(\s[-–|•/]\s)/).map((seg, i) => {
      if (i % 2) return seg;
      const r = seg.match(/^(\s*[^:\d]{1,25}:\s*)([\s\S]*)$/);
      const rotulo = r && temChave(tokens(r[1]), ROTULOS) ? r[1] : '';
      const resto = limparPadroes(rotulo ? r[2] : seg);
      return rotulo + resto.replace(RE.trecho, (m, pos, str) => {
        const letras = m.replace(/[^A-Za-zÀ-ÿ]/g, '').length;
        if (letras < 2 || ehFalso(m) || ehSistema(m) || SUFIXO_SOLTO.test(m) || soPalavrasDeTela(m)) return m;
        if (str[pos - 1] === '@' || str[pos + m.length] === '@') return m;
        return falso(cat, m);
      });
    }).join('');
  }

  function anotacao(texto) {
    usar('anotacao', norm(texto));
    const datas = texto.match(RE.data) || [];
    const ini = texto.match(/^\s*/)[0];
    const fim = texto.match(/\s*$/)[0];
    return ini + '[anotação anonimizada]' + (datas.length ? ' ' + datas.join(' ') : '') + fim;
  }

  // ─── Descobrir o tipo de dado pelo contexto no DOM real ────────────────────
  const ATRS_CAT = ['id', 'class', 'name', 'for', 'data-key', 'data-field', 'data-campo', 'data-column',
    'data-name', 'aria-label', 'placeholder'];
  const ATRS_ESTRUTURAIS = /^(class|id|style|data-key|data-index|data-row|data-col|colspan|rowspan|width|height|tabindex|type|role|for|name|method|action|target|rel|lang|dir)$/i;
  const ATRS_TEXTO = /^(title|alt|aria-label|placeholder|data-original-title|data-title|data-tooltip)$/i;
  const GRANDES = new Set(['HTML', 'BODY', 'HEAD', 'TABLE', 'TBODY', 'THEAD', 'TR', 'UL', 'OL', 'FORM', 'MAIN', 'SECTION', 'NAV']);
  const cacheCat = new WeakMap();

  function categoriaElemento(el) {
    if (!el || el.nodeType !== 1) return null;
    if (cacheCat.has(el)) return cacheCat.get(el);
    const c = categoriaTokens(tokens(ATRS_CAT.map((a) => el.getAttribute(a) || '').join(' ')));
    cacheCat.set(el, c);
    return c;
  }
  function cabecalho(td) {
    const tabela = td.closest('table');
    if (!tabela) return null;
    const cab = (tabela.tHead && tabela.tHead.rows[tabela.tHead.rows.length - 1]) || tabela.rows[0];
    if (!cab || cab === td.parentElement) return null;
    return cab.cells[td.cellIndex] || null;
  }
  function categoriaDoNo(no) {
    const el = no.parentElement;
    if (!el) return null;
    const pequeno = (e, max) => e && !GRANDES.has(e.tagName) && e.children.length <= max;
    // A anotação do contato vem duas vezes: em data-resumo e como texto do
    // card, sem classe que diga que é anotação. O texto igual ao atributo é ela.
    const txt = (no.nodeValue || '').trim();
    for (let e = el, i = 0; txt && e && i < 5; e = e.parentElement, i++) {
      for (const a of e.attributes) if (ATR_NOTA.test(a.name) && a.value.trim() === txt) return 'anotacao';
    }
    // <option value="BOLETO">Boleto</option>: rótulo de uma lista fixa, não
    // nome -- mesmo num <select> cujo id tem "contato" (o modal inteiro tem).
    if (el.tagName === 'OPTION') return /^[A-Z][A-Z0-9_]*$/.test(el.getAttribute('value') || '') ? null : categoriaElemento(el.closest('select'));
    if (pequeno(el, 6)) { const c = categoriaElemento(el); if (c) return c; }
    if (pequeno(el.parentElement, 4)) { const c = categoriaElemento(el.parentElement); if (c) return c; }
    const td = el.closest('td');
    if (td) {
      const th = cabecalho(td);
      return th ? categoriaElemento(th) || categoriaTokens(tokens(th.textContent)) : null;
    }
    const ant = el.previousElementSibling;
    if (ant) {
      const t = ant.textContent.trim();
      if (t.length <= 30 && (/:$/.test(t) || ['LABEL', 'DT', 'TH', 'STRONG', 'B'].includes(ant.tagName))) {
        return categoriaTokens(tokens(t));
      }
    }
    return null;
  }
  function categoriaCampo(el) {
    const c = categoriaElemento(el);
    if (c || !el.id) return c;
    const rotulo = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return rotulo ? categoriaTokens(tokens(rotulo.textContent)) : null;
  }
  function limparComCategoria(cat, v) {
    if (cat && mascaravel(v)) return cat === 'anotacao' ? anotacao(v) : mascararCampo(cat, v);
    return limparPadroes(v);
  }

  // Campo oculto não tem rótulo nem classe que diga o que guarda: pode ser o
  // código do cliente, o resultado escolhido no modal ou um token de sessão.
  // Fica o que é estrutura (PROMESSA_PAGAMENTO, true, uma data), número vira
  // número fictício (o mesmo real, o mesmo fictício) e o resto some.
  function valorOculto(v) {
    const s = String(v);
    if (!s || /^(true|false)$/i.test(s) || /^[A-Z][A-Z0-9_]{0,30}$/.test(s) || /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(s)) return s;
    if (/^\d+$/.test(s)) return digitosFalsos('codigo', s);
    return '[valor oculto]';
  }
  const ATR_SEGREDO = /csrf|xsrf|token|nonce|integrity/i;

  function sincronizarCampo(o, c) {
    // outerHTML não inclui o que foi digitado; grava como atributo (já anonimizado).
    if (o.tagName === 'INPUT') {
      const tipo = (o.type || '').toLowerCase();
      if (tipo === 'checkbox' || tipo === 'radio') { if (o.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); return; }
      if (tipo === 'password') { c.setAttribute('value', ''); return; }
      if (tipo === 'hidden') { c.setAttribute('value', valorOculto(o.value)); return; }
      if (tipo === 'file') return;
      if (o.value) c.setAttribute('value', limparComCategoria(categoriaCampo(o), o.value));
    } else if (o.tagName === 'TEXTAREA') {
      c.textContent = o.value ? limparComCategoria(categoriaCampo(o), o.value) : '';
    } else if (o.tagName === 'SELECT') {
      [...o.options].forEach((op, i) => {
        const cop = c.options[i];
        if (!cop) return;
        if (op.selected) cop.setAttribute('selected', ''); else cop.removeAttribute('selected');
      });
    }
  }

  // Nome já identificado é trocado onde mais aparecer, SEM diferenciar
  // maiúscula nem acento e só como palavra inteira. Até a v2.1.0 a troca era
  // exata, e o índice de busca das linhas de título (data-busca, tudo em
  // minúsculas) saiu com a razão social real na primeira captura em lote.
  const VARIANTES = { a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]' };
  const chaveLiteral = (s) => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
  function padraoFlexivel(s) {
    return [...s.trim()].map((ch) => {
      if (/\s/.test(ch)) return '\\s+';
      const base = semAcento(ch).toLowerCase();
      return VARIANTES[base] || ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    }).join('').replace(/(\\s\+)+/g, '\\s+');
  }
  let cacheLiterais = null;
  function literaisCompilados() {
    if (cacheLiterais) return cacheLiterais;
    const lista = [...sessao.literais].sort((a, b) => b[0].length - a[0].length);
    cacheLiterais = {
      mapa: new Map(lista.map(([o, f]) => [chaveLiteral(o), f])),
      re: lista.length ? new RegExp(`(?<![${L}0-9])(?:${lista.map(([o]) => padraoFlexivel(o)).join('|')})(?![${L}0-9])`, 'gi') : null,
    };
    return cacheLiterais;
  }
  function trocarLiterais(s) {
    if (!s) return s;
    const { re, mapa } = literaisCompilados();
    if (!re) return s;
    return s.replace(re, (m) => {
      const f = mapa.get(chaveLiteral(m));
      if (!f) return m;
      if (m === m.toLowerCase()) return f.toLowerCase();
      return m === m.toUpperCase() ? f.toUpperCase() : f;
    });
  }

  // Atributos que o CRM monta a partir de outros campos ou que guardam texto livre.
  const ATR_BUSCA = /busca|search|filtro|filter|keyword/i; // data-busca="915249/2 12 negativado 13/09/2026 razão em minúsculas"
  const ATR_NOTA = /resumo|observ|anotac|coment|mensagem/i; // data-resumo: a anotação que o negociador digitou
  const CHAVES_VALOR_ATR = [...CHAVES_VALOR, 'pago', 'preco'];

  // Índice de busca: fica número, data e palavra da tela; qualquer outro trecho
  // de letras é nome (o índice é feito de campos da linha) e vira fictício.
  function anonimizarBusca(v) {
    return trocarLiterais(limparPadroes(v)).replace(RE.trecho, (m) =>
      (ehFalso(m) || ehSistema(m) || temBanco(m) || soPalavrasDeTela(m) ? m : falso('cliente', m)));
  }

  // Valor de atributo, decidido pelo NOME do atributo antes do conteúdo.
  function limparAtributo(nome, valor, el) {
    if (ATR_SEGREDO.test(nome)) return '';
    if (ATRS_TEXTO.test(nome)) return limparComCategoria(categoriaElemento(el), valor);
    if (!/^data-/i.test(nome)) return limparPadroes(valor);
    if (ATR_BUSCA.test(nome)) return anonimizarBusca(valor);
    if (ATR_NOTA.test(nome)) return mascaravel(valor) ? anotacao(valor) : limparPadroes(valor);
    const toks = tokens(nome.replace(/^data-/i, ''));
    // data-valor="1929.06": ponto decimal, formato que o padrão de R$ não pega.
    // "total" sem casa decimal pode ser contagem (data-total-titulos="3"): fica.
    const dinheiro = temChave(toks, CHAVES_VALOR_ATR.filter((k) => k !== 'total' && k !== 'desconto')) ||
      (temChave(toks, CHAVES_VALOR_ATR) && valor.includes('.'));
    if (CONFIG.mascararValores && dinheiro && /^\s*-?\d+(?:\.\d+)?\s*$/.test(valor)) {
      if (cap) cap.valores++;
      const casas = (valor.split('.')[1] || '').trim().length;
      return escalar(Number(valor)).toFixed(casas);
    }
    // data-razao, data-cliente-nome...: o nome do atributo diz o que é. data-usuario
    // (código do negociador) fica: o Módulo 6 compara com quem está logado.
    const cat = categoriaTokens(toks);
    if (cat && cat !== 'usuario') return limparComCategoria(cat, valor);
    return limparPadroes(valor);
  }

  function caminhoCss(el) {
    const partes = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      let p = el.tagName.toLowerCase();
      if (el.id) { partes.unshift(p + '#' + CSS.escape(el.id)); break; }
      p += [...el.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const irmaos = el.parentElement ? [...el.parentElement.children].filter((x) => x.tagName === el.tagName) : [];
      if (irmaos.length > 1) p += `:nth-of-type(${irmaos.indexOf(el) + 1})`;
      partes.unshift(p);
      el = el.parentElement;
    }
    return partes.join(' > ');
  }

  const ROTULOS_RESUMO = { empresa: 'empresas', cliente: 'nomes de clientes', contato: 'contatos', usuario: 'usuários',
    endereco: 'endereços', anotacao: 'anotações', cnpj: 'raízes de CNPJ', cpf: 'CPFs', telefone: 'telefones',
    email: 'e-mails', cep: 'CEPs', termo: 'termos extras' };
  function resumoCaptura() {
    const cont = {};
    for (const k of cap.usados) { const c = k.split('|')[0]; cont[c] = (cont[c] || 0) + 1; }
    const partes = Object.entries(cont).map(([c, n]) => `${n} ${ROTULOS_RESUMO[c] || c}`);
    if (cap.valores) partes.push(`${cap.valores} valores`);
    return partes.join(', ') || 'nada a substituir';
  }

  // Lista trechos que parecem nomes próprios e sobraram, para conferência humana.
  const RE_REVISAR = [
    new RegExp(`(?<![${L}])[${U}][a-zß-öø-ÿ]+(?:\\s+(?:d[aeo]s?\\s+|e\\s+)?[${U}][a-zß-öø-ÿ]+)+`, 'g'),
    new RegExp(`(?<![${L}])[${U}]{2,}(?:\\s+[${U}&]{2,})+`, 'g'),
  ];
  function candidatos(textos) {
    const achados = new Set();
    for (const t of textos) for (const re of RE_REVISAR) for (const m of t.matchAll(re)) {
      const s = m[0].trim();
      if (!ehFalso(s) && !ehSistema(s) && !temBanco(s)) achados.add(s);
    }
    return [...achados].slice(0, 40);
  }

  // ─── Geração do fixture HTML ───────────────────────────────────────────────
  function gerarHtml(alvo, opcoes = {}) {
    const pagina = alvo === 'pagina';
    const raiz = pagina ? document.documentElement : alvo;
    if (!raiz || !raiz.isConnected) throw new Error('A área selecionada não está mais na página. Selecione de novo.');
    novaCaptura(opcoes.termos);
    const copia = raiz.cloneNode(true);
    const ignorar = (n) => {
      const e = n.nodeType === 1 ? n : n.parentElement;
      return !!(e && e.closest(`#${ID_PAINEL}, #${ID_REALCE}`));
    };

    // 1. Textos: o contexto é lido no DOM real, a troca é feita na cópia.
    const CODIGO = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const wo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const wc = document.createTreeWalker(copia, NodeFilter.SHOW_TEXT);
    let no;
    while ((no = wo.nextNode())) {
      const nc = wc.nextNode();
      const pe = no.parentElement;
      const t = no.nodeValue;
      if (!nc || !pe || CODIGO.has(pe.tagName) || !t || !t.trim() || ignorar(no)) continue;
      nc.nodeValue = limparComCategoria(categoriaDoNo(no), t);
    }

    // 2. Atributos e valores digitados.
    const eo = [raiz, ...raiz.querySelectorAll('*')];
    const ec = [copia, ...copia.querySelectorAll('*')];
    eo.forEach((o, i) => {
      const c = ec[i];
      if (!c || ignorar(o)) return;
      for (const a of [...c.attributes]) {
        if (a.name === 'style') { if (a.value.includes('data:')) a.value = a.value.replace(/url\(\s*(['"]?)data:[^)]*\)/gi, 'url(data:,)'); continue; }
        if (ATRS_ESTRUTURAIS.test(a.name) && !ATR_SEGREDO.test(a.name)) continue;
        a.value = limparAtributo(a.name, a.value, o);
      }
      // <meta name="_csrf" content="..."> -- o token vem no content, não no nome.
      if (o.tagName === 'META' && ATR_SEGREDO.test([o.getAttribute('name'), o.getAttribute('property'), o.getAttribute('http-equiv')].join(' '))) {
        c.setAttribute('content', '');
      }
      sincronizarCampo(o, c);
    });

    // 3. Nomes já identificados são trocados onde mais aparecerem.
    if (sessao.literais.size) {
      const w = document.createTreeWalker(copia, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; const v = trocarLiterais(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
      for (const e of [copia, ...copia.querySelectorAll('*')]) {
        for (const a of e.attributes) if (!ATRS_ESTRUTURAIS.test(a.name)) { const v = trocarLiterais(a.value); if (v !== a.value) a.value = v; }
      }
    }

    // 4. Limpeza para leitura: tira o que é ruído para a IA.
    copia.querySelectorAll(`script, style, noscript, template, link[rel~="stylesheet"], link[rel~="preload"], link[rel~="icon"], #${ID_PAINEL}, #${ID_REALCE}`)
      .forEach((e) => e.remove());
    copia.querySelectorAll('svg').forEach((s) => s.replaceChildren());
    copia.querySelectorAll('img, source').forEach((im) => {
      if ((im.getAttribute('src') || '').startsWith('data:')) im.setAttribute('src', 'data:,');
      if ((im.getAttribute('srcset') || '').includes('data:')) im.removeAttribute('srcset');
    });
    copia.querySelectorAll('iframe').forEach((f) => { f.setAttribute('src', 'about:blank'); f.removeAttribute('srcdoc'); });
    const wcom = document.createTreeWalker(copia, NodeFilter.SHOW_COMMENT);
    const comentarios = [];
    while (wcom.nextNode()) comentarios.push(wcom.currentNode);
    comentarios.forEach((c) => c.remove());

    // 5. Cabeçalho explicativo + HTML.
    const corpo = copia.outerHTML;
    const area = pagina ? 'página inteira' : trocarLiterais(limparPadroes(caminhoCss(alvo)));
    const meta = cabecalhoHtml(opcoes, area, copia, corpo.length);
    const conteudo = pagina ? `<!DOCTYPE html>\n${meta}\n${corpo}\n` : `${meta}\n${corpo}\n`;

    const textos = [];
    const wt = document.createTreeWalker(copia, NodeFilter.SHOW_TEXT);
    while (wt.nextNode()) if (wt.currentNode.nodeValue.trim()) textos.push(wt.currentNode.nodeValue);
    copia.querySelectorAll('[title], [alt], [aria-label]').forEach((e) => ['title', 'alt', 'aria-label'].forEach((a) => e.hasAttribute(a) && textos.push(e.getAttribute(a))));
    // Nome que só aparece em atributo (data-razao de outra razão do grupo, por exemplo) também vai pra conferência.
    [copia, ...copia.querySelectorAll('*')].forEach((e) => { for (const a of e.attributes) if (/^data-/i.test(a.name) && a.name !== 'data-key') textos.push(a.value); });

    return { conteudo, tipo: 'text/html', extensao: 'html', resumo: resumoCaptura(), revisar: candidatos(textos) };
  }

  function cabecalhoHtml(opcoes, area, copia, tamanho) {
    const keys = [...new Set([copia, ...copia.querySelectorAll('[data-key]')].map((e) => e.getAttribute && e.getAttribute('data-key')).filter(Boolean))];
    const tabelas = copia.querySelectorAll('table').length + (copia.tagName === 'TABLE' ? 1 : 0);
    const descricao = opcoes.descricao ? trocarLiterais(limparPadroes(opcoes.descricao)) : '(não informado)';
    const linhas = [
      `Fixture para o Claude: ${opcoes.nome || 'fixture'}`,
      `O que a tela mostra: ${descricao}`,
      `Capturado em: ${new Date().toLocaleString('pt-BR')}`,
      `Página: ${caminhoCensurado(location.pathname)}`,
      `Área capturada: ${area}`,
      `Tabelas: ${tabelas} | Elementos: ${copia.querySelectorAll('*').length + 1} | Tamanho: ${Math.ceil(tamanho / 1024)} KB`,
      `data-key encontrados: ${keys.length ? keys.slice(0, 60).join(', ') : 'nenhum'}`,
      `Anonimização: ${resumoCaptura()}.`,
      'Nomes, documentos, telefones e e-mails são fictícios. O mesmo dado real vira sempre o mesmo fictício,',
      'e CNPJs da mesma raiz continuam com a mesma raiz (grupo econômico preservado).',
      CONFIG.mascararValores
        ? 'Valores monetários foram multiplicados por um fator fixo: ordem e proporções se mantêm, os números exatos não.'
        : 'Valores monetários são os reais.',
      'Datas, dias de atraso, situações dos títulos e bancos são os reais.',
      'Removido para leitura: scripts, estilos, conteúdo de SVG, imagens embutidas e comentários.',
      'Valores digitados em campos foram gravados como atributos (value, checked, selected).',
    ];
    return '<!--\n' + linhas.map((l) => '  ' + l.replace(/--/g, '- -')).join('\n') + '\n-->';
  }

  // ─── Geração do fixture JSON (window.__TITULOS_ABERTOS__) ──────────────────
  function docFalso(toks, d) {
    let f;
    if (temChave(toks, ['cnpj'])) f = trocarCnpj(d.padStart(14, '0'));
    else if (temChave(toks, ['cpf'])) f = trocarCpf(d.padStart(11, '0'));
    else if (temChave(toks, ['cep'])) f = digitosFalsos('cep', d.padStart(8, '0'));
    else f = trocarTelefone(d);
    return f.replace(/\D/g, '').slice(-d.length).padStart(d.length, '0');
  }
  function limparString(s, toks) {
    const cat = categoriaTokens(toks);
    if (cat && mascaravel(s)) return cat === 'anotacao' ? anotacao(s) : mascararCampo(cat, s);
    if (CONFIG.mascararValores && temChave(toks, CHAVES_VALOR) && /^\s*-?[\d.,]+\s*$/.test(s) && /\d/.test(s)) {
      cap.valores++;
      if (s.includes(',')) return fmtBR(escalar(Number(s.replace(/\./g, '').replace(',', '.'))));
      return escalar(Number(s)).toFixed(2);
    }
    const r = limparPadroes(s);
    if (r === s && temChave(toks, CHAVES_DOC) && (s.match(/\d/g) || []).length >= 8) return reformatar(s, docFalso(toks, s.replace(/\D/g, '')));
    return r;
  }
  function limparValor(v, chave, vistos) {
    const toks = tokens(chave);
    if (typeof v === 'string') return limparString(v, toks);
    if (typeof v === 'number') {
      if (CONFIG.mascararValores && temChave(toks, CHAVES_VALOR)) { cap.valores++; return escalar(v); }
      const d = String(Math.trunc(Math.abs(v)));
      if (temChave(toks, CHAVES_DOC) && d.length >= 8) return Number(docFalso(toks, d));
      return v;
    }
    if (!v || typeof v !== 'object' || v instanceof Date) return v;
    if (typeof Node !== 'undefined' && v instanceof Node) return '[elemento da página omitido]';
    if (vistos.has(v)) return '[referência circular]';
    vistos.add(v);
    let out;
    if (Array.isArray(v)) out = v.map((x) => limparValor(x, chave, vistos));
    else { out = {}; for (const k of Object.keys(v)) out[limparPadroes(k)] = limparValor(v[k], k, vistos); }
    vistos.delete(v);
    return out;
  }
  function percorrer(v, fn) {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map((x) => percorrer(x, fn));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out = {};
      for (const k of Object.keys(v)) out[fn(k)] = percorrer(v[k], fn);
      return out;
    }
    return v;
  }

  function gerarJson(opcoes = {}) {
    const dados = window.__TITULOS_ABERTOS__;
    if (dados === undefined) throw new Error('window.__TITULOS_ABERTOS__ não existe nesta página. Abra a tela de um cliente com títulos e tente de novo.');
    return gerarJsonDe(dados, '__TITULOS_ABERTOS__', 'window.__TITULOS_ABERTOS__', { nome: 'titulos', ...opcoes });
  }

  // chave: nome da propriedade que guarda os dados no arquivo; origem: de onde vieram (vai no _meta).
  function gerarJsonDe(dados, chave, origem, opcoes = {}) {
    novaCaptura(opcoes.termos);
    const limpo = limparValor(dados, '', new WeakSet());
    const final = percorrer(limpo, (s) => trocarLiterais(s));
    const textos = [];
    percorrer(final, (s) => { textos.push(s); return s; });
    const saida = {
      _meta: {
        fixture: opcoes.nome || 'dados',
        oQueATelaMostra: opcoes.descricao ? trocarLiterais(limparPadroes(opcoes.descricao)) : '(não informado)',
        capturadoEm: new Date().toLocaleString('pt-BR'),
        pagina: caminhoCensurado(location.pathname),
        origem: limparPadroes(origem),
        anonimizacao: resumoCaptura(),
        observacoes: [
          'Nomes, documentos, telefones e e-mails são fictícios; o mesmo dado real vira sempre o mesmo fictício, e CNPJs da mesma raiz continuam com a mesma raiz.',
          CONFIG.mascararValores ? 'Valores monetários foram multiplicados por um fator fixo: ordem e proporções se mantêm, os números exatos não.' : 'Valores monetários são os reais.',
          'Datas, situações dos títulos e bancos são os reais.',
          'Os fictícios são os mesmos dos fixtures HTML capturados na mesma execução do script.',
        ],
      },
      [chave]: final,
    };
    return { conteudo: JSON.stringify(saida, null, 2) + '\n', tipo: 'application/json', extensao: 'json', resumo: resumoCaptura(), revisar: candidatos(textos) };
  }

  // ─── Captura em lote: "Capturar tudo desta tela" ──────────────────────────
  //
  // Percorre sozinho o que dá pra capturar na tela aberta, na mesma execução
  // (os fictícios batem entre todos os arquivos): a página inteira, a área
  // principal, os dados globais (__TITULOS_ABERTOS__, CLIENTES), cada aba
  // clicada como você faria, os modais que abrem pelas funções da lista
  // ABERTURAS, cada resultado do modal de contato, as respostas GET da API
  // que a tela carrega no caminho e o HTML dos modais que ficaram fechados.
  // Sai um .zip só, com um LEIAME e um manifesto.
  //
  // NADA É GRAVADO NO CRM durante o lote: fetch/XHR que não seja GET é
  // recusado, envio de formulário, sendBeacon e window.open também, e sair da
  // página pede confirmação. Tudo volta ao normal no fim, mesmo com erro.
  //
  // A lista é de PERMITIDOS, não de proibidos: excluir promessa, mudar status
  // de negociação, exportar, ir pro próximo cliente -- nada disso está nela, e
  // uma função nova do CRM só entra aqui quando alguém a puser de propósito.
  const ABERTURAS = [
    { nome: 'modal-contato', funcao: 'openModalContato', fechar: ['closeModalContato'], resultados: true,
      descricao: 'Modal "Registrar Contato" aberto, antes de escolher o resultado' },
    { nome: 'modal-negociacao-nova', funcao: 'openModalNegociacao', descricao: 'Modal de nova negociação aberto, nada preenchido' },
    { nome: 'modal-tarefa', funcao: 'openModalTarefa', descricao: 'Modal de nova tarefa aberto, nada preenchido' },
    { nome: 'modal-responsavel', funcao: 'abrirModalResponsavel', descricao: 'Modal "Responsável financeiro" aberto' },
    { nome: 'modal-print-cobranca', funcao: 'abrirPrintCobranca', fechar: ['printCobranca.fechar'], descricao: 'Modal do print de cobrança aberto' },
    { nome: 'modal-detalhe-contato', funcao: 'openModalDetalheContato', descricao: 'Detalhe do primeiro contato da lista' },
    { nome: 'modal-detalhe-promessa', funcao: 'verDetalhesPromessaCd', descricao: 'Detalhe da primeira promessa da lista' },
    { nome: 'modal-detalhe-negociacao', funcao: 'verDetalhesNeg', fechar: ['fecharModalDetalhesNeg'], descricao: 'Detalhe da primeira negociação da lista' },
  ];
  // Variáveis globais que o CRM deixa na página com os dados da tela.
  const GLOBAIS_CONHECIDAS = ['__TITULOS_ABERTOS__', 'CLIENTES'];
  const ESPERA_PADRAO = { quieto: 500, max: 6000 };
  const LIMITE_RESPOSTA = 1.5 * 1024 * 1024;
  const RESPOSTAS_POR_CAMINHO = 2;
  const MSG_BLOQUEIO = 'Bloqueado pela captura em lote: nada é gravado no CRM enquanto ela roda.';

  const dentroDaFerramenta = (n) => {
    const e = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(e && e.closest && e.closest(`#${ID_PAINEL}, #${ID_REALCE}`));
  };

  function tipoDeTela(caminho = location.pathname) {
    if (/^\/crm\/clientes\/grupo\//.test(caminho)) return 'cliente';
    if (/^\/crm\/clientes\/?$/.test(caminho)) return 'lista';
    if (/^\/crm\/dashboard/.test(caminho)) return 'dashboard';
    return 'tela';
  }

  function visivel(el) {
    if (!el || !el.isConnected) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden || e.classList.contains('hidden')) return false;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  // Modais "de topo": o overlay inteiro, não os pedaços de dentro dele.
  const SELETOR_MODAL = '[id^="modal"], [role="dialog"], .fixed.inset-0';
  function modaisRaiz() {
    return [...document.querySelectorAll(SELETOR_MODAL)]
      .filter((m) => !dentroDaFerramenta(m) && !(m.parentElement && m.parentElement.closest(SELETOR_MODAL)));
  }

  function urlDe(x) {
    try { return new URL(String(x == null ? '' : x), location.href); } catch (_) { return null; }
  }
  // Só método e caminho: números viram N e da query ficam só os nomes.
  function moldeDoCaminho(url) {
    if (!url) return '(endereço inválido)';
    const chaves = [...new Set([...url.searchParams.keys()])];
    const base = (url.origin === location.origin ? '' : url.host) + caminhoCensurado(url.pathname);
    return base + (chaves.length ? '?' + chaves.join('&') : '');
  }

  function chamarSeExistir(caminho) {
    const partes = caminho.split('.');
    const nomeFn = partes.pop();
    const dono = partes.reduce((o, k) => (o ? o[k] : undefined), window);
    if (dono && typeof dono[nomeFn] === 'function') { try { dono[nomeFn](); } catch (_) { /* o estado é restaurado de qualquer jeito */ } }
  }

  // Guarda class/style do que um passo pode mexer, pra devolver como estava.
  function fotografar() {
    const els = [document.documentElement, document.body, ...modaisRaiz(),
      ...document.querySelectorAll('.tab-content, [id^="content-"], [id^="tab-"]')];
    return [...new Set(els)].map((e) => [e, e.getAttribute('class'), e.getAttribute('style')]);
  }
  function restaurar(foto) {
    for (const [e, cls, est] of foto) {
      if (cls === null) e.removeAttribute('class'); else if (e.getAttribute('class') !== cls) e.setAttribute('class', cls);
      if (est === null) e.removeAttribute('style'); else if (e.getAttribute('style') !== est) e.setAttribute('style', est);
    }
  }

  // Espera a tela parar de mudar (e as chamadas em andamento terminarem).
  function esperarCalmaria(lote) {
    const { quieto, max } = lote.espera;
    return new Promise((resolve) => {
      const inicio = Date.now();
      let ultima = inicio;
      const obs = new MutationObserver((regs) => { if (regs.some((r) => !dentroDaFerramenta(r.target))) ultima = Date.now(); });
      obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
      const passo = Math.max(10, Math.min(100, quieto / 2));
      const tique = () => {
        const agora = Date.now();
        if ((agora - ultima >= quieto && lote.emVoo === 0) || agora - inicio >= max) { obs.disconnect(); resolve(); return; }
        setTimeout(tique, passo);
      };
      setTimeout(tique, passo);
    });
  }

  // ─── Trava de escrita ───
  function instalarTrava(lote) {
    const w = window;
    const Xhr = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
    const Form = w.HTMLFormElement && w.HTMLFormElement.prototype;
    const nav = w.navigator;
    const orig = {
      fetch: w.fetch, open: w.open,
      xhrOpen: Xhr && Xhr.open, xhrSend: Xhr && Xhr.send,
      submit: Form && Form.submit, requestSubmit: Form && Form.requestSubmit,
      beacon: nav && nav.sendBeacon, beaconProprio: !!(nav && Object.prototype.hasOwnProperty.call(nav, 'sendBeacon')),
    };
    const leitura = (m) => m === 'GET' || m === 'HEAD';

    if (typeof orig.fetch === 'function') {
      w.fetch = function (entrada, init) {
        const obj = entrada && typeof entrada === 'object';
        const metodo = String((init && init.method) || (obj && entrada.method) || 'GET').toUpperCase();
        const url = urlDe(obj && 'url' in entrada ? entrada.url : entrada);
        if (!leitura(metodo)) { lote.requisicao(metodo, url, 'bloqueada'); return Promise.reject(new TypeError(MSG_BLOQUEIO)); }
        lote.emVoo++;
        let p;
        try { p = orig.fetch.apply(w, arguments); } catch (e) { lote.emVoo--; throw e; }
        return Promise.resolve(p).then(async (resp) => {
          lote.requisicao(metodo, url, resp.status);
          if (metodo === 'GET' && resp.ok) {
            try { lote.resposta(url, resp.headers.get('content-type'), await resp.clone().text()); } catch (_) { /* sem cópia, segue */ }
          }
          return resp;
        }).finally(() => { lote.emVoo--; });
      };
    }
    if (Xhr) {
      Xhr.open = function (metodo, url) {
        this.__fxMetodo = String(metodo || 'GET').toUpperCase();
        this.__fxUrl = url;
        return orig.xhrOpen.apply(this, arguments);
      };
      Xhr.send = function () {
        // Aberto antes da trava e enviado depois: não dá pra saber o método, então não passa.
        const metodo = this.__fxMetodo || 'DESCONHECIDO';
        const url = urlDe(this.__fxUrl);
        if (!leitura(metodo)) { lote.requisicao(metodo, url, 'bloqueada'); throw new Error(MSG_BLOQUEIO); }
        const xhr = this;
        let terminou = false;
        const terminar = () => {
          if (terminou) return;
          terminou = true;
          lote.emVoo--;
          lote.requisicao(metodo, url, xhr.status);
          if (metodo === 'GET' && xhr.status >= 200 && xhr.status < 300) lote.resposta(url, xhr.getResponseHeader('content-type'), textoDoXhr(xhr));
        };
        lote.emVoo++;
        xhr.addEventListener('loadend', terminar);
        try { return orig.xhrSend.apply(this, arguments); } catch (e) { terminar(); throw e; }
      };
    }
    if (Form) {
      Form.submit = function () { lote.requisicao('ENVIO DE FORMULÁRIO', urlDe(this.action), 'bloqueada'); };
      if (orig.requestSubmit) Form.requestSubmit = function () { lote.requisicao('ENVIO DE FORMULÁRIO', urlDe(this.action), 'bloqueada'); };
    }
    const aoEnviar = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      lote.requisicao('ENVIO DE FORMULÁRIO', urlDe(e.target && e.target.action), 'bloqueada');
    };
    document.addEventListener('submit', aoEnviar, true);
    w.open = function (url) { lote.requisicao('ABRIR JANELA', urlDe(url), 'bloqueada'); return null; };
    if (nav && typeof orig.beacon === 'function') nav.sendBeacon = function (url) { lote.requisicao('BEACON', urlDe(url), 'bloqueada'); return false; };
    // Uma função da lista que navegue pra outra tela mataria o lote no meio: o navegador pergunta antes.
    const aoSair = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    w.addEventListener('beforeunload', aoSair);

    return function liberar() {
      if (typeof orig.fetch === 'function') w.fetch = orig.fetch;
      if (Xhr) { Xhr.open = orig.xhrOpen; Xhr.send = orig.xhrSend; }
      if (Form) { Form.submit = orig.submit; if (orig.requestSubmit) Form.requestSubmit = orig.requestSubmit; }
      document.removeEventListener('submit', aoEnviar, true);
      w.open = orig.open;
      if (nav && typeof orig.beacon === 'function') { if (orig.beaconProprio) nav.sendBeacon = orig.beacon; else delete nav.sendBeacon; }
      w.removeEventListener('beforeunload', aoSair);
    };
  }
  function textoDoXhr(xhr) {
    try {
      if (!xhr.responseType || xhr.responseType === 'text') return xhr.responseText;
      if (xhr.responseType === 'json') return JSON.stringify(xhr.response);
    } catch (_) { /* resposta ilegível: não guarda */ }
    return null;
  }

  // ─── Zip (sem compressão: o navegador não tem zip nativo, e é pouco código) ───
  const TABELA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // arquivos: [{ nome, conteudo (texto) }] -> Uint8Array de um .zip válido (nomes em UTF-8).
  function montarZip(arquivos, data = new Date()) {
    const cod = new window.TextEncoder();
    const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
    const dia = ((Math.max(data.getFullYear(), 1980) - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
    const locais = [];
    const central = [];
    let posicao = 0;
    for (const a of arquivos) {
      const nome = cod.encode(a.nome);
      const dados = cod.encode(a.conteudo);
      const crc = crc32(dados);
      const l = new DataView(new ArrayBuffer(30));
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
      l.setUint16(10, hora, true); l.setUint16(12, dia, true); l.setUint32(14, crc, true);
      l.setUint32(18, dados.length, true); l.setUint32(22, dados.length, true); l.setUint16(26, nome.length, true); l.setUint16(28, 0, true);
      locais.push(new Uint8Array(l.buffer), nome, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, hora, true); c.setUint16(14, dia, true); c.setUint32(16, crc, true);
      c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nome.length, true);
      c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true);
      c.setUint32(42, posicao, true);
      central.push(new Uint8Array(c.buffer), nome);
      posicao += 30 + nome.length + dados.length;
    }
    const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
    const f = new DataView(new ArrayBuffer(22));
    f.setUint32(0, 0x06054b50, true); f.setUint16(4, 0, true); f.setUint16(6, 0, true);
    f.setUint16(8, arquivos.length, true); f.setUint16(10, arquivos.length, true);
    f.setUint32(12, tamanhoCentral, true); f.setUint32(16, posicao, true); f.setUint16(20, 0, true);
    const partes = [...locais, ...central, new Uint8Array(f.buffer)];
    const saida = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let i = 0;
    for (const p of partes) { saida.set(p, i); i += p.length; }
    return saida;
  }

  // ─── O lote em si ───
  function novoLote(opcoes) {
    const tipo = tipoDeTela();
    const lote = {
      tipo,
      termos: opcoes.termos || '',
      espera: { ...ESPERA_PADRAO, ...(opcoes.espera || {}) },
      emVoo: 0,
      arquivos: [],
      capturas: [],
      problemas: [],
      chamadas: new Map(),
      respostasVistas: new Map(),
      revisar: new Set(),
      modaisCapturados: new Set(),
      adicionar(nome, r, descricao) {
        let arquivo = `${tipo}--${nome}.${r.extensao}`;
        for (let n = 2; lote.arquivos.some((a) => a.nome === arquivo); n++) arquivo = `${tipo}--${nome}-${n}.${r.extensao}`;
        lote.arquivos.push({ nome: arquivo, conteudo: r.conteudo });
        lote.capturas.push({ arquivo, descricao: limparPadroes(descricao || ''), kb: Math.ceil(r.conteudo.length / 1024), anonimizacao: r.resumo, trechosParaConferir: r.revisar.length });
        r.revisar.forEach((t) => lote.revisar.add(t));
      },
      capturar(nome, alvo, descricao) {
        lote.adicionar(nome, gerarHtml(alvo, { nome: `${tipo}--${nome}`, descricao, termos: lote.termos }), descricao);
      },
      problema(passo, motivo) {
        lote.problemas.push({ passo, motivo: limparPadroes(String(motivo || '')) });
      },
      requisicao(metodo, url, situacao) {
        const caminho = moldeDoCaminho(url);
        const k = metodo + ' ' + caminho;
        const reg = lote.chamadas.get(k) || { metodo, caminho, vezes: 0, situacoes: [] };
        reg.vezes++;
        if (!reg.situacoes.includes(String(situacao))) reg.situacoes.push(String(situacao));
        lote.chamadas.set(k, reg);
      },
      resposta(url, tipoConteudo, texto) {
        if (!url || url.origin !== location.origin || !/^\/api\//.test(url.pathname)) return;
        if (!texto || texto.length > LIMITE_RESPOSTA) return;
        if (!/json/i.test(tipoConteudo || '') && !/^\s*[[{]/.test(texto)) return;
        const molde = moldeDoCaminho(url);
        const n = (lote.respostasVistas.get(molde) || 0) + 1;
        lote.respostasVistas.set(molde, n);
        if (n > RESPOSTAS_POR_CAMINHO) return;
        let dados;
        try { dados = JSON.parse(texto); } catch (_) { return; }
        const nome = `api--${slug(molde.replace(/^\/api\//, '').replace(/\?.*$/, '')) || 'raiz'}${n > 1 ? '-' + n : ''}`;
        const descricao = `Resposta de GET ${molde} durante a captura`;
        try {
          lote.adicionar(nome, gerarJsonDe(dados, 'resposta', 'GET ' + molde, { nome: `${tipo}--${nome}`, descricao, termos: lote.termos }), descricao);
        } catch (e) { lote.problema(nome, e.message); }
      },
    };
    return lote;
  }

  function planejar(lote) {
    const passos = [];
    const passo = (nome, rotulo, fn) => passos.push({ nome, rotulo, fn });

    passo('pagina-inteira', 'página inteira', () => lote.capturar('pagina-inteira', 'pagina', 'Página inteira, como estava ao iniciar a captura'));
    const principal = document.querySelector('main');
    if (principal) passo('area-principal', 'área principal', () => lote.capturar('area-principal', principal, 'Área principal da tela (sem cabeçalho e menu lateral)'));

    const globais = new Set(GLOBAIS_CONHECIDAS.filter((g) => window[g] != null));
    for (const k of Object.keys(window)) if (/^__[A-Z0-9_]+__$/.test(k) && window[k] && typeof window[k] === 'object') globais.add(k);
    for (const g of globais) {
      const nome = 'dados-' + slug(g.replace(/^_+|_+$/g, ''));
      passo(nome, `dados ${g}`, () => lote.adicionar(nome, gerarJsonDe(window[g], g, 'window.' + g, { nome: `${lote.tipo}--${nome}`, descricao: `window.${g}`, termos: lote.termos }), `window.${g}`));
    }

    const abas = [...document.querySelectorAll('[id^="tab-"]')]
      .map((b) => ({ botao: b, chave: (/showTab\(\s*['"]([\w-]+)['"]/.exec(b.getAttribute('onclick') || '') || [])[1] }))
      .filter((a) => a.chave && !dentroDaFerramenta(a.botao));
    const abaInicial = abas.find((a) => visivel(document.getElementById('content-' + a.chave)));
    for (const aba of abas) {
      passo('aba-' + aba.chave, `aba ${aba.chave}`, async () => {
        aba.botao.click();
        await esperarCalmaria(lote);
        const conteudo = document.getElementById('content-' + aba.chave);
        if (!conteudo) { lote.problema('aba-' + aba.chave, 'a aba não tem #content-' + aba.chave); return; }
        lote.capturar('aba-' + slug(aba.chave), conteudo, `Aba "${aba.chave}" depois de clicada (o que ela carrega sozinha já veio)`);
      });
    }
    if (abaInicial) passo('voltar-aba', 'voltar à aba inicial', async () => { abaInicial.botao.click(); await esperarCalmaria(lote); });

    // Comparação no próprio atributo, não em seletor: '[onclick^="f("]' falha
    // no jsdom (o "(" dentro do valor) e não tolera espaço antes do nome.
    const comOnclick = [...document.querySelectorAll('[onclick]')].filter((e) => !dentroDaFerramenta(e));
    for (const ab of ABERTURAS) {
      const gatilho = comOnclick.find((e) => new RegExp(`^\\s*${ab.funcao.replace(/\./g, '\\.')}\\s*\\(`).test(e.getAttribute('onclick')));
      if (!gatilho) continue;
      passo(ab.nome, ab.descricao.toLowerCase(), () => passoAbertura(lote, ab, gatilho));
    }

    passo('modais-fechados', 'modais que ficaram fechados', () => {
      modaisRaiz().forEach((m, i) => {
        if (lote.modaisCapturados.has(m)) return;
        const id = m.id || `sem-id-${i + 1}`;
        lote.capturar(`modal-${slug(id)}--fechado`, m, `HTML do modal ${id} como vem na página, fechado (só a estrutura)`);
      });
    });
    return passos;
  }

  async function passoAbertura(lote, ab, gatilho) {
    const existentes = new Set(modaisRaiz());
    const jaAbertos = new Set([...existentes].filter(visivel));
    const foto = fotografar();
    try {
      gatilho.click();
      await esperarCalmaria(lote);
      const abertos = modaisRaiz().filter((m) => visivel(m) && !jaAbertos.has(m));
      if (!abertos.length) { lote.problema(ab.nome, `cliquei em ${ab.funcao}(), mas nenhum modal apareceu`); return; }
      abertos.forEach((m, i) => { lote.modaisCapturados.add(m); lote.capturar(ab.nome + (i ? `-${i + 1}` : ''), m, ab.descricao); });
      if (!ab.resultados) return;
      const raiz = abertos.find((m) => m.querySelector('[id^="btn-resultado-"]')) || document.getElementById('form-contato') || abertos[0];
      for (const b of [...raiz.querySelectorAll('[id^="btn-resultado-"]')]) {
        const chave = b.id.slice('btn-resultado-'.length);
        b.click();
        await esperarCalmaria(lote);
        lote.capturar(`${ab.nome}--resultado-${slug(chave)}`, abertos[0], `Modal "Registrar Contato" com o resultado ${chave} escolhido (nada foi salvo)`);
      }
    } finally {
      (ab.fechar || []).forEach(chamarSeExistir);
      restaurar(foto);
      // Modal que a tela CRIOU agora (não existia na fotografia): a restauração
      // não o conhece. Aberto, cobriria a página até o F5 -- esconde à força.
      modaisRaiz().filter((m) => !existentes.has(m) && visivel(m)).forEach((m) => {
        m.style.setProperty('display', 'none', 'important');
        lote.problema(ab.nome, `a tela criou o modal ${m.id || '(sem id)'} e ele foi escondido à força: recarregue a página`);
      });
    }
  }

  function textoLeiame(lote, manifesto) {
    const l = [];
    l.push('Captura em lote para o Claude', '=============================', '');
    l.push(`Tela: ${lote.tipo} (${manifesto.pagina})`, `Capturado em: ${manifesto.capturadoEm}`);
    l.push(`SmartTable ativo durante a captura: ${manifesto.smartTableAtivo ? 'sim (os botões e avisos dele aparecem nos HTML)' : 'não'}`, '');
    l.push(`ARQUIVOS (${lote.capturas.length})`);
    lote.capturas.forEach((c) => l.push(`  ${c.arquivo} (${c.kb} KB) -- ${c.descricao}`));
    l.push('', 'O QUE NÃO DEU PRA CAPTURAR');
    if (!lote.problemas.length) l.push('  nada');
    lote.problemas.forEach((p) => l.push(`  ${p.passo}: ${p.motivo}`));
    l.push('', 'CHAMADAS QUE A TELA FEZ DURANTE A CAPTURA (só método e caminho, sem dados)');
    if (!manifesto.chamadas.length) l.push('  nenhuma');
    manifesto.chamadas.forEach((c) => l.push(`  ${c.metodo} ${c.caminho} (${c.vezes}x: ${c.situacoes.join(', ')})` + (c.situacoes.includes('bloqueada') ? ' -- BLOQUEADA, nada foi gravado' : '')));
    l.push('', 'ANTES DE ENVIAR');
    l.push(`  ${manifesto.trechosParaConferir} trecho(s) parecem nome próprio e sobraram sem anonimizar.`);
    l.push('  A lista aparece só no painel da captura, de propósito, pra não viajar junto');
    l.push('  com os arquivos. Se algum for nome real, escreva em "Nomes extras a ocultar"');
    l.push('  e rode a captura de novo.');
    l.push('', 'COMO USAR');
    l.push('  Os .html e .json vão em tests/fixtures/. Depois do lote, recarregue a');
    l.push('  página (F5) antes de voltar a trabalhar: os modais foram abertos e fechados.');
    return l.join('\n') + '\n';
  }

  function carimbo(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // opcoes: { termos, espera: { quieto, max }, aoProgredir(texto) }
  // Devolve { arquivos, zip, nomeZip, manifesto, revisar }. Quem baixa é o painel.
  async function capturarTudo(opcoes = {}) {
    if (window.__capturaLoteRodando) throw new Error('Já existe uma captura em lote rodando nesta página.');
    window.__capturaLoteRodando = true;
    const lote = novoLote(opcoes);
    const progredir = typeof opcoes.aoProgredir === 'function' ? opcoes.aoProgredir : () => {};
    const inicio = new Date();
    let fotoInicial = null;
    let liberar = null;
    try {
      fotoInicial = fotografar();
      liberar = instalarTrava(lote);
      const passos = planejar(lote);
      for (let i = 0; i < passos.length; i++) {
        progredir(`Capturando ${i + 1}/${passos.length}: ${passos[i].rotulo}...`);
        try { await passos[i].fn(); } catch (e) { lote.problema(passos[i].nome, e && e.message); }
      }
      progredir('Esperando as últimas chamadas terminarem...');
      await esperarCalmaria(lote);
    } finally {
      if (liberar) liberar();
      if (fotoInicial) restaurar(fotoInicial);
      window.__capturaLoteRodando = false;
    }

    const manifesto = {
      ferramenta: 'scripts/captura-fixture-devtools.js (captura em lote)',
      tela: lote.tipo,
      pagina: caminhoCensurado(location.pathname),
      capturadoEm: inicio.toLocaleString('pt-BR'),
      smartTableAtivo: !!window.__smartTableUtil,
      capturas: lote.capturas,
      naoCapturado: lote.problemas,
      chamadas: [...lote.chamadas.values()],
      trechosParaConferir: lote.revisar.size,
    };
    const pasta = `captura-${lote.tipo}-${carimbo(inicio)}`;
    const arquivos = [
      ...lote.arquivos,
      { nome: 'LEIAME.txt', conteudo: textoLeiame(lote, manifesto) },
      { nome: 'manifesto.json', conteudo: JSON.stringify(manifesto, null, 2) + '\n' },
    ].map((a) => ({ nome: `${pasta}/${a.nome}`, conteudo: a.conteudo }));
    return { arquivos, zip: montarZip(arquivos, inicio), nomeZip: `${pasta}.zip`, manifesto, revisar: [...lote.revisar].slice(0, 80) };
  }

  // ─── Painel ────────────────────────────────────────────────────────────────
  const COR = { texto: '#1d2733', suave: '#5b6b7b', borda: '#c9d2dc', fundo: '#ffffff', claro: '#f3f6f8', destaque: '#1f5f8b' };

  function criar(tag, props = {}, estilo = '', filhos = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    if (estilo) e.style.cssText = estilo;
    filhos.forEach((f) => e.append(f));
    return e;
  }

  function montarPainel() {
    document.getElementById(ID_PAINEL)?.remove();
    document.getElementById(ID_REALCE)?.remove();
    if (window.__capturaFixtureFechar) window.__capturaFixtureFechar();

    let alvo = null;
    let selecionando = null;

    const estBotao = `font:inherit;padding:6px 8px;border:1px solid ${COR.borda};border-radius:6px;background:${COR.claro};color:${COR.texto};cursor:pointer;flex:1;`;
    const estPrimario = `font:inherit;padding:7px 8px;border:1px solid ${COR.destaque};border-radius:6px;background:${COR.destaque};color:#fff;cursor:pointer;flex:1;font-weight:600;`;
    const estCampo = `display:block;width:100%;box-sizing:border-box;margin:3px 0 8px;padding:5px 7px;border:1px solid ${COR.borda};border-radius:5px;font:inherit;color:${COR.texto};background:#fff;`;
    const estRotulo = `display:block;font-size:12px;color:${COR.suave};`;
    const linha = (filhos) => criar('div', {}, 'display:flex;gap:6px;margin-top:6px;', filhos);
    const botao = (texto, primario = false) => criar('button', { type: 'button', textContent: texto }, primario ? estPrimario : estBotao);
    const campo = (rotulo, placeholder, valor = '') => {
      const input = criar('input', { type: 'text', placeholder, value: valor }, estCampo);
      return { input, bloco: criar('label', {}, estRotulo, [rotulo, input]) };
    };

    const realce = criar('div', { id: ID_REALCE }, `position:fixed;z-index:2147483646;pointer-events:none;display:none;border:2px solid ${COR.destaque};background:rgba(31,95,139,.08);border-radius:3px;`);
    const nome = campo('Nome do arquivo', 'ex.: fila-atendimento', 'fixture');
    const desc = campo('O que esta tela mostra (opcional)', 'ex.: cliente em cartório com 3 títulos');
    const termos = campo('Nomes extras a ocultar (separe com ;)', 'ex.: nome que escapou; outro nome');
    const bSelecionar = botao('Selecionar área');
    const bMaior = botao('Área maior');
    const bPagina = botao('Página inteira');
    const bTitulos = botao('Dados dos títulos');
    const bBaixar = botao('Baixar arquivo', true);
    const bCopiar = botao('Copiar');
    const bLote = botao('Capturar tudo desta tela (.zip)', true);
    const notaLote = criar('div', { textContent: 'Abre abas e modais sozinho, sem gravar nada no CRM. Não mexa na página até terminar; se o navegador perguntar se quer sair, escolha Cancelar.' },
      `margin:4px 0 10px;color:${COR.suave};font-size:11px;`);
    const status = criar('div', { textContent: 'Escolha o que capturar.' }, `margin:10px 0 2px;color:${COR.suave};font-size:12px;word-break:break-word;`);
    const listaRevisao = criar('ul', {}, 'margin:4px 0 0;padding-left:18px;max-height:120px;overflow:auto;font-size:12px;');
    const revisao = criar('div', {}, `display:none;margin-top:8px;padding:8px;border:1px solid #e3c98f;background:#fdf7ea;border-radius:6px;font-size:12px;color:${COR.texto};`, [
      criar('div', { textContent: 'Confira se algum destes é nome real. Se for, coloque em "Nomes extras" e baixe de novo.' }),
      listaRevisao,
    ]);
    const bFechar = criar('button', { type: 'button', textContent: '✕', title: 'Fechar' }, `font:inherit;border:0;background:none;color:${COR.suave};cursor:pointer;padding:0 2px;font-size:14px;`);
    const titulo = criar('div', {}, 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;', [
      criar('strong', { textContent: 'Captura para o Claude' }, 'font-size:14px;'), bFechar,
    ]);

    const painel = criar('div', { id: ID_PAINEL }, `position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;box-sizing:border-box;padding:12px;background:${COR.fundo};color:${COR.texto};border:1px solid ${COR.borda};border-radius:8px;box-shadow:0 8px 28px rgba(20,35,50,.2);font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left;`, [
      titulo, linha([bLote]), notaLote, nome.bloco, desc.bloco, termos.bloco,
      linha([bSelecionar, bMaior]), linha([bPagina, bTitulos]), status, linha([bBaixar, bCopiar]), revisao,
    ]);
    // Teclas digitadas no painel não chegam aos atalhos do CRM.
    ['keydown', 'keyup', 'keypress'].forEach((ev) => painel.addEventListener(ev, (e) => e.stopPropagation()));
    document.body.append(realce, painel);

    const dentroDoPainel = (el) => !!(el && el.closest && el.closest(`#${ID_PAINEL}`));
    const avisar = (t) => { status.textContent = t; };
    function realcar(el) {
      if (!el || !el.getBoundingClientRect) { realce.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(realce.style, { display: 'block', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
    }
    const reposicionar = () => { if (alvo instanceof Element) realcar(alvo); };
    function atualizarBotoes() { bMaior.disabled = !(alvo instanceof Element) || alvo === document.body; bMaior.style.opacity = bMaior.disabled ? '.5' : '1'; }

    function definirAlvo(el) {
      alvo = el;
      realcar(el);
      atualizarBotoes();
      const kb = Math.ceil(el.outerHTML.length / 1024);
      avisar(`Área: ${caminhoCss(el)} (cerca de ${kb} KB antes da limpeza)` + (kb > 1500 ? '. Está grande: prefira uma área menor.' : ''));
    }

    function pararSelecao() {
      if (!selecionando) return;
      selecionando.forEach(([ev, fn]) => document.removeEventListener(ev, fn, true));
      selecionando = null;
      bSelecionar.textContent = 'Selecionar área';
    }
    function iniciarSelecao() {
      if (selecionando) { pararSelecao(); avisar('Seleção cancelada.'); reposicionar(); return; }
      const bloquear = (e) => { if (dentroDoPainel(e.target)) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const mover = (e) => { if (!dentroDoPainel(e.target)) realcar(e.target); };
      const clicar = (e) => { if (dentroDoPainel(e.target)) return; bloquear(e); pararSelecao(); definirAlvo(e.target); };
      const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); pararSelecao(); avisar('Seleção cancelada.'); if (alvo instanceof Element) realcar(alvo); else realce.style.display = 'none'; } };
      selecionando = [['mousemove', mover], ['mousedown', bloquear], ['mouseup', bloquear], ['pointerdown', bloquear], ['pointerup', bloquear], ['click', clicar], ['keydown', tecla]];
      selecionando.forEach(([ev, fn]) => document.addEventListener(ev, fn, true));
      bSelecionar.textContent = 'Cancelar seleção';
      avisar('Clique na área que quer capturar. Esc cancela.');
    }

    function baixar(conteudo, arquivo, tipo) {
      const url = URL.createObjectURL(new Blob([conteudo], { type: /^text\/|json/.test(tipo) ? tipo + ';charset=utf-8' : tipo }));
      const a = criar('a', { href: url, download: arquivo }, 'display:none;');
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    async function copiar(texto) {
      try { await navigator.clipboard.writeText(texto); return; } catch (_) { /* usa o método antigo abaixo */ }
      const ta = criar('textarea', { value: texto }, 'position:fixed;left:-9999px;top:0;');
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    function mostrarRevisao(lista) {
      listaRevisao.replaceChildren(...lista.map((t) => criar('li', { textContent: t })));
      revisao.style.display = lista.length ? 'block' : 'none';
    }

    async function executar(acao) {
      if (!alvo) { avisar('Escolha primeiro uma área, a página inteira ou os dados dos títulos.'); return; }
      try {
        const opcoes = { nome: slug(nome.input.value) || 'fixture', descricao: desc.input.value.trim(), termos: termos.input.value };
        const r = alvo === 'titulos' ? gerarJson(opcoes) : gerarHtml(alvo, opcoes);
        const arquivo = `${opcoes.nome}.${r.extensao}`;
        const kb = Math.ceil(r.conteudo.length / 1024);
        if (acao === 'baixar') { baixar(r.conteudo, arquivo, r.tipo); avisar(`Baixado: ${arquivo} (${kb} KB). Substituídos: ${r.resumo}.`); }
        else { await copiar(r.conteudo); avisar(`Copiado (${kb} KB). Substituídos: ${r.resumo}.`); }
        mostrarRevisao(r.revisar);
        console.info(`[Captura para o Claude] ${arquivo}: ${r.resumo}`);
      } catch (e) {
        avisar('Não foi possível gerar: ' + e.message);
        console.error('[Captura para o Claude]', e);
      }
    }

    bSelecionar.addEventListener('click', iniciarSelecao);
    bMaior.addEventListener('click', () => { if (alvo instanceof Element && alvo.parentElement && alvo !== document.body) definirAlvo(alvo.parentElement); });
    bPagina.addEventListener('click', () => { pararSelecao(); alvo = 'pagina'; realce.style.display = 'none'; atualizarBotoes(); avisar('Página inteira selecionada.'); });
    bTitulos.addEventListener('click', () => {
      pararSelecao();
      realce.style.display = 'none';
      if (window.__TITULOS_ABERTOS__ === undefined) { alvo = null; avisar('window.__TITULOS_ABERTOS__ não existe nesta página.'); }
      else { alvo = 'titulos'; if (nome.input.value === 'fixture') nome.input.value = 'titulos'; avisar('Dados dos títulos selecionados (arquivo .json).'); }
      atualizarBotoes();
    });
    bBaixar.addEventListener('click', () => executar('baixar'));
    bCopiar.addEventListener('click', () => executar('copiar'));

    async function executarLote() {
      pararSelecao();
      realce.style.display = 'none';
      const botoes = [...painel.querySelectorAll('button')];
      botoes.forEach((b) => { b.disabled = true; });
      try {
        const r = await capturarTudo({ termos: termos.input.value, aoProgredir: avisar });
        baixar(r.zip, r.nomeZip, 'application/zip');
        const falhas = r.manifesto.naoCapturado.length;
        const bloqueadas = r.manifesto.chamadas.filter((c) => c.situacoes.includes('bloqueada')).length;
        avisar(`Baixado: ${r.nomeZip} (${r.manifesto.capturas.length} arquivos, ${Math.ceil(r.zip.length / 1024)} KB).` +
          (falhas ? ` ${falhas} passo(s) sem captura, ver LEIAME.` : '') +
          (bloqueadas ? ` ${bloqueadas} gravação(ões) bloqueada(s).` : '') +
          ' Recarregue a página (F5) antes de voltar a trabalhar.');
        mostrarRevisao(r.revisar);
        console.info(`[Captura para o Claude] ${r.nomeZip}:`, r.manifesto);
      } catch (e) {
        avisar('A captura em lote parou: ' + e.message);
        console.error('[Captura para o Claude]', e);
      } finally {
        botoes.forEach((b) => { b.disabled = false; });
        atualizarBotoes();
      }
    }
    bLote.addEventListener('click', executarLote);

    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('resize', reposicionar);
    function fechar() {
      pararSelecao();
      window.removeEventListener('scroll', reposicionar, true);
      window.removeEventListener('resize', reposicionar);
      painel.remove();
      realce.remove();
      delete window.__capturaFixtureFechar;
    }
    bFechar.addEventListener('click', fechar);
    window.__capturaFixtureFechar = fechar;
    atualizarBotoes();
  }

  function alternarPainel() {
    if (document.getElementById(ID_PAINEL) && window.__capturaFixtureFechar) window.__capturaFixtureFechar();
    else montarPainel();
  }

  // Shift+Alt+C abre e fecha o painel. O SmartTable só usa Alt sozinho (a
  // única exceção com Shift é Shift+Alt+U), então não há colisão. Instalado
  // uma vez por página, e sempre chama a instância mais nova do painel.
  function instalarAtalho() {
    if (window.__capturaFixtureAtalho) return;
    window.__capturaFixtureAtalho = true;
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyC' || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      window.__capturaFixture.alternarPainel();
    }, true);
  }

  // Acesso pelo console, para quem preferir: __capturaFixture.gerarHtml(elemento | 'pagina', { nome, descricao, termos })
  // e __capturaFixture.capturarTudo({ termos }) (devolve os arquivos e o zip, sem baixar).
  window.__capturaFixture = { VERSAO: VERSAO_CAPTURA, gerarHtml, gerarJson, capturarTudo, montarZip, alternarPainel };
  instalarAtalho();

  // Pelo Tampermonkey (captura-fixture.user.js), este arquivo carrega em toda
  // página do CRM: o painel só abre no atalho. Colado no DevTools, abre na
  // hora, como sempre. Com @grant none o Tampermonkey não dá nenhuma função
  // GM_*, mas dá o GM_info -- é por ele que se sabe de onde veio.
  const viaTampermonkey = typeof GM_info !== 'undefined';
  if (viaTampermonkey) {
    console.info(`[Captura para o Claude] v${VERSAO_CAPTURA} pronta: Shift+Alt+C abre o painel.`);
  } else {
    montarPainel();
    console.info(`[Captura para o Claude] v${VERSAO_CAPTURA}: painel aberto no canto inferior direito (Shift+Alt+C fecha e abre).`);
  }
})();
