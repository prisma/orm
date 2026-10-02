# Brief: fix the slice 4 round 2 review findings (TML-3290)

You fix the findings of the second review of slice 4, on branch `tml-3290-migration-files-template-literals` in the git worktree at the current directory (repository root; read nothing above it). Read `wip/slice-4-brief.md` and `wip/slice-4-review-fixes-brief.md` for the design, rules and settled decisions, then the two reviews: `wip/review-s4-round-2/system-design-review.md` (B01, B02) and `wip/review-s4-round-2/code-review.md` (G01 to G03). No `/tmp`; scratch under `wip/`. Run node, pnpm and git through `mise exec --`. Run every command that may take more than a few minutes in the background with its output in a log under `wip/s4-round-2/`, and read the log when it finishes. A package-suite run may still be going in this worktree; do not start another.

## Decisions

- **B01 and G01:** each renderer that lists fields by hand (SQLite `renderColumnSpec`, `renderTableSpec`, `renderPostcheck`; the Postgres policy renderer) builds its sources from an object literal typed `{ [K in keyof Spec]-?: string | undefined }` over the input type, then passes the defined entries, in that object's key order, to `tsObjectSource`. A field added to the input type then fails to compile until it has a renderer. Output must stay byte-identical: the existing exact-output tests prove it. Correct the Postgres comment that claims a compile error for drift so it is true again.
- **B02:** split the Migration System sentence into two: one for the `USING` exception and why, one for the added default and postcheck places, naming each factory's target.
- **G02:** `tsStringLiteral` escapes U+007F as `\x7f`, so a DEL never reaches the file raw through either path. Test it.
- **G03:** add the tests: an emoji stays a template literal; a lone low surrogate falls back; the line-break condition of `tsArraySource`.

## Rules, verify, commits

As in the earlier briefs. Logs under `wip/s4-round-2/`: the changed test files, then `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm migrations:regen:examples` (then `git status --short` empty apart from your work). Never the full integration or e2e suites, and no `test:packages`. Small commits, explicit `git add`, `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution, never amend or rebase, do not push, no pull request. Report in plain English, short sentences: each finding and what you did, each verification result with its log path, and confirmation that no committed `ops.json` or migration file changed.
