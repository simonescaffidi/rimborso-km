// Calcolo nota spese: funzioni pure, importi in centesimi interi.
const { z } = require('zod');

const num = z.coerce.number().finite().min(0).max(1e6);
const opz = num.optional().default(0);

const Trasferta = z.object({
  data: z.string().max(10).optional().default(''),
  partenza: z.string().max(200).optional().default(''),
  arrivo: z.string().max(200).optional().default(''),
  motivo: z.string().max(300).optional().default(''),
  km: num.max(20000),                 // km di sola andata
  andataRitorno: z.coerce.boolean().optional().default(false),
  pedaggio: opz,                      // euro sola andata
  parcheggio: opz,
  vitto: opz,
  alloggio: opz,
  altro: opz,
});

const Metodo = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('aci'), costoKm: num.max(10), veicolo: z.string().max(200).optional().default('') }),
  z.object({ tipo: z.literal('fisso'), costoKm: num.max(10) }),
  z.object({ tipo: z.literal('carburante'), consumo: num.max(50), prezzo: num.max(10), carburante: z.string().max(20).optional().default('') }),
]);

const Nota = z.object({
  intestatario: z.string().max(120).optional().default(''),
  azienda: z.string().max(120).optional().default(''),
  periodo: z.string().max(60).optional().default(''),
  targa: z.string().max(12).optional().default(''),
  metodo: Metodo,
  trasferte: z.array(Trasferta).min(1).max(200),
});

const cent = (euro) => Math.round(euro * 100);

// euro/km applicato secondo il metodo scelto
function tariffaKm(m) {
  if (m.tipo === 'carburante') return (m.consumo / 100) * m.prezzo;
  return m.costoKm;
}

function calcola(input) {
  const nota = Nota.parse(input);
  const tariffa = tariffaKm(nota.metodo);
  const righe = nota.trasferte.map((t) => {
    const molt = t.andataRitorno ? 2 : 1;
    const km = Math.round(t.km * molt * 10) / 10;
    const rimborsoKm = cent(km * tariffa);
    const pedaggi = cent(t.pedaggio * molt);
    const extra = cent(t.parcheggio) + cent(t.vitto) + cent(t.alloggio) + cent(t.altro);
    return { ...t, kmTotali: km, rimborsoKm, pedaggi, extra, totale: rimborsoKm + pedaggi + extra };
  });
  const somma = (k) => righe.reduce((s, r) => s + r[k], 0);
  return {
    ...nota,
    tariffaKm: Math.round(tariffa * 10000) / 10000,
    righe,
    totali: {
      km: Math.round(righe.reduce((s, r) => s + r.kmTotali, 0) * 10) / 10,
      rimborsoKm: somma('rimborsoKm'),
      pedaggi: somma('pedaggi'),
      extra: somma('extra'),
      totale: somma('totale'),
    },
  };
}

module.exports = { calcola, tariffaKm, Nota };
