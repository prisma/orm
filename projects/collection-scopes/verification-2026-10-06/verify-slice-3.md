# Verification: slice 3 formal review, at dc01033a14

PR prisma/orm#30562, head dc01033a14 (branch `bot/weighted-full-text-index`). The rulings are the 2026-10-05T15:11 section of `wip/rulings.md`. I read the fix-round diff (`093a2faab5..dc01033a14`) and the design branch (`bot/model-scopes-design`, tip 4434a20bee). I changed no tracked files. Line numbers are at dc01033a14 unless stated otherwise. Paths in the slice tree are relative to `wip/slice3/`.

CI at the time of writing: every check passes except Integration Tests 1/4 to 3/4, which were still running (started 06:53 UTC).

## Findings

| Id | Ruling | Verdict | Evidence |
| --- | --- | --- | --- |
| SD01 | `accessMethod` on the entry; `fullText` sets `gin`; conversion reads it; ADR 210 and ADR 260 say an extension type must be an access method | Done (see new defect 1) | `packages/2-sql/1-core/contract/src/index-types.ts` lines 14, 30, 75, 87–94 (`accessMethod`, `rendersIndexBody`, `accessMethodOf`). `full-text-index-definition.ts` line 132 (`accessMethod: 'gin'`). The conversion reads it at `contract-to-postgres-database-schema-node.ts` line 207 through `postgresAccessMethodOf` (`core/index-types.ts` line 23). No other `'gin'` literal is left in target or family source. ADR 210 lines 3, 98, 182. ADR 260 table line 249 (design commit 4da6f57d11). |
| SD02 | Rewrite the three ADR 210 sections | Done | ADR 210 line 191 (the schema node is compared, `fullText` compares as `gin` with an expression), line 204 (`@@fullTextIndex`/`fullTextIndex`, general API needs an options function, PSL `@@index` cannot write it), line 212 ("Adding an access method is a single declaration", with a pointer to the new section). |
| SD03, SD06 | One validator beside the entry, called by every site; reader stays a reader; query side calls it or says why duplicates are not checked | Done | `fullTextIndexProblems` at `core/full-text-index-definition.ts` line 53, beside `fullTextIndexType` (line 129); `unique` is one of its rules (line 79). Callers: the arktype `narrow` (line 114), the load check `assertFullTextIndexes` (line 157), PSL `refine` (`authoring.ts` line 657) and `lower` (line 757), the TypeScript helper (`packages/3-extensions/postgres/src/contract/full-text-index.ts` lines 71 and 80), and the query operations (`query-operations.ts` line 54, with the sentence about duplicates at lines 44–46). `fullTextIndexDefinitionOf` (line 140) only reads, with an invariant. The text rule shares one constant, `FULL_TEXT_COLUMN_TRAITS`, with the entry's `columnTraits`. |
| SD04 | Rename `options.fields` to `weightGroups` everywhere; re-emit | Done | No `fields` key is left in full-text source, fixtures, demo, docs or the skill (the two remaining `options: { fields: … }` are family tests of a generic `hash` type). Demo `contract.d.ts` line 726. ADR 210 line 182, ADR 236 line 108, Postgres README, `skills/prisma-8/references/contract.md`, ADR 260 lines 116, 125, 190. I recomputed both example names with `computeIndexContentHash`: ADR 260's `post_search_2f1bb221` and the demo's `post_title_search_e0dd1131` are correct. |
| SD05 | Keep the shape; parameter named `document`; doc comment; deferred entry for slice 4 | Done | `src/types/operation-types.ts` lines 57–64 and 69–76. `query-operations.ts` `impl: (document, …)`. `projects/collection-scopes/deferred.md` line 13 on the design branch. |
| SD07 | Split the file by job | Done (see new defect 2) | `full-text-search-document.ts` (renderer, `FullTextDocumentWriter`, `renderFullTextIndexDocument`), `full-text-index-definition.ts` (type literal, definition, rules, reader, load check), `full-text-weight-groups.ts` (input form). Authoring helpers moved to a new entry, `src/exports/full-text-index-authoring.ts`, exported by both public packages. |
| SD08 | `options` takes a value or a function; `resolveOptions` removed; no index carries both | Done | `contract-dsl.ts` lines 908, 986, 1006. `contract-lowering.ts` lines 906–908 call the function, with the fields of a deferred expression too (`coveredFieldNames`). `resolveOptions` no longer exists anywhere in the slice tree. |
| SD09 | Fix the three naming slips | Done | `no-fields` maps to a new `PSL_FULL_TEXT_INDEX_NO_FIELDS` (`authoring.ts` lines 97, 711). The extension test header is corrected (line 2). The local `IndexDeclaration` is replaced by `Pick<StorageIndex, …>`. See the note on the new code. |
| F01 | TypeScript helper warns for `map:` without `where:`, with a test | Done | Shared lowering warns for a type that renders its body: `index-naming.ts` lines 177–181, registry passed at `build-contract.ts` line 1443. PSL's own push is removed, so both surfaces warn from one place. Tests: extension `full-text-index.test.ts` lines 174–208; PSL `psl-full-text-index.test.ts` lines 371–406 still pass. |
| F02 | Committed planner test: weights, order, language drop and recreate; prefix alone renames | Done | `full-text-index-planning.test.ts` lines 261–292. My probe adds: a language change with a prefix change, and a `where` change, both drop and recreate. |
| F03 | Text-only rule enforced at load from codec traits; unknown codec refused | Done | `postgres-contract-serializer.ts` lines 171–173 call `assertFullTextIndexes(table, postgresCodecTraitsOf)`. The family build check refuses an unknown codec (`index-type-validation.ts` lines 59–66). Tests: `full-text-index-contract-load.test.ts` line 57; `contract-builder.index-type-column-traits.test.ts` "refuses … codec the lookup does not know". No layering change; CI Lint passes. |
| F04 | Sort object keys recursively before hashing, with a test | Done | `schema-ir/src/naming.ts` lines 239–251. Tests at `naming.test.ts` lines 135 and 331. |
| Deferred: `db update` rebuilds | Upgrade entry says a full-text index declared before this change is stored in a new form and the first migration drops and recreates it | Done | `upgrade-instructions/pending/full-text-index-weight-groups/app/instructions.md` line 5: "declared before this change is stored … in a new form … the first migration after upgrading changes the index: `migration plan` renames it, and `db update` drops and recreates it". This is more precise than the ruling's words and matches the code: `full-text-index-planning.test.ts` line 159 shows a planned migration renames a pre-change index. Writing "drops and recreates" for `migration plan` would be false. |
| Design branch | ADR 260 rename, table line, deferred entry | Done | Commit 4da6f57d11 on `bot/model-scopes-design`. deferred.md line 7 now says loading also checks against the target's built-in codecs. |

