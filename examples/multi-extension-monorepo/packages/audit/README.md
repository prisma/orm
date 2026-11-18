# audit (internal contract-space package)

Internal "extension package" for the [`multi-extension-monorepo`](../../README.md) example. Contributes a single `audit_event` table to applications that include this package in their `extensions`.

## Authoring (maintainers)

This package follows the contract-space package layout convention described in [ADR 212 — Contract spaces](../../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md). See the [example monorepo's README](../../README.md#authoring-maintainers) for the full step-by-step workflow — the short version is:

1. Edit [`src/contract.prisma`](./src/contract.prisma) (PSL authoring entry-point).
2. From this directory: `pnpm exec prisma contract emit`.
3. If the schema changed: `pnpm exec prisma migration plan --name <slug>`, then hand-edit the generated `migrations/<dir>/migration.ts` so each op carries the package's stable invariantId, and re-emit `ops.json` from this directory with:

   ```sh
   pnpm exec tsx "$PWD/migrations/<dir>/migration.ts" \
     --config "$PWD/prisma.config.ts"
   ```

   The verbose absolute-path incantation is necessary because this subdirectory has no `package.json`: `pnpm exec` rewinds cwd to the monorepo root (`examples/multi-extension-monorepo/`) before exec, which would otherwise resolve the migration path / config path against the wrong directory. (`tsx` rather than bare `node` because the Migration subclass imports relative TypeScript siblings which Node's native loader can't resolve without a TS-aware loader. `migration plan` is **not** chained into the package's build script — it's non-idempotent and runs manually when the schema changes.)
4. Update [`migrations/refs/head.json`](./migrations/refs/head.json) to pin the new head `(hash, invariants)`.
5. The descriptor at [`src/control.ts`](./src/control.ts) is JSON-import wiring over the on-disk artefacts — no manual edits required for routine schema changes.
