# `@internal/cli-telemetry`

Anonymous CLI usage telemetry client for Prisma Next. Runs in a
detached child process at command start, never blocks the parent,
and silently swallows every error in the sending path.

## Responsibilities

- **User config store.** Read/write `$XDG_CONFIG_HOME/prisma-next/config.json`
  (or platform equivalent), holding the consent flag (`enableTelemetry`) and
  the per-installation random UUID (`installationId`). Atomic writes;
  unknown fields preserved.
- **Gating.** Pure-function resolution over the two opt-out env vars
  (`PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK=1`), the stored
  preference, and the default-off fallback when the file is missing.
- **Sanitization.** Project the parent's parsed commander result into
  the command name plus the array of flag names; never values, never
  positionals.
- **Agent detection.** Best-effort identification of AI coding-agent
  sessions from an env-var allowlist. Detector runs in the child.
- **Detached send.** Fork the sender script via
  `child_process.fork(..., { detached: true, stdio: ['pipe','ignore','ignore','ipc'] })`,
  pipe the payload over IPC, `disconnect()` + `unref()`, return to the
  parent. The child enriches with system probes, POSTs to the backend
  with a 1–2 s timeout, exits.

## For contributors

The endpoint URL is a module-level constant pinned to the deployed
backend. For local-development testing, set
`PRISMA_NEXT_TELEMETRY_ENDPOINT` to override the destination URL
(used by the integration tests to spin up a mock HTTP server on an
ephemeral port). This is an integration-testing affordance, not a
public knob: do not surface it in user-facing docs.
