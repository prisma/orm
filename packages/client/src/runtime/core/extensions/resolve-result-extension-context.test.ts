import { field, model, runtimeDataModel } from '../../../testUtils/dataModelBuilder'
import { applyAllResultExtensions } from './applyAllResultExtensions'
import { MergedExtensionsList } from './MergedExtensionsList'
import { resolveResultExtensionContext } from './resolve-result-extension-context'

const UserModel = model('User', [field('object', 'posts', 'Post', { relationName: 'UserToPost', isList: true })])

const PostModel = model('Post', [field('object', 'author', 'User', { relationName: 'PostToUser' })])

const datamodel = runtimeDataModel({
  models: [UserModel, PostModel],
})

const KeywordRelationSourceModel = model('KeywordRelationSource', [
  field('object', 'select', 'KeywordSelectTarget', {
    relationName: 'KeywordRelationSourceToKeywordSelectTarget',
    isList: true,
  }),
  field('object', 'include', 'KeywordIncludeTarget', {
    relationName: 'KeywordRelationSourceToKeywordIncludeTarget',
    isList: true,
  }),
])

const KeywordSelectTargetModel = model('KeywordSelectTarget', [])

const KeywordIncludeTargetModel = model('KeywordIncludeTarget', [])

const keywordRelationsDatamodel = runtimeDataModel({
  models: [KeywordRelationSourceModel, KeywordSelectTargetModel, KeywordIncludeTargetModel],
})

test('returns root context if dataPath is empty', () => {
  const context = resolveResultExtensionContext({
    dataPath: [],
    modelName: 'User',
    args: { where: { id: '1' } },
    runtimeDataModel: datamodel,
  })

  expect(context).toEqual({
    modelName: 'User',
    args: { where: { id: '1' } },
  })
})

test('resolves model and args for fluent one-hop select path', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['select', 'posts'],
    modelName: 'User',
    args: {
      select: {
        posts: {
          select: {
            id: true,
          },
        },
      },
    },
    runtimeDataModel: datamodel,
  })

  expect(context).toEqual({
    modelName: 'Post',
    args: {
      select: {
        id: true,
      },
    },
  })
})

test('resolves model and args for fluent one-hop include path', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['include', 'posts'],
    modelName: 'User',
    args: {
      include: {
        posts: {
          where: { id: 'post-id' },
        },
      },
    },
    runtimeDataModel: datamodel,
  })

  expect(context).toEqual({
    modelName: 'Post',
    args: {
      where: { id: 'post-id' },
    },
  })
})

test('resolves model and args for multi-hop fluent path', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['select', 'posts', 'select', 'author'],
    modelName: 'User',
    args: {
      select: {
        posts: {
          select: {
            author: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    },
    runtimeDataModel: datamodel,
  })

  expect(context).toEqual({
    modelName: 'User',
    args: {
      select: {
        id: true,
      },
    },
  })
})

test('throws a runtime error when a relation field from dataPath is missing', () => {
  expect(() =>
    resolveResultExtensionContext({
      dataPath: ['select', 'email'],
      modelName: 'User',
      args: {
        select: {
          email: true,
        },
      },
      runtimeDataModel: datamodel,
    }),
  ).toThrow('Could not resolve relation field "email" on model "User" from dataPath "select.email"')
})

test('defaults nested args to empty object when selection is true', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['select', 'posts'],
    modelName: 'User',
    args: {
      select: {
        posts: true,
      },
    },
    runtimeDataModel: datamodel,
  })

  expect(context).toEqual({
    modelName: 'Post',
    args: {},
  })
})

test('resolved context applies result extensions to fluent-style unwrapped results', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['select', 'posts'],
    modelName: 'User',
    args: {
      select: {
        posts: true,
      },
    },
    runtimeDataModel: datamodel,
  })

  const extensions = MergedExtensionsList.single({
    result: {
      post: {
        postLabel: {
          needs: { id: true },
          compute(post) {
            return `post-${post.id}`
          },
        },
      },
    },
  })

  const result = applyAllResultExtensions({
    result: [{ id: 'post-id' }] as Array<{ id: string; postLabel?: string }>,
    modelName: context.modelName,
    args: context.args,
    extensions,
    runtimeDataModel: datamodel,
  })

  expect(result?.[0]?.postLabel).toBe('post-post-id')
})

test('resolved context applies result extensions when relation field is named "select"', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['select', 'select'],
    modelName: 'KeywordRelationSource',
    args: {
      select: {
        select: true,
      },
    },
    runtimeDataModel: keywordRelationsDatamodel,
  })

  const extensions = MergedExtensionsList.single({
    result: {
      keywordSelectTarget: {
        selectLabel: {
          needs: { id: true },
          compute(model) {
            return `select-${model.id}`
          },
        },
      },
    },
  })

  const result = applyAllResultExtensions({
    result: [{ id: 'keyword-id' }] as Array<{ id: string; selectLabel?: string }>,
    modelName: context.modelName,
    args: context.args,
    extensions,
    runtimeDataModel: keywordRelationsDatamodel,
  })

  expect(result?.[0]?.selectLabel).toBe('select-keyword-id')
})

test('resolved context applies result extensions when relation field is named "include"', () => {
  const context = resolveResultExtensionContext({
    dataPath: ['include', 'include'],
    modelName: 'KeywordRelationSource',
    args: {
      include: {
        include: true,
      },
    },
    runtimeDataModel: keywordRelationsDatamodel,
  })

  const extensions = MergedExtensionsList.single({
    result: {
      keywordIncludeTarget: {
        includeLabel: {
          needs: { id: true },
          compute(model) {
            return `include-${model.id}`
          },
        },
      },
    },
  })

  const result = applyAllResultExtensions({
    result: [{ id: 'keyword-id' }] as Array<{ id: string; includeLabel?: string }>,
    modelName: context.modelName,
    args: context.args,
    extensions,
    runtimeDataModel: keywordRelationsDatamodel,
  })

  expect(result?.[0]?.includeLabel).toBe('include-keyword-id')
})
