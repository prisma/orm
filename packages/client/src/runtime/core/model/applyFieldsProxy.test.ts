import { expect, test } from 'vitest'

import { applyFieldsProxy } from './applyFieldsProxy'

const fields = applyFieldsProxy('MyModel', {
  dbName: '',
  schema: null,
  fields: [
    {
      name: 'intField',
      kind: 'scalar',
      type: 'Int',
      isRequired: true,
      isList: false,
      isId: false,
      isUnique: false,
      isReadOnly: false,
      hasDefaultValue: false,
    },

    {
      name: 'listField',
      kind: 'scalar',
      type: 'String',
      isRequired: true,
      isList: true,
      isId: false,
      isUnique: false,
      isReadOnly: false,
      hasDefaultValue: false,
    },
    {
      name: 'relationField',
      kind: 'scalar',
      type: 'String',
      isRequired: true,
      isList: false,
      isId: false,
      isUnique: false,
      isReadOnly: false,
      hasDefaultValue: false,
      relationName: 'ModelToOtherModel',
    },
    {
      name: 'enumField',
      kind: 'enum',
      type: 'MyEnum',
      isRequired: true,
      isList: false,
      isId: false,
      isUnique: false,
      isReadOnly: false,
      hasDefaultValue: false,
    },
    {
      name: 'listEnumField',
      kind: 'enum',
      type: 'MyEnum',
      isRequired: true,
      isList: true,
      isId: false,
      isUnique: false,
      isReadOnly: false,
      hasDefaultValue: false,
    },
  ],
  uniqueFields: [],
  uniqueIndexes: [],
  primaryKey: null,
})

test('returns info about scalar model field', () => {
  expect(fields.intField.name).toBe('intField')
  expect(fields.intField.modelName).toBe('MyModel')
  expect(fields.intField.isList).toBe(false)
  expect(fields.intField.typeName).toBe('Int')

  expect(fields.listField.name).toBe('listField')
  expect(fields.listField.modelName).toBe('MyModel')
  expect(fields.listField.isList).toBe(true)
  expect(fields.listField.typeName).toBe('String')
})

test('does not return relationship info', () => {
  expect(fields.relationField).toBeUndefined()
})

test('returns keys', () => {
  expect(Object.keys(fields)).toEqual(['intField', 'listField', 'enumField', 'listEnumField'])
})

test('returns values', () => {
  expect(Object.values(fields)).toMatchInlineSnapshot(`
    [
      FieldRefImpl {
        "isEnum": false,
        "isList": false,
        "modelName": "MyModel",
        "name": "intField",
        "typeName": "Int",
      },
      FieldRefImpl {
        "isEnum": false,
        "isList": true,
        "modelName": "MyModel",
        "name": "listField",
        "typeName": "String",
      },
      FieldRefImpl {
        "isEnum": true,
        "isList": false,
        "modelName": "MyModel",
        "name": "enumField",
        "typeName": "MyEnum",
      },
      FieldRefImpl {
        "isEnum": true,
        "isList": true,
        "modelName": "MyModel",
        "name": "listEnumField",
        "typeName": "MyEnum",
      },
    ]
  `)
})
