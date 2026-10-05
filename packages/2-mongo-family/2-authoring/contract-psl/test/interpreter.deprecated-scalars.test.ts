import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  AuthoringContributions,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

function scalar(
  codecId: string,
  nativeType: string,
  replacement?: string,
): AuthoringTypeConstructorDescriptor {
  return {
    kind: 'typeConstructor',
    output: { codecId, nativeType },
    ...(replacement === undefined ? {} : { deprecated: { replacement } }),
  };
}

const type = {
  ObjectId: scalar('mongo/objectId@1', 'objectId'),
  Int64: scalar('mongo/int64@1', 'long'),
  Binary: scalar('mongo/binary@1', 'binData'),
  Int32: scalar('mongo/int32@1', 'int'),
  Double: scalar('mongo/double@1', 'double'),
  Bool: scalar('mongo/bool@1', 'bool'),
  Date: scalar('mongo/date@1', 'date'),
  Int: scalar('mongo/int32@1', 'int', 'Int32'),
  Float: scalar('mongo/double@1', 'double', 'Double'),
  Boolean: scalar('mongo/bool@1', 'bool', 'Bool'),
  DateTime: scalar('mongo/date@1', 'date', 'Date'),
};

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map(
  Object.entries(type).map(([name, descriptor]) => [name, descriptor.output.codecId]),
);

const authoringContributions = { type, field: {} } as unknown as AuthoringContributions;

function interpret(schema: string) {
  const warnings: ContractSourceDiagnostic[] = [];
  const result = interpretMongoContract(schema, {
    scalarTypeCodecIds,
    authoringContributions,
    controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
    reportWarning: (diagnostic) => {
      warnings.push(diagnostic);
    },
  });
  return { result, warnings };
}

const schemaWith = (typeName: string) =>
  `model Post {\n  id ObjectId @id @map("_id")\n  value ${typeName}?\n}\n`;

describe('deprecated Mongo PSL scalar names', () => {
  it.each([
    ['Int', 'Int32', 'int'],
    ['Float', 'Double', 'double'],
    ['Boolean', 'Bool', 'bool'],
    ['DateTime', 'Date', 'date'],
  ])(
    'accepts %s with a warning at the type, and gives the contract %s gives',
    (oldName, newName, bsonType) => {
      const deprecated = interpret(schemaWith(oldName));
      const current = interpret(schemaWith(newName));

      expect(deprecated.warnings).toEqual([
        {
          code: 'PSL_DEPRECATED_SCALAR_NAME',
          message: `Scalar type "${oldName}" is deprecated and will be removed; use "${newName}" (stored as BSON ${bsonType}).`,
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3, column: 9 }),
            end: expect.objectContaining({ line: 3, column: 9 + oldName.length }),
          }),
          severity: 'warning',
        },
      ]);
      expect(deprecated.result.ok).toBe(true);
      expect(current.warnings).toEqual([]);
      if (!deprecated.result.ok || !current.result.ok) return;
      expect(JSON.stringify(deprecated.result.value)).toBe(JSON.stringify(current.result.value));
    },
  );

  it('accepts a deprecated name when no warning sink is supplied', () => {
    const result = interpretMongoContract(schemaWith('Int'), {
      scalarTypeCodecIds,
      authoringContributions,
      controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
    });
    expect(result.ok).toBe(true);
  });

  it('reports an unresolved type at the type, listing the scalar types', () => {
    const { result } = interpret(schemaWith('Money'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Field "Post.value" has type "Money", which is not a scalar type, an enum, a composite type or a model. The Mongo scalar types are ObjectId, Int64, Binary, Int32, Double, Bool and Date.',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({
          start: expect.objectContaining({ line: 3, column: 9 }),
          end: expect.objectContaining({ line: 3, column: 14 }),
        }),
      }),
    ]);
  });

  it.each([
    ['BigInt', 'Int64', 'long'],
    ['Bytes', 'Binary', 'binData'],
  ])(
    'refuses %s, a name from an earlier Prisma, and names %s instead',
    (oldName, newName, bsonType) => {
      const { result } = interpret(schemaWith(oldName));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: `Field "Post.value" has type "${oldName}", which is not a Mongo scalar type; use "${newName}" (stored as BSON ${bsonType}).`,
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3, column: 9 }),
          }),
        }),
      ]);
    },
  );
});
