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

function namespaceScalarTypeCodecIds(): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [name, output] of collectScalarTypeConstructors(stack.authoringContributions.type)) {
    result.set(name, output.codecId);
  }
  return result;
}

const REPRESENTATIVE_SCHEMA = `model sample {
  id        ObjectId @id @map("_id")
  name      String
  count     Int
  active    Boolean
  ratio     Float
  createdAt DateTime
  parentRef ObjectId
}
`;

function emit(scalarTypeCodecIds: ReadonlyMap<string, string>) {
  const { document, sourceFile } = parse(REPRESENTATIVE_SCHEMA);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToMongoContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    scalarTypeCodecIds,
    controlMutationDefaults: new Map(),
    codecLookup: stack.codecLookup,
    authoringContributions: stack.authoringContributions,
  });
}

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned literals
// below carry the parity claim forward — they are the exact
// {codecId, nativeType} pairs the retired map + codecLookup derivation produced.
describe('mongo scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId, nativeType}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'mongo/string@1', nativeType: 'string' },
      Int: { codecId: 'mongo/int32@1', nativeType: 'int' },
      Boolean: { codecId: 'mongo/bool@1', nativeType: 'bool' },
      DateTime: { codecId: 'mongo/date@1', nativeType: 'date' },
      ObjectId: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
      Float: { codecId: 'mongo/double@1', nativeType: 'double' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'Boolean',
      'DateTime',
      'Float',
      'Int',
      'ObjectId',
      'String',
    ]);
  });

  it('resolves ObjectId fields (incl. the mandated _id) through the derived map', () => {
    const result = emit(namespaceScalarTypeCodecIds());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              sample: {
                fields: {
                  _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                  parentRef: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                },
              },
            },
          },
        },
      },
    });
  });
});
