// SCORE-SIM-11/12/13 -- EXPERIMENTAL, ISOLATED. NOT referenced by
// index.html, NOT wired into the operational simuladores or telemetry
// flow.
//
// SCORE-SIM-13 additions over SCORE-SIM-12:
//   - 3 remaining Seminovos engines: tradicionalSeminovos (own year-band
//     dimension, BALAO_SEMINOVOS batch), linearRateTableSeminovos (own
//     pmt()-based formula + fee/IOF structure, FINANCIAMENTO_SEMINOVO
//     batch), semestralTritonSeminovos (confirmed reachable in real V1
//     production -- real markup + nav button -- but confirmed to have
//     NO SB_LOADER call in the real source: 100% hardcoded, genuinely
//     different formula from Novos' version -- flat 60% entry, full
//     rebateTotal subtracted, only 5 Triton models, no Outlander).
//   - Tri-state event model, explicit per section 4 of SCORE-SIM-13:
//     CALCULO_VALIDO (event.calculoValido) = the server's own
//     reexecution produced a genuine numeric result, independent of
//     batch legitimacy/idempotency/operational reachability;
//     EVENTO_ELEGIVEL (event.eligibleForScore, as before) = CALCULO_
//     VALIDO AND every integrity check (batch vigência, idempotency,
//     session) passes; UTILIZACAO_COMPROVADA = EVENTO_ELEGIVEL AND the
//     engine is operationally reachable in the V2 port TODAY. Only
//     semestralTritonSeminovos sets `operationallyReachable: false` --
//     it can produce a genuine CALCULO_VALIDO (the real formula runs
//     correctly) and even pass every integrity check, but
//     eligibleForScore is force-set false with reject_reason
//     'UTILIZACAO_NAO_COMPROVADA_V2_NAO_EXPOSTO', because no reachable
//     V2 operation exists for this engine yet (confirmed in SCORE-SIM-
//     12/V2-GOLIVE-01: real in V1, absent from V2's simulador-
//     seminovos.js MODES list). This is deliberate, per this wave's own
//     instruction: never declare utilização elegível for an operation
//     that doesn't exist yet.
//
// SUPERSEDES the "challenge" approach from SCORE-SIM-09/10 for
// eligibility. SCORE-SIM-10 proved (adversarially, empirically) that a
// server-issued challenge only proves a two-step round-trip occurred --
// never that a genuine calculation happened. This module closes that
// gap by having the server PERFORM the calculation itself, using the
// REAL, unmodified, already parity-tested pure engine functions
// (window.NX_SIMULADOR_NOVOS_ADAPTER / NX_SIMULADOR_SEMINOVOS_ADAPTER /
// NX_CAMPANHA_ADAPTER), fed with non-personal client-declared inputs
// plus a batch_id identifying a REAL, previously-published rate table
// (public.simulador_base_batches in production). The client's own
// displayed result is NEVER trusted or even read by this module.
//
// SCORE-SIM-12 additions over SCORE-SIM-11:
//   - batch VIGÊNCIA: a batch is now tracked with a status (ACTIVE /
//     SUPERSEDED) and an activation window, resolved at submission
//     time -- a superseded or not-yet-active batch is rejected
//     distinctly from an unknown one (see resolveBatch()).
//   - 5 more Novos engines: descobridor, subsidiadas, antecipacao,
//     semestralTriton, campanha (bringing Novos to 9/9).
//   - 2 reused Seminovos engines: descobridorSeminovos,
//     antecipacaoSeminovos (SCORE-SIM-12 confirmed these formulas are
//     byte-identical to Novos', per direct diff in a prior wave,
//     reconfirmed by this wave's own reading of both adapter files).
//   - Seminovos' OWN Tradicional/LinearRateTable/SemestralTriton are
//     NOT implemented here (genuinely different formulas/tables) --
//     documented contract only, see the SCORE-SIM-12 report.
//
// SCORE-SIM-29 addition:
//   - cashConversion: one canonical engine id, shared identically by
//     Novos and Seminovos (window.NX_CASH_CONVERSION_ADAPTER, confirmed
//     the SAME adapter instance backs both simulators' #nCalc/#sCalc
//     handlers). No batch dependency, no personal data. Its real,
//     frozen contract returns `null` (not {error}) for invalid input --
//     normalized to {error:'PARAMETROS_INVALIDOS'} at runEngine()'s own
//     dispatch boundary, never inside cash-conversion.adapter.js
//     itself. See SCORE-SIM-29 report for paridade financeira evidence.

