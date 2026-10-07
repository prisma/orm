# Brief: cast-rule refusals lead with what to write (TML-3367)

You change the wording of the cast rule's refusals on branch `m29-2t` (pushed as `tml-3367-data-type-value`) in the git worktree at the current directory. Do not read, write or run anything outside this worktree; no `/tmp`; scratch under `wip/2t-wording/`. Run node, pnpm and git through `mise exec --`. The machine is under heavy load from other sessions: run long commands in the background with a log under `wip/2t-wording/` and read the log.

**Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.** They are too slow and too heavy for this machine. `pnpm test:packages` is allowed. In `test/integration`, run only the files named below.

## Why

Serhii's review of #30539 found `pg/int4 has no cast from pg/text; write a number` worse than `Expected a number` for the person writing the schema. Will agreed on 2026-10-06. The structure (`dataTypeValue`, `describeRefusal`, the codes, the spans) does not change; only the message text does. [design-notes.md](../design-notes.md) item 15 records the decision.

## The new messages

Every message leads with what to write. The type names appear only where they explain why a value of the right form was refused.

`describeRefusal` in `packages/1-framework/1-core/framework-components/src/shared/written-value.ts` gains the data types (`DataTypeSupport`) as a parameter, because the `no-cast` wording needs the value type's written form. Its guidance parameter becomes the admitted forms plus an optional exact rewrite; choose the parameter shape. Messages, with `forms` the admitted forms of the receiving type as today (`a number`, ``sql`...` ``, `true or false`, joined with ` or `):

| Refusal | Message |
| --- | --- |
| `unknown-tag` | Unchanged: `Unknown literal tag "pg.sql". Known tags: sql, json.` |
| `unreadable` | Unchanged: the entry's message. |
| `unwritable` | `Expected ${forms}; this target has no data type for a ${syntax} value` |
| `no-cast`, the value's written form is not one of `forms` | `Expected ${forms}` |
| `no-cast`, as above, with an exact rewrite (a quoted string for a type with a tag, whose text reads back) | ``Expected sql`...`; write sql`(archived_at IS NULL)` `` (the rewrite is `printTaggedLiteral(tag, text)` as today; the `it as` words go) |
| `no-cast`, the value's written form is one of `forms` (a number refused by a number type: too large, or not whole) | `Expected ${forms} that ${receivingType} can hold; got ${valueType}`, as in `Expected a number that pg/int4 can hold; got pg/int8` |

"The value's written form" is `writtenFormPhrase(support, valueType)`; it is "one of `forms`" when it is among the phrases `describeAdmittedForms` joins for the receiving type. A string refused by a type with a tag never has the same form, so the rewrite rule and the range rule do not meet.

`lowerDataTypeDefault` in `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` keeps the `Field "X.y": ` and `Field "X.y" at element n: ` prefixes and words its two own arms:

| Refusal | Message |
| --- | --- |
| `no-list-cast` | `Expected ${forms}; got a list` |
| `no-element-cast` | The `no-cast` rule above, with `forms` the forms of the list cast's element types (as today) and the receiving type the column's: `Expected a number`, or `Expected a number that pgvector/vector can hold; got pg/int8` |

`dataTypeValue` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/data-type-value.ts`) passes its rewrite only when `taggedLiteralTextReadsBack(text)`; the `it as a sql literal` fallback goes, because `Expected sql`...`` already says it.

The Prisma 7 contract source (`packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts`) has its own wording (`@default holds a pg/text value, which pg/jsonb has no cast from; ...`). Leave it unchanged.

## Order of work

1. Commit this brief first.
2. Tests first. Update the expectations in these files to the new messages, run them, see them fail, then change the code: `packages/1-framework/1-core/framework-components/test/written-value.test.ts` (add a case for the same-form rule and one for `unwritable`), `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.data-type-value.test.ts`, `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts`, `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.tagged-literal.test.ts`, `packages/2-sql/2-authoring/contract-psl/test/interpreter.value-object-storage.test.ts`, `test/integration/test/authoring/data-type-value.test.ts`, `test/integration/test/number-defaults/psl-number-defaults.integration.test.ts`. Search for other assertions with `git grep -n "has no cast from\|has no data type for\|write it as" -- 'packages/**/test/**' 'test/**' 'examples/**'`; the `contract-prisma7` tests and fixtures stay as they are.
3. Change the code.
4. Update every document that quotes the old messages, so docs match code: ADR 254 line 179 (the example), ADR 231 section "Values of a data type" (the sentence about what a refusal ends with), `docs/reference/error-reference.md` entry `PSL_VALUE_TYPE_INCOMPATIBLE` (around line 828; `pnpm check:error-reference` checks it), the pending upgrade fragments `upgrade-instructions/pending/arguments-typed-by-data-type/{app,extension}/instructions.md` (the tables and the line-38 example) and `upgrade-instructions/pending/sql-is-a-data-type/{app,extension}/instructions.md` (the list-element example), and `projects/sql-expression-literals/design.md` sections that spell out the messages (search for `has no cast from` and `write it as`). Released fragments under `upgrade-instructions/releases/` are history; leave them. No hard-wrapped Markdown: one paragraph per line.
5. Add a subsection "Slice 2t wording: refusals lead with what to write" to `projects/sql-expression-literals/status.md` with the date 2026-10-06.

## Verify

Logs under `wip/2t-wording/`. In order: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:packages`; then in `test/integration` only `pnpm test test/authoring/data-type-value.test.ts test/number-defaults/psl-number-defaults.integration.test.ts`; after committing, `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`. A test that times out under load usually passes alone: rerun that file once and say so. The three tarball tests fail on a known registry refusal; report, do not fix.

## Rules

Repository rules (`CLAUDE.md`, `.agents/rules/`): no `any`, no bare `as` in production code, no new comments where the code can say it, tests omit "should", no barrel files. Small commits, explicit `git add` (never `git add -A`), `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines in commits. Never amend, rebase, squash or force-push. Do not push and do not open a pull request. If a decision above turns out wrong against the code, stop and write why to `wip/2t-wording/findings.md`.

Report in plain English, short sentences: what changed, each verification result with its log path, anything you could not do.
