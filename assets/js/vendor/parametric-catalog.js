/* =====================================================================
   DESIGN-MOTION-LAB-03 — Parametric Signature Exploration
   5 interpretations of the same conceptual family (Parametric Ribbons —
   the user's current favorite). Same draw(ctx,W,H,t,c,speed,state)
   contract as DML-02's engine.js so the shared engine mounts these
   unmodified. c.primary/c.neutral1/c.neutral2 arrive resolved — no
   motion here reads a token directly (Color Discipline preserved).
   CURRENT is byte-identical to DML-02's parametric_ribbons algorithm —
   brief explicitly forbids improving/reinterpreting it (it's the
   baseline for every comparison in this phase).
   ===================================================================== */
(function(){

function rgba(hex, a){
  hex = hex.replace('#','');
  var r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* ---------- CURRENT — exact DML-02 parametric_ribbons, unaltered ---------- */
function parametricCurrent(ctx,W,H,t,c,speed){
  var RIBBONS = [{a:3,b:2,phase:0},{a:2,b:5,phase:1.4},{a:5,b:4,phase:2.8}];
  RIBBONS.forEach(function(r,i){
    var tt = t*0.00009*speed + r.phase;
    ctx.beginPath();
    var steps=80;
    for (var s=0;s<=steps;s++){
      var u = s/steps*Math.PI*2;
      var x = W/2 + Math.sin(r.a*u+tt)*W*0.38;
      var y = H/2 + Math.sin(r.b*u)*H*0.32;
      if (s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = rgba(i===0?c.primary:c.neutral1, 0.22-i*0.04);
    ctx.lineWidth=0.9;
    ctx.stroke();
  });
}

/* ---------- SCULPTURAL — fewer/larger ribbons, controlled thickness
   variation reads as a surface being shaped by the flow, not a car. ---------- */
function parametricSculptural(ctx,W,H,t,c,speed){
  var RIBBONS = [{a:2,b:3,phase:0, ampY:0.30},{a:3,b:2,phase:2.4, ampY:0.22}];
  RIBBONS.forEach(function(r,i){
    var tt = t*0.00004*speed + r.phase;
    var steps = 90, pts = [];
    for (var s=0;s<=steps;s++){
      var u = s/steps*Math.PI*2;
      pts.push([
        W/2 + Math.sin(r.a*u+tt)*W*(0.40 - i*0.03),
        H/2 + Math.sin(r.b*u+tt*0.6)*H*r.ampY
      ]);
    }
    for (var s2=0; s2<steps; s2++){
      var u2 = s2/steps*Math.PI*2;
      var thickness = Math.max(0.5, Math.min(2.6, 1.25 + Math.sin(u2*2+tt)*0.9));
      var alpha = (i===0? 0.30 : 0.16) * (0.55 + 0.45*Math.sin(u2*2+tt+1.4));
      ctx.beginPath();
      ctx.moveTo(pts[s2][0], pts[s2][1]);
      ctx.lineTo(pts[s2+1][0], pts[s2+1][1]);
      ctx.strokeStyle = rgba(i===0?c.primary:c.neutral1, Math.max(0.04,alpha));
      ctx.lineWidth = thickness;
      ctx.stroke();
    }
  });
}

/* ---------- PRECISION — same fluid family as Current + rare, discreet
   cross-tick markers at points along the ribbon. No numbers/HUD/scanner;
   spawn rate is low and each marker fades over 1.5s, max 2 concurrent. ---------- */
function parametricPrecision(ctx,W,H,t,c,speed,state){
  var RIBBONS = [{a:3,b:2,phase:0},{a:2,b:5,phase:1.4},{a:5,b:4,phase:2.8}];
  var allPts = [];
  RIBBONS.forEach(function(r,i){
    var tt = t*0.00009*speed + r.phase;
    var steps=80, pts=[];
    ctx.beginPath();
    for (var s=0;s<=steps;s++){
      var u = s/steps*Math.PI*2;
      var x = W/2 + Math.sin(r.a*u+tt)*W*0.38;
      var y = H/2 + Math.sin(r.b*u)*H*0.32;
      pts.push([x,y]);
      if (s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = rgba(i===0?c.primary:c.neutral1, 0.22-i*0.04);
    ctx.lineWidth=0.9;
    ctx.stroke();
    allPts.push(pts);
  });

  state.events = state.events || [];
  if (Math.random() < 0.0006*speed && state.events.length < 2){
    var ri = Math.floor(Math.random()*allPts.length);
    var pi = Math.floor(Math.random()*allPts[ri].length);
    state.events.push({pt: allPts[ri][pi], born:t, life:1500});
  }
  state.events = state.events.filter(function(e){ return (t-e.born) < e.life; });
  state.events.forEach(function(e){
    var age=(t-e.born)/e.life, a = Math.sin(age*Math.PI)*0.55, sz = 4 + age*2;
    ctx.strokeStyle = rgba(c.primary, a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.pt[0]-sz, e.pt[1]); ctx.lineTo(e.pt[0]+sz, e.pt[1]);
    ctx.moveTo(e.pt[0], e.pt[1]-sz); ctx.lineTo(e.pt[0], e.pt[1]+sz);
    ctx.stroke();
  });
}

/* ---------- FLOW — parametric geometry sampled through a moving window
   (not a fixed closed loop) so the ribbon reads as carried by an
   invisible directional field, echoing Aerodynamic Flow's continuity
   without copying its implementation or overlaying two canvases.
   Alpha/width taper along the window (faint where the field is
   "arriving", fuller where it's "departing") makes the directionality
   legible even in a single frame — not just while animating — so Flow
   stays distinguishable from Current's closed, uniform-weight loop at
   a glance, per the diversity requirement. ---------- */
function parametricFlow(ctx,W,H,t,c,speed){
  var RIBBONS = [{a:3,b:2},{a:2,b:5},{a:5,b:4}];
  RIBBONS.forEach(function(r,i){
    var uStart = t*0.00011*speed + i*2.1;
    var coverage = Math.PI*2.6;
    var steps = 70;
    var baseAlpha = 0.24 - i*0.04;
    for (var s=0;s<steps;s++){
      var u0 = uStart + (s/steps)*coverage;
      var u1 = uStart + ((s+1)/steps)*coverage;
      var x0 = W/2 + Math.sin(r.a*u0)*W*0.38, y0 = H/2 + Math.sin(r.b*u0 + u0*0.15)*H*0.30;
      var x1 = W/2 + Math.sin(r.a*u1)*W*0.38, y1 = H/2 + Math.sin(r.b*u1 + u1*0.15)*H*0.30;
      var taper = s/steps; // 0 at the trailing/arriving end -> 1 at the leading/departing end
      ctx.beginPath();
      ctx.moveTo(x0,y0); ctx.lineTo(x1,y1);
      ctx.strokeStyle = rgba(i===0?c.primary:c.neutral1, Math.max(0.02, baseAlpha*taper));
      ctx.lineWidth = 0.6 + taper*0.7;
      ctx.stroke();
    }
  });
}

/* ---------- REACTIVE — Current's ambient formula; on triggerReaction()
   (called by the host page only on group/module context change) a short
   ease-out deformation (amplitude + phase ripple) decays back to the
   identical ambient baseline over 900ms. No trigger => pixel-identical
   to Current. ---------- */
function parametricReactive(ctx,W,H,t,c,speed,state){
  var RIBBONS = [{a:3,b:2,phase:0},{a:2,b:5,phase:1.4},{a:5,b:4,phase:2.8}];
  var REACT_DUR = 900;
  var reactAge = state._reactAt != null ? (t - state._reactAt) : Infinity;
  var reactFactor = 0;
  if (reactAge >= 0 && reactAge < REACT_DUR){
    var p = reactAge/REACT_DUR;
    reactFactor = (1-p)*(1-p) * (state._reactMult != null ? state._reactMult : 1);
  }
  RIBBONS.forEach(function(r,i){
    var tt = t*0.00009*speed + r.phase;
    var ampBoost = 1 + reactFactor*0.16;
    var phaseShift = reactFactor*0.35*(i%2===0?1:-1);
    ctx.beginPath();
    var steps=80;
    for (var s=0;s<=steps;s++){
      var u = s/steps*Math.PI*2;
      var x = W/2 + Math.sin(r.a*u+tt+phaseShift)*W*0.38*ampBoost;
      var y = H/2 + Math.sin(r.b*u)*H*0.32*ampBoost;
      if (s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    var alpha = Math.min(0.5, (0.22-i*0.04) * (1 + reactFactor*0.5));
    ctx.strokeStyle = rgba(i===0?c.primary:c.neutral1, alpha);
    ctx.lineWidth = 0.9 + reactFactor*0.5;
    ctx.stroke();
  });
}

/* =====================================================================
   CATALOG — 5 variants. defaultConfig is the "Reset Variant" target;
   these are experimental starting points, not final values.
   ===================================================================== */
window.MOTION_CATALOG = [
  { id:'parametric_current', name:'Parametric — Current', concept:'Baseline exato do favorito atual (Parametric Ribbons) — não melhorado, não reinterpretado.', tech:'Canvas 2D', categories:['signature'], draw:parametricCurrent, defaultOpacity:20, opacityRange:[3,25], defaultSpeed:1, mobile:'FULL', signature:0, technicalRank:null, usefulness:['signature'],
    defaultConfig:{opacity:20, speed:1, scale:130, blend:'screen', position:'center', colorMode:'accent', customColor:'#ce3b45', reactionIntensity:'standard'} },
  { id:'parametric_sculptural', name:'Parametric — Sculptural', concept:'Menos ribbons, curvas maiores, mais espaço negativo, espessura variável — presença escultural automotiva sem literalidade.', tech:'Canvas 2D', categories:['signature'], draw:parametricSculptural, defaultOpacity:14, opacityRange:[3,25], defaultSpeed:0.5, mobile:'FULL', signature:0, technicalRank:null, usefulness:['signature'],
    defaultConfig:{opacity:14, speed:0.5, scale:150, blend:'screen', position:'center', colorMode:'accent', customColor:'#ce3b45', reactionIntensity:'standard'} },
  { id:'parametric_precision', name:'Parametric — Precision', concept:'Fluidez do Parametric + eventos raros e discretos de engenharia de precisão, integrados às ribbons.', tech:'Canvas 2D', categories:['signature'], draw:parametricPrecision, defaultOpacity:16, opacityRange:[3,25], defaultSpeed:0.75, mobile:'FULL', signature:0, technicalRank:null, usefulness:['signature'],
    defaultConfig:{opacity:16, speed:0.75, scale:130, blend:'screen', position:'center', colorMode:'accent', customColor:'#ce3b45', reactionIntensity:'standard'} },
  { id:'parametric_flow', name:'Parametric — Flow', concept:'Nova linguagem: geometria/ritmo do Parametric conduzidos por um campo direcional contínuo, na tradição do Aerodynamic Flow.', tech:'Canvas 2D', categories:['signature'], draw:parametricFlow, defaultOpacity:16, opacityRange:[3,25], defaultSpeed:0.75, mobile:'FULL', signature:0, technicalRank:null, usefulness:['signature'],
    defaultConfig:{opacity:16, speed:0.75, scale:130, blend:'screen', position:'center', colorMode:'accent', customColor:'#ce3b45', reactionIntensity:'standard'} },
  { id:'parametric_reactive', name:'Parametric — Reactive', concept:'Estado ambiente calmo (idêntico ao Current); responde com deformação curta a trocas de grupo/módulo, sem competir com o Context Beam.', tech:'Canvas 2D', categories:['signature'], draw:parametricReactive, defaultOpacity:18, opacityRange:[3,25], defaultSpeed:1, mobile:'FULL', signature:0, technicalRank:null, usefulness:['signature'],
    defaultConfig:{opacity:18, speed:1, scale:130, blend:'screen', position:'center', colorMode:'accent', customColor:'#ce3b45', reactionIntensity:'standard'} }
];

window.MOTION_ENGINE_HELPERS = { rgba: rgba };
})();
