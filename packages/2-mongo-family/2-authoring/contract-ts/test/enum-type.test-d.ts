import { expectTypeOf, test } from 'vitest';
import { enumType, member } from '../src/enum-type';

const mongoString = { codecId: 'mongo/string@1' as const } as const;

test('enumType values tuple is a literal readonly tuple, not string[]', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));
  expectTypeOf(Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
});

test('enumType names tuple is a literal readonly tuple', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));
  expectTypeOf(Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
});

test('members accessor map preserves literal value types', () => {
  const Role = enumType('Role', mongoString, member('User', 'user'), member('Admin', 'admin'));
  expectTypeOf(Role.members.User).toEqualTypeOf<'user'>();
  expectTypeOf(Role.members.Admin).toEqualTypeOf<'admin'>();
});
