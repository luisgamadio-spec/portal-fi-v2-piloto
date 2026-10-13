/* PORTAL-NEXT V2 — Painel Master › Referências de Mercado (Cash Conversion).
   A Brabus IA usa estas taxas. Lê a referência vigente (cash_referencias_mercado) e grava uma nova
   (master_salvar_cash_referencias_mercado — o banco só aceita o Master e valida tudo).
   Fora da produção (homolog/local) a gravação é SIMULADA, como nas outras seções travadas do Painel Master.
   Usado pelo shell-admin.js: NX_MASTER_CASH_REF.render(panel, { producao, voltar }). */
(function () {
  'use strict';
  var estado = { carregando: false, ref: null, erro: null, confirmar: null, mensagem: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dataBr(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
  function n2(v) { return v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }
  function n0(v) { return v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function taxa(s) { var t = String(s || '').replace('%', '').trim().replace(/\s/g, ''); if (!/^\d+([.,]\d+)?$/.test(t)) return NaN; return Number(t.replace(',', '.')); }
  function inteiro(s) { var t = String(s || '').replace(/[R$\s.]/g, '').replace(/,\d*$/, ''); return /^\d+$/.test(t) ? Number(t) : NaN; }
  function hojeSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }

  function rpc(nome, corpo) {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.NX_AUTH) return Promise.reject({ message: 'Configuração ausente neste ambiente.' });
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return Promise.reject({ message: 'Sessão expirada. Entre de novo.' });
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + nome, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(corpo || {})
      }).then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (b) {
          if (!resp.ok) return Promise.reject({ message: (b && b.message) || ('Erro ' + resp.status + '.') });
          return b;
        });
      });
    });
  }

  function campo(id, rotulo, valor, dica, tipo) {
    return '<label class="mcrCampo"><span>' + esc(rotulo) + '</span><input class="input mono" id="' + id + '" type="' + (tipo || 'text') + '" value="' + esc(valor) + '" autocomplete="off">' +
      (dica ? '<small>' + esc(dica) + '</small>' : '') + '</label>';
  }
  function linhaFocus(i, f) {
    return '<div class="mcrLinha">' + campo('mcrFocusAno' + i, 'Fim de (ano)', f ? f.fim_de : '', '', 'number') + campo('mcrFocusSelic' + i, 'Selic (% a.a.)', f ? n2(f.selic_aa) : '') + '</div>';
  }
  function linhaIr(i, f, ultima) {
    return '<div class="mcrLinha">' + (ultima ? '<label class="mcrCampo"><span>Até (dias)</span><input class="input mono" value="acima" disabled></label>'
      : campo('mcrIrDias' + i, 'Até (dias)', f ? f.ate_dias : '', '', 'number')) + campo('mcrIrAliq' + i, 'Alíquota (%)', f ? n2(f.aliquota_pct) : '') + '</div>';
  }
  function linhaProduto(i, p) {
    p = p || {};
    function opc(v, atual) { return '<option value="' + v + '"' + (v === atual ? ' selected' : '') + '>' + v + '</option>'; }
    return '<div class="mcrLinha mcrProduto">' + campo('mcrProdNome' + i, 'Produto', p.nome || '') +
      '<label class="mcrCampo"><span>Indexador</span><select class="select" id="mcrProdIdx' + i + '">' + opc('SELIC', p.indexador) + opc('CDI', p.indexador) + '</select></label>' +
      campo('mcrProdPct' + i, '% do indexador', p.pct_indexador != null ? n2(p.pct_indexador) : '') +
      '<label class="mcrCampo"><span>Garantia</span><select class="select" id="mcrProdGar' + i + '">' + opc('SOBERANO', p.garantia) + opc('FGC', p.garantia) + '</select></label>' +
      '<label class="mcrCampo mcrCheck"><input type="checkbox" id="mcrProdIsento' + i + '"' + (p.isento_ir_pf ? ' checked' : '') + '><span>Isento de IR (PF)</span></label>' +
      '<input type="hidden" id="mcrProdId' + i + '" value="' + esc(p.id || '') + '"></div>';
  }

  function formHtml(ref, producao) {
    ref = ref || {};
    var focus = ref.focus_selic || [], ir = ref.ir_faixas || [], prods = ref.produtos || [];
    var html = '<h3>Nova referência</h3><p class="note">Os campos vêm com a referência vigente. Para uma nova data de vigência, uma nova linha é criada (o histórico fica); para a mesma data, a linha é corrigida.</p>';
    html += '<div class="mcrGrade">' + campo('mcrVigencia', 'Data de vigência', hojeSP(), 'Data a que as taxas se referem.', 'date') +
      campo('mcrSelic', 'Selic atual (% a.a.)', n2(ref.selic_aa), 'Banco Central — meta Selic') + campo('mcrCdi', 'CDI atual (% a.a.)', n2(ref.cdi_aa), 'B3 — Taxa DI') +
      campo('mcrCdi12', 'CDI acumulado 12 meses (%)', n2(ref.cdi_12m_pct)) + campo('mcrCdi12Ate', 'Fim do período de 12 meses', ref.cdi_12m_ate || '', '', 'date') + '</div>';
    html += '<h4>Boletim Focus (mediana da Selic no fim de cada ano)</h4><div class="mcrGrade">' + campo('mcrFocusData', 'Data do Focus', ref.focus_data || hojeSP(), '', 'date') +
      campo('mcrIpcaAno', 'IPCA — ano', ref.focus_ipca_ano || '', '', 'number') + campo('mcrIpca', 'IPCA (%)', n2(ref.focus_ipca_pct)) + '</div>';
    for (var i = 0; i < 3; i++) html += linhaFocus(i, focus[i]);
    html += '<p class="note">Deixe em branco os anos que não usar.</p>';
    html += '<h4>IR regressivo (renda fixa)</h4>';
    for (var k = 0; k < 4; k++) html += linhaIr(k, ir[k], k === 3);
    html += '<h4>FGC</h4><div class="mcrGrade">' + campo('mcrFgcLim', 'Limite por CPF por instituição (R$)', n0(ref.fgc_limite_instituicao)) +
      campo('mcrFgcTeto', 'Teto total (R$)', n0(ref.fgc_teto_total)) + campo('mcrFgcAnos', 'Teto a cada (anos)', ref.fgc_teto_anos || '', '', 'number') + '</div>';
    html += '<h4>Produtos de referência</h4>';
    for (var j = 0; j < 3; j++) html += linhaProduto(j, prods[j]);
    html += '<h4>Fonte</h4><label class="mcrCampo mcrFonte"><span>Fonte (aparece para o vendedor e na Brabus IA)</span><textarea class="input" id="mcrFonte" rows="3">' + esc(ref.fonte || '') + '</textarea></label>';
    html += '<div class="mcrAcoes"><button type="button" class="modBtnPrimary" id="mcrSalvar">' + (producao ? 'Revisar e salvar' : 'Revisar (simulado)') + '</button></div>';
    return html;
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function coletar() {
    var erros = [], d = {
      vigencia: val('mcrVigencia'), fonte: val('mcrFonte').trim(), selic_aa: taxa(val('mcrSelic')), cdi_aa: taxa(val('mcrCdi')),
      cdi_12m_pct: taxa(val('mcrCdi12')), cdi_12m_ate: val('mcrCdi12Ate'), focus_data: val('mcrFocusData'),
      focus_ipca_ano: Number(val('mcrIpcaAno')), focus_ipca_pct: taxa(val('mcrIpca')), focus_selic: [], ir_faixas: [], produtos: [],
      fgc_limite_instituicao: inteiro(val('mcrFgcLim')), fgc_teto_total: inteiro(val('mcrFgcTeto')), fgc_teto_anos: Number(val('mcrFgcAnos'))
    };
    for (var i = 0; i < 3; i++) {
      var ano = val('mcrFocusAno' + i), s = val('mcrFocusSelic' + i);
      if (!ano && !s) continue;
      if (!(Number(ano) > 2000) || !(taxa(s) > 0)) erros.push('Focus: ano e Selic na linha ' + (i + 1) + '.');
      else d.focus_selic.push({ fim_de: Number(ano), selic_aa: taxa(s) });
    }
    for (var k = 0; k < 4; k++) {
      var aliq = taxa(val('mcrIrAliq' + k));
      if (!(aliq >= 0)) erros.push('IR: alíquota da faixa ' + (k + 1) + '.');
      d.ir_faixas.push({ ate_dias: k === 3 ? null : Number(val('mcrIrDias' + k)), aliquota_pct: aliq });
    }
    for (var j = 0; j < 3; j++) {
      var nome = val('mcrProdNome' + j).trim();
      if (!nome) continue;
      var id = val('mcrProdId' + j) || nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      d.produtos.push({ id: id, nome: nome, indexador: val('mcrProdIdx' + j), pct_indexador: taxa(val('mcrProdPct' + j)),
        isento_ir_pf: !!(document.getElementById('mcrProdIsento' + j) || {}).checked, garantia: val('mcrProdGar' + j) });
    }
    ['selic_aa', 'cdi_aa', 'cdi_12m_pct', 'focus_ipca_pct'].forEach(function (c) { if (!(d[c] > 0)) erros.push('Preencha ' + c.replace(/_/g, ' ') + ' com um número (ex.: 13,75).'); });
    if (!d.vigencia || !d.cdi_12m_ate || !d.focus_data) erros.push('Preencha as datas.');
    if (!d.fonte) erros.push('Informe a fonte.');
    if (!(d.fgc_limite_instituicao > 0) || !(d.fgc_teto_total > 0) || !(d.fgc_teto_anos > 0)) erros.push('Preencha os valores do FGC.');
    if (!d.produtos.length) erros.push('Informe ao menos um produto.');
    if (d.cdi_aa > d.selic_aa) erros.push('CDI acima da Selic: confira.');
    return { dados: d, erros: erros };
  }

  function resumoHtml(d) {
    function pct(v) { return n2(v) + '%'; }
    return '<div class="mcrResumo"><p><b>Vigência ' + esc(dataBr(d.vigencia)) + '</b> · Selic ' + pct(d.selic_aa) + ' · CDI ' + pct(d.cdi_aa) + ' · CDI 12 meses ' + pct(d.cdi_12m_pct) + ' (até ' + esc(dataBr(d.cdi_12m_ate)) + ')</p>' +
      '<p>Focus de ' + esc(dataBr(d.focus_data)) + ': ' + d.focus_selic.map(function (f) { return 'fim de ' + f.fim_de + ' ' + pct(f.selic_aa); }).join(', ') + ' · IPCA ' + d.focus_ipca_ano + ' ' + pct(d.focus_ipca_pct) + '</p>' +
      '<p>IR: ' + d.ir_faixas.map(function (f) { return (f.ate_dias == null ? 'acima' : 'até ' + f.ate_dias + ' dias') + ' ' + pct(f.aliquota_pct); }).join('; ') + '</p>' +
      '<p>FGC: R$ ' + n0(d.fgc_limite_instituicao) + ' por CPF por instituição, teto R$ ' + n0(d.fgc_teto_total) + ' a cada ' + d.fgc_teto_anos + ' anos</p>' +
      '<p>Produtos: ' + d.produtos.map(function (p) { return esc(p.nome) + ' (' + n2(p.pct_indexador) + '% ' + p.indexador + (p.isento_ir_pf ? ', isento' : '') + ', ' + p.garantia + ')'; }).join('; ') + '</p>' +
      '<p class="note">Fonte: ' + esc(d.fonte) + '</p></div>';
  }

  function render(panel, ctx) {
    var html = '<h2>Referências de Mercado</h2><p class="note">Taxas usadas pela Brabus IA nos argumentos de Cash Conversion. Só o Master atualiza.' +
      'Passados 50 dias da vigência, a IA avisa que as taxas podem estar desatualizadas (o intervalo entre reuniões do Copom chega a 49 dias).</p>';
    if (!ctx.producao) html += '<p class="note gbWarn gbHomologBanner">🧪 MODO HOMOLOGAÇÃO — a gravação é simulada; nada é alterado no banco.</p>';
    if (estado.mensagem) html += '<p class="note ' + (estado.mensagem.ok ? 'mcrOk' : 'gbWarn') + '">' + esc(estado.mensagem.texto) + '</p>';
    if (estado.carregando) {
      panel.innerHTML = html + '<div class="modLoadingState"><span class="modLoadingDot"></span>Carregando a referência vigente...</div>';
      return;
    }
    if (estado.erro) html += '<p class="note gbWarn">' + esc(estado.erro) + '</p>';
    var r = estado.ref;
    if (r) {
      html += '<div class="mcrVigente"><p class="kpiLabel">Referência vigente</p><p><b>' + esc(dataBr(r.vigencia)) + '</b> (há ' + r.dias_desde_vigencia + ' dias)' +
        (r.desatualizada ? ' <span class="mcrAtraso">desatualizada: passou de 50 dias</span>' : '') + ' · Selic ' + n2(r.selic_aa) + '% · CDI ' + n2(r.cdi_aa) + '%</p></div>';
    } else if (!estado.erro) {
      html += '<p class="note gbWarn">Ainda não há referência vigente cadastrada.</p>';
    }
    if (estado.confirmar) {
      html += '<h3>Confirme a nova referência</h3>' + resumoHtml(estado.confirmar) +
        '<div class="mcrAcoes"><button type="button" class="modBtnPrimary" id="mcrConfirmar">' + (ctx.producao ? 'Confirmar e gravar' : 'Confirmar (simulado)') + '</button>' +
        '<button type="button" class="modBtnGhost" id="mcrVoltar">Voltar e editar</button></div>';
      panel.innerHTML = html;
      document.getElementById('mcrVoltar').onclick = function () { estado.confirmar = null; render(panel, ctx); };
      document.getElementById('mcrConfirmar').onclick = function () { gravar(panel, ctx); };
      return;
    }
    panel.innerHTML = html + formHtml(r, ctx.producao);
    document.getElementById('mcrSalvar').onclick = function () {
      var c = coletar();
      if (c.erros.length) { estado.mensagem = { ok: false, texto: c.erros.join(' ') }; render(panel, ctx); return; }
      estado.mensagem = null; estado.confirmar = c.dados; render(panel, ctx);
    };
  }

  function gravar(panel, ctx) {
    var d = estado.confirmar;
    if (!ctx.producao) {
      estado.confirmar = null;
      estado.mensagem = { ok: true, texto: 'Simulado: a referência de ' + dataBr(d.vigencia) + ' passou na conferência da tela. Em produção ela seria gravada (o banco confere de novo).' };
      render(panel, ctx); return;
    }
    var bt = document.getElementById('mcrConfirmar'); if (bt) { bt.disabled = true; bt.textContent = 'Gravando...'; }
    rpc('master_salvar_cash_referencias_mercado', { p_dados: d }).then(function (res) {
      estado.confirmar = null;
      if (res && res.sucesso) {
        estado.mensagem = { ok: true, texto: 'Referência de ' + dataBr(d.vigencia) + ' gravada. A Brabus IA passa a usá-la' + (d.vigencia > hojeSP() ? ' a partir dessa data.' : ' agora (quem estiver com a tela aberta precisa recarregar).') };
        carregar(panel, ctx);
      } else {
        estado.mensagem = { ok: false, texto: (res && res.mensagem) || 'O banco recusou a referência.' };
        render(panel, ctx);
      }
    }, function (e) {
      estado.mensagem = { ok: false, texto: (e && e.message) || 'Não foi possível gravar.' };
      render(panel, ctx);
    });
  }

  function carregar(panel, ctx) {
    estado.carregando = true; estado.erro = null; render(panel, ctx);
    rpc('cash_referencias_mercado').then(function (r) {
      estado.ref = r; estado.carregando = false; render(panel, ctx);
    }, function (e) {
      estado.ref = null; estado.carregando = false; estado.erro = 'Não foi possível ler a referência vigente: ' + ((e && e.message) || 'erro') + '.'; render(panel, ctx);
    });
  }

  window.NX_MASTER_CASH_REF = {
    entrar: function (panel, ctx) { estado.confirmar = null; estado.mensagem = null; carregar(panel, ctx); },
    render: render,
    _coletar: coletar
  };
})();
