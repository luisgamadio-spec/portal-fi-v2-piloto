/* PORTAL-NEXT V2 -- Painel Master / Férias/Ausências view-model
   (Painel Master Phase PM-5F).

   PRESENTATION LOGIC ONLY -- no RPC transport (assets/js/adapters/
   master-absences-provider.js owns that), no DOM. Structural template:
   master-periodos-view-model.js (PM-5E).

   Real business object (confirmed live via information_schema.columns
   + INSERT-statement reconstruction, not assumed): an "ausência" row
   has cpf_analista_ausente/nome_analista_ausente (required),
   loja_origem (optional), cpf_analista_substituto/
   nome_analista_substituto (required -- every absence names a real
   substitute), loja_coberta (required), data_inicio/data_fim (plain
   SQL `date`, required), motivo (free text, NOT server-validated
   against MOTIVO_OPTIONS below -- those are a UI-only convenience
   list; the server accepts any string), ativo (boolean, soft-archive
   only -- no hard delete anywhere in this contract: no DELETE RLS
   policy, no delete RPC action). There is no edit action -- V1 never
   exposed one, and this view-model has no field for it.

   REAL financial effect (Gate 20/21): a separate, FROZEN,
   out-of-scope RPC (operational_analyst_commission_metrics) reassigns
   real commission dollars from the absent analyst to the named
   substitute for any commission period overlapping this absence's
   window. `overlapWarning` below is a real, non-decorative surfacing
   of this -- confirmed real production data shows the backend itself
   has NO create-time overlap guard (only a later read-time hard
   error), so this UI warning is the only place this risk is ever
   flagged before submission.

   DATE SAFETY (Gate 18/54, same discipline as every sibling view-
   model): dates are plain "YYYY-MM-DD" strings end to end. fmtDateBR
   and every range/temporal-state comparison below are PURE STRING
   operations, never a `Date` object or `.toISOString()`. */
(function () {
  'use strict';

  var MOTIVO_OPTIONS = ['FÉRIAS', 'AUSÊNCIA', 'LICENÇA', 'AFASTAMENTO', 'COBERTURA TEMPORÁRIA'];

  // Pure string rearrangement -- "2026-08-21" -> "21/08/2026". Never
  // constructs a Date object (see file header).
  function fmtDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '-';
    var m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  // "YYYY-MM-DD" strings compare correctly as plain text lexically --
  // no Date object needed. `hoje` must be a "YYYY-MM-DD" string
  // supplied by the caller (computed once per render pass), never
  // recomputed via `new Date()` inside this pure function.
  function temporalState(absence, hoje) {
    if (!absence || !absence.data_inicio || !absence.data_fim) return 'INDEFINIDO';
    if (absence.data_fim < hoje) return 'PASSADA';
    if (absence.data_inicio > hoje) return 'FUTURA';
    return 'EM_CURSO';
  }

  var TEMPORAL_LABELS = {
    PASSADA: 'Encerrada',
    EM_CURSO: 'Em curso',
    FUTURA: 'Futura',
    INDEFINIDO: '-'
  };

  function temporalLabel(state) {
    return TEMPORAL_LABELS[state] || '-';
  }

  function rangesOverlap(startA, endA, startB, endB) {
    return startA <= endB && startB <= endA;
  }

  // UX-only overlap pre-check (Gate 20/21) against ACTIVE absences for
  // the SAME loja_origem -- mirrors the real risk surfaced by
  // operational_analyst_commission_metrics's own read-time overlap
  // guard ("Existem ausencias sobrepostas para a mesma loja no
  // periodo."), which only fires later when commission metrics are
  // computed. ABSENCE/CREATE itself has no such guard, so this never
  // blocks submission -- it is guidance, not authority.
  function findOverlapWarning(existingAbsences, startDate, endDate, lojaOrigem) {
    if (!lojaOrigem) return null;
    return (existingAbsences || []).filter(function (a) {
      return a.ativo !== false
        && a.loja_origem
        && String(a.loja_origem).toUpperCase() === String(lojaOrigem).toUpperCase()
        && rangesOverlap(a.data_inicio, a.data_fim, startDate, endDate);
    })[0] || null;
  }

  function sortByStartDesc(absences) {
    return (absences || []).slice().sort(function (a, b) {
      return a.data_inicio < b.data_inicio ? 1 : (a.data_inicio > b.data_inicio ? -1 : 0);
    });
  }

  window.NX_MASTER_ABSENCES_VM = {
    MOTIVO_OPTIONS: MOTIVO_OPTIONS,
    fmtDateBR: fmtDateBR,
    temporalState: temporalState,
    temporalLabel: temporalLabel,
    rangesOverlap: rangesOverlap,
    findOverlapWarning: findOverlapWarning,
    sortByStartDesc: sortByStartDesc
  };
})();