const ENGINE_CONTRACTS = {
  tradicional: {
    family: 'novos', tipoBase: 'BALAO_ZEROKM',
    numericKeys: ['bem', 'entrada', 'prazo'], optionalArrayKey: 'baloes', requiresBatch: true,
  },
  periodico: {
    family: 'novos', tipoBase: 'BALAO_ZEROKM',
    numericKeys: ['bem', 'entrada', 'prazo'], enumKeys: { tipo: ['semestral', 'anual'] }, requiresBatch: true,
  },
  linear: {
    family: 'novos', tipoBase: 'LINEAR_ZEROKM',
    numericKeys: ['bem', 'entrada'], requiresBatch: true,
  },
  parcelaUnica: {
    family: 'novos', tipoBase: null,
    numericKeys: ['bem', 'entrada'], requiresBatch: false,
  },
  descobridor: {
    family: 'novos', tipoBase: null,
    numericKeys: ['financiado', 'prazo', 'parcela'], requiresBatch: false,
  },
  subsidiadas: {
    family: 'novos', tipoBase: 'TAXAS_SUBSIDIADAS',
    numericKeys: ['bem', 'entrada', 'minVenda'], requiresBatch: true,
  },
  antecipacao: {
    family: 'novos', tipoBase: 'ANTECIPACAO',
    numericKeys: ['prazo', 'parcela'], optionalNumericKeys: ['de', 'ate', 'parcelaUnica'],
    dateKeys: ['primeiraParcela', 'dataAntecipacao'], enumKeys: { tipo: ['todo', 'algumas', 'uma'] },
    optionalArrayKey: 'baloes', requiresBatch: true,
  },
  semestralTriton: {
    family: 'novos', tipoBase: 'SEMESTRAL_TRITON_OUTLANDER',
    numericKeys: ['bem'], modeloKey: 'modelo', requiresBatch: true, dynamicModel: true,
  },
  campanha: {
    family: 'campanha', dualBatch: true, tipoBaseModels: 'COPARTICIPADO', tipoBaseCoef: 'COEFICIENTES_COPARTICIPADO',
    numericKeys: ['saleValue', 'entryValue'], modeloKey: 'model', requiresBatch: true, dynamicModel: true,
  },
  descobridorSeminovos: {
    family: 'seminovos', tipoBase: null,
    numericKeys: ['financiado', 'prazo', 'parcela'], requiresBatch: false,
  },
  antecipacaoSeminovos: {
    family: 'seminovos', tipoBase: 'ANTECIPACAO', // confirmed shared with Novos -- same RPC/batch, per source comment "Base COMPARTILHADA com o Simulador Seminovos"
    numericKeys: ['prazo', 'parcela'], optionalNumericKeys: ['de', 'ate', 'parcelaUnica'],
    dateKeys: ['primeiraParcela', 'dataAntecipacao'], enumKeys: { tipo: ['todo', 'algumas', 'uma'] },
    optionalArrayKey: 'baloes', requiresBatch: true,
  },
  tradicionalSeminovos: {
    family: 'seminovos', tipoBase: 'BALAO_SEMINOVOS',
    numericKeys: ['bem', 'entrada', 'prazo'], yearKeys: ['ano'], optionalArrayKey: 'baloes', requiresBatch: true,
  },
  linearRateTableSeminovos: {
    family: 'seminovos', tipoBase: 'FINANCIAMENTO_SEMINOVO',
    numericKeys: ['valor', 'entrada'], yearKeys: ['ano'], requiresBatch: true,
  },
  semestralTritonSeminovos: {
    family: 'seminovos', tipoBase: null,
    numericKeys: ['bem'],
    enumKeys: { modelo: ['TRITON HPE', 'TRITON HPE-S', 'TRITON KATANA', 'TRITON SAVANA', 'TRITON TERRA'] },
    requiresBatch: false,
    // Real, reachable in V1 production (confirmed markup + nav button),
    // but NOT exposed anywhere in the V2 port -- see header note.
    operationallyReachable: false,
  },
  // SCORE-SIM-29 -- Cash Conversion, shared identically between Novos
  // and Seminovos (confirmed by direct reading: both #nCalc/#sCalc
  // click handlers call the exact same window.NX_CASH_CONVERSION_
  // ADAPTER.compute(), assets/js/adapters/cash-conversion.adapter.js,
  // a byte-identical extraction from origin/main:assets/js/cash-
  // conversion.js -- one canonical engine id covers both simulator
  // screens, no Novos/Seminovos formula divergence exists here the way
  // it does for tradicional/tradicionalSeminovos). Pure, no personal
  // data, no batch/rate-table dependency (capital/parcela/prazoMeses/
  // taxaAplicacao are all user-declared inputs the real engine itself
  // takes with zero external lookup), family:'shared' distinguishes it
  // from the family:'novos'/'seminovos'/'campanha' engines above at the
  // contract-catalog level without implying it needs its own
  // Novos/Seminovos pair the way those families do.
  cashConversion: {
    family: 'shared', tipoBase: null,
    numericKeys: ['capital', 'parcela', 'prazoMeses', 'taxaAplicacao'], requiresBatch: false,
  },
};

