/* PORTAL-NEXT V2 -- Painel Master / Mudança de Loja - Vendedores
   view-model (Painel Master Phase PM-5F).

   PRESENTATION LOGIC ONLY -- no RPC transport (assets/js/adapters/
   master-store-change-provider.js owns that), no DOM. Structural
   template: master-periodos-view-model.js (PM-5E).

   Real business object (confirmed live): nome_vendedor/loja_destino/
   data_inicio_destino required; cpf_vendedor/login_vendedor/
   loja_origem/data_inicio_origem/data_fim_origem/observacao/
   departamento_origem/departamento_destino optional; usuario_id is a
   REAL FK resolved server-side by CPF match, never client-supplied.
   There is NO data_fim_destino column -- the destination assignment
   is open-ended by design until a later record's origin picks up
   where it left off. ativo defaults true; in real production data
   ALL existing rows stay ativo=true forever -- old records are NEVER
   deactivated by a newer one (confirmed real V1 code comment). This
   view-model has no "deactivate on supersede" concept anywhere.

   NO canonical store catalog exists server-side (no `lojas` table/
   enum anywhere in this system -- confirmed by full-repo search).
   Origin/destination stores are plain unvalidated `text`. This
   view-model never invents a hard enum for them -- `storeSuggestions`
   below is a soft, non-authoritative suggestion list only (derived
   from already-observed values in the loaded list), the same
   principle V1's own lojasOptions() uses.

   Department fields ARE a real hard-validated enum server-side
   (NOVOS/SEMINOVOS only) -- DEPARTMENT_OPTIONS below reflects that
   real constraint, unlike the free-text store fields.

   STRICT FORWARD-ONLY CHAIN MODEL (Gate 13-19, real and server-
   enforced -- confirmed live by direct RPC-body inspection, not
   inferred from UI copy): findMostRecentForSeller finds the same row
   the real RPC's own lookup would find (by CPF, falling back to exact
   name match, ordered by data_inicio_destino desc); checkChainGuidance
   mirrors the RPC's own validation rules for UX pre-check ONLY -- it
   never blocks submission and is explicitly not authoritative; the
   real RPC re-validates regardless and is documented here as the only
   real gate. The rule set: destination_start must be exactly the day
   after origin_end (no gap/overlap); if a prior record exists, the
   new origin_store must equal the prior record's destination store,
   the new origin_start must not precede the prior record's
   destination_start, the new destination_start must be strictly after
   the prior record's destination_start, and if the prior record has a
   destination department set, the new origin_department (if provided)
   must match it exactly.

   DATE SAFETY: pure "YYYY-MM-DD" string operations throughout, never
   a `Date` object or `.toISOString()` -- addOneDay below is pure
   integer arithmetic on the parsed Y/M/D components via Date.UTC
   ONLY to compute a new UTC day boundary and re-serialize it back to
   a "YYYY-MM-DD" string in the SAME call (never stored/compared as a
   Date object, never a local-timezone-sensitive Date constructor),
   avoiding the calendar-day drift class this project treats as a
   real defect. */
