# System design review: slice 1, line comments in raw SQL are safe (TML-3287)

## Scope and range

Branch `tml-3287-line-comments-in-raw-sql`, range `origin/main..HEAD` = `8aef1b77be..8bcdab3ad4`, five commits:

- `979f6ac56e` relational-core: `OpaqueSql` and `renderOpaqueSql`
- `70381ffae2` schema-ir: `normalizeSqlBody` keeps line breaks in bodies with `--`
- `d59da23e06` DDL nodes hold `OpaqueSql`; adapters and planners render through `renderOpaqueSql`
- `444e4ed04c` test for the `ALTER COLUMN TYPE … USING` site
- `8bcdab3ad4` ADR 234, Migration System doc, upgrade fragment

Read at HEAD: the brief (`wip/slice-1-brief.md`), ADR 234, ADR 244, the Migration System doc, every changed source file, the callers of `normalizeSqlBody` and `checkSqlDefaultBody`, and `upgrade-instructions` conventions in `skills-contrib/record-upgrade-instructions/SKILL.md`.

## What the slice solves and the invariant it adds

The planners paste SQL that Prisma does not parse (checks, policy predicates, index element lists and predicates, function defaults, a hand-written `USING` conversion) inside a larger statement. A `--` comment on the last line of that text commented out the rest of the statement, usually the closing parenthesis. The slice ends such text with a line break when it contains `--`.

It adds two rules:

1. Every site that places opaque SQL inside a statement renders it through `renderOpaqueSql`.
2. The wire-name normalizer keeps line breaks in a body that contains `--`, so two bodies that differ only in where a comment ends get different names.

Both rules are byte-identical to today for text without `--`, so no committed `ops.json`, migration hash or wire name changes.

## Subsystem fit and boundary correctness

- `OpaqueSql` sits in `@internal/sql-relational-core/ast` next to the DDL types that hold it. Both targets and both adapters already depend on that package. No new package edge. Direction is correct: lanes (relational-core) → targets → adapters.
- The normalizer change stays in `@internal/sql-schema-ir/naming` (core). It gains no dependency.
- The contract IR and schema IR keep strings. That matches the design: the typed wrapper exists only where text is placed into a statement. Contract-free factories (`fn`, `checkExpression`, `createPolicy`, `createIndex`) keep a string surface for migration authors. This is the right boundary: migration files stay plain data, the node layer carries the rendering rule.
- The Postgres policy path normalizes the body at authoring time (`postgres/src/core/authoring.ts` lines 265 to 268) and stores the result in the contract. So for policies the rule change also changes the stored body in `contract.json`, not only the name. The slice handles this correctly in code; the upgrade text does not say it (see A04).
- The rule in the renderer and the rule in the normalizer both test `includes('--')`. They live in different layers and serve different purposes (valid output versus identity). Both are deliberately conservative: `--` inside a string constant also triggers them, which costs a harmless line break or keeps line breaks that did not matter. I checked this and see no reason to share one predicate.

## Naming and typology

- `OpaqueSql`, `opaqueSql`, `renderOpaqueSql` use the term ADR 244 already defines ("opaque"). Good ubiquitous language.
- `OpaqueSql` is a frozen value class without `kind`, visitor or `DdlNode` brand. That is the right shape for what it is. The docs call it a "node", which it is not in this codebase's typology (A07).
- The invariant is phrased as "contract SQL", but two of its sites carry SQL a migration author wrote, not contract SQL (A06).
- `CreateIndexElements` (strings, what a migration file writes) and `DdlIndexElements` (`OpaqueSql`, what the node holds) now sit side by side in `ddl/nodes.ts`. The move follows the design. The public export surface was not updated to match (A05).

## Doc and ADR review

- Migration System doc, new section "Opaque SQL in DDL": clear, names the node fields, the rule, the template-string sites and the data-transform exception. Two wording issues (A06, A07).
- ADR 234, "Normalizer stability": the new paragraph explains the rule well, but the section now contradicts itself and reads as a change log (A03). The same contradiction is in the `normalizeSqlBody` doc comment.
- ADR 244 needs no change: it defers normalization to ADR 234.
- Upgrade fragment: the wire-name entry is filed under the wrong audience (A04), and one changed exported type is missing (A05).

