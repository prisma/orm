import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlExecutionStackWithDriver, SqlRuntimeDriverInstance } from '../src/sql-context';
import { capabilitiesTheStackDoesNotProvide } from '../src/stack-capabilities';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContract,
  createTestTargetDescriptor,
} from './utils';

type Capabilities = Record<string, Record<string, boolean>>;

function contractRequiring(capabilities: Capabilities): Contract<SqlStorage> {
  return { ...createTestContract({}), capabilities };
}

function stackDeclaring(declared: {
  readonly database?: Capabilities;
  readonly adapter?: Capabilities;
  readonly driver?: Capabilities;
  readonly extension?: Capabilities;
}): SqlExecutionStackWithDriver<'postgres'> {
  return {
    target: {
      ...createTestTargetDescriptor(),
      ...(declared.database === undefined ? {} : { databaseCapabilities: declared.database }),
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

describe('capabilitiesTheStackDoesNotProvide', () => {
  it('is empty when the adapter and driver provide every capability that is not the database’s', () => {
    const contract = contractRequiring({
      sql: { returning: true, interactiveTransactions: true, lateral: true },
    });
    const stack = stackDeclaring({
      database: { sql: { returning: true } },
      adapter: { sql: { lateral: true } },
      driver: { sql: { interactiveTransactions: true } },
    });

    expect(capabilitiesTheStackDoesNotProvide(contract, stack)).toEqual([]);
  });

  it('names each capability the contract requires that neither the database nor the adapter and driver provide', () => {
    const contract = contractRequiring({
      sql: { returning: true, interactiveTransactions: true },
      http: { batch: true },
    });
    const stack = stackDeclaring({ database: { sql: { returning: true } } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stack)).toEqual([
      'sql.interactiveTransactions',
      'http.batch',
    ]);
  });

  it('leaves the database’s capabilities to signing, which checks them: the adapter and driver need not declare them', () => {
    const contract = contractRequiring({ postgres: { distinctOn: true } });
    const stack = stackDeclaring({ database: { postgres: { distinctOn: true } } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stack)).toEqual([]);
  });

  it('ignores a flag the contract turns off', () => {
    const contract = contractRequiring({ sql: { interactiveTransactions: false } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stackDeclaring({}))).toEqual([]);
  });

  it('counts a flag a component turns off as not provided', () => {
    const contract = contractRequiring({ sql: { interactiveTransactions: true } });
    const stack = stackDeclaring({ driver: { sql: { interactiveTransactions: false } } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stack)).toEqual([
      'sql.interactiveTransactions',
    ]);
  });

  it('counts what the stack’s extensions declare as provided', () => {
    const contract = contractRequiring({ pgvector: { hnsw: true } });
    const stack = stackDeclaring({ extension: { pgvector: { hnsw: true } } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stack)).toEqual([]);
  });

  it('treats a target that declares no database capabilities as providing none', () => {
    const contract = contractRequiring({ sql: { returning: true } });

    expect(capabilitiesTheStackDoesNotProvide(contract, stackDeclaring({}))).toEqual([
      'sql.returning',
    ]);
    expect(
      capabilitiesTheStackDoesNotProvide(
        contract,
        stackDeclaring({ adapter: { sql: { returning: true } } }),
      ),
    ).toEqual([]);
  });
});
