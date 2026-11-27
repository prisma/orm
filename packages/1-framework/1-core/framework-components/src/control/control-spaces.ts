import type { Contract } from '@internal/contract/types';
import type { MigrationMetadata, MigrationPlanOperation } from './control-migration-types';

/**
 * Canonical control-plane identifiers for contract spaces.
 *
 * A contract space is the disjoint `(contract.json, migration-graph)` unit
 * the per-space planner / runner / verifier (project: extension contract
 * spaces, TML-2397) operates on. The application owns one well-known
 * space — the value below — and each loaded extension that contributes
 * schema owns a uniquely-named space.
 *
 * Lives in `framework-components/control` so every layer that has to
 * reason about space identity (the migration tooling, the SQL runtime's
 * marker reader, target-side statement builders, target-side adapters)
 * can import a single value rather than duplicating the literal. Raw
 * `'app'` string literals in framework / target / runtime / adapter
 * source code are forbidden and policed by
 * `scripts/lint-app-space-id.mjs` (wired into `pnpm lint:deps`).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Layout convention (γ).
 */
export const APP_SPACE_ID = 'app' as const;

/**
 * The Prisma space: the contract space of what Prisma itself stores in a user's database, which a target's control descriptor carries. It is never one of the spaces of the user's repository: it is not listed, not an undeclared space, and is brought up to date before anything else. Every check for it goes through {@link isPrismaSpace}.
 */
export const PRISMA_SPACE_ID = '_prisma' as const;

export function isPrismaSpace(spaceId: string): spaceId is typeof PRISMA_SPACE_ID {
  return spaceId === PRISMA_SPACE_ID;
}

/**
 * Head ref for a contract space — the `(hash, invariants)` tuple
 * a runner targets when applying that space's migration graph. Identical
 * in shape to the on-disk `migrations/<space-id>/refs/head.json` the
 * framework writes per loaded extension, and to the app-space
 * `<projectRoot>/refs/head.json`. Family-agnostic: SQL, Mongo, and any
 * future family share the same head-ref shape.
 *
 * @see specs/framework-mechanism.spec.md § 1.
 */
export interface ContractSpaceHeadRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

/**
 * Canonical structural shape of a migration package — the unit a planner
 * produces and a runner consumes: a directory name, the metadata
 * envelope, and the operation list.
 *
 * In-memory by default. Readers in `@internal/migration-tools`
 * (`readMigrationPackage` / `readMigrationsDir`) return the augmented
 * {@link import('@internal/migration-tools/package').OnDiskMigrationPackage}
 * variant which adds `dirPath`; everything else operates against the
 * canonical shape so the same value flows through pre-emission
 * authoring, on-disk loading, and runner execution without conversion.
 *
 * @see specs/framework-mechanism.spec.md § 1.
 */
export interface MigrationPackage {
  readonly dirName: string;
  readonly metadata: MigrationMetadata;
  readonly ops: readonly MigrationPlanOperation[];
  /**
   * Contract IR JSON of this migration's destination state, populated by
   * the on-disk readers from the shared snapshot store entry for the
   * migration's `to` hash when present (raw parsed JSON). Absent for
   * packages loaded without a resolvable store entry — the runner never
   * requires it (see ADR 199: identity is anchored on the storage-hash
   * bookends). The edge's *start* state is deliberately not carried: it
   * is by construction the end state of the predecessor edge, so
   * consumers derive it from the previous row.
   */
  readonly endContractJson?: unknown;
}

/**
 * Canonical structural shape of a contract space — one disjoint
 * `(contractJson, migration-graph)` unit the per-space planner / runner
 * / verifier operates on. The application owns one well-known space
 * ({@link APP_SPACE_ID}); each loaded extension that contributes schema
 * owns a uniquely-named space. Whether a value is the app's space or an
 * extension's space is a control-plane concern; the type carries no
 * such distinction.
 *
 * Generic over the contract so each family pins a typed contract value
 * at consumption time. The SQL family specialises to
 * `ContractSpace<Contract<SqlStorage>>` at the descriptor surface;
 * Mongo's symmetrical `ContractSpace<Contract<MongoStorage>>` will land
 * with that family.
 *
 * @see specs/framework-mechanism.spec.md § 1.
 */
export interface ContractSpace<TContract extends Contract = Contract> {
  readonly contractJson: TContract;
  readonly migrations: readonly MigrationPackage[];
  readonly headRef: ContractSpaceHeadRef;
}
