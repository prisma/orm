import type { CodecCallContext } from '@internal/framework-components/codec';
import type { AnyMongoDdlCommand } from '@internal/mongo-query-ast/control';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import type {
  AnyMongoDdlWireCommand,
  AnyMongoDmlWireCommand,
  AnyMongoWireCommand,
} from '@internal/mongo-wire';

/**
 * Intermediate state produced by structural lowering. `MongoParamRef` and `MongoPreparedParamRef` leaves remain in place; codecs have not run yet. A prepared run replaces each `MongoPreparedParamRef` with a `MongoParamRef` holding the run's value. The runtime resolves values after the `beforeEncode` middleware chain, so middleware can read and replace `MongoParamRef` values before encoding.
 *
 * Document, filter and update slots are typed `Record<string, unknown>` to allow mixed values. Raw command variants hold the user's documents; `resolveParams` sends them to the driver without encoding, but the runtime still walks them, for example to refuse a placeholder in a raw command.
 */
export type MongoLoweredDraft =
  | {
      readonly kind: 'insertOne';
      readonly collection: string;
      readonly document: Record<string, unknown>;
    }
  | {
      readonly kind: 'insertMany';
      readonly collection: string;
      readonly documents: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly kind: 'updateOne';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
      readonly upsert: boolean | undefined;
    }
  | {
      readonly kind: 'updateMany';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
      readonly upsert: boolean | undefined;
    }
  | {
      readonly kind: 'deleteOne';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
    }
  | {
      readonly kind: 'deleteMany';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
    }
  | {
      readonly kind: 'findOneAndUpdate';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
      readonly upsert: boolean | undefined;
      readonly sort: Record<string, 1 | -1> | undefined;
      readonly returnDocument: 'before' | 'after' | undefined;
    }
  | {
      readonly kind: 'findOneAndDelete';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly sort: Record<string, 1 | -1> | undefined;
    }
  | {
      readonly kind: 'aggregate';
      readonly collection: string;
      readonly pipeline: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly kind: 'rawInsertOne';
      readonly collection: string;
      readonly document: Record<string, unknown>;
    }
  | {
      readonly kind: 'rawInsertMany';
      readonly collection: string;
      readonly documents: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly kind: 'rawUpdateOne';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly kind: 'rawUpdateMany';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
      readonly bypassDocumentValidation: boolean;
    }
  | {
      readonly kind: 'rawDeleteOne';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
    }
  | {
      readonly kind: 'rawDeleteMany';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
    }
  | {
      readonly kind: 'rawFindOneAndUpdate';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>;
      readonly upsert: boolean;
      readonly sort: Record<string, 1 | -1> | undefined;
      readonly returnDocument: 'before' | 'after' | undefined;
    }
  | {
      readonly kind: 'rawFindOneAndDelete';
      readonly collection: string;
      readonly filter: Record<string, unknown>;
      readonly sort: Record<string, 1 | -1> | undefined;
    }
  | {
      readonly kind: 'rawAggregate';
      readonly collection: string;
      readonly pipeline: ReadonlyArray<Record<string, unknown>>;
    };

/** Wraps a DDL command for passage to `MongoAdapter.lower`. */
export interface MongoDdlPlan {
  readonly command: AnyMongoDdlCommand;
}

export interface MongoAdapter {
  lower(plan: MongoDdlPlan, ctx: CodecCallContext): Promise<AnyMongoDdlWireCommand>;
  lower(plan: MongoQueryPlan, ctx: CodecCallContext): Promise<AnyMongoDmlWireCommand>;
  lower(plan: MongoQueryPlan | MongoDdlPlan, ctx: CodecCallContext): Promise<AnyMongoWireCommand>;

  /**
   * Phase 1 of the two-phase lowering pipeline (DML only).
   *
   * Transforms the plan's command AST into the lowered wire shape **without**
   * calling `resolveValue` on any `MongoParamRef` leaf. All filter predicates,
   * document fields, and pipeline stage values that carry `MongoParamRef`
   * nodes are preserved in the returned `MongoLoweredDraft` so that the
   * `beforeEncode` middleware chain can inspect and rewrite them before
   * encoding runs. Synchronous — no I/O or codec calls.
   */
  structuralLower(plan: MongoQueryPlan): MongoLoweredDraft;

  /**
   * Phase 2 of the two-phase lowering pipeline.
   *
   * Walks the `MongoLoweredDraft` produced by `structuralLower`, resolves
   * every `MongoParamRef` leaf through the codec registry, and constructs the
   * frozen `AnyMongoWireCommand` ready for the driver. The same abort-signal
   * forwarding and `RUNTIME.ABORTED` surface contract as `lower` applies.
   */
  resolveParams(draft: MongoLoweredDraft, ctx: CodecCallContext): Promise<AnyMongoDmlWireCommand>;
}
