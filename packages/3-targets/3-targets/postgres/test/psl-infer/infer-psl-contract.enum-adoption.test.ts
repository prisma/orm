/**
 * Native-enum ADOPTION at the `contract infer` entry: instead of throwing,
 * `inferPostgresPslContract` emits `native_enum` blocks + `pg.enum(<Name>)`
 * columns from the introspected tree's `enums`, wraps enum-bearing
 * output in an explicit `namespace <schemaName> { … }` block (the pinned
 * design — a top-level `native_enum` never lowers), subtracts pack-owned
 * enum types by TYPE NAME, and leaves enum-free output flat and byte-identical.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlDescribedContractSpace } from '@internal/family-sql/control';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { printPsl } from '@internal/psl-printer';
import { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import type { SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../../src/core/authoring';
import { PG_ENUM_CODEC_ID } from '../../src/core/codec-ids';
import { pgEnumDescriptor, postgresQualifyColumnType } from '../../src/core/codecs';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { PostgresNativeEnum } from '../../src/core/postgres-native-enum';
import { PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

// ---------------------------------------------------------------------------
// Tree fixtures
// ---------------------------------------------------------------------------

interface FlatNativeEnumEntry {
  readonly typeName: string;
  readonly values: readonly string[];
}

function table(name: string, columns: Record<string, SqlColumnIRInput>) {
  return new PostgresTableSchemaNode({
    name,
    columns,
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function namespaceNode(
  schemaName: string,
  tables: Record<string, PostgresTableSchemaNode>,
  nativeEnums: readonly FlatNativeEnumEntry[] = [],
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

function inferAndPrint(
  dbTree: PostgresDatabaseSchemaNode,
  describedContracts?: readonly SqlDescribedContractSpace[],
): string {
  return printPsl(inferPostgresPslContract(dbTree, describedContracts), {
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
  });
}

const idColumn: SqlColumnIRInput = { name: 'id', nativeType: 'int4', nullable: false };

const AAL_LEVEL: FlatNativeEnumEntry = {
  typeName: 'aal_level',
  values: ['aal1', 'aal2', 'aal3'],
};

function sessionsNamespace(schemaName: string) {
  return namespaceNode(
    schemaName,
    {
      sessions: table('sessions', {
        id: idColumn,
        aal: { name: 'aal', nativeType: 'aal_level', nullable: true },
      }),
    },
    [AAL_LEVEL],
  );
}

// ---------------------------------------------------------------------------
// Described-contract fixture (pack owning a native enum type in-memory)
// ---------------------------------------------------------------------------

function describedContractWithNativeEnum(input: {
  readonly namespaceId: string;
  readonly typeName: string;
  readonly members: readonly string[];
  readonly tables?: readonly string[];
}): SqlDescribedContractSpace {
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: {
        [input.namespaceId]: new PostgresSchema({
          id: input.namespaceId,
          entries: {
            table: Object.fromEntries(
              (input.tables ?? []).map((tableName) => [
                tableName,
                { columns: {}, uniques: [], indexes: [], foreignKeys: [] },
              ]),
            ),
            native_enum: {
              [input.typeName]: new PostgresNativeEnum({
                typeName: input.typeName,
                members: input.members,
              }),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  return { spaceId: 'pack', contract };
}

/**
 * Round-trips a described contract through the real serialize→JSON→hydrate
 * machinery, so the returned space carries a contract hydrated from bytes —
 * the production shape, where the native_enum entity only survives because
 * D1 made it serialize. If D1's serialization did not expose type names, the
 * hydrated contract would carry no native_enum entities and subtraction would
 * silently stop working.
 */
function throughSerializedForm(space: SqlDescribedContractSpace): SqlDescribedContractSpace {
  const serializer = new PostgresContractSerializer();
  const json = serializer.serializeContract(space.contract);
  const reparsed = JSON.parse(JSON.stringify(json));
  const hydrated = serializer.deserializeContract(reparsed);
  return { spaceId: space.spaceId, contract: hydrated };
}

// ---------------------------------------------------------------------------
// Production interpret harness (mirrors psl-pg-enum-column.test.ts)
// ---------------------------------------------------------------------------

const pgEnumCodec = {
  id: PG_ENUM_CODEC_ID,
  descriptor: pgEnumDescriptor,
  encode: () => Promise.reject(new Error('unused')),
  decode: () => Promise.reject(new Error('unused')),
  encodeJson: (value) => value,
  decodeJson: (json) => json,
} as Codec;

