import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

// ---------------------------------------------------------------------------
// Minimal pack stubs (no postgres target needed — codec is passed explicitly)
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

// A minimal codec descriptor that carries the codecId the
// `enumType` API requires — same shape as a FieldPreset output / ColumnTypeDescriptor.
const pgText = { codecId: 'pg/text@1' as const } as const;

// ---------------------------------------------------------------------------
// member()
// ---------------------------------------------------------------------------

describe('member()', () => {
  it('preserves name and value as literal types', () => {
    const m = member('User', 'user');
    expectTypeOf(m.name).toEqualTypeOf<'User'>();
    expectTypeOf(m.value).toEqualTypeOf<'user'>();
  });

  it('defaults value to name when omitted', () => {
    const m = member('Admin');
    expect(m.value).toBe('Admin');
    expectTypeOf(m.value).toEqualTypeOf<'Admin'>();
  });

  it('returns correct runtime values', () => {
    const m = member('User', 'user');
    expect(m).toEqual({ name: 'User', value: 'user' });
  });
});

// ---------------------------------------------------------------------------
// enumType() — static shape
// ---------------------------------------------------------------------------

describe('enumType() — static type preservation', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('preserves literal value tuple on .values', () => {
    expectTypeOf(Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
  });

  it('preserves literal name tuple on .names', () => {
    expectTypeOf(Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
  });

  it('.members accessor returns literals', () => {
    expectTypeOf(Role.members.User).toEqualTypeOf<'user'>();
    expectTypeOf(Role.members.Admin).toEqualTypeOf<'admin'>();
  });

  it('invalid member access is a type error', () => {
    // @ts-expect-error — 'Guest' is not a member of Role
    Role.members.Guest;
  });
});

// ---------------------------------------------------------------------------
// enumType() — runtime behaviour
// ---------------------------------------------------------------------------

describe('enumType() — runtime behaviour', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('exposes correct runtime .values', () => {
    expect(Role.values).toEqual(['user', 'admin']);
  });

  it('exposes correct runtime .names', () => {
    expect(Role.names).toEqual(['User', 'Admin']);
  });

  it('exposes correct .members accessor', () => {
    expect(Role.members.User).toBe('user');
    expect(Role.members.Admin).toBe('admin');
  });

  it('.has() returns true for valid values', () => {
    expect(Role.has('user')).toBe(true);
    expect(Role.has('admin')).toBe(true);
  });

  it('.has() returns false for unknown values', () => {
    const notAMember = 'guest' as 'user' | 'admin';
    expect(Role.has(notAMember)).toBe(false);
  });

  it('.nameOf() returns the name for a valid value', () => {
    expect(Role.nameOf('user')).toBe('User');
    expect(Role.nameOf('admin')).toBe('Admin');
  });

  it('.nameOf() returns undefined for an unknown value', () => {
    const notAMember = 'guest' as 'user' | 'admin';
    expect(Role.nameOf(notAMember)).toBeUndefined();
  });

  it('.ordinalOf() returns the zero-based index', () => {
    expect(Role.ordinalOf('user')).toBe(0);
    expect(Role.ordinalOf('admin')).toBe(1);
  });

  it('.ordinalOf() returns -1 for an unknown value', () => {
    const notAMember = 'guest' as 'user' | 'admin';
    expect(Role.ordinalOf(notAMember)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// enumType() — well-formedness guards
// ---------------------------------------------------------------------------

describe('enumType() — well-formedness guards', () => {
  it('throws on empty member list', () => {
    expect(() => enumType('Empty', pgText)).toThrow(/at least one member/i);
  });

  it('throws on duplicate names', () => {
    expect(() => enumType('Dupe', pgText, member('User', 'user'), member('User', 'user2'))).toThrow(
      /duplicate.*name/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Authoring → structure
//
// The `SqlContractResult` type used by `defineContract` narrows the
// storage namespace entries to `{ table: ... }` and domain fields to
// `{ nullable, type }` for DSL inference purposes. Tests that verify
// `valueSet` / `enum` wiring access the contract as `Contract<SqlStorage>`
// so the full IR types are visible.
// ---------------------------------------------------------------------------

describe('enumType() authoring → contract structure', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('emits domain enum entry', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
      models: {},
    }) as Contract<SqlStorage>;

    const domainNs = contract.domain.namespaces['public'];
    expect(domainNs?.enum?.['Role']).toEqual({
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('emits storage valueSet entry', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
      models: {},
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const valueSet = storageNs !== undefined ? storageNs.entries.valueSet?.['Role'] : undefined;
    expect(valueSet).toBeDefined();
    expect(valueSet?.values).toEqual(['user', 'admin']);
  });

  it('field.namedType(handle) sets valueSet on domain field', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const domainNs = contract.domain.namespaces['public'];
    const userModel = domainNs?.models?.['User'];
    const roleField = userModel?.fields?.['role'];
    expect(roleField?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });

  it('field.namedType(handle) sets valueSet on storage column', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;
    const roleColumn = userTable?.columns?.['role'];
    expect(roleColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });

  it('field.namedType(handle) does not set typeRef on storage column', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs !== undefined ? storageNs.entries.table?.['User'] : undefined;
    const roleColumn = userTable?.columns?.['role'];
    expect(roleColumn?.typeRef).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-namespace ref alignment
//
// Authored enums always register in the contract's default namespace.
// A model that lives in a non-default namespace must still produce valueSet
// refs that point at the default namespace (where the enum is registered),
// not at the model's own namespace.
// ---------------------------------------------------------------------------

describe('enumType() — valueSet ref namespace (non-default model namespace)', () => {
  it('field/column valueSet refs point at the default namespace even when the model is in a non-default namespace', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

    const contract = defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      namespaces: ['public', 'auth'],
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          namespace: 'auth',
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    // The enum is registered in 'public' (the default namespace).
    const domainDefaultNs = contract.domain.namespaces['public'];
    expect(domainDefaultNs?.enum?.['Role']).toBeDefined();

    // The model lives in 'auth', but the field's valueSet ref must point at 'public'.
    const domainAuthNs = contract.domain.namespaces['auth'];
    const userModel = domainAuthNs?.models?.['User'];
    const roleField = userModel?.fields?.['role'];
    expect(roleField?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      entityName: 'Role',
    });

    // Same check on the storage side.
    const storageAuthNs = contract.storage.namespaces['auth'];
    const userTable =
      storageAuthNs !== undefined ? storageAuthNs.entries.table?.['User'] : undefined;
    const roleColumn = userTable?.columns?.['role'];
    expect(roleColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'public',
      entityName: 'Role',
    });
  });
});

// ---------------------------------------------------------------------------
// Alias-key mismatch guard
// ---------------------------------------------------------------------------

describe('enumType() — declaration key must match enumType name', () => {
  it('throws when the enums object key differs from the enumType name', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { MyAlias: Role },
        models: {},
      }),
    ).toThrow(/enum declaration key "MyAlias" must match enumType name "Role"/);

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { MyAlias: Role },
        models: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ENUM_INVALID' }));
  });
});

// ---------------------------------------------------------------------------
// Full integration with model builder DSL
// ---------------------------------------------------------------------------

describe('enumType() — full integration via defineContract factory', () => {
  it('produces correct domain + storage structure when field uses namedType', () => {
    const Status = enumType(
      'Status',
      pgText,
      member('Active', 'active'),
      member('Inactive', 'inactive'),
    );

    const contract = defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        enums: { Status },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            Post: m('Post', {
              fields: {
                id: f.text().id(),
                status: f.namedType(Status),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    // domain enum
    const domainNs = contract.domain.namespaces['public'];
    expect(domainNs?.enum?.['Status']).toMatchObject({
      codecId: 'pg/text@1',
      members: [
        { name: 'Active', value: 'active' },
        { name: 'Inactive', value: 'inactive' },
      ],
    });

    // storage value-set
    const storageNs = contract.storage.namespaces['public'];
    expect(
      storageNs !== undefined ? storageNs.entries.valueSet?.['Status']?.values : undefined,
    ).toEqual(['active', 'inactive']);

    // domain field valueSet
    const postModel = domainNs?.models?.['Post'];
    expect(postModel?.fields?.['status']?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      entityName: 'Status',
    });

    // storage column valueSet
    const postTable = storageNs !== undefined ? storageNs.entries.table?.['Post'] : undefined;
    expect(postTable?.columns?.['status']?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'public',
      entityName: 'Status',
    });
  });
});
