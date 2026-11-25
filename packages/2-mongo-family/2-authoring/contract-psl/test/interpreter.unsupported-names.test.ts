import { enumType } from '@internal/contract-authoring';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { jsonValue, mapBlock } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const lookups = {
  scalarTypes: new Map([
    ['String', 'mongo/string@1'],
    ['ObjectId', 'mongo/objectId@1'],
  ]),
  defaultFunctionRegistry: new Map(),
  codecLookup: mongoCodecLookup,
  dataTypes: mongoDataTypeSupport,
} as const;

function diagnosticsOf(schema: string) {
  const result = interpretMongoContract(schema, lookups);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

function placedDiagnosticsOf(schema: string) {
  const result = interpretMongoContract(schema, lookups);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message, span }) => ({
        code,
        message,
        start: span?.start,
      }));
}

const reason =
  'which JavaScript reads as the prototype of an object rather than as a key. Choose another name.';

describe('a Mongo schema naming something __proto__', () => {
  it('refuses a collection named __proto__', () => {
    expect(
      diagnosticsOf('model Item {\n  id ObjectId @id @map("_id")\n  @@map("__proto__")\n}'),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Model "Item" is stored in collection "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses a model named __proto__', () => {
    expect(diagnosticsOf('model __proto__ {\n  id ObjectId @id @map("_id")\n}')).toEqual([
      { code: 'PSL_STORED_NAME_UNSUPPORTED', message: `A model is named "__proto__", ${reason}` },
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Model "__proto__" is stored in collection "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses a field named __proto__ that is stored under another name', () => {
    expect(
      placedDiagnosticsOf(
        'model Item {\n  id ObjectId @id @map("_id")\n  __proto__ String @map("proto")\n}',
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A field of model "Item" is named "__proto__", ${reason}`,
        start: expect.objectContaining({ line: 3, column: 3 }),
      },
    ]);
  });

  it('refuses a composite type member named __proto__', () => {
    expect(
      placedDiagnosticsOf(
        'type Addr {\n  __proto__ String\n}\nmodel Item {\n  id ObjectId @id @map("_id")\n  a Addr\n}',
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A field of composite type "Addr" is named "__proto__", ${reason}`,
        start: expect.objectContaining({ line: 2, column: 3 }),
      },
    ]);
  });

  it('refuses a relation named __proto__', () => {
    expect(
      placedDiagnosticsOf(
        [
          'model User {',
          '  id ObjectId @id @map("_id")',
          '  postId ObjectId',
          '  __proto__ Post @relation(fields: [postId], references: [id])',
          '}',
          'model Post {',
          '  id ObjectId @id @map("_id")',
          '  users User[]',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A relation of model "User" is named "__proto__", ${reason}`,
        start: expect.objectContaining({ line: 4, column: 3 }),
      },
    ]);
  });

  it('refuses a back relation named __proto__', () => {
    expect(
      placedDiagnosticsOf(
        [
          'model User {',
          '  id ObjectId @id @map("_id")',
          '  __proto__ Post[]',
          '}',
          'model Post {',
          '  id ObjectId @id @map("_id")',
          '  userId ObjectId',
          '  user User @relation(fields: [userId], references: [id])',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A relation of model "User" is named "__proto__", ${reason}`,
        start: expect.objectContaining({ line: 3, column: 3 }),
      },
    ]);
  });

  it('refuses a composite type named __proto__', () => {
    expect(
      diagnosticsOf(
        'type __proto__ {\n  a String\n}\nmodel Item {\n  id ObjectId @id @map("_id")\n  k __proto__\n}',
      ),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `A composite type is named "__proto__", ${reason}`,
      },
    ]);
  });

  it('refuses an enum named __proto__', () => {
    const result = interpretMongoContract(
      'enum __proto__ {\n  A\n}\nmodel Item {\n  id ObjectId @id @map("_id")\n  kind __proto__\n}',
      {
        ...lookups,
        authoringContributions: {
          type: {},
          modelAttributes: {},
          entityTypes: {
            enum: {
              kind: 'entity',
              discriminator: 'enum',
              output: {
                factory: () =>
                  enumType('__proto__', { codecId: 'mongo/string@1' }, { name: 'A', value: 'A' }),
              },
            },
          },
          pslBlockDescriptors: {
            enum: {
              kind: 'pslBlock',
              keyword: 'enum',
              discriminator: 'enum',
              name: { required: true },
              spec: () =>
                mapBlock({
                  value: { type: jsonValue(), documentation: 'The member value.' },
                  allowBare: true,
                }),
            },
          },
        },
      },
    );
    expect(
      result.ok
        ? []
        : result.failure.diagnostics.map(({ code, message, span }) => ({
            code,
            message,
            start: span?.start,
          })),
    ).toEqual([
      {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `An enum is named "__proto__", ${reason}`,
        start: { offset: 0, line: 1, column: 1 },
      },
    ]);
  });
});
