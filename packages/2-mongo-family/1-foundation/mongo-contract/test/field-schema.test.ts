import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';

function contractWithField(kind: 'models' | 'valueObjects', field: Record<string, unknown>) {
  const entry =
    kind === 'models' ? { fields: { name: field }, storage: {} } : { fields: { name: field } };
  return {
    targetFamily: 'mongo',
    roots: {},
    domain: {
      namespaces: {
        app: { models: {}, [kind]: { Item: entry } },
      },
    },
    storage: { namespaces: {} },
  };
}

describe.each(['models', 'valueObjects'] as const)('%s field schema', (kind) => {
  const fieldType = { kind: 'scalar', codecId: 'mongo/string@1' };

  it('normalizes an absent many property to false', () => {
    const field = { type: fieldType };
    expect(Object.hasOwn(field, 'many')).toBe(false);
    expect(MongoContractSchema(contractWithField(kind, field))).toEqual(
      contractWithField(kind, { type: fieldType, nullable: false, many: false }),
    );
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
    expect(MongoContractSchema(contractWithField(kind, { type: fieldType, many }))).toBeInstanceOf(
      type.errors,
    );
  });
});
