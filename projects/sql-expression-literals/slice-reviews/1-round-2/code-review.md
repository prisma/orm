# Code review, round 2: slice 1 fixes, line comments in raw SQL are safe (TML-3287)

Branch `tml-3287-line-comments-in-raw-sql`, range `8bcdab3ad4..HEAD` (7 commits, 1fe550b2c3 to 0f6a6d85a1). Reviewer lens: principal engineer, failure modes first. Decisions checked against `wip/slice-1-review-fixes-brief.md`.

## Summary

The fixes are correct and small. The F01 regression is fixed, a test proves it (red log `wip/s1-fixes/f01-red.log` shows `fn({ text: "datetime('now')" })`), and a sweep of both targets and both adapters finds no other place where an `OpaqueSql` field reaches `jsonToTsSource`, `JSON.stringify`, `String(` or a template string. The SQLite line-comment test now asserts the whole statement. Every decision in the brief is followed.

One user-facing claim is wrong. The new `app` upgrade fragment says a policy's stored `using` or `withCheck` body in `contract.json` changes and that the old stored body had its line breaks collapsed. Policy authoring stores the body verbatim; only the hash input is normalized. The claim came from round 1 (A04) and was carried into the brief, so the implementer followed the decision, but the decision rests on a false fact. The app detection pattern also misses bodies where an escaped quote sits between `--` and the line break. The other findings are small doc accuracy issues.

## What looks solid

- F01: `renderDdlColumnDefault` in the SQLite target reads `.text`, the same as the Postgres renderer (`op-factory-call.ts` line 73; Postgres lines 170 and 202). The new test renders a whole `createTable` call through `renderCallsToTypeScript` and asserts the full line with `fn("datetime('now')")`. I ran it: 6 of 6 pass (`wip/review-s1-round-2/t-sqlite-render.log`).
- Sweep for other unknown-typed sinks. Every read of `.expression`, `.using`, `.withCheck`, `.where` and `.elements` in `packages/3-targets/3-targets/{postgres,sqlite}/src` and `packages/3-targets/6-adapters/{postgres,sqlite}/src` is either `.text`, a `renderOpaqueSql` call, or a read of a plain `string` field on a contract entity or an op-factory call (`AddCheckConstraintCall.expression`, `CreateIndexCall.expression` and `.where`, `PostgresRlsPolicy.using`). Only 12 source files use the four node types, and none serializes a node generically.
- F06: `lower-to-execute-request.test.ts` asserts `'CREATE TABLE "t" (\n  "n" INTEGER DEFAULT (1 -- c\n)\n)'` with `toBe` and empty params. Anything added after the closing parenthesis now fails it. I ran it: 20 of 20 pass.
- F07: `requireDriver()` replaces every `driver!`.
- A05: `CreateIndexElements` is exported from `src/exports/ddl.ts`; the fragment table gains a `DdlIndexElements` row.
- A03 and F05: ADR 234 line 162 and the `normalizeSqlBody` doc comment now say a change re-suffixes only names whose normalized body changes. The ADR paragraph is written as the end state, with the history in an "(**Amended:** …)" parenthesis like line 156.
- A06, A07, A08: no "contract SQL" and no "`OpaqueSql` node" remain in `packages`, `docs` or `upgrade-instructions`. The Migration System doc and the `OpaqueSql` doc comment cite ADR 244; the `DdlIndexElements` comment no longer cites ADR 234. The ADR 244 link resolves.
- F02 and F04: the extension fragment says plainly that template strings and functions that accept any value are not reported. The pattern accepts a namespace qualifier; `wip/s1-fixes/detect.log` shows it against the round 1 cases.
- The shipped app pattern matches none of the 399 committed `contract.json` files (`wip/review-s1-round-2/scan-contracts.mjs`), which agrees with "no committed wire name changed".
- No `.json` file changed in the range. Commits carry both sign-offs and no AI attribution. The implementer's verification logs are green apart from the three known tarball tests and two timeouts that pass on rerun (`wip/s1-fixes/rerun-*.log`).

## Findings

### G01 — App fragment says a policy's stored body changes; it does not (Medium)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md, summary and the second bullet ("for a policy, the stored `using` or `withCheck` body in `contract.json`. The old stored body had its line breaks collapsed into spaces …")

Issue: `buildRlsPolicyEntity` (packages/3-targets/3-targets/postgres/src/core/authoring.ts lines 264 to 283) normalizes `using` and `withCheck` only to compute the hash, then stores `input.using` and `input.withCheck` unchanged. The `@@map` path (lines 318 to 327) and the TypeScript path (lines 1061 to 1069) also pass the raw text. `PostgresRlsPolicy` stores what it is given (postgres-rls-policy.ts lines 72 to 73). So the stored policy body never had its line breaks collapsed, and re-emitting does not change it. Only the policy name changes. An app author reading the fragment will look for a body change that never appears, and may think the old policy was broken in the database when it was not. The claim came from A04 in round 1 and was carried into the brief.

