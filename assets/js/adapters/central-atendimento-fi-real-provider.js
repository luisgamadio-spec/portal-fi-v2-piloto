/* PORTAL-NEXT V2 -- Central de Atendimento F&I REAL data provider
   (CA-1 migration).

   THIN transport boundary, same principle and same request pattern as
   painel-analista-fi-real-provider.js / gestao-real-provider.js: this
   file's only job is calling the real, already-proven, live (ATIVA)
   RPCs and returning their raw payload (or a classified error) -- no
   status validation, no display formatting, no business logic.

   All 5 RPCs below were read live via pg_get_functiondef against the
   real project (yacqlelpzchcotgngwbh) this Wave (CA-1) -- not
   inferred, not assumed. Every one is SECURITY DEFINER, re-checks
   perfil='MASTER' server-side via auth.uid() -> public.usuarios
   (never a client-supplied identity), and is granted EXECUTE to
   `authenticated` only (confirmed via has_function_privilege, never
   `anon`). See docs/CHANGE-PROPOSAL-CENTRAL-ATENDIMENTO-FI.md for the
   full evidence trail (table DDL, RLS, grants, function bodies).

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

  // gestor_listar_analistas_fi() -- read. V1/real contract: returns an
  // array of rows (id/nome/cpf_normalizado/whatsapp/teams_link/status/
  // online/ocupado/ativo/atendimentos_hoje/ordem_fila/
  // ultimo_atendimento/ultimo_status_em), ordered ativo desc, ordem_fila
  // asc, nome asc server-side (never re-sorted client-side). Empty
  // array (not an error) when the caller is non-MASTER (confirmed: the
  // function body returns with no rows rather than raising).
  function listarAnalistas() {
    return callRpc('gestor_listar_analistas_fi', {}).then(function (body) {
      return Array.isArray(body) ? body : [];
    });
  }

  // gestor_listar_historico_atendimentos_fi() -- read. V1/real
  // contract: returns up to 300 rows (server-side LIMIT, confirmed in
  // the function body), newest first, no parameters -- every filter
  // (loja/vendedor/período) is client-side over the fetched set,
  // exactly matching V1's own applyHistFilters()/histCache pattern.
  function listarHistorico() {
    return callRpc('gestor_listar_historico_atendimentos_fi', {}).then(function (body) {
      return Array.isArray(body) ? body : [];
    });
  }

  // gestor_salvar_analista_fi(...) -- write (create when p_id is null,
  // update otherwise). V1/real contract: returns {sucesso, mensagem,
  // analista_id} (array or single object depending on PostgREST's own
  // RPC return-shape convention). Confirmed server-side: status is
  // NEVER settable through this RPC (a new row is always inserted
  // OFFLINE; an update never touches status) -- status changes only
  // via alterarStatus/encerrarExpediente below.
  function salvarAnalista(fields) {
    return callRpc('gestor_salvar_analista_fi', {
      p_id: fields.id || null,
      p_nome: fields.nome,
      p_cpf_normalizado: fields.cpf,
      p_whatsapp: fields.whatsapp,
      p_teams_link: fields.teamsLink || null,
      p_ordem_fila: fields.ordemFila,
      p_ativo: fields.ativo
    }).then(function (body) {
      return Array.isArray(body) ? body[0] : body;
    });
  }

  // gestor_alterar_status_analista_fi(p_analista_id, p_status) --
  // write. V1/real contract: returns {sucesso, mensagem, status_atual}.
  // Server-side validates p_status against the exact 5-value set
  // (ONLINE/OCUPADO/ALMOÇO/FÉRIAS/OFFLINE) -- the same set self-service
  // Painel do Analista uses.
  function alterarStatus(analistaId, status) {
    return callRpc('gestor_alterar_status_analista_fi', { p_analista_id: analistaId, p_status: status }).then(function (body) {
      return Array.isArray(body) ? body[0] : body;
    });
  }

  // gestor_encerrar_expediente_fi() -- write, no params. V1/real
  // contract: returns {sucesso, mensagem, total_alterado} -- bulk-sets
  // every active, non-OFFLINE analyst to OFFLINE server-side.
  function encerrarExpediente() {
    return callRpc('gestor_encerrar_expediente_fi', {}).then(function (body) {
      return Array.isArray(body) ? body[0] : body;
    });
  }

  window.NX_CENTRAL_ATENDIMENTO_FI_REAL_PROVIDER = {
    listarAnalistas: listarAnalistas,
    listarHistorico: listarHistorico,
    salvarAnalista: salvarAnalista,
    alterarStatus: alterarStatus,
    encerrarExpediente: encerrarExpediente
  };
})();
