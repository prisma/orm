# Gotchas — `prisma-8-postgis-demo`

A running log of surprises, workarounds, and undocumented behaviour hit while
using **Prisma 8** in this demo. Each entry is mirrored as a Triage-state
ticket in the [`[PN] Gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview)
Linear project.

---

## Contents

- [`db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first](#db-init-fails-with-pn-mig-5001-declaredbutunmigrated-for-extension-spaces-unless-migration-plan-is-run-first)

---

## `db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first

**Filed upstream:** [TML-2495](https://linear.app/prisma-company/issue/TML-2495) — *"`db init` fails with PN-MIG-5001 `declaredButUnmigrated` for extension spaces unless `migration plan` is run first; remediation points at non-existent `prisma-next migrate` command"*
**Product:** Prisma 8
**Version:** workspace HEAD (branch `ankur/feat-postgis-extensions-rebased` @ `bb9d531a`)
**First hit:** postgis port to contract-spaces, demo setup
**Cost:** ~10 minutes to diagnose (would be longer for a first-time user — the remediation text points at a non-existent CLI subcommand)

**Symptom.** Following this demo's README verbatim (`pnpm emit` → `pnpm db:init`) on a fresh container fails with:

```
PN-MIG-5001 — Contract-space layout violation
  [declaredButUnmigrated] postgis
    Extension 'postgis' is declared in extensionPacks but has not been emitted; run `prisma-next migrate`.
```

There is no `prisma-next migrate` subcommand. The README has no `migration plan` step either.

**Cause.** The per-space verifier in [`packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts`](../../packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts) requires every space in `extensionPacks` to have a matching `<projectRoot>/migrations/<space-id>/` directory before `db init` will run. That directory is materialized by `prisma migration plan`, which copies the extension's baseline migration out of its descriptor. The verifier's remediation string names the wrong command (`prisma-next migrate`), and the demo README jumps `emit → db:init` with no plan step.

**Workaround.** Insert the plan step between `emit` and `db:init`:

```bash
pnpm emit
pnpm exec prisma migration plan
pnpm db:init
```

Revert criterion: drop the manual step once the demo's README adds it (or a `db:plan` script is wired into `package.json`), AND the verifier's remediation names the real command.

**Reproduction.**
1. `pnpm --filter "prisma-8-postgis-demo^..." build && cp .env.example .env && pnpm db:up`
2. `pnpm emit`
3. `pnpm db:init` — fails with `PN-MIG-5001`.
4. Re-run after `pnpm exec prisma migration plan` — succeeds.

**References.**
- Upstream: [TML-2495](https://linear.app/prisma-company/issue/TML-2495)
- Verifier source: [`packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts`](../../packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts)
- Demo README (currently missing the step): [`README.md`](README.md)
