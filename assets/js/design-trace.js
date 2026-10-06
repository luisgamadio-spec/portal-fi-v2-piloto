/* PORTAL-NEXT V2 — Design Trace panel (Gate 32).
   LOCAL DEV TOOLING ONLY. Not part of any future product experience —
   clearly separated (own panel, own toggle, never rendered inside the
   content outlet). Shows the current route's registry metadata so a
   developer can see, at a glance, what authority/status a placeholder
   maps to. Does not exist as UI for end users of a real Portal. */
(function () {
  'use strict';

  function render(entry, routeId) {
    var panel = document.getElementById('nxDesignTrace');
    if (!panel) return;
    if (!entry) {
      panel.innerHTML =
        '<h2>Design Trace (dev only)</h2>' +
        '<dl><dt>route</dt><dd>#/' + (routeId || '(none)') + '</dd>' +
        '<dt>module</dt><dd>not found in registry</dd></dl>';
      return;
    }
    panel.innerHTML =
      '<h2>Design Trace (dev only)</h2><dl>' +
      '<dt>route</dt><dd>#/' + routeId + '</dd>' +
      '<dt>module id</dt><dd>' + entry.id + '</dd>' +
      '<dt>density</dt><dd>' + entry.density + '</dd>' +
      '<dt>design pattern</dt><dd>' + entry.designPattern + '</dd>' +
      '<dt>approved reference</dt><dd>' + (entry.approvedReference || 'none') + '</dd>' +
      '<dt>migration status</dt><dd>' + entry.migrationStatus + '</dd>' +
      '<dt>migration wave</dt><dd>' + entry.migrationWave + '</dd>' +
      '<dt>risk</dt><dd>' + entry.risk + '</dd>' +
      '</dl>';
  }

  window.NX_DESIGN_TRACE = { render: render };
})();
