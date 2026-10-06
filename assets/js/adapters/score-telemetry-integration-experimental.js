// SCORE-SIM-14 -- EXPERIMENTAL, ISOLATED. NOT referenced by index.html,
// NOT wired into the operational Score/telemetry flow.
//
// CONSOLIDATION LAYER: the single interface a future Score wave would
// consume to build the "100 pontos de utilização" dimension, joining
// two previously-isolated experimental subsystems that had never been
// wired together before this wave:
//   - IDENTITY (SCORE-SIM-08, score-identity-experimental-view-model.js):
//     resolves a comprovado usuario_id per commercial score row, with
//     states VINCULADO / VINCULADO_SEM_TELEMETRIA / SEM_VINCULO_
//     COMPROVADO / AMBIGUO.
//   - CALCULATION PROOF (SCORE-SIM-11/12/13, score-calculation-proof-
//     experimental.js): individual, server-verified calculation events
//     per usuario_id, each with a tri-state outcome (calculoValido /
//     eligibleForScore / rejectReason).
//
// FORMAL RECONCILIATION (SCORE-SIM-14, section 2/3 of this wave's own
// audit): score-simulation-integrity-experimental.js's challenge/
// fingerprint model (SCORE-SIM-09/10) is DECLARED SUPERSEDED as of this
// wave -- score-calculation-proof-experimental.js never called
// requestChallenge/consumed a challenge_id at any point (confirmed by
// direct export inspection this wave: ScoreCalculationProofExperimental
// exports no challenge-related function). This was an implicit design
// decision made across SCORE-SIM-11 but never formally declared;
// SCORE-SIM-14 declares it explicitly so no future wave silently tries
// to run both eligibility mechanisms in parallel. The challenge module
// is kept only as a historical/reference artifact.
//
// RULES preserved from every prior wave, enforced here again:
//   1. SEM_VINCULO_COMPROVADO / AMBIGUO rows NEVER contribute a real
//      usuario_id -- their utilização fields are always null, never 0,
//      regardless of how many calculation-proof events exist anywhere
//      in the system (never joined by name/CPF/approximation).
//   2. For a row with a real, comprovado usuario_id (VINCULADO or
//      VINCULADO_SEM_TELEMETRIA), an ABSENCE of calculation-proof
//      events in the period is a genuine, complete zero -- unlike the
//      legacy usageLinhas aggregate (SCORE-SIM-08's own null-vs-zero
//      rule was about THAT aggregate's incompleteness), the
//      calculation-proof event log is exhaustive by construction for a
//      resolved identity: every validated attempt is recorded,
//      eligible or not. This is a deliberate, documented DIFFERENCE
//      from SCORE-SIM-08's rule, not a contradiction of it.
//   3. An engine with `operationallyReachable: false` (only
//      semestralTritonSeminovos as of this wave) NEVER contributes to
//      eventosElegiveis, even if calculoValido=true for every one of
//      its events -- those events are counted separately, under their
//      own explicit reject_reason bucket, never silently merged into
//      the eligible count.

// Builds the consolidated utilização view: one row per commercial
// score row (same shape/order as buildIdentityLinkedRows' own output),
// enriched with calculation-proof event aggregates.
//
// identityLinkedRows: output of NX_SCORE_IDENTITY_EXPERIMENTAL_VM.
//   buildIdentityLinkedRows() -- never recomputed here.
// calcProofEventsByUsuarioId: { [usuarioId]: Array<event> } where each
//   event is exactly the shape submitCalculationEvent() persists
//   internally (validated, calculoValido, eligibleForScore,
//   rejectReason, engineId, receivedAt) -- the caller is responsible
//   for having already filtered these to the target período (this
//   function performs no date logic of its own, to stay a pure,
//   synchronous combinator like every other experimental view-model in
//   this series).
function buildUtilizacaoView(identityLinkedRows, calcProofEventsByUsuarioId, periodo) {
  return (identityLinkedRows || []).map((row) => {
    const base = {
      vendedor: row.vendedor, loja: row.loja, dept: row.dept,
      usageStatus: row.usageStatus, usuarioId: row.usuarioId, periodo: periodo || null,
      officialScore: row.officialScore,
    };
    if (row.usageStatus === 'SEM_VINCULO_COMPROVADO' || row.usageStatus === 'AMBIGUO') {
      // Rule 1 -- no real identity to join against. Every utilização
      // field stays null, never a fabricated zero.
      return Object.assign({}, base, {
        eventosElegiveis: null, eventosRejeitados: null, motivosRejeicao: null,
        telemetriaDisponivel: false, eventosOperacionalmenteBloqueados: null,
      });
    }

    const eventos = (calcProofEventsByUsuarioId && calcProofEventsByUsuarioId[row.usuarioId]) || [];
    let elegiveis = 0, rejeitados = 0, bloqueadosOperacionalmente = 0;
    const motivos = {};
    eventos.forEach((ev) => {
      if (!ev.validated) return; // never counts anything that failed session/payload checks -- those aren't real attempts
      if (ev.eligibleForScore) { elegiveis++; return; }
      if (ev.rejectReason === 'UTILIZACAO_NAO_COMPROVADA_V2_NAO_EXPOSTO') { bloqueadosOperacionalmente++; }
      rejeitados++;
      const motivo = ev.rejectReason || 'DESCONHECIDO';
      motivos[motivo] = (motivos[motivo] || 0) + 1;
    });

    // Rule 2 -- a real usuario_id with zero events in the período is a
    // genuine, complete zero (never null): the calc-proof log is
    // exhaustive for a resolved identity, unlike the legacy aggregate.
    return Object.assign({}, base, {
      eventosElegiveis: elegiveis,
      eventosRejeitados: rejeitados,
      motivosRejeicao: motivos,
      telemetriaDisponivel: true,
      eventosOperacionalmenteBloqueados: bloqueadosOperacionalmente,
    });
  });
}

// Detection (never prevention -- see SCORE-SIM-14 report section 8 for
// why true prevention would require modifying the live legacy RPC,
// explicitly out of scope) for suspected dual-instrumentation: a
// legacy telemetry call and a calculation-proof event both landing in
// the same session within a short window suggests a future frontend
// mistake wired BOTH paths to the same click.
//
// legacyCalls: Array<{sessionId, at}> (the legacy RPC carries no
//   engine/identity info by design -- this is literally everything a
//   detector could ever observe about it).
// calcProofEvents: Array<{sessionId, receivedAt, engineId}>.
// windowMs: how close in time two calls must land to be suspicious
//   (default 3000ms -- generous enough to cover a single user click
//   dispatching two async calls back-to-back, narrow enough to not
//   flag two genuinely separate simulations run seconds apart).
function detectDualInstrumentation(legacyCalls, calcProofEvents, windowMs) {
  windowMs = windowMs != null ? windowMs : 3000;
  const flagged = [];
  (legacyCalls || []).forEach((legacy) => {
    (calcProofEvents || []).forEach((ev) => {
      if (ev.sessionId !== legacy.sessionId) return;
      if (Math.abs(ev.receivedAt - legacy.at) <= windowMs) {
        flagged.push({ sessionId: legacy.sessionId, legacyAt: legacy.at, calcProofAt: ev.receivedAt, engineId: ev.engineId, deltaMs: Math.abs(ev.receivedAt - legacy.at) });
      }
    });
  });
  return flagged;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildUtilizacaoView, detectDualInstrumentation };
}
if (typeof window !== 'undefined') {
  window.ScoreTelemetryIntegrationExperimental = { buildUtilizacaoView, detectDualInstrumentation };
}
