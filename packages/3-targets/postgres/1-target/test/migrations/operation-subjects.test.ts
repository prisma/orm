import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  type FieldEventCall,
  NO_RENAMED_ORIGINS,
  subjectsOfCalls,
} from '@internal/family-sql/control';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  DeleteRowsCall,
  DropSchemaCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameSchemaCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
  SetTableSchemaCall,
} from '../../src/core/migrations/op-factory-call';
import { postgresCallSubjects } from '../../src/core/migrations/operation-subjects';
import { postgresTableRenameByHand } from '../../src/core/migrations/table-rename-calls';
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
    {
      fromContract: contract,
      contract,
      byHand: postgresTableRenameByHand(contract),
      origins: NO_RENAMED_ORIGINS,
    },
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
        loss: 'drop',
        label: 'Drop the search config: dropSearchConfig',
      },
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('__unbound__'),
          model: 'User',
          field: 'bio',
        },
        loss: 'drop',
        label: 'Drop the search config: dropSearchConfig',
      },
    ]);
  });

  it('numbers destructive calls of one unknown factory, never naming their subject by label', () => {
    expect(
      subjectsOf(
        [destructiveCall('rebuild'), destructiveCall('rebuild'), destructiveCall('purge')],
        [],
      ),
    ).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'rebuild#1' },
        loss: 'drop',
        label: 'Drop the search config: rebuild',
      },
      {
        operationIndex: 1,
        subject: { kind: 'storage', name: 'rebuild#2' },
        loss: 'drop',
        label: 'Drop the search config: rebuild',
      },
      {
        operationIndex: 2,
        subject: { kind: 'storage', name: 'purge' },
        loss: 'drop',
        label: 'Drop the search config: purge',
      },
    ]);
  });
});

describe('schema operations', () => {
  it('ask nothing: a table move, a schema rename and a schema drop lose no data and change no access', () => {
    const calls = [
      new SetTableSchemaCall('public', 'User', 'billing'),
      new RenameSchemaCall('billing', 'finance'),
      new DropSchemaCall('finance'),
    ];

    expect(
      postgresCallSubjects(calls, { contract, fieldEvents: new Map() }).map(
        ({ dataLoss, accessChanges }) => ({ dataLoss, accessChanges }),
      ),
    ).toEqual(calls.map(() => ({ dataLoss: [], accessChanges: [] })));
  });
});

describe('stored value operations', () => {
  it('name the column a removed value is lost from, and lose nothing when a value is replaced', () => {
    expect(
      subjectsOf(
        [
          new ReplaceStoredValueCall('public', 'User', 'bio', 'a', 'b', false),
          new RemoveStoredValueCall('public', 'User', 'email', 'x', false),
        ],
        [],
      ),
    ).toEqual([
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('__unbound__'),
          model: 'User',
          field: 'email',
        },
        loss: 'drop',
        label: 'Remove value "x" from column "email" of "User"',
      },
    ]);
  });
});

describe('stored key operations', () => {
  it('name the column a removed key is lost from, and lose nothing when a key is renamed', () => {
    expect(
      subjectsOf(
        [
          new RenameStoredKeyCall('public', 'User', 'email', '$.lat', 'latitude'),
          new RemoveStoredKeyCall('public', 'User', 'email', '$[*].lat'),
        ],
        [],
      ),
    ).toEqual([
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('__unbound__'),
          model: 'User',
          field: 'email',
        },
        loss: 'drop',
        label: 'Remove key "lat" at path "$[*]" in column "email" of "User"',
      },
    ]);
  });
});

describe('deleteRows', () => {
  it('names the model whose rows it deletes', () => {
    expect(subjectsOf([new DeleteRowsCall('public', 'User', 'email', 'x')], [])).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'model', namespaceId: asNamespaceId('__unbound__'), model: 'User' },
        loss: 'drop',
        label: 'Delete the rows of "User" that hold value "x" in column "email"',
      },
    ]);
  });
});
