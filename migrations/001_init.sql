-- Tabelle ACI (costo chilometrico per modello) importate dai file ufficiali aci.gov.it
CREATE TABLE aci_veicoli (
  id BIGSERIAL PRIMARY KEY,
  anno INT NOT NULL,
  tabella TEXT NOT NULL,            -- es. Autoveicoli-BZ-IN
  categoria TEXT NOT NULL,          -- auto | moto | autocaravan
  alimentazione TEXT NOT NULL,      -- benzina | gasolio | gpl-metano | ibrida-benzina | ibrida-gasolio | plug-in | elettrica
  in_produzione BOOLEAN NOT NULL,
  marca TEXT NOT NULL,
  modello TEXT NOT NULL,
  serie TEXT,
  costo_km NUMERIC(8,4) NOT NULL,   -- euro/km (percorrenza 15.000 km annui)
  ricerca TEXT NOT NULL             -- testo normalizzato per la ricerca
);
CREATE INDEX aci_veicoli_anno ON aci_veicoli(anno);
CREATE INDEX aci_veicoli_ricerca ON aci_veicoli USING gin (to_tsvector('simple', ricerca));
CREATE INDEX aci_veicoli_marca ON aci_veicoli(anno, marca);

CREATE TABLE aci_import (
  anno INT NOT NULL,
  tabella TEXT NOT NULL,
  url TEXT NOT NULL,
  righe INT NOT NULL,
  importato_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (anno, tabella)
);

-- Prezzo medio nazionale dei carburanti (open data MIMIT, aggiornato ogni giorno)
CREATE TABLE carburanti_prezzi (
  giorno DATE NOT NULL,
  carburante TEXT NOT NULL,         -- benzina | gasolio | gpl | metano
  prezzo NUMERIC(6,3) NOT NULL,     -- euro/litro (euro/kg per metano), mediana self
  impianti INT NOT NULL,
  PRIMARY KEY (giorno, carburante)
);

-- Cache percorsi Google Routes (riduce costi API)
CREATE TABLE percorsi_cache (
  chiave TEXT PRIMARY KEY,
  risposta JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_log (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  esito TEXT NOT NULL,              -- ok | errore | nessuna-novita
  dettaglio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_log (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  messaggio TEXT,
  email_inviata BOOLEAN NOT NULL DEFAULT false,
  errore_invio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alert_log_tipo ON alert_log(tipo, created_at);
