// End-to-end-test av Läxmotorn mot en mockad Supabase och en låtsad talsyntes.
// Kör: npm i @supabase/supabase-js@2.45.4 playwright && node tests/e2e.mjs src/index.html
// Miljö: CHROME=<sökväg till chromium> (valfri), SHOTS=<mapp för skärmbilder> (standard /tmp)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.argv[2];
const SB = 'https://qmmannehhntwjpcharmz.supabase.co';
const SHOTS = process.env.SHOTS || '/tmp';
const log = [], calls = [], fails = [];
const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };

// Låtsad JWT (supabase-js läser exp ur token vid setSession).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const KIDTOK = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u2', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, kid: 'kidtok' })}.sig`;
const kidUser = { id: 'u2', aud: 'authenticated', role: 'authenticated', email: 'test+lm-erik@example.com', app_metadata: {}, user_metadata: { role: 'child' }, created_at: new Date().toISOString() };
const kidSession = { access_token: 'kidtok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'kr', user: kidUser };
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user };
const stats = () => ({ xp: 0, days: [], badges: [], fixed: 0, reviews: 0 });
const now = new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const concepts = [
  { id: 'k1', name: 'Fotosyntes', icon: 'sun', say: 'Fotosyntes är när växten gör socker. Den behöver ljus, vatten och koldioxid.', show: { type: 'list', title: 'Växten behöver', items: [{ t: 'Ljus', cue: 'ljus' }, { t: 'Vatten', cue: 'vatten' }, { t: 'Koldioxid', cue: 'koldioxid' }] } },
  { id: 'k2', name: 'Lövfällning', icon: 'tree', say: 'Lövträd fäller sina löv på hösten. Barrträd behåller sina barr.', show: { type: 'compare', left: { title: 'Lövträd', items: [{ t: 'Fäller löven', cue: 'fäller' }] }, right: { title: 'Barrträd', items: [{ t: 'Behåller barren', cue: 'behåller' }] } } },
  { id: 'k3', name: 'Vattnets kretslopp', icon: 'drop', say: 'Vattnet avdunstar, blir moln och regnar ner igen. Sedan börjar det om.', show: { type: 'cycle', title: 'Runt och runt', items: [{ t: 'Avdunstning', cue: 'avdunstar' }, { t: 'Moln', cue: 'moln' }, { t: 'Regn', cue: 'regnar' }] } },
];
const quizJson = (title) => ({
  title, subject: 'no', summary: 'Om skogen.', concepts,
  stations: [{ name: 'Fotosyntes', sub: 'Hur växter gör socker', icon: 'sun', qs: [
    { t: 'mc', c: 'k1', q: 'Vad behöver växten för fotosyntes?', opts: ['Ljus', 'Mörker', 'Salt'], a: 0, why: 'Ljus driver fotosyntesen.' },
    { t: 'tf', c: 'k1', q: 'Växter tar upp koldioxid.', a: true, why: 'Ja.' },
    { t: 'tf', c: 'k2', q: 'Barrträd fäller barren på hösten.', a: false, why: 'Barrträd behåller barren.' },
    { t: 'write', c: 'k3', q: 'Vad kallas det när vatten blir ånga?', acc: ['avdunstning'], why: 'Avdunstning.' } ] }],
  flash: [{ q: 'Förklara fotosyntes', a: 'Växter gör socker av ljus.' }], links: [], notes: [],
});
// Fördjupningsnivå som servern skulle ha gjort (redan tvättad, med prefixade id:n).
const levelStations = (n) => [{ id: `L${n}s1`, lv: n, name: n === 2 ? 'Varför ljus?' : 'Tänk som en forskare', sub: 'Förstå fotosyntesen', icon: 'sun', qs: [
  { t: 'explain', c: 'k1', q: 'Förklara varför växten behöver ljus.', points: ['ljuset ger energi', 'för att göra socker'], model: 'Ljuset ger energi så att växten kan göra socker.', why: 'Ljus är energin.' },
  { t: 'explain', c: 'k1', q: 'Lisa säger att växter äter jord. Har hon rätt?', points: ['nej', 'växten gör sin mat själv'], model: 'Nej, växten gör sin mat själv med fotosyntes.', why: '' },
  { t: 'mc', c: 'k1', q: 'Vad händer om en växt står i mörker länge?', opts: ['Den kan inte göra socker', 'Den växer snabbare', 'Inget alls'], a: 0, why: '' },
  { t: 'tf', c: 'k2', q: 'Ett lövträd sparar vatten genom att fälla löven.', a: true, why: '' }] }];
