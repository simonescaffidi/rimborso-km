// Alert email su errori verso ALERT_EMAIL (default info@simonescaffidi.it).
// Anti-spam: al massimo una mail per tipo di errore ogni 30 minuti (stato su DB, sopravvive ai riavvii).
// Senza Brevo (BREVO_API_KEY) l'alert resta registrato in alert_log e nei log di Railway; il monitor esterno (GitHub Actions) copre i down.
const os = require('os');
const mailer = require('./mailer');

const SLUG = 'rimborso-km';
const FINESTRA_MIN = Number(process.env.ALERT_FINESTRA_MIN || 30);
const ultimiInvii = new Map();
let db = null; // collegato in modo pigro per evitare dipendenze circolari

function dest() { return process.env.ALERT_EMAIL || 'info@simonescaffidi.it'; }
const oraRoma = () => new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

async function registra(tipo, messaggio, inviata, errore) {
  try {
    db = db || require('./db');
    await db.query('INSERT INTO alert_log (tipo, messaggio, email_inviata, errore_invio) VALUES ($1,$2,$3,$4)', [tipo, String(messaggio).slice(0, 2000), inviata, errore || null]);
  } catch { /* il DB può essere proprio la causa dell'errore */ }
}

async function puoInviare(tipo) {
  const ora = Date.now();
  const mem = ultimiInvii.get(tipo);
  if (mem && ora - mem < FINESTRA_MIN * 60000) return false;
  try {
    db = db || require('./db');
    const { rows: [r] } = await db.query(`SELECT 1 FROM alert_log WHERE tipo=$1 AND email_inviata AND created_at > now() - ($2 || ' minutes')::interval LIMIT 1`, [tipo, String(FINESTRA_MIN)]);
    if (r) { ultimiInvii.set(tipo, ora); return false; }
  } catch { /* DB non raggiungibile: decide solo la memoria */ }
  return true;
}

/**
 * @param {string} tipo      chiave breve e stabile (es. "http-500", "sdi-invio", "crash")
 * @param {string|Error} err messaggio o errore
 * @param {object} contesto  dettagli aggiuntivi (percorso, tenant, documento...)
 */
async function alert(tipo, err, contesto = {}) {
  const messaggio = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : '';
  console.error(`[ALERT] ${tipo}: ${messaggio}`);
  if (process.env.NODE_ENV === 'test' && !process.env.ALERT_TEST) return { inviata: false, motivo: 'test' };
  if (!(await puoInviare(tipo))) { await registra(tipo, messaggio, false, 'soppresso (anti-spam)'); return { inviata: false, motivo: 'anti-spam' }; }
  ultimiInvii.set(tipo, Date.now());
  const corpo = [
    `Servizio: ${SLUG} (${process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'locale'})`,
    `Data/ora: ${oraRoma()} (Europe/Rome)`,
    `Tipo: ${tipo}`,
    `Messaggio: ${messaggio}`,
    Object.keys(contesto).length ? `Contesto: ${JSON.stringify(contesto, null, 1).slice(0, 1500)}` : '',
    stack ? `\nStack:\n${stack}` : '',
    `\nHost: ${os.hostname()}`,
    process.env.RAILWAY_PROJECT_ID ? `Railway: https://railway.com/project/${process.env.RAILWAY_PROJECT_ID}` : '',
    `Le mail per questo tipo di errore sono sospese per ${FINESTRA_MIN} minuti.`,
  ].filter(Boolean).join('\n');
  try {
    const r = await mailer.invia({ to: dest(), subject: `[ALERT] ${SLUG} – ${tipo}`, text: corpo });
    await registra(tipo, messaggio, !!r.inviata, r.inviata ? null : r.motivo);
    return r;
  } catch (e) {
    await registra(tipo, messaggio, false, e.message);
    console.error('[ALERT] invio email fallito:', e.message);
    return { inviata: false, motivo: e.message };
  }
}

function installaGestoriProcesso() {
  process.on('unhandledRejection', (e) => { alert('unhandled-rejection', e instanceof Error ? e : new Error(String(e))); });
  process.on('uncaughtException', (e) => {
    // invia l'alert e poi termina: Railway riavvia il servizio
    const t = setTimeout(() => process.exit(1), 5000); t.unref();
    alert('crash', e).finally(() => process.exit(1));
  });
}

module.exports = { alert, installaGestoriProcesso, _reset: () => ultimiInvii.clear() };
