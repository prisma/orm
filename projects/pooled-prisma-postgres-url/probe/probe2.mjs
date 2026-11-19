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
const describe = (e) =>
  JSON.stringify({ message: e.message, code: e.code, detail: e.detail, hint: e.hint });
const Q =
  "select pg_backend_pid() pid, current_setting('DateStyle') ds, current_setting('lc_monetary') lm, current_setting('TimeZone') tz, current_setting('statement_timeout') st, current_setting('application_name') app";
async function attempt(label, url, extra, use) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20000, ...extra });
  c.on('error', () => {});
  try {
    await c.connect();
    const r = (await c.query(Q)).rows[0];
    console.log(`${label}: CONNECTED ${JSON.stringify(r)}`);
    if (use) await use(c);
  } catch (e) {
    console.log(`${label}: FAILED ${describe(e)}`);
  } finally {
    await c.end().catch(() => {});
  }
}
// put the shared server connection back first
await attempt('reset', pooled, {}, async (c) => {
  await c.query("SELECT set_config('lc_monetary','en_US.utf8',false)");
});
for (const o of [
  '-c lc_monetary=C',
  '-c lc_monetary=en_US.utf8',
  '-c DateStyle=German',
  '-c DateStyle=ISO -c TimeZone=Asia/Tokyo',
  '-c TimeZone=Asia/Tokyo',
  '-c statement_timeout=5000',
  '-c search_path=public',
  '-c DateStyle=ISO -c statement_timeout=5000',
  '-c lc_messages=C',
  '-c extra_float_digits=1',
])
  await attempt(`pooled options [${o}]`, pooled, { options: o });
await attempt('pooled, SET LOCAL in tx', pooled, {}, async (c) => {
  await c.query('BEGIN');
  await c.query("SELECT set_config('lc_monetary','C',true)");
  console.log('   in tx', (await c.query(Q)).rows[0].lm);
  await c.query('COMMIT');
  console.log('   after tx', (await c.query(Q)).rows[0].lm);
});
await attempt('ALTER ROLE via direct', direct, {}, async (c) => {
  try {
    await c.query("ALTER ROLE CURRENT_USER SET lc_monetary = 'C'");
    console.log('   alter role: ok');
  } catch (e) {
    console.log('   alter role FAILED', describe(e));
  }
  try {
    await c.query("ALTER DATABASE postgres SET lc_monetary = 'C'");
    console.log('   alter database: ok');
  } catch (e) {
    console.log('   alter database FAILED', describe(e));
  }
});
await attempt('direct after alter', direct, {});
await attempt('pooled after alter', pooled, {});
