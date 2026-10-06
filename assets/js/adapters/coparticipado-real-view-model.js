/* PORTAL-NEXT V2 -- Coparticipado REAL view-model mapping (Real Data
   Integration Foundation, Coparticipado Phase 2, Gate 13/14/15/16).

   Reshapes the real operational_score_coparticipated_data payload into
   the SAME {sales, fins} shape coparticipado.adapter.js's own compute()
   already produces for fixtures -- so coparticipado.js's existing
   render functions (renderCoparticipadosTable/renderSubsidiadosTable/
   populateStoreOptions/applyFilters) run UNCHANGED against either
   transport.

   Unlike Gestão (synthetic per-unit reconstruction) or Dashbi (a
   hybrid), this is a DIRECT, row-for-row mapping: the real RPC already
   returns one JSON record per financing operation (Phase 1B, Gate 5 --
   proven the canonical record grain), fully classified and matched
   server-side. This file therefore does NOT call, and must NEVER call,
   classifyPlan()/matchB3()/buildB3Index()/processFins()/processSales()/
   isTCcoparticipado()/isSituacaoCoparticipadoValida() -- those remain
   fixture/historical-parity code only (Phase 1B, Gate 4/14). `plano`
   comes directly from the server's own `plan` field, unmodified.

   Privacy (Gate 14): the real backend deliberately never returns client
   identity (contains_client_identity: false) or a full chassis
   (contains_full_chassis: false) -- matching real V1 production's own
   secure adapter (score-coparticipated-secure-adapter.js), cliente is
   hardcoded to "Operação protegida" and chassi/chassiResumido both use
   only the server-masked operation_reference, verbatim, never combined
   or derived to approximate a real identity/chassis.

   Rebate/Coparticipação (V2_COPART_GOVERNED_RATE_AUTHORITY_CORRECTION):
   reuses the existing, already-extracted, formula-frozen
   calcCoparticipacaoDetalhe()/findTaxaCopart() over the real
   finance[] array -- proven still legitimately client-side in real V1
   production itself, not a reclassification. DATA.taxasCopart is now
   populated from the GOVERNED rate authority
   (simulador_get_coparticipado, via coparticipado-governed-rates-
   provider.js), using the same taxaKey() the engine's own
   findTaxaCopart() will use internally to look them back up --
   operational_score_coparticipated_data's own "rates" field (still
   present in its payload for backend-contract compatibility) is no
   longer read for this purpose (see docs/CHANGE-PROPOSAL-V2-COPART-
   GOVERNED-RATE-AUTHORITY.md). */
