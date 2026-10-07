/* PORTAL-NEXT V2 -- Telemetria de uso dos simuladores (paridade com o v1,
   incidente/auditoria de 07/10/2026).

   O v1 grava em public.portal_module_sessions pelas 4 RPCs portal_telemetry_
   start_session/_heartbeat/_simulation/_end_session ("Utilização dos
   Simuladores" e Score "Utilização + Conversão"). O V2 nunca as chamava.
   Este módulo reproduz o mesmo contrato SEM tocar nos simuladores (que estão
   congelados): observa a rota e a área de resultado.

   Mesmas regras do v1 (index.html, script fase182-telemetria-portal-pai-v001,
   e modules/simulador-*.html, fase182-telemetria-simulador-*-v001):
   - sessão abre ao entrar no simulador (module_id simuladorCompleto /
     simuladorSeminovos) e fecha ao sair: 'back' (início), 'switch_module'
     (outro módulo), 'logout' (sessão encerrada), 'pagehide' (aba fechada);
   - heartbeat a cada 60 s, só com a aba visível e interação real nos últimos
     5 minutos; o tempo ativo é sempre calculado no servidor;
   - "simulação" = um resultado válido na área de resultado (nem o bloco
     vazio, nem o de erro), com debounce de 1,5 s e impressão digital EFÊMERA
     (só em memória, nunca enviada) -- a mesma estratégia do v1 nos modos sem
     botão Calcular.
   Só metadados: nenhum valor digitado ou resultado sai daqui. Identidade,
   permissão do módulo e a flag telemetria_simuladores_ativa ficam no servidor
   (auth.uid()). Fire-and-forget: nenhuma falha afeta o simulador.

   Trava de ambiente (mesma regra da Gestão de Bases): só grava de verdade em
   AUTHORIZED_PRODUCTION; em homologação/local as chamadas são simuladas. */
