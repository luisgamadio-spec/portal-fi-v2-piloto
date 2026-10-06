/* PORTAL-NEXT V2 -- Painel Master / Fechamento de Competência CALCULATION
   layer (Painel Master Phase PM-5J).

   PURE FUNCTIONS ONLY. No DOM, no window (beyond the final export), no
   Supabase, no fetch, no side effects, fully deterministic. This file
   is the AUTHORITATIVE V2 extraction of the real V1 (Authority,
   portal-financiamento-brabus-secure/assets/js/portal-app.js, secure-
   mode branch) commission engine -- reconciled and parity-proven in
   PM-5I (tests/commission-engine-parity-test.py, 33/33 exact
   floating-point equality) and re-validated at the full aggregation
   layer in PM-5J (tests/commission-aggregation-parity-test.py).

   NO REINTERPRETATION (PM-5J Gate 9): every arithmetic expression,
   branch, and literal constant below is verbatim from the real source
   -- the ONLY differences from portal-app.js are calling-convention
   changes required for purity (explicit parameters instead of reading
   module-level globals/DOM), each cited against its real source line
   numbers. Two real invariants are preserved EXACTLY, on purpose, even
   though they look unusual -- do not "fix" either without re-opening
   PM-5I/PM-5J:
     (a) GERENTE's own comissao_total uses ONLY comissaoPrincipal, never
         + comissaoSpf (portal-app.js:4944) -- correct as-is, comissaoSpf
         is always 0 for GERENTE anyway, but the distinction is real and
         deliberate in the source.
     (b) GESTOR F&I uses a COMPLETELY SEPARATE formula (own hardcoded
         0.16%/0.30% faixa thresholds and R$30/unit SPF bonus,
         portal-app.js:6252-6284) -- it does NOT call commissionCalc()
         and does NOT read cfg.share_minimo/cfg.bonus_spf_analista. */
