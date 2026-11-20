import { randomUUID } from 'crypto'

import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(() => {
  test('correctly handles a cursor with parameterised values', async () => {
    const connection_uuid = randomUUID()
    const query_ref = 'asdf'

    await prisma.listResult.createMany({
      data: [
        {
          connection_uuid,
          query_ref,
          result_index: 0,
        },
        {
          connection_uuid,
          query_ref,
          result_index: 1,
        },
        {
          connection_uuid,
          query_ref,
          result_index: 2,
        },
      ],
    })

    const results = await prisma.listResult.findMany({
      take: 5,
      skip: 0,
      where: {
        connection_uuid,
        query_ref,
      },
      select: {
        result_index: true,
      },
      orderBy: {
        result_index: 'asc',
      },
      cursor: {
        connection_uuid_query_ref_result_index: {
          connection_uuid,
          query_ref,
          result_index: 1,
        },
      },
    })

    expect(results).toEqual([
      {
        result_index: 1,
      },
      {
        result_index: 2,
      },
    ])
  })
})
