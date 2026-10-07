/* PORTAL-NEXT V2 — Auth Core (AUTH FOUNDATION Phase 2B).

   Owns the V2 authentication/authorization LIFECYCLE as a
   deterministic state machine. Never calls Supabase directly -- every
   Supabase Auth/RPC call goes through assets/js/auth-boundary.js
   (window.NX_AUTH), per the Login / Auth Core / Router-Guard / Shell /
   Modules boundary established in AUTH FOUNDATION Phase 1 (docs
   pending, see config/module-registry.json's own architecture notes
   for now).

   States (AUTH FOUNDATION Phase 1, Gate 12 / Phase 2A, canonical):
     INITIALIZING_SESSION -> SIGNED_OUT
                           -> AUTHENTICATED_RESOLVING_PROFILE -> AUTHORIZED
                                                                -> INACTIVE_USER
                                                                -> NO_PORTAL_PROFILE
                                                                -> NETWORK_ERROR / RPC_ERROR
     SIGNED_OUT -> AUTHENTICATING -> AUTHENTICATED_RESOLVING_PROFILE (same branches as above)
                                   -> INVALID_CREDENTIALS
                                   -> NETWORK_ERROR
     AUTHORIZED -> SESSION_EXPIRED (observed via onAuthStateChange or a
                   caller reporting a stale-session RPC failure)
                -> SIGNED_OUT (explicit logout)

   AUTH FOUNDATION Phase 2A Gate 25: permission/profile changes take
   effect on next resolution, not instantly and not via a push
   channel -- every real business RPC already independently
   re-checks ativo/perfil/permission server-side on every call, so
   this Auth Context is a UI convenience snapshot, never the actual
   security boundary. Re-run boot()'s resolution again (a fresh login
   or an explicit refresh()) to pick up a change; nothing silently
   goes stale in a way that grants access the backend would refuse. */
