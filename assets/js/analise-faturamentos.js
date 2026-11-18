/* PORTAL-NEXT V2 — Análise de Faturamentos (08/11/2026, pedido do Luis; layout refeito em 09/11; Analistas e
   "Justificar demora" em 09/11/2026). Master e Analistas ativos.
   Propostas de financiamento FATURADAS e ainda sem pagamento (o banco não liberou o dinheiro para a loja).

   Acesso: ANALISTA_OR_MASTER no registro (menu e rota) + a função faturamentos_analise confere no banco, a cada chamada,
   se quem chama é Master ou Analista ATIVO (todas as lojas para os dois). Exportar Excel: SÓ Master — o arquivo é gerado
   a partir de master_faturamentos, que continua só do Master no banco; para o Analista o botão nem aparece.
   Justificar demora (faixas Em atenção, Urgência e Grave): fat_justificar grava (só acréscimo, com autor e data/hora);
   fat_justificativas devolve o histórico (mais recente primeiro). As regras e os números do cálculo não mudaram.
   Textos para o usuário não citam o nome do relatório de origem ("Dados atualizados em"). Nunca recebe nem mostra CPF.

   10/11/2026 (OK do Luis) — v2: perfil FINANCEIRO e ligação em 3 camadas.
   - Acesso: authMode FATURAMENTOS (Master, Analistas e Financeiro); faturamentos_painel confere no banco e diz o que cada
     perfil pode fazer (pode_exportar / pode_justificar / pode_vincular / pode_solicitar_retorno).
   - Ligação proposta -> chassi: Documento (chave protegida do CPF/CNPJ, nunca o CPF), Nome ou Manual. Nada fica
     "a confirmar": sem ligação segura, o Master/Analista vincula o chassi à mão (faturamentos_vincular, com motivo).
   - Financeiro: lista e detalhes, Exportar (registrado no banco) e "Solicitar retorno urgente" (Edge Function
     faturamentos-retorno-urgente: e-mail só ao Analista responsável vigente da loja, sem CPF e sem nome do cliente).
     Não justifica. O Analista responsável vê um aviso a cada acesso até registrar a justificativa.

   12/11/2026 (OK do Luis) — dados do PAGAMENTO e do REBATE, só para propostas faturadas a partir de 01/11/2026 (o corte vem
   do servidor). O PAGO continua vindo do relatório do banco; as PAGAS desde o corte ficam na aba "Pagas" e pedem data do
   crédito, loja da conta que recebeu e valor creditado (diferença do financiado => motivo). Subsidiadas (plano 999, lido no
   servidor) pedem o valor do rebate. Etiqueta "completar dados" enquanto faltar. Preenche/corrige: Master ou Analista
   responsável da loja (o servidor diz em pode_preencher); cada correção é um registro novo (histórico). Financeiro: vê,
   filtra por conta e por "pago na conta de outra loja" e exporta. Master: resumo de rebate por loja e mês.
   Funções: faturamentos_painel2 / fat_pagamento_registrar / fat_rebate_registrar / faturamentos_historico2 / faturamentos_exportar2. */
