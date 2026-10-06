/* PORTAL-NEXT V2 -- Painel Master / Configurações REAL data provider
   (Painel Master Phase PM-5E).

   THIN transport boundary, same principle and shape as every sibling
   Painel Master provider -- own independent callRpc(), no shared
   coupling to any other admin concern's fetch lifecycle.

   Real contract (PM-5E forensics): exactly 2 real, already-deployed
   RPCs -- `operational_portal_config()` (read, general-authenticated,
   NOT MASTER-only -- every profile's own dashboard reads the same
   commission-tier constants) and `master_update_portal_config(p_key,
   p_value, p_description)` (write, confirmed MASTER-only both via a
   real `usuarios`/`perfil='MASTER'` check inside the function body AND
   via RLS on the underlying `public.configuracoes` table -- read live
   via pg_get_functiondef, not assumed). The write RPC independently
   re-validates the exact 13-key allowlist server-side (this file's own
   CONFIG_KEYS list is for display/UX only, never the authority) plus a
   numeric range (0-1e9) and, for any key whose name contains "share"/
   "percentual"/"faixa", an additional 0-100 cap -- and writes a real,
   human-readable before/after row into `public.auditoria` on every
   successful save.

   HOMOLOGATION MODE (PM-WRITE-SAFETY-2, was: PM-5E Gate 39's "NO
   HOMOLOGATION-MODE GATE EXISTS FOR THIS CAPABILITY" finding): that
   finding was real and confirmed live -- unlike Gestão de Bases/
   Simuladores, this capability never had a hostname allowlist, a
   dry-run concept, or a write-simulation of any kind, so a save on ANY
   host, including localhost, was a REAL write. Closed the same way
   GS/GB's own write-safety gate already works: reads the single
   existing environment authority environment-guard.js publishes
   (window.NX_ENVIRONMENT.name) -- never a second, independent hostname
   list -- and simulates the one real write RPC
   (master_update_portal_config) UNLESS that name is exactly
   'AUTHORIZED_PRODUCTION'. There is no dry-run concept for this RPC
   (confirmed live, unchanged) -- every call to the write RPC name
   outside production is simulated, no p_dry_run distinction to make.
   The read RPC (operational_portal_config) is a different name and is
   therefore never touched by this gate, in every environment. Evaluated
   fresh on every call (never cached at module-load time) for the same
   DOMContentLoaded-timing reason already documented in
   master-gestao-simuladores-provider.js. RPC names, payload shape, and
   the server RPC itself are all unchanged by this wave. */
(function () {
  'use strict';

  // PM-WRITE-SAFETY-2 -- single source of truth, same pattern as
  // GS/GB's own gsIsProductionEnvironment()/gbIsProductionEnvironment().
  function cfgIsProductionEnvironment() {
    return !!(window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name === 'AUTHORIZED_PRODUCTION');
  }
  var CFG_WRITE_RPC_NAMES = { master_update_portal_config: true };
  function cfgIsBlockedWrite(name) {
    return !!CFG_WRITE_RPC_NAMES[name];
  }
  // Minimum same-contract response: the one real call site
  // (cfgConfirmSaveHandler in shell-admin.js) reads nothing from the
  // resolved value at all -- it already has `setting`/`newValue`
  // client-side before the call -- so no field is fabricated here
  // beyond the required `simulated` marker.
  function cfgSimulateWrite(name, params) {
    if (typeof console !== 'undefined' && console.warn) {
      if (window.NX_DEV) window.NX_DEV.warn('[Configurações] MODO HOMOLOGAÇÃO — escrita bloqueada: ' + name, Object.keys(params || {})); // RPC/param names: localhost with ?debug=1 only
    }
    return { ok: true, simulated: true };
  }

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  function callRpc(fnName, params, signal) {
    if (!cfgIsProductionEnvironment() && cfgIsBlockedWrite(fnName)) {
      return Promise.resolve(cfgSimulateWrite(fnName, params));
    }
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
            return Promise.reject({ state: classifyError(code, resp.status), codigo: code, message: (body && body.message) || 'Erro ao processar solicitação.' });
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

  function readConfig(params) {
    params = params || {};
    return callRpc('operational_portal_config', {}, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  function updateConfig(key, value, description, params) {
    params = params || {};
    return callRpc('master_update_portal_config', {
      p_key: key, p_value: value, p_description: description || ''
    }, params.signal);
  }

  window.NX_MASTER_CONFIG_PROVIDER = {
    readConfig: readConfig,
    updateConfig: updateConfig,
    isHomologationMode: function () { return !cfgIsProductionEnvironment(); }
  };
})();
