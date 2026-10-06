/* PORTAL-NEXT V2 -- Gestão (Análise F&I do Grupo) Adapter
   (Wave 2: RPC-shaped local contract reconciliation).

   THIN adapter, by design (Wave 1 Gate A8 / Wave 2 Gate 3). Its only
   job is to take an already RPC-shaped response (today: from
   gestao-fixture-provider.js's local simulation; tomorrow: from a real
   `operational_fandi_dashboard` call, unchanged) and produce a safe,
   defaulted internal model for rendering -- numeric coercion, array/
   null defaults, nothing else.

   This file explicitly does NOT:
     - decide who is authorized (RBAC) -- backend-owned;
     - canonicalize or compare store strings -- backend-owned, store
       values here are already canonical (see assets/js/lookups/
       store-display.js for presentation-only display names);
     - classify financing plans (SUBSIDIADO/REVERSÃO/COPARTICIPADO/
       BALÃO/LINEAR) -- backend-owned;
     - derive proposal_outcomes from raw rows -- backend-owned, this
       adapter only passes the array through.

   The pre-Wave-2 client-side engine that used to do all of the above
   locally (from raw Base01/02/03 upload rows) is retired to
   assets/js/adapters/_gestao-legacy-upload-engine.js -- DEAD LEGACY,
   not loaded, kept for historical reference only. */
(function () {
  'use strict';

  function money(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function num(v) { return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }
  function n(v) { return Number(v) || 0; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // ==== BEGIN period-preset date arithmetic (pure, no business rule) ====
  function computePeriodPreset(preset, today) {
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var start, end;
    if (preset === 'CURRENT_MONTH') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = today;
    } else if (preset === 'PREVIOUS_MONTH') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === 'LAST_6_MONTHS') {
      start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      end = today;
    } else {
      return null;
    }
    return { start: start, end: end };
  }
  // ==== END period-preset date arithmetic ====

  // normalizeResponse: safe defaulting only. No shape derived that
  // wasn't already present on the RPC-shaped input.
  function normalizeResponse(resp) {
    resp = resp || {};
    var summary = resp.summary || {};
    return {
      scope: resp.scope || {},
      period: resp.period || {},
      filters: resp.filters || {},
      source: resp.source || {},
      summary: { operational_quantity: n(summary.operational_quantity), total_financed: n(summary.total_financed) },
      stores: arr(resp.stores).map(function (s) {
        return {
          store: s.store, quantity: n(s.quantity), new_quantity: n(s.new_quantity), used_quantity: n(s.used_quantity),
          new_average_financed: n(s.new_average_financed), used_average_financed: n(s.used_average_financed),
          new_average_installment: n(s.new_average_installment), used_average_installment: n(s.used_average_installment),
          balloon_quantity: n(s.balloon_quantity), average_balloon: n(s.average_balloon), total_financed: n(s.total_financed)
        };
      }),
      banks: arr(resp.banks).map(function (b) {
        return { bank: b.bank, quantity: n(b.quantity), total_financed: n(b.total_financed), average_financed: n(b.average_financed), new_financed: n(b.new_financed), used_financed: n(b.used_financed) };
      }),
      status_by_store: arr(resp.status_by_store).map(function (r) { return { store: r.store, status: r.status, quantity: n(r.quantity), financed_value: n(r.financed_value) }; }),
      status_by_bank: arr(resp.status_by_bank).map(function (r) { return { bank: r.bank, status: r.status, quantity: n(r.quantity), financed_value: n(r.financed_value) }; }),
      plans: arr(resp.plans).map(function (p) { return { plan_type: p.plan_type, quantity: n(p.quantity), financed_value: n(p.financed_value) }; }),
      plans_by_store_department: arr(resp.plans_by_store_department).map(function (p) { return { store: p.store, department: p.department, plan_type: p.plan_type, quantity: n(p.quantity) }; }),
      spf_extra: arr(resp.spf_extra).map(function (r) { return { store: r.store, department: r.department, spf_value: n(r.spf_value), spf_70_value: n(r.spf_70_value) }; }),
      proposal_outcomes: arr(resp.proposal_outcomes).map(function (r) { return { store: r.store, department: r.department, outcome: r.outcome, quantity: n(r.quantity), financed_value: n(r.financed_value) }; })
    };
  }

  window.NX_GESTAO_ADAPTER = {
    id: 'gestao',
    groundTruthRef: 'operational_fandi_dashboard RPC contract, proven read-only against the deployed function (PORTAL V2 Wave 1 backend contract proof) -- Secure commit 4d8ce1d410f5aa05d563a81876c7d5b45e455306',
    money: money,
    num: num,
    computePeriodPreset: computePeriodPreset,
    normalizeResponse: normalizeResponse
  };

  if (window.NX_BUSINESS_ADAPTERS) {
    window.NX_BUSINESS_ADAPTERS.registry.gestao = window.NX_GESTAO_ADAPTER;
  }
})();
