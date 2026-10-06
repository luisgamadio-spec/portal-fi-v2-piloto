/* PORTAL-NEXT V2 -- Painel Master / Acessos aos Módulos view-model
   (Painel Master Phase 3B).

   PRESENTATION ONLY -- labels, ordering, availability metadata, dirty-
   cell detection, delta construction, confirmation-summary formatting.
   This file never determines effective authorization: the backend
   (master_listar_permissoes_modulos/master_salvar_permissoes_modulos)
   remains the sole authority, exactly as proven in Phase 3A. Nothing
   here invents a permission, infers a MASTER row, or synthesizes a
   missing cell -- an incomplete/malformed matrix must fail closed in
   the controller (shell-admin.js), never be patched here.

   Canonical column/module identifiers are taken verbatim from the real,
   live, closed 7x8 model re-confirmed this Phase (Gate 1 fingerprint:
   12 modulos_portal rows, 56 permissoes_modulos rows, 0 MASTER rows) --
   NOT reconstructed from memory, matching the real V1
   assets/js/master-acessos-modulos.js (ia-reconciliation-v2-local)
   AM_MODULE_ORDER/AM_MODULE_LABELS/AM_COLUMNS byte-for-byte in spirit
   (same ids/labels, V2's own class names). */
(function () {
  'use strict';

  var MODULE_ORDER = [
    'simuladorCompleto', 'simuladorSeminovos', 'dashbi', 'gestao',
    'coparticipadoPortal', 'analiseScoreVendedores', 'comissoes'
  ];
  var MODULE_LABELS = {
    simuladorCompleto: 'Simulador de Novos',
    simuladorSeminovos: 'Simulador de Seminovos',
    dashbi: 'Análise Geral do Grupo',
    gestao: 'Análise F&I do Grupo',
    coparticipadoPortal: 'Coparticipados / Subsidiados',
    analiseScoreVendedores: 'Análise de Score',
    comissoes: 'Acompanhamento de Salário'
  };

  // Gate 10 -- availability is presentation metadata, never backend
  // authority. Sourced from config/module-registry.json's own
  // migrationStatus as of Painel Master Phase 3B Gate 2 (Score
  // corrected to HUMAN_APPROVED this Phase); hardcoded rather than
  // fetched at runtime to keep this view-model a pure, deterministic,
  // unit-testable function set (same tradeoff already made for
  // PERFIL_VALUES/LOJA_VALUES in master-users-view-model.js). If the
  // registry changes again this map must be updated by hand -- it does
  // not self-heal, and is not itself the authority for anything.
  // AVAILABLE = real data, human-approved. LEGACY_ONLY = human-approved
  // in the registry but a standing, separately-tracked finding that the
  // module is still fixture-only in V2 (simuladorCompleto/Seminovos --
  // pre-existing, not this Phase's to fix). COMING_SOON = not migrated
  // in V2 at all yet (comissoes -- also the AUTH-RH-SCOPE-CONTRADICTION
  // module, Gate 25, untouched here).
  var AVAILABILITY = {
    simuladorCompleto: { state: 'LEGACY_ONLY', label: 'V2 ainda usa dados de exemplo' },
    simuladorSeminovos: { state: 'LEGACY_ONLY', label: 'V2 ainda usa dados de exemplo' },
    dashbi: { state: 'AVAILABLE', label: 'Disponível no Portal V2' },
    gestao: { state: 'AVAILABLE', label: 'Disponível no Portal V2' },
    coparticipadoPortal: { state: 'AVAILABLE', label: 'Disponível no Portal V2' },
    analiseScoreVendedores: { state: 'AVAILABLE', label: 'Disponível no Portal V2' },
    comissoes: { state: 'COMING_SOON', label: 'Ainda não disponível no Portal V2' }
  };

  // Checkpoint (mirrors V1's own AM_COLUMNS labels, Gate 5: no MASTER
  // column, ever -- MASTER is presented separately as a permanent-access
  // notice, never as editable state; see Gate 6/renderMasterNotice).
  var COLUMNS = [
    { perfil: 'VENDEDOR', departamento: 'NOVOS', label: 'Vendedor', sub: 'Novos' },
    { perfil: 'VENDEDOR', departamento: 'SEMINOVOS', label: 'Vendedor', sub: 'Seminovos' },
    { perfil: 'GERENTE', departamento: 'NOVOS', label: 'Gerente', sub: 'Novos' },
    { perfil: 'GERENTE', departamento: 'SEMINOVOS', label: 'Gerente', sub: 'Seminovos' },
    { perfil: 'ANALISTA', departamento: 'TODOS', label: 'Analista', sub: '' },
    { perfil: 'RH', departamento: 'TODOS', label: 'RH', sub: '' },
    { perfil: 'DIRETOR_NOVOS', departamento: 'TODOS', label: 'Diretor', sub: 'Novos' },
    { perfil: 'DIRETOR_SEMINOVOS', departamento: 'TODOS', label: 'Diretor', sub: 'Seminovos' }
  ];

  function cellKey(moduloId, perfil, departamento) {
    return moduloId + '|' + perfil + '|' + departamento;
  }

  function columnLabel(perfil, departamento) {
    var col = COLUMNS.filter(function (c) { return c.perfil === perfil && c.departamento === departamento; })[0];
    if (!col) return perfil + ' — ' + departamento;
    return col.sub ? (col.label + ' — ' + col.sub) : col.label;
  }

  function moduleLabel(moduloId) {
    return MODULE_LABELS[moduloId] || moduloId;
  }

  function availabilityFor(moduloId) {
    return AVAILABILITY[moduloId] || { state: 'AVAILABLE', label: 'Disponível no Portal V2' };
  }

  // Builds the baseline (snapshot + editable local copy) from a valid
  // master_listar_permissoes_modulos() payload. Ordered subset only --
  // MODULE_ORDER filters to the modules actually present in the real
  // catalog response, never invents an entry the backend didn't send.
  function buildMatrixState(payload) {
    var modulosRaw = payload.modulos || [];
    var modules = MODULE_ORDER
      .map(function (id) { return modulosRaw.filter(function (m) { return m.id === id; })[0]; })
      .filter(Boolean);

    var snapshot = {};
    var updatedAt = {};
    (payload.permissoes || []).forEach(function (p) {
      var k = cellKey(p.modulo_id, p.perfil, p.departamento);
      snapshot[k] = !!p.permitido;
      updatedAt[k] = p.atualizado_em || null;
    });

    return {
      modules: modules,
      serverSnapshot: snapshot,
      serverUpdatedAt: updatedAt,
      localPermissions: Object.assign({}, snapshot)
    };
  }

  // Gate 12: dirty = true iff at least one local cell diverges from the
  // last-loaded server snapshot. Reverting a cell to its original value
  // removes it from dirty consideration automatically (no separate
  // "touched" bookkeeping needed).
  function isDirty(localPermissions, serverSnapshot) {
    return Object.keys(localPermissions).some(function (k) {
      return localPermissions[k] !== serverSnapshot[k];
    });
  }

  // Gate 15: exact delta rows, in the exact shape the real RPC
  // requires -- nothing else. No actor/user/store/CPF/email field ever
  // included (there is nothing here to include -- this file never sees
  // any of those).
  function buildDelta(localPermissions, serverSnapshot, serverUpdatedAt) {
    var changes = [];
    Object.keys(localPermissions).forEach(function (k) {
      if (localPermissions[k] === serverSnapshot[k]) return;
      var parts = k.split('|');
      changes.push({
        modulo_id: parts[0],
        perfil: parts[1],
        departamento: parts[2],
        permitido: localPermissions[k],
        atualizado_em_esperado: serverUpdatedAt[k] || null
      });
    });
    return changes;
  }

  // Gate 14: human-readable confirmation summary generated FROM THE
  // DELTA ONLY -- never the full 56-cell matrix, even when only one
  // cell changed.
  function formatConfirmSummary(delta) {
    return delta.map(function (c) {
      var from = c.permitido ? 'Sem acesso' : 'Permitido';
      var to = c.permitido ? 'Permitido' : 'Sem acesso';
      return {
        moduleLabel: moduleLabel(c.modulo_id),
        columnLabel: columnLabel(c.perfil, c.departamento),
        from: from,
        to: to,
        granted: c.permitido
      };
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  // Same shape as formatConfirmSummary, rendered to markup (mirrors V1's
  // own amBuildConfirmSummaryHtml grouping-by-column idea, adapted to
  // V2's confirm-dialog markup). All inputs are our own static
  // MODULE_LABELS/COLUMNS strings, never user input.
  function buildConfirmSummaryHtml(delta) {
    var items = formatConfirmSummary(delta);
    return items.map(function (it) {
      return '<div class="mamConfirmItem ' + (it.granted ? 'mamConfirmGood' : 'mamConfirmBad') + '">' +
        '<b>' + escHtml(it.moduleLabel) + '</b> · ' + escHtml(it.columnLabel) +
        '<br>' + escHtml(it.from) + ' → ' + escHtml(it.to) +
        '</div>';
    }).join('');
  }

  window.NX_MASTER_ACESSOS_VIEW_MODEL = {
    MODULE_ORDER: MODULE_ORDER,
    MODULE_LABELS: MODULE_LABELS,
    COLUMNS: COLUMNS,
    cellKey: cellKey,
    columnLabel: columnLabel,
    moduleLabel: moduleLabel,
    availabilityFor: availabilityFor,
    buildMatrixState: buildMatrixState,
    isDirty: isDirty,
    buildDelta: buildDelta,
    formatConfirmSummary: formatConfirmSummary,
    buildConfirmSummaryHtml: buildConfirmSummaryHtml
  };
})();
