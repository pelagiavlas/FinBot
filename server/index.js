/**
 * FinBot API — Express → Google Sheet (χωρίς δική του βάση)
 *
 * Τρόπος Α (προτεινόμενος — χωρίς Apps Script / doGet / deploy URL):
 *   GOOGLE_SHEETS_SPREADSHEET_ID — από το URL του Sheet (.../d/SPREADSHEET_ID/...)
 *   GOOGLE_SERVICE_ACCOUNT_JSON — ολόκληρο JSON service account (ένα secret στο Railway)
 *   GOOGLE_SHEET_TAB — προαιρετικό, προεπιλογή Sheet1
 *
 * Τρόπος Β (fallback — Web App URL του Apps Script):
 *   GOOGLE_SHEET_URL
 *
 * Χρειάζεται τουλάχιστον ο Τρόπος Α ή ο Τρόπος Β.
 * Μία φορά setup: δημιουργία service account, ενεργοποίηση Sheets API, κοινή χρήση του Sheet
 * με το email του service account (Editor). Μετά, μόνο git push / Railway deploy — όχι Google Script UI.
 *
 * Θύρα: process.env.PORT || 3847
 */

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const PORT = Number(process.env.PORT) || 3847;

const SPREADSHEET_ID = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
const SERVICE_ACCOUNT_JSON = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || 'Sheet1').trim() || 'Sheet1';
const GOOGLE_SHEET_URL = (process.env.GOOGLE_SHEET_URL || '').trim();

const USE_SHEETS_API = Boolean(SPREADSHEET_ID && SERVICE_ACCOUNT_JSON);

if (!USE_SHEETS_API && !GOOGLE_SHEET_URL) {
  console.error(
    'FATAL: Ορίσε είτε (GOOGLE_SHEETS_SPREADSHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON) είτε GOOGLE_SHEET_URL. Δες σχόλια στην κορυφή του index.js.'
  );
  process.exit(1);
}

if (USE_SHEETS_API) {
  try {
    JSON.parse(SERVICE_ACCOUNT_JSON);
  } catch {
    console.error('FATAL: Το GOOGLE_SERVICE_ACCOUNT_JSON δεν είναι έγκυρο JSON.');
    process.exit(1);
  }
}

const HEADERS = [
  'sessionId',
  'condition',
  'error_timing',
  'show_conf',
  'category',
  'field',
  'value',
  'detail',
];

let sheetsSingleton = null;

function getSheetsClient() {
  if (sheetsSingleton) return sheetsSingleton;
  let creds;
  try {
    creds = JSON.parse(SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('Μη έγκυρο GOOGLE_SERVICE_ACCOUNT_JSON (πρέπει να είναι έγκυρο JSON).');
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Το service account JSON λείπει client_email ή private_key.');
  }
  const key = String(creds.private_key).replace(/\\n/g, '\n');
  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    key,
    ['https://www.googleapis.com/auth/spreadsheets'],
    null
  );
  sheetsSingleton = google.sheets({ version: 'v4', auth });
  return sheetsSingleton;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildPayload(body) {
  const sessionId = body.sessionId ?? body.session_id;
  if (!sessionId) throw new Error('missing sessionId');
  const condition = body.condition ?? body.experimental_condition ?? null;
  return {
    sessionId: String(sessionId),
    condition: condition === undefined || condition === null ? null : condition,
    error_timing: body.error_timing ?? null,
    show_conf: !!body.show_conf,
    category: body.category ?? null,
    field: body.field ?? null,
    value: body.value === undefined ? null : body.value,
    detail: body.detail === undefined ? null : body.detail,
  };
}

function rowFromPayload(p) {
  return [
    p.sessionId,
    p.condition === null || p.condition === undefined ? '' : String(p.condition),
    p.error_timing == null ? '' : String(p.error_timing),
    p.show_conf,
    p.category == null ? '' : String(p.category),
    p.field == null ? '' : String(p.field),
    cellText(p.value),
    cellText(p.detail),
  ];
}

async function ensureHeaderRow(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_TAB.replace(/'/g, "''")}'!A1`,
  });
  const cellA1 = data.values && data.values[0] && data.values[0][0];
  if (cellA1 !== undefined && cellA1 !== null && String(cellA1).trim() !== '') return;

  const safeTab = `'${SHEET_TAB.replace(/'/g, "''")}'`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${safeTab}!A1:H1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });
}

