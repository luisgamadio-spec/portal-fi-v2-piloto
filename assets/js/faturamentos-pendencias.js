/* PORTAL-NEXT V2 — aviso "Retorno urgente solicitado pelo Financeiro" (10/11/2026, OK do Luis).
   A cada acesso ao Portal (login ou recarga), quem é Analista pergunta ao banco se há pedidos de retorno urgente
   em aberto nas lojas em que ele é o Analista responsável VIGENTE (faturamentos_minhas_pendencias; se o Master
   trocar o responsável, as pendências passam para o novo). Havendo, mostra este aviso. Ele volta em todo acesso até o
   responsável registrar a justificativa da proposta na Análise de Faturamentos. Sem CPF e sem nome do cliente.
   No homolog, só a conta de teste recebe pendências (pedidos feitos no homolog são teste).
   10/11/2026 (pedido do Luis): "Fechar por agora" continua, mas o aviso volta a cada acesso E a cada 30 minutos com o
   Portal aberto, até a justificativa ser registrada (a cada 30 min pergunta de novo ao banco; sem pendência, nada aparece). */
(function () {
  'use strict';

  var LOJA = { ABC: 'ABC', ALPHAVILLE: 'Alphaville', 'ANALIA FRANCO': 'Anália Franco', BANDEIRANTES: 'Bandeirantes',
    'BARRA FUNDA': 'Barra Funda', EUROPA: 'Europa', GASTAO: 'Gastão', NACOES: 'Nações' };
  var mostrado = false, focoAntes = null, timer = null, ultima = 0;
  // 30 minutos; window.NX_FAT_AVISO_INTERVALO_MS só existe para teste automático
  function intervalo() { var t = Number(window.NX_FAT_AVISO_INTERVALO_MS); return t > 0 ? t : 30 * 60 * 1000; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function dataHora(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' + d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }
  function titulo(s) { return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }); }

  function buscar() {
    var cfg = window.NX_INTELLIGENCE_CONFIG || {};
    if (!cfg.supabaseUrl || !window.NX_AUTH || typeof window.NX_AUTH.getAccessToken !== 'function') return Promise.resolve([]);
    return window.NX_AUTH.getAccessToken().then(function (token) {
      if (!token) return [];
      return fetch(cfg.supabaseUrl + '/rest/v1/rpc/faturamentos_minhas_pendencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'Authorization': 'Bearer ' + token },
        body: '{}'
      }).then(function (r) { return r.ok ? r.json() : []; });
    }).catch(function () { return []; });
  }

  function fechar() {
    var v = document.getElementById('fatAvisoVeu');
    if (v) v.remove();
    document.removeEventListener('keydown', onKey, true);
    if (focoAntes && focoAntes.focus) { try { focoAntes.focus(); } catch (e) { /* nada */ } }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); return; }
    if (e.key === 'Tab') {
      var l = document.querySelectorAll('#fatAvisoVeu button');
      if (!l.length) return;
      if (e.shiftKey && document.activeElement === l[0]) { e.preventDefault(); l[l.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === l[l.length - 1]) { e.preventDefault(); l[0].focus(); }
    }
  }

  function mostrar(lista) {
    if (!lista.length || document.getElementById('fatAvisoVeu')) return;
    focoAntes = document.activeElement;
    var n = lista.length;
    var veu = document.createElement('div');
    veu.id = 'fatAvisoVeu';
    veu.className = 'fatAvisoVeu';
    veu.innerHTML = '<div class="fatAvisoCaixa" role="alertdialog" aria-modal="true" aria-labelledby="fatAvisoTitulo" aria-describedby="fatAvisoTexto">' +
      '<h2 id="fatAvisoTitulo">Retorno urgente solicitado pelo Financeiro</h2>' +
      '<p id="fatAvisoTexto">' + (n === 1 ? 'Há <b>1 proposta faturada</b>' : 'Há <b>' + n + ' propostas faturadas</b>') +
      ' sem pagamento do banco aguardando a sua justificativa na Análise de Faturamentos. Este aviso aparece a cada acesso até a justificativa ser registrada.</p>' +
      '<ul class="fatAvisoLista">' + lista.map(function (p) {
        var d = p.dados || {};
        return '<li><div><b>' + esc(d.chassi || 'sem chassi ligado') + '</b> · ' + esc(d.modelo || '—') +
          '<small>' + esc(LOJA[p.loja] || p.loja || '—') + ' · ' + esc(d.banco || '—') + ' · ' + esc(d.dias) + ' dias úteis em aberto · pedido em ' + esc(dataHora(p.solicitado_em)) +
          (p.solicitado_por ? ' por ' + esc(titulo(p.solicitado_por)) : '') + (p.teste ? ' · TESTE' : '') + '</small></div>' +
          '<button type="button" class="fatAvisoAbrir" data-proposta="' + esc(p.proposta) + '">Abrir e justificar</button></li>';
      }).join('') + '</ul>' +
      '<div class="fatAvisoAcoes"><button type="button" class="fatAvisoFechar">Fechar por agora</button></div></div>';
    veu.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.classList.contains('fatAvisoAbrir')) {
        window.NX_FAT_ABRIR = b.getAttribute('data-proposta');
        fechar(); focoAntes = null;
        if (window.NX_ROUTER && typeof window.NX_ROUTER.navigate === 'function') window.NX_ROUTER.navigate('analise-faturamentos');
        else location.hash = '#/analise-faturamentos';
      } else if (b.classList.contains('fatAvisoFechar')) fechar();
    });
    document.body.appendChild(veu);
    document.addEventListener('keydown', onKey, true);
    var pri = veu.querySelector('.fatAvisoAbrir');
    if (pri) pri.focus();
  }

  function verificar(ctx) {
    if (!ctx || ctx.perfil !== 'ANALISTA') return;   // só Analistas são responsáveis por loja
    ultima = Date.now();
    buscar().then(function (l) { if (Array.isArray(l)) mostrar(l); });
  }
  function agendar() {
    parar();
    timer = setInterval(function () {
      if (!window.NX_AUTH_CORE || window.NX_AUTH_CORE.getState() !== 'AUTHORIZED') return;
      verificar(window.NX_AUTH_CORE.getContext());
    }, intervalo());
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }
  // aba que ficou em segundo plano (o navegador atrasa o relógio): ao voltar, confere se já passou o intervalo
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !timer || Date.now() - ultima < intervalo()) return;
    if (window.NX_AUTH_CORE && window.NX_AUTH_CORE.getState() === 'AUTHORIZED') verificar(window.NX_AUTH_CORE.getContext());
  });

  function ligar() {
    if (!window.NX_AUTH_CORE || typeof window.NX_AUTH_CORE.onStateChange !== 'function') return;
    window.NX_AUTH_CORE.onStateChange(function (state, ctx) {
      if (state === 'AUTHORIZED') { if (!mostrado) { mostrado = true; verificar(ctx); if (ctx && ctx.perfil === 'ANALISTA') agendar(); } }
      else { mostrado = false; parar(); fechar(); }
    });
    // se o Portal já estava liberado quando este arquivo carregou
    if (window.NX_AUTH_CORE.getState && window.NX_AUTH_CORE.getState() === 'AUTHORIZED' && !mostrado) {
      mostrado = true; verificar(window.NX_AUTH_CORE.getContext());
      var c0 = window.NX_AUTH_CORE.getContext(); if (c0 && c0.perfil === 'ANALISTA') agendar();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();

  window.NX_FAT_PENDENCIAS = { verificar: function () { verificar(window.NX_AUTH_CORE && window.NX_AUTH_CORE.getContext()); } };
})();
