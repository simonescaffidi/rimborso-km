// i18n IT/EN: t(chiave, variabili) lato server; il client riceve lo stesso dizionario in window.I18N
const it = require('../locales/it.json');
const en = require('../locales/en.json');
const D = { it, en };
function t(lingua, k, v = {}) {
  const s = (D[lingua] && D[lingua][k]) || it[k] || k;
  return s.replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));
}
// pagine con equivalente nell'altra lingua (per hreflang e switcher)
const PAGINE = {
  home: { it: '/', en: '/en/' },
  aci: { it: '/tabelle-aci', en: '/en/aci-tables' },
  manuale: { it: '/manuale', en: '/en/manual' },
  privacy: { it: '/privacy', en: '/en/privacy' },
  cookie: { it: '/cookie-policy', en: '/en/cookie-policy' },
};
module.exports = { t, D, PAGINE };
