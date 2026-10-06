/* PORTAL-NEXT V2 -- Painel Master / Histórico de Competências -- Exportar
   RH/DP PURE transformation engine (Painel Master Phase PM-6B, extended
   PM-6D.3 to split the FROZEN operational snapshot -- COMPLETE closings
   never touch reconcileChassisDetail or any live source at all; see
   splitFrozenOperationalRows below and the history provider's own
   loadOperationalSnapshot doc comment).

   Byte-verbatim-equivalent port of V1's exportSnapshotExcel() (portal-app.js
   :5371-5679, portal-financiamento-brabus-secure) row-shaping logic, minus
   the actual XLSX/DOM construction (that stays in shell-admin.js, reusing
   the ALREADY-established window.NX_XLSX_EXPORT_HELPER, per Gate 16 of this
   Phase's own brief -- no new styling framework). This file is pure: no
   RPC, no DOM, no XLSX object construction, no window.NX_AUTH -- takes
   already-normalized snapshot/spf/chassis rows and returns plain-JS row
   arrays for each of V1's 8 sheets, so it can be exercised and diffed by a
   golden V1×V2 test exactly like master-competence-closing-engine.js
   already is (PM-5J Gate 7).

   REAL, LIVE-SOURCE-VERIFIED FINDING (PM-6B pre-flight, re-read verbatim
   from portal-app.js): V1's CPF enrichment for a HISTORICAL export
   (exportarRhDpOficialHistorico -> exportSnapshotExcel(..., isPreview=
   false, ...)) calls authByName(nome), which reads DATA.auth/DATA.master
   -- module-level arrays populated EXCLUSIVELY by the legacy XLSX loader
   (`DATA=buildPortalData(wbs)`, the only assignment site in the whole
   file) and NEVER by any secure-mode RPC, despite an aspirational comment
   claiming otherwise. In secure mode (authMode==='secure', the only mode
   V2 replicates) DATA.auth/DATA.master are permanently empty arrays, so
   authByName() ALWAYS returns null, and snapshot_comissoes itself never
   stores a cpf column (confirmed by re-reading master_close_commission_
   period's own INSERT column list, PM-5J/PM-5G). CONCLUSION, empirically
   derived, not assumed: in V1 SECURE mode, "Exportar RH/DP" of ANY
   historical competência ALWAYS produces an EMPTY CPF column -- the
   header exists, the data never does. V2 reproduces this exact real
   behavior (CPF header present for structural/column parity, cell always
   empty) rather than inventing a new CPF-bearing data source V1 itself
   never actually used for this flow. */
