import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  AuthoringContributions,
  AuthoringTypeChoiceDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

function scalar(codecId: string, replacement?: string): AuthoringTypeConstructorDescriptor {
  return {
    kind: 'typeConstructor',
    output: { codecId },
    ...(replacement === undefined ? {} : { deprecated: { replacement } }),
  };
}

function choice(storage: string, explicit: string): AuthoringTypeChoiceDescriptor {
  return {
    kind: 'typeChoice',
    args: [
      { kind: 'option', name: 'storage', values: [storage], default: storage, optional: true },
    ],
    choices: [{ when: { storage }, type: explicit }],
  };
}

const type = {
  ObjectId: scalar('mongo/objectId@1'),
  Int64BigInt: scalar('mongo/int64@1'),
  Binary: scalar('mongo/binary@1'),
  Int32: scalar('mongo/int32@1'),
  Double: scalar('mongo/double@1'),
  Bool: scalar('mongo/bool@1'),
  DateTime: scalar('mongo/date@1'),
  Int: choice('int', 'Int32'),
  Float: choice('double', 'Double'),
  Boolean: choice('bool', 'Bool'),
  Int64: scalar('mongo/int64@1', 'Int64BigInt'),
};

const scalarTypes: ReadonlyMap<string, string> = new Map([
  ...Object.entries(type).flatMap(([name, descriptor]) =>
    descriptor.kind === 'typeConstructor' ? [[name, descriptor.output.codecId] as const] : [],
  ),
  ['Int', 'mongo/int32@1'],
  ['Float', 'mongo/double@1'],
  ['Boolean', 'mongo/bool@1'],
]);

const authoringContributions = { type } as unknown as AuthoringContributions;

function interpret(schema: string) {
  const warnings: ContractSourceDiagnostic[] = [];
  const result = interpretMongoContract(schema, {
    scalarTypes,
    authoringContributions,
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
    defaultFunctionRegistry: new Map(),
    reportWarning: (diagnostic) => {
      warnings.push(diagnostic);
    },
  });
  return { result, warnings };
}

const schemaWith = (typeName: string) =>
  `model Post {\n  id ObjectId @id @map("_id")\n  value ${typeName}?\n}\n`;

describe('deprecated Mongo PSL scalar names', () => {
  it.each([['Int64', 'Int64BigInt']])(
    'accepts %s with a warning at the type, and gives the contract %s gives',
    (oldName, newName) => {
      const deprecated = interpret(schemaWith(oldName));
      const current = interpret(schemaWith(newName));

      expect(deprecated.warnings).toEqual([
        {
          code: 'PSL_DEPRECATED_SCALAR_NAME',
          message: `Scalar type "${oldName}" is deprecated and will be removed; use "${newName}".`,
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

  describe('warns wherever a deprecated name is written', () => {
    const deprecated = { name: 'Int64', replacement: 'Int64BigInt' };

    const warningAt = (line: number, column: number, name = deprecated.name) => ({
      code: 'PSL_DEPRECATED_SCALAR_NAME',
      message: `Scalar type "${name}" is deprecated and will be removed; use "${deprecated.replacement}".`,
      sourceId: 'schema.prisma',
      span: expect.objectContaining({
        start: expect.objectContaining({ line, column }),
        end: expect.objectContaining({ line, column: column + name.length }),
      }),
      severity: 'warning',
    });

    it('in a model field written with parentheses', () => {
      const { result, warnings } = interpret(schemaWith(`${deprecated.name}()`));
      expect(result.ok).toBe(true);
      expect(warnings).toEqual([warningAt(3, 9)]);
    });

    it.each([
      ['bare', deprecated.name],
      ['with parentheses', `${deprecated.name}()`],
    ])('in a value object member written %s', (_, written) => {
      const { result, warnings } = interpret(
        `type Address {\n  number ${written}\n}\n\nmodel Post {\n  id ObjectId @id @map("_id")\n  address Address\n}\n`,
      );
      expect(result.ok).toBe(true);
      expect(warnings).toEqual([warningAt(2, 10)]);
    });

    it.each([
      ['bare', deprecated.name],
      ['with parentheses', `${deprecated.name}()`],
    ])(
      'at the base of a types {} alias written %s, once however many fields use it',
      (_, written) => {
        const { result, warnings } = interpret(
          `types {\n  Count = ${written}\n}\n\nmodel Post {\n  id ObjectId @id @map("_id")\n  a Count\n  b Count?\n}\n`,
        );
        expect(result.ok).toBe(true);
        expect(warnings).toEqual([warningAt(2, 11)]);
      },
    );

    it.each(['Bool', 'Int', 'Float', 'Boolean'])(
      'nowhere for %s, which is not deprecated',
      (current) => {
        const { result, warnings } = interpret(
          `types {\n  Flag = ${current}\n}\n\ntype Address {\n  a ${current}\n  b ${current}()\n}\n\nmodel Post {\n  id ObjectId @id @map("_id")\n  c ${current}\n  d ${current}()\n  e Flag\n  address Address\n}\n`,
        );
        expect(result.ok).toBe(true);
        expect(warnings).toEqual([]);
      },
    );
  });

  it('accepts a deprecated name when no warning sink is supplied', () => {
    const result = interpretMongoContract(schemaWith('Int64'), {
      scalarTypes,
      authoringContributions,
      codecLookup: mongoCodecLookup,
      dataTypes: mongoDataTypeSupport,
      defaultFunctionRegistry: new Map(),
    });
    expect(result.ok).toBe(true);
  });

  it('reports an unresolved type at the type, listing the type choices and then the explicit types no type choice reaches', () => {
    const { result } = interpret(schemaWith('Money'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Field "Post.value" has type "Money", which is not a scalar type, an enum, a composite type or a model. The Mongo scalar types are Int, Float, Boolean, ObjectId, Int64BigInt, Binary and DateTime.',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({
          start: expect.objectContaining({ line: 3, column: 9 }),
          end: expect.objectContaining({ line: 3, column: 14 }),
        }),
      }),
    ]);
  });
});
