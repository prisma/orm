# Slice 3 manual QA

Run on 2026-10-16 against branch `s3-data-type-values` at `3bec4ae6fa`, with the CLI built from the branch (`node_modules/@internal/cli/dist/bin.mjs`, called `prisma` below). The release before the slice is `94fc045c62`, checked out as a worktree under `wip/s3/qa/base`, installed and built, and removed afterwards. Postgres ran in a local `postgres:17-alpine` container (`s3-qa-pg`, removed afterwards). Node 24.16.0. Projects and full command logs are under `wip/s3/qa/` (gitignored); CLI output is the JSON envelope, quoted here in part.

## 1. SQLite project upgraded from the release before the slice

Verdict: pass, with two findings about messages (below).

Schema, emitted, planned and applied with the base CLI:

```prisma
model Event {
  id      Int      @id
  name    String
  at      DateTime @default("2024-01-01T00:00:00Z")
  payload Json     @default(json`{"b":1,"a":[true,null]}`)
  blob    Bytes
}
```

The base release could not hold a `Bytes` default on SQLite. `"68656c6c6f"` fails `contract emit` with `sqlite/blob@1 JSON value must be uppercase hexadecimal text`. `"68656C6C6F"` emits and plans `DEFAULT X'68656c6c6f'`, but `db migrate` then fails its own schema check (`MIGRATION.SCHEMA_VERIFY_FAILED`, expected `'68656C6C6F'`, actual `X'68656c6c6f'`). So the base project has no `Bytes` default; the branch's `blob` tag is tested after the upgrade instead.

| Step | Command | Exit | Result |
| --- | --- | --- | --- |
| base | `contract emit`, `migration plan --name init`, `db migrate`, `db verify` | 0, 0, 0, 0 | contract stores `dataType: "sqlite/text"` and `"2024-01-01T00:00:00Z"` |
| base | raw `INSERT INTO "Event" (id, name, blob) VALUES (1, 'raw', X'010203')`; ORM `Event.create` id 2 with the same values written | 0 | both rows read back `at` 2024-01-01T00:00:00.000Z, same `payload` |
| refusal | `db verify` | 2 | `CONTRACT.VALIDATION_FAILED`: `...columns.at: codec sqlite/datetime@1 represents sqlite/datetime, not sqlite/text; ...columns.payload: codec sqlite/json@1 represents sqlite/json, not sqlite/text`. Next action offered: `prisma contract emit` |
| refusal | `db migrate` | 2 | same `CONTRACT.VALIDATION_FAILED`, "failed to deserialize" |
| refusal | `migration status` | 0 | "Up to date"; it does not read the emitted contract |
| script | `node upgrade-instructions/pending/data-type-values/app/scripts/data-type-values.ts` | 0 | `Rewrote 4 files and renamed 1 snapshot directory. Storage hashes changed (old -> new): 7344a726… -> 2fbb7387…`. Diff: `dataType` to `sqlite/datetime` and `sqlite/json`, default to `2024-01-01T00:00:00.000Z`, hash replaced in `migration.json`, `migration.ts`, both `contract.d.ts` and the snapshot directory name |
| script again | same | 0 | `The project is already in the new form; nothing changed.` |
| schema | `contract emit` with the quoted default | 2 | `PSL_VALUE_TYPE_INCOMPATIBLE: Field "Event.at": Expected datetime`...`; write datetime`2024-01-01T00:00:00Z`` |
| schema | rewrite to `@default(datetime`2024-01-01T00:00:00Z`)`, `contract emit` | 0 | hash `2fbb7387…`; `contract.json` and `contract.d.ts` byte-identical to the script's output |
| before sign | `db verify` | 4 | `CONTRACT.MARKER_MISMATCH`, as the text says |
| before sign | `db migrate` | 2 | `MIGRATION.MARKER_MISMATCH`, as the text says |
| sign | `db sign` | 0 | "Database signed" |
| after | `db verify`, `migration status`, `db migrate` | 0, 0, 0 | "match contract"; "Up to date"; "Already up to date", 0 applied |
| rows | raw insert id 10 without `at` and `payload`; ORM create id 11 with `at: new Date('2024-01-01T00:00:00Z')`, `payload: {b:1,a:[true,null]}` | 0 | both read back `Date(2024-01-01T00:00:00.000Z)` and the same JSON value; stored `at` text identical (`2024-01-01T00:00:00.000Z`) |

