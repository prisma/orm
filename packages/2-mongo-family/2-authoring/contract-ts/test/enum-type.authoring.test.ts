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

const mongoString = { codecId: 'mongo/string@1' as const } as const;

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

  it('stores codecId', () => {
    expect(Role.codecId).toBe('mongo/string@1');
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
});

describe('defineContract() — members compared as the codec stores them', () => {
  const objectCodec = { codecId: 'test/object@1' as const } as const;
  const dateCodec = { codecId: 'test/date@1' as const } as const;
  const shoutCodec = { codecId: 'test/shout@1' as const } as const;
  const shoutDescriptor: AnyCodecDescriptor = {
    ...identityDescriptor('test/shout@1'),
    factory: () => () =>
      ({
        id: 'test/shout@1',
        encode: async (v: unknown) => v,
        decode: async (v: unknown) => v,
        encodeJson: (v: unknown) => (v as string).toUpperCase(),
        decodeJson: (j: unknown) => j,
      }) as unknown as Codec,
  };
  const dateDescriptor: AnyCodecDescriptor = {
    ...identityDescriptor('test/date@1'),
    factory: () => () =>
      ({
        id: 'test/date@1',
        encode: async (v: unknown) => v,
        decode: async (v: unknown) => v,
        encodeJson: (v: unknown) => (v as Date).toISOString(),
        decodeJson: (j: unknown) => new Date(j as string),
      }) as unknown as Codec,
  };
  const target = {
    ...mongoTargetPack,
    types: {
      codecTypes: {
        codecDescriptors: [
          identityDescriptor('mongo/string@1'),
          identityDescriptor('test/object@1'),
          dateDescriptor,
          shoutDescriptor,
        ],
      },
    },
  } as const satisfies TargetPackRef<'mongo', 'mongo'>;

  function build(handle: ReturnType<typeof enumType>) {
    const Holder = model('Holder', {
      collection: 'holders',
      fields: { _id: field.objectId(), value: field.namedType(handle) },
    });
    return defineContract({
      family: mongoFamilyPack,
      target,
      enums: { [handle.enumName]: handle },
      models: { Holder },
    });
  }

  function storedMembers(contract: ReturnType<typeof build>, enumName: string) {
    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const enumSlot = (ns as Record<string, unknown>)['enum'] as Record<
      string,
      { members: unknown[] }
    >;
    return enumSlot[enumName]?.members;
  }

  it('accepts two different object members', () => {
    const Shape = enumType(
      'Shape',
      objectCodec,
      member('Square', { sides: 4 }),
      member('Triangle', { sides: 3 }),
    );
    expect(storedMembers(build(Shape), 'Shape')).toEqual([
      { name: 'Square', value: { sides: 4 } },
      { name: 'Triangle', value: { sides: 3 } },
    ]);
  });

  it('accepts two dates a millisecond apart', () => {
    const Moment = enumType(
      'Moment',
      dateCodec,
      member('Start', new Date('2024-01-01T00:00:00.000Z')),
      member('JustAfter', new Date('2024-01-01T00:00:00.001Z')),
    );
    expect(storedMembers(build(Moment), 'Moment')).toEqual([
      { name: 'Start', value: '2024-01-01T00:00:00.000Z' },
      { name: 'JustAfter', value: '2024-01-01T00:00:00.001Z' },
    ]);
  });

  it.each([
    [
      'two equal objects, showing the stored object',
      enumType(
        'Shape',
        objectCodec,
        member('Wide', { width: 2, height: 1 }),
        member('AlsoWide', { height: 1, width: 2 }),
      ),
      'enumType("Shape"): members "Wide" and "AlsoWide" both store {"height":1,"width":2}. Member values must be unique as their codec stores them.',
      ['Wide', 'AlsoWide'],
    ],
    [
      'two equal dates',
      enumType(
        'Moment',
        dateCodec,
        member('Start', new Date('2024-01-01T00:00:00.000Z')),
        member('SameStart', new Date('2024-01-01T00:00:00.000Z')),
      ),
      'enumType("Moment"): members "Start" and "SameStart" both store "2024-01-01T00:00:00.000Z". Member values must be unique as their codec stores them.',
      ['Start', 'SameStart'],
    ],
    [
      'two strings stored as the same text',
      enumType('Status', shoutCodec, member('Quiet', 'dup'), member('Loud', 'DUP')),
      'enumType("Status"): members "Quiet" and "Loud" both store "DUP". Member values must be unique as their codec stores them.',
      ['Quiet', 'Loud'],
    ],
  ] as const)('refuses %s', (_case, handle, message, members) => {
    expect(() => build(handle)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message,
        meta: { enumName: handle.enumName, members, reason: 'duplicate-member-value' },
      }),
    );
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
  const upperCodec = { codecId: 'test/upper@1' as const } as const;
  const upperDescriptor: AnyCodecDescriptor = {
    codecId: 'test/upper@1',
    dataType: dataTypeId('test/upper'),
    traits: ['equality'],
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

describe('an enum whose codec does not declare the equality trait', () => {
  it('is refused, saying so', () => {
    const unequalCodec = { codecId: 'test/unequal@1' as const } as const;
    const Shape = enumType('Shape', unequalCodec, member('Round', 'round'));
    const target = {
      ...mongoTargetPack,
      types: {
        codecTypes: {
          codecDescriptors: [
            identityDescriptor('mongo/string@1'),
            { ...identityDescriptor('test/unequal@1'), traits: [] },
          ],
        },
      },
    } as const satisfies TargetPackRef<'mongo', 'mongo'>;
    const WithShape = model('WithShape', {
      collection: 'withShape',
      fields: { _id: field.objectId(), shape: field.namedType(Shape) },
    });

    expect(() =>
      defineContract({ family: mongoFamilyPack, target, enums: { Shape }, models: { WithShape } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Shape"): an enum cannot use the codec test/unequal@1. The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.',
        fix: 'Type the enum with another codec.',
        meta: { enumName: 'Shape', codecId: 'test/unequal@1', reason: 'codec-not-for-enums' },
      }),
    );
  });
});
