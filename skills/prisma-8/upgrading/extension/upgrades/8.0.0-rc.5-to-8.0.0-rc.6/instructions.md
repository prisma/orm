---
from: "8.0.0-rc.5"
to: "8.0.0-rc.6"
changes:
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
  - id: contract-space-restamp
    summary: |
      The emitted contract artifacts embed the toolchain version, which moves to 8.0.0-rc.6.
      Rebuild the extension's contract space (the package's `build:contract-space` script)
      once after upgrading so the emitted artifacts match the installed toolchain. The
      toolchain also re-released against `@prisma/cli-engine@0.2.2` (a CLI-side fix with no
      extension-facing surface).
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.5"'
---

# 8.0.0-rc.5 → 8.0.0-rc.6 — Extension author upgrade instructions

# PostgreSQL temporal representations, for extension authors

There is no codemod: the retired ids map to *two* replacements each, and which one an extension
should name is a judgement about what its consumers do with the column. Sweep by id, decide per
site, then re-emit any committed contract artifact.

Four behaviours bear on an extension's own codecs. Writes serialize at full precision and let
PostgreSQL round to the column's declared precision, carries included. A Temporal codec rejects
`infinity`, years beyond roughly ±271821, and non-ISO `DateStyle` output, naming the `*String` type
that reads them losslessly. The driver hands temporal OIDs through as server text rather than
building a `Date`. And temporal expressions are cast to `text` before PostgreSQL builds JSON, so a
nested read returns the same text a flat one does.

## `contract-space-restamp`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. Beyond the temporal changes above, the only expected diff is the embedded `version` moving to `8.0.0-rc.6`. The toolchain also re-released against `@prisma/cli-engine@0.2.2`; that change has no extension-facing surface.
