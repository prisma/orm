import type { Contract, JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  emptyCodecLookup,
} from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { withTestTypes } from '../../../1-core/contract/test/test-type-lookups';
import { buildSqlContractFromDefinition } from '../src/build-contract';
import type { ContractDefinition } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';
import { withDescriptors } from './with-descriptors';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const pgText = { codecId: 'pg/text@1' as const } as const;
const pgInt = { codecId: 'pg/int4@1' as const } as const;

function stubCodec(
  id: string,
  encodeJson: (value: unknown) => JsonValue,
  decodeJson: (json: JsonValue) => unknown = (json) => json,
): Codec {
  return {
    id,
    encodeJson: encodeJson as Codec['encodeJson'],
    decodeJson: decodeJson as Codec['decodeJson'],
    encode: (() => Promise.reject(new Error('unused'))) as Codec['encode'],
    decode: (() => Promise.reject(new Error('unused'))) as Codec['decode'],
  };
}

function codecLookupOf(codecs: Record<string, Codec>): CodecLookupWithDescriptors {
  return withDescriptors({ ...emptyCodecLookup, get: (id: string) => codecs[id] });
}

function definitionWith(enumHandle: ReturnType<typeof enumType>): ContractDefinition {
  return {
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    storageTypes: {},
    warnings: undefined,
    models: [],
    enums: { [enumHandle.enumName]: enumHandle },
  } as ContractDefinition;
}

function valueSetValues(contract: Contract<SqlStorage>, name: string): readonly JsonValue[] {
  const ns = contract.storage.namespaces['public'];
  return (ns !== undefined ? ns.entries.valueSet?.[name]?.values : undefined) ?? [];
}

function memberValues(contract: Contract<SqlStorage>, name: string): readonly JsonValue[] {
  const ns = contract.domain.namespaces['public'];
  return (ns?.enum?.[name]?.members ?? []).map((m) => m.value);
}

