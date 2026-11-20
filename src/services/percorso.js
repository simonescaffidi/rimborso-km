// Distanza via Google Routes API (computeRoutes, SKU Essentials). Pedaggi: Google non li copre per l'Italia.
// Cache 30 giorni su DB e tetto giornaliero di chiamate (ROUTES_MAX_GIORNO) per restare nella quota gratuita.
const crypto = require('crypto');
const db = require('../db');

const MAX_GIORNO = Number(process.env.ROUTES_MAX_GIORNO || 40);
let contatore = { giorno: '', n: 0 };

class PercorsoErrore extends Error { constructor(codice, msg) { super(msg); this.codice = codice; } }

const configurato = () => !!process.env.GOOGLE_MAPS_API_KEY;

function chiave(p) { return crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex'); }


async function calcola({ partenza, arrivo, tappe = [], alimentazione = 'benzina', evitaAutostrade = false }) {
  if (!configurato()) throw new PercorsoErrore('non_configurato', 'calcolo percorso non attivo');
  const p = { partenza: partenza.trim().toLowerCase(), arrivo: arrivo.trim().toLowerCase(), tappe: tappe.map((t) => t.trim().toLowerCase()), alimentazione, evitaAutostrade };
  const k = chiave(p);
  const { rows: [c] } = await db.query(`SELECT risposta FROM percorsi_cache WHERE chiave=$1 AND created_at > now() - interval '30 days'`, [k]);
  if (c) return { ...c.risposta, cache: true };

  const oggi = new Date().toISOString().slice(0, 10);
  if (contatore.giorno !== oggi) contatore = { giorno: oggi, n: 0 };
  if (contatore.n >= MAX_GIORNO) throw new PercorsoErrore('quota', 'quota giornaliera di calcoli esaurita');
  contatore.n++;

  const body = {
    origin: { address: partenza },
    destination: { address: arrivo },
    intermediates: tappe.filter(Boolean).map((address) => ({ address })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    // niente extraComputations TOLLS: Google non ha i prezzi dei pedaggi italiani e lo SKU costa di più
    routeModifiers: { avoidTolls: !!evitaAutostrade, avoidHighways: !!evitaAutostrade },
    languageCode: 'it-IT', regionCode: 'IT', units: 'METRIC',
  };
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || `HTTP ${r.status}`;
    if (r.status === 400 || r.status === 404) throw new PercorsoErrore('indirizzo', msg);
    throw new PercorsoErrore('google', msg);
  }
  const route = j.routes?.[0];
  if (!route) throw new PercorsoErrore('indirizzo', 'percorso non trovato');
  // il pedaggio resta manuale (ricevuta o estratto Telepass)
  const risposta = {
    km: Math.round((route.distanceMeters || 0) / 100) / 10,
    durataMin: Math.round(parseInt(route.duration || '0', 10) / 60),
    pedaggio: 0,
    pedaggioNoto: false,
    conPedaggi: false,
  };
  await db.query('INSERT INTO percorsi_cache (chiave,risposta) VALUES ($1,$2) ON CONFLICT (chiave) DO UPDATE SET risposta=EXCLUDED.risposta, created_at=now()', [k, risposta]);
  return risposta;
}

module.exports = { calcola, configurato, PercorsoErrore };
