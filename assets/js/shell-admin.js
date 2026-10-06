/* PORTAL-NEXT V2 — Painel Master / Admin Foundation (Painel Master
   Phase 2A). Business logic: none here — this file only orchestrates
   the real, already-audited admin RPCs (via
   assets/js/adapters/master-users-provider.js +
   master-users-view-model.js). Full RPC contract:
   docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md.

   Route guard: shell.js's router already enforces MASTER_ONLY
   (auth-core.js's isModuleAuthorized) BEFORE this module's render() is
   ever called — this file does not re-implement that check (Gate:
   "não duplicar regra administrativa no frontend"). The real RPCs also
   independently re-verify MASTER server-side regardless (defense in
   depth, already proven in Phase 0/1's audit) — this file trusts
   neither its own nor the router's check as the actual authority.

   Information architecture (Gate 9): six real clusters exist
   (Usuários & Acesso / Governança de Dados / Comissões & RH /
   Simuladores / Auditoria / Futuras Funcionalidades — Phase 0/1 Gate
   4). Only "Usuários" is implemented this Phase; the section-nav
   below is built to add sections without restructuring (MIGRATED_SCOPE
   = USERS_ONLY).

   Router note: this SPA's router is flat (one hash segment per
   registry entry id, "#/shell-admin" — the registry's own "route":
   "/admin" field is documentation-only, never read by code, confirmed
   Phase 2A Gate 5 research). "Subrotas" are therefore internal view
   state (currentSection/currentView below), not a second hash-routing
   layer — this is the correct, evidence-based choice, not an
   improvisation (no nested-route mechanism exists anywhere in this
   codebase to reuse, and building one would be exactly the kind of new
   parallel architecture this Phase is instructed to avoid).

   Real-mode only (Gate 28): unlike the analytical modules, Usuários
   has no natural "fixture scenario" concept (it is not a calculation
   engine over varying datasets — it is one real administrative
   dataset). Deterministic tests mock the transport at the network
   layer (Playwright route()), the same technique already proven for
   every real-provider-test.py in this codebase, rather than adding a
   redundant JS-level fixture toggle here. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  // V2-SECURITY-02 (SEC-01): never interpolate a raw err.message into
  // the DOM -- same discipline score.js's STATE_COPY/errorStateHtml
  // already applies (classify, show a fixed generic copy, never the
  // provider's own text), just without this file's ad-hoc handlers
  // needing a full state-classification system to get there. A raw
  // Postgres/PostgREST error can carry table/column/constraint names
  // or query fragments; none of that is safe to show a Master admin.
  function safeErrorMessage() {
    return 'Não foi possível concluir a operação agora. Tente novamente.';
  }

  // ---------- module state ----------
  var currentSection = 'usuarios'; // only implemented section this Phase
  var currentView = 'list'; // 'list' | 'detail' | 'create'
  var usersRows = [];
  var currentDetailId = null;
  var searchQuery = '';
  var filterPerfil = '';
  var filterLoja = '';
  var filterStatus = ''; // '' = all, 'ATIVO', 'INATIVO'
  var renderSeq = 0;
  var currentAbortController = null;
  var loadError = null;
  var isLoading = false;

  // Double-submit guards (Gate 24) — one per distinct mutation action,
  // never a single shared flag (two different actions must not block
  // each other).
  var inFlight = { invite: false, edit: false, toggleActive: false, resend: false, saveAcessos: false, generateLink: false, pcMutate: false, pcExcecao: false, gbImport: false, gsImport: false, cfgSave: false, prAction: false, absAction: false, scAction: false };

  // Painel Master Phase 3B -- Acessos aos Módulos section state. Kept
  // entirely separate from the Usuários vars above (own load/error/
  // success lifecycle) since the two sections load independent
  // datasets and must never leak state into each other. MODULE x
  // PROFILE x DEPARTMENT only (Phase 3A Gate 3/Phase 3B Gate 1
  // fingerprint) -- no per-user field exists here, on purpose.
  var acessosState = {
    loading: false, loaded: false, saving: false, error: null,
    modules: [], serverSnapshot: {}, serverUpdatedAt: {}, localPermissions: {},
    dirty: false, successMessage: null, conflictMessage: null
  };

  // Painel Master Phase PM-4B -- Auditoria section state. READ-ONLY (no
  // dirty/saving concept at all -- there is no mutation path here by
  // design, Gate 4/18). currentDetailId reused conceptually but kept in
  // its own var (auditDetailId) so opening an audit row's detail never
  // interferes with a Usuários row's own currentDetailId.
  var auditState = { loading: false, loaded: false, error: null, rows: [] };
  var auditDetailId = null;

  // Painel Master Phase PM-4C.2 -- Pendências Cadastrais section state.
  // Own load/error lifecycle, own detail id (pcDetailId, never reusing
  // currentDetailId/auditDetailId -- same independence discipline as
  // Auditoria above). `rows` holds the RPC's own server-filtered result
  // for the current tab/tipo/origem (Gate 22: server ORDER BY preserved,
  // never client-re-sorted); `filtros.busca` is a purely client-side
  // refinement over that same set (Gate 21), never sent to the RPC.
  // `excecoes` is a fully separate sub-lifecycle for the "Exceções" aba
  // (its own 3 RPCs), deliberately not merged into the alertas state.
  var pcState = {
    loading: false, loaded: false, error: null, rows: [], total: 0,
    aba: 'alertas', tab: 'PENDENTES', filtros: { tipo: '', origem: '', busca: '' },
    excecoes: { loading: false, loaded: false, error: null, rows: [], filtroTipo: '', filtroAtivo: true, formError: null }
  };
  var pcDetailId = null;
  var pcSearchDebounce = null;

  // Painel Master Phase PM-5C -- Gestão de Bases section state. Own
  // independent load lifecycle, same discipline as acessosState/
  // auditState/pcState above (never leaks into another section's state).
  // `sellersByNbs` mirrors V1's GB_SELLERS_CACHE (a client-side lookup
  // used ONLY to enrich store/CPF for display+payload -- NOT to
  // replicate the real seller/CPF/NBS identity-resolution the backend
  // RPCs already own independently, confirmed by direct inspection of
  // their live bodies, PM-5C Gate 13). `sessionFinanceBatch` mirrors
  // V1's GB_SESSION.financeBatch (in-memory only, never persisted --
  // lets a just-opened Base 02 batch's seller-less rows be silently
  // re-resolved after Colaboradores is updated in the SAME browser
  // session, without re-uploading the Base 02 file).
  var gbState = {
    loading: false, loaded: false, error: null,
    officialBatches: {}, // SOURCE_ORDER id -> {validated}
    sellersByNbs: null,
    pendingSourceType: null,
    processing: false,
    progress: { done: 0, total: 0 },
    modal: null, // null | {kind:'diagnostic'|'success'|'error', ...}
    sessionFinanceBatch: null,
    lastMissingSellers: []
  };

  // Painel Master Phase PM-5D -- Gestão dos Simuladores section state.
  // Own independent load lifecycle, same discipline as gbState above.
  // `statusByTipo` mirrors V1's gsCarregarStatus() result (tipo_base ->
  // ACTIVE batch info, from master_simulador_listar_bases). `pendingUid`
  // tracks which of the 10 GS_BASE_DEFS card triggered the current file
  // picker/flow.
  var gsState = {
    loading: false, loaded: false, error: null,
    statusByTipo: {},
    pendingUid: null,
    modal: null // null | {kind:'diagnostic'|'success'|'error', ...}
  };

  // Painel Master Phase PM-5E -- Configurações section state. Own
  // independent load lifecycle. `editingKey` tracks which single
  // setting is currently in edit mode (Gate 46: read -> explicit
  // Editar -> changed state -> confirmation -> save; never all 13
  // casually editable at once). NO homologation-mode concept exists
  // here (PM-5E Gate 39 -- confirmed, not assumed) -- every save is a
  // REAL write against the real backend, on any host.
  var cfgState = {
    loading: false, loaded: false, error: null,
    settings: [], // NX_MASTER_CONFIG_VM.buildEffectiveConfig() output
    editingKey: null, editDraft: '',
    modal: null // null | {kind:'confirm'|'success'|'error', ...}
  };

  // Painel Master Phase PM-5E -- Períodos de Comissão section state.
  // `createForm` is null unless the Human explicitly opened the create
  // form (Gate 46 discipline extended to this capability too). No
  // homologation-mode concept exists here either -- every action
  // (Criar/Definir atual/Ativar/Inativar/Arquivar) is a REAL write.
  var prState = {
    loading: false, loaded: false, error: null,
    periods: [],
    createForm: null, // null | {name, start, end, isCurrent, error}
    modal: null // null | {kind:'confirm'|'success'|'error', ...}
  };

  // Painel Master Phase PM-5F -- Férias/Ausências section state. Same
  // discipline as prState: own independent load lifecycle, createForm
  // null unless explicitly opened, no homologation-mode concept
  // (confirmed live, PM-5F Gate 44) -- every write is a REAL write.
  // No edit form exists here -- V1 has no reachable edit action for an
  // existing absence (create + activate/deactivate + archive only).
  var absState = {
    loading: false, loaded: false, error: null,
    absences: [],
    createForm: null, // null | {cpfAnalistaAusente, nomeAnalistaAusente, lojaOrigem, cpfAnalistaSubstituto, nomeAnalistaSubstituto, lojaCoberta, dataInicio, dataFim, motivo, error, overlapWarning}
    modal: null // null | {kind:'confirm'|'success'|'error', ...}
  };

  // Painel Master Phase PM-5F -- Mudança de Loja - Vendedores section
  // state. `deptForm` is separate from `createForm` -- SET_DEPARTMENTS
  // is a distinct real action from CREATE, surfaced via its own shared
  // modal form (never V1's native prompt()).
  var scState = {
    loading: false, loaded: false, error: null,
    storeChanges: [],
    createForm: null, // null | {cpfVendedor, loginVendedor, nomeVendedor, lojaOrigem, lojaDestino, dataInicioOrigem, dataFimOrigem, dataInicioDestino, observacao, departamentoOrigem, departamentoDestino, error, chainGuidance}
    modal: null // null | {kind:'confirm'|'success'|'error'|'editDepartments', ...}
  };

  // Painel Master Phase PM-5H -- Utilização dos Simuladores section
  // state. READ-ONLY capability (confirmed live: the only 4 writer
  // RPCs for this capability's own data are called exclusively by the
  // simulator surfaces themselves, never by any Painel Master action --
  // no mutation of any kind is exposed here, matching V1's own real
  // contract exactly). `linhas` is the period-filtered dataset already
  // aggregated server-side by (usuario_id, module_id); `linhasLifetime`
  // is loaded on demand (banner "Desde o início" + "Nunca utilizou").
  // `usuariosCache` reuses master_admin_security_data() already used by
  // Usuários -- no new RPC for the eligibility cross-reference.
  var suState = {
    loading: false, loaded: false, error: null,
    linhas: [],
    linhasLifetime: null,
    usuariosCache: null,
    telemetryEnabled: null, // null = no RPC response yet
    telemetryStartedAt: null,
    filtros: { preset: '30d', dtIni: '', dtFim: '', loja: '', departamento: '', modulo: '', perfil: '', busca: '' },
    ordenacao: 'ultimo_uso_desc',
    nuncaUtilizouAberto: false,
    nuncaUtilizouLoading: false,
    nuncaUtilizouCache: null
  };

  // Painel Master Phase PM-5H (Histórico de Competências) -- STRICTLY
  // READ-ONLY (Gate 4): no create/edit/close/reopen/archive/delete
  // action exists anywhere in this state or its render functions.
  // `closings` is the full, unfiltered result of master_commission_
  // closings() (every period, every version, both FECHADO and
  // REABERTO -- Gate 15, never hidden). `detail` holds the currently
  // open snapshot (one closing at a time, fetched fresh via master_
  // commission_snapshot(closingId) -- never mixed across closings/
  // versions). `exporting`/`exportError` track the separate, fail-
  // closed master_commission_snapshot_export(closingId) call the
  // Export action uses -- never the same (unguarded) rows as `detail`.
  var historyState = {
    loading: false, loaded: false, error: null,
    closings: [],
    detail: null, // { closingId, loading, error, rows, closing }
    exportingId: null,
    exportError: null,
    // Reabertura de Competência (Painel Master Phase PM-5K-RETRY). Lives
    // here, not in the Fechamento module, because the action operates on
    // an existing, already-versioned closing (Histórico's own subject),
    // per PM-5K-RETRY Gate 29 -- confirmed against the real, live-read
    // master_reopen_commission_period body (single p_closing_id write,
    // never touches snapshot_comissoes). `simulate` defaults to true
    // (Gate 31): while true, confirming calls
    // reopenCommissionPeriodSimulated (pure client-side fake) instead of
    // the real RPC. Switching it off is a deliberate, explicit action,
    // never the default.
    reopenModalOpen: false, reopenClosing: null, reopenSimulate: true,
    reopening: false, reopenError: null,
    // Exportar RH/DP + PDF/Imprimir (Painel Master Phase PM-6B). Both are
    // read-only, fail-closed operations (never write) -- see
    // historyExportRhDp/historyPrintRhDp's own doc comments for the exact
    // V1-parity contract. rhdpErrorByClosingId/printErrorByClosingId are
    // keyed by closing id (not a single shared field) so an error on one
    // row's action never bleeds into another row's UI state.
    rhdpExportingId: null, rhdpErrorByClosingId: {},
    printOpeningId: null, printErrorByClosingId: {}
  };

  // Painel Master Phase PM-5J (Fechamento de Competência). `simulate`
  // defaults to true (Gate 35/36 -- LOCAL_CLOSING_WRITE_MODE must never
  // be REAL during homologation by default): while true, confirming
  // calls closeCommissionPeriodSimulated (pure client-side fake, never
  // touches the network) instead of the real master_close_commission_
  // period RPC. Switching it off is a deliberate, explicit, separately-
  // confirmed action in the UI, never the default. Reabrir intentionally
  // lives in `historyState` instead (Histórico de Competências), not
  // here -- see that state's own doc comment (PM-5K-RETRY Gate 29).
  var closingState = {
    simulate: true,
    periods: null, periodsLoading: false, periodsError: null,
    selectedPeriodId: '',
    existingClosingChecked: false, existingClosing: null, existingClosingError: null,
    previewLoading: false, previewError: null,
    preview: null, previewToken: null, gestorBlocked: false,
    confirmOpen: false,
    closing: false, closeError: null, successResult: null
  };

  // Create/Edit form working state — reset on view change.
  var createForm = null;
  var editForm = null;
  var pendingConfirm = null; // {kind, payload} while a confirm step is shown

  // Phase 2C, Gate 6/7 (human UAT fix): explicit success feedback for
  // the mutations whose only backend side effect leaves no obvious
  // visible trace otherwise -- Bloquear/Reativar (now visible via the
  // admin badge, but an explicit confirmation is still correct here)
  // and Reenviar convite (a real email send with zero other UI change
  // -- proven human-reported gap: "sem nenhuma mensagem de sucesso").
  // Create/Edit are deliberately left alone (Gate 7's own conservative
  // scope): their existing implicit confirmation (the new/changed row
  // becoming visible in the refreshed list) already satisfies this.
  // Cleared on any new navigation/interaction so it never lingers past
  // its relevance.
  var successMessage = null;

  // Painel Master Phase PM-4B.3 -- link generation (Gate 13/14 security
  // discipline): the raw link exists ONLY in this in-memory variable,
  // never in the URL, never logged, never in localStorage/sessionStorage.
  // Cleared aggressively at every navigation boundary (openUserModal/
  // closeUserModal/switchSection/page unload) -- same discipline as V1's
  // own limparLinkAcessoGerado(), never left lingering.
  var generatedLink = null; // { tipo, link } | null
  window.addEventListener('beforeunload', function () { generatedLink = null; });
  // Gate 21/26 (PM-4B.3), generalized Phase PM-4B.4: registered ONCE at
  // module scope (not inside wireInteraction(), which runs on every
  // render and would stack duplicate listeners) -- Esc closes whichever
  // #nxModalRoot dialog is currently open (Auditoria or Usuários), from
  // anywhere while it's open.
  document.addEventListener('keydown', function (e) { nxModalKeydown(e); });

  var SUCCESS_COPY = {
    toggleActive: { active: 'Usuário reativado com sucesso.', inactive: 'Usuário bloqueado com sucesso.' },
    resend: 'Convite reenviado com sucesso.'
  };

  // Gate 22 error-state vocabulary (transport-level, from the
  // provider's classifyError) + Gate 6 client-side VALIDATION_ERROR
  // (never sent to the RPC at all).
  var STATE_COPY = {
    AUTH_DENIED: { title: 'Sem permissão', body: 'Sua conta não tem acesso a esta área.' },
    SESSION_EXPIRED: { title: 'Sessão expirada', body: 'Entre novamente para continuar.' },
    RPC_ERROR: { title: 'Não foi possível concluir', body: 'Não foi possível concluir a operação agora. Tente novamente.' },
    NETWORK_ERROR: { title: 'Falha de rede', body: 'Verifique sua conexão e tente novamente.' },
    TIMEOUT: { title: 'Tempo excedido', body: 'A resposta demorou demais. Tente novamente.' },
    MALFORMED_RESPONSE: { title: 'Não foi possível carregar', body: 'Resposta inesperada do servidor.' },
    VALIDATION_ERROR: { title: 'Dados inválidos', body: 'Verifique os campos destacados.' },
    DUPLICATE_USER: { title: 'Usuário já existe', body: 'Já existe um cadastro com este CPF ou e-mail.' },
    CONFLICT: { title: 'Não foi possível concluir', body: 'Esta ação não pode ser concluída no estado atual do cadastro.' }
  };
  function errorStateHtml(state, message) {
    // V2-SECURITY-02 (SEC-06): this is the single shared error-render
    // chokepoint for every section of Painel Master (Usuários, Acessos,
    // Pendências, Gestão de Bases/Simuladores, Configurações, Períodos,
    // Ausências, Mudança de Loja, ...) -- the natural place to delegate
    // a genuinely classified SESSION_EXPIRED to Auth Foundation's
    // established handling instead of only showing a local message,
    // without touching every section's own catch block individually.
    if (state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
      window.NX_AUTH_CORE.reportSessionExpired();
    }
    var copy = STATE_COPY[state] || STATE_COPY.RPC_ERROR;
    return '<div class="modErrorState"><div class="modStateTitle">' + esc(copy.title) + '</div>' + esc(copy.body) + '</div>';
  }
  function loadingHtml() {
    return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando usuários...</div>';
  }

  function rowById(id) {
    return usersRows.filter(function (r) { return r.id === id; })[0] || null;
  }

  // ---------- filtering (Gate 13: client-side over the one fully-
  // authorized dataset the RPC already returns — same technique V1
  // itself uses, confirmed equivalent in Phase 0/1's audit) ----------
  function filteredRows() {
    var q = searchQuery.trim().toLowerCase();
    return usersRows.filter(function (r) {
      if (filterPerfil && r.perfil !== filterPerfil) return false;
      if (filterLoja && r.loja !== filterLoja) return false;
      if (filterStatus === 'ATIVO' && !r.ativo) return false;
      if (filterStatus === 'INATIVO' && r.ativo) return false;
      if (q && r.nome.toLowerCase().indexOf(q) === -1 && r.emailAuth.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  // ---------- data load (Gate 41: the one real read-only call) ----------
  function loadUsers() {
    if (currentAbortController) currentAbortController.abort();
    var controller = new AbortController();
    currentAbortController = controller;
    var mySeq = ++renderSeq;
    loadError = null;
    isLoading = true;
    renderPanel();

    window.NX_MASTER_USERS_PROVIDER.loadMasterUsersData({ signal: controller.signal }).then(
      function (payload) {
        if (mySeq !== renderSeq) return;
        isLoading = false;
        var vm = window.NX_MASTER_USERS_VIEW_MODEL.buildUsersViewModel(payload);
        usersRows = vm.rows;
        renderPanel();
      },
      function (err) {
        if (mySeq !== renderSeq) return;
        if (err && err.state === 'ABORTED') return;
        isLoading = false;
        loadError = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  // ---------- lifecycle badges (Phase 2C, Gate 1/3/5 human UAT fix):
  // invite/auth lifecycle and administrative active/blocked state are
  // two INDEPENDENT dimensions in the real contract (proven: a real
  // block succeeds and audits correctly against a user whose invite
  // lifecycle is still INVITED) -- always render BOTH, never let one
  // hide the other. ----------
  function inviteBadgeHtml(lifecycle) {
    var cls = {
      INVITED: 'maBadgeInvited', AUTH_CREATED_UNCONFIRMED: 'maBadgeInvited',
      FIRST_ACCESS_PENDING: 'maBadgePending', ACCEPTED: 'maBadgeActive'
    }[lifecycle.state] || 'maBadgeInvited';
    return '<span class="maBadge ' + cls + '">' + esc(lifecycle.label) + '</span>';
  }
  function adminBadgeHtml(adminState) {
    var cls = adminState.state === 'ACTIVE' ? 'maBadgeActive' : 'maBadgeInactive';
    return '<span class="maBadge ' + cls + '">' + esc(adminState.label) + '</span>';
  }
  function situationBadgesHtml(r) {
    return inviteBadgeHtml(r.lifecycle) + ' ' + adminBadgeHtml(r.adminState);
  }

  function rowKey(r) { return r.id; }

  // ---------- list rendering (desktop table + mobile cards, Score's
  // established dual-renderer pattern — one `rows` array, two views,
  // exactly one visible via CSS) ----------
  function renderDesktopTable(rows) {
    var body = rows.map(function (r) {
      return '<tr tabindex="0" role="button" data-key="' + esc(rowKey(r)) + '" aria-label="Ver detalhes de ' + esc(r.nome) + '">' +
        '<td class="maNameCell"><div class="maNameCellInner">' + esc(r.nome) + '<div class="maSubtle">' + esc(r.emailAuth) + '</div></div></td>' +
        '<td>' + esc(r.perfil) + '</td>' +
        '<td>' + esc(r.loja || '—') + '</td>' +
        '<td>' + esc(r.status || '—') + '</td>' +
        '<td class="maSituacaoCell"><div class="maSituacaoCellInner">' + situationBadgesHtml(r) + '</div></td>' +
        '</tr>';
    }).join('');
    return '<div class="maDesktopOnly"><div class="modTableWrap"><table class="modTable maTable">' +
      '<thead><tr><th scope="col">Usuário</th><th scope="col">Perfil</th><th scope="col">Loja</th><th scope="col">Status</th><th scope="col">Situação</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }
  function renderMobileCards(rows) {
    var cards = rows.map(function (r) {
      return '<div class="maMobileCard" tabindex="0" role="button" data-key="' + esc(rowKey(r)) + '" aria-label="Ver detalhes de ' + esc(r.nome) + '">' +
        '<div class="maMobileName">' + esc(r.nome) + '</div>' +
        '<div class="maSubtle">' + esc(r.emailAuth) + '</div>' +
        '<div class="maMobileMeta">' + esc(r.perfil) + ' · ' + esc(r.loja || '—') + ' · ' + esc(r.status || '—') + '</div>' +
        situationBadgesHtml(r) +
        '</div>';
    }).join('');
    return '<div class="maMobileOnly">' + cards + '</div>';
  }
  function renderList() {
    var rows = filteredRows();
    var tableHtml;
    if (!rows.length) {
      tableHtml = '<div class="modEmptyState"><div class="modStateTitle">Nenhum usuário encontrado</div>Ajuste a busca ou os filtros.</div>';
    } else {
      tableHtml = renderDesktopTable(rows) + renderMobileCards(rows);
    }
    var perfilOptions = ['<option value="">Todos os perfis</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.PERFIL_VALUES.map(function (p) { return '<option value="' + esc(p) + '"' + (p === filterPerfil ? ' selected' : '') + '>' + esc(p) + '</option>'; })
    ).join('');
    var lojaOptions = ['<option value="">Todas as lojas</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.LOJA_VALUES.map(function (l) { return '<option value="' + esc(l) + '"' + (l === filterLoja ? ' selected' : '') + '>' + esc(l) + '</option>'; })
    ).join('');
    return '<div class="modFilters">' +
      '<div class="modField"><label for="maSearch">Buscar</label><input id="maSearch" type="text" value="' + esc(searchQuery) + '" placeholder="Nome ou e-mail"></div>' +
      '<div class="modField"><label for="maFilterPerfil">Perfil</label><select id="maFilterPerfil">' + perfilOptions + '</select></div>' +
      '<div class="modField"><label for="maFilterLoja">Loja</label><select id="maFilterLoja">' + lojaOptions + '</select></div>' +
      '<div class="modField"><label for="maFilterStatus">Situação</label><select id="maFilterStatus">' +
      '<option value=""' + (!filterStatus ? ' selected' : '') + '>Todos</option>' +
      '<option value="ATIVO"' + (filterStatus === 'ATIVO' ? ' selected' : '') + '>Ativos</option>' +
      '<option value="INATIVO"' + (filterStatus === 'INATIVO' ? ' selected' : '') + '>Inativos</option>' +
      '</select></div>' +
      '</div>' + tableHtml;
  }

  // ---------- detail / edit ----------
  function fieldRow(label, value) {
    return '<div class="maDetailField"><span class="maDetailLabel">' + esc(label) + '</span><span class="maDetailValue">' + esc(value) + '</span></div>';
  }
  // Painel Master Phase PM-4B.4 (Human UAT finding: same UX class of
  // defect already found and fixed in Auditoria at PM-4B.3 -- clicking a
  // user rendered its detail at the end of the (possibly long) user
  // list, forcing a scroll and losing list context). The below-list
  // detail surface (formerly its own "<div class=maDetail id=maDetail>"
  // wrapper with its own head/Fechar button) is RETIRED -- this function
  // now returns only the INNER content, rendered inside the shared
  // #nxModalRoot dialog (renderNxModal() below already supplies the
  // head/title/close button, exactly as it already does for Auditoria).
  // ONE modal pattern for both sections (Gate 4), not two parallel ones.
  function isDetailConfirmKind(kind) {
    return kind === 'edit' || kind === 'toggleActive' || kind === 'resend' || kind === 'generateAccessLink';
  }
  function renderUserModalBody(r) {
    var out = '';
    // Gate 13 (PM-4B.4): the explicit success feedback established at
    // Phase 2C (a real human-UAT fix) must not silently disappear now
    // that mutations are triggered from inside the modal -- shown here,
    // inside the dialog, instead of in the list panel sitting behind
    // the modal backdrop where it would render and self-clear unseen.
    if (successMessage) {
      out += '<div class="modSuccessState" role="status">' + esc(successMessage) + '</div>';
      successMessage = null;
    }
    var editing = editForm && editForm.id === r.id;
    if (editing) {
      out += renderEditForm(r);
    } else {
      out += fieldRow('Nome', r.nome) + fieldRow('E-mail', r.emailAuth) + fieldRow('CPF', r.cpfMasked) +
        fieldRow('Perfil', r.perfil) + fieldRow('Loja', r.loja || '—') + fieldRow('Departamento', r.status || '—') +
        '<div class="maDetailField"><span class="maDetailLabel">Situação</span>' + situationBadgesHtml(r) + '</div>' +
        (r.emailDivergente ? '<p class="maWarnNote">O e-mail de autenticação diverge do e-mail cadastrado.</p>' : '') +
        '<div class="maDetailActions">' +
        '<button type="button" class="modBtn" id="maEditBtn">Editar autorização</button>' +
        '<button type="button" class="modBtn' + (r.ativo ? ' modBtnDanger' : '') + '" id="maToggleActiveBtn">' + (r.ativo ? 'Bloquear' : 'Reativar') + '</button>' +
        (r.conviteId ? '<button type="button" class="modBtn" id="maResendBtn">Reenviar convite</button>' : '') +
        (r.accessLinkAction ? '<button type="button" class="modBtn" id="maGenerateLinkBtn">' + esc(r.accessLinkAction.label) + '</button>' : '') +
        '</div>';
    }
    out += renderGeneratedLinkPanel();
    if (pendingConfirm && isDetailConfirmKind(pendingConfirm.kind)) {
      out += confirmHtml(pendingConfirm.title, pendingConfirm.body, pendingConfirm.confirmLabel, pendingConfirm.destructive, pendingConfirm.bodyHtml, pendingConfirm.error);
    }
    return out;
  }

  // Painel Master Phase PM-4B.3 -- the generated link is shown exactly
  // once, in its own panel (never auto-copied, Gate 14), with an
  // explicit "Copiar link" action. Matches V1's own real two-step UX
  // (Gerar link -> resultado temporário -> Copiar link) rather than
  // inventing a new one.
  var ACCESS_LINK_TITULO = { activation: 'ativação', recovery: 'recuperação', continuation: 'continuação de acesso' };
  function renderGeneratedLinkPanel() {
    if (!generatedLink) return '';
    var titulo = ACCESS_LINK_TITULO[generatedLink.tipo] || 'acesso';
    return '<div class="maConfirm" role="alertdialog" aria-labelledby="maLinkTitle">' +
      '<h3 id="maLinkTitle">Link de ' + esc(titulo) + ' gerado com sucesso</h3>' +
      '<p class="maWarnNote">Este link é confidencial e será exibido somente agora. Compartilhe apenas com o próprio usuário.</p>' +
      '<div class="modField"><label for="maGeneratedLinkInput">Link</label><input id="maGeneratedLinkInput" type="text" readonly value="' + esc(generatedLink.link) + '" onclick="this.select()"></div>' +
      '<p class="maSubtle" id="maLinkCopyMsg" role="status"></p>' +
      '<div class="maDetailActions">' +
      '<button type="button" class="modBtn" id="maCopyLinkBtn">Copiar link</button>' +
      '<button type="button" class="modBtnGhost" id="maCloseLinkPanel">Fechar</button>' +
      '</div></div>';
  }

  function renderEditForm(r) {
    var perfilOptions = window.NX_MASTER_USERS_VIEW_MODEL.PERFIL_VALUES.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === editForm.perfil ? ' selected' : '') + '>' + esc(p) + '</option>';
    }).join('');
    var lojaOptions = ['<option value="">—</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.LOJA_VALUES.map(function (l) { return '<option value="' + esc(l) + '"' + (l === editForm.loja ? ' selected' : '') + '>' + esc(l) + '</option>'; })
    ).join('');
    var statusOptions = ['<option value="">—</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.STATUS_VALUES.map(function (s) { return '<option value="' + esc(s) + '"' + (s === editForm.status ? ' selected' : '') + '>' + esc(s) + '</option>'; })
    ).join('');
    return '<form id="maEditForm" novalidate>' +
      '<div class="modField"><label for="maEditPerfil">Perfil</label><select id="maEditPerfil">' + perfilOptions + '</select></div>' +
      '<div class="modField"><label for="maEditLoja">Loja</label><select id="maEditLoja">' + lojaOptions + '</select></div>' +
      '<div class="modField"><label for="maEditStatus">Departamento</label><select id="maEditStatus">' + statusOptions + '</select></div>' +
      (editForm.error ? '<p class="maFieldError" role="alert">' + esc(editForm.error) + '</p>' : '') +
      '<div class="maDetailActions">' +
      '<button type="submit" class="modBtn" id="maEditSubmit"' + (inFlight.edit ? ' disabled' : '') + '>Salvar alterações</button>' +
      '<button type="button" class="modBtnGhost" id="maEditCancel">Cancelar</button>' +
      '</div></form>';
  }

  // ---------- create/invite ----------
  function emptyCreateForm() {
    return { cpf: '', nome: '', perfil: '', loja: '', email: '', nbs: '', status: '', error: null };
  }
  function renderCreateView() {
    var f = createForm;
    var perfilOptions = ['<option value="">Selecione...</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.PERFIL_VALUES.map(function (p) { return '<option value="' + esc(p) + '"' + (p === f.perfil ? ' selected' : '') + '>' + esc(p) + '</option>'; })
    ).join('');
    var lojaOptions = ['<option value="">—</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.LOJA_VALUES.map(function (l) { return '<option value="' + esc(l) + '"' + (l === f.loja ? ' selected' : '') + '>' + esc(l) + '</option>'; })
    ).join('');
    var statusRequired = window.NX_MASTER_USERS_VIEW_MODEL.STATUS_REQUIRED_PROFILES.indexOf(f.perfil) !== -1;
    var statusOptions = ['<option value="">Selecione...</option>'].concat(
      window.NX_MASTER_USERS_VIEW_MODEL.STATUS_VALUES.map(function (s) { return '<option value="' + esc(s) + '"' + (s === f.status ? ' selected' : '') + '>' + esc(s) + '</option>'; })
    ).join('');
    return '<div class="maDetail" id="maCreateView">' +
      '<div class="maDetailHead"><h2>Novo usuário</h2><button type="button" class="modBtnGhost" id="maCreateCancel">Cancelar</button></div>' +
      '<form id="maCreateForm" novalidate>' +
      '<div class="modField"><label for="maCpf">CPF</label><input id="maCpf" type="text" value="' + esc(f.cpf) + '" inputmode="numeric"></div>' +
      '<div class="modField"><label for="maNome">Nome</label><input id="maNome" type="text" value="' + esc(f.nome) + '"></div>' +
      '<div class="modField"><label for="maPerfil">Perfil</label><select id="maPerfil">' + perfilOptions + '</select></div>' +
      '<div class="modField"><label for="maLoja">Loja</label><select id="maLoja">' + lojaOptions + '</select></div>' +
      '<div class="modField"><label for="maEmail">E-mail</label><input id="maEmail" type="email" value="' + esc(f.email) + '"></div>' +
      '<div class="modField"><label for="maNbs">Login NBS (opcional)</label><input id="maNbs" type="text" value="' + esc(f.nbs) + '"></div>' +
      (statusRequired ? '<div class="modField"><label for="maStatus">Departamento</label><select id="maStatus">' + statusOptions + '</select></div>' : '') +
      (f.error ? '<p class="maFieldError" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="maDetailActions">' +
      '<button type="submit" class="modBtn" id="maCreateSubmit"' + (inFlight.invite ? ' disabled' : '') + '>Convidar usuário</button>' +
      '</div></form></div>';
  }

  // ---------- confirmation step (inline, two-step reveal — no modal
  // primitive exists yet in this codebase; Gate 10 forbids introducing
  // a new parallel component for this alone) ----------
  function confirmHtml(title, body, confirmLabel, destructive, bodyHtml, errorMsg) {
    return '<div class="maConfirm" role="alertdialog" aria-labelledby="maConfirmTitle">' +
      '<h3 id="maConfirmTitle">' + esc(title) + '</h3>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      (bodyHtml || '') +
      (errorMsg ? '<p class="maFieldError" role="alert">' + esc(errorMsg) + '</p>' : '') +
      '<div class="maDetailActions">' +
      '<button type="button" class="modBtn' + (destructive ? ' modBtnDanger' : '') + '" id="maConfirmYes">' + esc(confirmLabel) + '</button>' +
      '<button type="button" class="modBtnGhost" id="maConfirmNo">Cancelar</button>' +
      '</div></div>';
  }

  // ---------- section nav (Gate 9: structure ready for future
  // clusters without rewrite) ----------
  // Painel Master Phase PM-4C.2: the disabled "Revisões Cadastrais"
  // placeholder is retired here (presentation-only change, shell-
  // admin.js's own nav array -- no registry/navigation surface outside
  // this file was involved) -- the human product decision that it is
  // permanently superseded by Pendências Cadastrais (PM-4C.1) is now
  // explicit, so a disabled "coming soon" placeholder implying a future
  // build would be actively misleading. No second Revisões section is
  // added back, per this Phase's own Gate 2/15.
  // Painel Master Phase PM-5C: 'gestaoBases' inserted BEFORE 'pendenciasCadastrais',
  // not after -- Gate 27's own recommended ordering. Gestão de Bases is
  // upstream data ingestion (it is what POPULATES the reconciliation
  // signals); Pendências Cadastrais is the downstream queue that reviews
  // exactly those signals. Identity/access sections (Usuários/Acessos)
  // stay first, Auditoria (a pure read-only log of everything) stays last.
  // Painel Master Phase PM-5D: 'gestaoSimuladores' placed immediately
  // after 'gestaoBases' -- the two are sibling upstream-data-management
  // capabilities (file-upload -> dry-run diff -> confirm, same shared UI
  // architecture), grouped together ahead of the reconciliation queue
  // and the read-only audit log.
  // Painel Master Phase PM-5E: 'configuracoes' and 'periodosComissao'
  // inserted right after Acessos aos Módulos, before the two "Gestão de
  // X" data-management capabilities -- confirmed INDEPENDENT of each
  // other (no shared table, no shared RPC argument, PM-5E Gate 22) so
  // they are two distinct sections here, never merged into one screen.
  // Ordering groups "portal control/settings" (Acessos, Configurações,
  // Períodos) ahead of "data management" (Gestão de Bases/Simuladores)
  // ahead of "governance/audit" (Pendências, Auditoria).
  // Painel Master Phase PM-5F: 'feriasAusencias' and 'mudancaLoja'
  // inserted right after Períodos de Comissão, before the two "Gestão
  // de X" data-catalog capabilities -- grouped with Períodos as the
  // third and fourth "personnel/temporal tracking" capabilities (all
  // three share the same master_admin_manage/master_admin_reference_
  // data dispatcher pair), ahead of the data-ingestion capabilities.
  var SECTIONS = [
    { id: 'usuarios', label: 'Usuários', active: true },
    { id: 'acessos', label: 'Acessos aos Módulos', active: true },
    { id: 'configuracoes', label: 'Configurações', active: true },
    { id: 'periodosComissao', label: 'Períodos de Comissão', active: true },
    { id: 'feriasAusencias', label: 'Férias/Ausências', active: true },
    { id: 'mudancaLoja', label: 'Mudança de Loja - Vendedores', active: true },
    { id: 'gestaoBases', label: 'Gestão de Bases', active: true },
    { id: 'gestaoSimuladores', label: 'Gestão dos Simuladores', active: true },
    { id: 'utilizacaoSimuladores', label: 'Utilização dos Simuladores', active: true },
    // Painel Master Phase PM-5H: grouped with Períodos de Comissão
    // (same "competência" domain), positioned right after it -- NOT
    // adjacent to a "Fechamento de Competência" entry, since that
    // capability remains COMPETENCE_CLOSING_CONTRACT_RECONCILED_
    // IMPLEMENTATION_BLOCKED (PM-5G) and is deliberately NOT added here
    // as a disabled/fake placeholder (Gate 18: "não adicionar botão
    // falso/inativo de Fechamento apenas para completar navegação").
    // Painel Master Phase PM-5J: engine authority/parity reconciled
    // (PM-5I) and full-payload parity proven (PM-5J) -- positioned
    // right after Períodos de Comissão, before Histórico (its own
    // natural read consumer). This screen only ever offers PRÉVIA +
    // FECHAR, never Reabrir -- reabertura is a Histórico action instead
    // (PM-5K-RETRY, master_reopen_commission_period's server-side
    // authority now reconciled via live pg_get_functiondef).
    { id: 'fechamentoCompetencia', label: 'Fechamento de Competência', active: true },
    { id: 'historicoCompetencias', label: 'Histórico de Competências', active: true },
    { id: 'pendenciasCadastrais', label: 'Pendências Cadastrais', active: true },
    { id: 'auditoria', label: 'Auditoria', active: true }
  ];
  function sectionNavHtml() {
    return '<nav class="maSectionNav" aria-label="Áreas administrativas">' + SECTIONS.map(function (s) {
      if (!s.active) {
        return '<span class="maSectionItem maSectionItemDisabled" aria-disabled="true">' + esc(s.label) + ' <span class="maSectionSoon">Em breve</span></span>';
      }
      if (s.id === currentSection) {
        return '<span class="maSectionItem maSectionItemActive" aria-current="page">' + esc(s.label) + '</span>';
      }
      return '<button type="button" class="maSectionItem maSectionItemLink" data-section="' + esc(s.id) + '">' + esc(s.label) + '</button>';
    }).join('') + '</nav>';
  }

  // Gate 13 -- tab/route exit protection. Uses the SAME in-page confirm
  // pattern as every other confirmation in this file (never a native
  // confirm()/alert(), and never an inescapable modal loop: Cancelar
  // always returns to the current section untouched).
  function requestSectionSwitch(targetId) {
    if (targetId === currentSection) return;
    if (currentSection === 'acessos' && acessosState.dirty && !acessosState.saving) {
      pendingConfirm = {
        kind: 'discardAcessosAndSwitch', targetSection: targetId,
        title: 'Descartar alterações de acesso?',
        body: 'Existem alterações de acesso não salvas. Elas serão descartadas se você sair desta seção agora.',
        confirmLabel: 'Descartar e sair', destructive: true
      };
      renderPanel();
      return;
    }
    switchSection(targetId);
  }

  function switchSection(targetId) {
    currentSection = targetId;
    currentDetailId = null;
    editForm = null;
    pendingConfirm = null;
    successMessage = null;
    generatedLink = null;
    auditDetailId = null;
    pcDetailId = null;
    gbState.modal = null;
    gsState.modal = null;
    cfgState.modal = null;
    prState.modal = null;
    absState.modal = null;
    scState.modal = null;
    suState.drawerUserId = null;
    historyState.detail = null;
    historyState.exportingId = null;
    historyState.exportError = null;
    historyState.reopenModalOpen = false;
    historyState.reopenClosing = null;
    historyState.reopenError = null;
    historyState.rhdpExportingId = null;
    historyState.rhdpErrorByClosingId = {};
    historyState.printOpeningId = null;
    historyState.printErrorByClosingId = {};
    closingState.preview = null;
    closingState.previewToken = null;
    closingState.confirmOpen = false;
    closingState.closeError = null;
    closingState.successResult = null;
    // Never leave either section's modal open behind a section switch --
    // a blunt clear (no focus-return) is correct here, since the trigger
    // row itself is about to be discarded along with the whole section.
    clearNxModal();
    nxModalTriggerEl = null;
    var newUserBtn = document.getElementById('maNewUserBtn');
    if (newUserBtn) newUserBtn.hidden = (currentSection !== 'usuarios');
    if (currentSection === 'acessos') {
      acessosEnter();
    } else if (currentSection === 'auditoria') {
      auditEnter();
    } else if (currentSection === 'pendenciasCadastrais') {
      pcEnter();
    } else if (currentSection === 'gestaoBases') {
      gbEnter();
    } else if (currentSection === 'gestaoSimuladores') {
      gsEnter();
    } else if (currentSection === 'configuracoes') {
      cfgEnter();
    } else if (currentSection === 'periodosComissao') {
      prEnter();
    } else if (currentSection === 'feriasAusencias') {
      absEnter();
    } else if (currentSection === 'mudancaLoja') {
      scEnter();
    } else if (currentSection === 'utilizacaoSimuladores') {
      suEnter();
    } else if (currentSection === 'historicoCompetencias') {
      historyEnter();
    } else if (currentSection === 'fechamentoCompetencia') {
      closingEnter();
    } else {
      renderPanel();
    }
  }

  // ---------- Acessos aos Módulos (Painel Master Phase 3B) ----------

  // Gate 11: on section activation -- paint loading, call the real RPC,
  // validate response (provider already rejects MALFORMED_RESPONSE),
  // build the closed matrix, retain each cell's original permitido +
  // atualizado_em, establish a clean baseline, only then allow editing.
  // FAILS CLOSED: on any error, no matrix is rendered at all (Gate 11) --
  // never a synthesized/partial one.
  function acessosEnter() {
    if (acessosState.loaded || acessosState.loading) { renderPanel(); return; }
    acessosLoad();
  }

  function acessosLoad() {
    acessosState.loading = true;
    acessosState.error = null;
    renderPanel();
    window.NX_MASTER_ACESSOS_PROVIDER.loadAccessMatrix({}).then(
      function (payload) {
        var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL.buildMatrixState(payload);
        acessosState.modules = vm.modules;
        acessosState.serverSnapshot = vm.serverSnapshot;
        acessosState.serverUpdatedAt = vm.serverUpdatedAt;
        acessosState.localPermissions = vm.localPermissions;
        acessosState.dirty = false;
        acessosState.loading = false;
        acessosState.loaded = true;
        renderPanel();
      },
      function (err) {
        acessosState.loading = false;
        acessosState.loaded = false;
        acessosState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function acessosCheckbox(moduleId, col) {
    var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL;
    var key = vm.cellKey(moduleId, col.perfil, col.departamento);
    var checked = acessosState.localPermissions[key] ? ' checked' : '';
    var label = vm.moduleLabel(moduleId) + ' — ' + vm.columnLabel(col.perfil, col.departamento);
    return '<input type="checkbox" class="mamCell" data-module="' + esc(moduleId) +
      '" data-perfil="' + esc(col.perfil) + '" data-departamento="' + esc(col.departamento) +
      '" aria-label="' + esc(label) + '"' + checked + (acessosState.saving ? ' disabled' : '') + '>';
  }

  function availBadgeHtml(avail) {
    return '<div class="mamAvailBadge mamAvail' + esc(avail.state) + '">' + esc(avail.label) + '</div>';
  }

  function renderAcessosDesktopTable() {
    var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL;
    var headCols = vm.COLUMNS.map(function (c) {
      return '<th scope="col">' + esc(c.label) + (c.sub ? '<br><span class="mamColSub">' + esc(c.sub) + '</span>' : '') + '</th>';
    }).join('');
    var rows = acessosState.modules.map(function (m) {
      var cells = vm.COLUMNS.map(function (c) { return '<td class="mamCellTd">' + acessosCheckbox(m.id, c) + '</td>'; }).join('');
      return '<tr><td class="mamRowLabel">' + esc(vm.moduleLabel(m.id)) + availBadgeHtml(vm.availabilityFor(m.id)) + '</td>' + cells + '</tr>';
    }).join('');
    return '<div class="maDesktopOnly"><div class="modTableWrap"><table class="modTable mamTable">' +
      '<thead><tr><th scope="col">Módulo</th>' + headCols + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function renderAcessosMobileCards() {
    var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL;
    var cards = acessosState.modules.map(function (m) {
      var scopes = vm.COLUMNS.map(function (c) {
        return '<label class="mamMobileScopeRow">' + acessosCheckbox(m.id, c) + '<span>' + esc(vm.columnLabel(c.perfil, c.departamento)) + '</span></label>';
      }).join('');
      return '<div class="mamMobileCard"><div class="mamMobileCardHead"><span class="mamModuleLabel">' + esc(vm.moduleLabel(m.id)) + '</span>' +
        availBadgeHtml(vm.availabilityFor(m.id)) + '</div>' + scopes + '</div>';
    }).join('');
    return '<div class="maMobileOnly">' + cards + '</div>';
  }

  function renderAcessosSection() {
    if (acessosState.error) {
      return errorStateHtml(acessosState.error.state, acessosState.error.message) +
        '<div class="maDetailActions"><button type="button" class="modBtn" id="mamRetryBtn">Tentar novamente</button></div>';
    }
    if (acessosState.loading || !acessosState.loaded) {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando permissões dos módulos...</div>';
    }
    var html = '';
    if (acessosState.successMessage) {
      html += '<div class="modSuccessState" role="status">' + esc(acessosState.successMessage) + '</div>';
      acessosState.successMessage = null;
    }
    if (acessosState.conflictMessage) {
      html += '<div class="modErrorState"><div class="modStateTitle">Alterações em outra sessão</div>' + esc(acessosState.conflictMessage) + '</div>';
      acessosState.conflictMessage = null;
    }
    html += '<p class="modSubtitle">Defina quais módulos ficam disponíveis para cada perfil. Alterações de acesso não modificam o escopo de dados permitido dentro de cada módulo.</p>';
    html += '<div class="mamMasterNotice">🔒 <b>MASTER</b> possui acesso permanente aos módulos configuráveis e não pode ser restringido por esta configuração.</div>';
    if (acessosState.dirty) {
      html += '<div class="mamDirtyBanner">Alterações não salvas — o banco de dados continua com os valores originais.</div>';
    }
    html += renderAcessosDesktopTable() + renderAcessosMobileCards();
    html += '<div class="maDetailActions">' +
      '<button type="button" class="modBtnGhost" id="mamDiscardBtn"' + ((!acessosState.dirty || acessosState.saving) ? ' disabled' : '') + '>Descartar alterações</button>' +
      '<button type="button" class="modBtn" id="mamSaveBtn"' + ((!acessosState.dirty || acessosState.saving) ? ' disabled' : '') + '>' + (acessosState.saving ? 'Salvando...' : 'Salvar permissões') + '</button>' +
      '</div>';
    return html;
  }

  function acessosDiscard() {
    if (acessosState.saving) return;
    acessosState.localPermissions = Object.assign({}, acessosState.serverSnapshot);
    acessosState.dirty = false;
    renderPanel();
  }

  // Gate 14: confirmation generated from the delta only.
  function acessosOpenSaveConfirm() {
    if (acessosState.saving) return;
    var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL;
    var delta = vm.buildDelta(acessosState.localPermissions, acessosState.serverSnapshot, acessosState.serverUpdatedAt);
    if (!delta.length) return; // Gate 12: zero-delta cannot save
    pendingConfirm = {
      kind: 'saveAcessos', delta: delta,
      title: 'Salvar permissões de acesso?',
      body: '', bodyHtml: '<div class="mamConfirmSummary">' + vm.buildConfirmSummaryHtml(delta) + '</div>',
      confirmLabel: 'Confirmar alterações', destructive: false
    };
    renderPanel();
  }

  // Gate 16/17: single in-flight save; on resolution ALWAYS reload the
  // canonical matrix from the backend (never assume local=banco, never
  // silently overwrite on conflict) and classify the outcome precisely
  // (Gate 17: all-applied / all-conflict / partial).
  function acessosExecuteSave(delta) {
    if (inFlight.saveAcessos) return;
    inFlight.saveAcessos = true;
    acessosState.saving = true;
    renderPanel();

    window.NX_MASTER_ACESSOS_PROVIDER.saveAccessChanges(delta, {}).then(
      function (result) {
        var aplicadas = result.aplicadas || [];
        var conflitos = result.conflitos || [];
        acessosState.loaded = false;
        window.NX_MASTER_ACESSOS_PROVIDER.loadAccessMatrix({}).then(
          function (payload) {
            var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL.buildMatrixState(payload);
            acessosState.modules = vm.modules;
            acessosState.serverSnapshot = vm.serverSnapshot;
            acessosState.serverUpdatedAt = vm.serverUpdatedAt;
            acessosState.localPermissions = vm.localPermissions;
            acessosState.dirty = false;
            acessosState.loaded = true;
            acessosState.saving = false;
            inFlight.saveAcessos = false;
            pendingConfirm = null;
            if (conflitos.length === 0) {
              acessosState.successMessage = aplicadas.length + ' permissão(ões) salva(s) com sucesso.';
            } else if (aplicadas.length === 0) {
              acessosState.conflictMessage = 'Nenhuma alteração foi salva — estas permissões foram alteradas em outra sessão. A matriz foi recarregada com os valores mais recentes; revise e tente novamente se necessário.';
            } else {
              acessosState.conflictMessage = aplicadas.length + ' alteração(ões) aplicada(s); ' + conflitos.length + ' não puderam ser aplicadas porque foram alteradas em outra sessão. A matriz foi recarregada — revise o estado atual antes de tentar novamente.';
            }
            renderPanel();
          },
          function (err) {
            // Save itself succeeded server-side; the confirming reload
            // failed. Never claim a stale local state is current --
            // force the section back to its loading/error path instead
            // of silently trusting pre-save local values.
            acessosState.loaded = false;
            acessosState.saving = false;
            inFlight.saveAcessos = false;
            pendingConfirm = null;
            acessosState.error = err || { state: 'RPC_ERROR' };
            renderPanel();
          }
        );
      },
      function (err) {
        acessosState.saving = false;
        inFlight.saveAcessos = false;
        pendingConfirm = null;
        acessosState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  // ---------- Auditoria (Painel Master Phase PM-4B) ----------
  // READ-ONLY -- no filters/search/period exist here on purpose: the
  // real V1 "Auditoria" tab has none either (direct source read,
  // portal-app.js's own MASTER_TAB==='auditoria' branch), so none are
  // added here "for convenience" (Gate 16's own explicit instruction).

  function auditEnter() {
    if (auditState.loaded || auditState.loading) { renderPanel(); return; }
    auditLoad();
  }

  function auditLoad() {
    auditState.loading = true;
    auditState.error = null;
    renderPanel();
    window.NX_MASTER_AUDIT_PROVIDER.loadAuditData({}).then(
      function (payload) {
        var vm = window.NX_MASTER_AUDIT_VIEW_MODEL.buildAuditViewModel(payload);
        auditState.rows = vm.rows;
        auditState.loading = false;
        auditState.loaded = true;
        renderPanel();
      },
      function (err) {
        auditState.loading = false;
        auditState.loaded = false;
        auditState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function auditRowById(id) {
    // Real contract confirmed live: auditoria.id is a uuid (not the
    // bigint this file first assumed) -- compared as strings regardless,
    // so this works either way and never silently fails to match.
    return auditState.rows.filter(function (r) { return String(r.id) === String(id); })[0] || null;
  }

  function auditBadgeHtml(r) {
    var cls = r.resolvido ? 'maBadgeActive' : 'maBadgeInactive';
    return '<span class="maBadge ' + cls + '">' + esc(r.resolvidoLabel) + '</span>';
  }

  // Painel Master Phase PM-4B.1 (Human UAT finding): PM-4B's table
  // relied on an invisible whole-row click (tabindex/role=button, no
  // affordance) -- confirmed against real V1 source this Phase that V1's
  // OWN Auditoria list already renders an explicit, visible "Ver
  // detalhes" button per row (portal-app.js's adminListActions/
  // abrirDetalheAuditoria). This was a real parity gap, not just a UX
  // nicety -- restoring V1's own real affordance, in the V2 design
  // system's own button convention (.modBtnGhost; no icon system exists
  // anywhere in this codebase, so a text button is the actual "already
  // belonging to the design system" choice, not a new one). The row/
  // card click is PRESERVED (Gate 6/PM-4B.1) -- both paths call the
  // exact same auditDetailId assignment, never two different flows.
  function auditDetailBtnHtml(r) {
    return '<button type="button" class="modBtnGhost maudDetailBtn" data-key="' + esc(r.id) + '" aria-label="Ver detalhes do evento ' + esc(r.tipo) + '" title="Ver detalhes do evento ' + esc(r.tipo) + '">Ver detalhes</button>';
  }

  function renderAuditDesktopTable(rows) {
    var body = rows.map(function (r) {
      return '<tr class="maudRow" tabindex="0" role="button" data-key="' + esc(r.id) + '" aria-label="Ver detalhes do evento ' + esc(r.tipo) + '">' +
        '<td>' + esc(r.criadoEmFormatted) + '</td>' +
        '<td>' + esc(r.tipo) + '</td>' +
        '<td class="maudVendedorCell" title="' + esc(r.vendedor) + '">' + esc(r.vendedor) + '</td>' +
        '<td>' + auditBadgeHtml(r) + '</td>' +
        '<td class="maudDetailCol">' + auditDetailBtnHtml(r) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="maDesktopOnly"><div class="modTableWrap"><table class="modTable maudTable">' +
      '<thead><tr><th scope="col">Data/Hora</th><th scope="col">Evento</th><th scope="col">Vendedor/Usuário</th><th scope="col">Resultado</th><th scope="col">Detalhes</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderAuditMobileCards(rows) {
    var cards = rows.map(function (r) {
      return '<div class="maMobileCard maudMobileCard" tabindex="0" role="button" data-key="' + esc(r.id) + '" aria-label="Ver detalhes do evento ' + esc(r.tipo) + '">' +
        '<div class="maMobileName">' + esc(r.criadoEmFormatted) + '</div>' +
        '<div class="maSubtle">' + esc(r.tipo) + '</div>' +
        '<div class="maMobileMeta">' + esc(r.vendedor) + '</div>' +
        auditBadgeHtml(r) +
        '<div class="maudMobileActions">' + auditDetailBtnHtml(r) + '</div>' +
        '</div>';
    }).join('');
    return '<div class="maMobileOnly">' + cards + '</div>';
  }

  // Painel Master Phase PM-4B.3 introduced this pattern for Auditoria
  // (Human UAT finding: clicking "Ver detalhes" rendered the detail at
  // the END of the (up to 100-row) list, forcing a long scroll and
  // losing context). Fixed by rendering into the existing, pre-built,
  // then-unused #nxModalRoot (real infrastructure already present in
  // index.html/shell.css -- "Gate 10" overlay/modal root). Phase
  // PM-4B.4 found the SAME defect class in Usuários and generalizes
  // this into ONE shared modal primitive (Gate 4 of PM-4B.4: "ONE
  // PAINEL MASTER MODAL PATTERN") -- both sections keep their own
  // detail-id state (auditDetailId / currentDetailId, never merged,
  // since they address two independent datasets), but share the exact
  // same dialog shell, focus/backdrop/Esc mechanics, and CSS. The
  // underlying list (#maPanel) is NEVER re-rendered/scrolled to open or
  // close either modal -- only the separate #nxModalRoot's own content
  // changes, which is what makes exact scroll preservation and
  // exact-trigger focus-return possible.
  var nxModalTriggerEl = null;
  // MASTERFIX1: captured once per page mount (NX_SHELL_ADMIN_PAGE.
  // render(), below), the same "capture now, compare on resolution"
  // route-ownership technique gestao.js's NAVFIX1 fix and salarios-
  // comissoes.js's SALFIX1 fix already established for the identical
  // class of bug -- a Painel Master mutation whose promise settles
  // after the user has navigated to a different module must never
  // write into the shared, page-level #nxModalRoot (a sibling of the
  // router-controlled outlet, never cleared on route change) or lock
  // background scroll on whatever module the user is now using.
  // renderNxModal()/clearNxModal() are the single chokepoint every one
  // of this file's ~12 modal call sites already funnels through, so
  // guarding here (rather than at each individual mutation callback)
  // closes every instance at once.
  //
  // A second, complementary gap: #nxModalRoot living outside the
  // router-controlled outlet also means a modal the user had ALREADY
  // opened (synchronously, legitimately, while shell-admin still owned
  // the route) is never torn down by navigating away -- nothing else
  // in this app clears it on route change. A one-time NX_ROUTER.
  // onChange() subscription (registered once, not once per mount, to
  // avoid accumulating listeners across repeated visits) proactively
  // clears any currently-open modal the instant the route actually
  // changes away from shell-admin, via the unconditional inner
  // function below (clearNxModal() itself intentionally stays guarded,
  // so a stale mutation's own .catch()/.then() close call remains a
  // no-op once the router's own listener has already handled it).
  //
  // window.NX_ROUTER may not exist in this module's own isolated test
  // harnesses -- mountRoute stays null there and every guard is a
  // no-op, preserving every existing harness-level test unchanged.
  var mountRoute = null;
  var routeChangeSubscribed = false;
  function isStaleRoute() {
    return !!(window.NX_ROUTER && typeof window.NX_ROUTER.currentRouteId === 'function' &&
      mountRoute !== null && window.NX_ROUTER.currentRouteId() !== mountRoute);
  }

  function clearNxModalUnconditional() {
    var root = document.getElementById('nxModalRoot');
    if (!root) return;
    root.innerHTML = '';
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('maudModalOpen');
  }

  function renderNxModal(titleText, bodyHtml, onClose) {
    if (isStaleRoute()) return; // MASTERFIX1: navigated away, this module no longer owns the outlet
    var root = document.getElementById('nxModalRoot');
    if (!root) return;
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('maudModalOpen'); // background scroll lock (Gate 23)
    root.innerHTML = '<div class="maudModalBackdrop" id="maudModalBackdrop">' +
      '<div class="maudModalDialog" role="dialog" aria-modal="true" aria-labelledby="maudModalTitle" tabindex="-1" id="maudModalDialog">' +
      '<div class="maDetailHead"><h2 id="maudModalTitle">' + esc(titleText) + '</h2>' +
      '<button type="button" class="modBtnGhost" id="maudModalCloseBtn" aria-label="Fechar">×</button></div>' +
      '<div class="maudModalBody">' + bodyHtml + '</div>' +
      '</div></div>';
    var backdrop = document.getElementById('maudModalBackdrop');
    var dialog = document.getElementById('maudModalDialog');
    if (backdrop) backdrop.addEventListener('click', function (e) { if (e.target === backdrop) onClose(); });
    var closeBtn = document.getElementById('maudModalCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', onClose);
    // Gate 22: focus enters the dialog on open (and again on every
    // in-place content refresh, e.g. after a mutation reloads the row).
    if (dialog) dialog.focus();
  }

  function clearNxModal() {
    if (isStaleRoute()) return; // MASTERFIX1: navigated away, nothing of ours to clear
    clearNxModalUnconditional();
  }

  // Focus-return target (Gate 17/22): normally the exact element that
  // opened the modal. If the underlying list was re-rendered meanwhile
  // (e.g. loadUsers() refreshed rows while the modal stayed open across
  // a mutation) that original node is detached and .focus() on it is a
  // silent no-op -- fall back to the freshly-rendered row/card carrying
  // the same data-key, rather than leaving focus stranded on <body>.
  function findListTriggerByKey(key) {
    var candidates = document.querySelectorAll('.maTable tbody tr[data-key], .maMobileCard[data-key], .maudRow[data-key], .maudMobileCard[data-key], .pcRow[data-key], .pcMobileCard[data-key]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].getAttribute('data-key') === String(key)) return candidates[i];
    }
    return null;
  }
  function returnFocusToTrigger(fallbackKey) {
    var el = nxModalTriggerEl;
    if (el && document.body.contains(el) && typeof el.focus === 'function') {
      el.focus();
    } else if (fallbackKey != null) {
      var alt = findListTriggerByKey(fallbackKey);
      if (alt && typeof alt.focus === 'function') alt.focus();
    }
    nxModalTriggerEl = null;
  }

  function nxModalKeydown(e) {
    if (e.key !== 'Escape') return;
    if (auditDetailId) { e.preventDefault(); closeAuditModal(); }
    else if (currentDetailId) { e.preventDefault(); closeUserModal(); }
    else if (pcDetailId) { e.preventDefault(); closePcModal(); }
    else if (gbState.modal) { e.preventDefault(); gbCloseModal(); }
    else if (gsState.modal) { e.preventDefault(); gsCloseModal(); }
    else if (cfgState.modal) { e.preventDefault(); cfgCloseModal(); }
    else if (prState.modal) { e.preventDefault(); prCloseModal(); }
  }

  function auditModalBodyHtml(r) {
    return fieldRow('Data/Hora', r.criadoEmFormatted) + fieldRow('Evento', r.tipo) + fieldRow('Descrição', r.descricao) +
      fieldRow('Alvo (CPF)', r.cpfMasked) + fieldRow('Vendedor/Usuário', r.vendedor) + fieldRow('Loja', r.loja) +
      fieldRow('Origem', r.baseOrigem) + fieldRow('Resultado', r.resolvidoLabel) +
      (r.resolvidoEm ? fieldRow('Resolvido em', r.resolvidoEmFormatted) : '');
  }

  function renderAuditModalRoot() {
    var r = auditDetailId ? auditRowById(auditDetailId) : null;
    if (!r) { clearNxModal(); return; }
    renderNxModal(r.tipo, auditModalBodyHtml(r), closeAuditModal);
  }

  function openAuditModal(id, triggerEl) {
    auditDetailId = id;
    nxModalTriggerEl = triggerEl || null;
    renderAuditModalRoot();
  }

  function closeAuditModal() {
    var closedId = auditDetailId;
    auditDetailId = null;
    clearNxModal();
    // Gate 22: focus returns to the exact trigger that opened this
    // event's modal -- never left stranded on <body>.
    returnFocusToTrigger(closedId);
  }

  // ---------- Usuários detail modal (Painel Master Phase PM-4B.4) ----------
  function renderUserModalRoot() {
    var r = currentDetailId ? rowById(currentDetailId) : null;
    if (!r) {
      if (currentDetailId) currentDetailId = null; // row no longer present after a reload
      clearNxModal();
      return;
    }
    renderNxModal(r.nome, renderUserModalBody(r), closeUserModal);
    wireUserModalInteraction();
  }

  function openUserModal(id, triggerEl, opts) {
    currentDetailId = id;
    editForm = null;
    pendingConfirm = null;
    successMessage = null;
    generatedLink = null;
    nxModalTriggerEl = triggerEl || null;
    renderUserModalRoot();
    // Painel Master Phase PM-4C.2 -- external deep-link entry point
    // (Pendências Cadastrais' "Ver usuário"/foco). `opts` is undefined
    // for every pre-existing call site (row/card click), so this is
    // additive only, never a behavior change for normal Users navigation.
    if (opts && opts.foco) pcHighlightUserField(opts.foco);
  }

  function closeUserModal() {
    var closedId = currentDetailId;
    currentDetailId = null;
    editForm = null;
    pendingConfirm = null;
    successMessage = null;
    generatedLink = null;
    clearNxModal();
    returnFocusToTrigger(closedId);
  }

  function renderAuditoriaSection() {
    if (auditState.error) {
      return errorStateHtml(auditState.error.state, auditState.error.message) +
        '<div class="maDetailActions"><button type="button" class="modBtn" id="maAuditRetryBtn">Tentar novamente</button></div>';
    }
    if (auditState.loading || !auditState.loaded) {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando auditoria...</div>';
    }
    var html = '<p class="modSubtitle">Registro das ações executadas pelo Painel Master. Mostra os 100 eventos mais recentes.</p>';
    if (!auditState.rows.length) {
      html += '<div class="modEmptyState"><div class="modStateTitle">Nenhum registro</div>Nenhum evento de auditoria encontrado.</div>';
    } else {
      html += renderAuditDesktopTable(auditState.rows) + renderAuditMobileCards(auditState.rows);
    }
    // Gate 25: single canonical presentation -- the old end-of-list
    // detail panel is gone entirely, never rendered alongside the modal.
    return html;
  }

  // ---------- Pendências Cadastrais (Painel Master Phase PM-4C.2) ----------
  // Real backend authority proven ready by PM-4C.1's own audit: 7
  // already-deployed MASTER-only RPCs, zero new backend. Detail surface
  // reuses the SAME #nxModalRoot primitives Auditoria/Usuários already
  // established (renderNxModal/clearNxModal/returnFocusToTrigger) --
  // ONE Painel Master modal pattern, not a third parallel one.

  function pcEnter() {
    if (pcState.loaded || pcState.loading) { renderPanel(); return; }
    pcLoad();
  }

  function pcParamsAtuais() {
    var vm = window.NX_MASTER_PENDENCIAS_VIEW_MODEL;
    var tabDef = (vm.PC_TABS.filter(function (t) { return t[0] === pcState.tab; })[0] || vm.PC_TABS[0])[2];
    return {
      status: tabDef.status || null,
      severidade: tabDef.severidade || null,
      tipo: pcState.filtros.tipo || null,
      origem: pcState.filtros.origem || null
    };
  }

  // Gate 21: busca is a purely client-side refinement, never sent to
  // the RPC -- same technique already proven for Usuários/Auditoria.
  function pcFilteredRows() {
    return window.NX_MASTER_PENDENCIAS_VIEW_MODEL.filtrarBusca(pcState.rows, pcState.filtros.busca);
  }

  function pcRowById(id) {
    return pcState.rows.filter(function (r) { return String(r.id) === String(id); })[0] || null;
  }

  function pcLoad() {
    pcState.loading = true;
    pcState.error = null;
    renderPanel();
    window.NX_MASTER_PENDENCIAS_PROVIDER.loadAlertas(pcParamsAtuais(), {}).then(function (payload) {
      var vm = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.buildAlertasViewModel(payload);
      pcState.rows = vm.rows;
      pcState.total = vm.total;
      pcState.loading = false;
      pcState.loaded = true;
      renderPanel();
    }, function (err) {
      pcState.loading = false;
      pcState.loaded = false;
      pcState.error = err || { state: 'RPC_ERROR' };
      renderPanel();
    });
  }

  function pcSetAba(aba) {
    pcState.aba = aba;
    if (aba === 'excecoes' && !pcState.excecoes.loaded && !pcState.excecoes.loading) {
      pcExcecoesLoad();
    } else {
      renderPanel();
    }
  }

  function pcAbaSwitchHtml() {
    return '<div class="pcTabs pcAbaSwitch">' +
      '<button type="button" class="' + (pcState.aba === 'alertas' ? 'modBtn' : 'modBtnGhost') + ' pcAbaBtn" data-aba="alertas">Alertas</button>' +
      '<button type="button" class="' + (pcState.aba === 'excecoes' ? 'modBtn' : 'modBtnGhost') + ' pcAbaBtn" data-aba="excecoes">Exceções</button>' +
      '</div>';
  }

  function pcSeverityBadgeHtml(info) {
    return '<span class="maBadge ' + esc(info.cls) + '">' + esc(info.emoji + ' ' + info.label.toUpperCase()) + '</span>';
  }
  function pcStatusBadgeHtml(r) {
    return '<span class="maBadge ' + esc(r.statusClasse) + '">' + esc(r.statusLabel) + '</span>';
  }
  function pcDetailBtnHtml(r) {
    return '<button type="button" class="modBtnGhost pcDetailBtn" data-key="' + esc(r.id) + '" aria-label="Ver detalhes da pendência de ' + esc(r.pessoaDisplay) + '">Ver detalhes</button>';
  }

  // Gate 16: canonical 8-column desktop list -- Severidade/Pessoa-
  // Identificador/Origem/Motivo/Ocorrências/Última ocorrência/Status/
  // Ação. All mutation actions live in the modal (Gate 26), never
  // inline in the row -- matches the established Usuários/Auditoria
  // convention (a scan-oriented table, contextual detail for action).
  function renderPcDesktopTable(rows) {
    var body = rows.map(function (r) {
      return '<tr class="pcRow" tabindex="0" role="button" data-key="' + esc(r.id) + '" aria-label="Ver detalhes da pendência de ' + esc(r.pessoaDisplay) + '">' +
        '<td class="pcSevCell">' + pcSeverityBadgeHtml(r.severidadeInfo) + '</td>' +
        '<td class="pcPersonCell">' + esc(r.pessoaDisplay) + (r.loginNbsEncontrado ? '<div class="maSubtle">NBS: ' + esc(r.loginNbsEncontrado) + '</div>' : '') + '</td>' +
        '<td class="pcOrigemCell">' + esc(r.origemLabel) + '</td>' +
        '<td class="pcMotivoCell">' + esc(r.tipoLabel) + '</td>' +
        '<td class="pcNumCell">' + esc(r.quantidadeOcorrencias) + '</td>' +
        '<td class="pcDateCell">' + esc(r.ultimaOcorrenciaEmFormatted) + '</td>' +
        '<td class="pcStatusCell">' + pcStatusBadgeHtml(r) + '</td>' +
        '<td class="maudDetailCol">' + pcDetailBtnHtml(r) + '</td>' +
        '</tr>';
    }).join('');
    // Gate 14/15 (PM-4C.2.1): Pendências uses its OWN, earlier
    // desktop/mobile breakpoint (.pcDesktopOnly/.pcMobileOnly, 900px)
    // instead of the shared .maDesktopOnly/.maMobileOnly (767px) --
    // 8 real columns have a measured minimum content width the shared,
    // narrower breakpoint sits below, which would otherwise leave a
    // real 768-840px zone where this table is active AND still
    // horizontally overflows.
    return '<div class="pcDesktopOnly"><div class="modTableWrap"><table class="modTable pcTable">' +
      '<thead><tr><th scope="col">Severidade</th><th scope="col">Pessoa / Identificador</th><th scope="col">Origem</th><th scope="col">Motivo</th><th scope="col">Ocorrências</th><th scope="col">Última ocorrência</th><th scope="col">Status</th><th scope="col">Ação</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></div>';
  }
  function renderPcMobileCards(rows) {
    var cards = rows.map(function (r) {
      return '<div class="maMobileCard pcMobileCard" tabindex="0" role="button" data-key="' + esc(r.id) + '" aria-label="Ver detalhes da pendência de ' + esc(r.pessoaDisplay) + '">' +
        '<div class="maMobileName">' + esc(r.pessoaDisplay) + '</div>' +
        '<div class="maSubtle">' + esc(r.tipoLabel) + ' · ' + esc(r.origemLabel) + '</div>' +
        '<div class="maMobileMeta">' + esc(r.ultimaOcorrenciaEmFormatted) + '</div>' +
        pcSeverityBadgeHtml(r.severidadeInfo) + ' ' + pcStatusBadgeHtml(r) +
        '<div class="maudMobileActions">' + pcDetailBtnHtml(r) + '</div>' +
        '</div>';
    }).join('');
    return '<div class="pcMobileOnly">' + cards + '</div>';
  }

  function pcResultsAreaHtml() {
    var filtered = pcFilteredRows();
    if (!filtered.length) {
      return '<div class="modEmptyState"><div class="modStateTitle">Nenhuma pendência cadastral</div>Nenhuma pendência cadastral encontrada para os filtros selecionados.</div>';
    }
    return renderPcDesktopTable(filtered) + renderPcMobileCards(filtered);
  }
  // Gate 21 (avoid the input-focus-loss risk of a full-panel re-render
  // on every keystroke): only #pcResultsArea's own innerHTML is touched
  // by search -- #pcSearch itself is never recreated mid-typing. Same
  // scoped-partial-repaint technique V1's own pcRenderResultados() uses.
  function pcRenderResultsArea() {
    var area = document.getElementById('pcResultsArea');
    if (!area) return;
    area.innerHTML = pcResultsAreaHtml();
    wirePcResultsInteraction();
  }
  function pcSetBusca(v) {
    pcState.filtros.busca = v;
    clearTimeout(pcSearchDebounce);
    pcSearchDebounce = setTimeout(pcRenderResultsArea, 200);
  }

  // Gate 17/53: computed over pcState.rows (the current tab/tipo/origem
  // server-filtered set) -- NOT re-filtered by the client-side busca
  // text, matching V1's own real behavior exactly. Explicitly labeled
  // as filter-scoped, never presented as a global database total.
  function pcSummaryCardsHtml() {
    var s = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.buildSummaryCards(pcState.rows);
    return '<p class="modSubtitle pcSummaryNote">Resumo calculado sobre os resultados carregados para os filtros atuais — não é um total geral do banco de dados.</p>' +
      '<div class="pcSummaryCards">' +
      '<div class="pcCard"><div class="pcCardK">Pendentes</div><div class="pcCardV">' + s.pendentes + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Urgentes (pendentes)</div><div class="pcCardV">' + s.urgentesPendentes + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Ignorados</div><div class="pcCardV">' + s.ignorados + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Resolvidos</div><div class="pcCardV">' + s.resolvidos + '</div></div>' +
      '</div>';
  }

  function pcTabsHtml() {
    return '<div class="pcTabs">' + window.NX_MASTER_PENDENCIAS_VIEW_MODEL.PC_TABS.map(function (t) {
      return '<button type="button" class="' + (pcState.tab === t[0] ? 'modBtn' : 'modBtnGhost') + ' pcTabBtn" data-tab="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }

  function pcFiltersHtml() {
    var vm = window.NX_MASTER_PENDENCIAS_VIEW_MODEL;
    var tipoOptions = ['<option value="">Todos os tipos</option>'].concat(
      Object.keys(vm.PC_TIPOS).map(function (t) { return '<option value="' + esc(t) + '"' + (pcState.filtros.tipo === t ? ' selected' : '') + '>' + esc(vm.PC_TIPOS[t]) + '</option>'; })
    ).join('');
    var origemOptions = ['<option value="">Todas as origens</option>'].concat(
      Object.keys(vm.PC_ORIGENS).map(function (o) { return '<option value="' + esc(o) + '"' + (pcState.filtros.origem === o ? ' selected' : '') + '>' + esc(vm.PC_ORIGENS[o]) + '</option>'; })
    ).join('');
    return '<div class="modFilters">' +
      '<div class="modField"><label for="pcFilterTipo">Tipo</label><select id="pcFilterTipo">' + tipoOptions + '</select></div>' +
      '<div class="modField"><label for="pcFilterOrigem">Origem</label><select id="pcFilterOrigem">' + origemOptions + '</select></div>' +
      '<div class="modField"><label for="pcSearch">Buscar</label><input id="pcSearch" type="text" value="' + esc(pcState.filtros.busca) + '" placeholder="Nome, NBS, loja, departamento ou candidato"></div>' +
      '</div>';
  }

  // ---------- Pendências detail modal ----------
  var PC_FOCO_LABEL = { loja: 'Loja', departamento: 'Departamento' };
  function isPcModalConfirmKind(kind) {
    return kind === 'pcResolver' || kind === 'pcIgnorar' || kind === 'pcExcluir' || kind === 'pcCorrigirNbs';
  }
  function pcRecomendacaoBtnHtml(rec) {
    if (rec.kind === 'CORRIGIR_NBS') return '<button type="button" class="modBtn" id="pcCorrigirNbsBtn">Corrigir Login NBS</button>';
    if (rec.kind === 'VER_USUARIO') return '<button type="button" class="modBtn" id="pcVerUsuarioBtn">Ver usuário</button>';
    if (rec.kind === 'REVISAR_USUARIOS') return '<button type="button" class="modBtnGhost" id="pcIrUsuariosBtn">Ir para Usuários</button>';
    if (rec.kind === 'CADASTRAR_CONVIDAR') return '<button type="button" class="modBtn" id="pcCadastrarBtn">Cadastrar / convidar usuário</button>';
    return '';
  }
  // Gate 27: distinct sections (problema / o que a base achou / o que o
  // cadastro tem hoje / recomendação / histórico / ações), never a raw
  // JSON dump. "O que o cadastro possui hoje" reuses the ALREADY-loaded
  // Usuários dataset (rowById -- same #maPanel dataset, no second
  // fetch) -- deliberately omits Login NBS there: master_admin_
  // security_data()'s own `users` shape (PM-4C.1 forensics) never
  // returns login_nbs at all, unlike V1's separate carregarUsuariosSupabase();
  // extending that RPC would be a real backend change, out of scope
  // this Phase (Gate 4/8) -- omitted honestly rather than faked.
  function pcModalBodyHtml(r) {
    var out = '';
    if (successMessage) {
      out += '<div class="modSuccessState" role="status">' + esc(successMessage) + '</div>';
      successMessage = null;
    }
    out += '<p class="modSubtitle">' + esc(r.explicacao) + '</p>';
    var relacionadas = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.ocorrenciasRelacionadas(pcState.rows, r);
    if (relacionadas > 0) {
      out += '<p class="maWarnNote">' + relacionadas + ' outro(s) alerta(s) pendente(s) carregado(s) nesta lista está(ão) relacionado(s) a este mesmo identificador. Ignorar com "não alertar novamente" trata todos de uma vez.</p>';
    }
    out += '<h3 class="pcModalSubhead">O que a base informou</h3>' +
      fieldRow('Nome', r.nomeEncontrado || '—') + fieldRow('Login NBS', r.loginNbsEncontrado || '—') +
      fieldRow('Identificador', (r.identificadorTipo ? r.identificadorTipo + ': ' : '') + (r.identificadorMascarado || '—')) +
      fieldRow('Loja', r.lojaEncontrada || '—') + fieldRow('Departamento', r.departamentoEncontrado || '—') +
      fieldRow('Origem', r.origemLabel) + fieldRow('Primeira ocorrência', r.primeiraOcorrenciaEmFormatted) +
      fieldRow('Última ocorrência', r.ultimaOcorrenciaEmFormatted) + fieldRow('Quantidade de ocorrências', String(r.quantidadeOcorrencias)) +
      '<div class="maDetailField"><span class="maDetailLabel">Status</span>' + pcStatusBadgeHtml(r) + '</div>';
    if (r.usuarioCandidatoId) {
      var cand = rowById(r.usuarioCandidatoId);
      out += '<h3 class="pcModalSubhead">O que o cadastro possui hoje</h3>' +
        fieldRow('Nome', (cand && cand.nome) || r.nomeUsuarioCandidato || '—') +
        fieldRow('Perfil', (cand && cand.perfil) || '—') +
        fieldRow('Loja', (cand && cand.loja) || '—') +
        fieldRow('Departamento', (cand && cand.status) || '—');
    }
    var historico = '';
    if (r.status === 'IGNORADO' && r.ignoradoEmFormatted) historico += fieldRow('Ignorado em', r.ignoradoEmFormatted);
    if (r.status === 'RESOLVIDO' && r.resolvidoEmFormatted) historico += fieldRow('Resolvido em', r.resolvidoEmFormatted);
    if (r.status === 'EXCLUIDO' && r.excluidoEmFormatted) historico += fieldRow('Excluído em', r.excluidoEmFormatted);
    if (r.motivoAcao) historico += fieldRow('Motivo da ação', r.motivoAcao);
    if (historico) out += '<h3 class="pcModalSubhead">Histórico da decisão</h3>' + historico;
    if (r.status === 'PENDENTE') {
      out += '<h3 class="pcModalSubhead">O que precisa ser feito</h3><p class="modSubtitle">' + esc(r.recomendacao.texto) + '</p>';
      var recBtn = pcRecomendacaoBtnHtml(r.recomendacao);
      if (recBtn) out += '<div class="maDetailActions">' + recBtn + '</div>';
      out += '<div class="maDetailActions">' +
        '<button type="button" class="modBtn" id="pcResolverBtn">Marcar como resolvido manualmente</button>' +
        '<button type="button" class="modBtn" id="pcIgnorarBtn">Ignorar</button>' +
        '<button type="button" class="modBtn modBtnDanger" id="pcExcluirBtn">Excluir</button>' +
        '</div>';
    }
    if (pendingConfirm && isPcModalConfirmKind(pendingConfirm.kind)) {
      out += confirmHtml(pendingConfirm.title, pendingConfirm.body, pendingConfirm.confirmLabel, pendingConfirm.destructive, pendingConfirm.bodyHtml, pendingConfirm.error);
    }
    return out;
  }

  function renderPcModalRoot() {
    var r = pcDetailId ? pcRowById(pcDetailId) : null;
    if (!r) {
      if (pcDetailId) pcDetailId = null;
      clearNxModal();
      return;
    }
    renderNxModal(r.tipoLabel, pcModalBodyHtml(r), closePcModal);
    wirePcModalInteraction();
  }
  function openPcModal(id, triggerEl) {
    pcDetailId = id;
    pendingConfirm = null;
    successMessage = null;
    nxModalTriggerEl = triggerEl || null;
    renderPcModalRoot();
  }
  function closePcModal() {
    var closedId = pcDetailId;
    pcDetailId = null;
    pendingConfirm = null;
    successMessage = null;
    clearNxModal();
    returnFocusToTrigger(closedId);
  }

  // Gate 34/35: deep-link into the ALREADY-APPROVED Usuários modal --
  // never a second detail renderer/edit form/mutation provider. Closes
  // the Pendência's own modal first (matches V1's own real precedent:
  // pcFecharDrawer() before abrirMasterUsuarioDeep(), never a stacked
  // dialog), sourcing the Users-modal's trigger element from the
  // Pendência's OWN still-live list row (never re-rendered by this
  // whole detour) so that closing the Users modal returns focus to the
  // exact row that started this journey -- a controlled close/switch/
  // return transition through the one shared #nxModalRoot, never modal-
  // over-modal.
  function pcVerUsuario(usuarioId, foco) {
    if (!usuarioId) return;
    var pendTrigger = findListTriggerByKey(pcDetailId);
    closePcModal();
    openUserModal(usuarioId, pendTrigger, { foco: foco });
  }
  function pcFecharEIrPara(sectionId) {
    closePcModal();
    switchSection(sectionId);
  }
  function pcAbrirCadastrarUsuario() {
    closePcModal();
    switchSection('usuarios');
    createForm = emptyCreateForm();
    currentView = 'create';
    renderPanel();
  }
  // Gate 34 "optionally focus/scroll to a relevant field" -- the
  // smallest real implementation: scroll the matching field row into
  // view inside the (already rendered) Users modal and highlight it.
  // Never a new field/edit affordance (Gate 34 forbids duplicating the
  // edit form) -- purely a visual pointer to an EXISTING read-only row.
  function pcHighlightUserField(foco) {
    var label = PC_FOCO_LABEL[foco];
    if (!label) return;
    var fields = document.querySelectorAll('#nxModalRoot .maDetailField');
    for (var i = 0; i < fields.length; i++) {
      var labelEl = fields[i].querySelector('.maDetailLabel');
      if (labelEl && labelEl.textContent === label) {
        fields[i].scrollIntoView({ block: 'center' });
        fields[i].classList.add('pcFocoDestaque');
        break;
      }
    }
  }

  function wirePcModalInteraction() {
    var r = pcDetailId ? pcRowById(pcDetailId) : null;
    var resolverBtn = document.getElementById('pcResolverBtn');
    if (resolverBtn && r) resolverBtn.addEventListener('click', function () { pcOpenResolverConfirm(r); });
    var ignorarBtn = document.getElementById('pcIgnorarBtn');
    if (ignorarBtn && r) ignorarBtn.addEventListener('click', function () { pcOpenIgnorarConfirm(r); });
    var excluirBtn = document.getElementById('pcExcluirBtn');
    if (excluirBtn && r) excluirBtn.addEventListener('click', function () { pcOpenExcluirConfirm(r); });
    var corrigirBtn = document.getElementById('pcCorrigirNbsBtn');
    if (corrigirBtn && r) corrigirBtn.addEventListener('click', function () { pcOpenCorrigirNbsConfirm(r); });
    var verUsuarioBtn = document.getElementById('pcVerUsuarioBtn');
    if (verUsuarioBtn && r) verUsuarioBtn.addEventListener('click', function () { pcVerUsuario(r.recomendacao.usuarioId, r.recomendacao.foco); });
    var irUsuariosBtn = document.getElementById('pcIrUsuariosBtn');
    if (irUsuariosBtn) irUsuariosBtn.addEventListener('click', function () { pcFecharEIrPara('usuarios'); });
    var cadastrarBtn = document.getElementById('pcCadastrarBtn');
    if (cadastrarBtn) cadastrarBtn.addEventListener('click', pcAbrirCadastrarUsuario);

    var confirmYes = document.getElementById('maConfirmYes');
    if (confirmYes) confirmYes.addEventListener('click', executeConfirmedAction);
    var confirmNo = document.getElementById('maConfirmNo');
    if (confirmNo) confirmNo.addEventListener('click', function () { pendingConfirm = null; renderPcModalRoot(); });
  }

  function wirePcResultsInteraction() {
    document.querySelectorAll('.pcRow, .pcMobileCard').forEach(function (el) {
      el.addEventListener('click', function () { openPcModal(el.getAttribute('data-key'), el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPcModal(el.getAttribute('data-key'), el); }
      });
    });
    // Explicit button calls the exact same controller as the row/card
    // click -- never a second flow (Gate 6 precedent). Own class
    // (.pcDetailBtn), never .maudDetailBtn -- that class is already
    // wired to openAuditModal elsewhere and must not be shared.
    document.querySelectorAll('.pcDetailBtn').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openPcModal(el.getAttribute('data-key'), el);
      });
    });
  }

  // ---------- Pendências mutation confirms ----------
  function pcOpenResolverConfirm(r) {
    pendingConfirm = {
      kind: 'pcResolver', target: r,
      title: 'Marcar como resolvido manualmente',
      body: 'Esta ação não altera o cadastro. Use somente se o problema já tiver sido corrigido por outro meio — confirme apenas se a situação já foi tratada fora deste alerta.',
      bodyHtml: '<div class="modField"><label for="pcResolverMotivo">Observação (opcional)</label><input id="pcResolverMotivo" type="text" placeholder="Ex.: cadastro corrigido manualmente em DD/MM"></div>',
      confirmLabel: 'Confirmar resolução', destructive: false
    };
    renderPcModalRoot();
  }
  function pcOpenIgnorarConfirm(r) {
    var elegivel = !!(r.identificadorTipo && r.identificadorMascarado);
    var motivoOpts = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.PC_MOTIVOS_IGNORAR.map(function (m) { return '<option value="' + esc(m[0]) + '">' + esc(m[1]) + '</option>'; }).join('');
    var bodyHtml = '<div class="modField"><label for="pcIgnorarMotivo">Motivo</label><select id="pcIgnorarMotivo"><option value="">Selecione...</option>' + motivoOpts + '</select></div>' +
      '<div class="modField"><label for="pcIgnorarObs">Observação (opcional)</label><input id="pcIgnorarObs" type="text" placeholder="Detalhe adicional"></div>' +
      (elegivel ? '<div class="modField"><label class="pcCheckLabel"><input id="pcIgnorarExcecao" type="checkbox"> Não alertar novamente para este identificador</label><p class="maSubtle">Novas ocorrências com este CPF/Login NBS serão suprimidas enquanto a exceção estiver ativa.</p></div>' : '');
    pendingConfirm = {
      kind: 'pcIgnorar', target: r,
      title: 'Ignorar pendência',
      body: 'O alerta deixará de aparecer na fila de pendentes.',
      bodyHtml: bodyHtml,
      confirmLabel: 'Ignorar', destructive: false
    };
    renderPcModalRoot();
  }
  function pcOpenExcluirConfirm(r) {
    pendingConfirm = {
      kind: 'pcExcluir', target: r,
      title: 'Excluir pendência',
      body: 'Este alerta será removido da fila operacional, mas permanecerá registrado no histórico administrativo (Gate 31: não é uma exclusão física).',
      bodyHtml: '<div class="modField"><label for="pcExcluirMotivo">Motivo</label><input id="pcExcluirMotivo" type="text" placeholder="Ex.: registro duplicado"></div>',
      confirmLabel: 'Excluir', destructive: true
    };
    renderPcModalRoot();
  }
  function pcOpenCorrigirNbsConfirm(r) {
    pendingConfirm = {
      kind: 'pcCorrigirNbs', target: r,
      title: 'Corrigir Login NBS',
      body: 'Login NBS encontrado na base: ' + (r.loginNbsEncontrado || '—') + '. Confirme ou ajuste o valor correto.',
      bodyHtml: '<div class="modField"><label for="pcNovoNbs">Novo Login NBS</label><input id="pcNovoNbs" type="text" value="' + esc(r.loginNbsEncontrado || '') + '" placeholder="Confirme ou ajuste o valor"></div>' +
        '<div class="modField"><label for="pcNovoNbsObs">Observação (opcional)</label><input id="pcNovoNbsObs" type="text" placeholder="Detalhe adicional"></div>',
      confirmLabel: 'Confirmar alteração do Login NBS', destructive: false
    };
    renderPcModalRoot();
  }
  function pcOpenRevogarExcecaoConfirm(excecaoId) {
    pendingConfirm = {
      kind: 'pcRevogarExcecao', target: { id: excecaoId },
      title: 'Revogar exceção',
      body: 'Novas ocorrências voltarão a gerar alertas.',
      confirmLabel: 'Revogar', destructive: true
    };
    renderPanel();
  }

  var PC_NBS_ERROR_COPY = {
    NBS_VINCULADO_OUTRO_USUARIO: 'Este Login NBS já está vinculado a outro usuário ativo.',
    NBS_CPF_DIVERGENTE: 'Este Login NBS está vinculado, na base de vendedores, a um CPF diferente do deste usuário.',
    VALOR_OBRIGATORIO: 'Informe um valor válido.',
    SEM_CANDIDATO: 'Não há um cadastro candidato para corrigir.',
    TIPO_INCOMPATIVEL: 'Este alerta não é do tipo Login NBS divergente.',
    STATUS_INCOMPATIVEL: 'Este alerta não está mais pendente.',
    JA_RESOLVIDO: 'Este alerta já foi resolvido.'
  };
  var PC_GENERIC_ERROR_COPY = {
    MOTIVO_INVALIDO: 'Selecione um motivo válido.',
    MOTIVO_OBRIGATORIO: 'Informe o motivo.',
    ALERTA_NAO_ENCONTRADO: 'Pendência não encontrada.',
    CONFLITO_CONCORRENCIA: 'Esta pendência foi alterada em outra sessão. Atualize a lista e tente novamente.',
    IDENTIFICADOR_TIPO_INVALIDO: 'Selecione um tipo de identificador válido.',
    IDENTIFICADOR_VALOR_INVALIDO: 'Informe um identificador válido.',
    EXCECAO_JA_ATIVA: 'Já existe uma exceção ativa para este identificador.',
    EXCECAO_NAO_ENCONTRADA: 'Exceção não encontrada.'
  };
  // Gate 33: real backend codes normalized to controlled human copy,
  // never a raw SQL/stack trace surfaced to the Master.
  function pcMutationErrorCopy(err) {
    if (err && err.codigo) {
      return PC_NBS_ERROR_COPY[err.codigo] || PC_GENERIC_ERROR_COPY[err.codigo] || ('Não foi possível concluir: ' + err.codigo);
    }
    return (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body;
  }

  // ---------- Exceções ----------
  function pcExcecoesLoad() {
    pcState.excecoes.loading = true;
    pcState.excecoes.error = null;
    renderPanel();
    window.NX_MASTER_PENDENCIAS_PROVIDER.loadExcecoes({ ativo: pcState.excecoes.filtroAtivo, tipo: pcState.excecoes.filtroTipo }, {}).then(function (payload) {
      var vm = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.buildExcecoesViewModel(payload);
      pcState.excecoes.rows = vm.rows;
      pcState.excecoes.loading = false;
      pcState.excecoes.loaded = true;
      renderPanel();
    }, function (err) {
      pcState.excecoes.loading = false;
      pcState.excecoes.loaded = false;
      pcState.excecoes.error = err || { state: 'RPC_ERROR' };
      renderPanel();
    });
  }
  function pcExcecaoRowHtml(e) {
    return '<div class="adminListRow pcExcRow" data-key="' + esc(e.id) + '">' +
      '<div class="maDetailField"><span class="maDetailLabel">' + esc(e.identificadorTipo) + '</span><span class="maDetailValue">' + esc(e.identificadorMascarado || '—') + '</span></div>' +
      '<div class="maSubtle">' + esc(e.motivo || '') + (e.observacao ? ' — ' + esc(e.observacao) : '') + '</div>' +
      '<div class="maDetailField"><span class="maDetailLabel">Criada por</span><span class="maDetailValue">' + esc(e.criadoPorNome) + '</span></div>' +
      '<div class="maSubtle">' + esc(e.criadoEmFormatted) + '</div>' +
      '<div class="maDetailField"><span class="maDetailLabel">Ocorrências suprimidas</span><span class="maDetailValue">' + esc(e.ocorrenciasSuprimidas) + '</span></div>' +
      (e.ativo ? '<span class="maBadge maBadgeActive">ATIVA</span>' : '<span class="maBadge maBadgeInvited">REVOGADA</span>') +
      (e.ativo ? '<div class="maDetailActions"><button type="button" class="modBtn modBtnDanger pcRevogarBtn" data-key="' + esc(e.id) + '">Revogar exceção</button></div>' : '') +
      '</div>';
  }
  function renderExcecoesTab() {
    var st = pcState.excecoes;
    if (st.error) {
      return errorStateHtml(st.error.state, st.error.message) + '<div class="maDetailActions"><button type="button" class="modBtn" id="pcExcRetryBtn">Tentar novamente</button></div>';
    }
    if (st.loading || !st.loaded) {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando exceções...</div>';
    }
    var tipoSel = '<select id="pcExcFilterTipo"><option value="">TODOS</option><option value="CPF"' + (st.filtroTipo === 'CPF' ? ' selected' : '') + '>CPF</option><option value="NBS"' + (st.filtroTipo === 'NBS' ? ' selected' : '') + '>NBS</option></select>';
    var ativoSel = '<select id="pcExcFilterAtivo"><option value="true"' + (st.filtroAtivo === true ? ' selected' : '') + '>Ativas</option><option value="false"' + (st.filtroAtivo === false ? ' selected' : '') + '>Revogadas</option></select>';
    var rowsHtml = st.rows.map(pcExcecaoRowHtml).join('');
    var listHtml = '<div class="adminListWrap">' + (rowsHtml || '<p class="modSubtitle">Nenhuma exceção cadastrada.</p>') + '</div>';
    var motivoOpts = window.NX_MASTER_PENDENCIAS_VIEW_MODEL.PC_MOTIVOS_IGNORAR.map(function (m) { return '<option value="' + esc(m[0]) + '">' + esc(m[1]) + '</option>'; }).join('');
    var html = '<p class="modSubtitle">Exceções suprimem novas ocorrências de alertas para um CPF ou Login NBS específico (ex.: frota, revenda). Identificador forte apenas — nunca por nome.</p>';
    if (successMessage) { html += '<div class="modSuccessState" role="status">' + esc(successMessage) + '</div>'; successMessage = null; }
    html += '<div class="modFilters"><div class="modField"><label for="pcExcFilterTipo">Tipo</label>' + tipoSel + '</div><div class="modField"><label for="pcExcFilterAtivo">Status</label>' + ativoSel + '</div></div>' +
      listHtml;
    if (pendingConfirm && pendingConfirm.kind === 'pcRevogarExcecao') {
      html += confirmHtml(pendingConfirm.title, pendingConfirm.body, pendingConfirm.confirmLabel, pendingConfirm.destructive, pendingConfirm.bodyHtml, pendingConfirm.error);
    }
    html += '<h3 class="pcModalSubhead">Criar exceção manual</h3>' +
      '<p class="modSubtitle">Use para cadastrar previamente identificadores que nunca devem gerar alerta (ex.: frota, revenda), antes mesmo de uma nova importação.</p>' +
      (st.formError ? '<p class="maFieldError" role="alert">' + esc(st.formError) + '</p>' : '') +
      '<div class="modFilters">' +
      '<div class="modField"><label for="pcExcTipo">Tipo</label><select id="pcExcTipo"><option value="">Selecione...</option><option value="CPF">CPF</option><option value="NBS">NBS</option></select></div>' +
      '<div class="modField"><label for="pcExcValor">Identificador</label><input id="pcExcValor" placeholder="CPF ou Login NBS"></div>' +
      '<div class="modField"><label for="pcExcMotivo">Motivo</label><select id="pcExcMotivo"><option value="">Selecione...</option>' + motivoOpts + '</select></div>' +
      '<div class="modField"><label for="pcExcObs">Observação (opcional)</label><input id="pcExcObs" placeholder="Detalhe adicional"></div>' +
      '</div>' +
      '<div class="maDetailActions"><button type="button" class="modBtn" id="pcExcSalvarBtn"' + (inFlight.pcExcecao ? ' disabled' : '') + '>Criar exceção</button></div>';
    return html;
  }
  function pcSalvarExcecaoManual() {
    var tipo = (document.getElementById('pcExcTipo') || {}).value || '';
    var valor = (document.getElementById('pcExcValor') || {}).value || '';
    var motivo = (document.getElementById('pcExcMotivo') || {}).value || '';
    var obs = (document.getElementById('pcExcObs') || {}).value || null;
    if (!tipo || !valor.trim() || !motivo) {
      pcState.excecoes.formError = 'Preencha tipo, identificador e motivo.';
      renderPanel();
      return;
    }
    if (inFlight.pcExcecao) return;
    inFlight.pcExcecao = true;
    window.NX_MASTER_PENDENCIAS_PROVIDER.criarExcecao(tipo, valor, motivo, obs, {}).then(function (resp) {
      inFlight.pcExcecao = false;
      pcState.excecoes.formError = null;
      var propagados = Number(resp.propagados) || 0;
      successMessage = 'Exceção criada.' + (propagados > 0 ? ' ' + propagados + ' pendência(s) do mesmo identificador ' + (propagados === 1 ? 'foi ignorada' : 'foram ignoradas') + '.' : '');
      pcState.excecoes.loaded = false;
      pcExcecoesLoad();
    }, function (err) {
      inFlight.pcExcecao = false;
      pcState.excecoes.formError = pcMutationErrorCopy(err);
      renderPanel();
    });
  }

  // Gate 16 (canonical column set) + Gate 24 (empty state, not error).
  function renderPendenciasSection() {
    var html = '<p class="modSubtitle">Governança dos alertas gerados automaticamente pela reconciliação de vendedores das Bases 01/02. Nenhum dado financeiro ou de cliente é exibido aqui.</p>';
    html += pcAbaSwitchHtml();
    if (pcState.aba === 'excecoes') {
      return html + renderExcecoesTab();
    }
    if (pcState.error) {
      return html + errorStateHtml(pcState.error.state, pcState.error.message) +
        '<div class="maDetailActions"><button type="button" class="modBtn" id="pcRetryBtn">Tentar novamente</button></div>';
    }
    if (pcState.loading || !pcState.loaded) {
      return html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando pendências cadastrais...</div>';
    }
    if (successMessage && !pcDetailId) {
      html += '<div class="modSuccessState" role="status">' + esc(successMessage) + '</div>';
      successMessage = null;
    }
    html += pcSummaryCardsHtml();
    html += pcTabsHtml();
    html += pcFiltersHtml();
    html += '<div id="pcResultsArea">' + pcResultsAreaHtml() + '</div>';
    return html;
  }

  // ==================== Gestão de Bases (Painel Master Phase PM-5C) ====================
  // Real backend reuse only -- 8 already-deployed, already-audited
  // master_operational_* RPCs (PM-5C Gate 5/13/38), no new backend. This
  // section's own homologation-mode gate lives in the PROVIDER (ported
  // from V1's own gbRpc/GB_HOMOLOGATION_MODE, see master-gestao-bases-
  // provider.js) -- every write RPC auto-simulates on any non-production
  // hostname, so this file never needs its own separate safety check.
  var GB_VM = window.NX_MASTER_GESTAO_BASES_VM;
  var GB_PROVIDER = window.NX_MASTER_GESTAO_BASES_PROVIDER;

  function gbEnter() {
    if (gbState.loaded || gbState.loading) { renderPanel(); return; }
    gbLoad();
  }

  function gbLoad() {
    gbState.loading = true;
    gbState.error = null;
    renderPanel();
    GB_PROVIDER.listBatches({}).then(
      function (batches) {
        gbState.officialBatches = GB_VM.selectOfficialBatches(batches);
        gbState.loading = false;
        gbState.loaded = true;
        renderPanel();
      },
      function (err) {
        gbState.loading = false;
        gbState.loaded = false;
        gbState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function gbLoadSellersCache(force) {
    if (gbState.sellersByNbs && !force) return Promise.resolve(gbState.sellersByNbs);
    return GB_PROVIDER.listSellers({}).then(function (rows) {
      var byNbs = {};
      (rows || []).forEach(function (s) {
        var nbs = GB_VM.gbNormalize(s.nbs);
        if (nbs) byNbs[nbs] = s;
      });
      gbState.sellersByNbs = byNbs;
      return byNbs;
    });
  }

  function gbCardHtml(sourceType, info) {
    var label = GB_VM.SOURCE_LABELS[sourceType];
    var v = info && info.validated;
    var pendingBadge = (sourceType === 'FINANCE_CURRENT' && gbState.sessionFinanceBatch)
      ? '<div class="gbPendingNote">⏳ A Base 02 desta sessão está em validação — confirme-a para torná-la oficial.</div>'
      : '';
    var legadoNote = (sourceType === 'COLABORADORES')
      ? '<p class="note gbLegadoNote">Não é mais necessário para que vendedores novos sejam reconhecidos — o cadastro no Portal (com Login NBS) já é suficiente. Use somente para enriquecer/atualizar dados históricos legados.</p>'
      : '';
    var body = v ? (
      '<div class="gbRow"><span>Arquivo</span><b>' + esc(v.original_filename || '-') + '</b></div>' +
      '<div class="gbRow"><span>Atualizado em</span><b>' + esc(GB_VM.gbFmtDateTime(v.completed_at)) + '</b></div>' +
      '<div class="gbRow"><span>Período</span><b>' + esc(GB_VM.gbFmtDate(v.period_start)) + ' → ' + esc(GB_VM.gbFmtDate(v.period_end)) + '</b></div>' +
      '<div class="gbRow"><span>Linhas lidas</span><b>' + esc(GB_VM.gbFmtNum(v.rows_read)) + '</b></div>' +
      '<div class="gbRow"><span>Aceitas</span><b>' + esc(GB_VM.gbFmtNum(v.rows_accepted)) + '</b></div>' +
      '<div class="gbRow"><span>Rejeitadas</span><b>' + esc(GB_VM.gbFmtNum(v.rows_rejected)) + '</b></div>' +
      '<div class="gbRow"><span>Status</span><b class="gbStatusOk">VALIDADO</b></div>'
    ) : '<p class="note">Nenhuma carga validada ainda para esta base.</p>';
    return '<div class="gbCard">' +
      '<h3>' + esc(label) + '</h3>' + body + pendingBadge + legadoNote +
      '<button type="button" class="modBtn gbUpdateBtn" data-source-type="' + esc(sourceType) + '"' + (inFlight.gbImport ? ' disabled' : '') + '>ATUALIZAR</button>' +
      '</div>';
  }

  function renderGestaoBasesSection() {
    var homologBanner = (GB_PROVIDER.isHomologationMode())
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO HOMOLOGAÇÃO — nenhuma alteração será gravada neste ambiente.</p>'
      : '';
    var html = '<h2>Gestão de Bases</h2>' +
      '<p class="note">Bases operacionais do portal: Vendas, Financiamentos e Complementar. A base atual permanece válida até você confirmar a atualização.</p>' +
      homologBanner;
    if (gbState.error) {
      html += errorStateHtml(gbState.error.state, gbState.error.message) +
        '<button type="button" id="gbRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (gbState.loading || !gbState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando status das bases...</div>';
    } else {
      html += '<div class="gbGrid">' + GB_VM.SOURCE_ORDER.map(function (src) {
        return gbCardHtml(src, gbState.officialBatches[src]);
      }).join('') + '</div>';
    }
    html += '<input type="file" id="gbFileInput" accept=".xlsx,.xls" hidden>';
    return html;
  }

  // ---------- modal root (shared #nxModalRoot, per this Phase's own Gate) ----------
  function renderGbModalRoot() {
    if (!gbState.modal) { if (currentSection === 'gestaoBases') clearNxModal(); return; }
    var m = gbState.modal;
    if (m.kind === 'diagnostic') renderNxModal(m.titulo + ' — VALIDAÇÃO', gbDiagnosticBodyHtml(m), gbCancelar);
    else if (m.kind === 'progress') renderNxModal(m.titulo, gbProgressBodyHtml(), function () {});
    else if (m.kind === 'success') renderNxModal((gbHomolog() ? '🧪 ' : '✅ ') + m.titulo, gbSuccessBodyHtml(m), gbCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Erro', gbErrorBodyHtml(m), gbCloseModal);
    wireGbModalInteraction();
  }
  // Mirrors wireUserModalInteraction()'s own precedent: renderNxModal only
  // wires the shared backdrop/close-X (via its own onClose param) -- any
  // interactive element INSIDE the modal body needs its own wiring call
  // right after the modal (re)renders, never folded into the outer
  // wireInteraction() (which only runs after a full #maPanel re-render,
  // never after a modal-only update like a diagnostic->success swap).
  function wireGbModalInteraction() {
    var gbFixColaboradores = document.querySelector('.gbFixColaboradoresBtn');
    if (gbFixColaboradores) gbFixColaboradores.addEventListener('click', function () {
      gbCancelar();
      window.gbOnAtualizarClick('COLABORADORES');
    });
    var gbCancelarBtn = document.getElementById('gbCancelarBtn');
    if (gbCancelarBtn) gbCancelarBtn.addEventListener('click', gbCancelar);
    var gbConfirmarBtn = document.getElementById('gbConfirmarBtn');
    if (gbConfirmarBtn) gbConfirmarBtn.addEventListener('click', gbConfirmarHandler);
    var gbSuccessClose = document.getElementById('gbSuccessCloseBtn');
    if (gbSuccessClose) gbSuccessClose.addEventListener('click', gbCloseModalAndRefresh);
    var gbErrorClose = document.getElementById('gbErrorCloseBtn');
    if (gbErrorClose) gbErrorClose.addEventListener('click', gbCloseModal);
  }

  // Mirrors wireGbModalInteraction()'s own precedent: renderNxModal only
  // wires the shared backdrop/close-X; anything inside the modal body
  // needs its own wiring call right after the modal (re)renders.
  function wireGsModalInteraction() {
    var gsCancelarBtn = document.getElementById('gsCancelarBtn');
    if (gsCancelarBtn) gsCancelarBtn.addEventListener('click', gsCancelar);
    var gsConfirmarBtn = document.getElementById('gsConfirmarBtn');
    if (gsConfirmarBtn) gsConfirmarBtn.addEventListener('click', gsConfirmarHandler);
    var gsSuccessClose = document.getElementById('gsSuccessCloseBtn');
    if (gsSuccessClose) gsSuccessClose.addEventListener('click', gsCloseModalAndRefresh);
    var gsErrorClose = document.getElementById('gsErrorCloseBtn');
    if (gsErrorClose) gsErrorClose.addEventListener('click', gsCloseModal);
  }

  function wireCfgModalInteraction() {
    var cancelBtn = document.getElementById('cfgConfirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', cfgCancelConfirm);
    var saveBtn = document.getElementById('cfgConfirmSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', cfgConfirmSaveHandler);
    var successClose = document.getElementById('cfgSuccessCloseBtn');
    if (successClose) successClose.addEventListener('click', cfgCloseModalAndRefresh);
    var errorClose = document.getElementById('cfgErrorCloseBtn');
    if (errorClose) errorClose.addEventListener('click', cfgCloseModal);
  }

  function wirePrModalInteraction() {
    var cancelBtn = document.getElementById('prConfirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', prCancelConfirm);
    var archiveBtn = document.getElementById('prConfirmArchiveBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', prConfirmArchiveHandler);
    var successClose = document.getElementById('prSuccessCloseBtn');
    if (successClose) successClose.addEventListener('click', prCloseModalAndRefresh);
    var errorClose = document.getElementById('prErrorCloseBtn');
    if (errorClose) errorClose.addEventListener('click', prCloseModal);
  }
  function wireAbsModalInteraction() {
    var cancelBtn = document.getElementById('absConfirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', absCancelConfirm);
    var archiveBtn = document.getElementById('absConfirmArchiveBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', absConfirmArchiveHandler);
    var successClose = document.getElementById('absSuccessCloseBtn');
    if (successClose) successClose.addEventListener('click', absCloseModalAndRefresh);
    var errorClose = document.getElementById('absErrorCloseBtn');
    if (errorClose) errorClose.addEventListener('click', absCloseModal);
  }

  function wireScModalInteraction() {
    var cancelBtn = document.getElementById('scConfirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', scCancelConfirm);
    var archiveBtn = document.getElementById('scConfirmArchiveBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', scConfirmArchiveHandler);
    var deptCancelBtn = document.getElementById('scEditDeptCancelBtn');
    if (deptCancelBtn) deptCancelBtn.addEventListener('click', scCloseModal);
    var deptSaveBtn = document.getElementById('scEditDeptSaveBtn');
    if (deptSaveBtn) deptSaveBtn.addEventListener('click', scEditDeptSaveHandler);
    var successClose = document.getElementById('scSuccessCloseBtn');
    if (successClose) successClose.addEventListener('click', scCloseModalAndRefresh);
    var errorClose = document.getElementById('scErrorCloseBtn');
    if (errorClose) errorClose.addEventListener('click', scCloseModal);
  }

  function gbHomolog() { return GB_PROVIDER.isHomologationMode(); }
  function gbCloseModal() { gbState.modal = null; clearNxModal(); }
  function gbCloseModalAndRefresh() { gbState.modal = null; clearNxModal(); gbState.loaded = false; gbEnter(); }
  function gbCancelar() { gbState.modal = null; clearNxModal(); }

  // Double-submit guard (Gate 24/32 precedent, same discipline as every
  // other mutation in this file -- one flag per distinct action).
  function gbConfirmarHandler() {
    if (inFlight.gbImport) return;
    var onConfirmar = gbState.modal && gbState.modal.onConfirmar;
    if (typeof onConfirmar !== 'function') return;
    inFlight.gbImport = true;
    var btn = document.getElementById('gbConfirmarBtn');
    if (btn) btn.disabled = true;
    onConfirmar().then(
      function () { inFlight.gbImport = false; },
      function (err) {
        inFlight.gbImport = false;
        var msg = document.getElementById('gbDiagMsg');
        if (msg) msg.textContent = 'Erro ao confirmar: ' + safeErrorMessage();
        if (btn) btn.disabled = false;
      }
    );
  }

  function gbDiagnosticBodyHtml(m) {
    var ok = m.okOverride !== undefined ? m.okOverride : (m.aceitas > 0 || m.linhasLidas === 0);
    var avisosHtml = (m.avisos && m.avisos.length)
      ? '<div class="gbWarn">' + m.avisos.map(function (a) { return '<div>⚠️ ' + esc(a) + '</div>'; }).join('') + '</div>' : '';
    var listaHtml = (m.listaPendente && m.listaPendente.length)
      ? '<div class="gbMissingList">' + m.listaPendente.map(function (x) { return '<div>' + esc(x.nome) + ' <span class="gbMuted">(' + esc(x.nbs) + ')</span></div>'; }).join('') + '</div>' +
        '<button type="button" class="modBtnGhost gbFixColaboradoresBtn">ATUALIZAR COLABORADORES</button>'
      : '';
    return '<div class="gbRow"><span>Arquivo</span><b>' + esc(m.arquivo) + '</b></div>' +
      '<div class="gbRow"><span>Linhas lidas</span><b>' + esc(GB_VM.gbFmtNum(m.linhasLidas)) + '</b></div>' +
      '<div class="gbRow"><span>Aceitas</span><b>' + esc(GB_VM.gbFmtNum(m.aceitas)) + '</b></div>' +
      '<div class="gbRow"><span>Rejeitadas</span><b>' + esc(GB_VM.gbFmtNum(m.rejeitadas)) + '</b></div>' +
      '<div class="gbRow"><span>Status</span><b class="' + (ok ? 'gbStatusOk' : 'gbStatusBad') + '">' + (ok ? '🟢 PRONTO PARA ATUALIZAÇÃO' : '🔴 ARQUIVO REJEITADO') + '</b></div>' +
      listaHtml + (m.extraHtml || '') + avisosHtml +
      '<p class="note">A base oficial atual continua sendo usada pelas análises até você confirmar.</p>' +
      '<p id="gbDiagMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="gbCancelarBtn">CANCELAR</button>' +
      '<button type="button" class="modBtn" id="gbConfirmarBtn"' + (ok ? '' : ' disabled') + (inFlight.gbImport ? ' disabled' : '') + '>CONFIRMAR ATUALIZAÇÃO</button>' +
      '</div>';
  }
  function gbProgressBodyHtml() {
    return '<div class="gbProgressWrap"><div id="gbProgressBar" class="gbProgressBar"></div></div><p id="gbProgressText" class="note">Iniciando...</p>';
  }
  function gbSuccessBodyHtml(m) {
    var tituloLinha = gbHomolog()
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração foi realizada no banco</b></p>'
      : '<p><b>BASE ATUALIZADA COM SUCESSO</b></p>';
    return tituloLinha +
      '<div class="gbRow"><span>Arquivo</span><b>' + esc(m.arquivo) + '</b></div>' +
      '<div class="gbRow"><span>Registros</span><b>' + esc(GB_VM.gbFmtNum(m.registros)) + '</b></div>' +
      '<div class="gbRow"><span>Data/hora</span><b>' + esc(GB_VM.gbFmtDateTime(new Date().toISOString())) + '</b></div>' +
      (m.notaExtra ? '<p class="note">' + esc(m.notaExtra) + '</p>' : '') +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="gbSuccessCloseBtn">Fechar</button></div>';
  }
  function gbErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao processar o arquivo.') + '</p>' +
      '<p class="note">A base oficial anterior não foi alterada.</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="gbErrorCloseBtn">Fechar</button></div>';
  }

  function gbSetProgress(done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    var bar = document.getElementById('gbProgressBar');
    var txt = document.getElementById('gbProgressText');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = GB_VM.gbFmtNum(done) + ' / ' + GB_VM.gbFmtNum(total) + ' registros (' + pct + '%)';
  }
  function gbShowProgress(titulo) {
    gbState.modal = { kind: 'progress', titulo: titulo };
    renderGbModalRoot();
  }
  function gbShowDiagnostic(opts) {
    gbState.modal = {
      kind: 'diagnostic', titulo: opts.titulo, arquivo: opts.arquivo, linhasLidas: opts.linhasLidas,
      aceitas: opts.aceitas, rejeitadas: opts.rejeitadas, avisos: opts.avisos || [],
      listaPendente: opts.listaPendente || [], extraHtml: opts.extraHtml || '',
      okOverride: opts.okOverride, onConfirmar: opts.onConfirmar
    };
    renderGbModalRoot();
  }
  function gbShowSuccess(titulo, arquivo, registros, notaExtra) {
    gbState.modal = { kind: 'success', titulo: titulo, arquivo: arquivo, registros: registros, notaExtra: notaExtra };
    renderGbModalRoot();
  }
  function gbShowError(message) {
    gbState.modal = { kind: 'error', message: message };
    renderGbModalRoot();
  }

  function gbImportChunked(rpcFn, batchId, rows) {
    var chunks = GB_VM.gbChunk(rows, GB_VM.CHUNK_SIZE);
    var accepted = 0;
    var i = 0;
    function next() {
      if (i >= chunks.length) return Promise.resolve(accepted);
      return rpcFn(batchId, chunks[i]).then(function (count) {
        accepted += Number(count) || 0;
        i++;
        gbSetProgress(Math.min(i * GB_VM.CHUNK_SIZE, rows.length), rows.length);
        return next();
      });
    }
    return next();
  }

  function gbAnchorFor(sourceType) { return GB_VM.HEADER_ANCHORS[sourceType]; }

  window.gbOnAtualizarClick = function (sourceType) {
    gbState.pendingSourceType = sourceType;
    var input = document.getElementById('gbFileInput');
    if (input) input.click();
  };

  function gbOnFileChosen(file) {
    var sourceType = gbState.pendingSourceType;
    if (!file || !sourceType) return;
    gbShowProgress('Lendo ' + file.name + '...');
    GB_VM.gbReadSheet(file, gbAnchorFor(sourceType)).then(function (sheet) {
      if (!sheet.rows.length) return Promise.reject({ message: 'Arquivo vazio ou sem linhas de dados reconhecíveis.' });
      return GB_VM.gbSha256Hex(sheet.buf).then(function (sha256) {
        if (sourceType === 'SALES_CURRENT') return gbProcessarBase01(file, sheet.rows, sha256);
        if (sourceType === 'FINANCE_CURRENT') return gbProcessarBase02(file, sheet.rows, sha256);
        if (sourceType === 'SPF_CURRENT') return gbProcessarBase03(file, sheet.rows, sha256, sheet.date1904);
        if (sourceType === 'COLABORADORES') return gbProcessarColaboradores(file, sheet.rows, sha256);
        return Promise.reject({ message: 'Tipo de base desconhecido.' });
      });
    }).catch(function (e) {
      gbShowError(String((e && e.message) || e));
    });
  }

  function gbProcessarBase01(file, rawRows, sha256) {
    return gbLoadSellersCache().then(function (sellersByNbs) {
      var mapped = rawRows.map(function (r, i) { return GB_VM.gbBuildBase01Row(r, i + 1, sellersByNbs); });
      var semDepartamento = mapped.filter(function (r) { return !r._diagOk; }).length;
      var rowsToSend = mapped.map(function (r) { var c = {}; Object.keys(r).forEach(function (k) { if (k !== '_diagOk') c[k] = r[k]; }); return c; });

      var missingByNbs = {};
      var semVendedorNoArquivo = 0;
      mapped.forEach(function (r) {
        if (!r.seller_nbs || sellersByNbs[r.seller_nbs]) return;
        if (r.seller_nbs === 'NBS') { semVendedorNoArquivo++; return; }
        missingByNbs[r.seller_nbs] = { nbs: r.seller_nbs, nome: r.seller_source_name || r.seller_nbs };
      });
      var missingList = Object.keys(missingByNbs).map(function (k) { return missingByNbs[k]; });

      gbSetProgress(0, rowsToSend.length);
      return GB_PROVIDER.beginImport('SALES_CURRENT', file.name, sha256, rowsToSend.length).then(function (batchId) {
        return gbImportChunked(GB_PROVIDER.importSales, batchId, rowsToSend).then(function (accepted) {
          var rejected = rowsToSend.length - accepted;
          var avisos = [];
          if (semDepartamento) avisos.push(semDepartamento + ' registro(s) com departamento não reconhecido — foram enviados mesmo assim e podem ter sido rejeitados pela validação do servidor.');
          if (missingList.length) avisos.push(missingList.length + ' código(s) de vendedor (coluna "Vendedor") não encontrado(s) no cadastro — a loja dessas linhas usou o texto do arquivo.');
          if (semVendedorNoArquivo) avisos.push(GB_VM.gbFmtNum(semVendedorNoArquivo) + ' linha(s) sem vendedor individual identificado no próprio arquivo (código "NBS").');

          gbShowDiagnostic({
            titulo: 'BASE 01 — VENDAS', arquivo: file.name, linhasLidas: rowsToSend.length,
            aceitas: accepted, rejeitadas: rejected, avisos: avisos, listaPendente: missingList,
            onConfirmar: function () {
              return GB_PROVIDER.finalizeImport(batchId, accepted, rejected, 'Gestão de Bases: ' + accepted + ' aceitas, ' + rejected + ' rejeitadas.')
                .then(function () { gbShowSuccess('BASE 01 — VENDAS', file.name, accepted); });
            }
          });
        });
      });
    });
  }

  function gbProcessarBase02(file, rawRows, sha256) {
    return gbLoadSellersCache().then(function (sellersByNbs) {
      var mapped = rawRows.map(function (r, i) { return GB_VM.gbBuildBase02Row(r, i + 1, sellersByNbs); });
      var rowsToSend = mapped.map(function (r) { var c = {}; Object.keys(r).forEach(function (k) { if (k !== '_diagOk') c[k] = r[k]; }); return c; });

      var missingByNbs = {};
      mapped.forEach(function (r) {
        if (!r.seller_cpf && r.seller_nbs) missingByNbs[r.seller_nbs] = { nbs: r.seller_nbs, nome: r.seller_source_name || r.seller_nbs };
      });
      var missingList = Object.keys(missingByNbs).map(function (k) { return missingByNbs[k]; });

      gbSetProgress(0, rowsToSend.length);
      return GB_PROVIDER.beginImport('FINANCE_CURRENT', file.name, sha256, rowsToSend.length).then(function (batchId) {
        return gbImportChunked(GB_PROVIDER.importFinance, batchId, rowsToSend).then(function (accepted) {
          var rejected = rowsToSend.length - accepted;
          gbState.sessionFinanceBatch = {
            batchId: batchId,
            pendentesRaw: rawRows.map(function (raw, i) { return { raw: raw, rowNumber: i + 1 }; })
              .filter(function (_, i) { return !mapped[i].seller_cpf && mapped[i].seller_nbs; })
          };
          gbState.lastMissingSellers = missingList;

          gbShowDiagnostic({
            titulo: 'BASE 02 — FINANCIAMENTOS', arquivo: file.name, linhasLidas: rowsToSend.length,
            aceitas: accepted, rejeitadas: rejected,
            avisos: missingList.length ? [missingList.length + ' registro(s) cujo vendedor (coluna "Vendedor") não foi encontrado no cadastro — loja/CPF ficaram em branco para essas linhas.'] : [],
            listaPendente: missingList,
            extraHtml: '<p class="note">Este lote permanece em validação até você confirmar. A Base 03 pode ser atualizada a qualquer momento, mesmo depois de confirmar esta Base 02 — ela localiza a versão oficial automaticamente.</p>',
            onConfirmar: function () {
              return GB_PROVIDER.finalizeImport(batchId, accepted, rejected, 'Gestão de Bases: ' + accepted + ' aceitas, ' + rejected + ' rejeitadas.')
                .then(function () {
                  gbState.sessionFinanceBatch = null;
                  gbShowSuccess('BASE 02 — FINANCIAMENTOS', file.name, accepted);
                });
            }
          });
        });
      });
    });
  }

  function gbProcessarBase03(file, rawRows, sha256, date1904) {
    gbSetProgress(0, rawRows.length);
    var cls = GB_VM.gbClassifyBase03Rows(rawRows, date1904);
    var financeRows = GB_VM.gbBuildBase03FinanceRows(rawRows);

    gbSetProgress(0, 1);
    return GB_PROVIDER.applyBase03(file.name, sha256, financeRows, cls.allRows, true).then(function (preview) {
      gbSetProgress(1, 1);
      var extraHtml = '<div class="gbRow"><span>Enriquecimento financeiro (clientes que serão atualizados na Base 02 oficial)</span><b>' + esc(GB_VM.gbFmtNum(preview.finance_rows_matched)) + '</b></div>' +
        '<div class="gbRow"><span>Linhas operacionais principais</span><b>' + esc(GB_VM.gbFmtNum(cls.principalRows.length)) + '</b></div>' +
        '<div class="gbRow"><span>Linhas SPF Extra (complementares)</span><b>' + esc(GB_VM.gbFmtNum(cls.spfRows.length)) + '</b></div>' +
        (cls.discardedTotalRows ? '<div class="gbRow"><span>Linhas descartadas (subtotais/lixo de planilha)</span><b>' + esc(GB_VM.gbFmtNum(cls.discardedTotalRows)) + '</b></div>' : '') +
        '<p class="note">A confirmação aplica tudo em uma única operação no banco: ou os dados financeiros e o SPF (principais + complementares) são atualizados juntos, ou nada é alterado.</p>' +
        (gbHomolog() ? '<p class="note gbWarn">🧪 MODO HOMOLOGAÇÃO: ao confirmar, nenhuma escrita real ocorrerá — os números acima já vêm de uma consulta real (p_dry_run=true), só a gravação final é simulada.</p>' : '');

      gbShowDiagnostic({
        titulo: 'BASE 03 — COMPLEMENTAR / F&I', arquivo: file.name, linhasLidas: rawRows.length,
        aceitas: cls.allLikelyAccepted, rejeitadas: cls.allLikelyRejected, avisos: [],
        okOverride: cls.principalRows.length > 0 || rawRows.length === 0,
        extraHtml: extraHtml,
        onConfirmar: function () {
          // Em homologação, o resultado é montado a partir dos números já
          // comprovados pelo próprio dry_run acima (uma consulta real) --
          // nunca inventa dado novo, só não grava. O gate da provider
          // também bloquearia a chamada real aqui (defesa em profundidade),
          // mas essa rota genérica devolveria zeros -- V1's own precedent
          // (master-gestao-bases.js's gbProcessarBase03) always prefers
          // the real dry-run numbers for the homologation success screen.
          var resultPromise = gbHomolog()
            ? Promise.resolve({
                dry_run: false, simulated: true,
                finance_batch_id: preview.finance_batch_id, finance_rows_matched: preview.finance_rows_matched,
                spf_rows_received: cls.allRows.length, spf_accepted: cls.allLikelyAccepted, spf_rejected: cls.allLikelyRejected
              })
            : GB_PROVIDER.applyBase03(file.name, sha256, financeRows, cls.allRows, false);
          return resultPromise.then(function (result) {
            gbShowSuccess('BASE 03 — COMPLEMENTAR / F&I', file.name, result.spf_accepted || 0);
          });
        }
      });
    });
  }

  function gbProcessarColaboradores(file, rawRows, sha256) {
    var mappedAll = rawRows.map(function (r) { return GB_VM.gbBuildColaboradorRow(r); });
    var lastByCpf = {};
    var cpfOrder = [];
    var semCpfValido = [];
    mappedAll.forEach(function (r) {
      if (/^[0-9]{11}$/.test(r.cpf)) {
        if (!(r.cpf in lastByCpf)) cpfOrder.push(r.cpf);
        lastByCpf[r.cpf] = r;
      } else {
        semCpfValido.push(r);
      }
    });
    var duplicados = mappedAll.length - cpfOrder.length - semCpfValido.length;
    var mapped = cpfOrder.map(function (cpf) { return lastByCpf[cpf]; }).concat(semCpfValido);
    gbSetProgress(0, mapped.length);

    return GB_PROVIDER.beginImport('COLABORADORES', file.name, sha256, mappedAll.length).then(function (batchId) {
      return gbImportChunked(GB_PROVIDER.importSellers, batchId, mapped).then(function (accepted) {
        var rejected = mapped.length - accepted;
        gbShowDiagnostic({
          titulo: 'COLABORADORES / VENDEDORES', arquivo: file.name, linhasLidas: mappedAll.length,
          aceitas: accepted, rejeitadas: rejected + duplicados,
          avisos: duplicados ? [duplicados + ' CPF(s) apareciam mais de uma vez no arquivo — foi mantida apenas a linha mais recente de cada um.'] : [],
          onConfirmar: function () {
            return GB_PROVIDER.finalizeImport(batchId, accepted, rejected, 'Gestão de Bases: ' + accepted + ' aceitas, ' + rejected + ' rejeitadas.')
              .then(function () { return gbLoadSellersCache(true); })
              .then(function () { return gbReprocessarPendentesBase02(); })
              .then(function (reprocessados) {
                gbShowSuccess('COLABORADORES / VENDEDORES', file.name, accepted,
                  reprocessados ? (reprocessados + ' linha(s) da Base 02 desta sessão foram atualizadas com o vendedor agora encontrado.') : '');
              });
          }
        });
      });
    });
  }

  function gbReprocessarPendentesBase02() {
    var fb = gbState.sessionFinanceBatch;
    if (!fb || !fb.pendentesRaw || !fb.pendentesRaw.length) return Promise.resolve(0);
    return gbLoadSellersCache().then(function (sellersByNbs) {
      var resolvedRows = [];
      var stillMissing = [];
      fb.pendentesRaw.forEach(function (p) {
        var row = GB_VM.gbBuildBase02Row(p.raw, p.rowNumber, sellersByNbs);
        if (row.seller_cpf) {
          var c = {}; Object.keys(row).forEach(function (k) { if (k !== '_diagOk') c[k] = row[k]; });
          resolvedRows.push(c);
        } else {
          stillMissing.push(p);
        }
      });
      var afterResolve = resolvedRows.length
        ? gbImportChunked(GB_PROVIDER.importFinance, fb.batchId, resolvedRows)
        : Promise.resolve(0);
      return afterResolve.then(function () {
        fb.pendentesRaw = stillMissing;
        return resolvedRows.length;
      });
    });
  }

  // ==================== Gestão dos Simuladores (Painel Master Phase PM-5D) ====================
  // Real backend reuse only -- 10 write RPCs (master_simulador_commit_*,
  // one overloaded -- see the provider's own note on always sending
  // p_linhas_coeficiente explicitly) + 1 read (master_simulador_listar_
  // bases), recovered live via pg_get_functiondef since NONE of these
  // functions nor their 10 underlying tables exist anywhere in this
  // codebase's Git history (PM-5D Gate 18). Same homologation-mode
  // safety gate as Gestão de Bases, INDEPENDENTLY confirmed identical
  // for this capability (PM-5D Gate 34) -- ported, not assumed.
  //
  // ABSOLUTE FREEZE (PM-5D Gate 3): this section only reshapes a
  // spreadsheet into the exact real RPC payload shape and displays the
  // real dry-run diff the backend itself computes -- it computes zero
  // financing formulas. It also NEVER wires the V2 simulators'
  // (Simulador Novos/Seminovos) own consumption to this data -- those
  // are already Human-approved and explicitly FROZEN
  // ("Fechamos os simuladores.", see config/module-registry.json) with
  // 0 backend connection by their own prior, separate, deliberate
  // decision; this admin surface exists purely to migrate the ADMIN
  // capability, per this Phase's own mandatory Gate 4/25 separation.
  var GS_VM = window.NX_MASTER_GESTAO_SIMULADORES_VM;
  var GS_PROVIDER = window.NX_MASTER_GESTAO_SIMULADORES_PROVIDER;
  var GS_GROUPS = [['ZEROKM', 'ZeroKM'], ['SEMINOVOS', 'Seminovos']];

  function gsEnter() {
    if (gsState.loaded || gsState.loading) { renderPanel(); return; }
    gsLoad();
  }

  function gsLoad() {
    gsState.loading = true;
    gsState.error = null;
    renderPanel();
    GS_PROVIDER.listarBases({}).then(
      function (bases) {
        var byTipo = {};
        (bases || []).forEach(function (b) { byTipo[b.tipo_base] = b; });
        gsState.statusByTipo = byTipo;
        gsState.loading = false;
        gsState.loaded = true;
        renderPanel();
      },
      function (err) {
        gsState.loading = false;
        gsState.loaded = false;
        gsState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function gsCardHtml(def) {
    var info = gsState.statusByTipo[def.tipoBase];
    var sharedBadge = def.compartilhada ? '<span class="gsSharedBadge" title="Mesma base ACTIVE usada por ZeroKM e Seminovos">BASE COMPARTILHADA</span>' : '';
    var bootstrapBadge = (info && info.bootstrap) ? '<span class="gsBootstrapBadge">BASE INICIAL / BOOTSTRAP</span>' : '';
    var partialBadge = def.parcial ? '<span class="gsPartialBadge" title="' + esc(def.parcial) + '">ATUALIZAÇÃO PARCIAL</span>' : '';
    var body = info ? (
      '<div class="gbRow"><span>Status</span><b class="gbStatusOk">ACTIVE</b></div>' +
      '<div class="gbRow"><span>Versão (batch)</span><b>' + esc(String(info.batch_id || '-').slice(0, 8)) + '</b></div>' +
      '<div class="gbRow"><span>Arquivo</span><b>' + esc(info.arquivo_nome || '-') + '</b></div>' +
      '<div class="gbRow"><span>Importado em</span><b>' + esc(GS_VM.gsFmtDateTime(info.importado_em)) + '</b></div>' +
      '<div class="gbRow"><span>Registros</span><b>' + esc(GS_VM.gsFmtNum(info.quantidade_registros)) + '</b></div>' +
      '<div class="gbRow"><span>Responsável</span><b>' + esc(info.responsavel || '-') + '</b></div>'
    ) : '<p class="note">Nenhuma base ACTIVE encontrada.</p>';
    var avisos = (info && Array.isArray(info.avisos) && info.avisos.length)
      ? '<div class="gbWarn">' + info.avisos.map(function (a) { return '<div>⚠️ ' + esc(typeof a === 'string' ? a : JSON.stringify(a)) + '</div>'; }).join('') + '</div>' : '';
    var notaExtra = def.nota ? '<p class="note gsNotaExtra">' + esc(def.nota) + '</p>' : '';
    var parcialExtra = def.parcial ? '<p class="note gbWarn gsPartialNote">⚠️ ' + esc(def.parcial) + '</p>' : '';
    return '<div class="gbCard">' +
      '<h3>' + esc(def.label) + ' ' + sharedBadge + ' ' + bootstrapBadge + ' ' + partialBadge + '</h3>' +
      body + avisos + notaExtra + parcialExtra +
      '<button type="button" class="modBtn gsUpdateBtn" data-uid="' + esc(def.uid) + '"' + (inFlight.gsImport ? ' disabled' : '') + '>ATUALIZAR BASE</button>' +
      '</div>';
  }

  function renderGestaoSimuladoresSection() {
    var homologBanner = (GS_PROVIDER.isHomologationMode())
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO HOMOLOGAÇÃO — nenhuma atualização de base será gravada neste ambiente.</p>'
      : '';
    var html = '<h2>Gestão dos Simuladores</h2>' +
      '<p class="note">Atualize as bases de taxas/coeficientes/rebates que alimentam o Simulador ZeroKM e o Simulador Seminovos. As fórmulas de cálculo não são alteradas aqui — apenas a fonte de dados. A base ACTIVE atual permanece em uso pelo simulador até você revisar a prévia (dry-run) e confirmar explicitamente.</p>' +
      homologBanner;
    if (gsState.error) {
      html += errorStateHtml(gsState.error.state, gsState.error.message) +
        '<button type="button" id="gsRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (gsState.loading || !gsState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando status das bases...</div>';
    } else {
      html += GS_GROUPS.map(function (g) {
        var grupo = g[0], rotulo = g[1];
        var itens = GS_VM.GS_BASE_DEFS.filter(function (d) { return d.grupo === grupo; });
        return '<h3 class="gsGroupTitle">' + esc(rotulo) + '</h3><div class="gbGrid">' + itens.map(gsCardHtml).join('') + '</div>';
      }).join('');
    }
    html += '<input type="file" id="gsFileInput" accept=".xlsx,.xls" hidden>';
    return html;
  }

  // ---------- modal root (shared #nxModalRoot) ----------
  function renderGsModalRoot() {
    if (!gsState.modal) { if (currentSection === 'gestaoSimuladores') clearNxModal(); return; }
    var m = gsState.modal;
    if (m.kind === 'progress') renderNxModal(m.titulo, gsProgressBodyHtml(), function () {});
    else if (m.kind === 'diagnostic') renderNxModal(m.titulo + ' — PRÉVIA (DRY-RUN, nada foi gravado)', gsDiagnosticBodyHtml(m), gsCancelar);
    else if (m.kind === 'success') renderNxModal((gsHomolog() ? '🧪 ' : '✅ ') + m.titulo, gsSuccessBodyHtml(m), gsCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Arquivo rejeitado', gsErrorBodyHtml(m), gsCloseModal);
    wireGsModalInteraction();
  }
  function gsHomolog() { return GS_PROVIDER.isHomologationMode(); }
  function gsCloseModal() { gsState.modal = null; clearNxModal(); }
  function gsCloseModalAndRefresh() { gsState.modal = null; clearNxModal(); gsState.loaded = false; gsEnter(); }
  function gsCancelar() { gsState.modal = null; clearNxModal(); }

  function gsProgressBodyHtml() {
    return '<div class="gbProgressWrap"><div class="gbProgressBar" style="width:60%"></div></div><p class="note">Lendo e validando o arquivo localmente antes de qualquer chamada ao servidor...</p>';
  }
  // Generic diff renderer -- most RPCs return `comparacao_com_active`;
  // Coparticipado/Semestral return `comparacao_matriz_modelo` (its own
  // name, since there is a SECOND independent comparison for the
  // coefficient table) -- same shape either way (novos/alterados/
  // sem_alteracao/removidos + detalhe_alterados), rendered identically.
  function gsDiagnosticBodyHtml(m) {
    var dry = m.dry;
    var comp = dry.comparacao_com_active || dry.comparacao_matriz_modelo || {};
    var novos = comp.novos || 0, alterados = comp.alterados || 0, semAlt = comp.sem_alteracao || 0, removidos = comp.removidos || 0;
    var detalhes = comp.detalhe_alterados || [];
    var cols = detalhes.length ? Object.keys(detalhes[0]) : [];
    var detalheHtml = detalhes.length
      ? '<div class="gsTableWrap"><table class="gsTable"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody>' + detalhes.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(GS_VM.gsFmtValor(r[c])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="note">Nenhuma linha com valor alterado em relação à base ACTIVE atual.</p>';

    var avisosExtras = [];
    if (dry.aviso_tabela_geral) avisosExtras.push(dry.aviso_tabela_geral);
    if (dry.base_compartilhada) avisosExtras.push(dry.base_compartilhada);
    if (Array.isArray(m.argsBase.p_avisos)) m.argsBase.p_avisos.forEach(function (a) { avisosExtras.push(a); });
    if (dry.linhas_coeficiente) avisosExtras.push(dry.linhas_coeficiente + ' linha(s) para a tabela de coeficiente (prazo/taxa→coeficiente) também presentes — comparação separada, não exibida nesta prévia resumida.');
    var avisosHtml = avisosExtras.length ? '<div class="gbWarn">' + avisosExtras.map(function (a) { return '<div>⚠️ ' + esc(a) + '</div>'; }).join('') + '</div>' : '';

    var linhasValidas = (dry.linhas_validas !== undefined && dry.linhas_validas !== null) ? dry.linhas_validas
      : (dry.linhas_modelo_validas !== undefined && dry.linhas_modelo_validas !== null) ? dry.linhas_modelo_validas : 0;

    return '<div class="gbRow"><span>Arquivo</span><b>' + esc(m.arquivo) + '</b></div>' +
      '<div class="gbRow"><span>Linhas válidas no arquivo</span><b>' + esc(GS_VM.gsFmtNum(linhasValidas)) + '</b></div>' +
      '<div class="gbRow"><span>Novos</span><b>' + esc(GS_VM.gsFmtNum(novos)) + '</b></div>' +
      '<div class="gbRow"><span>Alterados</span><b>' + esc(GS_VM.gsFmtNum(alterados)) + '</b></div>' +
      '<div class="gbRow"><span>Sem alteração</span><b>' + esc(GS_VM.gsFmtNum(semAlt)) + '</b></div>' +
      '<div class="gbRow"><span>Removidos (não estão mais no arquivo)</span><b>' + esc(GS_VM.gsFmtNum(removidos)) + '</b></div>' +
      '<h4 class="gsDetailTitle">Detalhe das linhas alteradas (chave lógica, valor atual, valor novo)</h4>' +
      detalheHtml + avisosHtml +
      '<p class="note">A base ACTIVE atual continua sendo usada pelo simulador até você confirmar.</p>' +
      '<p id="gsDiagMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="gsCancelarBtn">CANCELAR</button>' +
      '<button type="button" class="modBtn" id="gsConfirmarBtn"' + (inFlight.gsImport ? ' disabled' : '') + '>CONFIRMAR ATUALIZAÇÃO</button>' +
      '</div>';
  }
  function gsSuccessBodyHtml(m) {
    var tituloLinha = gsHomolog()
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração foi realizada no banco</b></p>'
      : '<p><b>BASE ATUALIZADA COM SUCESSO</b></p>';
    return tituloLinha +
      '<div class="gbRow"><span>Arquivo</span><b>' + esc(m.arquivo) + '</b></div>' +
      '<div class="gbRow"><span>Novo batch (versão)</span><b>' + esc(String((m.result && m.result.batch_id) || '-').slice(0, 8)) + '</b></div>' +
      '<div class="gbRow"><span>Data/hora</span><b>' + esc(GS_VM.gsFmtDateTime(new Date().toISOString())) + '</b></div>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="gsSuccessCloseBtn">Fechar</button></div>';
  }
  function gsErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao processar o arquivo.') + '</p>' +
      '<p class="note">A base ACTIVE atual não foi alterada.</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="gsErrorCloseBtn">Fechar</button></div>';
  }

  window.gsOnAtualizarClick = function (uid) {
    gsState.pendingUid = uid;
    var input = document.getElementById('gsFileInput');
    if (input) input.click();
  };

  function gsOnFileChosen(file) {
    var uid = gsState.pendingUid;
    if (!file || !uid) return;
    gsState.modal = { kind: 'progress', titulo: 'Lendo ' + file.name + '...' };
    renderGsModalRoot();
    GS_VM.gsLerWorkbook(file).then(function (wbBuf) {
      var matrix = GS_VM.gsSheetMatrix(wbBuf.wb);
      return GS_VM.gsSha256Hex(wbBuf.buf).then(function (sha256) {
        var parsedFile = GS_VM.parseFile(uid, matrix);
        var def = parsedFile.def;
        var argsBase = Object.assign({ p_arquivo_nome: file.name, p_arquivo_sha256: sha256 }, def.montarArgs(parsedFile.parsed));
        return GS_PROVIDER.commit(def.rpc, Object.assign({}, argsBase, { p_dry_run: true })).then(function (dry) {
          gsState.modal = { kind: 'diagnostic', titulo: def.label, arquivo: file.name, def: def, argsBase: argsBase, dry: dry };
          renderGsModalRoot();
        });
      });
    }).catch(function (e) {
      gsState.modal = { kind: 'error', message: String((e && e.message) || e) };
      renderGsModalRoot();
    });
  }

  function gsConfirmarHandler() {
    if (inFlight.gsImport) return;
    var m = gsState.modal;
    if (!m || m.kind !== 'diagnostic') return;
    inFlight.gsImport = true;
    var btn = document.getElementById('gsConfirmarBtn');
    if (btn) btn.disabled = true;
    GS_PROVIDER.commit(m.def.rpc, Object.assign({}, m.argsBase, { p_dry_run: false })).then(
      function (result) {
        inFlight.gsImport = false;
        gsState.modal = { kind: 'success', titulo: m.def.label, arquivo: m.arquivo, result: result };
        renderGsModalRoot();
      },
      function (err) {
        inFlight.gsImport = false;
        var msg = document.getElementById('gsDiagMsg');
        if (msg) msg.textContent = 'Erro ao confirmar: ' + safeErrorMessage();
        if (btn) btn.disabled = false;
      }
    );
  }

  // ==================== Configurações (Painel Master Phase PM-5E) ====================
  // Real backend reuse only -- operational_portal_config() (read) +
  // master_update_portal_config() (write), both already deployed. No
  // new backend. NO homologation-mode gate exists for this capability
  // (confirmed live, PM-5E Gate 39) -- every save here is a REAL write
  // against the real backend, on any host including localhost. Every
  // one of the 13 settings is FINANCIAL+COMMISSION (Gate 8), so every
  // save shows an explicit before/after confirmation (Gate 47) -- never
  // a bare "Salvar?".
  var CFG_VM = window.NX_MASTER_CONFIG_VM;
  var CFG_PROVIDER = window.NX_MASTER_CONFIG_PROVIDER;

  function cfgEnter() {
    if (cfgState.loaded || cfgState.loading) { renderPanel(); return; }
    cfgLoad();
  }
  function cfgLoad() {
    cfgState.loading = true;
    cfgState.error = null;
    renderPanel();
    CFG_PROVIDER.readConfig({}).then(
      function (rows) {
        cfgState.settings = CFG_VM.buildEffectiveConfig(rows);
        cfgState.loading = false;
        cfgState.loaded = true;
        renderPanel();
      },
      function (err) {
        cfgState.loading = false;
        cfgState.loaded = false;
        cfgState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function cfgSettingCardHtml(s) {
    var isEditing = cfgState.editingKey === s.key;
    var neverCustomizedNote = !s.hasRow
      ? '<p class="note gsMuted">Nunca personalizado — usando o padrão de fábrica.</p>' : '';
    var body;
    if (isEditing) {
      body = '<div class="cfgEditRow">' +
        '<input type="text" inputmode="decimal" id="cfgEditInput" value="' + esc(CFG_VM.fmtNumber(cfgState.editDraft)) + '" aria-label="Novo valor para ' + esc(s.label) + '">' +
        '<span class="cfgUnit">' + esc(s.unit) + '</span>' +
        '</div>' +
        '<p id="cfgEditError" class="maSubtle gbErrText" role="alert"></p>' +
        '<div class="adminModalActions cfgEditActions">' +
        '<button type="button" class="modBtnGhost cfgCancelEditBtn">Cancelar</button>' +
        '<button type="button" class="modBtn cfgSaveBtn" data-key="' + esc(s.key) + '">Salvar</button>' +
        '</div>';
    } else {
      body = '<div class="gbRow"><span>Valor atual</span><b>' + esc(CFG_VM.fmtNumber(s.value)) + ' ' + esc(s.unit) + '</b></div>' +
        neverCustomizedNote +
        '<button type="button" class="modBtnGhost cfgEditBtn" data-key="' + esc(s.key) + '">Editar</button>';
    }
    return '<div class="gbCard cfgCard">' +
      '<h3>' + esc(s.label) + '</h3>' +
      '<p class="note">' + esc(s.description) + '</p>' +
      body +
      '</div>';
  }

  function renderConfiguracoesSection() {
    // PM-WRITE-SAFETY-2 -- the section intro previously claimed "não há
    // ambiente de homologação para esta tela", which became false once
    // this wave added the write-safety gate; the stale clause is
    // removed here (not replaced by a conditional sentence) and the
    // homolog banner below now carries the accurate, environment-aware
    // statement instead.
    var cfgHomolog = CFG_PROVIDER.isHomologationMode();
    var homologBanner = cfgHomolog
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO DE HOMOLOGAÇÃO — alterações realizadas nesta tela são simuladas e não modificam os dados reais.</p>'
      : '';
    var html = '<h2>Configurações</h2>' +
      '<p class="note">Parâmetros de comissão do portal. Ao salvar, o valor passa a valer imediatamente para todos os cálculos que o utilizam.</p>' +
      homologBanner;
    if (cfgState.error) {
      html += errorStateHtml(cfgState.error.state, cfgState.error.message) +
        '<button type="button" id="cfgRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (cfgState.loading || !cfgState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando configurações...</div>';
    } else {
      html += '<div class="gbGrid cfgGrid">' + cfgState.settings.map(cfgSettingCardHtml).join('') + '</div>';
    }
    return html;
  }

  function renderCfgModalRoot() {
    if (!cfgState.modal) { if (currentSection === 'configuracoes') clearNxModal(); return; }
    var m = cfgState.modal;
    if (m.kind === 'confirm') renderNxModal('Confirmar alteração', cfgConfirmBodyHtml(m), cfgCancelConfirm);
    else if (m.kind === 'success') renderNxModal('✅ Configuração salva', cfgSuccessBodyHtml(m), cfgCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Erro', cfgErrorBodyHtml(m), cfgCloseModal);
    wireCfgModalInteraction();
  }
  function cfgCloseModal() { cfgState.modal = null; clearNxModal(); }
  function cfgCloseModalAndRefresh() { cfgState.modal = null; clearNxModal(); cfgState.editingKey = null; cfgState.loaded = false; cfgEnter(); }
  function cfgCancelConfirm() { cfgState.modal = null; clearNxModal(); renderPanel(); }

  function cfgConfirmBodyHtml(m) {
    // PM-WRITE-SAFETY-2 -- the prior unconditional "não há modo de
    // simulação para esta tela" claim is now only true in production;
    // the warning text below is environment-aware instead of leaving a
    // now-contradictory statement in place.
    var warnText = CFG_PROVIDER.isHomologationMode()
      ? '⚠️ Este parâmetro influencia diretamente o cálculo de comissão em produção. Nesta tela, neste ambiente (homologação/local), a alteração será apenas simulada — nenhum dado real é gravado.'
      : '⚠️ Este parâmetro influencia diretamente o cálculo de comissão. A alteração é gravada imediatamente e afeta todos os usuários.';
    return '<div class="gbRow"><span>Parâmetro</span><b>' + esc(m.setting.label) + '</b></div>' +
      '<div class="gbRow"><span>Valor atual</span><b>' + esc(CFG_VM.fmtNumber(m.setting.value)) + ' ' + esc(m.setting.unit) + '</b></div>' +
      '<div class="gbRow"><span>Novo valor</span><b class="gbStatusOk">' + esc(CFG_VM.fmtNumber(m.newValue)) + ' ' + esc(m.setting.unit) + '</b></div>' +
      '<p class="note gbWarn">' + esc(warnText) + '</p>' +
      '<p id="cfgConfirmMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="cfgConfirmCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="cfgConfirmSaveBtn"' + (inFlight.cfgSave ? ' disabled' : '') + '>Confirmar alteração</button>' +
      '</div>';
  }
  function cfgSuccessBodyHtml(m) {
    // PM-WRITE-SAFETY-2 -- explicit simulated-vs-real success notice,
    // same "SIMULAÇÃO CONCLUÍDA" semantic already used by Gestão dos
    // Simuladores/Bases' own success modals.
    var simNote = m.simulated
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração real foi realizada.</b></p>'
      : '';
    return '<div class="gbRow"><span>Parâmetro</span><b>' + esc(m.setting.label) + '</b></div>' +
      '<div class="gbRow"><span>Novo valor</span><b>' + esc(CFG_VM.fmtNumber(m.newValue)) + ' ' + esc(m.setting.unit) + '</b></div>' +
      simNote +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="cfgSuccessCloseBtn">Fechar</button></div>';
  }
  function cfgErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao salvar a configuração.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="cfgErrorCloseBtn">Fechar</button></div>';
  }

  function cfgConfirmSaveHandler() {
    if (inFlight.cfgSave) return;
    var m = cfgState.modal;
    if (!m || m.kind !== 'confirm') return;
    inFlight.cfgSave = true;
    var btn = document.getElementById('cfgConfirmSaveBtn');
    if (btn) btn.disabled = true;
    CFG_PROVIDER.updateConfig(m.setting.key, m.newValue, m.setting.description).then(
      function (result) {
        inFlight.cfgSave = false;
        cfgState.modal = { kind: 'success', setting: m.setting, newValue: m.newValue, simulated: !!(result && result.simulated) };
        renderCfgModalRoot();
      },
      function (err) {
        inFlight.cfgSave = false;
        var msg = document.getElementById('cfgConfirmMsg');
        // FECHAMENTO INTEGRADO -- P2: esta era a ÚNICA chamada deste
        // arquivo que descartava err.state e caía num texto genérico
        // fixo (safeErrorMessage(), idêntico ao próprio corpo de
        // STATE_COPY.RPC_ERROR) -- as outras 4 chamadas equivalentes
        // (linhas ~1710/5701/5763/5764) já classificam corretamente via
        // STATE_COPY[err.state]. AUTH_DENIED aqui é tratado à parte
        // (em vez do corpo genérico "Sua conta não tem acesso a esta
        // área.") porque esta ação específica É, comprovadamente
        // (Gate 26 forensics), restrita ao perfil Master -- nunca o
        // texto/código cru do Postgres (42501), só a explicação segura
        // do motivo.
        var body = (err && err.state === 'AUTH_DENIED')
          ? 'Apenas o perfil Master pode alterar esta configuração.'
          : (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body;
        if (msg) msg.textContent = 'Erro ao salvar: ' + body;
        if (btn) btn.disabled = false;
      }
    );
  }

  // ==================== Períodos de Comissão (Painel Master Phase PM-5E) ====================
  // Real backend reuse only -- master_admin_reference_data() (read,
  // MASTER-scoped superset including inactive/archived periods) +
  // master_admin_manage('PERIOD', action, payload) (write), both
  // already deployed. No new backend. NO homologation-mode gate exists
  // for this capability either (confirmed live, PM-5E Gate 39) -- every
  // action here is a REAL write. SET_STATUS is deliberately NOT
  // exposed (no reachable V1 UI call site for it -- see the provider's
  // own header comment) -- the only path to FECHADO/back is the
  // separate, out-of-scope Fechamento de Competência flow.
  var PR_VM = window.NX_MASTER_PERIODOS_VM;
  var PR_PROVIDER = window.NX_MASTER_PERIODOS_PROVIDER;

  function prEnter() {
    if (prState.loaded || prState.loading) { renderPanel(); return; }
    prLoad();
  }
  function prLoad() {
    prState.loading = true;
    prState.error = null;
    renderPanel();
    PR_PROVIDER.listPeriods({}).then(
      function (periods) {
        prState.periods = PR_VM.sortByStartDesc(periods);
        prState.loading = false;
        prState.loaded = true;
        renderPanel();
      },
      function (err) {
        prState.loading = false;
        prState.loaded = false;
        prState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function prRowHtml(p) {
    var currentBadge = p.periodo_atual ? '<span class="gsSharedBadge">PERÍODO ATUAL</span>' : '';
    var ativoBadge = p.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<tr class="prRow" data-id="' + esc(p.id) + '">' +
      '<td><b>' + esc(p.nome_periodo || '-') + '</b>' + (currentBadge ? '<br>' + currentBadge : '') + '</td>' +
      '<td>' + esc(PR_VM.fmtDateBR(p.data_inicio)) + '</td>' +
      '<td>' + esc(PR_VM.fmtDateBR(p.data_fim)) + '</td>' +
      '<td>' + esc(PR_VM.statusLabel(p.status)) + '</td>' +
      '<td>' + ativoBadge + '</td>' +
      '<td class="adminActions prActions">' +
      '<button type="button" class="modBtnGhost prSetCurrentBtn" data-id="' + esc(p.id) + '"' + (p.periodo_atual ? ' disabled' : '') + '>Definir atual</button>' +
      '<button type="button" class="modBtnGhost prToggleActiveBtn" data-id="' + esc(p.id) + '" data-active="' + (p.ativo !== false) + '">' + (p.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost prArchiveBtn" data-id="' + esc(p.id) + '">Arquivar</button>' +
      '</td></tr>';
  }

  function prDesktopTableHtml() {
    return '<div class="maDesktopOnly"><div class="modTableWrap"><table class="modTable prTable">' +
      '<thead><tr><th scope="col">Período</th><th scope="col">Data inicial</th><th scope="col">Data final</th><th scope="col">Status</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead>' +
      '<tbody>' + prState.periods.map(prRowHtml).join('') + '</tbody></table></div></div>';
  }
  function prMobileCardHtml(p) {
    var currentBadge = p.periodo_atual ? '<span class="gsSharedBadge">PERÍODO ATUAL</span>' : '';
    var ativoBadge = p.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<div class="maMobileCard prMobileCard" data-id="' + esc(p.id) + '">' +
      '<div class="maMobileName">' + esc(p.nome_periodo || '-') + '</div>' +
      (currentBadge ? '<div>' + currentBadge + '</div>' : '') +
      '<div class="maMobileMeta">' + esc(PR_VM.fmtDateBR(p.data_inicio)) + ' → ' + esc(PR_VM.fmtDateBR(p.data_fim)) + '</div>' +
      '<div class="maMobileMeta">' + esc(PR_VM.statusLabel(p.status)) + '</div>' +
      ativoBadge +
      '<div class="prActions">' +
      '<button type="button" class="modBtnGhost prSetCurrentBtn" data-id="' + esc(p.id) + '"' + (p.periodo_atual ? ' disabled' : '') + '>Definir atual</button>' +
      '<button type="button" class="modBtnGhost prToggleActiveBtn" data-id="' + esc(p.id) + '" data-active="' + (p.ativo !== false) + '">' + (p.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost prArchiveBtn" data-id="' + esc(p.id) + '">Arquivar</button>' +
      '</div></div>';
  }
  function prMobileCardsHtml() {
    return '<div class="maMobileOnly">' + prState.periods.map(prMobileCardHtml).join('') + '</div>';
  }

  function prCreateFormHtml() {
    var f = prState.createForm;
    return '<div class="gbCard prCreateCard">' +
      '<h3>Novo período</h3>' +
      '<label for="prNome">Nome do período</label>' +
      '<input type="text" id="prNome" placeholder="Ex.: Comissão Junho/2026" value="' + esc(f.name) + '">' +
      '<label for="prIni">Data inicial</label>' +
      '<input type="date" id="prIni" value="' + esc(f.start) + '">' +
      '<label for="prFim">Data final</label>' +
      '<input type="date" id="prFim" value="' + esc(f.end) + '">' +
      '<label class="prCurrentLabel"><input type="checkbox" id="prAtualChk"' + (f.isCurrent ? ' checked' : '') + '> Definir como período atual</label>' +
      (f.error ? '<p class="maSubtle gbErrText" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="prCancelCreateBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="prSaveCreateBtn"' + (inFlight.prAction ? ' disabled' : '') + '>Salvar período</button>' +
      '</div></div>';
  }

  // PM-WRITE-SAFETY-2 -- same isHomologationMode()-at-render-time idiom
  // already established by gbHomolog()/gsHomolog() above.
  function prHomolog() { return PR_PROVIDER.isHomologationMode(); }

  function renderPeriodosSection() {
    // PM-WRITE-SAFETY-2 -- the prior unconditional "Não há ambiente de
    // homologação para esta tela: cada ação é gravada imediatamente."
    // claim is now only true in production; removed in favor of the
    // environment-aware banner below.
    var homologBanner = prHomolog()
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO DE HOMOLOGAÇÃO — alterações realizadas nesta tela são simuladas e não modificam os dados reais.</p>'
      : '';
    var html = '<h2>Períodos de Comissão</h2>' +
      '<p class="note">Cadastre os períodos oficiais. O período controla somente as datas inicial e final usadas como filtro — os cálculos continuam usando as mesmas funções já homologadas.</p>' +
      homologBanner;
    if (prState.error) {
      html += errorStateHtml(prState.error.state, prState.error.message) +
        '<button type="button" id="prRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (prState.loading || !prState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando períodos de comissão...</div>';
    } else {
      html += prState.createForm
        ? prCreateFormHtml()
        : '<button type="button" class="modBtn" id="prNewBtn">+ Novo período</button>';
      html += prState.periods.length
        ? prDesktopTableHtml() + prMobileCardsHtml()
        : '<p class="note">Nenhum período cadastrado ainda.</p>';
    }
    return html;
  }

  function renderPrModalRoot() {
    if (!prState.modal) { if (currentSection === 'periodosComissao') clearNxModal(); return; }
    var m = prState.modal;
    if (m.kind === 'confirm') renderNxModal('Confirmar arquivamento', prConfirmBodyHtml(m), prCancelConfirm);
    else if (m.kind === 'success') renderNxModal((prHomolog() ? '🧪 ' : '✅ ') + 'Período atualizado', prSuccessBodyHtml(m), prCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Erro', prErrorBodyHtml(m), prCloseModal);
    wirePrModalInteraction();
  }
  function prCloseModal() { prState.modal = null; clearNxModal(); }
  function prCloseModalAndRefresh() { prState.modal = null; clearNxModal(); prState.loaded = false; prEnter(); }
  function prCancelConfirm() { prState.modal = null; clearNxModal(); }

  function prConfirmBodyHtml(m) {
    return '<div class="gbRow"><span>Período</span><b>' + esc(m.period.nome_periodo || '-') + '</b></div>' +
      '<div class="gbRow"><span>Intervalo</span><b>' + esc(PR_VM.fmtDateBR(m.period.data_inicio)) + ' → ' + esc(PR_VM.fmtDateBR(m.period.data_fim)) + '</b></div>' +
      '<p class="note gbWarn">⚠️ Arquivar torna este período inativo. Ele deixa de aparecer como opção nas telas que dependem de um período ativo.</p>' +
      '<p id="prConfirmMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="prConfirmCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="prConfirmArchiveBtn"' + (inFlight.prAction ? ' disabled' : '') + '>Arquivar período</button>' +
      '</div>';
  }
  function prSuccessBodyHtml(m) {
    var simNote = prHomolog()
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração real foi realizada.</b></p>'
      : '';
    return simNote + '<p>' + esc(m.message || 'Ação concluída com sucesso.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="prSuccessCloseBtn">Fechar</button></div>';
  }
  function prErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao processar a ação.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="prErrorCloseBtn">Fechar</button></div>';
  }

  function prPeriodById(id) {
    return prState.periods.filter(function (p) { return String(p.id) === String(id); })[0] || null;
  }

  function prRunAction(promise, successMessage) {
    if (inFlight.prAction) return;
    inFlight.prAction = true;
    promise.then(
      function () {
        inFlight.prAction = false;
        prState.modal = { kind: 'success', message: successMessage };
        renderPrModalRoot();
      },
      function (err) {
        inFlight.prAction = false;
        prState.modal = { kind: 'error', message: safeErrorMessage() };
        renderPrModalRoot();
      }
    );
  }

  function prConfirmArchiveHandler() {
    if (inFlight.prAction) return;
    var m = prState.modal;
    if (!m || m.kind !== 'confirm') return;
    inFlight.prAction = true;
    var btn = document.getElementById('prConfirmArchiveBtn');
    if (btn) btn.disabled = true;
    PR_PROVIDER.archivePeriod(m.period.id).then(
      function () {
        inFlight.prAction = false;
        prState.modal = { kind: 'success', message: 'Período arquivado com sucesso.' };
        renderPrModalRoot();
      },
      function (err) {
        inFlight.prAction = false;
        var msg = document.getElementById('prConfirmMsg');
        if (msg) msg.textContent = 'Erro ao arquivar: ' + safeErrorMessage();
        if (btn) btn.disabled = false;
      }
    );
  }

  function prSaveCreateHandler() {
    if (inFlight.prAction) return;
    var f = prState.createForm;
    var name = (document.getElementById('prNome') || {}).value || '';
    var start = (document.getElementById('prIni') || {}).value || '';
    var end = (document.getElementById('prFim') || {}).value || '';
    var isCurrent = !!(document.getElementById('prAtualChk') || {}).checked;
    name = name.trim();
    f.name = name; f.start = start; f.end = end; f.isCurrent = isCurrent;
    if (!name) { f.error = 'Informe o nome do período.'; renderPanel(); return; }
    if (!start || !end) { f.error = 'Informe data inicial e final.'; renderPanel(); return; }
    if (end < start) { f.error = 'Data final não pode ser menor que a inicial.'; renderPanel(); return; }
    var overlap = PR_VM.findOverlap(prState.periods, start, end);
    if (overlap) { f.error = 'Já existe período ativo sobreposto às datas informadas (' + (overlap.nome_periodo || '') + ').'; renderPanel(); return; }
    f.error = null;
    inFlight.prAction = true;
    var btn = document.getElementById('prSaveCreateBtn');
    if (btn) btn.disabled = true;
    PR_PROVIDER.createPeriod(name, start, end, isCurrent).then(
      function () {
        inFlight.prAction = false;
        prState.createForm = null;
        prState.modal = { kind: 'success', message: 'Período criado com sucesso.' };
        renderPrModalRoot();
      },
      function (err) {
        inFlight.prAction = false;
        f.error = safeErrorMessage();
        if (btn) btn.disabled = false;
        renderPanel();
      }
    );
  }

  // ---------- Férias/Ausências (Painel Master Phase PM-5F) ----------
  // Real backend: master_admin_reference_data().absences (read) +
  // master_admin_manage('ABSENCE', action, payload) (write), both
  // already deployed -- SAME dispatcher pair as PERIOD (PM-5E). No new
  // backend. NO homologation-mode gate exists for this capability
  // either (confirmed live, PM-5F Gate 44) -- every action here is a
  // REAL write. There is no edit action -- V1 has none, and none is
  // exposed here (CREATE + toggle active + archive only).
  var ABS_VM = window.NX_MASTER_ABSENCES_VM;
  var ABS_PROVIDER = window.NX_MASTER_ABSENCES_PROVIDER;

  function absEnter() {
    if (absState.loaded || absState.loading) { renderPanel(); return; }
    absLoad();
  }
  function absLoad() {
    absState.loading = true;
    absState.error = null;
    renderPanel();
    ABS_PROVIDER.listAbsences({}).then(
      function (absences) {
        absState.absences = ABS_VM.sortByStartDesc(absences);
        absState.loading = false;
        absState.loaded = true;
        renderPanel();
      },
      function (err) {
        absState.loading = false;
        absState.loaded = false;
        absState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function absTodayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function absRowHtml(a) {
    var hoje = absTodayIso();
    var state = ABS_VM.temporalState(a, hoje);
    var ativoBadge = a.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<tr class="absRow" data-id="' + esc(a.id) + '">' +
      '<td><b>' + esc(a.nome_analista_ausente || '-') + '</b>' + (a.loja_origem ? '<br><span class="maSubtle">' + esc(a.loja_origem) + '</span>' : '') + '</td>' +
      '<td>' + esc(a.nome_analista_substituto || '-') + '</td>' +
      '<td>' + esc(a.loja_coberta || '-') + '</td>' +
      '<td class="absColDate">' + esc(ABS_VM.fmtDateBR(a.data_inicio)) + ' →<br>' + esc(ABS_VM.fmtDateBR(a.data_fim)) + '</td>' +
      '<td>' + esc(a.motivo || '-') + '</td>' +
      '<td class="absColBadge"><span class="absStateBadge absState' + esc(state) + '">' + esc(ABS_VM.temporalLabel(state)) + '</span></td>' +
      '<td class="absColBadge">' + ativoBadge + '</td>' +
      '<td class="adminActions"><div class="absActions">' +
      '<button type="button" class="modBtnGhost absToggleActiveBtn" data-id="' + esc(a.id) + '" data-active="' + (a.ativo !== false) + '">' + (a.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost absArchiveBtn" data-id="' + esc(a.id) + '">Arquivar</button>' +
      '</div></td></tr>';
  }
  // PM-5F-H2 (table density refinement, after Human retest of H1):
  // real geometry was measured (not guessed) against a 21-row
  // realistic synthetic fixture at 1440px before touching anything
  // (ABSENCE COLUMN GEOMETRY BEFORE, see the final report), plus exact
  // word-level pixel measurements (not estimates) for the longest real
  // single-word values that can never wrap internally: "BANDEIRANTES"
  // (Loja, 87px), "AFASTAMENTO" (Motivo, 84px), plus real badge widths
  // (Situação ~83px, Status ~62px) and button-label widths (~52-58px
  // each). Several static (non-responsive) distributions were tried
  // and each was rejected by direct screenshot/measurement evidence:
  // percentage-only columns tuned against 1440px caused Situação/
  // Status badges to overlap at 900px (percentage columns shrink with
  // viewport, badge content does not); making Ações accept 2-line
  // button-stacking to free up width made the 21-row density
  // measurement WORSE overall (1711px vs H1's 1237px -- stacking on
  // every single row costs more height than the width saved bought
  // back); weighting Motivo up enough to stop "COBERTURA TEMPORÁRIA"
  // fragmenting into 5 lines at 768px, using only static percentages,
  // then squeezed Substituto's own header ("SUBSTITUTO") into visible
  // collision with its neighbors at 768px -- there is no single static
  // distribution that is simultaneously excellent at 1440px (dense,
  // no wasted space) and safe at 768px (no badge/date/button/store-
  // word breaking, no header collision), because the fixed content
  // (badges/date/button labels/longest single words) already consumes
  // the majority of a 766px table on its own.
  //
  // FINAL: column widths are RESPONSIVE (CSS classes + a narrow-
  // desktop media query), not a single static set -- exactly the
  // "measure at every width, prove it" discipline this phase's brief
  // demands. At wide desktop (>1024px) Ações stays 145px (both button
  // labels side by side, proven the best density outcome there) and
  // Analista ausente/Substituto get the majority share, since real
  // person names always contain multiple words with real spaces to
  // wrap at (extra wrapping there is never destructive). At narrow
  // desktop (<=1024px, where the fixed badge/date/button budget alone
  // would otherwise leave almost nothing for names) Ações shrinks to
  // its single widest button label (stacking is explicitly acceptable
  // per Gate 14, and only costs extra height at the narrow tier where
  // rows are already taller from name-wrapping anyway), freeing real
  // width back to Analista ausente/Substituto. Loja coberta/Motivo/
  // Período/Situação/Status keep their real, measured, viewport-
  // independent minimums at every width -- these never change,
  // because their content genuinely does not change with viewport.
  function absColgroupHtml() {
    return '<colgroup>' +
      '<col class="absColAnalista">' +
      '<col class="absColSubstituto">' +
      '<col class="absColLoja">' + // real longest single word "BANDEIRANTES" needs 87px + padding, viewport-independent
      '<col class="absColDate">' + // deliberate 2-line date, viewport-independent content
      '<col class="absColMotivo">' + // real longest single word "AFASTAMENTO" needs 84px + padding, viewport-independent
      '<col class="absColBadge absColSituacao">' + // badge content ~83px + cell padding, viewport-independent
      '<col class="absColBadge absColStatus">' +  // badge content ~62px + cell padding, viewport-independent
      '<col class="absColAcoes">' +
      '</colgroup>';
  }
  function absDesktopTableHtml() {
    return '<div class="maDesktopOnly"><div class="modTableWrap"><table class="modTable absTable">' +
      absColgroupHtml() +
      '<thead><tr><th scope="col">Analista ausente</th><th scope="col">Substituto</th><th scope="col">Loja coberta</th><th scope="col" class="absColDate">Período</th><th scope="col">Motivo</th><th scope="col" class="absColBadge">Situação</th><th scope="col" class="absColBadge">Status</th><th scope="col">Ações</th></tr></thead>' +
      '<tbody>' + absState.absences.map(absRowHtml).join('') + '</tbody></table></div></div>';
  }
  function absMobileCardHtml(a) {
    var hoje = absTodayIso();
    var state = ABS_VM.temporalState(a, hoje);
    var ativoBadge = a.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<div class="maMobileCard absMobileCard" data-id="' + esc(a.id) + '">' +
      '<div class="maMobileName">' + esc(a.nome_analista_ausente || '-') + '</div>' +
      '<div class="maMobileMeta">Substituto: ' + esc(a.nome_analista_substituto || '-') + '</div>' +
      '<div class="maMobileMeta">Loja coberta: ' + esc(a.loja_coberta || '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(ABS_VM.fmtDateBR(a.data_inicio)) + ' → ' + esc(ABS_VM.fmtDateBR(a.data_fim)) + '</div>' +
      '<div class="maMobileMeta">' + esc(a.motivo || '-') + '</div>' +
      '<span class="absStateBadge absState' + esc(state) + '">' + esc(ABS_VM.temporalLabel(state)) + '</span> ' + ativoBadge +
      '<div class="absActions">' +
      '<button type="button" class="modBtnGhost absToggleActiveBtn" data-id="' + esc(a.id) + '" data-active="' + (a.ativo !== false) + '">' + (a.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost absArchiveBtn" data-id="' + esc(a.id) + '">Arquivar</button>' +
      '</div></div>';
  }
  function absMobileCardsHtml() {
    return '<div class="maMobileOnly">' + absState.absences.map(absMobileCardHtml).join('') + '</div>';
  }

  function absCreateFormHtml() {
    var f = absState.createForm;
    var motivoOptions = ABS_VM.MOTIVO_OPTIONS.map(function (m) {
      return '<option value="' + esc(m) + '"' + (f.motivo === m ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    return '<div class="gbCard absCreateCard">' +
      '<h3>Nova ausência</h3>' +
      '<p class="note absFinanceWarn">⚠️ Ao registrar uma ausência, a comissão do período correspondente é reatribuída do analista ausente para o substituto informado, para as datas indicadas.</p>' +
      '<label for="absCpfAusente">CPF do analista ausente (opcional)</label>' +
      '<input type="text" id="absCpfAusente" value="' + esc(f.cpfAnalistaAusente) + '">' +
      '<label for="absNomeAusente">Nome do analista ausente</label>' +
      '<input type="text" id="absNomeAusente" value="' + esc(f.nomeAnalistaAusente) + '">' +
      '<label for="absLojaOrigem">Loja de origem (opcional)</label>' +
      '<input type="text" id="absLojaOrigem" value="' + esc(f.lojaOrigem) + '">' +
      '<label for="absCpfSubstituto">CPF do substituto</label>' +
      '<input type="text" id="absCpfSubstituto" value="' + esc(f.cpfAnalistaSubstituto) + '">' +
      '<label for="absNomeSubstituto">Nome do substituto</label>' +
      '<input type="text" id="absNomeSubstituto" value="' + esc(f.nomeAnalistaSubstituto) + '">' +
      '<label for="absLojaCoberta">Loja coberta</label>' +
      '<input type="text" id="absLojaCoberta" value="' + esc(f.lojaCoberta) + '">' +
      '<label for="absIni">Data inicial</label>' +
      '<input type="date" id="absIni" value="' + esc(f.dataInicio) + '">' +
      '<label for="absFim">Data final</label>' +
      '<input type="date" id="absFim" value="' + esc(f.dataFim) + '">' +
      '<label for="absMotivo">Motivo</label>' +
      '<select id="absMotivo"><option value="">Selecione</option>' + motivoOptions + '</select>' +
      (f.overlapWarning ? '<p class="note gbWarn" role="alert">⚠️ ' + esc(f.overlapWarning) + '</p>' : '') +
      (f.error ? '<p class="maSubtle gbErrText" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="absCancelCreateBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="absSaveCreateBtn"' + (inFlight.absAction ? ' disabled' : '') + '>Salvar ausência</button>' +
      '</div></div>';
  }

  // PM-WRITE-SAFETY-2 -- same isHomologationMode()-at-render-time idiom
  // already established by gbHomolog()/gsHomolog() above.
  function absHomolog() { return ABS_PROVIDER.isHomologationMode(); }

  function renderFeriasAusenciasSection() {
    // PM-WRITE-SAFETY-2 -- the prior unconditional "Não há ambiente de
    // homologação para esta tela..." claim is now only true in
    // production; removed in favor of the environment-aware banner.
    var homologBanner = absHomolog()
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO DE HOMOLOGAÇÃO — alterações realizadas nesta tela são simuladas e não modificam os dados reais.</p>'
      : '';
    var html = '<h2>Férias/Ausências</h2>' +
      '<p class="note">Registre ausências de analistas e o substituto responsável pela cobertura.</p>' +
      homologBanner;
    if (absState.error) {
      html += errorStateHtml(absState.error.state, absState.error.message) +
        '<button type="button" id="absRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (absState.loading || !absState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando ausências...</div>';
    } else {
      html += absState.createForm
        ? absCreateFormHtml()
        : '<button type="button" class="modBtn" id="absNewBtn">+ Nova ausência</button>';
      html += absState.absences.length
        ? absDesktopTableHtml() + absMobileCardsHtml()
        : '<p class="note">Nenhuma ausência cadastrada ainda.</p>';
    }
    return html;
  }

  function renderAbsModalRoot() {
    if (!absState.modal) { if (currentSection === 'feriasAusencias') clearNxModal(); return; }
    var m = absState.modal;
    if (m.kind === 'confirm') renderNxModal('Confirmar arquivamento', absConfirmBodyHtml(m), absCancelConfirm);
    else if (m.kind === 'success') renderNxModal((absHomolog() ? '🧪 ' : '✅ ') + 'Ausência atualizada', absSuccessBodyHtml(m), absCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Erro', absErrorBodyHtml(m), absCloseModal);
    wireAbsModalInteraction();
  }
  function absCloseModal() { absState.modal = null; clearNxModal(); }
  function absCloseModalAndRefresh() { absState.modal = null; clearNxModal(); absState.loaded = false; absEnter(); }
  function absCancelConfirm() { absState.modal = null; clearNxModal(); }

  function absConfirmBodyHtml(m) {
    return '<div class="gbRow"><span>Analista</span><b>' + esc(m.absence.nome_analista_ausente || '-') + '</b></div>' +
      '<div class="gbRow"><span>Período</span><b>' + esc(ABS_VM.fmtDateBR(m.absence.data_inicio)) + ' → ' + esc(ABS_VM.fmtDateBR(m.absence.data_fim)) + '</b></div>' +
      '<p class="note gbWarn">⚠️ Arquivar torna este registro inativo. Ele deixa de ser considerado para reatribuição de comissão em novos cálculos.</p>' +
      '<p id="absConfirmMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="absConfirmCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="absConfirmArchiveBtn"' + (inFlight.absAction ? ' disabled' : '') + '>Arquivar ausência</button>' +
      '</div>';
  }
  function absSuccessBodyHtml(m) {
    var simNote = absHomolog()
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração real foi realizada.</b></p>'
      : '';
    return simNote + '<p>' + esc(m.message || 'Ação concluída com sucesso.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="absSuccessCloseBtn">Fechar</button></div>';
  }
  function absErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao processar a ação.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="absErrorCloseBtn">Fechar</button></div>';
  }

  function absAbsenceById(id) {
    return absState.absences.filter(function (a) { return String(a.id) === String(id); })[0] || null;
  }

  function absRunAction(promise, successMessage) {
    if (inFlight.absAction) return;
    inFlight.absAction = true;
    promise.then(
      function () {
        inFlight.absAction = false;
        absState.modal = { kind: 'success', message: successMessage };
        renderAbsModalRoot();
      },
      function (err) {
        inFlight.absAction = false;
        absState.modal = { kind: 'error', message: safeErrorMessage() };
        renderAbsModalRoot();
      }
    );
  }

  function absConfirmArchiveHandler() {
    if (inFlight.absAction) return;
    var m = absState.modal;
    if (!m || m.kind !== 'confirm') return;
    inFlight.absAction = true;
    var btn = document.getElementById('absConfirmArchiveBtn');
    if (btn) btn.disabled = true;
    ABS_PROVIDER.archiveAbsence(m.absence.id).then(
      function () {
        inFlight.absAction = false;
        absState.modal = { kind: 'success', message: 'Ausência arquivada com sucesso.' };
        renderAbsModalRoot();
      },
      function (err) {
        inFlight.absAction = false;
        var msg = document.getElementById('absConfirmMsg');
        if (msg) msg.textContent = 'Erro ao arquivar: ' + safeErrorMessage();
        if (btn) btn.disabled = false;
      }
    );
  }

  function absSaveCreateHandler() {
    if (inFlight.absAction) return;
    var f = absState.createForm;
    var cpfAusente = (document.getElementById('absCpfAusente') || {}).value || '';
    var nomeAusente = ((document.getElementById('absNomeAusente') || {}).value || '').trim();
    var lojaOrigem = ((document.getElementById('absLojaOrigem') || {}).value || '').trim();
    var cpfSubstituto = (document.getElementById('absCpfSubstituto') || {}).value || '';
    var nomeSubstituto = ((document.getElementById('absNomeSubstituto') || {}).value || '').trim();
    var lojaCoberta = ((document.getElementById('absLojaCoberta') || {}).value || '').trim();
    var dataInicio = (document.getElementById('absIni') || {}).value || '';
    var dataFim = (document.getElementById('absFim') || {}).value || '';
    var motivo = (document.getElementById('absMotivo') || {}).value || '';
    f.cpfAnalistaAusente = cpfAusente; f.nomeAnalistaAusente = nomeAusente; f.lojaOrigem = lojaOrigem;
    f.cpfAnalistaSubstituto = cpfSubstituto; f.nomeAnalistaSubstituto = nomeSubstituto; f.lojaCoberta = lojaCoberta;
    f.dataInicio = dataInicio; f.dataFim = dataFim; f.motivo = motivo;
    // Required in practice even though the RPC's own explicit check
    // only demands nome_analista_ausente/nome_analista_substituto/
    // datas: cpf_analista_substituto and loja_coberta are NOT NULL
    // columns the RPC nullifies-on-empty, so an empty submission here
    // would otherwise surface as a raw Postgres not-null-violation
    // rather than a friendly message (PM-5F Gate 35 finding).
    if (!nomeAusente || !cpfSubstituto || !nomeSubstituto || !lojaCoberta) {
      f.error = 'Informe analista ausente, CPF e nome do substituto e a loja coberta.'; renderPanel(); return;
    }
    if (!dataInicio || !dataFim) { f.error = 'Informe data inicial e final.'; renderPanel(); return; }
    if (dataFim < dataInicio) { f.error = 'Data final não pode ser menor que a inicial.'; renderPanel(); return; }
    f.error = null;
    f.overlapWarning = null;
    var overlap = ABS_VM.findOverlapWarning(absState.absences, dataInicio, dataFim, lojaOrigem);
    if (overlap) {
      f.overlapWarning = 'Já existe uma ausência ativa para a loja "' + lojaOrigem + '" sobreposta a este período (' + (overlap.nome_analista_ausente || '') + '). O cadastro pode prosseguir, mas o cálculo de comissão do período pode falhar se ambas permanecerem ativas.';
    }
    inFlight.absAction = true;
    var btn = document.getElementById('absSaveCreateBtn');
    if (btn) btn.disabled = true;
    ABS_PROVIDER.createAbsence(f).then(
      function () {
        inFlight.absAction = false;
        absState.createForm = null;
        absState.modal = { kind: 'success', message: 'Ausência criada com sucesso.' };
        renderAbsModalRoot();
      },
      function (err) {
        inFlight.absAction = false;
        f.error = safeErrorMessage();
        if (btn) btn.disabled = false;
        renderPanel();
      }
    );
  }

  // ---------- Mudança de Loja - Vendedores (Painel Master Phase PM-5F) ----------
  // Real backend: master_admin_reference_data().store_changes (read) +
  // master_admin_manage('STORE_CHANGE', action, payload) (write). NO
  // homologation-mode gate exists (confirmed live, PM-5F Gate 44).
  // SET_DEPARTMENTS uses the shared #nxModalRoot form below --
  // deliberately NOT V1's native prompt() (editarDepartamentosMudanca
  // LojaVendedor), which this migration does not replicate.
  var SC_VM = window.NX_MASTER_STORE_CHANGE_VM;
  var SC_PROVIDER = window.NX_MASTER_STORE_CHANGE_PROVIDER;

  function scEnter() {
    if (scState.loaded || scState.loading) { renderPanel(); return; }
    scLoad();
  }
  function scLoad() {
    scState.loading = true;
    scState.error = null;
    renderPanel();
    SC_PROVIDER.listStoreChanges({}).then(
      function (storeChanges) {
        scState.storeChanges = SC_VM.sortByDestStartDesc(storeChanges);
        scState.loading = false;
        scState.loaded = true;
        renderPanel();
      },
      function (err) {
        scState.loading = false;
        scState.loaded = false;
        scState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function scDeptText(r) {
    var o = r.departamento_origem || '-';
    var d = r.departamento_destino || '-';
    return o + ' → ' + d;
  }

  function scRowHtml(r) {
    var ativoBadge = r.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<tr class="scRow" data-id="' + esc(r.id) + '">' +
      '<td><b>' + esc(r.nome_vendedor || '-') + '</b>' + (r.cpf_vendedor ? '<br><span class="maSubtle">' + esc(r.cpf_vendedor) + '</span>' : '') + '</td>' +
      '<td>' + esc(r.loja_origem || '-') + ' → ' + esc(r.loja_destino || '-') + '</td>' +
      '<td>' + esc(SC_VM.fmtDateBR(r.data_inicio_origem)) + ' → ' + esc(SC_VM.fmtDateBR(r.data_fim_origem)) + '</td>' +
      '<td>' + esc(SC_VM.fmtDateBR(r.data_inicio_destino)) + ' (em aberto)</td>' +
      '<td>' + esc(scDeptText(r)) + '</td>' +
      '<td>' + ativoBadge + '</td>' +
      '<td class="adminActions"><div class="scActions">' +
      '<button type="button" class="modBtnGhost scEditDeptBtn" data-id="' + esc(r.id) + '">Editar departamentos</button>' +
      '<button type="button" class="modBtnGhost scToggleActiveBtn" data-id="' + esc(r.id) + '" data-active="' + (r.ativo !== false) + '">' + (r.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost scArchiveBtn" data-id="' + esc(r.id) + '">Arquivar</button>' +
      '</div></td></tr>';
  }
  // PM-5F-SC-H1: <colgroup> + table-layout:fixed, same technique as
  // absTable (PM-5F-H2) -- widths below are the real, measured,
  // viewport-independent minimums for this table's own content (probed
  // live via getBoundingClientRect on the real classes/fonts, never
  // guessed): longest real store word (~98px, e.g. "BANDEIRANTES") +
  // arrow, wrapped 2-line "ORIGEM →\nDESTINO" (scColLoja); the date-range
  // shape already proven for .absColDate, reused as-is (scColPeriodo);
  // "DD/MM/AAAA" wrapped above the literal, always-present "(em aberto)"
  // suffix (scColInicio); longest department enum word "SEMINOVOS"
  // (scColDept); the ATIVO/INATIVO badge (scColStatus, same measured
  // width as absColStatus); and the widest of the 3 real action button
  // labels, "Editar departamentos" (~135px), which -- unlike Férias'
  // 2-button Ações column -- cannot shrink at any desktop width without
  // breaking that label mid-word, so scColAcoes stays constant across
  // the whole table-mode range (no narrow-desktop override needed).
  // Vendedor is the ONE column left with no explicit width -- per the
  // table-layout:fixed spec, the single such column absorbs 100% of
  // whatever space the other six don't claim, exactly the flexible
  // "majority share" role absColAnalista/Substituto split between them
  // in Férias/Ausências.
  function scColgroupHtml() {
    return '<colgroup>' +
      '<col>' +
      '<col class="scColLoja">' +
      '<col class="scColPeriodo">' +
      '<col class="scColInicio">' +
      '<col class="scColDept">' +
      '<col class="scColBadge scColStatus">' +
      '<col class="scColAcoes">' +
      '</colgroup>';
  }
  function scDesktopTableHtml() {
    return '<div class="scStoreDesktopOnly"><div class="modTableWrap"><table class="modTable scStoreTable">' +
      scColgroupHtml() +
      '<thead><tr><th scope="col">Vendedor</th><th scope="col">Loja origem → destino</th><th scope="col">Período origem</th><th scope="col">Início destino</th><th scope="col">Departamentos</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead>' +
      '<tbody>' + scState.storeChanges.map(scRowHtml).join('') + '</tbody></table></div></div>';
  }
  function scMobileCardHtml(r) {
    var ativoBadge = r.ativo !== false
      ? '<span class="maBadge maBadgeActive">ATIVO</span>'
      : '<span class="maBadge maBadgeInactive">INATIVO</span>';
    return '<div class="maMobileCard scMobileCard" data-id="' + esc(r.id) + '">' +
      '<div class="maMobileName">' + esc(r.nome_vendedor || '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(r.cpf_vendedor || '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(r.loja_origem || '-') + ' → ' + esc(r.loja_destino || '-') + '</div>' +
      '<div class="maMobileMeta">Origem: ' + esc(SC_VM.fmtDateBR(r.data_inicio_origem)) + ' → ' + esc(SC_VM.fmtDateBR(r.data_fim_origem)) + '</div>' +
      '<div class="maMobileMeta">Destino desde: ' + esc(SC_VM.fmtDateBR(r.data_inicio_destino)) + ' (em aberto)</div>' +
      '<div class="maMobileMeta">Departamentos: ' + esc(scDeptText(r)) + '</div>' +
      ativoBadge +
      '<div class="scActions">' +
      '<button type="button" class="modBtnGhost scEditDeptBtn" data-id="' + esc(r.id) + '">Editar departamentos</button>' +
      '<button type="button" class="modBtnGhost scToggleActiveBtn" data-id="' + esc(r.id) + '" data-active="' + (r.ativo !== false) + '">' + (r.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtnGhost scArchiveBtn" data-id="' + esc(r.id) + '">Arquivar</button>' +
      '</div></div>';
  }
  function scMobileCardsHtml() {
    return '<div class="scStoreMobileOnly">' + scState.storeChanges.map(scMobileCardHtml).join('') + '</div>';
  }

  function scDeptOptionsHtml(selected) {
    return '<option value="">-</option>' + SC_VM.DEPARTMENT_OPTIONS.map(function (d) {
      return '<option value="' + esc(d) + '"' + (selected === d ? ' selected' : '') + '>' + esc(d) + '</option>';
    }).join('');
  }

  function scCreateFormHtml() {
    var f = scState.createForm;
    var prior = SC_VM.findMostRecentForSeller(scState.storeChanges, f.cpfVendedor, f.nomeVendedor);
    var chainHint = prior
      ? '<p class="note scChainCard">Transferência ativa mais recente deste vendedor: <b>' + esc(prior.loja_destino) + '</b> desde ' + esc(SC_VM.fmtDateBR(prior.data_inicio_destino)) + '. A origem desta nova transferência deve começar a partir dessa loja/data.</p>'
      : '';
    var guidance = SC_VM.checkChainGuidance(f, prior);
    var guidanceHtml = guidance.length
      ? '<div class="note gbWarn" role="alert">' + guidance.map(function (g) { return '⚠️ ' + esc(g); }).join('<br>') + '</div>'
      : '';
    return '<div class="gbCard scCreateCard">' +
      '<h3>Nova mudança de loja</h3>' +
      '<p class="note scRetroWarn">⚠️ Esta transferência pode afetar retroativamente a atribuição de comissão/salário do vendedor para datas já registradas, quando um período de comissão que envolva essas datas for calculado.</p>' +
      chainHint +
      '<label for="scCpf">CPF do vendedor (opcional)</label>' +
      '<input type="text" id="scCpf" value="' + esc(f.cpfVendedor) + '">' +
      '<label for="scLogin">Login do vendedor (opcional)</label>' +
      '<input type="text" id="scLogin" value="' + esc(f.loginVendedor) + '">' +
      '<label for="scNome">Nome do vendedor</label>' +
      '<input type="text" id="scNome" value="' + esc(f.nomeVendedor) + '">' +
      '<label for="scLojaOrigem">Loja de origem (opcional)</label>' +
      '<input type="text" id="scLojaOrigem" value="' + esc(f.lojaOrigem) + '" list="scStoreSuggestions">' +
      '<label for="scLojaDestino">Loja de destino</label>' +
      '<input type="text" id="scLojaDestino" value="' + esc(f.lojaDestino) + '" list="scStoreSuggestions">' +
      '<datalist id="scStoreSuggestions">' + SC_VM.storeSuggestions(scState.storeChanges).map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<label for="scIniOrigem">Data inicial da origem</label>' +
      '<input type="date" id="scIniOrigem" value="' + esc(f.dataInicioOrigem) + '">' +
      '<label for="scFimOrigem">Data final da origem</label>' +
      '<input type="date" id="scFimOrigem" value="' + esc(f.dataFimOrigem) + '">' +
      '<label for="scIniDestino">Data inicial do destino</label>' +
      '<input type="date" id="scIniDestino" value="' + esc(f.dataInicioDestino) + '">' +
      '<label for="scObs">Observação (opcional)</label>' +
      '<input type="text" id="scObs" value="' + esc(f.observacao) + '">' +
      '<label for="scDeptOrigem">Departamento de origem (opcional)</label>' +
      '<select id="scDeptOrigem">' + scDeptOptionsHtml(f.departamentoOrigem) + '</select>' +
      '<label for="scDeptDestino">Departamento de destino (opcional)</label>' +
      '<select id="scDeptDestino">' + scDeptOptionsHtml(f.departamentoDestino) + '</select>' +
      guidanceHtml +
      (f.error ? '<p class="maSubtle gbErrText" role="alert">' + esc(f.error) + '</p>' : '') +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="scCancelCreateBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="scSaveCreateBtn"' + (inFlight.scAction ? ' disabled' : '') + '>Salvar mudança de loja</button>' +
      '</div></div>';
  }

  // PM-WRITE-SAFETY-2 -- same isHomologationMode()-at-render-time idiom
  // already established by gbHomolog()/gsHomolog() above.
  function scHomolog() { return SC_PROVIDER.isHomologationMode(); }

  function renderMudancaLojaSection() {
    // PM-WRITE-SAFETY-2 -- the prior unconditional "Não há ambiente de
    // homologação para esta tela..." claim is now only true in
    // production; removed in favor of the environment-aware banner.
    var homologBanner = scHomolog()
      ? '<p class="note gbWarn gbHomologBanner">🧪 MODO DE HOMOLOGAÇÃO — alterações realizadas nesta tela são simuladas e não modificam os dados reais.</p>'
      : '';
    var html = '<h2>Mudança de Loja - Vendedores</h2>' +
      '<p class="note">Registre transferências de loja de vendedores. Não há loja/enum pré-cadastrado: as sugestões abaixo vêm apenas de registros já existentes.</p>' +
      homologBanner;
    if (scState.error) {
      html += errorStateHtml(scState.error.state, scState.error.message) +
        '<button type="button" id="scRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    } else if (scState.loading || !scState.loaded) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando mudanças de loja...</div>';
    } else {
      html += scState.createForm
        ? scCreateFormHtml()
        : '<button type="button" class="modBtn" id="scNewBtn">+ Nova mudança de loja</button>';
      html += scState.storeChanges.length
        ? scDesktopTableHtml() + scMobileCardsHtml()
        : '<p class="note">Nenhuma mudança de loja cadastrada ainda.</p>';
    }
    return html;
  }

  function renderScModalRoot() {
    if (!scState.modal) { if (currentSection === 'mudancaLoja') clearNxModal(); return; }
    var m = scState.modal;
    if (m.kind === 'confirm') renderNxModal('Confirmar arquivamento', scConfirmBodyHtml(m), scCancelConfirm);
    else if (m.kind === 'editDepartments') renderNxModal('Editar departamentos', scEditDeptBodyHtml(m), scCloseModal);
    else if (m.kind === 'success') renderNxModal((scHomolog() ? '🧪 ' : '✅ ') + 'Mudança de loja atualizada', scSuccessBodyHtml(m), scCloseModalAndRefresh);
    else if (m.kind === 'error') renderNxModal('Erro', scErrorBodyHtml(m), scCloseModal);
    wireScModalInteraction();
  }
  function scCloseModal() { scState.modal = null; clearNxModal(); }
  function scCloseModalAndRefresh() { scState.modal = null; clearNxModal(); scState.loaded = false; scEnter(); }
  function scCancelConfirm() { scState.modal = null; clearNxModal(); }

  function scConfirmBodyHtml(m) {
    return '<div class="gbRow"><span>Vendedor</span><b>' + esc(m.record.nome_vendedor || '-') + '</b></div>' +
      '<div class="gbRow"><span>Destino</span><b>' + esc(m.record.loja_destino || '-') + '</b></div>' +
      '<p class="note gbWarn">⚠️ Arquivar torna este registro inativo. Isto NÃO desfaz o encadeamento -- registros mais recentes deste vendedor continuam valendo normalmente.</p>' +
      '<p id="scConfirmMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="scConfirmCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="scConfirmArchiveBtn"' + (inFlight.scAction ? ' disabled' : '') + '>Arquivar registro</button>' +
      '</div>';
  }
  // Real shared-modal form for SET_DEPARTMENTS -- deliberately NOT
  // V1's native window.prompt() (PM-5F Gate 55).
  function scEditDeptBodyHtml(m) {
    return '<div class="gbRow"><span>Vendedor</span><b>' + esc(m.record.nome_vendedor || '-') + '</b></div>' +
      '<label for="scEditDeptOrigem">Departamento de origem</label>' +
      '<select id="scEditDeptOrigem">' + scDeptOptionsHtml(m.record.departamento_origem) + '</select>' +
      '<label for="scEditDeptDestino">Departamento de destino</label>' +
      '<select id="scEditDeptDestino">' + scDeptOptionsHtml(m.record.departamento_destino) + '</select>' +
      '<p id="scEditDeptMsg" class="maSubtle gbErrText" role="status"></p>' +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="scEditDeptCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="scEditDeptSaveBtn"' + (inFlight.scAction ? ' disabled' : '') + '>Salvar departamentos</button>' +
      '</div>';
  }
  function scSuccessBodyHtml(m) {
    var simNote = scHomolog()
      ? '<p class="gbSimNote"><b>🧪 SIMULAÇÃO CONCLUÍDA — nenhuma alteração real foi realizada.</b></p>'
      : '';
    return simNote + '<p>' + esc(m.message || 'Ação concluída com sucesso.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="scSuccessCloseBtn">Fechar</button></div>';
  }
  function scErrorBodyHtml(m) {
    return '<p class="gbErrText">' + esc(m.message || 'Falha ao processar a ação.') + '</p>' +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="scErrorCloseBtn">Fechar</button></div>';
  }

  function scRecordById(id) {
    return scState.storeChanges.filter(function (r) { return String(r.id) === String(id); })[0] || null;
  }

  function scRunAction(promise, successMessage) {
    if (inFlight.scAction) return;
    inFlight.scAction = true;
    promise.then(
      function () {
        inFlight.scAction = false;
        scState.modal = { kind: 'success', message: successMessage };
        renderScModalRoot();
      },
      function (err) {
        inFlight.scAction = false;
        scState.modal = { kind: 'error', message: safeErrorMessage() };
        renderScModalRoot();
      }
    );
  }

  function scConfirmArchiveHandler() {
    if (inFlight.scAction) return;
    var m = scState.modal;
    if (!m || m.kind !== 'confirm') return;
    inFlight.scAction = true;
    var btn = document.getElementById('scConfirmArchiveBtn');
    if (btn) btn.disabled = true;
    SC_PROVIDER.archiveStoreChange(m.record.id).then(
      function () {
        inFlight.scAction = false;
        scState.modal = { kind: 'success', message: 'Registro arquivado com sucesso.' };
        renderScModalRoot();
      },
      function (err) {
        inFlight.scAction = false;
        var msg = document.getElementById('scConfirmMsg');
        // FECHAMENTO INTEGRADO -- P2: mesmo defeito e mesma correção de
        // cfgConfirmSaveHandler acima (err.state descartado, texto
        // genérico fixo). CONFLICT aqui é tratado à parte (em vez do
        // corpo genérico "Esta ação não pode ser concluída...") porque
        // a causa real (23P01, validação de cadeia de alocação
        // forward-only -- ver comentário no provider) é uma
        // inconsistência de dados específica e diagnosticável, não uma
        // falha genérica -- nunca o código/texto cru do Postgres, só a
        // explicação segura do motivo.
        var body = (err && err.state === 'CONFLICT')
          ? 'Esta arquivação conflita com outra mudança de alocação já registrada para o mesmo período.'
          : (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body;
        if (msg) msg.textContent = 'Erro ao arquivar: ' + body;
        if (btn) btn.disabled = false;
      }
    );
  }

  function scEditDeptSaveHandler() {
    if (inFlight.scAction) return;
    var m = scState.modal;
    if (!m || m.kind !== 'editDepartments') return;
    var origem = (document.getElementById('scEditDeptOrigem') || {}).value || '';
    var destino = (document.getElementById('scEditDeptDestino') || {}).value || '';
    inFlight.scAction = true;
    var btn = document.getElementById('scEditDeptSaveBtn');
    if (btn) btn.disabled = true;
    SC_PROVIDER.setDepartments(m.record.id, origem, destino).then(
      function () {
        inFlight.scAction = false;
        scState.modal = { kind: 'success', message: 'Departamentos atualizados com sucesso.' };
        renderScModalRoot();
      },
      function (err) {
        inFlight.scAction = false;
        var msg = document.getElementById('scEditDeptMsg');
        if (msg) msg.textContent = 'Erro ao salvar: ' + safeErrorMessage();
        if (btn) btn.disabled = false;
      }
    );
  }

  function scSaveCreateHandler() {
    if (inFlight.scAction) return;
    var f = scState.createForm;
    var cpf = (document.getElementById('scCpf') || {}).value || '';
    var login = (document.getElementById('scLogin') || {}).value || '';
    var nome = ((document.getElementById('scNome') || {}).value || '').trim();
    var lojaOrigem = ((document.getElementById('scLojaOrigem') || {}).value || '').trim();
    var lojaDestino = ((document.getElementById('scLojaDestino') || {}).value || '').trim();
    var iniOrigem = (document.getElementById('scIniOrigem') || {}).value || '';
    var fimOrigem = (document.getElementById('scFimOrigem') || {}).value || '';
    var iniDestino = (document.getElementById('scIniDestino') || {}).value || '';
    var obs = ((document.getElementById('scObs') || {}).value || '').trim();
    var deptOrigem = (document.getElementById('scDeptOrigem') || {}).value || '';
    var deptDestino = (document.getElementById('scDeptDestino') || {}).value || '';
    f.cpfVendedor = cpf; f.loginVendedor = login; f.nomeVendedor = nome;
    f.lojaOrigem = lojaOrigem; f.lojaDestino = lojaDestino;
    f.dataInicioOrigem = iniOrigem; f.dataFimOrigem = fimOrigem; f.dataInicioDestino = iniDestino;
    f.observacao = obs; f.departamentoOrigem = deptOrigem; f.departamentoDestino = deptDestino;
    if (!nome || !lojaDestino) { f.error = 'Informe o nome do vendedor e a loja de destino.'; renderPanel(); return; }
    if (!iniOrigem || !fimOrigem || !iniDestino) { f.error = 'Informe as três datas (início/fim da origem e início do destino).'; renderPanel(); return; }
    if (fimOrigem < iniOrigem) { f.error = 'Data final da origem não pode ser anterior à inicial.'; renderPanel(); return; }
    if (lojaOrigem && lojaOrigem.toUpperCase() === lojaDestino.toUpperCase()) { f.error = 'As lojas de origem e destino devem ser diferentes.'; renderPanel(); return; }
    f.error = null;
    inFlight.scAction = true;
    var btn = document.getElementById('scSaveCreateBtn');
    if (btn) btn.disabled = true;
    SC_PROVIDER.createStoreChange(f).then(
      function () {
        inFlight.scAction = false;
        scState.createForm = null;
        scState.modal = { kind: 'success', message: 'Mudança de loja criada com sucesso.' };
        renderScModalRoot();
      },
      function (err) {
        inFlight.scAction = false;
        f.error = safeErrorMessage();
        if (btn) btn.disabled = false;
        renderPanel();
      }
    );
  }

  // ---------- Utilização dos Simuladores (Painel Master Phase PM-5H) ----------
  // Real backend: master_simulator_usage_data(p_start_date, p_end_date)
  // (read-only, MASTER-only, confirmed live) over public.portal_module_
  // sessions (RLS enabled, ZERO policies -- RPC-only access, the
  // strongest posture in this codebase). READ-ONLY capability: no
  // mutation of any kind is exposed here, matching V1's own real
  // contract exactly (the only writers are the simulator surfaces
  // themselves, confirmed live, never called from this admin screen).
  var SU_PROVIDER = window.NX_MASTER_SIMULATOR_USAGE_PROVIDER;
  var SU_VM = window.NX_MASTER_SIMULATOR_USAGE_VM;

  function suEnter() {
    if (suState.loaded || suState.loading) { renderPanel(); return; }
    if (!suState.filtros.dtIni) {
      var preset = SU_VM.applyPreset('30d', null);
      suState.filtros.dtIni = preset.dtIni;
      suState.filtros.dtFim = preset.dtFim;
    }
    suLoad();
  }

  function suLoad() {
    suState.loading = true;
    suState.error = null;
    renderPanel();
    var startIso = SU_VM.startOfDayIso(suState.filtros.dtIni);
    var endIso = SU_VM.endOfDayIso(suState.filtros.dtFim);
    SU_PROVIDER.loadUsageData(startIso, endIso, {}).then(
      function (data) {
        suState.linhas = data.linhas || [];
        if (typeof data.telemetry_enabled === 'boolean') suState.telemetryEnabled = data.telemetry_enabled;
        if (data.telemetry_started_at) suState.telemetryStartedAt = data.telemetry_started_at;
        suState.loading = false;
        suState.loaded = true;
        renderPanel();
      },
      function (err) {
        suState.loading = false;
        suState.loaded = false;
        suState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function suSetPreset(preset) {
    var p = SU_VM.applyPreset(preset, suState.telemetryStartedAt);
    suState.filtros.preset = preset;
    suState.filtros.dtIni = p.dtIni;
    suState.filtros.dtFim = p.dtFim;
    suLoad();
  }
  function suSetData(campo, valor) {
    suState.filtros.preset = 'custom';
    suState.filtros[campo] = valor;
    suLoad();
  }
  function suSetFiltroSelect(campo, valor) {
    suState.filtros[campo] = valor;
    renderPanel();
  }
  var suBuscaDebounce = null;
  function suSetBusca(valor) {
    suState.filtros.busca = valor;
    clearTimeout(suBuscaDebounce);
    suBuscaDebounce = setTimeout(renderPanel, 200);
  }
  function suSetOrdenacao(valor) {
    suState.ordenacao = valor;
    renderPanel();
  }

  function suToggleNuncaUtilizou() {
    suState.nuncaUtilizouAberto = !suState.nuncaUtilizouAberto;
    if (suState.nuncaUtilizouAberto && !suState.nuncaUtilizouCache) {
      suState.nuncaUtilizouLoading = true;
      renderPanel();
      suCarregarNuncaUtilizou().then(function (lista) {
        suState.nuncaUtilizouCache = lista;
        suState.nuncaUtilizouLoading = false;
        renderPanel();
      }, function () {
        suState.nuncaUtilizouCache = [];
        suState.nuncaUtilizouLoading = false;
        renderPanel();
      });
      return;
    }
    renderPanel();
  }

  // No new RPC (Gate 4/20): reuses master_admin_security_data() already
  // wired for Usuários, and loads the full-lifetime dataset on demand
  // (independent of the period filter above -- Gate 16's own real V1
  // scope: "Nunca utilizou" considers all telemetry history, not the
  // currently-selected period).
  function suCarregarNuncaUtilizou() {
    var usersPromise = suState.usuariosCache
      ? Promise.resolve(suState.usuariosCache)
      : window.NX_MASTER_USERS_PROVIDER.loadMasterUsersData({}).then(function (data) {
        suState.usuariosCache = data.users;
        return data.users;
      });
    var lifetimePromise = suState.linhasLifetime
      ? Promise.resolve(suState.linhasLifetime)
      : SU_PROVIDER.loadUsageData(suState.telemetryStartedAt || '2020-01-01T00:00:00-03:00', new Date().toISOString(), {}).then(function (data) {
        suState.linhasLifetime = data.linhas || [];
        return suState.linhasLifetime;
      });
    return Promise.all([usersPromise, lifetimePromise]).then(function (results) {
      return SU_VM.neverUsed(results[0], results[1]);
    });
  }

  function suExportarXlsx() {
    if (typeof XLSX === 'undefined') { return; }
    var lista = SU_VM.sortUsers(SU_VM.groupByUser(SU_VM.filterRows(suState.linhas, suState.filtros)), suState.ordenacao);
    var ws = XLSX.utils.json_to_sheet(SU_VM.xlsxRows(lista));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utilizacao');
    XLSX.writeFile(wb, 'utilizacao_simuladores_' + suState.filtros.dtIni + '_a_' + suState.filtros.dtFim + '.xlsx');
  }

  var SU_LOJAS = ['ABC', 'ALPHAVILLE', 'ANALIA FRANCO', 'BARRA FUNDA', 'BANDEIRANTES', 'EUROPA', 'GASTAO', 'NACOES'];
  var SU_DEPARTAMENTOS = ['NOVOS', 'SEMINOVOS', 'NOVOS/SEMINOVOS'];
  var SU_PERFIS = ['VENDEDOR', 'GERENTE', 'ANALISTA', 'DIRETOR NOVOS', 'DIRETOR SEMINOVOS', 'MASTER'];

  function suBannerHtml() {
    if (suState.telemetryEnabled === false) {
      return '<div class="note suBanner suBannerWarn">' +
        '<b>Telemetria ainda não ativada em produção.</b>' +
        '<p class="maSubtle">A coleta real de utilização dos simuladores está desligada. Os indicadores abaixo ficarão zerados até a coleta ser iniciada oficialmente.</p></div>';
    }
    if (suState.telemetryEnabled !== true || !suState.telemetryStartedAt) return '';
    var f = suState.filtros;
    // Compared by real instant (Date.getTime()), never by ISO string --
    // the filter uses an explicit -03:00 offset while the RPC returns a
    // UTC timestamptz; string comparison would compare different-offset
    // representations, not the actual instant (PM-5H Gate 11 discipline).
    var startedAtMs = new Date(suState.telemetryStartedAt).getTime();
    var fimMs = f.dtFim ? new Date(SU_VM.endOfDayIso(f.dtFim)).getTime() : null;
    var iniMs = f.dtIni ? new Date(SU_VM.startOfDayIso(f.dtIni)).getTime() : null;
    var totalmenteAntes = fimMs !== null && fimMs < startedAtMs;
    var parcialmenteAntes = !totalmenteAntes && iniMs !== null && iniMs < startedAtMs;
    var inicioOficial = SU_VM.fmtDateTimeBR(suState.telemetryStartedAt);
    if (totalmenteAntes) {
      return '<div class="note suBanner suBannerWarn"><b>A coleta de utilização ainda não estava ativa neste período.</b>' +
        '<p class="maSubtle">Coleta oficial iniciada em ' + esc(inicioOficial) + '. O período selecionado é anterior a essa data — os indicadores abaixo não representam ausência de uso, e sim ausência de coleta.</p></div>';
    }
    var notaParcial = parcialmenteAntes ? '<p class="maSubtle">Dados disponíveis a partir de ' + esc(inicioOficial) + '.</p>' : '';
    return '<div class="note suBanner suBannerOk"><b>Coleta iniciada em ' + esc(inicioOficial) + '.</b>' + notaParcial + '</div>';
  }

  function suKpiCardsHtml(kpis) {
    return '<div class="suKpiCards">' +
      '<div class="pcCard"><div class="pcCardK">Usuários que utilizaram</div><div class="pcCardV">' + kpis.usuarios + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Sessões</div><div class="pcCardV">' + kpis.sessions + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Simulações realizadas</div><div class="pcCardV">' + kpis.simulations + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Tempo ativo</div><div class="pcCardV">' + esc(SU_VM.fmtDuration(kpis.activeSeconds)) + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Tempo médio por sessão</div><div class="pcCardV">' + esc(SU_VM.fmtAvgDuration(kpis.activeSeconds, kpis.sessions)) + '</div></div>' +
      '</div>';
  }

  function suComparativoHtml(porModulo) {
    return '<h3>Uso por Simulador</h3><div class="udsCompareGrid">' + porModulo.map(function (m) {
      return '<div class="udsCompareCard"><div class="udsCompareTitle">' + esc(m.label) + '</div>' +
        '<div class="udsCompareRow"><span>Usuários</span><b>' + m.usuarios + '</b></div>' +
        '<div class="udsCompareRow"><span>Sessões</span><b>' + m.sessions + '</b></div>' +
        '<div class="udsCompareRow"><span>Simulações</span><b>' + m.simulations + '</b></div>' +
        '<div class="udsCompareRow"><span>Tempo ativo</span><b>' + esc(SU_VM.fmtDuration(m.activeSeconds)) + '</b></div></div>';
    }).join('') + '</div>';
  }

  function suRowHtml(u) {
    return '<div class="udsRow" data-id="' + esc(u.usuario_id) + '">' +
      '<div class="udsMain"><div class="udsName">' + esc(u.nome || '') + '</div>' +
      '<div class="udsMetaMobile">' + esc(u.loja || '—') + ' • ' + esc(u.departamento || u.perfil || '—') + '</div></div>' +
      '<div class="udsCol udsColLoja" data-label="Loja">' + esc(u.loja || '—') + '</div>' +
      '<div class="udsCol udsColDep" data-label="Departamento">' + esc(u.departamento || '—') + '</div>' +
      '<div class="udsCol udsColNum" data-label="Novos">' + u.acessosNovos + '</div>' +
      '<div class="udsCol udsColNum" data-label="Seminovos">' + u.acessosSeminovos + '</div>' +
      '<div class="udsCol udsColNum" data-label="Simulações">' + u.simulacoes + '</div>' +
      '<div class="udsCol udsColNum" data-label="Tempo ativo">' + esc(SU_VM.fmtDuration(u.tempoAtivo)) + '</div>' +
      '<div class="udsCol" data-label="Último uso">' + esc(SU_VM.fmtDateTimeBR(u.ultimoUso)) + '</div>' +
      '<div class="udsCol udsColAcao"><button type="button" class="modBtnGhost suDetailBtn" data-id="' + esc(u.usuario_id) + '">Ver detalhes</button></div>' +
      '</div>';
  }

  function suNuncaUtilizouHtml() {
    if (!suState.nuncaUtilizouAberto) {
      return '<div class="udsNuncaBox"><button type="button" class="modBtnGhost" id="suToggleNuncaBtn">Ver quem nunca utilizou os simuladores</button></div>';
    }
    if (suState.nuncaUtilizouLoading) {
      return '<div class="udsNuncaBox"><p class="note">Carregando...</p></div>';
    }
    var lista = suState.nuncaUtilizouCache || [];
    var porUsuario = {};
    var order = [];
    lista.forEach(function (r) {
      if (!porUsuario[r.usuario_id]) { porUsuario[r.usuario_id] = { nome: r.nome, loja: r.loja, perfil: r.perfil, modulos: [] }; order.push(r.usuario_id); }
      var mod = SU_VM.MODULES.filter(function (m) { return m.id === r.module_id; })[0];
      porUsuario[r.usuario_id].modulos.push(mod ? mod.label : r.module_id);
    });
    var linhas = order.map(function (id) { return porUsuario[id]; }).sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); });
    var rows = linhas.map(function (u) {
      return '<div class="udsNuncaRow"><div><b>' + esc(u.nome || '') + '</b></div>' +
        '<div class="maSubtle">' + esc(u.loja || '—') + ' • ' + esc(u.perfil || '—') + '</div>' +
        '<div class="maSubtle">Elegível: ' + esc(u.modulos.join(', ')) + '</div></div>';
    }).join('');
    return '<div class="udsNuncaBox"><div class="udsNuncaHead"><h3>Nunca utilizaram (' + linhas.length + ')</h3>' +
      '<button type="button" class="modBtnGhost" id="suToggleNuncaBtn">Ocultar</button></div>' +
      '<p class="note">Considera todo o histórico de telemetria disponível (independente do filtro de período acima) — vendedores/gerentes/analistas com permissão para pelo menos um simulador e nenhuma sessão registrada.</p>' +
      (rows || '<p class="note">Nenhum usuário elegível está sem uso — ou a coleta ainda não iniciou.</p>') + '</div>';
  }

  function suResultsHtml() {
    var filtradas = SU_VM.filterRows(suState.linhas, suState.filtros);
    var kpis = SU_VM.globalKpis(filtradas);
    var porModulo = SU_VM.byModule(filtradas);
    var usuarios = SU_VM.sortUsers(SU_VM.groupByUser(filtradas), suState.ordenacao);
    var rows = usuarios.map(suRowHtml).join('');
    var header = '<div class="udsRow udsRowHead"><div class="udsMain">Usuário</div>' +
      '<div class="udsCol udsColLoja">Loja</div><div class="udsCol udsColDep">Departamento</div>' +
      '<div class="udsCol udsColNum">Novos</div><div class="udsCol udsColNum">Seminovos</div>' +
      '<div class="udsCol udsColNum">Simulações</div><div class="udsCol udsColNum">Tempo ativo</div>' +
      '<div class="udsCol">Último uso</div><div class="udsCol udsColAcao"></div></div>';
    return suKpiCardsHtml(kpis) + suComparativoHtml(porModulo) +
      '<div class="udsList">' + header + (rows || '<p class="note" style="padding:16px">Nenhum acesso registrado para os filtros selecionados.</p>') + '</div>' +
      suNuncaUtilizouHtml();
  }

  function renderUtilizacaoSimuladoresSection() {
    var html = '<h2>Utilização dos Simuladores</h2>' +
      '<p class="note">Dados de uso (acessos, sessões, tempo ativo, simulações realizadas) — nunca conteúdo de simulação. Sem CPF, cliente, chassi ou valores financeiros. Tela somente leitura.</p>';
    if (suState.error) {
      return html + errorStateHtml(suState.error.state, suState.error.message) +
        '<button type="button" id="suRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    }
    if (suState.loading || !suState.loaded) {
      return html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando utilização...</div>';
    }
    html += suBannerHtml();
    var f = suState.filtros;
    var presets = [['hoje', 'Hoje'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['mesAtual', 'Mês atual'], ['mesAnterior', 'Mês anterior'], ['desdeInicio', 'Desde o início']];
    html += '<div class="suPresetGroup">' + presets.map(function (p) {
      return '<button type="button" class="' + (f.preset === p[0] ? 'modBtn' : 'modBtnGhost') + ' suPresetBtn" data-preset="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '<button type="button" class="modBtnGhost" id="suExportBtn">Exportar XLSX</button></div>';
    html += '<div class="modFilters">' +
      '<div class="modField"><label for="suDtIni">Data inicial</label><input type="date" id="suDtIni" value="' + esc(f.dtIni) + '"></div>' +
      '<div class="modField"><label for="suDtFim">Data final</label><input type="date" id="suDtFim" value="' + esc(f.dtFim) + '"></div>' +
      suFiltroSelectHtml('suLoja', 'Loja', SU_LOJAS, f.loja) +
      suFiltroSelectHtml('suDep', 'Departamento', SU_DEPARTAMENTOS, f.departamento) +
      '<div class="modField"><label for="suModulo">Módulo</label><select id="suModulo"><option value="">TODOS</option>' +
      SU_VM.MODULES.map(function (m) { return '<option value="' + esc(m.id) + '"' + (f.modulo === m.id ? ' selected' : '') + '>' + esc(m.label) + '</option>'; }).join('') + '</select></div>' +
      suFiltroSelectHtml('suPerfil', 'Perfil', SU_PERFIS, f.perfil) +
      '</div>';
    html += '<div class="modFilters">' +
      '<div class="modField"><label for="suBusca">Pesquisar usuário...</label>' +
      '<input type="text" id="suBusca" value="' + esc(f.busca) + '" placeholder="Nome, loja ou perfil"></div>' +
      '<div class="modField"><label for="suOrdenacao">Ordenar por</label><select id="suOrdenacao">' +
      '<option value="ultimo_uso_desc"' + (suState.ordenacao === 'ultimo_uso_desc' ? ' selected' : '') + '>Último uso (mais recente)</option>' +
      '<option value="simulacoes"' + (suState.ordenacao === 'simulacoes' ? ' selected' : '') + '>Mais simulações</option>' +
      '<option value="sessoes"' + (suState.ordenacao === 'sessoes' ? ' selected' : '') + '>Mais sessões</option>' +
      '<option value="tempo"' + (suState.ordenacao === 'tempo' ? ' selected' : '') + '>Mais tempo ativo</option>' +
      '<option value="nome"' + (suState.ordenacao === 'nome' ? ' selected' : '') + '>Nome (A-Z)</option>' +
      '</select></div></div>';
    html += '<div id="suResultsArea">' + suResultsHtml() + '</div>';
    return html;
  }
  function suFiltroSelectHtml(id, label, opcoes, valorAtual) {
    var options = '<option value="">TODOS</option>' + opcoes.map(function (o) {
      return '<option value="' + esc(o) + '"' + (valorAtual === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    return '<div class="modField"><label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' + options + '</select></div>';
  }

  function suUserById(usuarioId) {
    var lista = SU_VM.groupByUser(SU_VM.filterRows(suState.linhas, suState.filtros));
    return lista.filter(function (u) { return String(u.usuario_id) === String(usuarioId); })[0] || null;
  }
  function suModuleBlockHtml(label, m) {
    if (!m) return '<h4>' + esc(label) + '</h4><p class="note">Sem uso registrado no período filtrado.</p>';
    return '<h4>' + esc(label) + '</h4>' +
      fieldRow('Sessões', m.sessions) +
      fieldRow('Simulações', m.simulation_count) +
      fieldRow('Tempo ativo', SU_VM.fmtDuration(m.active_seconds)) +
      fieldRow('Dias ativos', m.active_days) +
      fieldRow('Primeiro uso', SU_VM.fmtDateTimeBR(m.first_use)) +
      fieldRow('Último uso', SU_VM.fmtDateTimeBR(m.last_use));
  }
  function suDrawerBodyHtml(u) {
    return '<p class="note">"Dias ativos" é mostrado por simulador abaixo — somar entre os dois módulos poderia contar o mesmo dia duas vezes se o usuário usou ambos no mesmo dia.</p>' +
      fieldRow('Sessões totais', u.acessosNovos + u.acessosSeminovos) +
      fieldRow('Simulações', u.simulacoes) +
      fieldRow('Tempo ativo', SU_VM.fmtDuration(u.tempoAtivo)) +
      fieldRow('Tempo médio por sessão', SU_VM.fmtAvgDuration(u.tempoAtivo, u.acessosNovos + u.acessosSeminovos)) +
      fieldRow('Primeiro uso', SU_VM.fmtDateTimeBR(u.primeiroUso)) +
      fieldRow('Último uso', SU_VM.fmtDateTimeBR(u.ultimoUso)) +
      suModuleBlockHtml('Simulador de Novos', u.porModulo.simuladorCompleto) +
      suModuleBlockHtml('Simulador de Seminovos', u.porModulo.simuladorSeminovos);
  }
  function renderSuDrawerRoot() {
    if (!suState.drawerUserId) { if (currentSection === 'utilizacaoSimuladores') clearNxModal(); return; }
    var u = suUserById(suState.drawerUserId);
    if (!u) { suState.drawerUserId = null; clearNxModal(); return; }
    renderNxModal(u.nome || 'Detalhes de uso', suDrawerBodyHtml(u), suCloseDrawer);
  }
  function suCloseDrawer() { suState.drawerUserId = null; clearNxModal(); }

  // ---------- Histórico de Competências (Painel Master Phase PM-5H) ----------
  // STRICTLY READ-ONLY (Gate 4/33): this whole block calls exactly 3
  // real RPCs, all reads (HC_PROVIDER.listClosings/getSnapshot/
  // exportSnapshot) -- no create/edit/close/reopen/archive/delete path
  // exists here, and none may ever be added (see tests/master-
  // competence-history-provider-test.py's read-only-proof check).
  var HC_PROVIDER = window.NX_MASTER_COMPETENCE_HISTORY_PROVIDER;
  var HC_VM = window.NX_MASTER_COMPETENCE_HISTORY_VM;
  var RHDP_ENGINE = window.NX_MASTER_COMPETENCE_RHDP_EXPORT_ENGINE;

  function historyEnter() {
    if (historyState.loaded || historyState.loading) { renderPanel(); return; }
    historyLoad();
  }
  function historyLoad() {
    historyState.loading = true;
    historyState.error = null;
    renderPanel();
    HC_PROVIDER.listClosings({}).then(
      function (rows) {
        historyState.closings = HC_VM.sortClosings(rows);
        historyState.loading = false;
        historyState.loaded = true;
        renderPanel();
      },
      function (err) {
        historyState.loading = false;
        historyState.loaded = false;
        historyState.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }
  function historyClosingById(id) {
    return historyState.closings.filter(function (c) { return String(c.id) === String(id); })[0] || null;
  }
  function historyOpenDetail(closingId) {
    var closing = historyClosingById(closingId);
    if (!closing) return;
    historyState.detail = { closingId: closingId, closing: closing, loading: true, error: null, rows: [] };
    renderPanel();
    HC_PROVIDER.getSnapshot(closingId, {}).then(
      function (rows) {
        // Version isolation (Gate 15/35): only commit into state if the
        // user hasn't already navigated to a DIFFERENT closing while
        // this request was in flight -- never lets a slow response for
        // closing A overwrite the detail the user is now viewing for
        // closing B.
        if (!historyState.detail || historyState.detail.closingId !== closingId) return;
        historyState.detail.rows = HC_VM.sortSnapshotRows(rows);
        historyState.detail.loading = false;
        renderPanel();
      },
      function (err) {
        if (!historyState.detail || historyState.detail.closingId !== closingId) return;
        historyState.detail.loading = false;
        historyState.detail.error = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }
  function historyCloseDetail() {
    historyState.detail = null;
    renderPanel();
  }

  // ---------- Reabertura de Competência (Painel Master Phase PM-5K-RETRY) ----------
  // Frontend mirror of the real, live-confirmed server guard inside
  // master_reopen_commission_period (`v_closing.ativo is not true or
  // status <> 'FECHADO'` -> 22023): only a closing that is BOTH
  // status==='FECHADO' AND ativo!==false may show the action at all.
  // The server remains the sole authority -- this only avoids offering
  // an action the RPC would certainly reject.
  function hcClosingCanReopen(c) {
    return !!c && String(c.status || '').toUpperCase() === 'FECHADO' && c.ativo !== false;
  }
  function hcOpenReopenModal(closing) {
    if (!hcClosingCanReopen(closing)) return;
    historyState.reopenClosing = closing;
    historyState.reopenError = null;
    historyState.reopenModalOpen = true;
    renderHcReopenModalRoot();
  }
  function hcCancelReopen() {
    historyState.reopenModalOpen = false;
    clearNxModal();
  }
  function hcSetReopenSimulate(value) {
    historyState.reopenSimulate = value;
    renderHcReopenModalRoot();
  }
  function hcConfirmReopen() {
    if (historyState.reopening) return; // double-submit guard (Gate 35)
    var c = historyState.reopenClosing;
    if (!c) return;
    historyState.reopening = true;
    historyState.reopenError = null;
    renderHcReopenModalRoot();
    var writeCall = historyState.reopenSimulate
      ? CL_PROVIDER.reopenCommissionPeriodSimulated(c.id, c.periodo_id)
      : CL_PROVIDER.reopenCommissionPeriod(c.id, {});
    writeCall.then(
      function () {
        historyState.reopening = false;
        historyState.reopenModalOpen = false;
        clearNxModal();
        if (historyState.reopenSimulate) {
          // Gate 36: in simulated mode nothing changed server-side, so a
          // canonical refetch would just return the pre-reopen state.
          // Apply the SAME mutation the real RPC is proven to perform
          // (live pg_get_functiondef, PM-5K-RETRY) to the in-memory copy
          // ONLY, purely so the Human can see the expected result --
          // never persisted, never sent anywhere.
          var nowIso = new Date().toISOString();
          [historyState.closings, historyState.detail ? [historyState.detail.closing] : []].forEach(function (list) {
            list.forEach(function (row) {
              if (String(row.id) === String(c.id)) {
                row.status = 'REABERTO';
                row.ativo = false;
                row.reaberto_por = row.reaberto_por || '(simulado)';
                row.reaberto_em = nowIso;
              }
            });
          });
          historyState.closings = HC_VM.sortClosings(historyState.closings);
        } else {
          // Real mode: never fabricate state -- always re-read canonical.
          // historyOpenDetail() must run AFTER the refetch resolves (not
          // right after firing it) or it would re-derive the detail from
          // the still-stale historyState.closings array.
          var wasViewingDetail = historyState.detail && historyState.detail.closingId === c.id;
          historyState.loading = true;
          renderPanel();
          HC_PROVIDER.listClosings({}).then(
            function (rows) {
              historyState.closings = HC_VM.sortClosings(rows);
              historyState.loading = false;
              historyState.loaded = true;
              if (wasViewingDetail) { historyOpenDetail(c.id); } else { renderPanel(); }
            },
            function (err) {
              historyState.loading = false;
              historyState.error = err || { state: 'RPC_ERROR' };
              renderPanel();
            }
          );
          return;
        }
        renderPanel();
      },
      function (err) {
        historyState.reopening = false;
        historyState.reopenError = err || { state: 'RPC_ERROR' };
        renderHcReopenModalRoot();
      }
    );
  }
  function renderHcReopenModalRoot() {
    if (!historyState.reopenModalOpen) { if (currentSection === 'historicoCompetencias') clearNxModal(); return; }
    renderNxModal('Confirmar reabertura de competência', hcReopenModalBodyHtml(), hcCancelReopen);
    wireHcReopenModalInteraction();
  }
  // Same reason every sibling modal wires itself right after rendering
  // (wireClosingModalInteraction et al.) -- #nxModalRoot content is
  // outside the main panel's own render+wire cycle.
  function wireHcReopenModalInteraction() {
    var cancelBtn = document.getElementById('hcReopenCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', hcCancelReopen);
    var doBtn = document.getElementById('hcReopenDoBtn');
    if (doBtn) doBtn.addEventListener('click', hcConfirmReopen);
    var simToggle = document.getElementById('hcReopenSimulateToggle');
    if (simToggle) simToggle.addEventListener('change', function (e) { hcSetReopenSimulate(e.target.checked); });
  }
  function hcReopenModalBodyHtml() {
    var c = historyState.reopenClosing;
    if (!c) return '';
    var modoTxt = historyState.reopenSimulate
      ? '<p class="note gbWarn"><b>Modo simulação ativo.</b> Nenhum dado real será alterado -- esta confirmação apenas simula o resultado da reabertura, localmente.</p>'
      : '<p class="note gbWarn"><b>Modo real ativo.</b> Esta ação chama o servidor e marca este fechamento como REABERTO de verdade.</p>';
    // Real server rejection messages (42501/P0002/22023, confirmed by
    // direct reading of master_reopen_commission_period's own live SQL,
    // PM-5K-RETRY) are already hand-authored, safe, user-facing text --
    // shown verbatim here, same discipline already established for
    // Fechamento's own close-error display and Histórico's export
    // rejection (PM-5H/PM-5J).
    var errHtml = historyState.reopenError
      ? (historyState.reopenError.state === 'RPC_ERROR' && historyState.reopenError.message
        ? '<div class="modErrorState"><div class="modStateTitle">Reabertura não concluída</div>' + esc(historyState.reopenError.message) + '</div>'
        : errorStateHtml(historyState.reopenError.state, historyState.reopenError.message))
      : '';
    // Every consequence listed below is provable from the real,
    // live-read function body (PM-5K-RETRY) -- never a generic guess
    // (Gate 34: "no generic claims").
    return '<div class="gbRow"><span>Competência</span><b>' + esc(c.nome_periodo || '-') + '</b></div>' +
      '<div class="gbRow"><span>Versão atual</span><b>v' + esc(c.versao != null ? c.versao : '-') + '</b></div>' +
      '<div class="gbRow"><span>Status atual</span><b>' + hcStatusBadgeHtml(c.status) + '</b></div>' +
      '<div class="gbRow"><span>Fechado em</span><b>' + esc(HC_VM.fmtDateTimeBR(c.fechado_em)) + '</b></div>' +
      '<div class="modField" style="max-width:420px"><label><input type="checkbox" id="hcReopenSimulateToggle"' + (historyState.reopenSimulate ? ' checked' : '') + (historyState.reopening ? ' disabled' : '') + '> Modo simulação (recomendado) -- nenhum dado real é alterado</label></div>' +
      '<ul class="note">' +
      '<li>Este fechamento (v' + esc(c.versao != null ? c.versao : '-') + ') será marcado como <b>REABERTO</b> e deixará de ser o fechamento ativo desta competência.</li>' +
      '<li>O período "' + esc(c.nome_periodo || '') + '" voltará ao status <b>EM CONFERÊNCIA</b>.</li>' +
      '<li>As linhas de snapshot já registradas para esta versão <b>não são alteradas nem removidas</b> -- continuam disponíveis aqui no Histórico.</li>' +
      '<li>Depois de reaberto, será possível gerar um novo fechamento (v' + (c.versao != null ? (Number(c.versao) + 1) : '?') + ') para este período, na tela Fechamento de Competência.</li>' +
      '</ul>' +
      modoTxt + errHtml +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="hcReopenCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="hcReopenDoBtn"' + (historyState.reopening ? ' disabled' : '') + '>' + (historyState.reopening ? 'Processando...' : 'Confirmar Reabertura') + '</button>' +
      '</div>';
  }

  // Export uses the SEPARATE, fail-closed RPC (Gate 13/22/37) -- never
  // the already-fetched (unguarded) historyState.detail.rows, even if
  // they're sitting right there in memory. A real 22023 rejection from
  // the server is shown verbatim (mapped to a friendly copy) and the
  // export simply does not happen -- no workbook, no fallback source.
  function historyExportXlsx(closingId) {
    if (historyState.exportingId) return;
    var closing = historyClosingById(closingId);
    if (!closing) return;
    historyState.exportingId = closingId;
    historyState.exportError = null;
    renderPanel();
    HC_PROVIDER.exportSnapshot(closingId, {}).then(
      function (rows) {
        historyState.exportingId = null;
        if (typeof XLSX === 'undefined') { renderPanel(); return; }
        var ws = XLSX.utils.json_to_sheet(HC_VM.xlsxRows(rows));
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Snapshot');
        XLSX.writeFile(wb, 'snapshot_' + (closing.nome_periodo || closing.id) + '_v' + closing.versao + '.xlsx');
        renderPanel();
      },
      function (err) {
        historyState.exportingId = null;
        historyState.exportError = { closingId: closingId, err: err || { state: 'RPC_ERROR' } };
        renderPanel();
      }
    );
  }

  // PM-6B -- Exportar RH/DP. Verbatim-equivalent port of V1's
  // exportarRhDpOficialHistorico (portal-app.js:5874-5883): fail-closed
  // snapshot (master_commission_snapshot_export) + SPF audit
  // (master_operational_spf_audit_period) + live chassis detail
  // (operational_salary_details, reconciled fail-closed against the
  // frozen snapshot) -> 8-sheet workbook. ANY of the 3 reads failing, or
  // the reconciliation diverging, blocks the WHOLE export -- never a
  // partial/incomplete workbook (Gate 11/14 of this Phase's own brief).
  // Financial totals come exclusively from the frozen snapshot rows --
  // never recalculated (Gate 12).
  function objectRowsToAoA(rows) {
    var headers = Object.keys((rows && rows[0]) || { 'Aviso': '' });
    var body = rows.map(function (r) { return headers.map(function (h) { return r[h]; }); });
    return { headers: headers, body: body };
  }
  var RHDP_MONEY_COLS = {
    sheet2or4: ['Retorno', '70% SPF', 'Retorno + 70% SPF', 'Comissao_Total'],
    sheet3: ['Retorno', '70% SPF', 'Retorno + 70% SPF', 'Valor Unitário SPF', 'Comissão SPF', 'Comissão Principal', 'Comissao_Total'],
    sheet5: ['Valor Financiado/Serviço', 'Retorno'], sheet6: ['Valor Venda', 'Retorno'],
    sheet7: ['Valor_SPF_Bruto', 'Valor_SPF_70pct'],
    sheet8: ['Producao', 'Retorno', 'SPF_Extra', 'SPF_Liquido', 'Rentabilidade_Total', 'Comissao_Principal', 'Comissao_SPF', 'Comissao_Total']
  };
  var RHDP_PCT_COLS = { sheet2or4: ['Share', 'Faixa de Comissão'], sheet3: ['Share', 'Faixa de Comissão'], sheet8: ['Share', 'Faixa'] };
  function rhdpAppendSheet(wb, name, rows, moneyCols, pctCols) {
    var shaped = objectRowsToAoA(rows);
    var ws = window.NX_XLSX_EXPORT_HELPER.buildStyledWorksheet(shaped.headers, shaped.body, name, {
      moneyCols: new Set(moneyCols || []), pctCols: new Set(pctCols || [])
    });
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  function resumoExecutivoFromClosing(closing, normalizedRows) {
    var obs = HC_VM.parseObservacao(closing.observacao);
    if (obs && (obs.qtd_vendida !== undefined || obs.qtd_financiada !== undefined || obs.producao_total !== undefined)) {
      return { vendidas: Number(obs.qtd_vendida) || 0, financiadas: Number(obs.qtd_financiada) || 0, producao: Number(obs.producao_total) || 0, retorno: Number(obs.retorno_total) || 0, spf_extra: Number(obs.spf_total) || 0 };
    }
    return normalizedRows.filter(function (r) { return String(r.perfil || '').toUpperCase() === 'VENDEDOR'; })
      .reduce(function (a, r) { a.vendidas += r.vendidas; a.financiadas += r.financiadas; a.producao += r.producao; a.retorno += r.retorno; a.spf_extra += r.spf_extra; return a; },
        { vendidas: 0, financiadas: 0, producao: 0, retorno: 0, spf_extra: 0 });
  }
  function historyExportRhDp(closingId) {
    if (historyState.rhdpExportingId) return; // double-submit guard (Gate 32)
    var closing = historyClosingById(closingId);
    if (!closing) return;
    historyState.rhdpExportingId = closingId;
    var newErrMap = Object.assign({}, historyState.rhdpErrorByClosingId);
    delete newErrMap[closingId];
    historyState.rhdpErrorByClosingId = newErrMap;
    renderPanel();

    // PM-6D.3: COMPLETE closings read their CHASSIS/SPF detail
    // exclusively from the frozen snapshot_operational_detail table
    // (via loadOperationalSnapshot) -- operational_salary_details/
    // master_operational_spf_audit_period/reconcileChassisDetail are
    // NEVER called for them (Gate 3/25/29 of this Phase's own brief:
    // "É PROIBIDO chamar... para gerar o RH/DP histórico. Mesmo que as
    // bases atuais estejam disponíveis."). LEGACY_PARTIAL closings keep
    // the EXACT prior behavior (live reconstruction + fail-closed
    // reconciliation), byte-unchanged. If loadOperationalSnapshot
    // itself fails for ANY reason (session/auth/network/malformed), the
    // whole export blocks -- it is NEVER treated as an implicit
    // LEGACY_PARTIAL (Gate 34: "Se não for possível determinar
    // COMPLETE/LEGACY: BLOCK. Não assumir LEGACY.").
    var normalizedRows, spfRows, chassisRows;
    HC_PROVIDER.exportSnapshot(closingId, {})
      .then(function (rawRows) {
        normalizedRows = rawRows.map(HC_VM.normalizeSnapshotRow);
        return HC_PROVIDER.loadOperationalSnapshot(closingId, {});
      })
      .then(function (opSnapshot) {
        if (opSnapshot.completeness === 'COMPLETE') {
          var split = RHDP_ENGINE.splitFrozenOperationalRows(opSnapshot.rows);
          if (!split.ok) {
            return Promise.reject({ state: 'RPC_ERROR', message: 'O detalhe histórico congelado desta competência está em um formato inesperado. A exportação foi interrompida por segurança.' });
          }
          chassisRows = split.chassisRows;
          spfRows = split.spfRows;
          return Promise.resolve();
        }
        if (opSnapshot.completeness === 'LEGACY_PARTIAL') {
          return HC_PROVIDER.loadSpfAudit(closing.data_inicio, closing.data_fim, {})
            .then(function (rows) {
              spfRows = rows;
              return HC_PROVIDER.loadOperationalSalaryDetails(closing.data_inicio, closing.data_fim, {});
            })
            .then(function (liveChassisRows) {
              var recon = RHDP_ENGINE.reconcileChassisDetail(liveChassisRows, normalizedRows);
              if (!recon.ok) {
                return Promise.reject({ state: 'RPC_ERROR', message: 'O detalhe operacional atual não corresponde ao snapshot congelado desta competência. A exportação foi interrompida para preservar a integridade da auditoria.' });
              }
              chassisRows = liveChassisRows;
            });
        }
        // Unreachable in practice -- HC_PROVIDER.loadOperationalSnapshot
        // itself already rejects any completeness value other than
        // these two (MALFORMED_RESPONSE) -- kept as an explicit,
        // fail-closed safety net rather than an unchecked assumption.
        return Promise.reject({ state: 'RPC_ERROR', message: 'Estado de integridade histórica desconhecido para esta competência. A exportação foi interrompida por segurança.' });
      })
      .then(function () {
        if (typeof XLSX === 'undefined' || !window.NX_XLSX_EXPORT_HELPER) {
          return Promise.reject({ state: 'RPC_ERROR', message: 'Biblioteca de planilhas indisponível neste ambiente. Recarregue a página e tente novamente.' });
        }
        var executivo = resumoExecutivoFromClosing(closing, normalizedRows);
        var comissaoTotal = HC_VM.aggregateSnapshotRows(normalizedRows).comissao_total;
        var sheet1 = RHDP_ENGINE.buildSheet1Resumo(closing, normalizedRows, executivo, comissaoTotal);
        var wb = XLSX.utils.book_new();
        var ws1 = XLSX.utils.aoa_to_sheet(sheet1.header);
        ws1['!cols'] = [{ wch: 36 }, { wch: 28 }, { wch: 24 }, { wch: 24 }];
        XLSX.utils.book_append_sheet(wb, ws1, '1_RESUMO_PRINCIPAL');
        rhdpAppendSheet(wb, '2_VENDEDORES', RHDP_ENGINE.buildSheet2Vendedores(normalizedRows), RHDP_MONEY_COLS.sheet2or4, RHDP_PCT_COLS.sheet2or4);
        rhdpAppendSheet(wb, '3_ANALISTAS_GESTOR', RHDP_ENGINE.buildSheet3AnalistasGestor(normalizedRows), RHDP_MONEY_COLS.sheet3, RHDP_PCT_COLS.sheet3);
        rhdpAppendSheet(wb, '4_GERENTES', RHDP_ENGINE.buildSheet4Gerentes(normalizedRows), RHDP_MONEY_COLS.sheet2or4, RHDP_PCT_COLS.sheet2or4);
        rhdpAppendSheet(wb, '5_CHASSIS_FINANCIADOS', RHDP_ENGINE.buildSheet5ChassisFinanciados(chassisRows), RHDP_MONEY_COLS.sheet5, null);
        rhdpAppendSheet(wb, '6_TODOS_CHASSIS_VENDEDOR', RHDP_ENGINE.buildSheet6TodosChassis(chassisRows), RHDP_MONEY_COLS.sheet6, null);
        rhdpAppendSheet(wb, '7_AUDITORIA_SPF', RHDP_ENGINE.buildSheet7AuditoriaSpf(spfRows), RHDP_MONEY_COLS.sheet7, null);
        rhdpAppendSheet(wb, '8_MEMORIA_DE_CALCULO', RHDP_ENGINE.buildSheet8Memoria(normalizedRows), RHDP_MONEY_COLS.sheet8, RHDP_PCT_COLS.sheet8);
        XLSX.writeFile(wb, RHDP_ENGINE.buildFilename(closing));
        historyState.rhdpExportingId = null;
        renderPanel();
      })
      .catch(function (err) {
        historyState.rhdpExportingId = null;
        var m = Object.assign({}, historyState.rhdpErrorByClosingId);
        m[closingId] = err || { state: 'RPC_ERROR' };
        historyState.rhdpErrorByClosingId = m;
        renderPanel();
      });
  }

  // PM-6B -- PDF / Imprimir. Verbatim-equivalent port of V1's
  // imprimirRhDpOficialHistorico (portal-app.js:5885-5891): same
  // fail-closed snapshot source as Exportar RH/DP, no SPF/chassis
  // supplementary data (V1's print flow never fetches them either).
  // Opens a new window with a printable HTML document -- never
  // generates a binary PDF (Gate 19/20).
  function historyPrintRhDp(closingId) {
    if (historyState.printOpeningId) return; // double-submit guard (Gate 32)
    var closing = historyClosingById(closingId);
    if (!closing) return;
    historyState.printOpeningId = closingId;
    var newErrMap = Object.assign({}, historyState.printErrorByClosingId);
    delete newErrMap[closingId];
    historyState.printErrorByClosingId = newErrMap;
    renderPanel();
    HC_PROVIDER.exportSnapshot(closingId, {}).then(
      function (rawRows) {
        historyState.printOpeningId = null;
        var normalizedRows = rawRows.map(HC_VM.normalizeSnapshotRow);
        var html = HC_VM.buildPrintHtml('Relatório ' + (closing.nome_periodo || ''), normalizedRows);
        var w = window.open('', '_blank');
        if (!w) {
          var m = Object.assign({}, historyState.printErrorByClosingId);
          m[closingId] = { state: 'RPC_ERROR', message: 'O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.' };
          historyState.printErrorByClosingId = m;
          renderPanel();
          return;
        }
        w.document.write(html);
        w.document.close();
        renderPanel();
      },
      function (err) {
        historyState.printOpeningId = null;
        var m = Object.assign({}, historyState.printErrorByClosingId);
        m[closingId] = err || { state: 'RPC_ERROR' };
        historyState.printErrorByClosingId = m;
        renderPanel();
      }
    );
  }

  function hcStatusBadgeHtml(status) {
    var s = String(status || '').toUpperCase();
    var cls = s === 'FECHADO' ? 'maBadgeActive' : (s === 'REABERTO' ? 'maBadgeInvited' : 'maBadgeInactive');
    return '<span class="maBadge ' + cls + '">' + esc(HC_VM.statusLabel(status)) + '</span>';
  }

  // PM-6B: shared action-button fragment reused by hcRowHtml,
  // hcMobileCardHtml AND hcDetailHtml so the 3 real, distinct RH/DP
  // export/print states (idle/loading/error) never drift between the
  // list and detail views (Gate 25/26: same actions, same elegibilidade,
  // wherever the row is rendered). Elegibilidade mirrors "Exportar
  // XLSX" exactly (available for FECHADO and REABERTO alike -- Gate 37:
  // master_commission_snapshot_export has no status guard at all, only
  // existence + structural-consistency, confirmed by direct read of its
  // real SQL body, PM-5G/PM-6B; V1's own apparent FECHADO-only gate is
  // an artifact of its single-período-selector UI, not a real backend
  // rule -- Histórico V2's own row-per-version architecture already
  // exposes REABERTO rows directly, unlike V1).
  function hcRhdpErrorMessage(err) {
    if (!err) return '';
    return (err.state === 'RPC_ERROR' && err.message) ? esc(err.message) : (err.message ? esc(err.message) : 'Não foi possível concluir a operação agora.');
  }
  function hcRhdpPrintActionsHtml(c) {
    var exportingThis = historyState.rhdpExportingId === c.id;
    var printingThis = historyState.printOpeningId === c.id;
    var rhdpErr = historyState.rhdpErrorByClosingId[c.id];
    var printErr = historyState.printErrorByClosingId[c.id];
    var html = '<button type="button" class="modBtnGhost hcRhdpBtn" data-id="' + esc(c.id) + '"' + (exportingThis ? ' disabled' : '') + '>' + (exportingThis ? 'Gerando RH/DP...' : 'Exportar RH/DP') + '</button>' +
      '<button type="button" class="modBtnGhost hcPrintBtn" data-id="' + esc(c.id) + '"' + (printingThis ? ' disabled' : '') + '>' + (printingThis ? 'Abrindo...' : 'PDF / Imprimir') + '</button>';
    if (rhdpErr) html += '<div class="modErrorState hcInlineError"><div class="modStateTitle">Exportação RH/DP não concluída</div>' + hcRhdpErrorMessage(rhdpErr) + '</div>';
    if (printErr) html += '<div class="modErrorState hcInlineError"><div class="modStateTitle">Impressão não concluída</div>' + hcRhdpErrorMessage(printErr) + '</div>';
    return html;
  }
  function hcRowHtml(c) {
    var obs = HC_VM.parseObservacao(c.observacao);
    var resumo = obs && typeof obs.comissao_total === 'number'
      ? esc(HC_VM.fmtMoney(obs.comissao_total)) + ' (resumo oficial)'
      : '<span class="maSubtle">Resumo indisponível</span>';
    return '<tr class="hcRow" data-id="' + esc(c.id) + '">' +
      '<td><b>' + esc(c.nome_periodo || '-') + '</b><br><span class="maSubtle">' + esc(HC_VM.fmtDateBR(c.data_inicio)) + ' → ' + esc(HC_VM.fmtDateBR(c.data_fim)) + '</span></td>' +
      '<td>v' + esc(c.versao != null ? c.versao : '-') + '</td>' +
      '<td>' + hcStatusBadgeHtml(c.status) + '</td>' +
      '<td>' + esc(HC_VM.fmtDateTimeBR(c.fechado_em)) + '<br><span class="maSubtle">' + esc(c.fechado_por || '-') + '</span>' +
      (c.reaberto_em ? '<br><span class="maSubtle">Reaberto ' + esc(HC_VM.fmtDateTimeBR(c.reaberto_em)) + ' por ' + esc(c.reaberto_por || '-') + '</span>' : '') + '</td>' +
      '<td>' + resumo + '</td>' +
      '<td class="adminActions"><div class="hcActions">' +
      '<button type="button" class="modBtnGhost hcViewBtn" data-id="' + esc(c.id) + '">Ver snapshot</button>' +
      '<button type="button" class="modBtnGhost hcExportBtn" data-id="' + esc(c.id) + '"' + (historyState.exportingId === c.id ? ' disabled' : '') + '>' + (historyState.exportingId === c.id ? 'Exportando...' : 'Exportar XLSX') + '</button>' +
      hcRhdpPrintActionsHtml(c) +
      (hcClosingCanReopen(c) ? '<button type="button" class="modBtnGhost hcReopenBtn" data-id="' + esc(c.id) + '">Reabrir</button>' : '') +
      '</div></td></tr>';
  }

  function hcColgroupHtml() {
    return '<colgroup>' +
      '<col>' +
      '<col class="hcColVersao">' +
      '<col class="hcColStatus">' +
      '<col class="hcColData">' +
      '<col class="hcColResumo">' +
      '<col class="hcColAcoes">' +
      '</colgroup>';
  }
  function hcDesktopTableHtml() {
    return '<div class="hcDesktopOnly"><div class="modTableWrap"><table class="modTable hcTable">' +
      hcColgroupHtml() +
      '<thead><tr><th scope="col">Competência</th><th scope="col">Versão</th><th scope="col">Status</th><th scope="col">Fechado em / por</th><th scope="col">Resumo</th><th scope="col">Ações</th></tr></thead>' +
      '<tbody>' + historyState.closings.map(hcRowHtml).join('') + '</tbody></table></div></div>';
  }
  function hcMobileCardHtml(c) {
    var obs = HC_VM.parseObservacao(c.observacao);
    var resumo = obs && typeof obs.comissao_total === 'number' ? HC_VM.fmtMoney(obs.comissao_total) + ' (resumo oficial)' : 'Resumo indisponível';
    return '<div class="maMobileCard hcMobileCard" data-id="' + esc(c.id) + '">' +
      '<div class="maMobileName">' + esc(c.nome_periodo || '-') + ' — v' + esc(c.versao != null ? c.versao : '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(HC_VM.fmtDateBR(c.data_inicio)) + ' → ' + esc(HC_VM.fmtDateBR(c.data_fim)) + '</div>' +
      hcStatusBadgeHtml(c.status) +
      '<div class="maMobileMeta">Fechado: ' + esc(HC_VM.fmtDateTimeBR(c.fechado_em)) + ' por ' + esc(c.fechado_por || '-') + '</div>' +
      (c.reaberto_em ? '<div class="maMobileMeta">Reaberto: ' + esc(HC_VM.fmtDateTimeBR(c.reaberto_em)) + ' por ' + esc(c.reaberto_por || '-') + '</div>' : '') +
      '<div class="maMobileMeta">' + esc(resumo) + '</div>' +
      '<div class="hcActions">' +
      '<button type="button" class="modBtnGhost hcViewBtn" data-id="' + esc(c.id) + '">Ver snapshot</button>' +
      '<button type="button" class="modBtnGhost hcExportBtn" data-id="' + esc(c.id) + '"' + (historyState.exportingId === c.id ? ' disabled' : '') + '>' + (historyState.exportingId === c.id ? 'Exportando...' : 'Exportar XLSX') + '</button>' +
      hcRhdpPrintActionsHtml(c) +
      (hcClosingCanReopen(c) ? '<button type="button" class="modBtnGhost hcReopenBtn" data-id="' + esc(c.id) + '">Reabrir</button>' : '') +
      '</div></div>';
  }
  function hcMobileCardsHtml() {
    return '<div class="hcMobileOnly">' + historyState.closings.map(hcMobileCardHtml).join('') + '</div>';
  }

  // Fail-closed viewer warning (Gate 12/13/26/34) -- deliberately more
  // proactive than V1 itself (which only ever surfaced this at export
  // time): applies the exact real structural criterion server-side
  // export already enforces (isStructurallyInconsistent, ported
  // verbatim) plus the exact real divergence check the already-
  // ground-truth-audited AI tool uses (checkSnapshotIntegrity, also
  // ported verbatim) -- never invents a third heuristic.
  function hcIntegrityBannerHtml(rows, closing) {
    var obs = HC_VM.parseObservacao(closing.observacao);
    var structural = HC_VM.isStructurallyInconsistent(rows);
    var integrity = HC_VM.checkSnapshotIntegrity(rows, obs);
    if (!structural && integrity.status !== 'DIVERGENTE') return '';
    var detail = structural
      ? 'Todas as linhas deste snapshot estão sem valor de comissão (estrutura presente, dados financeiros ausentes).'
      : ('A soma das linhas (' + esc(HC_VM.fmtMoney(integrity.rowSumTotal)) + ') diverge do total oficial registrado no fechamento (' + esc(HC_VM.fmtMoney(integrity.officialTotal)) + ').');
    return '<div class="note gbWarn hcIntegrityWarn" role="alert"><b>⚠ Snapshot histórico com inconsistência conhecida.</b>' +
      '<p class="maSubtle">' + detail + ' Este registro histórico existe e é exibido exatamente como foi gravado — nenhum valor foi recalculado, estimado ou substituído por dado atual. A exportação oficial desta competência é bloqueada pelo servidor até que a inconsistência seja tratada pela Administração/RH F&I.</p></div>';
  }

  function hcSnapshotRowHtml(r) {
    var t = HC_VM.commissionTotals(r);
    return '<tr><td><b>' + esc(r.nome || '-') + '</b></td>' +
      '<td>' + esc(r.loja || '-') + '</td>' +
      '<td>' + esc(r.departamento || '-') + '</td>' +
      '<td>' + esc(String(r.vendidas != null ? r.vendidas : 0)) + '</td>' +
      '<td>' + esc(String(r.financiadas != null ? r.financiadas : 0)) + '</td>' +
      '<td>' + esc(HC_VM.fmtMoney(r.producao)) + '</td>' +
      '<td>' + esc(HC_VM.fmtMoney(r.retorno)) + '</td>' +
      '<td>' + esc(HC_VM.fmtMoney(t.total)) + '</td></tr>';
  }
  function hcSnapshotColgroupHtml() {
    return '<colgroup><col class="hcColNome"><col class="hcColLoja"><col class="hcColDept">' +
      '<col class="hcColNum"><col class="hcColNum"><col class="hcColMoney"><col class="hcColMoney"><col class="hcColMoney"></colgroup>';
  }
  function hcSnapshotTableHtml(rows) {
    return '<div class="hcDesktopOnly"><div class="modTableWrap"><table class="modTable hcSnapshotTable">' +
      hcSnapshotColgroupHtml() +
      '<thead><tr><th scope="col">Nome</th><th scope="col">Loja</th><th scope="col">Depto.</th><th scope="col">Vend.</th><th scope="col">Fin.</th><th scope="col">Produção</th><th scope="col">Retorno</th><th scope="col">Comissão</th></tr></thead>' +
      '<tbody>' + rows.map(hcSnapshotRowHtml).join('') + '</tbody></table></div></div>';
  }
  function hcSnapshotCardHtml(r) {
    var t = HC_VM.commissionTotals(r);
    return '<div class="maMobileCard hcSnapshotCard">' +
      '<div class="maMobileName">' + esc(r.nome || '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(r.perfil || '-') + ' · ' + esc(r.loja || '-') + ' · ' + esc(r.departamento || '-') + '</div>' +
      '<div class="maMobileMeta">Vendidas: ' + esc(String(r.vendidas != null ? r.vendidas : 0)) + ' · Financiadas: ' + esc(String(r.financiadas != null ? r.financiadas : 0)) + '</div>' +
      '<div class="maMobileMeta">Produção: ' + esc(HC_VM.fmtMoney(r.producao)) + ' · Retorno: ' + esc(HC_VM.fmtMoney(r.retorno)) + '</div>' +
      '<div class="maMobileMeta"><b>Comissão total: ' + esc(HC_VM.fmtMoney(t.total)) + '</b></div></div>';
  }
  function hcSnapshotCardsHtml(rows) {
    return '<div class="hcMobileOnly">' + rows.map(hcSnapshotCardHtml).join('') + '</div>';
  }

  function hcDetailHtml() {
    var d = historyState.detail;
    var c = d.closing;
    var html = '<div class="hcDetailHead"><button type="button" class="modBtnGhost" id="hcBackBtn">← Voltar ao histórico</button>' +
      '<h3>' + esc(c.nome_periodo || '-') + ' — v' + esc(c.versao != null ? c.versao : '-') + ' ' + hcStatusBadgeHtml(c.status) + '</h3></div>' +
      '<p class="note">Snapshot histórico — valores registrados no momento deste fechamento (' + esc(HC_VM.fmtDateTimeBR(c.fechado_em)) + '). Estes números NÃO são recalculados e não refletem dados operacionais atuais.</p>';
    if (historyState.exportError && historyState.exportError.closingId === c.id) {
      var expErr = historyState.exportError.err;
      // master_commission_snapshot_export's own real rejection messages
      // (22023 snapshot inconsistente / P0002 fechamento não encontrado)
      // are already hand-authored, safe, user-facing text (confirmed by
      // reading the real SQL: RAISE EXCEPTION with a plain-language
      // string, never a raw SQLSTATE/table/column name) -- shown
      // verbatim here, unlike a generic RPC_ERROR elsewhere in this app.
      // Transport-level failures (session/network/auth) still go
      // through the standard generic mapping.
      html += (expErr.state === 'RPC_ERROR' && expErr.message)
        ? '<div class="modErrorState"><div class="modStateTitle">Exportação bloqueada</div>' + esc(expErr.message) + '</div>'
        : errorStateHtml(expErr.state, expErr.message);
    }
    if (d.error) {
      return html + errorStateHtml(d.error.state, d.error.message) +
        '<button type="button" class="modBtnGhost" id="hcRetryDetailBtn" data-id="' + esc(c.id) + '">Tentar novamente</button>';
    }
    if (d.loading) {
      return html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando snapshot...</div>';
    }
    html += hcIntegrityBannerHtml(d.rows, c);
    html += '<div class="adminActions">';
    html += '<button type="button" class="modBtnGhost hcExportBtn" data-id="' + esc(c.id) + '"' + (historyState.exportingId === c.id ? ' disabled' : '') + '>' + (historyState.exportingId === c.id ? 'Exportando...' : 'Exportar XLSX') + '</button>';
    html += hcRhdpPrintActionsHtml(c);
    // Only offered when the closing itself is FECHADO+ativo (Gate 30:
    // "frontend espelha contrato" -- the real server guard inside
    // master_reopen_commission_period, live-read PM-5K-RETRY, is the
    // actual authority; this is only a mirror to avoid offering an
    // action that would certainly be rejected).
    if (hcClosingCanReopen(c)) {
      html += '<button type="button" class="modBtnGhost hcReopenBtn" data-id="' + esc(c.id) + '">Reabrir</button>';
    }
    html += '</div>';
    html += d.rows.length
      ? (hcSnapshotTableHtml(d.rows) + hcSnapshotCardsHtml(d.rows))
      : '<p class="note">Este fechamento não possui linhas de snapshot.</p>';
    return html;
  }

  function renderHistoricoCompetenciasSection() {
    var html = '<h2>Histórico de Competências</h2>' +
      '<p class="note">Consulta dos fechamentos de competência já registrados. A única ação disponível nesta tela é Reabrir um fechamento ativo -- corrigir, recalcular ou excluir um fechamento continuam indisponíveis.</p>';
    if (historyState.detail) return html + hcDetailHtml();
    if (historyState.error) {
      return html + errorStateHtml(historyState.error.state, historyState.error.message) +
        '<button type="button" id="hcRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    }
    if (historyState.loading || !historyState.loaded) {
      return html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando histórico...</div>';
    }
    return html + (historyState.closings.length
      ? (hcDesktopTableHtml() + hcMobileCardsHtml())
      : '<p class="note">Nenhum fechamento de competência registrado ainda.</p>');
  }

  // ---------- Fechamento de Competência (Painel Master Phase PM-5J) ----------
  // The only WRITE action anywhere in this whole file that can create a
  // real, immutable financial snapshot. Every safeguard below exists
  // because reabertura is NOT implemented in V2 (Gate 25) -- see the
  // module doc comment at closingState's own declaration.
  var CL_PROVIDER = window.NX_MASTER_COMPETENCE_CLOSING_PROVIDER;
  var CL_ENGINE = window.NX_MASTER_COMPETENCE_CLOSING_ENGINE;
  var CL_VM = window.NX_MASTER_COMPETENCE_CLOSING_VM;

  function closingEnter() {
    if (closingState.periods || closingState.periodsLoading) { renderPanel(); return; }
    closingLoadPeriods();
  }
  function closingLoadPeriods() {
    closingState.periodsLoading = true;
    closingState.periodsError = null;
    renderPanel();
    window.NX_MASTER_PERIODOS_PROVIDER.listPeriods({}).then(
      function (periods) {
        closingState.periods = periods;
        closingState.periodsLoading = false;
        renderPanel();
      },
      function (err) {
        closingState.periodsLoading = false;
        closingState.periodsError = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }
  function closingSelectedPeriod() {
    return (closingState.periods || []).filter(function (p) { return String(p.id) === String(closingState.selectedPeriodId); })[0] || null;
  }
  function closingSelectPeriod(id) {
    closingState.selectedPeriodId = id;
    closingState.preview = null;
    closingState.previewToken = null;
    closingState.previewError = null;
    closingState.gestorBlocked = false;
    closingState.existingClosingChecked = false;
    closingState.existingClosing = null;
    closingState.existingClosingError = null;
    closingState.successResult = null;
    closingState.closeError = null;
    if (id) closingCheckExistingClosing(id);
    renderPanel();
  }
  // Read-only existing-closing check (Gate 27) -- reuses Histórico's own
  // real read RPC (master_commission_closings via its provider), never
  // a second definition of the same call. The BACKEND's own real 23505
  // check inside master_close_commission_period remains the final
  // authority regardless of what this UI-only convenience finds.
  function closingCheckExistingClosing(periodId) {
    window.NX_MASTER_COMPETENCE_HISTORY_PROVIDER.listClosings({}).then(
      function (rows) {
        if (String(closingState.selectedPeriodId) !== String(periodId)) return;
        var active = (rows || []).filter(function (c) {
          return String(c.periodo_id) === String(periodId) && c.ativo !== false && String(c.status || '').toUpperCase() === 'FECHADO';
        })[0] || null;
        closingState.existingClosing = active;
        closingState.existingClosingChecked = true;
        renderPanel();
      },
      function (err) {
        closingState.existingClosingChecked = true;
        closingState.existingClosingError = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  // PREVIEW IS NOT A WRITE (Gate 22): every call below is a read;
  // buildPreviewLines (the closing engine) is a pure in-memory
  // computation. Enforced structurally + by test allowlist, never just
  // by convention.
  function closingGeneratePreview() {
    var periodo = closingSelectedPeriod();
    if (!periodo || closingState.existingClosing) return;
    closingState.previewLoading = true;
    closingState.previewError = null;
    closingState.preview = null;
    closingState.previewToken = null;
    closingState.gestorBlocked = false;
    renderPanel();
    Promise.all([
      CL_PROVIDER.loadCommissionMetrics(periodo.data_inicio, periodo.data_fim, {}),
      CL_PROVIDER.loadAnalystCommissionMetrics(periodo.data_inicio, periodo.data_fim, {}),
      CL_PROVIDER.loadManagerDirectory(periodo.data_inicio, periodo.data_fim, {}),
      CL_PROVIDER.loadGestorIdentity({})
    ]).then(
      function (results) {
        if (String(closingState.selectedPeriodId) !== String(periodo.id)) return;
        var vendData = results[0], analystRows = results[1], managerRows = results[2], gestorIdentity = results[3];
        var cfg = CL_VM.DEFAULT_PORTAL_CONFIG;
        var preview = CL_ENGINE.buildPreviewLines({
          vendRows: vendData.rows, analystRows: analystRows, managerRows: managerRows,
          gestorTotals: vendData.totals, gestorIdentity: gestorIdentity, cfg: cfg
        });
        closingState.previewLoading = false;
        if (!preview) {
          // Real, deliberate fail-closed gate (Gate 20/47): missing/
          // inactive Gestor F&I identity blocks the WHOLE preview, never
          // just its own row, and NEVER falls back to a generic label.
          closingState.gestorBlocked = !gestorIdentity;
          closingState.previewError = {
            state: 'RPC_ERROR',
            message: gestorIdentity
              ? 'Dados operacionais desta competência ainda não estão disponíveis.'
              : 'A identidade autoritativa do Gestor F&I não foi encontrada ou está inativa. O fechamento fica bloqueado até isso ser corrigido no cadastro -- nenhum usuário substituto é escolhido automaticamente.'
          };
          renderPanel();
          return;
        }
        closingState.preview = preview;
        closingState.previewToken = CL_VM.makePreviewToken(periodo.id);
        renderPanel();
      },
      function (err) {
        closingState.previewLoading = false;
        closingState.previewError = err || { state: 'RPC_ERROR' };
        renderPanel();
      }
    );
  }

  function closingOpenConfirm() {
    if (!closingState.preview) return;
    closingState.confirmOpen = true;
    renderClosingModalRoot();
  }
  function closingCancelConfirm() {
    closingState.confirmOpen = false;
    clearNxModal();
  }
  function closingSetSimulate(value) {
    closingState.simulate = value;
    renderPanel();
  }

  function closingConfirmClose() {
    if (closingState.closing) return; // double-submit guard (Gate 32/49)
    var periodo = closingSelectedPeriod();
    if (!periodo || !closingState.preview) return;
    // Stale-preview protection (Gate 31/48): the ONE thing this can
    // prove is "the selected período is still the one the preview was
    // built for" -- it cannot detect a real operational-data change
    // that happened silently on the server since, and never claims to.
    if (CL_VM.isPreviewStale(closingState.previewToken, periodo.id)) {
      closingState.closeError = { state: 'RPC_ERROR', message: 'A prévia não corresponde mais ao período selecionado. Gere uma nova prévia antes de confirmar.' };
      closingState.confirmOpen = false;
      clearNxModal();
      renderPanel();
      return;
    }
    closingState.closing = true;
    closingState.closeError = null;
    renderClosingModalRoot();
    var summary = CL_ENGINE.buildSummaryPayload({
      periodo: periodo,
      executivo: { vendidas: closingState.preview.vendidas, financiadas: closingState.preview.financiadas, producao: closingState.preview.producao, retorno: closingState.preview.retorno, spf: closingState.preview.spf },
      linhasCount: closingState.preview.linhas.length, comissaoPrevista: closingState.preview.comissaoPrevista,
      fechadoPorCpf: '', fechadoPorNome: ''
    });
    var rows = CL_ENGINE.buildSnapshotRowsPayload(closingState.preview, periodo, null);
    var writeCall = closingState.simulate
      ? CL_PROVIDER.closeCommissionPeriodSimulated(periodo.id, summary, rows)
      : CL_PROVIDER.closeCommissionPeriod(periodo.id, summary, rows, {});
    writeCall.then(
      function (result) {
        closingState.closing = false;
        closingState.confirmOpen = false;
        closingState.preview = null;
        closingState.previewToken = null;
        closingState.successResult = result;
        clearNxModal();
        closingState.existingClosingChecked = false;
        closingCheckExistingClosing(periodo.id);
        renderPanel();
      },
      function (err) {
        closingState.closing = false;
        closingState.closeError = err || { state: 'RPC_ERROR' };
        renderClosingModalRoot();
        renderPanel();
      }
    );
  }

  function renderClosingModalRoot() {
    if (!closingState.confirmOpen) { if (currentSection === 'fechamentoCompetencia') clearNxModal(); return; }
    renderNxModal('Confirmar fechamento de competência', closingConfirmBodyHtml(), closingCancelConfirm);
    wireClosingModalInteraction();
  }
  // Modal content is injected into #nxModalRoot independently of the
  // main panel's own render+wire cycle (renderPanel/wireInteraction) --
  // same reason every sibling modal (e.g. wireScModalInteraction) wires
  // itself right after rendering, rather than relying on the main
  // panel's wiring pass, which never touches #nxModalRoot.
  function wireClosingModalInteraction() {
    var cancelBtn = document.getElementById('clConfirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closingCancelConfirm);
    var doBtn = document.getElementById('clConfirmDoBtn');
    if (doBtn) doBtn.addEventListener('click', closingConfirmClose);
  }
  function closingConfirmBodyHtml() {
    var periodo = closingSelectedPeriod();
    var p = closingState.preview;
    if (!periodo || !p) return '';
    var modoTxt = closingState.simulate
      ? '<p class="note gbWarn"><b>Modo simulação ativo.</b> Nenhum dado real será alterado -- esta confirmação apenas simula o fluxo de fechamento, localmente.</p>'
      : '<p class="note gbWarn"><b>Modo real ativo.</b> Esta ação grava um snapshot real no Supabase e marca esta competência como FECHADO.</p>';
    // Real server rejection messages (42501/P0002/23505/22023/P0001,
    // confirmed by direct reading of master_close_commission_period's
    // own SQL, PM-5G) are already hand-authored, safe, user-facing text
    // -- shown verbatim here, same discipline already established for
    // Histórico's export rejection (PM-5H).
    var errHtml = closingState.closeError
      ? (closingState.closeError.state === 'RPC_ERROR' && closingState.closeError.message
        ? '<div class="modErrorState"><div class="modStateTitle">Fechamento não concluído</div>' + esc(closingState.closeError.message) + '</div>'
        : errorStateHtml(closingState.closeError.state, closingState.closeError.message))
      : '';
    return '<div class="gbRow"><span>Competência</span><b>' + esc(periodo.nome_periodo || '-') + '</b></div>' +
      '<div class="gbRow"><span>Período</span><b>' + esc(CL_VM.fmtDateBR(periodo.data_inicio)) + ' → ' + esc(CL_VM.fmtDateBR(periodo.data_fim)) + '</b></div>' +
      '<div class="gbRow"><span>Linhas do snapshot</span><b>' + p.linhas.length + '</b></div>' +
      '<div class="gbRow"><span>Comissão total prevista</span><b>' + esc(CL_VM.fmtMoney(p.comissaoPrevista)) + '</b></div>' +
      modoTxt +
      '<p class="note">Após confirmar, um snapshot histórico será criado e esta competência será marcada como FECHADO. Uma competência fechada pode ser reaberta depois, na tela Histórico de Competências.</p>' +
      errHtml +
      '<div class="adminModalActions">' +
      '<button type="button" class="modBtnGhost" id="clConfirmCancelBtn">Cancelar</button>' +
      '<button type="button" class="modBtn" id="clConfirmDoBtn"' + (closingState.closing ? ' disabled' : '') + '>' + (closingState.closing ? 'Processando...' : 'Confirmar Fechamento') + '</button>' +
      '</div>';
  }

  function clColgroupHtml() {
    return '<colgroup><col class="clColNome"><col class="clColPerfil"><col class="clColLoja">' +
      '<col class="clColStatus"><col class="clColNum"><col class="clColNum"><col class="clColMoney"></colgroup>';
  }
  function clRowHtml(l) {
    return '<tr><td><b>' + esc(l.nome || '-') + '</b></td>' +
      '<td>' + esc(l.perfil || '-') + '</td>' +
      '<td>' + esc(l.loja || '-') + '</td>' +
      '<td>' + esc(l.status || '-') + '</td>' +
      '<td>' + esc(String(l.m?.vendidas != null ? l.m.vendidas : 0)) + '</td>' +
      '<td>' + esc(String(l.m?.financiadas != null ? l.m.financiadas : 0)) + '</td>' +
      '<td>' + esc(CL_VM.fmtMoney(l.comissao)) + '</td></tr>';
  }
  function clPreviewTableHtml(linhas) {
    return '<div class="hcDesktopOnly"><div class="modTableWrap"><table class="modTable clPreviewTable">' +
      clColgroupHtml() +
      '<thead><tr><th scope="col">Nome</th><th scope="col">Perfil</th><th scope="col">Loja</th><th scope="col">Status</th><th scope="col">Vend.</th><th scope="col">Fin.</th><th scope="col">Comissão</th></tr></thead>' +
      '<tbody>' + linhas.map(clRowHtml).join('') + '</tbody></table></div></div>';
  }
  function clPreviewCardHtml(l) {
    return '<div class="maMobileCard">' +
      '<div class="maMobileName">' + esc(l.nome || '-') + '</div>' +
      '<div class="maMobileMeta">' + esc(l.perfil || '-') + ' · ' + esc(l.loja || '-') + ' · ' + esc(l.status || '-') + '</div>' +
      '<div class="maMobileMeta">Vendidas: ' + esc(String(l.m?.vendidas != null ? l.m.vendidas : 0)) + ' · Financiadas: ' + esc(String(l.m?.financiadas != null ? l.m.financiadas : 0)) + '</div>' +
      '<div class="maMobileMeta"><b>Comissão: ' + esc(CL_VM.fmtMoney(l.comissao)) + '</b></div></div>';
  }
  function clPreviewCardsHtml(linhas) {
    return '<div class="hcMobileOnly">' + linhas.map(clPreviewCardHtml).join('') + '</div>';
  }

  function closingPreviewHtml() {
    var p = closingState.preview;
    var counts = CL_VM.profileCounts(p.linhas);
    return '<div class="note gbWarn"><b>Prévia — ainda NÃO fechada.</b> Estes valores são calculados agora, ao vivo, a partir dos dados operacionais atuais. Eles NÃO são um snapshot histórico e podem mudar até o momento da confirmação.</div>' +
      '<div class="fechamentoPreviewGrid">' +
      '<div class="pcCard"><div class="pcCardK">Linhas</div><div class="pcCardV">' + p.linhas.length + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Vendedores</div><div class="pcCardV">' + counts.vendedores + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Gerentes</div><div class="pcCardV">' + counts.gerentes + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Analistas</div><div class="pcCardV">' + counts.analistas + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Gestor F&I</div><div class="pcCardV">' + counts.gestor + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Comissão total prevista</div><div class="pcCardV">' + esc(CL_VM.fmtMoney(p.comissaoPrevista)) + '</div></div>' +
      '</div>' +
      clPreviewTableHtml(p.linhas) + clPreviewCardsHtml(p.linhas) +
      '<div class="adminModalActions"><button type="button" class="modBtn" id="clOpenConfirmBtn">Fechar Competência</button></div>';
  }

  function renderFechamentoCompetenciaSection() {
    var html = '<h2>Fechamento de Competência</h2>' +
      '<p class="note">Gere a prévia de uma competência e, se estiver correta, confirme o fechamento oficial. Esta tela não oferece reabertura -- consulte o Histórico de Competências para fechamentos já realizados.</p>';

    if (closingState.periodsError) {
      return html + errorStateHtml(closingState.periodsError.state, closingState.periodsError.message) +
        '<button type="button" id="clRetryPeriodsBtn" class="modBtnGhost">Tentar novamente</button>';
    }
    if (closingState.periodsLoading || !closingState.periods) {
      return html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando períodos...</div>';
    }

    var elegiveis = closingState.periods.filter(function (p) { return p.ativo !== false; });
    html += '<div class="modFilters"><div class="modField"><label for="clPeriodoSel">Competência</label>' +
      '<select id="clPeriodoSel"><option value="">Selecione...</option>' +
      elegiveis.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (closingState.selectedPeriodId === p.id ? ' selected' : '') + '>' +
          esc(p.nome_periodo) + ' · ' + esc(CL_VM.fmtDateBR(p.data_inicio)) + ' a ' + esc(CL_VM.fmtDateBR(p.data_fim)) + ' · ' + esc(p.status || '-') + '</option>';
      }).join('') + '</select></div></div>';

    var periodo = closingSelectedPeriod();
    if (!periodo) return html + '<p class="note">Selecione uma competência para começar.</p>';

    html += '<div class="gbRow"><span>Status atual</span><b>' + esc(periodo.status || '-') + '</b></div>';

    if (closingState.existingClosingError) {
      html += errorStateHtml(closingState.existingClosingError.state, closingState.existingClosingError.message);
    } else if (!closingState.existingClosingChecked) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Verificando fechamentos existentes...</div>';
      return html;
    } else if (closingState.existingClosing) {
      html += '<div class="note gbWarn"><b>Esta competência já possui um fechamento ativo.</b> Consulte o Histórico de Competências. Esta tela não oferece reabertura.</div>';
      return html;
    }

    if (closingState.successResult) {
      html += '<div class="note suBannerOk"><b>' + (closingState.successResult.simulated ? 'Fechamento simulado com sucesso.' : 'Competência fechada com sucesso.') + '</b>' +
        '<p class="maSubtle">' + (closingState.successResult.simulated ? 'Nenhum dado real foi alterado (modo simulação).' : 'Um snapshot real foi gravado.') + ' Consulte o Histórico de Competências para ver o resultado.</p></div>';
    }

    html += '<div class="modField" style="max-width:420px"><label><input type="checkbox" id="clSimulateToggle"' + (closingState.simulate ? ' checked' : '') + '> Modo simulação (recomendado) -- nenhum dado real é alterado</label></div>';
    if (!closingState.simulate) {
      html += '<div class="note gbWarn"><b>Atenção: modo real ativo.</b> Confirmar o fechamento abaixo grava um snapshot real e marca a competência como FECHADO no Supabase.</div>';
    }

    if (closingState.previewError) {
      // These are hand-authored, safe, real safety-gate messages (Gate
      // 20's Gestor F&I fail-closed copy, or a plain "data not ready"
      // notice) -- shown verbatim, same discipline as the confirm
      // modal's own real-error display and Histórico's export
      // rejection (PM-5H).
      html += (closingState.previewError.state === 'RPC_ERROR' && closingState.previewError.message)
        ? '<div class="modErrorState"><div class="modStateTitle">' + (closingState.gestorBlocked ? 'Fechamento bloqueado' : 'Prévia indisponível') + '</div>' + esc(closingState.previewError.message) + '</div>'
        : errorStateHtml(closingState.previewError.state, closingState.previewError.message);
    }
    if (closingState.previewLoading) {
      html += '<div class="modLoadingState"><span class="modLoadingDot"></span>Calculando prévia...</div>';
    } else if (closingState.preview) {
      html += closingPreviewHtml();
    } else {
      html += '<button type="button" class="modBtn" id="clGeneratePreviewBtn">Gerar Prévia</button>';
    }
    return html;
  }

  // ---------- master render ----------
  function renderPanel() {
    var panel = document.getElementById('maPanel');
    if (!panel) return;
    renderSectionNav();

    if (currentSection === 'acessos') {
      var htmlA = renderAcessosSection();
      if (pendingConfirm) {
        htmlA += confirmHtml(pendingConfirm.title, pendingConfirm.body, pendingConfirm.confirmLabel, pendingConfirm.destructive, pendingConfirm.bodyHtml);
      }
      panel.innerHTML = htmlA;
      wireInteraction();
      return;
    }

    if (currentSection === 'auditoria') {
      panel.innerHTML = renderAuditoriaSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'pendenciasCadastrais') {
      // Modal-root sync FIRST (may null pcDetailId if the row fell out
      // of the just-reloaded, currently-filtered server result -- a
      // real possibility here, unlike Usuários, since a status-changing
      // mutation can remove a row from a status-filtered tab entirely).
      // Only after that is settled does the main panel decide whether
      // the success banner belongs here or inside the modal (Gate 13
      // discipline, extended to handle a modal that may have just
      // auto-closed).
      //
      // Skipped while pcState.loading: a mutation's own success handler
      // sets successMessage THEN calls pcLoad(), whose own FIRST render
      // (the "Carregando..." tick, before the fresh rows arrive) would
      // otherwise find the modal's row still present with its OLD
      // (stale, pre-mutation) data and consume/display the success
      // message right there -- one render too early, against data that
      // hasn't actually changed yet. Leaving #nxModalRoot's previous
      // content untouched for that one tick means the message is still
      // available to show once the FRESH, post-mutation render actually
      // runs, with no visible flicker in between (the modal simply
      // keeps showing what it already showed).
      if (!pcState.loading) renderPcModalRoot();
      panel.innerHTML = renderPendenciasSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'gestaoBases') {
      renderGbModalRoot();
      panel.innerHTML = renderGestaoBasesSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'gestaoSimuladores') {
      renderGsModalRoot();
      panel.innerHTML = renderGestaoSimuladoresSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'configuracoes') {
      renderCfgModalRoot();
      panel.innerHTML = renderConfiguracoesSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'periodosComissao') {
      renderPrModalRoot();
      panel.innerHTML = renderPeriodosSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'feriasAusencias') {
      renderAbsModalRoot();
      panel.innerHTML = renderFeriasAusenciasSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'mudancaLoja') {
      renderScModalRoot();
      panel.innerHTML = renderMudancaLojaSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'utilizacaoSimuladores') {
      renderSuDrawerRoot();
      panel.innerHTML = renderUtilizacaoSimuladoresSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'historicoCompetencias') {
      renderHcReopenModalRoot();
      panel.innerHTML = renderHistoricoCompetenciasSection();
      wireInteraction();
      return;
    }

    if (currentSection === 'fechamentoCompetencia') {
      renderClosingModalRoot();
      panel.innerHTML = renderFechamentoCompetenciaSection();
      wireInteraction();
      return;
    }

    if (loadError) {
      panel.innerHTML = errorStateHtml(loadError.state, loadError.message);
      return;
    }
    if (isLoading && currentView === 'list') {
      panel.innerHTML = loadingHtml();
      return;
    }

    var html = '';
    // Gate 13 (PM-4B.4): when a user's detail modal is open, the success
    // banner renders INSIDE the modal instead (renderUserModalBody) --
    // rendering it here too would mean it flashes and self-clears
    // behind the modal backdrop, never actually seen (this exact render
    // still reaches the modal refresh below, in the same tick).
    if (successMessage && !currentDetailId) {
      // Shown for exactly one completed render, then self-clears --
      // simpler and more robust than hunting down every interaction
      // site that should dismiss it; the LOADING branch above returns
      // early without reaching here, so this only fires on the render
      // that actually follows a completed mutation.
      html += '<div class="modSuccessState" role="status">' + esc(successMessage) + '</div>';
      successMessage = null;
    }
    if (currentView === 'create') {
      html += renderCreateView();
    } else {
      html += renderList();
    }
    // Gate 6/25 (PM-4B.4): the below-list detail/confirm/link-panel
    // surface is retired -- a detail-related confirm (edit/toggleActive/
    // resend/generateAccessLink) now renders inside the user modal
    // itself (renderUserModalBody); only Acessos/Invite confirms still
    // belong in this main panel.
    if (pendingConfirm && !isDetailConfirmKind(pendingConfirm.kind)) {
      html += confirmHtml(pendingConfirm.title, pendingConfirm.body, pendingConfirm.confirmLabel, pendingConfirm.destructive, pendingConfirm.bodyHtml, pendingConfirm.error);
    }
    panel.innerHTML = html;
    wireInteraction();
    renderUserModalRoot();
  }

  // ---------- interaction wiring ----------
  // Painel Master Phase 3B fix: the section nav reflects `currentSection`
  // (which item is the inert "active" span vs. a clickable link) and
  // must be regenerated every render, not just once at mount -- an
  // earlier version baked sectionNavHtml() into the outlet a single
  // time in render(), so switching to Acessos left "Usuários" a
  // permanently inert span with no data-section attr and no listener
  // (caught by this Phase's own Gate 28 dirty-exit-guard test: a second
  // section switch became impossible). Re-rendering the wrapper's
  // innerHTML each time also means listeners never stack (old nodes are
  // discarded whole), unlike the previous document-wide querySelectorAll
  // approach this replaces.
  function renderSectionNav() {
    var wrap = document.getElementById('maSectionNavWrap');
    if (!wrap) return;
    wrap.innerHTML = sectionNavHtml();
    wrap.querySelectorAll('.maSectionItemLink[data-section]').forEach(function (el) {
      el.addEventListener('click', function () { requestSectionSwitch(el.getAttribute('data-section')); });
    });
  }

  function wireInteraction() {
    document.querySelectorAll('.mamCell').forEach(function (el) {
      el.addEventListener('change', function () {
        var vm = window.NX_MASTER_ACESSOS_VIEW_MODEL;
        var key = vm.cellKey(el.getAttribute('data-module'), el.getAttribute('data-perfil'), el.getAttribute('data-departamento'));
        acessosState.localPermissions[key] = el.checked;
        acessosState.dirty = vm.isDirty(acessosState.localPermissions, acessosState.serverSnapshot);
        renderPanel();
      });
    });
    var mamDiscard = document.getElementById('mamDiscardBtn');
    if (mamDiscard) mamDiscard.addEventListener('click', acessosDiscard);
    var mamSave = document.getElementById('mamSaveBtn');
    if (mamSave) mamSave.addEventListener('click', acessosOpenSaveConfirm);
    var mamRetry = document.getElementById('mamRetryBtn');
    if (mamRetry) mamRetry.addEventListener('click', acessosLoad);

    var maAuditRetry = document.getElementById('maAuditRetryBtn');
    if (maAuditRetry) maAuditRetry.addEventListener('click', auditLoad);
    document.querySelectorAll('.maudRow, .maudMobileCard').forEach(function (el) {
      el.addEventListener('click', function () { openAuditModal(el.getAttribute('data-key'), el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAuditModal(el.getAttribute('data-key'), el); }
      });
    });
    // Gate 6 (PM-4B.1): the explicit button calls the exact same
    // controller as the row/card click -- never a second flow. Stops
    // propagation only so the parent row/card's own click listener
    // doesn't ALSO fire redundantly.
    document.querySelectorAll('.maudDetailBtn').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openAuditModal(el.getAttribute('data-key'), el);
      });
    });

    document.querySelectorAll('.maTable tbody tr, .maMobileCard').forEach(function (el) {
      el.addEventListener('click', function () { openUserModal(el.getAttribute('data-key'), el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUserModal(el.getAttribute('data-key'), el); }
      });
    });

    // ---- Pendências Cadastrais (Painel Master Phase PM-4C.2) ----
    document.querySelectorAll('.pcAbaBtn').forEach(function (el) {
      el.addEventListener('click', function () { pcSetAba(el.getAttribute('data-aba')); });
    });
    var pcRetry = document.getElementById('pcRetryBtn');
    if (pcRetry) pcRetry.addEventListener('click', pcLoad);
    document.querySelectorAll('.pcTabBtn').forEach(function (el) {
      el.addEventListener('click', function () { pcState.tab = el.getAttribute('data-tab'); pcLoad(); });
    });
    var pcFilterTipo = document.getElementById('pcFilterTipo');
    if (pcFilterTipo) pcFilterTipo.addEventListener('change', function (e) { pcState.filtros.tipo = e.target.value; pcLoad(); });
    var pcFilterOrigem = document.getElementById('pcFilterOrigem');
    if (pcFilterOrigem) pcFilterOrigem.addEventListener('change', function (e) { pcState.filtros.origem = e.target.value; pcLoad(); });
    var pcSearch = document.getElementById('pcSearch');
    if (pcSearch) pcSearch.addEventListener('input', function (e) { pcSetBusca(e.target.value); });
    wirePcResultsInteraction();

    // ---- Pendências: Exceções aba ----
    var pcExcRetry = document.getElementById('pcExcRetryBtn');
    if (pcExcRetry) pcExcRetry.addEventListener('click', pcExcecoesLoad);
    var pcExcFilterTipo = document.getElementById('pcExcFilterTipo');
    if (pcExcFilterTipo) pcExcFilterTipo.addEventListener('change', function (e) { pcState.excecoes.filtroTipo = e.target.value; pcState.excecoes.loaded = false; pcExcecoesLoad(); });
    var pcExcFilterAtivo = document.getElementById('pcExcFilterAtivo');
    if (pcExcFilterAtivo) pcExcFilterAtivo.addEventListener('change', function (e) { pcState.excecoes.filtroAtivo = (e.target.value === 'true'); pcState.excecoes.loaded = false; pcExcecoesLoad(); });
    document.querySelectorAll('.pcRevogarBtn').forEach(function (el) {
      el.addEventListener('click', function () { pcOpenRevogarExcecaoConfirm(el.getAttribute('data-key')); });
    });
    var pcExcSalvar = document.getElementById('pcExcSalvarBtn');
    if (pcExcSalvar) pcExcSalvar.addEventListener('click', pcSalvarExcecaoManual);

    // ---- Gestão de Bases (Painel Master Phase PM-5C) ----
    var gbFileInput = document.getElementById('gbFileInput');
    if (gbFileInput) gbFileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = ''; // allow re-selecting the exact same file next time
      if (file) gbOnFileChosen(file);
    });
    var gbRetry = document.getElementById('gbRetryBtn');
    if (gbRetry) gbRetry.addEventListener('click', gbLoad);
    document.querySelectorAll('.gbUpdateBtn').forEach(function (el) {
      el.addEventListener('click', function () { window.gbOnAtualizarClick(el.getAttribute('data-source-type')); });
    });

    // ---- Gestão dos Simuladores (Painel Master Phase PM-5D) ----
    var gsFileInput = document.getElementById('gsFileInput');
    if (gsFileInput) gsFileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) gsOnFileChosen(file);
    });
    var gsRetry = document.getElementById('gsRetryBtn');
    if (gsRetry) gsRetry.addEventListener('click', gsLoad);
    document.querySelectorAll('.gsUpdateBtn').forEach(function (el) {
      el.addEventListener('click', function () { window.gsOnAtualizarClick(el.getAttribute('data-uid')); });
    });

    // ---- Configurações (Painel Master Phase PM-5E) ----
    var cfgRetry = document.getElementById('cfgRetryBtn');
    if (cfgRetry) cfgRetry.addEventListener('click', cfgLoad);
    document.querySelectorAll('.cfgEditBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-key');
        var setting = cfgState.settings.filter(function (s) { return s.key === key; })[0];
        if (!setting) return;
        cfgState.editingKey = key;
        cfgState.editDraft = setting.value;
        renderPanel();
      });
    });
    document.querySelectorAll('.cfgCancelEditBtn').forEach(function (el) {
      el.addEventListener('click', function () { cfgState.editingKey = null; renderPanel(); });
    });
    document.querySelectorAll('.cfgSaveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-key');
        var setting = cfgState.settings.filter(function (s) { return s.key === key; })[0];
        if (!setting) return;
        var input = document.getElementById('cfgEditInput');
        var raw = input ? input.value : '';
        var errMsg = CFG_VM.validateHint(setting, raw);
        if (errMsg) {
          var errEl = document.getElementById('cfgEditError');
          if (errEl) errEl.textContent = errMsg;
          return;
        }
        var newValue = CFG_VM.parseNumber(raw);
        cfgState.modal = { kind: 'confirm', setting: setting, newValue: newValue };
        renderCfgModalRoot();
      });
    });

    // ---- Períodos de Comissão (Painel Master Phase PM-5E) ----
    var prRetry = document.getElementById('prRetryBtn');
    if (prRetry) prRetry.addEventListener('click', prLoad);
    var prNewBtn = document.getElementById('prNewBtn');
    if (prNewBtn) prNewBtn.addEventListener('click', function () {
      prState.createForm = { name: '', start: '', end: '', isCurrent: false, error: null };
      renderPanel();
    });
    var prCancelCreateBtn = document.getElementById('prCancelCreateBtn');
    if (prCancelCreateBtn) prCancelCreateBtn.addEventListener('click', function () { prState.createForm = null; renderPanel(); });
    var prSaveCreateBtn = document.getElementById('prSaveCreateBtn');
    if (prSaveCreateBtn) prSaveCreateBtn.addEventListener('click', prSaveCreateHandler);
    document.querySelectorAll('.prSetCurrentBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.disabled) return;
        prRunAction(PR_PROVIDER.setCurrent(el.getAttribute('data-id')), 'Período atual atualizado com sucesso.');
      });
    });
    document.querySelectorAll('.prToggleActiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var wasActive = el.getAttribute('data-active') === 'true';
        prRunAction(PR_PROVIDER.setActive(el.getAttribute('data-id'), !wasActive),
          wasActive ? 'Período inativado com sucesso.' : 'Período ativado com sucesso.');
      });
    });
    document.querySelectorAll('.prArchiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var period = prPeriodById(el.getAttribute('data-id'));
        if (!period) return;
        prState.modal = { kind: 'confirm', period: period };
        renderPrModalRoot();
      });
    });

    // ---- Férias/Ausências (Painel Master Phase PM-5F) ----
    var absRetry = document.getElementById('absRetryBtn');
    if (absRetry) absRetry.addEventListener('click', absLoad);
    var absNewBtn = document.getElementById('absNewBtn');
    if (absNewBtn) absNewBtn.addEventListener('click', function () {
      absState.createForm = { cpfAnalistaAusente: '', nomeAnalistaAusente: '', lojaOrigem: '', cpfAnalistaSubstituto: '', nomeAnalistaSubstituto: '', lojaCoberta: '', dataInicio: '', dataFim: '', motivo: '', error: null, overlapWarning: null };
      renderPanel();
    });
    var absCancelCreateBtn = document.getElementById('absCancelCreateBtn');
    if (absCancelCreateBtn) absCancelCreateBtn.addEventListener('click', function () { absState.createForm = null; renderPanel(); });
    var absSaveCreateBtn = document.getElementById('absSaveCreateBtn');
    if (absSaveCreateBtn) absSaveCreateBtn.addEventListener('click', absSaveCreateHandler);
    document.querySelectorAll('.absToggleActiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var wasActive = el.getAttribute('data-active') === 'true';
        absRunAction(ABS_PROVIDER.setActive(el.getAttribute('data-id'), !wasActive),
          wasActive ? 'Ausência inativada com sucesso.' : 'Ausência ativada com sucesso.');
      });
    });
    document.querySelectorAll('.absArchiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var absence = absAbsenceById(el.getAttribute('data-id'));
        if (!absence) return;
        absState.modal = { kind: 'confirm', absence: absence };
        renderAbsModalRoot();
      });
    });

    // ---- Mudança de Loja - Vendedores (Painel Master Phase PM-5F) ----
    var scRetry = document.getElementById('scRetryBtn');
    if (scRetry) scRetry.addEventListener('click', scLoad);
    var scNewBtn = document.getElementById('scNewBtn');
    if (scNewBtn) scNewBtn.addEventListener('click', function () {
      scState.createForm = { cpfVendedor: '', loginVendedor: '', nomeVendedor: '', lojaOrigem: '', lojaDestino: '', dataInicioOrigem: '', dataFimOrigem: '', dataInicioDestino: '', observacao: '', departamentoOrigem: '', departamentoDestino: '', error: null };
      renderPanel();
    });
    var scCancelCreateBtn = document.getElementById('scCancelCreateBtn');
    if (scCancelCreateBtn) scCancelCreateBtn.addEventListener('click', function () { scState.createForm = null; renderPanel(); });
    var scSaveCreateBtn = document.getElementById('scSaveCreateBtn');
    if (scSaveCreateBtn) scSaveCreateBtn.addEventListener('click', scSaveCreateHandler);
    document.querySelectorAll('.scToggleActiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var wasActive = el.getAttribute('data-active') === 'true';
        scRunAction(SC_PROVIDER.setActive(el.getAttribute('data-id'), !wasActive),
          wasActive ? 'Registro inativado com sucesso.' : 'Registro ativado com sucesso.');
      });
    });
    document.querySelectorAll('.scArchiveBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var record = scRecordById(el.getAttribute('data-id'));
        if (!record) return;
        scState.modal = { kind: 'confirm', record: record };
        renderScModalRoot();
      });
    });
    document.querySelectorAll('.scEditDeptBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        var record = scRecordById(el.getAttribute('data-id'));
        if (!record) return;
        scState.modal = { kind: 'editDepartments', record: record };
        renderScModalRoot();
      });
    });

    // ---- Utilização dos Simuladores (Painel Master Phase PM-5H, read-only) ----
    var suRetry = document.getElementById('suRetryBtn');
    if (suRetry) suRetry.addEventListener('click', suLoad);
    document.querySelectorAll('.suPresetBtn').forEach(function (el) {
      el.addEventListener('click', function () { suSetPreset(el.getAttribute('data-preset')); });
    });
    var suExport = document.getElementById('suExportBtn');
    if (suExport) suExport.addEventListener('click', suExportarXlsx);
    var suDtIni = document.getElementById('suDtIni');
    if (suDtIni) suDtIni.addEventListener('change', function (e) { suSetData('dtIni', e.target.value); });
    var suDtFim = document.getElementById('suDtFim');
    if (suDtFim) suDtFim.addEventListener('change', function (e) { suSetData('dtFim', e.target.value); });
    var suLojaSel = document.getElementById('suLoja');
    if (suLojaSel) suLojaSel.addEventListener('change', function (e) { suSetFiltroSelect('loja', e.target.value); });
    var suDepSel = document.getElementById('suDep');
    if (suDepSel) suDepSel.addEventListener('change', function (e) { suSetFiltroSelect('departamento', e.target.value); });
    var suModuloSel = document.getElementById('suModulo');
    if (suModuloSel) suModuloSel.addEventListener('change', function (e) { suSetFiltroSelect('modulo', e.target.value); });
    var suPerfilSel = document.getElementById('suPerfil');
    if (suPerfilSel) suPerfilSel.addEventListener('change', function (e) { suSetFiltroSelect('perfil', e.target.value); });
    var suBuscaEl = document.getElementById('suBusca');
    if (suBuscaEl) suBuscaEl.addEventListener('input', function (e) { suSetBusca(e.target.value); });
    var suOrdenacaoSel = document.getElementById('suOrdenacao');
    if (suOrdenacaoSel) suOrdenacaoSel.addEventListener('change', function (e) { suSetOrdenacao(e.target.value); });
    var suToggleNunca = document.getElementById('suToggleNuncaBtn');
    if (suToggleNunca) suToggleNunca.addEventListener('click', suToggleNuncaUtilizou);
    document.querySelectorAll('.suDetailBtn').forEach(function (el) {
      el.addEventListener('click', function () {
        suState.drawerUserId = el.getAttribute('data-id');
        renderSuDrawerRoot();
      });
    });

    // ---- Histórico de Competências (Painel Master Phase PM-5H, read-only) ----
    var hcRetry = document.getElementById('hcRetryBtn');
    if (hcRetry) hcRetry.addEventListener('click', historyLoad);
    var hcRetryDetail = document.getElementById('hcRetryDetailBtn');
    if (hcRetryDetail) hcRetryDetail.addEventListener('click', function () { historyOpenDetail(hcRetryDetail.getAttribute('data-id')); });
    var hcBack = document.getElementById('hcBackBtn');
    if (hcBack) hcBack.addEventListener('click', historyCloseDetail);
    document.querySelectorAll('.hcViewBtn').forEach(function (el) {
      el.addEventListener('click', function () { historyOpenDetail(el.getAttribute('data-id')); });
    });
    document.querySelectorAll('.hcExportBtn').forEach(function (el) {
      el.addEventListener('click', function () { historyExportXlsx(el.getAttribute('data-id')); });
    });
    document.querySelectorAll('.hcRhdpBtn').forEach(function (el) {
      el.addEventListener('click', function () { historyExportRhDp(el.getAttribute('data-id')); });
    });
    document.querySelectorAll('.hcPrintBtn').forEach(function (el) {
      el.addEventListener('click', function () { historyPrintRhDp(el.getAttribute('data-id')); });
    });
    document.querySelectorAll('.hcReopenBtn').forEach(function (el) {
      el.addEventListener('click', function () { hcOpenReopenModal(historyClosingById(el.getAttribute('data-id'))); });
    });

    // ---- Fechamento de Competência (Painel Master Phase PM-5J) ----
    var clRetryPeriods = document.getElementById('clRetryPeriodsBtn');
    if (clRetryPeriods) clRetryPeriods.addEventListener('click', closingLoadPeriods);
    var clPeriodoSel = document.getElementById('clPeriodoSel');
    if (clPeriodoSel) clPeriodoSel.addEventListener('change', function (e) { closingSelectPeriod(e.target.value); });
    var clSimulateToggle = document.getElementById('clSimulateToggle');
    if (clSimulateToggle) clSimulateToggle.addEventListener('change', function (e) { closingSetSimulate(e.target.checked); });
    var clGeneratePreview = document.getElementById('clGeneratePreviewBtn');
    if (clGeneratePreview) clGeneratePreview.addEventListener('click', closingGeneratePreview);
    var clOpenConfirm = document.getElementById('clOpenConfirmBtn');
    if (clOpenConfirm) clOpenConfirm.addEventListener('click', closingOpenConfirm);
    var search = document.getElementById('maSearch');
    if (search) search.addEventListener('input', function (e) { searchQuery = e.target.value; renderPanel(); });
    var fp = document.getElementById('maFilterPerfil');
    if (fp) fp.addEventListener('change', function (e) { filterPerfil = e.target.value; renderPanel(); });
    var fl = document.getElementById('maFilterLoja');
    if (fl) fl.addEventListener('change', function (e) { filterLoja = e.target.value; renderPanel(); });
    var fs = document.getElementById('maFilterStatus');
    if (fs) fs.addEventListener('change', function (e) { filterStatus = e.target.value; renderPanel(); });

    var confirmYes = document.getElementById('maConfirmYes');
    if (confirmYes) confirmYes.addEventListener('click', executeConfirmedAction);
    var confirmNo = document.getElementById('maConfirmNo');
    if (confirmNo) confirmNo.addEventListener('click', function () { pendingConfirm = null; renderPanel(); });

    // ---- create/invite ----
    var newBtn = document.getElementById('maNewUserBtn');
    if (newBtn) newBtn.addEventListener('click', function () { createForm = emptyCreateForm(); currentView = 'create'; currentDetailId = null; renderPanel(); });
    var createCancel = document.getElementById('maCreateCancel');
    if (createCancel) createCancel.addEventListener('click', function () { currentView = 'list'; createForm = null; renderPanel(); });
    ['maCpf', 'maNome', 'maEmail', 'maNbs'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function (e) { createForm[id.replace('ma', '').toLowerCase()] = e.target.value; });
    });
    var cPerfil = document.getElementById('maPerfil');
    if (cPerfil) cPerfil.addEventListener('change', function (e) { createForm.perfil = e.target.value; createForm.status = ''; renderPanel(); });
    var cLoja = document.getElementById('maLoja');
    if (cLoja) cLoja.addEventListener('change', function (e) { createForm.loja = e.target.value; });
    var cStatus = document.getElementById('maStatus');
    if (cStatus) cStatus.addEventListener('change', function (e) { createForm.status = e.target.value; });
    var createFormEl = document.getElementById('maCreateForm');
    if (createFormEl) createFormEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = validateCreateForm(createForm);
      if (err) { createForm.error = err; renderPanel(); return; }
      createForm.error = null;
      pendingConfirm = {
        kind: 'invite',
        title: 'Confirmar convite',
        body: createForm.nome + ' (' + createForm.perfil + ') — ' + createForm.email,
        confirmLabel: 'Enviar convite', destructive: false
      };
      renderPanel();
    });
  }

  // Painel Master Phase PM-4B.4: interaction wiring scoped to the
  // Usuários detail content that now lives inside #nxModalRoot instead
  // of below the list -- called every time renderUserModalRoot() (re)
  // builds that content (open, close-then-reopen, or an in-place
  // refresh after a mutation), exactly mirroring how wireInteraction()
  // itself is called after every #maPanel render. State changes that
  // only affect the modal's own content (a confirm step, the edit form,
  // the generated-link panel) re-render via renderUserModalRoot() only
  // -- never the full renderPanel(), which would rebuild the list and
  // detach the exact row/card this modal's focus-return depends on.
  function wireUserModalInteraction() {
    var editBtn = document.getElementById('maEditBtn');
    if (editBtn) editBtn.addEventListener('click', function () {
      var r = rowById(currentDetailId);
      editForm = { id: r.id, perfil: r.perfil, loja: r.loja, status: r.status, ativo: r.ativo, error: null };
      renderUserModalRoot();
    });
    var editCancel = document.getElementById('maEditCancel');
    if (editCancel) editCancel.addEventListener('click', function () { editForm = null; renderUserModalRoot(); });
    var editPerfil = document.getElementById('maEditPerfil');
    if (editPerfil) editPerfil.addEventListener('change', function (e) { editForm.perfil = e.target.value; });
    var editLoja = document.getElementById('maEditLoja');
    if (editLoja) editLoja.addEventListener('change', function (e) { editForm.loja = e.target.value; });
    var editStatus = document.getElementById('maEditStatus');
    if (editStatus) editStatus.addEventListener('change', function (e) { editForm.status = e.target.value; });
    var editForm2 = document.getElementById('maEditForm');
    if (editForm2) editForm2.addEventListener('submit', function (e) {
      e.preventDefault();
      pendingConfirm = {
        kind: 'edit',
        title: 'Confirmar alteração de autorização',
        body: 'Perfil: ' + editForm.perfil + ' · Loja: ' + (editForm.loja || '—') + ' · Departamento: ' + (editForm.status || '—'),
        confirmLabel: 'Confirmar', destructive: false
      };
      renderUserModalRoot();
    });

    var toggleBtn = document.getElementById('maToggleActiveBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', function () {
      var r = rowById(currentDetailId);
      pendingConfirm = {
        kind: 'toggleActive', target: r,
        title: r.ativo ? 'Bloquear usuário' : 'Reativar usuário',
        body: r.ativo ? 'O usuário perderá acesso imediatamente ao portal.' : 'O usuário voltará a ter acesso ao portal.',
        confirmLabel: r.ativo ? 'Bloquear' : 'Reativar', destructive: r.ativo
      };
      renderUserModalRoot();
    });

    var resendBtn = document.getElementById('maResendBtn');
    if (resendBtn) resendBtn.addEventListener('click', function () {
      var r = rowById(currentDetailId);
      pendingConfirm = {
        kind: 'resend', target: r,
        title: 'Reenviar convite',
        body: 'Um novo e-mail de convite será enviado para ' + r.emailAuth + '.',
        confirmLabel: 'Reenviar', destructive: false
      };
      renderUserModalRoot();
    });

    var generateLinkBtn = document.getElementById('maGenerateLinkBtn');
    if (generateLinkBtn) generateLinkBtn.addEventListener('click', function () {
      var r = rowById(currentDetailId);
      var action = r.accessLinkAction;
      if (!action) return;
      var bodyByType = {
        activation: 'Este link permitirá que o usuário defina sua senha de acesso. Compartilhe-o somente com o próprio usuário. Gerar um novo link invalida qualquer link anterior ainda não utilizado.',
        recovery: 'Este link permitirá que o usuário redefina sua senha. Compartilhe-o somente com o próprio usuário. Gerar um novo link invalida qualquer link de recuperação anterior ainda não utilizado.',
        continuation: 'O usuário já confirmou o e-mail e definiu senha — este link NÃO pede nova senha, só conclui o vínculo com o Portal. Compartilhe-o somente com o próprio usuário. Este link expira em 30 minutos.'
      };
      pendingConfirm = {
        kind: 'generateAccessLink', subtype: action.type, target: r,
        title: action.label,
        body: bodyByType[action.type] || '',
        confirmLabel: action.label, destructive: false
      };
      renderUserModalRoot();
    });

    var copyLinkBtn = document.getElementById('maCopyLinkBtn');
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', function () {
      if (!generatedLink) return;
      var msg = document.getElementById('maLinkCopyMsg');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(generatedLink.link).then(function () {
          if (msg) msg.textContent = 'Link copiado.';
        }, function () {
          if (msg) msg.textContent = 'Não foi possível copiar automaticamente — selecione e copie manualmente.';
        });
      } else if (msg) {
        msg.textContent = 'Não foi possível copiar automaticamente — selecione e copie manualmente.';
      }
    });
    var closeLinkBtn = document.getElementById('maCloseLinkPanel');
    if (closeLinkBtn) closeLinkBtn.addEventListener('click', function () { generatedLink = null; renderUserModalRoot(); });

    var confirmYes = document.getElementById('maConfirmYes');
    if (confirmYes) confirmYes.addEventListener('click', executeConfirmedAction);
    var confirmNo = document.getElementById('maConfirmNo');
    if (confirmNo) confirmNo.addEventListener('click', function () { pendingConfirm = null; renderUserModalRoot(); });
  }

  // Gate 17: UX-only echo of the real RPC's own authoritative
  // validation (docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md) — no new
  // business rule invented; the RPC remains the final authority
  // regardless of what passes here.
  function validateCreateForm(f) {
    var cpfDigits = f.cpf.replace(/\D/g, '');
    if (!cpfDigits || cpfDigits.length > 11) return 'CPF inválido.';
    if (!f.nome.trim()) return 'Nome é obrigatório.';
    if (!f.perfil) return 'Selecione um perfil.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return 'E-mail inválido.';
    if (window.NX_MASTER_USERS_VIEW_MODEL.STATUS_REQUIRED_PROFILES.indexOf(f.perfil) !== -1 && !f.status) {
      return 'Selecione o departamento para este perfil.';
    }
    return null;
  }

  // ---------- mutation execution. Real, audited RPC/Edge Function
  // contract (docs/MASTER-USERS-RPC-CONTRACT-CAPTURE.md), exercised
  // both via mocked deterministic tests and, as of Painel Master Phase
  // 2B/2C, real MASTER mutations against the dedicated disposable
  // homolog identity. Double-submit guarded regardless. ----------
  function executeConfirmedAction() {
    if (!pendingConfirm) return;
    var kind = pendingConfirm.kind;

    if (kind === 'discardAcessosAndSwitch') {
      var target = pendingConfirm.targetSection;
      pendingConfirm = null;
      acessosState.localPermissions = Object.assign({}, acessosState.serverSnapshot);
      acessosState.dirty = false;
      switchSection(target);
      return;
    }
    if (kind === 'saveAcessos') {
      var delta = pendingConfirm.delta;
      acessosExecuteSave(delta);
      return;
    }

    // ---- Pendências Cadastrais mutations (Painel Master Phase PM-4C.2) ----
    // Gate 43: EVERY branch below reloads the canonical list from the
    // RPC on success (pcLoad()) rather than patching local state --
    // Ignorar alone can affect many rows via server-side propagation,
    // so a canonical reload is the only way the UI can ever agree with
    // the real backend effect.
    if (kind === 'pcResolver') {
      if (inFlight.pcMutate) return;
      inFlight.pcMutate = true;
      var motivoR = (document.getElementById('pcResolverMotivo') || {}).value || null;
      window.NX_MASTER_PENDENCIAS_PROVIDER.resolverAlerta(pendingConfirm.target.id, motivoR, {}).then(function () {
        inFlight.pcMutate = false;
        pendingConfirm = null;
        successMessage = 'Pendência marcada como resolvida.';
        pcLoad();
      }, function (err) {
        inFlight.pcMutate = false;
        pendingConfirm.error = pcMutationErrorCopy(err);
        renderPcModalRoot();
      });
      return;
    }
    if (kind === 'pcIgnorar') {
      var pcIgnorarMotivoEl = document.getElementById('pcIgnorarMotivo');
      var motivoI = (pcIgnorarMotivoEl || {}).value || '';
      if (!motivoI) { pendingConfirm.error = 'Selecione um motivo.'; renderPcModalRoot(); return; }
      var obsI = (document.getElementById('pcIgnorarObs') || {}).value || null;
      var criarExc = !!(document.getElementById('pcIgnorarExcecao') || {}).checked;
      if (inFlight.pcMutate) return;
      inFlight.pcMutate = true;
      window.NX_MASTER_PENDENCIAS_PROVIDER.ignorarAlerta(pendingConfirm.target.id, motivoI, obsI, criarExc, {}).then(function (resp) {
        inFlight.pcMutate = false;
        pendingConfirm = null;
        var msg = 'Pendência ignorada.';
        if (resp.codigo === 'IGNORADO_COM_EXCECAO') msg += ' Exceção criada.';
        if (resp.codigo === 'IGNORADO_SEM_EXCECAO') msg += ' Não foi possível criar a exceção (identificador não elegível).';
        // Gate 30: never hide a propagated mutation -- surface the
        // backend-reported count verbatim, never re-derived client-side.
        var propagados = Number(resp.propagados) || 0;
        if (propagados > 0) msg += ' Mais ' + propagados + ' pendência(s) do mesmo identificador também ' + (propagados === 1 ? 'foi ignorada' : 'foram ignoradas') + '.';
        successMessage = msg;
        pcLoad();
      }, function (err) {
        inFlight.pcMutate = false;
        pendingConfirm.error = pcMutationErrorCopy(err);
        renderPcModalRoot();
      });
      return;
    }
    if (kind === 'pcExcluir') {
      var motivoE = (document.getElementById('pcExcluirMotivo') || {}).value || '';
      if (!motivoE.trim()) { pendingConfirm.error = 'Informe o motivo.'; renderPcModalRoot(); return; }
      if (inFlight.pcMutate) return;
      inFlight.pcMutate = true;
      window.NX_MASTER_PENDENCIAS_PROVIDER.excluirAlerta(pendingConfirm.target.id, motivoE, {}).then(function () {
        inFlight.pcMutate = false;
        pendingConfirm = null;
        successMessage = 'Pendência excluída.';
        pcLoad();
      }, function (err) {
        inFlight.pcMutate = false;
        pendingConfirm.error = pcMutationErrorCopy(err);
        renderPcModalRoot();
      });
      return;
    }
    if (kind === 'pcCorrigirNbs') {
      var novoNbs = ((document.getElementById('pcNovoNbs') || {}).value || '').trim();
      if (!novoNbs) { pendingConfirm.error = 'Informe um valor válido.'; renderPcModalRoot(); return; }
      var obsN = (document.getElementById('pcNovoNbsObs') || {}).value || null;
      if (inFlight.pcMutate) return;
      inFlight.pcMutate = true;
      window.NX_MASTER_PENDENCIAS_PROVIDER.corrigirLoginNbs(pendingConfirm.target.id, novoNbs, obsN, {}).then(function (resp) {
        inFlight.pcMutate = false;
        pendingConfirm = null;
        var extras = Number(resp.alertas_resolvidos) || 0;
        var msg = 'Login NBS corrigido.';
        if (extras === 1) msg += ' Alerta resolvido.';
        else if (extras > 1) msg += ' ' + extras + ' alertas relacionados resolvidos automaticamente.';
        successMessage = msg;
        pcLoad();
      }, function (err) {
        inFlight.pcMutate = false;
        pendingConfirm.error = pcMutationErrorCopy(err);
        renderPcModalRoot();
      });
      return;
    }
    if (kind === 'pcRevogarExcecao') {
      if (inFlight.pcExcecao) return;
      inFlight.pcExcecao = true;
      window.NX_MASTER_PENDENCIAS_PROVIDER.revogarExcecao(pendingConfirm.target.id, {}).then(function () {
        inFlight.pcExcecao = false;
        pendingConfirm = null;
        successMessage = 'Exceção revogada.';
        pcState.excecoes.loaded = false;
        pcExcecoesLoad();
      }, function (err) {
        inFlight.pcExcecao = false;
        pendingConfirm.error = pcMutationErrorCopy(err);
        renderPanel();
      });
      return;
    }

    if (kind === 'generateAccessLink') {
      if (inFlight.generateLink) return;
      inFlight.generateLink = true;
      var linkTarget = pendingConfirm.target;
      var subtype = pendingConfirm.subtype;
      var linkProvider = window.NX_MASTER_USERS_PROVIDER;
      var linkPromise = subtype === 'continuation'
        ? linkProvider.generateContinuationLink(linkTarget.id, {})
        : linkProvider.generateAccessLink(linkTarget.id, subtype, {});
      linkPromise.then(
        function (result) {
          inFlight.generateLink = false;
          pendingConfirm = null;
          generatedLink = { tipo: subtype, link: result.link };
          renderUserModalRoot();
        },
        function (err) {
          inFlight.generateLink = false;
          // Real V1 copy for master_gerar_continuacao_primeiro_acesso's
          // own enumerated failure codes (docs: this Phase's own RPC
          // capture) -- everything else falls back to the shared
          // STATE_COPY vocabulary already used across this file.
          var msg = (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body;
          if (err && err.code) {
            var CONTINUATION_ERROR_COPY = {
              USUARIO_JA_ATIVO: 'Este usuário já está ativo.',
              PRIMEIRO_ACESSO_NAO_PENDENTE: 'Este usuário não está aguardando primeiro acesso.',
              SEM_CONTA_AUTH: 'Este usuário ainda não possui conta Auth.',
              CONTA_LEGADA_USE_MIGRACAO: 'Conta legada — este fluxo ainda não está disponível no Portal V2 para contas de migração legada.',
              CONTA_AUTH_NAO_LOCALIZADA: 'Conta Auth vinculada não foi localizada.',
              EMAIL_DIVERGENTE: 'E-mail divergente entre o cadastro e a conta Auth — geração bloqueada por segurança.',
              AUTH_NAO_CONFIRMADO: 'O usuário ainda não confirmou o e-mail — use Reenviar Convite ou Gerar Link de Ativação.',
              CONVITE_INCOMPATIVEL: 'Convite original não encontrado ou incompatível.',
              RATE_LIMIT: (err.aguardarSegundos ? 'Aguarde cerca de ' + Math.ceil(err.aguardarSegundos / 60) + ' minuto(s) antes de gerar outro link.' : 'Aguarde alguns minutos antes de gerar outro link.')
            };
            msg = CONTINUATION_ERROR_COPY[err.code] || msg;
          }
          pendingConfirm.error = msg;
          renderUserModalRoot();
        }
      );
      return;
    }

    var flagKey = kind === 'toggleActive' ? 'toggleActive' : kind === 'resend' ? 'resend' : kind === 'edit' ? 'edit' : 'invite';
    if (inFlight[flagKey]) return; // double-submit guard
    inFlight[flagKey] = true;

    var provider = window.NX_MASTER_USERS_PROVIDER;
    var promise;
    var pendingSuccessMessage = null;
    if (kind === 'invite') {
      promise = provider.inviteUser(createForm, {});
    } else if (kind === 'edit') {
      var r = rowById(editForm.id);
      promise = provider.updateUserAuthorization({ usuarioId: editForm.id, perfil: editForm.perfil, loja: editForm.loja, status: editForm.status, ativo: r.ativo }, {});
    } else if (kind === 'toggleActive') {
      var t = pendingConfirm.target;
      promise = provider.updateUserAuthorization({ usuarioId: t.id, perfil: t.perfil, loja: t.loja, status: t.status, ativo: !t.ativo }, {});
      pendingSuccessMessage = t.ativo ? SUCCESS_COPY.toggleActive.inactive : SUCCESS_COPY.toggleActive.active;
    } else if (kind === 'resend') {
      promise = provider.resendInvite(pendingConfirm.target.conviteId, {});
      pendingSuccessMessage = SUCCESS_COPY.resend;
    }

    promise.then(
      function () {
        // Fires only on genuine backend confirmation -- resendInvite's
        // own promise (master-users-provider.js) only resolves once
        // BOTH the RPC and the admin-invite-user Edge Function have
        // succeeded, so an Edge Function failure after a successful
        // RPC correctly lands in the rejection branch below instead
        // (Gate 9: RPC success + Edge Function failure must never show
        // success).
        inFlight[flagKey] = false;
        pendingConfirm = null;
        currentView = 'list';
        createForm = null;
        editForm = null;
        successMessage = pendingSuccessMessage;
        loadUsers(); // re-fetch authoritative state, never optimistic
      },
      function (err) {
        inFlight[flagKey] = false;
        if (kind === 'invite') { createForm.error = (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body; }
        else if (kind === 'edit') { editForm.error = (STATE_COPY[err && err.state] || STATE_COPY.RPC_ERROR).body; }
        successMessage = null;
        pendingConfirm = null;
        renderPanel();
      }
    );
  }

  window.NX_SHELL_ADMIN_PAGE = {
    render: function (outlet) {
      // MASTERFIX1: captured once per mount, compared inside every
      // renderNxModal()/clearNxModal() call (see mountRoute declaration
      // above). The onChange subscription is registered only once ever
      // (routeChangeSubscribed), not once per mount, so repeated visits
      // to Painel Master never accumulate listeners on the router's
      // own un-unsubscribable list; its closure always reads the
      // CURRENT mountRoute (a shared module-level variable), so it
      // stays correct across every future mount.
      mountRoute = (window.NX_ROUTER && typeof window.NX_ROUTER.currentRouteId === 'function')
        ? window.NX_ROUTER.currentRouteId() : null;
      if (window.NX_ROUTER && typeof window.NX_ROUTER.onChange === 'function' && !routeChangeSubscribed) {
        routeChangeSubscribed = true;
        window.NX_ROUTER.onChange(function (routeId) {
          if (mountRoute !== null && routeId !== mountRoute) clearNxModalUnconditional();
        });
      }
      currentSection = 'usuarios';
      currentView = 'list';
      currentDetailId = null;
      searchQuery = ''; filterPerfil = ''; filterLoja = ''; filterStatus = '';
      loadError = null;
      usersRows = [];
      renderSeq = 0;
      isLoading = false;
      acessosState = {
        loading: false, loaded: false, saving: false, error: null,
        modules: [], serverSnapshot: {}, serverUpdatedAt: {}, localPermissions: {},
        dirty: false, successMessage: null, conflictMessage: null
      };
      auditState = { loading: false, loaded: false, error: null, rows: [] };
      auditDetailId = null;
      pcState = {
        loading: false, loaded: false, error: null, rows: [], total: 0,
        aba: 'alertas', tab: 'PENDENTES', filtros: { tipo: '', origem: '', busca: '' },
        excecoes: { loading: false, loaded: false, error: null, rows: [], filtroTipo: '', filtroAtivo: true, formError: null }
      };
      pcDetailId = null;
      nxModalTriggerEl = null;
      var staleModalRoot = document.getElementById('nxModalRoot');
      if (staleModalRoot) { staleModalRoot.innerHTML = ''; staleModalRoot.setAttribute('aria-hidden', 'true'); }
      document.body.classList.remove('maudModalOpen');
      outlet.innerHTML =
        '<div class="maPage">' +
        '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Painel Master</h1><p class="modSubtitle">Administração de usuários e acessos.</p></div>' +
        '<button type="button" class="modBtn" id="maNewUserBtn">+ Novo usuário</button></div>' +
        '<div id="maSectionNavWrap"></div>' +
        '<div id="maPanel"></div>' +
        '</div>';
      document.getElementById('maNewUserBtn').addEventListener('click', function () { createForm = emptyCreateForm(); currentView = 'create'; renderPanel(); });
      renderSectionNav();
      loadUsers();
      return Promise.resolve();
    }
  };
})();