/* PORTAL-NEXT V2 -- Coparticipado module UI.
   Business logic: assets/js/adapters/coparticipado.adapter.js (byte-
   identical extraction -- see docs/COPARTICIPADO-ENGINE-AUDIT.md and
   docs/COPARTICIPADO-EXTRACTION-TRACE.md). This file only renders.

   Real production surface migrated (verified by direct source read of
   origin/main:modules/coparticipado.html, function renderCopa/
   renderSubsidiados/coparViewSwitcherHtml, lines ~548-566):
     - the "Visão Coparticipados" / "Visão Subsidiados" view switcher
       (Fase UX-Grupo-3.0, Item 3 -- both views share DATA.fins and the
       same r.plano field, no new classification)
     - Coparticipados table: Cliente/Vendedor/Loja/Modelo Base/Modelo
       Taxa/Valor Financiado/Rebate Total/Parte Brabus/Valor Rebate
       Total/Coparticipação/Situação/Data/Chassi (exact column order)
     - Subsidiados table + its 3-stat summary (Operações/Lojas/
       Vendedores) -- exact production text
     - Loja + date-range filters, same predicate as currentFiltered()
       (FC-2.4: Departamento's Grupo/Novos/Seminovos selector removed by
       Human product decision -- this module is NOVOS-only now, fixed in
       applyFilters(), not user-selectable; see that function's own comment)

   NOT migrated (Gate 57 deferred, real reasons -- see
   docs/COPARTICIPADO-EXTRACTION-TRACE.md):
     - "Diagnóstico" tab (renderVendorAlerts/collectUnknownVendors) --
       a vendor-registry data-quality feature orthogonal to the
       classification/crossing/exclusion/priority/filter/sort surface
       this Wave scopes; needs the real vendor registry backend.
     - openSellerDetails/openScoreDetails/the embedded stale calcScores
       -- confirmed DEAD CODE in production (no tab/section wires them
       into the real UI; #novos/#score are never shown, renderNovos()
       is a no-op). Not migrated, same as Score's own stale-code
       finding.
     - Row-level drill-down modal -- NOT APPLICABLE. Production's own
       Coparticipados/Subsidiados tables have no per-row detail modal;
       the row already IS the finest real granularity (one financing
       operation). No drill-down was invented here.
     - Export to Excel (exportarCoparticipados/exportarSubsidiados) --
       DEFERRED DEPENDENCY (needs xlsx-js-style, a real file-download
       flow; 0 backend/0 file I/O this Wave, same boundary as the
       Base01/02/03 Excel parsing already deferred in the audit doc). */
