import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  assertEnumMembersStoredUniquely,
  bindEnumType,
  ENUM_TYPE_HANDLE_BRAND,
  type EnumTypeHandle,
  enumType,
  isEnumTypeHandle,
  member,
} from '../src/enum-type';

const textCodec = { codecId: 'pg/text@1' };

describe('member', () => {
  it('defaults the value to the name', () => {
    expect(member('Active')).toEqual({ name: 'Active', value: 'Active' });
  });

  it('keeps an explicit value', () => {
    expect(member('Active', 3)).toEqual({ name: 'Active', value: 3 });
  });
});

describe('a declared enum type', () => {
  const Role = enumType('Role', textCodec, member('User', 'user'), member('Admin', 'admin'));
  const wideRole: EnumTypeHandle = Role;

  it('carries the codec, the ordered members, and the accessor map', () => {
    expect(Role).toEqual({
      [ENUM_TYPE_HANDLE_BRAND]: true,
      enumName: 'Role',
      codecId: 'pg/text@1',
      enumMembers: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
      values: ['user', 'admin'],
      names: ['User', 'Admin'],
      members: { User: 'user', Admin: 'admin' },
      has: expect.any(Function),
      nameOf: expect.any(Function),
      ordinalOf: expect.any(Function),
    });
  });

  it('answers membership, name, and ordinal lookups by value', () => {
    expect({
      hasDeclared: wideRole.has('admin'),
      hasUndeclared: wideRole.has('ghost'),
      nameOfDeclared: wideRole.nameOf('admin'),
      nameOfUndeclared: wideRole.nameOf('ghost'),
      ordinalOfDeclared: wideRole.ordinalOf('admin'),
      ordinalOfUndeclared: wideRole.ordinalOf('ghost'),
    }).toEqual({
      hasDeclared: true,
      hasUndeclared: false,
      nameOfDeclared: 'Admin',
      nameOfUndeclared: undefined,
      ordinalOfDeclared: 1,
      ordinalOfUndeclared: -1,
    });
  });

  it('freezes the member views it exposes', () => {
    expect({
      values: Object.isFrozen(Role.values),
      names: Object.isFrozen(Role.names),
      enumMembers: Object.isFrozen(Role.enumMembers),
      members: Object.isFrozen(Role.members),
    }).toEqual({ values: true, names: true, enumMembers: true, members: true });
  });

  it('is recognized as an enum type handle', () => {
    expect(isEnumTypeHandle(Role)).toBe(true);
  });
});

describe('isEnumTypeHandle', () => {
  it('rejects values that do not carry the brand', () => {
    const candidates = [null, undefined, 'Role', 42, {}, { [ENUM_TYPE_HANDLE_BRAND]: false }];

    expect(candidates.map(isEnumTypeHandle)).toEqual([false, false, false, false, false, false]);
  });
});

describe('bindEnumType', () => {
  it('builds the same handle through the codec-bound signature', () => {
    const boundEnumType = bindEnumType<{ 'pg/int4@1': { input: number } }>();

    const Level = boundEnumType(
      'Level',
      { codecId: 'pg/int4@1' },
      member('Low', 1),
      member('High', 2),
    );

    expect({
      enumName: Level.enumName,
      codecId: Level.codecId,
      values: Level.values,
      members: Level.members,
    }).toEqual({
      enumName: 'Level',
      codecId: 'pg/int4@1',
      values: [1, 2],
      members: { Low: 1, High: 2 },
    });
  });
});

