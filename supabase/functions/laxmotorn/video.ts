// Förklaringsfilmer som video. GitHub Actions (films/render.mjs) renderar med HyperFrames och anropar de här
// åtgärderna. Inloggning med GitHubs OIDC-token (rubriken x-github-oidc): bara arbetsflödet films.yml på main i SUEDESUPERFLY/laxmotorn
// släpps in, så inga hemligheter behöver ligga på GitHub. Claude och Speko anropas härifrån.
// deno-lint-ignore-file no-explicit-any
import { ClaudeError, complete } from "./claude.ts";
import { extractJson } from "./quiz.ts";
import { filmComposePrompt, filmReviewPrompt, filmScriptPrompt } from "./video_prompts.ts";

type Any = any;
const REPO = "suedesuperfly/laxmotorn";
const WORKFLOW = "suedesuperfly/laxmotorn/.github/workflows/films.yml@refs/heads/main";
const MAX_TRIES = 2;

// ---------- GitHub OIDC ----------
let jwks: { at: number; keys: Any[] } | null = null;
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
async function githubKeys(force = false) {
  if (!force && jwks && Date.now() - jwks.at < 3600_000) return jwks.keys;
  const r = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");
  jwks = { at: Date.now(), keys: (await r.json()).keys ?? [] };
  return jwks.keys;
}
export async function verifyGithub(req: Request) {
  // Egen rubrik, så att Supabase-gatewayen får den vanliga anon-nyckeln i Authorization.
  const jwt = (req.headers.get("x-github-oidc") ?? "").trim();
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
    if (head.alg !== "RS256") return null;
    let jwk = (await githubKeys()).find((k: Any) => k.kid === head.kid);
    if (!jwk) jwk = (await githubKeys(true)).find((k: Any) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    const now = Date.now() / 1000;
    if (!ok || claims.iss !== "https://token.actions.githubusercontent.com" || claims.aud !== "laxmotorn") return null;
    if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return null;
    if (String(claims.repository).toLowerCase() !== REPO || claims.ref !== "refs/heads/main") return null;
    if (String(claims.job_workflow_ref ?? claims.workflow_ref ?? "").toLowerCase() !== WORKFLOW) return null;
    return claims;
  } catch (e) {
    console.error("oidc", e);
    return null;
  }
}

// ---------- Hjälp ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, m: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, m) : "");
const ansOf = (q: Any) =>
  q.t === "mc" ? q.opts[q.a] : q.t === "tf" ? (q.a ? "sant" : "falskt") : q.t === "multi" ? q.a.map((i: number) => q.opts[i]).join(", ")
  : q.t === "order" ? q.items.join(" → ") : q.t === "write" ? q.acc[0] : q.t === "explain" ? q.model : "";
const stationsOf = (c: Any): Any[] => [...(c?.stations ?? []), ...((c?.levels ?? []) as Any[]).flatMap((l: Any) => l.stations ?? [])];
const SUBJ: Record<string, string> = { no: "NO", so: "SO", sv: "svenska", ma: "matematik", en: "engelska", annat: "övrigt" };

function questionsFor(c: Any, id: string) {
  return stationsOf(c).flatMap((st: Any) => (st.qs ?? []).filter((x: Any) => x.c === id)).slice(0, 5).map((x: Any) => {
    const wrong = x.t === "mc" ? x.opts.filter((_: string, i: number) => i !== x.a) : x.t === "multi" ? x.opts.filter((_: string, i: number) => !x.a.includes(i)) : [];
    return `- ${x.q} → ${ansOf(x)}${wrong.length ? ` [${wrong.join("; ")}]` : ""}`;
  });
}

async function loadConcept(admin: Any, quizId: unknown, conceptId: unknown) {
  if (typeof quizId !== "string" || !UUID.test(quizId) || typeof conceptId !== "string") return null;
  const { data: q } = await admin.from("quizzes").select("id,household_id,title,subject,grade,status,content").eq("id", quizId).maybeSingle();
  const k = (q?.content?.concepts ?? []).find((x: Any) => x.id === conceptId);
  return q && k ? { q, k } : null;
}

// Skriver concept.video (läser om innehållet först, så att samtidiga ändringar inte skrivs över mer än nödvändigt).
async function setVideo(admin: Any, quizId: string, conceptId: string, fn: (v: Any) => Any) {
  const { data: cur } = await admin.from("quizzes").select("content").eq("id", quizId).single();
  const c = cur?.content ?? {};
  const concepts = (c.concepts ?? []).map((k: Any) => (k.id === conceptId ? { ...k, video: fn(k.video ?? {}) } : k));
  await admin.from("quizzes").update({ content: { ...c, concepts } }).eq("id", quizId);
}

