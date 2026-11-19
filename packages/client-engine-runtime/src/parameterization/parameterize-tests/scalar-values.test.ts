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

  it('parameterizes primitive values of Json fields', () => {
    const query1: JsonQuery = {
      modelName: 'User',
      action: 'createOne',
      query: {
        arguments: { data: { email: 'test@example.com', metadata: 'some string' } },
        selection: { $scalars: true },
      },
    }

    const query2: JsonQuery = {
      modelName: 'User',
      action: 'createOne',
      query: {
        arguments: { data: { email: 'test@example.com', metadata: 42 } },
        selection: { $scalars: true },
      },
    }

    const result1 = parameterizeQuery(query1, paramGraph)
    const result2 = parameterizeQuery(query2, paramGraph)

    expect(result1).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "createOne",
          "modelName": "User",
          "query": {
            "arguments": {
              "data": {
                "email": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "String",
                  },
                },
                "metadata": {
                  "$type": "Param",
                  "value": {
                    "name": "%2",
                    "type": "Json",
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
          "%2": ""some string"",
        },
      }
    `)
    expect(result2.placeholderValues).toMatchInlineSnapshot(`
      {
        "%1": "test@example.com",
        "%2": "42",
      }
    `)
    expect(result1.parameterizedQuery).toEqual(result2.parameterizedQuery)
  })

  it('does not parameterize primitive values of Json comparison filters', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: { where: { metadata: { path: ['count'], gt: 5 } } },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result.parameterizedQuery.query.arguments).toEqual({
      where: { metadata: { path: ['count'], gt: 5 } },
    })
    expect(result.placeholderValues).toEqual({})
  })
})
