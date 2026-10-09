# Code review: weighted full-text index (PR #30562, commit 093a2faab5)

Reviewer lens: principal engineer (correctness, failure modes, operability, cost). Base: `bot/index-types-declare-foreign-key-backing` (PR #30561, not reviewed here).

## Summary

The slice is in good shape. One function, `renderFullTextDocument`, produces the search document for the index DDL, the schema node and both query operations, and an integration test proves the three strings are identical and that Postgres stores the index and the query's document as the same normalized definition. `EXPLAIN` with sequential scans off shows the index used, with three negative controls (grouping, order, language). SQL injection through the language or field names is closed: the language is an enumerated allowlist on every path and column names go through `quoteIdentifier`, which doubles embedded quotes.

I found no security or correctness defect in the renderer, the reader or the query operations. The findings are one diagnostic regression on the TypeScript path (a `map:` full-text index no longer warns), two test gaps on migration behaviour I confirmed by probe, and two small robustness notes.

Checks run on the checkout (logs in this directory): the Postgres target package tests (2950 passed, 18 skipped), the Postgres extension package tests (304 passed), the TypeScript contract authoring tests (542 passed), the three full-text integration test files (56 passed), and `pnpm fixtures:check` (passes, no diff; the first run failed only because the `prisma` binary was not linked before the build, and passed after a second `pnpm install`).

## What looks solid

- **One renderer, byte for byte.** `renderFullTextDocument` in `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` is generic over how a field and the language are written. The DDL and schema node pass quoted column names and a quoted language literal; the query operations pass `{{self}}`/`{{argN}}` placeholders. Coalescing, `setweight` and the weights come from one place. `test/integration/test/sql-builder/weighted-full-text-index-usage.test.ts` asserts the DDL, the schema node expression and the lowered query carry the same text, and then builds a second index from the query's text and checks `pg_indexes` prints both identically. That is stronger evidence than string equality alone.
- **Planner evidence with negative controls.** The same test sets `enable_seqscan = off`, asserts the index appears in the `EXPLAIN (FORMAT JSON)` plan for `fullTextMatches` alone and for match plus rank plus limit, and asserts it does not appear when the groups are merged, reversed or use another language.
- **Hostile input.** The language reaches SQL as an inline literal, but every path checks it against `POSTGRES_TEXT_SEARCH_LANGUAGES`: arktype `type.enumerated` at contract load (`index-types.ts`), the PSL spec enum, and `languageLiteral` in the query operations. Field names in DDL go through `quoteIdentifier`; in queries they are column references the AST renderer quotes.
- **Validation where the index is read.** `fullTextIndexDefinitionOf` refuses a unique index, invalid options and `columns` that differ from `fields.flat()`. `PostgresSchema` calls it at construction, so a hand-edited `contract.json` fails at load with `CONTRACT.INDEX_INVALID`, not later in the planner. Tests in `full-text-index-contract-load.test.ts` cover all three refusals.
- **Nullability is not an input.** In a multi-column document every column is coalesced. `full-text-index-planning.test.ts` proves a nullability change plans only the column change.
- **Upgrade path.** Planning from the previous contract renames the single-field index (tested). The app and extension upgrade instructions say plainly that `db update` drops and rebuilds, how to avoid it, and what `db verify` reports until the rename runs.
- **Hash change is contained.** `normalizeIndexOptionValue` now writes arrays and objects as JSON so `[['a','b']]` and `[['a'],['b']]` hash differently. Postgres storage parameters are scalars, so existing indexes keep their names; the extension upgrade note covers any extension that used structured option values.
- **Cost earns its keep.** The two family-level additions are small and optional: `resolveOptions` on a field-tuple index (needed because options name storage columns that are unknown while authoring) and `columnTraits` on an index type registration.

## Findings

### F01: the TypeScript `fullTextIndex` helper no longer warns for `map:`

Location: packages/3-extensions/postgres/src/contract/full-text-index.ts lines 66-106; compare packages/3-targets/3-targets/postgres/src/core/authoring.ts lines 762-765 and packages/2-sql/1-core/contract/src/index-naming.ts lines 173-175.

Issue: the shared index lowering emits `PN_EXACT_NAME_BODY_COMPARISON` only when the index has an `expression` or a `where`. Before this slice the TypeScript helper produced an expression, so `fullTextIndex(cols.body, { map: 'x' })` warned. It now produces a field-tuple index of type `fullText`, so it warns only when it also has `where:`. The PSL lowering was patched to push the warning itself (commits 4bbe8811b8 and 8d3d65491a); the TypeScript helper was not. The two authoring surfaces now disagree, and the TypeScript author loses the only signal that `db verify` will report this index as changed every time. `test/integration/test/family.schema-verify.full-text-index.integration.test.ts` (the `map: 'legacy_post_search'` case) proves that drift is certain: Prisma's own DDL is never Postgres's printed form.

Suggestion: make the warning a property of the `fullText` index type rather than of each authoring surface. The simplest fix is in the shared lowering: treat an index whose type renders an expression as having a SQL body. If that needs a registry flag, a narrower fix is to push the warning from the TypeScript helper path the same way PSL does. Add a test beside `takes map: as the exact database name` in packages/3-extensions/postgres/test/contract-builder/full-text-index.test.ts that asserts the warning.

### F02: no committed test shows that changing weights, order or language rebuilds the index

Location: packages/3-targets/3-targets/postgres/test/migrations/full-text-index-planning.test.ts (whole file); packages/3-targets/3-targets/postgres/test/psl-full-text-index.test.ts lines 208-219.

Issue: the existing test only shows the four variants get four different names. Whether the planner then drops and recreates, or wrongly renames (keeping the old document under a new name), is not asserted. A rename here would be a silent correctness failure: the index would exist but never be used, with no error. I ran a throwaway probe (deleted afterwards) with the file's own helpers, planning `@@fullTextIndex([text, note], name: "message_search")` against itself with one change:

```
[[text, note]]        → Drop index "message_search_9242e0c5", Create index "message_search_9066d803"
[note, text]          → Drop index "message_search_9242e0c5", Create index "message_search_2c94225f"
language: "german"    → Drop index "message_search_9242e0c5", Create index "message_search_e29a002a"
name: "msg_search"    → Rename index "message_search_9242e0c5" to "msg_search_9242e0c5"
```

The behaviour is correct today. It depends on the rename detection comparing the index body, which another change could weaken.

Suggestion: commit these four cases as one `it.each` in full-text-index-planning.test.ts, asserting the operation labels as above.

### F03: the column-trait rule is not enforced when a contract is loaded, and silently passes for unknown codecs

Location: packages/2-sql/1-core/contract/src/index-type-validation.ts lines 38-40 and 55-58; packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts lines 130-132.

Issue: `columnTraits` is checked only at contract build, only when a codec lookup is supplied, and skips a column whose codec the lookup does not know. Loading a `contract.json` runs `fullTextIndexDefinitionOf`, which does not check traits. A hand-edited or stale contract with a `fullText` index over an `int4` column loads cleanly, and the failure surfaces as a Postgres error during `CREATE INDEX` in a migration. The PR body says non-text columns are refused "however the index was written", which is true of authoring but not of loading. The impact is small, since the repository rules forbid hand-editing emitted contracts.

Suggestion: either check the column codecs in `fullTextIndexDefinitionOf` (the table's columns are available at `PostgresSchema` construction, and `isFullTextIndexableCodec` already exists in the target), or narrow the PR body's claim to "when the contract is built".

### F04: object option values hash by key order

Location: packages/2-sql/1-core/schema-ir/src/naming.ts line 248.

Issue: `JSON.stringify` keeps insertion order, so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce different index names. No current index type stores an object option value, so nothing breaks today, but the next type that does would get names that depend on how the author ordered keys.

Suggestion: serialize with sorted keys (a small recursive canonical JSON helper), or narrow the branch to arrays and leave objects for when a type needs them. Add one case to the existing `normalizeIndexOptionValue` test.

## Deferred (out of scope)

- **`map:` full-text indexes never verify clean.** Exact-name indexes are compared by text, and Postgres reprints the document (`'english'::regconfig`, `COALESCE`, `::text`, `'A'::"char"`). This is the documented behaviour of `PN_EXACT_NAME_BODY_COMPARISON` and predates the slice. The upgrade instructions say so. A real fix (compare against a normalized form, or refuse `map:` on `@@fullTextIndex`) is a design decision for a later change. F01 covers the part that belongs here: both surfaces must warn.
- **`contract infer` from a live database with a weighted index.** The spec puts this out of scope: an inferred index stays an opaque expression. I did not test it.
- **A field of a variant model.** Not covered by tests. Both surfaces resolve fields through the model's own field map, so a variant field on a base-model index should fail as an unknown field. I did not verify this.
- **`fullTextHeadline` over weight groups.** It stays per column by design, per the spec.
- **Naming of `fullText`, `resolveOptions` and `columnTraits`, and learnability of the nested-list syntax.** These belong to the architect and devrel review.

## Already addressed

From log.txt and earlier review rounds:

| Earlier concern | Resolution | Commit |
| --- | --- | --- |
| A full-text index should be its own index type, not `gin` with options | `fullText` registered in the Postgres index type registry; DDL is `gin` over the document | 85effdeaa5 |
| Multi-column documents must not go null when one column is null | Every column coalesced in a document of more than one column | 85effdeaa5 |
| The foreign-key backing rule belongs in its own PR | Split to #30561 and merged in | 48448a3cb0, 0d96befad3, 568ac694a1 |
| Inferred-PSL test helpers passed `backsForeignKey` unbound | Helpers call it on the registry | 45515869d9, 093a2faab5 |
| `@@fullTextIndex` with `map:` and `where:` warned twice | Warns once | 8d3d65491a |
| The definition reader imported the codec list | Moved to `full-text-indexable-codecs.ts` | 08c4e6c616 |
| A `fullText` index could be unique or cover a non-text column; weights were defined twice | Refused; one `FULL_TEXT_WEIGHTS` constant | d34e5555b1 |

## Acceptance-criteria verification

| # | Condition or edge case | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `EXPLAIN` uses the index for `fullTextMatches` over weight groups with sequential scans off, and not when groups, order or language differ | PASS | weighted-full-text-index-usage.test.ts: `uses the index for fullTextMatches over the same weight groups`, `negative controls` (three cases) |
| 2 | A title match ranks above a body match with `fullTextRank` over weight groups | PASS | weighted-full-text-index-usage.test.ts: `ranks a title match above a body match` (row 97 title, row 89 body; order and strict rank inequality asserted) |
| 3 | DDL, schema node expression and query expression are the same string | PASS | weighted-full-text-index-usage.test.ts: `renders the same search document…` and `is stored by Postgres as the document the query searches` |
| 4 | `EXPLAIN` uses a single-field index in the new representation for `fullTextMatches` on a column | PASS | full-text-index-usage.test.ts: `uses the index for the SQL builder predicate`, now created from the planned schema node |
| 5 | Diagnostic: more than four groups | PASS | psl-full-text-index.test.ts `rejects more than four weight groups`; TypeScript helper shares `weightGroupProblems` |
| 6 | Diagnostic: non-text field | PASS | psl-full-text-index.test.ts `rejects a field that is not textual…`, native enum, relation; contract-builder.index-type-column-traits.test.ts for the general index API |
| 7 | Diagnostic: unknown field | PASS | psl-full-text-index.test.ts `rejects a field the model does not declare` |
| 8 | Diagnostic: duplicate field | PASS | psl-full-text-index.test.ts `rejects a field named twice, in one group or across groups`; options schema also refuses duplicates at load |
| 9 | Diagnostic: empty group | PASS | psl-full-text-index.test.ts `rejects an empty weight group`, `rejects an empty field list` |
| 10 | `pnpm fixtures:check` passes | PASS | `pnpm fixtures:check` exits 0 with no diff (fixtures-check2.log) |
| 11 | The demo runs its migrations and its full-text example | NOT VERIFIED | Needs a live database; the demo migration and snapshot were regenerated by the repository's regeneration script |
| 12 | Edge: no consumer of `columns` treats a full-text index as a plain index | PASS | `backsForeignKey: false`; schema node builds an expression index with `dependsOn` limited to the covered columns (full-text-index-schema-node.test.ts); printer branches on the type |
| 13 | Edge: weighted expression verifies against what a real database returns | PASS | family.schema-verify.full-text-index.integration.test.ts `verifies clean against its contract when wire-named` |
| 14 | Edge: demo migration history follows the repository's rules | PASS | Migration and snapshot regenerated, not hand-edited; see fixtures check |
| 15 | Edge: a `where` predicate keeps working | PASS | full-text-index-schema-node.test.ts `keeps a where predicate`; full-text-index-usage.test.ts partial-index `EXPLAIN` |
| 16 | Changing weights, order or language rebuilds the index (probe) | WEAK | Correct in a throwaway probe; no committed test (F02) |
| 17 | `map:` full-text index warns on both surfaces (probe) | FAIL | TypeScript helper does not warn without `where:` (F01) |

| Verdict | Count |
| --- | --- |
| PASS | 14 |
| WEAK | 1 |
| FAIL | 1 |
| NOT VERIFIED | 1 |
