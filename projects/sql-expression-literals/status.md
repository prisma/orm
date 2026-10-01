# Status and handoff

Read this first when you resume the project. It records where the work stands and the context that is not in the spec, design or plan. Update it at the end of every slice.

## State on 2026-09-30

- Planning is finished. No slice has merged.
- PR #30349 (the binder) merged on 2026-09-25 and PR #30381 (block specs) on 2026-09-28. Nothing outside the project blocks it.
- Slice 2a (TML-3296) is implemented on branch `tml-3296-sql-expression-data-type`, which also carries these project files. Two review rounds are done and every finding is fixed. Pull request: https://github.com/prisma/orm/pull/30534 (opened 2026-09-30, CI monitor on). Next: slice 2t (TML-3367) once it merges. [handover.md](handover.md) is the earlier handover and is superseded by this file.
- Slice 2a changed nothing in `examples/` or `packages/3-extensions/`, so `check:upgrade-coverage` required no declaration; the two fragments under `upgrade-instructions/pending/sql-is-a-data-type/` are the ones design section 20 names.
- The three publish-shell tarball tests (`all-shells-tarball`, `module-identity`, `cross-shell-tarball`) fail on this machine because `pnpm install` in the scratch project refuses `@vercel/detect-agent@1.2.5` as a "high-risk trust downgrade". That is the registry, not this branch. Check them in CI.

## Slice 2a review, 2026-09-30

- The implementer finished and committed but hit the Fable usage limit before it reported. Its verification logs are under `wip/v/`. Rerun on the tip: the render round-trip, two CLI tests and the relation-mode integration test pass (`wip/v/rerun-*.log`). The packaging and tarball tests fail only because of the registry trust-downgrade problem above.
- `/drive-code-review` (no walkthrough) wrote to `reviews/slice-2a/`, which `.gitignore` excludes. Copies are committed in `slice-reviews/2a/`.
- The architect review is done: `slice-reviews/2a/system-design-review.md`, findings A01 to A14. The main one, A01: the family defines `sql/expression` but each adapter registers it; register it from `SqlFamilyDescriptor` (the family descriptor can carry `dataTypes`), or record the alternative in ADR 254.
- The code review is done: `slice-reviews/2a/code-review.md`, findings F01 to F09; 32 PASS, 4 WEAK, 0 FAIL, 1 NOT VERIFIED (the tarball tests, which only CI can run). The main findings: the upgrade detection pattern for `pg.sql`/`sqlite.sql` misses escaped backticks and spaced dots and matches file names (F01); the upgrade text wrongly says messages did not change (F02); nothing enforces that no data type casts from `sql/expression` (F03); deleting the adapter test removed the only tests of the number classifiers (F04).
- The review fixes are done, except A01. Brief: `dispatches/2a-review-fixes-brief.md`. Verification logs: the gitignored `wip/v2/`.

### Review fixes, 2026-09-30

- **A01 is done** (commits `273731b288`, `54680fc713`, `d94c4db032`). The SQL family descriptor registers `sql/expression`; the targets no longer list it. `contract infer`'s default mapping still builds from the target's own lists and does not see family or extension types; that is existing behaviour, out of scope, and changes no output (`dispatches/2a-review-fixes-findings.md`, design section 11.1).
- Code: `@default` reads the `sql/expression` value through `sqlTextFromCanonical` (A03). `writingSurface` has no `sql` skip (A04). `PSL_DEFAULT_TYPE_INCOMPATIBLE` is `PSL_DEFAULT_LIST_EXPECTED` (A05). `sql/expression` is defined as a SQL expression (A06). `lowerTaggedLiteral` is `readTaggedLiteral` with its own result type (A10). `PSL_INVALID_DEFAULT_SQL` is declared in `psl-column-resolution.ts` (A11). `sqlTextReadsBack` and the unused `authoring` exports are gone, including `canonicalizeTaggedLiteralBody`, which only `sqlTextReadsBack` used (A14). `assertNothingCastsFromSqlExpression` in `@internal/sql-contract/sql-expression` throws `CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION`; `createSqlFamilyInstance` runs it on every registered data type. `runtimeError` is now exported from the shared `@internal/framework-components/codec` entry for it (F03).
- Tests: an assembled-stack test per SQL target, Postgres with all five shipped extension packs (A02); framework parser tests use `postgis.geometry` (A12); target entry tests restored in `3-targets/3-targets/{postgres,sqlite}/test/data-type-entries.test.ts` (F04); two `unreadable` rows and whole-message assertions (F05); the renamed test (F06); a `jsonb` default with a backtick in the infer round trip (F07).
- Docs: ADR 129 retitled and rewritten around "the tag names the data type of the text", with one prefix rule in ADR 254 (A07); body and text told apart (A08); ADR 254 says `@default` reports at the attribute (A09); the data-type-support header (A13); error reference without "a list holding another list" (F08); design line reference (F09); both fragments with the new detection pattern, tested in `wip/v2/f01-detection.log` (F01), and the list-literal row, the rename row and the `DefaultRefusal` change (F02).
- Manual QA was rerun before A01 landed. Its case 2 output listed the tags as `json, sql`, which did not match the expected `sql, json`, although the run said every case matched. The round 2 rerun on the tip replaces it in `manual-qa.md`, and there every case gives the expected result.
- Verification on the tip: `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts` (delta 0), `lint:throws` (delta 0), `check:error-reference`, `lint:framework-vocabulary` (272 of 272), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. `test:packages`: 1417 files pass; `operation-preview.test.ts` failed because its hand-built stack had no family, and passes after the fix; the three tarball tests fail on the registry refusal. `test:integration`: 873 files pass; only the two packaging files fail, on the same registry refusal. Check the tarball and packaging tests in CI.
- Verification after A01 (`wip/v3/`, local only): `build`, `typecheck`, `lint`, `lint:deps`, `check:error-reference`, `lint:framework-vocabulary`, `fixtures:check` and `check:upgrade-coverage` pass. `test:packages`: two failures pass on rerun (`completion-provider.test.ts`, the telemetry e2e test); the three tarball tests fail on the registry refusal. **`test:integration` did not finish** before the session was stopped for a rate limit. Run it again.
- The two review reports are committed in `slice-reviews/2a/`, because `.gitignore` excludes `reviews/`.

