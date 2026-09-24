import type { AnyCodecDescriptor, Codec } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MongoContractSchema } from '@internal/mongo-contract';
import { type } from 'arktype';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const identityDescriptor = (id: string): AnyCodecDescriptor => ({
  codecId: id,
  dataType: dataTypeId('demo/fixture'),
  traits: ['equality'],
  targetTypes: ['string'],
  paramsSchema: undefined,
  isParameterized: false,
  factory: () => () =>
    ({
      id,
      encode: async (v: unknown) => v,
      decode: async (v: unknown) => v,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    }) as unknown as Codec,
});

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  types: { codecTypes: { codecDescriptors: [identityDescriptor('mongo/string@1')] } },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const mongoString = { codecId: 'mongo/string@1' as const, nativeType: 'string' } as const;

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
});

describe('enumType() — Mongo binding', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));

  it('preserves literal value tuple on .values', () => {
    expectTypeOf(Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
  });

  it('preserves literal name tuple on .names', () => {
    expectTypeOf(Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
  });

  it('exposes members accessor map', () => {
    expectTypeOf(Role.members.User).toEqualTypeOf<'user'>();
    expectTypeOf(Role.members.Admin).toEqualTypeOf<'admin'>();
    expect(Role.members.User).toBe('user');
    expect(Role.members.Admin).toBe('admin');
  });

  it('runtime helpers work', () => {
    expect(Role.has('user')).toBe(true);
    const notAMember = 'unknown' as 'user' | 'admin';
    expect(Role.has(notAMember)).toBe(false);
    expect(Role.nameOf('user')).toBe('User');
    expect(Role.ordinalOf('admin')).toBe(1);
    expect(Role.ordinalOf(notAMember)).toBe(-1);
  });

  it('stores codecId and nativeType', () => {
    expect(Role.codecId).toBe('mongo/string@1');
    expect(Role.nativeType).toBe('string');
  });
});

describe('builder accumulation + contract-schema acceptance', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));

  const Account = model('Account', {
    collection: 'accounts',
    fields: {
      _id: field.objectId(),
      role: field.namedType(Role),
    },
  });

  const contract = defineContract({
    family: mongoFamilyPack,
    target: mongoTargetPack,
    enums: { Role },
    models: { Account },
  });

  it('accumulates the enum entity in domain.namespaces[__unbound__].enum', () => {
    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    const enumSlot = (ns as Record<string, unknown>)['enum'] as Record<string, unknown> | undefined;
    expect(enumSlot).toBeDefined();
    expect(enumSlot?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('stamps the field valueSet ref on the Account.role field', () => {
    const roleField = contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Account']?.fields[
      'role'
    ] as Record<string, unknown> | undefined;
    expect(roleField).toBeDefined();
    expect(roleField?.['valueSet']).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
    });
  });

  it('emits the storage value set alongside the domain enum', () => {
    const envelope = JSON.parse(JSON.stringify(contract)) as {
      storage: {
        namespaces: Record<
          string,
          { entries: { valueSet?: Record<string, { kind: string; values: unknown[] }> } }
        >;
      };
    };
    const ns = envelope.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns?.entries.valueSet?.['Role']).toEqual({
      kind: 'valueSet',
      values: ['user', 'admin'],
    });
  });

  it('passes Mongo arktype contract-schema validation', () => {
    const envelope = JSON.parse(JSON.stringify(contract)) as unknown;
    const result = MongoContractSchema(envelope);
    expect(result instanceof type.errors).toBe(false);
  });
});

describe('MongoContractSchema — enum validation', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));
  const Account = model('Account', {
    collection: 'accounts',
    fields: { _id: field.objectId(), role: field.namedType(Role) },
  });
  const baseContract = JSON.parse(
    JSON.stringify(
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        enums: { Role },
        models: { Account },
      }),
    ),
  ) as Record<string, unknown>;

  it('rejects an enum with empty members array', () => {
    const malformed = {
      ...baseContract,
      domain: {
        ...(baseContract['domain'] as Record<string, unknown>),
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...((
              (baseContract['domain'] as Record<string, unknown>)['namespaces'] as Record<
                string,
                unknown
              >
            )[UNBOUND_NAMESPACE_ID] as Record<string, unknown>),
            enum: { Role: { codecId: 'mongo/string@1', members: [] } },
          },
        },
      },
    };
    const result = MongoContractSchema(malformed);
    expect(result instanceof type.errors).toBe(true);
  });
});