(function () {
  'use strict';

  // portal-app.js:60, verbatim.
  function shareNum(a, b) { return b ? ((a / b) * 100) : 0; }

  // portal-app.js:111-131, verbatim (cfgNum(key) replaced by an
  // explicit `cfg` object parameter -- cfg's own key set/values are
  // otherwise identical to PORTAL_CONFIG's real shape).
  function commissionCalc(status, m, cls, cfg) {
    const share = shareNum(m.financiadas, m.vendidas);
    const shareMin = cfg.share_minimo;
    const spfLiquido = (+m.spf || 0) * (cfg.spf_liquido_percentual / 100);
    const rentTotal = (+m.retorno || 0) + spfLiquido;
    let faixa = 0, comissaoPrincipal = 0, comissaoSpf = 0, comissaoTotal = 0;
    if (cls === 'manager') {
      faixa = share >= shareMin ? (cfg.gerente_faixa_share_alto / 100) : (cfg.gerente_faixa_share_baixo / 100);
    } else if (cls === 'analyst') {
      faixa = share >= shareMin ? (cfg.analista_faixa_share_alto / 100) : (cfg.analista_faixa_share_baixo / 100);
      comissaoSpf = (+m.spfQty || 0) * cfg.bonus_spf_analista;
    } else {
      const isSemi = (status || '').toString().toUpperCase().includes('SEMINOVOS') && !(status || '').toString().toUpperCase().includes('NOVOS/SEMINOVOS');
      const limite = isSemi ? cfg.limite_retorno_seminovos : cfg.limite_retorno_novos;
      if ((+rentTotal || 0) < limite) { faixa = share >= shareMin ? (cfg.vendedor_faixa_baixo_share_alto / 100) : (cfg.vendedor_faixa_baixo_share_baixo / 100); }
      else { faixa = share >= shareMin ? (cfg.vendedor_faixa_alto_share_alto / 100) : (cfg.vendedor_faixa_alto_share_baixo / 100); }
    }
    comissaoPrincipal = rentTotal * faixa;
    comissaoTotal = comissaoPrincipal + comissaoSpf;
    return { share, spfLiquido, rentTotal, faixa, comissaoPrincipal, comissaoSpf, comissaoTotal };
  }

  // portal-app.js:6252-6284, verbatim (reads a `totals` param instead of
  // the module-global OPERATIONAL_METRICS_STATE.data.totals -- the
  // caller/view-model is responsible for passing the exact same
  // group-level totals object the real RPC returns, never a
  // client-recomputed sum of individual rows, per the real source's own
  // documented warning about that overestimating by up to 4x).
  function calcGestorFIGrupo(totals, cfg) {
    const t = {
      vendidas: Number(totals?.sold_count) || 0,
      financiadas: Number(totals?.financed_count) || 0,
      producao: Number(totals?.production_value) || 0,
      retorno: Number(totals?.return_value) || 0,
      spf: Number(totals?.spf_value) || 0,
      spfQty: Number(totals?.spf_count) || 0
    };
    const share = t.vendidas ? ((t.financiadas / t.vendidas) * 100) : 0;
    const faixa = share < 40 ? 0.0016 : 0.0030; // literal -- never cfg.share_minimo
    const spfLiquido = (+t.spf || 0) * (cfg.spf_liquido_percentual / 100);
    const base = (+t.retorno || 0) + spfLiquido;
    const comissaoPrincipal = base * faixa;
    const bonusSpf = (+t.spfQty || 0) * 30; // literal -- never cfg.bonus_spf_analista
    const comissaoFinal = comissaoPrincipal + bonusSpf;
    return { ...t, share, faixa, spfLiquido, base, comissaoPrincipal, bonusSpf, comissaoFinal };
  }

  // portal-app.js:4890-4984 (calcularPreviewFechamentoCompetenciaSegura),
  // verbatim logic, explicit inputs instead of module-global state.
  // Returns null when any required source is missing/absent OR when
  // `gestorIdentity` is null -- both real, deliberate fail-closed gates
  // from the source (never fabricate a preview from partial data, and
  // never let a missing Gestor F&I identity be silently skipped: the
  // real code blocks the WHOLE preview on that, not just his own row).
  function buildPreviewLines(input) {
    const { vendRows, analystRows, managerRows, gestorTotals, gestorIdentity, cfg } = input || {};
    if (!Array.isArray(vendRows) || !Array.isArray(analystRows) || !Array.isArray(managerRows) || !gestorIdentity) return null;

    const linhas = [];

    // VENDEDOR
    vendRows.forEach(row => {
      const m = {
        vendidas: Number(row.sold_count) || 0,
        financiadas: Number(row.financed_count) || 0,
        producao: Number(row.production_value) || 0,
        retorno: Number(row.return_value) || 0,
        spf: Number(row.spf_value) || 0,
        spfQty: Number(row.spf_count) || 0,
        items: []
      };
      if (!(m.vendidas > 0 || m.financiadas > 0 || m.retorno > 0 || m.spf > 0)) return;
      const status = row.department || '';
      const c = commissionCalc(status, m, 'seller', cfg);
      linhas.push({ perfil: 'VENDEDOR', loja: row.store, nome: row.seller_name, status, m, c, comissao: c.comissaoTotal });
    });

    // GERENTE -- sums seller buckets by store+department; a seller with
    // a combined "NOVOS/SEMINOVOS" department contributes to both groups.
    const gerenteBuckets = {};
    vendRows.forEach(row => {
      const dep = String(row.department || '').toUpperCase();
      const grupos = [];
      if (dep.includes('NOVOS')) grupos.push('NOVOS');
      if (dep.includes('SEMINOVOS')) grupos.push('SEMINOVOS');
      grupos.forEach(g => {
        const key2 = row.store + '|' + g;
        if (!gerenteBuckets[key2]) gerenteBuckets[key2] = { store: row.store, dep: g, m: { vendidas: 0, financiadas: 0, producao: 0, retorno: 0, spf: 0, spfQty: 0, items: [] } };
        const b = gerenteBuckets[key2].m;
        b.vendidas += Number(row.sold_count) || 0;
        b.financiadas += Number(row.financed_count) || 0;
        b.producao += Number(row.production_value) || 0;
        b.retorno += Number(row.return_value) || 0;
        b.spf += Number(row.spf_value) || 0;
        b.spfQty += Number(row.spf_count) || 0;
      });
    });
    Object.values(gerenteBuckets).forEach(b => {
      if (!(b.m.vendidas > 0 || b.m.financiadas > 0 || b.m.retorno > 0 || b.m.spf > 0)) return;
      const dir = managerRows.find(r => String(r.store || '').trim().toUpperCase() === String(b.store || '').trim().toUpperCase() && String(r.department || '').toUpperCase() === b.dep);
      const c = commissionCalc('GERENTE ' + b.dep, b.m, 'manager', cfg);
      // (a) GERENTE's own commission uses ONLY comissaoPrincipal -- see file header note (a).
      linhas.push({ perfil: 'GERENTE', loja: b.store, nome: dir ? dir.manager_name : ('GERENTE ' + b.dep + ' NÃO LOCALIZADO'), status: 'GERENTE ' + b.dep, m: b.m, c, comissao: c.comissaoPrincipal });
    });

    // ANALISTA -- rows arrive already redistributed for férias/ausências
    // by operational_analyst_commission_metrics_v2 -- never recalculated here.
    analystRows.forEach(row => {
      const m = {
        vendidas: Number(row.sold_count) || 0,
        financiadas: Number(row.financed_count) || 0,
        producao: Number(row.production_value) || 0,
        retorno: Number(row.return_value) || 0,
        spf: Number(row.spf_value) || 0,
        spfQty: Number(row.spf_count) || 0,
        items: []
      };
      const c = commissionCalc('ANALISTA', m, 'analyst', cfg);
      linhas.push({
        perfil: 'ANALISTA', loja: row.store, nome: row.analyst_name,
        status: row.transfer ? 'ANALISTA COBERTURA' : 'ANALISTA',
        m, c, comissao: c.comissaoTotal,
        obs: row.transfer ? ('Cobertura ' + (row.covered_start || '') + ' a ' + (row.covered_end || '') + ' · redistribuído por operational_analyst_commission_metrics_v2') : ''
      });
    });

    // GESTOR F&I -- group-wide totals, separate formula (b). Identity
    // was already required non-null above (whole-preview fail-closed
    // gate); this only decides whether a row is ADDED (mirrors the
    // real `g.pronto` check -- here, "pronto" is simply "gestorTotals
    // was provided").
    if (gestorTotals) {
      const g = calcGestorFIGrupo(gestorTotals, cfg);
      if (!linhas.some(l => String(l.perfil || '').toUpperCase().includes('GESTOR'))) {
        linhas.push({
          perfil: 'GESTOR F&I', loja: 'GRUPO', nome: gestorIdentity.nome, cpf: gestorIdentity.cpf, status: 'GESTOR F&I',
          m: { vendidas: g.vendidas || 0, financiadas: g.financiadas || 0, producao: g.producao || 0, retorno: g.retorno || 0, spf: g.spf || 0, spfQty: g.spfQty || 0, items: [] },
          c: { share: g.share || 0, spfLiquido: g.spfLiquido || 0, rentTotal: g.base || 0, faixa: g.faixa || 0, comissaoPrincipal: g.comissaoPrincipal || 0, comissaoSpf: g.bonusSpf || 0, comissaoTotal: g.comissaoFinal || 0 },
          comissao: g.comissaoFinal || 0, obs: 'Comissão Gestor F&I'
        });
      }
    }

    let vendidas = 0, financiadas = 0, producao = 0, retorno = 0, spf = 0, comissaoPrevista = 0;
    linhas.forEach(l => { vendidas += +(l.m.vendidas || 0); financiadas += +(l.m.financiadas || 0); producao += +(l.m.producao || 0); retorno += +(l.m.retorno || 0); spf += +(l.m.spf || 0); comissaoPrevista += +(l.comissao || 0); });
    return { linhas, vendidas, financiadas, producao, retorno, spf, comissaoPrevista };
  }

  // portal-app.js:4496-4520 (snapshotRowsPayload), verbatim -- explicit
  // `periodo` parameter instead of module-global PERIODO_SELECIONADO/
  // DOM date-input fallback (a pure module has neither).
  function buildSnapshotRowsPayload(preview, periodo, fechamentoId) {
    const p = periodo || {};
    return (preview.linhas || []).map(l => ({
      fechamento_id: fechamentoId != null ? fechamentoId : null,
      periodo_id: p.id || null,
      nome_periodo: p.nome_periodo || 'Datas manuais',
      data_inicio: p.data_inicio || '',
      data_fim: p.data_fim || '',
      loja: l.loja || '',
      perfil: l.perfil || '',
      nome: l.nome || '',
      status: l.status || '',
      vendidas: +(l.m?.vendidas || 0),
      financiadas: +(l.m?.financiadas || 0),
      share: +(l.c?.share || shareNum(l.m?.financiadas || 0, l.m?.vendidas || 0)),
      producao: +(l.m?.producao || 0),
      retorno: +(l.m?.retorno || 0),
      spf_extra: +(l.m?.spf || 0),
      spf_liquido: +(l.c?.spfLiquido || 0),
      rentabilidade_total: +(l.c?.rentTotal || 0),
      faixa: +(l.c?.faixa || 0),
      comissao_principal: +(l.c?.comissaoPrincipal || 0),
      comissao_spf: +(l.c?.comissaoSpf || 0),
      comissao_total: +(l.comissao || 0)
    }));
  }

  // portal-app.js:4535-4550 (the p_summary object literal inside
  // fecharCompetencia), verbatim shape -- explicit parameters instead of
  // module-global PERIODO_SELECIONADO/USER/preview/executivo.
  function buildSummaryPayload(input) {
    const { periodo, executivo, linhasCount, comissaoPrevista, fechadoPorCpf, fechadoPorNome } = input || {};
    const p = periodo || {};
    const e = executivo || {};
    return {
      periodo_id: p.id || null,
      nome_periodo: p.nome_periodo || '',
      data_inicio: p.data_inicio || '',
      data_fim: p.data_fim || '',
      status: 'FECHADO',
      fechado_por: fechadoPorCpf || '',
      fechado_por_nome: fechadoPorNome || '',
      qtd_vendida: e.vendidas || 0,
      qtd_financiada: e.financiadas || 0,
      producao_total: e.producao || 0,
      retorno_total: e.retorno || 0,
      spf_total: e.spf || 0,
      linhas_snapshot: linhasCount || 0,
      comissao_total: comissaoPrevista || 0
    };
  }

  window.NX_MASTER_COMPETENCE_CLOSING_ENGINE = {
    shareNum,
    commissionCalc,
    calcGestorFIGrupo,
    buildPreviewLines,
    buildSnapshotRowsPayload,
    buildSummaryPayload
  };
})();
