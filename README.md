# Läxmotorn

Gamifierat läxförhör: fota läxan, Claude gör ett förhör med stationer, medaljer, repetition (Leitner) och slutprov.

## Struktur

- `src/index.html` – appen (en fil). Ursprungligen publicerad som Claude-artefakt.
- `supabase/migrations/` – databasschema med RLS (hushåll, barn, förhör, framsteg).
- `supabase/functions/laxmotorn/` – edge function: förhör, avskrift av bilder, förklaringsklipp och import av skolmejl. Promptarna ligger här.
- `supabase/functions/generate/` – gammal funktion, numera en stängd stub (410).
- `apps-script/LaxmotornMejl.gs` – Apps Script som skickar Unikum-mejl till Läxmotorn varje timme.

## Skolmejl (Unikum)

1. Barnen får klasskoder i appen (Byt barn → Koppla skolmejlen), t.ex. `RG16C`. Koden matchas mot ämnesraden.
2. Apps Script-filen läggs i ett Apps Script-projekt med skriptegenskapen `LAXMOTORN_TOKEN` (nyckeln visas i samma vy).
3. `laxmotornPing()` testar kopplingen, `laxmotornSetup()` läser senaste 30 dagarna och startar timvis körning.

Prov och läxförhör hamnar under "Från skolan" hos rätt barn. Räcker mejlet till ett förhör görs ett förslag i bakgrunden; annars visas vad som saknas. Inget syns för barnen förrän en vuxen godkänt det.

## Konton

- **Vuxna** loggar in med e-post och lösenord och har full åtkomst: Från skolan, godkännande, alla barn och översikten.
- **Barn** loggar in med användarnamn och lösenord som en vuxen skapar under Byt barn → Barnens inloggning. Barnet ser bara sina egna godkända läxor. Spärrarna ligger i databasen (RLS): ett barnkonto kan inte läsa förslag, ändra läxor, se syskons framsteg eller läsa nyckeln till Apps Script.
- Bakom ett barns användarnamn finns ett vanligt konto med förälderns e-post plus en tagg (`namn+lm-erik@…`).

## Förklaringsklipp

Varje förhör har begrepp (`content.concepts`) med ett kort talat manus och en kodritad bild (lista, steg, kretslopp, jämförelse eller begrepp). Vid fel svar spelas klippet: talsyntesen läser manuset och varje del av bilden dyker upp när rösten säger sitt ord. Saknas svensk röst används uppskattad tid och texten visas. Efter klippet kommer en liknande fråga om samma begrepp i slutet av rundan.

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
| `CLAUDE_EFFORT` | valfri, `low`/`medium`/`high`, standard `medium` (gratisplanen stoppar funktioner efter 150 s) |
