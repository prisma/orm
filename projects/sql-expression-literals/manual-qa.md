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

## Slice 2t: an argument declares the data type it receives

Slice 2t moves two `@default` diagnostics to the written value and stops offering `sql` as a list element. An unknown tag inside a list is reported at its element. A default function called with wrong arguments reports the function's own diagnostic at the argument, not `Expected one of`. Nothing else a user sees changes.

### Script

Use the slice 2a script with these cases in place of its `CASES` block:

```text
tags String[] @default([sql`md5(x)`])
v Int @default(json`1`)
v Jsonb @default(json`{ plan }`)
v Int @default(100000000000000099)
tags Int[] @default([1, "x"])
v Jsonb[] @default(json`{}`)
v String @default(pg.sql`gen_random_uuid()`)
v String @default(archived)
v Jsonb[] @default([json`{}`, pg.json`[1]`])
v String @default(uuid(5))
v String @default(nanoid(1))
v String @default(other(1))
v Json @default("{}")
v Int @default([1])
```

### What to check

| Case | Expected |
| --- | --- |
| 1 | `PSL_VALUE_TYPE_INCOMPATIBLE`, starting at the element `` sql`md5(x)` `` (column 27), not at the attribute |
| 2 | `PSL_VALUE_TYPE_INCOMPATIBLE`, starting at `` json`1` `` (column 18) |
| 3 | `PSL_INVALID_LITERAL`, starting at the `json` literal (column 20) |
| 4 | `PSL_VALUE_TYPE_INCOMPATIBLE`, starting at the number (column 18) |
| 5 | `PSL_VALUE_TYPE_INCOMPATIBLE`, naming element 2 and starting at `"x"` (column 27) |
| 6 | `PSL_DEFAULT_LIST_EXPECTED`, still starting at the `@default` attribute (column 13) |
| 7 | `PSL_UNKNOWN_LITERAL_TAG`, still starting at the literal (column 21) |
| 8 | `PSL_INVALID_ATTRIBUTE_SYNTAX`; the list at the end of the message offers `json` and not `sql` |
| 9 | `PSL_UNKNOWN_LITERAL_TAG` for `pg.json`, starting at that element (column 33) |
| 10 | `PSL_INVALID_ATTRIBUTE_SYNTAX`, `Expected one of: 4 \| 7`, starting at `5` (column 26) |
| 11 | `PSL_INVALID_ATTRIBUTE_SYNTAX`, `Expected an integer between 2 and 255`, starting at `1` (column 28) |
| 12 | `PSL_INVALID_ATTRIBUTE_SYNTAX`, `Expected one of: …` for every default form, starting at `other(1)` (column 21) |
| 13 | `PSL_VALUE_TYPE_INCOMPATIBLE`, ``pg/json has no cast from pg/text; write json`...` ``, starting at `"{}"` (column 19) |
| 14 | `PSL_VALUE_TYPE_INCOMPATIBLE`, `pg/int4 has no cast from a list; write a number`, starting at `[1]` (column 18) |

After the review fixes, every cast-rule refusal ends with what to write (`write a number`, ``write json`...` ``, `write a quoted string`), not `it casts from …`, and `Unknown literal tag` starts with the field it is about.

### Run on 2026-09-30

Run on commit `55f5c11982`, after `pnpm build`. Result: every case gave the expected code, message and start. Messages are unchanged from slice 2a; only the start of cases 1 to 5 moved, from the `@default` attribute to the written value.

