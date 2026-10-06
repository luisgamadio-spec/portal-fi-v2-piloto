/* PORTAL-NEXT V2 -- Painel Master / Fechamento de Competência
   VIEW-MODEL (Painel Master Phase PM-5J).

   PRESENTATION LOGIC + STALE-PREVIEW BOOKKEEPING ONLY -- no RPC
   transport (assets/js/adapters/master-competence-closing-provider.js
   owns that), no financial FORMULA (assets/js/adapters/master-
   competence-closing-engine.js owns that, and is the one this file
   calls to turn provider data into a preview), no DOM.

   STALE PREVIEW PROTECTION (PM-5J Gate 31): there is no backend
   version/token for a preview -- master_close_commission_period simply
   accepts whatever p_rows/p_summary it is given. This file's own
   `previewToken` is therefore a CLIENT-SIDE-ONLY safeguard: it pins the
   exact periodId (and the exact instant the preview was generated) the
   preview belongs to, so the UI can refuse to confirm a close if the
   selected período changed after the preview was generated. It cannot
   detect a real operational-data change that happened silently on the
   server between preview and confirm (e.g. someone else importing a
   new sales batch in the meantime) -- that limitation is real and is
   documented here and in the final report, never silently assumed
   away. */
(function () {
  'use strict';

  function fmtDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '-';
    var m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function fmtMoney(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtPct(faixa) {
    return ((Number(faixa) || 0) * 100).toFixed(2).replace('.', ',') + '%';
  }

  function profileCounts(linhas) {
    return (linhas || []).reduce(function (acc, l) {
      var p = String(l.perfil || '').toUpperCase();
      if (p === 'VENDEDOR') acc.vendedores++;
      else if (p === 'GERENTE') acc.gerentes++;
      else if (p === 'ANALISTA') acc.analistas++;
      else if (p.indexOf('GESTOR') !== -1) acc.gestor++;
      return acc;
    }, { vendedores: 0, gerentes: 0, analistas: 0, gestor: 0 });
  }

  // Real, hardcoded formula constants (portal-app.js:64-78) -- used as
  // the default config whenever operational_portal_config has no
  // override row for a given key (same fallback rule as the real
  // cfgNum(), reproduced in the closing engine itself; exposed here too
  // so the preview screen can show which values are actually in effect).
  var DEFAULT_PORTAL_CONFIG = {
    share_minimo: 40, spf_liquido_percentual: 70, bonus_spf_analista: 150,
    limite_retorno_novos: 12000, limite_retorno_seminovos: 8000,
    vendedor_faixa_baixo_share_baixo: 10, vendedor_faixa_baixo_share_alto: 15,
    vendedor_faixa_alto_share_baixo: 15, vendedor_faixa_alto_share_alto: 20,
    gerente_faixa_share_baixo: 3, gerente_faixa_share_alto: 4,
    analista_faixa_share_baixo: 3.5, analista_faixa_share_alto: 4.5
  };
  function resolveConfig(rows) {
    var cfg = Object.assign({}, DEFAULT_PORTAL_CONFIG);
    (rows || []).forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(cfg, r.chave)) {
        var n = Number(String(r.valor).replace(',', '.'));
        if (Number.isFinite(n)) cfg[r.chave] = n;
      }
    });
    return cfg;
  }

  function makePreviewToken(periodId) {
    return { periodId: periodId, generatedAt: Date.now() };
  }
  // Gate 31: the ONLY thing this can prove is "the selected período is
  // still the same one the preview was built for" -- never "the
  // underlying operational data hasn't changed since".
  function isPreviewStale(token, currentPeriodId) {
    if (!token) return true;
    return String(token.periodId) !== String(currentPeriodId);
  }

  window.NX_MASTER_COMPETENCE_CLOSING_VM = {
    fmtDateBR: fmtDateBR,
    fmtMoney: fmtMoney,
    fmtPct: fmtPct,
    profileCounts: profileCounts,
    DEFAULT_PORTAL_CONFIG: DEFAULT_PORTAL_CONFIG,
    resolveConfig: resolveConfig,
    makePreviewToken: makePreviewToken,
    isPreviewStale: isPreviewStale
  };
})();