Suggestion: drop the second bullet and the "a policy's stored `using` or `withCheck` body changes with it" clause of the summary. The fragment then says: the stored index, check or policy name in `contract.json` changes once, and the next `migration plan` renames or recreates the object. Tell the operator the brief's premise was wrong, so the decision record is corrected too.

### G02 — App detection misses bodies with a quoted identifier between `--` and the line break (Low)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/app/instructions.md, frontmatter `matches`

Issue: `[^"]*` stops at the `"` of an escaped quote `\"`. Postgres policy and index bodies often quote identifiers, as the parity fixture does (`"\"userId\"::uuid = auth.uid()"`). I tested bodies by writing them through `JSON.stringify` (`wip/review-s1-round-2/detect-probe.mjs`):

| Body | Name changes | Shipped pattern |
| --- | --- | --- |
| `"userId"::uuid = auth.uid() -- owner` + line break + `AND true` | yes | matches |
| `a -- note about "b"` + line break + `c` | yes | misses |
| `a` + line break + `"b" -- c` | yes | misses |
| `a -- c` + trailing line break only | no | matches |
| `a -- "c"` | no | no match |

The last-but-one row is a harmless false positive: a body whose only line break is leading or trailing normalizes as before. The prose "contains both `--` and a line break" has the same small over-reach.

Suggestion: use an escape-aware pattern. It matched all three true cases above and not the no-break case:

```yaml
matches:
  - '"(?:[^"\\]|\\.)*?--(?:[^"\\]|\\.)*?\\n|"(?:[^"\\]|\\.)*?\\n(?:[^"\\]|\\.)*?--'
```

Optionally say "a line break between two non-blank lines".

### G03 — The stated reason for the default ban names the wrong command (Low)

Location: docs/architecture docs/subsystems/7. Migration System.md line 393

Issue: The doc says defaults refuse `--` "because `contract infer` also compares a default as text". The text comparison of a function default is `resolvedDefaultsEqual` (packages/2-sql/1-core/schema-ir/src/ir/resolved-default-equality.ts lines 34 to 44), which the schema diff uses when it plans and verifies. It lowercases and removes all whitespace, so a line comment would swallow the rest of the default in the comparison. `contract infer` prints a default into PSL; it does not compare it. The code's own comment on `assertSafeDefaultExpression` (planner-ddl-builders.ts lines 31 to 35) gives a third reason: a sanity check against injection from a malformed contract. The name `checkSqlDefaultBody` is correct; the brief's `checkSqlDefaultText` does not exist, and the implementer rightly used the real name.

Suggestion: say the schema diff compares a function default as text with whitespace removed, so a comment would change what is compared. Keep the sentence about the two `buildColumnDefaultSql` sites.

### G04 — Extension fragment points to factories an extension cannot import (Low)

Location: upgrade-instructions/pending/line-comments-in-raw-sql/extension/instructions.md, the paragraphs "The factories `fn`, `checkExpression`, and the Postgres contract-free `createPolicy` and `createIndex` …" and "`createIndex` now takes its element list as `CreateIndexElements` …"

Issue: The contract-free `createPolicy` and `createIndex` (packages/3-targets/3-targets/postgres/src/contract-free/ddl.ts) are not exported from any entry point of `@internal/target-postgres`. `src/exports/contract-free.ts` exports only `addColumnAction`, `alterTable`, `createSchema`, `createTable` and `dropDefaultAction`; this is the same on `origin/main`. An extension author cannot follow "prefer them" or type arguments for a function they cannot import. The reachable string-taking APIs are the `PostgresMigration` methods `this.createIndex(...)` and `this.createRlsPolicy(...)`. Exporting `CreateIndexElements` is harmless, but the sentence that justifies it describes a call no outside code can make.

Suggestion: name the reachable factories only (`fn` and `checkExpression` from `@internal/sql-relational-core/contract-free`, and the migration methods), and reduce the `CreateIndexElements` sentence to "the string form of the element list is exported as `CreateIndexElements`".

### G05 — ADR 234 still says line breaks are kept "only where a line comment needs them" (Low)

Location: docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md line 166

Issue: The normalizer keeps every line break between non-blank lines of any body that contains `--`, including a body whose `--` sits inside a string constant (`normalizeSqlBody`, naming.ts lines 127 to 134). "Only where a line comment needs them" suggests a finer rule than the code has, and contradicts the precise paragraph two lines below.

Suggestion: "keeping the line breaks of a body that contains `--`".

## Deferred

