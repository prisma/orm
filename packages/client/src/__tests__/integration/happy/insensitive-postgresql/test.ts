import { getTestClient } from '../../../../utils/getTestClient'
import type { SetupParams } from '../../../../utils/setupPostgres'
import { setupPostgres, tearDownPostgres } from '../../../../utils/setupPostgres'

test('insensitive-postgresql', async () => {
  const PrismaClient = await getTestClient()
  const connectionString = process.env.TEST_POSTGRES_URI!.replace('tests', 'tests-insensitive-postgresql')

  const SetupParams: SetupParams = {
    connectionString: connectionString,
    dirname: __dirname,
  }

  await setupPostgres(SetupParams).catch((e) => console.error(e))

  const prisma = new PrismaClient()

  const defaultResult = await prisma.user.findMany({
    where: {
      email: {
        contains: 'a@a.de',
        mode: 'default',
      },
    },
    select: {
      email: true,
      name: true,
    },
  })
  expect(defaultResult).toEqual([
    {
      email: 'a@a.de',
      name: 'alice',
    },
  ])

  const insensitiveResult = await prisma.user.findMany({
    where: {
      email: {
        contains: 'a@a.de',
        mode: 'insensitive',
      },
    },
  })

  expect(insensitiveResult).toEqual([
    {
      email: 'a@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd91',
      name: 'alice',
    },
    {
      email: 'A@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd92',
      name: 'Alice',
    },
    {
      email: 'A@A.DE',
      id: '576eddf9-2434-421f-9a86-58bede16fd93',
      name: 'ALICE',
    },
    {
      email: 'a@A.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd94',
      name: 'AliCe',
    },
    {
      email: 'a@a.De',
      id: '576eddf9-2434-421f-9a86-58bede16fd95',
      name: 'AlIce',
    },
    {
      email: 'A@a.dE',
      id: '576eddf9-2434-421f-9a86-58bede16fd96',
      name: 'alicE',
    },
  ])

  const defaultStartsWithResult = await prisma.user.findMany({
    where: {
      email: {
        startsWith: 'a@',
        mode: 'default',
      },
    },
  })
  expect(defaultStartsWithResult).toEqual([
    {
      email: 'a@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd91',
      name: 'alice',
    },
    {
      email: 'a@A.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd94',
      name: 'AliCe',
    },
    {
      email: 'a@a.De',
      id: '576eddf9-2434-421f-9a86-58bede16fd95',
      name: 'AlIce',
    },
  ])

  const insensitiveStartsWithResult = await prisma.user.findMany({
    where: {
      email: {
        startsWith: 'a@',
        mode: 'insensitive',
      },
    },
  })
  expect(insensitiveStartsWithResult).toEqual([
    {
      email: 'a@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd91',
      name: 'alice',
    },
    {
      email: 'A@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd92',
      name: 'Alice',
    },
    {
      email: 'A@A.DE',
      id: '576eddf9-2434-421f-9a86-58bede16fd93',
      name: 'ALICE',
    },
    {
      email: 'a@A.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd94',
      name: 'AliCe',
    },
    {
      email: 'a@a.De',
      id: '576eddf9-2434-421f-9a86-58bede16fd95',
      name: 'AlIce',
    },
    {
      email: 'A@a.dE',
      id: '576eddf9-2434-421f-9a86-58bede16fd96',
      name: 'alicE',
    },
  ])

  const defaultEndsWithResult = await prisma.user.findMany({
    where: {
      email: {
        endsWith: 'DE',
        mode: 'default',
      },
    },
  })
  expect(defaultEndsWithResult).toEqual([
    {
      email: 'A@A.DE',
      id: '576eddf9-2434-421f-9a86-58bede16fd93',
      name: 'ALICE',
    },
  ])

  const insensitiveEndsWithResult = await prisma.user.findMany({
    where: {
      email: {
        endsWith: 'DE',
        mode: 'insensitive',
      },
    },
  })
  expect(insensitiveEndsWithResult).toEqual([
    {
      email: 'a@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd91',
      name: 'alice',
    },
    {
      email: 'A@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd92',
      name: 'Alice',
    },
    {
      email: 'A@A.DE',
      id: '576eddf9-2434-421f-9a86-58bede16fd93',
      name: 'ALICE',
    },
    {
      email: 'a@A.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd94',
      name: 'AliCe',
    },
    {
      email: 'a@a.De',
      id: '576eddf9-2434-421f-9a86-58bede16fd95',
      name: 'AlIce',
    },
    {
      email: 'A@a.dE',
      id: '576eddf9-2434-421f-9a86-58bede16fd96',
      name: 'alicE',
    },
  ])

  const standardResult = await prisma.user.findMany({
    where: {
      email: {
        contains: 'a@a.de',
      },
    },
  })
  expect(standardResult).toEqual([
    {
      email: 'a@a.de',
      id: '576eddf9-2434-421f-9a86-58bede16fd91',
      name: 'alice',
    },
  ])

  await prisma.$disconnect()
  await tearDownPostgres(SetupParams.connectionString).catch((e) => {
    console.log(e)
  })
})
