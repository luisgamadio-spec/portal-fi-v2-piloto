/* PORTAL-NEXT V2 -- Dashbi (Analise Geral do Grupo) Adapter (Gate 37-38:
   PURE EXTRACTION, programmatic, not hand-retyped -- see docs/
   DASHBI-FUNCTION-MAP.md, DASHBI-DATA-CONTRACT.md, DASHBI-MODEL-
   ANALYSIS-CONTRACT.md).

   SOURCE: git show origin/main:modules/analise-geral-grupo-secure-
   original-layout.html (portal-financiamento-brabus-secure) --
   confirmed DIVERGENT from the local clone (like Score/Coparticipado,
   unlike Gestao); origin/main confirmed byte-identical to live
   production. Read exclusively from origin/main.

   ARCHITECTURE NOTE: production's own external adapter (assets/js/
   analise-geral-grupo-secure-adapter.js) unconditionally overrides
   window.processar with a secure-RPC loader and boots it on
   DOMContentLoaded -- meaning the LIVE default path is a Supabase RPC
   (operational_metrics), not the functions below. The 91 functions
   extracted here are the REAL, full business-logic engine reachable
   via the page's own "MODO TESTE" manual-file path
   (processarDashboardTesteManualLocal, origin/main lines 5897-5986) --
   the only path this Wave can exercise with 0 backend calls (Gate 31),
   and the one that actually contains the classification/crossing/
   Entrada logic (the secure adapter's metricsToLegacy() only reshapes
   an already-aggregated, already-classified backend payload).

   91 functions + 6 constants copied BYTE-IDENTICAL. Do not "clean up",
   rename, reformat, or otherwise touch these lines -- any future
   change must come from a NEW extraction off a NEW production source.

   ONE deliberate substitution: VENDOR_MAP ships here as an empty
   object, not production's ~100-entry hardcoded map of real employee
   names -> real store names. Fixtures always supply their own
   synthetic "Base de Vendedores" (via setVendors(), mirroring
   montarMapaVendedoresLocal's own real behavior of AUGMENTING
   VENDOR_MAP), so the production map's real names are never needed
   for parity -- they would only matter for a synthetic seller name
   that happens to collide with a real employee's name, which no
   fixture does. See docs/DASHBI-FUNCTION-MAP.md.

   ONE deliberate no-op: lojaEfetivaPorMudancaPortal is extracted
   byte-identical, but BRABUS_MUDANCAS_LOJA_VENDEDORES is never
   populated (production's own carregarMudancasLojaVendedoresDashboard,
   which populates it, makes a live Supabase REST fetch -- 0 backend
   this Wave, Gate 31). This deterministically reproduces the
   function's own documented fallback behavior when no store-transfer
   record exists (returns the base loja unchanged), not an invented
   simplification. */
