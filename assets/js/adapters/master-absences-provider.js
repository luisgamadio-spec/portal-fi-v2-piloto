/* PORTAL-NEXT V2 -- Painel Master / Férias/Ausências REAL data provider
   (Painel Master Phase PM-5F).

   THIN transport boundary, same shape as every sibling Painel Master
   provider (see master-periodos-provider.js, the direct structural
   template for this file). Real contract, confirmed live (not
   assumed) by direct pg_get_functiondef inspection of the real
   backend in production project yacqlelpzchcotgngwbh: MASTER reads
   via `master_admin_reference_data()` (returns ALL absences, active
   and archived, plus periods/store-changes this file never touches --
   only `.absences` is used here); all writes this capability exposes
   (CREATE/SET_ACTIVE/ARCHIVE) go through the single generic dispatcher
   `master_admin_manage(p_entity='ABSENCE', p_action, p_payload)`, the
   SAME dispatcher function already used by PERIOD (PM-5E) and
   STORE_CHANGE (this phase) -- confirmed byte-identical body across
   both live-fetch attempts this phase, MASTER-only via a real
   `usuarios`/`perfil='MASTER'` check read live from the function
   body, backed by RLS on `public.ausencias_analistas` (INSERT/UPDATE
   both require is_master(); SELECT is intentionally open to any
   authenticated profile, since real commission-metrics RPCs for other
   profiles read this table -- confirmed a deliberate policy shape,
   identical to PERIOD/CONFIG's own SELECT-open/WRITE-MASTER pattern).

   There is NO EDIT action for this entity -- V1 has no reachable edit
   UI for an existing absence record, only CREATE + SET_ACTIVE (toggle)
   + ARCHIVE (soft, no hard delete: no DELETE RLS policy exists, no
   delete RPC action exists). This provider deliberately does not
   expose an editAbsence() function, preserving V1's own real exposed
   capability boundary exactly.

   REAL FINANCIAL EFFECT (Gate 20/21, not decorative): a separate,
   out-of-scope, FROZEN RPC (`operational_analyst_commission_metrics`)
   reassigns real commission dollars from the absent analyst to the
   named substitute for any commission period overlapping this
   absence's date window -- this is why cpf_analista_substituto/
   nome_analista_substituto are NOT NULL server-side. This provider
   never calls that RPC and never will; the financial-effect warning
   surfaced by the view-model/UI is informational only.

   HOMOLOGATION MODE (PM-WRITE-SAFETY-2, was: "NO HOMOLOGATION-MODE GATE
   EXISTS FOR THIS CAPABILITY", same PM-5E Gate 39 finding, independently
   re-confirmed live for ABSENCE specifically): closed the same way
   GS/GB's own write-safety gate already works -- reads the single
   existing environment authority environment-guard.js publishes
   (window.NX_ENVIRONMENT.name) -- never a second, independent hostname
   list -- and simulates every call to the write RPC
   (master_admin_manage, shared by CREATE/SET_ACTIVE/ARCHIVE) UNLESS
   that name is exactly 'AUTHORIZED_PRODUCTION'. No p_dry_run concept
   exists for this RPC -- the gate gates on RPC name alone. The read RPC
   (master_admin_reference_data) is a different name and is therefore
   never touched, in every environment. Evaluated fresh on every call
   (never cached at module-load time), same DOMContentLoaded-timing
   reason already documented in
   master-gestao-simuladores-provider.js. RPC names, payload shape, and
   the server RPC itself are all unchanged by this wave. */
(function () {
  'use strict';

  // PM-WRITE-SAFETY-2 -- single source of truth, same pattern as
  // GS/GB's own gsIsProductionEnvironment()/gbIsProductionEnvironment().
  function absIsProductionEnvironment() {
    return !!(window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name === 'AUTHORIZED_PRODUCTION');
  }
  var ABS_WRITE_RPC_NAMES = { master_admin_manage: true };
  function absIsBlockedWrite(name) {
    return !!ABS_WRITE_RPC_NAMES[name];
  }
  // Minimum same-contract response: every real call site
  // (shell-admin.js's own absRunAction/direct .then handlers) reads
  // only a success/failure outcome from the resolved promise -- a
  // zero-arg success callback, confirmed by direct read -- so nothing
  // beyond the required `simulated` marker is fabricated. Every success
  // path closes back through absCloseModalAndRefresh, which forces a
  // real re-read (master_admin_reference_data) before showing the list
  // again -- the displayed data always comes from the server, never
  // from this simulated value (Section 12/client-state-safety).
  function absSimulateWrite(name, params) {
    if (typeof console !== 'undefined' && console.warn) {
      // V2-SECURITY-02 (SEC-04): log the write's field names only, never
      // the values -- params here can carry CPF, names, and other
      // ausencias_analistas fields; the shape (which fields were sent)
      // is enough to diagnose a homolog-mode block, the values are not.
      if (window.NX_DEV) window.NX_DEV.warn('[Férias/Ausências] MODO HOMOLOGAÇÃO — escrita bloqueada: ' + name, Object.keys(params || {})); // RPC/param names: localhost with ?debug=1 only
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
    if (!absIsProductionEnvironment() && absIsBlockedWrite(fnName)) {
      return Promise.resolve(absSimulateWrite(fnName, params));
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

  function listAbsences(params) {
    params = params || {};
    return callRpc('master_admin_reference_data', {}, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.absences)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.absences;
    });
  }

  function manage(action, payload, params) {
    params = params || {};
    return callRpc('master_admin_manage', { p_entity: 'ABSENCE', p_action: action, p_payload: payload || {} }, params.signal);
  }

  // Payload keys below are the EXACT keys the live RPC body reads
  // (pg_get_functiondef-confirmed, PM-5F Gate 34/35) -- not guessed
  // from column names. Notably `observacao`/note has NO corresponding
  // payload key read anywhere in the real CREATE branch: the real
  // INSERT's column list omits `observacao` entirely, so any note
  // value sent here would be silently dropped server-side. This
  // provider does not accept or send one, to avoid presenting a field
  // that would appear to save but never actually persists.
  // Normalização igual à do servidor/v1: CPF só dígitos, lojas com trim
  // (em caixa alta, como no cadastro de usuários).
  function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function storeCode(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function buildCreatePayload(fields) {
    return {
      absent_cpf: digits(fields.cpfAnalistaAusente),
      absent_name: String(fields.nomeAnalistaAusente || '').trim(),
      origin_store: storeCode(fields.lojaOrigem),
      substitute_cpf: digits(fields.cpfAnalistaSubstituto),
      substitute_name: String(fields.nomeAnalistaSubstituto || '').trim(),
      covered_store: storeCode(fields.lojaCoberta),
      start_date: fields.dataInicio,
      end_date: fields.dataFim,
      reason: fields.motivo
    };
  }
  function createAbsence(fields, params) {
    return manage('CREATE', buildCreatePayload(fields), params);
  }
  function setActive(id, active, params) {
    return manage('SET_ACTIVE', { id: id, active: !!active }, params);
  }
  function archiveAbsence(id, params) {
    return manage('ARCHIVE', { id: id }, params);
  }

  window.NX_MASTER_ABSENCES_PROVIDER = {
    listAbsences: listAbsences,
    buildCreatePayload: buildCreatePayload,
    createAbsence: createAbsence,
    setActive: setActive,
    archiveAbsence: archiveAbsence,
    isHomologationMode: function () { return !absIsProductionEnvironment(); }
  };
})();
