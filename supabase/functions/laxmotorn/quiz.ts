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
