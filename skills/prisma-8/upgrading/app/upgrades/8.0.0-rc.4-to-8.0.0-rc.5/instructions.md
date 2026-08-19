---
from: "8.0.0-rc.4"
to: "8.0.0-rc.5"
changes:
  - id: attach-pg-client-error-listener
    summary: |
      Attach an 'error' listener to any pg `Client` or `Pool` your own code constructs outside the Prisma runtime. node-postgres emits 'error' on the pool or client when an idle connection drops (database restart, pooler timeout, network blip); with no listener Node treats it as an uncaught exception and kills the process. Starting at rc.5 every pool and client the Prisma runtime creates or receives — including a pool you pass via the `pg:` binding — gets a listener automatically, so this only applies to pg handles your code uses directly (health checks, side-channel observers, hand-rolled scripts).
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "new Client("
        - "new pg.Client("
        - "new Pool("
        - "new pg.Pool("
      anyMatch: true
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.5. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain. The restamp is independent of the other changes in this
      release.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.4"'
  - id: postgres-temporal-representations
    summary: |
      PostgreSQL temporal columns no longer read as JavaScript `Date`. Each of `date`,
      `timestamp(p)`, `timestamptz(p)` and `time(p)` now offers two explicit representations,
      and five codecs were removed with no compatibility aliases:

      | Retired | Replace with (Temporal) | Replace with (text) |
      | --- | --- | --- |
      | `pg/date@1` | `Date` → `pg/date-temporal@1` (`Temporal.PlainDate`) | `DateString` |
      | `pg/timestamp@1` | `Timestamp(p)` → `pg/timestamp-temporal@1` (`Temporal.PlainDateTime`) | `TimestampString(p)` |
      | `pg/timestamptz@1` | `Timestamptz(p)` → `pg/timestamptz-temporal@1` (`Temporal.Instant`) | `TimestamptzString(p)` |
      | `pg/time@1` | `Time(p)` → `pg/time-temporal@1` (`Temporal.PlainTime`) | `TimeString(p)` |
      | `sql/timestamp@1` (`field.timestamp()`) | `Timestamptz(p)` or `field.temporal.timestamptz(p)` | `TimestamptzString(p)` |

      1. **Decide a representation per column.** The bare PSL spellings (`Date`, `Timestamp`,
         `Timestamptz`, `Time`) keep working and now select the Temporal-backed codec. If a
         column's values should stay text — because your code treats them as strings, or
         because they include values Temporal cannot denote (`infinity`, non-ISO `DateStyle`
         output, years beyond ±271821) — rename the type to its `*String` spelling. Note
         `pg/time@1` already handed back a `string`: a `time` column whose value you treat as
         text needs `TimeString(p)`, not `Time(p)`.
      2. **Replace `field.timestamp()`.** The generic cross-target helper and its
         `sql/timestamp@1` codec are gone. On PostgreSQL use `field.temporal.timestamptz(p)`
         (or `field.temporal.timestamptzString(p)`), or the bare `Timestamptz(p)` type.
      3. **Repoint any codec id you wrote by hand.** Ids appear in raw-lane return
         declarations (``db.raw.sql`now()`.returns('pg/timestamptz@1')``), in
         `prepare({ id })`, and in hand-built contracts. A retired id no longer resolves and
         fails contract validation rather than degrading silently.
      4. **Re-emit every contract.** `prisma contract emit` rewrites `contract.json` and
         `contract.d.ts` together; the generated application types are where the new
         representation becomes visible. Commit the regenerated artifacts. A contract emitted
         before this release references a codec the registry cannot resolve and is rejected at
         runtime.
      5. **Provide a Temporal implementation if you kept any Temporal-backed column.** Prisma
         bundles no polyfill. Where the runtime has no native `Temporal`, install a global one
         in your entry point before any query runs — `import 'temporal-polyfill/full/global';`.
         Take `full/global`, not `global`: the default build omits non-ISO calendars and its
         published types resolve to `export {}`, so TypeScript will not see the namespace.
         **Every read** of a Temporal-backed column needs it, and so does any insert into a
         table carrying `temporal.updatedAt()`, whose generated value is a `Temporal.Instant`.
         Without it the operation fails with `RUNTIME.TEMPORAL_UNAVAILABLE`, which names the
         codec and recommends the matching `*String` type. A contract whose temporal columns
         are all `*String` needs no Temporal anywhere.
      6. **Update application code that consumed a `Date`.** `Temporal.Instant.from()` parses
         **only an ISO string carrying an offset** — it throws on a `Date`, on an
         epoch-millisecond number, and on a date-time string with no offset. Convert by source:

         | You have | Use |
         | --- | --- |
         | a `Date` | `instant = date.toTemporalInstant()`, or `Temporal.Instant.fromEpochMilliseconds(date.getTime())` |
         | epoch milliseconds | `Temporal.Instant.fromEpochMilliseconds(ms)` |
         | an ISO string **with** an offset (`…Z`, `…+02:00`) | `Temporal.Instant.from(text)` |
         | an ISO string **without** an offset | pick the zone it meant: `Temporal.PlainDateTime.from(text).toZonedDateTime('UTC').toInstant()` |
         | "now" | `Temporal.Now.instant()` |

         Match the column, not just the type name: a `date` column takes a
         `Temporal.PlainDate` (`Temporal.PlainDate.from('2024-01-01')`), a `timestamp` column a
         `Temporal.PlainDateTime`, a `time` column a `Temporal.PlainTime`. Only `timestamptz`
         takes an `Instant`.

         `Temporal.Instant.compare(a, b)` replaces `a.getTime() - b.getTime()`, but **both
         operands must already be `Instant`s** — it throws on a `Date`. Values read back from
         the ORM already are; convert anything you brought from elsewhere first.

         In tests, compare temporal values through `toString()` or the type's own `equals` /
         `compare`: a Temporal value has no own enumerable properties, so `toEqual` /
         `toMatchObject` against one passes for *any* value of the same type.
    detection:
      glob: "**/*.{ts,mts,cts,prisma,json}"
      regex:
        - "pg/(date|timestamp|timestamptz|time)@1"
        - "sql/timestamp@1"
        - "field\\.timestamp\\("
      anyMatch: true
  - id: literal-default-needs-the-string-spelling
    summary: |
      A literal `@default(...)` on a Temporal-backed temporal column cannot be emitted today.
      The default value is encoded through the column's codec while the contract is being
      emitted, inside the CLI's own process, and stock Node ships no `Temporal`. So

      ```prisma
      occurredAt Timestamptz @default("2024-01-01T00:00:00Z")
      ```

      fails `prisma contract emit` with `CONTRACT.SOURCE_LOAD_FAILED` and "this runtime has no
      global Temporal implementation".

      Use the string spelling for a column that needs a literal default:

      ```prisma
      occurredAt TimestamptzString @default("2024-01-01T00:00:00Z")
      ```

      Function defaults are unaffected — `@default(now())` lowers to a PostgreSQL `now()`
      storage default, never passes through a codec, and works on either representation.
    detection:
      glob: "**/*.prisma"
      regex:
        - "(Date|Timestamp|Timestamptz|Time)(\\([0-9]+\\))?\\s+@default\\(\""
      anyMatch: true
