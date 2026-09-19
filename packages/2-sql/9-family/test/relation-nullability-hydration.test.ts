import {
  type ContractRelation,
  crossRef,
  domainModelsAtDefaultNamespace,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer } from './test-sql-contract-serializer';

const int = { nullable: false, type: { kind: 'scalar' as const, codecId: 'pg/int4@1' } };

function column(nullable: boolean) {
  return { nativeType: 'int4', codecId: 'pg/int4@1', nullable };
}

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
    on: input.on ?? { localFields: ['authorId'], targetFields: ['id'] },
    ...(input.nullable === undefined ? {} : { nullable: input.nullable }),
  });
}
const user = crossRef('User', UNBOUND_DOMAIN_NAMESPACE_ID);

function contractJson(input: {
  readonly relation: ContractRelation;
  readonly authorIdColumn: boolean | 'missing';
  readonly postConstraints?: 'primary-key' | 'none' | 'foreign-key-on-author-id';
}) {
  const postColumns =
    input.authorIdColumn === 'missing'
      ? { id: column(false) }
      : { id: column(false), author_id: column(input.authorIdColumn) };
  const postConstraints = input.postConstraints ?? 'primary-key';
  const postPrimaryKey =
    postConstraints === 'primary-key' ? { primaryKey: { columns: ['id'] } } : {};
  const postForeignKeys =
    postConstraints === 'foreign-key-on-author-id'
      ? [
          {
            source: {
              namespaceId: UNBOUND_NAMESPACE_ID,
              tableName: 'post',
              columns: ['author_id'],
            },
            target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
          },
        ]
      : [];
  const contract = createSqlContract({
    roots: { posts: crossRef('Post', UNBOUND_DOMAIN_NAMESPACE_ID) },
    models: {
      Post: {
        fields: { id: int, authorId: int },
        relations: { author: input.relation },
        storage: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          table: 'post',
          fields:
            input.authorIdColumn === 'missing'
              ? { id: { column: 'id' } }
              : { id: { column: 'id' }, authorId: { column: 'author_id' } },
        },
      },
      User: {
        fields: { id: int },
        relations: {},
        storage: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          table: 'user',
          fields: { id: { column: 'id' } },
        },
      },
    },
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              post: {
                columns: postColumns,
                ...postPrimaryKey,
                uniques: [],
                indexes: [],
                foreignKeys: postForeignKeys,
              },
              user: { columns: { id: column(false) }, uniques: [], indexes: [], foreignKeys: [] },
            },
          },
        },
      },
    },
  });
  return JSON.parse(JSON.stringify(contract));
}

function hydratedAuthor(json: unknown) {
  const hydrated = new TestSqlContractSerializer().deserializeContract(json);
  return domainModelsAtDefaultNamespace(hydrated.domain)['Post']?.relations['author'];
}

describe('to-one relation nullability on deserialization', () => {
  it('derives nullable: true when a local FK column is nullable', () => {
    const json = contractJson({
      relation: toOne({ to: user }),
      authorIdColumn: true,
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: 'N:1', nullable: true });
  });

  it('derives nullable: false when every local FK column is NOT NULL', () => {
    const json = contractJson({
      relation: toOne({ to: user }),
      authorIdColumn: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: 'N:1', nullable: false });
  });

  it('derives nullable: true when the local column cannot be resolved', () => {
    const json = contractJson({
      relation: toOne({ to: user }),
      authorIdColumn: 'missing',
    });
    expect(hydratedAuthor(json)).toMatchObject({ nullable: true });
  });

  it('defaults a cross-space to-one relation to nullable: true', () => {
    const json = contractJson({
      relation: toOne({ to: { ...user, space: 'auth' } }),
      authorIdColumn: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ nullable: true });
  });

  it('derives nullable: true on the 1:1 side whose local columns are its primary key', () => {
    const json = contractJson({
      relation: toOne({
        to: user,
        cardinality: '1:1',
        on: { localFields: ['id'], targetFields: ['postId'] },
      }),
      authorIdColumn: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: '1:1', nullable: true });
  });

  it('derives nullable: true on a 1:1 side with no primary key and no foreign key', () => {
    const json = contractJson({
      relation: toOne({
        to: user,
        cardinality: '1:1',
        on: { localFields: ['id'], targetFields: ['postId'] },
      }),
      authorIdColumn: false,
      postConstraints: 'none',
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: '1:1', nullable: true });
  });

  it('derives nullable from the columns on a 1:1 side whose foreign key covers its local columns', () => {
    const json = contractJson({
      relation: toOne({ to: user, cardinality: '1:1' }),
      authorIdColumn: false,
      postConstraints: 'foreign-key-on-author-id',
    });
    expect(hydratedAuthor(json)).toMatchObject({ cardinality: '1:1', nullable: false });
  });

  it('keeps a present nullable as written', () => {
    const json = contractJson({
      relation: toOne({ to: user, nullable: false }),
      authorIdColumn: false,
    });
    expect(hydratedAuthor(json)).toMatchObject({ nullable: false });
  });
});
