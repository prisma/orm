# Task: Skill — Troubleshooting Suite

## Overview

A `prisma-troubleshooting` skill in prisma/skills: one router SKILL.md with a symptom →
reference table, and one `references/` file per failure class. Agents are good at following
runbooks; today no runbook exists, so they guess from outdated training data.

## Failure classes (one reference file each)

### 1. CLI / Client version mismatch

- Symptom: subtle type errors, runtime protocol errors, or the mismatch warning `generate`
  already prints (`packages/cli/src/Generate.ts` warns when `prisma` and `@prisma/client`
  versions differ).
- Runbook: compare `npx prisma -v` with the installed `@prisma/client`; align both to the same
  exact version; regenerate; watch for duplicate versions in the lockfile (`pnpm why`, npm
  dedupe) and for a globally installed CLI shadowing the local one.

### 2. Binary target mismatch

- Scope it correctly for Prisma 7: the **client** has no native binaries (Wasm query compiler +
  TS interpreter), so classic "invalid binary target" client errors indicate Prisma 6 or the
  legacy generator — check versions first. The **schema engine** (CLI/migrate) is still a
  native binary.
- The macOS-host-vs-Docker scenario: `generate`/`migrate` run on the host, app runs in a Linux
  container (or vice versa) — cover `binaryTargets` for legacy setups,
  `PRISMA_CLI_BINARY_TARGETS`, engine downloads behind proxies, and musl/openssl detection in
  Alpine images.
- Decision tree keyed on "which command failed, where was it executed, which Prisma major".

### 3. Connection pool and SSL (Prisma 6 vs 7)

- Prisma 6: pool configured via URL params (`connection_limit`, `pool_timeout`), SSL handled
  by the native engine (`sslmode`, cert params).
- Prisma 7: the **JS driver adapter owns the pool and TLS** — `connection_limit` in a URL does
  nothing; configure the adapter (e.g. `pg` `Pool` `max`, `ssl` options). Common symptom:
  pool exhaustion under load after an upgrade because the old URL params silently stopped
  applying.
- Pool sizing guidance per process count (ties into task 009's `node:cluster` note).

### 4. Enabling logs and tracing

- Client logging (`log: ['query', 'info', 'warn', 'error']`, event-based vs stdout),
  `DEBUG="prisma*"` for CLI/internal debug output, `@prisma/instrumentation` + OpenTelemetry,
  and the sqlcommenter plugins for query provenance.
- What each layer can and cannot show (e.g. driver-level errors surface in adapter logs).

### 5. Is the database actually reachable?

- Before blaming Prisma: verify the database is up and the URL is reachable **outside**
  Prisma — `psql`/`mysql`/`sqlcmd` one-liners, `nc -zv host port`, `openssl s_client` for TLS
  handshakes, DNS inside Docker networks, IPv4 vs IPv6 binding.
- Map the common Prisma error codes (`P1000`, `P1001`, `P1017`, `DatabaseNotReachable`-mapped
  driver errors) to the corresponding external check.

### 6. The AI safety checkpoint

- What it is, which commands it gates, and that the correct agent behavior is to stop and
  relay the consent request to the human (cross-reference task 003; the checkpoint's own error
  text is the authoritative instruction).

## Scope

- prisma/skills only. Cross-link from `prisma-cli` and the connection skill (task 004).

## Acceptance criteria

- Each reference is an executable runbook: numbered checks with expected outputs, ending in
  either a fix or a precise escalation ("file an issue with this output").
- The binary-target reference explicitly prevents the Prisma-6-era reflex of adding
  `binaryTargets` to a Prisma 7 client schema.
