import type * as DMMF from '@prisma/dmmf'
import { describe, expect, test } from 'vitest'

import { DMMFHelper } from './dmmf'
import { GenericArgsInfo } from './GenericsArgsInfo'

function inputObjectType(name: string, fields: DMMF.SchemaArg[], meta?: { source: string }): DMMF.InputType {
  return {
    name,
    fields,
    meta,
    constraints: { minNumFields: null, maxNumFields: null },
  }
}

function inputObjectRef(name: string): DMMF.InputTypeRef {
  return {
    location: 'inputObjectTypes',
    namespace: 'prisma',
    isList: false,
    type: name,
  }
}

function field(name: string, inputTypes: DMMF.InputTypeRef[]): DMMF.SchemaArg {
  return {
    name,
    isRequired: false,
    isNullable: false,
    inputTypes,
    isParameterizable: false,
  }
}

function scalarRef(type: string): DMMF.InputTypeRef {
  return {
    location: 'scalar',
    type,
    isList: false,
  }
}

function fieldRef(name: string): DMMF.InputTypeRef {
  return {
    location: 'fieldRefTypes',
    type: name,
    isList: false,
  }
}

function dmmf(inputObjectTypes: DMMF.InputType[]) {
  return new DMMFHelper({
    schema: {
      inputObjectTypes: {
        prisma: inputObjectTypes,
      },
      outputObjectTypes: {
        prisma: [
          { name: 'Query', fields: [] },
          { name: 'Mutation', fields: [] },
        ],
        model: [],
      },
      enumTypes: {
        prisma: [],
      },
      fieldRefTypes: {
        prisma: [],
      },
    },
    datamodel: {
      models: [],
      types: [],
      enums: [],
      indexes: [],
    },

    mappings: {
      modelOperations: [],
      otherOperations: {
        read: [],
        write: [],
      },
    },
  })
}

