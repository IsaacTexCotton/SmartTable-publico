/* MÓDULO 41: RELATÓRIOS AGRUPADOS POR CLIENTE */
(function () {
  'use strict';
  if (window.__relatorioAgrupadoCarregado) return;
  window.__relatorioAgrupadoCarregado = true;
  window.__smartTableUtil?.registrarModuloCarregado?.('Relatórios Agrupados');

  const LIMITE_MODELO_AGRUPADO = 10;
  const LIMITE_DIVIDIR_EM_DUAS = 15;
  const LIMITE_URGENTE = 6;
  const LIMITE_GRUPO_PARA_DIVISAO = 10;
  const CORES = {
    marinho: '#17212b', texto: '#17212b', apoio: '#586474',
    divisor: '#d8dee6', cabecalhoGrupo: '#eef1f5',
    urgente: '#b3261e', fundoUrgente: '#fcebe8',
  };
  let imagensGeradas = [];

  function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function digitosCnpj(valor) {
    return String(valor ?? '').replace(/\D/g, '');
  }

  function normalizarNome(valor) {
    return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function slugSeguro(valor) {
    return normalizarNome(valor).replace(/\s+/g, '_').slice(0, 60) || 'cliente';
  }

  function cnpjDaPagina() {
    try { return digitosCnpj(new URL(window.location.href).searchParams.get('cnpj')); }
    catch (erro) { return ''; }
  }

  function separarPorCliente(registros) {
    const cnpjAtual = cnpjDaPagina();
    const clientes = new Map();
    registros.forEach((registro) => {
      const cnpj = digitosCnpj(registro.cnpj || cnpjAtual);
      const nome = String(registro.razaoSocial || '').trim();
      const chave = cnpj ? 'cnpj:' + cnpj : 'razao:' + normalizarNome(nome);
      if (chave === 'razao:') throw new Error('Não foi possível identificar uma razão social para separar os relatórios.');
      if (!clientes.has(chave)) clientes.set(chave, { cnpj, nome, registros: [], nomes: new Map() });
      const cliente = clientes.get(chave);
      if (nome) cliente.nomes.set(nome, (cliente.nomes.get(nome) || 0) + 1);
      cliente.registros.push({ ...registro, cnpj });
    });
    return Array.from(clientes.values()).map((cliente) => {
      if (cliente.nomes.size) {
        cliente.nome = Array.from(cliente.nomes.entries()).sort((a, b) => b[1] - a[1])[0][0];
      }
      if (!cliente.nome) throw new Error('Uma empresa do relatório está sem razão social identificável.');
      return cliente;
    });
  }

  function dadosDoCliente(dadosOriginais, cliente) {
    const fluxos = new Set(cliente.registros.map((r) => r.fluxo).filter((f) => f === 'SCPC' || f === 'CARTORIO'));
    const fluxo = fluxos.size > 1 ? 'MISTO' : (fluxos.values().next().value || dadosOriginais.fluxo);
    return {
      ...dadosOriginais,
      registros: cliente.registros,
      fluxo,
      divergentes: cliente.registros.filter((r) => r.divergenciaDias),
    };
  }

  // Faz a conversão de moeda diretamente para centavos inteiros.
  function moedaParaCentavos(valor) {
    let texto = String(valor ?? '').replace(/\u00a0/g, '').replace(/\s/g, '').trim();
    if (!texto) return null;
    const negativo = texto.startsWith('-');
    texto = texto.replace(/[^\d,.]/g, '');
    if (!texto) return null;
    let inteira = '';
    let decimal = '';
    if (texto.includes(',')) {
      const posicao = texto.lastIndexOf(',');
      inteira = texto.slice(0, posicao).replace(/[.,]/g, '');
      decimal = texto.slice(posicao + 1).replace(/\D/g, '');
    } else if (/\.\d{1,2}$/.test(texto)) {
      const posicao = texto.lastIndexOf('.');
      inteira = texto.slice(0, posicao).replace(/[.,]/g, '');
      decimal = texto.slice(posicao + 1).replace(/\D/g, '');
    } else {
      inteira = texto.replace(/[.,]/g, '');
    }
    if (!/^\d+$/.test(inteira) || decimal.length > 2) return null;
    const total = Number(inteira) * 100 + Number(decimal.padEnd(2, '0') || '0');
    if (!Number.isSafeInteger(total)) return null;
    return negativo ? -total : total;
  }

  function formatarCentavos(centavos) {
    return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function ordenarDataBrasileira(texto) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || '').trim());
    if (!m) throw new Error('Há um vencimento inválido no relatório agrupado.');
    return Number(m[3] + m[2] + m[1]);
  }

  function construirGrupos(registros) {
    const grupos = new Map();
    registros.forEach((registro) => {
      const vencimento = String(registro.vencimentoTexto || '').trim();
      const dias = Number(registro.diasAtrasoReal);
      if (!Number.isFinite(dias) || !vencimento) {
        throw new Error('Há um título sem vencimento ou atraso válido no relatório agrupado.');
      }
      const saldoCentavos = moedaParaCentavos(registro.saldoTexto);
      if (saldoCentavos === null) {
        throw new Error('Não foi possível interpretar o saldo de todos os títulos. O relatório agrupado foi bloqueado para não mostrar um total incorreto.');
      }
      const chave = vencimento + '|' + dias;
      if (!grupos.has(chave)) grupos.set(chave, {
        vencimento, dataOrdem: ordenarDataBrasileira(vencimento), dias,
        urgente: dias >= LIMITE_URGENTE, titulos: [], subtotalCentavos: 0,
      });
      const grupo = grupos.get(chave);
      grupo.titulos.push({ registro, saldoCentavos });
      grupo.subtotalCentavos += saldoCentavos;
    });
    return Array.from(grupos.values()).sort((a, b) => {
      if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
      if (a.dias !== b.dias) return b.dias - a.dias;
      return a.dataOrdem - b.dataOrdem;
    });
  }

  function criarTrechoDoGrupo(grupo, titulos, continuacao) {
    return {
      ...grupo,
      titulos,
      continuacao,
      subtotalCentavos: titulos.reduce((soma, titulo) => soma + titulo.saldoCentavos, 0),
    };
  }

  function dividirGruposEquilibradamente(grupos) {
    const total = grupos.reduce((soma, grupo) => soma + grupo.titulos.length, 0);
    if (total < LIMITE_DIVIDIR_EM_DUAS) return [grupos];
    let melhor = null;
    let menorDiferenca = Infinity;
    let vistosAntes = 0;
    grupos.forEach((grupo, indice) => {
      for (let deslocamento = 1; deslocamento <= grupo.titulos.length; deslocamento += 1) {
        const limite = deslocamento === grupo.titulos.length;
        if (!limite && grupo.titulos.length <= LIMITE_GRUPO_PARA_DIVISAO) continue;
        const primeira = vistosAntes + deslocamento;
        const segunda = total - primeira;
        if (!primeira || !segunda) continue;
        const diferenca = Math.abs(primeira - segunda);
        const empatePrimeiraMaior = diferenca === menorDiferenca &&
          primeira > segunda && primeira - segunda <= 2 &&
          melhor && melhor.primeira <= melhor.segunda;
        if (diferenca < menorDiferenca || empatePrimeiraMaior) {
          menorDiferenca = diferenca;
          melhor = { indice, deslocamento, primeira, segunda };
        }
      }
      vistosAntes += grupo.titulos.length;
    });
    if (!melhor) throw new Error('Não foi possível dividir os títulos em duas imagens sem separar um grupo indevidamente.');
    const primeira = [];
    const segunda = [];
    grupos.forEach((grupo, indice) => {
      if (indice < melhor.indice) { primeira.push(grupo); return; }
      if (indice > melhor.indice) { segunda.push(grupo); return; }
      const parte1 = grupo.titulos.slice(0, melhor.deslocamento);
      const parte2 = grupo.titulos.slice(melhor.deslocamento);
      if (parte1.length) primeira.push(criarTrechoDoGrupo(grupo, parte1, false));
      if (parte2.length) segunda.push(criarTrechoDoGrupo(grupo, parte2, true));
    });
    if (!primeira.length || !segunda.length) throw new Error('A divisão do relatório produziu uma imagem vazia.');
    return [primeira, segunda];
  }

  function dataHoraGeracao() {
    return new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function montarCabecalho(nome, dataHora, continuacao) {
    const linha = continuacao
      ? 'Títulos vencidos em aberto · continuação (2/2)'
      : 'Títulos vencidos em aberto · ' + dataHora;
    return '<header style="padding-bottom:11px;border-bottom:2px solid ' + CORES.marinho + ';">' +
      '<div style="font-size:1.35rem;font-weight:800;line-height:1.2;">Relatório</div>' +
      '<div style="font-size:1.05rem;font-weight:700;line-height:1.35;margin-top:4px;overflow-wrap:anywhere;">' +
      escaparHtml(nome) + '</div>' +
      '<div style="font-size:0.8rem;line-height:1.4;color:' + CORES.apoio + ';margin-top:4px;">' +
      escaparHtml(linha) + '</div></header>';
  }

  function montarIndicadores(quantidade, maiorAtraso, totalCentavos) {
    const card = 'background:' + CORES.marinho + ';color:#fff;border-radius:8px;padding:12px;box-sizing:border-box;';
    const rotulo = 'font-size:0.75rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;';
    const numero = 'font-size:1.45rem;font-weight:800;line-height:1.25;margin-top:5px;font-variant-numeric:tabular-nums;';
    return '<section style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">' +
      '<div style="' + card + '"><div style="' + rotulo + '">Títulos vencidos</div><div style="' + numero + '">' + quantidade + '</div></div>' +
      '<div style="' + card + '"><div style="' + rotulo + '">Maior atraso</div><div style="' + numero + '">' + maiorAtraso + ' dias</div></div>' +
      '<div style="' + card + 'grid-column:1 / -1;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
      '<div style="' + rotulo + '">Valor total</div>' +
      '<div style="font-size:1.35rem;font-weight:800;font-variant-numeric:tabular-nums;">' +
      escaparHtml(formatarCentavos(totalCentavos)) + '</div></div></section>';
  }

  function montarAvisoCartorio(urgentes) {
    if (!urgentes.length) return '';
    const quantidade = urgentes.length;
    const total = urgentes.reduce((soma, titulo) => soma + titulo.saldoCentavos, 0);
    const frase = quantidade === 1
      ? '1 título (' + formatarCentavos(total) + ') vence hoje.'
      : quantidade + ' títulos (' + formatarCentavos(total) + ') vencem hoje.';
    return '<aside style="margin-top:12px;padding:12px 13px;background:' + CORES.fundoUrgente +
      ';border-left:5px solid ' + CORES.urgente + ';border-radius:6px;color:#44201d;font-size:0.95rem;line-height:1.45;">' +
      '<strong>Cartório — último dia para pagamento.</strong> ' + escaparHtml(frase) +
      ' Se o pagamento não for identificado até o final do expediente bancário de hoje, serão encaminhados automaticamente para cartório.</aside>';
  }

  function montarGrupo(grupo) {
    const urgente = grupo.urgente;
    const fundo = urgente ? CORES.fundoUrgente : CORES.cabecalhoGrupo;
    const borda = urgente ? '2px solid ' + CORES.urgente : '1px solid ' + CORES.divisor;
    const apoio = (urgente ? 'Último dia · ' : '') +
      grupo.dias + (grupo.dias === 1 ? ' dia de atraso' : ' dias de atraso') +
      ' · ' + grupo.titulos.length + (grupo.titulos.length === 1 ? ' título' : ' títulos') +
      (grupo.continuacao ? ' · continuação' : '');
    const linhas = grupo.titulos.map((item) => {
      const r = item.registro;
      return '<tr data-titulo="' + escaparHtml(r.titulo) + '" style="border-top:1px solid #e3e7ec;">' +
        '<td style="padding:10px 8px;font-size:1.05rem;font-weight:700;line-height:1.35;font-variant-numeric:tabular-nums;">' +
        escaparHtml(r.titulo) + '</td>' +
        '<td style="padding:10px 5px;text-align:center;font-size:1.05rem;line-height:1.35;font-variant-numeric:tabular-nums;">' +
        escaparHtml(r.parcela) + '</td>' +
        '<td style="padding:10px 8px;text-align:right;font-size:1.05rem;font-weight:600;line-height:1.35;white-space:nowrap;font-variant-numeric:tabular-nums;">' +
        escaparHtml(formatarCentavos(item.saldoCentavos)) + '</td></tr>';
    }).join('');
    return '<section data-grupo="' + escaparHtml(grupo.vencimento + '|' + grupo.dias) +
      '" style="margin-top:12px;border:' + borda + ';border-radius:9px;overflow:hidden;background:#fff;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;background:' + fundo + ';">' +
      '<div style="min-width:0;"><div style="font-size:1.05rem;font-weight:800;line-height:1.3;">Venc. ' +
      escaparHtml(grupo.vencimento) + (grupo.continuacao ? ' (continuação)' : '') + '</div>' +
      '<div style="font-size:0.85rem;line-height:1.4;margin-top:3px;color:#424b57;">' + escaparHtml(apoio) + '</div></div>' +
      '<div style="font-size:1rem;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums;">' +
      escaparHtml(formatarCentavos(grupo.subtotalCentavos)) + '</div></div>' +
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#fff;">' +
      '<colgroup><col style="width:44%;"><col style="width:16%;"><col style="width:40%;"></colgroup>' +
      '<thead><tr style="background:#fff;color:#586474;">' +
      '<th style="padding:8px;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;">Título</th>' +
      '<th style="padding:8px;text-align:center;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;">Parc.</th>' +
      '<th style="padding:8px;text-align:right;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;">Saldo</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table></section>';
  }

  function montarRodape(quantidade, totalCentavos) {
    return '<footer style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px;padding:13px 12px;background:' +
      CORES.marinho + ';color:#fff;border-radius:7px;">' +
      '<span style="font-size:0.78rem;font-weight:800;letter-spacing:0.03em;">' + quantidade + ' TÍTULOS VENCIDOS</span>' +
      '<span style="font-size:0.95rem;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;">TOTAL ' +
      escaparHtml(formatarCentavos(totalCentavos)) + '</span></footer>';
  }

  function montarPagina(opcoes) {
    const partes = [montarCabecalho(opcoes.nomeCliente, opcoes.dataHora, opcoes.duasPaginas && opcoes.pagina === 2)];
    if (!opcoes.duasPaginas || opcoes.pagina === 1) {
      partes.push(montarIndicadores(opcoes.quantidade, opcoes.maiorAtraso, opcoes.totalCentavos));
    }
    partes.push(montarAvisoCartorio(opcoes.urgentes));
    opcoes.grupos.forEach((grupo) => partes.push(montarGrupo(grupo)));
    if (opcoes.duasPaginas && opcoes.pagina === 1) {
      partes.push('<div style="margin-top:14px;padding:10px 4px;text-align:center;color:' + CORES.apoio +
        ';font-size:0.8rem;font-weight:700;">continua na próxima imagem (1/2)</div>');
    } else {
      partes.push(montarRodape(opcoes.quantidade, opcoes.totalCentavos));
    }
    return '<div style="width:430px;max-width:430px;min-width:430px;margin:0 auto;padding:18px;box-sizing:border-box;' +
      'background:#fff;color:' + CORES.texto + ';color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;' +
      'font-size:1rem;line-height:1.4;animation:none;">' + partes.join('') + '</div>';
  }

  function prepararAgrupado(cliente, dataHora) {
    const grupos = construirGrupos(cliente.registros);
    const titulos = grupos.flatMap((grupo) => grupo.titulos);
    const totalCentavos = titulos.reduce((soma, titulo) => soma + titulo.saldoCentavos, 0);
    const urgentes = titulos.filter((titulo) => Number(titulo.registro.diasAtrasoReal) >= LIMITE_URGENTE);
    const maiorAtraso = Math.max(...cliente.registros.map((r) => Number(r.diasAtrasoReal)));
    const partes = cliente.registros.length >= LIMITE_DIVIDIR_EM_DUAS
      ? dividirGruposEquilibradamente(grupos)
      : [grupos];
    return partes.map((gruposPagina, indice) => montarPagina({
      grupos: gruposPagina,
      nomeCliente: cliente.nome,
      dataHora,
      quantidade: cliente.registros.length,
      maiorAtraso,
      totalCentavos,
      urgentes,
      pagina: indice + 1,
      duasPaginas: partes.length === 2,
    }));
  }

  function criarSlugs(clientes) {
    const usados = new Map();
    return clientes.map((cliente) => {
      const base = slugSeguro(cliente.nome);
      const repeticoes = (usados.get(base) || 0) + 1;
      usados.set(base, repeticoes);
      return repeticoes === 1 ? base : base + '_' + repeticoes;
    });
  }

  async function copiarImagensNaOrdemDoWinV() {
    const clipboard = window.navigator.clipboard;
    const Item = window.ClipboardItem;
    if (!clipboard || typeof clipboard.write !== 'function' || typeof Item !== 'function') return false;
    try {
      for (const imagem of imagensGeradas.slice().reverse()) {
        if (window.document.visibilityState !== 'hidden' && !window.document.hasFocus() &&
            typeof window.__avisoCobranca?.aguardarFoco === 'function') {
          await window.__avisoCobranca.aguardarFoco(8000);
        }
        await clipboard.write([new Item({ 'image/png': imagem.blob })]);
      }
      return true;
    } catch (erro) {
      console.warn('[Relatórios Agrupados] Não foi possível copiar todas as imagens:', erro?.name || 'erro');
      return false;
    }
  }

  function baixarImagens() {
    if (!imagensGeradas.length) return false;
    imagensGeradas.forEach((imagem) => {
      const url = window.URL.createObjectURL(imagem.blob);
      const link = window.document.createElement('a');
      link.download = imagem.nomeArquivo;
      link.href = url;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    });
    return true;
  }

  function atualizarBotaoBaixar() {
    const botao = window.document.getElementById('aviso-cobranca-baixar-png');
    if (botao) botao.disabled = imagensGeradas.length === 0;
  }

  async function gerar(opcoes) {
    const dados = opcoes?.dados;
    const capturar = opcoes?.capturar;
    const montarLegado = opcoes?.montarLegado;
    if (!Array.isArray(dados?.registros) || !dados.registros.length) {
      throw new Error('Não há títulos elegíveis para gerar o relatório.');
    }
    if (typeof capturar !== 'function' || typeof montarLegado !== 'function') {
      throw new Error('A integração do novo gerador de relatórios não está disponível.');
    }

    imagensGeradas = [];
    atualizarBotaoBaixar();
    const clientes = separarPorCliente(dados.registros);
    const slugs = criarSlugs(clientes);
    const dataHora = dataHoraGeracao();
    const relatorios = [];

    clientes.forEach((cliente, indice) => {
      const dadosCliente = dadosDoCliente(dados, cliente);
      const quantidade = cliente.registros.length;
      if (quantidade < LIMITE_MODELO_AGRUPADO) {
        relatorios.push({
          cliente: cliente.nome,
          quantidade,
          modelo: 'legado',
          paginas: [{
            html: montarLegado(dadosCliente),
            nomeArquivo: 'relatorio_' + slugs[indice] + '.png',
            fallbackNativo: false,
            viewport: false,
          }],
        });
        return;
      }
      const paginas = prepararAgrupado(cliente, dataHora);
      const duasPaginas = paginas.length === 2;
      relatorios.push({
        cliente: cliente.nome,
        quantidade,
        modelo: 'agrupado',
        paginas: paginas.map((html, pagina) => ({
          html,
          nomeArquivo: duasPaginas
            ? 'relatorio_' + slugs[indice] + '_' + (pagina + 1) + 'de2.png'
            : 'relatorio_' + slugs[indice] + '.png',
          fallbackNativo: true,
          viewport: true,
        })),
      });
    });

    try {
      for (const relatorio of relatorios) {
        for (const pagina of relatorio.paginas) {
          const resultado = await capturar(pagina.html, {
            somenteBlob: true,
            fallbackNativo: pagina.fallbackNativo,
            viewport: pagina.viewport,
          });
          if (!resultado?.blob) throw new Error('A captura de uma das imagens não retornou um PNG válido.');
          imagensGeradas.push({
            cliente: relatorio.cliente,
            nomeArquivo: pagina.nomeArquivo,
            blob: resultado.blob,
          });
        }
      }
    } catch (erro) {
      imagensGeradas = [];
      atualizarBotaoBaixar();
      throw erro;
    }

    const copiado = await copiarImagensNaOrdemDoWinV();
    const baixado = copiado ? false : baixarImagens();
    atualizarBotaoBaixar();
    return {
      total: dados.registros.length,
      copiado,
      baixado,
      totalImagens: imagensGeradas.length,
      totalClientes: relatorios.length,
      modelos: relatorios.map((r) => ({
        cliente: r.cliente, quantidade: r.quantidade, modelo: r.modelo, imagens: r.paginas.length,
      })),
    };
  }

  window.__relatorioAgrupado = Object.freeze({
    gerar,
    baixar: baixarImagens,
    recopiar: copiarImagensNaOrdemDoWinV,
    temImagens: () => imagensGeradas.length > 0,
    primeiraImagem: () => imagensGeradas[0]?.blob || null,
    constantes: Object.freeze({
      LIMITE_MODELO_AGRUPADO,
      LIMITE_DIVIDIR_EM_DUAS,
      LIMITE_URGENTE,
      LIMITE_GRUPO_PARA_DIVISAO,
    }),
  });
})();
