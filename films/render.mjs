// Renderar Läxmotorns förklaringsfilmer som video. Körs i GitHub Actions (.github/workflows/films.yml).
//   node render.mjs list                    skriver begreppen som saknar video till $GITHUB_OUTPUT (items=[…])
//   node render.mjs one <quiz_id> <concept>  gör en film: manus och röst → ordtider → komposition → kontroll
//                                            → rendering → granskning av stillbilder → uppladdning
// Servern (edge function laxmotorn, video_*) anropar Claude och Speko; vi loggar in med GitHubs OIDC-token.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assemble, parseFilm } from './assemble.mjs';
import { alignWords, duration, speechIntervals } from './align.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.LAX_API || 'https://qmmannehhntwjpcharmz.supabase.co/functions/v1/laxmotorn';
// Den publika anon-nyckeln (samma som i appen).
const ANON = process.env.LAX_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbWFubmVoaG50d2pwY2hhcm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MzMxODEsImV4cCI6MjEwODAwOTE4MX0._5uBoCo_2qQijw2N06O5hjHGCX-cB0-dPaUTCiubmgE';
const LEAD = 0.6; // rösten börjar 0,6 s in i filmen (som i assemble.mjs och kit.js)
const SAFE_ID = /^[A-Za-z0-9_-]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Server ----------
let tok = null;
async function oidc() {
  if (process.env.LAX_TOKEN) return process.env.LAX_TOKEN; // lokalt test mot en låtsasserver
  if (tok && Date.now() - tok.at < 60_000) return tok.v;
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error('OIDC saknas (arbetsflödet behöver permissions: id-token: write)');
  const r = await fetch(`${u}&audience=laxmotorn`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!j.value) throw new Error('OIDC: ingen token');
  tok = { v: j.value, at: Date.now() };
  return j.value;
}
async function post(action, body) {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-github-oidc': await oidc() },
    body: JSON.stringify({ action, ...body }),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(action, body = {}) {
  for (let i = 0; ; i++) {
    const r = await post(action, body);
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { code: txt.slice(0, 200) }; }
    if (r.ok) return j;
    if (i < 2 && [429, 502, 503, 504, 546].includes(r.status)) { await sleep(15_000 * (i + 1)); continue; }
    throw new Error(`${action}: ${r.status} ${j.code ?? ''}`);
  }
}

let ids = {};
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s';
async function log(msg, level = 'info') {
  console.log(`[${secs()}] ${level === 'info' ? '' : level.toUpperCase() + ' '}${msg}`);
  try { await post('video_log', { ...ids, level, msg }); } catch { /* loggen får aldrig stoppa filmen */ }
}

