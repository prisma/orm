import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  type FieldEventCall,
  NO_RENAMED_ORIGINS,
  subjectsOfCalls,
} from '@internal/family-sql/control';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  DeleteRowsCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
} from '../../src/core/migrations/op-factory-call';
import { sqliteCallSubjects } from '../../src/core/migrations/operation-subjects';
import { sqliteTableRenameByHand } from '../../src/core/migrations/table-rename-calls';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const text = { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false };

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('subjects'),
  storage: new SqlStorage({
    storageHash: coreHash('subjects'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
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
          namespaceId: UNBOUND_NAMESPACE_ID,
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
    sqliteCallSubjects(
      calls,
      new Map(fieldEvents.map((fieldEvent) => [fieldEvent.call, fieldEvent])),
    ),
    {
      fromContract: contract,
      contract,
      byHand: sqliteTableRenameByHand,
      origins: NO_RENAMED_ORIGINS,
    },
  ).dataLoss;
}

describe('sqliteCallSubjects', () => {
  it('names the field of each destructive codec hook call', () => {
    const onEmail = destructiveCall('dropSearchConfig');
    const onBio = destructiveCall('dropSearchConfig');
    const field = (call: OpFactoryCall, columnName: string): FieldEventCall => ({
      call,
      namespaceId: UNBOUND_NAMESPACE_ID,
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

describe('stored value operations', () => {
  it('name the column a removed value is lost from, and lose nothing when a value is replaced', () => {
    expect(
      subjectsOf(
        [
          new ReplaceStoredValueCall('User', 'bio', 'a', 'b'),
          new RemoveStoredValueCall('User', 'email', 'x'),
        ],
        [],
      ),
    ).toEqual([
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
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
          new RenameStoredKeyCall('User', 'email', '$.lat', 'latitude'),
          new RemoveStoredKeyCall('User', 'email', '$[*].lat'),
        ],
        [],
      ),
    ).toEqual([
      {
        operationIndex: 1,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
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
    expect(subjectsOf([new DeleteRowsCall('User', 'email', 'x')], [])).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'model', namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'User' },
        loss: 'drop',
        label: 'Delete the rows of "User" that hold value "x" in column "email"',
      },
    ]);
  });
});
