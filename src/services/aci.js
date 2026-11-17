// Tabelle ACI: download dei file Excel ufficiali (aci.gov.it), parsing e import nel DB.
// Le tabelle dell'anno N escono in Gazzetta Ufficiale a dicembre dell'anno N-1: il job le cerca ogni giorno
// da novembre a febbraio e una volta a settimana nel resto dell'anno.
const ExcelJS = require('exceljs');
const db = require('../db');

// Nome file ufficiale (senza "-ANNO.xlsx") → metadati
const TABELLE = [
  ['Autoveicoli-BZ-IN', 'auto', 'benzina', true],
  ['Autoveicoli-GA-IN', 'auto', 'gasolio', true],
  ['Autoveicoli-BZ-GPL-e-IBR-BZ-GPL-IN', 'auto', 'gpl-metano', true],
  ['Autoveicoli-IBR-BZ-IN', 'auto', 'ibrida-benzina', true],
  ['Autoveicoli-IBR-GA-IN', 'auto', 'ibrida-gasolio', true],
  ['Autoveicoli-Plug-in-IN', 'auto', 'plug-in', true],
  ['Autoveicoli-ELETTR-IN', 'auto', 'elettrica', true],
  ['Autoveicoli-BZ-OUT', 'auto', 'benzina', false],
  ['Autoveicoli-GA-OUT', 'auto', 'gasolio', false],
  ['Autoveicoli-BZ-GPL-METANO-OUT', 'auto', 'gpl-metano', false],
  ['Autoveicoli-IBR-BZ-OUT', 'auto', 'ibrida-benzina', false],
  ['Autoveicoli-IBR-GA-OUT', 'auto', 'ibrida-gasolio', false],
  ['Autoveicoli-Plug-in-OUT', 'auto', 'plug-in', false],
  ['Autoveicoli-ELETTR-OUT', 'auto', 'elettrica', false],
  ['Motoveicoli', 'moto', 'benzina', true],
  ['Autocaravan', 'autocaravan', 'gasolio', true],
].map(([nome, categoria, alimentazione, inProduzione]) => ({ nome, categoria, alimentazione, inProduzione }));

const BASE = process.env.ACI_BASE_URL || 'https://aci.gov.it/app/uploads';

// URL candidati per una tabella di un anno: il file viene caricato a nov/dic dell'anno prima o a gennaio
function urlCandidati(nome, anno) {
  const mesi = [`${anno - 1}/12`, `${anno - 1}/11`, `${anno}/01`, `${anno}/02`];
  return mesi.map((m) => `${BASE}/${m}/${nome}-${anno}.xlsx`);
}

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const testoCella = (c) => {
  const v = c && c.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.text) return String(v.text);
  }
  return String(v);
};
const numero = (s) => {
  if (typeof s === 'number') return s;
  const t = String(s).replace(/[€\s]/g, '');
  if (!t) return NaN;
  // formato italiano 0,4512 o 1.234,56
  const n = /,/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return n;
};

// Individua riga di intestazione e colonne (marca, modello, serie, costo km 15.000)
function trovaColonne(ws) {
  const max = Math.min(ws.rowCount, 25);
  for (let r = 1; r <= max; r++) {
    const row = ws.getRow(r);
    const next = ws.getRow(r + 1);
    const heads = [];
    const n = Math.max(row.cellCount, next.cellCount, 1);
    for (let c = 1; c <= n; c++) heads[c] = `${norm(testoCella(row.getCell(c)))} ${norm(testoCella(next.getCell(c)))}`.trim().toLowerCase();
    const marca = heads.findIndex((h) => h && /^marca\b|\bmarca\b/.test(h));
    const modello = heads.findIndex((h) => h && /modello/.test(h));
    if (marca < 1 || modello < 1) continue;
    const serie = heads.findIndex((h) => h && /serie|versione|allestimento/.test(h));
    const costi = heads.map((h, i) => (h && /costo/.test(h) && !/fringe|benefit/.test(h) ? i : -1)).filter((i) => i > 0);
    let costo = costi.find((i) => /15[. ]?000/.test(heads[i])) || costi[0];
    if (!costo) {
      // ultima risorsa: prima colonna numerica a destra di modello/serie con valori tra 0,05 e 5 €/km
      const start = Math.max(modello, serie) + 1;
      for (let c = start; c <= n && !costo; c++) {
        const v = numero(testoCella(ws.getRow(r + 2).getCell(c)));
        if (v > 0.05 && v < 5) costo = c;
      }
    }
    if (!costo) continue;
    const doppia = /costo|serie|modello/.test(`${norm(testoCella(next.getCell(costo)))}`.toLowerCase()) ? 1 : 0;
    return { rigaDati: r + 1 + doppia, marca, modello, serie: serie > 0 ? serie : null, costo };
  }
  throw new Error('intestazione non riconosciuta (colonne Marca/Modello/Costo km non trovate)');
}