// ---------- Verktyg ----------
function run(cmd, args, cwd, { timeout = 15 * 60_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: process.env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Filmtid då ett stödord (1–3 ord ur manuset) sägs.
function cueTime(cue, words) {
  const c = norm(cue || '').split(' ').filter(Boolean);
  if (!c.length) return null;
  const w = words.map((x) => norm(x.w));
  for (let i = 0; i + c.length <= w.length; i++) if (c.every((x, j) => w[i + j] === x)) return LEAD + words[i].start;
  const i = w.findIndex((x) => x === c[0] || x.startsWith(c[0]));
  return i >= 0 ? LEAD + words[i].start : null;
}

// Nio tidpunkter för granskningen: strax efter varje steg i planen, fyllt jämnt över filmen, plus slutbilden.
function sampleTimes(plan, words, D) {
  const ts = plan.map((p) => cueTime(p.cue, words)).filter((t) => t !== null).map((t) => Math.min(D - 0.3, t + 1.4));
  ts.push(D - 0.4);
  for (let k = 1; ts.length < 30; k++) { ts.push((D * k) / 10); if (k > 9) break; }
  const out = [];
  for (const t of ts.sort((a, b) => a - b)) if (t > 0.8 && !out.some((x) => Math.abs(x - t) < 1.6)) out.push(+t.toFixed(2));
  // Behåll slutbilden och sprid resten.
  while (out.length > 9) {
    let best = 1, gap = 1e9;
    for (let i = 1; i < out.length - 1; i++) { const g = out[i + 1] - out[i - 1]; if (g < gap) { gap = g; best = i; } }
    out.splice(best, 1);
  }
  while (out.length < 9) out.push(out.at(-1)); // kortare film: upprepa sista (sällan)
  return out;
}

const stamp = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = (ms % 60000) / 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x.toFixed(3).padStart(6, '0')}`; };
// Textrader (för appen och för VTT-filen): korta bitar, brutna vid meningsslut och kommatecken.
function captionCues(words) {
  // Meningar; långa meningar delas i jämna delar vid ordgränser (helst vid kommatecken).
  const sentences = []; let cur = [];
  words.forEach((w, i) => { cur.push(w); if (/[.!?]$/.test(w.w) || i === words.length - 1) { sentences.push(cur); cur = []; } });
  const chunks = [];
  for (const sw of sentences) {
    const len = sw.map((x) => x.w).join(' ').length, n = Math.ceil(len / 42);
    if (n <= 1) { chunks.push(sw); continue; }
    let from = 0;
    for (let k = 1; k < n; k++) {
      const target = (len * k) / n; let best = -1, score = 1e9, pos = 0;
      sw.forEach((x, i) => { pos += x.w.length + 1; if (i < from || i >= sw.length - 1) return; const sc = Math.abs(pos - target) - (/[,;:]$/.test(x.w) ? 8 : 0); if (sc < score) { score = sc; best = i; } });
      if (best >= from) { chunks.push(sw.slice(from, best + 1)); from = best + 1; }
    }
    chunks.push(sw.slice(from));
  }
  return chunks.filter((c) => c.length).map((c, i, all) => {
    const a = LEAD + c[0].start, nxt = all[i + 1], b = nxt ? Math.max(LEAD + c.at(-1).end, LEAD + nxt[0].start - 0.05) : LEAD + c.at(-1).end + 1.2;
    return { a: +a.toFixed(2), b: +b.toFixed(2), t: c.map((x) => x.w).join(' ') };
  });
}
const vtt = (cues) => 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${stamp(c.a)} --> ${stamp(c.b)}\n${c.t}\n\n`).join('');

// HyperFrames-kontroll. Fel ska rättas; några layoutvarningar skickas med som tips om filmen ändå görs om.
function check(dir) {
  const r = run('npx', ['hyperframes', 'check', '--json'], dir, { timeout: 6 * 60_000 });
  let j; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { return { errors: [`check gav inget svar: ${(r.err || r.out).slice(-400)}`], hints: [] }; }
  const errors = [], hints = [];
  for (const [name, sec] of Object.entries(j)) {
    for (const f of sec?.findings ?? []) {
      const line = `${name}/${f.code}: ${f.message}${f.selector ? ` (${f.selector}` + (f.time != null ? ` vid ${Number(f.time).toFixed(1)} s)` : ')') : ''}${f.fixHint ? ` Åtgärd: ${f.fixHint}` : ''}`;
      if (f.severity === 'error') errors.push(line);
      else if (f.severity === 'warning' && !/nested_structure|container_overflow|clip_media_fit/.test(f.code)) hints.push(line);
    }
  }
  if (j.browserSkipped) errors.push('kontrollen kunde inte starta webbläsaren');
  return { errors: errors.slice(0, 12), hints: hints.slice(0, 8) };
}

