// Läxmotorn API (edge function "laxmotorn", verify_jwt av: autentiseringen görs här).
//
// Inloggad vuxen (Authorization: Bearer <JWT>, e-post i ALLOWED_EMAILS), svaret strömmas som text:
//   {action:"quiz", grade, hard, text, links, images, split, basis?}  förhör med förklaringsklipp (JSON);
//                                                              basis "kursplan" = bara rubrik, bygg på Lgr22
//   {action:"transcribe", from, to, total, images}             skriv av läxsidor
//   {action:"concepts", grade, quiz:{title,stations,flash}}    förklaringsklipp till ett befintligt förhör
// Fel: JSON {code} med status ≥ 400, eller "\n\u0000ERR:<code>" sist i strömmen.
//
// Barnkonton (JSON):
//   {action:"kid_account", child_id, username, password}  förälder skapar eller ändrar barnets inloggning
//   {action:"kid_login", username, password}              barnet loggar in; svarar med session
//
// Apps Script (body.token = households.ingest_token), svarar JSON:
//   {action:"ping", token}
//   {action:"ingest", token, message:{id, subject, date, body}}  Unikum-mejl → kommande prov hos rätt barn
//   {action:"todo", token}                                      väntande prov som kan bli förslag
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

// Moderna språk och ord som avslöjar dem (för att hoppa över språk barnet inte läser).
const LANGS: Record<string, string[]> = {
  tyska: ["tyska", "deutsch", "hausaufgabe"],
  spanska: ["spanska", "español", "espanol"],
  franska: ["franska", "français", "francais"],
  italienska: ["italienska", "italiano"],
  kinesiska: ["kinesiska"],
};

