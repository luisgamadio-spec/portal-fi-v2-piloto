/* PORTAL-NEXT V2 -- Painel Master / Usuários view-model (Painel Master
   Phase 2A, Gate 11/12/21).

   Reshapes master_admin_security_data()'s raw `users` array (merged
   with master_listar_convites()'s rows) into PII-minimized,
   presentation-safe rows. Field-by-field authority:
   docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md.

   PII minimization (Gate 12): CPF is masked, never shown in full.
   auth_user_id is not even present in the raw payload (only the
   boolean `tem_auth`) -- this file never invents or re-derives it.
   Invite tokens (continuacao_token_hash etc.) are never part of
   master_admin_security_data()'s payload at all -- nothing to strip.

   Lifecycle (Gate 21, MASTER_USER_LIFECYCLE_V1): derived ONLY from the
   4 real fields the RPC actually returns (tem_auth, auth_confirmado,
   primeiro_acesso, ativo) -- no invented state. */
(function () {
  'use strict';

  // Same masking shape already used elsewhere in this codebase for a
  // masked identifier (right() suffix visible, rest hidden) -- CPF has
  // 11 digits; keep the last 2 (matches the real RPC's own
  // "***"||right(...) convention for other masked fields in this app).
  function maskCpf(cpf) {
    var digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length < 3) return '***';
    return '***.***.**' + digits.slice(-2);
  }

  // Painel Master Phase 2C, Gate 1/3 (human UAT forensics): invite/auth
  // lifecycle and administrative active/blocked state are two
  // INDEPENDENT dimensions in the real backend contract -- `ativo` is
  // a full, standalone column on `usuarios`, orthogonal to
  // tem_auth/auth_confirmado/primeiro_acesso (confirmed directly: a
  // real block was proven server-side successful, audit row and all,
  // against a user whose tem_auth was still false at that moment).
  // The prior single-dimension classifyLifecycle() checked !tem_auth
  // FIRST and returned immediately, so `ativo` was NEVER consulted for
  // any user who hadn't yet completed Auth creation -- a real user
  // could be blocked and the UI would still show "Convidado —
  // aguardando aceite" with zero visible change. Split into two
  // classifiers, both always evaluated, never collapsed into one
  // badge that hides the other.
  function classifyInviteState(u) {
    if (!u.tem_auth) {
      return { state: 'INVITED', label: 'Convidado — aguardando aceite' };
    }
    if (!u.auth_confirmado) {
      return { state: 'AUTH_CREATED_UNCONFIRMED', label: 'Conta criada — e-mail não confirmado' };
    }
    if (u.primeiro_acesso) {
      return { state: 'FIRST_ACCESS_PENDING', label: 'Confirmado — primeiro acesso pendente' };
    }
    return { state: 'ACCEPTED', label: 'Primeiro acesso concluído' };
  }

  function classifyAdminState(u) {
    return u.ativo
      ? { state: 'ACTIVE', label: 'Ativo' }
      : { state: 'BLOCKED', label: 'Bloqueado' };
  }

  // Back-compat name some call sites may still use; delegates to the
  // invite dimension only (never re-introduce the collapsed shape).
  function classifyLifecycle(u) { return classifyInviteState(u); }

  function findConvite(convites, usuarioId) {
    var matches = (convites || []).filter(function (c) { return c.usuario_id === usuarioId; });
    if (!matches.length) return null;
    // most recent by convidado_em
    matches.sort(function (a, b) { return new Date(b.convidado_em) - new Date(a.convidado_em); });
    return matches[0];
  }

  // Painel Master Phase PM-4B.3: real V1 parity (portal-app.js's own
  // renderFichaUsuarioHtml(), read directly, not assumed) -- these are
  // the exact 3 non-legacy conditions under which a real MASTER-
  // generated access link is offered. The 4th real V1 branch (BLISTIQ
  // legacy migration links, gated on a legacy-account marker this
  // payload doesn't carry) is deliberately NOT reproduced here --
  // tracked separately (Gate: not silently dropped, see report) since
  // it targets a different external domain via a different Edge
  // Function shape, not a simple 4th case of this same action. Any
  // combination outside these 3 (e.g. ativo && primeiro_acesso) matches
  // V1's own real gap -- no action, not invented to fill it.
  function determineAccessLinkAction(u) {
    if (!u.tem_auth) return null;
    if (!u.ativo && u.primeiro_acesso && u.auth_confirmado) {
      return { type: 'continuation', label: 'Gerar link para concluir acesso' };
    }
    if (!u.ativo && u.primeiro_acesso && !u.auth_confirmado) {
      return { type: 'activation', label: 'Gerar link de ativação' };
    }
    if (u.ativo && !u.primeiro_acesso) {
      return { type: 'recovery', label: 'Gerar link para redefinir senha' };
    }
    return null;
  }

  function buildUserRow(u, convites) {
    var lifecycle = classifyInviteState(u);
    var adminState = classifyAdminState(u);
    var convite = findConvite(convites, u.id);
    return {
      id: u.id,
      nome: u.nome || '',
      emailAuth: u.email_auth || '',
      cpfMasked: maskCpf(u.cpf),
      perfil: u.perfil || '',
      loja: u.loja || '',
      status: u.status || '',
      ativo: !!u.ativo,
      lifecycle: lifecycle,
      adminState: adminState,
      emailDivergente: !!u.email_divergente,
      accessLinkAction: determineAccessLinkAction(u),
      // Resend Invite is only meaningful (and only safe, per the real
      // RPC's own contract -- master_reenviar_convite rejects a target
      // that already has tem_auth=true) while lifecycle is INVITED.
      conviteId: (lifecycle.state === 'INVITED' && convite) ? convite.id : null,
      conviteStatus: convite ? convite.status : null
    };
  }

  function buildUsersViewModel(payload) {
    var rows = (payload.users || []).map(function (u) { return buildUserRow(u, payload.convites); });
    return { rows: rows };
  }

  // Gate 18/19: extracted verbatim from the real RPC's own accepted
  // values (docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md) -- not invented,
  // not reconstructed from memory.
  var PERFIL_VALUES = ['MASTER', 'DIRETOR NOVOS', 'DIRETOR SEMINOVOS', 'ANALISTA', 'GERENTE', 'VENDEDOR', 'RECURSOS HUMANOS', 'RH'];
  // Gate 19: BRABUS_SPECIFIC_STORE_CATALOG_DEBT -- hardcoded inside the
  // real RPC itself (master_convidar_usuario's v_lojas_validas), not a
  // catalog table; V2 mirrors it as-is, not a new source of truth.
  var LOJA_VALUES = ['ABC', 'ALPHAVILLE', 'ANALIA FRANCO', 'BANDEIRANTES', 'BARRA FUNDA', 'EUROPA', 'GASTAO', 'NACOES'];
  var STATUS_VALUES = ['NOVOS', 'SEMINOVOS', 'NOVOS/SEMINOVOS'];
  var STATUS_REQUIRED_PROFILES = ['VENDEDOR', 'GERENTE', 'ANALISTA'];

  window.NX_MASTER_USERS_VIEW_MODEL = {
    buildUsersViewModel: buildUsersViewModel,
    maskCpf: maskCpf,
    classifyLifecycle: classifyLifecycle,
    classifyInviteState: classifyInviteState,
    classifyAdminState: classifyAdminState,
    determineAccessLinkAction: determineAccessLinkAction,
    PERFIL_VALUES: PERFIL_VALUES,
    LOJA_VALUES: LOJA_VALUES,
    STATUS_VALUES: STATUS_VALUES,
    STATUS_REQUIRED_PROFILES: STATUS_REQUIRED_PROFILES
  };
})();