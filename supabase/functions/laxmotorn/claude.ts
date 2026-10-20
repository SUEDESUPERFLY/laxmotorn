// Anrop till Claude (Messages API) med strömning.
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const EFFORT_ENV = Deno.env.get("CLAUDE_EFFORT") ?? "";
export const DEFAULT_EFFORT = ["low", "medium", "high"].includes(EFFORT_ENV) ? EFFORT_ENV : "medium";

export class ClaudeError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}

// deno-lint-ignore no-explicit-any
export async function open(content: any[], o: { effort?: string; maxTokens?: number; signal?: AbortSignal } = {}) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new ClaudeError("not_configured", 500);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: o.maxTokens ?? 32000,
      stream: true,
      output_config: { effort: o.effort ?? DEFAULT_EFFORT },
      messages: [{ role: "user", content }],
    }),
    signal: o.signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    console.error("anthropic", res.status, txt.slice(0, 500));
    if (res.status === 429 || res.status === 529) throw new ClaudeError("rate_limited", 429);
    if (res.status === 413 || /prompt is too long/i.test(txt)) throw new ClaudeError("prompt_too_large", 413);
    if (res.status === 400 && /image/i.test(txt)) throw new ClaudeError("image_rejected", 400);
    throw new ClaudeError("upstream", 502);
  }
  return res.body;
}

// Läser SSE och anropar onText för varje textbit. Returnerar stop_reason eller kastar ClaudeError.
export async function pump(body: ReadableStream<Uint8Array>, onText: (t: string) => void) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "", stop = "";
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
      // deno-lint-ignore no-explicit-any
      let d: any;
      try { d = JSON.parse(line.slice(5)); } catch { continue; }
      if (d.type === "content_block_delta" && d.delta?.type === "text_delta") onText(d.delta.text);
      else if (d.type === "message_delta" && d.delta?.stop_reason) stop = d.delta.stop_reason;
      else if (d.type === "error") throw new ClaudeError(d.error?.type === "overloaded_error" ? "rate_limited" : "upstream");
    }
  }
  if (stop === "max_tokens") throw new ClaudeError("invalid_json");
  if (stop === "refusal") throw new ClaudeError("refused");
  return stop;
}

// Hela svaret som text (för bakgrundsjobb).
// deno-lint-ignore no-explicit-any
export async function complete(content: any[], o: { effort?: string; maxTokens?: number; signal?: AbortSignal } = {}) {
  let text = "";
  await pump(await open(content, o), (t) => { text += t; });
  return text;
}