## Slice 2a review, round 2

The second review is in `slice-reviews/2a-round-2/` (findings B01 to B05 and G01 to G04). Brief: `dispatches/2a-round-2-fixes-brief.md`. All findings are fixed; nothing needed the findings file.

- **B01** (`5b5ce1b89b`, `2142987972`): `ControlStack` has `declaredDataTypes`, the list `assembleDataTypes` builds, with each type's contributor. `assertNothingCastsFromSqlExpression` takes that list and names the contributor in its message and payload. `createSqlFamilyInstance` and the registration test use the list. The message keeps "a list cast" for a list cast, as design 3.5 says. Tests, error reference and design 3.5 updated. The operation preview test's hand-built stack got the field; the other hand-built stacks are partial casts that never reach the family.
- **B02** (`d671f9ae0b`): ADR 254's Assembly section says the SQL family runs its own check when it creates its control instance, so the CLI reports it and the language server does not.
- **B03** (`597a20c65d`): `runtimeError`, `isRuntimeError` and `RuntimeErrorEnvelope` are exported from `@internal/framework-components/components`; `/codec` no longer exports `runtimeError`. `lint:deps` passes. Design 3.5 updated. The fragments did not name `/codec`.
- **B05, G03** (`3911ae54cc`): the `json` entry documentation says "Reads the text" on both targets, in ADR 254, in the codec authoring guide and in the two test copies. ADR 254 says `@default` reports `PSL_UNKNOWN_LITERAL_TAG` at the literal; plan.md's carry-over list no longer names it.
- **B04, G04, G02** (`7870e28f59`): spec "Adapter impact" says the family registers `sql/expression` and the targets do not. The extension fragment names `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE`.
- **G01** (`0fbf1f6414`): the registration test checks that the `sql/expression` entry comes first on both targets. The manual QA run on the tip replaces the old run; every case gives the expected result, and case 2 lists `sql, json`. The wrong status sentence is corrected.

Verification (logs in the gitignored `wip/v4/`): `build`, `typecheck`, `lint`, `lint:deps`, `lint:casts` (delta 0), `lint:throws` (delta 0), `check:error-reference` (361 codes), `lint:framework-vocabulary` (272 of 272), `fixtures:check` (tree clean) and `check:upgrade-coverage` pass. Tests: framework-components 794 pass, family-sql 372 pass (after the operation preview fix; the first run failed on that stub), the integration registration test 16 pass, language server 734 pass, `sql-expression.test.ts` and `sql-attribute-specs.test.ts` pass. Manual QA: `wip/v4/manual-qa.log`. The orchestrator still has to run `test:packages` and `test:integration`.

## Slice order and tickets

| Order | Plan slice | Ticket | State |
| --- | --- | --- | --- |
| 1 | 2a: `sql` is the data type `sql/expression` | TML-3296 | PR #30534 open; two review rounds done, all findings fixed |
| 2 | 2t: an argument declares the data type it receives | TML-3367 | Waiting for 2a |
| 3 | 2b: the six places take `sql` literals | TML-3288 | Waiting for 2t |
| 4 | 3: the TypeScript builder takes `sql` values | TML-3289 | Waiting for 2b |
| On the side | 1: line comments in raw SQL | TML-3287 | Not started; depends on nothing |
| Last | 4: migration files write template literals | TML-3290 | Waiting for 1 |
| Stretch | 5: migration files write `sql` values | TML-3297 | Waiting for 3 and 4 |

