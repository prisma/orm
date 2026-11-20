import { AnyNull, DbNull, Decimal, JsonNull } from '@prisma/client-runtime-utils'

import { field, model, runtimeDataModel } from '../../../testUtils/dataModelBuilder'
import { deepCloneArgs } from '../../utils/deepCloneArgs'
import { MergedExtensionsList } from '../extensions/MergedExtensionsList'
import { FieldRefImpl } from '../model/FieldRef'
import { skip } from '../types'
import { JsArgs } from '../types/exported/JsApi'
import { serializeJsonQuery, SerializeParams } from './serializeJsonQuery'

const User = model('User', [
  field('scalar', 'name', 'String'),
  field('scalar', 'nickname', 'String'),
  field('object', 'posts', 'Post', {
    isList: true,
    relationName: 'UserToPost',
  }),
])

const Post = model('Post', [
  field('scalar', 'title', 'String'),
  field('scalar', 'userId', 'String'),
  field('scalar', 'published', 'Boolean'),
  field('object', 'user', 'User', {
    relationName: 'PostToUser',
  }),
  field('object', 'attachments', 'Attachment', {
    relationName: 'PostToAttachment',
    isList: true,
  }),
])

const Attachment = model('Attachment', [
  field('scalar', 'fileName', 'String'),
  field('scalar', 'postId', 'String'),
  field('object', 'post', 'Post', {
    relationName: 'AttachmentToPost',
  }),
])

const datamodel = runtimeDataModel({ models: [User, Post, Attachment] })

type SimplifiedParams = Omit<
  SerializeParams,
  'runtimeDataModel' | 'extensions' | 'clientMethod' | 'errorFormat' | 'clientVersion' | 'previewFeatures'
> & {
  extensions?: MergedExtensionsList
  previewFeatures?: string[]
}

function serialize(params: SimplifiedParams) {
  return JSON.stringify(
    serializeJsonQuery({
      ...params,
      runtimeDataModel: datamodel,
      previewFeatures: params.previewFeatures ?? [],
      extensions: params.extensions ?? MergedExtensionsList.empty(),
      clientMethod: 'foo',
      errorFormat: 'colorless',
      clientVersion: '0.0.0',
      wrapRawValues: true,
    }),
    null,
    2,
  )
}

