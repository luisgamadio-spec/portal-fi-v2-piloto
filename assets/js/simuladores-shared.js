/* PORTAL-NEXT V2 — Simuladores shared UI helpers (PORTAL-NEXT-08.1).
   Presentation-only: formatting, generic field builders, generic
   result-block builders. Contains ZERO business logic — every
   calculation call goes through the PORTAL-NEXT-08 frozen adapters
   (window.NX_SIMULADOR_SHARED/_NOVOS_ADAPTER/_SEMINOVOS_ADAPTER/
   _CAMPANHA_ADAPTER/_CASH_CONVERSION_ADAPTER). Money parsing reuses
   NX_SIMULADOR_SHARED.parseBRL (Gate 18: do not alter parseBRL
   semantics invisibly). */
(function () {
  'use strict';

  var S = window.NX_SIMULADOR_SHARED;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function brl(n) {
    if (n == null || !isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  // Digits-only currency formatting (no "R$"), for re-formatting the
  // RAW VALUE of an .inputAffix input on blur -- the .prefix span
  // already renders "R$" separately; writing brl()'s own "R$ ..." into
  // the input's value produced a real, human-caught "R$ R$ ..." bug
  // (PORTAL-NEXT-08.2 Change 3). Presentation only -- parseBRL's own
  // parsing semantics are untouched.
  function brlDigits(n) {
    if (n == null || !isFinite(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct1(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  function pct2(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  /* ---------- generic field markup builders ---------- */
  function moneyField(id, label, value, hint) {
    // .inputAffix .prefix already renders the "R$" glyph -- the raw
    // input value must be digits-only (matching the approved
    // reference's own convention, value="219990,00") to avoid a
    // doubled "R$ R$" display.
    var cleanValue = String(value || '').replace(/^R\$\s*/, '');
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="inputAffix"><span class="prefix">R$</span>' +
      '<input class="input mono" id="' + id + '" inputmode="decimal" autocomplete="off" data-money value="' + esc(cleanValue) + '"></div>' +
      (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function numberField(id, label, value, opts) {
    opts = opts || {};
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input class="input mono" id="' + id + '" type="number" inputmode="numeric"' +
      (opts.min != null ? ' min="' + opts.min + '"' : '') +
      (opts.max != null ? ' max="' + opts.max + '"' : '') +
      ' value="' + esc(value != null ? value : '') + '" placeholder="' + esc(opts.placeholder || '') + '">' +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') + '</div>';
  }
  function percentField(id, label, value, hint) {
    // Brazilian decimal-comma input (e.g. "0,80") -- deliberately NOT
    // type="number", which silently rejects comma decimals (requires a
    // dot regardless of locale) and would blank the field on render.
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input class="input mono" id="' + id + '" type="text" inputmode="decimal" autocomplete="off" data-percent value="' + esc(value || '') + '">' +
      (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  /* Entrada em R$ e em %, ligadas pelo valor do bem (como no Portal antigo).
     O motor continua lendo SÓ o campo R$ (mesmo id de sempre); o % é apenas
     uma forma de preencher o R$. Regras do antigo: digitar R$ (ou mudar o bem)
     recalcula o %; digitar % grava R$ = bem × % arredondado a centavos e
     dispara o 'input' do campo R$ (os cálculos automáticos rodam igual).
     % aceita vírgula e até 2 casas. */
  function entryField(id, label, value, bemId, hint) {
    var cleanValue = String(value || '').replace(/^R\$\s*/, '');
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="smEntryPair">' +
      '<div class="inputAffix"><span class="prefix">R$</span>' +
      '<input class="input mono" id="' + id + '" inputmode="decimal" autocomplete="off" data-money data-entry-money data-entry-bem="' + esc(bemId) + '" value="' + esc(cleanValue) + '"></div>' +
      '<div class="inputAffix inputAffixSuffix"><input class="input mono" id="' + id + 'Pct" inputmode="decimal" autocomplete="off" data-percent data-entry-pct data-entry-of="' + esc(id) + '" aria-label="' + esc(label) + ' em percentual" value="">' +
      '<span class="suffix">%</span></div>' +
      '</div>' +
      (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function fmtEntryPct(r) {
    if (r == null || !isFinite(r) || r < 0) return '';
    return (r * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function parsePctBR(s) {
    var t = String(s == null ? '' : s).replace(/%/g, '').trim().replace(',', '.');
    if (t === '' || !/^\d*\.?\d*$/.test(t)) return NaN;
    var n = Number(t);
    return isFinite(n) ? n / 100 : NaN;
  }
  function entryPctFromMoney(moneyEl) {
    var pctEl = document.getElementById(moneyEl.id + 'Pct');
    if (!pctEl || document.activeElement === pctEl) return;
    var bemEl = document.getElementById(moneyEl.getAttribute('data-entry-bem'));
    var bem = bemEl ? S.parseBRL(bemEl.value) : 0;
    var ent = S.parseBRL(moneyEl.value);
    pctEl.value = (bem > 0 && moneyEl.value.trim() !== '') ? fmtEntryPct(ent / bem) : '';
  }
  function entryMoneyFromPct(pctEl) {
    var moneyEl = document.getElementById(pctEl.getAttribute('data-entry-of'));
    if (!moneyEl) return;
    var bemEl = document.getElementById(moneyEl.getAttribute('data-entry-bem'));
    var bem = bemEl ? S.parseBRL(bemEl.value) : 0;
    var p = parsePctBR(pctEl.value);
    if (!(bem > 0) || !(p >= 0)) return; // % vazio/inválido ou sem bem: não mexe no R$
    moneyEl.value = brlDigits(Math.round(bem * p * 100) / 100);
    moneyEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function syncEntries(root) {
    (root || document).querySelectorAll('input[data-entry-money]').forEach(entryPctFromMoney);
  }
  if (!window.__nxSimEntrada) {
    window.__nxSimEntrada = true;
    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (t.hasAttribute('data-entry-pct')) { entryMoneyFromPct(t); return; }
      if (t.hasAttribute('data-entry-money')) { entryPctFromMoney(t); return; }
      if (t.id) document.querySelectorAll('input[data-entry-money][data-entry-bem="' + t.id + '"]').forEach(entryPctFromMoney);
    });
    // a máscara de R$ reformata no blur; o % acompanha o valor final
    document.addEventListener('blur', function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (t.hasAttribute('data-entry-money')) entryPctFromMoney(t);
      else if (t.id) document.querySelectorAll('input[data-entry-money][data-entry-bem="' + t.id + '"]').forEach(entryPctFromMoney);
    }, true);
  }

  function dateField(id, label, value) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input class="input" id="' + id + '" type="date" value="' + esc(value || '') + '"></div>';
  }
  function segmentedField(id, label, options, activeValue, hint) {
    var buttons = options.map(function (o) {
      return '<button type="button" data-v="' + esc(o.value) + '" class="' + (String(o.value) === String(activeValue) ? 'active' : '') + '">' + esc(o.label) + '</button>';
    }).join('');
    return '<div class="field"><label>' + esc(label) + '</label><div class="segmented" id="' + id + '" role="group" aria-label="' + esc(label) + '">' + buttons + '</div>' +
      (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function selectField(id, label, options, activeValue) {
    var opts = options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(activeValue) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><select class="select" id="' + id + '">' + opts + '</select></div>';
  }

  function getSegmentedValue(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var active = el.querySelector('button.active');
    return active ? active.getAttribute('data-v') : null;
  }
  function wireSegmented(id, onChange) {
    var el = document.getElementById(id);
    if (!el) return;
    el.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        el.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        onChange(btn.getAttribute('data-v'));
      });
    });
  }
  function wireMoneyMask(id, onInput) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', function () { el.value = brlDigits(S.parseBRL(el.value)); if (onInput) onInput(); });
    el.addEventListener('input', function () { if (onInput) onInput(); });
  }

  /* ---------- live formatting while typing ----------
     Every input[data-money] (the "R$" prefix is a separate span) shows
     "150.000" while typing and "150.000,00" after leaving the field;
     input[data-percent] keeps a decimal comma. The value read by the
     engines is still parseBRL(el.value) / Number(text with ',' -> '.'),
     and the formatted text parses to the same number as what was typed
     (digits, first comma, up to 2 decimals for money). Runs in the
     CAPTURE phase so each page's own 'input' listener already sees the
     formatted text. Caret stays after the same digit; Backspace/Delete
     next to a thousands dot remove the digit beside it. */
  function formatMoneyTyping(raw) {
    var s = String(raw);
    var neg = /^\s*(R\$\s*)?-/.test(s);
    var limpo = s.replace(/[^\d,]/g, '');
    var virg = limpo.indexOf(',');
    var inteiro = virg === -1 ? limpo : limpo.slice(0, virg);
    var dec = virg === -1 ? null : limpo.slice(virg + 1).replace(/,/g, '').slice(0, 2);
    inteiro = inteiro.replace(/^0+(?=\d)/, '');
    if (inteiro === '' && dec !== null) inteiro = '0';
    var grupos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var out = grupos + (dec !== null ? ',' + dec : '');
    return out && neg ? '-' + out : out;
  }
  function formatPercentTyping(raw) {
    var limpo = String(raw).replace(/\./g, ',').replace(/[^\d,]/g, '');
    var virg = limpo.indexOf(',');
    return virg === -1 ? limpo : limpo.slice(0, virg + 1) + limpo.slice(virg + 1).replace(/,/g, '');
  }
  // significant characters (digits and the decimal comma) before position pos;
  // in a percent field a typed '.' is the decimal separator (becomes ',')
  function contaSignif(s, pos, ponto) { return (String(s).slice(0, pos).match(ponto ? /[\d,.]/g : /[\d,]/g) || []).length; }
  function posDoSignif(s, n) {
    if (n <= 0) return 0;
    var c = 0;
    for (var i = 0; i < s.length; i++) { if (/[\d,]/.test(s[i]) && ++c === n) return i + 1; }
    return s.length;
  }
  function reformata(el, fmt) {
    var antes = el.value;
    var depois = fmt(antes);
    if (depois === antes) return;
    var focado = document.activeElement === el;
    var n = focado ? contaSignif(antes, el.selectionStart || 0, fmt === formatPercentTyping || fmt === formatEntryPercentTyping) : 0;
    el.value = depois;
    if (focado) { var p = posDoSignif(depois, n); try { el.setSelectionRange(p, p); } catch (e) { /* type sem seleção */ } }
  }
  // % da entrada: mesma máscara, limitada a 2 casas decimais
  function formatEntryPercentTyping(raw) {
    var s = formatPercentTyping(raw);
    var virg = s.indexOf(',');
    return virg === -1 ? s : s.slice(0, virg + 3);
  }
  function alvoMascara(t) {
    if (!t || t.tagName !== 'INPUT') return null;
    if (t.hasAttribute('data-money')) return formatMoneyTyping;
    if (t.hasAttribute('data-entry-pct')) return formatEntryPercentTyping;
    if (t.hasAttribute('data-percent')) return formatPercentTyping;
    return null;
  }
  if (!window.__nxSimMascara) {
    window.__nxSimMascara = true;
    document.addEventListener('input', function (ev) {
      var fmt = alvoMascara(ev.target);
      if (fmt) reformata(ev.target, fmt);
    }, true);
    document.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (!alvoMascara(el) || !el.hasAttribute('data-money') || el.selectionStart !== el.selectionEnd) return;
      var p = el.selectionStart;
      if (ev.key === 'Backspace' && p > 0 && el.value[p - 1] === '.') el.setSelectionRange(p - 1, p - 1);
      if (ev.key === 'Delete' && el.value[p] === '.') el.setSelectionRange(p + 1, p + 1);
    }, true);
    document.addEventListener('blur', function (ev) {
      var el = ev.target;
      if (!el || el.tagName !== 'INPUT' || !el.hasAttribute('data-money') || el.value.trim() === '') return;
      el.value = brlDigits(S.parseBRL(el.value));
    }, true);
  }

  function moneyVal(id) { var el = document.getElementById(id); return el ? S.parseBRL(el.value) : 0; }
  function numVal(id) { var el = document.getElementById(id); return el ? Number(el.value) : NaN; }
  function textVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  /* ---------- generic result blocks ---------- */
  function resultHero(label, value) {
    return '<div class="resultHero"><p class="kpiLabel">' + esc(label) + '</p><p class="resultValue">' + esc(brl(value)) + '</p></div>';
  }
  function secondaryGrid(items) {
    // items: [{label, value (already-formatted string)}]
    return '<div class="resultSecondaryGrid">' + items.map(function (it) {
      return '<div><p class="kpiLabel">' + esc(it.label) + '</p><p class="val">' + esc(it.value) + '</p></div>';
    }).join('') + '</div>';
  }
  function termGrid(items) {
    // items: [{prazo, payment (number|null), rate (number|null), best (bool)}]
    return '<div class="smTermGrid">' + items.map(function (it) {
      return '<div class="smTermCard' + (it.best ? ' best' : '') + '"><div class="term">' + it.prazo + 'x</div>' +
        (it.payment != null ? '<div class="payment">' + esc(brl(it.payment)) + '</div>' + (it.rate != null ? '<div class="rate">' + esc(pct2(it.rate)) + ' a.m.</div>' : '') : '<div class="unavailable">—</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---------- V2_SIMULATOR_INSTALLMENT_GRID_VISUAL_FIX ----------
     Root cause (proven via rendered geometry, not guessed): .smTermGrid
     used `grid-template-columns: repeat(auto-fill, minmax(110px, 1fr))`.
     auto-fill computes a column count from container width alone, with
     no awareness of the actual item count -- when the item count isn't
     an exact multiple of that column count, the wrapped last row still
     allocates every computed track (auto-fill never collapses unfilled
     trailing tracks, unlike auto-fit), leaving a visible untinted void
     from the last real cell to the grid's right edge -- reading as a
     broken/dangling divider exactly at the row-wrap boundary. Novos'
     own .smTermSelectGrid already solved this identical problem
     (its own comment: "replacing .segmented's flex-wrap, which produced
     an accidental 6+1 isolated last row") via a JS-computed --term-cols
     custom property (balancedColumns() + ResizeObserver) instead of
     auto-fill. balancedColumns() existed identically duplicated in both
     simulador-novos.js and simulador-seminovos.js for that select grid;
     moved here (additive -- the two local copies are untouched, still
     used for their own .smTermSelectGrid) so the SAME deterministic
     mechanism can drive the shared RESULT grid (.smTermGrid, used by
     both pages) via a distinct --term-grid-cols custom property. */
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
  // .smTermGrid paints its dividers as background showing through 1px
  // grid gaps -- unlike the flex-wrap select grid balancedColumns() was
  // designed for (where a lone leftover item is merely visually
  // isolated), an incomplete LAST ROW here leaves real empty grid
  // tracks with no cell painted over them, exposing a visible untinted
  // void (the reported "broken divider line"). The column count must
  // therefore be an EXACT divisor of the item count -- no remainder
  // tolerance -- so every row is always completely filled edge to edge.
  function balancedColumnsExact(containerWidth, itemMinWidth, n) {
    if (n <= 1) return 1;
    var maxFit = Math.max(1, Math.floor(containerWidth / itemMinWidth));
    var cap = Math.min(maxFit, n);
    for (var c = cap; c >= 1; c--) { if (n % c === 0) return c; }
    return 1;
  }
  function wireTermResultGrid(gridEl, itemMinWidth, n) {
    if (!gridEl) return null;
    function recompute() {
      var w = gridEl.clientWidth || (gridEl.parentElement && gridEl.parentElement.clientWidth) || 0;
      gridEl.style.setProperty('--term-grid-cols', String(balancedColumnsExact(w, itemMinWidth, n)));
    }
    recompute();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(recompute);
      ro.observe(gridEl);
      return ro; // caller disconnects it (same lifecycle as its own termGridObservers)
    }
    window.addEventListener('resize', recompute);
    return { disconnect: function () { window.removeEventListener('resize', recompute); } };
  }
  function errorBlock(text) {
    return '<div class="errorState"><div class="t">Não foi possível calcular</div>' + esc(text) + '</div>';
  }
  function emptyBlock(text) {
    return '<div class="emptyState"><div class="t">Nenhum cálculo ainda</div>' + esc(text) + '</div>';
  }
  function warningBlock(text) {
    return '<div class="smWarning">' + esc(text) + '</div>';
  }

  window.NX_SIM_UI = {
    esc: esc, brl: brl, brlDigits: brlDigits, pct1: pct1, pct2: pct2,
    moneyField: moneyField, numberField: numberField, percentField: percentField, dateField: dateField,
    entryField: entryField, syncEntries: syncEntries, parsePctBR: parsePctBR, fmtEntryPct: fmtEntryPct,
    segmentedField: segmentedField, selectField: selectField,
    getSegmentedValue: getSegmentedValue, wireSegmented: wireSegmented, wireMoneyMask: wireMoneyMask,
    formatMoneyTyping: formatMoneyTyping, formatPercentTyping: formatPercentTyping,
    moneyVal: moneyVal, numVal: numVal, textVal: textVal,
    resultHero: resultHero, secondaryGrid: secondaryGrid, termGrid: termGrid,
    errorBlock: errorBlock, emptyBlock: emptyBlock, warningBlock: warningBlock,
    balancedColumns: balancedColumns, balancedColumnsExact: balancedColumnsExact, wireTermResultGrid: wireTermResultGrid
  };
})();
