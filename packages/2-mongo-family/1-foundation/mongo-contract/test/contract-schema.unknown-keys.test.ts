import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';

const ns = UNBOUND_NAMESPACE_ID;
const objectId = { kind: 'scalar', codecId: 'mongo/objectId@1' };
const text = { kind: 'scalar', codecId: 'mongo/string@1' };

function contractJson(): Record<string, unknown> {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { items: { namespace: ns, model: 'Item' } },
    domain: {
      namespaces: {
        [ns]: {
          enum: { Level: { codecId: 'mongo/string@1', members: [{ name: 'low', value: 'low' }] } },
          models: {
            Item: {
              fields: {
                _id: { type: objectId, nullable: false },
                level: {
                  type: text,
                  nullable: false,
                  valueSet: {
                    plane: 'domain',
                    namespaceId: ns,
                    entityKind: 'enum',
                    entityName: 'Level',
                  },
                },
                tags: { type: text, nullable: false, many: { elementNullable: false } },
              },
              storage: {
                collection: 'items',
                fields: {
                  _id: { field: '_id' },
                  level: { field: 'level' },
                  tags: { field: 'tags' },
                },
              },
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        [ns]: { id: ns, entries: { collection: { items: {} } } },
      },
    },
  };
}

function withUnknownKeyAt(path: readonly (string | number)[]): Record<string, unknown> {
  const contract = contractJson();
  let place: unknown = contract;
  for (const step of path) {
    place = (place as Record<string | number, unknown>)[step];
  }
  (place as Record<string, unknown>)['unexpected'] = true;
  return contract;
}

function pathText(path: readonly (string | number)[]): string {
  return path
    .map((step, i) => (typeof step === 'number' ? `[${step}]` : i === 0 ? step : `.${step}`))
    .join('');
}

const item = ['domain', 'namespaces', ns, 'models', 'Item'] as const;

describe('a Mongo contract with a key its format does not define', () => {
  it('is accepted without the key', () => {
    expect(MongoContractSchema(contractJson())).not.toBeInstanceOf(type.errors);
  });

  it.each(
    [
      ['domain'],
      ['domain', 'namespaces', ns, 'enum', 'Level', 'members', 0],
      [...item, 'fields', 'level', 'valueSet'],
      [...item, 'fields', 'tags', 'many'],
      ['storage', 'namespaces', ns, 'entries'],
    ].map((path) => ({ place: pathText(path), path })),
  )('is refused at $place, naming the key', ({ path }) => {
    const result = MongoContractSchema(withUnknownKeyAt(path));
    expect(result instanceof type.errors ? result.summary : 'accepted').toContain(
      `${pathText([...path, 'unexpected'])} must be removed`,
    );
  });
});
