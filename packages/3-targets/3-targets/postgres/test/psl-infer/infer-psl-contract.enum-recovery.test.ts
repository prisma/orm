/**
 * Path A domain-enum recovery at the `contract infer` entry: a live CHECK
 * whose wire name hash-verifies against the membership predicate re-rendered
 * from its own harvested literals proves the check was derived from a domain
 * enum, so infer emits a top-level `enum` block, types the column by it, and
 * emits neither `@@check` nor `@noCheck` for the proven constraint. Live
 * check names in every fixture are computed with the real naming helpers —
 * never hand-spelled hashes.
 */
import sqlFamilyPack from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { printPsl } from '@internal/psl-printer';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import type { SqlCheckConstraintIRInput, SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { postgresRenderCheckExpressions } from '../../src/core/check-expressions';
import { isPostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

// ---------------------------------------------------------------------------
// Tree fixtures
// ---------------------------------------------------------------------------

function table(
  name: string,
  columns: Record<string, SqlColumnIRInput>,
  checks: readonly SqlCheckConstraintIRInput[] = [],
) {
  return new PostgresTableSchemaNode({
    name,
    columns,
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    checks,
    policies: [],
    rlsEnabled: false,
  });
}

function namespaceNode(
  schemaName: string,
  tables: Record<string, PostgresTableSchemaNode>,
  nativeEnums: readonly { typeName: string; values: readonly string[] }[] = [],
) {
  return new PostgresNamespaceSchemaNode({
    schemaName,
    tables,
    nativeEnums: nativeEnums.map(
      (entry) =>
        new PostgresNativeEnumSchemaNode({
          typeName: entry.typeName,
          namespaceId: schemaName,
          members: entry.values,
        }),
    ),
  });
}

function tree(namespaces: Record<string, PostgresNamespaceSchemaNode>) {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: '',
  });
}

const idColumn: SqlColumnIRInput = { name: 'id', nativeType: 'int4', nullable: false };

/**
 * The wire name the toolchain gave the membership check it derived for this
 * column and member list — the authored render is hashed, never the reprint.
 */
function membershipWireName(
  tableName: string,
  columnName: string,
  many: boolean,
  memberValues: readonly string[],
): { prefix: string; hash: string } {
  const candidate = postgresRenderCheckExpressions({
    tableName,
    columnName,
    many,
    memberValues,
  }).find((c) => c.kind === 'membership');
  assert.ok(candidate, 'membership candidate must render for a non-empty member list');
  return {
    prefix: composeCheckWirePrefix(tableName, columnName, 'membership'),
    hash: computeCheckContentHash(candidate.expression),
  };
}

/** A live membership check: wire name from the real helpers, body a reprint. */
function membershipCheck(
  tableName: string,
  columnName: string,
  many: boolean,
  memberValues: readonly string[],
  reprint: string,
): SqlCheckConstraintIRInput {
  const { prefix, hash } = membershipWireName(tableName, columnName, many, memberValues);
  return { naming: { kind: 'wire', prefix, hash }, expression: reprint, dependsOn: undefined };
}

function elementNotNullCheck(tableName: string, columnName: string): SqlCheckConstraintIRInput {
  const candidate = postgresRenderCheckExpressions({
    tableName,
    columnName,
    many: true,
    memberValues: undefined,
  }).find((c) => c.kind === 'elementNotNull');
  assert.ok(candidate, 'elementNotNull candidate must render for a list column');
  return {
    naming: {
      kind: 'wire',
      prefix: composeCheckWirePrefix(tableName, columnName, 'elementNotNull'),
      hash: computeCheckContentHash(candidate.expression),
    },
    expression: `(array_position(${columnName}, NULL) IS NULL)`,
    dependsOn: undefined,
  };
}

// The print sites must know the family `enum` block descriptor — the
// target-only set has no descriptor for the keyword.
const printDescriptors = {
  ...sqlFamilyPack.authoring.pslBlockDescriptors,
  ...postgresAuthoringPslBlockDescriptors,
};

function inferAndPrint(dbTree: PostgresDatabaseSchemaNode): string {
  return printPsl(inferPostgresPslContract(dbTree), { pslBlockDescriptors: printDescriptors });
}

// ---------------------------------------------------------------------------
// Recovery — positive cases
// ---------------------------------------------------------------------------

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
  it('recovers a varchar(20) column with the pg/varchar@1 codec', () => {
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

    expect(output).toContain('enum OrdersStatus {');
    expect(output).toContain('@@type("pg/varchar@1")');
    expect(output).toMatch(/status\s+OrdersStatus\n/);
    expect(output).not.toContain('VarChar(20)');
    expect(output).not.toContain('@@check');
  });

  it('recovers the `character varying(20)` spelling too', () => {
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

    expect(output).toContain('enum OrdersStatus {');
    expect(output).toContain('@@type("pg/varchar@1")');
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

// ---------------------------------------------------------------------------
// Naming collisions — numeric suffix, never a throw
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// Negative cases — not recovered, `@@check` emits as today
// ---------------------------------------------------------------------------

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
      "// use prisma-next
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

// ---------------------------------------------------------------------------
// Recovered output re-parses and re-interprets
// ---------------------------------------------------------------------------

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  { authoring: sqlFamilyPack.authoring },
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const codecLookup: CodecLookup = {
  get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
  targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function parseAndInterpret(source: string) {
  const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
  const { table: symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const interpreted = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
  return { interpreted, sourceDiagnostics: [...parseDiagnostics, ...symbolTableDiagnostics] };
}

describe('recovered output re-parses and re-interprets without diagnostics', () => {
  it('the recovered text enum lowers to a value set and a valueSet-typed column', () => {
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

    const { interpreted, sourceDiagnostics } = parseAndInterpret(output);
    expect(sourceDiagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    if (!interpreted.ok) {
      assert.fail(interpreted.failure.diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n'));
    }

    const publicStorage = interpreted.value.storage.namespaces['public'];
    assert.ok(isPostgresSchema(publicStorage), 'the value set must land in the public namespace');
    expect(publicStorage.valueSet?.['AccountsRole']).toMatchObject({
      values: ['user', 'admin'],
    });
    expect(publicStorage.table?.['accounts']?.columns['role']).toMatchObject({
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AccountsRole',
      },
    });
  });
});
