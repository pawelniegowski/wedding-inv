const SHEET_ID = '1BNP9RL7ZHf4gIQ90zL1ytJBANR19Q8hDPP0Gl0b7M4s';

function doPost(e) {
  let data = {};
  try { data = JSON.parse(e.postData.contents); } catch (_) {}

  // Magic key: set RSVP_KEY in Project Settings → Script properties.
  // Lives only in Google — never in the (public) repo. Rejects everything
  // if unset, so forgetting the property fails closed, not open.
  const KEY = PropertiesService.getScriptProperties().getProperty('RSVP_KEY');
  if (!KEY || data.key !== KEY) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'forbidden' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const row = [
    new Date(),
    String(data.name ?? '').slice(0, 120),
    data.attending === 'yes' ? 'yes' : 'no',
    Math.min(parseInt(data.guests, 10) || 1, 6),
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    SpreadsheetApp.openById(SHEET_ID).getSheetByName('RSVPs').appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // Echo back what was written — client renders its confirmation from this.
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    saved: { timestamp: row[0], name: row[1], attending: row[2], guests: row[3] },
  })).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'alive' }))
    .setMimeType(ContentService.MimeType.JSON);
}
