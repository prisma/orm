---
from: "8.0.0-rc.4"
to: "8.0.0-rc.5"
changes:
  - id: wrap-pg-constructions-with-suppress-idle-connection-errors
    summary: |
      Wrap every pg `Pool` or `Client` your extension constructs with `suppressIdleConnectionErrors`, newly exported from `@internal/driver-postgres/runtime` (canonical home `@internal/utils/suppress-idle-connection-errors`). node-postgres emits 'error' on the pool or client when an idle connection drops; with no listener Node kills the host process. The helper attaches a no-op listener, is idempotent per emitter, and returns the same instance. Bindings handed to the driver (`pgPool`/`pgClient`/`url`) are wrapped by the driver itself since rc.5, so this applies to pg handles your extension uses outside a driver binding.
    detection:
      glob: "**/*.ts"
      contains:
        - "new Pool("
        - "new Client("
        - "new pg.Pool("
        - "new pg.Client("
      anyMatch: true
  - id: distinct-on-requires-postgres-capability
    summary: |
      `Collection#distinctOn(...)` now requires the contract to declare the `postgres.distinctOn`
      capability, mirroring the sql-builder lane's existing gate. A contract without it (e.g.
      SQLite-only) makes the call a compile error — the parameter type narrows to `never` — where
      it used to compile and silently produce undeduped rows at runtime, since the target's
      renderer never rendered `DISTINCT ON` for a target that cannot express it.

      Every `.distinctOn(...)` call your code makes on a `Collection` was already wrong on any
      target lacking `postgres.distinctOn`; the type error is the fix surfacing at compile time
      instead of a silently wrong result set at runtime. Move the call to a contract that
      declares `postgres.distinctOn`, or remove it — there is no runtime opt-out.
    detection:
      glob: "**/*.{ts,mts,cts}"
      regex:
        - '\.distinctOn\('
      anyMatch: true
  - id: groupby-pre-group-pagination-now-scopes-rows
    summary: |
      `take()`, `skip()`, `cursor()`, `distinct()`, `distinctOn()`, and `orderBy()` written before
      `.groupBy(...)` on a `Collection` now scope the rows that get grouped, instead of being
      silently dropped. `db.orm.<Model>.take(10).groupBy('x').aggregate(...)` used to group every
      matching row; it now groups only the first 10 (by whatever `orderBy()` is active).

      There is no reliable static pattern that separates a call site whose answer just became
      correct from one whose answer is now different from before — both look identical in source.
      Any test asserting values on a `.groupBy(...)` chain with a pre-group pagination clause
      needs re-checking against the new (correct) numbers by hand.
  - id: groupby-post-group-pagination-requires-order-by
    summary: |
      `GroupedCollection` gained its own `take()` / `skip()` / `orderBy()`, which page the grouped
      rows themselves when written *after* `.groupBy(...)`. Post-group `take()` / `skip()` require
      a prior post-group `orderBy()` — without one they are a compile error, the parameter type
      narrows to `never`, because a database may return groups in any order and "the first n
      groups" is undefined without one.

      This is not a rote find-and-replace: `db.orm.<Model>.groupBy('x').take(10)` needs a caller
      to pick what "first" means for their groups, which is a decision only they can make. Add an
      `.orderBy(...)` naming one of the fields passed to `groupBy(...)` before the `take()` /
      `skip()` call.
    detection:
      glob: "**/*.{ts,mts,cts}"
      regex:
        - '\.groupBy\('
      anyMatch: true
  - id: postgres-temporal-codec-ids-retired
    summary: |
      Five PostgreSQL temporal codec ids were removed with no compatibility aliases. Each
      native type now has two representation-explicit codecs — one whose application value is a
      `Temporal.*`, one that passes PostgreSQL's own text through unchanged:

      | Retired | Temporal replacement | Text replacement |
      | --- | --- | --- |
      | `pg/date@1` | `pg/date-temporal@1` (`Temporal.PlainDate`) | `pg/date-string@1` |
      | `pg/timestamp@1` | `pg/timestamp-temporal@1` (`Temporal.PlainDateTime`) | `pg/timestamp-string@1` |
      | `pg/timestamptz@1` | `pg/timestamptz-temporal@1` (`Temporal.Instant`) | `pg/timestamptz-string@1` |
      | `pg/time@1` | `pg/time-temporal@1` (`Temporal.PlainTime`) | `pg/time-string@1` |
      | `sql/timestamp@1` | `pg/timestamptz-temporal@1` | `pg/timestamptz-string@1` |

      An extension names these ids in more places than a user does. Sweep all of them:

      1. **Column descriptors in an extension contract.** A pack that declares its own tables
         (`extensionModel(...)` with `{ codecId, nativeType }` column literals) picks the
         representation on its consumers' behalf. Choose the Temporal id where application code
         reads the column as a value, and the `*String` id where it should stay text — the
         Supabase pack's `auth` tables took the Temporal id for exactly that reason.
      2. **`descriptor-meta` registrations, control-plane hooks and aggregate matrices.** Any
         table keyed by codec id gains two entries where it had one, or moves its single entry.
         A parity or coverage table that enumerates ids needs the four new `*-string@1` ids as
         well as the four `*-temporal@1` ones.
      3. **Hand-built contracts and test doubles.** Deserializing a contract literal that names
         a retired id now fails validation rather than resolving to something plausible.
      4. **Introspection maps.** `date`, `timestamp`, `timestamptz` and `time` map to the bare
         PSL names (`Date`, `Timestamp(p)`, `Timestamptz(p)`, `Time(p)`), which resolve to the
         Temporal codecs. The `*String` names are authoring-only and must claim no
         `targetTypes`, or they compete for introspection ownership.
      5. **Re-emit any contract your package commits.** `build:contract-space` (or
         `prisma contract emit`) rewrites `contract.json` and `contract.d.ts`; commit both.
    detection:
      glob: "**/*.{ts,mts,cts,json}"
      regex:
        - "pg/(date|timestamp|timestamptz|time)@1"
        - "sql/timestamp@1"
      anyMatch: true
  - id: temporal-codecs-require-a-global-and-refuse-a-date
    summary: |
      A Temporal-backed codec reads the application's global `Temporal` implementation. Prisma
      neither bundles nor imports a polyfill, and the check is lazy: registering a pack,
      validating a contract, resolving a descriptor and constructing a codec instance all
      succeed with no `Temporal` in scope. Only invoking one fails, with
      `RUNTIME.TEMPORAL_UNAVAILABLE`.

      Two consequences for an extension:

      1. **Your test suites need the global.** If your package exercises a Temporal-backed
         column, install a polyfill in a vitest `setupFiles` entry
         (`import 'temporal-polyfill/full/global';`) and add `temporal-polyfill` as a
         devDependency. For TypeScript to see the same global, add a `.d.ts` under your test
         directory containing `/// <reference types="temporal-polyfill/types/global" />` — the
         package's own `temporal-polyfill/global` types resolve to `export {}` and declare
         nothing.
      2. **Encode is nominally typed now.** These codecs check `Symbol.toStringTag` and refuse
         anything that is not their own Temporal type, including a `Date`, with
         `RUNTIME.ENCODE_FAILED` naming the codec. If your pack contributes a mutation-default
         generator or any other value that lands in a Temporal-backed column, it must produce
         the matching `Temporal.*` value — a `Date` no longer slips through to be serialized as
         `Date.prototype.toString()`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      regex:
        - "pg/(date|timestamp|timestamptz|time)-temporal@1"
      anyMatch: true
