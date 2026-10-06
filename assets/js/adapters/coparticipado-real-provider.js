/* PORTAL-NEXT V2 -- Coparticipado REAL data provider (Real Data
   Integration Foundation, Coparticipado Phase 2).

   THIN transport boundary, same principle as gestao/dashbi-real-
   provider.js: this file's only job is calling the real, already-
   proven operational_score_coparticipated_data RPC and returning its
   raw payload (or a classified error) -- no plan classification, no
   SPF/FANDI matching, no client_match_key resolution, no scope
   calculation, no rebate/coparticipation calculation. All of that is
   100% backend-owned (Phase 1/1B contract audit) except the thin,
   already-proven-safe rebate presentation formula, which lives in
   coparticipado-real-view-model.js -- never here.

   No p_group_view, no store/department override parameter exists on
   this RPC's own signature (Phase 1B, Gate 7) -- server scope
   (operational_current_scope()) is the only authority; this file sends
   nothing but p_start/p_end.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), same
   as every other real provider -- no independent Supabase client. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (code === '22023') return 'INVALID_FILTER';
    if (code === '57014') return 'BACKEND_ERROR';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  // Gate 10/14: fail closed if the real contract's own self-declared
  // privacy flags ever indicate the exposure they promise not to have,
  // or if any of the sensitive keys those flags describe are literally
  // present -- either would mean the deployed RPC contract changed
  // underneath this integration without re-auditing it.
  var SENSITIVE_KEYS = ['client_identity', 'client_name', 'customer_name', 'personal_documents', 'cpf', 'chassis', 'full_chassis'];
  function hasSensitiveShape(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.contains_client_identity || data.contains_personal_documents || data.contains_full_chassis) return true;
    return SENSITIVE_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(data, k); });
  }

  function hasValidShape(data) {
    return !!data && typeof data === 'object' &&
      Array.isArray(data.sales) && Array.isArray(data.finance) && Array.isArray(data.rates);
  }

  function loadCoparticipadoReal(params) {
    params = params || {};
    if (!params.start || !params.end) {
      return Promise.reject({ state: 'INVALID_FILTER', message: 'Informe um período válido.' });
    }
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'BACKEND_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }

    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/operational_score_coparticipated_data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ p_start: params.start, p_end: params.end }),
        signal: params.signal
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao carregar dados.' });
          }
          if (hasSensitiveShape(body) || !hasValidShape(body)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Resposta inesperada do servidor.' });
          }
          return body;
        });
      }, function (err) {
        // Gate 12: an aborted (superseded) request is not a user-facing
        // error -- the caller (coparticipado.js) recognizes ABORTED and
        // silently drops it, same as it would a stale-response check.
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  window.NX_COPARTICIPADO_REAL_PROVIDER = {
    loadCoparticipadoReal: loadCoparticipadoReal
  };
})();
