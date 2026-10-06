/* PORTAL-NEXT V2 -- SCORE-SIM-16 EXPERIMENTAL view-model for the Score
   module's new "Inteligência de Utilização (60/40)" section.

   Same pattern as score-intelligence-view-model.js (SCORE-SIM-03/04):
   consumed by score.js, fully independent lifecycle from the base
   Score table AND from the existing #sciRegion (SCORE-SIM-03) section
   -- never blocking, never altering either.

   Wraps the ALREADY-TESTED pure functions from
   score-identity-experimental-view-model.js,
   score-calculation-proof-experimental.js,
   score-telemetry-integration-experimental.js and
   score-utilization-scoring-experimental.js (SCORE-SIM-08/11-15) --
   this file adds ONLY two things neither of those already provide:
   (1) the 1000->900 proportional normalization of the commercial score
   (experimental layer only, calcScores()/SCORE_WEIGHTS untouched), and
   (2) a DEMO-MODE synthetic event generator, deterministic per vendedor
   name, used ONLY when the Score module itself is already in fixture
   mode (isRealTransport()===false) -- i.e. only ever shown alongside
   already-synthetic fixture score rows, never mixed with real ones. */
(function () {
  'use strict';

  // ---- 1000 -> 900 proportional normalization (experimental layer
  // only; SCORE_WEIGHTS/calcScores() are never touched, never
  // re-derived here -- this is a pure post-hoc scaling of the
  // ALREADY-COMPUTED official score). Applied identically regardless
  // of department -- both Novos and Seminovos SCORE_WEIGHTS sum to the
  // SAME 1000-point ceiling today (confirmed: Novos 250+230+130+130+
  // 100+160=1000, Seminovos 300+270+150+280=1000), so a single 0.9
  // factor is correct for both without any department-specific case,
  // not merely assumed. If a future wave changes either department's
  // weight sum, this function's own COMMERCIAL_CEILING constant is the
  // one place that would need revisiting.
  var COMMERCIAL_CEILING_OFICIAL = 1000;
  var COMMERCIAL_CEILING_EXPERIMENTAL = 900;
  var NORMALIZATION_FACTOR = COMMERCIAL_CEILING_EXPERIMENTAL / COMMERCIAL_CEILING_OFICIAL;

  function normalizeComercial(scoreOficial) {
    if (typeof scoreOficial !== 'number' || !isFinite(scoreOficial)) return null;
    // Full precision kept internally; rounding happens only at
    // presentation time (score.js's own formatting), per this wave's
    // explicit instruction.
    return scoreOficial * NORMALIZATION_FACTOR;
  }

  // Same normalization applied to each individual scoreBreakdown
  // criterion, so a future "ver detalhamento" view could show
  // proportional criteria without re-deriving weights independently.
  function normalizeBreakdown(scoreBreakdown) {
    return (scoreBreakdown || []).map(function (c) {
      return Object.assign({}, c, {
        pointsNormalized: c.points * NORMALIZATION_FACTOR,
        maxNormalized: c.max * NORMALIZATION_FACTOR,
      });
    });
  }

  function hashSeed(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Deterministic per-vendedor synthetic calculation-proof events --
  // ONLY ever called when the Score module is already in fixture mode
  // (the CALLER's responsibility to gate this, never decided here).
  // Reuses the REAL pure engines (parcelaUnica/descobridor -- both
  // batch-free, so no synthetic batch needs seeding) via the REAL
  // submitCalculationEvent(), never a reimplemented/fabricated result.
  var DEMO_ENGINES = ['parcelaUnica', 'descobridor'];
  function buildDemoUtilizationRows(scoreRows) {
    var P = window.ScoreCalculationProofExperimental;
    var T = window.ScoreTelemetryIntegrationExperimental;
    var ADAPTERS = { novos: window.NX_SIMULADOR_NOVOS_ADAPTER, seminovos: window.NX_SIMULADOR_SEMINOVOS_ADAPTER, campanha: window.NX_CAMPANHA_ADAPTER };
    var store = P.createCalculationProofStore();
    var linked = [];
    var rawEventsByUsuario = {};
    var duplicatasIgnoradasByUsuario = {};

    (scoreRows || []).forEach(function (row) {
      var key = row.vendedor + '|' + row.loja + '|' + row.dept;
      var seed = hashSeed(key);
      var bucket = seed % 5;

      if (bucket <= 1) {
        linked.push({ vendedor: row.vendedor, loja: row.loja, dept: row.dept, officialScore: row.score, usageStatus: 'SEM_VINCULO_COMPROVADO', usuarioId: null, simulacoes: null });
        return;
      }

      var usuarioId = 'demo-' + seed;
      if (bucket === 2) {
        // VINCULADO real, mas zero eventos -- zero genuíno, nunca null.
        linked.push({ vendedor: row.vendedor, loja: row.loja, dept: row.dept, officialScore: row.score, usageStatus: 'VINCULADO', usuarioId: usuarioId, simulacoes: 0 });
        rawEventsByUsuario[usuarioId] = [];
        return;
      }

      linked.push({ vendedor: row.vendedor, loja: row.loja, dept: row.dept, officialScore: row.score, usageStatus: 'VINCULADO', usuarioId: usuarioId, simulacoes: null });
      P.seedSession(store, 's-' + usuarioId, { usuarioId: usuarioId });
      var numEvents = 2 + (seed % 6); // 2..7
      var numModalidades = 1 + (seed % DEMO_ENGINES.length);
      var events = [];
      for (var i = 0; i < numEvents; i++) {
        var eng = DEMO_ENGINES[(seed + i) % numModalidades];
        var idKey = ('d' + seed + 'e' + i + '0000000000000000').slice(0, 16);
        var params = eng === 'parcelaUnica' ? { bem: 100000, entrada: 60000 } : { financiado: 50000, prazo: 24, parcela: 2500 };
        var r = P.submitCalculationEvent(store, ADAPTERS, { sessionId: 's-' + usuarioId, callerUserId: usuarioId, idempotencyKey: idKey, engineId: eng, batchId: null, params: params });
        events.push({ id: r.eventId, engineId: eng, eligibleForScore: r.eligibleForScore, validated: r.validated, calculoValido: r.calculoValido, rejectReason: r.rejectReason });
      }
      // Retry/duplicata real demonstrada: reenvia a MESMA chave do
      // primeiro evento (simula um reenvio de rede) -- prova, com dados
      // reais desta wave, que a idempotência (SCORE-SIM-09→13) segue
      // ativa dentro da visão unificada: nunca gera um segundo crédito.
      var firstIdKey = ('d' + seed + 'e' + 0 + '0000000000000000').slice(0, 16);
      var retry = P.submitCalculationEvent(store, ADAPTERS, { sessionId: 's-' + usuarioId, callerUserId: usuarioId, idempotencyKey: firstIdKey, engineId: DEMO_ENGINES[seed % numModalidades], batchId: null, params: { bem: 100000, entrada: 60000 } });
      duplicatasIgnoradasByUsuario[usuarioId] = retry.status === 'DUPLICATE' ? 1 : 0;
      rawEventsByUsuario[usuarioId] = events;
    });

    var view = T.buildUtilizacaoView(linked, rawEventsByUsuario, null);
    return { view: view, rawEventsByUsuario: rawEventsByUsuario, duplicatasIgnoradasByUsuario: duplicatasIgnoradasByUsuario };
  }

  window.NX_SCORE_UTILIZATION_VM = {
    NORMALIZATION_FACTOR: NORMALIZATION_FACTOR,
    COMMERCIAL_CEILING_EXPERIMENTAL: COMMERCIAL_CEILING_EXPERIMENTAL,
    normalizeComercial: normalizeComercial,
    normalizeBreakdown: normalizeBreakdown,
    buildDemoUtilizationRows: buildDemoUtilizationRows,
  };
})();