`Bytes` default on SQLite after the upgrade: `@default("68656c6c6f")` is refused with `Expected blob`...`; write blob`68656c6c6f``. With `@default(blob`68656c6c6f`)`: `contract emit` 0, `migration plan` 0 (`ALTER TABLE "Event" ADD COLUMN "blob2" BLOB DEFAULT X'68656c6c6f' NOT NULL`), `db migrate` 0, `db verify` 0, `migration status` 0. A raw row without `blob2` and an ORM row with the bytes written both read back `68656c6c6f`, stored as `blob`.

Findings:

- The application runtime does not refuse the old contract. With the branch's `@prisma/orm-sqlite` and the base-emitted `contract.json`, `sqlite({ contractJson })`, `Event.create` and `Event.all()` worked and wrote a row. The upgrade text says "this release refuses to load it" and quotes the message; only the CLI does. Reproduce: in `wip/s3/qa/lite` at its commit "pre-upgrade", `node app.ts create 3`.
- The CLI refusal's next action is "Re-emit the contract: `prisma contract emit`". That does not upgrade the migration snapshots, and with a quoted default in the schema it fails. The message does not point at the upgrade script.

## 2. Postgres date and time defaults

Verdict: pass, with one finding about the human output.

```prisma
model Event {
  id       Int             @id
  day      Date            @default(date`2024-03-15`)
  bcDay    Date            @default(date`-000043-03-15`)
  farDay   Date            @default(date`+012026-01-02`)
  infDay   DateString      @default(date`infinity`)
  clock    Time            @default(time`12:34`)
  zoned    Timetz          @default(timetz`12:34:56+02`)
  local    Timestamp       @default(timestamp`2024-01-01 12:34:56.500`)
  negLocal TimestampString @default(timestamp`-infinity`)
  zonedTs  Timestamptz(3)  @default(timestamptz`2024-01-01T01:00:00.123+01:00`)
  at       DateTime        @default(timestamptz`2024-01-01T00:00:00Z`)
  span     Interval        @default(interval`P14MT90M`)
  payload  Bytes           @default(bytea`\x010203`)
  doc      Jsonb           @default(json`{"b":1,"a":[true,null]}`)
  price    Numeric(10, 2)  @default(1.5)
  days     Date[]          @default([date`2024-01-01`, date`2024-12-31`])
  blobs    Bytes[]         @default([bytea`\x01`, bytea`\xff00`])
}
```

`infinity` on `Date` and `-infinity` on `Timestamp` are refused first, with a clear message: `pg/date-temporal@1 JSON value must be a date a Temporal.PlainDate holds, not infinity or -infinity, which pg/date-string@1 holds`. The schema above uses the string types for them.