const oldQuiz = { stations: quizJson('x').stations.map((s) => ({ ...s, id: 's1', qs: s.qs.map(({ c, ...q }) => q) })), flash: [], notes: [], links: [] };

const db = {
  members: [{ household_id: 'hh1', user_id: 'u1', role: 'owner', child_id: null }],
  logins: [],
  households: [{ id: 'hh1', name: 'Familjen', ingest_token: '11111111-2222-3333-4444-555555555555' }],
  children: [
    { id: 'k1', household_id: 'hh1', name: 'Isabelle', grade: 6, stats: stats(), class_codes: ['RG14A', 'RG14/'], created_at: now },
    { id: 'k2', household_id: 'hh1', name: 'Erik', grade: 4, stats: stats(), class_codes: ['RG16C'], created_at: now },
  ],
  quizzes: [
    { id: 'qOld', household_id: 'hh1', title: 'Gammal läxa', subject: 'no', summary: '', grade: 4, test_date: null, content: oldQuiz, created_at: now, child_id: null, status: 'ready', source: null },
    { id: 'qDraft', household_id: 'hh1', title: 'Lag och rätt', subject: 'so', summary: 'Om lagar.', grade: 6, test_date: inDays(2), content: { ...quizJson('Lag och rätt'), title: undefined }, created_at: now, child_id: 'k1', status: 'draft',
      source: { from: 'unikum', kind: 'prov', enough: true, messages: [{ id: 'm1', subject: 'Info från skolan - RG14A', sent: now, what: 'SO-prov Lag och rätt' }], prepared_at: now } },
    { id: 'qPend', household_id: 'hh1', title: 'Skogen', subject: 'no', summary: null, grade: 4, test_date: inDays(5), content: {}, created_at: now, child_id: 'k2', status: 'pending',
      source: { from: 'unikum', kind: 'prov', enough: false, missing: 'häftet om skogen som skickas hem', messages: [{ id: 'm2', subject: 'No-prov - RG16C', sent: now, what: 'Begrepp: fotosyntes, klorofyll, avdunstning, tjäle, nedbrytning, kompost.' }] } },
  ],
  progress: {},
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => log.push('pageerror: ' + e.message));