describe('enum lowering encodes member values through the codec', () => {
  it('text enum encodes members and value-set values as strings', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const codecLookup = codecLookupOf({
      'pg/text@1': stubCodec('pg/text@1', (v) => v as JsonValue),
    });

    const contract = buildSqlContractFromDefinition(
      definitionWith(Role),
      ...withTestTypes(codecLookup),
    );

    expect(valueSetValues(contract, 'Role')).toEqual(['user', 'admin']);
    expect(memberValues(contract, 'Role')).toEqual(['user', 'admin']);
  });

  it('int-backed enum keeps member and value-set values as numbers, not strings', () => {
    const Priority = enumType('Priority', pgInt, member('Low', 1), member('High', 10));
    const codecLookup = codecLookupOf({
      'pg/int4@1': stubCodec('pg/int4@1', (v) => v as JsonValue),
    });

    const contract = buildSqlContractFromDefinition(
      definitionWith(Priority),
      ...withTestTypes(codecLookup),
    );

    expect(valueSetValues(contract, 'Priority')).toEqual([1, 10]);
    expect(memberValues(contract, 'Priority')).toEqual([1, 10]);
  });

  it('routes each value through codec.encodeJson, not String()', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const codecLookup = codecLookupOf({
      'pg/text@1': stubCodec(
        'pg/text@1',
        (v) => String(v).toUpperCase(),
        (json) => String(json).toLowerCase(),
      ),
    });

    const contract = buildSqlContractFromDefinition(
      definitionWith(Role),
      ...withTestTypes(codecLookup),
    );

    expect(valueSetValues(contract, 'Role')).toEqual(['USER', 'ADMIN']);
    expect(memberValues(contract, 'Role')).toEqual(['USER', 'ADMIN']);
  });

  it('stores a member in another form when the codec reads that form back as the member', () => {
    const Level = enumType(
      'Level',
      { codecId: 'pg/int8@1' },
      member('Low', 1n),
      member('High', 10n),
    );
    const codecLookup = codecLookupOf({
      'pg/int8@1': stubCodec(
        'pg/int8@1',
        (v) => String(v),
        (json) => BigInt(String(json)),
      ),
    });

    const contract = buildSqlContractFromDefinition(
      definitionWith(Level),
      ...withTestTypes(codecLookup),
    );

    expect(memberValues(contract, 'Level')).toEqual(['1', '10']);
  });

  it.each([
    ['a string', member('Shouted', 'ADMIN'), 'ADMIN', 'admin'],
    ['a tuple', member('Unsorted', ['b', 'a']), ['b', 'a'], ['a', 'b']],
  ])(
    'refuses %s member the codec stores as a different value, saying what to write',
    (_kind, written, as, stored) => {
      const Role = enumType('Role', { codecId: 'test/folding@1' }, written);
      const codecLookup = codecLookupOf({
        'test/folding@1': stubCodec('test/folding@1', (v) =>
          Array.isArray(v) ? [...v].sort() : String(v).toLowerCase(),
        ),
      });

      expect(() =>
        buildSqlContractFromDefinition(definitionWith(Role), ...withTestTypes(codecLookup)),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message: `enumType("Role"): member "${written.name}" is written ${JSON.stringify(as)}, but the column stores ${JSON.stringify(stored)}. Write the member as ${JSON.stringify(stored)}.`,
          meta: expect.objectContaining({
            enumName: 'Role',
            member: written.name,
            reason: 'member-not-stored-as-written',
          }),
        }),
      );
    },
  );

  it('refuses a member whose stored value the codec cannot read back, naming the member', () => {
    const decodeFailure = new Error('database JSON value must be a decimal string');
    const Ratio = enumType('Ratio', { codecId: 'test/decimal@1' }, member('Half', 1.5));
    const codecLookup = codecLookupOf({
      'test/decimal@1': stubCodec(
        'test/decimal@1',
        (v) => v as JsonValue,
        (json) => {
          if (typeof json !== 'string') throw decodeFailure;
          return json;
        },
      ),
    });

    expect(() =>
      buildSqlContractFromDefinition(definitionWith(Ratio), ...withTestTypes(codecLookup)),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Ratio") member "Half" has a value its codec test/decimal@1 refuses: database JSON value must be a decimal string',
        meta: expect.objectContaining({
          enumName: 'Ratio',
          member: 'Half',
          codecId: 'test/decimal@1',
          reason: 'codec-refused-member',
        }),
        cause: decodeFailure,
      }),
    );
  });

  it("refuses an enum whose codec descriptor says an enum cannot use it, quoting the descriptor's reason", () => {
    const Stamp = enumType(
      'Stamp',
      { codecId: 'test/printed-text@1' },
      member('Start', '2024-01-02T03:04:05'),
    );
    const codec = stubCodec('test/printed-text@1', (v) => v as JsonValue);
    const codecLookup: CodecLookupWithDescriptors = {
      ...emptyCodecLookup,
      get: (id) => (id === codec.id ? codec : undefined),
      descriptorFor: (id) =>
        id === codec.id
          ? ({
              codecId: id,
              traits: ['equality'],
              paramsSchema: undefined,
              factory: () => () => codec,
              enumRefusal: 'A query reads its values as text the contract does not store.',
            } as unknown as AnyCodecDescriptor)
          : undefined,
    };

    expect(() =>
      buildSqlContractFromDefinition(definitionWith(Stamp), ...withTestTypes(codecLookup)),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Stamp"): an enum cannot use the codec test/printed-text@1. A query reads its values as text the contract does not store.',
        meta: { enumName: 'Stamp', codecId: 'test/printed-text@1', reason: 'codec-not-for-enums' },
      }),
    );
  });

  it('refuses an enum whose codec does not declare the equality trait, saying so', () => {
    const Shape = enumType('Shape', { codecId: 'test/unequal@1' }, member('Round', 'round'));
    const codec = stubCodec('test/unequal@1', (v) => v as JsonValue);
    const codecLookup: CodecLookupWithDescriptors = {
      ...emptyCodecLookup,
      get: (id) => (id === codec.id ? codec : undefined),
      descriptorFor: (id) =>
        id === codec.id
          ? ({
              codecId: id,
              traits: [],
              paramsSchema: undefined,
              factory: () => () => codec,
            } as unknown as AnyCodecDescriptor)
          : undefined,
    };

    expect(() =>
      buildSqlContractFromDefinition(definitionWith(Shape), ...withTestTypes(codecLookup)),
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

  describe('compares members as the codec stores them', () => {
    const jsonbLookup = codecLookupOf({
      'pg/jsonb@1': stubCodec('pg/jsonb@1', (v) => v as JsonValue),
    });
    const timestampLookup = codecLookupOf({
      'pg/timestamptz@1': stubCodec(
        'pg/timestamptz@1',
        (v) => (v instanceof Date ? v.toISOString() : null),
        (json) => new Date(String(json)),
      ),
    });

    it('accepts two different object members', () => {
      const Shape = enumType(
        'Shape',
        { codecId: 'pg/jsonb@1' },
        member('Square', { sides: 4 }),
        member('Triangle', { sides: 3 }),
      );

      const contract = buildSqlContractFromDefinition(
        definitionWith(Shape),
        ...withTestTypes(jsonbLookup),
      );

      expect(memberValues(contract, 'Shape')).toEqual([{ sides: 4 }, { sides: 3 }]);
    });

    it('accepts two dates a millisecond apart', () => {
      const Moment = enumType(
        'Moment',
        { codecId: 'pg/timestamptz@1' },
        member('Start', new Date('2024-01-01T00:00:00.000Z')),
        member('JustAfter', new Date('2024-01-01T00:00:00.001Z')),
      );

      const contract = buildSqlContractFromDefinition(
        definitionWith(Moment),
        ...withTestTypes(timestampLookup),
      );

      expect(memberValues(contract, 'Moment')).toEqual([
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.001Z',
      ]);
    });

    it('refuses two equal object members, showing the stored object', () => {
      const Shape = enumType(
        'Shape',
        { codecId: 'pg/jsonb@1' },
        member('Wide', { width: 2, height: 1 }),
        member('AlsoWide', { height: 1, width: 2 }),
      );

      expect(() =>
        buildSqlContractFromDefinition(definitionWith(Shape), ...withTestTypes(jsonbLookup)),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message:
            'enumType("Shape"): members "Wide" and "AlsoWide" both store {"height":1,"width":2}. Member values must be unique as their codec stores them.',
          meta: {
            enumName: 'Shape',
            members: ['Wide', 'AlsoWide'],
            reason: 'duplicate-member-value',
          },
        }),
      );
    });

    it('refuses two equal dates', () => {
      const Moment = enumType(
        'Moment',
        { codecId: 'pg/timestamptz@1' },
        member('Start', new Date('2024-01-01T00:00:00.000Z')),
        member('SameStart', new Date('2024-01-01T00:00:00.000Z')),
      );

      expect(() =>
        buildSqlContractFromDefinition(definitionWith(Moment), ...withTestTypes(timestampLookup)),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ENUM_INVALID',
          message:
            'enumType("Moment"): members "Start" and "SameStart" both store "2024-01-01T00:00:00.000Z". Member values must be unique as their codec stores them.',
        }),
      );
    });
  });

  it('refuses two members the codec stores as the same value, naming both', () => {
    const Moment = enumType(
      'Moment',
      { codecId: 'test/minute@1' },
      member('Early', new Date('2024-01-01T00:00:10.000Z')),
      member('Late', new Date('2024-01-01T00:00:20.000Z')),
    );
    const codecLookup = codecLookupOf({
      'test/minute@1': stubCodec(
        'test/minute@1',
        (v) => (v instanceof Date ? v.toISOString().slice(0, 16) : null),
        (json) => new Date(`${String(json)}:00.000Z`),
      ),
    });

    expect(() =>
      buildSqlContractFromDefinition(definitionWith(Moment), ...withTestTypes(codecLookup)),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Moment"): members "Early" and "Late" both store "2024-01-01T00:00". Member values must be unique as their codec stores them.',
        meta: expect.objectContaining({
          enumName: 'Moment',
          members: ['Early', 'Late'],
          reason: 'duplicate-member-value',
        }),
      }),
    );
  });
});
