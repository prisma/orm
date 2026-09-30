# Slice 2a, round 2: system design review

Reviewer: architect. Range: `f768a4e831..77fa856832` (the fixes for the round 1 findings), read at HEAD, which merges `origin/main` on top of `77fa856832`. The review excludes `projects/` from the code diff but reads the spec and design as sources of design intent. Round 1 changes are not re-reviewed unless a fix changed them.

## What the fixes solve

The round 1 review found that the family defined `sql/expression` but each target registered it, that the rule "nothing casts from `sql/expression`" existed only as prose, and that several names and ADR sentences described the removed model. The fixes do three things:

- The SQL family descriptor registers `sql/expression` and its authoring entry itself (`dataTypes` and `authoring.dataTypes` on `SqlFamilyDescriptor`). The owner and the registrant are now one component. The target lists hold only the targets' own types.
- The rule "no data type casts from `sql/expression`" is now code: `assertNothingCastsFromSqlExpression` in `@internal/sql-contract/sql-expression`, called when `createSqlFamilyInstance` runs. It raises `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`.
- Vocabulary: a tag names a data type; one prefix rule, stated in ADR 254 in terms of the owner of the data type; "body" is what is written between the quotes and "text" is the canonical value.

New invariants: every assembled SQL stack holds exactly the family's `sql/expression` declaration and entry (a target that also registers it fails with `CONTRACT.DATA_TYPE_DUPLICATE`); every SQL family instance was created from a stack in which no type casts or list-casts from `sql/expression`; `@default` reads a `sql` literal through `sqlTextFromCanonical`, like every later consumer will.

## Subsystem fit and boundaries

- **Dependency direction is correct.** `@internal/family-sql` (layer 9) imports the type and entry from `@internal/sql-contract` (SQL core, shared plane). `@internal/sql-contract` imports only shared framework entries (`/authoring`, `/codec`). The targets no longer import `sql-expression` at all. `lint:deps` and `lint:framework-vocabulary` (272 of 272) pass, per `status.md`.
- **The framework needed no change** to let a family register a data type. `createControlStack` already assembles `[family, target, adapter, ...extensions]`, so every path that reads the stack (PSL interpreter, Prisma 7 reader, language server, `contract print`) sees the family's registration. The framework comments now say "the component that registers the type" instead of "the pack that owns the type", which is accurate.
- **`contract infer` does not read the stack.** It builds its entries from the target's lists, so it sees neither family nor extension types. The findings file shows this changes no output, and design section 11.1 records it. This is existing behaviour and was ruled out of scope; not a finding here.
- **The cast check sits outside stack assembly.** It runs at family instance creation, as the brief decided. Two consequences follow, covered in B01 and B02: the family has to re-derive the list of registered types, and the ADR's description of stack checks does not mention it. The language server builds a control stack but no family instance, so it never reports this error; the error reference says so honestly.
- **Tag order changed as a side effect.** The family is assembled first, so known-tag messages and completion now list `sql` before `json`. The upgrade fragments document this. Acceptable.

## Naming and typology

- `assertNothingCastsFromSqlExpression`: says what it checks, and `assert…` matches the repo's convention for throw-on-violation checks (`assertDescriptorSelfConsistency`). It lives next to the type whose rule it enforces, which is the right module: "nothing casts from it" is part of the definition of `sql/expression`.
- `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`: fits the existing `CONTRACT.DATA_TYPE_*` family of stack-integrity errors (`DUPLICATE`, `UNREGISTERED`, `NOT_WRITABLE`). A family concept in the shared `CONTRACT.` namespace has precedent (`CONTRACT.TABLE_AMBIGUOUS`). Its payload departs from its siblings; see B01.
- `readTaggedLiteral` and `TaggedLiteralRead`: the result type is now its own, with a `{ ok: false; diagnostic }` arm, and no longer borrows the default-function registry's type. The link from the literal reader to default-function lowering is gone. Good.
- `PSL_DEFAULT_LIST_EXPECTED`: says what it reports and no longer reads as a sibling of `PSL_VALUE_TYPE_INCOMPATIBLE`. Good.
- `PSL_INVALID_DEFAULT_SQL`, declared beside `sqlExpressionDefault` in `psl-column-resolution.ts`: now next to its only user; the `data-type-default.ts` header is true again.
- `runtimeError` exported from `@internal/framework-components/codec`: a general error constructor on an entry named for codecs. See B03.
- "pack" versus "component": ADR 129 says a pack registers a tag, ADR 254 says a component does. The repo calls the family descriptor a "family pack" (`Package-Layering.md`), so both are correct. Not a finding.

