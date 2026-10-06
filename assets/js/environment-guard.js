/* PORTAL-NEXT V2 -- Environment Guard (Gate 18, redesigned GL-1C,
   extended GL-ENV-AUTH-WRITE-BOUNDARY).

   REDESIGNED (Go-Live deployment reconciliation, GL-1C): the original
   contract was "block every hostname that merely LOOKS like a
   production host" (a hardcoded *.github.io / brabus.blistiq.com.br
   pattern list), which had no path to ever legitimately authorize a
   real V2 deployment -- it could only ever say STOP. That made sense
   before any real deployment was planned; it does not once Strategy B
   (V2's own standalone GitHub Pages deployment) is the intended target.

   EXTENDED (GL-ENV-AUTH-WRITE-BOUNDARY): the preceding read-only audit
   found that a two-state "allowed vs unknown" model, with every
   allowed host uniformly labeled AUTHORIZED_PRODUCTION, was itself the
   root cause of R1/R2 -- it gave GitHub Pages homologation
   (luisgamadio-spec.github.io) the exact same classification as real
   production, which write-safety providers elsewhere then read as
   license to allow real writes there. "Host is allowed to load V2" and
   "host is production" are now two separate concepts, read from two
   separately-named config fields (never both true for the same host in
   real use, since index.html's own host-conditional loader only ever
   loads ONE real-credentialed config file per host).

   CONTRACT -- exactly four states, always exactly one applies:

     LOCAL_DEV              -- hostname is localhost/127.0.0.1. Always
                               allowed, unconditionally.
     AUTHORIZED_HOMOLOGATION -- hostname is NOT local dev, AND the
                               hostname appears in
                               `authorizedHomologationHostnames`
                               (intelligence-runtime-config.homolog.js,
                               loaded only on the proven GitHub Pages
                               homologation hostname). MUST NEVER be
                               treated as production by any consumer --
                               this is the whole point of the split.
     AUTHORIZED_PRODUCTION   -- hostname is NOT local dev, AND the
                               hostname appears in the production
                               runtime config's own `authorizedHostnames`
                               array (intelligence-runtime-config.js,
                               overridden by .production.js on a real
                               host). This authorization can ONLY come
                               from that server-shipped, hand-maintained
                               config file -- never from a client-
                               editable query parameter, localStorage
                               value, or any other client-controlled
                               signal, since the whole point of this
                               guard is that a client cannot self-
                               authorize its own host. Checked BEFORE
                               homologation so a host mistakenly listed
                               in both would resolve as production, the
                               safer of the two failure directions for
                               that specific conflict.
     UNKNOWN_HOST            -- none of the above. FAIL CLOSED --
                               refuses to render. This remains the
                               DEFAULT for every host not explicitly
                               recorded in a real config file by a
                               Human -- intelligence-runtime-config.js's
                               own committed defaults for both hostname
                               fields are empty arrays.

   TIMING NOTE: the actual authorization decision is deliberately made
   inside the DOMContentLoaded handler below, not at top-level script
   execution. This file may load before the environment-specific config
   file in index.html's current script order; by the time
   DOMContentLoaded fires, every earlier synchronous <script> tag
   (including the config file, wherever it sits in the document) has
   already executed, so window.NX_INTELLIGENCE_CONFIG is guaranteed to
   be populated by then. This avoids requiring a script-order change in
   index.html as part of this guard redesign. */
(function () {
  'use strict';

  var LOCAL_DEV_HOSTNAMES = ['localhost', '127.0.0.1'];

  function classifyEnvironment() {
    var host = (typeof location !== 'undefined' && location.hostname) || '';
    var isLocalDev = LOCAL_DEV_HOSTNAMES.indexOf(host) !== -1;

    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    var authorizedProductionHostnames = Array.isArray(cfg.authorizedHostnames) ? cfg.authorizedHostnames : [];
    var authorizedHomologationHostnames = Array.isArray(cfg.authorizedHomologationHostnames) ? cfg.authorizedHomologationHostnames : [];
    var isAuthorizedProduction = !isLocalDev && authorizedProductionHostnames.indexOf(host) !== -1;
    var isAuthorizedHomologation = !isLocalDev && !isAuthorizedProduction && authorizedHomologationHostnames.indexOf(host) !== -1;

    var name = isLocalDev ? 'LOCAL_DEV'
      : (isAuthorizedProduction ? 'AUTHORIZED_PRODUCTION'
      : (isAuthorizedHomologation ? 'AUTHORIZED_HOMOLOGATION'
      : 'UNKNOWN_HOST'));
    return { name: name, hostname: host, allowed: name !== 'UNKNOWN_HOST' };
  }

  // A preliminary classification is published immediately (before
  // DOMContentLoaded) so any code that merely wants to READ the
  // environment name early (e.g. for a log line) can do so -- but this
  // preliminary read may be based on an authorizedHostnames list that
  // hasn't loaded yet, so `allowed` here is advisory only. The
  // authoritative, enforced decision is the one computed again inside
  // DOMContentLoaded below, after every earlier script has executed.
  window.NX_ENVIRONMENT = classifyEnvironment();
  window.NX_ENVIRONMENT.checkedAt = new Date().toISOString();

  // Development aids (diagnostic blocks, dev badge, design trace, verbose console):
  // ONLY on localhost/127.0.0.1 AND with ?debug=1 in the URL — never on homolog or
  // production, whatever the URL says. Hostname-only, so it is safe to read early.
  window.NX_DEV = (function () {
    var host = (typeof location !== 'undefined' && location.hostname) || '';
    var debug = false;
    try { debug = new URLSearchParams(location.search).get('debug') === '1'; } catch (e) { debug = false; }
    var ativo = LOCAL_DEV_HOSTNAMES.indexOf(host) !== -1 && debug;
    return {
      ativo: ativo,
      log: function () { if (ativo && window.console) console.log.apply(console, arguments); },
      warn: function () { if (ativo && window.console) console.warn.apply(console, arguments); }
    };
  })();
  window.NX_ENVIRONMENT.production = false; // legacy field, preserved for any existing consumer; superseded by .name

  document.addEventListener('DOMContentLoaded', function () {
    var result = classifyEnvironment();
    result.checkedAt = new Date().toISOString();
    result.production = result.name === 'AUTHORIZED_PRODUCTION';
    window.NX_ENVIRONMENT = result;

    if (!result.allowed) {
      document.body.innerHTML =
        '<pre style="padding:24px;font-family:monospace;white-space:pre-wrap">' +
        'ENVIRONMENT GUARD STOP\n\n' +
        'This is PORTAL-NEXT V2 and it is running on a hostname (' + result.hostname + ') ' +
        'that is not recognized as LOCAL_DEV and does not appear in this build\'s ' +
        'authorizedHostnames (production) or authorizedHomologationHostnames (homolog) ' +
        'allowlists. Refusing to render.\n\n' +
        'If this IS an intended host, a Human must record it in ' +
        'assets/js/intelligence-runtime-config.production.js\'s authorizedHostnames array ' +
        '(for production) or intelligence-runtime-config.homolog.js\'s ' +
        'authorizedHomologationHostnames array (for homologation) -- this cannot be ' +
        'self-authorized from the browser.' +
        '</pre>';
      console.error('[environment-guard] STOP: unauthorized/unknown host:', result.hostname);
    }
  });
})();