---

# 8.0.0-rc.4 → 8.0.0-rc.5 — Extension author upgrade instructions

## `wrap-pg-constructions-with-suppress-idle-connection-errors`

Walk every file matched by `detection.glob`. For each pg `Pool` or `Client` the extension constructs, wrap the construction:

```ts
import { suppressIdleConnectionErrors } from '@internal/driver-postgres/runtime';

const pool = suppressIdleConnectionErrors(
  new Pool({ connectionString: options.url }),
);
```

This is the same translation applied to the in-repo `@internal/postgres` and `@internal/extension-supabase` runtimes in this transition. The helper only attaches a no-op `'error'` listener (connect/query failures still reject their own promises), so behavior is otherwise unchanged; without it, a dropped idle connection crashes the process that hosts the extension.

If your extension's test suite fakes the `pg` module, the fakes need an `on` method (`on = vi.fn().mockReturnThis()` on a class fake, or `on: vi.fn()` on an object literal) — the runtime now calls `.on('error', ...)` on every pool, client, and checked-out pool client.
## `distinct-on-requires-postgres-capability`

`Collection#distinctOn(...)` used to compile and run on any target, but only Postgres ever
rendered its `DISTINCT ON` clause — a call on any other target (SQLite) compiled clean and
silently returned undeduped rows at runtime. The method now carries the same capability gate the
sql-builder lane already enforces: its parameter type narrows to `never` unless the contract
declares `postgres.distinctOn`, so the same call is a compile error on a contract that lacks it,
and a runtime error carrying `ORM.CAPABILITY_MISSING` if reached dynamically (e.g. through a
hand-built `CollectionState`).

Find every `.distinctOn(...)` call your code makes on a `Collection` and check whether the
contract it runs against declares `postgres.distinctOn`. If it does, nothing changes — the call
already worked correctly and keeps compiling. If it does not, the call was already producing the
wrong result set; either move the collection onto a Postgres-capable contract, or remove the
`.distinctOn(...)` call and accept the undeduped rows it was silently returning before.