```text
=== case 1: tags String[] @default([sql`md5(x)`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing
=== case 2: v Int @default(json`1`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/json; it casts from pg/int2
=== case 3: v Jsonb @default(json`{ plan }`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_LITERAL [{"offset":58,"line":4,"column":20}] Field "T.v": Expected property name or '}' in JSON at position 2 (line 1 column 3)
=== case 4: v Int @default(100000000000000099)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/int8; it casts from pg/int2
=== case 5: tags Int[] @default([1, "x"])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 2: pg/int4 has no cast from pg/text; it casts from pg/int2
=== case 6: v Jsonb[] @default(json`{}`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_DEFAULT_LIST_EXPECTED [{"offset":51,"line":4,"column":13}] Field "T.v": this column holds a list, so its default is a list literal, as in [1, 2]
=== case 7: v String @default(pg.sql`gen_random_uuid()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":59,"line":4,"column":21}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 8: v String @default(archived)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":59,"line":4,"column":21}] Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | sql`...` | json`...` | list of (string | number | boolean | json`...`)
```


### Run on 2026-09-30, after the findings fixes

Run on commit `c294bfd4f1`, after `pnpm build`. Result: every case gave the expected code, message and start. Cases 1 to 8 are unchanged from the earlier run. Case 9 reports the unknown tag at its element. Cases 10 and 11 report the function's own message at the argument; case 12, a function no arm names, still lists every default form.

```text
=== case 1: tags String[] @default([sql`md5(x)`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing
=== case 2: v Int @default(json`1`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/json; it casts from pg/int2
=== case 3: v Jsonb @default(json`{ plan }`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_LITERAL [{"offset":58,"line":4,"column":20}] Field "T.v": Expected property name or '}' in JSON at position 2 (line 1 column 3)
=== case 4: v Int @default(100000000000000099)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/int8; it casts from pg/int2
=== case 5: tags Int[] @default([1, "x"])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 2: pg/int4 has no cast from pg/text; it casts from pg/int2
=== case 6: v Jsonb[] @default(json`{}`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_DEFAULT_LIST_EXPECTED [{"offset":51,"line":4,"column":13}] Field "T.v": this column holds a list, so its default is a list literal, as in [1, 2]
=== case 7: v String @default(pg.sql`gen_random_uuid()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":59,"line":4,"column":21}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 8: v String @default(archived)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":59,"line":4,"column":21}] Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | sql`...` | json`...` | list of (string | number | boolean | json`...`)
=== case 9: v Jsonb[] @default([json`{}`, pg.json`[1]`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":71,"line":4,"column":33}] Unknown literal tag "pg.json". Known tags: sql, json.
=== case 10: v String @default(uuid(5))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":64,"line":4,"column":26}] Expected one of: 4 | 7
=== case 11: v String @default(nanoid(1))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":66,"line":4,"column":28}] Expected an integer between 2 and 255
=== case 12: v String @default(other(1))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":59,"line":4,"column":21}] Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | sql`...` | json`...` | list of (string | number | boolean | json`...`)
```

### Run on 2026-09-30, after the review fixes

Run on commit `b1c449985b`, after `pnpm build`. Result: every case gave the expected code, start and message. The starts are unchanged from the earlier run. Every cast-rule message now ends with what to write; cases 7 and 9 start with the field; cases 13 and 14 are new.

```text
=== case 1: tags String[] @default([sql`md5(x)`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 1: pg/text has no cast from sql/expression; write a quoted string
=== case 2: v Int @default(json`1`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/json; write a number
=== case 3: v Jsonb @default(json`{ plan }`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_LITERAL [{"offset":58,"line":4,"column":20}] Field "T.v": Expected property name or '}' in JSON at position 2 (line 1 column 3)
=== case 4: v Int @default(100000000000000099)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from pg/int8; write a number
=== case 5: tags Int[] @default([1, "x"])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 2: pg/int4 has no cast from pg/text; write a number
=== case 6: v Jsonb[] @default(json`{}`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_DEFAULT_LIST_EXPECTED [{"offset":51,"line":4,"column":13}] Field "T.v": this column holds a list, so its default is a list literal, as in [1, 2]
=== case 7: v String @default(pg.sql`gen_random_uuid()`)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":59,"line":4,"column":21}] Field "T.v": Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 8: v String @default(archived)
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":59,"line":4,"column":21}] Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | sql`...` | json`...` | list of (string | number | boolean | json`...`)
=== case 9: v Jsonb[] @default([json`{}`, pg.json`[1]`])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":71,"line":4,"column":33}] Field "T.v" at element 2: Unknown literal tag "pg.json". Known tags: sql, json.
=== case 10: v String @default(uuid(5))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":64,"line":4,"column":26}] Expected one of: 4 | 7
=== case 11: v String @default(nanoid(1))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":66,"line":4,"column":28}] Expected an integer between 2 and 255
=== case 12: v String @default(other(1))
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":59,"line":4,"column":21}] Expected one of: string | number | boolean | autoincrement() | now() | uuid() | cuid() | ulid() | nanoid() | sql`...` | json`...` | list of (string | number | boolean | json`...`)
=== case 13: v Json @default("{}")
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":57,"line":4,"column":19}] Field "T.v": pg/json has no cast from pg/text; write json`...`
=== case 14: v Int @default([1])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from a list; write a number
```

### Cases added by the round 2 review fixes

The round 2 review fixes reword one refusal: an element of a list written on a column whose type has a list cast, such as a vector, that the list cast does not take. These cases need the pgvector extension, so the slice 2a `prisma.config.ts` adds `import pgvector from '@prisma/orm-extension-pgvector/control';` and `extensions: [pgvector],` inside `ormConfig`. Use these cases in place of the `CASES` block:

```text
tags Int[] @default([1, "x"])
v Int @default([1])
v pgvector.Vector(3) @default([1, "x", 3])
v pgvector.Vector(3) @default([1, 2, 3])
```

| Case | Expected |
| --- | --- |
| 1 | Unchanged from case 5 above |
| 2 | Unchanged from case 14 above |
| 3 | `PSL_VALUE_TYPE_INCOMPATIBLE`, `Field "T.v" at element 2: pgvector/vector has no cast from a list holding pg/text; write a number`, starting at `"x"` (column 37) |
| 4 | No diagnostic; the stored default is `[1, 2, 3]` |

### Run on 2026-09-30, after the round 2 review fixes

Run on commit `2d788c2342`, after `pnpm build`. Result: every case gave the expected code, start and message. Case 3 used to end `pgvector/vector has no cast from pg/text; write a number`, which named a cast the vector type does not declare.

```text
=== case 1: tags Int[] @default([1, "x"])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":65,"line":4,"column":27}] Field "T.tags" at element 2: pg/int4 has no cast from pg/text; write a number
=== case 2: v Int @default([1])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":56,"line":4,"column":18}] Field "T.v": pg/int4 has no cast from a list; write a number
=== case 3: v pgvector.Vector(3) @default([1, "x", 3])
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":75,"line":4,"column":37}] Field "T.v" at element 2: pgvector/vector has no cast from a list holding pg/text; write a number
=== case 4: v pgvector.Vector(3) @default([1, 2, 3])
ok
  stored default: ["\"default\":{\"kind\":\"literal\",\"value\":[1,2,3]}"]
```

## Slice 2b: the six places take `sql` literals

Slice 2b makes `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, and a policy's `using` and `withCheck` receive `sql/expression`. Every value other than a `sql` literal is refused at the written value.

### Script

The script writes a one-model schema with one place filled in for each case, runs `prisma contract emit` with the Postgres stack, and prints each diagnostic's code, start position and message, or the stored text when the emit succeeds. It needs no database. Each case line is a place and a value; `\n` in the value is a line break.

1. Run `pnpm install` and `pnpm build` at the repository root.
2. Create the folder `examples/prisma-8-demo/wip-qa/` with the `prisma.config.ts` of the slice 2a script and the `run.sh` below. Do not commit it.
3. Run `sh examples/prisma-8-demo/wip-qa/run.sh`.
4. Delete `examples/prisma-8-demo/wip-qa/`.

`run.sh`:

```sh
#!/bin/sh
cd "$(dirname "$0")"
i=0
while IFS=' ' read -r place value; do
  i=$((i+1))
  v=$(printf '%b' "$value")
  attr=''; block=''
  case "$place" in
    index-where) attr="@@index([title], where: $v)" ;;
    index-expression) attr="@@index(expression: $v, name: \"t_expr\")" ;;
    fts-where) attr="@@fullTextIndex([title], where: $v, name: \"t_fts\")" ;;
    check) attr="@@check(expression: $v, name: \"t_check\")" ;;
    using) block="policy_select t_read {
  target = T
  using  = $v
}" ;;
    withCheck) block="policy_insert t_write {
  target    = T
  withCheck = $v
}" ;;
  esac
  printf '// use prisma-8\nmodel T {\n  id    Int    @id\n  title String\n  @@rls\n  %s\n}\n%s\n' "$attr" "$block" > contract.prisma
  echo "=== case $i: $place $value"
  (cd .. && pnpm exec prisma contract emit --config wip-qa/prisma.config.ts) 2>&1 | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      for (const l of s.split("\n")) { let j; try{j=JSON.parse(l)}catch{ if(l.trim()) console.log(l); continue }
        if (j.kind!=="result") continue;
        const e=j.envelope; if(e.ok){console.log("ok");continue}
        console.log(e.error.code+": "+e.error.summary);
        for(const d of e.error.meta?.diagnostics??[]) console.log("  "+d.code+" ["+JSON.stringify(d.span?.start)+"] "+d.message);
      }})'
  if [ -f contract.json ]; then node -e '
    const c=require("./contract.json");const t=c.storage.namespaces.public.entries.table.T;
    const p=Object.values(c.storage.namespaces.public.entries.policy??{})[0];
    console.log("  stored:",JSON.stringify({where:t.indexes?.[0]?.where,expression:t.indexes?.[0]?.expression,check:t.checks?.[0]?.expression,using:p?.using,withCheck:p?.withCheck}))'; rm -f contract.json contract.d.ts; fi
