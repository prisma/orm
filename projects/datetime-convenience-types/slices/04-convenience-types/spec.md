# Slice 4 — PSL convenience types `DateTime`, `Date`, `Time` and `Duration`

**Linear:** [TML-3712](https://linear.app/prisma-company/issue/TML-3712) · **Parent:** [project spec](../../spec.md), decisions 1–5 · **Design record:** ADR 279 · **Builds on:** slice 3 (the explicit types)

## At a glance

```prisma
model Order {
  id        Int      @id
  paidAt    DateTime                                  // TimestamptzJsDate(3): timestamptz(3), a JavaScript Date
  settledAt DateTime(as: temporal)                 // TimestamptzTemporal: timestamptz, Temporal.Instant
  legacyAt  DateTime(storage: timestamp)               // TimestampJsDate(3): timestamp(3), a Date stored as UTC
  textAt    DateTime(as: string, precision: 6)     // TimestamptzString(6)
  shipBy    Date                                      // DateString: date, "2024-02-29"
  opensAt   Time(precision: 0)                        // TimeString(0): time(0), "09:30:00"
  localAt   Time(storage: timetz)                      // Timetz: timetz, "09:30:00+02:00"
  period    Duration                                  // IntervalString: interval, "P1M"
  parts     Duration(as: parts)                    // IntervalParts: interval, { months, days, micros }
  updatedAt DateTime @onCreate(now()) @onUpdate(now()) // generator chosen for TimestamptzJsDate
}
```

`Time(as: temporal, storage: timetz)` and `Date(as: jsDate)` are refused at the argument, naming the accepted choices. The contract stores only the explicit type each field becomes.

## Chosen design

1. **A convenience type is a new authoring descriptor kind, a type choice.** It declares its arguments (option arguments with a fixed set of bare-name values and a default each, plus value arguments passed through such as `precision`) and a table from each allowed combination of option values to the **name of an explicit type constructor** in the same namespace, with any parameter defaults for that combination (for example precision 3 when `as: jsDate`). Resolving a call looks up the combination, then instantiates the named explicit constructor with the passed-through arguments. A combination missing from the table is refused at the argument that makes it invalid, listing the values that would be accepted.
   - Rationale: ADR 279 says each convenience type becomes exactly one explicit type; naming the explicit constructor makes that literal, supports defaults and refusals directly, and needs none of the field-preset `option`/`select` template machinery that the field-preset removal project deletes. ADR 279's "How it works" is updated to this shape (an orchestrator representation decision).
2. **Every reader resolves the field's call.** The PSL column resolution, the TypeScript builder's runtime and type-level resolution (`type.*` helpers), the contract-prisma7 values path, and every place that today reads a constructor's fixed `output.codecId` without the call's arguments: `@default` literal admission (`receivingDataType`) and the `@onCreate`/`@onUpdate` generator lookup (`generatorCallArm`) must use the codec the field's call resolves to, including through a `types {}` alias. The control stack checks every reachable explicit constructor at assembly.
3. **Bare names are scalars.** `DateTime`, `Date`, `Time` and `Duration` work bare and called; the scalar view treats them like any all-optional constructor.
4. **`inferred` marks stay on the explicit constructors** in this slice; a type choice is never inferred. `contract print` and `contract infer` keep writing explicit names until slice 5.
5. **The four PostgreSQL types and their tables** are exactly ADR 279's convenience types table and the project spec's decision 3, with defaults: `DateTime` → `jsDate`, `timestamptz`, precision 3 for `jsDate` else none; `Date` → `string`; `Time` → `string`, `time`; `Duration` → `string`.
6. **The old meanings move to explicit names.** Every existing Prisma 8 PostgreSQL schema in the repository that writes `DateTime`, `Date` or `Time` (examples, apps, integration fixtures, test PSL strings, docs) is rewritten mechanically to the explicit type it means today (`TimestamptzTemporal`, `DateTemporal`, `TimeTemporal`), so no committed `contract.json` or hash changes. The `Date` and `Time` second names and `DateTime`'s current constructor are removed. The upgrade instruction gives users the same rewrite and says the bare names now choose different values.
7. **TypeScript builder.** `type.DateTime(...)`, `type.Date(...)`, `type.Time(...)`, `type.Duration(...)` exist through the `type.*` helpers and take one object (`type.DateTime({ as: 'string', precision: 6 })`), with one overload per row and a type-level resolution that yields the explicit type's codec and application type for literal arguments (a type test per table row).
8. **Language server.** Hover on a convenience type shows each argument's choices as PSL writes them (bare names) and which explicit type each combination becomes; completion of a bare convenience type inserts the bare name.
9. **ADR updates in the same PR:** ADR 279 to Accepted, its "How it works" describing the type-choice descriptor; notes in ADR 254 (a type constructor may resolve to another constructor), ADR 257 (unsuffixed names belong to convenience types), ADR 275 (the contributed `temporal.*` aliases are built on `DateTime`; the `String`/`JsDate` variants are not needed).

## Coherence rationale

One PR: the descriptor kind and its resolution in every reader exist only to carry these four types, and the four types are untestable without it. The fixture rewrite is mechanical and keeps every contract byte-identical, which the reviewer can verify with `pnpm fixtures:check`.

## Scope

**In:** the type-choice descriptor (framework), its assembly checks, resolution in every reader listed above, the four PostgreSQL types, the TypeScript type-level resolution and `type.*` helpers, hover and completion, the fixture and doc rewrite, upgrade instructions, the ADR updates.

**Out:** what `contract infer`, `contract print`, the Prisma 7 reader and `orm init` write (slice 5); SQLite and MongoDB (TML-3714); other scalars (TML-3715); completion inside a constructor's argument list (no constructor has it today).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Field typed by a `types {}` alias whose right-hand side is a convenience call | Resolves through the alias; `@default` and `@onCreate` use the resolved codec |
| `DateTime[]`, `DateTime?` | Same resolution as any constructor |
| `@default(timestamptz\`…\`)` on `DateTime(storage: timestamp)` | Refused by the existing cast rule (wrong tag), naming `timestamp` |
| `@onCreate(now())` on each convenience default | Generator resolved for the explicit codec (`timestampNow` for `TimestamptzJsDate`, `dateStringNow` for `DateString`, …) |
| Positional arguments, e.g. `DateTime(temporal)` | Accepted in declaration order, like any constructor |
| Precision on `Date` or `Duration` with `as: string` | Refused unless the explicit type takes it (`IntervalString(p)` does, `DateString` does not) |
| A pack declaring a choice that names a constructor no component registers | Assembly error naming the pack and the name |

## Slice-specific done conditions

- Every row of the at-a-glance block emits the stated explicit type's contract column (asserted equal to writing the explicit type), and a query on PostgreSQL reads the stated value type, with the defaults working in a process without a global `Temporal`.

## Dispatch plan

1. **The type-choice mechanism** — outcome: a test-only pack declaring a choice type resolves bare, positional and named calls, refuses an unlisted combination at the argument, and every reader in decision 2 uses the resolved codec (`@default` admission and `@onCreate` arm tests included); TypeScript type-level resolution covered by type tests. Gates: framework-components, psl-parser, contract-psl, contract-ts, family-sql package tests; typecheck; lint; `pnpm lint:deps`.
2. **The four PostgreSQL types and the rewrite** — builds on 1. Outcome: the at-a-glance block holds; existing schemas rewritten to explicit names with `pnpm fixtures:check` clean and no `contract.json` changed; upgrade instruction. Gates: target-postgres, adapter-postgres, the postgres extension, contract-prisma7 package tests; the date-time integration and print tests; `pnpm build`; `pnpm typecheck`; `pnpm fixtures:check`; `pnpm check:upgrade-coverage --mode pr`.
3. **Language server, docs and ADRs** — builds on 2. Outcome: hover shows choices and resulting explicit types; `docs/reference/scalar-types.md` describes both layers; skill references updated; ADR updates per decision 9. Gates: language-server package tests; `pnpm lint:docs`.
