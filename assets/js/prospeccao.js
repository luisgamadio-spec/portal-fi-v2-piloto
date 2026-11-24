/* PORTAL-NEXT V2 — Prospecção: clientes com financiamento terminando (23/11/2026, pedido do Luis; layout de UX refeito).
   Pergunta da tela: "quem eu procuro agora?" (todos) e "o que falta distribuir?" (gerente/analista/Master).
   O tempo é a navegação principal (5 faixas; abre em "Até 30 dias"); loja, vendedor e busca são filtros.
   Chave NOVOS | SEMINOVOS (ajuste de 23/11): filtra lista, faixas, aviso e exportação; abre no departamento do usuário
   (quem vê os dois abre em Novos); quem tem um só não vê a chave. Vendas Direta conta como Novos (no banco).
   Vendedor da venda: o nome das bases de vendas aparece mesmo quando a pessoa não é (ou nunca foi) usuária do Portal,
   com a marca "vendedor saiu"; "a distribuir" = sem nome OU vendedor saiu.

   Acesso e recorte: SEMPRE no banco (prospeccao_painel / _detalhes / _revelar_documento / _atribuir / _dividir /
   _nao_contatar / _exportar / _vendedores_atribuiveis). Vendedor: só os contratos dele, sem "não contatar".
   Gerente: lojas e departamento dele. Analista: lojas pela vigência. Master: tudo. Financeiro e RH: negados.
   LGPD: a lista não mostra CPF/CNPJ; o documento (mascarado) e "Revelar" ficam no detalhe, e cada revelação é registrada.
   "Não contatar" e atribuição ficam no detalhe (nada de link vermelho em toda linha). Vermelho = ação principal e urgência. */
