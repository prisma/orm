import type { CodecCallContext } from '@internal/framework-components/codec';
import { assembleMongoCodecRegistry, type MongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter, MongoDdlPlan, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { AnyMongoDdlCommand } from '@internal/mongo-query-ast/control';
import { keysToKeySpec } from '@internal/mongo-query-ast/control';
import type {
  MongoQueryPlan,
  MongoUpdatePipelineStage,
  MongoUpdateSpec,
} from '@internal/mongo-query-ast/execution';
import type {
  AnyMongoDdlWireCommand,
  AnyMongoDmlWireCommand,
  AnyMongoWireCommand,
} from '@internal/mongo-wire';
import {
  AggregateWireCommand,
  CollModWireCommand,
  CreateCollectionWireCommand,
  CreateIndexWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  DropCollectionWireCommand,
  DropIndexWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  RenameCollectionWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { blindCast } from '@internal/utils/casts';
import { assertNever } from '@internal/utils/internal-error';
import { structuralLowerFilter, structuralLowerPipeline } from './lowering';
import { resolveDraftDoc } from './resolve-value';

function isUpdatePipeline(
  update: MongoUpdateSpec,
): update is ReadonlyArray<MongoUpdatePipelineStage> {
  return Array.isArray(update);
}

function isDraftUpdatePipeline(
  update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
): update is ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(update);
}

async function resolveUpdate(
  update: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
  codecs: MongoCodecRegistry,
  ctx: CodecCallContext,
): Promise<Record<string, unknown> | ReadonlyArray<Record<string, unknown>>> {
  if (isDraftUpdatePipeline(update)) {
    return Promise.all(update.map((stage) => resolveDraftDoc(stage, codecs, ctx)));
  }
  return resolveDraftDoc(update, codecs, ctx);
}

function lowerDdlCommand(command: AnyMongoDdlCommand): AnyMongoDdlWireCommand {
  switch (command.kind) {
    case 'createCollection':
      return new CreateCollectionWireCommand(command.collection, command);
    case 'createIndex':
      return new CreateIndexWireCommand(command.collection, keysToKeySpec(command.keys), command);
    case 'dropCollection':
      return new DropCollectionWireCommand(command.collection);
    case 'renameCollection':
      return new RenameCollectionWireCommand(command.collection, command.to);
    case 'dropIndex':
      return new DropIndexWireCommand(command.collection, command.name);
    case 'collMod':
      return new CollModWireCommand(command.collection, command);
    // v8 ignore next 4
    default: {
      const _exhaustive: never = command;
      return assertNever(
        _exhaustive,
        `Unknown DDL command kind: ${blindCast<{ kind: string }, 'exhaustive switch fallback for error message'>(_exhaustive).kind}`,
      );
    }
  }
}

class MongoAdapterImpl implements MongoAdapter {
  readonly #codecs: MongoCodecRegistry;

  constructor(codecs: MongoCodecRegistry) {
    this.#codecs = codecs;
  }

  structuralLower(plan: MongoQueryPlan): MongoLoweredDraft {
    const { command } = plan;
    switch (command.kind) {
      case 'insertOne':
        return { kind: 'insertOne', collection: command.collection, document: command.document };
      case 'insertMany':
        return {
          kind: 'insertMany',
          collection: command.collection,
          documents: command.documents,
        };
      case 'updateOne':
        return {
          kind: 'updateOne',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
          update: isUpdatePipeline(command.update)
            ? structuralLowerPipeline(command.update)
            : command.update,
          upsert: command.upsert,
        };
      case 'updateMany':
        return {
          kind: 'updateMany',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
          update: isUpdatePipeline(command.update)
            ? structuralLowerPipeline(command.update)
            : command.update,
          upsert: command.upsert,
        };
      case 'deleteOne':
        return {
          kind: 'deleteOne',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
        };
      case 'deleteMany':
        return {
          kind: 'deleteMany',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
        };
      case 'findOneAndUpdate':
        return {
          kind: 'findOneAndUpdate',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
          update: isUpdatePipeline(command.update)
            ? structuralLowerPipeline(command.update)
            : command.update,
          upsert: command.upsert,
          sort: command.sort,
          returnDocument: command.returnDocument,
        };
      case 'findOneAndDelete':
        return {
          kind: 'findOneAndDelete',
          collection: command.collection,
          filter: structuralLowerFilter(command.filter),
          sort: command.sort,
        };
      case 'aggregate':
        return {
          kind: 'aggregate',
          collection: command.collection,
          pipeline: structuralLowerPipeline(command.pipeline),
        };
      case 'rawAggregate':
        return { kind: 'rawAggregate', collection: command.collection, pipeline: command.pipeline };
      case 'rawInsertOne':
        return {
          kind: 'rawInsertOne',
          collection: command.collection,
          document: command.document,
        };
      case 'rawInsertMany':
        return {
          kind: 'rawInsertMany',
          collection: command.collection,
          documents: command.documents,
        };
      case 'rawUpdateOne':
        return {
          kind: 'rawUpdateOne',
          collection: command.collection,
          filter: command.filter,
          update: command.update,
        };
      case 'rawUpdateMany':
        return {
          kind: 'rawUpdateMany',
          collection: command.collection,
          filter: command.filter,
          update: command.update,
          bypassDocumentValidation: command.bypassDocumentValidation ?? false,
        };
      case 'rawDeleteOne':
        return { kind: 'rawDeleteOne', collection: command.collection, filter: command.filter };
      case 'rawDeleteMany':
        return { kind: 'rawDeleteMany', collection: command.collection, filter: command.filter };
      case 'rawFindOneAndUpdate':
        return {
          kind: 'rawFindOneAndUpdate',
          collection: command.collection,
          filter: command.filter,
          update: command.update,
          upsert: command.upsert,
          sort: command.sort,
          returnDocument: command.returnDocument,
        };
      case 'rawFindOneAndDelete':
        return {
          kind: 'rawFindOneAndDelete',
          collection: command.collection,
          filter: command.filter,
          sort: command.sort,
        };
      // v8 ignore next 4
      default: {
        const _exhaustive: never = command;
        return assertNever(
          _exhaustive,
          `Unknown command kind: ${blindCast<{ kind: string }, 'exhaustive switch fallback for error message'>(_exhaustive).kind}`,
        );
      }
    }
  }

  async resolveParams(
    draft: MongoLoweredDraft,
    ctx: CodecCallContext,
  ): Promise<AnyMongoDmlWireCommand> {
    switch (draft.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(
          draft.collection,
          await resolveDraftDoc(draft.document, this.#codecs, ctx),
        );
      case 'insertMany':
        return new InsertManyWireCommand(
          draft.collection,
          await Promise.all(draft.documents.map((doc) => resolveDraftDoc(doc, this.#codecs, ctx))),
        );
      case 'updateOne': {
        const [filter, update] = await Promise.all([
          resolveDraftDoc(draft.filter, this.#codecs, ctx),
          resolveUpdate(draft.update, this.#codecs, ctx),
        ]);
        return new UpdateOneWireCommand(draft.collection, filter, update, draft.upsert);
      }
      case 'updateMany': {
        const [filter, update] = await Promise.all([
          resolveDraftDoc(draft.filter, this.#codecs, ctx),
          resolveUpdate(draft.update, this.#codecs, ctx),
        ]);
        return new UpdateManyWireCommand(draft.collection, filter, update, draft.upsert);
      }
      case 'deleteOne':
        return new DeleteOneWireCommand(
          draft.collection,
          await resolveDraftDoc(draft.filter, this.#codecs, ctx),
        );
      case 'deleteMany':
        return new DeleteManyWireCommand(
          draft.collection,
          await resolveDraftDoc(draft.filter, this.#codecs, ctx),
        );
      case 'findOneAndUpdate': {
        const [filter, update] = await Promise.all([
          resolveDraftDoc(draft.filter, this.#codecs, ctx),
          resolveUpdate(draft.update, this.#codecs, ctx),
        ]);
        return new FindOneAndUpdateWireCommand(
          draft.collection,
          filter,
          update,
          draft.upsert,
          draft.sort,
          draft.returnDocument,
        );
      }
      case 'findOneAndDelete':
        return new FindOneAndDeleteWireCommand(
          draft.collection,
          await resolveDraftDoc(draft.filter, this.#codecs, ctx),
          draft.sort,
        );
      case 'aggregate':
        return new AggregateWireCommand(
          draft.collection,
          await Promise.all(
            draft.pipeline.map((stage) => resolveDraftDoc(stage, this.#codecs, ctx)),
          ),
        );
      case 'rawAggregate':
        return new AggregateWireCommand(draft.collection, draft.pipeline);
      case 'rawInsertOne':
        return new InsertOneWireCommand(draft.collection, draft.document);
      case 'rawInsertMany':
        return new InsertManyWireCommand(draft.collection, draft.documents);
      case 'rawUpdateOne':
        return new UpdateOneWireCommand(draft.collection, draft.filter, draft.update);
      case 'rawUpdateMany':
        return new UpdateManyWireCommand(
          draft.collection,
          draft.filter,
          draft.update,
          false,
          draft.bypassDocumentValidation,
        );
      case 'rawDeleteOne':
        return new DeleteOneWireCommand(draft.collection, draft.filter);
      case 'rawDeleteMany':
        return new DeleteManyWireCommand(draft.collection, draft.filter);
      case 'rawFindOneAndUpdate':
        return new FindOneAndUpdateWireCommand(
          draft.collection,
          draft.filter,
          draft.update,
          draft.upsert,
          draft.sort,
          draft.returnDocument,
        );
      case 'rawFindOneAndDelete':
        return new FindOneAndDeleteWireCommand(draft.collection, draft.filter, draft.sort);
      // v8 ignore next 4
      default: {
        const _exhaustive: never = draft;
        return assertNever(
          _exhaustive,
          `Unknown draft kind: ${blindCast<{ kind: string }, 'exhaustive switch fallback for error message'>(_exhaustive).kind}`,
        );
      }
    }
  }

  lower(plan: MongoDdlPlan, ctx: CodecCallContext): Promise<AnyMongoDdlWireCommand>;
  lower(plan: MongoQueryPlan, ctx: CodecCallContext): Promise<AnyMongoDmlWireCommand>;
  lower(plan: MongoQueryPlan | MongoDdlPlan, ctx: CodecCallContext): Promise<AnyMongoWireCommand> {
    if ('collection' in plan) {
      return this.resolveParams(this.structuralLower(plan), ctx);
    }
    return Promise.resolve(lowerDdlCommand(plan.command));
  }
}

/**
 * Construct a Mongo adapter that encodes `MongoParamRef` leaves with `codecs`, the MongoDB target's codecs when omitted.
 *
 * The runtime descriptor's `create(stack)` passes the codecs of every component in the stack, so extension codecs encode as well as decode. User code should compose a stack/context instead.
 */
export function createMongoAdapter(
  codecs: MongoCodecRegistry = assembleMongoCodecRegistry([mongoRuntimeTarget]),
): MongoAdapter {
  return new MongoAdapterImpl(codecs);
}
