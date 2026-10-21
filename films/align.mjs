// Ordtider utan taligenkänning: vi känner texten exakt och hittar talets pauser i ljudet (ffmpeg silencedetect).
// Talet delas i fraser vid pauser; texten delas vid skiljetecken. Stämmer antalet paras de ihop en och en,
// annars fördelas texten efter teckenlängd över den sammanlagda taltiden. Varje fras får ordtider efter längd.
import { execFileSync, spawnSync } from 'node:child_process';

export function speechIntervals(file, { noise = -35, minSil = 0.3 } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `silencedetect=noise=${noise}dB:d=${minSil}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const out = (r.stderr || '') + (r.stdout || '');
  return parseSilence(out, duration(file));
}
export function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}
function parseSilence(log, dur) {
  const sil = []; let s = null;
  for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') s = Number(m[2]); else if (s !== null) { sil.push([s, Number(m[2])]); s = null; }
  }
  if (s !== null) sil.push([s, dur]);
  const speech = []; let t = 0;
  for (const [a, b] of sil) { if (a - t > 0.05) speech.push([t, a]); t = b; }
  if (dur - t > 0.05) speech.push([t, dur]);
  return speech;
}
// Delar listan a (andelar) i m sammanhängande grupper så att gruppsummorna ligger nära b (andelar). Ger gruppgränser.
function groupDP(a, b) {
  const n = a.length, m = b.length, pre = [0]; a.forEach((x) => pre.push(pre.at(-1) + x));
  const INF = 1e9, D = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(INF)), P = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(-1));
  D[0][0] = 0;
  for (let k = 1; k <= m; k++) for (let i = k; i <= n - (m - k); i++) for (let j = k - 1; j < i; j++) {
    const c = D[k - 1][j] + (pre[i] - pre[j] - b[k - 1]) ** 2; if (c < D[k][i]) { D[k][i] = c; P[k][i] = j; }
  }
  const cuts = []; let i = n; for (let k = m; k > 0; k--) { cuts.unshift([P[k][i], i]); i = P[k][i]; }
  return cuts;
}
// Ord med (start, slut) i sekunder i ljudfilen.
export function alignWords(text, speech) {
  const phrases = text.split(/(?<=[.,!?;:–—])\s+/).map((p) => p.trim()).filter(Boolean);
  const weight = (s) => (s.toLowerCase().match(/[aeiouyåäö]/g) || []).length + 0.3;
  const W = phrases.reduce((a, p) => a + weight(p), 0), T = speech.reduce((a, [x, y]) => a + (y - x), 0);
  let pairs;
  if (phrases.length >= speech.length) {
    // Fler fraser än pauser: slå ihop fraser.
    const g = groupDP(phrases.map((p) => weight(p) / W), speech.map(([x, y]) => (y - x) / T));
    pairs = g.flatMap(([i0, i1], k) => {
      const [x, y] = speech[k], ps = phrases.slice(i0, i1), w = ps.reduce((a, p) => a + weight(p), 0); let c = 0;
      return ps.map((p) => { const a = x + (y - x) * c / w; c += weight(p); return [p, [a, x + (y - x) * c / w]]; });
    });
  } else {
    // Fler pauser än fraser: slå ihop talintervall (pauser inne i en fras).
    const g = groupDP(speech.map(([x, y]) => (y - x) / T), phrases.map((p) => weight(p) / W));
    pairs = g.map(([i0, i1], k) => [phrases[k], [speech[i0][0], speech[i1 - 1][1]]]);
  }
  const words = [];
  for (const [p, [a, b]] of pairs) {
    const ws = p.split(/\s+/).filter(Boolean), tot = ws.reduce((s, w) => s + weight(w), 0);
    let c = 0;
    for (const w of ws) { const s0 = a + (b - a) * c / tot; c += weight(w); words.push({ w, start: +s0.toFixed(2), end: +(a + (b - a) * c / tot).toFixed(2) }); }
  }
  return words;
}
