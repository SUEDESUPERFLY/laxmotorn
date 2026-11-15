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
 *  4. Kör laxmotornSetup(). Den läser mejl från de senaste 30 dagarna och skapar två utlösare:
 *     laxmotornSync() en gång per dygn (cirka kl. 06) och laxmotornNotify() cirka kl. 07.
 *     Bara byta utlösare: kör laxmotornSchedule().
 *
 * Påminnelse: laxmotornNotify() mejlar dig (kontot som äger skriptet) när det finns något nytt
 * som väntar på en vuxen: förslag att godkänna, prov som behöver underlag eller förslag som
 * misslyckades. Samma läge påminns bara en gång. Första körningen ber om lov att skicka mejl.
 */

const LAXMOTORN_API = 'https://qmmannehhntwjpcharmz.supabase.co/functions/v1/laxmotorn';
const LAXMOTORN_FROM = 'from:unikum@unikum.net';
const LAXMOTORN_LABEL = 'Läxmotorn';
const LAXMOTORN_APP = 'https://suedesuperfly.github.io/laxmotorn/';

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

/** Engångsinstallation: läs senaste 30 dagarna och starta synk och påminnelse en gång per dygn. */
function laxmotornSetup() {
  laxmotornSchedule();
  laxmotornSync_('newer_than:30d');
}

/**
 * Sätter utlösarna utan att läsa om gamla mejl: laxmotornSync cirka kl. 06 och laxmotornNotify
 * cirka kl. 07, en gång per dygn. Tar bort tidigare utlösare för båda, oavsett intervall.
 */
function laxmotornSchedule() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return ['laxmotornSync', 'laxmotornNotify'].indexOf(t.getHandlerFunction()) >= 0; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('laxmotornSync').timeBased().everyDays(1).atHour(6).inTimezone('Europe/Stockholm').create();
  // En timme senare, så att förslagen från morgonens synk hunnit bli klara.
  ScriptApp.newTrigger('laxmotornNotify').timeBased().everyDays(1).atHour(7).inTimezone('Europe/Stockholm').create();
  Logger.log('laxmotornSync körs en gång per dygn cirka kl. 06, laxmotornNotify cirka kl. 07.');
}

/** Körs en gång per dygn. Servern hoppar över mejl som redan är lästa, så det är ofarligt att läsa om. */
function laxmotornSync() {
  laxmotornSync_('newer_than:3d');
}

function laxmotornSync_(window) {
  const started = Date.now();
  const label = GmailApp.getUserLabelByName(LAXMOTORN_LABEL) || GmailApp.createLabel(LAXMOTORN_LABEL);
  const threads = GmailApp.search(LAXMOTORN_FROM + ' ' + window, 0, 50);
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
        Logger.log((r.body.child || '?') + ': ' + it.title + (it.enough ? '' : ' (behöver underlag)'));
      });
    });
    thread.addLabel(label);
  });
  Logger.log(sent + ' nya mejl, ' + found + ' prov/läxor.');
  laxmotornPrepare();
}

/**
 * Gör förhörsförslag av alla väntande prov som har underlag (mejlet eller rubrik + årskurs).
 * Körs i slutet av varje synk; misslyckade försöker igen vid nästa synk.
 */
function laxmotornPrepare() {
  const todo = laxmotornCall_({ action: 'todo' });
  if (todo.status !== 200) { Logger.log('Kunde inte hämta väntande prov: ' + JSON.stringify(todo.body)); return; }
  const items = todo.body.items || [];
  items.forEach(function (it) {
    const r = laxmotornCall_({ action: 'prepare', quiz_id: it.quiz_id });
    Logger.log((r.status < 300 ? 'Förslag startat: ' : 'Kunde inte starta: ') + it.title + (r.status < 300 ? '' : ' ' + JSON.stringify(r.body)));
  });
  Logger.log(items.length + ' förslag görs nu i bakgrunden (1–2 minuter styck).');
}

/**
 * Mejlar en påminnelse när något nytt väntar på en vuxen. Skickar inget om läget är oförändrat
 * sedan förra påminnelsen, så du får inte samma mejl varje dag.
 */
function laxmotornNotify() {
  const r = laxmotornCall_({ action: 'waiting' });
  if (r.status !== 200) { Logger.log('Kunde inte hämta väntande prov: ' + JSON.stringify(r.body)); return; }
  const items = r.body.items || [];
  const props = PropertiesService.getScriptProperties();
  let before = {};
  try { before = JSON.parse(props.getProperty('LAXMOTORN_NOTIFIED') || '{}'); } catch (e) { before = {}; }
  const now = {};
  items.forEach(function (it) { now[it.id] = it.state; });
  props.setProperty('LAXMOTORN_NOTIFIED', JSON.stringify(now));
  const fresh = items.filter(function (it) { return before[it.id] !== it.state; });
  if (!fresh.length) { Logger.log('Inget nytt att påminna om (' + items.length + ' väntar sedan tidigare).'); return; }

  const line = function (it) {
    const who = it.child ? it.child + ': ' : '';
    const when = it.test_date ? ' (prov ' + Number(it.test_date.slice(8, 10)) + '/' + Number(it.test_date.slice(5, 7)) + ')' : '';
    const isNew = before[it.id] !== it.state ? '  [ny]' : '';
    return '- ' + who + it.title + when + (it.missing ? ' – saknas: ' + it.missing : '') + isNew;
  };
  const groups = [
    ['draft', 'Förslag att granska och godkänna'],
    ['need', 'Behöver underlag (fota eller ladda upp materialet)'],
    ['failed', 'Förslaget misslyckades, skapa förhöret själv'],
  ];
  const parts = [];
  groups.forEach(function (g) {
    const list = items.filter(function (it) { return it.state === g[0]; });
    if (list.length) parts.push(g[1] + ':\n' + list.map(line).join('\n'));
  });
  const drafts = items.filter(function (it) { return it.state === 'draft'; }).length;
  const subject = drafts
    ? 'Läxmotorn: ' + drafts + ' förslag väntar på godkännande'
    : 'Läxmotorn: ' + items.length + ' prov behöver din hjälp';
  const body = parts.join('\n\n') + '\n\nÖppna Läxmotorn: ' + LAXMOTORN_APP + '\n\nInget syns för barnen förrän du har godkänt det.';
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  Logger.log('Påminnelse skickad: ' + subject);
}
