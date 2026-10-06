/* PORTAL-NEXT V2 -- Dashbi REAL view-model mapping (Real Data
   Integration Foundation, Dashbi Phase 2, Gate B1/B3).

   Reshapes the two raw real RPC payloads (operational_metrics,
   operational_model_metrics) into the SAME presentation-ready shapes
   dashbi.adapter.js's own frozen, HUMAN_APPROVED functions already
   produce -- so dashbi.js's rendering functions run UNCHANGED against
   either fixture or real data. This file contains ZERO new business
   logic: every field is either a direct real-RPC value, a simple sum
   of real-RPC values, or the single Stage-A-approved derivation
   (ticket = production_value / financed_count).

   Two distinct techniques, chosen deliberately per data shape:

   1. Store/seller/ranking/Novos-por-Loja/KPI views (aggregate.())
      need only SIMPLE SUMS (qtd, receita, producao, ...) plus real
      per-plan-type counts (plan_breakdown[]). These are reconstructed
      as synthetic per-unit sales/fins records via the SAME even-
      distribute() technique already proven safe in real production
      (analise-geral-grupo-secure-adapter.js's metricsToLegacy()) --
      any split of a real SUM across N synthetic rows reproduces that
      sum exactly when dashbi.adapter.js's OWN aggregate() sums them
      back up. This is why gestao-real-provider.js's approach doesn't
      transfer directly: Dashbi's presentation is built on a re-
      aggregation step (aggregate()) that Gestão's isn't.

   2. Model Analysis (Análise por Modelos) is NOT reconstructed this
      way. dashbi.adapter.js's modelExtraMetrics() depends on real
      per-transaction fields (parcelas, pmt, chassi, valorVenda,
      origem) with a conditional entrada-eligibility gate -- fields
      the real RPC deliberately never returns (that's why
      contains_chassis:false is a self-declared security property,
      not an integration gap -- Dashbi Phase 1, Gate 14/15). Model
      rows are instead built DIRECTLY from operational_model_metrics's
      own already-aggregated per-(store,department,model) rows: simple
      sums combine exactly; the entrada pair (average_entry_value /
      weighted_entry_percent) is recombined from the RPC's own raw
      sums (entry_total, entry_sales_value_total, valid_entry_count --
      not the pre-divided averages, so no approximation); only
      prazoMedio/pmtMed (average_installments/average_installment_
      value) use a financed_count-weighted mean of per-store averages,
      since the RPC has no raw installment sums to recombine exactly --
      documented explicitly below, the one place this file is not an
      exact reproduction of a real sum.

   Model-name normalization (Gate B8): the real RPC returns completely
   raw dealership-system strings (confirmed by direct query -- e.g.
   "ECLIPSE CROSS HPE-S 1.5T AWC" / "...4X4" / "...AWD" / "...S-AWC"
   as four distinct raw strings for what is one canonical model), so
   dashbi.adapter.js's own frozen, real-production-sourced
   modeloPadrao()/familyOfModel() are applied here -- the approved
   reconciliation, not a new rule. */
