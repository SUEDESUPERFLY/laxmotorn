// Promptar för förklaringsfilmer som video (HyperFrames). Renderingen sker i GitHub Actions (films/render.mjs).
import { GOLDEN_FILM, GOLDEN_NARRATION, GOLDEN_WORDS } from "./film_golden.ts";

export function filmScriptPrompt(o: { grade: string; title: string; name: string; say: string; qs: string[] }) {
  return `Du skriver manus till en kort förklaringsfilm (20–35 sekunder) för en elev i årskurs ${o.grade}. Läxan heter "${o.title}" och filmen handlar om begreppet "${o.name}". Filmen visas direkt efter att eleven har svarat fel på en fråga om begreppet. En lugn röst läser manuset medan en bild växer fram, del för del, när rösten säger orden.

NUVARANDE KORTA FÖRKLARING
${o.say}

FRÅGOR OM BEGREPPET (rätt svar efter →, vanliga felsvar inom [ ])
${o.qs.join("\n") || "(inga)"}

REGLER FÖR MANUSET
- Du-form, lugnt och tydligt talspråk för årskurs ${o.grade}. 45–75 ord i 4–7 korta meningar.
- Första meningen säger kärnan. Använd ett konkret exempel som går igenom hela förklaringen (en mening, ett tal, en växt, en händelse).
- Om felsvaren visar en vanlig missuppfattning: säg rakt vad som inte stämmer och vad som gäller ("Det är inte …, utan …").
- Sista meningen sammanfattar idén i en mening.
- Fakta ska stämma med frågorna och kursplanen (Lgr22). Inga förkortningar. Tal får skrivas med siffror.
- Skriv för örat: inga parenteser, inga listor, inga citattecken.

PLAN FÖR BILDEN
4–7 steg i manusets ordning. "cue" är 1–3 ord som står ordagrant i manuset; "show" beskriver konkret vad som syns eller händer då. Tänk en enda bild som växer (en tallinje, en mening där ord ramas in, en genomskärning, en karta, en process), inte en punktlista. Zooma gärna in på en del och ut till överblick.

SVARA MED ENDAST JSON:
{"title":"2–4 ord","narration":"…","plan":[{"cue":"…","show":"…"}]}`;
}

const KIT_DOC = `KIT (finns redan i filmen: assets/kit.css och assets/kit.js)
CSS-klasser: .layer (helbild), .full (1920×1080, för svg och lager), .world (kameralager, transform-origin 0 0), .pill (etikett vid en del; left/top = mittpunkt, 46 px; <i style="background:…"></i> före texten ger en färgprick), .big (fet stor text), .title (rubrik uppe till vänster), .cap (rad 50 px), .center (centrerad i x; använd med position absolute och top), .eq/.tok/.op (bildekvation: .tok = <svg viewBox="-70 -70 140 140"> + text under, .op = + eller →), .strike (röd överstrykning; lägg i en rad med position:relative).
Färger (CSS-variabler): --ink --paper --muted --leaf --leafD --sun --water --waterD --co2 --o --oD --sugar --sugarD --accent --alert --cool --warm.
Färgverlopp i SVG: url(#kSky) url(#kSoil) url(#kLeaf) url(#kStem) url(#kWater) url(#kSun) url(#kGlow) url(#kCell) url(#kSkin) url(#kPlanet) url(#kNight) url(#kPaper).
JavaScript (const { W, q, qa, cam, drawIn, pop, out, blurIn, swap, along, rng, cells } = K):
- W(s): filmtid för ett ord som börjar s sekunder in i ljudfilen (rösten börjar 0,6 s in). Använd W(ordtid) för allt som hör till ett ord.
- cam(skala, cx, cy): kameraläge för ett .world-lager, t.ex. tl.to("#world", { ...cam(2.2, 900, 400), duration: 1.2, ease: "power2.inOut" }, t). Kanterna visas aldrig.
- drawIn(tl, sel|el, t, dur=0.8, ease): ritar fram linjer (path, line, circle, rect med stroke, eller alla linjer i en grupp) en i taget; text och annat tonas in.
- pop(tl, sel, t, dur=0.5): landar med fjädring (opacity 0→1, scale 0,6→1). out(tl, sel, t, dur=0.3): försvinner.
- blurIn(tl, sel, t): text skärps fram. swap(tl, frånSel, tillSel, t): byte mellan lager med oskärpa.
- along(tl, el, "#banaId", t, dur=2): ett element färdas längs en osynlig <path id="banaId" fill="none"> (droppar, molekyler, pilar med flöde).
- rng(seed): seedad slump. cells("#g", seed): fyller en <g> med växtceller (närbild av ett blad).`;

