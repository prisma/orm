import { sql } from '@prisma/client-runtime-utils'
import path from 'path'

import { getTestClient } from '../../../../utils/getTestClient'
import { tearDownPostgres } from '../../../../utils/setupPostgres'
import { migrateDb } from '../../__helpers__/migrateDb'

let prisma

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.TEST_POSTGRES_URI!.replace('tests', 'tests-execute-raw-alter')
  await tearDownPostgres(process.env.DATABASE_URL)
  await migrateDb({
    schemaPath: path.join(__dirname, 'schema.prisma'),
  })
  const PrismaClient = await getTestClient()
  prisma = new PrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

test('executeRaw-alter-postgres', async () => {
  const password = 'prisma'
  // Should Throw
  try {
    await prisma.$executeRaw`ALTER USER prisma WITH PASSWORD '${password}'`
  } catch (err) {
    //isReadonlyArray
    expect(err).toMatchInlineSnapshot(`
      Running ALTER using prisma.$executeRaw\`<SQL>\` is not supported
      Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

      Example:
        await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

      More Information: https://pris.ly/d/execute-raw

    `)
  }
  try {
    await prisma.$executeRawUnsafe(`ALTER USER prisma WITH PASSWORD $1`, password)
  } catch (err) {
    // String
    expect(err).toMatchInlineSnapshot(`
      Running ALTER using prisma.$executeRawUnsafe(<SQL>, [...values]) is not supported
      Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

      Example:
        await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

      More Information: https://pris.ly/d/execute-raw

    `)
  }
  try {
    await prisma.$executeRaw(sql`ALTER USER prisma WITH PASSWORD '${password}'`)
  } catch (err) {
    // Else
    expect(err).toMatchInlineSnapshot(`
      Running ALTER using prisma.$executeRaw(sql\`<SQL>\`) is not supported
      Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

      Example:
        await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

      More Information: https://pris.ly/d/execute-raw

    `)
  }

  // Should Work
  const result = await prisma.$executeRawUnsafe(`ALTER USER prisma WITH PASSWORD '${password}'`)
  expect(result).toMatchInlineSnapshot(`0`)
})
