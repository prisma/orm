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

describe('a Mongo enum over a codec whose stored form is not the value', () => {
  it('stores each member in the form its codec stores it, in the domain enum and the value set', () => {
    const schema = [
      'enum Level {',
      '  @@type("mongo/int64@1")',
      '  Low  = "1"',
      '  High = "10"',
      '}',
      'enum Launch {',
      '  @@type("mongo/date@1")',
      '  First = "2024-01-01T00:00:00.000Z"',
      '}',
      'model Reading {',
      '  id     ObjectId @id @map("_id")',
      '  level  Level',
      '  launch Launch',
      '}',
      '',
    ].join('\n');
    const result = interpret(schema);

    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    if (!result.ok) return;
    const contract = result.value;
    expect({
      domain: contract.domain.namespaces['__unbound__']?.enum,
      valueSets: contract.storage.namespaces['__unbound__']?.entries['valueSet'],
    }).toEqual({
      domain: {
        Level: {
          codecId: 'mongo/int64@1',
          members: [
            { name: 'Low', value: '1' },
            { name: 'High', value: '10' },
          ],
        },
        Launch: {
          codecId: 'mongo/date@1',
          members: [{ name: 'First', value: '2024-01-01T00:00:00.000Z' }],
        },
      },
      valueSets: {
        Level: expect.objectContaining({ kind: 'valueSet', values: ['1', '10'] }),
        Launch: expect.objectContaining({
          kind: 'valueSet',
          values: ['2024-01-01T00:00:00.000Z'],
        }),
      },
    });
  });
});
