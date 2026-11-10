# Slice 7: generated values Prisma 7 schemas use

_Parent project: `projects/prisma7-contract-source/`. Linear: TML-3267, TML-3268, TML-3322 (high), TML-3275, TML-3255. One PR. Grounding: `wip/pr-a/grounding.md` (not tracked)._

## At a glance

Prisma 7 schemas like this one are refused today. After this slice, `prisma7Schema()` reads them, and Prisma 8 PSL can write the same fields:

```prisma
// Prisma 7
model Post {
  id        String    @id @default(uuid())
  token     String?   @default(uuid())
  updatedAt DateTime  @default(now()) @updatedAt
  editedAt  DateTime? @updatedAt
  day       DateTime  @updatedAt @db.Date
}
```

```prisma
// Prisma 8, as `contract print` writes it
model Post {
  id        String @id @default(uuid())
  token     String? @default(uuid())
  updatedAt temporal.timestampString(3, onCreate: now, onUpdate: now) @default(now())
  editedAt  temporal.timestampString(3, onCreate: now, onUpdate: now)?
  day       temporal.dateString(onCreate: now, onUpdate: now)
}
```

`contract print` also prints a default function that an extension registers, such as the test pack's `slugid()`.

## Chosen design

- **Left out versus `null`.** On a field with a generator, a value the client leaves out is generated, and an explicit `null` is stored as `null`, on create and on update, as in Prisma 7. The runtime already does this (`applyMutationDefaults` checks `Object.hasOwn`; the ORM drops `undefined` keys first). This slice adds tests for the four cases and changes no runtime code.
- **A database default together with a generator.** The contract already allows it (ADR 158). Every preset, not only `temporal.*`, accepts `@default(...)` when the default is a database default. It is still refused when both would set the same thing: the preset has its own database default, or `@default` is itself an ORM generator and the preset has an `onCreate` generator. No diagnostic for the database default being unused on ORM writes (`explicit-opt-in-over-diagnostics.mdc`).
- **Optional preset fields.** Every preset, not only `temporal.*`, accepts `?`, such as `uuidString()?`. `PSL_PRESET_NOT_OPTIONAL` stays only for presets that fix the id. A preset's own `nullable` is the starting value, and `?` makes the column nullable, as `.optional()` does in TypeScript. The `field.optional && loweredOnCreate` refusal and its code `PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT` go. The TypeScript builder drops `nullable-with-executionDefaults` and `default-and-executionDefaults` (`describe-model.ts`) under the same rules.
- **Every Postgres date and time codec has a "now" generator.** New generators for `pg/date-string@1`, `pg/time-string@1`, `pg/timetz@1`, `pg/date-temporal@1` and `pg/time-temporal@1`, all reading the UTC clock, `timetz` with offset `+00`. New presets `temporal.dateString`, `temporal.timeString`, `temporal.timetz`, `temporal.date`, `temporal.time`. `PSL.PRISMA7_UPDATED_AT_TYPE_UNSUPPORTED` can then no longer happen and is deleted. The Prisma 7 reader instead refuses `@updatedAt` with the new code `PSL.PRISMA7_UPDATED_AT_FIELD_INVALID` in three cases, all of which Prisma 7 refuses too: a field that is not a `DateTime`, a list field, and a `DateTime` field whose native type is not a date or time, such as `@db.Text`. A binding that returns no generator for the `DateTime` scalar's own codec is an internal error.
- **String timestamp codecs get text generators.** `pg/timestamp-string@1` and `pg/timestamptz-string@1` pair with new generators that write the text Postgres prints in a UTC session: `2024-01-02 03:04:05.678` and `2024-01-02 03:04:05.678+00`, three fraction digits, trailing zeros removed. The `Date` overload on the two codecs' `encode` is removed. A `Date` that reaches either codec now fails at runtime with `RUNTIME.ENCODE_FAILED`; only a direct `encode` call with a `Date` is a type error, because the ORM types of these columns were already `string`.
- **The printer asks the stack.** `ControlMutationDefaultEntry` gains `printArguments`, the reverse of `lower`: a map from generator id to a function that writes the arguments of the PSL call from the generator's params; the function name is the registry key. `assembleControlMutationDefaults` fails with `CONTRACT.PACK_CONTRIBUTION_INVALID` when two entries print one generator id or an entry prints an id no generator descriptor registers, and returns `defaultFunctionPrintersByGenerator`, which `SqlPslBuildContext` carries under the same name. For a field preset, the framework function `fieldPresetPrintForm` reads the print form from the preset's own `args` and `output`: its codec, the type params its leading positional arguments write, and per phase the option argument and the value of it that selects each generator. A preset has a print form when the printer can build its call: its type params take its leading positional arguments whole, its phases select on different named option arguments, and it sets no `default`, `id`, `unique` or `nullable`. A preset of another shape has no print form. A print form does not promise that every column prints: the SQL family's `fieldPresetCallFor` writes a preset call only for a column that is not a list and whose PSL type stands for its data type, not a named type, value object or enum; checks the arguments as the PSL reader does, so a column without a value for a required argument is not written; instantiates the preset with the printed arguments; and compares the codec, type params and both phases' generators and params with the column. When the call cannot be written or reads back differently, a column with only a create generator prints through its default function, and any other column is refused. Stack assembly builds `fieldPresetsByCodecAndGenerator` from the print forms, refuses two presets that write one codec with one generator, and the printer reads the preset for a column's codec and generator from that map. `GENERATOR_CALLS` and `TEMPORAL_PRESET_NAMES` are deleted.
- **Mongo is unchanged.** Its authoring keeps both refusals.

