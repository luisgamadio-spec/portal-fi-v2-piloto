/* PORTAL-NEXT V2 -- "Falar com um Analista" shared attendance CTA
   authority (SIM-REG-01 restoration + Home/Novos/Seminovos expansion).

   SINGLE authority for all 3 entry points (Portal Home, Simulador
   Novos, Simulador Seminovos) -- the brief's own explicit requirement
   ("NÃO duplicar: telefone; URL; WhatsApp; analista; regra de
   roteamento; configuração; destino"). Every CTA button in the Portal
   calls window.NX_FI_ATENDIMENTO.falarComAnalista(origin) with only
   its own origin id differing -- 0 duplicated business logic.

   Business logic (destination, message, "first available analyst",
   error copy, 5s status toast) is preserved EXACTLY from the real,
   currently-live production implementation (assets/js/
   fi-atendimento.js in portal-financiamento-brabus-secure, confirmed
   byte-identical to the archived PORTAL-NEXT-08/.source/
   fi-atendimento-origin-main.js snapshot) -- only the transport call
   changed, from the iframe-era window.parent.portalCallAnalystFi()
   bridge to V2's own native window.NX_FI_ATENDIMENTO_PROVIDER.
   chamarAnalista() (same RPC -- chamar_analista_fi -- same window, no
   iframe boundary exists in V2's SPA architecture). No simulation
   context is sent -- the real historical implementation never sent
   one either (fixed greeting message only, "Olá, preciso de apoio em
   uma simulação F&I."), so none is invented here (brief §10). */
(function () {
  'use strict';

  function limparTelefone(valor) {
    return valor ? String(valor).replace(/\D/g, '') : '';
  }

  function mostrarStatusAnalista(mensagem) {
    var box = document.getElementById('statusAnalistaFI');
    if (!box) {
      box = document.createElement('div');
      box.id = 'statusAnalistaFI';
      box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:rgba(10,14,25,.96);color:#fff;padding:14px 18px;border-radius:14px;font-family:Arial,sans-serif;font-size:0.875rem;font-weight:700;box-shadow:0 12px 30px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.16);';
      document.body.appendChild(box);
    }
    box.textContent = mensagem;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(function () { box.style.display = 'none'; }, 5000);
  }

  // origin: SIM-REG-01 §13 -- technically distinguishable CTA source
  // (portal_home | simulador_novos | simulador_seminovos), logged
  // locally only (console.info) -- no analytics/telemetry backend
  // created this Wave, per the brief's own explicit prohibition. The
  // same string is also what each button's own data-analyst-origin
  // attribute carries, so it is inspectable in the DOM independent of
  // this console line too.
  function falarComAnalista(origin) {
    mostrarStatusAnalista('Procurando analista disponível...');
    if (!window.NX_FI_ATENDIMENTO_PROVIDER || typeof window.NX_FI_ATENDIMENTO_PROVIDER.chamarAnalista !== 'function') {
      mostrarStatusAnalista('Não foi possível localizar um analista agora.');
      return;
    }
    window.NX_FI_ATENDIMENTO_PROVIDER.chamarAnalista().then(function (data) {
      if (!data.length) {
        mostrarStatusAnalista('Nenhum analista disponível no momento.');
        return;
      }
      var analista = data[0];
      var telefone = limparTelefone(analista.whatsapp);
      if (!telefone) {
        mostrarStatusAnalista('Analista encontrado, mas WhatsApp não cadastrado.');
        return;
      }
      if (window.NX_DEV) window.NX_DEV.log('[fi-atendimento] origem do clique:', origin || '(não informado)');
      mostrarStatusAnalista('Analista encontrado: ' + String(analista.nome || '') + '. Abrindo WhatsApp...');
      var mensagem = encodeURIComponent('Olá, preciso de apoio em uma simulação F&I.');
      setTimeout(function () {
        window.open('https://wa.me/' + telefone + '?text=' + mensagem, '_blank', 'noopener');
      }, 800);
    }, function (error) {
      console.error('Falha ao solicitar atendimento F&I:', error);
      var msg = (error && error.state === 'SESSION_EXPIRED') ? 'Sessão expirada. Faça login novamente.' : 'Não foi possível localizar um analista agora.';
      mostrarStatusAnalista(msg);
    });
  }

  window.NX_FI_ATENDIMENTO = { falarComAnalista: falarComAnalista };
})();
