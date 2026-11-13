import testMatrix from './_matrix'

// @ts-ignore this is just for type checks
declare let prisma: import('./generated/prisma/client').PrismaClient

// Doubles whose shortest round-trip form needs 17 significant digits.
const values = [
  25.900000000000002, 0.30000000000000004, 1.0000000000000002, 2.2250738585072014e-308, 123456.78901234567,
]

// https://github.com/prisma/orm/issues/30976
testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.probe.deleteMany()
    })

    test('Json doubles are stored exactly when a raw query comes first in a batch', async () => {
      await prisma.$transaction([
        prisma.$executeRaw`SELECT 1`,
        ...values.map((a, id) => prisma.probe.create({ data: { id, data: { a } } })),
      ])

      const rows = await prisma.probe.findMany({ orderBy: { id: 'asc' } })
      expect(rows.map((row) => (row.data as { a: number }).a)).toEqual(values)
    })

    test('a batch with the same shape and other values does not reuse the first values', async () => {
      const batch = (data: number[]) =>
        prisma.$transaction([
          prisma.$executeRaw`SELECT 1`,
          ...data.map((a, id) => prisma.probe.create({ data: { id, data: { a } } })),
        ])
      const other = values.map((a) => -a)

      await batch(values)
      await prisma.probe.deleteMany()
      await batch(other)

      const rows = await prisma.probe.findMany({ orderBy: { id: 'asc' } })
      expect(rows.map((row) => (row.data as { a: number }).a)).toEqual(other)
    })

    test('Json doubles are stored exactly when a model query comes first in a batch', async () => {
      await prisma.$transaction([
        ...values.map((a, id) => prisma.probe.create({ data: { id, data: { a } } })),
        prisma.$executeRaw`SELECT 1`,
      ])

      const rows = await prisma.probe.findMany({ orderBy: { id: 'asc' } })
      expect(rows.map((row) => (row.data as { a: number }).a)).toEqual(values)
    })
  },
  {
    optOut: {
      from: ['sqlite', 'mongodb', 'sqlserver', 'cockroachdb', 'mysql'],
      reason: 'The bug is in the client and PostgreSQL stores the doubles exactly; see _matrix.ts.',
    },
  },
)
