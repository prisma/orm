/**
 * Recovered enum naming: collisions with models, native enums, PSL scalar
 * type names, and pack-contributed constructors all disambiguate with a
 * numeric suffix — enum naming never throws.
 */
import { describe, expect, it } from 'vitest';
import {
  idColumn,
  inferAndPrint,
  membershipCheck,
  namespaceNode,
  table,
  tree,
} from './enum-recovery-fixtures';

describe('recovered enum naming collisions', () => {
  const roleCheck = (tableName: string) =>
    membershipCheck(tableName, 'role', false, ['user'], `(role = 'user'::text)`);

  it('a name a model claims gets a numeric suffix', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            [roleCheck('accounts')],
          ),
          accounts_role: table('accounts_role', { id: idColumn }),
        }),
      }),
    );

    expect(output).toContain('model AccountsRole {');
    expect(output).toContain('enum AccountsRole2 {');
    expect(output).toMatch(/role\s+AccountsRole2\n/);
  });

  it('a name a native enum claims gets a numeric suffix', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode(
          'public',
          {
            accounts: table(
              'accounts',
              {
                id: idColumn,
                role: { name: 'role', nativeType: 'text', nullable: false },
                kind: { name: 'kind', nativeType: 'accounts_role', nullable: true },
              },
              [roleCheck('accounts')],
            ),
          },
          [{ typeName: 'accounts_role', values: ['a', 'b'] }],
        ),
      }),
    );

    expect(output).toContain('native_enum AccountsRole {');
    expect(output).toContain('enum AccountsRole2 {');
  });

  it('a name equal to a target-contributed scalar type gets a numeric suffix', () => {
    // toEnumName('var_char') is exactly `VarChar` — a name absent from the
    // old nine-name framework set, present in the completed reserved set.
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          var: table(
            'var',
            {
              id: idColumn,
              char: { name: 'char', nativeType: 'text', nullable: false },
            },
            [membershipCheck('var', 'char', false, ['x'], `(char = 'x'::text)`)],
          ),
        }),
      }),
    );

    expect(output).toContain('enum VarChar2 {');
    expect(output).toMatch(/char\s+VarChar2\n/);
  });

  it('a name equal to a pack-contributed type constructor gets a numeric suffix', () => {
    // toEnumName('big_int_number') is exactly `BigIntNumber` — a name that
    // only `collectScalarTypeConstructors(postgresAuthoringTypes)` reserves;
    // it appears in no type-map table.
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          big_int: table(
            'big_int',
            {
              id: idColumn,
              number: { name: 'number', nativeType: 'text', nullable: false },
            },
            [membershipCheck('big_int', 'number', false, ['x'], `(number = 'x'::text)`)],
          ),
        }),
      }),
    );

    expect(output).toContain('enum BigIntNumber2 {');
    expect(output).toMatch(/number\s+BigIntNumber2\n/);
  });
});
