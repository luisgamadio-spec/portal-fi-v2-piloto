/* PORTAL-NEXT V2 — Simulador Novos page (PORTAL-NEXT-08.1).
   Consumes the frozen PORTAL-NEXT-08 engines exclusively
   (window.NX_SIMULADOR_NOVOS_ADAPTER / NX_SIMULADOR_SHARED /
   NX_CAMPANHA_ADAPTER / NX_CASH_CONVERSION_ADAPTER). Zero business
   math is duplicated here — every number shown comes directly from an
   adapter return value. See docs/SIMULATOR-UI-MIGRATION-08-1.md. */
(function () {
  'use strict';

  var UI = window.NX_SIM_UI;
  var S = window.NX_SIMULADOR_SHARED;
  var N = window.NX_SIMULADOR_NOVOS_ADAPTER;
  var CAMP = window.NX_CAMPANHA_ADAPTER;
  var CC = window.NX_CASH_CONVERSION_ADAPTER;
  var GOVERNED = window.NX_COPARTICIPADO_GOVERNED_RATES_PROVIDER;
  var RATES = window.NX_SIMULADOR_RATES_PROVIDER;

  /* ---------- V2_SIMULADOR_NOVOS_GOVERNED_AUTHORITY_MIGRATION ----------
     "Plano Coparticipado" (mode 'campanha') financial authority (model
     rebate/hpe/brabus/entrada + per-term taxa + taxa->coeficiente) now
     comes from the governed, actively-maintained batch returned by
     simulador_get_coparticipado() -- the SAME real RPC/provider
     (coparticipado-governed-rates-provider.js) V2 Coparticipado's own
     Human-approved module already calls; calling it a second time here
     is a plain, stateless, side-effect-free read and does not affect
     Coparticipado's own behavior. financiamento-campanha.adapter.js's
     internal hardcoded MODELS/TX_COEF are NEVER used as authority for a
     real calculation any more -- calcCampanha() below always injects
     campAuthority via modelOverride/coefLookup, and the Calcular button
     only exists once campState === 'READY' (see formHtml/wireForm
     'campanha' branch), so there is no code path back to the stale
     embedded data. On any failure the mode fails closed (Portuguese
     message, no silent fallback) with a Retry action. Loaded once per
     page session (lazy, on first entry into 'campanha') and cached in
     campAuthority for the rest of the session -- not re-fetched per
     model/term, not polled. Simulador Seminovos never references
     NX_CAMPANHA_ADAPTER/'campanha' at all (verified: zero occurrences in
     simulador-seminovos.js), so this migration has zero Seminovos blast
     radius. */
  var campState = 'IDLE'; // IDLE | LOADING | READY | ERROR
  var campAuthority = null; // {modelsByName, modelNames, coefLookup}
  var campLoadPromise = null;
  var CAMP_FAIL_MSG = 'Não foi possível carregar as condições vigentes do simulador. Tente novamente.';

  function buildCampAuthority(body) {
    var mm = (body && body.linhas && body.linhas.matriz_modelos) || [];
    var tc = (body && body.linhas && body.linhas.tx_coef) || [];
    if (!mm.length || !tc.length) return null;
    var modelsByName = {};
    mm.forEach(function (r) {
      var m = modelsByName[r.modelo];
      if (!m) {
        m = modelsByName[r.modelo] = {
          name: r.modelo, entry: r.entrada_minima, rebate: r.rebate_total,
          hpe: r.rebate_hpe, brabus: r.rebate_brabus, rates: {}
        };
      }
      m.rates[r.prazo] = r.taxa;
    });
    var modelNames = Object.keys(modelsByName).sort();
    if (!modelNames.length) return null;
    var coefByPrazo = {};
    tc.forEach(function (r) {
      (coefByPrazo[r.prazo] = coefByPrazo[r.prazo] || []).push({ taxa: r.taxa, coeficiente: r.coeficiente });
    });
    // Epsilon-tolerant scan, not object-key string equality (Gate 21:
    // governed taxa values must not be assumed serialization-stable).
    function coefLookup(prazo, taxa) {
      var list = coefByPrazo[prazo];
      if (!list || taxa == null) return null;
      for (var i = 0; i < list.length; i++) {
        if (Math.abs(list[i].taxa - taxa) < 0.0000001) return list[i].coeficiente;
      }
      return null;
    }
    return { modelsByName: modelsByName, modelNames: modelNames, coefLookup: coefLookup };
  }

  function refreshCampArea() {
    if (currentMode === 'campanha') renderModeArea();
  }

  function ensureCampAuthority() {
    if (campState === 'READY' && campAuthority) return Promise.resolve(campAuthority);
    if (campLoadPromise) return campLoadPromise;
    campState = 'LOADING';
    campLoadPromise = GOVERNED.loadGovernedCoparticipadoRates({}).then(function (body) {
      var authority = buildCampAuthority(body);
      if (!authority) return Promise.reject({ state: 'BACKEND_ERROR', message: 'Base governada retornou sem modelos/coeficientes.' });
      campAuthority = authority;
      campState = 'READY';
      return authority;
    }).catch(function (err) {
      campAuthority = null;
      campState = 'ERROR';
      return Promise.reject(err);
    }).finally(function () {
      campLoadPromise = null;
    });
    return campLoadPromise;
  }

  /* ---------- SIMLIVE1 (migrate simulator live rate authorities) ----------
     Generic version of the exact same IDLE/LOADING/READY/ERROR +
     lazy-fetch-once-cache-for-session pattern ensureCampAuthority()
     above already established for Plano Coparticipado, reused here for
     every other mode that gets a real live rate/coefficient authority
     (V1 evidence: modules/simulador-novos.html's 7 SB_LOADER.carregar()
     call sites — portal-financiamento-brabus-secure). One instance per
     RPC; `transform(linhas)` reshapes the raw rows into whatever shape
     that mode's pure calcularXxx() expects (mirrors each V1
     carregarBaseX()'s own row->table mapping) and must return a falsy
     value to signal "unusable payload" (counted as failure, same as a
     network/auth error — fail closed, never an empty/partial table
     silently reaching a calculation). No RPC-caller params (V1's own
     RPCs take none — scope is server-derived from auth.uid()). */
  // `fallbackAuthority` (optional, 5th arg): see the AUTH_NOT_CONFIGURED
  // branch inside ensure() below for what this is and is NOT used for.
  function makeAuthority(rpcName, camposNumericos, camposTexto, transform, fallbackAuthority) {
    var state = 'IDLE'; // IDLE | LOADING | READY | ERROR
    var authority = null;
    var loadPromise = null;
    function ensure() {
      if (state === 'READY' && authority) return Promise.resolve(authority);
      if (loadPromise) return loadPromise;
      // AUTH_NOT_CONFIGURED (auth-core.js STATES.AUTH_NOT_CONFIGURED):
      // no real Supabase credentials exist anywhere for THIS
      // environment at all -- not a real user hitting a real backend
      // failure. This is a pre-existing, pervasive V2 distinction
      // (auth-boundary.js's own comment: "an unconfigured-vs-configured
      // distinction, not a bypass of a real system"; intelligence-
      // panel.js already treats this state as pass-through:
      // `if (state === STATES.AUTH_NOT_CONFIGURED) authorized = true`).
      // ONLY in this specific state do we fall through to the frozen
      // _FALLBACK table (byte-identical pre-migration behavior)
      // WITHOUT ever attempting the network call -- this is the one,
      // narrow, explicitly-justified deviation from "never use
      // _FALLBACK as a silent runtime fallback" (SIMLIVE1 Phase 4).
      // Once real credentials ARE configured (isAuthConfigured===true,
      // every real host including production), this branch never runs
      // again and a genuine backend failure always fails closed below
      // -- no Calcular, explicit error + retry, exactly like Plano
      // Coparticipado's own ensureCampAuthority().
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

  // BALAO_ZEROKM: shared by 'tradicional' and 'periodico' (V1's own
  // carregarBaseBalaoZeroKm() feeds both tabelaTradicional/tabelaPeriodica
  // from ONE fetch) — one authority instance, two consuming modes.
  var tradPeriodAuthority = makeAuthority('simulador_get_balao_zerokm', ['entrada_minima', 'prazo', 'max_balao', 'taxa'], ['bloco'], function (linhas) {
    var mapear = function (x) { return { entrada: x.entrada_minima, prazo: x.prazo, max: x.max_balao, taxa: x.taxa }; };
    var tradicional = linhas.filter(function (x) { return x.bloco === 'TRADICIONAL'; }).map(mapear);
    var periodica = linhas.filter(function (x) { return x.bloco === 'SEMESTRAL_ANUAL'; }).map(mapear);
    return (tradicional.length || periodica.length) ? { tradicional: tradicional, periodica: periodica } : null;
  }, { tradicional: N._internal.tabelaTradicional_FALLBACK, periodica: N._internal.tabelaPeriodica_FALLBACK });
  var linearAuthority = makeAuthority('simulador_get_linear_zerokm', ['prazo', 'entrada_pct', 'taxa'], [], function (linhas) {
    var t = linhas.map(function (x) { return { prazo: x.prazo, entrada: x.entrada_pct, taxa: x.taxa }; });
    return t.length ? t : null;
  }, N._internal.tabelaLinear_FALLBACK);
  var subsidiadasAuthority = makeAuthority('simulador_get_taxas_subsidiadas', ['prazo', 'taxa', 'coeficiente', 'rebate'], [], function (linhas) {
    var t = linhas.map(function (x) { return { prazo: x.prazo, taxa: x.taxa, coef: x.coeficiente, rebate: x.rebate }; });
    return t.length ? t : null;
  }, N._internal.tabelaRebates_FALLBACK);
  var tritonAuthority = makeAuthority('simulador_get_semestral_triton_outlander', ['rebate_total', 'rebate_hpe', 'rebate_brabus', 'entrada_minima'], ['modelo'], function (linhas) {
    var mapa = {};
    linhas.forEach(function (x) { mapa[x.modelo] = { rebateTotal: x.rebate_total, hpeShare: x.rebate_hpe, brabusShare: x.rebate_brabus, entradaMinima: x.entrada_minima }; });
    var modelNames = Object.keys(mapa).sort();
    return modelNames.length ? { modelos: mapa, modelNames: modelNames } : null;
  }, { modelos: N._internal.MODELOS_TRITON_FALLBACK, modelNames: Object.keys(N._internal.MODELOS_TRITON_FALLBACK).sort() });
  var antecipacaoAuthority = makeAuthority('simulador_get_antecipacao', ['meses_antecipacao', 'desconto'], [], function (linhas) {
    var mapa = {};
    linhas.forEach(function (x) { mapa[String(x.meses_antecipacao)] = x.desconto; });
    return Object.keys(mapa).length ? mapa : null;
  }, N._internal.tabelaAntecipacao_FALLBACK);
  // TAXA_BOTAO ("Copiar Taxa Banco", SIMLIVE1 Phase 7) — independent of
  // subsidiadasAuthority (V1 comment: "Base independente de
  // tabelaRebates — migrar só isto, não tocar tabelaRebates"), loaded
  // lazily the same way, but gates only its own small widget inside the
  // 'subsidiadas' screen, never the screen's own Calcular button. No
  // adapter-level _FALLBACK existed for this (V2 never had this
  // widget before SIMLIVE1) -- taxasBancoCopiar_FALLBACK below is
  // V1's own exact hardcoded map (modules/simulador-novos.html,
  // portal-financiamento-brabus-secure), used only as the
  // AUTH_NOT_CONFIGURED fallback and as this file's own parity fixture.
  var taxasBancoCopiar_FALLBACK = {
    12: 0.01783, 15: 0.01785, 18: 0.01785, 24: 0.01633,
    30: 0.01662, 36: 0.01661, 48: 0.01559, 60: 0.01558
  };
  var taxaBotaoAuthority = makeAuthority('simulador_get_taxa_botao', ['prazo', 'taxa_copiar'], [], function (linhas) {
    var mapa = {};
    linhas.forEach(function (x) { mapa[x.prazo] = x.taxa_copiar; });
    return Object.keys(mapa).length ? mapa : null;
  }, taxasBancoCopiar_FALLBACK);

  // Shared gate used by formHtml()/wireForm() for every live-authority
  // mode below — same visual language as Plano Coparticipado's own
  // loading/error block (UI.emptyBlock while loading, UI.errorBlock +
  // "Tentar novamente" on failure), reused rather than reinvented.
  function authorityGateHtml(authority) {
    if (authority.getState() === 'ERROR') {
      return UI.errorBlock(RATE_FAIL_MSG) +
        '<button type="button" class="btn btn-secondary" id="nRateRetry" style="width:100%;margin-top:6px">Tentar novamente</button>';
    }
    return UI.emptyBlock('Carregando condições vigentes do simulador...');
  }
  // Returns true when the mode's own form should wire normally
  // (authority READY); otherwise kicks off the fetch (IDLE) or wires
  // the retry button (ERROR) and returns false. `mode` is captured so
  // a late-arriving response never re-renders a screen the user has
  // since navigated away from (same guard as refreshCampArea()).
  function wireAuthorityGate(authority, mode) {
    function refresh() { if (currentMode === mode) renderModeArea(); }
    if (authority.getState() === 'ERROR') {
      var retryBtn = document.getElementById('nRateRetry');
      if (retryBtn) retryBtn.addEventListener('click', function () { authority.ensure().then(refresh, refresh); });
      return false;
    }
    if (authority.getState() !== 'READY') {
      authority.ensure().then(refresh, refresh);
      return false;
    }
    return true;
  }

  /* ---------- SIMLIVE1 Phase 7: "Copiar Taxa Banco" widget ----------
     V1 evidence: modules/simulador-novos.html's TAXA_BOTAO block
     (portal-financiamento-brabus-secure) — a prazo-select + "Copiar
     Taxa" button on the SAME Taxas Subsidiadas screen, backed by
     simulador_get_taxa_botao (confirmed live, granted to
     `authenticated`), distinct from tabelaRebates/subsidiadasAuthority.
     Independent widget region (#nBankRateWidgetRegion, rendered inside
     the 'subsidiadas' form) with its OWN loading/error/ready state —
     never blocks Taxas Subsidiadas' own Calcular. Only the formatted
     rate is ever shown/copied — no raw RPC payload exposed. */
  function bankRateWidgetHtml() {
    var st = taxaBotaoAuthority.getState();
    if (st === 'ERROR') {
      return '<div class="smBankRateWidget"><p class="kpiLabel">Copiar Taxa Banco</p>' +
        UI.errorBlock(RATE_FAIL_MSG) +
        '<button type="button" class="btn btn-secondary btn-sm" id="nBankRateRetry">Tentar novamente</button></div>';
    }
    if (st !== 'READY') {
      return '<div class="smBankRateWidget"><p class="kpiLabel">Copiar Taxa Banco</p>' + UI.emptyBlock('Carregando taxas...') + '</div>';
    }
    var mapa = taxaBotaoAuthority.getAuthority() || {};
    var prazos = Object.keys(mapa).map(Number).sort(function (a, b) { return a - b; });
    return '<div class="smBankRateWidget"><p class="kpiLabel">Copiar Taxa Banco</p>' +
      UI.selectField('nBankRatePrazo', 'Prazo', prazos.map(function (p) { return { value: p, label: p + 'x' }; }), prazos[0]) +
      '<button type="button" class="btn btn-secondary" id="nBankRateCopyBtn" style="width:100%;margin-top:6px">Copiar Taxa</button>' +
      '<span class="hint" id="nBankRateMsg" role="status" aria-live="polite"></span></div>';
  }
  function refreshBankRateWidget() {
    if (currentMode !== 'subsidiadas') return;
    var el = document.getElementById('nBankRateWidgetRegion');
    if (!el) return;
    el.innerHTML = bankRateWidgetHtml();
    wireBankRateWidget();
  }
  function formatTaxaBancoCopy(v) {
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + '%';
  }
  function copiarTaxaBanco() {
    var select = document.getElementById('nBankRatePrazo');
    var msg = document.getElementById('nBankRateMsg');
    if (!select) return;
    var mapa = taxaBotaoAuthority.getAuthority() || {};
    var taxa = mapa[Number(select.value)];
    if (taxa == null) { if (msg) msg.textContent = 'Selecione um prazo válido.'; return; }
    var texto = formatTaxaBancoCopy(taxa);
    var done = function () { if (msg) msg.textContent = 'Taxa ' + texto + ' copiada com sucesso!'; };
    var fail = function () { if (msg) msg.textContent = 'Não foi possível copiar automaticamente. Taxa: ' + texto; };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(texto).then(done, fail);
      } else {
        var temp = document.createElement('textarea');
        temp.value = texto;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand('copy'); done(); } catch (e) { fail(); }
        document.body.removeChild(temp);
      }
    } catch (e) { fail(); }
  }
  function wireBankRateWidget() {
    var st = taxaBotaoAuthority.getState();
    if (st === 'IDLE') { taxaBotaoAuthority.ensure().then(refreshBankRateWidget, refreshBankRateWidget); return; }
    if (st === 'ERROR') {
      var retryBtn = document.getElementById('nBankRateRetry');
      if (retryBtn) retryBtn.addEventListener('click', function () { taxaBotaoAuthority.ensure().then(refreshBankRateWidget, refreshBankRateWidget); });
      return;
    }
    if (st !== 'READY') return;
    var copyBtn = document.getElementById('nBankRateCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copiarTaxaBanco);
    var prazoSel = document.getElementById('nBankRatePrazo');
    if (prazoSel) prazoSel.addEventListener('change', function () { var msg = document.getElementById('nBankRateMsg'); if (msg) msg.textContent = ''; });
  }

  var MODES = [
    { id: 'tradicional', group: 'Financiamento', label: 'Tradicional (Balão)' },
    { id: 'periodico', group: 'Financiamento', label: 'Semestral / Anual' },
    { id: 'parcelaunica', group: 'Financiamento', label: 'Parcela Única' },
    { id: 'linear', group: 'Financiamento', label: 'Financiamento Linear' },
    { id: 'campanha', group: 'Campanhas', label: 'Plano Coparticipado' },
    { id: 'subsidiadas', group: 'Campanhas', label: 'Taxas Subsidiadas' },
    { id: 'triton', group: 'Campanhas', label: 'Semestral Triton / Outlander' },
    { id: 'descobridor', group: 'Ferramentas', label: 'Descobridor de Taxa' },
    { id: 'antecipacao', group: 'Ferramentas', label: 'Antecipação de Parcelas' },
    { id: 'cashconversion', group: 'Ferramentas', label: 'Cash Conversion' }
  ];
  var MODE_DESC = {
    tradicional: 'Financiamento tradicional com balão opcional — entrada mínima de 10%.',
    periodico: 'Parcelas semestrais ou anuais — entrada mínima varia por prazo.',
    parcelaunica: 'Uma única parcela no mês 25, após 24 meses de carência — entrada mínima de 50%.',
    linear: 'Parcela mensal fixa, todos os prazos calculados automaticamente.',
    campanha: 'Plano Coparticipado — condições especiais por modelo, entrada mínima de 60% do valor de venda.',
    subsidiadas: 'Comparação de taxas subsidiadas por prazo — entrada mínima de 50%.',
    triton: 'Campanha Taxa 0% — entrada fixa por modelo, sem alteração manual.',
    descobridor: 'Estima a taxa efetiva a partir do valor financiado, prazo e parcela.',
    antecipacao: 'Calcula o valor com desconto para antecipação de parcelas.',
    cashconversion: 'Compara o custo do financiamento com o rendimento de manter o capital aplicado.'
  };
  var TRAD_TERMS = [12, 24, 30, 36, 40, 42, 48];
  var PERIOD_TERMS = [24, 36, 48];
  var TRITON_MODELS = ['TRITON HPE', 'TRITON HPE-S', 'TRITON KATANA', 'TRITON SAVANA', 'TRITON TERRA'];

  var ERROR_MSG = {
    ENTRADA_MINIMA_10PCT: 'A entrada mínima permitida para este plano é de 10%.',
    ENTRADA_MAIOR_QUE_BEM: 'A entrada deve ser menor que o valor do bem.',
    SEM_REGRA_CADASTRADA: 'Prazo sem regra cadastrada na tabela para a faixa de entrada informada.',
    BALAO_FORA_DO_PRAZO: 'Existe balão fora do prazo. Use parcelas entre 1 e o prazo escolhido.',
    BALAO_DUPLICADO: 'Não é permitido inserir dois balões na mesma parcela.',
    BALAO_VALOR_INVALIDO: 'Informe valor válido para todos os balões.',
    BALOES_ACIMA_DO_LIMITE: 'A soma dos balões ultrapassa o valor máximo permitido, calculado sobre o valor financiado.',
    BALOES_ALTOS_DEMAIS: 'Os balões escolhidos são altos demais para gerar uma parcela mensal válida.',
    ENTRADA_ABAIXO_DO_MINIMO: 'A entrada mínima permitida para este plano não foi atingida.',
    BEM_INVALIDO: 'Informe um Valor do Bem válido.',
    ENTRADA_MINIMA_50PCT: 'A entrada mínima permitida para esta modalidade é de 50%.',
    INFORME_BEM: 'Informe o Valor do Bem.',
    INFORME_ENTRADA: 'Informe o Valor da Entrada.',
    FINANCIADO_INVALIDO: 'O valor financiado precisa ser maior que zero.',
    MIN_VENDA_MAIOR_QUE_BEM: 'O valor mínimo de venda deve ser menor que o valor do bem.',
    PRAZO_INVALIDO: 'Informe um prazo válido entre 1 e 60 meses.',
    PARCELA_INVALIDA: 'Informe uma parcela maior que zero.',
    PARCELA_INCOMPATIVEL: 'Parcela incompatível com os dados informados. Revise os valores.',
    PRIMEIRA_PARCELA_AUSENTE: 'Informe a data da primeira parcela.',
    DATA_AUSENTE: 'Informe a data desejada para antecipação.',
    INTERVALO_INVALIDO: 'Informe um intervalo válido de parcelas.',
    PARCELA_INVALIDA_INTERVALO: 'Informe uma parcela válida dentro do prazo.',
    NENHUMA_PARCELA_FUTURA: 'Nenhuma parcela futura encontrada. Revise a data de antecipação.'
  };
  function errMsg(code) { return ERROR_MSG[code] || 'Dados inválidos para este cálculo.'; }

  var currentMode = MODES[0].id;
  // BALAO-LIMIT-1: canonical max balloon count for Novos, recovered from
  // the live Secure source (modules/simulador-novos.html #tQtd select,
  // "Escolha até 4 balões" -- Seminovos' own equivalent panel caps at 2,
  // a proven, documented divergence, not a guess).
  var MAX_BALOES = 4;
  var balloons = []; // {mes, valor} for Tradicional
  // ANTECIPACAO-BALAO-1: restores Secure parity for the Antecipação
  // simulator's OWN, separate balloon feature (modules/simulador-
  // novos.html #aTemBalao/#aQtdBaloes, "Limite máximo: 8 balões.") --
  // NOT the same rule/state as the Tradicional plan's MAX_BALOES above
  // (proven, not assumed: Secure's own antecipação screen caps at 8,
  // shared identically with Seminovos, unrelated to the regular
  // financing max of 4/2). The extracted calcularAntecipacao() engine
  // (assets/js/adapters/simulador-novos.adapter.js) already fully
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
  // in wireModeNav() below).
  var openCategory = null;

  /* ---------- PORTAL-NEXT-08.2 Change 1: grouped button mode nav,
     replacing the single <select> the human explicitly rejected.
     Local to this file (Seminovos still uses its own unaffected
     rendering; Gate: avoid touching shared primitives unless
     unavoidable — this component isn't).
     SIM-NAV-4: markup refined again to the Human-approved Concept F.2
     look (labs/simuladores-navigation-lab.css, commits 1909bd1/
     8ded4b0/5158925), replacing SIM-NAV-3's Concept E. Categories
     collapsed by default; only one open at a time; selecting an
     option auto-collapses it and shows a red+bold current-mode hint
     on its (now collapsed) header. .smModeBtn/.smModeBtnLabel/
     .smModeGroupLabel/data-mode are UNCHANGED from E -- pre-existing
     tests that click '.smModeBtn[data-mode="..."]' or read
     .smModeGroupLabel keep working unmodified; only a new clickable
     .smModeGroupHeader and a .smModeRowsWrap animation wrapper were
     added around the same existing elements. ---------- */
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
  // SIM-REG-01: "Falar com um Analista" CTA -- lives in .modPageHeader
  // (the shared, already flex/space-between production header row,
  // module-system.css -- 0 shared CSS change needed), NOT inside
  // #smModeNavRegion, so it is static markup rendered once by
  // render() and never touched by switchMode()/toggleCategory()'s
  // nav-only re-renders. Visible on every mode, secondary to
  // "Calcular" (different position, quieter surface), never blocking
  // the simulation form. Action/destination authority lives entirely
  // in window.NX_FI_ATENDIMENTO (fi-atendimento.js).
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
        // treatment already shows it there; no duplication, brief §24).
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
    // Enter/Space button activation — no conflicting keyboard model.
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
    // PORTAL-NEXT-08.3 Gate 24: Subsidiadas' comparison grid needs the
    // full page width to show 3-4 cards per row without feeling
    // cramped next to a 360px input rail -- a mode-scoped modifier
    // class, not a change to the shared .smGrid rule itself (Seminovos
    // never gets this class, since it never sets currentMode to
    // 'subsidiadas' -- that mode doesn't exist in its own MODES list).
    var mainGrid = document.getElementById('smMainGrid');
    if (mainGrid) mainGrid.classList.toggle('smGridStacked', currentMode === 'subsidiadas');
    var formRegion = document.getElementById('smFormRegion');
    var resultRegion = document.getElementById('smResultRegion');
    formRegion.innerHTML = formHtml(currentMode);
    resultRegion.innerHTML = UI.emptyBlock('Preencha os campos e clique em Calcular.');
    wireForm(currentMode);
    UI.syncEntries(formRegion);
  }

  /* ---------- PORTAL-NEXT-08.2 Change 2: balanced term grid, replacing
     .segmented's flex-wrap (which produced an accidental "6+1" isolated
     last row). Reuses UI.getSegmentedValue/active-button convention —
     only the layout/columns are new. ---------- */
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

  // V2_SIMULATOR_INSTALLMENT_GRID_VISUAL_FIX: wires the shared
  // UI.wireTermResultGrid (simuladores-shared.js) onto the just-rendered
  // #smResultRegion .smTermGrid, reusing the same disconnect lifecycle
  // (termGridObservers/disconnectTermGridObservers) already used for the
  // .smTermSelectGrid above -- every renderModeArea() call disconnects
  // all of them before re-rendering, so no leak across mode switches.
  function wireResultTermGrid(itemCount) {
    var grid = document.querySelector('#smResultRegion .smTermGrid');
    if (!grid) return;
    var ro = UI.wireTermResultGrid(grid, 110, itemCount);
    if (ro) termGridObservers.push(ro);
  }

  /* ---------- forms ---------- */
  function formHtml(mode) {
    switch (mode) {
      case 'tradicional':
        // SIMLIVE1: gated on tradPeriodAuthority (simulador_get_balao_zerokm)
        // -- fail-closed, same pattern as 'campanha' below.
        if (tradPeriodAuthority.getState() !== 'READY') return authorityGateHtml(tradPeriodAuthority);
        return UI.moneyField('nBem', 'Valor do bem', 'R$ 100.000,00') +
          UI.entryField('nEntrada', 'Entrada', 'R$ 20.000,00', 'nBem') +
          termGridFieldHtml('nPrazo', 'Prazo', TRAD_TERMS, 48) +
          '<div class="field"><label>Balões</label>' +
          '<div class="smBalloonList" id="nBaloesList"></div>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="nAddBalao">+ Adicionar balão</button>' +
          '<span class="hint" id="nAddBalaoHint" hidden>Máximo de ' + MAX_BALOES + ' balões atingido.</span></div>' +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'periodico':
        // SIMLIVE1: SAME authority as 'tradicional' (one shared fetch,
        // mirroring V1's own carregarBaseBalaoZeroKm()).
        if (tradPeriodAuthority.getState() !== 'READY') return authorityGateHtml(tradPeriodAuthority);
        return UI.moneyField('nBem', 'Valor do bem', 'R$ 100.000,00') +
          UI.entryField('nEntrada', 'Entrada', 'R$ 20.000,00', 'nBem') +
          termGridFieldHtml('nPrazo', 'Prazo', PERIOD_TERMS, 48) +
          UI.segmentedField('nTipo', 'Periodicidade', [{ value: 'semestral', label: 'Semestral' }, { value: 'anual', label: 'Anual' }], 'semestral') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'parcelaunica':
        // V1_STATIC_AUTHORITY_CONFIRMED -- V1 has no RPC for this block
        // ("ACTIVE base has no coefficient column for that block"),
        // permanently hardcoded even in V1. Untouched.
        return UI.moneyField('nBem', 'Valor do bem', 'R$ 100.000,00') +
          UI.entryField('nEntrada', 'Entrada', 'R$ 50.000,00', 'nBem') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'linear':
        // SIMLIVE1: gated on linearAuthority (simulador_get_linear_zerokm).
        if (linearAuthority.getState() !== 'READY') return authorityGateHtml(linearAuthority);
        return UI.moneyField('nBem', 'Valor do bem', 'R$ 100.000,00') +
          UI.entryField('nEntrada', 'Entrada', 'R$ 20.000,00', 'nBem', 'Recalcula automaticamente, sem botão Calcular (comportamento original).');
      case 'campanha':
        // Governed-authority gated: no form/Calcular exists unless
        // campState === 'READY' -- see the module-level comment above
        // ensureCampAuthority(). Model options come exclusively from the
        // governed campAuthority.modelNames, never from CAMP._internal.MODELS.
        if (campState === 'ERROR') {
          return UI.errorBlock(CAMP_FAIL_MSG) +
            '<button type="button" class="btn btn-secondary" id="nCampRetry" style="width:100%;margin-top:6px">Tentar novamente</button>';
        }
        if (campState !== 'READY' || !campAuthority) {
          return UI.emptyBlock('Carregando condições vigentes do simulador...');
        }
        return UI.selectField('nModelo', 'Modelo', campAuthority.modelNames.map(function (name) { return { value: name, label: name }; }), campAuthority.modelNames[0]) +
          UI.moneyField('nSale', 'Valor de venda', 'R$ 200.000,00') +
          UI.entryField('nEntry', 'Entrada', 'R$ 120.000,00', 'nSale') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'subsidiadas':
        // SIMLIVE1: gated on subsidiadasAuthority (simulador_get_taxas_subsidiadas).
        // The "Copiar Taxa Banco" widget (Phase 7) below is a SEPARATE,
        // independent authority (taxaBotaoAuthority) -- it never blocks
        // this screen's own Calcular; see bankRateWidgetHtml().
        if (subsidiadasAuthority.getState() !== 'READY') return authorityGateHtml(subsidiadasAuthority);
        return UI.moneyField('nBem', 'Valor do bem', 'R$ 100.000,00') +
          UI.entryField('nEntrada', 'Entrada', 'R$ 50.000,00', 'nBem') +
          UI.moneyField('nMinVenda', 'Valor mínimo de venda (opcional)', '') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>' +
          '<div id="nBankRateWidgetRegion">' + bankRateWidgetHtml() + '</div>';
      case 'triton':
        // SIMLIVE1: gated on tritonAuthority (simulador_get_semestral_
        // triton_outlander). Model <select> options come EXCLUSIVELY from
        // the live authority.modelNames (never the hardcoded TRITON_MODELS
        // list) -- same "governed authority is the only source of model
        // options" rule 'campanha' already established, and the only way
        // Outlander HPE-S/SIGNATURE (ACTIVE-only, not in any _FALLBACK) can
        // ever appear.
        if (tritonAuthority.getState() !== 'READY') return authorityGateHtml(tritonAuthority);
        var tritonNames = tritonAuthority.getAuthority().modelNames;
        return UI.selectField('nModelo', 'Modelo', tritonNames.map(function (m) { return { value: m, label: m }; }), tritonNames[0]) +
          UI.moneyField('nBem', 'Valor de venda', 'R$ 200.000,00', 'Entrada mínima definida pela base vigente — não editável.') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'descobridor':
        return UI.moneyField('nFinanciado', 'Valor financiado', 'R$ 80.000,00') +
          UI.numberField('nPrazoNum', 'Prazo (meses)', 48, { min: 1, max: 60 }) +
          UI.moneyField('nParcela', 'Parcela', 'R$ 2.200,00') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'antecipacao':
        // SIMLIVE1: gated on antecipacaoAuthority (simulador_get_antecipacao).
        if (antecipacaoAuthority.getState() !== 'READY') return authorityGateHtml(antecipacaoAuthority);
        return UI.numberField('nPrazoNum', 'Prazo (meses)', 48, { min: 1, max: 60 }) +
          UI.moneyField('nParcela', 'Valor da parcela mensal', 'R$ 2.000,00') +
          UI.dateField('nPrimeira', 'Data da primeira parcela', '') +
          UI.dateField('nData', 'Data desejada para antecipação', '') +
          UI.segmentedField('nTipoAnt', 'O que antecipar', [{ value: 'todo', label: 'Contrato todo' }, { value: 'algumas', label: 'Algumas parcelas' }, { value: 'uma', label: 'Uma parcela' }], 'todo') +
          '<div id="nAntExtra"></div>' +
          UI.segmentedField('nAntTemBalao', 'Existem balões neste financiamento?', [{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }], 'nao') +
          '<div class="field" id="nAntQtdBox" hidden>' + UI.selectField('nAntQtdBaloes', 'Quantidade de balões', antBaloesQtdOptions(), '0') +
          '<span class="hint">Limite máximo: ' + ANT_BALAO_MAX + ' balões.</span></div>' +
          '<div class="smBalloonList" id="nAntBaloesList"></div>' +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      case 'cashconversion':
        return UI.moneyField('nCapital', 'Capital', 'R$ 100.000,00') +
          UI.moneyField('nParcelaCC', 'Parcela ofertada', 'R$ 2.500,00') +
          UI.numberField('nPrazoCC', 'Prazo (meses)', 36, { min: 1, max: 60 }) +
          UI.percentField('nTaxaCC', 'Taxa de aplicação mensal (%)', '0,80') +
          '<button type="button" class="btn btn-primary" id="nCalc" style="width:100%;margin-top:6px">Calcular</button>';
      default:
        return '';
    }
  }

  function antExtraHtml(tipo) {
    if (tipo === 'algumas') return UI.numberField('nDe', 'De (parcela nº)', 1, { min: 1 }) + UI.numberField('nAte', 'Até (parcela nº)', 12, { min: 1 });
    if (tipo === 'uma') return UI.numberField('nParcelaUnicaNum', 'Parcela nº', 1, { min: 1 });
    return '';
  }

  function renderBaloesList() {
    var list = document.getElementById('nBaloesList');
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
      el.addEventListener('blur', function () {
        if (el.getAttribute('data-bfield') === 'valor') el.value = UI.brlDigits(S.parseBRL(el.value));
      });
    });
    list.querySelectorAll('[data-bremove]').forEach(function (el) {
      el.addEventListener('click', function () { balloons.splice(Number(el.getAttribute('data-bremove')), 1); renderBaloesList(); });
    });
    // BALAO-LIMIT-1: re-evaluated on every render (add and remove both
    // call renderBaloesList()), so removing below MAX_BALOES immediately
    // re-enables "+ Adicionar balão" again (4 -> remove -> 3 -> add -> 4).
    var addBtn = document.getElementById('nAddBalao');
    var addHint = document.getElementById('nAddBalaoHint');
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
  // novos.html's own `const qtd=...; for(let i=1;i<=qtd;i++) ...` loop
  // -- no previous value carried over there either). antBaloes is the
  // one canonical state authority for this feature -- input listeners
  // below keep it in sync; calcAntecipacao() reads only from it.
  function renderAntBaloesList() {
    var list = document.getElementById('nAntBaloesList');
    if (!list) return;
    var sim = UI.getSegmentedValue('nAntTemBalao') === 'sim';
    var box = document.getElementById('nAntQtdBox');
    if (box) box.hidden = !sim;
    var qtdSel = document.getElementById('nAntQtdBaloes');
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
      if (!wireAuthorityGate(tradPeriodAuthority, mode)) return;
      renderBaloesList();
      document.getElementById('nAddBalao').addEventListener('click', function () {
        // BALAO-LIMIT-1: the real invariant -- guards the state/action
        // boundary itself, not just the (also disabled) button, so a
        // rapid/repeated/programmatic click can never create a 5th entry.
        if (balloons.length >= MAX_BALOES) return;
        balloons.push({ mes: null, valor: 0, valorText: '' });
        renderBaloesList();
      });
      wireTermGrid('nPrazo', TRAD_TERMS.length);
      document.getElementById('nCalc').addEventListener('click', function () { calcTradicional(); });
    } else if (mode === 'periodico') {
      if (!wireAuthorityGate(tradPeriodAuthority, mode)) return;
      wireTermGrid('nPrazo', PERIOD_TERMS.length);
      UI.wireSegmented('nTipo', function () {});
      document.getElementById('nCalc').addEventListener('click', calcPeriodico);
    } else if (mode === 'parcelaunica') {
      document.getElementById('nCalc').addEventListener('click', runParcelaUnica);
    } else if (mode === 'linear') {
      if (!wireAuthorityGate(linearAuthority, mode)) return;
      UI.wireMoneyMask('nBem', calcLinear);
      UI.wireMoneyMask('nEntrada', calcLinear);
      calcLinear();
    } else if (mode === 'campanha') {
      if (campState === 'ERROR') {
        var retryBtn = document.getElementById('nCampRetry');
        if (retryBtn) retryBtn.addEventListener('click', function () { ensureCampAuthority().then(refreshCampArea, refreshCampArea); });
      } else if (campState !== 'READY') {
        ensureCampAuthority().then(refreshCampArea, refreshCampArea);
      } else {
        document.getElementById('nCalc').addEventListener('click', calcCampanha);
      }
    } else if (mode === 'subsidiadas') {
      if (!wireAuthorityGate(subsidiadasAuthority, mode)) return;
      document.getElementById('nCalc').addEventListener('click', calcSubsidiadas);
      wireBankRateWidget();
    } else if (mode === 'triton') {
      if (!wireAuthorityGate(tritonAuthority, mode)) return;
      document.getElementById('nCalc').addEventListener('click', calcTriton);
    } else if (mode === 'descobridor') {
      document.getElementById('nCalc').addEventListener('click', calcDescobridor);
    } else if (mode === 'antecipacao') {
      if (!wireAuthorityGate(antecipacaoAuthority, mode)) return;
      document.getElementById('nAntExtra').innerHTML = antExtraHtml('todo');
      UI.wireSegmented('nTipoAnt', function (v) { document.getElementById('nAntExtra').innerHTML = antExtraHtml(v); });
      // ANTECIPACAO-BALAO-1: mirrors Secure's own change-wiring
      // (aTemBalao/aQtdBaloes both call renderAntecipacaoBaloes() then
      // recalculate) -- initial render always starts at "Não"/0, same
      // as Secure's own default.
      renderAntBaloesList();
      UI.wireSegmented('nAntTemBalao', function () { renderAntBaloesList(); });
      var antQtdSel = document.getElementById('nAntQtdBaloes');
      if (antQtdSel) antQtdSel.addEventListener('change', function () { renderAntBaloesList(); });
      document.getElementById('nCalc').addEventListener('click', calcAntecipacao);
    } else if (mode === 'cashconversion') {
      document.getElementById('nCalc').addEventListener('click', calcCashConversion);
    }
  }

  function setResult(html) { document.getElementById('smResultRegion').innerHTML = html; }

  /* ---------- PORTAL-NEXT-08.2 Change 4: balloon payment-structure
     story. PRESENTATION ONLY — derives entirely from the frozen
     engine's own already-computed r.parcela and the already-validated
     balloon list; introduces no new financial math, no new rounding.
     "Special month total" = r.parcela + that balloon's valor (Gate's
     own required formula, using the engine's authoritative values).
     Regular-payment count = prazo - (number of UNIQUE balloon months)
     — correct for 1 final balloon, 1 intermediate balloon, or several,
     because the engine's own validation (BALAO_DUPLICADO) already
     guarantees every balloon month in a valid result is unique. ---------- */
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

  /* ---------- PORTAL-NEXT-08.3 Change 2/3: reusable, presentation-only
     schedule block (Gate 6) — every value passed in comes from the
     frozen engine's own output (r.meses, r.plano.prazo, or the shared
     S.SEMESTRAL_TRITON_MESES constant); this function performs 0
     calculation. Markers are non-interactive (role="list", not
     buttons) — they inform, they don't select. ---------- */
  function scheduleBlockHtml(config) {
    // config: {prazoTotal, periodicidade (optional), meses: [...],
    //          specialLabel (optional, defaults to "parcela(s) especial(is)")}
    var meses = config.meses || [];
    var specialLabel = config.specialLabel || (meses.length === 1 ? 'parcela especial' : 'parcelas especiais');
    return '<div class="smSchedule">' +
      '<p class="kpiLabel">Cronograma do plano</p>' +
      '<div class="smScheduleRow">' +
      '<div class="smScheduleItem"><span class="smScheduleLabel">Prazo total</span><strong>' + config.prazoTotal + ' meses</strong></div>' +
      (config.periodicidade ? '<div class="smScheduleItem"><span class="smScheduleLabel">Periodicidade</span><strong>' + UI.esc(config.periodicidade) + '</strong></div>' : '') +
      '<div class="smScheduleItem"><span class="smScheduleLabel">' + UI.esc(meses.length + ' ' + specialLabel) + '</span></div>' +
      '</div>' +
      '<p class="smScheduleMarkersLabel">Ocorrem na' + (meses.length === 1 ? '' : 's') + ' parcela' + (meses.length === 1 ? '' : 's') + ':</p>' +
      '<div class="smScheduleMarkers" role="list" aria-label="Parcelas em que ocorrem os pagamentos especiais">' +
      meses.map(function (m) { return '<span class="smScheduleMarker" role="listitem">' + m + '</span>'; }).join('') +
      '</div></div>';
  }

  /* ---------- calculations (adapter calls only) ---------- */
  function calcTradicional() {
    // BALAO-LIMIT-1 Phase 6: defensive sanitization at the calculation
    // consumer boundary -- even if `balloons` were ever malformed beyond
    // MAX_BALOES by a future/legacy code path, calculation never sees
    // more than the canonical maximum.
    var validBaloes = balloons.filter(function (b) { return b.mes && b.valor; }).slice(0, MAX_BALOES).map(function (b) { return { mes: b.mes, valor: b.valor }; });
    var tradAuth = tradPeriodAuthority.getAuthority();
    var r = N.calcularTradicional({
      bem: UI.moneyVal('nBem'), entrada: UI.moneyVal('nEntrada'),
      prazo: Number(UI.getSegmentedValue('nPrazo')),
      baloes: validBaloes,
      tabelaTradicional: tradAuth ? tradAuth.tradicional : undefined
    });
    if (r.empty) { setResult(UI.emptyBlock('Preencha os campos e clique em Calcular.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var secondary = [{ label: 'Entrada', value: UI.pct1(r.pe) }, { label: 'Taxa aplicada', value: UI.pct2(r.taxa) }, { label: 'Limite de balão', value: UI.brl(r.limite) }];
    var html;
    if (validBaloes.length > 0) {
      html = renderBalloonStory(Number(UI.getSegmentedValue('nPrazo')), r.parcela, validBaloes) + UI.secondaryGrid(secondary);
    } else {
      html = UI.resultHero('Parcela mensal', r.parcela) + UI.secondaryGrid(secondary);
    }
    setResult(html);
  }
  function calcPeriodico() {
    var periodAuth = tradPeriodAuthority.getAuthority();
    var r = N.calcularPeriodico({ bem: UI.moneyVal('nBem'), entrada: UI.moneyVal('nEntrada'), prazo: Number(UI.getSegmentedValue('nPrazo')), tipo: UI.getSegmentedValue('nTipo'), tabelaPeriodica: periodAuth ? periodAuth.periodica : undefined });
    if (r.empty) { setResult(UI.emptyBlock('Preencha os campos e clique em Calcular.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error) + (r.minEntrada != null ? ' Mínimo: ' + UI.pct1(r.minEntrada) + '.' : ''))); return; }
    var tipo = UI.getSegmentedValue('nTipo');
    var prazo = Number(UI.getSegmentedValue('nPrazo'));
    var html = UI.resultHero('Parcela ' + (tipo === 'semestral' ? 'semestral' : 'anual'), r.parcela);
    html += UI.secondaryGrid([{ label: 'Entrada', value: UI.pct1(r.pe) }, { label: 'Taxa aplicada', value: UI.pct2(r.taxa) }]);
    // PORTAL-NEXT-08.3 Change 2/3: explicit schedule -- r.meses is the
    // frozen engine's own computed list of installment numbers
    // (Gate 3/4/7), not re-derived or hardcoded here.
    html += scheduleBlockHtml({ prazoTotal: prazo, periodicidade: tipo === 'semestral' ? 'Semestral' : 'Anual', meses: r.meses });
    setResult(html);
  }
  function runParcelaUnica() {
    var r = N.calcularParcelaUnica({ bem: UI.moneyVal('nBem'), entrada: UI.moneyVal('nEntrada') });
    if (r.empty) { setResult(UI.emptyBlock('Preencha os campos e clique em Calcular.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error) + (r.minEntrada != null ? ' Mínimo: ' + UI.pct1(r.minEntrada) + '.' : ''))); return; }
    var html = UI.resultHero('Parcela única (mês ' + r.plano.prazo + ')', r.parcela);
    // PORTAL-NEXT-08.3 Change 3 (Gate 11-13): coefficient hidden;
    // "Taxa da tabela" shown instead -- r.taxa is the engine's own
    // authoritative table rate (tabelaParcelaUnica.taxa), a real field
    // distinct from coef, not derived from it. No period suffix
    // ("a.m."): production's own UI (uTaxa, PORTAL-NEXT-04/.source)
    // labels this identically as "Taxa da tabela" with a bare
    // percentage, never claiming a monthly/annual period for this
    // specific flat-coefficient plan -- verified from source, not
    // guessed (Gate 13).
    html += UI.secondaryGrid([{ label: 'Entrada', value: UI.pct1(r.pe) }, { label: 'Financiado', value: UI.brl(r.fin) }, { label: 'Taxa da tabela', value: UI.pct2(r.taxa) }]);
    // Gate 8: explicit prazo total + single special month, derived
    // from r.plano.prazo (the engine's own authoritative value) --
    // never hardcoded.
    html += scheduleBlockHtml({ prazoTotal: r.plano.prazo, meses: [r.plano.prazo], specialLabel: 'parcela única' });
    setResult(html);
  }
  function calcLinear() {
    var r = N.calcularLinear({ bem: UI.moneyVal('nBem'), entrada: UI.moneyVal('nEntrada'), tabelaLinear: linearAuthority.getAuthority() });
    if (r.empty) { setResult(UI.emptyBlock('Preencha o valor do bem e a entrada para visualizar todos os prazos.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var valid = r.itens.filter(function (x) { return x.parcela > 0; });
    var menor = valid.length ? Math.min.apply(null, valid.map(function (x) { return x.parcela; })) : null;
    var html = UI.termGrid(r.itens.map(function (x) { return { prazo: x.prazo, payment: x.parcela, rate: null, best: menor != null && x.parcela != null && Math.abs(x.parcela - menor) < 0.01 }; }));
    setResult('<p class="kpiLabel" style="margin-bottom:12px">Parcela por prazo — faixa de entrada ' + UI.pct1(r.faixa) + '</p>' + html);
    wireResultTermGrid(r.itens.length);
  }
  function calcCampanha() {
    // Governed authority only -- never falls back to CAMP's internal
    // hardcoded MODELS/TX_COEF (see module-level comment above
    // ensureCampAuthority()). This button does not exist unless
    // campState === 'READY', but the guard is kept explicit here too.
    if (!campAuthority) { setResult(UI.errorBlock(CAMP_FAIL_MSG)); return; }
    var modelName = UI.textVal('nModelo');
    var governedModel = campAuthority.modelsByName[modelName];
    if (!governedModel) { setResult(UI.errorBlock('Modelo não encontrado na base vigente do simulador.')); return; }
    var r = CAMP.compute({
      model: modelName, saleValue: UI.moneyVal('nSale'), entryValue: UI.moneyVal('nEntry'),
      modelOverride: governedModel, coefLookup: campAuthority.coefLookup
    });
    if (!r.valid) { setResult(UI.errorBlock('A entrada informada é menor que o mínimo exigido para este modelo (' + UI.pct1(r.minValue / (r.sale || 1)) + ' do valor de venda).')); return; }
    // PORTAL-NEXT-08.3 Change 4 (Gate 14/15): hierarchy reordered --
    // parcela-per-prazo is supporting context first, then Rebate
    // Brabus + Valor Final de Venda get a dedicated emphasized block
    // (visual only; the values themselves are untouched engine output).
    var html = '<p class="kpiLabel" style="margin-bottom:12px">Parcela por prazo</p>' +
      UI.termGrid(r.terms.map(function (t) { return { prazo: t.prazo, payment: t.payment, rate: t.rate, best: false }; }));
    html += '<div class="smEmphasisPair">' +
      '<div class="smEmphasisCard"><p class="kpiLabel">Rebate Brabus</p><p class="smEmphasisValue">' + UI.brl(r.rebateBrabus) + '</p></div>' +
      '<div class="smEmphasisCard smEmphasisCardPrimary"><p class="kpiLabel">Valor final de venda</p><p class="smEmphasisValue smEmphasisValuePrimary">' + UI.brl(r.finalSale) + '</p></div>' +
      '</div>';
    html += UI.secondaryGrid([
      { label: 'Financiado', value: UI.brl(r.financed) },
      { label: 'Rebate total — custo comercial da taxa', value: UI.brl(r.rebateTotal) },
      { label: 'Rebate HPE', value: UI.brl(r.rebateHpe) }
    ]);
    setResult(html);
    wireResultTermGrid(r.terms.length);
  }
  function calcSubsidiadas() {
    var r = N.calcularSubsidiadas({ bem: UI.moneyVal('nBem'), entrada: UI.moneyVal('nEntrada'), minVenda: UI.moneyVal('nMinVenda'), tabelaRebates: subsidiadasAuthority.getAuthority() });
    if (r.empty) { setResult(UI.emptyBlock('Preencha os campos e clique em Calcular.')); return; }
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    // PORTAL-NEXT-08.3 Change 5 (Gates 16-22): replaced the large
    // vertically-stacked rows with a compact comparison card grid.
    // PRESENTATION ONLY (Gate 27) -- every card uses the exact frozen
    // r.rows entry for that taxa/prazo condition, no new sort/score;
    // row.melhor is the engine's own pre-existing field (PORTAL-NEXT-08
    // extraction of production's own montaDadosSubsidiadas ranking),
    // not a badge invented in this Wave (Gate 19).
    var byTaxa = {};
    r.rows.forEach(function (row) { (byTaxa[row.taxa] = byTaxa[row.taxa] || []).push(row); });
    var groupsHtml = Object.keys(byTaxa).sort(function (a, b) { return Number(a) - Number(b); }).map(function (taxa) {
      var cards = byTaxa[taxa].sort(function (a, b) { return a.prazo - b.prazo; }).map(function (row) {
        // Gate 20: "Simulado" (shown identically on every card when no
        // minVenda is set) carried 0 differentiating information --
        // removed. A pill now appears ONLY when it conveys something
        // real: the engine's own "melhor" signal, or a genuine
        // viability verdict once a minVenda is provided.
        var pill = '';
        if (row.melhor) pill = '<span class="smPill excellent">Melhor opção</span>';
        else if (r.minVenda > 0) pill = '<span class="smPill ' + (row.viavel ? 'good' : 'bad') + '">' + (row.viavel ? 'Dentro do mínimo' : 'Abaixo do mínimo') + '</span>';
        return '<div class="smSubsidiadaCard' + (row.melhor ? ' best' : '') + '">' +
          '<div class="smSubsidiadaCardHead"><span class="smSubsidiadaCardPrazo">' + row.prazo + 'x</span><span class="smSubsidiadaCardTaxa">' + UI.pct2(row.taxa) + '</span></div>' +
          (pill ? '<div class="smSubsidiadaCardPill">' + pill + '</div>' : '') +
          '<div class="smSubsidiadaCardRow"><span class="kpiLabel">Parcela</span><strong>' + UI.brl(row.parcela) + '</strong></div>' +
          // Gate 1-3 (PORTAL-NEXT-08.4): row.rebate is the engine's own
          // authoritative percentage field (RATE_TABLE tabelaRebates_FALLBACK),
          // proven by rebateValor === financiado * row.rebate -- so the
          // denominator is "financiado" (bem - entrada), NOT "valor do bem".
          // Displayed as-is, no derivation, no new precision invented.
          '<div class="smSubsidiadaCardRow smSubsidiadaCardRowEmphasis"><span class="kpiLabel">Rebate — custo comercial</span>' +
          '<span class="smSubsidiadaCardValueStack"><strong>' + UI.brl(row.rebateValor) + '</strong>' +
          '<span class="smSubsidiadaCardRebatePct">' + UI.pct2(row.rebate) + ' do valor financiado</span></span></div>' +
          '<div class="smSubsidiadaCardRow smSubsidiadaCardRowEmphasis"><span class="kpiLabel">Valor final de venda</span><strong>' + UI.brl(row.valorFinalVenda) + '</strong></div>' +
          '</div>';
      }).join('');
      return '<div class="smSubsidiadaGroup"><p class="smSubsidiadaGroupHead">Taxa ' + UI.pct2(Number(taxa)) + '</p><div class="smSubsidiadaGrid">' + cards + '</div></div>';
    }).join('');
    setResult('<div class="smSubsidiadaGroups">' + groupsHtml + '</div>' +
      '<p class="smFootnote">Rebate é o custo comercial da taxa subsidiada — nunca um desconto concedido ao cliente. Valor final de venda já considera o valor líquido para a loja.</p>');
  }
  function calcTriton() {
    var tritonAuth = tritonAuthority.getAuthority();
    var r = N.calcularSemestralTriton({ bem: UI.moneyVal('nBem'), modelo: UI.textVal('nModelo'), modelosTriton: tritonAuth ? tritonAuth.modelos : undefined });
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error) || 'Informe o valor de venda para calcular a campanha.')); return; }
    var html = UI.resultHero('Parcela (4x semestrais)', r.parcela);
    html += UI.secondaryGrid([
      { label: 'Entrada fixa (' + UI.pct1(r.entradaPct != null ? r.entradaPct : 0.6) + ')', value: UI.brl(r.entrada) },
      { label: 'Financiado', value: UI.brl(r.financiado) },
      { label: 'Rebate total — custo comercial', value: UI.brl(r.rebateTotal) },
      { label: 'Rebate Brabus', value: UI.brl(r.rebateBrabus) },
      { label: 'Rebate HPE', value: UI.brl(r.rebateHpe) },
      { label: 'Valor final de venda', value: UI.brl(r.valorFinalVenda) }
    ]);
    // Gate 9: Triton's own schedule -- S.SEMESTRAL_TRITON_MESES is the
    // frozen shared constant both engines' formulas are built on
    // (PORTAL-NEXT-08 Gate 49), not assumed identical to generic
    // Semestral/Anual; prazoTotal is derived from it (its own max), not
    // a separate hardcoded number.
    var tritonMeses = S.SEMESTRAL_TRITON_MESES;
    html += scheduleBlockHtml({ prazoTotal: Math.max.apply(null, tritonMeses), periodicidade: 'Semestral', meses: tritonMeses });
    setResult(html + '<p class="smFootnote">Entrada fixa por modelo — não permite alteração manual.</p>');
  }
  function calcDescobridor() {
    var r = N.calcularDescobridor({ financiado: UI.moneyVal('nFinanciado'), prazo: UI.numVal('nPrazoNum'), parcela: UI.moneyVal('nParcela') });
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var html = '<div class="resultHero"><p class="kpiLabel">Taxa efetiva mensal (CET)</p><p class="resultValue">' + UI.pct2(r.taxaCetMes) + '</p></div>';
    html += UI.secondaryGrid([{ label: 'Taxa nominal estimada', value: UI.pct2(r.taxaNet) }, { label: 'Total pago', value: UI.brl(r.total) }, { label: 'Juros totais', value: UI.brl(r.juros) }]);
    setResult(html);
  }
  function calcAntecipacao() {
    var tipo = UI.getSegmentedValue('nTipoAnt');
    // ANTECIPACAO-BALAO-1: real balloon data now reaches the engine
    // (was hardcoded `baloes: []` -- the root cause of the missing
    // feature; calcularAntecipacao() itself already validates range/
    // duplicate/value via BALAO_FORA_DO_PRAZO/BALAO_DUPLICADO/
    // BALAO_VALOR_INVALIDO, unchanged). Same filter + defensive cap
    // pattern already established for the Tradicional plan (BALAO-
    // LIMIT-1): only rows with both a month and a value participate.
    var validAntBaloes = antBaloes.filter(function (b) { return b.mes && b.valor; }).slice(0, ANT_BALAO_MAX).map(function (b) { return { mes: b.mes, valor: b.valor }; });
    var r = N.calcularAntecipacao({
      prazo: UI.numVal('nPrazoNum'), parcela: UI.moneyVal('nParcela'),
      primeiraParcela: UI.textVal('nPrimeira') ? new Date(UI.textVal('nPrimeira') + 'T00:00:00') : null,
      dataAntecipacao: UI.textVal('nData') ? new Date(UI.textVal('nData') + 'T00:00:00') : null,
      tipo: tipo, de: UI.numVal('nDe'), ate: UI.numVal('nAte'), parcelaUnica: UI.numVal('nParcelaUnicaNum'), baloes: validAntBaloes,
      tabelaAntecipacao: antecipacaoAuthority.getAuthority()
    });
    if (r.error) { setResult(UI.errorBlock(errMsg(r.error))); return; }
    var rows = r.rows.map(function (row) {
      // ANTECIPACAO-BALAO-1: identifies balloon rows explicitly (row.tipo,
      // already computed by the unmodified engine) -- Secure's own result
      // table does the same (modules/simulador-novos.html's aFluxo render).
      // Plain-text parenthetical suffix, matching the existing convention
      // already used elsewhere in this file (balloonScheduleSummary's own
      // "(parcela) + ... (balão)"), no new CSS component invented.
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
    var taxaPct = Number(String(UI.textVal('nTaxaCC')).replace(',', '.')) || 0;
    var r = CC.compute({ capital: UI.moneyVal('nCapital'), parcela: UI.moneyVal('nParcelaCC'), prazoMeses: UI.numVal('nPrazoCC'), taxaAplicacao: taxaPct / 100 });
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

  window.NX_SIMULADOR_NOVOS_PAGE = {
    // Exposed read-only for deterministic presentation testing
    // (tests/simulador-novos-presentation-test.py), same pattern
    // already used for window.NX_SCORE_PAGE.classifyScoreBand.
    balloonScheduleSummary: balloonScheduleSummary,
    balancedColumns: balancedColumns,
    // Exposed read-only for tests/simulador-novos-governed-authority-
    // test.py (V2_SIMULADOR_NOVOS_GOVERNED_AUTHORITY_MIGRATION) --
    // deterministic coverage/state verification without duplicating the
    // normalization logic in the test itself.
    getCampState: function () { return campState; },
    getCampAuthorityForTest: function () { return campAuthority; },
    render: function (outlet) {
      currentMode = MODES[0].id;
      balloons = [];
      antBaloes = [];
      openCategory = null; // SIM-NAV-4 / F.2: all categories collapsed on entry
      outlet.innerHTML =
        '<div class="smPage">' +
        '<span class="smProductBadge">Simulador · Novos</span>' +
        '<div class="modPageHeader"><div class="modHeaderMain"><h1 class="modTitle">Simulador de Financiamento — Novos</h1><p class="modSubtitle">Motores extraídos e verificados (PORTAL-NEXT-08) — 0 recálculo de fórmula nesta interface.</p></div>' + analystCtaHtml('simulador_novos') + '</div>' +
        '<div id="smModeNavRegion">' + modeNavHtml() + '</div>' +
        '<p class="smModeDesc" id="smModeDesc"></p>' +
        '<div class="smGrid" id="smMainGrid"><div class="modPanelForm smFormCard" id="smFormRegion"></div><div class="modPanelResult" id="smResultRegion" aria-live="polite" aria-atomic="true"></div></div>' +
        '</div>';
      wireModeNav();
      wireAnalystCta();
      renderModeArea();
      return Promise.resolve();
    }
  };
})();
