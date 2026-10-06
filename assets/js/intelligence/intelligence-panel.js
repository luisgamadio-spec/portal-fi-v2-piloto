/* PORTAL-NEXT V2 — Brabus Intelligence LAUNCHER + PANEL.

   The floating launcher button, the drawer panel it opens/closes, and
   the Portal's existing authorization check for whether that button
   should be visible at all are unchanged from the RESET shell.

   The drawer body is now a chat with the NEW Brabus Intelligence
   (Edge Function `brabus-intelligence`, built from scratch). Nothing
   from the prior implementation (portal-ai, adapters, runtime, voice
   session) is used; the voice dictation below talks to the same new
   endpoint and only borrows the old Voice Orb's look. This file does no calculation and holds no business rule:
   it only sends the question with the Portal session's JWT and shows
   what the backend returns.

   Markdown is rendered by building DOM nodes with textContent — the
   backend's text never reaches innerHTML. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================================================
     VISIBILITY — unchanged Portal authorization check (same
     NX_AUTH_CORE/NX_REGISTRY authority every other module already
     uses, never a second/duplicated permission matrix). Non-visible
     means the launcher/drawer DOM does not exist at all (removed from
     the tree, not CSS-hidden).
     ============================================================ */

  function isVisibleNow() {
    var AC = window.NX_AUTH_CORE;
    if (!AC) return false;
    var state = AC.getState();
    var STATES = AC.STATES;
    var authorized;
    if (state === STATES.AUTH_NOT_CONFIGURED) authorized = true;
    else if (state === STATES.AUTHORIZED) {
      var entry = window.NX_REGISTRY && window.NX_REGISTRY.byId('brabus-intelligence');
      authorized = !!(entry && AC.isModuleAuthorized(entry));
    } else authorized = false;
    return authorized;
  }

  // Liberação por perfil é regra do servidor (BI_PERFIS na função): a IA (painel, categoria da
  // tela inicial, menu) só aparece depois que a função confirma este login ({ verificar_acesso:
  // true }, sem chamar o modelo). Uma vez por usuário; 403, falha de rede ou função fora do ar
  // deixam a IA fechada. Registrada como a autoridade separada do módulo (auth-core.js).
  var acesso = { chave: null, liberado: false };
  function liberadoPeloServidor(ctx) {
    var chave = ctx ? String(ctx.authUserId || ctx.userId || '') : '';
    if (!chave) return false;
    if (acesso.chave !== chave) {
      acesso = { chave: chave, liberado: false };
      chamarBi({ verificar_acesso: true }).then(function (r) {
        if (acesso.chave !== chave) return;
        acesso.liberado = r.status === 200 && r.j.liberado === true;
        if (!acesso.liberado) return;
        refreshVisibility();
        try { window.dispatchEvent(new CustomEvent('nx:acesso-ia')); } catch (e) { /* sem CustomEvent: a tela inicial atualiza na próxima navegação */ }
      }, function () {});
    }
    return acesso.liberado;
  }
  window.NX_SEPARATE_AUTHORITY = window.NX_SEPARATE_AUTHORITY || {};
  window.NX_SEPARATE_AUTHORITY['brabus-intelligence'] = liberadoPeloServidor;

  /* ============================================================
     CHAT — transport (POST {supabaseUrl}/functions/v1/brabus-intelligence)
     ============================================================ */

  var SUGESTOES = [
    'Eclipse Cross HPE 0km de R$ 180.000 com R$ 90.000 de entrada: quais planos ofertar?',
    'Eclipse Cross HPE de R$ 180.000, cliente quer parcela de R$ 1.800: qual a menor entrada?',
    'Como está o resultado da minha loja?'
  ];
  var MAX_HISTORICO = 12; // same cap the backend applies

  function novoId() {
    try { return crypto.randomUUID(); } catch (e) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }

  var chat = { historico: [], sessao: novoId(), enviando: false };

  function resetChat() {
    chat = { historico: [], sessao: novoId(), enviando: false };
  }

  function config() { return window.NX_INTELLIGENCE_CONFIG || {}; }

  function endpoint() {
    var url = config().supabaseUrl;
    return url ? String(url).replace(/\/$/, '') + '/functions/v1/brabus-intelligence' : null;
  }

  function accessToken() {
    var A = window.NX_AUTH;
    if (!A || typeof A.getAccessToken !== 'function') return Promise.resolve(null);
    return A.getAccessToken();
  }

  // One POST to the function with the Portal session's JWT → { status, j }. signal: optional AbortSignal.
  function chamarBi(corpo, signal) {
    var url = endpoint();
    return accessToken().then(function (token) {
      if (!url || !token) throw new Error('A Brabus Intelligence precisa da sessão do Portal. Entre novamente.');
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          apikey: config().supabasePublishableKey || ''
        },
        body: JSON.stringify(corpo),
        signal: signal
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, j: j || {} }; });
    }, function (err) {
      if (err instanceof TypeError) throw new Error('Não consegui falar com a Brabus Intelligence. Verifique a conexão e tente de novo.');
      throw err;
    }).then(function (r) {
      if (r.status === 401 && window.NX_AUTH_CORE && typeof window.NX_AUTH_CORE.reportSessionExpired === 'function') {
        window.NX_AUTH_CORE.reportSessionExpired();
      }
      return r;
    });
  }

  // extra: voice fields ({ audio_base64, audio_mime, falar }) merged into the same body
  function pedir(pergunta, extra) {
    var corpo = {
      pergunta: pergunta,
      sessao_id: chat.sessao,
      historico: chat.historico.slice(-MAX_HISTORICO).map(function (m) { return { papel: m.papel, texto: m.texto }; })
    };
    if (extra) Object.keys(extra).forEach(function (k) { corpo[k] = extra[k]; });
    return chamarBi(corpo).then(function (r) {
      // 429 (rate limit): the backend's `erro` already says how long to wait — show it as is.
      if (r.status === 429) throw new Error(r.j.erro || 'Muitas perguntas em sequência agora. Tente de novo em alguns segundos.');
      if (r.status !== 200 || typeof r.j.resposta !== 'string') {
        throw new Error(r.j.erro || 'Não consegui responder agora. Tente de novo em instantes.');
      }
      if (r.j.sessao_id) chat.sessao = String(r.j.sessao_id);
      return r.j;
    });
  }

  // Voice for one piece of an answer: { falar_texto } → { audio: { mime, base64 }, vozMs } (502 when the voice fails).
  function pedirFala(texto, signal) {
    return chamarBi({ falar_texto: texto }, signal).then(function (r) {
      var a = r.j && r.j.audio;
      if (r.status !== 200 || !a || typeof a.base64 !== 'string' || !a.base64) throw new Error(r.j.erro || 'voz indisponível');
      return { audio: a, vozMs: r.j.tempos && num(r.j.tempos.voz_ms) != null ? r.j.tempos.voz_ms : null };
    });
  }

  /* ============================================================
     MARKDOWN — DOM-only (textContent), no innerHTML with model text
     ============================================================ */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function inline(parent, texto) {
    String(texto).split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (parte) {
      if (!parte) return;
      if (/^\*\*[^*]+\*\*$/.test(parte)) parent.appendChild(el('strong', null, parte.slice(2, -2)));
      else if (/^`[^`]+`$/.test(parte)) parent.appendChild(el('code', null, parte.slice(1, -1)));
      else parent.appendChild(document.createTextNode(parte));
    });
    return parent;
  }

  function celulas(linha) {
    return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  function markdown(texto) {
    var frag = document.createDocumentFragment();
    var linhas = String(texto || '').split('\n');
    var i = 0;
    var ehLinhaTabela = function (l) { return /^\s*\|.*\|\s*$/.test(l); };
    while (i < linhas.length) {
      var l = linhas[i];
      if (ehLinhaTabela(l) && i + 1 < linhas.length && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1])) {
        var wrap = el('div', 'biTableWrap');
        var table = el('table', 'biTable');
        var trh = el('tr');
        celulas(l).forEach(function (c) { trh.appendChild(inline(el('th'), c)); });
        table.appendChild(el('thead')).appendChild(trh);
        var tbody = table.appendChild(el('tbody'));
        i += 2;
        while (i < linhas.length && ehLinhaTabela(linhas[i])) {
          var tr = el('tr');
          celulas(linhas[i]).forEach(function (c) { tr.appendChild(inline(el('td'), c)); });
          tbody.appendChild(tr);
          i++;
        }
        wrap.appendChild(table);
        frag.appendChild(wrap);
        continue;
      }
      if (/^\s*[-*•]\s+/.test(l)) {
        var ul = el('ul');
        while (i < linhas.length && /^\s*[-*•]\s+/.test(linhas[i])) { ul.appendChild(inline(el('li'), linhas[i].replace(/^\s*[-*•]\s+/, ''))); i++; }
        frag.appendChild(ul);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        var ol = el('ol');
        while (i < linhas.length && /^\s*\d+[.)]\s+/.test(linhas[i])) { ol.appendChild(inline(el('li'), linhas[i].replace(/^\s*\d+[.)]\s+/, ''))); i++; }
        frag.appendChild(ol);
        continue;
      }
      if (/^#{1,4}\s+/.test(l)) { frag.appendChild(inline(el('p', 'biH'), l.replace(/^#{1,4}\s+/, ''))); i++; continue; }
      if (l.trim()) frag.appendChild(inline(el('p'), l));
      i++;
    }
    return frag;
  }

  /* ============================================================
     CARDS — `blocos` from the backend (README → "Cartões").
     Every number is shown as the backend sent it; formatting only.
     Built with textContent only.
     ============================================================ */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  var NF = {
    int: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
    brl: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    brl0: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }),
    pct: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    taxa: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
    taxa2: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct1: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) // same as the Salários screen's fmtPct
  };
  // pct values arrive already in percent (42.75 = 42,75%)
  function fmt(v, formato) {
    v = num(v);
    if (v == null) return '—';
    if (formato === 'brl') return NF.brl.format(v);
    if (formato === 'brl0') return NF.brl0.format(v);
    if (formato === 'pct') return NF.pct.format(v) + '%';
    if (formato === 'pp') return NF.pct.format(v) + ' p.p.';
    if (formato === 'dec') return NF.pct.format(v); // plain number, up to 2 places (e.g. 52,5 points)
    if (formato === 'taxa') return NF.taxa.format(v) + '% a.m.'; // monthly rates keep the backend's precision (up to 4 places)
    if (formato === 'taxa2') return NF.taxa2.format(v) + '% a.m.'; // cash card: 2 places, same as leitura_empate
    return NF.int.format(v);
  }

  function chip(texto, extra) { return el('span', 'biChipTag' + (extra ? ' ' + extra : ''), texto); }

  function cabecalhoCartao(titulo, chips) {
    var h = el('div', 'biCardHead');
    h.appendChild(el('p', 'biCardTitle', titulo || ''));
    var c = el('div', 'biCardChips');
    (chips || []).forEach(function (x) { if (x) c.appendChild(x); });
    if (c.childNodes.length) h.appendChild(c);
    return h;
  }

  // --- opcoes ---------------------------------------------------------
  function nomePlano(o) { return String(o.plano_nome || o.plano || 'Plano'); }
  function baloesOrdenados(o) {
    return (Array.isArray(o.baloes) ? o.baloes : [])
      .filter(function (b) { return b && num(b.valor) != null; })
      .sort(function (x, y) { return (x.mes || 0) - (y.mes || 0); });
  }
  function listaMeses(bs) {
    var m = bs.map(function (b) { return b.mes + 'ª'; });
    return m.length > 1 ? m.slice(0, -1).join(', ') + ' e ' + m[m.length - 1] : (m[0] || '');
  }

  // The 3 headline numbers: [label, value, sub-text, extra class].
  // With entrada_minima_necessaria, ENTRADA goes first and is highlighted.
  function numerosPrincipais(o) {
    var bs = baloesOrdenados(o);
    var parcela = ['Parcela', fmt(o.parcela, 'brl'), null, ''];
    var terceiro;
    if (bs.length === 1) {
      terceiro = ['Balão', fmt(bs[0].valor, 'brl'), 'na ' + bs[0].mes + 'ª parcela', ''];
    } else if (bs.length > 1) {
      var iguais = bs.every(function (b) { return Math.abs(b.valor - bs[0].valor) < 0.01; });
      terceiro = iguais
        ? ['Balão', bs.length + '× ' + fmt(bs[0].valor, 'brl'), listaMeses(bs), '']
        : ['Balões', fmt(o.total_baloes, 'brl'), bs.length + ' balões · ' + listaMeses(bs), ''];
    } else {
      terceiro = ['Prazo', num(o.prazo) != null ? o.prazo + 'x' : '—', null, ''];
    }
    var temMinima = num(o.entrada_minima_necessaria) != null;
    var entrada = [
      temMinima ? 'Entrada mínima' : 'Entrada',
      fmt(temMinima ? o.entrada_minima_necessaria : o.entrada, 'brl'),
      num(o.entrada_pct) != null ? fmt(o.entrada_pct, 'pct') + ' do veículo' : null,
      temMinima ? 'biFigKey' : ''
    ];
    return temMinima ? [entrada, parcela, terceiro] : [parcela, terceiro, entrada];
  }

  function linhaNumeros(o, compacto) {
    var row = figuras(numerosPrincipais(o));
    if (compacto) row.className += ' biFiguresCompact';
    return row;
  }

  function comoPaga(o) {
    var linhas = (Array.isArray(o.como_paga) ? o.como_paga : []).filter(function (x) { return x && x.rotulo; });
    if (!linhas.length) return null;
    var box = el('div', 'biHowPays');
    box.appendChild(el('p', 'biBlockLabel', 'Como o cliente paga'));
    box.appendChild(linhasDl(linhas.map(function (x) { return [String(x.rotulo), fmt(x.valor, 'brl')]; })));
    return box;
  }

  function detalhes(o) {
    var linhas = [];
    if (num(o.taxa_tabela_pct_am) != null) linhas.push(['Taxa de tabela', fmt(o.taxa_tabela_pct_am, 'taxa')]);
    if (num(o.financiado) != null) linhas.push(['Valor financiado', fmt(o.financiado, 'brl')]);
    if (num(o.baloes_pct_do_veiculo) != null) linhas.push(['Balões / valor do veículo', fmt(o.baloes_pct_do_veiculo, 'pct')]);
    if (o.aceitacao_comercial) linhas.push(['Aceitação comercial', String(o.aceitacao_comercial)]);
    if (num(o.rebate_concessionaria) != null) linhas.push(['Rebate da concessionária', fmt(o.rebate_concessionaria, 'brl')]);
    if (num(o.valor_final_venda) != null) linhas.push(['Valor final de venda', fmt(o.valor_final_venda, 'brl')]);
    if (!linhas.length) return null;
    var d = el('details', 'biDetails'); // closed by default
    d.appendChild(el('summary', null, 'Ver detalhes'));
    d.appendChild(linhasDl(linhas));
    return d;
  }

  function cartaoDestaque(o) {
    var c = el('section', 'biBest');
    var topo = el('div', 'biBestTop');
    topo.appendChild(el('span', 'biEyebrow', 'Melhor condição'));
    if (typeof o.destaque === 'string' && o.destaque) topo.appendChild(chip(o.destaque, 'biChipAccent'));
    c.appendChild(topo);
    c.appendChild(el('p', 'biBestPlano', nomePlano(o)));
    c.appendChild(linhaNumeros(o, false));
    if (o.resumo_baloes) c.appendChild(el('p', 'biResumo', String(o.resumo_baloes)));
    var cp = comoPaga(o);
    if (cp) c.appendChild(cp);
    var det = detalhes(o);
    if (det) c.appendChild(det);
    return c;
  }

  function cartaoAlternativa(o) {
    var c = el('section', 'biAlt');
    c.appendChild(el('p', 'biAltPlano', nomePlano(o)));
    c.appendChild(linhaNumeros(o, true));
    if (o.resumo_baloes) c.appendChild(el('p', 'biResumo biResumoCompact', String(o.resumo_baloes)));
    return c;
  }

  function blocoOpcoes(b) {
    var card = el('div', 'biCard biCardOpcoes');
    var v = b.veiculo || {};
    var chips = [];
    if (num(v.valor) != null) chips.push(chip('Veículo ' + fmt(v.valor, 'brl0')));
    if (num(b.parcela_alvo) != null) chips.push(chip('Parcela até ' + fmt(b.parcela_alvo, 'brl')));
    card.appendChild(cabecalhoCartao(b.titulo, chips));
    var grid = el('div', 'biOpcoesGrid');
    if (b.destaque) grid.appendChild(cartaoDestaque(b.destaque));
    var alts = Array.isArray(b.alternativas) ? b.alternativas : [];
    if (alts.length) {
      var col = el('div', 'biAlts');
      col.appendChild(el('p', 'biBlockLabel', 'Alternativas'));
      alts.forEach(function (o) { if (o) col.appendChild(cartaoAlternativa(o)); });
      grid.appendChild(col);
    }
    card.appendChild(grid);
    if (b.base) card.appendChild(el('p', 'biCardBase', String(b.base)));
    return card;
  }

  // --- resultado -------------------------------------------------------
  // [label, campo, formato, campo da variação, formato da variação]
  var KPIS = [
    ['Vendidos', 'vendidos', 'int', 'vendidos_pct', 'pct'],
    ['Financiados', 'financiados', 'int', 'financiados_pct', 'pct'],
    ['Share', 'share_pct', 'pct', 'share_pp', 'pp'],
    ['Produção', 'producao', 'brl0', 'producao_pct', 'pct'],
    ['SPF', 'spf_qtd', 'int', 'spf_qtd', 'int'],
    ['Retorno', 'retorno', 'brl0', 'retorno_pct', 'pct']
  ];

  function variacao(v, formato) {
    v = num(v);
    if (v == null) return null;
    var cls = v > 0 ? 'biDeltaUp' : v < 0 ? 'biDeltaDown' : 'biDeltaFlat';
    var seta = v > 0 ? '▲' : v < 0 ? '▼' : '■';
    var d = el('span', 'biDelta ' + cls);
    d.appendChild(el('span', 'biDeltaArrow', seta));
    d.appendChild(document.createTextNode(' ' + (v > 0 ? '+' : '') + fmt(v, formato)));
    d.setAttribute('aria-label', (v > 0 ? 'alta de ' : v < 0 ? 'queda de ' : 'estável, ') + fmt(Math.abs(v), formato) + ' vs período anterior');
    return d;
  }

  function cartaoLoja(l, b) {
    var card = el('div', 'biCard biCardResultado');
    var chips = [];
    if (b.visao) chips.push(chip(String(b.visao), 'biChipAccent'));
    if (b.periodo) chips.push(chip(String(b.periodo)));
    card.appendChild(cabecalhoCartao(String(l.loja || b.titulo || 'Resultado'), chips));
    var grid = el('div', 'biKpis');
    var vari = l.variacao_vs_anterior || null;
    KPIS.forEach(function (k) {
      if (k[1] === 'retorno' && !Object.prototype.hasOwnProperty.call(l, 'retorno')) return; // only when the backend sent it
      var kp = el('div', 'biKpi');
      kp.appendChild(el('span', 'biKpiLabel', k[0]));
      kp.appendChild(el('span', 'biKpiValue', fmt(l[k[1]], k[2])));
      var dv = vari ? variacao(vari[k[3]], k[4]) : null;
      if (dv) kp.appendChild(dv);
      grid.appendChild(kp);
    });
    card.appendChild(grid);
    if (vari) card.appendChild(el('p', 'biCardNote', 'Variação vs período anterior comparável.'));
    var dep = l.por_departamento;
    if (dep && (dep.NOVOS || dep.SEMINOVOS)) {
      var box = el('div', 'biDeps');
      ['NOVOS', 'SEMINOVOS'].forEach(function (nome) {
        var x = dep[nome];
        var row = el('div', 'biDepRow');
        row.appendChild(el('span', 'biDepName', nome === 'NOVOS' ? 'Novos' : 'Seminovos'));
        row.appendChild(el('span', 'biDepVals', x
          ? fmt(x.vendidos, 'int') + ' vend. · ' + fmt(x.financiados, 'int') + ' fin. · share ' + fmt(x.share_pct, 'pct') + ' · ' + fmt(x.producao, 'brl0')
          : 'sem vendas'));
        box.appendChild(row);
      });
      card.appendChild(box);
    }
    return card;
  }

  function blocoResultado(b) {
    var wrap = el('div', 'biCardStack');
    if (b.total) wrap.appendChild(cartaoLoja(b.total, b));
    (Array.isArray(b.lojas) ? b.lojas : []).forEach(function (l) { if (l) wrap.appendChild(cartaoLoja(l, b)); });
    return wrap;
  }

  // --- comparacao ------------------------------------------------------
  function blocoComparacao(b) {
    var card = el('div', 'biCard biCardComparacao');
    var chips = [];
    if (b.visao) chips.push(chip(String(b.visao), 'biChipAccent'));
    if (b.periodo) chips.push(chip(String(b.periodo)));
    card.appendChild(cabecalhoCartao(b.titulo, chips));
    var lojas = Array.isArray(b.lojas) ? b.lojas : [];
    var wrap = el('div', 'biTableWrap');
    var table = el('table', 'biTable biCompTable');
    var trh = el('tr');
    trh.appendChild(el('th', null, 'Indicador'));
    lojas.forEach(function (l) { trh.appendChild(el('th', 'biNum', String(l))); });
    table.appendChild(el('thead')).appendChild(trh);
    var tbody = table.appendChild(el('tbody'));
    (Array.isArray(b.linhas) ? b.linhas : []).forEach(function (ln) {
      var tr = el('tr');
      tr.appendChild(el('th', 'biRowHead', String(ln.rotulo || ln.indicador || '')));
      var valores = Array.isArray(ln.valores) ? ln.valores : [];
      lojas.forEach(function (l, i) {
        var formato = ln.formato === 'brl' ? 'brl0' : ln.formato;
        var td = el('td', 'biNum', fmt(valores[i], formato));
        if (ln.lider != null && String(ln.lider) === String(l)) {
          td.className += ' biLeader';
          td.setAttribute('aria-label', fmt(valores[i], formato) + ', líder');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    card.appendChild(wrap);
    card.appendChild(el('p', 'biCardNote', 'Destaque = loja líder no indicador.'));
    return card;
  }

  // --- helpers shared by score / antecipacao / cash -------------------
  function dataBr(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso ? String(iso) : '—');
  }
  function plural(n, um, varios) { return (num(n) != null ? NF.int.format(n) : '—') + ' ' + (n === 1 ? um : varios); }
  // ≥ 80% success, 60–79% neutral, < 60% brand red
  function tomPct(p) { p = num(p); return p == null ? 'biToneNeutral' : p >= 80 ? 'biToneGood' : p >= 60 ? 'biToneNeutral' : 'biToneBad'; }

  function barra(pct, rotuloAcessivel) {
    var p = Math.max(0, Math.min(100, num(pct) || 0));
    var b = el('div', 'biBar ' + tomPct(pct));
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', rotuloAcessivel || (NF.int.format(p) + '%'));
    var f = el('span', 'biBarFill');
    f.style.width = p + '%';
    b.appendChild(f);
    return b;
  }

  function figuras(itens) { // [[label, value, sub, cls]]
    var row = el('div', 'biFigures');
    itens.forEach(function (n) {
      var f = el('div', 'biFig' + (n[3] ? ' ' + n[3] : ''));
      f.appendChild(el('span', 'biFigLabel', n[0]));
      f.appendChild(el('span', 'biFigValue', n[1]));
      if (n[2]) f.appendChild(el('span', 'biFigSub', n[2]));
      row.appendChild(f);
    });
    return row;
  }

  function linhasDl(linhas) { // [[rótulo, valor]]
    var dl = el('dl', 'biRows');
    linhas.forEach(function (x) {
      var r = el('div', 'biRow');
      r.appendChild(el('dt', null, x[0]));
      r.appendChild(el('dd', null, x[1]));
      dl.appendChild(r);
    });
    return dl;
  }

  function tabela(colunas, linhas, opts) { // colunas: [[título, numérico?, título curto?]]; linhas: [{cells:[], cls}]
    var wrap = el('div', 'biTableWrap');
    var table = el('table', 'biTable biDataTable' + (opts && opts.cls ? ' ' + opts.cls : ''));
    var trh = el('tr');
    colunas.forEach(function (c) {
      var th = el('th', c[1] ? 'biNum' : null);
      if (c[2]) { // short label for the narrow drawer; screen readers get the full one
        th.setAttribute('aria-label', c[0]);
        th.appendChild(el('span', 'biThLong', c[0]));
        var curto = el('span', 'biThShort', c[2]);
        curto.setAttribute('aria-hidden', 'true');
        th.appendChild(curto);
      } else th.textContent = c[0];
      trh.appendChild(th);
    });
    table.appendChild(el('thead')).appendChild(trh);
    var tbody = table.appendChild(el('tbody'));
    linhas.forEach(function (ln) {
      var tr = el('tr', ln.cls || null);
      if (ln.gap) {
        var td = el('td', 'biGapRow', '…');
        td.colSpan = colunas.length;
        tr.appendChild(td);
      } else {
        ln.cells.forEach(function (v, i) {
          if (v && v.nodeType === 1) { var tdn = el('td', colunas[i][1] ? 'biNum' : null); tdn.appendChild(v); tr.appendChild(tdn); }
          else tr.appendChild(el('td', colunas[i][1] ? 'biNum' : null, v == null ? '—' : String(v)));
        });
      }
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }

  // --- score -----------------------------------------------------------
  // Tap/click (or Enter/Space) on the line opens its detail right below it,
  // in small text; again closes it. `title` stays for mouse hover.
  var expSeq = 0;
  function comDetalhe(alvo, detalhe, onde) {
    if (!detalhe) return;
    alvo.title = String(detalhe);
    var d = el('p', 'biExpand', String(detalhe));
    d.hidden = true;
    d.id = 'biExp' + (++expSeq);
    alvo.classList.add('biToggle');
    alvo.setAttribute('role', 'button');
    alvo.tabIndex = 0;
    alvo.setAttribute('aria-expanded', 'false');
    alvo.setAttribute('aria-controls', d.id);
    function alterna() {
      d.hidden = !d.hidden;
      alvo.setAttribute('aria-expanded', d.hidden ? 'false' : 'true');
    }
    alvo.addEventListener('click', alterna);
    alvo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alterna(); }
    });
    onde.appendChild(d);
  }

  function linhaComposicao(nome, pct, pontosTxt, detalhe) {
    var wrap = el('div', 'biCompWrap');
    var row = el('div', 'biCompRow');
    row.appendChild(el('span', 'biCompItem', nome));
    row.appendChild(barra(pct, nome + ': ' + (num(pct) != null ? fmt(pct, 'int') + '%' : 'indisponível')));
    row.appendChild(el('span', 'biCompPts', pontosTxt));
    wrap.appendChild(row);
    comDetalhe(row, detalhe, wrap);
    return wrap;
  }

  function blocoScore(b) {
    var v = b.vendedor || {};
    var card = el('div', 'biCard biCardScore');

    // header in one line: name · store · tier chip · "1º de 35"
    var head = el('div', 'biScoreHead');
    head.appendChild(el('span', 'biScoreName', String(v.vendedor || b.titulo || 'Score')));
    if (v.loja) head.appendChild(el('span', 'biScoreLoja', '· ' + v.loja));
    var hc = el('span', 'biScoreChips');
    if (v.faixa) hc.appendChild(chip(String(v.faixa), 'biChipAccent'));
    if (num(v.posicao) != null) hc.appendChild(chip(v.posicao + 'º de ' + (num(v.total_vendedores) != null ? v.total_vendedores : '—')));
    if (hc.childNodes.length) head.appendChild(hc);
    card.appendChild(head);

    // smaller ring + 4 mini KPIs
    var topo = el('div', 'biScoreTop');
    var anel = el('div', 'biScoreRing ' + tomPct(num(v.score) != null ? v.score / 10 : null));
    var sc = Math.max(0, Math.min(1000, num(v.score) || 0));
    anel.style.setProperty('--bi-p', String(sc / 10));
    anel.setAttribute('role', 'img');
    anel.setAttribute('aria-label', 'Score ' + fmt(v.score, 'int') + ' de 1000');
    var miolo = el('div', 'biScoreRingInner');
    miolo.appendChild(el('span', 'biScoreValue', fmt(v.score, 'int')));
    miolo.appendChild(el('span', 'biScoreMax', '/1000'));
    anel.appendChild(miolo);
    topo.appendChild(anel);
    var kpis = el('div', 'biMiniKpis');
    [['Vendas', v.vendas, 'int'], ['Financiados', v.financiados, 'int'], ['Share', v.share_pct, 'pct'], ['SPF', v.spf_qtd, 'int']].forEach(function (k) {
      var d = el('div', 'biMiniKpi');
      d.appendChild(el('span', 'biMiniLabel', k[0]));
      d.appendChild(el('span', 'biMiniValue', fmt(k[1], k[2])));
      kpis.appendChild(d);
    });
    topo.appendChild(kpis);
    card.appendChild(topo);

    // composition: 1 line per item (name · bar · points/max), detail in the tooltip
    var comp = (Array.isArray(b.composicao) ? b.composicao : []).filter(Boolean);
    var uc = b.utilizacao_conversao;
    if (comp.length || uc) {
      var box = el('div', 'biSection');
      box.appendChild(el('p', 'biBlockLabel', 'Composição'));
      var lista = el('div', 'biCompList');
      comp.forEach(function (c) {
        lista.appendChild(linhaComposicao(String(c.item || ''), c.pct, fmt(c.pontos, 'int') + '/' + fmt(c.maximo, 'int'), c.detalhe));
      });
      if (uc && typeof uc === 'object') {
        var ok = uc.disponivel !== false && num(uc.pontos) != null;
        var max = num(uc.maximo) != null ? uc.maximo : 100;
        lista.appendChild(linhaComposicao('Utilização + Conversão', ok ? (uc.pontos / max) * 100 : null,
          ok ? fmt(uc.pontos, 'dec') + '/' + fmt(max, 'int') : '—', uc.status || uc.observacao));
        var sub = el('p', 'biCompSub');
        sub.appendChild(chip('fora do Score Oficial', 'biChipMuted biChipXs'));
        sub.appendChild(document.createTextNode(' ' + (ok
          ? 'Conversão ' + fmt(uc.conversao, 'dec') + '/70 · Utilização ' + fmt(uc.utilizacao, 'dec') + '/30 · ' + plural(uc.simulacoes, 'simulação', 'simulações')
          : String(uc.motivo || 'Indisponível no período.'))));
        lista.appendChild(sub);
      }
      box.appendChild(lista);
      card.appendChild(box);
    }

    // where points were lost: at most 2, one line each
    var melh = (Array.isArray(b.melhorar) ? b.melhorar : []).filter(Boolean).slice(0, 2);
    if (melh.length) {
      var perda = el('div', 'biSection');
      perda.appendChild(el('p', 'biBlockLabel', 'Onde perdeu pontos'));
      var ul = el('ul', 'biLossList');
      melh.forEach(function (m) {
        var li = el('li', 'biLossWrap');
        var linha = el('div', 'biLossItem');
        linha.appendChild(el('span', 'biLossName', String(m.item || '')));
        linha.appendChild(el('span', 'biLossPts', '-' + fmt(m.pontos_perdidos, 'int') + ' pts'));
        li.appendChild(linha);
        comDetalhe(linha, m.detalhe, li);
        ul.appendChild(li);
      });
      perda.appendChild(ul);
      card.appendChild(perda);
    }

    // top 5, collapsed
    var rk = (Array.isArray(b.ranking) ? b.ranking : []).filter(Boolean);
    if (rk.length) {
      var rbox = el('details', 'biDetails biRankDetails');
      rbox.appendChild(el('summary', null, 'Ver ranking'));
      var ol = el('ol', 'biRankList');
      rk.forEach(function (r) {
        var eu = r.vendedor === v.vendedor && (r.posicao == null || r.posicao === v.posicao);
        var li = el('li', 'biRankItem' + (eu ? ' biRankMe' : ''));
        if (eu) li.setAttribute('aria-current', 'true');
        li.appendChild(el('span', 'biRankPos', (num(r.posicao) != null ? r.posicao : '—') + 'º'));
        var nome = el('span', 'biRankName', String(r.vendedor || ''));
        if (r.loja) nome.appendChild(el('span', 'biRankLoja', ' · ' + r.loja));
        li.appendChild(nome);
        li.appendChild(el('span', 'biRankScore', fmt(r.score, 'int')));
        ol.appendChild(li);
      });
      rbox.appendChild(ol);
      card.appendChild(rbox);
    }
    if (b.periodo || b.visao) card.appendChild(el('p', 'biCardBase', [b.periodo, b.visao].filter(Boolean).join(' · ')));
    return card;
  }

  // --- antecipacao -------------------------------------------------------
  function blocoAntecipacao(b) {
    var card = el('div', 'biCard biCardAntecipacao');
    var chips = [];
    if (b.modalidade) chips.push(chip(String(b.modalidade), 'biChipAccent'));
    card.appendChild(cabecalhoCartao(b.titulo, chips));
    card.appendChild(figuras([
      ['Valor a pagar', fmt(b.valor_a_pagar, 'brl'), null, ''],
      ['Desconto', fmt(b.desconto_total, 'brl'), num(b.desconto_pct) != null ? fmt(b.desconto_pct, 'pct') + ' do original' : null, ''],
      ['Valor original', fmt(b.valor_original, 'brl'), null, '']
    ]));
    var partes = ['Antecipação em ' + dataBr(b.data_antecipacao)];
    if (num(b.parcelas_antecipadas) != null) partes.push(plural(b.parcelas_antecipadas, 'parcela antecipada', 'parcelas antecipadas'));
    if (num(b.parcelas_ja_pagas_ate_a_data) != null) partes.push(plural(b.parcelas_ja_pagas_ate_a_data, 'já paga', 'já pagas'));
    card.appendChild(el('p', 'biResumo', partes.join(' · ')));
    var c = b.contrato || {};
    if (c.premissa_primeiro_vencimento) card.appendChild(el('p', 'biCardNote', String(c.premissa_primeiro_vencimento)));
    if (b.regra_data) card.appendChild(el('p', 'biCardNote', 'Data: ' + String(b.regra_data)));
    if (b.aviso) card.appendChild(el('p', 'biCardNote', String(b.aviso)));

    var linha = function (l) {
      return {
        cls: /bal/i.test(String(l.tipo || '')) ? 'biRowBalao' : null,
        cells: [fmt(l.parcela, 'int'), String(l.tipo || '—'), dataBr(l.vencimento), fmt(l.meses_antecedencia, 'int'),
          fmt(l.valor_original, 'brl'), fmt(l.desconto_pct, 'pct'), fmt(l.valor_a_pagar, 'brl')]
      };
    };
    var linhas = [];
    if (Array.isArray(b.linhas) && b.linhas.length) linhas = b.linhas.filter(Boolean).map(linha);
    else {
      var p1 = (Array.isArray(b.primeiras_linhas) ? b.primeiras_linhas : []).filter(Boolean).map(linha);
      var p2 = (Array.isArray(b.ultimas_linhas) ? b.ultimas_linhas : []).filter(Boolean).map(linha);
      linhas = p1.concat(p1.length && p2.length ? [{ gap: true }] : [], p2);
    }
    if (linhas.length) {
      var sec = el('div', 'biSection');
      sec.appendChild(tabela([['Parcela', true], ['Tipo', false], ['Vencimento', false], ['Antecedência (meses)', true],
        ['Original', true], ['Desconto %', true], ['A pagar', true]], linhas, { cls: 'biStickyFirst' }));
      card.appendChild(sec);
    }
    return card;
  }

  // --- cash ------------------------------------------------------------
  var RECOMENDACAO = { FINANCIAR: 'biChipGood', UTILIZAR: 'biChipNeutral', EQUIVALENTE: 'biChipMuted' };

  function blocoCash(b) {
    var card = el('div', 'biCard biCardCash');
    card.appendChild(cabecalhoCartao(b.titulo, []));
    var top = el('div', 'biCashTop');
    var hero = el('div', 'biCashHero');
    hero.appendChild(el('span', 'biFigLabel', 'Taxa de empate'));
    hero.appendChild(el('span', 'biCashValue', fmt(b.taxa_de_empate_pct_am, 'taxa2')));
    if (b.leitura_empate) hero.appendChild(el('span', 'biCashRead', String(b.leitura_empate)));
    top.appendChild(hero);
    var res = [];
    if (num(b.capital) != null) res.push(['Capital', fmt(b.capital, 'brl')]);
    if (num(b.parcela) != null) res.push(['Parcela × prazo', fmt(b.parcela, 'brl') + ' × ' + (num(b.prazo) != null ? b.prazo : '—')]);
    if (num(b.total_pago_no_financiamento) != null) res.push(['Total pago no financiamento', fmt(b.total_pago_no_financiamento, 'brl')]);
    if (num(b.juros_pagos) != null) res.push(['Juros pagos', fmt(b.juros_pagos, 'brl')]);
    if (res.length) top.appendChild(linhasDl(res));
    card.appendChild(top);

    var cen = (Array.isArray(b.cenarios) ? b.cenarios : []).filter(Boolean);
    if (cen.length) {
      var sec = el('div', 'biSection');
      sec.appendChild(el('p', 'biBlockLabel', 'Cenários'));
      sec.appendChild(tabela([['Taxa da aplicação', true], ['Valor futuro', true], ['Diferença', true], ['Resultado', false]],
        cen.map(function (c) {
          var rec = String(c.recomendacao || '').toUpperCase();
          return { cells: [fmt(c.taxa_aplicacao_pct_am, 'taxa2'), fmt(c.valor_futuro_da_aplicacao, 'brl'), fmt(c.diferenca, 'brl'),
            chip(rec || '—', RECOMENDACAO[rec] || 'biChipMuted')] };
        }), { cls: 'biStickyFirst' }));
      card.appendChild(sec);
    }
    if (b.taxa_informada === false && b.observacao) card.appendChild(el('p', 'biCardNote', String(b.observacao)));
    return card;
  }

  // --- salario -----------------------------------------------------------
  function datasBr(txt) { return String(txt || '').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1'); }

  // Same visual language as the Salários e Comissões screen: modBadge*,
  // modKpiCard*, monospaced values. Conversion ≥ 40% green, below yellow.
  var SAL_CONVERSAO_META = 40;
  var SAL_PERFIL = { VENDEDOR: 'Vendedor', ANALISTA: 'Analista', GERENTE: 'Gerente', DIRETOR: 'Diretor', MASTER: 'Master' };
  function badge(texto, cls) { return el('span', 'modBadge ' + (cls || 'modBadgeNeutral'), texto); }
  function textoOuNada(v) { return v != null && String(v).trim() !== '' ? String(v) : null; }

  function blocoSalario(b) {
    var pes = b.pessoa || {};
    var card = el('div', 'biCard biCardSalario');
    var oficial = b.oficial === true;

    // header: name + profile chip + store · origin chip on the right · competence in small text
    var head = el('div', 'biSalHead');
    var quem = el('div', 'biSalWho');
    quem.appendChild(el('span', 'biSalName', textoOuNada(pes.nome) || 'Salário variável'));
    var perfil = textoOuNada(pes.perfil);
    if (perfil) quem.appendChild(badge(SAL_PERFIL[perfil.toUpperCase()] || perfil, 'modBadgeInfo'));
    if (textoOuNada(pes.loja)) quem.appendChild(el('span', 'biSalLoja', String(pes.loja)));
    head.appendChild(quem);
    var orig = badge(oficial ? 'Fechamento oficial' : 'Prévia', oficial ? 'modBadgeSuccess' : 'modBadgeNeutral');
    if (b.origem) orig.title = datasBr(b.origem);
    head.appendChild(orig);
    card.appendChild(head);
    var comp = [textoOuNada(b.nome_periodo), textoOuNada(b.competencia) && datasBr(b.competencia), textoOuNada(pes.departamento)].filter(Boolean);
    if (comp.length) card.appendChild(el('p', 'biSalComp', 'Competência ' + comp.join(' · ')));

    // main block: total + tier badge (same green badge as "% Comissão")
    var main = el('div', 'biSalMain');
    main.appendChild(el('span', 'biFigLabel', 'Comissão total'));
    var valor = el('div', 'biSalTotalRow');
    valor.appendChild(el('span', 'biSalTotal', fmt(b.comissao_total, 'brl')));
    if (textoOuNada(pes.faixa)) valor.appendChild(badge(String(pes.faixa), 'modBadgeSuccess'));
    main.appendChild(valor);
    card.appendChild(main);

    // how the value was reached — only the lines present in the JSON
    var passos = [];
    if (num(b.comissao_principal) != null) passos.push(['Comissão principal', fmt(b.comissao_principal, 'brl'), '']);
    if (num(b.comissao_spf) != null) passos.push(['Bônus SPF', fmt(b.comissao_spf, 'brl'), '']);
    if (passos.length && num(b.comissao_total) != null) passos.push(['= Total', fmt(b.comissao_total, 'brl'), 'biSalStepTotal']);
    if (passos.length) {
      var how = el('div', 'biSection');
      how.appendChild(el('p', 'biBlockLabel', 'Como chegou nesse valor'));
      var dl = el('dl', 'biRows biSalSteps');
      passos.forEach(function (x) {
        var r = el('div', 'biRow' + (x[2] ? ' ' + x[2] : ''));
        r.appendChild(el('dt', null, x[0]));
        r.appendChild(el('dd', null, x[1]));
        dl.appendChild(r);
      });
      how.appendChild(dl);
      card.appendChild(how);
    }

    // indicator mini-cards (2 cols mobile, 4 desktop); never a card for a null value
    var ind = b.indicadores;
    if (ind && typeof ind === 'object') {
      var cards = [];
      var mini = function (rotulo, conteudo, cls) {
        var c = el('div', 'modKpiCard modKpiCardSecondary biSalKpi' + (cls ? ' ' + cls : ''));
        c.appendChild(el('p', 'modKpiLabel', rotulo));
        var v = el('p', 'modKpiValue');
        if (conteudo && conteudo.nodeType === 1) v.appendChild(conteudo); else v.textContent = conteudo;
        c.appendChild(v);
        cards.push(c);
      };
      if (num(ind.vendidas) != null) mini('Vendidas', fmt(ind.vendidas, 'int'));
      if (num(ind.financiadas) != null) mini('Financiadas', fmt(ind.financiadas, 'int'));
      if (num(ind.conversao_pct) != null) mini('Conversão', badge(NF.pct1.format(ind.conversao_pct) + '%',ind.conversao_pct >= SAL_CONVERSAO_META ? 'modBadgeSuccess' : 'modBadgeWarning'));
      if (num(ind.producao) != null) mini('Produção', fmt(ind.producao, 'brl0'));
      if (num(ind.retorno) != null) mini('Retorno', fmt(ind.retorno, 'brl0'));
      if (num(ind.spf) != null) mini('SPF', fmt(ind.spf, 'brl0'));
      if (cards.length) {
        var grid = el('div', 'biSection biSalKpis');
        cards.forEach(function (c) { grid.appendChild(c); });
        card.appendChild(grid);
      }
    }

    var linhas = (Array.isArray(b.linhas) ? b.linhas : []).filter(Boolean);
    if (linhas.length > 1 || linhas.some(function (l) { return l.cobertura === true; })) {
      var sec = el('div', 'biSection');
      sec.appendChild(tabela([['Loja', false], ['Depto', false], ['Faixa', false], ['Comissão', true]],
        linhas.map(function (l) {
          var loja = el('span', 'biSalLojaCell', textoOuNada(l.loja) || '—');
          if (l.cobertura === true) { loja.appendChild(document.createTextNode(' ')); loja.appendChild(badge('Cobertura', 'modBadgeInfo')); }
          var fx = textoOuNada(l.faixa);
          return { cells: [loja, textoOuNada(l.departamento) || '—', fx ? badge(fx, 'modBadgeSuccess') : '—', fmt(l.comissao_total, 'brl')] };
        }), { cls: 'biSalTable' }));
      card.appendChild(sec);
    }
    if (b.aviso) card.appendChild(el('p', 'biCardNote', String(b.aviso)));
    return card;
  }

  // --- fandi (same language as the Análise F&I screen) --------------------
  // plan colors = gestao.css .gePlanCard.plan*
  var PLANO_COR = { 'LINEAR': 'biPlanLinear', 'BALÃO': 'biPlanBalao', 'BALAO': 'biPlanBalao', 'SUBSIDIADO': 'biPlanSubsidiado',
    'REVERSÃO': 'biPlanReversao', 'REVERSAO': 'biPlanReversao', 'COPARTICIPADO': 'biPlanCoparticipado' };

  function barraCor(pct, cls, rotulo) {
    var p = Math.max(0, Math.min(100, num(pct) || 0));
    var b = el('div', 'biBar ' + cls);
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', rotulo);
    var f = el('span', 'biBarFill');
    f.style.width = p + '%';
    b.appendChild(f);
    return b;
  }

  function dataHoraBr(iso) {
    var d = iso ? new Date(String(iso)) : null;
    if (!d || isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        .format(d).replace(',', '');
    } catch (e) { return null; }
  }

  function kpiFandi(rotulo, valor, dica, cls, explicacao) {
    var c = el('div', 'modKpiCard biFandiKpi' + (cls ? ' ' + cls : ''));
    c.appendChild(el('p', 'modKpiLabel', rotulo));
    c.appendChild(el('p', 'modKpiValue', valor));
    if (dica) c.appendChild(el('p', 'modKpiHint', dica));
    if (explicacao) c.appendChild(el('p', 'biKpiExplain', explicacao));
    return c;
  }

  function celulaTaxa(pct, cls) { // bar + right-aligned value in the same cell
    var w = el('span', 'biRateCell');
    w.appendChild(barraCor(pct, cls, fmt(pct, 'pct')));
    w.appendChild(el('span', 'biRateVal', fmt(pct, 'pct')));
    return w;
  }

  function secaoFandi(titulo, conteudo) {
    var s = el('div', 'biSection');
    s.appendChild(el('p', 'biBlockLabel', titulo));
    s.appendChild(conteudo);
    return s;
  }

  function tabelaBancos(bancos) {
    var comRecusa = bancos.some(function (x) { return num(x.propostas) != null; });
    if (comRecusa) {
      return tabela([['Banco', false], ['Propostas', true, 'Prop.'], ['Recusadas', true, 'Rec.'], ['% recusa', true, '% rec.']],
        bancos.map(function (x) {
          return { cells: [String(x.banco || '—'), fmt(x.propostas, 'int'), fmt(x.recusadas, 'int'), celulaTaxa(x.taxa_recusa_pct, 'biToneWarn')] };
        }), { cls: 'biFandiTable' });
    }
    return tabela([['Banco', false], ['Operações', true, 'Oper.'], ['Financiado', true, 'Financ.']],
      bancos.map(function (x) { return { cells: [String(x.banco || '—'), fmt(x.faturadas_pagas, 'int'), fmt(x.financiado, 'brl0')] }; }), { cls: 'biFandiTable' });
  }

  function tabelaLojas(lojas, porCliente) {
    var cols = porCliente
      ? [['Loja', false], ['Aprovados sem financiar', true, 'Aprov. s/ fin.'], ['Perdidos por recusa', true, 'Perdidos'], ['% aprovação (clientes)', true, '% aprov.']]
      : [['Loja', false], ['Aprovadas', true, 'Aprov.'], ['Recusadas', true, 'Rec.'], ['% aprovação', true, '% aprov.']];
    return tabela(cols,
      lojas.map(function (x) {
        return { cells: [String(x.loja || '—'), fmt(x.aprovadas, 'int'), fmt(x.recusadas, 'int'),
          num(x.taxa_aprovacao_pct) != null ? celulaTaxa(x.taxa_aprovacao_pct, 'biToneGood') : '—'] };
      }), { cls: 'biFandiTable' });
  }

  // CPF-based view of the Análise F&I screen, explained in plain words
  function kpisPorCliente(r) {
    var g = el('div', 'biFandiKpis biFandiKpis2 biClientKpis');
    g.appendChild(kpiFandi('Clientes aprovados que ainda não financiaram', fmt(r.propostas_aprovadas_em_aberto, 'int'), fmt(r.valor_aprovado_em_aberto, 'brl'),
      'modKpiCardInfo', 'aprovados em algum banco e ainda sem financiamento faturado'));
    g.appendChild(kpiFandi('Clientes perdidos por recusa', fmt(r.propostas_recusadas, 'int'), fmt(r.valor_recusado, 'brl'),
      'modKpiCardWarning', 'a última resposta dos bancos para esse cliente foi recusa'));
    return g;
  }

  function visaoPorCliente(r, lojas) { // collapsed by default
    var d = el('details', 'biDetails biClientView');
    d.appendChild(el('summary', null, 'Visão por cliente (como na tela Análise F&I)'));
    var corpo = el('div', 'biClientBody');
    corpo.appendChild(kpisPorCliente(r));
    if (lojas.length) corpo.appendChild(secaoFandi('Por loja', tabelaLojas(lojas, true)));
    d.appendChild(corpo);
    return d;
  }

  function mixPlanos(planos) {
    var box = el('div', 'biPlanMix');
    planos.forEach(function (x) {
      var nome = String(x.plano || '—');
      var row = el('div', 'biPlanRow');
      row.appendChild(el('span', 'biPlanName', nome));
      row.appendChild(barraCor(x.pct, PLANO_COR[nome.toUpperCase()] || 'biPlanLinear', nome + ': ' + fmt(x.pct, 'pct')));
      row.appendChild(el('span', 'biPlanVal', fmt(x.operacoes, 'int') + ' · ' + fmt(x.pct, 'pct')));
      box.appendChild(row);
    });
    return box;
  }

  // % over propostas_no_periodo, ready from the backend (situacao_das_propostas.pct[chave]).
  // propostas_no_periodo is the base itself, so its step is 100% by definition.
  function pctSit(sit, chave) {
    if (chave === 'propostas_no_periodo') return num(sit && sit.propostas_no_periodo) ? 100 : null;
    var p = sit && sit.pct && typeof sit.pct === 'object' ? sit.pct[chave] : null;
    return num(p);
  }
  function pctDoTotal(sit, chave) {
    var p = pctSit(sit, chave);
    return p != null ? fmt(p, 'pct') + ' das propostas' : null;
  }

  // Propostas → Aprovadas → Faturadas/Pagas, plus the side breakdown
  function funil(sit) {
    var wrap = el('div', 'biFunnelWrap');
    var etapa = function (rotulo, chave, cls) {
      var e = el('div', 'biFunnelStep' + (cls ? ' ' + cls : ''));
      e.appendChild(el('span', 'biFigLabel', rotulo));
      e.appendChild(el('span', 'biFunnelValue', fmt(sit[chave], 'int')));
      var p = pctSit(sit, chave);
      e.appendChild(barraCor(p, cls || 'biToneNeutral', rotulo + ': ' + (p != null ? fmt(p, 'pct') : '—')));
      e.appendChild(el('span', 'biFunnelPct', p != null ? fmt(p, 'pct') : '—'));
      return e;
    };
    var trilha = el('div', 'biFunnel');
    trilha.appendChild(etapa('Propostas', 'propostas_no_periodo', 'biToneNeutral'));
    trilha.appendChild(el('span', 'biFunnelArrow', '→'));
    trilha.appendChild(etapa('Aprovadas', 'aprovadas_total', 'biPlanBalao'));
    trilha.appendChild(el('span', 'biFunnelArrow', '→'));
    trilha.appendChild(etapa('Faturadas/Pagas', 'faturadas_ou_pagas', 'biToneGood'));
    wrap.appendChild(trilha);
    var lado = el('div', 'biFunnelSide');
    [['Aguardando faturamento', 'aguardando_faturamento', ''], ['Aprovadas sem faturar', 'aprovadas_sem_faturar', ''],
     ['Não convertidas', 'aprovadas_nao_convertidas', ''], ['Recusadas', 'recusadas', 'biFunnelWarn']].forEach(function (x) {
      if (num(sit[x[1]]) == null) return;
      var row = el('div', 'biFunnelSideRow' + (x[2] ? ' ' + x[2] : ''));
      row.appendChild(el('span', 'biFunnelSideLabel', x[0]));
      row.appendChild(el('span', 'biFunnelSideVal', fmt(sit[x[1]], 'int')));
      var p = pctSit(sit, x[1]);
      row.appendChild(el('span', 'biFunnelSidePct', p != null ? fmt(p, 'pct') : '—'));
      lado.appendChild(row);
    });
    if (lado.childNodes.length) wrap.appendChild(lado);
    return wrap;
  }

  function blocoFandi(b) {
    var card = el('div', 'biCard biCardFandi');
    var head = el('div', 'biSalHead');
    var quem = el('div', 'biSalWho');
    quem.appendChild(el('span', 'biSalName', textoOuNada(b.titulo) || 'Análise F&I · FANDI'));
    if (textoOuNada(b.visao)) quem.appendChild(badge(String(b.visao), 'modBadgeInfo'));
    head.appendChild(quem);
    if (textoOuNada(b.periodo)) head.appendChild(badge(String(b.periodo), 'modBadgeNeutral'));
    card.appendChild(head);
    // base warning strip: right below the header, before any number
    if (textoOuNada(b.base_aviso)) card.appendChild(el('p', 'modBadge modBadgeWarning biWarnStrip', String(b.base_aviso)));
    var quando = dataHoraBr(b.base_atualizada_em);
    if (quando) card.appendChild(el('p', 'biSalComp', 'Base atualizada em ' + quando));
    if (b.sem_dados_do_periodo === true) {
      if (b.aviso) card.appendChild(el('p', 'biCardNote', String(b.aviso)));
      return card; // the base doesn't reach this period yet: only the warning
    }

    var r = b.resumo || {};
    var bancos = (Array.isArray(b.por_banco) ? b.por_banco : []).filter(Boolean);
    var lojas = (Array.isArray(b.por_loja) ? b.por_loja : []).filter(Boolean);
    var planos = (Array.isArray(b.por_plano) ? b.por_plano : []).filter(Boolean);
    var foco = String(b.foco || 'geral');
    var sit = b.situacao_das_propostas && typeof b.situacao_das_propostas === 'object' ? b.situacao_das_propostas : null;

    if (foco === 'faturamento' && sit) {
      var fat = el('div', 'biFandiKpis biFandiKpis2');
      fat.appendChild(kpiFandi('Faturadas/Pagas', fmt(sit.faturadas_ou_pagas, 'int'), pctDoTotal(sit, 'faturadas_ou_pagas'), 'modKpiCardSuccess'));
      fat.appendChild(kpiFandi('Aguardando faturamento', fmt(sit.aguardando_faturamento, 'int'), pctDoTotal(sit, 'aguardando_faturamento'), 'modKpiCardInfo'));
      card.appendChild(fat);
      card.appendChild(secaoFandi('Situação das propostas', funil(sit)));
      card.appendChild(visaoPorCliente(r, lojas));
    } else if (foco === 'aprovacoes' && sit) {
      var ap = el('div', 'biFandiHero biToneGood');
      ap.appendChild(el('span', 'biFigLabel', 'Aprovadas'));
      ap.appendChild(el('span', 'biSalTotal', fmt(sit.aprovadas_total, 'int')));
      ap.appendChild(el('span', 'biCashRead', fmt(sit.faturadas_ou_pagas, 'int') + ' já faturadas · ' + (pctDoTotal(sit, 'aprovadas_total') || '—')));
      card.appendChild(ap);
      card.appendChild(secaoFandi('Situação das propostas', funil(sit)));
      card.appendChild(visaoPorCliente(r, lojas));
    } else if (foco === 'recusas_por_banco') {
      var m = b.banco_que_mais_recusou;
      if (m) {
        var box = el('div', 'biFandiHero');
        box.appendChild(el('span', 'biFigLabel', 'Banco que mais recusou'));
        var linha = el('div', 'biSalTotalRow');
        linha.appendChild(el('span', 'biSalTotal', String(m.banco || '—')));
        if (num(m.taxa_recusa_pct) != null) linha.appendChild(badge(fmt(m.taxa_recusa_pct, 'pct') + ' de recusa', 'modBadgeWarning'));
        box.appendChild(linha);
        box.appendChild(linhasDl([
          ['Propostas recusadas', fmt(m.recusadas, 'int') + (num(m.propostas) != null ? ' de ' + fmt(m.propostas, 'int') : '')],
          ['Valor recusado', fmt(m.valor_recusado, 'brl')]
        ]));
        card.appendChild(box);
      } else {
        card.appendChild(el('p', 'biResumo', 'Nenhuma proposta recusada no período.'));
      }
      if (bancos.length) card.appendChild(secaoFandi('Recusas por banco', tabelaBancos(bancos)));
    } else if (foco === 'aprovacoes') {
      // without situacao_das_propostas the client view is the only content, so it stays open
      card.appendChild(kpisPorCliente(r));
      if (lojas.length) card.appendChild(secaoFandi('Por loja', tabelaLojas(lojas, true)));
    } else if (foco === 'geral') {
      var kg = el('div', 'biFandiKpis biFandiKpis2');
      kg.appendChild(kpiFandi('Operações financiadas', fmt(r.operacoes_financiadas, 'int'), null, ''));
      kg.appendChild(kpiFandi('Total financiado', fmt(r.total_financiado, 'brl0'), null, ''));
      card.appendChild(kg);
      if (sit) card.appendChild(secaoFandi('Situação das propostas', funil(sit)));
      if (bancos.length) card.appendChild(secaoFandi('Bancos', tabelaBancos(bancos.slice(0, 5))));
      if (planos.length) card.appendChild(secaoFandi('Planos', mixPlanos(planos)));
      card.appendChild(visaoPorCliente(r, lojas.slice(0, 8)));
    } else if (foco === 'planos') {
      var pp = b.plano_pedido;
      if (pp) {
        var hp = el('div', 'biFandiHero ' + (PLANO_COR[String(pp.plano || '').toUpperCase()] || 'biPlanLinear'));
        hp.appendChild(el('span', 'biFigLabel', String(pp.plano || 'Plano')));
        hp.appendChild(el('span', 'biSalTotal', fmt(pp.operacoes, 'int') + ' operações'));
        hp.appendChild(el('span', 'biCashRead', fmt(pp.pct, 'pct') + ' das ' + fmt(r.operacoes_financiadas, 'int') + ' operações · ' + fmt(pp.financiado, 'brl0')));
        card.appendChild(hp);
      }
      if (planos.length) card.appendChild(secaoFandi('Mix de planos', mixPlanos(planos)));
    } else {
      var kp = el('div', 'biFandiKpis');
      kp.appendChild(kpiFandi('Operações financiadas', fmt(r.operacoes_financiadas, 'int'), null, ''));
      kp.appendChild(kpiFandi('Total financiado', fmt(r.total_financiado, 'brl0'), null, ''));
      kp.appendChild(kpiFandi('Aprovadas em aberto', fmt(r.propostas_aprovadas_em_aberto, 'int'), fmt(r.valor_aprovado_em_aberto, 'brl0'), 'modKpiCardInfo'));
      kp.appendChild(kpiFandi('Recusadas', fmt(r.propostas_recusadas, 'int'), fmt(r.valor_recusado, 'brl0'), 'modKpiCardWarning'));
      card.appendChild(kp);
      // bancos / lojas (unchanged): the 3 compact sections, the focused one first
      var secoes = {
        bancos: bancos.length ? secaoFandi('Bancos', tabelaBancos(bancos.slice(0, 5))) : null,
        planos: planos.length ? secaoFandi('Planos', mixPlanos(planos)) : null,
        lojas: lojas.length ? secaoFandi('Lojas', tabelaLojas(lojas.slice(0, 8))) : null
      };
      var ordem = foco === 'lojas' ? ['lojas', 'bancos', 'planos'] : ['bancos', 'planos', 'lojas'];
      ordem.forEach(function (k) { if (secoes[k]) card.appendChild(secoes[k]); });
    }

    if (textoOuNada(b.definicoes)) {
      var det = el('details', 'biDetails');
      det.appendChild(el('summary', null, 'Como contamos'));
      det.appendChild(el('p', 'biExpand', String(b.definicoes)));
      card.appendChild(det);
    }
    if (b.aviso) card.appendChild(el('p', 'biCardNote', String(b.aviso)));
    return card;
  }

  // --- plano (Coparticipado / Taxa Subsidiada / Semestral Taxa 0%) ----------
  // Same hierarchy, labels and classes as the Simulador de Novos result views
  // (simulador-novos.js calcCampanha / calcSubsidiadas / calcTriton; simuladores.css).
  var NF_TAXA_BANCO = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  function pct2(v) { return num(v) != null ? NF.taxa2.format(v) + '%' : '—'; } // rebate % with 2 places, like the Simulador's pct2

  function kpi(rotulo, valor, sub) { // .resultSecondaryGrid cell
    var d = el('div', 'biPlanoKpi');
    d.appendChild(el('p', 'kpiLabel', rotulo));
    d.appendChild(el('p', 'val', valor));
    if (sub) d.appendChild(el('p', 'biPlanoSub', sub));
    return d;
  }

  function gradeKpis(itens) {
    var g = el('div', 'resultSecondaryGrid biPlanoGrid');
    itens.forEach(function (x) { if (x) g.appendChild(x); });
    return g;
  }

  function faixaRebate(r) {
    if (!r || typeof r !== 'object') return null;
    var box = el('div', 'biPlanoRebate');
    box.appendChild(el('p', 'kpiLabel', 'Rebate — custo comercial da taxa'));
    box.appendChild(gradeKpis([
      kpi('Rebate total', fmt(r.total, 'brl'), num(r.total_pct_do_financiado) != null ? pct2(r.total_pct_do_financiado) + ' do financiado' : null),
      kpi('Rebate HPE', fmt(r.hpe, 'brl'), num(r.hpe_pct_do_rebate) != null ? pct2(r.hpe_pct_do_rebate) + ' do rebate' : null),
      kpi('Rebate Brabus', fmt(r.brabus, 'brl'), num(r.brabus_pct_do_rebate) != null ? pct2(r.brabus_pct_do_rebate) + ' do rebate' : null)
    ]));
    return box;
  }

  function destaqueValorFinal(v) {
    var c = el('div', 'smEmphasisCard smEmphasisCardPrimary biPlanoFinal');
    c.appendChild(el('p', 'kpiLabel', 'Valor final de venda'));
    c.appendChild(el('p', 'smEmphasisValue smEmphasisValuePrimary', fmt(v, 'brl')));
    return c;
  }

  function entradaKpi(b, rotulo) {
    return kpi(rotulo, fmt(b.entrada, 'brl'), num(b.entrada_pct) != null ? fmt(b.entrada_pct, 'pct') + ' do veículo' : null);
  }

  function planoCoparticipado(card, b) {
    var itens = [kpi('Entrada mínima (' + fmt(b.entrada_minima_pct, 'pct') + ')', fmt(b.entrada_minima, 'brl'))];
    if (num(b.entrada) != null && Math.abs(b.entrada - (b.entrada_minima || 0)) >= 0.01) itens.push(entradaKpi(b, 'Entrada'));
    itens.push(kpi('Financiado', fmt(b.financiado, 'brl')));
    card.appendChild(gradeKpis(itens));
    var linhas = (Array.isArray(b.linhas) ? b.linhas : []).filter(Boolean);
    if (linhas.length) {
      card.appendChild(el('p', 'kpiLabel biPlanoSecao', 'Parcela por prazo'));
      var grade = el('div', 'smTermGrid biPlanoPrazos');
      grade.setAttribute('role', 'list');
      // exact divisor of the item count, like UI.wireTermResultGrid (no half-empty last row)
      var cols = linhas.length <= 6 ? linhas.length : [6, 5, 4, 3].filter(function (c) { return linhas.length % c === 0; })[0] || 4;
      grade.style.setProperty('--term-grid-cols', String(cols));
      linhas.forEach(function (l) {
        var t = el('div', 'smTermCard');
        t.setAttribute('role', 'listitem');
        t.appendChild(el('div', 'term', (num(l.prazo) != null ? l.prazo : '—') + 'x'));
        t.appendChild(el('div', 'payment', fmt(l.parcela, 'brl')));
        t.appendChild(el('div', 'rate', fmt(l.taxa_pct_am, 'taxa2')));
        grade.appendChild(t);
      });
      card.appendChild(grade);
    }
    var rb = faixaRebate(b.rebate);
    if (rb) card.appendChild(rb);
    card.appendChild(destaqueValorFinal(b.valor_final_venda));
  }

  var seqAbas = 0;
  function planoTaxaSubsidiada(card, b) {
    var itens = [kpi('Entrada mínima (' + fmt(num(b.entrada_minima_pct) != null ? b.entrada_minima_pct : 50, 'pct') + ')', fmt(b.entrada_minima, 'brl'))];
    if (num(b.entrada) != null && Math.abs(b.entrada - (b.entrada_minima || 0)) >= 0.01) itens.push(entradaKpi(b, 'Entrada'));
    itens.push(kpi('Financiado', fmt(b.financiado, 'brl')));
    card.appendChild(gradeKpis(itens));
    var linhas = (Array.isArray(b.linhas) ? b.linhas : []).filter(function (l) { return l && num(l.taxa_pct_am) != null; });
    if (!linhas.length) return;
    var melhor = linhas.filter(function (l) { return l.melhor_valor_final === true; })[0] || null;
    if (melhor) {
      var m = el('p', 'biPlanoMelhor');
      m.appendChild(el('span', 'smPill excellent', 'Melhor opção'));
      m.appendChild(document.createTextNode(' ' + melhor.prazo + 'x a ' + fmt(melhor.taxa_pct_am, 'taxa2') + ' · valor final de venda ' + fmt(melhor.valor_final_venda, 'brl')));
      card.appendChild(m);
    }
    var taxas = (Array.isArray(b.taxas_pct_am) && b.taxas_pct_am.length ? b.taxas_pct_am : linhas.map(function (l) { return l.taxa_pct_am; }))
      .filter(function (t, i, a) { return num(t) != null && a.indexOf(t) === i; }).sort(function (x, y) { return x - y; });
    var inicial = melhor ? melhor.taxa_pct_am : taxas[0];
    var id = 'biAbas' + (++seqAbas);
    var abas = el('div', 'segmented biPlanoAbas');
    abas.setAttribute('role', 'tablist');
    abas.setAttribute('aria-label', 'Taxa subsidiada');
    var paineis = [];
    taxas.forEach(function (t, k) {
      var botao = el('button', null, 'Taxa ' + fmt(t, 'taxa2').replace(' a.m.', ''));
      botao.type = 'button';
      botao.id = id + 't' + k;
      botao.setAttribute('role', 'tab');
      botao.setAttribute('aria-controls', id + 'p' + k);
      var painel = el('div', 'smSubsidiadaGrid biPlanoSubGrid');
      painel.id = id + 'p' + k;
      painel.setAttribute('role', 'tabpanel');
      painel.setAttribute('aria-labelledby', botao.id);
      linhas.filter(function (l) { return l.taxa_pct_am === t; }).sort(function (x, y) { return x.prazo - y.prazo; }).forEach(function (l) {
        painel.appendChild(cartaoSubsidiada(l));
      });
      abas.appendChild(botao);
      paineis.push({ botao: botao, painel: painel, taxa: t });
    });
    var seleciona = function (alvo, foco) {
      paineis.forEach(function (p) {
        var ativo = p === alvo;
        p.botao.className = ativo ? 'active' : '';
        p.botao.setAttribute('aria-selected', ativo ? 'true' : 'false');
        p.botao.tabIndex = ativo ? 0 : -1;
        p.painel.hidden = !ativo;
      });
      if (foco) alvo.botao.focus();
    };
    paineis.forEach(function (p, k) {
      p.botao.addEventListener('click', function () { seleciona(p, false); });
      p.botao.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        seleciona(paineis[(k + d + paineis.length) % paineis.length], true);
      });
    });
    card.appendChild(abas);
    paineis.forEach(function (p) { card.appendChild(p.painel); });
    seleciona(paineis.filter(function (p) { return p.taxa === inicial; })[0] || paineis[0], false);
    card.appendChild(el('p', 'smFootnote', 'Rebate é o custo comercial da taxa subsidiada — nunca um desconto concedido ao cliente. Valor final de venda já considera o valor líquido para a loja. Taxa banco = taxa a cadastrar no banco (botão “Copiar Taxa Banco” do Simulador).'));
  }

  function linhaSub(rotulo, valor, enfase, sub) {
    var r = el('div', 'smSubsidiadaCardRow' + (enfase ? ' smSubsidiadaCardRowEmphasis' : ''));
    r.appendChild(el('span', 'kpiLabel', rotulo));
    if (sub) {
      var pilha = el('span', 'smSubsidiadaCardValueStack');
      pilha.appendChild(el('strong', null, valor));
      pilha.appendChild(el('span', 'smSubsidiadaCardRebatePct', sub));
      r.appendChild(pilha);
    } else r.appendChild(el('strong', null, valor));
    return r;
  }

  function cartaoSubsidiada(l) {
    var c = el('div', 'smSubsidiadaCard' + (l.melhor_valor_final === true ? ' best' : ''));
    var h = el('div', 'smSubsidiadaCardHead');
    h.appendChild(el('span', 'smSubsidiadaCardPrazo', l.prazo + 'x'));
    h.appendChild(el('span', 'smSubsidiadaCardTaxa', fmt(l.taxa_pct_am, 'taxa2')));
    c.appendChild(h);
    if (l.melhor_valor_final === true) {
      var pill = el('div', 'smSubsidiadaCardPill');
      pill.appendChild(el('span', 'smPill excellent', 'Melhor opção'));
      c.appendChild(pill);
    }
    c.appendChild(linhaSub('Parcela', fmt(l.parcela, 'brl')));
    c.appendChild(linhaSub('Rebate — custo comercial', fmt(l.rebate, 'brl'), true,
      num(l.rebate_pct_do_financiado) != null ? pct2(l.rebate_pct_do_financiado) + ' do valor financiado' : null));
    c.appendChild(linhaSub('Valor final de venda', fmt(l.valor_final_venda, 'brl'), true));
    if (num(l.taxa_banco_cadastrar_pct_am) != null) c.appendChild(linhaSub('Taxa banco', NF_TAXA_BANCO.format(l.taxa_banco_cadastrar_pct_am) + '% a.m.'));
    return c;
  }

  function planoSemestral(card, b) {
    var hero = el('div', 'resultHero biPlanoHero');
    hero.appendChild(el('p', 'kpiLabel', 'Parcela (' + ((Array.isArray(b.pagamentos) && b.pagamentos.length) || 4) + 'x semestrais)'));
    hero.appendChild(el('p', 'resultValue', fmt(b.parcela_semestral, 'brl')));
    card.appendChild(hero);
    card.appendChild(gradeKpis([
      kpi('Entrada fixa (' + fmt(b.entrada_pct, 'pct') + ')', fmt(b.entrada, 'brl')),
      kpi('Financiado', fmt(b.financiado, 'brl')),
      kpi('Taxa', fmt(num(b.taxa_pct_am) != null ? b.taxa_pct_am : 0, 'taxa2')),
      num(b.total_parcelas) != null ? kpi('Total das parcelas', fmt(b.total_parcelas, 'brl')) : null
    ]));
    var pags = (Array.isArray(b.pagamentos) ? b.pagamentos : []).filter(function (p) { return p && num(p.mes) != null; });
    if (pags.length) {
      var sch = el('div', 'smSchedule');
      sch.appendChild(el('p', 'kpiLabel', 'Cronograma do plano'));
      var linha = el('div', 'smScheduleRow');
      var item = function (rot, val) {
        var it = el('div', 'smScheduleItem');
        it.appendChild(el('span', 'smScheduleLabel', rot));
        if (val != null) it.appendChild(el('strong', null, val));
        return it;
      };
      linha.appendChild(item('Prazo total', (num(b.prazo) != null ? b.prazo : Math.max.apply(null, pags.map(function (p) { return p.mes; }))) + ' meses'));
      linha.appendChild(item('Periodicidade', 'Semestral'));
      linha.appendChild(item(pags.length + ' parcelas especiais', null));
      sch.appendChild(linha);
      sch.appendChild(el('p', 'smScheduleMarkersLabel', 'Ocorrem nas parcelas:'));
      var marcas = el('div', 'smScheduleRow biPlanoSemestrais');
      marcas.setAttribute('role', 'list');
      marcas.setAttribute('aria-label', 'Parcelas semestrais');
      pags.forEach(function (p) {
        var it = item(p.mes + 'ª parcela', fmt(p.valor, 'brl'));
        it.setAttribute('role', 'listitem');
        marcas.appendChild(it);
      });
      sch.appendChild(marcas);
      card.appendChild(sch);
    }
    var rb = faixaRebate(b.rebate);
    if (rb) card.appendChild(rb);
    card.appendChild(destaqueValorFinal(b.valor_final_venda));
    card.appendChild(el('p', 'smFootnote', 'Entrada fixa por modelo — não permite alteração manual.'));
  }

  function blocoPlano(b) {
    var card = el('div', 'biCard biCardPlano');
    var v = b.veiculo || {};
    var chips = [];
    if (b.plano_nome) chips.push(chip(String(b.plano_nome), 'biChipAccent'));
    if (num(v.valor) != null) chips.push(chip('Veículo ' + fmt(v.valor, 'brl')));
    card.appendChild(cabecalhoCartao(b.titulo, chips));
    if (b.plano === 'COPARTICIPADO') planoCoparticipado(card, b);
    else if (b.plano === 'TAXA_SUBSIDIADA') planoTaxaSubsidiada(card, b);
    else if (b.plano === 'SEMESTRAL_TAXA_ZERO') planoSemestral(card, b);
    else return null;
    if (b.leitura) card.appendChild(el('p', 'biCardNote', String(b.leitura)));
    return card;
  }

  function renderBlocos(blocos) {
    if (!Array.isArray(blocos) || !blocos.length) return null;
    var box = el('div', 'biCards');
    blocos.forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      try {
        if (b.tipo === 'opcoes') box.appendChild(blocoOpcoes(b));
        else if (b.tipo === 'resultado') box.appendChild(blocoResultado(b));
        else if (b.tipo === 'comparacao') box.appendChild(blocoComparacao(b));
        else if (b.tipo === 'score') box.appendChild(blocoScore(b));
        else if (b.tipo === 'antecipacao') box.appendChild(blocoAntecipacao(b));
        else if (b.tipo === 'cash') box.appendChild(blocoCash(b));
        else if (b.tipo === 'salario') box.appendChild(blocoSalario(b));
        else if (b.tipo === 'fandi') box.appendChild(blocoFandi(b));
        else if (b.tipo === 'plano') { var pl = blocoPlano(b); if (pl) box.appendChild(pl); }
      } catch (e) { /* a malformed card never hides the text answer */ }
    });
    return box.childNodes.length ? box : null;
  }

  /* ============================================================
     CHAT — UI inside the drawer
     ============================================================ */

  function bolhaUsuario(texto) {
    var d = el('div', 'biMsg biMsgUser');
    d.appendChild(el('p', null, texto));
    return d;
  }

  function bolhaResposta(texto, ferramentas, blocos, avisoVoz, tempos) {
    var d = el('div', 'biMsg biMsgBot');
    var cards = renderBlocos(blocos);
    if (cards) { d.className += ' biMsgComCartoes'; d.appendChild(cards); }
    d.appendChild(markdown(texto));
    var nomes = (ferramentas || []).map(function (f) { return f && f.nome ? String(f.nome).replace(/_/g, ' ') : ''; }).filter(Boolean);
    if (nomes.length) d.appendChild(el('p', 'biFonte', 'Consultado no Portal: ' + nomes.join(' · ')));
    if (avisoVoz) d.appendChild(el('p', 'biAvisoVoz', String(avisoVoz)));
    var linhaTempos = tempos && temposVisiveis() ? linhaDeTempos(tempos) : null;
    if (linhaTempos) d.appendChild(linhaTempos);
    return d;
  }

  // Dev-only timing line (backend `tempos`): hidden by default everywhere; shown only with
  // ?tempos=1 AND on localhost/127.0.0.1 — never on homolog/production, even with the parameter.
  function ehLocalhost() {
    var h = String(window.location.hostname || '');
    return h === 'localhost' || h === '127.0.0.1';
  }

  function temposVisiveis() {
    if (!ehLocalhost()) return false;
    try { return new URLSearchParams(window.location.search).get('tempos') === '1'; } catch (e) { return false; }
  }

  var NF_SEG = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function seg(ms) { return NF_SEG.format(ms / 1000); }

  function linhaDeTempos(t) {
    if (!t || typeof t !== 'object' || num(t.total_ms) == null) return null;
    var passos = Array.isArray(t.passos) ? t.passos.filter(function (p) { return p && typeof p === 'object'; }) : [];
    var p = el('p', 'biTempos');
    var partes = ['⏱ ' + seg(t.total_ms) + ' s'];
    if (num(t.contexto_ms) != null) partes.push('perfil ' + seg(t.contexto_ms));
    if (num(t.transcricao_ms) != null) partes.push('voz→texto ' + seg(t.transcricao_ms));
    var modelo = passos.filter(function (x) { return num(x.modelo_ms) != null; }).map(function (x) { return seg(x.modelo_ms); });
    if (modelo.length) partes.push('modelo ' + modelo.join(' + '));
    p.appendChild(document.createTextNode(partes.join(' · ')));
    var comBanco = passos.filter(function (x) { return Array.isArray(x.ferramentas) && x.ferramentas.length && num(x.ferramentas_ms) != null; });
    if (comBanco.length) {
      p.appendChild(document.createTextNode(' · '));
      var banco = el('span', 'biTemposBanco', 'banco ' + comBanco.map(function (x) { return seg(x.ferramentas_ms); }).join(' + '));
      banco.title = comBanco.map(function (x) { return 'passo ' + x.passo + ': ' + x.ferramentas.map(String).join(', '); }).join(' · ');
      p.appendChild(banco);
    }
    if (num(t.voz_ms) != null) p.appendChild(document.createTextNode(' · fala ' + seg(t.voz_ms)));
    return p;
  }

  function bolhaPensando(texto) {
    var d = el('div', 'biMsg biMsgBot biMsgPensando');
    var p = el('p', 'biPensando');
    p.appendChild(el('span')); p.appendChild(el('span')); p.appendChild(el('span'));
    p.appendChild(document.createTextNode(' ' + texto));
    d.appendChild(p);
    return d;
  }

  function bolhaErro(texto) {
    var d = el('div', 'biMsg biMsgBot biMsgErro');
    d.appendChild(el('p', null, texto));
    return d;
  }

  function rolar() {
    var body = document.getElementById('baiPanelBody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderVazio(lista) {
    var vazio = el('div', 'biVazio');
    vazio.appendChild(el('p', null, 'Pergunte sobre planos, parcelas, entrada mínima, antecipação ou resultados. Por exemplo:'));
    var sug = el('div', 'biSugestoes');
    SUGESTOES.forEach(function (s) {
      var b = el('button', 'biChip', s);
      b.type = 'button';
      b.addEventListener('click', function () { enviar(s); });
      sug.appendChild(b);
    });
    vazio.appendChild(sug);
    lista.appendChild(vazio);
  }

  function renderConversa() {
    var lista = document.getElementById('biLista');
    if (!lista) return;
    lista.textContent = '';
    if (!chat.historico.length) { renderVazio(lista); return; }
    chat.historico.forEach(function (m) {
      lista.appendChild(m.papel === 'user' ? bolhaUsuario(m.texto) : bolhaResposta(m.texto, m.ferramentas, m.blocos));
    });
    rolar();
  }

  function setEnviando(sim) {
    chat.enviando = sim;
    var botao = document.getElementById('biEnviar');
    var input = document.getElementById('biInput');
    if (botao) botao.disabled = sim;
    if (input) input.setAttribute('aria-busy', sim ? 'true' : 'false');
    atualizaMic();
  }

  function enviar(pergunta) {
    pergunta = String(pergunta || '').trim();
    var lista = document.getElementById('biLista');
    var input = document.getElementById('biInput');
    if (!pergunta || chat.enviando || !lista) return;
    if (voz.estado === 'ouvindo' || voz.estado === 'pensando') return;
    pararFala(); // also cancels voice pieces still being fetched
    var vazio = lista.querySelector('.biVazio');
    if (vazio) vazio.remove();

    lista.appendChild(bolhaUsuario(pergunta));
    var pensando = bolhaPensando('consultando o Portal…');
    lista.appendChild(pensando);
    if (input) input.value = '';
    setEnviando(true);
    rolar();

    pedir(pergunta).then(function (j) {
      pensando.remove();
      chat.historico.push(
        { papel: 'user', texto: pergunta },
        { papel: 'assistant', texto: j.resposta, ferramentas: j.ferramentas || [], blocos: Array.isArray(j.blocos) ? j.blocos : [] }
      );
      lista.appendChild(bolhaResposta(j.resposta, j.ferramentas, j.blocos, null, j.tempos));
    }).catch(function (e) {
      pensando.remove();
      lista.appendChild(bolhaErro((e && e.message) || String(e)));
    }).then(function () {
      setEnviando(false);
      if (input && !document.getElementById('baiPanelDrawer').hidden) input.focus();
      rolar();
    });
  }

  function novaConversa() {
    if (chat.enviando) return;
    pararVoz();
    resetChat();
    renderConversa();
    var input = document.getElementById('biInput');
    if (input) { input.value = ''; input.focus(); }
  }

  /* ============================================================
     VOICE — dictated question (MediaRecorder) + spoken answer.
     Same endpoint/headers as the typed chat; the body adds
     audio_base64/audio_mime/falar. The Voice Orb (bi-voice-orb.js)
     only draws: ouvindo (mic amplitude), pensando, falando (answer
     amplitude). Nothing is stored: the recording lives in memory
     until it is sent, the answer audio until it finishes playing.
     ============================================================ */

  var MAX_GRAVACAO_MS = 60000;
  var MIN_GRAVACAO_MS = 1000;
  var ROTULO_ESTADO = { repouso: 'Pronto', ouvindo: 'Gravando…', pensando: 'Pensando…', falando: 'Falando' };
  var VELOCIDADE_FALA = 1.1; // answer playback rate (pitch preserved); tune here
  var DICA_MIC = 'Toque para falar, toque de novo para enviar';
  var CHAVE_DICA = 'nx.bi.voz.dicaVista';
  var SVG_ENVIAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">' +
    '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLASSE_ESTADO = { ouvindo: 'baiVoiceStateVOICE_LISTENING', pensando: 'baiVoiceStateVOICE_THINKING', falando: 'baiVoiceStateVOICE_SPEAKING' };
  // 10 ms of silence: played inside the tap so iOS lets the answer play later
  var SILENCIO = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

  var voz = {
    estado: 'repouso', indisponivel: null, porPermissao: false, iniciando: false,
    rec: null, stream: null, partes: [], inicio: 0, duracao: 0, descartar: false, timer: null, relogio: null,
    ctx: null, micFonte: null, micAnalyser: null, player: null, playerFonte: null, playerAnalyser: null,
    orb: null, avisoTimer: null, dicaTimer: null, atalhoEm: 0
  };

  function noop() {}

  function motivoSemVoz() {
    if (!window.isSecureContext) return 'O ditado por voz precisa de conexão segura (https).';
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return 'Este navegador não dá acesso ao microfone. Use o campo de texto.';
    if (typeof window.MediaRecorder === 'undefined') return 'Este navegador não grava áudio. Use o campo de texto.';
    return null;
  }

  function mimeGravacao() {
    var MR = window.MediaRecorder;
    var opcoes = ['audio/webm;codecs=opus', 'audio/mp4']; // mp4: Safari/iPhone
    for (var i = 0; i < opcoes.length; i++) {
      try { if (MR.isTypeSupported && MR.isTypeSupported(opcoes[i])) return opcoes[i]; } catch (e) { /* ignore */ }
    }
    return ''; // browser default
  }

  function audioCtx() {
    if (voz.ctx) return voz.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { voz.ctx = new AC(); } catch (e) { voz.ctx = null; }
    return voz.ctx;
  }

  function novoAnalyser(ctx) {
    var a = ctx.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.6;
    return a;
  }

  function atualizaMic() {
    var mic = document.getElementById('biMic');
    if (!mic) return;
    var gravando = voz.estado === 'ouvindo';
    var rotulo = voz.indisponivel ? 'Ditado por voz indisponível'
      : gravando ? 'Enviar pergunta por voz'
      : 'Perguntar por voz';
    mic.className = 'modBtn baiVoiceBtn biMic' + (CLASSE_ESTADO[voz.estado] ? ' ' + CLASSE_ESTADO[voz.estado] : '');
    mic.setAttribute('aria-disabled', voz.indisponivel || chat.enviando || voz.estado === 'pensando' ? 'true' : 'false');
    mic.setAttribute('aria-pressed', gravando ? 'true' : 'false');
    mic.setAttribute('aria-label', voz.indisponivel ? rotulo + ': ' + voz.indisponivel : rotulo);
    mic.title = voz.indisponivel || (gravando ? 'Enviar pergunta (Enter) · Esc cancela' : DICA_MIC);
  }

  function setEstadoVoz(estado) {
    voz.estado = estado;
    var palco = document.getElementById('biVoz');
    if (palco) { palco.hidden = estado === 'repouso'; palco.setAttribute('data-estado', estado); }
    var visivel = document.getElementById('biVozStatus');
    if (visivel) {
      visivel.textContent = '';
      if (estado === 'ouvindo') { // "Gravando… toque em [↑] para enviar" — same arrow the button shows
        visivel.appendChild(document.createTextNode('Gravando… toque em '));
        var seta = el('span', 'biVozSeta');
        seta.innerHTML = SVG_ENVIAR; // static markup constant, no external text
        visivel.appendChild(seta);
        visivel.appendChild(document.createTextNode(' para enviar'));
      } else visivel.textContent = ROTULO_ESTADO[estado];
    }
    var live = document.getElementById('biVozEstado');
    if (live) {
      live.textContent = estado === 'repouso' ? ''
        : estado === 'ouvindo' ? 'Gravando. Toque em Enviar pergunta por voz ou pressione Enter para enviar; Esc cancela.'
        : 'Brabus Intelligence: ' + ROTULO_ESTADO[estado];
    }
    var tempo = document.getElementById('biVozTempo');
    if (tempo && estado !== 'ouvindo') tempo.textContent = '';
    var cancelar = document.getElementById('biVozCancelar');
    if (cancelar) cancelar.hidden = estado !== 'ouvindo';
    var parar = document.getElementById('biVozParar');
    if (parar) parar.hidden = estado !== 'falando';
    if (voz.orb) voz.orb.setState(estado);
    atualizaMic();
  }

  function avisoVoz(msg) {
    var a = document.getElementById('biVozAviso');
    if (!a) return;
    a.textContent = msg;
    a.hidden = false;
    clearTimeout(voz.avisoTimer);
    voz.avisoTimer = setTimeout(function () { a.hidden = true; a.textContent = ''; }, 6000);
  }

  function bloqueiaVoz(msg, porPermissao, avisar) {
    voz.indisponivel = msg;
    voz.porPermissao = !!porPermissao;
    atualizaMic();
    if (avisar) avisoVoz(msg);
  }

  // Permission already denied in the browser → button disabled from the start;
  // if the user re-allows it in the browser settings, it comes back by itself.
  function observaPermissao() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return;
    navigator.permissions.query({ name: 'microphone' }).then(function (st) {
      var aplica = function () {
        if (st.state === 'denied') bloqueiaVoz('Permissão do microfone negada. Libere o microfone nas configurações do navegador.', true, false);
        else if (voz.porPermissao) { voz.indisponivel = null; voz.porPermissao = false; atualizaMic(); }
      };
      aplica();
      st.onchange = aplica;
    }, noop);
  }

  // Two <audio> elements take turns, so the next voice piece is already loaded while the current one plays.
  function players() {
    if (!voz.players) voz.players = [new Audio(), new Audio()];
    voz.players.forEach(function (p) { p.preload = 'auto'; });
    return voz.players;
  }

  // Both elements go through one AnalyserNode (the Orb reads it) on their way to the speakers.
  function ligaPlayers() {
    var ctx = audioCtx();
    if (!ctx || voz.playerAnalyser) return;
    try {
      voz.playerAnalyser = novoAnalyser(ctx);
      voz.playerAnalyser.connect(ctx.destination);
      players().forEach(function (p) { ctx.createMediaElementSource(p).connect(voz.playerAnalyser); });
    } catch (e) { voz.playerAnalyser = null; }
  }

  // Must run after every src change: loading a source resets playbackRate to defaultPlaybackRate.
  function ajustaVelocidade(p) {
    p.defaultPlaybackRate = VELOCIDADE_FALA;
    p.playbackRate = VELOCIDADE_FALA;
    p.preservesPitch = true; p.webkitPreservesPitch = true; p.mozPreservesPitch = true;
  }

  // Inside the tap: play silence on both elements so iOS lets them play the answer later.
  function preparaPlayer() {
    players().forEach(function (p) {
      p.biChave = null;
      p.src = SILENCIO;
      var r = p.play();
      if (r && r.catch) r.catch(noop);
    });
  }

  // First-time hint balloon over the mic; disappears after 4 s or on the first tap.
  function mostraDicaPrimeiraVez() {
    if (voz.indisponivel) return;
    var visto = true;
    try { visto = localStorage.getItem(CHAVE_DICA) === '1'; } catch (e) { /* storage blocked: skip the hint */ }
    if (visto) return;
    var dica = document.getElementById('biMicDica');
    if (!dica) return;
    dica.hidden = false;
    try { localStorage.setItem(CHAVE_DICA, '1'); } catch (e) { /* ignore */ }
    clearTimeout(voz.dicaTimer);
    voz.dicaTimer = setTimeout(escondeDica, 4000);
  }

  function escondeDica() {
    clearTimeout(voz.dicaTimer);
    var dica = document.getElementById('biMicDica');
    if (dica) dica.hidden = true;
  }

  // While recording: Enter/Space send, Esc cancels (capture phase, so Esc does not close the drawer).
  function atalhosGravacao(e) {
    if (voz.estado !== 'ouvindo' || !voz.rec) return;
    var k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Escape' || k === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      voz.atalhoEm = Date.now(); // the focused mic button must not also "click" on this key
      pararGravacao(k === 'Escape' || k === 'Esc');
    }
  }

  function clicarMic(e) {
    escondeDica();
    // only the keyboard-synthesized click (detail 0) of the shortcut key itself is swallowed; real taps always count
    if (e && e.detail === 0 && Date.now() - voz.atalhoEm < 500) return;
    if (voz.indisponivel) { avisoVoz(voz.indisponivel); return; }
    if (chat.enviando || voz.estado === 'pensando' || voz.iniciando) return;
    if (voz.estado === 'ouvindo') { pararGravacao(false); return; }
    pararFala();
    iniciarGravacao();
  }

  function iniciarGravacao() {
    voz.iniciando = true;
    var ctx = audioCtx(); // created inside the tap, so it is allowed to play the answer later
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(noop);
    preparaPlayer();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      voz.iniciando = false;
      var drawer = document.getElementById('baiPanelDrawer');
      if (!drawer || drawer.hidden) { stream.getTracks().forEach(function (t) { t.stop(); }); return; } // closed meanwhile
      var mime = mimeGravacao();
      var rec;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { mime = ''; rec = new MediaRecorder(stream); }
      voz.stream = stream; voz.rec = rec; voz.partes = []; voz.descartar = false; voz.inicio = Date.now();
      rec.ondataavailable = function (e) { if (e.data && e.data.size) voz.partes.push(e.data); };
      rec.onstop = function () { finalizaGravacao(rec, mime); };
      rec.start(250);
      voz.micAnalyser = null;
      if (ctx) {
        try { voz.micFonte = ctx.createMediaStreamSource(stream); voz.micAnalyser = novoAnalyser(ctx); voz.micFonte.connect(voz.micAnalyser); }
        catch (e) { voz.micAnalyser = null; }
      }
      if (voz.orb) voz.orb.setAnalyser(voz.micAnalyser);
      setEstadoVoz('ouvindo');
      var tempo = document.getElementById('biVozTempo');
      var relogio = function () {
        var s = Math.floor((Date.now() - voz.inicio) / 1000);
        if (tempo) tempo.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + ' / 1:00';
      };
      relogio();
      voz.relogio = setInterval(relogio, 250);
      voz.timer = setTimeout(function () { pararGravacao(false); }, MAX_GRAVACAO_MS); // auto-send at 60 s
    }, function (err) {
      voz.iniciando = false;
      var nome = err && err.name;
      if (nome === 'NotAllowedError' || nome === 'SecurityError') {
        bloqueiaVoz('Permissão do microfone negada. Libere o microfone nas configurações do navegador para perguntar por voz.', true, true);
      } else if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
        bloqueiaVoz('Nenhum microfone encontrado neste dispositivo.', false, true);
      } else avisoVoz('Não consegui acessar o microfone agora. Tente de novo.');
    });
  }

  function soltaMicrofone() {
    if (voz.stream) voz.stream.getTracks().forEach(function (t) { t.stop(); });
    try { if (voz.micFonte) voz.micFonte.disconnect(); } catch (e) { /* ignore */ }
    voz.stream = null; voz.micFonte = null; voz.micAnalyser = null;
  }

  function pararGravacao(descartar) {
    var rec = voz.rec;
    if (!rec) return;
    clearTimeout(voz.timer); clearInterval(voz.relogio);
    voz.timer = null; voz.relogio = null;
    voz.descartar = !!descartar;
    voz.duracao = Date.now() - voz.inicio;
    if (voz.orb) voz.orb.setAnalyser(null);
    if (!voz.descartar && voz.duracao >= MIN_GRAVACAO_MS) setEstadoVoz('pensando');
    try { if (rec.state !== 'inactive') rec.stop(); else finalizaGravacao(rec, ''); }
    catch (e) { finalizaGravacao(rec, ''); }
    soltaMicrofone();
  }

  function finalizaGravacao(rec, mime) {
    if (voz.rec !== rec) return;
    voz.rec = null;
    var partes = voz.partes;
    voz.partes = [];
    if (voz.descartar) { setEstadoVoz('repouso'); return; }
    if (voz.duracao < MIN_GRAVACAO_MS) {
      setEstadoVoz('repouso');
      avisoVoz('Gravação muito curta. Fale por pelo menos 1 segundo.');
      return;
    }
    var tipo = rec.mimeType || mime || (partes[0] && partes[0].type) || 'audio/webm';
    var blob = new Blob(partes, { type: tipo });
    if (!blob.size) { setEstadoVoz('repouso'); avisoVoz('Não captei nenhum áudio. Tente de novo.'); return; }
    var leitor = new FileReader();
    leitor.onload = function () { enviarAudio(String(leitor.result), tipo); };
    leitor.onerror = function () { setEstadoVoz('repouso'); avisoVoz('Não consegui ler a gravação. Tente de novo.'); };
    leitor.readAsDataURL(blob);
  }

  function enviarAudio(dataUrl, mime) {
    var lista = document.getElementById('biLista');
    if (!lista || chat.enviando) { setEstadoVoz('repouso'); return; }
    var vazio = lista.querySelector('.biVazio');
    if (vazio) vazio.remove();
    // placeholder bubble; becomes the transcription when the answer arrives
    var bolha = bolhaUsuario('Pergunta por voz…');
    bolha.className += ' biMsgVozPendente';
    lista.appendChild(bolha);
    var pensando = bolhaPensando('transcrevendo e consultando o Portal…');
    lista.appendChild(pensando);
    setEnviando(true);
    setEstadoVoz('pensando');
    rolar();

    var falando = false, partes = null, linhaTempos = null;
    pedir('', { audio_base64: dataUrl, audio_mime: mime, falar: 'partes' }).then(function (j) {
      pensando.remove();
      var pergunta = typeof j.transcricao === 'string' && j.transcricao.trim() ? j.transcricao.trim() : 'Pergunta por voz';
      bolha.className = 'biMsg biMsgUser';
      bolha.firstChild.textContent = pergunta;
      chat.historico.push(
        { papel: 'user', texto: pergunta },
        { papel: 'assistant', texto: j.resposta, ferramentas: j.ferramentas || [], blocos: Array.isArray(j.blocos) ? j.blocos : [] }
      );
      // text and cards right away; the voice follows piece by piece
      var resposta = bolhaResposta(j.resposta, j.ferramentas, j.blocos, j.aviso_voz, j.tempos);
      lista.appendChild(resposta);
      if (Array.isArray(j.fala_partes) && j.fala_partes.length) { partes = j.fala_partes; linhaTempos = resposta.querySelector('.biTempos'); }
      else if (j.audio && typeof j.audio.base64 === 'string' && j.audio.base64) falando = tocarResposta(j.audio); // older backend
    }).catch(function (e) {
      pensando.remove();
      bolha.remove();
      lista.appendChild(bolhaErro((e && e.message) || String(e)));
    }).then(function () {
      setEnviando(false);
      if (!falando) setEstadoVoz('repouso');
      rolar();
      if (partes) falarEmPartes(partes, linhaTempos);
    });
  }

  function drawerAberto() {
    var drawer = document.getElementById('baiPanelDrawer');
    return !!drawer && !drawer.hidden;
  }

  function avisoFalhaVoz() { avisoVoz('Não consegui tocar a resposta em voz; ela está no texto.'); }

  // Older backend: the whole answer's audio arrives with the text.
  function tocarResposta(audio) {
    if (!drawerAberto()) return false; // closed while waiting: text only
    ligaPlayers();
    var ctx = audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(noop);
    var p = players()[0];
    var fim = function () { if (voz.estado === 'falando') setEstadoVoz('repouso'); };
    p.onended = fim;
    p.onerror = function () { if (voz.estado === 'falando') { fim(); avisoFalhaVoz(); } };
    p.biChave = null;
    p.src = 'data:' + (audio.mime || 'audio/mpeg') + ';base64,' + audio.base64;
    ajustaVelocidade(p);
    if (voz.orb) voz.orb.setAnalyser(voz.playerAnalyser);
    setEstadoVoz('falando');
    var r = p.play();
    if (r && r.catch) r.catch(function () { if (voz.estado === 'falando') { fim(); avisoFalhaVoz(); } });
    return true;
  }

  /* Voice in pieces (falar: "partes"): at most 2 { falar_texto } requests in flight, pieces play in
     order on alternating elements (the next one preloaded), a failed piece is skipped. One
     AbortController per answer: stop / new question / close cancels whatever is still pending. */
  var MAX_PEDIDOS_FALA = 2;
  var seqFala = 0;

  function falarEmPartes(partes, linha) {
    pararFala();
    partes = partes.filter(function (s) { return typeof s === 'string' && s.trim(); });
    if (!partes.length || !drawerAberto()) return;
    ligaPlayers();
    var ctx = audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(noop);
    var s = {
      id: ++seqFala, ctrl: typeof AbortController === 'function' ? new AbortController() : null,
      partes: partes, dados: [], prox: 0, emVoo: 0, atual: -1, tocando: null, avisou: false, fim: false,
      tTexto: performance.now(), tInicio: null, tFim: null, linha: linha
    };
    voz.sessao = s;
    for (var i = 0; i < MAX_PEDIDOS_FALA; i++) pedeParte(s);
  }

  function pedeParte(s) {
    if (s.fim || s.prox >= s.partes.length || s.emVoo >= MAX_PEDIDOS_FALA) return;
    var i = s.prox++;
    s.emVoo++;
    var t0 = performance.now();
    pedirFala(s.partes[i], s.ctrl ? s.ctrl.signal : undefined).then(function (r) {
      s.dados[i] = { ok: true, audio: r.audio, vozMs: r.vozMs, idaVoltaMs: performance.now() - t0 };
    }, function () {
      s.dados[i] = { ok: false, idaVoltaMs: performance.now() - t0 };
    }).then(function () {
      s.emVoo--;
      if (s.fim) return;
      if (i === 0) temposDaFala(s, false); // 1st piece diagnostics as soon as it arrives
      pedeParte(s);
      avancaFala(s);
    });
  }

  function falhouParte(s, i) {
    if (i === 0 && !s.avisou) { s.avisou = true; avisoFalhaVoz(); }
  }

  // Plays the next piece if it is ready; otherwise waits for it (called again when it arrives).
  function avancaFala(s) {
    if (s.fim) return;
    if (s.tocando) { preCarrega(s); return; }
    var i = s.atual + 1;
    while (i < s.partes.length && s.dados[i] && !s.dados[i].ok) { falhouParte(s, i); i++; }
    s.atual = i - 1;
    if (i >= s.partes.length) { terminaFala(s, false); return; }
    if (!s.dados[i]) return; // still being generated
    tocaParte(s, i);
  }

  function carregaParte(p, s, i) {
    var a = s.dados[i].audio;
    p.biChave = s.id + ':' + i;
    p.src = 'data:' + (a.mime || 'audio/mpeg') + ';base64,' + a.base64;
    ajustaVelocidade(p);
  }

  function preCarrega(s) {
    var j = s.atual + 1;
    var d = s.dados[j];
    if (!d || !d.ok) return;
    var p = players()[j % 2];
    if (p !== s.tocando && p.biChave !== s.id + ':' + j) carregaParte(p, s, j);
  }

  function tocaParte(s, i) {
    var p = players()[i % 2];
    if (p.biChave !== s.id + ':' + i) carregaParte(p, s, i);
    ajustaVelocidade(p);
    s.atual = i;
    s.tocando = p;
    var proximo = function () {
      if (voz.sessao !== s || s.tocando !== p) return;
      s.tocando = null;
      avancaFala(s);
    };
    p.onended = proximo;
    p.onerror = function () { falhouParte(s, i); proximo(); };
    if (voz.orb) voz.orb.setAnalyser(voz.playerAnalyser);
    if (voz.estado !== 'falando') setEstadoVoz('falando');
    var r = p.play();
    if (r && r.catch) r.catch(function () { falhouParte(s, i); proximo(); });
    if (s.tInicio == null) { s.tInicio = performance.now(); temposDaFala(s, false); }
    preCarrega(s);
  }

  function terminaFala(s, interrompida) {
    if (s.fim) return;
    s.fim = true;
    if (s.tInicio != null) s.tFim = performance.now();
    temposDaFala(s, interrompida);
    if (voz.sessao === s) voz.sessao = null;
    if (voz.estado === 'falando') setEstadoVoz('repouso');
  }

  // localhost timing line: "voz começou +X s" (text shown → first audio) and "fala total Y s" (first audio → end)
  function temposDaFala(s, interrompida) {
    if (!s.linha) return;
    var span = s.linha.querySelector('.biTemposVoz');
    if (!span) {
      span = el('span', 'biTemposVoz');
      span.title = 'voz começou: do texto na tela até o 1º áudio · 1º trecho: servidor = voz_ms da OpenAI no backend, ida e volta = pedido inteiro visto pelo navegador · fala total: do 1º áudio até o fim do último';
      s.linha.appendChild(span);
    }
    var partes = [];
    if (s.tInicio != null) partes.push('voz começou +' + seg(s.tInicio - s.tTexto) + ' s');
    // where the wait goes: OpenAI TTS on the server (voz_ms), request round trip, size of the 1st piece
    var p0 = s.dados[0];
    if (p0) {
      var d = ['1º trecho: ' + (p0.ok ? (p0.vozMs != null ? 'servidor ' + seg(p0.vozMs) + ' s' : 'servidor —') : 'falhou')];
      if (num(p0.idaVoltaMs) != null) d.push('ida e volta ' + seg(p0.idaVoltaMs) + ' s');
      d.push('tamanho ' + String(s.partes[0]).length + ' caracteres');
      partes.push(d.join(' · '));
    }
    if (s.tFim != null) partes.push('fala total ' + seg(s.tFim - s.tInicio) + ' s' + (interrompida ? ' (interrompida)' : ''));
    else if (s.fim) partes.push(interrompida ? 'voz interrompida' : 'sem voz');
    span.textContent = partes.length ? ' · ' + partes.join(' · ') : '';
  }

  function pararFala() {
    var s = voz.sessao;
    if (s) {
      if (s.ctrl) { try { s.ctrl.abort(); } catch (e) { /* ignore */ } }
      terminaFala(s, true);
    }
    if (voz.players) voz.players.forEach(function (p) { try { p.pause(); } catch (e) { /* ignore */ } });
    if (voz.estado === 'falando') setEstadoVoz('repouso');
  }

  // close / new conversation / logout: drop any recording, silence any answer
  function pararVoz() {
    if (voz.rec) pararGravacao(true);
    else soltaMicrofone();
    pararFala();
  }

  function montaVoz() {
    var canvas = document.getElementById('biVozCanvas');
    if (canvas && window.NX_BI_VOICE_ORB) voz.orb = window.NX_BI_VOICE_ORB.create(canvas);
    var motivo = motivoSemVoz();
    if (motivo) bloqueiaVoz(motivo, false, false);
    else observaPermissao();
    document.getElementById('biMic').addEventListener('click', clicarMic);
    document.getElementById('biVozCancelar').addEventListener('click', function () { pararGravacao(true); });
    document.getElementById('biVozParar').addEventListener('click', pararFala);
    document.addEventListener('keydown', atalhosGravacao, true);
    setEstadoVoz('repouso');
  }

  function desmontaVoz() {
    document.removeEventListener('keydown', atalhosGravacao, true);
    escondeDica();
    pararVoz();
    if (voz.orb) { voz.orb.destroy(); voz.orb = null; }
  }

  /* ============================================================
     OPEN / CLOSE
     ============================================================ */

  function openPanel() {
    var drawer = document.getElementById('baiPanelDrawer');
    var backdrop = document.getElementById('baiPanelBackdrop');
    var launcherBtn = document.getElementById('baiLauncherBtn');
    if (drawer) drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (launcherBtn) launcherBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('bai-panel-open');
    var input = document.getElementById('biInput');
    if (input) input.focus();
    rolar();
    mostraDicaPrimeiraVez();
  }

  function closePanel() {
    var drawer = document.getElementById('baiPanelDrawer');
    var backdrop = document.getElementById('baiPanelBackdrop');
    var launcherBtn = document.getElementById('baiLauncherBtn');
    if (drawer) drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (launcherBtn) { launcherBtn.setAttribute('aria-expanded', 'false'); launcherBtn.focus(); }
    document.body.classList.remove('bai-panel-open');
    pararVoz();
  }

  function togglePanel() {
    var drawer = document.getElementById('baiPanelDrawer');
    if (drawer && !drawer.hidden) closePanel();
    else openPanel();
  }

  /* ============================================================
     DOM BUILD / VISIBILITY LIFECYCLE
     ============================================================ */

  function launcherHtml() {
    return '<button type="button" class="baiLauncherBtn" id="baiLauncherBtn" aria-expanded="false" aria-controls="baiPanelDrawer" aria-label="Abrir Brabus Intelligence">' +
      '<span class="baiLauncherCore" aria-hidden="true">' +
        '<span class="baiLauncherOrbit"></span>' +
        '<span class="baiLauncherRing"></span>' +
        '<span class="baiLauncherNucleus"></span>' +
      '</span>' +
      '<span class="baiLauncherLabel" aria-hidden="true">Brabus Intelligence</span>' +
      '</button>' +
      '<div class="baiPanelBackdrop" id="baiPanelBackdrop" hidden></div>';
  }

  // Static markup only — every dynamic string goes through textContent.
  function panelHtml() {
    return '<aside class="baiPanelDrawer baiWorkspaceShell" id="baiPanelDrawer" role="dialog" aria-modal="true" aria-label="Brabus Intelligence" hidden>' +
      '<div class="baiPanelAmbient" aria-hidden="true"></div>' +
      '<div class="baiPanelHeader">' +
      '<div><h2 class="baiPanelTitle">Brabus Intelligence</h2></div>' +
      '<div class="baiPanelHeaderActions">' +
      '<button type="button" class="modBtn modBtnSecondary modBtnSm" id="biNova">' + esc('Nova conversa') + '</button>' +
      '<button type="button" class="baiPanelCloseBtn" id="baiPanelCloseBtn" aria-label="Fechar Brabus Intelligence">&times;</button>' +
      '</div></div>' +
      '<div class="baiPanelBody" id="baiPanelBody">' +
      '<div class="biLista" id="biLista" role="log" aria-live="polite"></div>' +
      '</div>' +
      // Voice Orb stage: visible while listening / thinking / speaking
      '<div class="biVoz" id="biVoz" data-estado="repouso" hidden>' +
      '<div class="biVozOrb"><canvas class="biVozCanvas" id="biVozCanvas" aria-hidden="true"></canvas></div>' +
      '<p class="biVozStatus" aria-hidden="true"><span id="biVozStatus"></span><span class="biVozTempo" id="biVozTempo"></span></p>' +
      '<button type="button" class="biVozAcao biVozCancelar" id="biVozCancelar" aria-label="' + esc('Cancelar gravação sem enviar') + '" title="Cancelar" hidden>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<button type="button" class="biVozAcao biVozParar" id="biVozParar" aria-label="' + esc('Interromper a fala') + '" title="Parar fala" hidden>' +
      '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg></button>' +
      '</div>' +
      '<p class="biSrOnly" id="biVozEstado" role="status" aria-live="polite"></p>' +
      '<p class="biVozAviso" id="biVozAviso" role="status" aria-live="polite" hidden></p>' +
      '<form class="baiPanelComposer biForm" id="biForm" novalidate>' +
      '<textarea class="biInput" id="biInput" rows="2" placeholder="' + esc('Pergunte sobre planos, parcelas, resultados…') + '" aria-label="Pergunta"></textarea>' +
      // Voice Orb button (recovered markup: e7ce3d5^ voiceButtonHtml)
      '<span class="biMicDica" id="biMicDica" role="status" hidden>' + esc(DICA_MIC) + '</span>' +
      '<button type="button" class="modBtn baiVoiceBtn biMic" id="biMic" aria-pressed="false" aria-disabled="false" aria-label="Perguntar por voz" title="' + esc(DICA_MIC) + '">' +
      '<span class="baiVoiceOrbCore" aria-hidden="true"><span class="baiVoiceOrbArc"></span><span class="baiVoiceOrbRing"></span></span>' +
      '<span class="biMicIconeEnviar" aria-hidden="true">' + SVG_ENVIAR + '</span>' +
      '<svg class="baiVoiceBtnMark biMicIconeMic" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">' +
      '<rect x="9.4" y="2.6" width="5.2" height="10" rx="2.6" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M5.6 11v.9a6.4 6.4 0 0 0 12.8 0V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="12" y1="18.3" x2="12" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="8.8" y1="21" x2="15.2" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>' +
      '</button>' +
      '<button type="submit" class="modBtn modBtnPrimary biEnviar" id="biEnviar">Enviar</button>' +
      '</form>' +
      '<p class="biAviso">' + esc('Os valores vêm dos simuladores e das bases do Portal. Confirme as condições com o banco antes de fechar.') + '</p>' +
      '</aside>';
  }

  var panelBuilt = false;
  var escListener = false;

  function buildPanelDom() {
    if (panelBuilt) return;
    var root = document.getElementById('nxOverlayRoot');
    if (!root) return;
    var wrap = document.createElement('div');
    wrap.className = 'baiLauncherRoot';
    wrap.id = 'baiLauncherRoot';
    wrap.innerHTML = launcherHtml() + panelHtml();
    root.appendChild(wrap);

    document.getElementById('baiPanelCloseBtn').addEventListener('click', closePanel);
    document.getElementById('baiPanelBackdrop').addEventListener('click', closePanel);
    document.getElementById('baiLauncherBtn').addEventListener('click', togglePanel);
    document.getElementById('biNova').addEventListener('click', novaConversa);
    document.getElementById('biForm').addEventListener('submit', function (e) {
      e.preventDefault();
      enviar(document.getElementById('biInput').value);
    });
    document.getElementById('biInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(e.target.value); }
    });
    if (!escListener) {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var drawer = document.getElementById('baiPanelDrawer');
          if (drawer && !drawer.hidden) closePanel();
        }
      });
      escListener = true;
    }

    montaVoz();
    panelBuilt = true;
    renderConversa();
  }

  function refreshVisibility() {
    var visible = isVisibleNow();
    var existing = document.getElementById('baiLauncherRoot');
    if (visible) {
      if (!existing) buildPanelDom();
    } else if (existing) {
      desmontaVoz();
      existing.parentNode.removeChild(existing);
      panelBuilt = false;
      document.body.classList.remove('bai-panel-open');
      // Logout / lost authorization: never carry one user's conversation into the next session.
      resetChat();
    }
  }

  // Session guard: a question in progress, a voice recording or an answer being spoken
  // (or its pieces still loading) counts as use for the 30-min inactivity rule.
  if (window.NX_SESSION_GUARD) {
    window.NX_SESSION_GUARD.registrarOcupado(function () {
      return chat.enviando || voz.estado !== 'repouso' || !!voz.rec || !!voz.sessao;
    });
  }

  window.NX_INTELLIGENCE_PANEL = {
    mount: function () {
      if (window.NX_AUTH_CORE) window.NX_AUTH_CORE.onStateChange(function () { refreshVisibility(); });
      refreshVisibility();
    },
    // exposed for tests
    isVisibleNow: isVisibleNow,
    openPanel: function () { openPanel(); },
    closePanel: function () { closePanel(); },
    refresh: function () { refreshVisibility(); },
    _markdown: markdown
  };
})();
