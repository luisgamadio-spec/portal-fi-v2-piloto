/* PORTAL-NEXT V2 — Business Adapter Boundary (Gate 15).
   Interface/contract ONLY. No formula, no PMT/taxa/balão/rebate/
   commission/Score logic exists in this file — see
   tests/business-logic-scanner.py, which fails the build if it ever
   finds one here.

   PURPOSE: so V2's presentation layer never needs to know V1's DOM
   contracts, RPC names, or legacy calculation internals directly. A
   future Wave implements ONE adapter per module (in a file like
   assets/js/adapters/<module-id>.adapter.js, not created yet), each
   satisfying this same shape, so the UI layer only ever talks to
   this contract — never to modules/simulador-novos.html's DOM, never
   to a raw supabase.rpc(...) call scattered through component code. */
(function () {
  'use strict';

  function notImplemented(moduleId, method) {
    return function () {
      throw new Error(
        '[business-adapter-boundary] ' + moduleId + '.' + method + '() ' +
        'is a Foundation-phase contract stub. A real adapter must ' +
        'extract/reuse V1\'s actual business logic VERBATIM (see the ' +
        'functionalSource field in config/module-registry.json for ' +
        'where that logic currently lives) — never reimplement or ' +
        '"improve" it inside an adapter. Ground-truth capture happens ' +
        'BEFORE extraction, per PORTAL-NEXT-01/FUNCTIONAL-PARITY-PLAN.md.'
      );
    };
  }

  // Contract shape every future business adapter must implement:
  //   id: matches the module-registry.json entry's id
  //   compute(input) -> plain output object, NO DOM access inside
  //   groundTruthRef: a pointer to where the pre-migration ground
  //     truth capture for this adapter's outputs is recorded (not a
  //     value itself — this file stores no financial data)
  function createAdapterStub(moduleId) {
    return {
      id: moduleId,
      compute: notImplemented(moduleId, 'compute'),
      groundTruthRef: null
    };
  }

  window.NX_BUSINESS_ADAPTERS = {
    // Empty by design this phase — no module has an adapter yet.
    // Populated one entry at a time as each Wave actually extracts
    // its module's logic, never all at once and never speculatively.
    registry: {},

    // Convenience used only by tests/dev tooling — NOT a real runtime
    // capability. Confirms the contract shape without implementing it.
    describe: function (moduleId) {
      return createAdapterStub(moduleId);
    }
  };
})();