Count: 14 done, 0 partly done, 0 not done. The code review's failed and weak acceptance rows (16 and 17) now pass. Row 11 (the demo runs its migrations against a database) is still not verified.

## New defects

1. **`accessMethod` from an extension pack is accepted but ignored by the DDL.**
   - Where: `packages/2-sql/1-core/contract/src/index-types.ts` lines 27–31 and 112–135 (the builder and `register` accept any `accessMethod`); `contract-to-postgres-database-schema-node.ts` lines 214–219 (every type other than `fullText` keeps `type: i.type`); `postgresAccessMethodOf` reads only the target's own entries.
   - Failure: an extension registers `.add('search', { options, backsForeignKey: false, accessMethod: 'gin' })`. The contract builds. `map:` on such an index warns, because `rendersIndexBody` honours the field. But the schema node's type is `search`, and the adapter renders `USING "search"` (`6-adapters/postgres/src/core/control-adapter.ts` line 2057). Postgres then fails the migration with "access method does not exist". ADR 210 and ADR 260 say an extension type must be an access method, but nothing refuses the field.
   - Probe: `wip/verify-slice-3-probes/zz-verify-slice3.test.ts`, first case (passes, showing one warning and node type `search`). Log: `zz-verify-slice3.log`.
   - Recommended fix: refuse, when the registry is assembled, an entry whose `accessMethod` differs from its literal unless the target registers it. That keeps the rule "explicit opt-in over diagnostics" and costs a few lines plus one test.

