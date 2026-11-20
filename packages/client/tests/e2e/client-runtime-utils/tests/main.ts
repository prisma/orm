import {
  AnyNull,
  DbNull,
  Decimal,
  isAnyNull,
  isDbNull,
  isJsonNull,
  JsonNull,
  PrismaClientValidationError,
} from '@prisma/client-runtime-utils'

import { Prisma as PrismaBrowser } from '../generated/prisma/browser'
import { Prisma } from '../generated/prisma/client'

test('can use null types from client-runtime-utils', () => {
  const _create: Prisma.UserCreateInput = {
    data: DbNull,
  }

  let dbNull = DbNull
  dbNull = Prisma.DbNull
  dbNull = PrismaBrowser.DbNull
  expect(dbNull).toEqual(DbNull)

  let jsonNull = JsonNull
  jsonNull = Prisma.JsonNull
  jsonNull = PrismaBrowser.JsonNull
  expect(jsonNull).toEqual(JsonNull)

  let anyNull = AnyNull
  anyNull = Prisma.AnyNull
  anyNull = PrismaBrowser.AnyNull
  expect(anyNull).toEqual(AnyNull)

  expect(DbNull).toEqual(Prisma.DbNull)
  expect(JsonNull).toEqual(Prisma.JsonNull)
  expect(AnyNull).toEqual(Prisma.AnyNull)

  expect(DbNull).toEqual(PrismaBrowser.DbNull)
  expect(JsonNull).toEqual(PrismaBrowser.JsonNull)
  expect(AnyNull).toEqual(PrismaBrowser.AnyNull)

  expect(isDbNull(DbNull)).toBe(true)
  expect(isJsonNull(JsonNull)).toBe(true)
  expect(isAnyNull(AnyNull)).toBe(true)

  expect(isDbNull(Prisma.DbNull)).toBe(true)
  expect(isJsonNull(Prisma.JsonNull)).toBe(true)
  expect(isAnyNull(Prisma.AnyNull)).toBe(true)

  expect(isDbNull(PrismaBrowser.DbNull)).toBe(true)
  expect(isJsonNull(PrismaBrowser.JsonNull)).toBe(true)
  expect(isAnyNull(PrismaBrowser.AnyNull)).toBe(true)

  // Test against false positives
  expect(isDbNull(AnyNull)).toBe(false)
  expect(isJsonNull(AnyNull)).toBe(false)
  expect(isAnyNull(DbNull)).toBe(false)
})

test('can use error types from client-runtime-utils', () => {
  const error: Prisma.PrismaClientValidationError = new PrismaClientValidationError('test error', {
    clientVersion: '0.0.0',
  })
  expect(error).toBeInstanceOf(PrismaClientValidationError)
  expect(error).toBeInstanceOf(Prisma.PrismaClientValidationError)
})

test('can use decimal from client-runtime-utils', () => {
  const _create: Prisma.UserCreateInput = {
    num: Decimal('1.23'),
  }
})

export {}
