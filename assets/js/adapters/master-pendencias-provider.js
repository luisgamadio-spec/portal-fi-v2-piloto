/* PORTAL-NEXT V2 -- Painel Master / Pendências Cadastrais REAL data
   provider (Painel Master Phase PM-4C.2).

   THIN transport boundary, same principle and shape as
   master-audit-provider.js/master-users-provider.js/master-acessos-
   provider.js -- own independent callRpc(), no shared coupling to any
   other admin concern's fetch lifecycle (PM-4B established precedent).

   Real contract (PM-4C.1 forensics): EXACTLY 7 real, already-deployed,
   already-audited MASTER-only RPCs (supabase/migrations
   20260818150000_fase212_governanca_alertas_cadastrais.sql,
   20260820030000_fase225a_ux_propagacao_excecao_cadastral.sql,
   20260820040000_fase225a1_corrigir_login_nbs.sql) -- no new backend,
   no RPC created/wrapped here. Two tables sit behind these RPCs
   (portal_cadastro_alertas, portal_cadastro_excecoes), both RLS-
   enabled with table-level GRANT revoked from anon/authenticated --
   this file therefore has NO direct table read/write path at all, on
   purpose; every call below goes through an RPC name, never a
   `.from(...)` table reference.

   Transport-level errors (auth/session/network/timeout) are
   classified via the same STATE_COPY vocabulary used across every
   other Painel Master provider. Business-level RPC failures
   (resp.ok === false) are NOT classified here -- they are passed
   through verbatim (state: 'RPC_ERROR', codigo: <real backend code>)
   so the controller can apply the exact per-action human copy (Gate
   33 of the Phase brief), the same division of labor already used by
   master-users-provider.js's generateAccessLink/generateContinuationLink. */
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

  // Business-level failure pass-through (Gate: never classify a real
  // backend `codigo` here -- the controller owns the human copy per
  // action). A transport-level success that isn't even a plain object,
  // or is missing `ok` entirely, is a real contract violation, not a
  // business failure -- fails closed as MALFORMED_RESPONSE instead of
  // silently treating `undefined !== true` as some generic rejection.
  function rejectIfNotOk(data) {
    if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
      return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
    }
    if (data.ok !== true) {
      return Promise.reject({ state: 'RPC_ERROR', codigo: data.codigo, data: data });
    }
    return data;
  }

  function hasValidAlertasShape(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.rows);
  }

  // ---------- alertas (read) ----------
  function loadAlertas(filtros, params) {
    filtros = filtros || {};
    params = params || {};
    return callRpc('master_cadastro_alertas_listar', {
      p_status: filtros.status || null,
      p_severidade: filtros.severidade || null,
      p_tipo: filtros.tipo || null,
      p_origem_base: filtros.origem || null,
      p_limit: 500,
      p_offset: 0
    }, params.signal).then(function (data) {
      if (!hasValidAlertasShape(data)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return { rows: data.rows, total: data.total || 0 };
    });
  }

  // Badge count -- mirrors V1's own pcContarUrgentesPendentes(): only
  // PENDENTE + URGENTE, p_limit=1 (only `total` is ever read). Fails
  // to 0 rather than surfacing a nav-badge error state (same non-
  // critical-decoration precedent already used elsewhere in this file's
  // sibling providers for anything that is a hint, not a data surface).
  function countUrgentesPendentes(params) {
    params = params || {};
    return callRpc('master_cadastro_alertas_listar', {
      p_status: 'PENDENTE', p_severidade: 'URGENTE', p_limit: 1, p_offset: 0
    }, params.signal).then(function (data) {
      return (data && typeof data.total === 'number') ? data.total : 0;
    }, function () { return 0; });
  }

  // ---------- alertas (mutate) ----------
  function resolverAlerta(alertaId, motivo, params) {
    params = params || {};
    return callRpc('master_cadastro_alerta_resolver', {
      p_alerta_id: alertaId, p_motivo: motivo || null
    }, params.signal).then(rejectIfNotOk);
  }

  function ignorarAlerta(alertaId, motivo, observacao, criarExcecao, params) {
    params = params || {};
    return callRpc('master_cadastro_alerta_ignorar', {
      p_alerta_id: alertaId, p_motivo: motivo, p_observacao: observacao || null,
      p_criar_excecao: !!criarExcecao
    }, params.signal).then(rejectIfNotOk);
  }

  function excluirAlerta(alertaId, motivo, params) {
    params = params || {};
    return callRpc('master_cadastro_alerta_excluir', {
      p_alerta_id: alertaId, p_motivo: motivo
    }, params.signal).then(rejectIfNotOk);
  }

  // The ONLY real correction RPC in this whole surface (Gate 32): never
  // updates usuarios directly from this file -- the RPC itself is the
  // sole mutation authority, this is only a transport call.
  function corrigirLoginNbs(alertaId, novoLoginNbs, observacao, params) {
    params = params || {};
    return callRpc('master_cadastro_alerta_corrigir_login_nbs', {
      p_alerta_id: alertaId, p_novo_login_nbs: novoLoginNbs, p_observacao: observacao || null
    }, params.signal).then(rejectIfNotOk);
  }

  // ---------- exceções ----------
  function loadExcecoes(filtros, params) {
    filtros = filtros || {};
    params = params || {};
    var ativo = filtros.ativo === undefined ? true : filtros.ativo;
    return callRpc('master_cadastro_excecoes_listar', {
      p_ativo: ativo, p_identificador_tipo: filtros.tipo || null,
      p_limit: 500, p_offset: 0
    }, params.signal).then(function (data) {
      if (!hasValidAlertasShape(data)) {
        return Promise.reject({ state: 'MALFORMED_RESPONSE', message: 'Resposta inesperada do servidor.' });
      }
      return { rows: data.rows, total: data.total || 0 };
    });
  }

  function criarExcecao(tipo, valor, motivo, observacao, params) {
    params = params || {};
    return callRpc('master_cadastro_excecao_criar', {
      p_identificador_tipo: tipo, p_identificador_valor: valor,
      p_motivo: motivo, p_observacao: observacao || null
    }, params.signal).then(rejectIfNotOk);
  }

  function revogarExcecao(excecaoId, params) {
    params = params || {};
    return callRpc('master_cadastro_excecao_revogar', {
      p_excecao_id: excecaoId
    }, params.signal).then(rejectIfNotOk);
  }

  window.NX_MASTER_PENDENCIAS_PROVIDER = {
    loadAlertas: loadAlertas,
    countUrgentesPendentes: countUrgentesPendentes,
    resolverAlerta: resolverAlerta,
    ignorarAlerta: ignorarAlerta,
    excluirAlerta: excluirAlerta,
    corrigirLoginNbs: corrigirLoginNbs,
    loadExcecoes: loadExcecoes,
    criarExcecao: criarExcecao,
    revogarExcecao: revogarExcecao
  };
})();
