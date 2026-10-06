/* PORTAL-NEXT V2 -- Painel Master / Períodos de Comissão REAL data
   provider (Painel Master Phase PM-5E).

   THIN transport boundary, same shape as every sibling Painel Master
   provider. Real contract: MASTER reads via `master_admin_reference_
   data()` (returns ALL periods, active and archived, plus absences/
   store-changes this file never touches -- only `.periods` is used
   here); all 4 writes this capability exposes (CREATE/SET_CURRENT/
   SET_ACTIVE/ARCHIVE) go through the single generic dispatcher
   `master_admin_manage(p_entity='PERIOD', p_action, p_payload)`,
   confirmed MASTER-only via a real `usuarios`/`perfil='MASTER'` check
   read live from the function body (pg_get_functiondef), backed by
   RLS on `public.periodos_comissao` (INSERT/UPDATE both require
   is_master(); SELECT is intentionally open to any authenticated
   profile, since every dashboard reads the period list for its own
   date-range picker -- confirmed a deliberate, not accidental, policy
   shape, distinct from Gestão de Bases/Simuladores' full lockdown).

   `SET_STATUS` is a real, live action `master_admin_manage` accepts
   for this entity, but PM-5E's own audit confirmed ZERO reachable V1
   UI call site for it -- V1 never lets a Human set status directly;
   the only path to FECHADO/back to EM CONFERÊNCIA is the (out of
   scope, separate future capability) Fechamento de Competência flow.
   This provider deliberately does NOT expose a setStatus() function,
   preserving V1's own real exposed capability boundary exactly rather
   than the RPC's full theoretical one.

   HOMOLOGATION MODE (PM-WRITE-SAFETY-2, was: "NO HOMOLOGATION-MODE GATE
   EXISTS FOR THIS CAPABILITY EITHER", same PM-5E Gate 39 finding as
   master-config-provider.js): closed the same way GS/GB's own
   write-safety gate already works -- reads the single existing
   environment authority environment-guard.js publishes
   (window.NX_ENVIRONMENT.name) -- never a second, independent hostname
   list -- and simulates every call to the write RPC
   (master_admin_manage, shared by CREATE/SET_CURRENT/SET_ACTIVE/
   ARCHIVE) UNLESS that name is exactly 'AUTHORIZED_PRODUCTION'. No
   p_dry_run concept exists for this RPC (confirmed live, unchanged) --
   the gate gates on RPC name alone, exactly like master-config-
   provider.js. The read RPC (master_admin_reference_data) is a
   different name and is therefore never touched by this gate, in
   every environment. Evaluated fresh on every call (never cached at
   module-load time), same DOMContentLoaded-timing reason already
   documented in master-gestao-simuladores-provider.js. RPC names,
   payload shape, and the server RPC itself are all unchanged by this
   wave. */
(function () {
  'use strict';

  // PM-WRITE-SAFETY-2 -- single source of truth, same pattern as
  // GS/GB's own gsIsProductionEnvironment()/gbIsProductionEnvironment().
  function prIsProductionEnvironment() {
    return !!(window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name === 'AUTHORIZED_PRODUCTION');
  }
  var PR_WRITE_RPC_NAMES = { master_admin_manage: true };
  function prIsBlockedWrite(name) {
    return !!PR_WRITE_RPC_NAMES[name];
  }
  // Minimum same-contract response: every real call site
  // (shell-admin.js's own prRunAction/direct .then handlers) reads only
  // a success/failure outcome from the resolved promise -- a zero-arg
  // success callback, confirmed by direct read, never a specific
  // field -- so nothing beyond the required `simulated` marker is
  // fabricated; no synthetic id is invented since none is ever
  // consumed. Every success path closes back through
  // prCloseModalAndRefresh, which forces a real re-read
  // (master_admin_reference_data) before showing the list again -- the
  // displayed data always comes from the server, never from this
  // simulated value (Section 12/client-state-safety).
  function prSimulateWrite(name, params) {
    if (typeof console !== 'undefined' && console.warn) {
      if (window.NX_DEV) window.NX_DEV.warn('[Períodos de Comissão] MODO HOMOLOGAÇÃO — escrita bloqueada: ' + name, Object.keys(params || {})); // RPC/param names: localhost with ?debug=1 only
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
    if (!prIsProductionEnvironment() && prIsBlockedWrite(fnName)) {
      return Promise.resolve(prSimulateWrite(fnName, params));
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

  function listPeriods(params) {
    params = params || {};
    return callRpc('master_admin_reference_data', {}, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.periods)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.periods;
    });
  }

  function manage(action, payload, params) {
    params = params || {};
    return callRpc('master_admin_manage', { p_entity: 'PERIOD', p_action: action, p_payload: payload || {} }, params.signal);
  }

  function createPeriod(name, startDate, endDate, isCurrent, params) {
    return manage('CREATE', { name: name, start_date: startDate, end_date: endDate, is_current: !!isCurrent }, params);
  }
  function setCurrent(id, params) {
    return manage('SET_CURRENT', { id: id }, params);
  }
  function setActive(id, active, params) {
    return manage('SET_ACTIVE', { id: id, active: !!active }, params);
  }
  function archivePeriod(id, params) {
    return manage('ARCHIVE', { id: id }, params);
  }

  window.NX_MASTER_PERIODOS_PROVIDER = {
    listPeriods: listPeriods,
    createPeriod: createPeriod,
    setCurrent: setCurrent,
    setActive: setActive,
    archivePeriod: archivePeriod,
    isHomologationMode: function () { return !prIsProductionEnvironment(); }
  };
})();
