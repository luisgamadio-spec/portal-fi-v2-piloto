/* PORTAL-NEXT V2 -- Score REAL data provider (Real Data Integration
   Foundation, Score Phase 2A).

   THIN transport boundary, same principle as gestao/dashbi/
   coparticipado-real-provider.js: this file's only job is calling the
   real, already-proven operational_score_coparticipated_data RPC
   (KEEP_SHARED_RPC, Phase 0/1) and returning its raw payload (or a
   classified error) -- no Score calculation, no family classification,
   no scope calculation. All business logic stays in
   score-real-view-model.js (field mapping only) and the frozen
   calcScores() in score.adapter.js.

   No p_group_view, no store/department override parameter exists on
   this RPC's own signature (Phase 1, Gate 7 -- reconfirmed here) --
   server scope (operational_current_scope()) is the only authority;
   this file sends nothing but p_start/p_end (Gate 12: NO_CLIENT_SCOPE_AUTHORITY).

   Date contract (Phase 2A Gate 6): Score V2 has no period filter UI
   (unlike real production's own #dateStart/#dateEnd inputs). Real
   production's own runtime default (modules/score.html, confirmed via
   direct read: `setDateInputs(new Date(2026,5,1), brDateToday(), false)`)
   is start=2026-06-01 fixed, end=today -- SCORE_DATE_CONTRACT_DIRECT.
   This file reproduces that exact real default; callers may still pass
   an explicit {start,end} if a future UI adds filters.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), same
   as every other real provider -- no independent Supabase client. */
(function () {
  'use strict';

  var DEFAULT_START = '2026-06-01';

  function todayIso() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // Gate 8 runtime-state vocabulary: LOADING/SUCCESS/EMPTY/AUTH_DENIED/
  // SESSION_EXPIRED/RPC_ERROR/TIMEOUT/MALFORMED_RESPONSE.
  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  // Gate 13/Gate 12 (Phase 1): fail closed if the real contract's own
  // self-declared privacy flags ever indicate the exposure they promise
  // not to have, or if any sensitive key those flags describe is
  // literally present -- either would mean the deployed RPC contract
  // changed underneath this integration without re-auditing it.
  var SENSITIVE_KEYS = ['client_identity', 'client_name', 'customer_name', 'personal_documents', 'cpf', 'chassis', 'full_chassis'];
  function hasSensitiveShape(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.contains_client_identity || data.contains_personal_documents || data.contains_full_chassis) return true;
    return SENSITIVE_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(data, k); });
  }

  function hasValidShape(data) {
    return !!data && typeof data === 'object' &&
      Array.isArray(data.sales) && Array.isArray(data.finance);
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  function loadScoreReal(params) {
    params = params || {};
    var start = params.start || DEFAULT_START;
    var end = params.end || todayIso();

    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'RPC_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }

    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });

      var timeoutController = null;
      var signal = params.signal;
      if (!signal && typeof AbortController === 'function') {
        timeoutController = new AbortController();
        signal = timeoutController.signal;
      }
      var timer = timeoutController
        ? setTimeout(function () { timeoutController.abort(); }, DEFAULT_TIMEOUT_MS)
        : null;

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/operational_score_coparticipated_data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ p_start: start, p_end: end }),
        signal: signal
      }).then(function (resp) {
        if (timer) clearTimeout(timer);
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao carregar dados do Score.' });
          }
          if (hasSensitiveShape(body) || !hasValidShape(body)) {
            return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
          }
          return body;
        });
      }, function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          // Distinguish an explicit caller-driven cancellation (stale
          // request superseded) from this provider's own timeout abort.
          if (params.signal && params.signal.aborted) {
            return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
          }
          return Promise.reject({ state: 'TIMEOUT', message: 'Tempo de resposta excedido.' });
        }
        return Promise.reject({ state: 'RPC_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  window.NX_SCORE_REAL_PROVIDER = {
    loadScoreReal: loadScoreReal,
    _internal: { DEFAULT_START: DEFAULT_START, todayIso: todayIso }
  };
})();
