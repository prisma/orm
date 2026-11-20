import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery filter operators', () => {
  it('parameterizes equals filter', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findUnique',
      query: {
        arguments: { where: { age: { equals: 25 } } },
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
                "age": {
                  "equals": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "Int",
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
          "%1": 25,
        },
      }
    `)
  })

  it('parameterizes in filter with array', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: { where: { id: { in: [1, 2, 3] } } },
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

  it('parameterizes comparison operators (lt, lte, gt, gte)', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            age: { gte: 18, lte: 65 },
            salary: { gt: 50000, lt: 100000 },
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
                "age": {
                  "gte": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "Int",
                    },
                  },
                  "lte": {
                    "$type": "Param",
                    "value": {
                      "name": "%2",
                      "type": "Int",
                    },
                  },
                },
                "salary": {
                  "gt": {
                    "$type": "Param",
                    "value": {
                      "name": "%3",
                      "type": "Int",
                    },
                  },
                  "lt": {
                    "$type": "Param",
                    "value": {
                      "name": "%4",
                      "type": "Int",
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
          "%1": 18,
          "%2": 65,
          "%3": 50000,
          "%4": 100000,
        },
      }
    `)
  })

  it('parameterizes string operators (contains, startsWith, endsWith)', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            name: { contains: 'John' },
            email: { startsWith: 'admin', endsWith: '.com' },
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
                "email": {
                  "endsWith": {
                    "$type": "Param",
                    "value": {
                      "name": "%3",
                      "type": "String",
                    },
                  },
                  "startsWith": {
                    "$type": "Param",
                    "value": {
                      "name": "%2",
                      "type": "String",
                    },
                  },
                },
                "name": {
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
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": "John",
          "%2": "admin",
          "%3": ".com",
        },
      }
    `)
  })
})
