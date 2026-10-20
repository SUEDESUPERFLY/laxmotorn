# Läxmotorn

Gamifierat läxförhör: fota läxan, Claude gör ett förhör med stationer, medaljer, repetition (Leitner) och slutprov.

## Struktur

- `src/index.html` – appen (en fil). Ursprungligen publicerad som Claude-artefakt.
- `supabase/migrations/` – databasschema med RLS (hushåll, barn, förhör, framsteg).
- `supabase/functions/generate/` – edge function som anropar Claude (Messages API) med strömning.

## Supabase

Projekt: `laxmotorn` (eu-north-1, ref `qmmannehhntwjpcharmz`).

Hemligheter för edge function:

| Namn | Innehåll |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API-nyckel |
| `ALLOWED_EMAILS` | kommaseparerade e-postadresser som får skapa förhör |
| `CLAUDE_MODEL` | valfri, standard `claude-sonnet-5-5` |