test('findMany', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('create', () => {
  expect(serialize({ modelName: 'User', action: 'create', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "createOne",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})
test('createMany', () => {
  expect(serialize({ modelName: 'User', action: 'createMany', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "createMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('createManyAndReturn', () => {
  expect(serialize({ modelName: 'User', action: 'createManyAndReturn', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "createManyAndReturn",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('updateMany', () => {
  expect(serialize({ modelName: 'User', action: 'updateMany', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "updateMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('updateManyAndReturn', () => {
  expect(serialize({ modelName: 'User', action: 'updateManyAndReturn', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "updateManyAndReturn",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('delete', () => {
  expect(serialize({ modelName: 'User', action: 'delete', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "deleteOne",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('upsert', () => {
  expect(serialize({ modelName: 'User', action: 'upsert', args: {} })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "upsertOne",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('queryRaw', () => {
  expect(
    serialize({
      action: 'queryRaw',
      args: { query: 'SELECT ?', parameters: { __prismaRawParameters__: true, values: '[1]' } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "action": "queryRaw",
      "query": {
        "arguments": {
          "query": "SELECT ?",
          "parameters": "[1]"
        },
        "selection": {}
      }
    }"
  `)
})

test('executeRaw', () => {
  expect(
    serialize({
      action: 'queryRaw',
      args: { query: 'INSET INTO test VALUES (?, ?)', parameters: { __prismaRawParameters__: true, values: '[1, 2]' } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "action": "queryRaw",
      "query": {
        "arguments": {
          "query": "INSET INTO test VALUES (?, ?)",
          "parameters": "[1, 2]"
        },
        "selection": {}
      }
    }"
  `)
})

test('findRaw', () => {
  expect(
    serialize({
      action: 'findRaw',
      modelName: 'User',
      args: {},
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findRaw",
      "query": {
        "arguments": {},
        "selection": {}
      }
    }"
  `)
})

test('aggregateRaw', () => {
  expect(
    serialize({
      action: 'aggregateRaw',
      modelName: 'User',
      args: { pipeline: [] },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "aggregateRaw",
      "query": {
        "arguments": {
          "pipeline": []
        },
        "selection": {}
      }
    }"
  `)
})

test('no args', () => {
  expect(serialize({ modelName: 'User', action: 'findMany' })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - number - int', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { where: { id: 1 } } })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "id": 1
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - number - float', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { where: { height: { gt: 180.1234 } } } }))
    .toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "height": {
              "gt": 180.1234
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - string', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { where: { name: 'foo' } } })).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "foo"
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - boolean - true', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { where: { active: true } } }))
    .toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "active": true
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - boolean - false', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { where: { active: false } } }))
    .toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "active": false
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - Date', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { birthday: new Date('1980-01-02') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "birthday": {
              "$type": "DateTime",
              "value": "1980-01-02T00:00:00.000Z"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - BigInt', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { netWorth: 123n } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "netWorth": {
              "$type": "BigInt",
              "value": "123"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - Buffer', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { binary: Buffer.from('hello world') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "binary": {
              "$type": "Bytes",
              "value": "aGVsbG8gd29ybGQ="
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - Uint8Array', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { binary: new Uint8Array(Buffer.from('hello world')) } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "binary": {
              "$type": "Bytes",
              "value": "aGVsbG8gd29ybGQ="
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - Decimal', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { height: new Decimal('123.45') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "height": {
              "$type": "Decimal",
              "value": "123.45"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - Decimal-js like', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: {
        where: {
          height: {
            d: [12, 5000000],
            e: 1,
            s: 1,
            toFixed: () => '12.5',
          },
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "height": {
              "$type": "Decimal",
              "value": "12.5"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - FieldRef', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name: new FieldRefImpl('User', 'nickname', 'string', false, false) } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": {
              "$type": "FieldRef",
              "value": {
                "_ref": "nickname",
                "_container": "User"
              }
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - object with toJSON method', () => {
  const name = {
    toJSON() {
      return 'Horsey McHorseface'
    },
  }

  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "Horsey McHorseface"
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - class instance with toJSON method serializes the same after deepCloneArgs', () => {
  class Name {
    constructor(readonly equals: string) {}
    toJSON() {
      return 'from-toJSON'
    }
  }
  const args = { where: { name: new Name('from-field') } }

  expect(serialize({ modelName: 'User', action: 'findMany', args: deepCloneArgs(args) as JsArgs })).toEqual(
    serialize({ modelName: 'User', action: 'findMany', args }),
  )
})

test('args - object with undefined values', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { undefinedField: undefined, definedField: 123 } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "definedField": 123
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - object with $type field', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: { $type: 'Decimal', value: '123' } } },
    }),
    // not using inline snapshot here because our default serializer mangles backslashes on windows
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Raw",
              "value": {
                "$type": "Decimal",
                "value": "123"
              }
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - JsonNull field', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: JsonNull } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "JsonNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - DbNull field', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: DbNull } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "DbNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - AnyNull field', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: AnyNull } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "AnyNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

function makeCrossBundleNullValue(name: string) {
  const value = Object.create(null)
  value[Symbol.for('prisma.objectEnumValue')] = true
  value._getName = () => name
  value._getNamespace = () => 'NullTypes'
  return value
}

test('args - cross-bundle DbNull serializes correctly', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: makeCrossBundleNullValue('DbNull') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "DbNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - cross-bundle JsonNull serializes correctly', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: makeCrossBundleNullValue('JsonNull') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "JsonNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - cross-bundle AnyNull serializes correctly', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { jsonColumn: makeCrossBundleNullValue('AnyNull') } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "jsonColumn": {
              "$type": "Enum",
              "value": "AnyNull"
            }
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('args - array', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { favoriteNumbers: [1, 23, 45, 67] } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "favoriteNumbers": [
              1,
              23,
              45,
              67
            ]
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('1 level include', () => {
  expect(serialize({ modelName: 'User', action: 'findMany', args: { include: { posts: true } } }))
    .toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test('include with arguments', () => {
  expect(
    serialize({ modelName: 'User', action: 'findMany', args: { include: { posts: { where: { published: true } } } } }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {
              "where": {
                "published": true
              }
            },
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test('multiple level include', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { include: { posts: { include: { attachments: true } } } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true,
              "attachments": {
                "arguments": {},
                "selection": {
                  "$composites": true,
                  "$scalars": true
                }
              }
            }
          }
        }
      }
    }"
  `)
})

test('explicit selection', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { title: true, posts: true } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "title": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test('explicit nested selection', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { name: true, posts: { select: { attachments: { select: { fileName: true } } } } } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "name": true,
          "posts": {
            "arguments": {},
            "selection": {
              "attachments": {
                "arguments": {},
                "selection": {
                  "fileName": true
                }
              }
            }
          }
        }
      }
    }"
  `)
})

test('explicit nested selection with arguments', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { name: true, posts: { where: { published: true } } } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "name": true,
          "posts": {
            "arguments": {
              "where": {
                "published": true
              }
            },
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test('mixed include and select', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { name: true, posts: { include: { attachments: true } } } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "name": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true,
              "attachments": {
                "arguments": {},
                "selection": {
                  "$composites": true,
                  "$scalars": true
                }
              }
            }
          }
        }
      }
    }"
  `)
})

test('explicit selection with extension', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { id: true, fullName: true } },
      extensions: MergedExtensionsList.single({
        result: {
          user: {
            fullName: {
              needs: { name: true },
              compute: jest.fn(),
            },
          },
        },
      }),
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "id": true,
          "name": true
        }
      }
    }"
  `)
})

test('explicit selection shadowing a field', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { id: true, name: true } },
      extensions: MergedExtensionsList.single({
        result: {
          user: {
            name: {
              needs: { name: true },
              compute: jest.fn(),
            },
          },
        },
      }),
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "id": true,
          "name": true
        }
      }
    }"
  `)
})

test('omit', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { omit: { name: true } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "name": false
        }
      }
    }"
  `)
})

test('omit(false)', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { omit: { name: false } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "name": true
        }
      }
    }"
  `)
})

test('omit + include', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { include: { posts: true }, omit: { name: true } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          },
          "name": false
        }
      }
    }"
  `)
})

test('nested omit', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { include: { posts: { omit: { title: true } } } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true,
              "title": false
            }
          }
        }
      }
    }"
  `)
})

test('exclusion with extension', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { omit: { name: true } },
      extensions: MergedExtensionsList.single({
        result: {
          user: {
            fullName: {
              needs: { name: true },
              compute: jest.fn(),
            },
          },
        },
      }),
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test('exclusion with extension while excluding computed field too', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { omit: { name: true, fullName: true } },
      extensions: MergedExtensionsList.single({
        result: {
          user: {
            fullName: {
              needs: { name: true },
              compute: jest.fn(),
            },
          },
        },
      }),
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "name": false
        }
      }
    }"
  `)
})

test('globalOmit', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      globalOmit: {
        user: {
          name: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "name": false
        }
      }
    }"
  `)
})

test('globalOmit + local omit', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: {
        omit: {
          name: false,
        },
      },
      globalOmit: {
        user: {
          name: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "name": true
        }
      }
    }"
  `)
})

test('globalOmit + local select', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: {
        select: {
          name: true,
        },
      },
      globalOmit: {
        user: {
          name: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "name": true
        }
      }
    }"
  `)
})

test('nested globalOmit (include)', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { include: { posts: true } },
      globalOmit: {
        post: {
          title: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true,
              "title": false
            }
          }
        }
      }
    }"
  `)
})

test('nested globalOmit (select)', () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { select: { posts: true } },
      globalOmit: {
        post: {
          title: true,
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true,
              "title": false
            }
          }
        }
      }
    }"
  `)
})

test(`Prisma.skip in arguments`, () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: skip },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {},
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test(`Prisma.skip in input object fields`, () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name: 'Steve', occupation: skip } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "Steve"
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true
        }
      }
    }"
  `)
})

test(`Prisma.skip in include`, () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name: 'Steve' }, include: { posts: true, profile: skip } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "Steve"
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true,
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test(`Prisma.skip in select`, () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name: 'Steve' }, select: { posts: true, profile: skip } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "Steve"
          }
        },
        "selection": {
          "posts": {
            "arguments": {},
            "selection": {
              "$composites": true,
              "$scalars": true
            }
          }
        }
      }
    }"
  `)
})

test(`Prisma.skip in omit`, () => {
  expect(
    serialize({
      modelName: 'User',
      action: 'findMany',
      args: { where: { name: 'Steve' }, omit: { password: true, name: skip } },
    }),
  ).toMatchInlineSnapshot(`
    "{
      "modelName": "User",
      "action": "findMany",
      "query": {
        "arguments": {
          "where": {
            "name": "Steve"
          }
        },
        "selection": {
          "$composites": true,
          "$scalars": true,
          "password": false
        }
      }
    }"
  `)
})
