/* PORTAL-NEXT V2 — Network Guard (Gate 19).
   Foundation is expected to make ZERO calls to any real backend. This
   wraps fetch/XHR to LOG (never silently allow-and-ignore) any request
   whose target host matches a known real-backend pattern, and exposes
   a simple counter tests/browser checks can read. It does not block
   local requests (same-origin static files) — it only watches for the
   specific hosts Foundation must never reach.

   GL-1K: the app's own hosting origin is never itself a "real backend",
   on any host it happens to be served from -- a relative fetch (e.g.
   config/module-registry.json) resolves against location.href, so once
   V2 was actually served live from luisgamadio-spec.github.io (GL-1J),
   its own same-origin static-file requests started matching that
   hostname's pattern below and were misclassified. Fixed at the
   semantic level (same-origin is checked first, unconditionally) rather
   than by special-casing that one file/hostname, so this can't recur
   for any future hosting origin (e.g. a later custom domain). The
   luisgamadio-spec.github.io pattern is removed from
   REAL_BACKEND_HOST_PATTERNS below as redundant/dead now that the
   same-origin check already excludes it, and misleading to keep --
   this app never calls its own hosting origin as a separate backend. */
(function () {
  'use strict';

  var REAL_BACKEND_HOST_PATTERNS = [
    /\.supabase\.co$/i,
    /supabase\.co$/i,
    /api\.openai\.com$/i,
    /brabus\.blistiq\.com\.br$/i
  ];

  window.NX_NETWORK_GUARD = {
    flaggedRequests: [],
    isRealBackendUrl: function (url) {
      try {
        var u = new URL(url, location.href);
        if (u.origin === location.origin) return false;
        return REAL_BACKEND_HOST_PATTERNS.some(function (re) { return re.test(u.hostname); });
      } catch (e) {
        return false;
      }
    }
  };

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (window.NX_NETWORK_GUARD.isRealBackendUrl(url)) {
        window.NX_NETWORK_GUARD.flaggedRequests.push({ method: 'fetch', url: url, at: new Date().toISOString() });
        // the full request URL is development info: console only on localhost with ?debug=1
        if (window.NX_DEV && window.NX_DEV.ativo) console.error('[network-guard] BLOCKED-BY-POLICY (flagged, not silently allowed): fetch to real backend host:', url);
      }
      return origFetch.apply(this, arguments);
    };
  }

  var OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    var origOpen = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function (method, url) {
      if (window.NX_NETWORK_GUARD.isRealBackendUrl(url)) {
        window.NX_NETWORK_GUARD.flaggedRequests.push({ method: 'xhr:' + method, url: url, at: new Date().toISOString() });
        if (window.NX_DEV && window.NX_DEV.ativo) console.error('[network-guard] FLAGGED: XHR to real backend host:', url);
      }
      return origOpen.apply(this, arguments);
    };
  }
})();