describe('enumType validation errors', () => {
  it('rejects an enum with no members with CONTRACT.ENUM_INVALID', () => {
    let thrown: unknown;
    try {
      enumType('Status', textCodec);
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    if (!isStructuredError(thrown)) {
      throw new Error('expected a structured error');
    }
    expect(thrown.code).toBe('CONTRACT.ENUM_INVALID');
    expect(thrown.message).toBe('enumType("Status"): must have at least one member.');
    expect(thrown.meta).toEqual({
      enumName: 'Status',
      reason: 'no-members',
    });
  });

  it('rejects a duplicate member name with CONTRACT.ENUM_INVALID', () => {
    let thrown: unknown;
    try {
      enumType('Status', textCodec, member('active'), member('active', 'other'));
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    if (!isStructuredError(thrown)) {
      throw new Error('expected a structured error');
    }
    expect(thrown.code).toBe('CONTRACT.ENUM_INVALID');
    expect(thrown.message).toBe(
      'enumType("Status"): duplicate member name "active". Member names must be unique.',
    );
    expect(thrown.meta).toEqual({
      enumName: 'Status',
      member: 'active',
      reason: 'duplicate-member-name',
    });
  });

  it('accepts members that differ by SameValueZero, leaving stored forms to the contract build', () => {
    const shapes = enumType(
      'Shape',
      { codecId: 'pg/jsonb@1' },
      member('Square', { sides: 4 }),
      member('Triangle', { sides: 3 }),
    );
    const moments = enumType(
      'Moment',
      { codecId: 'pg/timestamptz@1' },
      member('Start', new Date('2024-01-01T00:00:00.000Z')),
      member('JustAfter', new Date('2024-01-01T00:00:00.001Z')),
    );
    const mixed = enumType('Mixed', textCodec, member('Number', 1), member('Text', '1'));

    expect({
      shapes: shapes.values,
      moments: moments.names,
      mixed: { values: mixed.values, number: mixed.nameOf(1), text: mixed.nameOf('1') },
    }).toEqual({
      shapes: [{ sides: 4 }, { sides: 3 }],
      moments: ['Start', 'JustAfter'],
      mixed: { values: [1, '1'], number: 'Number', text: 'Text' },
    });
  });

  it('names a NaN value as NaN when two members have it', () => {
    expect(() =>
      enumType(
        'Ratio',
        { codecId: 'pg/float8@1' },
        member('Unknown', Number.NaN),
        member('Missing', Number.NaN),
      ),
    ).toThrow(
      'enumType("Ratio"): members "Unknown" and "Missing" have the same value NaN. Member values must be unique.',
    );
  });

  it('names a value JSON cannot write by its string form', () => {
    const marker = Symbol('marker');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() =>
      enumType('Marker', textCodec, member('First', marker), member('Second', marker)),
    ).toThrow(
      'enumType("Marker"): members "First" and "Second" have the same value Symbol(marker). Member values must be unique.',
    );
    expect(() =>
      enumType('Node', textCodec, member('First', cyclic), member('Second', cyclic)),
    ).toThrow(
      'enumType("Node"): members "First" and "Second" have the same value [object Object]. Member values must be unique.',
    );
  });

  it('rejects two members equal by SameValueZero with CONTRACT.ENUM_INVALID', () => {
    expect(() =>
      enumType('Status', textCodec, member('Active', 'x'), member('Inactive', 'x')),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Status"): members "Active" and "Inactive" have the same value "x". Member values must be unique.',
        meta: {
          enumName: 'Status',
          members: ['Active', 'Inactive'],
          reason: 'duplicate-member-value',
        },
      }),
    );
  });
});

describe('assertEnumMembersStoredUniquely', () => {
  it('accepts members whose stored forms differ', () => {
    expect(() =>
      assertEnumMembersStoredUniquely('Shape', [
        { name: 'Square', stored: { sides: 4 } },
        { name: 'Triangle', stored: { sides: 3 } },
      ]),
    ).not.toThrow();
  });

  it('refuses two members that store the same value, naming both and the stored form', () => {
    expect(() =>
      assertEnumMembersStoredUniquely('Shape', [
        { name: 'Square', stored: { width: 2, height: 2 } },
        { name: 'Triangle', stored: { sides: 3 } },
        { name: 'Box', stored: { height: 2, width: 2 } },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Shape"): members "Square" and "Box" both store {"height":2,"width":2}. Member values must be unique as their codec stores them.',
        meta: { enumName: 'Shape', members: ['Square', 'Box'], reason: 'duplicate-member-value' },
      }),
    );
  });
});
