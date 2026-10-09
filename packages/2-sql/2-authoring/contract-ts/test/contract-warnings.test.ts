import { describe, expect, it, vi } from 'vitest';
import { field, model, rel } from '../src/contract-builder';
import {
  emitTypedCrossModelFallbackWarnings,
  emitTypedNamedTypeFallbackWarnings,
} from '../src/contract-warnings';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');

const embedding1536 = {
  kind: 'codec-instance',
  codecId: 'pg/vector@1',
  typeParams: { length: 1536 },
} as const;

type RuntimeWarningModels = Parameters<typeof emitTypedNamedTypeFallbackWarnings>[0];
type RuntimeWarningCollection = Parameters<typeof emitTypedCrossModelFallbackWarnings>[0];

function widenRuntimeModels<T extends Record<string, object>>(models: T): RuntimeWarningModels {
  // Warning helpers consume the erased runtime builder shape; tests keep narrower
  // model inference and widen only at the helper boundary.
  return models as RuntimeWarningModels;
}

function buildRuntimeWarningCollection(
  collection: Omit<RuntimeWarningCollection, 'models'> & { models: Record<string, object> },
): RuntimeWarningCollection {
  return {
    ...collection,
    models: widenRuntimeModels(collection.models),
  };
}

function buildLazyTargetManyToManyRelation(
  target: () => object,
  options: {
    readonly through: string;
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): ReturnType<typeof rel.manyToMany> {
  return Reflect.apply(rel.manyToMany as (...args: readonly unknown[]) => unknown, rel, [
    target,
    options,
  ]) as ReturnType<typeof rel.manyToMany>;
}

function captureWarnings(run: () => void) {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

  try {
    run();
    return emitWarning.mock.calls.map(([message, options]) => ({
      message: String(message),
      options,
    }));
  } finally {
    emitWarning.mockRestore();
  }
}

describe('contract fallback warnings', () => {
  it('skips warnings when the typed authoring surface is already in use', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      },
    });

    const VectorRecord = model('VectorRecord', {
      fields: {
        embedding: field.namedType(embedding1536),
      },
    });

    const warnings = captureWarnings(() => {
      emitTypedNamedTypeFallbackWarnings(widenRuntimeModels({ VectorRecord }), {
        Embedding1536: embedding1536,
      });
      emitTypedCrossModelFallbackWarnings(
        buildRuntimeWarningCollection({
          storageTypes: { Embedding1536: embedding1536 },
          models: { User, Profile },
          modelSpecs: new Map([
            [
              'Profile',
              {
                modelName: 'Profile',
                tableName: 'profile',
                relations: {
                  user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
                },
                sqlSpec: {
                  foreignKeys: [
                    {
                      kind: 'fk',
                      fields: ['userId'],
                      targetModel: 'User',
                      targetFields: ['id'],
                      targetSource: 'token',
                    },
                  ],
                },
              },
            ],
          ]),
        }),
      );
    });

    expect(warnings).toEqual([]);
  });

  it('emits individual cross-model fallback warnings for string-authored relations', () => {
    const User = model('User', {
      fields: {
        orgId: field.column(int4Column),
        id: field.column(int4Column).id(),
      },
    });

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
        localeId: field.column(int4Column),
      },
    });

    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(int4Column),
        tenantId: field.column(int4Column),
        tagId: field.column(int4Column),
        localeId: field.column(int4Column),
      },
    });

    const Membership = model('Membership', {
      fields: {
        orgId: field.column(int4Column),
        userId: field.column(int4Column),
      },
    });

    const warnings = captureWarnings(() =>
      emitTypedCrossModelFallbackWarnings(
        buildRuntimeWarningCollection({
          storageTypes: {},
          models: { User, Profile, Post, Tag, PostTag, Membership },
          modelSpecs: new Map([
            [
              'Profile',
              {
                modelName: 'Profile',
                tableName: 'profile',
                relations: {
                  user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
                },
                sqlSpec: undefined,
              },
            ],
            [
              'User',
              {
                modelName: 'User',
                tableName: 'user',
                relations: {
                  profile: rel.hasOne('Profile', { by: 'userId' }),
                  posts: rel.hasMany('Post', { by: 'authorId' }),
                },
                sqlSpec: undefined,
              },
            ],
            [
              'Post',
              {
                modelName: 'Post',
                tableName: 'post',
                relations: {
                  tags: buildLazyTargetManyToManyRelation(() => Tag, {
                    through: 'PostTag',
                    from: ['postId', 'tenantId'],
                    to: ['tagId', 'localeId'],
                  }),
                },
                sqlSpec: undefined,
              },
            ],
            [
              'Membership',
              {
                modelName: 'Membership',
                tableName: 'membership',
                relations: {},
                sqlSpec: {
                  foreignKeys: [
                    {
                      kind: 'fk',
                      fields: ['orgId', 'userId'],
                      targetModel: 'User',
                      targetFields: ['orgId', 'id'],
                      targetSource: 'string',
                    },
                  ],
                },
              },
            ],
          ]),
        }),
      ),
    );

    expect(warnings).toHaveLength(5);
    expect(warnings[0]?.options).toEqual(
      expect.objectContaining({
        code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
      }),
    );
    expect(warnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`rel.belongsTo('User', { from: 'userId', to: 'id' })`),
        expect.stringContaining(`rel.hasOne('Profile', { by: 'userId' })`),
        expect.stringContaining(`rel.hasMany('Post', { by: 'authorId' })`),
        expect.stringContaining(
          `rel.manyToMany(() => Tag, { through: 'PostTag', from: ['postId', 'tenantId'], to: ['tagId', 'localeId'] })`,
        ),
        expect.stringContaining(
          `[constraints.ref('User', 'orgId'), constraints.ref('User', 'id')] in .sql(...)`,
        ),
      ]),
    );
  });

  it('formats single-column foreign-key fallback guidance', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Comment = model('Comment', {
      fields: {
        userId: field.column(int4Column),
      },
    });

    const warnings = captureWarnings(() =>
      emitTypedCrossModelFallbackWarnings(
        buildRuntimeWarningCollection({
          storageTypes: {},
          models: { User, Comment },
          modelSpecs: new Map([
            [
              'Comment',
              {
                modelName: 'Comment',
                tableName: 'comment',
                relations: {},
                sqlSpec: {
                  foreignKeys: [
                    {
                      kind: 'fk',
                      fields: ['userId'],
                      targetModel: 'User',
                      targetFields: ['id'],
                      targetSource: 'string',
                    },
                  ],
                },
              },
            ],
          ]),
        }),
      ),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(`constraints.ref('User', 'id')`);
    expect(warnings[0]?.message).toContain('User.refs.id');
  });

  it('renders lazy many-to-many targets in warning suggestions', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(int4Column),
        tagId: field.column(int4Column),
      },
    });

    const warnings = captureWarnings(() =>
      emitTypedCrossModelFallbackWarnings(
        buildRuntimeWarningCollection({
          storageTypes: {},
          models: { Post, Tag, PostTag },
          modelSpecs: new Map([
            [
              'Post',
              {
                modelName: 'Post',
                tableName: 'post',
                relations: {
                  tags: buildLazyTargetManyToManyRelation(() => Tag, {
                    through: 'PostTag',
                    from: 'postId',
                    to: 'tagId',
                  }),
                },
                sqlSpec: undefined,
              },
            ],
          ]),
        }),
      ),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('rel.manyToMany(() => Tag');
    expect(warnings[0]?.message).toContain("through: 'PostTag'");
  });

  it('renders string many-to-many targets in warning suggestions', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(int4Column),
        tagId: field.column(int4Column),
      },
    });

    const warnings = captureWarnings(() =>
      emitTypedCrossModelFallbackWarnings(
        buildRuntimeWarningCollection({
          storageTypes: {},
          models: { Post, Tag, PostTag },
          modelSpecs: new Map([
            [
              'Post',
              {
                modelName: 'Post',
                tableName: 'post',
                relations: {
                  tags: rel.manyToMany('Tag', {
                    through: 'PostTag',
                    from: 'postId',
                    to: 'tagId',
                  }),
                },
                sqlSpec: undefined,
              },
            ],
          ]),
        }),
      ),
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `rel.manyToMany('Tag', { through: 'PostTag', from: 'postId', to: 'tagId' })`,
        ),
        expect.stringContaining("through: 'PostTag'"),
      ]),
    );
  });

  it('batches named-type fallback warnings above the threshold', () => {
    const VectorRecord = model('VectorRecord', {
      fields: {
        first: field.namedType('Embedding1536'),
        second: field.namedType('Embedding1536'),
        third: field.namedType('Embedding1536'),
        fourth: field.namedType('Embedding1536'),
        fifth: field.namedType('Embedding1536'),
        sixth: field.namedType('Embedding1536'),
      },
    });

    const warnings = captureWarnings(() =>
      emitTypedNamedTypeFallbackWarnings(widenRuntimeModels({ VectorRecord }), {
        Embedding1536: embedding1536,
      }),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(
      '6 contract references use string fallbacks where typed alternatives are available.',
    );
    expect(warnings[0]?.message).toContain('VectorRecord.first');
    expect(warnings[0]?.message).toContain('VectorRecord.sixth');
  });
});
