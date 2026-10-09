# Verification: slice 3 fix commits, dc01033a14..8325cbfada

PR prisma/orm#30562, branch `bot/weighted-full-text-index`, tip 8325cbfada (the `bot` remote is at the same commit). I read every line of the diff, changed no tracked files, and left the slice tree clean. Paths are relative to `wip/slice3/`. Probes and logs are in `wip/verify-slice-3-delta-probes/`.

## Verdicts

| # | Change | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `indexTypeRegistryOf(target, extensions = [])`; extension entry with a different `accessMethod` refused with `CONTRACT.PACK_CONTRIBUTION_INVALID` | Correct, tested | `packages/2-sql/1-core/contract/src/index-types.ts` lines 176–226. Two production callers, both pass the target first: `build-contract.ts` line 1146 (`definition.target`, then `Object.values(definition.extensions ?? {})`) and `9-family/src/core/control-instance.ts` line 598 (`stack.target`, then `stack.extensions`, which `createControlStack` fills with extension descriptors only). PSL emit, Prisma 7 sources (`contract-prisma7/src/interpreter.ts` line 492, target only) and the `@internal/postgres` facade (`postgresPack` as target) reach the registry through the contract build. The CLI, the language server and `contract infer` reach it through the build or the family instance; none calls it directly. Mongo has no index type registry. ParadeDB's `bm25`, `test-index-pack` (`bm25`, `hash`) and every other extension registration leave `accessMethod` out, so none is newly refused. The only entry with a different access method is the target's `fullText`, registered as the target. Test callers (core, Postgres `psl-infer/fixtures.ts`, `psl-print/build-context.ts`, `infer-foreign-key-backing.test.ts`) pass the target first. Tests: core `index-types.test.ts` lines 142–218, `contract-builder.index-type-access-method.test.ts`, Postgres `index-types.test.ts` lines 93–110. My probes add the PSL build and the family instance paths. The core code names no target, so `no-target-branches.mdc` holds. |
| 2 | `renderFullTextIndexDocument` checks with `fullTextIndexProblems`, throws `CONTRACT.INDEX_INVALID` | Correct, tested | `postgres/src/core/full-text-search-document.ts` lines 55–73. The import is new but makes no import cycle. In the repository the only caller is the schema-node conversion, which reads options that already passed the same rules, so its behaviour is unchanged. Test: `full-text-search-document.test.ts` lines 43–54 cover an empty group and a duplicate. Before the fix both rendered without an error, so the test can fail. My probe covers no group and five groups. |
| 3 | `PSL_FULL_TEXT_INDEX_NO_FIELDS` removed | Correct | `authoring.ts` lines 697–720 exclude `no-fields` from the PSL problem type. The spec refuses `[]` first (`allowEmpty: false`), and `weightGroupsOf` keeps the list length, so `no-fields` cannot occur. The test at `psl-full-text-index.test.ts` line 330 expects exactly one diagnostic, `PSL_INVALID_ATTRIBUTE_SYNTAX`. No doc or code still names the removed code. |
| 4 | `constraints.index` casts to `IndexOptionsInput` | Correct | `contract-dsl.ts` lines 1238–1241. The change is to types only. The reason text now covers the function form. |
| 5 | Test: `options` function on an index with a deferred expression | Correct, can fail | `contract-builder.deferred-index-options.test.ts` line 96. It asserts the columns the function received (a `.column()` override, `body_text`), the rendered expression and the options. If lowering did not call the function, `seen` would be empty and the test would fail. |
| 6 | No warnings sink passed to model attribute lowering | Correct, no warning lost | `contract-psl/src/interpreter.ts`, four lines removed (the import, the input field and two hand-offs). The sink was added on this branch (4bbe8811b8); `main` and the base branch never passed one. The only model attribute lowerings in the repository are Postgres `rls` and `fullTextIndex`, and neither reads `ctx.warnings`. The only `ctx.warnings` push is the policy block factory (`authoring.ts` line 326), which still gets the block context. `psl-full-text-index.test.ts` lines 387–405 still see exactly one `PN_EXACT_NAME_BODY_COMPARISON` warning for a `map:` index, from the shared lowering. |
| 7 | Error reference corrections | Correct, one omission | `error-reference.md` line 456: the helper sends `helper` and `fields` (the weight groups as field names) for both refusals (`3-extensions/postgres/src/contract/full-text-index.ts` line 109), and the renderer sends `weightGroups`. Line 548 matches the new message, `fix` and payload. It leaves out that the message says "registered by an extension pack" when the pack id is unknown; see the notes. |
| — | Upgrade text | Correct | `index-types-declare-foreign-key-backing/extension/instructions.md` line 53 shows `indexTypeRegistryOf(target, extensionPacks)`. `full-text-index-weight-groups/extension/instructions.md` line 40 lists exactly the four rules the renderer checks, and the code `CONTRACT.INDEX_INVALID`. `accessMethod` is new on this branch, so no extension needs an upgrade entry for the refusal. |
| — | ADR 210 | Edited sections correct; one stale line | Lines 98, 120 and 212 describe the refusal as coded. Line 131 is stale (defect 1). ADR 260 line 249 on the design branch agrees with the refusal. |

