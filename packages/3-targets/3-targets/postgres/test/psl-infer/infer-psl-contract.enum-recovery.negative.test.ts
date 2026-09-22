/**
 * Recovery negative cases: anything that fails a verification step — non-wire
 * name, empty harvest, hash mismatch, unmapped native type — recovers nothing
 * and leaves the check to today's `@@check` emission.
 */
import { composeCheckWirePrefix, formatWireName } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  elementNotNullCheck,
  idColumn,
  inferAndPrint,
  membershipCheck,
  membershipWireName,
  namespaceNode,
  table,
  tree,
} from './enum-recovery-fixtures';

describe('Path A recovery — negative cases', () => {
  it('a wire-shaped name whose hash does not verify recovers nothing', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          t: table(
            't',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            [
              {
                naming: {
                  kind: 'wire',
                  prefix: composeCheckWirePrefix('t', 'role', 'membership'),
                  hash: '0a1b2c3d',
                },
                expression: `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
                dependsOn: undefined,
              },
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain(
      `@@check(expression: "(role = ANY (ARRAY['user'::text, 'admin'::text]))", map: "${formatWireName(composeCheckWirePrefix('t', 'role', 'membership'), '0a1b2c3d')}")`,
    );
  });

  it('an empty harvest recovers nothing', () => {
    const prefix = composeCheckWirePrefix('t', 'role', 'membership');
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          t: table(
            't',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            [
              {
                naming: { kind: 'wire', prefix, hash: 'deadbeef' },
                expression: '(length(role) > 0)',
                dependsOn: undefined,
              },
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('@@check(expression: "(length(role) > 0)"');
  });

  it('a verified name on an unmapped native type recovers nothing', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          t: table(
            't',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'citext', nullable: false },
            },
            [membershipCheck('t', 'role', false, ['user'], `(role = 'user'::text)`)],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('@@check');
  });

  it('a wire-named elementNotNull check alone triggers no recovery', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          users: table(
            'users',
            {
              id: idColumn,
              tags: { name: 'tags', nativeType: 'text', nullable: false, many: true },
            },
            [elementNotNullCheck('users', 'tags')],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).not.toContain('@@check');
    expect(output).not.toContain('@noCheck');
  });

  it('a membership-prefixed check naming no column of the table is untouched', () => {
    const { prefix, hash } = membershipWireName('users', 'ghost', false, ['user']);
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          users: table(
            'users',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            [
              {
                naming: { kind: 'wire', prefix, hash },
                expression: `(role = 'user'::text)`,
                dependsOn: undefined,
              },
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('@@check');
  });

  it('an input with checks but no verified membership check prints exactly as before', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          orders: table(
            'orders',
            {
              id: idColumn,
              total: { name: 'total', nativeType: 'int4', nullable: false },
            },
            [
              {
                naming: { kind: 'exact', name: 'positive_total' },
                expression: '(total > (0)::numeric)',
                dependsOn: undefined,
              },
            ],
          ),
        }),
      }),
    );

    expect(output).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Orders {
        id    Int @id
        total Int

        @@check(expression: "(total > (0)::numeric)", map: "positive_total")
        @@map("orders")
      }
      "
    `);
  });
});
