/* PORTAL-NEXT V2 -- Dashbi (Análise Geral do Grupo) module UI.
   Business logic: assets/js/adapters/dashbi.adapter.js (byte-identical
   extraction -- see docs/DASHBI-FUNCTION-MAP.md, DASHBI-DATA-
   CONTRACT.md, DASHBI-MODEL-ANALYSIS-CONTRACT.md). This file only
   renders.

   Real production surface migrated (verified by direct source read of
   origin/main:modules/analise-geral-grupo-secure-original-layout.html
   render()/kpiMetricsFor()/renderModelos()):
     - Grupo/Novos/Seminovos core KPIs: Vendas, Financiamentos, Share,
       Produção, Receita (+SPF, total), Retorno (kpiMetricsFor)
     - Classificação dos Planos (5 cards, same priority as Análise F&I/
       Coparticipado: SUBSIDIADO>REVERSÃO>COPARTICIPADO>BALÃO>LINEAR)
     - Model Analysis (Novos only) per família (OUTLANDER/TRITON/
       ECLIPSE CROSS): volume, financiada, penetração, produção,
       receita, ticket, retorno médio, prazo médio, PMT médio, and
       Entrada/Entrada Média/Entrada % (Gate 81 -- never hidden)
     - Store/period/vehicle-view filters (4 presets: mês atual/
       anterior/últimos 6 meses/último ano -- matches Coparticipado's
       preset set, NOT Gestão's 3-preset set -- verified, not presumed)
     - FECHAMENTO badge (isClosedMonthPeriod) -- present here, unlike
       Gestão (confirmed absent there)
     - Base02 discard/Entrada diagnostics surfaced as dev-only info
       (Gate 40/98 -- never in the base product experience)
     - Missing-seller hard-stop (Gate 9 real finding): if any resolved
       seller has no known loja, production aborts rendering entirely
       rather than showing a partial/wrong result -- V2 reproduces
       this exact behavior (results.blocked)
     - Selective analytical navigation (PORTAL-NEXT-07.2): Análise por
       Modelos/Ranking/Novos por Loja are mutually exclusive, one active
       at a time, mirroring production's own showTab() single-active-
       region switcher. Availability by view (from updateModelosTabVisibility,
       confirmed by direct source read): Grupo/Seminovos expose Visão
       Geral + Ranking only; Novos exposes all 4. Switching away from an
       unavailable mode falls back to Visão Geral -- applied uniformly to
       both Modelos and Novos por Loja, closing a real asymmetry in
       production's own code (only Modelos has an explicit fallback
       wired; Novos por Loja does not, apparently an oversight from when
       it was added in a later UX iteration).

   NOT migrated (Gate 20-21/137 deferred, real reasons -- see
   docs/DASHBI-FUNCTION-MAP.md):
     - The live secure-API path (operational_metrics RPC) -- 0 backend
       this Wave; production's own external adapter unconditionally
       overrides window.processar with this path on boot, but it only
       reshapes an ALREADY-aggregated backend payload (no classification/
       crossing logic to extract from it)
     - Excel/CSV file parsing -- 0 file I/O this Wave, fixtures supply
       already-shaped raw rows directly
     - lojaEfetivaPorMudancaPortal's live data source (a Supabase REST
       fetch) -- extracted byte-identical, but BRABUS_MUDANCAS_LOJA_
       VENDEDORES is never populated (0 backend), which deterministically
       reproduces the function's own no-override fallback
     - Ranking/medal cards, comparison-to-previous-period deltas, CSV
       export, the full multi-tab shell chrome -- presentation-layer,
       not reused as-is (V2 builds its own Red Precision presentation
       from the extracted data, same precedent as every prior module) */
