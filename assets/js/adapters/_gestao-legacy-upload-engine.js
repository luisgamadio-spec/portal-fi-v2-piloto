/* PORTAL-NEXT V2 -- Gestão RETIRED local upload/classification engine
   (Wave 2, RPC-shaped local contract reconciliation).

   DEAD LEGACY -- kept as historical reference only. NOT loaded by
   index.html/module-registry, NOT part of the active render path (not
   referenced by any <script> tag). This is the pre-Wave-2 client-side
   engine that re-derived store identity (lojaCurta), plan
   classification, and CPF/status/proposal-outcome aggregation locally
   from raw Base01/02/03-shaped upload rows -- i.e. duplicated backend
   authority that Wave 1's contract proof (production's
   operational_fandi_dashboard RPC) now supersedes. The active adapter
   is assets/js/adapters/gestao.adapter.js (thin: formatting + response
   validation only, no classification); the active local data source is
   assets/js/adapters/gestao-fixture-provider.js (RPC-shaped fixture,
   mechanical filtering, no classification).

   Global export renamed below (NX_GESTAO_ADAPTER ->
   NX_GESTAO_LEGACY_UPLOAD_ENGINE) and its NX_BUSINESS_ADAPTERS registry
   registration removed, so this file can never register itself as the
   active adapter even if accidentally included somewhere. Content is
   otherwise byte-identical to its last active version -- do not
   resurrect it as a runtime path; any future need for this logic
   should come from a fresh backend contract proof, not from reviving
   this file.

   Original header, preserved for provenance:
   PORTAL-NEXT V2 -- Gestao (Analise F&I do Grupo) Adapter (Gate 23-24:
   PURE EXTRACTION, programmatic, not hand-retyped -- see docs/
   GESTAO-ENGINE-AUDIT.md and docs/GESTAO-FUNCTION-MAP.md).
   SOURCE: git show origin/main:modules/analise-fi-grupo.html
   (portal-financiamento-brabus-secure) -- confirmed NOT divergent from
   the local clone this time (byte-identical local/origin/main/live
   production, see REPORT.md's PORTAL-NEXT-06 entry) -- still read
   from origin/main per standing discipline.

   38 functions + 5 constants below are copied BYTE-IDENTICAL from that
   source (verified: 0 unresolved external dependencies -- this
   module's classification/aggregation engine is fully self-contained,
   no DATA shim needed, unlike Score/Coparticipado). Do not "clean up",
   rename, reformat, or otherwise touch these lines -- any future
   change must come from a NEW extraction off a NEW production source
   (No Cleanup Drift discipline).

   ONE addition beyond the verbatim extraction: computePeriodPreset(),
   which is the pure date-arithmetic lifted out of the DOM-coupled
   applyPeriodPreset() (origin/main lines 1621-1630) -- the surrounding
   function reads/writes <input> elements directly and could not be
   extracted as-is; only the date math itself is reproduced, unchanged,
   clearly separated below and not mixed into the classification
   engine. */
