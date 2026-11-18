---
from: "8.0.0-rc.5"
to: "8.0.0-rc.6"
changes:
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

         In tests, be careful with **`toMatchObject`**. A Temporal value has no own enumerable
         properties — every accessor lives on the prototype — so a subset matcher finds nothing
         to compare and passes for *any* value of the same type. `toEqual` is not affected
         (Vitest compares these correctly), but `toMatchObject` will silently stop checking the
         timestamp. Where you need a subset match, compare `toString()` or use the type's own
         `equals` / `compare`.
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
  - id: orm-init-no-longer-installs-agent-skills
    summary: |
      `prisma orm init` no longer installs agent skills: the GitHub fetch (`npx skills add`)
      is removed and nothing inside `orm init` replaces it. Agent-skills setup belongs to the
      family-level `prisma init` command. The `--skip-skills` flag is removed with the
      behavior it opted out of. Existing projects keep whatever skills they already have;
      only scripts that invoke `orm init` and expect it to deliver skills (or pass
      `--skip-skills`) need to change.
    detection:
      glob: "**/*.{sh,yml,yaml,json,md}"
      regex:
        - '\borm\s+init\b'
      anyMatch: true
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.6. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain. The restamp is independent of the other changes in this
      release.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.5"'
---

# 8.0.0-rc.5 → 8.0.0-rc.6 — User upgrade instructions

# PostgreSQL temporal representations

Both entries are schema-and-code renames; there is no codemod, because the choice between the
Temporal and the string representation is per column and only you know which values a column
holds. Work through the schema first, re-emit, then let the generated `contract.d.ts` types drive
the application-code changes — the compiler will point at every site whose value type moved.

Two behaviours are worth knowing before you choose. A Temporal codec rejects what `Temporal` cannot
denote — `infinity`, years beyond roughly ±271821, and output rendered under a non-ISO `DateStyle` —
naming the `*String` type that reads the same column losslessly. And a nested read returns the same
text a flat read does, because temporal expressions are cast to `text` before PostgreSQL builds the
JSON, which means both reflect the session `TimeZone`.

## `orm-init-no-longer-installs-agent-skills`

Nothing to change in an existing project: skills already on disk stay as they are. Walk every `orm init` invocation the detection finds (a mention in prose that is not a command needs no action):

- An invocation passing `--skip-skills`: drop the flag — it no longer exists and the invocation fails with an unknown-flag error. The behavior it opted out of is gone, so the flagless invocation is the equivalent.
- A plain invocation with no flag: the scaffold itself is unchanged, but it no longer installs agent skills. If the script (or the person following it) relied on that, run `prisma init` in the project afterwards; that command owns skills setup now. If skills were incidental, no change is needed.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. The only expected diff is the embedded `version` moving to `8.0.0-rc.6`.
