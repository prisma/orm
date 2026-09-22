/**
 * Path A domain-enum recovery at the `contract infer` entry: a live CHECK
 * whose wire name hash-verifies against the membership predicate re-rendered
 * from its own harvested literals proves the check was derived from a domain
 * enum, so infer emits a top-level `enum` block, types the column by it, and
 * emits neither `@@check` nor `@noCheck` for the proven constraint.
 */
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import {
  elementNotNullCheck,
  idColumn,
  inferAndPrint,
  membershipCheck,
  namespaceNode,
  printDescriptors,
  table,
  tree,
} from './enum-recovery-fixtures';

describe('Path A recovery — text scalar', () => {
  it('recovers a two-member enum: top-level block, typed column, no @@check, no @noCheck', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
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
    expect(output).toContain('@@type("pg/text@1")');
    expect(output).toContain('user = "user"');
    expect(output).toContain('admin = "admin"');
    expect(output).toMatch(/role\s+AccountsRole\n/);
    expect(output).not.toContain('pg.enum');
    expect(output).not.toContain('@@check');
    expect(output).not.toContain('@noCheck');
  });

  it('recovers a one-member enum whose reprint collapsed to `=`', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            [membershipCheck('accounts', 'role', false, ['user'], `(role = 'user'::text)`)],
          ),
        }),
      }),
    );

    expect(output).toContain('enum AccountsRole {');
    expect(output).toContain('user = "user"');
    expect(output).not.toContain('@@check');
  });

  it('round-trips a doubled-quote member', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          people: table(
            'people',
            {
              id: idColumn,
              surname: { name: 'surname', nativeType: 'text', nullable: false },
            },
            [
              membershipCheck(
                'people',
                'surname',
                false,
                [`O'Brien`, 'plain'],
                `(surname = ANY (ARRAY['O''Brien'::text, 'plain'::text]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).toContain('enum PeopleSurname {');
    expect(output).toContain(`"O'Brien"`);
    expect(output).not.toContain('@@check');
  });
});

describe('Path A recovery — varchar scalar', () => {
  it('recovers the bare `character varying` spelling', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          orders: table(
            'orders',
            {
              id: idColumn,
              status: { name: 'status', nativeType: 'character varying', nullable: false },
            },
            [
              membershipCheck(
                'orders',
                'status',
                false,
                ['open'],
                `((status)::text = 'open'::text)`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).toContain('enum OrdersStatus {');
    expect(output).toContain('@@type("pg/varchar@1")');
  });

  it('a varchar(20) column recovers nothing — recovery would drop the length', () => {
    // `@@type("pg/varchar@1")` re-emits as bare `character varying`; the
    // planner would then see a native-type mismatch and widen the column.
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          orders: table(
            'orders',
            {
              id: idColumn,
              status: { name: 'status', nativeType: 'varchar(20)', nullable: false },
            },
            [
              membershipCheck(
                'orders',
                'status',
                false,
                ['open', 'closed'],
                `((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('VarChar(20)');
    expect(output).toContain('@@check');
  });

  it('a character varying(20) column recovers nothing either', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          orders: table(
            'orders',
            {
              id: idColumn,
              status: { name: 'status', nativeType: 'character varying(20)', nullable: false },
            },
            [
              membershipCheck(
                'orders',
                'status',
                false,
                ['open'],
                `((status)::text = 'open'::text)`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('VarChar(20)');
    expect(output).toContain('@@check');
  });
});

describe('Path A recovery — char scalar', () => {
  // A bare `char` column always introspects as `character(1)` — `format_type`
  // renders the implicit length — so that spelling is the reachable one, and
  // it recovers: bare `character` means `character(1)`, so `@@type`
  // re-emitting the codec's bare target type drops no length.
  it('recovers a character(1) column with the pg/char@1 codec', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          flags: table(
            'flags',
            {
              id: idColumn,
              state: { name: 'state', nativeType: 'character(1)', nullable: false },
            },
            [
              membershipCheck(
                'flags',
                'state',
                false,
                ['y', 'n'],
                `((state)::text = ANY ((ARRAY['y'::bpchar, 'n'::bpchar])::text[]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).toContain('enum FlagsState {');
    expect(output).toContain('@@type("pg/char@1")');
    expect(output).toMatch(/state\s+FlagsState\n/);
    expect(output).not.toContain('@@check');
  });

  it('a character(3) column recovers nothing — recovery would drop the length', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          flags: table(
            'flags',
            {
              id: idColumn,
              state: { name: 'state', nativeType: 'character(3)', nullable: false },
            },
            [
              membershipCheck(
                'flags',
                'state',
                false,
                ['yes', 'no'],
                `((state)::text = ANY ((ARRAY['yes'::bpchar, 'no'::bpchar])::text[]))`,
              ),
            ],
          ),
        }),
      }),
    );

    expect(output).not.toContain('enum ');
    expect(output).toContain('@@check');
  });

  it('the short `varchar` spelling recovers nothing — introspection never produces it', () => {
    // `format_type` always renders the canonical long spelling, so the map
    // keys only what a real pull can carry.
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          orders: table(
            'orders',
            {
              id: idColumn,
              status: { name: 'status', nativeType: 'varchar', nullable: false },
            },
            [
              membershipCheck(
                'orders',
                'status',
                false,
                ['open', 'closed'],
                `((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[]))`,
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

describe('Path A recovery — alongside an RLS policy', () => {
  // A policy triggers the same namespace wrap a native enum does, and policy
  // emission runs after recovery so policies rename around recovered names.
  // The project done condition: the namespace-wrap conflict is resolved, not
  // avoided — the recovered enum prints in the flat top-level bucket while
  // the policy and the `@@rls` model stay inside the named wrap.
  it('the recovered enum prints top-level while the policy stays inside the namespace wrap', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: new PostgresTableSchemaNode({
            name: 'accounts',
            columns: {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            checks: [
              membershipCheck(
                'accounts',
                'role',
                false,
                ['user', 'admin'],
                `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
              ),
            ],
            policies: [
              new PostgresPolicySchemaNode({
                naming: parseNaming('p_read', undefined),
                tableName: 'accounts',
                namespaceId: 'public',
                operation: 'select',
                roles: ['app_user'],
                using: 'true',
                withCheck: undefined,
                permissive: true,
                dependsOn: undefined,
              }),
            ],
            rlsEnabled: true,
          }),
        }),
      }),
    );

    expect(output).toContain('enum AccountsRole {');
    expect(output).toMatch(/role\s+AccountsRole\n/);
    expect(output).not.toContain('@@check');
    expect(output).toContain('policy_select p_read {');
    expect(output).toContain('@@rls');

    const namespaceStart = output.indexOf('namespace public {');
    expect(namespaceStart, 'the policy forces a namespace wrap').toBeGreaterThan(0);
    expect(
      output.indexOf('enum AccountsRole {'),
      'the recovered enum prints in the flat bucket, before the wrap',
    ).toBeLessThan(namespaceStart);
    expect(
      output.indexOf('policy_select p_read {'),
      'the policy prints inside the wrap',
    ).toBeGreaterThan(namespaceStart);
  });
});

