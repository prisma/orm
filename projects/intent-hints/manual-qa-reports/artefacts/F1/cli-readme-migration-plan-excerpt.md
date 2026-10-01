**Options:**
- `--config <path>`: Path to `prisma.config.ts`
- `--name <slug>`: Name slug for the migration directory (default: `migration`)
- `--from <contract>`: Starting contract reference (hash, prefix, ref name, migration directory, `<dir>^`, `@empty`, or filesystem path). `@empty` names the empty-database origin deliberately. Defaults to the `db` ref; when the ref is absent, greenfield only on an empty graph — over existing migrations the command refuses (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) unless `--from @empty` is passed.
- `--to <contract>`: Destination contract reference (same grammar as `--from`). Defaults to the emitted `contract.json`. Use `--to <migration-dir>^` to plan a rollback toward a predecessor state. A destination named by --to is a snapshot and carries no hints; hints apply only when the destination is the emitted contract.json.
- `--confirm <directory>`: Consent to writing an auto-baseline package with destructive operations, given as the project directory name, where there is nobody to ask
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Loads config and resolves the destination contract: `--to <contract>` if provided, otherwise `contract.json`
2. Reads existing migrations from `config.migrations.dir` (default: `migrations/`)
3. Determines the starting point: `--from <contract>` if provided, otherwise the `db` ref. When the ref is absent, greenfield only on an empty graph; over existing migrations the command refuses (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) unless `--from @empty` is passed
4. Diffs the starting contract against the destination using the target's migration planner. The planner first applies the destination's rename hints (`@@hint(was:)` in PSL, `sql({ hint: { was } })` in TypeScript): a hinted table is renamed, with the objects named after it, instead of being dropped and created
5. Scaffolds a new migration package: `migration.ts` (containing `placeholder(...)` lambdas for any data transforms), `migration.json` (with a content-addressed `migrationHash` over the planned ops, or over `[]` when the planner could not lower any calls because of placeholders), and `ops.json` (the planned ops, or `[]` in the placeholder-blocked case). The bookend contracts are written write-if-absent into the shared snapshot store at `migrations/snapshots/<hex>/contract.{json,d.ts}`. The package is **always** fully attested — there is no draft state on disk.
6. If the plan has unfilled `placeholder(...)` slots, the command returns a successful `pendingPlaceholders` envelope (a warning, not a failure) asking the developer to fill in the slots before re-emitting. The on-disk `ops.json` is `[]` and `migrationHash` is the hash of `(metadata, [])`, so applying the migration as-written will not advance the storage hash to the intended destination — the runner's destination-hash post-check surfaces this as a state mismatch. After filling in the placeholders, run `node migrations/<dir>/migration.ts` to re-emit `ops.json` and the corresponding `migrationHash`. `PN-MIG-2001` is raised only at self-emit time when a slot is still unfilled.

**Outputs:**
- `migrations/<dir>/migration.ts` — editable migration source (with `placeholder(...)` slots when the planner inserted them)
- `migrations/<dir>/migration.json` — fully attested metadata (`migrationHash: string`, never null)
- `migrations/<dir>/ops.json` — planned operations (empty list `[]` if placeholders blocked the planner)
- `migrations/snapshots/<hex>/contract.{json,d.ts}` — bookend contracts, written write-if-absent, keyed by each contract's storage hash (one entry for `from` when applicable, one for `to`)

**Hints applied:** After the operations, the human output lists each hint the plan acted on under `Hints applied`, one line per hint, for example `rename hint on table "UserProfile" (was "userProfile"): renamed and recorded in this migration; you can remove the hint.` The JSON result carries the same entries as `consumedHints` (`{ hint, text }`). Both are absent when the plan used no hint. Planner warnings, such as a hint ignored because its table's control policy is not `managed`, print as warnings and appear in the JSON `warnings`.

**Baseline consent:** When the plan writes an auto-baseline package with destructive operations (dropping a table or a column, or narrowing a column), the command asks for the project directory name before writing it; where there is nobody to ask, pass `--confirm <directory>`. Drops of indexes, constraints, checks and row-level-security policies are `widening` and do not ask.

**Branching with `--from` and `--to`:** Use `--from` to create a migration edge from a specific contract hash instead of the default starting point. Use `--to` to plan toward any resolved contract — including a rollback via `<migration-dir>^` — instead of the emitted contract. This enables branched migration graphs and arbitrary-target (including reverse) edges without editing contract source.

### `prisma migration show`
