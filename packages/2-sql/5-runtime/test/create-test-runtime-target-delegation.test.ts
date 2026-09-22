import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  type SqlDriver,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  createStubAdapter,
  createTestContext,
  createTestContract,
  createTestRuntime,
} from './utils';

const contract: Contract<SqlStorage> = createTestContract({
  storageHash: 'target-delegation',
  storage: {
    namespaces: {
      __unbound__: createTestSqlNamespace({
        id: '__unbound__',
        entries: {
          table: {
            Thing: {
              columns: {
                tags: {
                  nativeType: 'text',
                  codecId: 'pg/text@1',
                  nullable: false,
                  many: true,
                },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [] as const,
            },
          },
        },
      }),
    },
  },
  models: {},
});

function createDriver(tagsWire: unknown = '{a,b}'): {
  driver: SqlDriver;
  queryCalls: Array<{ sql: string; params: readonly unknown[] }>;
} {
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const driver: SqlDriver = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn(),
    execute: vi.fn(),
    query: vi.fn().mockImplementation(async function* (request) {
      queryCalls.push(request);
      yield { tags: tagsWire };
    }),
  };

  return { driver, queryCalls };
}

describe('createTestRuntime target list decoding', () => {
  it('uses the SQL native-array decoder when the target has no list decoder', async () => {
    const stubAdapter = createStubAdapter();
    const { driver } = createDriver(['a', 'b']);
    const runtime = createTestRuntime({
      stackInstance: { adapter: stubAdapter, stack: { target: {} } },
      context: createTestContext(contract, stubAdapter),
      driver,
      verifyMarker: false,
    });

    const plan = planFromAst(
      SelectAst.from(TableSource.named('Thing')).withProjection([
        ProjectionItem.of('tags', ColumnRef.of('Thing', 'tags'), {
          codecId: 'pg/text@1',
          many: true,
        }),
      ]),
      contract,
    );

    const rows = await runtime.query(plan).toArray();

    expect(rows).toEqual([{ tags: ['a', 'b'] }]);

    await runtime.close();
  });

  it('delegates many decoding to the target list decoder with raw text', async () => {
    const stubAdapter = createStubAdapter();

    const listDecoderWireValues: unknown[] = [];
    const target = {
      listDecoder:
        () => async (wireValue: unknown, decodeElement: (value: unknown) => Promise<unknown>) => {
          listDecoderWireValues.push(wireValue);
          expect(typeof wireValue).toBe('string');
          expect(wireValue).toBe('{a,b}');
          return [await decodeElement('a'), await decodeElement('b')];
        },
    };
    const { driver } = createDriver();
    const runtime = createTestRuntime({
      stackInstance: { adapter: stubAdapter, stack: { target } },
      context: createTestContext(contract, stubAdapter),
      driver,
      verifyMarker: false,
    });

    const plan = planFromAst(
      SelectAst.from(TableSource.named('Thing')).withProjection([
        ProjectionItem.of('tags', ColumnRef.of('Thing', 'tags'), {
          codecId: 'pg/text@1',
          many: true,
        }),
      ]),
      contract,
    );

    const rows = await runtime.query(plan).toArray();

    expect(listDecoderWireValues).toEqual(['{a,b}']);
    expect(rows).toEqual([{ tags: ['a', 'b'] }]);

    await runtime.close();
  });
});
