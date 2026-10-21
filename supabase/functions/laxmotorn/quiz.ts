// Tvätt av Claudes förhörs-JSON. Samma regler som sanitize() i src/index.html; ändra båda ihop.
import { ICON_KEYS, SUBJECTS } from "./prompts.ts";

const clean = (s: unknown, m: number) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, m) : (typeof s === "number" && isFinite(s) ? String(s) : "");
const cleanBlock = (s: unknown, m: number) =>
  typeof s === "string" ? s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, m) : "";
const list = (v: unknown, m: number) => (Array.isArray(v) ? v : []).map((x) => clean(x, m)).filter(Boolean);

// deno-lint-ignore no-explicit-any
type Any = any;

export function cleanQ(q: Any, ids: Set<string>) {
  if (!q || typeof q !== "object") return null;
  const t = q.t, text = clean(q.q, 300), why = clean(q.why, 400);
  if (!text) return null;
  const c = ids.has(q.c) ? { c: q.c } : {};
  if (t === "mc") { const opts = list(q.opts, 160), a = Number(q.a); if (opts.length < 2 || opts.length > 6 || !Number.isInteger(a) || a < 0 || a >= opts.length || new Set(opts).size !== opts.length) return null; return { t, q: text, opts, a, why, ...c }; }
  if (t === "tf") { let a = q.a; if (a === "true") a = true; if (a === "false") a = false; if (typeof a !== "boolean") return null; return { t, q: text, a, why, ...c }; }
  if (t === "multi") { const opts = list(q.opts, 160); if (opts.length < 3 || opts.length > 8 || new Set(opts).size !== opts.length) return null; const a = [...new Set<number>((Array.isArray(q.a) ? q.a : []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < opts.length).sort((x, y) => x - y); if (!a.length || a.length === opts.length) return null; return { t, q: text, opts, a, why, ...c }; }
  if (t === "order") { const items = list(q.items, 140); if (items.length < 2 || items.length > 7 || new Set(items).size !== items.length) return null; return { t, q: text, items, why, ...c }; }
  if (t === "write") { const acc = list(q.acc, 60); if (!acc.length) return null; return { t, q: text, acc, why, ...c }; }
  if (t === "explain") { const points = list(q.points, 160).slice(0, 4), model = clean(q.model, 500); if (!points.length || !model) return null; return { t, q: text, points, model, why, ...c }; }
  return null;
}

const SHOW_TYPES = new Set(["term", "list", "steps", "cycle", "compare"]);
function cleanItems(v: Any, say: string, max: number) {
  const low = say.toLowerCase();
  return (Array.isArray(v) ? v : []).map((it: Any) => {
    const t = clean(it?.t, 40); if (!t) return null;
    const cue = clean(it?.cue, 40);
    return cue && low.includes(cue.toLowerCase()) ? { t, cue } : { t };
  }).filter(Boolean).slice(0, max);
}
export function cleanConcepts(v: Any) {
  const out: Any[] = [], seen = new Set<string>();
  for (const k of Array.isArray(v) ? v : []) {
    const id = clean(k?.id, 12), name = clean(k?.name, 40), say = clean(k?.say, 400);
    if (!id || seen.has(id) || !name || !say) continue;
    const s = k.show || {}, type = SHOW_TYPES.has(s.type) ? s.type : "term";
    let show: Any;
    if (type === "term") {
      const word = clean(s.word, 40) || name, def = clean(s.def, 120), cue = clean(s.cue, 40);
      show = { type, word, def, ...(cue && say.toLowerCase().includes(cue.toLowerCase()) ? { cue } : {}) };
    } else if (type === "compare") {
      const side = (x: Any) => ({ title: clean(x?.title, 30), items: cleanItems(x?.items, say, 4) });
      const left = side(s.left), right = side(s.right);
      if (!left.title || !right.title || !left.items.length || !right.items.length) show = { type: "term", word: name, def: "" };
      else show = { type, left, right };
    } else {
      const items = cleanItems(s.items, say, 5);
      show = items.length >= 2 ? { type, title: clean(s.title, 40), items } : { type: "term", word: name, def: "" };
    }
    seen.add(id);
    out.push({ id, name, icon: ICON_KEYS.includes(k.icon) ? k.icon : "book", say, show });
  }
  return out.slice(0, 12);
}

export function sanitize(d: Any) {
  if (!d || typeof d !== "object" || !Array.isArray(d.stations)) return null;
  const concepts = cleanConcepts(d.concepts), ids = new Set(concepts.map((k) => k.id));
  const stations = d.stations.slice(0, 10).map((s: Any, i: number) => ({
    id: "s" + (i + 1), name: clean(s?.name, 60) || `Del ${i + 1}`, sub: clean(s?.sub, 90),
    icon: ICON_KEYS.includes(s?.icon) ? s.icon : "book",
    qs: (Array.isArray(s?.qs) ? s.qs : []).map((q: Any) => cleanQ(q, ids)).filter(Boolean).slice(0, 14),
  })).filter((s: Any) => s.qs.length >= 3);
  if (!stations.length) return null;
  const flash = (Array.isArray(d.flash) ? d.flash : []).map((f: Any) => ({ q: clean(f?.q, 300), a: cleanBlock(f?.a, 1500) })).filter((f: Any) => f.q && f.a).slice(0, 20);
  const notes = list(d.notes, 300).slice(0, 10);
  const links = (Array.isArray(d.links) ? d.links : []).map((l: Any) => {
    try { const u = new URL(String(l?.url || "").trim()); return /^https?:$/.test(u.protocol) ? { url: u.href, title: clean(l?.title, 90) || u.hostname } : null; } catch { return null; }
  }).filter(Boolean).slice(0, 30);
  return {
    title: clean(d.title, 60) || "Ny läxa", subject: SUBJECTS.includes(d.subject) ? d.subject : "annat",
    summary: clean(d.summary, 220), stations, flash, notes, links, concepts,
  };
}

export function extractJson(t: string) {
  t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// En fördjupningsnivå: id:n får prefix (L2s1, L2k1) så att de inte krockar med nivå 1.
export function sanitizeLevel(d: Any, n: number, existing: Set<string>) {
  if (!d || typeof d !== "object" || !Array.isArray(d.stations)) return null;
  const raw = cleanConcepts(d.concepts), map = new Map<string, string>();
  const concepts = raw.map((k) => { const id = `L${n}${k.id}`.slice(0, 12); map.set(k.id, id); return { ...k, id }; });
  const ids = new Set([...existing, ...map.values()]);
  const remap = (q: Any) => (q && typeof q === "object" ? { ...q, c: map.get(q.c) ?? q.c } : q);
  const stations = d.stations.slice(0, 5).map((s: Any, i: number) => ({
    id: `L${n}s${i + 1}`, lv: n, name: clean(s?.name, 60) || `Del ${i + 1}`, sub: clean(s?.sub, 90),
    icon: ICON_KEYS.includes(s?.icon) ? s.icon : "book",
    qs: (Array.isArray(s?.qs) ? s.qs : []).map((q: Any) => cleanQ(remap(q), ids)).filter(Boolean).slice(0, 10),
  })).filter((s: Any) => s.qs.length >= 3);
  if (!stations.length) return null;
  return { stations, concepts };
}

// Förklaringsfilm: say + steg med element på en duk 800 × 500. Samma regler som fEl/fNorm i src/index.html.
const FW = 800, FH = 500;
const TONES = ["ink", "accent", "warm", "cool", "alert", "muted"];
const PATH = /^[MLHVCSQTAZmlhvcsqtaz0-9eE.,\s-]{1,900}$/;
const num = (v: unknown, a: number, b: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, Math.round(n * 10) / 10)) : d; };
function filmEl(e: Any, props: string[]) {
  if (!e || typeof e !== "object") return null;
  const tone = TONES.includes(e.tone) ? { tone: e.tone } : {};
  const X = (v: unknown) => num(v, 0, FW, FW / 2), Y = (v: unknown) => num(v, 0, FH, FH / 2);
  const to = Array.isArray(e.to) && e.to.length === 2 ? { to: [X(e.to[0]), Y(e.to[1])] } : {};
  const size = (d: number, ok = [1, 2, 3]) => (ok.includes(Number(e.size)) ? Number(e.size) : d);
  switch (e.k) {
    case "prop": return { k: "prop", n: props.includes(e.n) ? e.n : "dot", x: X(e.x), y: Y(e.y), s: num(e.s, 30, 300, 120), label: clean(e.label, 32), lp: ["t", "b", "l", "r"].includes(e.lp) ? e.lp : "b", ...tone, ...to };
    case "text": { const t = clean(e.t, 90); return t ? { k: "text", t, x: X(e.x), y: Y(e.y), size: size(2), a: ["s", "m", "e"].includes(e.a) ? e.a : "m", w: num(e.w, 80, 780, 720), ...tone, ...to } : null; }
    case "arrow": case "line": return { k: e.k, x1: X(e.x1), y1: Y(e.y1), x2: X(e.x2), y2: Y(e.y2), bend: num(e.bend, -1, 1, 0), label: clean(e.label, 32), flow: !!e.flow, dash: !!e.dash, ...tone };
    case "path": { const d = typeof e.d === "string" ? e.d.trim() : ""; return PATH.test(d) ? { k: "path", d, fill: !!e.fill, ...tone } : null; }
    case "box": { const x = num(e.x, 0, FW - 20, 0), y = num(e.y, 0, FH - 20, 0); return { k: "box", x, y, w: num(e.w, 20, FW - x, 120), h: num(e.h, 20, FH - y, 70), label: clean(e.label, 60), size: size(1, [1, 2]), fill: e.fill !== false, ...tone }; }
    case "circle": return { k: "circle", x: X(e.x), y: Y(e.y), r: num(e.r, 8, 220, 50), label: clean(e.label, 40), fill: e.fill !== false, ...tone };
    case "words": {
      const words = list(e.words, 24).slice(0, 12); if (!words.length) return null;
      const hi = [...new Set<number>((Array.isArray(e.hi) ? e.hi : []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < words.length).sort((a, b) => a - b);
      const tags = (Array.isArray(e.tags) ? e.tags : [e.tag]).map((t: unknown) => clean(t, 24)).slice(0, 6);
      return { k: "words", x: X(e.x), y: Y(e.y), words, hi, tags, hiOnly: !!e.hiOnly && hi.length > 0, size: size(2), ...tone };
    }
    case "num": { const t = Number(e.to); if (!Number.isFinite(t) || Math.abs(t) > 1e9) return null;
      return { k: "num", x: X(e.x), y: Y(e.y), from: Number.isFinite(Number(e.from)) ? Number(e.from) : 0, to: t, dec: num(e.dec, 0, 3, 0), prefix: clean(e.prefix, 8), suffix: clean(e.suffix, 10), size: size(3), ...tone }; }
    case "mark": { const x = num(e.x, 0, FW - 10, 0), y = num(e.y, 0, FH - 10, 0); return { k: "mark", x, y, w: num(e.w, 10, FW - x, 100), h: num(e.h, 10, FH - y, 40), tone: TONES.includes(e.tone) ? e.tone : "warm" }; }
  }
  return null;
}
export function sanitizeFilm(f: Any, props: string[]) {
  if (!f || typeof f !== "object" || !Array.isArray(f.steps)) return null;
  const say = clean(f.say, 600); if (say.length < 20) return null;
  const low = say.toLowerCase(); let total = 0;
  const steps = f.steps.slice(0, 8).map((s: Any) => {
    const els = (Array.isArray(s?.els) ? s.els : []).map((e: Any) => filmEl(e, props)).filter(Boolean).slice(0, 8);
    const cue = clean(s?.cue, 40);
    return { cue: cue && low.includes(cue.toLowerCase()) ? cue : "", els };
  }).filter((s: Any) => s.els.length && (total += s.els.length) <= 30);
  return steps.length ? { v: 1, say, steps } : null;
}
