// Autenticazione: sessioni su Postgres, bcrypt, CSRF, reset password via email (standard stack Simone)
const crypto = require('crypto');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('./db');
const mailer = require('./mailer');

const PROD = process.env.NODE_ENV === 'production';
if (PROD && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET mancante: avvio bloccato');
  process.exit(1);
}

function sessione() {
  return session({
    store: new PgStore({ pool: db.pool, tableName: 'sessioni', createTableIfMissing: false, pruneSessionInterval: 3600 }),
    name: 'rkm_sess',
    secret: process.env.SESSION_SECRET || 'solo-sviluppo-locale',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: 12 * 3600 * 1000 },
  });
}

// token CSRF per sessione: campo _csrf nei form, header X-CSRF-Token nelle fetch
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}
function verificaCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const atteso = req.session && req.session.csrf;
  const dato = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  if (!atteso || dato.length !== atteso.length || !crypto.timingSafeEqual(Buffer.from(dato), Buffer.from(atteso))) {
    return res.status(403).format({ json: () => res.json({ errore: 'csrf' }), default: () => res.send('Sessione scaduta: ricarica la pagina.') });
  }
  next();
}

// carica l'utente in res.locals
async function utenteCorrente(req, res, next) {
  res.locals.utente = null;
  if (req.session && req.session.uid) {
    const { rows: [u] } = await db.query('SELECT id, email, nome, lingua FROM utenti WHERE id=$1', [req.session.uid]);
    if (u) { req.utente = u; res.locals.utente = u; } else delete req.session.uid;
  }
  res.locals.csrf = req.session ? csrfToken(req) : '';
  next();
}

function richiediLogin(lingua) {
  return (req, res, next) => {
    if (req.utente) return next();
    if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) return res.status(401).json({ errore: 'login' });
    res.redirect((lingua === 'en' ? '/en/login' : '/accedi') + '?r=' + encodeURIComponent(req.originalUrl));
  };
}

const HASH_FINTO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const Email = z.string().trim().toLowerCase().email().max(200);
const Password = z.string().min(8).max(200);
const Registrazione = z.object({ nome: z.string().trim().min(2).max(120), email: Email, password: Password, privacy: z.literal('on') });

async function registra(dati) {
  const d = Registrazione.parse(dati);
  const hash = await bcrypt.hash(d.password, 12);
  try {
    const { rows: [u] } = await db.query('INSERT INTO utenti (email, nome, password_hash) VALUES ($1,$2,$3) RETURNING id', [d.email, d.nome, hash]);
    return u.id;
  } catch (e) {
    if (e.code === '23505') { const err = new Error('email_esistente'); err.codice = 'email_esistente'; throw err; }
    throw e;
  }
}

async function login(email, password) {
  const e = Email.safeParse(email);
  if (!e.success) return null;
  const { rows: [u] } = await db.query('SELECT id, password_hash FROM utenti WHERE lower(email)=$1', [e.data]);
  // confronto anche senza utente per tempi costanti
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : HASH_FINTO);
  if (!u || !ok) return null;
  await db.query('UPDATE utenti SET ultimo_accesso=now() WHERE id=$1', [u.id]);
  return u.id;
}

// avvia la sessione rigenerando l'id (anti session fixation)
function apriSessione(req, uid) {
  return new Promise((ok, ko) => req.session.regenerate((err) => {
    if (err) return ko(err);
    req.session.uid = uid;
    req.session.save((e) => (e ? ko(e) : ok()));
  }));
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function inviaReset(email, baseUrl, lingua) {
  const e = Email.safeParse(email);
  if (!e.success) return;
  const { rows: [u] } = await db.query('SELECT id, nome FROM utenti WHERE lower(email)=$1', [e.data]);
  if (!u) return; // nessuna informazione su quali email esistono
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(`INSERT INTO password_tokens (token_hash, utente_id, scade_at) VALUES ($1,$2, now() + interval '1 hour')`, [sha(token), u.id]);
  const link = `${baseUrl}${lingua === 'en' ? '/en/reset-password' : '/reimposta-password'}?token=${token}`;
  const it = lingua !== 'en';
  const oggetto = it ? 'Reimposta la password – Rimborso Km' : 'Reset your password – Rimborso Km';
  const testo = it
    ? `Ciao ${u.nome},\n\nper scegliere una nuova password apri questo link (valido 1 ora):\n${link}\n\nSe non hai chiesto tu il reset, ignora questa email.`
    : `Hi ${u.nome},\n\nto choose a new password open this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`;
  const r = await mailer.invia({ to: e.data, subject: oggetto, text: testo });
  await db.query('INSERT INTO email_log (destinatario, oggetto, esito) VALUES ($1,$2,$3)', [e.data, oggetto, r.inviata ? 'inviata' : String(r.motivo || 'errore')]).catch(() => {});
  if (!r.inviata) throw new Error(`invio email reset non riuscito: ${r.motivo}`);
}

async function reimposta(token, password) {
  const p = Password.safeParse(password);
  if (!p.success) return 'password_corta';
  const { rows: [t] } = await db.query('SELECT utente_id FROM password_tokens WHERE token_hash=$1 AND NOT usato AND scade_at > now()', [sha(String(token || ''))]);
  if (!t) return 'token_non_valido';
  await db.tx(async (c) => {
    await c.query('UPDATE utenti SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(p.data, 12), t.utente_id]);
    await c.query('UPDATE password_tokens SET usato=true WHERE utente_id=$1', [t.utente_id]);
    // chiude tutte le sessioni aperte dell'utente
    await c.query(`DELETE FROM sessioni WHERE (sess->>'uid')::text = $1`, [String(t.utente_id)]);
  });
  return null;
}

async function cambiaPassword(uid, attuale, nuova) {
  const p = Password.safeParse(nuova);
  if (!p.success) return 'password_corta';
  const { rows: [u] } = await db.query('SELECT password_hash FROM utenti WHERE id=$1', [uid]);
  if (!u || !(await bcrypt.compare(String(attuale || ''), u.password_hash))) return 'password_errata';
  await db.query('UPDATE utenti SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(p.data, 12), uid]);
  return null;
}

module.exports = { sessione, csrfToken, verificaCsrf, utenteCorrente, richiediLogin, registra, login, apriSessione, inviaReset, reimposta, cambiaPassword };
