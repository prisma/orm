import { DatabaseSync } from 'node:sqlite';

const base = process.argv[2];
const { sqliteCodecDescriptorRegistry: reg } = await import(
  `${base}/packages/3-targets/3-targets/sqlite/dist/codecs.mjs`
);
const db = new DatabaseSync(':memory:');
const cases = [
  ['sqlite/real@1', 'REAL', ["'abc'", "'1.5'", '9e999', '-9e999', "x'00ff'", "'Infinity'", '1']],
  ['sql/float@1', 'REAL', ["'abc'", '9e999', "x'00ff'"]],
  ['sqlite/integer@1', 'INTEGER', ["'abc'", '1.5', "'12'", "x'00ff'", '9007199254740991']],
  ['sql/int@1', 'INTEGER', ["'abc'", '1.5', "x'00ff'"]],
  ['sqlite/blob@1', 'BLOB', ["x'00ff'", "'ABCD'", "'hello'", '12', '1.5', "x''"]],
];
for (const [id, type, lits] of cases) {
  const codec = reg.descriptorFor(id).factory({})({ name: 'v' });
  for (const lit of lits) {
    db.exec('DROP TABLE IF EXISTS t');
    db.exec(`CREATE TABLE t (v ${type})`);
    db.exec(`INSERT INTO t VALUES (${lit})`);
    const row = db.prepare('SELECT v FROM t').get();
    let out;
    try {
      out = await codec.fromWire(row.v, { column: { table: 't', name: 'v' } });
      out = `ok ${typeof out} ${out instanceof Uint8Array ? `[${[...out]}]` : String(out)}`;
    } catch (e) {
      out = `THROWS ${e.message}`;
    }
    console.log(
      `${id} ${type} ${lit} -> row ${typeof row.v} ${row.v instanceof Uint8Array ? 'bytes' : String(row.v)} -> ${out}`,
    );
  }
}
