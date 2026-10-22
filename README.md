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
- **Nya vuxenkonton** (Skapa vuxenkonto) går bara att skapa för e-postadresser i `ALLOWED_EMAILS`. Kontot bekräftas direkt och läggs i samma familj som de andra tillåtna vuxna. Lägg till adressen i hemligheten först, kommaseparerad.
- **Barn** loggar in med användarnamn och lösenord som en vuxen skapar under Byt barn → Barnens inloggning. Barnet ser bara sina egna godkända läxor. Spärrarna ligger i databasen (RLS): ett barnkonto kan inte läsa förslag, ändra läxor, se syskons framsteg eller läsa nyckeln till Apps Script.
- Bakom ett barns användarnamn finns ett vanligt konto med förälderns e-post plus en tagg (`namn+lm-erik@…`).

## Förklaringsfilmer

När ett barn svarar fel spelas en kort film (10–25 s) om begreppet: en lugn röst förklarar medan en ritning växer fram på rutat papper, del för del, exakt när rösten säger ordet. En penna ritar och skriver, som när en lärare förklarar vid tavlan. Efter filmen kommer en liknande fråga i slutet av rundan.

**Så görs filmerna.** Första gången en läxa öppnas (eller ett förslag granskas) ber appen servern om filmer (`films`). Claude skriver manus och en ritplan per begrepp: steg med ett ord ur manuset (`cue`) och element på en duk 800 × 500 (figurer ur ett eget bibliotek, pilar, lådor, text, meningar med inramade ord, tal som räknas upp, markeringar, fria former). Allt ritas i kod i webbläsaren, så text och fakta blir exakta. Saknas film ännu ritas en enklare film av klippets bildtyp, så filmen spelas alltid.

**Forskningsgrund.** Utformningen följer forskningen om multimedialärande:

