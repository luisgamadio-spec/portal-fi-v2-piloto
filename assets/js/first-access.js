/* PORTAL-NEXT V2 — First Access (AUTH-ACCESS-06).

   Ports V1's real, already-deployed "ATIVAR MEU ACESSO" flow (Fases
   4.1-4.3, portal-financiamento-brabus-secure-orch1's portal-app.js)
   into the Design LAB login. This file owns ONLY the UI/wiring for
   #firstAccessPanel (a container assets/js/login.js declares empty
   and mounts this module into) -- it never touches login.js's own
   normal-login submit handler, auth-core, or auth-boundary.

   Every network call below hits the SAME real Edge Functions V1 uses,
   with the SAME payload shapes and the SAME error codes -- no new
   backend, no new RPC, no new crypto, no parallel credential system.
   Eligibility, rate limiting, CAPTCHA verification, and the
   ativacao_acesso_global feature flag are enforced entirely
   server-side, exactly as before; this file never re-implements or
   second-guesses any of that. */
(function () {
  'use strict';

  var cfg = window.NX_INTELLIGENCE_CONFIG || {};
  var SUPABASE_URL = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var SUPABASE_ANON_KEY = String(cfg.supabasePublishableKey || '');

  function fn(name) { return SUPABASE_URL + '/functions/v1/' + name; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
    });
  }

  var LOJAS = ['ABC', 'ALPHAVILLE', 'ANALIA FRANCO', 'BANDEIRANTES', 'BARRA FUNDA', 'EUROPA', 'GASTAO', 'NACOES'];

  // Same error-code -> message map as V1's ATIVACAO_ERRO_MENSAGENS
  // (portal-app.js) -- reused verbatim, not reworded, so behavior a
  // real user already knows from V1 stays identical in V2.
  var ERRO_MENSAGENS = {
    CPF_INVALIDO: 'CPF inválido.',
    NAO_ELEGIVEL: 'Este CPF não está elegível para ativação no momento.',
    ATIVACAO_INDISPONIVEL: 'Este CPF não está elegível para ativação no momento.',
    EMAIL_INVALIDO: 'Digite um e-mail válido.',
    EMAIL_FICTICIO_NAO_PERMITIDO: 'Use seu e-mail real — não um e-mail interno/fictício.',
    EMAIL_JA_EM_USO: 'Este e-mail já está em uso por outra conta ou ativação.',
    CELULAR_INVALIDO: 'Digite um celular válido, com DDD.',
    LOJA_INVALIDA: 'Selecione uma loja válida.',
    NBS_INVALIDO: 'Login NBS inválido.',
    ATIVACAO_EM_ESTADO_NAO_EDITAVEL: 'Esta ativação já avançou para uma etapa seguinte e não pode mais ser editada aqui.',
    AGUARDE_COOLDOWN: 'Aguarde antes de reenviar.',
    RATE_LIMIT: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    CAPTCHA_INVALIDO: 'A verificação de segurança falhou. Tente novamente.',
    FALHA_ENVIO_EMAIL: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
    TOKEN_INVALIDO: 'Este link não é válido. Reabra o e-mail de confirmação mais recente.',
    SENHA_CURTA: 'A senha deve ter no mínimo 8 caracteres.',
    SENHA_FRACA: 'A senha deve conter letras e números.',
    SENHAS_NAO_COINCIDEM: 'As senhas não coincidem.',
    FALHA_AO_ATIVAR: 'Não foi possível ativar seu acesso agora. Tente novamente em instantes.',
    FINALIZACAO_PENDENTE: 'Sua senha foi definida, mas a conclusão está pendente. Tente novamente em instantes.'
  };

  var STEPS = ['faStepCpf', 'faStepGeneric', 'faStepForm', 'faStepSent', 'faStepPassword', 'faStepDone'];
  function showStep(id) {
    STEPS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.hidden = (s !== id);
    });
  }

  function setMsg(elId, text, kind) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'loginStatus ' + (kind === 'error' ? 'loginStatusError' : 'loginStatusInfo');
    el.textContent = text;
  }

  // Same visual-only mask as V1's ativacaoFormatarCelular -- the
  // payload sent to activation-request always strips non-digits first
  // (faEnviarVerificacao below), so the mask never affects the real
  // request body, only what the user sees while typing.
  function formatarCelular(digits) {
    var d = String(digits || '').replace(/\D/g, '').slice(0, 11);
    var out = '';
    if (d.length > 0) out += '(' + d.slice(0, 2);
    if (d.length >= 2) out += ') '; else return out;
    if (d.length > 2) out += d.slice(2, 3);
    if (d.length > 3) out += ' ' + d.slice(3, 7);
    if (d.length > 7) out += ' ' + d.slice(7, 11);
    return out;
  }

  function getCaptchaToken(hostId) {
    if (!window.NX_LOGIN || !window.NX_LOGIN.turnstileSiteKey) return Promise.resolve('');
    return window.NX_LOGIN.loadTurnstileScript()
      .then(function (api) { return window.NX_LOGIN.renderAndExecuteTurnstile(hostId, api); })
      .catch(function () {
        throw new Error('A verificação de segurança falhou. Tente novamente.');
      });
  }

  var mounted = false;
  var cpfIdentificado = '';
  var ultimoEnvioEm = 0;
  var continuationToken = '';

  function ensureMounted() {
    var panel = document.getElementById('firstAccessPanel');
    if (mounted || !panel) return;

    panel.innerHTML =
      '<div id="faStepCpf" class="faStep">' +
        '<p class="loginAssistNote">Informe seu CPF para localizar seu cadastro. O CPF não é usado para entrar — apenas para identificar seu acesso.</p>' +
        '<div class="loginField">' +
          '<label for="faCpfInput">CPF</label>' +
          '<input id="faCpfInput" inputmode="numeric" autocomplete="off" placeholder="Somente números">' +
        '</div>' +
        '<div id="faCpfMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<div id="faCpfTurnstile" class="loginTurnstile"></div>' +
        '<button type="button" id="faBtnIdentificar" class="faBtnPrimary">Identificar</button>' +
      '</div>' +
      '<div id="faStepGeneric" class="faStep" hidden>' +
        '<p class="loginAssistNote">Se este CPF pertencer a um cadastro elegível para ativação, você verá os próximos passos aqui.</p>' +
        '<p class="loginAssistNote">Se você já possui acesso com e-mail, utilize <b>Entrar</b> ou <b>Esqueci minha senha</b>.</p>' +
        '<button type="button" id="faBtnGenericoVoltar" class="faBtnSecondary">Voltar</button>' +
      '</div>' +
      '<div id="faStepForm" class="faStep" hidden>' +
        '<div class="loginField"><label>Nome identificado</label><input id="faNomeMascarado" readonly disabled></div>' +
        '<div class="loginField"><label for="faLojaSel">Loja</label><select id="faLojaSel"><option value="">Selecione</option>' +
          LOJAS.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="loginField"><label for="faEmailInput">E-mail</label><input id="faEmailInput" type="email" autocomplete="email" placeholder="seuemail@exemplo.com"></div>' +
        '<div class="loginField"><label for="faCelularInput">Celular</label><input id="faCelularInput" inputmode="numeric" autocomplete="tel" placeholder="(11) 9 9999 9999"></div>' +
        '<div class="loginField"><label for="faNbsInput">Login NBS</label><input id="faNbsInput" autocomplete="off" placeholder="Login NBS (se souber)"></div>' +
        '<div id="faFormMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<div id="faFormTurnstile" class="loginTurnstile"></div>' +
        '<button type="button" id="faBtnEnviar" class="faBtnPrimary">Enviar verificação</button>' +
        '<button type="button" id="faBtnFormCancelar" class="faBtnSecondary">Cancelar</button>' +
      '</div>' +
      '<div id="faStepSent" class="faStep" hidden>' +
        '<p class="loginAssistNote">Enviamos uma mensagem de confirmação para o e-mail informado. Clique no link recebido para confirmar o endereço. O link expira em 30 minutos.</p>' +
        '<p class="loginAssistNote">Não encontrou a mensagem? Verifique também sua pasta de spam.</p>' +
        '<div id="faSentMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<button type="button" id="faBtnReenviar" class="faBtnPrimary">Reenviar verificação</button>' +
        '<button type="button" id="faBtnOutroEmail" class="faBtnSecondary">Usar outro e-mail</button>' +
      '</div>' +
      '<div id="faStepPassword" class="faStep" hidden>' +
        '<p class="loginAssistNote">Defina a senha que você usará para acessar o Portal F&amp;I a partir de agora.</p>' +
        '<div class="loginField"><label for="faSenhaNova">Nova senha</label><input id="faSenhaNova" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres, com letras e números"></div>' +
        '<div class="loginField"><label for="faSenhaConfirmar">Confirmar nova senha</label><input id="faSenhaConfirmar" type="password" autocomplete="new-password" placeholder="Repita a senha"></div>' +
        '<div id="faSenhaMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<button type="button" id="faBtnAtivar" class="faBtnPrimary">Ativar meu acesso</button>' +
      '</div>' +
      '<div id="faStepDone" class="faStep" hidden>' +
        '<p class="loginAssistNote">Seu acesso ao Portal F&amp;I foi ativado com sucesso. A partir de agora, utilize seu e-mail e sua nova senha.</p>' +
        '<button type="button" id="faBtnIrLogin" class="faBtnPrimary">Ir para o login</button>' +
      '</div>';

    document.getElementById('faBtnIdentificar').addEventListener('click', identificar);
    document.getElementById('faBtnGenericoVoltar').addEventListener('click', function () { resetParaCpf(); showStep('faStepCpf'); });
    document.getElementById('faCelularInput').addEventListener('input', function () {
      var atEnd = this.selectionStart === this.value.length;
      this.value = formatarCelular(this.value);
      if (atEnd) this.setSelectionRange(this.value.length, this.value.length);
    });
    document.getElementById('faBtnEnviar').addEventListener('click', function () { enviarVerificacao(false); });
    document.getElementById('faBtnFormCancelar').addEventListener('click', function () { resetParaCpf(); showStep('faStepCpf'); });
    document.getElementById('faBtnReenviar').addEventListener('click', function () { enviarVerificacao(true); });
    document.getElementById('faBtnOutroEmail').addEventListener('click', function () {
      document.getElementById('faEmailInput').value = '';
      setMsg('faFormMsg', null);
      showStep('faStepForm');
    });
    document.getElementById('faBtnAtivar').addEventListener('click', concluir);
    document.getElementById('faBtnIrLogin').addEventListener('click', function () {
      continuationToken = '';
      document.getElementById('firstAccessDetails').open = false;
      resetParaCpf();
      showStep('faStepCpf');
    });

    mounted = true;

    // AUTH-ACCESS-06 Section 8/10: the real, CURRENT V1 contract (Fase
    // 4.8) no longer gates button visibility on ?ativacao=1 -- that
    // query param only ever controlled homologation-era visibility,
    // never a security boundary (see portal-app.js's own
    // initAtivarAcessoGate comment). Only the #continuar= fragment is
    // load-bearing: it carries the one-time continuation token issued
    // by confirm-access-activation, read here exactly as V1 reads it
    // (fragment only, never sent in any HTTP request, stripped from
    // the address bar before any network call).
    var hash = location.hash || '';
    var match = hash.match(/(?:^#|&)continuar=([^&]+)/);
    if (match) {
      continuationToken = decodeURIComponent(match[1]);
      history.replaceState(null, '', location.pathname + location.search);
      var details = document.getElementById('firstAccessDetails');
      if (details) details.open = true;
      showStep('faStepPassword');
    }
  }

  function resetParaCpf() {
    cpfIdentificado = '';
    var cpfInput = document.getElementById('faCpfInput'); if (cpfInput) cpfInput.value = '';
    setMsg('faCpfMsg', null);
  }

  function identificar() {
    var cpf = (document.getElementById('faCpfInput').value || '').replace(/\D/g, '');
    if (cpf.length !== 11) { setMsg('faCpfMsg', 'Digite um CPF válido (somente números).', 'error'); return; }
    var btn = document.getElementById('faBtnIdentificar');
    btn.disabled = true;
    setMsg('faCpfMsg', 'Verificando...');
    getCaptchaToken('faCpfTurnstile').then(function (captchaToken) {
      return fetch(fn('activation-lookup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ cpf: cpf, captchaToken: captchaToken })
      });
    }).then(function (resp) {
      if (resp.status === 403) { setMsg('faCpfMsg', ERRO_MENSAGENS.CAPTCHA_INVALIDO, 'error'); return null; }
      if (resp.status === 429) { setMsg('faCpfMsg', ERRO_MENSAGENS.RATE_LIMIT, 'error'); return null; }
      return resp.json().catch(function () { return { elegivel: false }; });
    }).then(function (result) {
      if (!result) return;
      setMsg('faCpfMsg', null);
      if (result.elegivel === true) {
        cpfIdentificado = cpf;
        document.getElementById('faNomeMascarado').value = result.nomeMascarado || '';
        showStep('faStepForm');
      } else {
        showStep('faStepGeneric');
      }
    }).catch(function (e) {
      setMsg('faCpfMsg', 'Não foi possível verificar agora: ' + String((e && e.message) || e), 'error');
    }).finally(function () { btn.disabled = false; });
  }

  function enviarVerificacao(isReenvio) {
    var msgElId = isReenvio ? 'faSentMsg' : 'faFormMsg';
    if (!cpfIdentificado) { setMsg(msgElId, 'Sessão de identificação expirada. Reinicie a ativação.', 'error'); return; }
    var email = (document.getElementById('faEmailInput').value || '').trim().toLowerCase();
    var celular = (document.getElementById('faCelularInput').value || '').replace(/\D/g, '');
    var loja = document.getElementById('faLojaSel').value || '';
    var nbs = (document.getElementById('faNbsInput').value || '').trim();
    if (!isReenvio) {
      if (!email) { setMsg(msgElId, 'Informe o e-mail.', 'error'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg(msgElId, 'Digite um e-mail válido.', 'error'); return; }
    }
    var cooldownRestante = 60 - Math.floor((Date.now() - ultimoEnvioEm) / 1000);
    if (ultimoEnvioEm && cooldownRestante > 0) { setMsg(msgElId, 'Aguarde ' + cooldownRestante + 's antes de tentar novamente.', 'error'); return; }
    var btnId = isReenvio ? 'faBtnReenviar' : 'faBtnEnviar';
    var btn = document.getElementById(btnId);
    btn.disabled = true;
    setMsg(msgElId, 'Enviando verificação...');
    getCaptchaToken('faFormTurnstile').then(function (captchaToken) {
      return fetch(fn('activation-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ cpf: cpfIdentificado, captchaToken: captchaToken, email: email, celular: celular, loja: loja, nbs: nbs })
      });
    }).then(function (resp) { return resp.json().catch(function () { return { success: false }; }).then(function (data) { return { ok: resp.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok || r.data.success !== true) {
          setMsg(msgElId, ERRO_MENSAGENS[r.data.codigo] || 'Não foi possível enviar a verificação.', 'error');
          return;
        }
        ultimoEnvioEm = Date.now();
        setMsg('faFormMsg', null);
        showStep('faStepSent');
      }).catch(function (e) {
        setMsg(msgElId, 'Falha ao enviar verificação: ' + String((e && e.message) || e), 'error');
      }).finally(function () { btn.disabled = false; });
  }

  function validarSenhaLocal(senha) {
    if (senha.length < 8) return ERRO_MENSAGENS.SENHA_CURTA;
    if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return ERRO_MENSAGENS.SENHA_FRACA;
    return '';
  }

  function concluir() {
    if (!continuationToken) { setMsg('faSenhaMsg', 'Sessão de ativação expirada. Reabra o link recebido por e-mail.', 'error'); return; }
    var senha = document.getElementById('faSenhaNova').value || '';
    var confirmar = document.getElementById('faSenhaConfirmar').value || '';
    if (senha !== confirmar) { setMsg('faSenhaMsg', ERRO_MENSAGENS.SENHAS_NAO_COINCIDEM, 'error'); return; }
    var erroLocal = validarSenhaLocal(senha);
    if (erroLocal) { setMsg('faSenhaMsg', erroLocal, 'error'); return; }
    var btn = document.getElementById('faBtnAtivar');
    btn.disabled = true;
    setMsg('faSenhaMsg', 'Ativando acesso...');
    fetch(fn('activation-complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ continuationToken: continuationToken, novaSenha: senha, confirmarSenha: confirmar })
    }).then(function (resp) { return resp.json().catch(function () { return { success: false }; }); })
      .then(function (result) {
        if (result && (result.success === true || result.codigo === 'JA_CONCLUIDA')) {
          continuationToken = '';
          setMsg('faSenhaMsg', null);
          showStep('faStepDone');
          return;
        }
        setMsg('faSenhaMsg', ERRO_MENSAGENS[result && result.codigo] || 'Não foi possível concluir a ativação.', 'error');
      }).catch(function (e) {
        setMsg('faSenhaMsg', 'Falha ao concluir: ' + String((e && e.message) || e), 'error');
      }).finally(function () { btn.disabled = false; });
  }

  window.NX_FIRST_ACCESS = { mount: ensureMounted };
})();
