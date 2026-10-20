# Läxmotorn

Gamifierat läxförhör: fota läxan, Claude gör ett förhör med stationer, medaljer, repetition (Leitner) och slutprov.

## Struktur

- `src/index.html` – appen (en fil). Ursprungligen publicerad som Claude-artefakt.
- `supabase/migrations/` – databasschema med RLS (hushåll, barn, förhör, framsteg).
- `supabase/functions/generate/` – edge function som anropar Claude (Messages API) med strömning.

## Publicering

`src/` publiceras på GitHub Pages vid varje push till `main` (`.github/workflows/pages.yml`).

## Test

`tests/e2e.mjs` kör hela flödet (inloggning, barn, generering, spel, omloggning) mot en mockad Supabase:

```
npm i @supabase/supabase-js@2.45.4 playwright
node tests/e2e.mjs src/index.html
```

## Supabase

Projekt: `laxmotorn` (eu-north-1, ref `qmmannehhntwjpcharmz`).

Hemligheter för edge function:

| Namn | Innehåll |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API-nyckel |
| `ALLOWED_EMAILS` | kommaseparerade e-postadresser som får skapa förhör |
| `CLAUDE_MODEL` | valfri, standard `claude-sonnet-5-5` |
