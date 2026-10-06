/* PORTAL-NEXT V2 -- Painel Master / Usuários REAL data provider
   (Painel Master Phase 2A).

   THIN transport boundary, same principle as every other real-provider
   in this codebase (gestao/dashbi/coparticipado/score-real-provider.js):
   this file's only job is calling the real, already-audited admin RPCs
   (Phase 0/1 audit; full bodies captured in
   docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md) and returning their raw
   payload (or a classified error) -- no PII minimization, no lifecycle
   derivation, no business decision. All of that lives in
   master-users-view-model.js. This file does not decide MASTER --
   every RPC below re-verifies server-side (is_master()/inline check)
   regardless of what the route guard (shell.js) already enforced.

   MUTATION FREEZE (Phase 2A, Gate 16/47): inviteUser/updateUserAuthorization/
   resendInvite below are fully wired against the real, audited RPC
   contract -- but this phase's own execution NEVER calls them for real
   (only exercised via mocked Playwright tests, tests/master-users-*.py).
   loadMasterUsersData is the one function actually invoked against the
   real backend this phase, and it is read-only.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), same as
   every other real provider -- no independent Supabase client. */
(function () {
  'use strict';

  // Gate 22 runtime-state vocabulary (extended for Usuários' own
  // mutation-specific outcomes): LOADING/SUCCESS/EMPTY/AUTH_DENIED/
  // SESSION_EXPIRED/VALIDATION_ERROR/DUPLICATE_USER/CONFLICT/RPC_ERROR/
  // NETWORK_ERROR/TIMEOUT/MALFORMED_RESPONSE.
  function classifyError(code, httpStatus, message) {
    if (code === '42501') return 'AUTH_DENIED';
    if (code === '22023') return 'VALIDATION_ERROR';
    if (code === '23505') return 'DUPLICATE_USER';
    if (code === '55000') return 'CONFLICT'; // master_reenviar_convite's "already delivered" case
    if (code === 'P0002') return 'RPC_ERROR'; // not found
    if (httpStatus === 401 || httpStatus === 403) return 'SESSION_EXPIRED';
    return 'RPC_ERROR';
  }

  function hasValidUsersShape(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.users);
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
      var timer = timeoutController
        ? setTimeout(function () { timeoutController.abort(); }, DEFAULT_TIMEOUT_MS)
        : null;

      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + fnName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(params || {}),
        signal: effectiveSignal
      }).then(function (resp) {
        if (timer) clearTimeout(timer);
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            var code = body && body.code;
            return Promise.reject({ state: classifyError(code, resp.status, body && body.message), message: (body && body.message) || 'Erro ao processar solicitação.' });
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

  // Read-only. The one function this phase actually calls against the
  // real backend (Gate 41). Merges master_admin_security_data()'s
  // `users` array with master_listar_convites()'s rows (matched by
  // usuario_id) so the view-model can derive invite/lifecycle state
  // without a second round-trip per row.
  function loadMasterUsersData(params) {
    params = params || {};
    return Promise.all([
      callRpc('master_admin_security_data', {}, params.signal),
      callRpc('master_listar_convites', {}, params.signal)
    ]).then(function (results) {
      var security = results[0];
      var convites = results[1];
      if (!hasValidUsersShape(security) || !Array.isArray(convites)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return { users: security.users, convites: convites };
    });
  }

  // Edge Function transport -- same auth (session bearer token only,
  // never service-role) and error-normalization discipline as callRpc,
  // just a different real endpoint shape
  // (`${supabaseUrl}/functions/v1/${fnName}`, not `/rest/v1/rpc/`).
  function callEdgeFunction(fnName, payload, signal) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      return Promise.reject({ state: 'RPC_ERROR', message: 'Configuração real ausente neste ambiente.' });
    }
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') {
      return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    }
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
      return fetch(cfg.supabaseUrl + '/functions/v1/' + fnName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload || {}),
        signal: signal
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (body) {
          if (!resp.ok) {
            return Promise.reject({ state: (resp.status === 401 || resp.status === 403) ? 'SESSION_EXPIRED' : 'RPC_ERROR', message: (body && body.error) || 'Erro ao enviar convite.' });
          }
          return body;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') return Promise.reject({ state: 'ABORTED', message: 'Requisição cancelada.' });
        return Promise.reject({ state: 'NETWORK_ERROR', message: 'Falha de rede.' });
      });
    });
  }

  // Exact param shape per docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md.
  // Real V1 contract (confirmed Phase 0/1 audit): master_convidar_usuario
  // creates the usuarios/convites_usuario rows WITHOUT touching
  // Supabase Auth or sending any email -- admin-invite-user is the
  // separate, required second step that actually delivers the real
  // invite. Chained here so the V2 UI reproduces the real two-step
  // contract exactly (Painel Master Phase 2B Gate 15 finding: Phase
  // 2A's own implementation stopped after the first step, an
  // incomplete-but-safe gap since it was never executed for real
  // either way -- fixed here before any real mutation).
  function inviteUser(fields, params) {
    params = params || {};
    return callRpc('master_convidar_usuario', {
      p_cpf: fields.cpf, p_nome: fields.nome, p_perfil: fields.perfil,
      p_loja: fields.loja || null, p_email: fields.email,
      p_nbs: fields.nbs || null, p_status: fields.status || null
    }, params.signal).then(function (rpcResult) {
      return callEdgeFunction('admin-invite-user', { convite_id: rpcResult.convite_id }, params.signal)
        .then(function (edgeResult) {
          return { rpc: rpcResult, edge: edgeResult };
        }, function (edgeErr) {
          // Real contract: the usuarios/convites_usuario rows already
          // exist and are valid (FALHA status, retriable via
          // resendInvite) -- this is not a rollback-worthy failure, but
          // the caller must still see it as an error so the UI doesn't
          // claim success for an invite that was never actually sent.
          return Promise.reject(Object.assign({ rpc: rpcResult }, edgeErr));
        });
    });
  }

  // WIRED, NOT EXECUTED THIS PHASE. Full-row overwrite per the RPC's
  // own real contract -- caller must always send all 4 fields.
  function updateUserAuthorization(fields, params) {
    params = params || {};
    return callRpc('master_atualizar_autorizacao_usuario', {
      p_usuario_id: fields.usuarioId, p_perfil: fields.perfil,
      p_loja: fields.loja, p_status: fields.status, p_ativo: fields.ativo
    }, params.signal);
  }

  // WIRED, NOT EXECUTED THIS PHASE.
  // Real V1 contract (Phase 0/1 audit): for the "no Auth account yet"
  // case, resend is the SAME two-step shape as invite -- reset the
  // convite row via master_reenviar_convite, then re-deliver via the
  // SAME admin-invite-user Edge Function used by the original invite.
  // (The "Auth exists but unconfirmed" case uses a different Edge
  // Function, admin-resend-user-invite -- not needed by this module's
  // current lifecycle states, since master_reenviar_convite itself
  // already refuses that case server-side with a real 55000 CONFLICT.)
  function resendInvite(conviteId, params) {
    params = params || {};
    return callRpc('master_reenviar_convite', { p_convite_id: conviteId }, params.signal).then(function (rpcResult) {
      return callEdgeFunction('admin-invite-user', { convite_id: conviteId }, params.signal)
        .then(function (edgeResult) {
          return { rpc: rpcResult, edge: edgeResult };
        }, function (edgeErr) {
          return Promise.reject(Object.assign({ rpc: rpcResult }, edgeErr));
        });
    });
  }

  // Painel Master Phase PM-4B.3 (Human UAT finding: real V1 parity gap --
  // link-generation actions never existed in V2 at all, confirmed by
  // direct source read of portal-app.js's renderFichaUsuarioHtml()).
  // Real Edge Function contract (supabase/functions/admin-generate-user-
  // access-link/index.ts, ia-reconciliation-v2-local): MASTER-only
  // re-verified server-side against the DB (never trusts the frontend),
  // rate-limited 5min server-side via the auditoria table, re-validates
  // target eligibility fresh from the DB (never trusts what the UI
  // rendered), never persists/logs the returned link anywhere server-
  // side. tipo is 'activation' (target must be !ativo && primeiro_acesso)
  // or 'recovery' (target must be ativo && !primeiro_acesso) -- this
  // file does not re-decide eligibility, it only calls through; the
  // real authority is 100% server-side, exactly like every other
  // mutation in this file.
  function generateAccessLink(usuarioId, tipo, params) {
    params = params || {};
    return callEdgeFunction('admin-generate-user-access-link', { usuario_id: usuarioId, tipo: tipo }, params.signal);
  }

  // Continuation link (Incidente 22.1 real contract): a DIFFERENT
  // backend shape than activation/recovery above -- the raw token is
  // generated CLIENT-SIDE (32 random bytes via Web Crypto, same
  // algorithm as portal-app.js's own continuacaoRandomToken()) and only
  // its SHA-256 HASH is ever sent to the RPC; the RPC never sees or
  // returns the raw token, so the final link is assembled here, from
  // the token this file itself generated, never from anything the
  // server returns. This is the exact real security model already
  // proven in production -- not invented here, replicated byte-for-
  // byte from the real V1 helpers.
  function continuacaoRandomTokenHex() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function continuacaoSha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(function (digest) {
      return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  // Real, public (not secret) production redirect target -- the exact
  // same constant portal-app.js's own CONTINUACAO_PRIMEIRO_ACESSO_URL_BASE
  // uses; this is where the token is redeemed, not a credential.
  var CONTINUACAO_PRIMEIRO_ACESSO_URL_BASE = 'https://brabus.blistiq.com.br/concluir-acesso.html';

  function generateContinuationLink(usuarioId, params) {
    params = params || {};
    var token = continuacaoRandomTokenHex();
    return continuacaoSha256Hex(token).then(function (tokenHash) {
      var expiraEm = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return callRpc('master_gerar_continuacao_primeiro_acesso', {
        p_usuario_id: usuarioId, p_token_hash: tokenHash, p_expira_em: expiraEm
      }, params.signal).then(function (data) {
        if (!data || data.ok !== true) {
          var codigo = data && data.codigo;
          return Promise.reject({ state: 'RPC_ERROR', code: codigo, aguardarSegundos: data && data.aguardar_segundos, message: 'Não foi possível gerar o link.' });
        }
        // The link is assembled HERE, client-side, from the token this
        // function itself generated -- the RPC response never contains
        // it (only {ok, codigo}), matching the real security model.
        return { link: CONTINUACAO_PRIMEIRO_ACESSO_URL_BASE + '#token=' + encodeURIComponent(token) };
      });
    });
  }

  window.NX_MASTER_USERS_PROVIDER = {
    loadMasterUsersData: loadMasterUsersData,
    inviteUser: inviteUser,
    updateUserAuthorization: updateUserAuthorization,
    resendInvite: resendInvite,
    generateAccessLink: generateAccessLink,
    generateContinuationLink: generateContinuationLink
  };
})();