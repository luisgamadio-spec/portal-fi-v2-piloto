/* PORTAL-NEXT V2 -- Painel Master / Gestão de Bases view-model (Painel
   Master Phase PM-5C).

   PRESENTATION + FILE-PARSING LOGIC ONLY -- no RPC transport (assets/js/
   adapters/master-gestao-bases-provider.js owns that), no DOM. Path
   deliberately NOT under assets/js/adapters/, matching the precedent
   already set for master-pendencias-view-model.js (Painel Master
   Phase PM-4C.2, Gates 10/72).

   Every function below is a faithful, byte-level port of the real,
   already-in-production V1 module (ia-reconciliation-v2-local
   assets/js/master-gestao-bases.js, confirmed identical between the
   canonical historical reference commit and origin/main -- not stale)
   -- same column-name anchors, same classification priorities, same
   numeric/date parsing heuristics (including the documented BR/US
   decimal-ambiguity fix and the raw-cell-value read strategy that
   avoids it), same forward-fill/row-taxonomy rules for Base 03, same
   "most recent VALIDATED batch per source" official-batch selection.
   07/10/2026: the original port predated v1's T35918/M4 change (client
   document on Base 01, one document-keyed row per PAGA/FATURADA
   operation on Base 03); now ported, plus import guards that v1 lacks
   (gbBase01DocumentGuard / gbBase03EnrichmentGuard).
   Nothing here re-derives a rule the real backend RPCs already own
   (chassis/CPF/NBS identity resolution, alert classification, is_
   master() authority) -- this file only builds the exact request
   payload shape those RPCs expect (confirmed via pg_get_functiondef,
   read-only, against the real production functions, PM-5C Gate 13). */
