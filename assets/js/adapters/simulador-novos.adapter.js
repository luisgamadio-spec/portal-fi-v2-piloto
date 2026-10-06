/* PORTAL-NEXT V2 — Simulador Novos Adapter (Gate 24/25: PURE
   re-derivation of DOM-coupled production engines).
   SOURCE: git show origin/main:modules/simulador-novos.html
   (portal-financiamento-brabus-secure) — see
   docs/SIMULATOR-ENGINE-DISCOVERY-08.md for the full discovery
   (function inventory, dependency graph, DOM-coupling analysis).

   Every calculation function below (calcTrad/calcPeriod/
   calcParcelaUnica/calcLinear/calcDescobridor/montaDadosSubsidiadas/
   calcAntecipacao/renderStc) reads/writes DOM directly in production
   (Blocker #5, PORTAL-NEXT-01.1/BLOCKER-CLASSIFICATION.md) — they
   cannot be extracted byte-identical the way calcScores() was. Each
   function here is a faithful PURE re-derivation (no document/window
   dependency, Gate 25) of the exact same formula/table/validation
   order, verified for parity against the real, unmodified, DOM-
   coupled originals (driven in a real browser against the saved
   origin/main HTML, zero network) by
   tests/simulador-novos-parity-test.py.

   SIMLIVE1 (migrate simulator live rate authorities): every table
   below marked _FALLBACK is now ONLY the default used when the caller
   omits the corresponding live-table param — it is no longer the sole
   data source. simulador-novos.js (the page) fetches the real,
   authenticated ACTIVE base via assets/js/adapters/
   simulador-rates-provider.js and passes the live table in explicitly
   (tabelaTradicional/tabelaPeriodica/tabelaLinear/tabelaRebates/
   tabelaAntecipacao/modelosTriton) once loaded — fail-closed, no
   Calcular button exists before that (see simulador-novos.js's
   makeAuthority()/wireAuthorityGate(), the same pattern already
   established by ensureCampAuthority() for Plano Coparticipado). The
   _FALLBACK constants themselves are UNCHANGED byte-for-byte (Gate 9)
   and remain the default for every direct/unparented call to these
   pure functions — this is exactly what keeps
   tests/simulador-novos-parity-test.py (which calls these functions
   with no live-table param at all) passing unmodified, and is also
   why they remain valid parity/golden fixtures for
   tests/simulador-novos-live-rate-authority-test.py (SIMLIVE1 Phase
   11). Parcela Única and Descobridor de Taxa are UNCHANGED (V1 has no
   RPC for either — V1_STATIC_AUTHORITY_CONFIRMED / pure formula). */
