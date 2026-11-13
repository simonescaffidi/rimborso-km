# rimborso-km – regole progetto
- Segue la skill `stack-standard` di Simone (Express 5 + EJS + Postgres, Brevo, alert, /health, IT/EN) e `sito-web-standard`.
- Slug unico: GitHub `simonescaffidi/rimborso-km` (PUBBLICO, deve restare pubblico), Railway `rimborso-km`, Drive `Claude/rimborso-km`.
- Nessun dato utente salvato: le trasferte restano nel browser; il server calcola ed esporta.
- Ogni nuova funzione: aggiornare `views/manuale.ejs` (IT/EN), FAQ in home e README.
- Parser ACI in `src/services/aci.js`: se ACI cambia formato, aggiungere un test in `test/parser.test.js` con il nuovo layout.
- Importi sempre in centesimi interi (`src/services/calcolo.js`).
