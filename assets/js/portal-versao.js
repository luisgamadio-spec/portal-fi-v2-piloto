/* PORTAL-NEXT V2 — Versão publicada e atualização automática (07/11/2026, pedido do Luis).

   Por quê: o Portal nunca recarregava sozinho (a sessão vence e a pessoa entra de novo na
   MESMA aba), então havia gente com código de dias atrás — ex.: a aba do Coparticipado
   depois de o plano sair.

   1) Versão publicada: cada publicação grava version.json e <meta name="portal-versao">
      (docs/portal-versao/carimbar_versao.py). Esta aba compara a versão que carregou com o
      version.json (sem cache) a cada 5 min, ao voltar a ficar visível/focada, quando o
      navegador devolve a página congelada e logo depois de cada login.
   2) Atualização segura: versão nova -> faixa "Nova versão do Portal — atualizando" e recarga
      na mesma tela (a sessão da aba continua). Na tela de login recarrega na hora; com
      edição em andamento espera terminar, no máximo 5 min. No máximo 2 recargas a cada
      10 min (se o site ainda servir a página antiga, para e pede F5 em vez de entrar em laço).
   3) Versão mínima no servidor: toda chamada ao banco (/rest/v1/) leva o cabeçalho
      x-portal-versao. Abaixo da mínima o banco recusa com a dica 'portal_desatualizado' e
      esta aba recarrega na hora. Também registra "esta pessoa está na versão X"
      (portal_registrar_versao) para saber quem ficou para trás.
   Carregado logo depois de network-guard.js e antes do supabase-js (que guarda o fetch ao
   ser criado). Não há service worker no Portal. */
