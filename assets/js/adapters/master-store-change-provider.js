/* PORTAL-NEXT V2 -- Painel Master / Mudança de Loja - Vendedores REAL
   data provider (Painel Master Phase PM-5F).

   THIN transport boundary, same shape as every sibling Painel Master
   provider (see master-periodos-provider.js / master-absences-
   provider.js, the direct structural templates). Real contract,
   confirmed live by direct pg_get_functiondef inspection of the real
   backend in production project yacqlelpzchcotgngwbh: MASTER reads
   via `master_admin_reference_data()` (`.store_changes`); writes go
   through `master_admin_manage(p_entity='STORE_CHANGE', p_action,
   p_payload)` -- the SAME dispatcher already used by PERIOD/ABSENCE,
   confirmed byte-identical across both live-fetch attempts this
   phase. MASTER-only, backed by RLS on
   `public.mudancas_loja_vendedores` (INSERT/UPDATE both require
   is_master(); SELECT open to any authenticated profile -- several
   real commission/salary RPCs for other profiles read this table via
   resolve_store_temporal()).

   Payload keys below are the EXACT keys the live RPC body reads
   (pg_get_functiondef-confirmed, PM-5F Gate 34/35): seller_cpf,
   seller_login, seller_name, origin_store, destination_store,
   origin_start, origin_end, destination_start, notes,
   origin_department, destination_department. `notes` IS persisted
   here (unlike ABSENCE's dropped `observacao`).

   STRICT FORWARD-ONLY CHAIN MODEL (real, server-enforced, confirmed
   live -- not inferred from V1 UI copy): destination_start must be
   EXACTLY the day after origin_end (no gap, no overlap); the seller's
   most recent existing record (by data_inicio_destino desc, matched
   by CPF then exact name) constrains the new record's origin_store
   (must equal that record's loja_destino exactly), origin_start (not
   before that record's destination start), destination_start (must be
   strictly after it), and origin_department (must match that record's
   destination department if one is set). Old records are NEVER
   deactivated by a new one. `checkChainGuidance` below mirrors this
   purely for UX pre-check guidance (never authoritative -- the RPC
   re-validates regardless and is the only real gate). The real
   conflict error code for a chain violation is Postgres '23P01',
   mapped to the CONFLICT UI state below (distinct from '22023'
   generic validation and '42501' auth-denied).

   departamento_origem/departamento_destino are validated server-side
   against a HARD enum -- only 'NOVOS' or 'SEMINOVOS' (or empty/null)
   are accepted; anything else raises 22023. This is not a free-text
   field despite the underlying column being plain `text`.

   HOMOLOGATION MODE (PM-WRITE-SAFETY-2, was: "NO HOMOLOGATION-MODE GATE
   EXISTS FOR THIS CAPABILITY", independently confirmed live for
   STORE_CHANGE specifically): closed the same way GS/GB's own
   write-safety gate already works -- reads the single existing
   environment authority environment-guard.js publishes
   (window.NX_ENVIRONMENT.name) -- never a second, independent hostname
   list -- and simulates every call to the write RPC
   (master_admin_manage, shared by CREATE/SET_DEPARTMENTS/SET_ACTIVE/
   ARCHIVE) UNLESS that name is exactly 'AUTHORIZED_PRODUCTION'. No
   p_dry_run concept exists for this RPC -- the gate gates on RPC name
   alone. The read RPC (master_admin_reference_data) is a different
   name and is therefore never touched, in every environment. The real
   forward-only chain validation (Postgres '23P01') is entirely
   server-side and untouched by this gate -- a simulated write never
   reaches that check, exactly as it never reaches any other part of
   the real RPC body. Evaluated fresh on every call (never cached at
   module-load time), same DOMContentLoaded-timing reason already
   documented in master-gestao-simuladores-provider.js. RPC names,
   payload shape, and the server RPC itself are all unchanged by this
   wave. */
(function () {
  'use strict';

  // PM-WRITE-SAFETY-2 -- single source of truth, same pattern as
  // GS/GB's own gsIsProductionEnvironment()/gbIsProductionEnvironment().
  function scIsProductionEnvironment() {
    return !!(window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name === 'AUTHORIZED_PRODUCTION');
  }
  var SC_WRITE_RPC_NAMES = { master_admin_manage: true };
  function scIsBlockedWrite(name) {
    return !!SC_WRITE_RPC_NAMES[name];
  }
  // Minimum same-contract response: every real call site
  // (shell-admin.js's own scRunAction/direct .then handlers) reads
  // only a success/failure outcome from the resolved promise -- a
  // zero-arg success callback, confirmed by direct read -- so nothing
  // beyond the required `simulated` marker is fabricated. Every success
  // path closes back through scCloseModalAndRefresh, which forces a
  // real re-read (master_admin_reference_data) before showing the list
  // again -- the displayed data always comes from the server, never
  // from this simulated value (Section 12/client-state-safety).
  function scSimulateWrite(name, params) {
    if (typeof console !== 'undefined' && console.warn) {
      if (window.NX_DEV) window.NX_DEV.warn('[Mudança de Loja] MODO HOMOLOGAÇÃO — escrita bloqueada: ' + name, Object.keys(params || {})); // RPC/param names: localhost with ?debug=1 only
    }
    return { ok: true, simulated: true };
  }

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (code === '23P01') return 'CONFLICT'; // real chain-validation conflict
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  function callRpc(fnName, params, signal) {
    if (!scIsProductionEnvironment() && scIsBlockedWrite(fnName)) {
      return Promise.resolve(scSimulateWrite(fnName, params));
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

  function listStoreChanges(params) {
    params = params || {};
    return callRpc('master_admin_reference_data', {}, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.store_changes)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.store_changes;
    });
  }

  function manage(action, payload, params) {
    params = params || {};
    return callRpc('master_admin_manage', { p_entity: 'STORE_CHANGE', p_action: action, p_payload: payload || {} }, params.signal);
  }

  function createStoreChange(fields, params) {
    return manage('CREATE', {
      seller_cpf: fields.cpfVendedor,
      seller_login: fields.loginVendedor,
      seller_name: fields.nomeVendedor,
      origin_store: fields.lojaOrigem,
      destination_store: fields.lojaDestino,
      origin_start: fields.dataInicioOrigem,
      origin_end: fields.dataFimOrigem,
      destination_start: fields.dataInicioDestino,
      notes: fields.observacao,
      origin_department: fields.departamentoOrigem,
      destination_department: fields.departamentoDestino
    }, params);
  }
  function setDepartments(id, originDepartment, destinationDepartment, params) {
    return manage('SET_DEPARTMENTS', { id: id, origin_department: originDepartment, destination_department: destinationDepartment }, params);
  }
  function setActive(id, active, params) {
    return manage('SET_ACTIVE', { id: id, active: !!active }, params);
  }
  function archiveStoreChange(id, params) {
    return manage('ARCHIVE', { id: id }, params);
  }

  window.NX_MASTER_STORE_CHANGE_PROVIDER = {
    listStoreChanges: listStoreChanges,
    createStoreChange: createStoreChange,
    setDepartments: setDepartments,
    setActive: setActive,
    archiveStoreChange: archiveStoreChange,
    isHomologationMode: function () { return !scIsProductionEnvironment(); }
  };
})();
