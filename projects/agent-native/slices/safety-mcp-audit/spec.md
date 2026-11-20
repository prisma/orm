# Slice: safety-mcp-audit

_(Parent project `projects/agent-native/`. Outcome: the AI safety checkpoint's behavior
through `prisma mcp` is verified, pinned by a test, and documented in the tool description —
project-DoD condition 3's second half.)_

## At a glance

`prisma mcp` exposes a `migrate-reset` tool that shells out to `migrate reset --force`; when
the MCP server was launched by an agent, the agent's env markers inherit into that child, so
the checkpoint (`packages/migrate/src/utils/ai-safety.ts`, refreshed by #29684) fires inside
the tool call. This slice proves the consent instructions actually reach the MCP client
intact, pins it with a test, and updates the tool description to mention the consent
protocol.

## Chosen design

- **Probe first (retro rule):** the slice opens by empirically driving the real MCP server —
  `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` spawning the built CLI
  (`packages/cli/build/index.js mcp`) with a curated env carrying exactly one agent marker
  (e.g. `CLAUDECODE=1`) — calling `migrate-reset` against a minimal scratch sqlite project,
  and capturing what the tool result actually contains today. The checkpoint throws before
  any DB work, so the scenario is hermetic and offline.
- **In-process testing is off the table by construction:** `runCommand` in
  `packages/cli/src/mcp/MCP.ts` re-invokes `process.argv[1]` via `execa.node`, which under a
  test runner is the runner's own binary — the test must subprocess the real CLI.
- **The pin:** a new vitest file in `packages/cli` encoding the probe as a permanent test:
  tool result must contain the checkpoint's identifying content — at minimum the
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` variable name and the "must stop and respond
  to the user" instruction — and must not report success. A companion case with no agent
  markers in the curated env asserts the checkpoint does not fire (reset proceeds or fails
  on ordinary grounds, but no consent text).
- **If the probe shows the consent text does NOT reach the client** (e.g. `runCommand`
  swallows the child's stderr or returns a generic failure), fixing that surfacing inside
  `MCP.ts`'s `runCommand` is **in scope** — it is the slice's purpose. The fix stays within
  MCP.ts's error propagation; anything touching the checkpoint itself is out of scope.
- **Description update:** the `migrate-reset` tool description in `MCP.ts` gains a sentence
  telling agents the command is gated for AI agents and that the error text contains the
  consent protocol to relay to the user.

## Coherence rationale

One reviewable unit: an integration test, at most a bounded error-propagation fix in one
function, and a description string — all in service of one claim ("the checkpoint works
through MCP and agents can see it").

## Scope

**In:** `packages/cli/src/mcp/MCP.ts` (description; `runCommand` error surfacing only if the
probe proves it necessary); a new `packages/cli/src/__tests__/mcp-safety.vitest.ts` (name
per convention); minimal scratch-project fixture if the existing fixtures don't fit.

**Out:** `packages/migrate/src/utils/ai-safety.ts` (merged #29684 is authoritative — any
gap found there is an I12 halt, not a fix); the other three MCP tools beyond incidental
description consistency; MCP feature expansion (project non-goal); S1/S2 surfaces.

## Pre-investigated edge cases

| Edge case                                                                                            | Disposition                                                                                                   | Notes                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The test process itself may run under an agent, leaking markers into the spawned server              | Curated env for the subprocess: pass an explicit allowlist env, never inherit                                 | Same discipline as ai-safety's own tests (AGENTS.md notes they clear inherited markers) |
| `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` present in the curated env would bypass the checkpoint | Ensure it is absent in the agent-marker case; a third case may assert the bypass works with it set (optional) | The env var is the documented consent mechanism                                         |

## Slice-specific done conditions

- [ ] The vitest file pins both directions (marker → consent text in tool result, no
      success; no marker → no consent text) against the real server over stdio, and runs in
      CI without a database.
- [ ] The `migrate-reset` description mentions the AI-agent gate and consent protocol.

## Open Questions

1. Does today's `runCommand` surface the child's stderr in the tool result? Working
   position: the probe answers it; if not, the bounded fix lands in this slice with its own
   commit.

## References

- Parent project: `projects/agent-native/spec.md`; task draft
  `docs/plans/agent-native/003-ai-safety-checkpoint.md` (follow-up 2)
- Linear: [TML-2969](https://linear.app/prisma-company/issue/TML-2969/s3-ai-safety-checkpoint-through-prisma-mcp-audit-pin)
- Surfaces: `packages/cli/src/mcp/MCP.ts` (tools, `runCommand`, stdio transport);
  `packages/migrate/src/utils/ai-safety.ts` + its consumers (`DbPush`, `MigrateReset`,
  `DbDrop`); merged [#29684](https://github.com/prisma/prisma/pull/29684)
- Branch: `tml-2969-s3-ai-safety-checkpoint-through-prisma-mcp-audit-pin` from `origin/main`
  (independent of S1/S2; needs a fresh worktree + dependency build — budget for it, see
  `learnings.md`)
