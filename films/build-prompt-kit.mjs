// Bäddar in förebildsfilmen och dess ordtider i edge function (supabase/functions/laxmotorn/film_golden.ts).
// Kör efter ändringar i golden/: node films/build-prompt-kit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const film = fs.readFileSync(path.join(HERE, 'golden/fotosyntes.film'), 'utf8').trim();
const words = JSON.parse(fs.readFileSync(path.join(HERE, 'golden/fotosyntes.words.json'), 'utf8'));
const out = `// GENERERAD av films/build-prompt-kit.mjs – ändra films/golden/ i stället.
export const GOLDEN_NARRATION = ${JSON.stringify(words.narration)};
export const GOLDEN_WORDS = ${JSON.stringify(words.words.map((w) => `${w.start.toFixed(2)} ${w.w}`).join(' · '))};
export const GOLDEN_FILM = ${JSON.stringify(film)};
`;
fs.writeFileSync(path.join(HERE, '../supabase/functions/laxmotorn/film_golden.ts'), out);
console.log('film_golden.ts', out.length, 'tecken');
