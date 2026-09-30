# Manual QA

Each slice that changes a user-facing diagnostic adds a script here and records a run. The reader checks that each message tells a user what is wrong and what to write.

## Slice 2a: `sql` is the data type `sql/expression`

### Script

The script writes a one-model schema for each case, runs `prisma contract emit` on it with the Postgres stack, and prints each diagnostic's code, start position and message. It needs no database.

1. Run `pnpm install` and `pnpm build` at the repository root.
2. Create the folder `examples/prisma-8-demo/wip-qa/` with the two files below. Do not commit it.
3. Run `sh examples/prisma-8-demo/wip-qa/run.sh`.
4. Delete `examples/prisma-8-demo/wip-qa/`.

`prisma.config.ts`:

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    db: { connection: 'postgres://localhost/unused' },
  }),
});
```

`run.sh`:

```sh
#!/bin/sh
cd "$(dirname "$0")"
i=0
while IFS= read -r line; do
  i=$((i+1))
  printf '// use prisma-8\nmodel T {\n  id Int @id\n  %s\n}\n' "$line" > contract.prisma
  echo "=== case $i: $line"
  (cd .. && pnpm exec prisma contract emit --config wip-qa/prisma.config.ts) 2>&1 | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      for (const l of s.split("\n")) { let j; try{j=JSON.parse(l)}catch{ if(l.trim()) console.log(l); continue }
        if (j.kind!=="result") continue;
        const e=j.envelope; if(e.ok){console.log("ok");continue}
        console.log(e.error.code+": "+e.error.summary);
        for(const d of e.error.meta?.diagnostics??[]) console.log("  "+d.code+" ["+JSON.stringify(d.span?.start)+"] "+d.message);
      }})'
  if [ -f contract.json ]; then node -e 'const c=require("./contract.json");console.log("  stored default:",JSON.stringify(JSON.stringify(c).match(/"default":\{[^}]*\}/g)))'; rm -f contract.json contract.d.ts; fi
done <<'CASES'
v String @default(sql`gen_random_uuid()`)
v String @default(pg.sql`gen_random_uuid()`)
v DateTime @default(sql`now()`)
v String @default(sql`x; drop table t`)
tags String[] @default([sql`md5(x)`])
v Int @default(json`1`)
v Jsonb @default(json`{ plan }`)
v Int @default(100000000000000099)
v Jsonb[] @default(json`{}`)
CASES
rm -f contract.prisma contract.json contract.d.ts
```

### What to check

| Case | Expected |
| --- | --- |
| 1 | The emit succeeds and stores a function default with the text `gen_random_uuid()` |
| 2 | `PSL_UNKNOWN_LITERAL_TAG`, and the known tags are `sql, json`: the family registers `sql` and is assembled before the target |
| 3 | `PSL_INVALID_DEFAULT_SQL`, and the message says to write `@default(now())` |
| 4 | `PSL_INVALID_DEFAULT_SQL` with the unsafe SQL message |
| 5 | `PSL_VALUE_TYPE_INCOMPATIBLE`, naming element 1 and `sql/expression` |
| 6 | `PSL_VALUE_TYPE_INCOMPATIBLE`, naming the cast `pg/int4` has |
| 7 | `PSL_INVALID_LITERAL` with the JSON parser's message |
| 8 | `PSL_VALUE_TYPE_INCOMPATIBLE` for a number too wide for the column |
| 9 | `PSL_DEFAULT_LIST_EXPECTED`, and the message says to write a list literal |

### Run on 2026-09-29

Result: every case gave the expected code and message. The diagnostics of cases 2, 3 and 4 start at the literal. The others start at the `@default` attribute.

```text
=== case 1: v String @default(sql`gen_random_uuid()`)
ok
  stored default: ["\"default\":{\"expression\":\"gen_random_uuid()\",\"kind\":\"function\"}"]
=== case 2: v String @default(pg.sql`gen_random_uuid()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":59,"line":4,"column":21}] Unknown literal tag "pg.sql". Known tags: json, sql.
=== case 3: v DateTime @default(sql`now()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_DEFAULT_SQL [{"offset":61,"line":4,"column":23}] Write @default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL.
=== case 4: v String @default(sql`x; drop table t`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_DEFAULT_SQL [{"offset":59,"line":4,"column":21}] Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.
=== case 5: tags String[] @default([sql`md5(x)`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":55,"line":4,"column":17}] Field "T.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing
=== case 6: v Int @default(json`1`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":47,"line":4,"column":9}] Field "T.v": pg/int4 has no cast from pg/json; it casts from pg/int2
=== case 7: v Jsonb @default(json`{ plan }`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_LITERAL [{"offset":49,"line":4,"column":11}] Field "T.v": Expected property name or '}' in JSON at position 2 (line 1 column 3)
=== case 8: v Int @default(100000000000000099)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":47,"line":4,"column":9}] Field "T.v": pg/int4 has no cast from pg/int8; it casts from pg/int2
=== case 9: v Jsonb[] @default(json`{}`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_DEFAULT_TYPE_INCOMPATIBLE [{"offset":51,"line":4,"column":13}] Field "T.v": this column holds a list, so its default is a list literal, as in [1, 2]
```

### Run on 2026-09-30, after the round 2 review fixes

Run on commit `7870e28f59` plus the tag-order test, after `pnpm build`. Result: every case gave the expected code and message. Case 2 lists the known tags as `sql, json`, because the family registers `sql` and is assembled before the target. The diagnostics of cases 2, 3 and 4 start at the literal. The others start at the `@default` attribute. Case 9 reports `PSL_DEFAULT_LIST_EXPECTED`, the new name of `PSL_DEFAULT_TYPE_INCOMPATIBLE`; its message did not change.

```text
=== case 1: v String @default(sql`gen_random_uuid()`)
ok
  stored default: ["\"default\":{\"expression\":\"gen_random_uuid()\",\"kind\":\"function\"}"]
=== case 2: v String @default(pg.sql`gen_random_uuid()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":59,"line":4,"column":21}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 3: v DateTime @default(sql`now()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_DEFAULT_SQL [{"offset":61,"line":4,"column":23}] Write @default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL.
=== case 4: v String @default(sql`x; drop table t`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_DEFAULT_SQL [{"offset":59,"line":4,"column":21}] Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.
=== case 5: tags String[] @default([sql`md5(x)`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":55,"line":4,"column":17}] Field "T.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing
=== case 6: v Int @default(json`1`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":47,"line":4,"column":9}] Field "T.v": pg/int4 has no cast from pg/json; it casts from pg/int2
=== case 7: v Jsonb @default(json`{ plan }`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_LITERAL [{"offset":49,"line":4,"column":11}] Field "T.v": Expected property name or '}' in JSON at position 2 (line 1 column 3)
=== case 8: v Int @default(100000000000000099)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":47,"line":4,"column":9}] Field "T.v": pg/int4 has no cast from pg/int8; it casts from pg/int2
=== case 9: v Jsonb[] @default(json`{}`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_DEFAULT_LIST_EXPECTED [{"offset":51,"line":4,"column":13}] Field "T.v": this column holds a list, so its default is a list literal, as in [1, 2]
```
