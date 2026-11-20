import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery structural values', () => {
  describe('top-level structural keys', () => {
    it('preserves modelName and action', () => {
      const query: JsonQuery = {
        modelName: 'User',
        action: 'findUnique',
        query: {
          arguments: { where: { id: 1 } },
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
            "%1": 1,
          },
        }
      `)
    })
  })

  it('preserves selection booleans', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { id: 1 } },
        selection: {
          id: true,
          name: true,
          email: false,
        },
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
              "email": false,
              "id": true,
              "name": true,
            },
          },
        },
        "placeholderValues": {
          "%1": 1,
        },
      }
    `)
  })

  it('preserves $scalars and $composites markers', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { id: 1 } },
        selection: {
          $scalars: true,
          $composites: true,
        },
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
              "$composites": true,
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": 1,
        },
      }
    `)
  })

  it('preserves orderBy directions', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          orderBy: { name: 'asc', createdAt: 'desc' },
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
              "orderBy": {
                "createdAt": "desc",
                "name": "asc",
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

  it('preserves take and skip values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          take: 10,
          skip: 5,
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
              "skip": 5,
              "take": 10,
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

  it('preserves mode flag', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            name: { contains: 'test', mode: 'insensitive' },
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
                "name": {
                  "contains": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "String",
                    },
                  },
                  "mode": "insensitive",
                },
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": "test",
        },
      }
    `)
  })
})