## ADR review

- **ADR 254.** The ownership paragraph (line 77) now states who registers `sql/expression`, the criterion for a family to register a type (as the operator decided), and the refusal code. The prefix rule is stated once (line 139), in terms of the owner of the data type, with one example per owner kind. "`@default` reports each of these codes at the `@default` attribute" now matches the code. The "How PSL writes a value" example now says `parse` receives the literal's text, but the documentation string in the same code block still says "Reads the body" (B05). The "Assembly" section (lines 169-176) still describes stack checks as assembly checks that name the contributor, and does not mention the family's check (B02).
- **ADR 129.** The H1, the at-a-glance paragraph, "Decision", "Why a tag", and "Registering a tag" now say that the tag names the data type. The ownership sentences are gone. The prefix rule links to ADR 254 instead of restating it. "The canonical text" section defines body and text once, and the rest of the ADR uses the words that way. The TypeScript sentence says the `sql` tag runs the same checks, without naming a slice. The new rejected alternative ("each target registers the family's type and entry unchanged") records the reason for A01. The ADR index row agrees with the ADR. No issues.
- **Subsystem doc 6.** The obsolete section (prefixed-alias syntax, routing to the owning pack, the view example) is replaced by two sentences that point to ADR 129 and ADR 254. Good.
- **Upgrade fragments.** The instruction for third-party targets to append `sql/expression` is gone, replaced by what happens if they do (`CONTRACT.DATA_TYPE_DUPLICATE`) and the new cast refusal. The code table has the rename row and the `sql`-in-a-list row. Both fragments agree.

## Test strategy at the architectural level

- `test/integration/test/authoring/sql-expression-registration.test.ts` assembles a real Postgres stack with every extension pack the repo ships, and a real SQLite stack. It checks with `toBe` that the registered declaration and entry are the family's, that no registered type casts from `sql/expression`, and that `sql.create(stack)` succeeds. This ties the rule to what a real stack registers, which round 1 asked for.
- `packages/2-sql/9-family/test/control-instance.sql-expression-casts.test.ts` checks that the family refuses a stack with a cast and with a list cast from `sql/expression`, with the whole message on one case.
- Both tests re-derive the list of registered types from the descriptors by hand, and the integration test repeats the cast predicate. That duplication is a symptom of B01, not a test defect.

## Round 1 findings against their decisions

| Finding | Decision | Result | Commit |
| --- | --- | --- | --- |
| A01 | Family registers `sql/expression`; remove from targets; update ADR 254, headers, comments, fragments, design | Fixed as decided. Spec line 89 missed (B04) | 273731b288, 54680fc713, d94c4db032 |
| A02 | Assembled-stack test per SQL target with `toBe` and the no-cast check, including shipped extensions | Fixed as decided | f747b80f48 |
| A03 | `@default` reads `sqlTextFromCanonical(read.typed.value)`; message uses `SQL_EXPRESSION_TAG` | Fixed as decided | 7b3e2215a7 |
| A04 | Delete the skip; rename the test | Fixed as decided | 02c6e2e66e |
| A05 | Rename to `PSL_DEFAULT_LIST_EXPECTED` everywhere | Fixed as decided | ba2d9617cf |
| A06 | Define as "a SQL expression"; replace doc 6 section | Fixed as decided | 2cbb418972 |
| A07 | One prefix rule in ADR 254; ADR 129 links to it; new H1; index row; TypeScript sentence | Fixed as decided | 6e4c5f16f0 |
| A08 | Body is written, text is canonical, in ADR 129 and error reference; no code rename | Fixed as decided. ADR 254 example string still says "body" (B05) | 6e4c5f16f0, ebb9ba2f52 |
| A09 | ADR 254: codes reported at the `@default` attribute | Fixed as decided | 6e4c5f16f0 |
| A10 | Rename to `readTaggedLiteral` with its own result type | Fixed as decided | 37d3335e2d |
| A11 | Move `PSL_INVALID_DEFAULT_SQL` beside its user; update tooling doc | Fixed as decided | 37d3335e2d, ebb9ba2f52 |
| A12 | Framework tests use `postgis.geometry` | Fixed as decided | 269b34a1f5 |
| A13 | Rewrite the `data-type-support.ts` header | Fixed as decided | c75af45986, 273731b288 |
| A14 | ADR 254 pointer; remove `sqlTextReadsBack` and the two unused `authoring` exports | Fixed as decided. `canonicalizeTaggedLiteralBody` was also removed from `/authoring`; it was added in this slice, so nothing on `main` breaks | 8f58899b56 |

## Findings

