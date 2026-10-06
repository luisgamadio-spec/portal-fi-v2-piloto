/* PORTAL-NEXT V2 — Shell boot (Gates 10, 11, 13, 22, 23, 32).
   Wires router + module registry + nav + content outlet + Design
   Trace dev panel. No module's real UI is implemented here — every
   route renders a minimal structural placeholder proving routing
   works, per Gate 10's explicit "no full visual mockup" instruction. */
(function () {
  'use strict';

  var DEFAULT_ROUTE = 'landing';

  /* ---------- Gate 22: Parametric Reactive motion runtime, loadable but OFF ---------- */
  window.NX_MOTION = {
    parametricReactive: {
      available: true,
      enabled: false, // default OFF — modules not yet classified/migrated
      configSource: 'design-system-2/tokens.css --signature-motion-*',
      reason: 'Foundation phase — density has not been classified per-module yet (Gate 11 in the Skill requires classifying density BEFORE motion).'
    }
  };

  /* ---------- Gate 23/12: Context Beam event hook — REAL as of this
     Wave (Landing exists now), fires only on an actual route/context
     change, never on every hover/click. See assets/css/landing.css
     .ctxBeam and assets/js/landing.js, which is the actual caller. */
  window.NX_CONTEXT_BEAM = {
    fire: function () {
      if (window.MotionEngine && window.MotionEngine.reduce) return;
      var beam = document.getElementById('ctxBeam');
      if (!beam) return;
      beam.classList.add('active');
      setTimeout(function () { beam.classList.remove('active'); }, 420);
    }
  };

  /* ---------- Shell Wave 2A Gate 9/22 fix: move focus to the outlet on
     a real navigation (Gate 24 accessibility requirement, pre-existing)
     WITHOUT the browser's default scroll-into-view, which does not
     account for the sticky top bar and was scrolling exactly the top
     bar's height, tucking the new module's first paint under it. Scroll
     to the top explicitly instead — the correct behavior for a fresh
     route render regardless of where the previous module had scrolled to. */
  function focusOutletForNavigation(outlet) {
    outlet.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ---------- Shell Wave 2A Gate 14: not-migrated / deferred state.
     Leads with a calm, human-readable message; keeps the diagnostic
     metadata (useful for development) but demoted into a <details> so
     it doesn't read as a developer-only dump. */
  function renderPlaceholder(entry, routeId, moveFocus) {
    var outlet = document.getElementById('nxContentOutlet');
    if (!entry) {
      outlet.innerHTML =
        '<div class="nxPlaceholder"><h1>Página não encontrada</h1>' +
        '<p><span class="nxStatusTag">#/' + routeId + '</span> não existe no registro de módulos.</p></div>';
      if (moveFocus) focusOutletForNavigation(outlet);
      return;
    }
    outlet.innerHTML =
      '<div class="nxPlaceholder nxDeferredState">' +
      '<span class="nxStatusTag">Em breve</span>' +
      '<h1>' + (entry.landingTitle || entry.name) + '</h1>' +
      '<p>Em preparação para o Portal V2. Esta área ainda não está disponível — volte em breve.</p>' +
      '<a class="nxDeferredHome" href="#/landing">Voltar para o início</a>' +
      // registry metadata is development info: localhost with ?debug=1 only
      (devAtivo() ?
      '<details class="nxMetaDetails"><summary>Detalhes técnicos</summary>' +
      '<dl class="nxMeta">' +
      '<dt>rota</dt><dd>#/' + entry.id + '</dd>' +
      '<dt>status</dt><dd>' + entry.migrationStatus + '</dd>' +
      '<dt>densidade</dt><dd>' + entry.density + '</dd>' +
      '<dt>autenticação</dt><dd>' + entry.authRequirement + '</dd>' +
      '<dt>padrão de design</dt><dd>' + entry.designPattern + '</dd>' +
      '<dt>wave</dt><dd>' + entry.migrationWave + '</dd>' +
      '</dl></details>' : '') +
      '</div>';
    if (moveFocus) outlet.focus();
  }

  /* ---------- Shell Wave 2A Gate 12: subtle, static loading state.
     No animation (Gate 17 — no motion/polish this Wave); reuses the
     same "Carregando…" language already established by index.html's
     own cold-load placeholder (Gate 15 — no new pattern invented). */
  function showModuleLoading(outlet) {
    outlet.innerHTML = '<div class="nxModuleLoading"><span class="nxModuleLoadingDot" aria-hidden="true"></span>Carregando módulo…</div>';
  }

  /* ---------- Shell Wave 2A Gate 13: structural module-load failure
     state. NOT backend/RPC error handling — this only covers the
     module's own render() promise rejecting. */
  function renderModuleError(outlet, entry, err) {
    var name = entry ? entry.name : 'este módulo';
    outlet.innerHTML =
      '<div class="nxPlaceholder nxModuleError">' +
      '<span class="nxStatusTag nxStatusTagError">Falha ao carregar</span>' +
      '<h1>Não foi possível abrir ' + name + '</h1>' +
      '<p>Ocorreu um erro ao carregar este módulo. Você pode tentar novamente ou voltar para o início.</p>' +
      '<a class="nxDeferredHome" href="#/landing">Voltar para o início</a>' +
      '</div>';
    console.error('[shell] module render failed for route', entry && entry.id, err);
  }

  /* ---------- Shell Wave 2A Gate 7: data-driven module dispatch.
     Replaces the prior hand-written if/else-if chain (one clause per
     migrated module) with a small declarative map from route id to the
     page global it registers — still explicit (module globals don't
     follow one predictable naming rule), but adding a module is now a
     one-line registration instead of a new branch, and every module
     gets the same loading/error handling for free. */
  // UXCHAT1 -- 'brabus-intelligence' below is no longer reachable via
  // normal navigation: onRouteChange() now intercepts that routeId
  // earlier and redirects to the canonical Living Core/Orb panel
  // instead (see its own UXCHAT1 comment). The entry/page file are
  // left exactly as-is (no destructive deletion), intentionally dead
  // for this dispatch path.
  var MODULE_PAGES = {
    score: 'NX_SCORE_PAGE',
    coparticipado: 'NX_COPARTICIPADO_PAGE',
    gestao: 'NX_GESTAO_PAGE',
    dashbi: 'NX_DASHBI_PAGE',
    'simulador-novos': 'NX_SIMULADOR_NOVOS_PAGE',
    'simulador-seminovos': 'NX_SIMULADOR_SEMINOVOS_PAGE',
    'painel-analista-fi': 'NX_PAINEL_ANALISTA_FI_PAGE',
    'central-atendimento-fi': 'NX_CENTRAL_ATENDIMENTO_FI_PAGE',
    'salarios-comissoes': 'NX_SALARIOS_COMISSOES_PAGE',
    'brabus-intelligence': 'NX_BRABUS_INTELLIGENCE_PAGE',
    'shell-admin': 'NX_SHELL_ADMIN_PAGE'
  };

  var hasRenderedOnce = false;
  function dispatchModule(routeId, entry) {
    var pageGlobalName = MODULE_PAGES[routeId];
    var page = pageGlobalName && window[pageGlobalName];
    var outlet = document.getElementById('nxContentOutlet');
    if (!page) {
      renderPlaceholder(entry, routeId, hasRenderedOnce);
      return Promise.resolve();
    }
    showModuleLoading(outlet);
    return page.render(outlet).then(function () {
      if (hasRenderedOnce) focusOutletForNavigation(outlet);
    }).catch(function (err) {
      renderModuleError(outlet, entry, err);
    });
  }

  /* ---------- AUTH FOUNDATION Phase 2B, Gate 10: centralized route
     guard. Runs BEFORE landing/module dispatch -- a direct hash
     navigation can never reach a module's mount code without passing
     this check first, matching the target flow HASH CHANGE -> ROUTER
     -> AUTH STATE CHECK -> REGISTRY RESOLUTION -> AUTHORIZATION CHECK
     -> SHELL DISPATCH -> MODULE MOUNT. Fail-closed throughout (Gate
     26): an unknown authMode, a PERMISSION_MATRIX module with no
     permissionId, or any unrecognized combination denies rather than
     defaulting to allow. */
  function isRouteAuthorized(entry) {
    if (!entry) return true; // unknown-route 404 is handled by renderPlaceholder itself, not a permission concern
    return window.NX_AUTH_CORE.isModuleAuthorized(entry);
  }

  // Defense in depth alongside landing.js's own currentRouteId() guard:
  // if a newer route dispatch has started before this one's async chain
  // finishes, skip its remaining side effects (module dispatch, design
  // trace) rather than letting a stale navigation act after the fact.
  var routeToken = 0;
  function onRouteChange(routeId) {
    var myToken = ++routeToken;
    var entry = window.NX_REGISTRY.byId(routeId);

    var routeAuthState = window.NX_AUTH_CORE.getState();
    var routeAuthStates = window.NX_AUTH_CORE.STATES;
    if (routeAuthState === routeAuthStates.AUTH_NOT_CONFIGURED) {
      // GL-ENV-AUTH-WRITE-BOUNDARY: AUTH_NOT_CONFIGURED never dispatches
      // a route and never renders Login -- boot()'s own onStateChange
      // handler already owns rendering for this state (a deterministic
      // configuration-unavailable message, #nxRoot kept hidden). Falling
      // through here would either populate the hidden outlet for
      // nothing or show a Login form with no real backend to
      // authenticate against -- both misleading. This also guarantees
      // no route-change bounce loop can occur in this state: every call
      // returns immediately, unconditionally.
      return;
    }
    if (routeAuthState !== routeAuthStates.AUTHORIZED) {
      // AUTH FOUNDATION Phase 2B, Gate 11: any authenticated-app route
      // requested while not AUTHORIZED renders Login, never the
      // requested module -- a direct hash/URL cannot bypass this.
      window.NX_LOGIN.render();
      return;
    }
    if (entry && entry.authMode && !isRouteAuthorized(entry)) {
      // Not a dedicated error page (Gate 24's failure-matrix
      // discipline, matching V1: an unauthorized module simply isn't
      // navigable) -- return to the authenticated Landing.
      window.NX_ROUTER.navigate('landing');
      return;
    }

    // UXCHAT1 -- Human decision: Brabus Intelligence is ONE experience.
    // This route's own legacy full-page implementation
    // (NX_BRABUS_INTELLIGENCE_PAGE, MODULE_PAGES below -- left on disk
    // untouched, no destructive deletion) used to be the ONLY thing a
    // sidebar/Landing click on "Brabus Intelligence" could reach, and
    // intelligence-panel.js's own canonical Living Core/Orb launcher
    // deliberately hid itself specifically on this route to avoid a
    // visibly duplicated surface -- reasonable under the OLDER product
    // decision (the routed page was the main experience, the panel the
    // new addition), backwards now that the panel IS the approved
    // canonical experience. Runs AFTER the exact same auth-state/
    // authorization checks above (reused untouched, never duplicated or
    // weakened -- an unauthorized profile still never reaches this
    // line) -- only the LAST step, "which surface renders," changes.
    // Redirecting to 'landing' (same re-entrant navigate()+return
    // pattern the denial branch above already uses) keeps the URL/hash
    // sane instead of resolving to a route whose own module-content
    // outlet is intentionally never populated; opening the SAME
    // persistent panel/NX_INTELLIGENCE_STATE singleton (never a second
    // instance, never a second conversation store) is what actually
    // satisfies "one experience, one conversation."
    if (routeId === 'brabus-intelligence') {
      window.NX_ROUTER.navigate('landing');
      if (window.NX_INTELLIGENCE_PANEL) window.NX_INTELLIGENCE_PANEL.openPanel();
      return;
    }

    // IA-3E, Section 33: route-level Intelligence context only — every
    // module gets this same one line, no individual (frozen) module
    // is edited to call it. NX_INTELLIGENCE_CONTEXT is presentation-
    // only (see intelligence-context.js's own header) and safe to call
    // unconditionally; guarded only because the panel's own scripts
    // could in principle be absent from a given page.
    if (window.NX_INTELLIGENCE_CONTEXT) window.NX_INTELLIGENCE_CONTEXT.setRoute(routeId, entry);

    window.NX_LANDING.renderRoute(routeId, entry).then(function () {
      if (myToken !== routeToken) return;
      if (!window.NX_LANDING.isLandingRoute(routeId)) {
        return dispatchModule(routeId, entry);
      }
    }).then(function () {
      if (myToken !== routeToken) return;
      if (devAtivo()) window.NX_DESIGN_TRACE.render(entry, routeId);
      hasRenderedOnce = true;
    });
  }

  function devAtivo() { return !!(window.NX_DEV && window.NX_DEV.ativo); }

  // Dev badge + design trace: only on localhost with ?debug=1 (NX_DEV); elsewhere
  // they stay hidden and the trace panel is never filled.
  function setupDevBadge() {
    var badge = document.getElementById('nxDevBadge');
    var toggleBtn = document.getElementById('nxDesignTraceToggle');
    var panel = document.getElementById('nxDesignTrace');
    if (!devAtivo() || !badge || !toggleBtn || !panel) {
      if (badge) badge.hidden = true;
      if (panel) panel.hidden = true;
      return;
    }
    badge.hidden = false;
    toggleBtn.addEventListener('click', function () {
      var isHidden = panel.hasAttribute('hidden');
      if (isHidden) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
      toggleBtn.setAttribute('aria-expanded', String(isHidden));
    });
  }

  /* ---------- Shell Wave 2B: tablet/mobile navigation drawer.
     Same #pGlobalNav DOM/data (renderGlobalNav in landing.js) as
     desktop -- this only toggles a body-level state class that CSS
     uses to slide the SAME sidebar in as an overlay. No second nav
     list, no duplicated module/group data. Listeners are attached once
     at boot to the stable #pGlobalNav/#pNavTrigger/#pNavBackdrop
     elements (event delegation for nav-item clicks), so they keep
     working across renderGlobalNav's per-route innerHTML rebuilds. */
  function setupNavDrawer() {
    var trigger = document.getElementById('pNavTrigger');
    var nav = document.getElementById('pGlobalNav');
    var backdrop = document.getElementById('pNavBackdrop');
    if (!trigger || !nav || !backdrop) return;

    function isOpen() { return document.body.classList.contains('nav-drawer-open'); }

    function openDrawer() {
      document.body.classList.add('nav-drawer-open');
      trigger.setAttribute('aria-expanded', 'true');
      backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer(returnFocus) {
      document.body.classList.remove('nav-drawer-open');
      trigger.setAttribute('aria-expanded', 'false');
      backdrop.hidden = true;
      document.body.style.overflow = '';
      if (returnFocus) trigger.focus();
    }

    trigger.addEventListener('click', function () {
      if (isOpen()) closeDrawer(true);
      else openDrawer();
    });
    backdrop.addEventListener('click', function () { closeDrawer(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeDrawer(true);
    });
    // A nav-item selection already navigates via its href/hashchange —
    // just close the drawer so the destination is visible underneath.
    nav.addEventListener('click', function (e) {
      var link = e.target.closest('.pNavItem, .pBrand');
      if (link && isOpen()) closeDrawer(false);
    });
    // Growing back to desktop width with the drawer open would leave a
    // stale open state (and the scroll lock) behind otherwise.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1279 && isOpen()) closeDrawer(false);
    });
  }

  /* ---------- AUTH FOUNDATION Phase 2B, Gate 17: boot sequence.
     SESSION RESOLUTION -> PROFILE RESOLUTION -> AUTHORIZATION CONTEXT
     completes (auth-core.js's boot()) BEFORE the registry/router are
     wired at all -- no shell/module content can flash before
     authorization is known, per Gate 17's explicit requirement. The
     outlet's static "Carregando…" placeholder (index.html) covers
     this whole window; nxRoot itself stays hidden until AUTHORIZED.

     GL-ENV-AUTH-WRITE-BOUNDARY: AUTH_NOT_CONFIGURED no longer behaves
     as pre-Auth-Foundation (that prior behavior -- shell visible, every
     module reachable -- was the fail-open bug this wave's Human
     Environment Authority requires closed). nxRoot and Login both stay
     hidden in this state; #nxBootLoading is reused as the deterministic,
     non-authorizing configuration-unavailable surface instead. */
  function boot() {
    setupDevBadge();
    setupNavDrawer();
    // IA-3E: mounts the persistent Intelligence launcher into
    // #nxOverlayRoot exactly once, before any route dispatch — its own
    // visibility (MASTER-only) is then driven entirely by
    // NX_AUTH_CORE's state changes, subscribed inside mount() itself,
    // never by this boot sequence. See assets/js/intelligence/
    // intelligence-panel.js.
    if (window.NX_INTELLIGENCE_PANEL) window.NX_INTELLIGENCE_PANEL.mount();
    // IA-3H.1 -- same "mount once, own lifecycle from there" convention
    // as the panel above; the Voice session manager's own dev-only
    // diagnostics toggle is unconditional (mirrors #nxDesignTraceToggle
    // just above it in setupDevBadge(), not MASTER-gated), but the
    // actual microphone button only exists at all inside the panel's
    // own MASTER-gated drawer markup -- nothing here changes that.
    if (window.NX_INTELLIGENCE_VOICE) window.NX_INTELLIGENCE_VOICE.mount();
    // IA-3H.2 -- same "mount once, own lifecycle from there" convention;
    // a second, read-only subscriber to NX_INTELLIGENCE_STATE, never a
    // second session/conversation store.
    if (window.NX_INTELLIGENCE_VOICE_FOCUS) window.NX_INTELLIGENCE_VOICE_FOCUS.mount();
    window.NX_AUTH_CORE.onStateChange(function (state) {
      var STATES = window.NX_AUTH_CORE.STATES;
      var bootLoading = document.getElementById('nxBootLoading');
      if (state === STATES.AUTH_NOT_CONFIGURED) {
        // GL-ENV-AUTH-WRITE-BOUNDARY: a THIRD, terminal render branch --
        // distinct from both AUTHORIZED (real shell/module content) and
        // the Login-requiring states below. No real Supabase credentials
        // exist for this host, so there is no backend for Login to
        // authenticate against; showing it would be misleading. Reuses
        // the existing #nxBootLoading placeholder (never hidden in this
        // state) rather than adding a new DOM surface -- #nxRoot and
        // #nxLoginRoot both stay hidden, and onRouteChange's own
        // AUTH_NOT_CONFIGURED branch (above) guarantees no route change
        // ever re-enters this state's rendering, so no bounce loop is
        // possible. LOCAL gets a developer-oriented hint (how to enable
        // real auth locally); homolog/production get the same generic,
        // credential-free message -- never a raw technical error, never
        // an environment name disclosed beyond what environment-guard.js's
        // own UNKNOWN_HOST screen already would.
        var envName = window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name;
        var configMsg = (envName === 'LOCAL_DEV')
          ? 'Configuração local de autenticação ausente. Crie assets/js/intelligence-runtime-config.local.js a partir de intelligence-runtime-config.example.js para autenticar neste ambiente.'
          : 'Autenticação indisponível neste ambiente no momento.';
        if (bootLoading) {
          bootLoading.hidden = false;
          bootLoading.innerHTML = '<p>' + configMsg + '</p>';
        }
        document.getElementById('nxRoot').hidden = true;
        window.NX_LOGIN.hide();
        return;
      }
      if (bootLoading && state !== STATES.INITIALIZING_SESSION) bootLoading.hidden = true;
      if (state === STATES.AUTHORIZED) {
        document.getElementById('nxRoot').hidden = false;
        window.NX_LOGIN.hide();
        // Re-evaluate the current route under the now-current auth
        // state (covers: fresh login -> land on the route that was
        // originally requested if still valid, or Landing by default;
        // logout elsewhere reverting AUTHORIZED -> SIGNED_OUT re-shows
        // Login via the same listener's else branch below).
        if (!window.NX_ROUTER.currentRouteId()) {
          window.NX_ROUTER.navigate(DEFAULT_ROUTE);
        } else {
          onRouteChange(window.NX_ROUTER.currentRouteId());
        }
        // LAUNCH EXPERIENCE (prototype, local-only) -- purely additive:
        // never delays/alters anything above. Home already renders
        // behind it; this only decides whether to visually dominate the
        // screen with the one-time video overlay (assets/js/launch-
        // experience.js), a no-op after the first time per browser.
        if (window.NX_LAUNCH_EXPERIENCE) window.NX_LAUNCH_EXPERIENCE.presentIfNeeded();
      } else if (state !== STATES.INITIALIZING_SESSION && state !== STATES.AUTHENTICATING && state !== STATES.AUTHENTICATED_RESOLVING_PROFILE) {
        document.getElementById('nxRoot').hidden = true;
        window.NX_LOGIN.render();
      }
    });

    window.NX_REGISTRY.load().then(function () {
      window.NX_ROUTER.onChange(onRouteChange);
      return window.NX_AUTH_CORE.boot();
    }).catch(function () {
      document.getElementById('nxContentOutlet').innerHTML = devAtivo()
        ? '<div class="nxPlaceholder"><h1>Registry failed to load</h1>' +
          '<p>config/module-registry.json could not be fetched. If you ' +
          'opened this file directly (file://), start a local server ' +
          'instead — see docs/DEVELOPMENT.md.</p></div>'
        : '<div class="nxPlaceholder"><h1>Não foi possível carregar o Portal</h1>' +
          '<p>Recarregue a página. Se o problema continuar, tente novamente em alguns minutos.</p></div>';
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