// Låtsad svensk talsyntes som skickar ordgränser, så att cue-logiken testas.
// NOVOICE=1 testar i stället reservläget utan röst (uppskattad tid).
if (process.env.NOVOICE) await page.addInitScript(() => { window.__spoken = ['Fotosyntes är (ingen röst)']; Object.defineProperty(window, 'speechSynthesis', { value: undefined }); });
else await page.addInitScript(() => {
  const voice = { name: 'Test Alva', lang: 'sv-SE', default: true, localService: true, voiceURI: 'alva' };
  window.__spoken = [];
  const synth = {
    speaking: false, onvoiceschanged: null,
    getVoices: () => [voice],
    cancel() { (this._t || []).forEach(clearTimeout); this._t = []; this.speaking = false; },
    speak(u) {
      window.__spoken.push(u.text); this.speaking = true; this._t = [];
      const re = /\S+/g; let m, i = 0;
      while ((m = re.exec(u.text))) { const at = m.index; this._t.push(setTimeout(() => u.onboundary && u.onboundary({ name: 'word', charIndex: at }), 40 * ++i)); }
      this._t.push(setTimeout(() => { this.speaking = false; u.onend && u.onend({}); }, 40 * (i + 2)));
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
});

await page.route('**/*', async (route) => {
  const req = route.request(), url = new URL(req.url()), method = req.method();
  if (url.host === 'app.test') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(APP) });
  if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase')) {
    const f = path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd', path.basename(url.pathname));
    return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(f) });
  }
  if (url.origin !== SB) return route.abort();
  const p = url.pathname;
  calls.push(`${method} ${p}${url.search ? '?' + decodeURIComponent(url.search.slice(1)).slice(0, 80) : ''}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
  const isKid = (req.headers()['authorization'] || '').includes(KIDTOK.split('.')[1]);
  const kidMember = db.members.find((m) => m.user_id === 'u2');
  if (p === '/auth/v1/token') return json(session);
  if (p === '/auth/v1/user') return json(isKid ? kidUser : user);
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (p === '/rest/v1/household_members') return json(db.members.filter((m) => !eq('user_id') || m.user_id === eq('user_id')));
  if (p === '/rest/v1/rpc/get_ingest_token') return json(isKid ? null : db.households[0].ingest_token);
  if (p === '/rest/v1/kid_logins') return json(isKid ? [] : db.logins.map((l) => ({ child_id: l.child_id, username: l.username })));
  if (p === '/rest/v1/households') { const h = db.households.find((x) => x.id === eq('id')); return json(single ? h : [h]); }
  if (p === '/rest/v1/children') {
    if (method === 'GET') return json(isKid ? db.children.filter((c) => c.id === kidMember?.child_id) : db.children);
    if (method === 'PATCH') { const k = db.children.find((c) => c.id === eq('id')); Object.assign(k, req.postDataJSON()); return route.fulfill({ status: 204 }); }
  }
  if (p === '/rest/v1/quizzes') {
    if (method === 'GET') {
      const rows = db.quizzes.filter((q) => (!eq('id') || q.id === eq('id')) && (!isKid || (q.status === 'ready' && (!q.child_id || q.child_id === kidMember?.child_id)))).map((q) => ({ ...q, content: JSON.parse(JSON.stringify(q.content)) }));
      return json(single ? rows[0] ?? null : rows);
    }
    if (method === 'POST') { const r = { id: 'q' + (db.quizzes.length + 1), created_at: now, ...req.postDataJSON() }; db.quizzes.unshift(r); return json(single ? r : [r], 201); }
    if (method === 'PATCH') { const q = db.quizzes.find((x) => x.id === eq('id')); Object.assign(q, req.postDataJSON()); return json(single ? q : [q]); }
    if (method === 'DELETE') { db.quizzes = db.quizzes.filter((q) => q.id !== eq('id')); return route.fulfill({ status: 204 }); }
  }
  if (p === '/rest/v1/progress') {
    if (method === 'GET') return json(Object.values(db.progress).filter((r) => !eq('child_id') || r.child_id === eq('child_id')).map((r) => ({ ...r, updated_at: now })));
    if (method === 'POST') { for (const r of [].concat(req.postDataJSON())) db.progress[r.child_id + '/' + r.quiz_id] = r; return route.fulfill({ status: 201 }); }
  }
  if (p === '/functions/v1/laxmotorn') {
    const b = req.postDataJSON();
    if (b.action === 'kid_login') {
      const l = db.logins.find((x) => x.username === b.username && x.password === b.password);
      return l ? json({ access_token: KIDTOK, refresh_token: 'kr' }) : json({ code: 'bad_login' }, 401);
    }
    if (b.action === 'kid_account') {
      if (isKid) return json({ code: 'no_household' }, 403);
      if (b.password.length < 6) return json({ code: 'bad_password' }, 400);
      db.logins = db.logins.filter((x) => x.child_id !== b.child_id).concat({ child_id: b.child_id, username: b.username, password: b.password });
      if (!db.members.some((m) => m.user_id === 'u2')) db.members.push({ household_id: 'hh1', user_id: 'u2', role: 'child', child_id: b.child_id });
      return json({ ok: true, username: b.username, created: true });
    }
    calls.push(`  action=${b.action} ${b.text ? `text=${b.text.length} tecken` : ''} grade=${b.grade ?? ''}`);
    if (!req.headers()['authorization']?.startsWith('Bearer ')) return json({ code: 'session_expired' }, 401);
    if ('prompt' in b) return json({ code: 'unknown_action' }, 400);
    if (b.action === 'quiz') return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '```json\n' + JSON.stringify(quizJson('Skogen')) + '\n```' });
    if (b.action === 'level') {
      const q = db.quizzes.find((x) => x.id === b.quiz_id);
      if (!q || q.status !== 'ready') return json({ code: 'not_found' }, 404);
      calls.push(`  level=${b.level} quiz=${b.quiz_id}`);
      const lv = (q.content.levels || []).filter((l) => l.n !== b.level);
      q.content = { ...q.content, levels: [...lv, { n: b.level, name: b.level === 2 ? 'Fördjupning' : 'Expert', stations: levelStations(b.level) }] };
      return json({ started: true }, 202);
    }
    if (b.action === 'grade') {
      calls.push(`  grade qid=${b.qid} svar="${b.answer}"`);
      if (/Lisa/.test(b.answer)) return json({ code: 'upstream' }, 502);
      return json({ result: /ljus|energi/i.test(b.answer) ? 'ja' : 'nej', feedback: 'Bra förklarat, du kopplade ljuset till energin.' });
    }
    if (b.action === 'concepts') {
      const map = {}; b.quiz.stations.forEach((s, si) => s.qs.forEach((q, qi) => { map[`${si}.${qi}`] = ['k1', 'k1', 'k2', 'k3'][qi] || 'k1'; }));
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: JSON.stringify({ concepts, map }) });
    }
  }
  return json({ message: 'unmocked ' + p }, 404);
});

const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
const step = (t) => console.log('▶', t);
const vis = (sel) => page.locator(sel).isVisible();

await page.goto('https://app.test/index.html');
await page.waitForSelector('#auth:not([hidden])');
await page.fill('#authEmail', 'test@example.com');
await page.fill('#authPass', 'hemligt123');
await page.click('#loginBtn');

step('barnväljaren och klasskoderna');
await page.waitForSelector('#kids:not([hidden])');
await page.click('#mailSetup summary');
check(await page.inputValue('[data-codes="k2"]') === 'RG16C', 'Eriks klasskod visas');
await page.fill('[data-codes="k2"]', 'rg16c, RG16/');
await page.dispatchEvent('[data-codes="k2"]', 'change');
await page.waitForTimeout(200);
check(JSON.stringify(db.children[1].class_codes) === '["RG16C","RG16/"]', 'klasskoder sparas i versaler');
await page.click('#tokenBtn');
await page.waitForTimeout(200);
check((await page.textContent('#tokenOut')).includes('11111111'), 'nyckeln till Apps Script visas');
await shot('e2e-1-kids');
await page.click('[data-kid="k2"]');
await page.waitForSelector('#lib:not([hidden])');

step('inkorgen och barnfiltret (Erik)');
check(await page.locator('#inboxBox .qz.inb').count() === 2, 'inkorgen visar båda väntande proven');
check(await page.locator('#libList [data-open]').count() === 1, 'barnet ser bara den godkända gemensamma läxan');
check((await page.textContent('#inboxBox')).includes('Behöver underlag: häftet om skogen'), 'saknat underlag visas');
await shot('e2e-2-inbox');

step('granska och godkänn förslag (Isabelles prov)');
await page.click('[data-inb="qDraft"]');
await page.waitForSelector('#review:not([hidden])');
check((await page.textContent('#saveBtn')).trim() === 'Godkänn', 'knappen heter Godkänn');
check((await page.textContent('#revBox')).includes('För Isabelle'), 'granskningen visar barnet');
await page.click('details.rv[data-si="k"] summary');
await page.click('[data-play="0"]');
await page.waitForSelector('#xpOv:not([hidden])');
await page.waitForSelector('#xpOv.end', { timeout: 15000 });
check(await page.locator('#xpWin .xp-it.on').count() === 3, 'klippet i granskningen visar alla tre delarna');
await shot('e2e-3-clip-review');
await page.click('#xpGo');
await page.click('#saveBtn');
await page.waitForSelector('#lib:not([hidden])');
const appr = db.quizzes.find((q) => q.id === 'qDraft');
check(appr.status === 'ready' && appr.child_id === 'k1', 'godkänt förhör blir ready för Isabelle');
check(await page.locator('#inboxBox .qz.inb').count() === 1, 'inkorgen har ett kvar');
check(await page.locator('#libList [data-open]').count() === 1, 'Erik ser inte Isabelles läxa');

step('väntande prov → förifyllt formulär → förhör för Erik');
await page.click('[data-inb="qPend"]');
await page.waitForSelector('#create:not([hidden])');
check((await page.inputValue('#pasteIn')).includes('klorofyll'), 'mejlets innehåll är ifyllt');
check(await page.inputValue('#kidIn') === 'k2', 'Erik är vald');
check(await page.inputValue('#dateIn') === inDays(5), 'provdatumet är ifyllt');
check((await page.textContent('#fromBox')).includes('Saknas: häftet'), 'det som saknas visas');
await shot('e2e-4-create-from-mail');
await page.click('#genBtn');
await page.waitForSelector('#review:not([hidden])');
await page.click('#saveBtn');
await page.waitForSelector('#home:not([hidden])');
const fromMail = db.quizzes.find((q) => q.id === 'qPend');
check(fromMail.status === 'ready' && fromMail.content.concepts?.length === 3, 'raden från mejlet uppdateras med förhör och klipp');
check(await page.locator('.clip').count() === 3, 'hemskärmen visar förklaringsklippen');

step('fel svar → klipp startar → liknande fråga köas');
await page.click('[data-sid="s1"]');
await page.waitForSelector('#quiz:not([hidden])');
let gotClip = false;
for (let i = 0; i < 4; i++) {
  const type = await page.textContent('#qtype'), qtext = await page.textContent('#qtext');
  const before = await page.locator('#pips i').count();
  // Svara fel på flervalsfrågan, rätt på resten.
  if (/Skriv/.test(type)) await page.fill('#qbody input', 'avdunstning');
  else if (/Sant/.test(type)) await page.click(`#qbody .opt >> text=${/Barrträd/.test(qtext) ? 'Falskt' : 'Sant'}`);
  else await page.click('#qbody .opt >> text=Salt');
  const act = page.locator('#qactions #check');
  if (await act.count() && await act.isEnabled()) await act.click();
  await page.waitForSelector('#feedback .fb');
  if (/fotosyntes/.test(qtext)) {
    await page.waitForSelector('#xpOv:not([hidden])', { timeout: 3000 });
    gotClip = true;
    await page.waitForSelector('#xpOv.end', { timeout: 15000 });
    check((await page.evaluate(() => window.__spoken.at(-1))).startsWith('Fotosyntes är'), 'rösten läser manuset');
    check(await page.locator('#xpWin .xp-it.on').count() === 3, 'alla delar dyker upp på sina ord');
    await shot('e2e-5-clip-wrong');
    await page.click('#xpGo');
    check(/kommer (tillbaka|i slutet)/.test(await page.textContent('#feedback')), 'texten säger att frågan eller en liknande kommer tillbaka');
    await page.click('#nextBtn');
    check(await page.locator('#pips i').count() === before + 1, 'en fråga till har köats');
    continue;
  }
  await page.click('#nextBtn');
}
check(gotClip, 'klippet startade vid fel svar');
const queued = await page.textContent('#qtext');
check(/fotosyntes|koldioxid/.test(queued), `den köade frågan gäller samma begrepp ("${queued.slice(0, 40)}")`);