---

# 8.0.0-rc.4 → 8.0.0-rc.5 — User upgrade instructions

## `attach-pg-client-error-listener`

Walk every file matched by `detection.glob`. For each `pg.Client` or `pg.Pool` your code constructs and uses directly (not one handed to `postgres({ pg: ... })` / `supabase({ pg: ... })` — the runtime covers those since rc.5), attach an `'error'` listener right after construction, before `connect()`:

```ts
const client = new pg.Client({ connectionString });
client.on('error', () => {});
await client.connect();
```

A no-op listener is enough: connect and query failures still reject their own promises, so nothing real is masked — the listener only stops a dropped idle connection from becoming an uncaught exception. If the handle is long-lived and you have a logging channel, log the error instead of discarding it.

Note that a surrounding `try/catch` does **not** cover this case — the `'error'` event is emitted on the client object asynchronously, outside any promise chain the `catch` can see.

# 8.0.0-rc.4 → 8.0.0-rc.5 — User upgrade instructions

## `attach-pg-client-error-listener`

Walk every file matched by `detection.glob`. For each `pg.Client` or `pg.Pool` your code constructs and uses directly (not one handed to `postgres({ pg: ... })` / `supabase({ pg: ... })` — the runtime covers those since rc.5), attach an `'error'` listener right after construction, before `connect()`:

```ts
const client = new pg.Client({ connectionString });
client.on('error', () => {});
await client.connect();
```

A no-op listener is enough: connect and query failures still reject their own promises, so nothing real is masked — the listener only stops a dropped idle connection from becoming an uncaught exception. If the handle is long-lived and you have a logging channel, log the error instead of discarding it.

Note that a surrounding `try/catch` does **not** cover this case — the `'error'` event is emitted on the client object asynchronously, outside any promise chain the `catch` can see.

# PostgreSQL temporal representations

Both entries are schema-and-code renames; there is no codemod, because the choice between the
Temporal and the string representation is per column and only you know which values a column
holds. Work through the schema first, re-emit, then let the generated `contract.d.ts` types drive
the application-code changes — the compiler will point at every site whose value type moved.

The full reference, including precision behaviour, the values Temporal rejects and why, and the
driver's text boundary, is in the repository's [PostgreSQL temporal types](https://github.com/prisma/prisma/blob/main/docs/reference/postgres-temporal-types.md)
documentation.


