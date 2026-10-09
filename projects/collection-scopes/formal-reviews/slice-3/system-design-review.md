# System design review: the weighted full-text index is data in the contract

**Reviewed:** commit 093a2faab5 on `weighted-full-text-index` (PR prisma/orm#30562, TML-3431), against `bot/index-types-declare-foreign-key-backing` (PR #30561, reviewed separately). Paths below are relative to the reviewed tree, `wip/review-slice-3-skill/tree/`.

**Lens:** architect. Naming, typology, subsystem fit, dependency direction, ADR coherence, and test strategy at the level of what is proven.

**Verdict:** CONCERNS. The core decision is sound: the index is data, one renderer serves the DDL, the schema node and the query, and the data shape is what ADR 260 needs. The concerns are about how the new kind of index type fits the registry's typology, and about one contract key name that should change before ADR 260 builds on it.

## What the change introduces

- A Postgres index type `fullText`, registered in the target's index type registry beside the access methods. Its `options` are `{ fields, language }`: weight groups of storage column names, and a text-search configuration. `columns` repeats the fields read flat.
- An optional `columnTraits` on the SQL family's `IndexTypeEntry`, checked at contract build against the codec lookup.
- `resolveOptions` on the TypeScript contract builder's field-form `IndexConstraint`, so a pack helper can write options that name storage columns.
- `normalizeIndexOptionValue` in the SQL schema IR writes array and object option values as JSON.
- One renderer, `renderFullTextDocument`, used by the schema-node conversion (and therefore DDL, planning and verification) and by `fullTextMatches` and `fullTextRank`.
- `@@fullTextIndex` and `fullTextIndex` accept weight groups. The PSL printer prints `@@fullTextIndex` from a `fullText` index.

## What holds

- **Dependency direction is clean.** `mise exec -- pnpm lint:deps` in the reviewed tree passes: no dependency violations in 1483 modules, no `@internal/target-*` import in `packages/1-framework`. The framework layer is not touched. The SQL family gains only target-neutral vocabulary (`columnTraits`, `CodecTraitsLookup`, `CONTRACT.INDEX_INVALID`). The trait name `textual` and everything about weights and languages stay in the Postgres target.
- **The data shape serves ADR 260.** The emitted `contract.d.ts` carries `type: 'fullText'` and the options as literal types (`examples/prisma-8-demo/src/prisma/contract.d.ts` lines 720-728). ADR 260's `match` guard and `searchDocument(tableName, index.options)` can read them from the contract type with no SQL parsing.
- **`columns` repeated beside `options.fields` is the right trade.** Every family consumer that reads `columns` (foreign-key backing, the printer's ownership check) keeps working without knowing about full-text indexes, and the target refuses a contract where the two disagree. The repetition is enforced, not hoped for.
- **The renderer is one function with a narrow input.** `renderFullTextDocument` (`packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` lines 35-58) takes the groups and a way to write a column and the language. Nullability is not an input, so a nullability change cannot change the index. That is the correct boundary.
- **The test strategy proves the claim that matters.** `test/integration/test/sql-builder/weighted-full-text-index-usage.test.ts` shows `EXPLAIN` using the index with sequential scans off, and three negative controls (one group instead of two, reversed groups, another language) that do not use it. It also builds a second index from the query's own document text and checks that Postgres prints both definitions the same (lines 76-96). That checks equality as Postgres sees it, not only as strings. `test/integration/test/family.schema-verify.full-text-index.integration.test.ts` shows a weighted index verifies clean. `packages/3-targets/3-targets/postgres/test/migrations/full-text-index-planning.test.ts` lines 163-237 cover the storage hash change: planning from the old contract renames the index, and a nullability change plans only the column change.

## Findings

### SD01: `type` now names two different kinds of thing, and nothing in the registry says which

**Where:** `packages/3-targets/3-targets/postgres/src/core/index-types.ts` lines 30-48; `packages/3-targets/3-targets/postgres/src/core/migrations/contract-to-postgres-database-schema-node.ts` lines 201-214; `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` lines 130-132; `packages/3-targets/3-targets/postgres/src/core/psl-print/model-attributes.ts` lines 181-184; `packages/2-sql/1-core/contract/src/index-types.ts` lines 4-23.

**Issue.** Before this change every registry entry was an access method: the `type` literal is what goes after `USING`, and introspection reads the same value back from `pg_am.amname`. `fullText` is not an access method. It is a kind of index that the target turns into a `gin` index. The comment in `index-types.ts` says so, and ADR 210 now says so, but the entry itself carries no field that marks the difference. As a result:

- The access method of a `fullText` index is the literal `'gin'` written in the schema-node conversion (line 208), not something the registry knows. A reader of the registry, or of a contract, cannot learn that a `fullText` index is a `gin` index.
- Three target sites recognise the kind by calling `fullTextIndexDefinitionOf`, which compares `type` with the literal: the schema constructor, the schema-node conversion and the PSL printer. A second kind of this sort would add a branch to each.
- An extension pack cannot register a kind like this, because the conversion is target code. ADR 260's responsibilities table says the "target or extension that introduces a kind of index" owns "the index's DDL". Under this slice, only the target can do that for an index that is not an access method.
- Applying the discriminator test: what does `fullText` differ from? From `gin`, but a `fullText` index is also a `gin` index. The registry has one axis (`type`) for two questions: which access method, and which kind of index.

**Suggestion.** Make the difference part of the entry. For example, add an optional `accessMethod` to `IndexTypeEntry`, defaulting to the type literal, and set `accessMethod: 'gin'` on `fullText`. The conversion then reads the method from the entry instead of writing `'gin'`. Then state in ADR 210 that a type whose `accessMethod` differs from its literal needs a conversion that only the target provides today. Also add a line to ADR 260's responsibilities table: an extension pack's index type must be an access method until a conversion hook exists. If the team prefers not to change the entry now, record the limit in ADR 210 and ADR 260 in those words, so it is not discovered later.

### SD02: ADR 210 still says things the amended design makes false

**Where:** `docs/architecture docs/adrs/ADR 210 - Index-type registry.md` lines 178-184 (index identity), lines 191 and 207 (PSL accepts string leaves), line 199 (positive consequence "a single declaration").

**Issue.** The branch amends the decision sentence and the renderer section, but three other sections still describe a registry where every type is an access method:

- **Index identity** says a contract index whose `type` differs from the live index's `type` is a mismatch. For `fullText` the contract says `fullText` and the database says `gin`, and they match. The comparison works because it runs on schema nodes after the conversion, but the ADR does not say that.
- **Authoring surfaces** says PSL `options` are string leaves. `fullText` is in the registry, so `@@index([title], type: "fullText", options: ...)` passes type narrowing but its options (nested lists) cannot be written in PSL. The TypeScript general index API does accept `type: 'fullText'` with options that name storage columns (tested in `packages/3-extensions/postgres/test/contract-builder/full-text-index.test.ts` lines 210-260). So there are three ways to author the index, and only two are meant to be used.
- **Positive consequences** says "Adding an index type is a single declaration … DDL rendering lights up without touching framework code". That holds for access methods only.

**Suggestion.** Update the three sections. In the identity section, say that the schema node, not the contract entry, is what is compared, and that `fullText` compares as `gin` with an expression. In the authoring section, say that `fullText` is written with `@@fullTextIndex` or `fullTextIndex`, and that the general index API accepts it but needs storage column names. In the consequences, limit the "single declaration" claim to access methods, with a pointer to SD01.

### SD03: the rules for one index type live in two mechanisms that run at different times

**Where:** `packages/2-sql/1-core/contract/src/index-types.ts` lines 12-22 (`columnTraits`); `packages/2-sql/1-core/contract/src/index-type-validation.ts` (trait check, build only); `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` lines 147-181 (`fullTextIndexDefinitionOf`); `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` lines 130-132.

**Issue.** A `fullText` index has four rules: its options are valid, its columns are text, it is not unique, and its columns equal its fields read flat. They are enforced in two places:

- Options and column traits are declared on the registry entry and checked by the SQL family when the contract is built. The trait check does not run when a `contract.json` is loaded.
- "Not unique" and "columns equal fields" are target code inside `fullTextIndexDefinitionOf`. That function is run for its side effect, its result discarded, in the `PostgresSchema` constructor, which means at load as well as build.

The spec says "`fullText` declares that it cannot back a foreign key, and cannot be unique". Only the foreign-key half is declared. Uniqueness is a question of the same kind as `backsForeignKey` (what can an index of this type do), yet one is a declared field and the other is a hidden throw. Separately, `fullTextIndexDefinitionOf` reads like a pure reader ("the definition of, or `undefined`") but throws, and the schema constructor calls it only to make it throw.

**Suggestion.** Declare uniqueness on the entry beside `backsForeignKey` (for example `unique: false` meaning "cannot be unique"), and check it in `validateIndexTypes` with the other declared rules. Keep the "columns equal fields" check in the target, because it is about this type's options, but give the check its own name, for example `assertFullTextIndexes(table)`, and let `fullTextIndexDefinitionOf` only read. Then ADR 210 can state in one place which rules run at build and which at load.

### SD04: `options.fields` holds column names; `fields` means model fields everywhere else

**Where:** `packages/3-targets/3-targets/postgres/src/core/index-types.ts` lines 23-28; `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` lines 11-15; the emitted contracts (for example `examples/prisma-8-demo/src/prisma/contract.json` lines 875-887); ADR 210 line 171; ADR 236; the Postgres README; `skills/prisma-8/references/contract.md`; ADR 260 section 1 on `bot/model-scopes-design`.

**Issue.** In the authoring surfaces, `fields` means model field names: the PSL argument key of `@@fullTextIndex` is `fields`, and it takes field names. In the contract's storage plane, the same word holds storage column names: `options.fields: [["title", "subtitle"], ["body"]]` is a list of columns. With `@map("body_text")` the PSL says `text` and the contract says `body_text`, both under the key `fields`. The storage plane's own word is `columns`, and the index already has a `columns` key. A reader of the contract, or the author of a scope helper under ADR 260, will reasonably assume `fields` are model fields and map them through the model. That gives the wrong column whenever a field is mapped.

**Suggestion.** Rename the key to say what it holds and how it is structured, for example `weightGroups` (or `groups`), and rename `FullTextIndexDefinition.fields` the same way. This changes the storage hash and needs one more re-emit of fixtures and the demo. Doing it now, before ADR 260's slice 4 reads the key and before release, is the cheapest point. Update ADR 260's contract example and its `FullTextIndex` type in the same change.

### SD05: `fullTextMatches` and `fullTextRank` declare a textual `self` but may receive a document

**Where:** `packages/3-targets/3-targets/postgres/src/types/operation-types.ts` lines 22-35 and 56-70; `packages/3-targets/3-targets/postgres/src/core/query-operations.ts` lines 38-72 and 86-120.

**Issue.** The operation descriptor still says `self: { traits: ['textual'] }`, but `impl` now accepts `TextualSelf<CT> | FullTextDocument<CT>`. The first argument is either the receiver column or a list of groups of columns. To fit the groups into the operation's argument list, `searchDocument` puts the first column in `self` and appends the rest after the fixed arguments, with an offset (`fixedArgs`) that differs per operation. That is a mechanism of the template system showing through the operation's shape: the descriptor does not describe what the operation takes, and every new option on these operations must shift the offset.

ADR 260 section 4 already uses a separate concept for this: `searchDocument(tableName, index.options)` builds a document, and `fullTextMatches(document, query)` takes it. A search document is a `tsvector` expression. It is a value of its own, not a textual column.

**Suggestion.** Before slice 4 builds on these forms, decide whether the search document is a first-class expression. One shape: a self-less operation that builds the `tsvector` document from weight groups, rendered by the same `renderFullTextDocument`, plus forms of `fullTextMatches` and `fullTextRank` that take a `tsvector`. The column forms stay as they are. If the team keeps the current shape, rename the parameter to `document` in the types and state in the descriptor's doc comment that `self` may be a document. That makes the receiver honest even if the mechanism stays.

### SD06: the weight-group rules are written three times

**Where:** `packages/3-targets/3-targets/postgres/src/core/index-types.ts` lines 8-19 (arktype schema); `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` lines 39-46 (renderer invariants) and 89-106 (`weightGroupProblems`); `packages/3-targets/3-targets/postgres/src/core/query-operations.ts` lines 43-66 (`searchDocument` check). The text rule is likewise written twice: `columnTraits: ['textual']` on the entry, and `isFullTextIndexableCodec` in the PSL lowering (`authoring.ts`) and the TypeScript helper (`packages/3-extensions/postgres/src/contract/full-text-index.ts` lines 108-124).

**Issue.** "One to four groups, none empty, each field once" is stated as an arktype schema, as a hand-written problem list, and as a third hand-written check on the query side. They share the `FULL_TEXT_WEIGHTS` constant, so the limit cannot drift, but the other rules can. The query side does not check duplicates, for example. That may be intended, but nothing makes it a stated choice.

**Suggestion.** Make `weightGroupProblems` the single statement of the rules. The arktype `narrow` calls it, and the query side calls it and chooses which problems to report. For the text rule, either let the authoring surfaces read `columnTraits` from the registry entry, or note at the entry that the authoring surfaces check the same rule earlier so they can report the field name.

### SD07: `full-text-index-expression.ts` holds four concerns, and `sql-utils` exports authoring helpers

**Where:** `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` (whole file); `packages/3-targets/3-targets/postgres/src/exports/sql-utils.ts` lines 1-10.

**Issue.** The file named for the index expression now holds the renderer, the authoring input form and its normalisation (`FullTextFieldsInput`, `weightGroupsOf`), the authoring diagnostics (`weightGroupProblems`, `describeWeightGroupProblem`), and the contract definition with its validation and errors (`FULL_TEXT_INDEX_TYPE`, `fullTextIndexDefinitionOf`). The docs and ADRs call the rendered value the "search document", but the file and `renderFullTextIndexExpression` still say "expression". The public entry `sql-utils` now exports diagnostics and the type literal, which are not SQL utilities. `FullTextDocumentSyntax` names a strategy object (how to write a column and the language) as "syntax".

**Suggestion.** Split by concern: a `full-text-search-document.ts` for the renderer, a `full-text-index-definition.ts` for the definition, the type literal and the read and check functions, and a `full-text-weight-groups.ts` for the authoring input and its problems. Export the authoring helpers from an entry whose name says authoring, or from the existing contract-builder entry of the extension. Rename `FullTextDocumentSyntax` to something that says what it is, for example `FullTextDocumentColumns` or `FullTextDocumentWriter`.

### SD08: `resolveOptions` does not mirror its sibling, and can be given together with `options`

**Where:** `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` lines 966-1000; `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts` lines 894-900.

**Issue.** The existing deferred form is `expression: { fields, render }`: a value placed where the plain value goes. The new deferred form is a separate key `resolveOptions` beside `options`, typed `DeferredIndexOptions`. So the type name says "deferred", the key says "resolve", and the sibling says "render". Because `options` lives on the type-and-options union and `resolveOptions` lives on the elements union, an index can carry both; lowering then ignores `options` without a word.

**Suggestion.** Follow the sibling: let `options` accept either the value or a deferred function, or make `options` and `resolveOptions` exclusive in the type. Name the key and the type as one pair, for example `renderOptions` and `DeferredIndexOptions`.

### SD09: small naming defects

**Where:** `packages/3-targets/3-targets/postgres/src/core/authoring.ts` lines 694-700; `packages/3-extensions/postgres/test/contract-builder/full-text-index.test.ts` lines 1-5; `packages/3-targets/3-targets/postgres/src/core/full-text-index-expression.ts` lines 127-133.

**Issue.**
- The problem kind `no-fields` maps to the diagnostic code `PSL_FULL_TEXT_INDEX_EMPTY_GROUP`. A reader of the code expects an empty group, not an empty field list.
- The test file header says the index is stored "as a gin index whose options hold the weight groups". After commit 85effdeaa5 it is stored as a `fullText` index.
- `IndexDeclaration` is a local structural copy of the storage index type, under a name that does not say it is the contract's storage index.

**Suggestion.** Map `no-fields` to its own code, or rename the code to cover both cases. Correct the test header. Type the reader's parameter with the family's storage index type, or with `Pick` of it.

## Deferred (out of scope)

- **Hash stability of object option values.** `normalizeIndexOptionValue` (`packages/2-sql/1-core/schema-ir/src/naming.ts` line 245) uses `JSON.stringify`, which depends on key order for objects. Whether authored and introspected objects can reach it with different key orders is an implementation question. Referred to the principal-engineer pass.
- **`map:` full-text indexes always report drift.** `db verify` compares the rendered text byte for byte with what Postgres prints, so a `map:` full-text index can never verify clean. The warning is the mitigation. Whether that is acceptable, or whether an exact-name structured index should compare structurally, is a product and operability question. Referred to the principal-engineer and PM passes.
- **`contract infer` keeps the opaque form.** An inferred weighted index prints as `@@index(expression: ..., type: "gin")`, so an inferred contract gets no `fullText` index and, later, no ADR 260 scope. The spec puts this out of scope. Referred to PM for whether it needs a ticket.
- **`db update` drops and rebuilds every existing full-text index** because of the name change. This affects users with large tables. Referred to the principal-engineer pass (blast radius and cost).
- **Learnability of weight groups** (bare field compared with a one-field list, A to D implicit by position). Referred to the devrel pass.
- **Correctness of argument positions in `searchDocument`** for rank with and without normalization. Covered by unit tests; correctness belongs to the code review. SD05 covers only the shape.
