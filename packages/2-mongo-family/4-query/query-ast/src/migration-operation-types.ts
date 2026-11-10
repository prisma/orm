import type {
  MigrationOperationClass,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import type { AnyMongoDdlCommand } from './ddl-commands';
import type { MongoFilterExpr } from './filter-expressions';
import type { AnyMongoInspectionCommand } from './inspection-commands';
import type { MongoQueryPlan } from './query-plan';

/**
 * What a DDL operation's check reads: the catalog, through an inspection command, or the documents
 * of a collection, through an aggregate.
 */
export type MongoMigrationCheckSource = AnyMongoInspectionCommand | MongoQueryPlan;

const INSPECTION_COMMAND_KINDS: ReadonlySet<unknown> = new Set<AnyMongoInspectionCommand['kind']>([
  'listIndexes',
  'listCollections',
]);

export function isInspectionCheckSource(
  source: MongoMigrationCheckSource,
): source is AnyMongoInspectionCommand {
  return 'kind' in source && INSPECTION_COMMAND_KINDS.has(source.kind);
}

export interface MongoMigrationCheck {
  readonly description: string;
  readonly source: MongoMigrationCheckSource;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
  /** The object the check expects to exist or not, as a reader names it (`collection "orders"`), when the check is about one object. */
  readonly object?: string;
}

export interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}

/** A field the planner rewrites, as the factory that writes the rewrite describes it. */
export type MongoFieldRewriteMeta =
  | {
      readonly kind: 'cast';
      readonly collection: string;
      readonly field: string;
      /** The BSON type `$convert` casts the field to. */
      readonly to: string;
    }
  | { readonly kind: 'fill'; readonly collection: string; readonly field: string };

/**
 * What an operation is, as the factory that builds it writes it into `ops.json`, so the runner reads
 * it rather than working it out from the operation's commands.
 */
export interface MongoOperationMeta {
  readonly rewrite?: MongoFieldRewriteMeta;
}

export interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly meta?: MongoOperationMeta;
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
  readonly meta?: MongoOperationMeta;
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
