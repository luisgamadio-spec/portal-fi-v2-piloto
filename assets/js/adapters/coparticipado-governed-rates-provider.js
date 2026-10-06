/* PORTAL-NEXT V2 -- Coparticipado GOVERNED rate authority provider
   (V2_COPART_GOVERNED_RATE_AUTHORITY_CORRECTION).

   THIN transport boundary, same principle and same request pattern as
   every other real provider in this codebase (coparticipado-real-
   provider.js, dashbi-real-provider.js, gestao-real-provider.js): this
   file's only job is calling the real, already-proven
   simulador_get_coparticipado RPC (the SAME governed, versioned batch
   authority Simulador de Novos production consumes in the reference
   Secure repository) and returning its raw payload (or a classified
   error) -- no model normalization, no rate lookup, no calculation.
   That reshape lives in coparticipado-real-view-model.js, never here.

   WHY THIS FILE EXISTS: operational_score_coparticipated_data (the RPC
   coparticipado-real-provider.js calls) returns sales/finance/rates in
   one envelope, but its "rates" field is backed by a table
   (coparticipado_modelos_fi) proven stale against the governed,
   actively-maintained rate authority (see docs/
   CHANGE-PROPOSAL-V2-COPART-GOVERNED-RATE-AUTHORITY.md and the Secure
   repository's own Fase 3 investigation, kept read-only, used here only
   as behavioral/contract reference). This provider supplies the
   CORRECT rate source; operational_score_coparticipated_data remains
   the correct and unchanged source for sales/finance/plan/seller/
   store -- only its "rates" field stops being used for financial
   calculation (coparticipado-real-view-model.js).

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH) and the
   EXISTING shared Supabase config (window.NX_INTELLIGENCE_CONFIG) --
   no independent Supabase client, no new backend, no service_role. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  function hasValidShape(data) {
    return !!data && typeof data === 'object' && data.ok === true &&
      !!data.linhas && Array.isArray(data.linhas.matriz_modelos) && data.linhas.matriz_modelos.length > 0;
  }

  function loadGovernedCoparticipadoRates(params) {
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

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/simulador_get_coparticipado', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({}),
        signal: params.signal
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao carregar base governada de taxas.' });
          }
          if (!hasValidShape(body)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Base governada de taxas retornou formato inesperado.' });
          }
          return body;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  window.NX_COPARTICIPADO_GOVERNED_RATES_PROVIDER = {
    loadGovernedCoparticipadoRates: loadGovernedCoparticipadoRates
  };
})();