const PERSONAL_DATA_SHAPE_RE = /^\d{11}$/; // CPF/phone-shaped bare digit runs -- never allowed in any param value
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

function validateParams(engineId, params) {
  const contract = ENGINE_CONTRACTS[engineId];
  if (!contract) return { ok: false, reason: 'ENGINE_DESCONHECIDO' };
  if (!params || typeof params !== 'object') return { ok: false, reason: 'PAYLOAD_INVALIDO' };

  const allowedKeys = new Set(contract.numericKeys);
  (contract.optionalNumericKeys || []).forEach((k) => allowedKeys.add(k));
  if (contract.optionalArrayKey) allowedKeys.add(contract.optionalArrayKey);
  if (contract.enumKeys) Object.keys(contract.enumKeys).forEach((k) => allowedKeys.add(k));
  if (contract.dateKeys) contract.dateKeys.forEach((k) => allowedKeys.add(k));
  if (contract.modeloKey) allowedKeys.add(contract.modeloKey);
  if (contract.yearKeys) contract.yearKeys.forEach((k) => allowedKeys.add(k));

  for (const key of Object.keys(params)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: 'CAMPO_NAO_PERMITIDO:' + key };
  }
  for (const key of contract.numericKeys) {
    if (!isFiniteNumber(params[key])) return { ok: false, reason: 'CAMPO_NUMERICO_INVALIDO:' + key };
  }
  for (const key of contract.optionalNumericKeys || []) {
    if (params[key] !== undefined && !isFiniteNumber(params[key])) return { ok: false, reason: 'CAMPO_NUMERICO_INVALIDO:' + key };
  }
  if (contract.enumKeys) {
    for (const key of Object.keys(contract.enumKeys)) {
      if (!contract.enumKeys[key].includes(params[key])) return { ok: false, reason: 'CAMPO_ENUM_INVALIDO:' + key };
    }
  }
  for (const key of contract.dateKeys || []) {
    if (typeof params[key] !== 'string' || !ISO_DATE_RE.test(params[key])) return { ok: false, reason: 'CAMPO_DATA_INVALIDO:' + key };
    const d = new Date(params[key] + 'T00:00:00');
    if (isNaN(d.getTime())) return { ok: false, reason: 'CAMPO_DATA_INVALIDO:' + key };
  }
  for (const key of contract.yearKeys || []) {
    // Vehicle model year -- a plain 4-digit integer, never personal
    // data, but still range-checked (1990-2099) rather than accepted
    // as any finite number.
    if (!Number.isInteger(params[key]) || params[key] < 1990 || params[key] > 2099) return { ok: false, reason: 'CAMPO_ANO_INVALIDO:' + key };
  }
  if (contract.modeloKey) {
    const v = params[contract.modeloKey];
    // Non-personal-shaped, non-empty product/model label only -- never
    // validated against a static list here (the real allowed set is
    // whatever the resolved batch publishes, checked after batch
    // resolution -- see resolveDynamicModel()).
    if (typeof v !== 'string' || !v || PERSONAL_DATA_SHAPE_RE.test(v.replace(/\D/g, ''))) return { ok: false, reason: 'CAMPO_MODELO_INVALIDO' };
  }
  if (contract.optionalArrayKey && params[contract.optionalArrayKey] !== undefined) {
    const arr = params[contract.optionalArrayKey];
    if (!Array.isArray(arr)) return { ok: false, reason: 'CAMPO_ARRAY_INVALIDO:' + contract.optionalArrayKey };
    for (const item of arr) {
      if (!item || typeof item !== 'object') return { ok: false, reason: 'ITEM_ARRAY_INVALIDO' };
      const itemKeys = Object.keys(item);
      if (itemKeys.some((k) => k !== 'mes' && k !== 'valor')) return { ok: false, reason: 'CAMPO_ITEM_NAO_PERMITIDO' };
      if (!isFiniteNumber(item.mes) || !isFiniteNumber(item.valor)) return { ok: false, reason: 'ITEM_ARRAY_NAO_NUMERICO' };
    }
  }
  // Defense in depth against a raw CPF/phone typed into a numeric field.
  for (const key of contract.numericKeys.concat(contract.optionalNumericKeys || [])) {
    if (params[key] !== undefined && PERSONAL_DATA_SHAPE_RE.test(String(Math.trunc(params[key])))) {
      return { ok: false, reason: 'VALOR_COM_FORMATO_DE_DADO_PESSOAL:' + key };
    }
  }
  return { ok: true };
}

