import { structBlock } from '@internal/psl-parser';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract,
} from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  modelsOf,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarColumnDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';

const baseInput = {
  target: postgresTarget,
  codecLookup: postgresCodecLookup,
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: {
    type: postgresScalarAuthoringTypes,
    dataTypes: fixtureDataTypeSupport.entries,
  },
  dataTypeLookup: fixtureDataTypeSupport.lookup,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function expectDiagnosticForSchema(
  schema: string,
  diagnostic: { readonly code: string; readonly message?: string },
): void {
  const result = interpretSqlContract(schema, {
    ...baseInput,
    controlMutationDefaults: builtinControlMutationDefaults,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  const expected =
    diagnostic.message === undefined
      ? { code: diagnostic.code }
      : { code: diagnostic.code, message: diagnostic.message };
  expect(result.failure.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining(expected)]),
  );
}

describe('interpretPslDocumentToSqlContract diagnostics', () => {
  it.each(['42', '"ignored", extra: true', 'name: "ignored"', '', '""'])(
    'reports malformed storage names (%s) once despite multiple incoming references',
    (argument) => {
      const schema = `model User {
  id Int @id @map(${argument})
  @@map(${argument})
}
${['First', 'Second', 'Third']
  .map(
    (name) => `model ${name} {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}`,
  )
  .join('\n')}`;
      const result = interpretSqlContract(schema, { ...baseInput });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics.map(({ code }) => code)).toEqual(
        Array.from(
          { length: argument.startsWith('name:') ? 4 : 2 },
          () => 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        ),
      );
    },
  );

  it.each([
    { declaration: 'name String @map("")', attribute: '@map("")', column: 15 },
    { declaration: '@@map("")', attribute: '@@map("")', column: 3 },
  ])(
    'rejects empty mapped names in $declaration with an attribute span',
    ({ declaration, attribute, column }) => {
      const schema = `model User {\n  id Int @id\n  ${declaration}\n}`;
      const result = interpretSqlContract(schema, { ...baseInput });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const offset = schema.indexOf(attribute);
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
            message: 'Mapped name must not be empty',
            sourceId: 'schema.prisma',
            span: {
              start: { offset, line: 3, column },
              end: {
                offset: offset + attribute.length,
                line: 3,
                column: column + attribute.length,
              },
            },
          }),
        ]),
      );
    },
  );

  it.each(['display_name', ' '])('accepts nonempty mapped names %j', (name) => {
    const schema = `model User {\n  id Int @id\n  name String @map("${name}")\n  @@map("${name}")\n}`;
    const result = interpretSqlContract(schema, { ...baseInput });
    expect(result.ok).toBe(true);
  });

  it('retains other field diagnostics alongside an empty mapped name', () => {
    const schema = 'model User {\n  id Int @id\n  name String @map("")\n  bad MissingType\n}';
    const result = interpretSqlContract(schema, { ...baseInput });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "MissingType"' },
      { code: 'PSL_INVALID_ATTRIBUTE_SYNTAX', message: 'Mapped name must not be empty' },
    ]);
  });

  it('throws when target context is missing', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}`,
      sourceId: 'schema.prisma',
    });

    // Intentionally bypasses strict input typing to verify the missing-target assertion.
    expect(() =>
      interpretPslDocumentToSqlContract({
        ...document,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
      } as unknown as InterpretPslDocumentToSqlContractInput),
    ).toThrow(InternalError);
  });

  it('guards against named type declarations missing both base type and constructor', () => {
    const result = interpretSqlContract(
      `types {
  Broken
}`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message: 'Named type "Broken" must declare a base type or constructor',
        }),
      ]),
    );
  });

  it('reports an unregistered named-type constructor without a binder reference', () => {
    const result = interpretSqlContract(
      `types {
  Weird = pgvector.vector(3)
}`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR',
        message: 'Named type "Weird" references unsupported constructor "pgvector.vector"',
      }),
    ]);
  });

  it('returns diagnostics for unsupported named types, field lists, missing keys, and an unresolved relation target', () => {
    const result = interpretSqlContract(
      `types {
  DisplayName = VarChar(191)
  Weird = Unsupported
}

