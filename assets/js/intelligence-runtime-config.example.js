// Copie para intelligence-runtime-config.local.js somente no computador
// de teste (esse arquivo é ignorado pelo git). Nunca aponte para um
// projeto Supabase real ou produção a partir daqui.
//
// AUTH FOUNDATION Phase 2C: supabaseUrl/supabasePublishableKey aqui
// ativam o login/guard de autorização geral do Portal V2 -- ver
// assets/js/intelligence-runtime-config.js. (Brabus Intelligence
// RESET -- mode/textEndpoint/voiceRealtimeEndpoint removed: nothing
// in this codebase reads them anymore.)
window.NX_INTELLIGENCE_CONFIG = {
  supabaseUrl: 'http://127.0.0.1:8790',
  supabasePublishableKey: 'local-mock-anon-key'
  // turnstileSiteKey: intentionally omitted here -- the local mock
  // Supabase Auth backend does not enforce CAPTCHA, so Login never
  // loads Cloudflare Turnstile against a mock host (AUTH FOUNDATION
  // Phase 3B, Gate 20). Only set this to a real Cloudflare Turnstile
  // site key when supabaseUrl/supabasePublishableKey also point at a
  // real Supabase project -- never invent or guess a key.
  // authorizedHostnames: intentionally omitted here -- this field only
  // matters for AUTHORIZED_PRODUCTION classification in
  // assets/js/environment-guard.js; localhost/127.0.0.1 are always
  // LOCAL_DEV regardless of this field, so a local override never
  // needs it (see intelligence-runtime-config.production.js instead).
};