// Den stora, oföränderliga delen (regler, kit, förebild) ligger först och cachas hos Anthropic.
export const FILM_COMPOSE_STATIC = `Du gör förklaringsfilmer (video 1920 × 1080, 30 bilder/s) med HyperFrames: HTML, SVG och GSAP som renderas bild för bild. En film visas för en elev direkt efter ett fel svar om ett begrepp i en läxa. Berättarrösten är redan inspelad. Ordtiderna styr när allt händer. Uppgiften (manus, ordtider, plan och längd) kommer efter förebilden.

SÅ SKA FILMEN VARA (forskning om multimedialärande; följ det)
- En bild som växer: börja i något konkret och bygg en bild där varje del dyker upp när rösten säger den. Ingen färdig bild på en gång, inga punktlistor, inga ikoner i cirklar, inga kort i rad.
- Bilden visar själva innehållet: delar, orsak och verkan, förändring, storlek, jämförelse. Rörelse när något förändras eller flödar. Zooma in på det som förklaras och ut till överblick. Byt scen genom något i bilden (zooma genom en del, lager som byts med oskärpa), inte med hårda klipp.
- Bara korta etiketter (1–4 ord) vid det de beskriver och högst en kort rad i taget. Manuset ska inte stå som text på skärmen.
- Ingen musik, inga ljud, inga dekorationer, maskotar eller skämt. Lugnt, sakligt och vackert: rena former, mjuka färgverlopp, tydliga konturer.
- Om manuset bemöter en missuppfattning: visa den felaktiga meningen och stryk över den (.strike) när rösten säger det.
- Avsluta med en sammanfattning (en mening och gärna en bildekvation med .eq/.tok/.op eller ett enkelt diagram) som står kvar till slutet.
- Fakta, tal och ord på skärmen måste stämma med manuset. Svenska med å, ä, ö.
- Matte: tallinjer, staplar, rutor och tal som räknas. Språk: meningar där ord ramas in och får etiketter. NO/SO: genomskärningar, kartor, processer med pilar och flöden.
- Ingen tom bild någon gång: något ska alltid synas, också mellan scenerna och i slutet.

RÖRELSE
- Ankomst expo.out eller power4.out (0,4–0,9 s). Kamera power2.inOut (1–1,4 s). Zoom genom något och utgångar power3.in, kortare än ankomsten.
- Nästa del börjar när föregående är 30–50 % klar. Text som landat står still. Inga svävande, pulserande eller gungande loopar.
- Variera sätten: drawIn, väx fram (scale 0 → 1 med back.out), blurIn, along, swap, cam.

TEKNISKA REGLER (annars går renderingen sönder)
- Svara med tre delar och inget annat: <<<STYLE>>> (CSS utan <style>-taggar), <<<BODY>>> (det som ligger i #root; skelettet med ljud, längd och skript finns redan), <<<SCRIPT>>> (JavaScript utan <script>-taggar), sist <<<END>>>. Inga andra markörer.
- BODY består av lager: <div id="…" class="clip layer" data-start="…" data-duration="…">. Varje lager har class="clip", data-start och data-duration i sekunder och syns under hela den tiden. Animera innehållet i ett lager (ett inre element med id), aldrig .clip-elementet självt. Lagren ska tillsammans täcka hela filmen utan luckor, det sista till filmens slut.
- SCRIPT börjar med: const { W, q, qa, cam, drawIn, pop, out, blurIn, swap, along, rng, cells } = K; const tl = gsap.timeline({ paused: true }); Registreringen sker automatiskt efter skriptet.
- Bara tl.fromTo / tl.to / tl.set med absolut tid som tredje argument. Inte Math.random, Date, setTimeout, repeat: -1 eller fetch. Mönster: rng(seed).
- Animera bara transform och opacity (x, y, scale, rotation, opacity, filter), aldrig top, left, width eller height.
- Ett SVG-element med transform-attribut får inte animeras med x/y/scale/rotation. Lägg placeringen i en yttre <g transform="translate(x y)"> och animera en inre <g id="…">.
- Skala och rotera SVG-grupper med transformOrigin: "50% 50%" (inte svgOrigin).
- En senare fromTo på en egenskap som redan animerats behöver immediateRender: false.
- Allt som ska dyka upp senare börjar osynligt (opacity 0 i style/attribut, eller via pop/blurIn/drawIn).
- Text: Nunito. Rubrik 84–104 px, etiketter .pill 46 px, annan text minst 40 px. Innehåll inom 96 px från kanterna. Text får inte överlappa annan text eller figurer eller hamna utanför bilden; räkna med ungefär 0,55 × teckenstorlek per tecken och ge varje text en egen plats.
- Inga bilder eller externa filer: rita allt i SVG, gärna med kitets färgverlopp.
- Skriv kompakt: hela svaret helst under 12 000 tecken. Inga kommentarer i koden. Svara direkt, utan lång planering.

${KIT_DOC}

FÖREBILD (begreppet Fotosyntes, årskurs 4, 36 s). Exakt samma format som du ska svara i. Lån tekniker, men gör en egen bild som passar ditt begrepp och ditt manus.
MANUS: ${GOLDEN_NARRATION}
ORDTIDER: ${GOLDEN_WORDS}
${GOLDEN_FILM}`;

