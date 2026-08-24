import { SqlFamilyDescriptor } from '../core/control-descriptor';

// Re-export core types from canonical source
export type {
  MigrationOperationClass,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlanner,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
export { assembleAuthoringContributions } from '@internal/framework-components/control';
export { extractCodecControlHooks } from '../core/assembly';
export type { SqlControlFamilyInstance } from '../core/control-instance';
export type {
  SqlControlTargetDescriptor,
  SqlDescribedContractSpace,
} from '../core/control-target-descriptor';
export type {
  ContractToSchemaIROptions,
  DefaultRenderer,
  DefaultResolver,
  EnumNamespaceSchemaResolver,
  NativeTypeExpander,
} from '../core/migrations/contract-to-schema-ir';
// Contract → SchemaIR conversion for offline migration planning
export {
  contractNamespaceToSchemaIR,
  contractToSchemaIR,
  detectDestructiveChanges,
} from '../core/migrations/contract-to-schema-ir';
export type { ControlPolicySubject, SuppressionRecord } from '../core/migrations/control-policy';
export {
  controlPolicyForCall,
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
} from '../core/migrations/control-policy';
export type { PlanFieldEventOperationsOptions } from '../core/migrations/field-event-planner';
export { planFieldEventOperations } from '../core/migrations/field-event-planner';
export { buildNativeTypeExpander } from '../core/migrations/native-type-expander';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies';
export type {
  SqlSchemaDiffFn,
  SqlSchemaDiffInput,
  SqlSchemaDiffResult,
} from '../core/migrations/schema-differ';
export type {
  CodecControlHooks,
  CreateSqlMigrationPlanOptions,
  ExpandNativeTypeInput,
  FieldEvent,
  FieldEventContext,
  ResolveIdentityValueInput,
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
  SqlMigrationPlan,
  SqlMigrationPlanContractInfo,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
  SqlMigrationPlanOperationTarget,
  SqlMigrationRunner,
  SqlMigrationRunnerErrorCode,
  SqlMigrationRunnerExecuteCallbacks,
  SqlMigrationRunnerExecuteOptions,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerResult,
  SqlMigrationRunnerSuccessValue,
  SqlPlannerConflict,
  SqlPlannerConflictKind,
  SqlPlannerConflictLocation,
  SqlPlannerFailureResult,
  SqlPlannerResult,
  SqlPlannerSuccessResult,
  SqlPlanTargetDetails,
  StorageTypePlanResult,
} from '../core/migrations/types';
export {
  temporalAuthoringPresets,
  temporalCodecPreset,
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
  timestampNowControlDescriptor,
} from '../core/timestamp-now-generator';

export default new SqlFamilyDescriptor();