(function () {
  'use strict';

  var SOURCE_LABELS = {
    SALES_CURRENT: 'BASE 01 — Vendas',
    FINANCE_CURRENT: 'BASE 02 — Financiamentos',
    SPF_CURRENT: 'BASE 03 — Complementar / F&I',
    COLABORADORES: 'Colaboradores / Vendedores (legado, opcional)'
  };
  var SOURCE_ORDER = ['SALES_CURRENT', 'FINANCE_CURRENT', 'SPF_CURRENT', 'COLABORADORES'];
  var HEADER_ANCHORS = {
    SALES_CURRENT: 'Chassi',
    FINANCE_CURRENT: 'Descrição Serviço',
    SPF_CURRENT: 'Op - Código',
    COLABORADORES: 'NBS'
  };
  var CHUNK_SIZE = 500;

  // ---------------- utilitários ----------------
  function gbNormalize(v) {
    return (v === null || v === undefined ? '' : v).toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }
  // Heurística BR/US (16.499,40 vs 16,499.40): entre "," e ".", o separador
  // que aparece por ÚLTIMO é o decimal -- só entra em ação para valores já
  // recebidos como texto (células numéricas reais do Excel chegam como
  // Number puro via gbReadSheet's raw:true e retornam no fast-path acima).
  function gbAsNumber(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).trim().replace('R$', '').trim();
    if (!s) return 0;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = s.replace(',', '.');
    }
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function gbOnlyDigits(v) { return (v === null || v === undefined ? '' : v).toString().replace(/\D/g, ''); }
  // Incidente T35918/M4 (porte do v1 em produção, 07/10/2026) --
  // normalização do documento (CPF/CNPJ) do CLIENTE para a ponte de
  // identidade Base 01 <-> Base 03. 9/10 dígitos = CPF que perdeu zeros à
  // esquerda por coerção numérica do Excel; 12/13 = o mesmo para CNPJ.
  // Reparo controlado, nunca um pad genérico: outros comprimentos ficam
  // INVALID. A chave de casamento (HMAC) só é calculada no servidor.
  function gbNormalizeDocumentForMatch(v) {
    var s = (v === null || v === undefined ? '' : v).toString().trim();
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    var digits = gbOnlyDigits(s);
    if (!digits) return { normalized: null, shape: 'BLANK' };
    if (digits.length === 11) return { normalized: digits, shape: 'VALID_CPF_SHAPE' };
    if (digits.length === 14) return { normalized: digits, shape: 'VALID_CNPJ_SHAPE' };
    if (digits.length === 9 || digits.length === 10) return { normalized: digits.padStart(11, '0'), shape: 'REPAIRED_CPF_SHAPE' };
    if (digits.length === 12 || digits.length === 13) return { normalized: digits.padStart(14, '0'), shape: 'REPAIRED_CNPJ_SHAPE' };
    return { normalized: null, shape: 'INVALID_OTHER' };
  }
  function gbCleanChassis(v) { return (v === null || v === undefined ? '' : v).toString().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function gbParseDateBR(v) {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  // Extensão exclusiva para campos declaradamente de data que chegam como
  // serial numérico do Excel (célula formatada como "General", não como
  // data -- cellDates:true do SheetJS não converte esse caso). NÃO usar
  // para valores monetários (ver gbAsNumber).
  function gbParseExcelDate(v, date1904) {
    var iso = gbParseDateBR(v);
    if (iso) return iso;
    if (typeof v === 'number' && isFinite(v) && v > 0) {
      var epochMs = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
      var d = new Date(epochMs + Math.floor(v) * 86400000);
      if (!isNaN(d.getTime())) {
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
    }
    return null;
  }
  function gbChunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += (size || CHUNK_SIZE)) out.push(arr.slice(i, i + (size || CHUNK_SIZE)));
    return out;
  }
  // Comparação de nome de coluna tolerante a espaços duplos/acentos/caixa.
  function gbGetCol(row, names) {
    for (var i = 0; i < names.length; i++) {
      var wn = gbNormalize(names[i]);
      var keys = Object.keys(row);
      for (var j = 0; j < keys.length; j++) {
        if (gbNormalize(keys[j]) === wn) {
          var v = row[keys[j]];
          if (v !== undefined && v !== null && v !== '') return v;
        }
      }
    }
    return '';
  }

  async function gbSha256Hex(arrayBuffer) {
    var digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Lê a primeira planilha do arquivo, localizando o cabeçalho pela âncora
  // de coluna esperada para o tipo de base (HEADER_ANCHORS). raw:true lê o
  // valor NATIVO da célula (Number puro / Date), evitando reconstituir um
  // número a partir de texto formatado de exibição (a mesma ambiguidade
  // que corrompeu return_value em produção antes desta leitura nativa).
  async function gbReadSheet(file, headerAnchor) {
    if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada.');
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: 'array', cellDates: true });
    var date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    if (!wb.SheetNames.length) throw new Error('Planilha vazia ou ilegível.');
    var ws = wb.Sheets[wb.SheetNames[0]];
    var matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    var needle = gbNormalize(headerAnchor);
    var headerIdx = matrix.findIndex(function (r) { return Array.isArray(r) && r.some(function (c) { return gbNormalize(c).includes(needle); }); });
    if (headerIdx < 0) headerIdx = 0;
    var headerRow = matrix[headerIdx] || [];
    var headers = headerRow.map(function (h) { return (h === null || h === undefined ? '' : h).toString().trim(); });
    if (!headers.some(Boolean)) throw new Error('Não foi possível localizar o cabeçalho da planilha.');
    var rows = matrix.slice(headerIdx + 1)
      .filter(function (r) { return Array.isArray(r) && r.some(function (c) { return c !== ''; }); })
      .map(function (r) {
        var o = {};
        headers.forEach(function (h, i) { if (h) o[h] = r[i] === undefined ? '' : r[i]; });
        return o;
      });
    return { rows: rows, buf: buf, date1904: date1904 };
  }

  // ---------------- mapeamento BASE 01 (Vendas) ----------------
  // Tipo='Usado' -> SEMINOVOS; qualquer outro valor -> NOVOS.
  function gbBuildBase01Row(raw, rowNumber, sellersByNbs) {
    var tipo = gbNormalize(gbGetCol(raw, ['Tipo']));
    var department = tipo === 'USADO' ? 'SEMINOVOS' : 'NOVOS';
    var chassis = gbCleanChassis(gbGetCol(raw, ['Chassi Completo', 'Chassi']));
    var nbs = gbNormalize(gbGetCol(raw, ['Vendedor']));
    var seller = sellersByNbs[nbs] || null;
    var saleDate = gbParseDateBR(gbGetCol(raw, ['Data venda', 'Data Venda']));
    return {
      source_row_number: rowNumber,
      sale_date: saleDate,
      chassis: chassis,
      chassis_short: chassis.slice(-6),
      seller_cpf: gbOnlyDigits(gbGetCol(raw, ['CPF do Vendedor'])),
      seller_source_name: String(gbGetCol(raw, ['Nome Vendedor Completo'])).trim(),
      seller_nbs: nbs,
      // Vendedor resolvido: loja vem do cadastro (portal_sellers via NBS),
      // não do texto bruto "Empresa Vendedora" (diverge do cadastro em
      // amostragem real). Vendedor não resolvido: preserva o texto do
      // arquivo (mesma decisão de escopo do V1).
      store: seller ? gbNormalize(seller.store) : gbNormalize(gbGetCol(raw, ['Empresa Vendedora'])),
      sale_value: gbAsNumber(gbGetCol(raw, ['Valor Venda'])),
      department: department,
      source_kind: 'CURRENT',
      source_transaction: null,
      vehicle_model: String(gbGetCol(raw, ['Modelo'])).trim() || null,
      // Incidente T35918/M4 -- documento do CLIENTE (nunca do vendedor).
      // Na Base 01 a coluna real é "Cód. Cliente" (contém o CPF/CNPJ). O
      // servidor (master_operational_import_sales) só usa este campo para
      // calcular a chave de casamento com a Base 03; não o grava como está.
      client_document_normalized: gbNormalizeDocumentForMatch(gbGetCol(raw, ['Cód. Cliente'])).normalized,
      _diagOk: !!(chassis && saleDate && (department === 'NOVOS' || department === 'SEMINOVOS'))
    };
  }

  // ---------------- mapeamento BASE 02 (Financiamentos) ----------------
  // "store"/"seller_cpf" não existem como coluna direta -- vêm do cadastro
  // do vendedor (portal_sellers) via NBS ("Vendedor").
  function gbBase02Classify(descRaw) {
    var desc = gbNormalize(descRaw);
    return {
      is_real_financing: desc === 'POR PLANO-FINANCIAMENTO' || desc === 'FINANCIAMENTO',
      is_later_return: desc.indexOf('LANCAMENTO RETORNO POSTERIOR') !== -1,
      is_spf: desc.indexOf('SPF EXTRA') !== -1
    };
  }
  function gbBuildBase02Row(raw, rowNumber, sellersByNbs) {
    var nbs = gbNormalize(gbGetCol(raw, ['Vendedor']));
    var seller = sellersByNbs[nbs] || null;
    var descRaw = gbGetCol(raw, ['Descrição Serviço', 'Descricao Servico']);
    var cls = gbBase02Classify(descRaw);
    var chassis = gbCleanChassis(gbGetCol(raw, ['Chassi Completo']));
    var clientKey = gbNormalize(gbGetCol(raw, ['Cliente']));
    var operationDate = gbParseDateBR(gbGetCol(raw, ['Data Venda']));
    return {
      source_row_number: rowNumber,
      operation_date: operationDate,
      chassis: chassis,
      chassis_short: chassis.slice(-6),
      seller_cpf: seller ? seller.cpf_normalizado : '',
      seller_source_name: String(gbGetCol(raw, ['Nome completo vendedor'])).trim(),
      seller_nbs: nbs,
      store: seller ? gbNormalize(seller.store) : '',
      service_description: String(descRaw || '').trim(),
      is_real_financing: cls.is_real_financing,
      is_later_return: cls.is_later_return,
      is_spf: cls.is_spf,
      return_value: gbAsNumber(gbGetCol(raw, ['Retorno Liquido', 'Retorno  Liquido', 'Retorno Bruto', 'Retorno'])),
      financed_or_service_value: gbAsNumber(gbGetCol(raw, ['Valor Serviço', 'Valor Servico'])),
      client_match_key: clientKey,
      source_kind: 'CURRENT',
      finance_code: String(gbGetCol(raw, ['Plano'])).trim() || null,
      _diagOk: !!(operationDate && (chassis || cls.is_later_return))
    };
  }

  // ---------------- mapeamento COLABORADORES (Vendedores) ----------------
  function gbBuildColaboradorRow(raw) {
    var name = String(gbGetCol(raw, ['Nome'])).trim();
    var status = String(gbGetCol(raw, ['STATUS', 'Status'])).trim().toUpperCase().replace(/\s*\/\s*/g, '/');
    return {
      cpf: gbOnlyDigits(gbGetCol(raw, ['CPF'])),
      nbs: gbNormalize(gbGetCol(raw, ['NBS'])),
      name: name,
      normalized_name: gbNormalize(name),
      store: gbNormalize(gbGetCol(raw, ['Loja'])),
      profile_type: gbNormalize(gbGetCol(raw, ['TIPO', 'Tipo'])),
      status: status
    };
  }

  // ---------------- mapeamento BASE 03 (Complementar / F&I) ----------------
  // A prioridade de classificação de plano (SUBSIDIADO > REVERSÃO >
  // COPARTICIPADO > BALÃO > LINEAR) é decidida só no banco
  // (operational_metrics); o navegador não escolhe operação por plano.
  function gbContainsSpfExtra(nomeOpcional) {
    return gbNormalize(nomeOpcional).indexOf('SPF EXTRA') !== -1;
  }
  // Linha operacional (principal OU SPF Extra) pronta para portal_spf_
  // operations. Forward-fill (quando aplicável) é feito pelo chamador.
  function gbBuildBase03OperationalRow(raw, rowNumber, isSpfExtra, date1904) {
    return {
      source_row_number: rowNumber,
      operation_date: gbParseExcelDate(gbGetCol(raw, ['Op - Data Inclusão', 'Op - Data Contrato']), date1904),
      client_match_key: gbNormalize(gbGetCol(raw, ['Cli - Nome'])),
      store: gbNormalize(gbGetCol(raw, ['Inst - Ponto de Venda'])),
      department: gbNormalize(gbGetCol(raw, ['Inst - Departamento'])),
      modality: gbNormalize(gbGetCol(raw, ['Op - Modalidade'])),
      operation_code: String(gbGetCol(raw, ['Op - Código'])).trim(),
      status: gbNormalize(gbGetCol(raw, ['Op - Situação'])),
      bank: gbNormalize(gbGetCol(raw, ['Op Fin - Banco'])),
      financed_value: gbAsNumber(gbGetCol(raw, ['Op Fin - Financiado (R$)'])),
      optional_name: String(gbGetCol(raw, ['Opcional - Nome'])).trim(),
      optional_value: gbAsNumber(gbGetCol(raw, ['Opcional - Valor (R$)'])),
      is_spf_extra: !!isSpfExtra,
      installments: gbAsNumber(gbGetCol(raw, ['Op Fin - Quantidade Parcelas'])) || null,
      installment_value: gbAsNumber(gbGetCol(raw, ['Op Fin - PMT (R$)'])) || null,
      balloon_payment: null,
      balloon_value: gbAsNumber(gbGetCol(raw, ['Op Fin - Balão PMT (R$)'])) || null,
      finance_code: String(gbGetCol(raw, ['Tabela - Código IF'])).trim() || null,
      tc_returned: String(gbGetCol(raw, ['Tabela - TC Devolvida (R$)'])).trim() || null
    };
  }
  // Incidente T35918/M4 (porte do v1 em produção, 07/10/2026) -- uma linha
  // por operação PAGA/FATURADA candidata, com o documento do cliente
  // normalizado (nunca o nome, nunca a chave HMAC). master_operational_
  // apply_base03 casa por documento com a Base 01, reforça o filtro PAGA/
  // FATURADA e só enriquece quando há EXATAMENTE UMA operação elegível
  // por documento (contrato confirmado via pg_get_functiondef, 07/10).
  // O formato antigo (agregado por nome do cliente) é ignorado pelo
  // servidor: foi o que zerou o enriquecimento em 07/10/2026.
  function gbBuildBase03FinanceRows(base03Rows) {
    var REALIZED = { PAGA: true, FATURADA: true };
    var rows = [];
    base03Rows.forEach(function (raw) {
      var status = gbNormalize(gbGetCol(raw, ['Op - Situação']));
      if (!REALIZED[status]) return; // banda -- o servidor reforça o mesmo filtro
      var opCode = String(gbGetCol(raw, ['Op - Código'])).trim();
      if (!opCode) return;
      var doc = gbNormalizeDocumentForMatch(gbGetCol(raw, ['Cli - CPF/CNPJ']));
      if (!doc.normalized) return; // sem documento utilizável, não há como casar com a Base 01
      var codigoIFRaw = gbGetCol(raw, ['Tabela - Código IF']);
      var tcDevolvidaRaw = gbGetCol(raw, ['Tabela - TC Devolvida (R$)']);
      var balaoRaw = gbGetCol(raw, ['Op Fin - Balão PMT (R$)']);
      rows.push({
        client_document_normalized: doc.normalized,
        op_code: opCode,
        status: status,
        plan_codigo_if: codigoIFRaw !== '' && codigoIFRaw != null ? String(codigoIFRaw).trim() : null,
        tc_devolvida: tcDevolvidaRaw !== '' && tcDevolvidaRaw != null ? gbAsNumber(tcDevolvidaRaw) : null,
        balloon_value: balaoRaw !== '' && balaoRaw != null ? gbAsNumber(balaoRaw) : null,
        installments: gbAsNumber(gbGetCol(raw, ['Op Fin - Quantidade Parcelas'])) || null,
        installment_value: gbAsNumber(gbGetCol(raw, ['Op Fin - PMT (R$)'])) || null,
        vehicle_model: ''
      });
    });
    return rows;
  }

  // ---------------- travas de importação (incidente 07/10/2026) ----------------
  // Em 07/10/2026 a Base 03 foi gravada enriquecendo 0 linhas financeiras
  // (normal: ~1.500) sem nenhum aviso. Estas funções decidem, ANTES de
  // gravar, se a importação deve parar. Puras: só números e textos.
  var GB_MIN_DOC_COVERAGE = 0.5;    // Base 01: fração mínima de linhas com documento do cliente
  var GB_MIN_ENRICH_RATIO = 0.5;    // Base 03: fração mínima do último enriquecimento normal
  // "N linhas financeiras enriquecidas" da mensagem gravada pelo servidor em cada lote SPF_CURRENT.
  function gbParseEnrichedCount(validationMessage) {
    var m = String(validationMessage || '').match(/(\d+)\s+linhas financeiras enriquecidas/);
    return m ? Number(m[1]) : null;
  }
  // Último enriquecimento NORMAL (> 0) entre os lotes Base 03 validados -- um
  // lote que já veio zerado nunca vira a referência.
  function gbLastNormalEnrichment(batches) {
    var spf = (batches || []).filter(function (b) { return b.source_type === 'SPF_CURRENT' && b.status === 'VALIDATED'; })
      .sort(function (a, b) { return new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at); });
    for (var i = 0; i < spf.length; i++) {
      var n = gbParseEnrichedCount(spf[i].validation_message);
      if (n !== null && n > 0) return n;
    }
    return null;
  }
  function gbBase01DocumentGuard(rows) {
    var total = (rows || []).length;
    var comDoc = (rows || []).filter(function (r) { return !!r.client_document_normalized; }).length;
    var block = total > 0 && comDoc / total < GB_MIN_DOC_COVERAGE;
    return {
      block: block, total: total, comDocumento: comDoc,
      motivo: block
        ? 'Só ' + gbFmtNum(comDoc) + ' de ' + gbFmtNum(total) + ' linha(s) trazem o CPF/CNPJ do cliente (coluna "Cód. Cliente"). Sem ele, a Base 03 não consegue completar parcelas, balão e plano dos financiamentos. Nada foi gravado: confira se é a Base 01 completa, com a coluna "Cód. Cliente".'
        : null
    };
  }
  function gbBase03EnrichmentGuard(financeRowsSent, matched, lastNormal) {
    var m = Number(matched) || 0;
    var motivo = null;
    if (!financeRowsSent) {
      motivo = 'Nenhuma operação PAGA/FATURADA com CPF/CNPJ do cliente foi encontrada no arquivo (colunas "Cli - CPF/CNPJ" e "Op - Situação"). A importação foi bloqueada para não gravar a Base 03 sem completar os financiamentos.';
    } else if (m === 0) {
      motivo = 'A Base 03 não completaria NENHUM financiamento da Base 02 oficial (0 linhas). A importação foi bloqueada: confira se a Base 01 e a Base 02 foram atualizadas antes, com os arquivos completos.';
    } else if (lastNormal && m < lastNormal * GB_MIN_ENRICH_RATIO) {
      motivo = 'A Base 03 completaria só ' + gbFmtNum(m) + ' financiamento(s), bem abaixo da última importação normal (' + gbFmtNum(lastNormal) + '). A importação foi bloqueada: confira se a Base 01, a Base 02 e a Base 03 são os arquivos completos e do mesmo dia.';
    }
    return { block: !!motivo, matched: m, lastNormal: lastNormal || null, motivo: motivo };
  }
  // Classifica as linhas cruas da Base 03 em: PRINCIPAL (Cli-Nome + Op-
  // Código), SPF EXTRA (sem Cli-Nome próprio, Opcional-Nome contém "SPF
  // EXTRA" + Opcional-Valor>0 -- herda cliente/data da operação-pai por
  // forward-fill) ou DESCARTÁVEL (sobra de pivot table, ignorada).
  function gbClassifyBase03Rows(rawRows, date1904) {
    var allRows = [];
    var spfRows = [];
    var discardedTotalRows = 0;
    var lastClientName = '';
    var lastOperationDateParsed = '';
    rawRows.forEach(function (r) {
      var rawName = gbGetCol(r, ['Cli - Nome']);
      if (rawName) lastClientName = rawName;
      var parsedDate = gbParseExcelDate(gbGetCol(r, ['Op - Data Inclusão', 'Op - Data Contrato']), date1904);
      if (parsedDate) lastOperationDateParsed = parsedDate;

      var opcode = String(gbGetCol(r, ['Op - Código'])).trim();
      var isSpfExtraFlag = gbContainsSpfExtra(gbGetCol(r, ['Opcional - Nome'])) && gbAsNumber(gbGetCol(r, ['Opcional - Valor (R$)'])) > 0;

      if (rawName && opcode) {
        allRows.push(gbBuildBase03OperationalRow(r, allRows.length + 1, false, date1904));
      } else if (isSpfExtraFlag) {
        var row = gbBuildBase03OperationalRow(r, allRows.length + 1, true, date1904);
        if (!row.client_match_key) row.client_match_key = gbNormalize(lastClientName);
        if (!row.operation_date) row.operation_date = lastOperationDateParsed;
        allRows.push(row);
        spfRows.push(row);
      } else {
        discardedTotalRows++;
      }
    });
    var principalRows = allRows.filter(function (r) { return !r.is_spf_extra; });
    var allLikelyAccepted = allRows.filter(function (r) { return r.source_row_number > 0 && r.client_match_key; }).length;
    var allLikelyRejected = (allRows.length - allLikelyAccepted) + discardedTotalRows;
    var spfLikelyAccepted = spfRows.filter(function (r) { return r.source_row_number > 0 && r.client_match_key; }).length;
    var spfLikelyRejected = spfRows.length - spfLikelyAccepted;
    return {
      allRows: allRows, spfRows: spfRows, principalRows: principalRows,
      discardedTotalRows: discardedTotalRows,
      allLikelyAccepted: allLikelyAccepted, allLikelyRejected: allLikelyRejected,
      spfLikelyAccepted: spfLikelyAccepted, spfLikelyRejected: spfLikelyRejected
    };
  }

  // ---------------- seleção do lote oficial (status/cards) ----------------
  // Só o lote VALIDATED mais recente é "a base oficial" -- mesmo critério
  // usado por toda a família de RPCs analíticas certificadas (completed_at
  // desc nulls last, created_at desc). Lotes VALIDATING nunca contam como
  // "a base oficial" (podem ser órfãos de sessões/testes anteriores).
  function selectOfficialBatches(batches) {
    var result = {};
    SOURCE_ORDER.forEach(function (src) {
      var ofSource = (batches || []).filter(function (b) { return b.source_type === src; });
      var validated = ofSource.filter(function (b) { return b.status === 'VALIDATED'; })
        .sort(function (a, b) { return new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at); })[0] || null;
      result[src] = { validated: validated };
    });
    return result;
  }

  // ---------------- formatação ----------------
  function gbFmtDateTime(v) {
    if (!v) return '-';
    try { return new Date(v).toLocaleString('pt-BR'); } catch (e) { return '-'; }
  }
  function gbFmtDate(v) {
    if (!v) return '-';
    try { return new Date(v + 'T00:00:00').toLocaleDateString('pt-BR'); } catch (e) { return '-'; }
  }
  function gbFmtNum(v) { return Number(v || 0).toLocaleString('pt-BR'); }

  // Lotes com status distinto de VALIDATING/VALIDATED (ex.: ROLLED_BACK --
  // confirmado, PM-5C Gate 19/20, como uma correção manual histórica sem
  // RPC própria, não parte do contrato versionado) já são naturalmente
  // ignorados por selectOfficialBatches acima (só filtra 'VALIDATED') --
  // nenhum tratamento extra é necessário aqui.

  window.NX_MASTER_GESTAO_BASES_VM = {
    SOURCE_LABELS: SOURCE_LABELS,
    SOURCE_ORDER: SOURCE_ORDER,
    HEADER_ANCHORS: HEADER_ANCHORS,
    CHUNK_SIZE: CHUNK_SIZE,
    gbNormalize: gbNormalize,
    gbAsNumber: gbAsNumber,
    gbOnlyDigits: gbOnlyDigits,
    gbCleanChassis: gbCleanChassis,
    gbParseDateBR: gbParseDateBR,
    gbParseExcelDate: gbParseExcelDate,
    gbChunk: gbChunk,
    gbGetCol: gbGetCol,
    gbSha256Hex: gbSha256Hex,
    gbReadSheet: gbReadSheet,
    gbBuildBase01Row: gbBuildBase01Row,
    gbBase02Classify: gbBase02Classify,
    gbBuildBase02Row: gbBuildBase02Row,
    gbBuildColaboradorRow: gbBuildColaboradorRow,
    gbNormalizeDocumentForMatch: gbNormalizeDocumentForMatch,
    gbContainsSpfExtra: gbContainsSpfExtra,
    gbBuildBase03OperationalRow: gbBuildBase03OperationalRow,
    gbBuildBase03FinanceRows: gbBuildBase03FinanceRows,
    gbParseEnrichedCount: gbParseEnrichedCount,
    gbLastNormalEnrichment: gbLastNormalEnrichment,
    gbBase01DocumentGuard: gbBase01DocumentGuard,
    gbBase03EnrichmentGuard: gbBase03EnrichmentGuard,
    gbClassifyBase03Rows: gbClassifyBase03Rows,
    selectOfficialBatches: selectOfficialBatches,
    gbFmtDateTime: gbFmtDateTime,
    gbFmtDate: gbFmtDate,
    gbFmtNum: gbFmtNum
  };
})();
