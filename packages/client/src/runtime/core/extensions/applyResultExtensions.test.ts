import { applyResultExtensions } from './applyResultExtensions'
import { MergedExtensionsList } from './MergedExtensionsList'

test('does not add fields if some dependencies are not met', () => {
  const result = {
    firstName: 'John',
  }

  const fullName = jest.fn()
  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute: fullName,
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(fullName).not.toHaveBeenCalled()
  expect(extended).not.toHaveProperty('fullName')
})

test('adds a field if all dependencies are met', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('fullName', 'John Smith')
})

test('does not add a field if it is not present in select', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    select: { firstName: true, lastName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).not.toHaveProperty('fullName')
})

test('adds a field if it is present in select', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    select: { firstName: true, lastName: true, fullName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('fullName', 'John Smith')
  expect(extended).toHaveProperty('firstName')
  expect(extended).toHaveProperty('lastName')
})

test('masks dependencies if they are not present in select', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    select: { fullName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('fullName', 'John Smith')
  expect(extended).not.toHaveProperty('firstName')
  expect(extended).not.toHaveProperty('lastName')
})

test('counts falsy values as met dependencies', () => {
  const result = {
    firstName: 'John',
    lastName: '',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('fullName', 'John ')
})

test('can add multiple fields', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
        loudName: {
          needs: { firstName: true },
          compute(user) {
            return `${user.firstName.toUpperCase()}!`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('fullName', 'John Smith')
  expect(extended).toHaveProperty('loudName', 'JOHN!')
})

test('allows fields to use other fields', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extA = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extB = {
    result: {
      user: {
        loudFullName: {
          needs: { fullName: true },
          compute(user) {
            return user.fullName.toUpperCase()
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extA).append(extB),
  })
  expect(extended).toHaveProperty('loudFullName', 'JOHN SMITH')
})

test('does not add a field if model does not match', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'post',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).not.toHaveProperty('fullName')
})

test('adds a field if it is specified in $allModels', () => {
  const result = {}

  const extension = {
    result: {
      $allModels: {
        computedField: {
          compute: () => 1,
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('computedField', 1)
})

test('specific model field takes precedence over $allModels', () => {
  const result = {}

  const extension = {
    result: {
      $allModels: {
        computedField: {
          compute: () => 'original',
        },
      },

      user: {
        computedField: {
          needs: {},
          compute: () => 'override',
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('computedField', 'override')
})

test('non-conflicting fields from $allModels and specific model co-exist', () => {
  const result = {}

  const extension = {
    result: {
      $allModels: {
        allModelsField: {
          needs: {},
          compute: () => 'all',
        },
      },

      user: {
        userModelField: {
          needs: {},
          compute: () => 'user',
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('allModelsField', 'all')
  expect(extended).toHaveProperty('userModelField', 'user')
})

test('caches the result', () => {
  const result = {
    firstName: 'John',
  }

  const compute = jest.fn()

  const extension = {
    result: {
      user: {
        computed: {
          needs: { firstName: true },
          compute,
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  extended['computed']
  extended['computed']

  expect(compute).toHaveBeenCalledTimes(1)
})

test('allow to shadow a field', () => {
  const result = {
    firstName: 'John',
  }

  const extension = {
    result: {
      user: {
        firstName: {
          needs: { firstName: true },
          compute(user) {
            return `${user.firstName}!`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('firstName', 'John!')
})

test('allow to shadow a field when select is used', () => {
  const result = {
    firstName: 'John',
  }

  const extension = {
    result: {
      user: {
        firstName: {
          needs: { firstName: true },
          compute(user) {
            return `${user.firstName}!`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
    select: { firstName: true },
  })
  expect(extended).toHaveProperty('firstName', 'John!')
})

test('allow to shadow already shadowed field', () => {
  const result = {
    firstName: 'John',
  }

  const extension1 = {
    result: {
      user: {
        firstName: {
          needs: { firstName: true },
          compute(user) {
            return user.firstName.toUpperCase()
          },
        },
      },
    },
  }

  const extension2 = {
    result: {
      user: {
        firstName: {
          needs: { firstName: true },
          compute(user) {
            return `${user.firstName}!`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension1).append(extension2),
  })
  expect(extended).toHaveProperty('firstName', 'JOHN!')
})

test('allows to omit computed fields', () => {
  const result = {
    firstName: 'John',
    lastName: 'Smith',
  }

  const extension = {
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    omit: { fullName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).not.toHaveProperty('fullName')
})

test('allows to omit dependency of a computed team', () => {
  const result = {
    firstName: 'John',
  }

  const extension = {
    result: {
      user: {
        loudName: {
          needs: { firstName: true },
          compute(user) {
            return user.firstName.toUpperCase()
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    omit: { firstName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).not.toHaveProperty('firstName')
  expect(extended).toHaveProperty('loudName', 'JOHN')
})

test('allows to omit transitive dependency of a computed team', () => {
  const result = {
    firstName: 'John',
  }

  const extension = {
    result: {
      user: {
        loudName: {
          needs: { firstName: true },
          compute(user) {
            return user.firstName.toUpperCase()
          },
        },

        screamingName: {
          needs: { loudName: true },
          compute(user) {
            return `${user.loudName}!!!`
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    omit: { firstName: true },
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).not.toHaveProperty('firstName')
  expect(extended).toHaveProperty('screamingName', 'JOHN!!!')
})

test('model name is available in compute function', () => {
  const result = {}

  const extension = {
    result: {
      $allModels: {
        modelName: {
          compute: (_, modelName) => {
            return modelName
          },
        },
      },
    },
  }

  const extended = applyResultExtensions({
    result,
    modelName: 'user',
    extensions: MergedExtensionsList.single(extension),
  })
  expect(extended).toHaveProperty('modelName', 'user')
})
