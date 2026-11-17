import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function interpret(schema: string) {
  const warnings: ContractSourceDiagnostic[] = [];
  const context = contractSourceContextFromControlStack(stack, {
    reportWarning: (diagnostic: ContractSourceDiagnostic) => {
      warnings.push(diagnostic);
    },
  });
  const bound = bindPslSchema(schema, { sourceId: 'schema.prisma', context });
  const result = withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
    }),
    bound.seedDiagnostics,
  );
  return { result, warnings };
}

function emit(schema: string) {
  const { result, warnings } = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const json = JSON.stringify(
    mongoTargetDescriptor.contractSerializer.serializeContract(
      result.value as Parameters<
        typeof mongoTargetDescriptor.contractSerializer.serializeContract
      >[0],
    ),
  );
  return { contract: result.value, json, warnings };
}

const rows = [
  ['Int', 'Int32', 'mongo/int32@1'],
  ['Int(storage: int)', 'Int32', 'mongo/int32@1'],
  ['BigInt', 'Int64BigInt', 'mongo/int64@1'],
  ['BigInt(as: bigint, storage: long)', 'Int64BigInt', 'mongo/int64@1'],
  ['BigInt(as: number)', 'Int64Number', 'mongo/int64Number@1'],
  ['Float', 'Double', 'mongo/double@1'],
  ['Decimal', 'Decimal128', 'mongo/decimal128@1'],
  ['Boolean', 'Bool', 'mongo/bool@1'],
  ['Bytes', 'Binary', 'mongo/binary@1'],
  ['String', 'BsonString', 'mongo/string@1'],
  ['Json', 'PlainJson', 'mongo/json@1'],
  ['Json(storage: bson)', 'PlainJson', 'mongo/json@1'],
] as const;

const model = (...fields: readonly string[]) =>
  ['model Doc {', '  id ObjectId @id @map("_id")', ...fields.map((f) => `  ${f}`), '}', ''].join(
    '\n',
  );

const fieldsOf = (contract: ReturnType<typeof emit>['contract']) =>
  contract.domain.namespaces['__unbound__']?.models['Doc']?.fields;

