/* Tamanho do texto: Normal / Grande (botão A+ no topo). Guardado no navegador
   (localStorage 'nxFonte', sempre em try/catch). Aplica o atributo data-fonte
   no <html>; a escala em si está em assets/css/font-scale.css. O valor salvo
   já é aplicado no <head> do index.html, antes da primeira pintura. */
(function () {
  'use strict';
  var CHAVE = 'nxFonte';
  function ler() { try { return localStorage.getItem(CHAVE) === 'grande' ? 'grande' : 'normal'; } catch (e) { return 'normal'; } }
  function aplicar(nivel) {
    var html = document.documentElement;
    if (nivel === 'grande') html.setAttribute('data-fonte', 'grande'); else html.removeAttribute('data-fonte');
    document.querySelectorAll('.pFontToggle').forEach(function (b) {
      b.setAttribute('aria-pressed', nivel === 'grande' ? 'true' : 'false');
      b.title = nivel === 'grande' ? 'Texto grande (clique para voltar ao normal)' : 'Aumentar o texto';
    });
  }
  function definir(nivel) {
    try { localStorage.setItem(CHAVE, nivel); } catch (e) { /* sem armazenamento: vale só nesta página */ }
    aplicar(nivel);
  }
  function botaoHtml() {
    var g = ler() === 'grande';
    return '<button type="button" class="pFontToggle" aria-label="Tamanho do texto" aria-pressed="' + (g ? 'true' : 'false') + '" title="' +
      (g ? 'Texto grande (clique para voltar ao normal)' : 'Aumentar o texto') + '">A+</button>';
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('.pFontToggle');
    if (!b) return;
    var html = document.documentElement;
    definir(html.getAttribute('data-fonte') === 'grande' ? 'normal' : 'grande');
  });
  aplicar(ler());
  window.NX_FONTE = { nivel: function () { return document.documentElement.getAttribute('data-fonte') === 'grande' ? 'grande' : 'normal'; }, definir: definir, botaoHtml: botaoHtml };
})();