TML-3282 was the decision ticket and is done.

## Why slices 2a and 2t go first

The Linear project "Data types own column types" finishes ADR 254. Its last slice types default-function arguments by data type, for example the `8` in `@default(nanoid(8))`. Will decided on 2026-09-29 that this project builds the argument type `dataTypeValue` and that project reuses it. That project is blocked until TML-3367 merges. Its requirements are listed in TML-3367 and in design-notes decision 14.

Two notes were sent to that project's agent:

- `dataTypeValue` must not be a direct arm of `oneOf`. Inside a function call signature it works, and slice 2t tests a function call that is an arm of `oneOf`.
- `dataTypeValue` throws an internal error when the stack does not register the named data type. A family spec must choose the type id from the stack, not hard-code one target's id.

## The design is older than `main`

The design was written against commit `47d727b70d`, the head of PR #30381 before its author rebuilt it. After that, 57 files changed in `psl-parser`, the SQL PSL interpreter, the language server and the Postgres policy code. Only section 9.1 was rewritten for the merged code. So each slice starts by re-checking its own design sections against `main`:

- A file, line or function that moved: correct the design and continue.
- A difference in behaviour or in a type the design depends on: stop and raise it with Will.

What is known about `main` on 2026-09-29 (commit `d13613775f`):

- Policy blocks are `structBlock` specs in `packages/3-targets/3-targets/postgres/src/core/authoring.ts`. `using` and `withCheck` are `optional(str())`. The design calls them `fixedBlock` specs in one place; the name on `main` is `structBlock`.
- Block values are parsed by `interpretExtensionBlocks` in `psl-parser/src/block-spec/interpret.ts`. Only the SQL interpreter (`contract-psl/src/interpreter.ts`, about line 2104) and the Mongo interpreter (about line 1190) call it. The symbol table no longer parses block values, so the language server does not parse them either.
- `BlockSpecContext` is `{ symbols, block }`. It has no `dataTypes` field. Slice 2b adds it.
- `interpretExtensionBlocks` takes a `binder`. The design does not mention the binder.
- The largest changes are in `contract-psl/src/interpreter.ts`, `psl-column-resolution.ts` and `psl-field-resolution.ts`, which slices 2a, 2t and 2b edit.

## Related work outside the project

- **TML-3302** (date and time defaults are stored as different text by PSL and TypeScript) is not addressed by this project. It may edit `readDataTypeDefault` in `contract-psl/src/data-type-default.ts`, which slice 2t moves into the framework. If it does, it should merge before slice 2t, or slice 2t rebases on it.
- **TML-3286** removes `.defaultSql()` at 8.0.0. It is a non-goal here.
- The open PRs that touch the same files are listed at the end of [plan.md](plan.md). That list is from 2026-09-25; check it again before each slice.

## Proposals discussed but not decided

Will has not agreed to these. Do not act on them without asking.

- Run slice 3's `SqlExpression` class in parallel with slice 2b, and add the parity fixture in whichever merges second.
- Move slices 4 and 5 out of this project into their own tickets, so the project closes when slice 3 merges.
- Skip a second full verification pass of the design.

## Rules from Will that apply to every slice

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full locally (Will, 2026-09-30). Run the integration files the slice touches alone; CI runs the full suites.

- Plain strings are refused everywhere; there is no fallback.
- A `sql` literal is a value of a data type. Other literals are refused by the cast rule, never by a syntax check. Prisma never parses the SQL inside a literal.
- Checks on SQL content, such as "no SELECT", belong to the place that receives the value. Only `@default` has them.
- The tag is `sql` only. There is no `pg.sql` or `sqlite.sql`.
- The implementer has no design freedom. The design fixes every name, signature and message.
- Commits carry no AI attribution lines. Never amend, squash, rebase or force-push. Pull request titles are "TML-NNNN: sentence".

## History

- 2026-09-24: decisions made with Will; first design; architect and principal-engineer reviews (in [research/](research/)); design rewritten.
- 2026-09-25: design verification found 23 issues ([research/design-verification.md](research/design-verification.md)); 21 applied. Project put on hold until PR #30349 and PR #30381 merged.
- 2026-09-29: both merged. Section 9.1 rewritten to one path, which closed the last two findings. Slice 2t split out of slice 2b as TML-3367. Slice 2a started and implemented; design file and line references corrected against `main`.