(function () {
  'use strict';

  var STATES = {
    INITIALIZING_SESSION: 'INITIALIZING_SESSION',
    // No real Supabase credentials configured anywhere for this host
    // (auth-boundary.js's NX_AUTH.isAuthConfigured === false -- the
    // actual default everywhere today, production included). The
    // route guard treats this identically to "no guard exists yet",
    // preserving every module's pre-Auth-Foundation behavior exactly.
    // Distinct from SIGNED_OUT, which means a real login system
    // exists and this browser simply isn't authenticated against it.
    AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
    SIGNED_OUT: 'SIGNED_OUT',
    AUTHENTICATING: 'AUTHENTICATING',
    AUTHENTICATED_RESOLVING_PROFILE: 'AUTHENTICATED_RESOLVING_PROFILE',
    AUTHORIZED: 'AUTHORIZED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    INACTIVE_USER: 'INACTIVE_USER',
    NO_PORTAL_PROFILE: 'NO_PORTAL_PROFILE',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    RPC_ERROR: 'RPC_ERROR',
    // AUTH FOUNDATION Phase 3B, Gate 16: Supabase's own captcha_failed
    // rejection (observed live, Phase 3A.2-F1: HTTP 400 "captcha
    // protection: request disallowed") must never again surface as a
    // generic RPC_ERROR -- classifyError() below detects it by message
    // before falling through to the generic branch.
    CAPTCHA_FAILED: 'CAPTCHA_FAILED',
    // Paridade com o v1 (trocarSenhaObrigatoria): perfil com primeiro_acesso
    // pendente só entra no Portal depois de definir uma nova senha. O
    // contexto autorizado fica guardado à parte e só vira o contexto real
    // (AUTHORIZED) após a troca concluída no servidor.
    PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED'
  };
  var TROCA_SENHA_KEY = 'nxTrocaSenhaObrigatoria';
  function trocaPendente(v) {
    try {
      if (v === undefined) return window.sessionStorage.getItem(TROCA_SENHA_KEY) === '1';
      if (v) window.sessionStorage.setItem(TROCA_SENHA_KEY, '1'); else window.sessionStorage.removeItem(TROCA_SENHA_KEY);
    } catch (e) { /* sem sessionStorage: a troca continua exigida nesta carga da página */ }
    return !!v;
  }
  var pendingContext = null;

  var state = STATES.INITIALIZING_SESSION;
  var context = null; // Auth Context, null unless state === AUTHORIZED
  var listeners = [];
  var aviso = null;   // notice for the login screen after the session guard ends a session

  function guard() { return window.NX_SESSION_GUARD || null; }

  function setState(next, extra) {
    state = next;
    listeners.forEach(function (fn) {
      try { fn(state, context, extra || null); } catch (e) { console.error('[auth-core] listener error', e); }
    });
  }

  // Never surface raw Supabase/PostgREST error detail to the user --
  // AUTH FOUNDATION Phase 1 Gate 24's failure matrix, generic-message
  // discipline matching V1's own (never leaks which check failed).
  //
  // resolveAuthorizedProfile() throws the SAME message
  // ("não provisionado ou inativo") for a missing usuarios row and
  // for ativo=false -- a deliberate V1 security property (never
  // discloses whether an email is a real, disabled account), not a
  // gap to work around. NO_PORTAL_PROFILE is the one state reachable
  // from that message; INACTIVE_USER stays in the enum for interface
  // completeness (AUTH FOUNDATION Phase 1's own canonical list) but
  // is not distinguishable from the client today.
  function classifyError(err) {
    var msg = String((err && err.message) || err || '');
    if (/captcha/i.test(msg)) return STATES.CAPTCHA_FAILED;
    if (/network|fetch|failed to fetch/i.test(msg)) return STATES.NETWORK_ERROR;
    if (/não provisionado ou inativo/i.test(msg)) return STATES.NO_PORTAL_PROFILE;
    return STATES.RPC_ERROR;
  }

  function buildContext(profile, allowedModuleIds) {
    // AUTH FOUNDATION Phase 1 Gate 21/27: read-only by construction,
    // not by caller discipline. Object.freeze on both the context and
    // its array so a caller holding a getContext() reference (e.g. a
    // module doing window.NX_AUTH_CORE.getContext().isMaster = true)
    // cannot mutate the object isModuleAuthorized actually reads from
    // -- a plain object here would let exactly that frontend-spoofing
    // attempt succeed, which Gate 21 explicitly forbids.
    return Object.freeze({
      userId: profile.userId,
      authUserId: profile.authUserId,
      nome: profile.nome,
      perfil: profile.perfil,
      loja: profile.loja,
      status: profile.status,
      ativo: profile.ativo,
      isMaster: profile.perfil === 'MASTER',
      // Fail-closed by construction: resolveAllowedModules() itself
      // never rejects (auth-boundary.js maps any RPC failure to []),
      // so a permission-RPC outage denies every matrix-governed
      // module rather than granting access.
      allowedModuleIds: Object.freeze((Array.isArray(allowedModuleIds) ? allowedModuleIds : []).slice())
    });
  }

  // Shared by boot() and login() -- once a Supabase session exists,
  // resolving the portal profile and module permissions is identical
  // either way.
  // gate (opcional): função que devolve uma promessa de "precisa trocar a
  // senha?" -- chamada depois de resolver perfil/permissões e ANTES de
  // liberar o Portal. Uma falha do gate trata-se como falha do login.
  function resolveAfterSession(gate) {
    setState(STATES.AUTHENTICATED_RESOLVING_PROFILE);
    return window.NX_AUTH.resolveAuthorizedProfile().then(function (profile) {
      return window.NX_AUTH.resolveAllowedModules().then(function (allowedModuleIds) {
        var ctx = buildContext(profile, allowedModuleIds);
        return Promise.resolve(gate ? gate() : false).then(function (precisaTrocar) {
          if (precisaTrocar) {
            trocaPendente(true);
            pendingContext = ctx;
            context = null;
            setState(STATES.PASSWORD_CHANGE_REQUIRED);
            return;
          }
          context = ctx;
          setState(STATES.AUTHORIZED);
        });
      });
    }).catch(function (err) {
      context = null;
      pendingContext = null;
      setState(classifyError(err), err);
    });
  }

  window.NX_AUTH_CORE = {
    STATES: STATES,

    getState: function () { return state; },
    getContext: function () { return context; },
    onStateChange: function (fn) { listeners.push(fn); },

    // Call once on boot, before mounting any authenticated UI.
    boot: function () {
      setState(STATES.INITIALIZING_SESSION);
      if (!window.NX_AUTH || !window.NX_AUTH.isAuthConfigured) {
        setState(STATES.AUTH_NOT_CONFIGURED);
        return Promise.resolve();
      }
      return window.NX_AUTH.getSession().then(function (session) {
        if (!session) {
          trocaPendente(false);
          setState(STATES.SIGNED_OUT);
          return;
        }
        // recarga da página no meio de uma troca obrigatória: continua exigindo a troca
        return resolveAfterSession(function () { return trocaPendente(); });
      }).catch(function (err) {
        setState(classifyError(err), err);
      });
    },

    // captchaToken (AUTH FOUNDATION Phase 3B): forwarded to
    // auth-boundary.js's signIn() unchanged; Auth Core stays ignorant
    // of Cloudflare/Turnstile details (Gate 8) -- Login owns
    // acquiring the token, this method only relays it.
    login: function (email, password, captchaToken) {
      if (!window.NX_AUTH || !window.NX_AUTH.isAuthConfigured) {
        setState(STATES.AUTH_NOT_CONFIGURED);
        return Promise.resolve();
      }
      setState(STATES.AUTHENTICATING);
      aviso = null;
      return window.NX_AUTH.signIn(email, password, captchaToken).then(function () {
        if (guard()) guard().iniciarSessao(); // the 10 h limit counts from this login
        // Paridade com o v1: registrar_meu_login (ultimo_login) só após login
        // interativo, nunca no boot; ele também informa se a troca de senha
        // é obrigatória. Falhou -> o login falha e a sessão é encerrada (como no v1).
        return resolveAfterSession(function () {
          if (typeof window.NX_AUTH.registerLogin !== 'function') return false;
          return window.NX_AUTH.registerLogin().then(function (r) { return !!(r && r.primeiroAcesso); }, function (err) {
            return window.NX_AUTH.signOut().catch(function () {}).then(function () { throw err; });
          });
        });
      }).catch(function (err) {
        context = null;
        var msg = String((err && err.message) || err || '');
        if (/invalid.*credentials|invalid.*login/i.test(msg)) {
          setState(STATES.INVALID_CREDENTIALS, err);
          return;
        }
        setState(classifyError(err), err);
      });
    },

    // Troca de senha obrigatória: nova senha (mín. 8, confirmada) -> Auth ->
    // operational_complete_password_change -> só então AUTHORIZED.
    completePasswordChange: function (novaSenha, confirmacao) {
      if (state !== STATES.PASSWORD_CHANGE_REQUIRED || !pendingContext) return Promise.reject(new Error('Nenhuma troca de senha pendente.'));
      if (!novaSenha || String(novaSenha).length < 8) return Promise.reject(new Error('A nova senha precisa ter no mínimo 8 caracteres.'));
      if (novaSenha !== confirmacao) return Promise.reject(new Error('As senhas não conferem.'));
      return window.NX_AUTH.updatePassword(novaSenha).then(function () {
        return window.NX_AUTH.completePasswordChange();
      }).then(function () {
        trocaPendente(false);
        context = pendingContext;
        pendingContext = null;
        setState(STATES.AUTHORIZED);
      });
    },
    cancelPasswordChange: function () {
      pendingContext = null;
      return window.NX_AUTH_CORE.logout();
    },

    logout: function () {
      trocaPendente(false);
      pendingContext = null;
      if (guard()) guard().limparSessao();
      return window.NX_AUTH.signOut().then(function () {
        context = null;
        setState(STATES.SIGNED_OUT);
      }).catch(function () {
        // Sign-out failing server-side is not a reason to leave the
        // UI mounted as if still authorized -- clear local state
        // regardless (AUTH FOUNDATION Phase 1 Gate 15).
        context = null;
        setState(STATES.SIGNED_OUT);
      });
    },

    // A caller (e.g. a module's own RPC call) that observes a
    // stale-session failure mid-use reports it here rather than each
    // module inventing its own session-expiry handling -- AUTH
    // FOUNDATION Phase 1 Gate 11/16's centralization requirement.
    reportSessionExpired: function () {
      context = null;
      setState(STATES.SESSION_EXPIRED);
    },

    // Session guard (inactivity / maximum age): ends THIS tab's session and returns to
    // login with `msg`. The state changes BEFORE signOut so the SIGNED_OUT event that
    // signOut emits can't overwrite it (the listener below only acts on AUTHORIZED).
    encerrarSessao: function (msg) {
      if (state !== STATES.AUTHORIZED) return Promise.resolve();
      context = null;
      aviso = msg || null;
      setState(STATES.SESSION_EXPIRED, { aviso: aviso });
      return window.NX_AUTH.signOut().catch(function () { /* local state already cleared */ });
    },

    getAviso: function () { return aviso; },

    // AUTH FOUNDATION Phase 2B, Gate 9/26: the ONE authorization-
    // decision implementation, consumed by both shell.js's route
    // guard (routing) and landing.js's nav rendering (visibility) --
    // duplicating this logic in two files was rejected on purpose.
    // Fail-closed for every unrecognized case; authMode values are
    // frontend-known constants, never dynamically executed from a
    // backend-returned string (Gate 9's explicit boundary).
    isModuleAuthorized: function (entry) {
      if (!entry) return false;
      // GL-ENV-AUTH-WRITE-BOUNDARY: previously returned true here
      // (AUTH_NOT_CONFIGURED treated as "no guard exists yet",
      // preserving pre-Auth-Foundation behavior) -- the Human
      // Environment Authority for this wave requires AUTH_NOT_CONFIGURED
      // to NEVER authorize a protected module, on any host. This alone
      // is not sufficient by construction (shell.js's own boot()
      // onStateChange handler and onRouteChange guard were changed in
      // the same wave/commit to stop treating this state as equivalent
      // to AUTHORIZED -- without those, this line alone would produce a
      // silent route-bounce dead-end, not a safe fail-closed screen).
      if (state === STATES.AUTH_NOT_CONFIGURED) return false;
      if (!context) return false;
      switch (entry.authMode) {
        case 'LOGIN_REQUIRED': return true;
        case 'MASTER_ONLY': return context.isMaster === true;
        case 'ANALISTA_OR_MASTER': return context.isMaster === true || context.perfil === 'ANALISTA';
        // The module's own server decides (e.g. the IA function's BI_PERFIS):
        // the module registers a check in NX_SEPARATE_AUTHORITY[id]; none
        // registered, or not yet confirmed by the server, means denied.
        case 'SEPARATE_AUTHORITY':
          var separada = window.NX_SEPARATE_AUTHORITY && window.NX_SEPARATE_AUTHORITY[entry.id];
          return typeof separada === 'function' && separada(context) === true;
        case 'PERMISSION_MATRIX':
          if (!entry.permissionId) return false;
          return context.allowedModuleIds.indexOf(entry.permissionId) !== -1;
        default: return false;
      }
    }
  };

  // Central session-event wiring (AUTH FOUNDATION Phase 1 Gate 20) --
  // modules must never attach their own onAuthStateChange listener.
  // Deferred until NX_AUTH exists in its active form (auth-boundary.js
  // loads before this file but only assigns a real client when
  // credentials are configured either way; onAuthStateChange is safe
  // to call even against the inactive stub's thrown-error version
  // because we only wire it once real credentials are present).
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.NX_AUTH.onAuthStateChange !== 'function') return;
    try {
      window.NX_AUTH.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT' && state === STATES.AUTHORIZED) {
          // Session per tab: supabase-js relays auth events from OTHER tabs (a logout there,
          // or a duplicated tab clearing its copy). Only leave if THIS tab has no session.
          window.NX_AUTH.getSession().then(function (session) {
            if (session || state !== STATES.AUTHORIZED) return;
            context = null;
            setState(STATES.SIGNED_OUT);
          }, function () { /* keep the current state; the next RPC will report expiry */ });
        }
      });
    } catch (e) {
      // Inactive-boundary stub throws synchronously when called --
      // expected on any host without real credentials configured.
    }
  });
})();
