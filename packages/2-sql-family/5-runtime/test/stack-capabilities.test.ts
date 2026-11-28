import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlExecutionStackWithDriver, SqlRuntimeDriverInstance } from '../src/sql-context';
import {
  assertInteractiveTransactionsListed,
  capabilitiesNotProvided,
  warnOfCapabilitiesNotProvided,
} from '../src/stack-capabilities';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContract,
  createTestTargetDescriptor,
} from './utils';

type Capabilities = Record<string, Record<string, boolean>>;

function contractRequiring(capabilities: Capabilities): Contract<SqlStorage> {
  return createTestContract({ capabilities });
}

function stackDeclaring(declared: {
  readonly database?: Record<string, Record<string, true>>;
  readonly retired?: Record<string, Record<string, true>>;
  readonly adapter?: Capabilities;
  readonly driver?: Capabilities;
  readonly extension?: Capabilities;
}): SqlExecutionStackWithDriver<'postgres'> {
  return {
    target: {
      ...createTestTargetDescriptor(),
      ...(declared.database === undefined ? {} : { databaseCapabilities: declared.database }),
      ...(declared.retired === undefined ? {} : { retiredCapabilities: declared.retired }),
    },
    adapter: {
      ...createTestAdapterDescriptor(createStubAdapter()),
      capabilities: declared.adapter ?? {},
    },
    driver: {
      kind: 'driver',
      id: 'test-driver',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      capabilities: declared.driver ?? {},
      create(): SqlRuntimeDriverInstance<'postgres'> {
        throw new Error('not created in these tests');
      },
    },
    extensions:
      declared.extension === undefined
        ? []
        : [
            {
              kind: 'extension',
              id: 'test-extension',
              version: '0.0.1',
              familyId: 'sql',
              targetId: 'postgres',
              capabilities: declared.extension,
              codecs: () => [],
              create: () => ({ familyId: 'sql', targetId: 'postgres' }),
            },
          ],
  };
}

describe('capabilitiesNotProvided', () => {
  it('is empty when the adapter and driver provide every capability that is not the database’s', () => {
    const contract = contractRequiring({
      sql: { returning: true, interactiveTransactions: true, lateral: true },
    });
    const stack = stackDeclaring({
      database: { sql: { returning: true } },
      adapter: { sql: { lateral: true } },
      driver: { sql: { interactiveTransactions: true } },
    });

    expect(capabilitiesNotProvided(contract, stack)).toEqual([]);
  });

  it('names each capability the contract requires that neither the database nor the adapter and driver provide', () => {
    const contract = contractRequiring({
      sql: { returning: true, interactiveTransactions: true },
      http: { batch: true },
    });
    const stack = stackDeclaring({ database: { sql: { returning: true } } });

    expect(capabilitiesNotProvided(contract, stack)).toEqual([
      'sql.interactiveTransactions',
      'http.batch',
    ]);
  });

  it('leaves the database’s capabilities to signing, which checks them: the adapter and driver need not declare them', () => {
    const contract = contractRequiring({ postgres: { distinctOn: true } });
    const stack = stackDeclaring({ database: { postgres: { distinctOn: true } } });

    expect(capabilitiesNotProvided(contract, stack)).toEqual([]);
  });

  it('ignores a flag the contract turns off', () => {
    const contract = contractRequiring({ sql: { interactiveTransactions: false } });

    expect(capabilitiesNotProvided(contract, stackDeclaring({}))).toEqual([]);
  });

  it('counts a flag a component turns off as not provided', () => {
    const contract = contractRequiring({ sql: { interactiveTransactions: true } });
    const stack = stackDeclaring({ driver: { sql: { interactiveTransactions: false } } });

    expect(capabilitiesNotProvided(contract, stack)).toEqual(['sql.interactiveTransactions']);
  });

  it('does not count what an extension declares: the target, the adapter and the driver declare capabilities', () => {
    const contract = contractRequiring({ pgvector: { hnsw: true } });
    const stack = stackDeclaring({ extension: { pgvector: { hnsw: true } } });

    expect(capabilitiesNotProvided(contract, stack)).toEqual(['pgvector.hnsw']);
  });

  it('ignores a capability the target retired, which an earlier release wrote into every contract', () => {
    const contract = contractRequiring({
      postgres: { orderBy: true, distinctOn: true },
      sql: { enums: true },
    });
    const stack = stackDeclaring({
      database: { postgres: { distinctOn: true } },
      retired: { postgres: { orderBy: true }, sql: { enums: true } },
    });

    expect(capabilitiesNotProvided(contract, stack)).toEqual([]);
  });

  it('treats a target that declares no database capabilities as providing none', () => {
    const contract = contractRequiring({ sql: { returning: true } });

    expect(capabilitiesNotProvided(contract, stackDeclaring({}))).toEqual(['sql.returning']);
    expect(
      capabilitiesNotProvided(contract, stackDeclaring({ adapter: { sql: { returning: true } } })),
    ).toEqual([]);
  });
});