done <<'CASES'
index-where "(title IS NULL)"
index-where 42
index-where true
index-where archived
index-where pg.sql`x`
index-where sql`\n    title IS NOT NULL\n      AND id > 0\n  `
index-expression "lower(title)"
index-expression 42
index-expression true
index-expression archived
index-expression pg.sql`x`
index-expression sql`\n    lower(title),\n    id\n  `
fts-where "(title IS NULL)"
fts-where 42
fts-where true
fts-where archived
fts-where pg.sql`x`
fts-where sql`\n    title IS NOT NULL\n      AND id > 0\n  `
check "id > 0"
check 42
check true
check archived
check pg.sql`x`
check sql`\n    id > 0\n      AND length(title) < 200\n  `
check sql``
using "\\"id\\" = 1"
using 42
using true
using archived
using pg.sql`x`
using sql`\n    EXISTS (\n      SELECT 1 FROM "T" WHERE "T".id = 1\n    )\n  `
withCheck "id > 0"
withCheck 42
withCheck true
withCheck archived
withCheck pg.sql`x`
withCheck sql`\n    id > 0\n      AND title <> ''\n  `
index-where "  title IS NULL"
CASES
rm -f contract.prisma contract.json contract.d.ts
```

### What to check

For each of the six places, in this order: a plain string, a number, `true`, an identifier, `pg.sql`, and a multi-line `sql` literal. Every diagnostic starts at the written value, not at the attribute or the block.

| Case | Expected |
| --- | --- |
| Plain string | `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...`; write sql`<the same text>` `` |
| `42` | `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` `` |
| `true` | `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` `` |
| `archived` | `PSL_INVALID_ATTRIBUTE_SYNTAX`, ``Expected sql`...`; got an identifier`` |
| `` pg.sql`x` `` | `PSL_UNKNOWN_LITERAL_TAG`, `Unknown literal tag "pg.sql". Known tags: sql, json.` |
| Multi-line `sql` literal | `ok`; the stored text has the common indentation and the blank lines at the start and end removed |
| 25, `` @@check(expression: sql``) `` | `PSL_CHECK_EXPRESSION_EMPTY`, at the attribute |
| 38, a plain string with leading spaces | `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` `` with no rewrite, because the exact rewrite would read back without the spaces |

### Run on 2026-09-30

Run on commit `6287c89999`, after `pnpm build`. Result: every case gave the expected code, message and start. The start column differs by place because the value sits at a different column in each template.

```text
=== case 1: index-where "(title IS NULL)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] sql/expression has no cast from pg/text; write it as sql`(title IS NULL)`
=== case 2: index-where 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] sql/expression has no cast from pg/int2; write sql`...`
=== case 3: index-where true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] sql/expression has no cast from pg/bool; write sql`...`
=== case 4: index-where archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":94,"line":6,"column":27}] Expected sql`...`, got an identifier
=== case 5: index-where pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":94,"line":6,"column":27}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 6: index-where sql`
    title IS NOT NULL
      AND id > 0
  `
ok
  stored: {"where":"title IS NOT NULL\n  AND id > 0"}
=== case 7: index-expression "lower(title)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/text; write it as sql`lower(title)`
=== case 8: index-expression 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/int2; write sql`...`
=== case 9: index-expression true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/bool; write sql`...`
=== case 10: index-expression archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":90,"line":6,"column":23}] Expected sql`...`, got an identifier
=== case 11: index-expression pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":90,"line":6,"column":23}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 12: index-expression sql`
    lower(title),
    id
  `
ok
  stored: {"expression":"lower(title),\nid"}
=== case 13: fts-where "(title IS NULL)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] sql/expression has no cast from pg/text; write it as sql`(title IS NULL)`
=== case 14: fts-where 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] sql/expression has no cast from pg/int2; write sql`...`
=== case 15: fts-where true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] sql/expression has no cast from pg/bool; write sql`...`
=== case 16: fts-where archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":102,"line":6,"column":35}] Expected sql`...`, got an identifier
=== case 17: fts-where pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":102,"line":6,"column":35}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 18: fts-where sql`
    title IS NOT NULL
      AND id > 0
  `
ok
  stored: {"where":"title IS NOT NULL\n  AND id > 0","expression":"to_tsvector('english', \"title\")"}
=== case 19: check "id > 0"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/text; write it as sql`id > 0`
=== case 20: check 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/int2; write sql`...`
=== case 21: check true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] sql/expression has no cast from pg/bool; write sql`...`
=== case 22: check archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":90,"line":6,"column":23}] Expected sql`...`, got an identifier
=== case 23: check pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":90,"line":6,"column":23}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 24: check sql`
    id > 0
      AND length(title) < 200
  `
ok
  stored: {"check":"id > 0\n  AND length(title) < 200"}
=== case 25: check sql``
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_CHECK_EXPRESSION_EMPTY [{"offset":70,"line":6,"column":3}] `@@check` expression must not be empty — an empty predicate is not a constraint
=== case 26: using "\"id\" = 1"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] sql/expression has no cast from pg/text; write it as sql`"id" = 1`
=== case 27: using 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] sql/expression has no cast from pg/int2; write sql`...`
=== case 28: using true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] sql/expression has no cast from pg/bool; write sql`...`
=== case 29: using archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":120,"line":10,"column":12}] Expected sql`...`, got an identifier
=== case 30: using pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":120,"line":10,"column":12}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 31: using sql`
    EXISTS (
      SELECT 1 FROM "T" WHERE "T".id = 1
    )
  `
ok
  stored: {"using":"EXISTS (\n  SELECT 1 FROM \"T\" WHERE \"T\".id = 1\n)"}
=== case 32: withCheck "id > 0"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] sql/expression has no cast from pg/text; write it as sql`id > 0`
=== case 33: withCheck 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] sql/expression has no cast from pg/int2; write sql`...`
=== case 34: withCheck true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] sql/expression has no cast from pg/bool; write sql`...`
=== case 35: withCheck archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":127,"line":10,"column":15}] Expected sql`...`, got an identifier
=== case 36: withCheck pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":127,"line":10,"column":15}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 37: withCheck sql`
    id > 0
      AND title <> ''
  `
ok
  stored: {"withCheck":"id > 0\n  AND title <> ''"}
=== case 38: index-where "  title IS NULL"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] sql/expression has no cast from pg/text; write it as a sql literal
```

