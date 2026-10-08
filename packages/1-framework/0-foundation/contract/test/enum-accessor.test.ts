import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { ContractEnumAccessor, EnumMemberNames, EnumValues } from '../src/enum-accessor';
import {
  buildEnumsMapForNamespace,
  buildNamespacedEnums,
  createEnumAccessor,
} from '../src/enum-accessor';
import type { JsonValue } from '../src/types';
import { enumMemberCodec } from './support/enum-member-codec';

type ContractWithDomain<TDomain> = Contract & { readonly domain: TDomain };

const storedForms = () =>
  enumMemberCodec({
    fromStored: (json: JsonValue) => json,
    toStored: (value: unknown) => value as JsonValue,
  });

const roleEnum = {
  codecId: 'pg/text@1',
  members: [
    { name: 'User', value: 'user' },
    { name: 'Admin', value: 'admin' },
  ],
} as const;

const statusEnum = {
  codecId: 'pg/text@1',
  members: [
    { name: 'Active', value: 'active' },
    { name: 'Inactive', value: 'inactive' },
    { name: 'Pending', value: 'pending' },
  ],
} as const;

describe('createEnumAccessor()', () => {
  describe('.values', () => {
    it('returns member values in declaration order', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.values).toEqual(['user', 'admin']);
    });

    it('preserves declaration order with more than two members', () => {
      const accessor = createEnumAccessor(statusEnum);
      expect(accessor.values).toEqual(['active', 'inactive', 'pending']);
    });
  });

  describe('.names', () => {
    it('returns member names in declaration order', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.names).toEqual(['User', 'Admin']);
    });
  });

  describe('.members', () => {
    it('maps member names to their values', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.members).toEqual({ User: 'user', Admin: 'admin' });
    });

    it('resolves each member name to the correct value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.members['User']).toBe('user');
      expect(accessor.members['Admin']).toBe('admin');
    });
  });

  describe('.has()', () => {
    it('returns true for a declared member value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('user')).toBe(true);
      expect(accessor.has('admin')).toBe(true);
    });

    it('returns false for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('superadmin')).toBe(false);
      expect(accessor.has('')).toBe(false);
    });

    it('is case-sensitive', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.has('User')).toBe(false);
      expect(accessor.has('ADMIN')).toBe(false);
    });
  });

  describe('.hasName()', () => {
    it('returns true for a declared member name', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.hasName('User')).toBe(true);
      expect(accessor.hasName('Admin')).toBe(true);
    });

    it('returns false for an undeclared member name', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.hasName('SuperAdmin')).toBe(false);
      expect(accessor.hasName('')).toBe(false);
    });

    it('is case-sensitive', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.hasName('user')).toBe(false);
      expect(accessor.hasName('ADMIN')).toBe(false);
    });
  });

  describe('.nameOf()', () => {
    it('returns the member name for a declared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.nameOf('user')).toBe('User');
      expect(accessor.nameOf('admin')).toBe('Admin');
    });

    it('returns undefined for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.nameOf('superadmin')).toBeUndefined();
    });
  });

  describe('.ordinalOf()', () => {
    it('returns the zero-based declaration index for a declared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.ordinalOf('user')).toBe(0);
      expect(accessor.ordinalOf('admin')).toBe(1);
    });

    it('returns -1 for an undeclared value', () => {
      const accessor = createEnumAccessor(roleEnum);
      expect(accessor.ordinalOf('superadmin')).toBe(-1);
    });

    it('preserves declaration order across three members', () => {
      const accessor = createEnumAccessor(statusEnum);
      expect(accessor.ordinalOf('active')).toBe(0);
      expect(accessor.ordinalOf('inactive')).toBe(1);
      expect(accessor.ordinalOf('pending')).toBe(2);
    });
  });
});