(function () {
  'use strict';

  var fixturesData = null;
  var currentFixtureId = 'ALL';
  var currentView = 'COPARTICIPADO'; // matches production's currentCoparView default
  var currentStore = '';
  var currentDateStart = '';
  var currentDateEnd = '2026-12-31';
  // FC-2.4 (Human product decision): this module is NOVOS-only -- the
  // Departamento selector (Grupo/Novos/Seminovos) is removed from the UI.
  // The RPC/fixture pipeline returns BOTH departments indiscriminately (no
  // server-side department parameter exists, confirmed FC-2.1/2.2), so
  // Novos-only is enforced here, in applyFilters() -- a fixed business
  // filter, not a client-side authorization boundary (Gate 28's own
  // distinction). currentDept is gone; there is no longer a variable
  // dimension to hold.
  var currentPreset = 'CUSTOM';

  // Coparticipado Phase 2 (Real Data Integration Foundation) -- the ONE
  // place transport is decided, same rule as gestao.js/dashbi.js's own
  // isRealTransport(). renderSeq/realResult/currentAbortController guard
  // against a stale or superseded async response overwriting a newer
  // one; date-range changes invalidate realResult and abort any
  // in-flight request (Gate 12 -- this is a new provider, so proper
  // cancellation is used from the start rather than retrofitted).
  function isRealTransport() {
    return !!(window.NX_AUTH && window.NX_AUTH.isAuthConfigured);
  }
  var renderSeq = 0;
  var realResult = null;
  var currentAbortController = null;
  // FC-2.3 (GAP-003 export, relocated here from Score after Human UAT
  // corrected product placement): the SAME already-filtered fins
  // renderPanel() computes for the on-screen table -- export reads this,
  // never a second fetch/filter pass, so it always represents exactly
  // what the Loja/Departamento/Data filters currently show.
  var currentFilteredFins = [];
  var lastCpExportAt = 0;

  var STATE_COPY = {
    PERMISSION_DENIED: { title: 'Sem permissão', body: 'Sua conta não tem acesso a esta análise.' },
    INVALID_FILTER: { title: 'Filtro inválido', body: 'Verifique o período selecionado.' },
    BACKEND_ERROR: { title: 'Não foi possível carregar', body: 'Não foi possível carregar esse período. Tente selecionar um intervalo menor ou tente novamente.' },
    SESSION_EXPIRED: { title: 'Sessão expirada', body: 'Entre novamente para continuar.' }
  };
  function loadingHtml() {
    return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando indicadores...</div>';
  }
  function errorStateHtml(state, message) {
    var copy = STATE_COPY[state] || STATE_COPY.BACKEND_ERROR;
    return '<div class="modErrorState"><div class="modStateTitle">' + esc(copy.title) + '</div>' + esc(copy.body) + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  function loadFixtures() {
    if (fixturesData) return Promise.resolve(fixturesData);
    return fetch('tests/fixtures/coparticipado-fixtures.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { fixturesData = data.cases; return fixturesData; });
  }

  // "ALL" combines every fixture case's raw rows into one input, so the
  // Loja/Departamento/date filters and multi-scenario sort/total
  // behavior have real, varied data to operate over (any single case
  // is deliberately narrow -- one classification scenario each).
  // Individual cases remain selectable for isolated stress inspection
  // (Gate 43's Fixture Studio requirement).
  function buildFixtureInput(id) {
    if (id !== 'ALL') {
      var c = fixturesData.filter(function (x) { return x.id === id; })[0];
      return { vendorRows: c.vendorRows, taxasCopart: c.taxasCopart, b1Rows: c.b1Rows, b2Rows: c.b2Rows, b3Rows: c.b3Rows };
    }
    var vendorRows = [], taxasCopart = {}, b1Rows = [], b2Rows = [], b3Rows = [];
    var seenVendor = {};
    fixturesData.forEach(function (c) {
      (c.vendorRows || []).forEach(function (v) {
        var k = v.NBS || v.Nome;
        if (seenVendor[k]) return;
        seenVendor[k] = true;
        vendorRows.push(v);
      });
      Object.assign(taxasCopart, c.taxasCopart || {});
      b1Rows = b1Rows.concat(c.b1Rows || []);
      b2Rows = b2Rows.concat(c.b2Rows || []);
      b3Rows = b3Rows.concat(c.b3Rows || []);
    });
    return { vendorRows: vendorRows, taxasCopart: taxasCopart, b1Rows: b1Rows, b2Rows: b2Rows, b3Rows: b3Rows };
  }

  // Same predicate as production's currentFiltered() (origin/main,
  // line ~491): dateIn() is the byte-identical extracted function;
  // store equality is copied verbatim from that same function's own
  // filter logic (no new rule invented). FC-2.4: the department leg of
  // that original predicate (currentDept !== 'Grupo' && r.dept !==
  // currentDept) is replaced with a FIXED r.dept === 'Novos' requirement
  // -- this module's own product scope (Gate 26-29), not a reproduction
  // of a user-selectable production filter.
  function applyFilters(fins) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    var start = currentDateStart ? A.parseDate(currentDateStart) : null;
    var end = currentDateEnd ? A.parseDate(currentDateEnd) : null;
    return fins.filter(function (r) {
      if (!A.dateIn(r, start, end)) return false;
      if (currentStore && r.loja !== currentStore) return false;
      if (r.dept !== 'Novos') return false;
      return true;
    });
  }

  // FC-2.4 (Gate 22): local-calendar-date formatting -- NEVER
  // .toISOString(), which shifts the calendar date for hosts whose local
  // timezone sits ahead of UTC (the latent defect already present in both
  // dashbi.js's applyPresetAndRender() and score.js's computePreset(),
  // neither fixed here per this Wave's own explicit "do not fix Score's
  // defect" boundary -- this is a NEW, independent, safe implementation
  // for this module only). Mirrors score.js's own already-safe todayIso()
  // pattern (getFullYear/getMonth/getDate, manually padded), generalized
  // to format any Date, not just "today".
  function localIso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // FC-2.4 (Gate 19-21): SAME calendar math already shared by dashbi.js's
  // applyPresetAndRender()/score.js's computePreset() (currentMonth = 1st
  // of this month -> today; lastMonth = full previous calendar month;
  // last6 = 1st of the month 5 months back -> today, a ROLLING window,
  // not 6 full calendar months) -- only the unsafe .toISOString() output
  // step is replaced with localIso() above. Genuine new Date() (not a
  // fixed fixture reference date): this module's own fixture mode is
  // scenario-based (fixture IDs), not date-driven, same reasoning already
  // established for Score's own computePreset().
  function computePreset(preset) {
    var today = new Date();
    var start, end = today;
    if (preset === 'currentMonth') start = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (preset === 'lastMonth') { start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); }
    else if (preset === 'last6') start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    if (!start) return null;
    return { start: localIso(start), end: localIso(end) };
  }

  function applyPresetAndRender(preset) {
    var computed = computePreset(preset);
    if (!computed) return;
    currentPreset = preset;
    currentDateStart = computed.start;
    currentDateEnd = computed.end;
    var dsEl = document.getElementById('cpDateStart');
    var deEl = document.getElementById('cpDateEnd');
    if (dsEl) dsEl.value = currentDateStart;
    if (deEl) deEl.value = currentDateEnd;
    document.querySelectorAll('.cpPresetBtn').forEach(function (b) { b.classList.toggle('modSegItemActive', b.dataset.preset === preset); });
    realResult = null; // period changed -- server scope itself changes, must refetch
    render();
  }

  // PORTAL-NEXT-07.6 — CP_TABLE_COLUMNS centralizes each table's header
  // labels so both the <thead> and every <td>'s data-th (consumed only
  // by the <=900px vertical-record recomposition in coparticipado.css)
  // come from one list — same order, same wording, nothing renamed.
  var CP_COPART_HEADERS = ['Cliente', 'Vendedor', 'Loja', 'Modelo Base', 'Modelo Taxa', 'Valor Financiado', 'Rebate Total', 'Parte Brabus', 'Valor Rebate Total', 'Coparticipação', 'Situação', 'Data', 'Chassi'];
  var CP_SUBS_HEADERS = ['Cliente', 'Vendedor', 'Loja', 'Departamento', 'Modelo', 'Valor Financiado', 'Retorno', 'SPF Extra', 'Situação', 'Data', 'Chassi'];
  // Wave 3C — presentation-only metadata, parallel to *_HEADERS (same
  // index = same column). Drives the <=900px responsive card grouping
  // (module-system.css) via a data-group attribute per cell; 0 effect
  // on cell content, order, or count. "primary"/"status" are styled by
  // attribute selector (table-shape-independent); the commercial/
  // vehicle/financial/reference band dividers use nth-child, scoped by
  // the .cpTableCopart/.cpTableSubs modifier class below (column counts
  // differ between the two tables, so their divider positions do too).
  var CP_COPART_GROUPS = ['primary', 'commercial', 'commercial', 'vehicle', 'vehicle', 'financial', 'financial', 'financial', 'financial', 'financial', 'status', 'reference', 'reference'];
  var CP_SUBS_GROUPS = ['primary', 'commercial', 'commercial', 'commercial', 'vehicle', 'financial', 'financial', 'financial', 'status', 'reference', 'reference'];
  // PORTAL-NEXT-07.6 — atomic values (currency/percentage/date/chassi)
  // must never break mid-token (Gate 26/56); table-layout:fixed only
  // reads column widths from the FIRST row's cells, so a <colgroup>
  // floor here is what actually protects them once Cliente/Vendedor's
  // long text starts wrapping across several lines and would otherwise
  // squeeze every other column below its safe width. Text columns
  // (Cliente/Vendedor/Loja/Modelo/Departamento/Situação) are left
  // unconstrained — they wrap safely, sharing whatever width remains.
  var CP_FLOOR_PX = { 'Valor Financiado': 104, 'Rebate Total': 66, 'Parte Brabus': 66, 'Valor Rebate Total': 104, 'Coparticipação': 104, 'Retorno': 84, 'SPF Extra': 84, 'Data': 92, 'Chassi': 96 };
  function cpColGroup(headers) {
    return '<colgroup>' + headers.map(function (h) { return CP_FLOOR_PX[h] ? '<col style="width:' + CP_FLOOR_PX[h] + 'px">' : '<col>'; }).join('') + '</colgroup>';
  }
  function cpHeadRow(headers) { return '<tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>'; }

  function renderCoparticipadosTable(fins) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    var rows = fins.filter(function (r) { return r.plano === 'COPARTICIPADO'; });
    var h = CP_COPART_HEADERS, g = CP_COPART_GROUPS;
    var body = rows.map(function (r) {
      var c = r.coparticipacaoDetalhe || A.calcCoparticipacaoDetalhe(r);
      return '<tr>' +
        '<td data-th="' + h[0] + '" data-group="' + g[0] + '">' + esc(r.cliente) + '</td>' +
        '<td data-th="' + h[1] + '" data-group="' + g[1] + '">' + esc(r.vendedor) + '</td>' +
        '<td data-th="' + h[2] + '" data-group="' + g[2] + '">' + esc(r.loja) + '</td>' +
        '<td data-th="' + h[3] + '" data-group="' + g[3] + '">' + esc(r.modelo) + '</td>' +
        '<td data-th="' + h[4] + '" data-group="' + g[4] + '">' + (c.modeloTabela ? esc(c.modeloTabela) : '<span class="cpWarn">Não encontrado</span>') + '</td>' +
        '<td class="modNumCol" data-th="' + h[5] + '" data-group="' + g[5] + '">' + A.money(r.valorFinanciado) + '</td>' +
        '<td class="modNumCol" data-th="' + h[6] + '" data-group="' + g[6] + '">' + (c.ok ? A.pct(c.rebateTotal) : '<span class="cpWarn">—</span>') + '</td>' +
        '<td class="modNumCol" data-th="' + h[7] + '" data-group="' + g[7] + '">' + (c.ok ? A.pct(c.parteBrabus) : '<span class="cpWarn">—</span>') + '</td>' +
        '<td class="modNumCol" data-th="' + h[8] + '" data-group="' + g[8] + '">' + (c.ok ? A.money(c.valorRebateTotal) : '<span class="cpWarn">—</span>') + '</td>' +
        '<td class="modNumCol cpHeadlineFin" data-th="' + h[9] + '" data-group="' + g[9] + '">' + (c.ok ? A.money(c.coparticipacao) : '<span class="cpWarn">Modelo não encontrado</span>') + '</td>' +
        '<td data-th="' + h[10] + '" data-group="' + g[10] + '"><span class="modBadge modBadgeNeutral">' + esc(r.situacaoB3 || '') + '</span></td>' +
        '<td class="modNumCol" data-th="' + h[11] + '" data-group="' + g[11] + '">' + esc(A.iso(r.data)) + '</td>' +
        '<td class="cpAtomic" data-th="' + h[12] + '" data-group="' + g[12] + '">' + esc(r.chassi) + '</td>' +
        '</tr>';
    }).join('');
    return '<h2>Planos Coparticipados</h2>' +
      '<p class="modMuted">Coparticipação calculada pela tabela <b>taxa coparticipado.xlsx</b>: Modelo × Rebate Total × Rebate Parte Brabus.</p>' +
      // FC-2.3 (GAP-003): restores V1's OWN Coparticipado module export
      // (exportarCoparticipados(), modules/coparticipado.html -- a real,
      // wired V1 production button, confirmed by direct source read; NOT
      // the separate, orphaned Score export this capability was briefly
      // and incorrectly placed under in FC-2/FC-2.2, corrected here by
      // Human UAT). Placed next to the Coparticipados dataset it
      // represents, only in this view -- never in Visão Subsidiados.
      '<div class="cpExportBar"><button type="button" class="modBtn modBtnGhost cpExportCopaBtn" id="cpExportCopaBtn">Exportar Coparticipados</button>' +
      '<span id="cpExportStatus" class="modMuted cpExportStatus" role="status" aria-live="polite"></span></div>' +
      '<div class="modTableWrap"><table class="modTable cpTableCopart">' + cpColGroup(h) +
      '<thead>' + cpHeadRow(h) + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="13" class="modMuted">Nenhum coparticipado encontrado no filtro atual.</td></tr>') + '</tbody></table></div>';
  }

  function renderSubsidiadosTable(fins) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    var rows = fins.filter(function (r) { return r.plano === 'SUBSIDIADO'; });
    var lojas = {}, vendedores = {};
    rows.forEach(function (r) { lojas[r.loja] = 1; vendedores[r.vendedor] = 1; });
    var h = CP_SUBS_HEADERS, g = CP_SUBS_GROUPS;
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td data-th="' + h[0] + '" data-group="' + g[0] + '">' + esc(r.cliente) + '</td>' +
        '<td data-th="' + h[1] + '" data-group="' + g[1] + '">' + esc(r.vendedor) + '</td>' +
        '<td data-th="' + h[2] + '" data-group="' + g[2] + '">' + esc(r.loja) + '</td>' +
        '<td data-th="' + h[3] + '" data-group="' + g[3] + '">' + esc(r.dept) + '</td>' +
        '<td data-th="' + h[4] + '" data-group="' + g[4] + '">' + esc(r.modelo) + '</td>' +
        '<td class="modNumCol" data-th="' + h[5] + '" data-group="' + g[5] + '">' + A.money(r.valorFinanciado) + '</td>' +
        '<td class="modNumCol" data-th="' + h[6] + '" data-group="' + g[6] + '">' + A.money(r.retorno) + '</td>' +
        '<td class="modNumCol" data-th="' + h[7] + '" data-group="' + g[7] + '">' + A.money(r.receitaSPF) + '</td>' +
        '<td data-th="' + h[8] + '" data-group="' + g[8] + '"><span class="modBadge modBadgeNeutral">' + esc(r.situacaoB3 || '') + '</span></td>' +
        '<td class="modNumCol" data-th="' + h[9] + '" data-group="' + g[9] + '">' + esc(A.iso(r.data)) + '</td>' +
        '<td class="cpAtomic" data-th="' + h[10] + '" data-group="' + g[10] + '">' + esc(r.chassi) + '</td>' +
        '</tr>';
    }).join('');
    return '<h2>Planos Subsidiados</h2>' +
      '<p class="modMuted">Todas as operações classificadas como <b>SUBSIDIADO</b> no período (mesma regra oficial já usada nos indicadores do Portal: código IF = 999 ou "SUBSIDIADO" na Base 03).</p>' +
      '<div class="modKpiGrid">' +
      '<div class="modKpiCard modKpiCardSecondary"><div class="modKpiLabel">Operações</div><div class="modKpiValue">' + A.num(rows.length) + '</div></div>' +
      '<div class="modKpiCard modKpiCardSecondary"><div class="modKpiLabel">Lojas</div><div class="modKpiValue">' + A.num(Object.keys(lojas).length) + '</div></div>' +
      '<div class="modKpiCard modKpiCardSecondary"><div class="modKpiLabel">Vendedores</div><div class="modKpiValue">' + A.num(Object.keys(vendedores).length) + '</div></div>' +
      '</div>' +
      // FC-2.4: restores V1's OWN exportarSubsidiados() (modules/
      // coparticipado.html -- confirmed V1_SUBSIDIADOS_EXPORT_EXISTS_AND_WIRED,
      // a real production button alongside exportarCoparticipados()'s own).
      // Own export action, own view -- never shown in Visão Coparticipados.
      '<div class="cpExportBar"><button type="button" class="modBtn modBtnGhost cpExportSubsBtn" id="cpExportSubsBtn">Exportar Subsidiados</button>' +
      '<span id="cpExportStatus" class="modMuted cpExportStatus" role="status" aria-live="polite"></span></div>' +
      '<div class="modTableWrap"><table class="modTable cpTableSubs">' + cpColGroup(h) +
      '<thead>' + cpHeadRow(h) + '</thead>' +
      '<tbody>' + (body || '<tr><td colspan="11" class="modMuted">Nenhum subsidiado encontrado no filtro atual.</td></tr>') + '</tbody></table></div>';
  }

  function populateStoreOptions(fins, sales) {
    var sel = document.getElementById('cpStoreFilter');
    if (!sel) return;
    var stores = {};
    sales.concat(fins).forEach(function (r) { if (r.loja) stores[r.loja] = 1; });
    var list = Object.keys(stores).sort(function (a, b) { return a.localeCompare(b); });
    var prev = currentStore;
    sel.innerHTML = '<option value="">Todas as lojas</option>' + list.map(function (s) {
      return '<option' + (s === prev ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
  }

  // Transport-agnostic: draws a given, already-computed {sales, fins}
  // result into #cpPanel. Every branch that actually differs between
  // fixture/real transport lives upstream (buildFixtureInput+compute()
  // vs. the real provider+view-model), not here.
  function renderPanel(result) {
    var filteredFins = applyFilters(result.fins);
    // FC-2.3 (GAP-003): the export reads exactly this array -- the same
    // Loja/Departamento/Data-filtered rows the table below is about to
    // render from, never a broader or re-fetched set.
    currentFilteredFins = filteredFins;

    populateStoreOptions(result.fins, result.sales);

    var switcherHtml =
      '<div class="modTabGroup" role="tablist" aria-label="Visão">' +
      '<button type="button" class="modTab' + (currentView === 'COPARTICIPADO' ? ' modTabActive' : '') + '" role="tab" aria-selected="' + (currentView === 'COPARTICIPADO') + '" id="cpTabCopart">Visão Coparticipados</button>' +
      '<button type="button" class="modTab' + (currentView === 'SUBSIDIADO' ? ' modTabActive' : '') + '" role="tab" aria-selected="' + (currentView === 'SUBSIDIADO') + '" id="cpTabSubs">Visão Subsidiados</button>' +
      '</div>';

    var bodyHtml = currentView === 'SUBSIDIADO' ? renderSubsidiadosTable(filteredFins) : renderCoparticipadosTable(filteredFins);

    document.getElementById('cpPanel').innerHTML = switcherHtml + bodyHtml;

    document.getElementById('cpTabCopart').addEventListener('click', function () { currentView = 'COPARTICIPADO'; render(); });
    document.getElementById('cpTabSubs').addEventListener('click', function () { currentView = 'SUBSIDIADO'; render(); });

    // FC-2.3 (GAP-003): only present when currentView === 'COPARTICIPADO'
    // (renderCoparticipadosTable is the only renderer that emits it) --
    // re-wired on every render() since #cpPanel's innerHTML is fully
    // replaced above, same pattern as the tab listeners just above.
    var exportBtn = document.getElementById('cpExportCopaBtn');
    if (exportBtn) exportBtn.addEventListener('click', function () { exportCoparticipadosXlsx(exportBtn); });
    // FC-2.4: mutually exclusive with the button above -- #cpPanel only
    // ever contains one view's markup at a time.
    var exportSubsBtn = document.getElementById('cpExportSubsBtn');
    if (exportSubsBtn) exportSubsBtn.addEventListener('click', function () { exportSubsidiadosXlsx(exportSubsBtn); });
  }

  // render() is the single entry point every UI handler calls. Fixture
  // path stays fully synchronous (Gate 19: no behavior change, no
  // accidental real network call). Real path fetches for the CURRENT
  // period (p_start/p_end) and caches the result in realResult so a
  // view-switch/loja/departamento change (none of which change the
  // period, and the RPC accepts no store/dept override -- Gate 7/18)
  // re-renders instantly without refetching. Date-range changes
  // explicitly clear realResult and abort any in-flight request.
  function render() {
    if (!isRealTransport()) {
      var input = buildFixtureInput(currentFixtureId);
      var result = window.NX_COPARTICIPADO_ADAPTER.compute(input);
      renderPanel(result);
      return;
    }
    if (realResult) { renderPanel(realResult); return; }
    loadReal();
  }

  // V2_COPART_GOVERNED_RATE_AUTHORITY_CORRECTION, Gate 19/20: a
  // financial result is only ever published once BOTH the operational
  // data (sales/finance, unchanged authority) AND the governed rate
  // authority (simulador_get_coparticipado, the ONE financial rate
  // authority) have resolved successfully. Promise.all rejects with
  // the first rejection -- if either fails (including a shared abort,
  // both requests share `controller.signal`), the whole result is
  // withheld; no partial state, never a fallback to the operational
  // RPC's own "rates" field.
  function loadReal() {
    if (currentAbortController) currentAbortController.abort();
    var controller = new AbortController();
    currentAbortController = controller;
    var mySeq = ++renderSeq;
    var panel = document.getElementById('cpPanel');
    if (panel) panel.innerHTML = loadingHtml();
    Promise.all([
      window.NX_COPARTICIPADO_REAL_PROVIDER.loadCoparticipadoReal({
        start: currentDateStart, end: currentDateEnd, signal: controller.signal
      }),
      window.NX_COPARTICIPADO_GOVERNED_RATES_PROVIDER.loadGovernedCoparticipadoRates({
        signal: controller.signal
      })
    ]).then(
      function (results) {
        if (mySeq !== renderSeq) return;
        realResult = window.NX_COPARTICIPADO_REAL_VIEW_MODEL.buildRealResult(results[0], results[1]);
        renderPanel(realResult);
      },
      function (err) {
        if (mySeq !== renderSeq) return;
        if (err && err.state === 'ABORTED') return; // Gate 12: not a user-facing error
        // V2-SECURITY-02 (SEC-06): delegate to Auth Foundation's own
        // established session-expiry handling, same pattern as
        // gestao.js/score.js -- the mySeq guard above already discards
        // late/superseded responses before this can fire.
        if (err && err.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
          window.NX_AUTH_CORE.reportSessionExpired();
          return;
        }
        var panel2 = document.getElementById('cpPanel');
        if (panel2) panel2.innerHTML = errorStateHtml(err && err.state, err && err.message);
      }
    );
  }

  function wireFilterEvents() {
    var fixtureSelect = document.getElementById('cpFixtureSelect');
    if (fixtureSelect) {
      fixtureSelect.addEventListener('change', function (e) {
        currentFixtureId = e.target.value;
        render();
      });
    }
    document.getElementById('cpStoreFilter').addEventListener('change', function (e) {
      // Subtractive-only over the already-authorized dataset (Gate 18) --
      // no refetch needed, the RPC has no store override parameter.
      currentStore = e.target.value;
      render();
    });
    document.querySelectorAll('.cpPresetBtn').forEach(function (btn) {
      btn.addEventListener('click', function () { applyPresetAndRender(btn.dataset.preset); });
    });
    document.getElementById('cpDateStart').addEventListener('change', function (e) {
      currentDateStart = e.target.value;
      currentPreset = 'CUSTOM';
      document.querySelectorAll('.cpPresetBtn').forEach(function (b) { b.classList.remove('modSegItemActive'); });
      realResult = null; // period changed -- server scope itself changes, must refetch
      render();
    });
    document.getElementById('cpDateEnd').addEventListener('change', function (e) {
      currentDateEnd = e.target.value;
      currentPreset = 'CUSTOM';
      document.querySelectorAll('.cpPresetBtn').forEach(function (b) { b.classList.remove('modSegItemActive'); });
      realResult = null;
      render();
    });
  }

  // Gate 8/19: pageShellHtml(isFixtureMode) keeps the fixture banner/
  // selector out of real mode's DOM entirely, same principle as gestao.js/
  // dashbi.js's own isRealTransport()-gated shell.
  function pageShellHtml(isFixtureMode) {
    var fixtureBanner = '';
    if (isFixtureMode) {
      var options = ['<option value="ALL">combinado (todos os cenários)</option>'].concat(
        fixturesData.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.id) + '</option>'; })
      ).join('');
      fixtureBanner = '<div class="modFixtureBanner"><span class="modFixtureLabel">DADOS DE TESTE (NEXT_LOCAL)</span>' +
        '<label for="cpFixtureSelect">fixture:</label>' +
        '<select id="cpFixtureSelect">' + options + '</select></div>';
    }
    return '<div class="cpPage">' +
      '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Gestão de Coparticipados &amp; Subsidiados</h1><p class="modSubtitle">Módulo financeiro · Portal F&amp;I Grupo Brabus Mitsubishi</p></div></div>' +
      fixtureBanner +
      '<div class="modFilters">' +
      '<div class="modField"><label for="cpStoreFilter">Loja</label><select id="cpStoreFilter"><option value="">Todas as lojas</option></select></div>' +
      // FC-2.4: Departamento removed (Human product decision -- this
      // module is NOVOS-only, enforced in applyFilters(), not by a
      // user-selectable dimension). Period-preset shortcuts added in its
      // place, matching the existing shared Portal V2 convention
      // (.modSegmentedGroup/.modSegItem, same markup already used by
      // Score/Dash BI's own period filters -- Gate 17, reuse over new design).
      '<div class="modField"><label>Período rápido</label><div class="modSegmentedGroup">' +
      '<button type="button" class="modSegItem cpPresetBtn" data-preset="currentMonth">Mês atual</button>' +
      '<button type="button" class="modSegItem cpPresetBtn" data-preset="lastMonth">Mês anterior</button>' +
      '<button type="button" class="modSegItem cpPresetBtn" data-preset="last6">Últimos 6 meses</button>' +
      '</div></div>' +
      '<div class="modField"><label for="cpDateStart">Data inicial</label><input id="cpDateStart" type="date" value="' + esc(currentDateStart) + '"></div>' +
      '<div class="modField"><label for="cpDateEnd">Data final</label><input id="cpDateEnd" type="date" value="' + esc(currentDateEnd) + '"></div>' +
      '</div>' +
      '<div class="cpPanel" id="cpPanel"></div>' +
      '</div>';
  }

  // FC-2.3 (GAP-003, relocated from Score by Human UAT product-placement
  // correction): restores V1's OWN Coparticipado module export
  // (exportarCoparticipados(), modules/coparticipado.html -- confirmed a
  // real, wired V1 production button, not orphaned like Score's
  // same-named function). Column contract, order, labels, row-value
  // derivations, and the "Modelo não encontrado na tabela de taxa"
  // string-in-a-numeric-column fallback are ported field-for-field from
  // that source (byte-identical to Score's own version, which V1 itself
  // apparently copy-pasted between the two modules) -- the validated
  // workbook from FC-2.2's Human UAT is unchanged. Rebate/coparticipação
  // math is NEVER recomputed here beyond reusing r.coparticipacaoDetalhe
  // (already computed once, at load time, by compute()/buildRealResult()
  // for every COPARTICIPADO row) or, defensively, calcCoparticipacaoDetalhe()
  // directly -- same frozen function the on-screen table itself calls
  // (renderCoparticipadosTable, above), never a second classifier.
  function exportCoparticipadosXlsx(btn) {
    var now = Date.now();
    if (now - lastCpExportAt < 800) return; // debounce accidental double-click
    lastCpExportAt = now;
    var statusEl = document.getElementById('cpExportStatus');
    var A = window.NX_COPARTICIPADO_ADAPTER;
    var fins = (currentFilteredFins || []).filter(function (r) { return r.plano === 'COPARTICIPADO'; });
    if (!fins.length) {
      if (statusEl) statusEl.textContent = 'Nenhum coparticipado encontrado no filtro atual.';
      return;
    }
    var NAO_ENCONTRADO = 'Modelo não encontrado na tabela de taxa';
    var headers = ['Nome do cliente', 'Vendedor', 'Loja vinculada', 'Modelo do carro', 'Modelo tabela taxa', 'Família do carro', 'Valor de venda', 'Valor de entrada', 'Percentual de entrada', 'Valor financiado', 'Rebate Total', 'Rebate Parte Brabus', 'Valor do Rebate Total', 'Valor da Coparticipação', 'Situação', 'Prazo', 'Parcela', 'Data da venda', 'Chassi'];
    var dataRows = fins.map(function (r) {
      var c = r.coparticipacaoDetalhe || A.calcCoparticipacaoDetalhe(r);
      var valorVenda = Number(r.valorVenda) || 0;
      var valorFinanciado = Number(r.valorFinanciado) || 0;
      var entrada = Math.max(0, valorVenda - valorFinanciado);
      return [
        r.cliente || '',
        r.vendedor || '',
        r.loja || '',
        r.modelo || '',
        c.modeloTabela || NAO_ENCONTRADO,
        r.familia || '',
        valorVenda,
        entrada,
        valorVenda ? entrada / valorVenda : 0,
        valorFinanciado,
        c.ok ? (Number(c.rebateTotal) || 0) : NAO_ENCONTRADO,
        c.ok ? (Number(c.parteBrabus) || 0) : NAO_ENCONTRADO,
        c.ok ? (Number(c.valorRebateTotal) || 0) : NAO_ENCONTRADO,
        c.ok ? (Number(c.coparticipacao) || 0) : NAO_ENCONTRADO,
        r.situacaoB3 || '',
        r.parcelas ? Number(r.parcelas) : '',
        r.pmt ? Number(r.pmt) : '',
        window.NX_XLSX_EXPORT_HELPER.excelDateValue(r.data) || '',
        r.chassi || ''
      ];
    });
    var columnTypes = {
      moneyCols: new Set(['Valor de venda', 'Valor de entrada', 'Valor financiado', 'Valor do Rebate Total', 'Valor da Coparticipação', 'Parcela']),
      pctCols: new Set(['Percentual de entrada', 'Rebate Total', 'Rebate Parte Brabus']),
      dateCols: new Set(['Data da venda']),
      intCols: new Set(['Prazo']),
      textCols: new Set(['Nome do cliente', 'Vendedor', 'Loja vinculada', 'Modelo do carro', 'Modelo tabela taxa', 'Família do carro', 'Situação', 'Chassi'])
    };
    btn.disabled = true;
    try {
      // FC-2.3: filename kept EXACTLY as validated in FC-2.2's Human UAT --
      // investigated whether "_Score_FI_" was Score-specific leftover
      // naming (this Wave's own Gate 19 asked this explicitly) and found
      // it is NOT: V1's OWN Coparticipado module export (modules/
      // coparticipado.html's exportarCoparticipados(), a real wired
      // button) uses this EXACT SAME filename pattern independently --
      // "Score_FI" is V1's own platform-wide F&I branding, not a
      // Score-module artifact. No change made; see FC-2.3 report.
      var filename = 'Coparticipados_Score_FI_' + window.NX_XLSX_EXPORT_HELPER.excelFileStamp() + '.xlsx';
      window.NX_XLSX_EXPORT_HELPER.downloadWorkbook(headers, dataRows, 'Coparticipados', filename, columnTypes);
      if (statusEl) statusEl.textContent = 'Exportado: ' + filename;
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Falha ao gerar o arquivo Excel. Tente novamente.';
    } finally {
      btn.disabled = false;
    }
  }

  // FC-2.4 (V1_SUBSIDIADOS_EXPORT_EXISTS_AND_WIRED): restores V1's OWN
  // exportarSubsidiados() (modules/coparticipado.html -- a real, wired
  // production button, <button onclick="exportarSubsidiados()">Exportar
  // Subsidiados em Excel</button>, confirmed by direct source read,
  // alongside exportarCoparticipados()'s own equally-real button in the
  // SAME file). Column contract/order/labels/row derivations ported
  // field-for-field from that source. No rate/rebate columns -- V1's own
  // contract never had them for Subsidiados (not applicable to this plan
  // type), so none are invented here either. Every field below already
  // exists on Coparticipado's canonical fins rows in BOTH transports --
  // 0 new fields needed (unlike Coparticipados' export, which needed 2
  // additions to the real view-model in FC-2.3). "Departamento" will read
  // "Novos" for every row now that this module is fixed to Novos-only
  // (Gate 26-29) -- preserved as a V1 contract column regardless, not
  // removed just because its value is now constant.
  function exportSubsidiadosXlsx(btn) {
    var now = Date.now();
    if (now - lastCpExportAt < 800) return; // shared debounce with the Coparticipados export
    lastCpExportAt = now;
    var statusEl = document.getElementById('cpExportStatus');
    var fins = (currentFilteredFins || []).filter(function (r) { return r.plano === 'SUBSIDIADO'; });
    if (!fins.length) {
      if (statusEl) statusEl.textContent = 'Nenhum subsidiado encontrado no filtro atual.';
      return;
    }
    var headers = ['Nome do cliente', 'Vendedor', 'Loja vinculada', 'Departamento', 'Modelo do carro', 'Família do carro', 'Valor de venda', 'Valor financiado', 'Retorno', 'SPF Extra', 'Situação', 'Prazo', 'Parcela', 'Data da venda', 'Chassi'];
    var dataRows = fins.map(function (r) {
      return [
        r.cliente || '',
        r.vendedor || '',
        r.loja || '',
        r.dept || '',
        r.modelo || '',
        r.familia || '',
        Number(r.valorVenda) || 0,
        Number(r.valorFinanciado) || 0,
        Number(r.retorno) || 0,
        Number(r.receitaSPF) || 0,
        r.situacaoB3 || '',
        r.parcelas ? Number(r.parcelas) : '',
        r.pmt ? Number(r.pmt) : '',
        window.NX_XLSX_EXPORT_HELPER.excelDateValue(r.data) || '',
        r.chassi || ''
      ];
    });
    var columnTypes = {
      moneyCols: new Set(['Valor de venda', 'Valor financiado', 'Retorno', 'SPF Extra', 'Parcela']),
      dateCols: new Set(['Data da venda']),
      intCols: new Set(['Prazo']),
      textCols: new Set(['Nome do cliente', 'Vendedor', 'Loja vinculada', 'Departamento', 'Modelo do carro', 'Família do carro', 'Situação', 'Chassi'])
    };
    btn.disabled = true;
    try {
      // FC-2.4: same filename family as Coparticipados' own (V1's platform-
      // wide F&I naming, not a Score artifact -- see FC-2.3 report); V1's
      // own exportarSubsidiados() used exactly this pattern.
      var filename = 'Subsidiados_Score_FI_' + window.NX_XLSX_EXPORT_HELPER.excelFileStamp() + '.xlsx';
      window.NX_XLSX_EXPORT_HELPER.downloadWorkbook(headers, dataRows, 'Subsidiados', filename, columnTypes);
      if (statusEl) statusEl.textContent = 'Exportado: ' + filename;
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Falha ao gerar o arquivo Excel. Tente novamente.';
    } finally {
      btn.disabled = false;
    }
  }

  window.NX_COPARTICIPADO_PAGE = {
    // FC-2.4 -- exposed read-only for deterministic period-preset testing
    // (tests/coparticipado-period-preset-test.py), same pattern already
    // used for window.NX_SCORE_PAGE.classifyScoreBand.
    computePreset: computePreset,
    localIso: localIso,
    render: function (outlet) {
      if (isRealTransport()) {
        // The RPC requires a non-null p_start (Phase 1B, Gate 7) --
        // fixture mode's own '' default ("no lower bound", a pure
        // client-side predicate) has no real-transport equivalent, so
        // real mode gets a concrete default here, at render() call time
        // only -- fixture mode's own default is untouched (Gate 19).
        if (!currentDateStart) currentDateStart = '2026-01-01';
        outlet.innerHTML = pageShellHtml(false);
        wireFilterEvents();
        render();
        return Promise.resolve();
      }
      return loadFixtures().then(function () {
        outlet.innerHTML = pageShellHtml(true);
        wireFilterEvents();
        render();
      });
    }
  };
})();