### Run on 2026-10-07, after the round 3 review fixes

Run on commit `1e6660ca79`, on a freshly built and installed workspace. The script ran as written; no path had moved. Result: every case matched the table.

- Plain strings (cases 1, 7, 13, 19, 26, 32): `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...`; write sql`<the same text>` ``.
- `42` and `true` (cases 2, 3, 8, 9, 14, 15, 20, 21, 27, 28, 33, 34): `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` ``.
- `archived` (cases 4, 10, 16, 22, 29, 35): `PSL_INVALID_ATTRIBUTE_SYNTAX`, ``Expected sql`...`; got an identifier``.
- `` pg.sql`x` `` (cases 5, 11, 17, 23, 30, 36): `PSL_UNKNOWN_LITERAL_TAG`, `Unknown literal tag "pg.sql". Known tags: sql, json.`
- Multi-line `sql` literals (cases 6, 12, 18, 24, 31, 37): `ok`. Each stored text has the common indentation and the blank lines at the start and end removed.
- Case 25, `` @@check(expression: sql``) ``: `PSL_CHECK_EXPRESSION_EMPTY`, starting at the attribute (line 6, column 3).
- Case 38, a plain string with leading spaces: `PSL_VALUE_TYPE_INCOMPATIBLE`, ``Expected sql`...` `` with no rewrite.