model Team {
  name String
}

model User {
  id Int @id
  tags String[]
  ghost Ghost @relation(fields: [ghostId], references: [id])
  ghostId Int
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PSL_UNRESOLVED_REFERENCE',
      'PSL_UNRESOLVED_REFERENCE',
      'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
    ]);
  });

  it('returns diagnostics when @map and @@map arguments are not quoted string literals', () => {
    const result = interpretSqlContract(
      `model Team {
  id Int @id @map(team_id)
  @@map(org_team)
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    const mapDiagnostics = result.failure.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX',
    );
    expect(mapDiagnostics).toHaveLength(2);
    for (const diagnostic of mapDiagnostics) {
      expect(diagnostic.message).toContain('Expected a string literal');
    }
  });

  it('returns diagnostics for unsupported model attributes', () => {
    const result = interpretSqlContract(
      `model Team {
  id Int @id
  @@unsupported([id])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('Schema has 1 error');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
          message: 'Model "Team" uses unsupported attribute "@@unsupported"',
        }),
      ]),
    );
  });

  it('returns diagnostics for duplicate field and model primary keys', () => {
    expectDiagnosticForSchema(
      `model Membership {
  id Int @id
  orgId String
  userId String

  @@id([orgId, userId])
}
`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: 'Model "Membership" cannot declare both field-level @id and model-level @@id',
      },
    );
  });

  it('returns diagnostics for nullable composite primary key fields', () => {
    expectDiagnosticForSchema(
      `model Membership {
  orgId String
  userId String?

  @@id([orgId, userId])
}
`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Model "Membership" @@id cannot include optional field "userId"; primary key columns must be NOT NULL',
      },
    );
  });

  it('returns diagnostics for unknown composite primary key fields', () => {
    expectDiagnosticForSchema(
      `model Membership {
  orgId String
  userId String

  @@id([orgId, missingId])
}
`,
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find field "missingId" on "Membership"',
      },
    );
  });

  it('returns PSL_UNSUPPORTED_MODEL_ATTRIBUTE for a model attribute with an unrecognized namespace', () => {
    const result = interpretSqlContract(
      `model Team {
  id Int @id
  @@pgvector.index(length: 3)
}
`,
      {
        ...baseInput,
        composedExtensions: [],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('Schema has 1 error');
    expect(result.failure.diagnostics).toHaveLength(1);
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
          message: 'Model "Team" uses unsupported attribute "@@pgvector.index"',
        }),
      ]),
    );
  });

  it('returns PSL_UNSUPPORTED_FIELD_ATTRIBUTE for a field attribute with an unrecognized namespace', () => {
    const result = interpretSqlContract(
      `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      {
        ...baseInput,
        composedExtensions: [],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('Schema has 1 error');
    expect(result.failure.diagnostics).toHaveLength(1);
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: 'Field "Document.embedding" uses unsupported attribute "@pgvector.column"',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
        }),
      ]),
    );
  });

  it('returns diagnostics for list fields with unknown types', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
  things Unknown[]
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('Schema has 1 error');
    expect(result.failure.diagnostics).toHaveLength(1);
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: expect.stringContaining('Unknown'),
        }),
      ]),
    );
  });

  it('returns diagnostics for invalid Postgres native type constructor usage', () => {
    const result = interpretSqlContract(
      `types {
  BadChar = Char(0)
  BadReal = Real(1)
  BadTimestamp = Timestamp(-1)
}

model InvalidNativeTypes {
  id Int @id
  badChar BadChar
  badReal BadReal
  badTimestamp BadTimestamp
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadChar" constructor "Char" Argument "length" of Char must be >= 1, received 0',
          ),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadReal" constructor "Real" accepts at most 0 argument(s), received 1.',
          ),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadTimestamp" constructor "Timestamp" Argument "precision" of Timestamp must be >= 0, received -1',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields and references lengths differ', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  user User @relation(fields: [authorId, reviewerId], references: [id])
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: expect.stringContaining('must provide the same number of fields and references'),
        }),
      ]),
    );
  });

  it('returns diagnostics when navigation list fields use unsupported attributes', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
  posts Post[] @unique
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          message: 'Field "User.posts" uses unsupported attribute "@unique"',
        }),
      ]),
    );
  });

  it('returns diagnostics when backrelation list declares FK-side relation arguments', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
  posts Post[] @relation(fields: [id], references: [userId])
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_RELATION_ATTRIBUTE',
          message: expect.stringContaining('cannot declare fields/references'),
        }),
      ]),
    );
  });

  it('returns diagnostics for orphaned backrelation list fields', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ORPHANED_BACKRELATION',
          message: expect.stringContaining('User.posts'),
        }),
      ]),
    );
  });

  it('returns diagnostics for ambiguous backrelation list matches', () => {
    const result = interpretSqlContract(
      `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  primaryUserId Int
  secondaryUserId Int
  primaryUser User @relation(fields: [primaryUserId], references: [id])
  secondaryUser User @relation(fields: [secondaryUserId], references: [id])
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION',
          message: expect.stringContaining('User.posts'),
        }),
      ]),
    );
  });

  it('preserves parser diagnostics with source spans', () => {
    const result = interpretSqlContract(
      `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      { ...baseInput },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 1, column: 1 }),
            end: expect.objectContaining({ line: 1 }),
          }),
        }),
      ]),
    );
  });

  it('reports attributes prefixed with the family or target id as plain unsupported attributes', () => {
    const result = interpretSqlContract(
      `model User {
  id    Int    @id
  name  String @sql.foo
  email String @postgres.bar
  @@sql.qux("x")
}
`,
      {
        ...baseInput,
        composedExtensions: [],
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.failure.diagnostics.map((d) => d.code);
    expect(codes).toHaveLength(3);
    expect(codes).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      ]),
    );
  });

  it('surfaces value-object field errors through the diagnostics gate', () => {
    const result = interpretSqlContract(
      `type Address {
  street String
  bogus  Missing
}

model User {
  id      Int     @id
  address Address
}
`,
      {
        ...baseInput,
        authoringContributions: {
          ...baseInput.authoringContributions,
          valueObjectStorageType: 'Jsonb',
        },
        composedExtensions: [],
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.failure.diagnostics.map(({ code, message, sourceId }) => ({
        code,
        message,
        sourceId,
      })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Missing"',
        sourceId: 'schema.prisma',
      },
    ]);
  });

  it('reports PSL_UNRESOLVED_REFERENCE for an incomplete constructor call and for an unrecognized namespace', () => {
    const incompleteCallResult = interpretSqlContract(
      `model User {
  id Int @id
  name sql.String(
}
`,
      {
        ...baseInput,
        composedExtensions: [],
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(incompleteCallResult.ok).toBe(false);
    if (incompleteCallResult.ok) return;
    expect(incompleteCallResult.failure.diagnostics).toHaveLength(1);
    expect(incompleteCallResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find type "sql.String"',
        }),
      ]),
    );

    const unresolvedResult = interpretSqlContract(
      `model User {
  id        Int @id
  embedding pgvector.Vector(1536)
}
`,
      {
        ...baseInput,
        composedExtensions: [],
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(unresolvedResult.ok).toBe(false);
    if (unresolvedResult.ok) return;
    expect(unresolvedResult.failure.diagnostics).toHaveLength(1);
    expect(unresolvedResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find type "pgvector.Vector"',
        }),
      ]),
    );
  });

  it('rejects @@id with no field list argument', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  @@id()
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('is missing required argument "fields"'),
        }),
      ]),
    );
  });

  it('rejects @@id with empty bracketed field list', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  @@id([])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Expected a non-empty list'),
        }),
      ]),
    );
  });

  it('reports an unrecognized namespace-qualified type as a single unresolved reference', () => {
    const result = interpretSqlContract(
      'model Document {\n  id Int @id\n  embedding pgvector.Vector(1536)\n}',
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code }) => code)).toEqual([
      'PSL_UNRESOLVED_REFERENCE',
    ]);
  });

  it('reports an unqualified unknown type name as a single unresolved reference', () => {
    const result = interpretSqlContract('model User {\n  id Int @id\n  ghost Ghostly\n}', {
      ...baseInput,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Ghostly"',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({
          start: expect.objectContaining({ line: 3 }),
        }),
        data: { reference: 'type', name: 'Ghostly', constructorCall: false },
      },
    ]);
  });

  it('rejects @@id referencing an unknown field', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  @@id([nope])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: expect.stringContaining('Cannot find field "nope" on "Thing"'),
        }),
      ]),
    );
  });

  it('rejects inline @id together with @@id', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String @id
  @@id([email])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: 'Model "Thing" cannot declare both field-level @id and model-level @@id',
        }),
      ]),
    );
  });

  it('rejects @@id with non-quoted map argument', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  @@id([email], map: not_a_string)
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Expected a string literal'),
        }),
      ]),
    );
  });

  it('rejects two @@id declarations on the same model', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  token String
  @@id([email])
  @@id([token])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: 'Model "Thing" declares @@id more than once',
        }),
      ]),
    );
  });

  it('rejects @@id with duplicate fields in the list', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String
  @@id([email, email])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Duplicate list entry',
        }),
      ]),
    );
  });

  it('rejects inline @id on an optional field', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String? @id
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message:
            'Field "Thing.email" @id cannot be optional; primary key columns must be NOT NULL',
        }),
      ]),
    );
  });

  it('rejects @@id including an optional field', () => {
    const result = interpretSqlContract(
      `model Thing {
  email String?
  @@id([email])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message:
            'Model "Thing" @@id cannot include optional field "email"; primary key columns must be NOT NULL',
        }),
      ]),
    );
  });

  it('rejects inline @id on multiple fields', () => {
    const result = interpretSqlContract(
      `model Thing {
  a Int @id
  b Int @id
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message:
            'Model "Thing" cannot declare inline @id on multiple fields; use model-level @@id([...]) for composite identity',
        }),
      ]),
    );
  });

  it('rejects field @unique with a non-quoted map argument', () => {
    const result = interpretSqlContract(
      `model Thing {
  id    Int @id
  email String @unique(map: not_a_string)
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Expected a string literal'),
        }),
      ]),
    );
  });

  it('rejects @@unique with duplicate fields in the list', () => {
    const result = interpretSqlContract(
      `model Thing {
  id    Int @id
  email String
  @@unique([email, email])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Duplicate list entry',
        }),
      ]),
    );
  });

  it('rejects @@index with duplicate fields in the list', () => {
    const result = interpretSqlContract(
      `model Thing {
  id    Int @id
  email String
  @@index([email, email])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Duplicate list entry',
        }),
      ]),
    );
  });

  describe('per-target namespace dispatch', () => {
    it('locates every rejected namespace declaration separately', () => {
      const result = interpretSqlContract(
        `namespace auth {}
namespace auth {}`,
        {
          ...baseInput,
          target: sqliteTarget,
          scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected namespace rejection');
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
          span: {
            start: { offset: 0, line: 1, column: 1 },
            end: { offset: 17, line: 1, column: 18 },
          },
        }),
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
          span: {
            start: { offset: 18, line: 2, column: 1 },
            end: { offset: 35, line: 2, column: 18 },
          },
        }),
      ]);
    });

    it('SQLite rejects every explicit `namespace { … }` block with a SQLite-flavoured diagnostic', () => {
      const result = interpretSqlContract(
        `namespace auth {
  model User {
    id Int @id
  }
}
`,
        {
          target: sqliteTarget,
          scalarColumnDescriptors: sqliteScalarColumnDescriptors,
          composedExtensionContracts: new Map(),
          controlMutationDefaults: builtinControlMutationDefaults,
          createNamespace: createTestSqlNamespace,
          dataTypeLookup: fixtureDataTypeSupport.lookup,
          capabilities: { sql: { scalarList: true } },
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
            message: expect.stringMatching(/SQLite/),
          }),
        ]),
      );
      const offending = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
      );
      expect(offending?.message).toContain('auth');
    });

    it('SQLite also rejects `namespace unbound { … }` (no late-binding semantics on SQLite)', () => {
      const result = interpretSqlContract(
        `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        {
          target: sqliteTarget,
          scalarColumnDescriptors: sqliteScalarColumnDescriptors,
          composedExtensionContracts: new Map(),
          controlMutationDefaults: builtinControlMutationDefaults,
          createNamespace: createTestSqlNamespace,
          dataTypeLookup: fixtureDataTypeSupport.lookup,
          capabilities: { sql: { scalarList: true } },
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const unsupported = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
      );
      expect(unsupported).toBeDefined();
      expect(unsupported?.message).toMatch(/SQLite/);
      expect(unsupported?.span).toBeDefined();
    });

    it('Postgres rejects a model-carrying `namespace unbound { … }` alongside a sibling named namespace', () => {
      const result = interpretSqlContract(
        `namespace unbound {
  model Tenant {
    id Int @id
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`,
        {
          ...baseInput,
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const reserved = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_RESERVED_NAMESPACE_NAME',
      );
      expect(reserved).toBeDefined();
      expect(reserved?.message).toContain('unbound');
      // Span must be populated so editor tooling can locate the offending
      // `namespace unbound { … }` block. A future refactor that drops the
      // `ifDefined('span', unboundBlock?.span)` shape would silently
      // regress this without an explicit assertion.
      expect(reserved?.span).toBeDefined();
    });

    it('Postgres rejects the raw sentinel spelling `namespace __unbound__ { … }` with models alongside a sibling named namespace', () => {
      const result = interpretSqlContract(
        `namespace __unbound__ {
  model Tenant {
    id Int @id
  }
}

namespace auth {
  model User {
    id Int @id
  }
}
`,
        {
          ...baseInput,
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const reserved = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_RESERVED_NAMESPACE_NAME',
      );
      expect(reserved).toBeDefined();
      expect(reserved?.span).toBeDefined();
    });

    it('Postgres rejects a model-carrying unbound alias even when a blocks-only unbound alias under the other spelling is declared first', () => {
      const rolePslBlockDescriptors = {
        role: {
          kind: 'pslBlock' as const,
          keyword: 'role',
          discriminator: 'role-like',
          name: { required: true },
          spec: () => structBlock({ parameters: {} }),
        },
      };
      const roleAuthoringContributions = {
        entityTypes: {
          role: {
            kind: 'entity' as const,
            discriminator: 'role-like',
            output: { factory: (raw: unknown) => raw },
          },
        },
        pslBlockDescriptors: rolePslBlockDescriptors,
      };

      const result = interpretSqlContract(
        `namespace unbound {
  role a {
  }
}

namespace __unbound__ {
  model M {
    id Int @id
  }
}

namespace auth {
  model X {
    id Int @id
  }
}
`,
        {
          ...baseInput,
          authoringContributions: roleAuthoringContributions,
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const reserved = result.failure.diagnostics.find(
        (d) => d.code === 'PSL_RESERVED_NAMESPACE_NAME',
      );
      expect(reserved).toBeDefined();
      // The blocks-only `namespace unbound { role a {} }` alias is declared
      // first; the diagnostic must still point at the model-carrying
      // `namespace __unbound__ { model M {} }` alias, not the first block
      // that happens to resolve to the unbound id.
      expect(reserved?.span).toEqual(
        expect.objectContaining({ start: expect.objectContaining({ line: 6 }) }),
      );
    });

    it('Postgres accepts `namespace unbound { … }` when it is the only named namespace', () => {
      const result = interpretSqlContract(
        `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        {
          ...baseInput,
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
    });
  });
});

describe('interpretPslDocumentToSqlContract list-field constructs', () => {
  it('rejects @id on a list field', () => {
    expectDiagnosticForSchema(
      `model Post {
  tags String[] @id
}
`,
      {
        code: 'PSL_LIST_ID_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot be a primary key. Remove @id; a list cannot be an identity column.',
      },
    );
  });

  it('authors a plain scalar list field with no diagnostics', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String[]
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      Post: {
        fields: {
          tags: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: { elementNullable: false },
          },
        },
      },
    });
  });

  it('rejects a scalar literal default on a list field as invalid syntax', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  tags String[] @default("x")
}
`,
      { code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' },
    );
  });

  it('rejects a scalar numeric default on a list field as invalid syntax', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  scores Int[] @default(5)
}
`,
      { code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' },
    );
  });

  it('lowers an empty-array default on a list field to a literal empty array', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String[] @default([])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['tags']).toMatchObject({
      nativeType: 'text',
      codecId: 'pg/text@1',
      many: { elementNullable: false },
      default: { kind: 'literal', value: [] },
    });
  });

  it('lowers a literal-list default encoding each element against the element codec', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String[] @default(["a", "b"])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['tags']).toMatchObject({
      many: { elementNullable: false },
      default: { kind: 'literal', value: ['a', 'b'] },
    });
  });

  it('lowers null as the literal default for a nullable scalar', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  title String? @default(null)
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['title']).toMatchObject({
      nullable: true,
      default: { kind: 'literal', value: null },
    });
  });

  it('rejects null as the literal default for a non-nullable scalar', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  title String @default(null)
}
`,
      {
        code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
      },
    );
  });

  it('lowers a null-containing literal default for nullable list elements', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String?[] @default(["a", null])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['tags']).toMatchObject({
      many: { elementNullable: true },
      default: { kind: 'literal', value: ['a', null] },
    });
  });

  it('preserves quoted null as a string beside a bare null in a nullable string-list default', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String?[] @default(["null", null])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['tags']).toEqual({
      nativeType: 'text',
      codecId: 'pg/text@1',
      nullable: false,
      many: { elementNullable: true },
      default: { kind: 'literal', value: ['null', null] },
    });
  });

  it('rejects a null-containing literal default for strict list elements at the null span', () => {
    const schema = `model Post {
  id Int @id
  tags String[] @default(["a", null])
}
`;
    const result = interpretSqlContract(schema, {
      ...baseInput,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.failure.diagnostics.find(
      (candidate) => candidate.code === 'PSL_INVALID_DEFAULT_APPLICABILITY',
    );
    const nullOffset = schema.indexOf('null');
    expect(diagnostic?.span).toEqual({
      start: { offset: nullOffset, line: 3, column: 32 },
      end: { offset: nullOffset + 4, line: 3, column: 36 },
    });
  });

  it('lowers a numeric-list default to a literal number array', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  scores Int[] @default([1, 2])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['scores']).toMatchObject({
      many: { elementNullable: false },
      default: { kind: 'literal', value: [1, 2] },
    });
  });

  it('lowers a boolean-list default to a literal boolean array', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  flags Boolean[] @default([true, false])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['flags']).toMatchObject({
      many: { elementNullable: false },
      default: { kind: 'literal', value: [true, false] },
    });
  });

  it('preserves commas inside a quoted list-default element', () => {
    const result = interpretSqlContract(
      `model Post {
  id Int @id
  tags String[] @default(["a,b", "c"])
}
`,
      {
        ...baseInput,
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['Post']?.columns['tags']).toMatchObject({
      many: { elementNullable: false },
      default: { kind: 'literal', value: ['a,b', 'c'] },
    });
  });
});

