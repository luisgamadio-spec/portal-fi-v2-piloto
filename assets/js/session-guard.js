/* PORTAL-NEXT V2 — Session Guard (sessão por aba).

   Loaded right after supabase-js and BEFORE auth-boundary.js, because
   the decisions below must happen before the Supabase client exists:

   - Each tab has its own session: the Supabase session lives in
     sessionStorage (auth.storage below), never in localStorage. F5 in
     the same tab keeps it; closing the tab ends it.
   - Duplicated tab asks for login: the browser copies sessionStorage
     when duplicating, so every tab keeps a tab_id there and, on load,
     asks on a BroadcastChannel whether another live tab owns that id.
     If one answers, this tab is a copy: its inherited session is wiped
     locally and it gets a new tab_id. The storage adapter only answers
     the Supabase client AFTER that check, so a copy never sees (and
     therefore never uses or refreshes) the inherited refresh token —
     using it would rotate/revoke the original tab's session.
   - Inactivity (INATIVIDADE_MIN) and maximum session age (SESSAO_MAX_H)
     end this tab's session and return to login with a notice.
   - One-time migration: old sessions kept in localStorage
     (sb-*-auth-token and equivalents) are deleted. */
(function () {
  'use strict';

  var INATIVIDADE_MIN = 30;   // minutes without use → session ends
  var SESSAO_MAX_H = 10;      // hours since login, even with use → session ends
  var ESPERA_ABA_MS = 300;    // how long to wait for another tab claiming our tab_id
  var VERIFICA_MS = 15000;    // how often inactivity/age are checked

  var AVISO_INATIVIDADE = 'Sessão encerrada por inatividade';
  var AVISO_EXPIRADA = 'Sessão expirada, entre novamente';

  var CHAVE_ABA = 'nx.aba.id';
  var CHAVE_INICIO = 'nx.sessao.inicio';
  var CHAVE_MIGRACAO = 'nx.sessao.migrada.v1';
  var NOME_CANAL = 'nx-portal-abas';

  function armazenamento(nome) { try { return window[nome] || null; } catch (e) { return null; } }
  var S = armazenamento('sessionStorage');
  var L = armazenamento('localStorage');

  function novoId() {
    try { return crypto.randomUUID(); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }
  // Supabase session keys (default storageKey sb-<ref>-auth-token, its PKCE code verifier, and the v1 key)
  function ehChaveAuth(k) { return /^sb-.+-auth-token(-code-verifier)?$/.test(k) || k === 'supabase.auth.token'; }
  function apagaChavesAuth(store) {
    if (!store) return;
    try {
      var apagar = [];
      for (var i = 0; i < store.length; i++) { var k = store.key(i); if (k && ehChaveAuth(k)) apagar.push(k); }
      apagar.forEach(function (k) { store.removeItem(k); });
    } catch (e) { /* storage blocked */ }
  }
  function ler(store, k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function gravar(store, k, v) { try { if (store) store.setItem(k, v); } catch (e) { /* ignore */ } }
  function remover(store, k) { try { if (store) store.removeItem(k); } catch (e) { /* ignore */ } }

  // ---- (e) one-time migration: sessions from older versions lived in localStorage ----
  if (L && ler(L, CHAVE_MIGRACAO) !== '1') {
    apagaChavesAuth(L);
    gravar(L, CHAVE_MIGRACAO, '1');
  }

  // ---- (b) duplicated-tab detection -----------------------------------------------
  var instancia = novoId();            // this page load
  var idAnterior = ler(S, CHAVE_ABA);  // present after F5 or in a duplicated tab
  var meuId = idAnterior || novoId();
  var classificada = false;
  var ehCopia = false;
  var canal = null;
  try { canal = new BroadcastChannel(NOME_CANAL); } catch (e) { canal = null; }

  var resolverPronto;
  var pronto = new Promise(function (r) { resolverPronto = r; });

  function classifica(copia) {
    if (classificada) return;
    classificada = true;
    ehCopia = copia;
    if (copia) {
      // drop everything inherited from the original tab, locally only
      apagaChavesAuth(S);
      remover(S, CHAVE_INICIO);
      meuId = novoId();
    }
    gravar(S, CHAVE_ABA, meuId);
    resolverPronto({ copia: copia });
  }

  if (canal) {
    canal.onmessage = function (ev) {
      var m = ev && ev.data;
      if (!m || typeof m !== 'object') return;
      // another tab asks whether our id is alive: answer only once we know who we are
      if (m.tipo === 'quem' && classificada && m.id === meuId && m.de !== instancia) {
        canal.postMessage({ tipo: 'sou', id: m.id, para: m.de });
      }
      if (m.tipo === 'sou' && m.para === instancia) classifica(true);
    };
  }

  if (!idAnterior || !canal) {
    classifica(false); // new tab (or no BroadcastChannel to ask): nothing inherited to protect
  } else {
    canal.postMessage({ tipo: 'quem', id: meuId, de: instancia });
    setTimeout(function () { classifica(false); }, ESPERA_ABA_MS); // nobody answered: same tab after F5
  }

  // auth.storage for the Supabase client: sessionStorage, answered only after the check above
  var storage = {
    getItem: function (k) { return pronto.then(function () { return ler(S, k); }); },
    setItem: function (k, v) { return pronto.then(function () { gravar(S, k, v); }); },
    removeItem: function (k) { return pronto.then(function () { remover(S, k); }); }
  };

  // ---- (c)/(d) inactivity and maximum session age ----------------------------------
  var ultimoUso = Date.now();
  var ocupados = [];
  function marcarUso() { ultimoUso = Date.now(); }
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, marcarUso, { capture: true, passive: true });
  });

  function emUso() {
    return ocupados.some(function (fn) { try { return !!fn(); } catch (e) { return false; } });
  }

  function verificar() {
    var AC = window.NX_AUTH_CORE;
    if (!AC || AC.getState() !== AC.STATES.AUTHORIZED) return;
    var agora = Date.now();
    if (emUso()) ultimoUso = agora; // Brabus IA question / voice recording / answer playing
    var inicio = Number(ler(S, CHAVE_INICIO)) || 0;
    if (!inicio) { inicio = agora; gravar(S, CHAVE_INICIO, String(agora)); }
    if (agora - inicio >= SESSAO_MAX_H * 3600000) { encerrar(AVISO_EXPIRADA); return; }
    if (agora - ultimoUso >= INATIVIDADE_MIN * 60000) encerrar(AVISO_INATIVIDADE);
  }

  function encerrar(aviso) {
    remover(S, CHAVE_INICIO);
    var AC = window.NX_AUTH_CORE;
    if (AC && typeof AC.encerrarSessao === 'function') AC.encerrarSessao(aviso);
  }

  setInterval(verificar, VERIFICA_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) verificar(); });
  window.addEventListener('focus', verificar);

  window.NX_SESSION_GUARD = {
    INATIVIDADE_MIN: INATIVIDADE_MIN,
    SESSAO_MAX_H: SESSAO_MAX_H,
    storage: storage,
    pronto: pronto,
    // fresh login in this tab: the 10 h limit and the inactivity clock start now
    iniciarSessao: function () { gravar(S, CHAVE_INICIO, String(Date.now())); marcarUso(); },
    limparSessao: function () { remover(S, CHAVE_INICIO); },
    // fn() → true while something counts as use without input events (e.g. a voice answer playing)
    registrarOcupado: function (fn) { if (typeof fn === 'function') ocupados.push(fn); },
    marcarUso: marcarUso,
    verificar: verificar,
    ehCopia: function () { return ehCopia; }
  };
})();