Every other diagnostic starts at the written value: line 6, column 27 for `index-where`; line 6, column 23 for `index-expression` and `check`; line 6, column 35 for `fts-where`; line 10, column 12 for `using`; line 10, column 15 for `withCheck`. These are the same starts as the 2026-09-30 run.

```text
=== case 1: index-where "(title IS NULL)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] Expected sql`...`; write sql`(title IS NULL)`
=== case 2: index-where 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] Expected sql`...`
=== case 3: index-where true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] Expected sql`...`
=== case 4: index-where archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":94,"line":6,"column":27}] Expected sql`...`; got an identifier
=== case 5: index-where pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":94,"line":6,"column":27}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 6: index-where sql`
    title IS NOT NULL
      AND id > 0
  `
ok
  stored: {"where":"title IS NOT NULL\n  AND id > 0"}
=== case 7: index-expression "lower(title)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`; write sql`lower(title)`
=== case 8: index-expression 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`
=== case 9: index-expression true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`
=== case 10: index-expression archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":90,"line":6,"column":23}] Expected sql`...`; got an identifier
=== case 11: index-expression pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":90,"line":6,"column":23}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 12: index-expression sql`
    lower(title),
    id
  `
ok
  stored: {"expression":"lower(title),\nid"}
=== case 13: fts-where "(title IS NULL)"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] Expected sql`...`; write sql`(title IS NULL)`
=== case 14: fts-where 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] Expected sql`...`
=== case 15: fts-where true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":102,"line":6,"column":35}] Expected sql`...`
=== case 16: fts-where archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":102,"line":6,"column":35}] Expected sql`...`; got an identifier
=== case 17: fts-where pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":102,"line":6,"column":35}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 18: fts-where sql`
    title IS NOT NULL
      AND id > 0
  `
ok
  stored: {"where":"title IS NOT NULL\n  AND id > 0","expression":"to_tsvector('english', \"title\")"}
=== case 19: check "id > 0"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`; write sql`id > 0`
=== case 20: check 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`
=== case 21: check true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":90,"line":6,"column":23}] Expected sql`...`
=== case 22: check archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":90,"line":6,"column":23}] Expected sql`...`; got an identifier
=== case 23: check pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":90,"line":6,"column":23}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 24: check sql`
    id > 0
      AND length(title) < 200
  `
ok
  stored: {"check":"id > 0\n  AND length(title) < 200"}
=== case 25: check sql``
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_CHECK_EXPRESSION_EMPTY [{"offset":70,"line":6,"column":3}] `@@check` expression must not be empty — an empty predicate is not a constraint
=== case 26: using "\"id\" = 1"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] Expected sql`...`; write sql`"id" = 1`
=== case 27: using 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] Expected sql`...`
=== case 28: using true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":120,"line":10,"column":12}] Expected sql`...`
=== case 29: using archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":120,"line":10,"column":12}] Expected sql`...`; got an identifier
=== case 30: using pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":120,"line":10,"column":12}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 31: using sql`
    EXISTS (
      SELECT 1 FROM "T" WHERE "T".id = 1
    )
  `
ok
  stored: {"using":"EXISTS (\n  SELECT 1 FROM \"T\" WHERE \"T\".id = 1\n)"}
=== case 32: withCheck "id > 0"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] Expected sql`...`; write sql`id > 0`
=== case 33: withCheck 42
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] Expected sql`...`
=== case 34: withCheck true
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":127,"line":10,"column":15}] Expected sql`...`
=== case 35: withCheck archived
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_INVALID_ATTRIBUTE_SYNTAX [{"offset":127,"line":10,"column":15}] Expected sql`...`; got an identifier
=== case 36: withCheck pg.sql`x`
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_UNKNOWN_LITERAL_TAG [{"offset":127,"line":10,"column":15}] Unknown literal tag "pg.sql". Known tags: sql, json.
=== case 37: withCheck sql`
    id > 0
      AND title <> ''
  `
ok
  stored: {"withCheck":"id > 0\n  AND title <> ''"}
=== case 38: index-where "  title IS NULL"
CONTRACT.SOURCE_LOAD_FAILED: Failed to resolve contract source
  PSL_VALUE_TYPE_INCOMPATIBLE [{"offset":94,"line":6,"column":27}] Expected sql`...`
```

