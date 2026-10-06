/* PORTAL-NEXT V2 -- Coparticipado Adapter (Gate 5: PURE EXTRACTION,
   programmatic, not hand-retyped -- see docs/COPARTICIPADO-ENGINE-AUDIT.md
   and docs/COPARTICIPADO-EXTRACTION-TRACE.md).
   SOURCE: git show origin/main:modules/coparticipado.html
   (portal-financiamento-brabus-secure) -- NOT the local clone, PROVED
   divergent for this file. Confirmed origin/main == live production.

   Every function below (34 total) + the 2 constants (EXCLUDED_SELLERS,
   MODELO_ALIAS_ERP) is copied BYTE-IDENTICAL from that source -- see
   the extraction script referenced in REPORT.md's PORTAL-NEXT-05 entry.
   Do not "clean up", rename, reformat, or otherwise touch these lines
   -- any future change must come from a NEW extraction off a NEW
   production source (Gate 59: No Cleanup Drift).

   The ONE substitution: a local DATA shim object replaces the module-
   level DATA global these functions read/write (DATA.vendors,
   DATA.taxasCopart, DATA.b3). Fixtures populate DATA.vendors (via the
   also-extracted, real buildVendors()) and DATA.taxasCopart directly
   -- no backend call, no raw Excel parsing (deferred, see the audit
   doc's "Deferred" section). DATA.b3 is a harmless side-effect target
   inside buildB3Index() (used for a diagnostics view in production) --
   absorbed here, not otherwise used. */
