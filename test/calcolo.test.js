const test = require('node:test');
const assert = require('node:assert');
const { calcola } = require('../src/services/calcolo');

test('ACI: km x tariffa, andata e ritorno raddoppia km e pedaggio', () => {
  const r = calcola({ metodo: { tipo: 'aci', costoKm: 0.4512 }, trasferte: [{ km: 100, andataRitorno: true, pedaggio: 7.3, vitto: 15 }] });
  assert.strictEqual(r.righe[0].kmTotali, 200);
  assert.strictEqual(r.righe[0].rimborsoKm, 9024);   // 200 * 0,4512 = 90,24
  assert.strictEqual(r.righe[0].pedaggi, 1460);
  assert.strictEqual(r.righe[0].extra, 1500);
  assert.strictEqual(r.totali.totale, 9024 + 1460 + 1500);
});

test('carburante: consumo/100 x prezzo', () => {
  const r = calcola({ metodo: { tipo: 'carburante', consumo: 6, prezzo: 1.8 }, trasferte: [{ km: 50 }] });
  assert.strictEqual(r.tariffaKm, 0.108);
  assert.strictEqual(r.totali.rimborsoKm, 540);
});

test('somma su più trasferte e arrotondamento al centesimo', () => {
  const r = calcola({ metodo: { tipo: 'fisso', costoKm: 0.33 }, trasferte: [{ km: 12.3 }, { km: 7.7, parcheggio: 2.5 }] });
  assert.strictEqual(r.totali.km, 20);
  assert.strictEqual(r.totali.rimborsoKm, 406 + 254);
  assert.strictEqual(r.totali.totale, 406 + 254 + 250);
});

test('input non valido rifiutato', () => {
  assert.throws(() => calcola({ metodo: { tipo: 'aci', costoKm: -1 }, trasferte: [{ km: 1 }] }));
  assert.throws(() => calcola({ metodo: { tipo: 'aci', costoKm: 0.3 }, trasferte: [] }));
});
