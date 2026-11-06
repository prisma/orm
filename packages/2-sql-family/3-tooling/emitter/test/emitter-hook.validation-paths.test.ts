import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { identityCodecLookup } from './value-set-codec-lookups';

const idColumn = { id: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false } };
const userTable = { columns: idColumn, uniques: [], indexes: [], foreignKeys: [] };

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

  const statusColumn = {
    dataType: 'pg/text',
    codecId: 'pg/text@1',
    nullable: false,
    valueSet: { namespaceId: 'alpha', entityKind: 'valueSet', entityName: 'Status' },
  };
  const statusTable = {
    columns: { status: statusColumn },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
  const statusValueSet = { Status: { kind: 'valueSet', values: ['on', 'off'] } };

  it('orders the column type overrides by namespace and table name', () => {
    const exports = sqlEmission.getStorageTypeExports(
      createContract({
        storage: {
          namespaces: {
            zeta: { id: 'zeta', entries: { table: { audit: statusTable } } },
            alpha: {
              id: 'alpha',
              entries: {
                table: { user: statusTable, account: statusTable },
                valueSet: statusValueSet,
              },
            },
          },
        },
      }),
      identityCodecLookup,
    );

    expect(exports?.indexOf('alpha')).toBeLessThan(exports?.indexOf('zeta') ?? -1);
    expect(exports?.indexOf('account')).toBeLessThan(exports?.indexOf('user') ?? -1);
  });

  it('types both column maps by the column type generic over the contract storage', () => {
    const exports = sqlEmission.getStorageTypeExports(
      createContract({ storage: { namespaces: {} } }),
    );

    expect(exports).toBe(
      [
        'type ColumnTypeOverrides = {  };',
        'export type StorageColumnTypes = ColumnTypesFromStorage<ContractBase[\'storage\'], CodecTypes, ParameterizedOutputTypeFunctions, ColumnTypeOverrides, "output">;',
        'export type StorageColumnInputTypes = ColumnTypesFromStorage<ContractBase[\'storage\'], CodecTypes, ParameterizedOutputTypeFunctions, ColumnTypeOverrides, "input">;',
      ].join('\n'),
    );
  });

  it('gives no type override to a column that names a value set the storage does not carry', () => {
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
      identityCodecLookup,
    );

    expect(exports).toContain('type ColumnTypeOverrides = {  };');
  });
});
