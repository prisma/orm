import type { Contract } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ContractDefinition, HintEntry, ModelNode } from '../src/contract-definition';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const idDescriptor = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

function tableModel(modelName: string, tableName: string, namespaceId?: string): ModelNode {
  return {
    modelName,
    tableName,
    ...(namespaceId === undefined ? {} : { namespaceId }),
    fields: [{ fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false }],
    id: { columns: ['id'] },
  };
}

const models = [
  tableModel('User', 'users'),
  tableModel('Post', 'posts'),
  tableModel('Session', 'sessions', 'auth'),
];

function definition(hints: readonly HintEntry[]): ContractDefinition {
  return {
    target: postgresTargetPack,
    warnings: undefined,
    createNamespace: createTestSqlNamespace,
    models,
    hints,
  };
}

function emitted(hints: readonly HintEntry[]) {
  return JSON.parse(JSON.stringify(buildSqlContractFromDefinition(definition(hints))));
}

describe('contract hints section', () => {
  it('omits the hints key when the definition has no entries', () => {
    expect(emitted([])).not.toHaveProperty('hints');
  });

  it('groups table entries by namespace, resolving an undefined namespace to the default', () => {
    const hints = emitted([
      { namespaceId: undefined, table: 'users', hint: { was: 'profiles' } },
      { namespaceId: 'public', table: 'posts', hint: { was: 'articles' } },
      { namespaceId: 'auth', table: 'sessions', hint: { was: 'logins' } },
    ]).hints;
    expect(hints).toEqual({
      namespaces: {
        auth: { tables: { sessions: { was: 'logins' } } },
        public: { tables: { posts: { was: 'articles' }, users: { was: 'profiles' } } },
      },
    });
  });

  it('builds a section the SQL contract validator accepts', () => {
    const json = emitted([{ namespaceId: undefined, table: 'users', hint: { was: 'profiles' } }]);
    expect(validateSqlContractFully<Contract<SqlStorage>>(json).hints).toEqual({
      namespaces: { public: { tables: { users: { was: 'profiles' } } } },
    });
  });

  it('leaves the storage, execution and profile hashes unchanged', () => {
    const withHints = emitted([
      { namespaceId: undefined, table: 'users', hint: { was: 'profiles' } },
    ]);
    const { hints: _hints, ...withoutHintsKey } = withHints;
    expect(withoutHintsKey).toEqual(emitted([]));
  });
});
