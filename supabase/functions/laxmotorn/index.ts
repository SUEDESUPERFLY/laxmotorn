// Läxmotorn API (edge function "laxmotorn", verify_jwt av: autentiseringen görs här).
//
// Inloggad vuxen (Authorization: Bearer <JWT>, e-post i ALLOWED_EMAILS), svaret strömmas som text:
//   {action:"quiz", grade, hard, text, links, images, split}   förhör med förklaringsklipp (JSON)
//   {action:"transcribe", from, to, total, images}             skriv av läxsidor
//   {action:"concepts", grade, quiz:{title,stations,flash}}    förklaringsklipp till ett befintligt förhör
// Fel: JSON {code} med status ≥ 400, eller "\n\u0000ERR:<code>" sist i strömmen.
//
// Apps Script (body.token = households.ingest_token), svarar JSON:
//   {action:"ping", token}
//   {action:"ingest", token, message:{id, subject, date, body}}  Unikum-mejl → kommande prov hos rätt barn
//   {action:"prepare", token, quiz_id}                          gör förhörsförslag i bakgrunden (202)
//
// Hemligheter: ANTHROPIC_API_KEY, ALLOWED_EMAILS, valfria CLAUDE_MODEL och CLAUDE_EFFORT.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ClaudeError, complete, open, pump } from "./claude.ts";
import { conceptsPrompt, mailPrompt, quizPrompt, SUBJECTS, transcribePrompt } from "./prompts.ts";
import { extractJson, sanitize } from "./quiz.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (status: number, code: string) => json({ code }, status);

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
// deno-lint-ignore no-explicit-any
const bg = (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil(p);

const MAX_IMAGES = 20, MAX_IMAGE_B64 = 10 * 1024 * 1024, MAX_TOTAL_B64 = 28 * 1024 * 1024, MAX_TEXT = 150_000;
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function userAuth(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (!email) return null;
  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { user: data.user!, email, allowed: allowed.includes(email) };
}

async function tokenAuth(token: unknown) {
  if (typeof token !== "string" || !UUID.test(token)) return null;
  const { data } = await admin.from("households").select("id,name").eq("ingest_token", token).maybeSingle();
  return data;
}

function imageBlocks(imgs: unknown) {
  const list = Array.isArray(imgs) ? imgs : [];
  if (list.length > MAX_IMAGES) throw new ClaudeError("prompt_too_large", 413);
  const out: Any[] = [];
  let total = 0;
  list.forEach((im: Any, i: number) => {
    if (typeof im?.data !== "string" || !MEDIA.has(im?.media_type)) throw new ClaudeError("image_rejected", 400);
    if (im.data.length > MAX_IMAGE_B64) throw new ClaudeError("image_rejected", 413);
    total += im.data.length;
    out.push({ type: "text", text: `Bild ${i + 1}:` }, { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  });
  if (total > MAX_TOTAL_B64) throw new ClaudeError("prompt_too_large", 413);
  return out;
}

// Strömmar Claudes text till klienten. waitUntil håller arbetaren vid liv tills strömmen är klar.
async function streamOut(content: Any[], signal: AbortSignal, o: { effort?: string; maxTokens?: number } = {}) {
  const body = await open(content, { ...o, signal });
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  const put = (s: string) => { w.write(enc.encode(s)).catch(() => {}); };
  bg((async () => {
    try { await pump(body, put); } catch (e) {
      if ((e as Error)?.name !== "AbortError") put(`\n\u0000ERR:${e instanceof ClaudeError ? e.code : "upstream"}`);
    } finally { await w.close().catch(() => {}); }
  })());
  return new Response(readable, { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}

const str = (v: unknown, m: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, m) : "");
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// ---------- Mejl → kommande prov ----------
async function ingest(hh: { id: string }, m: Any) {
  const id = str(m?.id, 200), subject = str(m?.subject, 300), body = typeof m?.body === "string" ? m.body.slice(0, 20000) : "";
  const sent = typeof m?.date === "string" && !isNaN(Date.parse(m.date)) ? new Date(m.date) : new Date();
  if (!id || !body) return fail(400, "bad_request");

  const { data: done } = await admin.from("mail_imports").select("message_id").eq("household_id", hh.id).eq("message_id", id).maybeSingle();
  if (done) return json({ skipped: "already_imported", items: [] });

  const { data: kids } = await admin.from("children").select("id,name,grade,class_codes").eq("household_id", hh.id);
  const hay = (subject + "\n" + body.slice(0, 600)).toUpperCase();
  const child = (kids ?? []).find((k: Any) => (k.class_codes ?? []).some((c: string) => c && hay.includes(c.toUpperCase())));
  const log = (result: unknown, childId: string | null = null) =>
    admin.from("mail_imports").insert({ household_id: hh.id, message_id: id, received_at: sent.toISOString(), subject, child_id: childId, result });
  if (!child) { await log({ skipped: "no_child" }); return json({ skipped: "no_child", items: [] }); }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const prompt = mailPrompt({
    today, sent: sent.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }),
    subject, body, child: child.name, grade: child.grade,
  });
  const parsed = extractJson(await complete([{ type: "text", text: prompt }], { effort: "low", maxTokens: 6000 }));
  if (!parsed || !Array.isArray(parsed.items)) throw new ClaudeError("invalid_json");

  const out: Any[] = [];
  for (const it of parsed.items.slice(0, 8)) {
    const title = str(it?.title, 60);
    if (!title) continue;
    const subj = SUBJECTS.includes(it?.subject) ? it.subject : "annat";
    const date = typeof it?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.date) && !isNaN(Date.parse(it.date)) ? it.date : null;
    const week = Number.isInteger(it?.week) && it.week >= 1 && it.week <= 53 ? it.week : null;
    if (date && date < today) continue; // provet har redan varit
    const what = typeof it?.what === "string" ? it.what.trim().slice(0, 4000) : "";
    const kind = ["prov", "läxförhör", "läxa", "övning"].includes(it?.kind) ? it.kind : "prov";
    const enough = it?.enough === true && what.length >= 40;
    const missing = str(it?.missing, 200);
    const key = `${child.id}|${subj}|${date ?? (week ? "v" + week : slug(title))}`;
    const msg = { id, subject, sent: sent.toISOString(), what, missing };

    const { data: ex } = await admin.from("quizzes").select("id,status,test_date,source").eq("household_id", hh.id).eq("dedupe_key", key).maybeSingle();
    if (ex) {
      const src = ex.source ?? {};
      const msgs = Array.isArray(src.messages) ? src.messages : [];
      if (!msgs.some((x: Any) => x.id === id)) msgs.push(msg);
      const upd: Any = { source: { ...src, messages: msgs, enough: !!(src.enough || enough), missing: enough ? "" : (src.missing || missing) } };
      if (!ex.test_date && date) upd.test_date = date;
      await admin.from("quizzes").update(upd).eq("id", ex.id);
      out.push({ quiz_id: ex.id, title, status: ex.status, enough: upd.source.enough, new: false });
    } else {
      const { data: row, error } = await admin.from("quizzes").insert({
        household_id: hh.id, child_id: child.id, title, subject: subj, grade: child.grade, test_date: date,
        status: "pending", content: {}, dedupe_key: key,
        source: { from: "unikum", kind, week, enough, missing, messages: [msg] },
      }).select("id").single();
      if (error) { console.error(error); continue; }
      out.push({ quiz_id: row.id, title, status: "pending", enough, new: true });
    }
  }
  await log({ items: out }, child.id);
  return json({ child: child.name, items: out });
}

// ---------- Förhörsförslag i bakgrunden ----------
async function prepare(hh: { id: string }, quizId: unknown) {
  if (typeof quizId !== "string" || !UUID.test(quizId)) return fail(400, "bad_request");
  const { data: q } = await admin.from("quizzes").select("id,title,subject,grade,status,source,child_id")
    .eq("id", quizId).eq("household_id", hh.id).maybeSingle();
  if (!q) return fail(404, "not_found");
  if (q.status !== "pending") return json({ skipped: q.status });
  const src = q.source ?? {};
  if (src.preparing_at && Date.now() - Date.parse(src.preparing_at) < 5 * 60_000) return json({ skipped: "preparing" });
  await admin.from("quizzes").update({ source: { ...src, preparing_at: new Date().toISOString(), prepare_error: null } }).eq("id", q.id);

  const text = [`Ämne: ${q.title}`, ...(src.messages ?? []).map((m: Any) => m.what).filter(Boolean)].join("\n\n");
  bg((async () => {
    try {
      const raw = extractJson(await complete([{ type: "text", text: quizPrompt({ grade: String(q.grade ?? 4), hard: false, imgCount: 0, split: false, text, links: [] }) }]));
      const d = sanitize(raw);
      if (!d) throw new ClaudeError("bad_shape");
      const { data: cur } = await admin.from("quizzes").select("status,source").eq("id", q.id).single();
      if (cur?.status !== "pending") return; // någon hann före i appen
      await admin.from("quizzes").update({
        status: "draft", summary: d.summary,
        content: { stations: d.stations, flash: d.flash, notes: d.notes, links: d.links, concepts: d.concepts },
        source: { ...(cur.source ?? src), preparing_at: null, prepared_at: new Date().toISOString(), prepare_error: null },
      }).eq("id", q.id);
    } catch (e) {
      console.error("prepare", q.id, e);
      const { data: cur } = await admin.from("quizzes").select("source").eq("id", q.id).single();
      await admin.from("quizzes").update({
        source: { ...(cur?.source ?? src), preparing_at: null, prepare_error: e instanceof ClaudeError ? e.code : "upstream" },
      }).eq("id", q.id);
    }
  })());
  return json({ started: true }, 202);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method");
  let body: Any;
  try { body = await req.json(); } catch { return fail(400, "bad_request"); }
  const action = body?.action;

  try {
    if (action === "ping" || action === "ingest" || action === "prepare") {
      const hh = await tokenAuth(body.token);
      if (!hh) return fail(401, "bad_token");
      if (action === "ping") {
        const { data: kids } = await admin.from("children").select("name,class_codes").eq("household_id", hh.id);
        return json({ ok: true, household: hh.name, children: kids });
      }
      if (action === "ingest") return await ingest(hh, body.message);
      return await prepare(hh, body.quiz_id);
    }

    const who = await userAuth(req);
    if (!who) return fail(401, "session_expired");
    if (!who.allowed) return fail(403, "not_granted");
    const { count } = await admin.from("household_members").select("user_id", { count: "exact", head: true }).eq("user_id", who.user.id);
    if (!count) return fail(403, "no_household");

    const grade = String(Math.min(9, Math.max(1, Number(body.grade) || 4)));
    if (action === "transcribe") {
      const n = Number(body.total) || 1, a = Number(body.from) || 1, b = Number(body.to) || n;
      return await streamOut([...imageBlocks(body.images), { type: "text", text: transcribePrompt(a, b, n) }], req.signal, { maxTokens: 16000, effort: "low" });
    }
    if (action === "quiz") {
      const imgs = imageBlocks(body.images);
      const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : "";
      const links = (Array.isArray(body.links) ? body.links : []).filter((u: unknown) => typeof u === "string").slice(0, 30);
      if (!text.trim() && !imgs.length) return fail(400, "bad_request");
      const prompt = quizPrompt({ grade, hard: !!body.hard, imgCount: imgs.length / 2, split: !!body.split, text, links });
      return await streamOut([...imgs, { type: "text", text: prompt }], req.signal);
    }
    if (action === "concepts") {
      const qz = body.quiz;
      if (!qz || !Array.isArray(qz.stations) || !qz.stations.length) return fail(400, "bad_request");
      const lite = { title: str(qz.title, 60), stations: qz.stations.slice(0, 10).map((s: Any) => ({ name: str(s?.name, 60), qs: (s?.qs ?? []).slice(0, 14) })), flash: (qz.flash ?? []).slice(0, 20) };
      if (JSON.stringify(lite).length > MAX_TEXT) return fail(413, "prompt_too_large");
      return await streamOut([{ type: "text", text: conceptsPrompt(grade, lite) }], req.signal, { maxTokens: 16000 });
    }
    return fail(400, "unknown_action");
  } catch (e) {
    if (e instanceof ClaudeError) return fail(e.status, e.code);
    console.error(e);
    return fail(500, "server_error");
  }
});
