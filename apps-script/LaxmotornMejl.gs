/**
 * Läxmotorn – skickar skolmejl från Unikum till Läxmotorn.
 *
 * Läxmotorn läser mejlet, hittar prov och läxförhör, kopplar dem till rätt barn via klasskoden
 * i ämnesraden (t.ex. RG14A, RG16C) och lägger dem under "Från skolan" i appen. När mejlet
 * innehåller tillräckligt med fakta görs ett förhörsförslag direkt. Inget syns för barnen
 * förrän en vuxen har godkänt det.
 *
 * Installation (en gång):
 *  1. Lägg filen i ett Apps Script-projekt (gärna samma som familjekalendern, eller ett nytt).
 *  2. Projektinställningar → Skriptegenskaper → lägg till LAXMOTORN_TOKEN med nyckeln från
 *     Läxmotorn (Byt barn → Koppla skolmejlen).
 *  3. Kör laxmotornPing() och kontrollera i loggen att barnen och klasskoderna syns.
 *  4. Kör laxmotornSetup(). Den läser mejl från de senaste 30 dagarna och skapar en utlösare
 *     som kör laxmotornSync() varje timme.
 */

const LAXMOTORN_API = 'https://qmmannehhntwjpcharmz.supabase.co/functions/v1/laxmotorn';
const LAXMOTORN_FROM = 'from:unikum@unikum.net';
const LAXMOTORN_LABEL = 'Läxmotorn';

function laxmotornToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('LAXMOTORN_TOKEN');
  if (!t) throw new Error('Skriptegenskapen LAXMOTORN_TOKEN saknas.');
  return t.trim();
}

function laxmotornCall_(payload) {
  const res = UrlFetchApp.fetch(LAXMOTORN_API, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(Object.assign({ token: laxmotornToken_() }, payload)),
    muteHttpExceptions: true,
  });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = { raw: res.getContentText().slice(0, 300) }; }
  return { status: res.getResponseCode(), body: body };
}

/** Testar nyckeln och visar barnen med klasskoder. */
function laxmotornPing() {
  Logger.log(JSON.stringify(laxmotornCall_({ action: 'ping' }), null, 2));
}

/** Engångsinstallation: läs senaste 30 dagarna och starta timvis körning. */
function laxmotornSetup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'laxmotornSync'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('laxmotornSync').timeBased().everyHours(1).create();
  laxmotornSync_('newer_than:30d');
}

/** Körs varje timme. Servern hoppar över mejl som redan är lästa, så det är ofarligt att läsa om. */
function laxmotornSync() {
  laxmotornSync_('newer_than:3d');
}

function laxmotornSync_(window) {
  const started = Date.now();
  const label = GmailApp.getUserLabelByName(LAXMOTORN_LABEL) || GmailApp.createLabel(LAXMOTORN_LABEL);
  const threads = GmailApp.search(LAXMOTORN_FROM + ' ' + window, 0, 50);
  const prepare = [];
  let sent = 0, found = 0;

  // Äldst först, så att datum och innehåll byggs på i rätt ordning.
  threads.reverse().forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (Date.now() - started > 4.5 * 60 * 1000) return; // Apps Script stoppar efter 6 minuter
      if (msg.getFrom().indexOf('unikum@unikum.net') < 0) return;
      const r = laxmotornCall_({
        action: 'ingest',
        message: { id: msg.getId(), subject: msg.getSubject(), date: msg.getDate().toISOString(), body: msg.getPlainBody() },
      });
      if (r.status !== 200) { Logger.log('Fel ' + r.status + ' för "' + msg.getSubject() + '": ' + JSON.stringify(r.body)); return; }
      if (r.body.skipped === 'already_imported') return;
      sent++;
      (r.body.items || []).forEach(function (it) {
        found++;
        Logger.log((r.body.child || '?') + ': ' + it.title + (it.enough ? ' (förslag görs)' : ' (behöver underlag)'));
        if (it.status === 'pending' && it.enough && prepare.indexOf(it.quiz_id) < 0) prepare.push(it.quiz_id);
      });
    });
    thread.addLabel(label);
  });

  // Förslagen görs i bakgrunden på servern (1–2 minuter styck).
  prepare.forEach(function (id) {
    const r = laxmotornCall_({ action: 'prepare', quiz_id: id });
    if (r.status >= 300) Logger.log('Kunde inte starta förslag ' + id + ': ' + JSON.stringify(r.body));
  });
  Logger.log('Klart: ' + sent + ' nya mejl, ' + found + ' prov/läxor, ' + prepare.length + ' förslag startade.');
}
