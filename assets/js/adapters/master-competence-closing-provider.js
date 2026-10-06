/* PORTAL-NEXT V2 -- Painel Master / Fechamento de Competência TRANSPORT
   layer (Painel Master Phase PM-5J, extended by PM-5K-RETRY for
   reabertura).

   THIN transport boundary, same shape as every sibling Painel Master
   provider. Separated into READ (loadCommissionMetrics/
   loadAnalystCommissionMetrics/loadManagerDirectory/loadGestorIdentity)
   and WRITE (closeCommissionPeriod / reopenCommissionPeriod -- the ONLY
   two real writes this file exposes, plus their *Simulated pure
   client-side fakes for safe local homologation, Gate 31/35-36) per
   PM-5J Gate 23 / PM-5K-RETRY Gate 32.

   Real contract (reconciled PM-5G/PM-5H/PM-5I/PM-5J/PM-5K-RETRY, from
   real git sources + live pg_get_functiondef -- see docs/COMMISSION-
   ENGINE-AUTHORITY.md):
     - operational_commission_metrics(p_start,p_end) -- sellers + group totals
     - operational_analyst_commission_metrics_v2(p_start,p_end) -- analysts, already absence-redistributed server-side
     - operational_salary_manager_directory(p_start,p_end) -- manager identity directory
     - master_admin_security_data() -- MASTER user directory (Gestor F&I identity anchor)
     - master_close_commission_period(p_period_id,p_summary,p_rows) -- creates a new closing
     - master_reopen_commission_period(p_closing_id) -- reopens an existing FECHADO closing (PM-5K-RETRY, body confirmed live via Management API pg_get_functiondef on the real project: sets fechamentos_comissao.status='REABERTO', .ativo=false, .reaberto_por/.reaberto_em, NEVER touches snapshot_comissoes, sets periodos_comissao.status='EM CONFERÊNCIA')

   This file NEVER calls (structurally, not just by convention --
   enforced by tests/master-competence-closing-provider-test.py's and
   tests/master-competence-reopen-provider-test.py's own read/write-
   allowlist proof over this file's source text): master_admin_manage,
   or any direct table write (insert/update/upsert/delete).

   Gestor F&I identity anchor: the real, authoritative usuario_id V1
   itself hardcodes (portal-financiamento-brabus-secure/assets/js/
   portal-app.js:6291, `GESTOR_FI_USUARIO_ID_SEGURO`) -- reproduced here
   verbatim so V2 resolves the SAME real person V1 does, never a
   fallback/first-MASTER/generic label (PM-5J Gate 7/20). The person's
   real name is deliberately not repeated in this comment (only the
   opaque id, which this gate structurally requires) -- see docs/
   COMMISSION-ENGINE-AUTHORITY.md for the full privacy discussion. */
(function () {
  'use strict';

  var GESTOR_FI_USUARIO_ID_SEGURO = 'b5168cef-d111-4c5f-873e-ea823bb22729';

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

  // ---------- READ ----------

  function loadCommissionMetrics(start, end, params) {
    params = params || {};
    return callRpc('operational_commission_metrics', { p_start: start, p_end: end }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows) || !data.totals) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  function loadAnalystCommissionMetrics(start, end, params) {
    params = params || {};
    return callRpc('operational_analyst_commission_metrics_v2', { p_start: start, p_end: end }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  function loadManagerDirectory(start, end, params) {
    params = params || {};
    return callRpc('operational_salary_manager_directory', { p_start: start, p_end: end }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  // Real, fail-closed identity resolution (portal-app.js:6292-6297,
  // gestorFIIdentidadeSegura, verbatim): find the ONE hardcoded real
  // usuario_id, require it to exist AND be ativo. Returns null on any
  // other outcome -- callers must treat null as "block the whole
  // preview", never substitute a generic label (PM-5J Gate 20).
  function loadGestorIdentity(params) {
    params = params || {};
    return callRpc('master_admin_security_data', {}, params.signal).then(function (data) {
      var users = (data && Array.isArray(data.users)) ? data.users : null;
      if (!users) return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      var gestor = users.filter(function (u) { return u.id === GESTOR_FI_USUARIO_ID_SEGURO; })[0];
      if (!gestor || gestor.ativo === false) return null;
      return gestor;
    });
  }

  // ---------- WRITE ----------

  // The ONLY real write this capability may ever perform.
  function closeCommissionPeriod(periodId, summary, rows, params) {
    params = params || {};
    return callRpc('master_close_commission_period', { p_period_id: periodId, p_summary: summary, p_rows: rows }, params.signal);
  }

  // Pure client-side fake -- NEVER touches the network, NEVER reaches
  // Supabase. Used by the default "Modo simulação" homologation path
  // (PM-5J Gate 35/36) so a Human (or an automated test) can validate
  // the entire preview -> confirm -> success UI flow without ever
  // creating a real snapshot or flipping a real período's status. The
  // resolved value mirrors master_close_commission_period's own real
  // success shape (`{status:'OK', closing_id, period_id, version,
  // snapshot_rows}`, per the real RPC body read in PM-5G) closely enough
  // for the UI to render an equivalent success state, clearly labeled
  // as simulated.
  function closeCommissionPeriodSimulated(periodId, summary, rows) {
    return Promise.resolve({
      status: 'OK', simulated: true,
      closing_id: 'SIMULATED-' + Date.now(),
      period_id: periodId, version: null,
      snapshot_rows: Array.isArray(rows) ? rows.length : 0
    });
  }

  // The ONLY other real write this capability may ever perform.
  // Signature/body confirmed live (PM-5K-RETRY, LIVE_PG_GET_FUNCTIONDEF
  // via Management API on the real project yacqlelpzchcotgngwbh) --
  // single param p_closing_id (the fechamentos_comissao row id, NOT a
  // período id).
  function reopenCommissionPeriod(closingId, params) {
    params = params || {};
    return callRpc('master_reopen_commission_period', { p_closing_id: closingId }, params.signal);
  }

  // Pure client-side fake -- NEVER touches the network. Mirrors the
  // real RPC's confirmed success shape (`{status:'OK', closing_id,
  // period_id}`, no `version`/`snapshot_rows` fields -- the real body
  // never returns them, unlike closeCommissionPeriod's response).
  function reopenCommissionPeriodSimulated(closingId, periodId) {
    return Promise.resolve({
      status: 'OK', simulated: true,
      closing_id: closingId, period_id: periodId || null
    });
  }

  window.NX_MASTER_COMPETENCE_CLOSING_PROVIDER = {
    GESTOR_FI_USUARIO_ID_SEGURO: GESTOR_FI_USUARIO_ID_SEGURO,
    loadCommissionMetrics: loadCommissionMetrics,
    loadAnalystCommissionMetrics: loadAnalystCommissionMetrics,
    loadManagerDirectory: loadManagerDirectory,
    loadGestorIdentity: loadGestorIdentity,
    closeCommissionPeriod: closeCommissionPeriod,
    closeCommissionPeriodSimulated: closeCommissionPeriodSimulated,
    reopenCommissionPeriod: reopenCommissionPeriod,
    reopenCommissionPeriodSimulated: reopenCommissionPeriodSimulated
  };
})();
