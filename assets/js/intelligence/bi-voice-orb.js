/* PORTAL-NEXT V2 — Brabus Intelligence VOICE ORB (visual only).

   The "Fluid Aperture" presence recovered from the removed
   intelligence-voice-focus.js (commit 9e92915^, drawFluidAperture /
   orbMetaForState / ensureOrbColors). Only the drawing is
   reused: no session, endpoint or state machine from the old voice
   stack comes back. The panel tells the orb its state and, while
   listening or speaking, hands it an AnalyserNode to read amplitude.

   States: 'repouso' | 'ouvindo' | 'pensando' | 'falando'.
   prefers-reduced-motion: one static frame per state change, no loop. */
(function () {
  'use strict';

  var orbColors = null;
  function ensureOrbColors() {
    if (orbColors) return orbColors;
    var css = getComputedStyle(document.documentElement);
    orbColors = {
      brand: (css.getPropertyValue('--color-brand-red').trim() || '#c1121f'),
      primary: (css.getPropertyValue('--color-accent-primary').trim() || '#ee4b57'),
      warning: (css.getPropertyValue('--mod-warning').trim() || '#dba648')
    };
    return orbColors;
  }

  // Same numbers as the original STATE_META (LISTENING / THINKING / SPEAKING / idle).
  function orbMetaForState(state) {
    switch (state) {
      case 'ouvindo': return { breathe: 0.3, direction: -1 };
      case 'pensando': return { breathe: 0.5, direction: 0, traveling: true };
      case 'falando': return { breathe: 0.3, direction: 1 };
      default: return { breathe: 0.15, direction: 0 };
    }
  }

  function reduceMotionPreferred() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0;
    var state = 'repouso';
    var analyser = null, buf = null;
    var rafId = null;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (w === W && h === H && canvas.width === w * dpr) return;
      W = w; H = h;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function amplitude() {
      if (!analyser) return 0;
      if (!buf || buf.length !== analyser.frequencyBinCount) buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) sum += buf[i];
      // speech rarely averages above ~0.35 of full scale; stretch it to 0..1
      return Math.min(1, (sum / (buf.length * 255)) * 2.8);
    }

    function drawFluidAperture(t, amp) {
      if (W <= 0 || H <= 0) return;
      var meta = orbMetaForState(state);
      var c = ensureOrbColors();
      var cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.42;
      var energy = amp;
      var breathe = Math.sin(t * 0.001) * 0.03 * meta.breathe;

      ctx.clearRect(0, 0, W, H);
      ctx.beginPath();
      var pts = 48;
      for (var s = 0; s <= pts; s++) {
        var a = (s / pts) * Math.PI * 2;
        var deform = Math.sin(a * 3 + t * 0.0007) * 0.10 + Math.sin(a * 5 - t * 0.0005) * 0.05;
        var r = R * (1 + breathe + deform * (0.4 + energy * 1.1) * (meta.direction >= 0 ? 1 : 0.6));
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.94;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // tokens may be any CSS color, so opacity goes through globalAlpha
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = state === 'pensando' ? c.warning : c.brand;
      ctx.lineWidth = 1.7 + energy * 1.2;
      ctx.stroke();

      // inner seam: opens with energy; while thinking it travels around the aperture
      var seamCenter = Math.PI / 2;
      if (meta.traveling) seamCenter += Math.sin(t * 0.0003) * 0.6;
      var openAngle = 0.25 + energy * 0.5 * (meta.direction >= 0 ? 1 : 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.55, seamCenter - openAngle, seamCenter + openAngle);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = c.primary;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function loop(ts) {
      resize();
      drawFluidAperture(ts || performance.now(), amplitude());
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function start() {
      stop();
      resize();
      if (reduceMotionPreferred()) { drawFluidAperture(0, 0); return; }
      rafId = requestAnimationFrame(loop);
    }

    return {
      setState: function (s) {
        state = s;
        if (s === 'repouso') { stop(); analyser = null; if (W > 0) ctx.clearRect(0, 0, W, H); return; }
        start();
      },
      setAnalyser: function (a) { analyser = a || null; },
      destroy: function () { stop(); analyser = null; }
    };
  }

  window.NX_BI_VOICE_ORB = { create: create };
})();
