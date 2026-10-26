/* PORTAL-NEXT V2 -- Painel Master / Utilização -- aba Brabus IA (26/10/2026).
   Transporte da RPC master_ia_usage_data(p_start, p_end) -- só leitura, só Master (o servidor recusa os
   demais perfis com 42501). Devolve utilização por usuário (perguntas, dias, primeira/última vez, temas
   pela ferramenta usada) e os elegíveis (perfis com acesso à IA) para "Nunca utilizaram". Nunca o texto
   das perguntas: o banco não guarda. Mesmo padrão de master-simulator-usage-provider.js. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }
  var DEFAULT_TIMEOUT_MS = 15000;

  function callRpc(fnName, params) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'RPC_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, DEFAULT_TIMEOUT_MS) : null;
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fnName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(params || {}),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (resp) {
        if (timer) clearTimeout(timer);
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status), codigo: code, message: (body && body.message) || 'Erro ao processar solicitação.' });
          }
          return body;
        });
      }, function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'TIMEOUT', message: 'Tempo de resposta excedido.' });
        return Promise.reject({ state: 'NETWORK_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // dtIni/dtFim: 'AAAA-MM-DD' (dias de Brasília; o servidor converte para o fuso).
  function loadUsage(dtIni, dtFim) {
    return callRpc('master_ia_usage_data', { p_start: dtIni, p_end: dtFim }).then(function (data) {
      if (!data || !Array.isArray(data.linhas) || !Array.isArray(data.elegiveis)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  window.NX_MASTER_IA_USAGE_PROVIDER = { loadUsage: loadUsage };
})();
