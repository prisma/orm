/**
 * Recovered-column defaults: an enum field's `@default` must be a bare member
 * identifier, so a member-valued default prints as the member and any other
 * default blocks recovery.
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

describe('Path A recovery — column defaults', () => {
  // The PSL interpreter accepts only a bare member identifier as an enum
  // field's `@default` — `@default("user")` is rejected — so a recovered
  // column's default must print as the member, and a default that is not a
  // member value must block recovery entirely.
  it('a member-valued default prints as the bare member identifier', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: {
                name: 'role',
                nativeType: 'text',
                nullable: false,
                default: `'user'::text`,
              },
            },
            [
              membershipCheck(
                'accounts',
                'role',
                false,
                ['user', 'admin'],
                `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).toContain('enum AccountsRole {');
    expect(output).toMatch(/role\s+AccountsRole\s+@default\(user\)/);
    expect(output).not.toContain('@default("user")');
    expect(output).not.toContain('@@check');
  });

  it('a default outside the member set blocks recovery; the column keeps its check and default', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: {
                name: 'role',
                nativeType: 'text',
                nullable: false,
                default: `'guest'::text`,
              },
            },
            [
              membershipCheck(
                'accounts',
                'role',
                false,
                ['user', 'admin'],
                `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toMatch(/role\s+String\s+@default\("guest"\)/);
    expect(output).toContain('@@check');
  });

  it('a non-literal default blocks recovery', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: {
                name: 'role',
                nativeType: 'text',
                nullable: false,
                default: `lower('USER'::text)`,
              },
            },
            [
              membershipCheck(
                'accounts',
                'role',
                false,
                ['user', 'admin'],
                `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('@@check');
  });
});
