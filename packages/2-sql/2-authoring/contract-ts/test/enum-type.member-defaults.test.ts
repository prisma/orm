import { describe, expect, it } from 'vitest';
import { field } from '../src/contract-dsl';
import { enumType, member } from '../src/enum-type';

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const pgInt = { codecId: 'pg/int4@1' as const, nativeType: 'int4' } as const;

const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Urgent', 'urgent'),
);

const IntPriority = enumType('IntPriority', pgInt, member('Low', 1), member('High', 10));

describe('enum builder .default() accepts member values only', () => {
  it('compiles with a valid member value (string codec)', () => {
    expect(field.namedType(Priority).default('low').build().default).toEqual({
      kind: 'literal',
      value: 'low',
    });
    expect(field.namedType(Priority).default(Priority.members.Urgent).build().default).toEqual({
      kind: 'literal',
      value: 'urgent',
    });
  });

  it('rejects a non-member string at compile time', () => {
    if (false as boolean) {
      // @ts-expect-error 'lwo' is not a member value
      field.namedType(Priority).default('lwo');
    }
  });

  it('rejects an unrelated string at compile time', () => {
    if (false as boolean) {
      // @ts-expect-error 'admin' is not a member value of Priority
      field.namedType(Priority).default('admin');
    }
  });

  it('compiles with a valid int member value (int codec)', () => {
    expect(field.namedType(IntPriority).default(1).build().default).toEqual({
      kind: 'literal',
      value: 1,
    });
    expect(field.namedType(IntPriority).default(IntPriority.members.High).build().default).toEqual({
      kind: 'literal',
      value: 10,
    });
  });

  it('rejects a non-member int value at compile time', () => {
    if (false as boolean) {
      // @ts-expect-error 2 is not a member value of IntPriority
      field.namedType(IntPriority).default(2);
    }
  });

  it('defaultSql is not available on an enum builder', () => {
    if (false as boolean) {
      // @ts-expect-error defaultSql is not callable on the enum builder
      field.namedType(Priority).defaultSql('uuid_generate_v4()');
    }
  });
});

describe('enum builder .default() lowers to { kind: "literal", value }', () => {
  it('string codec member default lowers to literal', () => {
    const state = field.namedType(Priority).default(Priority.members.Low).build();
    expect(state.default).toEqual({ kind: 'literal', value: 'low' });
  });

  it('int codec member default lowers to literal', () => {
    const state = field.namedType(IntPriority).default(IntPriority.members.Low).build();
    expect(state.default).toEqual({ kind: 'literal', value: 1 });
  });
});
