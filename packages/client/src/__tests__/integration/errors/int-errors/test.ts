import { generateTestClient } from '../../../../utils/getTestClient'
import type { SetupParams } from '../../../../utils/setupMysql'
import { setupMysql, tearDownMysql } from '../../../../utils/setupMysql'

describe('int-errors', () => {
  let prisma
  let SetupParams: SetupParams

  beforeAll(async () => {
    await generateTestClient()
    const { PrismaClient } = require('./node_modules/@prisma/client')
    let connectionString = process.env.TEST_MYSQL_URI

    connectionString += '-signed-int'

    SetupParams = {
      connectionString: connectionString,
      dirname: __dirname,
    }

    await setupMysql(SetupParams).catch((e) => console.error(e))

    prisma = new PrismaClient({
      errorFormat: 'minimal',
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()

    await tearDownMysql(SetupParams.connectionString).catch((e) => {
      console.log(e)
    })
  })

  test('char-int', async () => {
    try {
      await prisma.user.update({
        where: { id: '576eddf9-2434-421f-9a86-58bede16fd95' },
        data: {
          age: 'thisisastringwith30characters',
        },
      })
      expect(1).toEqual(0) //should never reach.
    } catch (e) {
      expect(e).toMatchSnapshot()
    }
  })

  test('overflow-int', async () => {
    try {
      await prisma.user.update({
        where: { id: '576eddf9-2434-421f-9a86-58bede16fd95' },
        data: {
          age: 999,
        },
      })
      expect(1).toEqual(0) //should never reach.
    } catch (e) {
      expect(e).toMatchSnapshot()
    }
  })

  test('signed-int', async () => {
    try {
      await prisma.user.update({
        where: { id: '576eddf9-2434-421f-9a86-58bede16fd95' },
        data: {
          age: -999,
        },
      })
      expect(1).toEqual(0) //should never reach.
    } catch (e) {
      expect(e).toMatchSnapshot()
    }
  })
})