`Collection#distinct(...)` is unaffected — it lowers to a portable `ROW_NUMBER` dedup and needs
no capability, on any target.

## `groupby-pre-group-pagination-now-scopes-rows`

Any `.take(...)`, `.skip(...)`, `.cursor(...)`, `.distinct(...)`, `.distinctOn(...)`, or
`.orderBy(...)` your extension calls *before* `.groupBy(...)` on a `Collection` used to be
silently dropped once `.groupBy(...)` joined the chain — the aggregate reduced over every
matching row, ignoring the pagination clause entirely. It now scopes the rows that get grouped,
the same way root `.aggregate()` scopes its rows (see the sibling entry for that fix, already
shipped in `8.0.0-rc.4` → `8.0.0-rc.5`'s predecessor window).

There is no detection regex for this one worth writing: the call sites that need re-checking
look identical, in source, to the call sites that already worked correctly (a chain built with
this scoping in mind, versus one that assumed the pagination clause was a no-op). Grep for
`.groupBy(` and read every match with a pre-group pagination clause; if the test asserting its
result seeds fewer distinct groups than pagination scope allows, or asserts totals computed over
every row rather than the paginated window, the expected values need updating to match the now-
correct behavior.

## `groupby-post-group-pagination-requires-order-by`

`GroupedCollection` (what `.groupBy(...)` returns) gained `take()`, `skip()`, and `orderBy()`,
which page the *grouped* rows when written after `.groupBy(...)` — previously `.groupBy(...)` had
no chain of its own past `.having(...)`. Calling post-group `take()` or `skip()` without a prior
post-group `orderBy()` is a compile error: the parameter type narrows to `never`, because a
database may return groups in any order and "the first n groups" has no defined meaning without
one.

If your extension's own code (or its test suite) calls `.groupBy(...).take(...)` or
`.groupBy(...).skip(...)` with no `.orderBy(...)` between them, it will fail to compile after this
upgrade. There is no default ordering to insert automatically — add an `.orderBy(...)` naming one
of the fields you passed to `groupBy(...)` (ascending or descending is your call; whichever
matches what "the first n groups" should mean for that query) before the `take()` / `skip()` call.

# 8.0.0-rc.4 → 8.0.0-rc.5 — Extension author upgrade instructions

## `wrap-pg-constructions-with-suppress-idle-connection-errors`

Walk every file matched by `detection.glob`. For each pg `Pool` or `Client` the extension constructs, wrap the construction:

```ts
import { suppressIdleConnectionErrors } from '@internal/driver-postgres/runtime';

const pool = suppressIdleConnectionErrors(
  new Pool({ connectionString: options.url }),
);
```

This is the same translation applied to the in-repo `@internal/postgres` and `@internal/extension-supabase` runtimes in this transition. The helper only attaches a no-op `'error'` listener (connect/query failures still reject their own promises), so behavior is otherwise unchanged; without it, a dropped idle connection crashes the process that hosts the extension.

If your extension's test suite fakes the `pg` module, the fakes need an `on` method (`on = vi.fn().mockReturnThis()` on a class fake, or `on: vi.fn()` on an object literal) — the runtime now calls `.on('error', ...)` on every pool, client, and checked-out pool client.
## `distinct-on-requires-postgres-capability`

`Collection#distinctOn(...)` used to compile and run on any target, but only Postgres ever
rendered its `DISTINCT ON` clause — a call on any other target (SQLite) compiled clean and
silently returned undeduped rows at runtime. The method now carries the same capability gate the
sql-builder lane already enforces: its parameter type narrows to `never` unless the contract
declares `postgres.distinctOn`, so the same call is a compile error on a contract that lacks it,
and a runtime error carrying `ORM.CAPABILITY_MISSING` if reached dynamically (e.g. through a
hand-built `CollectionState`).

Find every `.distinctOn(...)` call your code makes on a `Collection` and check whether the
contract it runs against declares `postgres.distinctOn`. If it does, nothing changes — the call
already worked correctly and keeps compiling. If it does not, the call was already producing the
wrong result set; either move the collection onto a Postgres-capable contract, or remove the
`.distinctOn(...)` call and accept the undeduped rows it was silently returning before.

`Collection#distinct(...)` is unaffected — it lowers to a portable `ROW_NUMBER` dedup and needs
no capability, on any target.

# PostgreSQL temporal representations, for extension authors

There is no codemod: the retired ids map to *two* replacements each, and which one an extension
should name is a judgement about what its consumers do with the column. Sweep by id, decide per
site, then re-emit any committed contract artifact.

The behavioural reference — precision, the values Temporal rejects, the driver's text boundary,
and flat/nested agreement — is in the repository's
[PostgreSQL temporal types](https://github.com/prisma/prisma/blob/main/docs/reference/postgres-temporal-types.md)
documentation.


