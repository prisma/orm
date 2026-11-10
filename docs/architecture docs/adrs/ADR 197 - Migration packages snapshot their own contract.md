# ADR 197 — Migration packages snapshot their own contract

## At a glance

Open a scaffolded migration directory and you see this:

```text
migrations/20250612T0930_backfill-status/
├── migration.ts          # authoring surface (TypeScript)
├── migration.json        # manifest: from/to hashes, migrationId
├── ops.json              # serialized operations
├── contract.json         # destination contract snapshot
└── contract.d.ts         # TypeScript types for the contract
```

The migration file imports the contract *locally*, not from the project root:

```ts
import type { Contract } from './contract'
import contractJson from './contract.json' with { type: 'json' }

const { raw } = mongoStatic({ contract: contractJson as Contract })
```

`contract.json` and `contract.d.ts` are copies — snapshots of the project's emitted contract when the migration was scaffolded. The migration never reaches outside its own directory for type information.

## Decision

> **Status:** Planned/target-state. The snapshot-copy semantics described below are the intended behavior; today's scaffolder in `packages/1-framework/3-tooling/migration/src/migration-ts.ts` still derives the contract import differently and `copyContractToMigrationDir` is not yet present in main. The implementation PR sequenced after this ADR introduces the helper and switches scaffolding over. The code snippet below is the target API.

When a migration is scaffolded (`migration plan` / `migration new`), the tooling copies the project's emitted `contract.json` and the colocated `contract.d.ts` into the migration directory. The migration is self-contained: its query builders are typed against the contract that existed when the migration was authored, and that contract travels with the migration permanently.

The copy is performed by `copyContractToMigrationDir` in `@internal/framework-migration`:

```ts
export async function copyContractToMigrationDir(
  packageDir: string,
  contractJsonPath: string,
): Promise<void> {
  await copyFile(contractJsonPath, join(packageDir, 'contract.json'));
  const dtsPath = `${contractJsonPath.slice(0, -'.json'.length)}.d.ts`;
  try {
    await copyFile(dtsPath, join(packageDir, 'contract.d.ts'));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return;
    throw error;
  }
}
```

A missing `.d.ts` is tolerated — only `contract.json` is required. This keeps the helper usable in tests that hand-roll a bare `contract.json` without emitting types. A missing `contract.json`, or any other I/O failure, throws.

## Why snapshot

The contract at the time the migration is authored is the one it operates against. Consider the timeline:

1. Developer writes migration M₁ against contract C₁ — queries reference `users.email`, `users.status`.
2. A week later, the schema evolves to C₂ — `users.status` is renamed to `users.state`.
3. Migration M₁ is applied to a fresh database.

If M₁ imported the contract from the project root, it would get C₂ — a contract where `users.status` doesn't exist. The query builders would produce type errors, and the emitted operations would be wrong.

With the snapshot, M₁ always sees C₁. The migration is reproducible regardless of how the schema evolves after it was written.

## Intermediate contracts

Some migrations need queries typed against a schema state that doesn't match either the source or destination contract. For example, a migration that adds a nullable `status` field, backfills it, then tightens the validator to require it — the backfill query targets an intermediate state where `status` exists but is optional.

For these cases, the user copies their schema authoring surface (e.g. a `.prisma` file) into the migration directory, modifies it to represent the intermediate state, and runs `contract emit` to produce a second contract:

```text
migrations/20250613T1100_split-name/
├── migration.ts
├── migration.json
├── ops.json
├── contract.json            # destination contract (scaffolded)
├── contract.d.ts
├── intermediate.prisma      # intermediate schema (user-authored)
├── intermediate.json        # emitted from intermediate.prisma
└── intermediate.d.ts
```

The migration file imports both:

```ts
import type { Contract } from './contract'
import type { Contract as Intermediate } from './intermediate'
import contractJson from './contract.json' with { type: 'json' }
import intermediateJson from './intermediate.json' with { type: 'json' }

const dest = mongoStatic({ contract: contractJson as Contract }).raw
const mid = mongoStatic({ contract: intermediateJson as Intermediate }).raw
```

Multiple intermediate contracts are supported — the user names them and emits them independently. Each is a self-contained contract snapshot that lives in the migration directory.

## Alternatives considered

### Import the project contract by path

The migration could `import type { Contract } from '../../../contract'` — a relative path back to the project root. This avoids the copy but breaks as soon as the contract evolves past the migration's expectations. It also couples the migration to the project's directory layout, making the migration non-portable.

### Re-emit the contract at apply time

The runner could re-emit the contract from the current schema before applying. This defeats the purpose: the migration should operate against the schema it was written for, not the current one. It also re-introduces a TypeScript toolchain dependency at apply time, which [ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) explicitly avoids.

### Store only `contract.json`, never `.d.ts`

Since `contract.json` is the source of truth and `.d.ts` is derived, we could skip copying the types and ask the user to emit them manually. We chose to copy `.d.ts` when available because the scaffolded `migration.ts` imports it immediately — the developer gets working type-checks out of the box with no extra step. Tolerating a missing `.d.ts` (rather than requiring it) keeps the contract copy usable in test scenarios where only the JSON is available.

## References

- [ADR 006 — Dual Authoring Modes](ADR%20006%20-%20Dual%20Authoring%20Modes.md) — the contract emitter that produces `contract.json` and `contract.d.ts`
- [ADR 192 — ops.json is the migration contract](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) — the migration directory layout and the principle that no TypeScript runs at apply time
