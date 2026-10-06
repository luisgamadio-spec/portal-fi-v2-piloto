/* PORTAL-NEXT V2 -- Painel Master / Gestão dos Simuladores view-model
   (Painel Master Phase PM-5D).

   PRESENTATION + FILE-PARSING LOGIC ONLY -- no RPC transport (assets/js/
   adapters/master-gestao-simuladores-provider.js owns that), no DOM.
   Path deliberately NOT under assets/js/adapters/, matching the
   precedent set for master-pendencias-view-model.js and master-
   gestao-bases-view-model.js.

   Every parser below is a faithful, byte-level port of the real,
   already-in-production V1 module (ia-reconciliation-v2-local
   assets/js/master-gestao-simuladores.js) -- same header-anchor
   detection, same multi-block/multi-region parsing (Balão ZeroKM's 3
   stacked blocks, Balão Seminovos' 2 side-by-side blocks, Financiamento
   Seminovos' faixa-de-ano/entrada%/prazo-taxa row-pair scanning,
   Coparticipado's dual "tabela geral" + "matriz por modelo" parser),
   same numeric parsing (gsNum: strips '%', comma-decimal to dot -- NOT
   the same heuristic as Gestão de Bases' BR/US-ambiguity gbAsNumber;
   V1 itself uses a simpler parser here, not shared, preserved as-is),
   same ABSOLUTE FREEZE on business logic -- this file computes nothing
   about financing outputs, it only reshapes a spreadsheet into the
   exact RPC payload shape confirmed live against the real, currently-
   deployed commit RPCs (pg_get_functiondef, read-only, PM-5D Gate 18).

   PERCENT/DECIMAL CONTRACT (Gate 12, confirmed from the real RPC body,
   not inferred): every rate/percentage field (entrada_pct, taxa,
   coeficiente-adjacent rebate/tx_sist) is a DECIMAL FRACTION in
   [0,1] -- confirmed by the real master_simulador_commit_linear
   validation: `entrada_pct < 0 or entrada_pct > 1 or taxa < 0 or
   taxa > 1`. Never ×100/÷100 anywhere in this file. `prazo` is
   validated server-side as `1..120` (NOT restricted to 12/18/24/36/48/
   60 -- do not assume/hardcode that set, Gate 17). */