(function () {
  'use strict';

  var DEPT_MAP = { NOVOS: 'Novos', SEMINOVOS: 'Seminovos' };

  function distribute(total, count, index) {
    if (!count) return 0;
    var base = total / count;
    return index === count - 1 ? total - base * (count - 1) : base;
  }

  // ---- Technique 1: synthetic sales/fins for aggregate()-based views ----

  function buildSalesAndFins(metricsRows) {
    var sales = [];
    var fins = [];
    (metricsRows || []).forEach(function (row) {
      var dept = DEPT_MAP[row.department] || row.department;
      var sold = row.sold_count || 0;
      for (var i = 0; i < sold; i++) {
        sales.push({
          loja: row.store, dept: dept, vendedor: row.seller_name,
          valorVenda: distribute(row.sales_value || 0, sold, i),
          origem: {}
        });
      }

      var financed = row.financed_count || 0;
      var breakdown = (row.plan_breakdown || []).slice();
      var breakdownSum = breakdown.reduce(function (s, p) { return s + (p.financed_count || 0); }, 0);
      // Real invariant (Dashbi Phase 1, Gate 9/10): plan_breakdown's
      // financed_count entries partition the row's own financed_count
      // exactly (same effective_finance_classified population, disjoint
      // by plan_type). Any shortfall is treated as LINEAR -- isFinLinear's
      // own role as the fallback classification when no other flag matches.
      if (breakdownSum < financed) {
        breakdown.push({ plan_type: 'LINEAR', financed_count: financed - breakdownSum, production_value: 0, return_value: 0, average_balloon_value: 0 });
      }

      var spfIndex = 0;
      breakdown.forEach(function (p) {
        var pCount = p.financed_count || 0;
        for (var j = 0; j < pCount; j++) {
          var rec = {
            loja: row.store, dept: dept, vendedor: row.seller_name,
            producao: distribute(p.production_value || 0, pCount, j),
            receita: distribute(p.return_value || 0, pCount, j),
            // spf_net_value is row-level (not broken down by plan_type in
            // the real contract), so it is distributed across ALL of the
            // row's financed records, same as production's own
            // metricsToLegacy() (distribute(row.spf_net_value, financed, spfIndex)).
            receitaSPF: distribute(row.spf_net_value || 0, financed || 1, spfIndex),
            origem: {}
          };
          // isFinBalao()/isFinSubsidiado()/isFinReversao()/isFinCoparticipado()
          // (dashbi.adapter.js) -- reproduced exactly, not reinvented: BALÃO
          // is balaoValor>0, the other three are planoClassificado string
          // match, LINEAR is whatever matches none of the above.
          if (p.plan_type === 'BALÃO') rec.balaoValor = p.average_balloon_value > 0 ? p.average_balloon_value : 1;
          else if (p.plan_type === 'SUBSIDIADO' || p.plan_type === 'REVERSÃO' || p.plan_type === 'COPARTICIPADO') rec.planoClassificado = p.plan_type;
          fins.push(rec);
          spfIndex++;
        }
      });
    });
    return { sales: sales, fins: fins };
  }

  // ---- Technique 2: direct model-row construction (bypasses aggregate()/modelExtraMetrics) ----

  function buildModelRows(modelMetricsRows, family) {
    var A = window.NX_DASHBI_ADAPTER;
    var byModel = {};

    function ensure(canonical) {
      if (!byModel[canonical]) {
        byModel[canonical] = {
          Modelo: canonical, volume: 0, financiada: 0, producao: 0, receita: 0, receitaSPF: 0,
          parcelasWeighted: 0, pmtWeighted: 0,
          linearQtd: 0, balaoQtd: 0, reversaoQtd: 0, coparticipadoQtd: 0, subsidiadoQtd: 0,
          balaoProdSum: 0, balaoQtdForAvg: 0,
          entradaTotal: 0, entradaSalesTotal: 0, entradaQtd: 0
        };
      }
      return byModel[canonical];
    }

    // FAMILY_MODELS union (Gate B8): a model with zero real rows in this
    // period still gets a zero row, matching modelRowsUnified()'s own
    // Set-union behavior (new Set([...FAMILY_MODELS[family], ...sold])).
    ((A._internal && A._internal.FAMILY_MODELS && A._internal.FAMILY_MODELS[family]) || []).forEach(ensure);

    (modelMetricsRows || []).forEach(function (row) {
      if (row.department !== 'NOVOS') return; // Model Analysis is Novos-only (dashbi.js MODES_BY_VIEW)
      var canonical = A.modeloPadrao(row.model);
      if (A.familyOfModel(canonical) !== family) return;
      var acc = ensure(canonical);
      acc.volume += row.sold_count || 0;
      acc.financiada += row.financed_count || 0;
      acc.producao += row.production_value || 0;
      acc.receita += row.return_value || 0;
      acc.receitaSPF += row.spf_net_value || 0;
      // No raw installment sums in the real contract -- financed_count-
      // weighted mean of per-store averages (documented above; the one
      // approximation in this file, not an exact recombination).
      acc.parcelasWeighted += (row.average_installments || 0) * (row.financed_count || 0);
      acc.pmtWeighted += (row.average_installment_value || 0) * (row.financed_count || 0);
      // Entrada IS recombined exactly -- the real contract returns the raw
      // sums (entry_total, entry_sales_value_total, valid_entry_count), not
      // just the pre-divided averages (entry_rule/entry_percent_rule,
      // Dashbi Phase 1 Gate 9).
      acc.entradaTotal += row.entry_total || 0;
      acc.entradaSalesTotal += row.entry_sales_value_total || 0;
      acc.entradaQtd += row.valid_entry_count || 0;
      (row.plan_breakdown || []).forEach(function (p) {
        var key = { 'SUBSIDIADO': 'subsidiadoQtd', 'REVERSÃO': 'reversaoQtd', 'COPARTICIPADO': 'coparticipadoQtd', 'BALÃO': 'balaoQtd', 'LINEAR': 'linearQtd' }[p.plan_type];
        if (key) acc[key] += p.financed_count || 0;
        if (p.plan_type === 'BALÃO') {
          acc.balaoProdSum += (p.average_balloon_value || 0) * (p.financed_count || 0);
          acc.balaoQtdForAvg += p.financed_count || 0;
        }
      });
    });

    return Object.keys(byModel).map(function (modelo) {
      var a = byModel[modelo];
      var receitaTotal = a.receita + a.receitaSPF;
      return {
        Modelo: modelo,
        volume: a.volume,
        financiada: a.financiada,
        penetracao: a.volume ? a.financiada / a.volume : 0,
        producao: a.producao,
        receita: a.receita,
        receitaSPF: a.receitaSPF,
        receitaTotal: receitaTotal,
        // Stage A -- TICKET_CONTRACTUAL_DERIVATION_ALLOWED, frozen formula.
        ticket: a.financiada ? a.producao / a.financiada : 0,
        parcelasMed: 0, // legacy field, not read by MODEL_TABLE_COLUMNS
        pmtMed: a.financiada ? a.pmtWeighted / a.financiada : 0,
        linearQtd: a.linearQtd, balaoQtd: a.balaoQtd, reversaoQtd: a.reversaoQtd,
        coparticipadoQtd: a.coparticipadoQtd, subsidiadoQtd: a.subsidiadoQtd,
        balaoMed: a.balaoQtdForAvg ? a.balaoProdSum / a.balaoQtdForAvg : 0,
        retornoMedio: a.producao ? receitaTotal / a.producao : 0,
        prazoMedio: a.financiada ? a.parcelasWeighted / a.financiada : 0,
        entradaQtd: a.entradaQtd,
        entradaTotal: a.entradaTotal,
        valorVendaTotal: a.entradaSalesTotal,
        entradaMed: a.entradaQtd ? a.entradaTotal / a.entradaQtd : 0,
        entradaPct: a.entradaSalesTotal ? a.entradaTotal / a.entradaSalesTotal : 0
      };
    }).sort(function (x, y) { return y.volume - x.volume || x.Modelo.localeCompare(y.Modelo); });
  }

  function buildRealOut(metricsPayload, modelMetricsPayload) {
    var A = window.NX_DASHBI_ADAPTER;
    var sf = buildSalesAndFins(metricsPayload.rows || []);
    return {
      blocked: false,
      missingSellers: [],
      sales: sf.sales,
      fins: sf.fins,
      // storeTableHtml/sellerTableHtml (dashbi.js) read out.aggs directly --
      // A.compute() computes this internally for fixtures via its own
      // aggregate() call; real transport must do the same explicitly here.
      aggs: A.aggregate({ sales: sf.sales, fins: sf.fins }),
      sourceInfo: { source: 'REAL_BACKEND', scope: metricsPayload.scope, period_start: metricsPayload.period_start, period_end: metricsPayload.period_end },
      entradaDiagnostic: { totalFinanciamentos: sf.fins.length, chassisLocalizados: 0, chassisNaoLocalizados: 0, taxaSucesso: 0, calculoAplicado: false },
      modelMetricsRows: modelMetricsPayload.rows || []
    };
  }

  function modelRowsForFamily(out, family) {
    return buildModelRows(out.modelMetricsRows, family);
  }

  window.NX_DASHBI_REAL_VIEW_MODEL = {
    buildRealOut: buildRealOut,
    modelRowsForFamily: modelRowsForFamily
  };
})();