/* PORTAL-NEXT V2 — Password Recovery (AUTH-RECOVERY-01).

   "Esqueci minha senha" made functional, mirroring the exact security
   architecture already proven by assets/js/first-access.js (AUTH-
   ACCESS-06) and its real backend (activation-request/-complete):
   public Edge Functions, server-side Turnstile verification, server-
   side rate limiting, single-use hash-only tokens, environment-aware
   redirect construction (never a client-supplied URL), and a generic,
   non-disclosing response regardless of whether the submitted e-mail
   matches a real account.

   Unlike Primeiro Acesso, recovery targets an e-mail the account
   ALREADY owns and has already verified (usuarios.email_auth) -- there
   is no new address to confirm, so this flow needs only ONE token
   (request -> set new password), not activation's two-step email-
   verify-then-continuation-token dance.

   IMPORTANT (AUTH-RECOVERY-01 Section 5): the two Edge Functions this
   file calls (password-recovery-request, password-recovery-complete)
   are PREPARED, not deployed -- see backend-proposals/auth-recovery-01/
   for their full source and the SQL migration they depend on. Until a
   human with real backend access deploys them, submitting this form
   for real will fail with a network/404 error (handled gracefully,
   never shown as a false success) -- this file's own logic, validation,
   and UI are complete and real, only the server side is pending
   deployment authorization. */
