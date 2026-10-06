/* PORTAL-NEXT V2 -- Painel Master / Utilização dos Simuladores REAL
   data provider (Painel Master Phase PM-5H).

   THIN transport boundary, same shape as every sibling Painel Master
   provider. Real contract, confirmed live (not assumed) by direct
   pg_get_functiondef inspection of the real backend in production
   project yacqlelpzchcotgngwbh: a SINGLE read-only RPC,
   `master_simulator_usage_data(p_start_date, p_end_date)` -- MASTER-
   only (inline `perfil='MASTER'` check, real 42501 on denial), STABLE,
   SECURITY DEFINER. It reads `public.portal_module_sessions`
   (RLS ENABLED with ZERO policies -- the strongest posture in this
   whole codebase: no authenticated role, not even MASTER, can read or
   write this table directly; every access is exclusively through
   SECURITY DEFINER RPCs) and pre-aggregates server-side by
   (usuario_id, module_id) for the requested period -- it NEVER returns
   raw per-session rows to the client, so there is no large-payload/
   pagination risk by construction (PM-5H Gate 17/19).

   THIS PROVIDER IS READ-ONLY. There is no write action anywhere in
   this capability's real contract -- the only writers
   (`portal_telemetry_start_session/_heartbeat/_simulation/_end_session`,
   confirmed live, 100% git-absent) are called exclusively by the
   simulator surfaces themselves (external GitHub Pages deployments,
   not present in this repo), never by any Painel Master admin action.
   This provider does not expose them and never will -- porting them
   here would misrepresent this screen as something other than a
   report.

   Telemetry can be globally disabled via the real `configuracoes` key
   `telemetria_simuladores_ativa` (also read live by this same RPC,
   returned as `telemetry_enabled`/`telemetry_started_at`) -- when
   disabled, all 4 writer RPCs no-op (confirmed live) and this reader
   simply returns real zeros for the period, which is NOT the same as
   "no usage happened" and must be surfaced as such (Fase 18.5 finding,
   preserved verbatim from the real V1 contract). */
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

  // startIso/endIso: full ISO-8601 datetime strings with an explicit
  // offset (the caller -- the view-model -- is responsible for
  // resolving the America/Sao_Paulo calendar-day boundary into an
  // explicit "-03:00" instant BEFORE calling this provider; this
  // transport layer never invents a timezone).
  function loadUsageData(startIso, endIso, params) {
    params = params || {};
    return callRpc('master_simulator_usage_data', { p_start_date: startIso, p_end_date: endIso }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.linhas)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  window.NX_MASTER_SIMULATOR_USAGE_PROVIDER = {
    loadUsageData: loadUsageData
  };
})();