| Princip | Så används den |
|---|---|
| Modalitet och redundans: tal + bild är bättre än bild + mycket text ([Mayer 2021](https://doi.org/10.1017/9781316941355); [Ginns 2005](https://doi.org/10.1016/j.learninstruc.2005.07.001)) | Manuset läses upp. På skärmen står bara korta etiketter. Manustexten kan slås på (knappen Text) och visas automatiskt om enheten saknar svensk röst. |
| Temporal och rumslig närhet | Varje del ritas när rösten säger den, och etiketten sitter vid delen. Etiketter flyttas automatiskt bort från pilar och figurer. |
| Signalering ([Schneider m.fl. 2018](https://doi.org/10.1016/j.edurev.2017.11.001)) | Det som sägs nu är starkt, tidigare steg tonas ned. Kameran drar sig bakåt när bilden växer. Samma färg betyder samma sak. |
| Koherens, inga lockande detaljer ([Sundararajan & Adesope 2020](https://doi.org/10.1007/s10648-020-09522-4)) | Ingen musik, inga skämtfigurer eller dekorationer. Bara figurer som föreställer innehållet. |
| Dynamisk ritning ([Fiorella & Mayer 2016](https://doi.org/10.1037/edu0000065)) | Bilden ritas fram av en penna i stället för att visas färdig. Studien fann att det hjälper mest när handen syns; pennan är en enkel motsvarighet. |
| Animation när innehållet förändras ([Berney & Bétrancourt 2016](https://doi.org/10.1016/j.compedu.2016.06.005)) | Rörelse (flödesprickar längs pilar) bara för förlopp och flöden. |
| Segmentering och elevens tempo ([Rey m.fl. 2019](https://doi.org/10.1007/s10648-018-9456-4)) | Paus, förra meningen och spela igen. Korta filmer, en idé per film. |
| Utvecklad återkoppling och missuppfattningar ([Van der Kleij m.fl. 2015](https://doi.org/10.3102/0034654314564881)) | Filmen kommer direkt efter felet och förklarar varför. Claude ser frågornas vanliga felsvar och bemöter missuppfattningen rakt ("Det är inte …, utan …"). |

Studierna gäller mest äldre elever och vuxna, och effekterna är små till måttliga. Därför finns elevens kontroller kvar och filmerna är korta.

**Tekniken** kommer från [fltman/infofilm](https://github.com/fltman/infofilm): allt som måste stämma ritas i kod, rörelser tidsätts efter talet med uppskattad tid som reserv, filmens tillstånd är en ren funktion av filmtiden (pausa, spola, granska), och filmerna granskas med kontaktark. Rösten är webbläsarens svenska talsyntes; ordgränser från rösten styr filmtiden.

**Granska filmer:** `node tests/film-review.mjs src/index.html 8` gör kontaktark för de gyllene filmerna i `tests/golden-films.mjs` (förebilder; "Avrunda till tiotal" är exemplet i prompten). Med en JSON-fil som tredje argument granskas andra filmer, t.ex. sådana som hämtats ur databasen.

### Videofilmer (HyperFrames)

Godkända läxor får också riktiga videofilmer (1920 × 1080, 25–40 s) med inspelad röst. Finns en video spelas den; annars, eller om den inte går att ladda inom tio sekunder, spelas den ritade filmen ovan.

**Så görs de.** Arbetsflödet `.github/workflows/films.yml` körs varje halvtimme (och vid ändringar i `films/`). Det frågar servern vilka begrepp som saknar video (närmast prov först) och gör varje film i ett eget jobb med `films/render.mjs`:

1. **Manus och röst** (`video_voice`): Claude skriver ett manus på 45–75 ord och en plan för bilden. Rösten görs av ElevenLabs via Speko och sparas i lagringen `films`.
2. **Ordtider:** pauserna i ljudet (ffmpeg) paras ihop med manusets fraser; orden får tider efter sin längd. Ingen taligenkänning behövs eftersom texten är känd.
3. **Komposition** (`video_compose`): Claude skriver filmen som HTML, SVG och GSAP med ett gemensamt kit (`films/kit/`: färger, färgverlopp, kamera, rita fram, landa, flöden längs banor) och en förebild (`films/golden/fotosyntes.film`). Allt tidsätts med ordtiderna.
4. **Kontroll och rendering:** `hyperframes check` (fel skickas tillbaka till Claude en gång) och `hyperframes render`. Lagren som slutar sist förlängs till filmens slut så att sammanfattningen står kvar.
5. **Granskning** (`video_review`): nio stillbilder ur den renderade filmen läggs på ett kontaktark som Claude granskar (avklippt eller överlappande text, tomma bilder, fel fakta). Blockerande fel ger ett nytt försök; godkänns inte filmen publiceras den inte.
6. **Publicering:** MP4, textning (WebVTT) och omslagsbild laddas upp; begreppet får `video: {url, vtt, poster, dur, cues, narration}`.

Inga hemligheter ligger på GitHub: jobbet loggar in hos servern med GitHubs OIDC-token, och servern släpper bara in `films.yml` på `main` i det här repot. Claude- och Speko-nycklarna (`ANTHROPIC_API_KEY`, `SPEKO_API_KEY`) finns bara i Supabase. Varje steg loggas i tabellen `film_log`. Ett begrepp försöks högst två gånger (med två timmars mellanrum).

**Prova lokalt:** `cd films && npm ci && node try-golden.mjs <röstfil>` bygger förebilden i `films/work/golden`; `npx hyperframes render` renderar den. `prototyp/fotosyntes/` är den första provfilmen.

Kostnad ungefär 0,1–0,3 USD per film (Claude, beroende på antal försök) plus 0,04 USD (röst). Den fasta delen av kompositionsprompten (regler, kit, förebild) cachas hos Anthropic, så att den kostar en tiondel när flera filmer görs i samma körning. Tar Claude-krediterna slut (`no_credit`) pausar kedjan sig själv i tre timmar och begreppet räknas inte som ett misslyckat försök; appen visar då ett tydligt meddelande.

**Schemat** (varje halvtimme) slås på och av i `.github/workflows/films.yml`. Det är just nu avstängt; en körning kan också startas för hand (workflow_dispatch) eller genom en ändring i `films/`. Kontaktark och kompositioner från varje körning sparas på grenen `film-sheets`.

## Nivåer: svårare och djupare

När barnet kan läxan blir det svårare, inom samma område och årskurs:

| Nivå | Öppnas med | Frågorna kräver | XP |
|---|---|---|---|
| 1 · Läxan | – | fakta och begrepp | 1× |
| 2 · Fördjupning | silver på alla stationer och klarat slutprov | varför och hur, nya exempel, missuppfattningar ("Lisa säger att …") | 1,5× |
| 3 · Expert | silver på alla stationer i Fördjupning | "vad händer om", koppla ihop, resonera i flera steg | 2× |

Nästa nivå görs av Claude i bakgrunden redan när barnet har brons på nivån före, så den brukar vara klar när den öppnas. Den sparas i `content.levels` och görs bara en gång per läxa.

Nivå 2 och 3 har **förklaringsfrågor**: barnet skriver en till tre meningar och Claude (snabb modell, `CLAUDE_FAST_MODEL`) bedömer svaret mot nyckelpunkter (ja / delvis / nej) och ger kort återkoppling, följt av ett modellsvar. Går rättningen inte att nå jämför barnet själv med modellsvaret. Barnkonton får anropa `level` och `grade`, men bara för läxor de själva ser.

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
| `CLAUDE_FAST_MODEL` | valfri, modell för rättning av förklaringsfrågor, standard `claude-haiku-5-5` |
| `CLAUDE_EFFORT` | valfri, `low`/`medium`/`high`, standard `medium` (gratisplanen stoppar funktioner efter 150 s) |
