import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresExtension } from '../src/core/postgres-extension';
import { PostgresSchema } from '../src/core/postgres-schema';

function contractWithExtensions(extensions: Readonly<Record<string, unknown>>) {
  const base = createSqlContract({
    storage: { namespaces: { extensions: { id: 'extensions', entries: { table: {} } } } },
  });
  return {
    ...base,
    storage: {
      ...base.storage,
      namespaces: {
        extensions: {
          ...base.storage.namespaces['extensions']!,
          entries: { ...base.storage.namespaces['extensions']!.entries, extension: extensions },
        },
      },
    },
  };
}

describe('extension entries in the Postgres contract serializer', () => {
  it('hydrates each extension entry as a PostgresExtension on its namespace', () => {
    const contract = new PostgresContractSerializer().deserializeContract(
      contractWithExtensions({
        postgis: { kind: 'extension', name: 'postgis' },
        vector: { kind: 'extension', name: 'vector', control: 'external' },
      }),
    );
    const namespace = contract.storage.namespaces['extensions'];
    expect(namespace).toBeInstanceOf(PostgresSchema);
    expect((namespace as PostgresSchema).extension).toEqual({
      postgis: new PostgresExtension({ name: 'postgis' }),
      vector: new PostgresExtension({ name: 'vector', control: 'external' }),
    });
  });

  it('writes extension entries back as they were read', () => {
    const serializer = new PostgresContractSerializer();
    const json = serializer.serializeContract(
      serializer.deserializeContract(
        contractWithExtensions({ postgis: { kind: 'extension', name: 'postgis' } }),
      ),
    );
    expect(
      JSON.parse(JSON.stringify(json)).storage.namespaces.extensions.entries.extension,
    ).toEqual({ postgis: { kind: 'extension', name: 'postgis' } });
  });

  it('refuses one extension declared in two namespaces', () => {
    const contract = createSqlContract({
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: { table: {}, extension: { postgis: { kind: 'extension', name: 'postgis' } } },
          },
          extensions: {
            id: 'extensions',
            entries: { table: {}, extension: { postgis: { kind: 'extension', name: 'postgis' } } },
          },
        },
      },
    });
    expect(() => new PostgresContractSerializer().deserializeContract(contract)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        message:
          'Extension "postgis" is declared in namespaces "extensions" and "public". An extension\'s name is unique in the database, so a contract declares it in one namespace only.',
      }),
    );
  });

  it('refuses an extension entry carrying a version', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(
        contractWithExtensions({ postgis: { kind: 'extension', name: 'postgis', version: '3' } }),
      ),
    ).toThrow();
  });
});
