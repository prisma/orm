# Slice plan: safety-mcp-audit

**Spec:** `projects/agent-native/slices/safety-mcp-audit/spec.md`
**Branch:** `tml-2969-s3-ai-safety-checkpoint-through-prisma-mcp-audit-pin` from `origin/main`
(independent of S1/S2). Fresh worktree — budget `pnpm install` + `turbo build` per
`learnings.md` before any gate.

## Dispatch plan

### Dispatch 1: probe and pin (test-first)

- **Outcome:** The empirical answer to the slice's open question exists with captures (does
  the checkpoint's consent text reach the MCP tool result today?), and
  `packages/cli/src/__tests__/mcp-safety.vitest.ts` encodes the desired contract against the
  real server over stdio (SDK `Client` + `StdioClientTransport` spawning the built CLI with
  a curated env): agent-marker case → tool result carries
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` and the stop-and-relay instruction, no
  success; no-marker case → no consent text. The test may be red at hand-off **only** if
  the probe proves today's `runCommand` swallows the text (that is the desired-contract,
  fix-pending state).
- **Builds on:** The spec's chosen design; merged #29684 on main.
- **Hands to:** Probe verdict + captures + the pinned contract test (green, or red with the
  exact surfacing gap named) for Dispatch 2 to close.
- **Focus:** Worktree setup, the probe, the test. No `MCP.ts` changes yet.

### Dispatch 2: close the contract

- **Outcome:** The test is green: if Dispatch 1 found a surfacing gap, the bounded
  `runCommand` error-propagation fix lands (own commit); the `migrate-reset` tool
  description mentions the AI-agent gate and consent protocol; packages/cli typecheck +
  the new vitest file green; captures of the final tool-result payload for the PR.
- **Builds on:** Dispatch 1's probe verdict and contract test.
- **Hands to:** Slice at DoD — PR-open evidence.
- **Focus:** `MCP.ts` only (description; `runCommand` only if D1 proved it necessary).

## Sizing

| Dispatch | Size | dispatch-INVEST note                                                           |
| -------- | ---- | ------------------------------------------------------------------------------ |
| 1        | M    | One outcome: probed + pinned contract. Setup cost is environmental, not scope. |
| 2        | S    | One outcome: contract closed and documented.                                   |

## Handoff completeness

Slice-DoD condition 1 (both-directions test, DB-free) ← D1 (authored) + D2 (green);
condition 2 (description) ← D2. CI-green + reviewer-accept inherited via the slice PR.
