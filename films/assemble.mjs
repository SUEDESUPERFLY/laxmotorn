// Bygger ett HyperFrames-projekt av en film i sektionsformat (<<<STYLE>>>, <<<BODY>>>, <<<SCRIPT>>>, <<<END>>>).
// Skelettet (ljud, längd, skript, kit) ligger här, så att en genererad film alltid har rätt grundform.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseFilm(text) {
  // Avslutande markörer som <<</STYLE>>> tas bort; bara öppnande markörer delar svaret.
  const t = String(text).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/<<<\/[A-Z]+>>>/g, '');
  const sec = (name, next) => { const a = t.indexOf(`<<<${name}>>>`); const b = t.indexOf(`<<<${next}>>>`, a + 1); return a < 0 || b < 0 ? null : t.slice(a + name.length + 6, b).trim(); };
  const style = sec('STYLE', 'BODY'), body = sec('BODY', 'SCRIPT'), script = sec('SCRIPT', 'END');
  if (body === null || script === null) return null;
  // Skelettet har redan <style> och <script>; egna taggar runt delarna skulle bryta sidan.
  return { style: (style ?? '').replace(/<\/?style[^>]*>/gi, ''), body, script: script.replace(/<\/?script[^>]*>/gi, '') };
}

export function assemble(dir, film, { voice, voiceDur, duration }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const gs = path.join(HERE, 'node_modules/gsap/dist');
  fs.copyFileSync(path.join(gs, 'gsap.min.js'), path.join(dir, 'assets/gsap.min.js'));
  fs.copyFileSync(path.join(gs, 'MotionPathPlugin.min.js'), path.join(dir, 'assets/MotionPathPlugin.min.js'));
  fs.copyFileSync(path.join(HERE, 'kit/kit.js'), path.join(dir, 'assets/kit.js'));
  fs.copyFileSync(path.join(HERE, 'kit/kit.css'), path.join(dir, 'assets/kit.css'));
  const ext = path.extname(voice) || '.mp3';
  fs.copyFileSync(voice, path.join(dir, 'assets/voice' + ext));
  const D = Math.ceil(duration * 10) / 10;
  const html = `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/gsap.min.js"></script>
    <script src="assets/MotionPathPlugin.min.js"></script>
    <link rel="stylesheet" href="assets/kit.css" />
    <style>
${film.style}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1920" data-height="1080">
      <audio id="vo" class="clip" src="assets/voice${ext}" data-start="0.6" data-duration="${voiceDur.toFixed(2)}" data-volume="1"></audio>
${film.body}
    </div>
    <script src="assets/kit.js"></script>
    <script>
${film.script}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true } }, null, 2));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: 'film', name: 'film' }));
  return path.join(dir, 'index.html');
}
