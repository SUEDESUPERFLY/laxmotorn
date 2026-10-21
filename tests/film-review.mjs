// Granskning av förklaringsfilmer: kontaktark med stillbilder ur varje film (som review.mjs i fltman/infofilm).
// Kör: node tests/film-review.mjs src/index.html [antal bilder per film] [filmer.json]
// Utan filmer.json granskas de gyllene filmerna. Miljö: CHROME, SHOTS (mapp för arken).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { golden } from './golden-films.mjs';

const APP = process.argv[2], N = Number(process.argv[3] || 8), SHOTS = process.env.SHOTS || '/tmp';
const films = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : golden;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const errors = [];

for (const scheme of (process.env.SCHEMES || 'light').split(',')) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host === 'app.test') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(APP) });
    if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase')) {
      return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/umd', path.basename(url.pathname))) });
    }
    if (url.host.endsWith('supabase.co')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return route.continue().catch(() => route.abort());
  });
  await page.goto('https://app.test/index.html');
  await page.waitForSelector('#auth:not([hidden])');
  await page.evaluate(() => LS.set('laxmotorn:voice', false));
  for (const k of films) {
    await page.evaluate((k) => Explainer.open(k, { subj: k.subj || 'ma' }), k);
    await page.waitForFunction(() => Explainer.info().steps.length > 0);
    const { end, steps } = await page.evaluate(() => Explainer.info());
    // Bilder: strax efter varje steg har ritats klart, plus slutbilden.
    const times = steps.map((t, i) => Math.min((steps[i + 1] ?? end) - 50, t + 1600)).concat(end + 2600);
    const pick = times.length > N ? times.filter((_, i) => i % Math.ceil(times.length / N) === 0 || i === times.length - 1) : times;
    const shots = [];
    for (const t of pick) {
      await page.evaluate((t) => Explainer.seek(t), t);
      await page.waitForTimeout(60);
      shots.push({ t, b64: (await page.locator('.xp-stage').screenshot()).toString('base64') });
    }
    const sheet = await browser.newPage({ viewport: { width: 1640, height: 400 } });
    await sheet.setContent(`<body style="margin:0;padding:16px;background:#222;font:14px sans-serif;color:#eee">
      <h3 style="margin:0 0 10px">${k.name} · ${scheme} · ${Math.round(end / 100) / 10} s</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${shots.map((s) => `<figure style="margin:0"><img style="width:100%;display:block" src="data:image/png;base64,${s.b64}"><figcaption>${(s.t / 1000).toFixed(1)} s</figcaption></figure>`).join('')}</div></body>`);
    const file = path.join(SHOTS, `film-${k.id}-${scheme}.png`);
    await sheet.screenshot({ path: file, fullPage: true });
    await sheet.close();
    console.log('ark:', file);
    await page.evaluate(() => Explainer.close());
  }
  await page.close();
}
await browser.close();
if (errors.length) { console.log('Fel i sidan:\n' + errors.join('\n')); process.exit(1); }
