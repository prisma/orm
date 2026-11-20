import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery tagged values', () => {
  it('parameterizes DateTime tagged values', () => {
    const dateValue = { $type: 'DateTime' as const, value: '2024-01-01T00:00:00.000Z' }
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: { createdAt: dateValue },
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
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "DateTime",
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

  it('preserves FieldRef tagged values', () => {
    const fieldRef = { $type: 'FieldRef' as const, value: { _ref: 'balance', _container: 'User' } }
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            balance: { gt: fieldRef },
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
                "balance": {
                  "gt": {
                    "$type": "FieldRef",
                    "value": {
                      "_container": "User",
                      "_ref": "balance",
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
        "placeholderValues": {},
      }
    `)
  })
})