const codecLookup: CodecLookup = {
  get: (id) => (id === PG_ENUM_CODEC_ID ? pgEnumCodec : undefined),
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: (id) => (id === PG_ENUM_CODEC_ID ? pgEnumDescriptor : undefined),
};

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: postgresAuthoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: postgresAuthoringTypes, qualifyColumnType: postgresQualifyColumnType },
};

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sources } = parse(source, 'infer-psl-contract.enum-adoption.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    dataTypeLookup: postgresDataTypeLookup,
    document,
    symbolTable,
    sources,
    capabilities: {},
    target: postgresTarget,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('native enum adoption — happy path', () => {
  it('emits a namespace-wrapped native_enum block and pg.enum column (public)', () => {
    const output = inferAndPrint(tree({ public: sessionsNamespace('public') }));

    expect(output).toContain('namespace public {');
    expect(output).toContain('native_enum AalLevel {');
    expect(output).toContain('aal1 = "aal1"');
    expect(output).toContain('@@map("aal_level")');
    expect(output).toContain('pg.enum(AalLevel)?');
    expect(output).not.toContain('Unsupported(');
  });

  it('wraps in the introspected schema name for a non-public schema (the auth shape)', () => {
    const output = inferAndPrint(tree({ auth: sessionsNamespace('auth') }));

    expect(output).toContain('namespace auth {');
    expect(output).toContain('native_enum AalLevel {');
    expect(output).toContain('pg.enum(AalLevel)?');
  });

  it('resolves a schema-qualified column nativeType (live introspection reports auth.aal_level)', () => {
    // `format_type` schema-qualifies a type outside the connection's
    // search_path, so a live auth-schema column carries `auth.aal_level`
    // while `pg_type.typname` (the definitions key) stays bare.
    const output = inferAndPrint(
      tree({
        auth: namespaceNode(
          'auth',
          {
            sessions: table('sessions', {
              id: idColumn,
              aal: { name: 'aal', nativeType: 'auth.aal_level', nullable: true },
            }),
          },
          [AAL_LEVEL],
        ),
      }),
    );

    expect(output).toContain('pg.enum(AalLevel)?');
    expect(output).not.toContain('Unsupported(');
  });

  it('runs enum type names through the top-level name transforms', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode(
          'public',
          {
            user: table('user', {
              id: idColumn,
              role: { name: 'role', nativeType: 'user_role', nullable: false },
            }),
          },
          [{ typeName: 'user_role', values: ['admin', 'user'] }],
        ),
      }),
    );

    expect(output).toContain('native_enum UserRole {');
    expect(output).toContain('@@map("user_role")');
    expect(output).toContain('pg.enum(UserRole)');
  });

  it('does not throw the old remediation diagnostic', () => {
    expect(() =>
      inferPostgresPslContract(tree({ public: sessionsNamespace('public') })),
    ).not.toThrow();
  });
});

describe('enum-free output stays flat', () => {
  it('keeps the unspecified top-level bucket and no namespace wrapper', () => {
    const enumFree = tree({
      public: namespaceNode('public', { user: table('user', { id: idColumn }) }),
    });

    const ast = inferPostgresPslContract(enumFree);
    expect(ast.namespaces).toHaveLength(1);
    expect(ast.namespaces[0]?.name).toBe(UNSPECIFIED_PSL_NAMESPACE_ID);

    const output = inferAndPrint(enumFree);
    expect(output).not.toContain('namespace ');
    expect(output).toContain('model User {');
  });
});

describe('single-namespace stopgap guard', () => {
  it('throws when enums survive and content spans multiple schemas', () => {
    const multi = tree({
      public: namespaceNode('public', { user: table('user', { id: idColumn }) }),
      auth: sessionsNamespace('auth'),
    });

    expect(() => inferPostgresPslContract(multi)).toThrow(
      /adopting native enums or RLS policies with content across multiple schemas/,
    );
  });
});

