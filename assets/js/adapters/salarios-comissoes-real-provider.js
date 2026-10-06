/* PORTAL-NEXT V2 -- Salários & Comissões REAL data provider (RH-4A).

   THIN transport boundary, same principle and same request/error-
   classification vocabulary as every other real provider in this
   codebase (dashbi-real-provider.js, gestao-real-provider.js,
   painel-analista-fi-real-provider.js, central-atendimento-fi-real-
   provider.js): this file's only job is calling real, already-proven,
   live (ATIVA) RPCs and returning their raw payload (or a classified
   error) -- no financial calculation, no scope calculation, no
   commission formula (share/faixa/comissaoPrincipal/comissaoSpf/
   comissaoTotal), no batch-canonicalization logic, no plan
   classification. All of that is 100% backend-owned, proven live by
   RH-1/RH-2/RH-3/RH-3A -- reproducing any of it here would be
   SALARIOS_PROVIDER_FINANCIAL_RECOMPUTATION, explicitly forbidden.

   RH-2 production authority (Secure commit 8953fa9, reconfirmed live
   this Wave): RH/RECURSOS HUMANOS resolves via operational_current_
   scope() to profile 'RH', departments ['NOVOS','SEMINOVOS'] (corporate
   scope, no store restriction), is_master/is_director/is_seller all
   false. This provider trusts that server resolution completely --
   it never computes or overrides scope client-side, and never grants
   RH (or any profile) additional authority beyond what each RPC's own
   server-side gate already decides.

   SCOPE OF THIS SLICE (RH-4A, +1 RPC in RH-5B.3): the LIVE, current-
   period operational read surface -- the same 5 RPCs V1's own real
   production dashboard (showComissoesModule()/
   loadOperationalCommissionMetrics(), RH-3 frontend audit) calls for
   its main view, plus operational_portal_config() (RH-5B.3 -- a real,
   already-live, already authenticated-granted config-reference RPC
   this provider simply hadn't wired in yet; feeds only the static
   "Faixas de comissão" reference card, never a per-row classification).
   Deliberately EXCLUDED, by RH-4A's own explicit mandate: master_close_commission_period,
   master_reopen_commission_period, master_admin_manage (write/closing
   authority) and master_commission_closings/master_commission_snapshot/
   master_commission_snapshot_export (MASTER-only historical-snapshot
   read authority). Consequence, stated explicitly rather than silently
   worked around: this provider has NO WAY to expose fechamentos_
   comissao.historical_detail_status (LEGACY_PARTIAL/COMPLETE) or the
   190-row broken-snapshot pattern RH-3A found (§9/§18 of that report)
   -- none of the 5 RPCs below ever read snapshot_comissoes/
   fechamentos_comissao at all; they compute live from portal_sales/
   portal_finance_operations/portal_spf_operations directly. That
   badge/history decision is out of scope here and belongs to a future,
   separate, MASTER-gated history provider slice.

   NO RAW TABLE FALLBACK (Gate 14): every method below calls a governed
   RPC only. If a required RPC is ever unavailable, this file fails
   closed (rejects with a classified error) -- it does not, and must
   never, read snapshot_comissoes/snapshot_operational_detail/
   portal_sales/portal_finance_operations/portal_spf_operations/
   usuarios/analistas_fi directly from the browser.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH) and the
   EXISTING shared Supabase config (window.NX_INTELLIGENCE_CONFIG) --
   no independent Supabase client, no new backend, no service_role. */
