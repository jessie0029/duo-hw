// Fetches Google News RSS for piano-duo keywords and merges into data/news.json.
// Runs in GitHub Actions (Node 20+, no dependencies).
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/news.json', import.meta.url);
const KEEP_DAYS = 365;
const MAX_ITEMS = 150;

// [query, edition, lang]
const EDITIONS = {
  en: [['GB', 'en-GB', 'GB:en'], ['IE', 'en-IE', 'IE:en']],
  de: [['DE', 'de', 'DE:de'], ['AT', 'de', 'AT:de'], ['CH', 'de', 'CH:de']],
  it: [['IT', 'it', 'IT:it']],
};
const QUERIES = [
  ['"piano duo"', 'en'],
  ['"piano four-hands" OR "piano four hands"', 'en'],
  ['"two pianos"', 'en'],
  ['Klavierduo', 'de'],
  ['"Klavier Duo" OR "Klavier-Duo"', 'de'],
  ['"Klavier zu vier Händen" OR "vierhändig"', 'de'],
  ['"zwei Klaviere" OR "zwei Klavieren"', 'de'],
  ['"duo pianistico"', 'it'],
];

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

export function parseRss(xml, keyword, lang) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const source = tag(x, 'source');
    const sm = x.match(/<source[^>]*url="([^"]+)"/);
    const sourceUrl = sm ? decode(sm[1]) : '';
    let title = tag(x, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const date = tag(x, 'pubDate');
    items.push({ title, link: tag(x, 'link'), source, sourceUrl, date: date ? new Date(date).toISOString() : null, keyword, lang });
  }
  return items;
}
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function main() {
  let existing = { items: [] };
  try { existing = JSON.parse(await readFile(FILE, 'utf8')); } catch {}
  const fresh = [];
  for (const [q, lang] of QUERIES) {
    for (const [, hl, ceid] of EDITIONS[lang]) {
      const gl = ceid.split(':')[0];
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:30d')}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (piano-duo-hw news reader)' } });
        if (!res.ok) { console.warn(res.status, url); continue; }
        const label = q.replace(/"/g, '').split(' OR ')[0];
        fresh.push(...parseRss(await res.text(), label, lang));
      } catch (e) { console.warn('fail', url, e.message); }
      await new Promise(r => setTimeout(r, 800));
    }
  }
  const byKey = new Map();
  for (const it of [...existing.items, ...fresh]) {
    if (!it.title || !it.link) continue;
    const k = norm(it.title);
    if (!byKey.has(k)) byKey.set(k, it);
  }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const items = [...byKey.values()]
    .filter(i => !i.date || Date.parse(i.date) >= cutoff)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_ITEMS);
  await writeFile(FILE, JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
  console.log(`news: ${fresh.length} fetched, ${items.length} kept`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
