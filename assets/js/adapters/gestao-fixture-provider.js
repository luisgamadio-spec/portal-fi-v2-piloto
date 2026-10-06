/* PORTAL-NEXT V2 -- Gestão local fixture PROVIDER (Wave 2:
   RPC-shaped local contract reconciliation).

   THIS IS TEST/LOCAL INFRASTRUCTURE, NOT PRODUCTION BUSINESS LOGIC.
   It exists only because this Wave keeps V2 fixture-driven while making
   the runtime payload shape match the real RPC contract proven in
   Wave 1. When real backend integration happens, `loadGestaoFixture`
   is the ONLY thing that gets replaced -- with a real Supabase remote
   procedure call to the same production function named in Wave 1's
   contract proof -- and nothing downstream (adapter, renderer) needs
   to change, because both already speak that function's own response
   shape.

   loadGestaoFixture({start,end,store,department}) mechanically filters
   the master RPC-shaped snapshot AS IF the server had already applied
   these filters -- plain field-equality row selection on already-
   aggregated arrays, no classification, no canonicalization, no
   authorization decision. `store` and `department` MUST already be
   canonical values (a code from NX_STORE_DISPLAY.CANONICAL_STORES, or
   null/'ALL' for group-wide) -- this module never normalizes or
   resolves aliases, exactly like the real RPC would receive an
   already-canonical parameter from a real caller.

   An unrecognized store returns an empty-but-well-shaped response
   (every array []), mirroring the RPC's fail-closed behavior for an
   unknown store (Wave 1, Gate A1) -- proven here at Gate 8's "ANALISTA
   + unknown" contract scenario, without any profile concept existing
   in this file at all. */