## Slice 3: the TypeScript builder takes `sql` values

Slice 3 makes the TypeScript `sql` tag return a `SqlExpression` and makes every builder field that takes raw SQL accept only that value. The script reads each new refusal as a user sees it: the run-time refusals JavaScript that is not type-checked meets, the checks `.default()` now runs, and the compile-time refusals.

### Script

Revised 2026-10-08 after review round 3: the expected messages name the object, a case covers an unnamed full-text index with several fields, a case covers a value that carries the `sql` marker but is not a real `SqlExpression`, and the compile check runs through the package's `typecheck` script, because the repository's command hook refuses a direct `tsc`.

1. Run `pnpm install` and `pnpm build` at the repository root.
2. Create `examples/prisma-8-demo/src/wip-qa-3/` with the two files below. Do not commit it. The folder sits in the example's `src/` so that `@prisma/orm-postgres` resolves and the example's `typecheck` covers it.
3. From `examples/prisma-8-demo`, run `pnpm exec tsx src/wip-qa-3/refusals.ts`, then `pnpm typecheck`. Every `typecheck` error must come from `src/wip-qa-3/compile-errors.ts`.
4. Delete `examples/prisma-8-demo/src/wip-qa-3/`.

`refusals.ts`:

```ts
import { int4Column, textColumn } from '@prisma/orm-postgres/adapter/column-types';
import {
  check,
  defineContract,
  field,
  fullTextIndex,
  model,
  policySelect,
  rlsEnabled,
  role,
  type SqlExpression,
  sql,
} from '@prisma/orm-postgres/contract-builder';

const untyped = (value: unknown) => value as SqlExpression;
const untypedSql = sql as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => SqlExpression;
const untypedFullText = fullTextIndex as unknown as (fields: unknown, options: unknown) => unknown;
const marked = (text: unknown) => untyped({ [Symbol.for('@prisma/sql-expression')]: true, text });
const fields = () => ({ id: field.column(int4Column).id(), email: field.column(textColumn), title: field.column(textColumn) });
const indexWhere = (where: SqlExpression) =>
  defineContract({ models: { U: model('U', { fields: fields() }).sql(({ cols, constraints }) => ({ indexes: [constraints.index([cols.email], { name: 'u_a', where })] })) } });

const cases: [string, () => unknown][] = [
  ['a string in index where', () => indexWhere(untyped('email IS NULL'))],
  ['a string in index expression', () =>
    defineContract({ models: { U: model('U', { fields: fields() }).sql(({ constraints }) => ({ indexes: [constraints.index({ expression: untyped('lower(email)'), name: 'u_e' })] })) } })],
  ['a string in check', () =>
    defineContract({ models: { U: model('U', { fields: fields() }).sql({ checks: [check({ expression: untyped('id > 0'), name: 'u_c' })] }) } })],
  ['a string in a policy using', () => {
    const U = model('U', { fields: fields() }).sql({ table: 'u' });
    return defineContract({ models: { U }, entities: [rlsEnabled(U), policySelect(U, { name: 'u_read', roles: [role('anon')], using: untyped('true') })] });
  }],
  ['a string in an unnamed fullTextIndex where, two fields', () =>
    untypedFullText([{ kind: 'columnRef', fieldName: 'title' }, { kind: 'columnRef', fieldName: 'email' }], { where: 'true' })],
  ['a marked object with indented text in index where', () => indexWhere(marked('\n    email IS NULL\n  '))],
  ['a marked object with a number as text in index where', () => indexWhere(marked(1))],
  ['.default(sql`now()`)', () => field.column(textColumn).default(sql`now()`)],
  ['.default(sql`autoincrement()`)', () => field.column(textColumn).default(sql`autoincrement()`)],
  ['unsafe SQL in .default()', () => field.column(textColumn).default(sql`1; DROP TABLE u`)],
  ['a string inside ${…}', () => untypedSql`a = ${'x'}`],
  ['NUL text (a real NUL character in the raw template)', () => sql(Object.assign(['a\u0000b'], { raw: ['a\u0000b'] }))],
];

for (const [name, run] of cases) {
  try {
    const result = run() as { storage?: unknown } | undefined;
    const where = JSON.stringify(result?.storage ?? null).match(/"where":"[^"]*"/)?.[0];
    console.log(`${name}: no error${where ? ` ${where}` : ''}`);
  } catch (error) {
    const e = error as { code?: string; message: string; meta?: unknown };
    console.log(`${name}: ${e.code} ${e.message} ${JSON.stringify(e.meta)}`);
  }
}
const ok = sql`
  ${sql`"userId" = auth.uid()`}
    AND deleted_at IS NULL
