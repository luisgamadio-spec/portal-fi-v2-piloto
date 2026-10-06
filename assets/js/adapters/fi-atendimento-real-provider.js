/* PORTAL-NEXT V2 -- "Falar com um Analista" real data provider
   (SIM-REG-01 restoration).

   THIN transport boundary, same principle and same request pattern as
   central-atendimento-fi-real-provider.js / painel-analista-fi-real-
   provider.js: this file's only job is calling the real, already-
   proven, LIVE (production, portal-financiamento-brabus-secure)
   chamar_analista_fi RPC and returning its raw payload (or a
   classified error) -- no status validation, no display formatting,
   no business logic.

   Historical authority (git/filesystem forensic, SIM-REG-01):
   assets/js/fi-atendimento.js is still live in
   portal-financiamento-brabus-secure (confirmed byte-identical to the
   archived PORTAL-FI-DESIGN-LAB/PORTAL-NEXT-08/.source/
   fi-atendimento-origin-main.js snapshot -- diff empty). It calls
   window.parent.portalCallAnalystFi() -- a bridge the ORIGINAL
   iframe-embedded simulators needed because they ran inside an
   <iframe> with their own document, with no direct access to the
   shell's own Supabase client. portalCallAnalystFi() itself
   (portal-app.js in the same live repo) is a thin wrapper: confirm an
   authenticated session exists, then call
   supabaseClient.rpc('chamar_analista_fi') and return the array.

   V2's simulators are NOT iframes -- simulador-novos.js/simulador-
   seminovos.js render natively into the SAME document as the rest of
   the Portal shell (window.NX_ROUTER), so the iframe/window.parent
   bridge no longer applies architecturally. This file reuses V2's own
   already-established, already-approved RPC-calling primitive
   (window.NX_AUTH.getAccessToken() + window.NX_INTELLIGENCE_CONFIG,
   the EXACT pattern central-atendimento-fi-real-provider.js already
   uses) to call the SAME real RPC name directly, same-window -- 0
   change to the action/destination/semantics, only the transport
   mechanism modernized to match V2's actual architecture. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  function callRpc(rpcName, body) {
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
          return respBody;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // chamar_analista_fi() -- SAME real RPC the live production app
  // (portal-financiamento-brabus-secure/assets/js/portal-app.js,
  // portalCallAnalystFi()) has already been calling successfully.
  // Returns an array of available-analyst rows (server-side "ONLINE
  // only" + queue-order filtering, per the real Painel do Analista's
  // own copy: "Somente status ONLINE recebe novos chamados do botão
  // FALAR COM UM ANALISTA") -- never re-filtered/re-sorted here.
  function chamarAnalista() {
    return callRpc('chamar_analista_fi', {}).then(function (body) {
      return Array.isArray(body) ? body : [];
    });
  }

  window.NX_FI_ATENDIMENTO_PROVIDER = {
    chamarAnalista: chamarAnalista
  };
})();
