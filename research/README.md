# Concert research — how the database is built

The Concerts tab in the app reads `data/concerts.json`, which is generated from the
plain-text files in `research/raw/` by `node scripts/build-concerts.mjs`.
Never edit `data/concerts.json` by hand — edit or add `.psv` files and rebuild.

## Goal

Find which **venues, promoters (Veranstalter / concert series), festivals and orchestras**
in Europe have booked **piano duos** (two pianists: four hands or two pianos) since 2005,
so that Jessie can identify realistic outreach targets for Piano Duo Hua & Wei.
Mid-size and regional presenters (Kulturkreise, Meisterkonzerte, Schubertiaden, castle
and summer festivals, regional orchestras) are just as valuable as top-tier halls.

## File format (`research/raw/<duo-slug>-<year or topic>.psv`)

```
#duo=Lucas & Arthur Jussen
#source=https://example.org/concert-archive/2025
YYYY-MM-DD|venue|city|countryISO2|orchestra|conductor|festival|promoter|repertoire
```

- One line per concert. `#duo=` and `#source=` apply to all following lines until changed.
  A line may add `|duo|source` at the end to override them for that line.
- Only European concerts (ISO2 codes, GB for the UK). Leave unknown fields empty.
- Only concerts where the two pianists perform **as a duo** (skip solo recitals, song
  recitals, chamber music without the duo, readings, broadcasts).
- A run of identical concerts by the same orchestra at the same venue on consecutive
  days = one line (first date). Tour stops at different venues = separate lines.
- `promoter` = the presenting organisation or concert series if named
  (e.g. "Meisterzyklus Bern", "Kulturkreis Gütersloh"), not the venue itself.
- Repertoire: only the duo works, separated by `; `, using these canonical names where they apply:
  - Mozart: Concerto for two pianos K. 365 · Mozart: Concerto for three pianos K. 242 · Mozart: Sonata K. 448 / K. 521 / K. 381
  - Poulenc: Concerto for two pianos · Poulenc: Sonata for four hands
  - Mendelssohn: Concerto for two pianos E major / A-flat major · Mendelssohn: Allegro brillant op. 92
  - Bruch: Concerto for two pianos op. 88a · Bartók: Concerto for two pianos, percussion and orchestra · Bartók: Sonata for two pianos and percussion
  - Saint-Saëns: Carnival of the Animals · Bach: Concerto for two keyboards BWV 1060 / 1061 / 1062
  - Schubert: Fantasie D 940 · Schubert: Allegro D 947 · Schubert: Rondo D 951
  - Ravel: La Valse · Ravel: Ma mère l'Oye · Stravinsky: Le Sacre du printemps · Debussy: Six épigraphes antiques
  - Rachmaninoff: Suite No. 1 op. 5 / Suite No. 2 op. 17 / Symphonic Dances op. 45 · Brahms: Hungarian Dances · Brahms: Haydn Variations op. 56b
  - Lutosławski: Paganini Variations · Shostakovich: Concertino op. 94 · Schumann: Andante and Variations op. 46 · Vaughan Williams: Concerto for two pianos
- Every file must have a real `#source=` URL that was actually read.

## News articles

Links in `data/news.json` are Google News redirect links, which can't be opened directly.
To read an article, search its exact title with WebSearch (optionally limited to the
`sourceUrl` domain) and open the publisher's page. Use that page's URL as the source.

## Where to look (in order of yield)

1. Duo websites with year-by-year concert histories (best: complete, dated, with orchestras).
2. Promoter / festival archives (Konzertarchiv, Rückblick, past seasons).
3. Orchestra season archives and "Werke-Archiv" pages for two-piano concertos.
4. Concert listing and review pages (concerti.de, Bachtrack, regional newspapers).
5. The Wayback Machine (web.archive.org) for old season pages that are no longer online.

The task list is in `research/queue.md`. Tick items off (`- [x]`) when done and add new
leads you discover (new duos, archives) at the bottom.