2. **`renderFullTextIndexDocument` no longer refuses an empty weight group.**
   - Where: `core/full-text-search-document.ts` lines 24–43. The split removed the old invariants on group count and empty groups. The function is public through `@internal/target-postgres/sql-utils`, and the extension upgrade entry tells extension authors to call it.
   - Failure: `{ weightGroups: [['a'], [], ['b']], language: 'english' }` renders a document that gives `b` weight `C` and skips `B`, with no error. The old renderer threw. Inside the repository every caller checks first, so only outside callers are exposed.
   - Probe: `zz-verify-slice3.test.ts`, third case (passes, asserting the exact skipped-weight text).
   - Recommended fix: assert `fullTextIndexProblems({ weightGroups })` is empty at the top of `renderFullTextDocument`, or of `renderFullTextIndexDocument` only, and add the empty-group case to `full-text-search-document.test.ts`.

## Notes (not defects)

- `PSL_FULL_TEXT_INDEX_NO_FIELDS` can never be raised. The PSL spec refuses `[]` first (`authoring.ts` line 627, `allowEmpty: false`), and the test at `psl-full-text-index.test.ts` line 329 shows `[]` gives `PSL_INVALID_ATTRIBUTE_SYNTAX`. Excluding `no-fields` from the PSL problem type, as `unique` is excluded, would remove the dead code.
- The `blindCast` in `constraints.index` (`contract-dsl.ts` lines 1238–1240) still casts `options` to `Record<string, unknown>`, and its reason still says options are "the pack-declared options object". A function now passes through it. Behaviour is correct; the cast's type and reason are stale.
- An `options` function on an index with a deferred expression works (probe, second case), but no committed test covers it.
- A `map:` full-text index whose definition changes gets a planner conflict (`indexIncompatible`, "use `migration new`"), not a drop and recreate. This comes from the general exact-name index handling in `issue-planner.ts`, which predates the slice. Probe: `zz-verify-slice3-planning.test.ts`, first case (fails, showing the conflict). Log: `zz-verify-slice3-planning.log`.
- The load check knows only the target's built-in codecs. If an extension pack ever registers a textual codec, a contract built through the general index API would pass the build check and then fail to load. deferred.md line 7 records the disagreement.
- The orphaned doc comment above `normalizeIndexOptionValue` in `schema-ir/src/naming.ts` (lines 218–232) still says option values are `String()`-coerced. It predates the slice.

## Checks run

| Check | Result |
| --- | --- |
| Postgres target: 8 full-text test files | 103 passed (`target-tests.log`) |
| Postgres extension: `full-text-index.test.ts` | 20 passed (`extension-tests.log`) |
| contract-ts: deferred options and column-traits tests | 5 passed (`contract-ts-tests.log`) |
| schema-ir: `naming.test.ts` | 77 passed (`schema-ir-tests.log`) |
| sql-contract: `index-types.test.ts` | 17 passed (`contract-tests.log`) |
| Probe `zz-verify-slice3.test.ts` (extension package) | 3 passed, confirming defects 1 and 2 |
| Probe `zz-verify-slice3-planning.test.ts` (target package) | 2 passed, 1 failed as described in the notes |
| Hash recomputation for ADR 260 and the demo | Both names match |

Logs and probes are in `wip/verify-slice-3-probes/`. I ran each probe by copying it into the package's test folder and deleting it afterwards; the slice tree has no changes.