describe('pack-owned enum subtraction (by type name)', () => {
  const pack = describedContractWithNativeEnum({
    namespaceId: 'auth',
    typeName: 'aal_level',
    members: ['aal1', 'aal2', 'aal3'],
    tables: ['sessions'],
  });

  it('omits a pack-owned enum type; enum-free remainder stays flat', () => {
    const dbTree = tree({
      auth: namespaceNode(
        'auth',
        {
          sessions: table('sessions', { id: idColumn }),
          app_notes: table('app_notes', { id: idColumn }),
        },
        [AAL_LEVEL],
      ),
    });

    const output = inferAndPrint(dbTree, [pack]);

    expect(output).not.toContain('native_enum');
    expect(output).not.toContain('namespace ');
    expect(output).toContain('model AppNotes {');
    expect(output).not.toContain('model Sessions {');
  });

  it('matching is namespace-scoped: a pack owning the type elsewhere does not subtract', () => {
    const otherPack = describedContractWithNativeEnum({
      namespaceId: 'other',
      typeName: 'aal_level',
      members: ['aal1'],
    });

    const output = inferAndPrint(tree({ auth: sessionsNamespace('auth') }), [otherPack]);

    expect(output).toContain('native_enum AalLevel {');
  });

  it('throws an actionable error when a surviving column is typed by a pack-owned enum type', () => {
    const dbTree = tree({
      auth: namespaceNode(
        'auth',
        {
          app_notes: table('app_notes', {
            id: idColumn,
            aal: { name: 'aal', nativeType: 'aal_level', nullable: true },
          }),
        },
        [AAL_LEVEL],
      ),
    });

    expect(() => inferPostgresPslContract(dbTree, [pack])).toThrow(
      /aal_level.*(pack|space "pack")/i,
    );

    const qualifiedTree = tree({
      auth: namespaceNode(
        'auth',
        {
          app_notes: table('app_notes', {
            id: idColumn,
            aal: { name: 'aal', nativeType: 'auth.aal_level', nullable: true },
          }),
        },
        [AAL_LEVEL],
      ),
    });

    expect(() => inferPostgresPslContract(qualifiedTree, [pack])).toThrow(
      /aal_level.*(pack|space "pack")/i,
    );
  });
});

describe('pack-owned enum subtraction from a serialized+hydrated described contract', () => {
  const FACTOR_TYPE: FlatNativeEnumEntry = {
    typeName: 'factor_type',
    values: ['totp', 'webauthn'],
  };

  // The pack owns `aal_level` in `auth`. It is built in-memory then round-tripped
  // through serialize→JSON→hydrate, so the contract handed to `infer` carries the
  // native_enum entity only because D1 made it serialize into contract.json.
  const hydratedPack = throughSerializedForm(
    describedContractWithNativeEnum({
      namespaceId: 'auth',
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
      tables: ['sessions'],
    }),
  );

  it('the hydrated contract exposes the native_enum entity as a PostgresNativeEnum (subtraction precondition)', () => {
    const authNs = hydratedPack.contract.storage.namespaces['auth'] as PostgresSchema;
    const entity = authNs.entries.native_enum?.['aal_level'];
    expect(entity).toBeInstanceOf(PostgresNativeEnum);
    expect(entity?.typeName).toBe('aal_level');
  });

  it('subtracts the pack-owned type while emitting a non-pack-owned enum in the same run', () => {
    const dbTree = tree({
      auth: namespaceNode(
        'auth',
        {
          mfa_factors: table('mfa_factors', {
            id: idColumn,
            factor: { name: 'factor', nativeType: 'factor_type', nullable: true },
          }),
        },
        [AAL_LEVEL, FACTOR_TYPE],
      ),
    });

    const output = inferAndPrint(dbTree, [hydratedPack]);

    // Pack owns aal_level → omitted.
    expect(output).not.toContain('native_enum AalLevel {');
    expect(output).not.toContain('@@map("aal_level")');

    // factor_type is not pack-owned → emitted and used, proving selective
    // subtraction rather than blanket enum suppression.
    expect(output).toContain('native_enum FactorType {');
    expect(output).toContain('@@map("factor_type")');
    expect(output).toContain('pg.enum(FactorType)?');
    expect(output).not.toContain('Unsupported(');
  });
});