## Defects

1. **ADR 210's composition table still says the contract build registers every pack's entries.**
   - Where: `docs/architecture docs/adrs/ADR 210 - Index-type registry.md` line 131 (the "Runtime" row).
   - What it says: "`assertStorageSemantics` … instantiates `createIndexTypeRegistry()` and walks the same pack list, registering every entry."
   - What the code does: the registry is built by `indexTypeRegistryOf(definition.target, extensions)` at the start of the contract build (`build-contract.ts` line 1146), before any model is lowered. It is then passed into `assertStorageSemantics` (line 275), which no longer creates one. An extension pack's entry whose access method differs from its name is refused, not registered. A reader of the table who writes such an extension expects it to register. The build refuses it.
   - Probe: `zz-delta-psl-registry.test.ts`, first case. A PSL build that composes such an extension throws `CONTRACT.PACK_CONTRIBUTION_INVALID` from `indexTypeRegistryOf` (log `zz-delta-psl-registry.log`, 2 passed).
   - Fix: rewrite the row. The contract build assembles the registry with `indexTypeRegistryOf` from the target and the extension packs, and refuses a duplicate type or an extension entry that is not an access method. The row became stale when the base PR moved registry construction; this delta is the first change that makes "registering every entry" false.

No defects in the code.

## Notes (not defects)

- Merge order. This branch changes the signature that the base PR (#30561) introduces, and it edits #30561's pending upgrade entry. Both must ship in the same release. If a release is cut between the two merges, the released entry shows the array form, and nothing would record the change. A JavaScript caller built against the array form would silently get an empty registry, because an array has no `indexTypes` field. TypeScript refuses an array, because `IndexTypeRegistrant` has only optional fields and an array shares none of them.
- No unit test covers the family instance's call (`control-instance.ts` line 598). The `contract infer` end-to-end tests cover it indirectly: with the target in the extension slot, the Postgres `fullText` entry would be refused the first time infer asks about a foreign key. My probe `zz-delta-family-registry.test.ts` shows the call is right.
- Error reference line 548 gives only the message for a known pack id. When the id is unknown, the message says "registered by an extension pack". The `backsForeignKey` paragraph above it does describe its own variant for an unknown pack.
- `renderFullTextIndexDocument` checks only the group rules. It still puts `language` into the SQL between quotes, with no check or escaping, and it does not refuse an empty column name. This was already true on `main` (`renderFullTextIndexExpression`). The type limits `language` to the known configurations, and contracts are checked when they load, so only an outside JavaScript caller can reach this. The upgrade text names only the group rules, so it is accurate.

## Checks run

| Check | Result |
| --- | --- |
| sql-contract `index-types.test.ts` | 20 passed (`contract-tests.log`) |
| contract-ts: access-method, deferred options, index types, column traits | 4 files, 13 passed (`contract-ts-tests.log`) |
| Postgres target: index types, full-text files, PSL full-text, `psl-infer/`, `psl-print/`, full-text planning | 40 files, 408 passed (`target-tests.log`) |
| contract-psl: model-attribute indexes, interpreter, TS–PSL parity | 3 files, 41 passed (`contract-psl-tests.log`) |
| family-sql `control-instance.build-psl-contract.test.ts` | 5 passed (`family-tests.log`) |
| Postgres extension `full-text-index.test.ts` | 20 passed (`extension-tests.log`) |
| Integration `authoring/paradedb-bm25-narrowing.test.ts` (one file) | 16 passed (`integration-paradedb.log`) |
| Typecheck: sql-contract, contract-ts, contract-psl, family-sql, target-postgres, extension postgres | all pass (`typecheck-*.log`) |
| Package lint, same packages except the extension | all pass (`lint-*.log`) |
| `lint:throws` | pass, 40 throws on both this branch and the merge base (`lint-throws.log`) |
| Probe `zz-delta-psl-registry.test.ts` (contract-psl) | 2 passed: PSL build refuses an extension's converted type and accepts it from the target |
| Probe `zz-delta-family-registry.test.ts` (family-sql) | 2 passed: the family instance accepts the target's converted type and refuses an extension's |
| Probe `zz-delta-render-document.test.ts` (target) | 3 passed: no group and five groups refused; four groups render |
| Commit trailers | all 7 commits have both sign-offs and no attribution lines |

I ran each probe by copying it into the package's `test/` folder, then deleted the copy. `git status` in the slice tree is empty.
