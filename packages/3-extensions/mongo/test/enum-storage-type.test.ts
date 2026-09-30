import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function interpret(schema: string) {
  const { document, sources } = parse(schema, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  return interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds: new Map(
      [...collectScalarTypeConstructors(stack.authoringContributions.type)].map(
        ([name, output]) => [name, output.codecId],
      ),
    ),
    controlMutationDefaults: {
      dataTypeEntries: {},
      defaultFunctionRegistry: new Map(),
    },
    codecLookup: stack.codecLookup,
    authoringContributions: stack.authoringContributions,
  });
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