## Test strategy at the architectural level

- The rule has a unit test at its source (`opaque-sql.test.ts`) and an execution test against PGlite for five of the Postgres node sites. That is the right level: it proves the database accepts the output, not only that a string matches.
- The normalizer tests pin the old hash table and prove the E1/E2 split for check, index and policy hashes. Good.
- The two `buildColumnDefaultSql` sites have no line-comment test, and cannot have one, because both run `assertSafeDefaultExpression` first, which rejects `--` (A02).
- Nothing checks the invariant itself. The node-field sites are protected by the type system only in the sense that the field is no longer a string; the four template-string sites and any future one depend on the author remembering (A01).

## Findings

### A01

- Location: packages/3-targets/3-targets/postgres/src/core/migrations/operations/constraints.ts line 158; packages/3-targets/3-targets/postgres/src/core/migrations/operations/columns.ts line 80; packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts line 169; packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts line 82; docs/architecture docs/subsystems/7. Migration System.md line 389
- Issue: The invariant "every site renders through `renderOpaqueSql`" is only asserted in prose. For node fields, the `OpaqueSql` type makes a direct interpolation produce `[object Object]`, which a test would likely catch, but `${node.where.text}` compiles and is wrong. The four template-string sites take plain strings and wrap them only to render; a fifth such site written tomorrow has nothing pushing it to wrap. The invariant is visible (the doc lists the sites) but not enforceable.
- Suggestion: Record the conversion of the four template-string sites to DDL nodes as follow-up work in the project's `deferred.md`, so the only way to place opaque SQL is a node field. Until then, keep the site list in the Migration System doc as the single place a reader checks. No lint rule is worth adding for four sites.

### A02

- Location: packages/2-sql/1-core/contract/src/default-sql-body.ts line 1; packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts lines 168 to 169; packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts lines 81 to 82; docs/architecture docs/subsystems/7. Migration System.md line 391
- Issue: Column defaults and the other opaque places now follow two different rules. Checks, index bodies and policy predicates may contain `--`, and the renderer makes that safe. Defaults reject `--` at authoring (`checkSqlDefaultBody`, used by contract-psl and contract-ts) and again in `assertSafeDefaultExpression`. So the `renderOpaqueSql(opaqueSql(...))` wrap in both `buildColumnDefaultSql` functions never changes its input, and the doc lists them as sites without saying so. The ban's stated reason, "SQL comment tokens", is now half obsolete for line comments.
- Suggestion: Defer the decision to the slice that makes raw SQL a `sql` literal in every place (TML-3288): either drop `--` from `UNSAFE_DEFAULT_BODY` so defaults follow the same rule, or keep the ban and say why. In this slice, add one sentence to the Migration System doc: defaults reject `--` at authoring, so the wrap at those two sites is for uniformity.

### A03

- Location: docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md lines 162 and 168; packages/2-sql/1-core/schema-ir/src/naming.ts lines 111 to 127
- Issue: Line 162 still says a normalizer change "changes the suffix of every existing wire name". The new paragraph at line 168 describes a change that re-suffixes only bodies with both `--` and a line break. The `normalizeSqlBody` doc comment has the same contradiction ("any change re-suffixes all wire names") and its first paragraph still summarizes the rule as trim plus whitespace collapse. The ADR paragraph also opens as history ("One change to the normalizer has shipped", "when the rule shipped"), while ADR 234 records its other amendments with an "(**Amended:** …)" marker and describes the end state.
- Suggestion: Reword line 162 to say a normalizer change re-suffixes every name whose normalized body changes, which the storage hash then signals. State the line-comment rule as part of the normalizer's definition, in the present tense, and put the "no committed name changed" note in an "(**Amended:** …)" parenthesis like the ADR's other amendments. Apply the same fix to the first and last paragraphs of the `normalizeSqlBody` doc comment.

### A04

