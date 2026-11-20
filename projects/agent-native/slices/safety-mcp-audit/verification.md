# Verification record — safety-mcp-audit

## Probe verdict (S3-D1, 2026-07-03)

Against the real MCP server (SDK `Client` + `StdioClientTransport` spawning the built CLI,
curated env, offline sqlite scratch project):

- **Agent marker set (`CLAUDECODE=1`), no consent var:** the `migrate-reset` tool result is
  a single text item: execa's `Command failed with exit code 1: <node> <cli> migrate reset
--force` line followed by the checkpoint prompt **verbatim** — agent named ("Claude
  Code"), the stop-and-respond instruction, and the full
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` protocol. No success text; database not
  reset. **Nothing is swallowed — no `runCommand` fix required.**
- **Control (no marker):** `Database reset successful`; no consent text.
- **Bypass (consent var set):** reset proceeds for an agent — the documented consent loop
  works end-to-end through MCP.

Pinned permanently by `packages/cli/src/__tests__/mcp-safety.vitest.ts` (3 cases, DB-free,
fail-clear if the CLI bundle is absent). Commit `e05f5a66c`.

## Description contract (S3-D2)

`migrate-reset` description now ends (captured via `tools/list` against the rebuilt CLI):

> This command is gated by an AI safety checkpoint. When it is invoked by an AI agent
> without explicit user consent, the database is NOT reset; the tool result instead contains
> an error report (beginning with "Command failed with exit code 1: ...") whose text carries
> the consent protocol. If you receive it, you must stop, relay those consent instructions
> to the user, and proceed only as they describe.

Other tool descriptions untouched — `migrate-status`, `migrate-dev`, and `Prisma-Studio`
shell out to commands the checkpoint does not gate. Commit `bb4435f42`.

## Residual caveats (accepted, no action)

- File-based agent markers (e.g. Devin's `/opt/.devin`) are beyond an env allowlist's
  control; the no-marker test case would fail on such a VM. Inherent to real-subprocess
  testing; vanishingly unlikely in CI.
- MCP tool output includes the child CLI's version-update box unless
  `PRISMA_HIDE_UPDATE_MESSAGE=1` — noted in `learnings.md` as a follow-up-ticket candidate
  (MCP output hygiene), out of this slice's scope.
