/* PORTAL-NEXT V2 -- Painel Master / Pendências Cadastrais view-model
   (Painel Master Phase PM-4C.2).

   PRESENTATION ONLY, per Gate 10 of this Phase's own brief: type/
   severity/status/origin labels, recommended-action copy, date
   formatting, masked-identifier passthrough, decision-history/summary
   helpers. No RPC transport (assets/js/adapters/master-pendencias-
   provider.js owns that), no DOM. Path deliberately NOT under
   assets/js/adapters/ -- the Phase brief (Gates 10/72) names this exact
   location, unlike every sibling view-model in this codebase.

   Taxonomy/severity/status/origin values below are copied verbatim
   from the real, already-deployed source of truth: portal_cadastro_
   alertas' own CHECK constraints (supabase/migrations/
   20260818150000_fase212_governanca_alertas_cadastrais.sql) and
   assets/js/master-pendencias-cadastrais.js's PC_TIPOS/PC_TIPO_
   EXPLICACAO/PC_SEVERIDADES/PC_STATUS_LABEL/PC_ORIGENS (ia-
   reconciliation-v2-local) -- confirmed byte-identical between the DB
   constraint and the V1 frontend during PM-4C.1's own audit. No type
   invented, none dropped (Gate 11).

   Masking (Gate 14): `identificador_mascarado` arrives ALREADY masked
   by the RPC itself (public.mascarar_identificador_cadastro -- a
   THIRD, distinct convention in this codebase: last-4-visible, e.g.
   "*******1234"). This file never reconstructs/derives a raw
   identifier from it and never applies either of the other two
   masking conventions already used elsewhere in Painel Master
   (Usuários' last-2-visible maskCpf(), Auditoria's first-3-visible
   maskCpfFicha()) -- those would be a WRONG shape for this surface,
   not an equivalent one. */