(function () {
  'use strict';

  // ==== BEGIN byte-identical extraction from origin/main:modules/analise-geral-grupo-secure-original-layout.html ====
  const ALLOWED_SALES = new Set(["V21","VD","U21"]);
  const EXCLUDE_TX = new Set(["V18","V06","U08","U03"]);
  const DEV_TX = new Set(["V07","U07"]);
    // Exclusion list kept as hashes (no names in the code); see the helper below.
  // ---- Exclusion rule without names in the code ------------------------------
  // Each excluded seller is stored as { len, fp, sha }: sha = SHA-256 (hex, UTF-8) of the
  // normalized name (same normalizeText as the rule: uppercase, no accents, collapsed spaces);
  // len = its length; fp = a 16-bit rolling fingerprint used only as a pre-filter.
  // Same semantics as the former plain-name rule: equality for a seller name,
  // substring ("joined.includes(name)") for a whole row.
  var SHA256_K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function utf8Bytes(s){
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var u = unescape(encodeURIComponent(s)), b = new Uint8Array(u.length);
    for (var i = 0; i < u.length; i++) b[i] = u.charCodeAt(i);
    return b;
  }
  function sha256Hex(s){
    var msg = utf8Bytes(String(s)), n = msg.length, total = ((n + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total); buf.set(msg); buf[n] = 0x80;
    var bits = n * 8; buf[total - 4] = (bits >>> 24) & 255; buf[total - 3] = (bits >>> 16) & 255; buf[total - 2] = (bits >>> 8) & 255; buf[total - 1] = bits & 255;
    buf[total - 5] = Math.floor(n / 0x20000000) & 255;
    var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19, w = new Array(64);
    for (var o = 0; o < total; o += 64) {
      for (var t = 0; t < 16; t++) w[t] = (buf[o+4*t] << 24) | (buf[o+4*t+1] << 16) | (buf[o+4*t+2] << 8) | buf[o+4*t+3];
      for (t = 16; t < 64; t++) {
        var x = w[t-15], y = w[t-2];
        var s0 = ((x>>>7)|(x<<25)) ^ ((x>>>18)|(x<<14)) ^ (x>>>3), s1 = ((y>>>17)|(y<<15)) ^ ((y>>>19)|(y<<13)) ^ (y>>>10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
      }
      var a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
      for (t = 0; t < 64; t++) {
        var S1 = ((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7)), ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
        var S0 = ((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10)), mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
    }
    return [h0,h1,h2,h3,h4,h5,h6,h7].map(function(v){ return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }
  var FP_MOD = 65521, FP_BASE = 257;
  function fingerprint(s, from, len){ var fp = 0; for (var i = 0; i < len; i++) fp = (fp * FP_BASE + s.charCodeAt(from + i)) % FP_MOD; return fp; }
  function hashListIndex(list){
    var porLen = {};
    list.forEach(function (x) { (porLen[x.len] = porLen[x.len] || { len: x.len, fps: {}, shas: {} }); porLen[x.len].fps[x.fp] = 1; porLen[x.len].shas[x.sha] = 1; });
    return Object.keys(porLen).map(function (k) {
      var g = porLen[k], top = 1;
      for (var i = 1; i < g.len; i++) top = (top * FP_BASE) % FP_MOD;
      g.top = top; return g;
    });
  }
  function hashListHas(index, cache, name){
    if (!name) return false;
    if (cache.has(name)) return cache.get(name);
    var hit = index.some(function (g) { return g.len === name.length && g.shas[sha256Hex(name)] === 1; });
    cache.set(name, hit);
    return hit;
  }
  // true when `text` contains any listed name as a substring (same as text.includes(name))
  function hashListInText(index, text){
    text = String(text || '');
    for (var gi = 0; gi < index.length; gi++) {
      var g = index[gi], L = g.len;
      if (text.length < L) continue;
      var fp = fingerprint(text, 0, L);
      for (var i = 0; ; i++) {
        if (g.fps[fp] === 1 && g.shas[sha256Hex(text.substr(i, L))] === 1) return true;
        if (i + L >= text.length) break;
        fp = (fp - (text.charCodeAt(i) * g.top) % FP_MOD + FP_MOD) % FP_MOD;
        fp = (fp * FP_BASE + text.charCodeAt(i + L)) % FP_MOD;
      }
    }
    return false;
  }
  const EXCLUDED_SELLERS = hashListIndex([
    { len: 28, fp: 50182, sha: '41ea3dce7a160a26005022aa1b43d67e7bb56ae72198bfce5fa4586c9b56e688' },
    { len: 19, fp: 41689, sha: 'cef0c08f261fec77990768b9ac068064f7b71f8b28a51b0558b8f59b0428f75b' },
    { len: 20, fp: 550, sha: 'e0b71f218ecf3dfb0f1d44fd105c8c644690d01857287470934948c2ddf3acc3' },
    { len: 13, fp: 49392, sha: 'edfa93c6acc65d5428f2d3d79fb328841bd4873e4b4ff726167730fe2c273582' },
    { len: 25, fp: 53039, sha: '900bfd377956f1e350f3000a26dc42ead1105986db7e15ad8615fe0dfe5f8b0f' },
    { len: 18, fp: 15862, sha: '0a41b9899c5f5b1bd79b8291eec45a6b9cc3b2abeebd5f5e64a76555efbb5d75' },
    { len: 26, fp: 26833, sha: '9791374b4cce10e2d1c1ec87b09e9f59e5faf2dc8c957729159eec0b4c02068d' },
    { len: 13, fp: 14634, sha: '4f15e0f6a6bd30a4c3a883e9c6e2f7a2695e23c2a22ba6fa47acd51588099589' },
    { len: 21, fp: 4613, sha: '66fe8414df0cd5ab9aa5ecc37ccd4b6f7a8ce1b5416f512167d2de9e72d3eb6a' }
  ]);
  const EXCLUDED_CACHE = new Map();
  // fixed seller of the resale rule (isRevendaRecord), also kept as a hash
  const REVENDA_SELLER = hashListIndex([
    { len: 12, fp: 28592, sha: 'b946a09a7c91769bd3fc5918b48c612849a230789e1e7ea96cd672692cd42c1b' }
  ]);
  const REVENDA_CACHE = new Map();
  const STORE_CODE_MAP = {
  "1050":"ABC", "ABC":"ABC"
};
  const FAMILY_MODELS = {
  "OUTLANDER": ["OUTLANDER HPE-S","OUTLANDER SIGNATURE"],
  "ECLIPSE CROSS": ["ECLIPSE CROSS RUSH","ECLIPSE CROSS HPE","ECLIPSE CROSS HPE-S 4X2","ECLIPSE CROSS HPE-S 4X4","ECLIPSE CROSS HPE-S BLACK","ECLIPSE CROSS TARMAC"],
  "TRITON": ["TRITON GL","TRITON GLS","TRITON HPE","TRITON HPE-S","TRITON KATANA","TRITON SAVANA","TRITON TARMAC","TRITON TERRA"]
};

  function normalizeText(v){
  return (v ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/\s+/g," ").trim();
}

  function onlyDigits(v){
  if(v === null || v === undefined || v === "") return "";
  let s = v.toString().trim();

  // Corrige CPF/CNPJ quando o Excel entrega em notação científica.
  if(/[eE]\+/.test(s)){
    const n = Number(s);
    if(Number.isFinite(n)) s = Math.trunc(n).toString();
  }

  // Remove decimal final comum em números vindos do Excel, ex.: 12345678901.0
  s = s.replace(/\.0+$/,"");

  return s.replace(/\D/g,"");
}

  function asNumber(v){
  if(v === null || v === undefined || v === "") return 0;
  if(typeof v === "number") return isFinite(v) ? v : 0;
  let s = v.toString().trim();
  if(!s) return 0;
  s = s.replace(/[R$\s]/g,"");
  if(s.includes(",") && s.includes(".")) s = s.replace(/\./g,"").replace(",",".");
  else if(s.includes(",")) s = s.replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

  function asMoneyNumber(v){
  if(v === null || v === undefined || v === "") return 0;
  if(typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[R$\s]/g,"");
  if(!s) return 0;
  if(s.includes(",") && s.includes(".")) s = s.replace(/\./g,"").replace(",",".");
  else if(s.includes(",")) s = s.replace(",",".");
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g,"");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

  function asVehicleSaleValue(v){
  const n = asMoneyNumber(v);
  // Algumas planilhas históricas formatam R$ 324.990 como 324,99.
  // Valores de venda de veículo abaixo de R$ 1.000 representam milhares.
  return n > 0 && n < 1000 ? n * 1000 : n;
}

  function asDateValue(v){
  if(!v) return 0;
  if(v instanceof Date) return v.getTime();
  if(typeof v === "number") return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

  function money(v){
  const n = Number(v || 0);
  const inteiro = n < 0 ? Math.ceil(n) : Math.floor(n);
  return inteiro.toLocaleString("pt-BR", {
    style:"currency",
    currency:"BRL",
    minimumFractionDigits:0,
    maximumFractionDigits:0
  });
}

  function pct(v){ return isFinite(v) ? (v*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%" : "0,0%"; }

  function num(v, dec=0){
  if(typeof dec !== "number" || !isFinite(dec)) dec = 0;
  return (v||0).toLocaleString("pt-BR",{minimumFractionDigits:dec,maximumFractionDigits:dec});
}

  function normalizeClientName(v){
  let s = normalizeText(v);
  s = s
    .replace(/\bLTDA\b/g,"")
    .replace(/\bEIRELI\b/g,"")
    .replace(/\bME\b/g,"")
    .replace(/\bEPP\b/g,"")
    .replace(/\bS A\b/g,"")
    .replace(/\bSA\b/g,"")
    .replace(/\bS\/A\b/g,"")
    .replace(/[^\w\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
  return s;
}

  function clientNameVariants(v){
  const base = normalizeText(v);
  const clean = normalizeClientName(v);
  const variants = new Set([base, clean]);
  if(clean.length > 18) variants.add(clean.slice(0, 28));
  return [...variants].filter(Boolean);
}

  function planTextValue(v){
  return normalizeText(v).replace(/[^\w\s]/g," ").replace(/\s+/g," ").trim();
}

  function isCoparticipadoValue(v){
  return planTextValue(v).includes("COPARTICIPADO");
}

  function isSubsidiadoValue(v){
  return planTextValue(v).includes("SUBSIDIADO");
}

  function isReversaoValue(v){
  return planTextValue(v).includes("REVERSAO") || planTextValue(v).includes("REVERSÃO");
}

  function isTCHeader(v){
  const h = normalizeText(v);
  return h.includes("TC DEVOLVIDA");
}

  function isIFHeader(v){
  const h = normalizeText(v);
  return h.includes("CODIGO IF") || h.includes("CÓDIGO IF");
}

  function hasAnyCol(row, aliases){
  const keys = Object.keys(row || {});
  for(const a of aliases){
    const na = normalizeText(a);
    if(keys.some(x => normalizeText(x) === na || normalizeText(x).includes(na))) return true;
  }
  return false;
}

  function findVal(row, aliases){
  const keys = Object.keys(row);
  for(const a of aliases){
    const na = normalizeText(a);
    const k = keys.find(x => normalizeText(x) === na);
    if(k !== undefined) return row[k];
  }
  for(const a of aliases){
    const na = normalizeText(a);
    const k = keys.find(x => normalizeText(x).includes(na));
    if(k !== undefined) return row[k];
  }
  return "";
}

  function getCol(row, names){ return findVal(row, names); }

  function getTCDevolvidaValue(row){
  const named = getCol(row,["Tabela - TC Devolvida (R$)","Tabela - TC Devolvida","TC Devolvida","Tabela TC Devolvida"]);
  if(named !== "" && named !== null && named !== undefined) return named;

  // Base 03 anonimizada/padronizada: coluna E pode vir diretamente como COPARTICIPADO.
  if(isTCHeader(row.__HEADER_E) || isCoparticipadoValue(row.__COL_E)) return row.__COL_E;
  return "";
}

  function getCodigoIFValue(row){
  const named = getCol(row,["Tabela - Código IF","Tabela - Codigo IF","Codigo IF","Código IF","Tabela Codigo IF"]);
  if(named !== "" && named !== null && named !== undefined) return named;

  // Base 03 anonimizada/padronizada: coluna F pode vir diretamente como SUBSIDIADO.
  if(isIFHeader(row.__HEADER_F) || isSubsidiadoValue(row.__COL_F) || isReversaoValue(row.__COL_F)) return row.__COL_F;
  return "";
}

  function hasTCPlanColumn(row){
  return hasAnyCol(row,["Tabela - TC Devolvida (R$)","Tabela - TC Devolvida","TC Devolvida","Tabela TC Devolvida"]) || isTCHeader(row.__HEADER_E) || isCoparticipadoValue(row.__COL_E);
}

  function hasIFPlanColumn(row){
  return hasAnyCol(row,["Tabela - Código IF","Tabela - Codigo IF","Codigo IF","Código IF","Tabela Codigo IF"]) || isIFHeader(row.__HEADER_F) || isSubsidiadoValue(row.__COL_F) || isReversaoValue(row.__COL_F);
}

  function sellerNameFromRow(row){
  return normalizeText(getCol(row,[
    "Nome Vendedor","NOME_VENDEDOR","Vendedor","VENDEDOR","Consultor","Nome do Vendedor",
    "Nome vendedor","VENDEDOR_NOME","DES_VENDEDOR","Vendedor Nome","Nome"
  ]));
}

  function rowContainsExcludedName(row){
  if(typeof EXCLUDED_SELLERS === "undefined") return false;
  const joined = Object.values(row || {}).map(v => normalizeText(v)).join(" | ");
  return hashListInText(EXCLUDED_SELLERS, joined);
}

  function brabusIsoDateOnly(value){
  if(!value) return "";
  let d = null;
  if(value instanceof Date && !isNaN(value.getTime())) d = value;
  else if(typeof value === "number"){
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    d = new Date(excelEpoch.getTime() + value * 86400000);
  }else{
    const s = String(value).trim();
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+.*)?$/);
    if(m){
      let y = Number(m[3]);
      if(y < 100) y += 2000;
      d = new Date(y, Number(m[2])-1, Number(m[1]));
    }else{
      m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+.*)?$/);
      if(m) d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
      else d = new Date(s);
    }
  }
  if(!d || isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

  function brabusDataOperacaoRow(row){
  const val = getCol(row,[
    "Data Venda","DATA_VENDA","Data venda","DATA VENDA","Dt Venda","Dt.Venda",
    "Data","Data Faturamento","Op - Data Contrato","Op - Data Inclusão","Data Contrato","Data Inclusao"
  ]);
  return brabusIsoDateOnly(val || extractDateValue(row));
}

  function brabusMudancaMatch(row, vendor){
  const vendedorNorm = normalizeText(vendor || sellerNameFromRow(row));
  const loginNorm = normalizeText(getCol(row,["NBS","Código NBS","Codigo NBS","Cod NBS","ID NBS","Vendedor","VENDEDOR","Nome"]));
  const cpfRow = onlyDigits(getCol(row,["CPF Vendedor","CPF_VENDEDOR","CPF","Documento Vendedor","DOC_VENDEDOR"]));
  return (BRABUS_MUDANCAS_LOJA_VENDEDORES || []).filter(m => {
    if(!m || m.ativo === false) return false;
    const cpfOk = cpfRow && onlyDigits(m.cpf_vendedor) && cpfRow === onlyDigits(m.cpf_vendedor);
    const loginOk = loginNorm && normalizeText(m.login_vendedor || "") && loginNorm === normalizeText(m.login_vendedor || "");
    const nomeOk = vendedorNorm && normalizeText(m.nome_vendedor || "") && vendedorNorm === normalizeText(m.nome_vendedor || "");
    return cpfOk || loginOk || nomeOk;
  });
}

  function lojaEfetivaPorMudancaPortal(row, lojaPadrao=""){
  const vendor = sellerNameFromRow(row);
  const base = lojaPadrao || "";
  const ds = brabusDataOperacaoRow(row);
  if(!vendor || !ds) return base;
  const mudancas = brabusMudancaMatch(row, vendor);
  if(!mudancas.length) return base;

  for(const m of mudancas){
    const origem = normalizeText(m.loja_origem || base);
    const destino = normalizeText(m.loja_destino || base);
    const iniOrig = brabusIsoDateOnly(m.data_inicio_origem) || "0000-01-01";
    const fimOrig = brabusIsoDateOnly(m.data_fim_origem) || "9999-12-31";
    const iniDest = brabusIsoDateOnly(m.data_inicio_destino) || "9999-12-31";
    if(ds >= iniOrig && ds <= fimOrig) return origem || base;
    if(ds >= iniDest) return destino || base;
  }
  return base;
}

  function resolveLoja(row){
  const vendor = sellerNameFromRow(row);
  if(vendor){
    if(hashListHas(EXCLUDED_SELLERS, EXCLUDED_CACHE, vendor)) return "EXCLUÍDO";
    const lojaMapa = VENDOR_MAP[vendor] || "";
    const lojaEfetiva = lojaEfetivaPorMudancaPortal(row, lojaMapa);
    if(lojaEfetiva) return lojaEfetiva;
    if(lojaMapa) return lojaMapa;
    return "NÃO LOCALIZADO";
  }
  const lojaDirect = normalizeText(getCol(row,["Loja","Unidade","Ponto de Venda","Inst - Ponto de Venda"]));
  if(lojaDirect && !/^\d+$/.test(lojaDirect)){
    const lojaBase = lojaDirect.replace("MITSUBISHI | ","");
    return lojaEfetivaPorMudancaPortal(row, lojaBase) || lojaBase;
  }
  const code = normalizeText(getCol(row,["Código Loja","Cod Loja","COD_LOJA","Revenda","REVENDA_NOTA","Usuário","Usuario","COD_VENDEDOR"]));
  if(STORE_CODE_MAP[code]) return lojaEfetivaPorMudancaPortal(row, STORE_CODE_MAP[code]) || STORE_CODE_MAP[code];
  return "NÃO LOCALIZADO";
}

  function isRevendaRecord(row){
  const vendedor = sellerNameFromRow(row);
  if(hashListHas(REVENDA_SELLER, REVENDA_CACHE, vendedor)) return true;

  const lojaDirect = normalizeText(getCol(row,["Loja","Unidade","Ponto de Venda","Inst - Ponto de Venda"]));
  if(lojaDirect.includes("REVENDA")) return true;

  const lojaResolvida = resolveLoja(row);
  if(normalizeText(lojaResolvida).includes("REVENDA")) return true;

  return false;
}

  function deptFromBase01(row){
  const tx = normalizeText(getCol(row,["Transação","Transacao"]));
  if(tx === "U21") return "Seminovos";
  if(tx === "V21" || tx === "VD") return "Novos";
  const nu = normalizeText(getCol(row,["N/U","COD_TIPO_VENDA"]));
  return nu.startsWith("U") ? "Seminovos" : "Novos";
}

  function deptFromBase02(row){
  const tipo = normalizeText(getCol(row,["COD_TIPO_VENDA","N/U","Tipo"]));
  if(tipo === "U" || tipo.includes("USADO") || tipo.includes("SEMI")) return "Seminovos";
  if(tipo === "N" || tipo.includes("NOVO")) return "Novos";
  const dep = normalizeText(getCol(row,["COD_DEPARTAMENTO","Depto.","Departamento"]));
  if(dep.startsWith("2")) return "Seminovos";
  return "Novos";
}

  function modeloPadrao(raw){
  let original = normalizeText(raw);
  if(!original) return "NÃO INFORMADO";

  // Regras explícitas antes de qualquer limpeza.
  // Isso evita que versões como "TRITON TARMAC 2.4 D 4X2 AT"
  // sejam descaracterizadas e deixem de entrar na família TRITON.
  if((original.includes("TRITON") || original.includes("L200")) && original.includes("TERRA")) return "TRITON TERRA";
  if((original.includes("TRITON") || original.includes("L200")) && original.includes("TARMAC")) return "TRITON TARMAC";
  if(original.includes("ECLIPSE CROSS") && original.includes("TARMAC")) return "ECLIPSE CROSS TARMAC";

  let s = original;
  s = s.replace(/MITSUBISHI|MMC|AUT|AUTOMATICO|AUTOMATICA|AT\b|CVT\b|DIESEL|FLEX|TOTAL FLEX|TURBO|1\.5T|1\.5|2\.4|4P|C\b/g," ");
  s = s.replace(/\s+/g," ").trim();

  if(s.includes("ECLIPSE CROSS")){
    if(s.includes("RUSH")) return "ECLIPSE CROSS RUSH";
    if(s.includes("TARMAC")) return "ECLIPSE CROSS TARMAC";
    if(s.includes("BLACK")) return "ECLIPSE CROSS HPE-S BLACK";
    if(s.includes("HPE-S") || s.includes("HPE S")){
      // WAVE-C4B: "AWC" isolado (sem hífen) é rota real confirmada em
      // portal_finance_operations/portal_sales (Wave C.4A) e antes caía
      // no default 4X2 -- nunca coberto por S-AWC/SAWC/AWD. Autoridade
      // de negócio: AWC = 4x4, nunca 4x2. Checado contra `original`
      // (pré-limpeza), não `s`: a própria regex de limpeza acima (o
      // termo genérico `C\b`) come o "C" final de "AWC"/"S-AWC"/"SAWC",
      // reduzindo-os a "AW"/"S-AW"/"SAW" -- por isso nenhum desses três
      // jamais batia contra `s` (bug pré-existente mais profundo do que
      // o omission original relatado em C.4A). Mirror byte-identical do
      // fix em modules/analise-geral-grupo-secure-original-layout.html
      // (portal-financiamento-brabus-secure-orch1).
      if(original.includes("4X4") || original.includes("S-AWC") || original.includes("SAWC") || original.includes("AWD") || original.includes("AWC")) return "ECLIPSE CROSS HPE-S 4X4";
      if(s.includes("4X2") || s.includes("2WD")) return "ECLIPSE CROSS HPE-S 4X2";
      return "ECLIPSE CROSS HPE-S 4X2";
    }
    if(s.includes("HPE")) return "ECLIPSE CROSS HPE";
    return "ECLIPSE CROSS";
  }
  if(s.includes("TRITON") || s.includes("L200")){
    if(s.includes("KATANA")) return "TRITON KATANA";
    if(s.includes("SAVANA")) return "TRITON SAVANA";
    if(s.includes("TARMAC")) return "TRITON TARMAC";
    if(s.includes("BF MS")) return "TRITON BF MS"; // mirror de origin/main 19660cc (série especial BF MS ainda não cadastrada nas bases)
    if(s.includes("HPE-S") || s.includes("HPE S")) return "TRITON HPE-S";
    if(s.includes("HPE")) return "TRITON HPE";
    if(s.includes("GLS")) return "TRITON GLS";
    if(s.includes("GL")) return "TRITON GL";
    return "INCONSISTÊNCIA TRITON";
  }
  if(s.includes("OUTLANDER")){
    if(s.includes("SIGNATURE")) return "OUTLANDER SIGNATURE";
    if(s.includes("HPE-S") || s.includes("HPE S")) return "OUTLANDER HPE-S";
    return "OUTLANDER";
  }
  return normalizeText(raw);
}

  function familyOfModel(model){
  const m = normalizeText(model);
  if(m.includes("OUTLANDER")) return "OUTLANDER";
  if(m.includes("TRITON") || m.includes("L200")) return "TRITON";
  if(m.includes("ECLIPSE")) return "ECLIPSE CROSS";
  return "OUTROS";
}

  function addAgg(map, key, values){
  if(!map[key]) map[key]={qtd:0,vendas:0,fin:0,receita:0,producao:0,parcelasSum:0,parcelasQtd:0,pmtSum:0,pmtQtd:0,balaoQtd:0,linearQtd:0,coparticipadoQtd:0,subsidiadoQtd:0,reversaoQtd:0,balaoValorSum:0,balaoValorQtd:0};
  const o = map[key];
  for(const [k,v] of Object.entries(values)){
    if(k.endsWith("Qtd")) o[k] += v ? 1 : 0;
    else o[k] = (o[k]||0) + (v||0);
  }
  return o;
}

  function rowsFromAgg(map, splitKey="chave"){
  return Object.entries(map).map(([k,v]) => ({
    [splitKey]:k, ...v,
    parcelasMed: v.parcelasQtd ? v.parcelasSum/v.parcelasQtd : 0,
    pmtMed: v.pmtQtd ? v.pmtSum/v.pmtQtd : 0,
    balaoMed: v.balaoValorQtd ? v.balaoValorSum/v.balaoValorQtd : 0,
    retorno: v.producao ? (v.receitaTotal || ((v.receita||0)+(v.receitaSPF||0)))/v.producao : 0,
    retornoTotal: v.producao ? (v.receitaTotal || ((v.receita||0)+(v.receitaSPF||0)))/v.producao : 0,
    penetracao: v.vendas ? v.fin/v.vendas : 0
  }));
}

  function keyCliente(row, base){
  const nomeRaw = getCol(row, base==="b03"
    ? ["Cli - Nome","Cliente","Nome Cliente","CLIENTE","Nome/Razão Social","Razão Social"]
    : ["CLIENTE","Cliente","Nome Cliente","Cli - Nome","Nome/Razão Social","Razão Social"]
  );
  const cpfRaw = getCol(row, base==="b03"
    ? ["Cli - CPF/CNPJ","CPF","CPF/CNPJ","CNPJ","CPF CNPJ","Documento"]
    : ["CPF","CPF/CNPJ","Cli - CPF/CNPJ","CNPJ","CPF CNPJ","Documento"]
  );

  const nome = normalizeText(nomeRaw);
  const nomeClean = normalizeClientName(nomeRaw);
  const cpf = onlyDigits(cpfRaw);

  return {
    nome,
    nomeClean,
    cpf,
    both: cpf ? `${nome}|${cpf}` : "",
    bothClean: cpf ? `${nomeClean}|${cpf}` : "",
    name:nome,
    nameClean:nomeClean,
    variants: clientNameVariants(nomeRaw)
  };
}

  function processBase01(rows){
  const grouped = {};
  rows.forEach((row,idx)=>{
    if(rowContainsExcludedName(row) || isRevendaRecord(row)) return;
    const chassi = normalizeText(getCol(row,["Chassi","CHASSI"]));
    if(!chassi) return;
    (grouped[chassi] ||= []).push({...row, __idx:idx});
  });
  const valid = [];
  const excluded = [];
  for(const [chassi, arr] of Object.entries(grouped)){
    arr.sort((a,b)=> {
      const da = asDateValue(getCol(a,["Data Venda","DATA_VENDA","Data"]));
      const db = asDateValue(getCol(b,["Data Venda","DATA_VENDA","Data"]));
      return da - db || a.__idx - b.__idx;
    });
    const relevant = arr.filter(r => {
      const tx = normalizeText(getCol(r,["Transação","Transacao"]));
      return ALLOWED_SALES.has(tx) || DEV_TX.has(tx) || EXCLUDE_TX.has(tx);
    });
    if(!relevant.length) continue;
    const last = relevant[relevant.length-1];
    const tx = normalizeText(getCol(last,["Transação","Transacao"]));
    if(ALLOWED_SALES.has(tx)){
      const dept = deptFromBase01(last);
      valid.push({
        origem:last, chassi, dept,
        vendedor: normalizeText(getCol(last,["Nome Vendedor","Vendedor"])),
        loja: resolveLoja(last),
        modelo: dept==="Novos" ? modeloPadrao(getCol(last,["Modelo","DES_MODELO"])) : "",
        valorVenda: asVehicleSaleValue(getCol(last,["Valor Venda","VALOR_VENDA"]))
      });
    } else excluded.push({chassi, tx});
  }
  return {valid, excluded};
}

  function processBase02(rows, b03index){
  const valid = [];
  const semMatch = [];
  rows.forEach(row=>{
    if(rowContainsExcludedName(row)) return;
    const financiado = asNumber(getCol(row,["FINANCIADO","Financiado"]));
    const desc = normalizeText(getCol(row,["DESCRICAO","Descrição","Tipo"]));
    const valorFin = asNumber(getCol(row,["VALOR_FINANCIADO","Valor Financiado","PRODUCAO","Produção"]));
    const receita = asNumber(getCol(row,["RECEITA","Retorno","VALOR_LIQUIDO"]));
    const receitaSPF = asNumber(getCol(row,["RECEITA_SPF","Receita SPF"]));
    const isFin = financiado === 1 || desc.includes("FINANCIAMENTO") || valorFin > 0 || receita > 0;
    if(!isFin || valorFin <= 0) return;

    const kc = keyCliente(row,"b02");
    let candidates = concatB03Candidates(
      kc.both ? b03index.byBoth[kc.both] : null,
      kc.bothClean ? b03index.byBothClean[kc.bothClean] : null,
      kc.cpf ? b03index.byDoc[kc.cpf] : null,
      b03index.byName[kc.name],
      b03index.byNameClean[kc.nameClean]
    );

    if((!candidates || !candidates.length) && kc.variants){
      for(const v of kc.variants){
        candidates = concatB03Candidates(candidates, b03index.byName[v]);
      }
    }

    let comp = chooseBestB03Row(candidates);

    if(!comp) semMatch.push(kc.name || kc.nomeClean);

    const dept = deptFromBase02(row);
    const balaoValor = comp ? asNumber(getCol(comp,["Op Fin - Balão PMT (R$)","Balão PMT","Balao PMT"])) : 0;

    const tcDevolvidaRaw = comp ? getTCDevolvidaValue(comp) : "";
    const codigoIFRaw = comp ? getCodigoIFValue(comp) : "";

    const tcDevolvida = asNumber(tcDevolvidaRaw);
    const codigoIF = normalizeText(codigoIFRaw);
    const codigoIFNum = asNumber(codigoIFRaw);

    let planoClassificado = "LINEAR";

    const isCoparticipadoFlag = isCoparticipadoValue(tcDevolvidaRaw) || tcDevolvida === 1;
    const isSubsidiadoFlag = isSubsidiadoValue(codigoIFRaw) || codigoIF === "999" || codigoIFNum === 999;
    const isReversaoFlag = isReversaoValue(codigoIFRaw) || codigoIF === "777" || codigoIFNum === 777;
    const isBalaoFlag = balaoValor > 0;

    // Prioridade oficial (igual a planTypeFromFields() do módulo Análise F&I do Grupo):
    // SUBSIDIADO > REVERSÃO > COPARTICIPADO > BALÃO > LINEAR.
    if(isSubsidiadoFlag) planoClassificado = "SUBSIDIADO";
    else if(isReversaoFlag) planoClassificado = "REVERSÃO";
    else if(isCoparticipadoFlag) planoClassificado = "COPARTICIPADO";
    else if(isBalaoFlag) planoClassificado = "BALÃO";

    valid.push({
      origem: row,
      loja: resolveLoja(row),
      dept,
      vendedor: normalizeText(getCol(row,["NOME_VENDEDOR","Nome Vendedor","Vendedor"])),
      cliente: kc.name,
      modelo: dept==="Novos" ? modeloPadrao(getCol(row,["DES_MODELO","Modelo","VEICULO"])) : "",
      receita,
      receitaSPF,
      receitaTotal: receita + receitaSPF,
      producao: valorFin,
      parcelas: comp ? asNumber(getCol(comp,["Op Fin - Quantidade Parcelas","Quantidade Parcelas","Parcelas"])) : 0,
      pmt: comp ? asNumber(getCol(comp,["Op Fin - PMT (R$)","PMT","Valor Parcela"])) : 0,
      balaoValor,
      tcDevolvida,
      codigoIF,
      plano: balaoValor > 0 ? "BALÃO" : "LINEAR",
      planoClassificado,
      isCoparticipadoFlag,
      isSubsidiadoFlag,
      isReversaoFlag,
      isBalaoFlag,
      matched: !!comp
    });
  });
  return {valid, semMatch:[...new Set(semMatch)].filter(Boolean)};
}

  function buildB03Index(rows){
  base03PlanDiagnostics = {
    hasTC: (rows || []).some(row => hasTCPlanColumn(row)),
    hasIF: (rows || []).some(row => hasIFPlanColumn(row))
  };

  const byBoth={}, byBothClean={}, byName={}, byNameClean={}, byDoc={};

  const pushIndex = (obj, key, row) => {
    if(!key) return;
    if(!obj[key]) obj[key] = [];
    obj[key].push(row);
  };

  rows.forEach(row=>{
    const kc = keyCliente(row,"b03");

    pushIndex(byBoth, kc.both, row);
    pushIndex(byBothClean, kc.bothClean, row);
    pushIndex(byDoc, kc.cpf, row);

    (kc.variants || []).forEach(v => pushIndex(byName, v, row));
    pushIndex(byNameClean, kc.nameClean, row);
  });

  return {byBoth, byBothClean, byName, byNameClean, byDoc};
}

  function scoreB03PlanRow(row){
  if(!row) return -1;

  const balaoValor = asNumber(getCol(row,["Op Fin - Balão PMT (R$)","Balão PMT","Balao PMT"]));
  const tcRaw = getTCDevolvidaValue(row);
  const ifRaw = getCodigoIFValue(row);
  const tcNum = asNumber(tcRaw);
  const ifNum = asNumber(ifRaw);

  // Prioridade oficial (igual a planTypeFromFields() do módulo Análise F&I do Grupo):
  // SUBSIDIADO > REVERSÃO > COPARTICIPADO > BALÃO > LINEAR.
  if(isSubsidiadoValue(ifRaw) || normalizeText(ifRaw) === "999" || ifNum === 999) return 100;
  if(isReversaoValue(ifRaw) || normalizeText(ifRaw) === "777" || ifNum === 777) return 90;
  if(isCoparticipadoValue(tcRaw) || tcNum === 1) return 85;
  if(balaoValor > 0) return 80;

  const pmt = asNumber(getCol(row,["Op Fin - PMT (R$)","PMT","Valor Parcela"]));
  const parcelas = asNumber(getCol(row,["Op Fin - Quantidade Parcelas","Quantidade Parcelas","Parcelas"]));
  const financiado = asNumber(getCol(row,["Op Fin - Financiado (R$)","Financiado"]));

  return (pmt > 0 ? 20 : 0) + (parcelas > 0 ? 10 : 0) + (financiado > 0 ? 5 : 0);
}

  function chooseBestB03Row(rows){
  if(!rows) return null;
  const list = Array.isArray(rows) ? rows : [rows];
  if(!list.length) return null;
  return list.slice().sort((a,b)=>scoreB03PlanRow(b)-scoreB03PlanRow(a))[0] || null;
}

  function concatB03Candidates(){
  const arr = [];
  for(const item of arguments){
    if(!item) continue;
    if(Array.isArray(item)) arr.push(...item);
    else arr.push(item);
  }
  return [...new Set(arr)];
}

  function aggregate(results){
  const {sales, fins} = results;
  const a = {
    vendasLoja:{}, vendasDept:{}, vendasVendDept:{}, vendasModelo:{},
    finLoja:{}, finDept:{}, finVendDept:{}, finModelo:{},
    compLojaDept:{}, compModelo:{}, shareLojaDept:{}, shareVendDept:{}
  };

  sales.forEach(r=>{
    addAgg(a.vendasLoja, r.loja, {qtd:1,vendas:1});
    addAgg(a.vendasDept, r.dept, {qtd:1,vendas:1});
    addAgg(a.vendasVendDept, `${r.vendedor} | ${r.dept}`, {qtd:1,vendas:1});
    addAgg(a.shareLojaDept, `${r.loja} | ${r.dept}`, {vendas:1});
    addAgg(a.shareVendDept, `${r.vendedor} | ${r.dept}`, {vendas:1});
    if(r.dept==="Novos") addAgg(a.vendasModelo, r.modelo, {qtd:1,vendas:1});
  });

  fins.forEach(r=>{
    const compVals = {
      qtd:1, fin:1, receita:r.receita, receitaSPF:r.receitaSPF || 0, receitaTotal:(r.receita || 0) + (r.receitaSPF || 0), producao:r.producao,
      parcelasSum:r.parcelas, parcelasQtd:r.parcelas>0?1:0,
      pmtSum:r.pmt, pmtQtd:r.pmt>0?1:0,
      // Classificação preservada via planoClassificado/isFin*() — a agregação não pode
      // reduzir COPARTICIPADO, SUBSIDIADO e REVERSÃO a BALÃO/LINEAR (ver planTypeFromFields()).
      balaoQtd:isFinBalao(r)?1:0,
      linearQtd:isFinLinear(r)?1:0,
      coparticipadoQtd:isFinCoparticipado(r)?1:0,
      subsidiadoQtd:isFinSubsidiado(r)?1:0,
      reversaoQtd:isFinReversao(r)?1:0,
      balaoValorSum:r.balaoValor,
      balaoValorQtd:r.balaoValor>0?1:0
    };
    addAgg(a.finLoja, r.loja, compVals);
    addAgg(a.finDept, r.dept, compVals);
    addAgg(a.finVendDept, `${r.vendedor} | ${r.dept}`, compVals);
    addAgg(a.compLojaDept, `${r.loja} | ${r.dept}`, compVals);
    addAgg(a.shareLojaDept, `${r.loja} | ${r.dept}`, compVals);
    addAgg(a.shareVendDept, `${r.vendedor} | ${r.dept}`, compVals);
    if(r.dept==="Novos") {
      addAgg(a.finModelo, r.modelo, compVals);
      addAgg(a.compModelo, r.modelo, compVals);
    }
  });
  return a;
}

  function isFinCoparticipado(r){
  if(!r) return false;
  return r.isCoparticipadoFlag === true || r.planoClassificado === "COPARTICIPADO";
}

  function isFinSubsidiado(r){
  if(!r) return false;
  return r.isSubsidiadoFlag === true || r.planoClassificado === "SUBSIDIADO" || isSubsidiadoValue(r.codigoIF);
}

  function isFinReversao(r){
  if(!r) return false;
  return r.isReversaoFlag === true || r.planoClassificado === "REVERSÃO" || isReversaoValue(r.codigoIF);
}

  function isFinBalao(r){
  if(!r) return false;
  return r.isBalaoFlag === true || (r.balaoValor || 0) > 0;
}

  function isFinLinear(r){
  return !isFinBalao(r) && !isFinCoparticipado(r) && !isFinSubsidiado(r) && !isFinReversao(r);
}

  function isPlanoSubsidiada(r){ return isFinSubsidiado(r); }

  function isPlanoReversao(r){
  return (typeof isFinReversao === "function")
    ? isFinReversao(r)
    : !!(r && (r.planoClassificado === "REVERSÃO" || normalizeText(r.codigoIF).includes("REVERSAO") || normalizeText(r.codigoIF).includes("REVERSÃO")));
}

  function isPlanoCoparticipada(r){ return isFinCoparticipado(r); }

  function isPlanoBalaoClassificado(r){ return isFinBalao(r); }

  function planoKeyOperacao(r){
  if(isPlanoSubsidiada(r)) return "SUBSIDIADO";
  if(isPlanoReversao(r)) return "REVERSÃO";
  if(isPlanoCoparticipada(r)) return "COPARTICIPADO";
  if(isPlanoBalaoClassificado(r)) return "BALÃO";
  return "LINEAR";
}

  function planoPriority(key){ return {"SUBSIDIADO":5,"REVERSÃO":4,"COPARTICIPADO":3,"BALÃO":2,"LINEAR":1}[key] || 0; }

  function planoCounts(registros){
  const c = {LINEAR:0,"BALÃO":0,COPARTICIPADO:0,SUBSIDIADO:0,"REVERSÃO":0};
  (registros || []).forEach(r => { const k = planoKeyOperacao(r); c[k] = (c[k] || 0) + 1; });
  return c;
}

  function getPlanoDestaque(registros){
  const c = planoCounts(registros);
  let best = "";
  Object.keys(c).forEach(k=>{
    if(!best || c[k] > c[best] || (c[k] === c[best] && planoPriority(k) > planoPriority(best))) best = k;
  });
  return c[best] > 0 ? best : "";
}

  function rankingFromViews(salesView, finsView, tipo){
  const map = {};

  const keyFor = (r) => {
    if(tipo === "loja") return r.loja || "NÃO LOCALIZADO";
    if(tipo === "dept") return r.dept || "NÃO INFORMADO";
    const loja = r.loja || VENDOR_MAP[normalizeText(r.vendedor)] || "NÃO LOCALIZADO";
    return `${r.vendedor || "NÃO INFORMADO"} | ${r.dept || "NÃO INFORMADO"} | ${loja}`;
  };

  salesView.forEach(r=>{
    const k = keyFor(r);
    if(!map[k]) map[k] = {Nome:k, vendas:0, fin:0, receita:0, receitaSPF:0, receitaTotal:0, producao:0};
    map[k].vendas += 1;
  });

  finsView.forEach(r=>{
    const k = keyFor(r);
    if(!map[k]) map[k] = {Nome:k, vendas:0, fin:0, receita:0, receitaSPF:0, receitaTotal:0, producao:0};
    map[k].fin += 1;
    map[k].receita += r.receita || 0;
    map[k].receitaSPF += r.receitaSPF || 0;
    map[k].receitaTotal += (r.receita || 0) + (r.receitaSPF || 0);
    map[k].producao += r.producao || 0;
  });

  return Object.values(map)
    .map((r,i)=>({
      ...r,
      penetracao:r.vendas ? r.fin/r.vendas : 0,
      retorno:r.producao ? (r.receitaTotal || ((r.receita||0)+(r.receitaSPF||0)))/r.producao : 0,
      retornoTotal:r.producao ? (r.receitaTotal || ((r.receita||0)+(r.receitaSPF||0)))/r.producao : 0
    }))
    .sort((a,b)=>((b.receitaTotal||b.receita||0)-(a.receitaTotal||a.receita||0)));
}

  function buildNovosLojaRows(results){
  const sales = (results.sales || []).filter(r => r.dept === "Novos");
  const fins = (results.fins || []).filter(r => r.dept === "Novos");
  const map = {};
  const ensure = loja => {
    const k = loja || "NÃO LOCALIZADO";
    if(!map[k]) map[k] = {Loja:k,Vendidos:0,Financiados:0,Balao:0,BalaoPct:0,Subsidiada:0,Coparticipada:0,Reversao:0,Linear:0,PlanoDestaque:"",_regs:[]};
    return map[k];
  };
  sales.forEach(r => ensure(r.loja).Vendidos++);
  fins.forEach(r => {
    const row = ensure(r.loja);
    row.Financiados++;
    row._regs.push(r);
    if(isPlanoSubsidiada(r)) row.Subsidiada++;
    else if(isPlanoReversao(r)) row.Reversao++;
    else if(isPlanoCoparticipada(r)) row.Coparticipada++;
    else if(isPlanoBalaoClassificado(r)) row.Balao++;
    else row.Linear++;
  });
  const rows = Object.values(map).sort((a,b)=>(b.Vendidos-a.Vendidos)||(b.Financiados-a.Financiados)||a.Loja.localeCompare(b.Loja));
  rows.forEach(r => {
    r.BalaoPct = r.Financiados ? r.Balao/r.Financiados : 0;
    r.PlanoDestaque = getPlanoDestaque(r._regs || []);
  });
  const total = rows.reduce((a,r)=>{
    a.Vendidos+=r.Vendidos; a.Financiados+=r.Financiados; a.Balao+=r.Balao; a.Subsidiada+=r.Subsidiada;
    a.Coparticipada+=r.Coparticipada; a.Reversao+=r.Reversao; a.Linear+=r.Linear; a._regs.push(...(r._regs||[])); return a;
  }, {Loja:"TOTAL GERAL",Vendidos:0,Financiados:0,Balao:0,BalaoPct:0,Subsidiada:0,Coparticipada:0,Reversao:0,Linear:0,PlanoDestaque:"",_regs:[],_total:true});
  total.BalaoPct = total.Financiados ? total.Balao/total.Financiados : 0;
  total.PlanoDestaque = getPlanoDestaque(total._regs || []);
  return [...rows, total];
}

  function saleMatchKey(nome, valorVenda){
  const n = normalizeClientName(nome || "");
  const v = Math.round(asNumber(valorVenda || 0));
  return n && v > 0 ? `${n}|${v}` : "";
}

  function getSaleValorVenda(row){
  return asVehicleSaleValue(getCol(row,["Valor Venda","VALOR_VENDA","Valor Presente Venda","VALOR VENDA","Vlr Venda"]));
}

  function getFinValorVenda(row){
  const valorNovo = asVehicleSaleValue(getCol(row, ["VALOR_VENDA_NOVO"]));
  if(valorNovo > 0) return valorNovo;
  return asVehicleSaleValue(getCol(row,[
    "VALOR_VENDA",
    "Valor Venda",
    "Valor Presente Venda",
    "VALOR VENDA",
    "Vlr Venda",
    "Valor NF",
    "Valor Vendido - DI",
    "Valor do Veículo",
    "Valor Veiculo"
  ]));
}

  function buildSalesByChassiForEntry(sales){
  const idx = {};
  (sales || []).forEach(s=>{
    if(s.dept !== "Novos") return;
    const origem = s.origem || {};
    const valorVenda = s.valorVenda || getSaleValorVenda(origem);
    if(valorVenda <= 0) return;
    [
      s.chassi,
      getCol(origem,["Chassi","CHASSI","Chassi Resumido","Chassi Completo"])
    ].map(normalizeText).filter(Boolean).forEach(chassi=>{
      if(!idx[chassi]) idx[chassi] = {valorVenda, sale:s};
    });
  });
  return idx;
}

  function buildSalesValueIndexForEntry(sales){
  const idx = {};
  (sales || []).forEach(s=>{
    if(s.dept !== "Novos") return;
    const origem = s.origem || {};
    const nome = s.cliente || getCol(origem,["Nome Cliente","Cliente","CLIENTE","Cli - Nome"]);
    const valorVenda = s.valorVenda || getSaleValorVenda(origem);
    const key = saleMatchKey(nome, valorVenda);
    if(key && !idx[key]) idx[key] = {valorVenda, modelo:s.modelo, cliente:normalizeText(nome)};
  });
  return idx;
}

  function modelExtraMetrics(results, modelo){
  const salesByChassi = buildSalesByChassiForEntry(results.sales || []);
  const fins = (results.fins || []).filter(r=>r.dept==="Novos" && r.modelo===modelo);
  const totalProd = fins.reduce((a,r)=>a+(r.producao||0),0);
  const totalRec = fins.reduce((a,r)=>a+(r.receita||0),0);

  const prazoRows = fins.filter(r=>(r.parcelas||0)>0);
  const pmtRows = fins.filter(r=>(r.pmt||0)>0);
  const entradas = [];

  fins.forEach(fin=>{
    const origem = fin.origem || {};
    const chassi = normalizeText(fin.chassi || getCol(origem,["Chassi","CHASSI","Chassi Resumido","Chassi Completo"]));
    const sale = chassi ? salesByChassi[chassi] : null;
    const valorVenda = fin.valorVenda || getFinValorVenda(origem) || (sale ? sale.valorVenda : 0);
    const financiado = fin.producao || asNumber(getCol(origem,["VALOR_FINANCIADO","Valor Financiado"]));
    if(valorVenda > 0 && financiado > 0 && financiado <= valorVenda * 1.15){
      const entradaInformada = asNumber(getCol(origem,["ENTRADA_NOVO","Entrada","VALOR_ENTRADA","Valor Entrada"]));
      const entrada = entradaInformada > 0 ? entradaInformada : Math.max(0, valorVenda - financiado);
      entradas.push({entrada, valorVenda, pct: entrada / valorVenda});
    }
  });

  const entradaTotal = entradas.reduce((a,r)=>a+r.entrada,0);
  const valorVendaTotal = entradas.reduce((a,r)=>a+r.valorVenda,0);
  return {
    retornoMedio: totalProd ? fins.reduce((a,r)=>a+(r.receita||0)+(r.receitaSPF||0),0) / totalProd : 0,
    prazoMedio: prazoRows.length ? prazoRows.reduce((a,r)=>a+(r.parcelas||0),0)/prazoRows.length : 0,
    pmtMed: pmtRows.length ? pmtRows.reduce((a,r)=>a+(r.pmt||0),0)/pmtRows.length : 0,
    entradaQtd: entradas.length,
    entradaTotal,
    valorVendaTotal,
    entradaMed: entradas.length ? entradaTotal/entradas.length : 0,
    entradaPct: valorVendaTotal ? entradaTotal/valorVendaTotal : 0
  };
}

  function familyExtraMetrics(results, rows){
  const totalFin = rows.reduce((a,r)=>a+(r.financiada||0),0);
  const entradaQtd = rows.reduce((a,r)=>a+(r.entradaQtd||0),0);
  const entradaTotal = rows.reduce((a,r)=>a+(r.entradaTotal||0),0);
  const valorVendaTotal = rows.reduce((a,r)=>a+(r.valorVendaTotal||0),0);
  return {
    retornoMedio: rows.reduce((a,r)=>a+(r.receitaTotal||((r.receita||0)+(r.receitaSPF||0))),0)/(rows.reduce((a,r)=>a+(r.producao||0),0)||1),
    prazoMedio: rows.reduce((a,r)=>a+(r.prazoMedio||0)*(r.financiada||0),0)/(totalFin||1),
    pmtMed: rows.reduce((a,r)=>a+(r.pmtMed||0)*(r.financiada||0),0)/(totalFin||1),
    entradaMed: entradaQtd ? entradaTotal/entradaQtd : 0,
    entradaPct: valorVendaTotal ? entradaTotal/valorVendaTotal : 0
  };
}

  function modelRowsUnified(results, family){
  const A = results.aggs;
  const vendasModelo = rowsFromAgg(A.vendasModelo,"Modelo");
  const compModelo = rowsFromAgg(A.compModelo,"Modelo");
  const finModelo = rowsFromAgg(A.finModelo,"Modelo");
  const all = new Set([...(FAMILY_MODELS[family] || []), ...vendasModelo.map(x=>x.Modelo).filter(m=>familyOfModel(m)===family)]);
  return [...all].map(model=>{
    const v = vendasModelo.find(x=>x.Modelo===model) || {};
    const c = compModelo.find(x=>x.Modelo===model) || {};
    const f = finModelo.find(x=>x.Modelo===model) || {};
    const vendas = v.qtd || 0;
    const fin = f.qtd || c.qtd || 0;
    const producao = f.producao || c.producao || 0;
    const extra = modelExtraMetrics(results, model);
    return {
      Modelo:model,
      volume:vendas,
      financiada:fin,
      penetracao:vendas ? fin/vendas : 0,
      producao:producao,
      receita:f.receita || c.receita || 0,
      receitaSPF:f.receitaSPF || c.receitaSPF || 0,
      receitaTotal:f.receitaTotal || c.receitaTotal || ((f.receita || c.receita || 0) + (f.receitaSPF || c.receitaSPF || 0)),
      ticket:fin ? producao/fin : 0,
      parcelasMed:c.parcelasMed || 0,
      pmtMed:extra.pmtMed || c.pmtMed || 0,
      linearQtd:c.linearQtd || 0,
      balaoQtd:c.balaoQtd || 0,
      reversaoQtd:(results.fins || []).filter(r=>r.dept==="Novos" && r.modelo===model && isFinReversao(r)).length,
      balaoMed:c.balaoMed || 0,
      retornoMedio:extra.retornoMedio,
      prazoMedio:extra.prazoMedio || c.parcelasMed || 0,
      entradaQtd:extra.entradaQtd || 0,
      entradaTotal:extra.entradaTotal || 0,
      valorVendaTotal:extra.valorVendaTotal || 0,
      entradaMed:extra.entradaMed,
      entradaPct:extra.entradaPct
    };
  }).sort((a,b)=>b.volume-a.volume || a.Modelo.localeCompare(b.Modelo));
}

  function planRowsByModel(results, family){
  const modelos = FAMILY_MODELS[family] || [];
  const rows = [];

  modelos.forEach(modelo=>{
    const finRows = results.fins.filter(r => r.dept === "Novos" && r.modelo === modelo);
    const total = finRows.length || 0;

    const countLinear = finRows.filter(isFinLinear).length;
    const countBalao = finRows.filter(isFinBalao).length;
    const countCop = finRows.filter(isFinCoparticipado).length;
    const countSub = finRows.filter(isFinSubsidiado).length;
    const countRev = finRows.filter(isFinReversao).length;

    rows.push({
      Modelo:modelo,
      Financiamentos:total,
      Linear:countLinear,
      LinearPct:total ? countLinear/total : 0,
      Balao:countBalao,
      BalaoPct:total ? countBalao/total : 0,
      Coparticipado:countCop,
      CoparticipadoPct:total ? countCop/total : 0,
      Subsidiado:countSub,
      SubsidiadoPct:total ? countSub/total : 0,
      Reversao:countRev,
      ReversaoPct:total ? countRev/total : 0
    });
  });

  return rows.sort((a,b)=>b.Financiamentos-a.Financiamentos || a.Modelo.localeCompare(b.Modelo));
}

  function planRowsByStoreForFamily(results, family){
  const modelos = FAMILY_MODELS[family] || [];
  const finRows = results.fins.filter(r => r.dept === "Novos" && modelos.includes(r.modelo));
  const lojas = [...new Set(finRows.map(r=>r.loja).filter(Boolean))].sort((a,b)=>a.localeCompare(b));

  return lojas.map(loja=>{
    const rows = finRows.filter(r=>r.loja===loja);
    const total = rows.length || 0;

    const countLinear = rows.filter(isFinLinear).length;
    const countBalao = rows.filter(isFinBalao).length;
    const countCop = rows.filter(isFinCoparticipado).length;
    const countSub = rows.filter(isFinSubsidiado).length;
    const countRev = rows.filter(isFinReversao).length;

    return {
      Loja:loja,
      Financiamentos:total,
      Linear:countLinear,
      LinearPct:total ? countLinear/total : 0,
      Balao:countBalao,
      BalaoPct:total ? countBalao/total : 0,
      Coparticipado:countCop,
      CoparticipadoPct:total ? countCop/total : 0,
      Subsidiado:countSub,
      SubsidiadoPct:total ? countSub/total : 0,
      Reversao:countRev,
      ReversaoPct:total ? countRev/total : 0
    };
  }).sort((a,b)=>b.Financiamentos-a.Financiamentos || a.Loja.localeCompare(b.Loja));
}

  function planTotalRowsForFamily(results, family){
  const modelos = FAMILY_MODELS[family] || [];
  const rows = results.fins.filter(r => r.dept === "Novos" && modelos.includes(r.modelo));
  const total = rows.length || 0;
  const countLinear = rows.filter(isFinLinear).length;
  const countBalao = rows.filter(isFinBalao).length;
  const countCop = rows.filter(isFinCoparticipado).length;
  const countSub = rows.filter(isFinSubsidiado).length;
  const countRev = rows.filter(isFinReversao).length;
  return [{
    Família: family,
    Financiamentos: total,
    Linear: countLinear,
    LinearPct: total ? countLinear/total : 0,
    Balao: countBalao,
    BalaoPct: total ? countBalao/total : 0,
    Coparticipado: countCop,
    CoparticipadoPct: total ? countCop/total : 0,
    Subsidiado: countSub,
    SubsidiadoPct: total ? countSub/total : 0,
    Reversao: countRev,
    ReversaoPct: total ? countRev/total : 0
  }];
}

  function specialPlanDetailRows(results, family){
  const modelos = FAMILY_MODELS[family] || [];
  return results.fins
    .filter(r => r.dept === "Novos" && modelos.includes(r.modelo))
    .filter(r => isFinCoparticipado(r) || isFinSubsidiado(r) || isFinReversao(r))
    .map(r => ({
      Loja:r.loja,
      Modelo:r.modelo,
      Plano:[isFinCoparticipado(r) ? "COPARTICIPADO" : "", isFinSubsidiado(r) ? "SUBSIDIADO" : "", isFinReversao(r) ? "REVERSÃO" : ""].filter(Boolean).join(" + "),
      Cliente:r.cliente || "",
      Producao:r.producao || 0,
      Receita:r.receita || 0
    }))
    .sort((a,b)=>a.Plano.localeCompare(b.Plano) || a.Modelo.localeCompare(b.Modelo) || a.Loja.localeCompare(b.Loja));
}

  function inconsistenciaTritonRows(results){
  const vendas = (results.sales || []).filter(r => r.dept === "Novos" && r.modelo === "INCONSISTÊNCIA TRITON")
    .map(r => ({Base:"Base 01", Cliente:r.cliente||"", ModeloOriginal:getCol(r.origem||{},["Modelo","DES_MODELO","Veículo"]), Vendedor:r.vendedor||""}));
  const fins = (results.fins || []).filter(r => r.dept === "Novos" && r.modelo === "INCONSISTÊNCIA TRITON")
    .map(r => ({Base:"Base 02", Cliente:r.cliente||"", ModeloOriginal:getCol(r.origem||{},["DES_MODELO","Modelo","VEICULO"]), Vendedor:r.vendedor||""}));
  return [...vendas, ...fins];
}

  function lookupNbsLocal(nbs){
  const key = normalizeText(nbs);
  return NBS_VENDOR_LOOKUP_LOCAL[key] || null;
}

  function montarMapaVendedoresLocal(rows){
  NBS_VENDOR_LOOKUP_LOCAL = {};

  rows.forEach(row => {
    const nbs = normalizeText(getCol(row, ["NBS", "Codigo NBS", "Código NBS"]));
    const nome = normalizeText(getCol(row, ["Nome", "Vendedor", "Nome Vendedor"]));
    const loja = normalizeText(getCol(row, ["Loja", "Unidade", "Loja / Unidade"]));

    if(!nbs || !nome || !loja) return;
    if(loja.includes("REVENDA")) return;

    NBS_VENDOR_LOOKUP_LOCAL[nbs] = {nome, loja};

    // Também alimenta o mapa antigo para preservar funções já existentes
    VENDOR_MAP[nome] = loja;
    VENDOR_MAP[nbs] = loja;
  });
}

  function inferirTipoNovoSeminovo(row, vendaRef=null){
  function extrairTipo(r){
    if(!r) return "";

    const candidatos = [
      getCol(r, ["Novo"]),
      getCol(r, ["N/U"]),
      getCol(r, ["COD_TIPO_VENDA"]),
      getCol(r, ["Novo/Usado"]),
      getCol(r, ["Novo Usado"]),
      getCol(r, ["Tipo"]),
      getCol(r, ["Tipo Veículo", "Tipo Veiculo"]),
      getCol(r, ["Departamento"]),
      getCol(r, ["Transação", "Transacao"])
    ].map(normalizeText).filter(Boolean);

    const vals = candidatos.join(" ");

    if(vals === "U" || vals.includes("U21") || vals.includes("USADO") || vals.includes("SEMINOVO") || vals.includes("SEMI")){
      return "U";
    }

    if(vals === "N" || vals.includes("V21") || vals.includes("VD") || vals.includes("NOVO")){
      return "N";
    }

    return "";
  }

  // Para financiamentos da Base 02 Nova, a venda correspondente da Base 01 deve mandar.
  const tipoVenda = extrairTipo(vendaRef);
  if(tipoVenda) return tipoVenda;

  const tipoLinha = extrairTipo(row);
  if(tipoLinha) return tipoLinha;

  // Fallback conservador para não quebrar o HTML antigo.
  return "N";
}

  function criarIndiceVendasNovasPorChassi(rowsAdaptadas){
  const idx = {};
  (rowsAdaptadas || []).forEach(r => {
    const chassi = normalizeText(getCol(r, ["Chassi","CHASSI"]));
    if(chassi) idx[chassi] = r;
  });
  return idx;
}

  function brabusValorVendaBase01Nova(refVenda){
  if(!refVenda) return 0;
  return asVehicleSaleValue(getCol(refVenda, [
    "Valor Venda",
    "VALOR_VENDA",
    "Valor de Venda",
    "Valor Vendido - DI",
    "Valor NF",
    "Valor do Veículo",
    "Valor Veiculo",
    "VALOR VENDA"
  ]));
}

  function brabusValorFinanciadoBase02Nova(row){
  return asNumber(getCol(row, [
    "Valor Serviço",
    "Valor Servico",
    "VALOR SERVICO",
    "VALOR SERVIÇO",
    "Valor Financiado",
    "VALOR_FINANCIADO",
    "Valor financiado"
  ]));
}

  function brabusDiagnosticarEntradaNova(rows, vendaIndex){
  const diag = {
    totalFinanciamentos: 0,
    chassisLocalizados: 0,
    chassisNaoLocalizados: 0,
    taxaSucesso: 0,
    naoLocalizados: [],
    calculoAplicado: false
  };

  (rows || []).forEach(row => {
    const desc = normalizeText(getCol(row, ["Descrição Serviço", "Descricao Serviço", "Descrição Servico", "DESCRICAO SERVICO", "DESCRIÇÃO SERVIÇO"]));
    if(desc && !desc.includes("POR PLANO-FINANCIAMENTO")) return;

    diag.totalFinanciamentos++;

    const chassi = normalizeText(getCol(row, ["Chassi Resumido", "Chassi", "CHASSI", "Chassi Completo"]));
    const refVenda = chassi && vendaIndex ? vendaIndex[chassi] : null;

    if(refVenda){
      diag.chassisLocalizados++;
    }else{
      diag.chassisNaoLocalizados++;
      if(diag.naoLocalizados.length < 20){
        diag.naoLocalizados.push({
          chassi: getCol(row, ["Chassi Resumido", "Chassi", "CHASSI"]),
          cliente: getCol(row, ["Cliente", "CLIENTE", "Nome Cliente"]),
          loja: getCol(row, ["Loja", "LOJA", "Unidade"])
        });
      }
    }
  });

  diag.taxaSucesso = diag.totalFinanciamentos ? (diag.chassisLocalizados / diag.totalFinanciamentos) : 0;
  // O cálculo é aplicado por operação localizada. Uma divergência em outros
  // chassis não pode zerar operações válidas.
  diag.calculoAplicado = diag.chassisLocalizados > 0;
  diagnosticoEntradaNova = diag;

  if (window.NX_DEV && window.NX_DEV.ativo) console.info("[Entrada Média - Bases Novas]", { // diagnostic rows: localhost with ?debug=1 only
    totalFinanciamentos: diag.totalFinanciamentos,
    chassisLocalizados: diag.chassisLocalizados,
    chassisNaoLocalizados: diag.chassisNaoLocalizados,
    taxaSucesso: (diag.taxaSucesso * 100).toFixed(2) + "%",
    calculoAplicado: diag.calculoAplicado,
    naoLocalizados: diag.naoLocalizados
  });

  return diag;
}

  function adaptarBase01NovaLocal(rows){
  return (rows || []).map(row => {
    const nbs = getCol(row, ["Vendedor", "VENDEDOR"]);
    const vend = lookupNbsLocal(nbs);

    const tipo = normalizeText(getCol(row, ["Novo", "Novo/Usado", "NOVO", "N/U"]));
    const isUsado = tipo === "U" || tipo.includes("USADO") || tipo.includes("SEMI");

    const vendedorNome = vend ? vend.nome : normalizeText(nbs);
    const loja = vend ? vend.loja : normalizeText(getCol(row, ["Empresa Vendedora", "Loja", "Unidade", "Inst - Ponto de Venda"]));

    return {
      ...row,
      "Transação": isUsado ? "U21" : "V21",
      "Transacao": isUsado ? "U21" : "V21",
      "N/U": isUsado ? "U" : "N",
      "Novo/Usado": isUsado ? "U" : "N",
      "Nome Vendedor": vendedorNome,
      "Vendedor": vendedorNome,
      "NOME_VENDEDOR": vendedorNome,
      "Loja": loja,
      "Chassi": getCol(row, ["Chassi", "Chassi Completo", "Chassi Resumido"]),
      "CHASSI": getCol(row, ["Chassi", "Chassi Completo", "Chassi Resumido"]),
      "Modelo": getCol(row, ["Modelo", "Desc. Modelo", "Descrição Modelo", "Descricao Modelo", "Desc Modelo"]),
      "DES_MODELO": getCol(row, ["Modelo", "Desc. Modelo", "Descrição Modelo", "Descricao Modelo", "Desc Modelo"]),
      "Valor Venda": getCol(row, ["Valor Venda", "Valor NF", "Valor Vendido - DI", "VALOR_VENDA"]),
      "VALOR_VENDA": getCol(row, ["Valor Venda", "Valor NF", "Valor Vendido - DI", "VALOR_VENDA"]),
      "Nome Cliente": getCol(row, ["Nome Cliente", "Cliente", "Nome Proprietário", "Nome Proprietario"]),
      "Cliente": getCol(row, ["Nome Cliente", "Cliente", "Nome Proprietário", "Nome Proprietario"]),
      "Data Venda": getCol(row, ["Data venda", "Data Venda", "DATA VENDA", "Dt.Venda", "Dt Venda", "Data Emissão Nota", "Data Emissao Nota", "Data Emissão NF. Entrada", "Data Emissao NF. Entrada", "Data Nota", "Data"])
    };
  });
}

  function adaptarBase02NovaLocal(rows){
  return filtrarDescricaoFinanciamentoBase02Nova(rows).map(row => {
    const nbs = getCol(row, ["Nome", "Vendedor", "VENDEDOR"]);
    const vend = lookupNbsLocal(nbs);

    const tipo = normalizeText(getCol(row, ["Novo/Usado", "NOVO", "N/U"]));
    const isUsado = tipo === "U" || tipo.includes("USADO") || tipo.includes("SEMI");

    const vendedorNome = vend ? vend.nome : normalizeText(nbs);
    const loja = vend ? vend.loja : normalizeText(getCol(row, ["Empresa Vendedora", "Loja", "Unidade", "Inst - Ponto de Venda"]));

    return {
      ...row,
      "FINANCIADO": 1,
      "Financiado": 1,
      "DESCRICAO": getCol(row, ["Descrição Serviço", "Descricao Serviço", "Descrição Servico", "DESCRICAO SERVICO", "DESCRIÇÃO SERVIÇO"]),
      "VALOR_FINANCIADO": getCol(row, ["Valor Serviço", "Valor Servico", "VALOR SERVICO", "VALOR SERVIÇO"]),
      "Valor Financiado": getCol(row, ["Valor Serviço", "Valor Servico", "VALOR SERVICO", "VALOR SERVIÇO"]),
      "PRODUCAO": getCol(row, ["Valor Serviço", "Valor Servico", "VALOR SERVICO", "VALOR SERVIÇO"]),
      "Produção": getCol(row, ["Valor Serviço", "Valor Servico", "VALOR SERVICO", "VALOR SERVIÇO"]),
      "RECEITA": getCol(row, ["Retorno Bruto", "RETORNO BRUTO"]),
      "Retorno": getCol(row, ["Retorno Bruto", "RETORNO BRUTO"]),
      "VALOR_LIQUIDO": getCol(row, ["Retorno Bruto", "RETORNO BRUTO"]),
      "COD_TIPO_VENDA": isUsado ? "U" : "N",
      "Novo/Usado": isUsado ? "U" : "N",
      "Nome Vendedor": vendedorNome,
      "Vendedor": vendedorNome,
      "NOME_VENDEDOR": vendedorNome,
      "Loja": loja,
      "CLIENTE": getCol(row, ["Cliente", "Nome Cliente"]),
      "Cliente": getCol(row, ["Cliente", "Nome Cliente"]),
      "DES_MODELO": getCol(row, ["Desc. Modelo", "Modelo"]),
      "Modelo": getCol(row, ["Desc. Modelo", "Modelo"]),
      "Chassi": getCol(row, ["Chassi Resumido", "Chassi Completo", "Chassi"]),
      "Data Venda": getCol(row, ["Data Venda", "DATA VENDA", "Dt Venda", "Dt.Venda", "Data Emissão Nota", "Data Emissao Nota", "Dta Pgto Contrato", "Data Serviço", "Data Servico", "Data Proposta", "Data"])
    };
  });
}

  function enriquecerEntradaBase02Adaptada(rows, indiceVendasPorChassi){
  return (rows || []).map(row=>{
    const chassi = normalizeText(getCol(row,["Chassi Resumido","Chassi","CHASSI","Chassi Completo"]));
    const refVenda = chassi && indiceVendasPorChassi ? indiceVendasPorChassi[chassi] : null;
    const valorVenda = refVenda ? brabusValorVendaBase01Nova(refVenda) : 0;
    const valorFinanciado = brabusValorFinanciadoBase02Nova(row);
    const entrada = valorVenda > 0 && valorFinanciado > 0 ? Math.max(0, valorVenda-valorFinanciado) : 0;
    return {
      ...row,
      "VALOR_VENDA_NOVO": valorVenda,
      "VALOR_FINANCIADO_NOVO": valorFinanciado,
      "ENTRADA_NOVO": entrada,
      "PERCENTUAL_ENTRADA_NOVO": valorVenda > 0 ? entrada/valorVenda : 0
    };
  });
}

  function filtrarDescricaoFinanciamentoBase02Nova(rows){
  return (rows || []).filter(row => {
    const desc = normalizeText(getCol(row, [
      "Descrição Serviço",
      "Descricao Serviço",
      "Descrição Servico",
      "DESCRICAO SERVICO",
      "DESCRIÇÃO SERVIÇO",
      "Descrição",
      "DESCRICAO"
    ]));

    return desc.includes("POR PLANO-FINANCIAMENTO") || desc.includes("POR PLANO FINANCIAMENTO");
  });
}

  function toDateOnly(d){
  if(!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

  function extractDateValue(row){
  const aliases = [
    "Data Venda","DATA_VENDA","Data","Data Faturamento","Dt Venda",
    "Op - Data Contrato","Op - Data Inclusão","Data Contrato","Data Inclusao"
  ];
  const val = getCol(row, aliases);
  if(!val) return null;

  if(val instanceof Date && !isNaN(val.getTime())) return val;

  const s = String(val).trim();
  if(!s) return null;

  // dd/mm/yyyy ou dd/mm/yyyy hh:mm
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(br){
    const d = new Date(Number(br[3]), Number(br[2])-1, Number(br[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

  function dataLinhaManualLocal(row){
  return toDateOnly(extractDateValue(row));
}

  function parseDateNovaBaseBrabus(value){
  if(value === null || value === undefined || value === "") return null;

  if(value instanceof Date && !isNaN(value)){
    return toDateOnly(value);
  }

  if(typeof value === "number"){
    // Serial date do Excel
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + value * 86400000);
    if(!isNaN(dt)) return toDateOnly(dt);
  }

  const s = String(value).trim();
  if(!s) return null;

  // dd/mm/yyyy ou dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+.*)?$/);
  if(m){
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if(y < 100) y += 2000;
    const dt = new Date(y, mo - 1, d);
    if(!isNaN(dt)) return toDateOnly(dt);
  }

  // yyyy-mm-dd ou yyyy/mm/dd
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+.*)?$/);
  if(m){
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if(!isNaN(dt)) return toDateOnly(dt);
  }

  const parsed = new Date(s);
  if(!isNaN(parsed)) return toDateOnly(parsed);

  return null;
}

  function getDataNovaBase01(row){
  return parseDateNovaBaseBrabus(getCol(row, [
    "Data venda",
    "Data Venda",
    "DATA VENDA",
    "Dt.Venda",
    "Dt Venda",
    "Data Emissão Nota",
    "Data Emissao Nota",
    "Data Emissão NF. Entrada",
    "Data Emissao NF. Entrada",
    "Data Nota",
    "Data"
  ]));
}

  function getDataNovaBase02(row){
  // V01.01.27: Data oficial da Base 02 = Data Venda; Data Emissão Nota fica apenas como fallback.
  return parseDateNovaBaseBrabus(getCol(row, [
    "Data Venda",
    "DATA VENDA",
    "Data Emissão Nota",
    "Data Emissao Nota",
    "Dta Pgto Contrato",
    "Data Serviço",
    "Data Servico",
    "Data Proposta",
    "Data",
    "Dt Venda"
  ]));
}

  function filtrarHistoricoManualLocal(rows){
  const limite = toDateOnly(new Date("2026-05-31T00:00:00"));
  return (rows || []).filter(row => {
    const d = dataLinhaManualLocal(row);
    return d && d <= limite;
  });
}

  function filtrarNovoManualLocalBase01Adaptada(rows){
  const corte = toDateOnly(new Date("2026-06-01T00:00:00"));
  return (rows || []).filter(row => {
    const d = getDataNovaBase01(row) || dataLinhaManualLocal(row);
    return d && d >= corte;
  });
}

  function filtrarNovoManualLocalBase02Adaptada(rows){
  const corte = toDateOnly(new Date("2026-06-01T00:00:00"));
  return (rows || []).filter(row => {
    const d = getDataNovaBase02(row) || dataLinhaManualLocal(row);
    return d && d >= corte;
  });
}

  function getPeriodFromRows(rows){
  const dates = (rows || []).map(r => extractDateValue(r)).filter(Boolean);
  if(!dates.length) return null;
  const min = new Date(Math.min(...dates.map(d=>d.getTime())));
  const max = new Date(Math.max(...dates.map(d=>d.getTime())));
  return {min, max};
}

  function isClosedMonthPeriod(period){
  if(!period) return false;
  const a = period.min;
  const b = period.max;
  if(a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth()) return false;
  if(a.getDate() !== 1) return false;
  const lastDay = new Date(a.getFullYear(), a.getMonth()+1, 0).getDate();
  return b.getDate() === lastDay;
}

  // FC-1 (GAP-001): byte-identical extraction, origin/main:modules/analise-
  // geral-grupo-secure-original-layout.html lines 3112-3125 -- day-aligned
  // previous-comparable-period math (NOT naive "previous calendar month").
  function lastDayOfMonth(y,m){ return new Date(y, m + 1, 0).getDate(); }
  function sameDayPreviousMonth(d){
  if(!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth() - 1;
  const targetY = m < 0 ? y - 1 : y;
  const targetM = (m + 12) % 12;
  // Mirror de origin/main 97d84bd (fix(analise-geral-grupo): calendar-correct previous-month comparison):
  // se a data é o ÚLTIMO dia do próprio mês (ex.: 30/09), o comparável é o último dia do mês anterior
  // (31/08), e não o dia 30. Dias intermediários continuam com o mesmo número de dia (limitado ao mês).
  const isLastDayOfOwnMonth =
    d.getDate() === lastDayOfMonth(y, d.getMonth());

  const day = isLastDayOfOwnMonth
    ? lastDayOfMonth(targetY, targetM)
    : Math.min(
        d.getDate(),
        lastDayOfMonth(targetY, targetM)
      );
  return new Date(targetY, targetM, day);
}
  function getPreviousMonthComparablePeriod(start, end){
  if(!start || !end) return {start:null,end:null};
  return { start:sameDayPreviousMonth(start), end:sameDayPreviousMonth(end) };
}

  function kpiMetricsFor(results, deptView){
  const salesView = deptView === "Grupo" ? (results.sales||[]) : (results.sales||[]).filter(x=>x.dept===deptView);
  const finsView = deptView === "Grupo" ? (results.fins||[]) : (results.fins||[]).filter(x=>x.dept===deptView);
  const vendas = salesView.length, fins = finsView.length;
  const receita = finsView.reduce((s,x)=>s+(x.receita||0),0);
  const receitaSPF = getReceitaSPF(finsView);
  const receitaTotal = receita + receitaSPF;
  const producao = finsView.reduce((s,x)=>s+(x.producao||0),0);
  const share = vendas ? fins/vendas : 0;
  const retorno = producao ? receitaTotal/producao : 0;
  return {vendas,fins,share,receita,receitaSPF,receitaTotal,producao,retorno};
}

  function getReceitaSPF(registros){
  return (registros || []).reduce((s,r)=>s + (Number(r.receitaSPF || 0)), 0);
}

  function getReceitaTotal(registros){
  return (registros || []).reduce((s,r)=>s + (Number(r.receita || 0)) + (Number(r.receitaSPF || 0)), 0);
}

  // FC-1 (GAP-001): byte-identical extraction, origin/main:modules/analise-
  // geral-grupo-secure-original-layout.html lines 3151-3155.
  function calcDelta(currentValue, previousValue){
  const c = Number(currentValue || 0), p = Number(previousValue || 0);
  if(!p) return null;
  return (c - p) / p;
}
  // ==== END byte-identical extraction ====

  // module-level mutable state (external to the pure functions above,
  // same role as production's own top-level `let`s)
  var VENDOR_MAP = {};
  var NBS_VENDOR_LOOKUP_LOCAL = {};
  var BRABUS_MUDANCAS_LOJA_VENDEDORES = []; // never populated -- see header note
  var base03PlanDiagnostics = { hasTC: false, hasIF: false };
  var diagnosticoEntradaNova = { totalFinanciamentos: 0, chassisLocalizados: 0, chassisNaoLocalizados: 0, taxaSucesso: 0, naoLocalizados: [], calculoAplicado: false };
  var currentPeriodFilter = { start: null, end: null, mode: 'all' };

  window.NX_DASHBI_ADAPTER = {
    id: 'dashbi',
    groundTruthRef: 'origin/main:modules/analise-geral-grupo-secure-original-layout.html (portal-financiamento-brabus-secure) == live production (PORTAL-NEXT-07, byte-hash confirmed); see docs/DASHBI-FUNCTION-MAP.md',

    setVendors: function (vendorRows) {
      montarMapaVendedoresLocal(vendorRows || []);
      return { VENDOR_MAP: VENDOR_MAP, NBS_VENDOR_LOOKUP_LOCAL: NBS_VENDOR_LOOKUP_LOCAL };
    },

    processBase01: processBase01,
    processBase02: processBase02,
    buildB03Index: buildB03Index,
    aggregate: aggregate,
    // FC-2 (GAP-004): exposed so dashbi.js's export can build the exact
    // same rows the on-screen tables already build from -- no separate
    // export-only data path.
    rowsFromAgg: rowsFromAgg,
    modelRowsUnified: modelRowsUnified,
    planRowsByModel: planRowsByModel,
    planRowsByStoreForFamily: planRowsByStoreForFamily,
    planTotalRowsForFamily: planTotalRowsForFamily,
    specialPlanDetailRows: specialPlanDetailRows,
    inconsistenciaTritonRows: inconsistenciaTritonRows,
    modelExtraMetrics: modelExtraMetrics,
    familyExtraMetrics: familyExtraMetrics,
    getPlanoDestaque: getPlanoDestaque,
    planoCounts: planoCounts,
    planoKeyOperacao: planoKeyOperacao,
    resolveLoja: resolveLoja,
    modeloPadrao: modeloPadrao,
    familyOfModel: familyOfModel,
    money: money,
    pct: pct,
    num: num,
    getPeriodFromRows: getPeriodFromRows,
    isClosedMonthPeriod: isClosedMonthPeriod,
    kpiMetricsFor: kpiMetricsFor,
    getReceitaSPF: getReceitaSPF,
    getReceitaTotal: getReceitaTotal,
    // FC-1 (GAP-001): dual-period comparison primitives (byte-identical
    // extraction, see docs/DASHBI-FUNCTION-MAP.md's FC-1 correction).
    getPreviousMonthComparablePeriod: getPreviousMonthComparablePeriod,
    sameDayPreviousMonth: sameDayPreviousMonth,
    calcDelta: calcDelta,
    rankingFromViews: rankingFromViews,
    buildNovosLojaRows: buildNovosLojaRows,
    adaptarBase01NovaLocal: adaptarBase01NovaLocal,
    adaptarBase02NovaLocal: adaptarBase02NovaLocal,
    enriquecerEntradaBase02Adaptada: enriquecerEntradaBase02Adaptada,
    brabusDiagnosticarEntradaNova: brabusDiagnosticarEntradaNova,
    criarIndiceVendasNovasPorChassi: criarIndiceVendasNovasPorChassi,
    filtrarHistoricoManualLocal: filtrarHistoricoManualLocal,
    filtrarNovoManualLocalBase01Adaptada: filtrarNovoManualLocalBase01Adaptada,
    filtrarNovoManualLocalBase02Adaptada: filtrarNovoManualLocalBase02Adaptada,

    // compute(): mirrors processarDashboardTesteManualLocal() (origin/main
    // lines 5897-5986) EXACTLY, MINUS the one line that awaits a live
    // Supabase fetch (carregarMudancasLojaVendedoresDashboard) -- see
    // header note. Historical rows (<=2026-05-31) and Nova rows
    // (>=2026-06-01, adapted+enriched) are concatenated exactly as
    // production does, then run through the SAME processBase01/
    // processBase02/buildB03Index/aggregate pipeline.
    compute: function (fixture) {
      montarMapaVendedoresLocal(fixture.vendorRows || []);

      var b1Hist = filtrarHistoricoManualLocal(fixture.b1HistRows || []);
      var b2Hist = filtrarHistoricoManualLocal(fixture.b2HistRows || []);

      var b1NovaAdaptadaRaw = adaptarBase01NovaLocal(fixture.b1NovaRows || []);
      var b1Nova = filtrarNovoManualLocalBase01Adaptada(b1NovaAdaptadaRaw);
      var b2NovaAdaptadaRaw = adaptarBase02NovaLocal(fixture.b2NovaRows || []);
      var indiceVendasNovas = criarIndiceVendasNovasPorChassi(b1Nova);
      var diagnostic = brabusDiagnosticarEntradaNova(fixture.b2NovaRows || [], indiceVendasNovas);
      var b2NovaComEntrada = enriquecerEntradaBase02Adaptada(b2NovaAdaptadaRaw, indiceVendasNovas);
      var b2Nova = filtrarNovoManualLocalBase02Adaptada(b2NovaComEntrada);

      var b1raw = b1Hist.concat(b1Nova);
      var b2raw = b2Hist.concat(b2Nova);

      var b1 = b1raw.filter(function (row) { return !rowContainsExcludedName(row) && !isRevendaRecord(row); });
      var b2 = b2raw.filter(function (row) { return !rowContainsExcludedName(row) && !isRevendaRecord(row); });

      var p1 = processBase01(b1);
      var b03idx = buildB03Index(fixture.b3Rows || []);
      var p2 = processBase02(b2, b03idx);

      var missingSellers = Array.from(new Set(
        p1.valid.filter(function (x) { return x.loja === 'NÃO LOCALIZADO'; }).map(function (x) { return x.vendedor; })
          .concat(p2.valid.filter(function (x) { return x.loja === 'NÃO LOCALIZADO'; }).map(function (x) { return x.vendedor; }))
      )).filter(Boolean).filter(function (x) { return !hashListHas(EXCLUDED_SELLERS, EXCLUDED_CACHE, x); }).sort(function (a, b) { return a.localeCompare(b); });

      var results = {
        sales: p1.valid,
        excluded: p1.excluded,
        fins: p2.valid,
        semMatch: p2.semMatch,
        b03SampleRow: (fixture.b3Rows && fixture.b3Rows.length ? fixture.b3Rows[0] : null),
        sourceInfo: {
          b1Historica: b1Hist.length, b2Historica: b2Hist.length,
          b1Nova: b1Nova.length, b2Nova: b2Nova.length,
          b3: (fixture.b3Rows || []).length,
          vendedores: (fixture.vendorRows || []).length,
          corte: '2026-06-01', modo: 'teste local manual'
        },
        missingSellers: missingSellers,
        entradaDiagnostic: diagnostic,
        aggs: null
      };
      if (missingSellers.length) {
        results.blocked = true;
        return results;
      }
      results.aggs = aggregate(results);
      return results;
    },

    _internal: {
      ALLOWED_SALES: ALLOWED_SALES, EXCLUDE_TX: EXCLUDE_TX, DEV_TX: DEV_TX,
      EXCLUDED_SELLERS: EXCLUDED_SELLERS, STORE_CODE_MAP: STORE_CODE_MAP, FAMILY_MODELS: FAMILY_MODELS,
      getVendorMap: function () { return VENDOR_MAP; }
    }
  };

  if (window.NX_BUSINESS_ADAPTERS) {
    window.NX_BUSINESS_ADAPTERS.registry.dashbi = window.NX_DASHBI_ADAPTER;
  }
})();
