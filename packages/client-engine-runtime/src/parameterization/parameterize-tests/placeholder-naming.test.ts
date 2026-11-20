import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery placeholder naming', () => {
  it('generates deterministic names for same structure', () => {
    const query1: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { id: 1 } },
        selection: { $scalars: true },
      },
    }

    const query2: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { id: 2 } },
        selection: { $scalars: true },
      },
    }

    const result1 = parameterizeQuery(query1, paramGraph)
    const result2 = parameterizeQuery(query2, paramGraph)

    expect(result1).toMatchInlineSnapshot(`
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
          "%1": 1,
        },
      }
    `)

    expect(result2).toMatchInlineSnapshot(`
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
          "%1": 2,
        },
      }
    `)
  })

  it('generates unique names for different values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            id: { in: [1, 2, 3] },
          },
        },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findMany",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "id": {
                  "in": {
                    "$type": "Param",
                    "value": {
                      "inner": {
                        "type": "Int",
                      },
                      "name": "%1",
                      "type": "List",
                    },
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
          "%1": [
            1,
            2,
            3,
          ],
        },
      }
    `)
  })

  it('handles deeply nested paths', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            author: {
              profile: {
                bio: { contains: 'developer' },
              },
            },
          },
        },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "findMany",
          "modelName": "User",
          "query": {
            "arguments": {
              "where": {
                "author": {
                  "profile": {
                    "bio": {
                      "contains": {
                        "$type": "Param",
                        "value": {
                          "name": "%1",
                          "type": "String",
                        },
                      },
                    },
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
          "%1": "developer",
        },
      }
    `)
  })
})
