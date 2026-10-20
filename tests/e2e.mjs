// End-to-end-test av Läxmotorn mot en mockad Supabase (sandlådan når inte Supabase eller CDN).
// Kör: npm i @supabase/supabase-js@2.45.4 playwright && node tests/e2e.mjs src/index.html
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const APP = process.argv[2];
const SB = 'https://qmmannehhntwjpcharmz.supabase.co';
const log = [];
const calls = [];
const db = { members: [], children: [], quizzes: [], progress: {} };
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user };

const quizJson = {
  title: 'Skogen', subject: 'no', summary: 'Om skogens ekosystem.',
  stations: [
    { name: 'Fotosyntes', sub: 'Hur växter gör socker', icon: 'sun', qs: [
      { t: 'mc', q: 'Vad behöver växten?', opts: ['Ljus', 'Mörker', 'Salt'], a: 0, why: 'Ljus driver fotosyntesen.' },
      { t: 'tf', q: 'Växter tar upp koldioxid.', a: true, why: 'Ja.' },
      { t: 'write', q: 'Vad heter det gröna ämnet?', acc: ['klorofyll'], why: 'Klorofyll.' } ] },
  ],
  flash: [{ q: 'Förklara fotosyntes', a: 'Växter gör socker av ljus.' }], links: [], notes: [],
};

const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
const page = await b.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => log.push('pageerror: ' + e.message));

await page.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  if (url.host === 'app.test') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(APP) });
  if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase')) {
    const f = path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd', path.basename(url.pathname));
    return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(f) });
  }
  if (url.origin !== SB) return route.abort();
  calls.push(`${method} ${url.pathname}${url.search}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  const p = url.pathname;
  if (p === '/auth/v1/token') return json(session);
  if (p === '/auth/v1/user') return json(user);
  if (p === '/rest/v1/household_members') return json(db.members);
  if (p === '/rest/v1/rpc/create_household') { db.members.push({ household_id: 'hh1' }); return json('hh1'); }
  if (p === '/rest/v1/children') {
    if (method === 'GET') return json(db.children);
    if (method === 'POST') { const r = { id: 'k' + (db.children.length + 1), ...req.postDataJSON(), stats: { xp: 0, days: [], badges: [], fixed: 0, reviews: 0 } }; db.children.push(r); return json(single ? r : [r], 201); }
    if (method === 'PATCH') { const id = url.searchParams.get('id').replace('eq.', ''); const k = db.children.find((c) => c.id === id); Object.assign(k, req.postDataJSON()); return route.fulfill({ status: 204 }); }
  }
  if (p === '/rest/v1/quizzes') {
    if (method === 'GET') return json(db.quizzes);
    if (method === 'POST') { const body = req.postDataJSON(); const r = { id: 'q' + (db.quizzes.length + 1), created_at: new Date().toISOString(), ...body }; db.quizzes.unshift(r); return json(single ? r : [r], 201); }
    if (method === 'DELETE') { const id = url.searchParams.get('id').replace('eq.', ''); db.quizzes = db.quizzes.filter((q) => q.id !== id); return route.fulfill({ status: 204 }); }
  }
  if (p === '/rest/v1/progress') {
    if (method === 'GET') return json(Object.values(db.progress).filter((r) => `eq.${r.child_id}` === url.searchParams.get('child_id')));
    if (method === 'POST') { for (const r of [].concat(req.postDataJSON())) db.progress[r.child_id + '/' + r.quiz_id] = r; return route.fulfill({ status: 201 }); }
  }
  if (p === '/functions/v1/generate') {
    const body = req.postDataJSON();
    if (!req.headers()['authorization']?.startsWith('Bearer ')) return json({ code: 'session_expired' }, 401);
    calls.push(`  prompt ${body.prompt.length} tecken, ${body.images.length} bilder`);
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'Här är förhöret:\n```json\n' + JSON.stringify(quizJson) + '\n```' });
  }
  return json({ message: 'unmocked ' + p }, 404);
});

const shot = async (n) => page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', n + '.png'), fullPage: true });
const step = (t) => console.log('▶', t);

await page.goto('https://app.test/index.html');
step('inloggning visas');
await page.waitForSelector('#auth:not([hidden])');
await shot('1-auth');
await page.fill('#authEmail', 'test@example.com');
await page.fill('#authPass', 'hemligt123');
await page.click('#loginBtn');
step('barnväljare visas, familj skapas');
await page.waitForSelector('#kids:not([hidden])');
await page.fill('#kidName', 'Testbarn');
await page.selectOption('#kidGrade', '5');
await page.click('#kidAdd');
await page.waitForSelector('[data-kid="k1"]');
await shot('2-kids');
await page.click('[data-kid="k1"]');
step('biblioteket');
await page.waitForSelector('#lib:not([hidden])');
console.log('  kidNow:', await page.textContent('#kidNow'), '| årskurs i formulär:', await page.inputValue('#gradeIn'));
await page.click('#newBtn');
await page.fill('#pasteIn', 'Skogen. Växter gör fotosyntes med hjälp av ljus, vatten och koldioxid. Klorofyll är grönt.');
step('generera');
await page.click('#genBtn');
await page.waitForSelector('#review:not([hidden])', { timeout: 15000 });
await shot('3-review');
await page.click('#saveBtn');
await page.waitForSelector('#home:not([hidden])');
step('spela station');
await page.click('[data-st="0"]');
await page.waitForSelector('#quiz:not([hidden])');
for (let i = 0; i < 3; i++) {
  const type = await page.textContent('#qtype');
  const q = await page.textContent('#qtext');
  if (/Skriv/.test(type)) { await page.fill('#qbody input', 'klorofyll'); }
  else if (/Sant/.test(type)) { await page.click('#qbody .opt >> text=Sant'); }
  else { await page.click('#qbody .opt >> text=Ljus'); }
  const act = page.locator('#qactions button').first();
  if (await act.count() && await act.isEnabled()) await act.click();
  await page.waitForSelector('#feedback .fb');
  console.log('  ', type, '|', q, '→', (await page.textContent('#feedback .fb h3')).trim().slice(0, 40));
  const next = page.locator('#feedback button').first();
  await next.click();
}
await page.waitForTimeout(1500);
await shot('4-after');
step('logga ut och in igen, framsteg ska finnas kvar');
const xpBefore = await page.textContent('#xpText');
await page.evaluate(() => document.querySelector('#logoutBtn').click());
await page.waitForSelector('#auth:not([hidden])');
await page.fill('#authEmail', 'test@example.com');
await page.fill('#authPass', 'hemligt123');
await page.click('#loginBtn');
await page.waitForSelector('#lib:not([hidden])');
await page.waitForTimeout(300);
console.log('  XP före:', xpBefore, '| efter:', await page.textContent('#xpText'));
console.log('  progress i db:', JSON.stringify(Object.values(db.progress).map((r) => ({ child: r.child_id, quiz: r.quiz_id, medals: r.state.medals, nq: Object.keys(r.state.q || {}).length }))));
console.log('  barnets stats i db:', JSON.stringify(db.children[0].stats).slice(0, 120));
console.log('  sparad läxa:', JSON.stringify({ title: db.quizzes[0].title, hh: db.quizzes[0].household_id, grade: db.quizzes[0].grade, keys: Object.keys(db.quizzes[0].content) }));
await shot('5-relogin');
console.log('\nAnrop:\n' + calls.join('\n'));
console.log('\nKonsol/fel:\n' + (log.join('\n') || '(inga)'));
await b.close();
