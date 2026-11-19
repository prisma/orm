import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(
  '/Users/will/Projects/prisma/orm-wt-pooled-url/packages/3-targets/postgres/3-driver/package.json',
);
const pg = require('pg');
const direct = JSON.parse(
  readFileSync(new URL('./created.json', import.meta.url), 'utf8'),
).connectionString;
const c = new pg.Client({ connectionString: direct });
await c.connect();
for (const loc of [
  'C',
  'en_US.utf8',
  'C.UTF-8',
  'POSIX',
  'de_DE.UTF-8',
  'ja_JP.UTF-8',
  'en_GB.UTF-8',
]) {
  try {
    await c.query(`SET lc_monetary = '${loc}'`);
    const r = (
      await c.query(
        'select 1234.5::numeric::money::text pos, (-1234.5)::numeric::money::text neg, 12.50::numeric::money::text w, 0.07::numeric::money::text small',
      )
    ).rows[0];
    console.log(loc.padEnd(12), JSON.stringify(r));
  } catch (e) {
    console.log(loc.padEnd(12), 'unavailable:', e.message);
  }
}
await c.query('ALTER ROLE CURRENT_USER RESET lc_monetary');
await c.query('ALTER DATABASE postgres RESET lc_monetary');
await c.end();
