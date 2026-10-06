/* PORTAL-NEXT V2 -- Painel Master / Períodos de Comissão view-model
   (Painel Master Phase PM-5E).

   PRESENTATION LOGIC ONLY -- no RPC transport (assets/js/adapters/
   master-periodos-provider.js owns that), no DOM.

   Real business object (confirmed live, not assumed): a "período de
   comissão" row has exactly 8 fields -- id (uuid), nome_periodo
   (free-text label), data_inicio/data_fim (plain SQL `date`, no time
   component), status (text: 'EM CONFERÊNCIA' | 'FECHADO' -- 'ABERTO'
   exists as an accepted value in the live SET_STATUS action but is
   never actually produced by any reachable code path, confirmed by
   direct source+live-data inspection), periodo_atual (boolean, at
   most one true row enforced by the live RPC), ativo (boolean,
   soft-archive flag -- there is no hard delete anywhere in this
   contract, confirmed: no DELETE RLS policy, no delete RPC action),
   criado_por (text, creator identifier).

   DATE SAFETY (Gate 18/54): dates here are plain "YYYY-MM-DD" strings
   end to end -- the exact same shape an `&lt;input type="date"&gt;`
   produces and the exact same shape the RPC stores/returns (a SQL
   `date`, no timezone). fmtDateBR below is PURE STRING manipulation
   (split/rearrange), deliberately never constructing a `Date` object
   or calling `.toISOString()` -- both of those would silently shift
   the calendar day depending on the viewer's local timezone offset,
   the exact drift class this Phase's own brief calls out by name. */
(function () {
  'use strict';

  var STATUS_LABELS = {
    'EM CONFERÊNCIA': 'Em conferência',
    'FECHADO': 'Fechado',
    'ABERTO': 'Aberto'
  };

  // Pure string rearrangement -- "2026-08-21" -> "21/08/2026". Never
  // constructs a Date object (see file header: avoids toISOString/
  // timezone calendar-day drift by construction, not by care).
  function fmtDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '-';
    var m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || 'Em conferência';
  }

  // Pure string comparison -- "YYYY-MM-DD" sorts/compares correctly as
  // plain text, no Date object needed for either overlap-hint or
  // ordering purposes.
  function rangesOverlap(startA, endA, startB, endB) {
    return startA <= endB && startB <= endA;
  }

  // UX-only overlap pre-check against ACTIVE periods, mirroring the
  // live RPC's own real rule (daterange(...,'[]') && daterange(...,'[]'),
  // i.e. inclusive-both-ends overlap against ativo=true rows only) --
  // never the authority; the RPC re-checks server-side regardless.
  function findOverlap(existingPeriods, startDate, endDate) {
    return (existingPeriods || []).filter(function (p) {
      return p.ativo !== false && rangesOverlap(p.data_inicio, p.data_fim, startDate, endDate);
    })[0] || null;
  }

  function sortByStartDesc(periods) {
    return (periods || []).slice().sort(function (a, b) {
      return a.data_inicio < b.data_inicio ? 1 : (a.data_inicio > b.data_inicio ? -1 : 0);
    });
  }

  window.NX_MASTER_PERIODOS_VM = {
    STATUS_LABELS: STATUS_LABELS,
    fmtDateBR: fmtDateBR,
    statusLabel: statusLabel,
    rangesOverlap: rangesOverlap,
    findOverlap: findOverlap,
    sortByStartDesc: sortByStartDesc
  };
})();