(function () {
  'use strict';

  var INTERVALO_MS = 5 * 60 * 1000;      // checagem periódica
  var ESPERA_MAX_MS = 5 * 60 * 1000;     // com edição em andamento, espera no máximo isto
  var DIGITANDO_MS = 60 * 1000;          // digitou há menos disto = ainda editando
  var JANELA_RECARGAS_MS = 10 * 60 * 1000, MAX_RECARGAS = 2;
  var CHAVE_RECARGAS = 'nx.versao.recargas';
  var CHAVE_REGISTRO = 'nx.versao.registrada';

  var meta = document.querySelector('meta[name="portal-versao"]');
  var CARREGADA = meta ? Number(meta.getAttribute('content')) || 0 : 0;
  var ROTULO = meta ? meta.getAttribute('data-rotulo') || String(CARREGADA) : 'sem versão';
  var T = window.NX_PORTAL_VERSAO_TESTE || {};   // só os testes aceleram os relógios
  if (T.intervaloMs) INTERVALO_MS = T.intervaloMs;
  if (T.esperaMaxMs) ESPERA_MAX_MS = T.esperaMaxMs;
  if (T.digitandoMs) DIGITANDO_MS = T.digitandoMs;

  // tira o ?_v= que a própria recarga usa para furar o cache do site
  try {
    var u = new URL(location.href);
    if (u.searchParams.has('_v')) { u.searchParams.delete('_v'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  } catch (e) { /* navegador sem URL: o parâmetro só fica visível */ }

  function sess(k, v) {
    try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); sessionStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { return null; }
  }

  // ---------------------------------------------------------------- 3) cabeçalho em toda chamada ao banco
  var emVoo = 0;   // chamadas ao banco ainda sem resposta (não recarregar no meio de uma gravação)
  var fetchOriginal = window.fetch;
  function ehBanco(url) { return /\/rest\/v1\//.test(url) && /\.supabase\.co\//.test(url); }
  if (typeof fetchOriginal === 'function') {
    window.fetch = function (entrada, opcoes) {
      var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
      if (!ehBanco(url) || !CARREGADA) return fetchOriginal.apply(this, arguments);
      opcoes = opcoes ? Object.assign({}, opcoes) : {};
      var h = new Headers(opcoes.headers || (typeof entrada !== 'string' && entrada.headers) || undefined);
      h.set('x-portal-versao', String(CARREGADA));
      opcoes.headers = h;
      emVoo++;
      return fetchOriginal.call(this, entrada, opcoes).then(function (resp) {
        emVoo--;
        if (resp.status === 400) {
          resp.clone().json().then(function (b) {
            if (b && b.hint === 'portal_desatualizado') atualizar('servidor');
          }).catch(function () { /* resposta sem JSON: não é a recusa de versão */ });
        }
        return resp;
      }, function (err) { emVoo--; throw err; });
    };
  }

  // ---------------------------------------------------------------- 2) faixa e recarga segura
  var pendente = null;   // { desde, alvo }
  var faixa = null;
  function mostrarFaixa(texto) {
    if (!document.body) return;
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.className = 'nxVersaoFaixa'; faixa.setAttribute('role', 'status'); faixa.setAttribute('aria-live', 'polite');
      faixa.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;padding:10px 16px;text-align:center;' +
        'font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;background:#ee4b57;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35)';
      document.body.appendChild(faixa);
    }
    faixa.textContent = texto;
  }

  var ultimaDigitacao = 0, sujos = [];
  document.addEventListener('input', function (e) {
    ultimaDigitacao = Date.now();
    if (e.target && sujos.indexOf(e.target) < 0) sujos.push(e.target);
  }, true);
  document.addEventListener('change', function (e) { if (e.target && sujos.indexOf(e.target) < 0) sujos.push(e.target); }, true);
  window.addEventListener('hashchange', function () { sujos = []; });   // trocou de tela: o que ficou para trás não conta

  function naTelaDeLogin() {
    var a = window.NX_AUTH_CORE;
    if (!a || typeof a.getState !== 'function') return false;
    var s = a.getState();
    return s !== 'AUTHORIZED' && s !== 'AUTHENTICATING' && s !== 'AUTHENTICATED_RESOLVING_PROFILE' && s !== 'INITIALIZING_SESSION';
  }
  function editando() {
    if (emVoo > 0) return true;
    var ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) && !/^(button|submit|reset|checkbox|radio|range|file)$/i.test(ae.type || '')) return true;
    if (Date.now() - ultimaDigitacao < DIGITANDO_MS) return true;
    sujos = sujos.filter(function (el) { return el.isConnected; });
    return sujos.length > 0;
  }

  function recargasRecentes() {
    var agora = Date.now();
    return (sess(CHAVE_RECARGAS) || []).filter(function (t) { return agora - t < JANELA_RECARGAS_MS; });
  }
  function recarregar(alvo) {
    var r = recargasRecentes();
    if (r.length >= MAX_RECARGAS) {
      // o site ainda serve a página antiga (cache de até 10 min): não insiste
      mostrarFaixa('Nova versão do Portal disponível — aperte F5 para atualizar.');
      return;
    }
    r.push(Date.now()); sess(CHAVE_RECARGAS, r);
    mostrarFaixa('Nova versão do Portal — atualizando…');
    var destino = location.pathname + '?_v=' + encodeURIComponent(alvo || Date.now()) + location.hash;
    setTimeout(function () { location.replace(destino); }, 600);
  }
  var relogio = null;
  function atualizar(motivo, alvo) {
    if (motivo === 'servidor' || naTelaDeLogin()) { recarregar(alvo); return; }   // recusado pelo banco ou sem login: na hora
    if (!pendente) pendente = { desde: Date.now(), alvo: alvo };
    if (relogio) return;
    (function tentar() {
      if (!editando() || Date.now() - pendente.desde >= ESPERA_MAX_MS) { relogio = null; recarregar(pendente.alvo); return; }
      var falta = Math.max(0, Math.ceil((ESPERA_MAX_MS - (Date.now() - pendente.desde)) / 60000));
      mostrarFaixa('Nova versão do Portal — atualiza quando você terminar o que está preenchendo (em até ' + falta + ' min).');
      relogio = setTimeout(tentar, T.passoMs || 2000);
    })();
  }

  // ---------------------------------------------------------------- 1) comparação com o version.json
  var conferindo = false, ultimaConferencia = 0;
  function conferir(origem) {
    if (!CARREGADA || conferindo) return;
    if ((origem === 'foco' || origem === 'visivel') && Date.now() - ultimaConferencia < 15000) return;   // foco e visível chegam juntos
    conferindo = true; ultimaConferencia = Date.now();
    fetchOriginal.call(window, 'version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (v) {
      conferindo = false;
      if (v && Number(v.numero) > CARREGADA) atualizar(origem, Number(v.numero));
      registrarVersao();
    }, function () { conferindo = false; /* sem sinal: tenta de novo na próxima */ });
  }

  // "esta pessoa está na versão X" (uma vez por carga da página, depois do login)
  function registrarVersao() {
    if (!CARREGADA || sess(CHAVE_REGISTRO) === CARREGADA) return;
    var a = window.NX_AUTH_CORE, cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!a || a.getState() !== 'AUTHORIZED' || !cfg.supabaseUrl || !window.NX_AUTH || !window.NX_AUTH.getAccessToken) return;
    window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return;
      return window.fetch(cfg.supabaseUrl + '/rest/v1/rpc/portal_registrar_versao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ p_numero: CARREGADA, p_rotulo: ROTULO })
      }).then(function (r) { if (r.ok) sess(CHAVE_REGISTRO, CARREGADA); });
    }).catch(function () { /* registro é só informativo */ });
  }

  setInterval(function () { conferir('intervalo'); }, INTERVALO_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') conferir('visivel'); });
  window.addEventListener('focus', function () { conferir('foco'); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) conferir('congelada'); });   // devolvida pelo navegador sem recarregar
  function ligarLogin() {
    if (!window.NX_AUTH_CORE || typeof window.NX_AUTH_CORE.onStateChange !== 'function') return false;
    window.NX_AUTH_CORE.onStateChange(function (s) {
      var estado = typeof s === 'string' ? s : window.NX_AUTH_CORE.getState();
      if (estado === 'AUTHORIZED') conferir('login');
      else if (estado === 'SIGNED_OUT') conferir('login');   // voltou ao login (sessão venceu): se houver versão nova, recarrega já
    });
    return true;
  }
  // auth-core.js carrega depois deste arquivo
  if (!ligarLogin()) document.addEventListener('DOMContentLoaded', function () { ligarLogin(); conferir('inicio'); });
  else conferir('inicio');

  window.NX_PORTAL_VERSAO = { carregada: CARREGADA, rotulo: ROTULO, conferir: conferir, editando: editando, _atualizar: atualizar };
})();
