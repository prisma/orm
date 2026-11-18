---
changes:
  - id: sqlite-contracts-name-datetime-and-json-data-types
    summary: |
      On SQLite, a column whose codec is `sqlite/datetime@1` or `sqlite/json@1` names its own data
      type (`sqlite/datetime`, `sqlite/json`) instead of `sqlite/text`, and a datetime default or
      enum value is stored with exactly three fraction digits (`2024-01-01T00:00:00.000Z`). Run the
      colocated script on the project: it rewrites every SQLite contract and migration snapshot,
      renames the snapshot directories to the new storage hashes, and rewrites the migrations,
      refs, `migration.ts` files and `contract.d.ts` files that name them. The CLI refuses the old
      contract; the application keeps running on it, so upgrade before the next `db migrate`.
    detection:
      glob: "**/*.json"
      matches:
        - '"codecId"\s*:\s*"sqlite/(?:datetime|json)@1"\s*,\s*"dataType"\s*:\s*"sqlite/text"'
    script: ./scripts/data-type-values.ts
  - id: date-time-interval-and-bytes-defaults-use-tags
    summary: |
      A date, time, interval or bytes default is written with its type's tag instead of a quoted
      string: `@default(timestamptz`2024-01-01T00:00:00Z`)` on PostgreSQL,
      `@default(datetime`2024-01-01T00:00:00Z`)` on SQLite, and `@default(bytea`\x0102`)` for
      bytes on PostgreSQL and `@default(blob`0102`)` on SQLite. `contract emit` refuses the quoted form and names the tag to write.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@default\(\s*"(?:[+-]?\d{4,6}-\d{2}-\d{2}|\d{2}:\d{2}|-?P(?:\d|T\d))'
        - '\bBytes\??[^\n]*@default\(\s*"'
  - id: postgres-defaults-stored-in-another-spelling
    summary: |
      The CLI refuses a PostgreSQL contract that an earlier release emitted when it stores a default in
      another spelling than its column's parameters give, for example `"1.5"` on `numeric(10,2)`,
      or a date or time default written as earlier releases stored it. Run `prisma contract emit`,
      then `prisma db sign`.
  - id: prisma7-datetime-default-finer-than-column
    summary: |
      A project that reads a Prisma 7 schema: a `DateTime` default with more fraction digits than
      its column holds is now refused instead of rounded. Write the value PostgreSQL stores, which
      the message names.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@default\(\s*"\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}\.\d{4,}'
  - id: stored-values-a-column-type-does-not-hold
    summary: |
      Reading a value its column's type does not hold now throws `RUNTIME.DECODE_FAILED`, in a plain
      read and in an include alike: text or bytes in a SQLite INTEGER or REAL column, text or a
      number in a SQLite BLOB column, and a multi-dimensional array in a PostgreSQL `text[]` column
      read with `pg/text-array@1`.
  - id: sqlite-datetime-without-offset-read-as-utc
    summary: |
      A SQLite `DateTime` row holding date and time text without a UTC offset, such as
      `2024-01-01 12:00:00`, is now read as UTC, as SQLite's own date and time functions read it,
      instead of in the time zone of the machine running the query. Prisma never writes such text;
      another tool may.
  - id: text-array-min-max-return-arrays
    summary: |
      `min` and `max` of a `pg/text-array@1` column return an array of strings, as a row of the
      column does, instead of the array's text (`{a,b}`).
  - id: sign-databases-after-data-type-values
    summary: |
      The upgrade changes the storage hash of every SQLite contract with a datetime or JSON column,
      and of every PostgreSQL contract you emit again. Run `prisma db sign` against every database
      before deploying the application built with the new contract.
---

## `sqlite-contracts-name-datetime-and-json-data-types`

A SQLite contract stores the data type of each column. This release gives datetime and JSON values their own data types, and stores a datetime as `toISOString()` writes it, with exactly three fraction digits. A contract emitted by the previous release still names `sqlite/text`, so the CLI of this release refuses it: every command that reads the contract (`migration plan`, `db migrate`, `db verify` and others) fails with `CONTRACT.VALIDATION_FAILED`:

```text
storage.namespaces.__unbound__.entries.table.events.columns.at: codec sqlite/datetime@1 represents sqlite/datetime, not sqlite/text
```

The application does not refuse it: built with this release, it keeps running on the old contract until you upgrade. So do the upgrade below before the next `db migrate`, or any other CLI command, against the project.

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <path-to-this-guide>/scripts/data-type-values.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQLite contract in the previous release's form, skipping `node_modules`, `.git`, `dist` and `build`, and follows links to files and directories, also outside the root; commit or back up the files there too. That includes a test fixture of a contract in the previous release's form: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root. In each contract it changes:

- the `dataType` of each column and named type whose codec is `sqlite/datetime@1` or `sqlite/json@1`, from `sqlite/text` to `sqlite/datetime` or `sqlite/json`;
- each literal default of a `sqlite/datetime@1` column, and each value of an enum typed by `sqlite/datetime@1`, to three fraction digits: `"2024-01-01T00:00:00Z"` becomes `"2024-01-01T00:00:00.000Z"`, and `"2024-01-01T00:00:00.5Z"` becomes `"2024-01-01T00:00:00.500Z"`. A JSON default keeps its value.

It then writes the storage hash each contract now has, renames the contract's snapshot directory under `migrations/snapshots/` to that hash, and replaces the old hash in every `migration.json` (recomputing its `migrationHash`), every ref under `refs/`, every `migration.ts` and every `contract.d.ts`. The planned SQL does not change: SQLite stores the same text in the column default.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project already in the new form is left unchanged, and the script says so. If it finds no SQLite contract under the root, it says so; run it again from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for a contract whose stored hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a `contract.json`, `migration.json` or ref is not valid JSON, or when a renamed snapshot directory already exists with different content.

If the script stops on an error partway, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. Run it again: it finishes the upgrade and removes its own temporary files (ending in `.data-type-values-tmp`).

Run your formatter afterwards. The script writes each `contract.json` as `contract emit` does and replaces text in `contract.d.ts` without reformatting it, so a file your formatter keeps in another layout, or the line wrapping of `contract.d.ts`, can differ from what your formatter produces.

## `date-time-interval-and-bytes-defaults-use-tags`

A default of a date, time, interval or bytes column is written with the tag of the column's type, as a JSON default already is. `contract emit` refuses a quoted string and shows the tag to write:

```text
Field "Event.at": Expected timestamptz`...`; write timestamptz`2024-01-01T00:00:00Z`
```

```prisma
// before
model Event {
  id      Int       @id
  at      DateTime  @default("2024-01-01T00:00:00Z")
  local   Timestamp @default("2024-01-01 12:34:56.500")
  day     Date      @default("2024-03-15")
  clock   Time      @default("12:34")
  zoned   Timetz    @default("12:34:56+02")
  span    Interval  @default("P1D")
  payload Bytes     @default("AQID")
}

// after
model Event {
  id      Int       @id
  at      DateTime  @default(timestamptz`2024-01-01T00:00:00Z`)
  local   Timestamp @default(timestamp`2024-01-01 12:34:56.500`)
  day     Date      @default(date`2024-03-15`)
  clock   Time      @default(time`12:34`)
  zoned   Timetz    @default(timetz`12:34:56+02`)
  span    Interval  @default(interval`P1D`)
  payload Bytes     @default(bytea`\x010203`)
}
```

The tag is named after the column's PostgreSQL type: `timestamptz` for `DateTime`, `timestamp`, `date`, `time`, `timetz` and `interval` for the types of those names, and `bytea` for `Bytes`. A date or time tag takes the text you wrote. A `bytea` tag takes the bytes as hexadecimal after `\x`, not base64: `"AQID"` is the bytes 01 02 03, so write `bytea`\x010203``. For bytes, the message depends on what you quoted. A quoted hex string gets the full rewrite (`Expected bytea`...`; write bytea`\x010203``). A quoted base64 string gets a message naming only the tag (`Expected bytea`...``), because `contract emit` cannot tell base64 from hex text; convert the bytes to hex yourself.

On SQLite, a `DateTime` default uses the `datetime` tag, and a `Bytes` default the `blob` tag, whose body is the hex digits the quoted string held before. A quoted string on a SQLite `Bytes` column was read as hex; it is now refused, naming the `blob` tag:

```prisma
// before
createdAt DateTime @default("2024-01-01T00:00:00Z")
payload   Bytes    @default("68656c6c6f")

// after
createdAt DateTime @default(datetime`2024-01-01T00:00:00Z`)
payload   Bytes    @default(blob`68656c6c6f`)
```

The stored value is the same as before, so emitting the schema after the rewrite gives the contract the script above writes.

## `postgres-defaults-stored-in-another-spelling`

A stored default is now a value of its column's type, written in the one spelling the type and its parameters give. A PostgreSQL contract that an earlier release emitted can store a default in another spelling. The CLI of this release refuses such a contract: every command that reads it (`migration plan`, `db init`, `db verify`, `migration check` and others) fails with `CONTRACT.VALIDATION_FAILED`. The application does not refuse it, and keeps running on it until you emit the contract again; do that before the next `db migrate`. The CLI's message names the column, the stored value and the spelling the type expects:

```text
Namespace "public", table "product", column "price": the default "1.5" is not a value of pg/numeric: pg/numeric JSON value must be "1.50", the spelling its parameters give this value
```

The cases are:

- a number default spelled without its scale, such as `"1.5"` on `numeric(10,2)`, which is now `"1.50"`;
- a `char` default padded with spaces, which is now stored without them;
- a time default with more fraction digits than its column's precision;
- a date or time default in a spelling earlier releases stored: an instant with `.000Z` (`"2024-01-01T00:00:00.000Z"` is now `"2024-01-01T00:00:00Z"`), an offset such as `+01:00` on a `timestamptz` (now converted to `Z`), a time without seconds (`"12:34"` is now `"12:34:00"`), or a space instead of `T` between date and time.

Then run `prisma contract emit`, which writes the default in the new spelling, then `prisma db sign` (`sign-databases-after-data-type-values`). Two kinds of default in the schema need rewriting first, or `contract emit` refuses them:

- a quoted date, time, interval or bytes default, which is written with its tag (`date-time-interval-and-bytes-defaults-use-tags`);
- a default with more fraction digits or more scale than its column holds, on a `time`, `timestamp`, `timestamptz`, `interval` or `numeric` column. Earlier releases let PostgreSQL round it; write the rounded value instead. For example, `Timestamptz(3) @default(timestamptz`2024-01-01T00:00:00.1234Z`)` is refused with:

  ```text
  Field "Event.at": pg/timestamptz JSON value must be a value with at most 3 fraction digits of a second, which precision 3 holds without rounding
  ```

  Write `timestamptz`2024-01-01T00:00:00.123Z``. A `Numeric(10, 2)` default of `1.234` is refused the same way (`pg/numeric JSON value must be a decimal string that numeric(10, 2) stores without rounding`); write `1.23`.

## `prisma7-datetime-default-finer-than-column`

This applies to a project whose contract source is a Prisma 7 schema. Prisma 7 let PostgreSQL round a `DateTime` default with more fraction digits than its column holds. This release refuses it, so the contract stores the value the database holds. A plain `DateTime` is `timestamp(3)`, which holds three fraction digits:

```text
Field "Event.at": @default holds "2024-01-02T03:04:05.1234Z", with 4 digits after the decimal point, but the column holds 3. PostgreSQL stores it as "2024-01-02T03:04:05.123Z"; write that instead.
```

Write the value the message names:

```prisma
// before
at DateTime @default("2024-01-02T03:04:05.1234Z")

// after
at DateTime @default("2024-01-02T03:04:05.123Z")
```

Then run `prisma contract emit` and `prisma db sign`.

## `stored-values-a-column-type-does-not-hold`

A codec now reads each value a query returns with one method, `fromWire`, in a plain read and in an include alike, and refuses a value its column's type does not hold. A query that returned such a value before now throws `RUNTIME.DECODE_FAILED`:

| Column | Value | Message |
| --- | --- | --- |
| SQLite `INTEGER` (`sqlite/integer@1`, `sql/int@1`) | text that is not a number, or bytes | `sqlite/integer@1 wire value must be an integer or its decimal text` |
| SQLite `REAL` (`sqlite/real@1`, `sql/float@1`) | text other than `Infinity` and `-Infinity`, or bytes | `sqlite/real@1 wire value must be a number, or the text Infinity or -Infinity` |
| SQLite `BLOB` (`sqlite/blob@1`) | text or a number | `sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries` |
| PostgreSQL `text[]` (`pg/text-array@1`) | an array of two or more dimensions | `pg/text-array@1 reads a one-dimensional text[], and {{a},{b}} has more dimensions` |

SQLite stores any value in any column of a table that is not `STRICT`, so these values come from writes outside the application. Find them, for example with `SELECT id FROM t WHERE typeof(col) NOT IN ('integer', 'null')`, and correct them, or read the column with a codec of the type it holds.

## `sqlite-datetime-without-offset-read-as-utc`

A SQLite `DateTime` column (`sqlite/datetime@1`) can hold date and time text without a UTC offset, such as `2024-01-01 12:00:00` or `2024-01-01`, when another tool wrote it: `CURRENT_TIMESTAMP` in SQL, or a client library that writes local text. Prisma writes `toISOString()` text, which ends in `Z`, so a row Prisma wrote reads as before.

Such a row is now read as UTC, as SQLite's `datetime()` and `strftime()` read it. Before, it was read in the time zone of the machine running the query, so the same row gave a different `Date` on a server in UTC and on one in another zone. A date alone is read as its midnight in UTC. Every value that was read before is still read; only the instant of text without an offset changes, and it changes only on a machine not set to UTC.

If such text was written meaning local time, rewrite it with its offset, or as UTC. To find these rows:

```sql
SELECT id, created_at FROM "Event"
WHERE typeof(created_at) = 'text'
  AND created_at NOT LIKE '%Z'
  AND created_at NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]';
```

## `text-array-min-max-return-arrays`

`min` and `max` of a column whose codec is `pg/text-array@1` return what a row of the column returns, an array of strings, where they returned the text PostgreSQL prints for the array: `['c']` instead of `'{c}'`. Code that parsed that text reads the array directly.

## `sign-databases-after-data-type-values`

The upgrade gives every SQLite contract with a datetime or JSON column a new storage hash, and so does `prisma contract emit` for a PostgreSQL contract it rewrites. Each database's marker still holds the old hash, so until you sign it `prisma db migrate` refuses to run with `MIGRATION.MARKER_MISMATCH` and `prisma db verify` exits with code 4 and `CONTRACT.MARKER_MISMATCH`. Run `prisma db sign` against every database (development, staging, production) before you deploy the application built with the new contract:

```sh
prisma contract emit
prisma db sign --db "$DATABASE_URL"
```
