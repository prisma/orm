export {
  collectAggregateNamespaces,
  createAggregateContractSpace,
  createContractSpaceAggregate,
  requireHeadRef,
  spacesInApplyOrder,
} from '../aggregate/aggregate';
export { allStorageElementsExternal } from '../aggregate/all-external';
export {
  computeIntegrityViolations,
  type IntegrityComputationInput,
  type IntegritySpaceState,
  loadProblemToViolation,
} from '../aggregate/check-integrity';
export { buildFabricatedMigrationEdge } from '../aggregate/fabricated-migration-edge';
export { type LoadAggregateInput, loadContractSpaceAggregate } from '../aggregate/loader';
export type { ContractMarkerRecordLike } from '../aggregate/marker-types';
export {
  type AggregateCurrentDBState,
  type AggregateMigrationEdgeRef,
  type CallerPolicy,
  type PerSpacePlan,
  type PlannerError,
  type PlannerInput,
  type PlannerOutput,
  type PlannerSuccess,
  planMigration,
} from '../aggregate/planner';
export {
  type ResolveRecordedPathInputs,
  type ResolveRecordedPathOutcome,
  resolveRecordedPath,
} from '../aggregate/strategies/resolve-recorded-path';
export type {
  AggregateContractSpace,
  ContractAtOptions,
  ContractAtResult,
  ContractSpaceAggregate,
} from '../aggregate/types';
export {
  type MarkerCheckResult,
  type MarkerCheckSection,
  type SchemaCheckSection,
  type VerifierError,
  type VerifierInput,
  type VerifierOutput,
  type VerifierSuccess,
  verifyMigration,
} from '../aggregate/verifier';
export type {
  DeclaredExtensionEntry,
  IntegrityQueryOptions,
  IntegrityViolation,
} from '../integrity-violation';
