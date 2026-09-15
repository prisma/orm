import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
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
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: { type: postgresScalarAuthoringTypes },
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function expectDiagnosticForSchema(
  schema: string,
  diagnostic: { readonly code: string; readonly message?: string },
): void {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  const result = interpretPslDocumentToSqlContract({
    ...baseInput,
    ...document,
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
  it.each([
    { declaration: 'name String @map("")', attribute: '@map("")', column: 15 },
    { declaration: '@@map("")', attribute: '@@map("")', column: 3 },
  ])(
    'rejects empty mapped names in $declaration with an attribute span',
    ({ declaration, attribute, column }) => {
      const schema = `model User {\n  id Int @id\n  ${declaration}\n}`;
      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
      });
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
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
    });
    expect(result.ok).toBe(true);
  });

  it('retains other field diagnostics alongside an empty mapped name', () => {
    const schema = 'model User {\n  id Int @id\n  name String @map("")\n  bad MissingType\n}';
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Mapped name must not be empty',
        }),
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_FIELD_TYPE' }),
      ]),
    );
  });

  it('returns diagnostics when target context is missing', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}`,
      sourceId: 'schema.prisma',
    });

    // Intentionally bypasses strict input typing to verify missing target diagnostics.
    const result = interpretPslDocumentToSqlContract({
      ...document,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
    } as unknown as InterpretPslDocumentToSqlContractInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_TARGET_CONTEXT_REQUIRED',
        }),
      ]),
    );
  });

  it('guards against named type declarations missing both base type and constructor', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Broken
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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

  it('returns diagnostics for unsupported named types, field lists, missing keys, and invalid relation targets', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        'PSL_UNSUPPORTED_FIELD_TYPE',
        'PSL_INVALID_RELATION_TARGET',
      ]),
    );
  });

  it('returns diagnostics when @map and @@map arguments are not quoted string literals', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Team {
  id Int @id @map(team_id)
  @@map(org_team)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Team {
  id Int @id
  @@unsupported([id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
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
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Field "missingId" does not exist on model "Membership"',
      },
    );
  });

  it('returns diagnostics for model attributes with unrecognized extension namespace', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Team {
  id Int @id
  @@pgvector.index(length: 3)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          message: expect.stringContaining('uses unrecognized namespace "pgvector"'),
        }),
      ]),
    );
  });

  it('returns diagnostics when namespace is unrecognized', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Document {
  id Int @id
  embedding Bytes @pgvector.column(length: 1536)
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
          data: { namespace: 'pgvector', suggestedPack: 'pgvector' },
        }),
      ]),
    );
  });

  it('returns diagnostics for list fields with unknown types', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  things Unknown[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: expect.stringContaining('Unknown'),
        }),
      ]),
    );
  });

  it('returns diagnostics for invalid Postgres native type constructor usage', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining(
            'Named type "BadChar" constructor "Char" Authoring helper argument at Char[0] must be >= 1, received 0',
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
            'Named type "BadTimestamp" constructor "Timestamp" Authoring helper argument at Timestamp[0] must be >= 0, received -1',
          ),
        }),
      ]),
    );
  });

  it('returns diagnostics when relation fields and references lengths differ', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  user User @relation(fields: [authorId, reviewerId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  posts Post[] @unique
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  posts Post[] @relation(fields: [id], references: [userId])
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
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
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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
    const document = symbolTableInputFromParseArgs({
      schema: `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

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

  it('does not report family/target namespaces as uncomposed attribute namespaces', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id    Int    @id
  name  String @sql.foo
  email String @postgres.bar
  @@sql.qux("x")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.failure.diagnostics.map((d) => d.code);
    expect(codes).not.toContain('PSL_EXTENSION_NAMESPACE_NOT_COMPOSED');
    expect(codes).toEqual(
      expect.arrayContaining([
        'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
      ]),
    );
  });

  it('surfaces value-object field errors through the diagnostics gate', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `type Address {
  street String
  bogus  Missing
}

model User {
  id      Int     @id
  address Address
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      composedExtensions: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('emits distinct diagnostic codes for malformed versus uncomposed constructor calls', () => {
    const malformed = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  name sql.String(
}
`,
      sourceId: 'schema.prisma',
    });

    const malformedResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...malformed,
      composedExtensions: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(malformedResult.ok).toBe(false);
    if (malformedResult.ok) return;
    const malformedCodes = malformedResult.failure.diagnostics.map((d) => d.code);
    expect(malformedCodes).not.toContain('PSL_EXTENSION_NAMESPACE_NOT_COMPOSED');

    const uncomposed = symbolTableInputFromParseArgs({
      schema: `model User {
  id        Int @id
  embedding pgvector.Vector(1536)
}
`,
      sourceId: 'schema.prisma',
    });

    const uncomposedResult = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...uncomposed,
      composedExtensions: [],
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(uncomposedResult.ok).toBe(false);
    if (uncomposedResult.ok) return;
    expect(uncomposedResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
          data: { namespace: 'pgvector', suggestedPack: 'pgvector' },
        }),
      ]),
    );
  });

  it('rejects @@id with no field list argument', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  @@id()
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  @@id([])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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

  it('rejects @@id referencing an unknown field', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  @@id([nope])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Field "nope" does not exist on model "Thing"'),
        }),
      ]),
    );
  });

  it('rejects inline @id together with @@id', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String @id
  @@id([email])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  @@id([email], map: not_a_string)
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  token String
  @@id([email])
  @@id([token])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String
  @@id([email, email])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String? @id
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  email String?
  @@id([email])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  a Int @id
  b Int @id
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  id    Int @id
  email String @unique(map: not_a_string)
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  id    Int @id
  email String
  @@unique([email, email])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Thing {
  id    Int @id
  email String
  @@index([email, email])
}
`,
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
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
    it('SQLite rejects every explicit `namespace { … }` block with a SQLite-flavoured diagnostic', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `namespace auth {
  model User {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        target: sqliteTarget,
        scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        target: sqliteTarget,
        scalarColumnDescriptors: sqliteScalarColumnDescriptors,
        composedExtensionContracts: new Map(),
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        createNamespace: createTestSqlNamespace,
        capabilities: { sql: { scalarList: true } },
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
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
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `namespace __unbound__ {
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
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

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
          parameters: {},
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

      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
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
        sourceId: 'schema.prisma',
        pslBlockDescriptors: rolePslBlockDescriptors,
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        authoringContributions: roleAuthoringContributions,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

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
      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...baseInput,
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
    });
  });
});

describe('interpretPslDocumentToSqlContract list-field constructs', () => {
  it('rejects an execution default now() on a list field', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  tags String[] @default(now())
}
`,
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot use an execution default ("now()"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.',
      },
    );
  });

  it('rejects an execution default uuid() on a list field', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  tags String[] @default(uuid())
}
`,
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot use an execution default ("uuid()"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.',
      },
    );
  });

  it('rejects an execution default autoincrement() on a list field', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  tags Int[] @default(autoincrement())
}
`,
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot use an execution default ("autoincrement()"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.',
      },
    );
  });

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
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  tags String[]
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      Post: {
        fields: {
          tags: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
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
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  tags String[] @default([])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['post']?.columns['tags']).toMatchObject({
      nativeType: 'text',
      codecId: 'pg/text@1',
      many: true,
      default: { kind: 'literal', value: [] },
    });
  });

  it('lowers a literal-list default encoding each element against the element codec', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  tags String[] @default(["a", "b"])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['post']?.columns['tags']).toMatchObject({
      many: true,
      default: { kind: 'literal', value: ['a', 'b'] },
    });
  });

  it('lowers a numeric-list default to a literal number array', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  scores Int[] @default([1, 2])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['post']?.columns['scores']).toMatchObject({
      many: true,
      default: { kind: 'literal', value: [1, 2] },
    });
  });

  it('lowers a boolean-list default to a literal boolean array', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  flags Boolean[] @default([true, false])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['post']?.columns['flags']).toMatchObject({
      many: true,
      default: { kind: 'literal', value: [true, false] },
    });
  });

  it('preserves commas inside a quoted list-default element', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Post {
  id Int @id
  tags String[] @default(["a,b", "c"])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['post']?.columns['tags']).toMatchObject({
      many: true,
      default: { kind: 'literal', value: ['a,b', 'c'] },
    });
  });
});

describe('@@index parameter matrix diagnostics', () => {
  function indexDiagnosticsFor(schema: string) {
    const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
    const result = interpretPslDocumentToSqlContract({
      ...baseInput,
      ...document,
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
