/* PORTAL-NEXT V2 -- Shared simulator live rate-authority provider
   (SIMLIVE1: migrate simulator live rate authorities).

   THIN transport boundary, the SAME principle and SAME request pattern
   as coparticipado-governed-rates-provider.js (the Human-approved
   precedent this file replicates, never modifies or weakens): each
   exported function only calls a real, already-granted
   simulador_get_* RPC (Simulador Novos/Seminovos' own live rate/
   coefficient authorities -- the same family simulador_get_coparticipado
   belongs to) and returns its validated payload, or a classified error
   -- no calculation, no DOM, no model-specific reshaping (that lives in
   each page's own transform, same split coparticipado-real-view-model.js
   has relative to its provider).

   WHY A NEW FILE INSTEAD OF EXTENDING coparticipado-governed-rates-
   provider.js: that file is Human-approved, already tested, and
   explicitly in scope as "do not touch" (see docs/
   CHANGE-PROPOSAL-V2-COPART-GOVERNED-RATE-AUTHORITY.md) -- this file
   independently follows the exact same fetch/auth/error-classification
   shape rather than risk any change to Coparticipado's own already-
   verified behavior.

   CACHING: deliberately NONE in this file -- same choice
   coparticipado-governed-rates-provider.js itself made. Caching (short-
   lived, in-memory, one fetch per rate-authority per page session) is a
   PAGE-level concern, done the same way simulador-novos.js's own
   ensureCampAuthority()/campState/campAuthority already do it for
   Coparticipado. See simulador-novos.js/simulador-seminovos.js's
   makeAuthority() helper, which wraps loadRateAuthority() below with
   that same IDLE/LOADING/READY/ERROR state machine, one instance per
   RPC. No localStorage/sessionStorage/IndexedDB anywhere in this file.

   FAIL CLOSED (Gate: SIMLIVE1 Phase 4): any network error, non-2xx
   response, malformed/empty payload, or missing/expired session is
   returned as a REJECTED promise carrying a classified {state,
   message} -- callers must never treat a rejection as "use the old
   static table instead", only as "show an explicit error+retry, do
   not allow Calcular".

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH) and the
   EXISTING shared Supabase config (window.NX_INTELLIGENCE_CONFIG) --
   no independent Supabase client, no new backend, no service_role, no
   secret beyond the same public/anon-key-class publishable key already
   used by coparticipado-governed-rates-provider.js and
   fi-atendimento-real-provider.js. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  // Generic envelope guard, mirroring V1's own SB_LOADER.carregar()
  // split of responsibility (simulador-base-loader.js, portal-
  // financiamento-brabus-secure): {ok:true, linhas:<non-empty array>}
  // is checked HERE (RPC-agnostic); the per-RPC row/field shape is
  // checked by the caller-supplied `validator` (mirrors V1's own
  // linhasValidas(), called by each carregarBaseX() AFTER this generic
  // check passes).
  function hasValidEnvelope(data) {
    return !!data && typeof data === 'object' && data.ok === true &&
      Array.isArray(data.linhas) && data.linhas.length > 0;
  }

  function loadRateAuthority(rpcName, validator, params) {
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

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + rpcName, {
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
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || ('Erro ao carregar base de taxas (' + rpcName + ').') });
          }
          if (!hasValidEnvelope(body)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Base de taxas retornou formato inesperado.' });
          }
          if (typeof validator === 'function' && !validator(body.linhas)) {
            return Promise.reject({ state: 'BACKEND_ERROR', message: 'Base de taxas retornou campos ausentes ou inválidos.' });
          }
          return body;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // linhasValidas: same semantics as V1's SB_LOADER.linhasValidas --
  // every row must be a real object, every listed NUMERIC field must
  // be typeof 'number' and isFinite (no NaN/undefined ever reaches a
  // calculation), and every listed TEXT field (e.g. "bloco"/"modelo"/
  // "faixa_ano") must be a non-empty string. An empty/non-array
  // `linhas` is invalid (mirrors hasValidEnvelope's own non-empty
  // check, kept here too so this function is safe to call standalone).
  function linhasValidas(linhas, camposNumericos, camposTexto) {
    if (!Array.isArray(linhas) || !linhas.length) return false;
    camposNumericos = camposNumericos || [];
    camposTexto = camposTexto || [];
    return linhas.every(function (r) {
      if (!r || typeof r !== 'object') return false;
      for (var i = 0; i < camposNumericos.length; i++) {
        var nv = r[camposNumericos[i]];
        if (typeof nv !== 'number' || !isFinite(nv)) return false;
      }
      for (var j = 0; j < camposTexto.length; j++) {
        var tv = r[camposTexto[j]];
        if (typeof tv !== 'string' || !tv) return false;
      }
      return true;
    });
  }

  window.NX_SIMULADOR_RATES_PROVIDER = {
    loadRateAuthority: loadRateAuthority,
    linhasValidas: linhasValidas
  };
})();
