import {
  type ContractModelBase,
  type ContractRelation,
  crossRef,
  domainModelsAtDefaultNamespace,
} from '@internal/contract/types';
import type { MongoContract } from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializerBase } from '../src/core/ir/mongo-contract-serializer-base';
import { mongoContractJson } from './mongo-contract-json-fixture';

class PassThroughSerializer extends MongoContractSerializerBase<MongoContract> {
  protected constructTargetContract(validated: MongoContract): MongoContract {
    return validated;
  }
}

const objectId = { type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' } };

/** A to-one relation as an rc.9 `contract.json` wrote it: no `nullable` key unless given. */
function toOne(input: {
  readonly to: ReturnType<typeof crossRef> & { space?: string };
  readonly cardinality?: '1:1' | 'N:1';
  readonly on?: { localFields: string[]; targetFields: string[] };
  readonly nullable?: boolean;
}): ContractRelation {
  return blindCast<ContractRelation, 'an rc.9 contract.json relation has no nullable key'>({
    to: input.to,
    cardinality: input.cardinality ?? 'N:1',
    on: input.on ?? { localFields: ['authorId'], targetFields: ['_id'] },
    ...(input.nullable === undefined ? {} : { nullable: input.nullable }),
  });
}
const user = crossRef('User');

function contractJson(input: {
  readonly relation: ContractRelation;
  readonly authorIdField: boolean;
}) {
  const postFields: ContractModelBase['fields'] = {
    _id: { ...objectId, nullable: false },
    authorId: { ...objectId, nullable: input.authorIdField },
  };
  return mongoContractJson({
    roots: { posts: crossRef('Post') },
    models: {
      Post: {
        fields: postFields,
        relations: { author: input.relation },
        storage: { collection: 'posts' },
      },
      User: {
        fields: { _id: { ...objectId, nullable: false }, postId: { ...objectId, nullable: false } },
        relations: {},
        storage: { collection: 'users' },
      },
    },
    storageCollections: { posts: {}, users: {} },
  });
}

function hydratedAuthor(json: unknown) {
  const hydrated = new PassThroughSerializer().deserializeContract(json);
  return domainModelsAtDefaultNamespace(hydrated.domain)['Post']?.relations['author'];
}

describe('to-one relation nullability on deserialization', () => {
  it('derives nullable: true when a local field is nullable', () => {
    const json = contractJson({ relation: toOne({ to: user }), authorIdField: true });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: 'N:1', nullable: true });
  });

  it('derives nullable: false when every local field is required', () => {
    const json = contractJson({ relation: toOne({ to: user }), authorIdField: false });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: 'N:1', nullable: false });
  });

  it('defaults a cross-space to-one relation to nullable: true', () => {
    const json = contractJson({
      relation: toOne({ to: { ...user, space: 'auth' } }),
      authorIdField: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ nullable: true });
  });

  it('derives nullable: true on the 1:1 side whose local field is the document id', () => {
    const json = contractJson({
      relation: toOne({
        to: user,
        cardinality: '1:1',
        on: { localFields: ['_id'], targetFields: ['postId'] },
      }),
      authorIdField: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: '1:1', nullable: true });
  });

  it('keeps a present nullable as written', () => {
    const json = contractJson({
      relation: toOne({ to: user, nullable: false }),
      authorIdField: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ nullable: false });
  });
});
