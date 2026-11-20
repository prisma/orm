import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery placeholder reuse', () => {
  it('reuses placeholder for identical string values at different paths', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'upsertOne',
      query: {
        arguments: {
          where: { email: 'test@example.com' },
          create: { email: 'test@example.com' },
          update: {},
        },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "upsertOne",
          "modelName": "User",
          "query": {
            "arguments": {
              "create": {
                "email": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "String",
                  },
                },
              },
              "update": {},
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

  it('reuses placeholder for identical Int values at different paths', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            age: 42,
            id: 42,
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
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "Int",
                  },
                },
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

  it('reuses placeholder for identical DateTime tagged values', () => {
    const dateValue = { $type: 'DateTime' as const, value: '2024-01-01T00:00:00.000Z' }
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            createdAt: { gte: dateValue, lte: dateValue },
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
                "createdAt": {
                  "gte": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "DateTime",
                    },
                  },
                  "lte": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "DateTime",
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
          "%1": "2024-01-01T00:00:00.000Z",
        },
      }
    `)
  })

  it('reuses placeholder for identical Bytes tagged values', () => {
    const bytesValue = { $type: 'Bytes' as const, value: 'SGVsbG8gV29ybGQ=' }
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            avatar: { equals: bytesValue, not: bytesValue },
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
                "avatar": {
                  "equals": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "Bytes",
                    },
                  },
                  "not": {
                    "$type": "Param",
                    "value": {
                      "name": "%1",
                      "type": "Bytes",
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
          "%1": "SGVsbG8gV29ybGQ=",
        },
      }
    `)
  })

  it('reuses placeholder for identical array values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            OR: [{ id: { in: [1, 2, 3] } }, { age: { in: [1, 2, 3] } }],
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
                "OR": [
                  {
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
                  {
                    "age": {
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
                ],
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

  it('reuses placeholder for enum values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            OR: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }],
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
                "OR": [
                  {
                    "status": {
                      "$type": "Param",
                      "value": {
                        "name": "%1",
                        "type": "Enum",
                      },
                    },
                  },
                  {
                    "status": {
                      "$type": "Param",
                      "value": {
                        "name": "%1",
                        "type": "Enum",
                      },
                    },
                  },
                ],
              },
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": "ACTIVE",
        },
      }
    `)
  })

  it('does not share placeholders between different string values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'upsertOne',
      query: {
        arguments: {
          where: { email: 'alice@example.com' },
          create: { email: 'bob@example.com' },
          update: {},
        },
        selection: { $scalars: true },
      },
    }

    const result = parameterizeQuery(query, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedQuery": {
          "action": "upsertOne",
          "modelName": "User",
          "query": {
            "arguments": {
              "create": {
                "email": {
                  "$type": "Param",
                  "value": {
                    "name": "%2",
                    "type": "String",
                  },
                },
              },
              "update": {},
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
          "%1": "alice@example.com",
          "%2": "bob@example.com",
        },
      }
    `)
  })
})
