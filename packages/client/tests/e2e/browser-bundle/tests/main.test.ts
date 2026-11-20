/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect, test } from 'vitest'

import { $Enums, Prisma, Role } from '../generated/prisma/browser'

test('can import enum from browser bundle', () => {
  // verify type imports work
  const a: Role = Role.ADMIN
  const b: $Enums.Role = Role.USER

  expect(Role).toEqual({
    USER: 'USER',
    ADMIN: 'ADMIN',
  })
})

test('can use decimal.js', () => {
  const num = Prisma.Decimal('15.345678912356765')
  expect(num.floor().toNumber()).toEqual(15)
})

test('can use utility types', () => {
  expect(typeof Prisma.DbNull).toEqual('object')
  expect(typeof Prisma.AnyNull).toEqual('object')
  expect(typeof Prisma.JsonNull).toEqual('object')
})

test('can access model names', () => {
  expect(Prisma.ModelName).toEqual({
    User: 'User',
  })
})

test('can use json utility types', () => {
  // verify json utility type imports work
  const a: Prisma.JsonValue = 56
  const b: Prisma.JsonObject = {
    a: 56,
  }
  const c: Prisma.JsonArray = [56, 56]
  const d: Prisma.InputJsonObject = { foo: 'bar' }
  const e: Prisma.InputJsonArray = ['foo']
  const f: Prisma.InputJsonValue = 56
})

export {}
