// Builds data/concerts.json from research/raw/*.psv
// PSV line: date|venue|city|countryISO2|orchestra|conductor|festival|promoter|repertoire (repertoire separated by "; ")
// Header lines: "#duo=Name", "#source=URL" (apply to following lines until changed), "#note=..."
// A line may override the duo/source with trailing fields: ...|repertoire|duo|source
import { readdir, readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const EUROPE = new Set('AT DE CH FR IT ES PT NL BE LU GB IE DK SE NO FI IS PL CZ SK HU SI HR RS RO BG GR EE LV LT UA MT CY LI MC BA ME MK AL TR AD SM VA MD BY XK'.split(' '));

const clean = s => (s || '').replace(/\s+/g, ' ').trim();

async function main() {
  const dir = new URL('research/raw/', ROOT);
  const files = (await readdir(dir)).filter(f => f.endsWith('.psv')).sort();
  const out = new Map();
  let skipped = 0;
  for (const f of files) {
    let duo = '', source = '';
    for (const raw of (await readFile(new URL(f, dir), 'utf8')).split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        const m = line.match(/^#(\w+)=(.*)$/);
        if (m && m[1] === 'duo') duo = clean(m[2]);
        if (m && m[1] === 'source') source = clean(m[2]);
        continue;
      }
      const p = line.split('|').map(clean);
      const [date, venue, city, cc, orchestra, conductor, festival, promoter, rep, duo2, src2] = p;
      if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date || '')) { skipped++; continue; }
      const country = (cc || '').toUpperCase();
      if (!EUROPE.has(country)) { skipped++; continue; }
      const c = {
        date, year: +date.slice(0, 4),
        duo: duo2 || duo, venue, city, country,
        orchestra: orchestra || undefined, conductor: conductor || undefined,
        festival: festival || undefined, promoter: promoter || undefined,
        repertoire: rep ? rep.split(/\s*;\s*/).filter(Boolean) : [],
        source: src2 || source || undefined,
      };
      const id = `${c.duo}|${c.date}|${c.venue}`.toLowerCase();
      c.id = id;
      out.set(id, c); // later files override earlier duplicates
    }
  }
  const concerts = [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
  await writeFile(new URL('data/concerts.json', ROOT), JSON.stringify({ updated: new Date().toISOString(), count: concerts.length, concerts }, null, 0));
  const duos = new Set(concerts.map(c => c.duo));
  console.log(`concerts: ${concerts.length} from ${files.length} files, ${duos.size} duos (${skipped} skipped)`);
}
main();
