/* PORTAL-NEXT V2 -- Gestão REAL data provider (Real Data Integration
   Foundation, Phase 2).

   THIN transport boundary, same principle as brabus-intelligence.js's
   adapter (Gate 4): this file's only job is calling the real, already-
   proven operational_fandi_dashboard RPC and returning its raw payload
   (or a classified error) -- no financial calculation, no scope
   calculation, no permission calculation, no business classification.
   All of that is 100% backend-owned (Phase 1 contract audit, Gate 5/9).

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), exactly
   like brabus-intelligence.js does for its own real_text transport:
   getAccessToken() supplies the bearer token for one request, never
   stored, never logged. No independent Supabase client is created here.
   No module-specific credential construction -- this file cannot
   authenticate anything on its own, it can only ask the already-
   authenticated session for its current token. */
(function () {
  'use strict';

  // Error normalization (Gate 9): Postgres/PostgREST error codes ->
  // the runtime states gestao.js's render() knows how to show. Never
  // leaks raw backend error text to the user -- gestao.js maps these
  // codes to its own Portuguese copy.
  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (code === '22023') return 'INVALID_FILTER';
    if (code === 'P0002') return 'SCOPE_EMPTY';
    if (code === '57014') return 'BACKEND_ERROR';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  // Gate 11: narrow defensive shape guard, same principle as V1's own
  // analise-fi-grupo.html check -- operational_fandi_dashboard's real
  // contract (Phase 1, Gate 12) never returns these keys; their
  // presence would mean either a wrong RPC got called or the contract
  // changed underneath this integration without re-auditing it.
  var SENSITIVE_KEYS = ['client_identity', 'personal_documents', 'cpf', 'operation_identity', 'customer_name', 'customer_document'];
  function hasSensitiveShape(data) {
    if (!data || typeof data !== 'object') return false;
    return SENSITIVE_KEYS.some(function (k) { return Object.prototype.hasOwnProperty.call(data, k); });
  }

  function loadGestaoReal(params) {
    params = params || {};
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'BACKEND_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }

    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/operational_fandi_dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          p_start: params.start,
          p_end: params.end,
          p_store: params.store || null,
          p_department: params.department || null
        })
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao carregar dados.' });
          }
          if (hasSensitiveShape(body)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Resposta inesperada do servidor.' });
          }
          return body;
        });
      }, function () {
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  window.NX_GESTAO_REAL_PROVIDER = {
    loadGestaoReal: loadGestaoReal
  };
})();