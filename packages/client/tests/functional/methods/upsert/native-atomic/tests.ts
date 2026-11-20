import { faker } from '@faker-js/faker'

import { waitFor } from '../../../_utils/tests/waitFor'
import { NewPrismaClient } from '../../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

class UpsertChecker {
  private logs: string[]

  constructor(client: PrismaClient) {
    this.logs = []
    this.captureLogs(client)
  }

  captureLogs(client: PrismaClient) {
    // @ts-expect-error
    client.$on('query', (data) => {
      if ('query' in data) {
        // @ts-expect-error
        this.logs.push(data.query)
      }
    })
  }

  async expectUsedNativeUpsert(didUse: boolean) {
    await waitFor(() => {
      expect(this.logs.some((log) => log.includes('ON CONFLICT'))).toBe(didUse)
    })

    this.reset()
  }

  reset() {
    this.logs = []
  }
}

testMatrix.setupTestSuite(
  () => {
    let client: PrismaClient

    beforeAll(() => {
      client = newPrismaClient({
        log: [
          {
            emit: 'event',
            level: 'query',
          },
        ],
      })
    })

    afterEach(async () => {
      await client.post.deleteMany()
      await client.user.deleteMany()
      await client.compound.deleteMany()
    })

    test('should only use ON CONFLICT when update arguments do not have any nested queries', async () => {
      const name = faker.person.firstName()
      const title = faker.person.jobTitle()
      const title2 = faker.person.jobTitle()

      await client.user.create({
        data: {
          name,
          posts: {
            create: {
              title,
            },
          },
        },
      })

      const checker = new UpsertChecker(client)

      // This will 'not' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name,
          // Because this is a nested mutation
          posts: {
            upsert: {
              where: { title },
              create: { title },
              update: { title },
            },
          },
        },
      })
      await checker.expectUsedNativeUpsert(false)

      // This will 'not' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name,
          // Because this is a nested mutation
          posts: {
            create: {
              title: title2,
            },
          },
        },
      })
      await checker.expectUsedNativeUpsert(false)

      // This will 'not' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name,
          // Because this is a nested mutation
          posts: {
            update: {
              where: {
                title,
              },
              data: {
                title: `${title}-updated`,
              },
            },
          },
        },
      })

      await checker.expectUsedNativeUpsert(false)

      // This will 'not' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name,
          // Because this is a nested mutation
          posts: {
            delete: {
              title: title2,
            },
          },
        },
      })
      await checker.expectUsedNativeUpsert(false)

      // This 'will' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name,
          // Because there is no nested mutation
        },
      })

      await checker.expectUsedNativeUpsert(true)
    })

    test('should only use ON CONFLICT when there is only 1 unique field in the where clause', async () => {
      const name = faker.person.firstName()

      const checker = new UpsertChecker(client)

      // This was previously failing before extendedWhereUnique went GA
      // Now it doesn't use ON CONFLICT like expected.
      await client.user.upsert({
        where: {
          // Because two unique fields are used
          id: '1',
          name,
        },
        create: {
          name,
        },
        update: {
          name,
        },
      })
      await checker.expectUsedNativeUpsert(false)

      // This 'will' use ON CONFLICT
      await client.user.upsert({
        where: {
          // Because only one unique field is used
          name,
        },
        create: {
          name,
        },
        update: {
          name,
        },
      })
      await checker.expectUsedNativeUpsert(true)
    })

    test('should only use ON CONFLICT when the unique field defined in where clause has the same value as defined in the create arguments', async () => {
      const name = faker.person.firstName()

      const checker = new UpsertChecker(client)

      // This will 'not' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          // Because the where 'name' is 'not' equal to the create 'name'
          name: name + '1',
        },
        update: {
          name: name + '1',
        },
      })

      await checker.expectUsedNativeUpsert(false)

      // This 'will' use ON CONFLICT
      await client.user.upsert({
        where: {
          name,
        },
        create: {
          // Because the where 'name' is 'equal' to the create 'name'
          name,
        },
        update: {
          name: name + '1',
        },
      })

      await checker.expectUsedNativeUpsert(true)
    })

    test('should perform an upsert using ON CONFLICT', async () => {
      const name = faker.person.firstName()

      const checker = new UpsertChecker(client)

      const user = await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name: `${name}-updated`,
        },
      })

      expect(user.name).toEqual(name)

      await checker.expectUsedNativeUpsert(true)

      const userUpdated = await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name: `${name}-updated`,
        },
      })

      expect(userUpdated.name).toEqual(`${name}-updated`)
      await checker.expectUsedNativeUpsert(true)
    })

    test('should perform an upsert using ON CONFLICT with id', async () => {
      const name = faker.person.firstName()

      const checker = new UpsertChecker(client)

      const user = await client.user.upsert({
        where: {
          id: '1',
        },
        create: {
          id: '1',
          name,
        },
        update: {
          name: `${name}-updated`,
        },
      })

      expect(user.name).toEqual(name)

      await checker.expectUsedNativeUpsert(true)

      const userUpdated = await client.user.upsert({
        where: {
          name,
        },
        create: {
          name,
        },
        update: {
          name: `${name}-updated`,
        },
      })

      expect(userUpdated.name).toEqual(`${name}-updated`)
      await checker.expectUsedNativeUpsert(true)
    })

    test('should perform an upsert using ON CONFLICT with compound id', async () => {
      const checker = new UpsertChecker(client)

      let compound = await client.compound.upsert({
        where: {
          id1_id2: {
            id1: 1,
            id2: '1',
          },
        },
        create: {
          id1: 1,
          id2: '1',
          field1: 2,
          field2: '2',
          val: 1,
        },
        update: {
          val: 2,
        },
      })

      expect(compound.val).toEqual(1)

      await checker.expectUsedNativeUpsert(true)

      compound = await client.compound.upsert({
        where: {
          id1_id2: {
            id1: 1,
            id2: '1',
          },
        },
        create: {
          id1: 1,
          id2: '1',
          field1: 2,
          field2: '2',
          val: 1,
        },
        update: {
          val: 2,
        },
      })

      expect(compound.val).toEqual(2)
      await checker.expectUsedNativeUpsert(true)
    })

    test('should perform an upsert using ON CONFLICT with compound uniques', async () => {
      const checker = new UpsertChecker(client)

      let compound = await client.compound.upsert({
        where: {
          uniques: {
            field1: 2,
            field2: '2',
          },
        },
        create: {
          id1: 1,
          id2: '1',
          field1: 2,
          field2: '2',
          val: 1,
        },
        update: {
          val: 2,
        },
      })

      expect(compound.val).toEqual(1)
      await checker.expectUsedNativeUpsert(true)

      compound = await client.compound.upsert({
        where: {
          uniques: {
            field1: 2,
            field2: '2',
          },
        },
        create: {
          id1: 1,
          id2: '1',
          field1: 2,
          field2: '2',
          val: 1,
        },
        update: {
          val: 2,
        },
      })

      expect(compound.val).toEqual(2)
      await checker.expectUsedNativeUpsert(true)
    })
  },
  {
    optOut: {
      from: ['mongodb', 'mysql', 'sqlserver'],
      reason: 'Other providers do not support native INSERT ... ON CONFLICT SET .. WHERE',
    },
    skipDefaultClientInstance: true,
  },
)
