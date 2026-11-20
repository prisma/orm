import { describe, expect, test } from 'vitest'

import { isPrismaPostgres, isPrismaPostgresDev, PRISMA_POSTGRES_PROTOCOL } from './prismaPostgres'

describe('isPrismaPostgres', () => {
  test('returns false on invalid or non Prisma Postgres protocols', () => {
    expect(isPrismaPostgres()).toBe(false)
    expect(isPrismaPostgres('')).toBe(false)
    expect(isPrismaPostgres('mysql://database.url/test')).toBe(false)
    expect(isPrismaPostgres('prisma://database.url/test')).toBe(false)
  })

  test('returns true on valid Prisma Postgres protocols', () => {
    expect(isPrismaPostgres('prisma+postgres://database.url/test')).toBe(true)
    expect(isPrismaPostgres(`${PRISMA_POSTGRES_PROTOCOL}//database.url/test`)).toBe(true)
  })
})

describe('isPrismaPostgresDev', () => {
  test('returns false on invalid or non Prisma Postgres protocols', () => {
    expect(isPrismaPostgres()).toBe(false)
    expect(isPrismaPostgres('')).toBe(false)
    expect(isPrismaPostgres('mysql://database.url/test')).toBe(false)
    expect(isPrismaPostgres('prisma://database.url/test')).toBe(false)
  })

  test('returns false on valid Prisma Postgres protocols with non localhost host', () => {
    expect(isPrismaPostgresDev('prisma+postgres://database.url/test')).toBe(false)
    expect(isPrismaPostgresDev(`${PRISMA_POSTGRES_PROTOCOL}//database.url/test`)).toBe(false)
    expect(isPrismaPostgresDev('prisma+postgres://127.0.0.2:5432/test')).toBe(false)
  })

  test('returns true on valid Prisma Postgres protocols with localhost host', () => {
    expect(isPrismaPostgresDev('prisma+postgres://localhost:5432/test')).toBe(true)
    expect(isPrismaPostgresDev('prisma+postgres://127.0.0.1:5432/test')).toBe(true)
  })
})
