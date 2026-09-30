# Manual QA report — SQL namespace resolution — 2026-09-28

Script: [manual-qa.md](../manual-qa.md), uncommitted at execution. Runner: delegated slice-close agent (no additional subagents, per operator). Environment: Linux, Node v24.19.0, branch `sql-conversion`, HEAD `2c815e3163f3fc7983df35da7f9867fe87d11ca3`.

Started: 2026-09-28T10:57:14Z. Finished: 2026-09-28T10:58:10Z. Verdict: triage required — script correction required before a fresh run.

## Finding F-1 — Follow-up — invalid color flag in script

All five CLI invocations exited 2 before loading the schema: `[CLI.INVALID_ARGUMENTS] Too many arguments, expected 0 but encountered "never"`. Actual command: `PRISMA_TELEMETRY_DISABLED=1 node "$REPO/packages/1-framework/3-tooling/cli/dist/bin.mjs" contract emit --config ./prisma.config.ts --format human --color never`.

`--help` documents `--color/--no-color`, not a value-taking option. This is a QA-script error, not a product finding. Proposed disposition: fix-in-PR (script only), then start a separate run. All three scenario outcomes and SC-2/SC-3/SC-4 are NOT VERIFIED in this attempt; SC-1 remains N/A. No production changes; scratch retained for the corrected run. Git status remained the existing trace modification and untracked slice directory.

Scratch: `/tmp/sql-conversion-qa.coxmpt`; separate directories per scenario, shared rebuilt checkout read-only. No DB or external service required. Production checkout clean; existing trace and untracked slice artifacts preserved. App-author and extension-author coverage follows the script. Fresh-eyes limitation: same agent resolved the merge and authored/runs this script, as explicitly requested.
