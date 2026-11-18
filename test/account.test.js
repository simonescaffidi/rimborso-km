const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
const app = require('../src/server');
const { migrate } = require('../src/migrate');
const { pool } = require('../src/db');

let srv, base;
test.before(async () => {
  await migrate();
  await pool.query("DELETE FROM utenti WHERE email LIKE '%@test.invalid'");
  srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => { srv.close(); await pool.end(); });

// mini client con cookie
function client() {
  let cookie = '';
  const req = async (path, opt = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...opt, headers: { ...(opt.headers || {}), cookie } });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return r;
  };
  const csrf = async (path) => { const h = await (await req(path)).text(); return (/name="_csrf" value="([a-f0-9]+)"/.exec(h) || [])[1]; };
  const form = (path, dati) => req(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dati).toString() });
  return { req, csrf, form };
}

const nota = (km) => ({ metodo: { tipo: 'aci', costoKm: 0.5, veicolo: 'Test' }, alimentazione: 'gasolio', trasferte: [{ data: '2026-11-10', partenza: 'A', arrivo: 'B', km, andataRitorno: true, pedaggio: 3, evita: false }] });

test('registrazione, aziende, note, storico e isolamento tra utenti', async () => {
  const u = client();
  let tok = await u.csrf('/registrati');
  assert.ok(tok);
  // senza consenso privacy: rifiutata
  let r = await u.form('/registrati', { _csrf: tok, nome: 'Mario Rossi', email: 'mario@test.invalid', password: 'segreta123' });
  assert.strictEqual(r.status, 400);
  r = await u.form('/registrati', { _csrf: tok, nome: 'Mario Rossi', email: 'mario@test.invalid', password: 'segreta123', privacy: 'on' });
  assert.strictEqual(r.status, 302);

  // CSRF obbligatorio
  r = await u.form('/area/aziende', { nome: 'ACME' });
  assert.strictEqual(r.status, 403);
  tok = await u.csrf('/area/aziende');
  assert.strictEqual((await u.form('/area/aziende', { _csrf: tok, nome: 'ACME Srl', piva: '01234567890' })).status, 302);
  assert.strictEqual((await u.form('/area/aziende', { _csrf: tok, nome: 'Beta Spa' })).status, 302);

  const api = (m, p, b) => u.req('/api/u' + p, { method: m, headers: { 'content-type': 'application/json', 'x-csrf-token': tok }, body: b ? JSON.stringify(b) : undefined });
  const me = await (await api('GET', '/me')).json();
  assert.strictEqual(me.aziende.length, 2);
  const [acme, beta] = me.aziende;

  const n1 = (await (await api('POST', '/note', { titolo: 'Novembre', aziendaId: acme.id, payload: nota(100) })).json()).id;
  const n2 = (await (await api('POST', '/note', { titolo: 'Novembre Beta', aziendaId: beta.id, payload: nota(50) })).json()).id;
  assert.ok(n1 && n2);

  // salvataggio dal calcolatore
  assert.strictEqual((await api('PUT', `/note/${n1}`, { payload: nota(120), titolo: 'Novembre 2026', aziendaId: acme.id })).status, 200);
  const letta = await (await api('GET', `/note/${n1}`)).json();
  assert.strictEqual(letta.titolo, 'Novembre 2026');
  assert.strictEqual(letta.trasferte[0].km, 120);
  assert.strictEqual(letta.alimentazione, 'gasolio');

  // storico: totali per azienda
  const area = await (await u.req('/area')).text();
  assert.match(area, /ACME Srl/);
  assert.match(area, /126,00/); // 240 km * 0,5 + 6 pedaggi
  const filtrata = await (await u.req(`/area?azienda=${beta.id}`)).text();
  assert.ok(!filtrata.includes(`?nota=${n1}"`) && filtrata.includes(`?nota=${n2}"`));

  // export PDF della nota salvata
  const pdf = await u.req(`/api/u/note/${n1}/export/pdf`);
  assert.strictEqual(pdf.status, 200);

  // un altro utente non vede le note del primo
  const v = client();
  const tok2 = await v.csrf('/registrati');
  await v.form('/registrati', { _csrf: tok2, nome: 'Luigi Verdi', email: 'luigi@test.invalid', password: 'segreta456', privacy: 'on' });
  const altrui = await v.req(`/api/u/note/${n1}`, { headers: { 'x-csrf-token': tok2 } });
  assert.strictEqual(altrui.status, 404);

  // stato e cancellazione account
  assert.strictEqual((await u.form(`/area/note/${n1}/stato`, { _csrf: tok, stato: 'rimborsata' })).status, 302);
  assert.strictEqual((await u.form('/area/account/elimina', { _csrf: tok, conferma: 'mario@test.invalid' })).status, 302);
  const { rows } = await pool.query("SELECT count(*)::int n FROM note_spese n JOIN utenti u ON u.id=n.utente_id WHERE u.email='mario@test.invalid'");
  assert.strictEqual(rows[0].n, 0);
});

test('login: credenziali errate e API senza sessione', async () => {
  const u = client();
  const tok = await u.csrf('/accedi');
  const r = await u.form('/accedi', { _csrf: tok, email: 'nessuno@test.invalid', password: 'xxxxxxxx' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual((await u.req('/api/u/me')).status, 401);
  assert.strictEqual((await u.req('/area')).status, 302);
});
