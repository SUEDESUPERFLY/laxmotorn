# Provfilm: Fotosyntes (HyperFrames)

En förklaringsfilm på 36 s gjord med [HyperFrames](https://github.com/heygen-com/hyperframes) (öppen källkod, Apache 2.0): HTML + SVG + GSAP som renderas bild för bild till MP4.

- Berättarröst: ElevenLabs (eleven_v3, svenska) via Speko. Ordtider från transkribering styr när varje del dyker upp.
- Ingen musik (koherensprincipen). En bild som växer del för del, inzoomning i bladet, missuppfattningen ("växten äter jord") stryks och sammanfattningen byggs.
- `assets/` behöver `gsap.min.js`, `MotionPathPlugin.min.js` (npm `gsap@3.14.2`) och `voice.wav`.

Rendera: `PRODUCER_HEADLESS_SHELL_PATH=<chrome-headless-shell> npx hyperframes@0.8.185 render -q high -o fotosyntes.mp4`