describe('buildEnumsMapForNamespace()', () => {
  it('collects only the requested namespace enums', () => {
    const domain = {
      namespaces: {
        public: {
          enum: { Role: roleEnum, Status: statusEnum },
        },
      },
    };

    const map = buildEnumsMapForNamespace(domain, 'public', storedForms);
    expect(Object.keys(map).sort()).toEqual(['Role', 'Status']);
    expect(map['Role']?.values).toEqual(['user', 'admin']);
    expect(map['Status']?.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('returns an empty map when the namespace has no enums', () => {
    const domain = {
      namespaces: {
        public: { enum: {} },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'public', storedForms)).toEqual({});
  });

  it('returns an empty map for an unknown namespace', () => {
    const domain = {
      namespaces: {
        public: { enum: { Role: roleEnum } },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'audit', storedForms)).toEqual({});
  });

  it('keeps same-named enums in different namespaces separate', () => {
    const domain = {
      namespaces: {
        public: { enum: { Role: roleEnum } },
        audit: { enum: { Role: statusEnum } },
      },
    };

    expect(buildEnumsMapForNamespace(domain, 'public', storedForms)['Role']?.values).toEqual([
      'user',
      'admin',
    ]);
    expect(buildEnumsMapForNamespace(domain, 'audit', storedForms)['Role']?.values).toEqual([
      'active',
      'inactive',
      'pending',
    ]);
  });
});

describe('buildNamespacedEnums()', () => {
  it('keys the accessor map by namespace then enum name', () => {
    const domain = {
      namespaces: {
        public: { models: {}, enum: { Role: roleEnum, Status: statusEnum } },
      },
    };

    const enums = buildNamespacedEnums<ContractWithDomain<typeof domain>>(domain, storedForms);
    expect(Object.keys(enums).sort()).toEqual(['public']);
    expect(enums['public']?.['Role']?.values).toEqual(['user', 'admin']);
    expect(enums['public']?.['Status']?.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('resolves same-named enums in different namespaces independently', () => {
    const domain = {
      namespaces: {
        public: { models: {}, enum: { Role: roleEnum } },
        audit: { models: {}, enum: { Role: statusEnum } },
      },
    };

    const enums = buildNamespacedEnums<ContractWithDomain<typeof domain>>(domain, storedForms);
    expect(enums['public']?.['Role']?.values).toEqual(['user', 'admin']);
    expect(enums['audit']?.['Role']?.values).toEqual(['active', 'inactive', 'pending']);
  });

  it('exposes member accessors and helpers per namespace', () => {
    const domain = {
      namespaces: { public: { models: {}, enum: { Role: roleEnum } } },
    };

    const role = buildNamespacedEnums<ContractWithDomain<typeof domain>>(domain, storedForms)[
      'public'
    ]?.['Role'];
    expect(role?.members['User']).toBe('user');
    expect(role?.has('admin')).toBe(true);
    expect(role?.nameOf('user')).toBe('User');
    expect(role?.ordinalOf('admin')).toBe(1);
  });

  it('yields an empty enum map for a namespace without enums', () => {
    const domain = {
      namespaces: { public: { models: {} } },
    };

    expect(buildNamespacedEnums<ContractWithDomain<typeof domain>>(domain, storedForms)).toEqual({
      public: {},
    });
  });
});

describe('ContractEnumAccessor type surface', () => {
  type RoleEntry = typeof roleEnum;
  type RoleAccessor = ContractEnumAccessor<RoleEntry>;

  it('has() narrows to the value union', () => {
    const v: string = 'user';
    const accessor = createEnumAccessor(roleEnum) as RoleAccessor;
    if (accessor.has(v)) {
      expectTypeOf(v).toEqualTypeOf<'user' | 'admin'>();
    }
  });

  it('hasName() narrows to the member-name union', () => {
    const n: string = 'User';
    const accessor = createEnumAccessor(roleEnum) as RoleAccessor;
    if (accessor.hasName(n)) {
      expectTypeOf(n).toEqualTypeOf<'User' | 'Admin'>();
    }
  });

  it('EnumValues extracts the literal value union', () => {
    expectTypeOf<EnumValues<RoleAccessor>>().toEqualTypeOf<'user' | 'admin'>();
    expectTypeOf<EnumValues<RoleAccessor>>().not.toEqualTypeOf<string>();
  });

  it('EnumMemberNames extracts the literal name union', () => {
    expectTypeOf<EnumMemberNames<RoleAccessor>>().toEqualTypeOf<'User' | 'Admin'>();
    expectTypeOf<EnumMemberNames<RoleAccessor>>().not.toEqualTypeOf<string>();
  });
});