`;
console.log(`composed text: ${JSON.stringify(ok.text)}`);
```

`compile-errors.ts`:

```ts
import { textColumn } from '@prisma/orm-postgres/adapter/column-types';
import { check, field, fullTextIndex, model, policySelect, role, sql } from '@prisma/orm-postgres/contract-builder';

const U = model('U', { fields: { id: field.column(textColumn).id(), email: field.column(textColumn) } });
U.sql(({ cols, constraints }) => ({ indexes: [constraints.index([cols.email], { name: 'a', where: 'email IS NULL' })] }));
check({ expression: 'id > 0', name: 'c' });
policySelect(U, { name: 'p', roles: [role('anon')], using: 'true' });
fullTextIndex({ kind: 'columnRef', fieldName: 'email' }, { name: 'f', where: 'true' });
sql`a = ${'x'}`;
export const notSql: ReturnType<typeof sql> = { text: 'x' };
```

### Expected

- Each string in a raw-SQL field is `CONTRACT.ARGUMENT_INVALID`, naming the object and the field: ``Index "u_a" where must be a sql`...` value.``, `Index "u_e" expression`, `Check "u_c" expression`, `Policy "u_read" using`.
- An unnamed full-text index names its fields: ``Full-text index on fields "title", "email" where must be a sql`...` value.``
- A marked object with indented text builds, and the contract stores the canonical text, `"where":"email IS NULL"`. A marked object whose text is a number is `CONTRACT.ARGUMENT_INVALID`.
- `` sql`now()` `` and `` sql`autoincrement()` `` compile and are refused by `.default()` with `CONTRACT.DEFAULT_INVALID` and the rewrite; unsafe SQL is refused by `.default()`.
- A string inside `${…}` is `CONTRACT.SQL_EXPRESSION_INTERPOLATION` with its index; a NUL character is `CONTRACT.SQL_EXPRESSION_INVALID`.
- A composed value keeps the relative indentation of the template and joins the interpolated text.
- `pnpm typecheck` reports an error for each of lines 5 to 10 of `compile-errors.ts`: a string in `where`, `check`, a policy's `using`, `fullTextIndex`'s `where` and inside `${…}`, and an object with a `text` that lacks the marker. It reports nothing else.

### Run, 2026-10-08, after review round 3 fixes (`cab6bcce23`)

Every Expected bullet matches. Logs: `wip/3-qa/refusals.log`, `wip/3-qa/typecheck.log`.

`refusals.ts`:

```text
a string in index where: CONTRACT.ARGUMENT_INVALID Index "u_a" where must be a sql`...` value. {"what":"Index \"u_a\" where"}
a string in index expression: CONTRACT.ARGUMENT_INVALID Index "u_e" expression must be a sql`...` value. {"what":"Index \"u_e\" expression"}
a string in check: CONTRACT.ARGUMENT_INVALID Check "u_c" expression must be a sql`...` value. {"what":"Check \"u_c\" expression"}
a string in a policy using: CONTRACT.ARGUMENT_INVALID Policy "u_read" using must be a sql`...` value. {"what":"Policy \"u_read\" using"}
a string in an unnamed fullTextIndex where, two fields: CONTRACT.ARGUMENT_INVALID Full-text index on fields "title", "email" where must be a sql`...` value. {"what":"Full-text index on fields \"title\", \"email\" where"}
a marked object with indented text in index where: no error "where":"email IS NULL"
a marked object with a number as text in index where: CONTRACT.ARGUMENT_INVALID Index "u_a" where must be a sql`...` value. {"what":"Index \"u_a\" where"}
.default(sql`now()`): CONTRACT.DEFAULT_INVALID Write .default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL. {"reason":"reserved-function","expression":"now()"}
.default(sql`autoincrement()`): CONTRACT.DEFAULT_INVALID Write .default(autoincrement()) instead of sql`autoincrement()`; autoincrement() is a Prisma default function, not raw SQL. {"reason":"reserved-function","expression":"autoincrement()"}
unsafe SQL in .default(): CONTRACT.DEFAULT_INVALID Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries. {"reason":"unsafe-sql","expression":"1; DROP TABLE u"}
a string inside ${…}: CONTRACT.SQL_EXPRESSION_INTERPOLATION sql`...` only interpolates other sql`...` values; write any other text inside the template. {"index":0}
NUL text (a real NUL character in the raw template): CONTRACT.SQL_EXPRESSION_INVALID Tagged literals must not contain NUL characters. {"reason":"nul","offset":1}
composed text: "\"userId\" = auth.uid()\n  AND deleted_at IS NULL"
```

