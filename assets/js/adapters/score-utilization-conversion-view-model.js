/* PORTAL-NEXT V2 -- Score / Utilização + Conversão.

   Regra comercial final aprovada (IMPLEMENTAÇÃO FINAL: CONVERSÃO + UTILIZAÇÃO
   70+30 -- substitui exclusivamente o critério experimental anterior de
   Frequência/Diversidade, score-utilization-scoring-experimental.js --
   aquele arquivo permanece intacto e ainda é usado pelo modo de
   demonstração/fixture, nunca em produção real, onde NX_AUTH.
   isAuthConfigured é sempre true).

   PURE FORMULA ONLY -- no RPC, no DOM, no resolução de identidade. S
   (simulações), V (vendas) e F (financiamentos) são fornecidos já
   resolvidos pelo chamador (score.js): S vem da RPC governada já filtrada
   por VENDEDOR/usuario_id real/departamento; V/F vêm das próprias linhas
   já computadas por calcScores() (r.vendas/r.fin), mesmo período oficial
   do Score, nunca recalculados.

   REGRA (aprovada por Luis, não deve ganhar critérios mínimos, penalidades
   ou ponderações além do que está aqui):
     V === 0                        -> 0 pts, SEM_OPORTUNIDADE_REGISTRADA
     S > 0, V > 0, F > 0            -> C + U pts, CONVERSAO_COM_UTILIZACAO
       C (conversão, máx 70)  = 70 * MIN(1, F / V)
       U (utilização, máx 30) = 30 * MIN(1, S / (2 * V))
     S > 0, V > 0, F === 0          -> 0 pts, UTILIZACAO_SEM_FINANCIAMENTO
     S === 0, V > 0, F === 0        -> 0 pts, ATENCAO (marcação visual, não desconta)
     S === 0, V > 0, F > 0          -> 0 pts, FINANCIOU_SEM_UTILIZAR (sem marcação)
   Não pontuar somente por realizar simulações -- só há pontos quando
   S>0 E V>0 E F>0 simultaneamente. Teto absoluto sempre 100 (70+30);
   simulações/financiamentos adicionais após o teto nunca penalizam.
   `inconsistente` sinaliza F > V (financiamentos acima das vendas do
   mesmo vendedor/depto/período) -- ainda pontuado com o teto normal,
   apenas marcado para revisão comercial, nunca bloqueado. */
