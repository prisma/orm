import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function interpret(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'schema.prisma',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
    }),
    bound.seedDiagnostics,
  );
}

describe('a Mongo enum over a codec without exactly one BSON type', () => {
  it.each([
    ['mongo/json@1', 8],
    ['mongo/bson@1', 0],
  ])(
    'refuses @@type("%s"), which declares %i BSON types, at the @@type argument and nowhere else',
    (codecId, count) => {
      const typeAttribute = `@@type("${codecId}")`;
      const schema = `enum Shape {\n  ${typeAttribute}\n  a\n}\nmodel Figure {\n  id    ObjectId @id @map("_id")\n  shape Shape\n  other Shape?\n}\n`;
      const result = interpret(schema);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const start = schema.indexOf(`"${codecId}"`);
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "Shape" @@type codec "${codecId}" declares ${count} BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.`,
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: start }),
            end: expect.objectContaining({ offset: start + codecId.length + 2 }),
          }),
        }),
      ]);
    },
  );
});

describe('a Mongo enum over an unknown codec', () => {
  it('reports the unknown codec at the @@type argument', () => {
    const schema = 'enum Shape {\n  @@type("mongo/nope@1")\n  a\n}\n';
    const result = interpret(schema);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const start = schema.indexOf('"mongo/nope@1"');
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: 'enum "Shape" @@type references unknown codec "mongo/nope@1"',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: start }),
          end: expect.objectContaining({ offset: start + '"mongo/nope@1"'.length }),
        }),
      }),
    ]);
  });
});

describe('a Mongo enum whose members the collection validator cannot list', () => {
  it.each([
    ['mongo/int64@1', 'long', '"1"'],
    ['mongo/date@1', 'date', '"2024-01-01T00:00:00.000Z"'],
    ['mongo/objectId@1', 'objectId', '"65a1b2c3d4e5f6a7b8c9d0e1"'],
  ])(
    'refuses @@type("%s"), whose BSON type is %s, at the @@type argument',
    (codecId, bsonType, written) => {
      const schema = `enum Level {\n  @@type("${codecId}")\n  First = ${written}\n}\nmodel Reading {\n  id    ObjectId @id @map("_id")\n  level Level\n}\n`;
      const result = interpret(schema);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const start = schema.indexOf(`"${codecId}"`);
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "Level" @@type codec "${codecId}" stores BSON type ${bsonType}, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.`,
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: start }),
            end: expect.objectContaining({ offset: start + codecId.length + 2 }),
          }),
        }),
      ]);
    },
  );

  it('refuses a double member stored as text, at the member', () => {
    const schema =
      'enum Ratio {\n  @@type("mongo/double@1")\n  Half = 1.5\n  Unknown = "NaN"\n}\nmodel Reading {\n  id    ObjectId @id @map("_id")\n  ratio Ratio\n}\n';
    const result = interpret(schema);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Ratio" member "Unknown" is stored as "NaN", which a collection validator cannot list as a double. A member of a double enum must be a finite number.',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('Unknown') }),
        }),
      }),
    ]);
  });
});