(function () {
  'use strict';

  var DEPT_MAP = { NOVOS: 'Novos', SEMINOVOS: 'Seminovos' };
  function mapDept(d) { return DEPT_MAP[d] || d; }

  // Governed matriz_modelos rows: one row per (modelo, prazo) pair, all
  // 6 prazos per modelo carrying IDENTICAL rebate_total/rebate_brabus
  // (term-invariance proved against the real ACTIVE batch -- see the
  // change proposal and tests/fixtures/coparticipado-governed-rates-
  // contract.json, a frozen snapshot of that proof, never the runtime
  // source itself). First occurrence per normalized model key wins --
  // deterministic and, given the proven invariance, equivalent to any
  // other selection policy for this contract.
  function buildGovernedTaxasCopart(matrizModelos) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    var lookup = {};
    (matrizModelos || []).forEach(function (m) {
      var modelo = ((m && m.modelo) || '').toString().trim();
      var rebateTotal = Number(m && m.rebate_total);
      var parteBrabus = Number(m && m.rebate_brabus);
      if (!modelo || !isFinite(rebateTotal) || !isFinite(parteBrabus) || rebateTotal <= 0) return;
      var key = A.taxaKey(modelo);
      if (key && !lookup[key]) {
        lookup[key] = { modeloTabela: modelo, rebateTotal: rebateTotal, parteBrabus: parteBrabus, linha: 0 };
      }
    });
    return lookup;
  }

  function buildSales(rawSales) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    return (rawSales || []).map(function (r) {
      return {
        cliente: 'Operação protegida',
        vendedor: r.seller || '',
        loja: r.store || '',
        dept: mapDept(r.department),
        modelo: r.model || 'NÃO INFORMADO',
        valorVenda: Number(r.sale_value) || 0,
        chassi: r.operation_reference || '',
        chassiResumido: r.operation_reference || '',
        data: A.parseDate(r.date)
      };
    });
  }

  function buildFins(rawFinance) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    return (rawFinance || []).map(function (r) {
      var fin = {
        cliente: 'Operação protegida',
        vendedor: r.seller || '',
        loja: r.store || '',
        dept: mapDept(r.department),
        modelo: r.model || 'NÃO INFORMADO',
        // FC-2.3 (GAP-003 export, relocated here from Score): familia and
        // valorVenda were absent from this mapping (this file's own
        // buildSales() already carries valorVenda; V1's own real secure
        // adapter, score-coparticipated-secure-adapter.js, sets BOTH on
        // finance records too) -- neither is a new capability, both were
        // simply never read by this module's own pre-export render
        // functions (renderCoparticipadosTable/renderSubsidiadosTable
        // don't show either column). Added now because the export's own
        // validated contract needs them; familiaModelo() is the same
        // function this file's own buildSales() already calls elsewhere
        // in the codebase (exposed on NX_COPARTICIPADO_ADAPTER, not
        // reimplemented).
        familia: A.familiaModelo(r.model),
        valorVenda: Number(r.sale_value) || 0,
        valorFinanciado: Number(r.financed_value) || 0,
        retorno: Number(r.return_value) || 0,
        receitaSPF: Number(r.spf_value) || 0,
        spfQtd: Number(r.spf_count) || 0,
        parcelas: Number(r.installments) || 0,
        pmt: Number(r.installment_value) || 0,
        balaoValor: r.plan === 'BALÃO' ? (Number(r.balloon_value) || 0) : 0,
        // Gate 15 -- server-authoritative, never reclassified client-side.
        plano: r.plan || 'LINEAR',
        situacaoB3: r.status || '',
        matchedB3: true,
        chassi: r.operation_reference || '',
        chassiResumido: r.operation_reference || '',
        data: A.parseDate(r.date)
      };
      if (fin.plano === 'COPARTICIPADO') {
        fin.coparticipacaoDetalhe = A.calcCoparticipacaoDetalhe(fin);
      }
      return fin;
    });
  }

  // payload: operational_score_coparticipated_data's response (sales/
  // finance -- unchanged authority). governedPayload: simulador_get_
  // coparticipado's response (the ONE financial rate authority as of
  // V2_COPART_GOVERNED_RATE_AUTHORITY_CORRECTION). Both are required by
  // the caller (coparticipado.js) to have already resolved successfully
  // before this is called -- this file has no fail-closed logic of its
  // own; it trusts its caller's orchestration (Gate 19/20).
  function buildRealResult(payload, governedPayload) {
    var A = window.NX_COPARTICIPADO_ADAPTER;
    // Must run before buildFins(): calcCoparticipacaoDetalhe()/
    // findTaxaCopart() read DATA.taxasCopart internally, not as a
    // parameter (same module-level-state contract the fixture path
    // already relies on via compute()).
    A.setTaxasCopart(buildGovernedTaxasCopart(governedPayload.linhas.matriz_modelos));
    return {
      sales: buildSales(payload.sales),
      fins: buildFins(payload.finance),
      sourceInfo: {
        source: 'REAL_BACKEND',
        scope: payload.scope,
        period_start: payload.period_start,
        period_end: payload.period_end,
        rateAuthority: {
          source: 'GOVERNED_ACTIVE',
          batchId: governedPayload.batch_id || '',
          arquivoNome: governedPayload.arquivo_nome || ''
        }
      }
    };
  }

  window.NX_COPARTICIPADO_REAL_VIEW_MODEL = {
    buildRealResult: buildRealResult
  };
})();