### B01: The family re-derives the registered data types, and its error does not name the contributor

Location: packages/2-sql/9-family/src/core/control-instance.ts lines 512-516; packages/2-sql/1-core/contract/src/sql-expression.ts lines 33-54; packages/1-framework/1-core/framework-components/src/control/control-stack.ts lines 65-90 and 847; test/integration/test/authoring/sql-expression-registration.test.ts lines 20-28.

Issue: `ControlStack` exposes the assembled data types only as `dataTypeLookup`, which has `get` and `has` and cannot be enumerated. So `createSqlFamilyInstance` rebuilds the list from `[stack.family, stack.target, stack.adapter, ...stack.extensions]`, a hand copy of the order in `createControlStack`. The integration test copies it a third time, together with a copy of the cast predicate. The rebuilt list drops which component contributed each type. The new error therefore names only the type, while every other `CONTRACT.DATA_TYPE_*` error names the contributor (`contributedBy` in the payload), and ADR 254 line 169 promises that stack checks do. The error reference tells the user to "remove the cast from the pack that declares the type" but cannot say which pack.

Suggestion: Expose the list `assembleDataTypes` already builds (`declared: { type, contributedBy }[]`) on `ControlStack`, for example as `declaredDataTypes`. Let `assertNothingCastsFromSqlExpression` take that list and put `contributedBy` in its message and payload, as its siblings do. Use the same list in the integration test instead of a copy of the walk.

### B02: ADR 254 does not describe where the family's stack check runs

Location: docs/architecture docs/adrs/ADR 254 - Data types and casts.md lines 77 and 169-176; docs/reference/error-reference.md, section CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION.

Issue: Line 77 says the SQL family refuses such a stack. The "Assembly" section lists the checks the stack makes across packs, and says assembly is the right level for them because they span packs. The new check also spans packs, but runs later, at family instance creation, and so never runs in the language server. Only the error reference says this. A reader of the ADR would expect it among the assembly checks, or expect the language server to report it.

Suggestion: Add one sentence to the "Assembly" section: a family may add checks for its own data types; the SQL family checks that no type casts from `sql/expression` when it creates its control instance, so the CLI reports it and the language server does not.

### B03: `runtimeError` is published on the codec entry

Location: packages/1-framework/1-core/framework-components/src/exports/codec.ts line 54; packages/2-sql/1-core/contract/src/sql-expression.ts line 5; packages/2-sql/1-core/contract/src/contract-errors.ts lines 1-18.

Issue: The shared-plane code in `@internal/sql-contract` cannot import the runtime entry, so the fix added `runtimeError` to `/codec`. The name of that entry says codecs; the error envelope is not a codec concept, and its type guard `isRuntimeError` and type `RuntimeErrorEnvelope` stay on `/runtime` only. A shared consumer can now raise the envelope but not recognise it. `@internal/sql-contract` also already has its own `contractError` helper for `CONTRACT.*` codes, built on `structuredError`, so the package now raises `CONTRACT.*` errors in two envelopes. The brief decided to use the envelope that `enforceDataTypeInvariants` uses, so the choice of envelope is settled; its publication point is not.

Suggestion: Publish `runtimeError`, `isRuntimeError` and `RuntimeErrorEnvelope` from a shared entry named for what they are (for example `/components`, or a new shared `/errors` entry), and import from there. Add one line to `contract-errors.ts`, or rely on the name of the new entry, so a reader knows why `sql-expression.ts` uses the other envelope: stack-integrity errors share the framework's envelope.

### B04: The spec still says each target registers `sql/expression`

Location: projects/sql-expression-literals/spec.md line 89.

Issue: Commit d94c4db032 updated spec line 66 to say the family registers the type, but line 89 still says "Each target registers the family's `sql/expression` declaration and entry." The spec now contradicts itself, and later slices brief from it.

Suggestion: Change line 89 to say the targets register only their own data types and entries, and the family registers `sql/expression`.

### B05: The JSON entry's documentation still says it reads "the body"

Location: packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts line 78; packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts line 58; docs/architecture docs/adrs/ADR 254 - Data types and casts.md line 111.

Issue: Under the rule A08 adopted, `parse` receives the text, not the body. The range changed the comment in ADR 254's example to "the literal's text", but the documentation string two lines below it still says "Reads the body as a JSON document". The same string is what the editor shows on completion for `json`, so users see the old word.

Suggestion: Change the three strings to "Reads the text as a JSON document and stores it as the default value." Renaming `parseJsonBody` and `printJsonBody` can wait for slice 2t, with the `TaggedLiteralCanonicalization.body` rename already recorded there.
