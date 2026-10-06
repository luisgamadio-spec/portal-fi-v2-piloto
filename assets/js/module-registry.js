/* PORTAL-NEXT V2 — Module Registry loader (Gate 13).
   Loads config/module-registry.json (metadata only, no business logic
   — see tests/business-logic-scanner.py) and exposes lookup helpers. */
(function () {
  'use strict';

  window.NX_REGISTRY = {
    modules: [],
    loaded: false,
    error: null,

    load: function () {
      var self = this;
      // PA-1B: this file changes across Waves (new modules, status
      // transitions) within the SAME long-lived browser session a
      // Human keeps open across a whole day of UAT -- a plain fetch()
      // can be served from the browser's HTTP cache (heuristic
      // freshness from Last-Modified, no explicit Cache-Control here),
      // silently keeping a stale module list/authMode/status long after
      // the file on disk changed. cache:'no-store' forces a real
      // network read every load; this is metadata, not large business
      // data, so the cost is negligible.
      return fetch('config/module-registry.json', { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('module-registry.json HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          self.modules = data.modules || [];
          self.migrationStatusEnum = data.migrationStatusEnum || [];
          self.loaded = true;
          return self.modules;
        })
        .catch(function (err) {
          // V2-SECURITY-02 (SEC-01): self.error is not read/rendered
          // anywhere in this codebase today, but keep it generic rather
          // than the raw fetch/HTTP error text -- the full error still
          // goes to the console below for developer diagnostics only.
          self.error = 'Não foi possível carregar o registro de módulos.';
          console.error('[module-registry] failed to load', err);
          throw err;
        });
    },

    byId: function (id) {
      return this.modules.find(function (m) { return m.id === id; }) || null;
    }
  };
})();
