/* PORTAL-NEXT V2 -- Painel Master / Utilização -- aba "Brabus IA" (26/10/2026, pedido do Luis).
   Só utilização (quem, quando, quantas perguntas, em quantos dias, temas pela ferramenta usada) --
   nunca o texto das perguntas. Só leitura, só Master. Mesma estrutura visual da aba Simuladores
   (classes uds* / pc* / su* já existentes). O shell (shell-admin.js) chama init() uma vez com seus
   utilitários e depois html()/bind() a cada render. Não entra no Score. */
(function () {
  'use strict';

  var INICIO_HISTORICO = '2026-10-02'; // primeira linha de bi_audit_log (base do período estimado)
  var TEMAS = ['Simulação de financiamento', 'Resultados e análises', 'Cash Conversion', 'Salário e comissão', 'Score', 'Manual e ajuda', 'Conversa (sem ferramenta)', 'Outros'];
  var sh = null; // utilitários do shell: esc, errorStateHtml, renderPanel, renderNxModal, clearNxModal, fieldRow, SU_VM, filtroSelectHtml
  var st = {
    loading: false, loaded: false, error: null, dados: null,
    filtros: { preset: '30d', dtIni: '', dtFim: '', loja: '', departamento: '', perfil: '', busca: '' },
    ordenacao: 'ultimo_uso_desc', nuncaAberto: false, drawerId: null
  };

  function init(utils) { sh = utils; }

  function enter() {
    if (st.loaded || st.loading) { sh.renderPanel(); return; }
    if (!st.filtros.dtIni) { var p = sh.SU_VM.applyPreset('30d', null); st.filtros.dtIni = p.dtIni; st.filtros.dtFim = p.dtFim; }
    load();
  }
  function load() {
    st.loading = true; st.error = null; sh.renderPanel();
    window.NX_MASTER_IA_USAGE_PROVIDER.loadUsage(st.filtros.dtIni, st.filtros.dtFim).then(function (d) {
      st.dados = d; st.loading = false; st.loaded = true; sh.renderPanel();
    }, function (err) {
      st.loading = false; st.loaded = false; st.error = err || { state: 'RPC_ERROR' }; sh.renderPanel();
    });
  }

  function up(v) { return String(v || '').trim().toUpperCase(); }
  function confere(x, f) {
    if (f.loja && up(x.loja) !== f.loja) return false;
    if (f.departamento && up(x.departamento) !== f.departamento) return false;
    if (f.perfil && up(x.perfil) !== f.perfil) return false;
    if (f.busca) {
      var hay = up([x.nome, x.loja, x.perfil, x.departamento].join(' '));
      if (hay.indexOf(up(f.busca)) === -1) return false;
    }
    return true;
  }
  function linhasFiltradas() { return ((st.dados && st.dados.linhas) || []).filter(function (l) { return confere(l, st.filtros); }); }
  function nuncaUsaram() { return ((st.dados && st.dados.elegiveis) || []).filter(function (e) { return !e.ja_usou && confere(e, st.filtros); }); }
  function ordenar(lista) {
    var a = lista.slice(), o = st.ordenacao;
    if (o === 'perguntas') return a.sort(function (x, y) { return y.perguntas - x.perguntas; });
    if (o === 'dias') return a.sort(function (x, y) { return y.dias - x.dias; });
    if (o === 'nome') return a.sort(function (x, y) { return String(x.nome || '').localeCompare(String(y.nome || ''), 'pt-BR'); });
    return a.sort(function (x, y) { return String(y.ultima || '').localeCompare(String(x.ultima || '')); });
  }
  function temaPrincipal(l) {
    var best = null; Object.keys(l.temas || {}).forEach(function (t) { if (!best || l.temas[t] > l.temas[best]) best = t; });
    return best || '—';
  }
  function opcoes(campo) {
    var vals = {}; (((st.dados && st.dados.linhas) || []).concat((st.dados && st.dados.elegiveis) || [])).forEach(function (x) { if (x[campo]) vals[up(x[campo])] = true; });
    return Object.keys(vals).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function bannerHtml() {
    var d = st.dados, esc = sh.esc;
    var ini = d.registro_iniciado_em;
    var txtEst = 'De 02/10/2026' + (ini ? ' até ' + esc(sh.SU_VM.fmtDateTimeBR(ini)) : ' até agora') +
      ', as perguntas são <b>estimadas</b> pela auditoria da Brabus IA (ferramentas da mesma conversa com menos de 60 s entre si contam como 1 pergunta); perguntas respondidas sem ferramenta não aparecem nesse período.';
    var txtReg = ini ? ' A partir de ' + esc(sh.SU_VM.fmtDateTimeBR(ini)) + ', cada pergunta é registrada (sem o texto).' : ' O registro por pergunta começa na primeira pergunta feita depois da atualização da Brabus IA de 26/10/2026.';
    return '<div class="note suBanner suBannerOk"><b>Só utilização — o texto das perguntas nunca é guardado.</b><p class="maSubtle">' + txtEst + txtReg + '</p></div>';
  }

  function html() {
    var esc = sh.esc;
    var out = '<p class="note">Quem usou a Brabus IA, quantas perguntas, em quantos dias, última vez e os temas (pela ferramenta usada). Perfis com acesso: todos, exceto RH/DP. Não entra no Score. Tela somente leitura.</p>';
    if (st.error) return out + sh.errorStateHtml(st.error.state, st.error.message) + '<button type="button" id="iaRetryBtn" class="modBtnGhost">Tentar novamente</button>';
    if (st.loading || !st.loaded) return out + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando utilização da Brabus IA...</div>';
    var f = st.filtros;
    out += bannerHtml();
    var presets = [['hoje', 'Hoje'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['mesAtual', 'Mês atual'], ['mesAnterior', 'Mês anterior'], ['desdeInicio', 'Desde o início']];
    out += '<div class="suPresetGroup">' + presets.map(function (p) {
      return '<button type="button" class="' + (f.preset === p[0] ? 'modBtn' : 'modBtnGhost') + ' iaPresetBtn" data-preset="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '<button type="button" class="modBtnGhost" id="iaExportBtn">Exportar XLSX</button></div>';
    out += '<div class="modFilters">' +
      '<div class="modField"><label for="iaDtIni">Data inicial</label><input type="date" id="iaDtIni" value="' + esc(f.dtIni) + '"></div>' +
      '<div class="modField"><label for="iaDtFim">Data final</label><input type="date" id="iaDtFim" value="' + esc(f.dtFim) + '"></div>' +
      sh.filtroSelectHtml('iaLoja', 'Loja', opcoes('loja'), f.loja) +
      sh.filtroSelectHtml('iaDep', 'Departamento', opcoes('departamento'), f.departamento) +
      sh.filtroSelectHtml('iaPerfil', 'Perfil', opcoes('perfil'), f.perfil) + '</div>';
    out += '<div class="modFilters"><div class="modField"><label for="iaBusca">Pesquisar usuário...</label><input type="text" id="iaBusca" value="' + esc(f.busca) + '" placeholder="Nome, loja ou perfil"></div>' +
      '<div class="modField"><label for="iaOrdenacao">Ordenar por</label><select id="iaOrdenacao">' +
      [['ultimo_uso_desc', 'Última vez (mais recente)'], ['perguntas', 'Mais perguntas'], ['dias', 'Mais dias com uso'], ['nome', 'Nome (A-Z)']].map(function (o) {
        return '<option value="' + o[0] + '"' + (st.ordenacao === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>';
    out += '<div id="iaResultsArea">' + resultadosHtml() + '</div>';
    return out;
  }

  function resultadosHtml() {
    var esc = sh.esc;
    var linhas = linhasFiltradas(), nunca = nuncaUsaram();
    var perguntas = linhas.reduce(function (a, l) { return a + (l.perguntas || 0); }, 0);
    var estimadas = linhas.reduce(function (a, l) { return a + (l.perguntas_estimadas || 0); }, 0);
    var out = '<div class="suKpiCards">' +
      '<div class="pcCard"><div class="pcCardK">Usuários que utilizaram</div><div class="pcCardV" id="iaKpiUsuarios">' + linhas.length + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Perguntas' + (estimadas ? ' (' + estimadas + ' estimadas)' : '') + '</div><div class="pcCardV" id="iaKpiPerguntas">' + perguntas + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Média por usuário</div><div class="pcCardV">' + (linhas.length ? (perguntas / linhas.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—') + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Dias com uso (soma)</div><div class="pcCardV">' + linhas.reduce(function (a, l) { return a + (l.dias || 0); }, 0) + '</div></div>' +
      '<div class="pcCard"><div class="pcCardK">Nunca utilizaram</div><div class="pcCardV" id="iaKpiNunca">' + nunca.length + '</div></div></div>';
    var porTema = {}; linhas.forEach(function (l) { Object.keys(l.temas || {}).forEach(function (t) { porTema[t] = (porTema[t] || 0) + l.temas[t]; }); });
    var temas = TEMAS.filter(function (t) { return porTema[t]; });
    out += '<h3>Temas (pela ferramenta usada)</h3><div class="udsCompareGrid iaTemas">' + (temas.length ? temas.map(function (t) {
      return '<div class="udsCompareCard"><div class="udsCompareTitle">' + esc(t) + '</div><div class="udsCompareRow"><span>Perguntas</span><b>' + porTema[t] + '</b></div></div>';
    }).join('') : '<p class="note">Nenhuma pergunta no período.</p>') + '</div>';
    var head = '<div class="udsRow udsRowHead"><div class="udsMain">Usuário</div><div class="udsCol udsColLoja">Loja</div><div class="udsCol udsColDep">Departamento</div>' +
      '<div class="udsCol">Perfil</div><div class="udsCol udsColNum">Perguntas</div><div class="udsCol udsColNum">Dias</div><div class="udsCol">Última vez</div><div class="udsCol">Tema principal</div><div class="udsCol udsColAcao"></div></div>';
    var rows = ordenar(linhas).map(function (l) {
      return '<div class="udsRow iaRow" data-id="' + esc(l.usuario_id) + '"><div class="udsMain"><div class="udsName">' + esc(l.nome || '') + '</div>' +
        '<div class="udsMetaMobile">' + esc(l.loja || '—') + ' • ' + esc(l.departamento || l.perfil || '—') + '</div></div>' +
        '<div class="udsCol udsColLoja" data-label="Loja">' + esc(l.loja || '—') + '</div>' +
        '<div class="udsCol udsColDep" data-label="Departamento">' + esc(l.departamento || '—') + '</div>' +
        '<div class="udsCol" data-label="Perfil">' + esc(l.perfil || '—') + '</div>' +
        '<div class="udsCol udsColNum" data-label="Perguntas">' + l.perguntas + (l.perguntas_estimadas ? '<span class="maSubtle" title="estimadas pela auditoria"> (' + l.perguntas_estimadas + ' est.)</span>' : '') + '</div>' +
        '<div class="udsCol udsColNum" data-label="Dias">' + l.dias + '</div>' +
        '<div class="udsCol" data-label="Última vez">' + esc(sh.SU_VM.fmtDateTimeBR(l.ultima)) + '</div>' +
        '<div class="udsCol" data-label="Tema principal">' + esc(temaPrincipal(l)) + '</div>' +
        '<div class="udsCol udsColAcao"><button type="button" class="modBtnGhost iaDetailBtn" data-id="' + esc(l.usuario_id) + '">Ver detalhes</button></div></div>';
    }).join('');
    out += '<div class="udsList">' + head + (rows || '<p class="note" style="padding:16px">Nenhuma pergunta registrada para os filtros selecionados.</p>') + '</div>';
    out += nuncaHtml(nunca);
    return out;
  }

  function nuncaHtml(nunca) {
    var esc = sh.esc;
    if (!st.nuncaAberto) return '<div class="udsNuncaBox"><button type="button" class="modBtnGhost" id="iaToggleNuncaBtn">Ver quem nunca utilizou a Brabus IA (' + nunca.length + ')</button></div>';
    var rows = nunca.slice().sort(function (a, b) { return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'); }).map(function (u) {
      return '<div class="udsNuncaRow"><div><b>' + esc(u.nome || '') + '</b></div><div class="maSubtle">' + esc(u.loja || '—') + ' • ' + esc(u.departamento || '—') + ' • ' + esc(u.perfil || '—') + '</div></div>';
    }).join('');
    return '<div class="udsNuncaBox"><div class="udsNuncaHead"><h3>Nunca utilizaram (' + nunca.length + ')</h3><button type="button" class="modBtnGhost" id="iaToggleNuncaBtn">Ocultar</button></div>' +
      '<p class="note">Usuários ativos dos perfis com acesso à Brabus IA (todos, exceto RH/DP) que nunca fizeram uma pergunta — considera todo o histórico desde 02/10/2026, independente do período acima.</p>' +
      (rows || '<p class="note">Todos os usuários com acesso já utilizaram.</p>') + '</div>';
  }

  function drawer() {
    if (!st.drawerId) { sh.clearNxModal(); return; }
    var l = ((st.dados && st.dados.linhas) || []).filter(function (x) { return String(x.usuario_id) === String(st.drawerId); })[0];
    if (!l) { st.drawerId = null; sh.clearNxModal(); return; }
    var temas = Object.keys(l.temas || {}).sort(function (a, b) { return l.temas[b] - l.temas[a]; });
    var body = '<p class="note">Só utilização — o texto das perguntas não é guardado.</p>' +
      sh.fieldRow('Loja', l.loja || '—') + sh.fieldRow('Departamento', l.departamento || '—') + sh.fieldRow('Perfil', l.perfil || '—') +
      sh.fieldRow('Perguntas', l.perguntas + (l.perguntas_estimadas ? ' (' + l.perguntas_estimadas + ' estimadas pela auditoria)' : '')) +
      sh.fieldRow('Dias com uso', l.dias) + sh.fieldRow('Primeira vez', sh.SU_VM.fmtDateTimeBR(l.primeira)) + sh.fieldRow('Última vez', sh.SU_VM.fmtDateTimeBR(l.ultima)) +
      '<h4>Temas</h4>' + (temas.map(function (t) { return sh.fieldRow(t, l.temas[t] + ' pergunta(s)'); }).join('') || '<p class="note">—</p>');
    sh.renderNxModal(l.nome || 'Detalhes de uso', body, function () { st.drawerId = null; sh.clearNxModal(); });
  }

  function exportar() {
    if (typeof XLSX === 'undefined') return;
    var dados = ordenar(linhasFiltradas()).map(function (l) {
      var r = { 'Nome': l.nome, 'Loja': l.loja, 'Departamento': l.departamento, 'Perfil': l.perfil, 'Perguntas': l.perguntas,
        'Perguntas estimadas': l.perguntas_estimadas, 'Dias com uso': l.dias, 'Primeira vez': sh.SU_VM.fmtDateTimeBR(l.primeira), 'Última vez': sh.SU_VM.fmtDateTimeBR(l.ultima) };
      TEMAS.forEach(function (t) { r[t] = (l.temas || {})[t] || 0; });
      return r;
    });
    var nunca = nuncaUsaram().map(function (u) { return { 'Nome': u.nome, 'Loja': u.loja, 'Departamento': u.departamento, 'Perfil': u.perfil }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados.length ? dados : [{ 'Aviso': 'Nenhuma pergunta no período.' }]), 'Utilizacao');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(nunca.length ? nunca : [{ 'Aviso': 'Todos os usuários com acesso já utilizaram.' }]), 'Nunca utilizaram');
    XLSX.writeFile(wb, 'utilizacao_brabus_ia_' + st.filtros.dtIni + '_a_' + st.filtros.dtFim + '.xlsx');
  }

  function setPreset(p) {
    var r = p === 'desdeInicio' ? { dtIni: INICIO_HISTORICO, dtFim: sh.SU_VM.todaySP() } : sh.SU_VM.applyPreset(p, null);
    st.filtros.preset = p; st.filtros.dtIni = r.dtIni; st.filtros.dtFim = r.dtFim; load();
  }
  var buscaTimer = null;
  function bind() {
    var on = function (id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('iaRetryBtn', 'click', load);
    document.querySelectorAll('.iaPresetBtn').forEach(function (el) { el.addEventListener('click', function () { setPreset(el.getAttribute('data-preset')); }); });
    on('iaExportBtn', 'click', exportar);
    on('iaDtIni', 'change', function (e) { st.filtros.preset = 'custom'; st.filtros.dtIni = e.target.value; load(); });
    on('iaDtFim', 'change', function (e) { st.filtros.preset = 'custom'; st.filtros.dtFim = e.target.value; load(); });
    on('iaLoja', 'change', function (e) { st.filtros.loja = e.target.value; sh.renderPanel(); });
    on('iaDep', 'change', function (e) { st.filtros.departamento = e.target.value; sh.renderPanel(); });
    on('iaPerfil', 'change', function (e) { st.filtros.perfil = e.target.value; sh.renderPanel(); });
    on('iaOrdenacao', 'change', function (e) { st.ordenacao = e.target.value; sh.renderPanel(); });
    on('iaBusca', 'input', function (e) {
      st.filtros.busca = e.target.value; clearTimeout(buscaTimer);
      buscaTimer = setTimeout(function () { var a = document.getElementById('iaResultsArea'); if (a) { a.innerHTML = resultadosHtml(); bindResultados(); } }, 200);
    });
    bindResultados();
  }
  function bindResultados() {
    var t = document.getElementById('iaToggleNuncaBtn');
    if (t) t.addEventListener('click', function () { st.nuncaAberto = !st.nuncaAberto; var a = document.getElementById('iaResultsArea'); if (a) { a.innerHTML = resultadosHtml(); bindResultados(); } });
    document.querySelectorAll('.iaDetailBtn').forEach(function (el) { el.addEventListener('click', function () { st.drawerId = el.getAttribute('data-id'); drawer(); }); });
  }

  window.NX_MASTER_IA_USAGE_SECTION = { init: init, enter: enter, html: html, bind: bind, drawer: drawer, _state: st };
})();