describe('enum-typed column defaults', () => {
  it('parses a bare-cast string default to a literal @default', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode(
          'public',
          {
            sessions: table('sessions', {
              id: idColumn,
              aal: {
                name: 'aal',
                nativeType: 'aal_level',
                nullable: false,
                default: "'aal1'::aal_level",
              },
            }),
          },
          [AAL_LEVEL],
        ),
      }),
    );

    expect(output).toContain('@default("aal1")');
  });

  it('reads a schema-qualified cast default as the member literal, which interprets', () => {
    const output = inferAndPrint(
      tree({
        auth: namespaceNode(
          'auth',
          {
            sessions: table('sessions', {
              id: idColumn,
              aal: {
                name: 'aal',
                nativeType: 'aal_level',
                nullable: false,
                default: "'aal1'::auth.aal_level",
              },
            }),
          },
          [AAL_LEVEL],
        ),
      }),
    );

    expect(output).toContain('aal pg.enum(AalLevel) @default("aal1")');
    const result = interpret(output);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    expect(ns.table['sessions']?.columns['aal']?.default).toEqual({
      kind: 'literal',
      value: 'aal1',
    });
  });
});

describe('adopted output lowers through the production interpret chain', () => {
  it('the public shape interprets: pg/enum@1 column with valueSet ref and bare nativeType', () => {
    const output = inferAndPrint(tree({ public: sessionsNamespace('public') }));

    const result = interpret(output);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.valueSet?.['AalLevel']).toMatchObject({ values: ['aal1', 'aal2', 'aal3'] });
    const aalColumn = ns.table['sessions']?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'aal_level',
      nullable: true,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AalLevel',
      },
    });
  });

  it('the auth shape interprets with the schema-qualified nativeType', () => {
    const output = inferAndPrint(tree({ auth: sessionsNamespace('auth') }));

    const result = interpret(output);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const aalColumn = ns.table['sessions']?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'auth.aal_level',
      typeParams: { typeName: 'auth.aal_level' },
    });
  });

  it('namespace-wrapped models coordinate identically to the flat form (public)', () => {
    const enumFree = tree({
      public: namespaceNode('public', { user: table('user', { id: idColumn }) }),
    });
    const enumBearing = tree({
      public: namespaceNode('public', { user: table('user', { id: idColumn }) }, [AAL_LEVEL]),
    });

    const flatResult = interpret(inferAndPrint(enumFree));
    const wrappedResult = interpret(inferAndPrint(enumBearing));

    expect(flatResult.ok).toBe(true);
    expect(wrappedResult.ok).toBe(true);
    if (!flatResult.ok || !wrappedResult.ok) return;

    const flatNs = flatResult.value.storage.namespaces['public'] as PostgresSchema;
    const wrappedNs = wrappedResult.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.keys(wrappedNs.table)).toEqual(Object.keys(flatNs.table));
    expect(wrappedNs.table['user']?.columns).toEqual(flatNs.table['user']?.columns);
  });
});

describe('mixed-case enum type names (Prisma-ORM-created types)', () => {
  // Prisma ORM's migration engine names the type after the PSL enum —
  // PascalCase, created quoted ("HoldType"). Postgres case-folds unquoted
  // identifiers, so any consumer of the inferred contract that renders the
  // type name unquoted resolves a nonexistent lowercase type (TML-3085).
  // Lowercase-only fixtures cannot observe that class of bug.
  const HOLD_TYPE: FlatNativeEnumEntry = {
    typeName: 'HoldType',
    values: ['active', 'released'],
  };

  function ordersNamespace(schemaName: string) {
    return namespaceNode(
      schemaName,
      {
        orders: table('orders', {
          id: idColumn,
          hold: { name: 'hold', nativeType: 'HoldType', nullable: false },
        }),
      },
      [HOLD_TYPE],
    );
  }

  it('preserves the PascalCase type name verbatim through infer and print', () => {
    const output = inferAndPrint(tree({ public: ordersNamespace('public') }));

    // The block name already equals the type name, so no @@map is emitted —
    // the interpret test below proves the nativeType still round-trips.
    expect(output).toContain('native_enum HoldType {');
    expect(output).not.toContain('@@map("HoldType")');
    expect(output).toContain('pg.enum(HoldType)');
    expect(output).not.toContain('holdtype');
    expect(output).not.toContain('Unsupported(');
  });

  it('interprets with the mixed-case typeName in typeParams — the input the cast-quoting policy keys on', () => {
    const result = interpret(inferAndPrint(tree({ public: ordersNamespace('public') })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.valueSet?.['HoldType']).toMatchObject({ values: ['active', 'released'] });
    expect(ns.table['orders']?.columns['hold']).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'HoldType',
      typeParams: { typeName: 'HoldType' },
    });
  });
});
