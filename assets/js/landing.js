/* PORTAL-NEXT V2 — Landing (Gate 8: TRANSPLANT + CONTROLLED ADAPTATION).
   STRUCTURE: transplanted verbatim from design-system-2.1/references/
   baselines/module-landing-approved/{pages.js,app.js} — same class
   names, same DOM nesting, same interaction model (hover/focus/click
   selects a category, module block click navigates, Context Beam
   fires only on an actual category/route change, respects
   prefers-reduced-motion throughout).
   TOKENS: design-system-2/tokens.css (linked, not copied).
   CONTENT: config/module-registry.json + config/landing-groups.json
   (V2's real modules — see docs/LANDING-CONTENT-MAP.md for the
   mapping decision).
   ROUTING: V2's own router.js (NX_ROUTER), not the reference's hash
   resolver.
   MOTION: design-motion-lab-03/engine.js (window.MotionEngine, linked
   directly — not reimplemented, per Gate 9/11). */
(function () {
  'use strict';

  /* ---------- Shell Wave 2A.1: sidebar iconography ----------
     One restrained, monochromatic line-icon family (20x20 viewBox,
     stroke=currentColor, no fill, 1.6 stroke width, round caps/joins)
     replacing the prior two-letter codes. Inline SVG, no external
     icon dependency. Semantic pairing per the Wave 2A.1 brief: dashbi
     = analytics bars, gestao = trend/financial line, score =
     performance gauge, coparticipado = linked participation, the two
     simulators = a shared car glyph (seminovos adds a small renewal
     arrow to read as "usado/revenda" without a second, unrelated
     pictogram), shell-admin = shield. */
  var NAV_ICON_PATHS = {
    dashbi: '<path d="M3 17V10"/><path d="M10 17V4"/><path d="M17 17V13"/>',
    gestao: '<path d="M3 14l4-4 3 3 7-7"/><path d="M13 6h4v4"/>',
    score: '<path d="M3 15a7 7 0 0 1 14 0"/><path d="M10 15l3.5-4.5"/><circle cx="10" cy="15" r="1"/>',
    coparticipado: '<path d="M8.3 12a3 3 0 0 1 0-4.2l1.6-1.6a3 3 0 0 1 4.2 4.2l-.9.9"/><path d="M11.7 8a3 3 0 0 1 0 4.2l-1.6 1.6a3 3 0 0 1-4.2-4.2l.9-.9"/>',
    'salarios-comissoes': '<path d="M8.3 12a3 3 0 0 1 0-4.2l1.6-1.6a3 3 0 0 1 4.2 4.2l-.9.9"/><path d="M11.7 8a3 3 0 0 1 0 4.2l-1.6 1.6a3 3 0 0 1-4.2-4.2l.9-.9"/>',
    'simulador-novos': '<path d="M3 13.4l1.2-3.8A1.8 1.8 0 0 1 5.9 8.3h8.2a1.8 1.8 0 0 1 1.7 1.3l1.2 3.8"/><path d="M2.6 13.4h14.8v1.9a.8.8 0 0 1-.8.8h-1a1.1 1.1 0 0 1-1.1-1.1v-.3H5.5v.3a1.1 1.1 0 0 1-1.1 1.1h-1a.8.8 0 0 1-.8-.8v-1.9z"/><circle cx="6" cy="13.6" r="1"/><circle cx="14" cy="13.6" r="1"/>',
    'simulador-seminovos': '<path d="M2.5 13.2l.9-2.9A1.5 1.5 0 0 1 4.8 9.2h5.5"/><path d="M2.2 13.2h9.3v1.5a.7.7 0 0 1-.7.7h-.7a1 1 0 0 1-1-1v-.2H4.9v.2a1 1 0 0 1-1 1h-.7a.7.7 0 0 1-.7-.7v-1.5z"/><circle cx="4.4" cy="13.4" r=".9"/><circle cx="9.4" cy="13.4" r=".9"/><path d="M14.2 6.3a2.8 2.8 0 1 1-2.5 4.2"/><path d="M14.2 4.4v1.9h-1.9"/>',
    'shell-admin': '<path d="M10 3.2l5.5 1.8v4.4c0 3.6-2.3 5.9-5.5 6.4-3.2-.5-5.5-2.8-5.5-6.4V5l5.5-1.8z"/><path d="M7.4 10l1.8 1.8L13 7.8"/>'
  };
  function navIconHtml(id) {
    var inner = NAV_ICON_PATHS[id];
    if (!inner) return '<span class="pNavIconFallback">' + esc((id || '').slice(0, 2).toUpperCase()) + '</span>';
    return '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /* ---------- Shell Wave 2A: sidebar information architecture ----------
     Human-approved grouping (PORTAL V2 SHELL WAVE 2A, Decision 1) —
     deliberately DIFFERENT from config/landing-groups.json's own
     category grammar (Landing is frozen, unrelated taxonomy; do not
     conflate the two). Painel do Analista F&I / Central de Atendimento
     F&I are explicitly NOT added yet (recorded as a future decision,
     see docs). brabus-intelligence is not part of the approved groups
     for this Wave and is intentionally omitted from the sidebar. */
  var NAV_GROUPS = [
    { label: 'Visão Geral', moduleIds: ['dashbi', 'gestao'] },
    { label: 'Remuneração', moduleIds: ['score', 'coparticipado', 'salarios-comissoes'] },
    { label: 'Simuladores', moduleIds: ['simulador-novos', 'simulador-seminovos'] },
    { label: 'Administração', moduleIds: ['shell-admin'] }
  ];

  /* ---------- AUTH FOUNDATION Phase 2B: the header's user-context
     area now reads the real Auth Context (assets/js/auth-core.js)
     when one exists. Falls back to the same local-only mock this
     Wave's predecessor used (Shell Wave 2A) ONLY when auth isn't
     configured for this host (AUTH_NOT_CONFIGURED -- see auth-core.js)
     -- presentation only either way, feeds no authorization decision
     here (that lives exclusively in auth-core.js's isModuleAuthorized,
     consumed below). */
  var MOCK_USER = { name: 'Marina Ferreira', profile: 'ANALISTA', store: 'Barra Funda', department: 'Novos + Seminovos' };
  function currentUserDisplay() {
    var ctx = window.NX_AUTH_CORE && window.NX_AUTH_CORE.getContext();
    if (!ctx) return MOCK_USER;
    return {
      name: ctx.nome || '—',
      profile: ctx.perfil || '—',
      store: ctx.loja || 'Todas',
      department: ctx.status || ''
    };
  }
  function userInitials(name) {
    return String(name || '').split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }

  // V2-UAT-05: the SINGLE authority predicate for "is this module
  // hidden because the current user lacks permission" -- reused by
  // moduleBlockHtml() (Landing cards), navItemHtml() (sidebar), and
  // NX_LANDING.renderRoute()'s own category-visibility filter below,
  // so all three never disagree. Deliberately narrow: only a real
  // authMode + isModuleAuthorized()===false counts as AUTH DENIED.
  // NOT_MIGRATED is a distinct, legitimate "technically deferred by
  // design" case (Section 3 of this Wave's own brief) and is NEVER
  // hidden by this predicate -- callers that need to render it
  // (moduleBlockHtml/navItemHtml) keep checking migrationStatus
  // separately, unchanged.
  function isAuthDenied(m) {
    return !!(m && m.authMode && window.NX_AUTH_CORE && !window.NX_AUTH_CORE.isModuleAuthorized(m));
  }

  var landingGroups = null;
  var landingAmbientMount = null;
  var lastRoute = null;

  function loadGroups() {
    if (landingGroups) return Promise.resolve(landingGroups);
    // PA-1B: same reasoning as module-registry.js's own load() --
    // this file changes across Waves within one long-lived Human
    // session; a plain fetch() risks a heuristically-cached stale
    // response (proven root cause of the Atendimento F&I group
    // appearing missing to a real Human despite the file/code being
    // correct). cache:'no-store' forces a fresh network read.
    return fetch('config/landing-groups.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) { landingGroups = data.groups; return landingGroups; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  /* ---------- persistent chrome (Shell Wave 2A: grouped sidebar + user area) ---------- */
  function navItemHtml(id, activeRouteId) {
    var m = window.NX_REGISTRY.byId(id);
    if (!m) return '';
    var icon = navIconHtml(id);
    var label = esc(m.landingTitle || m.name);
    if (m.migrationStatus === 'NOT_MIGRATED') {
      // Gate 3: visible so the information architecture reads as
      // complete, but explicitly non-navigable — never implies
      // functionality that does not exist yet.
      return '<span class="pNavItem pNavItemDeferred" aria-disabled="true" title="' + label + ' (em breve)">' +
        '<span class="pNavIcon">' + icon + '</span><span class="pNavLabel">' + label + '</span>' +
        '<span class="pNavSoon">Em breve</span></span>';
    }
    // V2-UAT-05 (supersedes AUTH FOUNDATION Phase 2B, Gate 12): a
    // migrated module the current user lacks permission for is now
    // COMPLETELY OMITTED, not disabled -- confirmed Human business
    // rule ("SE O USUÁRIO NÃO TEM ACESSO A UM MÓDULO, O MÓDULO NÃO
    // DEVE APARECER"). Visibility only; the real authorization
    // boundary remains exclusively server-side (RPCs/RLS), unchanged.
    if (isAuthDenied(m)) return '';
    var active = activeRouteId === id;
    // title: tooltip with the module name when the menu is collapsed to icons
    return '<a href="#/' + id + '" class="pNavItem' + (active ? ' active' : '') + '"' + (active ? ' aria-current="page"' : '') + ' title="' + label + '">' +
      '<span class="pNavIcon">' + icon + '</span><span class="pNavLabel">' + label + '</span></a>';
  }

  function renderGlobalNav(activeRouteId) {
    var groupsHtml = NAV_GROUPS.map(function (g) {
      var itemsHtml = g.moduleIds.map(function (id) { return navItemHtml(id, activeRouteId); }).join('');
      if (!itemsHtml) return '';
      return '<div class="pNavGroup"><div class="pNavGroupLabel">' + esc(g.label) + '</div>' + itemsHtml + '</div>';
    }).join('');
    // Shell Wave 2A.1 Gate 2: the sidebar brand mark now reuses the SAME
    // institutional logo asset the top bar shows (assets/images/
    // brabus-logo.png), instead of a separate generic "B" badge that
    // read as its own, unrelated brand mark. "Portal F&I" is kept but
    // demoted to a small subordinate product label beside it.
    var html =
      '<a href="#/landing" class="pBrand" aria-label="Portal F&amp;I — início">' +
        '<img class="pBrandLogo" src="assets/images/brabus-logo.png" alt="" aria-hidden="true">' +
        '<span class="pBrandWord">Portal F&amp;I</span>' +
      '</a>' +
      '<div class="pNavGroups">' + groupsHtml + '</div>' +
      navPinHtml();
    document.getElementById('pGlobalNav').innerHTML = html;
  }

  /* ---------- menu recolhido em ícones dentro dos módulos (>= 1280 px) ----------
     body.module-open: a module (not the landing) is open → CSS turns the
     sidebar into a 64 px icon rail that opens OVER the content on hover /
     focus / click on the rail, and closes on mouse leave or item click.
     body.nav-pinned: the user's "keep the menu open" preference (localStorage). */
  var NAV_PIN_KEY = 'nx.menu.fixado';
  function navPinned() { return document.body.classList.contains('nav-pinned'); }
  function navPinHtml() {
    var fixado = navPinned();
    var rotulo = fixado ? 'Recolher menu nos módulos' : 'Fixar menu aberto';
    return '<button type="button" class="pNavPin" id="pNavPin" aria-pressed="' + (fixado ? 'true' : 'false') + '" title="' + rotulo + '">' +
      '<span class="pNavIcon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="pNavLabel">' + rotulo + '</span></button>';
  }
  function setNavPinned(fixado) {
    document.body.classList.toggle('nav-pinned', fixado);
    document.body.classList.remove('nav-rail-aberto');
    try { localStorage.setItem(NAV_PIN_KEY, fixado ? '1' : '0'); } catch (e) { /* storage blocked: preference lasts this page only */ }
    var b = document.getElementById('pNavPin');
    if (b) b.outerHTML = navPinHtml();
  }
  function setupNavRail() {
    try { if (localStorage.getItem(NAV_PIN_KEY) === '1') document.body.classList.add('nav-pinned'); } catch (e) { /* ignore */ }
    var nav = document.getElementById('pGlobalNav');
    if (!nav) return;
    var body = document.body;
    var emFaixa = function () {
      return body.classList.contains('module-open') && !navPinned() && window.matchMedia('(min-width: 1280px)').matches;
    };
    // delegated: the nav's innerHTML is rebuilt on every route change
    nav.addEventListener('click', function (e) {
      var alvo = e.target;
      if (alvo.closest('#pNavPin')) { setNavPinned(!navPinned()); return; }
      if (alvo.closest('.pNavItem') || alvo.closest('.pBrand')) {
        // picked an item: close, and (mouse click) keep hover from reopening it until the
        // mouse leaves; a keyboard Enter (detail 0) closes by itself once the nav loses focus
        body.classList.remove('nav-rail-aberto');
        if (emFaixa() && e.detail > 0) body.classList.add('nav-rail-recolhido');
        return;
      }
      if (emFaixa()) body.classList.toggle('nav-rail-aberto'); // click on the rail itself
    });
    nav.addEventListener('mouseleave', function () { body.classList.remove('nav-rail-aberto', 'nav-rail-recolhido'); });
    // focus left the nav (also fires when a route change rebuilds it): close a click-opened rail
    nav.addEventListener('focusout', function (e) {
      if (!nav.contains(e.relatedTarget)) body.classList.remove('nav-rail-aberto');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && body.classList.contains('nav-rail-aberto')) body.classList.remove('nav-rail-aberto');
    });
  }
  document.addEventListener('DOMContentLoaded', setupNavRail);

  function renderTopBar(entry) {
    var bc = document.getElementById('pBreadcrumb');
    // Shell Wave 2A.1 Gate 3: "Portal F&I" demoted to a small system
    // tag (it names the product, not the current location — repeating
    // it at breadcrumb weight read as a developer path); the current
    // module now carries the actual hierarchy. landingTitle (same clean
    // display name used in the sidebar/Landing cards) reads better here
    // than the registry's raw `name`, which sometimes carries a
    // technical suffix (e.g. "Gestão (analise-fi-grupo)").
    if (bc) {
      bc.innerHTML =
        '<span class="pBreadcrumbTag">Portal F&amp;I</span>' +
        '<span class="pBreadcrumbSep" aria-hidden="true">›</span>' +
        '<span class="pBreadcrumbCurrent">' + esc(entry ? (entry.landingTitle || entry.name) : 'Landing') + '</span>';
    }
    var userArea = document.getElementById('pUserArea');
    // AUTH FOUNDATION Phase 2B: re-rendered on every route change now
    // (cheap, avoids staleness across logout -> a different user
    // logging back in on the same page load) rather than the prior
    // Shell Wave 2A "render once" caching, which was only safe while
    // this was permanently static mock data.
    if (userArea) {
      var u = currentUserDisplay();
      var showLogout = window.NX_AUTH_CORE && window.NX_AUTH_CORE.getState() === window.NX_AUTH_CORE.STATES.AUTHORIZED;
      userArea.innerHTML =
        (window.NX_FONTE ? window.NX_FONTE.botaoHtml() : '') +
        '<div class="pUserChip">' +
          '<span class="pUserAvatar" aria-hidden="true">' + esc(userInitials(u.name)) + '</span>' +
          '<span class="pUserInfo">' +
            '<span class="pUserName"><span class="pUserNameText">' + esc(u.name) + '</span><span class="pUserBadge">' + esc(u.profile) + '</span></span>' +
            '<span class="pUserContext">' + esc(u.store) + (u.department ? ' · ' + esc(u.department) : '') + '</span>' +
          '</span>' +
          (showLogout ? '<button type="button" class="pUserLogout" id="pUserLogoutBtn" aria-label="Sair">Sair</button>' : '') +
        '</div>';
      var logoutBtn = document.getElementById('pUserLogoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          // AUTH FOUNDATION Phase 2B, Gate 19: centralized logout --
          // Intelligence's own conversation state is reset as a side
          // effect of the resulting SIGNED_OUT transition unmounting
          // the module (brabus-intelligence.js's own in-memory
          // conversation array is not module-global persisted state).
          window.NX_ROUTER.navigate('landing');
          window.NX_AUTH_CORE.logout();
        });
      }
    }
  }

  /* ---------- Landing HTML (transplanted from pages.js pageLanding/landingModuleBlockHtml) ----------
     AUTH FOUNDATION Phase 2E, Gate 6/17/18: the category list is a
     genuine tab list (role="tablist"/"tab"/"tabpanel", not a page-link
     list) -- native semantics for what the interaction already was,
     never simulated with generic divs. A small "Categorias" eyebrow
     (Gate 6) frames the left column as a selector group rather than a
     destination list -- no instructional copy, one restrained label. */
  function landingHtml(groups) {
    var navItems = groups.map(function (g, i) {
      // IA-ENTRY-01 Section 6: the Brabus Intelligence row (and ONLY
      // that row -- matched by label, no index hardcoded) gets a small
      // Living Core icon next to its name. Purely decorative (aria-
      // hidden); visual state (idle vs. active) is driven entirely by
      // the EXISTING .active class that selectGroup() already toggles
      // -- no change to the V2-UAT-01 click-lock logic in wireLanding().
      var isIntel = g.label === 'Brabus Intelligence';
      var coreHtml = isIntel
        ? '<span class="fNavLivingCore" aria-hidden="true"><span class="fNavCoreRing"></span><span class="fNavCoreNucleus"></span></span>'
        : '';
      return '<button type="button" class="fNavItem' + (isIntel ? ' fNavItemIntel' : '') + (i === 0 ? ' active' : '') + '" id="fNavTab' + i + '" role="tab" aria-selected="' + (i === 0 ? 'true' : 'false') + '" aria-controls="landingModuleDetail" data-idx="' + i + '">' +
        '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' + coreHtml + '<span class="label">' + esc(g.label) + '</span></button>';
    }).join('');
    return '<div class="fShell" id="landingShell">' +
      '<div class="contextBeam" id="landingBeam"></div>' +
      '<div class="fNavCol">' +
        '<div class="fNavEyebrow">Categorias</div>' +
        '<nav class="fNav" id="landingNav" role="tablist" aria-label="Categorias do Portal">' + navItems + '</nav>' +
        (podeVerSimulador() ? analystCtaHtml('portal_home') : '') +
      '</div>' +
      '<section class="fCanvas"><div class="ambientLayer" id="landingAmbientLayer" aria-hidden="true"></div><div class="motionProtectFull"></div><div class="fCanvasInner">' +
      '<div class="fDetailEyebrow" id="landingDetailEyebrow"></div>' +
      '<div id="landingModuleDetail" role="tabpanel" aria-labelledby="fNavTab0"></div>' +
      '</div></section>' +
      '</div>';
  }

  // SIM-REG-01: "Falar com um Analista" Home CTA. NOT a module card
  // (deliberately outside groups/moduleBlockHtml/the tab-switching
  // #landingModuleDetail area) -- a persistent attendance shortcut,
  // visible under the category list regardless of which category tab
  // is active, per the brief's own "não deve ser implementado como um
  // novo módulo funcional independente" instruction. Action/
  // destination authority lives entirely in window.NX_FI_ATENDIMENTO
  // (fi-atendimento.js) -- this only renders the button and a short
  // hint; origin is carried both as a data attribute (inspectable in
  // the DOM) and passed straight through to the shared handler.
  // The CTA is help with a simulation: only for users who can open a simulator
  // (e.g. RH, limited to Salários & Comissões, never sees it).
  function podeVerSimulador() {
    return ['simulador-novos', 'simulador-seminovos'].some(function (id) {
      var m = window.NX_REGISTRY && window.NX_REGISTRY.byId(id);
      return !!m && !isAuthDenied(m);
    });
  }

  function analystCtaHtml(origin) {
    return '<div class="fAnalystCta">' +
      '<p class="fAnalystCtaHint">Precisa de ajuda com uma simulação?</p>' +
      '<button type="button" class="fAnalystCtaBtn" id="landingAnalystCtaBtn" data-analyst-origin="' + esc(origin) + '">' +
        '<svg class="fAnalystCtaIcon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 3.5h12v7H6.5L3 13.5V10.5H2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        'Falar com um Analista' +
      '</button>' +
    '</div>';
  }

  function moduleBlockHtml(m) {
    /* No eyebrow ("N módulos nesta categoria"), no status/code footer —
       matches the reference exactly; that metadata was explicitly
       rejected by human UAT in FACELIFT-PROTOTYPE-01.2 (see
       docs/LANDING-CONTENT-MAP.md "MUST NOT show" list). */
    var title = esc(m.landingTitle || m.name);

    // AUTH FOUNDATION Phase 2E, Gate 10/16: previously identical
    // markup for every module regardless of migrationStatus/
    // authorization -- a deferred/unavailable module looked exactly
    // as clickable as a real one until AFTER navigating into it. Now
    // mirrors the sidebar's own already-correct navItemHtml() logic
    // (same predicate, same truthful language) so Landing and Sidebar
    // never contradict each other (Gate 15).
    if (m.migrationStatus === 'NOT_MIGRATED') {
      return '<div class="fModuleBlock fModuleBlockDeferred" aria-disabled="true">' +
        '<div class="fModuleTop"><h3 class="fModuleTitle">' + title + '</h3><span class="fModuleSoon">Em breve</span></div>' +
        '<p class="fModuleDesc">' + esc(m.landingDesc || m.title) + '</p>' +
        '</div>';
    }
    // V2-UAT-05 (supersedes AUTH FOUNDATION Phase 2E, Gate 10/16): a
    // migrated module the current user lacks permission for is now
    // COMPLETELY OMITTED (no card, no wrapper, no placeholder, no
    // space occupied), not disabled -- confirmed Human business rule.
    // NOT_MIGRATED above is a separate, legitimate case, unaffected.
    if (isAuthDenied(m)) return '';
    // AUTH FOUNDATION Phase 2E, Gate 7/17: a real <a href> instead of
    // a role="button" div -- correct semantics for an element whose
    // only behavior is navigation (screen readers announce "link,"
    // not "button"), and it gets native cursor/cross-browser
    // affordance for free. The arrow's default (non-hover) visibility
    // moved to CSS -- see .fModuleArrow -- so availability reads at
    // rest, not only on hover.
    return '<a class="fModuleBlock" href="#/' + m.id + '">' +
      '<div class="fModuleTop"><h3 class="fModuleTitle">' + title + '</h3><span class="fModuleArrow" aria-hidden="true">→</span></div>' +
      '<p class="fModuleDesc">' + esc(m.landingDesc || m.title) + '</p>' +
      '</a>';
  }

  /* ---------- ambient motion (Gate 11: exact normative Parametric Reactive config) ---------- */
  function mountLandingAmbient() {
    var layer = document.getElementById('landingAmbientLayer');
    if (landingAmbientMount) { landingAmbientMount.destroy(); landingAmbientMount = null; }
    if (!layer) return;
    if (window.MotionEngine && window.MotionEngine.reduce) { layer.style.opacity = '0'; return; }
    if (!window.MotionEngine) { console.warn('[landing] MotionEngine not loaded — ambient motion skipped.'); return; }
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '';
    layer.appendChild(canvas);
    layer.style.opacity = '0.25'; /* LOW density = full presence, normative Parametric Reactive config */
    landingAmbientMount = window.MotionEngine.mount(canvas, 'parametric_reactive', { speed: 0.75, colorMode: 'brand_red', customColor: '#c1121f' });
    window.NX_MOTION.parametricReactive.enabled = true;
  }
  function unmountLandingAmbient() {
    if (landingAmbientMount) { landingAmbientMount.destroy(); landingAmbientMount = null; }
    window.NX_MOTION.parametricReactive.enabled = false;
  }

  /* ---------- wiring (transplanted from app.js wireLanding) ---------- */
  function wireLanding(groups) {
    var navEl = document.getElementById('landingNav');
    var beamEl = document.getElementById('landingBeam');
    var shellEl = document.getElementById('landingShell');
    var detailEl = document.getElementById('landingModuleDetail');
    var eyebrowEl = document.getElementById('landingDetailEyebrow');
    var activeIdx = 0;

    function moduleByIdGlobal(id) { return window.NX_REGISTRY.byId(id); }

    function selectGroup(idx, fireBeam) {
      var g = groups[idx];
      // V2-UAT-05: groups is now the CALLER's already-filtered,
      // possibly-empty array (a category with zero visible modules is
      // omitted entirely) -- guards the edge case of genuinely zero
      // visible categories (e.g. transiently, before a real auth
      // session resolves) so this never throws on groups[idx] being
      // undefined; the panel simply stays empty, no crash.
      if (!g) return;
      // AUTH FOUNDATION Phase 2E, Gate 8: the eyebrow above the module
      // list names the active category explicitly, making the
      // left-selects/right-responds relationship legible without
      // instructional copy, and giving a single-item category (Gate
      // 9) the same confirming signal every other category gets.
      if (eyebrowEl) eyebrowEl.textContent = g.label;
      detailEl.innerHTML = g.moduleIds.map(function (mid) {
        var m = moduleByIdGlobal(mid);
        return m ? moduleBlockHtml(m) : '';
      }).join('');
      navEl.querySelectorAll('.fNavItem').forEach(function (b, i) {
        var isActive = i === idx;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      detailEl.setAttribute('aria-labelledby', 'fNavTab' + idx);
      if (fireBeam && !(window.MotionEngine && window.MotionEngine.reduce)) {
        var btn = navEl.querySelector('.fNavItem[data-idx="' + idx + '"]');
        var shellRect = shellEl.getBoundingClientRect();
        var btnRect = btn.getBoundingClientRect();
        var navRect = navEl.getBoundingClientRect();
        beamEl.style.left = (navRect.right - shellRect.left) + 'px';
        beamEl.style.top = (btnRect.top - shellRect.top + btnRect.height / 2) + 'px';
        beamEl.classList.add('active');
        setTimeout(function () { beamEl.classList.remove('active'); }, 420);
      }
    }
    selectGroup(0, false);

    // AUTH FOUNDATION Phase 2E: real-pointer-movement guard, found
    // during this Wave's own module-reachability automation, not in
    // the human's original report -- but a real, reproducible browser
    // behavior (not Playwright-only): when Landing mounts immediately
    // after a click elsewhere (e.g. the Login button), Chromium
    // re-evaluates :hover for whatever now sits under the STATIONARY
    // cursor and fires a synthetic mouseenter for it -- silently
    // overriding the intended default (category 0) with whichever
    // category label happens to end up at that screen position. A
    // mouseenter is only honored once an actual mousemove has been
    // observed since Landing mounted, so category selection only ever
    // follows real, deliberate pointer movement.
    var pointerHasMoved = false;
    var moveGuard = function () { pointerHasMoved = true; document.removeEventListener('mousemove', moveGuard); };
    document.addEventListener('mousemove', moveGuard);

    // V2-UAT-01 -- HOVER = PREVIEW, CLICK = PERSISTENT SELECTION (Human
    // UAT: incidental hover over another category while the pointer
    // travels from the clicked category toward its own module list on
    // the right was silently swapping the panel out from under them).
    // categoryLocked starts false (nothing explicitly chosen yet) so
    // hover/focus can still preview like before; an explicit click (or
    // Enter/Space, its keyboard equivalent) sets it true, and from that
    // point on hover/focus are inert for selection purposes -- only
    // another click/Enter/Space (on a DIFFERENT category) can move the
    // lock. This is the real fix; it is never bypassed by a large
    // fixed delay.
    var categoryLocked = false;
    // Small (never large) hover-INTENT grace period -- debounces the
    // preview-only path so a fast pointer pass over several category
    // labels while travelling elsewhere doesn't flash each one in turn;
    // only a label the pointer actually rests on for a moment previews.
    // Irrelevant once categoryLocked is true (mouseenter is a no-op
    // then regardless of timing).
    var HOVER_INTENT_MS = 120;
    var hoverTimer = null;
    function clearHoverTimer() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } }

    navEl.querySelectorAll('.fNavItem').forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        clearHoverTimer();
        categoryLocked = true;
        if (idx !== activeIdx) { activeIdx = idx; selectGroup(idx, true); }
      });
      btn.addEventListener('mouseenter', function () {
        if (categoryLocked || !pointerHasMoved || idx === activeIdx) return;
        clearHoverTimer();
        hoverTimer = setTimeout(function () {
          hoverTimer = null;
          if (categoryLocked || idx === activeIdx) return; // re-checked: state may have changed during the grace period
          activeIdx = idx; selectGroup(idx, true);
        }, HOVER_INTENT_MS);
      });
      btn.addEventListener('mouseleave', clearHoverTimer);
      btn.addEventListener('focus', function () { if (!categoryLocked && idx !== activeIdx) { activeIdx = idx; selectGroup(idx, true); } });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clearHoverTimer();
          categoryLocked = true;
          if (idx !== activeIdx) { activeIdx = idx; selectGroup(idx, true); }
        }
      });
    });
    // AUTH FOUNDATION Phase 2E: module destinations are now real
    // <a href="#/..."> elements (moduleBlockHtml) -- the browser's own
    // click/Enter activation handles navigation natively; the manual
    // click/keydown delegation this replaced is no longer needed
    // (deferred/unauthorized blocks are plain <div>s with no href at
    // all, so they were never reachable via this path either way).

    // SIM-REG-01: wired once here (the CTA is static markup inside
    // landingHtml(), never touched by selectGroup()'s re-render of
    // #landingModuleDetail) -- calls the single shared attendance
    // authority, passing this button's own data-analyst-origin.
    var analystBtn = document.getElementById('landingAnalystCtaBtn');
    if (analystBtn) {
      analystBtn.addEventListener('click', function () {
        if (window.NX_FI_ATENDIMENTO) window.NX_FI_ATENDIMENTO.falarComAnalista(analystBtn.getAttribute('data-analyst-origin'));
      });
    }
  }

  /* ---------- public entry, called by shell.js on every route change ---------- */
  window.NX_LANDING = {
    isLandingRoute: function (routeId) { return routeId === 'landing'; },

    renderRoute: function (routeId, entry) {
      var moduleChanged = lastRoute !== null && lastRoute !== routeId;
      lastRoute = routeId;

      document.body.classList.toggle('landing-active', routeId === 'landing');
      document.body.classList.toggle('module-open', routeId !== 'landing');
      // a navigation closes the rail; 'nav-rail-recolhido' stays until the mouse leaves it
      document.body.classList.remove('nav-rail-aberto');
      renderGlobalNav(routeId);
      renderTopBar(entry);
      if (moduleChanged) window.NX_CONTEXT_BEAM.fire();

      if (routeId === 'landing') {
        return loadGroups().then(function (groups) {
          // Shell Wave 2A fix: landing's own fetch can resolve AFTER a
          // newer navigation has already started (e.g. the default cold
          // boot route is 'landing', and the user/a deep link navigates
          // elsewhere before config/landing-groups.json returns) —
          // without this guard, this stale resolution would overwrite
          // whatever the newer route already rendered into the shared
          // outlet. Route id is the router's own source of truth.
          if (window.NX_ROUTER.currentRouteId() !== routeId) return;
          // V2-UAT-05 (Section 4/7): a category left with ZERO visible
          // modules after the same isAuthDenied() filter must not
          // render at all (no empty tab). Filtered ONCE here, fed to
          // BOTH landingHtml() and wireLanding() so their #fNavTab{i}/
          // data-idx indices stay mutually consistent -- neither
          // function needs its own copy of this logic.
          var visibleGroups = groups.filter(function (g) {
            return g.moduleIds.some(function (mid) {
              var m = window.NX_REGISTRY.byId(mid);
              return !!m && !isAuthDenied(m);
            });
          });
          document.getElementById('nxContentOutlet').innerHTML = landingHtml(visibleGroups);
          mountLandingAmbient();
          wireLanding(visibleGroups);
        });
      }
      unmountLandingAmbient();
      return Promise.resolve(null);
    }
  };

  // The IA's access is confirmed by its server a moment after login: redraw the menu (and the
  // landing categories, when on it) so the IA appears without waiting for the next navigation.
  window.addEventListener('nx:acesso-ia', function () {
    var AC = window.NX_AUTH_CORE;
    if (!AC || AC.getState() !== AC.STATES.AUTHORIZED || !window.NX_ROUTER) return;
    var rota = window.NX_ROUTER.currentRouteId();
    window.NX_LANDING.renderRoute(rota, window.NX_REGISTRY && window.NX_REGISTRY.byId(rota));
  });
})();
