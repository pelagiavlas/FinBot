/**
 * FinBot API — Express + PostgreSQL (Railway)
 *
 * Απαιτείται: process.env.DATABASE_URL (από το plugin PostgreSQL του Railway,
 * με «σύνδεση» της βάσης στο ίδιο service που τρέχει αυτό το app).
 *
 * Θύρα: process.env.PORT || 3847
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3847;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !String(DATABASE_URL).trim()) {
  console.error(
    'FATAL: Λείπει η DATABASE_URL. Στο Railway: πρόσθεσε PostgreSQL και σύνδεσέ το στο service ώστε να εμφανιστεί η μεταβλητή.'
  );
  process.exit(1);
}

/** Τοπική ανάπτυξη συνήθως χωρίς SSL· στο Railway/cloud συχνά απαιτείται TLS. */
function poolOptionsFromUrl(url) {
  const u = String(url);
  const isLocal =
    /localhost/i.test(u) ||
    /127\.0\.0\.1/.test(u) ||
    /\.internal:\d+/.test(u); // εσωτερικό δίκτυο Railway — χωρίς υποχρεωτικό SSL client
  return {
    connectionString: u,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  };
}

const pool = new Pool(poolOptionsFromUrl(DATABASE_URL));

const INSERT_SQL = `
  INSERT INTO entries (
    session_id, ts, experimental_condition, error_timing, show_conf,
    category, field, value_json, detail_json
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id
`;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      ts TEXT,
      experimental_condition INTEGER,
      error_timing TEXT,
      show_conf INTEGER,
      category TEXT,
      field TEXT,
      value_json TEXT,
      detail_json TEXT
    )
  `);
}

function normalizeRow(body) {
  const sessionId = body.sessionId ?? body.session_id;
  if (!sessionId) throw new Error('missing sessionId');

  const cond =
    body.experimental_condition !== undefined && body.experimental_condition !== null
      ? Number(body.experimental_condition)
      : null;
  const showConf = body.show_conf ? 1 : 0;

  return {
    session_id: String(sessionId),
    ts: String(body.ts || new Date().toISOString()),
    experimental_condition: Number.isFinite(cond) ? cond : null,
    error_timing: body.error_timing != null ? String(body.error_timing) : null,
    show_conf: showConf,
    category: String(body.category || ''),
    field: String(body.field || ''),
    value_json:
      body.value === undefined || body.value === null
        ? null
        : JSON.stringify(body.value),
    detail_json:
      body.detail === undefined || body.detail === null
        ? null
        : JSON.stringify(body.detail),
  };
}

const app = express();

// GitHub Pages (και άλλα static origins): αντανάκλαση Origin ώστε να περνάει CORS σωστά.
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: '512kb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'finbot-api' });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const row = normalizeRow(req.body);
    const { rows } = await pool.query(INSERT_SQL, [
      row.session_id,
      row.ts,
      row.experimental_condition,
      row.error_timing,
      row.show_conf,
      row.category,
      row.field,
      row.value_json,
      row.detail_json,
    ]);
    res.status(201).json({ ok: true, id: Number(rows[0].id) });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/export.json', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, session_id, ts, experimental_condition, error_timing, show_conf,
              category, field, value_json, detail_json
       FROM entries ORDER BY id ASC`
    );
    const out = rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      ts: r.ts,
      experimental_condition: r.experimental_condition,
      error_timing: r.error_timing,
      show_conf: !!Number(r.show_conf),
      category: r.category,
      field: r.field,
      value: r.value_json == null ? null : JSON.parse(r.value_json),
      detail: r.detail_json == null ? null : JSON.parse(r.detail_json),
    }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(out, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

async function main() {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinBot API → 0.0.0.0:${PORT}`);
    console.log('PostgreSQL: DATABASE_URL');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
