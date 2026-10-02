import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { isStorageValueSet, type SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { defineContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../1-core/contract/test/test-type-lookups';
import { TestSqlContractSerializer as SqlContractSerializer } from './test-sql-contract-serializer';

// ---------------------------------------------------------------------------
// Minimal pack stubs — codec is passed explicitly to enumType
// ---------------------------------------------------------------------------

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

// ---------------------------------------------------------------------------
// Serializer round-trip: domain enum + storage value-set survive JSON ↔ IR
// ---------------------------------------------------------------------------

describe('value-set serializer hydration + round-trip', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  const authored = defineContract(
    {
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
    },
    ({ field: f, model: m }) =>
      ({
        models: {
          Post: m('Post', {
            fields: {
              id: f.text().id(),
              role: f.namedType(Role),
            },
          }),
        },
      }) as const,
  ) as Contract<SqlStorage>;

  it('StorageValueSet is a StorageValueSet instance before serialization', () => {
    const ns = authored.storage.namespaces['public'];
    const valueSet = ns !== undefined ? ns.entries.valueSet?.['Role'] : undefined;
    expect(isStorageValueSet(valueSet)).toBe(true);
  });

  it('round-trips through JSON and hydrates back to a StorageValueSet instance', () => {
    const serializer = new SqlContractSerializer();
    const json = JSON.parse(JSON.stringify(authored));
    const hydrated = serializer.deserializeContract(json) as Contract<SqlStorage>;

    const ns = hydrated.storage.namespaces['public'];
    const valueSet = ns !== undefined ? ns.entries.valueSet?.['Role'] : undefined;
    expect(isStorageValueSet(valueSet)).toBe(true);
    expect(valueSet?.kind).toBe('valueSet');
    expect(valueSet?.values).toEqual(['user', 'admin']);
  });

  it('hydrated valueSet discriminator is intact', () => {
    const serializer = new SqlContractSerializer();
    const json = JSON.parse(JSON.stringify(authored));
    const hydrated = serializer.deserializeContract(json) as Contract<SqlStorage>;

    const ns = hydrated.storage.namespaces['public'];
    const valueSet = ns !== undefined ? ns.entries.valueSet?.['Role'] : undefined;
    expect(valueSet?.kind).toBe('valueSet');
  });

  it('domain enum slot round-trips as plain data', () => {
    const serializer = new SqlContractSerializer();
    const json = JSON.parse(JSON.stringify(authored));
    const hydrated = serializer.deserializeContract(json) as Contract<SqlStorage>;

    const domainEnum = hydrated.domain.namespaces['public']?.enum?.['Role'];
    expect(domainEnum).toEqual({
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('storage column valueSet ref round-trips', () => {
    const serializer = new SqlContractSerializer();
    const json = JSON.parse(JSON.stringify(authored));
    const hydrated = serializer.deserializeContract(json) as Contract<SqlStorage>;

    const storageNs = hydrated.storage.namespaces['public'];
    const roleColumn =
      storageNs !== undefined ? storageNs.entries.table?.['Post']?.columns?.['role'] : undefined;
    expect(roleColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });

  it('domain field valueSet ref round-trips', () => {
    const serializer = new SqlContractSerializer();
    const json = JSON.parse(JSON.stringify(authored));
    const hydrated = serializer.deserializeContract(json) as Contract<SqlStorage>;

    const domainNs = hydrated.domain.namespaces['public'];
    const roleField = domainNs?.models?.['Post']?.fields?.['role'];
    expect(roleField?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });

  it('serialization followed by deserialization is stable (double round-trip)', () => {
    const serializer = new SqlContractSerializer();
    const json1 = JSON.parse(JSON.stringify(authored));
    const hydrated1 = serializer.deserializeContract(json1) as Contract<SqlStorage>;
    const json2 = JSON.parse(JSON.stringify(hydrated1));
    const hydrated2 = serializer.deserializeContract(json2) as Contract<SqlStorage>;

    const ns2 = hydrated2.storage.namespaces['public'];
    const valueSet = ns2 !== undefined ? ns2.entries.valueSet?.['Role'] : undefined;
    expect(isStorageValueSet(valueSet)).toBe(true);
    expect(valueSet?.values).toEqual(['user', 'admin']);
  });
});

// ---------------------------------------------------------------------------
// Validator: accepts valid value-set + enum; rejects malformed input
// ---------------------------------------------------------------------------

describe('validators — value-set and enum', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  const validContract = defineContract(
    {
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
    },
    ({ field: f, model: m }) =>
      ({
        models: {
          Post: m('Post', {
            fields: {
              id: f.text().id(),
              role: f.namedType(Role),
            },
          }),
        },
      }) as const,
  ) as Contract<SqlStorage>;

  it('validateSqlContractFully accepts a contract with a domain enum + storage value-set', () => {
    const json = JSON.parse(JSON.stringify(validContract));
    expect(() => validateSqlContractFully(json)).not.toThrow();
  });

  it('rejects a value-set entry with missing values array', () => {
    const json = JSON.parse(JSON.stringify(validContract)) as Record<string, unknown>;
    const storage = json['storage'] as Record<string, unknown>;
    const namespaces = storage['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    const entries = publicNs['entries'] as Record<string, unknown>;
    entries['valueSet'] = { Role: { kind: 'valueSet' } }; // missing values
    expect(() => validateSqlContractFully(json)).toThrow();
  });

  it('rejects a value-set entry where values is not an array', () => {
    const json = JSON.parse(JSON.stringify(validContract)) as Record<string, unknown>;
    const storage = json['storage'] as Record<string, unknown>;
    const namespaces = storage['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    const entries = publicNs['entries'] as Record<string, unknown>;
    entries['valueSet'] = { Role: { kind: 'valueSet', values: 'not-an-array' } };
    expect(() => validateSqlContractFully(json)).toThrow();
  });

  it('rejects a domain enum member missing name', () => {
    const json = JSON.parse(JSON.stringify(validContract)) as Record<string, unknown>;
    const domain = json['domain'] as Record<string, unknown>;
    const namespaces = domain['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    publicNs['enum'] = {
      Role: {
        codecId: 'pg/text@1',
        members: [{ value: 'user' }], // missing name
      },
    };
    expect(() => validateSqlContractFully(json)).toThrow();
  });

  it('rejects a domain enum member missing value', () => {
    const json = JSON.parse(JSON.stringify(validContract)) as Record<string, unknown>;
    const domain = json['domain'] as Record<string, unknown>;
    const namespaces = domain['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    publicNs['enum'] = {
      Role: {
        codecId: 'pg/text@1',
        members: [{ name: 'User' }], // missing value
      },
    };
    expect(() => validateSqlContractFully(json)).toThrow();
  });

  it('rejects a domain enum with missing codecId', () => {
    const json = JSON.parse(JSON.stringify(validContract)) as Record<string, unknown>;
    const domain = json['domain'] as Record<string, unknown>;
    const namespaces = domain['namespaces'] as Record<string, unknown>;
    const publicNs = namespaces['public'] as Record<string, unknown>;
    publicNs['enum'] = {
      Role: {
        // missing codecId
        members: [{ name: 'User', value: 'user' }],
      },
    };
    expect(() => validateSqlContractFully(json)).toThrow();
  });
});
