# Brief: fix the slice 4 review findings (TML-3290)

You fix the findings of the two reviews of slice 4, on branch `tml-3290-migration-files-template-literals` in the git worktree at the current directory (repository root; read nothing above it). Read `wip/slice-4-brief.md` for the design and rules, then the two reviews: `wip/review-s4/system-design-review.md` (A01 to A04) and `wip/review-s4/code-review.md` (F01 to F06). No `/tmp`; scratch under `wip/`. Run node, pnpm and git through `mise exec --`. The machine is heavily loaded by other work: run only the test files you change, and `pnpm build`, `pnpm typecheck` and `pnpm lint` once at the end; do not run `test:packages`.

## Decisions

Fix every finding as its suggestion says, except where this list says otherwise. Decided; do not reopen.

- **A01 and F01: all three sites are in scope.** Postgres `SetDefaultCall.defaultSql`, SQLite `AddColumnCall`'s column `defaultSql`, and SQLite `RecreateTableCall`'s column `defaultSql` and postcheck `sql` go through `tsQuotedTextSource`; build the SQLite column objects with `tsObjectSource` where a field is already source. Tests first: one exact-output test per site with a both-quote-kinds text, and a JSON default (`'{"a": 1}'::jsonb`) in both adapters' round-trip tests. The doc paragraph then stays true.
- **F02 and F03: control characters and lone surrogates fall back to a string literal.** `tsQuotedTextSource` returns `tsStringLiteral(text)` when the text holds any character below U+0020, U+007F, a lone surrogate, or U+2028/U+2029, in addition to the line-break rule. State the rule in its doc comment. Tests for NUL, a lone surrogate and a tab.
- **A02 and F04:** read `input.using` and `input.withCheck` directly; no key-name comparison and no runtime `typeof`.
- **A03:** move the Migration System paragraph under the planner-IR section next to the two renderers, and make its list of SQL places the same as the list in "Opaque SQL in DDL" (or say it covers "every place that section lists, plus the column-default and check text of `setDefault`, `addColumn` and `recreateTable`").
- **A04:** update the header comment of `json-to-ts-source.ts`.
- **F05:** in one adapter round-trip test, include a text with a backslash, a backtick and `${` and execute the written file, asserting the ops equal `renderOps(calls)`.
- **F06:** nothing to change; the brief's rule stands.

## Rules, verify, commits

As in `wip/slice-4-brief.md`: tests first, repository rules, Markdown never hard-wrapped. Logs under `wip/s4-fixes/`: the changed test files, then `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm migrations:regen:examples` (then `git status --short` empty apart from your work). Never the full integration or e2e suites, and not `test:packages` this round. Small commits, explicit `git add`, `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend or rebase, do not push, no pull request. Report in plain English, short sentences: each finding and what you did, each verification result with its log path, and confirmation that no committed `ops.json` or migration file changed.