`pnpm typecheck`:

```text
> prisma-8-demo@8.0.0-rc.17 typecheck /Users/wmadden/Projects/prisma/orm/.claude/worktrees/sql-expression-literals-handover-da9f0f/examples/prisma-8-demo
> tsc --project tsconfig.json --noEmit

src/wip-qa-3/compile-errors.ts(5,92): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
src/wip-qa-3/compile-errors.ts(6,9): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
src/wip-qa-3/compile-errors.ts(7,53): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
src/wip-qa-3/compile-errors.ts(8,71): error TS2769: No overload matches this call.
  Overload 1 of 2, '(fields: FullTextFieldsInput<ColumnRef>, options: FullTextIndexNameOptions<"f">): IndexConstraint<readonly string[], "f">', gave the following error.
    Type 'string' is not assignable to type 'SqlExpression'.
src/wip-qa-3/compile-errors.ts(9,11): error TS2345: Argument of type 'string' is not assignable to parameter of type 'SqlExpression'.
src/wip-qa-3/compile-errors.ts(10,14): error TS2741: Property '[SQL_EXPRESSION_MARKER]' is missing in type '{ text: string; }' but required in type 'SqlExpression'.
 ELIFECYCLE  Command failed with exit code 2.
```

Wording notes from the run, kept as they are: the field after the object name is not quoted (``Index "u_a" where must be…``), the format settled in review round 1; the NUL refusal says "Tagged literals", because the TypeScript and PSL messages are shared on purpose; a marked object whose `text` is not a string gets the plain-string message, which only a hand-built object can reach.

### Run, 2026-10-01 (the earlier script)

`refusals.ts` (`wip/3/manual-qa-runtime.log`):

```text
a string in index where: CONTRACT.ARGUMENT_INVALID Index "where" must be a sql`...` value. {"what":"Index \"where\""}
a string in index expression: CONTRACT.ARGUMENT_INVALID Index "expression" must be a sql`...` value. {"what":"Index \"expression\""}
a string in check: CONTRACT.ARGUMENT_INVALID Check "expression" must be a sql`...` value. {"what":"Check \"expression\""}
a string in a policy using: CONTRACT.ARGUMENT_INVALID Policy "using" must be a sql`...` value. {"what":"Policy \"using\""}
.default(sql`now()`): CONTRACT.DEFAULT_INVALID Write .default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL. {"reason":"reserved-function","expression":"now()"}
.default(sql`autoincrement()`): CONTRACT.DEFAULT_INVALID Write .default(autoincrement()) instead of sql`autoincrement()`; autoincrement() is a Prisma default function, not raw SQL. {"reason":"reserved-function","expression":"autoincrement()"}
unsafe SQL in .default(): CONTRACT.DEFAULT_INVALID Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries. {"reason":"unsafe-sql","expression":"1; DROP TABLE u"}
a string inside ${…}: CONTRACT.SQL_EXPRESSION_INTERPOLATION sql`...` only interpolates other sql`...` values; write any other text inside the template. {"index":0}
NUL text (a real NUL character in the raw template): CONTRACT.SQL_EXPRESSION_INVALID Tagged literals must not contain NUL characters. {"reason":"nul","offset":1}
composed text: "\"userId\" = auth.uid()\n  AND deleted_at IS NULL"
```

`tsc` (`wip/3/manual-qa-typecheck.log`):

```text
wip-qa-3/compile-errors.ts(5,92): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
wip-qa-3/compile-errors.ts(6,9): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
wip-qa-3/compile-errors.ts(7,53): error TS2322: Type 'string' is not assignable to type 'SqlExpression'.
wip-qa-3/compile-errors.ts(8,71): error TS2769: No overload matches this call.
  Overload 1 of 2, '(column: ColumnRef, options: FullTextIndexNameOptions<"f">): IndexConstraint<never, "f">', gave the following error.
    Type 'string' is not assignable to type 'SqlExpression'.
wip-qa-3/compile-errors.ts(9,11): error TS2345: Argument of type 'string' is not assignable to parameter of type 'SqlExpression'.
wip-qa-3/compile-errors.ts(10,7): error TS2741: Property '[SQL_EXPRESSION_MARKER]' is missing in type '{ text: string; }' but required in type 'SqlExpression'.
wip-qa-3/compile-errors.ts(10,7): error TS6133: 'notSql' is declared but its value is never read.
```

Every case gave the expected result. The last `tsc` line only says the scratch variable is unused.