(function () {
  'use strict';

  // ==== BEGIN byte-identical extraction from origin/main:modules/analise-fi-grupo.html ====
  const EXCLUDE_MODALIDADE = ["FINANCEIRA EXT.", "À VISTA", "A VISTA", "CONSÓRCIO", "CONSORCIO"];
  const OPERACIONAL = ["PAGA", "FATURADA", "AG. FATURAMENTO", "AGUARD. FATU.", "AGUARD FATU", "AG FATURAMENTO"];
  const STATUS_RECUSA_LIQUIDA = ["RECUSADA", "ENC. RECUS.", "PRÉ-RECUSA"];
  const STATUS_APROVACAO_HISTORICA = [
  "APROVADA", "ENCERRADA", "CANCELADA", "ASSINADA", "TRANSITO", "ENC. A VISTA",
  "FATURADA", "PAGA", "AG. FATURAMENTO", "AGUARD. FATU.", "AGUARD FATU", "AG FATURAMENTO"
];
  const STATUS_APROVADAS_VALIDAS = ["APROVADA", "ENCERRADA", "CANCELADA", "ASSINADA", "TRANSITO", "ENC. A VISTA"];

  function norm(s){ return String(s ?? "").trim(); }

  function upper(s){ return norm(s).toUpperCase(); }

  function onlyDigits(s){ return norm(s).replace(/\D/g,""); }

  function money(v){ return (Number(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}); }

  function num(v){ return (Number(v)||0).toLocaleString("pt-BR",{maximumFractionDigits:1}); }

  function html(s){ return norm(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }

  function cleanTextKey(s){
  return upper(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
}

  function isExcludedModalidade(s){ const u=upper(s); return EXCLUDE_MODALIDADE.some(x=>u.includes(x)) || u.includes("TOTAL"); }

  function isFandiModalidade(s){ return cleanTextKey(s) === "FANDI"; }

  function statusNorm(s){
  let u=upper(s).replace(/\s+/g," ").trim();
  if(u.includes("AGUARD") && u.includes("FATU")) return "AG. FATURAMENTO";
  if(u==="AG FATURAMENTO" || u==="AG. FATURAMENTO") return "AG. FATURAMENTO";
  if(u.includes("FATURAD")) return "FATURADA";
  if(u.includes("PAGA")) return "PAGA";
  if(u.includes("APROVAD")) return "APROVADA";
  if(u.includes("ASSINAD")) return "ASSINADA";
  if(u.includes("TRANSITO") || u.includes("TRÂNSITO")) return "TRANSITO";
  if((u.includes("ENC") || u.includes("ENCERRAD")) && (u.includes("A VISTA") || u.includes("À VISTA"))) return "ENC. A VISTA";
  if(u.includes("ENCERRAD")) return "ENCERRADA";
  if(u.includes("RECUS")) {
    if(u.includes("ENC")) return "ENC. RECUS.";
    if(u.includes("PRE") || u.includes("PRÉ")) return "PRÉ-RECUSA";
    return "RECUSADA";
  }
  if(u.includes("CANCEL")) return "CANCELADA";
  return u;
}

  function containsSpfExtra(opcionalNome){
  return cleanTextKey(opcionalNome).includes("SPF EXTRA");
}

  function tipoVeiculo(s){
  const u=upper(s);
  if(u.includes("SEMINOV")) return "Seminovos";
  // Na base limpa, "VENDAS DIRETA" representa operação de veículo novo.
  if(u.includes("NOVO") || u.includes("VENDAS DIRETA") || u.includes("VENDA DIRETA")) return "Novos";
  return "Não informado";
}

  function lojaCurta(s){
  let l = norm(s).replace("MITSUBISHI | ","").replace("A. FRANCO","ANÁLIA FRANCO");
  const u = upper(l).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
  if(u === "NACOES" || u === "NACOES UNIDAS") l = "NAÇÕES UNIDAS";
  if(u === "GASTAO" || u === "GASTAO VIDIGAL") l = "GASTÃO VIDIGAL";
  if(u === "ANALIA FRANCO" || u === "A. FRANCO") l = "ANÁLIA FRANCO";
  return l || "Não informado";
}

  function normalizeStoreName(s){
  return upper(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
}

  function parseNumber(v){
  // Conversão segura para padrão pt-BR em CSV.
  // Evita que valores como 81.768,95 ou 81768,95 sejam lidos como 8.176.895.
  if(typeof v === "number" && isFinite(v)) return v;
  let s = norm(v);
  if(!s) return 0;
  s = s
    .replace(/﻿/g, "")
    .replace(/R\$/gi, "")
    .replace(/["']/g, "")
    .replace(/ /g, " ")
    .trim();

  // remove espaços e símbolos que não sejam número, ponto, vírgula ou sinal
  s = s.replace(/\s+/g, "").replace(/[^0-9,.-]/g, "");
  if(!s || s === "-" || s === "," || s === ".") return 0;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if(hasComma){
    // Em pt-BR, vírgula é decimal. Pontos são milhar.
    s = s.replace(/\./g, "").replace(/,/g, ".");
  }else if(hasDot){
    const parts = s.split(".");
    const last = parts[parts.length - 1];
    // 1.234 ou 12.345.678 = separador de milhar; 1234.56 = decimal.
    if(parts.length > 2 || last.length === 3){
      s = s.replace(/\./g, "");
    }
  }

  const n = Number(s);
  return isFinite(n) ? n : 0;
}

  function excelDateToJS(v){
  if(!v) return null;
  if(v instanceof Date && !isNaN(v)) return v;
  if(typeof v === "number"){
    const d = XLSX.SSF.parse_date_code(v);
    if(d) return new Date(d.y, d.m-1, d.d);
  }
  const s=norm(v);
  if(!s) return null;
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return new Date(+m[3], +m[2]-1, +m[1]);
  let d=new Date(s);
  return isNaN(d)?null:d;
}

  function planTypeFromFields(opcionalNome, balao, tcDevolvida, codigoIF, valorBalao){
  const tcTxt = cleanTextKey(tcDevolvida);
  const codIFTxt = cleanTextKey(codigoIF);
  const codigoIFNumero = parseNumber(codigoIF);
  const tcDevolvidaNumero = parseNumber(tcDevolvida);
  const pmtBalaoNumero = parseNumber(balao);
  const valorBalaoNumero = parseNumber(valorBalao);

  // Regra oficial F&I Brabus - prioridade obrigatória e classificação única:
  // 1) Código IF = 999 ou SUBSIDIADO => SUBSIDIADO
  // 2) Código IF = 777 ou REVERSÃO => REVERSÃO
  // 3) TC Devolvida = 1 ou COPARTICIPADO => COPARTICIPADO
  // 4) PMT Balão > 0 ou Valor Balão > 0 => BALÃO
  // 5) Demais propostas => LINEAR
  // A primeira condição atendida encerra a classificação.
  if(codigoIFNumero === 999 || codIFTxt === "SUBSIDIADO" || codIFTxt.includes("SUBSIDIADO")) return "SUBSIDIADO";
  if(codigoIFNumero === 777 || codIFTxt === "REVERSAO" || codIFTxt.includes("REVERSAO")) return "REVERSÃO";
  if(tcDevolvidaNumero === 1 || tcTxt === "COPARTICIPADO" || tcTxt.includes("COPARTICIPADO")) return "COPARTICIPADO";
  if(pmtBalaoNumero > 0 || valorBalaoNumero > 0) return "BALÃO";
  return "LINEAR";
}

  function inPeriod(row, start, end){
  const d1=row.dataFaturamento, d2=row.dataPagamento;
  const check = d => d && (!start || d>=start) && (!end || d<=end);
  return check(d1) || check(d2);
}

  function avg(arr){ const a=arr.filter(x=>Number(x)>0); return a.length ? a.reduce((s,x)=>s+Number(x),0)/a.length : 0; }

  function sum(arr){ return arr.reduce((s,x)=>s+(Number(x)||0),0); }

  function findCol(headers, candidates){
  const normalized = headers.map(h => ({raw:h, key: upper(h).normalize("NFD").replace(/[\u0300-\u036f]/g,"")}));
  for(const cand of candidates){
    const c = upper(cand).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let exact = normalized.find(h=>h.key === c);
    if(exact) return exact.raw;
  }
  for(const cand of candidates){
    const c = upper(cand).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let contains = normalized.find(h=>h.key.includes(c));
    if(contains) return contains.raw;
  }
  return null;
}

  function groupBy(arr, keyFn){
  const m=new Map();
  arr.forEach(x=>{ const k=keyFn(x); if(!m.has(k)) m.set(k,[]); m.get(k).push(x); });
  return m;
}

  function storeMatches(row, lojaSelecionada){
  if(!lojaSelecionada || lojaSelecionada==="ALL") return true;
  return normalizeStoreName(row.loja) === normalizeStoreName(lojaSelecionada);
}

  function vehicleMatches(row, tipoSelecionado){
  if(!tipoSelecionado || tipoSelecionado==="TODOS") return true;
  return row.departamento === tipoSelecionado;
}

  function normalizeRows(rows){
  if(!rows.length) return [];
  const headers = Array.from(new Set(rows.flatMap(r=>Object.keys(r))));
  const col = {
    opCodigo: findCol(headers, ["Op - Código","Op Código","Código","Codigo","Proposta","Nº Proposta","Numero Proposta"]),
    cliente: findCol(headers, ["Cli - Nome","Cliente","Nome"]),
    cpf: findCol(headers, ["Cli - CPF/CNPJ","CPF/CNPJ","CPF","CNPJ"]),
    loja: findCol(headers, ["Inst - Ponto de Venda","Ponto de Venda","Loja","Revenda"]),
    departamento: findCol(headers, ["Inst - Departamento","Departamento","Novo Seminovo","Novos Seminovos"]),
    modalidade: findCol(headers, ["Op - Modalidade","Modalidade","Tipo Modalidade"]),
    status: findCol(headers, ["Op - Situação","Situação","Status"]),
    banco: findCol(headers, ["Op Fin - Banco","Banco","Financeira"]),
    valorFinanciado: findCol(headers, ["Op Fin - Financiado (R$)","Financiado (R$)","Financiado","Valor Financiado","Valor Financiado (R$)","Valor Fin.","Valor","Valor (R$)","Op - Valor Financiado","Financiamento"]),
    pmt: findCol(headers, ["Op Fin - PMT (R$)","PMT","Parcela","Valor Parcela"]),
    balao: findCol(headers, ["Op Fin - Balão PMT (R$)","Balão PMT","Balao PMT"]),
    valorBalao: findCol(headers, ["Op Fin - Valor Balão (R$)","Op Fin - Valor Balao (R$)","Valor Balão (R$)","Valor Balao (R$)","Valor Balão","Valor Balao","Balão","Balao"]),
    dataFaturamento: findCol(headers, ["Op - Data Faturamento","Data Faturamento","Op - Data Contrato","Data Contrato"]),
    dataPagamento: findCol(headers, ["Op Fin - Data Pagamento Contrato","Data Pagamento Contrato","Data Pagamento","Op - Data Inclusão","Data Inclusão","Data Inclusao"]),
    opcionalNome: findCol(headers, ["Opcional - Nome:","Opcional - Nome","Opcional Nome","Nome Opcional","Opcional"]),
    opcionalValor: findCol(headers, ["Opcional - Valor (R$)","Opcional Valor","Valor Opcional","Opcional - Valor","Valor SPF","SPF EXTRA"]),
    tcDevolvida: findCol(headers, ["Tabela - TC Devolvida (R$)","TC Devolvida (R$)","TC Devolvida","Tabela TC Devolvida","Tabela - TC Devolvida"]),
    codigoIF: findCol(headers, ["Tabela - Código IF","Tabela - Codigo IF","Código IF","Codigo IF","Cod IF","Tabela Codigo IF"]),
  };
  window.__colsUsed = col;

  let last = {};
  let lastProposalKey = "";

  return rows.map((r, idx)=>{
    const rowOrder = Number(r.__rowOrder ?? idx) || 0;

    const direct = k => {
      const c = col[k];
      return c ? r[c] : "";
    };
    const hasDirect = k => norm(direct(k)) !== "";

    const opcionalNomeDireto = norm(direct("opcionalNome"));
    const opcionalValorDireto = parseNumber(direct("opcionalValor"));
    const tcDevolvidaDireto = direct("tcDevolvida");
    const codigoIFDireto = direct("codigoIF");
    const hasPlanoRegraDireta = cleanTextKey(tcDevolvidaDireto).includes("COPARTICIPADO") || cleanTextKey(codigoIFDireto).includes("SUBSIDIADO") || cleanTextKey(codigoIFDireto).includes("REVERSAO");
    const hasOpcionalDireto = !!opcionalNomeDireto || opcionalValorDireto > 0 || hasPlanoRegraDireta;

    // Campos de contexto podem vir mesclados/agrupados e devem ser herdados.
    // Campos financeiros NÃO devem ser herdados, pois isso transforma propostas lineares em balão indevidamente.
    const contextFields = ["opCodigo","cliente","cpf","loja","departamento","modalidade","status","dataFaturamento","dataPagamento"];
    contextFields.forEach(k=>{
      if(hasDirect(k)) last[k] = direct(k);
    });

    // Banco também pode aparecer em linha agrupada, mas é contexto operacional, não valor.
    if(hasDirect("banco")) last.banco = direct("banco");

    const hasOwnContextData = contextFields.some(hasDirect) || hasDirect("banco");
    const hasOwnFinancialData = ["valorFinanciado","pmt","balao","valorBalao"].some(k=> parseNumber(direct(k)) > 0 || hasDirect(k));
    const isAuxOptional = hasOpcionalDireto && !hasOwnContextData && !hasOwnFinancialData;

    // Uma nova linha principal de proposta atualiza a chave do grupo.
    // Linhas auxiliares de opcionais herdam essa chave para não virarem proposta extra.
    if(hasOwnContextData || hasOwnFinancialData){
      const codigo = norm(hasDirect("opCodigo") ? direct("opCodigo") : last.opCodigo);
      const cpfKey = onlyDigits(hasDirect("cpf") ? direct("cpf") : last.cpf);
      const lojaKey = lojaCurta(hasDirect("loja") ? direct("loja") : last.loja);
      const depKey = tipoVeiculo(hasDirect("departamento") ? direct("departamento") : last.departamento);
      const statusKey = statusNorm(hasDirect("status") ? direct("status") : last.status);
      const valorKey = parseNumber(direct("valorFinanciado"));
      lastProposalKey = codigo ? `COD:${codigo}` : `CTX:${cpfKey}|${lojaKey}|${depKey}|${statusKey}|${valorKey}|${rowOrder}`;
    }

    const inherited = k => hasDirect(k) ? direct(k) : last[k];

    const opCodigoRaw = inherited("opCodigo");
    const clienteRaw = inherited("cliente");
    const cpfRaw = inherited("cpf");
    const lojaRaw = inherited("loja");
    const departamentoRaw = inherited("departamento");
    const modalidadeRaw = inherited("modalidade");
    const statusRaw = inherited("status");
    const bancoRaw = hasDirect("banco") ? direct("banco") : (isAuxOptional ? last.banco : direct("banco"));

    // Valores monetários devem vir somente da própria linha.
    // Não herdar valor financiado, PMT ou balão para evitar duplicidade/classificação errada.
    const valorFinanciadoValor = parseNumber(direct("valorFinanciado"));
    const pmtValor = parseNumber(direct("pmt"));
    const balaoValor = parseNumber(direct("balao"));
    const valorBalaoValor = parseNumber(direct("valorBalao"));

    const dataFatRaw = inherited("dataFaturamento");
    const dataPagRaw = inherited("dataPagamento");
    const opcionalNome = opcionalNomeDireto;
    const opcionalValor = opcionalValorDireto;

    return {
      opCodigo: norm(opCodigoRaw),
      cliente: norm(clienteRaw),
      cpf: onlyDigits(cpfRaw),
      loja: lojaCurta(lojaRaw),
      departamento: tipoVeiculo(departamentoRaw),
      modalidade: norm(modalidadeRaw),
      status: statusNorm(statusRaw),
      banco: upper(bancoRaw),
      valorFinanciado: valorFinanciadoValor,
      pmt: pmtValor,
      balao: balaoValor,
      valorBalao: valorBalaoValor,
      dataFaturamento: excelDateToJS(dataFatRaw),
      dataPagamento: excelDateToJS(dataPagRaw),
      opcionalNome,
      opcionalValor,
      tcDevolvida: tcDevolvidaDireto,
      codigoIF: codigoIFDireto,
      planoTipo: planTypeFromFields(opcionalNome, balaoValor, tcDevolvidaDireto, codigoIFDireto, valorBalaoValor),
      __isAuxOptional: isAuxOptional,
      __rowOrder: rowOrder,
      __proposalKey: isAuxOptional ? lastProposalKey : (lastProposalKey || `ROW:${rowOrder}`)
    };
  }).filter(r => {
    // Mantém linhas auxiliares de opcionais, pois elas carregam SUBSÍDIO/COPARTICIPAÇÃO/SPF EXTRA
    // herdando o contexto da proposta anterior. Essas linhas NÃO entram na produção operacional.
    return isFandiModalidade(r.modalidade)
      && !isExcludedModalidade(r.modalidade)
      && !upper(r.status).includes("TOTAL")
      && (r.status || r.cpf || r.valorFinanciado || r.opcionalNome || r.opcionalValor || r.tcDevolvida || r.codigoIF);
  });
}

  function proposalKey(row){
  if(row.__proposalKey) return row.__proposalKey;
  const codigo = norm(row.opCodigo);
  if(codigo) return `COD:${codigo}`;
  return `ROW:${row.cpf}|${row.loja}|${row.departamento}|${row.status}|${row.valorFinanciado}|${row.__rowOrder}`;
}

  function planPriority(tipo){
  return {"SUBSIDIADO":5,"REVERSÃO":4,"COPARTICIPADO":3,"BALÃO":2,"LINEAR":1}[tipo] || 0;
}

  function planProposalsFromRows(rows){
  const proposals = new Map();
  rows.filter(r=>r.cpf || r.opCodigo || r.valorFinanciado || r.opcionalNome || r.balao).forEach(r=>{
    const key = proposalKey(r);
    if(!proposals.has(key)){
      proposals.set(key,{
        key,
        loja:r.loja || "Não informado",
        departamento:r.departamento || "Não informado",
        valor:Number(r.valorFinanciado)||0,
        balao:Number(r.balao)||0,
        valorBalao:Number(r.valorBalao)||0,
        planoTipo:r.planoTipo || planTypeFromFields(r.opcionalNome, r.balao, r.tcDevolvida, r.codigoIF, r.valorBalao) || "LINEAR",
        rowOrder:Number(r.__rowOrder)||0
      });
      return;
    }
    const p = proposals.get(key);
    const valor = Number(r.valorFinanciado)||0;
    const balao = Number(r.balao)||0;
    if(valor > p.valor) p.valor = valor;
    if(balao > p.balao) p.balao = balao;
    const valorBalao = Number(r.valorBalao)||0;
    if(valorBalao > (p.valorBalao||0)) p.valorBalao = valorBalao;
    const tipo = planTypeFromFields(r.opcionalNome, r.balao, r.tcDevolvida, r.codigoIF, r.valorBalao);
    if(planPriority(tipo) > planPriority(p.planoTipo)) p.planoTipo = tipo;
    if((!p.loja || p.loja==="Não informado") && r.loja) p.loja = r.loja;
    if((!p.departamento || p.departamento==="Não informado") && r.departamento) p.departamento = r.departamento;
  });
  return [...proposals.values()];
}

  function buildStore(rows){
  const out=[];
  for(const [loja,g] of groupBy(rows, r=>r.loja)){
    const n=g.filter(r=>r.departamento==="Novos");
    const s=g.filter(r=>r.departamento==="Seminovos");
    const b=g.filter(r=>r.balao>0);
    out.push({
      loja, qtd:g.length, novos:n.length, seminovos:s.length,
      finNovos: avg(n.map(r=>r.valorFinanciado)), finSemis: avg(s.map(r=>r.valorFinanciado)),
      pmtNovos: avg(n.map(r=>r.pmt)), pmtSemis: avg(s.map(r=>r.pmt)),
      qtdBalao:b.length, balaoMedio:avg(b.map(r=>r.balao)),
      valorTotal:sum(g.map(r=>r.valorFinanciado))
    });
  }
  return out.sort((a,b)=>b.qtd-a.qtd);
}

  function buildBankOperational(rows){
  const out=[];
  for(const [banco,g] of groupBy(rows, r=>r.banco)){
    const n=g.filter(r=>r.departamento==="Novos");
    const s=g.filter(r=>r.departamento==="Seminovos");
    out.push({banco,qtd:g.length,total:sum(g.map(r=>r.valorFinanciado)),medio:avg(g.map(r=>r.valorFinanciado)),novos:sum(n.map(r=>r.valorFinanciado)),seminovos:sum(s.map(r=>r.valorFinanciado))});
  }
  return out.sort((a,b)=>b.total-a.total);
}

  function buildStatusByStore(rows){
  const out=[];
  for(const [loja,g] of groupBy(rows, r=>r.loja)){
    const paga = g.filter(r=>r.status==="PAGA");
    const fat = g.filter(r=>r.status==="FATURADA");
    const ag = g.filter(r=>r.status==="AG. FATURAMENTO");
    const total = g;
    out.push({
      loja,
      pagaQtd:paga.length,
      pagaValor:sum(paga.map(r=>r.valorFinanciado)),
      fatQtd:fat.length,
      fatValor:sum(fat.map(r=>r.valorFinanciado)),
      agQtd:ag.length,
      agValor:sum(ag.map(r=>r.valorFinanciado)),
      totalQtd:total.length,
      totalValor:sum(total.map(r=>r.valorFinanciado))
    });
  }
  return out.sort((a,b)=>b.totalValor-a.totalValor);
}

  function buildStatusByBank(rows){
  const out=[];
  for(const [banco,g] of groupBy(rows, r=>r.banco)){
    const paga = g.filter(r=>r.status==="PAGA");
    const fat = g.filter(r=>r.status==="FATURADA");
    const ag = g.filter(r=>r.status==="AG. FATURAMENTO");
    const total = g;
    out.push({
      banco,
      pagaQtd:paga.length,
      pagaValor:sum(paga.map(r=>r.valorFinanciado)),
      fatQtd:fat.length,
      fatValor:sum(fat.map(r=>r.valorFinanciado)),
      agQtd:ag.length,
      agValor:sum(ag.map(r=>r.valorFinanciado)),
      totalQtd:total.length,
      totalValor:sum(total.map(r=>r.valorFinanciado))
    });
  }
  return out.sort((a,b)=>b.totalValor-a.totalValor);
}

  function buildCpfAnalysis(base){
  const byCpf = groupBy(base.filter(r=>r.cpf), r=>r.cpf);
  const recMap = new Map(), aprMap = new Map();

  function dateValue(r){
    const d = r.dataFaturamento || r.dataPagamento;
    return d ? d.getTime() : 0;
  }

  function orderValue(r){
    // Prioriza data quando existir, mas preserva a ordem original da planilha quando houver empate ou ausência de data.
    return (dateValue(r) * 1000000) + (Number(r.__rowOrder)||0);
  }

  function byFirstRegistered(a,b){
    return orderValue(a) - orderValue(b);
  }

  function byLastRegistered(a,b){
    return orderValue(b) - orderValue(a);
  }

  for(const [cpf, rows] of byCpf){
    const validStatusRows = rows.filter(r=>r.status).sort(byLastRegistered);
    if(!validStatusRows.length) continue;

    const orderedFirst = rows.slice().sort(byFirstRegistered);
    const firstRow = orderedFirst[0];
    const lastStatusRow = validStatusRows[0];
    const finalStatus = lastStatusRow.status;
    const hasOperacional = rows.some(r=>OPERACIONAL.includes(r.status));

    // Valor único do CPF: maior valor financiado encontrado no CPF.
    // Mantemos também linhas sem status para buscar valor quando a linha final de recusa/aprovação vier sem valor.
    const valorRow = rows.slice().sort((a,b)=>{
      const diff = (Number(b.valorFinanciado)||0)-(Number(a.valorFinanciado)||0);
      return diff || orderValue(b)-orderValue(a);
    })[0] || lastStatusRow || firstRow;
    const maxValor = Number(valorRow.valorFinanciado)||0;
    const lojaPrimeira = firstRow.loja || lastStatusRow.loja || "Não informado";
    const depBase = valorRow.departamento && valorRow.departamento !== "Não informado" ? valorRow.departamento : (lastStatusRow.departamento || firstRow.departamento);
    const depCpf = depBase === "Seminovos" ? "Seminovos" : "Novos";

    function ensureBucket(map, loja){
      if(!map.has(loja)){
        map.set(loja,{
          loja, qtd:0, valor:0,
          novosQtd:0, novosValor:0,
          seminovosQtd:0, seminovosValor:0
        });
      }
      return map.get(loja);
    }

    function addCpf(bucket){
      bucket.qtd += 1;
      bucket.valor += maxValor;
      if(depCpf === "Seminovos"){
        bucket.seminovosQtd += 1;
        bucket.seminovosValor += maxValor;
      }else{
        bucket.novosQtd += 1;
        bucket.novosValor += maxValor;
      }
    }

    // Regra F&I Brabus para recusa líquida:
    // Só conta como RECUSADA quando o CPF/CNPJ possui status de recusa
    // e NÃO possui nenhum status de aprovação no histórico inteiro do CPF/CNPJ.
    // CANCELADA, ASSINADA, TRANSITO e ENC. A VISTA também anulam a recusa e entram como aprovação.
    if(STATUS_RECUSA_LIQUIDA.includes(finalStatus)){
      addCpf(ensureBucket(recMap, lojaPrimeira));
    }

    // Aprovadas válidas: usa o último status válido do CPF. Se já virou produção operacional, fica apenas na produção.
    if(STATUS_APROVADAS_VALIDAS.includes(finalStatus) && !hasOperacional){
      addCpf(ensureBucket(aprMap, lojaPrimeira));
    }
  }

  return {
    recusadas:[...recMap.values()].sort((a,b)=>b.qtd-a.qtd || b.valor-a.valor),
    aprovadas:[...aprMap.values()].sort((a,b)=>b.qtd-a.qtd || b.valor-a.valor)
  };
}

  function buildPlanAnalysis(rows){
  const proposals = new Map();

  rows.filter(r=>r.cpf || r.opCodigo || r.valorFinanciado).forEach(r=>{
    const key = proposalKey(r);
    if(!proposals.has(key)){
      proposals.set(key,{
        key,
        cpf:r.cpf,
        cliente:r.cliente,
        loja:r.loja,
        departamento:r.departamento,
        valor:Number(r.valorFinanciado)||0,
        balao:Number(r.balao)||0,
        valorBalao:Number(r.valorBalao)||0,
        planoTipo:r.planoTipo || "LINEAR",
        rowOrder:Number(r.__rowOrder)||0
      });
      return;
    }

    const p = proposals.get(key);
    if((Number(r.valorFinanciado)||0) > p.valor) p.valor = Number(r.valorFinanciado)||0;
    if((Number(r.balao)||0) > p.balao) p.balao = Number(r.balao)||0;
    if((Number(r.valorBalao)||0) > (p.valorBalao||0)) p.valorBalao = Number(r.valorBalao)||0;
    const tipo = planTypeFromFields(r.opcionalNome, r.balao, r.tcDevolvida, r.codigoIF, r.valorBalao);
    if(planPriority(tipo) > planPriority(p.planoTipo)) p.planoTipo = tipo;
    if(!p.cliente && r.cliente) p.cliente = r.cliente;
    if(!p.cpf && r.cpf) p.cpf = r.cpf;
    if(!p.loja && r.loja) p.loja = r.loja;
    if((!p.departamento || p.departamento==="Não informado") && r.departamento) p.departamento = r.departamento;
  });

  const base = ["SUBSIDIADO","REVERSÃO","COPARTICIPADO","BALÃO","LINEAR"].map(tipo=>({tipo,qtd:0,valor:0}));
  const byType = new Map(base.map(x=>[x.tipo,x]));
  for(const p of proposals.values()){
    const tipo = p.planoTipo || "LINEAR";
    if(!byType.has(tipo)) byType.set(tipo,{tipo,qtd:0,valor:0});
    const b = byType.get(tipo);
    b.qtd += 1;
    b.valor += Number(p.valor)||0;
  }
  return [...byType.values()].sort((a,b)=>["SUBSIDIADO","REVERSÃO","COPARTICIPADO","BALÃO","LINEAR"].indexOf(a.tipo)-["SUBSIDIADO","REVERSÃO","COPARTICIPADO","BALÃO","LINEAR"].indexOf(b.tipo));
}

  function buildPlanStoreDeptAnalysis(rows){
  const proposals = planProposalsFromRows(rows);
  const lojas = new Map();
  function bucket(loja){
    if(!lojas.has(loja)){
      lojas.set(loja,{
        loja,
        novos:{LINEAR:0,"BALÃO":0,SUBSIDIADO:0,"REVERSÃO":0,COPARTICIPADO:0,total:0},
        seminovos:{LINEAR:0,"BALÃO":0,"REVERSÃO":0,total:0}
      });
    }
    return lojas.get(loja);
  }
  proposals.forEach(p=>{
    const loja = p.loja || "Não informado";
    const dep = p.departamento === "Seminovos" ? "Seminovos" : p.departamento === "Novos" ? "Novos" : p.departamento;
    const tipo = p.planoTipo || "LINEAR";
    const b = bucket(loja);
    if(dep === "Novos"){
      if(["LINEAR","BALÃO","SUBSIDIADO","REVERSÃO","COPARTICIPADO"].includes(tipo)) b.novos[tipo] += 1;
      b.novos.total += 1;
    }else if(dep === "Seminovos"){
      if(tipo === "BALÃO") b.seminovos["BALÃO"] += 1;
      else if(tipo === "REVERSÃO") b.seminovos["REVERSÃO"] += 1;
      else if(tipo === "LINEAR") b.seminovos.LINEAR += 1;
      b.seminovos.total += 1;
    }
  });
  return [...lojas.values()].sort((a,b)=>(b.novos.total+b.seminovos.total)-(a.novos.total+a.seminovos.total) || String(a.loja).localeCompare(String(b.loja)));
}

  function buildSpfExtraAnalysis(rows){
  const unique = new Map();

  rows.filter(r=>containsSpfExtra(r.opcionalNome) && (Number(r.opcionalValor)||0) > 0).forEach(r=>{
    // Mantém a deduplicação por proposta/valor para evitar contar a mesma linha auxiliar duas vezes,
    // mas a exibição final agora é consolidada somente por Loja e Departamento.
    const key = `${proposalKey(r)}|SPF_EXTRA|${Number(r.opcionalValor)||0}`;
    if(!unique.has(key)){
      unique.set(key,{
        loja:r.loja || "Não informado",
        departamento:r.departamento || "Não informado",
        valor:Number(r.opcionalValor)||0
      });
    }
  });

  const grouped = new Map();
  for(const item of unique.values()){
    const key = `${item.loja}|${item.departamento}`;
    if(!grouped.has(key)){
      grouped.set(key,{loja:item.loja, departamento:item.departamento, valor:0, comissao:0});
    }
    const g = grouped.get(key);
    g.valor += item.valor;
    g.comissao = g.valor * 0.70;
  }

  const detalhes = [...grouped.values()].sort((a,b)=>
    String(a.loja).localeCompare(String(b.loja)) ||
    String(a.departamento).localeCompare(String(b.departamento))
  );
  const total = sum(detalhes.map(r=>r.valor));
  return {detalhes,total,comissao:total*0.70};
}

  function prodSummary(rows, status){
  const g = rows.filter(r=>r.status===status);
  const n = g.filter(r=>r.departamento==="Novos");
  const s = g.filter(r=>r.departamento==="Seminovos");
  return {
    qtd:g.length,
    valor:sum(g.map(r=>r.valorFinanciado)),
    novos:n.length,
    seminovos:s.length,
    valorNovos:sum(n.map(r=>r.valorFinanciado)),
    valorSeminovos:sum(s.map(r=>r.valorFinanciado))
  };
}

  function prodTotalSummary(rows){
  // "rows" (operacional) já vem exclusivamente com PAGA/FATURADA/AG. FATURAMENTO
  // — população definida em um único ponto na RPC operational_fandi_dashboard
  // (FANDI + status elegível). O filtro abaixo só documenta esse invariante;
  // ANTES incluía só PAGA/FATURADA e descartava silenciosamente AG. FATURAMENTO
  // do card "Produção Total", divergindo dos demais indicadores do módulo.
  const g = rows.filter(r=>r.status==="PAGA" || r.status==="FATURADA" || r.status==="AG. FATURAMENTO");
  const n = g.filter(r=>r.departamento==="Novos");
  const s = g.filter(r=>r.departamento==="Seminovos");
  return {
    qtd:g.length,
    valor:sum(g.map(r=>r.valorFinanciado)),
    novos:n.length,
    seminovos:s.length,
    valorNovos:sum(n.map(r=>r.valorFinanciado)),
    valorSeminovos:sum(s.map(r=>r.valorFinanciado))
  };
}
  // ==== END byte-identical extraction ====

  // ==== BEGIN period-preset date arithmetic (lifted, not extracted -- see header) ====
  function computePeriodPreset(preset, today) {
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let start, end;
    if (preset === 'CURRENT_MONTH') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = today;
    } else if (preset === 'PREVIOUS_MONTH') {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === 'LAST_6_MONTHS') {
      start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      end = today;
    } else {
      return null;
    }
    return { start: start, end: end };
  }
  // ==== END period-preset date arithmetic ====

  window.NX_GESTAO_LEGACY_UPLOAD_ENGINE = {
    id: 'gestao-legacy-upload-engine',
    groundTruthRef: 'origin/main:modules/analise-fi-grupo.html (portal-financiamento-brabus-secure) == live production (PORTAL-NEXT-06, byte-hash confirmed identical local/origin/live); see docs/GESTAO-ENGINE-AUDIT.md',

    normalizeRows: normalizeRows,
    buildStore: buildStore,
    buildBankOperational: buildBankOperational,
    buildStatusByStore: buildStatusByStore,
    buildStatusByBank: buildStatusByBank,
    buildCpfAnalysis: buildCpfAnalysis,
    buildPlanAnalysis: buildPlanAnalysis,
    buildPlanStoreDeptAnalysis: buildPlanStoreDeptAnalysis,
    buildSpfExtraAnalysis: buildSpfExtraAnalysis,
    prodSummary: prodSummary,
    prodTotalSummary: prodTotalSummary,
    planTypeFromFields: planTypeFromFields,
    inPeriod: inPeriod,
    storeMatches: storeMatches,
    vehicleMatches: vehicleMatches,
    money: money,
    num: num,
    computePeriodPreset: computePeriodPreset,

    // process(): mirrors the LOCAL (non-secure-API) branch of production's
    // own process() (origin/main lines 1816-1848) -- filter by
    // period/store/vehicle, split operational vs. contextual (with aux
    // rows) vs. CPF-wide populations exactly as production does, then
    // run every build* aggregator. The secure-API branch
    // (processSecureFandi/operational_fandi_dashboard RPC) is NOT
    // reproduced -- 0 backend this Wave.
    compute: function (fixture) {
      var rawRows = normalizeRows(fixture.rows || []);
      var start = fixture.start ? new Date(fixture.start + 'T00:00:00') : null;
      var end = fixture.end ? new Date(fixture.end + 'T23:59:59') : null;
      var lojaSelecionada = fixture.store || 'ALL';
      var tipoSelecionado = fixture.vehicle || 'TODOS';

      var base = rawRows.filter(function (r) { return inPeriod(r, start, end) && storeMatches(r, lojaSelecionada) && vehicleMatches(r, tipoSelecionado); });
      var baseCpf = rawRows.filter(function (r) {
        var hasDate = r.dataFaturamento || r.dataPagamento;
        var inDate = hasDate ? inPeriod(r, start, end) : true;
        return inDate && storeMatches(r, lojaSelecionada) && vehicleMatches(r, tipoSelecionado);
      });
      var operacional = base.filter(function (r) { return OPERACIONAL.indexOf(r.status) !== -1 && !r.__isAuxOptional; });
      var baseOperacionalContexto = base.filter(function (r) { return OPERACIONAL.indexOf(r.status) !== -1; });
      var operacionalComBanco = operacional.filter(function (r) { return norm(r.banco); });

      var store = buildStore(operacional);
      var bank = buildBankOperational(operacionalComBanco);
      var statusStore = buildStatusByStore(operacional);
      var statusBank = buildStatusByBank(operacionalComBanco);
      var cpf = buildCpfAnalysis(baseCpf);
      var planos = buildPlanAnalysis(baseOperacionalContexto);
      var planosLojaDept = buildPlanStoreDeptAnalysis(baseOperacionalContexto);
      var spfExtra = buildSpfExtraAnalysis(baseOperacionalContexto);
      var pagaResumo = prodSummary(operacional, 'PAGA');
      var fatResumo = prodSummary(operacional, 'FATURADA');
      var agResumo = prodSummary(operacional, 'AG. FATURAMENTO');
      var totalPagoFatResumo = prodTotalSummary(operacional);

      return {
        base: base, operacional: operacional, store: store, bank: bank,
        statusStore: statusStore, statusBank: statusBank, cpf: cpf,
        planos: planos, planosLojaDept: planosLojaDept, spfExtra: spfExtra,
        pagaResumo: pagaResumo, fatResumo: fatResumo, agResumo: agResumo,
        totalPagoFatResumo: totalPagoFatResumo
      };
    },

    _internal: { EXCLUDE_MODALIDADE: EXCLUDE_MODALIDADE, OPERACIONAL: OPERACIONAL, STATUS_RECUSA_LIQUIDA: STATUS_RECUSA_LIQUIDA, STATUS_APROVACAO_HISTORICA: STATUS_APROVACAO_HISTORICA, STATUS_APROVADAS_VALIDAS: STATUS_APROVADAS_VALIDAS }
  };

  // DEAD LEGACY: intentionally NOT registered into
  // window.NX_BUSINESS_ADAPTERS.registry.gestao -- that slot belongs to
  // the active thin adapter (gestao.adapter.js). This file must never
  // become the runtime authority again by accident.
})();
