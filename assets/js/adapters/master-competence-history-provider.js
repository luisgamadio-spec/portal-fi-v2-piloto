/* PORTAL-NEXT V2 -- Painel Master / Histórico de Competências REAL data
   provider (Painel Master Phase PM-5H, extended by PM-6B for Exportar
   RH/DP's supplementary read-only data sources, and by PM-6D.3 to
   consume the frozen operational snapshot for closings whose
   historical_detail_status='COMPLETE' -- see loadOperationalSnapshot's
   own doc comment below).

   THIN transport boundary, same shape as every sibling Painel Master
   provider. THIS PROVIDER IS STRICTLY READ-ONLY -- every function here is
   a read (or a server-side fail-closed guard that itself never writes),
   and it calls exactly 6 real RPCs:

     - master_commission_closings() -- lists every fechamentos_comissao
       row (all periods, all versions, both FECHADO and REABERTO).
     - master_commission_snapshot(p_closing_id) -- the frozen
       snapshot_comissoes rows for one specific closing.
     - master_commission_snapshot_export(p_closing_id) -- same data as
       above, but FAILS CLOSED (real 22023 error, never a silent empty
       result) when the snapshot is structurally inconsistent (all
       rows comissao=0 AND detalhes IS NULL, or zero rows) -- used
       ONLY for the official Export/RH-DP/Print actions, never for the
       viewer.
     - master_operational_spf_audit_period(p_start,p_end) -- MASTER-only,
       SECURITY DEFINER, search_path pinned (body read verbatim,
       PM-5J/PM-6B, from supabase/migrations/20260821200000_incidente_
       fechamento10_snapshot_e_spf_audit.sql) -- chassis ALWAYS masked
       (last6) server-side, no client identity/CPF in its return shape.
       PM-6B: powers Exportar RH/DP's 7_AUDITORIA_SPF sheet, using the
       CLOSING's own frozen data_inicio/data_fim (never the currently-
       open período), verbatim port of buscarAuditoriaSpfParaFechamento.
     - operational_salary_details(p_start,p_end,p_seller_id) -- SECURITY
       DEFINER, search_path pinned, scoped via operational_current_
       scope() (v_is_master bypasses ALL store/department restriction --
       body read verbatim, PM-6B, latest definition supabase/migrations/
       20260901120000_incidente_salary_details_spf_batch_scope.sql).
       Returns chassis_masked (never raw chassis), no CPF field at all.
       PM-6B: powers Exportar RH/DP's 5_CHASSIS_FINANCIADOS/6_TODOS_
       CHASSIS_VENDEDOR sheets -- this data was NEVER stored in the
       frozen snapshot (Incidente Excel-RH-DP-3.0, V1), so it is
       reconstructed live for the closing's own period and reconciled
       fail-closed against the frozen snapshot's per-VENDEDOR vendidas/
       financiadas totals (NX_MASTER_COMPETENCE_RHDP_EXPORT_ENGINE.
       reconcileChassisDetail) before ever being presented -- a single
       mismatch blocks the WHOLE export, verbatim port of
       buscarDetalheOperacionalParaFechamento's own fail-closed check.
       PM-6D.3: this whole live+reconcile path now runs ONLY when
       loadOperationalSnapshot's own completeness comes back
       'LEGACY_PARTIAL' -- for 'COMPLETE' closings it is never called
       at all (see the engine's splitFrozenOperationalRows).
     - master_commission_operational_detail(p_closing_id) -- MASTER-only,
       SECURITY DEFINER, search_path pinned (PM-6D.1, body confirmed
       live). Reads EXCLUSIVELY the frozen snapshot_operational_detail
       table (PM-6D.1/PM-6D.2) -- never a live source, never calls
       operational_salary_details/master_operational_spf_audit_period
       itself. PM-6D.3: the sole source of CHASSIS/SPF detail for any
       closing whose historical_detail_status='COMPLETE'.

   Contract for these 3 functions was reconstructed in PM-5G/PM-5H from
   real, git-tracked SQL (master_commission_snapshot_export's full body
   is readable verbatim in portal-financiamento-brabus-secure's
   supabase/migrations/20260824040000_incidente_p2_rhdp_failclosed_
   snapshot_inconsistente.sql) and from real, already-ground-truth-
   audited production TypeScript that consumes the other two
   (supabase/functions/portal-ai/index.ts, "Fase IA-2C.5 -- Salários,
   Comissões e Competências", which documents the exact real return
   shape of both `master_commission_closings` and
   `master_commission_snapshot` field-by-field). The literal SQL bodies
   of `master_commission_closings`/`master_commission_snapshot`
   themselves are NOT in Git (confirmed absent by exhaustive grep across
   all 68 migrations) and this session has no live database/Management
   API/service-role credential available to inspect them directly
   (documented limitation, PM-5G/PM-5H final reports) -- their MASTER-
   only gating is inferred with high confidence from the zero-exception
   naming/security convention shared by every other `master_*` RPC
   whose body IS available (all of them, without a single counter-
   example, start with an inline `perfil='MASTER'`/`is_master()` check)
   plus the portal-ai edge function's own independent, service-role-
   verified MASTER gate for this exact data domain -- never assumed
   without stating this explicitly.

   Never call master_close_commission_period, master_reopen_commission_
   period, master_admin_manage, or any write/mutation RPC from this
   file -- enforced structurally by this file simply never importing/
   referencing them (see tests/master-competence-history-provider-
   test.py's read-only-proof check, which asserts on this file's own
   source text).

   RH-4D: this is now the SINGLE canonical frontend transport authority
   for the master_commission_* historical/snapshot RPC family -- the
   Salários & Comissões module's own Histórico tab (formerly a separate
   duplicate provider, salarios-comissoes-history-provider.js, retired
   this Wave) now consumes THIS file directly, never a second transport
   path. RH-4D also hardened getSnapshot/exportSnapshot to strip the
   real `cpf` column snapshot_comissoes can legitimately carry (see
   stripCpf below) -- neither this file's own existing consumer
   (shell-admin.js's Histórico de Competências screen) nor the new
   Salários consumer ever read `.cpf`, so removing it at this single
   transport choke point is a pure hardening with zero behavior change
   for either consumer. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  // RH-4D hardening: snapshot_comissoes has a real `cpf` column
  // (live-confirmed non-null on 95/2138 rows, one legacy test closing
  // predating the current closing RPC -- the live closing path never
  // writes it). getSnapshot/exportSnapshot serialize the full row via
  // to_jsonb(s) server-side, so `cpf` CAN legitimately arrive here.
  // Product contract (DO_NOT_CARRY_CPF_FORWARD): no current V2
  // consumer of this provider (this file's own downstream view-model/
  // export-engine templates, nor the new Salários & Comissões
  // consumer) ever reads `.cpf`, so stripping it at this single
  // transport choke point removes the field for every present and
  // future consumer without touching any of their code. Every OTHER
  // field is passed through unmodified -- this is a targeted strip,
  // not a speculative sanitizer.
  function stripCpf(rows) {
    var out = rows.map(function (row) {
      if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, 'cpf')) return row;
      var copy = {};
      Object.keys(row).forEach(function (k) { if (k !== 'cpf') copy[k] = row[k]; });
      return copy;
    });
    if (out.some(function (row) { return row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'cpf'); })) {
      throw { state: 'MALFORMED_RESPONSE', message: 'Falha ao remover dado sensível da resposta.' };
    }
    return out;
  }

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

  function listClosings(params) {
    params = params || {};
    return callRpc('master_commission_closings', {}, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  function getSnapshot(closingId, params) {
    params = params || {};
    return callRpc('master_commission_snapshot', { p_closing_id: closingId }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      try {
        return stripCpf(data.rows);
      } catch (e) {
        return Promise.reject(e);
      }
    });
  }

  // Deliberately a SEPARATE call from getSnapshot -- never reuse
  // getSnapshot's (unguarded) rows for an official export. The real
  // fail-closed check lives server-side inside this RPC (raises a real
  // 22023 when every row is comissao=0 AND detalhes IS NULL, or when
  // there are zero rows) -- this function passes that rejection
  // through untouched, it never retries with getSnapshot as a
  // fallback.
  function exportSnapshot(closingId, params) {
    params = params || {};
    return callRpc('master_commission_snapshot_export', { p_closing_id: closingId }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      try {
        return stripCpf(data.rows);
      } catch (e) {
        return Promise.reject(e);
      }
    });
  }

  // PM-6B: MASTER-only, chassis always masked server-side, no client
  // identity/CPF returned. Uses the CLOSING's own frozen data_inicio/
  // data_fim (caller's responsibility, mirrors V1's fechamento.data_
  // inicio/data_fim -- never the currently-open período).
  function loadSpfAudit(start, end, params) {
    params = params || {};
    return callRpc('master_operational_spf_audit_period', { p_start: start, p_end: end }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  // PM-6B: live operational detail (never stored in the frozen
  // snapshot) -- p_seller_id always null (matches V1: full MASTER scope,
  // never a single-seller filter). Caller MUST reconcile the result
  // against the closing's own snapshot before treating it as trustworthy
  // (NX_MASTER_COMPETENCE_RHDP_EXPORT_ENGINE.reconcileChassisDetail).
  function loadOperationalSalaryDetails(start, end, params) {
    params = params || {};
    return callRpc('operational_salary_details', { p_start: start, p_end: end, p_seller_id: null }, params.signal).then(function (data) {
      if (!data || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data.rows;
    });
  }

  // PM-6D.3: MASTER-only, read-only, reads EXCLUSIVELY the frozen
  // snapshot_operational_detail table (PM-6D.1/PM-6D.2) -- never a live
  // source. Returns { completeness: 'COMPLETE'|'LEGACY_PARTIAL', rows }.
  // completeness is derived server-side from fechamentos_comissao.
  // historical_detail_status alone, NEVER from row count (a COMPLETE
  // closing may legitimately have zero operational rows) -- this
  // provider trusts that field verbatim and never re-derives it.
  function loadOperationalSnapshot(closingId, params) {
    params = params || {};
    return callRpc('master_commission_operational_detail', { p_closing_id: closingId }, params.signal).then(function (data) {
      if (!data || (data.completeness !== 'COMPLETE' && data.completeness !== 'LEGACY_PARTIAL') || !Array.isArray(data.rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  window.NX_MASTER_COMPETENCE_HISTORY_PROVIDER = {
    listClosings: listClosings,
    getSnapshot: getSnapshot,
    exportSnapshot: exportSnapshot,
    loadSpfAudit: loadSpfAudit,
    loadOperationalSalaryDetails: loadOperationalSalaryDetails,
    loadOperationalSnapshot: loadOperationalSnapshot
  };
})();
