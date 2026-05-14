/**
 * FinBot — API αποθήκευσης απαντήσεων (PostgreSQL)
 *
 * Μεταβλητές περιβάλλοντος:
 *   PORT                 — θύρα (προεπιλογή 3847)
 *   FINBOT_INGEST_SECRET — αν οριστεί, απαιτείται header X-FinBot-Secret με την ίδια τιμή στα POST
 *   DATABASE_URL ή FINBOT_DATABASE_URL — connection string PostgreSQL
 *     (αν λείπει, το `pg` χρησιμοποιεί τις κλασικές μεταβλητές PGHOST, PGUSER, κ.λπ.)
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3847;
const SECRET = process.env.FINBOT_INGEST_SECRET || '';

const poolConfig = {};
const conn =
  process.env.DATABASE_URL || process.env.FINBOT_DATABASE_URL || '';
if (conn) poolConfig.connectionString = conn;

const pool = new Pool(poolConfig);

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
      session_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      experimental_condition INTEGER,
      error_timing TEXT,
      show_conf SMALLINT NOT NULL DEFAULT 0,
      category TEXT NOT NULL,
      field TEXT NOT NULL,
      value_json TEXT,
      detail_json TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_entries_cat_field ON entries(category, field)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_entries_condition ON entries(experimental_condition)`
  );
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

function rowToEntry(r) {
  return {
    ...r,
    show_conf: !!r.show_conf,
    value: r.value_json === null ? null : JSON.parse(r.value_json),
    detail: r.detail_json === null ? null : JSON.parse(r.detail_json),
    value_json: undefined,
    detail_json: undefined,
  };
}

function ingestMiddleware(req, res, next) {
  if (!SECRET) return next();
  const got = req.get('x-finbot-secret');
  if (got !== SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '512kb' }));

app.get('/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    res.json({ ok: true, db: rows[0]?.db || 'postgresql' });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message || e) });
  }
});

/** Μία εγγραφή (ίδιο JSON με το frontend) */
app.post('/api/entries', ingestMiddleware, async (req, res) => {
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

/** Πολλές εγγραφές */
app.post('/api/entries/batch', ingestMiddleware, async (req, res) => {
  const list = req.body.entries;
  if (!Array.isArray(list)) {
    return res.status(400).json({ ok: false, error: 'entries must be an array' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const item of list) {
      const row = normalizeRow(item);
      await client.query(INSERT_SQL, [
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
      n++;
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, inserted: n });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    res.status(400).json({ ok: false, error: String(e.message || e) });
  } finally {
    client.release();
  }
});

/** Λίστα με προαιρετικά φίλτρα */
app.get('/api/entries', async (req, res) => {
  const {
    category,
    field,
    experimental_condition: cond,
    session_id: sessionId,
    limit = '5000',
    offset = '0',
  } = req.query;

  let sql = 'SELECT * FROM entries WHERE 1=1';
  const params = [];
  let n = 1;
  if (category) {
    sql += ` AND category = $${n++}`;
    params.push(String(category));
  }
  if (field) {
    sql += ` AND field = $${n++}`;
    params.push(String(field));
  }
  if (cond !== undefined && cond !== '') {
    sql += ` AND experimental_condition = $${n++}`;
    params.push(Number(cond));
  }
  if (sessionId) {
    sql += ` AND session_id = $${n++}`;
    params.push(String(sessionId));
  }
  const lim = Math.min(Number(limit) || 5000, 50000);
  const off = Number(offset) || 0;
  sql += ` ORDER BY id DESC LIMIT $${n++} OFFSET $${n++}`;
  params.push(lim, off);

  try {
    const { rows } = await pool.query(sql, params);
    const parsed = rows.map(rowToEntry);
    res.json({ ok: true, count: parsed.length, entries: parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/** Πλήθος ανά ερώτηση (category+field) και ανά condition */
app.get('/api/stats/by-question', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT category, field, experimental_condition, COUNT(*)::int AS n
      FROM entries
      GROUP BY category, field, experimental_condition
      ORDER BY category, field, experimental_condition
    `);
    res.json({ ok: true, stats: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/** Εξαγωγή όλων ως JSON */
app.get('/api/export.json', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries ORDER BY id ASC');
    const out = rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      ts: r.ts,
      experimental_condition: r.experimental_condition,
      error_timing: r.error_timing,
      show_conf: !!r.show_conf,
      category: r.category,
      field: r.field,
      value: r.value_json === null ? null : JSON.parse(r.value_json),
      detail: r.detail_json === null ? null : JSON.parse(r.detail_json),
      received_at: r.received_at,
    }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(out, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

async function main() {
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`FinBot API → http://localhost:${PORT}`);
    console.log('Βάση: PostgreSQL');
    if (conn) console.log('Connection: DATABASE_URL / FINBOT_DATABASE_URL');
    else console.log('Connection: μεταβλητές περιβάλλοντος libpq (PGHOST, PGUSER, …)');
    if (SECRET) console.log('Ingest protection: ON (X-FinBot-Secret)');
    else console.log('Ingest protection: OFF (set FINBOT_INGEST_SECRET for production)');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
