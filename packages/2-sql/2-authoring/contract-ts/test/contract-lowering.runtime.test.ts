import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { field, rel } from '../src/contract-builder';
import { ContractModelBuilder, ScalarFieldBuilder } from '../src/contract-dsl';
import { buildContractDefinition } from '../src/contract-lowering';
import { columnDescriptor } from './helpers/column-descriptor';
import { testIndexPack } from './helpers/test-index-pack';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const { model } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: bareFamilyPack,
  target: postgresTargetPack,
  extensions: { testIndexes: testIndexPack },
});

function buildDefinition(
  definition: Omit<
    Parameters<typeof buildContractDefinition>[0],
    'target' | 'family' | 'createNamespace'
  >,
) {
  return buildContractDefinition({
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...definition,
  });
}

describe('contract definition lowering runtime checks', () => {
  it('rejects missing and unknown named storage type references', () => {
    const localVector = {
      kind: 'codec-instance',
      codecId: 'pg/vector@1',
      typeParams: { length: 1536 },
    } as const;

    const Embedded = model('Embedded', {
      fields: {
        id: field.column(int4Column).id(),
        vector: field.namedType(localVector),
      },
    });

    const External = model('External', {
      fields: {
        id: field.column(int4Column).id(),
        vector: field.namedType('Embedding1536'),
      },
    });

    expect(() =>
      buildDefinition({
        models: {
          Embedded,
        },
      }),
    ).toThrow(
      'Field "Embedded.vector" references a storage type instance that is not present in definition.types',
    );

    expect(() =>
      buildDefinition({
        models: {
          External,
        },
      }),
    ).toThrow('Field "External.vector" references unknown storage type "Embedding1536"');

    expect(() =>
      buildDefinition({
        models: {
          External,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.TYPE_UNKNOWN' }));
  });

  it('rejects scalar fields that never resolve to a storage descriptor', () => {
    const Broken = new ContractModelBuilder({
      modelName: 'Broken',
      fields: {
        mystery: new ScalarFieldBuilder({
          kind: 'scalar',
          nullable: false,
        } as never),
      },
      relations: {},
    });

    expect(() =>
      buildDefinition({
        models: {
          Broken,
        },
      }),
    ).toThrow('Field "Broken.mystery" does not resolve to a storage descriptor');
  });

  it('rejects invalid identity shapes before contract lowering continues', () => {
    const DuplicateInlineId = model('DuplicateInlineId', {
      fields: {
        orgId: field.column(int4Column).id(),
        userId: field.column(int4Column).id(),
      },
    });

    const MixedIdentity = model('MixedIdentity', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).attributes(({ fields, constraints }) => ({
      id: constraints.id(fields.id),
    }));

    const EmptyIdentity = model('EmptyIdentity', {
      fields: {
        id: field.column(int4Column),
      },
    }).attributes({
      id: {
        kind: 'id',
        fields: [],
      },
    });

    expect(() =>
      buildDefinition({
        models: {
          DuplicateInlineId,
        },
      }),
    ).toThrow(
      'Model "DuplicateInlineId" marks multiple fields with .id(). Use .attributes(...) for compound identities.',
    );

    expect(() =>
      buildDefinition({
        models: {
          MixedIdentity,
        },
      }),
    ).toThrow(
      'Model "MixedIdentity" defines identity both inline and in .attributes(...). Pick one identity style.',
    );

    expect(() =>
      buildDefinition({
        models: {
          EmptyIdentity,
        },
      }),
    ).toThrow('Model "EmptyIdentity" defines an empty identity. Add at least one field.');

    expect(() =>
      buildDefinition({
        models: {
          EmptyIdentity,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.IDENTITY_INVALID' }));
  });

  it('rejects empty unique constraints', () => {
    const EmptyUnique = model('EmptyUnique', {
      fields: {
        id: field.column(int4Column),
      },
    }).attributes({
      uniques: [
        {
          kind: 'unique',
          fields: [],
        },
      ],
    });

    expect(() =>
      buildDefinition({
        models: {
          EmptyUnique,
        },
      }),
    ).toThrow('Model "EmptyUnique" defines an empty unique constraint. Add at least one field.');

    expect(() =>
      buildDefinition({
        models: {
          EmptyUnique,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.CONSTRAINT_INVALID' }));
  });

  it('uses an id field as the ownership anchor when no explicit identity exists', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
    });

    const User = model('User', {
      fields: {
        id: field.column(int4Column),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'authorId' }),
      },
    });

    const definition = buildDefinition({
      models: {
        User,
        Post,
      },
    });

    expect(definition.models[0]?.relations).toEqual([
      {
        fieldName: 'posts',
        toModel: 'Post',
        toTable: 'Post',
        cardinality: '1:N',
        on: {
          parentTable: 'User',
          parentColumns: ['id'],
          childTable: 'Post',
          childColumns: ['authorId'],
        },
      },
    ]);
  });

  it('rejects non-owning relations when no anchor identity is available', () => {
    const Post = model('Post', {
      fields: {
        tenantId: field.column(int4Column),
      },
    });

    const Tenant = model('Tenant', {
      fields: {
        tenantKey: field.column(int4Column),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'tenantId' }),
      },
    });

    expect(() =>
      buildDefinition({
        models: {
          Tenant,
          Post,
        },
      }),
    ).toThrow(
      'Model "Tenant" needs an explicit id or an "id" field to anchor non-owning relations',
    );
  });

  it('rejects unknown relation targets and through models during lowering', () => {
    const MissingBelongsToTarget = model('MissingBelongsToTarget', {
      fields: {
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
      },
    });

    const MissingOwnershipTarget = model('MissingOwnershipTarget', {
      fields: {
        id: field.column(int4Column).id(),
      },
      relations: {
        profile: rel.hasOne('Profile', { by: 'userId' }),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
      },
      relations: {
        tags: rel.manyToMany('Tag', {
          through: 'PostTag',
          from: 'postId',
          to: 'tagId',
        }),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    expect(() =>
      buildDefinition({
        models: {
          MissingBelongsToTarget,
        },
      }),
    ).toThrow('Relation "MissingBelongsToTarget.user" references unknown model "User"');

    expect(() =>
      buildDefinition({
        models: {
          MissingOwnershipTarget,
        },
      }),
    ).toThrow('Relation "MissingOwnershipTarget.profile" references unknown model "Profile"');

    expect(() =>
      buildDefinition({
        models: {
          Post,
          Tag,
        },
      }),
    ).toThrow('Relation "Post.tags" references unknown through model "PostTag"');

    expect(() =>
      buildDefinition({
        models: {
          MissingBelongsToTarget,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MODEL_UNKNOWN' }));
  });

  it('rejects malformed foreign keys before they become contract nodes', () => {
    const RelationForeignKey = model('RelationForeignKey', {
      fields: {
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo('User', { from: 'userId', to: 'id' }).sql({
          fk: {
            name: 'relation_foreign_key_user_id_fkey',
          },
        }),
      },
    });

    const SqlForeignKey = model('SqlForeignKey', {
      fields: {
        userId: field.column(int4Column),
      },
    }).sql({
      foreignKeys: [
        {
          kind: 'fk',
          fields: ['userId'],
          targetModel: 'User',
          targetFields: ['id'],
        },
      ],
    });

    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const UnknownLocalField = model('UnknownLocalField', {
      fields: {
        userId: field.column(int4Column),
      },
    }).sql({
      foreignKeys: [
        {
          kind: 'fk',
          fields: ['missing'],
          targetModel: 'User',
          targetFields: ['id'],
        },
      ],
    });

    expect(() =>
      buildDefinition({
        models: {
          RelationForeignKey,
        },
      }),
    ).toThrow('Relation "RelationForeignKey.user" references unknown model "User"');

    expect(() =>
      buildDefinition({
        models: {
          SqlForeignKey,
        },
      }),
    ).toThrow('Foreign key on "SqlForeignKey" references unknown model "User"');

    expect(() =>
      buildDefinition({
        models: {
          User,
          UnknownLocalField,
        },
      }),
    ).toThrow('Unknown field "UnknownLocalField.missing" in contract definition');

    expect(() =>
      buildDefinition({
        models: {
          User,
          UnknownLocalField,
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FIELD_UNKNOWN' }));
  });

  it('lowers optional unique, index, and foreign-key metadata when present', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn).unique(),
      },
    });

    const Membership = model('Membership', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
        slug: field.column(textColumn).unique(),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({
          fk: {
            name: 'membership_user_id_fkey',
            onDelete: 'cascade',
            onUpdate: 'restrict',
            constraint: false,
            index: false,
          },
        }),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [
        constraints.index([cols.userId], {
          name: 'membership_user_id_idx',
          type: 'hash',
          options: { fillfactor: 70 },
        }),
      ],
    }));

    const definition = buildDefinition({
      models: {
        User,
        Membership,
      },
    });

    const membership = definition.models.find(
      (currentModel) => currentModel.modelName === 'Membership',
    );
    expect(membership?.uniques).toEqual([{ columns: ['slug'] }]);
    expect(membership?.indexes).toEqual([
      {
        columns: ['userId'],
        name: 'membership_user_id_idx',
        type: 'hash',
        options: { fillfactor: 70 },
      },
    ]);
    expect(membership?.foreignKeys).toEqual([
      {
        columns: ['userId'],
        references: {
          model: 'User',
          table: 'User',
          columns: ['id'],
        },
        name: 'membership_user_id_fkey',
        onDelete: 'cascade',
        onUpdate: 'restrict',
        constraint: false,
        index: false,
      },
    ]);
  });
});
