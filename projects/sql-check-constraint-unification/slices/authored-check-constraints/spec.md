# Slice 4 — `authored-check-constraints` — Spec

**Parent:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md) · **ADR:** [ADR 244](../../../../docs/architecture%20docs/adrs/ADR%20244%20-%20Check%20constraints%20are%20opaque%20wire-named%20expressions.md) (§ "Derivation is scoped to managed tables", § "Equivalence, and what it does not detect")

## Purpose

Give authors a way to declare a CHECK constraint in the contract, so a hand-written database constraint stops being an undeclared extra that a destructive plan deletes.

## The defect

Slice 1 made introspection capture every `contype = 'c'` constraint. That was the point — it is what made complete reconciliation possible — but it also made hand-written constraints *visible to the planner* for the first time. Before slice 1 they were invisible: introspection only understood the constraints authoring generated and silently skipped the rest, so the planner never saw them and never dropped them.

Today, a database carrying

```sql
ALTER TABLE orders ADD CONSTRAINT positive_total CHECK (total > 0);
```

produces a contract that cannot mention it, because PSL has no syntax for a check. The contract therefore declares no such constraint while the database enforces one. Verify tolerates the mismatch (`db verify` clean, `--strict` reports an extra), but a plan run under a policy that allows `destructive` emits `dropCheckConstraint` for it — deleting a data-integrity rule the author deliberately added. ADR 244 records this as an accepted consequence pending an authoring surface. This slice is that surface.

`@@check` was a project non-goal on the reasoning that the representation is general enough to add one later without another contract change. That reasoning holds — no contract shape change is needed here — but the exposure it leaves behind is a regression the project introduced, so the project does not close without it.

## Precedent: this problem is already solved twice

User-authored SQL that Postgres reprints is not new. Indexes ([ADR 243](../../../../docs/architecture%20docs/adrs/ADR%20243%20-%20Wire-named%20indexes.md)) and RLS policies ([ADR 234](../../../../docs/architecture%20docs/adrs/ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)) both carry it, and both resolve it the same way. This slice copies that resolution rather than inventing a third.

| | authored form | naming | comparison | reprint exposure |
| --- | --- | --- | --- | --- |
| Index | `name:` | wire — `name` is the **prefix**, physical name is `name_<8hex>` | name only (`bodies: 'ignored'`, `sql-index-ir.ts:155-163`) | none |
| Index | `map:` | exact — verbatim physical name | body verbatim | real; guarded by `exactNameBodyWarning('index', …)` (`index-naming.ts:137-145`) |
| RLS policy | block head | wire — head is the prefix (`authoring.ts:216`) | name only (`postgres-policy-schema-node.ts:99`) | none |
| RLS policy | `@@map` | exact | body verbatim (`contentEquals`) | real; same warning (`authoring.ts:286`) |

The rule ADR 243 states: *compare by content wherever content is faithfully comparable; where Postgres reprints it, the name carries the content hash and the name is the equivalence relation.* An authored check is exactly that shape.

**Why the naive design fails, concretely.** `SqlCheckConstraintIR.isEqualTo` (`sql-check-constraint-ir.ts:71-80`) compares an exact-named check's expression byte-for-byte. That is sound today only because both sides are the database's own reprint. Give an author an exact-named check and the two sides are the author's text versus Postgres's reprint — `total > 0` versus `(total > 0)`, and worse: `price > 0` comes back `(price > (0)::numeric)`, `status IN ('a','b')` on a `varchar` comes back `((status)::text = ANY ((ARRAY['a'::character varying, …])::text[]))` (`check-introspection.integration.test.ts:70-109`). The result is not a cosmetic warning: verify classifies `not-equal` as `declaredIncompatible`, which **`external` does not suppress**, and the planner returns `notOk(nodeConflict('unsupportedOperation', …))` (`issue-planner.ts:873`). Permanent failure, no remedy available to the author. Wire naming makes that state unreachable.

## Surface

### PSL

`@@check` is a **family-level model attribute** (SQL-wide vocabulary, capability-gated per target — see § SQLite), taking an opaque predicate plus exactly one naming argument:

```prisma
model Order {
  id    Int     @id
  total Decimal

  // A new constraint for Prisma Next to create. `name:` is a prefix;
  // the physical constraint is `order_total_positive_<8hex>`.
  @@check(expression: "total > 0", name: "order_total_positive")
}

model LegacyOrder {
  id    Int @id
  total Decimal

  // An existing database constraint, adopted under its real name.
  // Written by `contract infer`, which captures the reprinted body.
  @@check(expression: "(total > (0)::numeric)", map: "positive_total")
}
```

- `expression` is required, opaque, and never parsed — the predicate body without the surrounding `CHECK (…)`.
- Exactly one of `name:` or `map:` is required. There is no derivable default: unlike an index there is no column tuple to name the constraint after, so omitting both is an error. This mirrors the expression-index rule (`index-naming.ts:118-127`).
- `name:` and `map:` are mutually exclusive.
- A model may carry any number of `@@check` attributes.

### TypeScript contract authoring

A `check()` model constructor beside `index()` (`contract-dsl.ts:1051-1076`), reached the same way:

```ts
model('Order', { fields: { … } }).sql({
  checks: [check({ expression: 'total > 0', name: 'order_total_positive' })],
})
```

Same argument rules, same validation, same lowering — the two surfaces converge on one `CheckNode` in the definition tree, exactly as `@@index` and `index()` converge on `IndexNode`.

## Naming and comparison

**`name:` → wire-named.** The physical name is `formatWireName(name, computeCheckContentHash(expression))`. The author's `name:` is the prefix; the hash commits to the predicate. Comparison is by name (the existing wire branch of `isEqualTo`), so Postgres's reprint is irrelevant by construction. Editing the predicate re-suffixes the name and plans as drop + add; editing only `name:` pairs by hash and plans as one `RENAME CONSTRAINT` through the existing `pairCheckRenames` pass (`planner.ts:535-751`) at no additional cost.

**The authored prefix throws rather than truncates.** `assertWireNamePrefixLength`, not `truncateToWireNamePrefixBytes`. ADR 244 § "Naming" settled the rule — a derived prefix truncates because its author cannot intervene; an authored prefix throws because shortening the typed name is a remedy available to them. This is the same split `defaultIndexName` already honours.

**`map:` → exact-named**, comparison by body verbatim, reserved for adoption of a constraint that already exists in the database. Hand-authoring a body under `map:` produces exactly the false drift described above, so it mints `exactNameBodyWarning('check', <name>)` at emit time — the helper already exists and already takes a subject union (`index-naming.ts:79-92`); this slice adds `'check'` to it plus its feature/remediation strings. The warning is not an error: `contract infer` legitimately produces this form, and an author who has copied a reprint verbatim is doing the right thing.

## The derived-check marker

`stripDerivedChecksFromNonManagedTables` identifies a derived check as a wire-named one (`derived-checks.ts:149`: `checks.filter((check) => check.prefix === undefined)`), and its own comment says that test moves when an authoring surface exists. It moves now: an authored `name:` check is wire-named, so today's marker would **silently delete an explicitly authored constraint** from any non-`managed` table and recompute the storage hash as though it were never written.

**Replacement: the prefix-shape rule.** A check is derived iff its wire prefix is one derivation would produce for some column of its table:

```
prefix ∈ { composeCheckWirePrefix(tableName, columnName, kind)
           : columnName ∈ table.columns, kind ∈ ('membership', 'elementNotNull') }
```

Not the full name-with-hash. The stronger test — recomputing `computeCheckContentHash` over the rendered expression, which is what `contract infer` does (`infer-model-blocks.ts:285-300`) — needs `postgresRenderCheckExpressions` to know what a kind renders, and the strip pass has no access to it: `applySqlSpecifierControlPolicy(contract, defaultControlPolicy, createNamespace)` receives no target descriptor, and threading one in to reach a duck-typed hook from a family-level funnel is a worse change than the problem. `composeCheckWirePrefix` lives in `@internal/sql-schema-ir/naming`, which `contract-ts` already depends on, so the prefix rule needs no new edge and no new argument.