(function () {
  'use strict';

  // ---------------- utilidades compartilhadas (V1 parity) ----------------
  function gsNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim().replace('%', '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function gsPrazoDeTexto(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Math.round(v);
    var m = String(v).trim().match(/^(\d+)\s*x?/i);
    return m ? Number(m[1]) : null;
  }
  function gsNorm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  }
  function gsAcharLinhaHeader(matrix, colunasEsperadas) {
    var esperadasNorm = colunasEsperadas.map(gsNorm);
    for (var i = 0; i < matrix.length; i++) {
      var linha = (matrix[i] || []).map(gsNorm);
      var todasPresentes = esperadasNorm.every(function (e) { return linha.some(function (c) { return c && c.indexOf(e) !== -1; }); });
      if (todasPresentes) return i;
    }
    return -1;
  }
  function gsErroEstrutura(nomeBase) {
    var e = new Error('O arquivo selecionado não corresponde à estrutura esperada para ' + nomeBase + '.');
    e.gsEstrutura = true;
    return e;
  }
  async function gsSha256Hex(buf) {
    var digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function gsLerWorkbook(file) {
    if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada.');
    var buf = await file.arrayBuffer();
    return { wb: XLSX.read(buf, { type: 'array', cellDates: true }), buf: buf };
  }
  function gsSheetMatrix(wb, sheetName) {
    var ws = wb.Sheets[sheetName || wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  }

  // ---------------- 1. Financiamento Linear (ZeroKM) ----------------
  function parseLinearCoef(matrix) {
    var h = gsAcharLinhaHeader(matrix, ['Prazo', 'Entrada', 'Taxa']);
    if (h < 0) throw gsErroEstrutura('Financiamento Linear');
    var rows = [];
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) continue;
      var prazo = gsPrazoDeTexto(r[0]), entrada = gsNum(r[1]), taxa = gsNum(r[2]);
      if (prazo === null || entrada === null || taxa === null) continue;
      rows.push({ prazo: prazo, entrada_pct: entrada, taxa: taxa });
    }
    if (!rows.length) throw gsErroEstrutura('Financiamento Linear');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 2. Taxas Subsidiadas ----------------
  function parseTaxasSubsidiadas(matrix) {
    var h = gsAcharLinhaHeader(matrix, ['Prazo', 'Taxa', 'Coeficiente', 'Rebate']);
    if (h < 0) throw gsErroEstrutura('Taxas Subsidiadas');
    var rows = [];
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) continue;
      var prazo = gsPrazoDeTexto(r[0]);
      var taxaRaw = r[1];
      var taxa = (typeof taxaRaw === 'string' && /zero/i.test(taxaRaw)) ? 0 : gsNum(taxaRaw);
      var coeficiente = gsNum(r[2]), rebate = gsNum(r[3]);
      if (prazo === null || taxa === null || coeficiente === null || rebate === null) continue;
      rows.push({ prazo: prazo, taxa: taxa, coeficiente: coeficiente, rebate: rebate });
    }
    if (!rows.length) throw gsErroEstrutura('Taxas Subsidiadas');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 3. Taxa Botão (Copiar Taxa Banco) ----------------
  function parseTaxaBotao(matrix) {
    var h = gsAcharLinhaHeader(matrix, ['Prazo', 'Taxa']);
    if (h < 0) throw gsErroEstrutura('Taxa Botão (Copiar Taxa Banco)');
    var rows = [];
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) continue;
      var prazo = gsPrazoDeTexto(r[0]), taxa = gsNum(r[1]);
      if (prazo === null || taxa === null) continue;
      rows.push({ prazo: prazo, taxa_copiar: taxa });
    }
    if (!rows.length) throw gsErroEstrutura('Taxa Botão (Copiar Taxa Banco)');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 4. Simulador Balão ZeroKM (3 blocos empilhados) ----------------
  function parseCoefBalaoZeroKm(matrix) {
    var cols = ['Entrada mínima', 'Prazo', 'Máximo de Balão', 'Taxa de Juros'];
    var colsNorm = cols.map(gsNorm);
    var headers = [];
    for (var i = 0; i < matrix.length; i++) {
      var linha = (matrix[i] || []).map(gsNorm);
      if (colsNorm.every(function (e) { return linha.some(function (c) { return c && c.indexOf(e) !== -1; }); })) headers.push(i);
    }
    if (!headers.length) throw gsErroEstrutura('Simulador Balão ZeroKM');
    var rows = [];
    var mapaRotulo = { 'tradicional': 'TRADICIONAL', 'semestral': 'SEMESTRAL_ANUAL', 'anual': 'SEMESTRAL_ANUAL', 'parcela unica': 'PARCELA_UNICA', 'parcela única': 'PARCELA_UNICA' };
    headers.forEach(function (h, idx) {
      var bloco = null;
      for (var k = Math.max(0, h - 3); k < h; k++) {
        var txt = gsNorm((matrix[k] || []).find(function (c) { return c !== null && c !== undefined; }) || '');
        for (var chave in mapaRotulo) { if (txt.indexOf(chave) !== -1) { bloco = mapaRotulo[chave]; break; } }
        if (bloco) break;
      }
      if (!bloco) bloco = ['TRADICIONAL', 'SEMESTRAL_ANUAL', 'PARCELA_UNICA'][idx] || ('BLOCO_' + (idx + 1));
      var fim = headers[idx + 1] ? headers[idx + 1] - 3 : matrix.length;
      for (var j = h + 1; j < Math.min(fim, matrix.length); j++) {
        var r = matrix[j]; if (!r || r.every(function (c) { return c === null; })) continue;
        var entrada = gsNum(r[0]), prazo = gsPrazoDeTexto(r[1]), max = gsNum(r[2]), taxa = gsNum(r[3]);
        if (entrada === null || prazo === null || max === null || taxa === null) continue;
        var row = { bloco: bloco, entrada_minima: entrada, prazo: prazo, max_balao: max, taxa: taxa };
        if (r[4] !== undefined && gsNum(r[4]) !== null) row.coeficiente = gsNum(r[4]);
        rows.push(row);
      }
    });
    if (!rows.length) throw gsErroEstrutura('Simulador Balão ZeroKM');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 5. Simulador Balão Seminovos (2 blocos lado a lado) ----------------
  function parseCoefBalaoSeminovos(matrix) {
    var cols = ['Entrada mínima', 'Prazo', 'Máximo de Balão', 'Taxa de Juros'];
    var colsNorm = cols.map(gsNorm);
    var headerRow = -1;
    var starts = [];
    for (var i = 0; i < matrix.length && headerRow < 0; i++) {
      var linha = matrix[i] || [];
      for (var c = 0; c < linha.length; c++) {
        if (colsNorm[0] && gsNorm(linha[c]).indexOf(colsNorm[0]) !== -1) {
          var janela = linha.slice(c, c + 4).map(gsNorm);
          if (colsNorm.every(function (e, idx) { return (janela[idx] || '').indexOf(e) !== -1; })) { starts.push(c); }
        }
      }
      if (starts.length) { headerRow = i; }
    }
    if (headerRow < 0 || !starts.length) throw gsErroEstrutura('Simulador Balão Seminovos');
    var rows = [];
    starts.forEach(function (startCol) {
      var faixa = null;
      for (var k = Math.max(0, headerRow - 2); k < headerRow; k++) {
        var txt = String((matrix[k] || [])[startCol] || '').trim();
        var m = txt.match(/(\d{4}).*?(\d{4})/);
        if (m) { faixa = m[1] + '_' + m[2]; break; }
      }
      if (!faixa) faixa = 'FAIXA_DESCONHECIDA';
      for (var j = headerRow + 1; j < matrix.length; j++) {
        var r = matrix[j] || [];
        var entrada = gsNum(r[startCol]), prazo = gsPrazoDeTexto(r[startCol + 1]), max = gsNum(r[startCol + 2]), taxa = gsNum(r[startCol + 3]);
        if (entrada === null || prazo === null || max === null || taxa === null) continue;
        rows.push({ bloco: faixa, entrada_minima: entrada, prazo: prazo, max_balao: max, taxa: taxa });
      }
    });
    if (!rows.length) throw gsErroEstrutura('Simulador Balão Seminovos');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 6. Antecipação (compartilhada) ----------------
  function parseAntecipacao(matrix) {
    var h = gsAcharLinhaHeader(matrix, ['Parcela', 'Desconto']);
    if (h < 0) throw gsErroEstrutura('Antecipação');
    var rows = [];
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) continue;
      var meses = gsPrazoDeTexto(r[0]), desconto = gsNum(r[1]);
      if (meses === null || desconto === null) continue;
      rows.push({ meses_antecipacao: meses, desconto: desconto });
    }
    if (!rows.length) throw gsErroEstrutura('Antecipação');
    return { rows: rows, avisos: [] };
  }

  // ---------------- 7. Financiamento Seminovos ----------------
  function parseCoefSeminovo(matrix) {
    var avisos = [];
    for (var ri = 0; ri < matrix.length; ri++) {
      var r0 = matrix[ri];
      if (r0 && r0.some(function (c) { return gsNorm(c).indexOf('valor de venda') !== -1; })) {
        avisos.push('Linha "Valor de Venda" ignorada — é apenas exemplo usado para exibir a parcela calculada, não é parâmetro de negócio.');
        break;
      }
    }
    var faixaRow = -1, entradaRow = -1;
    for (var i = 0; i < matrix.length; i++) {
      var linha = matrix[i] || [];
      var qtdFaixas = linha.filter(function (c) { return /\d{4}.*\d{4}/.test(String(c || '')); }).length;
      if (qtdFaixas >= 2) { faixaRow = i; entradaRow = i + 1; break; }
    }
    if (faixaRow < 0) throw gsErroEstrutura('Financiamento Seminovos');
    var linhaFaixa = matrix[faixaRow] || [], linhaEntrada = matrix[entradaRow] || [];
    var colunas = [];
    var faixaAtual = null;
    for (var c = 0; c < Math.max(linhaFaixa.length, linhaEntrada.length); c++) {
      var txtFaixa = String(linhaFaixa[c] || '').trim();
      var m = txtFaixa.match(/(\d{4}).*?(\d{4})/);
      if (m) faixaAtual = m[1] + '-' + m[2];
      var txtEntrada = String(linhaEntrada[c] || '').trim();
      var me = txtEntrada.match(/(\d+)\s*%/);
      if (me && faixaAtual) colunas.push({ col: c, faixa: faixaAtual, entrada_pct: Number(me[1]) / 100 });
    }
    if (!colunas.length) throw gsErroEstrutura('Financiamento Seminovos');
    var rows = [];
    for (var i2 = entradaRow + 1; i2 < matrix.length - 1; i2++) {
      var rotulo1 = gsNorm((matrix[i2] || [])[0]);
      if (rotulo1.indexOf('prazo') === -1) continue;
      var rotulo2 = gsNorm((matrix[i2 + 1] || [])[0]);
      if (rotulo2.indexOf('taxa') === -1) continue;
      var linhaTaxa = matrix[i2 + 1] || [];
      colunas.forEach(function (col) {
        var prazoTxt = String((matrix[i2] || [])[col.col + 1] || '');
        var mprazo = prazoTxt.match(/^(\d+)\s*x/i);
        var prazo = mprazo ? Number(mprazo[1]) : null;
        var taxa = gsNum(linhaTaxa[col.col + 1]);
        if (prazo === null || taxa === null) return;
        rows.push({ faixa_ano: col.faixa, entrada_pct: col.entrada_pct, prazo: prazo, taxa: taxa });
      });
    }
    if (!rows.length) throw gsErroEstrutura('Financiamento Seminovos');
    return { rows: rows, avisos: avisos };
  }

  // ---------------- 8/9. Coparticipado (Plano Coparticipado / Semestral Triton-Outlander) ----------------
  function parseTabelaCoparticipadoGenerico(matrix, nomeBase) {
    var avisos = [];

    var hGeral = gsAcharLinhaHeader(matrix, ['Prazo', 'Taxa', 'Rebate', 'Entrada']);
    var geral = [];
    if (hGeral >= 0) {
      for (var i = hGeral + 1; i < matrix.length; i++) {
        var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) break;
        var prazo = gsPrazoDeTexto(r[0]);
        var taxaRaw = r[1];
        var taxa = (typeof taxaRaw === 'string' && /zero/i.test(taxaRaw)) ? 0 : gsNum(taxaRaw);
        var rebate = gsNum(r[2]), txSist = gsNum(r[3]), entradaMin = gsNum(r[4]), coef = gsNum(r[5]);
        if (prazo === null || taxa === null) continue;
        geral.push({ prazo: prazo, taxa: taxa, rebate: rebate === null ? 0 : rebate, tx_sist: txSist, entrada_minima: entradaMin, coeficiente: coef });
      }
    }

    var hModelo = gsAcharLinhaHeader(matrix, ['Modelo', 'Entrada', 'Rebate']);
    if (hModelo < 0) throw gsErroEstrutura(nomeBase);
    var headerModelo = matrix[hModelo] || [];
    var colModelo = -1, colEntrada = -1, colRebateTotal = -1, colHpe = -1, colBrabus = -1;
    var prazoCols = [];
    headerModelo.forEach(function (c, idx) {
      var t = gsNorm(c);
      if (t.indexOf('modelo') !== -1) colModelo = idx;
      else if (t.indexOf('entrada') !== -1) colEntrada = idx;
      else if (t.indexOf('rebate') !== -1 && t.indexOf('total') !== -1) colRebateTotal = idx;
      else if (t.indexOf('hpe') !== -1) colHpe = idx;
      else if (t.indexOf('brabus') !== -1) colBrabus = idx;
      else { var m = String(c || '').match(/^(\d+)\s*x/i); if (m) prazoCols.push({ col: idx, prazo: Number(m[1]) }); }
    });
    if (colModelo < 0 || colEntrada < 0 || colRebateTotal < 0 || colHpe < 0 || colBrabus < 0 || !prazoCols.length) throw gsErroEstrutura(nomeBase);

    var rows = [];
    for (var i2 = hModelo + 1; i2 < matrix.length; i2++) {
      var r2 = matrix[i2]; if (!r2 || r2.every(function (c) { return c === null; })) continue;
      var modelo = String(r2[colModelo] || '').trim();
      if (!modelo) continue;
      var entradaMin2 = gsNum(r2[colEntrada]), rebateTotal = gsNum(r2[colRebateTotal]), hpe = gsNum(r2[colHpe]), brabus = gsNum(r2[colBrabus]);
      if (entradaMin2 === null || rebateTotal === null || hpe === null || brabus === null) continue;
      prazoCols.forEach(function (pc) {
        var taxa = gsNum(r2[pc.col]);
        if (taxa === null) return;
        rows.push({ modelo: modelo, entrada_minima: entradaMin2, rebate_total: rebateTotal, rebate_hpe: hpe, rebate_brabus: brabus, prazo: pc.prazo, taxa: taxa });
      });
    }
    if (!rows.length) throw gsErroEstrutura(nomeBase);

    if (geral.length) avisos.push('Tabela geral (Prazo/Taxa/Rebate/Tx Sist/Entrada Mínima/Coef) encontrada — DADOS AUXILIARES / NÃO CONSUMIDOS pelo simulador atual. Preservada só para auditoria.');

    var residuo = false;
    if (hGeral >= 0) {
      for (var i3 = hGeral + 1; i3 < hModelo; i3++) {
        var r3 = matrix[i3] || [];
        for (var c3 = 6; c3 < r3.length; c3++) {
          if (gsNum(r3[c3]) !== null && c3 !== colModelo) { residuo = true; }
        }
      }
    }
    if (residuo) avisos.push('Valores fora das áreas de tabela reconhecidas foram ignorados.');

    return { rows: rows, geral: geral, avisos: avisos };
  }
  function parseTaxaCoparticipado(matrix) { return parseTabelaCoparticipadoGenerico(matrix, 'Plano Coparticipado'); }
  function parseCoparticipadoSemestral(matrix) { return parseTabelaCoparticipadoGenerico(matrix, 'Semestral Triton/Outlander'); }

  // ---------------- 10. Matriz de Coeficientes — Coparticipado ----------------
  function parseCoefCoparticipado(matrix) {
    var h = gsAcharLinhaHeader(matrix, ['Prazo', 'Taxa', 'Coeficiente']);
    if (h < 0) throw gsErroEstrutura('Matriz de Coeficientes — Coparticipado');
    var rows = [];
    var chaves = {};
    for (var i = h + 1; i < matrix.length; i++) {
      var r = matrix[i]; if (!r || r.every(function (c) { return c === null; })) continue;
      var prazo = gsPrazoDeTexto(r[0]);
      var taxaRaw = r[1];
      var taxa = (typeof taxaRaw === 'string' && /zero/i.test(taxaRaw)) ? 0 : gsNum(taxaRaw);
      var coeficiente = gsNum(r[2]);
      if (prazo === null || prazo <= 0 || taxa === null || coeficiente === null || coeficiente <= 0) continue;
      var chave = prazo + '|' + taxa;
      if (chaves[chave]) throw new Error('Duplicidade de chave lógica (prazo+taxa) encontrada: ' + prazo + 'x / ' + taxa);
      chaves[chave] = true;
      rows.push({ prazo: prazo, taxa: taxa, coeficiente: coeficiente });
    }
    if (!rows.length) throw gsErroEstrutura('Matriz de Coeficientes — Coparticipado');
    return { rows: rows, avisos: [] };
  }

  var PARSERS = {
    parseLinearCoef: parseLinearCoef,
    parseTaxasSubsidiadas: parseTaxasSubsidiadas,
    parseTaxaBotao: parseTaxaBotao,
    parseCoefBalaoZeroKm: parseCoefBalaoZeroKm,
    parseCoefBalaoSeminovos: parseCoefBalaoSeminovos,
    parseAntecipacao: parseAntecipacao,
    parseCoefSeminovo: parseCoefSeminovo,
    parseTaxaCoparticipado: parseTaxaCoparticipado,
    parseCoparticipadoSemestral: parseCoparticipadoSemestral,
    parseCoefCoparticipado: parseCoefCoparticipado
  };

  // ---------------- catálogo das 10 vitrines (9 tipos de base; Antecipação
  // é compartilhada e aparece nos dois grupos) -- verbatim from V1's own
  // GS_BASE_DEFS, including each family's exact montarArgs shape. ----------------
  var GS_BASE_DEFS = [
    { uid: 'ZK_COPARTICIPADO', tipoBase: 'COPARTICIPADO', grupo: 'ZEROKM', label: 'Plano Coparticipado',
      parser: 'parseTaxaCoparticipado', rpc: 'master_simulador_commit_coparticipado',
      montarArgs: function (r) { return { p_linhas_modelo: r.rows, p_linhas_geral: r.geral || [], p_linhas_coeficiente: [], p_avisos: r.avisos || [] }; },
      nota: 'Matriz por modelo atualizada por taxa coparticipado.xlsx. O simulador consome a base ACTIVE. Antes de ativar uma nova matriz, o sistema confere automaticamente se a Matriz de Coeficientes Coparticipado (base separada, abaixo) cobre todas as taxas — se faltar coeficiente, a ativação é bloqueada.' },
    { uid: 'ZK_COEFICIENTES_COPARTICIPADO', tipoBase: 'COEFICIENTES_COPARTICIPADO', grupo: 'ZEROKM', label: 'Matriz de Coeficientes — Coparticipado',
      parser: 'parseCoefCoparticipado', rpc: 'master_simulador_commit_coeficientes_coparticipado',
      montarArgs: function (r) { return { p_linhas: r.rows }; },
      nota: 'Coeficientes financeiros por prazo e taxa utilizados pelo Plano Coparticipado. Antes de ativar, o sistema confere se a matriz de modelos ACTIVE do Plano Coparticipado continua totalmente coberta — se alguma combinação prazo/taxa ainda necessária for removida, a ativação é bloqueada.' },
    { uid: 'ZK_LINEAR', tipoBase: 'LINEAR_ZEROKM', grupo: 'ZEROKM', label: 'Financiamento Linear',
      parser: 'parseLinearCoef', rpc: 'master_simulador_commit_linear', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'ZK_SUBSIDIADAS', tipoBase: 'TAXAS_SUBSIDIADAS', grupo: 'ZEROKM', label: 'Taxas Subsidiadas',
      parser: 'parseTaxasSubsidiadas', rpc: 'master_simulador_commit_taxas_subsidiadas', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'ZK_TAXABOTAO', tipoBase: 'TAXA_BOTAO', grupo: 'ZEROKM', label: 'Copiar Taxa Banco (Taxa Botão)',
      parser: 'parseTaxaBotao', rpc: 'master_simulador_commit_taxa_botao', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'ZK_BALAO', tipoBase: 'BALAO_ZEROKM', grupo: 'ZEROKM', label: 'Simulador Balão',
      parser: 'parseCoefBalaoZeroKm', rpc: 'master_simulador_commit_balao_zerokm', montarArgs: function (r) { return { p_linhas: r.rows }; },
      parcial: 'Atualiza: Tradicional e Semestral/Anual. Parcela Única permanece na configuração atual (o arquivo não traz o coeficiente que esse plano usa).' },
    { uid: 'ZK_SEMESTRAL', tipoBase: 'SEMESTRAL_TRITON_OUTLANDER', grupo: 'ZEROKM', label: 'Semestral Triton & Outlander',
      parser: 'parseCoparticipadoSemestral', rpc: 'master_simulador_commit_semestral_triton_outlander',
      montarArgs: function (r) { return { p_linhas_modelo: r.rows, p_linhas_geral: r.geral || [], p_avisos: r.avisos || [] }; } },
    { uid: 'ZK_ANTECIPACAO', tipoBase: 'ANTECIPACAO', grupo: 'ZEROKM', label: 'Simulador de Antecipação', compartilhada: true,
      parser: 'parseAntecipacao', rpc: 'master_simulador_commit_antecipacao', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'SN_FINANCIAMENTO', tipoBase: 'FINANCIAMENTO_SEMINOVO', grupo: 'SEMINOVOS', label: 'Financiamento Seminovos',
      parser: 'parseCoefSeminovo', rpc: 'master_simulador_commit_financiamento_seminovo', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'SN_BALAO', tipoBase: 'BALAO_SEMINOVOS', grupo: 'SEMINOVOS', label: 'Simulador Balão',
      parser: 'parseCoefBalaoSeminovos', rpc: 'master_simulador_commit_balao_seminovos', montarArgs: function (r) { return { p_linhas: r.rows }; } },
    { uid: 'SN_ANTECIPACAO', tipoBase: 'ANTECIPACAO', grupo: 'SEMINOVOS', label: 'Simulador de Antecipação', compartilhada: true,
      parser: 'parseAntecipacao', rpc: 'master_simulador_commit_antecipacao', montarArgs: function (r) { return { p_linhas: r.rows }; } }
  ];
  var GS_HEADER_ANCHOR_HINT = {
    ZK_COPARTICIPADO: 'Modelo', ZK_COEFICIENTES_COPARTICIPADO: 'Prazo', ZK_LINEAR: 'Prazo', ZK_SUBSIDIADAS: 'Prazo',
    ZK_TAXABOTAO: 'Prazo', ZK_BALAO: 'Entrada mínima', ZK_SEMESTRAL: 'Modelo', ZK_ANTECIPACAO: 'Parcela',
    SN_FINANCIAMENTO: 'Prazo', SN_BALAO: 'Entrada mínima', SN_ANTECIPACAO: 'Parcela'
  };

  function parseFile(defUid, matrix) {
    var def = GS_BASE_DEFS.filter(function (d) { return d.uid === defUid; })[0];
    if (!def) throw new Error('Base de simulador desconhecida.');
    var parsed = PARSERS[def.parser](matrix);
    return { def: def, parsed: parsed };
  }

  // ---------------- formatação ----------------
  function gsFmtDateTime(v) { if (!v) return '-'; try { return new Date(v).toLocaleString('pt-BR'); } catch (e) { return '-'; } }
  function gsFmtNum(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function gsFmtValor(v) {
    if (v === null || v === undefined) return '-';
    if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
    return String(v);
  }

  window.NX_MASTER_GESTAO_SIMULADORES_VM = {
    GS_BASE_DEFS: GS_BASE_DEFS,
    GS_HEADER_ANCHOR_HINT: GS_HEADER_ANCHOR_HINT,
    gsNum: gsNum,
    gsPrazoDeTexto: gsPrazoDeTexto,
    gsSha256Hex: gsSha256Hex,
    gsLerWorkbook: gsLerWorkbook,
    gsSheetMatrix: gsSheetMatrix,
    parseFile: parseFile,
    gsFmtDateTime: gsFmtDateTime,
    gsFmtNum: gsFmtNum,
    gsFmtValor: gsFmtValor
  };
})();
