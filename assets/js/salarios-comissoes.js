/* PORTAL-NEXT V2 — Salários & Comissões (RH-4B module shell).

   Functional contract reconstructed by direct source read of the real
   V1 implementation (portal-financiamento-brabus-secure, showComissoesModule()
   et al., RH-3 frontend audit) PLUS the live, read-only backend authority
   proven across RH-1/RH-2/RH-3/RH-3A. This file is presentation ONLY —
   every financial value (share/production/return/SPF/profitability) is
   rendered exactly as window.NX_SALARIOS_COMISSOES_REAL_PROVIDER (RH-4A)
   returns it; no commission formula (faixa/comissaoPrincipal/comissaoSpf/
   comissaoTotal) is computed here, matching PM-5I's own proven
   authoritative source (docs/COMMISSION-ENGINE-AUTHORITY.md).

   PROFILE-ADAPTIVE, NOT PROFILE-DUPLICATED: one module, server-governed
   data. Section visibility below is a UI convenience only (window.
   NX_AUTH_CORE.getContext() is explicitly documented as "never the
   actual security boundary") — every RPC re-checks profile/scope
   server-side regardless of what this file shows or hides:
     - Resumo/Equipe: every profile that reaches this module at all
       (operational_commission_metrics' own server-side scope already
       restricts which rows come back — RH-2: RH sees NOVOS+SEMINOVOS
       corporate-wide; VENDEDOR sees only themselves; etc.).
     - Analistas: MASTER/ANALISTA only — matches V1's own podeVerAnalista
       gate exactly (RH-3, portal-app.js:1499).
     - Gestor/Gerência: MASTER/GERENTE/DIRETOR only — matches V1's own
       podeVerGerente gate exactly (RH-3, portal-app.js:1506). This is
       the manager-aggregate view populated via loadManagerDirectory(),
       NOT V1's separate "COMISSÃO GESTOR DE F&I" single-hardcoded-
       identity feature (portal-app.js:6252-6297, gestorFIIdentidadeSegura())
       — that is a distinct, MASTER-only, single-person feature this
       Wave's own brief never names, and porting it would require a
       real production user id this file must not fabricate. Deferred,
       not implemented here.
     - HISTÓRICO: RH-4C introduced this tab against its own dedicated
       transport provider; RH-4D CONSOLIDATED it onto the pre-existing,
       already Human-UAT'd canonical historical authority instead
       (window.NX_MASTER_COMPETENCE_HISTORY_PROVIDER /
       window.NX_MASTER_COMPETENCE_HISTORY_VM, assets/js/adapters/
       master-competence-history-provider.js + assets/js/master-
       competence-history-view-model.js) — discovered during RH-4C's
       own authority audit to already implement this exact RPC family
       for Painel Master → Histórico de Competências. The RH-4C
       duplicate provider (salarios-comissoes-history-provider.js) was
       retired; this file now calls ZERO historical RPCs directly —
       every call goes through the SAME canonical transport Painel
       Master itself uses (accessed lazily via historyProvider()/
       historyVm() below, not cached at load time, since this module's
       own script tag loads before the canonical provider's in
       index.html — see index.html's own comment for why the tag order
       was deliberately left unchanged).
       Server-side gate confirmed live (RH-4C): every RPC this tab
       calls rejects any non-MASTER profile with 42501 as its FIRST
       executable statement — RH/DIRETOR/GERENTE/ANALISTA/VENDEDOR are
       rejected at the database layer, not merely hidden here. This tab
       remains a READ-ONLY VIEWER only (list closings, view a
       snapshot's classification/rows, view frozen operational detail,
       generate a governed CSV export of an already-valid closing) — it
       deliberately does NOT duplicate Painel Master's own closing/
       reopen (WRITE) actions or its full RH/DP multi-sheet export,
       which remain that screen's exclusive home.
       CPF: RH-4D also hardened the canonical provider itself (transport-
       level strip on getSnapshot/exportSnapshot) — this consumer never
       receives the field regardless, and neither does Painel Master's
       own consumer (verified: neither ever reads `.cpf`).
       SALARIOS_HISTORY_PROVIDER_NOT_STARTED (RH-3A/RH-4A) is resolved
       by this tab for the read/view surface specifically. */
