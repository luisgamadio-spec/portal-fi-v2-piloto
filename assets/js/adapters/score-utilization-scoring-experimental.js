// SCORE-SIM-15 -- EXPERIMENTAL, ISOLATED. NOT referenced by index.html,
// NOT wired into the operational Score module or its ranking. Local
// homologation only.
//
// Implements the proposed 60/40 "Inteligência de Utilização" formula on
// top of SCORE-SIM-14's consolidated interface
// (score-telemetry-integration-experimental.js), per this wave's exact
// spec:
//   frequenciaPontos = min(eventosElegiveisDistintos, 12) * 5   (teto 60)
//   diversidadePontos = min(modalidadesDistintasElegiveis, 4) * 10 (teto 40)
//   utilizacaoPontos = frequenciaPontos + diversidadePontos      (teto 100)
//   scoreTotal = scoreComercial + utilizacaoPontos               (teto 1000)
// The 12/4 limits are the proposal's own configurable starting
// parameters -- exposed here as `config`, never hardcoded past this
// one module, explicitly pending human homologation (this wave never
// declares them final).
//
// CANONICAL MODALIDADE IDENTITY (section 5 of this wave): diversity is
// counted by the REAL engineId string from score-calculation-proof-
// experimental.js's ENGINE_CONTRACTS ('tradicional', 'linear',
// 'tradicionalSeminovos', 'linearRateTableSeminovos', ...) -- NEVER by
// a display label. Novos and Seminovos engines already have distinct
// ids by construction in that module (e.g. 'tradicional' vs
// 'tradicionalSeminovos'), so Novos/Seminovos collisions are
// structurally impossible without any extra namespacing here -- this
// is documented, not assumed: verified directly against
// ENGINE_CONTRACTS' own key list.
//
// EXCLUSIVITY (section 6): this module NEVER reads simulation_count or
// any legacy aggregate -- it consumes ONLY the raw calculation-proof
// events already filtered to eligibleForscore=true. When a
// `flaggedEventIds` set is supplied (from SCORE-SIM-14's
// detectDualInstrumentation, or any equivalent detector), events whose
// id appears in it are excluded from BOTH frequência and diversidade,
// counted separately as excluidosPorSuspeitaDeDuplicidade -- this is
// DETECTION-BASED EXCLUSION, not structural prevention (see this
// module's own header and the SCORE-SIM-15 report section 6 for why:
// true prevention would require modifying the live legacy RPC, out of
// scope). This module never claims to prevent dual instrumentation --
// only to act on what has already been detected.

const DEFAULT_CONFIG = {
  maxEventosFrequencia: 12,
  pontosPorEvento: 5,
  maxModalidadesDiversidade: 4,
  pontosPorModalidade: 10,
};

// utilizacaoRow: one row from buildUtilizacaoView() (SCORE-SIM-14).
// rawEvents: the SAME raw event array passed into buildUtilizacaoView's
//   calcProofEventsByUsuarioId for this usuarioId (never recomputed --
//   this function trusts the caller kept the same source of truth).
// flaggedEventIds: optional Set<eventId> from a dual-instrumentation
//   detector -- events in this set are excluded from scoring.
function computeUtilizacaoScore(utilizacaoRow, rawEvents, flaggedEventIds, config) {
  config = Object.assign({}, DEFAULT_CONFIG, config || {});
  flaggedEventIds = flaggedEventIds || new Set();

  if (utilizacaoRow.eventosElegiveis === null) {
    // SEM_VINCULO_COMPROVADO / AMBIGUO -- utilização indisponível,
    // never a fabricated zero (SCORE-SIM-08's rule, preserved).
    return {
      disponivel: false, frequenciaPontos: null, diversidadePontos: null,
      utilizacaoPontos: null, eventosConsiderados: null, modalidadesConsideradas: null,
      eventosExcluidosPorSuspeitaDeDuplicidade: 0,
    };
  }

  // Deduplicate by event id BEFORE anything else. A caller's raw event
  // log may legitimately contain more than one entry for the same
  // underlying event -- e.g. an original ACCEPTED submission plus a
  // later DUPLICATE-status resubmission, which shares the exact same
  // event id (SCORE-SIM-09-13's own idempotency guarantee). Counting
  // array length here would silently double-count that single event --
  // frequency/diversity must reflect distinct underlying events, never
  // distinct log entries.
  const seenIds = new Set();
  const distinctRaw = (rawEvents || []).filter((e) => {
    if (e.id == null) return true; // nothing to dedupe by -- kept as-is, caller's own responsibility
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  const eligible = distinctRaw.filter((e) => e.eligibleForScore);
  const excluded = eligible.filter((e) => e.id != null && flaggedEventIds.has(e.id));
  const counted = eligible.filter((e) => !(e.id != null && flaggedEventIds.has(e.id)));

  const distinctEventCount = counted.length; // now genuinely distinct underlying events
  const distinctModalidades = new Set(counted.map((e) => e.engineId));

  const frequenciaPontos = Math.min(distinctEventCount, config.maxEventosFrequencia) * config.pontosPorEvento;
  const diversidadePontos = Math.min(distinctModalidades.size, config.maxModalidadesDiversidade) * config.pontosPorModalidade;

  return {
    disponivel: true,
    frequenciaPontos,
    diversidadePontos,
    utilizacaoPontos: frequenciaPontos + diversidadePontos, // naturally capped at maxEventosFrequencia*pontosPorEvento + maxModalidadesDiversidade*pontosPorModalidade
    eventosConsiderados: distinctEventCount,
    modalidadesConsideradas: Array.from(distinctModalidades),
    eventosExcluidosPorSuspeitaDeDuplicidade: excluded.length,
  };
}

// scoreComercial: the row's REAL calcScores() output score (0-1000
// today, never recomputed here). utilizacao: computeUtilizacaoScore()'s
// own output.
function composeScoreTotal(scoreComercial, utilizacao) {
  return {
    scoreComercial,
    utilizacaoPontos: utilizacao.disponivel ? utilizacao.utilizacaoPontos : null,
    scoreTotal: utilizacao.disponivel ? scoreComercial + utilizacao.utilizacaoPontos : scoreComercial,
    // Explicit flag -- a caller rendering scoreTotal must know whether
    // it is "comercial + utilização" or just "comercial alone because
    // utilização is unavailable" -- never silently indistinguishable
    // from a genuine 0-point utilização.
    utilizacaoDisponivel: utilizacao.disponivel,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_CONFIG, computeUtilizacaoScore, composeScoreTotal };
}
if (typeof window !== 'undefined') {
  window.ScoreUtilizationScoringExperimental = { DEFAULT_CONFIG, computeUtilizacaoScore, composeScoreTotal };
}
