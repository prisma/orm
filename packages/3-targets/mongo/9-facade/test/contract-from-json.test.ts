import { validateContractOnce } from '@internal/contract/validate-once';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import fixtureContractJson from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract.json' with {
  type: 'json',
};
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  valueObject,
} from '../src/exports/contract-builder';
import mongo from '../src/exports/runtime';
import mongoStatic, { contractFromJson } from '../src/exports/static';

function freshContractJson(): unknown {
  return structuredClone(fixtureContractJson);
}

function authoredContract() {
  const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('User', 'user'));
  return defineContract({
    enums: { Role },
    models: {
      Account: model('Account', {
        collection: 'accounts',
        fields: { _id: field.objectId(), role: field.namedType(Role) },
      }),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('contractFromJson', () => {
  it('returns the contract the Mongo serializer hydrates', () => {
    const json = freshContractJson();

    expect(contractFromJson<Contract>(json)).toEqual(
      new MongoContractSerializer().deserializeContract(json),
    );
  });

  it('throws the structured validation error for invalid JSON', () => {
    expect(() => contractFromJson({ target: 'mongo' })).toThrow(
      expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' }),
    );
  });
});

describe('the query builder of a static context', () => {
  it('is never built for a malformed contract, because mongoStatic validates it first', () => {
    expect(() => mongoStatic({ contract: { target: 'mongo' } as unknown as Contract })).toThrow(
      expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' }),
    );
  });

  it('rejects a malformed contract with the same code and message as mongo()', () => {
    const malformed = { target: 'mongo' } as unknown as Contract;
    const validationFailure = expect.objectContaining({
      code: 'CONTRACT.VALIDATION_FAILED',
      message: [
        'Contract structural validation failed: domain must be an object (was missing)',
        'roots must be an object (was missing)',
        'storage must be an object (was missing)',
        'targetFamily must be "mongo" (was missing)',
      ].join('\n'),
    });

    expect(() => mongo({ contract: malformed })).toThrow(validationFailure);
    expect(() => mongoStatic({ contract: malformed })).toThrow(validationFailure);
  });

  it('builds queries over the contract of its context', () => {
    const { query, contract } = mongoStatic({ contract: authoredContract() });
    const root = Object.keys(contract.roots)[0] as keyof typeof contract.roots & string;

    expect(query.from(root).build()).toMatchObject({
      collection: 'accounts',
      meta: { storageHash: contract.storage.storageHash, lane: 'mongo-query' },
    });
  });
});

describe('validating a contract once', () => {
  it('validates a contractFromJson value once for every client built from it', () => {
    const deserialize = vi.spyOn(MongoContractSerializer.prototype, 'deserializeContract');
    const contract = contractFromJson<Contract>(freshContractJson());

    const clients = [mongo({ contract }), mongo({ contract }), mongoStatic({ contract })];

    expect(deserialize).toHaveBeenCalledTimes(1);
    for (const client of clients) {
      expect(client.contract).toBe(contract);
    }
  });

  it('validates again a contract that another validator of the same target recorded', () => {
    const recordedByAnother = validateContractOnce(freshContractJson(), 'mongo', (input) =>
      new MongoContractSerializer().deserializeContract<Contract>(input),
    );
    const deserialize = vi.spyOn(MongoContractSerializer.prototype, 'deserializeContract');

    mongo({ contract: recordedByAnother });

    expect(deserialize).toHaveBeenCalledTimes(1);
  });

  it('validates a TypeScript-authored contract once, and the contract a client holds not again', () => {
    const deserialize = vi.spyOn(MongoContractSerializer.prototype, 'deserializeContract');
    const authored = authoredContract();

    const first = mongo({ contract: authored });
    const second = mongo({ contract: authored });
    const fromFirst = mongoStatic({ contract: first.contract });

    expect(deserialize).toHaveBeenCalledTimes(1);
    expect(second.contract).toBe(first.contract);
    expect(fromFirst.contract).toBe(first.contract);
  });

  it('takes a TypeScript-authored contract with a value object', () => {
    const Address = valueObject('Address', {
      fields: { street: field.string(), zip: field.string().optional() },
    });
    const authored = defineContract({
      valueObjects: { Address },
      models: {
        Shop: model('Shop', {
          collection: 'shops',
          fields: { _id: field.objectId(), address: field.valueObject(Address) },
        }),
      },
    });

    const { contract } = mongo({ contract: authored });

    expect(
      JSON.parse(
        JSON.stringify(
          Object.values(contract.storage.namespaces).map(
            (namespace) => namespace.entries['valueObject'],
          ),
        ),
      ),
    ).toContainEqual({
      Address: {
        fields: {
          street: {
            nullable: false,
            many: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
          },
          zip: { nullable: true, many: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
    });
  });
});