(function () {
  'use strict';

  var PC_TIPOS = {
    NOVO_CADASTRO_NECESSARIO: 'Novo cadastro necessário',
    ATUALIZACAO_CADASTRAL_NECESSARIA: 'Atualização cadastral necessária',
    CORRESPONDENCIA_INDETERMINADA: 'Correspondência indeterminada',
    NBS_DIVERGENTE: 'Login NBS divergente',
    LOJA_DIVERGENTE: 'Loja divergente',
    DEPARTAMENTO_DIVERGENTE: 'Departamento divergente',
    IDENTIFICADOR_DUPLICADO: 'Identificador duplicado',
    USUARIO_INATIVO_COM_PRODUCAO: 'Usuário inativo com produção',
    FATO_SEM_VENDEDOR_ATRIBUIDO: 'Fato sem vendedor atribuído',
    OUTRO: 'Outro'
  };
  // Real explanation of WHY the alert exists, by type -- the RPC never
  // returns ready-made reason text except for FATO_SEM_VENDEDOR_
  // ATRIBUIDO (its own `motivo` field, backend-supplied); this text is
  // only descriptive of the already-authorized `tipo` code, never an
  // inference over fields the RPC didn't return (same precedent as
  // V1's own PC_TIPO_EXPLICACAO).
  var PC_TIPO_EXPLICACAO = {
    NOVO_CADASTRO_NECESSARIO: 'Nenhum usuário ativo foi encontrado para este identificador — pode ser necessário criar um novo cadastro.',
    ATUALIZACAO_CADASTRAL_NECESSARIA: 'O identificador corresponde a um usuário cadastrado, mas os dados encontrados na base divergem do cadastro atual.',
    CORRESPONDENCIA_INDETERMINADA: 'Não foi possível determinar com segurança a qual usuário cadastrado este registro pertence.',
    NBS_DIVERGENTE: 'O CPF da operação corresponde a este usuário, mas o Login NBS da base diverge do cadastro atual.',
    LOJA_DIVERGENTE: 'O identificador corresponde a este usuário, mas a loja encontrada na base diverge da loja cadastrada atualmente.',
    DEPARTAMENTO_DIVERGENTE: 'O identificador corresponde a este usuário, mas o departamento encontrado na base diverge do departamento cadastrado atualmente.',
    IDENTIFICADOR_DUPLICADO: 'Este identificador foi encontrado associado a mais de um usuário cadastrado.',
    USUARIO_INATIVO_COM_PRODUCAO: 'O identificador corresponde a um usuário atualmente inativo, mas há produção registrada em seu nome.',
    FATO_SEM_VENDEDOR_ATRIBUIDO: null,
    OUTRO: null
  };
  var PC_ORIGENS = {
    SALES_CURRENT: 'Base 01 (Atual)',
    SALES_HISTORY: 'Base 01 (Histórico)',
    FINANCE_CURRENT: 'Base 02 (Atual)',
    FINANCE_HISTORY: 'Base 02 (Histórico)'
  };
  var PC_SEVERIDADES = {
    URGENTE: { emoji: '🔴', label: 'Urgente', cls: 'pcSevUrgente' },
    ATENCAO: { emoji: '🟡', label: 'Atenção', cls: 'pcSevAtencao' },
    INFORMATIVO: { emoji: '⚪', label: 'Informativo', cls: 'pcSevInformativo' }
  };
  var PC_STATUS_LABEL = { PENDENTE: 'Pendente', RESOLVIDO: 'Resolvido', IGNORADO: 'Ignorado', EXCLUIDO: 'Excluído' };
  var PC_STATUS_CLASSE = { PENDENTE: 'maBadgePending', RESOLVIDO: 'maBadgeActive', IGNORADO: 'maBadgeInvited', EXCLUIDO: 'maBadgeInactive' };
  // Real motivo enum shared by ignorar/excecao_criar (portal_cadastro_
  // excecoes' own CHECK constraint).
  var PC_MOTIVOS_IGNORAR = [
    ['FROTA', 'Frota'], ['REVENDA', 'Revenda'], ['ATACADO', 'Atacado'],
    ['COLABORADOR_DESLIGADO', 'Colaborador desligado'], ['FORA_DO_ESCOPO', 'Fora do escopo'],
    ['TESTE', 'Teste'], ['OUTRO', 'Outro']
  ];
  var PC_TABS = [
    ['TODOS', 'Todos', {}],
    ['PENDENTES', 'Pendentes', { status: 'PENDENTE' }],
    ['URGENTES', 'Urgentes', { status: 'PENDENTE', severidade: 'URGENTE' }],
    ['IGNORADOS', 'Ignorados', { status: 'IGNORADO' }],
    ['RESOLVIDOS', 'Resolvidos', { status: 'RESOLVIDO' }],
    ['EXCLUIDOS', 'Excluídos', { status: 'EXCLUIDO' }]
  ];

  function formatDateTimeBR(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR');
  }

  function tipoLabel(tipo) { return PC_TIPOS[tipo] || tipo || '—'; }
  function origemLabel(origem) { return PC_ORIGENS[origem] || origem || '—'; }
  function severidadeInfo(sev) { return PC_SEVERIDADES[sev] || PC_SEVERIDADES.INFORMATIVO; }
  function statusLabel(status) { return PC_STATUS_LABEL[status] || status || '—'; }
  function statusClasse(status) { return PC_STATUS_CLASSE[status] || 'maBadgeInvited'; }

  // Gate 27/37 -- per-type recommended action, DATA ONLY (kind +
  // parameters); the controller decides what button/copy to render.
  // Never invents a one-click fix where V1's own real implementation
  // has none (CORRESPONDENCIA_INDETERMINADA/IDENTIFICADOR_DUPLICADO/
  // OUTRO): those stay manual-review guidance, exactly as V1 frames
  // them ("esta tela não escolhe/adivinha").
  // Gate 36 -- LOJA_DIVERGENTE/DEPARTAMENTO_DIVERGENTE: V1 routes to a
  // temporal "Mudança de Loja — Vendedores" tab that does not exist yet
  // in V2 (out of scope, not built here) -- kind stays VER_USUARIO
  // (the real, already-existing capability) with the temporal-caveat
  // text, never a fabricated flat-overwrite mutation.
  function recomendacaoParaLinha(r) {
    var usuarioId = r.usuario_candidato_id || null;
    var semCandidato = { kind: 'SEM_CANDIDATO', texto: 'Não há um cadastro candidato determinado para esta pendência. Revise manualmente em Painel Master → Usuários.' };
    switch (r.tipo) {
      case 'NOVO_CADASTRO_NECESSARIO':
        return { kind: 'CADASTRAR_CONVIDAR', texto: 'Nenhum usuário ativo corresponde a este identificador. Cadastre ou convide o usuário em Usuários — confira nome, loja e Login NBS encontrados na base antes de enviar o convite.' };
      case 'NBS_DIVERGENTE':
        return usuarioId
          ? { kind: 'CORRIGIR_NBS', usuarioId: usuarioId, texto: 'O CPF corresponde a este usuário, mas o Login NBS do cadastro diverge do encontrado na base. Confirme o valor correto para corrigir o cadastro — a resolução do alerta só acontece depois que a correção for aplicada com sucesso.' }
          : semCandidato;
      case 'LOJA_DIVERGENTE':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, foco: 'loja', texto: 'Existe uma arquitetura temporal de loja (Mudança de Loja — Vendedores). Se a divergência é sobre a loja ATUAL do vendedor, edite o cadastro em Usuários — nunca sobrescreva o histórico de um período anterior pelo status atual.' }
          : semCandidato;
      case 'DEPARTAMENTO_DIVERGENTE':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, foco: 'departamento', texto: 'Mesma lógica temporal do departamento: se o departamento ATUAL do vendedor mudou, edite o cadastro em Usuários — se a divergência é sobre um período específico, esse ajuste pertence a Mudança de Loja — Vendedores.' }
          : semCandidato;
      case 'USUARIO_INATIVO_COM_PRODUCAO':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, texto: 'Existe produção registrada em nome deste cadastro, porém o usuário está inativo. Avalie o histórico antes de decidir — reativação não é automática.' }
          : semCandidato;
      case 'IDENTIFICADOR_DUPLICADO':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, texto: 'Este identificador foi encontrado associado a mais de um cadastro. Esta tela não escolhe automaticamente qual está certo — revise os cadastros correspondentes manualmente.' }
          : { kind: 'REVISAR_USUARIOS', texto: 'Este identificador foi encontrado associado a mais de um cadastro. Esta tela não escolhe automaticamente qual está certo — revise os cadastros correspondentes manualmente em Usuários.' };
      case 'CORRESPONDENCIA_INDETERMINADA':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, texto: 'Não foi possível determinar com segurança a qual cadastro este registro pertence. Revise as evidências manualmente — esta tela não tenta adivinhar.' }
          : { kind: 'REVISAR_USUARIOS', texto: 'Não foi possível determinar com segurança a qual cadastro este registro pertence. Revise as evidências manualmente em Usuários — esta tela não tenta adivinhar.' };
      case 'ATUALIZACAO_CADASTRAL_NECESSARIA':
        return usuarioId
          ? { kind: 'VER_USUARIO', usuarioId: usuarioId, texto: 'O identificador corresponde a este cadastro, mas algum dado encontrado na base diverge do cadastro atual — compare os valores acima com a ficha do usuário para identificar qual campo mudou.' }
          : semCandidato;
      case 'FATO_SEM_VENDEDOR_ATRIBUIDO':
        return { kind: 'INFORMATIVO', texto: r.motivo || 'Um ou mais registros importados não trouxeram identificador de vendedor. Não há cadastro para direcionar — este alerta é só informativo.' };
      default:
        return { kind: 'REVISAR_MANUAL', texto: 'Revise manualmente — este tipo de alerta não tem uma ação automática associada.' };
    }
  }

  function buildPendenciaRow(r) {
    var sev = severidadeInfo(r.severidade);
    return {
      id: r.id,
      tipo: r.tipo,
      tipoLabel: tipoLabel(r.tipo),
      severidade: r.severidade,
      severidadeInfo: sev,
      status: r.status,
      statusLabel: statusLabel(r.status),
      statusClasse: statusClasse(r.status),
      origemBase: r.origem_base,
      origemLabel: origemLabel(r.origem_base),
      identificadorTipo: r.identificador_tipo || null,
      identificadorMascarado: r.identificador_mascarado || null,
      nomeEncontrado: r.nome_encontrado || null,
      loginNbsEncontrado: r.login_nbs_encontrado || null,
      lojaEncontrada: r.loja_encontrada || null,
      departamentoEncontrado: r.departamento_encontrado || null,
      usuarioCandidatoId: r.usuario_candidato_id || null,
      nomeUsuarioCandidato: r.nome_usuario_candidato || null,
      motivo: r.motivo || null,
      primeiraOcorrenciaEm: r.primeira_ocorrencia_em || null,
      primeiraOcorrenciaEmFormatted: formatDateTimeBR(r.primeira_ocorrencia_em),
      ultimaOcorrenciaEm: r.ultima_ocorrencia_em || null,
      ultimaOcorrenciaEmFormatted: formatDateTimeBR(r.ultima_ocorrencia_em),
      quantidadeOcorrencias: r.quantidade_ocorrencias || 0,
      motivoAcao: r.motivo_acao || null,
      resolvidoEmFormatted: r.resolvido_em ? formatDateTimeBR(r.resolvido_em) : null,
      ignoradoEmFormatted: r.ignorado_em ? formatDateTimeBR(r.ignorado_em) : null,
      excluidoEmFormatted: r.excluido_em ? formatDateTimeBR(r.excluido_em) : null,
      pessoaDisplay: r.nome_encontrado || r.identificador_mascarado || '(sem identificação)',
      explicacao: PC_TIPO_EXPLICACAO[r.tipo] || r.motivo || 'Situação cadastral que requer atenção do Master.',
      recomendacao: recomendacaoParaLinha(r)
    };
  }

  // Gate 17/53 -- computed strictly over the rows passed in (the
  // currently-loaded/filtered result set), never a separate/global
  // query. The controller must label this clearly as filter-scoped.
  function buildSummaryCards(rows) {
    var out = { pendentes: 0, urgentesPendentes: 0, ignorados: 0, resolvidos: 0 };
    (rows || []).forEach(function (r) {
      if (r.status === 'PENDENTE') {
        out.pendentes++;
        if (r.severidade === 'URGENTE') out.urgentesPendentes++;
      } else if (r.status === 'IGNORADO') {
        out.ignorados++;
      } else if (r.status === 'RESOLVIDO') {
        out.resolvidos++;
      }
    });
    return out;
  }

  // Gate 21 -- client-side text filter over an already-loaded set
  // (same technique already proven for Usuários/Auditoria), never a
  // per-keystroke RPC. Fields match V1's own pcFiltrarBusca() exactly.
  function filtrarBusca(rows, termo) {
    var q = String(termo || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (r) {
      var hay = [r.nomeEncontrado, r.loginNbsEncontrado, r.lojaEncontrada, r.departamentoEncontrado, r.nomeUsuarioCandidato, r.identificadorMascarado]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // How many OTHER pending rows (within the currently-loaded set) share
  // this row's normalized identifier -- informative only, matches V1's
  // own pcOcorrenciasRelacionadas() (real propagation happens server-
  // side over the true normalized value, this is a client-side hint).
  function ocorrenciasRelacionadas(rows, r) {
    if (!r.identificadorTipo || !r.identificadorMascarado) return 0;
    return (rows || []).filter(function (x) {
      return x.id !== r.id && x.status === 'PENDENTE' &&
        x.identificadorTipo === r.identificadorTipo &&
        x.identificadorMascarado === r.identificadorMascarado;
    }).length;
  }

  function buildExcecaoRow(e) {
    return {
      id: e.id,
      identificadorTipo: e.identificador_tipo,
      identificadorMascarado: e.identificador_mascarado || null,
      motivo: e.motivo || null,
      ativo: !!e.ativo,
      observacao: e.observacao || null,
      ocorrenciasSuprimidas: e.ocorrencias_suprimidas || 0,
      ultimaOcorrenciaSuprimidaEmFormatted: e.ultima_ocorrencia_suprimida_em ? formatDateTimeBR(e.ultima_ocorrencia_suprimida_em) : null,
      criadoPorNome: e.criado_por_nome || '—',
      criadoEmFormatted: formatDateTimeBR(e.criado_em),
      revogadoPorNome: e.revogado_por_nome || null,
      revogadoEmFormatted: e.revogado_em ? formatDateTimeBR(e.revogado_em) : null
    };
  }

  function buildAlertasViewModel(payload) {
    var rows = (payload.rows || []).map(buildPendenciaRow);
    return { rows: rows, total: payload.total || rows.length };
  }

  function buildExcecoesViewModel(payload) {
    var rows = (payload.rows || []).map(buildExcecaoRow);
    return { rows: rows, total: payload.total || rows.length };
  }

  window.NX_MASTER_PENDENCIAS_VIEW_MODEL = {
    PC_TIPOS: PC_TIPOS,
    PC_ORIGENS: PC_ORIGENS,
    PC_SEVERIDADES: PC_SEVERIDADES,
    PC_STATUS_LABEL: PC_STATUS_LABEL,
    PC_MOTIVOS_IGNORAR: PC_MOTIVOS_IGNORAR,
    PC_TABS: PC_TABS,
    tipoLabel: tipoLabel,
    origemLabel: origemLabel,
    severidadeInfo: severidadeInfo,
    statusLabel: statusLabel,
    statusClasse: statusClasse,
    formatDateTimeBR: formatDateTimeBR,
    buildPendenciaRow: buildPendenciaRow,
    buildAlertasViewModel: buildAlertasViewModel,
    buildExcecaoRow: buildExcecaoRow,
    buildExcecoesViewModel: buildExcecoesViewModel,
    buildSummaryCards: buildSummaryCards,
    filtrarBusca: filtrarBusca,
    ocorrenciasRelacionadas: ocorrenciasRelacionadas
  };
})();