describe('typeNeedsGenericModelArg', () => {
  test('is false for object that does not contain field refs', () => {
    const object = inputObjectType('InputType', [
      field('someField', [scalarRef('Int')]),
      field('someOtherField', [scalarRef('Int')]),
    ])

    const argsInfo = new GenericArgsInfo(dmmf([]))
    expect(argsInfo.typeNeedsGenericModelArg(object)).toBe(false)
  })

  test('is true for object that contains field refs', () => {
    const argsInfo = new GenericArgsInfo(dmmf([]))
    expect(
      argsInfo.typeNeedsGenericModelArg(
        inputObjectType('InputType', [
          field('someField', [scalarRef('Int')]),
          field('someOtherField', [fieldRef('IntRef')]),
        ]),
      ),
    ).toBe(true)
  })

  test('is false if object containing nested field has source defined', () => {
    const argsInfo = new GenericArgsInfo(dmmf([]))
    expect(
      argsInfo.typeNeedsGenericModelArg(
        inputObjectType(
          'InputType',
          [field('someField', [scalarRef('Int')]), field('someOtherField', [fieldRef('IntRef')])],
          { source: 'SomeModel' },
        ),
      ),
    ).toBe(false)
  })

  test('is true for object that contains deeply nested field ref', () => {
    const input1 = inputObjectType('Input1', [
      field('someField', [scalarRef('Int')]),
      field('someOtherField', [inputObjectRef('Input2')]),
    ])

    const input2 = inputObjectType('Input2', [field('thirdField', [inputObjectRef('Input3')])])
    const input3 = inputObjectType('Input3', [field('refField', [fieldRef('IntRef')])])
    const argsInfo = new GenericArgsInfo(dmmf([input1, input2, input3]))
    expect(argsInfo.typeNeedsGenericModelArg(input1)).toBe(true)
  })

  test('types with recursion does not require generic if no other field does', () => {
    const type = inputObjectType('RecursiveType', [
      field('recursiveField', [inputObjectRef('RecursiveType')]),
      field('otherField', [scalarRef('Int')]),
    ])
    const argsInfo = new GenericArgsInfo(dmmf([type]))

    expect(argsInfo.typeNeedsGenericModelArg(type)).toBe(false)
  })

  test('types with recursion require generic if any other field does', () => {
    const type = inputObjectType('RecursiveType', [
      field('recursiveField', [inputObjectRef('RecursiveType')]),
      field('otherField', [fieldRef('IntRef')]),
    ])
    const argsInfo = new GenericArgsInfo(dmmf([type]))

    expect(argsInfo.typeNeedsGenericModelArg(type)).toBe(true)
  })
  test('type reached through many fields is still found when it contains field refs', () => {
    const shared = inputObjectType('Shared', [field('refField', [fieldRef('IntRef')])])
    const middle = Array.from({ length: 50 }, (_, i) =>
      inputObjectType(`Middle${i}`, [field('a', [inputObjectRef('Shared')]), field('b', [inputObjectRef('Shared')])]),
    )
    const root = inputObjectType(
      'Root',
      middle.map((m, i) => field(`f${i}`, [inputObjectRef(m.name)])),
    )
    const argsInfo = new GenericArgsInfo(dmmf([root, shared, ...middle]))

    expect(argsInfo.typeNeedsGenericModelArg(root)).toBe(true)
    for (const m of middle) {
      expect(argsInfo.typeNeedsGenericModelArg(m)).toBe(true)
    }
  })

  test('type reached through many fields is still false when nothing contains field refs', () => {
    const shared = inputObjectType('Shared', [field('scalarField', [scalarRef('Int')])])
    const middle = Array.from({ length: 50 }, (_, i) =>
      inputObjectType(`Middle${i}`, [field('a', [inputObjectRef('Shared')]), field('b', [inputObjectRef('Shared')])]),
    )
    const root = inputObjectType(
      'Root',
      middle.map((m, i) => field(`f${i}`, [inputObjectRef(m.name)])),
    )
    const argsInfo = new GenericArgsInfo(dmmf([root, shared, ...middle]))

    expect(argsInfo.typeNeedsGenericModelArg(root)).toBe(false)
    expect(argsInfo.typeNeedsGenericModelArg(shared)).toBe(false)
    for (const m of middle) {
      expect(argsInfo.typeNeedsGenericModelArg(m)).toBe(false)
    }
  })

  test('mutually recursive types find a field ref behind the loop', () => {
    const a = inputObjectType('A', [field('toB', [inputObjectRef('B')])])
    const b = inputObjectType('B', [field('toA', [inputObjectRef('A')]), field('toC', [inputObjectRef('C')])])
    const c = inputObjectType('C', [field('refField', [fieldRef('IntRef')])])
    const argsInfo = new GenericArgsInfo(dmmf([a, b, c]))

    expect(argsInfo.typeNeedsGenericModelArg(a)).toBe(true)
    expect(argsInfo.typeNeedsGenericModelArg(b)).toBe(true)
  })

  test('mutually recursive types without field refs do not require generic', () => {
    const a = inputObjectType('A', [field('toB', [inputObjectRef('B')]), field('n', [scalarRef('Int')])])
    const b = inputObjectType('B', [field('toA', [inputObjectRef('A')])])
    const argsInfo = new GenericArgsInfo(dmmf([a, b]))

    expect(argsInfo.typeNeedsGenericModelArg(a)).toBe(false)
    expect(argsInfo.typeNeedsGenericModelArg(b)).toBe(false)
  })
})

describe('typeRefNeedsGenericModelArg', () => {
  test('is true for field ref', () => {
    const argsInfo = new GenericArgsInfo(dmmf([]))
    expect(argsInfo.typeRefNeedsGenericModelArg(fieldRef('IntRef'))).toBe(true)
  })

  test('is true if referenced type has field refs', () => {
    const type = inputObjectType('Input', [
      field('someField', [scalarRef('Int')]),
      field('refField', [fieldRef('IntRef')]),
    ])

    const argsInfo = new GenericArgsInfo(dmmf([type]))
    expect(argsInfo.typeRefNeedsGenericModelArg(inputObjectRef('Input'))).toBe(true)
  })

  test('is false if referenced type has no field refs', () => {
    const type = inputObjectType('Input', [field('someField', [scalarRef('Int')])])

    const argsInfo = new GenericArgsInfo(dmmf([type]))
    expect(argsInfo.typeRefNeedsGenericModelArg(inputObjectRef('Input'))).toBe(false)
  })
})