const str = (v: unknown, m: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, m) : "");
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// ---------- Barnkonton ----------
// Barnet loggar in med användarnamn. Bakom finns ett vanligt konto med förälderns e-post plus en tagg
// (förälder+lm-namn@...), så att eventuella mejl från inloggningen hamnar hos föräldern.
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const normUser = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "") : "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kidAccount(parent: { user: Any; email: string }, b: Any) {
  const childId = typeof b.child_id === "string" && UUID.test(b.child_id) ? b.child_id : "";
  const username = normUser(b.username), password = typeof b.password === "string" ? b.password : "";
  if (!childId || !USERNAME.test(username)) return fail(400, "bad_username");
  if (password.length < 6 || password.length > 72) return fail(400, "bad_password");
  const { data: kid } = await admin.from("children").select("id,name,household_id").eq("id", childId).maybeSingle();
  if (!kid) return fail(404, "not_found");
  const { count } = await admin.from("household_members").select("user_id", { count: "exact", head: true })
    .eq("household_id", kid.household_id).eq("user_id", parent.user.id).in("role", ["owner", "parent"]);
  if (!count) return fail(403, "not_parent");

  const { data: taken } = await admin.from("kid_logins").select("child_id").eq("username", username).maybeSingle();
  if (taken && taken.child_id !== childId) return fail(409, "username_taken");
  const { data: existing } = await admin.from("kid_logins").select("user_id,username").eq("child_id", childId).maybeSingle();

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.user_id, { password });
    if (error) { console.error(error); return fail(400, "bad_password"); }
    if (existing.username !== username) await admin.from("kid_logins").update({ username }).eq("child_id", childId);
    return json({ ok: true, username, created: false });
  }

  const [local, domain] = parent.email.split("@");
  const email = `${local.split("+")[0]}+lm-${username}@${domain}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { role: "child", child_id: childId, username },
  });
  if (error || !created?.user) { console.error(error); return fail(400, /already/i.test(error?.message ?? "") ? "username_taken" : "create_failed"); }
  const uid = created.user.id;
  const m = await admin.from("household_members").insert({ household_id: kid.household_id, user_id: uid, role: "child", child_id: childId });
  const l = m.error ? m : await admin.from("kid_logins").insert({ username, user_id: uid, child_id: childId, household_id: kid.household_id });
  if (m.error || l.error) {
    console.error(m.error ?? l.error);
    await admin.auth.admin.deleteUser(uid);
    return fail(500, "create_failed");
  }
  return json({ ok: true, username, created: true });
}

async function kidLogin(b: Any) {
  const username = normUser(b.username), password = typeof b.password === "string" ? b.password : "";
  const bad = async () => { await sleep(700); return fail(401, "bad_login"); };
  if (!USERNAME.test(username) || !password) return bad();
  const { data: row } = await admin.from("kid_logins").select("user_id").eq("username", username).maybeSingle();
  if (!row) return bad();
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  if (!u?.user?.email) return bad();
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: u.user.email, password });
  if (error || !data.session) return bad();
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}

// ---------- Mejl → kommande prov ----------
async function ingest(hh: { id: string }, m: Any) {
  const id = str(m?.id, 200), subject = str(m?.subject, 300), body = typeof m?.body === "string" ? m.body.slice(0, 20000) : "";
  const sent = typeof m?.date === "string" && !isNaN(Date.parse(m.date)) ? new Date(m.date) : new Date();
  if (!id || !body) return fail(400, "bad_request");

  // Mejl som tidigare saknade barn läses om (t.ex. när ett barn eller en klasskod har lagts till).
  const { data: done } = await admin.from("mail_imports").select("message_id,result").eq("household_id", hh.id).eq("message_id", id).maybeSingle();
  if (done && done.result?.skipped !== "no_child") return json({ skipped: "already_imported", items: [] });

  const { data: kids } = await admin.from("children").select("id,name,grade,class_codes,languages").eq("household_id", hh.id);
  const hay = (subject + "\n" + body.slice(0, 600)).toUpperCase();
  const child = (kids ?? []).find((k: Any) => (k.class_codes ?? []).some((c: string) => c && hay.includes(c.toUpperCase())));
  const log = (result: unknown, childId: string | null = null) =>
    admin.from("mail_imports").upsert({ household_id: hh.id, message_id: id, received_at: sent.toISOString(), subject, child_id: childId, result });
  if (!child) { if (!done) await log({ skipped: "no_child" }); return json({ skipped: done ? "already_imported" : "no_child", items: [] }); }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const prompt = mailPrompt({
    today, sent: sent.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }),
    subject, body, child: child.name, grade: child.grade, languages: child.languages ?? [],
  });
  const otherLang = (s: string) => {
    const mine = (child.languages ?? []).map((l: string) => l.toLowerCase());
    if (!mine.length) return false;
    const low = s.toLowerCase();
    return Object.entries(LANGS).some(([sv, words]) => !mine.includes(sv) && words.some((w) => low.includes(w)));
  };
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
    if (subj === "annat" && otherLang(`${title} ${what}`)) continue; // språk som barnet inte läser (inte "franska revolutionen")
    let basis = ["mejl", "kursplan", "material"].includes(it?.basis) ? it.basis : (it?.enough === true ? "mejl" : "material");
    if (basis === "mejl" && what.length < 40) basis = "kursplan";
    const enough = basis !== "material";
    const missing = basis === "material" ? str(it?.missing, 200) : "";
    const key = `${child.id}|${subj}|${date ?? (week ? "v" + week : slug(title))}`;
    const msg = { id, subject, sent: sent.toISOString(), what, missing };

    const { data: ex } = await admin.from("quizzes").select("id,status,test_date,source").eq("household_id", hh.id).eq("dedupe_key", key).maybeSingle();
    if (ex) {
      const src = ex.source ?? {};
      const msgs = Array.isArray(src.messages) ? src.messages : [];
      if (!msgs.some((x: Any) => x.id === id)) msgs.push(msg);
      // Bästa underlaget vinner: mejl > kursplan > material.
      const rank = (b: string) => ({ mejl: 3, kursplan: 2, material: 1 } as Record<string, number>)[b] ?? 0;
      const best = rank(basis) > rank(src.basis) ? basis : (src.basis ?? basis);
      const upd: Any = { source: { ...src, messages: msgs, basis: best, enough: best !== "material", missing: best === "material" ? (src.missing || missing) : "" } };
      if (!ex.test_date && date) upd.test_date = date;
      await admin.from("quizzes").update(upd).eq("id", ex.id);
      out.push({ quiz_id: ex.id, title, status: ex.status, enough: upd.source.enough, new: false });
    } else {
      const { data: row, error } = await admin.from("quizzes").insert({
        household_id: hh.id, child_id: child.id, title, subject: subj, grade: child.grade, test_date: date,
        status: "pending", content: {}, dedupe_key: key,
        source: { from: "unikum", kind, week, basis, enough, missing, messages: [msg] },
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
      const raw = extractJson(await complete([{ type: "text", text: quizPrompt({ grade: String(q.grade ?? 4), hard: false, imgCount: 0, split: false, text, links: [], basis: src.basis }) }]));
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
        source: { ...(cur?.source ?? src), preparing_at: null, prepare_error: e instanceof ClaudeError ? e.code : "upstream", prepare_failed_at: new Date().toISOString() },
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
    if (action === "ping" || action === "ingest" || action === "prepare" || action === "todo") {
      const hh = await tokenAuth(body.token);
      if (!hh) return fail(401, "bad_token");
      if (action === "ping") {
        const { data: kids } = await admin.from("children").select("name,class_codes,languages").eq("household_id", hh.id);
        return json({ ok: true, household: hh.name, children: kids });
      }
      if (action === "todo") {
        // Väntande prov som har underlag men inget förslag än (misslyckade försöker igen efter en timme).
        const { data: rows } = await admin.from("quizzes").select("id,title,source").eq("household_id", hh.id).eq("status", "pending");
        const now = Date.now();
        const ids = (rows ?? []).filter((r: Any) => {
          const s = r.source ?? {};
          if (!s.enough) return false;
          if (s.preparing_at && now - Date.parse(s.preparing_at) < 5 * 60_000) return false;
          if (s.prepare_error && s.prepare_failed_at && now - Date.parse(s.prepare_failed_at) < 60 * 60_000) return false;
          return true;
        }).map((r: Any) => ({ quiz_id: r.id, title: r.title }));
        return json({ items: ids });
      }
      if (action === "ingest") return await ingest(hh, body.message);
      return await prepare(hh, body.quiz_id);
    }

    if (action === "kid_login") return await kidLogin(body);

    const who = await userAuth(req);
    if (!who) return fail(401, "session_expired");
    // Bara föräldrar: barnkonton får aldrig skapa förhör eller konton.
    const { count } = await admin.from("household_members").select("user_id", { count: "exact", head: true })
      .eq("user_id", who.user.id).in("role", ["owner", "parent"]);
    if (!count) return fail(403, "no_household");
    if (action === "kid_account") return await kidAccount(who, body);
    if (!who.allowed) return fail(403, "not_granted");

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
      const basis = body.basis === "kursplan" ? "kursplan" : undefined;
      const prompt = quizPrompt({ grade, hard: !!body.hard, imgCount: imgs.length / 2, split: !!body.split, text, links, basis });
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