## Contract impact

- Storage hashes do not change.
- Execution hashes change for every contract with a string timestamp preset, which is every `prisma7Schema` contract with `@updatedAt`. The database marker stores only the storage and profile hashes, so users re-emit; they do not sign again. Upgrade instructions under `upgrade-instructions/pending/` say so, and say that a `Date` written by hand to a string timestamp column now fails at runtime with `RUNTIME.ENCODE_FAILED`.
- `ControlMutationDefaultEntry.printArguments` is a new optional field. The extension upgrade instructions tell pack authors that `contract print` needs it to print their functions, and which preset shapes `contract print` reads.

## Tests (each fails before its change)

- `packages/3-targets/3-targets/postgres/test/now-generators.test.ts`: every codec in the table generates a value that its codec encodes and reads back, with the string-codec filter removed; the "has no generator" list holds no date or time codec.
- `contract-psl`: a schema with `updatedAt temporal.timestampString(3, onCreate: now, onUpdate: now) @default(now())`, `token String? @default(uuid())` and `temporal.timestampString(3, onCreate: now, onUpdate: now)?` reads into the expected contract, asserted as a whole.
- `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts`: create left out, create `null`, update left out, update `null`, on a nullable column with `uuid()` and with an update generator, from a PSL-authored contract.
- `contract-prisma7/test/fixtures.test.ts`: `updated-at-with-default`, `generator-optional`, `updated-at-optional` and `updated-at-without-generator` (renamed `updated-at-date-time`) are success fixtures.
- `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`: the slugid contract prints and reads back; the four new Prisma 7 contracts round-trip there and in `prisma7-fixture-roundtrip.integration.test.ts`.
- A `framework-components` or family test: two packs claiming one generator id fail at assembly.
- `test/integration/test/prisma7-source/supported.integration.test.ts`: the `supported` schema, with the three attributes back, verifies with zero findings against Prisma 7.10.0's SQL. `supported-verify/` is deleted and its three users point at `supported/`.

## Docs

- `docs/reference/error-reference.md`: delete the three `PSL.PRISMA7_*` entries; `CONTRACT.DEFAULT_INVALID` and `CONTRACT.PRINT_UNSUPPORTED` reworded.
- READMEs: `packages/3-extensions/postgres/README.md`, `packages/2-sql/2-authoring/contract-prisma7/README.md`, `packages/2-sql/2-authoring/contract-psl/README.md`.
- ADR 252's example of a refused shape and `design-notes.md` line 32 change to a shape still refused.
- `projects/prisma7-contract-source/spec.md` § Deferred gaps: the default-function registry bullet is done.

## Dispatch plan

| # | Outcome | Hands to |
|---|---|---|
| 1 | Generators and presets: TML-3255 and TML-3275's generators and presets; text generators; `Date` overload removed; tracked contracts re-emitted; upgrade instructions. | Every date and time codec has a generator and a preset. |
| 2 | Prisma 8 authoring: PSL and TypeScript accept both shapes; runtime tests for left out versus `null`. | Prisma 8 PSL reads every form `contract print` will write. |
| 3 | Prisma 7 reader: three refusals gone, four success fixtures, `supported-verify/` gone, docs and ADR 252 example. | Prisma 7 schemas with these fields load and verify. |
| 4 | `contract print` asks the stack: `printArguments`, preset print forms, assembly checks, context, tables deleted, slugid round-trips. | Branch ready for review. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Also:

- Each test above was red before its change and is green after.
- `pnpm fixtures:check`, `pnpm lint:deps`, the cast ratchet, `pnpm lint:throws` and `pnpm check:upgrade-coverage --mode pr` pass; each touched package passes `pnpm test --coverage`.
- The print round-trip tests, the Prisma 7 source integration tests and the CLI journeys that use `supported/` pass locally.
- TML-3267, TML-3268, TML-3322, TML-3275 and TML-3255 are Done with closing comments after merge.
