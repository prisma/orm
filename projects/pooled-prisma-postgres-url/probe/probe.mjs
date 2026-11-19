import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(
  '/Users/will/Projects/prisma/orm-wt-pooled-url/packages/3-targets/postgres/3-driver/package.json',
);
const pg = require('pg');
const direct = JSON.parse(
  readFileSync(new URL('./created.json', import.meta.url), 'utf8'),
).connectionString;
const pooled = direct.replace('@db.prisma.io', '@pooled.db.prisma.io');
const OPTS = '-c DateStyle=ISO -c lc_monetary=C';
const describe = (e) =>
  JSON.stringify({
    message: e.message,
    code: e.code,
    severity: e.severity,
    detail: e.detail,
    hint: e.hint,
  });
async function attempt(label, url, extra, use) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20000, ...extra });
  client.on('error', () => {});
  try {
    await client.connect();
    console.log(`${label}: CONNECTED`);
    if (use) await use(client);
  } catch (e) {
    console.log(`${label}: FAILED ${describe(e)}`);
  } finally {
    await client.end().catch(() => {});
  }
}
const one = async (c, sql, params) => (await c.query(sql, params)).rows[0];
const state = async (c) =>
  one(
    c,
    "select pg_backend_pid() pid, current_setting('DateStyle') ds, current_setting('lc_monetary') lm",
  );

await attempt('direct, no options', direct, {}, async (c) => console.log('  ', await state(c)));
await attempt('direct, with options', direct, { options: OPTS }, async (c) =>
  console.log('  ', await state(c)),
);
await attempt('pooled, with options', pooled, { options: OPTS });
await attempt('pooled, options DateStyle only', pooled, { options: '-c DateStyle=ISO' });
await attempt(
  'pooled, options via URL param',
  pooled + '&options=' + encodeURIComponent('-c DateStyle=ISO'),
  {},
);
await attempt('pooled, no options', pooled, {}, async (c) => {
  console.log('   before', await state(c));
  console.log(
    '   set_config',
    await one(c, 'SELECT set_config($1, $2, false), set_config($3, $4, false)', [
      'DateStyle',
      'ISO',
      'lc_monetary',
      'C',
    ]),
  );
  for (let i = 0; i < 6; i++) console.log('   after', i, await state(c));
  await c.query('BEGIN');
  console.log('   in tx 1', await state(c));
  await c.query('COMMIT');
  await c.query('BEGIN');
  console.log('   in tx 2', await state(c));
  console.log('   money', await one(c, 'select 1234.5::money::text m, now()::text t'));
  await c.query('COMMIT');
  try {
    await c.query({ name: 'probe_stmt', text: 'select $1::int v', values: [1] });
    for (let i = 0; i < 4; i++)
      await c.query({ name: 'probe_stmt', text: 'select $1::int v', values: [i] });
    await c.query('BEGIN');
    await c.query({ name: 'probe_stmt', text: 'select $1::int v', values: [9] });
    await c.query('COMMIT');
    console.log('   named prepared statements: ok');
  } catch (e) {
    console.log('   named prepared statements: FAILED', describe(e));
  }
  try {
    await c.query('BEGIN');
    await c.query('select pg_advisory_xact_lock(42)');
    await c.query('COMMIT');
    console.log('   pg_advisory_xact_lock in tx: ok');
  } catch (e) {
    console.log('   advisory lock FAILED', describe(e));
  }
});
// Does a second pooled client see the first one's session settings (shared server connections)?
const a = new pg.Client({ connectionString: pooled });
const b = new pg.Client({ connectionString: pooled });
a.on('error', () => {});
b.on('error', () => {});
try {
  await a.connect();
  await b.connect();
  await a
    .query("SELECT set_config('lc_monetary', 'de_DE.UTF-8', false)")
    .catch((e) => console.log('   set de_DE failed', e.message));
  await a.query("SELECT set_config('DateStyle', 'German', false)");
  for (let i = 0; i < 3; i++) console.log('   A', await state(a), 'B', await state(b));
} catch (e) {
  console.log('two-client probe FAILED', describe(e));
} finally {
  await a.end().catch(() => {});
  await b.end().catch(() => {});
}
