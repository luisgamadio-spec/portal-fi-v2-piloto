/* PORTAL-NEXT V2 -- Painel Master / Auditoria view-model (Painel Master
   Phase PM-4B).

   PRESENTATION ONLY -- masking, date formatting, status label. No
   business logic: this file classifies nothing, resolves nothing,
   never mutates. Field-by-field authority: docs/MASTER-USERS-RPC-
   CONTRACT-CAPTURE.md's sibling capture for master_admin_security_data
   plus this Phase's own direct pg_get_functiondef read (real fields:
   id, tipo, descricao, base_origem, loja, vendedor, cpf, resolvido,
   resolvido_por, resolvido_em, criado_em).

   `resolvido_por` (a raw actor UUID) is real in the RPC response but
   deliberately NOT surfaced here -- the real V1 Auditoria detail view
   (portal-app.js abrirDetalheAuditoria) never renders it either. This
   file preserves that exact precedent rather than inventing a new
   field V1 itself chose not to show.

   CPF masking (Gate 9/Phase PM-4B forensics): V1's own Auditoria detail
   view uses maskCpfFicha() -- first 3 digits visible, rest masked
   ("299.***.***-**") -- a DIFFERENT shape than master-users-view-
   model.js's own maskCpf() (last 2 digits visible, "***.***.**02").
   This file mirrors maskCpfFicha()'s exact algorithm deliberately, not
   the Usuários one -- this is the real V1 masking behavior for THIS
   surface, confirmed by direct source read, not a reused convention. */
(function () {
  'use strict';

  // Byte-identical algorithm to portal-app.js's own maskCpfFicha()
  // (ia-reconciliation-v2-local), including its short-input fallback
  // (a CPF with fewer than 4 digits is returned as-is, unmasked -- a
  // real V1 edge case preserved verbatim, not "improved").
  function maskCpfAuditoria(cpf) {
    var s = String(cpf || '').replace(/\D/g, '');
    if (s.length < 4) return s;
    return s.slice(0, 3) + '.***.***-**';
  }

  function formatDateTimeBR(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR');
  }

  // Binary badge, matches V1's own resolvido ? RESOLVIDO : PENDENTE
  // (portal-app.js's `<span class="adminStatus ok/warn">`).
  function resolvidoLabel(resolvido) {
    return resolvido ? 'RESOLVIDO' : 'PENDENTE';
  }

  // No re-sort here on purpose -- the RPC already returns audit ordered
  // `criado_em DESC` server-side (Gate 15: preserve V1's own recent-
  // first semantics, don't silently reinterpret it client-side).
  function buildAuditRow(a) {
    return {
      id: a.id,
      criadoEm: a.criado_em || null,
      criadoEmFormatted: formatDateTimeBR(a.criado_em),
      tipo: a.tipo || '',
      descricao: a.descricao || '',
      cpfMasked: a.cpf ? maskCpfAuditoria(a.cpf) : '—',
      vendedor: a.vendedor || '—',
      loja: a.loja || '—',
      baseOrigem: a.base_origem || '—',
      resolvido: !!a.resolvido,
      resolvidoLabel: resolvidoLabel(a.resolvido),
      resolvidoEm: a.resolvido_em || null,
      resolvidoEmFormatted: a.resolvido_em ? formatDateTimeBR(a.resolvido_em) : null
    };
  }

  function buildAuditViewModel(payload) {
    var rows = (payload.audit || []).map(buildAuditRow);
    return { rows: rows };
  }

  window.NX_MASTER_AUDIT_VIEW_MODEL = {
    buildAuditViewModel: buildAuditViewModel,
    maskCpfAuditoria: maskCpfAuditoria,
    formatDateTimeBR: formatDateTimeBR,
    resolvidoLabel: resolvidoLabel
  };
})();
