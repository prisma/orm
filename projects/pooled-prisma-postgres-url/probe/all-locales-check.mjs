// Applies the pg/money@1 codec's reading rule (codecs.ts:1189 at the base) to every printed value and reports any locale where the codec accepts the text but reads a value other than the one sent.
import { readFileSync } from 'node:fs';

const re = /^(-?)\$(\d{1,3}(?:,\d{3})*)\.(\d{2})$/;
const numeral = /^-?\d+(\.\d+)?$/;
const read = (t) => {
  const m = re.exec(t);
  if (m) return `${m[1]}${m[2].replaceAll(',', '')}.${m[3]}`;
  if (numeral.test(t)) return t;
  return undefined;
};
const norm = (n) => Number(n).toFixed(2);
const byLocale = new Map();
for (const line of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const [l, sent, printed, rawAsC] = line.split('|');
  if (rawAsC === undefined) continue;
  const e = byLocale.get(l) ?? {
    accepted: 0,
    refused: 0,
    wrongAccepted: [],
    scaled: false,
    crossWrong: [],
  };
  const got = read(printed);
  if (got === undefined) e.refused++;
  else {
    e.accepted++;
    if (norm(got) !== norm(sent)) e.wrongAccepted.push(`${sent} printed ${printed} read ${got}`);
  }
  const c = read(rawAsC);
  if (c !== undefined && norm(c) !== norm(sent)) {
    e.scaled = true;
    e.crossWrong.push(`${sent}->${rawAsC}`);
  }
  byLocale.set(l, e);
}
const all = [...byLocale.entries()];
console.log('locales scanned:', all.length);
console.log(
  'locales where every value read back exactly:',
  all
    .filter(([, e]) => e.refused === 0 && e.wrongAccepted.length === 0)
    .map(([l]) => l)
    .join(' '),
);
console.log(
  'locales where some values read and others are refused:',
  all
    .filter(([, e]) => e.refused > 0 && e.accepted > 0)
    .map(([l, e]) => `${l}(${e.accepted} read)`)
    .join(' '),
);
console.log(
  'locales where the codec accepts a value that differs from what was sent (same session):',
  all
    .filter(([, e]) => e.wrongAccepted.length)
    .map(([l, e]) => `${l}: ${e.wrongAccepted.join('; ')}`)
    .join('\n') || 'none',
);
console.log(
  'locales whose writes are scaled (read back under C as a different amount):',
  all
    .filter(([, e]) => e.scaled)
    .map(([l]) => l)
    .join(' '),
);
