-- Account utenti, aziende e note spese salvate (storico)
CREATE TABLE utenti (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  nome TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  lingua TEXT NOT NULL DEFAULT 'it',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_accesso TIMESTAMPTZ
);
CREATE UNIQUE INDEX utenti_email ON utenti (lower(email));

CREATE TABLE password_tokens (
  token_hash TEXT PRIMARY KEY,
  utente_id BIGINT NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  scade_at TIMESTAMPTZ NOT NULL,
  usato BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE aziende (
  id BIGSERIAL PRIMARY KEY,
  utente_id BIGINT NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  piva TEXT,
  indirizzo TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX aziende_utente ON aziende(utente_id);

CREATE TABLE note_spese (
  id BIGSERIAL PRIMARY KEY,
  utente_id BIGINT NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  azienda_id BIGINT REFERENCES aziende(id) ON DELETE SET NULL,
  titolo TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'bozza',           -- bozza | inviata | rimborsata
  intestatario TEXT NOT NULL DEFAULT '',
  targa TEXT NOT NULL DEFAULT '',
  metodo JSONB NOT NULL DEFAULT '{"tipo":"aci","costoKm":0}',
  alimentazione TEXT NOT NULL DEFAULT 'benzina',
  data_inizio DATE,                               -- prima trasferta (per filtri per anno)
  km_totali NUMERIC(10,1) NOT NULL DEFAULT 0,
  totale_cent BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX note_utente ON note_spese(utente_id, updated_at DESC);

CREATE TABLE trasferte (
  id BIGSERIAL PRIMARY KEY,
  nota_id BIGINT NOT NULL REFERENCES note_spese(id) ON DELETE CASCADE,
  utente_id BIGINT NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  ordine INT NOT NULL,
  data DATE,
  partenza TEXT NOT NULL DEFAULT '',
  arrivo TEXT NOT NULL DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',
  km NUMERIC(8,1) NOT NULL DEFAULT 0,
  andata_ritorno BOOLEAN NOT NULL DEFAULT false,
  evita_autostrade BOOLEAN NOT NULL DEFAULT false,
  pedaggio_cent INT NOT NULL DEFAULT 0,
  parcheggio_cent INT NOT NULL DEFAULT 0,
  vitto_cent INT NOT NULL DEFAULT 0,
  alloggio_cent INT NOT NULL DEFAULT 0,
  altro_cent INT NOT NULL DEFAULT 0
);
CREATE INDEX trasferte_nota ON trasferte(nota_id, ordine);
CREATE INDEX trasferte_utente_data ON trasferte(utente_id, data);

-- sessioni (connect-pg-simple)
CREATE TABLE sessioni (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX sessioni_expire ON sessioni(expire);

CREATE TABLE email_log (
  id BIGSERIAL PRIMARY KEY,
  destinatario TEXT NOT NULL,
  oggetto TEXT NOT NULL,
  esito TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
