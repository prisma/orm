import { field, model, runtimeDataModel } from '../../../testUtils/dataModelBuilder'
import { applyAllResultExtensions } from './applyAllResultExtensions'
import { MergedExtensionsList } from './MergedExtensionsList'

const datamodel = runtimeDataModel({
  models: [
    model('User', [
      field('scalar', 'name', 'String'),
      field('object', 'group', 'Group', { relationName: 'UserToGroup' }),
    ]),
    model('Group', [field('scalar', 'name', 'String')]),
  ],
})

const queryExtension = {
  query: {
    $allModels: {
      $allOperations({ args, query }) {
        return query(args)
      },
    },
  },
}

function userWithCountedGroup() {
  const reads = { group: 0 }
  const user = {
    name: 'Ada',
    get group() {
      reads.group++
      return { name: 'Admins' }
    },
    set group(_value: unknown) {},
  }
  return { user, reads }
}

test('does not walk the result when no extension has a result component', () => {
  const { user, reads } = userWithCountedGroup()

  const result = applyAllResultExtensions({
    result: user,
    modelName: 'User',
    args: { include: { group: true } },
    extensions: MergedExtensionsList.single(queryExtension).append({ client: { $hello: () => 'hi' } }),
    runtimeDataModel: datamodel,
  })

  expect(result).toBe(user)
  expect(reads.group).toBe(0)
})

test('applies a result extension of a nested model when only that model has one', () => {
  const extensions = MergedExtensionsList.single({
    result: {
      group: {
        shout: {
          needs: { name: true },
          compute: (group: { name: string }) => group.name.toUpperCase(),
        },
      },
    },
  }).append(queryExtension)

  const result = applyAllResultExtensions({
    result: { name: 'Ada', group: { name: 'Admins' } },
    modelName: 'User',
    args: { include: { group: true } },
    extensions,
    runtimeDataModel: datamodel,
  }) as { group: { shout: string } }

  expect(result.group.shout).toBe('ADMINS')
})

describe('MergedExtensionsList.hasResultExtension', () => {
  test('is false for an empty list', () => {
    expect(MergedExtensionsList.empty().hasResultExtension()).toBe(false)
  })

  test('is false when no extension in the chain has a result component', () => {
    expect(MergedExtensionsList.single(queryExtension).append(queryExtension).hasResultExtension()).toBe(false)
  })

  test('is true when any extension in the chain has a result component', () => {
    const result = { result: { user: { x: { needs: {}, compute: () => 1 } } } }

    expect(MergedExtensionsList.single(result).append(queryExtension).hasResultExtension()).toBe(true)
    expect(MergedExtensionsList.single(queryExtension).append(result).hasResultExtension()).toBe(true)
  })
})
