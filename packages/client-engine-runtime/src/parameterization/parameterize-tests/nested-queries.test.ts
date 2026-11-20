import type { JsonQuery } from '@prisma/json-protocol'
import { describe, expect, it } from 'vitest'

import { parameterizeQuery } from '../parameterize'
import { getParamGraph } from './test-fixtures'

const paramGraph = getParamGraph()

describe('parameterizeQuery nested queries', () => {
  it('parameterizes relation filter values', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'findMany',
      query: {
        arguments: {
          where: {
            author: {
              name: { contains: 'Smith' },
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
            },
            "selection": {
              "$scalars": true,
            },
          },
        },
        "placeholderValues": {
          "%1": "Smith",
        },
      }
    `)
  })

  it('parameterizes nested data in create', () => {
    const query: JsonQuery = {
      modelName: 'User',
      action: 'createOne',
      query: {
        arguments: {
          data: {
            name: 'John',
            email: 'john@example.com',
            posts: {
              create: [{ title: 'Hello', content: 'World' }],
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
          "action": "createOne",
          "modelName": "User",
          "query": {
            "arguments": {
              "data": {
                "email": {
                  "$type": "Param",
                  "value": {
                    "name": "%2",
                    "type": "String",
                  },
                },
                "name": {
                  "$type": "Param",
                  "value": {
                    "name": "%1",
                    "type": "String",
                  },
                },
                "posts": {
                  "create": [
                    {
                      "content": {
                        "$type": "Param",
                        "value": {
                          "name": "%4",
                          "type": "String",
                        },
                      },
                      "title": {
                        "$type": "Param",
                        "value": {
                          "name": "%3",
                          "type": "String",
                        },
                      },
                    },
                  ],
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
          "%2": "john@example.com",
          "%3": "Hello",
          "%4": "World",
        },
      }
    `)
  })
})