step('äldre läxa utan klipp → skapa klipp');
await page.click('#quitBtn').catch(() => {});
await page.evaluate(() => { const b = document.querySelector('#homeBack'); if (b && !b.closest('[hidden]')) b.click(); });
await page.waitForSelector('#lib:not([hidden])');
await page.click('[data-open="qOld"]');
await page.waitForSelector('#home:not([hidden])');
await page.click('#adultBox details:last-of-type summary');
await page.click('#mkClips');
await page.waitForSelector('.clip', { timeout: 5000 });
const old = db.quizzes.find((q) => q.id === 'qOld');
check(old.content.concepts.length === 3 && old.content.stations[0].qs.every((q) => q.c), 'klippen sparas och frågorna kopplas');
await shot('e2e-6-old-with-clips');

step('byt till Isabelle');
await page.click('#homeBack');
await page.click('#switchKid');
await page.click('[data-kid="k1"]');
await page.waitForSelector('#lib:not([hidden])');
const titles = await page.locator('#libList h3').allTextContents();
check(titles.includes('Lag och rätt') && !titles.includes('Skogen'), `Isabelle ser sin läxa men inte Eriks (${titles.join(', ')})`);

step('översikt för vuxna');
await page.click('#overviewBtn');
await page.waitForSelector('#overview:not([hidden]) .ov');
const ov = await page.textContent('#ovBox');
check(/Erik/.test(ov) && /Isabelle/.test(ov) && /Skogen/.test(ov), 'översikten visar barnen och deras läxor');
check(/Lag och rätt/.test(ov) && /Behöver öva inför provet/.test(ov), 'prov inom tre dagar med låg beredskap flaggas');
await shot('e2e-7-overview');
await page.click('#ovBack');

