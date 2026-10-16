import type { Contract, JsonValue } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import { SqlStorage } from '@internal/sql-contract/types';
import type { Codec, SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { defineTestCodec } from './test-codec';
import { createTestRuntime as createRuntime, descriptorsFromCodecs } from './utils';

/**
 * Documents the contract: when a `SqlMiddleware.intercept.onQuery` handler short-circuits execution and returns raw rows, those rows go through the SQL runtime's normal codec decode pass — exactly as if they had come from the driver.
 *
 * The cache middleware (TML-2143 M3) relies on this: it stores raw (undecoded) rows on first execution, then returns them from `intercept.onQuery` on subsequent executions. Decoding happens once per row consumption regardless of whether the row originated from the driver or the cache.
 */

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

/**
 * A JSON codec that takes wire-format strings and decodes them into parsed objects. Used to demonstrate that intercepted rows containing JSON-encoded values come back to the consumer as parsed objects.
 */
function createJsonCodecs(): ReadonlyArray<Codec<string>> {
  return [
    defineTestCodec({
      typeId: 'pg/jsonb@1',
      toWire: (value: string | JsonValue): string => JSON.stringify(value),
      fromWire: (wire: string | JsonValue): JsonValue =>
        typeof wire === 'string' ? (JSON.parse(wire) as JsonValue) : wire,
    }),
    defineTestCodec({
      typeId: 'pg/int4@1',
      toWire: (v: number) => v,
      fromWire: (w: number) => w,
    }),
  ];
}

function createStubAdapter(codecs: ReadonlyArray<Codec<string>>) {
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createMockDriver(): SqlDriver {
  const rootExecute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    // Default driver path; real test cases below either intercept (skipping this) or assert it was called.
    yield {} as Record<string, unknown>;
  });

  return {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: rootExecute,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used in this test')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.profile.codecs());
  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createTestSetup(middleware: readonly SqlMiddleware[]) {
  const codecs = createJsonCodecs();
  const adapter = createStubAdapter(codecs);
  const driver = createMockDriver();

  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);

  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;

  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensions: [] },
  });

  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verifyMarker: false,
    middleware,
  });

  return { runtime, driver };
}

/**
 * Builds an execution plan whose AST projection maps the named alias to the JSON codec via `ProjectionItem.codecId`, so any row yielded for this plan (driver or intercepted) is decoded through the JSON codec before reaching the consumer.
 */
function createJsonProjectionPlan(alias: string): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users')).withProjection([
    ProjectionItem.of(alias, ColumnRef.of('users', alias), { codecId: 'pg/jsonb@1' }),
  ]);
  return {
    sql: 'select profile from users',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('intercepted rows go through codec decoding', () => {
  it('decodes JSON wire values returned by an interceptor into parsed objects', async () => {
    const wireValue = JSON.stringify({ name: 'Alice', tags: ['admin', 'staff'] });

    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      intercept: {
        async onQuery() {
          // Raw wire row, as the driver would have produced it: a string containing JSON-encoded data.
          return { rows: [{ profile: wireValue }] };
        },
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.query(plan).toArray();

    // The consumer must see the *decoded* value (a parsed object), not the raw wire string.
    expect(out).toEqual([{ profile: { name: 'Alice', tags: ['admin', 'staff'] } }]);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('decodes multiple intercepted rows independently', async () => {
    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      intercept: {
        async onQuery() {
          return {
            rows: [
              { profile: JSON.stringify({ id: 1 }) },
              { profile: JSON.stringify({ id: 2 }) },
              { profile: JSON.stringify({ id: 3 }) },
            ],
          };
        },
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.query(plan).toArray();

    expect(out).toEqual([{ profile: { id: 1 } }, { profile: { id: 2 } }, { profile: { id: 3 } }]);
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('decodes intercepted rows yielded from an AsyncIterable', async () => {
    async function* asyncRows(): AsyncGenerator<Record<string, unknown>, void, unknown> {
      yield { profile: JSON.stringify({ kind: 'first' }) };
      yield { profile: JSON.stringify({ kind: 'second' }) };
    }

    const interceptor: SqlMiddleware = {
      name: 'mock-cache',
      familyId: 'sql',
      intercept: {
        async onQuery() {
          return { rows: asyncRows() };
        },
      },
    };

    const { runtime, driver } = createTestSetup([interceptor]);
    const plan = createJsonProjectionPlan('profile');

    const out = await runtime.query(plan).toArray();

    expect(out).toEqual([{ profile: { kind: 'first' } }, { profile: { kind: 'second' } }]);
    expect(driver.query).not.toHaveBeenCalled();
  });

  it('decodes driver rows and intercepted rows the same way (round-trip via the same codec path)', async () => {
    // First, capture what the driver path produces for a known wire value.
    const driverDecoded = await (async () => {
      const wireValue = JSON.stringify({ x: 42 });

      // No interceptor — driver path.
      const { runtime, driver } = createTestSetup([]);

      // Override the driver to produce the wire value.
      (driver.query as ReturnType<typeof vi.fn>).mockImplementation(async function* (
        _request: SqlExecuteRequest,
      ) {
        yield { profile: wireValue };
      });

      const out = await runtime.query(createJsonProjectionPlan('profile')).toArray();
      return out;
    })();

    expect(driverDecoded).toEqual([{ profile: { x: 42 } }]);

    // Now run the same wire value through the intercept path.
    const interceptedDecoded = await (async () => {
      const wireValue = JSON.stringify({ x: 42 });

      const interceptor: SqlMiddleware = {
        name: 'mock-cache',
        familyId: 'sql',
        intercept: {
          async onQuery() {
            return { rows: [{ profile: wireValue }] };
          },
        },
      };

      const { runtime } = createTestSetup([interceptor]);
      return runtime.query(createJsonProjectionPlan('profile')).toArray();
    })();

    // Both paths produce identical decoded output.
    expect(interceptedDecoded).toEqual(driverDecoded);
  });
});