(function () {
  'use strict';

  var FAIXAS = [
    { v: 'FINALIZOU_30', label: 'Encerrou · últimos 30 dias', curto: 'Encerrou', dica: 'últimos 30 dias', urg: 'alta' },
    { v: 'PROX_30', label: 'Até 30 dias', curto: '30 dias', dica: 'termina em até 30 dias', urg: 'alta' },
    { v: 'D31_90', label: '31 a 90 dias', curto: '90 dias', dica: 'de 31 a 90 dias', urg: 'media' },
    { v: 'D91_180', label: '3 a 6 meses', curto: '6 meses', dica: 'de 91 a 180 dias', urg: '' },
    { v: 'D181_365', label: '6 a 12 meses', curto: '12 meses', dica: 'de 181 a 365 dias', urg: '' }
  ];
  var DEPS = [{ v: 'NOVOS', label: 'Novos' }, { v: 'SEMINOVOS', label: 'Seminovos' }];
  var TIPO_LABEL = { NOVOS_LINEAR: 'Novos Linear', NOVOS_BALAO: 'Novos Balão', SEMINOVOS_LINEAR: 'Seminovos Linear', SEMINOVOS_BALAO: 'Seminovos Balão' };
  var POR_PAGINA = 50;
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  var outletRef = null, S = null, buscaTimer = null;

  // ---------------------------------------------------------------- servidor
  function rpc(nome, corpo) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) return Promise.reject({ state: 'BACKEND_ERROR', message: 'Configuração real ausente neste ambiente.' });
    if (!window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão indisponível.' });
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + nome, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(corpo || {})
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (b) {
          if (resp.ok) return b;
          var code = b && b.code;
          if (resp.status === 401) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada. Entre de novo.' });
          if (code === '42501' || resp.status === 403) return Promise.reject({ state: 'PERMISSION_DENIED', message: (b && b.message) || 'Acesso negado.' });
          if (code === '22023') return Promise.reject({ state: 'VALIDATION', message: b.message });
          return Promise.reject({ state: 'BACKEND_ERROR', message: 'Não foi possível concluir agora. Tente novamente.' });
        });
      });
    });
  }

  // ---------------------------------------------------------------- formatos
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function brl(v) { return v == null || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function brl0(v) { return v == null || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function dt(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function mesAno(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return MESES[Number(p[1]) - 1] + '/' + p[0]; }
  function loja(code) {
    if (!code) return '—';
    if (code === 'SUZUKI GASTAO') return 'Suzuki Gastão';   // loja própria da Prospecção (não está no cadastro de lojas do Portal)
    return window.NX_STORE_DISPLAY ? window.NX_STORE_DISPLAY.storeDisplayName(code) : code;
  }
  // nome de pessoa só para EXIBIÇÃO: "AGATHA RODRIGUES" → "Agatha Rodrigues"; da/de/do/das/dos/e em minúsculas.
  // Mantém os acentos que vierem (o nome do cadastro do Portal já vem com a grafia certa). O banco não muda.
  var PARTICULAS = { da: 1, de: 1, do: 1, das: 1, dos: 1, e: 1 };
  function nomeP(n) {
    if (!n) return n;
    return String(n).trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR').split(' ').map(function (w, i) {
      if (i > 0 && PARTICULAS[w]) return w;
      return w.split('-').map(function (x) { return x.charAt(0).toLocaleUpperCase('pt-BR') + x.slice(1); }).join('-');
    }).join(' ');
  }
  function parseISO(iso) { var p = String(iso).slice(0, 10).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function addMeses(d, n) { var x = new Date(d.getFullYear(), d.getMonth() + n, 1); var ult = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(d.getDate(), ult)); return x; }
  function hoje() { var h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); }

  // parcelas já vencidas: 1ª vence 1 mês depois do contrato; a k-ésima, k meses depois
  function andamento(r) {
    var base = parseISO(r.data_contrato), n = Number(r.parcelas) || 0, h = hoje(), pagas = 0;
    for (var k = 1; k <= n; k++) { if (addMeses(base, k) <= h) pagas++; else break; }
    var balao = r.tipo && r.tipo.indexOf('BALAO') >= 0;
    var faltam = n - pagas, dias = Math.round((parseISO(r.data_fim) - h) / 86400000);
    var txt;
    if (dias < 0) txt = 'encerrou há ' + num(-dias) + (-dias === 1 ? ' dia' : ' dias');
    else if (faltam <= 0) txt = balao ? 'falta a parcela final' : 'termina este mês';
    else txt = (faltam === 1 ? 'falta 1 parcela' : 'faltam ' + num(faltam) + ' parcelas') + (balao ? ' + parcela final' : '');
    return { pagas: pagas, total: n, faltam: faltam, texto: txt, pct: n ? Math.round(100 * pagas / n) : 0 };
  }

  function gestor() { return S.dados && S.dados.perfil !== 'VENDEDOR'; }
  function plural(n, um, varios) { return num(n) + ' ' + (Number(n) === 1 ? um : varios); }

  // ---------------------------------------------------------------- carga
  function params(desloc) {
    var f = S.filtros;
    return { p_tipo: null, p_faixa: f.faixa, p_loja: f.loja || null, p_banco: null, p_vendedor: f.vendedor || null,
             p_limite: POR_PAGINA, p_deslocamento: desloc || 0, p_abrir: !S.abriuTela, p_busca: f.busca || null, p_ocultar_novo: !!f.ocultarNovo,
             p_departamento: f.departamento || 'PADRAO' };   // 'PADRAO' = o banco escolhe o departamento do usuário
  }
  function carregar() {
    S.carregando = true; S.erro = null; render();
    return rpc('prospeccao_painel', params(0)).then(function (d) {
      S.abriuTela = true; S.dados = d; S.lista = (d && d.lista) || []; S.carregando = false;
      if (d && d.departamento) S.filtros.departamento = d.departamento;
      S.aberto = null; S.det = {}; S.sel = {};
      render();
    }).catch(function (e) {
      S.carregando = false;
      S.erro = e && e.state === 'PERMISSION_DENIED' ? 'Seu perfil não tem acesso à Prospecção.' : ((e && e.message) || 'Não foi possível carregar agora.');
      render();
    });
  }
  function carregarMais() {
    if (S.carregandoMais) return;
    S.carregandoMais = true; render();
    rpc('prospeccao_painel', params(S.lista.length)).then(function (d) {
      S.lista = S.lista.concat((d && d.lista) || []); S.carregandoMais = false; render();
    }).catch(function (e) { S.carregandoMais = false; S.msg = (e && e.message) || 'Não foi possível carregar mais.'; render(); });
  }

  // ---------------------------------------------------------------- pedaços da tela
  function contagem(faixa) {
    var r = S.dados && S.dados.resumo; if (!r) return 0;
    var bloco = r.TODOS || {};
    return Number(bloco[faixa] || 0);
  }
  function topoHtml() {
    var titulo = S.dados && S.dados.perfil === 'VENDEDOR' ? 'Meus clientes com financiamento terminando' : 'Prospecção · Financiamentos terminando';
    return '<header class="pspTopo"><div><h1 class="pspTitulo">' + titulo + '</h1>' +
      '<p class="pspSub">Contratos pagos de financiamento F&amp;I, por data de término.</p></div>' +
      (S.dados && S.dados.pode_exportar ? '<button type="button" class="modBtn modBtnSecondary pspExportar" data-acao="exportar"' + (S.exportando ? ' disabled' : '') + '>' + (S.exportando ? 'Exportando…' : 'Exportar') + '</button>' : '') +
      '</header>';
  }
  function faixasHtml() {
    var h = '<nav class="pspFaixas" aria-label="Faixas de término">';
    FAIXAS.forEach(function (f) {
      var on = S.filtros.faixa === f.v, zero = !contagem(f.v);
      h += '<button type="button" class="pspFaixa' + (on ? ' isOn' : '') + (f.urg && !zero ? ' urg-' + f.urg : '') + (zero ? ' isZero' : '') + '" data-acao="faixa" data-v="' + f.v + '" aria-pressed="' + on + '" title="' + esc(f.dica) + '">' +
        '<span class="pspFaixaN">' + num(contagem(f.v)) + '</span><span class="pspFaixaR"><span class="pspLongo">' + f.label + '</span><span class="pspCurto">' + f.curto + '</span></span></button>';
    });
    return h + '</nav>';
  }
  function avisoDistribuirHtml() {
    if (!gestor() || !S.dados.sem_vendedor) return '';
    var x = S.dados.sem_vendedor[S.filtros.faixa]; if (!x || !x.sem) return '';
    var um = Number(x.sem) === 1;
    return '<div class="pspAviso" role="status"><p><b>' + num(x.sem) + ' de ' + num(x.total) + '</b> ' + (Number(x.total) === 1 ? 'contrato desta faixa' : 'contratos desta faixa') +
      (um ? ' está' : ' estão') + ' a distribuir (sem vendedor ou com vendedor que saiu). Ninguém da equipe ' + (um ? 'o vê enquanto não for atribuído' : 'os vê enquanto não forem atribuídos') + '.</p>' +
      '<div class="pspAvisoAcoes"><button type="button" class="modBtn modBtnSecondary" data-acao="so-sem">' + (S.filtros.vendedor === 'A_DISTRIBUIR' ? 'Ver todos' : 'Ver só os a distribuir') + '</button>' +
      '<button type="button" class="modBtn modBtnPrimary" data-acao="dividir">Dividir entre a equipe</button></div></div>';
  }
  function filtrosHtml() {
    var f = S.filtros, d = S.dados || {}, fl = d.filtros || {};
    var deps = d.departamentos || [], h = '<div class="pspFiltros">';
    if (deps.length > 1) {
      h += '<div class="pspChave" role="group" aria-label="Departamento">';
      DEPS.forEach(function (x) { var on = f.departamento === x.v; h += '<button type="button" class="pspChaveOp' + (on ? ' isOn' : '') + '" data-acao="dep" data-v="' + x.v + '" aria-pressed="' + on + '">' + x.label + '</button>'; });
      h += '</div>';
    }
    h += '<div class="pspCampos"><input type="search" class="pspBusca" data-campo="busca" placeholder="Buscar cliente pelo nome" value="' + esc(f.busca) + '" aria-label="Buscar cliente pelo nome">';
    if (gestor()) {
      h += '<select data-campo="loja" aria-label="Loja"><option value="">Todas as lojas</option>' +
        (fl.lojas || []).map(function (l) { return '<option value="' + esc(l) + '"' + (f.loja === l ? ' selected' : '') + '>' + esc(loja(l)) + '</option>'; }).join('') + '</select>';
      h += '<select data-campo="vendedor" aria-label="Vendedor"><option value="">Todos os vendedores</option>' +
        '<option value="A_DISTRIBUIR"' + (f.vendedor === 'A_DISTRIBUIR' ? ' selected' : '') + '>A distribuir (sem vendedor ou saiu)</option>' +
        '<option value="SEM_VENDEDOR"' + (f.vendedor === 'SEM_VENDEDOR' ? ' selected' : '') + '>· só sem vendedor</option>' +
        '<option value="VENDEDOR_SAIU"' + (f.vendedor === 'VENDEDOR_SAIU' ? ' selected' : '') + '>· só vendedor saiu</option>' +
        (fl.vendedores || []).slice().sort(function (a, b) { return nomeP(a.nome).localeCompare(nomeP(b.nome), 'pt-BR'); }).map(function (v) { return '<option value="' + esc(v.id) + '"' + (f.vendedor === v.id ? ' selected' : '') + '>' + esc(nomeP(v.nome)) + '</option>'; }).join('') + '</select>';
    }
    h += '<label class="pspCheck"><input type="checkbox" data-campo="ocultarNovo"' + (f.ocultarNovo ? ' checked' : '') + '> Ocultar quem já fez novo contrato</label></div></div>';
    return h;
  }
  function etiquetas(r) {
    return (r.proprio && gestor() ? '<span class="pspTag ok">seu cliente</span>' : '') + (r.pj ? '<span class="pspTag">PJ</span>' : '') + (r.ja_fez_novo ? '<span class="pspTag amb">já fez novo contrato</span>' : '') +
      (r.nao_contatar ? '<span class="pspTag red">não contatar</span>' : '');
  }
  function vendedorHtml(r) {
    if (!r.vendedor) return '<span class="pspSemVend">Sem vendedor</span>';
    if (r.vendedor_saiu) return '<div class="pspNome2">' + esc(nomeP(r.vendedor)) + '</div><span class="pspTag amb">vendedor saiu</span>';
    var origem = r.vendedor_origem !== 'ATRIBUICAO' ? 'da venda original'
      : (r.vendedor_original ? 'venda original: ' + esc(nomeP(r.vendedor_original)) : 'atribuído' + (r.atribuido_por ? ' por ' + esc(primeiro(r.atribuido_por)) : ''));
    return '<div class="pspNome2">' + esc(nomeP(r.vendedor)) + '</div><div class="pspMini">' + origem + '</div>';
  }
  function primeiro(n) { return String(n || '').split(' ')[0].replace(/^./, function (c) { return c.toUpperCase(); }).replace(/^(.)(.*)$/, function (m, a, b) { return a + b.toLowerCase(); }); }
  function parcelaFinal(r) {
    if (!(r.tipo && r.tipo.indexOf('BALAO') >= 0) || r.balao_valor == null) return '<span class="pspTraco">—</span>';
    return '<div class="pspOuro">' + brl0(r.balao_valor) + '</div><div class="pspMini">' + dt(r.balao_data) + '</div>';
  }
  function linhaHtml(r, i) {
    var a = andamento(r), aberto = S.aberto === r.op_codigo, g = gestor();
    var sub = esc(loja(r.loja)) + ' · ' + esc(TIPO_LABEL[r.tipo] || r.tipo) + ' · ' + esc(r.banco || '—');
    var h = '<tr class="pspLinha' + (aberto ? ' isAberta' : '') + (S.sel[r.op_codigo] ? ' isSel' : '') + '" tabindex="0" role="button" aria-expanded="' + aberto + '" data-acao="abrir" data-op="' + esc(r.op_codigo) + '">';
    if (g) h += '<td class="pspSelCol" data-parar="1"><input type="checkbox" class="pspSel" data-acao="sel" data-op="' + esc(r.op_codigo) + '"' + (S.sel[r.op_codigo] ? ' checked' : '') + ' aria-label="Selecionar ' + esc(r.cliente) + '"></td>';
    h += '<td><div class="pspNome">' + esc(r.cliente || 'Cliente sem nome') + '</div><div class="pspMini">' + sub + '</div>' + (etiquetas(r) ? '<div class="pspTags">' + etiquetas(r) + '</div>' : '') + '</td>' +
      '<td class="pspNum"><div class="pspData">' + dt(r.data_fim) + '</div><div class="pspMini">' + esc(a.texto) + '</div></td>' +
      '<td class="pspNum"><div class="pspValor">' + brl(r.valor_parcela) + '</div><div class="pspMini">' + num(r.parcelas) + ' parcelas</div></td>' +
      '<td class="pspNum">' + parcelaFinal(r) + '</td>' +
      (g ? '<td>' + vendedorHtml(r) + '</td>' : '') +
      '<td class="pspSeta" aria-hidden="true">' + (aberto ? '▴' : '▾') + '</td></tr>';
    if (aberto) h += '<tr class="pspDetLinha"><td colspan="' + (g ? 7 : 5) + '">' + detalheHtml(r) + '</td></tr>';
    return h;
  }
  function cartaoHtml(r) {
    var a = andamento(r), aberto = S.aberto === r.op_codigo, g = gestor(), balao = r.tipo && r.tipo.indexOf('BALAO') >= 0;
    var h = '<article class="pspCartao' + (aberto ? ' isAberta' : '') + (S.sel[r.op_codigo] ? ' isSel' : '') + '">' +
      '<div class="pspCartaoTopo">' + (g ? '<input type="checkbox" class="pspSel" data-acao="sel" data-op="' + esc(r.op_codigo) + '"' + (S.sel[r.op_codigo] ? ' checked' : '') + ' aria-label="Selecionar ' + esc(r.cliente) + '">' : '') +
      '<button type="button" class="pspCartaoAbre" data-acao="abrir" data-op="' + esc(r.op_codigo) + '" aria-expanded="' + aberto + '">' +
      '<span class="pspCartaoL1"><span class="pspNome">' + esc(r.cliente || 'Cliente sem nome') + '</span><span class="pspData">' + dt(r.data_fim) + '</span></span>' +
      '<span class="pspMini">' + esc(loja(r.loja)) + ' · ' + esc(TIPO_LABEL[r.tipo] || r.tipo) + ' · ' + esc(a.texto) + '</span>' +
      '<span class="pspCartaoL2">Paga <b class="pspValor">' + brl(r.valor_parcela) + '</b>/mês' + (balao && r.balao_valor != null ? ' · final <b class="pspOuro">' + brl0(r.balao_valor) + '</b>' : '') + '</span>' +
      (g ? '<span class="pspCartaoVend">' + vendedorHtml(r) + '</span>' : '') +
      (etiquetas(r) ? '<span class="pspTags">' + etiquetas(r) + '</span>' : '') + '</button></div>';
    if (aberto) h += detalheHtml(r);
    return h + '</article>';
  }
  // carro curto para a frase: família + 1ª palavra do modelo ("ECLIPSE CROSS HPE-S")
  function carroCurto(ve) {
    if (!ve || !ve.carro) return '';
    var fam = ve.familia || '', resto = fam && ve.carro.indexOf(fam) === 0 ? ve.carro.slice(fam.length).trim() : '';
    return fam ? (fam + (resto ? ' ' + resto.split(/\s+/)[0] : '')) : ve.carro;
  }
  function fraseAbordagem(r, d) {
    var fin = d && d.financiamento || {}, ve = d && d.veiculo, v = d && d.venda, balao = r.tipo && r.tipo.indexOf('BALAO') >= 0, p = [];
    if (ve && ve.carro) {
      var quando = (v && v.data_venda) || r.data_contrato;
      p.push('Comprou um ' + esc(carroCurto(ve)) + ' em ' + mesAno(quando) + (ve.valor != null ? ' por ' + brl0(ve.valor) : '') +
        (ve.entrada != null ? ', com ' + (ve.entrada_aproximada ? 'cerca de ' : '') + brl0(ve.entrada) + ' de entrada' : '') + '.');
    } else {
      p.push('Financiou ' + (fin.valor_financiado != null ? brl0(fin.valor_financiado) : 'o carro') + ' em ' + mesAno(r.data_contrato) + (r.banco ? ' pelo ' + esc(r.banco) : '') + '.');
    }
    p.push('Paga ' + num(r.parcelas) + '× ' + brl0(r.valor_parcela) + (balao && r.balao_valor != null ? ' e tem parcela final de ' + brl0(r.balao_valor) + ' em ' + dt(r.balao_data) : '') + '.');
    p.push('Termina em ' + dt(r.data_fim) + '.');
    return p.join(' ');
  }
  function detalheHtml(r) {
    var d = S.det[r.op_codigo], a = andamento(r), g = gestor();
    if (!d) return '<div class="pspDet"><div class="modLoadingState">Carregando detalhes…</div></div>';
    if (d.erro) return '<div class="pspDet"><div class="modErrorState">' + esc(d.erro) + '</div></div>';
    var fin = d.dados.financiamento || {}, v = d.dados.venda, ve = d.dados.veiculo, balao = r.tipo && r.tipo.indexOf('BALAO') >= 0;
    var tarifas = fin.valor_financiado_fonte === 'COM_TARIFAS' ? ' <span class="pspTag" title="Sem o valor líquido da venda: valor da Base 03, com tarifas embutidas">com tarifas</span>' : '';
    var h = '<div class="pspDet" role="region" aria-label="Detalhes de ' + esc(r.cliente) + '">' +
      '<p class="pspFrase">' + fraseAbordagem(r, d.dados) + '</p>' +
      '<div class="pspAndamento"><div class="pspBarra" role="progressbar" aria-valuemin="0" aria-valuemax="' + a.total + '" aria-valuenow="' + a.pagas + '"><span style="width:' + a.pct + '%"></span></div>' +
      '<span class="pspMini">' + num(a.pagas) + ' de ' + num(a.total) + ' parcelas' + (balao ? ' + parcela final' : '') + '</span></div>' +
      '<div class="pspBlocos"><section><h4>Financiamento</h4><dl>' +
      '<dt>Valor financiado</dt><dd>' + brl(fin.valor_financiado) + tarifas + '</dd>' +
      '<dt>Prazo e parcela</dt><dd>' + num(fin.prazo) + '× ' + brl(fin.valor_parcela) + '</dd>' +
      '<dt>Banco</dt><dd>' + esc(fin.banco || '—') + '</dd>' +
      '<dt>Contrato</dt><dd>' + dt(fin.data_contrato) + (fin.data_contrato_estimada ? ' <span class="pspTag" title="A carga diária não traz a data do contrato: usamos a data de inclusão">estimada</span>' : '') + '</dd>' +
      '<dt>Fim</dt><dd>' + dt(fin.data_fim) + '</dd>' +
      (balao ? '<dt>Parcela final</dt><dd class="pspOuro">' + brl(fin.balao_valor) + ' em ' + dt(fin.balao_data) + '</dd>' : '') +
      '</dl></section><section><h4>Veículo</h4>' +
      (ve ? '<dl><dt>Carro</dt><dd>' + esc(ve.carro || '—') + '</dd><dt>Valor do veículo</dt><dd>' + brl(ve.valor) + (v && v.data_venda ? ' <span class="pspMini">venda em ' + dt(v.data_venda) + '</span>' : '') + '</dd>' +
            (ve.entrada != null ? '<dt>Entrada</dt><dd>' + brl(ve.entrada) + (ve.entrada_aproximada ? ' <span class="pspTag" title="Valor do veículo menos o financiado da Base 03, que inclui tarifas e às vezes acessórios">aproximada</span>' : '') + '</dd>' : '') +
            (g && r.ligacao ? '<dt>Ligação</dt><dd>' + (r.ligacao === 'FANDI' ? 'pelo vendedor informado no FANDI' : 'pelo ' + (r.ligacao === 'DOCUMENTO' ? 'documento' : 'nome') + ' do cliente') + '</dd>' : '') + '</dl>'
         : '<p class="pspVazio">Dados do veículo não disponíveis para este contrato.</p>') +
      '</section></div>' +
      '<footer class="pspDetRodape"><div class="pspDoc">' +
      (d.revelado ? '<span class="pspDocTxt">' + esc(d.revelado) + '</span> <span class="pspMini">consulta registrada</span>'
        : (r.pode_revelar ? '<span class="pspDocTxt">' + esc(r.documento || '') + '</span> <button type="button" class="modBtn modBtnSecondary modBtnSm" data-acao="revelar" data-op="' + esc(r.op_codigo) + '">Revelar ' + (r.pj ? 'CNPJ' : 'CPF/CNPJ') + '</button>'
           : '<span class="pspMini">Documento não disponível para este contrato.</span>')) + '</div>';
    if (g) {
      h += '<div class="pspDetAcoes">';
      h += '<label class="pspAtribuir"><span>' + (r.vendedor_id ? 'Trocar vendedor' : 'Atribuir a') + '</span><select data-campo="atribuirUm" data-op="' + esc(r.op_codigo) + '"><option value="">' +
        (d.vendedores ? 'Escolha…' : 'Carregando…') + '</option>' + (d.vendedores || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(nomeP(x.nome)) + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="modBtn modBtnPrimary modBtnSm" data-acao="atribuir-um" data-op="' + esc(r.op_codigo) + '">' + (r.vendedor_id ? 'Trocar' : 'Atribuir') + '</button>';
      if (r.vendedor_origem === 'ATRIBUICAO') h += '<button type="button" class="modBtn modBtnSecondary modBtnSm" data-acao="tirar-um" data-op="' + esc(r.op_codigo) + '">Tirar atribuição</button>';
      if (S.dados.pode_nao_contatar) h += '<button type="button" class="modBtn modBtnSecondary modBtnSm" data-acao="nao-contatar" data-op="' + esc(r.op_codigo) + '" data-v="' + (r.nao_contatar ? '0' : '1') + '">' + (r.nao_contatar ? 'Voltar a contatar' : 'Marcar não contatar') + '</button>';
      h += '</div>';
    }
    return h + '</footer></div>';
  }
  function listaHtml() {
    var d = S.dados, total = Number(d.total_filtrado || 0), g = gestor();
    if (!S.lista.length) {
      if (!g && sem_nenhum()) return '<div class="pspEstado"><b>Você ainda não tem clientes atribuídos.</b><span>Fale com seu gerente.</span></div>';
      if (!g) return '<div class="pspEstado"><b>Você não tem clientes nesta faixa.</b><span>Veja as outras faixas.</span></div>';
      return '<div class="pspEstado"><b>Nenhum contrato com estes filtros.</b><span>Mude a faixa ou limpe os filtros.</span></div>';
    }
    var todosSel = S.lista.length && S.lista.every(function (r) { return S.sel[r.op_codigo]; });
    var h = '<table class="pspTabela"><thead><tr>' +
      (g ? '<th class="pspSelCol"><input type="checkbox" data-acao="sel-todos"' + (todosSel ? ' checked' : '') + ' aria-label="Selecionar todos os mostrados"></th>' : '') +
      '<th>Cliente</th><th class="pspNum">Termina</th><th class="pspNum">Paga hoje</th><th class="pspNum">Parcela final</th>' + (g ? '<th>Vendedor</th>' : '') + '<th><span class="pspSr">Abrir</span></th></tr></thead><tbody>' +
      S.lista.map(linhaHtml).join('') + '</tbody></table>' +
      '<div class="pspCartoes">' + (g ? '<label class="pspCheck pspSelTodosM"><input type="checkbox" data-acao="sel-todos"' + (todosSel ? ' checked' : '') + '> Selecionar todos os mostrados</label>' : '') + S.lista.map(cartaoHtml).join('') + '</div>' +
      '<div class="pspMais"><span>Mostrando <b>' + num(S.lista.length) + '</b> de <b>' + num(total) + '</b> · ordenados por quem termina primeiro</span>' +
      (S.lista.length < total ? '<button type="button" class="modBtn modBtnSecondary" data-acao="mais"' + (S.carregandoMais ? ' disabled' : '') + '>' + (S.carregandoMais ? 'Carregando…' : 'Carregar mais') + '</button>' : '') + '</div>';
    return h;
  }
  function sem_nenhum() {
    var r = S.dados && S.dados.resumo && S.dados.resumo.TODOS; if (!r) return true;
    return Object.keys(r).every(function (k) { return !Number(r[k]); });
  }
  function barraSelHtml() {
    var ops = Object.keys(S.sel).filter(function (k) { return S.sel[k]; });
    if (!gestor() || !ops.length) return '';
    var b = S.barra || {};
    return '<div class="pspBarraSel" role="region" aria-label="Ações para os selecionados"><b>' + num(ops.length) + (ops.length === 1 ? ' selecionado' : ' selecionados') + '</b>' +
      '<label class="pspAtribuir"><span>Atribuir a</span><select data-campo="atribuirLote" aria-label="Vendedor"><option value="">' + (b.carregando ? 'Carregando…' : (b.erro ? esc(b.erro) : 'Escolha um vendedor…')) + '</option>' +
      (b.vendedores || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(nomeP(x.nome)) + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="modBtn modBtnPrimary modBtnSm" data-acao="atribuir-lote">Atribuir</button>' +
      '<button type="button" class="modBtn modBtnSecondary modBtnSm" data-acao="tirar-lote">Tirar atribuição</button>' +
      '<button type="button" class="pspLinkSec" data-acao="limpar-sel">Limpar seleção</button></div>';
  }
  function dividirHtml() {
    var m = S.dividir; if (!m) return '';
    var sem = (S.dados.sem_vendedor && S.dados.sem_vendedor[S.filtros.faixa] || {}).sem || 0;
    var marcados = (m.vendedores || []).filter(function (v) { return m.marcados[v.id]; }).length;
    var h = '<div class="pspModalFundo" data-acao="fechar-dividir"></div><div class="pspModal" role="dialog" aria-modal="true" aria-labelledby="pspDivTit">' +
      '<h3 id="pspDivTit">Dividir entre a equipe</h3>' +
      '<p class="pspMini">' + plural(sem, 'contrato a distribuir', 'contratos a distribuir') + ' (sem vendedor ou com vendedor que saiu) nesta faixa e nos filtros atuais. Cada um só vai para vendedor ativo da mesma loja e departamento; clientes marcados "não contatar" ficam de fora.</p>';
    if (m.carregando) h += '<div class="modLoadingState">Carregando vendedores…</div>';
    else if (m.erro) h += '<div class="modErrorState">' + esc(m.erro) + '</div>';
    else {
      var porLoja = {};
      (m.vendedores || []).forEach(function (v) { (porLoja[v.loja] = porLoja[v.loja] || []).push(v); });
      Object.keys(porLoja).sort().forEach(function (l) {
        h += '<fieldset class="pspDivLoja"><legend>' + esc(loja(l)) + '</legend>' + porLoja[l].map(function (v) {
          return '<label class="pspCheck"><input type="checkbox" data-acao="div-vend" data-id="' + esc(v.id) + '"' + (m.marcados[v.id] ? ' checked' : '') + '> ' + esc(nomeP(v.nome)) + '</label>';
        }).join('') + '</fieldset>';
      });
      h += '<p class="pspDivConta">' + (marcados ? 'Cerca de <b>' + num(Math.ceil(sem / marcados)) + '</b> para cada um dos ' + num(marcados) + ' vendedores.' : 'Escolha os vendedores que vão receber.') + '</p>';
    }
    if (m.resultado) h += '<div class="pspOk" role="status">' + esc(m.resultado) + '</div>';
    h += '<div class="pspModalAcoes"><button type="button" class="modBtn modBtnSecondary" data-acao="fechar-dividir">' + (m.resultado ? 'Fechar' : 'Cancelar') + '</button>' +
      (m.resultado ? '' : '<button type="button" class="modBtn modBtnPrimary" data-acao="confirmar-dividir"' + (marcados && !m.enviando ? '' : ' disabled') + '>' + (m.enviando ? 'Dividindo…' : 'Dividir') + '</button>') + '</div></div>';
    return h;
  }

  function render() {
    if (!outletRef) return;
    var h = '<div class="pspPagina' + (gestor() ? ' isGestor' : ' isVendedor') + '">';
    if (S.erro && !S.dados) h += topoHtml() + '<div class="modErrorState">' + esc(S.erro) + ' <button type="button" class="modBtn modBtnSecondary" data-acao="recarregar">Tentar novamente</button></div>';
    else if (!S.dados) h += topoHtml() + '<div class="modLoadingState">Carregando…</div>';
    else {
      h += topoHtml() + faixasHtml() + avisoDistribuirHtml() + filtrosHtml() +
        (S.msg ? '<div class="pspMsg" role="status">' + esc(S.msg) + ' <button type="button" class="pspLinkSec" data-acao="fechar-msg">ok</button></div>' : '') +
        (S.carregando ? '<div class="modLoadingState pspAtualizando">Atualizando…</div>' : '') + listaHtml();
    }
    h += '</div>' + barraSelHtml() + dividirHtml() + confirmarTrocaHtml();
    var foco = document.activeElement, focoBusca = foco && foco.classList && foco.classList.contains('pspBusca'), pos = focoBusca ? foco.selectionStart : null;
    outletRef.innerHTML = h;
    if (focoBusca) { var b = outletRef.querySelector('.pspBusca'); if (b) { b.focus(); try { b.setSelectionRange(pos, pos); } catch (e) { /* */ } } }
    if (S.focarOp) { var el = outletRef.querySelector('.pspLinha[data-op="' + S.focarOp + '"]'); if (el && el.offsetParent) el.focus(); S.focarOp = null; }
  }

  // ---------------------------------------------------------------- ações
  function contrato(op) { for (var i = 0; i < S.lista.length; i++) if (S.lista[i].op_codigo === op) return S.lista[i]; return null; }
  function abrir(op) {
    if (S.aberto === op) { S.aberto = null; render(); return; }
    S.aberto = op; render();
    var r = contrato(op);
    if (!S.det[op]) {
      rpc('prospeccao_detalhes', { p_op: op }).then(function (d) { S.det[op] = { dados: d }; render(); carregarVendedoresUm(op, r); })
        .catch(function (e) { S.det[op] = { erro: (e && e.message) || 'Não foi possível abrir os detalhes.' }; render(); });
    }
  }
  function vendedoresDe(lojaCod, dep) {
    S.cacheVend = S.cacheVend || {};
    var k = lojaCod + '|' + dep;
    if (!S.cacheVend[k]) S.cacheVend[k] = rpc('prospeccao_vendedores_atribuiveis', { p_loja: lojaCod, p_departamento: dep });
    return S.cacheVend[k];
  }
  function carregarVendedoresUm(op, r) {
    if (!gestor() || !r) return;
    vendedoresDe(r.loja, r.departamento).then(function (l) { if (S.det[op]) { S.det[op].vendedores = l || []; render(); } }).catch(function () { /* fica "Carregando…" */ });
  }
  function selecionados() { return S.lista.filter(function (r) { return S.sel[r.op_codigo]; }); }
  function atualizarBarra() {
    var sel = selecionados();
    if (!sel.length) { S.barra = null; render(); return; }
    var lojas = {}, deps = {};
    sel.forEach(function (r) { lojas[r.loja] = 1; deps[r.departamento] = 1; });
    if (Object.keys(lojas).length > 1) { S.barra = { erro: 'selecione uma loja por vez' }; render(); return; }
    var l = Object.keys(lojas)[0], ds = Object.keys(deps);
    S.barra = { carregando: true }; render();
    Promise.all(ds.map(function (d) { return vendedoresDe(l, d); })).then(function (listas) {
      // só quem serve para TODOS os departamentos selecionados
      var conta = {}, nomes = {};
      listas.forEach(function (lst) { (lst || []).forEach(function (v) { conta[v.id] = (conta[v.id] || 0) + 1; nomes[v.id] = v.nome; }); });
      S.barra = { vendedores: Object.keys(conta).filter(function (id) { return conta[id] === listas.length; }).map(function (id) { return { id: id, nome: nomes[id] }; })
        .sort(function (a, b) { return nomeP(a.nome).localeCompare(nomeP(b.nome), 'pt-BR'); }) };
      render();
    }).catch(function (e) { S.barra = { erro: (e && e.message) || 'erro ao carregar' }; render(); });
  }
  function atribuir(ops, vendedor, confirmado) {
    return rpc('prospeccao_atribuir', { p_ops: ops, p_vendedor: vendedor || null, p_confirmar: !!confirmado }).then(function (r) {
      var rec = (r && r.recusados) || [], conf = (r && r.precisa_confirmar) || [];
      if (conf.length) {   // o cliente é de quem vendeu: tirar de um vendedor ativo só confirmando (fica registrado)
        S.confirmarTroca = { ops: conf.map(function (x) { return x.op; }), vendedor: vendedor || null, lista: conf, feitos: r.atribuidos };
        render(); var b = outletRef.querySelector('.pspModal [data-acao="cancelar-troca"]'); if (b) b.focus();
        return;
      }
      S.msg = (vendedor ? plural(r.atribuidos, 'contrato atribuído', 'contratos atribuídos') : plural(r.atribuidos, 'atribuição retirada', 'atribuições retiradas')) +
        (rec.length ? ' · ' + plural(rec.length, 'recusado', 'recusados') + ': ' + rec[0].motivo : '') + '.';
      return carregar();
    }).catch(function (e) { S.msg = (e && e.message) || 'Não foi possível atribuir.'; render(); });
  }
  function confirmarTrocaHtml() {
    var m = S.confirmarTroca; if (!m) return '';
    var donos = {}; m.lista.forEach(function (x) { var k = nomeP(x.dono) || 'vendedor'; donos[k] = (donos[k] || 0) + 1; });
    var nomes = Object.keys(donos).map(function (n) { return esc(n) + (donos[n] > 1 ? ' (' + num(donos[n]) + ')' : ''); }).join(', ');
    return '<div class="pspModalFundo" data-acao="cancelar-troca"></div><div class="pspModal" role="alertdialog" aria-modal="true" aria-labelledby="pspTrocaTit">' +
      '<h3 id="pspTrocaTit">' + (m.lista.length === 1 ? 'Este cliente é de um vendedor ativo' : 'Estes clientes são de vendedores ativos') + '</h3>' +
      '<p>' + plural(m.lista.length, 'contrato é', 'contratos são') + ' de quem fez a venda: <b>' + nomes + '</b>. ' +
      (m.vendedor ? 'Trocar o vendedor tira o cliente dele.' : 'Tirar a atribuição devolve o cliente ao vendedor da venda original.') + ' A troca fica registrada.</p>' +
      (m.feitos ? '<p class="pspMini">' + plural(m.feitos, 'outro contrato já foi atribuído', 'outros contratos já foram atribuídos') + '.</p>' : '') +
      '<div class="pspModalAcoes"><button type="button" class="modBtn modBtnSecondary" data-acao="cancelar-troca">Cancelar</button>' +
      '<button type="button" class="modBtn modBtnPrimary" data-acao="confirmar-troca">' + (m.lista.length === 1 ? 'Sim, trocar' : 'Sim, trocar os ' + num(m.lista.length)) + '</button></div></div>';
  }
  function abrirDividir() {
    var lojasAlvo = S.filtros.loja ? [S.filtros.loja] : ((S.dados.filtros && S.dados.filtros.lojas) || []);
    S.dividir = { carregando: true, marcados: {} }; render();
    var pedidos = [];
    var depsAlvo = S.filtros.departamento ? [S.filtros.departamento] : ['NOVOS', 'SEMINOVOS'];
    lojasAlvo.forEach(function (l) { depsAlvo.forEach(function (d) { pedidos.push(vendedoresDe(l, d).then(function (lst) { return (lst || []).map(function (v) { return { id: v.id, nome: v.nome, loja: l }; }); })); }); });
    Promise.all(pedidos).then(function (ls) {
      var vistos = {}, lista = [];
      ls.forEach(function (x) { x.forEach(function (v) { if (!vistos[v.id]) { vistos[v.id] = 1; lista.push(v); } }); });
      lista.sort(function (a, b) { return a.nome.localeCompare(b.nome); });
      S.dividir = { vendedores: lista, marcados: {} }; render();
      var p = outletRef.querySelector('.pspModal input'); if (p) p.focus();
    }).catch(function (e) { S.dividir = { erro: (e && e.message) || 'Não foi possível carregar os vendedores.', marcados: {} }; render(); });
  }
  function confirmarDividir() {
    var m = S.dividir, ids = Object.keys(m.marcados).filter(function (k) { return m.marcados[k]; });
    m.enviando = true; render();
    var f = S.filtros;
    rpc('prospeccao_dividir', { p_tipo: null, p_faixa: f.faixa, p_loja: f.loja || null, p_banco: null, p_busca: f.busca || null, p_ocultar_novo: !!f.ocultarNovo, p_vendedores: ids, p_departamento: f.departamento || null })
      .then(function (r) {
        m.enviando = false;
        var nomes = {}; (m.vendedores || []).forEach(function (v) { nomes[v.id] = nomeP(v.nome); });
        var partes = Object.keys(r.por_vendedor || {}).map(function (id) { return num(r.por_vendedor[id]) + ' para ' + (nomes[id] || 'vendedor'); });
        var fora = [];
        if (r.sem_vendedor_apto_na_loja) fora.push(num(r.sem_vendedor_apto_na_loja) + ' sem vendedor escolhido da mesma loja e departamento');
        if (r.nao_contatar_fora) fora.push(plural(r.nao_contatar_fora, 'marcado "não contatar"', 'marcados "não contatar"'));
        m.resultado = (r.atribuidos ? plural(r.atribuidos, 'contrato atribuído', 'contratos atribuídos') + ': ' + partes.join(', ') + '.' : 'Nenhum contrato atribuído.') +
          (fora.length ? ' Ficaram de fora: ' + fora.join('; ') + '.' : ' Nenhum ficou de fora.');
        render(); carregar();
      }).catch(function (e) { m.enviando = false; m.erro = (e && e.message) || 'Não foi possível dividir.'; render(); });
  }
  function exportar() {
    var H = window.NX_XLSX_EXPORT_HELPER, f = S.filtros;
    if (!H) { S.msg = 'Exportação indisponível nesta página.'; render(); return; }
    S.exportando = true; render();
    rpc('prospeccao_exportar', { p_tipo: null, p_faixa: f.faixa, p_loja: f.loja || null, p_banco: null, p_vendedor: f.vendedor || null, p_departamento: f.departamento || null }).then(function (d) {
      var linhas = ((d && d.lista) || []).map(function (r) {
        return [r.cliente || '', loja(r.loja), TIPO_LABEL[r.tipo] || r.tipo, r.banco || '', Number(r.parcelas) || 0, Number(r.valor_parcela) || 0,
                H.excelDateValue(r.data_contrato) || '', H.excelDateValue(r.data_fim) || '', r.balao_valor != null ? Number(r.balao_valor) : '',
                nomeP(r.vendedor) || 'Sem vendedor', r.vendedor_origem === 'ATRIBUICAO' ? 'Atribuído' : (r.vendedor_origem === 'VENDA' ? (r.vendedor_saiu ? 'Venda original · vendedor saiu' : 'Venda original') : ''),
                nomeP(r.vendedor_original) || '',
                r.pj ? 'Sim' : '', r.ja_fez_novo ? 'Sim' : '', r.nao_contatar ? 'Sim' : ''];
      });
      var cab = ['Cliente', 'Loja', 'Tipo', 'Banco', 'Parcelas', 'Parcela', 'Contrato', 'Termina', 'Parcela final', 'Vendedor', 'Origem do vendedor', 'Vendedor da venda original', 'PJ', 'Já fez novo contrato', 'Não contatar'];
      H.downloadWorkbook(cab, linhas, 'Prospecção', 'Prospeccao_' + H.excelFileStamp() + '.xlsx', { moneyCols: ['Parcela', 'Parcela final'], dateCols: ['Contrato', 'Termina'] });
      S.exportando = false; render();
    }).catch(function (e) { S.exportando = false; S.msg = (e && e.message) || 'Não foi possível exportar.'; render(); });
  }

  function onClick(e) {
    var alvo = e.target.closest('[data-acao]'); if (!alvo || !outletRef.contains(alvo)) return;
    var a = alvo.getAttribute('data-acao'), op = alvo.getAttribute('data-op');
    if (a === 'abrir') {
      if (e.target.closest('[data-parar]') || e.target.closest('.pspDet')) return;
      abrir(op); return;
    }
    if (a === 'sel') { e.stopPropagation(); S.sel[op] = alvo.checked; atualizarBarra(); return; }
    if (a === 'sel-todos') { var marcar = alvo.checked; S.lista.forEach(function (r) { S.sel[r.op_codigo] = marcar; }); atualizarBarra(); return; }
    if (a === 'faixa') { S.filtros.faixa = alvo.getAttribute('data-v'); carregar(); return; }
    if (a === 'dep') {
      var novo = alvo.getAttribute('data-v'); if (novo === S.filtros.departamento) return;
      S.filtros.departamento = novo;
      if (S.filtros.vendedor && ['A_DISTRIBUIR', 'SEM_VENDEDOR', 'VENDEDOR_SAIU'].indexOf(S.filtros.vendedor) < 0) S.filtros.vendedor = '';   // vendedor é de um departamento
      carregar(); return;
    }
    if (a === 'so-sem') { S.filtros.vendedor = S.filtros.vendedor === 'A_DISTRIBUIR' ? '' : 'A_DISTRIBUIR'; carregar(); return; }
    if (a === 'dividir') { abrirDividir(); return; }
    if (a === 'cancelar-troca') { var feitos = S.confirmarTroca && S.confirmarTroca.feitos; S.confirmarTroca = null; if (feitos) carregar(); else render(); return; }
    if (a === 'confirmar-troca') { var t = S.confirmarTroca; S.confirmarTroca = null; atribuir(t.ops, t.vendedor, true); return; }
    if (a === 'fechar-dividir') { S.dividir = null; render(); return; }
    if (a === 'div-vend') { S.dividir.marcados[alvo.getAttribute('data-id')] = alvo.checked; render(); return; }
    if (a === 'confirmar-dividir') { confirmarDividir(); return; }
    if (a === 'mais') { carregarMais(); return; }
    if (a === 'recarregar') { carregar(); return; }
    if (a === 'fechar-msg') { S.msg = null; render(); return; }
    if (a === 'exportar') { exportar(); return; }
    if (a === 'limpar-sel') { S.sel = {}; S.barra = null; render(); return; }
    if (a === 'revelar') {
      rpc('prospeccao_revelar_documento', { p_op: op }).then(function (r) { S.det[op].revelado = (r && r.documento) || (r && r.mensagem) || '—'; render(); })
        .catch(function (er) { S.msg = (er && er.message) || 'Não foi possível revelar.'; render(); });
      return;
    }
    if (a === 'atribuir-um') {
      // o detalhe existe na tabela (computador) e no cartão (celular): usa o seletor do MESMO detalhe do botão clicado
      var caixa = alvo.closest('.pspDet') || outletRef, s = caixa.querySelector('select[data-campo="atribuirUm"][data-op="' + op + '"]');
      if (!s || !s.value) { S.msg = 'Escolha o vendedor.'; render(); return; }
      atribuir([op], s.value); return;
    }
    if (a === 'tirar-um') { atribuir([op], null); return; }
    if (a === 'atribuir-lote') {
      var sl = outletRef.querySelector('select[data-campo="atribuirLote"]');
      if (!sl || !sl.value) { S.msg = 'Escolha o vendedor.'; render(); return; }
      atribuir(selecionados().map(function (r) { return r.op_codigo; }), sl.value); return;
    }
    if (a === 'tirar-lote') { atribuir(selecionados().map(function (r) { return r.op_codigo; }), null); return; }
    if (a === 'nao-contatar') {
      rpc('prospeccao_nao_contatar', { p_op: op, p_ativo: alvo.getAttribute('data-v') === '1', p_motivo: null }).then(function () { S.focarOp = op; return carregar(); })
        .catch(function (er) { S.msg = (er && er.message) || 'Não foi possível marcar.'; render(); });
    }
  }
  function onChange(e) {
    var c = e.target.getAttribute('data-campo'); if (!c) return;
    if (c === 'loja' || c === 'vendedor') { S.filtros[c] = e.target.value; carregar(); }
    else if (c === 'ocultarNovo') { S.filtros.ocultarNovo = e.target.checked; carregar(); }
  }
  function onInput(e) {
    if (e.target.getAttribute('data-campo') !== 'busca') return;
    S.filtros.busca = e.target.value;
    clearTimeout(buscaTimer); buscaTimer = setTimeout(carregar, 350);   // a busca vai ao banco: procura na faixa inteira
  }
  function onKey(e) {
    if (!outletRef || !document.body.contains(outletRef)) return;
    if (e.key === 'Escape' && S.confirmarTroca) { S.confirmarTroca = null; render(); return; }
    if (e.key === 'Escape' && S.dividir) { S.dividir = null; render(); return; }
    var linha = e.target.closest && e.target.closest('.pspLinha');
    if (linha && (e.key === 'Enter' || e.key === ' ') && e.target === linha) { e.preventDefault(); S.focarOp = linha.getAttribute('data-op'); abrir(S.focarOp); }
  }

  // 24/11/2026 (Luis): quem entra (além do Master) é decidido no banco (configuracoes.prospeccao_perfis_liberados).
  // Uma consulta por login; recusa, erro ou rede fora = fechado. Liberar/bloquear vale para quem recarregar a página.
  var acessoPsp = { chave: null, liberado: false };
  function liberadoPeloBanco(ctx) {
    var chave = ctx ? String(ctx.authUserId || ctx.userId || '') : '';
    if (!chave) return false;
    if (acessoPsp.chave !== chave) {
      acessoPsp = { chave: chave, liberado: false };
      rpc('prospeccao_acesso', {}).then(function (r) {
        if (acessoPsp.chave !== chave || !r || r.liberado !== true) return;
        acessoPsp.liberado = true;
        try { window.dispatchEvent(new CustomEvent('nx:acesso-ia')); } catch (e) { /* a tela inicial atualiza na próxima navegação */ }
      }, function () {});
    }
    return acessoPsp.liberado;
  }
  window.NX_SEPARATE_AUTHORITY = window.NX_SEPARATE_AUTHORITY || {};
  window.NX_SEPARATE_AUTHORITY.prospeccao = liberadoPeloBanco;

  window.NX_PROSPECCAO_PAGE = {
    getState: function () { return S; },
    render: function (outlet) {
      if (outletRef && outletRef !== outlet) { outletRef.removeEventListener('click', onClick); outletRef.removeEventListener('change', onChange); outletRef.removeEventListener('input', onInput); }
      if (outletRef !== outlet) { outlet.addEventListener('click', onClick); outlet.addEventListener('change', onChange); outlet.addEventListener('input', onInput); }
      if (!outletRef) document.addEventListener('keydown', onKey);
      outletRef = outlet;
      S = { filtros: { faixa: 'PROX_30', departamento: '', loja: '', vendedor: '', busca: '', ocultarNovo: false },
            dados: null, lista: [], erro: null, msg: null, carregando: false, carregandoMais: false, exportando: false,
            aberto: null, det: {}, sel: {}, barra: null, dividir: null, abriuTela: false, cacheVend: {} };
      return carregar();
    }
  };
})();
