/* PORTAL-NEXT V2 -- Painel Master / Utilização dos Simuladores
   view-model (Painel Master Phase PM-5H).

   PRESENTATION LOGIC ONLY -- no RPC transport (assets/js/adapters/
   master-simulator-usage-provider.js owns that), no DOM.

   Real business object (confirmed live via information_schema.columns
   + full read of the 4 real writer RPCs, not assumed): each row
   `master_simulator_usage_data` returns is a SERVER-SIDE AGGREGATE
   over `portal_module_sessions` per (usuario_id, module_id) for the
   requested period -- sessions (COUNT of session rows), simulation_
   count (SUM of a per-session counter incremented once per real
   `portal_telemetry_simulation` call -- confirmed NO server-side
   dedup exists for that RPC; a genuine client-side double-fire would
   double-count, and the emitting client code lives in the external
   simulator deployments, not in this repo, so this cannot be verified
   further), active_seconds (SUM of heartbeat-clamped deltas, each
   capped at 60s and zeroed if the gap since the last heartbeat
   exceeded 5 minutes -- confirmed live, not a naive end-start
   subtraction), active_days (server-computed
   `count(distinct (started_at at time zone 'America/Sao_Paulo')::date)`
   -- valid ONLY at the (user × module) grain returned by the RPC;
   summing it across users or across modules would double-count a
   calendar day two people (or one person on two modules) both used --
   this view-model never does that, mirroring the real V1 comment
   verbatim).

   IDENTITY (Gate 9): `usuario_id` is the real join key; `nome` is
   joined LIVE from the CURRENT `usuarios` row (so a renamed user's
   past sessions display under their new name), while
   loja_relatorio/perfil_relatorio/departamento_relatorio are SNAPSHOTS
   taken at `portal_telemetry_start_session` time (confirmed live in
   that RPC's own INSERT) and never re-resolved -- NOT temporally
   resolved via resolve_store_temporal, unrelated to the Mudança de
   Loja mechanism despite both being "temporal-looking" concepts. If a
   `usuarios` row were ever hard-deleted (no such path found anywhere
   in this system across every phase audited so far -- soft `ativo`
   flag only), that user's historical sessions would silently
   disappear from every report here (INNER JOIN, confirmed live) --
   documented, not fixed, since no such path exists to test against.

   REAL DATA-QUALITY FACTS confirmed live via non-sensitive aggregate
   read (not asserted from a hunch): of 1171 real sessions, 529 (45%)
   have no `ended_at` at all -- there is NO background sweep that
   force-closes abandoned sessions; the 8-hour timeout close only
   fires lazily, INSIDE a later heartbeat call that never arrives once
   a tab is truly abandoned. This view-model must never present an
   "sessions currently open" style metric from `ended_at IS NULL`, since
   that count is dominated by stale/abandoned rows, not live activity.
   Also: 586/1171 sessions (50%) have `simulation_count = 0` -- opening
   a simulator is not the same as running a simulation, confirmed real,
   not assumed.

   DATE SAFETY (Gate 11/13, same discipline as every sibling view-
   model, extended here to real timezone-aware boundary math): the
   real backend computes "today" and day-boundaries in fixed UTC-3
   (America/Sao_Paulo has had no DST since 2019) -- this view-model
   mirrors that EXACTLY via pure arithmetic on a UTC-epoch offset,
   never a bare `new Date()`/`.toISOString()` local-timezone call,
   avoiding the calendar-day drift class this project treats as a real
   defect (the Score UTC boundary debt, explicitly NOT fixed here,
   named only for contrast). */
