// Prezzi medi carburanti dagli open data MIMIT (Osservaprezzi), file aggiornato ogni mattina alle 8.
// Formato: prima riga "Estrazione del AAAA-MM-GG", poi intestazione idImpianto|descCarburante|prezzo|isSelf|dtComu
const db = require('../db');
const { oggiRoma } = require('../format');

const URL = process.env.MIMIT_PREZZI_URL || 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';

function classifica(desc) {
  const d = desc.toLowerCase();
  if (/metano|gnc|cng|gnl|lng/.test(d)) return /gnl|lng/.test(d) ? null : 'metano';
  if (/gpl/.test(d)) return 'gpl';
  if (/gasolio|diesel|blue ?diesel|hvo/.test(d)) return /speciale|premium|hvo|blue|plus|excellium|supreme|\+/.test(d) ? null : 'gasolio';
  if (/benzina|super/.test(d)) return /speciale|plus|premium|100|98|excellium|v-power|\+/.test(d) ? null : 'benzina';
  return null;
}

const mediana = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function parse(testo) {
  const righe = testo.split(/\r?\n/).filter(Boolean);
  const iHead = righe.findIndex((r) => /desccarburante/i.test(r));
  if (iHead < 0) throw new Error('intestazione MIMIT non trovata');
  const sep = righe[iHead].includes('|') ? '|' : ';';
  const head = righe[iHead].split(sep).map((h) => h.trim().toLowerCase());
  const iDesc = head.indexOf('desccarburante'); const iPrezzo = head.indexOf('prezzo'); const iSelf = head.indexOf('isself');
  const prezzi = { benzina: [], gasolio: [], gpl: [], metano: [] };
  for (const r of righe.slice(iHead + 1)) {
    const c = r.split(sep);
    const tipo = classifica(c[iDesc] || '');
    if (!tipo) continue;
    const p = Number(String(c[iPrezzo]).replace(',', '.'));
    const self = String(c[iSelf]).trim() === '1';
    // benzina/gasolio: solo self; gpl/metano: quasi sempre serviti, si prendono tutti
    if ((tipo === 'benzina' || tipo === 'gasolio') && !self) continue;
    if (p > 0.3 && p < 5) prezzi[tipo].push(p);
  }
  const out = {};
  for (const [k, v] of Object.entries(prezzi)) if (v.length >= 20) out[k] = { prezzo: Math.round(mediana(v) * 1000) / 1000, impianti: v.length };
  if (!out.benzina || !out.gasolio) throw new Error('dati benzina/gasolio insufficienti');
  const m = /(\d{4}-\d{2}-\d{2})/.exec(righe[0]);
  return { giorno: m ? m[1] : oggiRoma(), prezzi: out };
}

async function aggiorna() {
  const r = await fetch(URL, { headers: { 'User-Agent': 'rimborso-km (info@simonescaffidi.it)' }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`MIMIT HTTP ${r.status}`);
  const { giorno, prezzi } = parse(await r.text());
  for (const [carb, v] of Object.entries(prezzi)) {
    await db.query(`INSERT INTO carburanti_prezzi (giorno,carburante,prezzo,impianti) VALUES ($1,$2,$3,$4)
      ON CONFLICT (giorno,carburante) DO UPDATE SET prezzo=EXCLUDED.prezzo, impianti=EXCLUDED.impianti`, [giorno, carb, v.prezzo, v.impianti]);
  }
  return { giorno, prezzi };
}

async function ultimi() {
  const { rows } = await db.query(`SELECT DISTINCT ON (carburante) carburante, prezzo::float, giorno FROM carburanti_prezzi ORDER BY carburante, giorno DESC`);
  return rows;
}

module.exports = { parse, classifica, aggiorna, ultimi };
