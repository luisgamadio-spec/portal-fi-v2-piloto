/* PORTAL-NEXT V2 — Focus keeper (13/10/2026).

   Problema recorrente: várias telas redesenham o painel inteiro (innerHTML)
   a cada letra digitada numa caixa de busca. O <input> em que a pessoa está
   digitando é destruído e recriado, e o foco/cursor se perde ("preciso
   clicar de novo a cada letra").

   Componente comum, para não depender de cada tela: quando o campo de texto
   que tinha o foco é REMOVIDO do documento por um redesenho e aparece um
   novo campo com o MESMO id, o foco e a posição do cursor são devolvidos a
   ele. Não rouba foco: só age se o foco "caiu" (nenhum outro elemento
   recebeu o foco) e o novo campo tem o mesmo id. */
(function () {
  'use strict';

  var TIPOS = { text: 1, search: 1, email: 1, tel: 1, url: 1, number: 1, password: 1 };
  var ultimo = null; // { id, inicio, fim, el }

  function ehCampoDeTexto(el) {
    if (!el || !el.id) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !!TIPOS[(el.getAttribute('type') || 'text').toLowerCase()];
  }
  function lembrar(el) {
    var inicio = null, fim = null;
    try { inicio = el.selectionStart; fim = el.selectionEnd; } catch (e) { /* type=number não expõe seleção */ }
    ultimo = { id: el.id, inicio: inicio, fim: fim, el: el };
  }

  document.addEventListener('focusin', function (ev) {
    if (ehCampoDeTexto(ev.target)) lembrar(ev.target); else ultimo = null;
  }, true);
  ['input', 'keyup', 'select', 'click'].forEach(function (tipo) {
    document.addEventListener(tipo, function (ev) {
      if (ultimo && ev.target === ultimo.el) lembrar(ev.target);
    }, true);
  });

  function restaurar() {
    if (!ultimo || ultimo.el.isConnected) return;            // o campo ainda existe: nada a fazer
    var ativo = document.activeElement;
    if (ativo && ativo !== document.body && ativo !== document.documentElement) { ultimo = null; return; } // foco foi para outro lugar de propósito
    var novo = document.getElementById(ultimo.id);
    if (!ehCampoDeTexto(novo) || novo.disabled || novo.readOnly) return;
    var alvo = ultimo;
    novo.focus({ preventScroll: true });
    try {
      var n = novo.value.length;
      var ini = alvo.inicio == null ? n : Math.min(alvo.inicio, n);
      var fim = alvo.fim == null ? n : Math.min(alvo.fim, n);
      novo.setSelectionRange(ini, fim);
    } catch (e) { /* tipos sem seleção */ }
    lembrar(novo);
  }

  if (typeof MutationObserver === 'function') {
    var obs = new MutationObserver(function () { if (ultimo && !ultimo.el.isConnected) restaurar(); });
    var iniciar = function () { obs.observe(document.body, { childList: true, subtree: true }); };
    if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
  }

  window.NX_FOCUS_KEEPER = { restaurar: restaurar, _estado: function () { return ultimo && { id: ultimo.id, conectado: ultimo.el.isConnected }; } };
})();
