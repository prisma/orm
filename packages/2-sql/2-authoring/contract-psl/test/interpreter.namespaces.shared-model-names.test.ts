import type { ContractModel } from '@internal/contract/types';
import type { ForeignKey, SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const baseInput = {
  dataTypes: fixtureDataTypeSupport,
  target: postgresTarget,
  scalarColumnDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

describe('two namespaces declaring the same bare model name', () => {
  const schema = `namespace public {
  model User {
    id Int @id @map("public_id")
    profiles Profile[]
    @@map("public_users")
  }
  model Profile {
    id Int @id
    userId Int @map("profile_user_id")
    user User @relation(fields: [userId], references: [id])
    @@map("profile")
  }
}

namespace auth {
  model User {
    id Int @id @map("auth_id")
    sessions Session[]
    @@map("auth_users")
  }
  model Session {
    id Int @id
    userId Int @map("session_user_id")
    user User @relation(fields: [userId], references: [id])
    @@map("session")
  }
}
`;

  function interpret() {
    const result = interpretSqlContract(schema, { ...baseInput });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failure.summary);
    return result.value;
  }

  function foreignKeysOf(storage: SqlStorage, namespaceId: string, table: string) {
    const entry = storage.namespaces[namespaceId]?.entries.table?.[table];
    expect(entry).toBeDefined();
    return (entry?.foreignKeys ?? []) as readonly ForeignKey[];
  }

  function modelsOf(
    contract: ReturnType<typeof interpret>,
    namespaceId: string,
  ): Record<string, ContractModel<SqlModelStorage>> | undefined {
    return contract.domain.namespaces[namespaceId]?.models as
      | Record<string, ContractModel<SqlModelStorage>>
      | undefined;
  }

  it('lowers each unqualified relation to the User declared in its own namespace', () => {
    const storage = interpret().storage as SqlStorage;

    expect(foreignKeysOf(storage, 'public', 'profile')).toMatchObject([
      {
        source: { columns: ['profile_user_id'] },
        target: { namespaceId: 'public', tableName: 'public_users', columns: ['public_id'] },
      },
    ]);
    expect(foreignKeysOf(storage, 'auth', 'session')).toMatchObject([
      {
        source: { columns: ['session_user_id'] },
        target: { namespaceId: 'auth', tableName: 'auth_users', columns: ['auth_id'] },
      },
    ]);
  });

  it('points each domain relation at the User in its own namespace', () => {
    const contract = interpret();

    expect(modelsOf(contract, 'public')?.['Profile']?.relations?.['user']?.to).toEqual({
      namespace: 'public',
      model: 'User',
    });
    expect(modelsOf(contract, 'auth')?.['Session']?.relations?.['user']?.to).toEqual({
      namespace: 'auth',
      model: 'User',
    });
  });

  it('pairs backrelations within each namespace when both model names are shared', () => {
    const shared = ['public', 'auth']
      .map(
        (namespace) => `namespace ${namespace} {
  model User {
    id Int @id
    memberships Membership[]
    @@map("${namespace}_users")
  }
  model Membership {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
    @@map("${namespace}_memberships")
  }
}`,
      )
      .join('\n');
    const result = interpretSqlContract(shared, { ...baseInput });
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) throw new Error(result.failure.summary);

    for (const namespace of ['public', 'auth']) {
      const models = modelsOf(result.value, namespace);
      expect(models?.['User']?.relations).toEqual({
        memberships: {
          cardinality: '1:N',
          to: { namespace, model: 'Membership' },
          on: { localFields: ['id'], targetFields: ['userId'] },
        },
      });
      expect(models?.['Membership']?.relations).toEqual({
        user: {
          cardinality: 'N:1',
          nullable: false,
          to: { namespace, model: 'User' },
          on: { localFields: ['userId'], targetFields: ['id'] },
        },
      });
    }
  });

  it('checks singular backrelation uniqueness on the resolved source model', () => {
    const shared = ['public', 'auth']
      .map(
        (namespace) => `namespace ${namespace} {
  model User {
    id Int @id
    membership Membership?
  }
  model Membership {
    id Int @id
    userId Int ${namespace === 'public' ? '@unique' : ''}
    user User @relation(fields: [userId], references: [id])
  }
}`,
      )
      .join('\n');
    const result = interpretSqlContract(shared, { ...baseInput });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a non-unique backrelation');
    expect(
      result.failure.diagnostics.map(({ code, span }) => ({ code, line: span?.start.line })),
    ).toEqual([{ code: 'PSL_NON_UNIQUE_BACKRELATION', line: 15 }]);
  });

  it("does not consume another namespace's rejected FK pairing", () => {
    const shared = `namespace public {
  model User {
    id Int @id
    memberships Membership[]
  }
  model Membership {
    id Int @id
  }
}
namespace auth {
  model User {
    id Int @id
    memberships Membership[]
  }
  model Membership {
    id Int @id
    userId Int?
    user User @relation(fields: [userId], references: [id])
  }
}`;
    const result = interpretSqlContract(shared, { ...baseInput });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid relations');
    expect(
      result.failure.diagnostics.map(({ code, span }) => ({ code, line: span?.start.line })),
    ).toEqual([
      { code: 'PSL_RELATION_NULLABILITY_MISMATCH', line: 18 },
      { code: 'PSL_ORPHANED_BACKRELATION', line: 4 },
    ]);
  });

  it('pairs junctions by resolved source and target identities', () => {
    const shared = ['public', 'auth']
      .map(
        (namespace) => `namespace ${namespace} {
  model User {
    id Int @id
    groups Group[]
  }
  model Group {
    id Int @id
    users User[]
  }
  model Membership {
    userId Int
    groupId Int
    user User @relation(fields: [userId], references: [id])
    group Group @relation(fields: [groupId], references: [id])
    @@id([userId, groupId])
  }
}`,
      )
      .join('\n');
    const result = interpretSqlContract(shared, { ...baseInput });
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) throw new Error(result.failure.summary);
    for (const namespace of ['public', 'auth']) {
      const models = modelsOf(result.value, namespace);
      expect(models?.['User']?.relations).toEqual({
        groups: {
          cardinality: 'N:M',
          to: { namespace, model: 'Group' },
          on: { localFields: ['id'], targetFields: ['userId'] },
          through: {
            namespaceId: namespace,
            table: 'Membership',
            parentColumns: ['userId'],
            childColumns: ['groupId'],
            targetColumns: ['id'],
          },
        },
      });
      expect(models?.['Group']?.relations).toEqual({
        users: {
          cardinality: 'N:M',
          to: { namespace, model: 'User' },
          on: { localFields: ['id'], targetFields: ['groupId'] },
          through: {
            namespaceId: namespace,
            table: 'Membership',
            parentColumns: ['groupId'],
            childColumns: ['userId'],
            targetColumns: ['id'],
          },
        },
      });
    }
  });

  it('matches each backrelation to the FK side in its own namespace', () => {
    const contract = interpret();

    expect(modelsOf(contract, 'public')?.['User']?.relations?.['profiles']).toMatchObject({
      cardinality: '1:N',
      to: { namespace: 'public', model: 'Profile' },
    });
    expect(modelsOf(contract, 'auth')?.['User']?.relations?.['sessions']).toMatchObject({
      cardinality: '1:N',
      to: { namespace: 'auth', model: 'Session' },
    });
  });
});
