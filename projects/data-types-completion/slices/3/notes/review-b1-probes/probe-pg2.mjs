const base = process.argv[2];
const { PGlite } = await import(
  `${base}/packages/3-targets/3-targets/postgres/node_modules/@electric-sql/pglite/dist/index.js`
);
const { postgresCodecDescriptorRegistry: reg } = await import(
  `${base}/packages/3-targets/3-targets/postgres/dist/codecs.mjs`
);
const db = await PGlite.create();
const c = reg.descriptorFor('pg/text-array@1').factory({})({ name: 'v' });
for (const lit of [
  `ARRAY['NULL','a,b','back\\\\slash','{x}','']::text[]`,
  `'[0:1]={a,b}'::text[]`,
  `ARRAY[ARRAY['a','b'],ARRAY['c','d']]::text[]`,
]) {
  const { rows } = await db.query(`SELECT (${lit})::text AS v`);
  let out;
  try {
    out = JSON.stringify(await c.fromWire(rows[0].v, {}));
  } catch (e) {
    out = 'THROWS ' + e.message;
  }
  console.log(`${lit} -> ${rows[0].v} -> ${out}`);
}