// Lagren som slutar sist förlängs till filmens slut, så att sammanfattningen står kvar (annars blir sista bilden tom).
function extendClips(body, D) {
  const tags = [];
  for (const m of body.matchAll(/<[a-z][\w-]*\b[^>]*>/gi)) {
    const t = m[0], st = t.match(/\bdata-start="([\d.]+)"/), du = t.match(/\bdata-duration="([\d.]+)"/);
    if (/\bclass="[^"]*\bclip\b/.test(t) && st && du) tags.push({ t, end: Number(st[1]) + Number(du[1]), start: Number(st[1]) });
  }
  if (!tags.length) return { body, changed: 0 };
  const max = Math.max(...tags.map((x) => x.end));
  if (max >= D - 0.05) return { body, changed: 0 };
  let out = body, changed = 0;
  for (const x of tags) if (x.end >= max - 0.05) { out = out.replace(x.t, x.t.replace(/\bdata-duration="[\d.]+"/, `data-duration="${(D - x.start).toFixed(2)}"`)); changed++; }
  return { body: out, changed, from: max };
}

// Komposition från Claude (strömmad text). Funktionen på servern har 150 s; blir svaret inte klart räknas det som ett misslyckat försök.
async function compose(v, words, voiceEnd, D, feedback) {
  const s = Date.now();
  const r = await post('video_compose', {
    ...ids, narration: v.narration, plan: v.plan, words: words.map(({ w, start }) => ({ w, start })), voice_end: voiceEnd, duration: D,
    feedback: feedback || undefined,
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`video_compose: ${r.status} ${j.code ?? ''} efter ${((Date.now() - s) / 1000).toFixed(0)} s`); }
  // Läs strömmen bit för bit för att se när första texten kommer (lång tid = Claude tänker eller köar).
  let text = '', first = 0;
  const dec = new TextDecoder();
  for await (const chunk of r.body) { if (!first) first = Date.now(); text += dec.decode(chunk, { stream: true }); }
  const e = text.indexOf('\u0000ERR:');
  if (e >= 0) throw new Error(`video_compose: ${text.slice(e + 5).trim()}`);
  await log(`komposition: ${text.length} tecken på ${((Date.now() - s) / 1000).toFixed(0)} s (första text efter ${first ? ((first - s) / 1000).toFixed(0) : '–'} s)`);
  if (!text.includes('<<<END>>>')) throw new Error(`kompositionen blev inte klar (${text.length} tecken)`);
  return text;
}

