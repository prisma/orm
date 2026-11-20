import { Providers } from '../_utils/providers'
import { checkIfEmpty } from '../_utils/relationMode/checkIfEmpty'
import testMatrix from './_matrix'

/* eslint-disable @typescript-eslint/no-unused-vars */

// @ts-ignore this is just for type checks
declare let prisma: import('./generated/prisma/client').PrismaClient

// @ts-ignore
const describeIf = (condition: boolean) => (condition ? describe : describe.skip)

// m:n relation (MongoDB database)
async function createXPostsWith2CategoriesMongoDB({ count, postModel }) {
  const prismaPromises: any = []

  for (let i = 0; i < count; i++) {
    // We want to start at 1
    const id = (i + 1).toString()
    const prismaPromise = prisma[postModel].create({
      data: {
        id: id,
        categories: {
          create: [
            {
              id: `${id}-cat-a`,
            },
            {
              id: `${id}-cat-b`,
            },
          ],
        },
      },
      include: {
        categories: true,
      },
    })
    prismaPromises.push(prismaPromise)
  }

  return await prisma.$transaction(prismaPromises)
}

// If no change
const expectedFindManyPostModelIfNoChange = [
  {
    id: '1',
    published: null,
    categoryIDs: ['1-cat-a', '1-cat-b'],
  },
  {
    id: '2',
    published: null,
    categoryIDs: ['2-cat-a', '2-cat-b'],
  },
]
const expectedFindManyCategoryModelIfNoChange = [
  {
    id: '1-cat-a',
    published: null,
    postIDs: ['1'],
  },
  {
    id: '1-cat-b',
    published: null,
    postIDs: ['1'],
  },
  {
    id: '2-cat-a',
    published: null,
    postIDs: ['2'],
  },
  {
    id: '2-cat-b',
    published: null,
    postIDs: ['2'],
  },
]

