/* =========================================================================
 * MÓDULO 33: CORRETOR DE CSV DOS CONTATOS DO GOOGLE — CRM TexCotton
 * -------------------------------------------------------------------------
 * Pedido do usuário (08/10/2026): mandar o CSV exportado do Google Contatos para um código que
 * organize os nomes e devolva um arquivo para importar de volta no Google.
 *
 * O que faz (só funções, sem tela e sem tocar na página; a tela é o painel do Alt+J, Módulo 28):
 *   1. lê o "Google CSV" com o mesmo leitor do Módulo 28 (lerCsv, interpretarNome);
 *   2. de cada contato cujo nome (First/Middle/Last juntos) o leitor ESTRITO do padrão
 *      "RAZÃO - RAIZ - UF[ - GP n][ - nome]" NÃO entende, mas a leitura tolerante entende ("SP Maria",
 *      "12345678-SP"), escreve o texto no padrão inteiro em First Name e esvazia Name Prefix, Middle
 *      Name, Last Name e Name Suffix (senão o Google quebraria o texto de novo pelos espaços);
 *   3. devolve um CSV SÓ com o cabeçalho e os contatos corrigidos (decisão do usuário), com todas as
 *      outras colunas intactas, e contagens.
 *
 * O que NÃO faz: não cria nome nem UF que o contato não tem; não mexe em contato que já está no
 * padrão (nem em raiz pontuada, que seria só diferença de aparência); não mexe nas outras colunas
 * (File As, e-mails, telefones, notas...). Nada é enviado: o arquivo é lido e baixado no navegador.
 * Privacidade: nenhum texto de contato vai para o console nem para as mensagens de erro.
 *
 * NÃO VERIFICADO: o que o Google faz ao importar um arquivo com contatos que já existem (duplica ou
 * atualiza). O usuário ficou de testar com 2 contatos; até lá, não recomendar importar o arquivo
 * grande.
 *
 * Carga: depois do Módulo 28 (usa window.__contatosGoogle). Expõe window.__corretorCsv.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.__corretorCsvCarregado) return;
  window.__corretorCsvCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Corretor de CSV');

  const NOME_ARQUIVO = 'contatos-google-corrigidos.csv';

  /** Uma célula no formato do CSV: entre aspas se tiver vírgula, aspas ou quebra de linha. */
  function celulaCsv(valor) {
    const s = String(valor ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** Linhas de células -> texto CSV (CRLF, com quebra no fim). Sem BOM: o leitor de arquivo do navegador já o descarta. */
  function escreverCsv(linhas) {
    return linhas.map((l) => l.map(celulaCsv).join(',')).join('\r\n') + '\r\n';
  }

  const soAlfanumerico = (t) => String(t ?? '').replace(/[^\p{L}\p{N}]/gu, '');

  /**
   * Só reescreve quando NÃO se perde nem se inventa texto: as letras e os números do contato têm que ser exatamente os
   * mesmos antes e depois (muda só a pontuação e os espaços). Isso barra a razão social muito longa (o Alt+J guarda só
   * as 120 primeiras letras dela, e esse corte não pode ir para o Google) e qualquer leitura que não seja só reorganizar.
   * Também barra o grupo que engoliu o nome ("SP GP 3 Maria" vira o grupo "GP 3 Maria"): sem hífen não dá para saber onde
   * o grupo termina, e a regra do grupo não é adivinhada; o usuário corrige esse à mão.
   */
  function consertoSeguro(original, canonico, achado) {
    if (soAlfanumerico(original) !== soAlfanumerico(canonico)) return false;
    if (achado.grupo && achado.grupo.split(/\s+/).length > 2) return false;
    return true;
  }

  /**
   * "Google CSV" -> CSV só com os contatos corrigidos + contagens.
   *   corrigidos: o leitor estrito não entendia e a leitura tolerante entende, com UF, sem perder texto (entram no arquivo);
   *   jaNoPadrao: o Alt+J já lê o contato (algum texto no padrão estrito, ou o padrão com UF em File As/Organization);
   *     não entram, nem a raiz pontuada;
   *   semComoCorrigir: tem raiz mas falta o que o código não inventa (UF), a leitura perderia texto, o grupo engoliria o
   *     nome ou não dá para entender;
   *   um contato sem raiz de CNPJ (pessoal) não entra em nenhuma conta, só em `lidos`.
   *
   * @param {string} texto conteúdo do arquivo
   * @returns {{erro: string} | {csv: string|null, resumo: {lidos: number, corrigidos: number, jaNoPadrao: number, semComoCorrigir: number}}}
   *   `csv` é null quando nada precisa de correção.
   */
  function corrigirCsv(texto) {
    const G = window.__contatosGoogle;
    if (!G || !G.prepararCsv || !G.textosDoContato || !G.interpretarNome || !G.interpretarNomeEstrito || !G.textoCanonico || !G.motivoForaDoPadrao) {
      return { erro: 'Os Contatos do Google (Alt+J) não carregaram.' };
    }
    // Mesma leitura e mesmas mensagens da importação: arquivo vazio, cortado ou sem as colunas do "Google CSV".
    const preparado = G.prepararCsv(texto);
    if (preparado.erro) return { erro: preparado.erro };
    const { linhas, colunas } = preparado;
    const total = linhas[0].length;
    const colsEsvaziar = colunas.nome.filter((i) => i >= 0 && i !== colunas.first); // Prefix, Middle, Last, Suffix

    const resumo = { lidos: 0, corrigidos: 0, jaNoPadrao: 0, semComoCorrigir: 0 };
    const saida = [linhas[0]];
    linhas.slice(1).forEach((linha) => {
      if (linha.every((c) => c.trim() === '')) return;
      resumo.lidos += 1;
      const { textos } = G.textosDoContato(linha, colunas);

      if (textos.some((t) => G.interpretarNomeEstrito(t))) { resumo.jaNoPadrao += 1; return; }
      const achados = textos.map(G.interpretarNome);
      if (achados[0] && achados[0].uf) {
        const canonico = G.textoCanonico(achados[0]);
        if (!consertoSeguro(textos[0], canonico, achados[0])) { resumo.semComoCorrigir += 1; return; }
        const nova = linha.slice();
        while (nova.length < total) nova.push('');
        nova[colunas.first] = canonico;
        colsEsvaziar.forEach((i) => { nova[i] = ''; });
        saida.push(nova);
        resumo.corrigidos += 1;
        return;
      }
      if (achados.some((a) => a && a.uf)) { resumo.jaNoPadrao += 1; return; } // o Alt+J já lê por File As ou Organization
      // Sobrou o que tem raiz de CNPJ e o código não conserta: sem UF ("RAZÃO - RAIZ"), UF inválida ou texto que não dá
      // para entender. O contato sem raiz (pessoal) não entra em conta nenhuma.
      if (textos.filter((t) => t.trim()).some((t) => G.motivoForaDoPadrao(t) === 'raiz-sem-uf')) resumo.semComoCorrigir += 1;
    });

    return { csv: resumo.corrigidos > 0 ? escreverCsv(saida) : null, resumo };
  }

  /** Baixa `texto` como arquivo `nome` (Blob + link temporário). Trocável nos testes. */
  function baixar(nome, texto) {
    const blob = new window.Blob([texto], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  window.__corretorCsv = { NOME_ARQUIVO, celulaCsv, escreverCsv, corrigirCsv, baixar };
})();