export function filmComposeTask(o: {
  grade: string; title: string; name: string; subject: string; narration: string; words: string; plan: string;
  voiceEnd: number; duration: number; feedback?: string;
}) {
  return `UPPGIFT: en förklaringsfilm för en elev i årskurs ${o.grade} om begreppet "${o.name}" i läxan "${o.title}" (ämne: ${o.subject}).

MANUS
${o.narration}

ORDTIDER (sekunder i ljudfilen; filmtid = W(sekunder))
${o.words}

PLAN
${o.plan}

LÄNGD: filmen är ${o.duration} s. Rösten slutar vid filmtid ${o.voiceEnd.toFixed(1)} s. Det sista lagret ska gå till ${o.duration} s och sammanfattningen stå kvar till slutet.
${o.feedback ? `\nRÄTTA DETTA FRÅN FÖRRA FÖRSÖKET (gör om hela filmen och undvik felen):\n${o.feedback}\n` : ""}
Svara nu med <<<STYLE>>>, <<<BODY>>>, <<<SCRIPT>>> och <<<END>>>.`;
}

export function filmReviewPrompt(o: { name: string; grade: string; narration: string; times: number[] }) {
  return `Bilden är ett kontaktark med ${o.times.length} stillbilder ur en förklaringsfilm för årskurs ${o.grade} om "${o.name}", i ordning från vänster till höger och uppifrån och ned, tagna vid ${o.times.map((t) => t.toFixed(1) + " s").join(", ")}.

MANUS: ${o.narration}

Granska som en noggrann redaktör. Blockerande fel (filmen får inte publiceras):
- text som är avklippt, hamnar utanför bilden eller överlappar annan text så att den inte går att läsa
- tomma eller nästan tomma bilder (också den sista, som ska visa sammanfattningen), trasiga eller obegripliga figurer
- fakta, tal eller ord på skärmen som är fel eller motsäger manuset
- olämpligt innehåll för barn
Mindre fel (publiceras ändå): små överlapp, lite tom yta, en etikett som kunde sitta bättre, stilbrott.

SVARA MED ENDAST JSON: {"ok": true, "blocking": ["…"], "minor": ["…"]}  (ok = inga blockerande fel)`;
}