const publicUrl = (path: string) => `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/films/${path}`;
const rand = () => crypto.randomUUID().slice(0, 8);

// ---------- Åtgärderna ----------
export async function videoAction(admin: Any, action: string, b: Any, req: Request, json: (x: unknown, s?: number) => Response, fail: (s: number, c: string) => Response, streamOut: Any) {
  if (action === "video_log") {
    await admin.from("film_log").insert({
      quiz_id: typeof b.quiz_id === "string" && UUID.test(b.quiz_id) ? b.quiz_id : null,
      concept_id: str(b.concept_id, 20) || null, level: ["info", "warn", "error"].includes(b.level) ? b.level : "info", msg: str(b.msg, 2000) || "-",
    });
    return json({ ok: true });
  }

  if (action === "video_todo") {
    // Godkända läxor, närmast prov först. Begrepp utan video, eller med fel som får försökas igen.
    const { data: rows } = await admin.from("quizzes").select("id,title,subject,grade,test_date,created_at,content").eq("status", "ready");
    const today = new Date().toISOString().slice(0, 10), now = Date.now();
    const items: Any[] = [];
    const sorted = (rows ?? []).sort((x: Any, y: Any) => {
      const a = x.test_date && x.test_date >= today ? x.test_date : "9999", c = y.test_date && y.test_date >= today ? y.test_date : "9999";
      return a < c ? -1 : a > c ? 1 : Date.parse(y.created_at) - Date.parse(x.created_at);
    });
    for (const q of sorted) {
      for (const k of q.content?.concepts ?? []) {
        const v = k.video ?? {};
        if (v.url) continue;
        if ((v.tries ?? 0) >= MAX_TRIES) continue;
        if (v.error && v.at && now - Date.parse(v.at) < 2 * 3600_000) continue;
        if (v.claimed_at && now - Date.parse(v.claimed_at) < 45 * 60_000) continue;
        if ((v.starts ?? 0) >= 4) continue; // jobbet har kraschat flera gånger
        items.push({ quiz_id: q.id, concept_id: k.id, name: k.name, title: q.title });
      }
    }
    return json({ items: items.slice(0, Math.min(20, Number(b.limit) || 4)) });
  }

  const hit = await loadConcept(admin, b.quiz_id, b.concept_id);
  if (!hit) return fail(404, "not_found");
  const { q, k } = hit;
  const grade = String(q.grade ?? 4);

  if (action === "video_voice") {
    await setVideo(admin, q.id, k.id, (v) => ({ ...v, claimed_at: new Date().toISOString(), starts: (v.starts ?? 0) + 1 }));
    // 1) Manus och plan.
    const raw = extractJson(await complete([{ type: "text", text: filmScriptPrompt({ grade, title: q.title, name: k.name, say: k.film?.say || k.say || "", qs: questionsFor(q.content, k.id) }) }], { effort: "low", maxTokens: 4000 }));
    const narration = str(raw?.narration, 900);
    const words = narration.split(/\s+/).length;
    if (!narration || words < 20 || words > 130) throw new ClaudeError("bad_script");
    const plan = (Array.isArray(raw?.plan) ? raw.plan : []).slice(0, 8).map((p: Any) => ({ cue: str(p?.cue, 40), show: str(p?.show, 300) })).filter((p: Any) => p.show);
    // 2) Röst via Speko (ElevenLabs, svenska).
    const key = Deno.env.get("SPEKO_API_KEY");
    if (!key) throw new ClaudeError("speko_not_configured", 500);
    const r = await fetch("https://api.speko.dev/v1/synthesize", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: narration, intent: { language: "sv", optimizeFor: "accuracy" }, constraints: { allowedProviders: { tts: ["elevenlabs"] } }, speed: 0.95 }),
    });
    if (!r.ok) { console.error("speko", r.status, (await r.text()).slice(0, 400)); throw new ClaudeError("speko_failed", 502); }
    const ct = r.headers.get("content-type") ?? "audio/mpeg";
    const audio = new Uint8Array(await r.arrayBuffer());
    const ext = /wav/i.test(ct) ? "wav" : /mpeg|mp3/i.test(ct) ? "mp3" : /pcm/i.test(ct) ? "pcm" : "mp3";
    const path = `${q.id}/${k.id}-${rand()}.${ext}`;
    const up = await admin.storage.from("films").upload(path, audio, { contentType: ext === "wav" ? "audio/wav" : "audio/mpeg", upsert: true });
    if (up.error) { console.error(up.error); throw new ClaudeError("upload_failed", 500); }
    return json({
      title: str(raw?.title, 60) || k.name, narration, plan, audio_url: publicUrl(path), audio_type: ct,
      provider: r.headers.get("x-speko-provider"), model: r.headers.get("x-speko-model"),
      concept: { name: k.name, grade, title: q.title, subject: q.subject },
    });
  }

  if (action === "video_compose") {
    const words = (Array.isArray(b.words) ? b.words : []).slice(0, 300).map((w: Any) => `${Number(w.start).toFixed(2)} ${str(w.w, 40)}`).join(" · ");
    const plan = (Array.isArray(b.plan) ? b.plan : []).slice(0, 8).map((p: Any) => `- "${str(p?.cue, 40)}": ${str(p?.show, 300)}`).join("\n");
    const prompt = filmComposePrompt({
      grade, title: q.title, name: k.name, subject: SUBJ[q.subject] ?? "övrigt", narration: str(b.narration, 900), words, plan,
      voiceEnd: Number(b.voice_end) || 30, duration: Number(b.duration) || 34, feedback: str(b.feedback, 3000) || undefined,
    });
    // partial: om förra strömmen klipptes (tidsgräns) fortsätter Claude därifrån.
    const partial = typeof b.partial === "string" && b.partial.length > 200 ? b.partial.slice(0, 60000).replace(/\s+$/, "") : undefined;
    return await streamOut([{ type: "text", text: prompt }], req.signal, { maxTokens: 20000, effort: "low", prefill: partial });
  }

  if (action === "video_review") {
    const sheet = typeof b.sheet === "string" ? b.sheet : "";
    if (!sheet || sheet.length > 6_000_000) return fail(400, "bad_request");
    const times = (Array.isArray(b.times) ? b.times : []).map(Number).filter((t: number) => Number.isFinite(t)).slice(0, 16);
    const raw = extractJson(await complete([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: sheet } },
      { type: "text", text: filmReviewPrompt({ name: k.name, grade, narration: str(b.narration, 900), times }) },
    ], { effort: "low", maxTokens: 3000 }));
    if (!raw) throw new ClaudeError("invalid_json");
    const list = (v: Any) => (Array.isArray(v) ? v : []).map((x: Any) => str(x, 300)).filter(Boolean).slice(0, 10);
    const blocking = list(raw.blocking);
    return json({ ok: raw.ok !== false && !blocking.length, blocking, minor: list(raw.minor) });
  }

  if (action === "video_upload") {
    const n = rand(), out: Any = {};
    for (const [name, ext] of [["mp4", "mp4"], ["vtt", "vtt"], ["poster", "jpg"]]) {
      const path = `${q.id}/${k.id}-${n}.${ext}`;
      const { data, error } = await admin.storage.from("films").createSignedUploadUrl(path, { upsert: true });
      if (error) { console.error(error); return fail(500, "upload_failed"); }
      out[name] = { path, signed_url: data.signedUrl, public_url: publicUrl(path) };
    }
    return json(out);
  }

  if (action === "video_done") {
    const at = new Date().toISOString();
    if (b.error) {
      await setVideo(admin, q.id, k.id, (v) => ({ error: str(b.error, 300), at, tries: (v.tries ?? 0) + 1, starts: v.starts ?? 0 }));
      return json({ ok: true });
    }
    const url = typeof b.url === "string" && b.url.startsWith(publicUrl(q.id + "/")) ? b.url : null;
    if (!url) return fail(400, "bad_request");
    const vtt = typeof b.vtt === "string" && b.vtt.startsWith(publicUrl(q.id + "/")) ? b.vtt : null;
    const poster = typeof b.poster === "string" && b.poster.startsWith(publicUrl(q.id + "/")) ? b.poster : null;
    // Textrader för appen: {a, b, t} i sekunder.
    const cues = (Array.isArray(b.cues) ? b.cues : []).slice(0, 80).map((c: Any) => ({ a: +Number(c?.a).toFixed(2), b: +Number(c?.b).toFixed(2), t: str(c?.t, 120) }))
      .filter((c: Any) => Number.isFinite(c.a) && Number.isFinite(c.b) && c.b > c.a && c.t);
    await setVideo(admin, q.id, k.id, () => ({ v: 1, url, vtt, poster, dur: Number(b.duration) || null, at, narration: str(b.narration, 900), cues }));
    return json({ ok: true });
  }

  return fail(400, "unknown_action");
}

