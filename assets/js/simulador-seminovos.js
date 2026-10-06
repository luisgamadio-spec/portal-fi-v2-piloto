/* PORTAL-NEXT V2 — Simulador Seminovos page (PORTAL-NEXT-08.1, aligned
   PORTAL-NEXT-08.4). Consumes the frozen PORTAL-NEXT-08 engines
   exclusively (window.NX_SIMULADOR_SEMINOVOS_ADAPTER /
   NX_SIMULADOR_SHARED / NX_CASH_CONVERSION_ADAPTER). Zero business
   math is duplicated here.

   PORTAL-NEXT-08.4 Gate 5-8/21/22/34 — navigation scope, re-audited
   against real production (git show origin/main:modules/
   simulador-seminovos.html): the top-level menu
   (.premium-menu-grid-v2) contains exactly 5 reachable buttons —
   openLinear, openBalaoSafra, openDescobridorTaxa, openAntecipacao,
   openCashConversion. Three features this page previously exposed are
   NOT reachable in production, confirmed by the same standard already
   used for the pre-existing dead top-level Linear tab/Taxas
   Subsidiadas (Gate 33 of docs/SIMULATOR-ENGINE-DISCOVERY-08.md):
     - Semestral/Anual (#periodico): full real markup exists inside
       the reachable simulatorScreen, but its only <div class="tabs">
       contains ONE button (data-tab="tradicional") -- no tab ever
       activates #periodico.
     - Financiamento Campanha/Coparticipado (#campaignScreen): the
       screen exists, but its entry button id="openFinanciamentoCampanha"
       does not exist anywhere in the HTML (same silent-no-op guard
       pattern, `if(openCampaign) openCampaign.addEventListener(...)`).
     - Semestral Triton (#semestralCopartScreen): same -- entry button
       id="openSemestralCopart" does not exist.
   Human decision (this Wave): match production exactly. All three
   removed from this page. calcularPeriodico/calcularSemestralTriton
   remain in the adapter (Gate 3 completeness, correct formulas) but
   are deliberately not called by this page -- same treatment already
   established for calcularLinear/calcularSubsidiadas.
   The reachable "Linear" experience is exclusively the nested
   RATE_TABLE engine (calcularLinearRateTable), labeled "Linear" here
   to match production's own "FINANCIAMENTO LINEAR" menu card. */
