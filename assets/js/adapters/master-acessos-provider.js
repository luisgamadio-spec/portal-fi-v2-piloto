/* PORTAL-NEXT V2 -- Painel Master / Acessos aos Módulos REAL data
   provider (Painel Master Phase 3B).

   THIN transport boundary, same principle and shape as
   master-users-provider.js -- this file's only job is calling the real,
   already-audited permission RPCs (Phase 3A audit; full bodies
   fingerprinted in this Phase's own report) and returning their raw
   payload (or a classified error). It invents nothing: no default
   permission, no synthesized cell, no MASTER row, no client-side
   business decision. All shaping/labels/diff logic lives in
   master-acessos-view-model.js; this file does not even know the
   closed 7x8 shape exists.

   Canonical model (Phase 3A, re-confirmed Phase 3B Gate 1):
   MODULE x PROFILE x DEPARTMENT, never MODULE x USER -- there is no
   user parameter anywhere in this file, on purpose.

   Reuses the EXISTING Auth Foundation session (window.NX_AUTH), same as
   every other real provider -- no independent Supabase client. */
(function () {
  'use strict';

  // Narrower vocabulary than master-users-provider.js's classifyError:
  // this contract has no 23505 (duplicate) or 55000 (conflict-as-error)
  // case -- concurrency conflicts arrive inside a 200 response's own
  // `conflitos[]` array (Gate 17), never as a transport-level error.
  function classifyError(code, httpStatus) {
    if (code === '42501') return 'AUTH_DENIED';
    if (code === '22023') return 'VALIDATION_ERROR';
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
            return Promise.reject({ state: classifyError(code, resp.status), message: (body && body.message) || 'Erro ao processar solicitação.' });
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

  function hasValidMatrixShape(data) {
    return !!data && typeof data === 'object' &&
      Array.isArray(data.modulos) && Array.isArray(data.permissoes) &&
      typeof data.flag_dinamica === 'boolean';
  }

  // Read-only. Real contract: master_listar_permissoes_modulos()
  // (Phase 3A Gate 2/28) -- returns the FULL catalog + FULL matrix in
  // one call, never paginated, since the model has no per-user rows
  // (Phase 3A Gate 3/17). Fails closed (MALFORMED_RESPONSE) rather than
  // ever synthesizing a plausible-looking empty shape.
  function loadAccessMatrix(params) {
    params = params || {};
    return callRpc('master_listar_permissoes_modulos', {}, params.signal).then(function (data) {
      if (!hasValidMatrixShape(data)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  function hasValidSaveShape(data) {
    return !!data && typeof data === 'object' &&
      Array.isArray(data.aplicadas) && Array.isArray(data.conflitos);
  }

  // WRITE. Real contract: master_salvar_permissoes_modulos(p_mudancas)
  // (Phase 3A Gate 2/15/17) -- delta-only, per-cell optimistic
  // concurrency via atualizado_em_esperado, returns {aplicadas[],
  // conflitos[]}. `changes` must already be the exact delta rows built
  // by the view-model (modulo_id, perfil, departamento, permitido,
  // atualizado_em_esperado) -- this function does not filter, dedupe,
  // or validate cell content; it only shapes the RPC envelope and
  // classifies transport-level failure.
  function saveAccessChanges(changes, params) {
    params = params || {};
    if (!Array.isArray(changes) || !changes.length) {
      return Promise.reject({ state: 'VALIDATION_ERROR', message: 'Nenhuma alteração para salvar.' });
    }
    return callRpc('master_salvar_permissoes_modulos', { p_mudancas: changes }, params.signal).then(function (data) {
      if (!hasValidSaveShape(data)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return data;
    });
  }

  window.NX_MASTER_ACESSOS_PROVIDER = {
    loadAccessMatrix: loadAccessMatrix,
    saveAccessChanges: saveAccessChanges
  };
})();
