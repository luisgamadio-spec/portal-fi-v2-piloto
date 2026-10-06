/* PORTAL-NEXT V2 -- Score / Utilização + Conversão GOVERNADA.

   EXECUÇÃO AUTORIZADA -- RPC aplicada ao Supabase real (yacqlelpzchcotgngwbh)
   com autorização expressa, conectada em index.html e consumida por
   score.js (computeScuLookupRealConversion). Consome
   score_utilization_conversion_scope_data, conforme
   docs/score-utilization-conversion-governed-proposal.sql (assinatura,
   SECURITY DEFINER, search_path e grants confirmados ao vivo idênticos
   ao arquivo após a aplicação).

   Mesma disciplina de transporte de todo provider real deste código-
   base (master-simulator-usage-provider.js, master-users-provider.js):
   thin boundary, reusa window.NX_AUTH, classifica erros, nunca decide
   negócio aqui.

   CONTRATO REAL (score_utilization_conversion_scope_data): retorna
   linhas já filtradas pelo escopo real do caller (nunca um parâmetro de
   identidade/loja/perfil enviado por este arquivo -- identidade e escopo
   são resolvidos 100% server-side a partir de auth.uid()) -- usuario_id,
   nome, loja, department, simulations. Nenhum PII, nenhuma sessão
   individual. Este contrato é deliberadamente mais minimalista que
   master_simulator_usage_data (não inclui sessions/active_seconds/
   active_days) -- suficiente para "Utilização + Conversão" (só precisa
   de simulations), mas não para todos os campos que "Inteligência de
   Utilização" já exibe (ver nota em score.js/loadIntelligence sobre o
   que permanece indisponível quando essa seção também usa esta fonte). */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  var DEFAULT_TIMEOUT_MS = 15000;

  function callRpc(fnName, params, signal) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'RPC_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
      var timeoutController = null;
      var effectiveSignal = signal;
      if (!effectiveSignal && typeof AbortController === 'function') {
        timeoutController = new AbortController();
        effectiveSignal = timeoutController.signal;
      }
      var timer = timeoutController ? setTimeout(function () { timeoutController.abort(); }, DEFAULT_TIMEOUT_MS) : null;
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fnName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(params || {}),
        signal: effectiveSignal
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
        if (err && err.name === 'AbortError') {
          if (signal && signal.aborted) return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
          return Promise.reject({ state: 'TIMEOUT', message: 'Tempo de resposta excedido.' });
        }
        return Promise.reject({ state: 'NETWORK_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // startDate/endDate: 'YYYY-MM-DD'. Nenhum outro parâmetro existe --
  // identidade/escopo são 100% resolvidos server-side a partir da sessão.
  function loadGovernedUtilization(startDate, endDate, params) {
    params = params || {};
    return callRpc('score_utilization_conversion_scope_data', { p_start: startDate, p_end: endDate }, params.signal).then(function (rows) {
      if (!Array.isArray(rows)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return rows;
    });
  }

  window.NX_SCORE_UTILIZATION_GOVERNED_PROVIDER = {
    loadGovernedUtilization: loadGovernedUtilization
  };
})();
