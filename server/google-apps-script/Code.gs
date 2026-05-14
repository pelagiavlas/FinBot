/**
 * FinBot — Google Apps Script (δένεις το script στο ίδιο το Spreadsheet)
 *
 * 1. Άνοιξε το Google Sheet → Extensions → Apps Script → επικόλλησε αυτόν τον κώδικα.
 * 2. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (ή Anyone with Google account — τότε το fetch από Railway χρειάζεται OAuth, όχι «Anyone»)
 * 3. Αντίγραψε το Web app URL και βάλτο ως GOOGLE_SHEET_URL στο Railway.
 *
 * Το Node backend στέλνει POST JSON με: sessionId, condition, error_timing, show_conf, category, field, value, detail
 *
 * Σημείωση: Άνοιγμα του /exec URL στον browser = αίτημα GET → χρειάζεται doGet (αλλιώς "doGet not found").
 * Η εγγραφή στο Sheet γίνεται μόνο με POST (από το Railway).
 */

/** Έλεγχος από browser: το URL δεν είναι "σπασμένο" — τα δεδομένα έρχονται με POST από το backend. */
function doGet() {
  return jsonOut_({
    ok: true,
    message: 'FinBot webhook: χρησιμοποίησε POST με JSON body. Αυτό το URL στο browser κάνει μόνο GET.',
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Lock timeout' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: 'Missing POST body' });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOut_({ ok: false, error: 'Invalid JSON' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var headers = [
      'sessionId',
      'condition',
      'error_timing',
      'show_conf',
      'category',
      'field',
      'value',
      'detail',
    ];

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      var firstCell = sheet.getRange(1, 1).getValue();
      if (firstCell === '' || firstCell === null) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }

    var row = [
      data.sessionId != null ? String(data.sessionId) : '',
      data.condition != null && data.condition !== '' ? String(data.condition) : '',
      data.error_timing != null ? String(data.error_timing) : '',
      data.show_conf === true || data.show_conf === 'true' || data.show_conf === 1 ? true : false,
      data.category != null ? String(data.category) : '',
      data.field != null ? String(data.field) : '',
      cellValue_(data.value),
      cellValue_(data.detail),
    ];

    sheet.appendRow(row);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Επιτρέπει αντικείμενα/πίνακες ως JSON string στο κελί */
function cellValue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