**The corner case, and how it is closed.** The prefix rule is weaker: an authored check on table `order` written as `name: "order_total_check"` composes to the same prefix a derived membership check on `order.total` would, so the strip would misclassify it as derived and delete it. Rather than accept that, make it unreachable — **an authored `name:` whose prefix matches the derived-prefix shape for any column of its table is an authoring error** (`CONTRACT.CHECK_NAME_RESERVED`), telling the author to pick a different name. The check is cheap (a set membership against the table's own columns), it runs where the table's columns are already in hand, and it makes the classification exact by construction rather than probable.

Infer keeps its existing full-hash computation — it has the renderer in-package and the stronger test costs it nothing.

**Callers must pass the table's real, complete column set.** The rule reads `table.columns`; a caller that passes a partial or empty column map silently classifies every check as non-derived. Any consumer of the helper is responsible for handing it the columns the table actually has.

**The residual ambiguity is accepted, and cannot be closed lower down.** D3's reserved-prefix error guards the two sanctioned authoring surfaces. It does not guard a contract that reaches storage another way — a hand-edited `contract.json`, or any assembly route that bypasses `build-contract`. Such a contract can carry a wire-named check whose prefix collides with a derived shape, and the strip will read it as derived and remove it.

This cannot be fixed at the wire-schema or validation layer, and the reason is structural: **the contract carries no marker distinguishing an authored check from a derived one.** A wire-named check with a derived-shaped prefix is, in the contract's own vocabulary, exactly what a derived check looks like. A validator has no information to separate the two, so it could only reject *every* check with a derived-shaped prefix — which is every derived check. The ambiguity can therefore only be prevented before it exists, at authoring time, which is precisely what the reserved-prefix rule does.

For a contract that creates the ambiguity anyway, the derived reading is the only defensible one: it is what the name says. Hand-editing emitted artefacts is already unsupported — `contract.json` is an emitted artefact and the documented instruction is to edit the source. Adding a marker field to the check node would close it, at the cost of the contract shape change this slice exists to avoid; that trade is available to a future slice if a real consumer ever appears.

**Authored checks are emitted regardless of control policy.** The `derivesChecks` gate (`build-contract.ts:901-902, :1021`) governs *derivation* only; authored checks are added to `checksForTable` outside it. The reasoning that scoped derivation to `managed` was "the contract describes an external schema, it does not prescribe enforcement for it" — a derived check on an external table is a statement Prisma Next invented. An authored check is the author's own statement about a constraint they know exists, which is precisely what a description of an external schema should be able to say, and it is what makes infer round-tripping of `external` and pack-owned schemas work at all. The cost is that declaring a check that is not live on an `external` table fails verify with no remedy (`external` suppresses extras, not `declaredMissing`) — accepted, because unlike the derived case the author asked for it and can delete the line.

## Build pipeline (exact sites)

Mirroring `@@index` at every step:

1. **PSL spec** — `checkModelSpec` in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`, beside `indexModelSpec` (`:228-280`), with a `refine` enforcing `name:` xor `map:` and the required-one-of rule. New diagnostic codes `PSL_CHECK_NAME_XOR_MAP` and `PSL_CHECK_REQUIRES_NAME_OR_MAP`, declared beside the index ones (`:222-226`).
2. **Interpretation** — a branch in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` beside the `@@index` handling (`:972-1022`), pushing a `CheckNode` into a `checkNodes` array carried onto the model.
3. **Definition tree** — `CheckNode` in `packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts` beside `IndexNode` (`:81-90`); `ModelNode.checks` beside `ModelNode.indexes` (`:196`).
4. **TS DSL** — `check()` constructor and the `checks:` slot on the model's `.sql({...})`, beside `index()` (`contract-dsl.ts:866-893, :1051-1076, :1181`).
5. **Naming + lowering** — `lowerAuthoredCheck`, a new sibling of `packages/2-sql/1-core/contract/src/index-naming.ts` (`lowerAuthoredIndex`, `:101-177`), applying the naming rules above and minting the warning on the `map:`-with-body path.
6. **Build** — called from `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` near the index lowering (`:1133-1151`), merged into `checksForTable` before the table is assembled (`:1182`), **outside** the `derivesChecks` guard.

**No contract shape change.** `StorageTable.checks` already exists, already canonicalizes sorted by physical name (`canonicalization-hooks.ts:49`), and already validates (`storage-entry-schemas.ts:147`). The check node gains no field — a test pins that `StorageTableSchema` rejects unknown keys on a check (`check-constraint.test.ts:135-193`), and this slice keeps that true. Existing fixtures do regenerate — every emitted contract gains the additive `sql.checkConstraint` capability line the SQLite gating work adds — but no existing check node's own shape changes.

## Validation

| Situation | Outcome |
| --- | --- |
| neither `name:` nor `map:` | error `PSL_CHECK_REQUIRES_NAME_OR_MAP` (TS: `CONTRACT.ARGUMENT_INVALID`), span-anchored |
| both `name:` and `map:` | error `PSL_CHECK_NAME_XOR_MAP` (TS: `CONTRACT.ARGUMENT_INVALID`) |
| empty or whitespace-only `expression` | PSL: span-anchored `PSL_CHECK_EXPRESSION_EMPTY`; TS: `CONTRACT.ARGUMENT_INVALID` from the lowering backstop |
| authored `name:` prefix over the 54-byte wire budget | throw from `assertWireNamePrefixLength` (author can shorten it) |
| `map:` with a hand-authored body | **warning** `PN_EXACT_NAME_BODY_COMPARISON`, not an error |
| authored name collides with another check on the same table (authored or derived) | error — table-wide constraint-name uniqueness is already validated and stays |
| authored `name:` prefix matches a derived-prefix shape for any column of the table | error `CONTRACT.CHECK_NAME_RESERVED` — raised from `build-contract`, which both surfaces share, so it is a thrown structured error rather than a span-anchored PSL diagnostic. The rule needs the table's columns, which the PSL resolver does not have. See § The derived-check marker |
| `@@check` on a target without the capability | error `PSL_CHECK_UNSUPPORTED_TARGET` (see below) |

**Error codes.** The naming/arity errors are raised in `@internal/sql-contract` (Core) and use `CONTRACT.ARGUMENT_INVALID`, matching `lowerAuthoredIndex`, which raises exactly the same two rules — name-xor-map and requires-a-name-or-map — under that code (`index-naming.ts:106-131`). Core's subcode union deliberately stays as it is; `CONTRACT.CONSTRAINT_INVALID` lives one layer up in `@internal/sql-contract-ts` and is not reachable from Core without inverting the layering. The one genuinely new code, `CONTRACT.CHECK_NAME_RESERVED`, belongs to that Authoring package beside `CONSTRAINT_INVALID`, because the reserved-prefix rule needs the table's columns and is raised in `build-contract`.

## SQLite

SQLite has no checks today by omission, not by refusal: it contributes no `renderCheckExpressions`, so nothing derives. A family-level `@@check` would reach it, and the current failure modes are all bad — `tableConstraintsFromNode` (`column-ddl-rendering.ts:150-179`) **silently drops** the constraint at `CREATE TABLE`, introspection never returns checks so the declared one is permanently `declaredMissing`, and the planner conflicts with a message that misattributes the cause to scalar arrays.

Gate it as a capability, matching the `scalarList` precedent (`psl-field-resolution.ts:499-507`): add `sql.checkConstraint` to the capability matrix, reported `true` by the Postgres adapter (`adapter.ts:33-39`, `descriptor-meta.ts:188`) and absent for SQLite. `@@check` on a target lacking it is a span-anchored `PSL_CHECK_UNSUPPORTED_TARGET` diagnostic.

**The TypeScript surface cannot be gated at build time, and this is architectural.** When this was written, the capability ownership rule (since removed; [ADR 335](../../../../docs/architecture%20docs/adrs/ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md) replaces it) made capabilities adapter-reported: the contract declares *required* capabilities, and the composed adapter matrix is layered on by the CLI's `enrichContract` — which runs after `source.load()` has already built the whole contract, check nodes included. `buildSqlContractFromDefinition` sees only `definition.target.capabilities`, which is `{}` for Postgres by design, so gating there would reject every Postgres check. Branching on `targetId` instead is forbidden by [`no-target-branches.mdc`](../../../../.agents/rules/no-target-branches.mdc). So the TS path is ungated at authoring and fails later, when the SQLite DDL renderer refuses — with an accurate message rather than today's silent drop. Closing that gap properly means validating declared capability requirements after enrichment, which is a separate concern from this slice and is recorded as a follow-up. Independently, add the missing `check` branch to `tableConstraintsFromNode` that throws rather than drops, so no future path can silently lose a constraint.

## Infer

`contract infer` emits `@@check` for every live check that is **not** derived, using the derived-name predicate from § The derived-check marker as the exclusion test.

- Emission site: `buildModel` in `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts:98-131`, in the `modelAttributes` array between `@@index` (`:116-121`) and `@@map` (`:123-125`). `buildModel` already receives the whole `SqlTableIR` and already reads `table.checks` (`:284`), so no signature changes.
- Builder: `buildCheckAttribute(check)` in `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-index-attributes.ts`, beside `buildIndexAttribute`.
- **Always the `map:` form**, carrying the reprinted body verbatim — exactly what infer does for policies (`infer-policy-blocks.ts:32-39, :128-140`). Wire re-detection is not attempted: the live body is a reprint, the hash was taken over the authored text, so recomputation would essentially never match. `map:` is correct here because reprint-versus-reprint compares stably, and the emitted contract signs the live database with zero pending operations.
- The `exactNameBodyWarning` must **not** fire for infer-produced contracts. It is minted at authoring-lowering time from the source text; infer writes PSL that is then emitted like any other, so the warning would fire on the next `contract emit`. Suppress it when the body was captured by infer — the simplest honest mechanism is to skip the warning when the expression is byte-identical to the live body the contract was signed against, which is not available at emit time; therefore **the warning stays as-is and infer-produced contracts do warn**. That is the same behaviour indexes and policies already have with `map:` bodies today, and changing it is out of scope. State it in the docs so it is not read as a defect.

This is what closes the reported defect: pull a database with a hand-written check, and the constraint lands in `contract.prisma` as a declared object. Verify is clean, and no destructive plan drops it.

## What this slice does NOT touch

- **`SqlCheckConstraintIR.isEqualTo`** — unchanged. Wire-named authored checks take the existing name-only branch; exact-named ones take the existing verbatim branch. The comparison rules are already right; only the set of things that can produce each kind grows.
- **The planner, ops, DDL** — unchanged. An authored check produces the same `AddCheckConstraintCall` / `DropCheckConstraintCall` / `RenameCheckConstraintCall` as any other, through the same diff issues.
- **`@noCheck`** (slice 3) — orthogonal. It waives *derived* checks; `@@check` declares *authored* ones. A column may do both.
- **The generated `contract.d.ts`** — checks remain absent from the type surface. Adding them needs a type-level consumer; none exists.
- **Mongo** — untouched.

## Tests

**Naming and lowering** (`packages/2-sql/1-core/contract/test/`, new `authored-check-naming.test.ts` mirroring the index-naming tests)
1. `name:` produces `name_<8hex>` with the hash over the expression; `parseNaming` round-trips it.
2. Changing the expression changes the hash; changing only `name:` does not.
3. `map:` produces the verbatim physical name with no suffix.
4. Authored prefix over the byte budget throws (contrast: a derived prefix truncates — pin both in one test so the split cannot silently converge).
5. `map:` with a body mints `PN_EXACT_NAME_BODY_COMPARISON`; `name:` with a body does not.

**Authoring validation** (`contract-ts` and `contract-psl`): every row of the Validation table, span-anchored on the PSL side; PSL↔TS parity for each valid form, asserted on the serialized table and `storageHash`.

**The derived-marker replacement** (`contract-ts/test/check-constraint.authoring.test.ts`): an authored wire-named check on an `external` table **survives** the specifier strip while a derived one is still stripped — this is the test that fails today and is the whole point of the marker change. The existing case at `:954-999` (`'keeps an exact-named check, which no derivation produced'`) must be revisited: its name no longer describes the rule.

**Lifecycle against a real database** (`packages/3-targets/6-adapters/postgres/test/migrations/check-lifecycle-e2e.integration.test.ts`):
6. An authored `name:` check installs at `CREATE TABLE`, rejects a violating INSERT, and verifies clean.
7. Editing the expression plans exactly one drop + one add; editing only `name:` plans exactly one `RENAME CONSTRAINT`.
8. **The defect scenario, end to end**: create a table, add a hand-written constraint by raw SQL, run infer, emit, and assert (a) the PSL carries `@@check(expression: <reprint>, map: "…")`, (b) `db verify` is clean, and (c) **a plan under a destructive policy carries no `dropCheckConstraint` for it**. This is the regression test for the whole slice; it must fail on today's main.

**Infer** (`packages/3-targets/3-targets/postgres/test/psl-infer/print-psl/`): a live derived check emits no `@@check`; a live hand-written check emits one with the reprinted body; a table with both emits exactly one.

**Capability** (`contract-psl`, `sqlite`): `@@check` against a target without `sql.checkConstraint` is a span-anchored diagnostic; `tableConstraintsFromNode` throws rather than dropping.

## Docs

- **ADR 244**: amend § "Derivation is scoped to managed tables" (the derived marker is now computed from the derivation rule, not from wire-naming) and § "Equivalence" (an authored check is wire-named and name-compared; `map:` is adoption-only). Record that the consequence listed under known costs — hand-written checks droppable under a destructive policy — is closed.
- **ADR 243**'s account of the authored/adopted split now covers three object kinds; add checks to it or cross-reference from 244.
- `skills/prisma-8/references/contract.md`: the `@@check` surface, the `name:`-versus-`map:` distinction in user terms ("declaring a new rule" versus "adopting one that already exists"), and the warning.
- `skills/prisma-8/references/quickstart.md`: the brownfield path now captures hand-written checks.
- `derived-checks.ts` comment: the marker moved; say what it is now.

## Definition of Done

- Both surfaces accept every valid form and reject every row of the Validation table; PSL and TS produce byte-identical contracts.
- An authored `name:` check never false-drifts: the reprint corpus from `check-introspection.integration.test.ts` (numeric casts, `varchar` ANY-arrays, composite AND) is declared through `@@check` and verifies clean against a real database.
- An authored check on a non-`managed` table survives the specifier strip; derived checks still do not.
- **Test 8 passes**: a hand-written database constraint survives `infer → emit → destructive plan` without being dropped. It fails on `main`.
- No contract shape change; `fixtures:check` clean; existing adoption/introspection/lifecycle tests unchanged in meaning.
- `sql.checkConstraint` gates the PSL surface at authoring; the TS surface fails at DDL render with an accurate refusal instead of silently dropping the constraint (see § SQLite for why authoring-time gating is not reachable from the TS path).
- ADR 244 amendments and user-facing docs land in the same PR.

## Non-goals

- **Parsing check predicates.** The expression stays opaque everywhere, as in slice 1.
- **Detecting a predicate edited in place under an unchanged name.** Same accepted blind spot as indexes, RLS, and derived checks (ADR 244 § "Equivalence, and what it does not detect").
- **Column-level `@check`.** Postgres stores column-level CHECK syntax identically to table-level; one model-level surface covers both.
- **Domain-enum inference.** Separate gap, separately shaped.
- **Making `contract infer` avoid the `map:` body warning.** Pre-existing behaviour shared with indexes and policies.

## Alternatives considered

- **Exact-named authored checks (`@@check("total > 0")`, name derived or verbatim).** The obvious design, and wrong: it walks straight into byte-comparison against Postgres's reprint, which fails verify under every policy including `external` and hard-errors the planner with `unsupportedOperation`. Wire naming makes the failure unreachable instead of warning about it.
- **Normalizing both sides before comparison.** Requires parsing the reprint — the approach slice 1 deleted, for the reasons ADR 244 gives.
- **A Postgres-contributed model attribute (`authoring.modelAttributes`).** Cheaper — SQLite would reject it automatically via the unknown-attribute path — but the seam files entities into `namespace.entries[attribute][key]`, and checks live on `StorageTable.checks`. It would also make CHECK, which is standard SQL, Postgres-only vocabulary, and it does not cover the TS surface. The capability gate keeps the vocabulary family-owned.
- **Marking authored checks with a field on the check node.** Rejected: it changes the contract wire shape (and a test pins that the check node rejects unknown keys), regenerating every fixture, to encode something already derivable from the naming rule.
