/* PORTAL-NEXT V2 — Simulador Shared Helpers Adapter (Gate 22/49: PURE
   EXTRACTION of provably byte-identical logic shared between Novos and
   Seminovos).
   SOURCE: git show origin/main:modules/simulador-novos.html AND
   modules/simulador-seminovos.html (portal-financiamento-brabus-secure).
   Every function below was diff-confirmed byte-identical between both
   files this Wave (PORTAL-NEXT-08) before being extracted here — see
   docs/SIMULATOR-ENGINE-DISCOVERY-08.md Gate 6/22/49. Do not "clean
   up," rename, reformat, or otherwise touch these lines — any future
   change must come from a NEW extraction off a NEW production source
   (same "no cleanup drift" rule as score.adapter.js/
   coparticipado.adapter.js). */
(function () {
  'use strict';

  // ==== BEGIN byte-identical extraction (shared Novos+Seminovos) ====
  function parseBRL(s){return Number(String(s).replace(/[^\d,-]/g,'').replace(/\./g,'').replace(',','.'))||0}
  function taxaInterna(t){return t+0.00012}
  function baseInterna(fin){const ADICIONAL=.062305,CAD=980,REG=339.67,IOF=.0321516;const subtotal=Math.max(0,fin)*(1+ADICIONAL)+CAD+REG;return subtotal/(1-IOF)}
  function faixaLinear(pctEntrada){if(pctEntrada>=.5)return .5;if(pctEntrada>=.4)return .4;if(pctEntrada>=.3)return .3;if(pctEntrada>=.2)return .2;return 0}
  function coefLinear(i,n){
    if(!(n>0)) return null;
    if(!i) return 1/n;
    return i/(1-Math.pow(1+i,-n));
  }
  function baseCalculoLinear(fin,prazo){
    const valorFinanciado=Math.max(0,fin);
    const tarifaCadastro=980;
    const tarifaRegistro=339.67;
    const aliquotaIofBase=0.0038;
    const aliquotaIofDiaria=0.000082;
    const dias=Math.max(0,prazo)*30;
    const fatorIof=aliquotaIofBase+(aliquotaIofDiaria*dias);
    const baseSemIof=valorFinanciado+tarifaCadastro+tarifaRegistro;
    return baseSemIof/(1-fatorIof);
  }
  function taxaPricePorIteracao(pv,pmt,n){
    if(!(pv>0)||!(pmt>0)||!(n>0)) return null;
    function f(i){return pmt*((1-Math.pow(1+i,-n))/i)-pv}
    let lo=0.0000000001, hi=1;
    while(f(hi)>0 && hi<10) hi*=2;
    if(f(hi)>0) return null;
    for(let k=0;k<120;k++){const mid=(lo+hi)/2; if(f(mid)>0) lo=mid; else hi=mid;}
    return (lo+hi)/2;
  }
  function pct2(v){return (v*100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'}
  function parsePctInput(v){
    if(v==null) return 0;
    const cleaned=String(v).replace(/%/g,'').replace(/\s/g,'').replace(/\./g,'').replace(',', '.');
    const n=parseFloat(cleaned);
    return isFinite(n)?n/100:0;
  }
  function formatPctInputValue(rate,dec=1){
    if(!isFinite(rate) || rate<0) return '';
    return (rate*100).toLocaleString('pt-BR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  }
  function fmtDateBR(d){return d instanceof Date && !isNaN(d)?d.toLocaleDateString('pt-BR'):'--'}
  function addMonths(date,months){const d=new Date(date.getTime()); const day=d.getDate(); d.setMonth(d.getMonth()+months); if(d.getDate()<day) d.setDate(0); return d;}
  function diffMonthsAhead(from,to){const ms=to-from; if(ms<=0) return 0; return Math.max(1,Math.min(60,Math.ceil(ms/(1000*60*60*24*30.4375))));}
  // ==== END byte-identical extraction ====

  // Also confirmed byte-identical (Gate 22): the two Semestral Triton/
  // Outlander literal constants. NOTE (Gate 49 — do NOT assume more
  // than this): the surrounding orchestration/final-formula differs
  // between Novos and Seminovos (Novos: valorFinalVenda = bem -
  // rebateBrabus, plus a per-model entradaMinima override; Seminovos:
  // valorFinalVenda = bem - rebateTotal, flat 60% for every model) —
  // see each simulator's own adapter for its own calcularSemestralTriton.
  const FATOR_SEMESTRAL_TRITON = 1.1045534653178353;
  const SEMESTRAL_TRITON_MESES = [6, 12, 18, 24];

  window.NX_SIMULADOR_SHARED = {
    parseBRL, taxaInterna, baseInterna, faixaLinear, coefLinear,
    baseCalculoLinear, taxaPricePorIteracao, pct2, parsePctInput,
    formatPctInputValue, fmtDateBR, addMonths, diffMonthsAhead,
    FATOR_SEMESTRAL_TRITON, SEMESTRAL_TRITON_MESES,
    groundTruthRef: 'origin/main:modules/simulador-novos.html AND modules/simulador-seminovos.html (byte-identical in both) — see docs/SIMULATOR-ENGINE-DISCOVERY-08.md'
  };
})();
