/* PORTAL-NEXT V2 -- PILOTO DE PRODUÇÃO runtime config (v2.brabus.blistiq.com.br).

   Carregado pelo index.html (e pelas páginas de conta) SOMENTE quando o
   hostname é exatamente v2.brabus.blistiq.com.br. Em qualquer outro host
   (homolog em luisgamadio-spec.github.io, localhost, o oficial) este
   arquivo nunca é pedido.

   authorizedHostnames: ['v2.brabus.blistiq.com.br'] faz o environment-
   guard.js classificar ESTE host como AUTHORIZED_PRODUCTION: o Painel
   Master grava de verdade (sem "MODO HOMOLOGAÇÃO") só aqui. O homolog
   continua AUTHORIZED_HOMOLOGATION, com as escritas bloqueadas.

   Mesmos valores públicos da config de produção (mesmo projeto Supabase,
   chave publishable, site key do Turnstile) -- material de cliente por
   desenho; a segurança está no RLS/Edge Functions e na lista de
   hostnames do Turnstile. A IA usa a função brabus-intelligence pelo
   supabaseUrl; textEndpoint/voiceRealtimeEndpoint não são usados pelo
   V2 atual. */
window.NX_INTELLIGENCE_CONFIG = {
  mode: 'real_text',
  supabaseUrl: 'https://yacqlelpzchcotgngwbh.supabase.co',
  supabasePublishableKey: 'sb_publishable__J96gDH1kOqlc4iFW24Z2Q_u_lWAg5_',
  turnstileSiteKey: '0x4AAAAAAEFmBWKvC-l1_CEs',
  textEndpoint: null,
  voiceRealtimeEndpoint: null,
  authorizedHostnames: ['v2.brabus.blistiq.com.br']
};