testMatrix.setupTestSuite(
  (suiteConfig, suiteMeta) => {
    const isMongoDB = suiteConfig.provider === Providers.MONGODB
    const isSchemaUsingMap = suiteConfig.isSchemaUsingMap

    /**
     * m:n relationship
     */

    // We need to skip when isSchemaUsingMap is true because of
    // https://github.com/prisma/prisma/issues/15776
    // The tests are duplicated and running in ../relationMode-m-n-mongodb-failing-with-at-map
    describeIf(isMongoDB && isSchemaUsingMap === false)('m:n mandatory (explicit) - MongoDB', () => {
      const postModel = 'PostManyToMany'
      const categoryModel = 'CategoryManyToMany'

      beforeEach(async () => {
        const prismaPromises = [prisma[postModel].deleteMany(), prisma[categoryModel].deleteMany()]
        await prisma.$transaction(prismaPromises)
      })

      describe('[create]', () => {
        test('[create] category alone should succeed', async () => {
          await prisma[categoryModel].create({
            data: {
              id: '1',
            },
          })
          expect(await prisma[categoryModel].findMany()).toEqual([
            {
              id: '1',
              published: null,
              postIDs: [],
            },
          ])
        })

        test('[create] post alone should succeed', async () => {
          await prisma[postModel].create({
            data: {
              id: '1',
            },
          })
          expect(await prisma[postModel].findMany()).toEqual([
            {
              id: '1',
              published: null,
              categoryIDs: [],
            },
          ])
        })

        test('[create] create post [nested] [create] categories [nested] [create] category should succeed', async () => {
          await prisma[postModel].create({
            data: {
              id: '1',
              categories: {
                create: [
                  {
                    id: '1',
                  },
                ],
              },
            },
          })

          expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual([
            {
              id: '1',
              published: null,
              categoryIDs: ['1'],
            },
          ])
          expect(await prisma[categoryModel].findMany()).toEqual([
            {
              id: '1',
              published: null,
              postIDs: ['1'],
            },
          ])
        })
      })

      describe('[update]', () => {
        beforeEach(async () => {
          await checkIfEmpty(categoryModel, postModel)
          await createXPostsWith2CategoriesMongoDB({
            count: 2,
            postModel,
          })
        })

        // Note: it's not possible on MongoDB to mutate _id, it is immutable
        test('[update] id (_id) should throw at runtime because id field is read-only/immutable', async () => {
          await expect(
            prisma[postModel].update({
              where: {
                id: '1',
              },
              data: {
                // This would show a type error
                id: 'new id',
              },
            }),
            // Runtime error
          ).rejects.toThrow('Unknown argument `id`')

          expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual(
            expectedFindManyPostModelIfNoChange,
          )
          expect(
            await prisma[categoryModel].findMany({
              orderBy: { id: 'asc' },
            }),
          ).toEqual(expectedFindManyCategoryModelIfNoChange)
        })

        test('[update] (post) optional boolean field should succeed', async () => {
          await prisma[postModel].update({
            where: {
              id: '1',
            },
            data: {
              published: true,
            },
          })

          expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual([
            {
              id: '1',
              // The update
              published: true,
              categoryIDs: ['1-cat-a', '1-cat-b'],
            },
            {
              id: '2',
              published: null,
              categoryIDs: ['2-cat-a', '2-cat-b'],
            },
          ])
          expect(
            await prisma[categoryModel].findMany({
              orderBy: { id: 'asc' },
            }),
          ).toEqual(expectedFindManyCategoryModelIfNoChange)
        })

        test('[update] (category): optional boolean field should succeed', async () => {
          await prisma[categoryModel].update({
            where: {
              id: '1-cat-a',
            },
            data: {
              published: true,
            },
          })

          expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual(
            expectedFindManyPostModelIfNoChange,
          )
          expect(
            await prisma[categoryModel].findMany({
              orderBy: { id: 'asc' },
            }),
          ).toEqual([
            {
              id: '1-cat-a',
              // The update
              published: true,
              postIDs: ['1'],
            },
            {
              id: '1-cat-b',
              published: null,
              postIDs: ['1'],
            },
            {
              id: '2-cat-a',
              published: null,
              postIDs: ['2'],
            },
            {
              id: '2-cat-b',
              published: null,
              postIDs: ['2'],
            },
          ])
        })
      })

      describe('[delete]', () => {
        beforeEach(async () => {
          await checkIfEmpty(categoryModel, postModel)
          await createXPostsWith2CategoriesMongoDB({
            count: 2,
            postModel,
          })
        })

        // Note :Referential actions on two-way embedded many-to-many relations are not supported (schema validation error when added)
        // Which means everything has the same following behaviour:
        describe(`onDelete:`, () => {
          test('[delete] post should succeed', async () => {
            await prisma[postModel].delete({
              where: { id: '1' },
            })

            expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual([
              {
                id: '2',
                published: null,
                categoryIDs: ['2-cat-a', '2-cat-b'],
              },
            ])
            expect(
              await prisma[categoryModel].findMany({
                orderBy: { id: 'asc' },
              }),
            ).toEqual(expectedFindManyCategoryModelIfNoChange)
          })

          test('[delete] category should succeed', async () => {
            await prisma[categoryModel].delete({
              where: { id: '1-cat-a' },
            })

            expect(await prisma[postModel].findMany({ orderBy: { id: 'asc' } })).toEqual(
              expectedFindManyPostModelIfNoChange,
            )
            expect(
              await prisma[categoryModel].findMany({
                orderBy: { id: 'asc' },
              }),
            ).toEqual([
              {
                id: '1-cat-b',
                published: null,
                postIDs: ['1'],
              },
              {
                id: '2-cat-a',
                published: null,
                postIDs: ['2'],
              },
              {
                id: '2-cat-b',
                published: null,
                postIDs: ['2'],
              },
            ])
          })
        })
      })
    })
  },
  // Use `optOut` to opt out from testing the default selected providers
  // otherwise the suite will require all providers to be specified.
  {
    optOut: {
      from: [
        Providers.MONGODB,
        Providers.SQLSERVER,
        Providers.MYSQL,
        Providers.POSTGRESQL,
        Providers.COCKROACHDB,
        Providers.SQLITE,
      ],
      reason: 'Only testing xyz provider(s) so opting out of xxx',
    },
  },
)
