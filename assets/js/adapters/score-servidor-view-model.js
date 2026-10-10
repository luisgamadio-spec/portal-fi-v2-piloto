/* PORTAL-NEXT V2 -- Score calculado no SERVIDOR (operational_score_vendedores, 09/10/2026).

   Converte as linhas do servidor no MESMO formato que calcScores()
   (score.adapter.js) entrega à tela -- {vendedor, loja, dept, vendas, fin,
   share, score, scoreBreakdown[{label, points, max, pct, detail, amostra}]} --
   para score.js desenhar exatamente como hoje. Os textos de detalhe são os
   mesmos de calcScores(). O servidor nunca manda valores em R$; o % de
   retorno médio só chega para os perfis autorizados (MASTER, DIRETOR,
   GERENTE, ANALISTA) -- para os demais o item mostra só os pontos. */
(function () {
  'use strict';

  function fmt() {
    var I = (window.NX_SCORE_ADAPTER && window.NX_SCORE_ADAPTER._internal) || {};
    return {
      num: I.num || function (v) { return String(v || 0); },
      pct: I.pct || function (v) { return (Number(v) * 100).toFixed(1).replace('.', ',') + '%'; }
    };
  }
  var DEPT = { NOVOS: 'Novos', SEMINOVOS: 'Seminovos', Novos: 'Novos', Seminovos: 'Seminovos' };

  function detalhe(c, row, F) {
    var vendas = Number(row.vendas) || 0, fin = Number(row.financiados) || 0;
    switch (c.item) {
      case 'Volume de vendas': return { detail: F.num(vendas) + ' venda(s) · referência ' + F.num(Number(c.referencia) || 1) };
      case 'Penetração de financiamento':
        return { detail: F.num(fin) + ' financiado(s) / ' + F.num(vendas) + ' venda(s) (' + F.pct(Number(row.share) || 0) + ')', amostra: F.num(vendas) + '/4 vendas' };
      case 'Mix de famílias vendidas': return { detail: F.num(Number(c.familias) || 0) + ' de 3 famílias' };
      case 'Mix de planos (diversidade)': return { detail: F.num(Number(c.planos) || 0) + ' de 4 planos comerciais' };
      case 'SPF EXTRA': return { detail: F.num(Number(row.spf_qtd) || 0) + ' SPF / ' + F.num(fin) + ' financiamento(s)', amostra: F.num(fin) + '/2 financiamentos' };
      case 'Retorno médio':
        return { detail: row.retorno_medio_pct != null ? F.pct(Number(row.retorno_medio_pct) / 100) : 'pontuação por faixa de retorno', amostra: F.num(fin) + '/2 financiamentos' };
      default: return { detail: '' };
    }
  }

  // Ordem de chegada de cada vendedor|loja|departamento no dado bruto (vendas, depois financiamentos) --
  // a mesma que calcScores() usa para desempatar (sort estável), para a tela ficar idêntica.
  function ordemDeChegada(raw) {
    var ordem = {}, n = 0;
    function marca(x) {
      var k = (x.seller || '') + '|' + (x.store || '') + '|' + (DEPT[String(x.department || '').toUpperCase()] || '');
      if (!(k in ordem)) ordem[k] = n++;
    }
    ((raw && raw.sales) || []).forEach(marca); ((raw && raw.finance) || []).forEach(marca);
    return ordem;
  }
  function mapRows(payload, raw) {
    if (!payload || !Array.isArray(payload.rows)) {
      var err = new Error('Resposta inesperada do Score.'); err.state = 'MALFORMED_RESPONSE'; throw err;
    }
    var F = fmt();
    var ordem = ordemDeChegada(raw);
    var pos = function (o) { var k = o.vendedor + '|' + o.loja + '|' + o.dept; return k in ordem ? ordem[k] : 1e9; };
    return payload.rows.map(function (r) {
      var dept = DEPT[r.departamento];
      if (!dept) { var e = new Error('Departamento inesperado no Score: ' + JSON.stringify(r.departamento)); e.state = 'MALFORMED_RESPONSE'; throw e; }
      return {
        vendedor: r.vendedor || '', loja: r.loja || '', dept: dept,
        vendas: Number(r.vendas) || 0, fin: Number(r.financiados) || 0, share: Number(r.share) || 0,
        score: Number(r.score), planoMais: r.plano_mais_vendido || '—',
        scoreBreakdown: (r.composicao || []).map(function (c) {
          var d = detalhe(c, r, F);
          var max = Number(c.maximo) || 0, pts = Number(c.pontos) || 0;
          return { label: c.item, points: pts, max: max, pct: max ? pts / max : 0, detail: d.detail, amostra: d.amostra };
        })
      };
    }).sort(function (a, b) { return (b.score - a.score) || (b.fin - a.fin) || (pos(a) - pos(b)); });
  }

  window.NX_SCORE_SERVIDOR_VM = { mapRows: mapRows };
})();