describe('Path A recovery — list column', () => {
  it('recovers a text[] column; the live elementNotNull check is skipped without @noCheck', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          users: table(
            'users',
            {
              id: idColumn,
              tags: { name: 'tags', nativeType: 'text', nullable: false, many: true },
            },
            [
              membershipCheck(
                'users',
                'tags',
                true,
                ['user', 'admin'],
                `(tags <@ ARRAY['user'::text, 'admin'::text])`,
              ),
              elementNotNullCheck('users', 'tags'),
            ],
          ),
        }),
      }),
    );

    expect(output).toContain('enum UsersTags {');
    expect(output).toContain('@@type("pg/text@1")');
    expect(output).toMatch(/tags\s+UsersTags\[\]/);
    expect(output).not.toContain('@@check');
    expect(output).not.toContain('@noCheck');
  });
});

describe('Path A recovery — coexistence with a native enum', () => {
  it('prints the recovered enum top-level and the native enum inside the namespace wrap', () => {
    const dbTree = tree({
      public: namespaceNode(
        'public',
        {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: { name: 'role', nativeType: 'text', nullable: false },
              aal: { name: 'aal', nativeType: 'aal_level', nullable: true },
            },
            [membershipCheck('accounts', 'role', false, ['user'], `(role = 'user'::text)`)],
          ),
        },
        [{ typeName: 'aal_level', values: ['aal1', 'aal2'] }],
      ),
    });

    const ast = inferPostgresPslContract(dbTree);
    const flatBucket = ast.namespaces.find((n) => n.name === UNSPECIFIED_PSL_NAMESPACE_ID);
    const namedBucket = ast.namespaces.find((n) => n.name === 'public');
    expect(Object.keys(flatBucket?.entries?.['enum'] ?? {})).toEqual(['AccountsRole']);
    expect(Object.keys(namedBucket?.entries?.['native_enum'] ?? {})).toEqual(['AalLevel']);

    const output = printPsl(ast, { pslBlockDescriptors: printDescriptors });
    expect(output).toContain('enum AccountsRole {');
    expect(output).toContain('namespace public {');
    expect(output).toContain('native_enum AalLevel {');
    expect(output.indexOf('enum AccountsRole {')).toBeLessThan(
      output.indexOf('namespace public {'),
    );
  });
});