(function () {
  'use strict';

  var PROVIDER = window.NX_SALARIOS_COMISSOES_REAL_PROVIDER;
  // Lazy accessors (RH-4D): the canonical provider/view-model scripts
  // load AFTER this file in index.html (Painel Master's own script
  // block), so a module-level `var X = window.NX_..._PROVIDER` captured
  // at IIFE-evaluation time would be `undefined` forever. Reading
  // window.* inside these functions instead means each call resolves
  // the real object at USE time, by which point every script tag has
  // already run (all Histórico interactions happen after user input,
  // well after page load completes).
  function historyProvider() { return window.NX_MASTER_COMPETENCE_HISTORY_PROVIDER; }
  function historyVm() { return window.NX_MASTER_COMPETENCE_HISTORY_VM; }
  // Maps the canonical provider's own error vocabulary ({state:
  // 'AUTH_DENIED'|'SESSION_EXPIRED'|'RPC_ERROR'|'MALFORMED_RESPONSE'|
  // 'TIMEOUT'|'NETWORK_ERROR'|'ABORTED', codigo, message}) onto this
  // tab's existing, already-tested UI states — never regresses the
  // user-facing distinctions RH-4C established (Gate 22).
  function mapHistoryError(err) {
    var state = err && err.state;
    var codigo = err && err.codigo;
    if (state === 'AUTH_DENIED') return 'PERMISSION_DENIED';
    if (state === 'SESSION_EXPIRED') return 'SESSION_EXPIRED';
    if (codigo === 'P0002') return 'INVALID_CLOSING';
    if (codigo === '22023') return 'BROKEN_CLOSING';
    return 'BACKEND_ERROR';
  }

  var outletRef = null;
  // SALFIX1: captured once per page mount (NX_SALARIOS_COMISSOES_PAGE.
  // render(), below) using the same "capture now, compare on resolution"
  // technique gestao.js's NAVFIX1 fix already established for the
  // identical class of bug -- a late-resolving RPC from one of this
  // module's 12 independent load* functions must never repaint the
  // outlet after the user has navigated to a different module entirely.
  // window.NX_ROUTER may not exist in this module's own isolated test
  // harnesses -- mountRoute stays null there and every guard below
  // becomes a no-op, preserving all existing harness-level tests.
  var mountRoute = null;
  // RH-5B.1 (Human UX rejection of the RH-5B tabbed layout, "achei meio
  // confuso... mantem o modelo de apresentação que já tinhamos no
  // modelo secure"): the real V1/Secure module (showComissoesModule()/
  // render(), portal-app.js:2045/6474) has NO Resumo/Equipe/Analistas/
  // Gestor tabs at all -- KPIs, the seller table (with the manager row
  // embedded as its own trailing <tr>, never a separate section/tab),
  // and the analyst table (a separate table below, always visible when
  // authorized, never a click-through tab) are ONE continuous stacked
  // page. The only real "navigation swap" in V1 is the rules hub
  // sending the whole dashboard to a full-page takeover for static
  // content (Regras/Gestor-FI/Histórico-RH) -- viewMode below
  // reproduces exactly that shape for Histórico specifically (the one
  // genuinely new, MASTER-only capability that has no V1 equivalent to
  // imitate, per Gate 18), while Resumo/Equipe/Analistas/Gestor are
  // merged back into one continuous view matching V1's own structure.
  var viewMode = 'atual'; // atual | historico

  var periods = null;
  var periodsState = 'LOADING'; // LOADING | READY | ERROR
  var selectedPeriodId = null;
  // Período personalizado: um "período" só desta tela (datas livres), servido pelas MESMAS RPCs e o
  // MESMO escopo de acesso dos períodos pré-definidos -- selectedPeriod() devolve {data_inicio,
  // data_fim} e todo o resto da tela segue igual. Nada é gravado; não substitui o fechamento.
  var CUSTOM_ID = '__personalizado__';
  var customRange = null;   // { data_inicio, data_fim } aplicado
  var customError = '';

  var dashboard = null; // {metrics, metricsError, analystMetrics, analystMetricsError, managerDirectory, managerDirectoryError}
  var dashboardState = 'LOADING'; // LOADING | READY | ERROR (ERROR only if the whole call rejected, e.g. invalid period)

  // RH-5B.3: real, live config-driven commission thresholds -- V1's own
  // static "Faixas de comissão" Rules Hub card (portal-app.js:6431-6444),
  // config-driven not period-specific, so fetched once at mount, never
  // re-fetched on period change. Presentation-only reference lookup,
  // never used to classify any individual row (see canonical file
  // header + the module-level comment near commissionRangesHtml below
  // for the exact authority-gap boundary this respects).
  var commissionConfig = null;
  var commissionConfigState = 'LOADING'; // LOADING | READY | ERROR

  // RH-5C.1: live (Atual/open-period only) governed Gestor F&I
  // commission -- fetched once at mount, only for MASTER (the server
  // rejects anyone else anyway; skipping the call for other profiles
  // avoids a guaranteed-to-fail request). NOT re-fetched on period
  // change by itself -- see loadGestorFiCommission's own call site,
  // wired into onPeriodChange alongside the rest of the dashboard.
  var gestorFi = null; // the real {pronto, comissao_final, ...} RPC response, or null
  var gestorFiState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var gestorFiError = null;

  // RH-5C.1: server-authoritative per-row Faixa classification
  // (VENDEDOR/GERENTE/ANALISTA), current/open period only, MASTER-only.
  // FIX-THE-DRIFT replacement for V1's own faixaBadge() -- see the
  // module header for the full authority narrative.
  var faixaRows = null; // real {rows:[{perfil,store,department,faixa,faixa_level,...}]} or null
  var faixaRowsState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var faixaRowsError = null;

  // RH-5F.3: self-scoped own-commission summary (VENDEDOR/GERENTE/
  // ANALISTA), current/open period only. Identity is derived server-side
  // from auth.uid() -- never a client-supplied target user -- so this is
  // safe to fetch for every profile that owns a personal commission
  // (unlike faixaRows above, MASTER-only and therefore skipped for
  // everyone else). Fetched independently of the main dashboard call,
  // same resilience discipline as loadGestorFiCommission/loadFaixaRows.
  var ownCommission = null; // real {rows:[...], comissao_total, profile} or null
  var ownCommissionState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var ownCommissionError = null;

  // RH-5F.3A (H-SAL-1/H-SAL-3): seller-level Faixa rows for the calling
  // ANALISTA's/GERENTE's own Salary-authorized store scope, plus a team
  // total. Same independent-fetch/self-scoped discipline as ownCommission
  // above -- identity from auth.uid() only, no store parameter.
  var scopeCommission = null; // real {rows:[...], team_comissao_total, profile} or null
  var scopeCommissionState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var scopeCommissionError = null;

  var detailsModal = null; // {sellerId, sellerName, state: 'LOADING'|'READY'|'ERROR', data, error}

  // ---------- Histórico state (RH-4C) ----------
  var historyClosings = null;
  var historyClosingsState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var historyClosingsError = null;
  var selectedClosingId = null;
  var historyDetail = null; // {state:'LOADING'|'READY'|'ERROR', data:{closing,rows,classification}, error}
  var historyOpDetail = null; // {state, data, error} -- lazy, only fetched on demand
  var historyExportState = 'IDLE'; // IDLE | LOADING | ERROR
  var historyExportError = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Pure string date formatting -- never a Date object, never
  // toISOString() -- matches this codebase's own established fix for
  // the UTC/local-calendar defect class (Score, Gestão, Dashbi,
  // Central de Atendimento's localIso()). Period start/end/dates
  // travel end-to-end as "YYYY-MM-DD" strings from the RPC.
  function fmtDateBR(iso) {
    if (!iso || typeof iso !== 'string') return '—';
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  function fmtInt(v) { return v == null ? '—' : String(v); }

  function getAuthContext() {
    return (window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.getContext === 'function') ? window.NX_AUTH_CORE.getContext() : null;
  }
  // Retorno/Rentabilidade: só para os perfis que o servidor autoriza a receber esses campos
  // (_operational_ocultar_retorno_vendedor: MASTER, DIRETOR, GERENTE, ANALISTA). Para os demais
  // (vendedor, RH) o servidor já não manda o dado; aqui só some a coluna/cartão vazio.
  function veRetorno() {
    var c = getAuthContext();
    var p = String((c && c.perfil) || '').trim().toUpperCase();
    return !!c && (c.isMaster === true || p === 'MASTER' || p.indexOf('DIRETOR') === 0 || p === 'GERENTE' || p === 'ANALISTA');
  }
  function soRetorno(html) { return veRetorno() ? html : ''; }
  // Presentation-only helpers (see file header) -- mirror V1's own
  // podeVerAnalista/podeVerGerente exactly, never a new rule.
  function canSeeAnalistas(ctx) {
    return !!ctx && (ctx.isMaster === true || ctx.perfil === 'ANALISTA');
  }
  function canSeeGestor(ctx) {
    return !!ctx && (ctx.isMaster === true || ctx.perfil === 'GERENTE' || String(ctx.perfil || '').indexOf('DIRETOR') === 0);
  }
  // RH-5C.1: MASTER-only, matching operational_gestor_fi_commission's/
  // operational_commission_faixa_rows' own live DB gate exactly (both
  // raise 42501 for any other profile) -- presentation-only
  // convenience, never the real boundary. Deliberately a SEPARATE
  // helper from canSeeGestor above: that one gates the per-store
  // manager/team-total trailing row (GERENTE/DIRETOR/MASTER); this one
  // gates the real "COMISSÃO — GESTOR F&I" single-identity group-wide
  // oversight commission (MASTER only) -- two distinct V1 concepts,
  // never conflated (see the file header's own long-standing note).
  function canSeeGestorFi(ctx) {
    return !!ctx && ctx.isMaster === true;
  }
  // MASTER-only, matching the real, live-confirmed DB gate on every
  // master_commission_* RPC exactly (RH-4C) -- presentation-only
  // convenience, the server rejects anyone else regardless.
  function canSeeHistorico(ctx) {
    return !!ctx && ctx.isMaster === true;
  }
  // RH-5F.3: the 3 profiles Secure has ever shown a personal commission
  // total to (portal-app.js buildComissionCards()/renderKpis() -- seller/
  // manager/analyst each get exactly one "Comissão"-labeled card; MASTER/
  // RH/DIRETOR never do, matching operational_own_commission_summary's
  // own server-side allow-list exactly -- this is presentation-only
  // convenience, the server decides for real).
  function canSeeOwnCommission(ctx) {
    return !!ctx && ['VENDEDOR', 'GERENTE', 'ANALISTA'].indexOf(ctx.perfil) !== -1;
  }
  // RH-5F.3A, Human decisions H-SAL-1/H-SAL-3: ANALISTA reviews sellers
  // in her own Salary-authorized store scope; GERENTE reviews their own
  // team. Never VENDEDOR (no team concept for a seller).
  function canSeeScopeCommission(ctx) {
    return !!ctx && (ctx.perfil === 'ANALISTA' || ctx.perfil === 'GERENTE');
  }

  // ---------- period lifecycle ----------

  function loadPeriods() {
    periodsState = 'LOADING';
    render(outletRef);
    return PROVIDER.loadCommissionPeriods().then(function (rows) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      periods = rows;
      periodsState = 'READY';
      // Gate 12 rule (documented): prefer the row flagged periodo_atual;
      // if none is flagged, fall back deterministically to the first
      // row returned -- the RPC itself already orders by data_inicio
      // desc, so "first" = most recent active period. Never inferred
      // from client-side date math.
      var current = rows.filter(function (p) { return p.periodo_atual === true; })[0];
      selectedPeriodId = (current || rows[0] || {}).id || null;
      // Link com ?de=&ate=: abre direto no intervalo personalizado (com a mesma validação da tela).
      var daUrl = lerIntervaloDaUrl();
      if (daUrl) {
        var errUrl = validarPeriodo(daUrl.data_inicio, daUrl.data_fim);
        if (errUrl) { customError = 'O período do link não foi aplicado: ' + errUrl; gravarIntervaloNaUrl(null); }
        else { customRange = daUrl; selectedPeriodId = CUSTOM_ID; customError = ''; }
      }
      render(outletRef);
      if (selectedPeriodId) return loadDashboard();
    }).catch(function () {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      periodsState = 'ERROR';
      render(outletRef);
    });
  }

  function selectedPeriod() {
    if (selectedPeriodId === CUSTOM_ID) {
      return customRange ? { id: CUSTOM_ID, nome_periodo: 'Período personalizado', data_inicio: customRange.data_inicio, data_fim: customRange.data_fim, personalizado: true } : null;
    }
    return (periods || []).filter(function (p) { return p.id === selectedPeriodId; })[0] || null;
  }

  // ---------- período personalizado: datas e validação ----------
  function hojeIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isoValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  // último dia permitido para o fim: início + 1 ano - 1 dia (ex.: 01/03/2026 → 28/02/2027)
  function limiteUmAno(ini) {
    var d = new Date(ini + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  // Última data aceita: o fim do ciclo atual (competência marcada como atual); sem ciclo atual, hoje.
  function limiteFim() {
    var atual = (periods || []).filter(function (p) { return p.periodo_atual === true; })[0];
    var hoje = hojeIso();
    return atual && isoValida(atual.data_fim) && atual.data_fim > hoje ? atual.data_fim : hoje;
  }
  function validarPeriodo(ini, fim) {
    if (!isoValida(ini) || !isoValida(fim)) return 'Informe a data inicial (De) e a data final (Até).';
    if (ini > fim) return 'A data "De" precisa ser igual ou anterior à data "Até".';
    var lim = limiteFim();
    if (fim > lim || ini > lim) return 'O período não pode passar do fim do ciclo atual (' + fmtDateBR(lim) + ').';
    if (fim > limiteUmAno(ini)) return 'O período pode ter no máximo 1 ano.';
    return '';
  }
  // Intervalo na URL (?de=AAAA-MM-DD&ate=AAAA-MM-DD), para recarregar e compartilhar o link com o filtro.
  function lerIntervaloDaUrl() {
    try {
      var q = new URLSearchParams(window.location.search);
      if (!q.has('de') && !q.has('ate')) return null;
      return { data_inicio: q.get('de') || '', data_fim: q.get('ate') || '' };
    } catch (e) { return null; }
  }
  function gravarIntervaloNaUrl(r) {
    try {
      var u = new URL(window.location.href);
      if (r) { u.searchParams.set('de', r.data_inicio); u.searchParams.set('ate', r.data_fim); }
      else { u.searchParams.delete('de'); u.searchParams.delete('ate'); }
      var novo = u.pathname + u.search + u.hash;
      if (novo !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, '', novo);
    } catch (e) { /* sem History API: o filtro só não fica no link */ }
  }
  function aplicarPersonalizado(ini, fim) {
    customError = validarPeriodo(ini, fim);
    if (customError) { render(outletRef); return false; }
    customRange = { data_inicio: ini, data_fim: fim };
    selectedPeriodId = CUSTOM_ID;
    gravarIntervaloNaUrl(customRange);
    loadDashboard();
    return true;
  }
  // Competência com exatamente as mesmas datas (o período escolhido coincide com uma competência).
  function competenciaIgual(r) {
    return (periods || []).filter(function (p) { return p.data_inicio === r.data_inicio && p.data_fim === r.data_fim; })[0] || null;
  }

  // Fetched once at mount, never re-fetched on period change -- these
  // are business RULES (config), not period-scoped data, matching V1's
  // own Rules Hub semantics exactly (a static reference, independent
  // of the selected period/store).
  function loadCommissionConfig() {
    commissionConfigState = 'LOADING';
    render(outletRef);
    return PROVIDER.loadPortalConfig().then(function (cfg) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      commissionConfig = cfg;
      commissionConfigState = 'READY';
      render(outletRef);
    }).catch(function () {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      commissionConfig = null;
      commissionConfigState = 'ERROR';
      render(outletRef);
    });
  }

  function loadDashboard() {
    var period = selectedPeriod();
    if (!period) return;
    dashboardState = 'LOADING';
    render(outletRef);
    loadGestorFiCommission(period);
    loadFaixaRows(period);
    loadOwnCommission(period);
    loadScopeCommission(period);
    return PROVIDER.loadCommissionDashboardData(period.data_inicio, period.data_fim).then(function (result) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      dashboard = result;
      dashboardState = 'READY';
      render(outletRef);
    }).catch(function () {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      dashboard = null;
      dashboardState = 'ERROR';
      render(outletRef);
    });
  }

  // RH-5C.1: live/open-period only, MASTER-only -- fired independently
  // of the main dashboard fetch (never blocks KPIs/Equipe/Analistas if
  // it fails or is slow), never fired at all for a non-MASTER profile
  // (the server would reject it with 42501 anyway; skipping avoids a
  // guaranteed-to-fail request). Re-fetched on every period change,
  // unlike loadCommissionConfig (a static reference, not period-scoped).
  function loadGestorFiCommission(period) {
    if (!canSeeGestorFi(getAuthContext())) { gestorFi = null; gestorFiState = 'IDLE'; gestorFiError = null; return; }
    gestorFiState = 'LOADING';
    render(outletRef);
    PROVIDER.loadGestorFiCommission(period.data_inicio, period.data_fim).then(function (result) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      gestorFi = result;
      gestorFiState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      gestorFi = null;
      gestorFiState = 'ERROR';
      gestorFiError = err;
      render(outletRef);
    });
  }

  // RH-5C.1: server-authoritative per-row Faixa, same MASTER-only/
  // live-period-only/independent-fetch discipline as
  // loadGestorFiCommission above.
  function loadFaixaRows(period) {
    if (!canSeeGestorFi(getAuthContext())) { faixaRows = null; faixaRowsState = 'IDLE'; faixaRowsError = null; return; }
    faixaRowsState = 'LOADING';
    render(outletRef);
    PROVIDER.loadCommissionFaixaRows(period.data_inicio, period.data_fim).then(function (result) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      faixaRows = result;
      faixaRowsState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      faixaRows = null;
      faixaRowsState = 'ERROR';
      faixaRowsError = err;
      render(outletRef);
    });
  }

  // RH-5F.3: self-scoped own-commission summary. Same independent-fetch/
  // fail-isolated discipline as loadGestorFiCommission/loadFaixaRows, but
  // fetched for VENDEDOR/GERENTE/ANALISTA (never MASTER -- that profile
  // has no personal commission concept in Secure, traced this Wave).
  function loadOwnCommission(period) {
    if (!canSeeOwnCommission(getAuthContext())) { ownCommission = null; ownCommissionState = 'IDLE'; ownCommissionError = null; return; }
    ownCommissionState = 'LOADING';
    render(outletRef);
    PROVIDER.loadOwnCommissionSummary(period.data_inicio, period.data_fim).then(function (result) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      ownCommission = result;
      ownCommissionState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      ownCommission = null;
      ownCommissionState = 'ERROR';
      ownCommissionError = err;
      render(outletRef);
    });
  }

  // RH-5F.3A: seller-scope Faixa rows (ANALISTA's/GERENTE's own store).
  function loadScopeCommission(period) {
    if (!canSeeScopeCommission(getAuthContext())) { scopeCommission = null; scopeCommissionState = 'IDLE'; scopeCommissionError = null; return; }
    scopeCommissionState = 'LOADING';
    render(outletRef);
    PROVIDER.loadScopeCommissionRows(period.data_inicio, period.data_fim).then(function (result) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      scopeCommission = result;
      scopeCommissionState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      scopeCommission = null;
      scopeCommissionState = 'ERROR';
      scopeCommissionError = err;
      render(outletRef);
    });
  }

  // Server-authoritative lookup used by row renderers (Equipe/
  // Analistas) to attach a Faixa badge -- returns null (never a
  // fabricated classification) if the rows haven't loaded/aren't
  // authorized/no match exists for this specific row.
  function faixaFor(perfil, store, department, sellerId) {
    if (!faixaRows || !Array.isArray(faixaRows.rows)) return null;
    return faixaRows.rows.filter(function (r) {
      if (r.perfil !== perfil) return false;
      if (perfil === 'VENDEDOR') return sellerId != null && r.seller_id === sellerId;
      if (perfil === 'GERENTE') return r.store === store && r.department === department;
      if (perfil === 'ANALISTA') return r.store === store;
      return false;
    })[0] || null;
  }

  // RH-5F.3: fallback match for the AUTHENTICATED ANALYST's own row only,
  // sourced from ownCommission (self-scoped server data) rather than
  // faixaRows (MASTER-only, always null for an ANALISTA session -- see
  // canSeeGestorFi). Never used for any other row: ownCommission.rows
  // only ever contains rows the server has already filtered to the
  // calling analyst's own name (operational_own_commission_summary), so
  // a row belonging to a colleague (e.g. a covering substitute) simply
  // never matches here, regardless of store. Matched on (store, transfer)
  // together -- an analyst covering a second store has 2 legitimate rows
  // (her own store's official row + the covered store's transfer row).
  function ownAnalystFaixaMatch(r) {
    var ctx = getAuthContext();
    if (!ctx || ctx.perfil !== 'ANALISTA') return null;
    if (!ownCommission || !Array.isArray(ownCommission.rows)) return null;
    return ownCommission.rows.filter(function (x) {
      return x.perfil === 'ANALISTA' && x.store === r.store && !!x.transfer === !!r.transfer;
    })[0] || null;
  }

  // RH-5F.3A, H-SAL-1/H-SAL-2/H-SAL-3: seller-row Faixa match. Tries the
  // MASTER-only source first (unchanged, so MASTER's own rendering is
  // byte-identical to before); falls back to the caller's own
  // self-scoped data only -- scopeCommission (ANALISTA's/GERENTE's own
  // store, server-filtered) for those two profiles, or ownCommission
  // (VENDEDOR's own single row) for a seller viewing themselves. Never
  // exposes a seller outside whatever the server already scoped.
  function sellerFaixaMatch(sellerId) {
    var direct = faixaFor('VENDEDOR', null, null, sellerId);
    if (direct) return direct;
    var ctx = getAuthContext();
    if (!ctx || sellerId == null) return null;
    if ((ctx.perfil === 'ANALISTA' || ctx.perfil === 'GERENTE') && scopeCommission && Array.isArray(scopeCommission.rows)) {
      var m = scopeCommission.rows.filter(function (r) { return r.perfil === 'VENDEDOR' && r.seller_id === sellerId; })[0];
      if (m) return m;
    }
    if (ctx.perfil === 'VENDEDOR' && ownCommission && Array.isArray(ownCommission.rows)) {
      var m2 = ownCommission.rows.filter(function (r) { return r.perfil === 'VENDEDOR' && r.seller_id === sellerId; })[0];
      if (m2) return m2;
    }
    return null;
  }

  // RH-5F.3A, H-SAL-3: the manager's OWN trailing row (named .salManagerRow,
  // a real identified manager -- never .salTeamTotalRow's generic
  // aggregate, which intentionally carries no commission concept at all).
  // Falls back to ownCommission (the caller's own GERENTE bucket(s)) only
  // when the MASTER-only source has no match and the session IS that
  // manager.
  function managerFaixaMatch(store, department) {
    var direct = faixaFor('GERENTE', store, department);
    if (direct) return direct;
    var ctx = getAuthContext();
    if (!ctx || ctx.perfil !== 'GERENTE' || !ownCommission || !Array.isArray(ownCommission.rows)) return null;
    return ownCommission.rows.filter(function (r) { return r.perfil === 'GERENTE' && r.store === store && r.department === department; })[0] || null;
  }

  function onPeriodChange(newId) {
    if (newId === selectedPeriodId) return;
    if (newId === CUSTOM_ID) {
      // Começa com as datas do período que estava selecionado (fim limitado a hoje); o usuário ajusta e aplica.
      var base = selectedPeriod() || {};
      var lim = limiteFim();
      var ini = customRange ? customRange.data_inicio : (base.data_inicio && base.data_inicio <= lim ? base.data_inicio : lim);
      var fim = customRange ? customRange.data_fim : (base.data_fim && base.data_fim <= lim ? base.data_fim : lim);
      aplicarPersonalizado(ini, fim);
      return;
    }
    customError = '';
    selectedPeriodId = newId;
    gravarIntervaloNaUrl(null);
    loadDashboard();
  }

  // ---------- Detalhes (operational detail foundation only — Gate 18:
  // NOT historical snapshot detail, NOT COMPLETE/LEGACY_PARTIAL) ----------

  function openDetails(sellerId, sellerName) {
    var period = selectedPeriod();
    if (!period) return;
    detailsModal = { sellerId: sellerId, sellerName: sellerName, state: 'LOADING', data: null, error: null };
    render(outletRef);
    PROVIDER.loadSalaryDetails(period.data_inicio, period.data_fim, sellerId).then(function (data) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (!detailsModal || detailsModal.sellerId !== sellerId) return;
      detailsModal.state = 'READY';
      detailsModal.data = data;
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (!detailsModal || detailsModal.sellerId !== sellerId) return;
      detailsModal.state = 'ERROR';
      detailsModal.error = err;
      render(outletRef);
    });
  }
  function closeDetails() { detailsModal = null; render(outletRef); }

  // RH-5F.1, Human decision: Analyst Details must explain the F&I
  // composition of an Analyst's Salary commission -- server-
  // authoritative operation-level data (operational_salary_details,
  // bulk mode: p_seller_id=null), never a client-side re-derivation of
  // WHICH chassis belong to the Analyst. The only client-side logic
  // here is a date-range FILTER using boundaries that are themselves
  // already-authoritative RPC fields (each coverage row's own
  // covered_start/covered_end, from operational_analyst_commission_
  // metrics_v2 -- the SAME response this Analyst row itself came from):
  //   - a COVERAGE row (transfer:true): operations within
  //     [covered_start, covered_end] for that store.
  //   - the OFFICIAL row: operations for that store across the WHOLE
  //     period, EXCLUDING any date inside ANY coverage row's own window
  //     for that same store (mirrors what the RPC's own
  //     "greatest(total - absence, 0)" subtraction represents, using
  //     only already-authoritative boundaries -- the commission formula
  //     itself is never re-derived).
  var analystDetailsModal = null; // {row, state:'LOADING'|'READY'|'ERROR', data, error, operations}

  function openAnalystDetails(row) {
    var period = selectedPeriod();
    if (!period) return;
    var coverageWindows = ((dashboard && dashboard.analystMetrics && dashboard.analystMetrics.rows) || [])
      .filter(function (r) { return r.store === row.store && r.transfer === true; })
      .map(function (r) { return { start: r.covered_start, end: r.covered_end }; });
    analystDetailsModal = { row: row, state: 'LOADING', data: null, error: null, operations: null };
    render(outletRef);
    // A loja vai para o servidor: o limite de linhas passa a valer só para a loja, não para o grupo todo.
    PROVIDER.loadSalaryDetails(period.data_inicio, period.data_fim, null, row.store).then(function (data) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (!analystDetailsModal || analystDetailsModal.row !== row) return;
      var allRows = (data && data.rows) || [];
      var inWindow = function (dateStr, start, end) { return dateStr >= start && dateStr <= end; };
      var filtered = allRows.filter(function (op) {
        if (op.store !== row.store) return false;
        if (!op.included_in_commission) return false;
        if (row.transfer) {
          return !!(op.date && row.covered_start && row.covered_end && inWindow(op.date, row.covered_start, row.covered_end));
        }
        return !coverageWindows.some(function (w) {
          return !!(w.start && w.end && op.date && inWindow(op.date, w.start, w.end));
        });
      });
      analystDetailsModal.state = 'READY';
      analystDetailsModal.data = data;
      analystDetailsModal.operations = filtered;
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (!analystDetailsModal || analystDetailsModal.row !== row) return;
      analystDetailsModal.state = 'ERROR';
      analystDetailsModal.error = err;
      render(outletRef);
    });
  }
  function closeAnalystDetails() { analystDetailsModal = null; render(outletRef); }

  // ---------- Histórico lifecycle (RH-4C, consolidated onto the
  // canonical transport authority in RH-4D — see file header) ----------

  // Structural classification, reusing the canonical view-model's own
  // isStructurallyInconsistent predicate verbatim (Gate 11: "one
  // authoritative frontend interpretation... centralize it in the
  // canonical historical authority/view-model") rather than keeping a
  // second, independently-maintained copy of the same logic.
  function classifyClosing(closingMeta, rows) {
    var vm = historyVm();
    if (vm && vm.isStructurallyInconsistent(rows)) return 'BROKEN';
    if (closingMeta && closingMeta.historical_detail_status === 'COMPLETE') return 'COMPLETE';
    return 'LEGACY_PARTIAL';
  }

  function loadHistoryClosings() {
    var provider = historyProvider();
    if (!provider) { historyClosingsState = 'ERROR'; historyClosingsError = { state: 'BACKEND_ERROR' }; render(outletRef); return; }
    historyClosingsState = 'LOADING';
    render(outletRef);
    provider.listClosings({}).then(function (rows) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyClosings = rows.map(function (c) {
        return Object.assign({}, c, { preliminaryClassification: c.historical_detail_status === 'COMPLETE' ? 'COMPLETE' : 'LEGACY_PARTIAL' });
      });
      historyClosingsState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyClosingsState = 'ERROR';
      historyClosingsError = { state: mapHistoryError(err) };
      render(outletRef);
    });
  }

  function selectClosing(closingId) {
    if (closingId === selectedClosingId) return;
    selectedClosingId = closingId;
    historyOpDetail = null;
    historyExportState = 'IDLE';
    historyExportError = null;
    if (!closingId) { historyDetail = null; render(outletRef); return; }
    historyDetail = { state: 'LOADING', data: null, error: null };
    render(outletRef);
    var provider = historyProvider();
    provider.getSnapshot(closingId, {}).then(function (rows) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (selectedClosingId !== closingId) return;
      var meta = (historyClosings || []).filter(function (c) { return c.id === closingId; })[0] || null;
      historyDetail = { state: 'READY', data: { closing: meta || {}, rows: rows, classification: classifyClosing(meta, rows) }, error: null };
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      if (selectedClosingId !== closingId) return;
      historyDetail = { state: 'ERROR', data: null, error: { state: mapHistoryError(err) } };
      render(outletRef);
    });
  }

  function loadHistoryOperationalDetail() {
    if (!selectedClosingId) return;
    historyOpDetail = { state: 'LOADING', data: null, error: null };
    render(outletRef);
    historyProvider().loadOperationalSnapshot(selectedClosingId, {}).then(function (data) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyOpDetail = { state: 'READY', data: data, error: null };
      render(outletRef);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyOpDetail = { state: 'ERROR', data: null, error: { state: mapHistoryError(err) } };
      render(outletRef);
    });
  }

  // Client-side CSV built ONLY from already-governed, already-cpf-
  // stripped export data (Gate 29: approved business columns only, no
  // internal id/debug field). Gate 28: uses the FAIL-CLOSED export RPC
  // (never the plain viewer snapshot) as the sole data source, so a
  // BROKEN closing can never reach this function with real rows.
  var EXPORT_COLUMNS = [
    ['nome', 'Nome'], ['loja', 'Loja'], ['departamento', 'Departamento'],
    ['vendidas', 'Vendidas'], ['financiadas', 'Financiadas'], ['share', 'Share (%)'],
    ['producao', 'Produção'], ['retorno', 'Retorno'], ['spf_extra', 'SPF Extra'],
    ['spf_liquido', 'SPF Líquido'], ['rentabilidade_total', 'Rentabilidade'], ['comissao', 'Comissão']
  ];
  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildExportCsv(rows) {
    var header = EXPORT_COLUMNS.map(function (c) { return csvEscape(c[1]); }).join(';');
    var lines = rows.map(function (r) {
      return EXPORT_COLUMNS.map(function (c) { return csvEscape(r[c[0]]); }).join(';');
    });
    return [header].concat(lines).join('\r\n');
  }
  function triggerExport() {
    if (!selectedClosingId) return;
    historyExportState = 'LOADING';
    historyExportError = null;
    render(outletRef);
    // The OFFICIAL, fail-closed export RPC (exportSnapshot ->
    // master_commission_snapshot_export) is used, never the plain
    // viewer's already-fetched historyDetail.rows — same discipline
    // Painel Master's own historyExportXlsx follows (shell-admin.js),
    // now literally the same function call.
    historyProvider().exportSnapshot(selectedClosingId, {}).then(function (rows) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyExportState = 'IDLE';
      render(outletRef);
      var csv = buildExportCsv(rows);
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'fechamento-' + selectedClosingId + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function (err) {
      if (mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute) return; // SALFIX1: stale, navigated away
      historyExportState = 'ERROR';
      historyExportError = { state: mapHistoryError(err) };
      render(outletRef);
    });
  }

  // ---------- render: header / period selector / tabs ----------

  function periodSelectorHtml() {
    if (periodsState === 'ERROR') {
      return '<div class="modErrorState"><div class="modStateTitle">Não foi possível carregar os períodos.</div>' +
        '<button type="button" class="modBtn modBtnSecondary modBtnSm" id="salPeriodRetry" style="margin-top:10px">Tentar novamente</button></div>';
    }
    if (periodsState === 'LOADING' || !periods) {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando períodos…</div>';
    }
    if (!periods.length) {
      return '<div class="modEmptyState"><div class="modStateTitle">Nenhum período de comissão ativo.</div>Fale com a Administração do Portal.</div>';
    }
    var options = periods.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === selectedPeriodId ? ' selected' : '') + '>' +
        esc(p.nome_periodo || (fmtDateBR(p.data_inicio) + ' a ' + fmtDateBR(p.data_fim))) +
        (p.periodo_atual ? ' (atual)' : '') + '</option>';
    }).join('') + '<option value="' + CUSTOM_ID + '"' + (selectedPeriodId === CUSTOM_ID ? ' selected' : '') + '>Personalizado (escolher datas)</option>';
    var html = '<div class="modFilters"><label class="modField">Período<select id="salPeriodSelect">' + options + '</select></label>';
    if (selectedPeriodId === CUSTOM_ID) {
      var r = customRange || {};
      var lim = limiteFim();
      html += '<div class="modField"><label for="salCustomStart">De</label><input id="salCustomStart" type="date" max="' + lim + '" value="' + esc(r.data_inicio || '') + '"></div>' +
        '<div class="modField"><label for="salCustomEnd">Até</label><input id="salCustomEnd" type="date" max="' + lim + '" value="' + esc(r.data_fim || '') + '"></div>' +
        '<div class="modField"><label>&nbsp;</label><button type="button" class="modBtn modBtnSecondary" id="salCustomApply">Aplicar</button></div>';
    }
    html += '</div>';
    if (selectedPeriodId === CUSTOM_ID) html += customPeriodNoteHtml();
    else if (customError) html += '<div class="salCustomNotes"><p id="salCustomError" class="salCustomError" role="alert">' + esc(customError) + '</p></div>';
    return html;
  }

  // Aviso do período personalizado. Comportamento real das faixas (_operational_commission_faixa_formula):
  // tudo é calculado sobre o período inteiro, sem proporcionalidade -- o share é uma razão (não depende da
  // duração) e o limite de rentabilidade do vendedor é um valor fixo em R$ por período.
  function customPeriodNoteHtml() {
    var r = customRange;
    var c = commissionConfig || {};
    var partes = '<p id="salCustomNote" class="salCustomNote"><b>Valores calculados pelo Portal para o período escolhido. O valor oficial é o do fechamento da competência.</b></p>';
    if (customError) partes = '<p id="salCustomError" class="salCustomError" role="alert">' + esc(customError) + '</p>' + partes;
    if (r && !competenciaIgual(r)) {
      var lim = (c.limite_retorno_novos != null && c.limite_retorno_seminovos != null)
        ? ' (hoje ' + moneyInt(c.limite_retorno_novos) + ' em Novos e ' + moneyInt(c.limite_retorno_seminovos) + ' em Seminovos)' : '';
      partes += '<p id="salCustomFaixaNote" class="salCustomNote">Este período não coincide com uma competência. As faixas são aplicadas ao período inteiro, sem proporcionalidade: ' +
        'o share (financiadas ÷ vendidas) não depende da duração, mas o limite de rentabilidade do vendedor' + esc(lim) + ' é um valor fixo — ' +
        'num período mais curto que uma competência fica mais difícil atingir a faixa alta, e num mais longo, mais fácil. Gerente e analista dependem só do share. ' +
        'Este cálculo não substitui o fechamento.</p>';
    }
    return '<div class="salCustomNotes">' + partes + '</div>';
  }

  // Only ever 2 options, and only rendered at all for MASTER (the sole
  // profile with any historical authority, RH-4C/RH-5A live-proven) --
  // this is the ONE real navigation swap V1 itself has (the rules hub
  // sending the dashboard to a full-page takeover), not a peer-level
  // tab strip alongside Resumo/Equipe/Analistas/Gestor (which V1 never
  // had at all -- see the file header note above).
  function viewModeToggleHtml(ctx) {
    if (!canSeeHistorico(ctx)) return '';
    var modes = [{ id: 'atual', label: 'Atual' }, { id: 'historico', label: 'Histórico' }];
    return '<nav class="modTabGroup salViewModeToggle" aria-label="Modo de visualização">' + modes.map(function (m) {
      return '<button type="button" class="modTab' + (m.id === viewMode ? ' modTabActive' : '') + '" data-view-mode="' + m.id + '" aria-current="' + (m.id === viewMode ? 'page' : 'false') + '">' + esc(m.label) + '</button>';
    }).join('') + '</nav>';
  }

  // ---------- RH-5F.3: DSR (Descanso Semanal Remunerado) ----------
  // Byte-for-byte port of the pre-existing V1 authority (portal-app.js:
  // 6576-6626, calcDsrMes()/easterDate()/brHolidaysForYear()) -- traced
  // live this Wave, "Checkpoint D": DSR was ALREADY, in Secure itself,
  // "exclusivamente visual, somente para ANALISTA, e nunca integra
  // comissao_total oficial" -- a pure calendar function of the period's
  // reference month, always computed client-side, never server-side,
  // never part of any official total. This is not a new business
  // formula (Gate 46) -- it is the exact pre-existing one, deterministic
  // and fully recoverable, ported verbatim (same branch dates/rounding,
  // same Sundays+holidays/working-days composition).
  function dsrPad2(n) { return String(n).padStart(2, '0'); }
  function dsrIsoDate(y, m, d) { return y + '-' + dsrPad2(m + 1) + '-' + dsrPad2(d); }
  function dsrAddDaysIso(dateObj, days) {
    var d = new Date(dateObj.getTime());
    d.setDate(d.getDate() + days);
    return dsrIsoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function dsrEasterDate(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * mm + 114) / 31) - 1;
    var day = ((h + l - 7 * mm + 114) % 31) + 1;
    return new Date(year, month, day, 12, 0, 0, 0);
  }
  function dsrBrHolidaysForYear(year) {
    var e = dsrEasterDate(year);
    var list = [
      dsrIsoDate(year, 0, 1), dsrAddDaysIso(e, -47), dsrAddDaysIso(e, -2), dsrIsoDate(year, 3, 21),
      dsrIsoDate(year, 4, 1), dsrAddDaysIso(e, 60), dsrIsoDate(year, 8, 7), dsrIsoDate(year, 9, 12),
      dsrIsoDate(year, 10, 2), dsrIsoDate(year, 10, 15), dsrIsoDate(year, 10, 20), dsrIsoDate(year, 11, 25)
    ];
    return list.filter(function (v, idx) { return list.indexOf(v) === idx; });
  }
  // referenceIso: the period's data_fim (falling back to data_inicio),
  // matching V1's dsrReferenceDate() fim||ini rule exactly -- including
  // its own known imprecision (the DSR% is computed over the reference
  // date's CALENDAR MONTH, not the custom period's own day-span). Ported
  // as-is, not "fixed", per Gate 46.
  function calcDsrMes(referenceIso) {
    var parts = String(referenceIso || '').split('-').map(Number);
    var ref = parts.length === 3 && parts[0] ? new Date(parts[0], parts[1] - 1, parts[2] || 1, 12, 0, 0, 0) : new Date();
    var y = ref.getFullYear(), m = ref.getMonth();
    var diasMes = new Date(y, m + 1, 0).getDate();
    var domingos = 0;
    for (var d = 1; d <= diasMes; d++) { if (new Date(y, m, d, 12, 0, 0, 0).getDay() === 0) domingos++; }
    var feriados = dsrBrHolidaysForYear(y).filter(function (s) {
      var sp = s.split('-').map(Number);
      return sp[0] === y && (sp[1] - 1) === m && new Date(y, m, sp[2], 12, 0, 0, 0).getDay() !== 0;
    });
    var descansos = domingos + feriados.length;
    var diasUteis = diasMes - descansos;
    var pct = diasUteis > 0 ? (descansos / diasUteis) : 0;
    return { ano: y, mes: m + 1, diasMes: diasMes, domingos: domingos, feriados: feriados.length, descansos: descansos, diasUteis: diasUteis, pct: pct };
  }

  // ---------- RH-5F.3: own-commission summary cards ----------
  // Principal-summary cards (never buried only inside a table row, per
  // this Wave's own brief) for the 3 profiles Secure has ever shown a
  // personal commission total to. Fails closed to nothing (no card) on
  // LOADING/ERROR/no-value -- never a fabricated placeholder amount.
  // "Comissão Total" here is the SAME server value RH-5F.1's own table
  // column already calls Comissão Total (comissao_total from the pure,
  // governed formula) -- terminology reused, not reinvented (Gate 7).
  // "Comissão + DSR" reuses V1's own literal label for its visual-only
  // overlay total (portal-app.js:6729) -- ANALISTA only, matching Gate
  // 38's DSR-is-Analista-exclusive rule; VENDEDOR/GERENTE get only the
  // base "Comissão Total" card, which IS their final amount (no DSR
  // concept applies to those roles in Secure).
  // RH-5F.3A, Gate 6/10/11/13: no pre-existing Secure/V1 screen ever
  // rendered "MÁXIMA/INTERMEDIÁRIA/MÍNIMA" as literal user-facing text
  // (traced live this Wave -- faixaBadge()/faixaCellHtml() always used
  // ONLY the raw percentage + a color, never a text label) -- these are
  // the exact same already-governed faixa_level enum values the badges
  // already color by, with Portuguese diacritics added for display only.
  // Not a new business vocabulary, not an invented label.
  var FAIXA_LEVEL_LABEL = { MAXIMA: 'Máxima', INTERMEDIARIA: 'Intermediária', MINIMA: 'Mínima' };
  function faixaLevelLabel(level) { return FAIXA_LEVEL_LABEL[level] || level || '—'; }
  // RH-5F.3B, Human UAT correction: the compact tier badge reuses the
  // SAME modBadge* color tokens already in this codebase (module-
  // system.css) -- no new palette. Deliberately DIFFERENT mapping than
  // faixaBadgeHtml's row-level badge (MAXIMA/INTERMEDIARIA/MINIMA ->
  // success/warning/critical): the Human explicitly asked MÍNIMA to read
  // as a restrained warm/warning tone, not an alarming red ("Mínima é
  // uma faixa de comissão, não um erro da aplicação"), and INTERMEDIÁRIA
  // as a neutral/intermediate tone -- distinct requests for this NEW
  // compact component, never applied to the pre-existing, already-
  // Human-approved row badges (out of this Wave's scope, untouched).
  var FAIXA_TIER_CLASS = { MAXIMA: 'salTier--maximum modBadgeSuccess', INTERMEDIARIA: 'salTier--intermediate modBadgeInfo', MINIMA: 'salTier--minimum modBadgeWarning' };
  // Honest summary across 1+ own commission rows (an Analyst/Manager can
  // legitimately have more than one this period -- coverage, or 2
  // department buckets). Never picks one arbitrary faixa when they
  // differ (Gate 10) -- shows a governed "N faixas no período" instead.
  // RH-5F.3B, Human UAT correction: rendered as a COMPACT status/badge
  // card (modKpiCardSecondary, the same smaller-KPI-card variant this
  // codebase already has) -- a classification, never sized like a
  // primary financial KPI (Comissão Total/DSR/Comissão + DSR keep the
  // full-size treatment).
  function ownFaixaCompactHtml(rows) {
    if (!rows || !rows.length) return '';
    var levels = [];
    rows.forEach(function (r) { if (r.faixa_level && levels.indexOf(r.faixa_level) === -1) levels.push(r.faixa_level); });
    var badgeHtml, pctText;
    if (levels.length === 1) {
      var level = levels[0];
      badgeHtml = '<span class="modBadge salFaixaTierBadge ' + (FAIXA_TIER_CLASS[level] || 'modBadgeNeutral') + '">' + esc(faixaLevelLabel(level)) + '</span>';
      pctText = pct(Number(rows[0].faixa) * 100);
    } else {
      badgeHtml = '<span class="modBadge salFaixaTierBadge modBadgeNeutral">' + rows.length + ' faixas</span>';
      pctText = 'no período';
    }
    return '<div class="modKpiCard modKpiCardSecondary salFaixaCompactCard">' +
      '<p class="modKpiLabel">Faixa de Comissão</p>' +
      '<p class="salFaixaCompactValue">' + badgeHtml + ' · <span class="salFaixaPct">' + esc(pctText) + '</span></p>' +
      '</div>';
  }

  function ownCommissionKpiSectionHtml(ctx) {
    if (!canSeeOwnCommission(ctx)) return '';
    if (ownCommissionState !== 'READY' || !ownCommission) return '';
    var total = ownCommission.comissao_total;
    if (total == null) return '';
    var isAnalyst = ctx.perfil === 'ANALISTA';
    var cards = ownFaixaCompactHtml(ownCommission.rows);
    cards += kpiCard('Comissão Total', fmtMoney(total), isAnalyst ? '' : 'modKpiCardSuccess');
    if (isAnalyst) {
      var period = selectedPeriod();
      var ref = (period && (period.data_fim || period.data_inicio)) || null;
      var dsr = calcDsrMes(ref);
      var valorDsr = total * (dsr.pct || 0);
      var comDsr = total + valorDsr;
      cards += kpiCard('DSR do mês', fmtPct(dsr.pct * 100)) +
        kpiCard('Comissão + DSR', fmtMoney(comDsr), 'modKpiCardSuccess salOwnCommissionFinalCard');
    }
    return '<div class="modKpiGrid salOwnCommissionGrid">' + cards + '</div>';
  }

  // RH-5F.3A, H-SAL-3 (§14/§15): "Comissão Total da Equipe" is a SUM of
  // seller comissao_total values, deliberately never added to the
  // manager's own "Comissão Total" card above -- 2 separate concepts,
  // never a "Gerente + Equipe" figure.
  //
  // RH-5F.3B, Human UAT correction ("Remover o card de Comissão Total da
  // Equipe. Deixe só o da tabela mesmo"): the dedicated KPI card is
  // removed -- the value itself is NOT removed (Gate 15: "do not remove
  // the underlying value/server field"). Investigated first (Gate 16):
  // the Equipe table's own trailing row is EITHER .salManagerRow (a
  // real identified manager -- exactly this GERENTE's own case,
  // trailingGroupRow() above) showing HIS OWN commission, never a team
  // sum, OR .salTeamTotalRow (only when no manager identity is
  // resolvable, an entirely different viewer) -- there is no existing
  // table cell that is "the team total" for a manager viewing their own
  // team, and overwriting his own commission cell with the team sum
  // would conflate the 2 distinct values Gate 17 requires stay separate.
  // Kept instead as a plain caption directly above the Equipe table
  // (never another KPI card) -- the value stays visible next to the
  // table it summarizes, satisfying "visible in the table" without
  // fabricating a new row this narrow Wave shouldn't be adding.
  function teamCommissionCardsHtml(ctx) {
    if (!ctx || ctx.perfil !== 'GERENTE') return '';
    if (scopeCommissionState !== 'READY' || !scopeCommission) return '';
    var teamTotal = scopeCommission.team_comissao_total;
    if (teamTotal == null) return '';
    var dist = {};
    (scopeCommission.rows || []).forEach(function (r) {
      if (r.perfil !== 'VENDEDOR' || !r.faixa_level) return;
      dist[r.faixa_level] = (dist[r.faixa_level] || 0) + 1;
    });
    var distBadges = ['MAXIMA', 'INTERMEDIARIA', 'MINIMA'].filter(function (l) { return dist[l]; })
      .map(function (l) { return '<span class="modBadge salFaixaTierBadge ' + FAIXA_TIER_CLASS[l] + '">' + esc(faixaLevelLabel(l)) + ': ' + dist[l] + '</span>'; }).join(' ');
    return '<p class="modMuted salTeamFaixasNote">Comissão total da equipe: <b class="salTeamTotalInline">' + esc(fmtMoney(teamTotal)) + '</b>' +
      (distBadges ? ' &nbsp;·&nbsp; Faixas da equipe: ' + distBadges : '') + '</p>';
  }

  // ---------- render: Resumo ----------

  function kpiSectionHtml() {
    if (dashboardState === 'LOADING') return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando resumo do período…</div>';
    if (dashboardState === 'ERROR' || !dashboard) {
      return '<div class="modErrorState"><div class="modStateTitle">Não foi possível carregar os dados do período.</div>' +
        '<button type="button" class="modBtn modBtnSecondary modBtnSm" id="salDashRetry" style="margin-top:10px">Tentar novamente</button></div>';
    }
    if (dashboard.metricsError) {
      return errorStateFor(dashboard.metricsError, 'Resumo');
    }
    var t = (dashboard.metrics && dashboard.metrics.totals) || {};
    return (
      '<div class="modKpiGrid">' +
      kpiCard('Vendidas', fmtInt(t.sold_count)) +
      kpiCard('Financiadas', fmtInt(t.financed_count)) +
      kpiCard('Conversão', fmtPct(t.share_percent), conversionKpiClass(t.share_percent)) +
      kpiCard('Produção', fmtMoney(t.production_value)) +
      soRetorno(kpiCard('Retorno', fmtMoney(t.return_value))) +
      kpiCard('SPF Extra', fmtMoney(t.spf_value)) +
      kpiCard('SPF Líquido', fmtMoney(t.spf_net_value)) +
      soRetorno(kpiCard('Rentabilidade', fmtMoney(t.profitability_value), 'modKpiCardSuccess')) +
      '</div>' +
      (dashboard.analystMetricsError || dashboard.managerDirectoryError ? partialFailureNoteHtml() : '')
    );
  }
  // SAL-INTEGRATION-2, Human decision (supersedes RH-5F.1/H1): sibling
  // KPI cards must share one canonical value typography -- a longer
  // formatted string is not semantic hierarchy and must not silently
  // shrink its own value while siblings stay full size (Human-observed
  // defect: "Produção" visibly smaller than "Vendidas" in the same
  // row). RH-5F.1's per-value length-based size tiers are removed; the
  // single-line, no-wrap goal (still valid) is now met by widening the
  // KPI grid track itself (see .salPage .modKpiGrid in salarios-
  // comissoes.css) so every card -- not just the long ones -- has room
  // for the canonical .modKpiValue size, stress-tested up to
  // R$ 999.999.999,99. extraClass-driven semantic treatment (success/
  // info/etc.) is untouched -- that is real hierarchy, not a length
  // artifact.
  function kpiCard(label, value, extraClass) {
    return '<div class="modKpiCard' + (extraClass ? ' ' + extraClass : '') + '"><p class="modKpiLabel">' + esc(label) + '</p><p class="modKpiValue">' + esc(value) + '</p></div>';
  }
  function partialFailureNoteHtml() {
    return '<div class="modInfoState" style="text-align:left;padding:12px 16px"><div class="modStateTitle">Alguns dados do painel não puderam ser carregados</div>' +
      'As seções afetadas mostram um aviso específico — os dados disponíveis acima não foram descartados.</div>';
  }

  // ---------- render: Faixas de comissão (RH-5B.3) ----------
  // Human-identified gap: "onde mostra as faixas de comissão?" -- V1's
  // OWN answer to this exact question is a static, config-driven
  // reference card (renderCommissionRulesHub()/showCommissionRules(),
  // portal-app.js:6354-6472), never a per-row live classification. This
  // is that same reference, fed by the real, live, already-governed
  // operational_portal_config() RPC (RH-5B.3 forensic audit) -- values
  // are read verbatim from the server, never hardcoded, so this stays
  // accurate if the config ever changes. This card never attempts to
  // show which faixa a specific row/seller falls into -- that per-row
  // classification (once a real gap, RH-5B.3) is now closed by
  // operational_commission_faixa_rows (RH-5C.1) and rendered inline via
  // faixaFor()/faixaBadgeHtml() inside equipeHtml/analistasHtml instead
  // -- the two stay deliberately separate features/sections. A
  // native <details> disclosure, collapsed by default, matches V1's own
  // "reference you open when you need it" placement without competing
  // with the continuous KPI/Equipe/Analistas flow for attention.
  // RH-5C.1 fix: the original version formatted the raw Number as-is
  // (String(v)), which was safe for RH-5B.3's own callers (config
  // values like 3.5/4.5 parsed straight from text, exactly
  // representable in binary) but broke the moment this function got a
  // NEW caller multiplying a fraction by 100 for a Faixa badge (e.g.
  // 0.035*100 === 3.5000000000000004, a real IEEE-754 artifact,
  // visibly rendered as "3,50000000000000004%" before this fix, caught
  // via screenshot review). Rounding to 2 decimals first, via
  // toFixed+Number (which also strips any resulting trailing zeros),
  // fixes this for every caller without changing output for any
  // already-tested clean value (10/15/20/3.5/4.5 all round-trip
  // identically).
  function pct(v) {
    if (v == null) return '—';
    var n = Number(Number(v).toFixed(2));
    return String(n).replace('.', ',') + '%';
  }
  function moneyInt(v) { return v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function commissionRangesHtml() {
    if (commissionConfigState === 'LOADING') {
      return '<div class="modLoadingState" style="margin:var(--mod-space-control-gap) 0"><span class="modLoadingDot"></span> Carregando faixas de comissão…</div>';
    }
    if (commissionConfigState === 'ERROR' || !commissionConfig) {
      return '<div class="modErrorState" style="margin:var(--mod-space-control-gap) 0"><div class="modStateTitle">Não foi possível carregar as faixas de comissão.</div></div>';
    }
    var c = commissionConfig;
    function sellerLines(limite) {
      return '<li>Retorno + SPF líquido abaixo de ' + moneyInt(limite) + ' e Share abaixo de ' + pct(c.share_minimo) + ': <b>' + pct(c.vendedor_faixa_baixo_share_baixo) + '</b></li>' +
        '<li>Retorno + SPF líquido abaixo de ' + moneyInt(limite) + ' e Share ≥ ' + pct(c.share_minimo) + ': <b>' + pct(c.vendedor_faixa_baixo_share_alto) + '</b></li>' +
        '<li>Retorno + SPF líquido ≥ ' + moneyInt(limite) + ' e Share abaixo de ' + pct(c.share_minimo) + ': <b>' + pct(c.vendedor_faixa_alto_share_baixo) + '</b></li>' +
        '<li>Retorno + SPF líquido ≥ ' + moneyInt(limite) + ' e Share ≥ ' + pct(c.share_minimo) + ': <b>' + pct(c.vendedor_faixa_alto_share_alto) + '</b></li>';
    }
    return '<details class="salRangesDisclosure">' +
      '<summary>Faixas de comissão</summary>' +
      '<div class="salRangesBody">' +
      '<p class="modMuted">Comissão = (Retorno + ' + pct(c.spf_liquido_percentual) + ' do SPF Extra) × Faixa de comissão.</p>' +
      '<div class="salRangesGrid">' +
      '<div><h3 class="modSectionTitle" style="margin-top:0;font-size:0.8125rem">Vendedor — Novos</h3><ul>' + sellerLines(c.limite_retorno_novos) + '</ul></div>' +
      '<div><h3 class="modSectionTitle" style="margin-top:0;font-size:0.8125rem">Vendedor — Seminovos</h3><ul>' + sellerLines(c.limite_retorno_seminovos) + '</ul></div>' +
      '<div><h3 class="modSectionTitle" style="margin-top:0;font-size:0.8125rem">Gerente</h3><ul>' +
      '<li>Share abaixo de ' + pct(c.share_minimo) + ': <b>' + pct(c.gerente_faixa_share_baixo) + '</b></li>' +
      '<li>Share ≥ ' + pct(c.share_minimo) + ': <b>' + pct(c.gerente_faixa_share_alto) + '</b></li>' +
      '</ul></div>' +
      '<div><h3 class="modSectionTitle" style="margin-top:0;font-size:0.8125rem">Analista</h3><ul>' +
      '<li>Share abaixo de ' + pct(c.share_minimo) + ': <b>' + pct(c.analista_faixa_share_baixo) + '</b></li>' +
      '<li>Share ≥ ' + pct(c.share_minimo) + ': <b>' + pct(c.analista_faixa_share_alto) + '</b></li>' +
      '<li>Bônus SPF: <b>' + moneyInt(c.bonus_spf_analista) + '</b> por unidade</li>' +
      '</ul></div>' +
      '</div>' +
      '<p class="modMuted salRangesNote">Esta é uma consulta de referência das regras vigentes. O cálculo oficial de cada período continua sendo feito pelo Portal — os valores acima não classificam nenhum vendedor/gerente/analista individualmente nesta tela.</p>' +
      '</div></details>';
  }

  // ---------- shared: error/forbidden state per RH-4A provider vocabulary ----------

  function errorStateFor(err, sectionLabel) {
    var state = err && err.state;
    if (state === 'PERMISSION_DENIED') {
      return '<div class="modInfoState"><div class="modStateTitle">Sem autorização para ' + esc(sectionLabel) + '</div>Seu perfil não tem acesso a esta seção.</div>';
    }
    if (state === 'SESSION_EXPIRED') {
      // V2-SECURITY-02 (SEC-06): this module has several independent
      // sections (Resumo/Equipe/Analistas/Gestor F&I/...), each with its
      // own fetch, but they all render their error through this one
      // shared helper -- the natural single chokepoint to delegate to
      // Auth Foundation's established session-expiry handling (same
      // mechanism gestao.js/score.js/coparticipado.js/dashbi.js use)
      // instead of only showing a local message per section.
      if (window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
        window.NX_AUTH_CORE.reportSessionExpired();
      }
      return '<div class="modErrorState"><div class="modStateTitle">Sessão expirada</div>Atualize a página e entre novamente.</div>';
    }
    if (state === 'INVALID_FILTER') {
      return '<div class="modErrorState"><div class="modStateTitle">Período inválido</div>Selecione um período diferente.</div>';
    }
    return '<div class="modErrorState"><div class="modStateTitle">Não foi possível carregar ' + esc(sectionLabel) + '</div>Tente novamente em instantes.</div>';
  }

  // ---------- render: Equipe (RH-5B.1 -- restored V1 structure: rows
  // grouped by Loja · Depto, exactly as operationalSecureContent()
  // groups its per-store table (portal-app.js:1519-1532), with the
  // manager/team-total as a TRAILING ROW inside the SAME table per
  // group -- never a separate "Gestor" tab/section, matching
  // operationalManagerRowHtml/operationalTeamTotalRowHtml being simply
  // one more <tr> at the end of each department sub-section
  // (portal-app.js:1375-1423,1533-1544). Desktop table + mobile cards,
  // Score's own PORTAL-NEXT-07.6.4 proven pattern: a genuinely separate
  // renderer per breakpoint, never a CSS-only table transform. ----------

  // Client-side grouping/sort of already-fetched, already-governed rows
  // -- presentation-layer organization only, computes nothing financial
  // (Gate 14/52: no provider change, no new formula).
  function groupSellerRows(rows) {
    var order = [];
    var byKey = {};
    rows.forEach(function (r) {
      var key = (r.store || '') + ' ' + (r.department || '');
      if (!byKey[key]) { byKey[key] = { store: r.store, department: r.department, rows: [] }; order.push(key); }
      byKey[key].rows.push(r);
    });
    order.sort();
    return order.map(function (k) { return byKey[k]; });
  }
  function sumGroupTotals(rows) {
    return rows.reduce(function (acc, r) {
      acc.sold_count += Number(r.sold_count) || 0;
      acc.financed_count += Number(r.financed_count) || 0;
      acc.production_value += Number(r.production_value) || 0;
      acc.return_value += Number(r.return_value) || 0;
      acc.spf_net_value += Number(r.spf_net_value) || 0;
      acc.profitability_value += Number(r.profitability_value) || 0;
      return acc;
    }, { sold_count: 0, financed_count: 0, production_value: 0, return_value: 0, spf_net_value: 0, profitability_value: 0 });
  }
  // Matches operationalManagerRowHtml when a real, server-directory-
  // matched manager can be shown (canSeeGestor); falls back to the
  // anonymous "TOTAL DA EQUIPE" row (operationalTeamTotalRowHtml) for a
  // viewer who can see analysts but not the manager identity -- never
  // both, never neither's data hidden, matching V1's own precedence
  // exactly (portal-app.js:1533-1544).
  function trailingGroupRow(ctx, group, directory) {
    var manager = directory.filter(function (m) { return m.store === group.store && m.department === group.department; })[0];
    if (canSeeGestor(ctx) && manager) {
      // RH-5C.1: Faixa lookup only for a REAL identified manager row --
      // the anonymous "TOTAL DA EQUIPE" row below deliberately never
      // gets one (it represents summed team totals, not a specific
      // person's commission tier). SALSHARE3 (SHARE-AUDIT-1 corrected
      // the SALSHARE1 assumption, proven wrong against the canonical
      // V1 rule -- portal-app.js:2966's shareBadge(m.financiadas,
      // m.vendidas), the SAME row's OWN totals, never another entity's):
      // shareValue is this manager's own department team's financed/
      // sold ratio -- the exact same `totals` object already producing
      // this row's own Vendidas/Financiadas, never the store-wide
      // official Analyst's separate, department-agnostic ratio.
      var totals = sumGroupTotals(group.rows);
      return {
        label: esc(manager.manager_name || 'Gerente não identificado'), cls: 'salManagerRow', totals: totals,
        faixaMatch: managerFaixaMatch(group.store, group.department),
        shareValue: totals.sold_count > 0 ? (totals.financed_count / totals.sold_count) * 100 : null
      };
    }
    if (canSeeAnalistas(ctx)) {
      return { label: 'TOTAL DA EQUIPE', cls: 'salTeamTotalRow', totals: sumGroupTotals(group.rows), faixaMatch: null, shareValue: null };
    }
    return null;
  }
  // RH-5C.1: FIX-THE-DRIFT Faixa badge -- color/semantic comes from
  // faixa_level, a field the server computes from the SAME branch
  // decisions the financial faixa itself uses (never an independent
  // frontend comparison against a raw percentage, which is exactly
  // what V1's own faixaBadge() did and how it silently drifted from
  // governed config). Absent match -> no badge at all, never a
  // fabricated/default classification.
  function faixaBadgeHtml(match) {
    if (!match) return '';
    var cls = { MAXIMA: 'modBadgeSuccess', INTERMEDIARIA: 'modBadgeWarning', MINIMA: 'modBadgeCritical' }[match.faixa_level] || 'modBadgeNeutral';
    return ' <span class="modBadge ' + cls + '">' + pct(Number(match.faixa) * 100) + '</span>';
  }
  // RH-5F, Human decision: the % Comissão value (already server-
  // authoritative via faixaFor/operational_commission_faixa_rows, RH-5C.1)
  // moves out of the name cell into its own dedicated column, immediately
  // before Ações -- same underlying data as faixaBadgeHtml above, just a
  // cell-shaped renderer (no leading space, explicit '—' when no match
  // exists, never a fabricated classification).
  function faixaCellHtml(match) {
    if (!match) return '—';
    var cls = { MAXIMA: 'modBadgeSuccess', INTERMEDIARIA: 'modBadgeWarning', MINIMA: 'modBadgeCritical' }[match.faixa_level] || 'modBadgeNeutral';
    return '<span class="modBadge ' + cls + '">' + pct(Number(match.faixa) * 100) + '</span>';
  }
  // RH-5F.1: comissao_total is now real, server-authoritative
  // (operational_commission_faixa_rows, additive projection change --
  // see the RH-5F.1 migration). Same faixaFor() match object already
  // used for % Comissão -- no new RPC call, no frontend arithmetic.
  // Distinguishes a genuine zero commission from a missing/unauthorized
  // row: '—' only when there is no match at all, never when the real
  // value happens to be 0.
  function comissaoTotalCellHtml(match) {
    if (!match || match.comissao_total == null) return '—';
    return fmtMoney(match.comissao_total);
  }
  // RH-5F, Human decision: conversion (share_percent / "Conversão") >=40%
  // reads as a positive/healthy signal, <40% needs attention -- exactly
  // 40.0 counts as positive. Reuses the SAME modBadgeSuccess/modBadgeWarning
  // language as every other semantic badge in this module (never a new
  // visual system). Only a genuine finite number participates -- null/
  // undefined/NaN render as a plain '—', never misclassified into either
  // state.
  var CONVERSION_THRESHOLD = 40;
  function isFiniteNumber(v) { return typeof v === 'number' && !isNaN(v); }
  function conversionCellHtml(v) {
    if (!isFiniteNumber(v)) return '—';
    var cls = v >= CONVERSION_THRESHOLD ? 'modBadgeSuccess' : 'modBadgeWarning';
    return '<span class="modBadge ' + cls + '">' + fmtPct(v) + '</span>';
  }
  function conversionKpiClass(v) {
    if (!isFiniteNumber(v)) return 'modKpiCardInfo';
    return v >= CONVERSION_THRESHOLD ? 'modKpiCardSuccess' : 'modKpiCardWarning';
  }
  function sellerRowDesktopHtml(r) {
    var faixaMatch = sellerFaixaMatch(r.seller_id);
    return '<tr>' +
      '<td>' + esc(r.seller_name || '—') + '</td>' +
      '<td class="modNumCol">' + fmtInt(r.sold_count) + '</td>' +
      '<td class="modNumCol">' + fmtInt(r.financed_count) + '</td>' +
      '<td class="modNumCol">' + conversionCellHtml(r.share_percent) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.production_value) + '</td>' +
      soRetorno('<td class="modNumCol modCurrencyCol">' + fmtMoney(r.return_value) + '</td>') +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.spf_net_value) + '</td>' +
      soRetorno('<td class="modNumCol modCurrencyCol">' + fmtMoney(r.profitability_value) + '</td>') +
      '<td class="modNumCol">' + faixaCellHtml(faixaMatch) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + comissaoTotalCellHtml(faixaMatch) + '</td>' +
      (r.seller_id ? '<td class="modActionCol"><button type="button" class="modBtn modBtnGhost modBtnSm" data-details="' + esc(r.seller_id) + '" data-name="' + esc(r.seller_name || '') + '">Detalhes</button></td>' : '<td></td>') +
      '</tr>';
  }
  function trailingRowDesktopHtml(trailing) {
    if (!trailing) return '';
    var t = trailing.totals;
    return '<tr class="' + trailing.cls + '"><td>' + trailing.label + '</td>' +
      '<td class="modNumCol">' + fmtInt(t.sold_count) + '</td>' +
      '<td class="modNumCol">' + fmtInt(t.financed_count) + '</td>' +
      '<td class="modNumCol">' + conversionCellHtml(trailing.shareValue) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(t.production_value) + '</td>' +
      soRetorno('<td class="modNumCol modCurrencyCol">' + fmtMoney(t.return_value) + '</td>') +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(t.spf_net_value) + '</td>' +
      soRetorno('<td class="modNumCol modCurrencyCol">' + fmtMoney(t.profitability_value) + '</td>') +
      '<td class="modNumCol">' + faixaCellHtml(trailing.faixaMatch) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + comissaoTotalCellHtml(trailing.faixaMatch) + '</td><td></td></tr>';
  }
  function sellerCardHtml(r) {
    var faixaMatch = sellerFaixaMatch(r.seller_id);
    return '<div class="salCard"><div class="salCardTop"><span class="salCardName">' + esc(r.seller_name || '—') + '</span>' +
      conversionCellHtml(r.share_percent) + '</div>' +
      '<dl class="salCardFields">' +
      '<dt>Vendidas / Financiadas</dt><dd>' + fmtInt(r.sold_count) + ' / ' + fmtInt(r.financed_count) + '</dd>' +
      '<dt>Produção</dt><dd>' + fmtMoney(r.production_value) + '</dd>' +
      soRetorno('<dt>Retorno</dt><dd>' + fmtMoney(r.return_value) + '</dd>') +
      '<dt>SPF Líquido</dt><dd>' + fmtMoney(r.spf_net_value) + '</dd>' +
      soRetorno('<dt>Rentabilidade</dt><dd>' + fmtMoney(r.profitability_value) + '</dd>') +
      '<dt>% Comissão</dt><dd>' + faixaCellHtml(faixaMatch) + '</dd>' +
      '<dt>Comissão Total</dt><dd class="salCommissionTotalValue">' + comissaoTotalCellHtml(faixaMatch) + '</dd>' +
      '</dl>' +
      (r.seller_id ? '<button type="button" class="modBtn modBtnGhost modBtnSm" data-details="' + esc(r.seller_id) + '" data-name="' + esc(r.seller_name || '') + '">Detalhes</button>' : '') +
      '</div>';
  }
  function trailingCardHtml(trailing) {
    if (!trailing) return '';
    var t = trailing.totals;
    return '<div class="salCard ' + trailing.cls + '"><div class="salCardTop"><span class="salCardName">' + trailing.label + '</span>' +
      conversionCellHtml(trailing.shareValue) + '</div>' +
      '<dl class="salCardFields">' +
      '<dt>Vendidas / Financiadas</dt><dd>' + fmtInt(t.sold_count) + ' / ' + fmtInt(t.financed_count) + '</dd>' +
      '<dt>Produção</dt><dd>' + fmtMoney(t.production_value) + '</dd>' +
      soRetorno('<dt>Retorno</dt><dd>' + fmtMoney(t.return_value) + '</dd>') +
      '<dt>SPF Líquido</dt><dd>' + fmtMoney(t.spf_net_value) + '</dd>' +
      soRetorno('<dt>Rentabilidade</dt><dd>' + fmtMoney(t.profitability_value) + '</dd>') +
      '<dt>% Comissão</dt><dd>' + faixaCellHtml(trailing.faixaMatch) + '</dd>' +
      '<dt>Comissão Total</dt><dd class="salCommissionTotalValue">' + comissaoTotalCellHtml(trailing.faixaMatch) + '</dd>' +
      '</dl></div>';
  }

  // RH-5F, Human decision: Analistas is no longer one global block at the
  // bottom -- each Salary Analyst row now renders together with the store
  // group it belongs to (after the seller rows and the manager/team-total
  // row, before the next store). This is presentation regrouping only --
  // §3/§18/§19 of this Wave's own brief: no Ranking authority
  // (analista_responsavel_loja/analista_responsabilidade_janelas) is
  // consulted here, the Analyst rows are exactly the ones Salary's own
  // operational_analyst_commission_metrics_v2 already returns, grouped by
  // that RPC's own `store` field (traced live this Wave: both this RPC and
  // operational_metrics derive `store` from the identical
  // resolve_store_temporal()/eligible_sellers expression, so the same
  // store name string is guaranteed to line up between the two row sets --
  // no name-guessing, no alphabetical matching, no roster lookup).
  //
  // HARD semantic gate (Gate 20, live-traced this Wave): Salary Analyst
  // commission is STORE-WIDE, never department-specific --
  // operational_analyst_commission_metrics aggregates sold/financed/
  // production/return/SPF per STORE only, with no department dimension in
  // its own output. Duplicating one Analyst row under both a NOVOS and a
  // SEMINOVOS sub-group of the same store would misrepresent a single
  // store-wide result as two -- so it renders exactly ONCE per store,
  // after that store's LAST department sub-group, never once per
  // department.
  function groupDeptGroupsByStore(deptGroups) {
    var order = [];
    var byStore = {};
    deptGroups.forEach(function (g) {
      var key = g.store || '';
      if (!byStore[key]) { byStore[key] = { store: g.store, deptGroups: [] }; order.push(key); }
      byStore[key].deptGroups.push(g);
    });
    return order.map(function (k) { return byStore[k]; });
  }
  function groupAnalystRowsByStore(rows) {
    var byStore = {};
    (rows || []).forEach(function (r) {
      var key = r.store || '';
      (byStore[key] = byStore[key] || []).push(r);
    });
    return byStore;
  }
  // Analyst rows have a genuinely different grain than seller rows
  // (RH-3A/RH-4A evidence: analyst_name not seller_name, no share_percent/
  // spf_net_value/profitability_value field -- spf_value here is GROSS,
  // never the 70%-weighted "SPF Líq." a seller row carries) -- kept in its
  // own compact table/card set, never force-fit into the Equipe table's
  // column shape with fabricated dashes for fields that don't apply at
  // this grain (Gate 48). Conversão (RH-5F.1B, below) is the one
  // exception: sold_count/financed_count DO apply at this grain, so
  // the same canonical formula is derived from them locally rather than
  // omitted, instead of being force-fit from a field that isn't there.
  // "Loja" is intentionally omitted here (unlike
  // the pre-RH-5F standalone section) -- the surrounding store group
  // already establishes it, and repeating it on every Analyst row would
  // be pure noise now that the row lives inside that exact context.
  // data-analyst-store/data-analyst-coverage identify the row (there is
  // no single-field seller_id equivalent for an Analyst row) -- wire()
  // re-finds the exact same row object from dashboard.analystMetrics.rows
  // by (store, coverage_id) before opening its detail, never guessing.
  // RH-5F.1B: Analyst rows have no share_percent field of their own --
  // operational_analyst_commission_metrics_v2 does not return one (see
  // the RH-3A/RH-4A evidence note above; live-traced again this Wave
  // against the function's own row-shape, confirmed absent). The
  // conceptual relationship is IDENTICAL to the seller grain's own
  // server-computed share_percent (traced this Wave against Secure's
  // canonical formula: round((financed_count/sold_count)*100, 4), 0
  // when sold_count<=0 -- never Infinity/NaN/100%) -- applied here to
  // the same sold_count/financed_count fields this row already carries.
  // Not a new business rule: the one canonical formula, evaluated at
  // this grain only because the RPC itself doesn't pre-compute it here.
  function analystConversionPercent(r) {
    var sold = r && Number(r.sold_count);
    var financed = r && Number(r.financed_count);
    if (!isFiniteNumber(sold) || !isFiniteNumber(financed) || sold <= 0) return 0;
    return (financed / sold) * 100;
  }
  function analystRowDesktopHtml(r) {
    var faixaMatch = faixaFor('ANALISTA', r.store, null, null) || ownAnalystFaixaMatch(r);
    return '<tr>' +
      '<td>' + esc(r.analyst_name || '—') + (r.transfer ? ' <span class="modBadge modBadgeInfo">Cobertura</span>' : '') + '</td>' +
      '<td class="modNumCol">' + fmtInt(r.sold_count) + '</td>' +
      '<td class="modNumCol">' + fmtInt(r.financed_count) + '</td>' +
      '<td class="modNumCol">' + conversionCellHtml(analystConversionPercent(r)) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.production_value) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.return_value) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.spf_value) + '</td>' +
      '<td class="modNumCol">' + faixaCellHtml(faixaMatch) + '</td>' +
      '<td class="modNumCol modCurrencyCol">' + comissaoTotalCellHtml(faixaMatch) + '</td>' +
      '<td class="modActionCol"><button type="button" class="modBtn modBtnGhost modBtnSm" data-analyst-details data-analyst-store="' + esc(r.store || '') + '" data-analyst-coverage="' + esc(r.coverage_id || '') + '">Detalhes</button></td>' +
      '</tr>';
  }
  function analystRowsDesktopTableHtml(rows) {
    if (!rows || !rows.length) return '';
    var body = rows.map(analystRowDesktopHtml).join('');
    return '<div class="salAnalystSection salDesktopOnly"><h3 class="salAnalystHeading">Analista' + (rows.length > 1 ? 's' : '') + '</h3>' +
      '<div class="modTableWrap salAnalystTableWrap"><table class="modTable salAnalystTable"><thead><tr>' +
      '<th>Analista</th><th>Vendidas</th><th>Financiadas</th><th>Conversão</th><th>Produção</th><th>Retorno</th><th>SPF</th><th>% Comissão</th><th>Comissão Total</th><th>Ações</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  function analystRowsMobileCardsHtml(rows) {
    if (!rows || !rows.length) return '';
    var cards = rows.map(function (r) {
      var faixaMatch = faixaFor('ANALISTA', r.store, null, null) || ownAnalystFaixaMatch(r);
      return '<div class="salCard salAnalystCard"><div class="salCardTop"><span class="salCardName">' + esc(r.analyst_name || '—') + '</span>' +
        (r.transfer ? '<span class="modBadge modBadgeInfo">Cobertura</span>' : '') + '</div>' +
        '<dl class="salCardFields">' +
        '<dt>Vendidas / Financiadas</dt><dd>' + fmtInt(r.sold_count) + ' / ' + fmtInt(r.financed_count) + '</dd>' +
        '<dt>Conversão</dt><dd>' + conversionCellHtml(analystConversionPercent(r)) + '</dd>' +
        '<dt>Produção</dt><dd>' + fmtMoney(r.production_value) + '</dd>' +
        '<dt>Retorno</dt><dd>' + fmtMoney(r.return_value) + '</dd>' +
        '<dt>SPF</dt><dd>' + fmtMoney(r.spf_value) + '</dd>' +
        '<dt>% Comissão</dt><dd>' + faixaCellHtml(faixaMatch) + '</dd>' +
        '<dt>Comissão Total</dt><dd class="salCommissionTotalValue">' + comissaoTotalCellHtml(faixaMatch) + '</dd>' +
        '</dl>' +
        '<button type="button" class="modBtn modBtnGhost modBtnSm" data-analyst-details data-analyst-store="' + esc(r.store || '') + '" data-analyst-coverage="' + esc(r.coverage_id || '') + '">Detalhes</button>' +
        '</div>';
    }).join('');
    // No .salMobileOnly on this wrapper -- it already lives inside the
    // outer .salMobileOnly.salCardList stream (which is what actually
    // controls show/hide at narrow widths). .salMobileOnly ALSO sets
    // display:flex (row) below 760px -- putting it on this nested
    // wrapper too turned its own children (heading + cards) into a
    // horizontal row instead of stacking, the real cause of a 480px
    // overflow caught by this Wave's own regression tests. Plain block
    // layout here lets the heading/cards stack normally inside the
    // already-handled outer flex column.
    return '<div class="salAnalystSection"><h3 class="salAnalystHeading">Analista' + (rows.length > 1 ? 's' : '') + '</h3>' + cards + '</div>';
  }

  function equipeAnalistasHtml(ctx) {
    if (dashboardState === 'LOADING') return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando equipe…</div>';
    if (dashboardState === 'ERROR' || !dashboard) return '<div class="modErrorState"><div class="modStateTitle">Não foi possível carregar a equipe.</div></div>';
    if (dashboard.metricsError) return errorStateFor(dashboard.metricsError, 'Equipe');

    var rows = (dashboard.metrics && dashboard.metrics.rows) || [];
    // V1 shows no Analistas placeholder at all for an unauthorized profile
    // -- the section is simply absent (canSeeAnalistas), never a "not
    // available" message -- same rule as before RH-5F, just evaluated
    // once up front instead of inside a separate function.
    var showAnalysts = canSeeAnalistas(ctx);
    var analystRows = showAnalysts ? ((dashboard.analystMetrics && dashboard.analystMetrics.rows) || []) : [];
    var analystError = showAnalysts ? dashboard.analystMetricsError : null;

    if (!rows.length && !analystRows.length) {
      return '<div class="modEmptyState"><div class="modStateTitle">Nenhum vendedor com movimento neste período.</div></div>';
    }

    var directory = (dashboard.managerDirectory && dashboard.managerDirectory.rows) || [];
    var storeGroups = groupDeptGroupsByStore(groupSellerRows(rows));
    var analystByStore = groupAnalystRowsByStore(analystRows);
    var consumedStores = {};

    var desktop = storeGroups.map(function (sg) {
      var body = sg.deptGroups.map(function (g) {
        // RH-5F.1: 11 real columns (Vendedor..Ações) after adding the
        // now-authoritative Comissão Total column -- colspan raised from
        // 10 to 11 accordingly (RH-5B.3's own established fix for this
        // exact "linha cortada, sem continuidade" defect class).
        var header = '<tr class="salGroupHeaderRow"><th colspan="' + (veRetorno() ? 11 : 9) + '">' + esc(g.store || '—') + ' · ' + esc(g.department || '—') + '</th></tr>';
        var rowsHtml = g.rows.map(sellerRowDesktopHtml).join('');
        var trailing = trailingRowDesktopHtml(trailingGroupRow(ctx, g, directory));
        return header + rowsHtml + trailing;
      }).join('');
      var table = '<div class="modTableWrap salDesktopOnly salEquipeTableWrap"><table class="modTable"><thead><tr>' +
        '<th>Vendedor</th><th>Vendidas</th><th>Financiadas</th><th>Conversão</th><th>Produção</th>' + soRetorno('<th>Retorno</th>') + '<th>SPF Líq.</th>' + soRetorno('<th>Rentabilidade</th>') + '<th>% Comissão</th><th>Comissão Total</th><th>Ações</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
      consumedStores[sg.store || ''] = true;
      return '<div class="salStoreGroup">' + table + (showAnalysts ? analystRowsDesktopTableHtml(analystByStore[sg.store || '']) : '') + '</div>';
    }).join('') + (showAnalysts ? Object.keys(analystByStore).filter(function (k) { return !consumedStores[k]; }).sort().map(function (k) {
      // A store with Analyst activity but zero seller movement this
      // period (no matching seller group to attach to) -- still rendered,
      // never dropped (Gate 23: Analyst row count must be conserved).
      return '<div class="salStoreGroup"><h3 class="salOrphanStoreHeading">' + esc(k || 'Loja não identificada') + '</h3>' + analystRowsDesktopTableHtml(analystByStore[k]) + '</div>';
    }).join('') : '');

    var mobile = '<div class="salMobileOnly salCardList">' + storeGroups.map(function (sg) {
      var cards = sg.deptGroups.map(function (g) {
        var heading = '<div class="salGroupHeading">' + esc(g.store || '—') + ' · ' + esc(g.department || '—') + '</div>';
        var body = g.rows.map(sellerCardHtml).join('') + trailingCardHtml(trailingGroupRow(ctx, g, directory));
        return heading + body;
      }).join('');
      return cards + (showAnalysts ? analystRowsMobileCardsHtml(analystByStore[sg.store || '']) : '');
    }).join('') + (showAnalysts ? Object.keys(analystByStore).filter(function (k) { return !consumedStores[k]; }).sort().map(function (k) {
      return '<div class="salGroupHeading">' + esc(k || 'Loja não identificada') + '</div>' + analystRowsMobileCardsHtml(analystByStore[k]);
    }).join('') : '') + '</div>';

    // One combined note if the Analyst leg failed -- never duplicated per
    // store (this Wave's own resilience discipline: one failing leg never
    // blocks/duplicates around the others). Same treatment for the
    // genuinely-empty-but-authorized case (READY, zero rows anywhere) --
    // an explicit note, never silence.
    var analystErrorHtml = analystError ? '<div style="margin-top:var(--mod-space-control-gap)">' + errorStateFor(analystError, 'Analistas') + '</div>' : '';
    var analystEmptyHtml = (showAnalysts && !analystError && !analystRows.length)
      ? '<div class="modEmptyState" style="margin-top:var(--mod-space-control-gap)"><div class="modStateTitle">Nenhum analista com movimento neste período.</div></div>'
      : '';

    return desktop + mobile + analystErrorHtml + analystEmptyHtml;
  }

  // ---------- render: Comissão — Gestor F&I (RH-5C.1) ----------
  // The live/open-period equivalent of V1's showGestorFICommission()
  // (portal-app.js:6298-6352) -- a SEPARATE, MASTER-only, single-
  // identity group-wide oversight commission, structurally distinct
  // from the per-store manager/team-total trailing row inside Equipe
  // above (this section's own accent/heading/placement never let the
  // two be confused, matching this Wave's explicit brief). Secondary
  // information, placed AFTER Equipe/Analistas -- never interrupts the
  // continuous KPI->Faixas->Equipe->Analistas flow this module has
  // used since RH-5B.1.
  //
  // KPI mapping vs V1's real 13 tiles (verified via live source read,
  // not the brief's originally-assumed 12) -- every one has a direct
  // field in operational_gestor_fi_commission's response, so all 13
  // are shown, none condensed/dropped/derived:
  //   Qtd Vendida Grupo->vendidas, Qtd Financiada Grupo->financiadas,
  //   Share Grupo->share, Produção Total Grupo->producao, Retorno Total
  //   Grupo->retorno, SPF EXTRA Total Grupo->spf, SPF Líquido 70%
  //   Grupo->spf_liquido, Qtd SPF EXTRA->spf_qty, Base Gestor->base,
  //   Faixa Aplicada->faixa, Comissão Principal->comissao_principal,
  //   Bônus SPF->bonus_spf, Comissão Final Gestor->comissao_final
  //   (emphasized, matching V1's own .final CSS treatment).
  function gestorFiSectionHtml(ctx) {
    if (!canSeeGestorFi(ctx)) return '';
    if (gestorFiState === 'IDLE') return '';
    if (gestorFiState === 'LOADING') {
      return '<div class="salGestorFiSection"><h2 class="modSectionTitle">Comissão — Gestor F&amp;I</h2>' +
        '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando comissão do Gestor F&amp;I…</div></div>';
    }
    if (gestorFiState === 'ERROR' || !gestorFi) {
      return '<div class="salGestorFiSection"><h2 class="modSectionTitle">Comissão — Gestor F&amp;I</h2>' +
        errorStateFor(gestorFiError, 'Comissão — Gestor F&I') + '</div>';
    }
    if (gestorFi.pronto === false) {
      var motivoText = gestorFi.motivo === 'MULTIPLOS_BENEFICIARIOS_CONFIGURADOS'
        ? 'Mais de um beneficiário está configurado para a Comissão do Gestor F&I -- contate a Administração/RH F&I.'
        : 'Nenhum beneficiário está configurado para a Comissão do Gestor F&I -- contate a Administração/RH F&I.';
      return '<div class="salGestorFiSection"><h2 class="modSectionTitle">Comissão — Gestor F&amp;I</h2>' +
        '<div class="modInfoState"><div class="modStateTitle">Não disponível neste período</div>' + esc(motivoText) + '</div></div>';
    }
    var g = gestorFi;
    return '<div class="salGestorFiSection">' +
      '<h2 class="modSectionTitle">Comissão — Gestor F&amp;I</h2>' +
      '<p class="modMuted">Calculada sobre o desempenho consolidado de todo o Grupo, independentemente da loja selecionada.</p>' +
      '<div class="modKpiGrid">' +
      kpiCard('Vendidas (Grupo)', fmtInt(g.vendidas)) +
      kpiCard('Financiadas (Grupo)', fmtInt(g.financiadas)) +
      kpiCard('Share (Grupo)', pct(Number(g.share))) +
      kpiCard('Produção (Grupo)', fmtMoney(g.producao)) +
      kpiCard('Retorno (Grupo)', fmtMoney(g.retorno)) +
      kpiCard('SPF Extra (Grupo)', fmtMoney(g.spf)) +
      kpiCard('SPF Líquido (Grupo)', fmtMoney(g.spf_liquido)) +
      kpiCard('Qtd. SPF Extra', fmtInt(g.spf_qty)) +
      kpiCard('Base', fmtMoney(g.base)) +
      kpiCard('Faixa aplicada', pct(Number(g.faixa) * 100), 'modKpiCardInfo') +
      kpiCard('Comissão principal', fmtMoney(g.comissao_principal)) +
      kpiCard('Bônus SPF', fmtMoney(g.bonus_spf)) +
      kpiCard('Comissão final', fmtMoney(g.comissao_final), 'modKpiCardSuccess') +
      '</div></div>';
  }

  // ---------- render: Histórico (RH-4C, MASTER-only) ----------

  function classificationBadgeHtml(classification) {
    var map = {
      COMPLETE: ['modBadgeSuccess', 'Completo'],
      LEGACY_PARTIAL: ['modBadgeWarning', 'Histórico parcial'],
      BROKEN: ['modBadgeCritical', 'Sem integridade']
    };
    var m = map[classification] || ['modBadgeNeutral', classification || '—'];
    return '<span class="modBadge ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  function errorStateForHistory(err) {
    var state = err && err.state;
    if (state === 'PERMISSION_DENIED') return '<div class="modInfoState"><div class="modStateTitle">Sem autorização para o Histórico</div>Este recurso é exclusivo do perfil Master.</div>';
    if (state === 'SESSION_EXPIRED') return '<div class="modErrorState"><div class="modStateTitle">Sessão expirada</div>Atualize a página e entre novamente.</div>';
    if (state === 'INVALID_CLOSING') return '<div class="modErrorState"><div class="modStateTitle">Fechamento não encontrado</div>Selecione outro fechamento.</div>';
    if (state === 'BROKEN_CLOSING') return '<div class="modErrorState"><div class="modStateTitle">Exportação bloqueada</div>Este fechamento possui um snapshot histórico inconsistente. Procure a Administração/RH F&amp;I.</div>';
    return '<div class="modErrorState"><div class="modStateTitle">Não foi possível carregar o Histórico</div>Tente novamente em instantes.</div>';
  }

  // RH-5C: a real, already-persisted snapshot row can carry
  // perfil==='GESTOR F&I' (V1's group-wide oversight commission,
  // portal-app.js:6252-6297 -- one synthetic row per closing, loja
  // literally 'GRUPO', frozen at close time exactly like every seller/
  // manager/analyst row). Before this fix, this table rendered it
  // completely unstyled and unsorted -- a single loja:"GRUPO" row
  // appearing wherever the RPC's own `order by loja, perfil, nome`
  // happened to place it alphabetically among real store names, easily
  // mistaken for a data anomaly rather than a real, distinct feature
  // (confirmed live: 19 real rows exist across 19 real closings). This
  // is pure presentation of already-authoritative frozen data -- no
  // computation, matching this module's own zero-client-formula
  // discipline throughout.
  function isGestorFiRow(r) { return String(r.perfil || '').toUpperCase() === 'GESTOR F&I'; }

  function historicoSnapshotTableHtml(rows) {
    if (!rows.length) return '<div class="modEmptyState"><div class="modStateTitle">Nenhum registro neste fechamento.</div></div>';
    // Reuse the SAME grouping Painel Master's own canonical view-model
    // already defines (sortSnapshotRows, PROFILE_ORDER ending in
    // 'GESTOR F&I') instead of a second, independently-maintained sort
    // -- matches this file's own established discipline of never
    // duplicating the canonical historical authority.
    var vm = historyVm();
    var sorted = vm ? vm.sortSnapshotRows(rows) : rows;
    var desktopRows = sorted.map(function (r) {
      var gestor = isGestorFiRow(r);
      var rowClass = gestor ? ' class="salGestorFiRow"' : '';
      var nomeCell = esc(r.nome || '—') + (gestor ? ' <span class="modBadge modBadgeInfo">Gestor F&amp;I</span>' : '');
      // Short cell text (never re-widens the table -- a longer inline
      // label measurably pushed the Comissão column further outside
      // the wrapper's visible area, verified by direct measurement);
      // full V1 explanation (showGestorFICommission()'s own real copy,
      // portal-app.js:6319) moves to a title tooltip instead.
      var lojaCell = gestor ? '<span title="Comissão calculada sobre o desempenho consolidado de todo o Grupo, independentemente da loja.">Grupo</span>' : esc(r.loja || '—');
      return '<tr' + rowClass + '>' +
        '<td>' + nomeCell + '</td><td>' + lojaCell + '</td><td>' + esc(r.departamento || '—') + '</td>' +
        '<td class="modNumCol">' + fmtInt(r.vendidas) + '</td><td class="modNumCol">' + fmtInt(r.financiadas) + '</td>' +
        '<td class="modNumCol">' + fmtPct(r.share) + '</td>' +
        '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.producao) + '</td>' +
        '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.retorno) + '</td>' +
        '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.spf_liquido) + '</td>' +
        '<td class="modNumCol modCurrencyCol">' + fmtMoney(r.comissao) + '</td>' +
        '</tr>';
    }).join('');
    var desktop = '<div class="modTableWrap salDesktopOnly salHistSnapshotTableWrap"><table class="modTable"><thead><tr>' +
      '<th>Nome</th><th>Loja</th><th>Depto</th><th>Vendidas</th><th>Financiadas</th><th>Share</th><th>Produção</th><th>Retorno</th><th>SPF Líq.</th><th>Comissão</th>' +
      '</tr></thead><tbody>' + desktopRows + '</tbody></table></div>';
    var cards = '<div class="salMobileOnly salCardList">' + sorted.map(function (r) {
      var gestor = isGestorFiRow(r);
      var badge = gestor ? '<span class="modBadge modBadgeInfo">Gestor F&amp;I</span>' : '<span class="modBadge modBadgeNeutral">' + esc(r.loja || '—') + '</span>';
      var cardClass = gestor ? ' salGestorFiRow' : '';
      return '<div class="salCard' + cardClass + '"><div class="salCardTop"><span class="salCardName">' + esc(r.nome || '—') + '</span>' + badge + '</div>' +
        '<dl class="salCardFields">' +
        '<dt>Depto</dt><dd>' + esc(r.departamento || '—') + '</dd>' +
        '<dt>Vendidas / Financiadas</dt><dd>' + fmtInt(r.vendidas) + ' / ' + fmtInt(r.financiadas) + '</dd>' +
        '<dt>Produção</dt><dd>' + fmtMoney(r.producao) + '</dd>' +
        '<dt>Comissão</dt><dd>' + fmtMoney(r.comissao) + '</dd>' +
        '</dl></div>';
    }).join('') + '</div>';
    return desktop + cards;
  }

  function historicoOperationalDetailSectionHtml() {
    if (!historyOpDetail) {
      return '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)">' +
        '<button type="button" class="modBtn modBtnGhost modBtnSm" id="salHistOpDetailBtn">Ver detalhamento operacional</button></div>';
    }
    if (historyOpDetail.state === 'LOADING') return '<div class="modLoadingState" style="margin-top:var(--mod-space-control-gap)"><span class="modLoadingDot"></span> Carregando detalhamento congelado…</div>';
    if (historyOpDetail.state === 'ERROR') return '<div style="margin-top:var(--mod-space-control-gap)">' + errorStateForHistory(historyOpDetail.error) + '</div>';
    var d = historyOpDetail.data;
    var rows = d.rows || [];
    var badge = classificationBadgeHtml(d.completeness);
    if (!rows.length) {
      return '<div class="modEmptyState" style="margin-top:var(--mod-space-control-gap)">' + badge +
        '<div class="modStateTitle" style="margin-top:6px">Nenhum detalhamento operacional congelado disponível.</div></div>';
    }
    var desktopRows = rows.map(function (r) {
      return '<tr><td>' + esc(r.kind || '—') + '</td><td>' + esc(r.seller_name || '—') + '</td><td>' + esc(r.store || '—') + '</td>' +
        '<td>' + esc(fmtDateBR(r.sale_date || r.operation_date)) + '</td>' +
        '<td>' + esc(r.chassis_masked || '—') + '</td><td>' + (r.financed ? 'Sim' : (r.financed === false ? 'Não' : '—')) + '</td></tr>';
    }).join('');
    return '<div style="margin-top:var(--mod-space-control-gap)">' + badge +
      '<div class="modTableWrap" style="margin-top:6px"><table class="modTable"><thead><tr><th>Tipo</th><th>Vendedor</th><th>Loja</th><th>Data</th><th>Chassi</th><th>Financiado</th></tr></thead><tbody>' +
      desktopRows + '</tbody></table></div></div>';
  }

  function historicoExportSectionHtml(cls) {
    if (cls === 'BROKEN') return '';
    var disabled = historyExportState === 'LOADING' ? ' disabled' : '';
    var label = historyExportState === 'LOADING' ? 'Gerando exportação…' : 'Exportar CSV (dados oficiais)';
    var err = historyExportState === 'ERROR' ? '<div style="margin-top:6px">' + errorStateForHistory(historyExportError) + '</div>' : '';
    return '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)">' +
      '<button type="button" class="modBtn modBtnSecondary modBtnSm" id="salHistExportBtn"' + disabled + '>' + esc(label) + '</button></div>' + err;
  }

  function historicoDetailHtml() {
    if (!selectedClosingId) return '<div class="modInfoState" style="margin-top:var(--mod-space-control-gap)"><div class="modStateTitle">Selecione um fechamento para ver o histórico.</div></div>';
    if (!historyDetail || historyDetail.state === 'LOADING') return '<div class="modLoadingState" style="margin-top:var(--mod-space-control-gap)"><span class="modLoadingDot"></span> Carregando fechamento…</div>';
    if (historyDetail.state === 'ERROR') return '<div style="margin-top:var(--mod-space-control-gap)">' + errorStateForHistory(historyDetail.error) + '</div>';
    var data = historyDetail.data;
    var cls = data.classification;
    var body;
    if (cls === 'BROKEN') {
      body = '<div class="modErrorState" style="margin-top:var(--mod-space-control-gap)"><div class="modStateTitle">Este fechamento histórico não possui integridade suficiente para exibição financeira oficial.</div>' +
        'Procure a Administração/RH F&amp;I para mais informações.</div>';
    } else {
      body = (cls === 'LEGACY_PARTIAL'
        ? '<div class="modInfoState" style="text-align:left;padding:12px 16px;margin-top:var(--mod-space-control-gap)"><div class="modStateTitle">Fechamento histórico anterior ao detalhamento completo</div>Alguns detalhes operacionais podem não estar disponíveis para esta competência.</div>'
        : '') +
        '<div style="margin-top:var(--mod-space-control-gap)">' + historicoSnapshotTableHtml(data.rows) + '</div>' +
        historicoOperationalDetailSectionHtml() +
        historicoExportSectionHtml(cls);
    }
    return '<div class="salHistoryMeta" style="margin-top:var(--mod-space-control-gap)">' + classificationBadgeHtml(cls) +
      '<span class="modMuted">' + esc(data.closing.nome_periodo || '') + ' · ' + esc(fmtDateBR(data.closing.data_inicio)) + ' a ' + esc(fmtDateBR(data.closing.data_fim)) + '</span></div>' +
      body;
  }

  function historicoHtml(ctx) {
    if (!canSeeHistorico(ctx)) return '<div class="modInfoState"><div class="modStateTitle">Seção não disponível para seu perfil.</div></div>';
    if (historyClosingsState === 'IDLE' || historyClosingsState === 'LOADING') return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando fechamentos…</div>';
    if (historyClosingsState === 'ERROR') {
      return errorStateForHistory(historyClosingsError) + '<button type="button" class="modBtn modBtnSecondary modBtnSm" id="salHistRetry" style="margin-top:10px">Tentar novamente</button>';
    }
    if (!historyClosings || !historyClosings.length) {
      return '<div class="modEmptyState"><div class="modStateTitle">Nenhum fechamento de competência encontrado.</div></div>';
    }
    var options = '<option value="">Selecione…</option>' + historyClosings.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === selectedClosingId ? ' selected' : '') + '>' +
        esc(c.nome_periodo || '—') + ' — v' + (c.versao != null ? c.versao : '?') + ' — ' + esc(c.status || '—') + (c.ativo ? '' : ' (inativo)') + '</option>';
    }).join('');
    return '<p class="modMuted">Visualização histórica somente leitura. Fechamento, reabertura de competência e a exportação oficial completa (RH/DP) ficam em Painel Master → Histórico de Competências.</p>' +
      '<div class="modFilters"><label class="modField">Fechamento<select id="salHistClosingSelect">' + options + '</select></label></div>' +
      historicoDetailHtml();
  }

  // ---------- render: Detalhes modal (operational detail foundation) ----------

  // RH-5F, Human feedback ("a modal fica meio estranha... quero mais
  // informação financeira"): operational_salary_details' own live, real
  // row shape (traced this Wave) already returns far more than this modal
  // used to show -- financed_value, return_considered, spf_gross/
  // spf_considered/spf_70 (SPF Extra, ALREADY authoritative and computed
  // PER OPERATION -- Gate 26's requested field, no artificial allocation
  // needed, it was simply never rendered), modality (finance_code/
  // service_description), installments. A structured
  // primary-row + financial-strip card per operation (Gate 34) replaces
  // the old cramped 6-column table -- date and masked chassis each get
  // their own token, never sharing a narrow column that forced them to
  // wrap mid-value (Gate 29/30's exact reported defect). No commission-
  // per-operation total is fabricated here -- operational_salary_details
  // has no such field; "Rentabilidade" (operation_profitability) is
  // shown instead, exactly as before, as the real per-operation base the
  // seller's own % Comissão (shown elsewhere on their row) is applied to.
  function detailFinancedBadgeHtml(financed) {
    if (financed === true) return '<span class="modBadge modBadgeSuccess">Financiado</span>';
    if (financed === false) return '<span class="modBadge modBadgeNeutral">Não financiado</span>';
    return '<span class="modBadge modBadgeNeutral">—</span>';
  }
  function detailOperationRowHtml(r) {
    var cls = 'salOpRow' + (r.financed === true ? ' salOpRowFinanced' : '');
    return '<div class="' + cls + '">' +
      '<div class="salOpRowPrimary">' +
      '<span class="salOpDate">' + esc(fmtDateBR(r.date)) + '</span>' +
      '<span class="salOpModel">' + esc(r.vehicle_model || '—') + '</span>' +
      '<span class="salOpChassis">' + esc(r.chassis_masked || '—') + '</span>' +
      detailFinancedBadgeHtml(r.financed) +
      '</div>' +
      '<div class="salOpRowFinancial">' +
      '<div class="salOpMetric"><span class="salOpMetricLabel">Valor financiado</span><span class="salOpMetricValue">' + fmtMoney(r.financed_value) + '</span></div>' +
      soRetorno('<div class="salOpMetric"><span class="salOpMetricLabel">Retorno</span><span class="salOpMetricValue">' + fmtMoney(r.return_considered) + '</span></div>') +
      '<div class="salOpMetric"><span class="salOpMetricLabel">SPF Extra (70%)</span><span class="salOpMetricValue">' + fmtMoney(r.spf_70) + '</span></div>' +
      soRetorno('<div class="salOpMetric"><span class="salOpMetricLabel">Rentabilidade</span><span class="salOpMetricValue">' + fmtMoney(r.operation_profitability) + '</span></div>') +
      (r.modality ? '<div class="salOpMetric"><span class="salOpMetricLabel">Modalidade</span><span class="salOpMetricValue">' + esc(r.modality) + '</span></div>' : '') +
      '</div>' +
      (r.applied_rule ? '<div class="salOpRowMeta">' + esc(r.applied_rule) + '</div>' : '') +
      '</div>';
  }
  // operational_salary_details devolve no máximo row_limit (2.000) operações, as mais recentes primeiro, e avisa com
  // truncated/row_count. grupo=true: a lista veio da consulta do grupo todo (detalhe do Analista, filtrado por loja
  // depois), então o corte pode deixar a loja incompleta mesmo com poucas linhas na tela.
  function limiteDetalhesHtml(data, grupo) {
    if (!data || data.truncated !== true) return '';
    var lim = fmtInt(data.row_limit || 2000), tot = fmtInt(data.row_count);
    return '<div class="modInfoState salDetailLimitNote" role="status"><div class="modStateTitle">Limite de ' + lim + ' operações atingido</div>' +
      (grupo
        ? 'O período tem ' + tot + ' operações no grupo e a consulta traz só as ' + lim + ' mais recentes; esta lista pode estar incompleta. Reduza o período para ver todas.'
        : 'Mostrando as ' + lim + ' operações mais recentes de ' + tot + ' no período. Reduza o período para ver todas.') + '</div>';
  }
  function detailsModalHtml() {
    if (!detailsModal) return '';
    var body;
    if (detailsModal.state === 'LOADING') {
      body = '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando detalhes…</div>';
    } else if (detailsModal.state === 'ERROR') {
      body = errorStateFor(detailsModal.error, 'os detalhes');
    } else {
      var rows = (detailsModal.data && detailsModal.data.rows) || [];
      body = limiteDetalhesHtml(detailsModal.data, false) +
        (!rows.length ? '<div class="modEmptyState"><div class="modStateTitle">Nenhuma operação encontrada.</div></div>' :
        '<div class="salOpList">' + rows.map(detailOperationRowHtml).join('') + '</div>');
    }
    return '<div class="salModalBackdrop"><div class="salModal" role="dialog" aria-modal="true" aria-labelledby="salModalTitle">' +
      '<h3 id="salModalTitle">Detalhes — ' + esc(detailsModal.sellerName || '') + '</h3>' +
      body +
      '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)"><button type="button" class="modBtn modBtnGhost" id="salModalClose">Fechar</button></div>' +
      '</div></div>';
  }

  // RH-5F.1, Gate 23: compare the client-filtered operation set against
  // the Analyst row's own authoritative aggregate fields (sold_count/
  // financed_count/production_value/return_value/spf_count/spf_value).
  // Pure read of already-fetched data -- never a formula re-derivation.
  // A mismatch is disclosed, never hidden (Gate 23's own explicit
  // allowance: "if commission cannot be decomposed... state that
  // explicitly").
  function analystDetailReconciliation(row, operations) {
    var filteredCount = operations.length;
    var financedCount = operations.filter(function (o) { return o.financed === true; }).length;
    var sumFinancedValue = operations.reduce(function (a, o) { return a + (Number(o.financed_value) || 0); }, 0);
    var sumReturn = operations.reduce(function (a, o) { return a + (Number(o.return_considered) || 0); }, 0);
    var spfOps = operations.filter(function (o) { return Number(o.spf_gross) > 0; });
    var sumSpf = operations.reduce(function (a, o) { return a + (Number(o.spf_gross) || 0); }, 0);
    var allMatch = filteredCount === Number(row.sold_count) &&
      financedCount === Number(row.financed_count) &&
      Math.abs(sumFinancedValue - Number(row.production_value || 0)) < 1 &&
      Math.abs(sumReturn - Number(row.return_value || 0)) < 1 &&
      spfOps.length === Number(row.spf_count) &&
      Math.abs(sumSpf - Number(row.spf_value || 0)) < 1;
    return { filteredCount: filteredCount, spfUnd: spfOps.length, allMatch: allMatch };
  }

  // RH-5F.1, Human decision (H2): Analyst Details must expose F&I-level
  // commission composition -- server-authoritative summary (store,
  // SPF UND, % Comissão, Comissão Total -- same faixaFor()/
  // comissaoTotalCellHtml() already used on the row itself, RH-5F.1) plus
  // the reconciled operation list, reusing detailOperationRowHtml (same
  // fields/layout as the seller Detalhes modal -- one visual system, not
  // two, Gate 26).
  function analystDetailsModalHtml() {
    if (!analystDetailsModal) return '';
    var row = analystDetailsModal.row;
    var faixaMatch = faixaFor('ANALISTA', row.store, null, null);
    var body;
    if (analystDetailsModal.state === 'LOADING') {
      body = '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando detalhes…</div>';
    } else if (analystDetailsModal.state === 'ERROR') {
      body = errorStateFor(analystDetailsModal.error, 'os detalhes');
    } else {
      var ops = analystDetailsModal.operations || [];
      var summary = limiteDetalhesHtml(analystDetailsModal.data, true) + '<div class="salAnalystDetailSummary">' +
        '<div class="salOpMetric"><span class="salOpMetricLabel">Loja</span><span class="salOpMetricValue">' + esc(row.store || '—') + '</span></div>' +
        '<div class="salOpMetric"><span class="salOpMetricLabel">SPF (UND)</span><span class="salOpMetricValue">' + fmtInt(row.spf_count) + ' UND</span></div>' +
        '<div class="salOpMetric"><span class="salOpMetricLabel">% Comissão</span><span class="salOpMetricValue">' + faixaCellHtml(faixaMatch) + '</span></div>' +
        '<div class="salOpMetric"><span class="salOpMetricLabel">Comissão Total</span><span class="salOpMetricValue salCommissionTotalValue">' + comissaoTotalCellHtml(faixaMatch) + '</span></div>' +
        (row.transfer ? '<div class="salOpMetric"><span class="salOpMetricLabel">Período de cobertura</span><span class="salOpMetricValue">' + esc(fmtDateBR(row.covered_start)) + ' – ' + esc(fmtDateBR(row.covered_end)) + '</span></div>' : '') +
        '</div>';
      if (!ops.length) {
        body = summary + '<div class="modEmptyState"><div class="modStateTitle">Nenhuma operação encontrada para este Analista neste período.</div></div>';
      } else {
        var rec = analystDetailReconciliation(row, ops);
        var reconciliationNote = rec.allMatch
          ? '<p class="modMuted salAnalystReconcileNote">Detalhamento reconciliado: ' + rec.filteredCount + ' operação(ões), ' + rec.spfUnd + ' UND de SPF, consistentes com os totais do Analista acima.</p>'
          : '<div class="modInfoState salAnalystReconcileNote"><div class="modStateTitle">Detalhamento pode não reconciliar exatamente</div>Os totais agregados do Analista acima continuam sendo a fonte oficial; as operações abaixo são a melhor composição disponível para esta loja/período e podem divergir ligeiramente do agregado.</div>';
        body = summary + reconciliationNote + '<div class="salOpList">' + ops.map(detailOperationRowHtml).join('') + '</div>';
      }
    }
    return '<div class="salModalBackdrop"><div class="salModal" role="dialog" aria-modal="true" aria-labelledby="salAnalystModalTitle">' +
      '<h3 id="salAnalystModalTitle">Detalhes — ' + esc(row.analyst_name || '') + (row.transfer ? ' (Cobertura)' : '') + '</h3>' +
      body +
      '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)"><button type="button" class="modBtn modBtnGhost" id="salAnalystModalClose">Fechar</button></div>' +
      '</div></div>';
  }

  // ---------- top-level render ----------

  // Continuous "Atual" body -- KPIs, then Equipe (with the manager/
  // team-total trailing row embedded per group), then Analistas below
  // it, all always rendered together (never a tab click away),
  // matching V1's own single-scroll structure exactly.
  function atualBodyHtml(ctx) {
    return kpiSectionHtml() +
      ownCommissionKpiSectionHtml(ctx) +
      teamCommissionCardsHtml(ctx) +
      commissionRangesHtml() +
      '<h2 class="modSectionTitle">Equipe</h2>' + equipeAnalistasHtml(ctx) +
      gestorFiSectionHtml(ctx);
  }

  function bodyHtml(ctx) {
    if (viewMode === 'historico') return historicoHtml(ctx);
    return atualBodyHtml(ctx);
  }

  function wire() {
    document.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        viewMode = btn.getAttribute('data-view-mode');
        if (viewMode === 'historico' && historyClosingsState === 'IDLE') { loadHistoryClosings(); return; }
        render(outletRef);
      });
    });
    var periodRetry = document.getElementById('salPeriodRetry');
    if (periodRetry) periodRetry.addEventListener('click', loadPeriods);
    var dashRetry = document.getElementById('salDashRetry');
    if (dashRetry) dashRetry.addEventListener('click', loadDashboard);
    var periodSelect = document.getElementById('salPeriodSelect');
    if (periodSelect) periodSelect.addEventListener('change', function () { onPeriodChange(periodSelect.value); });
    var customApply = document.getElementById('salCustomApply');
    if (customApply) customApply.addEventListener('click', function () {
      aplicarPersonalizado(document.getElementById('salCustomStart').value, document.getElementById('salCustomEnd').value);
    });
    document.querySelectorAll('[data-details]').forEach(function (btn) {
      btn.addEventListener('click', function () { openDetails(btn.getAttribute('data-details'), btn.getAttribute('data-name')); });
    });
    var modalClose = document.getElementById('salModalClose');
    if (modalClose) modalClose.addEventListener('click', closeDetails);

    document.querySelectorAll('[data-analyst-details]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var store = btn.getAttribute('data-analyst-store');
        var coverageId = btn.getAttribute('data-analyst-coverage') || null;
        var rows = (dashboard && dashboard.analystMetrics && dashboard.analystMetrics.rows) || [];
        var row = rows.filter(function (r) { return r.store === store && (r.coverage_id || null) === coverageId; })[0];
        if (row) openAnalystDetails(row);
      });
    });
    var analystModalClose = document.getElementById('salAnalystModalClose');
    if (analystModalClose) analystModalClose.addEventListener('click', closeAnalystDetails);

    var histRetry = document.getElementById('salHistRetry');
    if (histRetry) histRetry.addEventListener('click', loadHistoryClosings);
    var histSelect = document.getElementById('salHistClosingSelect');
    if (histSelect) histSelect.addEventListener('change', function () { selectClosing(histSelect.value || null); });
    var histOpDetailBtn = document.getElementById('salHistOpDetailBtn');
    if (histOpDetailBtn) histOpDetailBtn.addEventListener('click', loadHistoryOperationalDetail);
    var histExportBtn = document.getElementById('salHistExportBtn');
    if (histExportBtn) histExportBtn.addEventListener('click', triggerExport);
  }

  function render(outlet) {
    outletRef = outlet;
    var ctx = getAuthContext();
    var period = selectedPeriod();
    outlet.innerHTML =
      '<div class="salPage">' +
      '<div class="modPageHeader"><div class="modHeaderMain">' +
      '<h1 class="modTitle">Salários &amp; Comissões</h1>' +
      '<p class="modSubtitle">Acompanhamento de produção, retorno, SPF e rentabilidade por período.</p>' +
      '</div></div>' +
      periodSelectorHtml() +
      (period ? '<p class="modMuted">Período selecionado: ' + esc(fmtDateBR(period.data_inicio)) + ' a ' + esc(fmtDateBR(period.data_fim)) + '</p>' : '') +
      viewModeToggleHtml(ctx) +
      '<div class="salBody">' + bodyHtml(ctx) + '</div>' +
      detailsModalHtml() +
      analystDetailsModalHtml() +
      '</div>';
    wire();
  }

  window.NX_SALARIOS_COMISSOES_PAGE = {
    // Exposed read-only for deterministic testing, same pattern as
    // every sibling module (NX_CENTRAL_ATENDIMENTO_FI_PAGE, etc.).
    getViewMode: function () { return viewMode; },
    getPeriodsState: function () { return periodsState; },
    getDashboardState: function () { return dashboardState; },
    getSelectedPeriodId: function () { return selectedPeriodId; },
    getSelectedPeriod: function () { return selectedPeriod(); },
    getCustomError: function () { return customError; },
    getHistoryClosingsState: function () { return historyClosingsState; },
    getSelectedClosingId: function () { return selectedClosingId; },
    getHistoryDetailState: function () { return historyDetail ? historyDetail.state : null; },
    getCommissionConfigState: function () { return commissionConfigState; },
    getGestorFiState: function () { return gestorFiState; },
    getFaixaRowsState: function () { return faixaRowsState; },
    getOwnCommissionState: function () { return ownCommissionState; },
    getScopeCommissionState: function () { return scopeCommissionState; },
    render: function (outlet) {
      outletRef = outlet;
      // SALFIX1: captured once per mount, compared inside every load*
      // function's async callback (see mountRoute declaration above).
      mountRoute = (window.NX_ROUTER && typeof window.NX_ROUTER.currentRouteId === 'function')
        ? window.NX_ROUTER.currentRouteId() : null;
      viewMode = 'atual';
      periods = null; periodsState = 'LOADING'; selectedPeriodId = null;
      customRange = null; customError = '';
      dashboard = null; dashboardState = 'LOADING';
      commissionConfig = null; commissionConfigState = 'LOADING';
      gestorFi = null; gestorFiState = 'IDLE'; gestorFiError = null;
      faixaRows = null; faixaRowsState = 'IDLE'; faixaRowsError = null;
      ownCommission = null; ownCommissionState = 'IDLE'; ownCommissionError = null;
      scopeCommission = null; scopeCommissionState = 'IDLE'; scopeCommissionError = null;
      detailsModal = null;
      analystDetailsModal = null;
      historyClosings = null; historyClosingsState = 'IDLE'; historyClosingsError = null;
      selectedClosingId = null; historyDetail = null; historyOpDetail = null;
      historyExportState = 'IDLE'; historyExportError = null;
      loadCommissionConfig();
      return loadPeriods();
    }
  };
})();
