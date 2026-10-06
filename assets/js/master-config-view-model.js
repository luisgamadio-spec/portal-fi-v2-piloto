/* PORTAL-NEXT V2 -- Painel Master / Configurações view-model (Painel
   Master Phase PM-5E).

   PRESENTATION LOGIC ONLY -- no RPC transport (assets/js/adapters/
   master-config-provider.js owns that), no DOM. Path deliberately NOT
   under assets/js/adapters/, matching the precedent already set for
   every sibling Painel Master view-model.

   CONFIG_KEYS below is a faithful, byte-level port of V1's own
   DEFAULT_PORTAL_CONFIG + parametroCard() catalog (portal-app.js) --
   same 13 keys, same labels, same default values, same descriptions.
   This list is DISPLAY-ONLY: the real authority for which keys are
   writable is the live master_update_portal_config RPC's own internal
   allowlist (confirmed identical to this list by direct comparison
   against the live function body, PM-5E Gate 24) -- this file never
   invents a 14th key or drops one of the 13.

   Every one of these 13 settings is CLASSIFICATION: FINANCIAL +
   COMMISSION (PM-5E Gate 8/12) -- confirmed real consumers: V1's own
   client-side commissionCalc(), three server RPCs that read
   spf_liquido_percentual (operational_metrics/operational_model_
   metrics/operational_analyst_commission_metrics), and a third,
   independently-maintained hand-copy of the same formula inside the
   portal-ai Edge Function (fetchCommissionConfig/liveCommissionCalc)
   -- none of that duplication is touched or altered here; this file
   only reshapes the RPC's own {chave,valor} rows into the exact
   payload the write RPC already expects.

   PERCENT VS DECIMAL (Gate 9, confirmed from the live write RPC's own
   validation, not inferred): every key here is stored and transmitted
   as a PLAIN NUMBER already in "percent points" or "reais" form (e.g.
   40 means 40%, 150 means R$150) -- NOT a 0-1 fraction. This is a
   DIFFERENT convention from Gestão dos Simuladores' own decimal-
   fraction contract (PM-5D) -- confirmed distinct, never conflated.
   The live RPC itself additionally caps any key whose name contains
   "share"/"percentual"/"faixa" at a maximum of 100 (a real, server-
   side percent-sanity check) and every key at a global range of
   0-1000000000. This file's own gsValidateHint()-equivalent below is
   a UX convenience only, never the authority. */
(function () {
  'use strict';

  var CONFIG_KEYS = [
    { key: 'share_minimo', label: 'Share mínimo (%)', description: 'Valor mínimo para faixa superior.', unit: '%', default: 40, percentCapped: true },
    { key: 'spf_liquido_percentual', label: 'SPF Líquido (%)', description: 'Percentual aplicado sobre SPF Extra.', unit: '%', default: 70, percentCapped: true },
    { key: 'bonus_spf_analista', label: 'Bônus SPF Analista (R$)', description: 'Valor por unidade de SPF para analista.', unit: 'R$', default: 150, percentCapped: false },
    { key: 'limite_retorno_novos', label: 'Limite Retorno Novos (R$)', description: 'Corte de retorno bruto para vendedores Novos.', unit: 'R$', default: 12000, percentCapped: false },
    { key: 'limite_retorno_seminovos', label: 'Limite Retorno Seminovos (R$)', description: 'Corte de retorno bruto para vendedores Seminovos.', unit: 'R$', default: 8000, percentCapped: false },
    { key: 'vendedor_faixa_baixo_share_baixo', label: 'Vendedor: baixo retorno + Share baixo (%)', description: 'Faixa de comissão do vendedor.', unit: '%', default: 10, percentCapped: true },
    { key: 'vendedor_faixa_baixo_share_alto', label: 'Vendedor: baixo retorno + Share alto (%)', description: 'Faixa de comissão do vendedor.', unit: '%', default: 15, percentCapped: true },
    { key: 'vendedor_faixa_alto_share_baixo', label: 'Vendedor: alto retorno + Share baixo (%)', description: 'Faixa de comissão do vendedor.', unit: '%', default: 15, percentCapped: true },
    { key: 'vendedor_faixa_alto_share_alto', label: 'Vendedor: alto retorno + Share alto (%)', description: 'Faixa de comissão do vendedor.', unit: '%', default: 20, percentCapped: true },
    { key: 'gerente_faixa_share_baixo', label: 'Gerente: Share baixo (%)', description: 'Faixa de comissão do gerente.', unit: '%', default: 3, percentCapped: true },
    { key: 'gerente_faixa_share_alto', label: 'Gerente: Share alto (%)', description: 'Faixa de comissão do gerente.', unit: '%', default: 4, percentCapped: true },
    { key: 'analista_faixa_share_baixo', label: 'Analista: Share baixo (%)', description: 'Faixa de comissão do analista.', unit: '%', default: 3.5, percentCapped: true },
    { key: 'analista_faixa_share_alto', label: 'Analista: Share alto (%)', description: 'Faixa de comissão do analista.', unit: '%', default: 4.5, percentCapped: true }
  ];

  // BR/US decimal parser (V1's own cfgNum/salvarConfigPortal parity):
  // comma or dot both accepted as the decimal separator.
  function parseNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function fmtNumber(v) {
    return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }

  // UX-only pre-check mirroring the live RPC's own validation, so the
  // Human sees a clear message before attempting a real write -- never
  // the actual authority (the RPC re-validates independently either way).
  function validateHint(def, rawValue) {
    var n = parseNumber(rawValue);
    if (n === null) return 'Informe um valor numérico válido.';
    if (n < 0 || n > 1000000000) return 'Valor fora do intervalo permitido.';
    if (def.percentCapped && n > 100) return 'Percentual fora do intervalo de 0 a 100.';
    return null;
  }

  // Merge real RPC rows onto the 13-key catalog, exactly mirroring
  // V1's own carregarParametrosPortal(): a key with no matching row
  // keeps its documented default (this is the REAL, confirmed-live
  // current state of every one of the 13 keys today -- none has ever
  // been written, PM-5E Gate 38).
  function buildEffectiveConfig(rpcRows) {
    var byKey = {};
    (rpcRows || []).forEach(function (r) { byKey[r.chave] = r.valor; });
    return CONFIG_KEYS.map(function (def) {
      var hasRow = Object.prototype.hasOwnProperty.call(byKey, def.key);
      var effective = hasRow ? parseNumber(byKey[def.key]) : null;
      if (effective === null) effective = def.default;
      return {
        key: def.key, label: def.label, description: def.description, unit: def.unit,
        default: def.default, percentCapped: def.percentCapped,
        hasRow: hasRow, value: effective
      };
    });
  }

  window.NX_MASTER_CONFIG_VM = {
    CONFIG_KEYS: CONFIG_KEYS,
    parseNumber: parseNumber,
    fmtNumber: fmtNumber,
    validateHint: validateHint,
    buildEffectiveConfig: buildEffectiveConfig
  };
})();