(function () {
  'use strict';

  var UI = window.NX_SIM_UI;
  var S = window.NX_SIMULADOR_SHARED;
  var SN = window.NX_SIMULADOR_SEMINOVOS_ADAPTER;
  var CC = window.NX_CASH_CONVERSION_ADAPTER;
  var RATES = window.NX_SIMULADOR_RATES_PROVIDER;

  /* ---------- SIMLIVE1 (migrate simulator live rate authorities) ----------
     Independent copy of simulador-novos.js's own makeAuthority()/
     wireAuthorityGate() helpers -- same reasoning this file already
     gives for every other "independent copy, mirroring Novos' pattern"
     change (e.g. the balloon-story/mode-nav helpers above): this file's
     own established convention is to duplicate small, page-scoped
     helpers rather than share a cross-file module for them, so a
     Seminovos-only change never risks Novos' already-verified behavior
     and vice versa. See simulador-novos.js for the full reasoning
     comment (AUTH_NOT_CONFIGURED fallback, fail-closed on a genuine
     configured-backend failure, etc.) -- not re-derived here. */
  function makeAuthority(rpcName, camposNumericos, camposTexto, transform, fallbackAuthority) {
    var state = 'IDLE'; // IDLE | LOADING | READY | ERROR
    var authority = null;
    var loadPromise = null;
    function ensure() {
      if (state === 'READY' && authority) return Promise.resolve(authority);
      if (loadPromise) return loadPromise;
      if (fallbackAuthority && (!window.NX_AUTH || !window.NX_AUTH.isAuthConfigured)) {
        authority = fallbackAuthority;
        state = 'READY';
        return Promise.resolve(authority);
      }
      state = 'LOADING';
      loadPromise = RATES.loadRateAuthority(rpcName, function (linhas) {
        return RATES.linhasValidas(linhas, camposNumericos, camposTexto);
      }, {}).then(function (body) {
        var built = transform(body.linhas);
        if (!built) return Promise.reject({ state: 'BACKEND_ERROR', message: 'Base de taxas retornou sem dados utilizáveis.' });
        authority = built;
        state = 'READY';
        return authority;
      }).catch(function (err) {
        authority = null;
        state = 'ERROR';
        return Promise.reject(err);
      }).finally(function () {
        loadPromise = null;
      });
      return loadPromise;
    }
    return {
      ensure: ensure,
      getState: function () { return state; },
      getAuthority: function () { return authority; }
    };
  }
  var RATE_FAIL_MSG = 'Não foi possível carregar as condições vigentes do simulador. Tente novamente.';

  // BALAO_SEMINOVOS (Tradicional).
  var tradAuthority = makeAuthority('simulador_get_balao_seminovos', ['entrada_minima', 'prazo', 'max_balao', 'taxa'], ['bloco'], function (linhas) {
    var t = linhas.map(function (x) { return { faixa: x.bloco, entrada: x.entrada_minima, prazo: x.prazo, max: x.max_balao, taxa: x.taxa }; });
    return t.length ? t : null;
  }, SN._internal.tabelaTradicional_FALLBACK);
  // FINANCIAMENTO_SEMINOVO ("Linear" / RATE_TABLE) -- reshapes rows
  // {faixa_ano, entrada_pct, prazo, taxa} into the SAME
  // {faixa_ano:{entryBandPct:{prazo:taxa}}} nesting V1's own
  // carregarBaseFinanciamentoSeminovo() builds before injecting into
  // the nested srcdoc iframe's RATE_TABLE (modules/simulador-
  // seminovos.html) -- calcularLinearRateTable() consumes the exact
  // same shape via params.rateTable.
  var linearRTAuthority = makeAuthority('simulador_get_financiamento_seminovo', ['entrada_pct', 'prazo', 'taxa'], ['faixa_ano'], function (linhas) {
    var tabela = {};
    linhas.forEach(function (x) {
      var eBand = String(Math.round(x.entrada_pct * 100));
      if (!tabela[x.faixa_ano]) tabela[x.faixa_ano] = {};
      if (!tabela[x.faixa_ano][eBand]) tabela[x.faixa_ano][eBand] = {};
      tabela[x.faixa_ano][eBand][String(x.prazo)] = x.taxa;
    });
    return Object.keys(tabela).length ? tabela : null;
  }, SN._internal.RATE_TABLE);
  // ANTECIPACAO -- same RPC as Novos ("Base COMPARTILHADA com o
  // Simulador ZeroKM"), reused via the same shared provider, but with
  // an INDEPENDENT authority/cache instance in this file (each page
  // fetches its own copy of the same real data once per session --
  // see this file's own header note on why cross-file state is never
  // shared here). No correctness impact: both instances call the same
  // real, authenticated RPC and fail closed identically.
  var antecipacaoAuthority = makeAuthority('simulador_get_antecipacao', ['meses_antecipacao', 'desconto'], [], function (linhas) {
    var mapa = {};
    linhas.forEach(function (x) { mapa[String(x.meses_antecipacao)] = x.desconto; });
    return Object.keys(mapa).length ? mapa : null;
  }, SN._internal.tabelaAntecipacao_FALLBACK);

  function authorityGateHtml(authority) {
    if (authority.getState() === 'ERROR') {
      return UI.errorBlock(RATE_FAIL_MSG) +
        '<button type="button" class="btn btn-secondary" id="sRateRetry" style="width:100%;margin-top:6px">Tentar novamente</button>';
    }
    return UI.emptyBlock('Carregando condições vigentes do simulador...');
  }
  function wireAuthorityGate(authority, mode) {
    function refresh() { if (currentMode === mode) renderModeArea(); }
    if (authority.getState() === 'ERROR') {
      var retryBtn = document.getElementById('sRateRetry');
      if (retryBtn) retryBtn.addEventListener('click', function () { authority.ensure().then(refresh, refresh); });
      return false;
    }
    if (authority.getState() !== 'READY') {
      authority.ensure().then(refresh, refresh);
      return false;
    }
    return true;
  }

  var MODES = [
    { id: 'tradicional', group: 'Financiamento', label: 'Tradicional (Balão)' },
    { id: 'ratetable', group: 'Financiamento', label: 'Linear' },
    { id: 'descobridor', group: 'Ferramentas', label: 'Descobridor de Taxa' },
    { id: 'antecipacao', group: 'Ferramentas', label: 'Antecipação de Parcelas' },
    { id: 'cashconversion', group: 'Ferramentas', label: 'Cash Conversion' }
  ];
  var MODE_DESC = {
    tradicional: 'Financiamento tradicional com balão opcional — a taxa depende do ano do veículo e da entrada.',
    ratetable: 'Condições próprias por ano do veículo e faixa de entrada — inclui prazo de 50x.',
    descobridor: 'Estima a taxa efetiva a partir do valor financiado, prazo e parcela.',
    antecipacao: 'Calcula o valor com desconto para antecipação de parcelas.',
    cashconversion: 'Compara o custo do financiamento com o rendimento de manter o capital aplicado.'
  };
  var TRAD_TERMS = [12, 24, 30, 36, 40, 42, 48];

  var ERROR_MSG = {
    ENTRADA_MINIMA_10PCT: 'A entrada mínima permitida para este plano é de 10%.',
    ENTRADA_MAIOR_QUE_BEM: 'A entrada deve ser menor que o valor do bem.',
    SEM_REGRA_CADASTRADA: 'Prazo sem regra cadastrada na tabela para a faixa de ano e entrada informada.',
    ANO_AUSENTE: 'Digite o ano do veículo para identificar a tabela correta.',
    BALAO_FORA_DO_PRAZO: 'Existe balão fora do prazo. Use parcelas entre 1 e o prazo escolhido.',
    BALAO_DUPLICADO: 'Não é permitido inserir dois balões na mesma parcela.',
    BALAO_VALOR_INVALIDO: 'Informe valor válido para todos os balões.',
    BALOES_ACIMA_DO_LIMITE: 'A soma dos balões ultrapassa o valor máximo permitido, calculado sobre o valor financiado.',
    BALOES_ALTOS_DEMAIS: 'Os balões escolhidos são altos demais para gerar uma parcela mensal válida.',
    BEM_INVALIDO: 'Informe um Valor do Bem válido.',
    PRAZO_INVALIDO: 'Informe um prazo válido entre 1 e 60 meses.',
    PARCELA_INVALIDA: 'Informe uma parcela maior que zero.',
    FINANCIADO_INVALIDO: 'O valor financiado precisa ser maior que zero.',
    PARCELA_INCOMPATIVEL: 'Parcela incompatível com os dados informados. Revise os valores.',
    PRIMEIRA_PARCELA_AUSENTE: 'Informe a data da primeira parcela.',
    DATA_AUSENTE: 'Informe a data desejada para antecipação.',
    INTERVALO_INVALIDO: 'Informe um intervalo válido de parcelas.',
    PARCELA_INVALIDA_INTERVALO: 'Informe uma parcela válida dentro do prazo.',
    NENHUMA_PARCELA_FUTURA: 'Nenhuma parcela futura encontrada. Revise a data de antecipação.'
  };
  function errMsg(code) { return ERROR_MSG[code] || 'Dados inválidos para este cálculo.'; }

  var currentMode = MODES[0].id;
  // BALAO-LIMIT-1: canonical max balloon count for Seminovos, recovered
  // from the live Secure source (modules/simulador-seminovos.html #tQtd
  // select, "Escolha até 2 balões. O limite e a taxa são identificados
  // pela nova tabela de seminovos." -- a proven, documented divergence
  // from Novos' 4, not a guess; Human-confirmed BALAO-LIMIT-1 Wave).
  var MAX_BALOES = 2;
  var balloons = [];
  // ANTECIPACAO-BALAO-1: restores Secure parity for the Antecipação
  // simulator's OWN, separate balloon feature (modules/simulador-
  // seminovos.html #aTemBalao/#aQtdBaloes, "Limite máximo: 8 balões.")
  // -- NOT the same rule/state as the Tradicional plan's MAX_BALOES
  // above (proven, not assumed: Secure's own antecipação screen caps
  // at 8, shared identically with Novos, unrelated to the regular
  // financing max of 4/2). The extracted calcularAntecipacao() engine
  // (assets/js/adapters/simulador-seminovos.adapter.js) already fully
  // implements balloon handling byte-for-byte matching Secure's own
  // calcAntecipacao() -- this Wave restores only the missing UI/state
  // bridge, never touches the engine.
  var ANT_BALAO_MAX = 8;
  var antBaloes = []; // {mes, valor} for Antecipação
  // SIM-NAV-4 / Concept F.2 (Human-approved final authority,
  // SIM_NAV_F2_HUMAN_APPROVED) -- which category group is currently
  // expanded; null = all collapsed (the default on every page load).
  // Deliberately separate from currentMode: browsing/opening a
  // category must NEVER change the selected simulator mode -- only an
  // actual option click/Enter does (see the .smModeBtn click handler
  // in wireModeNav() below). Independent copy, mirroring
  // simulador-novos.js's own identical change.
  var openCategory = null;

  /* ---------- Grouped-button mode nav, mirroring Novos' 08.2 pattern
     (approved by human UAT) -- independent copy, Seminovos' own
     smaller MODES list, no Novos file touched.
     SIM-NAV-4: markup refined again to the Human-approved Concept F.2
     look (labs/simuladores-navigation-lab.css, commits 1909bd1/
     8ded4b0/5158925), replacing SIM-NAV-3's Concept E -- mirroring the
     identical change just made in simulador-novos.js. Categories
     collapsed by default; only one open at a time; selecting an
     option auto-collapses it and shows a red+bold current-mode hint
     on its (now collapsed) header. .smModeBtn/.smModeBtnLabel/
     .smModeGroupLabel/data-mode are UNCHANGED from E -- pre-existing
     tests that click '.smModeBtn[data-mode="..."]' or read
     .smModeGroupLabel/.smModeBtn.textContent keep working unmodified;
     only a new clickable .smModeGroupHeader and a .smModeRowsWrap
     animation wrapper were added around the same existing
     elements. ---------- */
  function modeGroups() {
    var groups = {}, order = [];
    MODES.forEach(function (m) {
      if (!groups[m.group]) { groups[m.group] = []; order.push(m.group); }
      groups[m.group].push(m);
    });
    return order.map(function (g) { return { name: g, items: groups[g] }; });
  }
  function modeChevron() {
    return '<svg class="smChevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  // SIM-REG-01: "Falar com um Analista" CTA -- mirrors simulador-
  // novos.js's own identical addition (independent copy, same as
  // every prior change to this file). Lives in .modPageHeader (shared
  // flex/space-between header row, 0 shared CSS change), static
  // markup rendered once by render(), never touched by switchMode()/
  // toggleCategory()'s nav-only re-renders. Action/destination
  // authority lives entirely in window.NX_FI_ATENDIMENTO
  // (fi-atendimento.js).
  function analystCtaHtml(origin) {
    return '<button type="button" class="smAnalystCta" id="smAnalystCtaBtn" data-analyst-origin="' + origin + '">' +
      '<svg class="smAnalystCtaIcon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 3.5h12v7H6.5L3 13.5V10.5H2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      'Falar com um Analista' +
      '</button>';
  }
  function wireAnalystCta() {
    var btn = document.getElementById('smAnalystCtaBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        if (window.NX_FI_ATENDIMENTO) window.NX_FI_ATENDIMENTO.falarComAnalista(btn.getAttribute('data-analyst-origin'));
      });
    }
  }
  // SIM-NAV-4 / F.2 -- which category (group name) owns a given mode
  // id. Used to restore focus to the correct (now-collapsed) header
  // after a selection auto-collapses its panel.
  function groupForMode(mode) {
    var owner = null;
    MODES.forEach(function (m) { if (m.id === mode) owner = m.group; });
    return owner;
  }
  function modeNavHtml() {
    return '<nav class="smModeNav" aria-label="Modalidade de financiamento">' +
      modeGroups().map(function (g) {
        var isOpen = g.name === openCategory;
        var slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
        var panelId = 'smModePanel-' + slug;
        var current = null;
        g.items.forEach(function (m) { if (m.id === currentMode) current = m; });
        // SIM-NAV-4 / F.2: collapsed current-mode hint -- only for the
        // category that actually owns the current mode, never while
        // that same category is open (the expanded row's own active
        // treatment already shows it there; no duplication).
        var hintHtml = (!isOpen && current) ? '<span class="smModeHint">' + UI.esc(current.label) + '</span>' : '';
        return '<div class="smModeGroup' + (isOpen ? ' open' : '') + '">' +
          '<button type="button" class="smModeGroupHeader" data-group="' + UI.esc(g.name) + '" aria-expanded="' + isOpen + '" aria-controls="' + panelId + '">' +
            '<span class="smModeGroupHeaderMain">' +
              '<span class="smModeGroupLabel">' + UI.esc(g.name) + '</span>' +
              hintHtml +
            '</span>' +
            '<svg class="smChevron smModeDisclosure" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="smModeRowsWrap"><div class="smModeRowsInner">' +
          '<div class="smModeButtons" id="' + panelId + '" role="group" aria-label="' + UI.esc(g.name) + '"' + (isOpen ? '' : ' inert') + '>' +
          g.items.map(function (m) {
            var active = m.id === currentMode;
            return '<button type="button" class="smModeBtn' + (active ? ' active' : '') + '" data-mode="' + m.id + '" tabindex="' + (isOpen ? '0' : '-1') + '"' + (active ? ' aria-current="true"' : '') + '>' +
              '<span class="smModeBtnLabel">' + UI.esc(m.label) + '</span>' + modeChevron() +
              '</button>';
          }).join('') +
          '</div></div></div>' +
        '</div>';
      }).join('') +
      '</nav>';
  }
  // SIM-NAV-4 / F.2 -- toggles the open category. Clicking the
  // already-open category collapses back to all-collapsed; clicking a
  // different one closes the previous and opens the new one
  // (single-open). Re-renders ONLY the nav region -- never touches
  // currentMode/balloons/renderModeArea(), so browsing a category
  // never disturbs the in-progress form in the currently selected mode.
  function toggleCategory(groupName) {
    openCategory = (openCategory === groupName) ? null : groupName;
    document.getElementById('smModeNavRegion').innerHTML = modeNavHtml();
    wireModeNav();
    var header = document.querySelector('.smModeGroupHeader[data-group="' + groupName + '"]');
    if (header) header.focus();
  }
  function wireModeNav() {
    document.querySelectorAll('.smModeBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute('data-mode');
        var owner = groupForMode(m);
        // SIM-NAV-4 / F.2: an ACTUAL option selection (this handler
        // only -- never the category-header toggle, hover, or roving
        // keyboard focus below) auto-collapses its panel. switchMode()
        // is the existing, unmodified mode-switch business authority;
        // it already re-renders/rewires the nav region itself, so
        // openCategory is simply reset before calling it -- no
        // duplicate render, no duplicate dispatch.
        openCategory = null;
        switchMode(m);
        // The just-selected row is now inert (its panel collapsed) --
        // focusing it would silently fail and strand keyboard focus.
        // Return focus to the header that now shows this selection's
        // hint instead.
        var header = owner ? document.querySelector('.smModeGroupHeader[data-group="' + owner + '"]') : null;
        if (header) header.focus();
      });
    });
    document.querySelectorAll('.smModeGroupHeader').forEach(function (btn) {
      btn.addEventListener('click', function () { toggleCategory(btn.getAttribute('data-group')); });
    });
    // SIM-NAV-3 / Concept E: roving keyboard nav within each category
    // group, additive to (not replacing) native Tab access and native
    // Enter/Space button activation -- no conflicting keyboard model.
    // A collapsed group is `inert`, so its items are simply
    // unreachable here -- no special-casing needed.
    document.querySelectorAll('.smModeButtons').forEach(function (group) {
      var items = Array.prototype.slice.call(group.querySelectorAll('.smModeBtn'));
      items.forEach(function (item, idx) {
        item.addEventListener('keydown', function (e) {
          var next = null;
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = items[(idx + 1) % items.length];
          else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = items[(idx - 1 + items.length) % items.length];
          else if (e.key === 'Home') next = items[0];
          else if (e.key === 'End') next = items[items.length - 1];
          if (next) { e.preventDefault(); next.focus(); }
        });
      });
    });
    // SIM-NAV-4 / F.2: Left/Right (or Up/Down) roving nav between the
    // category headers themselves. Separate, simple mechanism --
    // headers carry no data-mode, so the generic loop above never
    // touches them, and this loop never touches rows. No conflicting
    // keyboard model.
    var headers = Array.prototype.slice.call(document.querySelectorAll('.smModeGroupHeader'));
    headers.forEach(function (h, idx) {
      h.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = headers[(idx + 1) % headers.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = headers[(idx - 1 + headers.length) % headers.length];
        if (next) { e.preventDefault(); next.focus(); }
      });
    });
  }

  function switchMode(id) {
    currentMode = id;
    balloons = [];
    antBaloes = [];
    document.getElementById('smModeNavRegion').innerHTML = modeNavHtml();
    wireModeNav();
    renderModeArea();
  }

  function renderModeArea() {
    disconnectTermGridObservers();
    document.getElementById('smModeDesc').textContent = MODE_DESC[currentMode] || '';
    document.getElementById('smFormRegion').innerHTML = formHtml(currentMode);
    document.getElementById('smResultRegion').innerHTML = UI.emptyBlock('Preencha os campos e clique em Calcular.');
    wireForm(currentMode);
  }

  /* ---------- Balanced term grid, mirroring Novos' 08.2 pattern
     (approved by human UAT) -- independent copy, pure presentation,
     0 dependency on Novos' file. Only Tradicional (Balão) has a term
     SELECTOR here; Linear/RATE_TABLE shows every term as a RESULT row
     (Gate 9/10), no selector needed. ---------- */
  function balancedColumns(containerWidth, itemMinWidth, n) {
    if (n <= 1) return 1;
    var maxFit = Math.max(1, Math.floor(containerWidth / itemMinWidth));
    var cap = Math.min(maxFit, n);
    if (cap >= n) return n;
    var c;
    for (c = cap; c >= 2; c--) { var rem = n % c; if (rem === 0 || rem >= 2) return c; }
    for (c = cap + 1; c <= n; c++) { var rem2 = n % c; if (rem2 === 0 || rem2 >= 2) return c; }
    return cap;
  }
  function termGridFieldHtml(id, label, terms, activeValue) {
    var buttons = terms.map(function (t) {
      return '<button type="button" data-v="' + t + '" class="' + (String(t) === String(activeValue) ? 'active' : '') + '">' + t + 'x</button>';
    }).join('');
    return '<div class="field"><label id="' + id + 'Label">' + UI.esc(label) + '</label>' +
      '<div class="smTermSelectGrid" id="' + id + '" role="group" aria-labelledby="' + id + 'Label">' + buttons + '</div></div>';
  }
  var termGridObservers = [];
  function wireTermGrid(id, termCount) {
    var container = document.getElementById(id);
    if (!container) return;
    function recompute() {
      var w = container.clientWidth || container.parentElement.clientWidth;
      container.style.setProperty('--term-cols', String(balancedColumns(w, 60, termCount)));
    }
    recompute();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(recompute);
      ro.observe(container);
      termGridObservers.push(ro);
    } else {
      window.addEventListener('resize', recompute);
    }
    container.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        container.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }
  function disconnectTermGridObservers() {
    termGridObservers.forEach(function (ro) { ro.disconnect(); });
    termGridObservers = [];
  }

  // V2_SIMULATOR_INSTALLMENT_GRID_VISUAL_FIX: same shared mechanism as
  // simulador-novos.js's own wireResultTermGrid -- see simuladores-
  // shared.js's UI.wireTermResultGrid for the root-cause explanation.
  function wireResultTermGrid(itemCount) {
    var grid = document.querySelector('#smResultRegion .smTermGrid');
    if (!grid) return;
    var ro = UI.wireTermResultGrid(grid, 110, itemCount);
    if (ro) termGridObservers.push(ro);
  }

  function formHtml(mode) {
    switch (mode) {
      case 'tradicional':
        // SIMLIVE1: gated on tradAuthority (simulador_get_balao_seminovos).
        if (tradAuthority.getState() !== 'READY') return authorityGateHtml(tradAuthority);
        return UI.moneyField('sBem', 'Valor do bem', 'R$ 80.000,00') +
          UI.moneyField('sEntrada', 'Entrada', 'R$ 16.000,00') +
          UI.numberField('sAno', 'Ano do veículo', 2022, { min: 1900, max: 2099, hint: 'Tabelas cadastradas para 2017–2024 e 2025–2099.' }) +
          termGridFieldHtml('sPrazo', 'Prazo', TRAD_TERMS, 24) +
          '<div class="field"><label>Balões</label><div class="smBalloonList" id="sBaloesList"></div>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="sAddBalao">+ Adicionar balão</button>' +
          '<span class="hint" id="sAddBalaoHint" hidden>Máximo de ' + MAX_BALOES + ' balões atingido.</span></div>' +
          '<button type="button" class="btn btn-primary" id="sCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'ratetable':
        // SIMLIVE1: gated on linearRTAuthority (simulador_get_financiamento_seminovo).
        if (linearRTAuthority.getState() !== 'READY') return authorityGateHtml(linearRTAuthority);
        return UI.numberField('sAnoRT', 'Ano do veículo', 2020, { min: 2007, max: 2099, hint: 'Tabela cadastrada para 2007–2099.' }) +
          UI.moneyField('sValorRT', 'Valor do veículo', 'R$ 80.000,00') +
          UI.moneyField('sEntradaRT', 'Entrada', 'R$ 0,00', 'Entrada permitida a partir de 0%.') +
          '<button type="button" class="btn btn-primary" id="sCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'descobridor':
        return UI.moneyField('sFinanciado', 'Valor financiado', 'R$ 70.000,00') +
          UI.numberField('sPrazoNum', 'Prazo (meses)', 36, { min: 1, max: 60 }) +
          UI.moneyField('sParcela', 'Parcela', 'R$ 2.400,00') +
          '<button type="button" class="btn btn-primary" id="sCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'antecipacao':
        // SIMLIVE1: gated on antecipacaoAuthority (simulador_get_antecipacao).
        if (antecipacaoAuthority.getState() !== 'READY') return authorityGateHtml(antecipacaoAuthority);
        return UI.numberField('sPrazoNum', 'Prazo (meses)', 36, { min: 1, max: 60 }) +
          UI.moneyField('sParcela', 'Valor da parcela mensal', 'R$ 1.800,00') +
          UI.dateField('sPrimeira', 'Data da primeira parcela', '') +
          UI.dateField('sData', 'Data desejada para antecipação', '') +
          UI.segmentedField('sTipoAnt', 'O que antecipar', [{ value: 'todo', label: 'Contrato todo' }, { value: 'algumas', label: 'Algumas parcelas' }, { value: 'uma', label: 'Uma parcela' }], 'todo') +
          '<div id="sAntExtra"></div>' +
          UI.segmentedField('sAntTemBalao', 'Existem balões neste financiamento?', [{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }], 'nao') +
          '<div class="field" id="sAntQtdBox" hidden>' + UI.selectField('sAntQtdBaloes', 'Quantidade de balões', antBaloesQtdOptions(), '0') +
          '<span class="hint">Limite máximo: ' + ANT_BALAO_MAX + ' balões.</span></div>' +
          '<div class="smBalloonList" id="sAntBaloesList"></div>' +
          '<button type="button" class="btn btn-primary" id="sCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'cashconversion':
        return UI.moneyField('sCapital', 'Capital', 'R$ 100.000,00') +
          UI.moneyField('sParcelaCC', 'Parcela ofertada', 'R$ 2.500,00') +
          UI.numberField('sPrazoCC', 'Prazo (meses)', 36, { min: 1, max: 60 }) +
          UI.percentField('sTaxaCC', 'Taxa de aplicação mensal (%)', '0,80') +
          '<button type="button" class="btn btn-primary" id="sCalc" style="width:100%;margin-top:6px">Calcular</button>';
      default:
        return '';
    }
  }

  function antExtraHtml(tipo) {
    if (tipo === 'algumas') return UI.numberField('sDe', 'De (parcela nº)', 1, { min: 1 }) + UI.numberField('sAte', 'Até (parcela nº)', 12, { min: 1 });
    if (tipo === 'uma') return UI.numberField('sParcelaUnicaNum', 'Parcela nº', 1, { min: 1 });
    return '';
  }

  function renderBaloesList() {
    var list = document.getElementById('sBaloesList');
    if (!list) return;
    list.innerHTML = balloons.map(function (b, i) {
      return '<div class="smBalloonRow">' +
        '<div class="field"><label>Mês do balão ' + (i + 1) + '</label><input class="input mono" type="number" min="1" data-bidx="' + i + '" data-bfield="mes" value="' + (b.mes || '') + '"></div>' +
        '<div class="field"><label>Valor do balão ' + (i + 1) + '</label><div class="inputAffix"><span class="prefix">R$</span><input class="input mono" inputmode="decimal" autocomplete="off" data-money data-bidx="' + i + '" data-bfield="valor" value="' + (b.valorText || '') + '"></div></div>' +
        '<button type="button" class="btn btn-tertiary btn-sm" data-bremove="' + i + '" aria-label="Remover balão ' + (i + 1) + '">Remover</button>' +
        '</div>';
    }).join('');
    list.querySelectorAll('[data-bidx]').forEach(function (el) {
      el.addEventListener('input', function () {
        var idx = Number(el.getAttribute('data-bidx')), field = el.getAttribute('data-bfield');
        if (field === 'mes') balloons[idx].mes = Number(el.value) || 0;
        else { balloons[idx].valorText = el.value; balloons[idx].valor = S.parseBRL(el.value); }
      });
      el.addEventListener('blur', function () { if (el.getAttribute('data-bfield') === 'valor') el.value = UI.brlDigits(S.parseBRL(el.value)); });
    });
    list.querySelectorAll('[data-bremove]').forEach(function (el) {
      el.addEventListener('click', function () { balloons.splice(Number(el.getAttribute('data-bremove')), 1); renderBaloesList(); });
    });
    // BALAO-LIMIT-1: re-evaluated on every render (add and remove both
    // call renderBaloesList()), so removing below MAX_BALOES immediately
    // re-enables "+ Adicionar balão" again.
    var addBtn = document.getElementById('sAddBalao');
    var addHint = document.getElementById('sAddBalaoHint');
    if (addBtn) {
      var atMax = balloons.length >= MAX_BALOES;
      addBtn.disabled = atMax;
      if (addHint) addHint.hidden = !atMax;
    }
  }

  function antBaloesQtdOptions() {
    var opts = [{ value: '0', label: '0' }];
    for (var i = 1; i <= ANT_BALAO_MAX; i++) opts.push({ value: String(i), label: i === 1 ? '1 balão' : i + ' balões' });
    return opts;
  }

  // ANTECIPACAO-BALAO-1: mirrors Secure's own renderAntecipacaoBaloes()
  // exactly -- a fixed-quantity, regenerate-on-change pattern (NOT the
  // Tradicional plan's incremental add/remove above): switching "Existem
  // balões?" or the quantity always rebuilds blank rows, discarding any
  // previously entered values (byte-proven against modules/simulador-
  // seminovos.html's own `const qtd=...; for(let i=1;i<=qtd;i++) ...`
  // loop -- no previous value carried over there either). antBaloes is
  // the one canonical state authority for this feature -- input
  // listeners below keep it in sync; calcAntecipacao() reads only from it.
  function renderAntBaloesList() {
    var list = document.getElementById('sAntBaloesList');
    if (!list) return;
    var sim = UI.getSegmentedValue('sAntTemBalao') === 'sim';
    var box = document.getElementById('sAntQtdBox');
    if (box) box.hidden = !sim;
    var qtdSel = document.getElementById('sAntQtdBaloes');
    var qtd = sim ? Number((qtdSel && qtdSel.value) || 0) : 0;
    antBaloes = [];
    for (var i = 0; i < qtd; i++) antBaloes.push({ mes: null, valor: 0, valorText: '' });
    list.innerHTML = antBaloes.map(function (b, idx) {
      return '<div class="smBalloonRow">' +
        '<div class="field"><label>Mês/parcela do balão ' + (idx + 1) + '</label><input class="input mono" type="number" min="1" max="60" data-abidx="' + idx + '" data-abfield="mes" value=""></div>' +
        '<div class="field"><label>Valor do balão ' + (idx + 1) + '</label><div class="inputAffix"><span class="prefix">R$</span><input class="input mono" inputmode="decimal" autocomplete="off" data-money data-abidx="' + idx + '" data-abfield="valor" value=""></div></div>' +
        '</div>';
    }).join('');
    list.querySelectorAll('[data-abidx]').forEach(function (el) {
      el.addEventListener('input', function () {
        var idx = Number(el.getAttribute('data-abidx')), field = el.getAttribute('data-abfield');
        if (field === 'mes') antBaloes[idx].mes = Number(el.value) || 0;
        else { antBaloes[idx].valorText = el.value; antBaloes[idx].valor = S.parseBRL(el.value); }
      });
      el.addEventListener('blur', function () {
        if (el.getAttribute('data-abfield') === 'valor') el.value = UI.brlDigits(S.parseBRL(el.value));
      });
    });
  }

  function wireForm(mode) {
    if (mode === 'tradicional') {
      if (!wireAuthorityGate(tradAuthority, mode)) return;
      renderBaloesList();
      document.getElementById('sAddBalao').addEventListener('click', function () {
        // BALAO-LIMIT-1: the real invariant -- guards the state/action
        // boundary itself, not just the (also disabled) button.
        if (balloons.length >= MAX_BALOES) return;
        balloons.push({ mes: null, valor: 0, valorText: '' });
        renderBaloesList();
      });
      wireTermGrid('sPrazo', TRAD_TERMS.length);
      document.getElementById('sCalc').addEventListener('click', calcTradicional);
    } else if (mode === 'ratetable') {
      if (!wireAuthorityGate(linearRTAuthority, mode)) return;
      document.getElementById('sCalc').addEventListener('click', calcRateTable);
    } else if (mode === 'descobridor') {
      document.getElementById('sCalc').addEventListener('click', calcDescobridor);
    } else if (mode === 'antecipacao') {
      if (!wireAuthorityGate(antecipacaoAuthority, mode)) return;
      document.getElementById('sAntExtra').innerHTML = antExtraHtml('todo');
      UI.wireSegmented('sTipoAnt', function (v) { document.getElementById('sAntExtra').innerHTML = antExtraHtml(v); });
      // ANTECIPACAO-BALAO-1: mirrors Secure's own change-wiring
      // (aTemBalao/aQtdBaloes both call renderAntecipacaoBaloes() then
      // recalculate) -- initial render always starts at "Não"/0, same
      // as Secure's own default.
      renderAntBaloesList();
      UI.wireSegmented('sAntTemBalao', function () { renderAntBaloesList(); });
      var antQtdSel = document.getElementById('sAntQtdBaloes');
      if (antQtdSel) antQtdSel.addEventListener('change', function () { renderAntBaloesList(); });
      document.getElementById('sCalc').addEventListener('click', calcAntecipacao);
    } else if (mode === 'cashconversion') {
      document.getElementById('sCalc').addEventListener('click', calcCashConversion);
    }
  }

  function setResult(html) { document.getElementById('smResultRegion').innerHTML = html; }

  /* ---------- Balloon payment-structure story, mirroring Novos' 08.2
     pattern (approved by human UAT) -- PRESENTATION ONLY, derives
     entirely from Seminovos' OWN calcularTradicional() r.parcela and
     the already-validated balloon list. 0 math duplicated: Seminovos'
     engine genuinely differs from Novos' (vehicle-year table, 1.0 vs
     0.7 balloon-cap ratio -- see docs/SIMULATOR-ENGINE-DISCOVERY-08.md
     Gate 49), but this summary function is generic pure presentation
     over (prazo, parcela, baloes), identical shape in both. ---------- */
  function balloonScheduleSummary(prazo, parcela, validBaloes) {
    var specials = validBaloes.slice().sort(function (a, b) { return a.mes - b.mes; })
      .map(function (b) { return { mes: b.mes, balao: b.valor, total: parcela + b.valor }; });
    return { regularCount: prazo - specials.length, regularValue: parcela, specials: specials };
  }
  function renderBalloonStory(prazo, parcela, validBaloes) {
    var s = balloonScheduleSummary(prazo, parcela, validBaloes);
    var html = '<div class="resultHero"><p class="kpiLabel">Plano simulado</p>';
    if (s.regularCount > 0) {
      html += '<p class="smPlanRegular"><span class="smPlanRegularCount">' + s.regularCount + 'x</span> de <span class="resultValue smPlanRegularValue">' + UI.brl(s.regularValue) + '</span></p>';
    }
    html += '</div>';
    html += '<div class="smPlanSpecials">' + s.specials.map(function (sp) {
      return '<div class="smPlanSpecialRow"><span class="kpiLabel">Parcela ' + sp.mes + '</span><span class="smPlanSpecialValue">' + UI.brl(sp.total) + '</span>' +
        '<span class="smPlanSpecialBreakdown">' + UI.brl(parcela) + ' (parcela) + ' + UI.brl(sp.balao) + ' (balão)</span></div>';
    }).join('') + '</div>';
    html += '<p class="smFootnote">Total de parcelas do plano: ' + prazo + '. Os meses com balão substituem o valor da parcela regular naquele mês por um valor especial (parcela + balão) — não são parcelas adicionais.</p>';
    return html;
  }

  function calcTradicional() {
    var prazo = Number(UI.getSegmentedValue('sPrazo'));
    // BALAO-LIMIT-1 Phase 6: defensive sanitization at the calculation
    // consumer boundary -- even if `balloons` were ever malformed beyond
    // MAX_BALOES by a future/legacy code path, calculation never sees
    // more than the canonical maximum.
    var validBaloes = balloons.filter(function (b) { return b.mes && b.valor; }).slice(0, MAX_BALOES).map(function (b) { return { mes: b.mes, valor: b.valor }; });
    var r = SN.calcularTradicional({
      bem: UI.moneyVal('sBem'), entrada: UI.moneyVal('sEntrada'), prazo: prazo,
      ano: UI.numVal('sAno'),
      baloes: validBaloes,
      tabelaTradicional: tradAuthority.getAuthority()
    });
    if (r.empty) { setResult(UI.emptyBlock('Preencha os campos e clique em Calcular.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var secondary = [{ label: 'Entrada', value: UI.pct1(r.pe) }, { label: 'Taxa aplicada', value: UI.pct2(r.taxa) }, { label: 'Limite de balão', value: UI.brl(r.limite) }];
    var html;
    if (validBaloes.length > 0) {
      html = renderBalloonStory(prazo, r.parcela, validBaloes) + UI.secondaryGrid(secondary);
    } else {
      html = UI.resultHero('Parcela mensal', r.parcela) + UI.secondaryGrid(secondary);
    }
    setResult(html);
  }
  function calcRateTable() {
    var r = SN.calcularLinearRateTable({ ano: UI.numVal('sAnoRT'), valor: UI.moneyVal('sValorRT'), entrada: UI.moneyVal('sEntradaRT'), rateTable: linearRTAuthority.getAuthority() });
    if (r.invalid) { setResult(UI.errorBlock('Verifique o ano do veículo e a entrada informada (entrada não pode ser maior que o valor do veículo, nem o percentual maior que 100%).')); return; }
    var html = UI.termGrid(r.terms.map(function (t) { return { prazo: t.prazo, payment: t.payment, rate: t.rate, best: false }; }));
    setResult('<p class="kpiLabel" style="margin-bottom:12px">Parcela por prazo — faixa ' + (r.band || '—') + ' · entrada ' + r.eBand + '%</p>' + html +
      '<p class="smFootnote">Financiado: ' + UI.brl(r.financiado) + '</p>');
    wireResultTermGrid(r.terms.length);
  }
  function calcDescobridor() {
    var r = SN.calcularDescobridor({ financiado: UI.moneyVal('sFinanciado'), prazo: UI.numVal('sPrazoNum'), parcela: UI.moneyVal('sParcela') });
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var html = '<div class="resultHero"><p class="kpiLabel">Taxa efetiva mensal (CET)</p><p class="resultValue">' + UI.pct2(r.taxaCetMes) + '</p></div>';
    html += UI.secondaryGrid([{ label: 'Taxa nominal estimada', value: UI.pct2(r.taxaNet) }, { label: 'Total pago', value: UI.brl(r.total) }, { label: 'Juros totais', value: UI.brl(r.juros) }]);
    setResult(html);
  }
  function calcAntecipacao() {
    var tipo = UI.getSegmentedValue('sTipoAnt');
    // ANTECIPACAO-BALAO-1: real balloon data now reaches the engine
    // (was hardcoded `baloes: []` -- the root cause of the missing
    // feature; calcularAntecipacao() itself already validates range/
    // duplicate/value via BALAO_FORA_DO_PRAZO/BALAO_DUPLICADO/
    // BALAO_VALOR_INVALIDO, unchanged). Same filter + defensive cap
    // pattern already established for the Tradicional plan (BALAO-
    // LIMIT-1): only rows with both a month and a value participate.
    var validAntBaloes = antBaloes.filter(function (b) { return b.mes && b.valor; }).slice(0, ANT_BALAO_MAX).map(function (b) { return { mes: b.mes, valor: b.valor }; });
    var r = SN.calcularAntecipacao({
      prazo: UI.numVal('sPrazoNum'), parcela: UI.moneyVal('sParcela'),
      primeiraParcela: UI.textVal('sPrimeira') ? new Date(UI.textVal('sPrimeira') + 'T00:00:00') : null,
      dataAntecipacao: UI.textVal('sData') ? new Date(UI.textVal('sData') + 'T00:00:00') : null,
      tipo: tipo, de: UI.numVal('sDe'), ate: UI.numVal('sAte'), parcelaUnica: UI.numVal('sParcelaUnicaNum'), baloes: validAntBaloes,
      tabelaAntecipacao: antecipacaoAuthority.getAuthority()
    });
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var rows = r.rows.map(function (row) {
      // ANTECIPACAO-BALAO-1: identifies balloon rows explicitly (row.tipo,
      // already computed by the unmodified engine) -- Secure's own result
      // table does the same. Plain-text parenthetical suffix, matching
      // the existing convention already used elsewhere in this file, no
      // new CSS component invented.
      return '<tr><td>Parcela ' + row.num + (row.valorBalao > 0 ? ' (balão)' : '') + '</td><td>' + row.venc.toLocaleDateString('pt-BR') + '</td><td class="num">' + UI.brl(row.bruto) + '</td><td class="num">' + UI.pct2(row.desconto) + '</td><td class="num">' + UI.brl(row.final) + '</td></tr>';
    }).join('');
    var html = UI.resultHero('Valor final com desconto', r.finalTotal);
    var secondaryItems = [{ label: 'Valor bruto', value: UI.brl(r.brutoTotal) }, { label: 'Desconto total', value: UI.brl(r.descTotal) }, { label: 'Parcelas antecipadas', value: String(r.rows.length) }];
    if (r.baloesTotal > 0) secondaryItems.push({ label: 'Total em balões', value: UI.brl(r.baloesTotal) });
    html += UI.secondaryGrid(secondaryItems);
    if (r.missing) html = UI.warningBlock('Algumas parcelas não tinham percentual cadastrado na tabela e foram calculadas sem desconto.') + html;
    html += '<div class="smTableWrap"><table class="smTable"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor bruto</th><th>Desconto</th><th>Valor final</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    setResult(html);
  }
  function calcCashConversion() {
    var taxaPct = Number(String(UI.textVal('sTaxaCC')).replace(',', '.')) || 0;
    var r = CC.compute({ capital: UI.moneyVal('sCapital'), parcela: UI.moneyVal('sParcelaCC'), prazoMeses: UI.numVal('sPrazoCC'), taxaAplicacao: taxaPct / 100 });
    if (!r) { setResult(UI.errorBlock('Não foi possível calcular com os dados informados.')); return; }
    var html = '<div class="resultHero"><p class="kpiLabel">Classificação</p><p><span class="smClassBadge ' + r.classificacao + '">' + r.classificacao + '</span></p></div>';
    html += UI.secondaryGrid([
      { label: 'Valor final do financiamento', value: UI.brl(r.valorFinalFinanciamento) },
      { label: 'Capital final projetado', value: UI.brl(r.valorFuturoAplicacao) },
      { label: 'Rendimento projetado', value: UI.brl(r.rendimentoAplicacao) },
      { label: 'Diferença projetada', value: UI.brl(r.diferencaProjetada) }
    ]);
    setResult(html);
  }

  window.NX_SIMULADOR_SEMINOVOS_PAGE = {
    render: function (outlet) {
      currentMode = MODES[0].id;
      balloons = [];
      antBaloes = [];
      openCategory = null; // SIM-NAV-4 / F.2: all categories collapsed on entry
      outlet.innerHTML =
        '<div class="smPage">' +
        '<span class="smProductBadge">Simulador · Seminovos</span>' +
        '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Simulador de Financiamento — Seminovos</h1><p class="modSubtitle">Motores extraídos e verificados (PORTAL-NEXT-08) — 0 recálculo de fórmula nesta interface.</p></div>' + analystCtaHtml('simulador_seminovos') + '</div>' +
        '<div id="smModeNavRegion">' + modeNavHtml() + '</div>' +
        '<p class="smModeDesc" id="smModeDesc"></p>' +
        '<div class="smGrid" id="smMainGrid"><div class="modPanelForm" id="smFormRegion"></div><div class="modPanelResult" id="smResultRegion" aria-live="polite" aria-atomic="true"></div></div>' +
        '</div>';
      wireModeNav();
      wireAnalystCta();
      renderModeArea();
      return Promise.resolve();
    },
    balloonScheduleSummary: balloonScheduleSummary,
    balancedColumns: balancedColumns
  };
})();
