const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const db = require('./db');
const { alert, installaGestoriProcesso } = require('./alert');
const { t, D, PAGINE } = require('./i18n');
const { calcola } = require('./services/calcolo');
const percorso = require('./services/percorso');
const carburanti = require('./services/carburanti');
const aci = require('./services/aci');
const exp = require('./services/export');
const jobs = require('./jobs');
const fmt = require('./format');

const PROD = process.env.NODE_ENV === 'production';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// /health prima di tutto
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
      connectSrc: ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
      imgSrc: ["'self'", 'data:', 'https://*.google-analytics.com', 'https://www.googletagmanager.com'],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '300kb' }));
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets'), { maxAge: PROD ? '7d' : 0 }));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/assets/favicon.svg'));

// ---------- pagine ----------
const stato = async () => {
  const anno = await aci.annoCorrenteDati().catch(() => null);
  const fuel = await carburanti.ultimi().catch(() => []);
  return { anno, fuel, routes: percorso.configurato() };
};

function render(res, vista, lingua, chiave, extra = {}) {
  const tt = (k, v) => t(lingua, k, v);
  res.render(vista, {
    lingua, t: tt, pagina: chiave, PAGINE, PUBLIC_URL, fmt,
    ga4: process.env.GA4_ID || '', gsc: process.env.GSC_VERIFICATION || '',
    noindex: process.env.NOINDEX === '1',
    i18nClient: JSON.stringify(D[lingua]).replace(/</g, '\\u003c'),
    ...extra,
  });
}

for (const lingua of ['it', 'en']) {
  app.get(PAGINE.home[lingua], async (req, res) => render(res, 'home', lingua, 'home', { st: await stato() }));
  app.get(PAGINE.manuale[lingua], async (req, res) => render(res, 'manuale', lingua, 'manuale', { st: await stato() }));
  app.get(PAGINE.privacy[lingua], (req, res) => render(res, 'privacy', lingua, 'privacy'));
  app.get(PAGINE.cookie[lingua], (req, res) => render(res, 'cookie', lingua, 'cookie'));
  app.get(PAGINE.aci[lingua], async (req, res) => {
    const st = await stato();
    const q = String(req.query.q || '').slice(0, 60);
    const marca = String(req.query.marca || '').slice(0, 60);
    const { rows: marche } = st.anno ? await db.query('SELECT DISTINCT marca FROM aci_veicoli WHERE anno=$1 AND categoria=$2 ORDER BY marca', [st.anno, 'auto']) : { rows: [] };
    const risultati = st.anno && (q || marca) ? await cerca({ q, marca, anno: st.anno, limite: 300 }) : [];
    render(res, 'aci', lingua, 'aci', { st, q, marca, marche: marche.map((m) => m.marca), risultati });
  });
}
app.get('/en', (req, res) => res.redirect(301, '/en/'));

app.get('/robots.txt', (req, res) => res.type('text/plain').send(process.env.NOINDEX === '1' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /api/\nDisallow: /admin/\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = Object.values(PAGINE).map((p) => `<url><loc>${PUBLIC_URL}${p.it}</loc><xhtml:link rel="alternate" hreflang="it" href="${PUBLIC_URL}${p.it}"/><xhtml:link rel="alternate" hreflang="en" href="${PUBLIC_URL}${p.en}"/></url><url><loc>${PUBLIC_URL}${p.en}</loc><xhtml:link rel="alternate" hreflang="it" href="${PUBLIC_URL}${p.it}"/><xhtml:link rel="alternate" hreflang="en" href="${PUBLIC_URL}${p.en}"/></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`);
});

// ---------- API ----------
const limiteApi = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const limitePercorso = rateLimit({ windowMs: 3600_000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false, message: { errore: 'troppe_richieste' } });
app.use('/api', limiteApi);

async function cerca({ q = '', marca = '', anno, limite = 30 }) {
  const parole = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const cond = ['anno=$1']; const p = [anno];
  parole.forEach((w) => { p.push(`%${w.replace(/[%_\\]/g, '')}%`); cond.push(`ricerca LIKE $${p.length}`); });
  if (marca) { p.push(marca); cond.push(`marca=$${p.length}`); }
  p.push(limite);
  const { rows } = await db.query(`SELECT id, marca, modello, serie, alimentazione, categoria, in_produzione, costo_km::float AS costo_km
    FROM aci_veicoli WHERE ${cond.join(' AND ')} ORDER BY in_produzione DESC, marca, modello, serie LIMIT $${p.length}`, p);
  return rows;
}

