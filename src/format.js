// Helper unico date/valute (Europe/Rome)
const dataFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
const euroFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

const data = (d) => dataFmt.format(d instanceof Date ? d : new Date(d));
const euro = (centesimi) => euroFmt.format(centesimi / 100);
const euroKm = (v) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v);
// YYYY-MM-DD in ora italiana
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

module.exports = { data, euro, euroKm, oggiRoma };
