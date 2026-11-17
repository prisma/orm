import type { Contract } from '@internal/contract/types';
import type {
  ContractSpace,
  ContractSpaceHeadRef,
  MigrationPackage,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import type { MigrationMetadata } from './metadata';

/**
 * Materialise a typed {@link ContractSpace} from the JSON artefacts a
 * contract-space extension package emits to disk.
 *
 * Extension descriptors wire `contract.json`, per-migration
 * `migration.json` / `ops.json`, and `refs/head.json` to the framework's
 * typed surfaces. TypeScript widens JSON imports to a structural record
 * that does not preserve readonly modifiers or branded scalars (e.g.
 * `StorageHashBase<'abc123...'>`), so authoring the descriptor inline
 * forces every wiring site to cast through `unknown`. This helper
 * encapsulates the single narrowing point: descriptor sources stay
 * cast-free, and the (necessary) coercion is colocated with the
 * documentation explaining why it is safe.
 *
 * Safety: the JSON files passed here are produced by the framework's own
 * emit pipeline (`prisma contract emit` and `MigrationCLI.run`)
 * and re-validated downstream by the runner / verifier. The descriptor
 * is a pass-through wiring layer — no descriptor consumer treats the
 * narrowed types as a stronger guarantee than "these came from the
 * canonical emit pipeline".
 *
 * The helper does not introspect or schema-validate the inputs; runtime
 * validation is the responsibility of `family.deserializeContract`
 * (codec-aware, invoked at control-stack construction) and the
 * per-migration `readMigrationPackage` reader used when loading
 * from disk. JSON-imported packages flow through the descriptor without
 * a disk read, so the equivalent runtime guarantee comes from the emit
 * pipeline that produced the JSON in the first place.
 */
export function contractSpaceFromJson<TContract extends Contract = Contract>(inputs: {
  readonly contractJson: unknown;
  readonly migrations: ReadonlyArray<{
    readonly dirName: string;
    readonly metadata: unknown;
    readonly ops: unknown;
  }>;
  readonly headRef: ContractSpaceHeadRef;
}): ContractSpace<TContract> {
  // The narrowing happens once, here. Casting via `unknown` rather than a
  // direct cast preserves TS's structural soundness checks for the
  // inputs (they must be assignable to `unknown`, which is trivial); the
  // resulting type is the family-specific Contract / MigrationPackage
  // surface descriptors publish.
  const migrations: readonly MigrationPackage[] = inputs.migrations.map((m) => ({
    dirName: m.dirName,
    metadata: m.metadata as MigrationMetadata,
    ops: m.ops as readonly MigrationPlanOperation[],
  }));
  return {
    contractJson: inputs.contractJson as TContract,
    migrations,
    headRef: inputs.headRef,
  };
}