describe('the MongoDB scalar convenience types in PSL', () => {
  it.each(rows)('%s resolves to %s, codec %s', (written, explicit, codecId) => {
    const convenience = emit(model(`value ${written}`));
    const direct = emit(model(`value ${explicit}`));

    expect(fieldsOf(convenience.contract)?.['value']?.type).toEqual({ kind: 'scalar', codecId });
    expect(convenience.json).toBe(direct.json);
    expect({ convenience: convenience.warnings, direct: direct.warnings }).toEqual({
      convenience: [],
      direct: [],
    });
  });

  it('emits the same contract.json for a schema written with the convenience types and one written with the explicit types, in every place a type is written', () => {
    const schema = (names: Readonly<Record<string, string>>) => `types {
  Count = ${names['Int']}
  Label = ${names['String']}
}

type Address {
  number ${names['Int']}
  note   ${names['String']}?
}

model Doc {
  id      ObjectId @id @map("_id")
  visits  ${names['Int']}
  total   ${names['BigInt']}
  rank    ${names['BigIntNumber']}?
  ratio   ${names['Float']}
  price   ${names['Decimal']}
  active  ${names['Boolean']}
  avatar  ${names['Bytes']}?
  name    ${names['String']} @unique
  tags    ${names['String']}[]
  payload ${names['Json']}?
  count   Count
  label   Label?
  address Address

  @@index([visits, name])
}

model Tag {
  id    ${names['String']} @id @map("_id")
  label ${names['String']}
}

model Task {
  id   ObjectId @id @map("_id")
  kind ${names['String']}
  @@discriminator(kind)
}

model Bug {
  id       ObjectId @id @map("_id")
  severity ${names['Int']}
  @@base(Task, "bug")
}
`;
    const convenience = emit(
      schema({
        Int: 'Int',
        BigInt: 'BigInt',
        BigIntNumber: 'BigInt(as: number)',
        Float: 'Float',
        Decimal: 'Decimal',
        Boolean: 'Boolean',
        Bytes: 'Bytes',
        String: 'String',
        Json: 'Json',
      }),
    );
    const explicit = emit(
      schema({
        Int: 'Int32',
        BigInt: 'Int64BigInt',
        BigIntNumber: 'Int64Number',
        Float: 'Double',
        Decimal: 'Decimal128',
        Boolean: 'Bool',
        Bytes: 'Binary',
        String: 'BsonString',
        Json: 'PlainJson',
      }),
    );

    expect(convenience.json).toBe(explicit.json);
    expect({ convenience: convenience.warnings, explicit: explicit.warnings }).toEqual({
      convenience: [],
      explicit: [],
    });
  });

  it.each([
    [
      'Int(storage: long)',
      'Field "Doc.value" type "Int": Argument "storage" of Int is long; write one of: int.',
    ],
    [
      'BigInt(as: string)',
      'Field "Doc.value" type "BigInt": Argument "as" of BigInt is string; write one of: bigint, number.',
    ],
    [
      'Json(storage: string)',
      'Field "Doc.value" type "Json": Argument "storage" of Json is string; write one of: bson.',
    ],
  ])('refuses %s at its argument', (written, message) => {
    const { result } = interpret(model(`value ${written}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.failure.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    ).toEqual([{ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT', message }]);
  });

  it.each(['Int', 'Float', 'Boolean'])(
    'gives no warning for %s, bare, with parentheses, in a value object member or as an alias base',
    (name) => {
      const { warnings } = emit(
        `types {\n  A = ${name}\n  B = ${name}()\n}\n\ntype Inner {\n  a ${name}\n  b ${name}()\n}\n\n${model(`c ${name}`, `d ${name}()`, 'e A', 'f B', 'inner Inner')}`,
      );
      expect(warnings).toEqual([]);
    },
  );

  it('warns about Int64 in each place it is written, naming Int64BigInt, and emits the contract Int64BigInt emits', () => {
    const schema = (name: string) =>
      `types {\n  A = ${name}\n}\n\ntype Inner {\n  a ${name}\n}\n\n${model(`b ${name}`, `c ${name}()`, 'd A', 'inner Inner')}`;
    const deprecated = emit(schema('Int64'));
    const current = emit(schema('Int64BigInt'));

    expect(deprecated.json).toBe(current.json);
    expect(current.warnings).toEqual([]);
    expect(
      deprecated.warnings
        .map((warning) => [warning.code, warning.message, warning.span?.start.line])
        .sort((a, b) => Number(a[2]) - Number(b[2])),
    ).toEqual(
      [2, 6, 11, 12].map((line) => [
        'PSL_DEPRECATED_SCALAR_NAME',
        'Scalar type "Int64" is deprecated and will be removed; use "Int64BigInt".',
        line,
      ]),
    );
  });
});

describe('the MongoDB scalar convenience types in a TypeScript contract', () => {
  it('emit the contract their explicit types emit', () => {
    const convenience = defineContract({}, ({ type, field, model: m }) => ({
      models: {
        Doc: m('Doc', {
          fields: {
            _id: field.scalar(type.ObjectId()),
            visits: field.scalar(type.Int()),
            visitsStored: field.scalar(type.Int({ storage: 'int' })),
            total: field.scalar(type.BigInt()),
            rank: field.scalar(type.BigInt({ as: 'number' })),
            ratio: field.scalar(type.Float()),
            price: field.scalar(type.Decimal()),
            active: field.scalar(type.Boolean()),
            avatar: field.scalar(type.Bytes()),
            name: field.scalar(type.String()),
            payload: field.scalar(type.Json()),
            stored: field.scalar(type.Json({ storage: 'bson' })),
          },
        }),
      },
    }));
    const explicit = defineContract({}, ({ type, field, model: m }) => ({
      models: {
        Doc: m('Doc', {
          fields: {
            _id: field.scalar(type.ObjectId()),
            visits: field.scalar(type.Int32()),
            visitsStored: field.scalar(type.Int32()),
            total: field.scalar(type.Int64BigInt()),
            rank: field.scalar(type.Int64Number()),
            ratio: field.scalar(type.Double()),
            price: field.scalar(type.Decimal128()),
            active: field.scalar(type.Bool()),
            avatar: field.scalar(type.Binary()),
            name: field.scalar(type.BsonString()),
            payload: field.scalar(type.PlainJson()),
            stored: field.scalar(type.PlainJson()),
          },
        }),
      },
    }));

    expect(JSON.stringify(convenience)).toBe(JSON.stringify(explicit));
  });

  it.each([
    ['Int', { storage: 'long' }, 'Argument "storage" of Int is long; write one of: int.'],
    [
      'BigInt',
      { as: 'string' },
      'Argument "as" of BigInt is string; write one of: bigint, number.',
    ],
    ['Json', { storage: 'string' }, 'Argument "storage" of Json is string; write one of: bson.'],
  ])('refuses %s(%o) at its argument', (name, written, message) => {
    expect(() =>
      defineContract({}, ({ type }) => {
        const helper = (type as unknown as Record<string, (args: unknown) => unknown>)[name];
        helper?.(written);
        return { models: {} };
      }),
    ).toThrow(message);
  });

  it('has no Int64 helper, and a read of one names Int64BigInt', () => {
    defineContract({}, ({ type }) => {
      expect('Int64' in type).toBe(false);
      expect(() => Reflect.get(type, 'Int64')).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
          message:
            'type.Int64() was removed. Int64 is a deprecated PSL name, which has no TypeScript helper. Write type.Int64BigInt().',
        }),
      );
      return { models: {} };
    });
  });
});
