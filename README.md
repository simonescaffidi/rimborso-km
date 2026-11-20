# rimborso-km

Calcolatore pubblico e gratuito della nota spese per chi usa l'auto propria per lavoro.

- **Tabelle ACI** ufficiali (costo €/km a 15.000 km annui) per marca e modello, importate in automatico da aci.gov.it
- **Distanze reali** con Google Routes API (cache 30 giorni, tetto giornaliero). Pedaggi inseriti a mano: Google non ha i prezzi dei pedaggi italiani
- **Prezzi carburante** medi nazionali dagli open data MIMIT, aggiornati ogni mattina
- Spese extra (parcheggio, vitto, alloggio), andata/ritorno, più trasferte
- Export **PDF** (pdfkit) ed **Excel** (exceljs); senza account nessun dato salvato sul server
- **Account facoltativo**: aziende/clienti, più note spese per azienda con salvataggio automatico, stati (bozza/inviata/rimborsata), storico e totali per azienda e anno, export e cancellazione dati (GDPR)
- Sito IT/EN, SEO, cookie banner GDPR, GA4 dopo consenso

## Aggiornamento automatico
| Dato | Job | Quando |
|---|---|---|
| Tabelle ACI | `jobAci` | ogni giorno 6:10; da novembre cerca anche l'anno successivo; alert se a fine gennaio l'anno in corso manca |
| Carburanti | `jobCarburanti` | ogni giorno 9:15 (MIMIT pubblica alle 8); alert se i dati superano 3 giorni |
| Km percorso | live | a ogni calcolo (Google) |

Fallback ACI se cambiano i percorsi dei file: `POST /admin/aci/:anno/:tabella` con il file xlsx come body (header `X-Admin-Token`).

## Sviluppo
```
cp .env.example .env
npm ci && npm run migrate && npm start
npm test
```
Stack: Node 20, Express 5, EJS, PostgreSQL (`pg`), migrazioni in `migrations/`. Deploy Railway da `main`.
