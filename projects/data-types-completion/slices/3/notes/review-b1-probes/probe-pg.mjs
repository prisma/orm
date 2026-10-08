const base = process.argv[2];
const { PGlite } = await import(
  `${base}/packages/3-targets/3-targets/postgres/node_modules/@electric-sql/pglite/dist/index.js`
);
const { postgresCodecDescriptorRegistry: reg } = await import(
  `${base}/packages/3-targets/3-targets/postgres/dist/codecs.mjs`
);
const db = await PGlite.create();
const codec = (id) => reg.descriptorFor(id).factory({})({ name: 'v' });
const ctx = { column: { table: 't', name: 'v' } };
const show = (v) =>
  typeof v === 'object' && v !== null
    ? JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x))
    : String(v);
for (const style of ['postgres', 'postgres_verbose', 'sql_standard', 'iso_8601']) {
  await db.exec(`SET IntervalStyle = ${style}`);
  for (const lit of [
    "'1 year 2 mons 3 days 04:05:06.5'",
    "'1 mon -1 day'",
    "'-1 year -2 mons +3 days -04:00:00'",
    "'0'",
    "'-00:00:01.5'",
  ]) {
    const { rows } = await db.query(
      `SELECT (${lit}::interval)::text AS v, json_build_object('v', CAST(${lit}::interval AS text))::text AS j`,
    );
    let out;
    try {
      out = show(await codec('pg/interval@1').fromWire(rows[0].v, ctx));
    } catch (e) {
      out = 'THROWS ' + e.message;
    }
    console.log(`${style} ${lit} -> ${rows[0].v} -> ${out}`);
  }
}
for (const lit of ["ARRAY['a','b c',NULL,'\"q\"']::text[]", "'{}'::text[]"]) {
  const { rows } = await db.query(`SELECT (${lit})::text AS v`);
  let out;
  try {
    out = show(await codec('pg/text-array@1').fromWire(rows[0].v, ctx));
  } catch (e) {
    out = 'THROWS ' + e.message;
  }
  console.log(`text[] ${lit} -> ${rows[0].v} -> ${out}`);
}
