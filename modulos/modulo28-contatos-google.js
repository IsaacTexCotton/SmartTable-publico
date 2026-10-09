/* =========================================================================
 * MÓDULO 28: CONTATOS DO GOOGLE -> RESPONSÁVEL FINANCEIRO (Alt+J) — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (02/10/2026): a base de números fica no Google Contatos, vários
 * com o nome de quem atende; passar esses nomes para o "Responsável financeiro" do
 * CRM da forma mais certeira possível.
 *
 * Como funciona:
 *   1. Alt+J abre o painel: o usuário escolhe o CSV exportado do Google Contatos
 *      ("Google CSV"). O arquivo é lido AQUI, no navegador; não vai para lugar nenhum.
 *   2. Cada contato cujo nome segue o padrão do usuário
 *        RAZÃO - RAIZ DO CNPJ - UF [- GP n] [- nome do responsável]
 *      vira um registro por RAIZ DO CNPJ (os 8 primeiros dígitos): UF, grupo, nome e
 *      celulares. Isso é guardado só neste navegador (IndexedDB), por decisão do usuário.
 *      Importar de novo SUBSTITUI tudo (o CSV novo é a verdade).
 *   3. Ao abrir um cliente, a raiz do CNPJ dele procura os contatos. Se houver algo a
 *      oferecer, aparece um aviso: "Preencher" abre o modal do CRM, preenche o nome e o
 *      celular e deixa o usuário CONFERIR e clicar em Salvar. QUEM GRAVA É O CRM
 *      (`salvarResponsavel`, PUT /api/crm/cliente-responsavel): este módulo só digita
 *      nos dois campos do modal, como o Alt+N faz no contato.
 *
 * Regras de segurança:
 *   - A chave é a raiz do CNPJ, não o telefone. Vários contatos na mesma raiz: o aviso
 *     lista todos e o usuário escolhe; nunca escolhe sozinho.
 *   - Só preenche o que está VAZIO no modal (o que o CRM mostra é a fonte da verdade). Para
 *     trocar o que já está lá, o usuário marca "Substituir o que já está no CRM".
 *   - Celular só se for celular de verdade: DDD + 9 dígitos começando com 9 (fixo não entra).
 *   - O celular do responsável é o número que o CRM usa para abrir o WhatsApp (selo
 *     "WHATS"): por isso a conferência no modal é obrigatória e o módulo nunca salva sozinho.
 *   - Contato fora do padrão é ignorado e só CONTADO. Nada de contato, nome, telefone ou
 *     CNPJ vai para o console; o painel mostra apenas contagens.
 *
 * ARMAZENAMENTO: IndexedDB `smarttable_contatos_google` (tabela `raizes`, uma linha por raiz) e,
 * no localStorage, só contagens e a data da importação (`smarttable_contatos_google_meta_v1`).
 *
 * ONDE COLAR: depois do Módulo 0 e ANTES do Módulo 4 (que liga o Alt+J).
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__contatosGoogleCarregado) return;
  window.__contatosGoogleCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Contatos do Google');

  const CONFIG_CONTATOS = {
    BANCO: 'smarttable_contatos_google',
    VERSAO_BANCO: 1,
    TABELA: 'raizes',
    CHAVE_META: 'smarttable_contatos_google_meta_v1',
    // Interruptores Nome / Celular (o que comparar e preencher); só preferência, nenhum dado de contato.
    CHAVE_MODO: 'smarttable_contatos_google_modo_v1',
    // Razão social do contato guardada com no máximo isto (o resto é cortado).
    MAX_RAZAO: 120,
    ID_PAINEL: 'smarttable-contatos-google-painel',
    ID_AVISO: 'smarttable-contatos-google-aviso',
    // maxlength do campo "Nome do responsável" no modal do CRM (confirmado no diagnóstico).
    MAX_NOME: 150,
    // Quanto esperar o CRM atualizar o responsável depois do Salvar.
    TIMEOUT_CONFIRMACAO_MS: 8000,
    // Quanto esperar o CRM responder ao PUT do responsável (a página do CRM não tem teto; aqui a tela não pode travar).
    TIMEOUT_GRAVACAO_MS: 30000,
    // Quanto esperar a página definir window.__RESPONSAVEL__ antes de seguir sem ele (o momento não foi confirmado).
    TIMEOUT_RESPONSAVEL_MS: 2500,
    INTERVALO_RESPONSAVEL_MS: 100,
    // O "Clique de novo para apagar" volta ao normal depois disto.
    TEMPO_CONFIRMAR_APAGAR_MS: 4000,
    INTERVALO_CONFIRMACAO_MS: 200,
    Z_INDEX_POPUP: window.__smartTableUtil?.Z_INDEX_POPUP,
  };

  const CORES = {
    tinta: '#16232F',
    texto: '#344054',
    apagado: '#98a2b3',
    borda: '#d0d5dd',
    linha: '#eef2f6',
    destaque: '#1B6B4A',
    erro: '#B42318',
    aviso: '#B54708',
    fundo: '#ffffff',
  };

  // Raiz do CNPJ num trecho do nome: 8 dígitos (com ou sem pontos) ou 8 caracteres alfanuméricos com ao
  // menos um dígito (CNPJ alfanumérico; uma palavra de 8 letras da razão, como "COMERCIO", não é raiz).
  const PADRAO_RAIZ = /^(\d{2}\.?\d{3}\.?\d{3}|(?=[0-9A-Z]*\d)[0-9A-Z]{8})$/;

  const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

  // Mesma raiz de PADRAO_RAIZ, mas solta no meio do texto: começa no início ou depois de " - " e termina numa
  // fronteira (nada de letra, dígito ou ponto colado). Os dois grupos da busca de raiz + UF (acharRaizEUf):
  // (1) a raiz, (2) duas letras logo depois dela, com hífen (com ou sem espaços) no meio (quem decide se é UF, e em maiúsculas, é o UFS).
  const TRECHO_RAIZ = '(\\d{2}\\.?\\d{3}\\.?\\d{3}|(?=[0-9A-Z]*\\d)[0-9A-Z]{8})(?![0-9A-Za-z.])';
  const RAIZ_SOLTA = new RegExp(`(?:^|\\s-\\s)${TRECHO_RAIZ}`);
  // Raiz como ÚLTIMO trecho do texto, sem UF ("RAZÃO - 12345678"): o diagnóstico do usuário (08/10/2026) mostrou contatos assim.
  const RAIZ_NO_FIM = new RegExp(`\\s-\\s${TRECHO_RAIZ}$`);
  const RAIZ_E_UF = `(?:^|\\s-\\s)${TRECHO_RAIZ}\\s*-\\s*([A-Za-z]{2})(?=$|[\\s-])`;

  const util = () => window.__smartTableUtil;

  let painelEl = null;
  let avisoEl = null;
  let iniciou = false;
  // Ouvinte do submit do modal que vai conferir o Salvar; um só por vez (o anterior sai ao preencher de novo).
  let ouvinteEnvio = null;

  /* ---------------------------------------------------------------------
   * CSV E NOME DO CONTATO (funções puras)
   * --------------------------------------------------------------------- */

  /**
   * CSV (aspas, vírgula, quebra de linha dentro de aspas, BOM) -> linhas de campos.
   * @returns {{linhas: string[][], aspasAbertas: boolean}}
   */
  function lerCsv(texto) {
    const t = String(texto ?? '').replace(/^\uFEFF/, '');
    const linhas = [];
    let linha = [];
    let campo = '';
    let aspas = false;
    const fechaLinha = () => {
      linha.push(campo);
      campo = '';
      if (!(linha.length === 1 && linha[0] === '')) linhas.push(linha);
      linha = [];
    };
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (aspas) {
        if (c === '"') {
          if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
        } else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') fechaLinha(); // "\r\n" fecha uma linha e uma vazia (ignorada)
      else campo += c;
    }
    if (campo !== '' || linha.length > 0) fechaLinha();
    return { linhas, aspasAbertas: aspas };
  }

  /**
   * Monta o resultado de interpretarNome: `resto` são os trechos (separados por " - ") que vêm DEPOIS da UF.
   * Um primeiro trecho "GP ..." é o grupo (opcional); o que sobra, junto, é o nome (opcional).
   */
  function montarContato(razaoBruta, raiz, uf, resto) {
    let grupo = null;
    if (resto.length > 0 && /^GP(\s|$)/i.test(resto[0])) grupo = resto.shift();
    const nome = resto.join(' - ').trim();
    const razao = razaoBruta.trim().slice(0, CONFIG_CONTATOS.MAX_RAZAO);
    return { raiz, uf, grupo, nome: nome || null, razao: razao || null };
  }

  /** O padrão ESTRITO (o do usuário): cada pedaço separado por " - " com espaços dos dois lados. */
  function interpretarEstrito(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const partes = t.split(/\s+-\s+/);
    for (let i = 0; i < partes.length - 1; i++) {
      if (!PADRAO_RAIZ.test(partes[i])) continue;
      const raiz = partes[i].replace(/\./g, '');
      const uf = partes[i + 1].toUpperCase();
      if (!UFS.has(uf) || partes[i + 1] !== partes[i + 1].toUpperCase()) continue;
      return montarContato(partes.slice(0, i).join(' - '), raiz, uf, partes.slice(i + 2));
    }
    return null;
  }

  /**
   * Acha no texto (já com os espaços normalizados) a primeira raiz de CNPJ seguida de UF válida em MAIÚSCULAS,
   * tolerando o hífen sem espaços ("12345678-SP") e o que vem depois da UF colado só por espaço ("SP Maria") ou
   * por hífen sem espaços ("SP-Maria"). A raiz tem que estar solta (início ou depois de " - "), a UF tem que ser
   * uma sigla de verdade e terminar ali: "sp", "XX", "SPX" e 7, 9 ou 14 dígitos NÃO casam.
   * @returns {{indice: number, fim: number, raiz: string, uf: string}|null} `indice` é onde começa o trecho da
   *   raiz (incluindo o " - " antes dela) e `fim` é onde a UF termina.
   */
  function acharRaizEUf(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const re = new RegExp(RAIZ_E_UF, 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (!UFS.has(m[2])) continue;
      return { indice: m.index, fim: m.index + m[0].length, raiz: m[1].replace(/\./g, ''), uf: m[2] };
    }
    return null;
  }

  /**
   * A raiz SEM UF (decisão do usuário, 08/10/2026): só vale como ÚLTIMO trecho do texto ("RAZÃO - 12345678"), com uma
   * razão que tenha letra ou número e NENHUMA outra raiz solta antes (senão "EMPRESA A - 11111111 - Maria - 22222222"
   * ligaria o contato à raiz errada). Uma raiz que é o texto todo (um telefone de 8 dígitos) não é cliente; qualquer
   * coisa depois da raiz ("XX", nome) sem UF de verdade continua recusada.
   * @returns {{indice: number, raiz: string}|null} `indice` é onde começa o " - " antes da raiz.
   */
  function acharRaizSemUf(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const m = RAIZ_NO_FIM.exec(t);
    if (!m) return null;
    const razao = t.slice(0, m.index);
    if (!/[\p{L}\p{N}]/u.test(razao) || RAIZ_SOLTA.test(razao)) return null;
    return { indice: m.index, raiz: m[1].replace(/\./g, '') };
  }

  /**
   * "EMPRESA - 12345678 - SP - GP 3 - Maria" -> { raiz, uf, grupo, nome, razao }.
   * Raiz = 8 caracteres (com ou sem pontos, "12.345.678"), logo seguida de uma UF válida; a
   * razão pode ter " - " dentro (a raiz é a primeira que vem com UF depois) e, sem razão, a raiz
   * ainda identifica a empresa sem ambiguidade. Depois da UF:
   * um trecho "GP ..." (grupo, opcional) e o resto é o nome (opcional). null se não casar.
   *
   * Três tentativas: primeiro o padrão ESTRITO (tudo o que ele reconhece sai igual ao de sempre); se ele falhar, a
   * leitura tolerante (acharRaizEUf): "RAZÃO - 12345678 - SP Maria", "RAZÃO - 12345678-SP-Maria"; por último a raiz sem
   * UF, só como ÚLTIMO trecho ("RAZÃO - 12345678"), com `uf: null`.
   */
  function interpretarNome(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    const estrito = interpretarEstrito(t);
    if (estrito) return estrito;
    const achado = acharRaizEUf(t);
    if (!achado) {
      const semUf = acharRaizSemUf(t);
      return semUf ? montarContato(t.slice(0, semUf.indice), semUf.raiz, null, []) : null;
    }
    const depois = t.slice(achado.fim).replace(/^(?:\s*-\s*|\s+)/, '');
    return montarContato(t.slice(0, achado.indice), achado.raiz, achado.uf, depois === '' ? [] : depois.split(/\s+-\s+/));
  }

  /**
   * O texto no padrão estrito, "RAZÃO - RAIZ - UF[ - GP n][ - nome]", a partir do que interpretarNome devolveu
   * (a raiz sai sem pontos; sem UF, o texto sai sem ela). Ler o resultado de volta com interpretarNome dá os mesmos campos.
   * @returns {string|null} null se `contato` não for um resultado de interpretarNome.
   */
  function textoCanonico(contato) {
    if (!contato || !contato.raiz) return null;
    return [contato.razao, contato.raiz, contato.uf, contato.grupo, contato.nome].filter(Boolean).join(' - ');
  }

  /**
   * O NOME do responsável é só o PRIMEIRO NOME (decisão do usuário, 08/10/2026: "só o primeiro nome"; no CRM, 66 de 68 nomes têm uma palavra).
   * Do texto que vem depois de `- UF [- GP n]` vale a primeira palavra que tenha letra: separam palavras o espaço e `/ , & ; ( )`; pontas sem
   * letra (número, ponto, aspas) caem; "Ana Paula" -> "Ana", "(11) Maria" -> "Maria", "Sr. João" -> "João" (tratamento não conta), "9999" -> null. Palavra toda em maiúsculas ou toda em
   * minúsculas vira "Maria"; a que já veio misturada fica como veio. O hífen interno fica ("Ana-Clara").
   * @returns {string|null} null se não houver palavra com letra.
   */
  // Tratamentos que não são o nome (decisão do usuário, 09/10/2026: "pode ignorar"): "Sr. João" -> "João".
  const TRATAMENTOS = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'dona', 'prof', 'profa']);

  function primeiroNome(texto) {
    const palavras = String(texto ?? '').split(/[\s/,&;()]+/).map((p) => p.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean);
    const palavra = palavras.find((p) => !TRATAMENTOS.has(semAcento(p)));
    if (!palavra) return null;
    if (palavra !== palavra.toUpperCase() && palavra !== palavra.toLowerCase()) return palavra;
    return palavra.toLowerCase().replace(/(^|-)(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());
  }

  /**
   * Por que um texto de contato NÃO segue o padrão (só para contar; nunca mostra o texto):
   *   'vazio' = o contato não tem nome nem organização; 'sem-raiz' = nenhum trecho parece raiz de CNPJ
   *   (PADRAO_RAIZ); 'raiz-sem-uf' = tem a raiz, mas nada que a leitura aceite: depois dela não vem uma UF válida
   *   (a raiz sem UF como último trecho já é aceita por interpretarNome e nunca chega aqui).
   */
  function motivoForaDoPadrao(texto) {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return 'vazio';
    const partes = t.split(/\s+-\s+/);
    const temRaiz = partes.some((p) => PADRAO_RAIZ.test(p)) || RAIZ_SOLTA.test(t);
    return temRaiz ? 'raiz-sem-uf' : 'sem-raiz';
  }

  /** "+55 (DD) 9XXXX-XXXX" (com ou sem máscara) -> "DD9XXXXXXXX"; null se não for celular (DDD + 9 dígitos, o 1º é 9). */
  function normalizarCelular(valor) {
    let d = String(valor ?? '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    return d.length === 11 && d[2] === '9' ? d : null;
  }

  /** "DD9XXXXXXXX" -> "(DD) 9XXXX-XXXX" (o formato do campo do CRM). */
  function formatarCelular(digitos) {
    const d = String(digitos ?? '');
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  /**
   * Lê o "Google CSV" e acha as colunas que importam; o mesmo preparo da importação e do corretor de CSV (Módulo 33).
   * @returns {{erro: string} | {linhas: string[][], colunas: {nome: number[], first: number, fileAs: number, org: number, telefones: number[]}}}
   *   `nome` são as colunas de Prefix, First, Middle, Last e Suffix (-1 se o arquivo não tiver); `cab` fica em `linhas[0]`.
   */
  function prepararCsv(texto) {
    const { linhas, aspasAbertas } = lerCsv(texto);
    if (linhas.length === 0) return { erro: 'O arquivo está vazio.' };
    if (aspasAbertas) return { erro: 'O arquivo parece cortado ou corrompido (aspas sem fechar).' };
    const cab = linhas[0].map((c) => c.trim());
    const idx = (nome) => cab.indexOf(nome);
    const telefones = cab.map((c, i) => (/^Phone \d+ - Value$/.test(c) ? i : -1)).filter((i) => i >= 0);
    const faltando = [];
    if (idx('First Name') < 0) faltando.push('First Name');
    if (telefones.length === 0) faltando.push('Phone 1 - Value');
    if (faltando.length > 0) {
      return { erro: `Não parece um CSV do Google Contatos (faltam as colunas: ${faltando.join(', ')}). Exporte como "Google CSV".` };
    }
    return {
      linhas,
      colunas: {
        nome: ['Name Prefix', 'First Name', 'Middle Name', 'Last Name', 'Name Suffix'].map(idx),
        first: idx('First Name'),
        fileAs: idx('File As'),
        org: idx('Organization Name'),
        telefones,
      },
    };
  }

  /** As três fontes do nome de um contato: o nome composto (Prefix + First + Middle + Last + Suffix), File As e Organization. */
  function textosDoContato(linha, colunas) {
    const celula = (i) => (i >= 0 && linha[i] ? linha[i].trim() : '');
    const composto = colunas.nome.map(celula).filter(Boolean).join(' ');
    return { celula, textos: [composto, celula(colunas.fileAs), celula(colunas.org)] };
  }

  /**
   * Linhas do "Google CSV" -> contatos reconhecidos + contagens. Só colunas em inglês, como o
   * Google exporta (confirmado pelo cabeçalho do usuário); sem elas, erro com o motivo.
   * O nome do contato pode estar em First/Middle/Last Name juntos, em File As ou em Organization Name. Entre as fontes
   * vale a primeira que traz a UF; só se nenhuma trouxer, a primeira que traz a raiz sem UF (a fonte mais rica nunca
   * perde para uma que só tem "RAZÃO - RAIZ"). O mesmo contato com e sem UF vira um registro só, o que tem UF.
   * `uf` é null só no contato reconhecido pela raiz sem UF.
   *
   * @returns {{erro: string} | {contatos: Array<{raiz: string, uf: string|null, grupo: string|null, razao: string|null, nome: string|null, celulares: string[]}>,
   *   resumo: {lidos: number, reconhecidos: number, foraDoPadrao: number, foraVazio: number, foraSemRaiz: number,
   *   foraRaizSemUf: number, semNome: number, semCelular: number, nomeLongo: number}}}
   */
  function contatosDoCsv(texto) {
    const preparado = prepararCsv(texto);
    if (preparado.erro) return { erro: preparado.erro };
    const { linhas, colunas } = preparado;
    const { telefones: colunasDeTelefone } = colunas;

    const resumo = { lidos: 0, reconhecidos: 0, foraDoPadrao: 0, foraVazio: 0, foraSemRaiz: 0, foraRaizSemUf: 0, semNome: 0, semCelular: 0, nomeLongo: 0 };
    const vistos = new Map(); // chave sem a UF -> posições em `contatos`
    const contatos = [];
    linhas.slice(1).forEach((linha) => {
      if (linha.every((c) => c.trim() === '')) return;
      resumo.lidos += 1;
      const { celula, textos } = textosDoContato(linha, colunas);
      const achados = textos.map(interpretarNome);
      const achado = achados.find((a) => a && a.uf) || achados.find(Boolean);
      if (!achado) {
        resumo.foraDoPadrao += 1;
        // O motivo é o do texto "mais promissor": vazio só se NENHUMA fonte tem texto; raiz-sem-uf se alguma tem a raiz.
        const motivos = textos.filter((x) => x.trim()).map(motivoForaDoPadrao);
        if (motivos.length === 0) resumo.foraVazio += 1;
        else if (motivos.includes('raiz-sem-uf')) resumo.foraRaizSemUf += 1;
        else resumo.foraSemRaiz += 1;
        return;
      }
      const celulares = [];
      colunasDeTelefone.forEach((i) => celula(i).split(':::').forEach((v) => {
        const c = normalizarCelular(v);
        if (c && !celulares.includes(c)) celulares.push(c);
      }));
      let nome = primeiroNome(achado.nome);
      if (nome && nome.length > CONFIG_CONTATOS.MAX_NOME) { nome = null; resumo.nomeLongo += 1; }
      if (!nome) resumo.semNome += 1;
      if (celulares.length === 0) resumo.semCelular += 1;
      resumo.reconhecidos += 1;
      const chave = [achado.raiz, achado.grupo, achado.razao, nome, celulares.join(',')].join('|');
      const iguais = vistos.get(chave) ?? [];
      // Já guardado com a mesma UF, ou sem UF quando já há um com UF: nada de novo.
      if (iguais.some((k) => contatos[k].uf === achado.uf) || (achado.uf === null && iguais.length > 0)) return;
      const novo = { raiz: achado.raiz, uf: achado.uf, grupo: achado.grupo, razao: achado.razao, nome, celulares };
      const semUf = iguais.find((k) => contatos[k].uf === null);
      if (semUf !== undefined) { contatos[semUf] = novo; return; } // o com UF substitui o mesmo contato sem UF
      contatos.push(novo);
      iguais.push(contatos.length - 1);
      vistos.set(chave, iguais);
    });
    return { contatos, resumo };
  }

  /** Raiz do CNPJ (8 primeiros caracteres) de um CNPJ com ou sem máscara; '' se não tiver 14. */
  function raizDoCnpj(cnpj) {
    const limpo = String(cnpj ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    return limpo.length === 14 ? limpo.slice(0, 8) : '';
  }

  const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Dígitos do celular como o CRM mostra ("+55 (DD) 9XXXX-XXXX" -> "DD9XXXXXXXX"). */
  const digitosDoCelular = (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  };
  /** Mesmo responsável = mesmo PRIMEIRO nome (sem acento nem maiúscula): "Ana", "ANA" e "Ana Paula" são o mesmo. */
  const mesmoNome = (a, b) => {
    const primeiro = semAcento(primeiroNome(a));
    return Boolean(primeiro) && primeiro === semAcento(primeiroNome(b));
  };

  /**
   * Chave para dizer se dois celulares são o MESMO número: DDD + os 8 últimos dígitos. O CRM tem celulares
   * de 10 dígitos (sem o 9 da frente), e o Google traz 11: "(DD) 9999-9999" e "(DD) 99999-9999" são o mesmo.
   * null se não for celular (vazio, fixo de outro tamanho, lixo).
   */
  function chaveDoCelular(valor) {
    const d = digitosDoCelular(valor);
    if (d.length === 11 && d[2] === '9') return d.slice(0, 2) + d.slice(3);
    if (d.length === 10) return d;
    return null;
  }
  const mesmoCelular = (a, b) => chaveDoCelular(a) !== null && chaveDoCelular(a) === chaveDoCelular(b);

  /* ---------------------------------------------------------------------
   * RAZÃO SOCIAL (confirma ou desconfia da raiz do CNPJ)
   * --------------------------------------------------------------------- */

  // Termos que não distinguem uma empresa da outra (tipo societário e ligações).
  // "LTA", "LTD" e "LDA" são jeitos de escrever LTDA que aparecem nos contatos e no CRM.
  const RUIDO_DA_RAZAO = new Set(['LTDA', 'LTA', 'LTD', 'LDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S', 'A', 'CIA', 'COMPANHIA', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM']);

  function termosDaRazao(texto) {
    const termos = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ').split(' ').filter((t) => t && !RUIDO_DA_RAZAO.has(t));
    return new Set(termos);
  }

  /** Uma letra a mais, a menos, trocada ou duas vizinhas invertidas ("JUNIHNO" x "JUNINHO"): erro de digitação. */
  function umaLetraDeDiferenca(a, b) {
    if (a === b) return true;
    if (a.length === b.length) {
      const dif = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif.push(i);
      if (dif.length === 1) return true;
      return dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]];
    }
    const [curto, longo] = a.length < b.length ? [a, b] : [b, a];
    let i = 0;
    while (i < curto.length && curto[i] === longo[i]) i++;
    return curto.slice(i) === longo.slice(i + 1);
  }

  /** Mesmo termo: igual, ou (com 5+ letras nos dois lados) com um erro de digitação. */
  const mesmoTermo = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && umaLetraDeDiferenca(a, b));

  /**
   * A razão do contato (abreviada, às vezes com duas razões separadas por "/" e com erro de digitação) é a
   * do cliente? Compara os termos significativos (sem LTDA, ME, de, da...; um erro de uma letra em termo de
   * 5+ letras conta como igual): o trecho do contato precisa estar quase todo dentro da razão do cliente (ou
   * o contrário), com pelo menos 2 termos em comum, ou 1 termo de 5+ letras quando um dos lados só tem esse
   * termo. Devolve true, false, ou null se faltar razão de um dos lados (não dá para dizer).
   * @param {string|null} razaoContato
   * @param {...string} razoesDoCliente razão social e nome fantasia (qualquer uma serve)
   */
  function razaoConfere(razaoContato, ...razoesDoCliente) {
    const clientes = razoesDoCliente.map(termosDaRazao).filter((t) => t.size > 0);
    const trechos = String(razaoContato ?? '').split('/').map(termosDaRazao).filter((t) => t.size > 0);
    if (clientes.length === 0 || trechos.length === 0) return null;
    return trechos.some((trecho) => clientes.some((cliente) => {
      const comuns = [...trecho].filter((t) => [...cliente].some((c) => mesmoTermo(t, c)));
      const menor = Math.min(trecho.size, cliente.size);
      if (comuns.length / menor < 0.75) return false;
      return comuns.length >= 2 || (menor === 1 && comuns[0].length >= 5);
    }));
  }

  /**
   * Lê `__RESPONSAVEL__ = { nome: null|'texto', celular: null|'texto' }` do HTML de uma página de cliente
   * baixada por fetch (formato confirmado no diagnóstico do usuário em 02/10/2026: objeto JavaScript simples,
   * NÃO JSON). Só aceita esse formato: qualquer outra coisa é erro, nunca um palpite.
   * @returns {{nome: string, celular: string} | {erro: 'sem-variavel'|'formato'}}
   */
  function lerResponsavelDoHtml(html) {
    const texto = String(html ?? '');
    const m = /__RESPONSAVEL__\s*=\s*\{/.exec(texto);
    if (!m) return { erro: 'sem-variavel' };
    const re = /\s*(nome|celular)\s*:\s*(null|'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*(,|\})/y;
    re.lastIndex = m.index + m[0].length;
    const campos = {};
    for (;;) {
      const c = re.exec(texto);
      if (!c) return { erro: 'formato' };
      const bruto = c[3] ?? c[4];
      if (bruto !== undefined && /\\[^\\'"]/.test(bruto)) return { erro: 'formato' };
      if (c[1] in campos) return { erro: 'formato' };
      campos[c[1]] = bruto === undefined ? '' : bruto.replace(/\\(['"\\])/g, '$1');
      if (c[5] === '}') break;
    }
    return 'nome' in campos && 'celular' in campos ? { nome: campos.nome, celular: campos.celular } : { erro: 'formato' };
  }

  /**
   * Grava o responsável no CRM da MESMA forma que o `salvarResponsavel` da página do cliente (lido no diagnóstico do
   * usuário, 02/10/2026): PUT /api/crm/cliente-responsavel com { clienteCodigo, responsavelNome, responsavelCelular }; o
   * `clienteCodigo` é o CNPJ com máscara, igual ao `window.__CLIENTE_CNPJ__`, ao `cnpj` da URL e ao da lista. O wrapper
   * global de `fetch` do layout põe o header do token CSRF sozinho (confirmado também na LISTA). Os DOIS campos vão juntos:
   * quem chama passa o valor atual do que NÃO quer mudar. Só é usado com clique explícito do usuário (lista, Módulo 29).
   * @returns {Promise<{ok: true} | {erro: string, incerto?: true}>} `incerto`: a resposta NÃO veio do CRM (rede, tempo
   *   esgotado, corpo que não é JSON: sessão expirada, 502...): o PUT pode ou não ter sido aplicado, e quem chama precisa conferir
   *   relendo a página. Sem `incerto`, o próprio CRM respondeu que não gravou.
   */
  async function gravarResponsavelNoCrm(cnpj, nome, celular) {
    const ctl = new window.AbortController();
    const relogio = setTimeout(() => ctl.abort(), CONFIG_CONTATOS.TIMEOUT_GRAVACAO_MS);
    try {
      const r = await window.fetch('/api/crm/cliente-responsavel', {
        method: 'PUT',
        credentials: 'same-origin',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clienteCodigo: cnpj, responsavelNome: nome, responsavelCelular: celular }),
      });
      if (String(r.headers?.get?.('content-type') || '').indexOf('application/json') === -1) {
        // O CRM só devolve JSON quando ele mesmo processou: qualquer outra coisa (login, 502, 503...) não prova o que houve.
        return { erro: 'O CRM não respondeu como esperado (sessão expirada ou CRM instável).', incerto: true };
      }
      // Ler o corpo ANTES de olhar r.ok: o 400 de validação traz a mensagem.
      const json = await r.json();
      if (!r.ok || !json.success) return { erro: (json.error && json.error.message) || 'Não foi possível salvar.' };
      return { ok: true };
    } catch {
      return { erro: ctl.signal.aborted ? 'O CRM não respondeu a tempo.' : 'Falha de rede ao salvar.', incerto: true };
    } finally {
      clearTimeout(relogio);
    }
  }

  /* ---------------------------------------------------------------------
   * INTERRUPTORES: NOME e CELULAR (o que comparar e preencher)
   * --------------------------------------------------------------------- */

  /** @returns {{nome: boolean, celular: boolean}} sempre com pelo menos um ligado. */
  function lerModo() {
    try {
      const m = JSON.parse(window.localStorage.getItem(CONFIG_CONTATOS.CHAVE_MODO) || 'null');
      if (m && typeof m.nome === 'boolean' && typeof m.celular === 'boolean' && (m.nome || m.celular)) return { nome: m.nome, celular: m.celular };
    } catch { /* sem preferência gravada: os dois */ }
    return { nome: true, celular: true };
  }

  /** Grava o modo. Desligar os dois não vale: devolve false e mantém o anterior. */
  function definirModo(modo) {
    if (!modo || !(modo.nome || modo.celular)) return false;
    try {
      window.localStorage.setItem(CONFIG_CONTATOS.CHAVE_MODO, JSON.stringify({ nome: Boolean(modo.nome), celular: Boolean(modo.celular) }));
    } catch { return false; }
    return true;
  }

  /**
   * O que este contato ainda tem a oferecer ao CRM? crm = { nome, celular } (null = não deu para ler).
   * Nome conta se o contato tem nome diferente do que está no CRM; celular conta se o contato tem
   * algum celular e o do CRM não é nenhum deles. `modo` (padrão: o dos interruptores) liga/desliga cada um.
   * @returns {{nome: boolean, celular: boolean}} o que há de novo; tudo false = nada a oferecer.
   */
  function novidadesDoContato(item, crm, modo = lerModo()) {
    const nome = modo.nome && Boolean(item.nome) && (!crm || !mesmoNome(item.nome, crm.nome));
    const celular = modo.celular && item.celulares.length > 0 && (!crm || !item.celulares.some((c) => mesmoCelular(c, crm.celular)));
    return { nome, celular };
  }

  function temNovidade(item, crm, modo = lerModo()) {
    const n = novidadesDoContato(item, crm, modo);
    return n.nome || n.celular;
  }

  /**
   * O que "Preencher" deve digitar no modal, olhando o que o MODAL mostra agora (a fonte da verdade).
   * Nome e celular andam JUNTOS: se o CRM já tem OUTRO nome e o usuário não marcou "Substituir", nada é
   * digitado (só o celular deixaria o número de uma pessoa sob o nome de outra, e o celular é o do WhatsApp).
   * Os interruptores `modo` Nome/Celular limitam o que pode ser digitado.
   * @returns {{nome: boolean, celular: boolean, motivo?: 'outro-nome'|'nada'}}
   */
  function decidirPreenchimento(item, celular, nomeAtual, celularAtual, substituir, modo = lerModo()) {
    const nomeVazio = String(nomeAtual ?? '').trim() === '';
    const celularVazio = String(celularAtual ?? '').trim() === '';
    const querNome = modo.nome && Boolean(item.nome);
    const querCelular = modo.celular && Boolean(celular);
    if (querCelular && item.nome && !nomeVazio && !mesmoNome(item.nome, nomeAtual) && !substituir) return { nome: false, celular: false, motivo: 'outro-nome' };
    const nome = querNome && (nomeVazio || (substituir && !mesmoNome(item.nome, nomeAtual)));
    const cel = querCelular && (celularVazio || (substituir && !mesmoCelular(celularAtual, celular)));
    return nome || cel ? { nome, celular: cel } : { nome: false, celular: false, motivo: 'nada' };
  }

  /* ---------------------------------------------------------------------
   * ARMAZENAMENTO (IndexedDB; plano B na memória da aba)
   * --------------------------------------------------------------------- */

  let bancoPromessa = null;
  const memoria = new Map();
  let usandoMemoria = false;

  function pedido(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB: erro sem detalhe'));
    });
  }

  function fimDaTransacao(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: transação falhou'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transação abortada (cota cheia?)'));
    });
  }

  /** @returns {Promise<IDBDatabase|null>} null = sem IndexedDB (plano B). */
  function abrirBanco() {
    if (bancoPromessa) return bancoPromessa;
    bancoPromessa = new Promise((resolve) => {
      const fabrica = window.indexedDB;
      if (!fabrica || typeof fabrica.open !== 'function') {
        usandoMemoria = true;
        resolve(null);
        return;
      }
      let req;
      try {
        req = fabrica.open(CONFIG_CONTATOS.BANCO, CONFIG_CONTATOS.VERSAO_BANCO);
      } catch {
        usandoMemoria = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CONFIG_CONTATOS.TABELA)) db.createObjectStore(CONFIG_CONTATOS.TABELA, { keyPath: 'raiz' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); bancoPromessa = null; };
        resolve(db);
      };
      req.onerror = () => { usandoMemoria = true; resolve(null); };
    });
    return bancoPromessa;
  }

  const agruparPorRaiz = (contatos) => {
    const mapa = new Map();
    contatos.forEach((c) => {
      if (!mapa.has(c.raiz)) mapa.set(c.raiz, []);
      mapa.get(c.raiz).push({ uf: c.uf, grupo: c.grupo, razao: c.razao ?? null, nome: c.nome, celulares: c.celulares });
    });
    return mapa;
  };

  /** Substitui TUDO pelo que veio do CSV (numa transação só: ou troca tudo, ou nada). */
  async function guardarContatos(contatos) {
    const mapa = agruparPorRaiz(contatos);
    const db = await abrirBanco();
    if (!db) {
      memoria.clear();
      mapa.forEach((itens, raiz) => memoria.set(raiz, itens));
      return { raizes: mapa.size, naMemoria: true };
    }
    const tx = db.transaction(CONFIG_CONTATOS.TABELA, 'readwrite');
    const loja = tx.objectStore(CONFIG_CONTATOS.TABELA);
    loja.clear();
    mapa.forEach((itens, raiz) => loja.put({ raiz, itens }));
    await fimDaTransacao(tx);
    return { raizes: mapa.size, naMemoria: false };
  }

  async function buscarPorRaiz(raiz) {
    if (!raiz) return [];
    const db = await abrirBanco();
    if (!db) return memoria.get(raiz) ?? []; // a memória só recebe contatos importados agora, já com o primeiro nome
    const registro = await pedido(db.transaction(CONFIG_CONTATOS.TABELA).objectStore(CONFIG_CONTATOS.TABELA).get(raiz));
    // Contatos importados ANTES da regra do primeiro nome têm o nome inteiro no banco.
    return (registro?.itens ?? []).map((i) => ({ ...i, nome: primeiroNome(i.nome) }));
  }

  async function apagarTudo() {
    const db = await abrirBanco();
    memoria.clear();
    if (db) {
      const tx = db.transaction(CONFIG_CONTATOS.TABELA, 'readwrite');
      tx.objectStore(CONFIG_CONTATOS.TABELA).clear();
      await fimDaTransacao(tx);
    }
    metaNaMemoria = null;
    gravarMeta(null);
  }

  // Plano B (sem IndexedDB): os contatos somem ao recarregar, então a data também NÃO pode sobreviver.
  let metaNaMemoria = null;

  function lerMeta() {
    if (usandoMemoria) return metaNaMemoria;
    try {
      const m = JSON.parse(window.localStorage.getItem(CONFIG_CONTATOS.CHAVE_META) || 'null');
      return m && m.versao === 1 ? m : null;
    } catch {
      return null;
    }
  }

  function gravarMeta(meta) {
    try {
      if (meta) window.localStorage.setItem(CONFIG_CONTATOS.CHAVE_META, JSON.stringify({ versao: 1, ...meta }));
      else window.localStorage.removeItem(CONFIG_CONTATOS.CHAVE_META);
    } catch { /* só a data de exibição: sem ela o painel diz "importado" sem a data */ }
  }

  /**
   * Lê o texto do CSV, guarda e devolve o resumo. Nunca guarda nada se o CSV for inválido.
   * @returns {Promise<{erro: string} | {resumo: object, raizes: number, naMemoria: boolean}>}
   */
  async function importarCsv(texto) {
    const lido = contatosDoCsv(texto);
    if (lido.erro) return lido;
    if (lido.contatos.length === 0) {
      return { erro: 'Nenhum contato no padrão "RAZÃO - RAIZ DO CNPJ - UF" foi encontrado. Nada foi alterado.', resumo: lido.resumo };
    }
    try {
      const { raizes, naMemoria } = await guardarContatos(lido.contatos);
      const meta = { importadoEm: util().dataIso(util().normalizarData(new Date())), contatos: lido.contatos.length, raizes, comRazao: true };
      if (naMemoria) metaNaMemoria = { versao: 1, ...meta };
      else gravarMeta(meta);
      return { resumo: lido.resumo, raizes, naMemoria };
    } catch (erro) {
      return { erro: 'O navegador recusou a gravação dos contatos (' + (erro?.name || 'erro') + '). Nada foi alterado.' };
    }
  }

  /* ---------------------------------------------------------------------
   * PÁGINA DO CLIENTE: sugestão e preenchimento do modal do CRM
   * --------------------------------------------------------------------- */

  function cnpjDaPagina() {
    try {
      return new URLSearchParams(window.location.search).get('cnpj') || window.__CLIENTE_CNPJ__ || '';
    } catch {
      return window.__CLIENTE_CNPJ__ || '';
    }
  }

  /** O responsável que o CRM tem agora ({nome, celular}); null se a página não expõe. */
  function responsavelDoCrm() {
    const r = window.__RESPONSAVEL__;
    return r && typeof r === 'object' ? { nome: r.nome || '', celular: r.celular || '' } : null;
  }

  function definirCampo(el, valor) {
    el.value = valor;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  const avisar = (mensagem, ms) => util()?.toast?.(mensagem, ms);

  /** Depois do Salvar do CRM: confere se o responsável da página passou a ser o que foi digitado. */
  function conferirDepoisDoSalvar(nomeDigitado, celularDigitado) {
    const iguais = (r) => Boolean(r) && r.nome.trim() === nomeDigitado.trim()
      && digitosDoCelular(r.celular) === digitosDoCelular(celularDigitado);
    // Já igual ANTES de o CRM responder: não dá para dizer que ele gravou (o PUT pode até ter falhado).
    if (iguais(responsavelDoCrm())) {
      avisar('O CRM já tinha este nome e este celular: nada mudou.');
      return;
    }
    const limite = Date.now() + CONFIG_CONTATOS.TIMEOUT_CONFIRMACAO_MS;
    const tentar = () => {
      if (iguais(responsavelDoCrm())) {
        avisar('Responsável conferido no CRM: nome e celular batem.');
        return;
      }
      if (Date.now() >= limite) {
        avisar('O CRM não confirmou o responsável. Abra o "Responsável financeiro" e confira antes de seguir.', 9000);
        return;
      }
      setTimeout(tentar, CONFIG_CONTATOS.INTERVALO_CONFIRMACAO_MS);
    };
    tentar();
  }

  function aguardarEnvio(form) {
    if (ouvinteEnvio) ouvinteEnvio.form.removeEventListener('submit', ouvinteEnvio.fn, true);
    const fn = () => {
      form.removeEventListener('submit', fn, true);
      ouvinteEnvio = null;
      // Lê os campos NO MOMENTO do envio: é o que o CRM vai gravar.
      conferirDepoisDoSalvar(document.getElementById('resp-nome-input')?.value ?? '', document.getElementById('resp-celular-input')?.value ?? '');
    };
    form.addEventListener('submit', fn, true);
    ouvinteEnvio = { form, fn };
  }

  /**
   * Abre o modal do CRM e preenche. O que já está no modal só é trocado com `substituir`.
   * NÃO salva: o usuário confere e clica em Salvar (o CRM grava e este módulo confere depois).
   * @returns {{ok: boolean, motivo?: string, nome?: boolean, celular?: boolean}}
   */
  function preencherModal(item, celular, substituir) {
    if (typeof window.abrirModalResponsavel !== 'function') {
      avisar('Não achei o "Responsável financeiro" do CRM nesta página.', 6000);
      return { ok: false, motivo: 'sem-modal' };
    }
    window.abrirModalResponsavel();
    const nomeEl = document.getElementById('resp-nome-input');
    const celEl = document.getElementById('resp-celular-input');
    if (!nomeEl || !celEl) {
      avisar('O modal do responsável mudou: não achei os campos. Preencha à mão.', 8000);
      return { ok: false, motivo: 'sem-campos' };
    }
    const decisao = decidirPreenchimento(item, celular, nomeEl.value, celEl.value, substituir, lerModo());
    if (decisao.motivo === 'outro-nome') {
      const nomeAtual = nomeEl.value.trim();
      window.fecharModalResponsavel?.();
      avisar(`O CRM já tem outro nome (${nomeAtual}). Para não misturar o nome de uma pessoa com o celular de outra, nada foi digitado. Marque "Substituir o que já está no CRM" se quiser trocar.`, 10000);
      return { ok: false, motivo: 'outro-nome' };
    }
    if (decisao.motivo === 'nada') {
      window.fecharModalResponsavel?.();
      avisar('Nada a preencher: o CRM já tem esses campos. Marque "Substituir o que já está no CRM" para trocar.', 7000);
      return { ok: false, motivo: 'nada-a-preencher' };
    }
    const resultado = { ok: true, nome: decisao.nome, celular: decisao.celular };
    if (decisao.nome) definirCampo(nomeEl, item.nome);
    if (decisao.celular) definirCampo(celEl, formatarCelular(celular));
    const salvar = document.getElementById('resp-btn-salvar');
    if (salvar) salvar.focus();
    avisar('Preenchido. Confira o nome e o celular (o celular é o do WhatsApp) e clique em Salvar.', 7000);

    const form = document.getElementById('form-responsavel');
    if (form) aguardarEnvio(form);
    return resultado;
  }

  /* ---------------------------------------------------------------------
   * INTERFACE
   * --------------------------------------------------------------------- */

  function criarDiv(texto, estilo) {
    const el = document.createElement('div');
    if (texto) el.textContent = texto;
    Object.assign(el.style, estilo || {});
    return el;
  }

  function criarBotao(texto, acao, primario) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.dataset.acao = acao;
    Object.assign(b.style, primario
      ? { background: CORES.tinta, color: '#fff', border: 'none' }
      : { background: '#fff', color: CORES.texto, border: `1px solid ${CORES.borda}` });
    Object.assign(b.style, { borderRadius: '6px', padding: '6px 12px', fontSize: '12.5px', cursor: 'pointer', fontWeight: '600' });
    return b;
  }

  function fecharAviso() {
    if (!avisoEl) return;
    avisoEl.remove();
    avisoEl = null;
  }

  function fecharPainel() {
    if (!painelEl) return;
    painelEl.remove();
    painelEl = null;
  }

  /** Aviso da página do cliente: um cartão por contato, na pilha de avisos (fica até o usuário fechar). */
  function mostrarAviso(itens, crm) {
    fecharAviso();
    if (!itens || itens.length === 0) return;
    avisoEl = document.createElement('div');
    avisoEl.id = CONFIG_CONTATOS.ID_AVISO;
    avisoEl.setAttribute('role', 'alertdialog');
    Object.assign(avisoEl.style, {
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '12px 14px',
      boxShadow: '0 10px 34px rgba(0,0,0,0.28)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      width: '380px',
      maxWidth: '90vw',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
      pointerEvents: 'auto',
    });
    avisoEl.appendChild(criarDiv('Contato do Google Contatos para este cliente', { color: CORES.tinta, fontWeight: '700', marginBottom: '8px' }));
    if (!crm) {
      avisoEl.appendChild(criarDiv('Não consegui ler o responsável atual do CRM: o que já estiver no modal não será trocado.', {
        color: CORES.aviso, fontSize: '12px', marginBottom: '8px',
      }));
    }

    const modo = lerModo();
    itens.forEach((item) => {
      const cartao = criarDiv('', { borderLeft: `5px solid ${CORES.destaque}`, padding: '4px 0 4px 10px', marginBottom: '10px' });
      cartao.dataset.papel = 'contato';
      cartao.appendChild(criarDiv(item.nome || '(contato sem o nome do responsável)', { color: CORES.tinta, fontWeight: '700' }));
      cartao.appendChild(criarDiv([item.uf, item.grupo].filter(Boolean).join(' · '), { color: CORES.apagado, fontSize: '11.5px', marginBottom: '4px' }));

      const nomeCrm = crm?.nome?.trim() || '';
      const celCrm = crm?.celular?.trim() || '';
      if (crm && (nomeCrm || celCrm)) {
        cartao.appendChild(criarDiv(`No CRM: ${nomeCrm || 'sem nome'} · ${celCrm || 'sem celular'}`, { color: CORES.texto, fontSize: '12px', marginBottom: '4px' }));
      }
      const celularesDoItem = item.celulares.map((c) => formatarCelular(c));
      if (celularesDoItem.length > 0) {
        cartao.appendChild(criarDiv('Celular no contato: ' + celularesDoItem.join(' · '), { color: CORES.texto, fontSize: '12px', marginBottom: '6px' }));
      }

      // "Substituir" aparece quando, com ele, "Preencher" faria algo diferente (mesma regra do preenchimento).
      const celularesOferecidos = modo.celular && item.celulares.length > 0 ? item.celulares : [null];
      const trocaria = Boolean(crm) && celularesOferecidos.some((c) => {
        const sem = decidirPreenchimento(item, c, nomeCrm, celCrm, false, modo);
        const com = decidirPreenchimento(item, c, nomeCrm, celCrm, true, modo);
        return sem.nome !== com.nome || sem.celular !== com.celular || sem.motivo !== com.motivo;
      });
      let substituirEl = null;
      if (trocaria) {
        const rotulo = document.createElement('label');
        Object.assign(rotulo.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: CORES.aviso, margin: '0 0 6px', cursor: 'pointer' });
        substituirEl = document.createElement('input');
        substituirEl.type = 'checkbox';
        substituirEl.dataset.campo = 'substituir';
        rotulo.appendChild(substituirEl);
        rotulo.appendChild(document.createTextNode('Substituir o que já está no CRM'));
        cartao.appendChild(rotulo);
      }

      const botoes = criarDiv('', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
      const aoPreencher = (celular) => {
        const r = preencherModal(item, celular, Boolean(substituirEl?.checked));
        if (r.ok) fecharAviso();
      };
      if (!(modo.celular && item.celulares.length > 0)) {
        const b = criarBotao('Preencher o nome', 'preencher', true);
        b.addEventListener('click', () => aoPreencher(null));
        botoes.appendChild(b);
      } else {
        item.celulares.forEach((c) => {
          const comNome = modo.nome && item.nome;
          const b = criarBotao(comNome ? `Preencher · ${formatarCelular(c)}` : `Preencher o celular · ${formatarCelular(c)}`, 'preencher', true);
          b.addEventListener('click', () => aoPreencher(c));
          botoes.appendChild(b);
        });
      }
      cartao.appendChild(botoes);
      avisoEl.appendChild(cartao);
    });

    const ignorar = criarBotao('Ignorar', 'ignorar', false);
    ignorar.addEventListener('click', fecharAviso);
    avisoEl.appendChild(criarDiv('', { display: 'flex', justifyContent: 'flex-end' })).appendChild(ignorar);
    if (typeof util()?.colocarNaPilha === 'function') {
      util().colocarNaPilha(avisoEl, { fixo: true });
    } else {
      // Módulo 0 antigo em cache: sem a pilha, o aviso ainda precisa aparecer.
      Object.assign(avisoEl.style, { position: 'fixed', right: '24px', bottom: '150px', zIndex: CONFIG_CONTATOS.Z_INDEX_POPUP });
      document.body.appendChild(avisoEl);
    }
  }

  async function avaliarPagina() {
    let itens;
    try {
      // Sem raiz (lista, busca...), buscarPorRaiz devolve vazio sem nem abrir o banco.
      itens = await buscarPorRaiz(raizDoCnpj(cnpjDaPagina()));
    } catch {
      avisar('Contatos do Google: não consegui ler os contatos guardados neste navegador (abra o Alt+J e importe de novo).', 8000);
      return;
    }
    if (itens.length === 0) return;
    // A página pode definir o responsável um pouco depois do userscript: espera antes de decidir "sem leitura".
    const limite = Date.now() + CONFIG_CONTATOS.TIMEOUT_RESPONSAVEL_MS;
    while (!responsavelDoCrm() && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG_CONTATOS.INTERVALO_RESPONSAVEL_MS));
    }
    const crm = responsavelDoCrm();
    mostrarAviso(itens.filter((i) => temNovidade(i, crm)), crm);
  }

  function dataBr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  function descreverGuardados() {
    const meta = lerMeta();
    if (!meta) return 'Nenhum contato guardado.';
    const data = dataBr(meta.importadoEm);
    return `Guardados: ${meta.contatos} contato(s) de ${meta.raizes} empresa(s)${data ? ', importados em ' + data : ''}.`;
  }

  function lerArquivo(arquivo) {
    return new Promise((resolve, reject) => {
      const leitor = new window.FileReader();
      leitor.onload = () => resolve(String(leitor.result ?? ''));
      leitor.onerror = () => reject(leitor.error ?? new Error('leitura falhou'));
      leitor.readAsText(arquivo, 'utf-8');
    });
  }

  function textoDoResumo(r) {
    const partes = [
      `${r.resumo.lidos} contato(s) lido(s)`,
      `${r.resumo.reconhecidos} no padrão`,
      `${r.resumo.foraDoPadrao} fora do padrão, ignorados (${r.resumo.foraSemRaiz} sem raiz de CNPJ, ${r.resumo.foraRaizSemUf} com raiz mas sem UF válida, ${r.resumo.foraVazio} sem nome)`,
      `${r.resumo.semNome} sem o nome do responsável (não há nome depois da UF no Google: preencha lá)`,
      `${r.resumo.semCelular} sem celular`,
    ];
    if (r.resumo.nomeLongo > 0) partes.push(`${r.resumo.nomeLongo} com nome longo demais (sem o nome)`);
    return partes.join(' · ');
  }

  /**
   * Os dois interruptores (Nome / Celular): o que o aviso do cliente e a lista de diferenças comparam e
   * preenchem. Pelo menos um fica ligado. `aoMudar` roda depois de gravar (a lista recalcula sem baixar de novo).
   */
  function criarInterruptoresDoModo(aoMudar) {
    const caixa = criarDiv('', { display: 'flex', gap: '16px', alignItems: 'center', margin: '0 0 8px', flexWrap: 'wrap' });
    caixa.dataset.papel = 'modo';
    caixa.appendChild(criarDiv('Comparar e preencher:', { color: CORES.texto, fontSize: '12px' }));
    const campos = {};
    [['nome', 'Nome do responsável'], ['celular', 'Celular']].forEach(([chave, rotulo]) => {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: CORES.texto, fontSize: '12.5px' });
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.dataset.campo = `modo-${chave}`;
      el.checked = lerModo()[chave];
      campos[chave] = el;
      label.appendChild(el);
      label.appendChild(document.createTextNode(rotulo));
      caixa.appendChild(label);
    });
    const dica = criarDiv('Pelo menos um precisa ficar ligado.', { color: CORES.aviso, fontSize: '11.5px', display: 'none' });
    dica.dataset.papel = 'dica-modo';
    caixa.appendChild(dica);
    Object.values(campos).forEach((el) => el.addEventListener('change', () => {
      const novo = { nome: campos.nome.checked, celular: campos.celular.checked };
      if (!definirModo(novo)) {
        // Os dois desligados não valem: volta o que estava gravado.
        const atual = lerModo();
        campos.nome.checked = atual.nome;
        campos.celular.checked = atual.celular;
        dica.style.display = 'block';
        return;
      }
      dica.style.display = 'none';
      if (typeof aoMudar === 'function') aoMudar(lerModo());
    }));
    return caixa;
  }

  /** "1.015" no padrão do usuário (separador de milhar). */
  const comMilhar = (n) => Number(n).toLocaleString('pt-BR');

  /**
   * Lê o CSV, corrige (Módulo 33) e baixa só os contatos corrigidos. Escreve o resultado em `saida`.
   * Separado do clique para os testes chamarem com um arquivo sem abrir o seletor do navegador.
   */
  async function corrigirArquivoEBaixar(arquivo, saida) {
    saida.style.color = CORES.texto;
    saida.textContent = 'Lendo...';
    let texto;
    try {
      texto = await lerArquivo(arquivo);
    } catch {
      texto = null;
    }
    let r;
    if (texto === null) {
      r = { erro: 'Não consegui ler o arquivo.' };
    } else {
      try {
        r = window.__corretorCsv.corrigirCsv(texto);
      } catch (erro) {
        // Defeito do código, não do arquivo: aparece no console (só o tipo e a mensagem do erro, nunca o conteúdo).
        console.error('[Contatos do Google] Falha ao corrigir o CSV:', erro?.name, erro?.message);
        r = { erro: 'Não consegui ler o arquivo.' };
      }
    }
    if (r.erro) {
      saida.style.color = CORES.erro;
      saida.textContent = r.erro;
      return r;
    }
    if (!r.csv) {
      saida.textContent = 'Nenhum contato precisa de correção.';
      return r;
    }
    window.__corretorCsv.baixar(window.__corretorCsv.NOME_ARQUIVO, r.csv);
    saida.style.color = CORES.destaque;
    saida.textContent = `${comMilhar(r.resumo.corrigidos)} corrigido(s) · ${comMilhar(r.resumo.jaNoPadrao)} já estavam no padrão · ${comMilhar(r.resumo.semComoCorrigir)} sem como corrigir. Baixado: ${window.__corretorCsv.NOME_ARQUIVO}`;
    return r;
  }

  /** O bloco "Corrigir CSV e baixar" do painel (botão, dica e resultado). O seletor de arquivo nasce no clique. */
  let seletorDoCorretor = null; // referência até o "change": um input solto não pode ser coletado com o seletor aberto

  function criarCorretor() {
    const bloco = criarDiv('', { margin: '10px 0 8px' });
    bloco.dataset.papel = 'corretor';
    const botao = criarBotao('Corrigir CSV e baixar', 'corrigir', false);
    const saida = criarDiv('', { fontSize: '12px', margin: '6px 0 0', lineHeight: '1.5' });
    saida.dataset.papel = 'resultado-corretor';
    botao.addEventListener('click', () => {
      const escolha = document.createElement('input');
      escolha.type = 'file';
      escolha.accept = '.csv,text/csv';
      escolha.addEventListener('change', () => {
        const arquivo = escolha.files && escolha.files[0];
        seletorDoCorretor = null;
        if (arquivo) corrigirArquivoEBaixar(arquivo, saida);
      });
      seletorDoCorretor = escolha;
      escolha.click();
    });
    bloco.appendChild(botao);
    bloco.appendChild(criarDiv('Gera um CSV só com os contatos que o Alt+J consegue arrumar (o nome vai inteiro no padrão). O arquivo é lido e baixado aqui, nada é enviado.', {
      color: CORES.apagado, fontSize: '11.5px', marginTop: '4px',
    }));
    bloco.appendChild(saida);
    return bloco;
  }

  function abrirPainel() {
    util()?.fecharOutrosPaineis?.('contatosGoogle');
    fecharPainel();

    painelEl = document.createElement('div');
    painelEl.id = CONFIG_CONTATOS.ID_PAINEL;
    Object.assign(painelEl.style, {
      position: 'fixed',
      bottom: '112px',
      left: '16px',
      background: CORES.fundo,
      border: `1px solid ${CORES.borda}`,
      borderRadius: '10px',
      padding: '14px 16px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      zIndex: CONFIG_CONTATOS.Z_INDEX_POPUP,
      width: '440px',
      maxWidth: '92vw',
      maxHeight: '70vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
    });

    painelEl.appendChild(criarDiv('Contatos do Google', { color: CORES.tinta, fontWeight: '700', fontSize: '14px' }));
    painelEl.appendChild(criarDiv('Escolha o CSV exportado do Google Contatos ("Google CSV"). O arquivo é lido aqui e os contatos ficam só neste navegador.', {
      color: CORES.apagado, fontSize: '11.5px', margin: '2px 0 8px',
    }));
    painelEl.appendChild(criarDiv('Padrão do nome do contato: RAZÃO - RAIZ DO CNPJ - UF - GP n - nome do responsável (grupo e nome são opcionais; também vale só RAZÃO - RAIZ, sem a UF).', {
      color: CORES.texto, fontSize: '12px', marginBottom: '8px',
    }));

    const status = criarDiv(descreverGuardados(), { color: CORES.texto, margin: '0 0 8px' });
    status.dataset.papel = 'status';
    painelEl.appendChild(status);
    if (lerMeta() && !lerMeta().comRazao) {
      painelEl.appendChild(criarDiv('Estes contatos foram importados sem a razão social: importe o CSV de novo para a lista de diferenças comparar também a razão.', {
        color: CORES.aviso, fontSize: '12px', marginBottom: '8px',
      }));
    }
    painelEl.appendChild(criarInterruptoresDoModo());
    if (usandoMemoria) {
      painelEl.appendChild(criarDiv('O navegador não deixou usar o armazenamento local: os contatos valem só nesta aba.', { color: CORES.aviso, fontSize: '12px', marginBottom: '8px' }));
    }

    const resultado = criarDiv('', { fontSize: '12px', margin: '8px 0', lineHeight: '1.5' });
    resultado.dataset.papel = 'resultado';

    const arquivoEl = document.createElement('input');
    arquivoEl.type = 'file';
    arquivoEl.accept = '.csv,text/csv';
    arquivoEl.dataset.campo = 'arquivo';
    arquivoEl.addEventListener('change', async () => {
      const arquivo = arquivoEl.files && arquivoEl.files[0];
      if (!arquivo) return;
      resultado.style.color = CORES.texto;
      resultado.textContent = 'Lendo...';
      let r;
      try {
        r = await importarCsv(await lerArquivo(arquivo));
      } catch {
        r = { erro: 'Não consegui ler o arquivo.' };
      }
      // Sem limpar, escolher o MESMO arquivo de novo (reexportado, corrigido) não dispara "change".
      arquivoEl.value = '';
      if (r.erro) {
        resultado.style.color = CORES.erro;
        resultado.textContent = r.erro + (r.resumo ? ' (' + textoDoResumo(r) + ')' : '');
        return;
      }
      resultado.style.color = CORES.destaque;
      resultado.textContent = `Importado: ${r.raizes} empresa(s). ${textoDoResumo(r)}.` + (r.naMemoria ? ' (só nesta aba)' : '');
      status.textContent = descreverGuardados();
    });
    painelEl.appendChild(arquivoEl);
    painelEl.appendChild(resultado);
    if (window.__corretorCsv) painelEl.appendChild(criarCorretor());
    painelEl.appendChild(criarDiv('Importar de novo substitui tudo o que estava guardado.', { color: CORES.apagado, fontSize: '11.5px' }));

    const rodape = criarDiv('', { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
    let confirmando = false;
    let relogio = null;
    const apagar = criarBotao('Apagar contatos guardados', 'apagar', false);
    const desarmar = () => {
      clearTimeout(relogio);
      confirmando = false;
      apagar.textContent = 'Apagar contatos guardados';
      apagar.style.color = CORES.texto;
    };
    apagar.addEventListener('click', async () => {
      if (!confirmando) {
        confirmando = true;
        apagar.textContent = 'Clique de novo para apagar';
        apagar.style.color = CORES.erro;
        // Um clique casual horas depois não pode apagar a base: a confirmação expira.
        relogio = setTimeout(desarmar, CONFIG_CONTATOS.TEMPO_CONFIRMAR_APAGAR_MS);
        return;
      }
      desarmar();
      try {
        await apagarTudo();
        status.textContent = descreverGuardados();
        resultado.textContent = '';
      } catch {
        resultado.style.color = CORES.erro;
        resultado.textContent = 'O navegador recusou apagar. Tente de novo.';
      }
    });
    rodape.appendChild(apagar);
    const fechar = criarBotao('Fechar', 'fechar', true);
    fechar.addEventListener('click', fecharPainel);
    rodape.appendChild(fechar);
    painelEl.appendChild(rodape);
    painelEl.appendChild(criarDiv('Alt+J ou Esc para fechar', { color: CORES.apagado, fontSize: '11px', textAlign: 'center', marginTop: '8px' }));

    document.body.appendChild(painelEl);
    util()?.acompanharMenuLateral?.(painelEl);
  }

  function alternarPainel() {
    if (painelEl) {
      fecharPainel();
      return;
    }
    abrirPainel();
  }

  /* ---------------------------------------------------------------------
   * CARGA DA PÁGINA
   * --------------------------------------------------------------------- */

  function iniciar() {
    if (iniciou) return;
    iniciou = true;
    avaliarPagina();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  // Esc fecha o painel. Registrado uma vez só: um listener por abertura vazaria.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && painelEl) fecharPainel();
  });

  util()?.registrarPainel?.('contatosGoogle', fecharPainel);

  window.__contatosGoogle = {
    lerCsv,
    interpretarNome,
    interpretarNomeEstrito: interpretarEstrito,
    prepararCsv,
    textosDoContato,
    acharRaizEUf,
    textoCanonico,
    motivoForaDoPadrao,
    primeiroNome,
    normalizarCelular,
    formatarCelular,
    contatosDoCsv,
    raizDoCnpj,
    temNovidade,
    novidadesDoContato,
    decidirPreenchimento,
    chaveDoCelular,
    mesmoCelular,
    mesmoNome,
    razaoConfere,
    lerResponsavelDoHtml,
    gravarResponsavelNoCrm,
    lerModo,
    definirModo,
    criarInterruptoresDoModo,
    importarCsv,
    guardarContatos,
    buscarPorRaiz,
    apagarTudo,
    lerMeta,
    avaliarPagina,
    mostrarAviso,
    fecharAviso,
    preencherModal,
    abrirPainel,
    corrigirArquivoEBaixar,
    seletorPendenteDoCorretor: () => seletorDoCorretor,
    fecharPainel,
    alternarPainel,
    estaAberto: () => painelEl !== null,
    avisoEstaAberto: () => avisoEl !== null,
    estaUsandoMemoria: () => usandoMemoria,
    CONFIG_CONTATOS,
  };
})();
