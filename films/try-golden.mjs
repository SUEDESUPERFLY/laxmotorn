import fs from 'node:fs';
import { parseFilm, assemble } from './assemble.mjs';
const f = parseFilm(fs.readFileSync('golden/fotosyntes.film', 'utf8'));
assemble('work/golden', f, { voice: process.argv[2], voiceDur: 32.56, duration: 36 });
console.log('ok');
