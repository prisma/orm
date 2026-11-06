import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

// https://github.com/prisma/orm/issues/30443
testMatrix.setupTestSuite(() => {
  // Each value sits next to its 16-significant-digit rounding, a different double, so a write or
  // filter that rounds makes the two rows indistinguishable. Comparing in the database rather than
  // reading values back keeps PostgreSQL < 12's float output rounding out of the picture.
  const values = [65333601047007986000, -65333601047007986000, 1.5430800568907436e25]
  const rounded = values.map((value) => Number(value.toPrecision(16)))

  beforeEach(async () => {
    await prisma.floats.deleteMany()
  })

  test('create and filters keep integer-valued floats outside the Int range exact', async () => {
    for (const value of [...values, ...rounded]) {
      await prisma.floats.create({ data: { value } })
    }

    for (const value of [...values, ...rounded]) {
      await expect(prisma.floats.count({ where: { value } })).resolves.toBe(1)
    }
    await expect(prisma.floats.count({ where: { value: { in: values } } })).resolves.toBe(values.length)
  })

  test('createMany and update keep integer-valued floats outside the Int range exact', async () => {
    await prisma.floats.createMany({ data: rounded.map((value) => ({ value })) })
    const { id } = await prisma.floats.create({ data: { value: 0 } })

    await prisma.floats.update({ where: { id }, data: { value: values[0] } })

    await expect(prisma.floats.count({ where: { id, value: values[0] } })).resolves.toBe(1)
    await expect(prisma.floats.count({ where: { value: rounded[0] } })).resolves.toBe(1)
  })
})
