const base = process.argv[2];
const { PGlite } = await import(
  `${base}/packages/3-targets/3-targets/postgres/node_modules/@electric-sql/pglite/dist/index.js`
);
const { postgresCodecDescriptorRegistry: reg } = await import(
  `${base}/packages/3-targets/3-targets/postgres/dist/codecs.mjs`
);
const db = await PGlite.create();
const codec = (id) => reg.descriptorFor(id).factory({})({ name: 'v' });
const run = async (id, sql) => {
  const { rows } = await db.query(sql);
  let out;
  try {
    out = String(await codec(id).fromWire(rows[0].v, {}));
  } catch (e) {
    out = 'THROWS ' + e.message.slice(0, 90);
  }
  console.log(`${id}: ${rows[0].v} -> ${out}`);
};
for (const ds of ['ISO, MDY', 'SQL, DMY', 'Postgres, MDY', 'German']) {
  await db.exec(`SET DateStyle = '${ds}'`);
  console.log('DateStyle', ds);
  await run('pg/timestamp-temporal@1', `SELECT CAST('2024-01-02 03:04:05.5'::timestamp AS text) v`);
  await run('pg/date-string@1', `SELECT CAST('2024-01-02'::date AS text) v`);
  await run(
    'pg/timestamptz-temporal@1',
    `SELECT CAST('2024-01-02 03:04:05+00'::timestamptz AS text) v`,
  );
}
await db.exec(`SET DateStyle = 'ISO, MDY'`);
await db.exec(`SET bytea_output = 'escape'`);
await run('pg/bytea@1', `SELECT CAST('\\x00ff41'::bytea AS text) v`);
