/* PORTAL-NEXT V2 -- Score / Inteligência de Utilização (SCORE-SIM-03).

   PRESENTATION LOGIC ONLY -- no RPC transport (score.js calls
   window.NX_MASTER_SIMULATOR_USAGE_PROVIDER directly, the SAME
   MASTER-only, read-only, SECURITY DEFINER RPC (master_simulator_usage_
   data) already used by Painel Master's own "Utilização dos
   Simuladores" screen -- no new RPC, no new table, no new backend
   surface of any kind), no DOM.

   OBSERVATIONAL ONLY: nothing here computes, returns, or exposes any
   number that could feed a score/weight/ranking. This file has no
   dependency on, and no effect on, calcScores() (score.adapter.js,
   byte-identical/frozen, untouched) -- it only reads calcScores()'s
   ALREADY-COMPUTED output rows (vendedor/loja/dept/vendas/fin/share)
   as its LEFT population (Gate: every commercial row stays visible,
   zero utilization is never an INNER JOIN elimination) and overlays a
   SEPARATE utilization aggregate onto it, purely for side-by-side
   reading by a human.

   JOIN KEY (documented limitation, not silently hidden): the real
   operational_score_coparticipated_data RPC exposes only a seller NAME
   string ('seller'), never a usuario_id/seller_id -- confirmed live by
   direct inspection of the RPC's own jsonb_build_object() call
   (SCORE-SIM-03 preflight, pg_get_functiondef). calcScores() itself
   already groups by this same name string (`${vendedor}|${loja}|${dept}`,
   score.adapter.js's own `by[]` key) -- this file reuses the EXACT same
   join key convention (name, normalized via score.adapter.js's own
   normalizeText(), department-qualified) rather than inventing a
   stricter one the rest of Score doesn't have either. A name collision
   between two different real people is therefore a known, pre-existing
   class of ambiguity in Score's own architecture, not something this
   file introduces or can fix without a backend contract change (out of
   scope, SCORE-SIM-02 section 16/17).

   DIRECT-INTEGRATION WAVE -- optional real identity bridge: buildIntelligenceRows()
   now accepts an optional 5th argument, `usuarios` (master_admin_
   security_data().users -- the SAME real, already-live RPC Painel
   Master's own "Usuários" screen already calls, via the ALREADY-LOADED
   window.NX_MASTER_USERS_PROVIDER -- no new RPC, no new table). When
   supplied, every row's utilization numbers are gated behind a REAL
   usuario_id resolved from (nome,loja) against active VENDEDOR usuarios
   rows, then joined against master_simulator_usage_data's own real
   usuario_id (never its name) -- closing exactly the name-coincidence
   gap described above for the rows where a real identity can be proven.
   A row whose identity cannot be proven (zero or >1 active vendedor
   matches) reports identityStatus SEM_VINCULO_COMPROVADO/AMBIGUO and
   null utilization fields ("—"), never a fabricated zero. When `usuarios`
   is omitted (legacy callers), behavior is byte-identical to before this
   wave -- the name+dept join remains the only source, zero is a real,
   valid "no usage" reading.

   EXCLUSION (section 5): utilization rows are filtered to
   perfil_relatorio === 'VENDEDOR' (trim/uppercase) BEFORE aggregation --
   ANALISTA/GERENTE/MASTER/DIRETOR usage is discarded here entirely,
   never blended into any vendor's own numbers (SCORE-SIM-01 found this
   was 24.5% of all real simulations -- a real, not hypothetical, risk
   had this filter been skipped).

   DEPARTMENT SEPARATION (section 6): module_id maps 1:1 to a department
   (simuladorCompleto -> Novos, simuladorSeminovos -> Seminovos) --
   never summed across departments. A vendor active in both keeps two
   fully independent rows (exactly mirroring how calcScores() itself
   already splits a NOVOS/SEMINOVOS seller into two `by[]` entries, one
   per dept, for its own vendas/fin/score) -- this file adds nothing new
   to that split, it only follows it. active_days is read directly off
   the single (usuario_id, module_id) row the RPC already pre-aggregates
   -- never summed across modules (the sibling master-simulator-usage-
   view-model.js's own header warns this specific pattern double-counts;
   irrelevant here by construction, since Novos/Seminovos are always
   kept on separate keys, never merged).

   ZERO vs. NÃO CALCULÁVEL vs. DADO INDISPONÍVEL (section 10/11): a
   commercial row with no matching utilization entry gets explicit
   ZERO REAL values (0 sessions/dias/simulações -- utilization genuinely
   never happened for that vendor in this period, not an unknown). A
   ratio whose denominator is 0 (E when diasUtilizacao=0, I when
   vendas=0, J when financiamentos=0) resolves to `null`, NEVER 0 and
   NEVER Infinity -- score.js's own renderer is the only place that
   turns `null` into the required "—" glyph, this file itself never
   emits a display string. DADO INDISPONÍVEL (the whole RPC call failed/
   was denied) is NOT this file's concern at all -- score.js never even
   calls buildIntelligenceRows() in that case, rendering its own
   unavailable-state copy instead; this file has no "error row" shape
   because it is never invoked with partial/failed data. */
