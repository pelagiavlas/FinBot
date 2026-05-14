/**
 * FinBot API — Express forwarding service (Railway)
 *
 * Μεταφέρει απαντήσεις στο Google Sheet μέσω Google Apps Script (χωρίς δική του βάση).
 *
 * Απαιτείται: process.env.GOOGLE_SHEET_URL (Deploy URL του Web App)
 *
 * Θύρα: process.env.PORT || 3847
 */

const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 3847;

const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
if (!GOOGLE_SHEET_URL || !String(GOOGLE_SHEET_URL).trim()) {
  console.error(
    'FATAL: Λείπει η GOOGLE_SHEET_URL. Βάλε το deployment URL του Google Apps Script (Railway → Variables).'
  );
  process.exit(1);
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
  res.json({ ok: true, service: 'finbot-api' });
});

app.post('/api/entries', async (req, res) => {
  try {
    const body = req.body;
    const sessionId = body.sessionId ?? body.session_id;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'missing sessionId' });
    }

    const condition = body.condition ?? body.experimental_condition ?? null;
    const payload = {
      sessionId: String(sessionId),
      condition: condition === undefined || condition === null ? null : condition,
      error_timing: body.error_timing ?? null,
      show_conf: !!body.show_conf,
      category: body.category ?? null,
      field: body.field ?? null,
      value: body.value === undefined ? null : body.value,
      detail: body.detail === undefined ? null : body.detail,
    };

    const response = await fetch(String(GOOGLE_SHEET_URL).trim(), {
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
      return res.status(400).json({
        ok: false,
        error: `Google Apps Script HTTP ${response.status}: ${text.slice(0, 500)}`,
      });
    }

    if (parsed && parsed.ok === false) {
      return res.status(400).json({
        ok: false,
        error: String(parsed.error || 'Google Apps Script returned ok: false'),
      });
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FinBot API → 0.0.0.0:${PORT}`);
  console.log('Γέφυρα: POST /api/entries → GOOGLE_SHEET_URL');
});
