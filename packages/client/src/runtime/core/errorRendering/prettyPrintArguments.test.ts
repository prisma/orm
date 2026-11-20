import { Decimal } from '@prisma/client-runtime-utils'

import { FieldRefImpl } from '../model/FieldRef'
import { prettyPrintArguments } from './prettyPrintArguments'

test('undefined args', () => {
  expect(prettyPrintArguments()).toBe('')
})

test('defined args', () => {
  expect(
    prettyPrintArguments({
      string: 'hello',
      number: 123,
      bigint: 123n,
      bool: true,
      decimal: new Decimal('12.3'),
      date: new Date('2020-12-12T12:00:00.000Z'),
      fieldRef: new FieldRefImpl('User', 'field', 'Int', false, false),
    }),
  ).toMatchInlineSnapshot(`
    "{
      string: "hello",
      number: 123,
      bigint: 123n,
      bool: true,
      decimal: new Prisma.Decimal("12.3"),
      date: new Date("2020-12-12T12:00:00.000Z"),
      fieldRef: prisma.user.$fields.field
    }"
  `)
})
