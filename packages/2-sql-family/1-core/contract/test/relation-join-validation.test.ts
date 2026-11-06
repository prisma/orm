import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { type ContractModel, type ContractRelation, crossRef } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, model, pk, table } from '../src/factories';
import type { SqlModelFieldStorage, SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

const storage = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      kind: 'test-sql-namespace',
      entries: {
        table: {
          user: table({ id: col('pg/int4', 'pg/int4@1') }, { pk: pk('id') }),
          post: table(
            { id: col('pg/int4', 'pg/int4@1'), user_id: col('pg/int4', 'pg/int4@1') },
            { pk: pk('id') },
          ),
          user_tag: table(
            { user_id: col('pg/int4', 'pg/int4@1'), tag_id: col('pg/int4', 'pg/int4@1') },
            { pk: pk('user_id', 'tag_id') },
          ),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }, { pk: pk('id') }),
        },
      },
    },
  },
};

function modelOf(
  tableName: string,
  fields: Record<string, SqlModelFieldStorage>,
  relations: Record<string, ContractRelation> = {},
): ContractModel {
  return blindCast<ContractModel, 'model() widens relations to unknown'>(
    model(tableName, fields, relations),
  );
}

function contractWith(posts: ContractRelation) {
  return createContract<SqlStorage>({
    storage,
    models: {
      User: modelOf('user', { id: { column: 'id' } }, { posts }),
      Post: modelOf('post', { id: { column: 'id' }, userId: { column: 'user_id' } }),
    },
  });
}

function postsOn(
  localFields: readonly string[],
  targetFields: readonly string[],
): ContractRelation {
  return {
    to: crossRef('Post', UNBOUND_NAMESPACE_ID),
    cardinality: '1:N',
    on: { localFields, targetFields },
  };
}

describe('a relation join field', () => {
  it('validates when both sides name fields', () => {
    expect(() => validateSqlContractFully(contractWith(postsOn(['id'], ['userId'])))).not.toThrow();
  });

  it('is refused on the target side when it names a column, not a field', () => {
    expect(() => validateSqlContractFully(contractWith(postsOn(['id'], ['user_id'])))).toThrow(
      new ContractValidationError(
        'Relation "posts" on model "__unbound__:User" joins on "user_id", which is not a field of model "__unbound__:Post"',
        'domain',
      ),
    );
  });

  it('is refused on the local side when it names no field', () => {
    expect(() => validateSqlContractFully(contractWith(postsOn(['uid'], ['userId'])))).toThrow(
      new ContractValidationError(
        'Relation "posts" on model "__unbound__:User" joins on "uid", which is not a field of model "__unbound__:User"',
        'domain',
      ),
    );
  });

  it('may name junction columns on the target side of a many-to-many relation', () => {
    expect(() => validateSqlContractFully(contractWithTags(['user_id']))).not.toThrow();
  });

  it('is refused on the target side of a many-to-many relation when it names no junction column', () => {
    expect(() => validateSqlContractFully(contractWithTags(['userId']))).toThrow(
      new ContractValidationError(
        'Relation "tags" on model "__unbound__:User" joins on "userId", which is not a column of junction table "__unbound__.user_tag"',
        'domain',
      ),
    );
  });
});

function contractWithTags(targetFields: readonly string[]) {
  return createContract<SqlStorage>({
    storage,
    models: {
      User: modelOf(
        'user',
        { id: { column: 'id' } },
        {
          tags: {
            to: crossRef('Tag', UNBOUND_NAMESPACE_ID),
            cardinality: 'N:M',
            on: { localFields: ['id'], targetFields },
            through: {
              table: 'user_tag',
              namespaceId: UNBOUND_NAMESPACE_ID,
              parentColumns: ['user_id'],
              childColumns: ['tag_id'],
              targetColumns: ['id'],
            },
          },
        },
      ),
      Tag: modelOf('tag', { id: { column: 'id' } }),
      UserTag: modelOf('user_tag', {
        userId: { column: 'user_id' },
        tagId: { column: 'tag_id' },
      }),
    },
  });
}
