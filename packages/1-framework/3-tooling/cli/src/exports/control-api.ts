/**
 * Programmatic Control API for Prisma ORM.
 *
 * This module exports the control client factory and types for programmatic
 * access to control-plane operations without using the CLI.
 *
 * @see README.md "Programmatic Control API" section for usage examples
 * @module
 */

// Re-export core control plane types for consumer convenience
export type {
  ControlStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
// Client factory
export { createControlClient } from '../control-api/client';

// Contract enrichment (merges framework-derived capabilities and extension pack metadata)
export { enrichContract } from '../control-api/contract-enrichment';
// Client-free operations backing the migration/db command surface
// (TML-3173, consolidate-clis slice 1b).
export { mapCaughtMigrationError } from '../control-api/operations/caught-errors';
export { mapContractAtError } from '../control-api/operations/contract-at-errors';
export { executeContractEmit } from '../control-api/operations/contract-emit';
export {
  type ResolveContractRefToSnapshotOptions,
  type ResolveContractRefToSnapshotSuccess,
  resolveContractRefToSnapshot,
} from '../control-api/operations/contract-snapshot-resolution';
export {
  appContractStandInFromIdentity,
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
  buildReadAggregate,
  loadContractRawSafely,
  loadContractSpaceAggregateForCli,
  mapIntegrityViolations,
  refuseContractSpaceIntegrity,
  refuseDeclaredExtensionTargetMismatch,
  refusePackageCorruptionOnAggregate,
} from '../control-api/operations/contract-space-aggregate-loader';
export {
  type ContractSpaceSeedPhaseInputs,
  type ContractSpaceSeedPhaseRecord,
  type ContractSpaceSeedPhaseResult,
  runContractSpaceSeedPhase,
} from '../control-api/operations/contract-space-seed-phase';
// Standalone operations (for tooling that doesn't need full client).
// These drive the aggregate-pipeline `db init` / `db update` / `db verify`
// flow against a loaded contract-space aggregate.
export { type ExecuteDbInitOptions, executeDbInit } from '../control-api/operations/db-init';
export {
  type ExecuteDbUpdateOptions,
  executeDbUpdate,
} from '../control-api/operations/db-update';
export {
  type ExecuteDbVerifyOptions,
  type ExecuteDbVerifyResult,
  executeDbVerify,
} from '../control-api/operations/db-verify';
export {
  hasMigrationPath,
  refuseMarkerOutsideGraph,
} from '../control-api/operations/graph-queries';
export {
  refuseMissingInvariantPath,
  refuseUnknownInvariants,
} from '../control-api/operations/invariants';
export {
  type ExecuteMigrateShowPlanOptions,
  executeMigrateShowPlan,
  type MigrateShowMigration,
  type MigrateShowPlanSuccess,
} from '../control-api/operations/migrate-show';
export {
  type CheckSpace,
  checkSingleTarget,
  enumerateCheckSpaces,
  loadAggregateIntegrityViolations,
  type MigrationCheckOutcome,
  type RunMigrationCheckInputs,
  runMigrationCheck,
} from '../control-api/operations/migration-check';
export { buildMigrationSpaceGraphEntries } from '../control-api/operations/migration-graph';
export {
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  type RunMigrationListInputs,
  runMigrationList,
} from '../control-api/operations/migration-list';
export { executeMigrationNewCommand } from '../control-api/operations/migration-new';
export {
  executeMigrationPlanCommand,
  type MigrationPlanResult,
} from '../control-api/operations/migration-plan';
export {
  appliedHashesFromLedger,
  deriveStatusEdgeAnnotations,
  originHashForStatus,
  statusForMigrationHash,
} from '../control-api/operations/migration-status-overlay';
export {
  type FromResolution,
  type ResolvedContractRef,
  resolveFromForPlan,
  resolveToForPlan,
} from '../control-api/operations/plan-resolution';
export {
  executeRefDeleteCommand,
  executeRefListCommand,
  executeRefSetCommand,
} from '../control-api/operations/ref';
export {
  advanceRefSafely,
  buildRefAdvancementFields,
  type ContractIR,
  computeRefAdvancementName,
  executeRefAdvancement,
  type RefAdvancementFields,
  readContractIR,
  resolveRefAdvancementFields,
} from '../control-api/operations/ref-advancement';
export { resolveContractRef, resolveMigrationRef } from '../control-api/operations/ref-resolution';
export { readMigrationRefs } from '../control-api/operations/refs';
// CLI-specific types
export type {
  ContractEmitOptions,
  ContractEmitResult,
  ControlActionName,
  ControlClient,
  ControlClientOptions,
  ControlProgressEvent,
  DbInitFailure,
  DbInitFailureCode,
  DbInitOptions,
  DbInitResult,
  DbInitSuccess,
  DbUpdateFailure,
  DbUpdateFailureCode,
  DbUpdateOptions,
  DbUpdateResult,
  DbUpdateSuccess,
  EmitContractConfig,
  EmitFailure,
  EmitFailureCode,
  EmitOptions,
  EmitResult,
  EmitSuccess,
  IntrospectOptions,
  OnControlProgress,
  SchemaVerifyOptions,
  SignOptions,
  VerifyOptions,
} from '../control-api/types';
// Lifecycle helpers for hosts that publish to many output paths
export { disposeEmitQueue } from '../utils/emit-queue';
