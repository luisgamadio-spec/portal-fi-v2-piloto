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
     Não justifica. O Analista responsável vê um aviso a cada acesso até registrar a justificativa. */
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
  function buscar(ini, fim) { return rpc('faturamentos_painel', { p_ini: ini || null, p_fim: fim || null }); }
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
  function porChave(k) { return ((S.dados && S.dados.abertas) || []).filter(function (x) { return x._k === String(k); })[0]; }

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
    var c = S.dados && S.dados.carga, n = filtradas().length, exp = S.dados && S.dados.pode_exportar === true;
    var selo = c ? '<span class="fatSelo' + (c.desatualizada ? ' fatSeloAviso' : '') + '">Dados atualizados em: <b>' + esc(dataCurta(c.data)) + '</b>' +
      (c.desatualizada ? ' · há ' + esc(c.dias_uteis_desde) + ' dias úteis' : '') + '</span>' : '';
    return '<header class="fatTopo">' +
      '<div class="fatTopoTexto"><p class="modEyebrow">Master, Analistas e Financeiro</p><h1 class="modTitle">Análise de Faturamentos</h1>' +
      '<p class="modSubtitle">Propostas de financiamento faturadas e ainda sem pagamento do banco para a loja.</p></div>' +
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
  function filtrosHtml() {
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
      '<div class="fatAberto"><p class="fatRotulo">Em aberto</p><p class="fatAbertoQtd">' + num(l.length) + '</p>' +
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
  function acoesLinha(r) { return botaoVincular(r) + (pode('pode_justificar') ? botaoJust(r) : botaoRetorno(r)); }
  function linhaHtml(r) {
    return '<tr class="fatLinha fat' + r.faixa + '">' +
      '<td class="fatColDias"><b>' + esc(r.dias) + '</b></td>' +
      '<td class="fatMono">' + esc(chassiDe(r)) + '<br>' + seloOrigem(r) + '</td>' +
      '<td class="fatCorta" title="' + esc(seLigado(r, r.modelo)) + '">' + esc(seLigado(r, r.modelo)) + '</td>' +
      '<td class="fatCorta" title="' + esc(loja(r.loja)) + '">' + esc(loja(r.loja)) + '</td>' +
      '<td class="fatCorta" title="' + esc(r.banco || '—') + '">' + esc(r.banco || '—') + '</td>' +
      '<td class="fatNum">' + esc(brl(r.financiado)) + '</td>' +
      '<td class="fatNum">' + esc(fatTxt(r)) + '</td>' +
      '<td class="fatColJust">' + seloJust(r) + seloRetorno(r) + '</td>' +
      '<td class="fatColAcao">' + acoesLinha(r) +
      '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '" aria-label="Mais detalhes da proposta ' + esc(chassiDe(r)) + '">+ detalhes</button></td></tr>';
  }
  function cartaoHtml(r) {
    return '<li class="fatCartao fat' + r.faixa + '"><div class="fatCartaoTopo">' + badge(r.faixa) +
      '<span class="fatCartaoDias"><b>' + esc(r.dias) + '</b> dias úteis</span></div>' +
      '<p class="fatCartaoModelo">' + esc(seLigado(r, r.modelo)) + '</p>' +
      '<p class="fatMono fatCartaoChassi">' + esc(chassiDe(r)) + ' ' + seloOrigem(r) + '</p>' +
      (pedeJust(r) || r.retorno ? '<p class="fatCartaoJust">' + (pedeJust(r) ? seloJust(r) : '') + seloRetorno(r) + '</p>' : '') +
      '<dl><div><dt>Loja</dt><dd>' + esc(loja(r.loja)) + '</dd></div><div><dt>Banco</dt><dd>' + esc(r.banco || '—') + '</dd></div>' +
      '<div><dt>Financiado</dt><dd>' + esc(brl(r.financiado)) + '</dd></div><div><dt>Faturamento</dt><dd>' + esc(fatTxt(r)) + '</dd></div></dl>' +
      '<div class="fatCartaoAcoes">' + acoesLinha(r) + '<button type="button" class="fatMais" data-acao="detalhe" data-id="' + esc(r._k) + '">+ detalhes</button></div></li>';
  }
  function listaHtml() {
    var lista = ordenar(filtradas());
    var h = '<section class="fatLista"><h2 class="modSectionTitle">Propostas em aberto <span class="modMuted">(' + lista.length + ')</span></h2>';
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
      botaoJust(r, 'fatJustBtnForte') + botaoRetorno(r, 'fatRetBtnForte') + '</div>';
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
    if (!itens.length) return h + '<p class="modMuted">' + (pedeJust(r) ? 'Nenhuma justificativa ainda.' : 'Propostas na faixa Normal não pedem justificativa.') + '</p></section>';
    itens.sort(function (a, b) { return String(b.em).localeCompare(String(a.em)); });
    return h + '<ol class="fatHistLista">' + itens.map(function (x) { return x.html; }).join('') + '</ol></section>';
  }
  function detalheHtml() {
    var r = S.detalhe && porChave(S.detalhe);
    if (!r) return '';
    var identificado = (r.faturamento_desde_inicio ? 'até ' : '') + dataLonga(r.faturamento) + (r.faturamento_desde_inicio ? ' (início dos dados)' : '');
    function item(rot, v) { return '<div><dt>' + rot + '</dt><dd>' + v + '</dd></div>'; }
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
      item('Valor financiado', esc(brl(r.financiado))) +
      item('Dias úteis em aberto', esc(r.dias)) +
      item('Faixa', badge(r.faixa)) +
      item('Faturamento identificado em', esc(identificado)) +
      '</dl>' + historicoHtml(r) + '</aside>';
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
      '<p class="fatFormSub">' + esc(loja(r.loja)) + ' · ' + esc(r.banco || '—') + ' · ' + esc(brl(r.financiado)) + ' · inclusão ' + esc(dataLonga(r.inclusao)) + '</p></div>' +
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
  function render() {
    if (!outletRef) return;
    var corpo;
    if (S.erro) corpo = topoHtml() + '<div class="modErrorState">' + esc(S.erro) + ' <button type="button" class="modBtn modBtnSecondary" data-acao="recarregar">Tentar novamente</button></div>';
    else if (!S.dados) corpo = topoHtml() + '<div class="modLoadingState">Carregando…</div>';
    else {
      corpo = topoHtml() + periodoHtml() + filtrosHtml() + (S.msg ? '<div class="modErrorState" role="status">' + esc(S.msg) + '</div>' : '') +
        (S.aviso ? '<div class="fatOk" role="status">' + esc(S.aviso) + '</div>' : '') +
        (S.carregando ? '<div class="modLoadingState fatAtualizando">Atualizando…</div>' : '') + resumoHtml() + listaHtml() + bancosHtml() +
        (S.form ? formHtml() : S.ret ? retornoHtml() : S.vinc ? vincularHtml() : detalheHtml());
    }
    var aberto = !!(S.form || S.detalhe || S.ret || S.vinc);
    var manter = chaveDoFoco();
    outletRef.innerHTML = '<div class="fatPage' + (aberto ? ' fatComDetalhe' : '') + '">' + corpo + '</div>';
    if (manter) { var de = outletRef.querySelector(manter); if (de) de.focus(); }
    var Fo = S.form || S.vinc;
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
    return rpc('faturamentos_historico', { p_proposta: r.proposta }).then(function (h) {
      S.hist[r.proposta] = { justificativas: (h && h.justificativas) || [], retornos: (h && h.retornos) || [], vinculos: (h && h.vinculos) || [] };
      if (S.detalhe === r._k) render();
    }).catch(function (e) {
      S.hist[r.proposta] = { erro: (e && e.message) || 'Não foi possível carregar o histórico.' };
      if (S.detalhe === r._k) render();
    });
  }
  function exportar() {
    var H = window.NX_XLSX_EXPORT_HELPER;
    if (!H || !window.XLSX || !S.dados || S.dados.pode_exportar !== true || S.exportando) return;
    var quais = {}; filtradas().forEach(function (r) { quais[r.proposta] = true; });
    var iv = intervalo();
    S.exportando = true; render();
    // o arquivo sai de faturamentos_exportar (só Master e Financeiro), que registra quem, quando e com quais filtros
    var f = S.filtros;
    rpc('faturamentos_exportar', { p_ini: iv.ini || null, p_fim: iv.fim || null, p_propostas: Object.keys(quais),
      p_filtros: { periodo: f.periodo, loja: f.loja || '', banco: f.banco || '', vendedor: f.vendedor || '', faixa: f.faixa || '', justificativa: f.just || '' } }).then(function (d) {
      var lista = ordenar((Array.isArray(d) ? d : []).filter(function (r) { return quais[r.proposta]; }));
      if (!lista.length) { S.exportando = false; render(); return; }
      var headers = ['Chassi', 'Ligação do chassi', 'Nome do cliente', 'Modelo', 'Loja', 'Vendedor', 'Banco/financeira', 'Valor financiado', 'Data de inclusão',
                     'Data de faturamento', 'Dias úteis em aberto', 'Faixa', 'Nº da proposta'];
      var linhas = lista.map(function (r) {
        return [chassiDe(r), ligado(r) ? (ORIGEM[r.ligacao_origem] || r.ligacao_origem) : 'Sem ligação', r.cliente || '', seLigado(r, r.modelo), loja(r.loja), vendedorDe(r), r.banco || '',
                Number(r.financiado) || 0, H.excelDateValue(r.inclusao) || '', H.excelDateValue(r.faturamento) || '', Number(r.dias) || 0,
                FAIXA_LABEL[r.faixa] || r.faixa, r.proposta || ''];
      });
      H.downloadWorkbook(headers, linhas, 'Faturamentos em aberto', 'Faturamentos_em_aberto_' + H.excelFileStamp() + '.xlsx', {
        moneyCols: new Set(['Valor financiado']), pctCols: new Set(), dateCols: new Set(['Data de inclusão', 'Data de faturamento']),
        intCols: new Set(['Dias úteis em aberto']),
        textCols: new Set(['Chassi', 'Ligação do chassi', 'Nome do cliente', 'Modelo', 'Loja', 'Vendedor', 'Banco/financeira', 'Faixa', 'Nº da proposta'])
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
    if (S.ret || S.vinc) {
      var G = S.ret || S.vinc; S.ret = null; S.vinc = null;
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
    else if (a === 'limpar') { S.filtros.loja = ''; S.filtros.banco = ''; S.filtros.vendedor = ''; S.filtros.faixa = ''; S.filtros.just = ''; render(); }
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
    if (t.name === 'fatCand') { if (S.vinc) { S.vinc.chassi = t.value; S.vinc.erro = null; var ci = outletRef.querySelector('#fatVincChassi'); if (ci) ci.value = t.value; } return; }
    if (t.id === 'fatF_ini' || t.id === 'fatF_fim') {
      S.filtros[t.id.slice(5)] = t.value;
      if (S.filtros.ini && S.filtros.fim && S.filtros.fim < S.filtros.ini) { S.msg = 'A data "Até" precisa ser igual ou depois da data "De".'; render(); return; }
      carregar(); return;
    }
    var k = t.getAttribute('data-filtro');
    if (k) { S.filtros[k] = t.value; render(); }
  }
  function onInput(e) {   // o texto da justificativa: atualiza só o contador (sem redesenhar, para não perder o cursor)
    var t = e.target;
    if (t && S.vinc && t.id === 'fatVincChassi') { S.vinc.chassi = t.value; return; }
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
    if (e.target.classList.contains('fatVincCorpo')) salvarVinculo(); else salvar();
  }
  function onKey(e) {
    if (!S || !(S.detalhe || S.form || S.ret || S.vinc)) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharPainel(); return; }
    if (e.key === 'Tab') {   // mantém o foco dentro do painel
      var foc = outletRef.querySelectorAll('.fatDetalhe button:not([disabled]), .fatDetalhe input, .fatDetalhe textarea, .fatDetalhe [href]');
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
      S = { filtros: { periodo: '6m', ini: '', fim: '', loja: '', banco: '', vendedor: '', faixa: '', just: '' },
            dados: null, todas: null, erro: null, msg: null, aviso: null, carregando: false, exportando: false,
            detalhe: null, form: null, ret: null, vinc: null, hist: {}, focarFechar: false, abrir: null };
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
