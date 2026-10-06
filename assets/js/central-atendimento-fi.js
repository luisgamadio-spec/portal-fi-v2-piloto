/* PORTAL-NEXT V2 — Central de Atendimento F&I (CA-1 migration).
   Functional contract discovered by direct source read of the real V1
   implementation (portal-financiamento-brabus-secure, index.html:1620-
   1753 -- showCentralAtendimentoFi/centralRenderDashboard/
   centralRenderAnalistas/centralRenderHistorico) PLUS live, read-only
   database introspection of the real project this Wave (table DDL,
   RLS, grants, and every RPC body via pg_get_functiondef) -- not
   redesigned or invented. MASTER-only back-office console for the
   analistas_fi roster and a read-only attendance log. NOT a live
   request-queue/ticketing system: no claim/assign/complete/cancel
   action exists in V1, and none is invented here either -- see
   docs/CHANGE-PROPOSAL-CENTRAL-ATENDIMENTO-FI.md for the full
   evidence trail, including the confirmed real-data fact that every
   historico_atendimentos_fi row in production is permanently stuck at
   status_atendimento='ABERTO' (0/102 ever finalized) -- rendered here
   as-is, not concealed or fabricated as "closed".

   Zero business math here. Every value comes from
   central-atendimento-fi-real-provider.js's 5 live RPCs. Management
   counterpart to painel-analista-fi.js (same underlying analistas_fi
   table, disjoint write surface: that page writes only the caller's
   own row via atualizar_meu_status_analista_fi, this page writes any
   row via the gestor_* RPCs, MASTER-only). */
