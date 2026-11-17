const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const aci = require('../src/services/aci');
const carburanti = require('../src/services/carburanti');

async function xlsx(righe) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Foglio1');
  righe.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('ACI: intestazione con titolo, colonna costo km 15.000 e fringe benefit', async () => {
  const buf = await xlsx([
    ['AUTOVETTURE A BENZINA IN PRODUZIONE'], [],
    ['MARCA', 'MODELLO', 'SERIE', 'COSTO KM (15.000 km)', 'FRINGE BENEFIT 25%', 'FRINGE BENEFIT 30%'],
    ['FIAT', 'Panda 1.0 Hybrid', '', 0.4321, 1620.38, 1944.45],
    ['', 'Panda 1.2 69cv', 'Easy', '0,4512', 1692, 2030],
    ['TOYOTA', 'Yaris 1.5', 'Active', 0.5011, 1879.13, 2254.95],
    ['VW', 'Golf 1.5 TSI', '', 0.6123, 1, 1], ['VW', 'Polo 1.0', '', 0.48, 1, 1],
  ]);
  const r = await aci.parse(buf);
  assert.strictEqual(r.length, 5);
  assert.deepStrictEqual(r[1], { marca: 'FIAT', modello: 'Panda 1.2 69cv', serie: 'Easy', costoKm: 0.4512 });
});

test('ACI: layout ufficiale 2026 con colonna ID Modello', async () => {
  const buf = await xlsx([
    ['ID Modello', 'Marca', 'Modello', 'COSTO KM 15.000 KM', 'FRINGE BENEFIT ANNUALE (25% CK)', 'FRINGE BENEFIT ANNUALE (30% CK)'],
    ['CICLOMOTORI'],
    ['23383', 'ALFA ROMEO', 'GIULIA 2.0 TURBO Q4 VELOCE 280CV AWD', '0.9011', '3379.125', '4054.95'],
    ['29925', 'ALPINE', 'A110 1.8 250CV', '0.8537', '3201.375', '3841.65'],
    ['31398', 'AUDI', 'A1 ALLSTREET 30 TFSI 1.0 116 CV', '0.5397', '2023.87', '2428.64'],
    ['31206', 'AUDI', 'A1 SPB 30 1.0 116CV', '0.5181', '1942.87', '2331.45'],
    ['10459', 'APRILIA', 'SCARABEO 50 4T', '0.1678', '251.7', '629.25'],
  ]);
  const r = await aci.parse(buf);
  assert.strictEqual(r.length, 5);
  assert.deepStrictEqual(r[0], { marca: 'ALFA ROMEO', modello: 'GIULIA 2.0 TURBO Q4 VELOCE 280CV AWD', serie: null, costoKm: 0.9011 });
});

test('ACI: URL candidati con anno', () => {
  const u = aci.urlCandidati('Autoveicoli-BZ-IN', 2027);
  assert.ok(u[0].endsWith('/2026/12/Autoveicoli-BZ-IN-2027.xlsx'));
});

test('MIMIT: mediana self per carburante', () => {
  const righe = ['Estrazione del 2026-11-13', 'idImpianto|descCarburante|prezzo|isSelf|dtComu'];
  for (let i = 0; i < 30; i++) {
    righe.push(`${i}|Benzina|${(1.7 + i / 1000).toFixed(3)}|1|x`, `${i}|Gasolio|1.65${i % 10}|1|x`, `${i}|Benzina|2.100|0|x`, `${i}|HiQ Perform+|2.2|1|x`);
  }
  const r = carburanti.parse(righe.join('\n'));
  assert.strictEqual(r.giorno, '2026-11-13');
  assert.strictEqual(r.prezzi.benzina.prezzo, 1.715);
  assert.ok(r.prezzi.gasolio.prezzo > 1.65 && r.prezzi.gasolio.prezzo < 1.66);
});
