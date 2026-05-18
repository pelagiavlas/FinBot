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
    
    // Headers setup if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Timestamp',
        'SessionID', 
        'Condition',
        'ErrorTiming',
        'ShowConf',
        'Category',
        'Field',
        'Value',
        'Detail'
      ]);
    }

    // Support for single entry or array of entries
    var entries = data.entries || [data];
    
    entries.forEach(function(entry) {
      sheet.appendRow([
        new Date().toISOString(),
        entry.sessionId || '',
        entry.condition != null ? String(entry.condition) : '',
        entry.error_timing || '',
        entry.show_conf === true || entry.show_conf === 'true',
        entry.category || '',
        entry.field || '',
        cellValue_(entry.value),
        cellValue_(entry.detail)
      ]);
    });

    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return jsonOut_({ ok: true, message: 'FinBot API is running' });
}

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
