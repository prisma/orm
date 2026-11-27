import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';

const ns = UNBOUND_NAMESPACE_ID;

const entries = {
  role: { app_user: { kind: 'role', name: 'app_user', namespaceId: ns } },
  policy: {
    posts_read: {
      kind: 'policy',
      name: 'posts_read',
      tableName: 'posts',
      namespaceId: ns,
      operation: 'select',
      roles: ['app_user'],
      permissive: true,
    },
  },
  rls: { posts: { kind: 'rls', tableName: 'posts', namespaceId: ns } },
  native_enum: {
    Level: { kind: 'postgres-enum', typeName: 'level', members: ['low'], control: 'external' },
  },
} as const;

function storedContract(extra?: { readonly kind: string; readonly name: string }) {
  const contract = createSqlContract({
    storage: {
      namespaces: {
        [ns]: {
          id: ns,
          entries: {
            table: {
              posts: {
                columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            ...Object.fromEntries(
              Object.entries(entries).map(([kind, byName]) => [
                kind,
                Object.fromEntries(
                  Object.entries(byName).map(([name, entry]) => [
                    name,
                    extra?.kind === kind && extra.name === name
                      ? { ...entry, unexpected: true }
                      : entry,
                  ]),
                ),
              ]),
            ),
          },
        },
      },
    },
  });
  return { formatVersion: 1, ...contract };
}

describe('a Postgres contract with a key its format does not define', () => {
  it('is accepted without the key', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(storedContract()),
    ).not.toThrow();
  });

  it.each([
    { kind: 'role', name: 'app_user' },
    { kind: 'policy', name: 'posts_read' },
    { kind: 'rls', name: 'posts' },
    { kind: 'native_enum', name: 'Level' },
  ])('is refused in a $kind entry, naming the key', (place) => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(storedContract(place)),
    ).toThrow(
      `storage.namespaces.${ns}.entries.${place.kind}.${place.name}.unexpected must be removed`,
    );
  });
});
