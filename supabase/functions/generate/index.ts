// Läxmotorn: proxy till Claude (Messages API) för att skriva av läxsidor och skapa förhör.
// Ersätter window.claude "sample" från artefakttiden.
//
// POST /functions/v1/generate
//   { prompt: string, images?: [{ media_type, data }], max_tokens?: number }
// Svar: text/plain som strömmas (bara modellens text, inga tankar). Vid fel: JSON {code, message}
// med HTTP-status ≥ 400, eller en sista rad "\n\u0000ERR:<code>" om felet kommer mitt i strömmen.
//
// Hemligheter (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  krävs
//   ALLOWED_EMAILS     kommaseparerad lista; bara dessa konton får använda funktionen
//   CLAUDE_MODEL       valfri, standard claude-sonnet-5-5
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const MAX_PROMPT = 200_000; // tecken
const MAX_IMAGES = 20; // över 20 gäller hårdare pixelgränser i API:t
const MAX_IMAGE_B64 = 10 * 1024 * 1024;
const MAX_TOTAL_B64 = 28 * 1024 * 1024; // API:ts gräns för hela anropet är 32 MB
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method", "Använd POST.");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail(500, "not_configured", "ANTHROPIC_API_KEY saknas i Supabase.");

  // Vem är det? (verify_jwt har redan kontrollerat att token är giltig)
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await sb.auth.getUser();
  const email = u?.user?.email?.toLowerCase();
  if (!email) return fail(401, "session_expired", "Logga in igen.");

  const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return fail(403, "not_granted", "Kontot får inte skapa förhör.");

  const { count } = await sb.from("household_members").select("user_id", { count: "exact", head: true });
  if (!count) return fail(403, "no_household", "Skapa familjen först.");

  // Indata
  let body: { prompt?: unknown; images?: unknown; max_tokens?: unknown };
  try { body = await req.json(); } catch { return fail(400, "bad_request", "Ogiltig JSON."); }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return fail(400, "bad_request", "prompt saknas.");
  if (prompt.length > MAX_PROMPT) return fail(413, "prompt_too_large", "För mycket text.");

  const imgs = Array.isArray(body.images) ? body.images : [];
  if (imgs.length > MAX_IMAGES) return fail(413, "prompt_too_large", `Max ${MAX_IMAGES} bilder per anrop.`);
  let total = 0;
  const content: unknown[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i] as { media_type?: unknown; data?: unknown };
    if (typeof im?.data !== "string" || typeof im?.media_type !== "string" || !MEDIA.has(im.media_type)) {
      return fail(400, "image_rejected", `Bild ${i + 1} har fel format.`);
    }
    if (im.data.length > MAX_IMAGE_B64) return fail(413, "image_rejected", `Bild ${i + 1} är för stor.`);
    total += im.data.length;
    content.push({ type: "text", text: `Bild ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  }
  if (total > MAX_TOTAL_B64) return fail(413, "prompt_too_large", "Bilderna är för stora tillsammans.");
  content.push({ type: "text", text: prompt });

  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 32000, 1000), 64000);

  // Anropa Claude med streaming
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: "user", content }],
    }),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    console.error("anthropic", upstream.status, txt.slice(0, 500));
    if (upstream.status === 429 || upstream.status === 529) return fail(429, "rate_limited", "Claude är upptaget. Försök igen om en stund.");
    if (upstream.status === 413 || /prompt is too long/i.test(txt)) return fail(413, "prompt_too_large", "För mycket material.");
    if (upstream.status === 400 && /image/i.test(txt)) return fail(400, "image_rejected", "En bild gick inte att läsa.");
    return fail(502, "upstream", "Claude svarade med ett fel.");
  }

  // SSE → ren text. Bara text_delta skickas vidare.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const reader = upstream.body!.getReader();
      let buf = "", stop = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const evt = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = evt.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let d: any;
            try { d = JSON.parse(line.slice(5)); } catch { continue; }
            if (d.type === "content_block_delta" && d.delta?.type === "text_delta") {
              ctl.enqueue(enc.encode(d.delta.text));
            } else if (d.type === "message_delta" && d.delta?.stop_reason) {
              stop = d.delta.stop_reason;
            } else if (d.type === "error") {
              const code = d.error?.type === "overloaded_error" ? "rate_limited" : "upstream";
              ctl.enqueue(enc.encode(`\n\u0000ERR:${code}`));
            }
          }
        }
        if (stop === "max_tokens") ctl.enqueue(enc.encode("\n\u0000ERR:invalid_json"));
        if (stop === "refusal") ctl.enqueue(enc.encode("\n\u0000ERR:refused"));
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") ctl.enqueue(enc.encode("\n\u0000ERR:upstream"));
      } finally {
        ctl.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
});
