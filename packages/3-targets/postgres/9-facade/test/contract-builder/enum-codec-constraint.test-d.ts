import { expectTypeOf } from 'vitest';
import { enumType, member } from '../../src/exports/contract-builder';

const textColumn = { codecId: 'pg/text@1' as const } as const;
const int4Column = { codecId: 'pg/int4@1' as const } as const;

// Int-backed enum: members are numbers, reads narrow to the literal union.
const Priority = enumType('Priority', int4Column, member('Low', 1), member('High', 10));
expectTypeOf(Priority.values).toEqualTypeOf<readonly [1, 10]>();

// Text-backed enum: members are strings, reads narrow to the literal union.
const Role = enumType('Role', textColumn, member('User', 'user'), member('Admin', 'admin'));
expectTypeOf(Role.values).toEqualTypeOf<readonly ['user', 'admin']>();

// The text codec dictates string — a numeric member is rejected.
// @ts-expect-error — pg/text@1 requires string member values, not number.
enumType('BadText', textColumn, member('Bad', 1));

// The int codec dictates number — a string member is rejected.
// @ts-expect-error — pg/int4@1 requires number member values, not string.
enumType('BadInt', int4Column, member('Bad', 'low'));
