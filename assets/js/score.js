/* PORTAL-NEXT V2 — Score module UI.
   Business logic: assets/js/adapters/score.adapter.js (byte-identical
   extraction — see docs/SCORE-ENGINE-AUDIT.md). This file only
   renders. Real labels from production (Gate 57) — no invented
   marketing names. Table order = calcScores()'s own sort (score desc,
   fin desc) — NOT interactively re-sortable this Wave (data-table.md's
   Sortable Column visual indicator is UNRESOLVED; not invented). */
(function () {
  'use strict';

  var FIXTURE_IDS = ['low','high','very_low','middle','very_high','confidence_boundary','zero_values','missing_optional_data','large_values','long_name','tie_case','sorting_case'];
  var fixturesData = null;
  var currentRows = [];
  var currentDetailKey = null;

  // RESTAURAÇÃO DE FILTROS -- item 2: Departamento/Loja são filtros
  // 100% CLIENT-SIDE sobre linhas que o backend já restringiu ao
  // escopo autorizado (Gate 12/NO_CLIENT_SCOPE_AUTHORITY -- a RPC não
  // aceita parâmetro de departamento/loja, nunca aceitou). Isto nunca
  // amplia o que o backend autoriza: filtrar/exibir um subconjunto das
  // linhas já retornadas não pode, por construção, revelar nada que a
  // RPC não tenha entregue. As opções de loja são derivadas das
  // PRÓPRIAS linhas do período carregado (nunca uma lista hardcoded)
  // -- por isso nunca podem oferecer uma loja que o backend não
  // autorizou para este usuário. 'ALL' é o valor neutro (sem filtro).
  var currentDepartmentFilter = 'ALL'; // 'ALL' | 'Novos' | 'Seminovos' (mesmos valores de r.dept)
  var currentLojaFilter = 'ALL'; // 'ALL' | valor exato de r.loja
  var lojaFilterAdjusted = false; // true por um render -- loja selecionada deixou de existir no período atual

  // RESTAURAÇÃO DE FILTROS -- item 4 ("Ver vendas detalhadas"). O
  // payload CRU (operation_reference/date/model/sale_value/
  // financed_value/installments/installment_value/balloon_value/plan/
  // status) já chega em loadReal() mas até aqui era descartado depois
  // do mapeamento mínimo para calcScores() (score-real-view-model.js
  // remove esses campos deliberadamente para o pipeline oficial --
  // Gate de minimização de dados, comentário do próprio arquivo). Esta
  // é a ÚNICA cópia retida, exclusivamente para esta lista de detalhe;
  // calcScores()/SCORE_WEIGHTS/o ranking nunca leem daqui. Nunca usada
  // em modo fixture (rawScorePayload permanece null lá).
  var rawScorePayload = null;
  var currentSalesDetailKey = null; // vendedor|loja|dept cuja lista de vendas está aberta
  var expandedOperationRef = null; // operation_reference expandida dentro dessa lista
  function applyRowFilters(rows) {
    return (rows || []).filter(function (r) {
      if (currentDepartmentFilter !== 'ALL' && r.dept !== currentDepartmentFilter) return false;
      if (currentLojaFilter !== 'ALL' && r.loja !== currentLojaFilter) return false;
      return true;
    });
  }

  // Score Phase 2A (Real Data Integration Foundation) -- the ONE place
  // transport is decided, same rule as gestao.js/dashbi.js/
  // coparticipado.js's own isRealTransport(). renderSeq/realResult/
  // currentAbortController guard against a stale/superseded async
  // response overwriting a newer one.
  function isRealTransport() {
    return !!(window.NX_AUTH && window.NX_AUTH.isAuthConfigured);
  }
  var renderSeq = 0;
  var realResult = null;
  var currentAbortController = null;

  // UAT FINAL -- a seção "Inteligência de Utilização" (SCORE-SIM-03/04)
  // foi removida da interface do Score por pedido explícito de UAT
  // (nunca usada por outra funcionalidade dentro deste módulo). Isto
  // remove APENAS a apresentação/fetch exclusivos dela neste arquivo --
  // score-intelligence-view-model.js (a lógica pura de identidade/
  // cobertura que o critério real "Utilização + Conversão" abaixo ainda
  // reaproveita) e as RPCs/telemetria reais permanecem 100% intactas.

  // SCORE-SIM-17 -- EXPERIMENTAL "Utilização dos Simuladores" criterion,
  // UNIFIED into the same table/detail as the commercial criteria
  // (SCORE-SIM-16A: human rejected a separate parallel section).
  // scuMode/scuLookup are declared where computeScuLookup() itself is
  // defined, further below. Consumes calcScores()'s own output
  // read-only -- never recomputes it, never reorders it, never writes
  // back to it.

  // Score Phase 2B (Period Filter Contract) -- real period selection.
  // Gate 5: no single unified default exists across the already-
  // homologated analytical modules (Dashbi defaults to the full
  // calendar year 2026-01-01..2026-12-31; Gestão to 2026-01-01..
  // 2026-06-30 -- confirmed by direct read of each module's own initial
  // state, not assumed). Score's own default (2026-06-01..today) is
  // ALREADY real-MASTER human-tested and approved from Phase 2A's own
  // UAT -- preserved here as the initial state rather than introduced
  // as a new, unproven behavior; only the picker itself is new.
  // currentPreset stays 'CUSTOM' until a quick-period button is used
  // (same convention as dashbi.js/gestao.js).
  var SCORE_DEFAULT_DATE_START = '2026-06-01';
  // SCORE_LOCAL_CALENDAR_DATE_PRESET_FIX: same construction already
  // proven in coparticipado.js/gestao.js/dashbi.js's own localIso()
  // (FI-UX-1) -- reads local calendar fields directly, never round-trips
  // through .toISOString() (UTC), which shifts the calendar date for
  // hosts whose local timezone sits far enough from UTC.
  function localIso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayIso() {
    return localIso(new Date());
  }
  var currentPreset = 'CUSTOM';
  var currentDateStart = SCORE_DEFAULT_DATE_START;
  var currentDateEnd = todayIso();

  // RESTAURAÇÃO DE FILTROS -- item 1: a fresh real-mode session (this
  // module has never initialized it before, this page load) must open
  // with the current local month (day 1) through today, mirroring the
  // SAME V2-UAT-01 fix already proven in gestao.js's own
  // ensureDefaultPeriod(). Runs at most once per page load
  // (dateDefaultInitialized guard) and only in real transport --
  // fixture mode's own deterministic default is untouched. A
  // same-session re-entry (Human already interacted, or navigated away
  // and back) is a no-op: currentDateStart/currentDateEnd already hold
  // whatever the Human last left them at, so the manual selection is
  // never silently overwritten while they are analyzing data.
  var dateDefaultInitialized = false;
  function ensureDefaultPeriod() {
    if (dateDefaultInitialized || !isRealTransport()) return;
    dateDefaultInitialized = true;
    var r = computePreset('currentMonth');
    if (r) {
      currentDateStart = r.start;
      currentDateEnd = r.end;
      currentPreset = 'currentMonth';
    }
  }

  function isValidIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime());
  }
  // Gate 6: required, valid, start<=end -- checked client-side BEFORE
  // any request is made (no request on an invalid contract).
  function dateContractError() {
    if (!currentDateStart) return 'Selecione a data inicial.';
    if (!currentDateEnd) return 'Selecione a data final.';
    if (!isValidIsoDate(currentDateStart) || !isValidIsoDate(currentDateEnd)) return 'Data inválida.';
    if (currentDateStart > currentDateEnd) return 'A data inicial deve ser anterior ou igual à data final.';
    return null;
  }

  // Same day-math as dashbi.js's own applyPresetAndRender (Gate 3 audit
  // -- reused verbatim, not reinvented), except computed off the
  // GENUINE current date (real production's own real-mode behavior,
  // per Phase 2A Gate 5's reading of modules/score.html) rather than a
  // fixture-fixed reference date -- Score's fixture mode is scenario-
  // based, not date-driven, so there is no fixture-determinism need a
  // pinned date would serve here.
  function computePreset(preset) {
    var today = new Date();
    var start, end = today;
    if (preset === 'currentMonth') start = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (preset === 'lastMonth') { start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); }
    else if (preset === 'last6') start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    else if (preset === 'lastYear') start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    if (!start) return null;
    return { start: localIso(start), end: localIso(end) };
  }

  // Gate 8 runtime-state vocabulary (LOADING/SUCCESS/EMPTY/AUTH_DENIED/
  // SESSION_EXPIRED/RPC_ERROR/TIMEOUT/MALFORMED_RESPONSE). EMPTY is not
  // a distinct error state here -- a SUCCESS with zero rows already
  // renders the existing "Nenhum vendedor encontrado" empty state via
  // renderTable() below, same as fixture mode's own empty-fixture case.
  var STATE_COPY = {
    AUTH_DENIED: { title: 'Sem permissão', body: 'Sua conta não tem acesso a esta análise.' },
    SESSION_EXPIRED: { title: 'Sessão expirada', body: 'Entre novamente para continuar.' },
    RPC_ERROR: { title: 'Não foi possível carregar', body: 'Não foi possível carregar o ranking agora. Tente novamente.' },
    TIMEOUT: { title: 'Tempo excedido', body: 'A resposta demorou demais. Tente novamente.' },
    MALFORMED_RESPONSE: { title: 'Não foi possível carregar', body: 'Resposta inesperada do servidor.' }
  };
  function loadingHtml() {
    return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando ranking...</div>';
  }
  function errorStateHtml(state, message) {
    var copy = STATE_COPY[state] || STATE_COPY.RPC_ERROR;
    return '<div class="modErrorState"><div class="modStateTitle">' + esc(copy.title) + '</div>' + esc(copy.body) + '</div>';
  }
  // Gate 6 -- purely local, no request made; distinct from the
  // transport-level STATE_COPY above (this is a client-side contract
  // violation, never a backend response).
  function invalidFilterHtml(message) {
    return '<div class="modErrorState"><div class="modStateTitle">Período inválido</div>' + esc(message) + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }
  function loadFixtures() {
    if (fixturesData) return Promise.resolve(fixturesData);
    return fetch('tests/fixtures/score-fixtures.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { fixturesData = data.cases; return fixturesData; });
  }

  function rowKey(r) { return r.vendedor + '|' + r.loja + '|' + r.dept; }

  // Gate 4-5: real production scale is 0-1000 (calcScores' own
  // Math.round(Math.max(0,Math.min(1000,score))) clamp — not
  // presumed, read directly from the extracted source). Meter
  // proportion is a DETERMINISTIC, display-only derivation from the
  // already-final (post-confidence-dampening) score — it never
  // touches the raw score, ranking, or sort order (Gate 18-19).
  var SCORE_SCALE_MAX = 1000;
  function meterPct(score) {
    return Math.max(0, Math.min(100, (score / SCORE_SCALE_MAX) * 100));
  }

  // PORTAL-NEXT-07.7B — the ONE authoritative Score Band classifier
  // (Gate 2), consumed identically by the desktop and mobile renderers
  // below (Gate 9 — no duplicated threshold logic). HUMAN-APPROVED
  // absolute boundaries (PORTAL-NEXT-07.7A Option 1, selected by human
  // decision — see docs/SCORE-BAND-DISCOVERY-07-7A.md and
  // docs/SCORE-BAND-NORMATIVE-07-7B.md): fixed on the FINAL 0-1000
  // score, never relative to the current seller population/period.
  // Descending-order checks make the ranges mutually exclusive without
  // needing upper-bound comparisons; the final `null` covers anything
  // that isn't a finite score in [0,1000] (negative, which the engine's
  // own clamp already prevents, but guarded here defensively too).
  //
  // Invalid/non-finite Score contract (Gate 5): a NaN/Infinity/-Infinity/
  // null/undefined Score returns `null` — it is NEVER classified into a
  // real band. This is a presentation-layer safety net; it stays in
  // place even though the specific receitaSPF-driven NaN defect
  // documented in PORTAL-NEXT-07.7A's Gate 19 was subsequently fixed at
  // the adapter boundary (PORTAL-NEXT-07.7C, see
  // docs/SCORE-RECEITA-SPF-NONFINITE-07-7C.md) — any other genuinely
  // invalid/non-finite Score must still resolve to no band, not a
  // fabricated one.
  var SCORE_BANDS = [
    { min: 900, max: 1000, label: 'ELITE', cls: 'scBandElite' },
    { min: 750, max: 899, label: 'ALTA PERFORMANCE', cls: 'scBandAlta' },
    { min: 550, max: 749, label: 'PERFORMANCE', cls: 'scBandPerformance' },
    { min: 300, max: 549, label: 'DESENVOLVIMENTO', cls: 'scBandDesenvolvimento' },
    { min: 0, max: 299, label: 'CRÍTICO', cls: 'scBandCritico' }
  ];
  function classifyScoreBand(score) {
    if (typeof score !== 'number' || !isFinite(score)) return null;
    for (var i = 0; i < SCORE_BANDS.length; i++) {
      if (score >= SCORE_BANDS[i].min) return SCORE_BANDS[i];
    }
    return null; // score < 0 -- outside every defined band
  }
  function scoreBandHtml(score, extraClass) {
    var band = classifyScoreBand(score);
    if (!band) return '';
    return '<span class="scBand ' + band.cls + (extraClass ? ' ' + extraClass : '') + '">' + esc(band.label) + '</span>';
  }

  // PORTAL-NEXT-07.6.4 — human UAT rejected the 07.6/07.6.2 approach of
  // transforming the desktop <table> itself into a mobile layout (via
  // CSS, however deterministic) three times in a row. Replaced with two
  // independent renderers fed by the SAME `rows` array — no
  // recomputation, no duplicated business logic. Only one is visible at
  // a time (CSS display:none on the inactive one, score.css); the
  // mobile renderer uses plain div markup, not table/tr/td, so no
  // legacy column geometry can ever reach it again.
  function scoreMeterHtml(r) {
    var pct = meterPct(r.score);
    return '<span class="scMeterTrack" role="img" aria-label="Score ' + r.score + ' de ' + SCORE_SCALE_MAX + '"><span class="scMeterFill" style="width:' + pct.toFixed(1) + '%"></span></span>';
  }

  // UAT FINAL -- correção do detalhamento aparecendo "no final da
  // página": antes, #scDetailRegion era um bloco fixo SEMPRE depois de
  // toda a tabela, então clicar na PRIMEIRA linha abria o detalhe só
  // depois da ÚLTIMA linha renderizada -- um salto de scroll enorme em
  // qualquer lista com mais de poucas linhas. Corrigido inserindo o
  // detalhe IMEDIATAMENTE após a linha/cartão clicado, dentro da própria
  // tabela/lista (nunca mais uma região separada no fim). renderDetail()
  // em si não foi reescrito -- só passou a aceitar um `variant` para
  // gerar ids únicos (desktop e mobile SEMPRE coexistem no DOM, um
  // oculto via CSS, então os dois nunca podem repetir o mesmo id).
  function renderDesktopTable(rows, currentKey) {
    var body = rows.map(function (r, i) {
      var tr = '<tr tabindex="0" role="button" data-key="' + esc(rowKey(r)) + '" aria-label="Ver detalhamento de ' + esc(r.vendedor) + '">' +
        '<td class="scRankCol">' + (i + 1) + '</td>' +
        '<td class="scNameCell"><span class="scNameText" title="' + esc(r.vendedor) + '">' + esc(r.vendedor) + '</span></td>' +
        '<td>' + esc(r.loja) + '</td>' +
        '<td>' + esc(r.dept) + '</td>' +
        '<td class="modNumCol"><span class="scScoreCell">' +
          '<span class="scScoreValueRow">' + scoreMeterHtml(r) + '<span>' + r.score + '</span></span>' +
          scoreBandHtml(r.score) +
          '</span></td>' +
        '<td class="modNumCol">' + (r.fin || 0) + '</td>' +
        '</tr>';
      if (currentKey && rowKey(r) === currentKey) {
        tr += '<tr class="scDetailRow" data-detail-key="' + esc(currentKey) + '"><td colspan="6">' + renderDetail(r, 'desktop') + '</td></tr>';
      }
      return tr;
    }).join('');
    return '<div class="scDesktopOnly"><div class="modTableWrap"><table class="modTable scTable">' +
      '<thead><tr><th scope="col">#</th><th scope="col">Vendedor</th><th scope="col">Loja</th><th scope="col">Depto</th><th scope="col">Score</th><th scope="col" class="modNumCol">Financ.</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderMobileCards(rows, currentKey) {
    var cards = rows.map(function (r, i) {
      var card = '<div class="scMobileCard" tabindex="0" role="button" data-key="' + esc(rowKey(r)) + '" aria-label="Ver detalhamento de ' + esc(r.vendedor) + '">' +
        '<div class="scMobileRank">#' + (i + 1) + '</div>' +
        '<div class="scMobileName">' + esc(r.vendedor) + '</div>' +
        '<div class="scMobileSub">' + esc(r.loja) + ' · ' + esc(r.dept) + '</div>' +
        '<div class="scMobileScoreBlock">' +
          '<div class="scMobileLabel">Score</div>' +
          '<div class="scMobileScoreValue">' + r.score + '</div>' +
          scoreBandHtml(r.score, 'scMobileBand') +
          '<div class="scMobileScoreRow">' + scoreMeterHtml(r) + '</div>' +
        '</div>' +
        '<div class="scMobileField"><div class="scMobileLabel">Financ.</div><div class="scMobileValue">' + (r.fin || 0) + '</div></div>' +
        '</div>';
      if (currentKey && rowKey(r) === currentKey) {
        card += '<div class="scMobileDetailWrap" data-detail-key="' + esc(currentKey) + '">' + renderDetail(r, 'mobile') + '</div>';
      }
      return card;
    }).join('');
    return '<div class="scMobileOnly">' + cards + '</div>';
  }

  function renderTable(rows, currentKey) {
    if (!rows.length) {
      return '<div class="modEmptyState"><div class="modStateTitle">Nenhum vendedor encontrado</div>Nenhum registro disponível para o cenário atual.</div>';
    }
    return renderDesktopTable(rows, currentKey) + renderMobileCards(rows, currentKey);
  }

  // RESTAURAÇÃO DE FILTROS -- item 4 ("Ver vendas detalhadas"). Junção
  // venda<->financiamento por operation_reference (a MESMA chave que já
  // liga os dois registros no payload real -- contrato confirmado em
  // score-real-contract-test.py's SAMPLE_PAYLOAD), NUNCA por
  // coincidência de nome isolado. Vínculo vendedor+loja+departamento
  // exige os TRÊS campos batendo simultaneamente com a linha do Score
  // oficial (rowKey), nunca só o nome.
  var RAW_DEPT_BY_DISPLAY = { Novos: 'NOVOS', Seminovos: 'SEMINOVOS' };
  function brDateOrDash(iso) {
    var m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : 'Não disponível';
  }
  function moneyOrDash(v) {
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return 'Não disponível';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function intOrDash2(v) {
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return 'Não disponível';
    return String(Number(v));
  }
  // null = fonte indisponível nesta sessão (fixture, ou dados reais
  // ainda não carregados) -- distinto de um array vazio (fonte
  // disponível, zero operações no período/escopo). Nunca fabrica linha
  // nenhuma: cada item vem 1:1 de rawScorePayload.sales, a MESMA
  // contagem que buildSales()/calcScores() já usam para `vendas`
  // (nenhum filtro/dedup adicional aplicado aqui).
  function buildVendorOperations(row) {
    if (!rawScorePayload) return null;
    var rawDept = RAW_DEPT_BY_DISPLAY[row.dept];
    var financeByRef = {};
    (rawScorePayload.finance || []).forEach(function (f) {
      if (f.seller === row.vendedor && f.store === row.loja && f.department === rawDept) {
        financeByRef[f.operation_reference] = f;
      }
    });
    return (rawScorePayload.sales || [])
      .filter(function (s) { return s.seller === row.vendedor && s.store === row.loja && s.department === rawDept; })
      .map(function (s) { return { sale: s, finance: financeByRef[s.operation_reference] || null }; });
  }

  // IMPLEMENTAR ENTRADA ESTIMADA -- decisão comercial aprovada por
  // Luis: exibir venda-financiado como estimativa, NUNCA como entrada
  // contratual (nenhum campo real existe -- diagnóstico da wave
  // anterior, confirmado via schema real do Supabase). Usa
  // EXCLUSIVAMENTE os valores já recebidos no mesmo payload/operação
  // (nunca uma fonte nova). Math.max(0, ...) NUNCA aplicado aqui --
  // financiado > venda é uma inconsistência de dados a ser sinalizada,
  // não uma divergência a esconder.
  //
  // AJUSTE PONTUAL -- decisão comercial aprovada por Luis: rótulo
  // simplificado para "Entrada" (nunca mais "Entrada estimada") e a
  // mensagem explicativa de metodologia ("Calculada pela diferença...")
  // removida da interface no caso normal -- só a SINALIZAÇÃO DE
  // INCONSISTÊNCIA (financiado > venda) permanece, por ser um alerta de
  // qualidade de dado, não a explicação de método que foi removida.
  function entradaEstimadaInfo(op) {
    var f = op.finance;
    if (!f) return { label: 'Entrada', value: 'Não aplicável', note: null, inconsistente: false };
    var vendaRaw = op.sale.sale_value;
    var financiadoRaw = f.financed_value;
    var venda = Number(vendaRaw);
    var financiado = Number(financiadoRaw);
    var vendaOk = vendaRaw !== null && vendaRaw !== undefined && vendaRaw !== '' && isFinite(venda);
    var financiadoOk = financiadoRaw !== null && financiadoRaw !== undefined && financiadoRaw !== '' && isFinite(financiado);
    if (!vendaOk || !financiadoOk) {
      return { label: 'Entrada', value: 'Não disponível', note: null, inconsistente: false };
    }
    if (financiado > venda) {
      return {
        label: 'Entrada', value: 'Não disponível', inconsistente: true,
        note: 'Financiamento maior que o valor de venda — dado inconsistente; entrada não calculada.'
      };
    }
    return { label: 'Entrada', value: moneyOrDash(venda - financiado), inconsistente: false, note: null };
  }

  function salesDetailToggleHtml(key) {
    var isOpen = currentSalesDetailKey === key;
    return '<button type="button" class="scSalesDetailToggle" data-key="' + esc(key) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      (isOpen ? 'Ocultar vendas detalhadas' : 'Ver vendas detalhadas') + '</button>';
  }

  // SUGESTÃO DE APRESENTAÇÃO (item 5): lista compacta Data | Veículo |
  // Valor de venda | Financiamento, cada operação expansível
  // individualmente para entrada/plano/parcelas/PMT/balão/instituição/
  // situação -- nunca uma segunda tabela larga, nunca um modal.
  function salesDetailPanelHtml(row) {
    var key = rowKey(row);
    if (currentSalesDetailKey !== key) return '';
    var ops = buildVendorOperations(row);
    if (ops === null) {
      return '<div class="scSalesDetail"><p class="scAmostraNote">Vendas detalhadas indisponíveis nesta sessão (modo de demonstração, ou dados reais ainda não carregados).</p></div>';
    }
    var rowsHtml = ops.map(function (op) {
      var ref = op.sale.operation_reference || '';
      var isExpanded = !!ref && expandedOperationRef === ref;
      var f = op.finance;
      // REFINAMENTO VISUAL -- item 1: identificação textual explícita
      // (nunca só cor), verde discreto/cinza neutro (tokens do Portal
      // V2, nunca vermelho de erro -- "não financiado" não é uma
      // falha). Só o badge/valor é colorido, nunca a linha inteira.
      var finCell = f
        ? '<span class="scSalesOpFin scSalesOpFinYes"><span class="scSalesOpFinBadge">FINANCIADO</span><span class="scSalesOpFinValue">' + esc(moneyOrDash(f.financed_value)) + '</span></span>'
        : '<span class="scSalesOpFin scSalesOpFinNo"><span class="scSalesOpFinBadge">NÃO FINANCIADO</span><span class="scSalesOpFinValue">Sem financiamento registrado</span></span>';
      var summary = '<button type="button" class="scSalesOpToggle" data-op-ref="' + esc(ref) + '" aria-expanded="' + (isExpanded ? 'true' : 'false') + '">' +
        '<span class="scSalesOpDateModel"><span class="scSalesOpDate">' + esc(brDateOrDash(op.sale.date)) + '</span><span class="scSalesOpModel">' + esc(op.sale.model || 'Não disponível') + '</span></span>' +
        '<span class="scSalesOpValue"><span class="scSalesOpMobileLabel">Valor da venda</span>' + esc(moneyOrDash(op.sale.sale_value)) + '</span>' +
        '<span class="scSalesOpMobileLabel scSalesOpFinLabel">Valor financiado</span>' +
        finCell +
        '</button>';
      var expanded = '';
      if (isExpanded) {
        // REFINAMENTO VISUAL -- item 3: Instituição financeira e
        // Situação comercial/financeira removidas INTEGRALMENTE da
        // interface (os dados subjacentes em f.status permanecem
        // intocados -- só deixam de ser exibidos aqui).
        var entradaInfo = entradaEstimadaInfo(op);
        var entradaRowHtml = '<div class="scSalesOpEntradaRow' + (entradaInfo.inconsistente ? ' scSalesOpEntradaInconsistente' : '') + '">' +
          '<div class="scSalesOpEntradaMain"><span>' + esc(entradaInfo.label) + '</span><span>' + esc(entradaInfo.value) + '</span></div>' +
          (entradaInfo.note ? '<p class="scAmostraNote scSalesOpEntradaNote">' + esc(entradaInfo.note) + '</p>' : '') +
          '</div>';
        expanded = '<div class="scSalesOpExpanded">' +
          '<div><span>Identificação da operação</span><span>' + esc(op.sale.operation_reference || 'Não disponível') + '</span></div>' +
          entradaRowHtml +
          '<div><span>Valor financiado</span><span>' + esc(f ? moneyOrDash(f.financed_value) : 'Não financiado') + '</span></div>' +
          '<div><span>Plano de financiamento</span><span>' + esc(f ? (f.plan || 'Não disponível') : 'Não financiado') + '</span></div>' +
          '<div><span>Parcelas</span><span>' + esc(f ? intOrDash2(f.installments) : 'Não financiado') + '</span></div>' +
          '<div><span>PMT / parcela</span><span>' + esc(f ? moneyOrDash(f.installment_value) : 'Não financiado') + '</span></div>' +
          '<div><span>Balão</span><span>' + esc(f ? moneyOrDash(f.balloon_value) : 'Não financiado') + '</span></div>' +
          '</div>';
      }
      return '<div class="scSalesOpRow' + (isExpanded ? ' scSalesOpRowExpanded' : '') + '">' + summary + expanded + '</div>';
    }).join('');
    // REFINAMENTO VISUAL -- item 2: cabeçalho com os mesmos eixos/
    // larguras das linhas -- reaproveita a MESMA classe scSalesOpToggle
    // (mesmo grid-template-columns do CSS), nunca uma segunda definição
    // de colunas que poderia divergir da primeira.
    var listHeadHtml = '<div class="scSalesOpToggle scSalesListHead" aria-hidden="true">' +
      '<span class="scSalesOpDateModel">Data / Veículo</span>' +
      '<span class="scSalesOpValue">Valor da venda</span>' +
      '<span>Valor financiado</span>' +
      '</div>';
    return '<div class="scSalesDetail">' +
      '<div class="scSalesDetailHead"><h3>Vendas de ' + esc(row.vendedor) + '</h3><span class="scSalesDetailCount">' + ops.length + ' operação(ões) no período</span></div>' +
      (ops.length ? (listHeadHtml + '<div class="scSalesList">' + rowsHtml + '</div>') : '<p class="scAmostraNote">Nenhuma operação encontrada para este vendedor no período/departamento/loja selecionados.</p>') +
      '</div>';
  }

  function renderDetail(row, variant) {
    if (!row) return '';
    var criteria = (row.scoreBreakdown || []).map(function (c) {
      var widthPct = Math.max(0, Math.min(100, (c.pct || 0) * 100));
      return '<div class="scCriterion">' +
        '<div class="scCriterionTop"><span class="scCriterionName">' + esc(c.label) + '</span><span class="scCriterionPoints">' + c.points + ' / ' + c.max + ' pts</span></div>' +
        '<div class="scCriterionMeta"><span>' + esc(c.detail || '') + '</span></div>' +
        '<div class="scMeter"><span style="width:' + widthPct.toFixed(1) + '%"></span></div>' +
        (c.amostra ? '<p class="scAmostraNote">Amostra: ' + esc(c.amostra) + ' — pontuação proporcional à amostra até atingir confiança plena.</p>' : '') +
        '</div>';
    }).join('');
    var key = rowKey(row);
    var idSuffix = variant ? ('-' + variant) : '';
    return '<div class="scDetail" id="scDetail' + idSuffix + '">' +
      '<div class="scDetailHead"><h2>' + esc(row.vendedor) + '</h2><span class="scDetailTotal">Score Oficial: ' + row.score + ' / 1000 (usado no ranking)</span>' +
      salesDetailToggleHtml(key) +
      '<button type="button" class="scCloseDetail" id="scCloseDetail' + idSuffix + '">Fechar detalhamento</button></div>' +
      criteria +
      scuCriterionHtml(key) +
      salesDetailPanelHtml(row) +
      '</div>';
  }

  // SCORE-SIM-03 -- section 10/11: a ratio's `null` (non-calculável,
  // zero denominator) renders as an em dash; NEVER 0, NEVER Infinity.
  // The one and only place a number becomes this display string.
  function fmtRatioOrDash(v, decimals) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: decimals || 1, maximumFractionDigits: decimals || 1 });
  }
  function fmtIntOrDash(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return String(Math.round(v));
  }
  function fmtPctOrDash(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  // SCORE-SIM-17 -- UNIFIED integration: Utilização dos Simuladores is
  // now ONE CRITERION inside the SAME table/detail as the commercial
  // criteria, never a second parallel table/section (human rejected
  // that layout in SCORE-SIM-16A). `scuLookup` is computed ONCE per
  // renderPanel() call, synchronously, BEFORE the table/detail render
  // -- keyed by rowKey(r), consumed by renderDesktopTable/
  // renderMobileCards/renderDetail below.
  var scuMode = 'IDLE'; // 'DEMO_MODE' | 'REAL_CONVERSION_MODE' | 'LOCAL_REAL_MODE' | 'IDLE'
  var scuLookup = null;

  // SCORE-SIM-22 -- LOCAL_REAL_MODE state. Entirely separate from
  // realResult/renderSeq (the commercial data's own async guard) --
  // this is its own independent sequence/cache because the utilization
  // source can succeed, fail or still be loading regardless of whether
  // the commercial data came from the fixture demo or the real
  // provider. `scuRealCache` is keyed by período so a period change
  // never shows a previous period's numbers while the new period is
  // still loading (section 4).
  var scuRealCache = null; // {periodoKey, calcProofEventsByUsuarioId, fetchFailed}
  var scuAsyncSeq = 0;
  var scuAbortController = null;

  // Utilização + Conversão (regra comercial final aprovada) -- REAL_
  // CONVERSION_MODE's own cache, same shape/discipline as scuRealCache
  // above (keyed by período, one fetch per period change). Reuses the
  // SAME shared scuAsyncSeq/scuAbortController -- LOCAL_REAL_MODE and
  // REAL_CONVERSION_MODE are mutually exclusive branches of
  // computeScuLookup() (gated by window.NX_SCORE_TELEMETRY_LOCAL_SOURCE.
  // isEnabled(), never true on production index.html), so they never run
  // concurrently on the same page.
  var scuConversionCache = null; // {periodoKey, usageLinhas, usuarios, coverage, fetchFailed}

  function scuPeriodoKey() {
    return (currentDateStart || '') + '|' + (currentDateEnd || '');
  }

  // Re-paints ONLY the table (detail is now rendered INLINE by
  // renderTable() itself, right after the selected row/card -- never
  // re-triggers loadIntelligence or refetches the commercial data) --
  // the async utilization refresh must not cause a second, unrelated
  // network round-trip every time it resolves.
  function repaintScuOnly() {
    scuLookup = computeScuLookup(currentRows);
    var tableHtml = renderTable(currentRows, currentDetailKey);
    var region = document.getElementById('scTableRegion');
    if (region) region.innerHTML = tableHtml;
    wireTableInteraction();
  }

  function scheduleScuRealFetch(pk) {
    var mySeq = ++scuAsyncSeq;
    if (scuAbortController) scuAbortController.abort();
    var controller = new AbortController();
    scuAbortController = controller;
    window.NX_SCORE_TELEMETRY_LOCAL_SOURCE.fetchEvents(
      { periodoInicio: currentDateStart, periodoFim: currentDateEnd },
      { signal: controller.signal }
    ).then(
      function (result) {
        if (mySeq !== scuAsyncSeq) return; // superseded by a newer período/request -- discard silently
        scuRealCache = { periodoKey: pk, calcProofEventsByUsuarioId: result.calcProofEventsByUsuarioId, fetchFailed: false };
        repaintScuOnly();
      },
      function (err) {
        if (mySeq !== scuAsyncSeq) return;
        if (err && err.name === 'AbortError') return; // superseded, not a real failure -- never rendered as an error
        // A real transport/HTTP failure -- rendered explicitly as
        // "fonte indisponível", NEVER silently converted to a zero
        // (section 3's explicit rule).
        scuRealCache = { periodoKey: pk, calcProofEventsByUsuarioId: {}, fetchFailed: true };
        repaintScuOnly();
      }
    );
  }

  // Utilização + Conversão -- EXECUÇÃO AUTORIZADA wave: fetches a SINGLE
  // real RPC, score_utilization_conversion_scope_data (aplicada ao
  // Supabase real, GRANT authenticated -- NUNCA master_simulator_usage_
  // data/master_admin_security_data diretamente daqui em diante).
  // Identidade e escopo já vêm resolvidos e restritos pelo servidor
  // (auth.uid() -> operational_current_scope()) -- este arquivo nunca
  // envia usuario_id/perfil/loja como parâmetro. Independente do ciclo
  // assíncrono de loadIntelligence() (este é disparado pela chamada
  // síncrona computeScuLookup() de renderPanel()). Nunca bloqueia/falha o
  // critério inteiro por ausência do provider -- tratado como falha de
  // busca (fetchFailed:true), nunca um zero silencioso.
  function scheduleScuConversionFetch(pk) {
    var mySeq = ++scuAsyncSeq;
    if (scuAbortController) scuAbortController.abort();
    var controller = new AbortController();
    scuAbortController = controller;
    var GOVERNED = window.NX_SCORE_UTILIZATION_GOVERNED_PROVIDER;
    var INTEL_VM = window.NX_SCORE_INTELLIGENCE_VM;
    if (!GOVERNED || !INTEL_VM) {
      scuConversionCache = { periodoKey: pk, governedRows: null, coverage: null, fetchFailed: true };
      repaintScuOnly();
      return;
    }
    // Score out/2026 (opção 1): com dias sem dados de telemetria no período,
    // busca também as simulações só dos trechos COM dados (mesma RPC
    // governada, um pedido por trecho). A identidade continua vindo do
    // período inteiro, exatamente como antes.
    var CONV_VM = window.NX_SCORE_CONVERSION_VM;
    var split = CONV_VM && CONV_VM.splitPeriodByGaps ? CONV_VM.splitPeriodByGaps(currentDateStart, currentDateEnd, todayIso()) : { hasGap: false };
    var dataPartsFetch = split.hasGap
      ? Promise.all(split.dataParts.map(function (p) { return GOVERNED.loadGovernedUtilization(p.start, p.end, { signal: controller.signal }); }))
      : Promise.resolve(null);
    Promise.all([GOVERNED.loadGovernedUtilization(currentDateStart, currentDateEnd, { signal: controller.signal }), dataPartsFetch]).then(
      function (both) {
        var rows = both[0];
        if (mySeq !== scuAsyncSeq) return;
        // A RPC governada não retorna telemetry_started_at (contrato
        // mínimo, section 4 da wave de desenho) -- reaproveita a MESMA
        // constante/fallback real já usada pela Inteligência de
        // Utilização (confirmada ao vivo: marco zero real = telemetria
        // MIN(started_at) = 2026-08-17, mesmo dia desta constante).
        var epochIso = INTEL_VM.TELEMETRY_EPOCH_FALLBACK_ISO;
        var coverage = INTEL_VM.resolveComparableWindow(currentDateStart, currentDateEnd, epochIso);
        var gapInfo = null;
        if (split.hasGap) {
          var simsData = {};
          (both[1] || []).forEach(function (partRows) {
            (partRows || []).forEach(function (r) {
              var k = r.usuario_id + '|' + String(r.department || '').toUpperCase();
              simsData[k] = (simsData[k] || 0) + (Number(r.simulations) || 0);
            });
          });
          gapInfo = { dataParts: split.dataParts, excluded: split.excluded, simsData: simsData };
        }
        scuConversionCache = { periodoKey: pk, governedRows: rows, coverage: coverage, fetchFailed: false, gapInfo: gapInfo };
        repaintScuOnly();
      },
      function (err) {
        if (mySeq !== scuAsyncSeq) return;
        if (err && err.name === 'AbortError') return;
        scuConversionCache = { periodoKey: pk, governedRows: null, coverage: null, fetchFailed: true };
        repaintScuOnly();
      }
    );
  }

  // Identidade real a partir das PRÓPRIAS linhas já retornadas (governed
  // rows) -- nunca por coincidência de nome com uma fonte externa: o
  // usuario_id de cada linha já é a prova; nome/loja aqui servem só como
  // chave de junção com a linha do Score oficial (que só tem nome/loja),
  // igual ao já testado em NX_SCORE_INTELLIGENCE_VM.resolveVendorIdentityMap
  // -- mas deduplicado por usuario_id (o MESMO vendedor aparece uma vez
  // por departamento nas linhas governadas -- isso nunca é ambiguidade).
  function buildGovernedIdentityMap(governedRows, INTEL_VM) {
    var byKey = {};
    (governedRows || []).forEach(function (r) {
      var key = INTEL_VM._internal.identityKey(r.nome, r.loja);
      byKey[key] = byKey[key] || {};
      byKey[key][r.usuario_id] = true;
    });
    var resolved = {};
    Object.keys(byKey).forEach(function (key) {
      var ids = Object.keys(byKey[key]);
      resolved[key] = (ids.length === 1) ? { usuarioId: ids[0], ambiguous: false } : { usuarioId: null, ambiguous: true };
    });
    return resolved;
  }

  function scConversionTotal(r, VM, utilizacaoPontos) {
    var comercial = VM.normalizeComercial(r.score);
    return {
      scoreComercial: comercial,
      utilizacaoPontos: utilizacaoPontos,
      scoreTotal: (utilizacaoPontos === null) ? null : Math.round(comercial + utilizacaoPontos),
      utilizacaoDisponivel: utilizacaoPontos !== null
    };
  }

  // REAL_CONVERSION_MODE -- the final approved commercial rule (S/V/F,
  // F/S ratio capped at 100 pts), replacing exclusively the previous
  // Frequência/Diversidade experimental criterion for real transport.
  // DEMO_MODE below (fixture harnesses only, never production
  // index.html) is intentionally left on the older formula -- out of
  // this wave's scope, which is specifically about what real users see.
  function computeScuLookupRealConversion(rows) {
    scuMode = 'REAL_CONVERSION_MODE';
    var pk = scuPeriodoKey();
    var lookup = {};
    var VM = window.NX_SCORE_UTILIZATION_VM;
    var INTEL_VM = window.NX_SCORE_INTELLIGENCE_VM;
    var CONV = window.NX_SCORE_CONVERSION_VM;

    if (!scuConversionCache || scuConversionCache.periodoKey !== pk) {
      scheduleScuConversionFetch(pk);
      (rows || []).forEach(function (r) {
        lookup[rowKey(r)] = { usageStatus: null, loading: true, u: { disponivel: false }, total: scConversionTotal(r, VM, null) };
      });
      return lookup;
    }

    if (scuConversionCache.fetchFailed || !CONV) {
      (rows || []).forEach(function (r) {
        lookup[rowKey(r)] = { usageStatus: null, fetchFailed: true, u: { disponivel: false }, total: scConversionTotal(r, VM, null) };
      });
      return lookup;
    }

    var coverage = scuConversionCache.coverage;
    var noCoverage = !!(coverage && coverage.noCoverage);
    var governedRows = scuConversionCache.governedRows || [];
    var identityMap = buildGovernedIdentityMap(governedRows, INTEL_VM);
    var usageByUsuarioId = {};
    governedRows.forEach(function (r) {
      usageByUsuarioId[r.usuario_id + '|' + String(r.department || '').toUpperCase()] = { simulations: Number(r.simulations) || 0 };
    });

    // Score out/2026 (opção 1): vendas/financiamentos só dos dias COM dados,
    // pela MESMA cadeia oficial (buildRealResult + calcScores congelado)
    // aplicada ao payload cru já carregado, filtrado por data -- nada recalculado à mão.
    var gapInfo = scuConversionCache.gapInfo;
    var dataDaysByRow = null;
    if (gapInfo && rawScorePayload && window.NX_SCORE_REAL_VIEW_MODEL && window.NX_SCORE_ADAPTER) {
      var inData = function (x) { return CONV.isInParts(x && x.date, gapInfo.dataParts); };
      var sub = {};
      for (var pkey in rawScorePayload) sub[pkey] = rawScorePayload[pkey];
      sub.sales = (rawScorePayload.sales || []).filter(inData);
      sub.finance = (rawScorePayload.finance || []).filter(inData);
      try {
        var mappedSub = window.NX_SCORE_REAL_VIEW_MODEL.buildRealResult(sub);
        dataDaysByRow = {};
        window.NX_SCORE_ADAPTER.compute(mappedSub.sales, mappedSub.fins).forEach(function (o) {
          dataDaysByRow[rowKey(o)] = { vendas: Number(o.vendas) || 0, fin: Number(o.fin) || 0 };
        });
      } catch (e) { dataDaysByRow = null; }
    }

    (rows || []).forEach(function (r) {
      var key = rowKey(r);

      // Período incompatível (todo o período anterior ao início real da
      // coleta de telemetria) -- indisponível, nunca zero (section 5).
      if (noCoverage) {
        lookup[key] = { usageStatus: 'SEM_COBERTURA_TELEMETRIA', u: { disponivel: false }, total: scConversionTotal(r, VM, null) };
        return;
      }

      var idEntry = identityMap[INTEL_VM._internal.identityKey(r.vendedor, r.loja)];
      var identityStatus = !idEntry ? 'SEM_VINCULO_COMPROVADO' : (idEntry.ambiguous ? 'AMBIGUO' : 'VINCULADO');
      if (identityStatus !== 'VINCULADO') {
        lookup[key] = { usageStatus: identityStatus, u: { disponivel: false }, total: scConversionTotal(r, VM, null) };
        return;
      }

      // VINCULADO -- S real (por usuario_id + departamento, nunca somado
      // entre Novos/Seminovos), V/F reais do próprio Score oficial
      // (mesmo vendedor/departamento/período, nunca recalculados). Uma
      // linha ausente do conjunto governado (vendedor VINCULADO mas sem
      // nenhuma linha retornada para este departamento) é um zero real
      // -- a RPC já só retorna linhas dentro do escopo do caller, então
      // "não veio nada" aqui significa genuinamente "zero simulações",
      // nunca "sem permissão" (isso já teria sido um erro 42501 tratado
      // acima, em fetchFailed).
      var usageKey = idEntry.usuarioId + '|' + String(r.dept || '').toUpperCase();
      var u = usageByUsuarioId[usageKey] || null;
      var S = u ? u.simulations : 0;
      var V = Number(r.vendas) || 0;
      var F = Number(r.fin) || 0;
      var cls;
      if (gapInfo && dataDaysByRow) {
        var dd = dataDaysByRow[key] || { vendas: 0, fin: 0 };
        cls = CONV.classifyExcludingGap(gapInfo.simsData[usageKey] || 0, V, F, dd.vendas, dd.fin);
        S = cls.S;
      } else {
        cls = CONV.classify(S, V, F);
      }
      lookup[key] = {
        usageStatus: 'VINCULADO',
        convStatus: cls.status, atencao: cls.atencao, S: S, V: V, F: F,
        gapAdjusted: !!cls.gapAdjusted, Vd: cls.Vd, Fd: cls.Fd, excluded: cls.gapAdjusted ? gapInfo.excluded : null,
        u: { disponivel: true, utilizacaoPontos: cls.pontos, conversaoPontos: cls.conversao, utilizacaoSubPontos: cls.utilizacao, inconsistente: cls.inconsistente },
        total: scConversionTotal(r, VM, cls.pontos)
      };
    });
    return lookup;
  }

  // Builds the lookup for LOCAL_REAL_MODE, reusing buildUtilizacaoView/
  // computeUtilizacaoScore/composeScoreTotal UNMODIFIED -- exactly the
  // same functions already exercised by DEMO_MODE above and by the
  // SCORE-SIM-21 bridge script against the same real Postgres-backed
  // read path.
  function computeScuLookupLocalReal(rows, S, VM) {
    scuMode = 'LOCAL_REAL_MODE';
    var T = window.ScoreTelemetryIntegrationExperimental;
    var LOCAL = window.NX_SCORE_TELEMETRY_LOCAL_SOURCE;
    var pk = scuPeriodoKey();
    var lookup = {};

    if (!scuRealCache || scuRealCache.periodoKey !== pk) {
      scheduleScuRealFetch(pk);
      (rows || []).forEach(function (r) {
        lookup[rowKey(r)] = {
          usageStatus: null, loading: true,
          u: { disponivel: false },
          total: { scoreComercial: VM.normalizeComercial(r.score), utilizacaoPontos: null, scoreTotal: null, utilizacaoDisponivel: false },
          duplicatasIgnoradas: 0,
        };
      });
      return lookup;
    }

    if (scuRealCache.fetchFailed) {
      (rows || []).forEach(function (r) {
        lookup[rowKey(r)] = {
          usageStatus: null, fetchFailed: true,
          u: { disponivel: false },
          total: { scoreComercial: VM.normalizeComercial(r.score), utilizacaoPontos: null, scoreTotal: null, utilizacaoDisponivel: false },
          duplicatasIgnoradas: 0,
        };
      });
      return lookup;
    }

    var identityMap = LOCAL.getIdentityMap();
    (rows || []).forEach(function (r) {
      var key = rowKey(r);
      var mapped = identityMap[key];
      if (!mapped) {
        lookup[key] = { usageStatus: 'SEM_VINCULO_COMPROVADO', u: { disponivel: false }, total: { scoreComercial: VM.normalizeComercial(r.score), utilizacaoPontos: null, scoreTotal: null, utilizacaoDisponivel: false }, duplicatasIgnoradas: 0 };
        return;
      }
      if (mapped === '__AMBIGUO__') {
        lookup[key] = { usageStatus: 'AMBIGUO', u: { disponivel: false }, total: { scoreComercial: VM.normalizeComercial(r.score), utilizacaoPontos: null, scoreTotal: null, utilizacaoDisponivel: false }, duplicatasIgnoradas: 0 };
        return;
      }
      var linked = T.buildUtilizacaoView(
        [{ vendedor: r.vendedor, loja: r.loja, dept: r.dept, usageStatus: 'VINCULADO', usuarioId: mapped, officialScore: r.score }],
        scuRealCache.calcProofEventsByUsuarioId, pk
      )[0];
      var rawEvents = scuRealCache.calcProofEventsByUsuarioId[mapped] || [];
      var u = S.computeUtilizacaoScore(linked, rawEvents, new Set());
      var total = S.composeScoreTotal(VM.normalizeComercial(r.score), u);
      lookup[key] = {
        usageStatus: 'VINCULADO', u: u, total: total,
        eventosRejeitados: linked.eventosRejeitados,
        eventosOperacionalmenteBloqueados: linked.eventosOperacionalmenteBloqueados,
        duplicatasIgnoradas: 0,
      };
    });
    return lookup;
  }

  function computeScuLookup(rows) {
    if (!(window.ScoreUtilizationScoringExperimental && window.NX_SCORE_UTILIZATION_VM && window.ScoreTelemetryIntegrationExperimental && window.ScoreCalculationProofExperimental)) {
      scuMode = 'IDLE';
      return null;
    }
    var S = window.ScoreUtilizationScoringExperimental;
    var VM = window.NX_SCORE_UTILIZATION_VM;
    var lookup = {};

    // SCORE-SIM-22 -- highest priority: only active when a harness page
    // explicitly enables it (never on production index.html). Replaces
    // the synthetic generator ONLY in this mode -- DEMO_MODE below is
    // completely unchanged; the real-transport branch below now uses
    // REAL_CONVERSION_MODE instead of the old NO_TELEMETRY_SOURCE stub.
    if (window.NX_SCORE_TELEMETRY_LOCAL_SOURCE && window.NX_SCORE_TELEMETRY_LOCAL_SOURCE.isEnabled()) {
      return computeScuLookupLocalReal(rows, S, VM);
    }

    if (!isRealTransport()) {
      // HOMOLOGAÇÃO FINAL -- modo demonstração agora usa a MESMA regra
      // comercial final aprovada (S/V/F, F/S) do modo real, nunca mais a
      // antiga fórmula Frequência/Diversidade (S.computeUtilizacaoScore
      // permanece intocado no arquivo, apenas não é mais chamado por
      // este branch). Reaproveita o MESMO gerador determinístico já
      // testado (VM.buildDemoUtilizationRows -- identidade VINCULADO/
      // SEM_VINCULO_COMPROVADO, eventos reais via os motores financeiros
      // reais) apenas trocando a fórmula aplicada sobre seu resultado:
      // S = nº de eventos sintéticos elegíveis já gerados para o
      // usuarioId resolvido; V/F vêm das PRÓPRIAS linhas já computadas
      // pela fixture (r.vendas/r.fin), nunca recalculados. Nenhuma
      // arquitetura nova -- mesmo gerador, fórmula diferente.
      scuMode = 'DEMO_MODE';
      var CONV = window.NX_SCORE_CONVERSION_VM;
      var demo = VM.buildDemoUtilizationRows(rows);
      var demoByKey = {};
      demo.view.forEach(function (vrow) { demoByKey[vrow.vendedor + '|' + vrow.loja + '|' + vrow.dept] = vrow; });
      (rows || []).forEach(function (r) {
        var key = rowKey(r);
        var vrow = demoByKey[key];
        if (!vrow || vrow.usageStatus !== 'VINCULADO' || !CONV) {
          lookup[key] = {
            usageStatus: vrow ? vrow.usageStatus : null,
            u: { disponivel: false },
            total: scConversionTotal(r, VM, null),
          };
          return;
        }
        var rawEvents = (vrow.usuarioId && demo.rawEventsByUsuario[vrow.usuarioId]) || [];
        var S_count = rawEvents.length;
        var V_count = Number(r.vendas) || 0;
        var F_count = Number(r.fin) || 0;
        var cls = CONV.classify(S_count, V_count, F_count);
        lookup[key] = {
          usageStatus: 'VINCULADO',
          convStatus: cls.status, atencao: cls.atencao, S: S_count, V: V_count, F: F_count,
          u: { disponivel: true, utilizacaoPontos: cls.pontos, conversaoPontos: cls.conversao, utilizacaoSubPontos: cls.utilizacao, inconsistente: cls.inconsistente },
          total: scConversionTotal(r, VM, cls.pontos),
        };
      });
    } else {
      // Regra comercial final aprovada -- Utilização + Conversão real
      // (S/V/F, F/S), substituindo o antigo stub 'NO_TELEMETRY_SOURCE'
      // que sempre mostrava 'Pendente'. Fontes reais já existentes
      // (master_simulator_usage_data + master_admin_security_data),
      // nenhuma infraestrutura nova.
      return computeScuLookupRealConversion(rows);
    }
    return lookup;
  }

  // REAL_CONVERSION_MODE's own detail block -- Simulações/Vendas/
  // Financiamentos/F/S/Status comercial/Atenção (section 6 of the
  // approved rule), same .scCriterion markup as every other criterion.
  function scuConversionCriterionHtml(entry) {
    var u = entry.u;
    if (!u.disponivel) {
      var estado = entry.loading ? 'Carregando'
        : entry.fetchFailed ? 'Fonte indisponível'
        : entry.usageStatus === 'AMBIGUO' ? 'Vínculo ambíguo'
        : entry.usageStatus === 'SEM_VINCULO_COMPROVADO' ? 'Vínculo não comprovado'
        : entry.usageStatus === 'SEM_COBERTURA_TELEMETRIA' ? 'Sem cobertura de telemetria'
        : entry.usageStatus === 'IDENTIDADE_INDISPONIVEL' ? 'Fonte de identidade indisponível'
        : 'Indisponível';
      var motivo = entry.loading ? 'Buscando dados reais de utilização e identidade — a tabela será atualizada automaticamente.'
        : entry.fetchFailed ? 'Falha ao buscar a fonte real de utilização. Não foi convertida em zero — tente novamente.'
        : entry.usageStatus === 'AMBIGUO' ? 'Mais de um vendedor ativo com o mesmo nome e loja — não é possível atribuir com segurança.'
        : entry.usageStatus === 'SEM_VINCULO_COMPROVADO' ? 'Vínculo com o simulador ainda não comprovado para este vendedor.'
        : entry.usageStatus === 'SEM_COBERTURA_TELEMETRIA' ? 'Período selecionado é anterior ao início real da coleta de telemetria.'
        : entry.usageStatus === 'IDENTIDADE_INDISPONIVEL' ? 'Não foi possível confirmar a identidade real do vendedor nesta carga.'
        : 'Dados de utilização indisponíveis.';
      return '<div class="scCriterion scExpCriterion">' +
        '<div class="scCriterionTop"><span class="scCriterionName">Utilização + Conversão</span><span class="scCriterionPoints">— / 100 pts</span></div>' +
        '<div class="scCriterionMeta"><span>' + esc(estado) + ' — ' + esc(motivo) + '</span></div>' +
        '</div>';
    }
    var widthPct = Math.max(0, Math.min(100, u.utilizacaoPontos));
    var CONV = window.NX_SCORE_CONVERSION_VM;
    var statusLabel = (CONV && CONV.STATUS_LABELS[entry.convStatus]) || entry.convStatus;
    var penetracao = entry.V > 0 ? fmtPctOrDash(entry.F / entry.V) : '—';
    return '<div class="scCriterion scExpCriterion">' +
      '<div class="scCriterionTop"><span class="scCriterionName">Utilização + Conversão</span><span class="scCriterionPoints">' + fmtRatioOrDash(u.utilizacaoPontos, 1) + ' / 100 pts</span></div>' +
      '<div class="scCriterionMeta"><span>Conversão: ' + fmtRatioOrDash(u.conversaoPontos, 1) + ' / 70 pts · Utilização: ' + fmtRatioOrDash(u.utilizacaoSubPontos, 1) + ' / 30 pts · Total do critério: ' + fmtRatioOrDash(u.utilizacaoPontos, 1) + ' / 100 pts</span></div>' +
      '<div class="scCriterionMeta"><span>Vendas: ' + entry.V + ' · Financiamentos: ' + entry.F + ' · Simulações: ' + entry.S + ' · Penetração F/V: ' + penetracao + '</span></div>' +
      '<div class="scMeter"><span style="width:' + widthPct.toFixed(1) + '%"></span></div>' +
      '<p class="scAmostraNote">Referência de utilização: 2 simulações por venda.</p>' +
      (entry.gapAdjusted ? '<p class="scAmostraNote">Dias sem dados de utilização excluídos do cálculo (' + esc((entry.excluded || []).map(function (x) { return x.start.split('-').reverse().join('/') + (x.end !== x.start ? ' a ' + x.end.split('-').reverse().join('/') : ''); }).join(', ')) + '): utilização medida com ' + entry.S + ' simulação(ões) e ' + entry.Vd + ' venda(s) dos dias com dados; conversão no período inteiro.</p>' : '') +
      '<p class="scAmostraNote">Status comercial: ' + esc(statusLabel) + (entry.atencao ? ' <span class="sciMuted">(marcação Atenção)</span>' : '') + (u.inconsistente ? ' <span class="sciMuted">— financiamentos acima das vendas: possível inconsistência comercial</span>' : '') + '</p>' +
      '<p class="scAmostraNote">Relação agregada por vendedor, departamento e período — não indica que uma simulação específica originou um financiamento específico.</p>' +
      '</div>';
  }

  // The "Utilização dos Simuladores" criterion (Frequência/Diversidade,
  // DEMO_MODE/LOCAL_REAL_MODE only), rendered with the EXACT SAME
  // .scCriterion markup as every real commercial criterion (Gate: same
  // visual identity, never a separate panel) -- appended as the LAST
  // item of the SAME criteria list in renderDetail().
  function scuCriterionHtml(key) {
    if (!scuLookup) return '';
    var entry = scuLookup[key];
    if (!entry) return '';
    if (scuMode === 'REAL_CONVERSION_MODE' || scuMode === 'DEMO_MODE') return scuConversionCriterionHtml(entry);
    var u = entry.u;
    if (!u.disponivel) {
      var estado = entry.loading ? 'Carregando'
        : entry.fetchFailed ? 'Fonte indisponível'
        : (entry.usageStatus === 'SEM_VINCULO_COMPROVADO' || entry.usageStatus === 'AMBIGUO') ? 'Sem vínculo comprovado'
        : 'Pendente de integração';
      var motivo = entry.loading ? 'Buscando eventos reais da telemetria local — a tabela será atualizada automaticamente.'
        : entry.fetchFailed ? 'Falha ao buscar a fonte local de telemetria. Não foi convertida em zero — tente novamente.'
        : entry.usageStatus === 'SEM_VINCULO_COMPROVADO' ? 'Vínculo com o simulador ainda não comprovado para este vendedor.'
        : entry.usageStatus === 'AMBIGUO' ? 'Vínculo ambíguo (mais de uma identidade possível) — não é possível atribuir com segurança.'
        : 'Fonte real de eventos de prova de cálculo ainda não conectada à produção.';
      return '<div class="scCriterion scExpCriterion">' +
        '<div class="scCriterionTop"><span class="scCriterionName">Utilização dos Simuladores</span><span class="scCriterionPoints">— / 100 pts</span></div>' +
        '<div class="scCriterionMeta"><span>' + esc(estado) + ' — ' + esc(motivo) + '</span></div>' +
        '</div>';
    }
    var widthPct = Math.max(0, Math.min(100, u.utilizacaoPontos));
    return '<div class="scCriterion scExpCriterion">' +
      '<div class="scCriterionTop"><span class="scCriterionName">Utilização dos Simuladores</span><span class="scCriterionPoints">' + u.utilizacaoPontos + ' / 100 pts</span></div>' +
      '<div class="scCriterionMeta"><span>Frequência: ' + u.frequenciaPontos + '/60 · Diversidade: ' + u.diversidadePontos + '/40</span></div>' +
      '<div class="scMeter"><span style="width:' + widthPct.toFixed(1) + '%"></span></div>' +
      '<p class="scAmostraNote">Eventos elegíveis distintos: ' + u.eventosConsiderados + ' · Motores distintos elegíveis: ' + u.modalidadesConsideradas.length + ' (' + esc(u.modalidadesConsideradas.join(', ') || '—') + ')' +
      ' · Eventos rejeitados: ' + (entry.eventosRejeitados || 0) +
      ' · Eventos bloqueados operacionalmente: ' + (entry.eventosOperacionalmenteBloqueados || 0) +
      ' · Duplicatas ignoradas: ' + (entry.duplicatasIgnoradas || 0) +
      (u.eventosExcluidosPorSuspeitaDeDuplicidade ? ' · Excluídos por suspeita de dupla instrumentação: ' + u.eventosExcluidosPorSuspeitaDeDuplicidade : '') +
      '</p>' +
      '</div>';
  }

  // RESTAURAÇÃO DE FILTROS -- opções de loja SEMPRE derivadas das
  // PRÓPRIAS linhas do período carregado (allRows, ainda não filtrado
  // por loja/departamento) -- nunca uma lista hardcoded, nunca oferece
  // uma loja que o backend não tenha autorizado/retornado para este
  // usuário neste período.
  function distinctLojas(rows) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (r) {
      if (!seen[r.loja]) { seen[r.loja] = true; out.push(r.loja); }
    });
    out.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    return out;
  }
  function refreshLojaFilterOptions(allRows) {
    var sel = document.getElementById('scLojaFilter');
    if (!sel) return;
    var lojas = distinctLojas(allRows);
    lojaFilterAdjusted = false;
    // Se a loja selecionada deixou de existir neste período (ex.: troca
    // de período), o escopo autorizado é aplicado automaticamente
    // (volta para "Todas as lojas") e o ajuste é indicado ao usuário --
    // nunca mantém, silenciosamente, um filtro que já não corresponde a
    // nenhuma linha autorizada.
    if (currentLojaFilter !== 'ALL' && lojas.indexOf(currentLojaFilter) === -1) {
      currentLojaFilter = 'ALL';
      lojaFilterAdjusted = true;
    }
    sel.innerHTML = '<option value="ALL">Todas as lojas</option>' + lojas.map(function (l) {
      return '<option value="' + esc(l) + '"' + (l === currentLojaFilter ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
    sel.value = currentLojaFilter;
    var note = document.getElementById('scLojaAdjustedNote');
    if (note) note.style.display = lojaFilterAdjusted ? '' : 'none';
  }

  function renderPanel(allRows) {
    // RESTAURAÇÃO DE FILTROS -- allRows é o resultado COMPLETO do
    // período (calcScores() inteiro, nunca filtrado) -- usado para
    // derivar as opções de loja disponíveis; currentRows (usado pela
    // tabela/detalhamento/Utilização+Conversão abaixo) é sempre o
    // subconjunto já filtrado por Departamento/Loja, nunca o inverso.
    refreshLojaFilterOptions(allRows);
    var rows = applyRowFilters(allRows);
    currentRows = rows;

    // SCORE-SIM-17 -- computed FIRST, synchronously (no real network
    // call exists for this dimension in either mode -- demo mode is
    // pure local computation, real mode is a static honest placeholder)
    // so the table/detail below can render the unified composition in
    // a single pass, never a second table painted after the fact.
    scuLookup = computeScuLookup(rows);

    // UAT FINAL -- detalhe agora é renderizado INLINE por renderTable()
    // (imediatamente após a linha/cartão selecionado), nunca mais numa
    // região separada no fim da página.
    var tableHtml = renderTable(currentRows, currentDetailKey);
    document.getElementById('scTableRegion').innerHTML = tableHtml;

    wireTableInteraction();
  }

  function render() {
    if (!isRealTransport()) {
      var fixtureSelect = document.getElementById('scFixtureSelect');
      var currentId = fixtureSelect ? fixtureSelect.value : FIXTURE_IDS[0];
      var caseData = fixturesData.filter(function (c) { return c.id === currentId; })[0];
      renderPanel(window.NX_SCORE_ADAPTER.compute(caseData.sales, caseData.fins));
      return;
    }
    // Gate 6: invalid contract -> no request, local error only.
    var filterErr = dateContractError();
    if (filterErr) {
      if (currentAbortController) currentAbortController.abort();
      ++renderSeq;
      var badRegion = document.getElementById('scTableRegion');
      if (badRegion) badRegion.innerHTML = invalidFilterHtml(filterErr);
      currentDetailKey = null;
      // SCORE-SIM-17 -- same rule: the unified table already shows
      // the invalid-filter error via badRegion above (Utilização is
      // now a column/criterion inside that SAME table, not a separate
      // region), so clearing scuLookup here just prevents a stale
      // lookup from leaking into a later render.
      scuMode = 'IDLE';
      scuLookup = null;
      // SCORE-SIM-22 -- abort any in-flight local-real fetch too, and
      // bump the sequence so its resolution (if it lands after all)
      // is discarded as stale rather than repainting a table that no
      // longer matches this invalid-filter state.
      if (scuAbortController) scuAbortController.abort();
      ++scuAsyncSeq;
      scuRealCache = null;
      return;
    }
    if (realResult) { renderPanel(realResult); return; }
    loadReal();
  }

  // Fetch -> validated raw payload -> minimal field mapping + canonical
  // familiaModelo() (score-real-view-model.js) -> existing
  // normalizeFinInput() + FROZEN calcScores() (NX_SCORE_ADAPTER.compute,
  // untouched) -> existing presentation. No calculation happens in this
  // file or in the view-model (Gate: PROIBIDO duplicar calcScores()).
  // Gate 7: every valid period change reaches this function via
  // realResult=null (set by the filter handlers below) -- no partial
  // recompute, no client-side filtering of a previous period's dataset.
  function loadReal() {
    if (currentAbortController) currentAbortController.abort();
    var controller = new AbortController();
    currentAbortController = controller;
    var mySeq = ++renderSeq;
    var region = document.getElementById('scTableRegion');
    if (region) region.innerHTML = loadingHtml();

    window.NX_SCORE_REAL_PROVIDER.loadScoreReal({ start: currentDateStart, end: currentDateEnd, signal: controller.signal }).then(
      function (payload) {
        if (mySeq !== renderSeq) return;
        var mapped;
        try {
          mapped = window.NX_SCORE_REAL_VIEW_MODEL.buildRealResult(payload);
        } catch (e) {
          var r2 = document.getElementById('scTableRegion');
          if (r2) r2.innerHTML = errorStateHtml(e && e.state, e && e.message);
          return;
        }
        realResult = window.NX_SCORE_ADAPTER.compute(mapped.sales, mapped.fins);
        // RESTAURAÇÃO DE FILTROS -- item 4: retém o payload CRU (nunca
        // o mapped, que já perdeu operation_reference/model/valores)
        // exclusivamente para "Ver vendas detalhadas". Mesma requisição
        // já feita para o Score oficial -- nenhuma chamada nova.
        rawScorePayload = payload;
        renderPanel(realResult);
      },
      function (err) {
        if (mySeq !== renderSeq) return;
        if (err && err.state === 'ABORTED') return; // not a user-facing error -- superseded request
        // V2-SECURITY-02 (SEC-06): delegate to Auth Foundation's own
        // established session-expiry handling (auth-core.js) instead of
        // just showing a local "sessão expirada" message and stopping
        // there -- same pattern gestao.js already uses. Only a
        // classified SESSION_EXPIRED reaches here; the mySeq guard above
        // already discards late/superseded responses first, so this
        // never fires for a request the user has since moved past.
        if (err && err.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
          window.NX_AUTH_CORE.reportSessionExpired();
          return;
        }
        var region2 = document.getElementById('scTableRegion');
        if (region2) region2.innerHTML = errorStateHtml(err && err.state, err && err.message);
      }
    );
  }

  // Gate 11 (critical): any period change closes an open detail rather
  // than risk pairing a stale breakdown with the new period's ranking --
  // deterministic, matches Coparticipado's own real-mode date-change
  // handlers (realResult=null + re-render) plus this file's own
  // openDetail/closeDetail contract.
  function onPeriodChanged() {
    currentDetailKey = null;
    realResult = null;
    rawScorePayload = null;
    currentSalesDetailKey = null;
    expandedOperationRef = null;
    render();
  }

  function applyPresetAndRender(preset) {
    var computed = computePreset(preset);
    if (!computed) return;
    currentPreset = preset;
    currentDateStart = computed.start;
    currentDateEnd = computed.end;
    var dsEl = document.getElementById('scDateStart');
    var deEl = document.getElementById('scDateEnd');
    if (dsEl) dsEl.value = currentDateStart;
    if (deEl) deEl.value = currentDateEnd;
    document.querySelectorAll('.scPresetBtn').forEach(function (b) { b.classList.toggle('modSegItemActive', b.dataset.preset === preset); });
    onPeriodChanged();
  }

  // Desktop and mobile ALWAYS both exist in the DOM simultaneously (CSS
  // media query hides whichever doesn't apply -- score.css, unchanged);
  // only one is ever actually visible. `offsetParent` is null on a
  // display:none ancestor, a cheap and reliable visibility check that
  // never depends on layout timing.
  function firstVisible(elements) {
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].offsetParent !== null) return elements[i];
    }
    return elements[0] || null;
  }

  function openDetail(key) {
    currentDetailKey = key;
    // RESTAURAÇÃO DE FILTROS -- item 4: trocar de vendedor sempre fecha
    // qualquer lista de vendas detalhadas que estivesse aberta (nunca
    // mistura a lista de um vendedor com o cabeçalho de outro).
    currentSalesDetailKey = null;
    expandedOperationRef = null;
    render();
    var closeBtn = firstVisible(document.querySelectorAll('.scCloseDetail'));
    if (closeBtn) closeBtn.focus();
  }
  function closeDetail(returnFocusKey) {
    currentDetailKey = null;
    currentSalesDetailKey = null;
    expandedOperationRef = null;
    render();
    if (returnFocusKey) {
      var row = firstVisible(document.querySelectorAll(
        '.scTable tbody tr[data-key="' + CSS.escape(returnFocusKey) + '"], .scMobileCard[data-key="' + CSS.escape(returnFocusKey) + '"]'
      ));
      if (row) row.focus();
    }
  }

  function wireTableInteraction() {
    // :not(.scDetailRow) -- the inline detail row (UAT FINAL) lives
    // INSIDE the same <tbody>/list as the real rows; it must never be
    // wired as if it were a clickable vendor row itself (it has no
    // data-key, only data-detail-key), or clicking anywhere inside an
    // open detail panel would wrongly call openDetail(null).
    document.querySelectorAll('.scTable tbody tr:not(.scDetailRow), .scMobileCard').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-key')); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-key')); }
      });
    });
    // Desktop and mobile detail variants each carry their own
    // #scCloseDetail-desktop/-mobile id (never duplicated in the DOM at
    // once) -- both need wiring since both exist whenever a detail is
    // open, even though only one is visible.
    document.querySelectorAll('.scCloseDetail').forEach(function (closeBtn) {
      closeBtn.addEventListener('click', function () { closeDetail(currentDetailKey); });
      closeBtn.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDetail(currentDetailKey);
      });
    });
    // RESTAURAÇÃO DE FILTROS -- item 4: "Ver vendas detalhadas" e o
    // toggle de cada operação individual vivem DENTRO de .scDetailRow/
    // .scMobileDetailWrap (irmãos do <tr>/.scMobileCard clicável, nunca
    // descendentes) -- clicar neles não aciona openDetail por bolha de
    // evento, mesma garantia estrutural já usada por .scCloseDetail.
    document.querySelectorAll('.scSalesDetailToggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        currentSalesDetailKey = (currentSalesDetailKey === key) ? null : key;
        expandedOperationRef = null;
        render();
      });
    });
    document.querySelectorAll('.scSalesOpToggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ref = btn.getAttribute('data-op-ref');
        expandedOperationRef = (expandedOperationRef === ref) ? null : ref;
        render();
      });
    });
  }

  window.NX_SCORE_PAGE = {
    // PORTAL-NEXT-07.7B — exposed read-only for deterministic band
    // boundary/invalid-input testing (tests/score-band-test.py), same
    // pattern already used for window.NX_SCORE_ADAPTER's business
    // functions. Returns {min,max,label,cls} or null -- never a bare
    // string -- so a test can assert on `.label` explicitly rather
    // than guessing a return shape.
    classifyScoreBand: classifyScoreBand,
    // Gate 20/21 (Phase 2A): the dev-only fixture selector must never
    // appear in real mode, same isRealTransport()-gated shell principle
    // already used by gestao.js/dashbi.js/coparticipado.js.
    render: function (outlet) {
      // RESTAURAÇÃO DE FILTROS -- item 1: aplica o período padrão (mês
      // atual até hoje) ANTES de montar o HTML dos filtros, para que os
      // inputs de data já nasçam com o valor correto (nunca um segundo
      // render silencioso depois). No-op em re-entradas na mesma sessão
      // (dateDefaultInitialized) e em modo fixture.
      ensureDefaultPeriod();
      // Gate 3/16 (Phase 2B): reuses the exact canonical filter-bar
      // pattern already homologated in dashbi.js/gestao.js (.modFilters/
      // .modField wrapper, shared .modSegmentedGroup/.modSegItem preset
      // control, <input type="date"> pair) -- zero new CSS, zero
      // redesign. Real-mode only: fixture mode is scenario-based (12
      // canned cases with no per-record date field, Phase 1/2A), so a
      // period picker has nothing to filter there.
      function periodFilterHtml() {
        return '<div class="modFilters">' +
          '<div class="modField"><label>Período rápido</label><div class="modSegmentedGroup">' +
          '<button type="button" class="modSegItem scPresetBtn" data-preset="currentMonth">Mês atual</button>' +
          '<button type="button" class="modSegItem scPresetBtn" data-preset="lastMonth">Mês anterior</button>' +
          '<button type="button" class="modSegItem scPresetBtn" data-preset="last6">Últimos 6 meses</button>' +
          '<button type="button" class="modSegItem scPresetBtn" data-preset="lastYear">Último ano</button>' +
          '</div></div>' +
          '<div class="modField"><label for="scDateStart">Data inicial</label><input id="scDateStart" type="date" value="' + esc(currentDateStart) + '"></div>' +
          '<div class="modField"><label for="scDateEnd">Data final</label><input id="scDateEnd" type="date" value="' + esc(currentDateEnd) + '"></div>' +
          '<div class="modField"><label>Departamento</label><div class="modSegmentedGroup">' +
          '<button type="button" class="modSegItem scDeptBtn modSegItemActive" data-dept="ALL">Todos</button>' +
          '<button type="button" class="modSegItem scDeptBtn" data-dept="Novos">Novos</button>' +
          '<button type="button" class="modSegItem scDeptBtn" data-dept="Seminovos">Seminovos</button>' +
          '</div></div>' +
          '<div class="modField"><label for="scLojaFilter">Loja</label><select id="scLojaFilter"><option value="ALL">Todas as lojas</option></select>' +
          '<span id="scLojaAdjustedNote" class="scFilterAdjustedNote" style="display:none">Loja selecionada indisponível neste período/departamento — mostrando todas as lojas autorizadas.</span>' +
          '</div>' +
          '</div>';
      }

      function wireFilterEvents() {
        document.getElementById('scDateStart').addEventListener('change', function (e) {
          currentDateStart = e.target.value;
          currentPreset = 'CUSTOM';
          document.querySelectorAll('.scPresetBtn').forEach(function (b) { b.classList.remove('modSegItemActive'); });
          onPeriodChanged();
        });
        document.getElementById('scDateEnd').addEventListener('change', function (e) {
          currentDateEnd = e.target.value;
          currentPreset = 'CUSTOM';
          document.querySelectorAll('.scPresetBtn').forEach(function (b) { b.classList.remove('modSegItemActive'); });
          onPeriodChanged();
        });
        document.querySelectorAll('.scPresetBtn').forEach(function (btn) {
          btn.addEventListener('click', function () { applyPresetAndRender(btn.dataset.preset); });
        });
        // RESTAURAÇÃO DE FILTROS -- Departamento/Loja NUNCA disparam uma
        // nova busca (os dados do período já estão carregados em
        // realResult) -- apenas re-filtram/re-renderizam localmente,
        // preservando o detalhamento aberto quando a linha selecionada
        // continua visível após o filtro.
        document.querySelectorAll('.scDeptBtn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            currentDepartmentFilter = btn.dataset.dept;
            document.querySelectorAll('.scDeptBtn').forEach(function (b) { b.classList.toggle('modSegItemActive', b === btn); });
            currentSalesDetailKey = null;
            expandedOperationRef = null;
            render();
          });
        });
        document.getElementById('scLojaFilter').addEventListener('change', function (e) {
          currentLojaFilter = e.target.value;
          currentSalesDetailKey = null;
          expandedOperationRef = null;
          render();
        });
      }

      function paintShell(isFixtureMode) {
        currentDetailKey = null;
        var fixtureBanner = '';
        if (isFixtureMode) {
          var options = FIXTURE_IDS.map(function (id) { return '<option value="' + id + '">' + id + '</option>'; }).join('');
          fixtureBanner = '<div class="modFixtureBanner"><span class="modFixtureLabel">DADOS DE TESTE (NEXT_LOCAL)</span>' +
            '<label for="scFixtureSelect">fixture:</label>' +
            '<select id="scFixtureSelect">' + options + '</select></div>';
        }
        outlet.innerHTML =
          '<div class="scPage">' +
          '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Análise de Score Vendedores</h1><p class="modSubtitle">Ranking de performance F&amp;I por vendedor.</p></div></div>' +
          fixtureBanner +
          (isFixtureMode ? '' : periodFilterHtml()) +
          '<div id="scTableRegion"></div>' +
          '</div>';
        if (isFixtureMode) {
          document.getElementById('scFixtureSelect').addEventListener('change', render);
        } else {
          wireFilterEvents();
          // RESTAURAÇÃO DE FILTROS -- item 1: reflete currentPreset (já
          // aplicado por ensureDefaultPeriod() acima) no botão
          // correspondente logo após montar o shell, para que "Mês
          // atual" apareça visualmente ativo de imediato -- mesmo
          // padrão do próprio applyPresetAndRender().
          document.querySelectorAll('.scPresetBtn').forEach(function (b) { b.classList.toggle('modSegItemActive', b.dataset.preset === currentPreset); });
        }
        render();
      }

      if (isRealTransport()) {
        paintShell(false);
        return Promise.resolve();
      }
      return loadFixtures().then(function () { paintShell(true); });
    }
  };
})();