(function () {
  'use strict';

  var DEPARTMENT_OPTIONS = ['NOVOS', 'SEMINOVOS'];

  function fmtDateBR(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '-';
    var m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  // Pure UTC-anchored day arithmetic, immediately re-serialized to a
  // string -- computes "the day after" a "YYYY-MM-DD" string without
  // ever comparing/storing a Date object or touching local timezone.
  function addOneDay(isoDate) {
    var m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    var utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
    var d = new Date(utcMs);
    var yyyy = d.getUTCFullYear();
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function normalizeCpf(cpf) {
    return String(cpf || '').replace(/\D/g, '');
  }

  // Mirrors the real RPC's own lookup precedence: CPF match first,
  // exact (case-insensitive) name match as fallback, ordered by
  // data_inicio_destino desc (most recent chain head wins).
  function findMostRecentForSeller(storeChanges, sellerCpf, sellerName) {
    var cpf = normalizeCpf(sellerCpf);
    var name = String(sellerName || '').trim().toUpperCase();
    var candidates = (storeChanges || []).filter(function (r) {
      if (cpf && normalizeCpf(r.cpf_vendedor) === cpf) return true;
      if (!cpf && name && String(r.nome_vendedor || '').trim().toUpperCase() === name) return true;
      return false;
    });
    if (!candidates.length) return null;
    return candidates.slice().sort(function (a, b) {
      return a.data_inicio_destino < b.data_inicio_destino ? 1 : (a.data_inicio_destino > b.data_inicio_destino ? -1 : 0);
    })[0];
  }

  // UX-only pre-check mirroring the real RPC's chain-validation rules.
  // Returns an array of guidance strings (empty = no issue detected).
  // NEVER authoritative -- the real RPC re-validates every one of
  // these server-side regardless of what this returns.
  function checkChainGuidance(fields, priorRecord) {
    var issues = [];
    if (fields.dataFimOrigem && fields.dataInicioDestino) {
      var expected = addOneDay(fields.dataFimOrigem);
      if (fields.dataInicioDestino !== expected) {
        issues.push('A data de início do destino deve ser exatamente o dia seguinte ao fim da origem (' + fmtDateBR(expected) + '), sem lacuna nem sobreposição.');
      }
    }
    if (priorRecord) {
      if (fields.lojaOrigem && String(fields.lojaOrigem).toUpperCase() !== String(priorRecord.loja_destino || '').toUpperCase()) {
        issues.push('Este vendedor já tem uma transferência ativa mais recente com destino "' + priorRecord.loja_destino + '" — a loja de origem informada deve ser igual a essa.');
      }
      if (fields.dataInicioOrigem && priorRecord.data_inicio_destino && fields.dataInicioOrigem < priorRecord.data_inicio_destino) {
        issues.push('A origem não pode começar antes de ' + fmtDateBR(priorRecord.data_inicio_destino) + ' (quando a transferência ativa mais recente deste vendedor entrou em vigor).');
      }
      if (fields.dataInicioDestino && priorRecord.data_inicio_destino && fields.dataInicioDestino <= priorRecord.data_inicio_destino) {
        issues.push('O destino desta transferência deve começar depois de ' + fmtDateBR(priorRecord.data_inicio_destino) + '.');
      }
      if (priorRecord.departamento_destino && fields.departamentoOrigem
        && String(fields.departamentoOrigem).toUpperCase() !== String(priorRecord.departamento_destino).toUpperCase()) {
        issues.push('O departamento de origem deve ser igual ao departamento de destino da transferência ativa mais recente ("' + priorRecord.departamento_destino + '").');
      }
    }
    return issues;
  }

  // Soft, non-authoritative suggestion list only -- there is no real
  // store catalog server-side (see file header).
  function storeSuggestions(storeChanges) {
    var set = {};
    (storeChanges || []).forEach(function (r) {
      if (r.loja_origem) set[r.loja_origem] = true;
      if (r.loja_destino) set[r.loja_destino] = true;
    });
    return Object.keys(set).sort();
  }

  function sortByDestStartDesc(storeChanges) {
    return (storeChanges || []).slice().sort(function (a, b) {
      return a.data_inicio_destino < b.data_inicio_destino ? 1 : (a.data_inicio_destino > b.data_inicio_destino ? -1 : 0);
    });
  }

  window.NX_MASTER_STORE_CHANGE_VM = {
    DEPARTMENT_OPTIONS: DEPARTMENT_OPTIONS,
    fmtDateBR: fmtDateBR,
    addOneDay: addOneDay,
    findMostRecentForSeller: findMostRecentForSeller,
    checkChainGuidance: checkChainGuidance,
    storeSuggestions: storeSuggestions,
    sortByDestStartDesc: sortByDestStartDesc
  };
})();
