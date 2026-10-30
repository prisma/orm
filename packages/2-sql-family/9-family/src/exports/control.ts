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
export type { SqlDefaultFunctionName } from '../core/default-functions';
export { sqlDefaultFunctions } from '../core/default-functions';
export type {
  ContractToSchemaIROptions,
  DefaultResolver,
  DefaultResolverColumn,
} from '../core/migrations/contract-to-schema-ir';
// Contract → SchemaIR conversion for offline migration planning
export {
  contractNamespaceToSchemaIR,
  contractToSchemaIR,
  detectDestructiveChanges,
} from '../core/migrations/contract-to-schema-ir';
export type { ControlPolicySubject, SuppressionRecord } from '../core/migrations/control-policy';
export {
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
} from '../core/migrations/control-policy';
export type {
  StoredEnumValue,
  StoredValueCodec,
  StoredValueReplacement,
  StoredValueRewrite,
} from '../core/migrations/enum-value-planning';
export { encodeStoredValue, planEnumValueRewrites } from '../core/migrations/enum-value-planning';
export type {
  FieldEventCall,
  PlanFieldEventOperationsOptions,
} from '../core/migrations/field-event-planner';
export {
  planFieldEventCalls,
  planFieldEventOperations,
} from '../core/migrations/field-event-planner';
export { fieldOfColumn } from '../core/migrations/field-of-column';
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
export type { RequiredColumn, RequiredColumnMark } from '../core/migrations/required-column';
export {
  requiredColumnMeta,
  requiredColumnOf,
  requiredColumnsOfMigration,
  rowsWithoutValueFailure,
  rowsWithoutValueSummary,
} from '../core/migrations/required-column';
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
export type { RowsHoldingValueMark } from '../core/migrations/rows-holding-value';
export {
  rowsHoldingValueMeta,
  rowsHoldingValueOf,
  rowsHoldingValueSummary,
} from '../core/migrations/rows-holding-value';
export type {
  SqlSchemaDiffFn,
  SqlSchemaDiffInput,
  SqlSchemaDiffResult,
} from '../core/migrations/schema-differ';
export type { SchemaTables } from '../core/migrations/schema-tables';
export type { SqlQuote, SqlQuotingRules } from '../core/migrations/sql-expression-text';
export { checkSqlExpressionText } from '../core/migrations/sql-expression-text';
export type { SqlSlot } from '../core/migrations/sql-slot';
export { isUnfilledSlot, slotSource, sqlOfSlot } from '../core/migrations/sql-slot';
export {
  createSqlTextSources,
  type SqlTextSources,
} from '../core/migrations/sql-text-sources';
export { sqlTypeLookupsOf } from '../core/migrations/sql-type-lookups';
export type {
  CallWithCompanions,
  ColumnOnOneSide,
  FieldStatementColumns,
  FieldStorageEffect,
  ModelStorageEffect,
  ModelTable,
  NamespaceRename,
  NamespaceStatementTarget,
  NoTable,
  PlannedStatement,
  PlannedStatements,
  SingleOperationCall,
  StatementColumn,
  StatementOperations,
  StatementOwnership,
  StatementPlanningTarget,
  TableMove,
  TableRenameByHand,
  TargetRefusal,
  WorkingSchemaOrigins,
} from '../core/migrations/statement-planning';
export {
  appliedStatementsInOrder,
  backfillOfDefaultedField,
  fieldRenameStorageEffect,
  fieldStatementColumns,
  modelRenameStorageEffect,
  NO_RENAMED_ORIGINS,
  otherSpaceDeclaring,
  planStatements,
} from '../core/migrations/statement-planning';
export type { TableNameCaseGuardTable } from '../core/migrations/table-name-case-guard';
export {
  detectTableNameCaseChanges,
  TABLE_NAME_CASE_CHANGED_CODE,
} from '../core/migrations/table-name-case-guard';
export { columnTakesTemporaryValue } from '../core/migrations/temporary-value';
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
  type ConvertedColumn,
  convertedColumnMeta,
  convertedColumnOf,
  unconvertedFieldOf,
} from '../core/migrations/unconverted-field';
export type {
  ContractColumn,
  ContractColumns,
  ReadColumnDefault,
  ReadReportedDefault,
  ReportedBody,
  ReportedLiteralDefault,
} from '../core/reported-defaults';
export {
  contractColumns,
  readColumnDefault,
  readReportedDefault,
} from '../core/reported-defaults';

export default new SqlFamilyDescriptor();