(function () {
  'use strict';

  function classify(S, V, F) {
    S = Number(S) || 0; V = Number(V) || 0; F = Number(F) || 0;
    if (V === 0) return { pontos: 0, conversao: 0, utilizacao: 0, status: 'SEM_OPORTUNIDADE_REGISTRADA', atencao: false, inconsistente: false, S: S, V: V, F: F };
    if (S > 0 && F > 0) {
      var conversao = 70 * Math.min(1, F / V);
      var utilizacao = 30 * Math.min(1, S / (2 * V));
      return { pontos: conversao + utilizacao, conversao: conversao, utilizacao: utilizacao, status: 'CONVERSAO_COM_UTILIZACAO', atencao: false, inconsistente: F > V, S: S, V: V, F: F };
    }
    if (S > 0 && F === 0) return { pontos: 0, conversao: 0, utilizacao: 0, status: 'UTILIZACAO_SEM_FINANCIAMENTO', atencao: false, inconsistente: false, S: S, V: V, F: F };
    if (S === 0 && F === 0) return { pontos: 0, conversao: 0, utilizacao: 0, status: 'ATENCAO', atencao: true, inconsistente: false, S: S, V: V, F: F };
    // S === 0 && F > 0
    return { pontos: 0, conversao: 0, utilizacao: 0, status: 'FINANCIOU_SEM_UTILIZAR', atencao: false, inconsistente: F > V, S: S, V: V, F: F };
  }

  // Score de outubro/2026 (decisão de Luis, 07/10/2026, "opção 1"): dias sem
  // dados de telemetria (V2 em produção sem registrar uso dos simuladores)
  // ficam FORA da utilização. Conversão continua no período inteiro
  // (F e V completos); utilização usa só os dias com dados:
  //   Sd = simulações nos dias com dados; Vd/Fd = vendas/financiamentos
  //   nesses mesmos dias.
  //   V === 0                    -> SEM_OPORTUNIDADE_REGISTRADA (igual)
  //   F === 0                    -> Sd > 0 ? UTILIZACAO_SEM_FINANCIAMENTO : ATENCAO
  //   F > 0, Sd > 0              -> C + 30 * MIN(1, Sd / (2 * Vd)) (Vd = 0 -> teto 30)
  //   F > 0, Sd = 0, Fd > 0      -> FINANCIOU_SEM_UTILIZAR (financiou em dia medido sem simular)
  //   F > 0, Sd = 0, Fd = 0      -> só C, UTILIZACAO_NAO_MEDIDA (todos os financiamentos
  //                                 caíram em dias sem dados: não há como medir o uso)
  // Sem dias excluídos no período, chamar classify() -- comportamento idêntico ao anterior.
  function classifyExcludingGap(Sd, V, F, Vd, Fd) {
    Sd = Number(Sd) || 0; V = Number(V) || 0; F = Number(F) || 0; Vd = Number(Vd) || 0; Fd = Number(Fd) || 0;
    var base = { S: Sd, V: V, F: F, Vd: Vd, Fd: Fd, gapAdjusted: true };
    function out(o) { for (var k in base) o[k] = base[k]; return o; }
    if (V === 0) return out({ pontos: 0, conversao: 0, utilizacao: 0, status: 'SEM_OPORTUNIDADE_REGISTRADA', atencao: false, inconsistente: false });
    if (F === 0) return out(Sd > 0
      ? { pontos: 0, conversao: 0, utilizacao: 0, status: 'UTILIZACAO_SEM_FINANCIAMENTO', atencao: false, inconsistente: false }
      : { pontos: 0, conversao: 0, utilizacao: 0, status: 'ATENCAO', atencao: true, inconsistente: false });
    var conversao = 70 * Math.min(1, F / V);
    if (Sd > 0) {
      var utilizacao = 30 * (Vd > 0 ? Math.min(1, Sd / (2 * Vd)) : 1);
      return out({ pontos: conversao + utilizacao, conversao: conversao, utilizacao: utilizacao, status: 'CONVERSAO_COM_UTILIZACAO', atencao: false, inconsistente: F > V });
    }
    if (Fd > 0) return out({ pontos: 0, conversao: 0, utilizacao: 0, status: 'FINANCIOU_SEM_UTILIZAR', atencao: false, inconsistente: F > V });
    return out({ pontos: conversao, conversao: conversao, utilizacao: 0, status: 'UTILIZACAO_NAO_MEDIDA', atencao: false, inconsistente: F > V });
  }

  var STATUS_LABELS = {
    UTILIZACAO_NAO_MEDIDA: 'Utilização não medida (dias sem dados)',
    CONVERSAO_COM_UTILIZACAO: 'Conversão com utilização',
    UTILIZACAO_SEM_FINANCIAMENTO: 'Utilização sem financiamento',
    ATENCAO: 'Atenção',
    FINANCIOU_SEM_UTILIZAR: 'Financiou sem utilizar',
    SEM_OPORTUNIDADE_REGISTRADA: 'Sem oportunidade registrada'
  };

  // Janelas sem dados de telemetria (datas inclusivas, AAAA-MM-DD, America/Sao_Paulo).
  // end: null = ainda aberta (até a publicação da telemetria em produção) --
  // preencher com a data da publicação quando ela acontecer.
  // Fechada em 07/10/2026: telemetria do V2 publicada em produção nesse dia (piloto, à noite);
  // a partir de 08/10 a utilização volta a contar normalmente.
  var TELEMETRY_GAPS = [{ start: '2026-10-07', end: '2026-10-07', motivo: 'V2 em produção sem telemetria dos simuladores' }];

  function isoAddDays(iso, n) {
    var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  // Partes do período [start, end] FORA das janelas sem dados, e os dias excluídos.
  // `today` fecha uma janela aberta (end null).
  function splitPeriodByGaps(start, end, today, gaps) {
    gaps = gaps || TELEMETRY_GAPS;
    var parts = [{ start: start, end: end }];
    var excluded = [];
    gaps.forEach(function (g) {
      var gs = g.start, ge = g.end || today || end;
      var next = [];
      parts.forEach(function (p) {
        if (ge < p.start || gs > p.end) { next.push(p); return; }
        excluded.push({ start: gs > p.start ? gs : p.start, end: ge < p.end ? ge : p.end });
        if (gs > p.start) next.push({ start: p.start, end: isoAddDays(gs, -1) });
        if (ge < p.end) next.push({ start: isoAddDays(ge, 1), end: p.end });
      });
      parts = next;
    });
    return { dataParts: parts, excluded: excluded, hasGap: excluded.length > 0 };
  }
  function isInParts(dateIso, parts) {
    var d = String(dateIso || '').slice(0, 10);
    for (var i = 0; i < parts.length; i++) if (d >= parts[i].start && d <= parts[i].end) return true;
    return false;
  }

  window.NX_SCORE_CONVERSION_VM = {
    classify: classify, classifyExcludingGap: classifyExcludingGap, STATUS_LABELS: STATUS_LABELS,
    TELEMETRY_GAPS: TELEMETRY_GAPS, splitPeriodByGaps: splitPeriodByGaps, isInParts: isInParts
  };
})();