async function parse(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  for (const ws of wb.worksheets) {
    let col;
    try { col = trovaColonne(ws); } catch (e) { if (wb.worksheets.length === 1) throw e; continue; }
    let marcaCorr = '';
    for (let r = col.rigaDati; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const marca = norm(testoCella(row.getCell(col.marca))) || marcaCorr;
      const modello = norm(testoCella(row.getCell(col.modello)));
      const serie = col.serie ? norm(testoCella(row.getCell(col.serie))) : '';
      const costo = numero(testoCella(row.getCell(col.costo)));
      if (!marca || !modello || !(costo > 0.01 && costo < 20)) continue;
      marcaCorr = marca;
      out.push({ marca, modello, serie: serie || null, costoKm: Math.round(costo * 10000) / 10000 });
    }
  }
  if (out.length < 5) throw new Error(`troppe poche righe valide (${out.length})`);
  return out;
}

async function scarica(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'rimborso-km (aggiornamento tabelle ACI; info@simonescaffidi.it)' }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 2).toString() !== 'PK') return null; // pagina di errore, non xlsx
  return buf;
}

async function salva(anno, t, url, righe) {
  await db.tx(async (c) => {
    await c.query('DELETE FROM aci_veicoli WHERE anno=$1 AND tabella=$2', [anno, t.nome]);
    const chunk = 500;
    for (let i = 0; i < righe.length; i += chunk) {
      const part = righe.slice(i, i + chunk);
      const vals = [];
      const params = [];
      part.forEach((v, j) => {
        const b = j * 10;
        vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
        params.push(anno, t.nome, t.categoria, t.alimentazione, t.inProduzione, v.marca, v.modello, v.serie, v.costoKm,
          `${v.marca} ${v.modello} ${v.serie || ''}`.toLowerCase());
      });
      await c.query(`INSERT INTO aci_veicoli (anno,tabella,categoria,alimentazione,in_produzione,marca,modello,serie,costo_km,ricerca) VALUES ${vals.join(',')}`, params);
    }
    await c.query(`INSERT INTO aci_import (anno,tabella,url,righe) VALUES ($1,$2,$3,$4)
      ON CONFLICT (anno,tabella) DO UPDATE SET url=EXCLUDED.url, righe=EXCLUDED.righe, importato_at=now()`, [anno, t.nome, url, righe.length]);
  });
}

// Importa le tabelle di un anno non ancora presenti. Ritorna { importate, mancanti, errori }
async function aggiornaAnno(anno, { forza = false } = {}) {
  const { rows } = await db.query('SELECT tabella FROM aci_import WHERE anno=$1', [anno]);
  const presenti = new Set(rows.map((r) => r.tabella));
  const esito = { anno, importate: [], mancanti: [], errori: [] };
  for (const t of TABELLE) {
    if (presenti.has(t.nome) && !forza) continue;
    let trovato = false;
    for (const url of urlCandidati(t.nome, anno)) {
      try {
        const buf = await scarica(url);
        if (!buf) continue;
        const righe = await parse(buf);
        await salva(anno, t, url, righe);
        esito.importate.push(`${t.nome} (${righe.length})`);
        trovato = true;
        break;
      } catch (e) { esito.errori.push(`${t.nome}: ${e.message}`); trovato = true; break; }
    }
    if (!trovato) esito.mancanti.push(t.nome);
  }
  return esito;
}

// Import manuale da file (fallback se il sito ACI cambia percorsi)
async function importaFile(anno, nomeTabella, buffer, url = 'upload manuale') {
  const t = TABELLE.find((x) => x.nome === nomeTabella);
  if (!t) throw new Error('tabella sconosciuta');
  const righe = await parse(buffer);
  await salva(anno, t, url, righe);
  return righe.length;
}

// Diagnostica: prime righe grezze del file ufficiale (per adeguare il parser se ACI cambia formato)
async function anteprima(nome, anno, righe = 8) {
  for (const url of urlCandidati(nome, anno)) {
    const buf = await scarica(url);
    if (!buf) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return { url, fogli: wb.worksheets.map((ws) => ({ nome: ws.name, righe: ws.rowCount,
      anteprima: Array.from({ length: Math.min(righe, ws.rowCount) }, (_, i) => ws.getRow(i + 1).values.slice(1).map((c) => testoCella({ value: c }))) })) };
  }
  return null;
}

async function annoCorrenteDati() {
  const { rows: [r] } = await db.query('SELECT max(anno) AS anno FROM aci_import');
  return r.anno ? Number(r.anno) : null;
}

module.exports = { anteprima, TABELLE, urlCandidati, parse, trovaColonne, aggiornaAnno, importaFile, annoCorrenteDati };