| Step | Exit | Result |
| --- | --- | --- |
| `contract emit` | 0 | stored: `-000043-03-15`, `+012026-01-02`, `infinity`, `12:34:00`, `12:34:56+02:00`, `2024-01-01T12:34:56.5`, `-infinity`, `2024-01-01T00:00:00.123Z`, `2024-01-01T00:00:00Z`, `P1Y2MT1H30M`, `AQID`, `1.50`, lists `["2024-01-01","2024-12-31"]` and `["AQ==","/wA="]` |
| `migration plan --name init` | 0 | `'0044-03-15 BC'::date`, `'12026-01-02'::date`, `'infinity'::date`, `'-infinity'::timestamp`, `'\x010203'::bytea`, `ARRAY['\x01', '\xff00']::bytea[]`, `'1.50'::numeric(10,2)` |
| `db migrate` | 0 | 1 migration applied |
| `db verify` | 0 | "Database schema satisfies contract", no warnings |
| raw insert of a row with every default, read through the ORM (`node --harmony-temporal`) | 0 | `PlainDate(-000043-03-15)`, `PlainDate(+012026-01-02)`, `infinity`, `-infinity`, `Instant(2024-01-01T00:00:00.123Z)`, interval `{months:14, days:0, micros:5400000000n}`, bytes `010203`, `1.50` |
| `contract infer --output` into a second project, then `contract emit` there | 0, 0 | every default comes back as the same tag and value (`date`-000043-03-15``, `date`infinity``, `interval`P1Y2MT1H30M``, `bytea`\x010203``, …); the two contracts store identical data types and defaults |
| `contract print --format human` | 0 | prints every default with its tag, as written in the source |
| `ALTER TABLE "Event" ALTER COLUMN "bcDay" SET DEFAULT '0045-03-15 BC'::date`, then `db verify` | 4 | `CONTRACT.SCHEMA_VERIFICATION_FAILED`, one issue: `database/public/Event/column:bcDay/default`, expected `-000043-03-15`, actual `-000044-03-15` (raw `'0045-03-15 BC'::date`). Restored, `db verify` 0 |
| quoted defaults `@default("2024-03-15")`, `@default("P1D")`, `@default("AQID")` | 2 | `Expected date`...`; write date`2024-03-15``, `Expected interval`...`; write interval`P1D``, `Expected bytea`...`` (base64, tag only, as the text says) |

Findings:

- The human `db verify` output names only `mismatch: database/public/Event/column:bcDay/default`. The expected and actual values are in the JSON output only, so a user reading the terminal does not see what differs.
- Observation, not a defect: `contract infer` chooses the string types (`TimestamptzString`, `DateString`, `TimeString`, `TimestampString`) where the source used `DateTime`, `Date`, `Time` and `Timestamp`.

## 3. Prisma 7 side by side with date defaults

Verdict: pass. The Prisma 7 CLI is installed (`examples/prisma7-adoption/node_modules/.bin/prisma7`, 7.10.0), so the flow ran directly.

Prisma 7 schema defaults: `DateTime @default("2024-03-15T00:00:00Z") @db.Date` (Prisma 7 refuses `"2024-03-15"`), `@default("2024-01-01T12:34:56.789Z") @db.Timestamp(3)`, `@default("2024-01-01T01:00:00+01:00") @db.Timestamptz`, a plain `DateTime @default("2024-06-01T00:00:00.5Z")`, `@default(now())`, and `Bytes @default("AQID")`.

| Step | Exit | Result |
| --- | --- | --- |
| `prisma7 migrate dev --name init --config prisma7.config.ts` | 0 | `DEFAULT '2024-03-15 00:00:00 +00:00'` on `DATE`, `'2024-01-01 12:34:56.789 +00:00'` on `TIMESTAMP(3)`, `'2024-01-01 01:00:00 +01:00'` on `TIMESTAMPTZ`, `'\x010203'` on `BYTEA` |
| `prisma contract emit` | 0 | `2024-03-15`, `2024-01-01T12:34:56.789`, `2024-01-01T00:00:00Z`, `2024-06-01T00:00:00.5`, `AQID` |
| `prisma db sign` | 0 | "Database signed" |
| `prisma db verify`, `prisma db verify --strict` | 0, 0 | zero issues |
| plain `DateTime` default `"2024-01-02T03:04:05.1234Z"`, `contract emit` | 2 | `Field "Event.plain": @default holds "2024-01-02T03:04:05.1234Z", with 4 digits after the decimal point, but the column holds 3. PostgreSQL stores it as "2024-01-02T03:04:05.123Z"; write that instead.` Matches the upgrade text. |

## 4. A `DateTime` row an earlier Prisma wrote on SQLite

Not run. No Prisma 7 SQLite driver adapter (`@prisma/adapter-better-sqlite3`, `@prisma/adapter-libsql` or similar) is installed in the repository's `node_modules`, and none was installed.