(function () {
  'use strict';

  var FAIXAS = [   // ordem da lista: do mais grave para o mais leve
    { v: 'GRAVE', label: 'Grave', dias: 'acima de 9 dias úteis' },
    { v: 'URGENCIA', label: 'Urgência', dias: '6–9 dias úteis' },
    { v: 'ATENCAO', label: 'Em atenção', dias: '4–5 dias úteis' },
    { v: 'NORMAL', label: 'Normal', dias: '1–3 dias úteis' }
  ];
  var BARRA = ['NORMAL', 'ATENCAO', 'URGENCIA', 'GRAVE'];   // ordem da barra: do mais leve para o mais grave
  var FAIXA_LABEL = { NORMAL: 'Normal', ATENCAO: 'Em atenção', URGENCIA: 'Urgência', GRAVE: 'Grave' };
  var PERIODOS = [
    { v: 'mes', label: 'Mês atual' }, { v: 'ultimo', label: 'Último mês' }, { v: '3m', label: '3 meses' },
    { v: '6m', label: '6 meses' }, { v: '12m', label: '12 meses' }, { v: 'tudo', label: 'Tudo' }, { v: 'custom', label: 'Personalizado' }
  ];
  var MOTIVOS = ['Pendência de documento', 'Aguardando banco', 'Contrato não assinado', 'Gravame', 'Outro'];
  var JUST_FILTRO = [{ v: 'SEM', label: 'Sem justificativa' }, { v: 'DESATUALIZADA', label: 'Desatualizada' }, { v: 'OK', label: 'Justificadas' }];
  var MIN_TEXTO = 20;
  var SEM_CHASSI = 'sem chassi ligado';
  var ORIGEM = { DOCUMENTO: 'Documento', NOME: 'Nome', MANUAL: 'Manual' };
  var ORIGEM_DICA = {
    DOCUMENTO: 'Ligado pelo documento do cliente (mesmo CPF/CNPJ na venda, comparado de forma protegida).',
    NOME: 'Ligado pelo nome do cliente nos financiamentos.',
    MANUAL: 'Vinculado à mão por um Master ou Analista.'
  };
  var SEM_LIGACAO_TXT = {
    CONFLITO: 'o documento e o nome apontam carros diferentes',
    MAIS_DE_UM_CARRO: 'há mais de um carro possível',
    NAO_ENCONTRADO: 'nenhuma venda encontrada para este cliente'
  };
  var MIN_MOTIVO = 10;

  var outletRef = null, S = null, focoAntes = null;

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
        body: JSON.stringify(corpo)
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (b) {
          if (resp.ok) return b;
          var code = b && b.code;
          if (resp.status === 401) return Promise.reject({ state: 'SESSION_EXPIRED' });
          if (code === '42501' || resp.status === 403) return Promise.reject({ state: 'PERMISSION_DENIED', message: (b && b.message) || 'Acesso negado.' });
          if (code === '22023') return Promise.reject({ state: 'VALIDATION', message: b.message });
          return Promise.reject({ state: 'BACKEND_ERROR', message: 'Não foi possível concluir agora. Tente novamente.' });
        });
      }, function () { return Promise.reject({ state: 'BACKEND_ERROR', message: 'Sem conexão. Confira a internet e tente de novo.' }); });
    });
  }
  function buscar(ini, fim) { return rpc('faturamentos_painel2', { p_ini: ini || null, p_fim: fim || null }); }
  // pedido de retorno urgente: Edge Function (o banco confere perfil, faixa e pedido em aberto com o JWT de quem pede)
  function pedirRetorno(proposta) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ state: 'SESSION_EXPIRED', message: 'Sessão expirada.' });
      return fetch(cfg.supabaseUrl + '/functions/v1/faturamentos-retorno-urgente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ proposta: proposta })
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (b) {
          if (resp.ok && b && b.ok) return b;
          if (resp.status === 401) return Promise.reject({ state: 'SESSION_EXPIRED' });
          return Promise.reject({ state: 'VALIDATION', message: (b && b.message) || 'Não foi possível pedir o retorno agora.' });
        });
      }, function () { return Promise.reject({ state: 'BACKEND_ERROR', message: 'Sem conexão. Confira a internet e tente de novo.' }); });
    });
  }

  // ---------------------------------------------------------------- utilidades
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function brl(v) { return v == null || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function num(v, casas) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 }); }
  function data(v) { if (!v) return '—'; var p = String(v).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); }
  function dataLonga(v) { if (!v) return '—'; var p = String(v).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function dataCurta(v) { if (!v) return '—'; var p = String(v).slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
  function dataHora(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' + d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }
  function diaHora(v) {   // curto, para os selos: 10/11 09:05
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function loja(code) { return code ? (window.NX_STORE_DISPLAY ? window.NX_STORE_DISPLAY.storeDisplayName(code) : code) : '—'; }
  function titulo(s) { return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }); }
  function ligado(r) { return r.ligacao === 'OK' && !!r.chassi; }
  function chassiDe(r) { return ligado(r) ? r.chassi : SEM_CHASSI; }
  function seLigado(r, v) { return ligado(r) ? (v || '—') : '—'; }
  function vendedorDe(r) { return ligado(r) ? (titulo(r.vendedor) || '—') : '—'; }
  function pode(p) { return !!(S && S.dados && S.dados[p] === true); }
  function seloOrigem(r) {
    if (!ligado(r)) return '<span class="fatOrigem fatOrigemSem" title="' + esc('Sem ligação segura: ' + (SEM_LIGACAO_TXT[r.sem_ligacao] || 'conferir')) + '">Sem ligação</span>';
    var o = r.ligacao_origem;
    return '<span class="fatOrigem fatOrigem' + esc(o) + '" title="' + esc(ORIGEM_DICA[o] || '') + '">' + esc(ORIGEM[o] || o) + '</span>';
  }
  function retornoAberto(r) { return !!(r.retorno && !r.retorno.resposta); }
  function seloRetorno(r) {
    var t = r.retorno;
    if (!t) return '';
    if (t.resposta) return '<span class="fatRet fatRetOk" title="' + esc('Respondido por ' + titulo(t.resposta.por) + ' em ' + dataHora(t.resposta.em)) + '">Respondido ' + esc(diaHora(t.resposta.em)) + '</span>';
    return '<span class="fatRet fatRetAberto" title="' + esc('Pedido por ' + titulo(t.solicitado_por) + (t.email_erro ? ' — o e-mail não saiu; o aviso no Portal foi criado' : '')) + '">' +
      'Retorno solicitado ' + esc(diaHora(t.solicitado_em)) + (t.teste ? ' · teste' : '') + '</span>';
  }
  function tituloForm(r) { return ligado(r) && r.modelo ? r.modelo : 'Proposta nº ' + r.proposta; }
  function podePedirRetorno(r) { return pode('pode_solicitar_retorno') && r.faixa !== 'NORMAL' && !retornoAberto(r); }
  function fatTxt(r) { return (r.faturamento_desde_inicio ? 'até ' : '') + data(r.faturamento); }
  function badge(f) { return '<span class="fatBadge fat' + f + '">' + esc(FAIXA_LABEL[f] || f) + '</span>'; }
  function soma(l) { return l.reduce(function (s, r) { return s + Number(r.financiado || 0); }, 0); }
  // 18/11/2026 (Luis, opção A): "financiado" = líquido da Base 02 ("Valor Serviço") pelo chassi. Sem essa ligação vem o valor
  // da Base 03 (com tarifas embutidas) e aparece a marca "com tarifas".
  var MARCA_BASE03 = 'Sem ligação com a Base 02: valor da Base 03, com tarifas embutidas';
  function semLiquido(r) { return r.financiado_fonte === 'BASE03'; }
  function finTxt(r, fmt) {
    return esc((fmt || brl2)(r.financiado)) + (semLiquido(r) ? ' <span class="fatValBase03" title="' + MARCA_BASE03 + '">com tarifas</span>' : '');
  }
  function opcoes(lista) { var s = {}; lista.forEach(function (x) { if (x) s[x] = true; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }); }
  function pedeJust(r) { return r.faixa !== 'NORMAL'; }
  function podeJust(r) { return pedeJust(r) && pode('pode_justificar'); }
  function justStatus(r) { return (r.just && r.just.status) || (pedeJust(r) ? 'SEM' : 'NAO_SE_APLICA'); }
  function seloJust(r) {
    var st = justStatus(r);
    if (st === 'NAO_SE_APLICA') return '<span class="fatJustNa">—</span>';
    if (st === 'SEM') return '<span class="fatJust fatJustSem">Sem justificativa</span>';
    if (st === 'DESATUALIZADA') return '<span class="fatJust fatJustVelha" title="A última justificativa tem mais de 3 dias úteis e a proposta continua em aberto.">Justificativa desatualizada</span>';
    var d = Number(r.just.dias_uteis || 0);
    return '<span class="fatJust fatJustOk">' + (d === 0 ? 'Justificada hoje' : 'Justificada há ' + d + ' dia' + (d > 1 ? 's' : '') + ' út' + (d > 1 ? 'eis' : 'il')) + '</span>';
  }
  function porChave(k) { return todasLinhas().filter(function (x) { return x._k === String(k); })[0]; }
  function todasLinhas() { return ((S.dados && S.dados.abertas) || []).concat((S.dados && S.dados.pagas_corte) || []); }
  function pagas() { return (S.dados && S.dados.pagas_corte) || []; }
  function ehPaga(r) { return r && r.situacao === 'PAGA'; }

  // ---------------------------------------------------------------- pagamento e rebate (12/11/2026)
  function falta(r, o) { return !!(r && r.completar && r.completar.indexOf(o) >= 0); }
  function aCompletar(r) { return !!(r && r.completar && r.completar.length); }
  function outraLoja(r) { return !!(r && r.pagamento && r.pagamento.outra_loja); }
  function corteTxt() { return data(S.dados && S.dados.corte).replace(/\/(\d\d)$/, '/20$1'); }
  function brl2(v) { return v == null || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dinheiroTxt(v) { return v == null || isNaN(Number(v)) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function lerDinheiro(s) {   // "123.456,78" ou "123456.78" -> número (null se inválido)
    var t = String(s == null ? '' : s).trim().replace(/[R$\s]/g, '');
    if (!t) return null;
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Number(t);
  }
  function seloCompletar(r) {
    if (!aCompletar(r)) return '';
    var o = [];
    if (falta(r, 'PAGAMENTO')) o.push('data, conta e valor do crédito');
    if (falta(r, 'REBATE')) o.push('valor do rebate');
    return '<span class="fatCompletar" title="' + esc('Falta: ' + o.join(' e ')) + '">completar dados</span>';
  }
  function seloOutraLoja(r) {
    return outraLoja(r) ? '<span class="fatOutraLoja">Pago na conta de outra loja: ' + esc(loja(r.pagamento.conta_loja)) + '</span>' : '';
  }
  function seloSubs(r) { return r && r.subsidiado ? '<span class="fatSubs" title="Plano 999 (Subsidiado)">Subsidiada</span>' : ''; }
  function botaoPag(r, cls) {
    if (!ehPaga(r) || !r.pode_preencher) return '';
    return '<button type="button" class="fatPagBtn' + (cls ? ' ' + cls : '') + '" data-acao="pagar" data-id="' + esc(r._k) + '">' + (cls ? (r.pagamento ? 'Corrigir dados do crédito' : 'Preencher dados do crédito') : (r.pagamento ? 'Corrigir crédito' : 'Preencher crédito')) + '</button>';
  }
  function botaoReb(r, cls) {
    if (!r.subsidiado || !r.pode_preencher) return '';
    return '<button type="button" class="fatRebBtn' + (cls ? ' ' + cls : '') + '" data-acao="rebate" data-id="' + esc(r._k) + '">' + (r.rebate ? 'Corrigir rebate' : 'Informar rebate') + '</button>';
  }

  // período escolhido -> datas (De/Até) enviadas ao servidor, sempre pela data de faturamento
  function intervalo() {
    var f = S.filtros, h = new Date(); h.setHours(12, 0, 0, 0);
    function mesesAtras(n) { var d = new Date(h); d.setMonth(d.getMonth() - n); return d; }
    if (f.periodo === 'mes') return { ini: iso(new Date(h.getFullYear(), h.getMonth(), 1)), fim: iso(h) };
    if (f.periodo === 'ultimo') return { ini: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), fim: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
    if (f.periodo === '3m') return { ini: iso(mesesAtras(3)), fim: iso(h) };
    if (f.periodo === '6m') return { ini: iso(mesesAtras(6)), fim: iso(h) };
    if (f.periodo === '12m') return { ini: iso(mesesAtras(12)), fim: iso(h) };
    if (f.periodo === 'custom') return { ini: f.ini || null, fim: f.fim || null };
    return { ini: null, fim: null };
  }
  function dentro(r, iv) { var d = r.faturamento || ''; return (!iv.ini || d >= iv.ini) && (!iv.fim || d <= iv.fim); }
  function foraDoPeriodo() {
    if (!S.todas) return 0;
    var iv = intervalo();
    if (!iv.ini && !iv.fim) return 0;
    return S.todas.filter(function (r) { return !dentro(r, iv); }).length;
  }
  // loja / banco / vendedor / justificativa (a barra das faixas usa esta base; a lista ainda aplica a faixa)
  function base() {
    var f = S.filtros, ab = (S.dados && S.dados.abertas) || [];
    return ab.filter(function (r) {
      return (!f.loja || r.loja === f.loja) && (!f.banco || r.banco === f.banco) && (!f.vendedor || vendedorDe(r) === f.vendedor) &&
        (!f.just || (pedeJust(r) && justStatus(r) === f.just));
    });
  }
  function filtradas() { var fx = S.filtros.faixa; return base().filter(function (r) { return !fx || r.faixa === fx; }); }
  function ordenar(l) { return l.slice().sort(function (a, b) { return Number(b.dias) - Number(a.dias) || String(a.faturamento).localeCompare(String(b.faturamento)); }); }

  // ---------------------------------------------------------------- tela
  function topoHtml() {
    var c = S.dados && S.dados.carga, n = (S.aba === 'pagas' ? pagasFiltradas() : filtradas()).length, exp = S.dados && S.dados.pode_exportar === true;
    var selo = c ? '<span class="fatSelo' + (c.desatualizada ? ' fatSeloAviso' : '') + '">Dados atualizados em: <b>' + esc(dataCurta(c.data)) + '</b>' +
      (c.desatualizada ? ' · há ' + esc(c.dias_uteis_desde) + ' dias úteis' : '') + '</span>' : '';
    return '<header class="fatTopo">' +
      '<div class="fatTopoTexto"><p class="modEyebrow">Master, Analistas e Financeiro</p><h1 class="modTitle">Análise de Faturamentos</h1>' +
      '<p class="modSubtitle">Propostas de financiamento faturadas, até o pagamento do banco à loja.</p></div>' +
      '<div class="fatTopoAcoes">' + selo +
      (exp ? '<button type="button" class="modBtn modBtnPrimary fatExportar" data-acao="exportar"' + (n && !S.exportando ? '' : ' disabled') + '>' + (S.exportando ? 'Exportando…' : 'Exportar Excel') + '</button>' : '') +
      '</div></header>' +
      (c && c.desatualizada ? '<p class="fatAvisoCarga" role="status">Os dados foram atualizados há ' + esc(c.dias_uteis_desde) +
        ' dias úteis: proposta paga depois disso ainda aparece em aberto até a próxima atualização dos dados.</p>' : '');
  }
  function periodoHtml() {
    var f = S.filtros;
    var h = '<section class="fatPeriodo" aria-label="Período por data de faturamento">' +
      '<span class="fatRotulo">Faturadas em</span><div class="modSegmentedGroup fatPerSeg" role="group" aria-label="Período">' +
      PERIODOS.map(function (p) {
        return '<button type="button" class="modSegItem' + (f.periodo === p.v ? ' modSegItemActive' : '') + '" data-acao="periodo" data-v="' + p.v + '" aria-pressed="' + (f.periodo === p.v) + '">' + p.label + '</button>';
      }).join('') + '</div>';
    if (f.periodo === 'custom') {
      h += '<div class="fatDatas"><label class="fatData">De <input type="date" id="fatF_ini" value="' + esc(f.ini) + '"></label>' +
        '<label class="fatData">Até <input type="date" id="fatF_fim" value="' + esc(f.fim) + '"></label></div>';
    }
    h += '</section>';
    var fora = foraDoPeriodo();
    if (fora > 0) h += '<p class="fatFora" role="status">Há <b>' + fora + '</b> proposta' + (fora > 1 ? 's' : '') + ' em aberto fora deste período — ' +
      '<button type="button" class="fatLink" data-acao="periodo" data-v="tudo">ver todas</button></p>';
    return h;
  }
  // 18/11/2026 (Luis): seletor FATURADOS | PAGOS no estilo do "Faturadas em" (antes, abas "Em aberto | Pagas desde …").
  // O corte e o "a completar" ficam numa linha de apoio, só na visão PAGOS.
  function abasHtml() {
    var ab = (S.dados && S.dados.abertas) || [], pg = pagas(), faltaPg = pg.filter(aCompletar).length;
    function bt(v, rot, n) {
      var on = S.aba === v;
      return '<button type="button" class="modSegItem fatVisaoBtn' + (on ? ' modSegItemActive' : '') + '" data-acao="aba" data-v="' + v + '" aria-pressed="' + on + '">' +
        '<span>' + rot + '</span><span class="fatVisaoQtd">' + num(n) + '</span></button>';
    }
    var h = '<section class="fatPeriodo fatVisao" aria-label="Propostas faturadas ou pagas">' +
      '<span class="fatRotulo">Propostas</span><div class="modSegmentedGroup fatVisaoSeg" role="group" aria-label="Propostas">' +
      bt('abertas', 'Faturados', ab.length) + bt('pagas', 'Pagos', pg.length) + '</div></section>';
    if (S.aba === 'pagas') {
      var so = S.filtros.sit === 'COMPLETAR';
      h += '<p class="fatApoio"><span>Pagos de propostas faturadas a partir de <b>' + esc(corteTxt()) + '</b>.</span>' +
        (faltaPg ? '<span class="fatApoioFalta"><i aria-hidden="true"></i>' + num(faltaPg) + ' a completar' +
          '<button type="button" class="fatLink" data-acao="sit" data-v="COMPLETAR" aria-pressed="' + so + '">' + (so ? 'ver todos' : 'ver só os que faltam') + '</button></span>' : '') + '</p>';
    }
    return h;
  }
  var SITUACOES = [{ v: 'COMPLETAR', label: 'Completar dados' }, { v: 'PREENCHIDAS', label: 'Com dados preenchidos' }, { v: 'OUTRA', label: 'Pago na conta de outra loja' }];
  function pagasFiltradas() {
    var f = S.filtros;
    return pagas().filter(function (r) {
      return (!f.loja || r.loja === f.loja) && (!f.banco || r.banco === f.banco) && (!f.vendedor || vendedorDe(r) === f.vendedor) &&
        (!f.conta || (r.pagamento && r.pagamento.conta_loja === f.conta)) &&
        (!f.sit || (f.sit === 'COMPLETAR' ? aCompletar(r) : f.sit === 'PREENCHIDAS' ? !!r.pagamento : outraLoja(r)));
    });
  }
  function filtrosPagasHtml() {
    var f = S.filtros, pg = pagas(), contas = (S.dados && S.dados.contas) || [];
    function sel(id, rotulo, valor, lista, nomeDe, todos) {
      return '<label class="fatSel"><span>' + rotulo + '</span><select id="' + id + '" data-filtro="' + id.slice(5) + '">' +
        '<option value="">' + (todos || 'Todos') + '</option>' + lista.map(function (x) {
          var v = typeof x === 'object' ? x.v : x, t = typeof x === 'object' ? x.label : (nomeDe ? nomeDe(x) : x);
          return '<option value="' + esc(v) + '"' + (valor === v ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select></label>';
    }
    var algum = f.loja || f.banco || f.vendedor || f.conta || f.sit;
    return '<div class="fatFiltros">' +
      sel('fatF_loja', 'Loja da proposta', f.loja, opcoes(pg.map(function (r) { return r.loja; })), loja) +
      sel('fatF_banco', 'Banco/Financeira', f.banco, opcoes(pg.map(function (r) { return r.banco; }))) +
      sel('fatF_conta', 'Conta que recebeu (loja)', f.conta, contas, loja, 'Todas') +
      sel('fatF_sit', 'Situação', f.sit, SITUACOES, null, 'Todas') +
      '<button type="button" class="modBtn modBtnGhost fatLimpar" data-acao="limpar"' + (algum ? '' : ' disabled') + '>Limpar filtros</button></div>';
  }
  function pagasResumoHtml() {
    var l = pagasFiltradas(), cred = 0, nCred = 0;
    l.forEach(function (r) { if (r.pagamento) { cred += Number(r.pagamento.valor_creditado || 0); nCred++; } });
    var faltam = l.filter(aCompletar).length, outras = l.filter(outraLoja).length;
    return '<section class="fatResumo fatResumoPagas">' +
      '<div class="fatAberto"><p class="fatRotulo">Pagos</p><p class="fatAbertoQtd">' + num(l.length) + '</p>' +
      '<p class="fatAbertoValor">' + esc(brl(soma(l))) + ' <span>financiados</span></p></div>' +
      '<div class="fatPagNums">' +
      '<button type="button" class="fatPagNum' + (S.filtros.sit === 'COMPLETAR' ? ' ativa' : '') + '" data-acao="sit" data-v="COMPLETAR"><b>' + num(faltam) + '</b><span>completar dados</span></button>' +
      '<div class="fatPagNum fatPagNumFixo"><b>' + num(nCred) + '</b><span>com dados · ' + esc(brl(cred)) + ' creditados</span></div>' +
      '<button type="button" class="fatPagNum fatPagNumOutra' + (S.filtros.sit === 'OUTRA' ? ' ativa' : '') + '" data-acao="sit" data-v="OUTRA"><b>' + num(outras) + '</b><span>na conta de outra loja</span></button>' +
      '</div></section>';
  }
  function creditoTxt(r) {
    var p = r.pagamento;
    if (!p) return '<span class="modMuted">—</span>';
    var dif = Number(p.diferenca || 0);
    return '<b>' + esc(brl2(p.valor_creditado)) + '</b>' + (dif ? '<br><small class="fatDif' + (dif < 0 ? ' neg' : '') + '">' + (dif > 0 ? '+' : '') + esc(brl2(dif)) + '</small>' : '');
  }
  function linhaPagaHtml(r) {
    var p = r.pagamento;
    return '<tr class="fatLinha fatLinhaPaga' + (aCompletar(r) ? ' fatFalta' : '') + '">' +
      '<td class="fatMono">' + esc(chassiDe(r)) + '<br>' + seloOrigem(r) + '</td>' +
      '<td class="fatCorta" title="' + esc(loja(r.loja)) + '">' + esc(loja(r.loja)) + '</td>' +
      '<td class="fatCorta" title="' + esc(r.banco || '—') + '">' + esc(r.banco || '—') + '</td>' +
      '<td class="fatNum">' + finTxt(r) + '</td>' +
      '<td class="fatNum">' + esc(data(r.faturamento)) + '</td>' +
      '<td class="fatNum">' + (p ? esc(data(p.data_credito)) : '<span class="modMuted">—</span>') + '</td>' +
      '<td class="fatCorta">' + (p ? esc(loja(p.conta_loja)) : '<span class="modMuted">—</span>') + '</td>' +
      '<td class="fatNum">' + creditoTxt(r) + '</td>' +
      '<td class="fatColJust">' + seloCompletar(r) + seloOutraLoja(r) + seloSubs(r) + (r.rebate ? '<span class="fatRebOk">Rebate ' + esc(brl2(r.rebate.valor)) + '</span>' : '') + '</td>' +
      '<td class="fatColAcao">' + botaoPag(r) + botaoReb(r) +
      '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '" aria-label="Mais detalhes da proposta ' + esc(chassiDe(r)) + '">+ detalhes</button></td></tr>';
  }
  function cartaoPagoHtml(r) {
    var p = r.pagamento;
    return '<li class="fatCartao fatCartaoPago' + (aCompletar(r) ? ' fatFalta' : '') + '"><div class="fatCartaoTopo"><span class="fatBadge fatPAGA">Paga</span>' +
      '<span class="fatCartaoDias">faturada ' + esc(data(r.faturamento)) + '</span></div>' +
      '<p class="fatCartaoModelo">' + esc(seLigado(r, r.modelo)) + '</p>' +
      '<p class="fatMono fatCartaoChassi">' + esc(chassiDe(r)) + ' ' + seloOrigem(r) + '</p>' +
      (aCompletar(r) || outraLoja(r) || r.subsidiado ? '<p class="fatCartaoJust">' + seloCompletar(r) + seloOutraLoja(r) + seloSubs(r) + '</p>' : '') +
      '<dl><div><dt>Loja</dt><dd>' + esc(loja(r.loja)) + '</dd></div><div><dt>Banco</dt><dd>' + esc(r.banco || '—') + '</dd></div>' +
      '<div><dt>Financiado</dt><dd>' + finTxt(r) + '</dd></div>' +
      '<div><dt>Crédito</dt><dd>' + (p ? esc(data(p.data_credito)) + ' · ' + esc(loja(p.conta_loja)) : '—') + '</dd></div>' +
      '<div><dt>Valor creditado</dt><dd>' + creditoTxt(r) + '</dd></div>' +
      (r.subsidiado ? '<div><dt>Rebate</dt><dd>' + (r.rebate ? esc(brl2(r.rebate.valor)) : '—') + '</dd></div>' : '') + '</dl>' +
      '<div class="fatCartaoAcoes">' + botaoPag(r) + botaoReb(r) + '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '">+ detalhes</button></div></li>';
  }
  function pagasListaHtml() {
    var lista = pagasFiltradas().slice().sort(function (a, b) {
      return (aCompletar(b) ? 1 : 0) - (aCompletar(a) ? 1 : 0) || String(b.faturamento).localeCompare(String(a.faturamento));
    });
    var tit = S.filtros.sit === 'COMPLETAR' ? 'Pagos — completar dados' : 'Pagos';
    var h = '<section class="fatLista"><h2 class="modSectionTitle">' + tit + ' <span class="modMuted">(' + lista.length + ')</span></h2>';
    if (!lista.length) return h + '<div class="modEmptyState">' + (S.filtros.sit === 'COMPLETAR' ? 'Nenhuma proposta paga com dados a completar.' : 'Nenhuma proposta paga com esses filtros.') + '</div></section>';
    h += '<div class="fatGrupo fatPagas"><div class="fatTabela"><table class="fatTab fatTabPagas"><colgroup><col class="pChassi"><col class="pLoja"><col class="pBanco">' +
      '<col class="pValor"><col class="pData"><col class="pData"><col class="pConta"><col class="pCred"><col class="pSit"><col class="pAcao"></colgroup>' +
      '<thead><tr><th>Chassi</th><th>Loja</th><th>Banco</th><th class="fatNum">Financiado</th><th class="fatNum">Faturamento</th>' +
      '<th class="fatNum">Crédito em</th><th>Conta (loja)</th><th class="fatNum">Valor creditado</th><th>Situação</th><th class="fatColAcao"><span class="fatSr">Ações</span></th></tr></thead><tbody>' +
      lista.map(linhaPagaHtml).join('') + '</tbody></table></div>' +
      '<ul class="fatCartoes">' + lista.map(cartaoPagoHtml).join('') + '</ul></div>';
    return h + '<p class="modMuted fatNota">Pagas segundo a atualização dos dados do banco, faturadas a partir de ' + esc(corteTxt()) + '. ' +
      'O Analista responsável da loja (ou o Master) preenche a data do crédito, a loja da conta que recebeu e o valor creditado; cada correção fica no histórico. ' +
      'Subsidiada = plano 999 nos dados do banco (quando o plano não foi identificado, a proposta não pede rebate).</p></section>';
  }
  // Master: soma do rebate das Subsidiadas por loja e mês de faturamento (só faturadas desde o corte)
  function rebateResumoHtml() {
    var rr = S.dados && S.dados.rebate_resumo;
    if (!Array.isArray(rr)) return '';
    var h = '<section class="fatBancos fatRebResumo"><h2 class="modSectionTitle">Rebate dos Subsidiados por loja e mês</h2>' +
      '<p class="modMuted">Soma do valor do rebate informado nas propostas Subsidiadas faturadas a partir de ' + esc(corteTxt()) + ' (mês da data de faturamento).</p>';
    if (!rr.length) return h + '<p class="modMuted">Nenhum rebate informado no período.</p></section>';
    var meses = opcoes(rr.map(function (x) { return x.mes; })).reverse(), lojas = opcoes(rr.map(function (x) { return x.loja; }));
    function v(l, m) { var x = rr.filter(function (y) { return y.loja === l && y.mes === m; })[0]; return x ? x : null; }
    function nomeMes(m) { var p = String(m).split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(p[1]) - 1] + '/' + p[0].slice(2); }
    var totMes = {}; meses.forEach(function (m) { totMes[m] = 0; });
    var corpo = lojas.map(function (l) {
      var tot = 0;
      return '<tr><th scope="row">' + esc(loja(l)) + '</th>' + meses.map(function (m) {
        var x = v(l, m); if (x) { tot += Number(x.total); totMes[m] += Number(x.total); }
        return '<td class="fatNum">' + (x ? esc(brl2(x.total)) + '<small> · ' + x.quantidade + '</small>' : '—') + '</td>';
      }).join('') + '<td class="fatNum"><b>' + esc(brl2(tot)) + '</b></td></tr>';
    }).join('');
    var geral = 0; meses.forEach(function (m) { geral += totMes[m]; });
    return h + '<div class="fatTabela fatRebTabela"><table class="fatTab"><thead><tr><th>Loja</th>' + meses.map(function (m) { return '<th class="fatNum">' + esc(nomeMes(m)) + '</th>'; }).join('') +
      '<th class="fatNum">Total</th></tr></thead><tbody>' + corpo + '</tbody><tfoot><tr><th scope="row">Grupo</th>' +
      meses.map(function (m) { return '<td class="fatNum"><b>' + esc(brl2(totMes[m])) + '</b></td>'; }).join('') + '<td class="fatNum"><b>' + esc(brl2(geral)) + '</b></td></tr></tfoot></table></div>' +
      '<p class="modMuted fatNota">Ao lado do valor: quantidade de propostas.</p></section>';
  }

  function filtrosHtml() {
    if (S.aba === 'pagas') return filtrosPagasHtml();
    var f = S.filtros, ab = (S.dados && S.dados.abertas) || [];
    function sel(id, rotulo, valor, lista, nomeDe, todos) {
      return '<label class="fatSel"><span>' + rotulo + '</span><select id="' + id + '" data-filtro="' + id.slice(5) + '">' +
        '<option value="">' + (todos || 'Todos') + '</option>' + lista.map(function (x) {
          var v = typeof x === 'object' ? x.v : x, t = typeof x === 'object' ? x.label : (nomeDe ? nomeDe(x) : x);
          return '<option value="' + esc(v) + '"' + (valor === v ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select></label>';
    }
    var algum = f.loja || f.banco || f.vendedor || f.faixa || f.just;
    return '<div class="fatFiltros">' +
      sel('fatF_loja', 'Loja', f.loja, opcoes(ab.map(function (r) { return r.loja; })), loja) +
      sel('fatF_banco', 'Banco/Financeira', f.banco, opcoes(ab.map(function (r) { return r.banco; }))) +
      sel('fatF_vendedor', 'Vendedor', f.vendedor, opcoes(ab.map(vendedorDe))) +
      sel('fatF_just', 'Justificativa', f.just, JUST_FILTRO, null, 'Todas') +
      '<button type="button" class="modBtn modBtnGhost fatLimpar" data-acao="limpar"' + (algum ? '' : ' disabled') + '>Limpar filtros</button></div>';
  }
  function resumoHtml() {
    var l = base(), total = soma(l), fx = S.filtros.faixa;
    var media = l.length ? l.reduce(function (s, r) { return s + Number(r.dias || 0); }, 0) / l.length : null;
    var cont = {}, val = {};
    BARRA.forEach(function (f) { cont[f] = 0; val[f] = 0; });
    l.forEach(function (r) { cont[r.faixa] = (cont[r.faixa] || 0) + 1; val[r.faixa] = (val[r.faixa] || 0) + Number(r.financiado || 0); });
    var info = {}; FAIXAS.forEach(function (x) { info[x.v] = x; });
    var barra = '<div class="fatBarra" role="group" aria-label="Propostas em aberto por faixa">' + BARRA.filter(function (f) { return cont[f] > 0; }).map(function (f) {
      return '<button type="button" class="fatBarSeg fat' + f + (fx === f ? ' ativa' : '') + (fx && fx !== f ? ' apagada' : '') + '" style="flex-grow:' + cont[f] + '"' +
        ' data-acao="faixa" data-v="' + f + '" aria-pressed="' + (fx === f) + '" title="' + esc(FAIXA_LABEL[f] + ': ' + cont[f]) + '">' +
        '<span class="fatSegNum">' + cont[f] + '</span></button>';
    }).join('') + (l.length ? '' : '<span class="fatBarraVazia">Nenhuma proposta em aberto</span>') + '</div>';
    var legenda = '<div class="fatLegenda">' + BARRA.map(function (f) {
      return '<button type="button" class="fatLeg fat' + f + (fx === f ? ' ativa' : '') + (fx && fx !== f ? ' apagada' : '') + '" data-acao="faixa" data-v="' + f + '" aria-pressed="' + (fx === f) + '">' +
        '<span class="fatLegNome"><i aria-hidden="true"></i>' + esc(FAIXA_LABEL[f]) + '</span>' +
        '<span class="fatLegQtd">' + num(cont[f]) + '<small> · ' + esc(brl(val[f])) + '</small></span>' +
        '<span class="fatLegDias">' + esc(info[f].dias) + '</span></button>';
    }).join('') + '</div>';
    return '<section class="fatResumo">' +
      '<div class="fatAberto"><p class="fatRotulo">Faturados</p><p class="fatAbertoQtd">' + num(l.length) + '</p>' +
      '<p class="fatAbertoValor">' + esc(brl(total)) + ' <span>financiados</span></p>' +
      '<p class="fatAbertoMedia">Média de <b>' + (media == null ? '—' : num(media, 1)) + '</b> dias úteis em aberto</p></div>' +
      '<div class="fatFaixas"><p class="fatRotulo">Por faixa' + (fx ? ' <button type="button" class="fatLink" data-acao="faixa" data-v="' + fx + '">mostrar todas</button>' : ' <span class="fatDica">clique numa faixa para filtrar</span>') + '</p>' +
      barra + legenda + '</div></section>';
  }
  function botaoJust(r, cls) {
    return podeJust(r) ? '<button type="button" class="fatJustBtn' + (cls ? ' ' + cls : '') + '" data-acao="justificar" data-id="' + esc(r._k) + '">Justificar demora</button>' : '';
  }
  function botaoRetorno(r, cls) {
    return podePedirRetorno(r) ? '<button type="button" class="fatRetBtn' + (cls ? ' ' + cls : '') + '" data-acao="retorno" data-id="' + esc(r._k) + '">Solicitar retorno urgente</button>' : '';
  }
  function botaoVincular(r, cls) {
    return !ligado(r) && pode('pode_vincular') ? '<button type="button" class="fatVincBtn' + (cls ? ' ' + cls : '') + '" data-acao="vincular" data-id="' + esc(r._k) + '">Vincular chassi</button>' : '';
  }
  // na linha: o Financeiro vê "Solicitar retorno" (não justifica); Master e Analistas veem "Justificar demora"
  function acoesLinha(r) { return botaoVincular(r) + (pode('pode_justificar') ? botaoJust(r) : botaoRetorno(r)) + botaoReb(r); }
  function linhaHtml(r) {
    return '<tr class="fatLinha fat' + r.faixa + '">' +
      '<td class="fatColDias"><b>' + esc(r.dias) + '</b></td>' +
      '<td class="fatMono">' + esc(chassiDe(r)) + '<br>' + seloOrigem(r) + '</td>' +
      '<td class="fatCorta" title="' + esc(seLigado(r, r.modelo)) + '">' + esc(seLigado(r, r.modelo)) + '</td>' +
      '<td class="fatCorta" title="' + esc(loja(r.loja)) + '">' + esc(loja(r.loja)) + '</td>' +
      '<td class="fatCorta" title="' + esc(r.banco || '—') + '">' + esc(r.banco || '—') + '</td>' +
      '<td class="fatNum">' + finTxt(r, brl) + '</td>' +
      '<td class="fatNum">' + esc(fatTxt(r)) + '</td>' +
      '<td class="fatColJust">' + seloJust(r) + seloRetorno(r) + seloCompletar(r) + seloSubs(r) + '</td>' +
      '<td class="fatColAcao">' + acoesLinha(r) +
      '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '" aria-label="Mais detalhes da proposta ' + esc(chassiDe(r)) + '">+ detalhes</button></td></tr>';
  }
  function cartaoHtml(r) {
    return '<li class="fatCartao fat' + r.faixa + '"><div class="fatCartaoTopo">' + badge(r.faixa) +
      '<span class="fatCartaoDias"><b>' + esc(r.dias) + '</b> dias úteis</span></div>' +
      '<p class="fatCartaoModelo">' + esc(seLigado(r, r.modelo)) + '</p>' +
      '<p class="fatMono fatCartaoChassi">' + esc(chassiDe(r)) + ' ' + seloOrigem(r) + '</p>' +
      (pedeJust(r) || r.retorno || aCompletar(r) || r.subsidiado ? '<p class="fatCartaoJust">' + (pedeJust(r) ? seloJust(r) : '') + seloRetorno(r) + seloCompletar(r) + seloSubs(r) + '</p>' : '') +
      '<dl><div><dt>Loja</dt><dd>' + esc(loja(r.loja)) + '</dd></div><div><dt>Banco</dt><dd>' + esc(r.banco || '—') + '</dd></div>' +
      '<div><dt>Financiado</dt><dd>' + finTxt(r, brl) + '</dd></div><div><dt>Faturamento</dt><dd>' + esc(fatTxt(r)) + '</dd></div>' +
      (r.subsidiado ? '<div><dt>Rebate</dt><dd>' + (r.rebate ? esc(brl2(r.rebate.valor)) : '—') + '</dd></div>' : '') + '</dl>' +
      '<div class="fatCartaoAcoes">' + acoesLinha(r) + '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '">+ detalhes</button></div></li>';
  }
  function listaHtml() {
    var lista = ordenar(filtradas());
    var h = '<section class="fatLista"><h2 class="modSectionTitle">Faturados <span class="modMuted">(' + lista.length + ')</span></h2>';
    if (!lista.length) return h + '<div class="modEmptyState">Nenhuma proposta faturada em aberto com esses filtros.</div></section>';
    FAIXAS.forEach(function (x) {
      var g = lista.filter(function (r) { return r.faixa === x.v; });
      if (!g.length) return;
      h += '<div class="fatGrupo fat' + x.v + '"><h3 class="fatGrupoTopo"><span class="fatGrupoNome"><i aria-hidden="true"></i>' + esc(x.label) +
        ' <small>' + esc(x.dias) + '</small></span><span class="fatGrupoTot">' + g.length + ' proposta' + (g.length > 1 ? 's' : '') + ' · ' + esc(brl(soma(g))) + '</span></h3>' +
        '<div class="fatTabela"><table class="fatTab"><colgroup><col class="cDias"><col class="cChassi"><col class="cModelo"><col class="cLoja"><col class="cBanco">' +
        '<col class="cValor"><col class="cData"><col class="cJust"><col class="cAcao"></colgroup>' +
        '<thead><tr><th class="fatColDias">Dias úteis</th><th>Chassi</th><th>Modelo</th><th>Loja</th><th>Banco</th><th class="fatNum">Financiado</th>' +
        '<th class="fatNum">Faturamento</th><th>Justificativa</th><th class="fatColAcao"><span class="fatSr">Ações</span></th></tr></thead><tbody>' +
        g.map(linhaHtml).join('') + '</tbody></table></div>' +
        '<ul class="fatCartoes">' + g.map(cartaoHtml).join('') + '</ul></div>';
    });
    var desde = S.dados.carga && S.dados.carga.primeira;
    return h + '<p class="modMuted fatNota">Data de faturamento: dia em que o faturamento da proposta foi identificado na atualização dos dados ' +
      '(os dados começam em ' + esc(data(desde)) + ' — "até" = já estava faturada no início). ' +
      'Ligação do chassi: <b>Documento</b> = mesmo CPF/CNPJ na venda (comparado de forma protegida); <b>Nome</b> = nome do cliente nos financiamentos; ' +
      '<b>Manual</b> = vinculado por um Master ou Analista. "Sem ligação": nenhuma das duas formas achou um único carro com segurança.</p></section>';
  }
  function bancosHtml() {
    var p = (S.dados && S.dados.pagas_por_banco) || [];
    var h = '<section class="fatBancos"><h2 class="modSectionTitle">Prazo médio de pagamento por banco</h2>' +
      '<p class="modMuted">Propostas já pagas no período: média de dias úteis entre o faturamento e o pagamento.</p>';
    if (!p.length) return h + '<p class="modMuted">Nenhuma proposta paga no período.</p></section>';
    return h + '<ul class="fatBancosLista">' + p.map(function (b) {
      return '<li><span class="fatCorta">' + esc(b.banco) + '</span><span class="fatNum">' + num(b.quantidade) + ' paga' + (Number(b.quantidade) === 1 ? '' : 's') + '</span>' +
        '<b class="fatNum">' + num(b.media_dias, 1) + ' <small>dias úteis</small></b></li>';
    }).join('') + '</ul></section>';
  }
  function historicoHtml(r) {
    var hst = S.hist[r.proposta];
    var h = '<section class="fatHist" aria-label="Histórico"><div class="fatHistTopo"><h3 class="fatHistTitulo">Histórico</h3>' +
      (ehPaga(r) ? '' : botaoJust(r, 'fatJustBtnForte') + botaoRetorno(r, 'fatRetBtnForte')) + '</div>';
    if (!hst || hst.carregando) return h + '<p class="modMuted">Carregando o histórico…</p></section>';
    if (hst.erro) return h + '<p class="fatErroForm">' + esc(hst.erro) + '</p></section>';
    var itens = [];
    (hst.justificativas || []).forEach(function (j) {
      itens.push({ em: j.criado_em, html: '<li><div class="fatHistCab"><b>' + esc(j.motivo) + '</b><span>' + esc(dataHora(j.criado_em)) + '</span></div>' +
        '<p class="fatHistTexto">' + esc(j.texto) + '</p><p class="fatHistAutor">' + esc(titulo(j.autor) || '—') + ' · ' + esc(titulo(j.perfil)) + '</p></li>' });
    });
    (hst.retornos || []).forEach(function (t) {
      itens.push({ em: t.solicitado_em, html: '<li class="fatHistRet"><div class="fatHistCab"><b>Retorno urgente solicitado' + (t.teste ? ' (teste)' : '') + '</b><span>' + esc(dataHora(t.solicitado_em)) + '</span></div>' +
        '<p class="fatHistTexto">' + (t.resposta ? 'Respondido por ' + esc(titulo(t.resposta.por)) + ' em ' + esc(dataHora(t.resposta.em)) + '.' :
          'Aguardando a justificativa do Analista responsável da loja.') + (t.email_erro ? ' O e-mail não saiu; o aviso no Portal foi criado.' : (t.email_enviado_em ? ' E-mail enviado.' : '')) + '</p>' +
        '<p class="fatHistAutor">' + esc(titulo(t.solicitado_por) || '—') + '</p></li>' });
    });
    (hst.vinculos || []).forEach(function (v) {
      itens.push({ em: v.em, html: '<li class="fatHistVinc"><div class="fatHistCab"><b>Chassi vinculado à mão</b><span>' + esc(dataHora(v.em)) + '</span></div>' +
        '<p class="fatHistTexto"><span class="fatMono">' + esc(v.chassi) + '</span> — ' + esc(v.motivo) + '</p>' +
        '<p class="fatHistAutor">' + esc(titulo(v.por) || '—') + ' · ' + esc(titulo(v.perfil)) + '</p></li>' });
    });
    (hst.pagamentos || []).forEach(function (p, i, l) {
      var dif = Number(p.diferenca || 0);
      itens.push({ em: p.em, html: '<li class="fatHistPag"><div class="fatHistCab"><b>' + (i < l.length - 1 ? 'Dados do crédito corrigidos' : 'Dados do crédito preenchidos') + '</b><span>' + esc(dataHora(p.em)) + '</span></div>' +
        '<p class="fatHistTexto">Crédito em ' + esc(dataLonga(p.data_credito)) + ' na conta da loja ' + esc(loja(p.conta_loja)) + ' · ' + esc(brl2(p.valor_creditado)) +
        (dif ? ' (diferença de ' + esc(brl2(dif)) + ': ' + esc(p.motivo || '—') + ')' : '') + (p.outra_loja ? ' · conta de outra loja' : '') + '</p>' +
        '<p class="fatHistAutor">' + esc(titulo(p.por) || '—') + ' · ' + esc(titulo(p.perfil)) + '</p></li>' });
    });
    (hst.rebates || []).forEach(function (b, i, l) {
      itens.push({ em: b.em, html: '<li class="fatHistReb"><div class="fatHistCab"><b>' + (i < l.length - 1 ? 'Rebate corrigido' : 'Rebate informado') + '</b><span>' + esc(dataHora(b.em)) + '</span></div>' +
        '<p class="fatHistTexto">Valor do rebate: ' + esc(brl2(b.valor)) + '</p><p class="fatHistAutor">' + esc(titulo(b.por) || '—') + ' · ' + esc(titulo(b.perfil)) + '</p></li>' });
    });
    if (!itens.length) return h + '<p class="modMuted">' + (ehPaga(r) ? 'Nenhum registro ainda.' : pedeJust(r) ? 'Nenhuma justificativa ainda.' : 'Propostas na faixa Normal não pedem justificativa.') + '</p></section>';
    itens.sort(function (a, b) { return String(b.em).localeCompare(String(a.em)); });
    return h + '<ol class="fatHistLista">' + itens.map(function (x) { return x.html; }).join('') + '</ol></section>';
  }
  function detalheHtml() {
    var r = S.detalhe && porChave(S.detalhe);
    if (!r) return '';
    var identificado = (r.faturamento_desde_inicio ? 'até ' : '') + dataLonga(r.faturamento) + (r.faturamento_desde_inicio ? ' (início dos dados)' : '');
    function item(rot, v) { return '<div><dt>' + rot + '</dt><dd>' + v + '</dd></div>'; }
    // bloco do pagamento e do rebate (só o que é desde o corte)
    var p = r.pagamento, blocos = '';
    if (ehPaga(r)) {
      blocos += '<section class="fatDetBloco"><div class="fatHistTopo"><h3 class="fatHistTitulo">Crédito na conta</h3>' + botaoPag(r, 'fatPagBtnForte') + '</div>' +
        (p ? '<dl class="fatDetLista">' + item('Data do crédito', esc(dataLonga(p.data_credito))) + item('Conta que recebeu (loja)', esc(loja(p.conta_loja))) +
          item('Valor creditado', esc(brl2(p.valor_creditado))) + item('Valor financiado', esc(brl2(p.valor_esperado))) +
          (Number(p.diferenca) ? item('Diferença', esc(brl2(p.diferenca))) + item('Motivo', esc(p.motivo || '—')) : '') +
          item('Preenchido por', esc(titulo(p.por) || '—') + ' <small>' + esc(dataHora(p.em)) + '</small>') + '</dl>'
          : '<p class="fatDetFalta">' + seloCompletar(r) + ' Faltam a data do crédito, a loja da conta que recebeu e o valor creditado.</p>') + '</section>';
    }
    if (r.subsidiado) {
      blocos += '<section class="fatDetBloco"><div class="fatHistTopo"><h3 class="fatHistTitulo">Rebate (Subsidiada)</h3>' + botaoReb(r, 'fatRebBtnForte') + '</div>' +
        (r.rebate ? '<dl class="fatDetLista">' + item('Valor do rebate', esc(brl2(r.rebate.valor))) +
          item('Informado por', esc(titulo(r.rebate.por) || '—') + ' <small>' + esc(dataHora(r.rebate.em)) + '</small>') + '</dl>'
          : '<p class="fatDetFalta">' + seloCompletar(r) + ' Falta o valor do rebate.</p>') + '</section>';
    }
    if (ehPaga(r)) {
      return '<div class="fatVeu" data-acao="fechar"></div>' +
        '<aside class="fatDetalhe fatDetPaga" role="dialog" aria-modal="true" aria-labelledby="fatDetTitulo">' +
        '<div class="fatDetTopo"><div><p class="modEyebrow">Proposta paga</p><h2 id="fatDetTitulo" class="fatDetTitulo">' + esc(r.cliente || '—') + '</h2></div>' +
        '<button type="button" class="fatFechar" data-acao="fechar" aria-label="Fechar detalhes">×</button></div>' +
        (aCompletar(r) || outraLoja(r) || r.subsidiado ? '<div class="fatDetJust">' + seloCompletar(r) + seloOutraLoja(r) + seloSubs(r) + '</div>' : '') +
        blocos +
        '<dl class="fatDetLista">' +
        item('Cliente', esc(r.cliente || '—')) + item('Vendedor', esc(vendedorDe(r))) +
        item('Data de inclusão', esc(dataLonga(r.inclusao))) + item('Data de faturamento', esc(dataLonga(r.faturamento))) +
        item('Pagamento identificado em', esc(dataLonga(r.pagamento_relatorio))) +
        item('Chassi', '<span class="fatMono">' + esc(chassiDe(r)) + '</span>') + item('Ligação do chassi', seloOrigem(r)) +
        item('Modelo', esc(seLigado(r, r.modelo))) + item('Loja', esc(loja(r.loja))) + item('Banco/Financeira', esc(r.banco || '—')) +
        item('Valor financiado', finTxt(r)) + item('Total financiado (com tarifas)', esc(brl2(r.financiado_base03))) + '</dl>' + historicoHtml(r) + '</aside>';
    }
    return '<div class="fatVeu" data-acao="fechar"></div>' +
      '<aside class="fatDetalhe fat' + r.faixa + '" role="dialog" aria-modal="true" aria-labelledby="fatDetTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">Proposta faturada em aberto</p><h2 id="fatDetTitulo" class="fatDetTitulo">' + esc(r.cliente || '—') + '</h2></div>' +
      '<button type="button" class="fatFechar" data-acao="fechar" aria-label="Fechar detalhes">×</button></div>' +
      '<div class="fatDetDestaque"><b>' + esc(r.dias) + '</b><span>dias úteis em aberto</span>' + badge(r.faixa) + '</div>' +
      (pedeJust(r) || r.retorno ? '<div class="fatDetJust">' + (pedeJust(r) ? seloJust(r) : '') + seloRetorno(r) + '</div>' : '') +
      (!ligado(r) ? '<div class="fatDetSemLig"><p>Sem ligação segura com um chassi: ' + esc(SEM_LIGACAO_TXT[r.sem_ligacao] || 'conferir') + '.</p>' + botaoVincular(r, 'fatVincBtnForte') + '</div>' : '') +
      '<dl class="fatDetLista">' +
      item('Cliente', esc(r.cliente || '—')) +
      item('Vendedor', esc(vendedorDe(r))) +
      item('Data de inclusão', esc(dataLonga(r.inclusao))) +
      item('Data de faturamento', esc((r.faturamento_desde_inicio ? 'até ' : '') + dataLonga(r.faturamento))) +
      item('Chassi', '<span class="fatMono">' + esc(chassiDe(r)) + '</span>') +
      item('Ligação do chassi', seloOrigem(r) + (r.ligacao_origem === 'MANUAL' && r.vinculo_manual ? ' <small>' + esc(titulo(r.vinculo_manual.por)) + ' · ' + esc(dataHora(r.vinculo_manual.em)) + '</small>' : '')) +
      item('Modelo', esc(seLigado(r, r.modelo))) +
      item('Loja', esc(loja(r.loja))) +
      item('Banco/Financeira', esc(r.banco || '—')) +
      item('Valor financiado', finTxt(r)) +
      item('Total financiado (com tarifas)', esc(brl2(r.financiado_base03))) +
      item('Dias úteis em aberto', esc(r.dias)) +
      item('Faixa', badge(r.faixa)) +
      item('Faturamento identificado em', esc(identificado)) +
      '</dl>' + blocos + historicoHtml(r) + '</aside>';
  }
  function formHtml() {
    var F = S.form, r = F && porChave(F.k);
    if (!r) return '';
    var n = (F.texto || '').trim().length;
    return '<div class="fatVeu" data-acao="cancelar"></div>' +
      '<aside class="fatDetalhe fatForm fat' + r.faixa + '" role="dialog" aria-modal="true" aria-labelledby="fatFormTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">Justificar demora</p><h2 id="fatFormTitulo" class="fatDetTitulo">' + esc(tituloForm(r)) + '</h2>' +
      '<p class="fatFormSub"><span class="fatMono">' + esc(chassiDe(r)) + '</span> · ' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + '</p></div>' +
      '<button type="button" class="fatFechar" data-acao="cancelar" aria-label="Fechar sem salvar">×</button></div>' +
      '<div class="fatDetDestaque"><b>' + esc(r.dias) + '</b><span>dias úteis em aberto</span>' + badge(r.faixa) + '</div>' +
      '<form class="fatFormCorpo" novalidate>' +
      '<fieldset class="fatMotivos"><legend>Motivo</legend>' + MOTIVOS.map(function (m, i) {
        return '<label class="fatMotivo"><input type="radio" name="fatMotivo" value="' + esc(m) + '"' + (F.motivo === m ? ' checked' : '') + (i === 0 ? ' id="fatMotivo0"' : '') + '><span>' + esc(m) + '</span></label>';
      }).join('') + '</fieldset>' +
      '<label class="fatTextoRot" for="fatTexto">O que está acontecendo <span>(mínimo de ' + MIN_TEXTO + ' caracteres)</span></label>' +
      '<textarea id="fatTexto" rows="5" maxlength="2000" aria-describedby="fatContador">' + esc(F.texto || '') + '</textarea>' +
      '<p id="fatContador" class="fatContador' + (n >= MIN_TEXTO ? ' ok' : '') + '">' + n + ' de ' + MIN_TEXTO + ' caracteres</p>' +
      (F.erro ? '<p class="fatErroForm" role="alert">' + esc(F.erro) + '</p>' : '') +
      '<p class="modMuted fatFormNota">A justificativa fica no histórico da proposta com o seu nome, a data e a hora. Ela não pode ser editada nem apagada; para atualizar, registre uma nova.</p>' +
      '<div class="fatFormAcoes"><button type="button" class="modBtn modBtnGhost" data-acao="cancelar">Cancelar</button>' +
      '<button type="submit" class="modBtn modBtnPrimary" data-acao="salvar"' + (F.salvando ? ' disabled' : '') + '>' + (F.salvando ? 'Salvando…' : 'Salvar justificativa') + '</button></div>' +
      '</form></aside>';
  }
  function retornoHtml() {
    var F = S.ret, r = F && porChave(F.k);
    if (!r) return '';
    return '<div class="fatVeu" data-acao="cancelar"></div>' +
      '<aside class="fatDetalhe fatForm fat' + r.faixa + '" role="dialog" aria-modal="true" aria-labelledby="fatRetTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">Solicitar retorno urgente</p><h2 id="fatRetTitulo" class="fatDetTitulo">' + esc(tituloForm(r)) + '</h2>' +
      '<p class="fatFormSub"><span class="fatMono">' + esc(chassiDe(r)) + '</span> · ' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + '</p></div>' +
      '<button type="button" class="fatFechar" data-acao="cancelar" aria-label="Fechar sem pedir">×</button></div>' +
      '<div class="fatDetDestaque"><b>' + esc(r.dias) + '</b><span>dias úteis em aberto</span>' + badge(r.faixa) + '</div>' +
      '<div class="fatFormCorpo">' +
      '<p>O <b>Analista responsável da loja ' + esc(loja(r.loja)) + '</b> recebe um e-mail com o chassi, o modelo, a loja, o banco, o valor e os dias em aberto ' +
      '(sem CPF e sem nome do cliente) e vê um aviso no Portal a cada acesso, até registrar a justificativa.</p>' +
      '<p class="modMuted">O pedido fica registrado com o seu nome, a data e a hora.</p>' +
      (F.erro ? '<p class="fatErroForm" role="alert">' + esc(F.erro) + '</p>' : '') +
      '<div class="fatFormAcoes"><button type="button" class="modBtn modBtnGhost" data-acao="cancelar">Cancelar</button>' +
      '<button type="button" class="modBtn modBtnPrimary" data-acao="confirmarRetorno"' + (F.enviando ? ' disabled' : '') + '>' + (F.enviando ? 'Enviando…' : 'Pedir retorno urgente') + '</button></div>' +
      '</div></aside>';
  }
  function vincularHtml() {
    var F = S.vinc, r = F && porChave(F.k);
    if (!r) return '';
    var n = (F.motivo || '').trim().length;
    var lista = F.carregando ? '<p class="modMuted">Buscando as vendas da loja perto da data da proposta…</p>' :
      (F.candidatos && F.candidatos.length ? '<fieldset class="fatMotivos fatCandidatos"><legend>Vendas da loja ' + esc(loja(r.loja)) + ' (15 dias antes a 60 dias depois da inclusão)</legend>' +
        F.candidatos.map(function (c, i) {
          return '<label class="fatMotivo fatCand"><input type="radio" name="fatCand" value="' + esc(c.chassi) + '"' + (F.chassi === c.chassi ? ' checked' : '') + (i === 0 ? ' id="fatCand0"' : '') + '>' +
            '<span><b class="fatMono">' + esc(c.chassi) + '</b> · ' + esc(c.modelo || '—') + '<small> · venda ' + esc(dataLonga(c.data_venda)) + ' · ' + esc(titulo(c.vendedor) || '—') + '</small></span></label>';
        }).join('') + '</fieldset>' : '<p class="modMuted">Nenhuma venda da loja nesse intervalo. Digite o chassi abaixo.</p>');
    return '<div class="fatVeu" data-acao="cancelar"></div>' +
      '<aside class="fatDetalhe fatForm fat' + r.faixa + '" role="dialog" aria-modal="true" aria-labelledby="fatVincTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">Vincular chassi</p><h2 id="fatVincTitulo" class="fatDetTitulo">' + esc(r.cliente || '—') + '</h2>' +
      '<p class="fatFormSub">' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + ' · ' + finTxt(r, brl) + ' · inclusão ' + esc(dataLonga(r.inclusao)) + '</p></div>' +
      '<button type="button" class="fatFechar" data-acao="cancelar" aria-label="Fechar sem salvar">×</button></div>' +
      '<form class="fatFormCorpo fatVincCorpo" novalidate>' + lista +
      '<label class="fatTextoRot" for="fatVincChassi">Chassi <span>(17 caracteres; precisa estar nas vendas)</span></label>' +
      '<input id="fatVincChassi" class="fatMono" maxlength="17" autocomplete="off" value="' + esc(F.chassi || '') + '">' +
      '<label class="fatTextoRot" for="fatVincMotivo">Motivo <span>(mínimo de ' + MIN_MOTIVO + ' caracteres)</span></label>' +
      '<textarea id="fatVincMotivo" rows="3" maxlength="500" aria-describedby="fatVincCont">' + esc(F.motivo || '') + '</textarea>' +
      '<p id="fatVincCont" class="fatContador' + (n >= MIN_MOTIVO ? ' ok' : '') + '">' + n + ' de ' + MIN_MOTIVO + ' caracteres</p>' +
      (F.erro ? '<p class="fatErroForm" role="alert">' + esc(F.erro) + '</p>' : '') +
      '<p class="modMuted fatFormNota">O vínculo fica registrado com o seu nome, a data, a hora e o motivo, e passa a valer para todos. Para corrigir, registre um novo.</p>' +
      '<div class="fatFormAcoes"><button type="button" class="modBtn modBtnGhost" data-acao="cancelar">Cancelar</button>' +
      '<button type="button" class="modBtn modBtnPrimary" data-acao="salvarVinculo"' + (F.salvando ? ' disabled' : '') + '>' + (F.salvando ? 'Salvando…' : 'Salvar vínculo') + '</button></div>' +
      '</form></aside>';
  }
  // formulário dos dados do crédito (PAGAS desde o corte): data (hoje; não aceita futura), loja da conta (já com a da proposta), valor (já com o financiado)
  function difPag(F, r) { var v = lerDinheiro(F.valor); return v == null ? null : Math.round((v - Number(r.financiado || 0)) * 100) / 100; }
  function difTxt(d) { return d == null ? 'Valor inválido' : d === 0 ? 'Igual ao valor financiado' : 'Diferença de ' + brl2(d) + ' em relação ao valor financiado'; }
  function pagHtml() {
    var F = S.pag, r = F && porChave(F.k);
    if (!r) return '';
    var contas = (S.dados && S.dados.contas) || [], d = difPag(F, r), outra = F.conta && F.conta !== r.loja;
    return '<div class="fatVeu" data-acao="cancelar"></div>' +
      '<aside class="fatDetalhe fatForm fatFormPag" role="dialog" aria-modal="true" aria-labelledby="fatPagTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">' + (r.pagamento ? 'Corrigir dados do crédito' : 'Dados do crédito') + '</p><h2 id="fatPagTitulo" class="fatDetTitulo">' + esc(tituloForm(r)) + '</h2>' +
      '<p class="fatFormSub"><span class="fatMono">' + esc(chassiDe(r)) + '</span> · ' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + ' · financiado ' + finTxt(r) + '</p></div>' +
      '<button type="button" class="fatFechar" data-acao="cancelar" aria-label="Fechar sem salvar">×</button></div>' +
      '<form class="fatFormCorpo fatPagCorpo" novalidate>' +
      '<label class="fatTextoRot" for="fatPagData">Data do crédito</label>' +
      '<input type="date" id="fatPagData" class="fatCampo" max="' + esc(S.hoje) + '" value="' + esc(F.data) + '" required>' +
      '<label class="fatTextoRot" for="fatPagConta">Conta que recebeu (loja)</label>' +
      '<select id="fatPagConta" class="fatCampo">' + contas.map(function (c) {
        return '<option value="' + esc(c) + '"' + (F.conta === c ? ' selected' : '') + '>' + esc(loja(c)) + (c === r.loja ? ' — loja da proposta' : '') + '</option>';
      }).join('') + '</select>' +
      '<p id="fatPagOutra" class="fatOutraLoja fatOutraForm"' + (outra ? '' : ' hidden') + '>Pago na conta de outra loja: <b>' + esc(loja(F.conta)) + '</b></p>' +
      '<label class="fatTextoRot" for="fatPagValor">Valor creditado (R$)</label>' +
      '<input id="fatPagValor" class="fatCampo fatNumCampo" inputmode="decimal" autocomplete="off" value="' + esc(F.valor) + '" aria-describedby="fatPagDif">' +
      '<p id="fatPagDif" class="fatContador' + (d === 0 ? ' ok' : d == null ? '' : ' fatDifAviso') + '">' + esc(difTxt(d)) + '</p>' +
      '<div id="fatPagMotivoBox"' + (d ? '' : ' hidden') + '><label class="fatTextoRot" for="fatPagMotivo">Motivo da diferença <span>(obrigatório; mínimo de 5 caracteres)</span></label>' +
      '<textarea id="fatPagMotivo" rows="2" maxlength="300">' + esc(F.motivo || '') + '</textarea></div>' +
      (F.erro ? '<p class="fatErroForm" role="alert">' + esc(F.erro) + '</p>' : '') +
      '<p class="modMuted fatFormNota">Fica registrado com o seu nome, a data e a hora. ' + (r.pagamento ? 'A versão anterior continua no histórico.' : 'Para corrigir depois, use "Corrigir dados do crédito"; a versão anterior fica no histórico.') + '</p>' +
      '<div class="fatFormAcoes"><button type="button" class="modBtn modBtnGhost" data-acao="cancelar">Cancelar</button>' +
      '<button type="submit" class="modBtn modBtnPrimary" data-acao="salvarPag"' + (F.salvando ? ' disabled' : '') + '>' + (F.salvando ? 'Salvando…' : 'Salvar dados do crédito') + '</button></div>' +
      '</form></aside>';
  }
  function rebHtml() {
    var F = S.reb, r = F && porChave(F.k);
    if (!r) return '';
    return '<div class="fatVeu" data-acao="cancelar"></div>' +
      '<aside class="fatDetalhe fatForm fatFormReb" role="dialog" aria-modal="true" aria-labelledby="fatRebTitulo">' +
      '<div class="fatDetTopo"><div><p class="modEyebrow">' + (r.rebate ? 'Corrigir rebate' : 'Rebate da Subsidiada') + '</p><h2 id="fatRebTitulo" class="fatDetTitulo">' + esc(tituloForm(r)) + '</h2>' +
      '<p class="fatFormSub"><span class="fatMono">' + esc(chassiDe(r)) + '</span> · ' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + ' · financiado ' + finTxt(r) + '</p></div>' +
      '<button type="button" class="fatFechar" data-acao="cancelar" aria-label="Fechar sem salvar">×</button></div>' +
      '<form class="fatFormCorpo fatRebCorpo" novalidate>' +
      '<label class="fatTextoRot" for="fatRebValor">Valor do rebate (R$)</label>' +
      '<input id="fatRebValor" class="fatCampo fatNumCampo" inputmode="decimal" autocomplete="off" value="' + esc(F.valor) + '" required>' +
      (F.erro ? '<p class="fatErroForm" role="alert">' + esc(F.erro) + '</p>' : '') +
      '<p class="modMuted fatFormNota">Proposta Subsidiada (plano 999). Fica registrado com o seu nome, a data e a hora; uma correção não apaga o valor anterior, que continua no histórico.</p>' +
      '<div class="fatFormAcoes"><button type="button" class="modBtn modBtnGhost" data-acao="cancelar">Cancelar</button>' +
      '<button type="submit" class="modBtn modBtnPrimary" data-acao="salvarReb"' + (F.salvando ? ' disabled' : '') + '>' + (F.salvando ? 'Salvando…' : 'Salvar rebate') + '</button></div>' +
      '</form></aside>';
  }
  function abrirPag(k) {
    var r = porChave(k); if (!r) return;
    var p = r.pagamento;
    S.pag = { k: k, data: p ? p.data_credito : S.hoje, conta: p ? p.conta_loja : r.loja, valor: dinheiroTxt(p ? p.valor_creditado : r.financiado),
              motivo: p && p.motivo ? p.motivo : '', erro: null, salvando: false, deDetalhe: S.detalhe || null, focar: '#fatPagData' };
    S.detalhe = null; S.aviso = null; render();
  }
  function salvarPag() {
    var F = S.pag, r = F && porChave(F.k);
    if (!r || F.salvando) return;
    var v = lerDinheiro(F.valor), d = difPag(F, r), m = (F.motivo || '').trim();
    if (!F.data) { F.erro = 'Informe a data do crédito.'; F.focar = '#fatPagData'; render(); return; }
    if (F.data > S.hoje) { F.erro = 'A data do crédito não pode ser futura.'; F.focar = '#fatPagData'; render(); return; }
    if (!F.conta) { F.erro = 'Escolha a loja da conta que recebeu.'; F.focar = '#fatPagConta'; render(); return; }
    if (v == null || v <= 0) { F.erro = 'Informe o valor creditado (ex.: 85.000,00).'; F.focar = '#fatPagValor'; render(); return; }
    if (d && m.length < 5) { F.erro = 'O valor é diferente do financiado: escreva o motivo (pelo menos 5 caracteres).'; F.focar = '#fatPagMotivo'; render(); return; }
    F.salvando = true; F.erro = null; render();
    rpc('fat_pagamento_registrar', { p_proposta: r.proposta, p_data_credito: F.data, p_conta_loja: F.conta, p_valor_creditado: v, p_motivo: d ? m : null }).then(function (res) {
      S.pag = null; S.detalhe = r._k; S.focarFechar = true;
      S.aviso = 'Dados do crédito registrados' + (res && res.outra_loja ? ' — pago na conta de outra loja.' : '.');
      delete S.hist[r.proposta]; carregarHistorico(r); render();
      return carregar(true);
    }).catch(function (e) {
      if (!S.pag) return;
      S.pag.salvando = false; S.pag.erro = (e && e.message) || 'Não foi possível salvar agora.'; render();
    });
  }
  function abrirReb(k) {
    var r = porChave(k); if (!r) return;
    S.reb = { k: k, valor: r.rebate ? dinheiroTxt(r.rebate.valor) : '', erro: null, salvando: false, deDetalhe: S.detalhe || null, focar: '#fatRebValor' };
    S.detalhe = null; S.aviso = null; render();
  }
  function salvarReb() {
    var F = S.reb, r = F && porChave(F.k);
    if (!r || F.salvando) return;
    var v = lerDinheiro(F.valor);
    if (v == null || v <= 0) { F.erro = 'Informe o valor do rebate (ex.: 3.500,00).'; F.focar = '#fatRebValor'; render(); return; }
    F.salvando = true; F.erro = null; render();
    rpc('fat_rebate_registrar', { p_proposta: r.proposta, p_valor: v }).then(function () {
      S.reb = null; S.detalhe = r._k; S.focarFechar = true; S.aviso = 'Valor do rebate registrado.';
      delete S.hist[r.proposta]; carregarHistorico(r); render();
      return carregar(true);
    }).catch(function (e) {
      if (!S.reb) return;
      S.reb.salvando = false; S.reb.erro = (e && e.message) || 'Não foi possível salvar agora.'; render();
    });
  }

  function render() {
    if (!outletRef) return;
    var corpo;
    if (S.erro) corpo = topoHtml() + '<div class="modErrorState">' + esc(S.erro) + ' <button type="button" class="modBtn modBtnSecondary" data-acao="recarregar">Tentar novamente</button></div>';
    else if (!S.dados) corpo = topoHtml() + '<div class="modLoadingState">Carregando…</div>';
    else {
      corpo = topoHtml() + periodoHtml() + abasHtml() + filtrosHtml() + (S.msg ? '<div class="modErrorState" role="status">' + esc(S.msg) + '</div>' : '') +
        (S.aviso ? '<div class="fatOk" role="status">' + esc(S.aviso) + '</div>' : '') +
        (S.carregando ? '<div class="modLoadingState fatAtualizando">Atualizando…</div>' : '') +
        (S.aba === 'pagas' ? pagasResumoHtml() + pagasListaHtml() : resumoHtml() + listaHtml() + bancosHtml()) + rebateResumoHtml() +
        (S.form ? formHtml() : S.ret ? retornoHtml() : S.vinc ? vincularHtml() : S.pag ? pagHtml() : S.reb ? rebHtml() : detalheHtml());
    }
    var aberto = !!(S.form || S.detalhe || S.ret || S.vinc || S.pag || S.reb);
    var manter = chaveDoFoco();
    outletRef.innerHTML = '<div class="fatPage' + (aberto ? ' fatComDetalhe' : '') + '">' + corpo + '</div>';
    if (manter) { var de = outletRef.querySelector(manter); if (de) de.focus(); }
    var Fo = S.form || S.vinc || S.pag || S.reb;
    if (Fo && Fo.focar) { var alvo = outletRef.querySelector(Fo.focar); if (alvo) alvo.focus(); Fo.focar = null; }
    else if (aberto && S.focarFechar) { var bt = outletRef.querySelector('.fatFechar'); if (bt) bt.focus(); S.focarFechar = false; }
  }

  // ao redesenhar (ex.: o histórico chegou), devolve o foco ao mesmo controle, para não perder o lugar de quem usa teclado
  function chaveDoFoco() {
    var el = document.activeElement;
    if (!el || !outletRef || !outletRef.contains(el) || el === document.body) return null;
    if (el.id) return '#' + el.id;
    var dentro = el.closest('.fatDetalhe') ? '.fatDetalhe ' : '';
    if (el.classList.contains('fatFechar')) return dentro + '.fatFechar';
    var a = el.getAttribute('data-acao');
    if (!a) return null;
    return dentro + '[data-acao="' + a + '"]' + (el.getAttribute('data-id') ? '[data-id="' + el.getAttribute('data-id') + '"]' : '') + (el.getAttribute('data-v') ? '[data-v="' + el.getAttribute('data-v') + '"]' : '');
  }

  // ---------------------------------------------------------------- ações
  function carregar(silencioso) {
    if (!silencioso) { S.carregando = true; S.msg = null; render(); }
    var iv = intervalo();
    var pedidos = [buscar(iv.ini, iv.fim)];
    if (!S.todas) pedidos.push((iv.ini || iv.fim) ? buscar(null, null) : null);
    return Promise.all(pedidos).then(function (res) {
      S.dados = res[0] || { abertas: [], pagas_por_banco: [] };
      (S.dados.abertas || []).forEach(function (r) { r._k = String(r.proposta); });
      (S.dados.pagas_corte || []).forEach(function (r) { r._k = String(r.proposta); });
      S.hoje = (S.dados.carga && S.dados.carga.hoje) || iso(new Date());
      // 1ª carga: quem preenche e tem pagas a completar já vê a lista "Pagas — completar dados"
      if (!S.abaEscolhida) {
        S.abaEscolhida = true;
        if ((S.dados.pagas_corte || []).some(function (r) { return r.pode_preencher && aCompletar(r); })) { S.aba = 'pagas'; S.filtros.sit = 'COMPLETAR'; }
      }
      if (!S.todas) S.todas = (res[1] || S.dados).abertas || [];
      if (S.detalhe && !porChave(S.detalhe)) S.detalhe = null;
      // link do e-mail / do aviso: ?proposta=X abre o detalhe dessa proposta (uma vez) e sai da barra de endereço
      if (S.abrir) {
        var alvo = porChave(S.abrir);
        if (!alvo && S.filtros.periodo !== 'tudo' && (S.todas || []).some(function (x) { return String(x.proposta) === S.abrir; })) {
          S.filtros.periodo = 'tudo'; S.carregando = false; return carregar(true);
        }
        S.abrir = null;
        if (alvo) { S.detalhe = alvo._k; S.focarFechar = true; carregarHistorico(alvo); }
      }
      S.erro = null; S.carregando = false; render();
    }).catch(function (e) {
      S.carregando = false;
      if (e && e.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && window.NX_AUTH_CORE.reportSessionExpired) { window.NX_AUTH_CORE.reportSessionExpired(); return; }
      if (S.dados && e && e.state === 'VALIDATION') S.msg = e.message; else S.erro = (e && e.message) || 'Não foi possível carregar agora.';
      render();
    });
  }
  function carregarHistorico(r) {
    S.hist[r.proposta] = { carregando: true };
    return rpc('faturamentos_historico2', { p_proposta: r.proposta }).then(function (h) {
      S.hist[r.proposta] = { justificativas: (h && h.justificativas) || [], retornos: (h && h.retornos) || [], vinculos: (h && h.vinculos) || [],
                             pagamentos: (h && h.pagamentos) || [], rebates: (h && h.rebates) || [] };
      if (S.detalhe === r._k) render();
    }).catch(function (e) {
      S.hist[r.proposta] = { erro: (e && e.message) || 'Não foi possível carregar o histórico.' };
      if (S.detalhe === r._k) render();
    });
  }
  function exportar() {
    var H = window.NX_XLSX_EXPORT_HELPER;
    if (!H || !window.XLSX || !S.dados || S.dados.pode_exportar !== true || S.exportando) return;
    var ePagas = S.aba === 'pagas';
    var quais = {}; (ePagas ? pagasFiltradas() : filtradas()).forEach(function (r) { quais[r.proposta] = true; });
    var iv = intervalo();
    S.exportando = true; render();
    // o arquivo sai de faturamentos_exportar2 (só Master e Financeiro), que registra quem, quando e com quais filtros
    var f = S.filtros;
    rpc('faturamentos_exportar2', { p_ini: iv.ini || null, p_fim: iv.fim || null, p_propostas: Object.keys(quais), p_situacao: ePagas ? 'PAGAS' : 'ABERTAS',
      p_filtros: ePagas ? { periodo: f.periodo, loja: f.loja || '', banco: f.banco || '', conta: f.conta || '', outra_loja: f.sit === 'OUTRA' ? 'true' : '', situacao: f.sit || '' }
                        : { periodo: f.periodo, loja: f.loja || '', banco: f.banco || '', vendedor: f.vendedor || '', faixa: f.faixa || '', justificativa: f.just || '' } }).then(function (d) {
      var lista = (Array.isArray(d) ? d : []).filter(function (r) { return quais[r.proposta]; });
      lista = ePagas ? lista.sort(function (a, b) { return String(b.faturamento).localeCompare(String(a.faturamento)); }) : ordenar(lista);
      if (!lista.length) { S.exportando = false; render(); return; }
      // colunas novas (12/11/2026): preenchidas só para faturadas a partir do corte
      var headers = ['Chassi', 'Ligação do chassi', 'Nome do cliente', 'Modelo', 'Loja', 'Vendedor', 'Banco/financeira', 'Valor financiado', 'Total financiado (com tarifas)', 'Data de inclusão',
                     'Data de faturamento', 'Situação', 'Dias úteis em aberto', 'Faixa', 'Nº da proposta',
                     'Data do crédito', 'Conta (loja)', 'Valor creditado', 'Diferença', 'Motivo', 'Valor do rebate', 'Completar dados'];
      var linhas = lista.map(function (r) {
        var p = r.pagamento, paga = ehPaga(r);
        return [chassiDe(r), ligado(r) ? (ORIGEM[r.ligacao_origem] || r.ligacao_origem) : 'Sem ligação', r.cliente || '', seLigado(r, r.modelo), loja(r.loja), vendedorDe(r), r.banco || '',
                Number(r.financiado) || 0, Number(r.financiado_base03 != null ? r.financiado_base03 : r.financiado) || 0, H.excelDateValue(r.inclusao) || '', H.excelDateValue(r.faturamento) || '', paga ? 'Paga' : 'Em aberto',
                paga ? '' : (Number(r.dias) || 0), paga ? '' : (FAIXA_LABEL[r.faixa] || r.faixa), r.proposta || '',
                p ? (H.excelDateValue(p.data_credito) || '') : '', p ? loja(p.conta_loja) + (p.outra_loja ? ' (outra loja)' : '') : '',
                p ? Number(p.valor_creditado) : '', p ? Number(p.diferenca || 0) : '', p && p.motivo ? p.motivo : '',
                r.rebate ? Number(r.rebate.valor) : '', aCompletar(r) ? 'Sim' : ''];
      });
      var nome = ePagas ? 'Faturamentos pagos' : 'Faturamentos em aberto';
      H.downloadWorkbook(headers, linhas, nome, nome.replace(/ /g, '_') + '_' + H.excelFileStamp() + '.xlsx', {
        moneyCols: new Set(['Valor financiado', 'Total financiado (com tarifas)', 'Valor creditado', 'Diferença', 'Valor do rebate']), pctCols: new Set(),
        dateCols: new Set(['Data de inclusão', 'Data de faturamento', 'Data do crédito']),
        intCols: new Set(['Dias úteis em aberto']),
        textCols: new Set(['Chassi', 'Ligação do chassi', 'Nome do cliente', 'Modelo', 'Loja', 'Vendedor', 'Banco/financeira', 'Situação', 'Faixa', 'Nº da proposta',
                           'Conta (loja)', 'Motivo', 'Completar dados'])
      });
      S.exportando = false; render();
    }).catch(function (e) {
      S.exportando = false; S.msg = (e && e.message) || 'Não foi possível exportar agora.'; render();
    });
  }
  function abrirForm(k) {
    S.form = { k: k, motivo: '', texto: '', erro: null, salvando: false, focar: '#fatMotivo0' };
    S.aviso = null; render();
  }
  function salvar() {
    var F = S.form, r = F && porChave(F.k);
    if (!r || F.salvando) return;
    var t = (F.texto || '').trim();
    if (!F.motivo) { F.erro = 'Escolha o motivo.'; F.focar = '#fatMotivo0'; render(); return; }
    if (t.length < MIN_TEXTO) { F.erro = 'Escreva pelo menos ' + MIN_TEXTO + ' caracteres explicando o que está acontecendo.'; F.focar = '#fatTexto'; render(); return; }
    F.salvando = true; F.erro = null; render();
    rpc('fat_justificar', { p_proposta: r.proposta, p_motivo: F.motivo, p_texto: t }).then(function () {
      S.form = null; S.detalhe = r._k; S.focarFechar = true; S.aviso = 'Justificativa registrada.';
      delete S.hist[r.proposta];
      carregarHistorico(r); render();
      return carregar(true);
    }).catch(function (e) {
      if (!S.form) return;
      S.form.salvando = false; S.form.erro = (e && e.message) || 'Não foi possível salvar agora.'; render();
    });
  }
  function abrirRetorno(k) { S.ret = { k: k, erro: null, enviando: false, deDetalhe: S.detalhe || null }; S.detalhe = null; S.aviso = null; render(); }
  function confirmarRetorno() {
    var F = S.ret, r = F && porChave(F.k);
    if (!r || F.enviando) return;
    F.enviando = true; F.erro = null; render();
    pedirRetorno(r.proposta).then(function (res) {
      S.ret = null; S.detalhe = r._k; S.focarFechar = true;
      S.aviso = (res && res.message) || 'Retorno urgente solicitado.';
      delete S.hist[r.proposta]; carregarHistorico(r); render();
      return carregar(true);
    }).catch(function (e) {
      if (e && e.state === 'SESSION_EXPIRED' && window.NX_AUTH_CORE && window.NX_AUTH_CORE.reportSessionExpired) { window.NX_AUTH_CORE.reportSessionExpired(); return; }
      if (!S.ret) return;
      S.ret.enviando = false; S.ret.erro = (e && e.message) || 'Não foi possível pedir o retorno agora.'; render();
    });
  }
  function abrirVincular(k) {
    var r = porChave(k);
    if (!r) return;
    S.vinc = { k: k, candidatos: null, carregando: true, chassi: '', motivo: '', erro: null, salvando: false, deDetalhe: S.detalhe || null, focar: '#fatVincChassi' };
    S.detalhe = null; S.aviso = null; render();
    rpc('faturamentos_candidatos', { p_proposta: r.proposta }).then(function (l) {
      if (!S.vinc || S.vinc.k !== k) return;
      S.vinc.candidatos = Array.isArray(l) ? l : []; S.vinc.carregando = false;
      if (S.vinc.candidatos.length) S.vinc.focar = '#fatCand0';
      render();
    }).catch(function (e) {
      if (!S.vinc || S.vinc.k !== k) return;
      S.vinc.candidatos = []; S.vinc.carregando = false; S.vinc.erro = (e && e.message) || 'Não foi possível buscar as vendas.'; render();
    });
  }
  function salvarVinculo() {
    var F = S.vinc, r = F && porChave(F.k);
    if (!r || F.salvando) return;
    var ch = String(F.chassi || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), m = (F.motivo || '').trim();
    if (ch.length !== 17) { F.erro = 'Escolha uma venda da lista ou digite o chassi completo (17 caracteres).'; F.focar = '#fatVincChassi'; render(); return; }
    if (m.length < MIN_MOTIVO) { F.erro = 'Escreva o motivo do vínculo (pelo menos ' + MIN_MOTIVO + ' caracteres).'; F.focar = '#fatVincMotivo'; render(); return; }
    F.salvando = true; F.erro = null; render();
    rpc('faturamentos_vincular', { p_proposta: r.proposta, p_chassi: ch, p_motivo: m }).then(function () {
      S.vinc = null; S.detalhe = r._k; S.focarFechar = true; S.aviso = 'Chassi vinculado.';
      delete S.hist[r.proposta]; carregarHistorico(r); render();
      return carregar(true);
    }).catch(function (e) {
      if (!S.vinc) return;
      S.vinc.salvando = false; S.vinc.erro = (e && e.message) || 'Não foi possível salvar agora.'; render();
    });
  }
  // fecha o formulário (volta ao detalhe, se veio de lá) ou o detalhe; o foco volta ao botão que abriu
  function fecharPainel() {
    if (S.ret || S.vinc || S.pag || S.reb) {
      var G = S.ret || S.vinc || S.pag || S.reb; S.ret = null; S.vinc = null; S.pag = null; S.reb = null;
      if (G.deDetalhe) { S.detalhe = G.deDetalhe; S.focarFechar = true; render(); return; }
      render(); focar('[data-id="' + G.k + '"]'); return;
    }
    if (S.form) {
      var F = S.form; S.form = null;
      if (F.deDetalhe) { S.detalhe = F.deDetalhe; S.focarFechar = true; render(); return; }
      render(); focar('.fatJustBtn[data-id="' + F.k + '"]'); return;
    }
    var k = S.detalhe; S.detalhe = null; render();
    focar('.fatMais[data-id="' + (focoAntes || k) + '"]'); focoAntes = null;
  }
  function focar(sel) {
    var l = outletRef.querySelectorAll(sel);
    for (var i = 0; i < l.length; i++) if (l[i].offsetParent) { l[i].focus(); return; }
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-acao]') : null;
    if (!b || !b.closest('.fatPage') || !outletRef.contains(b) || b.disabled) return;
    var a = b.getAttribute('data-acao');
    if (a === 'salvar') { e.preventDefault(); salvar(); return; }
    if (a === 'salvarVinculo') { e.preventDefault(); salvarVinculo(); return; }
    if (a === 'salvarPag') { e.preventDefault(); salvarPag(); return; }
    if (a === 'salvarReb') { e.preventDefault(); salvarReb(); return; }
    if (a === 'pagar') { var kp = b.getAttribute('data-id'); if (!S.detalhe) focoAntes = kp; abrirPag(kp); return; }
    if (a === 'rebate') { var kb = b.getAttribute('data-id'); if (!S.detalhe) focoAntes = kb; abrirReb(kb); return; }
    if (a === 'aba') { var va = b.getAttribute('data-v'); if (va !== S.aba) { S.aba = va; S.aviso = null; render(); } return; }
    if (a === 'sit') { var vs = b.getAttribute('data-v'); S.filtros.sit = S.filtros.sit === vs ? '' : vs; render(); return; }
    if (a === 'confirmarRetorno') { confirmarRetorno(); return; }
    if (a === 'retorno') { var kr = b.getAttribute('data-id'); if (!S.detalhe) focoAntes = kr; abrirRetorno(kr); return; }
    if (a === 'vincular') { var kv = b.getAttribute('data-id'); if (!S.detalhe) focoAntes = kv; abrirVincular(kv); return; }
    if (a === 'periodo') {
      var v = b.getAttribute('data-v');
      if (v === S.filtros.periodo) return;
      S.filtros.periodo = v;
      if (v === 'custom') { var iv = intervalo(); render(); if (!iv.ini && !iv.fim) return; }
      carregar();
    }
    else if (a === 'faixa') { var fx = b.getAttribute('data-v'); S.filtros.faixa = S.filtros.faixa === fx ? '' : fx; render(); }
    else if (a === 'limpar') { S.filtros.loja = ''; S.filtros.banco = ''; S.filtros.vendedor = ''; S.filtros.faixa = ''; S.filtros.just = ''; S.filtros.conta = ''; S.filtros.sit = ''; render(); }
    else if (a === 'exportar') exportar();
    else if (a === 'recarregar') { S.todas = null; carregar(); }
    else if (a === 'detalhe') {
      focoAntes = b.getAttribute('data-id'); S.detalhe = focoAntes; S.focarFechar = true; S.aviso = null;
      var r = porChave(S.detalhe); render(); if (r) carregarHistorico(r);
    }
    else if (a === 'justificar') {
      var k = b.getAttribute('data-id'), deDet = S.detalhe;
      if (!S.detalhe) focoAntes = k;
      abrirForm(k); S.form.deDetalhe = deDet || null;
    }
    else if (a === 'cancelar') fecharPainel();
    else if (a === 'fechar') fecharPainel();
  }
  function onChange(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('.fatPage')) return;
    if (t.name === 'fatMotivo') { if (S.form) { S.form.motivo = t.value; S.form.erro = null; } return; }
    if (S.pag && t.id === 'fatPagData') { S.pag.data = t.value; limpaErro(); return; }
    if (S.pag && t.id === 'fatPagConta') {
      S.pag.conta = t.value;
      var r0 = porChave(S.pag.k), av = outletRef.querySelector('#fatPagOutra');
      if (av && r0) { av.hidden = !(t.value && t.value !== r0.loja); av.innerHTML = 'Pago na conta de outra loja: <b>' + esc(loja(t.value)) + '</b>'; }
      return;
    }
    if (t.name === 'fatCand') { if (S.vinc) { S.vinc.chassi = t.value; S.vinc.erro = null; var ci = outletRef.querySelector('#fatVincChassi'); if (ci) ci.value = t.value; } return; }
    if (t.id === 'fatF_ini' || t.id === 'fatF_fim') {
      S.filtros[t.id.slice(5)] = t.value;
      if (S.filtros.ini && S.filtros.fim && S.filtros.fim < S.filtros.ini) { S.msg = 'A data "Até" precisa ser igual ou depois da data "De".'; render(); return; }
      carregar(); return;
    }
    var k = t.getAttribute('data-filtro');
    if (k) { S.filtros[k] = t.value; render(); }
  }
  function limpaErro() {   // ao corrigir um campo do crédito/rebate, a mensagem de erro anterior some (sem redesenhar)
    var G = S.pag || S.reb; if (!G || !G.erro) return;
    G.erro = null; var er = outletRef.querySelector('.fatFormPag .fatErroForm, .fatFormReb .fatErroForm'); if (er) er.remove();
  }
  function onInput(e) {   // o texto da justificativa: atualiza só o contador (sem redesenhar, para não perder o cursor)
    var t = e.target;
    if (t && S.vinc && t.id === 'fatVincChassi') { S.vinc.chassi = t.value; return; }
    if (t && S.reb && t.id === 'fatRebValor') { S.reb.valor = t.value; limpaErro(); return; }
    if (t && S.pag && t.id === 'fatPagMotivo') { S.pag.motivo = t.value; limpaErro(); return; }
    if (t && S.pag && t.id === 'fatPagData') { S.pag.data = t.value; limpaErro(); return; }
    if (t && S.pag && t.id === 'fatPagValor') {   // diferença na hora (sem redesenhar, para não perder o cursor)
      S.pag.valor = t.value; limpaErro();
      var rp = porChave(S.pag.k), dv = difPag(S.pag, rp), pd = outletRef.querySelector('#fatPagDif'), mb = outletRef.querySelector('#fatPagMotivoBox');
      if (pd) { pd.textContent = difTxt(dv); pd.className = 'fatContador' + (dv === 0 ? ' ok' : dv == null ? '' : ' fatDifAviso'); }
      if (mb) mb.hidden = !dv;
      return;
    }
    if (t && S.vinc && t.id === 'fatVincMotivo') {
      S.vinc.motivo = t.value;
      var nv = t.value.trim().length, cv = outletRef.querySelector('#fatVincCont');
      if (cv) { cv.textContent = nv + ' de ' + MIN_MOTIVO + ' caracteres'; cv.classList.toggle('ok', nv >= MIN_MOTIVO); }
      return;
    }
    if (!t || t.id !== 'fatTexto' || !S.form) return;
    S.form.texto = t.value;
    var n = t.value.trim().length, c = outletRef.querySelector('#fatContador');
    if (c) { c.textContent = n + ' de ' + MIN_TEXTO + ' caracteres'; c.classList.toggle('ok', n >= MIN_TEXTO); }
    if (n >= MIN_TEXTO && S.form.erro) { S.form.erro = null; var er = outletRef.querySelector('.fatForm .fatErroForm'); if (er) er.remove(); }
  }
  function onSubmit(e) {
    if (!e.target || !e.target.classList || !e.target.classList.contains('fatFormCorpo')) return;
    e.preventDefault();
    if (e.target.classList.contains('fatVincCorpo')) salvarVinculo();
    else if (e.target.classList.contains('fatPagCorpo')) salvarPag();
    else if (e.target.classList.contains('fatRebCorpo')) salvarReb();
    else salvar();
  }
  function onKey(e) {
    if (!S || !(S.detalhe || S.form || S.ret || S.vinc || S.pag || S.reb)) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharPainel(); return; }
    if (e.key === 'Tab') {   // mantém o foco dentro do painel
      var foc = Array.prototype.filter.call(outletRef.querySelectorAll('.fatDetalhe button:not([disabled]), .fatDetalhe input, .fatDetalhe select, .fatDetalhe textarea, .fatDetalhe [href]'),
        function (x) { return x.offsetParent !== null; });
      if (!foc.length) return;
      var pri = foc[0], ult = foc[foc.length - 1];
      if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
    }
  }

  window.NX_ANALISE_FATURAMENTOS_PAGE = {
    getState: function () { return S; },
    render: function (outlet) {
      if (outletRef && outletRef !== outlet) {
        outletRef.removeEventListener('click', onClick); outletRef.removeEventListener('change', onChange);
        outletRef.removeEventListener('input', onInput); outletRef.removeEventListener('submit', onSubmit);
      }
      if (outletRef !== outlet) {
        outlet.addEventListener('click', onClick); outlet.addEventListener('change', onChange);
        outlet.addEventListener('input', onInput); outlet.addEventListener('submit', onSubmit);
      }
      if (!outletRef) document.addEventListener('keydown', onKey);
      outletRef = outlet;
      S = { filtros: { periodo: '6m', ini: '', fim: '', loja: '', banco: '', vendedor: '', faixa: '', just: '', conta: '', sit: '' },
            dados: null, todas: null, erro: null, msg: null, aviso: null, carregando: false, exportando: false,
            detalhe: null, form: null, ret: null, vinc: null, pag: null, reb: null, hist: {}, focarFechar: false, abrir: null,
            aba: 'abertas', abaEscolhida: false, hoje: iso(new Date()) };
      // link do e-mail do retorno urgente / do aviso ao Analista: ?proposta=X
      try {
        var qp = new URLSearchParams(location.search).get('proposta');
        if (qp) {
          S.abrir = String(qp);
          var u = new URL(location.href); u.searchParams.delete('proposta');
          history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
        }
      } catch (e) { /* sem link direto */ }
      if (!S.abrir && window.NX_FAT_ABRIR) S.abrir = String(window.NX_FAT_ABRIR);   // vindo do aviso de retorno urgente
      window.NX_FAT_ABRIR = null;
      return carregar();
    }
  };
})();
