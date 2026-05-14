/**
 * FinBot API — Express forwarding service (Railway)
 *
 * Forwards survey responses to Google Sheets via Google Apps Script.
 *
 * Required: process.env.GOOGLE_SHEET_URL (Google Apps Script deployment URL)
 *
 * Port: process.env.PORT || 3847
 */

const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.PORT) || 3847;

const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
if (!GOOGLE_SHEET_URL || !String(GOOGLE_SHEET_URL).trim()) {
  console.error(
    'FATAL: Missing GOOGLE_SHEET_URL. Set it to your Google Apps Script deployment URL.'
  );
  process.exit(1);
}

const app = express();

// GitHub Pages (and other static origins): reflect Origin so CORS passes correctly.
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

    const payload = {
      sessionId: String(sessionId),
      condition: body.condition ?? body.experimental_condition ?? null,
      error_timing: body.error_timing ?? null,
      show_conf: body.show_conf ?? null,
      category: body.category ?? null,
      field: body.field ?? null,
      value: body.value ?? null,
      detail: body.detail ?? null,
    };

    const response = await fetch(GOOGLE_SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return res
        .status(400)
        .json({ ok: false, error: `Google Apps Script error: ${text}` });
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FinBot API → 0.0.0.0:${PORT}`);
  console.log('Forwarding to Google Sheets via GOOGLE_SHEET_URL');
});
