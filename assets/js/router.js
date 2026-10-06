/* PORTAL-NEXT V2 — Router Foundation (Gate 11).
   Hash-based routing: #/<module-id>. Deep links work (a hash URL
   opened cold resolves to that route on load) and reload preserves
   the route (the hash is part of the URL, survives a real reload,
   unlike in-memory state). No production routes are implemented here
   — this only proves the mechanism against the placeholder registry. */
(function () {
  'use strict';

  var listeners = [];

  function currentRouteId() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return h || null;
  }

  function navigate(routeId) {
    var target = '#/' + routeId;
    if (location.hash !== target) {
      location.hash = target;
    } else {
      dispatch(routeId);
    }
  }

  function dispatch(routeId) {
    listeners.forEach(function (fn) {
      try { fn(routeId); } catch (e) { console.error('[router] listener error', e); }
    });
  }

  window.addEventListener('hashchange', function () {
    dispatch(currentRouteId());
  });

  window.NX_ROUTER = {
    navigate: navigate,
    currentRouteId: currentRouteId,
    onChange: function (fn) { listeners.push(fn); },
    // Called once on boot so a deep link (cold load with a hash
    // already present) resolves immediately, not only on the next
    // hashchange event.
    resolveInitial: function () { dispatch(currentRouteId()); }
  };
})();