function mapBatchRowsForEngine(engineId, tipoBase, linhas) {
  if (engineId === 'tradicional') return linhas.filter((r) => r.bloco === 'TRADICIONAL').map((r) => ({ entrada: r.entrada_minima, prazo: r.prazo, max: r.max_balao, taxa: r.taxa }));
  if (engineId === 'periodico') return linhas.filter((r) => r.bloco === 'SEMESTRAL_ANUAL').map((r) => ({ entrada: r.entrada_minima, prazo: r.prazo, max: r.max_balao, taxa: r.taxa }));
  if (engineId === 'linear') return linhas.map((r) => ({ prazo: r.prazo, entrada: r.entrada_pct, taxa: r.taxa }));
  if (engineId === 'subsidiadas') return linhas.map((r) => ({ prazo: r.prazo, taxa: r.taxa, coef: r.coeficiente, rebate: r.rebate }));
  if (engineId === 'antecipacao' || engineId === 'antecipacaoSeminovos') {
    const mapa = {};
    linhas.forEach((r) => { mapa[String(r.meses_antecipacao)] = r.desconto; });
    return mapa;
  }
  if (engineId === 'semestralTriton') {
    const mapa = {};
    linhas.forEach((r) => { mapa[r.modelo] = { rebateTotal: r.rebate_total, hpeShare: r.rebate_hpe, brabusShare: r.rebate_brabus, entradaMinima: r.entrada_minima }; });
    return mapa;
  }
  if (engineId === 'tradicionalSeminovos') {
    return linhas.map((r) => ({ faixa: r.bloco, entrada: r.entrada_minima, prazo: r.prazo, max: r.max_balao, taxa: r.taxa }));
  }
  if (engineId === 'linearRateTableSeminovos') {
    // Mirrors the real loader's own mapping exactly (carregarBaseFinanciamentoSeminovo):
    // faixa_ano -> String(round(entrada_pct*100)) -> String(prazo) -> taxa.
    const tabela = {};
    linhas.forEach((r) => {
      const eBand = String(Math.round(r.entrada_pct * 100));
      if (!tabela[r.faixa_ano]) tabela[r.faixa_ano] = {};
      if (!tabela[r.faixa_ano][eBand]) tabela[r.faixa_ano][eBand] = {};
      tabela[r.faixa_ano][eBand][String(r.prazo)] = r.taxa;
    });
    return tabela;
  }
  return linhas;
}

