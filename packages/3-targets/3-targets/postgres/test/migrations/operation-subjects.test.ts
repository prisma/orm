import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { type FieldEventCall, subjectsOfCalls } from '@internal/family-sql/control';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresCallSubjects } from '../../src/core/migrations/operation-subjects';
import { PostgresSchema } from '../../src/core/postgres-schema';

const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('subjects'),
  storage: new SqlStorage({
    storageHash: coreHash('subjects'),
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        entries: {
          table: {
            User: new StorageTable({
              columns: { id: text, email: text, bio: text },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              uniques: [],
              indexes: [],
            }),
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({
    models: {
      User: {
        fields: {},
        relations: {},
        storage: {
          table: 'User',
          namespaceId: 'public',
          fields: { id: { column: 'id' }, email: { column: 'email' }, bio: { column: 'bio' } },
        },
      },
    },
  }),
  capabilities: {},
  extensions: {},
  meta: {},
};

function destructiveCall(factoryName: string): OpFactoryCall {
  return {
    factoryName,
    operationClass: 'destructive',
    label: `Drop the search config: ${factoryName}`,
    renderTypeScript: () => '',
    importRequirements: () => [],
    toOp: () => {
      throw new Error('not lowered');
    },
  };
}

function subjectsOf(calls: readonly OpFactoryCall[], fieldEvents: readonly FieldEventCall[]) {
  return subjectsOfCalls(
    postgresCallSubjects(calls, {
      contract,
      fieldEvents: new Map(fieldEvents.map((fieldEvent) => [fieldEvent.call, fieldEvent])),
    }),
    { fromContract: contract, contract, statements: [] },
  ).dataLoss;
}

describe('postgresCallSubjects', () => {
  it('names the field of each destructive codec hook call', () => {
    const onEmail = destructiveCall('dropSearchConfig');
    const onBio = destructiveCall('dropSearchConfig');
    const field = (call: OpFactoryCall, columnName: string): FieldEventCall => ({
      call,
      namespaceId: 'public',
      tableName: 'User',
      columnName,
    });

    expect(subjectsOf([onEmail, onBio], [field(onEmail, 'email'), field(onBio, 'bio')])).toEqual([
      {
        operationIndex: 0,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('__unbound__'),
          model: 'User',
          field: 'email',
        },
      },
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('__unbound__'),
          model: 'User',
          field: 'bio',
        },
      },
    ]);
  });

  it('numbers destructive calls of one unknown factory, never naming them by label', () => {
    expect(
      subjectsOf(
        [destructiveCall('rebuild'), destructiveCall('rebuild'), destructiveCall('purge')],
        [],
      ),
    ).toEqual([
      { operationIndex: 0, subject: { kind: 'storage', name: 'rebuild#1' } },
      { operationIndex: 1, subject: { kind: 'storage', name: 'rebuild#2' } },
      { operationIndex: 2, subject: { kind: 'storage', name: 'purge' } },
    ]);
  });
});