(function () {
  'use strict';

  var FAMILIES = ['OUTLANDER', 'TRITON', 'ECLIPSE CROSS'];

  var fixturesData = null;
  var currentFixtureId = 'multi_loja_vendedor';
  // FC-1 (GAP-001): '' means "no comparison" -- fixture mode has no date
  // range to derive a previous period from (compute() is period-agnostic,
  // Gate 9, this Wave's brief), so the previous period is a second,
  // explicitly-picked fixture rather than an auto-computed date range.
  var currentComparisonFixtureId = '';
  var currentDeptView = 'Grupo';
  var currentFamily = 'OUTLANDER';
  var currentPreset = 'CUSTOM';
  // DASHBI1 -- named so clearPeriod() (Phase 5) can restore this file's own
  // pre-existing fixture-mode default exactly, rather than inventing a new
  // one -- these were previously inlined directly into currentDateStart/
  // currentDateEnd below, same literal values, now just named.
  var DEFAULT_DATE_START = '2026-01-01';
  var DEFAULT_DATE_END = '2026-12-31';
  var currentDateStart = DEFAULT_DATE_START;
  var currentDateEnd = DEFAULT_DATE_END;
  // DASHBI1 -- dashboard-wide Store filter, byte-identical mechanism to V1's
  // own currentStoreFilter (origin/main:modules/analise-geral-grupo-secure-
  // original-layout.html line 2199): '' means no store scoping (Todas as
  // lojas/Grupo), matching V1's <option value="">Todas as lojas</option>.
  var currentStoreFilter = '';
  // V2-UAT-01 -- true only after ensureDefaultPeriod() has run once for
  // this page load (see below) -- guards against re-applying the
  // current-month default on a same-session re-entry, which would
  // silently overwrite a Human's own manual period selection.
  var dateDefaultInitialized = false;
  // FC-2 (GAP-004): the last successfully computed `out` (fixture, via
  // A.compute(), or real, via NX_DASHBI_REAL_VIEW_MODEL.buildRealOut()),
  // captured by renderPanel() below -- the export reads out.aggs.shareLojaDept
  // directly from this, the SAME already-authorized/already-computed object
  // the panel itself was drawn from (no bypassing direct fetch, Gate 11).
  var currentOut = null;
  var lastExportAt = 0;

  // PORTAL-NEXT-07.2 — selective analytical navigation. Mirrors production's
  // own single-active-region tab switcher (showTab(): exactly one of
  // share/modelos/ranking/novosLoja gets display:block, the rest
  // display:none) plus its per-view tab availability (updateModelosTabVisibility():
  // modelosTab/novosLojaTab hidden outside Novos; rankingTab never gated).
  // 'overview' stands in for production's default "Share / Retorno" tab,
  // which V2 never built as a distinct surface — its content is the
  // always-on store/seller tables already rendered below the KPIs.
  var MODES_BY_VIEW = {
    Grupo: ['overview', 'ranking'],
    Novos: ['overview', 'modelos', 'ranking', 'novosLoja'],
    Seminovos: ['overview', 'ranking']
  };
  var MODE_LABELS = { overview: 'Visão Geral', modelos: 'Análise por Modelos', ranking: 'Ranking', novosLoja: 'Novos por Loja' };
  var currentMode = 'overview';

  function modesForView(view) { return MODES_BY_VIEW[view] || MODES_BY_VIEW.Grupo; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  // Dashbi Phase 2 (Real Data Integration Foundation) -- the ONE place
  // transport is decided, same rule as gestao.js's own isRealTransport()
  // (Gate 4 there): real whenever Auth Foundation has a real session
  // configured, fixture otherwise. renderSeq/realOut guard against a
  // stale async response overwriting a newer one (period/preset changes
  // invalidate realOut and bump renderSeq via loadReal()).
  function isRealTransport() {
    return !!(window.NX_AUTH && window.NX_AUTH.isAuthConfigured);
  }
  var renderSeq = 0;
  var realOut = null;
  var previousRealOut = null;

  var STATE_COPY = {
    PERMISSION_DENIED: { title: 'Sem permissão', body: 'Sua conta não tem acesso a esta análise.' },
    INVALID_FILTER: { title: 'Filtro inválido', body: 'Verifique o período selecionado.' },
    SCOPE_EMPTY: { title: 'Nenhum lote disponível', body: 'Ainda não há dados validados para análise.' },
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

  function loadFixtures() {
    if (fixturesData) return Promise.resolve(fixturesData);
    return fetch('tests/fixtures/dashbi-fixtures.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { fixturesData = data.cases; return fixturesData; });
  }

  // FC-1.3 (DASHBI_ANALYTICAL_TABLE_NUMERIC_READABILITY_DEFECT) -- colClasses
  // (optional, one entry per header, '' where none applies) adds a semantic
  // column-type class (dbColName/dbColCount/dbColPercent/dbColMoney/
  // dbColRank -- dashbi.css) alongside the existing numericFrom-based
  // dbNumCol, so table-layout:fixed can give money columns real width
  // instead of an even 1/N split. Omitted, every existing caller is
  // byte-identical to before.
  function headerRow(headers, numericFrom, colClasses) {
    numericFrom = numericFrom == null ? 1 : numericFrom;
    return headers.map(function (h, i) {
      var classes = [];
      if (i >= numericFrom) classes.push('dbNumCol');
      if (colClasses && colClasses[i]) classes.push(colClasses[i]);
      return '<th' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' + esc(h) + '</th>';
    }).join('');
  }
  function row(cells) {
    return '<tr><td>' + esc(cells[0]) + '</td>' + cells.slice(1).map(function (c) { return '<td class="dbNumCol">' + esc(String(c)) + '</td>'; }).join('') + '</tr>';
  }
  function tableHtml(headers, bodyRows, numericFrom, wrapText) {
    // wrapText (PORTAL-NEXT-07.4): for small text-only tables (e.g.
    // Inconsistências TRITON) a "+ Detalhes" split isn't warranted — letting
    // long values (long names) wrap onto multiple lines within their cell
    // is simpler and satisfies the no-horizontal-scroll directive just as
    // well as the primary/detail pattern used for comparison tables.
    return '<div class="dbTableWrap"><table class="dbTable' + (wrapText ? ' dbTableWrapText' : '') + '"><thead><tr>' + headerRow(headers, numericFrom) + '</tr></thead>' +
      '<tbody>' + (bodyRows.length ? bodyRows.join('') : '<tr><td colspan="' + headers.length + '" class="dbMuted">Nenhum dado encontrado.</td></tr>') + '</tbody></table></div>';
  }

  // PORTAL-NEXT-07.4 — global no-horizontal-scroll directive: material
  // information must never require horizontal scrolling to reach.
  // Shared "primary row + inline vertical detail" component, reused by
  // every Dashbi table wide enough to have needed a scrollbar (store/
  // seller/Ranking/Novos-por-Loja/plan tables/Model Analysis). A row's
  // "+ Detalhes" toggles a namespaced key in expandedKeys; render()
  // rebuilds the whole panel on toggle (same pattern already used for
  // every other interaction in this file), so expanded rows persist
  // across period/fixture changes (fresh data, same open state) but are
  // explicitly reset on family switch (Gate 16/44) via resetExpanded().
  var expandedKeys = {};
  function isExpanded(ns, key) { return !!(expandedKeys[ns] && expandedKeys[ns][String(key)]); }
  function toggleExpanded(ns, key) {
    if (!expandedKeys[ns]) expandedKeys[ns] = {};
    var k = String(key);
    if (expandedKeys[ns][k]) delete expandedKeys[ns][k];
    else expandedKeys[ns][k] = true;
  }
  function resetExpanded(ns) { expandedKeys[ns] = {}; }

  // PORTAL-NEXT-07.6.4 — idSuffix (optional) keeps the desktop and
  // mobile-card renderers' detail-panel DOM ids distinct when both
  // exist in the document at once (one visible, one display:none) —
  // every pre-existing call site omits it and gets byte-identical
  // output to before.
  function detailDomId(ns, key, idSuffix) { return 'db-detail-' + ns + '-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '_') + (idSuffix || ''); }

  function detailToggleHtml(ns, key, idSuffix) {
    var open = isExpanded(ns, key);
    return '<button type="button" class="dbDetailToggle" data-detail-ns="' + esc(ns) + '" data-detail-key="' + esc(String(key)) +
      '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + detailDomId(ns, key, idSuffix) + '">' + (open ? '− Detalhes' : '+ Detalhes') + '</button>';
  }

  // groups: [{label, items:[{label, value}]}] — value is pre-formatted HTML/text.
  function detailGroupsHtml(groups) {
    return groups.map(function (g) {
      return '<div class="dbDetailGroup"><div class="dbDetailGroupLabel">' + esc(g.label) + '</div>' +
        '<div class="dbDetailGroupItems">' + g.items.map(function (it) {
          return '<div class="dbDetailItem"><span class="dbDetailK">' + esc(it.label) + '</span><span class="dbDetailV">' + it.value + '</span></div>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function detailRowHtml(ns, key, colspan, groups) {
    if (!isExpanded(ns, key)) return '';
    return '<tr id="' + detailDomId(ns, key) + '" class="dbDetailRow"><td colspan="' + colspan + '"><div class="dbDetailPanel">' + detailGroupsHtml(groups) + '</div></td></tr>';
  }
  // PORTAL-NEXT-07.5 — same detail-panel body, without the <tr>/<td> wrapper,
  // for the KPI grid (a div grid, not a table) — reuses the identical
  // dbDetailPanel/dbDetailGroup markup and expandedKeys state machinery.
  // PORTAL-NEXT-07.6.4 — also reused as-is for every mobile card's own
  // detail panel (idSuffix keeps its DOM id distinct from the desktop
  // row's, since both share the same ns/key toggle state).
  function kpiDetailPanelHtml(ns, key, groups, idSuffix) {
    if (!isExpanded(ns, key)) return '';
    return '<div id="' + detailDomId(ns, key, idSuffix) + '" class="dbDetailPanel dbKpiDetailPanel">' + detailGroupsHtml(groups) + '</div>';
  }

  // PORTAL-NEXT-07.6.4 — human UAT rejected transforming the desktop
  // <table> into a mobile layout (07.6/07.6.2/07.6.3), even after that
  // last version was proven correct by every computed-style/DOM check
  // available — the human's actual browser result is authoritative
  // regardless. Strategy changed: a dedicated non-table mobile card
  // renderer, fed by the SAME already-computed row data as the desktop
  // table (no recalculation), for every table that shares this
  // component (store/seller/Ranking/Novos por Loja). Exactly one of
  // .dbDesktopOnly/.dbMobileOnly is visible at a time (dashbi.css);
  // Model Analysis's own tables (frozen, Gate 32) don't use this helper
  // and are untouched.
  function dbMobileField(label, valueHtml, extraClass) {
    return '<div class="dbMobileField' + (extraClass ? ' ' + extraClass : '') + '"><div class="dbMobileLabel">' + esc(label) + '</div><div class="dbMobileValue">' + valueHtml + '</div></div>';
  }
  function dbMobileCard(ns, key, identityText, subText, primaryFieldsHtml, detailGroups) {
    return '<div class="dbMobileCard">' +
      '<div class="dbMobileIdentity">' + esc(identityText) + '</div>' +
      (subText ? '<div class="dbMobileSub">' + esc(subText) + '</div>' : '') +
      '<div class="dbMobileFieldGrid">' + primaryFieldsHtml + '</div>' +
      detailToggleHtml(ns, key, '-m') +
      kpiDetailPanelHtml(ns, key, detailGroups, '-m') +
      '</div>';
  }
  function dbMobileListHtml(cards) {
    return '<div class="dbMobileOnly">' + cards.join('') + '</div>';
  }

  // Wave 3A: top-tier KPI grid migrated to the shared module-system.css
  // primitives (.modKpiCard/.modKpiLabel/.modKpiValue/.modKpiHint +
  // semantic modifiers) — visual result unchanged (same border/padding/
  // type scale the old .dbKpiCardPrimary/.dbK/.dbV/.dbHint rules already
  // produced), only the class vocabulary is now shared. Every OTHER
  // dashbi.css class (.dbPlanCard, .dbEntradaCard, .dbFamilyMetricBox,
  // tables, mobile cards, Model Analysis, etc.) is untouched — these 3
  // functions are the only callers of dbKpiCardPrimary/dbK/dbV/dbHint,
  // confirmed via grep before this edit.
  function kpiPrimary(label, value, hint, compareHtml) {
    return '<div class="modKpiCard"><div class="modKpiLabel">' + esc(label) + '</div><div class="modKpiValue">' + value + '</div>' + (hint ? '<div class="modKpiHint">' + hint + '</div>' : '') + (compareHtml || '') + '</div>';
  }

  // FC-1 (GAP-001) -- presentation layer only, business math is
  // A.calcDelta() (byte-identical extraction, dashbi.adapter.js). Mirrors
  // production's formatDelta() semantics (origin/main lines 3156-3163:
  // ▲/▼/▬, "— sem base anterior" when previous is 0/null/non-finite) using
  // V2's own class vocabulary, not V1's HTML/CSS (Gate 18, this Wave's
  // brief). Gate 18 also requires NOT reinterpreting up/down as good/bad --
  // every surface this delta is used on (Vendas, Financiamentos, Receita,
  // Produção, Retorno, Modelos) is a "more is generically better" metric in
  // both V1 and V2, same as V1's own uncontextualized coloring, so this is
  // not a reinterpretation. Gate 19 accessibility: icon + percent text +
  // aria-label, never color alone.
  // FC-1.1 (Human UAT revision): the percent-delta presentation (▲ +20,4%,
  // "Anterior: X") was NOT approved. New rule: show the previous value
  // itself (same formatter as current, Gate 7) plus a plain direction
  // arrow -- no percent, no "Anterior:" label. The arrow is a MATH
  // direction, not a performance judgment (Gate 5/18, unchanged from FC-1).
  //
  // previousValue == null means "no previous value at all for this
  // specific row/metric" (e.g. a Modelo absent from the previous period's
  // own fixture/aggregate) -> rendered as "—", distinct from previous = 0
  // (a real, comparable zero, e.g. "5 / 0 ▲" -- Gate 8). This is UNRELATED
  // to "no previous PERIOD was computed at all" (fixture: no comparison
  // picked; real: previous fetch failed) -- that case is still handled by
  // every call site's own `prev ? ... : ''` guard, which omits this
  // function entirely rather than calling it with previousValue=null.
  // Shared by previousValueHtml/numCompareCellHtml (Gate 18, FC-1.2 brief:
  // "Do not duplicate formatter/business logic") -- the only business rule
  // here is a plain numeric comparison, not calcDelta (FC-1.1 already
  // removed that dependency).
  function comparisonDirection(currentValue, previousValue) {
    var c = Number(currentValue) || 0, p = Number(previousValue) || 0;
    var direction = c > p ? 'up' : (c < p ? 'down' : 'flat');
    var arrow = c > p ? '▲' : (c < p ? '▼' : '→');
    var changeWord = c > p ? 'aumentou' : (c < p ? 'diminuiu' : 'permaneceu igual');
    return { direction: direction, arrow: arrow, changeWord: changeWord };
  }

  function previousValueHtml(A, currentValue, previousValue, previousFormatted, short) {
    var cls = 'dbPrevValue' + (short ? ' dbPrevValueShort' : '');
    if (previousValue == null) {
      return '<span class="' + cls + ' dbPrevValueNA" aria-label="sem valor anterior disponível">—</span>';
    }
    var d = comparisonDirection(currentValue, previousValue);
    // Gate 29: visually only previous value + arrow; assistive tech gets
    // the equivalent context via a visually-hidden sr-only span, not a
    // visible "Anterior:"/percent label.
    var srText = 'valor anterior ' + previousFormatted + '; valor atual ' + d.changeWord;
    return '<span class="' + cls + '">' +
      '<span aria-hidden="true">' + esc(previousFormatted) + ' <span class="dbPrevArrow dbPrevArrow' + d.direction.charAt(0).toUpperCase() + d.direction.slice(1) + '">' + d.arrow + '</span></span>' +
      '<span class="srOnly">' + esc(srText) + '</span>' +
      '</span>';
  }

  // FC-1.2 (Human UAT DEFECT A): table/model numeric cells need the
  // PREVIOUS number's own digits to land on the exact same right edge as
  // the CURRENT number, with the arrow occupying separate space that never
  // shifts that edge (Gate 19-21, this Wave's brief). previousValueHtml's
  // single inline-flex line (kept unchanged, still used by KPI cards,
  // explicitly exempt per Gate 23) can't do this -- a CSS Grid cell
  // (.dbNumCompare, dashbi.css) can: row 1 (current) spans both grid
  // columns; row 2 puts the previous NUMBER in column 1 (same right edge
  // as row 1, both right-aligned) and the arrow in column 2, outside that
  // shared edge. currentHtml may itself carry markup (e.g. a colored Share
  // span) -- passed through unescaped, same convention as cellHtml()'s
  // {raw:...} elsewhere in this file.
  function numCompareCellHtml(A, currentHtml, currentValue, previousValue, previousFormatted) {
    if (previousValue == null) {
      return '<span class="dbNumCompare"><span class="dbNumCurrent">' + currentHtml + '</span>' +
        '<span class="dbPrevNum dbPrevValueNA" aria-label="sem valor anterior disponível">—</span></span>';
    }
    var d = comparisonDirection(currentValue, previousValue);
    var srText = 'valor anterior ' + previousFormatted + '; valor atual ' + d.changeWord;
    return '<span class="dbNumCompare">' +
      '<span class="dbNumCurrent">' + currentHtml + '</span>' +
      '<span class="dbPrevNum" aria-hidden="true">' + esc(previousFormatted) + '</span>' +
      '<span class="dbPrevArrow dbPrevArrow' + d.direction.charAt(0).toUpperCase() + d.direction.slice(1) + '" aria-hidden="true">' + d.arrow + '</span>' +
      '<span class="srOnly">' + esc(srText) + '</span>' +
      '</span>';
  }

  // A previous-period block for the KPI grid: current value stays the
  // protagonist (Gate 6); this renders only the secondary previous+arrow
  // line below it. previousValue == null (the WHOLE previous period is
  // unavailable, not just this one metric) -> nothing at all, same as FC-1.
  function kpiCompareHtml(A, currentValue, previousValue, previousFormatted) {
    if (previousValue == null) return '';
    return '<div class="dbKpiCompare">' + previousValueHtml(A, currentValue, previousValue, previousFormatted) + '</div>';
  }

  // PORTAL-NEXT-07.5 — Share/Penetração threshold reconfirmed against the
  // current production authority (pctPenetracao, origin/main lines
  // 2788-2794, docs/DASHBI-KPI-CONTRACT.md): v<0.40 -> baixa, else ok. Not
  // assumed from a prior wave — re-checked against source this Wave.
  function shareEmphasisClass(v) { return v < 0.40 ? 'modKpiCardCritical' : 'modKpiCardSuccess'; }

  function kpiShareCardHtml(A, v, prevV) {
    var cls = shareEmphasisClass(v);
    var statusLabel = v < 0.40 ? 'Abaixo da meta (40%)' : 'Dentro da meta';
    var compareHtml = prevV == null ? '' : kpiCompareHtml(A, v, prevV, A.pct(prevV));
    return '<div class="modKpiCard ' + cls + '"><div class="modKpiLabel">Share</div><div class="modKpiValue">' + esc(A.pct(v)) + '</div><div class="modKpiHint">' + esc(statusLabel) + '</div>' + compareHtml + '</div>';
  }

  function kpiReceitaTotalCardHtml(A, v, prevV) {
    var compareHtml = prevV == null ? '' : kpiCompareHtml(A, v, prevV, A.money(prevV));
    return '<div class="modKpiCard modKpiCardInfo"><div class="modKpiLabel">Receita Total</div><div class="modKpiValue">' + esc(A.money(v)) + '</div>' + compareHtml + '</div>';
  }

  function buildFixtureInput(id) {
    var c = fixturesData.filter(function (x) { return x.id === id; })[0];
    return {
      b1HistRows: c.b1HistRows, b2HistRows: c.b2HistRows,
      b1NovaRows: c.b1NovaRows, b2NovaRows: c.b2NovaRows,
      b3Rows: c.b3Rows, vendorRows: c.vendorRows
    };
  }

  function planCardHtml(A, tipo, count) {
    var cls = { 'LINEAR': 'planLinear', 'BALÃO': 'planBalao', 'SUBSIDIADO': 'planSubsidiado', 'REVERSÃO': 'planReversao', 'COPARTICIPADO': 'planCoparticipado' }[tipo] || '';
    return '<div class="dbPlanCard ' + cls + '"><div class="dbK">' + esc(tipo) + '</div><div class="dbV">' + (count || 0) + '</div></div>';
  }

  // PORTAL-NEXT-07.4 — a primary row (identity + fast-comparison numeric
  // columns + toggle) followed by its detail row when expanded. colspan
  // covers the FULL primary column count (identity + numeric + toggle),
  // so the detail panel spans the whole table width.
  // PORTAL-NEXT-07.5 — a primary cell may be {raw:'<html>'} to carry
  // pre-formatted markup (e.g. the Share emphasis span) through unescaped;
  // every previously-existing caller keeps passing plain strings/numbers,
  // so cellHtml()'s plain-string branch is byte-identical to the old
  // behavior for them.
  function cellHtml(c) { return (c && typeof c === 'object' && 'raw' in c) ? c.raw : esc(String(c)); }

  // PORTAL-NEXT-07.5 — headers (optional) stamps each primary <td> with a
  // data-th label, consumed only by the opt-in .dbTableStackable mobile
  // recomposition (see dashbi.css) for tables carrying the new 5-metric
  // primary hierarchy. Omitted (undefined), every existing caller's markup
  // is byte-identical to before.
  function expandableRow(ns, key, primaryCells, numericFrom, colspan, detailGroups, headers) {
    function th(i) { return headers ? ' data-th="' + esc(headers[i]) + '"' : ''; }
    return '<tr><td' + th(0) + '>' + cellHtml(primaryCells[0]) + '</td>' +
      primaryCells.slice(1).map(function (c, i) { return '<td' + th(i + 1) + (i + 1 >= numericFrom ? ' class="dbNumCol"' : '') + '>' + cellHtml(c) + '</td>'; }).join('') +
      '<td class="dbDetailToggleCell">' + detailToggleHtml(ns, key) + '</td></tr>' +
      detailRowHtml(ns, key, colspan, detailGroups);
  }

  function expandableTableHtml(headers, numericFrom, bodyRowsHtml, colCount, colClasses, tableClass) {
    return '<div class="dbTableWrap"><table class="dbTable dbTableExpandable' + (tableClass ? ' ' + tableClass : '') + '"><thead><tr>' + headerRow(headers.concat(['']), numericFrom, colClasses) + '</tr></thead>' +
      '<tbody>' + (bodyRowsHtml.length ? bodyRowsHtml.join('') : '<tr><td colspan="' + colCount + '" class="dbMuted">Nenhum dado encontrado.</td></tr>') + '</tbody></table></div>';
  }

  // PORTAL-NEXT-07.5 — retorno derived here with the exact same formula
  // already used by rowsFromAgg()/rankingFromViews() (receitaTotal/producao)
  // — a presentational reuse of an existing formula against data that was
  // already on finLoja/finVendDept, not a new business rule.
  function retornoFromFin(f) { return f.producao ? (f.receitaTotal || 0) / f.producao : 0; }

  // FC-1.3 (Gate 13): a soft hyphen (­) after "Financia" gives the
  // browser a real, sensible hyphenation point ("FINANCIA-"/"MENTOS") to
  // prefer over an arbitrary mid-word character break ("FINANCIAMENT"/"OS",
  // the ugly fragmentation the human's screenshots showed and Gate 13
  // explicitly forbids) when dbColCount's width is narrower than the full
  // label at some viewport. Invisible unless an actual break happens there;
  // "Financiamentos" as a word/term is completely unchanged.
  var STORE_HEADERS = ['Loja', 'Vendas', 'Financia­mentos', 'Share', 'Produção Total', 'Receita Total'];
  // FC-1.3: money columns (Produção/Receita Total) get real width instead
  // of an even 1/N split with count/percent columns -- Gate 10/24.
  var STORE_HEADER_COL_CLASSES = ['dbColName', 'dbColCount', 'dbColCount', 'dbColPercent', 'dbColMoney', 'dbColMoney'];

  // PORTAL-NEXT-07.6.4 — shared by store/seller: the 5 primary metrics
  // as mobile-card fields (Vendas+Financiamentos paired, per the human's
  // own spec — both always a short integer; Share/Produção Total/
  // Receita Total each full width), built from the SAME v/f/share
  // values the desktop row already computed. No recalculation.
  function dbPrimaryMetricFieldsHtml(A, v, f, share, prev) {
    // FC-1.2 DEFECT A: same numCompareCellHtml grid as the desktop table,
    // so mobile cards get the same aligned current/previous+arrow geometry.
    var vendasField = prev ? numCompareCellHtml(A, String(v.qtd), v.qtd, prev.v.qtd, A.num(prev.v.qtd)) : String(v.qtd);
    var finField = prev ? numCompareCellHtml(A, String(f.qtd), f.qtd, prev.f.qtd, A.num(prev.f.qtd)) : String(f.qtd);
    var shareField = prev ? numCompareCellHtml(A, penetracaoCellHtml(A, share), share, prev.share, A.pct(prev.share)) : penetracaoCellHtml(A, share);
    var producaoField = prev ? numCompareCellHtml(A, esc(A.money(f.producao || 0)), f.producao || 0, prev.f.producao || 0, A.money(prev.f.producao || 0)) : esc(A.money(f.producao || 0));
    var receitaTotalField = prev ? numCompareCellHtml(A, esc(A.money(f.receitaTotal || 0)), f.receitaTotal || 0, prev.f.receitaTotal || 0, A.money(prev.f.receitaTotal || 0)) : esc(A.money(f.receitaTotal || 0));
    return dbMobileField('Vendas', vendasField, 'dbMobileFieldPair') +
      dbMobileField('Financiamentos', finField, 'dbMobileFieldPair') +
      dbMobileField('Share', shareField, 'dbMobileFieldEmph') +
      dbMobileField('Produção Total', producaoField) +
      dbMobileField('Receita Total', receitaTotalField);
  }

  // FC-1.1, CHANGE-02: sellerTableHtml ("Vendas e Financiamentos por
  // Vendedor") was removed from Visão Geral by explicit human decision
  // (REDUNDANT_WITH_RANKING -- Ranking already covers seller-level
  // performance). Its only caller was that one heading in renderPanel
  // (removed below); the underlying data (aggs.vendasVendDept/finVendDept)
  // is untouched in the adapter -- this deletion removes presentation
  // only. See docs/DASHBI-COMPARISON-CONTRACT.md for the capability-parity
  // check against Ranking (DETAIL_CAPABILITY_PRESERVED_BY_RANKING, with a
  // disclosed nuance: Ranking shows top 10 by Receita Total, this table
  // showed every seller sorted by Vendas qtd -- same metric set either way).

  function storeTableHtml(A, results, previousResults) {
    var A_ = results.aggs;
    var lojas = Object.keys(A_.vendasLoja);
    var finLojaMap = A_.finLoja;
    var prevA = previousResults ? previousResults.aggs : null;
    var ns = 'storeTable';
    var desktopRows = [];
    var mobileCards = [];
    lojas.sort(function (a, b) { return (A_.vendasLoja[b].qtd || 0) - (A_.vendasLoja[a].qtd || 0); }).forEach(function (loja) {
      var v = A_.vendasLoja[loja] || { qtd: 0 };
      var f = finLojaMap[loja] || { qtd: 0, producao: 0, receita: 0, receitaSPF: 0, receitaTotal: 0 };
      var share = v.qtd ? f.qtd / v.qtd : 0;
      var prev = null;
      if (prevA) {
        var prevV = prevA.vendasLoja[loja] || { qtd: 0 };
        var prevF = prevA.finLoja[loja] || { qtd: 0, producao: 0, receita: 0, receitaSPF: 0, receitaTotal: 0 };
        prev = { v: prevV, f: prevF, share: prevV.qtd ? prevF.qtd / prevV.qtd : 0 };
      }
      var detailGroups = [
        { label: 'Financeiro (complementar)', items: [
          { label: 'Receita', value: esc(A.money(f.receita || 0)) + (prev ? previousValueHtml(A, f.receita || 0, prev.f.receita || 0, A.money(prev.f.receita || 0)) : '') },
          { label: 'Receita SPF', value: esc(A.money(f.receitaSPF || 0)) + (prev ? previousValueHtml(A, f.receitaSPF || 0, prev.f.receitaSPF || 0, A.money(prev.f.receitaSPF || 0)) : '') },
          { label: 'Retorno', value: esc(A.pct(retornoFromFin(f))) + (prev ? previousValueHtml(A, retornoFromFin(f), retornoFromFin(prev.f), A.pct(retornoFromFin(prev.f))) : '') }
        ] }
      ];
      // FC-1.2 DEFECT A: numCompareCellHtml (right-aligned grid), not
      // previousValueHtml's inline-flex line -- see its own comment for why.
      var vendasCell = prev ? numCompareCellHtml(A, String(v.qtd), v.qtd, prev.v.qtd, A.num(prev.v.qtd)) : String(v.qtd);
      var finCell = prev ? numCompareCellHtml(A, String(f.qtd), f.qtd, prev.f.qtd, A.num(prev.f.qtd)) : String(f.qtd);
      var producaoCell = prev ? numCompareCellHtml(A, A.money(f.producao || 0), f.producao || 0, prev.f.producao || 0, A.money(prev.f.producao || 0)) : A.money(f.producao || 0);
      var receitaTotalCell = prev ? numCompareCellHtml(A, A.money(f.receitaTotal || 0), f.receitaTotal || 0, prev.f.receitaTotal || 0, A.money(prev.f.receitaTotal || 0)) : A.money(f.receitaTotal || 0);
      var shareCell = prev ? numCompareCellHtml(A, penetracaoCellHtml(A, share), share, prev.share, A.pct(prev.share)) : penetracaoCellHtml(A, share);
      desktopRows.push(expandableRow(ns, loja, [loja, { raw: vendasCell }, { raw: finCell }, { raw: shareCell }, { raw: producaoCell }, { raw: receitaTotalCell }], 1, 7, detailGroups, STORE_HEADERS));
      mobileCards.push(dbMobileCard(ns, loja, loja, null, dbPrimaryMetricFieldsHtml(A, v, f, share, prev), detailGroups));
    });
    return '<div class="dbDesktopOnly">' + expandableTableHtml(STORE_HEADERS, 1, desktopRows, 7, STORE_HEADER_COL_CLASSES, 'dbTableLoja') + '</div>' + dbMobileListHtml(mobileCards);
  }

  var VEHICLE_IMAGES = {
    OUTLANDER: 'assets/img/vehicles/outlander.png',
    'ECLIPSE CROSS': 'assets/img/vehicles/eclipse_cross.png',
    TRITON: 'assets/img/vehicles/triton.png'
  };

  function vehicleSelectorHtml() {
    return '<div class="dbVehicleSelector" role="group" aria-label="Selecionar família de modelo">' +
      FAMILIES.map(function (f) {
        var active = f === currentFamily;
        return '<button type="button" class="dbVehicleCard' + (active ? ' dbVehicleCardActive' : '') +
          '" data-family="' + esc(f) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
          '<span class="dbVehicleImgWrap"><img src="' + esc(VEHICLE_IMAGES[f]) + '" alt="" loading="lazy"></span>' +
          '<span class="dbVehicleName">' + esc(f) + (active ? ' <span class="dbVehicleCheck" aria-hidden="true">&#10003;</span>' : '') + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
  }

  function modeNavHtml() {
    var available = modesForView(currentDeptView);
    return '<div class="dbModeGroup" role="group" aria-label="Análise complementar">' +
      available.map(function (m) {
        var active = m === currentMode;
        return '<button type="button" class="dbBtn dbModeBtn' + (active ? ' dbBtnActive' : '') +
          '" data-mode="' + esc(m) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' + esc(MODE_LABELS[m]) + '</button>';
      }).join('') +
      '</div>';
  }

  // PORTAL-NEXT-07.3 — full production column contract for "Indicadores por
  // modelo" (18 fields, origin/main lines 4088-4107), plus Entrada Qtd
  // (already on modelRowsUnified's row, EXTRA_IN_V2, kept — see
  // docs/MODEL-ANALYSIS-PRODUCTION-VS-V2.md). Group labels are purely
  // presentational (Gate 25/50) — every column still maps 1:1 to a single
  // production label, no new business category. Rendered as one wide table
  // with a sticky Modelo column + horizontal scroll, NOT the card+modal
  // shape production currently uses for this data — see
  // docs/MODEL-ANALYSIS-METRIC-CONTRACTS.md's "Presentation decision"
  // (data-table.md forbids cardifying tabular data; HUMAN REVIEW REQUIRED
  // on this choice, flagged there).
  var MODEL_TABLE_COLUMNS = [
    { group: null, key: 'Modelo', label: 'Modelo' },
    { group: 'Volume', key: 'volume', label: 'Volume', f: function (A, v) { return A.num(v); } },
    { group: 'Volume', key: 'financiada', label: 'Financia­mentos', f: function (A, v) { return A.num(v); } },
    { group: 'Volume', key: 'penetracao', label: 'Penetração', f: function (A, v) { return A.pct(v); }, penetracao: true },
    { group: 'Financeiro', key: 'producao', label: 'Produção', f: function (A, v) { return A.money(v); } },
    { group: 'Financeiro', key: 'receita', label: 'Receita', f: function (A, v) { return A.money(v); } },
    { group: 'Financeiro', key: 'receitaSPF', label: 'Receita SPF', f: function (A, v) { return A.money(v); } },
    { group: 'Financeiro', key: 'receitaTotal', label: 'Receita Total', f: function (A, v) { return A.money(v); } },
    { group: 'Financeiro', key: 'ticket', label: 'Ticket Médio', f: function (A, v) { return A.money(v); } },
    { group: 'Retorno', key: 'retornoMedio', label: 'Retorno Médio', f: function (A, v) { return A.pct(v); } },
    { group: 'Parcelamento', key: 'prazoMedio', label: 'Prazo Médio', f: function (A, v) { return A.num(v, 1) + 'x'; } },
    { group: 'Parcelamento', key: 'pmtMed', label: 'Parcela Média', f: function (A, v) { return A.money(v); } },
    { group: 'Entrada', key: 'entradaMed', label: 'Entrada Média', f: function (A, v) { return A.money(v); } },
    { group: 'Entrada', key: 'entradaPct', label: 'Entrada %', f: function (A, v) { return A.pct(v); } },
    { group: 'Planos', key: 'subsidiadoQtd', label: 'Qtd Subsidiado', f: function (A, v) { return A.num(v); } },
    { group: 'Planos', key: 'reversaoQtd', label: 'Qtd Reversão', f: function (A, v) { return A.num(v); } },
    { group: 'Planos', key: 'coparticipadoQtd', label: 'Qtd Coparticipado', f: function (A, v) { return A.num(v); } },
    { group: 'Planos', key: 'balaoQtd', label: 'Qtd Balão', f: function (A, v) { return A.num(v); } },
    { group: 'Planos', key: 'linearQtd', label: 'Qtd Linear', f: function (A, v) { return A.num(v); } },
    { group: 'Planos', key: 'balaoMed', label: 'Balão Médio', f: function (A, v) { return A.money(v); } }
  ];
  // PORTAL-NEXT-07.4.1 — "Entrada Qtd" removed from the UI (Gate 0): it was
  // never a production-visible metric, only the internal eligible-record
  // COUNT that Entrada Média/% divide by (modelExtraMetrics's entradaQtd,
  // still computed and still on every row — untouched, still feeds those
  // two real metrics exactly as before). subsidiadoQtd/coparticipadoQtd
  // added to PLANOS (Gate 1-7): audited aggregate()'s own compVals (already
  // extracted byte-identical) and found it computes coparticipadoQtd/
  // subsidiadoQtd on the SAME compModelo aggregation, same population, same
  // mutually-exclusive classifiers (isFinSubsidiado/isFinCoparticipado) as
  // linearQtd/balaoQtd — production's own modelRowsUnified just doesn't
  // surface those two fields into its row shape (confirmed by direct
  // source read, not an extraction gap). Sourced here from planRowsByModel
  // (already extracted, already on-page one section below) for the
  // matching Modelo, not a new business-logic extraction. Order follows
  // the official classification priority (SUBSIDIADO>REVERSÃO>
  // COPARTICIPADO>BALÃO>LINEAR), per the human's stated preference.

  function penetracaoCellHtml(A, v) {
    var cls = v < 0.40 ? 'dbPenetracaoBaixa' : 'dbPenetracaoOk';
    return '<span class="' + cls + '">' + esc(A.pct(v)) + '</span>';
  }

  // PORTAL-NEXT-07.4 — the 07.3 wide table (18 columns, grouped headers)
  // scrolled horizontally at EVERY viewport including 1920px — the human
  // global no-horizontal-scroll directive rejects this. Recomposed as a
  // compact primary comparison row (Volume/Financiamentos/Penetração
  // always; Produção/Receita Total/Ticket Médio/Retorno Médio added at
  // >=768px via CSS, .dbDesktopCol) + a "+ Detalhes" inline expansion
  // covering every remaining field, grouped exactly as production's own
  // family miniGrid groups them (Financeiro/Parcelamento/Entrada/Planos)
  // — presentational grouping only, 0 change to any formula/population
  // (see docs/MODEL-ANALYSIS-METRIC-CONTRACTS.md). The desktop-only
  // columns are ALSO always present in the detail panel (small
  // redundancy, not a completeness gap) so mobile users find every
  // metric in exactly one place regardless of viewport.
  var MODEL_PRIMARY_ALWAYS = ['volume', 'financiada', 'penetracao'];
  var MODEL_PRIMARY_DESKTOP = ['producao', 'receitaTotal', 'ticket', 'retornoMedio'];
  // FC-1.3 (DASHBI_ANALYTICAL_TABLE_NUMERIC_READABILITY_DEFECT, Gate 11):
  // only the 7 keys that ever appear in the PRIMARY row need a width class
  // -- the other 12 MODEL_TABLE_COLUMNS entries render inside the +
  // Detalhes grid panel (.dbDetailPanel), which lays out items in its own
  // minmax(0,160px) grid, not a fixed-layout table column, so they don't
  // need (or use) this classification.
  var MODEL_COL_TYPE = {
    volume: 'dbColCount', financiada: 'dbColCount', penetracao: 'dbColPercent',
    producao: 'dbColMoney', receitaTotal: 'dbColMoney', ticket: 'dbColMoney', retornoMedio: 'dbColPercent'
  };

  function modelCellHtml(A, c, r, prevByModelo) {
    var val = r[c.key];
    var formatted = c.penetracao ? penetracaoCellHtml(A, val) : esc(String(c.f(A, val)));
    if (!prevByModelo) return formatted;
    var prevRow = prevByModelo[r.Modelo];
    // prevRow absent (this Modelo has no row at all in the previous
    // period) -> "—" (Gate 8, FC-1.1), not silently omitted as in FC-1.
    var prevVal = prevRow ? prevRow[c.key] : null;
    var prevFormatted = prevRow ? (c.penetracao ? A.pct(prevVal) : String(c.f(A, prevVal))) : null;
    // FC-1.2 DEFECT A: numCompareCellHtml (right-aligned grid) -- Gate 25
    // named this as one of the surfaces with particularly poor readability
    // (narrow columns, monetary values wrapping awkwardly).
    return numCompareCellHtml(A, formatted, val, prevVal, prevFormatted);
  }

  // FC-1 (GAP-001): all 19 non-identity columns compared, same set
  // production compares in Model Analysis (origin/main lines 4093-4114,
  // MODEL_TABLE_COLUMNS above already mirrors that 1:1). prevByModelo is
  // null when no previous period was computed.
  function modelPrimaryDetailTableHtml(A, modelRows, prevByModelo) {
    var byKey = {};
    MODEL_TABLE_COLUMNS.forEach(function (c) { byKey[c.key] = c; });
    var alwaysCols = MODEL_PRIMARY_ALWAYS.map(function (k) { return byKey[k]; });
    var desktopCols = MODEL_PRIMARY_DESKTOP.map(function (k) { return byKey[k]; });
    var primaryKeys = MODEL_PRIMARY_ALWAYS.concat(MODEL_PRIMARY_DESKTOP);
    var detailCols = MODEL_TABLE_COLUMNS.slice(1).filter(function (c) { return primaryKeys.indexOf(c.key) === -1; });
    var detailGroupsByLabel = {};
    var detailGroupOrder = [];
    // Financeiro/Retorno detail also repeats the desktop-only primary
    // columns, so they stay reachable via + Detalhes at every viewport.
    desktopCols.concat(detailCols).forEach(function (c) {
      if (!detailGroupsByLabel[c.group]) { detailGroupsByLabel[c.group] = []; detailGroupOrder.push(c.group); }
      detailGroupsByLabel[c.group].push(c);
    });

    // FC-1.3 (Gate 11): money columns (Produção/Receita Total/Ticket Médio)
    // get real width instead of an even 1/N split with the compact count/
    // percent columns -- this is exactly what made Produção/Receita Total/
    // Ticket Médio visually collide in the human's screenshots.
    var colType = function (key) { return MODEL_COL_TYPE[key] || 'dbColCount'; };
    var headCells = '<th class="dbColName" scope="col">Modelo</th>' +
      alwaysCols.map(function (c) { return '<th class="dbNumCol ' + colType(c.key) + '" scope="col">' + esc(c.label) + '</th>'; }).join('') +
      desktopCols.map(function (c) { return '<th class="dbNumCol dbDesktopCol ' + colType(c.key) + '" scope="col">' + esc(c.label) + '</th>'; }).join('') +
      '<th scope="col"></th>';
    var colspan = 1 + alwaysCols.length + desktopCols.length + 1;
    var ns = 'modelIndicators';
    var body = modelRows.map(function (r) {
      var key = r.Modelo;
      var groups = detailGroupOrder.map(function (label) {
        return { label: label, items: detailGroupsByLabel[label].map(function (c) { return { label: c.label, value: modelCellHtml(A, c, r, prevByModelo) }; }) };
      });
      return '<tr><td>' + esc(r.Modelo) + '</td>' +
        alwaysCols.map(function (c) { return '<td class="dbNumCol">' + modelCellHtml(A, c, r, prevByModelo) + '</td>'; }).join('') +
        desktopCols.map(function (c) { return '<td class="dbNumCol dbDesktopCol">' + modelCellHtml(A, c, r, prevByModelo) + '</td>'; }).join('') +
        '<td class="dbDetailToggleCell">' + detailToggleHtml(ns, key) + '</td></tr>' +
        detailRowHtml(ns, key, colspan, groups);
    }).join('');
    return '<div class="dbTableWrap"><table class="dbTable dbTableExpandable dbTableModelos"><thead><tr>' + headCells + '</tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="' + colspan + '" class="dbMuted">Nenhum dado encontrado.</td></tr>') + '</tbody></table></div>';
  }

  function modelTotals(modelRows) {
    return modelRows.reduce(function (a, r) {
      a.volume += r.volume; a.financiada += r.financiada; a.producao += r.producao;
      a.receita += r.receita; a.receitaSPF += r.receitaSPF; a.receitaTotal += r.receitaTotal;
      return a;
    }, { volume: 0, financiada: 0, producao: 0, receita: 0, receitaSPF: 0, receitaTotal: 0 });
  }

  function familyMetricGridHtml(A, results, modelRows, previousResults, previousModelRows) {
    var totals = modelTotals(modelRows);
    var pen = totals.volume ? totals.financiada / totals.volume : 0;
    var ticket = totals.financiada ? totals.producao / totals.financiada : 0;
    var extraFam = A.familyExtraMetrics(results, modelRows);
    var prev = null;
    if (previousResults && previousModelRows) {
      var prevTotals = modelTotals(previousModelRows);
      var prevPen = prevTotals.volume ? prevTotals.financiada / prevTotals.volume : 0;
      var prevTicket = prevTotals.financiada ? prevTotals.producao / prevTotals.financiada : 0;
      var prevExtraFam = A.familyExtraMetrics(previousResults, previousModelRows);
      prev = { totals: prevTotals, pen: prevPen, ticket: prevTicket, extraFam: prevExtraFam };
    }
    // formatter mirrors whichever A.xxx() call built `value`, applied to
    // prevNum too (Gate 7: previous MUST use the exact same formatter as
    // current).
    function box(label, value, curNum, prevNum, formatter) {
      var cmp = (prev && prevNum != null) ? previousValueHtml(A, curNum, prevNum, formatter(prevNum), true) : '';
      return '<div class="dbFamilyMetricBox"><div class="dbK">' + esc(label) + '</div><div class="dbV">' + value + cmp + '</div></div>';
    }
    var fmtNum = function (v) { return A.num(v); };
    var fmtMoney = function (v) { return A.money(v); };
    var fmtPct = function (v) { return A.pct(v); };
    var fmtPrazo = function (v) { return A.num(v, 1) + 'x'; };
    return '<div class="dbFamilyMetricGrid">' +
      box('Volume vendido', A.num(totals.volume), totals.volume, prev ? prev.totals.volume : null, fmtNum) +
      box('Financiamentos', A.num(totals.financiada), totals.financiada, prev ? prev.totals.financiada : null, fmtNum) +
      box('Penetração', A.pct(pen), pen, prev ? prev.pen : null, fmtPct) +
      box('Produção', A.money(totals.producao), totals.producao, prev ? prev.totals.producao : null, fmtMoney) +
      box('Receita', A.money(totals.receita), totals.receita, prev ? prev.totals.receita : null, fmtMoney) +
      box('Receita SPF', A.money(totals.receitaSPF), totals.receitaSPF, prev ? prev.totals.receitaSPF : null, fmtMoney) +
      box('Receita Total', A.money(totals.receitaTotal), totals.receitaTotal, prev ? prev.totals.receitaTotal : null, fmtMoney) +
      box('Ticket médio', A.money(ticket), ticket, prev ? prev.ticket : null, fmtMoney) +
      box('Média de retorno', A.pct(extraFam.retornoMedio), extraFam.retornoMedio, prev ? prev.extraFam.retornoMedio : null, fmtPct) +
      box('Prazo médio', A.num(extraFam.prazoMedio, 1) + 'x', extraFam.prazoMedio, prev ? prev.extraFam.prazoMedio : null, fmtPrazo) +
      box('Média de parcela', A.money(extraFam.pmtMed), extraFam.pmtMed, prev ? prev.extraFam.pmtMed : null, fmtMoney) +
      box('Entrada média', A.money(extraFam.entradaMed), extraFam.entradaMed, prev ? prev.extraFam.entradaMed : null, fmtMoney) +
      box('% Entrada médio', A.pct(extraFam.entradaPct), extraFam.entradaPct, prev ? prev.extraFam.entradaPct : null, fmtPct) +
      '</div>';
  }

  function planClassificationHtml(A, counts) {
    return '<h2 style="margin-top:0">Classificação dos Planos <span class="dbMuted dbPlanScope">· Somente Novos</span></h2>' +
      '<div class="dbPlanGrid">' + ['SUBSIDIADO', 'REVERSÃO', 'COPARTICIPADO', 'BALÃO', 'LINEAR'].map(function (t) { return planCardHtml(A, t, counts[t]); }).join('') + '</div>' +
      '<p class="dbMuted">Somente Novos: conta apenas as operações de financiamento de Novos no período e na loja selecionados (Seminovos não entram), por isso a soma bate com Financiamentos da visão Novos. Classificação oficial por operação, mesma prioridade de Análise F&I do Grupo e Coparticipado: Código IF 999 ou SUBSIDIADO; Código IF 777 ou REVERSÃO; TC Devolvida 1 ou COPARTICIPADO; Balão PMT maior que zero; demais = LINEAR.</p>';
  }

  // FC-1 (GAP-001): factored out of modelAnalysisHtml so the SAME
  // construction (isReal branch + fixture-only plan-count merge) runs
  // unchanged for both the current and the previous period -- SAME_
  // PIPELINE_DIFFERENT_PERIOD, no separate/simplified previous-period logic.
  function modelRowsForAnalysis(A, results, isReal) {
    // Dashbi Phase 2, Gate B3/B7: real transport builds modelRows DIRECTLY
    // from operational_model_metrics's own real per-model aggregates
    // (dashbi-real-view-model.js) rather than through modelRowsUnified()'s
    // fixture-oriented per-transaction reconstruction (which depends on raw
    // fields -- parcelas/pmt/chassi/valorVenda -- the real RPC deliberately
    // never returns). Real rows already carry correct subsidiadoQtd/
    // coparticipadoQtd (from the real plan_breakdown), so the fixture-only
    // planRowsByModel merge below must be skipped for real transport —
    // running it would silently zero those fields back out (planRowsByModel
    // reads results.fins, which real transport never populates with a
    // per-model dimension).
    var modelRows = isReal
      ? window.NX_DASHBI_REAL_VIEW_MODEL.modelRowsForFamily(results, currentFamily)
      : A.modelRowsUnified(results, currentFamily);
    if (!isReal) {
      var planRows = A.planRowsByModel(results, currentFamily);
      // PORTAL-NEXT-07.4.1 — merge Subsidiado/Coparticipado counts (already
      // extracted, already computed by planRowsByModel for this same family)
      // onto modelRowsUnified's rows by matching Modelo, so the PLANOS detail
      // group can show all 5 categories. Presentation-only merge — neither
      // function's own output is altered, no new calculation introduced. A
      // model with no matching planRows entry (not in FAMILY_MODELS' static
      // list) gets 0 for both. PORTAL-NEXT-07.5.1 removed this family's own
      // "Quantidade por tipo de plano / Modelo" table (redundant with this
      // same merge, per explicit human decision — see
      // docs/MODEL-ANALYSIS-REDUNDANT-SECTIONS-REMOVAL.md); planRows/
      // planRowsByModel itself stays, still required by this merge.
      var planByModelo = {};
      planRows.forEach(function (r) { planByModelo[r.Modelo] = r; });
      modelRows.forEach(function (r) {
        var p = planByModelo[r.Modelo];
        r.subsidiadoQtd = p ? p.Subsidiado : 0;
        r.coparticipadoQtd = p ? p.Coparticipado : 0;
      });
    }
    return modelRows;
  }

  function modelAnalysisHtml(A, results, counts, isReal, previousOut) {
    var modelRows = modelRowsForAnalysis(A, results, isReal);
    var previousModelRows = previousOut ? modelRowsForAnalysis(A, previousOut, isReal) : null;
    var prevByModelo = null;
    if (previousModelRows) {
      prevByModelo = {};
      previousModelRows.forEach(function (r) { prevByModelo[r.Modelo] = r; });
    }
    // inconsistenciaTritonRows() looks for a literal "INCONSISTÊNCIA
    // TRITON" sentinel modelo value that only Base01/Base02 cross-
    // validation (fixture-only, no equivalent for a single real source of
    // truth) ever produces -- safe to call unchanged, always empty for real.
    var tritonRows = A.inconsistenciaTritonRows(results);

    var tritonHtml = '';
    if (tritonRows.length) {
      var tritonBody = tritonRows.map(function (r) {
        return '<tr><td>' + esc(r.Base) + '</td><td>' + esc(r.Cliente) + '</td><td>' + esc(r.ModeloOriginal) + '</td><td>' + esc(r.Vendedor) + '</td></tr>';
      }).join('');
      tritonHtml = '<h3 class="dbSubHeading">Inconsistências TRITON</h3>' +
        '<p class="dbMuted">Registros classificados como TRITON com o modelo original divergente entre as bases — sinalizado, não corrigido automaticamente.</p>' +
        tableHtml(['Base', 'Cliente', 'Modelo original', 'Vendedor'], tritonBody ? [tritonBody] : [], 1, true);
    }

    return '<div class="dbModelSection">' +
      planClassificationHtml(A, counts) +
      '<h2>Análise por Modelos (Novos)</h2>' +
      '<p class="dbMuted">Selecione uma família para abrir os indicadores específicos dos modelos Novos.</p>' +
      vehicleSelectorHtml() +
      familyMetricGridHtml(A, results, modelRows, previousOut, previousModelRows) +
      '<h3 class="dbSubHeading">' + esc(currentFamily) + ' · Indicadores por modelo</h3>' +
      '<p class="dbMuted">Volume/Financiamentos/Penetração por modelo — clique em "+ Detalhes" para abrir Produção/Receita/Ticket/Retorno/Parcelamento (Prazo Médio, Parcela Média)/Entrada/Planos (Qtd Linear/Balão/Reversão, Balão Médio). Nenhuma métrica fica escondida, sem rolagem lateral.</p>' +
      modelPrimaryDetailTableHtml(A, modelRows, prevByModelo) +
      tritonHtml +
      '</div>';
  }

  function rankingRowHtml(A, list, kind) {
    var ns = 'ranking-' + kind;
    var rows = [];
    var cards = [];
    list.forEach(function (r, i) {
      var nome = r.Nome, sub = '';
      if (kind === 'vendedor') {
        var parts = String(r.Nome || '').split(' | ');
        nome = parts[0] || r.Nome;
        sub = parts.length > 1 ? parts.slice(1).join(' · ') : '';
      }
      var key = kind + '-' + i;
      var detailGroups = [
        { label: 'Detalhe', items: [
          { label: 'Receita', value: esc(A.money(r.receita)) },
          { label: 'Receita SPF', value: esc(A.money(r.receitaSPF)) },
          { label: 'Retorno', value: esc(A.pct(r.retorno)) }
        ] }
      ];
      rows.push('<tr><td data-th="#">' + (i + 1) + 'º</td><td data-th="Nome">' + esc(nome) + (sub ? '<div class="dbTableSub">' + esc(sub) + '</div>' : '') + '</td>' +
        '<td class="dbNumCol" data-th="Vendas">' + esc(String(r.vendas)) + '</td>' +
        '<td class="dbNumCol" data-th="Financiamentos">' + esc(String(r.fin)) + '</td>' +
        '<td class="dbNumCol" data-th="Share">' + penetracaoCellHtml(A, r.penetracao) + '</td>' +
        '<td class="dbNumCol" data-th="Produção Total">' + esc(A.money(r.producao)) + '</td>' +
        '<td class="dbNumCol" data-th="Receita Total">' + esc(A.money(r.receitaTotal)) + '</td>' +
        '<td class="dbDetailToggleCell">' + detailToggleHtml(ns, key) + '</td></tr>' +
        detailRowHtml(ns, key, 8, detailGroups));

      var primaryFieldsHtml =
        dbMobileField('Vendas', esc(String(r.vendas)), 'dbMobileFieldPair') +
        dbMobileField('Financiamentos', esc(String(r.fin)), 'dbMobileFieldPair') +
        dbMobileField('Share', penetracaoCellHtml(A, r.penetracao), 'dbMobileFieldEmph') +
        dbMobileField('Produção Total', esc(A.money(r.producao))) +
        dbMobileField('Receita Total', esc(A.money(r.receitaTotal)));
      cards.push(dbMobileCard(ns, key, (i + 1) + 'º ' + nome, sub || null, primaryFieldsHtml, detailGroups));
    });
    return { rowsHtml: rows.join(''), cards: cards };
  }

  function rankingTableHtml(A, title, list, kind) {
    if (!list.length) return '<h3 class="dbSubHeading">' + esc(title) + '</h3><p class="dbMuted">Sem dados.</p>';
    var built = rankingRowHtml(A, list, kind);
    return '<h3 class="dbSubHeading">' + esc(title) + '</h3>' +
      '<div class="dbDesktopOnly"><div class="dbTableWrap"><table class="dbTable dbTableExpandable dbTableRanking"><thead><tr>' +
      // FC-1.3 (Gate 12, Ranking column priority): '#' is Ranking's actual
      // first-child, NOT the identity column -- the shared .dbTableExpandable
      // thead th:first-child{width:34%} rule (correct for Loja/Modelo, whose
      // identity column really is first) was misapplied here, starving
      // "Nome" (2nd column) of width instead. Explicit dbColRank/dbColName
      // classes fix this regardless of column position.
      headerRow(['#', 'Nome', 'Vendas', 'Financia­mentos', 'Share', 'Produção Total', 'Receita Total', ''], 2,
        ['dbColRank', 'dbColName', 'dbColCount', 'dbColCount', 'dbColPercent', 'dbColMoney', 'dbColMoney']) +
      '</tr></thead><tbody>' + built.rowsHtml + '</tbody></table></div></div>' +
      dbMobileListHtml(built.cards);
  }

  // PORTAL-NEXT-07.5.2 — human decision: Ranking > Departamentos removed
  // from the rendered UI (not required in the final analytical
  // experience) — presentation-only. A.rankingFromViews() itself is
  // shared with Vendedores/Lojas (kept, called with 'vendedor'/'loja'
  // below) and stays untouched; only the 'dept' call + its render was
  // removed. vendasDept/finDept (the underlying department aggregation
  // in aggregate()) were already unused by any other V2 surface before
  // this change (see docs/DASHBI-ANALYTICAL-HIERARCHY-INVENTORY.md) and
  // remain in the adapter, untouched — no business logic deleted.
  function rankingHtml(A, out, salesView, finsView) {
    var vendedores = A.rankingFromViews(salesView, finsView, 'vendedor').slice(0, 10);
    var lojas = A.rankingFromViews(salesView, finsView, 'loja').slice(0, 10);
    return '<div class="dbRankingSection">' +
      '<h2 style="margin-top:0">Ranking — ' + esc(currentDeptView) + '</h2>' +
      '<p class="dbMuted">Top 10, ordenado por maior Receita Total captada no período selecionado.</p>' +
      rankingTableHtml(A, 'Vendedores', vendedores, 'vendedor') +
      rankingTableHtml(A, 'Lojas', lojas, 'loja') +
      '</div>';
  }

  function novosLojaHtml(A, out) {
    var rows = A.buildNovosLojaRows(out);
    var ns = 'novosLoja';
    var desktopRows = [];
    var mobileCards = [];
    rows.forEach(function (r, i) {
      var cls = r._total ? ' class="dbTotalRow"' : '';
      var key = r._total ? 'total' : (r.Loja + '-' + i);
      var share = r.Vendidos ? r.Financiados / r.Vendidos : 0;
      var detailGroups = [
        { label: 'Planos', items: [
          { label: 'Balão', value: esc(String(r.Balao)) },
          { label: '% Balão', value: esc(A.pct(r.BalaoPct)) },
          { label: 'Subsidiada', value: esc(String(r.Subsidiada)) },
          { label: 'Coparticipada', value: esc(String(r.Coparticipada)) },
          { label: 'Reversão', value: esc(String(r.Reversao)) },
          { label: 'Linear', value: esc(String(r.Linear)) }
        ] }
      ];
      desktopRows.push('<tr' + cls + '><td data-th="Loja">' + esc(r.Loja) + '</td>' +
        '<td class="dbNumCol" data-th="Vendidos">' + esc(String(r.Vendidos)) + '</td>' +
        '<td class="dbNumCol" data-th="Financiados">' + esc(String(r.Financiados)) + '</td>' +
        '<td class="dbNumCol" data-th="Share">' + penetracaoCellHtml(A, share) + '</td>' +
        '<td data-th="Plano Destaque">' + esc(r.PlanoDestaque || '-') + '</td>' +
        '<td class="dbDetailToggleCell">' + detailToggleHtml(ns, key) + '</td></tr>' +
        detailRowHtml(ns, key, 6, detailGroups));

      var primaryFieldsHtml =
        dbMobileField('Vendidos', esc(String(r.Vendidos)), 'dbMobileFieldPair') +
        dbMobileField('Financiados', esc(String(r.Financiados)), 'dbMobileFieldPair') +
        dbMobileField('Share', penetracaoCellHtml(A, share), 'dbMobileFieldEmph') +
        dbMobileField('Plano Destaque', esc(r.PlanoDestaque || '-'));
      var card = dbMobileCard(ns, key, r.Loja, null, primaryFieldsHtml, detailGroups);
      if (r._total) card = card.replace('class="dbMobileCard"', 'class="dbMobileCard dbMobileCardTotal"');
      mobileCards.push(card);
    });
    return '<div class="dbNovosLojaSection">' +
      '<h2 style="margin-top:0">Novos por Loja</h2>' +
      '<p class="dbMuted">Leitura por loja/unidade considerando apenas veículos Novos, respeitando o período selecionado.</p>' +
      '<div class="dbDesktopOnly"><div class="dbTableWrap"><table class="dbTable dbTableExpandable"><thead><tr>' +
      headerRow(['Loja', 'Vendidos', 'Financiados', 'Share', 'Plano Destaque', ''], 1) +
      '</tr></thead><tbody>' + desktopRows.join('') + '</tbody></table></div></div>' +
      dbMobileListHtml(mobileCards) +
      '</div>';
  }

  // DASHBI1 (PARITY-CHECK-1, gap 1/2) -- dashboard-wide Store filter.
  // Mirrors V1's own proven mechanism EXACTLY (origin/main:modules/analise-
  // geral-grupo-secure-original-layout.html): applyCurrentPeriodFilter()
  // (lines 4303-4313) filters the row-level sales/fins arrays by
  // x.loja===currentStoreFilter, THEN re-runs the SAME aggregate() the rest
  // of the pipeline already depends on -- zero new backend authority, zero
  // change to metric semantics, store selection just re-runs the existing
  // aggregation over a row subset. V2's own row-level records already carry
  // a `loja` field for both fixture transport (dashbi.adapter.js compute(),
  // p1.valid/p2.valid -- confirmed via direct read, resolveLoja()) and real
  // transport (dashbi-real-view-model.js buildSalesAndFins(): `loja:
  // row.store` on every synthetic sales/fins record, confirmed via direct
  // read) -- so this same filter-then-reaggregate works unchanged for
  // either transport, never touching any RPC/grant/permission.
  //
  // Model Analysis (real transport only) is NOT derived from sales/fins --
  // dashbi-real-view-model.js's modelRowsForFamily() reads out.modelMetricsRows
  // directly (operational_model_metrics's own per-(store,department,model)
  // rows, bypassing aggregate() entirely -- Gate B7/22, dashbi-real-view-
  // model.js header comment). V1's own equivalent second application site
  // (origin/main lines 4305-4312, applyCurrentPeriodFilter's own store-
  // filter branch, reproduced again for the model-analysis code path per
  // that file's line ~4305) has no real-transport analogue to miss here --
  // fixture transport's modelRowsUnified()/planRowsByModel() (dashbi.
  // adapter.js) read results.aggs/results.fins directly, already covered by
  // the sales/fins filtering above -- but modelMetricsRows must be filtered
  // by row.store separately, or real-transport Model Analysis would silently
  // stay Group-wide under a store filter (verified: dashbi-real-provider.js
  // sets row.store from the RPC's own `store` column, the SAME raw value
  // buildSalesAndFins() copies onto `loja` -- same value space, safe to
  // compare directly).
  function applyStoreFilter(out) {
    if (!out || out.blocked || !currentStoreFilter) return out;
    var A = window.NX_DASHBI_ADAPTER;
    var sales = (out.sales || []).filter(function (x) { return x.loja === currentStoreFilter; });
    var fins = (out.fins || []).filter(function (x) { return x.loja === currentStoreFilter; });
    var filtered = {};
    Object.keys(out).forEach(function (k) { filtered[k] = out[k]; });
    filtered.sales = sales;
    filtered.fins = fins;
    filtered.aggs = A.aggregate({ sales: sales, fins: fins });
    if (out.modelMetricsRows) {
      filtered.modelMetricsRows = out.modelMetricsRows.filter(function (r) { return r.store === currentStoreFilter; });
    }
    return filtered;
  }

  // DASHBI1 -- mirrors V1's populateStoreFilter() (origin/main lines 4401-
  // 4419): the selectable store list is derived DYNAMICALLY from the
  // currently-loaded, period-scoped (but NOT store-filtered) data itself,
  // never a hardcoded alias list. This is deliberate, not a shortcut: a
  // prior verification of the Secure backend's actual SQL (operational_
  // metrics/operational_model_metrics via resolve_store_temporal) found
  // these RPCs perform NO store-code canonicalization at all (unlike
  // Gestão's operational_fandi_dashboard, which does) -- they can return
  // raw/unmapped store strings or the literal fallback 'SEM LOJA'. Gestão's
  // own store-display.js CANONICAL_STORES 8-code list is therefore NOT a
  // safe source of truth for Dashbi's own store filter; deriving from the
  // real, already-authorized data actually loaded (exactly what V1 itself
  // does) is the only approach that can never drift from backend reality.
  function storeOptionsFromOut(out) {
    if (!out) return [];
    var set = {};
    (out.sales || []).forEach(function (x) { if (x.loja && x.loja !== 'NÃO LOCALIZADO') set[x.loja] = true; });
    (out.fins || []).forEach(function (x) { if (x.loja && x.loja !== 'NÃO LOCALIZADO') set[x.loja] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function populateStoreFilterSelect(out) {
    var sel = document.getElementById('dbStoreFilter');
    if (!sel) return;
    var stores = storeOptionsFromOut(out);
    var current = currentStoreFilter;
    sel.innerHTML = '<option value="">Todas as lojas</option>' + stores.map(function (l) {
      return '<option value="' + esc(l) + '"' + (l === current ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
    // V1 parity (populateStoreFilter): a previously-selected store that no
    // longer appears in this period's own data (e.g. after a period change)
    // silently resets to "Todas as lojas" rather than leaving a selection
    // pointing at data that no longer exists.
    if (current && stores.indexOf(current) === -1) {
      currentStoreFilter = '';
      sel.value = '';
    }
  }

  // Dashbi Phase 2 -- renderPanel draws a given, already-computed `out`
  // (fixture, via A.compute(), or real, via NX_DASHBI_REAL_VIEW_MODEL.
  // buildRealOut()) into #dbPanel. Kept transport-agnostic: every branch
  // that actually differs between fixture/real lives in modelAnalysisHtml
  // (Gate B7) or in the diagnostic footer below, gated by isReal.
  function renderPanel(out, isReal, previousOut) {
    var A = window.NX_DASHBI_ADAPTER;
    var panel = document.getElementById('dbPanel');
    // FC-1.1, CHANGE-03: subnav now lives in its own static shell slot
    // (#dbSubnav, positioned above the filters in pageShellHtml), not
    // inside #dbPanel's own rebuilt HTML -- rendered here, alongside the
    // panel, so it stays in sync with currentDeptView/currentMode on every
    // render() without duplicating the "single active region" logic.
    var subnav = document.getElementById('dbSubnav');

    if (out.blocked) {
      panel.innerHTML = '<div class="dbBlockedNotice"><b>Atenção:</b> existem ' + out.missingSellers.length +
        ' vendedor(es)/NBS não localizados na Base de Vendedores: ' + out.missingSellers.map(esc).join(', ') +
        '. A produção real também interrompe o processamento neste caso (mesmo comportamento reproduzido aqui — nenhum resultado parcial é exibido).</div>';
      if (subnav) subnav.innerHTML = '';
      currentOut = null;
      return;
    }
    // FC-2 (GAP-004): captured BEFORE any currentDeptView filtering below --
    // V1's exportarResumoCSV() read lastResults.aggs.shareLojaDept, i.e. the
    // full cross-department "Loja | Dept" aggregate computed once over the
    // whole authorized dataset, never the department-filtered deptOut used
    // by the on-screen "Vendas e Financiamentos por Loja" table. Preserving
    // that same full-dataset scope here, independent of currentDeptView.
    currentOut = out;

    // FC-1 (GAP-001): the previous period is complementary, never a reason
    // to fail/alter the current one (Gate 12, this Wave's brief) -- a
    // missing-seller block on the previous period only means "no
    // comparison available", same treatment as previousOut being absent
    // entirely (no comparison fixture picked / previous RPC fetch failed).
    var validPreviousOut = (previousOut && !previousOut.blocked) ? previousOut : null;
    var prevKpi = validPreviousOut ? A.kpiMetricsFor(validPreviousOut, currentDeptView) : null;

    var kpi = A.kpiMetricsFor(out, currentDeptView);
    var period = { min: null, max: null };
    var closed = false;
    if (currentPreset === 'CUSTOM' || currentPreset === 'lastMonth') {
      closed = A.isClosedMonthPeriod({ min: new Date(currentDateStart + 'T00:00:00'), max: new Date(currentDateEnd + 'T00:00:00') });
    }

    // Classificação dos Planos counts ONLY Novos operations, whatever the Visão button
    // (out.fins carries both departments; period and store are already applied to out).
    // Previously it counted every department, so its total equaled the Grupo's
    // Financiamentos (Novos + Seminovos) instead of the Novos one.
    var counts = { LINEAR: 0, 'BALÃO': 0, COPARTICIPADO: 0, SUBSIDIADO: 0, 'REVERSÃO': 0 };
    (out.fins || []).forEach(function (f) {
      if (f.dept !== 'Novos') return;
      var k = A.planoKeyOperacao(f);
      counts[k] = (counts[k] || 0) + 1;
    });

    var salesView = currentDeptView === 'Grupo' ? out.sales : out.sales.filter(function (x) { return x.dept === currentDeptView; });
    var finsView = currentDeptView === 'Grupo' ? out.fins : out.fins.filter(function (x) { return x.dept === currentDeptView; });

    // FC-1.2, DEFECT B (Human UAT): storeTableHtml was reading out.aggs
    // directly -- computed once by A.compute()/buildRealOut() over the
    // FULL, un-filtered sales/fins (aggregate() itself has no department
    // parameter, confirmed by direct source read: vendasLoja/finLoja/
    // vendasVendDept/finVendDept accumulate whatever rows they're given,
    // with no dept check -- unlike vendasModelo/finModelo/compModelo,
    // which DO hardcode `if (r.dept==='Novos')` inside aggregate() itself,
    // which is why Model Analysis was never affected by this defect).
    // Root cause: RENDER_USES_WRONG_DATASET -- storeTableHtml(A, out, ...)
    // always got the cross-department aggregate regardless of
    // currentDeptView, so "Vendas e Financiamentos por Loja" silently
    // showed the same Grupo-wide numbers under Novos/Seminovos too.
    // Fix mirrors V1's own pattern exactly (origin/main render():
    // `agView = aggregate({sales:salesView, fins:finsView})`, used for
    // its own per-loja tables) -- re-aggregate from the SAME already-
    // computed salesView/finsView, never a client-side re-filter of
    // out.aggs itself (which has no department dimension left once
    // aggregated) and never a derived Novos=Grupo-Seminovos subtraction.
    var deptOut = currentDeptView === 'Grupo' ? out : {
      sales: salesView, fins: finsView,
      aggs: A.aggregate({ sales: salesView, fins: finsView })
    };
    // Gate 12 (FC-1/FC-1.2): the previous period must use the SAME
    // department selection as the current one -- otherwise "Novos"
    // would compare against an unfiltered (Grupo-wide) previous period,
    // a subtler instance of the identical defect.
    var deptPreviousOut = null;
    if (validPreviousOut) {
      if (currentDeptView === 'Grupo') {
        deptPreviousOut = validPreviousOut;
      } else {
        var prevSalesView = validPreviousOut.sales.filter(function (x) { return x.dept === currentDeptView; });
        var prevFinsView = validPreviousOut.fins.filter(function (x) { return x.dept === currentDeptView; });
        deptPreviousOut = { sales: prevSalesView, fins: prevFinsView, aggs: A.aggregate({ sales: prevSalesView, fins: prevFinsView }) };
      }
    }

    // Reset to a valid mode if the current one is unavailable in this view
    // (e.g. leaving Novos while Model Analysis or Novos por Loja was active).
    // Production's own code (updateModelosTabVisibility) only wires this
    // fallback for the Modelos tab, not for Novos por Loja -- a real,
    // asymmetric gap confirmed by direct source read, not a deliberate rule
    // (Novos por Loja was added in a later UX iteration and the same
    // fallback branch was never extended to it). V2 applies the fallback
    // uniformly to both, closing that gap rather than reproducing it,
    // per this Wave's explicit "no blank page, no stale content" gate.
    if (modesForView(currentDeptView).indexOf(currentMode) === -1) currentMode = 'overview';
    if (subnav) subnav.innerHTML = modeNavHtml();

    var complementaryHtml = '';
    if (currentMode === 'modelos') complementaryHtml = modelAnalysisHtml(A, out, counts, isReal, validPreviousOut);
    else if (currentMode === 'ranking') complementaryHtml = rankingHtml(A, out, salesView, finsView);
    else if (currentMode === 'novosLoja') complementaryHtml = novosLojaHtml(A, out);
    else complementaryHtml = '<p class="dbMuted dbModeHint">Selecione uma análise complementar acima (Análise por Modelos, Ranking ou Novos por Loja) para abrir seus indicadores.</p>';

    var html =
      '<div class="modKpiGrid">' +
      kpiPrimary('Vendas', kpi.vendas, currentDeptView, prevKpi ? kpiCompareHtml(A, kpi.vendas, prevKpi.vendas, A.num(prevKpi.vendas)) : '') +
      kpiPrimary('Financiamentos', kpi.fins, null, prevKpi ? kpiCompareHtml(A, kpi.fins, prevKpi.fins, A.num(prevKpi.fins)) : '') +
      kpiShareCardHtml(A, kpi.share, prevKpi ? prevKpi.share : null) +
      kpiPrimary('Produção Total', A.money(kpi.producao), null, prevKpi ? kpiCompareHtml(A, kpi.producao, prevKpi.producao, A.money(prevKpi.producao)) : '') +
      kpiReceitaTotalCardHtml(A, kpi.receitaTotal, prevKpi ? prevKpi.receitaTotal : null) +
      '</div>' +
      '<div class="dbKpiDetailToggleWrap">' + detailToggleHtml('kpiDetail', 'main') + '</div>' +
      kpiDetailPanelHtml('kpiDetail', 'main', [
        { label: 'Complementares', items: [
          { label: 'Receita', value: esc(A.money(kpi.receita)) + (prevKpi ? previousValueHtml(A, kpi.receita, prevKpi.receita, A.money(prevKpi.receita), true) : '') },
          { label: 'Receita SPF', value: esc(A.money(kpi.receitaSPF)) + (prevKpi ? previousValueHtml(A, kpi.receitaSPF, prevKpi.receitaSPF, A.money(prevKpi.receitaSPF), true) : '') },
          { label: 'Retorno Médio', value: esc(A.pct(kpi.retorno)) + (prevKpi ? previousValueHtml(A, kpi.retorno, prevKpi.retorno, A.pct(prevKpi.retorno), true) : '') }
        ] }
      ]) +
      (closed ? '<div class="dbFechamentoBar"><span class="dbFechamento">FECHAMENTO</span><span class="dbMuted">Período filtrado corresponde a um mês fechado.</span></div>' : '') +

      // FC-1.1, CHANGE-02: "Vendas e Financiamentos por Vendedor" removed
      // from Visão Geral by explicit human decision (redundant with
      // Ranking, which is the dedicated seller-performance surface) --
      // see the note above sellerTableHtml's deletion.
      '<h2>Vendas e Financiamentos por Loja</h2>' +
      // FC-2 (GAP-004): restores V1's exportarResumoCSV() (orphaned/unreachable
      // in V1 production -- confirmed via grep, no button ever wired to it
      // there) as a discoverable-but-not-dominant action next to this table,
      // not a global "Exportar" -- Gate 27, this Wave's brief.
      '<div class="dbExportBar"><button type="button" class="dbBtn dbExportResumoBtn" id="dbExportResumoBtn">Exportar Excel</button>' +
      '<span id="dbExportResumoStatus" class="dbMuted dbExportStatus" role="status" aria-live="polite"></span></div>' +
      storeTableHtml(A, deptOut, deptPreviousOut) +

      complementaryHtml +

      // Dashbi Phase 2D, Gate 8: DIAGNOSTIC_PRODUCTION_VISIBILITY_DEBT --
      // this footer (like the fixture one below it) is dev/localhost
      // tooling, not user-facing product; gated the same way
      // environment-guard.js's own consumers already are, so it never
      // reaches a real production host. Gate 7: scope.is_master here is
      // the RPC's own internal per-call analytical-scope flag (Dashbi
      // Phase 2D, Gate 3-6 -- proven GROUP_VIEW_EFFECTIVE_SCOPE, not the
      // authenticated identity), never renamed in the raw payload
      // (backend contract untouched -- Gate 7 Option A) but labeled here
      // so it can't be misread as Auth Context's own separate isMaster.
      // development diagnostics: localhost with ?debug=1 only (NX_DEV), never homolog/production
      (!(window.NX_DEV && window.NX_DEV.ativo) ? '' :
      (isReal
        ? '<h2>Diagnóstico (dev only)</h2><p class="dbMuted">Fonte: backend real (operational_metrics / operational_model_metrics). "is_master" no escopo abaixo é o escopo analítico efetivo desta chamada (elevação de grupo autorizada pelo servidor), não a identidade autenticada. Escopo: <span class="dbDiagJson">' + esc(JSON.stringify(out.sourceInfo)) + '</span></p>'
        : (isReal ? '' :
          '<h2>Diagnóstico (dev only)</h2>' +
          '<p class="dbMuted">DADOS DE TESTE — não faz parte da experiência final. sourceInfo: <span class="dbDiagJson">' + esc(JSON.stringify(out.sourceInfo)) + '</span></p>' +
          '<p class="dbMuted">Entrada (bases novas): total financiamentos ' + out.entradaDiagnostic.totalFinanciamentos +
          ' · chassis localizados ' + out.entradaDiagnostic.chassisLocalizados +
          ' · não localizados ' + out.entradaDiagnostic.chassisNaoLocalizados +
          ' · taxa de sucesso ' + A.pct(out.entradaDiagnostic.taxaSucesso) + '</p>')));

    panel.innerHTML = html;
  }

  // Dashbi Phase 2, Gate B4/B5/B12 -- render() is the single entry point
  // every UI handler calls. Fixture path stays fully synchronous (Gate C2:
  // no behavior change, no accidental real network call). Real path fetches
  // both RPCs for the CURRENT period (p_start/p_end -- Gate B5, fixes the
  // fixture-era date-filter disconnect where currentDateStart/End never
  // actually constrained computation) and caches the result in realOut so
  // a mode/family/view/detail-toggle click (none of which change the
  // period) re-renders instantly without refetching. Date/preset changes
  // explicitly clear realOut (see wireEvents/applyPresetAndRender) to force
  // a fresh fetch. renderSeq guards a stale response from a superseded
  // fetch (same technique as gestao.js).
  function render() {
    if (!isRealTransport()) {
      var A = window.NX_DASHBI_ADAPTER;
      var input = buildFixtureInput(currentFixtureId);
      var out = A.compute(input);
      // FC-1 (GAP-001): SAME_PIPELINE_DIFFERENT_PERIOD -- A.compute() called
      // again, unchanged, against the comparison fixture's own raw rows.
      var previousOut = currentComparisonFixtureId ? A.compute(buildFixtureInput(currentComparisonFixtureId)) : null;
      // DASHBI1 -- store options derive from the CURRENT (not comparison)
      // period's own full, not-yet-store-filtered data, same source V1's
      // own populateStoreFilter(lastResults) uses; the store filter itself
      // is then applied (and re-aggregated) to both periods, same as V1's
      // applyCurrentPeriodFilter/filterResultsByDateRange apply it to
      // whichever results object they're given.
      populateStoreFilterSelect(out);
      renderPanel(applyStoreFilter(out), false, applyStoreFilter(previousOut));
      return;
    }
    if (realOut) {
      populateStoreFilterSelect(realOut);
      renderPanel(applyStoreFilter(realOut), true, applyStoreFilter(previousRealOut));
      return;
    }
    loadReal();
  }

  function loadReal() {
    var mySeq = ++renderSeq;
    var panel = document.getElementById('dbPanel');
    if (panel) panel.innerHTML = loadingHtml();
    // FC-1 (GAP-001): loadDashbiRealWithComparison fetches current+previous
    // as one logical request pair -- renderSeq (mySeq check below) already
    // treats them as a unit, so a superseded pair can never overwrite a
    // newer one (Gate 22, this Wave's brief), same technique already used
    // for the single-period fetch it replaces here.
    window.NX_DASHBI_REAL_PROVIDER.loadDashbiRealWithComparison({ start: currentDateStart, end: currentDateEnd }).then(
      function (payload) {
        if (mySeq !== renderSeq) return;
        realOut = window.NX_DASHBI_REAL_VIEW_MODEL.buildRealOut(payload.current.metrics, payload.current.modelMetrics);
        previousRealOut = payload.previous ? window.NX_DASHBI_REAL_VIEW_MODEL.buildRealOut(payload.previous.metrics, payload.previous.modelMetrics) : null;
        populateStoreFilterSelect(realOut);
        renderPanel(applyStoreFilter(realOut), true, applyStoreFilter(previousRealOut));
      },
      function (err) {
        if (mySeq !== renderSeq) return;
        // V2-SECURITY-02 (SEC-06): delegate to Auth Foundation's own
        // established session-expiry handling, same pattern as
        // gestao.js/score.js/coparticipado.js -- the mySeq guard above
        // already discards late/superseded responses before this fires.
        if (err && err.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
          window.NX_AUTH_CORE.reportSessionExpired();
          return;
        }
        var panel2 = document.getElementById('dbPanel');
        if (panel2) panel2.innerHTML = errorStateHtml(err && err.state, err && err.message);
      }
    );
  }

  // FI-UX-1 (Gate 9/22): local-calendar-date formatting -- NEVER
  // .toISOString(), which shifts the calendar date for hosts whose local
  // timezone sits ahead of UTC. Same small, independently-duplicated
  // pattern already validated in coparticipado.js's own localIso()
  // (FC-2.4) -- not extracted into a shared cross-module file for this
  // narrow fix (Gate 10: a small duplicated fix is safer here than a new
  // shared-utility layer that would also have to avoid touching Score).
  function localIso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // V2-UAT-01 -- Human request: a FRESH real-mode session (this page
  // load has never initialized it before) must open with the current
  // local month (day 1) through today, not the hardcoded 2026-01-01..
  // 2026-12-31 default above (never derived from any real/current
  // date at all). Reuses the EXACT same 'currentMonth' math
  // applyPresetAndRender already uses below -- never a second,
  // divergent computation -- and the same local-calendar localIso()
  // (never .toISOString(), which can shift the day across a UTC
  // boundary). Runs at most once per page load (dateDefaultInitialized
  // guard) and only when isRealTransport() -- fixture mode's own
  // deterministic default (used by existing golden-fixture tests) is
  // completely untouched. A same-session re-entry into this module
  // (Human already interacted, or navigated away and back) is a no-op
  // here: currentDateStart/currentDateEnd already hold whatever the
  // Human last left them at, and this function never runs again for
  // the rest of this page's lifetime.
  function ensureDefaultPeriod() {
    if (dateDefaultInitialized || !isRealTransport()) return;
    dateDefaultInitialized = true;
    var today = new Date();
    currentDateStart = localIso(new Date(today.getFullYear(), today.getMonth(), 1));
    currentDateEnd = localIso(today);
    currentPreset = 'currentMonth';
  }

  function applyPresetAndRender(preset) {
    currentPreset = preset;
    // FI-UX-1 (Human-reported defect, root cause): this line previously
    // read `new Date(2026, 7, 30)` UNCONDITIONALLY, in BOTH fixture and
    // real mode -- a fixed reference date introduced for fixture-only
    // determinism back at PORTAL-NEXT-07's original migration (df67013),
    // before real-data transport existed (742b298 added it later without
    // ever branching this line). Its own comment claimed real mode
    // "matches V1's own real production behavior of computing presets off
    // the actual current date" while the code did the opposite -- "Mês
    // atual" resolved to 01/08->30/08 regardless of the genuine current
    // date. Fixture mode's own deterministic UAT/test behavior is
    // unchanged; only real mode now uses the genuine current local date.
    var today = isRealTransport() ? new Date() : new Date(2026, 7, 30);
    var start, end = today;
    if (preset === 'currentMonth') start = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (preset === 'lastMonth') { start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); }
    else if (preset === 'last6') start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    else if (preset === 'lastYear') start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    if (start) {
      currentDateStart = localIso(start);
      currentDateEnd = localIso(end);
      document.getElementById('dbDateStart').value = currentDateStart;
      document.getElementById('dbDateEnd').value = currentDateEnd;
    }
    document.querySelectorAll('.dbPresetBtn').forEach(function (b) { b.classList.toggle('dbBtnActive', b.dataset.preset === preset); });
    realOut = null;
    previousRealOut = null;
    render();
  }

  // DASHBI1 (PARITY-CHECK-1, gap 2/2) -- "Limpar período" (Clear period),
  // mirrors V1's clearPeriodFilter() (origin/main lines 4320-4325): blanks
  // the period back to "no constraint", re-renders, and — same as V1 —
  // never touches Store/Visão(dept)/Família(model) selection (V1's own
  // function body only assigns currentPeriodFilter and the two date input
  // values; currentStoreFilter/currentDeptView/currentFamily are untouched
  // by it, confirmed by direct source read).
  //
  // V1's "no constraint" (currentPeriodFilter={start:null,end:null,
  // mode:"all"}, blank date inputs) has no literal equivalent in V2's real
  // transport: operational_metrics/operational_model_metrics always require
  // p_start/p_end (Gate B5, dashbi-real-provider.js loadDashbiReal() rejects
  // INVALID_FILTER without both) — an unbounded fetch was never part of
  // this integration's contract. Reusing the EXISTING period-state
  // architecture (this Wave's brief) means restoring THIS FILE's own
  // already-established default for whichever transport is active, not
  // inventing a third date range:
  //   - real transport: the exact same currentMonth default
  //     ensureDefaultPeriod() applies on a fresh session (and
  //     applyPresetAndRender already exposes for its own "Mês atual"
  //     button) — same call, not a second computation.
  //   - fixture transport: this file's own pre-existing module-load default
  //     (DEFAULT_DATE_START/DEFAULT_DATE_END, CUSTOM preset) — ensureDefaultPeriod()
  //     never touches fixture mode, so these constants ARE its one and only
  //     default, unchanged since PORTAL-NEXT-07's original migration.
  function clearPeriod() {
    if (isRealTransport()) {
      applyPresetAndRender('currentMonth');
      return;
    }
    currentDateStart = DEFAULT_DATE_START;
    currentDateEnd = DEFAULT_DATE_END;
    currentPreset = 'CUSTOM';
    var dateStart = document.getElementById('dbDateStart');
    var dateEnd = document.getElementById('dbDateEnd');
    if (dateStart) dateStart.value = currentDateStart;
    if (dateEnd) dateEnd.value = currentDateEnd;
    document.querySelectorAll('.dbPresetBtn').forEach(function (b) { b.classList.remove('dbBtnActive'); });
    realOut = null;
    previousRealOut = null;
    render();
  }

  // V2-UAT-01 -- reflects currentPreset on the button that produced it
  // right after mount, so a Human-facing "Mês atual" default (or any
  // programmatic preset) shows as visually active immediately, exactly
  // like clicking it would (applyPresetAndRender's own existing
  // classList.toggle, same class, same selector) -- CUSTOM (fixture
  // mode's own unchanged default, or after a manual date edit) matches
  // no button, so none is highlighted, same as before this Wave.
  function syncPresetActiveClass() {
    document.querySelectorAll('.dbPresetBtn').forEach(function (b) { b.classList.toggle('dbBtnActive', b.dataset.preset === currentPreset); });
  }

  function wireEvents() {
    var fixtureSelect = document.getElementById('dbFixtureSelect');
    if (fixtureSelect) fixtureSelect.addEventListener('change', function (e) { currentFixtureId = e.target.value; render(); });
    var comparisonSelect = document.getElementById('dbComparisonFixtureSelect');
    if (comparisonSelect) comparisonSelect.addEventListener('change', function (e) { currentComparisonFixtureId = e.target.value; render(); });
    document.getElementById('dbDateStart').addEventListener('change', function (e) { currentDateStart = e.target.value; currentPreset = 'CUSTOM'; document.querySelectorAll('.dbPresetBtn').forEach(function (b) { b.classList.remove('dbBtnActive'); }); realOut = null; previousRealOut = null; render(); });
    document.getElementById('dbDateEnd').addEventListener('change', function (e) { currentDateEnd = e.target.value; currentPreset = 'CUSTOM'; document.querySelectorAll('.dbPresetBtn').forEach(function (b) { b.classList.remove('dbBtnActive'); }); realOut = null; previousRealOut = null; render(); });
    document.querySelectorAll('.dbPresetBtn').forEach(function (btn) { btn.addEventListener('click', function () { applyPresetAndRender(btn.dataset.preset); }); });
    // DASHBI1 (Phase 5)
    var clearPeriodBtn = document.getElementById('dbClearPeriodBtn');
    if (clearPeriodBtn) clearPeriodBtn.addEventListener('click', clearPeriod);
    // DASHBI1 (Phase 3) -- mirrors V1's setStoreFilter(): just updates
    // currentStoreFilter and re-renders, same as every other filter control
    // here (date inputs/presets/view buttons).
    var storeSelect = document.getElementById('dbStoreFilter');
    if (storeSelect) storeSelect.addEventListener('change', function (e) { currentStoreFilter = e.target.value || ''; render(); });
    document.querySelectorAll('.dbViewBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentDeptView = btn.dataset.view;
        document.querySelectorAll('.dbViewBtn').forEach(function (b) { b.classList.toggle('dbBtnActive', b === btn); });
        render();
      });
    });
    // .dbVehicleCard is re-created on every render() (it lives inside the
    // Model Analysis section, not the static filter bar), so it is wired
    // via delegation on the persistent #dbPanel container rather than a
    // one-time querySelectorAll like the static filter controls above.
    document.getElementById('dbPanel').addEventListener('click', function (e) {
      var btn = e.target.closest('.dbVehicleCard');
      if (!btn) return;
      currentFamily = btn.dataset.family;
      // Gate 16/44 (PORTAL-NEXT-07.4): reset expanded model detail rows on
      // family switch — a safe default, since no production/V2 authority
      // supports persisting expansion across a different model set.
      resetExpanded('modelIndicators');
      render();
    });
    // .dbModeBtn is re-created every render() too (its own available set
    // depends on currentDeptView) -- FC-1.1, CHANGE-03: delegated on
    // #dbSubnav now (its own static shell slot, above the filters), not
    // #dbPanel, since modeNavHtml() no longer renders inside #dbPanel.
    var subnavEl = document.getElementById('dbSubnav');
    if (subnavEl) subnavEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.dbModeBtn');
      if (!btn) return;
      currentMode = btn.dataset.mode;
      render();
    });
    // PORTAL-NEXT-07.4 — shared "+ Detalhes" toggle, delegated (every
    // detail button is re-created on each render()).
    document.getElementById('dbPanel').addEventListener('click', function (e) {
      var btn = e.target.closest('.dbDetailToggle');
      if (!btn) return;
      toggleExpanded(btn.dataset.detailNs, btn.dataset.detailKey);
      render();
    });
    // FC-2 (GAP-004)
    document.getElementById('dbPanel').addEventListener('click', function (e) {
      var btn = e.target.closest('.dbExportResumoBtn');
      if (!btn) return;
      exportResumoLojaXlsx(btn);
    });
  }

  // FC-2 (GAP-004): dataset/column contract ported field-for-field from V1's
  // exportarResumoCSV() (analise-geral-grupo-secure-original-layout.html) --
  // same 14 columns, same order, same rowsFromAgg(shareLojaDept,"Grupo")
  // source (already available byte-identically as
  // NX_DASHBI_ADAPTER.rowsFromAgg/aggregate). Two deliberate V2 adaptations,
  // both presentation-only (no business-value change), documented per
  // Gate 23/29:
  //  1) V1 wrote XLSX.writeFile(wb,"resumo_fi_brabus.csv") -- a ".csv"
  //     extension on a workbook built via XLSX.utils.book_new(), which
  //     SheetJS's own extension-sniffing turns into an actual CSV on disk
  //     despite the "Excel export" framing. V2 writes a genuine .xlsx file
  //     with a self-describing name instead of reproducing that defect.
  //  2) Real header-fill/number-format styling (xlsx-js-style via the
  //     shared helper) instead of V1's plain, unstyled json_to_sheet output.
  function exportResumoLojaXlsx(btn) {
    var now = Date.now();
    if (now - lastExportAt < 800) return; // debounce accidental double-click
    lastExportAt = now;
    var statusEl = document.getElementById('dbExportResumoStatus');
    var A = window.NX_DASHBI_ADAPTER;
    var rows = A.rowsFromAgg(currentOut.aggs.shareLojaDept, 'Grupo');
    if (!rows.length) {
      if (statusEl) statusEl.textContent = 'Nenhum dado disponível para exportação no período/filtro selecionado.';
      return;
    }
    var headers = ['Grupo', 'Vendas', 'Financiamentos', 'Penetracao', 'Receita', 'ReceitaSPF', 'ReceitaTotal', 'Producao', 'Retorno', 'MediaParcelas', 'MediaPMT', 'Balao', 'Linear', 'ValorMedioBalao'];
    var dataRows = rows.map(function (r) {
      return [
        r.Grupo, r.vendas || 0, r.fin || 0, r.penetracao || 0,
        r.receita || 0, r.receitaSPF || 0, r.receitaTotal || ((r.receita || 0) + (r.receitaSPF || 0)),
        r.producao || 0, r.retorno || 0, r.parcelasMed || 0, r.pmtMed || 0,
        r.balaoQtd || 0, r.linearQtd || 0, r.balaoMed || 0
      ];
    });
    var columnTypes = {
      moneyCols: new Set(['Receita', 'ReceitaSPF', 'ReceitaTotal', 'Producao', 'MediaPMT', 'ValorMedioBalao']),
      pctCols: new Set(['Penetracao', 'Retorno']),
      intCols: new Set(['Vendas', 'Financiamentos', 'Balao', 'Linear']),
      textCols: new Set(['Grupo'])
    };
    btn.disabled = true;
    try {
      var filename = 'DashBI_Resumo_Loja_' + window.NX_XLSX_EXPORT_HELPER.excelFileStamp() + '.xlsx';
      window.NX_XLSX_EXPORT_HELPER.downloadWorkbook(headers, dataRows, 'Resumo', filename, columnTypes);
      if (statusEl) statusEl.textContent = 'Exportado: ' + filename;
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Falha ao gerar o arquivo Excel. Tente novamente.';
    } finally {
      btn.disabled = false;
    }
  }

  // Dashbi Phase 2, Gate B4 -- pageShellHtml(isFixtureMode) keeps the
  // fixture banner/selector out of real mode's DOM entirely (no "DADOS DE
  // TESTE" label over real data), same principle as gestao.js's own
  // isRealTransport()-gated fixtureBanner.
  function pageShellHtml(isFixtureMode) {
    var fixtureBanner = '';
    if (isFixtureMode) {
      var fixtureOptions = fixturesData.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === currentFixtureId ? ' selected' : '') + '>' + esc(c.id) + '</option>'; }).join('');
      // FC-1 (GAP-001): fixture mode has no date range to derive a previous
      // period from (compute() is period-agnostic), so comparison here is
      // an explicit second fixture pick, defaulting to "Nenhuma" (no
      // comparison) -- never auto-selected, so every pre-existing golden-
      // fixture screenshot/test that never touches this control is
      // unaffected (Gate 26, this Wave's brief).
      var comparisonOptions = '<option value="">Nenhuma</option>' + fixturesData.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === currentComparisonFixtureId ? ' selected' : '') + '>' + esc(c.id) + '</option>'; }).join('');
      fixtureBanner = '<div class="modFixtureBanner"><span class="modFixtureLabel">DADOS DE TESTE (NEXT_LOCAL)</span>' +
        '<label for="dbFixtureSelect">fixture:</label><select id="dbFixtureSelect">' + fixtureOptions + '</select>' +
        '<label for="dbComparisonFixtureSelect">comparar com (período anterior):</label><select id="dbComparisonFixtureSelect">' + comparisonOptions + '</select></div>';
    }
    return '<div class="dbPage">' +
      '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Análise Geral do Grupo</h1><p class="modSubtitle">Visão analítica geral do Grupo Brabus Mitsubishi.</p></div></div>' +
      // FC-1.1, CHANGE-03 (Human UAT): subnav (Visão Geral/Análise por
      // Modelos/Ranking/Novos por Loja) moved here, right after the header
      // and BEFORE the filters -- it used to render at the bottom of
      // #dbPanel, reachable only after a long scroll past KPIs/tables
      // (Gate 16-17, this Wave's brief). This is the ONE subnav instance
      // (Gate 19: no duplicate at the old bottom position); its content is
      // filled by renderPanel() on every render (modeNavHtml() depends on
      // currentDeptView/currentMode, both of which can change). Distinct
      // from the "Visão" filter (Grupo/Novos/Seminovos) below -- two
      // different components, not merged (Gate 18).
      '<div id="dbSubnav" class="dbSubnav"></div>' +
      fixtureBanner +
      '<div class="modFilters">' +
      '<div class="modField"><label>Visão</label><div class="dbViewGroup">' +
      '<button type="button" class="dbBtn dbViewBtn dbBtnActive" data-view="Grupo">Grupo</button>' +
      '<button type="button" class="dbBtn dbViewBtn" data-view="Novos">Novos</button>' +
      '<button type="button" class="dbBtn dbViewBtn" data-view="Seminovos">Seminovos</button>' +
      '</div></div>' +
      '<div class="modField"><label>Período rápido</label><div class="dbPresetGroup">' +
      '<button type="button" class="dbBtn dbPresetBtn" data-preset="currentMonth">Mês atual</button>' +
      '<button type="button" class="dbBtn dbPresetBtn" data-preset="lastMonth">Mês anterior</button>' +
      '<button type="button" class="dbBtn dbPresetBtn" data-preset="last6">Últimos 6 meses</button>' +
      '<button type="button" class="dbBtn dbPresetBtn" data-preset="lastYear">Último ano</button>' +
      // DASHBI1 (Phase 5, PARITY-CHECK-1 gap 2/2) -- "Limpar período"
      // (Clear period), same .dbBtn segmented-control look as the preset
      // buttons it sits beside (V1 places it in the exact same button row,
      // origin/main line 2144), not its own .dbPresetBtn (it has no
      // "active" state to toggle -- see clearPeriod()).
      '<button type="button" class="dbBtn" id="dbClearPeriodBtn">Limpar período</button>' +
      '</div></div>' +
      '<div class="modField"><label for="dbDateStart">Data inicial</label><input id="dbDateStart" type="date" value="' + currentDateStart + '"></div>' +
      '<div class="modField"><label for="dbDateEnd">Data final</label><input id="dbDateEnd" type="date" value="' + currentDateEnd + '"></div>' +
      // DASHBI1 (Phase 3, PARITY-CHECK-1 gap 1/2) -- dashboard-wide Store
      // filter, same .modField wrapper as every other filter control here
      // (Visão/Período rápido/Data inicial/Data final). Options are filled
      // in by populateStoreFilterSelect() on every render() (mirrors V1's
      // own populateStoreFilter(), which also rebuilds the <select> from
      // the currently-loaded data on every render() call, origin/main line
      // 4401) -- starts with only "Todas as lojas" until the first render.
      '<div class="modField"><label for="dbStoreFilter">Loja</label><select id="dbStoreFilter"><option value="">Todas as lojas</option></select></div>' +
      '</div>' +
      '<div id="dbPanel"></div>' +
      '</div>';
  }

  window.NX_DASHBI_PAGE = {
    render: function (outlet) {
      ensureDefaultPeriod();
      if (isRealTransport()) {
        outlet.innerHTML = pageShellHtml(false);
        wireEvents();
        syncPresetActiveClass();
        render();
        return Promise.resolve();
      }
      return loadFixtures().then(function () {
        outlet.innerHTML = pageShellHtml(true);
        wireEvents();
        syncPresetActiveClass();
        render();
      });
    }
  };
})();