function parseISODate(s) { return s ? new Date(s + 'T00:00:00') : null; }

function buildAntecipacaoParams(params, batchTable) {
  return {
    prazo: params.prazo, parcela: params.parcela,
    primeiraParcela: parseISODate(params.primeiraParcela), dataAntecipacao: parseISODate(params.dataAntecipacao),
    tipo: params.tipo, baloes: params.baloes || [],
    de: params.de, ate: params.ate, parcelaUnica: params.parcelaUnica,
    tabelaAntecipacao: batchTable,
  };
}

function buildCampanhaParams(params, dualTable) {
  const modelRows = dualTable.modelRows.filter((r) => r.modelo === params.model);
  const rates = {};
  modelRows.forEach((r) => { rates[r.prazo] = r.taxa; });
  const first = modelRows[0];
  // Unresolvable model (should never reach here -- resolveDynamicModel
  // rejects it earlier) falls back to entry:1 (100% minimum entry),
  // which structurally forces `valid=false` in calcularCampanha rather
  // than silently defaulting to a REAL model's numbers.
  const modelOverride = first
    ? { name: params.model, entry: first.entrada_minima, rebate: first.rebate_total, hpe: first.rebate_hpe, brabus: first.rebate_brabus, rates }
    : { name: params.model, entry: 1, rebate: 0, hpe: 0, brabus: 0, rates: {} };
  const coefRows = dualTable.coefRows;
  const coefLookup = (p, t) => {
    const row = coefRows.find((r) => r.prazo === p && Math.abs(r.taxa - t) < 0.0000001);
    return row ? row.coeficiente : null;
  };
  return { model: params.model, saleValue: params.saleValue, entryValue: params.entryValue, modelOverride, coefLookup };
}

// Executes the REAL pure engine function (never reimplemented here).
function runEngine(adapters, engineId, params, batchTable) {
  const novos = adapters.novos, seminovos = adapters.seminovos, campanha = adapters.campanha;
  // SCORE-SIM-29 -- adapters.cashConversion is new (window.
  // NX_CASH_CONVERSION_ADAPTER); every existing caller of runEngine()
  // that never uses this engine is unaffected (undefined until this
  // one branch is reached, exactly like campanha was for callers that
  // never exercise it).
  if (engineId === 'cashConversion') {
    // calcularCashConversion()'s own real, frozen contract returns
    // `null` (not an {error:...} object) for invalid input -- normalized
    // here, at the dispatch boundary, into the same {error} shape every
    // other engine already uses, WITHOUT touching cash-conversion.
    // adapter.js's byte-identical extraction.
    const result = adapters.cashConversion.compute({ capital: params.capital, parcela: params.parcela, prazoMeses: params.prazoMeses, taxaAplicacao: params.taxaAplicacao });
    return result || { error: 'PARAMETROS_INVALIDOS' };
  }
  if (engineId === 'tradicional') return novos.calcularTradicional({ bem: params.bem, entrada: params.entrada, prazo: params.prazo, baloes: params.baloes || [], tabelaTradicional: batchTable });
  if (engineId === 'periodico') return novos.calcularPeriodico({ bem: params.bem, entrada: params.entrada, prazo: params.prazo, tipo: params.tipo, tabelaPeriodica: batchTable });
  if (engineId === 'linear') return novos.calcularLinear({ bem: params.bem, entrada: params.entrada, tabelaLinear: batchTable });
  if (engineId === 'parcelaUnica') return novos.calcularParcelaUnica({ bem: params.bem, entrada: params.entrada });
  if (engineId === 'descobridor') return novos.calcularDescobridor({ financiado: params.financiado, prazo: params.prazo, parcela: params.parcela });
  if (engineId === 'subsidiadas') return novos.calcularSubsidiadas({ bem: params.bem, entrada: params.entrada, minVenda: params.minVenda, tabelaRebates: batchTable });
  if (engineId === 'antecipacao') return novos.calcularAntecipacao(buildAntecipacaoParams(params, batchTable));
  if (engineId === 'semestralTriton') return novos.calcularSemestralTriton({ bem: params.bem, modelo: params.modelo, modelosTriton: batchTable });
  if (engineId === 'campanha') return campanha.compute(buildCampanhaParams(params, batchTable));
  if (engineId === 'descobridorSeminovos') return seminovos.calcularDescobridor({ financiado: params.financiado, prazo: params.prazo, parcela: params.parcela });
  if (engineId === 'antecipacaoSeminovos') return seminovos.calcularAntecipacao(buildAntecipacaoParams(params, batchTable));
  if (engineId === 'tradicionalSeminovos') return seminovos.calcularTradicional({ bem: params.bem, entrada: params.entrada, prazo: params.prazo, ano: params.ano, baloes: params.baloes || [], tabelaTradicional: batchTable });
  if (engineId === 'linearRateTableSeminovos') return seminovos.calcularLinearRateTable({ ano: params.ano, valor: params.valor, entrada: params.entrada, rateTable: batchTable });
  if (engineId === 'semestralTritonSeminovos') return seminovos.calcularSemestralTriton({ bem: params.bem, modelo: params.modelo });
  return { error: 'ENGINE_NAO_IMPLEMENTADO' };
}

