import { field, model, runtimeDataModel } from '../../../testUtils/dataModelBuilder'
import { visitQueryResult } from './visitQueryResult'

const UserModel = model('User', [
  field('scalar', 'name', 'String'),
  field('object', 'group', 'Group', { relationName: 'UserToGroup' }),
  field('object', 'posts', 'Post', { relationName: 'UserToPost', isList: true }),
])

const GroupModel = model('Group', [
  field('object', 'users', 'User', {
    isList: true,
    relationName: 'GroupToUser',
  }),
])

const PostModel = model('Post', [
  field('scalar', 'name', 'String'),
  field('object', 'author', 'User', {
    relationName: 'PostToUser',
  }),
])

const datamodel = runtimeDataModel({
  models: [UserModel, GroupModel, PostModel],
})

test('visits root node', () => {
  const visitor = jest.fn()
  const result = { name: 'Boaty McBoatface' }

  visitQueryResult({
    result,
    args: {},
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'User', {})
  expect(visitor).toHaveBeenCalledTimes(1)
})

test('returns unchanged result if visitor return undefined', () => {
  const result = { name: 'Boaty McBoatface' }

  const visitResult = visitQueryResult({
    result,
    args: {},
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor: jest.fn(),
  })

  expect(visitResult).toBe(result)
})

test('returns new result if visitor returns the value', () => {
  const result = { name: 'Boaty McBoatface' }
  const replaceResult = { name: 'Replacy McReplaceFace' }

  const visitResult = visitQueryResult({
    result,
    args: {},
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor: jest.fn().mockReturnValue(replaceResult),
  })

  expect(visitResult).toBe(replaceResult)
})

test('in case of array, visits each item individually', () => {
  const result = [
    { id: '1', name: 'Firsty McFirstFace' },
    { id: '2', name: 'Secondy McSecondFace' },
  ]

  const visitor = jest.fn()

  visitQueryResult({
    result,
    args: {},
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledTimes(2)
  expect(visitor).toHaveBeenCalledWith(result[0], 'User', {})
  expect(visitor).toHaveBeenCalledWith(result[1], 'User', {})
})

test('allows to modify individual array items', () => {
  const result = [
    { id: '1', name: 'Firsty McFirstFace' },
    { id: '2', name: 'Secondy McSecondFace' },
  ]
  const originalSecond = result[1]
  const replaceResult = { id: 3, name: 'Replacy McReplaceFace' }

  const visitResult = visitQueryResult({
    result,
    args: {},
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor: (item) => {
      if ('id' in item && item['id'] === '1') {
        return replaceResult
      }
      return undefined
    },
  })

  expect(result[0]).toBe(replaceResult)
  expect(result[1]).toBe(originalSecond)
  expect(visitResult).toBe(result)
})

test('visits nested relations when using include', () => {
  const result = {
    id: '1',
    name: 'Boaty McBoatface',
    group: { id: '123' },
  }
  const visitor = jest.fn()

  visitQueryResult({
    result,
    args: {
      include: {
        group: true,
      },
    },
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'User', { include: { group: true } })
  expect(visitor).toHaveBeenCalledWith(result.group, 'Group', {})
})

test('visits nested relations when using select', () => {
  const result = {
    id: '1',
    name: 'Boaty McBoatface',
    group: { id: '123' },
  }
  const visitor = jest.fn()

  visitQueryResult({
    result,
    args: {
      select: {
        group: true,
      },
    },
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'User', { select: { group: true } })
  expect(visitor).toHaveBeenCalledWith(result.group, 'Group', {})
})

test('does not visit nested relations when include = false', () => {
  const result = {
    id: '1',
    name: 'Boaty McBoatface',
    group: { id: '123' },
  }
  const visitor = jest.fn()

  visitQueryResult({
    result,
    args: {
      include: {
        group: false,
      },
    },
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).not.toHaveBeenCalledWith(expect.anything(), GroupModel, expect.anything())
})

test('does not visit nested relations when corresponding field is null', () => {
  const result = {
    id: '1',
    name: 'Boaty McBoatface',
    group: null,
  }
  const visitor = jest.fn()

  visitQueryResult({
    result,
    args: {
      include: {
        group: true,
      },
    },
    modelName: 'User',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).not.toHaveBeenCalledWith(null, GroupModel, expect.anything())
})

test('visits deeply nested relations using include', () => {
  const result = {
    id: '123',
    title: 'Lorem impsum: is it really dolor sit amet?',
    author: {
      id: '1',
      name: 'Boaty McBoatface',
      group: { id: '456' },
    },
  }
  const visitor = jest.fn()
  visitQueryResult({
    result,
    args: {
      include: {
        author: {
          include: {
            group: true,
          },
        },
      },
    },
    modelName: 'Post',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'Post', { include: { author: { include: { group: true } } } })
  expect(visitor).toHaveBeenCalledWith(result.author, 'User', { include: { group: true } })
  expect(visitor).toHaveBeenCalledWith(result.author.group, 'Group', {})
})

test('visits deeply nested relations using select', () => {
  const result = {
    id: '123',
    title: 'Lorem impsum: is it really dolor sit amet?',
    author: {
      id: '1',
      name: 'Boaty McBoatface',
      group: { id: '456' },
    },
  }
  const visitor = jest.fn()
  visitQueryResult({
    result,
    args: {
      select: {
        author: {
          select: {
            group: true,
          },
        },
      },
    },
    modelName: 'Post',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'Post', { select: { author: { select: { group: true } } } })
  expect(visitor).toHaveBeenCalledWith(result.author, 'User', { select: { group: true } })
  expect(visitor).toHaveBeenCalledWith(result.author.group, 'Group', {})
})

test('visits deeply nested relations with mixed include and select', () => {
  const result = {
    id: '123',
    title: 'Lorem impsum: is it really dolor sit amet?',
    author: {
      id: '1',
      name: 'Boaty McBoatface',
      group: { id: '456' },
    },
  }
  const visitor = jest.fn()
  visitQueryResult({
    result,
    args: {
      include: {
        author: {
          select: {
            group: true,
          },
        },
      },
    },
    modelName: 'Post',
    runtimeDataModel: datamodel,
    visitor,
  })

  expect(visitor).toHaveBeenCalledWith(result, 'Post', { include: { author: { select: { group: true } } } })
  expect(visitor).toHaveBeenCalledWith(result.author, 'User', { select: { group: true } })
  expect(visitor).toHaveBeenCalledWith(result.author.group, 'Group', {})
})

test('allows to replace deeply nested relations using include', () => {
  const result = {
    id: '123',
    title: 'Lorem impsum: is it really dolor sit amet?',
    author: {
      id: '1',
      name: 'Boaty McBoatface',
      group: { id: '456' },
    },
  }
  const replacementGroup = { id: 'brand-new-group' }

  const visitResult = visitQueryResult({
    result,
    args: {
      include: {
        author: {
          include: {
            group: true,
          },
        },
      },
    },
    modelName: 'Post',
    runtimeDataModel: datamodel,
    visitor(value, modelName) {
      if (modelName === 'Group') {
        return replacementGroup
      }
      return undefined
    },
  })

  expect(visitResult['author']['group']).toBe(replacementGroup)
  expect(result.author.group).toBe(replacementGroup)
})

test('allows to replace deeply nested relations using select', () => {
  const result = {
    id: '123',
    title: 'Lorem impsum: is it really dolor sit amet?',
    author: {
      id: '1',
      name: 'Boaty McBoatface',
      group: { id: '456' },
    },
  }
  const replacementGroup = { id: 'brand-new-group' }

  const visitResult = visitQueryResult({
    result,
    args: {
      select: {
        author: {
          select: {
            group: true,
          },
        },
      },
    },
    modelName: 'Post',
    runtimeDataModel: datamodel,
    visitor(value, modelName) {
      if (modelName === 'Group') {
        return replacementGroup
      }
      return undefined
    },
  })

  expect(visitResult['author']['group']).toBe(replacementGroup)
  expect(result.author.group).toBe(replacementGroup)
})
