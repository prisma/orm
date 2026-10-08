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
export { checkSqlDefaultText } from '@internal/sql-contract/validators';
export { extractCodecControlHooks } from '../core/assembly';
export type { SqlControlFamilyInstance } from '../core/control-instance';
export type {
  SqlControlTargetDescriptor,
  SqlDescribedContractSpace,
  SqlPslBuildContext,
} from '../core/control-target-descriptor';
export type {
  ContractToSchemaIROptions,
  DefaultRenderer,
  DefaultResolver,
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
export type {
  FieldEventCall,
  PlanFieldEventOperationsOptions,
} from '../core/migrations/field-event-planner';
export {
  planFieldEventCalls,
  planFieldEventOperations,
} from '../core/migrations/field-event-planner';
export { storageNameOfOperation } from '../core/migrations/operation-storage-name';
export type {
  CallSubjects,
  SubjectStorage,
} from '../core/migrations/operation-subjects';
export {
  fieldEventStorage,
  subjectsOfCalls,
  unknownCallNames,
} from '../core/migrations/operation-subjects';
export {
  createMigrationPlan,
  plannerFailure,
  plannerSuccess,
  runnerFailure,
  runnerSuccess,
} from '../core/migrations/plan-helpers';
export { INIT_ADDITIVE_POLICY } from '../core/migrations/policies';
export type {
  ColumnRename,
  ColumnRenameRequest,
} from '../core/migrations/resolve-column-rename';
export {
  COLUMN_RENAME_UNMATCHED_CODE,
  resolveColumnRenameAgainst,
  unmatchedColumnRename,
} from '../core/migrations/resolve-column-rename';
export type {
  TableRename,
  TableRenameRequest,
} from '../core/migrations/resolve-table-rename';
export {
  resolveTableRenameAgainst,
  unmatchedTableRename,
} from '../core/migrations/resolve-table-rename';
export type {
  SqlSchemaDiffFn,
  SqlSchemaDiffInput,
  SqlSchemaDiffResult,
} from '../core/migrations/schema-differ';
export type { SchemaTables } from '../core/migrations/schema-tables';
export { sqlTypeLookupsOf } from '../core/migrations/sql-type-lookups';
export type {
  CallWithCompanions,
  ColumnOnOneSide,
  FieldStorageEffect,
  ModelStorageEffect,
  ModelTable,
  NoTable,
  PlannedStatements,
  SingleOperationCall,
  StatementPlanningTarget,
} from '../core/migrations/statement-planning';
export {
  fieldRenameStorageEffect,
  modelRenameStorageEffect,
  planStatements,
} from '../core/migrations/statement-planning';
export type { TableNameCaseGuardTable } from '../core/migrations/table-name-case-guard';
export {
  detectTableNameCaseChanges,
  TABLE_NAME_CASE_CHANGED_CODE,
} from '../core/migrations/table-name-case-guard';
export type {
  CodecControlHooks,
  CreateSqlMigrationPlanOptions,
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
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '../core/timestamp-now-generator';

export default new SqlFamilyDescriptor();
