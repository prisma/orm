import { computeEngineSideOmissions, computeEngineSideSelection, getComputedFields } from './resultUtils'

describe('getAllComputedFields', () => {
  test('returns all dependencies of an extension', () => {
    const result = getComputedFields(
      undefined,
      {
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: expect.any(Function) },
    })
  })

  test('filter out the fields with needs=false', () => {
    const result = getComputedFields(
      undefined,
      {
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: false },
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({ fullName: { name: 'fullName', needs: ['firstName'], compute: expect.any(Function) } })
  })

  test('filter out the extensions without matching model', () => {
    const result = getComputedFields(
      {},
      {
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute: jest.fn(),
            },
          },
        },
      },
      'Post',
    )

    expect(result).toEqual({})
  })

  test('$allModels matches every model', () => {
    const result = getComputedFields(
      undefined,
      {
        result: {
          $allModels: {
            fullName: {
              compute: jest.fn(),
            },
          },
        },
      },
      'Post',
    )

    expect(result).toEqual({ fullName: { name: 'fullName', needs: [], compute: expect.any(Function) } })
  })

  test('specific extension takes precedence over $allModels', () => {
    const result = getComputedFields(
      undefined,
      {
        result: {
          $allModels: {
            fullName: { needs: { firstName: true, lastName: true }, compute: jest.fn() },
          },

          user: {
            fullName: {
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({
      fullName: { name: 'fullName', needs: [], compute: expect.any(Function) },
    })
  })

  test('in case of previous field exists, new one wins', () => {
    const result = getComputedFields(
      {
        fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
      },

      {
        result: {
          user: {
            fullName: {
              needs: { middleName: true, patronymic: true },
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({
      fullName: { name: 'fullName', needs: ['middleName', 'patronymic'], compute: expect.any(Function) },
    })
  })

  test('resolves dependencies between computed fields', () => {
    const result = getComputedFields(
      {
        fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
      },

      {
        result: {
          user: {
            nameAndAge: {
              needs: { fullName: true, age: true },
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: expect.any(Function) },
      nameAndAge: { name: 'nameAndAge', needs: ['firstName', 'lastName', 'age'], compute: expect.any(Function) },
    })
  })

  test('composes computed fields from two extensions targeting the same field and forwards the active model name to both computes', () => {
    const previousCompute = jest.fn((model: any, modelName: string) => {
      expect(modelName).toBe('User')
      return `${model.firstName} ${model.lastName}`
    })
    const nextCompute = jest.fn((model: any, modelName: string) => {
      expect(modelName).toBe('User')
      return model.fullName.toUpperCase()
    })

    const result = getComputedFields(
      {
        fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: previousCompute },
      },
      {
        result: {
          user: {
            fullName: {
              compute: nextCompute,
            },
          },
        },
      },
      'User',
    )

    const model = { firstName: 'John', lastName: 'Smith' }

    expect(result?.fullName.compute(model, 'User')).toBe('JOHN SMITH')
  })

  test('allows to shadow normal field with a computed fields', () => {
    const result = getComputedFields(
      {},

      {
        result: {
          user: {
            firstName: {
              needs: { firstName: true },
              compute: jest.fn(),
            },
          },
        },
      },
      'User',
    )

    expect(result).toEqual({
      firstName: { name: 'firstName', needs: ['firstName'], compute: expect.any(Function) },
    })
  })
})

describe('computeEngineSideSelection', () => {
  test('adds all dependencies to the selection', () => {
    const fields = {
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
    }
    const selection = { fullName: true, age: true }

    expect(computeEngineSideSelection(selection, fields)).toEqual({
      fullName: true,
      age: true,
      firstName: true,
      lastName: true,
    })
  })

  test('works correctly with shadowing dependencies', () => {
    const fields = {
      fullName: { name: 'firstName', needs: ['firstName'], compute: jest.fn() },
    }

    const selection = { firstName: true }

    expect(computeEngineSideSelection(selection, fields)).toEqual({
      firstName: true,
    })
  })

  test('does not add dependencies if computed field is not selected', () => {
    const fields = {
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
    }
    const selection = { age: true }

    expect(computeEngineSideSelection(selection, fields)).toEqual({
      age: true,
    })
  })

  test('does not add dependencies if computed fields selection is explicitly false', () => {
    const fields = {
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
    }
    const selection = { age: true, fullName: false }

    expect(computeEngineSideSelection(selection, fields)).toEqual({
      age: true,
      fullName: false,
    })
  })
})

describe('computeEngineSideOmissions', () => {
  test('removes computed field dependencies from an exclusion', () => {
    const fields = {
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
    }
    const omission = { firstName: true, age: true }

    expect(computeEngineSideOmissions(omission, fields)).toEqual({
      age: true,
    })
  })

  test('does not remove dependencies if computed field is excluded as well', () => {
    const fields = {
      fullName: { name: 'fullName', needs: ['firstName', 'lastName'], compute: jest.fn() },
    }
    const omission = { fullName: true, firstName: true, lastName: true }

    expect(computeEngineSideOmissions(omission, fields)).toEqual({
      fullName: true,
      firstName: true,
      lastName: true,
    })
  })
})