(function () {
  'use strict';

  // Same error-classification vocabulary as dashbi-real-provider.js
  // (Gate 15 of this Wave's brief: reuse existing categories rather
  // than inventing a parallel taxonomy). '22023' is the exact SQLSTATE
  // every RPC below raises for both "Período inválido." (null/empty/
  // start>end) and "Período máximo permitido: 732 dias." (RH-1/RH-3A
  // live body confirmation) -- both map to INVALID_FILTER, the same
  // term this codebase already uses for period-shape rejection.
  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (code === '22023') return 'INVALID_FILTER';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  // Anti-leak guard, RPC-shape-aware (Gate B14-equivalent, dashbi-real-
  // provider.js's own pattern) -- but NOT a blind "any contains_* flag
  // rejects", because operational_salary_details' own real, proven
  // contract (RH-1 live read) legitimately and safely sets
  // contains_masked_chassis:true (masked, non-reversible, expected) and
  // operational_salary_manager_directory uses a differently-named flag
  // (contains_operational_identifiers) than the others
  // (contains_chassis). Only genuinely sensitive flags reject.
  var REJECT_IF_TRUE = [
    'contains_full_chassis', 'contains_chassis', 'contains_client_identity',
    'contains_personal_documents', 'contains_nbs', 'contains_operational_identifiers'
  ];
  var REJECT_IF_KEY_PRESENT = ['cpf', 'client_identity', 'personal_documents', 'customer_name', 'customer_document'];
  function hasSensitiveShape(data) {
    if (!data || typeof data !== 'object') return false;
    if (REJECT_IF_KEY_PRESENT.some(function (k) { return Object.prototype.hasOwnProperty.call(data, k); })) return true;
    return REJECT_IF_TRUE.some(function (k) { return data[k] === true; });
  }

  function hasValidRowsShape(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.rows);
  }

  // RH-5C.1: operational_gestor_fi_commission's real, live shape is
  // {pronto, ...} -- never a {rows:[...]} envelope (it returns exactly
  // one group-level result, not a row list), so the default
  // hasValidRowsShape check would reject it as malformed. `opts.
  // validateShape` lets a caller override the shape check per-RPC
  // without weakening the default guard every other method here still
  // uses.
  function hasValidPrimingShape(data) {
    return !!data && typeof data === 'object' && typeof data.pronto === 'boolean';
  }

  function callRpc(rpcName, body, opts) {
    opts = opts || {};
    var validateShape = opts.validateShape || hasValidRowsShape;
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'BACKEND_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + rpcName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body || {})
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (respBody) {
          if (!resp.ok) {
            var code = respBody && respBody.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (respBody && respBody.message) || 'Falha ao comunicar com o servidor.' });
          }
          if (hasSensitiveShape(respBody) || !validateShape(respBody)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Resposta inesperada do servidor.' });
          }
          return respBody;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  function requirePeriod(start, end) {
    if (!start || !end) {
      return Promise.reject({ state: 'INVALID_FILTER', message: 'Informe um período válido.' });
    }
    return null;
  }

  // operational_commission_periods() -- read, no params. V1/live
  // contract (RH-3A confirmed): gate is auth.uid() is not null only --
  // no profile filter, every authenticated user sees the same period
  // catalog (id/nome_periodo/data_inicio/data_fim/status/periodo_atual/
  // ativo/criado_por), filtered server-side to ativo=true rows only.
  function loadCommissionPeriods() {
    return callRpc('operational_commission_periods', {}).then(function (body) {
      return body.rows;
    });
  }

  // operational_commission_metrics(p_start,p_end) -- read. Primary
  // seller-level metrics + group totals (share/production/return/SPF/
  // profitability) -- server-computed, batch-canonicalized (RH-3A
  // §7/§8: RESOLVED_AND_LIVE for every relevant incident).
  function loadCommissionMetrics(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_commission_metrics', { p_start: start, p_end: end });
  }

  // operational_analyst_commission_metrics_v2(p_start,p_end) -- read.
  // The "v2" wrapper is the ONLY analyst RPC ever called from a real
  // frontend (docs/COMMISSION-ENGINE-AUTHORITY.md, PM-5I -- confirmed
  // still green this Wave, 33/33) -- rows arrive already redistributed
  // for the calling ANALISTA's own féria/ausência coverage assignments,
  // via a real, separate authorization gate inside operational_
  // analyst_commission_metrics itself (MASTER or the analyst's own
  // identity only -- RH-1's Incident P1 fix). Never call the v1 base
  // RPC directly from a frontend consumer.
  function loadAnalystCommissionMetrics(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_analyst_commission_metrics_v2', { p_start: start, p_end: end });
  }

  // operational_salary_manager_directory(p_start,p_end) -- read.
  // Manager (GERENTE) name-by-store/department directory, scoped by
  // the same operational_current_scope() authority as every sibling
  // RPC here.
  function loadManagerDirectory(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_salary_manager_directory', { p_start: start, p_end: end });
  }

  // operational_salary_details(p_start,p_end,p_seller_id) -- read.
  // Per-operation drill-down (DETALHES). p_seller_id is optional/
  // nullable (bulk mode); this provider never assumes a value -- the
  // caller decides. Chassis arrives pre-masked by the server
  // (contains_masked_chassis:true is the EXPECTED, safe shape here,
  // not rejected by the anti-leak guard above).
  function loadSalaryDetails(start, end, sellerId) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_salary_details', { p_start: start, p_end: end, p_seller_id: sellerId || null });
  }

  // Convenience aggregate mirroring V1's own real, proven resilience
  // pattern (loadOperationalCommissionMetrics(), RH-3 frontend audit):
  // the 3 primary dashboard RPCs are fetched together but INDEPENDENTLY
  // try/caught, so one failing (e.g. the analyst RPC's own documented
  // timeout risk under many active absence-coverage records, Incidente
  // 3.21) never blocks the other two. Never resolves to a fabricated
  // zero value -- a failed leg carries its own classified error object,
  // consumed by a future presentation layer, never silently substituted.
  function loadCommissionDashboardData(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    function settle(promise) {
      return promise.then(
        function (data) { return { data: data, error: null }; },
        function (err) { return { data: null, error: err }; }
      );
    }
    return Promise.all([
      settle(loadCommissionMetrics(start, end)),
      settle(loadAnalystCommissionMetrics(start, end)),
      settle(loadManagerDirectory(start, end))
    ]).then(function (results) {
      return {
        metrics: results[0].data, metricsError: results[0].error,
        analystMetrics: results[1].data, analystMetricsError: results[1].error,
        managerDirectory: results[2].data, managerDirectoryError: results[2].error
      };
    });
  }

  // operational_portal_config() -- read, no params. RH-5B.3: a REAL,
  // already-live, already `authenticated`-EXECUTE-granted RPC
  // (independently confirmed this Wave, live pg_get_functiondef read)
  // -- was simply never wired into this provider before. Returns the
  // 13 real commission-threshold config keys V1's own "Faixas de
  // comissão" reference card reads (share_minimo, spf_liquido_
  // percentual, bonus_spf_analista, limite_retorno_novos/seminovos,
  // vendedor/gerente/analista_faixa_*) as {chave, valor} pairs --
  // reshaped here into a plain object, values coerced to Number where
  // parseable. This is a REFERENCE/RULES lookup only (matches V1's own
  // static Rules Hub card, config-driven, not period-specific) --
  // NOT used to classify any individual row's own faixa (that per-row
  // gap, real as of RH-5B.3, is now closed by loadCommissionFaixaRows()
  // below, RH-5C.1).
  function loadPortalConfig() {
    return callRpc('operational_portal_config', {}).then(function (body) {
      var out = {};
      body.rows.forEach(function (r) {
        var n = Number(r.valor);
        out[r.chave] = isNaN(n) ? r.valor : n;
      });
      return out;
    });
  }

  // operational_gestor_fi_commission(p_start,p_end) -- read, MASTER-only
  // (server-enforced, 42501 for anyone else). RH-5C.1: the new governed,
  // config-driven live/open-period equivalent of V1's calcGestorFIGrupo()
  // -- returns a single group-level result (never a row list), computed
  // and rounded entirely server-side. This provider performs ZERO
  // arithmetic on the response -- `pronto:false` (no beneficiary
  // configured, or more than one) is passed through as-is, never
  // papered over with a fabricated zero.
  function loadGestorFiCommission(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_gestor_fi_commission', { p_start: start, p_end: end }, { validateShape: hasValidPrimingShape });
  }

  // operational_commission_faixa_rows(p_start,p_end) -- read, MASTER-only.
  // RH-5C.1: server-authoritative per-row Faixa classification for
  // VENDEDOR/GERENTE/ANALISTA, current/open period only -- FIX-THE-DRIFT
  // replacement for V1's faixaBadge() (which compared the computed
  // faixa against its OWN independent hardcoded literals, silently
  // drifting from governed config). This provider never computes
  // share_tier/retorno_tier/faixa_level itself -- every row arrives
  // pre-classified.
  function loadCommissionFaixaRows(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_commission_faixa_rows', { p_start: start, p_end: end });
  }

  // operational_own_commission_summary(p_start,p_end) -- read, SELF-
  // SCOPED (RH-5F.3). Identity is derived server-side from auth.uid()
  // only -- there is no target-user parameter to pass, by design, so
  // this call can never request another person's compensation. Returns
  // {rows:[...], comissao_total, profile} for VENDEDOR/GERENTE/ANALISTA,
  // or {rows:[], comissao_total:0, profile} for any other profile
  // (never an exception) -- `rows` is always a real array, so the
  // default hasValidRowsShape guard applies unmodified.
  function loadOwnCommissionSummary(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_own_commission_summary', { p_start: start, p_end: end });
  }

  // operational_scope_commission_rows(p_start,p_end) -- read, SELF-SCOPED
  // (RH-5F.3A, Human decisions H-SAL-1/H-SAL-3). Identity derived from
  // auth.uid() only -- no target store/user parameter exists. Returns
  // seller-level Faixa/comissao_total rows for the CALLING ANALISTA's or
  // GERENTE's own store scope, plus team_comissao_total; {rows:[],
  // team_comissao_total:0, profile} for any other profile.
  function loadScopeCommissionRows(start, end) {
    var invalid = requirePeriod(start, end);
    if (invalid) return invalid;
    return callRpc('operational_scope_commission_rows', { p_start: start, p_end: end });
  }

  window.NX_SALARIOS_COMISSOES_REAL_PROVIDER = {
    loadCommissionPeriods: loadCommissionPeriods,
    loadCommissionMetrics: loadCommissionMetrics,
    loadAnalystCommissionMetrics: loadAnalystCommissionMetrics,
    loadManagerDirectory: loadManagerDirectory,
    loadSalaryDetails: loadSalaryDetails,
    loadCommissionDashboardData: loadCommissionDashboardData,
    loadPortalConfig: loadPortalConfig,
    loadGestorFiCommission: loadGestorFiCommission,
    loadCommissionFaixaRows: loadCommissionFaixaRows,
    loadOwnCommissionSummary: loadOwnCommissionSummary,
    loadScopeCommissionRows: loadScopeCommissionRows
  };
})();