(function () {
  'use strict';

  var cfg = window.NX_INTELLIGENCE_CONFIG || {};
  var SUPABASE_URL = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var SUPABASE_ANON_KEY = String(cfg.supabasePublishableKey || '');

  function fn(name) { return SUPABASE_URL + '/functions/v1/' + name; }

  var ERRO_MENSAGENS = {
    EMAIL_INVALIDO: 'Digite um e-mail válido.',
    RATE_LIMIT: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    CAPTCHA_INVALIDO: 'A verificação de segurança falhou. Tente novamente.',
    FALHA_ENVIO_EMAIL: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
    TOKEN_INVALIDO: 'Este link não é válido. Solicite uma nova recuperação de senha.',
    SENHA_CURTA: 'A senha deve ter no mínimo 8 caracteres.',
    SENHA_FRACA: 'A senha deve conter letras e números.',
    SENHAS_NAO_COINCIDEM: 'As senhas não coincidem.',
    // AUTH-RECOVERY-04 Section 5: neutral by design -- never asserts the
    // password WAS changed nor that it was NOT (the backend genuinely
    // doesn't know either, see codigo RESULTADO_INDETERMINADO). Names a
    // safe next step without exposing any internal audit/state detail.
    RESULTADO_INDETERMINADO: 'Não foi possível confirmar o resultado desta solicitação. Se sua nova senha já funcionar ao entrar, a redefinição foi concluída. Caso contrário, solicite uma nova recuperação de senha.'
  };

  var STEPS = ['pwStepEmail', 'pwStepSent', 'pwStepPassword', 'pwStepDone'];
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

  function getCaptchaToken(hostId) {
    if (!window.NX_LOGIN || !window.NX_LOGIN.turnstileSiteKey) return Promise.resolve('');
    return window.NX_LOGIN.loadTurnstileScript()
      .then(function (api) { return window.NX_LOGIN.renderAndExecuteTurnstile(hostId, api); })
      .catch(function () {
        throw new Error('A verificação de segurança falhou. Tente novamente.');
      });
  }

  var mounted = false;
  var recoveryToken = '';

  function ensureMounted() {
    var panel = document.getElementById('passwordRecoveryPanel');
    if (mounted || !panel) return;

    panel.innerHTML =
      '<div id="pwStepEmail" class="faStep">' +
        '<p class="loginAssistNote">Informe o e-mail da sua conta. Se houver uma conta elegível para este e-mail, você receberá as instruções de recuperação.</p>' +
        '<div class="loginField">' +
          '<label for="pwEmailInput">E-mail</label>' +
          '<input id="pwEmailInput" type="email" autocomplete="username" placeholder="seuemail@exemplo.com">' +
        '</div>' +
        '<div id="pwEmailMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<div id="pwEmailTurnstile" class="loginTurnstile"></div>' +
        '<button type="button" id="pwBtnEnviar" class="faBtnPrimary">Enviar instruções</button>' +
      '</div>' +
      '<div id="pwStepSent" class="faStep" hidden>' +
        '<p class="loginAssistNote">Se houver uma conta elegível para este e-mail, você receberá as instruções de recuperação. Verifique também sua pasta de spam.</p>' +
        '<p class="loginAssistNote">O link recebido expira em 30 minutos.</p>' +
        '<button type="button" id="pwBtnOutroEmail" class="faBtnSecondary">Usar outro e-mail</button>' +
      '</div>' +
      '<div id="pwStepPassword" class="faStep" hidden>' +
        '<p class="loginAssistNote">Defina a nova senha da sua conta.</p>' +
        '<div class="loginField"><label for="pwSenhaNova">Nova senha</label><input id="pwSenhaNova" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres, com letras e números"></div>' +
        '<div class="loginField"><label for="pwSenhaConfirmar">Confirmar nova senha</label><input id="pwSenhaConfirmar" type="password" autocomplete="new-password" placeholder="Repita a senha"></div>' +
        '<div id="pwSenhaMsg" class="loginStatus" role="status" aria-live="polite" hidden></div>' +
        '<button type="button" id="pwBtnRedefinir" class="faBtnPrimary">Redefinir senha</button>' +
      '</div>' +
      '<div id="pwStepDone" class="faStep" hidden>' +
        '<p class="loginAssistNote">Sua senha foi redefinida com sucesso. Entre com seu e-mail e a nova senha.</p>' +
        '<button type="button" id="pwBtnIrLogin" class="faBtnPrimary">Ir para o login</button>' +
      '</div>';

    document.getElementById('pwBtnEnviar').addEventListener('click', solicitar);
    document.getElementById('pwBtnOutroEmail').addEventListener('click', function () {
      document.getElementById('pwEmailInput').value = '';
      setMsg('pwEmailMsg', null);
      showStep('pwStepEmail');
    });
    document.getElementById('pwBtnRedefinir').addEventListener('click', redefinir);
    document.getElementById('pwBtnIrLogin').addEventListener('click', function () {
      recoveryToken = '';
      document.getElementById('passwordRecoveryDetails').open = false;
      document.getElementById('pwEmailInput').value = '';
      setMsg('pwEmailMsg', null);
      showStep('pwStepEmail');
    });

    mounted = true;

    // Mirrors first-access.js's #continuar= handoff exactly, with a
    // distinct hash key (#recuperar-senha=) so the two flows can never
    // collide if both links were somehow opened from the same address.
    var hash = location.hash || '';
    var match = hash.match(/(?:^#|&)recuperar-senha=([^&]+)/);
    if (match) {
      recoveryToken = decodeURIComponent(match[1]);
      history.replaceState(null, '', location.pathname + location.search);
      var details = document.getElementById('passwordRecoveryDetails');
      if (details) details.open = true;
      showStep('pwStepPassword');
    }
  }

  function solicitar() {
    var email = (document.getElementById('pwEmailInput').value || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMsg('pwEmailMsg', ERRO_MENSAGENS.EMAIL_INVALIDO, 'error');
      return;
    }
    var btn = document.getElementById('pwBtnEnviar');
    btn.disabled = true;
    setMsg('pwEmailMsg', 'Enviando...');
    getCaptchaToken('pwEmailTurnstile').then(function (captchaToken) {
      return fetch(fn('password-recovery-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: email, captchaToken: captchaToken })
      });
    }).then(function (resp) {
      if (resp.status === 429) { setMsg('pwEmailMsg', ERRO_MENSAGENS.RATE_LIMIT, 'error'); return null; }
      if (resp.status === 403) { setMsg('pwEmailMsg', ERRO_MENSAGENS.CAPTCHA_INVALIDO, 'error'); return null; }
      return resp.json().catch(function () { return { success: false }; }).then(function (data) { return { ok: resp.ok, data: data }; });
    }).then(function (r) {
      if (!r) return;
      // AUTH-RECOVERY-02 Section 9: a real defect was caught here -- this
      // branch used to show "sent" unconditionally, so a genuine backend
      // failure (500, malformed response, function not yet deployed)
      // would have shown a FALSE success. r.ok/success is now the real
      // gate; the generic-response *content* still never distinguishes a
      // real account from a non-existent one (enumeration protection,
      // brief Section 4) -- only "the request truly failed" is now
      // told apart from "the request succeeded, whatever the account's
      // real eligibility turned out to be server-side."
      if (!r.ok || !r.data || r.data.success !== true) {
        setMsg('pwEmailMsg', ERRO_MENSAGENS.FALHA_ENVIO_EMAIL, 'error');
        return;
      }
      setMsg('pwEmailMsg', null);
      showStep('pwStepSent');
    }).catch(function () {
      setMsg('pwEmailMsg', ERRO_MENSAGENS.FALHA_ENVIO_EMAIL, 'error');
    }).finally(function () { btn.disabled = false; });
  }

  function validarSenhaLocal(senha) {
    if (senha.length < 8) return ERRO_MENSAGENS.SENHA_CURTA;
    if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) return ERRO_MENSAGENS.SENHA_FRACA;
    return '';
  }

  function redefinir() {
    if (!recoveryToken) { setMsg('pwSenhaMsg', 'Sessão de recuperação expirada. Reabra o link recebido por e-mail.', 'error'); return; }
    var senha = document.getElementById('pwSenhaNova').value || '';
    var confirmar = document.getElementById('pwSenhaConfirmar').value || '';
    if (senha !== confirmar) { setMsg('pwSenhaMsg', ERRO_MENSAGENS.SENHAS_NAO_COINCIDEM, 'error'); return; }
    var erroLocal = validarSenhaLocal(senha);
    if (erroLocal) { setMsg('pwSenhaMsg', erroLocal, 'error'); return; }
    var btn = document.getElementById('pwBtnRedefinir');
    btn.disabled = true;
    setMsg('pwSenhaMsg', 'Redefinindo senha...');
    fetch(fn('password-recovery-complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: recoveryToken, novaSenha: senha, confirmarSenha: confirmar })
    }).then(function (resp) { return resp.json().catch(function () { return { success: false }; }); })
      .then(function (result) {
        if (result && result.success === true) {
          recoveryToken = '';
          setMsg('pwSenhaMsg', null);
          showStep('pwStepDone');
          return;
        }
        setMsg('pwSenhaMsg', ERRO_MENSAGENS[result && result.codigo] || 'Não foi possível redefinir a senha.', 'error');
      }).catch(function () {
        setMsg('pwSenhaMsg', 'Falha ao redefinir a senha. Tente novamente.', 'error');
      }).finally(function () { btn.disabled = false; });
  }

  window.NX_PASSWORD_RECOVERY = { mount: ensureMounted };
})();