(function () {
  'use strict';

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function upperTrim(v) { return String(v || '').trim().toUpperCase(); }

  // ---------- Fail-closed reconciliation (Sheets 5/6 gate) ----------
  // Verbatim port of buscarDetalheOperacionalParaFechamento's own
  // divergence check (portal-app.js:5725-5765): the chassis-level detail
  // for abas 5/6 is reconstructed from LIVE operational_salary_details
  // (the frozen snapshot never stored that granularity -- Incidente
  // Excel-RH-DP-3.0), so before presenting it as trustworthy historical
  // detail, every VENDEDOR's live-reconstructed vendidas/financiadas
  // count is compared against the SAME seller's frozen snapshot totals.
  // Any single mismatch blocks the WHOLE export (never a partial/
  // silently-incomplete abas 5/6).
  function reconcileChassisDetail(chassisRows, snapshotRows) {
    var porVendedorDetalhe = {};
    (chassisRows || []).forEach(function (r) {
      if (!r.included_in_commission) return;
      var nome = r.seller_name || '';
      if (!porVendedorDetalhe[nome]) porVendedorDetalhe[nome] = { vendidas: 0, financiadas: 0 };
      porVendedorDetalhe[nome].vendidas++;
      if (r.financed) porVendedorDetalhe[nome].financiadas++;
    });
    var porVendedorSnapshot = {};
    (snapshotRows || []).filter(function (r) { return upperTrim(r.perfil) === 'VENDEDOR'; }).forEach(function (r) {
      var nome = r.nome || '';
      if (!porVendedorSnapshot[nome]) porVendedorSnapshot[nome] = { vendidas: 0, financiadas: 0 };
      porVendedorSnapshot[nome].vendidas += num(r.vendidas);
      porVendedorSnapshot[nome].financiadas += num(r.financiadas);
    });
    var nomes = {};
    Object.keys(porVendedorDetalhe).forEach(function (n) { nomes[n] = true; });
    Object.keys(porVendedorSnapshot).forEach(function (n) { nomes[n] = true; });
    var divergente = false;
    Object.keys(nomes).forEach(function (nome) {
      var d = porVendedorDetalhe[nome] || { vendidas: 0, financiadas: 0 };
      var s = porVendedorSnapshot[nome] || { vendidas: 0, financiadas: 0 };
      if (d.vendidas !== s.vendidas || d.financiadas !== s.financiadas) divergente = true;
    });
    return { ok: !divergente };
  }

  // ---------- ABA 1 -- Resumo Principal ----------
  // executivo: {vendidas, financiadas, producao, retorno, spf_extra} --
  // caller resolves this from the closing's own observacao JSON
  // (HC_VM.parseObservacao, same qtd_vendida/qtd_financiada/producao_
  // total/retorno_total/spf_total schema already reconciled PM-5J/5H),
  // falling back to summing VENDEDOR snapshot rows -- verbatim mirror of
  // resumoExecutivoOficialExcel()'s own two-tier resolution (never
  // recalculated from live commission-engine data, Gate 12/34).
  function buildSheet1Resumo(closing, snapshotRows, executivo, comissaoTotal) {
    var composicao = { vendedores: 0, gerentes: 0, analistas: 0, gestor: 0 };
    (snapshotRows || []).forEach(function (r) {
      var p = upperTrim(r.perfil);
      if (p === 'VENDEDOR') composicao.vendedores++;
      else if (p === 'GERENTE') composicao.gerentes++;
      else if (p === 'ANALISTA') composicao.analistas++;
      else if (p.indexOf('GESTOR') !== -1) composicao.gestor++;
    });
    return {
      header: [
        ['RELATÓRIO DE COMISSÕES RH/DP'],
        ['Grupo Brabus Mitsubishi'],
        ['Status', 'Snapshot congelado (competência fechada)'],
        ['Período', closing.nome_periodo || ''],
        ['Origem', 'Resumo Executivo oficial do Portal + Snapshot congelado para lançamento'],
        ['Gerado em', new Date().toLocaleString('pt-BR')],
        [],
        ['RESUMO EXECUTIVO OFICIAL'],
        ['Indicador', 'Valor'],
        ['Linhas de Comissão', (snapshotRows || []).length],
        ['Qtd Vendida', num(executivo.vendidas)],
        ['Qtd Financiada', num(executivo.financiadas)],
        ['Produção Total', num(executivo.producao)],
        ['Retorno Total', num(executivo.retorno)],
        ['SPF Extra', num(executivo.spf_extra)],
        ['Comissão Total', num(comissaoTotal)],
        [],
        ['COMPOSIÇÃO DO SNAPSHOT'],
        ['Vendedores', composicao.vendedores],
        ['Gerentes', composicao.gerentes],
        ['Analistas', composicao.analistas],
        ['Gestor F&I', composicao.gestor]
      ]
    };
  }

  // ---------- ABA 2 -- Vendedores / ABA 4 -- Gerentes (mesmo shape) ----------
  // CPF sempre vazio nesta linha por padrão -- ver nota de proveniência no
  // topo do arquivo (comportamento real do V1 em modo seguro, não uma
  // omissão do V2).
  function linhaPadrao(r) {
    return {
      'Nome': r.nome || '', 'CPF': '', 'Loja': r.loja || '', 'Departamento': r.departamento || '',
      'Vendas': num(r.vendidas), 'Financiamentos': num(r.financiadas), 'Share': num(r.share),
      'Retorno': num(r.retorno), '70% SPF': num(r.spf_liquido), 'Retorno + 70% SPF': num(r.rentabilidade_total),
      'Faixa de Comissão': num(r.faixa), 'Comissao_Total': num(r.comissao_total)
    };
  }
  function buildSheet2Vendedores(snapshotRows) {
    return (snapshotRows || [])
      .filter(function (r) { return upperTrim(r.perfil) === 'VENDEDOR'; })
      .map(linhaPadrao)
      .sort(function (a, b) { return (a.Loja + a.Departamento + a.Nome).localeCompare(b.Loja + b.Departamento + b.Nome); });
  }
  function buildSheet4Gerentes(snapshotRows) {
    return (snapshotRows || [])
      .filter(function (r) { return upperTrim(r.perfil) === 'GERENTE'; })
      .map(linhaPadrao)
      .sort(function (a, b) { return (a.Loja + a.Departamento + a.Nome).localeCompare(b.Loja + b.Departamento + b.Nome); });
  }

  // ---------- ABA 3 -- Analistas + Gestor F&I ----------
  function buildSheet3AnalistasGestor(snapshotRows) {
    return (snapshotRows || [])
      .filter(function (r) { var p = upperTrim(r.perfil); return p.indexOf('ANALISTA') !== -1 || p.indexOf('GESTOR') !== -1; })
      .map(function (r) {
        var isGestor = upperTrim(r.perfil).indexOf('GESTOR') !== -1;
        var qtdSpf = isGestor ? 0 : Math.round(num(r.comissao_spf) / 150);
        var valorUnitario = isGestor ? 0 : 150;
        return {
          'Nome': r.nome || '', 'CPF': '', 'Cargo': r.perfil || '', 'Loja': r.loja || '', 'Departamento': r.departamento || '',
          'Vendas': num(r.vendidas), 'Financiamentos': num(r.financiadas), 'Share': num(r.share),
          'Retorno': num(r.retorno), '70% SPF': num(r.spf_liquido), 'Retorno + 70% SPF': num(r.rentabilidade_total),
          'Faixa de Comissão': num(r.faixa), 'Quantidade de SPF': qtdSpf, 'Valor Unitário SPF': valorUnitario,
          'Comissão SPF': num(r.comissao_spf), 'Comissão Principal': num(r.comissao_principal), 'Comissao_Total': num(r.comissao_total)
        };
      })
      .sort(function (a, b) { return (a.Loja + a.Cargo + a.Nome).localeCompare(b.Loja + b.Cargo + b.Nome); });
  }

  // ---------- ABA 5/6 -- Chassis ----------
  function chassisRowAba6(row) {
    return {
      'Loja': row.store || '', 'Departamento': row.department || '', 'Vendedor': row.seller_name || '',
      'Data': row.date || '', 'Chassi Mascarado': row.chassis_masked || '', 'Modelo': row.vehicle_model || '',
      'Financiado': row.financed ? 'SIM' : 'NÃO', 'Valor Venda': num(row.sale_value), 'Retorno': num(row.return_considered)
    };
  }
  function chassisRowAba5(row) {
    return {
      'Loja': row.store || '', 'Departamento': row.department || '', 'Vendedor': row.seller_name || '',
      'Data': row.date || '', 'Chassi Mascarado': row.chassis_masked || '', 'Modelo': row.vehicle_model || '',
      'Tipo Financeiro': row.finance_date ? 'FINANCIAMENTO PRINCIPAL' : 'RETORNO POSTERIOR',
      'Valor Financiado/Serviço': num(row.financed_value), 'Retorno': num(row.return_considered)
    };
  }
  function buildSheet6TodosChassis(chassisRows) {
    var incluidos = (chassisRows || []).filter(function (r) { return r.included_in_commission; });
    if (!incluidos.length) return [{ 'Aviso': 'Nenhuma operação registrada para o período desta competência.' }];
    return incluidos.slice().sort(function (a, b) {
      return (a.store + a.department + a.seller_name + a.date + a.chassis_masked).localeCompare(b.store + b.department + b.seller_name + b.date + b.chassis_masked);
    }).map(chassisRowAba6);
  }
  function buildSheet5ChassisFinanciados(chassisRows) {
    var financiados = (chassisRows || []).filter(function (r) { return r.included_in_commission && r.financed; });
    if (!financiados.length) return [{ 'Aviso': 'Nenhuma operação financiada no período desta competência.' }];
    return financiados.slice().sort(function (a, b) {
      return (a.store + a.department + a.seller_name + a.date + a.chassis_masked).localeCompare(b.store + b.department + b.seller_name + b.date + b.chassis_masked);
    }).map(chassisRowAba5);
  }

  // ---------- ABA 7 -- Auditoria SPF ----------
  function buildSheet7AuditoriaSpf(spfRows) {
    if (!spfRows || !spfRows.length) return [{ 'Aviso': 'Nenhuma operação de SPF encontrada para esta competência no período.' }];
    return spfRows.map(function (r) {
      return {
        'Loja': r.store || '', 'Vendedor': r.seller_name || '', 'Departamento': r.department || '',
        'Data': r.operation_date || '', 'Chassi': r.chassis_masked || '', 'Codigo_Operacao': r.operation_code || '',
        'Banco': r.bank || '', 'Plano_Financeiro': r.finance_code || '', 'Opcional': r.optional_name || '',
        'Valor_SPF_Bruto': num(r.spf_bruto), 'Valor_SPF_70pct': num(r.spf_liquido)
      };
    });
  }

  // ---------- ABA 8 -- Memória de Cálculo ----------
  function buildSheet8Memoria(snapshotRows) {
    return (snapshotRows || []).map(function (r) {
      return {
        'Loja': r.loja || '', 'Perfil': r.perfil || '', 'Nome': r.nome || '', 'Status': r.departamento || '',
        'Vendidas': num(r.vendidas), 'Financiadas': num(r.financiadas), 'Share': num(r.share),
        'Producao': num(r.producao), 'Retorno': num(r.retorno), 'SPF_Extra': num(r.spf_extra), 'SPF_Liquido': num(r.spf_liquido),
        'Rentabilidade_Total': num(r.rentabilidade_total), 'Faixa': num(r.faixa), 'Comissao_Principal': num(r.comissao_principal),
        'Comissao_SPF': num(r.comissao_spf), 'Comissao_Total': num(r.comissao_total), 'Observacao': ''
      };
    });
  }

  // ---------- Frozen operational detail (PM-6D.3) ----------
  // Splits master_commission_operational_detail's own `rows` (already
  // read-only, already exclusively sourced from snapshot_operational_
  // detail -- see the history provider's own doc comment) by `kind`
  // into the SAME shapes buildSheet5/6/7 already consume today from the
  // LIVE reconstruction path -- so those builders are reused byte-
  // identical for both COMPLETE and LEGACY_PARTIAL closings, never
  // duplicated. Only ONE field rename is needed: the frozen row's own
  // `sale_date` column (the real table column name, PM-6D.1) must alias
  // to `date` (the key operational_salary_details' own live RPC already
  // uses, and what chassisRowAba5/6 already read) -- a pure frontend
  // mapping, never a backend contract change. Every other field name
  // already matches verbatim.
  //
  // CLOSED_COMPETENCE_IMMUTABILITY_PRINCIPLE (PM-6C/PM-6D.3): frozen
  // seller_name/store/department are used EXACTLY as persisted at
  // closing time -- never re-resolved against the CURRENT user
  // directory/store structure, even if a seller was later renamed or
  // moved. A historical export must always show what was true when the
  // competência was closed.
  //
  // Any row whose `kind` is neither 'CHASSIS' nor 'SPF' fails closed
  // (Gate 18/57 of this Phase's own brief) -- returns {ok:false},
  // caller must block the WHOLE export, never silently drop the row.
  function splitFrozenOperationalRows(rows) {
    var chassisRows = [];
    var spfRows = [];
    var ok = true;
    (rows || []).forEach(function (r) {
      if (r.kind === 'CHASSIS') {
        chassisRows.push({
          store: r.store, department: r.department, seller_user_id: r.seller_user_id, seller_name: r.seller_name,
          date: r.sale_date, chassis_masked: r.chassis_masked, vehicle_model: r.vehicle_model,
          financed: r.financed, finance_date: r.finance_date, sale_value: r.sale_value,
          financed_value: r.financed_value, return_considered: r.return_considered,
          included_in_commission: r.included_in_commission
        });
      } else if (r.kind === 'SPF') {
        spfRows.push({
          store: r.store, department: r.department, seller_user_id: r.seller_user_id, seller_name: r.seller_name,
          operation_date: r.operation_date, chassis_masked: r.chassis_masked, operation_code: r.operation_code,
          bank: r.bank, finance_code: r.finance_code, optional_name: r.optional_name,
          spf_bruto: r.spf_bruto, spf_liquido: r.spf_liquido
        });
      } else {
        ok = false;
      }
    });
    return { ok: ok, chassisRows: chassisRows, spfRows: spfRows };
  }

  function buildFilename(closing) {
    return 'Relatorio_Comissoes_RH_DP_' + (closing.id || 'competencia') + '_RH_DP_COMPLETO.xlsx';
  }

  window.NX_MASTER_COMPETENCE_RHDP_EXPORT_ENGINE = {
    reconcileChassisDetail: reconcileChassisDetail,
    splitFrozenOperationalRows: splitFrozenOperationalRows,
    buildSheet1Resumo: buildSheet1Resumo,
    buildSheet2Vendedores: buildSheet2Vendedores,
    buildSheet3AnalistasGestor: buildSheet3AnalistasGestor,
    buildSheet4Gerentes: buildSheet4Gerentes,
    buildSheet5ChassisFinanciados: buildSheet5ChassisFinanciados,
    buildSheet6TodosChassis: buildSheet6TodosChassis,
    buildSheet7AuditoriaSpf: buildSheet7AuditoriaSpf,
    buildSheet8Memoria: buildSheet8Memoria,
    buildFilename: buildFilename
  };
})();
