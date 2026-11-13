// Export nota spese in PDF (pdfkit) ed Excel (exceljs). Nessun dato viene salvato sul server.
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { euro, euroKm } = require('../format');

const FONT = path.join(__dirname, '..', '..', 'public', 'assets', 'fonts');

const L = {
  it: {
    titolo: 'Nota spese trasferte con auto propria', intest: 'Intestatario', azienda: 'Azienda', periodo: 'Periodo', targa: 'Veicolo / targa',
    metodo: 'Criterio rimborso km', aci: 'Tabelle ACI', fisso: 'Tariffa fissa', carb: 'Costo carburante', tariffa: 'Tariffa applicata',
    cols: ['Data', 'Percorso', 'Motivo', 'Km', 'Rimborso km', 'Pedaggi', 'Altre spese', 'Totale'],
    ar: 'A/R', tot: 'Totale', firma: 'Firma del dipendente', firma2: 'Visto / approvazione',
    nota: 'Rimborso calcolato con rimborso-km. Verificare il criterio con le regole aziendali e la normativa fiscale vigente.',
  },
  en: {
    titolo: 'Travel expense report – private car', intest: 'Employee', azienda: 'Company', periodo: 'Period', targa: 'Vehicle / plate',
    metodo: 'Mileage criterion', aci: 'ACI tables', fisso: 'Fixed rate', carb: 'Fuel cost', tariffa: 'Applied rate',
    cols: ['Date', 'Route', 'Purpose', 'Km', 'Mileage', 'Tolls', 'Other', 'Total'],
    ar: 'return', tot: 'Total', firma: 'Employee signature', firma2: 'Approved by',
    nota: 'Calculated with rimborso-km. Check the criterion against company policy and current tax rules.',
  },
};

function descrMetodo(n, t) {
  const m = n.metodo;
  if (m.tipo === 'aci') return `${t.aci}${m.veicolo ? ` – ${m.veicolo}` : ''}`;
  if (m.tipo === 'fisso') return t.fisso;
  return `${t.carb} (${m.consumo} l/100 km × ${m.prezzo} €${m.carburante ? `, ${m.carburante}` : ''})`;
}
const percorso = (r, t) => [r.partenza, r.arrivo].filter(Boolean).join(' → ') + (r.andataRitorno ? ` (${t.ar})` : '');

function pdf(n, lingua = 'it') {
  const t = L[lingua] || L.it;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: t.titolo, Producer: 'rimborso-km' } });
  doc.registerFont('r', path.join(FONT, 'titillium-web-latin-400-normal.woff2'));
  doc.registerFont('b', path.join(FONT, 'titillium-web-latin-700-normal.woff2'));
  const W = doc.page.width - 72;
  doc.font('b').fontSize(18).fillColor('#0b5d33').text(t.titolo);
  doc.moveDown(0.3).font('r').fontSize(10).fillColor('#222');
  const info = [[t.intest, n.intestatario], [t.azienda, n.azienda], [t.periodo, n.periodo], [t.targa, n.targa], [t.metodo, descrMetodo(n, t)], [t.tariffa, `${euroKm(n.tariffaKm)} €/km`]].filter((x) => x[1]);
  info.forEach(([k, v]) => doc.font('b').text(`${k}: `, { continued: true }).font('r').text(v));
  doc.moveDown(0.8);

  const larg = [62, 210, 160, 50, 75, 60, 70, 75].map((x) => (x * W) / 762);
  const x0 = 36;
  let y = doc.y;
  const riga = (celle, bold, fill) => {
    const h = Math.max(...celle.map((c, i) => doc.font(bold ? 'b' : 'r').fontSize(9).heightOfString(String(c), { width: larg[i] - 6 }))) + 8;
    if (y + h > doc.page.height - 90) { doc.addPage(); y = 36; }
    if (fill) doc.rect(x0, y, W, h).fill(fill);
    let x = x0;
    celle.forEach((c, i) => {
      doc.fillColor(fill === '#0b5d33' ? '#fff' : '#222').font(bold ? 'b' : 'r').fontSize(9)
        .text(String(c), x + 3, y + 4, { width: larg[i] - 6, align: i >= 3 ? 'right' : 'left' });
      x += larg[i];
    });
    doc.moveTo(x0, y + h).lineTo(x0 + W, y + h).strokeColor('#ddd').lineWidth(0.5).stroke();
    y += h;
  };
  riga(t.cols, true, '#0b5d33');
  n.righe.forEach((r) => riga([r.data, percorso(r, t), r.motivo, r.kmTotali.toLocaleString('it-IT'), euro(r.rimborsoKm), euro(r.pedaggi), euro(r.extra), euro(r.totale)]));
  const T = n.totali;
  riga([t.tot, '', '', T.km.toLocaleString('it-IT'), euro(T.rimborsoKm), euro(T.pedaggi), euro(T.extra), euro(T.totale)], true, '#eef6f0');

  y += 40;
  if (y > doc.page.height - 80) { doc.addPage(); y = 60; }
  doc.font('r').fontSize(9).fillColor('#222');
  doc.text(t.firma, x0, y); doc.text(t.firma2, x0 + W / 2, y);
  doc.moveTo(x0, y + 30).lineTo(x0 + 220, y + 30).stroke(); doc.moveTo(x0 + W / 2, y + 30).lineTo(x0 + W / 2 + 220, y + 30).stroke();
  doc.fontSize(7).fillColor('#777').text(t.nota, x0, doc.page.height - 50, { width: W });
  doc.end();
  return doc;
}

async function xlsx(n, lingua = 'it') {
  const t = L[lingua] || L.it;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'rimborso-km';
  const ws = wb.addWorksheet(lingua === 'en' ? 'Expense report' : 'Nota spese');
  ws.addRow([t.titolo]).font = { bold: true, size: 14, color: { argb: 'FF0B5D33' } };
  [[t.intest, n.intestatario], [t.azienda, n.azienda], [t.periodo, n.periodo], [t.targa, n.targa], [t.metodo, descrMetodo(n, t)], [t.tariffa, n.tariffaKm]]
    .filter((x) => x[1]).forEach((x) => { const r = ws.addRow(x); r.getCell(1).font = { bold: true }; });
  ws.addRow([]);
  const cols = [...t.cols.slice(0, 3), 'A/R', ...t.cols.slice(3)];
  const h = ws.addRow(cols);
  h.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5D33' } }; });
  const primo = h.number + 1;
  n.righe.forEach((r) => ws.addRow([r.data, [r.partenza, r.arrivo].filter(Boolean).join(' → '), r.motivo, r.andataRitorno ? 'X' : '', r.kmTotali, r.rimborsoKm / 100, r.pedaggi / 100, r.extra / 100, r.totale / 100]));
  const ultimo = ws.lastRow.number;
  const tot = ws.addRow([t.tot, '', '', '', ...['E', 'F', 'G', 'H', 'I'].map((c) => ({ formula: `SUM(${c}${primo}:${c}${ultimo})` }))]);
  tot.font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = [12, 40, 30, 6, 10, 14, 12, 14, 14][i]; });
  ['F', 'G', 'H', 'I'].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.00 €'; });
  return wb.xlsx.writeBuffer();
}

module.exports = { pdf, xlsx };
