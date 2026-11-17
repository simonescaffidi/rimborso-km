// Lavori pianificati: aggiornamento tabelle ACI e prezzi carburanti, pulizia cache percorsi.
const cron = require('node-cron');
const db = require('./db');
const aci = require('./services/aci');
const carburanti = require('./services/carburanti');
const { alert } = require('./alert');

async function log(job, esito, dettaglio) {
  await db.query('INSERT INTO job_log (job,esito,dettaglio) VALUES ($1,$2,$3)', [job, esito, String(dettaglio || '').slice(0, 4000)]).catch(() => {});
}

// Anni da controllare: quello in corso e, da novembre, il successivo
function anniDaControllare(oggi = new Date()) {
  const y = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric' }).format(oggi));
  const m = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', month: 'numeric' }).format(oggi));
  return m >= 11 ? [y, y + 1] : [y];
}

async function jobAci({ forza = false } = {}) {
  const anni = anniDaControllare();
  const esiti = [];
  for (const anno of anni) esiti.push(await aci.aggiornaAnno(anno, { forza }));
  const corrente = esiti[0];
  const testo = JSON.stringify(esiti);
  const importate = esiti.some((e) => e.importate.length);
  await log('aci', esiti.some((e) => e.errori.length) ? 'errore' : importate ? 'ok' : 'nessuna-novita', testo);
  if (esiti.some((e) => e.errori.length)) await alert('aci-import', new Error(esiti.flatMap((e) => e.errori).join(' | ')));
  // l'anno in corso deve essere completo entro il 20 gennaio
  const giorno = new Date().getUTCMonth() * 31 + new Date().getUTCDate();
  const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM aci_import WHERE anno=$1', [corrente.anno]);
  if (r.n === 0 && giorno >= 20) await alert('aci-mancanti', new Error(`Tabelle ACI ${corrente.anno} non trovate: il sito ACI potrebbe aver cambiato i percorsi dei file. Mancanti: ${corrente.mancanti.join(', ')}`));
  return esiti;
}

async function jobCarburanti() {
  try {
    const r = await carburanti.aggiorna();
    await log('carburanti', 'ok', JSON.stringify(r));
    return r;
  } catch (e) {
    await log('carburanti', 'errore', e.message);
    // un giorno saltato non è grave: alert solo se i dati hanno più di 3 giorni
    const { rows: [u] } = await db.query('SELECT max(giorno) AS g FROM carburanti_prezzi');
    if (!u.g || Date.now() - new Date(u.g).getTime() > 3 * 86400000) await alert('carburanti-import', e);
    return null;
  }
}

function avvia() {
  if (process.env.JOBS_DISABILITATI === '1') return;
  const opt = { timezone: 'Europe/Rome' };
  // ACI: ogni giorno alle 6:10 (il job salta da solo le tabelle già importate)
  cron.schedule('10 6 * * *', () => jobAci().catch((e) => alert('job-aci', e)), opt);
  // MIMIT pubblica alle 8: lettura alle 9:15
  cron.schedule('15 9 * * *', () => jobCarburanti().catch((e) => alert('job-carburanti', e)), opt);
  cron.schedule('30 3 * * *', () => db.query(`DELETE FROM percorsi_cache WHERE created_at < now() - interval '30 days'`).catch(() => {}), opt);
  // al primo avvio con DB vuoto
  setTimeout(async () => {
    try {
      const { rows: [a] } = await db.query('SELECT count(*)::int AS n FROM aci_import');
      if (!a.n) await jobAci();
      const { rows: [c] } = await db.query('SELECT count(*)::int AS n FROM carburanti_prezzi');
      if (!c.n) await jobCarburanti();
    } catch (e) { alert('job-avvio', e); }
  }, 15000).unref();
}

module.exports = { avvia, jobAci, jobCarburanti, anniDaControllare };
