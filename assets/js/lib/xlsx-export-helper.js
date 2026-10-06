/* PORTAL-NEXT V2 -- shared XLSX export helper (FC-2, GAP-003/GAP-004).

   Generic workbook/formatting mechanics ONLY (Gate 15, this Wave's brief:
   "keep business dataset construction module-specific... do not create an
   oversized generic export framework"). Score's and Dash BI's own export
   functions build their own headers/rows/column-type sets and call these
   shared pieces -- no coparticipação/plan/aggregate logic lives here.

   applyProfessionalExcelFormat/excelDateValue/excelFileStamp are adapted
   from V1's own exportarCoparticipados() (modules/score.html lines
   670-753, portal-financiamento-brabus-secure) -- presentation/formatting
   utility code, not business logic, so this is a faithful adaptation
   (same number formats, same header style, same column-width heuristic),
   not a byte-identical extraction the way calcScores()/aggregate() are. */
(function () {
  'use strict';

  function excelDateValue(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    var txt = String(value).trim();
    var m = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { var y = Number(m[3]); if (y < 100) y += 2000; return new Date(y, Number(m[2]) - 1, Number(m[1])); }
    var d = new Date(txt);
    return isNaN(d.getTime()) ? '' : d;
  }

  // Deterministic, filesystem-safe timestamp (Gate 23) -- local time, no
  // characters illegal on Windows/macOS/Linux filesystems.
  function excelFileStamp() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function setCellStyle(ws, addr, style) {
    if (!ws[addr]) return;
    ws[addr].s = Object.assign({}, ws[addr].s || {}, style || {});
  }

  // options.moneyCols/pctCols/dateCols/intCols/textCols: Sets of header
  // labels (Gate 16: typed values, not display artifacts -- money/pct get
  // real numeric cells with a number format, not pre-formatted strings).
  // Same defaults/behavior as V1's applyProfessionalExcelFormat; column
  // classification is passed in per export (each module knows its own
  // column types) rather than hardcoded here.
  function applyProfessionalExcelFormat(ws, headers, rowsCount, options) {
    options = options || {};
    var moneyCols = options.moneyCols || new Set();
    var pctCols = options.pctCols || new Set();
    var dateCols = options.dateCols || new Set();
    var intCols = options.intCols || new Set();
    var textCols = options.textCols || new Set();
    var headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '8A0008' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: '3A3A3A' } }, bottom: { style: 'thin', color: { rgb: '3A3A3A' } }, left: { style: 'thin', color: { rgb: '3A3A3A' } }, right: { style: 'thin', color: { rgb: '3A3A3A' } } }
    };
    var bodyBorder = { top: { style: 'thin', color: { rgb: 'D9D9D9' } }, bottom: { style: 'thin', color: { rgb: 'D9D9D9' } }, left: { style: 'thin', color: { rgb: 'D9D9D9' } }, right: { style: 'thin', color: { rgb: 'D9D9D9' } } };
    for (var c = 0; c < headers.length; c++) {
      setCellStyle(ws, XLSX.utils.encode_cell({ r: 0, c: c }), headerStyle);
    }
    for (var r = 1; r <= rowsCount; r++) {
      for (var c2 = 0; c2 < headers.length; c2++) {
        var h = headers[c2];
        var addr = XLSX.utils.encode_cell({ r: r, c: c2 });
        var cell = ws[addr];
        if (!cell) continue;
        var fmtStyle = { border: bodyBorder, alignment: { vertical: 'center' } };
        if (moneyCols.has(h)) {
          if (typeof cell.v === 'number') { cell.t = 'n'; cell.z = '"R$" #,##0.00'; }
          fmtStyle.alignment.horizontal = 'right';
        } else if (pctCols.has(h)) {
          if (typeof cell.v === 'number') { cell.t = 'n'; cell.z = '0.00%'; }
          fmtStyle.alignment.horizontal = 'right';
        } else if (dateCols.has(h)) {
          if (cell.v) {
            var dd = excelDateValue(cell.v);
            if (dd) { cell.v = dd; cell.t = 'd'; cell.z = 'dd/mm/yyyy'; }
          }
          fmtStyle.alignment.horizontal = 'center';
        } else if (intCols.has(h)) {
          if (cell.v !== '' && !isNaN(Number(cell.v))) { cell.v = Number(cell.v); cell.t = 'n'; cell.z = '0'; }
          fmtStyle.alignment.horizontal = 'right';
        } else if (textCols.has(h)) {
          cell.t = 's';
          fmtStyle.alignment.horizontal = 'left';
        } else {
          fmtStyle.alignment.horizontal = (typeof cell.v === 'number') ? 'right' : 'left';
        }
        setCellStyle(ws, addr, fmtStyle);
      }
    }
    ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    ws['!cols'] = headers.map(function (h, idx) {
      var max = String(h).length;
      for (var r2 = 1; r2 <= rowsCount; r2++) {
        var cell2 = ws[XLSX.utils.encode_cell({ r: r2, c: idx })];
        if (cell2 && cell2.v !== undefined && cell2.v !== null) {
          var v = cell2.v instanceof Date ? 'dd/mm/yyyy' : String(cell2.v);
          max = Math.max(max, v.length);
        }
      }
      return { wch: Math.min(Math.max(max + 3, 12), 42) };
    });
    ws['!rows'] = [{ hpt: 24 }];
  }

  function buildStyledWorksheet(headers, dataRows, sheetName, columnTypes) {
    var aoa = [headers].concat(dataRows);
    var ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    applyProfessionalExcelFormat(ws, headers, dataRows.length, columnTypes);
    return ws;
  }

  // Single-sheet convenience wrapper -- both GAP-003 and GAP-004 export
  // exactly one sheet each (Gate 15: keep this mechanical, not a framework).
  function downloadWorkbook(headers, dataRows, sheetName, filename, columnTypes) {
    var ws = buildStyledWorksheet(headers, dataRows, sheetName, columnTypes);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    wb.Workbook = { Views: [{ RTL: false }] };
    XLSX.writeFile(wb, filename, { bookType: 'xlsx', cellDates: true });
  }

  window.NX_XLSX_EXPORT_HELPER = {
    excelDateValue: excelDateValue,
    excelFileStamp: excelFileStamp,
    buildStyledWorksheet: buildStyledWorksheet,
    downloadWorkbook: downloadWorkbook
  };
})();
