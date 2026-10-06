/* PORTAL-NEXT V2 — Cash Conversion Adapter (Gate 5/16/17: PURE
   EXTRACTION, byte-identical).
   SOURCE: git show origin/main:assets/js/cash-conversion.js
   (portal-financiamento-brabus-secure) — confirmed shared, unmodified,
   between Simulador Novos and Simulador Seminovos this Wave
   (PORTAL-NEXT-08) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md.
   Do not "clean up," rename, reformat, or otherwise touch the
   extracted lines — any future change must come from a NEW extraction
   off a NEW production source (same "no cleanup drift" rule as
   score.adapter.js/coparticipado.adapter.js). */

// ==== BEGIN byte-identical extraction from origin/main:assets/js/cash-conversion.js ====
(function (global) {
  'use strict';

  function calcularValorFinalFinanciamento(parcela, prazoMeses) {
    if (!(parcela > 0) || !(prazoMeses > 0)) return 0;
    return parcela * prazoMeses;
  }

  function calcularValorFuturoAplicacao(capital, taxaAplicacao, prazoMeses) {
    return capital * Math.pow(1 + taxaAplicacao, prazoMeses);
  }

  function calcularRendimentoAplicacao(capital, valorFuturoAplicacao) {
    return valorFuturoAplicacao - capital;
  }

  function classificarResultado(valorFuturoAplicacao, valorFinalFinanciamento) {
    var centavosAplicacao = Math.round(valorFuturoAplicacao * 100);
    var centavosFinanciamento = Math.round(valorFinalFinanciamento * 100);
    if (centavosAplicacao === centavosFinanciamento) return 'EQUIVALENTE';
    return centavosAplicacao > centavosFinanciamento ? 'FINANCIAR' : 'UTILIZAR';
  }

  function calcularCashConversion(params) {
    var capital = params.capital;
    var parcela = params.parcela;
    var prazoMeses = params.prazoMeses;
    var taxaAplicacao = params.taxaAplicacao;

    if (!(capital > 0) || !(parcela > 0) || !(prazoMeses > 0) || !isFinite(taxaAplicacao)) {
      return null;
    }

    var valorFinalFinanciamento = calcularValorFinalFinanciamento(parcela, prazoMeses);
    var valorFuturoAplicacao = calcularValorFuturoAplicacao(capital, taxaAplicacao, prazoMeses);
    var rendimentoAplicacao = calcularRendimentoAplicacao(capital, valorFuturoAplicacao);
    var diferencaProjetada = valorFuturoAplicacao - valorFinalFinanciamento;
    var classificacao = classificarResultado(valorFuturoAplicacao, valorFinalFinanciamento);

    return {
      capital: capital,
      parcela: parcela,
      prazoMeses: prazoMeses,
      taxaAplicacao: taxaAplicacao,
      valorFinalFinanciamento: valorFinalFinanciamento,
      valorFuturoAplicacao: valorFuturoAplicacao,
      rendimentoAplicacao: rendimentoAplicacao,
      diferencaProjetada: diferencaProjetada,
      classificacao: classificacao
    };
  }

  global.CashConversion = {
    calcularValorFinalFinanciamento: calcularValorFinalFinanciamento,
    calcularValorFuturoAplicacao: calcularValorFuturoAplicacao,
    calcularRendimentoAplicacao: calcularRendimentoAplicacao,
    calcularCashConversion: calcularCashConversion
  };
})(window);
// ==== END byte-identical extraction ====

window.NX_CASH_CONVERSION_ADAPTER = {
  id: 'cash-conversion',
  compute: window.CashConversion.calcularCashConversion,
  groundTruthRef: 'origin/main:assets/js/cash-conversion.js (portal-financiamento-brabus-secure) — shared by simulador-novos.html and simulador-seminovos.html; see docs/SIMULATOR-ENGINE-DISCOVERY-08.md'
};
