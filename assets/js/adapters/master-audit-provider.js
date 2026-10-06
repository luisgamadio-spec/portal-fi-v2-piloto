/* PORTAL-NEXT V2 -- Painel Master / Auditoria REAL data provider
   (Painel Master Phase PM-4B).

   THIN transport boundary, same principle and shape as
   master-acessos-provider.js/master-users-provider.js. Real contract
   (Phase 4A forensics, re-confirmed this Phase): the V1 "Auditoria"
   tab's sole authority is master_admin_security_data()'s own `audit`
   field -- the SAME RPC master-users-provider.js's loadMasterUsersData()
   already calls for Usuários, but that file only ever returns
   { users, convites } and silently discards `audit`. This file makes
   its OWN call to the same RPC rather than reaching into
   master-users-provider.js's internals -- Auditoria and Usuários are
   independent admin concerns that happen to share one backend
   function; coupling their fetch lifecycles together would be exactly
   the "bad conceptual coupling" this Phase's own brief warns against.
   The extra round-trip to an already-cheap, already-audited RPC is the
   deliberate tradeoff for that independence.

   IMPORTANT (Phase 4A finding, re-confirmed via pg_get_functiondef this
   Phase): the RPC's own `audit` field is NOT the full auditoria table --
   it is explicitly `ORDER BY criado_em DESC LIMIT 100` server-side.
   478 real rows exist in the table; only the 100 most recent are ever
   returned by this RPC. This file does not request more, does not
   paginate past it, and does not claim completeness -- the view-model/
   controller must never imply "all history" when this is a bounded
   recent-events window.

   READ-ONLY surface: no mutation function exists in this file, on
   purpose (Gate 4/18: Auditoria stays read-only, no resolution
   workflow is introduced here). */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  function callRpc(fnName, params, signal) {
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
      var effectiveSignal = signal;
      if (!effectiveSignal && typeof AbortController === 'function') {
        timeoutController = new AbortController();
        effectiveSignal = timeoutController.signal;
      }
      var timer = timeoutController
        ? setTimeout(function () { timeoutController.abort(); }, DEFAULT_TIMEOUT_MS)
        : null;

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fnName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(params || {}),
        signal: effectiveSignal
      }).then(function (resp) {
        if (timer) clearTimeout(timer);
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao processar solicitação.' });
          }
          return body;
        });
      }, function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          if (signal && signal.aborted) return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
          return Promise.reject({ state: 'TIMEOUT', message: 'Tempo de resposta excedido.' });
        }
        return Promise.reject({ state: 'NETWORK_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  function hasValidAuditShape(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.audit);
  }

  // Read-only. Real contract: master_admin_security_data() -- same RPC
  // Usuários already calls, own independent round-trip here (see file
  // header). Fails closed (MALFORMED_RESPONSE) rather than ever
  // synthesizing a plausible-looking empty audit list.
  function loadAuditData(params) {
    params = params || {};
    return callRpc('master_admin_security_data', {}, params.signal).then(function (data) {
      if (!hasValidAuditShape(data)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return { audit: data.audit };
    });
  }

  window.NX_MASTER_AUDIT_PROVIDER = {
    loadAuditData: loadAuditData
  };
})();