function createCalculationProofStore() {
  return {
    telemetryEnabled: true,
    sessions: new Map(), // sessionId -> { usuarioId, endedAt, simulationCount }
    batches: new Map(), // `${tipoBase}::${batchId}` -> { linhas, status, activatedAt, supersededAt }
    events: new Map(), // `${sessionId}::${idempotencyKey}` -> event row
    _nextId: 1,
  };
}

function seedSession(store, sessionId, { usuarioId, endedAt = null, simulationCount = 0 }) {
  store.sessions.set(sessionId, { usuarioId, endedAt, simulationCount });
}

// Registers a batch snapshot with VIGÊNCIA metadata -- mirrors a real
// row in public.simulador_base_batches: status ('ACTIVE'|'SUPERSEDED'),
// activatedAt (when it became usable) and supersededAt (when a NEWER
// batch for the same tipo_base replaced it, null while still current).
function seedBatch(store, tipoBase, batchId, linhas, opts) {
  opts = opts || {};
  store.batches.set(`${tipoBase}::${batchId}`, {
    tipoBase, linhas,
    status: opts.status || 'ACTIVE',
    activatedAt: opts.activatedAt != null ? opts.activatedAt : -Infinity,
    supersededAt: opts.supersededAt != null ? opts.supersededAt : null,
  });
}

// Marks an existing batch SUPERSEDED and registers its replacement as
// ACTIVE -- models "lote substituído durante uma sessão em andamento":
// any calculation submitted with the OLD batch_id after this point is
// rejected (LOTE_SUBSTITUIDO), even if a client cached it earlier in
// the same session. The server's live state always wins.
function supersedeBatch(store, tipoBase, oldBatchId, newBatchId, newLinhas, now) {
  const oldKey = `${tipoBase}::${oldBatchId}`;
  const old = store.batches.get(oldKey);
  if (old) { old.status = 'SUPERSEDED'; old.supersededAt = now; }
  seedBatch(store, tipoBase, newBatchId, newLinhas, { activatedAt: now });
}

