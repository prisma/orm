# System design review, round 2: slice 1 review fixes (TML-3287)

## Scope

Branch `tml-3287-line-comments-in-raw-sql`, range `8bcdab3ad4..HEAD`, seven commits:

- `1fe550b2c3` SQLite `migration.ts` renderer reads `.text` for a function default
- `d544fe53f8` SQLite adapter test asserts the whole `CREATE TABLE`
- `f99364d954` Postgres line-comment test reads the driver through `requireDriver`
- `78f1d5b310` Postgres target exports `CreateIndexElements` from `./ddl`
- `b9c906b7a2` doc comments of `normalizeSqlBody` and `DdlIndexElements`
- `267b854af4` Migration System doc and ADR 234
- `0f6a6d85a1` upgrade fragments (new `app`, revised `extension`)

Read at HEAD: the fixes brief, the round 1 reports, ADR 234, the "Opaque SQL in DDL" section of the Migration System doc, `naming.ts`, `ddl/nodes.ts`, `exports/ddl.ts`, `opaque-sql.ts`, `default-sql-body.ts`, both `planner-ddl-builders.ts`, the Postgres policy authoring and hash code (`core/authoring.ts`, `core/rls/canonicalize.ts`), both upgrade fragments, and the audience table in `skills-contrib/record-upgrade-instructions/SKILL.md`.

## Round 1 findings against the decisions

| Finding | Decision | Result | Commit |
| --- | --- | --- | --- |
| A01 | Defer; one sentence in the doc | Fixed as decided. The doc says the four sites wrap a string on the spot and that turning them into nodes is future work. No enforcement added. | `267b854af4` |
| A02 | Keep the ban on `--` in defaults; say why | Fixed as decided, using the function's real name `checkSqlDefaultBody`. See B03 for a mismatch with the code's own stated reason. | `267b854af4` |
| A03 | Correct ADR 234 line 162 and the `normalizeSqlBody` comment; end-state style with "(Amended: …)" | Fixed as decided. Line 162 now says only names whose normalized body changes get a new suffix. The rule is stated in the present tense with an "(**Amended:** …)" note like line 156. The doc comment matches. | `267b854af4`, `b9c906b7a2` |
| A04 | New `app` fragment with the wire-name change; extension keeps the node change | Fixed as decided in structure. The content repeats a false claim from my round 1 finding (B01) and says "renames" where the planner recreates (B02). | `0f6a6d85a1` |
| A05 | Export `CreateIndexElements`; list `DdlIndexElements` and the export in the fragment | Fixed as decided. | `78f1d5b310`, `0f6a6d85a1` |
| A06 | "opaque SQL", not "contract SQL" | Fixed as decided in the doc, the ADR and the test. No "contract SQL" remains in `packages`, `docs` or `upgrade-instructions`. | `267b854af4`, `f99364d954` |
| A07 | `OpaqueSql` is a value, not a node | Fixed as decided in the doc and the extension fragment. | `267b854af4`, `0f6a6d85a1` |
| A08 | Cite ADR 244 for the term, one source | Fixed as decided. `DdlIndexElements` now points at `OpaqueSql`, whose doc cites ADR 244. The doc section and ADR 234 cite ADR 244. | `b9c906b7a2`, `267b854af4` |

Boundaries are unchanged by the fixes. The one new export (`CreateIndexElements`) is a type on an existing entry point. The SQLite renderer fix restores the rule that migration files are plain data built from strings.

## New findings

### B01

- Location: upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md lines 5 and 21
- Issue: The fragment says a policy's stored `using` or `withCheck` body in `contract.json` changes, and that the old stored body had its line breaks collapsed so everything after the first `--` was comment. Both claims are false at HEAD and at the slice base. `createPostgresRlsPolicy` in packages/3-targets/3-targets/postgres/src/core/authoring.ts lines 262 to 284 normalizes the body only to compute the hash; it stores `input.using` and `input.withCheck` as written. So only the name changes. The error comes from my round 1 finding A04, which misread lines 265 to 268; the brief carried it forward. An app author following the fragment would look for a body change that never happens, and would be told their old policy was broken when it was not.
- Suggestion: Drop the second bullet and the "a policy's stored `using` or `withCheck` body changes with it" clause from the summary. Say only that the stored name of the index, check or policy changes. The detection pattern still works, because the stored body keeps its `\n`.

### B02

- Location: upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md lines 5 and 23; docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md line 168 (the "Amended" note)
- Issue: Both texts say the next `migration plan` "renames or recreates" the object. Under ADR 234's own rule (line 115), the planner renames only when two names share the hash suffix and differ in prefix. Here the suffix changes and the prefix stays, so the planner drops and recreates the object. It never renames. The texts contradict the ADR they sit in.
- Suggestion: Say "drops and recreates" in both places. For the app fragment, add that a dropped and recreated index is rebuilt, which can take time on a large table.

### B03

- Location: docs/architecture docs/subsystems/7. Migration System.md line 393; packages/2-sql/1-core/contract/src/default-sql-body.ts lines 3 to 8; packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts lines 31 to 36 (the SQLite file has the same comment)
- Issue: The doc now gives one reason for banning `--` in defaults: `contract infer` compares a default as text. The code gives another: the `assertSafeDefaultExpression` doc comment calls the ban a sanity check against SQL injection from malformed contracts, and both error messages list "SQL comment tokens" among unsafe tokens. A reader who checks the code finds a reason the doc does not mention, and the reason the doc gives appears nowhere in the code.
- Suggestion: Make the two agree. The smallest change is in the doc: "Column defaults refuse `--` … as a sanity check against malformed contracts, and because `contract infer` also compares a default as text." No code change needed.

### B04

- Location: docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md line 166
- Issue: The summary in parentheses says the normalizer keeps "line breaks only where a line comment needs them". The rule at line 168 keeps every non-blank line break in any body that contains `--`, whether or not a given break ends a comment. The summary describes a narrower rule than the code runs. This sentence was written in round 1, not in the fixes, but it sits in the section A03 asked to make consistent.
- Suggestion: Say "keeping the line breaks of a body that contains `--`".

## What I checked and found sound

- ADR 234 now reads as the end state, and its amendment follows the style of the existing one at line 156.
- The `normalizeSqlBody` doc comment matches the code and the ADR.
- The extension fragment's type table, its new `createIndex` paragraph, and the package path `@internal/target-postgres/ddl` match `exports/ddl.ts` and `package.json`.
- The app fragment's audience matches the skill's table (contract files and on-disk migrations belong to `app`), and its detection pattern matches a JSON-escaped line break next to `--`.
- `OpaqueSql` has one documented source for its term (ADR 244), and nothing calls it a node.
- The SQLite renderer fix is the only remaining place where a node field reached a function that accepts any value; the `.text` reads elsewhere are comparisons or TypeScript rendering.

## Count

Four findings. B01 and B02 are factual errors in text users will act on. B03 and B04 are small wording mismatches.
