import type {
  MigrationOperationClass,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import type { AnyMongoDdlCommand } from './ddl-commands';
import type { MongoFilterExpr } from './filter-expressions';
import type { AnyMongoInspectionCommand } from './inspection-commands';
import type { MongoQueryPlan } from './query-plan';

export interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
  /** The object the check expects to exist or not, as a reader names it (`collection "orders"`), when the check is about one object. */
  readonly object?: string;
}

export interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}

export interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}

export interface MongoDmlCheck {
  readonly description: string;
  readonly source: MongoQueryPlan;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}

/**
 * An operation that runs queries (`run`) where a DDL operation executes commands (`execute`): a
 * `dataTransform`, with class `data`, or a document rewrite the planner plans, with the class of
 * its effect.
 */
export interface MongoDmlOperation extends MigrationPlanOperation {
  readonly operationClass: MigrationOperationClass;
  readonly name: string;
  /**
   * Optional opt-in routing identity. Presence opts the operation into
   * invariant-aware routing; absence means it is path-dependent and not
   * referenceable from refs.
   */
  readonly invariantId?: string;
  readonly precheck: readonly MongoDmlCheck[];
  readonly run: readonly MongoQueryPlan[];
  readonly postcheck: readonly MongoDmlCheck[];
}

export type AnyMongoMigrationOperation = MongoMigrationPlanOperation | MongoDmlOperation;

export function isMongoDmlOperation(
  operation: AnyMongoMigrationOperation,
): operation is MongoDmlOperation {
  return 'run' in operation;
}

export type { MigrationOperationClass, MigrationPlanOperation };
