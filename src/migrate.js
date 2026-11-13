// Applica le migrazioni SQL in ordine; usato anche come pre-deploy su Railway (npm run migrate)
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const fatte = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (fatte.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`migrazione applicata: ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`migrazione ${f} fallita: ${e.message}`);
    } finally { c.release(); }
  }
}

if (require.main === module) migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
module.exports = { migrate };
