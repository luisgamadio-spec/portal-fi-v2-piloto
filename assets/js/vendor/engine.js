/* =====================================================================
   Shared mount engine — copied from DML-02.1's homologated engine.js
   (resize, per-motion persistent state, IntersectionObserver+visibility
   pausing with forcePaused, reduced-motion) plus ONE addition:
   triggerReaction(mult), used only by Parametric — Reactive to receive
   context-change events from the host page without any polling.
   ===================================================================== */
(function(){

var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resolveColor(colorMode, customColor){
  var css = getComputedStyle(document.documentElement);
  switch(colorMode){
    case 'brand_red': return (css.getPropertyValue('--brand-red').trim()) || '#c1121f';
    case 'mono_light': return '#eef0f1';
    case 'titanium': return '#b7ab9a';
    case 'custom': return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(customColor||'') ? customColor : '#ee4b57';
    case 'accent':
    default: return (css.getPropertyValue('--accent-primary').trim()) || '#ee4b57';
  }
}

function mountMotion(canvas, motionId, opts){
  opts = opts || {};
  var entry = window.MOTION_CATALOG.filter(function(m){ return m.id === motionId; })[0];
  if (!entry) return {destroy:function(){}, setOpts:function(){}, triggerReaction:function(){}};
  if (reduce){
    return {destroy:function(){}, setOpts:function(){}, triggerReaction:function(){}, isStatic:true};
  }

  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W, H;
  function resize(){
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (W<=0||H<=0) return;
    canvas.width = W*dpr; canvas.height = H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();
  var ro = new ResizeObserver(resize);
  ro.observe(canvas);

  var state = {};
  var running = true;
  var speed = opts.speed != null ? opts.speed : entry.defaultSpeed;
  var colorMode = opts.colorMode || 'accent';
  var customColor = opts.customColor || '#ee4b57';
  var t = 0, raf = null;

  function neutralColors(){
    return { neutral1: 'rgba(255,255,255,.4)', neutral2: 'rgba(255,255,255,.2)' };
  }

  function frame(){
    if (!running || W<=0 || H<=0){ raf = requestAnimationFrame(frame); return; }
    ctx.clearRect(0,0,W,H);
    var primary = resolveColor(colorMode, customColor);
    var n = neutralColors();
    entry.draw(ctx, W, H, t, {primary:primary, neutral1:n.neutral1, neutral2:n.neutral2}, speed, state);
    t += 16;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  var forcePaused = false;
  var lastIntersecting = true;
  function recompute(){ running = !forcePaused && lastIntersecting && document.visibilityState === 'visible'; }

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ lastIntersecting = en.isIntersecting; });
    recompute();
  }, {threshold:0.05});
  io.observe(canvas);
  var visHandler = function(){ recompute(); };
  document.addEventListener('visibilitychange', visHandler);

  return {
    setOpts: function(o){
      if (o.speed != null) speed = o.speed;
      if (o.colorMode != null) colorMode = o.colorMode;
      if (o.customColor != null) customColor = o.customColor;
    },
    /* Only meaningful for parametric_reactive's draw fn (reads
       state._reactAt/_reactMult); harmless no-op for the other 4
       motions since their draw fns never look at those state keys. */
    triggerReaction: function(mult){ state._reactAt = t; state._reactMult = mult; },
    pause: function(){ forcePaused = true; recompute(); },
    resume: function(){ forcePaused = false; recompute(); },
    destroy: function(){
      running = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', visHandler);
    }
  };
}

window.MotionEngine = { mount: mountMotion, resolveColor: resolveColor, reduce: reduce };
})();
