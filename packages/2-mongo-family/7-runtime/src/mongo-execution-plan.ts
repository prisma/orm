import type { ExecutionPlan } from '@internal/framework-components/runtime';
import type { MongoResultShape } from '@internal/mongo-query-ast/execution';
import type { AnyMongoDmlWireCommand } from '@internal/mongo-wire';

/**
 * Mongo-domain execution plan: a query lowered to the wire-command shape
 * that a Mongo driver can run.
 *
 * The plan carries:
 * - `command` — dual lifecycle (see field JSDoc): unresolved draft during
 *   `beforeEncode`, frozen wire command afterward
 * - `meta` — family-agnostic plan metadata (target, lane, hashes, ...)
 * - `_row` — phantom row type, propagated from the originating
 *   `MongoQueryPlan`
 *
 * Extends the framework-level `ExecutionPlan<Row>` marker so generic SPIs
 * (`RuntimeExecutor<MongoExecutionPlan>`,
 * `RuntimeMiddleware<MongoExecutionPlan>`) can be parameterized over it.
 *
 * Lives in the runtime layer (alongside `MongoRuntime`) because the wire
 * command shape lives in the transport layer (`@internal/mongo-wire`),
 * which the lanes layer (`mongo-query-ast`, where `MongoQueryPlan` lives)
 * cannot depend on.
 */
export interface MongoExecutionPlan<Row = unknown> extends ExecutionPlan<Row> {
  /**
   * Lowered command payload. **Lifecycle:** during `beforeEncode` this slot
   * holds the unresolved `MongoLoweredDraft` (plain object, `MongoParamRef`
   * leaves intact). After `resolveParams` and in later middleware hooks
   * (`intercept`, `onRow`) it is the frozen wire
   * command (`InsertOneWireCommand`, `AggregateWireCommand`, …). Do not read
   * `command` structurally in `beforeEncode` — use the `params` mutator.
   */
  readonly command: AnyMongoDmlWireCommand;
  readonly resultShape?: MongoResultShape;
}