(function () {
  'use strict';

  var PROVIDER = window.NX_CENTRAL_ATENDIMENTO_FI_REAL_PROVIDER;
  var XLSX_HELPER = window.NX_XLSX_EXPORT_HELPER;

  // V2-SECURITY-02 (SEC-06): delegate a classified SESSION_EXPIRED (the
  // provider maps HTTP 401/403 to this state -- central-atendimento-fi-
  // real-provider.js's own classifyError()) to Auth Foundation's already
  // established handling (auth-core.js's reportSessionExpired()) instead
  // of just showing this module's own generic error state. Never fires
  // for a network error, timeout, or any other RPC failure -- only this
  // one specific, server-confirmed state. Returns true if it handled the
  // error (caller should stop, the shell is about to show Login again).
  function reportIfSessionExpired(err) {
    if (err && err.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
      window.NX_AUTH_CORE.reportSessionExpired();
      return true;
    }
    return false;
  }

  // Exact V1 backend contract -- 5 values, exact accents/casing
  // preserved, never invented/translated. Server-side validation
  // (gestor_alterar_status_analista_fi) also accepts the unaccented
  // 'FERIAS' as an input alias, but always stores/returns 'FÉRIAS' --
  // this UI only ever sends the accented canonical form.
  var STATUSES = [
    { value: 'ONLINE', label: 'Online', icon: '🟢' },
    { value: 'OCUPADO', label: 'Ocupado', icon: '🟡' },
    { value: 'ALMOÇO', label: 'Almoço', icon: '🍽️' },
    { value: 'FÉRIAS', label: 'Férias', icon: '🌴' },
    { value: 'OFFLINE', label: 'Offline', icon: '⚫' }
  ];

  var outletRef = null;
  var activeTab = 'dashboard'; // dashboard | analistas | historico

  var analistas = null; // array | null
  var analistasState = 'LOADING'; // LOADING | READY | ERROR
  var historico = null; // array | null
  var historicoState = 'LOADING'; // LOADING | READY | ERROR

  var formEditingId = null; // null = create mode
  var formFields = blankForm();
  var formSaving = false;
  var formError = null;
  var formSuccess = null;

  var statusModalAnalistaId = null;
  var statusModalSaving = false;

  var rowActionBusyId = null; // analista id currently mid Ativar/Inativar/Mover
  var pendingConfirm = null; // {kind:'encerrarExpediente'} | null
  var expedienteMsg = null;

  var histFiltroLoja = '';
  var histFiltroVendedor = '';
  var histFilterDebounce = null;
  // Debounces the RE-RENDER itself (not just the filtering), same fix
  // already proven in this codebase for the identical defect class
  // (shell-admin.js's suBuscaDebounce/suSetBusca, Painel Master's
  // "Pesquisar usuário..." field): a full innerHTML replace destroys
  // and recreates the <input> DOM node, which would silently steal
  // focus/caret position away from a user still actively typing. By
  // delaying the re-render until 200ms of no further keystrokes,
  // continuous typing never triggers a DOM replace at all -- only a
  // genuine pause does, when losing focus is imperceptible.
  function debounceFilterRender() {
    clearTimeout(histFilterDebounce);
    histFilterDebounce = setTimeout(function () { render(outletRef); }, 200);
  }

  function blankForm() {
    return { nome: '', cpf: '', whatsapp: '', teamsLink: '', ordemFila: '', ativo: true };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDataHora(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '—'; }
  }
  function onlyDigits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function statusClass(status) {
    var norm = String(status || 'OFFLINE').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z]/g, '');
    return 'caStatus' + norm;
  }
  function statusMeta(status) {
    for (var i = 0; i < STATUSES.length; i++) { if (STATUSES[i].value === status) return STATUSES[i]; }
    return { value: status, label: status || '—', icon: '⚫' };
  }

  // ---------- data loading ----------

  function loadAnalistas() {
    analistasState = 'LOADING';
    render(outletRef);
    return PROVIDER.listarAnalistas().then(function (rows) {
      analistas = rows;
      analistasState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      // V2-SECURITY-02 (SEC-06): delegate a genuinely expired/invalid
      // session to Auth Foundation's established handling instead of
      // just showing a generic error state.
      if (reportIfSessionExpired(err)) return;
      analistasState = 'ERROR';
      render(outletRef);
    });
  }

  function loadHistorico() {
    historicoState = 'LOADING';
    render(outletRef);
    return PROVIDER.listarHistorico().then(function (rows) {
      historico = rows;
      historicoState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (reportIfSessionExpired(err)) return;
      historicoState = 'ERROR';
      render(outletRef);
    });
  }

  // ---------- dashboard KPIs ----------
  // "Disponíveis" is the ONE formula directly confirmed against V1
  // source (index.html:1731): ativo!==false && status==='ONLINE' &&
  // online===true && ocupado===false. "Último atendimento" mirrors
  // V1's own hist[0]?.criado_em (server already returns
  // gestor_listar_historico_atendimentos_fi ordered newest-first).
  // The remaining KPI counts are straightforward, clearly-labeled
  // reconstructions from the same confirmed data shape (V1's exact
  // dashboard aggregation code for these secondary counts was not
  // captured verbatim by this Wave's discovery — see the Change
  // Proposal's own explicit note; nothing here is fabricated business
  // logic, only plain counts/sums of already-real fields).
  function computeKpis(list, hist) {
    var ativos = (list || []).filter(function (a) { return a.ativo !== false; });
    var disponiveis = ativos.filter(function (a) { return a.status === 'ONLINE' && a.online === true && a.ocupado === false; }).length;
    var online = ativos.filter(function (a) { return a.status === 'ONLINE'; }).length;
    var ocupados = ativos.filter(function (a) { return a.status === 'OCUPADO'; }).length;
    var almoco = ativos.filter(function (a) { return a.status === 'ALMOÇO'; }).length;
    var ausentes = ativos.filter(function (a) { return a.status === 'OFFLINE' || a.status === 'FÉRIAS'; }).length;
    var atendimentosHoje = ativos.reduce(function (sum, a) { return sum + (Number(a.atendimentos_hoje) || 0); }, 0);
    var ultimo = hist && hist.length ? hist[0].criado_em : null;
    return {
      disponiveis: disponiveis, online: online, ocupados: ocupados, almoco: almoco, ausentes: ausentes,
      atendimentosHoje: atendimentosHoje, analistasAtivos: ativos.length, ultimoAtendimento: ultimo
    };
  }

  // ---------- dashboard actions ----------

  function requestEncerrarExpediente() {
    pendingConfirm = { kind: 'encerrarExpediente' };
    render(outletRef);
  }
  function cancelConfirm() { pendingConfirm = null; render(outletRef); }
  function confirmEncerrarExpediente() {
    pendingConfirm = null;
    expedienteMsg = null;
    render(outletRef);
    PROVIDER.encerrarExpediente().then(function (r) {
      if (!r || !r.sucesso) {
        expedienteMsg = { text: (r && r.mensagem) || 'Não foi possível encerrar o expediente.', err: true };
        render(outletRef);
        return;
      }
      expedienteMsg = { text: r.mensagem || 'Expediente encerrado.', err: false };
      loadAnalistas();
    }).catch(function (err) {
      if (reportIfSessionExpired(err)) return;
      expedienteMsg = { text: 'Erro ao encerrar expediente. Tente novamente.', err: true };
      render(outletRef);
    });
  }

  // ---------- form (create/update analyst) ----------

  function startCreate() {
    formEditingId = null;
    formFields = blankForm();
    formError = null; formSuccess = null;
    render(outletRef);
  }
  function startEdit(row) {
    formEditingId = row.id;
    formFields = {
      nome: row.nome || '', cpf: row.cpf_normalizado || '', whatsapp: row.whatsapp || '',
      teamsLink: row.teams_link || '', ordemFila: row.ordem_fila != null ? String(row.ordem_fila) : '', ativo: row.ativo !== false
    };
    formError = null; formSuccess = null;
    render(outletRef);
  }

  function submitForm() {
    if (formSaving) return;
    var nome = String(formFields.nome || '').trim();
    var cpf = onlyDigits(formFields.cpf);
    var whatsapp = onlyDigits(formFields.whatsapp);
    if (!nome) { formError = 'Nome é obrigatório.'; render(outletRef); return; }
    if (!cpf) { formError = 'CPF é obrigatório.'; render(outletRef); return; }
    formError = null; formSuccess = null;
    formSaving = true;
    render(outletRef);
    PROVIDER.salvarAnalista({
      id: formEditingId,
      nome: nome,
      cpf: cpf,
      whatsapp: whatsapp,
      teamsLink: formFields.teamsLink ? String(formFields.teamsLink).trim() : null,
      ordemFila: formFields.ordemFila !== '' ? Number(formFields.ordemFila) : null,
      ativo: !!formFields.ativo
    }).then(function (r) {
      formSaving = false;
      if (!r || !r.sucesso) {
        formError = (r && r.mensagem) || 'Não foi possível salvar o analista.';
        render(outletRef);
        return;
      }
      formSuccess = r.mensagem || 'Analista salvo com sucesso.';
      formEditingId = null;
      formFields = blankForm();
      loadAnalistas();
    }).catch(function (err) {
      formSaving = false;
      if (reportIfSessionExpired(err)) return;
      // V2-SECURITY-02 (SEC-01): this is the unexpected-exception path
      // (network/transport failure), not the RPC's own curated
      // r.mensagem above -- never surface raw err.message here.
      formError = 'Erro ao salvar: não foi possível concluir a operação. Tente novamente.';
      render(outletRef);
    });
  }

  // ---------- row actions: toggle ativo, move queue order, status modal ----------

  function toggleAtivo(row) {
    if (rowActionBusyId) return;
    rowActionBusyId = row.id;
    render(outletRef);
    PROVIDER.salvarAnalista({
      id: row.id, nome: row.nome, cpf: row.cpf_normalizado, whatsapp: row.whatsapp,
      teamsLink: row.teams_link, ordemFila: row.ordem_fila, ativo: !(row.ativo !== false)
    }).then(function () {
      rowActionBusyId = null;
      loadAnalistas();
    }).catch(function (err) {
      rowActionBusyId = null;
      if (reportIfSessionExpired(err)) return;
      render(outletRef);
    });
  }

  // Mirrors V1's centralMoverFila: swaps ordem_fila between the two
  // adjacent rows in the CURRENT display order (server-sorted: ativo
  // desc, ordem_fila asc, nome asc). Two sequential writes, then a
  // single authoritative reload -- non-optimistic, same discipline as
  // every other write in this file.
  function moveQueue(row, direction) {
    if (rowActionBusyId || !analistas) return;
    var idx = analistas.findIndex(function (a) { return a.id === row.id; });
    var targetIdx = idx + (direction === 'up' ? -1 : 1);
    if (idx < 0 || targetIdx < 0 || targetIdx >= analistas.length) return;
    var other = analistas[targetIdx];
    rowActionBusyId = row.id;
    render(outletRef);
    Promise.all([
      PROVIDER.salvarAnalista({ id: row.id, nome: row.nome, cpf: row.cpf_normalizado, whatsapp: row.whatsapp, teamsLink: row.teams_link, ordemFila: other.ordem_fila, ativo: row.ativo }),
      PROVIDER.salvarAnalista({ id: other.id, nome: other.nome, cpf: other.cpf_normalizado, whatsapp: other.whatsapp, teamsLink: other.teams_link, ordemFila: row.ordem_fila, ativo: other.ativo })
    ]).then(function () {
      rowActionBusyId = null;
      loadAnalistas();
    }).catch(function (err) {
      rowActionBusyId = null;
      if (reportIfSessionExpired(err)) return;
      render(outletRef);
    });
  }

  function openStatusModal(id) { statusModalAnalistaId = id; render(outletRef); }
  function closeStatusModal() { statusModalAnalistaId = null; render(outletRef); }
  function chooseStatus(status) {
    if (statusModalSaving || !statusModalAnalistaId) return;
    statusModalSaving = true;
    render(outletRef);
    PROVIDER.alterarStatus(statusModalAnalistaId, status).then(function (r) {
      statusModalSaving = false;
      statusModalAnalistaId = null;
      if (!r || !r.sucesso) {
        expedienteMsg = { text: (r && r.mensagem) || 'Não foi possível alterar o status.', err: true };
      }
      loadAnalistas();
    }).catch(function (err) {
      statusModalSaving = false;
      statusModalAnalistaId = null;
      if (reportIfSessionExpired(err)) return;
      expedienteMsg = { text: 'Erro ao alterar status. Tente novamente.', err: true };
      render(outletRef);
    });
  }

  // ---------- histórico: client-side filters + export (mirrors V1's
  // own applyHistFilters()/histCache -- 0 params on the RPC, every
  // filter applied over the already-fetched set) ----------

  function filteredHistorico() {
    var loja = histFiltroLoja.trim().toUpperCase();
    var vendedor = histFiltroVendedor.trim().toUpperCase();
    return (historico || []).filter(function (h) {
      if (loja && String(h.loja_vendedor || '').toUpperCase().indexOf(loja) === -1) return false;
      if (vendedor && String(h.nome_vendedor || '').toUpperCase().indexOf(vendedor) === -1) return false;
      return true;
    });
  }

  function exportHistorico() {
    if (!XLSX_HELPER || typeof XLSX === 'undefined') return;
    var rows = filteredHistorico();
    var headers = ['Data', 'Vendedor', 'Loja', 'Analista', 'Canal', 'Origem', 'Status', 'Iniciado em', 'Finalizado em', 'Observação'];
    var dataRows = rows.map(function (h) {
      return [
        h.criado_em ? new Date(h.criado_em) : '', h.nome_vendedor || '', h.loja_vendedor || '', h.nome_analista || '',
        h.canal || '', h.origem || '', h.status_atendimento || '', h.iniciado_em ? new Date(h.iniciado_em) : '',
        h.finalizado_em ? new Date(h.finalizado_em) : '', h.observacao || ''
      ];
    });
    XLSX_HELPER.downloadWorkbook(headers, dataRows, 'Histórico F&I', 'central-atendimento-fi_historico_' + XLSX_HELPER.excelFileStamp() + '.xlsx', {
      dateCols: new Set(['Data', 'Iniciado em', 'Finalizado em']),
      textCols: new Set(['Vendedor', 'Loja', 'Analista', 'Canal', 'Origem', 'Status', 'Observação'])
    });
  }

  // ---------- render: tab nav ----------

  function tabNavHtml() {
    var tabs = [{ id: 'dashboard', label: '📊 Dashboard' }, { id: 'analistas', label: '👥 Gestão de Analistas' }, { id: 'historico', label: '📋 Histórico' }];
    return '<nav class="modTabGroup" aria-label="Áreas da Central de Atendimento">' + tabs.map(function (t) {
      return '<button type="button" class="modTab' + (t.id === activeTab ? ' modTabActive' : '') + '" data-tab="' + t.id + '" aria-current="' + (t.id === activeTab ? 'page' : 'false') + '">' + t.label + '</button>';
    }).join('') + '</nav>';
  }

  // ---------- render: dashboard ----------

  function confirmHtml() {
    if (!pendingConfirm || pendingConfirm.kind !== 'encerrarExpediente') return '';
    return '<div class="caConfirm" role="alertdialog" aria-labelledby="caConfirmTitle">' +
      '<h3 id="caConfirmTitle">Encerrar expediente?</h3>' +
      '<p>Todos os analistas ativos serão colocados como OFFLINE. Esta ação afeta imediatamente a fila do botão "Falar com um analista" nos simuladores.</p>' +
      '<div class="caConfirmActions">' +
      '<button type="button" class="modBtn modBtnDanger" id="caConfirmYes">Encerrar expediente</button>' +
      '<button type="button" class="modBtnGhost" id="caConfirmNo">Cancelar</button>' +
      '</div></div>';
  }

  function dashboardHtml() {
    if (analistasState === 'ERROR' || historicoState === 'ERROR') {
      return '<div class="modErrorState">Não foi possível carregar os dados da Central de Atendimento. ' +
        '<button type="button" class="modBtn modBtnSecondary" id="caDashRetry" style="margin-top:12px">Tentar novamente</button></div>';
    }
    if (analistasState === 'LOADING' || historicoState === 'LOADING') {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando…</div>';
    }
    var k = computeKpis(analistas, historico);
    var filaAtual = analistas.slice(0, 12);
    var ultimosAtendimentos = (historico || []).slice(0, 10);
    return (
      '<div class="modKpiGrid">' +
      '<div class="modKpiCard modKpiCardSuccess"><p class="modMuted">Disponíveis</p><p class="caKpiValue">' + k.disponiveis + '</p></div>' +
      '<div class="modKpiCard"><p class="modMuted">Online</p><p class="caKpiValue">' + k.online + '</p></div>' +
      '<div class="modKpiCard modKpiCardWarning"><p class="modMuted">Ocupados</p><p class="caKpiValue">' + k.ocupados + '</p></div>' +
      '<div class="modKpiCard"><p class="modMuted">Almoço</p><p class="caKpiValue">' + k.almoco + '</p></div>' +
      '<div class="modKpiCard"><p class="modMuted">Offline / Férias</p><p class="caKpiValue">' + k.ausentes + '</p></div>' +
      '<div class="modKpiCard modKpiCardInfo"><p class="modMuted">Atendimentos hoje</p><p class="caKpiValue">' + k.atendimentosHoje + '</p></div>' +
      '<div class="modKpiCard"><p class="modMuted">Analistas ativos</p><p class="caKpiValue">' + k.analistasAtivos + '</p></div>' +
      '<div class="modKpiCard"><p class="modMuted">Último atendimento</p><p class="caKpiValueSm">' + esc(fmtDataHora(k.ultimoAtendimento)) + '</p></div>' +
      '</div>' +
      (expedienteMsg ? '<div class="caInlineMsg ' + (expedienteMsg.err ? 'err' : 'ok') + '" role="status" aria-live="polite">' + esc(expedienteMsg.text) + '</div>' : '') +
      '<div class="modHeaderActions" style="margin:var(--mod-space-control-gap) 0">' +
      '<button type="button" class="modBtn modBtnSecondary" id="caDashRefresh">Atualizar</button>' +
      '<button type="button" class="modBtn modBtnDanger" id="caDashEncerrar">🔴 Encerrar Expediente</button>' +
      '<button type="button" class="modBtn modBtnGhost" data-tab="analistas">Gerenciar Analistas</button>' +
      '<button type="button" class="modBtn modBtnGhost" data-tab="historico">Ver Histórico</button>' +
      '</div>' +
      (pendingConfirm ? confirmHtml() : '') +
      '<h2 class="modSectionTitle">Fila atual</h2>' +
      analistaListHtml(filaAtual, false) +
      '<h2 class="modSectionTitle">Últimos atendimentos</h2>' +
      historicoTableHtml(ultimosAtendimentos, false)
    );
  }

  // ---------- render: analistas (roster CRUD) ----------

  function formHtml() {
    return (
      '<div class="modPanelForm caForm">' +
      '<h2 class="modSectionTitle" style="margin-top:0">' + (formEditingId ? 'Editar analista' : 'Novo analista') + '</h2>' +
      (formError ? '<p class="modErrorState" style="text-align:left;padding:10px 14px">' + esc(formError) + '</p>' : '') +
      (formSuccess ? '<p class="modSuccessState">' + esc(formSuccess) + '</p>' : '') +
      '<div class="caFormGrid">' +
      '<label class="modField">Nome<input type="text" id="caFNome" value="' + esc(formFields.nome) + '" autocomplete="off"></label>' +
      '<label class="modField">CPF<input type="text" id="caFCpf" value="' + esc(formFields.cpf) + '" autocomplete="off"></label>' +
      '<label class="modField">WhatsApp<input type="text" id="caFWhatsapp" value="' + esc(formFields.whatsapp) + '" autocomplete="off"></label>' +
      '<label class="modField">Teams (link)<input type="text" id="caFTeams" value="' + esc(formFields.teamsLink) + '" autocomplete="off"></label>' +
      '<label class="modField">Ordem da fila<input type="number" id="caFOrdem" value="' + esc(formFields.ordemFila) + '"></label>' +
      '<label class="modField caFieldCheckbox"><input type="checkbox" id="caFAtivo"' + (formFields.ativo ? ' checked' : '') + '> Ativo</label>' +
      '</div>' +
      '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)">' +
      '<button type="button" class="modBtn modBtnPrimary" id="caFormSave"' + (formSaving ? ' disabled' : '') + '>' + (formSaving ? 'Salvando…' : 'Salvar analista') + '</button>' +
      '<button type="button" class="modBtn modBtnGhost" id="caFormClear"' + (formSaving ? ' disabled' : '') + '>' + (formEditingId ? 'Cancelar edição' : 'Limpar') + '</button>' +
      '</div></div>'
    );
  }

  function analistaRowActionsHtml(a, idx, total) {
    var busy = rowActionBusyId === a.id;
    return '<div class="modActionCol caRowActions">' +
      '<button type="button" class="modBtn modBtnSm modBtnGhost" data-action="edit" data-id="' + esc(a.id) + '"' + (busy ? ' disabled' : '') + '>Editar</button>' +
      '<button type="button" class="modBtn modBtnSm modBtnGhost" data-action="toggle" data-id="' + esc(a.id) + '"' + (busy ? ' disabled' : '') + '>' + (a.ativo !== false ? 'Inativar' : 'Ativar') + '</button>' +
      '<button type="button" class="modBtn modBtnSm modBtnGhost" data-action="status" data-id="' + esc(a.id) + '"' + (busy ? ' disabled' : '') + '>Status</button>' +
      '<button type="button" class="modBtn modBtnSm modBtnGhost" data-action="up" data-id="' + esc(a.id) + '" aria-label="Mover para cima"' + (busy || idx === 0 ? ' disabled' : '') + '>⬆</button>' +
      '<button type="button" class="modBtn modBtnSm modBtnGhost" data-action="down" data-id="' + esc(a.id) + '" aria-label="Mover para baixo"' + (busy || idx === total - 1 ? ' disabled' : '') + '>⬇</button>' +
      '</div>';
  }

  // Desktop table + a genuinely separate mobile card renderer (Score's
  // own PORTAL-NEXT-07.6.4 finding: a CSS-only table transform was
  // rejected twice in human UAT for real dense tables -- both markups
  // are built here from the SAME array, one hidden per breakpoint via
  // CSS only, matching that proven pattern instead of repeating the
  // rejected one).
  function analistaListHtml(list, withActions) {
    if (!list.length) return '<div class="modEmptyState">Nenhum analista encontrado.</div>';
    var rowsHtml = list.map(function (a, idx) {
      var meta = statusMeta(a.status);
      return '<tr>' +
        '<td>' + esc(a.nome) + '</td>' +
        '<td class="modNumCol" style="text-align:left;font-family:var(--font-mono)">' + esc(a.cpf_normalizado || '—') + '</td>' +
        '<td>' + esc(a.whatsapp || '—') + '</td>' +
        '<td><span class="modStatusCell ' + statusClass(a.status) + '"><span aria-hidden="true">' + meta.icon + '</span> ' + esc(meta.label) + '</span></td>' +
        '<td>' + (a.ativo !== false ? '<span class="modBadge modBadgeSuccess">Ativo</span>' : '<span class="modBadge modBadgeNeutral">Inativo</span>') + '</td>' +
        '<td class="modNumCol">' + esc(a.ordem_fila) + '</td>' +
        (withActions ? '<td>' + analistaRowActionsHtml(a, idx, list.length) + '</td>' : '') +
        '</tr>';
    }).join('');
    var headCols = '<th>Nome</th><th>CPF</th><th>WhatsApp</th><th>Status</th><th>Ativo</th><th>Ordem</th>' + (withActions ? '<th>Ações</th>' : '');
    var desktop = '<div class="modTableWrap caDesktopOnly"><table class="modTable"><thead><tr>' + headCols + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

    var cards = '<div class="caMobileOnly caCardList">' + list.map(function (a, idx) {
      var meta = statusMeta(a.status);
      return '<div class="caCard">' +
        '<div class="caCardTop"><span class="caCardName">' + esc(a.nome) + '</span>' +
        (a.ativo !== false ? '<span class="modBadge modBadgeSuccess">Ativo</span>' : '<span class="modBadge modBadgeNeutral">Inativo</span>') + '</div>' +
        '<dl class="caCardFields">' +
        '<dt>Status</dt><dd class="modStatusCell ' + statusClass(a.status) + '"><span aria-hidden="true">' + meta.icon + '</span> ' + esc(meta.label) + '</dd>' +
        '<dt>CPF</dt><dd style="font-family:var(--font-mono)">' + esc(a.cpf_normalizado || '—') + '</dd>' +
        '<dt>WhatsApp</dt><dd>' + esc(a.whatsapp || '—') + '</dd>' +
        '<dt>Ordem</dt><dd>' + esc(a.ordem_fila) + '</dd>' +
        '</dl>' +
        (withActions ? analistaRowActionsHtml(a, idx, list.length) : '') +
        '</div>';
    }).join('') + '</div>';

    return desktop + cards;
  }

  function analistasHtml() {
    if (analistasState === 'ERROR') {
      return '<div class="modErrorState">Não foi possível carregar os analistas. <button type="button" class="modBtn modBtnSecondary" id="caAnalistasRetry" style="margin-top:12px">Tentar novamente</button></div>';
    }
    if (analistasState === 'LOADING') {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando…</div>';
    }
    return formHtml() +
      '<div class="caWarn">Administração liberada apenas para usuários MASTER. As alterações impactam diretamente a fila do botão "Falar com um analista".</div>' +
      '<h2 class="modSectionTitle">Analistas cadastrados</h2>' +
      analistaListHtml(analistas, true) +
      statusModalHtml();
  }

  function statusModalHtml() {
    if (!statusModalAnalistaId) return '';
    var a = (analistas || []).filter(function (x) { return x.id === statusModalAnalistaId; })[0];
    if (!a) return '';
    return '<div class="caModalBackdrop"><div class="caModal" role="dialog" aria-modal="true" aria-labelledby="caModalTitle">' +
      '<h3 id="caModalTitle">Alterar status — ' + esc(a.nome) + '</h3>' +
      '<div class="caStatusGrid" role="group" aria-label="Selecionar novo status">' +
      STATUSES.map(function (s) {
        var active = a.status === s.value;
        return '<button type="button" class="paStatusBtn' + (active ? ' active' : '') + '" data-status="' + esc(s.value) + '" aria-pressed="' + (active ? 'true' : 'false') + '"' + (statusModalSaving ? ' disabled' : '') + '>' +
          '<span class="paStatusIcon" aria-hidden="true">' + s.icon + '</span><span class="paStatusLabel">' + esc(s.label) + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="modHeaderActions" style="margin-top:var(--mod-space-control-gap)"><button type="button" class="modBtn modBtnGhost" id="caModalClose"' + (statusModalSaving ? ' disabled' : '') + '>Fechar</button></div>' +
      '</div></div>';
  }

  // ---------- render: histórico ----------

  function historicoTableHtml(list, withFilters) {
    if (!list.length) return '<div class="modEmptyState">Nenhum atendimento encontrado' + (withFilters ? ' para os filtros selecionados' : '') + '.</div>';
    var rowsHtml = list.map(function (h) {
      return '<tr>' +
        '<td>' + esc(fmtDataHora(h.criado_em)) + '</td>' +
        '<td>' + esc(h.nome_vendedor || '—') + '</td>' +
        '<td>' + esc(h.loja_vendedor || '—') + '</td>' +
        '<td>' + esc(h.nome_analista || '—') + '</td>' +
        '<td>' + esc(h.canal || '—') + '</td>' +
        '<td><span class="modBadge modBadgeInfo">' + esc(h.status_atendimento || '—') + '</span></td>' +
        '<td>' + esc(h.observacao || '—') + '</td>' +
        '</tr>';
    }).join('');
    var desktop = '<div class="modTableWrap caDesktopOnly"><table class="modTable"><thead><tr>' +
      '<th>Data</th><th>Vendedor</th><th>Loja</th><th>Analista</th><th>Canal</th><th>Status</th><th>Observação</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    var cards = '<div class="caMobileOnly caCardList">' + list.map(function (h) {
      return '<div class="caCard"><div class="caCardTop"><span class="caCardName">' + esc(h.nome_vendedor || 'Vendedor não identificado') + '</span>' +
        '<span class="modBadge modBadgeInfo">' + esc(h.status_atendimento || '—') + '</span></div>' +
        '<dl class="caCardFields">' +
        '<dt>Data</dt><dd>' + esc(fmtDataHora(h.criado_em)) + '</dd>' +
        '<dt>Loja</dt><dd>' + esc(h.loja_vendedor || '—') + '</dd>' +
        '<dt>Analista</dt><dd>' + esc(h.nome_analista || '—') + '</dd>' +
        '<dt>Canal</dt><dd>' + esc(h.canal || '—') + '</dd>' +
        '<dt>Observação</dt><dd>' + esc(h.observacao || '—') + '</dd>' +
        '</dl></div>';
    }).join('') + '</div>';
    return desktop + cards;
  }

  function historicoHtml() {
    if (historicoState === 'ERROR') {
      return '<div class="modErrorState">Não foi possível carregar o histórico. <button type="button" class="modBtn modBtnSecondary" id="caHistRetry" style="margin-top:12px">Tentar novamente</button></div>';
    }
    if (historicoState === 'LOADING') {
      return '<div class="modLoadingState"><span class="modLoadingDot"></span> Carregando…</div>';
    }
    var rows = filteredHistorico();
    return (
      '<div class="modFilters">' +
      '<label class="modField">Loja<input type="text" id="caHistLoja" value="' + esc(histFiltroLoja) + '" placeholder="Filtrar por loja"></label>' +
      '<label class="modField">Vendedor<input type="text" id="caHistVendedor" value="' + esc(histFiltroVendedor) + '" placeholder="Filtrar por vendedor"></label>' +
      '<button type="button" class="modBtn modBtnSecondary" id="caHistRefresh">Atualizar</button>' +
      '<button type="button" class="modBtn modBtnPrimary" id="caHistExport">Exportar Excel</button>' +
      '</div>' +
      '<p class="modMuted">' + rows.length + ' de ' + (historico || []).length + ' atendimentos (últimos 300 registrados).</p>' +
      historicoTableHtml(rows, true)
    );
  }

  // ---------- top-level render ----------

  function bodyHtml() {
    if (activeTab === 'analistas') return analistasHtml();
    if (activeTab === 'historico') return historicoHtml();
    return dashboardHtml();
  }

  function wire() {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.getAttribute('data-tab'); render(outletRef); });
    });
    var dashRetry = document.getElementById('caDashRetry');
    if (dashRetry) dashRetry.addEventListener('click', function () { loadAnalistas(); loadHistorico(); });
    var dashRefresh = document.getElementById('caDashRefresh');
    if (dashRefresh) dashRefresh.addEventListener('click', function () { loadAnalistas(); loadHistorico(); });
    var dashEncerrar = document.getElementById('caDashEncerrar');
    if (dashEncerrar) dashEncerrar.addEventListener('click', requestEncerrarExpediente);
    var confirmYes = document.getElementById('caConfirmYes');
    if (confirmYes) confirmYes.addEventListener('click', confirmEncerrarExpediente);
    var confirmNo = document.getElementById('caConfirmNo');
    if (confirmNo) confirmNo.addEventListener('click', cancelConfirm);

    var analistasRetry = document.getElementById('caAnalistasRetry');
    if (analistasRetry) analistasRetry.addEventListener('click', loadAnalistas);
    var formSave = document.getElementById('caFormSave');
    if (formSave) formSave.addEventListener('click', function () {
      formFields.nome = document.getElementById('caFNome').value;
      formFields.cpf = document.getElementById('caFCpf').value;
      formFields.whatsapp = document.getElementById('caFWhatsapp').value;
      formFields.teamsLink = document.getElementById('caFTeams').value;
      formFields.ordemFila = document.getElementById('caFOrdem').value;
      formFields.ativo = document.getElementById('caFAtivo').checked;
      submitForm();
    });
    var formClear = document.getElementById('caFormClear');
    if (formClear) formClear.addEventListener('click', startCreate);

    document.querySelectorAll('[data-action]').forEach(function (btn) {
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      btn.addEventListener('click', function () {
        var row = (analistas || []).filter(function (a) { return a.id === id; })[0];
        if (!row) return;
        if (action === 'edit') startEdit(row);
        else if (action === 'toggle') toggleAtivo(row);
        else if (action === 'status') openStatusModal(row.id);
        else if (action === 'up') moveQueue(row, 'up');
        else if (action === 'down') moveQueue(row, 'down');
      });
    });
    var modalClose = document.getElementById('caModalClose');
    if (modalClose) modalClose.addEventListener('click', closeStatusModal);
    document.querySelectorAll('.caModal .paStatusBtn').forEach(function (btn) {
      btn.addEventListener('click', function () { chooseStatus(btn.getAttribute('data-status')); });
    });

    var histRetry = document.getElementById('caHistRetry');
    if (histRetry) histRetry.addEventListener('click', loadHistorico);
    var histRefresh = document.getElementById('caHistRefresh');
    if (histRefresh) histRefresh.addEventListener('click', loadHistorico);
    var histExport = document.getElementById('caHistExport');
    if (histExport) histExport.addEventListener('click', exportHistorico);
    var histLoja = document.getElementById('caHistLoja');
    if (histLoja) histLoja.addEventListener('input', function () { histFiltroLoja = histLoja.value; debounceFilterRender(); });
    var histVendedor = document.getElementById('caHistVendedor');
    if (histVendedor) histVendedor.addEventListener('input', function () { histFiltroVendedor = histVendedor.value; debounceFilterRender(); });
  }

  function render(outlet) {
    outletRef = outlet;
    outlet.innerHTML =
      '<div class="caPage">' +
      '<div class="modPageHeader"><div class="modHeaderMain">' +
      '<h1 class="modTitle">Central de Atendimento F&amp;I</h1>' +
      '<p class="modSubtitle">Painel do gestor para acompanhar a fila, cadastrar analistas e consultar o histórico de atendimentos.</p>' +
      '</div></div>' +
      tabNavHtml() +
      '<div class="caBody">' + bodyHtml() + '</div>' +
      '</div>';
    wire();
  }

  window.NX_CENTRAL_ATENDIMENTO_FI_PAGE = {
    // Exposed read-only for deterministic testing, same pattern already
    // used by NX_PAINEL_ANALISTA_FI_PAGE / NX_SCORE_PAGE.
    getActiveTab: function () { return activeTab; },
    getAnalistasState: function () { return analistasState; },
    getHistoricoState: function () { return historicoState; },
    render: function (outlet) {
      outletRef = outlet;
      activeTab = 'dashboard';
      analistas = null; analistasState = 'LOADING';
      historico = null; historicoState = 'LOADING';
      formEditingId = null; formFields = blankForm(); formSaving = false; formError = null; formSuccess = null;
      statusModalAnalistaId = null; statusModalSaving = false;
      rowActionBusyId = null; pendingConfirm = null; expedienteMsg = null;
      histFiltroLoja = ''; histFiltroVendedor = '';
      clearTimeout(histFilterDebounce);
      loadAnalistas();
      return loadHistorico();
    }
  };
})();
