/* PORTAL-NEXT V2 -- Dashbi REAL data provider (Real Data Integration
   Foundation, Dashbi Phase 2).

   THIN transport boundary, same principle as gestao-real-provider.js
   (Gate B2): this file's only job is calling the real, already-proven
   operational_metrics / operational_model_metrics RPCs and returning
   their raw payloads (or a classified error) -- no financial
   calculation, no scope calculation, no permission calculation, no
   plan/model classification. All of that is 100% backend-owned
   (Dashbi Phase 1 contract audit) or, for the thin presentation
   reshape (ticket derivation, model-name normalization), lives in
   dashbi-real-view-model.js -- never here.

   p_group_view is ALWAYS sent as true (Dashbi Phase 2, Stage A, Gate
   A5 -- DASHBI_GROUP_VIEW_AUTHORITY_V1, frozen): the real RPC's own
   server-side gate (profile IN ('ANALISTA','VENDEDOR') AND
   portal_modulos_permitidos() ? 'dashbi') decides whether this
   actually elevates scope; for MASTER/DIRETOR/GERENTE it is a no-op.
   The frontend never computes or overrides scope itself -- exactly
   V1's own real production adapter's pattern
   (analise-geral-grupo-secure-adapter.js fetchMetrics()).

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), same
   as gestao-real-provider.js -- no independent Supabase client. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (code === '22023') return 'INVALID_FILTER';
    if (code === 'P0002') return 'SCOPE_EMPTY';
    if (code === '57014') return 'BACKEND_ERROR';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  // Same anti-leak guard family as gestao-real-provider.js (Gate B14) --
  // both real Dashbi RPCs self-declare contains_personal_documents/
  // client_identity/chassis: false (Phase 1, Gate 14); their presence
  // would mean either a wrong RPC got called or the contract changed
  // underneath this integration without re-auditing it.
  var SENSITIVE_KEYS = ['client_identity', 'personal_documents', 'cpf', 'chassis', 'customer_name', 'customer_document'];
  function hasSensitiveShape(data) {
    if (!data || typeof data !== 'object') return false;
    if (SENSITIVE_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(data, k); })) return true;
    if (data.contains_personal_documents || data.contains_client_identity || data.contains_chassis) return true;
    return false;
  }

  function hasValidRowsShape(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.rows);
  }

  function callRpc(rpcName, start, end) {
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
        body: JSON.stringify({ p_start: start, p_end: end, p_group_view: true })
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao carregar dados.' });
          }
          if (hasSensitiveShape(body) || !hasValidRowsShape(body)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Resposta inesperada do servidor.' });
          }
          return body;
        });
      }, function () {
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // Both real RPCs fetched together (Gate B3 -- operational_metrics for
  // store/seller/department structures, operational_model_metrics for
  // model-level views, never feeding model presentation from
  // operational_metrics rows the way V1's own secure adapter does --
  // DASHBI_V1_MODEL_INTEGRATION_DEFECT_NOT_REPLICATED).
  function loadDashbiReal(params) {
    params = params || {};
    if (!params.start || !params.end) {
      return Promise.reject({ state: 'INVALID_FILTER', message: 'Informe um período válido.' });
    }
    return Promise.all([
      callRpc('operational_metrics', params.start, params.end),
      callRpc('operational_model_metrics', params.start, params.end)
    ]).then(function (results) {
      return { metrics: results[0], modelMetrics: results[1] };
    });
  }

  // Local-calendar-date helpers, same principle as V1's own secure adapter
  // (analise-geral-grupo-secure-adapter.js's safeDate()/iso()) -- params.start/
  // end travel as "YYYY-MM-DD" strings (dashbi.js's currentDateStart/End),
  // never as Date/toISOString(), so the day never shifts across a UTC
  // boundary (Gate 8, this Wave's brief -- NOT the Score UTC defect).
  function parseLocalDate(value) {
    var parts = String(value || '').split('-').map(Number);
    return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
  }
  function formatLocalDate(date) {
    return date ? date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') : null;
  }

  // FC-1 (GAP-001): dual-period orchestration -- SAME_PIPELINE_DIFFERENT_
  // PERIOD (this Wave's brief, Gate 10). The previous comparable period is
  // computed with the exact same day-aligned rule V1's own secure adapter
  // uses (getPreviousMonthComparablePeriod, byte-identical extraction --
  // dashbi.adapter.js), then fetched through the SAME loadDashbiReal() used
  // for the current period -- no separate/simplified fetch path.
  //
  // Both periods are fetched IN PARALLEL (Gate 13, this Wave's brief:
  // "preferir execução paralela quando segura, não serializar sem motivo")
  // -- there is no dependency between them, so the previous fetch is fired
  // alongside the current one, not chained after it. Independent .then/
  // .catch on each keeps the failure mode below (Gate 12) intact even
  // though both start together: current failing still rejects this whole
  // promise; previous failing alone never does.
  //
  // Failure mode (Gate 12, this Wave's brief): current period is primary.
  //   CURRENT rejects       -> this promise rejects (normal error state).
  //   CURRENT resolves,
  //   PREVIOUS rejects       -> resolves with previous:null, previousError
  //                            set (dashboard renders, comparison omitted).
  //   Both resolve           -> resolves with both payloads.
  function loadDashbiRealWithComparison(params) {
    params = params || {};
    if (!params.start || !params.end) {
      return Promise.reject({ state: 'INVALID_FILTER', message: 'Informe um período válido.' });
    }
    var A = window.NX_DASHBI_ADAPTER;
    var previousPeriod = A && A.getPreviousMonthComparablePeriod
      ? A.getPreviousMonthComparablePeriod(parseLocalDate(params.start), parseLocalDate(params.end))
      : { start: null, end: null };
    var previousStart = formatLocalDate(previousPeriod.start);
    var previousEnd = formatLocalDate(previousPeriod.end);

    var currentPromise = loadDashbiReal(params);
    var previousPromise = (!previousStart || !previousEnd)
      ? Promise.resolve(null)
      : loadDashbiReal({ start: previousStart, end: previousEnd }).then(
          function (previousPayload) { return { payload: previousPayload, error: null }; },
          function (err) { return { payload: null, error: err }; }
        );

    return currentPromise.then(function (currentPayload) {
      return previousPromise.then(function (previousResult) {
        if (!previousResult) return { current: currentPayload, previous: null, previousError: null };
        return { current: currentPayload, previous: previousResult.payload, previousError: previousResult.error };
      });
    });
  }

  window.NX_DASHBI_REAL_PROVIDER = {
    loadDashbiReal: loadDashbiReal,
    loadDashbiRealWithComparison: loadDashbiRealWithComparison
  };
})();