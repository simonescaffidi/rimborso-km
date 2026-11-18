// Note spese salvate: aziende, note e trasferte dell'utente (sempre filtrate per utente_id)
const { z } = require('zod');
const db = require('../db');
const { calcola } = require('./calcolo');

const STATI = ['bozza', 'inviata', 'rimborsata'];
const ALIM = ['benzina', 'gasolio', 'gpl-metano', 'ibrida-benzina', 'ibrida-gasolio', 'plug-in', 'elettrica'];

const Azienda = z.object({
  nome: z.string().trim().min(1).max(120),
  piva: z.string().trim().max(20).optional().default(''),
  indirizzo: z.string().trim().max(200).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
});

const id = z.coerce.number().int().positive();
const idOpz = z.union([id, z.literal(''), z.null()]).optional().transform((v) => (v ? Number(v) : null));

// ---------- aziende ----------
const aziende = (uid) => db.query('SELECT id, nome, piva, indirizzo, note FROM aziende WHERE utente_id=$1 ORDER BY lower(nome)', [uid]).then((r) => r.rows);

async function creaAzienda(uid, dati) {
  const a = Azienda.parse(dati);
  const { rows: [r] } = await db.query('INSERT INTO aziende (utente_id, nome, piva, indirizzo, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [uid, a.nome, a.piva, a.indirizzo, a.note]);
  return r.id;
}
async function modificaAzienda(uid, aid, dati) {
  const a = Azienda.parse(dati);
  const r = await db.query('UPDATE aziende SET nome=$3, piva=$4, indirizzo=$5, note=$6 WHERE id=$2 AND utente_id=$1', [uid, id.parse(aid), a.nome, a.piva, a.indirizzo, a.note]);
  return r.rowCount > 0;
}
async function eliminaAzienda(uid, aid) {
  const r = await db.query('DELETE FROM aziende WHERE id=$2 AND utente_id=$1', [uid, id.parse(aid)]);
  return r.rowCount > 0;
}
async function aziendaDiUtente(uid, aid) {
  if (!aid) return null;
  const { rows: [a] } = await db.query('SELECT id, nome FROM aziende WHERE id=$2 AND utente_id=$1', [uid, aid]);
  return a || null;
}

// ---------- note ----------
const Filtri = z.object({
  azienda: z.coerce.number().int().positive().optional().catch(undefined),
  anno: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  stato: z.enum(STATI).optional().catch(undefined),
});

async function elenco(uid, filtri = {}) {
  const f = Filtri.parse(filtri);
  const cond = ['n.utente_id=$1']; const p = [uid];
  if (f.azienda) { p.push(f.azienda); cond.push(`n.azienda_id=$${p.length}`); }
  if (f.anno) { p.push(f.anno); cond.push(`extract(year from coalesce(n.data_inizio, n.created_at::date))=$${p.length}`); }
  if (f.stato) { p.push(f.stato); cond.push(`n.stato=$${p.length}`); }
  const { rows } = await db.query(`SELECT n.id, n.titolo, n.stato, n.azienda_id, a.nome AS azienda, n.km_totali::float AS km, n.totale_cent::int AS totale,
      n.data_inizio, n.updated_at, (SELECT count(*)::int FROM trasferte t WHERE t.nota_id=n.id AND (t.km>0 OR t.partenza<>'')) AS trasferte
    FROM note_spese n LEFT JOIN aziende a ON a.id=n.azienda_id WHERE ${cond.join(' AND ')} ORDER BY coalesce(n.data_inizio, n.created_at::date) DESC, n.id DESC LIMIT 500`, p);
  return rows;
}

// totali per azienda e anno (storico)
async function riepilogo(uid) {
  const { rows } = await db.query(`SELECT extract(year from coalesce(n.data_inizio, n.created_at::date))::int AS anno, a.nome AS azienda,
      count(*)::int AS note, sum(n.km_totali)::float AS km, sum(n.totale_cent)::bigint::float AS totale,
      sum(CASE WHEN n.stato='rimborsata' THEN n.totale_cent ELSE 0 END)::bigint::float AS rimborsato
    FROM note_spese n LEFT JOIN aziende a ON a.id=n.azienda_id WHERE n.utente_id=$1
    GROUP BY 1, 2 ORDER BY 1 DESC, 2`, [uid]);
  return rows;
}

const anni = (uid) => db.query(`SELECT DISTINCT extract(year from coalesce(data_inizio, created_at::date))::int AS anno FROM note_spese WHERE utente_id=$1 ORDER BY 1 DESC`, [uid]).then((r) => r.rows.map((x) => x.anno));

async function crea(uid, { titolo, aziendaId, payload, intestatario = '' }) {
  const az = await aziendaDiUtente(uid, aziendaId);
  const t = z.string().trim().min(1).max(120).catch('').parse(titolo) || 'Nota spese';
  const { rows: [r] } = await db.query('INSERT INTO note_spese (utente_id, azienda_id, titolo, intestatario) VALUES ($1,$2,$3,$4) RETURNING id', [uid, az ? az.id : null, t, intestatario]);
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const base = payload || { intestatario, metodo: { tipo: 'aci', costoKm: 0 }, trasferte: [{ data: oggi, km: 0, andataRitorno: true }] };
  if (!base.intestatario) base.intestatario = intestatario;
  await salva(uid, r.id, base, { titolo: t, aziendaId: az ? az.id : null });
  return r.id;
}

const cent = (e) => Math.round(Number(e || 0) * 100);
const dataValida = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);

