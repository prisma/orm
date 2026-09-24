import type { PlanMeta } from '@internal/contract/types';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import type { AnyMongoWireCommand } from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoRuntimeAdapterInstance,
} from '../src/mongo-execution-stack';
import { createMongoRuntime } from '../src/mongo-runtime';

const meta: PlanMeta = { target: 'mongo', targetFamily: 'mongo', storageHash: 'test', lane: 'orm' };

const adapterInstance = {
  familyId: 'mongo',
  targetId: 'mongo',
  lower: vi.fn(),
  structuralLower: vi.fn(
    (plan: MongoQueryPlan): MongoLoweredDraft => ({
      kind: 'rawAggregate',
      collection: plan.collection,
      pipeline: [],
    }),
  ),
  resolveParams: vi.fn(async () => ({}) as unknown as AnyMongoWireCommand),
} as unknown as MongoRuntimeAdapterInstance<'mongo'>;

function runtimeOver(driver: MongoDriver) {
  const stack = createMongoExecutionStack({
    target: {
      kind: 'target',
      id: 'test-target',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
      codecs: () => {
        const registry = newMongoCodecRegistry();
        registry.register(
          mongoCodec({
            typeId: 'test/upper@1',
            decode: (wire: string) => wire.toUpperCase(),
            encode: (value: string) => value,
          }),
        );
        return registry;
      },
      create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
    },
    adapter: {
      kind: 'adapter',
      id: 'test-adapter',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
      codecs: () => newMongoCodecRegistry(),
      create: () => adapterInstance,
    },
  });
  const context = createMongoExecutionContext({ contract: {}, stack });
  return createMongoRuntime({ context, driver });
}

function driverYielding(rows: readonly Record<string, unknown>[]): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) yield row as Row;
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

describe('MongoRuntime', () => {
  it('decodes each row through the plan result shape', async () => {
    const runtime = runtimeOver(driverYielding([{ name: 'alice' }]));
    const rows = await runtime
      .query({
        collection: 'users',
        command: { kind: 'find', filter: {} },
        meta,
        resultShape: {
          kind: 'document',
          fields: { name: { kind: 'leaf', codecId: 'test/upper@1', nullable: false } },
        },
      } as unknown as MongoQueryPlan)
      .toArray();
    expect(rows).toEqual([{ name: 'ALICE' }]);
  });

  it('closes the driver', async () => {
    const driver = driverYielding([]);
    await runtimeOver(driver).close();
    expect(driver.close).toHaveBeenCalledTimes(1);
  });
});