describe('enumType() — error cases', () => {
  it('throws on empty member list', () => {
    expect(() => enumType('Status', mongoString)).toThrow('must have at least one member');
  });

  it('throws on duplicate member names', () => {
    expect(() =>
      enumType('Status', mongoString, member('Active', 'active'), member('Active', 'inactive')),
    ).toThrow('duplicate member name');
  });

  it('throws on duplicate member values', () => {
    expect(() =>
      enumType('Status', mongoString, member('Active', 'dup'), member('Inactive', 'dup')),
    ).toThrow('duplicate member value');
  });
});

describe('defineContract() — undeclared enum reference', () => {
  it('throws when a field references an enum not declared in enums', () => {
    const Role = enumType('Role', mongoString, member('User', 'user'));
    const Account = model('Account', {
      collection: 'accounts',
      fields: { _id: field.objectId(), role: field.namedType(Role) },
    });
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Account },
      }),
    ).toThrow('references enum "Role" which is not declared');
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Account },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.ENUM_UNKNOWN' }));
  });
});

describe('defineContract() — enum declaration key mismatch', () => {
  it('throws when the enums key differs from the enumType name', () => {
    const Role = enumType('Role', mongoString, member('User', 'user'));
    const Account = model('Account', {
      collection: 'accounts',
      fields: { _id: field.objectId(), role: field.namedType(Role) },
    });
    const run = () =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        enums: { Alias: Role },
        models: { Account },
      });
    expect(run).toThrow(
      'enum declaration key "Alias" must match enumType name "Role". Aliases are not supported.',
    );
    expect(run).toThrow(expect.objectContaining({ code: 'CONTRACT.ENUM_INVALID' }));
  });
});

describe('defineContract() — codec-encoded value set', () => {
  const upperCodec = { codecId: 'test/upper@1' as const, nativeType: 'string' } as const;
  const upperDescriptor: AnyCodecDescriptor = {
    codecId: 'test/upper@1',
    dataType: dataTypeId('test/upper'),
    traits: ['equality'],
    targetTypes: ['string'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () =>
      ({
        id: 'test/upper@1',
        encode: async (v: unknown) => v,
        decode: async (v: unknown) => v,
        encodeJson: (v: unknown) => (v as string).toUpperCase(),
        decodeJson: (j: unknown) => j,
      }) as unknown as Codec,
  };
  const packWithEncoders = {
    ...mongoTargetPack,
    types: { codecTypes: { codecDescriptors: [upperDescriptor] } },
  } satisfies TargetPackRef<'mongo', 'mongo'>;

  const Role = enumType('Role', upperCodec, member('Admin', 'admin'), member('Author', 'author'));
  const Account = model('Account', {
    collection: 'accounts',
    fields: { _id: field.objectId(), role: field.namedType(Role) },
  });

  const contract = defineContract({
    family: mongoFamilyPack,
    target: packWithEncoders,
    enums: { Role },
    models: { Account },
  });

  it('encodes storage value-set values through the codec', () => {
    const envelope = JSON.parse(JSON.stringify(contract)) as {
      storage: {
        namespaces: Record<
          string,
          { entries: { valueSet?: Record<string, { values: unknown[] }> } }
        >;
      };
    };
    const ns = envelope.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns?.entries.valueSet?.['Role']?.values).toEqual(['ADMIN', 'AUTHOR']);
  });

  it('encodes domain enum member values through the codec', () => {
    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const enumSlot = (ns as Record<string, unknown>)['enum'] as Record<string, unknown>;
    expect(enumSlot['Role']).toEqual({
      codecId: 'test/upper@1',
      members: [
        { name: 'Admin', value: 'ADMIN' },
        { name: 'Author', value: 'AUTHOR' },
      ],
    });
  });

  it('throws a clear error when the enum codec is not in the pack surface', () => {
    const Missing = enumType('Missing', upperCodec, member('One', 'one'));
    const WithMissing = model('WithMissing', {
      collection: 'withMissing',
      fields: { _id: field.objectId(), value: field.namedType(Missing) },
    });
    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        enums: { Missing },
        models: { WithMissing },
      }),
    ).toThrow('test/upper@1');
  });
});
