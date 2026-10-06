/* PORTAL-NEXT V2 — Financiamento Campanha / Coparticipado Adapter
   (Gate 22/49: PURE re-derivation of provably shared logic).
   SOURCE: git show origin/main:modules/simulador-novos.html AND
   modules/simulador-seminovos.html — both embed an identical, base64-
   encoded "Financiamento Campanha" mini-app (FINANCIAMENTO_CAMPANHA_
   HTML_B64), decoded and diffed this Wave (PORTAL-NEXT-08): the calc()
   engine, coefFor(), PRAZOS, TX_COEF and MODELS are byte-identical in
   both simulators (only cosmetic var/const and an unrelated telemetry
   hook differ) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md Gate 22/49.

   The original calc() reads/writes DOM directly (getElementById) —
   this adapter is a faithful PURE re-derivation (Gate 25: no document/
   window DOM dependency), verified for parity against the real,
   unmodified, DOM-coupled original (driven in a real browser against
   the saved origin/main HTML) by
   tests/simulador-campanha-parity-test.py. Do not change PRAZOS/
   TX_COEF/MODELS/the formula without a new extraction. */
(function () {
  'use strict';

  const PRAZOS = [12, 18, 24, 36, 48, 60];

  const TX_COEF = {
    12: {0: 0.08783725, 0.0019: 0.08892075, 0.0049: 0.090641},
    18: {0: 0.05882875, 0.0019: 0.059891, 0.0039: 0.061021, 0.0059: 0.0621635, 0.0089: 0.0639005},
    24: {0: 0.044224, 0.0019: 0.045277, 0.0029: 0.04583725, 0.0039: 0.04640175, 0.0049: 0.04697025, 0.0069: 0.04811975, 0.0089: 0.049284},
    36: {0.0019: 0.03059675, 0.0029: 0.03115675, 0.0039: 0.03172325, 0.0049: 0.03229575, 0.0059: 0.03287425, 0.0069: 0.033459, 0.0079: 0.03404975, 0.0089: 0.034647, 0.0099: 0.03524925, 0.0109: 0.0358585},
    48: {0.0039: 0.0243665, 0.0049: 0.02494575, 0.0059: 0.02553325, 0.0069: 0.02612875, 0.0079: 0.0267325, 0.0089: 0.02734425, 0.0099: 0.027964, 0.0109: 0.028592},
    60: {0.0059: 0.021135, 0.0069: 0.0217425, 0.0079: 0.02236025, 0.0089: 0.022988, 0.0099: 0.02362575, 0.0109: 0.02427325, 0.0119: 0.0249315}
  };

  const MODELS = [
    {name: 'TRITON GLS AT', entry: .6, rebate: .1000040001600064, hpe: .5, brabus: .5, rates: {12: .0019, 18: .0059, 24: .0069, 36: .0099, 48: .0099, 60: .0109}},
    {name: 'TRITON TARMAC', entry: .6, rebate: .12000480019200768, hpe: .5, brabus: .5, rates: {12: 0, 18: .0039, 24: .0049, 36: .0089, 48: .0089, 60: .0099}},
    {name: 'TRITON HPE', entry: .6, rebate: .20834088191601144, hpe: .6521739130434783, brabus: .34782608695652173, rates: {12: 0, 18: 0, 24: 0, 36: .0029, 48: .0049, 60: .0069}},
    {name: 'TRITON HPE-S', entry: .6, rebate: .20834027800926697, hpe: .68, brabus: .32, rates: {12: 0, 18: 0, 24: 0, 36: .0029, 48: .0049, 60: .0069}},
    {name: 'TRITON KATANA', entry: .6, rebate: .2230837871934521, hpe: .5862068965517241, brabus: .41379310344827586, rates: {12: 0, 18: 0, 24: 0, 36: .0019, 48: .0039, 60: .0059}},
    {name: 'TRITON SAVANA', entry: .6, rebate: .2164243708767426, hpe: .5862068965517241, brabus: .41379310344827586, rates: {12: 0, 18: 0, 24: 0, 36: .0019, 48: .0039, 60: .0059}},
    {name: 'TRITON TERRA', entry: .6, rebate: .21015101887011217, hpe: .5862068965517241, brabus: .41379310344827586, rates: {12: 0, 18: 0, 24: 0, 36: .0029, 48: .0049, 60: .0059}},
    {name: 'ECLIPSE CROSS RUSH', entry: .6, rebate: .07812988311769485, hpe: .3, brabus: .7, rates: {12: .0049, 18: .0089, 24: .0089, 36: .0109, 48: .0109, 60: .0119}},
    {name: 'ECLIPSE CROSS HPE', entry: .6, rebate: .15278626590366132, hpe: .6363636363636364, brabus: .36363636363636365, rates: {12: 0, 18: 0, 24: .0019, 36: .0059, 48: .0079, 60: .0089}},
    {name: 'ECLIPSE CROSS TARMAC', entry: .6, rebate: .14865668414508892, hpe: .6363636363636364, brabus: .36363636363636365, rates: {12: 0, 18: 0, 24: .0029, 36: .0069, 48: .0079, 60: .0089}},
    {name: 'ECLIPSE CROSS HPE-S', entry: .6, rebate: .13095861707700368, hpe: .6363636363636364, brabus: .36363636363636365, rates: {12: 0, 18: .0019, 24: .0039, 36: .0079, 48: .0089, 60: .0099}},
    {name: 'ECLIPSE CROSS HPE-S S-AWC', entry: .6, rebate: .17046229374062458, hpe: .6333333333333333, brabus: .36666666666666664, rates: {12: 0, 18: 0, 24: 0, 36: .0049, 48: .0069, 60: .0079}},
    {name: 'ECLIPSE CROSS HPE-S S-AWC BLACK', entry: .6, rebate: .1666740744033068, hpe: .6333333333333333, brabus: .36666666666666664, rates: {12: 0, 18: 0, 24: .0029, 36: .0069, 48: .0079, 60: .0099}},
    {name: 'OUTLANDER HPE-S', entry: .6, rebate: .19231360964952768, hpe: .52, brabus: .48, rates: {12: 0, 18: 0, 24: 0, 36: .0039, 48: .0059, 60: .0069}},
    {name: 'OUTLANDER SIGNATURE', entry: .6, rebate: .17123756815255212, hpe: .52, brabus: .48, rates: {12: 0, 18: 0, 24: 0, 36: .0049, 48: .0069, 60: .0079}}
  ];

  function coefFor(p, t) {
    const obj = TX_COEF[p];
    if (!obj) return null;
    const key = Object.keys(obj).find(k => Math.abs(Number(k) - t) < 0.0000001);
    return key ? obj[key] : null;
  }

  function findModel(name) {
    return MODELS.find(m => m.name === name) || MODELS[0];
  }

  // Pure re-derivation of calc() — same math, no DOM.
  //
  // V2_SIMULADOR_NOVOS_GOVERNED_AUTHORITY_MIGRATION (additive only — no
  // change to PRAZOS/TX_COEF/MODELS/the formula itself): params.modelOverride
  // and params.coefLookup let a caller inject a model object / coefficient
  // resolver built from governed authority (simulador_get_coparticipado's
  // matriz_modelos + tx_coef) instead of this file's own internal hardcoded
  // MODELS/TX_COEF. When omitted, behavior is byte-identical to before —
  // existing callers (Seminovos has none; tests/simulador-campanha-parity-
  // test.py) are unaffected.
  function calcularCampanha(params) {
    const modelName = params.model;
    const sale = params.saleValue;
    const entry = params.entryValue;
    const m = params.modelOverride || findModel(modelName);
    const resolveCoef = params.coefLookup || coefFor;

    const entryPct = sale > 0 ? entry / sale : 0;
    const minValue = sale * m.entry;
    const invalid = sale > 0 && entry > 0 && entry < minValue;
    const valid = sale > 0 && entry >= minValue;
    const financed = valid ? Math.max(sale - entry, 0) : 0;

    const terms = PRAZOS.map(p => {
      const rate = m.rates[p];
      const coef = resolveCoef(p, rate);
      const acrescimo = p <= 24 ? 0.0411 : 0.0622;
      const payment = (valid && coef) ? ((financed * (1 + acrescimo)) * coef) : null;
      return {prazo: p, rate, payment};
    });

    const rebateTotal = valid ? financed * m.rebate : null;
    const rebateBrabus = valid ? rebateTotal * m.brabus : null;
    const rebateHpe = valid ? rebateTotal * m.hpe : null;
    const finalSale = valid ? Math.max(sale - rebateBrabus, 0) : null;

    return {
      model: m.name, sale, entry, entryPct, minValue, invalid, valid, financed,
      terms, rebateTotal, rebateBrabus, rebateHpe, finalSale
    };
  }

  window.NX_CAMPANHA_ADAPTER = {
    id: 'financiamento-campanha',
    compute: calcularCampanha,
    _internal: {PRAZOS, TX_COEF, MODELS, coefFor, findModel},
    groundTruthRef: 'origin/main:modules/simulador-novos.html AND modules/simulador-seminovos.html (byte-identical FINANCIAMENTO_CAMPANHA_HTML_B64 embedded mini-app in both) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md'
  };
})();
