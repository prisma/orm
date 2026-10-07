import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
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

  it('rejects a duplicate member value with CONTRACT.ENUM_INVALID', () => {
    let thrown: unknown;
    try {
      enumType('Status', textCodec, member('active', 'x'), member('inactive', 'x'));
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    if (!isStructuredError(thrown)) {
      throw new Error('expected a structured error');
    }
    expect(thrown.code).toBe('CONTRACT.ENUM_INVALID');
    expect(thrown.message).toBe(
      'enumType("Status"): duplicate member value "x". Member values must be unique.',
    );
    expect(thrown.meta).toEqual({
      enumName: 'Status',
      member: 'x',
      reason: 'duplicate-member-value',
    });
  });
});
