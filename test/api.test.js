const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
const app = require('../src/server');
const { migrate } = require('../src/migrate');
const { pool } = require('../src/db');

let srv, base;
test.before(async () => { await migrate(); srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`; });
test.after(async () => { srv.close(); await pool.end(); });

const nota = { metodo: { tipo: 'aci', costoKm: 0.45, veicolo: 'Fiat Panda' }, intestatario: 'Mario Rossi', trasferte: [{ data: '2026-11-13', partenza: 'Capo d\'Orlando', arrivo: 'Palermo', km: 150, andataRitorno: true, pedaggio: 0 }] };
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

test('health', async () => { const r = await fetch(base + '/health'); assert.strictEqual(r.status, 200); });
test('pagine IT/EN con powered by e hreflang', async () => {
  for (const p of ['/', '/en/', '/tabelle-aci', '/en/aci-tables', '/manuale', '/en/manual', '/privacy', '/cookie-policy']) {
    const r = await fetch(base + p); const h = await r.text();
    assert.strictEqual(r.status, 200, p);
    assert.match(h, /Powered by <a href="https:\/\/www.simonescaffidi.it"/, p);
    assert.match(h, /hreflang="en"/, p);
  }
});
test('calcola', async () => { const r = await (await post('/api/calcola', nota)).json(); assert.strictEqual(r.totali.totale, 13500); });
test('export pdf e xlsx', async () => {
  const p = await post('/api/export/pdf', nota); assert.strictEqual(p.status, 200); assert.strictEqual((await p.arrayBuffer()).byteLength > 1000, true);
  const x = await post('/api/export/xlsx?lang=en', nota); assert.strictEqual(x.status, 200);
});
test('percorso senza chiave: 503', async () => { const r = await post('/api/percorso', { partenza: 'Roma', arrivo: 'Milano' }); assert.strictEqual(r.status, 503); });
test('admin senza token: 401', async () => { const r = await post('/admin/alert-test', {}); assert.strictEqual(r.status, 401); });
