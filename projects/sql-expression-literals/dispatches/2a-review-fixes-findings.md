# Findings from the slice 2a review fixes

**Resolved on 2026-09-30.** The coordinator decided to go ahead with A01 unchanged. `contract infer` reading only the target's lists is existing behaviour and out of scope. The family now registers `sql/expression`, and design section 11.1 records that the infer default mapping does not see family or extension types. `inferred-psl.defaults-and-types.test.ts` shows that infer still prints raw defaults as `sql` literals through `createPostgresDefaultMapping`.

## A01: `contract infer` does not read the stack's data types

The brief asks me to confirm, before moving the registration of `sql/expression` to the family, that every production path that assembles data types includes the family descriptor's contributions. One path does not, so I stopped A01 and did not move the registration.

What I checked:

| Path | Where it gets its data types | Includes the family's contributions |
| --- | --- | --- |
| The control stack | `createControlStack` assembles `[family, target, adapter, ...extensions]` (`framework-components/src/control/control-stack.ts` lines 808-813) | Yes |
| The PSL interpreter | `stack.authoringContributions` and `stack.dataTypeLookup`, passed by `load-contract-source.ts` lines 240-243 into `contract-psl/src/provider.ts` line 101 | Yes |
| The Prisma 7 reader | The same context, `contract-prisma7/src/provider.ts` line 171 | Yes |
| The language server | `pipelineInputsFromStack` and `resolveInterpretation` read `createControlStack(config)` (`language-server/src/config-resolution.ts` lines 61-100) | Yes |
| `contract print` | `stack.authoringContributions.dataTypes` and `stack.dataTypeLookup` (`family-sql` `control-instance.ts` lines 1040-1044, Postgres `psl-print/column-defaults.ts` lines 59-61) | Yes |
| `contract infer` | `createPostgresDefaultMapping()` builds the entries and the lookup from the target's own lists: `postgresDataTypeEntries()` and `createDataTypeLookup(postgresDataTypes)` (`3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts`). The family instance calls the target's `inferPslContract(schemaIR, describedContracts)` without the stack. | **No** |

So after A01, `contract infer` would lose the `sql/expression` type and its entry. It already omits every extension's data types for the same reason.

What that would change: nothing in the output, as far as I can tell from the code. `contract infer` uses the entries only in `default-mapping.ts` to print literal defaults. It prints SQL through `printSqlExpressionLiteral`, not through the entry. Today `writingSurface` skips the `sql/expression` entry. After A04 deletes that skip, the cast rule excludes it, because no column has `sql/expression` and no type casts from it. Either way the entry is never used, so its absence makes no difference. Slice 2b's infer printers also call `printSqlExpressionLiteral` directly.

My recommendation: go ahead with A01 unchanged. `contract infer` needs no change. If you want every path to see the same types, add `sqlExpressionDataType` and its entry in `createPostgresDefaultMapping` by hand, as the brief says tests do.

What I did instead: I fixed every other finding. I left out only the parts that follow from A01: the registration move itself, the ADR 254 sentence that a family registers only such a type, the target file headers, the `framework-authoring.ts` comments, the upgrade fragment instruction for third-party targets, and the A01 edits to design sections 1, 2, 3 and 18.3. The assembled-stack test of A02 passes with either registration, because both register the same objects.
