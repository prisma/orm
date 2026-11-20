import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

const describeIf = (condition: boolean) => (condition ? describe : describe.skip)

testMatrix.setupTestSuite(({ provider }) => {
  beforeAll(async () => {
    await prisma.testModel.createMany({
      data: [
        { value: 'foo bar baz' },
        { value: 'foo' },
        { value: 'baz' },
        { value: 'bar' },
        { value: '' },
        { value: 'completely different' },
      ],
    })
  })

  test('startsWith matches prefix', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { startsWith: 'foo' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual(['foo', 'foo bar baz'])
  })

  test('startsWith with no match', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { startsWith: 'xyz' } },
    })

    expect(results).toHaveLength(0)
  })

  test('startsWith with empty string matches all', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { startsWith: '' } },
    })

    expect(results).toHaveLength(6)
  })

  test('endsWith matches suffix', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { endsWith: 'baz' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual(['baz', 'foo bar baz'])
  })

  test('endsWith with no match', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { endsWith: 'xyz' } },
    })

    expect(results).toHaveLength(0)
  })

  test('endsWith with empty string matches all', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { endsWith: '' } },
    })

    expect(results).toHaveLength(6)
  })

  test('contains matches substring', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { contains: 'bar' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.value)).toEqual(['bar', 'foo bar baz'])
  })

  test('contains with no match', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { contains: 'xyz' } },
    })

    expect(results).toHaveLength(0)
  })

  test('contains with empty string matches all', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { contains: '' } },
    })

    expect(results).toHaveLength(6)
  })

  test('combined startsWith + endsWith', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { startsWith: 'foo', endsWith: 'baz' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].value).toBe('foo bar baz')
  })

  test('combined startsWith + contains', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { startsWith: 'foo', contains: 'bar' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].value).toBe('foo bar baz')
  })

  test('combined contains + endsWith', async () => {
    const results = await prisma.testModel.findMany({
      where: { value: { contains: 'bar', endsWith: 'baz' } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].value).toBe('foo bar baz')
  })

  test('NOT startsWith', async () => {
    const results = await prisma.testModel.findMany({
      where: { NOT: { value: { startsWith: 'foo' } } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(4)
    expect(results.map((r) => r.value)).toEqual(['', 'bar', 'baz', 'completely different'])
  })

  test('NOT contains', async () => {
    const results = await prisma.testModel.findMany({
      where: { NOT: { value: { contains: 'bar' } } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(4)
    expect(results.map((r) => r.value)).toEqual(['', 'baz', 'completely different', 'foo'])
  })

  test('NOT endsWith', async () => {
    const results = await prisma.testModel.findMany({
      where: { NOT: { value: { endsWith: 'baz' } } },
      orderBy: { value: 'asc' },
    })

    expect(results).toHaveLength(4)
    expect(results.map((r) => r.value)).toEqual(['', 'bar', 'completely different', 'foo'])
  })

  describeIf(provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.MONGODB)(
    'mode: insensitive',
    () => {
      beforeAll(async () => {
        await prisma.testModel.createMany({
          data: [{ value: 'FOO BAR BAZ' }, { value: 'Foo' }],
        })
      })

      test('contains case-insensitive', async () => {
        const results = await prisma.testModel.findMany({
          // @ts-test-if: provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.MONGODB
          where: { value: { contains: 'bar', mode: 'insensitive' } },
        })

        expect(results.map((r) => r.value).sort()).toEqual(['FOO BAR BAZ', 'bar', 'foo bar baz'])
      })

      test('startsWith case-insensitive', async () => {
        const results = await prisma.testModel.findMany({
          // @ts-test-if: provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.MONGODB
          where: { value: { startsWith: 'foo', mode: 'insensitive' } },
        })

        expect(results.map((r) => r.value).sort()).toEqual(['FOO BAR BAZ', 'Foo', 'foo', 'foo bar baz'])
      })

      test('endsWith case-insensitive', async () => {
        const results = await prisma.testModel.findMany({
          // @ts-test-if: provider === Providers.POSTGRESQL || provider === Providers.COCKROACHDB || provider === Providers.MONGODB
          where: { value: { endsWith: 'baz', mode: 'insensitive' } },
        })

        expect(results.map((r) => r.value).sort()).toEqual(['FOO BAR BAZ', 'baz', 'foo bar baz'])
      })
    },
  )
})
