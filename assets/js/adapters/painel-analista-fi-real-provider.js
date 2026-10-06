/* PORTAL-NEXT V2 -- Painel do Analista F&I REAL data provider
   (PA-1 migration).

   THIN transport boundary, same principle and same request pattern as
   every other real provider in this codebase (gestao-real-provider.js,
   coparticipado-governed-rates-provider.js, dashbi-real-provider.js):
   this file's only job is calling the real, already-proven, live
   (ATIVA) RPCs operational_my_analyst_fi (read) and
   atualizar_meu_status_analista_fi (write) and returning their raw
   payload (or a classified error) -- no status validation, no display
   formatting, no business logic. Both RPCs are SECURITY DEFINER,
   granted to `authenticated`, and derive identity server-side from
   auth.uid() -- never from a client-supplied CPF (confirmed by direct
   source read of the V1 reference implementation, portal-app.js:1932-
   2043, portal-financiamento-brabus-secure). Table authority
   (analistas_fi) confirmed read-only against the real project this
   Wave: columns id/nome/whatsapp/status/ativo/atendimentos_hoje/
   ultimo_atendimento/ultimo_status_em/cpf_normalizado all present and
   populated with real rows.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH) and the
   EXISTING shared Supabase config (window.NX_INTELLIGENCE_CONFIG) --
   no independent Supabase client, no new backend, no service_role. */
(function () {
  'use strict';

  function classifyError(code, httpStatus) {
    if (code === '42501') return 'PERMISSION_DENIED';
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'BACKEND_ERROR';
  }

  function callRpc(rpcName, body) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'BACKEND_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + rpcName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body || {})
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (respBody) {
          if (!resp.ok) {
            var code = respBody && respBody.code;
            return Promise.reject({ state: classifyError(code, resp.status), message: (respBody && respBody.message) || 'Falha ao comunicar com o servidor.' });
          }
          return respBody;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'BACKEND_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // operational_my_analyst_fi() -- read. V1 contract: returns
  // {row: {...}|null} -- row is null when the authenticated user has
  // no matching analistas_fi record (never a client-supplied lookup).
  function loadMeuAnalista() {
    return callRpc('operational_my_analyst_fi', {}).then(function (body) {
      return (body && body.row) || null;
    });
  }

  // atualizar_meu_status_analista_fi(p_status) -- write. V1 contract:
  // returns {sucesso: boolean, mensagem: string} (array or single
  // object depending on PostgREST's own RPC return-shape convention).
  function atualizarMeuStatus(status) {
    return callRpc('atualizar_meu_status_analista_fi', { p_status: status }).then(function (body) {
      return Array.isArray(body) ? body[0] : body;
    });
  }

  window.NX_PAINEL_ANALISTA_FI_REAL_PROVIDER = {
    loadMeuAnalista: loadMeuAnalista,
    atualizarMeuStatus: atualizarMeuStatus
  };
})();