// Resolves a batch for a given (tipoBase, batchId) at time `now`,
// distinguishing every failure mode explicitly -- never collapsing
// "doesn't exist" / "wrong type" / "not yet active" / "superseded"
// into one generic error, since each implies a different adversarial
// scenario (see SCORE-SIM-12 report section 7).
function resolveBatch(store, tipoBase, batchId, now) {
  const entry = store.batches.get(`${tipoBase}::${batchId}`);
  if (!entry) {
    // Could be genuinely unknown, OR a real batch_id that exists but
    // for a DIFFERENT tipo_base -- check the latter to give a precise reason.
    for (const [k, v] of store.batches) {
      if (k.endsWith(`::${batchId}`) && v.tipoBase !== tipoBase) return { ok: false, reason: 'LOTE_TIPO_INCORRETO' };
    }
    return { ok: false, reason: 'LOTE_DESCONHECIDO' };
  }
  if (now < entry.activatedAt) return { ok: false, reason: 'LOTE_FORA_DA_VIGENCIA' };
  if (entry.status === 'SUPERSEDED') return { ok: false, reason: 'LOTE_SUBSTITUIDO' };
  if (entry.supersededAt != null && now >= entry.supersededAt) return { ok: false, reason: 'LOTE_FORA_DA_VIGENCIA' };
  if (entry.status !== 'ACTIVE') return { ok: false, reason: 'LOTE_NAO_ATIVO' };
  return { ok: true, linhas: entry.linhas };
}

function nextId(store, prefix) { return `${prefix}-${store._nextId++}`; }

function findSessionForCaller(store, sessionId, callerUserId) {
  const session = store.sessions.get(sessionId);
  if (!session || session.usuarioId !== callerUserId) return null;
  return session;
}

// For engines whose allowed "model" value is defined by the resolved
// batch itself (Semestral Triton, Campanha) rather than a static
// enum -- a model name not present in the ACTUAL resolved batch is
// rejected, never silently mapped to a default real model.
function resolveDynamicModel(engineId, params, resolvedTable) {
  const contract = ENGINE_CONTRACTS[engineId];
  const modelo = params[contract.modeloKey];
  if (engineId === 'semestralTriton') {
    return Object.prototype.hasOwnProperty.call(resolvedTable, modelo) ? { ok: true } : { ok: false, reason: 'MODELO_DESCONHECIDO_NO_LOTE' };
  }
  if (engineId === 'campanha') {
    return resolvedTable.modelRows.some((r) => r.modelo === modelo) ? { ok: true } : { ok: false, reason: 'MODELO_DESCONHECIDO_NO_LOTE' };
  }
  return { ok: true };
}

