import type { JsonBatchQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeBatch } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeBatch', () => {
  it('parameterizes all queries in a batch with unique placeholder names', () => {
    const batch: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 1 } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 2 } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
            {
              "action": "findUnique",
              "modelName": "User",
              "query": {
                "arguments": {
                  "where": {
                    "id": {
                      "$type": "Param",
                      "value": {
                        "name": "%2",
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
          ],
        },
        "placeholderValues": {
          "%1": 1,
          "%2": 2,
        },
      }
    `)
  })

  it('preserves transaction info', () => {
    const batch: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 1 } },
            selection: { $scalars: true },
          },
        },
      ],
      transaction: { isolationLevel: 'Serializable' },
    }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
          ],
          "transaction": {
            "isolationLevel": "Serializable",
          },
        },
        "placeholderValues": {
          "%1": 1,
        },
      }
    `)
  })

  it('generates consistent cache keys for batches with same structure', () => {
    const batch1: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 1 } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 2 } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const batch2: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 100 } },
            selection: { $scalars: true },
          },
        },
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 200 } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result1 = parameterizeBatch(batch1, paramGraph)
    const result2 = parameterizeBatch(batch2, paramGraph)

    expect(result1).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
            {
              "action": "findUnique",
              "modelName": "User",
              "query": {
                "arguments": {
                  "where": {
                    "id": {
                      "$type": "Param",
                      "value": {
                        "name": "%2",
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
          ],
        },
        "placeholderValues": {
          "%1": 1,
          "%2": 2,
        },
      }
    `)

    expect(result2).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
            {
              "action": "findUnique",
              "modelName": "User",
              "query": {
                "arguments": {
                  "where": {
                    "id": {
                      "$type": "Param",
                      "value": {
                        "name": "%2",
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
          ],
        },
        "placeholderValues": {
          "%1": 100,
          "%2": 200,
        },
      }
    `)

    expect(JSON.stringify(result1.parameterizedBatch)).toBe(JSON.stringify(result2.parameterizedBatch))
  })

  it('generates different cache keys for batches with different structures', () => {
    const batch1: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { id: 1 } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const batch2: JsonBatchQuery = {
      batch: [
        {
          modelName: 'User',
          action: 'findUnique',
          query: {
            arguments: { where: { email: 'test@example.com' } },
            selection: { $scalars: true },
          },
        },
      ],
    }

    const result1 = parameterizeBatch(batch1, paramGraph)
    const result2 = parameterizeBatch(batch2, paramGraph)

    expect(result1).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
          ],
        },
        "placeholderValues": {
          "%1": 1,
        },
      }
    `)

    expect(result2).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [
            {
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
          ],
        },
        "placeholderValues": {
          "%1": "test@example.com",
        },
      }
    `)

    expect(JSON.stringify(result1.parameterizedBatch)).not.toBe(JSON.stringify(result2.parameterizedBatch))
  })

  it('handles empty batch', () => {
    const batch: JsonBatchQuery = {
      batch: [],
    }

    const result = parameterizeBatch(batch, paramGraph)

    expect(result).toMatchInlineSnapshot(`
      {
        "parameterizedBatch": {
          "batch": [],
        },
        "placeholderValues": {},
      }
    `)
  })
})
