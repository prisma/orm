import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery scalar values', () => {
  it('parameterizes string values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { email: 'test@example.com' } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findUnique",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "email": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "String",
                  },
                },
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": "test@example.com",
        },
      }
    `)
  })

  it('parameterizes number values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { id: 42 } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findUnique",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "id": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "Int",
                  },
                },
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": 42,
        },
      }
    `)
  })

  it('parameterizes integer-valued floats outside the Int range', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: { where: { salary: { in: [65333601047007986000, 1.5430800568907436e25] } } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result.parameterizedQuery.query.arguments).toEqual({
      where: {
        salary: {
          in: { $type: 'Param', value: { name: '%1', type: 'List', inner: { type: 'Float' } } },
        },
      },
    })
    expect(result.placeholderValues).toEqual({
      '%1': [65333601047007986000, 1.5430800568907436e25],
    })
  })

  it('parameterizes integer-valued floats in data', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'updateMany',
      query: {
        arguments: { data: { salary: 65333601047007986000 } },
        selection: { count: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result.parameterizedQuery.query.arguments).toEqual({
      data: { salary: { $type: 'Param', value: { name: '%1', type: 'Float' } } },
    })
    expect(result.placeholderValues).toEqual({ '%1': 65333601047007986000 })
  })

  it('leaves integers above the Int range inline on Int fields', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: { where: { age: 2 ** 31 } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result.parameterizedQuery.query.arguments).toEqual({
      where: { age: 2 ** 31 },
    })
  })

  it('preserves null values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { deletedAt: null } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findUnique",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "deletedAt": null,
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {},
      }
    `)
  })

  it('parameterizes boolean values in where clauses', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { isActive: true } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findUnique",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "isActive": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "Boolean",
                  },
                },
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": true,
        },
      }
    `)
  })
})