(function () {
  'use strict';

  const S = window.NX_SIMULADOR_SHARED;

  // ==== Tradicional (Balão) ====
  const tabelaTradicional_FALLBACK = [{"entrada":0.1,"prazo":12,"max":1,"taxa":0.023540000000000002},{"entrada":0.1,"prazo":24,"max":1,"taxa":0.019995},{"entrada":0.1,"prazo":30,"max":1,"taxa":0.019714999999999996},{"entrada":0.1,"prazo":36,"max":1,"taxa":0.019144999999999995},{"entrada":0.1,"prazo":40,"max":1,"taxa":0.018760000000000002},{"entrada":0.1,"prazo":42,"max":1,"taxa":0.01875},{"entrada":0.1,"prazo":48,"max":1,"taxa":0.018865000000000003},{"entrada":0.2,"prazo":12,"max":1,"taxa":0.0225},{"entrada":0.2,"prazo":24,"max":1,"taxa":0.0191},{"entrada":0.2,"prazo":30,"max":1,"taxa":0.0186},{"entrada":0.2,"prazo":36,"max":1,"taxa":0.018},{"entrada":0.2,"prazo":40,"max":1,"taxa":0.0176},{"entrada":0.2,"prazo":42,"max":1,"taxa":0.0177},{"entrada":0.2,"prazo":48,"max":1,"taxa":0.0177}];

  function planoTrad(prazo, pe, tabela) {
    return (tabela || tabelaTradicional_FALLBACK).filter(r => r.prazo === prazo && pe >= r.entrada).sort((a, b) => b.entrada - a.entrada)[0] || null;
  }

  function calcularTradicional(params) {
    const bem = params.bem, entrada = params.entrada, prazo = params.prazo, baloes = params.baloes || [];
    const fin = Math.max(0, bem - entrada), pe = bem ? entrada / bem : 0;
    if (!bem) return {error: null, empty: true};
    if (pe < 0.1) return {error: 'ENTRADA_MINIMA_10PCT'};
    if (fin <= 0) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    const plano = planoTrad(prazo, pe, params.tabelaTradicional);
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
  const tabelaPeriodica_FALLBACK = [{"entrada":0.2,"prazo":24,"max":1,"taxa":0.0199},{"entrada":0.2,"prazo":36,"max":1,"taxa":0.0189},{"entrada":0.2,"prazo":48,"max":1,"taxa":0.019}];

  function calcularPeriodico(params) {
    const bem = params.bem, entrada = params.entrada, prazo = params.prazo, tipo = params.tipo;
    const fin = Math.max(0, bem - entrada), pe = bem ? entrada / bem : 0;
    if (!bem) return {error: null, empty: true};
    if (fin <= 0) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    const candidatos = (params.tabelaPeriodica || tabelaPeriodica_FALLBACK).filter(r => r.prazo === prazo);
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

  // ==== Parcela Única ====
  const tabelaParcelaUnica = {entrada: 0.5, prazo: 25, max: 1, taxa: 0.0177, coef: 1.6831};

  function calcularParcelaUnica(params) {
    const bem = params.bem, entrada = params.entrada;
    const fin = Math.max(0, bem - entrada), pe = bem ? entrada / bem : 0;
    const plano = tabelaParcelaUnica;
    if (!bem) return {error: null, empty: true, taxa: plano.taxa, coef: plano.coef};
    if (fin <= 0) return {error: 'ENTRADA_MAIOR_QUE_BEM'};
    if (pe < plano.entrada) return {error: 'ENTRADA_ABAIXO_DO_MINIMO', minEntrada: plano.entrada};
    const parcela = fin * plano.coef;
    return {error: null, fin, pe, plano, taxa: plano.taxa, coef: plano.coef, parcela};
  }

  // ==== Financiamento Linear ====
  const prazosLinear = [12, 18, 24, 30, 36, 42, 48, 60];
  const tabelaLinear_FALLBACK = [
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
    const tabelaLinear = params.tabelaLinear || tabelaLinear_FALLBACK;
    const itens = prazosLinear.map(p => {
      const row = tabelaLinear.find(r => r.prazo === p && Math.abs(r.entrada - faixa) < 0.00001);
      const baseCalculo = S.baseCalculoLinear(financiado, p);
      const coef = row ? S.coefLinear(row.taxa, p) : null;
      const parcela = (baseCalculo > 0 && coef > 0) ? baseCalculo * coef : null;
      return {prazo: p, parcela};
    });
    return {error: null, financiado, pctEntrada, faixa, itens};
  }

  // ==== Descobridor de Taxa ====
  function calcularDescobridor(params) {
    const pv = params.financiado, n = params.prazo, pmt = params.parcela;
    if (!(pv > 0)) return {error: 'FINANCIADO_INVALIDO'};
    if (!(Number.isInteger(n) && n >= 1 && n <= 60)) return {error: 'PRAZO_INVALIDO'};
    if (!(pmt > 0)) return {error: 'PARCELA_INVALIDA'};
    const total = pmt * n, juros = total - pv;
    if (total < pv - 0.01) return {error: 'PARCELA_INCOMPATIVEL'};
    const CAD = 980, REG = 339.67, IOF_DISCOVER = 0.02949694;
    const valorTotalFinanciadoEstimado = (pv + CAD + REG) / (1 - IOF_DISCOVER);
    const taxaNet = S.taxaPricePorIteracao(valorTotalFinanciadoEstimado, pmt, n);
    const taxaCetMes = S.taxaPricePorIteracao(pv, pmt, n);
    if (taxaNet === null || taxaCetMes === null || !isFinite(taxaNet) || !isFinite(taxaCetMes)) return {error: 'PARCELA_INCOMPATIVEL'};
    return {error: null, taxaNet, taxaCetMes, total, juros};
  }

  // ==== Taxas Subsidiadas ====
  const tabelaRebates_FALLBACK = [{"prazo":12,"taxa":0.0,"coef":0.09008,"rebate":0.1105},{"prazo":15,"taxa":0.0,"coef":0.07227,"rebate":0.1337},{"prazo":18,"taxa":0.0,"coef":0.06034,"rebate":0.156},{"prazo":24,"taxa":0.0,"coef":0.04536,"rebate":0.1807},{"prazo":30,"taxa":0.0,"coef":0.03634,"rebate":0.2206},{"prazo":36,"taxa":0.0,"coef":0.03031,"rebate":0.2554},{"prazo":48,"taxa":0.0,"coef":0.02276,"rebate":0.313},{"prazo":60,"taxa":0.0,"coef":0.01822,"rebate":0.3683},{"prazo":12,"taxa":0.0049,"coef":0.09298,"rebate":0.082},{"prazo":15,"taxa":0.0049,"coef":0.07513,"rebate":0.0993},{"prazo":18,"taxa":0.0049,"coef":0.06319,"rebate":0.1162},{"prazo":24,"taxa":0.0049,"coef":0.04819,"rebate":0.1296},{"prazo":30,"taxa":0.0049,"coef":0.03916,"rebate":0.16},{"prazo":36,"taxa":0.0049,"coef":0.03314,"rebate":0.186},{"prazo":48,"taxa":0.0049,"coef":0.0256,"rebate":0.2273},{"prazo":60,"taxa":0.0049,"coef":0.02107,"rebate":0.2693},{"prazo":12,"taxa":0.0099,"coef":0.09598,"rebate":0.0523},{"prazo":15,"taxa":0.0099,"coef":0.07812,"rebate":0.0635},{"prazo":18,"taxa":0.0099,"coef":0.06617,"rebate":0.0744},{"prazo":24,"taxa":0.0099,"coef":0.05118,"rebate":0.0755},{"prazo":30,"taxa":0.0099,"coef":0.04218,"rebate":0.0953},{"prazo":36,"taxa":0.0099,"coef":0.03618,"rebate":0.1112},{"prazo":48,"taxa":0.0099,"coef":0.02871,"rebate":0.1335},{"prazo":60,"taxa":0.0099,"coef":0.02425,"rebate":0.1592},{"prazo":12,"taxa":0.0119,"coef":0.0972,"rebate":0.0403},{"prazo":15,"taxa":0.0119,"coef":0.07934,"rebate":0.0489},{"prazo":18,"taxa":0.0119,"coef":0.06739,"rebate":0.0574},{"prazo":24,"taxa":0.0119,"coef":0.05241,"rebate":0.0533},{"prazo":30,"taxa":0.0119,"coef":0.04342,"rebate":0.0687},{"prazo":36,"taxa":0.0119,"coef":0.03744,"rebate":0.0802},{"prazo":48,"taxa":0.0119,"coef":0.03001,"rebate":0.0942},{"prazo":60,"taxa":0.0119,"coef":0.0256,"rebate":0.1125}];
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
    let rows = (params.tabelaRebates || tabelaRebates_FALLBACK)
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
  // Comment in source: "Base COMPARTILHADA com o Simulador Seminovos
  // (mesma ACTIVE)" — confirmed byte-identical to Seminovos'
  // tabelaAntecipacao_FALLBACK this Wave (Gate 22).
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

  // ==== Semestral Triton/Outlander ====
  // NOTE (Gate 49): the core amortization constants
  // (FATOR_SEMESTRAL_TRITON/MESES) are shared with Seminovos (see
  // simulador-shared.adapter.js) but the final-formula and entry rule
  // are NOT — Novos supports a per-model entradaMinima override
  // (defaulting 60%, e.g. Outlander at 70% via ACTIVE base) and
  // subtracts only the Brabus share of the rebate from valorFinalVenda.
  const MODELOS_TRITON_FALLBACK = {
    'TRITON HPE':    {rebateTotal: 0.20834088191601144, hpeShare: 0.6521739130434783, brabusShare: 0.34782608695652173, entradaMinima: 0.60},
    'TRITON HPE-S':  {rebateTotal: 0.20834027800926697, hpeShare: 0.68, brabusShare: 0.32, entradaMinima: 0.60},
    'TRITON KATANA': {rebateTotal: 0.2230837871934521, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586, entradaMinima: 0.60},
    'TRITON SAVANA': {rebateTotal: 0.2164243708767426, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586, entradaMinima: 0.60},
    'TRITON TERRA':  {rebateTotal: 0.21015101887011217, hpeShare: 0.5862068965517241, brabusShare: 0.41379310344827586, entradaMinima: 0.60}
  };

  function calcularSemestralTriton(params) {
    const bem = params.bem, modeloNome = params.modelo || 'TRITON HPE';
    const modelos = params.modelosTriton || MODELOS_TRITON_FALLBACK;
    const modelo = modelos[modeloNome] || modelos['TRITON HPE'] || MODELOS_TRITON_FALLBACK['TRITON HPE'];
    const entradaPct = (modelo && typeof modelo.entradaMinima === 'number') ? modelo.entradaMinima : 0.60;
    const entrada = bem > 0 ? bem * entradaPct : 0;
    const financiado = Math.max(0, bem - entrada);
    if (!(bem > 0 && financiado > 0)) return {error: 'BEM_INVALIDO', entradaPct};
    const totalParcelar = financiado * S.FATOR_SEMESTRAL_TRITON;
    const parcela = totalParcelar / S.SEMESTRAL_TRITON_MESES.length;
    const rebateTotal = financiado * modelo.rebateTotal;
    const rebateHpe = rebateTotal * modelo.hpeShare;
    const rebateBrabus = rebateTotal * modelo.brabusShare;
    const valorFinalVenda = bem - rebateBrabus;
    return {error: null, entradaPct, entrada, financiado, totalParcelar, parcela, rebateTotal, rebateHpe, rebateBrabus, valorFinalVenda};
  }

  window.NX_SIMULADOR_NOVOS_ADAPTER = {
    id: 'simulador-novos',
    calcularTradicional, calcularPeriodico, calcularParcelaUnica,
    calcularLinear, calcularDescobridor, calcularSubsidiadas,
    calcularAntecipacao, calcularSemestralTriton,
    _internal: {
      tabelaTradicional_FALLBACK, tabelaPeriodica_FALLBACK, tabelaParcelaUnica,
      prazosLinear, tabelaLinear_FALLBACK, tabelaRebates_FALLBACK,
      taxasSubsidiadasPermitidas, tabelaAntecipacao_FALLBACK, MODELOS_TRITON_FALLBACK,
      planoTrad
    },
    groundTruthRef: 'origin/main:modules/simulador-novos.html (portal-financiamento-brabus-secure) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md'
  };
})();
