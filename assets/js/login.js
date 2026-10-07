/* PORTAL-NEXT V2 — Login (AUTH FOUNDATION Phase 2B).

   LOGIN owns authentication UX only (AUTH FOUNDATION Phase 1 Gate 20)
   -- it renders the form and reacts to assets/js/auth-core.js's state,
   never calls Supabase directly, never duplicates a Supabase client.

   AUTH FOUNDATION Phase 2A Gate 16 (corrected from Phase 1): Landing
   is LOGIN_REQUIRED, not anonymous -- this file is V2's one genuinely
   anonymous surface. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  // AUTH FOUNDATION Phase 1 Gate 24: generic, non-disclosing messages
  // matching V1's own security posture exactly -- never reveal which
  // specific check failed.
  var STATE_MESSAGES = {};
  function messagesFor(STATES) {
    var m = {};
    m[STATES.INVALID_CREDENTIALS] = 'E-mail ou senha inválidos.';
    m[STATES.NO_PORTAL_PROFILE] = 'Usuário não provisionado ou inativo.';
    m[STATES.INACTIVE_USER] = 'Usuário não provisionado ou inativo.';
    m[STATES.SESSION_EXPIRED] = 'Sua sessão expirou. Entre novamente.';
    m[STATES.NETWORK_ERROR] = 'Não foi possível conectar. Verifique sua conexão e tente novamente.';
    m[STATES.RPC_ERROR] = 'Não foi possível concluir o login agora. Tente novamente.';
    m[STATES.CAPTCHA_FAILED] = 'Não foi possível validar a verificação de segurança. Tente novamente.';
    return m;
  }

  // AUTH FOUNDATION Phase 3B: Cloudflare Turnstile wiring. LOGIN owns
  // the entire widget lifecycle (Gate 8) -- Auth Core only ever
  // receives an opaque captchaToken string, never touches Cloudflare
  // DOM/script. turnstileSiteKey absent/empty (every mock/fixture
  // host, the committed default) means real mode is not in use here
  // at all: getCaptchaToken() resolves null immediately, zero
  // Cloudflare network dependency (Gate 14/20). Pattern verified
  // against V1's own already-working implementation (Authority repo,
  // portal-app.js loadTurnstileScript()/obtainTurnstileToken()) rather
  // than invented from memory (Gate 7).
  var turnstileSiteKey = String((window.NX_INTELLIGENCE_CONFIG || {}).turnstileSiteKey || '').trim();
  var turnstileScriptPromise = null;
  var turnstileTokenPromise = null; // in-flight guard: prevents duplicate concurrent widgets

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-nx-turnstile]');
      var script = existing || document.createElement('script');
      var timeout = setTimeout(function () {
        reject(new Error('Tempo esgotado ao carregar a verificação de segurança.'));
      }, 20000);
      script.onload = function () {
        clearTimeout(timeout);
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('A verificação de segurança não foi inicializada.'));
      };
      script.onerror = function () {
        clearTimeout(timeout);
        turnstileScriptPromise = null;
        reject(new Error('Não foi possível carregar a verificação de segurança.'));
      };
      if (!existing) {
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.nxTurnstile = 'true';
        document.head.appendChild(script);
      }
    });
    return turnstileScriptPromise;
  }

  // Renders a fresh widget into the given host element and executes it
  // (execution:'execute' + appearance:'interaction-only' -- invisible
  // unless Cloudflare decides an interactive check is required,
  // matching Gate 12's "no redesign"). A new widget per call, mirrors
  // V1's own proven pattern exactly -- this also IS the token reset
  // Gate 17 asks for: a stale/used token is never reused, the next
  // submit attempt always requests a fresh one.
  // AUTH-ACCESS-06: hostId is now a parameter (was hardcoded to
  // 'loginTurnstile') so assets/js/first-access.js can reuse this exact
  // function -- and loadTurnstileScript() below -- instead of
  // duplicating the CAPTCHA loading infrastructure (brief Section 5).
  function renderAndExecuteTurnstile(hostId, api) {
    return new Promise(function (resolve, reject) {
      var host = document.getElementById(hostId);
      if (!host) { reject(new Error('Verificação de segurança indisponível nesta tela.')); return; }
      host.innerHTML = '';
      var finished = false;
      var timer = setTimeout(function () {
        finish(new Error('A verificação de segurança expirou. Tente novamente.'));
      }, 60000);
      function finish(error, token) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(token);
      }
      try {
        var widgetId = api.render(host, {
          sitekey: turnstileSiteKey,
          theme: 'dark',
          appearance: 'interaction-only',
          execution: 'execute',
          callback: function (token) { finish(null, token); },
          'error-callback': function () { finish(new Error('CAPTCHA_FAILED')); },
          'expired-callback': function () { finish(new Error('A verificação de segurança expirou. Tente novamente.')); }
        });
        api.execute(widgetId);
      } catch (err) { finish(err); }
    });
  }

  function getCaptchaToken() {
    if (!turnstileSiteKey) return Promise.resolve(null);
    if (turnstileTokenPromise) return turnstileTokenPromise;
    turnstileTokenPromise = loadTurnstileScript()
      .then(function (api) { return renderAndExecuteTurnstile('loginTurnstile', api); })
      .then(function (token) {
        turnstileTokenPromise = null;
        return token;
      }, function (err) {
        turnstileTokenPromise = null;
        throw err;
      });
    return turnstileTokenPromise;
  }

  var mounted = false;
  var submitting = false;

  // LOGIN-SIGNATURE-03: reuses the Portal's own real ambient motion
  // (window.MotionEngine.mount + 'parametric_reactive', both loaded
  // unmodified from assets/js/vendor/engine.js and
  // assets/js/vendor/parametric-catalog.js) -- same speed/colorMode/
  // customColor landing.js's mountLandingAmbient() uses, same
  // reduced-motion short-circuit (MotionEngine.reduce -> opacity 0,
  // never mounted). Opacity is calibrated lower (~30% of the 0.25
  // landing.js applies) so the effect stays a discreet, elegant
  // background and never competes with the form. Does not touch
  // window.NX_MOTION (shell.js's context-change-reaction registry) --
  // this anonymous, pre-auth screen has no module context to react to.
  function mountLoginAmbient() {
    var layer = document.getElementById('loginMotionLayer');
    if (!layer) return;
    if (window.MotionEngine && window.MotionEngine.reduce) { layer.style.opacity = '0'; return; }
    if (!window.MotionEngine) { return; }
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    layer.appendChild(canvas);
    layer.style.opacity = '0.18';
    window.MotionEngine.mount(canvas, 'parametric_reactive', { speed: 0.75, colorMode: 'brand_red', customColor: '#c1121f' });
  }

  function ensureMounted() {
    var root = document.getElementById('nxLoginRoot');
    if (mounted || !root) return root;
    // LOGIN-SIGNATURE-01/02 -- visual layer only. Every id/name/type/
    // autocomplete attribute below that the script logic in this file
    // depends on (#loginForm, #loginEmail, #loginPassword,
    // #loginTurnstile, #loginStatus, #loginSubmit) is byte-identical to
    // before Wave 01 -- only the surrounding markup/classes changed.
    // AUTH-ACCESS-06: "Primeiro acesso? -> Ativar meu acesso" now owns
    // #firstAccessPanel, an empty container populated/wired entirely by
    // assets/js/first-access.js (window.NX_FIRST_ACCESS.mount(), called
    // below) -- this file's own submit handler, getCaptchaToken,
    // setSubmitting, renderStatus, and normal-login contract stay
    // completely untouched.
    // AUTH-RECOVERY-01: "Esqueci minha senha" now owns
    // #passwordRecoveryPanel the same way -- an empty container
    // populated/wired entirely by assets/js/password-recovery.js
    // (window.NX_PASSWORD_RECOVERY.mount(), called below). Moved
    // outside <form id="loginForm"> (was nested inside it) so its own
    // interactive controls never risk triggering the normal-login
    // submit -- purely a structural move, the form's own fields/submit
    // button are unchanged.
    // LOGIN-SIGNATURE-02: removed the institutional lede paragraph and
    // the "8 Unidades / 360° Visão F&I / 1 Painel único" stats block
    // (Human request) -- no replacement text/indicators added.
    // LOGIN-SIGNATURE-03: the giant atmospheric DNA helix image is
    // replaced by #loginMotionLayer, mounted below via the SAME
    // MotionEngine + 'parametric_reactive' motion (assets/js/vendor/
    // engine.js + parametric-catalog.js) actually used inside the
    // Portal (landing.js's mountLandingAmbient(), unmodified) -- not a
    // new interpretation. The small DNA BRABUS lockup (.loginPlate) and
    // the Mitsubishi Brabus mark (.loginPartner) are untouched.
    root.innerHTML =
      '<div class="loginStage">' +
        '<div class="loginInstitutional">' +
          '<div class="loginBlueprint" aria-hidden="true"></div>' +
          '<div class="loginMotion" id="loginMotionLayer" aria-hidden="true"></div>' +
          '<div class="loginBrandRow">' +
            '<div class="loginPlate"><img src="assets/images/dna-brabus-lockup.png" alt="DNA Brabus"></div>' +
            '<img class="loginPartner" src="assets/images/brabus-logo.png" alt="Grupo Brabus Mitsubishi">' +
          '</div>' +
          '<div class="loginHeadline">' +
            '<p class="loginEyebrow">Grupo Brabus Mitsubishi</p>' +
            '<h1 class="loginDisplay">Portal <em>F&amp;I</em></h1>' +
          '</div>' +
        '</div>' +
        '<div class="loginAuth">' +
          '<div class="loginShell">' +
            '<div class="loginCard">' +
              '<div class="loginCardHead">' +
                '<h2 class="loginTitle">Acessar o Portal</h2>' +
                '<p class="loginSubtitle">Entre com sua conta para continuar.</p>' +
              '</div>' +
              '<form id="loginForm" novalidate>' +
                '<div class="loginField">' +
                  '<label for="loginEmail">E-mail</label>' +
                  '<input id="loginEmail" name="email" type="email" autocomplete="username" required>' +
                '</div>' +
                '<div class="loginField">' +
                  '<label for="loginPassword">Senha</label>' +
                  '<input id="loginPassword" name="password" type="password" autocomplete="current-password" required>' +
                '</div>' +
                (turnstileSiteKey ? '<div id="loginTurnstile" class="loginTurnstile" aria-label="Verificação de segurança"></div>' : '') +
                '<div id="loginStatus" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
                '<button type="submit" id="loginSubmit" class="loginSubmit">Entrar</button>' +
              '</form>' +
              // Troca de senha obrigatória no 1º acesso (paridade com o v1):
              // só aparece no estado PASSWORD_CHANGE_REQUIRED.
              '<form id="loginTrocaSenhaForm" novalidate hidden>' +
                '<p class="loginSubtitle" id="loginTrocaSenhaIntro">Por segurança, defina uma nova senha antes de entrar (mínimo de 8 caracteres).</p>' +
                '<div class="loginField">' +
                  '<label for="loginNovaSenha">Nova senha</label>' +
                  '<input id="loginNovaSenha" name="nova-senha" type="password" autocomplete="new-password" minlength="8" required>' +
                '</div>' +
                '<div class="loginField">' +
                  '<label for="loginNovaSenhaConf">Confirme a nova senha</label>' +
                  '<input id="loginNovaSenhaConf" name="nova-senha-confirmacao" type="password" autocomplete="new-password" minlength="8" required>' +
                '</div>' +
                '<div id="loginTrocaStatus" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
                '<button type="submit" id="loginTrocaSubmit" class="loginSubmit">Salvar nova senha e entrar</button>' +
                '<button type="button" id="loginTrocaCancel" class="loginAssistLink">Cancelar e sair</button>' +
              '</form>' +
              '<div class="loginAssist">' +
                '<details id="passwordRecoveryDetails">' +
                  '<summary class="loginAssistLink">Esqueci minha senha</summary>' +
                  '<div id="passwordRecoveryPanel" class="firstAccessPanel"></div>' +
                '</details>' +
              '</div>' +
              '<div class="loginAssist">' +
                '<p class="loginPrimeiroLabel">Primeiro acesso?</p>' +
                '<details id="firstAccessDetails">' +
                  '<summary class="loginAssistBtn">Ativar meu acesso</summary>' +
                  '<div id="firstAccessPanel" class="firstAccessPanel"></div>' +
                '</details>' +
              '</div>' +
              '<p class="loginFooter">Desenvolvido por <b>BLISTIQ</b></p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    mountLoginAmbient();

    if (window.NX_FIRST_ACCESS) window.NX_FIRST_ACCESS.mount();
    if (window.NX_PASSWORD_RECOVERY) window.NX_PASSWORD_RECOVERY.mount();

    // Warm up the Turnstile script early (Gate 10) so the first
    // submit doesn't pay the full script-load latency -- purely a
    // prefetch, no widget is rendered/executed until an actual submit.
    if (turnstileSiteKey) loadTurnstileScript().catch(function () {});

    var form = document.getElementById('loginForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      var email = document.getElementById('loginEmail').value.trim();
      var password = document.getElementById('loginPassword').value;
      if (!email || !password) return;
      submitting = true;
      setSubmitting(true);
      renderStatus(null);
      // Gate 14: in real mode, never call signInWithPassword without
      // a captchaToken -- a rejected getCaptchaToken() falls straight
      // to the .catch below and auth-core.login() is never reached.
      getCaptchaToken().then(function (captchaToken) {
        return window.NX_AUTH_CORE.login(email, password, captchaToken);
      }).catch(function () {
        submitting = false;
        setSubmitting(false);
        // AUTH FOUNDATION forensic gate: deliberately DISTINCT from
        // STATES.CAPTCHA_FAILED's message (messagesFor(), above) --
        // that one means Supabase rejected an actually-submitted
        // token; this one means the widget itself never produced a
        // token (script/render/execute failure), so auth-core.login()
        // was never even called. Sharing identical text made an
        // earlier real incident (widget never engaged because
        // turnstileSiteKey was absent from runtime config, so
        // Supabase's own captcha_failed rejection looked identical to
        // a local widget failure) needlessly hard to root-cause from
        // the message alone.
        renderStatus('Não foi possível concluir a verificação de segurança antes de entrar. Tente novamente.', 'error');
      });
    });
    var trocaForm = document.getElementById('loginTrocaSenhaForm');
    var trocando = false;
    function trocaStatus(text, kind) {
      var el = document.getElementById('loginTrocaStatus');
      if (!el) return;
      if (!text) { el.hidden = true; el.textContent = ''; return; }
      el.hidden = false;
      el.className = 'loginStatus loginStatus' + (kind === 'error' ? 'Error' : 'Info');
      el.textContent = text;
    }
    trocaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (trocando) return;
      var nova = document.getElementById('loginNovaSenha').value;
      var conf = document.getElementById('loginNovaSenhaConf').value;
      if (!nova || nova.length < 8) { trocaStatus('A nova senha precisa ter no mínimo 8 caracteres.', 'error'); return; }
      if (nova !== conf) { trocaStatus('As senhas não conferem.', 'error'); return; }
      trocando = true;
      var btn = document.getElementById('loginTrocaSubmit');
      btn.disabled = true; btn.textContent = 'Salvando…';
      trocaStatus(null);
      window.NX_AUTH_CORE.completePasswordChange(nova, conf).then(function () {
        document.getElementById('loginNovaSenha').value = '';
        document.getElementById('loginNovaSenhaConf').value = '';
      }, function (err) {
        trocaStatus('Não foi possível atualizar a senha' + (err && err.message ? ': ' + err.message : '.'), 'error');
      }).then(function () {
        trocando = false;
        btn.disabled = false; btn.textContent = 'Salvar nova senha e entrar';
      });
    });
    document.getElementById('loginTrocaCancel').addEventListener('click', function () {
      document.getElementById('loginNovaSenha').value = '';
      document.getElementById('loginNovaSenhaConf').value = '';
      window.NX_AUTH_CORE.cancelPasswordChange();
    });
    mounted = true;
    return root;
  }

  // Alterna o cartão entre o login normal e a troca de senha obrigatória.
  function showTrocaSenha(on) {
    var form = document.getElementById('loginForm');
    var troca = document.getElementById('loginTrocaSenhaForm');
    if (!form || !troca) return;
    form.hidden = !!on;
    troca.hidden = !on;
    Array.prototype.forEach.call(document.querySelectorAll('#nxLoginRoot .loginAssist'), function (el) { el.hidden = !!on; });
    var title = document.querySelector('#nxLoginRoot .loginTitle');
    var sub = document.querySelector('#nxLoginRoot .loginCardHead .loginSubtitle');
    if (title) title.textContent = on ? 'Troca de senha obrigatória' : 'Acessar o Portal';
    if (sub) sub.textContent = on ? 'Primeiro acesso: crie a sua senha pessoal.' : 'Entre com sua conta para continuar.';
    if (on) { var f = document.getElementById('loginNovaSenha'); if (f) f.focus(); }
  }

  function setSubmitting(isSubmitting) {
    var btn = document.getElementById('loginSubmit');
    var email = document.getElementById('loginEmail');
    var password = document.getElementById('loginPassword');
    if (btn) { btn.disabled = isSubmitting; btn.textContent = isSubmitting ? 'Entrando…' : 'Entrar'; }
    if (email) email.disabled = isSubmitting;
    if (password) password.disabled = isSubmitting;
  }

  function renderStatus(text, kind) {
    var el = document.getElementById('loginStatus');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'loginStatus loginStatus' + (kind === 'error' ? 'Error' : 'Info');
    el.textContent = text;
  }

  window.NX_LOGIN = {
    // AUTH-ACCESS-06: exposed so first-access.js reuses this exact
    // CAPTCHA loading/render/execute logic instead of duplicating it
    // (brief Section 5, "não duplicar desnecessariamente"). hostId lets
    // each caller point at its own widget container.
    loadTurnstileScript: loadTurnstileScript,
    renderAndExecuteTurnstile: renderAndExecuteTurnstile,
    turnstileSiteKey: turnstileSiteKey,

    render: function () {
      var root = ensureMounted();
      if (!root) return;
      root.hidden = false;

      var STATES = window.NX_AUTH_CORE.STATES;
      STATE_MESSAGES = messagesFor(STATES);
      var state = window.NX_AUTH_CORE.getState();

      showTrocaSenha(state === STATES.PASSWORD_CHANGE_REQUIRED);
      if (state === STATES.PASSWORD_CHANGE_REQUIRED) { submitting = false; setSubmitting(false); return; }

      if (state === STATES.AUTHENTICATING || state === STATES.AUTHENTICATED_RESOLVING_PROFILE) {
        submitting = true;
        setSubmitting(true);
        renderStatus(null);
        return;
      }

      submitting = false;
      setSubmitting(false);
      // a session that ended (inactivity, 10 h limit, logout) never leaves the previous
      // password sitting in the reused form
      if (state === STATES.SESSION_EXPIRED || state === STATES.SIGNED_OUT) {
        var senha = document.getElementById('loginPassword');
        if (senha) senha.value = '';
      }
      // session ended by the session guard: its own notice (inactivity / 10 h limit)
      var aviso = state === STATES.SESSION_EXPIRED && typeof window.NX_AUTH_CORE.getAviso === 'function' ? window.NX_AUTH_CORE.getAviso() : null;
      if (aviso) { renderStatus(aviso, 'info'); return; }
      var message = STATE_MESSAGES[state];
      if (message) renderStatus(message, 'error');
      else renderStatus(null);
    },

    hide: function () {
      var root = document.getElementById('nxLoginRoot');
      if (root) root.hidden = true;
    }
  };

  // Re-render on every relevant auth-core transition so the login
  // screen reflects INVALID_CREDENTIALS/NETWORK_ERROR/etc. without
  // shell.js having to know Login's own internal states.
  document.addEventListener('DOMContentLoaded', function () {
    window.NX_AUTH_CORE.onStateChange(function (state) {
      var STATES = window.NX_AUTH_CORE.STATES;
      if (state === STATES.AUTHORIZED || state === STATES.AUTH_NOT_CONFIGURED) return; // shell.js hides Login itself
      var root = document.getElementById('nxLoginRoot');
      if (root && !root.hidden) window.NX_LOGIN.render();
    });
  });
})();
