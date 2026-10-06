/* PORTAL-NEXT V2 -- HOMOLOGATION runtime config (GL-ENV-AUTH-WRITE-
   BOUNDARY implementation wave).

   Split out of intelligence-runtime-config.production.js, whose
   committed content until this wave was actually homolog-flavored
   (pointed at portal-ai-homolog/portal-realtime-homolog while being
   loaded under the name "production") -- this is exactly what the
   preceding read-only audit's R1/R2 findings identified: GitHub Pages
   homologation (luisgamadio-spec.github.io) must never be treated as
   production. Hand-maintained, checked-in static file, loaded via a
   plain relative <script src>, no build-time substitution, no secret
   injection. Every value below is public-by-design client material --
   safe to commit, same reasoning already established repo-wide (a
   Supabase publishable key and a Turnstile SITE key are both designed
   for client exposure; security is enforced by RLS/Edge-Function-side
   checks and by Cloudflare's own hostname binding on the Turnstile
   site key, not by hiding these values). No service-role key, no
   OpenAI key, no private secret of any kind belongs here, ever.

   Wired into index.html behind an exact-hostname check -- loads ONLY
   on luisgamadio-spec.github.io, the proven GitHub Pages HOMOLOGATION
   hostname (GL-1I.1). Everywhere else (localhost, any other host, and
   -- explicitly -- brabus.blistiq.com.br) this file is never requested
   and has zero runtime effect.

   authorizedHomologationHostnames (NOT authorizedHostnames): the field
   name environment-guard.js's now-four-state classification reads to
   assign AUTHORIZED_HOMOLOGATION, never AUTHORIZED_PRODUCTION. This is
   the whole fix for R1/R2's root cause -- "host is allowed to load V2"
   and "host is production" are now two separate concepts, read from
   two separately-named fields in two separate files, never conflated
   in one array again. master-gestao-simuladores-provider.js and
   master-gestao-bases-provider.js no longer maintain their own
   independent hostname allowlists -- they read window.NX_ENVIRONMENT.name
   (published by environment-guard.js from exactly this config) and
   simulate every real commit RPC unless that name is exactly
   'AUTHORIZED_PRODUCTION' -- so a host classified here as
   AUTHORIZED_HOMOLOGATION can never perform a real destructive write
   against the shared production database, per the Human Environment
   Authority for this wave. */
window.NX_INTELLIGENCE_CONFIG = {
  // INTELLIGENCE_ONLY -- unchanged from the value this host already
  // used under the old production.js filename; TEXT/Voice activation
  // scope (SEC-1C.3 / VOICE-UAT-1) is unaffected by this file split.
  mode: 'real_text',
  // SHARED -- the one real Supabase project every real-data module
  // needs today (Auth Foundation, Score, Coparticipado, Gestão,
  // Dashbi, Painel Master, Painel do Analista). The Human Environment
  // Authority for this wave explicitly allows this project to remain
  // shared between homolog and production for now.
  supabaseUrl: 'https://yacqlelpzchcotgngwbh.supabase.co',
  supabasePublishableKey: 'sb_publishable__J96gDH1kOqlc4iFW24Z2Q_u_lWAg5_',
  // SHARED -- public Cloudflare Turnstile site key, same value already
  // used by every other real-credentialed config in this codebase.
  turnstileSiteKey: '0x4AAAAAAEFmBWKvC-l1_CEs',
  // INTELLIGENCE_ONLY -- the real, already-deployed portal-ai-homolog
  // TEXT function. Homologation must never point at the production
  // portal-ai function -- this is the exact R2 boundary this file
  // exists to preserve.
  textEndpoint: 'https://yacqlelpzchcotgngwbh.supabase.co/functions/v1/portal-ai-homolog',
  // INTELLIGENCE_ONLY -- the real, already-deployed
  // portal-realtime-homolog ephemeral-credential mint function. Same
  // homolog-only boundary as textEndpoint above.
  voiceRealtimeEndpoint: 'https://yacqlelpzchcotgngwbh.supabase.co/functions/v1/portal-realtime-homolog',
  // GL-ENV-AUTH-WRITE-BOUNDARY -- authorizes EXACTLY the proven GitHub
  // Pages homologation hostname as HOMOLOGATION, never production.
  // Exact string match only (environment-guard.js uses indexOf, not a
  // pattern) -- no wildcard, no *.github.io.
  authorizedHomologationHostnames: ['luisgamadio-spec.github.io']
};
