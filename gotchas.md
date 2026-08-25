# Gotchas

A running log of surprises, workarounds, and undocumented behaviour hit while *consuming* **Prisma Next**, **Prisma Compute**, or **Prisma Postgres** in this repo's examples and public surfaces. Each entry captures friction a real user of these products would also experience.

Each entry should also be filed as a Triage-state Linear ticket in the matching gotchas project so the team can pick them up:

- Prisma Next → [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview)
- Prisma Compute → [`compute-gotchas`](https://linear.app/prisma-company/project/compute-gotchas-dd3ac34b5ad4/overview)
- Prisma Postgres → [`ppg-gotchas`](https://linear.app/prisma-company/project/ppg-gotchas-afe77336f696/overview)

The capture workflow is documented in [`.claude/skills/record-gotchas/SKILL.md`](.claude/skills/record-gotchas/SKILL.md).

---

## Contents

- [Demo fixture contract snapshots fail to deserialize during `migrate` (PN-CLI-4003)](#demo-fixture-contract-snapshots-fail-to-deserialize-during-migrate-pn-cli-4003)
- [`migration plan` silently plans from an empty database when no `db` ref exists](#migration-plan-silently-plans-from-an-empty-database-when-no-db-ref-exists)
- [`migration plan --from db` fails with MIGRATION.NO_TARGET once a rollback cycle exists](#migration-plan---from-db-fails-with-migrationno_target-once-a-rollback-cycle-exists)

---

## Demo fixture contract snapshots fail to deserialize during `migrate` (PN-CLI-4003)

**Filed upstream:** pending — authored in a session without Linear access; please file in [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) and replace this line.
**Product:** Prisma Next
**Version:** `main` @ `e7bd0deb8` (workspace `0.14.0`)
**First hit:** running the migration-graph demo fixtures end-to-end while writing the public migrations docs
**Cost:** ~30 minutes (ruling out my own setup before reading the snapshots)

**Symptom.** The graph fixtures under `examples/prisma-8-demo/fixtures/` render fine with the offline commands, but applying one against a live database fails before any SQL runs:

```text
$ pnpm prisma-next migrate --to prod --db $DB --config fixtures/diamond/prisma.config.ts
✖ Contract validation failed (PN-CLI-4003)
  Why: Predecessor contract at .../fixtures/diamond/migrations/snapshots/93be6c.../contract.json failed to deserialize:
       Contract structural validation failed: storage.namespaces.__unbound__.entries must be an object (was missing);
       storage.namespaces.__unbound__.tables must be removed;
       execution.mutations.defaults[0].ref.namespace must be a string (was missing)
```

**Cause.** The contract serialization format moved under the fixtures (e.g. the database→namespace→table diff-tree restructure, #894), and the fixtures' committed predecessor contract snapshot in `migrations/snapshots/<hex>/contract.json` was emitted with the older shape. Offline commands (`migration graph`, `list`, `show`, `check`) never deserialize predecessor contracts, so the drift is invisible until someone runs `migrate` or `migration status` against a database.

**Workaround.** Treat the fixtures as offline-only (graph rendering) for now. For a live apply walkthrough, create a fresh fixture with the current CLI (`contract emit` + `migration plan`) instead of reusing the committed ones.

**Reproduction.**
1. `docker run -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine`, create any empty database.
2. `cd examples/prisma-8-demo && pnpm prisma-next contract emit --config fixtures/diamond/prisma.config.ts`
3. `pnpm prisma-next migrate --to prod --db <url> --config fixtures/diamond/prisma.config.ts` → PN-CLI-4003 as above.

**References.**
- Fixture snapshot: [`examples/prisma-8-demo/fixtures/diamond/migrations/snapshots/93be6c200743261baf55f0586b1380a1c0ade3c48730c09a8fec71ba419c2464/contract.json`](examples/prisma-8-demo/fixtures/diamond/migrations/snapshots/93be6c200743261baf55f0586b1380a1c0ade3c48730c09a8fec71ba419c2464/contract.json)
- Restructure that moved the format: #894

---

## `migration plan` silently planned from an empty database when no `db` ref existed (resolved)

**Filed upstream:** pending — authored in a session without Linear access; please file in [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) and replace this line.
**Product:** Prisma Next
**Version:** `main` @ `e7bd0deb8` (workspace `0.14.0`)
**First hit:** planning the second migration of a fresh walkthrough project while writing the public migrations docs

**Symptom.** With one migration already on disk and applied, adding a nullable field and running `prisma-next migration plan --name add_phone` produced a **full greenfield migration** (`from: null`, `Create schema "public"` + `Create table "user"`) instead of a one-column delta. No warning that the existing history was ignored.

**Cause.** `resolveFromForPlan` ([`packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts), `optionsFrom === undefined` branch) falls back to the ref named `db` and, when it does not exist, straight to greenfield. Nothing advances the `db` ref unless the user opted in with `migrate --advance-ref db`, so the very first delta plan of a project that skipped that flag rebuilds the world. The command's own help ("Compares the emitted contract against the latest on-disk migration state") promises more than the default does.

**Workaround.** Either apply with `prisma-next migrate --advance-ref db` from the start, or always pass `--from <latest-migration-dir>`. A CLI warning when the graph is non-empty but planning resolves to greenfield would remove the trap entirely.

**Resolved.** `migration plan` now refuses this case instead of planning: when default origin resolution finds no `--from` and no `db` ref while migrations exist on disk, it fails with `MIGRATION.PLAN_ORIGIN_UNKNOWN` and names the three exits — set the `db` ref (`migration ref set db <contract>`, or advance it via `db update`), pass `--from <contract>`, or pass `--from @empty` to plan from an empty database deliberately. The first plan of a fresh project (empty graph) stays silently greenfield.

**Reproduction.**
1. Fresh project: `contract emit`, `migration plan --name init`, `migrate` (no `--advance-ref`).
2. Add `phone String?` to the model, `contract emit`.
3. `migration plan --name add_phone` → planned operations are `Create schema` + `Create table`, `from: null`.

**References.**
- From-resolution: [`packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts)
- The behaviour was documented defensively in the public docs (prisma/web#8025, generating-a-migration page warning) back when the CLI itself stayed silent; the CLI now refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`.

---

## `migration plan --from db` fails with MIGRATION.NO_TARGET once a rollback cycle exists

**Filed upstream:** pending — authored in a session without Linear access; please file in [`pn-gotchas`](https://linear.app/prisma-company/project/pn-gotchas-a6f6f5157a5c/overview) and replace this line.
**Product:** Prisma Next
**Version:** `main` @ `e7bd0deb8` (workspace `0.14.0`)
**First hit:** planning the next forward migration after a verified rollback, while writing the public migrations docs

**Symptom.** After a rollback edge creates a cycle (`C1→C2→C1`), planning the next migration fails even when the planning origin is supplied via a ref:

```text
$ prisma-next migration plan --name add_bio --from db
code: 'MIGRATION.NO_TARGET'
why:  The migration history contains cycles and no target can be resolved automatically
      (reachable hashes: sha256:705b1a6..., sha256:e6b5c28...). This typically happens after
      rollback migrations (e.g., C1→C2→C1).
fix:  Use --from <hash> to specify the planning origin explicitly.
```

The same command with `--from 20260707T1005_init` (a migration directory name) succeeds, and so does a full hash. Only the ref-name form (and the implicit `db`-ref default, which is the advertised no-flag workflow) hits the error, and the error's own fix text ("Use --from") is confusing when `--from` *was* passed.

**Cause.** Unconfirmed; the ref-name resolution path appears to still run the latest-tip inference that throws on cyclic graphs, while the directory-name path resolves the origin directly. Worth a look at the plan target/origin resolution in [`packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts) and the `MIGRATION.NO_TARGET` throw site.

**Workaround.** After any rollback, pass `--from <migration-directory>` or `--from <full-hash>` explicitly. Ref names work again once the next forward migration breaks the ambiguity.

**Reproduction.**
1. Project with `init` → `add_display_name` applied, then plan and apply a rollback (`migration plan --to add_display_name^ …`, `migrate --to add_display_name^`), giving the graph a cycle.
2. `ref set db <init-hash>` (or rely on an advanced `db` ref).
3. Change the contract, `contract emit`, then `migration plan --name add_bio --from db` → MIGRATION.NO_TARGET; retry with `--from <init-dir-name>` → succeeds.

**References.**
- Plan origin resolution: [`packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts`](packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts)
- Related UX note: the public rollbacks docs (prisma/web#8025) currently tell users to pass `--from <dir>` after any rollback because of this.
