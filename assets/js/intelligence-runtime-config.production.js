/* PORTAL-NEXT V2 -- PRODUCTION runtime config (GL-ENV-AUTH-WRITE-
   BOUNDARY implementation wave; originally GL-1D).

   REPURPOSED this wave: until now this file's committed content was
   actually homolog-flavored (pointed at portal-ai-homolog while being
   loaded under the name "production") -- the read-only audit that
   preceded this wave identified this as R1/R2's root cause. That
   content has moved, unmodified in shape, to
   assets/js/intelligence-runtime-config.homolog.js. This file's
   semantics are now genuinely PRODUCTION.

   Hand-maintained, checked-in static file, loaded via a plain relative
   <script src>, no build-time substitution, no secret injection. Every
   value below is public-by-design client material -- safe to commit,
   same reasoning already established repo-wide. No service-role key,
   no OpenAI key, no private secret of any kind belongs here, ever.

   PREPARED, NOT ACTIVATED: index.html loads this file only behind an
   exact-hostname check for brabus.blistiq.com.br -- the Human-
   designated FUTURE V2 production hostname. That hostname currently
   belongs to, and continues to serve, the existing V1/Secure portal's
   own separate GitHub Pages deployment -- this file being committed
   here has ZERO effect on that live site: no DNS/CNAME/GitHub-Pages-
   ownership change, no V1 repository change, and no deployment of V2
   to that hostname happens as part of this wave. This file only takes
   effect once a separate, explicitly Human-authorized future cutover
   wave actually points V2 at that hostname.

   supabaseUrl / supabasePublishableKey / turnstileSiteKey: the SAME
   real values already used for homologation (see
   intelligence-runtime-config.homolog.js) -- the Human Environment
   Authority for this wave explicitly permits the Supabase project to
   remain shared between homolog and production for now. Safe to commit
   for the same reason as everywhere else in this codebase: a Supabase
   publishable key and a Turnstile SITE key are both designed for
   client exposure; security is enforced by RLS/Edge-Function-side
   checks and by Cloudflare's own hostname binding, not by hiding these
   values.

   textEndpoint: the real, already-deployed PRODUCTION portal-ai
   function (not portal-ai-homolog) -- confirmed live via
   `supabase functions list` (slug "portal-ai", ACTIVE) earlier this
   same audit thread.

   voiceRealtimeEndpoint: deliberately null. A production-named
   "portal-realtime" Edge Function (as distinct from the already-
   deployed portal-realtime-homolog) could not be proven to exist from
   current repository/runtime authority -- `supabase functions list`
   shows only portal-realtime-homolog, portal-voice-homolog, portal-ai,
   portal-ai-homolog. Per this wave's explicit instruction, that name
   is not invented here. null preserves intelligence-voice.js's own
   existing fail-closed guard
   (`if (!cfg.voiceRealtimeEndpoint || !cfg.supabasePublishableKey)`) --
   Voice simply stays unavailable under this prepared production config
   until a real production realtime function is confirmed to exist and
   this field is deliberately populated in a later wave. */
window.NX_INTELLIGENCE_CONFIG = {
  mode: 'real_text',
  supabaseUrl: 'https://yacqlelpzchcotgngwbh.supabase.co',
  supabasePublishableKey: 'sb_publishable__J96gDH1kOqlc4iFW24Z2Q_u_lWAg5_',
  turnstileSiteKey: '0x4AAAAAAEFmBWKvC-l1_CEs',
  textEndpoint: 'https://yacqlelpzchcotgngwbh.supabase.co/functions/v1/portal-ai',
  voiceRealtimeEndpoint: null,
  // GL-ENV-AUTH-WRITE-BOUNDARY -- authorizes EXACTLY the Human-
  // designated future V2 production hostname. Exact string match only
  // (environment-guard.js uses indexOf, not a pattern) -- no wildcard.
  // Prepared, not activated -- see header note above.
  authorizedHostnames: ['brabus.blistiq.com.br']
};
