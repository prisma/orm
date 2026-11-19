// Sends a money parameter in binary (int64 count of the smallest unit, as cash_recv reads it) and in text through numeric, under several lc_monetary values, then reads each row under C.
import { createRequire } from 'node:module';

const require = createRequire(
  '/Users/will/Projects/prisma/orm-wt-pooled-url/packages/3-targets/postgres/3-driver/package.json',
);
const pg = require('pg');
const c = new pg.Client({ connectionString: process.argv[2] });
await c.connect();
await c.query('DROP TABLE IF EXISTS b; CREATE TABLE b (how text, loc text, v money)');
const cents = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n);
  return b;
};
for (const loc of ['C', 'de_DE.UTF-8', 'ja_JP.UTF-8', 'ar_KW.UTF-8']) {
  await c.query(`SET lc_monetary = '${loc}'`);
  await c.query('INSERT INTO b VALUES ($1, $2, $3::money)', ['binary', loc, cents(123456n)]);
  await c.query('INSERT INTO b VALUES ($1, $2, $3::numeric::money)', ['numeric', loc, '1234.56']);
  const f = await c.query('SELECT count(*)::int n FROM b WHERE how = $1 AND v = $2::money', [
    'binary',
    cents(123456n),
  ]);
  const g = await c.query(
    'SELECT count(*)::int n FROM b WHERE how = $1 AND v = $2::numeric::money',
    ['binary', '1234.56'],
  );
  console.log(
    loc.padEnd(12),
    'filter by binary param matches',
    f.rows[0].n,
    'row(s); filter by numeric param matches',
    g.rows[0].n,
    'of the binary-written rows',
  );
}
await c.query("SET lc_monetary = 'C'");
for (const r of (await c.query('SELECT how, loc, v::text FROM b ORDER BY how, loc')).rows)
  console.log('read under C:', r.how.padEnd(8), r.loc.padEnd(12), r.v);
await c.end();