(function () {
  'use strict';

  // Resolved relative to THIS SCRIPT's own location, not the including
  // page's location -- so the fetch works identically whether loaded
  // from index.html (repo root) or from a nested test harness (e.g.
  // tests/fixtures/_gestao-rpc-contract-harness.html).
  var FIXTURE_URL = (function () {
    var s = document.currentScript;
    // new URL(...) resolves ../.. dot-segments during parsing (RFC
    // 3986), producing a clean absolute URL before fetch() ever sees
    // it -- avoids depending on whether the network layer/server would
    // otherwise normalize a literal ".." in the request path.
    return s ? new URL('../../../tests/fixtures/gestao-rpc-fixtures.json', s.src).href : 'tests/fixtures/gestao-rpc-fixtures.json';
  })();

  var masterData = null;

  function loadMaster() {
    if (masterData) return Promise.resolve(masterData);
    return fetch(FIXTURE_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) { masterData = data.master; return masterData; });
  }

  function isKnownStore(store) {
    return !store || window.NX_STORE_DISPLAY.CANONICAL_STORES.indexOf(store) !== -1;
  }

  function matches(row, field, value) {
    return !value || row[field] === value;
  }

  // Plain row-equality selection -- no computation, no business rule.
  function filterLong(rows, store, department) {
    return rows.filter(function (r) { return matches(r, 'store', store) && matches(r, 'department', department); });
  }

  // stores[] carries an embedded new/used split per row (the RPC shape
  // itself, Wave 1 Gate A2) -- a department filter selects which half of
  // that already-present split counts as "the row", the same way the
  // real RPC's `operational` population is department-filtered before
  // store_metrics aggregates it. Still no classification decision: the
  // numbers themselves are untouched, only which pre-computed fields are
  // surfaced changes.
  function projectStoreRow(s, department) {
    if (!department) return s;
    if (department === 'NOVOS') {
      return Object.assign({}, s, {
        quantity: s.new_quantity, used_quantity: 0,
        used_average_financed: 0, used_average_installment: 0,
        total_financed: s.new_quantity * s.new_average_financed
      });
    }
    return Object.assign({}, s, {
      quantity: s.used_quantity, new_quantity: 0,
      new_average_financed: 0, new_average_installment: 0,
      total_financed: s.used_quantity * s.used_average_financed
    });
  }

  function filterStores(rows, store, department) {
    var sel = store ? rows.filter(function (s) { return s.store === store; }) : rows;
    return sel.map(function (s) { return projectStoreRow(s, department); }).filter(function (s) { return s.quantity > 0; });
  }

  // banks[]/status_by_bank[] carry no per-store dimension in the RPC
  // shape (Wave 1 Gate A2) -- a real store-scoped response would only
  // contain the banks that store actually used. This fixture has no
  // per-store bank breakdown to select from, so a store filter here
  // scales the group-wide bank figures by that store's share of
  // group-wide quantity -- a documented LOCAL-FIXTURE APPROXIMATION,
  // not a claim about real bank-per-store distribution. Good enough to
  // exercise the UI/adapter's long-format handling; not a source of
  // authoritative numbers.
  function scaleBanks(rows, quantityField, valueFields, fraction) {
    if (fraction >= 0.999999) return rows;
    return rows.map(function (r) {
      var out = Object.assign({}, r);
      out[quantityField] = Math.round(r[quantityField] * fraction);
      valueFields.forEach(function (f) { out[f] = Math.round(r[f] * fraction * 100) / 100; });
      return out;
    }).filter(function (r) { return r[quantityField] > 0; });
  }

  // plans_by_store_department carries no $ field (matches the real RPC
  // shape, Wave 1 Gate A2 -- that array is quantity-only). Deriving a
  // store/department-scoped plans[] therefore approximates
  // financed_value from quantity x the department's average ticket --
  // a local-fixture approximation, same caveat as scaleBanks above.
  var NOVOS_FIN_AVG = 90000, SEMI_FIN_AVG = 60000;
  function derivePlans(byStoreDept, avgByDept) {
    var acc = [];
    byStoreDept.forEach(function (r) {
      var e = acc.filter(function (x) { return x.plan_type === r.plan_type; })[0];
      if (!e) { e = { plan_type: r.plan_type, quantity: 0, financed_value: 0 }; acc.push(e); }
      e.quantity += r.quantity;
      e.financed_value += r.quantity * (avgByDept ? avgByDept : (r.department === 'SEMINOVOS' ? SEMI_FIN_AVG : NOVOS_FIN_AVG));
    });
    return acc;
  }

  // status_by_store carries no department field either (matches the
  // real RPC shape). Same documented local-fixture approximation as
  // scaleBanks: scale each store's status rows by that store's
  // new/used quantity share (which IS known precisely from stores[]).
  function scaleStatusByStore(rows, storesById, department) {
    if (!department) return rows;
    return rows.map(function (r) {
      var s = storesById[r.store];
      var frac = s && s.quantity ? (department === 'NOVOS' ? s.new_quantity : s.used_quantity) / s.quantity : 0;
      return Object.assign({}, r, {
        quantity: Math.round(r.quantity * frac),
        financed_value: Math.round(r.financed_value * frac * 100) / 100
      });
    }).filter(function (r) { return r.quantity > 0; });
  }

  function loadGestaoFixture(params) {
    params = params || {};
    var store = params.store === 'ALL' ? null : (params.store || null);
    var department = params.department === 'ALL' ? null : (params.department || null);

    return loadMaster().then(function (master) {
      if (store && !isKnownStore(store)) {
        return {
          scope: master.scope,
          period: { start: params.start || master.period.start, end: params.end || master.period.end },
          filters: { store: store, department: department },
          source: master.source,
          summary: { operational_quantity: 0, total_financed: 0 },
          stores: [], banks: [], status_by_store: [], status_by_bank: [],
          plans: [], plans_by_store_department: [], spf_extra: [], proposal_outcomes: []
        };
      }

      var storesById = {};
      master.stores.forEach(function (s) { storesById[s.store] = s; });

      var storeQty = store ? (storesById[store] || { quantity: 0 }).quantity : master.summary.operational_quantity;
      var fraction = store ? (master.summary.operational_quantity ? storeQty / master.summary.operational_quantity : 0) : 1;

      var storesOut = filterStores(master.stores, store, department);
      var banksOut = scaleBanks(master.banks, 'quantity', ['total_financed', 'average_financed', 'new_financed', 'used_financed'], fraction);
      var statusByBankOut = scaleBanks(master.status_by_bank, 'quantity', ['financed_value'], fraction);

      var operationalQuantity = storesOut.reduce(function (s, r) { return s + r.quantity; }, 0);
      var totalFinanced = storesOut.reduce(function (s, r) { return s + r.total_financed; }, 0);

      return {
        scope: master.scope,
        period: { start: params.start || master.period.start, end: params.end || master.period.end },
        filters: { store: store, department: department },
        source: master.source,
        summary: { operational_quantity: operationalQuantity, total_financed: Math.round(totalFinanced * 100) / 100 },
        stores: storesOut,
        banks: banksOut,
        status_by_store: scaleStatusByStore(filterLong(master.status_by_store, store, null), storesById, department),
        status_by_bank: statusByBankOut,
        plans: (store || department)
          ? derivePlans(filterLong(master.plans_by_store_department, store, department), department === 'SEMINOVOS' ? SEMI_FIN_AVG : (department === 'NOVOS' ? NOVOS_FIN_AVG : null))
          : master.plans,
        plans_by_store_department: filterLong(master.plans_by_store_department, store, department),
        spf_extra: filterLong(master.spf_extra, store, department),
        proposal_outcomes: filterLong(master.proposal_outcomes, store, department)
      };
    });
  }

  window.NX_GESTAO_FIXTURE_PROVIDER = {
    loadGestaoFixture: loadGestaoFixture,
    _internal: { loadMaster: loadMaster, isKnownStore: isKnownStore }
  };
})();
