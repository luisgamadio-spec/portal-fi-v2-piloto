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

  var STATUS_LABELS = {
    CONVERSAO_COM_UTILIZACAO: 'Conversão com utilização',
    UTILIZACAO_SEM_FINANCIAMENTO: 'Utilização sem financiamento',
    ATENCAO: 'Atenção',
    FINANCIOU_SEM_UTILIZAR: 'Financiou sem utilizar',
    SEM_OPORTUNIDADE_REGISTRADA: 'Sem oportunidade registrada'
  };

  window.NX_SCORE_CONVERSION_VM = { classify: classify, STATUS_LABELS: STATUS_LABELS };
})();
