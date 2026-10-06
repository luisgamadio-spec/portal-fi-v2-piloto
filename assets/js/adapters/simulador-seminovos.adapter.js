/* PORTAL-NEXT V2 — Simulador Seminovos Adapter (Gate 24/25: PURE
   re-derivation of DOM-coupled production engines).
   SOURCE: git show origin/main:modules/simulador-seminovos.html
   (portal-financiamento-brabus-secure) — see
   docs/SIMULATOR-ENGINE-DISCOVERY-08.md for the full discovery.

   Same rationale as simulador-novos.adapter.js: production's
   functions read/write DOM directly (Blocker #5), so each function
   here is a faithful PURE re-derivation, verified for parity against
   the real, unmodified, DOM-coupled originals (driven in a real
   browser against the saved origin/main HTML, zero network) by
   tests/simulador-seminovos-parity-test.py. ACTIVE-base loading is
   NOT reproduced — every table is the FALLBACK/hardcoded table exactly
   as in source (Gate 9); 0 backend this Wave (Gate 21).

   Gate 22/49 note: calcularAntecipacao/calcularDescobridor below are
   BYTE-IDENTICAL in formula AND data to their Novos counterparts
   (confirmed via direct diff this Wave) but are kept as separate,
   independently-tested local functions rather than merged into
   simulador-shared.adapter.js, to avoid touching the already-verified
   Novos adapter under this Wave's time constraints — see the
   discovery doc's Gate 49 "PARTIALLY shareable" list for the full,
   honest accounting of what could additionally be shared.

   SIMLIVE1 (migrate simulator live rate authorities): calcularTradicional
   (simulador_get_balao_seminovos), calcularLinearRateTable
   (simulador_get_financiamento_seminovo) and calcularAntecipacao
   (simulador_get_antecipacao, shared with Novos) now accept an optional
   live-table override param (tabelaTradicional/rateTable/
   tabelaAntecipacao); omitted, they default to the unchanged _FALLBACK
   constant, exactly like Novos' adapter (see that file's own SIMLIVE1
   note) — tests/simulador-seminovos-parity-test.py keeps calling these
   with no override and keeps passing unmodified. calcularLinear (dead
   top-level Linear tab), calcularSubsidiadas and the Triton campaign
   below are UNCHANGED: none of them is reachable from
   simulador-seminovos.js's own MODES list (confirmed — only
   tradicional/ratetable/descobridor/antecipacao/cashconversion exist),
   matching V1 itself never exposing Taxas Subsidiadas/Semestral
   Triton-Outlander to Seminovos users (V1_STATIC_AUTHORITY_CONFIRMED /
   NOT_APPLICABLE — nothing to migrate). */
