// Account utente: accesso, registrazione, recupero password, area personale (aziende, note, storico), API note
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const auth = require('../auth');
const note = require('../services/note');
const exp = require('../services/export');
const { calcola } = require('../services/calcolo');
const { alert } = require('../alert');
const db = require('../db');
const fmt = require('../format');

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

// percorsi IT/EN delle pagine account
const P = {
  accedi: { it: '/accedi', en: '/en/login' },
  registrati: { it: '/registrati', en: '/en/signup' },
  recupero: { it: '/password-dimenticata', en: '/en/forgot-password' },
  reimposta: { it: '/reimposta-password', en: '/en/reset-password' },
  area: { it: '/area', en: '/en/area' },
  aziende: { it: '/area/aziende', en: '/en/area/companies' },
  account: { it: '/area/account', en: '/en/area/account' },
};

module.exports = function account(render) {
  const r = express.Router();
  const limiteAuth = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ritorno = (q, lingua) => (typeof q === 'string' && /^\/(?!\/)/.test(q) ? q : P.area[lingua]);

  for (const lingua of ['it', 'en']) {
    const login = auth.richiediLogin(lingua);

    // ----- accesso -----
    r.get(P.accedi[lingua], (req, res) => (req.utente ? res.redirect(P.area[lingua]) : render(res, 'auth/accedi', lingua, 'accedi', { errore: null, email: '', r: req.query.r || '', info: req.query.reimpostata ? 'a.reimpostata' : null })));
    r.post(P.accedi[lingua], limiteAuth, form, auth.verificaCsrf, async (req, res) => {
      const uid = await auth.login(req.body.email, req.body.password);
      if (!uid) return render(res.status(401), 'auth/accedi', lingua, 'accedi', { errore: 'credenziali', email: String(req.body.email || '').slice(0, 200), r: req.body.r || '', info: null });
      await auth.apriSessione(req, uid);
      res.redirect(ritorno(req.body.r, lingua));
    });

    // ----- registrazione -----
    r.get(P.registrati[lingua], (req, res) => (req.utente ? res.redirect(P.area[lingua]) : render(res, 'auth/registrati', lingua, 'registrati', { errore: null, v: {} })));
    r.post(P.registrati[lingua], limiteAuth, form, auth.verificaCsrf, async (req, res) => {
      const v = { nome: String(req.body.nome || '').slice(0, 120), email: String(req.body.email || '').slice(0, 200) };
      if (String(req.body.sito || '')) return res.redirect(P.area[lingua]); // honeypot
      try {
        const uid = await auth.registra(req.body);
        await db.query('UPDATE utenti SET lingua=$2 WHERE id=$1', [uid, lingua]);
        await auth.apriSessione(req, uid);
        res.redirect(P.area[lingua] + '?benvenuto=1');
      } catch (e) {
        const errore = e.codice === 'email_esistente' ? 'email_esistente' : e.name === 'ZodError' ? 'dati' : null;
        if (!errore) throw e;
        render(res.status(400), 'auth/registrati', lingua, 'registrati', { errore, v });
      }
    });

    // ----- recupero password -----
    r.get(P.recupero[lingua], (req, res) => render(res, 'auth/recupero', lingua, 'recupero', { inviato: false, errore: null }));
    r.post(P.recupero[lingua], limiteAuth, form, auth.verificaCsrf, async (req, res) => {
      try { await auth.inviaReset(req.body.email, PUBLIC_URL, lingua); } catch (e) {
        alert('email-reset', e);
        return render(res.status(503), 'auth/recupero', lingua, 'recupero', { inviato: false, errore: 'invio' });
      }
      render(res, 'auth/recupero', lingua, 'recupero', { inviato: true, errore: null });
    });
    r.get(P.reimposta[lingua], (req, res) => render(res, 'auth/reimposta', lingua, 'reimposta', { token: String(req.query.token || '').slice(0, 100), errore: null }));
    r.post(P.reimposta[lingua], limiteAuth, form, auth.verificaCsrf, async (req, res) => {
      const errore = await auth.reimposta(req.body.token, req.body.password);
      if (errore) return render(res.status(400), 'auth/reimposta', lingua, 'reimposta', { token: String(req.body.token || '').slice(0, 100), errore });
      res.redirect(P.accedi[lingua] + '?reimpostata=1');
    });

    // ----- area personale: note e storico -----
    r.get(P.area[lingua], login, async (req, res) => {
      const uid = req.utente.id;
      const [elenco, aziende, riepilogo, anni] = await Promise.all([note.elenco(uid, req.query), note.aziende(uid), note.riepilogo(uid), note.anni(uid)]);
      render(res, 'area/note', lingua, 'area', { elenco, aziende, riepilogo, anni, filtri: req.query, benvenuto: !!req.query.benvenuto });
    });
    r.post(P.area[lingua] + '/note', login, form, auth.verificaCsrf, async (req, res) => {
      const nid = await note.crea(req.utente.id, { titolo: req.body.titolo, aziendaId: req.body.azienda_id, intestatario: req.utente.nome });
      res.redirect(`${lingua === 'en' ? '/en/' : '/'}?nota=${nid}`);
    });
    r.post(P.area[lingua] + '/note/:id/stato', login, form, auth.verificaCsrf, async (req, res) => {
      await note.cambiaStato(req.utente.id, req.params.id, req.body.stato);
      res.redirect(req.get('referer') && req.get('referer').includes('/area') ? req.get('referer') : P.area[lingua]);
    });
    r.post(P.area[lingua] + '/note/:id/duplica', login, form, auth.verificaCsrf, async (req, res) => {
      const nid = await note.duplica(req.utente.id, req.params.id);
      res.redirect(nid ? `${lingua === 'en' ? '/en/' : '/'}?nota=${nid}` : P.area[lingua]);
    });
    r.post(P.area[lingua] + '/note/:id/elimina', login, form, auth.verificaCsrf, async (req, res) => {
      await note.elimina(req.utente.id, req.params.id);
      res.redirect(P.area[lingua]);
    });

    // ----- aziende -----
    r.get(P.aziende[lingua], login, async (req, res) => render(res, 'area/aziende', lingua, 'aziende', { aziende: await note.aziende(req.utente.id), errore: null }));
    r.post(P.aziende[lingua], login, form, auth.verificaCsrf, async (req, res) => {
      try { await note.creaAzienda(req.utente.id, req.body); } catch (e) {
        if (e.name !== 'ZodError') throw e;
        return render(res.status(400), 'area/aziende', lingua, 'aziende', { aziende: await note.aziende(req.utente.id), errore: 'dati' });
      }
      res.redirect(req.body.r && /^\/(?!\/)/.test(req.body.r) ? req.body.r : P.aziende[lingua]);
    });
    r.post(P.aziende[lingua] + '/:id', login, form, auth.verificaCsrf, async (req, res) => {
      try { await note.modificaAzienda(req.utente.id, req.params.id, req.body); } catch (e) { if (e.name !== 'ZodError') throw e; }
      res.redirect(P.aziende[lingua]);
    });
    r.post(P.aziende[lingua] + '/:id/elimina', login, form, auth.verificaCsrf, async (req, res) => {
      await note.eliminaAzienda(req.utente.id, req.params.id);
      res.redirect(P.aziende[lingua]);
    });

    // ----- account -----
    r.get(P.account[lingua], login, (req, res) => render(res, 'area/account', lingua, 'account', { msg: req.query.msg || null }));
    r.post(P.account[lingua] + '/profilo', login, form, auth.verificaCsrf, async (req, res) => {
      const nome = String(req.body.nome || '').trim().slice(0, 120);
      if (nome.length >= 2) await db.query('UPDATE utenti SET nome=$2 WHERE id=$1', [req.utente.id, nome]);
      res.redirect(P.account[lingua] + '?msg=salvato');
    });
    r.post(P.account[lingua] + '/password', login, limiteAuth, form, auth.verificaCsrf, async (req, res) => {
      const err = await auth.cambiaPassword(req.utente.id, req.body.attuale, req.body.nuova);
      res.redirect(P.account[lingua] + '?msg=' + (err || 'password_ok'));
    });
    r.get(P.account[lingua] + '/esporta', login, async (req, res) => {
      res.set('Content-Disposition', `attachment; filename="rimborso-km-dati-${fmt.oggiRoma()}.json"`).json(await note.esportaTutto(req.utente.id));
    });
    r.post(P.account[lingua] + '/elimina', login, form, auth.verificaCsrf, async (req, res) => {
      if (String(req.body.conferma || '').trim().toLowerCase() !== String(req.utente.email).toLowerCase()) return res.redirect(P.account[lingua] + '?msg=conferma');
      await db.query('DELETE FROM utenti WHERE id=$1', [req.utente.id]);
      req.session.destroy(() => res.redirect(lingua === 'en' ? '/en/?eliminato=1' : '/?eliminato=1'));
    });
  }

  r.post('/esci', express.urlencoded({ extended: false }), auth.verificaCsrf, (req, res) => {
    const en = String(req.body.lang) === 'en';
    req.session.destroy(() => res.clearCookie('rkm_sess').redirect(en ? '/en/' : '/'));
  });

  // ----- API note (calcolatore collegato) -----
  const api = express.Router();
  api.use(auth.richiediLogin('it'), auth.verificaCsrf);
  api.get('/me', async (req, res) => res.json({ utente: { nome: req.utente.nome }, aziende: await note.aziende(req.utente.id) }));
  api.post('/note', async (req, res) => {
    const b = req.body || {};
    let payload = null;
    try { if (b.payload) { calcola(b.payload); payload = b.payload; } } catch { return res.status(400).json({ errore: 'dati_non_validi' }); }
    const nid = await note.crea(req.utente.id, { titolo: b.titolo, aziendaId: b.aziendaId, payload, intestatario: (payload && payload.intestatario) || req.utente.nome });
    res.status(201).json({ id: nid });
  });
  api.get('/note/:id', async (req, res) => {
    const n = await note.leggi(req.utente.id, req.params.id);
    return n ? res.json(n) : res.status(404).json({ errore: 'non_trovata' });
  });
  api.put('/note/:id', async (req, res) => {
    const b = req.body || {};
    let ok;
    try { ok = await note.salva(req.utente.id, req.params.id, b.payload || {}, { titolo: b.titolo, aziendaId: b.aziendaId }); } catch (e) {
      if (e.name === 'ZodError') return res.status(400).json({ errore: 'dati_non_validi' });
      throw e;
    }
    return ok ? res.json({ ok: true, salvato: new Date().toISOString() }) : res.status(404).json({ errore: 'non_trovata' });
  });
  api.get('/note/:id/export/:formato', async (req, res) => {
    const n = await note.leggi(req.utente.id, req.params.id);
    if (!n) return res.status(404).end();
    const lingua = req.query.lang === 'en' ? 'en' : 'it';
    const c = calcola(n);
    const nome = `nota-spese-${(n.titolo || 'nota').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || n.id}`;
    if (req.params.formato === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}.pdf"` });
      return exp.pdf(c, lingua).pipe(res);
    }
    if (req.params.formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}.xlsx"` });
      return res.send(Buffer.from(await exp.xlsx(c, lingua)));
    }
    res.status(404).end();
  });

  return { router: r, api, P };
};
