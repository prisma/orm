import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const idColumn = { id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false } };
const userTable = { columns: idColumn, uniques: [], indexes: [], foreignKeys: [] };

function contractWithModelStorage(storage: Record<string, unknown>) {
  return createContract({
    domain: {
      namespaces: {
        app: {
          models: { User: { fields: {}, relations: {}, storage } },
        },
      },
    },
    storage: {
      namespaces: {
        app: { id: 'app', entries: { table: { user: userTable } } },
      },
    },
  });
}

describe('validateTypes', () => {
  it('passes when there is no storage to walk', () => {
    expect(() => sqlEmission.validateTypes(createContract({ storage: {} }), {})).not.toThrow();
  });

  it('rejects a column with no codec id', () => {
    const contract = createContract({
      storage: { tables: { user: { columns: { id: { dataType: 'pg/uuid' } } } } },
    });

    expect(() => sqlEmission.validateTypes(contract, {})).toThrow(
      'Column "id" in table "user" is missing codecId',
    );
  });

  it('rejects a codec id outside the ns/name@version shape', () => {
    const contract = createContract({
      storage: { tables: { user: { columns: { id: { dataType: 'pg/uuid', codecId: 'uuid' } } } } },
    });

    expect(() => sqlEmission.validateTypes(contract, {})).toThrow(
      'has invalid codec ID format "uuid"',
    );
  });
});

describe('validateStructure', () => {
  it('rejects a contract from another family', () => {
    expect(() => sqlEmission.validateStructure(createContract({ targetFamily: 'mongo' }))).toThrow(
      'Expected targetFamily "sql", got "mongo"',
    );
  });

  it('rejects a model with no storage table', () => {
    expect(() =>
      sqlEmission.validateStructure(contractWithModelStorage({ namespaceId: 'app', fields: {} })),
    ).toThrow('Model "app:User" is missing storage.table');
  });

  it('rejects a model with no storage namespace', () => {
    expect(() =>
      sqlEmission.validateStructure(
        contractWithModelStorage({ namespaceId: undefined, table: 'user', fields: {} }),
      ),
    ).toThrow('Model "app:User" is missing storage.namespaceId');
  });

  it('rejects a model whose storage namespace disagrees with its domain namespace', () => {
    expect(() =>
      sqlEmission.validateStructure(
        contractWithModelStorage({ namespaceId: 'other', table: 'user', fields: {} }),
      ),
    ).toThrow('Model "app:User" storage.namespaceId "other" does not match domain namespace "app"');
  });

  it('rejects a model with no storage fields', () => {
    expect(() =>
      sqlEmission.validateStructure(
        contractWithModelStorage({ namespaceId: 'app', table: 'user', fields: {} }),
      ),
    ).toThrow('Model "app:User" is missing storage.fields');
  });

  it('rejects a table with no uniques array', () => {
    const contract = createContract({
      storage: { tables: { user: { columns: idColumn, indexes: [], foreignKeys: [] } } },
    });

    expect(() => sqlEmission.validateStructure(contract)).toThrow(
      'Table "user" is missing required field "uniques" (must be an array)',
    );
  });
});

describe('storage type emission for namespace kinds', () => {
  function storageTypeFor(namespaces: Record<string, unknown>): string {
    return sqlEmission.generateStorageType(
      createContract({
        domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
        storage: { namespaces },
      }),
      'StorageHash',
    );
  }

  it('spells a bound schema namespace as a postgres schema', () => {
    const dts = storageTypeFor({
      app: { id: 'app', kind: 'schema', entries: { table: { user: userTable } } },
    });

    expect(dts).toContain('readonly kind: "postgres-schema"');
  });

  it('spells the unbound schema namespace distinctly', () => {
    const dts = storageTypeFor({
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'schema',
        entries: { table: { user: userTable } },
      },
    });

    expect(dts).toContain('readonly kind: "postgres-unbound-schema"');
  });

  it('emits an empty namespace map as Record<string, never>', () => {
    expect(storageTypeFor({})).toContain('Record<string, never>');
  });

  it('orders namespaces and their value sets by name', () => {
    const dts = storageTypeFor({
      zeta: { id: 'zeta', kind: 'schema', entries: { table: { audit: userTable } } },
      alpha: {
        id: 'alpha',
        kind: 'schema',
        entries: {
          table: { user: userTable },
          valueSet: {
            Status: { kind: 'valueSet', values: ['on', 'off'] },
            Role: { kind: 'valueSet', values: ['user', 'admin'] },
          },
        },
      },
    });

    expect(dts.indexOf('alpha')).toBeLessThan(dts.indexOf('zeta'));
    expect(dts.indexOf('Role')).toBeLessThan(dts.indexOf('Status'));
  });
});

describe('getStorageTypeExports', () => {
  it('resolves to nothing without storage namespaces', () => {
    expect(sqlEmission.getStorageTypeExports(createContract({ storage: {} }))).toBeUndefined();
  });

  it('orders the column type maps by namespace name', () => {
    const exports = sqlEmission.getStorageTypeExports(
      createContract({
        storage: {
          namespaces: {
            zeta: { id: 'zeta', entries: { table: { audit: userTable } } },
            alpha: { id: 'alpha', entries: { table: { user: userTable } } },
          },
        },
      }),
    );

    expect(exports?.indexOf('alpha')).toBeLessThan(exports?.indexOf('zeta') ?? -1);
  });

  it('emits both column type maps as Record<string, never> for an empty namespace map', () => {
    const exports = sqlEmission.getStorageTypeExports(
      createContract({ storage: { namespaces: {} } }),
    );

    expect(exports).toBe(
      [
        'export type StorageColumnTypes = Record<string, never>;',
        'export type StorageColumnInputTypes = Record<string, never>;',
      ].join('\n'),
    );
  });

  it('falls back to the codec type when a column names a value set the storage does not carry', () => {
    const exports = sqlEmission.getStorageTypeExports(
      createContract({
        storage: {
          namespaces: {
            app: {
              id: 'app',
              entries: {
                table: {
                  user: {
                    columns: {
                      role: {
                        dataType: 'pg/text',
                        codecId: 'pg/text@1',
                        nullable: false,
                        valueSet: {
                          namespaceId: 'app',
                          entityKind: 'valueSet',
                          entityName: 'Missing',
                        },
                      },
                    },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
      }),
    );

    expect(exports).toBe(
      [
        'export type StorageColumnTypes = { readonly app: { readonly user: { readonly role: CodecTypes["pg/text@1"]["output"] } } };',
        'export type StorageColumnInputTypes = { readonly app: { readonly user: { readonly role: CodecTypes["pg/text@1"]["input"] } } };',
      ].join('\n'),
    );
  });
});
