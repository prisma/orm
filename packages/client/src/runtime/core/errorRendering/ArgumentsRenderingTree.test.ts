import { DbNull, Decimal, JsonNull } from '@prisma/client-runtime-utils'
import { Writer } from '@prisma/ts-builders'

import { FieldRefImpl } from '../model/FieldRef'
import { ArgumentsRenderingTree, buildArgumentsRenderingTree } from './ArgumentsRenderingTree'
import { inactiveColors } from './base'
import { ObjectValue } from './ObjectValue'

function printTree(tree: ArgumentsRenderingTree) {
  const writer = new Writer(0, { colors: inactiveColors })
  return writer.write(tree).toString()
}

test('basic', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: { gt: 100 } },
    select: {
      field: true,
    },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: {
          gt: 100
        }
      },
      select: {
        field: true
      }
    }"
  `)
})

test('null', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: null },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: null
      }
    }"
  `)
})

test('undefined', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: undefined },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: undefined
      }
    }"
  `)
})

test('Decimal', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: new Decimal('123.4') },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: new Prisma.Decimal("123.4")
      }
    }"
  `)
})

test('Buffer', () => {
  const tree = buildArgumentsRenderingTree({
    where: { bin: Buffer.from('hello') },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        bin: Buffer.alloc(5)
      }
    }"
  `)
})

test('Uint8Array', () => {
  const tree = buildArgumentsRenderingTree({
    where: { bin: Uint8Array.from([12, 34, 56]) },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        bin: new Uint8Array(3)
      }
    }"
  `)
})

test('Date', () => {
  const tree = buildArgumentsRenderingTree({
    where: { createdAt: new Date('1999-01-11T12:30:45Z') },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        createdAt: new Date("1999-01-11T12:30:45.000Z")
      }
    }"
  `)
})

test('DbNull', () => {
  const tree = buildArgumentsRenderingTree({
    where: { json: DbNull },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        json: Prisma.DbNull
      }
    }"
  `)
})

test('JsonNull', () => {
  const tree = buildArgumentsRenderingTree({
    where: { json: JsonNull },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        json: Prisma.JsonNull
      }
    }"
  `)
})

test('AnyNull', () => {
  const tree = buildArgumentsRenderingTree({
    where: { json: JsonNull },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        json: Prisma.JsonNull
      }
    }"
  `)
})

test('FieldRef', () => {
  const tree = buildArgumentsRenderingTree({
    where: { field: new FieldRefImpl('User', 'someField', 'Int', false, false) },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        field: prisma.user.$fields.someField
      }
    }"
  `)
})

test('non serializable value empty list', () => {
  const tree = buildArgumentsRenderingTree({
    where: { something: Symbol('foo') },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        something: [object Symbol]
      }
    }"
  `)
})

test('BigInt', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: { gt: 100n } },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: {
          gt: 100n
        }
      }
    }"
  `)
})

test('list', () => {
  const tree = buildArgumentsRenderingTree({
    where: { list: [1, 2, 3] },
  })

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        list: [
          1,
          2,
          3
        ]
      }
    }"
  `)
})

test('error in top level field', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: { gt: 100 } },
    select: {
      field: true,
    },
  })

  tree.arguments.getField('select')?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: {
          gt: 100
        }
      },
      select: {
      ~~~~~~
        field: true
      }
    }"
  `)
})

test('error in nested selection', () => {
  const tree = buildArgumentsRenderingTree({
    where: { amount: { gt: 100 } },
    select: {
      field1: {
        include: {
          field2: {
            select: {
              field3: {
                arg: 1,
              },
            },
          },
        },
      },
    },
  })

  ;(tree.arguments.getDeepSubSelectionValue(['field1', 'field2', 'field3']) as ObjectValue)
    .getField('arg')
    ?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        amount: {
          gt: 100
        }
      },
      select: {
        field1: {
          include: {
            field2: {
              select: {
                field3: {
                  arg: 1
                  ~~~
                }
              }
            }
          }
        }
      }
    }"
  `)
})

test('error in scalar argument', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: 'one' },
  })

  tree.arguments.getDeepFieldValue(['where', 'id'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: "one"
            ~~~~~
      }
    }"
  `)
})

test('error in object argument', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: { foo: 'bar', baz: 'qux' } },
  })

  tree.arguments.getDeepFieldValue(['where', 'id'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: {
          foo: "bar",
          baz: "qux"
        }
        ~~~~~~~~~~~~
      }
    }"
  `)
})

test('error in empty object argument', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: {} },
  })

  tree.arguments.getDeepFieldValue(['where', 'id'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: {}
            ~~
      }
    }"
  `)
})

test('error in deeply nested object argument', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: { foo: { bar: { baz: 'qux' } } } },
  })

  tree.arguments.getDeepFieldValue(['where', 'id', 'foo', 'bar'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: {
          foo: {
            bar: {
              baz: "qux"
            }
            ~~~~~~~~~~~~
          }
        }
      }
    }"
  `)
})

test('error in array argument', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: [12, 34, 5678, 'hello'] },
  })

  tree.arguments.getDeepFieldValue(['where', 'id'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: [
          12,
          34,
          5678,
          "hello"
        ]
        ~~~~~~~~~
      }
    }"
  `)
})

test('error in empty array', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: [] },
  })

  tree.arguments.getDeepFieldValue(['where', 'id'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: []
            ~~
      }
    }"
  `)
})

test('error in array element', () => {
  const tree = buildArgumentsRenderingTree({
    where: { id: ['hello'] },
  })

  tree.arguments.getDeepFieldValue(['where', 'id', '0'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        id: [
          "hello"
          ~~~~~~~
        ]
      }
    }"
  `)
})

test('nested empty list', () => {
  const tree = buildArgumentsRenderingTree({
    where: { AND: [[]] },
  })

  tree.arguments.getDeepFieldValue(['where', 'AND'])?.markAsError()

  expect(printTree(tree)).toMatchInlineSnapshot(`
    "{
      where: {
        AND: [
          []
        ]
        ~~~~
      }
    }"
  `)
})
