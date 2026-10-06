/* PORTAL-NEXT V2 — Launch Experience (prototype, LOCAL-ONLY, never
   published). Presents a one-time, full-screen video overlay right
   after a successful login, before the normal Home paints over it.

   Mounts its OWN dedicated node, appended directly to <body> (id=
   "nxLaunchXpRoot", z-index:9999 -- see launch-experience.css's own
   header for why the shared #nxOverlayRoot, z-index:100, was tried
   first and rejected: .nxDevBadge is deliberately z-index:150, above
   it, by pre-existing design out of this prototype's scope to touch).
   Same create-on-open/remove-on-close discipline as the codebase's
   existing overlay roots, just on a dedicated node instead of a
   shared one.

   WHO CALLS THIS: shell.js's AUTHORIZED branch, one line, after the
   existing reveal logic -- see that file's own comment at the call
   site. This file never touches auth-core.js/login.js/auth-boundary.js
   and never gates/delays the real portal boot -- #nxRoot is already
   visible and already rendering Home behind this overlay; this overlay
   only dominates the screen visually (full-bleed, opaque black, its
   own z-index above everything else in the document).

   FUTURE (not implemented here, per this prototype's explicit scope):
   showing this only on the very first access after a real product
   launch would need a durable, server-known flag (not localStorage,
   which is per-browser/per-device and clearable by the user) -- e.g.
   a column on the user/profile row, checked once at login. No schema
   change, no Supabase call, and no migration were made for that here;
   this prototype intentionally stays 100% client-local per its own
   mandate. */
(function () {
  'use strict';

  var SEEN_KEY = 'nxLaunchExperienceSeenV1';
  var VIDEO_SRC = 'assets/video/portal-v2-launch-v7.mp4';

  // Convenience for repeated local testing (mandate section 6/9): a
  // "?resetLaunch=1" query param clears the seen-flag before it is
  // even checked, so reloading the URL with this param is enough to
  // force the experience again without opening devtools. This reads
  // the query string only -- never writes one, never redirects.
  try {
    if (/[?&]resetLaunch=1(&|$)/.test(window.location.search)) {
      window.localStorage.removeItem(SEEN_KEY);
    }
  } catch (e) { /* localStorage unavailable (private mode / disabled) -- degrade to "always show" below */ }

  function hasBeenSeen() {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; }
    catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* non-fatal -- prototype, local only */ }
  }

  function reducedMotion() {
    return !!(window.MotionEngine && window.MotionEngine.reduce) ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  var active = false; // guards against a double-mount if AUTHORIZED fires twice in one session

  function cleanup(wrap) {
    var video = document.getElementById('nxLaunchXpVideo');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load(); // releases the buffered media resource, never left decoding in the background
    }
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    document.body.classList.remove('nxLaunchXpOpen');
    active = false;
  }

  function present() {
    if (active) return;
    active = true;
    document.body.classList.add('nxLaunchXpOpen');
    var wrap = document.createElement('div');
    wrap.className = 'nxLaunchXp';
    wrap.id = 'nxLaunchXpRoot';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Apresentação de lançamento');
    wrap.innerHTML =
      '<video class="nxLaunchXpVideo" id="nxLaunchXpVideo" src="' + VIDEO_SRC + '" playsinline></video>' +
      '<button type="button" class="nxLaunchXpSkip" id="nxLaunchXpSkipBtn">Pular apresentação</button>';
    document.body.appendChild(wrap);

    var video = document.getElementById('nxLaunchXpVideo');
    var skipBtn = document.getElementById('nxLaunchXpSkipBtn');
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      markSeen();
      if (reducedMotion()) { cleanup(wrap); return; }
      wrap.classList.add('isLeaving');
      var done = false;
      var onEnd = function () { if (done) return; done = true; cleanup(wrap); };
      wrap.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 900); // fallback in case transitionend never fires (e.g. tab backgrounded)
    }

    video.addEventListener('ended', finish);
    skipBtn.addEventListener('click', finish);

    // Autoplay sequence (mandate section 5): try real (unmuted) autoplay
    // first. If the browser rejects it (NotAllowedError, the standard
    // outcome for unmuted autoplay almost everywhere), show ONE clear
    // tap-to-start affordance instead of any muted-then-unmute trick.
    var playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(function () {
        if (finished) return; // video could have already ended/been skipped synchronously in a fast test
        var startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'nxLaunchXpStart';
        startBtn.id = 'nxLaunchXpStartBtn';
        startBtn.setAttribute('aria-label', 'Iniciar apresentação com áudio');
        startBtn.innerHTML =
          '<span class="nxLaunchXpStartInner">' +
            '<span class="nxLaunchXpStartIcon"></span>' +
            '<span class="nxLaunchXpStartLabel">Iniciar com áudio</span>' +
          '</span>';
        startBtn.addEventListener('click', function () {
          startBtn.remove();
          video.play(); // inside a real user gesture now -- audio is allowed
        });
        wrap.appendChild(startBtn);
      });
    }
  }

  window.NX_LAUNCH_EXPERIENCE = {
    // Called once, right after the portal is revealed (shell.js). A
    // no-op when already seen this browser/device, or when another
    // call is already active (idempotent, safe to call more than
    // once).
    presentIfNeeded: function () {
      if (hasBeenSeen()) return;
      present();
    },
    // Local test helper (mandate section 9) -- not a public feature,
    // never referenced from product UI. Use from the browser console:
    // window.NX_LAUNCH_EXPERIENCE.reset() then reload, or navigate to
    // index.html?resetLaunch=1.
    reset: function () {
      try { window.localStorage.removeItem(SEEN_KEY); } catch (e) { /* no-op */ }
    }
  };
})();