// salva il contenuto del calcolatore nella nota (sostituisce le trasferte)
async function salva(uid, notaId, payload, extra = {}) {
  const n = calcola(payload);
  const nid = id.parse(notaId);
  const { rows: [esiste] } = await db.query('SELECT id FROM note_spese WHERE id=$1 AND utente_id=$2', [nid, uid]);
  if (!esiste) return false;
  const az = extra.aziendaId !== undefined ? await aziendaDiUtente(uid, idOpz.parse(extra.aziendaId)) : undefined;
  const alim = ALIM.includes(payload.alimentazione) ? payload.alimentazione : 'benzina';
  const date = n.righe.map((r) => dataValida(r.data)).filter(Boolean).sort();
  await db.tx(async (c) => {
    await c.query(`UPDATE note_spese SET intestatario=$3, targa=$4, metodo=$5, alimentazione=$6, data_inizio=$7, km_totali=$8, totale_cent=$9, updated_at=now()
      ${extra.titolo ? ', titolo=$10' : ''} ${az !== undefined ? `, azienda_id=$${extra.titolo ? 11 : 10}` : ''}
      WHERE id=$1 AND utente_id=$2`,
    [nid, uid, n.intestatario, n.targa, JSON.stringify(n.metodo), alim, date[0] || null, n.totali.km, n.totali.totale,
      ...(extra.titolo ? [String(extra.titolo).slice(0, 120)] : []), ...(az !== undefined ? [az ? az.id : null] : [])]);
    await c.query('DELETE FROM trasferte WHERE nota_id=$1', [nid]);
    for (const [i, r] of n.trasferte.entries()) {
      await c.query(`INSERT INTO trasferte (nota_id, utente_id, ordine, data, partenza, arrivo, motivo, km, andata_ritorno, evita_autostrade,
          pedaggio_cent, parcheggio_cent, vitto_cent, alloggio_cent, altro_cent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [nid, uid, i, dataValida(r.data), r.partenza, r.arrivo, r.motivo, r.km, r.andataRitorno, !!(payload.trasferte[i] && payload.trasferte[i].evita),
        cent(r.pedaggio), cent(r.parcheggio), cent(r.vitto), cent(r.alloggio), cent(r.altro)]);
    }
  });
  return true;
}

// nota nel formato del calcolatore
async function leggi(uid, notaId) {
  const nid = id.safeParse(notaId);
  if (!nid.success) return null;
  const { rows: [n] } = await db.query(`SELECT n.*, a.nome AS azienda_nome FROM note_spese n LEFT JOIN aziende a ON a.id=n.azienda_id WHERE n.id=$1 AND n.utente_id=$2`, [nid.data, uid]);
  if (!n) return null;
  const { rows: tr } = await db.query('SELECT * FROM trasferte WHERE nota_id=$1 ORDER BY ordine', [n.id]);
  const iso = (d) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d) : '');
  return {
    id: Number(n.id), titolo: n.titolo, stato: n.stato, aziendaId: n.azienda_id ? Number(n.azienda_id) : null, azienda: n.azienda_nome || '',
    intestatario: n.intestatario, targa: n.targa, periodo: n.titolo, metodo: n.metodo, alimentazione: n.alimentazione,
    trasferte: tr.map((t) => ({
      data: iso(t.data), partenza: t.partenza, arrivo: t.arrivo, motivo: t.motivo, km: Number(t.km), andataRitorno: t.andata_ritorno, evita: t.evita_autostrade,
      pedaggio: t.pedaggio_cent / 100, parcheggio: t.parcheggio_cent / 100, vitto: t.vitto_cent / 100, alloggio: t.alloggio_cent / 100, altro: t.altro_cent / 100,
    })),
  };
}

async function cambiaStato(uid, notaId, stato) {
  if (!STATI.includes(stato)) return false;
  const r = await db.query('UPDATE note_spese SET stato=$3, updated_at=now() WHERE id=$1 AND utente_id=$2', [id.parse(notaId), uid, stato]);
  return r.rowCount > 0;
}
async function elimina(uid, notaId) {
  const r = await db.query('DELETE FROM note_spese WHERE id=$1 AND utente_id=$2', [id.parse(notaId), uid]);
  return r.rowCount > 0;
}
async function duplica(uid, notaId) {
  const n = await leggi(uid, notaId);
  if (!n) return null;
  return crea(uid, { titolo: `${n.titolo} (copia)`, aziendaId: n.aziendaId, payload: n, intestatario: n.intestatario });
}

// export completo dei dati dell'utente (GDPR art. 20)
async function esportaTutto(uid) {
  const { rows: [u] } = await db.query('SELECT email, nome, lingua, created_at FROM utenti WHERE id=$1', [uid]);
  const note = [];
  for (const n of await elenco(uid)) note.push(await leggi(uid, n.id));
  return { utente: u, aziende: await aziende(uid), note };
}

module.exports = { STATI, aziende, creaAzienda, modificaAzienda, eliminaAzienda, elenco, riepilogo, anni, crea, salva, leggi, cambiaStato, elimina, duplica, esportaTutto };