async function upload(target, file, type) {
  const r = await fetch(target.signed_url, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'true', apikey: ANON }, body: fs.readFileSync(file) });
  if (!r.ok) throw new Error(`uppladdning ${path.basename(file)}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return target.public_url;
}

// ---------- En film ----------
async function one(quizId, conceptId) {
  if (!UUID.test(quizId) || !SAFE_ID.test(conceptId)) throw new Error('ogiltigt id');
  ids = { quiz_id: quizId, concept_id: conceptId };
  const dir = path.join(HERE, 'work', conceptId), tmp = path.join(HERE, 'work', conceptId + '-tmp');
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  try {
    // 1) Manus, plan och röst.
    const v = await call('video_voice', ids);
    await log(`manus "${v.title}" (${v.narration.split(/\s+/).length} ord), röst ${v.provider ?? '?'}/${v.model ?? '?'} (${v.source_type ?? v.audio_type}, ${v.bytes ?? '?'} byte)`);
    const ext = /wav/i.test(v.audio_type || '') ? '.wav' : '.mp3';
    const rawVoice = path.join(tmp, 'voice-in' + ext), voice = path.join(tmp, 'voice.wav');
    const ar = await fetch(v.audio_url);
    if (!ar.ok) throw new Error(`rösten: ${ar.status}`);
    fs.writeFileSync(rawVoice, Buffer.from(await ar.arrayBuffer()));
    // Jämn ljudnivå mellan filmerna och en exakt längd (WAV).
    const nr = run('ffmpeg', ['-v', 'error', '-y', '-i', rawVoice, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', voice], tmp);
    if (nr.code !== 0 || !fs.existsSync(voice)) throw new Error(`rösten gick inte att läsa: ${nr.err.slice(-300)}`);
    // 2) Ordtider ur pauserna i ljudet.
    const vdur = duration(voice);
    let speech = speechIntervals(voice);
    if (!speech.length) speech = [[0, vdur]];
    const words = alignWords(v.narration, speech);
    const talk = speech.reduce((a, [x, y]) => a + (y - x), 0), rate = words.length / Math.max(0.1, talk);
    if (!words.length || !(vdur > 5)) throw new Error(`rösten saknar tal (${vdur.toFixed(1)} s)`);
    if (rate < 1.2 || rate > 4.5) throw new Error(`rösten har orimligt tempo: ${rate.toFixed(2)} ord/s på ${vdur.toFixed(1)} s (${v.source_type ?? v.audio_type})`);
    const voiceEnd = LEAD + Math.min(vdur, words.at(-1).end);
    const D = Math.ceil(LEAD + vdur + 2.8);
    await log(`röst ${vdur.toFixed(1)} s (${speech.length} talavsnitt, ${rate.toFixed(1)} ord/s), film ${D} s`);

    // 3) Komposition → kontroll → rendering → granskning. Högst två försök.
    let feedback = '', done = null;
    const ATTEMPTS = 3;
    for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
      let text;
      try { text = await compose(v, words, voiceEnd, D, feedback); } catch (e) {
        if (/no_credit/.test(String(e.message))) throw e; // slut på krediter: inga fler försök
        await log(String(e.message || e).slice(0, 300), 'warn');
        feedback = (feedback ? feedback + '\n' : '') + 'Förra svaret hann inte bli klart. Svara direkt utan lång planering och skriv kortare: högst 12 000 tecken.';
        continue;
      }
      const film = parseFilm(text);
      if (!film) { feedback = 'Svaret följde inte formatet: <<<STYLE>>>, <<<BODY>>>, <<<SCRIPT>>> och sist <<<END>>>.'; await log('fel format', 'warn'); continue; }
      const grow = extendClips(film.body, D);
      if (grow.changed) { film.body = grow.body; await log(`${grow.changed} lager förlängda från ${grow.from.toFixed(1)} s till ${D} s`); }
      assemble(dir, film, { voice, voiceDur: vdur, duration: D });
      const chk = check(dir);
      // Layoutfel (dold eller överlappande text) kan vara korta övergångar; från andra försöket får granskningen av bilderna avgöra.
      const fatal = chk.errors.filter((e) => !e.startsWith('layout/'));
      if (chk.errors.length && !fatal.length && attempt >= 2) await log(`kontroll: ${chk.errors.length} layoutfel kvar, granskningen avgör – ${chk.errors[0].slice(0, 200)}`, 'warn');
      else if (chk.errors.length) {
        feedback = 'HyperFrames-kontrollen hittade fel:\n' + chk.errors.join('\n') + (chk.hints.length ? '\nOckså:\n' + chk.hints.join('\n') : '');
        await log(`kontroll: ${chk.errors.length} fel – ${chk.errors[0].slice(0, 300)}`, 'warn');
        continue;
      }
      if (chk.hints.length) await log(`kontroll ok, ${chk.hints.length} varningar – ${chk.hints[0].slice(0, 200)}`);
      const s = Date.now();
      const rr = run('npx', ['hyperframes', 'render', '-q', 'standard', '-f', '30', '--crf', '30', '-o', 'out.mp4'], dir, { timeout: 20 * 60_000 });
      const raw = path.join(dir, 'out.mp4'), mp4 = path.join(dir, 'film.mp4');
      if (rr.code !== 0 || !fs.existsSync(raw)) throw new Error(`renderingen misslyckades: ${(rr.err || rr.out).slice(-500)}`);
      // moov först, så att filmen kan börja spelas innan hela filen laddats.
      run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c', 'copy', '-movflags', '+faststart', mp4], dir);
      if (!fs.existsSync(mp4)) fs.copyFileSync(raw, mp4);
      const mdur = duration(mp4), mb = fs.statSync(mp4).size / 1e6;
      await log(`renderad på ${((Date.now() - s) / 1000).toFixed(0)} s: ${mdur.toFixed(1)} s, ${mb.toFixed(1)} MB`);
      if (Math.abs(mdur - D) > 1.5) throw new Error(`filmen blev ${mdur.toFixed(1)} s i stället för ${D} s`);
      // Kontaktark med nio stillbilder.
      const times = sampleTimes(v.plan, words, D);
      times.forEach((t, i) => run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', path.join(tmp, `f${String(i).padStart(2, '0')}.png`)], tmp));
      const sheet = path.join(tmp, 'sheet.jpg');
      run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, 'f%02d.png'), '-vf', 'tile=3x3:padding=8:margin=8:color=white', '-frames:v', '1', '-q:v', '3', sheet], tmp);
      if (!fs.existsSync(sheet)) throw new Error('kontaktarket kunde inte göras');
      const rev = await call('video_review', { ...ids, sheet: fs.readFileSync(sheet).toString('base64'), times, narration: v.narration });
      if (rev.minor?.length) await log(`granskning, småfel: ${rev.minor.join(' | ').slice(0, 600)}`);
      if (rev.ok) { done = { mp4, mdur }; break; }
      feedback = 'Granskningen av stillbilder ur den renderade filmen hittade fel som måste bort:\n' + rev.blocking.map((b) => '- ' + b).join('\n');
      await log(`granskning, blockerande: ${rev.blocking.join(' | ').slice(0, 800)}`, 'warn');
    }
    if (!done) throw new Error(`ingen godkänd film efter ${ATTEMPTS} försök${feedback ? ': ' + feedback.split('\n').slice(1, 3).join(' ').slice(0, 200) : ''}`);

    // 4) Textning och omslagsbild, uppladdning.
    const vttFile = path.join(tmp, 'film.vtt'), poster = path.join(tmp, 'poster.jpg');
    const cues = captionCues(words);
    fs.writeFileSync(vttFile, vtt(cues));
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, D - 0.5)), '-i', done.mp4, '-frames:v', '1', '-vf', 'scale=1280:720', '-q:v', '4', poster], tmp);
    const up = await call('video_upload', ids);
    const url = await upload(up.mp4, done.mp4, 'video/mp4');
    const vttUrl = await upload(up.vtt, vttFile, 'text/vtt');
    const posterUrl = fs.existsSync(poster) ? await upload(up.poster, poster, 'image/jpeg') : null;
    await call('video_done', { ...ids, url, vtt: vttUrl, poster: posterUrl, duration: +done.mdur.toFixed(2), narration: v.narration, cues });
    await log(`klar: ${url}`);
    fs.writeFileSync(path.join(tmp, 'info.json'), JSON.stringify({ ...ids, title: v.title, narration: v.narration, url, ok: true }, null, 1));
  } catch (e) {
    await log(String(e?.message || e).slice(0, 1500), 'error');
    try { fs.writeFileSync(path.join(tmp, 'info.json'), JSON.stringify({ ...ids, ok: false, error: String(e?.message || e) }, null, 1)); } catch { /* */ }
    try { await call('video_done', { ...ids, error: String(e?.message || e).slice(0, 300) }); } catch { /* */ }
    process.exitCode = 1;
  }
}

// ---------- Start ----------
const [mode, a, b] = process.argv.slice(2);
if (mode === 'list') {
  const { items = [] } = await call('video_todo', { limit: Number(process.env.FILM_LIMIT) || 6 });
  const ok = items.filter((x) => UUID.test(x.quiz_id) && SAFE_ID.test(x.concept_id));
  console.log(`${ok.length} filmer att göra:`, ok.map((x) => `${x.title} / ${x.name}`).join('; '));
  const out = JSON.stringify(ok.map((x) => ({ quiz_id: x.quiz_id, concept_id: x.concept_id })));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `items=${out}\n`);
} else if (mode === 'one') {
  await one(a, b);
} else {
  console.error('Använd: node render.mjs list | one <quiz_id> <concept_id>');
  process.exitCode = 2;
}

