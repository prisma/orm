import type { Contract } from '@internal/contract/types';
import type { MongoContract } from '@internal/mongo-contract';
import { createMongoExecutionContext, type MongoExecutionStack } from '@internal/mongo-runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createExecutionContext, type SqlExecutionStack } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';

interface Requirements {
  readonly targetFamily: string;
  readonly target: string;
  readonly extensions: Record<string, unknown>;
}

function stackOf(family: string) {
  const component = (id: string, kind: string) => ({
    kind,
    id,
    familyId: family,
    targetId: 'mongo',
    version: '0.0.1',
    create: () => ({ familyId: family, targetId: 'mongo' }),
  });
  return {
    target: component('test-target', 'target'),
    adapter: component('test-adapter', 'adapter'),
    extensions: [component('present', 'extension')],
  };
}

function mongoMessage(contract: Requirements): string {
  try {
    createMongoExecutionContext({
      contract: { domain: { namespaces: {} }, ...contract } as unknown as MongoContract,
      stack: stackOf('mongo') as unknown as MongoExecutionStack<'mongo'>,
    });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the MongoDB context accepted the contract');
}

function sqlMessage(contract: Requirements): string {
  try {
    createExecutionContext({
      contract: contract as unknown as Contract<SqlStorage>,
      stack: stackOf('sql') as unknown as SqlExecutionStack<'mongo'>,
    });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the SQL context accepted the contract');
}

describe('the MongoDB contract requirement messages', () => {
  it('equal the SQL messages for a contract of another target', () => {
    const contract = { targetFamily: 'sql', target: 'other', extensions: {} };
    expect(mongoMessage({ ...contract, targetFamily: 'mongo' })).toBe(sqlMessage(contract));
  });

  it('equal the SQL messages for missing extension packs', () => {
    const contract = { target: 'mongo', extensions: { present: {}, x: {}, y: {} } };
    expect(mongoMessage({ ...contract, targetFamily: 'mongo' })).toBe(
      sqlMessage({ ...contract, targetFamily: 'sql' }),
    );
  });

  it('equal the SQL messages for a contract of another family, but for the family each runtime names', () => {
    const contract = { targetFamily: 'document', target: 'mongo', extensions: {} };
    expect(mongoMessage(contract)).toBe(
      sqlMessage(contract).replace("runtime family 'sql'", "runtime family 'mongo'"),
    );
  });
});