describe('@@index parameter matrix diagnostics', () => {
  function indexDiagnosticsFor(schema: string) {
    const result = interpretSqlContract(schema, {
      ...baseInput,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected diagnostics');
    return result.failure.diagnostics;
  }

  it('fields plus expression draws PSL_INDEX_FIELDS_XOR_EXPRESSION, span-anchored at the attribute', () => {
    const schema = `model Doc {
  id Int @id
  body String
  @@index([body], expression: "lower(body)", name: "doc_body_lower")
}`;
    const diagnostics = indexDiagnosticsFor(schema);
    const diagnostic = diagnostics.find((d) => d.code === 'PSL_INDEX_FIELDS_XOR_EXPRESSION');
    expect(diagnostic).toMatchObject({
      code: 'PSL_INDEX_FIELDS_XOR_EXPRESSION',
      message: '`@@index` requires exactly one of a fields list or an `expression` argument',
    });
    const span = diagnostic?.span;
    expect(span).toBeDefined();
    expect(schema.slice(span?.start.offset ?? 0)).toMatch(/^@@index/);
  });

  it('neither fields nor expression draws PSL_INDEX_FIELDS_XOR_EXPRESSION', () => {
    const diagnostics = indexDiagnosticsFor(`model Doc {
  id Int @id
  body String
  @@index(name: "doc_lookup")
}`);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INDEX_FIELDS_XOR_EXPRESSION',
          message: '`@@index` requires exactly one of a fields list or an `expression` argument',
        }),
      ]),
    );
  });

  it('an expression without name or map draws PSL_INDEX_EXPRESSION_REQUIRES_NAME at the attribute', () => {
    const schema = `model Doc {
  id Int @id
  body String
  @@index(expression: "lower(body)")
}`;
    const diagnostics = indexDiagnosticsFor(schema);
    const diagnostic = diagnostics.find((d) => d.code === 'PSL_INDEX_EXPRESSION_REQUIRES_NAME');
    expect(diagnostic).toMatchObject({
      code: 'PSL_INDEX_EXPRESSION_REQUIRES_NAME',
      message:
        '`@@index` with an `expression` argument requires a `name` or `map` argument (a default name cannot be derived from an expression)',
    });
    expect(schema.slice(diagnostic?.span?.start.offset ?? 0)).toMatch(/^@@index/);
  });

  it('name plus map draws PSL_INDEX_NAME_XOR_MAP at the attribute', () => {
    const schema = `model Doc {
  id Int @id
  body String
  @@index([body], name: "doc_body_idx", map: "doc_body_exact")
}`;
    const diagnostics = indexDiagnosticsFor(schema);
    const diagnostic = diagnostics.find((d) => d.code === 'PSL_INDEX_NAME_XOR_MAP');
    expect(diagnostic).toMatchObject({
      code: 'PSL_INDEX_NAME_XOR_MAP',
      message: '`@@index` takes at most one of `name` and `map`',
    });
    expect(schema.slice(diagnostic?.span?.start.offset ?? 0)).toMatch(/^@@index/);
  });

  it('two offending @@index attributes each anchor at their own span', () => {
    const schema = `model Doc {
  id Int @id
  body String
  @@index(expression: "lower(body)")
  @@index([body], name: "doc_body_idx", map: "doc_body_exact")
}`;
    const diagnostics = indexDiagnosticsFor(schema);
    const first = diagnostics.find((d) => d.code === 'PSL_INDEX_EXPRESSION_REQUIRES_NAME');
    const second = diagnostics.find((d) => d.code === 'PSL_INDEX_NAME_XOR_MAP');
    expect(first?.span).toBeDefined();
    expect(second?.span).toBeDefined();
    expect(first?.span?.start.offset).toBe(schema.indexOf('@@index'));
    expect(second?.span?.start.offset).toBe(schema.lastIndexOf('@@index'));
  });

  it('the existing options-requires-type refine still fires', () => {
    expectDiagnosticForSchema(
      `model Doc {
  id Int @id
  body String
  @@index([body], options: { key_field: "id" })
}`,
      { code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' },
    );
  });
});