// Simulates the proposed portal_telemetry_calculation_proof_v1() RPC.
// `adapters` = { novos, seminovos, campanha } -- the REAL
// window.NX_SIMULADOR_*_ADAPTER objects, passed in explicitly so this
// module never assumes a global and stays independently testable.
function submitCalculationEvent(store, adapters, { sessionId, callerUserId, idempotencyKey, engineId, batchId, params, now = Date.now() }) {
  if (!store.telemetryEnabled) return { ok: true, enabled: false };

  const session = findSessionForCaller(store, sessionId, callerUserId);
  if (!session) return { ok: false, codigo: 'SESSAO_INVALIDA' };
  if (session.endedAt !== null) return { ok: false, codigo: 'SESSAO_ENCERRADA' };

  if (!/^[0-9a-f-]{16,64}$/.test(String(idempotencyKey || ''))) return { ok: false, codigo: 'PAYLOAD_INVALIDO' };

  const contract = ENGINE_CONTRACTS[engineId];
  if (!contract) return { ok: false, codigo: 'ENGINE_DESCONHECIDO' };

  const validation = validateParams(engineId, params);
  if (!validation.ok) return { ok: false, codigo: 'PAYLOAD_INVALIDO', detalhe: validation.reason };

  if (contract.requiresBatch && !batchId) return { ok: false, codigo: 'LOTE_OBRIGATORIO' };
  if (!contract.requiresBatch && batchId) return { ok: false, codigo: 'LOTE_INESPERADO' };

  // ---- Atomic idempotency ----
  const key = `${sessionId}::${idempotencyKey}`;
  let event = store.events.get(key);
  if (event) {
    return { ok: true, status: 'DUPLICATE', eventId: event.id, validated: event.validated, calculoValido: event.calculoValido, eligibleForScore: event.eligibleForScore, rejectReason: event.rejectReason, resultado: event.resultado };
  }
  event = { id: nextId(store, 'evt'), sessionId, usuarioId: callerUserId, engineId, batchId: batchId || null, receivedAt: now, validated: false, calculoValido: false, eligibleForScore: false, rejectReason: null, resultado: null };
  store.events.set(key, event);
  // ---- End critical section ----

  session.simulationCount += 1; // legacy counter, unconditional on every NEW event (SCORE-SIM-09/10/11 contract preserved)
  event.validated = true;

  let batchTable = null;
  if (contract.requiresBatch) {
    if (contract.dualBatch) {
      const [modelsBatchId, coefBatchId] = String(batchId).split('|');
      const modelsRes = resolveBatch(store, contract.tipoBaseModels, modelsBatchId, now);
      if (!modelsRes.ok) { event.rejectReason = modelsRes.reason; return finalize(event); }
      const coefRes = resolveBatch(store, contract.tipoBaseCoef, coefBatchId, now);
      if (!coefRes.ok) { event.rejectReason = coefRes.reason; return finalize(event); }
      batchTable = { modelRows: modelsRes.linhas, coefRows: coefRes.linhas };
    } else {
      const res = resolveBatch(store, contract.tipoBase, batchId, now);
      if (!res.ok) { event.rejectReason = res.reason; return finalize(event); }
      batchTable = mapBatchRowsForEngine(engineId, contract.tipoBase, res.linhas);
    }
    if (contract.dynamicModel) {
      const modelCheck = resolveDynamicModel(engineId, params, batchTable);
      if (!modelCheck.ok) { event.rejectReason = modelCheck.reason; return finalize(event); }
    }
  }

  // ---- THE decisive step: the server performs the REAL calculation
  // itself, from validated inputs and a real, in-force batch. ----
  const result = runEngine(adapters, engineId, params, batchTable);

  if (result.empty) {
    event.rejectReason = 'CALCULO_VAZIO';
  } else if (result.error) {
    event.rejectReason = 'CALCULO_REJEITADO:' + result.error;
  } else if (result.invalid === true) {
    // Campanha's own shape: {valid:false/invalid:true} instead of {error}
    event.rejectReason = 'CALCULO_REJEITADO:ENTRADA_ABAIXO_DO_MINIMO';
  } else {
    // CALCULO_VALIDO: the real formula produced a genuine numeric
    // result. This is tracked independently of eligibility (section 4,
    // SCORE-SIM-13) -- a calculation can be entirely valid and still
    // not count as EVENTO_ELEGIVEL/UTILIZACAO_COMPROVADA if the
    // engine isn't operationally reachable in V2 today.
    event.calculoValido = true;
    event.resultado = result;
    if (contract.operationallyReachable === false) {
      // UTILIZACAO_COMPROVADA gate: never declare eligibility for an
      // operation that has no reachable V2 path yet (this wave's own
      // instruction). validated=true and calculoValido=true both stay
      // true -- only eligibleForScore is withheld, with an explicit,
      // distinguishable reason (never silently merged with a real
      // integrity failure).
      event.rejectReason = 'UTILIZACAO_NAO_COMPROVADA_V2_NAO_EXPOSTO';
    } else {
      event.eligibleForScore = true;
    }
  }

  return finalize(event);

  function finalize(ev) {
    return { ok: true, status: 'ACCEPTED', eventId: ev.id, validated: ev.validated, calculoValido: ev.calculoValido, eligibleForScore: ev.eligibleForScore, rejectReason: ev.rejectReason, resultado: ev.resultado };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENGINE_CONTRACTS, validateParams, mapBatchRowsForEngine, runEngine, createCalculationProofStore, seedSession, seedBatch, supersedeBatch, resolveBatch, submitCalculationEvent };
}
if (typeof window !== 'undefined') {
  window.ScoreCalculationProofExperimental = { ENGINE_CONTRACTS, validateParams, mapBatchRowsForEngine, runEngine, createCalculationProofStore, seedSession, seedBatch, supersedeBatch, resolveBatch, submitCalculationEvent };
}