describe('warnOfCapabilitiesNotProvided', () => {
  function spyLog() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }
  const contract = contractRequiring({ sql: { interactiveTransactions: true } });

  it('warns once with the code, the missing capabilities and what to do, for a connection capability the driver lacks', () => {
    const log = spyLog();
    warnOfCapabilitiesNotProvided(contract, stackDeclaring({}), { log });
    expect(log.warn.mock.calls).toEqual([
      [
        {
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          scope: 'stack-verification',
          missing: ['sql.interactiveTransactions'],
          message:
            "Your contract requires `sql.interactiveTransactions`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.",
        },
      ],
    ]);
  });

  it('warns the same for a capability no version of the database provides, which signing leaves to the client', () => {
    const log = spyLog();
    warnOfCapabilitiesNotProvided(
      contractRequiring({ sql: { returning: true, someNewThing: true } }),
      stackDeclaring({ database: { sql: { returning: true } } }),
      { log },
    );
    expect(log.warn.mock.calls).toEqual([
      [
        {
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          scope: 'stack-verification',
          missing: ['sql.someNewThing'],
          message:
            "Your contract requires `sql.someNewThing`, which this client's connection does not provide. Remove it from your contract's required capabilities, or connect with a driver that provides it.",
        },
      ],
    ]);
  });

  it('lists several missing capabilities and uses the plural', () => {
    const log = spyLog();
    warnOfCapabilitiesNotProvided(
      contractRequiring({ http: { batch: true }, sql: { interactiveTransactions: true } }),
      stackDeclaring({}),
      { log },
    );
    expect(log.warn.mock.calls).toEqual([
      [
        {
          code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED',
          scope: 'stack-verification',
          missing: ['http.batch', 'sql.interactiveTransactions'],
          message:
            "Your contract requires `http.batch` and `sql.interactiveTransactions`, which this client's connection does not provide. Remove them from your contract's required capabilities, or connect with a driver that provides them.",
        },
      ],
    ]);
  });

  it('warns nothing when the stack provides them, or when verifyMarker is false', () => {
    const log = spyLog();
    warnOfCapabilitiesNotProvided(
      contract,
      stackDeclaring({ driver: { sql: { interactiveTransactions: true } } }),
      { log },
    );
    warnOfCapabilitiesNotProvided(contract, stackDeclaring({}), { log, verifyMarker: false });
    expect(log.warn).not.toHaveBeenCalled();
  });

  describe('given no log', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('warns on console.warn', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warnOfCapabilitiesNotProvided(contract, stackDeclaring({}), {});
      expect(warn.mock.calls).toEqual([
        [expect.objectContaining({ code: 'CONTRACT.CAPABILITIES_NOT_PROVIDED' })],
      ]);
    });
  });
});

describe('assertInteractiveTransactionsListed', () => {
  it('accepts a contract that lists interactive transactions', () => {
    const contract = contractRequiring({ sql: { interactiveTransactions: true } });
    expect(() => assertInteractiveTransactionsListed(contract, undefined)).not.toThrow();
  });

  it('accepts a contract an earlier release emitted, which names a retired capability: every client of that release offered transaction()', () => {
    const contract = contractRequiring({ postgres: { orderBy: true }, sql: {} });
    expect(() =>
      assertInteractiveTransactionsListed(contract, { postgres: { orderBy: true } }),
    ).not.toThrow();
  });

  it('refuses one that does not, naming the capability', () => {
    expect(() =>
      assertInteractiveTransactionsListed(contractRequiring({ sql: {} }), {
        postgres: { orderBy: true },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          "`transaction()` is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. To enable it, add `sql.interactiveTransactions` to your contract's required capabilities.",
        meta: { capability: 'sql.interactiveTransactions', method: 'transaction' },
      }),
    );
  });
});
