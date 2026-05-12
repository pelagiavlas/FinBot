/**
 * FinBot — API αποθήκευσης απαντήσεων (SQLite)
 *
 * Μεταβλητές περιβάλλοντος:
 *   PORT              — θύρα (προεπιλογή 3847)
 *   FINBOT_INGEST_SECRET — αν οριστεί, απαιτείται header X-FinBot-Secret με την ίδια τιμή στα POST
 *   FINBOT_DB_PATH    — διαδρομή αρχείου SQLite (προεπιλογή ./data/finbot.sqlite)
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT) || 3847;
const SECRET = process.env.FINBOT_INGEST_SECRET || '';
const DB_PATH =
  process.env.FINBOT_DB_PATH ||
  path.join(__dirname, 'data', 'finbot.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    experimental_condition INTEGER,
    error_timing TEXT,
    show_conf INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    field TEXT NOT NULL,
    value_json TEXT,
    detail_json TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
  CREATE INDEX IF NOT EXISTS idx_entries_cat_field ON entries(category, field);
  CREATE INDEX IF NOT EXISTS idx_entries_condition ON entries(experimental_condition);
`);

const insertStmt = db.prepare(`
  INSERT INTO entries (
    session_id, ts, experimental_condition, error_timing, show_conf,
    category, field, value_json, detail_json
  ) VALUES (
    @session_id, @ts, @experimental_condition, @error_timing, @show_conf,
    @category, @field, @value_json, @detail_json
  )
`);

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

app.get('/health', (_req, res) => {
  res.json({ ok: true, db: path.basename(DB_PATH) });
});

/** Μία εγγραφή (ίδιο JSON με το frontend) */
app.post('/api/entries', ingestMiddleware, (req, res) => {
  try {
    const row = normalizeRow(req.body);
    const info = insertStmt.run(row);
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/** Πολλές εγγραφές */
app.post('/api/entries/batch', ingestMiddleware, (req, res) => {
  const list = req.body.entries;
  if (!Array.isArray(list)) {
    return res.status(400).json({ ok: false, error: 'entries must be an array' });
  }
  const insertMany = db.transaction((rows) => {
    let n = 0;
    for (const item of rows) {
      insertStmt.run(normalizeRow(item));
      n++;
    }
    return n;
  });
  try {
    const count = insertMany(list);
    res.status(201).json({ ok: true, inserted: count });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

/** Λίστα με προαιρετικά φίλτρα */
app.get('/api/entries', (req, res) => {
  const {
    category,
    field,
    experimental_condition: cond,
    session_id: sessionId,
    limit = '5000',
    offset = '0',
  } = req.query;

  let sql = 'SELECT * FROM entries WHERE 1=1';
  const params = {};
  if (category) {
    sql += ' AND category = @category';
    params.category = String(category);
  }
  if (field) {
    sql += ' AND field = @field';
    params.field = String(field);
  }
  if (cond !== undefined && cond !== '') {
    sql += ' AND experimental_condition = @cond';
    params.cond = Number(cond);
  }
  if (sessionId) {
    sql += ' AND session_id = @session_id';
    params.session_id = String(sessionId);
  }
  sql += ' ORDER BY id DESC LIMIT @lim OFFSET @off';
  params.lim = Math.min(Number(limit) || 5000, 50000);
  params.off = Number(offset) || 0;

  const rows = db.prepare(sql).all(params);
  const parsed = rows.map((r) => ({
    ...r,
    show_conf: !!r.show_conf,
    value:
      r.value_json === null ? null : JSON.parse(r.value_json),
    detail:
      r.detail_json === null ? null : JSON.parse(r.detail_json),
    value_json: undefined,
    detail_json: undefined,
  }));
  res.json({ ok: true, count: parsed.length, entries: parsed });
});

/** Πλήθος ανά ερώτηση (category+field) και ανά condition */
app.get('/api/stats/by-question', (_req, res) => {
  const rows = db
    .prepare(
      `
    SELECT category, field, experimental_condition, COUNT(*) AS n
    FROM entries
    GROUP BY category, field, experimental_condition
    ORDER BY category, field, experimental_condition
  `
    )
    .all();
  res.json({ ok: true, stats: rows });
});

/** Εξαγωγή όλων ως JSON */
app.get('/api/export.json', (_req, res) => {
  const rows = db.prepare('SELECT * FROM entries ORDER BY id ASC').all();
  const out = rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    ts: r.ts,
    experimental_condition: r.experimental_condition,
    error_timing: r.error_timing,
    show_conf: !!r.show_conf,
    category: r.category,
    field: r.field,
    value:
      r.value_json === null ? null : JSON.parse(r.value_json),
    detail:
      r.detail_json === null ? null : JSON.parse(r.detail_json),
    received_at: r.received_at,
  }));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(out, null, 2));
});

app.listen(PORT, () => {
  console.log(`FinBot API → http://localhost:${PORT}`);
  console.log(`SQLite: ${DB_PATH}`);
  if (SECRET) console.log('Ingest protection: ON (X-FinBot-Secret)');
  else console.log('Ingest protection: OFF (set FINBOT_INGEST_SECRET for production)');
});