(function () {
  'use strict';

  // SCORE-SIM-04 -- MARCO ZERO. Centralized constant (Gate: never
  // spread across files) -- confirmed LIVE via
  // configuracoes.telemetria_simuladores_started_at
  // ("2026-08-17T17:02:19.226Z" UTC = 2026-08-17T14:02:19-03:00
  // Brasília, the exact "virada oficial" moment telemetry collection
  // began, per the foundation migration's own FALSE->TRUE flip). This
  // is a FALLBACK ONLY: score.js always prefers the LIVE
  // `telemetry_started_at` field the master_simulator_usage_data RPC
  // itself already returns on every call (resolveTelemetryEpoch()
  // below) -- this constant exists so a plausible epoch is still used
  // if that field is ever absent from an older/misbehaving response,
  // never as the silently-preferred source of truth.
  var TELEMETRY_EPOCH_FALLBACK_ISO = '2026-08-17T17:02:19.226Z';

  function resolveTelemetryEpoch(usageResponse) {
    var live = usageResponse && usageResponse.telemetry_started_at;
    return (typeof live === 'string' && live) ? live : TELEMETRY_EPOCH_FALLBACK_ISO;
  }

  // Fixed UTC-3 (America/Sao_Paulo, no DST since 2019) -- same
  // convention already established by master-simulator-usage-view-
  // model.js's own todaySP()/startOfDayIso(). Returns the calendar date
  // (YYYY-MM-DD) an ISO instant falls on IN Brasília local time.
  function dateOnlySP(iso) {
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return null;
    return new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function maxIso(a, b) {
    return Date.parse(a) >= Date.parse(b) ? a : b;
  }

  // Section 3 -- "max(início selecionado, marco zero) até o término
  // selecionado", expressed uniformly as a max() over two INSTANTS
  // (startOfDayIso(currentDateStart) vs. epochIso) so every case --
  // selected start after/at/before the epoch's own calendar day --
  // resolves through the SAME formula, never a separate day-comparison
  // branch per case (Gate 5/10: no special-cased literal branching that
  // could silently diverge from the formula the wave itself specifies).
  //
  // Section 5 -- Base01/Base02 confirmed LIVE as DATE-only columns
  // (sale_date/operation_date, no time component) -- the commercial
  // comparable window's own start DATE is therefore always the
  // calendar day (Brasília) the resolved telemetry instant falls on,
  // which correctly collapses to the epoch's OWN day (17/08) whenever
  // the selected start is on or before it -- the commercial read then
  // includes that day WHOLE (never a fabricated partial-day sale time),
  // flagged via partialFirstDay below.
  function resolveComparableWindow(currentDateStart, currentDateEnd, epochIso) {
    var epochDateSP = dateOnlySP(epochIso);
    var startOfSelStart = currentDateStart + 'T00:00:00-03:00';
    var telemetryStartIso = maxIso(startOfSelStart, epochIso);
    var commercialStartDate = dateOnlySP(telemetryStartIso);
    var noCoverage = currentDateEnd < epochDateSP;
    return {
      epochIso: epochIso,
      epochDateSP: epochDateSP,
      noCoverage: noCoverage,
      partialFirstDay: !noCoverage && commercialStartDate === epochDateSP,
      telemetryStartIso: telemetryStartIso,
      commercialStartDate: noCoverage ? null : commercialStartDate,
      commercialEndDate: noCoverage ? null : currentDateEnd,
      // Whether the comparable window is identical to the originally
      // selected one -- when true, score.js may reuse the ALREADY-
      // fetched original Score rows as the comparable commercial
      // reading instead of issuing a second RPC call (pure efficiency,
      // never a behavior difference: same rows either way).
      sameAsOriginal: !noCoverage && commercialStartDate === currentDateStart
    };
  }

  var MODULE_DEPT = { simuladorCompleto: 'Novos', simuladorSeminovos: 'Seminovos' };

  function normalizeName(s) {
    var adapter = window.NX_SCORE_ADAPTER;
    if (adapter && adapter._internal && typeof adapter._internal.normalizeText === 'function') {
      return adapter._internal.normalizeText(s);
    }
    // Defensive fallback only -- score.adapter.js is always loaded
    // ahead of this file in every real page/harness; this branch exists
    // so a missing script tag fails loud (wrong/empty matches) rather
    // than throwing here.
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  function usageKey(nome, dept) {
    return normalizeName(nome) + '|' + dept;
  }

  function normalizeLoja(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  function identityKey(nome, loja) {
    return normalizeName(nome) + '|' + normalizeLoja(loja);
  }

  // Real usuario_id-based identity bridge -- reuses master_admin_security_
  // data()'s `users` array, EXACTLY the same real, already-live, MASTER-
  // only RPC Painel Master's own "Usuários" screen already calls (via
  // window.NX_MASTER_USERS_PROVIDER, already loaded in the same shell
  // score.js runs in) -- no new RPC, no new table. VENDEDOR + ativo only
  // (a Score commercial row is itself always a real VENDEDOR by
  // construction of calcScores()'s own source; an INATIVO or non-VENDEDOR
  // usuarios row is never a valid resolution target here). A (nome,loja)
  // key matching MORE THAN ONE active real vendedor is a genuine,
  // real-world possible collision (two different people, same name,
  // same store) -- reported as ambiguous, never guessed.
  function resolveVendorIdentityMap(usuarios) {
    var byKey = {};
    (usuarios || []).forEach(function (u) {
      if (String(u.perfil || '').trim().toUpperCase() !== 'VENDEDOR') return;
      if (!u.ativo) return;
      var key = identityKey(u.nome, u.loja);
      (byKey[key] = byKey[key] || []).push(u.id);
    });
    var resolved = {};
    Object.keys(byKey).forEach(function (key) {
      var ids = byKey[key];
      resolved[key] = (ids.length === 1)
        ? { usuarioId: ids[0], ambiguous: false }
        : { usuarioId: null, ambiguous: true };
    });
    return resolved;
  }

  // Same VENDEDOR-only/department-split discipline as
  // aggregateUsageByVendorDept, keyed by the REAL usuario_id
  // master_simulator_usage_data's own rows already carry -- never a name
  // string. Used only once a real identity has been proven (VINCULADO);
  // never as a substitute for name-based matching.
  function aggregateUsageByUsuarioIdDept(linhas) {
    var map = {};
    (linhas || []).forEach(function (l) {
      if (String(l.perfil_relatorio || '').trim().toUpperCase() !== 'VENDEDOR') return;
      var dept = MODULE_DEPT[l.module_id];
      if (!dept) return;
      var key = l.usuario_id + '|' + dept;
      map[key] = {
        sessions: Number(l.sessions) || 0,
        simulations: Number(l.simulation_count) || 0,
        activeSeconds: Number(l.active_seconds) || 0,
        activeDays: Number(l.active_days) || 0
      };
    });
    return map;
  }

  // Builds the (name, dept) -> aggregate usage map, VENDEDOR-only,
  // department-separated. Exposed standalone (not just via
  // buildIntelligenceRows) so tests can assert on the exclusion/mapping
  // rules directly, independent of a particular Score row set.
  function aggregateUsageByVendorDept(linhas) {
    var map = {};
    (linhas || []).forEach(function (l) {
      if (String(l.perfil_relatorio || '').trim().toUpperCase() !== 'VENDEDOR') return;
      var dept = MODULE_DEPT[l.module_id];
      if (!dept) return; // unknown/future module_id -- ignore defensively, never guess a department
      var key = usageKey(l.nome, dept);
      map[key] = {
        sessions: Number(l.sessions) || 0,
        simulations: Number(l.simulation_count) || 0,
        activeSeconds: Number(l.active_seconds) || 0,
        activeDays: Number(l.active_days) || 0
      };
    });
    return map;
  }

  // scoreRowsOriginal: calcScores() output for the ORIGINAL Score
  // period (never recomputed here) -- this is the POPULATION (every
  // vendor Score itself shows stays visible, per section 5's own
  // INNER-JOIN-elimination gate, unchanged from SCORE-SIM-03).
  //
  // comparableScoreRows: calcScores() output for the COMPARABLE window
  // ONLY (section 6/8) -- SAME calcScores()/SAME real RPC/SAME
  // exclusions, just a second read with different p_start/p_end (or
  // literally the SAME array reference as scoreRowsOriginal when
  // coverage.sameAsOriginal is true -- see score.js). THIS is the only
  // source used for vendas/financiamentos/penetração below -- section
  // 6's own fix: the original period's totals (which may start before
  // the telemetry epoch) are NEVER used as F/G/H's numerator/
  // denominator once a comparable-window adjustment was needed, closing
  // exactly the numerator/denominator window mismatch SCORE-SIM-03 had.
  //
  // usageLinhas: master_simulator_usage_data(...).linhas for the
  // comparable telemetry window, raw.
  //
  // coverage: resolveComparableWindow()'s own return value.
  //
  // usuarios (added for the direct-integration wave, tightened for the
  // final homologation wave -- section 4: "nenhuma atribuição de
  // utilização ou pontuação usa fallback por coincidência de nomes").
  // THREE-WAY on this parameter, not two:
  //   - omitted entirely (arguments.length < 5, usuarios === undefined):
  //     LEGACY mode -- only ever reached by callers that never adopted
  //     identity resolution at all (the pre-direct-integration-wave
  //     test suite's own 4-arg calls). Original name+dept join, zero is
  //     a real, valid "no usage" reading. Preserved BYTE-IDENTICAL for
  //     those callers only -- never reached from score.js's own real
  //     loadIntelligence() any more (see below).
  //   - explicit null (the identity source was ATTEMPTED and failed/is
  //     unreachable -- score.js's usuariosPromise resolves to null on
  //     any failure, never leaves the argument out): IDENTIDADE_
  //     INDISPONIVEL for every row -- utilization fields null ("—"),
  //     NEVER falls back to the name+dept join. This is the real
  //     tightening: previously a failed identity fetch silently
  //     degraded to name-matching, which IS a name-coincidence fallback
  //     and is no longer acceptable per this wave's own audit.
  //   - a real array: identity resolved per row via
  //     resolveVendorIdentityMap() (VINCULADO/AMBIGUO/
  //     SEM_VINCULO_COMPROVADO), exactly as before.
  function buildIntelligenceRows(scoreRowsOriginal, comparableScoreRows, usageLinhas, coverage, usuarios) {
    // Section 4 -- period entirely before the epoch: no comparable
    // window exists at all. Every row is marked NONE -- caller (score.js)
    // must render "Sem cobertura de telemetria para este período" and
    // skip every ratio/quadrant, NEVER a zero (a zero would silently
    // claim "the vendor didn't use it," which is unknowable/inapplicable
    // here, not observed).
    if (coverage && coverage.noCoverage) {
      return (scoreRowsOriginal || []).map(function (r) {
        return { vendedor: r.vendedor, loja: r.loja, dept: r.dept, coverage: 'NONE' };
      });
    }

    var legacyMode = (usuarios === undefined);
    var usageMap = legacyMode ? aggregateUsageByVendorDept(usageLinhas) : null;
    var identityMap = (!legacyMode && usuarios) ? resolveVendorIdentityMap(usuarios) : null;
    var usageByUsuarioId = identityMap ? aggregateUsageByUsuarioIdDept(usageLinhas) : null;
    var comparableMap = {};
    (comparableScoreRows || []).forEach(function (c) {
      comparableMap[usageKey(c.vendedor, c.dept)] = c;
    });
    var rowCoverage = (coverage && coverage.partialFirstDay) ? 'PARTIAL_FIRST_DAY' : 'FULL';

    return (scoreRowsOriginal || []).map(function (r) {
      var key = usageKey(r.vendedor, r.dept);

      var identityStatus = null; // null = legacy mode (no identity source supplied at all)
      var u = null;
      if (legacyMode) {
        u = usageMap[key] || null;
      } else if (!usuarios) {
        // Identity source attempted and unavailable -- never degrade to
        // name+dept here (that would be exactly the name-coincidence
        // fallback this wave's audit forbids).
        identityStatus = 'IDENTIDADE_INDISPONIVEL';
      } else {
        var idEntry = identityMap[identityKey(r.vendedor, r.loja)];
        identityStatus = !idEntry ? 'SEM_VINCULO_COMPROVADO' : (idEntry.ambiguous ? 'AMBIGUO' : 'VINCULADO');
        if (identityStatus === 'VINCULADO') {
          u = usageByUsuarioId[idEntry.usuarioId + '|' + r.dept] || null;
        }
      }

      // Section 3 (direct-integration wave) / section 4 (final
      // homologation wave): an unproven OR unavailable identity means
      // utilization is genuinely UNKNOWN for this row, not zero -- null
      // here (rendered "—"), never 0, distinct from a PROVEN identity
      // with real zero usage (u === null but identityStatus === 'VINCULADO').
      var identityUnprovable = identityStatus === 'AMBIGUO' || identityStatus === 'SEM_VINCULO_COMPROVADO' || identityStatus === 'IDENTIDADE_INDISPONIVEL';
      var sessions = identityUnprovable ? null : (u ? u.sessions : 0);
      var activeDays = identityUnprovable ? null : (u ? u.activeDays : 0);
      var activeSeconds = identityUnprovable ? null : (u ? u.activeSeconds : 0);
      var simulations = identityUnprovable ? null : (u ? u.simulations : 0);

      // Vendas/financiamentos/penetração come EXCLUSIVELY from the
      // comparable-window commercial read -- a vendor absent from it
      // (real -- comparable window genuinely has no sale for them yet
      // calcScores() itself never creates a `by[]` entry with zero
      // activity) is correctly 0 here, NOT the original period's own
      // (window-mismatched) totals. These are Score's own commercial
      // numbers, never gated by utilization identity resolution.
      var c = comparableMap[key] || null;
      var vendas = c ? (Number(c.vendas) || 0) : 0;
      var fin = c ? (Number(c.fin) || 0) : 0;
      var penetracao = (c && typeof c.share === 'number' && isFinite(c.share)) ? c.share : null;

      return {
        vendedor: r.vendedor,
        loja: r.loja,
        dept: r.dept,
        coverage: rowCoverage,
        identityStatus: identityStatus,
        hasUsageMatch: identityUnprovable ? null : !!u,
        diasUtilizacao: activeDays,
        sessoes: sessions,
        tempoAtivoSegundos: activeSeconds,
        simulacoes: simulations,
        simulacoesPorDiaAtivo: (activeDays !== null && activeDays > 0) ? (simulations / activeDays) : null,
        vendas: vendas,
        financiamentos: fin,
        penetracao: penetracao,
        simulacoesPorVenda: (simulations !== null && vendas > 0) ? (simulations / vendas) : null,
        simulacoesPorFinanciamento: (simulations !== null && fin > 0) ? (simulations / fin) : null
      };
    });
  }

  // Section 12 -- descriptive-only quadrant labeling, department-scoped,
  // median split, minimum sample enforced, ties resolved by `>=` on the
  // median (documented, not hidden), NEVER exposed as a score/points/
  // significance claim. MIN_SAMPLE chosen defensively (SCORE-SIM-01's
  // own department populations were 26-38 in a comparable window --
  // 5 is a low floor purely to avoid a 1-2-person "quadrant" reading as
  // meaningful, not a statistically-derived threshold).
  var MIN_SAMPLE_FOR_QUADRANT = 5;

  function median(sortedVals) {
    if (!sortedVals.length) return 0;
    return sortedVals[Math.floor(sortedVals.length / 2)];
  }

  function computeQuadrantStats(intelRows) {
    var byDept = {};
    // Section 4 -- a row with coverage:'NONE' carries no simulacoes/
    // vendas/financiamentos at all (see buildIntelligenceRows above) and
    // must never enter a median/quadrant computation -- would silently
    // count as a phantom "0 uso, 0 resultado" data point it isn't. Same
    // reasoning for a row with an unprovable identity (simulacoes: null,
    // direct-integration wave) -- an unknown usage value can't sit inside
    // a numeric median any more than a missing one can.
    (intelRows || []).filter(function (r) { return r.coverage !== 'NONE' && r.simulacoes !== null; })
      .forEach(function (r) { (byDept[r.dept] = byDept[r.dept] || []).push(r); });
    var stats = {};
    Object.keys(byDept).forEach(function (dept) {
      var list = byDept[dept];
      if (list.length < MIN_SAMPLE_FOR_QUADRANT) {
        stats[dept] = { n: list.length, insufficientSample: true };
        return;
      }
      var usoVals = list.map(function (r) { return r.simulacoes; }).sort(function (a, b) { return a - b; });
      var resVals = list.map(function (r) { return r.vendas + r.financiamentos; }).sort(function (a, b) { return a - b; });
      stats[dept] = { n: list.length, insufficientSample: false, medianaUso: median(usoVals), medianaResultado: median(resVals) };
    });
    return stats;
  }

  var QUADRANT_LABELS = {
    ALTO_ALTO: 'ALTO USO / ALTO RESULTADO',
    ALTO_BAIXO: 'ALTO USO / BAIXO RESULTADO',
    BAIXO_ALTO: 'BAIXO USO / ALTO RESULTADO',
    BAIXO_BAIXO: 'BAIXO USO / BAIXO RESULTADO'
  };

  // Returns null when the department's sample is below MIN_SAMPLE_FOR_
  // QUADRANT (caller must render "amostra insuficiente", never guess a
  // quadrant from too few vendors) -- never a numeric score, never used
  // to sort/rank (Gate: quadrant is descriptive metadata only).
  function quadrantLabel(row, stats) {
    var s = stats && stats[row.dept];
    if (!s || s.insufficientSample) return null;
    var altoUso = row.simulacoes >= s.medianaUso;
    var altoResultado = (row.vendas + row.financiamentos) >= s.medianaResultado;
    if (altoUso && altoResultado) return QUADRANT_LABELS.ALTO_ALTO;
    if (altoUso && !altoResultado) return QUADRANT_LABELS.ALTO_BAIXO;
    if (!altoUso && altoResultado) return QUADRANT_LABELS.BAIXO_ALTO;
    return QUADRANT_LABELS.BAIXO_BAIXO;
  }

  window.NX_SCORE_INTELLIGENCE_VM = {
    MODULE_DEPT: MODULE_DEPT,
    TELEMETRY_EPOCH_FALLBACK_ISO: TELEMETRY_EPOCH_FALLBACK_ISO,
    resolveTelemetryEpoch: resolveTelemetryEpoch,
    dateOnlySP: dateOnlySP,
    resolveComparableWindow: resolveComparableWindow,
    aggregateUsageByVendorDept: aggregateUsageByVendorDept,
    aggregateUsageByUsuarioIdDept: aggregateUsageByUsuarioIdDept,
    resolveVendorIdentityMap: resolveVendorIdentityMap,
    buildIntelligenceRows: buildIntelligenceRows,
    computeQuadrantStats: computeQuadrantStats,
    quadrantLabel: quadrantLabel,
    MIN_SAMPLE_FOR_QUADRANT: MIN_SAMPLE_FOR_QUADRANT,
    _internal: { normalizeName: normalizeName, usageKey: usageKey, identityKey: identityKey, maxIso: maxIso }
  };
})();
