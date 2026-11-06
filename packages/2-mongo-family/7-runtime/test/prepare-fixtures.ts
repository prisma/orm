import type { CodecCallContext } from '@internal/framework-components/codec';
import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type {
  MongoFilterExpr,
  MongoPipelineStage,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { AggregateWireCommand, UpdateManyWireCommand } from '@internal/mongo-wire';
import { vi } from 'vitest';
import type { MongoMiddleware } from '../src/mongo-middleware';
import { createMongoRuntime } from '../src/mongo-runtime';
import { createMockDriver, testContract } from './mongo-middleware-fixtures';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

const testCodecIds = ['test/string@1', 'test/int@1'];

export type TestCodecTypes = {
  readonly 'test/string@1': { readonly input: string; readonly output: string };
  readonly 'test/int@1': { readonly input: number; readonly output: number };
};

function testCodecs() {
  const registry = newMongoCodecRegistry();
  for (const id of testCodecIds) {
    registry.register(
      mongoCodec({
        typeId: id,
        fromWire: (wire: string) => wire,
        toWire: (value: string) => value,
        dataType: textType,
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );
  }
  return registry;
}

function lowerFilter(filter: MongoFilterExpr): Record<string, unknown> {
  if (filter.kind !== 'field') throw new Error(`test lowering does not support ${filter.kind}`);
  return { [filter.field]: { [filter.op]: filter.value } };
}

function lowerStage(stage: MongoPipelineStage): Record<string, unknown> {
  switch (stage.kind) {
    case 'match':
      return { $match: lowerFilter(stage.filter) };
    case 'limit':
      return { $limit: stage.limit };
    case 'skip':
      return { $skip: stage.skip };
    case 'lookup':
      return {
        $lookup: {
          from: stage.from,
          as: stage.as,
          pipeline: (stage.pipeline ?? []).map(lowerStage),
        },
      };
    default:
      throw new Error(`test lowering does not support ${stage.kind}`);
  }
}

/** A small stand-in for the adapter's structural lowering, covering the commands these tests build. */
export function testStructuralLower(plan: MongoQueryPlan): MongoLoweredDraft {
  const command = plan.command;
  switch (command.kind) {
    case 'aggregate':
      return {
        kind: 'aggregate',
        collection: command.collection,
        pipeline: command.pipeline.map(lowerStage),
      };
    case 'updateMany':
      if (Array.isArray(command.update))
        throw new Error('test lowering supports update documents only');
      return {
        kind: 'updateMany',
        collection: command.collection,
        filter: lowerFilter(command.filter),
        update: { ...command.update },
        upsert: false,
      };
    case 'deleteMany':
      return {
        kind: 'deleteMany',
        collection: command.collection,
        filter: lowerFilter(command.filter),
      };
    case 'rawAggregate':
      return { kind: 'rawAggregate', collection: command.collection, pipeline: command.pipeline };
    default:
      throw new Error(`test lowering does not support ${command.kind}`);
  }
}

export function preparedRuntime(
  options: {
    readonly rows?: Record<string, unknown>[];
    readonly middleware?: readonly MongoMiddleware[];
    readonly driver?: MongoDriver;
  } = {},
) {
  const resolvedDrafts: MongoLoweredDraft[] = [];
  const adapter: MongoAdapter = {
    lower: vi.fn() as unknown as MongoAdapter['lower'],
    structuralLower: vi.fn(testStructuralLower),
    resolveParams: vi.fn(async (draft: MongoLoweredDraft, _ctx: CodecCallContext) => {
      resolvedDrafts.push(draft);
      return draft.kind === 'updateMany' || draft.kind === 'deleteMany'
        ? new UpdateManyWireCommand(draft.collection, {}, {})
        : new AggregateWireCommand(draft.collection, []);
    }),
  };
  const driver = options.driver ?? createMockDriver(options.rows ?? [{ _id: 1 }]);
  const runtime = createMongoRuntime({
    context: Object.freeze({
      contract: testContract,
      codecs: testCodecs(),
      applyMutationDefaults: () => [],
    }),
    adapter,
    driver,
    ...(options.middleware ? { middleware: options.middleware } : {}),
  });
  return { runtime, adapter, driver, resolvedDrafts };
}
