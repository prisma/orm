# Learnings — agent-native

Working ledger of patterns surfaced during this run. Reviewed at close-out; cross-cutting
lessons migrate to durable docs, project-local ones drop with the project folder.

- **2026-07-03 (D1):** A fresh git worktree of this monorepo cannot typecheck `packages/cli`
  until workspace dependencies are built — run `pnpm install` then
  `pnpm exec turbo build --filter='prisma^...'` (~4 min) before any `tsc` gate. Dispatch
  time-boxes for fresh worktrees must budget for this; resumed dispatches in the same
  worktree inherit the built state. Candidate for `drive/plan/README.md` (validation-gate
  overlay) at close-out.
- **2026-07-03 (D1):** The upstream `skills` CLI is `skills` on npm (vercel-labs/skills),
  v1.5.14 at pin time — the version literal lives in
  `packages/cli/src/init/skill-install.ts` as `SKILLS_CLI_VERSION`.
- **2026-07-03 (S2-D2):** `packages/cli` Jest suites with DB-touching subprocess tests
  (e.g. `commands/Generate.test.ts`) fail on bare `pnpm exec jest <file>` with
  "Cannot resolve environment variable: TEST_MYSQL_URI" — invoke via
  `pnpm exec dotenv -e ../../.db.env -- jest <file>` (what the package `test` script does).
  Candidate for `drive/plan/README.md` validation-gate overlay at close-out.
- **2026-07-03 (S3-D1):** `prisma mcp` tool output includes the CLI's version-update box
  (the shelled-out child runs its update check inside the tool result; suppressible with
  `PRISMA_HIDE_UPDATE_MESSAGE=1`). Out of scope for the safety audit — candidate follow-up
  ticket at close-out (MCP output hygiene). Also: execa v5's error message prefixes child
  stderr with "Command failed with exit code 1: <command>", which is what an MCP client
  sees before the consent text.
- **2026-07-04 (S4-D1):** prisma-engines' psl expect-tests embed ANSI color codes in their
  snapshots; a non-TTY `cargo test -p psl` run fails hundreds of them spuriously. CI sets
  `CLICOLOR_FORCE=1` (only documented in the workflow YAML) — set it for local runs.
  Candidate for the engines-side notes in `drive/plan/README.md` at close-out.
- **2026-07-06 (S3 Windows fix):** the MCP SDK's `StdioClientTransport.close()` aborts the
  child and returns without awaiting its exit (and clears its process reference before the
  `close` event fires). Tests that spawn stdio servers and then remove their temp dirs must
  chain `transport.onclose` (bounded by an unref'd grace timer) before cleanup, plus
  `rmSync(..., { maxRetries, retryDelay })` — Windows locks in-use files where POSIX
  unlinks them. Any future test needing the child's exit code requires the same
  `onclose`-chaining trick.
