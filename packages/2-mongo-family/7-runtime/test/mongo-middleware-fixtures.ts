import type { PlanMeta } from '@internal/contract/types';
import type { CodecCallContext } from '@internal/framework-components/codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoExecutionContext, MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { AggregateWireCommand, type AnyMongoDmlWireCommand } from '@internal/mongo-wire';
import { vi } from 'vitest';

export const testContract = {
  target: 'mongo',
  domain: { namespaces: {} },
} as unknown as MongoContract;

export function makeExecution(
  _adapter: MongoAdapter,
  wireCommand: AnyMongoDmlWireCommand = new AggregateWireCommand('users', []),
): { readonly context: MongoExecutionContext<MongoContract>; readonly adapter: MongoAdapter } {
  const codecs: MongoCodecRegistry = newMongoCodecRegistry();
  const adapter: MongoAdapter = {
    lower: vi.fn(async () => wireCommand) as unknown as MongoAdapter['lower'],
    structuralLower: vi.fn(
      (plan: MongoQueryPlan): MongoLoweredDraft => ({
        kind: 'rawAggregate',
        collection: plan.collection,
        pipeline: [],
      }),
    ),
    resolveParams: vi.fn(async (_draft: MongoLoweredDraft, _ctx: CodecCallContext) => wireCommand),
  };
  return {
    context: Object.freeze({
      contract: testContract,
      codecs,
      applyMutationDefaults: () => [],
    }),
    adapter,
  };
}

export const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

export function createPlan(overrides?: Partial<MongoQueryPlan>): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta: baseMeta,
    ...overrides,
  } as MongoQueryPlan;
}

export function createMockAdapter(): MongoAdapter {
  return {
    lower: vi.fn((plan: MongoQueryPlan) => ({
      collection: plan.collection,
      command: plan.command,
    })),
  } as unknown as MongoAdapter;
}

export function createMockDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}