(function () {
  'use strict';

  var DATA = { vendors: { byNbs: {}, byName: {}, allByName: {} }, taxasCopart: {}, b3: null };

  // ==== BEGIN byte-identical extraction from origin/main:modules/coparticipado.html ====
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
  const EXCLUDED_SELLERS=hashListIndex([
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
  const MODELO_ALIAS_ERP={
    'ECLIPSE CROSS BLACK 1.5T 4X4 C':'ECLIPSE CROSS HPE-S S-AWC BLACK',
    'ECLIPSE CROSS HPE-S 1.5T 4X4 C':'ECLIPSE CROSS HPE-S S-AWC'
  };

  function normalizeText(v){return (v??'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/�/g,'A').replace(/\s+/g,' ').trim()}
  function asNumber(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return isFinite(v)?v:0;let s=String(v).trim().replace(/[R$\s]/g,'');if(!s)return 0;if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');const n=parseFloat(s);return isNaN(n)?0:n}
  function asRate(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return isFinite(v)?(v>1?v/100:v):0;let raw=String(v).trim();const hasPct=raw.includes('%');let n=asNumber(raw.replace('%',''));if(!isFinite(n))return 0;return hasPct||n>1?n/100:n}
  function taxaKey(modelo){return normalizeText(modelo).replace(/[^A-Z0-9]+/g,' ').replace(/\b(MMC|MITSUBISHI|MOTORS|AUT|AUTO|CVT|AT|DIESEL|GASOLINA|FLEX|4X4|4X2|AWD)\b/g,' ').replace(/\s+/g,' ').trim()}
  function getCol(row,names){const keys=Object.keys(row||{});for(const n of names){const nn=normalizeText(n);const k=keys.find(x=>normalizeText(x)===nn);if(k!==undefined)return row[k]}for(const n of names){const nn=normalizeText(n);const k=keys.find(x=>normalizeText(x).includes(nn));if(k!==undefined)return row[k]}return ''}
  function getTC(row){const v=getCol(row,['Tabela - TC Devolvida (R$)','Tabela - TC Devolvida','TC Devolvida']);if(v!==''&&v!==undefined&&v!==null)return v;return row.__COL_E||''}
  function getIF(row){const v=getCol(row,['Tabela - Código IF','Tabela - Codigo IF','Código IF','Codigo IF']);if(v!==''&&v!==undefined&&v!==null)return v;return row.__COL_F||''}
  function planText(v){return normalizeText(v).replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim()}
  function getSituacaoB3(row){return normalizeText(getCol(row,['Op - Situação','Op - Situacao','Situação','Situacao','Op Situação','Op Situacao']))}
  function isTCcoparticipado(row){const tc=getTC(row),tcN=asNumber(tc);return planText(tc).includes('COPARTICIPADO')||tcN===1}
  function isSituacaoCoparticipadoValida(row){const s=getSituacaoB3(row);return s==='PAGA'||s==='FATURADA'}
  function isCoparticipadoValido(row){return !!row&&isTCcoparticipado(row)&&isSituacaoCoparticipadoValida(row)}
  function scoreB3(r){if(!r)return -1;const cod=getIF(r),ifN=asNumber(cod),ifT=planText(cod),balao=asNumber(getCol(r,['Op Fin - Balão PMT (R$)','Balão PMT','Balao PMT']));if(ifT.includes('SUBSIDIADO')||ifN===999)return 100;if(ifT.includes('REVERSAO')||ifN===777)return 95;if(isCoparticipadoValido(r))return 90;if(balao>0)return 80;if(isTCcoparticipado(r))return 5;return (asNumber(getCol(r,['Op Fin - PMT (R$)']))>0?20:0)+(asNumber(getCol(r,['Op Fin - Quantidade Parcelas']))>0?10:0)}
  function situacaoScoreB3(row){const s=getSituacaoB3(row);if(s==='PAGA'||s==='FATURADA')return 100;if(s==='ASSINADO')return 70;if(s==='ENCERRADA')return 20;if(s.includes('CANCEL'))return -40;if(s.includes('RECUS'))return -60;return 0}
  function closenessScoreB3(row,targetValor){const v=valorFinB3(row);if(!targetValor||!v)return 0;const diff=Math.abs(v-targetValor);if(diff<1)return 80;const rel=diff/Math.max(targetValor,v,1);if(rel<=0.005)return 60;if(rel<=0.02)return 35;if(rel<=0.05)return 15;return -25}
  function chooseB3(cands,targetValor=0){const arr=[...new Set((cands||[]).filter(Boolean))];return arr.sort((a,b)=>{
  const sa=scoreB3(a)+situacaoScoreB3(a)+closenessScoreB3(a,targetValor);
  const sb=scoreB3(b)+situacaoScoreB3(b)+closenessScoreB3(b,targetValor);
  if(sb!==sa)return sb-sa;
  const da=parseDate(getCol(a,['Op - Data Contrato','Op - Data Inclusão','Op - Data Inclusao']));
  const db=parseDate(getCol(b,['Op - Data Contrato','Op - Data Inclusão','Op - Data Inclusao']));
  return (db?db.getTime():0)-(da?da.getTime():0);
})[0]||null}
  function matchB3(row,b3idx,targetValor=0,extra={}){const cliente=getCol(row,['Cliente','Nome Cliente','Cli - Nome','Nome Cliente Destino']);const nomes=[cliente,extra.cliente||''].map(normalizeText).filter(Boolean);const cleans=nomes.map(normalizeClient).filter(Boolean);const cpfs=[onlyDigits(getCol(row,['CPF','CPF/CNPJ','Cód. Cliente','Cod Cliente'])),onlyDigits(extra.documento||'')].filter(Boolean);const cands=[];cpfs.forEach(cpf=>cands.push(...(b3idx.byCpf[cpf]||[])));nomes.forEach(nome=>cands.push(...(b3idx.byName[nome]||[])));cleans.forEach(clean=>cands.push(...(b3idx.byClean[clean]||[])));return chooseB3(cands,targetValor)}
  function rowHasExcluded(row){const joined=Object.values(row||{}).map(normalizeText).join(' | ');return hashListInText(EXCLUDED_SELLERS,joined)}
  function classifyPlan(b3row){if(!b3row)return 'LINEAR';const cod=getIF(b3row),ifN=asNumber(cod),ifT=planText(cod),balao=asNumber(getCol(b3row,['Op Fin - Balão PMT (R$)','Balão PMT','Balao PMT']));if(ifT.includes('SUBSIDIADO')||ifN===999)return 'SUBSIDIADO';if(ifT.includes('REVERSAO')||ifN===777)return 'REVERSÃO';if(isCoparticipadoValido(b3row))return 'COPARTICIPADO';if(balao>0)return 'BALÃO';return 'LINEAR'}
  function vendorFromRow(row){const nbs=normalizeText(getCol(row,['Vendedor','VENDEDOR','Apelido','NBS']));const nomeRaw=getCol(row,['Nome Vendedor Completo','Nome completo vendedor','Nome Vendedor','Nome','Vendedor']);const nome=normalizeText(nomeRaw);const byN=DATA.vendors.byNbs[nbs];const byName=DATA.vendors.byName[nome];return byN||byName||{nbs,nome:nome||nbs,loja:'NÃO LOCALIZADO',tipo:'',status:''}}
  function deptFin(row,vendor){const nu=normalizeText(getCol(row,['Novo/Usado','Tipo Veículo','Tipo Veiculo','Novo','N/U']));if(nu==='U'||nu.includes('USADO')||nu.includes('SEMI'))return 'Seminovos';if(nu==='N'||nu.includes('NOVO'))return 'Novos';if((vendor.status||'').includes('SEMI'))return 'Seminovos';return 'Novos'}
  function deptVenda(row,vendor){const nu=normalizeText(getCol(row,['Novo','Novo/Usado','N/U','Tipo']));if(nu==='U'||nu.includes('USADO')||nu.includes('SEMI'))return 'Seminovos';if(nu==='N'||nu.includes('NOVO'))return 'Novos';if((vendor.status||'').includes('SEMI'))return 'Seminovos';return 'Novos'}
  function familiaModelo(modelo){const m=normalizeText(modelo);if(m.includes('OUTLANDER'))return 'Outlander';if(m.includes('TRITON')||m.includes('L200'))return 'Triton';if(m.includes('ECLIPSE'))return 'Eclipse Cross';return 'Outros'}
  // WAVE-C4B: adicionado bare "AWC" (sem hifen) ao ramo 4X4 -- rota real
  // confirmada em dados vivos (Wave C.4A), antes caia no default 4X2.
  // Checado contra `original` (pre-limpeza), nao `s`: a regex de limpeza
  // (termo generico C\b) come o "C" final de AWC/S-AWC/SAWC, reduzindo-os
  // a AW/S-AW/SAW -- por isso nenhum dos tres batia contra `s` (bug
  // pre-existente mais profundo que o omission original relatado em
  // C.4A). Mirror byte-identical do fix em modules/coparticipado.html
  // (portal-financiamento-brabus-secure-orch1); nao muda a chave de
  // busca de taxa (taxaKey() ja descarta 4X4/4X2 igualmente -- ver
  // Wave C.4B Secao 10 do relatorio final).
  function modeloPadrao(raw){let original=normalizeText(raw);if(!original)return 'NÃO INFORMADO';if((original.includes('TRITON')||original.includes('L200'))&&original.includes('TERRA'))return 'TRITON TERRA';if((original.includes('TRITON')||original.includes('L200'))&&original.includes('TARMAC'))return 'TRITON TARMAC';if(original.includes('ECLIPSE CROSS')&&original.includes('TARMAC'))return 'ECLIPSE CROSS TARMAC';let s=original;s=s.replace(/MITSUBISHI|MMC|AUT|AUTOMATICO|AUTOMATICA|AT\b|CVT\b|DIESEL|FLEX|TOTAL FLEX|TURBO|1\.5T|1\.5|2\.4|4P|C\b/g,' ');s=s.replace(/\s+/g,' ').trim();if(s.includes('ECLIPSE CROSS')){if(s.includes('RUSH'))return 'ECLIPSE CROSS RUSH';if(s.includes('TARMAC'))return 'ECLIPSE CROSS TARMAC';if(s.includes('BLACK'))return 'ECLIPSE CROSS HPE-S BLACK';if(s.includes('HPE-S')||s.includes('HPE S')){if(original.includes('4X4')||original.includes('S-AWC')||original.includes('SAWC')||original.includes('AWD')||original.includes('AWC'))return 'ECLIPSE CROSS HPE-S 4X4';return 'ECLIPSE CROSS HPE-S 4X2'}if(s.includes('HPE'))return 'ECLIPSE CROSS HPE';return 'ECLIPSE CROSS'}if(s.includes('TRITON')||s.includes('L200')){if(s.includes('KATANA'))return 'TRITON KATANA';if(s.includes('SAVANA'))return 'TRITON SAVANA';if(s.includes('TARMAC'))return 'TRITON TARMAC';if(s.includes('BF MS'))return 'TRITON BF MS';if(s.includes('HPE-S')||s.includes('HPE S'))return 'TRITON HPE-S';if(s.includes('HPE'))return 'TRITON HPE';if(s.includes('GLS'))return 'TRITON GLS';if(s.includes('GL'))return 'TRITON GL';return 'INCONSISTÊNCIA TRITON'}if(s.includes('OUTLANDER')){if(s.includes('SIGNATURE'))return 'OUTLANDER SIGNATURE';if(s.includes('HPE-S')||s.includes('HPE S'))return 'OUTLANDER HPE-S';return 'OUTLANDER'}return original}
  function parseDate(v){if(!v)return null;if(v instanceof Date&&!isNaN(v))return v;if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30));d.setUTCDate(d.getUTCDate()+Math.floor(v));return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())}const s=String(v).trim();let m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);if(m){let y=+m[3];if(y<100)y+=2000;return new Date(y,+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0))}m=s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);if(m)return new Date(+m[1],+m[2]-1,+m[3]);const d=new Date(s);return isNaN(d)?null:d}
  function valorFinB3(row){return asNumber(getCol(row,['Op Fin - Financiado (R$)','Financiado','Valor Financiado']))}
  function normalizeClient(v){let s=normalizeText(v);return s.replace(/\b(LTDA|EIRELI|ME|EPP|S A|SA)\b/g,'').replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim()}
  function onlyDigits(v){if(v===null||v===undefined)return '';let s=String(v).trim();if(/[eE]\+/.test(s)){const n=Number(s);if(Number.isFinite(n))s=Math.trunc(n).toString()}return s.replace(/\.0+$/,'').replace(/\D/g,'')}
  function processFins(rows,b3idx,sales){const byProp={};rows.forEach(r=>{if(rowHasExcluded(r))return;const prop=normalizeText(getCol(r,['Cód. Proposta','Cod Proposta','Proposta']));if(!prop)return;const desc=normalizeText(getCol(r,['Descrição Serviço','DESCRICAO','Descrição','Tipo']));const isFin=desc.includes('POR PLANO-FINANCIAMENTO')||desc.includes('LANCAMENTO RETORNO POSTERIOR');const isSpf=desc.includes('SPF EXTRA');if(!isFin&&!isSpf)return;const g=byProp[prop]||(byProp[prop]={finRows:[],spfRows:[]});if(isFin)g.finRows.push(r);if(isSpf)g.spfRows.push(r)});const saleByShort={},saleByFull={};sales.forEach(s=>{if(s.chassiResumido)saleByShort[s.chassiResumido]=s;if(s.chassi)saleByFull[s.chassi]=s});const out=[];for(const [prop,g] of Object.entries(byProp)){const finRows=g.finRows.filter(r=>asNumber(getCol(r,['Valor Serviço','Valor Financiado','VALOR_FINANCIADO','PRODUCAO']))>0||asNumber(getCol(r,['Retorno Bruto','Retorno','RETORNO_PLANO']))>0);if(!finRows.length)continue;let main=finRows.find(r=>normalizeText(getCol(r,['Descrição Serviço','DESCRICAO'])).includes('POR PLANO-FINANCIAMENTO'))||finRows[0];const vendor=vendorFromRow(main);const chassiShort=normalizeText(getCol(main,['Chassi Resumido']));const chassiFull=normalizeText(getCol(main,['Chassi Completo']));const sale=saleByFull[chassiFull]||saleByShort[chassiShort]||null;const valorFin=asNumber(getCol(main,['Valor Serviço','Valor Financiado','VALOR_FINANCIADO','PRODUCAO']));const b3=matchB3(main,b3idx,valorFin,{cliente:sale?.cliente||'',documento:sale?.documento||''});const plano=classifyPlan(b3);const receitaFin=finRows.reduce((s,r)=>s+asNumber(getCol(r,['Retorno Bruto','Retorno  Liquido','Retorno','RETORNO_PLANO'])),0);const receitaSPF=g.spfRows.reduce((s,r)=>s+asNumber(getCol(r,['Valor Serviço','Retorno Bruto','Retorno  Liquido'])),0);const dept=sale?sale.dept:deptFin(main,vendor);const modelo=sale?sale.modelo:modeloPadrao(getCol(main,['Desc. Modelo','Modelo']));const rec={origem:main,proposta:prop,chassi:chassiFull||chassiShort,chassiResumido:chassiShort,data:parseDate(getCol(main,['Data Venda','Data Emissão Nota','Data venda'])),dept,vendedor:(sale&&sale.vendedor)||vendor.nome||normalizeText(getCol(main,['Nome completo vendedor','Vendedor'])),nbs:(sale&&sale.nbs)||vendor.nbs,loja:(sale&&sale.loja)||vendor.loja||'NÃO LOCALIZADO',cliente:normalizeText(getCol(main,['Cliente','Nome Cliente','Nome Cliente Destino'])),modelo,familia:familiaModelo(modelo),valorVenda:sale?sale.valorVenda:0,valorFinanciado:valorFin,retorno:receitaFin,receitaSPF,parcelas:asNumber(getCol(main,['Qtde Parcelas']))||(b3?asNumber(getCol(b3,['Op Fin - Quantidade Parcelas','Quantidade Parcelas','Parcelas'])):0),pmt:b3?asNumber(getCol(b3,['Op Fin - PMT (R$)','PMT','Valor Parcela'])):0,balaoValor:(plano==='BALÃO'&&b3)?asNumber(getCol(b3,['Op Fin - Balão PMT (R$)','Balão PMT','Balao PMT'])):0,balaoValorOriginal:b3?asNumber(getCol(b3,['Op Fin - Balão PMT (R$)','Balão PMT','Balao PMT'])):0,plano,situacaoB3:b3?getSituacaoB3(b3):'',matchedB3:!!b3,spfQtd:g.spfRows.length};out.push(rec)}return out}
  function processSales(rows){const byChassi={};rows.forEach((r,i)=>{if(rowHasExcluded(r))return;const vt=normalizeText(getCol(r,['Veic. Tipo','Tipo Veículo','Tipo Veiculo']));if(vt.includes('REVENDA'))return;const vendor=vendorFromRow(r);const chassi=normalizeText(getCol(r,['Chassi Completo','Chassi','Chassi Resumido']));if(!chassi)return;const data=parseDate(getCol(r,['Data venda','Dt.Venda','Data Venda','Data Faturamento']));const dept=deptVenda(r,vendor);const rec={origem:r,chassi,chassiResumido:normalizeText(getCol(r,['Chassi','Chassi Resumido'])),data,dept,vendedor:vendor.nome||normalizeText(getCol(r,['Nome Vendedor Completo','Vendedor'])),nbs:vendor.nbs,loja:vendor.loja||'NÃO LOCALIZADO',status:vendor.status,cliente:normalizeText(getCol(r,['Nome Cliente','Nome Proprietário','Nome Proprietario'])),documento:onlyDigits(getCol(r,['Cód. Cliente','Cod. Cliente','CPF/CNPJ','CNPJ','CPF'])),modelo:modeloPadrao(getCol(r,['Modelo','Descrição Modelo','Desc. Modelo'])),familia:familiaModelo(getCol(r,['Modelo','Descrição Modelo','Desc. Modelo'])),valorVenda:asNumber(getCol(r,['Valor Venda','Preço venda','Valor Faturamento']))};const old=byChassi[chassi];if(!old||(data&&old.data&&data>old.data)||(!old.data&&data))byChassi[chassi]=rec});return Object.values(byChassi)}
  function findTaxaCopart(modelo){
  const alias=MODELO_ALIAS_ERP[normalizeText(modelo)];
  const key=taxaKey(alias||modelo);
  if(!key)return null;
  if(DATA.taxasCopart[key])return DATA.taxasCopart[key];
  const entries=Object.entries(DATA.taxasCopart||{});
  let best=null;
  for(const [k,v] of entries){
    if(k===key||k.includes(key)||key.includes(k)){
      const score=Math.min(k.length,key.length)/Math.max(k.length,key.length);
      if(!best||score>best.score)best={score,val:v};
    }
  }
  return best?best.val:null;
}
  function calcCoparticipacaoDetalhe(r){
  const taxa=findTaxaCopart(r.modelo);
  if(!taxa)return {ok:false,msg:'Modelo não encontrado na tabela de taxa',modeloTabela:'',rebateTotal:0,parteBrabus:0,valorRebateTotal:0,coparticipacao:0};
  const valorRebateTotal=(r.valorFinanciado||0)*(taxa.rebateTotal||0);
  const coparticipacao=valorRebateTotal*(taxa.parteBrabus||0);
  return {ok:true,msg:'',modeloTabela:taxa.modeloTabela,rebateTotal:taxa.rebateTotal||0,parteBrabus:taxa.parteBrabus||0,valorRebateTotal,coparticipacao};
}
  function buildVendors(rows){
  const byNbs={},byName={},allByName={};
  (rows||[]).forEach(r=>{
    const tipo=normalizeText(getCol(r,['TIPO','Tipo']));
    const nbs=normalizeText(getCol(r,['NBS','Login NBS','Vendedor']));
    const nome=normalizeText(getCol(r,['Nome','Nome Vendedor','Vendedor']));
    const loja=normalizeText(getCol(r,['Loja','Unidade'])).replace('NACOES','NAÇÕES').replace('ANALIA','ANÁLIA').replace('GASTAO','GASTÃO');
    const status=normalizeText(getCol(r,['STATUS','Status']));
    const cpf=onlyDigits(getCol(r,['CPF']));
    const obj={nbs,nome,loja,tipo,status,cpf};
    // Mantém todos os nomes cadastrados para auditoria.
    // Se for GERENTE/ANALISTA/REVENDA/MASTER, o nome é reconhecido e ignorado no alerta.
    if(nome)allByName[nome]=obj;
    // Para cálculo do Score, somente TIPO = VENDEDOR é cadastro válido.
    if(tipo!=='VENDEDOR')return;
    if(nbs)byNbs[nbs]=obj;
    if(nome)byName[nome]=obj;
  });
  return {byNbs,byName,allByName};
}
  function buildB3Index(rows){const valid=rows.filter(r=>normalizeText(getCol(r,['Op - Modalidade','Modalidade']))==='FANDI');const byName={},byClean={},byCpf={};function push(o,k,r){if(!k)return;(o[k]||(o[k]=[])).push(r)}valid.forEach(r=>{const nome=normalizeText(getCol(r,['Cli - Nome','Cliente','Nome Cliente']));const clean=normalizeClient(nome);const cpf=onlyDigits(getCol(r,['Cli - CPF/CNPJ','CPF','CPF/CNPJ','Documento']));push(byName,nome,r);push(byClean,clean,r);push(byCpf,cpf,r)});DATA.b3=valid;return{byName,byClean,byCpf}}
  // ---- display/filter helpers (Gate 20-27) -- same byte-identical
  // extraction discipline, added alongside the classification engine
  // because the real UI (renderCopa/renderSubsidiados) uses these
  // exact functions for money/percent formatting, date filtering and
  // the plan badge -- inventing new formatting rules is exactly the
  // drift Gate 59 forbids. ----
  function money(v){return (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}
  function num(v,d=0){return (v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})}
  function pct(v){return isFinite(v)?(v*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%':'0,0%'}
  function iso(d){return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:''}
  function dateIn(r,start,end){if(!r.data)return true;const t=new Date(r.data.getFullYear(),r.data.getMonth(),r.data.getDate()).getTime();return (!start||t>=start.getTime())&&(!end||t<=end.getTime())}
  function planBadge(p){const cls={'LINEAR':'planoLinear','BALÃO':'planoBalao','REVERSÃO':'planoReversao','SUBSIDIADO':'planoSubsidiado','COPARTICIPADO':'planoCoparticipado'}[p]||'';return `<span class="planoBadge ${cls}">${p}</span>`}
  // ==== END byte-identical extraction ====

  window.NX_COPARTICIPADO_ADAPTER = {
    id: 'coparticipado',
    groundTruthRef: 'origin/main:modules/coparticipado.html (portal-financiamento-brabus-secure) == live production (PORTAL-NEXT-05, re-verified same method as PORTAL-NEXT-03.1/04); see docs/COPARTICIPADO-ENGINE-AUDIT.md',

    setVendors: function (vendorRows) { DATA.vendors = buildVendors(vendorRows); return DATA.vendors; },
    setTaxasCopart: function (taxasCopart) { DATA.taxasCopart = taxasCopart || {}; },
    processSales: processSales,
    buildB3Index: buildB3Index,
    processFins: processFins,
    calcCoparticipacaoDetalhe: calcCoparticipacaoDetalhe,
    findTaxaCopart: findTaxaCopart,
    // Coparticipado Phase 2 (Real Data Integration Foundation): exposed
    // so coparticipado-real-view-model.js can build DATA.taxasCopart's
    // lookup keys from the real rates[] array the exact same way real
    // V1 production's own score-coparticipated-secure-adapter.js does
    // (taxaKey is a page-global there; here it was private to this
    // module's closure) -- zero behavior change, one more pure
    // function on the existing export list.
    taxaKey: taxaKey,
    // FC-2.3 (GAP-003 export, relocated here from Score): exposed the
    // same way taxaKey was above -- familiaModelo was private to this
    // module's closure; the export's "Família do carro" column needs it
    // on real fins (V1's own real secure adapter, score-coparticipated-
    // secure-adapter.js, already computes familia on finance records
    // too). Zero behavior change, one more pure function on the existing
    // export list.
    familiaModelo: familiaModelo,
    classifyPlan: classifyPlan,
    parseDate: parseDate,
    money: money,
    num: num,
    pct: pct,
    iso: iso,
    dateIn: dateIn,
    planBadge: planBadge,

    compute: function (fixture) {
      DATA.vendors = buildVendors(fixture.vendorRows || []);
      DATA.taxasCopart = fixture.taxasCopart || {};
      var sales = processSales(fixture.b1Rows || []);
      var b3idx = buildB3Index(fixture.b3Rows || []);
      var fins = processFins(fixture.b2Rows || [], b3idx, sales);
      var finsWithRate = fins.map(function (f) {
        if (f.plano === 'COPARTICIPADO') {
          var detalhe = calcCoparticipacaoDetalhe(f);
          return Object.assign({}, f, { coparticipacaoDetalhe: detalhe });
        }
        return f;
      });
      return { sales: sales, fins: finsWithRate };
    },

    _internal: { DATA: DATA, EXCLUDED_SELLERS: EXCLUDED_SELLERS, MODELO_ALIAS_ERP: MODELO_ALIAS_ERP }
  };

  if (window.NX_BUSINESS_ADAPTERS) {
    window.NX_BUSINESS_ADAPTERS.registry.coparticipado = window.NX_COPARTICIPADO_ADAPTER;
  }
})();
