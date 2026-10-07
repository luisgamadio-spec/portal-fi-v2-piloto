/* PORTAL-NEXT V2 — Auth Boundary (IA-V2-2, generalized AUTH FOUNDATION
   Phase 2B).

   The single file that ever calls supabaseClient.auth.* or the
   profile/permission RPCs (see docs/ARCHITECTURE.md's Login/Auth Core/
   Router-Guard/Shell/Modules boundary) -- same contract shape the
   Foundation-phase stub declared, NOT a new auth mechanism. Reuses
   V1's exact real flow: signInWithPassword for login, getSession()
   for the current session, and RPC usuario_logado_fi() for role
   resolution -- a SERVER-SIDE lookup, never a client-side claim (see
   PORTAL-NEXT-01/ARCHITECTURE-AUDIT.md Gate 6, carried forward here).
   Module permission resolution (portal_modulos_permitidos()) lives
   here too, for the same "one file owns every auth RPC" reason --
   auth-core.js orchestrates the lifecycle, it never touches Supabase
   directly.

   AUTH FOUNDATION Phase 2A, Gate 3/8/10: two real field-mapping
   defects fixed this Wave against the actual live usuario_logado_fi()
   RPC shape (confirmed by direct schema inspection, not assumption):
   the RPC returns `usuario_id`, not `id` -- V1's own production code
   has carried the same wrong-field bug -- and it does not return
   `primeiro_acesso` at all, so that property is dropped entirely
   rather than defaulted to false (a false default would falsely claim
   the backend said first-access is complete). See AUTH-V1-FIRST-
   ACCESS-DEFECT -- intentionally NOT fixed here; this file only stops
   consuming a field the RPC never provided.

   Activation generalized beyond Intelligence-only real_text mode:
   this boundary is now live whenever supabaseUrl/supabasePublishableKey
   are configured, for ANY consumer (Auth Core included), not only when
   NX_INTELLIGENCE_CONFIG.mode==='real_text'. The default committed
   config still ships both fields null, so this remains fully inert on
   any host without a local override file, production included -- the
   same Gate 8 feature containment as before, just no longer coupled
   to Intelligence's own mode flag. When inactive, every method still
   throws with the same NOT_IMPLEMENTED-shaped message, so a caller
   that isn't going through Auth Core's boot sequence continues to
   fail loudly instead of silently no-op'ing. */