step('skapa inloggning för Erik');
await page.click('#switchKid');
await page.waitForSelector('#kids:not([hidden])');
check(await page.evaluate(() => document.querySelector('#loginSetup').open), 'inloggningsrutan är öppen när barn saknar inloggning');
check(await page.inputValue('[data-login="k2"] [name="u"]') === 'erik', 'användarnamnet föreslås från namnet');
await page.fill('[data-login="k2"] [name="p"]', 'abc');
await page.click('[data-login="k2"] button');
await page.waitForTimeout(200);
check(!db.logins.length, 'för kort lösenord stoppas');
await page.fill('[data-login="k2"] [name="p"]', 'drake77');
await page.click('[data-login="k2"] button');
await page.waitForSelector('[data-login="k2"] >> text=loggar in som erik');
check(db.logins[0]?.username === 'erik', 'inloggningen skapas');
await shot('e2e-8-logins');

step('Erik loggar in själv');
await page.click('[data-kid="k2"]');
await page.click('#logoutBtn');
await page.waitForSelector('#auth:not([hidden])');
await page.fill('#authEmail', 'erik');
await page.fill('#authPass', 'fel');
await page.click('#loginBtn');
await page.waitForSelector('#authMsg >> text=Fel användarnamn');
check(true, 'fel lösenord ger felmeddelande');
// Erik har redan silver på allt och har klarat slutprovet: Fördjupning ska öppnas.
const ep = db.progress['k2/qPend'];
db.progress['k2/qPend'] = { child_id: 'k2', quiz_id: 'qPend', state: { ...(ep?.state || {}), medals: { s1: 2 }, bossBest: 2, played: { s1: 1 } } };
await page.fill('#authPass', 'drake77');
await page.click('#loginBtn');
await page.waitForSelector('#lib:not([hidden])');
check(await page.textContent('#kidNow') === 'Erik' && (await page.textContent('#kidLabel')) === 'Hej', 'barnet hälsas med namn');
check(!(await vis('#newBtn')) && !(await vis('#switchKid')) && !(await vis('#overviewBtn')), 'Ny läxa, Byt barn och Översikt är dolda');
check((await page.locator('#inboxBox .qz').count()) === 0, 'Från skolan syns inte');
check((await page.locator('#libList [data-del]').count()) === 0, 'barnet kan inte ta bort läxor');
const kidTitles = await page.locator('#libList h3').allTextContents();
check(kidTitles.includes('Skogen') && !kidTitles.includes('Lag och rätt'), `barnet ser bara sina läxor (${kidTitles.join(', ')})`);
await page.click('[data-open="qPend"]');
await page.waitForSelector('#home:not([hidden])');
check(!(await vis('#adultBox details.adult-only')) && !(await vis('#resetBtn')), 'vuxendelar på läxsidan är dolda');
await shot('e2e-9-kid');