app.get('/api/aci/cerca', async (req, res) => {
  const q = z.string().max(60).catch('').parse(req.query.q);
  const anno = await aci.annoCorrenteDati();
  if (!anno || q.trim().length < 2) return res.json({ anno, risultati: [] });
  res.json({ anno, risultati: await cerca({ q, anno }) });
});

app.get('/api/stato', async (req, res) => res.json(await stato()));

const PercorsoIn = z.object({
  partenza: z.string().trim().min(2).max(200),
  arrivo: z.string().trim().min(2).max(200),
  tappe: z.array(z.string().max(200)).max(5).optional().default([]),
  alimentazione: z.string().max(20).optional().default('benzina'),
  evitaAutostrade: z.boolean().optional().default(false),
});
app.post('/api/percorso', limitePercorso, async (req, res) => {
  const p = PercorsoIn.safeParse(req.body);
  if (!p.success) return res.status(400).json({ errore: 'dati_non_validi' });
  try {
    res.json(await percorso.calcola(p.data));
  } catch (e) {
    if (e instanceof percorso.PercorsoErrore) {
      if (e.codice === 'google') alert('google-routes', e);
      const status = { non_configurato: 503, quota: 429, indirizzo: 422, google: 502 }[e.codice] || 500;
      return res.status(status).json({ errore: e.codice });
    }
    throw e;
  }
});

app.post('/api/calcola', (req, res) => {
  const r = (() => { try { return calcola(req.body); } catch { return null; } })();
  if (!r) return res.status(400).json({ errore: 'dati_non_validi' });
  res.json(r);
});

app.post('/api/export/:formato', async (req, res) => {
  const lingua = req.query.lang === 'en' ? 'en' : 'it';
  let n;
  try { n = calcola(req.body); } catch { return res.status(400).json({ errore: 'dati_non_validi' }); }
  const nome = `nota-spese-${fmt.oggiRoma()}`;
  if (req.params.formato === 'pdf') {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}.pdf"` });
    exp.pdf(n, lingua).pipe(res);
  } else if (req.params.formato === 'xlsx') {
    const buf = await exp.xlsx(n, lingua);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}.xlsx"` });
    res.send(Buffer.from(buf));
  } else res.status(404).end();
});

// ---------- amministrazione (token) ----------
function tokenOk(req) {
  const tok = process.env.ADMIN_TOKEN || '';
  const h = String(req.get('x-admin-token') || '');
  return tok.length >= 32 && h.length === tok.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(tok));
}
const limiteAdmin = rateLimit({ windowMs: 3600_000, limit: 20 });
app.use('/admin', limiteAdmin, (req, res, next) => (tokenOk(req) ? next() : res.status(401).end()));
app.post('/admin/alert-test', async (req, res) => res.json(await alert(`test-${Date.now()}`, new Error('Prova manuale del sistema di alert (nessun problema reale)'))));
app.post('/admin/aggiorna/:job', async (req, res) => {
  if (req.params.job === 'aci') return res.json(await jobs.jobAci());
  if (req.params.job === 'carburanti') return res.json(await jobs.jobCarburanti());
  res.status(404).end();
});
app.get('/admin/aci-anteprima/:anno/:tabella', async (req, res) => res.json(await aci.anteprima(req.params.tabella, Number(req.params.anno), Math.min(Number(req.query.righe) || 8, 40))));
// fallback: upload manuale di un file ACI (body = xlsx)
app.post('/admin/aci/:anno/:tabella', express.raw({ type: '*/*', limit: '15mb' }), async (req, res) => {
  const n = await aci.importaFile(Number(req.params.anno), req.params.tabella, req.body);
  res.json({ righe: n });
});

// ---------- errori ----------
app.use((req, res) => res.status(404).render('404', { lingua: req.path.startsWith('/en/') ? 'en' : 'it', t: (k, v) => t(req.path.startsWith('/en/') ? 'en' : 'it', k, v), PAGINE, pagina: 'home', PUBLIC_URL, ga4: process.env.GA4_ID || '', gsc: '', noindex: true }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ errore: 'richiesta_non_valida' });
  alert('http-500', err, { percorso: req.path, metodo: req.method });
  res.status(500).json({ errore: 'errore_interno' });
});

if (require.main === module) {
  installaGestoriProcesso();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => { console.log(`rimborso-km in ascolto su :${port}`); jobs.avvia(); });
}

module.exports = app;