async function appendViaSheetsApi(payload) {
  const sheets = getSheetsClient();
  await ensureHeaderRow(sheets);
  const safeTab = `'${SHEET_TAB.replace(/'/g, "''")}'`;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${safeTab}!A:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowFromPayload(payload)] },
  });
}

async function appendViaAppsScriptWebhook(payload) {
  const response = await fetch(GOOGLE_SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_) {
    /* όχι JSON */
  }
  if (!response.ok) {
    throw new Error(`Google Apps Script HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (parsed && parsed.ok === false) {
    throw new Error(String(parsed.error || 'Google Apps Script returned ok: false'));
  }
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

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'finbot-api',
    mode: USE_SHEETS_API ? 'sheets_api' : 'apps_script_webhook',
  });
});

app.get('/api/assign-condition', async (req, res) => {
  try {
    if (!USE_SHEETS_API) {
      return res.json({ condition: Math.floor(Math.random() * 6) + 1 });
    }

    const sheets = getSheetsClient();
    const safeTab = `'${SHEET_TAB.replace(/'/g, "''")}'`;
    // Φέρνουμε μόνο τις στήλες sessionId και condition για ταχύτητα
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${safeTab}!A:B`,
    });

    const rows = response.data.values;
    const sessionConditions = new Map();

    if (rows && rows.length > 1) {
      // Ξεκινάμε από το 1 για να προσπεράσουμε τα headers
      for (let i = 1; i < rows.length; i++) {
        const sessionId = rows[i][0];
        const condition = parseInt(rows[i][1]);
        if (sessionId && !isNaN(condition)) {
          // Κρατάμε το condition για κάθε μοναδικό sessionId
          sessionConditions.set(sessionId, condition);
        }
      }
    }

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    sessionConditions.forEach((cond) => {
      if (counts[cond] !== undefined) {
        counts[cond]++;
      }
    });

    const TARGET = 20;
    const underTarget = [];
    for (let i = 1; i <= 6; i++) {
      if (counts[i] < TARGET) {
        underTarget.push(i);
      }
    }

    let assignedCondition;
    if (underTarget.length > 0) {
      // Επιλέγουμε αυτό με τις λιγότερες εγγραφές από αυτά που είναι κάτω από το στόχο
      underTarget.sort((a, b) => counts[a] - counts[b]);
      assignedCondition = underTarget[0];
    } else {
      // Αν όλα έχουν >= 20, επιλέγουμε αυτό με τις λιγότερες συνολικά
      const all = [1, 2, 3, 4, 5, 6];
      all.sort((a, b) => counts[a] - counts[b]);
      assignedCondition = all[0];
    }

    res.json({
      ok: true,
      condition: assignedCondition,
      counts
    });
  } catch (e) {
    console.error('Error assigning condition:', e);
    res.json({
      ok: false,
      condition: Math.floor(Math.random() * 6) + 1,
      error: String(e.message)
    });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    if (USE_SHEETS_API) await appendViaSheetsApi(payload);
    else await appendViaAppsScriptWebhook(payload);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FinBot API → 0.0.0.0:${PORT}`);
  if (USE_SHEETS_API) {
    console.log(`Google Sheets API → spreadsheet ${SPREADSHEET_ID}, tab "${SHEET_TAB}"`);
  } else {
    console.log('Γέφυρα: POST /api/entries → GOOGLE_SHEET_URL (Apps Script)');
  }
});
