# Task: AI Safety Checkpoint — Land Marker Refresh and Follow-Ups

## Overview

The AI safety checkpoint (`packages/migrate/src/utils/ai-safety.ts`) blocks `db drop`,
`db push --force-reset`, and `migrate reset` when an AI agent is detected, unless
`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` carries the user's consent. The marker
modernization is done in [PR #29684](https://github.com/prisma/prisma/pull/29684)
(`aqrln/ai-safety-modern-agents`, in review). This task tracks landing it plus small
follow-ups that tie the checkpoint into the rest of the agent-native work.

## Status

- Detection refresh: **in review** (PR #29684). Statically enforced matcher declarations,
  injected detection context instead of `node:fs` mocks.
- `main` currently carries only the older marker set (Claude Code, Gemini/Qwen, Cursor, Aider,
  Replit, Codex).

## Follow-ups (this task)

1. **Land PR #29684.**
2. **MCP interplay audit.** `prisma mcp` (`packages/cli/src/mcp/MCP.ts`) exposes a
   `migrate-reset` tool that shells out to `migrate reset --force`. When the MCP server is
   launched by an agent (the only realistic case), the agent's env markers are inherited by
   the child process, so the checkpoint fires inside the MCP tool call. Verify this with a
   test, and make sure the checkpoint's error text renders usefully through the MCP tool
   result (the agent must see the consent instructions, not a truncated stderr). Adjust the
   tool description to mention the consent protocol.
3. **Document the consent protocol in skills.** The `prisma-cli` skill (and the troubleshooting
   skill, task 006) must describe the checkpoint: which commands are gated, why, and that the
   correct response is to stop and ask the human — not to hunt for bypasses. An agent that has
   read the skill behaves better at the checkpoint than one that meets it cold.
4. **Marker maintenance loop.** New agent runtimes appear frequently; keep the matcher list
   under periodic review (the static enforcement from PR #29684 makes additions cheap). Do not
   replace the in-house detection with `@vercel/detect-agent` (rationale in the comment above
   `agentMatchers`).

## Non-goals

- Extending the checkpoint to `db execute` or other commands that _can_ be destructive but are
  general-purpose: the current scope (commands whose purpose is data destruction) keeps the
  false-positive rate at zero. Revisit only with evidence of real incidents.

## Acceptance criteria

- PR #29684 merged.
- A test pins that the checkpoint triggers through the `prisma mcp` `migrate-reset` tool and
  that the consent instructions survive the MCP transport.
- prisma/skills PRs reference the checkpoint in `prisma-cli` (and task 006's skill).
