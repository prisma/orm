import type { JsonQuery } from '@prisma/json-protocol'
import type { EnumLookup, ParamGraphData } from '@prisma/param-graph'
import { EdgeFlag, ParamGraph, ScalarMask } from '@prisma/param-graph'
import { describe, expect, it } from 'vitest'

import { parameterizeBatch, parameterizeQuery } from './parameterize'

function createEnumLookup(runtimeDataModel: {
  enums: Record<string, { values: { name: string; dbName: string | null }[] }>
}): EnumLookup {
  return (enumName: string) => {
    const enumDef = runtimeDataModel.enums[enumName]
    const mapping: Record<string, string> = {}
    for (const value of enumDef?.values ?? []) {
      mapping[value.name] = value.dbName ?? value.name
    }
    return mapping
  }
}

describe('parameterizeQuery', () => {
  // Sample ParamGraph simulating a User model with common fields
  const sampleGraphData: ParamGraphData = {
    strings: [
      'where',
      'id',
      'email',
      'name',
      'equals',
      'contains',
      'in',
      'data',
      'selection',
      'posts',
      'title',
      'status',
      'Status',
      'createdAt',
    ],
    inputNodes: [
      // Node 0: UserWhereInput
      {
        edges: {
          1: { flags: EdgeFlag.ParamScalar | EdgeFlag.Object, scalarMask: ScalarMask.String, childNodeId: 1 }, // id
          2: { flags: EdgeFlag.ParamScalar | EdgeFlag.Object, scalarMask: ScalarMask.String, childNodeId: 1 }, // email
          3: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // name
          11: { flags: EdgeFlag.ParamEnum, enumNameIndex: 12 }, // status (enum)
          13: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.DateTime }, // createdAt
        },
      },
      // Node 1: StringFilter
      {
        edges: {
          4: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // equals
          5: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // contains
          6: { flags: EdgeFlag.ParamListScalar, scalarMask: ScalarMask.String }, // in
        },
      },
      // Node 2: FindManyUserArgs
      {
        edges: {
          0: { flags: EdgeFlag.Object, childNodeId: 0 }, // where
        },
      },
      // Node 3: UserCreateInput
      {
        edges: {
          1: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // id
          2: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // email
          3: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // name
        },
      },
      // Node 4: CreateUserArgs
      {
        edges: {
          7: { flags: EdgeFlag.Object, childNodeId: 3 }, // data
        },
      },
    ],
    outputNodes: [
      // Node 0: UserOutput
      {
        edges: {
          9: { argsNodeId: 5, outputNodeId: 1 }, // posts
        },
      },
      // Node 1: PostOutput
      { edges: {} },
    ],
    roots: {
      'User.findMany': { argsNodeId: 2, outputNodeId: 0 },
      'User.findUnique': { argsNodeId: 2, outputNodeId: 0 },
      'User.createOne': { argsNodeId: 4, outputNodeId: 0 },
    },
  }

  const sampleRuntimeDataModel = {
    models: {},
    enums: {
      Status: {
        values: [
          { name: 'ACTIVE', dbName: null },
          { name: 'INACTIVE', dbName: null },
          { name: 'UNSPECIFIED', dbName: 'N/A' },
        ],
        dbName: null,
      },
    },
    types: {},
  }

  const paramGraph = ParamGraph.fromData(sampleGraphData, createEnumLookup(sampleRuntimeDataModel))

  describe('basic parameterization', () => {
    it('parameterizes scalar values in where clause', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { name: 'John' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': 'John',
      })
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { name: { $type: 'Param', value: { name: '%1', type: 'String' } } },
      })
    })

    it('parameterizes multiple fields', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123', email: 'test@example.com' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': '123',
        '%2': 'test@example.com',
      })
      expect(Object.keys(result.placeholderValues).length).toBe(2)
    })
  })

  describe('filter operators', () => {
    it('parameterizes equals filter', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: { equals: 'abc' } } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': 'abc',
      })
    })

    it('parameterizes contains filter', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { email: { contains: 'example' } } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': 'example',
      })
    })

    it('parameterizes in filter as whole list', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: { in: ['a', 'b', 'c'] } } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': ['a', 'b', 'c'],
      })
    })
  })

  describe('null handling', () => {
    it('preserves null values (never parameterizes)', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { name: null } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({})
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { name: null },
      })
    })
  })

  describe('structural values', () => {
    it('preserves FieldRef values', () => {
      const fieldRef = { $type: 'FieldRef' as const, value: { _ref: 'balance', _container: 'User' } }
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: { equals: fieldRef } } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({})
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { id: { equals: fieldRef } },
      })
    })

    it('preserves Enum tagged values', () => {
      const enumValue = { $type: 'Enum' as const, value: 'ACTIVE' }
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { status: enumValue } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({})
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { status: enumValue },
      })
    })
  })

  describe('tagged scalar values', () => {
    it('parameterizes DateTime tagged values', () => {
      const dateValue = { $type: 'DateTime' as const, value: '2024-01-01T00:00:00.000Z' }

      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { createdAt: dateValue } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues['%1']).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('enum handling', () => {
    it('parameterizes valid enum values', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { status: 'ACTIVE' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': 'ACTIVE',
      })
    })

    it('parameterizes an enum value with a mapped name', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { status: 'UNSPECIFIED' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': 'N/A', // dbName mapping applied
      })
    })

    it('does not parameterize invalid enum values', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { status: 'INVALID_STATUS' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({})
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { status: 'INVALID_STATUS' },
      })
    })
  })

  describe('selection preservation', () => {
    it('preserves $scalars marker', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.parameterizedQuery.query.selection).toEqual({ $scalars: true })
    })

    it('preserves $composites marker', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { $scalars: true, $composites: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.parameterizedQuery.query.selection).toEqual({ $scalars: true, $composites: true })
    })

    it('preserves boolean field selections', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { id: true, email: true, name: false },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.parameterizedQuery.query.selection).toEqual({
        id: true,
        email: true,
        name: false,
      })
    })
  })

  describe('unknown fields', () => {
    it('preserves unknown fields without parameterization', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { unknownField: 'value' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      // Unknown field should be preserved as-is
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { unknownField: 'value' },
      })
      expect(result.placeholderValues).toEqual({})
    })
  })

  describe('create operations', () => {
    it('parameterizes data in create operations', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'createOne',
        query: {
          arguments: { data: { id: '123', email: 'test@example.com', name: 'John' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      expect(result.placeholderValues).toEqual({
        '%1': '123',
        '%2': 'test@example.com',
        '%3': 'John',
      })
    })
  })

  describe('cache key consistency', () => {
    it('generates same parameterized query for different values with same structure', () => {
      const query1: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { $scalars: true },
        },
      }

      const query2: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '456' } },
          selection: { $scalars: true },
        },
      }

      const result1 = parameterizeQuery(query1, paramGraph)
      const result2 = parameterizeQuery(query2, paramGraph)

      const cacheKey1 = JSON.stringify(result1.parameterizedQuery)
      const cacheKey2 = JSON.stringify(result2.parameterizedQuery)

      expect(cacheKey1).toBe(cacheKey2)
    })

    it('generates different parameterized query for different structures', () => {
      const query1: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { $scalars: true },
        },
      }

      const query2: JsonQuery = {
        modelName: 'User',
        action: 'findMany',
        query: {
          arguments: { where: { email: 'test@example.com' } },
          selection: { $scalars: true },
        },
      }

      const result1 = parameterizeQuery(query1, paramGraph)
      const result2 = parameterizeQuery(query2, paramGraph)

      const cacheKey1 = JSON.stringify(result1.parameterizedQuery)
      const cacheKey2 = JSON.stringify(result2.parameterizedQuery)

      expect(cacheKey1).not.toBe(cacheKey2)
    })
  })

  describe('unknown root operations', () => {
    it('returns query unchanged when root is not found', () => {
      const query: JsonQuery = {
        modelName: 'UnknownModel',
        action: 'findMany',
        query: {
          arguments: { where: { id: '123' } },
          selection: { $scalars: true },
        },
      }

      const result = parameterizeQuery(query, paramGraph)

      // Query should be unchanged (no parameterization possible)
      expect(result.parameterizedQuery.query.arguments).toEqual({
        where: { id: '123' },
      })
      expect(result.placeholderValues).toEqual({})
    })
  })
})