(function () {
  'use strict';

  const S = window.NX_SIMULADOR_SHARED;

  // ==== Tradicional (Balão) — requires a vehicle year band, unlike Novos ====
  const tabelaTradicional_FALLBACK = [{"faixa":"2017_2024","entrada":0.2,"prazo":12,"max":0.7,"taxa":0.024485999999999997},{"faixa":"2017_2024","entrada":0.2,"prazo":24,"max":0.7,"taxa":0.0209055},{"faixa":"2017_2024","entrada":0.2,"prazo":30,"max":0.7,"taxa":0.0204435},{"faixa":"2017_2024","entrada":0.2,"prazo":36,"max":0.7,"taxa":0.019750500000000004},{"faixa":"2017_2024","entrada":0.2,"prazo":40,"max":0.7,"taxa":0.019403999999999998},{"faixa":"2017_2024","entrada":0.2,"prazo":42,"max":0.7,"taxa":0.019305},{"faixa":"2017_2024","entrada":0.2,"prazo":48,"max":0.7,"taxa":0.0192885},{"faixa":"2017_2024","entrada":0.4,"prazo":12,"max":0.7,"taxa":0.023372999999999998},{"faixa":"2017_2024","entrada":0.4,"prazo":24,"max":0.7,"taxa":0.01995525},{"faixa":"2017_2024","entrada":0.4,"prazo":30,"max":0.7,"taxa":0.01951425},{"faixa":"2017_2024","entrada":0.4,"prazo":36,"max":0.7,"taxa":0.01885275},{"faixa":"2017_2024","entrada":0.4,"prazo":40,"max":0.7,"taxa":0.018522},{"faixa":"2017_2024","entrada":0.4,"prazo":42,"max":0.7,"taxa":0.0184275},{"faixa":"2017_2024","entrada":0.4,"prazo":48,"max":0.7,"taxa":0.018411749999999998},{"faixa":"2025_2099","entrada":0.2,"prazo":12,"max":0.7,"taxa":0.023372999999999998},{"faixa":"2025_2099","entrada":0.2,"prazo":24,"max":0.7,"taxa":0.01995525},{"faixa":"2025_2099","entrada":0.2,"prazo":30,"max":0.7,"taxa":0.01951425},{"faixa":"2025_2099","entrada":0.2,"prazo":36,"max":0.7,"taxa":0.01885275},{"faixa":"2025_2099","entrada":0.2,"prazo":40,"max":0.7,"taxa":0.018522},{"faixa":"2025_2099","entrada":0.2,"prazo":42,"max":0.7,"taxa":0.0184275},{"faixa":"2025_2099","entrada":0.2,"prazo":48,"max":0.7,"taxa":0.018411749999999998},{"faixa":"2025_2099","entrada":0.4,"prazo":12,"max":0.7,"taxa":0.02226},{"faixa":"2025_2099","entrada":0.4,"prazo":24,"max":0.7,"taxa":0.019005},{"faixa":"2025_2099","entrada":0.4,"prazo":30,"max":0.7,"taxa":0.018585},{"faixa":"2025_2099","entrada":0.4,"prazo":36,"max":0.7,"taxa":0.017955000000000002},{"faixa":"2025_2099","entrada":0.4,"prazo":40,"max":0.7,"taxa":0.01764},{"faixa":"2025_2099","entrada":0.4,"prazo":42,"max":0.7,"taxa":0.01755},{"faixa":"2025_2099","entrada":0.4,"prazo":48,"max":0.7,"taxa":0.017535}];

  function faixaAnoTrad(ano) {
    ano = Number(ano) || 0;
    if (ano >= 2025 && ano <= 2099) return '2025_2099';
    if (ano >= 2017 && ano <= 2024) return '2017_2024';
    return null;
  }
  function planoTrad(prazo, pe, ano, tabela) {
    const faixa = faixaAnoTrad(ano);
    if (!faixa) return null;
    return (tabela || tabelaTradicional_FALLBACK).filter(r => r.faixa === faixa && r.prazo === prazo && pe >= r.entrada).sort((a, b) => b.entrada - a.entrada)[0] || null;
  }

  function calcularTradicional(params) {
    const bem = params.bem, entrada = params.entrada, prazo = params.prazo, ano = params.ano, baloes = params.baloes || [];
    const fin = Math.max(0, bem - entrada), pe = bem ? entrada / bem : 0;
    if (!bem) return {error: null, empty: true};
    if (pe < 0.1) return {error: 'ENTRADA_MINIMA_10PCT'};
    if (fin <= 0) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    const anoStr = String(ano || '').replace(/\D/g, '');
    if (!anoStr || anoStr.length < 4) return {error: 'ANO_AUSENTE'};
    const plano = planoTrad(prazo, pe, anoStr, params.tabelaTradicional);
    if (!plano) return {error: 'SEM_REGRA_CADASTRADA'};
    let total = 0;
    const meses = new Set();
    for (const b of baloes) {
      if (!b.mes || b.mes < 1 || b.mes > prazo) return {error: 'BALAO_FORA_DO_PRAZO'};
      if (meses.has(b.mes)) return {error: 'BALAO_DUPLICADO'};
      if (!(b.valor > 0)) return {error: 'BALAO_VALOR_INVALIDO'};
      meses.add(b.mes);
      total += b.valor;
    }
    const limite = fin * plano.max;
    if (total > limite + 1e-6) return {error: 'BALOES_ACIMA_DO_LIMITE', limite, total};
    const i = S.taxaInterna(plano.taxa), n = prazo, fator = (1 - Math.pow(1 + i, -n)) / i, base = S.baseInterna(fin);
    const vpBaloes = baloes.reduce((s, b) => s + b.valor / Math.pow(1 + i, b.mes), 0);
    const saldo = base - vpBaloes;
    if (saldo <= 0) return {error: 'BALOES_ALTOS_DEMAIS'};
    const parcela = saldo / fator;
    return {error: null, fin, pe, plano, taxa: plano.taxa, limite, totalBaloes: total, parcela};
  }

  // ==== Semestral/Anual (Periódico) ====
  const tabelaPeriodica = [{entrada: 0.2, prazo: 24, max: 1, taxa: 0.0199}, {entrada: 0.2, prazo: 36, max: 1, taxa: 0.0189}, {entrada: 0.2, prazo: 48, max: 1, taxa: 0.0183}];

  function calcularPeriodico(params) {
    const bem = params.bem, entrada = params.entrada, prazo = params.prazo, tipo = params.tipo;
    const fin = Math.max(0, bem - entrada), pe = bem ? entrada / bem : 0;
    if (!bem) return {error: null, empty: true};
    if (fin <= 0) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    const candidatos = tabelaPeriodica.filter(r => r.prazo === prazo);
    if (!candidatos.length) return {error: 'SEM_REGRA_CADASTRADA'};
    const minEntrada = Math.min(...candidatos.map(r => r.entrada));
    if (pe < minEntrada) return {error: 'ENTRADA_ABAIXO_DO_MINIMO', minEntrada};
    const plano = candidatos.filter(r => pe >= r.entrada).sort((a, b) => b.entrada - a.entrada)[0] || null;
    if (!plano) return {error: 'SEM_REGRA_CADASTRADA'};
    const step = tipo === 'semestral' ? 6 : 12;
    const meses = [];
    for (let m = step; m <= prazo; m += step) meses.push(m);
    const i = S.taxaInterna(plano.taxa), base = S.baseInterna(fin);
    const denom = meses.reduce((s, m) => s + 1 / Math.pow(1 + i, m), 0);
    const parcela = base / denom;
    return {error: null, fin, pe, plano, taxa: plano.taxa, meses, parcela};
  }

  // ==== Financiamento Linear (top-level tab) — DEAD CODE, confirmed ====
  // Gate 3/33 finding: calcLinear()'s own target elements (#lValorBem,
  // #lEntrada, #lResultados, etc.) do NOT exist anywhere in Seminovos'
  // markup — only referenced defensively (`if(e)`/`if($(id))`) by the
  // JS itself. Production's #linearScreen instead hosts the nested
  // #linearSeminovosFrame iframe (calcularLinearRateTable below) as the
  // real, reachable "Linear" experience. calcularLinear() here is kept
  // for Gate 3's full function-inventory completeness and because the
  // table/formula are byte-identical to Novos' (Gate 22/49), but it is
  // NOT part of this Wave's Gate 39 engine-parity requirement — there is
  // no live production DOM path to verify it against.
  const prazosLinear = [12, 18, 24, 30, 36, 42, 48, 60];
  const tabelaLinear = [
    {prazo: 12, entrada: 0, taxa: 0.0281}, {prazo: 18, entrada: 0, taxa: 0.0245}, {prazo: 24, entrada: 0, taxa: 0.023},
    {prazo: 30, entrada: 0, taxa: 0.0221}, {prazo: 36, entrada: 0, taxa: 0.0215}, {prazo: 42, entrada: 0, taxa: 0.0216},
    {prazo: 48, entrada: 0, taxa: 0.0212}, {prazo: 60, entrada: 0, taxa: 0.0211},
    {prazo: 12, entrada: 0.2, taxa: 0.0268}, {prazo: 18, entrada: 0.2, taxa: 0.0231}, {prazo: 24, entrada: 0.2, taxa: 0.0217},
    {prazo: 30, entrada: 0.2, taxa: 0.0208}, {prazo: 36, entrada: 0.2, taxa: 0.0201}, {prazo: 42, entrada: 0.2, taxa: 0.0203},
    {prazo: 48, entrada: 0.2, taxa: 0.02}, {prazo: 60, entrada: 0.2, taxa: 0.0198},
    {prazo: 12, entrada: 0.3, taxa: 0.0263}, {prazo: 18, entrada: 0.3, taxa: 0.0226}, {prazo: 24, entrada: 0.3, taxa: 0.0211},
    {prazo: 30, entrada: 0.3, taxa: 0.0202}, {prazo: 36, entrada: 0.3, taxa: 0.0196}, {prazo: 42, entrada: 0.3, taxa: 0.0198},
    {prazo: 48, entrada: 0.3, taxa: 0.0195}, {prazo: 60, entrada: 0.3, taxa: 0.0193},
    {prazo: 12, entrada: 0.4, taxa: 0.0231}, {prazo: 18, entrada: 0.4, taxa: 0.0203}, {prazo: 24, entrada: 0.4, taxa: 0.0188},
    {prazo: 30, entrada: 0.4, taxa: 0.0196}, {prazo: 36, entrada: 0.4, taxa: 0.019}, {prazo: 42, entrada: 0.4, taxa: 0.0192},
    {prazo: 48, entrada: 0.4, taxa: 0.0189}, {prazo: 60, entrada: 0.4, taxa: 0.0186},
    {prazo: 12, entrada: 0.5, taxa: 0.0231}, {prazo: 18, entrada: 0.5, taxa: 0.0203}, {prazo: 24, entrada: 0.5, taxa: 0.0188},
    {prazo: 30, entrada: 0.5, taxa: 0.0195}, {prazo: 36, entrada: 0.5, taxa: 0.0189}, {prazo: 42, entrada: 0.5, taxa: 0.0191},
    {prazo: 48, entrada: 0.5, taxa: 0.0188}, {prazo: 60, entrada: 0.5, taxa: 0.0185}
  ];

  function calcularLinear(params) {
    const bem = params.bem, entrada = params.entrada;
    const financiado = Math.max(0, bem - entrada), pctEntrada = bem > 0 ? entrada / bem : 0;
    if (!bem && !entrada) return {error: null, empty: true};
    if (!(bem > 0)) return {error: 'BEM_INVALIDO'};
    if (entrada >= bem) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    const faixa = S.faixaLinear(pctEntrada);
    const itens = prazosLinear.map(p => {
      const row = tabelaLinear.find(r => r.prazo === p && Math.abs(r.entrada - faixa) < 0.00001);
      const baseCalculo = S.baseCalculoLinear(financiado, p);
      const coef = row ? S.coefLinear(row.taxa, p) : null;
      const parcela = (baseCalculo > 0 && coef > 0) ? baseCalculo * coef : null;
      return {prazo: p, parcela};
    });
    return {error: null, financiado, pctEntrada, faixa, itens};
  }

  // ==== "Financiamento Seminovos" — nested RATE_TABLE engine (Seminovos-exclusive) ====
  const RATE_TABLE = {"2007-2013":{"0":{"12":0.0303,"18":0.0266,"24":0.0251,"30":0.0242,"36":0.0236,"42":0.0238,"48":0.0235,"50":0.0237,"60":0.0233},"20":{"12":0.0291,"18":0.0254,"24":0.0239,"30":0.023,"36":0.0224,"42":0.0226,"48":0.0223,"50":0.0225,"60":0.0221},"40":{"12":0.0278,"18":0.0243,"24":0.0228,"30":0.0219,"36":0.0213,"42":0.0213,"48":0.021,"50":0.0212,"60":0.0209}},"2014-2017":{"0":{"12":0.0298,"18":0.0262,"24":0.0247,"30":0.0238,"36":0.0232,"42":0.0233,"48":0.023,"50":0.0232,"60":0.0228},"20":{"12":0.0286,"18":0.0249,"24":0.0234,"30":0.0225,"36":0.0219,"42":0.0221,"48":0.0217,"50":0.022,"60":0.0216},"40":{"12":0.0274,"18":0.0238,"24":0.0223,"30":0.0214,"36":0.0208,"42":0.0209,"48":0.0206,"50":0.0207,"60":0.0204}},"2018-2021":{"0":{"12":0.0295,"18":0.0259,"24":0.0244,"30":0.0235,"36":0.0229,"42":0.0231,"48":0.0228,"50":0.0229,"60":0.0225},"20":{"12":0.0283,"18":0.0246,"24":0.0231,"30":0.0222,"36":0.0216,"42":0.0218,"48":0.0214,"50":0.0216,"60":0.0213},"40":{"12":0.0271,"18":0.0234,"24":0.022,"30":0.0211,"36":0.0205,"42":0.0206,"48":0.0203,"50":0.0205,"60":0.0202}},"2022-2024":{"0":{"12":0.0292,"18":0.0255,"24":0.024,"30":0.0231,"36":0.0225,"42":0.0227,"48":0.0224,"50":0.0226,"60":0.0222},"20":{"12":0.0278,"18":0.0243,"24":0.0228,"30":0.0219,"36":0.0213,"42":0.0213,"48":0.021,"50":0.0212,"60":0.0209},"40":{"12":0.0231,"18":0.0203,"24":0.0188,"30":0.0206,"36":0.02,"42":0.0202,"48":0.0199,"50":0.0201,"60":0.0197}},"2025-2099":{"0":{"12":0.0289,"18":0.0252,"24":0.0237,"30":0.0228,"36":0.0222,"42":0.0224,"48":0.022,"50":0.0223,"60":0.0219},"20":{"12":0.0275,"18":0.024,"24":0.0225,"30":0.0216,"36":0.021,"42":0.0211,"48":0.0208,"50":0.0209,"60":0.0206},"40":{"12":0.0231,"18":0.0203,"24":0.0188,"30":0.0203,"36":0.0197,"42":0.0199,"48":0.0196,"50":0.0198,"60":0.0194}}};
  const TERMS = [12, 18, 24, 30, 36, 42, 48, 50, 60];
  const FEES = {cadastro: 970, avaliacao: 699, registro: 400};
  const SEGURO_PROTECAO = 0.025;
  const IOF_LINEAR_SEMINOVOS = {adicional: 0.0038, diario: 0.000082, maxDias: 365, diasMes: 30};

  function yearBand(year) {
    if (year >= 2007 && year <= 2013) return '2007-2013';
    if (year >= 2014 && year <= 2017) return '2014-2017';
    if (year >= 2018 && year <= 2021) return '2018-2021';
    if (year >= 2022 && year <= 2024) return '2022-2024';
    if (year >= 2025 && year <= 2099) return '2025-2099';
    return null;
  }
  function entryBand(pct) {
    if (pct < 20) return '0';
    if (pct < 40) return '20';
    return '40';
  }
  function pmt(pv, rate, n) {
    if (!pv || !rate || !n) return 0;
    const pow = Math.pow(1 + rate, n);
    return pv * (rate * pow) / (pow - 1);
  }
  function tarifasTotal() {
    return FEES.cadastro + FEES.avaliacao + FEES.registro;
  }
  function calcIOF(baseSemIOF, term) {
    if (!baseSemIOF || !term) return 0;
    const dias = Math.min(term * IOF_LINEAR_SEMINOVOS.diasMes, IOF_LINEAR_SEMINOVOS.maxDias);
    const aliquota = IOF_LINEAR_SEMINOVOS.adicional + (IOF_LINEAR_SEMINOVOS.diario * dias);
    return baseSemIOF * aliquota;
  }

  function calcularLinearRateTable(params) {
    const ano = params.ano, valor = params.valor, entrada = params.entrada;
    const rateTable = params.rateTable || RATE_TABLE;
    const pct = valor > 0 ? (entrada / valor) * 100 : 0;
    const financiado = Math.max(0, valor - entrada);
    const band = yearBand(ano);
    const eBand = entryBand(pct);
    const invalid = !valor || !band || entrada > valor || pct > 100;
    const terms = TERMS.map(t => {
      const rate = band && rateTable[band] && rateTable[band][eBand] ? rateTable[band][eBand][String(t)] : null;
      if (invalid || rate == null) return {prazo: t, payment: null, rate: null, invalid: true};
      const valorComSeguro = financiado * (1 + SEGURO_PROTECAO);
      const baseSemIOF = valorComSeguro + tarifasTotal();
      const iof = calcIOF(baseSemIOF, t);
      const baseTotal = baseSemIOF + iof;
      return {prazo: t, payment: pmt(baseTotal, rate, t), rate, invalid: false, iof, baseTotal};
    });
    return {invalid, band, eBand, pctEntrada: pct, financiado, terms};
  }

  // ==== Descobridor de Taxa ====
  // Byte-identical to Novos' (confirmed via diff) — see file header note.
  function calcularDescobridor(params) {
    const pv = params.financiado, n = params.prazo, pmtVal = params.parcela;
    if (!(pv > 0)) return {error: 'FINANCIADO_INVALIDO'};
    if (!(Number.isInteger(n) && n >= 1 && n <= 60)) return {error: 'PRAZO_INVALIDO'};
    if (!(pmtVal > 0)) return {error: 'PARCELA_INVALIDA'};
    const total = pmtVal * n, juros = total - pv;
    if (total < pv - 0.01) return {error: 'PARCELA_INCOMPATIVEL'};
    const CAD = 980, REG = 339.67, IOF_DISCOVER = 0.02949694;
    const valorTotalFinanciadoEstimado = (pv + CAD + REG) / (1 - IOF_DISCOVER);
    const taxaNet = S.taxaPricePorIteracao(valorTotalFinanciadoEstimado, pmtVal, n);
    const taxaCetMes = S.taxaPricePorIteracao(pv, pmtVal, n);
    if (taxaNet === null || taxaCetMes === null || !isFinite(taxaNet) || !isFinite(taxaCetMes)) return {error: 'PARCELA_INCOMPATIVEL'};
    return {error: null, taxaNet, taxaCetMes, total, juros};
  }

  // ==== Taxas Subsidiadas — ALSO DEAD CODE, confirmed ====
  // Gate 3/33 finding: `id="subsidizedScreen"` does not exist as an
  // actual HTML element anywhere in Seminovos' markup (only as a CSS
  // selector target and in defensively-guarded JS,
  // `document.getElementById('subsidizedScreen')` safely returning
  // null) — hundreds of lines of `.subsidiada-*`/`.subsidized-*` CSS
  // and the full calc/render pipeline remain, but there is no reachable
  // screen or input field for a real user to trigger this feature.
  // Kept for Gate 3 completeness; NOT part of this Wave's Gate 39
  // engine-parity requirement for the same reason as calcularLinear.
  const tabelaRebates_FALLBACK = [{"prazo":12,"taxa":0.0,"coef":0.09008,"rebate":0.1061},{"prazo":15,"taxa":0.0,"coef":0.07227,"rebate":0.1285},{"prazo":18,"taxa":0.0,"coef":0.06034,"rebate":0.15},{"prazo":24,"taxa":0.0,"coef":0.04536,"rebate":0.1769},{"prazo":30,"taxa":0.0,"coef":0.03634,"rebate":0.2162},{"prazo":36,"taxa":0.0,"coef":0.03031,"rebate":0.2505},{"prazo":48,"taxa":0.0,"coef":0.02276,"rebate":0.2983},{"prazo":60,"taxa":0.0,"coef":0.01822,"rebate":0.352},{"prazo":12,"taxa":0.0049,"coef":0.09298,"rebate":0.0774},{"prazo":15,"taxa":0.0049,"coef":0.07513,"rebate":0.09390000000000001},{"prazo":18,"taxa":0.0049,"coef":0.06319,"rebate":0.1099},{"prazo":24,"taxa":0.0049,"coef":0.04819,"rebate":0.1256},{"prazo":30,"taxa":0.0049,"coef":0.03916,"rebate":0.1553},{"prazo":36,"taxa":0.0049,"coef":0.03314,"rebate":0.1806},{"prazo":48,"taxa":0.0049,"coef":0.0256,"rebate":0.2108},{"prazo":60,"taxa":0.0049,"coef":0.02107,"rebate":0.2505},{"prazo":12,"taxa":0.0099,"coef":0.09598,"rebate":0.0476},{"prazo":15,"taxa":0.0099,"coef":0.07812,"rebate":0.0578},{"prazo":18,"taxa":0.0099,"coef":0.06617,"rebate":0.0678},{"prazo":24,"taxa":0.0099,"coef":0.05118,"rebate":0.0712},{"prazo":30,"taxa":0.0099,"coef":0.04218,"rebate":0.09029999999999999},{"prazo":36,"taxa":0.0099,"coef":0.03618,"rebate":0.1054},{"prazo":48,"taxa":0.0099,"coef":0.02871,"rebate":0.115},{"prazo":60,"taxa":0.0099,"coef":0.02425,"rebate":0.1375},{"prazo":12,"taxa":0.0119,"coef":0.0972,"rebate":0.0355},{"prazo":15,"taxa":0.0119,"coef":0.07934,"rebate":0.0432},{"prazo":18,"taxa":0.0119,"coef":0.06739,"rebate":0.0507},{"prazo":24,"taxa":0.0119,"coef":0.05241,"rebate":0.0489},{"prazo":30,"taxa":0.0119,"coef":0.04342,"rebate":0.0634},{"prazo":36,"taxa":0.0119,"coef":0.03744,"rebate":0.0741},{"prazo":48,"taxa":0.0119,"coef":0.03001,"rebate":0.07490000000000001},{"prazo":60,"taxa":0.0119,"coef":0.0256,"rebate":0.0897}];
  const taxasSubsidiadasPermitidas = [0, 0.0049, 0.0099, 0.0119];

  function calcularSubsidiadas(params) {
    const bem = params.bem, entrada = params.entrada, minVenda = params.minVenda || 0;
    if (!bem && !entrada && !minVenda) return {error: null, empty: true};
    if (!(bem > 0)) return {error: 'INFORME_BEM'};
    if (!(entrada > 0)) return {error: 'INFORME_ENTRADA'};
    const pctEntrada = entrada / bem;
    const financiado = bem - entrada;
    if (pctEntrada < 0.50) return {error: 'ENTRADA_MINIMA_50PCT'};
    if (!(financiado > 0)) return {error: 'FINANCIADO_INVALIDO'};
    if (minVenda && minVenda >= bem) return {error: 'MIN_VENDA_MAIOR_QUE_BEM'};
    let rows = tabelaRebates_FALLBACK
      .filter(r => taxasSubsidiadasPermitidas.some(t => Math.abs(t - r.taxa) < 0.00001))
      .map(r => {
        const baseParcela = r.prazo <= 24 ? financiado : financiado + 2500;
        const parcela = baseParcela * r.coef;
        const rebateValor = financiado * r.rebate;
        const valorFinalVenda = (financiado - rebateValor) + entrada;
        const folga = (minVenda > 0) ? (valorFinalVenda - minVenda) : null;
        const viavel = (minVenda > 0) ? (valorFinalVenda >= minVenda) : true;
        return Object.assign({}, r, {parcela, rebateValor, valorFinalVenda, folga, viavel});
      });
    const viaveisOrdenadas = rows.slice().filter(r => r.viavel).sort((a, b) => b.valorFinalVenda - a.valorFinalVenda || a.taxa - b.taxa || a.prazo - b.prazo);
    const melhor = viaveisOrdenadas[0];
    rows = rows.map(r => Object.assign({}, r, {melhor: !!(melhor && r.taxa === melhor.taxa && r.prazo === melhor.prazo)}));
    return {error: null, bem, entrada, minVenda, financiado, rows};
  }

  // ==== Antecipação ====
  // Byte-identical to Novos' (formula AND table, confirmed via diff).
  const tabelaAntecipacao_FALLBACK = {"1": 0.0, "2": 0.014887713377036316, "3": 0.030590802881806933, "4": 0.04655757123385473, "5": 0.06225660414097478, "6": 0.077209223080418, "7": 0.09240523787888621, "8": 0.10687512169792956, "9": 0.1215802881806971, "10": 0.13605017199974045, "11": 0.1489095865515675, "12": 0.16292513143376397, "13": 0.17627133770364123, "14": 0.18983660024664106, "15": 0.2027528071655741, "16": 0.21587995716232877, "17": 0.2287961640812618, "18": 0.24108765496203022, "19": 0.25358603232297006, "20": 0.2654880898292983, "21": 0.27758486402284677, "22": 0.2894788083338742, "23": 0.3004316219900045, "24": 0.31195235931719345, "25": 0.3229213993639255, "26": 0.3340729863049263, "27": 0.34468910235607186, "28": 0.3554796521061855, "29": 0.366095768157331, "30": 0.3762007529045239, "31": 0.38647611475303423, "32": 0.3962565716881936, "33": 0.4061992925293697, "34": 0.41597569286687863, "35": 0.4246730382293762, "36": 0.4341451937431037, "37": 0.44316706691763474, "38": 0.45233903420523136, "39": 0.46106883234893226, "40": 0.46994466800804824, "41": 0.47867446615174913, "42": 0.4869823781398065, "43": 0.4954322710456286, "44": 0.5034765041864088, "45": 0.5116546050496528, "46": 0.5196947815927825, "47": 0.5268465632504705, "48": 0.5346392873369248, "49": 0.5420588044395405, "50": 0.5496000194716687, "51": 0.5567801973129097, "52": 0.5640780164860129, "53": 0.5712581943272538, "54": 0.5780935613682092, "55": 0.5850425131433764, "56": 0.5916547673135588, "57": 0.5983806062179529, "58": 0.6049928603881353, "59": 0.6108749269812423, "60": 0.6172843512689037};

  function calcularAntecipacao(params) {
    const prazo = params.prazo, parcela = params.parcela, primeira = params.primeiraParcela, data = params.dataAntecipacao;
    const tipo = params.tipo || 'todo', baloes = params.baloes || [];
    if (!(prazo >= 1 && prazo <= 60)) return {error: 'PRAZO_INVALIDO'};
    if (!(parcela > 0)) return {error: 'PARCELA_INVALIDA'};
    if (!primeira) return {error: 'PRIMEIRA_PARCELA_AUSENTE'};
    if (!data) return {error: 'DATA_AUSENTE'};
    const meses = new Set();
    for (const b of baloes) {
      if (!b.mes || b.mes < 1 || b.mes > prazo) return {error: 'BALAO_FORA_DO_PRAZO'};
      if (meses.has(b.mes)) return {error: 'BALAO_DUPLICADO'};
      if (!(b.valor > 0)) return {error: 'BALAO_VALOR_INVALIDO'};
      meses.add(b.mes);
    }
    const balaoPorMes = {};
    baloes.forEach(b => { balaoPorMes[b.mes] = b.valor; });
    let inicio = 1, fim = prazo;
    if (tipo === 'algumas') {
      inicio = params.de; fim = params.ate;
      if (!(inicio >= 1 && fim >= inicio && fim <= prazo)) return {error: 'INTERVALO_INVALIDO'};
    }
    if (tipo === 'uma') {
      inicio = fim = params.parcelaUnica;
      if (!(inicio >= 1 && inicio <= prazo)) return {error: 'PARCELA_INVALIDA_INTERVALO'};
    }
    const tabelaAntecipacao = params.tabelaAntecipacao || tabelaAntecipacao_FALLBACK;
    const rows = [];
    let brutoTotal = 0, baloesTotal = 0, descTotal = 0, finalTotal = 0, missing = false;
    for (let num = inicio; num <= fim; num++) {
      const venc = S.addMonths(primeira, num - 1);
      if (venc <= data) continue;
      const mesesAhead = S.diffMonthsAhead(data, venc);
      let desconto = tabelaAntecipacao[mesesAhead];
      if (desconto === undefined) { desconto = 0; missing = true; }
      const valorBalao = balaoPorMes[num] || 0;
      const valorOriginal = valorBalao > 0 ? valorBalao : parcela;
      const bruto = valorOriginal, desc = bruto * desconto, final = bruto - desc;
      brutoTotal += bruto; baloesTotal += valorBalao; descTotal += desc; finalTotal += final;
      rows.push({num, venc, tipo: valorBalao > 0 ? 'Balão' : 'Parcela mensal', parcela, valorBalao, valorOriginal, bruto, meses: mesesAhead, desconto, valorDesconto: desc, final});
    }
    if (!rows.length) return {error: 'NENHUMA_PARCELA_FUTURA'};
    return {error: null, rows, brutoTotal, baloesTotal, descTotal, finalTotal, missing};
  }

  // ==== Semestral Triton — "Taxa 0%" campaign ====
  // NOTE (Gate 49): FATOR_SEMESTRAL_TRITON/MESES (shared, see
  // simulador-shared.adapter.js) and the rebate data are identical to
  // Novos', but Seminovos hardcodes a flat 60% entry (no per-model
  // override) and subtracts the FULL rebateTotal (not just Brabus'
  // share) from valorFinalVenda — genuinely different from Novos.
  const MODELOS_TRITON = {
    'TRITON HPE':    {rebateTotal: 0.20834088191601144, hpeShare: 0.6521739130434783, brabusShare: 0.34782608695652173},
    'TRITON HPE-S':  {rebateTotal: 0.20834027800926697, hpeShare: 0.68, brabusShare: 0.32},
    'TRITON KATANA': {rebateTotal: 0.2230837871934521, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586},
    'TRITON SAVANA': {rebateTotal: 0.2164243708767426, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586},
    'TRITON TERRA':  {rebateTotal: 0.21015101887011217, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586}
  };

  function calcularSemestralTriton(params) {
    const bem = params.bem, modeloNome = params.modelo || 'TRITON HPE';
    const entrada = bem > 0 ? bem * 0.60 : 0;
    const financiado = Math.max(0, bem - entrada);
    if (!(bem > 0 && financiado > 0)) return {error: 'BEM_INVALIDO'};
    const totalParcelar = financiado * S.FATOR_SEMESTRAL_TRITON;
    const parcela = totalParcelar / S.SEMESTRAL_TRITON_MESES.length;
    const modelo = MODELOS_TRITON[modeloNome] || MODELOS_TRITON['TRITON HPE'];
    const rebateTotal = financiado * modelo.rebateTotal;
    const rebateHpe = rebateTotal * modelo.hpeShare;
    const rebateBrabus = rebateTotal * modelo.brabusShare;
    const valorFinalVenda = bem - rebateTotal;
    return {error: null, entrada, financiado, totalParcelar, parcela, rebateTotal, rebateHpe, rebateBrabus, valorFinalVenda};
  }

  window.NX_SIMULADOR_SEMINOVOS_ADAPTER = {
    id: 'simulador-seminovos',
    calcularTradicional, calcularPeriodico, calcularLinear,
    calcularLinearRateTable, calcularDescobridor, calcularSubsidiadas,
    calcularAntecipacao, calcularSemestralTriton,
    _internal: {
      tabelaTradicional_FALLBACK, tabelaPeriodica, prazosLinear, tabelaLinear,
      RATE_TABLE, TERMS, FEES, SEGURO_PROTECAO, tabelaRebates_FALLBACK,
      taxasSubsidiadasPermitidas, tabelaAntecipacao_FALLBACK, MODELOS_TRITON,
      planoTrad, faixaAnoTrad, yearBand, entryBand, pmt, calcIOF
    },
    groundTruthRef: 'origin/main:modules/simulador-seminovos.html (portal-financiamento-brabus-secure) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md'
  };
})();