- No test plans a SQLite migration with a function default and then typechecks or runs the written `migration.ts`. The renderer unit test covers the defect that shipped; an end-to-end journey is broader than this slice. The implementer found no such SQLite journey.
- `jsonToTsSource(value: unknown)` still accepts any object. A narrower signature would catch the F01 class of bug at compile time, but it is a framework change outside this slice (same as round 1).
- A01 enforcement: none, by decision. The four template-string sites are named in the doc.
- The A01 entry in the project's deferred list is the coordinator's job and lives outside this worktree, so I did not check it.

## Already addressed

| Round 1 item | Fixing commit | Matches the decision |
| --- | --- | --- |
| A01 | 267b854af4 | Yes: one sentence in "Opaque SQL in DDL", no enforcement |
| A02 | 267b854af4 | Yes on structure; the reason given is inaccurate (G03) |
| A03 | 267b854af4, b9c906b7a2 | Yes |
| A04 | 0f6a6d85a1 | Yes as decided; the decided policy-body sentence is false (G01) |
| A05 | 78f1d5b310, 0f6a6d85a1 | Yes |
| A06 | 267b854af4, 0f6a6d85a1 | Yes |
| A07 | 267b854af4, 0f6a6d85a1 | Yes |
| A08 | b9c906b7a2 | Yes |
| F01 | 1fe550b2c3 | Yes: test first, `.text`, sweep found no other site |
| F02 | 0f6a6d85a1 | Yes |
| F03 | 0f6a6d85a1 | Yes: `app` fragment added, extension copy dropped |
| F04 | 0f6a6d85a1 | Yes |
| F05 | b9c906b7a2 | Yes |
| F06 | d544fe53f8 | Yes |
| F07 | f99364d954 | Yes |

## Acceptance-criteria verification

| Item | Verdict | What I read |
| --- | --- | --- |
| Round 1 WEAK, F06: SQLite `fn('1 -- c')` asserts the whole statement | PASS | `toBe` on full SQL plus `params`; ran file, 20 passed |
| Round 1 FAIL, F01: readers of the fields use `.text` | PASS | SQLite line 73; sweep of both targets and adapters found no other unknown-typed sink |
| Round 1 WEAK: extension fragment `ddl-nodes-hold-opaque-sql` | WEAK | compiler claim and pattern fixed; points to unexported factories (G04) |
| Round 1 WEAK: wire-name change filed for the `app` audience | PASS | `app/instructions.md` exists; extension copy removed |
| App fragment: policy stored body changes | FAIL | authoring.ts stores the body verbatim (G01) |
| App fragment: detection over `contract.json` | WEAK | right glob, zero hits on 399 committed contracts; misses escaped-quote cases (G02) |
| F01 decision: test fails at the old HEAD | PASS | `wip/s1-fixes/f01-red.log` shows `fn({ text: … })` |
| F01 decision: sweep of renderers in both targets | PASS | my own grep, see "What looks solid" |
| A01 decision: sentence in "Opaque SQL in DDL" | PASS | Migration System doc line 391 |
| A01 decision: follow-up recorded in the deferred list | NOT VERIFIED | coordinator's file, outside this worktree |
| A02 decision: ban kept, both check names, uniformity sentence | PASS | doc line 393; `checkSqlDefaultBody` exists |
| A02 decision: reason for the ban | WEAK | names `contract infer`; the comparison is in the schema diff (G03) |
| A03 and F05: no "every wire name" claim in ADR or doc comment | PASS | ADR line 162; naming.ts lines 111 and 125 |
| A03: ADR paragraph in end state with "(**Amended:** …)" | PASS | ADR line 168 |
| A05: `CreateIndexElements` exported; fragment row | PASS | exports/ddl.ts line 6; fragment table |
| A06: "opaque SQL", not "contract SQL" | PASS | grep over packages, docs, upgrade-instructions |
| A07: `OpaqueSql` called a value | PASS | same grep |
| A08: ADR 244 as the one source | PASS | nodes.ts `DdlIndexElements` comment; opaque-sql.ts comment |
| F02: fragment names unreported sinks | PASS | extension fragment paragraph |
| F04: qualified construction detected | PASS | pattern; `wip/s1-fixes/detect.log` |
| F07: no `driver!` | PASS | integration test diff |
| No committed `ops.json`, `migration.json`, contract or wire name changed | PASS | no `.json` in the range; clean `git status`; `wip/s1-fixes/fixtures-check.log` |
| Verification logs per the brief | PASS | `wip/s1-fixes/*.log`; known tarball failures; timeouts green on rerun |
| Commits: two sign-offs, no AI attribution | PASS | `git log` trailers |

## Counts

| Severity | Count |
| --- | --- |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Total | 5 |

| Verdict | Count |
| --- | --- |
| PASS | 19 |
| WEAK | 3 |
| FAIL | 1 |
| NOT VERIFIED | 1 |