(function () {
  'use strict';

  var MODULE_BY_ROUTE = { 'simulador-novos': 'simuladorCompleto', 'simulador-seminovos': 'simuladorSeminovos' };
  var HEARTBEAT_MS = 60000;
  var ACTIVE_WINDOW_MS = 5 * 60 * 1000;
  var DEBOUNCE_MS = 1500;

  var sessionId = null;
  var sessionModule = null;
  var starting = null;          // promessa do start em andamento
  var cachedToken = null;       // para o encerramento no pagehide (síncrono)
  var lastActivity = Date.now();
  var lastFingerprint = null;
  var debounceTimer = null;
  var log = [];                 // diagnóstico em memória (sem dados de negócio)

  function isProduction() {
    return !!(window.NX_ENVIRONMENT && window.NX_ENVIRONMENT.name === 'AUTHORIZED_PRODUCTION');
  }
  function isAuthorized() {
    var core = window.NX_AUTH_CORE;
    return !!(core && core.getState && core.getState() === core.STATES.AUTHORIZED);
  }
  function note(name, extra) {
    log.push({ rpc: name, at: Date.now(), simulated: !isProduction(), extra: extra || null });
    if (log.length > 200) log.shift();
  }

  function rpc(name, params, opts) {
    opts = opts || {};
    note(name, params && params.p_reason ? params.p_reason : null);
    if (!isProduction()) {
      if (name === 'portal_telemetry_start_session') {
        return Promise.resolve({ ok: true, enabled: true, simulated: true, session_id: '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12) });
      }
      return Promise.resolve({ ok: true, enabled: true, simulated: true });
    }
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) return Promise.resolve(null);
    function send(token) {
      if (!token) return null;
      cachedToken = token;
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + name, {
        method: 'POST',
        keepalive: !!opts.keepalive,
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(params || {})
      }).then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; });
    }
    try {
      if (opts.useCachedToken) return Promise.resolve(send(cachedToken)).catch(function () { return null; });
      if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') return Promise.resolve(null);
      return window.NX_AUTH.getAccessToken().then(send).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  var abandoned = null; // { promise, reason } quando a saída acontece com o start ainda em voo

  function startSession(moduleId) {
    if (sessionModule === moduleId && (sessionId || starting)) return;
    lastFingerprint = null;
    sessionModule = moduleId;
    var p = rpc('portal_telemetry_start_session', { p_module_id: moduleId }).then(function (data) {
      var id = data && data.ok === true && data.session_id ? data.session_id : null;
      if (abandoned && abandoned.promise === p) {
        // saiu do simulador antes de a sessão abrir: fecha já, com o motivo da saída
        var reason = abandoned.reason; abandoned = null;
        if (id) rpc('portal_telemetry_end_session', { p_session_id: id, p_reason: reason });
        return;
      }
      if (starting !== p) return;
      starting = null;
      if (id) sessionId = id; else sessionModule = null;
    }, function () { if (starting === p) { starting = null; sessionModule = null; } });
    starting = p;
  }

  function endSession(reason, sync) {
    var pend = starting;
    var alvo = sessionId;
    sessionId = null; sessionModule = null; starting = null; lastFingerprint = null;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (alvo) {
      rpc('portal_telemetry_end_session', { p_session_id: alvo, p_reason: reason }, sync ? { keepalive: true, useCachedToken: true } : {});
    } else if (pend) {
      abandoned = { promise: pend, reason: reason };
    }
  }

  function routeId() {
    var r = window.NX_ROUTER && window.NX_ROUTER.currentRouteId ? window.NX_ROUTER.currentRouteId() : (location.hash || '').replace(/^#\/?/, '');
    return (r || '').split(/[?/]/)[0];
  }

  function sync(reasonForLeaving) {
    var target = isAuthorized() ? MODULE_BY_ROUTE[routeId()] : null;
    if (sessionModule && sessionModule !== target) endSession(reasonForLeaving);
    if (target && sessionModule !== target) startSession(target);
  }

  // ---- heartbeat ----
  ['pointerdown', 'keydown', 'touchstart', 'scroll', 'input'].forEach(function (evt) {
    document.addEventListener(evt, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });
  setInterval(function () {
    try {
      if (!sessionId) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity > ACTIVE_WINDOW_MS) return;
      rpc('portal_telemetry_heartbeat', { p_session_id: sessionId });
    } catch (e) { /* telemetria nunca afeta o simulador */ }
  }, HEARTBEAT_MS);

  // ---- simulação realizada: resultado válido na área de resultado ----
  function validResultFingerprint() {
    var region = document.getElementById('smResultRegion');
    if (!region || !region.firstElementChild) return null;
    var first = region.firstElementChild;
    if (first.classList.contains('emptyState') || first.classList.contains('errorState')) return null;
    var txt = (region.textContent || '').replace(/\s+/g, ' ').trim();
    return txt || null;
  }
  function onMutation() {
    if (!sessionId && !starting) return;
    var fp = validResultFingerprint();
    if (!fp) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      var atual = validResultFingerprint();
      if (!atual || atual === lastFingerprint || !sessionId) return;
      lastFingerprint = atual;
      rpc('portal_telemetry_simulation', { p_session_id: sessionId });
    }, DEBOUNCE_MS);
  }
  function observe() {
    if (!document.body || typeof MutationObserver !== 'function') return;
    new MutationObserver(onMutation).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---- ciclo de vida ----
  window.addEventListener('hashchange', function () {
    // landing = voltar ao início; qualquer outra rota = troca de módulo (mesma distinção do v1)
    sync(routeId() === 'landing' || !routeId() ? 'back' : 'switch_module');
  });
  window.addEventListener('pagehide', function () {
    try { if (sessionId) endSession('pagehide', true); } catch (e) { /* best-effort */ }
  });
  function wireAuth() {
    if (!window.NX_AUTH_CORE || typeof window.NX_AUTH_CORE.onStateChange !== 'function') return;
    window.NX_AUTH_CORE.onStateChange(function () {
      if (!isAuthorized()) { if (sessionId || starting) endSession('logout', true); return; }
      sync('switch_module');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { observe(); wireAuth(); sync('switch_module'); });
  } else { observe(); wireAuth(); sync('switch_module'); }

  window.NX_SIMULATOR_TELEMETRY = {
    // Só diagnóstico/testes: estado e as chamadas feitas (nomes e motivos, nunca dados de negócio).
    state: function () { return { sessionId: sessionId, sessionModule: sessionModule, production: isProduction() }; },
    calls: function () { return log.slice(); },
    _resetForTests: function () { log = []; lastFingerprint = null; }
  };
})();
