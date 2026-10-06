/* PORTAL-NEXT V2 — Painel do Analista F&I (PA-1 migration).
   Functional contract discovered by direct source read of the real V1
   implementation (portal-financiamento-brabus-secure, assets/js/
   portal-app.js:2002-2043 -- showPainelAnalistaFi/
   atualizarResumoPainelAnalistaFi/alterarMeuStatusAnalistaFi), not
   redesigned or invented. Self-service queue-status control only --
   no call-center analytics, no CRM, no chat, no ticketing.

   Zero business math here. Every value comes from
   painel-analista-fi-real-provider.js's two live RPCs
   (operational_my_analyst_fi / atualizar_meu_status_analista_fi).
   Access is ANALISTA_OR_MASTER (config/module-registry.json), enforced
   centrally by auth-core.js's route guard before this file's render()
   ever runs -- this file does not re-implement that check. */
(function () {
  'use strict';

  var PROVIDER = window.NX_PAINEL_ANALISTA_FI_REAL_PROVIDER;

  // V2-SECURITY-02 (SEC-06): delegate a classified SESSION_EXPIRED
  // (painel-analista-fi-real-provider.js's own classifyError() maps
  // HTTP 401/403 to this state) to Auth Foundation's already
  // established handling, same as central-atendimento-fi.js.
  function reportIfSessionExpired(err) {
    if (err && err.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
      window.NX_AUTH_CORE.reportSessionExpired();
      return true;
    }
    return false;
  }

  // Exact V1 backend contract (portal-app.js:2012) -- 5 values, exact
  // accents/casing preserved, never invented/translated.
  var STATUSES = [
    { value: 'ONLINE', label: 'Online', icon: '🟢' },
    { value: 'OCUPADO', label: 'Ocupado', icon: '🟡' },
    { value: 'ALMOÇO', label: 'Almoço', icon: '🍽️' },
    { value: 'FÉRIAS', label: 'Férias', icon: '🌴' },
    { value: 'OFFLINE', label: 'Offline', icon: '⚫' }
  ];
  var FAIL_MSG = 'Não foi possível carregar seu status de atendimento. Tente novamente.';

  var panelState = 'LOADING'; // LOADING | READY | NOT_LINKED | ERROR
  var saving = false;
  var analista = null; // {status, atendimentos_hoje, ultimo_atendimento, ultimo_status_em}
  var outletRef = null;

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
  function statusClass(status) {
    var norm = String(status || 'OFFLINE').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z]/g, '');
    return 'paStatus' + norm;
  }
  function statusMeta(status) {
    for (var i = 0; i < STATUSES.length; i++) { if (STATUSES[i].value === status) return STATUSES[i]; }
    return { value: status, label: status || '—', icon: '⚫' };
  }

  function load() {
    panelState = 'LOADING';
    render(outletRef);
    return PROVIDER.loadMeuAnalista().then(function (row) {
      if (!row) {
        panelState = 'NOT_LINKED';
        render(outletRef);
        return;
      }
      analista = row;
      panelState = 'READY';
      render(outletRef);
    }).catch(function (err) {
      if (reportIfSessionExpired(err)) return;
      panelState = 'ERROR';
      render(outletRef);
    });
  }

  function alterarStatus(status) {
    if (saving) return;
    saving = true;
    render(outletRef);
    PROVIDER.atualizarMeuStatus(status).then(function (r) {
      saving = false;
      if (!r || !r.sucesso) {
        setMsg(r && r.mensagem ? r.mensagem : 'Não foi possível atualizar o status.', true);
        render(outletRef);
        return;
      }
      setMsg(r.mensagem || 'Status atualizado com sucesso.', false);
      // Non-optimistic (matches V1): re-fetch the authoritative record
      // rather than locally assuming the write applied as requested.
      load();
    }).catch(function (err) {
      saving = false;
      if (reportIfSessionExpired(err)) return;
      // V2-SECURITY-02 (SEC-01): unexpected-exception path (network/
      // transport failure), not the RPC's own curated r.mensagem
      // above -- never surface raw err.message here.
      setMsg('Erro ao atualizar status: não foi possível concluir a operação. Tente novamente.', true);
      render(outletRef);
    });
  }

  var pendingMsg = null;
  function setMsg(text, isErr) { pendingMsg = { text: text, isErr: isErr }; }

  function statusButtonsHtml() {
    return '<div class="paStatusGrid" role="group" aria-label="Alterar status de atendimento">' +
      STATUSES.map(function (s) {
        var active = analista && analista.status === s.value;
        return '<button type="button" class="paStatusBtn' + (active ? ' active' : '') + '" ' +
          'data-status="' + esc(s.value) + '" aria-pressed="' + (active ? 'true' : 'false') + '"' +
          (saving ? ' disabled' : '') + '>' +
          '<span class="paStatusIcon" aria-hidden="true">' + s.icon + '</span>' +
          '<span class="paStatusLabel">' + esc(s.label) + '</span>' +
          '</button>';
      }).join('') + '</div>';
  }

  function readyHtml() {
    var meta = statusMeta(analista.status);
    return (
      '<div class="paHero">' +
      '<div class="paHeroInfo"><p class="kpiLabel">Seu status atual</p>' +
      '<div class="paStatusPill ' + statusClass(analista.status) + '"><span aria-hidden="true">' + meta.icon + '</span> ' + esc(meta.label) + '</div>' +
      '<p class="paHeroNote">Somente o status <b>ONLINE</b> recebe novos chamados do botão "Falar com um analista" nos simuladores.</p>' +
      '</div></div>' +
      statusButtonsHtml() +
      '<div class="paCards">' +
      '<div class="paCard"><p class="kpiLabel">Atendimentos hoje</p><p class="paCardValue">' + esc(analista.atendimentos_hoje != null ? analista.atendimentos_hoje : 0) + '</p></div>' +
      '<div class="paCard"><p class="kpiLabel">Último atendimento</p><p class="paCardValue">' + esc(fmtDataHora(analista.ultimo_atendimento)) + '</p></div>' +
      '<div class="paCard"><p class="kpiLabel">Última atualização de status</p><p class="paCardValue">' + esc(fmtDataHora(analista.ultimo_status_em)) + '</p></div>' +
      '</div>' +
      '<div id="paMsg" class="paMsg" role="status" aria-live="polite"></div>'
    );
  }

  function bodyHtml() {
    if (panelState === 'LOADING') {
      return '<div class="paEmptyState">Carregando seu status de atendimento…</div>';
    }
    if (panelState === 'ERROR') {
      return '<div class="paErrorState">' + esc(FAIL_MSG) +
        '<button type="button" class="btn btn-secondary" id="paRetry" style="margin-top:12px">Tentar novamente</button></div>';
    }
    if (panelState === 'NOT_LINKED') {
      return '<div class="paErrorState">Não encontramos um cadastro de analista vinculado à sua conta. Fale com o time de administração do Portal.</div>';
    }
    return readyHtml();
  }

  function wire() {
    var retry = document.getElementById('paRetry');
    if (retry) retry.addEventListener('click', load);
    document.querySelectorAll('.paStatusBtn').forEach(function (btn) {
      btn.addEventListener('click', function () { alterarStatus(btn.getAttribute('data-status')); });
    });
    if (pendingMsg) {
      var msgEl = document.getElementById('paMsg');
      // Only consumed once actually applied -- the LOADING-state render
      // (bodyHtml() has no #paMsg) must not silently discard a message
      // set just before a refetch; it stays pending until the next
      // render that actually has somewhere to show it (READY/ERROR).
      if (msgEl) {
        msgEl.textContent = pendingMsg.text;
        msgEl.className = 'paMsg ' + (pendingMsg.isErr ? 'err' : 'ok');
        pendingMsg = null;
      }
    }
  }

  function render(outlet) {
    outletRef = outlet;
    outlet.innerHTML =
      '<div class="paPage">' +
      '<div class="modPageHeader"><div class="modHeaderMain">' +
      '<h1 class="modTitle">Painel do Analista F&amp;I</h1>' +
      '<p class="modSubtitle">Controle sua disponibilidade na fila de atendimento.</p>' +
      '</div></div>' +
      '<div class="paBody">' + bodyHtml() + '</div>' +
      '</div>';
    wire();
  }

  window.NX_PAINEL_ANALISTA_FI_PAGE = {
    // Exposed read-only for deterministic testing, same pattern already
    // used by window.NX_SCORE_PAGE / window.NX_SIMULADOR_NOVOS_PAGE.
    getPanelState: function () { return panelState; },
    render: function (outlet) {
      outletRef = outlet;
      panelState = 'LOADING';
      saving = false;
      analista = null;
      pendingMsg = null;
      return load();
    }
  };
})();