describe('parameterizeBatch', () => {
  const sampleGraphData: ParamGraphData = {
    strings: ['where', 'id', 'email'],
    inputNodes: [
      // Node 0: UserWhereInput
      {
        edges: {
          1: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // id
          2: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }, // email
        },
      },
      // Node 1: FindUserArgs
      {
        edges: {
          0: { flags: EdgeFlag.Object, childNodeId: 0 }, // where
        },
      },
    ],
    outputNodes: [],
    roots: {
      'User.findUnique': { argsNodeId: 1 },
      'User.findMany': { argsNodeId: 1 },
    },
  }

  const sampleRuntimeDataModel = {
    models: {},
    enums: {},
    types: {},
  }

  const paramGraph = ParamGraph.fromData(sampleGraphData, createEnumLookup(sampleRuntimeDataModel))

  it('parameterizes all queries in a batch with unique placeholder names', () => {
    const batch = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '123' } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '456' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result.placeholderValues).toEqual({
      '%1': '123',
      '%2': '456',
    })
  })

  it('preserves transaction info', () => {
    const batch = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '123' } },
            selection: { $scalars: true },
          },
        },
      ],
      transaction: { isolationLevel: 'Serializable' as const },
    }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result.parameterizedBatch.transaction).toEqual({ isolationLevel: 'Serializable' })
  })

  it('generates consistent cache keys for batches with same structure', () => {
    const batch1 = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '123' } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '456' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const batch2 = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: 'abc' } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: 'def' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result1 = parameterizeBatch(batch1, paramGraph)
    const result2 = parameterizeBatch(batch2, paramGraph)

    const cacheKey1 = JSON.stringify(result1.parameterizedBatch)
    const cacheKey2 = JSON.stringify(result2.parameterizedBatch)

    expect(cacheKey1).toBe(cacheKey2)
  })

  it('generates different cache keys for batches with different structures', () => {
    const batch1 = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { id: '123' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const batch2 = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique' as const,
          query: {
            arguments: { where: { email: 'test@example.com' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result1 = parameterizeBatch(batch1, paramGraph)
    const result2 = parameterizeBatch(batch2, paramGraph)

    const cacheKey1 = JSON.stringify(result1.parameterizedBatch)
    const cacheKey2 = JSON.stringify(result2.parameterizedBatch)

    expect(cacheKey1).not.toBe(cacheKey2)
  })

  it('handles empty batch', () => {
    const batch = { batch: [] }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result.parameterizedBatch.batch).toEqual([])
    expect(result.placeholderValues).toEqual({})
  })
})