(function () {
  'use strict';

  function notImplemented(name) {
    return function () {
      throw new Error(
        '[auth-boundary] ' + name + '() has no active Supabase client this ' +
        'session -- supabaseUrl/supabasePublishableKey are not configured. ' +
        'See assets/js/intelligence-runtime-config.example.js.'
      );
    };
  }

  var cfg = window.NX_INTELLIGENCE_CONFIG || {};
  var active = !!cfg.supabaseUrl && !!cfg.supabasePublishableKey;

  if (!active || typeof window.supabase === 'undefined') {
    // getAccessToken deliberately OMITTED here (not stubbed to
    // notImplemented): brabus-intelligence.js's existing guard
    // (`typeof window.NX_AUTH.getAccessToken !== 'function'`) depends
    // on it being genuinely undefined, not a function that throws, to
    // fail safely in fixture mode. Do not add it without re-auditing
    // that call site.
    window.NX_AUTH = {
      // AUTH FOUNDATION Phase 2B, Gate 10/28: the route guard reads
      // this flag, NOT a query param/localStorage/config override, to
      // decide whether to enforce authorization at all. false here
      // means no real Supabase credentials exist anywhere for this
      // environment (the actual default state of every host today,
      // production included) -- the guard stays fully inert, an
      // unconfigured-vs-configured distinction, not a bypass of a
      // real system. It flips true only once real credentials are
      // configured, the same gate Intelligence's real_text mode
      // already relies on.
      isAuthConfigured: false,
      signIn: notImplemented('signIn'),
      getSession: notImplemented('getSession'),
      onAuthStateChange: notImplemented('onAuthStateChange'),
      resolveAuthorizedProfile: notImplemented('resolveAuthorizedProfile'),
      resolveAllowedModules: notImplemented('resolveAllowedModules'),
      signOut: notImplemented('signOut')
    };
    return;
  }

  // Session per tab (session-guard.js): the session lives in this tab's sessionStorage, and
  // the storage only answers after the duplicated-tab check — a copied tab never sees the
  // original tab's refresh token. Without the guard, fall back to the same sessionStorage.
  var guard = window.NX_SESSION_GUARD || null;
  var client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: {
      storage: guard ? guard.storage : window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  if (guard) {
    guard.pronto.then(function (r) {
      // A copy only clears its own storage: the inherited session was hidden from the
      // client, so this signOut has no access token and makes no server call (calling
      // the server with the copied token would end the ORIGINAL tab's session).
      if (r && r.copia) client.auth.signOut({ scope: 'local' }).catch(function () {});
    });
  }

  // usuario_logado_fi()'s real, live RETURNS TABLE shape (confirmed by
  // direct schema inspection, AUTH FOUNDATION Phase 2A Gate 8):
  // (usuario_id, auth_user_id, nome, cpf_normalizado, email_auth,
  // perfil, loja, status, ativo) -- no `id`, no `primeiro_acesso`.
  function userFromRow(row) {
    if (!row) return null;
    return {
      userId: row.usuario_id,
      authUserId: row.auth_user_id,
      nome: row.nome || '',
      perfil: String(row.perfil || '').toUpperCase(),
      loja: row.loja || '',
      status: row.status || '',
      ativo: row.ativo !== false
    };
  }

  window.NX_AUTH = {
    isAuthConfigured: true,
    // captchaToken (AUTH FOUNDATION Phase 3B, Gate 7): forwarded in
    // the exact shape verified against the real auth-js
    // SignInWithPasswordCredentials type -- signInWithPassword takes
    // ONE credentials object with `options.captchaToken` nested
    // inside it, never a second function argument (a prior version of
    // this method passed captchaToken as a phantom 2nd argument,
    // which signInWithPassword silently ignores -- the token would
    // never have reached Supabase at all). Omitted entirely (not sent
    // as null) when absent, since Supabase treats a present-but-null
    // captchaToken as a deliberate empty-token attempt rather than
    // "no captcha in use."
    signIn: function (email, password, captchaToken) {
      var creds = { email: email, password: password };
      if (captchaToken) creds.options = { captchaToken: captchaToken };
      return client.auth.signInWithPassword(creds).then(function (result) {
        if (result.error) throw result.error;
        return { session: result.data.session };
      });
    },

    getSession: function () {
      return client.auth.getSession().then(function (result) {
        return result.data ? result.data.session : null;
      });
    },

    onAuthStateChange: function (callback) {
      return client.auth.onAuthStateChange(function (event, session) {
        callback(event, session);
      });
    },

    // SERVER-SIDE role resolution only -- never trusts a client-held
    // claim. A caller that skips this and reads e.g. a JWT's own
    // unverified claims for authorization would be reintroducing
    // exactly what Gate 6 forbids.
    resolveAuthorizedProfile: function () {
      return client.rpc('usuario_logado_fi').then(function (result) {
        if (result.error) throw result.error;
        var row = Array.isArray(result.data) ? result.data[0] : result.data;
        var user = userFromRow(row);
        if (!user || !user.ativo) throw new Error('Usuário não provisionado ou inativo.');
        return user;
      });
    },

    // AUTH FOUNDATION Phase 2B, Gate 7: the real permission-matrix RPC
    // (AUTH FOUNDATION Phase 2A Gate 9) -- default-deny by its own
    // server-side design (empty identity/unmapped profile -> '[]').
    // Fail-closed here too: any RPC error resolves to an empty array,
    // never "show everything" -- callers must never interpret a
    // rejected promise from this method as "trust the caller's own
    // cached list instead."
    resolveAllowedModules: function () {
      return client.rpc('portal_modulos_permitidos').then(function (result) {
        if (result.error) return [];
        return Array.isArray(result.data) ? result.data : [];
      }).catch(function () {
        return [];
      });
    },

    // Paridade com o v1 (auditoria de 07/10/2026): registrar_meu_login grava
    // usuarios.ultimo_login e zera tentativas_login para o próprio usuário
    // (auth.uid()), logo após um login interativo -- o v1 faz o mesmo em
    // syncSupabaseUsuario. Da linha devolvida só se lê primeiro_acesso
    // (troca de senha obrigatória, como no v1); o resto é descartado.
    registerLogin: function () {
      return client.rpc('registrar_meu_login').then(function (result) {
        if (result.error) throw result.error;
        var row = Array.isArray(result.data) ? result.data[0] : result.data;
        return { primeiroAcesso: !!(row && row.primeiro_acesso === true) };
      });
    },

    // Troca de senha obrigatória no 1º acesso (paridade com o v1,
    // trocarSenhaObrigatoria): nova senha no Auth do próprio usuário e
    // depois operational_complete_password_change (primeiro_acesso=false).
    updatePassword: function (novaSenha) {
      return client.auth.updateUser({ password: novaSenha }).then(function (result) {
        if (result.error) throw result.error;
        return true;
      });
    },
    completePasswordChange: function () {
      return client.rpc('operational_complete_password_change').then(function (result) {
        if (result.error) throw result.error;
        return true;
      });
    },

    // scope 'local': ends only THIS tab's session (the default 'global' would also end
    // the independent sessions of the user's other tabs).
    signOut: function () {
      return client.auth.signOut({ scope: 'local' });
    },

    // Needed because the TEXT transport adapter (and now Auth Core's
    // own callers) need the raw bearer token, not just the session
    // object, and re-deriving it from getSession() at every call site
    // would duplicate this same one-liner everywhere.
    getAccessToken: function () {
      return client.auth.getSession().then(function (result) {
        var session = result.data ? result.data.session : null;
        return session ? session.access_token : null;
      });
    }
  };
})();
