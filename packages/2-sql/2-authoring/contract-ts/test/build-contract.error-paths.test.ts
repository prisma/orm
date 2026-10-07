import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, type field, type model, type rel } from '../src/contract-builder';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: { kind: 'fieldPreset', output: { codecId: 'pg/text@1' } },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

type Helpers = {
  readonly field: { text: () => ReturnType<typeof field.column> };
  readonly model: typeof model;
  readonly rel: typeof rel;
};

function build(
  body: (helpers: Helpers) => { models: Record<string, unknown>; enums?: Record<string, unknown> },
) {
  return defineContract(
    {
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
    },
    body as unknown as Parameters<typeof defineContract>[1],
  );
}

describe('relation targets', () => {
  it('rejects a relation to a model the contract does not declare', () => {
    expect(() =>
      build((helpers) => ({
        models: {
          Post: helpers.model('Post', {
            fields: { id: helpers.field.text(), authorId: helpers.field.text() },
            relations: { author: helpers.rel.belongsTo('Author', { from: 'authorId', to: 'id' }) },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        message: expect.stringContaining('references unknown model "Author"'),
      }),
    );
  });

  it('rejects a junction table that is not a declared model', () => {
    expect(() =>
      build((helpers) => ({
        models: {
          Post: helpers.model('Post', { fields: { id: helpers.field.text() } }),
          Tag: helpers.model('Tag', {
            fields: { id: helpers.field.text() },
            relations: {
              posts: helpers.rel.manyToMany('Post', {
                through: 'PostTag',
                from: 'tagId',
                to: 'postId',
              }),
            },
          }),
        },
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        message: 'Relation "Tag.posts" references unknown through model "PostTag"',
      }),
    );
  });

  it('rejects a relation to a model in a namespace that does not carry it', () => {
    expect(() =>
      build((helpers) => ({
        models: {
          Post: helpers.model('Post', {
            fields: { id: helpers.field.text(), authorId: helpers.field.text() },
            relations: {
              author: helpers.rel.belongsTo('other.Author', { from: 'authorId', to: 'id' }),
            },
          }),
        },
      })),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MODEL_UNKNOWN' }));
  });
});
