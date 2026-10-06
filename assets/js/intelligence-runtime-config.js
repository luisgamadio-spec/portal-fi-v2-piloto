/* PORTAL-NEXT V2 — Supabase runtime config (IA-V2-2, ownership
   clarified AUTH FOUNDATION Phase 2C Gate 3-4; Brabus Intelligence
   RESET -- the Intelligence-only fields this object used to carry
   (mode/textEndpoint/voiceRealtimeEndpoint) were removed along with
   the conversational implementation that read them; nothing in this
   codebase reads them anymore).

   NAMING NOTE: despite the filename, every field below is SHARED,
   general-Portal config — assets/js/auth-boundary.js reads
   supabaseUrl/supabasePublishableKey to decide whether real Supabase
   Auth is available for the WHOLE app (login, session, every
   PERMISSION_MATRIX/MASTER_ONLY/ANALISTA_OR_MASTER route), and every
   real-data provider across the Portal (Score, Coparticipado, Gestão,
   Dashbi, Painel Master, ...) reads the same two fields for its own
   Supabase client. Kept as one file (not split) because a real
   deployment only ever has ONE real Supabase project either way.

   COMMITTED DEFAULTS ONLY — safe on every host, including a
   production-looking one (Gate 8 feature containment: this is what
   ships if nothing else overrides it, and is also what makes
   Auth Foundation's own guard stay fully inert -- AUTH_NOT_CONFIGURED
   -- absent a local override).

   A real backend endpoint is NEVER hardcoded here. Real/local-homolog
   Auth is opt-in only, via assets/js/intelligence-runtime-config.local.js
   (gitignored, loaded only on localhost/127.0.0.1 — see index.html —
   same convention the Secure repo already uses for its own
   portal-runtime-config.local.js). That file does not exist unless a
   developer creates it from
   assets/js/intelligence-runtime-config.example.js for their own
   machine — and doing so now activates the Auth Foundation login/
   route guard for their whole local session. */
window.NX_INTELLIGENCE_CONFIG = {
  // SHARED (AUTH FOUNDATION Phase 2B+): the general Portal V2
  // Supabase connection -- consumed by auth-boundary.js for ALL auth
  // (login, session, module permissions) and by every real-data
  // provider's own Supabase client. One project, one pair of values,
  // one file -- not duplicated elsewhere.
  supabaseUrl: null,
  supabasePublishableKey: null,
  // SHARED (AUTH FOUNDATION Phase 3B): public Cloudflare Turnstile
  // site key (not a secret -- Turnstile's own design). null/absent
  // here means Login never loads Cloudflare at all and forwards no
  // captchaToken -- the default committed state and every mock/
  // fixture-mode host, matching Gate 14/20's zero-Cloudflare-
  // dependency requirement for deterministic testing.
  turnstileSiteKey: null,
  // SHARED (GL-1C, Go-Live deployment reconciliation): the explicit
  // hostname allowlist assets/js/environment-guard.js consults to
  // decide AUTHORIZED_PRODUCTION vs UNKNOWN_HOST. Deliberately empty by
  // default -- committing a real hostname here is a Human decision made
  // once V2's actual deployment identity is chosen (Go-Live Human
  // checkpoint), never invented ahead of that decision. An empty array
  // means every non-local-dev host is UNKNOWN_HOST (fail closed), which
  // is the correct, safe behavior until that Human decision is made and
  // recorded in a real intelligence-runtime-config.production.js.
  authorizedHostnames: []
};
