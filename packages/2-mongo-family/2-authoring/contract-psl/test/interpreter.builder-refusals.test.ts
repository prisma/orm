import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const lookups = {
  scalarTypes: new Map([
    ['String', 'mongo/string@1'],
    ['Int', 'mongo/int32@1'],
    ['ObjectId', 'mongo/objectId@1'],
  ]),
  defaultFunctionRegistry: new Map(),
  codecLookup: mongoCodecLookup,
  dataTypes: mongoDataTypeSupport,
} as const;

function diagnosticsOf(schema: string): readonly ContractSourceDiagnostic[] {
  const result = interpretMongoContract(schema, lookups);
  if (result.ok) throw new Error('Expected interpretation to fail');
  return result.failure.diagnostics;
}

/** Each diagnostic with the schema text its span covers. */
function located(schema: string, diagnostics: readonly ContractSourceDiagnostic[]) {
  return diagnostics.map(({ code, span }) => ({
    code,
    at: span === undefined ? undefined : schema.slice(span.start.offset, span.end.offset),
  }));
}

describe('Mongo PSL on the builder', () => {
  it('reports every refusal of the builder, each where the schema writes its subject', () => {
    const schema = `model Task {
  id    ObjectId @id @map("_id")
  type  String?
  title String
  name  String @map("title")
  @@discriminator(type)
}

model Bug {
  severity String
  @@base(Task, "bug")
  @@map("bugs")
}
`;
    expect(located(schema, diagnosticsOf(schema))).toEqual([
      { code: 'PSL_MONGO_VARIANT_SEPARATE_COLLECTION', at: '@@base(Task, "bug")' },
      { code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT', at: '@@discriminator(type)' },
      { code: 'PSL_DUPLICATE_STORED_NAME', at: 'name  String @map("title")' },
    ]);
  });

  it('refuses an index that another model on the same collection already declares', () => {
    const schema = `model User {
  id    ObjectId @id @map("_id")
  email String
  @@index([email])
  @@map("users")
}

model Admin {
  id    ObjectId @id @map("_id")
  email String
  @@index([email])
  @@map("users")
}
`;
    const [diagnostic] = diagnosticsOf(schema);

    expect({
      count: diagnosticsOf(schema).length,
      code: diagnostic?.code,
      message: diagnostic?.message,
      at: diagnostic?.span?.start.line,
    }).toEqual({
      count: 1,
      code: 'PSL_INVALID_INDEX',
      message:
        'Collection "users" already has this index, declared on model "User". Remove one of them from model "Admin" or "User".',
      at: 11,
    });
  });

  it('refuses an index its model declares twice', () => {
    const schema = `model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  @@unique([email])
}
`;
    expect(diagnosticsOf(schema).map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_INVALID_INDEX',
        message: 'Model "User" declares this index twice. Remove one of them.',
      },
    ]);
  });

  it('reports the warnings of a schema it refuses', () => {
    const warnings: ContractSourceDiagnostic[] = [];
    const result = interpretMongoContract(
      `model Post {
  id    ObjectId @id @map("_id")
  at    DateTime
  a     String
  b     String   @map("a")
}
`,
      {
        ...lookups,
        authoringContributions: {
          type: {
            DateTime: {
              kind: 'typeConstructor',
              output: { codecId: 'mongo/date@1' },
              deprecated: { replacement: 'Date' },
            },
          },
        },
        reportWarning: (diagnostic) => warnings.push(diagnostic),
      },
    );
    if (result.ok) throw new Error('Expected interpretation to fail');

    expect({
      errors: result.failure.diagnostics.map(({ code }) => code),
      warnings: warnings.map(({ code }) => code),
    }).toEqual({
      errors: ['PSL_DUPLICATE_STORED_NAME'],
      warnings: ['PSL_DEPRECATED_SCALAR_NAME'],
    });
  });

  it('records the extension packs of the stack', () => {
    const extension = {
      kind: 'extension',
      id: 'audit',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
    } as const;
    const result = interpretMongoContract('model User {\n  id ObjectId @id @map("_id")\n}\n', {
      ...lookups,
      extensionPacks: { audit: extension },
    });
    if (!result.ok) throw new Error(result.failure.summary);

    expect(result.value.extensions).toEqual({ audit: extension });
  });
});