(function () {
  'use strict';

  var MODULES = [
    { id: 'simuladorCompleto', label: 'Simulador de Novos' },
    { id: 'simuladorSeminovos', label: 'Simulador de Seminovos' }
  ];

  // Fixed UTC-3 offset (America/Sao_Paulo, no DST since 2019) -- pure
  // arithmetic, mirrors the real RPC's own timezone handling exactly.
  function todaySP() {
    var nowMs = Date.now() - 3 * 3600 * 1000;
    return new Date(nowMs).toISOString().slice(0, 10);
  }
  function addDaysYmd(ymd, days) {
    var d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function startOfMonthYmd(ymd) { return ymd.slice(0, 7) + '-01'; }
  function previousMonthStartYmd(ymd) {
    var parts = ymd.split('-').map(Number);
    var y = parts[0], m = parts[1];
    var py = m === 1 ? y - 1 : y;
    var pm = m === 1 ? 12 : m - 1;
    return py + '-' + String(pm).padStart(2, '0') + '-01';
  }
  function previousMonthEndYmd(ymd) {
    return addDaysYmd(startOfMonthYmd(ymd), -1);
  }
  function startOfDayIso(ymd) { return ymd + 'T00:00:00-03:00'; }
  function endOfDayIso(ymd) { return ymd + 'T23:59:59.999-03:00'; }

  function fmtDateTimeBR(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return '—'; }
  }
  function fmtDateBR(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (e) { return '—'; }
  }

  function applyPreset(preset, telemetryStartedAtIso) {
    var hoje = todaySP();
    var dtIni = hoje, dtFim = hoje;
    if (preset === 'hoje') { dtIni = hoje; dtFim = hoje; }
    else if (preset === '7d') { dtIni = addDaysYmd(hoje, -6); dtFim = hoje; }
    else if (preset === '30d') { dtIni = addDaysYmd(hoje, -29); dtFim = hoje; }
    else if (preset === 'mesAtual') { dtIni = startOfMonthYmd(hoje); dtFim = hoje; }
    else if (preset === 'mesAnterior') { dtIni = previousMonthStartYmd(hoje); dtFim = previousMonthEndYmd(hoje); }
    else if (preset === 'desdeInicio') { dtIni = (telemetryStartedAtIso || '2020-01-01T00:00:00-03:00').slice(0, 10); dtFim = hoje; }
    return { dtIni: dtIni, dtFim: dtFim };
  }

  function fmtDuration(totalSeconds) {
    var s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (s === 0) return '0min';
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    if (h > 0) return m > 0 ? (h + 'h ' + String(m).padStart(2, '0') + 'min') : (h + 'h');
    return m + 'min';
  }
  function fmtAvgDuration(totalSeconds, count) {
    if (!count) return '—';
    return fmtDuration(Number(totalSeconds || 0) / count);
  }

  function filterRows(linhas, filtros) {
    var busca = String((filtros && filtros.busca) || '').toUpperCase();
    return (linhas || []).filter(function (l) {
      if (filtros.loja && String(l.loja_relatorio || '').toUpperCase() !== filtros.loja) return false;
      if (filtros.departamento && String(l.departamento_relatorio || '').toUpperCase() !== filtros.departamento) return false;
      if (filtros.modulo && l.module_id !== filtros.modulo) return false;
      if (filtros.perfil && String(l.perfil_relatorio || '').toUpperCase() !== filtros.perfil) return false;
      if (busca) {
        var hay = String([l.nome, l.loja_relatorio, l.perfil_relatorio].join(' ')).toUpperCase();
        if (hay.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function globalKpis(linhas) {
    var usuarios = {};
    var sessions = 0, simulations = 0, activeSeconds = 0;
    (linhas || []).forEach(function (l) {
      usuarios[l.usuario_id] = true;
      sessions += Number(l.sessions) || 0;
      simulations += Number(l.simulation_count) || 0;
      activeSeconds += Number(l.active_seconds) || 0;
    });
    return { usuarios: Object.keys(usuarios).length, sessions: sessions, simulations: simulations, activeSeconds: activeSeconds };
  }

  function byModule(linhas) {
    return MODULES.map(function (m) {
      var rows = (linhas || []).filter(function (l) { return l.module_id === m.id; });
      var usuarios = {};
      rows.forEach(function (l) { usuarios[l.usuario_id] = true; });
      return {
        id: m.id, label: m.label,
        usuarios: Object.keys(usuarios).length,
        sessions: rows.reduce(function (a, l) { return a + (Number(l.sessions) || 0); }, 0),
        simulations: rows.reduce(function (a, l) { return a + (Number(l.simulation_count) || 0); }, 0),
        activeSeconds: rows.reduce(function (a, l) { return a + (Number(l.active_seconds) || 0); }, 0)
      };
    });
  }

  function groupByUser(linhas) {
    var map = {};
    var order = [];
    (linhas || []).forEach(function (l) {
      if (!map[l.usuario_id]) { map[l.usuario_id] = { usuario_id: l.usuario_id, nome: l.nome, porModulo: {} }; order.push(l.usuario_id); }
      map[l.usuario_id].porModulo[l.module_id] = l;
    });
    return order.map(function (id) {
      var u = map[id];
      var rows = Object.keys(u.porModulo).map(function (k) { return u.porModulo[k]; });
      var snapshot = rows.reduce(function (a, b) { return (!a || String(b.last_use || '') > String(a.last_use || '')) ? b : a; }, null);
      var novos = u.porModulo.simuladorCompleto;
      var semi = u.porModulo.simuladorSeminovos;
      return {
        usuario_id: u.usuario_id,
        nome: u.nome,
        loja: snapshot ? snapshot.loja_relatorio : '',
        perfil: snapshot ? snapshot.perfil_relatorio : '',
        departamento: snapshot ? snapshot.departamento_relatorio : '',
        acessosNovos: (novos && novos.sessions) || 0,
        acessosSeminovos: (semi && semi.sessions) || 0,
        simulacoes: rows.reduce(function (a, r) { return a + (Number(r.simulation_count) || 0); }, 0),
        tempoAtivo: rows.reduce(function (a, r) { return a + (Number(r.active_seconds) || 0); }, 0),
        primeiroUso: rows.reduce(function (a, r) { return (!a || String(r.first_use || '') < String(a)) ? r.first_use : a; }, null),
        ultimoUso: rows.reduce(function (a, r) { return (!a || String(r.last_use || '') > String(a)) ? r.last_use : a; }, null),
        porModulo: u.porModulo
      };
    });
  }

  function sortUsers(lista, criterio) {
    var arr = (lista || []).slice();
    if (criterio === 'simulacoes') return arr.sort(function (a, b) { return b.simulacoes - a.simulacoes; });
    if (criterio === 'sessoes') return arr.sort(function (a, b) { return (b.acessosNovos + b.acessosSeminovos) - (a.acessosNovos + a.acessosSeminovos); });
    if (criterio === 'tempo') return arr.sort(function (a, b) { return b.tempoAtivo - a.tempoAtivo; });
    if (criterio === 'nome') return arr.sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); });
    return arr.sort(function (a, b) { return String(b.ultimoUso || '').localeCompare(String(a.ultimoUso || '')); });
  }

  // Pure port of V1's real portalAllowedModules() -- ONLY the branches
  // that ever grant 'simuladorCompleto'/'simuladorSeminovos' (confirmed
  // read directly from assets/js/portal-app.js:1902 at commit 908d028).
  // Uses only `status` string parsing (V2's real master_admin_security_
  // data() rows carry perfil/loja/status/ativo -- no statusGroups array
  // field, so this mirrors V1's own fallback branch, the only one V2's
  // real data shape can support). Single source of truth for THIS
  // eligibility check only -- not a general authorization system.
  function statusHas(status, grupo) {
    var parts = String(status || '').toUpperCase().split('/').map(function (s) { return s.trim(); });
    return parts.indexOf(String(grupo).toUpperCase()) !== -1;
  }
  function simulatorModulesAllowedFor(perfil, status) {
    var tipo = String(perfil || '').toUpperCase();
    if (tipo === 'MASTER') return ['simuladorCompleto', 'simuladorSeminovos'];
    if (tipo === 'ANALISTA') return ['simuladorCompleto', 'simuladorSeminovos'];
    if (tipo === 'DIRETOR NOVOS' || tipo === 'DIRETOR DE NOVOS') return ['simuladorCompleto', 'simuladorSeminovos'];
    if (tipo === 'DIRETOR SEMINOVOS' || tipo === 'DIRETOR DE SEMINOVOS') return ['simuladorCompleto', 'simuladorSeminovos'];
    if (tipo === 'GERENTE' && statusHas(status, 'NOVOS') && statusHas(status, 'SEMINOVOS')) return ['simuladorCompleto', 'simuladorSeminovos'];
    if (tipo === 'GERENTE' && statusHas(status, 'NOVOS')) return ['simuladorCompleto'];
    if (tipo === 'GERENTE' && statusHas(status, 'SEMINOVOS')) return ['simuladorSeminovos'];
    if (tipo === 'VENDEDOR' && statusHas(status, 'NOVOS')) return ['simuladorCompleto'];
    if (tipo === 'VENDEDOR' && statusHas(status, 'SEMINOVOS')) return ['simuladorSeminovos'];
    return [];
  }

  // `usuarios` here is master_admin_security_data().users (already
  // loaded elsewhere in this shell, no new RPC); `linhasLifetime` is
  // the RPC result for the full telemetry lifetime (desde o início).
  function neverUsed(usuarios, linhasLifetime) {
    var usados = {};
    (linhasLifetime || []).forEach(function (l) { usados[l.usuario_id + '|' + l.module_id] = true; });
    var out = [];
    (usuarios || []).filter(function (u) { return u.ativo; }).forEach(function (u) {
      simulatorModulesAllowedFor(u.perfil, u.status).forEach(function (m) {
        if (!usados[u.id + '|' + m]) out.push({ usuario_id: u.id, nome: u.nome, loja: u.loja, perfil: u.perfil, module_id: m });
      });
    });
    return out;
  }

  function xlsxRows(usersSorted) {
    return usersSorted.map(function (u) {
      return {
        'Nome': u.nome, 'Loja': u.loja, 'Departamento': u.departamento, 'Perfil': u.perfil,
        'Sessões Novos': u.acessosNovos, 'Sessões Seminovos': u.acessosSeminovos,
        'Simulações': u.simulacoes, 'Tempo ativo (min)': Math.round((u.tempoAtivo || 0) / 60),
        'Primeiro uso': fmtDateBR(u.primeiroUso), 'Último uso': fmtDateTimeBR(u.ultimoUso)
      };
    });
  }

  window.NX_MASTER_SIMULATOR_USAGE_VM = {
    MODULES: MODULES,
    todaySP: todaySP,
    applyPreset: applyPreset,
    startOfDayIso: startOfDayIso,
    endOfDayIso: endOfDayIso,
    fmtDateTimeBR: fmtDateTimeBR,
    fmtDateBR: fmtDateBR,
    fmtDuration: fmtDuration,
    fmtAvgDuration: fmtAvgDuration,
    filterRows: filterRows,
    globalKpis: globalKpis,
    byModule: byModule,
    groupByUser: groupByUser,
    sortUsers: sortUsers,
    simulatorModulesAllowedFor: simulatorModulesAllowedFor,
    neverUsed: neverUsed,
    xlsxRows: xlsxRows
  };
})();
