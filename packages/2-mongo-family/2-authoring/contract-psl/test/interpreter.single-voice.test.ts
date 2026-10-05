import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
  ['ObjectId', 'mongo/objectId@1'],
]);

function interpret(schema: string) {
  return interpretMongoContract(
    schema,
    {
      scalarTypeCodecIds,
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map(),
        dataTypeEntries: {},
      },
    },
    'test.prisma',
  );
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected interpretation to fail');
  return result.failure.diagnostics;
}

function diagnosticCodes(schema: string): readonly string[] {
  return diagnosticsOf(schema).map((diagnostic) => diagnostic.code);
}

describe('one voice per resolution failure', () => {
  it.each(['missing.Mystery', 'Missing()'])('reports %s through the binder', (type) => {
    expect(
      diagnosticsOf(`model Item {\n  id ObjectId @id @map("_id")\n  bad ${type}\n}`).map(
        ({ code, message, sourceId }) => ({ code, message, sourceId }),
      ),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: `Cannot find type "${type.replace('()', '')}"`,
        sourceId: 'test.prisma',
      },
    ]);
  });

  it('reports an unknown unqualified type with the registered scalar names', () => {
    expect(
      diagnosticsOf('model Item {\n  id ObjectId @id @map("_id")\n  bad Mystery\n}').map(
        ({ code, message, sourceId }) => ({ code, message, sourceId }),
      ),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Field "Item.bad" has type "Mystery", which is not a scalar type, an enum, a composite type or a model. The Mongo scalar types are String, Int32 and ObjectId.',
        sourceId: 'test.prisma',
      },
    ]);
  });

  it('reports a scalar qualifier through the binder without lowering its member', () => {
    expect(
      diagnosticsOf('model Item {\n  id ObjectId @id @map("_id")\n  bad String.Int32\n}').map(
        ({ code, message, sourceId }) => ({ code, message, sourceId }),
      ),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: '"String" is a scalar type, not a namespace',
        sourceId: 'test.prisma',
      },
    ]);
  });

  it('classifies a composite declaration before a contributed scalar of the same name', () => {
    const result = interpret(`type String {
  length Int32
}
model Item {
  id ObjectId @id @map("_id")
  label String
}`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Item']?.fields).toEqual({
      _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false, many: false },
      label: { type: { kind: 'valueObject', name: 'String' }, nullable: false, many: false },
    });
    expect(result.value.domain.namespaces[UNBOUND_NAMESPACE_ID]?.valueObjects).toEqual({
      String: {
        fields: {
          length: {
            type: { kind: 'scalar', codecId: 'mongo/int32@1' },
            nullable: false,
            many: false,
          },
        },
      },
    });
  });

  it('rejects a resolved model reference in a composite field', () => {
    expect(
      diagnosticsOf(`type Wrapper {
  item Item
}
model Item {
  id ObjectId @id @map("_id")
}`).map(({ code, message, sourceId }) => ({ code, message, sourceId })),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: 'Field "Wrapper.item" type "Item" is not supported in Mongo PSL interpreter',
        sourceId: 'test.prisma',
      },
    ]);
  });

  it('reports an unknown model attribute only as unsupported', () => {
    expect(diagnosticCodes('model Item {\n  id ObjectId @id @map("_id")\n  @@mystery\n}')).toEqual([
      'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
    ]);
  });

  it('reports a missing @@base target only as an unresolved reference', () => {
    expect(
      diagnosticCodes('model Bug {\n  id ObjectId @id @map("_id")\n  @@base(NoSuch, "bug")\n}'),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });

  it('reports an unknown @@index field only as an unresolved reference', () => {
    expect(
      diagnosticCodes('model Item {\n  id ObjectId @id @map("_id")\n  @@index([nope])\n}'),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE']);
  });

  it('keeps the orphaned-backrelation verdict beside an unresolved relation field', () => {
    expect(
      diagnosticCodes(
        [
          'model User {',
          '  id ObjectId @id @map("_id")',
          '}',
          'model Post {',
          '  id ObjectId @id @map("_id")',
          '  authorId ObjectId',
          '  author User @relation(fields: [missing], references: [id])',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE', 'PSL_ORPHANED_BACKRELATION']);
  });

  it('keeps the orphaned-base verdict beside an unresolved discriminator field', () => {
    expect(
      diagnosticCodes(
        [
          'model Base {',
          '  id ObjectId @id @map("_id")',
          '  @@discriminator(nope)',
          '}',
          'model Child {',
          '  id ObjectId @id @map("_id")',
          '  @@base(Base, "c")',
          '}',
        ].join('\n'),
      ),
    ).toEqual(['PSL_UNRESOLVED_REFERENCE', 'PSL_ORPHANED_BASE']);
  });
});