- Location: upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md lines 10 to 12 and 46 to 51
- Issue: The entry `sql-with-a-line-comment-gets-a-new-wire-name` concerns contract files and migrations, which the upgrade skill assigns to the `app` audience. It sits only in the `extension` fragment, so app authors reading the published app guide will not see it. It also says only that the name changes. For RLS policies, authoring stores the normalized body in `contract.json`, so the stored `using` or `withCheck` body changes too.
- Suggestion: Move this entry to `upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md`. Say that for a policy the stored predicate in `contract.json` also changes, and that the old stored body had its line break collapsed, so the rest of the predicate after `--` was commented out. Keep `ddl-nodes-hold-opaque-sql` in the extension fragment.

### A05

- Location: packages/3-targets/3-targets/postgres/src/exports/ddl.ts line 6; packages/3-targets/3-targets/postgres/src/core/ddl/nodes.ts lines 291 to 306; packages/3-targets/3-targets/postgres/src/contract-free/ddl.ts line 178; upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md lines 22 to 28
- Issue: `DdlIndexElements` is exported from the target's `./ddl` entry point and its `expression` arm changed from `string` to `OpaqueSql`. Before the slice, the contract-free `createIndex` took `DdlIndexElements`; now it takes `CreateIndexElements`, which is not exported. A consumer that typed its elements as `DdlIndexElements` gets a type error and has no exported type to switch to. The fragment's table lists the node field but not the exported type.
- Suggestion: Export `CreateIndexElements` from `src/exports/ddl.ts` next to `DdlIndexElements`. Add a row to the fragment: `DdlIndexElements` now holds `OpaqueSql`; code that passes elements to `createIndex` uses `CreateIndexElements`.

### A06

- Location: docs/architecture docs/subsystems/7. Migration System.md lines 385 and 389; wip/slice-1-brief.md section 14.1 (design wording carried into the doc)
- Issue: The doc calls the text "contract SQL" and states the invariant for "every site that places contract SQL inside a statement". Two sites carry SQL a migration author wrote, not contract SQL: the `USING` of `alterColumnType`, and any `fn(...)`, `checkExpression(...)`, `createPolicy(...)` or `createIndex(...)` written by hand in `migration.ts`. A reader applying the invariant literally would skip those.
- Suggestion: Use "opaque SQL" for the whole class, as the section title and ADR 244 do: "Some SQL is opaque to Prisma: text it does not parse, from the contract or from a migration file …", and "every site that places opaque SQL inside a statement renders it through `renderOpaqueSql`".

### A07

- Location: docs/architecture docs/subsystems/7. Migration System.md line 387; upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md line 19
- Issue: Both texts call `OpaqueSql` a "node". In this codebase a node has a `kind` discriminant and belongs to an AST hierarchy; the "Serialization" section directly below says so. `OpaqueSql` has no `kind`, no visitor and no `DdlNode` brand, which is correct for a wrapper value held by nodes. Calling it a node invites someone to add a `kind` or a serializer it does not need.
- Suggestion: Call it "an `OpaqueSql` value" in both places. No code change.

### A08

- Location: packages/3-targets/3-targets/postgres/src/core/ddl/nodes.ts lines 299 to 303
- Issue: The `DdlIndexElements` doc cites ADR 234 for "the same opaque-SQL stance", while `OpaqueSql`'s own doc cites ADR 244, which is where the term is defined. Two sources for one concept.
- Suggestion: Point the `DdlIndexElements` doc at `OpaqueSql` (or ADR 244) and drop the ADR 234 reference, so the concept has one source.

## What I checked and found sound

- Dependency direction and package placement of `OpaqueSql` and the normalizer change.
- That every node-field placement in both adapters (`DEFAULT`, `CHECK`, `USING`, `WITH CHECK`, index element list, index `WHERE`) goes through `renderOpaqueSql`, and that the remaining `.text` reads are comparisons (`autoincrement()`, `now()`) or TypeScript source rendering, not SQL placement.
- That `SET DEFAULT` reaches SQL only through `buildColumnDefaultSql`, so it is covered by that site.
- That SQLite rejects check-expression constraints and expression or partial indexes before rendering, so it has no further sites.
- That `RawExpr` and `RawQueryAst` in the query AST are a different concept (query-time templates with parameters, rendered by the query renderer) and are rightly out of scope.
- That the data-transform `EXISTS` wrapper takes a lowered query, not opaque text.
- That the normalizer is idempotent on its own output, which the policy double-normalization needs, and that the pinned hash table is unchanged.
