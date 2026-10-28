import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';

function contractWithField(kind: 'model' | 'storage value object', field: Record<string, unknown>) {
  return kind === 'model'
    ? {
        targetFamily: 'mongo',
        roots: {},
        domain: {
          namespaces: {
            app: {
              models: {
                Item: { fields: { name: field }, storage: { fields: { name: { field: 'name' } } } },
              },
            },
          },
        },
        storage: { namespaces: {} },
      }
    : {
        targetFamily: 'mongo',
        roots: {},
        domain: { namespaces: { app: { models: {} } } },
        storage: {
          namespaces: {
            app: { id: 'app', entries: { valueObject: { Item: { fields: { name: field } } } } },
          },
        },
      };
}

describe.each(['model', 'storage value object'] as const)('%s field schema', (kind) => {
  const fieldType = { kind: 'scalar', codecId: 'mongo/string@1' };

  it('accepts a field with no many property', () => {
    expect(
      MongoContractSchema(contractWithField(kind, { type: fieldType, nullable: false })),
    ).not.toBeInstanceOf(type.errors);
  });

  it.each([false, { elementNullable: false }, { elementNullable: true }])(
    'preserves explicit many %j',
    (many) => {
      const contract = contractWithField(kind, { type: fieldType, nullable: true, many });
      expect(MongoContractSchema(contract)).toEqual(contract);
    },
  );

  it.each([
    null,
    true,
    {},
    { elementNullable: null },
    { elementNullable: 'false' },
    { elementNullable: 0 },
  ])('rejects malformed many %j', (many) => {
    expect(
      MongoContractSchema(contractWithField(kind, { type: fieldType, nullable: false, many })),
    ).toBeInstanceOf(type.errors);
  });
});