step('Fördjupning: förbereds, öppnas och spelas med förklaringsfrågor');
check(/Förbereds|Varför ljus/.test(await page.textContent('#lvBox')), 'nivå 2 visas som öppen');
await page.waitForSelector('#lvBox [data-sid="L2s1"]', { timeout: 15000 });
check(calls.some((c) => /level=2 quiz=qPend/.test(c)), 'barnkontot beställer nivå 2');
check(/Låst/.test(await page.textContent('#lvBox')) && /Expert/.test(await page.textContent('#lvBox')), 'Expert är låst');
await shot('e2e-10-level2');
const xpBefore = db.children[1].stats.xp;
await page.click('#lvBox [data-sid="L2s1"]');
await page.waitForSelector('#quiz:not([hidden])');
let selfAssessed = false, graded = false;
for (let i = 0; i < 4; i++) {
  const type = await page.textContent('#qtype'), qtext = await page.textContent('#qtext');
  if (/Förklara/.test(type)) {
    await page.fill('#einput', /Lisa/.test(qtext) ? 'Lisa har fel, växten gör sin mat själv' : 'Ljuset ger energi så att växten kan göra socker');
    await page.click('#qactions #check');
    if (/Lisa/.test(qtext)) {
      await page.waitForSelector('#selfYes');
      check(/Ett bra svar/.test(await page.textContent('#qactions')), 'utan rättning visas ett bra svar att jämföra med');
      await page.click('#selfYes'); selfAssessed = true;
    } else {
      await page.waitForSelector('#feedback .fb');
      const fb = await page.textContent('#feedback');
      check(/Bra förklarat/.test(fb) && /Ett bra svar/.test(fb), 'förklaringen rättas med återkoppling och modellsvar');
      await shot('e2e-11-explain'); graded = true;
    }
  } else if (/Sant/.test(type)) await page.click('#qbody .opt >> text=Sant');
  else await page.click('#qbody .opt >> text=Den kan inte göra socker');
  await page.waitForSelector('#feedback .fb');
  await page.click('#nextBtn');
}
check(graded && selfAssessed, 'båda förklaringsfrågorna kördes');
await page.waitForSelector('#result:not([hidden])');
check(/Silver|Brons/.test(await page.textContent('#resBox')), 'medalj på fördjupningsstationen');
await page.waitForTimeout(1500);
const st2 = db.progress['k2/qPend'].state, kidStats = db.children[1].stats;
check(st2.medals.L2s1 >= 2, `medaljen sparas (${st2.medals.L2s1})`);
check(kidStats.badges.includes('deep'), 'märket Fördjupare delas ut');
check(kidStats.xp - xpBefore >= 4 * 9, `fördjupning ger extra XP (+${kidStats.xp - xpBefore})`);
check(calls.some((c) => /level=3 quiz=qPend/.test(c)), 'nivå 3 beställs när nivå 2 är klar');
await page.click('#home2');
await page.waitForSelector('#lvBox [data-sid="L3s1"]', { timeout: 15000 });
check(!/Låst/.test(await page.textContent('#lvBox')), 'Expert är öppen efter silver på Fördjupning');
await shot('e2e-12-level3');

console.log('\nAnrop till servern:\n' + calls.filter((c) => /laxmotorn|action/.test(c)).join('\n'));
console.log('\nKonsolfel:\n' + (log.filter((l) => !/ERR_FAILED|404/.test(l)).join('\n') || '(inga)'));
await browser.close();
if (fails.length) { console.log(`\n${fails.length} FEL`); process.exit(1); }
console.log('\nALLT OK');
