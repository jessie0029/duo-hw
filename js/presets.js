// Preloaded occasions. Composer dates chosen for piano-duo / four-hands repertoire.
// Each composer: [name, born 'YYYY-MM-DD' | null, died 'YYYY-MM-DD' | null, note]
export const COMPOSERS = [
  ['J. S. Bach', '1685-03-21', '1750-07-28', 'Born 21 March (Julian calendar; 31 March Gregorian). Concertos for two keyboards'],
  ['Joseph Haydn', '1732-03-31', '1809-05-31', 'Austrian'],
  ['Wolfgang Amadeus Mozart', '1756-01-27', '1791-12-05', 'Austrian · Concerto for two pianos K. 365, Sonata K. 448'],
  ['Ludwig van Beethoven', '1770-12-17', '1827-03-26', 'Baptised 17 December; died in Vienna'],
  ['Franz Schubert', '1797-01-31', '1828-11-19', 'Austrian · Fantasie in F minor D 940'],
  ['Felix Mendelssohn', '1809-02-03', '1847-11-04', 'Concertos for two pianos'],
  ['Frédéric Chopin', '1810-03-01', '1849-10-17', 'Rondo in C major for two pianos'],
  ['Robert Schumann', '1810-06-08', '1856-07-29', 'Andante and Variations op. 46'],
  ['Franz Liszt', '1811-10-22', '1886-07-31', ''],
  ['Clara Schumann', '1819-09-13', '1896-05-20', ''],
  ['Bedřich Smetana', '1824-03-02', '1884-05-12', ''],
  ['Johann Strauss II', '1825-10-25', '1899-06-03', 'Austrian · Viennese waltz arrangements'],
  ['Johannes Brahms', '1833-05-07', '1897-04-03', 'Died in Vienna · Hungarian Dances, Haydn Variations op. 56b'],
  ['Camille Saint-Saëns', '1835-10-09', '1921-12-16', 'Carnival of the Animals'],
  ['Max Bruch', '1838-01-06', '1920-10-02', 'Concerto for two pianos op. 88a'],
  ['Georges Bizet', '1838-10-25', '1875-06-03', 'Jeux d’enfants'],
  ['Pyotr Ilyich Tchaikovsky', '1840-05-07', '1893-11-06', ''],
  ['Antonín Dvořák', '1841-09-08', '1904-05-01', 'Slavonic Dances'],
  ['Edvard Grieg', '1843-06-15', '1907-09-04', ''],
  ['Gabriel Fauré', '1845-05-12', '1924-11-04', 'Dolly Suite'],
  ['Moritz Moszkowski', '1854-08-23', '1925-03-04', ''],
  ['Anton Arensky', '1861-07-12', '1906-02-25', 'Suites for two pianos'],
  ['Claude Debussy', '1862-08-22', '1918-03-25', 'En blanc et noir, Petite suite'],
  ['Ferruccio Busoni', '1866-04-01', '1924-07-27', ''],
  ['Max Reger', '1873-03-19', '1916-05-11', ''],
  ['Sergei Rachmaninoff', '1873-04-01', '1943-03-28', 'Suites for two pianos, Symphonic Dances'],
  ['Maurice Ravel', '1875-03-07', '1937-12-28', 'Ma mère l’Oye, La Valse'],
  ['Béla Bartók', '1881-03-25', '1945-09-26', 'Sonata for two pianos and percussion'],
  ['Igor Stravinsky', '1882-06-17', '1971-04-06', 'Le Sacre du printemps (four hands)'],
  ['Darius Milhaud', '1892-09-04', '1974-06-22', 'Scaramouche'],
  ['Paul Hindemith', '1895-11-16', '1963-12-28', ''],
  ['George Gershwin', '1898-09-26', '1937-07-11', ''],
  ['Francis Poulenc', '1899-01-07', '1963-01-30', 'Concerto for two pianos'],
  ['Dmitri Shostakovich', '1906-09-25', '1975-08-09', 'Concertino op. 94'],
  ['Olivier Messiaen', '1908-12-10', '1992-04-27', 'Visions de l’Amen'],
  ['Witold Lutosławski', '1913-01-25', '1994-02-07', 'Paganini Variations'],
  ['Leonard Bernstein', '1918-08-25', '1990-10-14', ''],
  ['Astor Piazzolla', '1921-03-11', '1992-07-04', ''],
  ['György Ligeti', '1923-05-28', '2006-06-12', 'Three Pieces for two pianos'],
  ['György Kurtág', '1926-02-19', null, ''],
  ['Alfred Schnittke', '1934-11-24', '1998-08-03', ''],
  ['Arvo Pärt', '1935-09-11', null, ''],
  ['Steve Reich', '1936-10-03', null, 'Piano Phase'],
  ['Philip Glass', '1937-01-31', null, ''],
];

// Fixed yearly days [MM-DD, title]
export const YEARLY = [
  ['02-14', 'Valentine’s Day'],
  ['06-21', 'Fête de la Musique'],
  ['10-01', 'International Music Day'],
];

// Moving dates
export const MOVING = {
  '2026-02-17': 'Chinese New Year 春节',
  '2026-09-25': 'Mid-Autumn Festival 中秋节',
  '2027-02-06': 'Chinese New Year 春节',
  '2027-09-15': 'Mid-Autumn Festival 中秋节',
  '2028-01-26': 'Chinese New Year 春节',
  '2028-10-03': 'Mid-Autumn Festival 中秋节',
};

function pad(n) { return String(n).padStart(2, '0'); }
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// Piano Day: 88th day of the year
function pianoDay(y) {
  const d = new Date(y, 0, 88);
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns preset occasions for a given year.
// mode: 'all' | 'round' (multiples of 25) | 'off'
export function presetsForYear(y, mode = 'all') {
  const out = [];
  if (mode !== 'off') {
    for (const [name, born, died, note] of COMPOSERS) {
      for (const [iso, verb] of [[born, 'born'], [died, 'died']]) {
        if (!iso) continue;
        const year0 = +iso.slice(0, 4);
        const n = y - year0;
        if (n <= 0) continue;
        const round = n % 25 === 0;
        if (mode === 'round' && !round) continue;
        out.push({
          id: `preset:${name}:${verb}:${y}`,
          preset: true,
          date: `${y}${iso.slice(4)}`,
          title: `${name} ${verb} ${year0}`,
          sub: `${ordinal(n)} anniversary${note ? ' · ' + note : ''}`,
          round,
          n,
        });
      }
    }
  }
  for (const [md, title] of YEARLY) out.push({ id: `preset:${md}:${y}`, preset: true, date: `${y}-${md}`, title, sub: 'Yearly' });
  out.push({ id: `preset:pianoday:${y}`, preset: true, date: pianoDay(y), title: 'Piano Day', sub: '88th day of the year' });
  for (const [d, title] of Object.entries(MOVING)) if (d.startsWith(String(y))) out.push({ id: `preset:${d}`, preset: true, date: d, title, sub: '' });
  return out;
}
