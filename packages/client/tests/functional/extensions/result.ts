import { faker } from '@faker-js/faker'
import { expectTypeOf } from 'expect-type'

import { AdapterProviders } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { Post, Prisma as PrismaNamespace, PrismaClient, User } from './generated/prisma/client'

declare let prisma: PrismaClient

const email = faker.internet.email()

function prismaWithExtension() {
  return prisma.$extends({
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
    },
  })
}

function prismaWithUserAndPostExtensions() {
  return prisma.$extends({
    result: {
      user: {
        fullName: {
          needs: { firstName: true, lastName: true },
          compute(user) {
            return `${user.firstName} ${user.lastName}`
          },
        },
      },
      post: {
        postLabel: {
          needs: { id: true },
          compute(post) {
            return `post-${post.id}`
          },
        },
      },
    },
  })
}

testMatrix.setupTestSuite(
  () => {
    beforeEach(async () => {
      await prisma.post.deleteMany()
      await prisma.user.deleteMany()
      const { id: userId } = await prisma.user.create({
        data: {
          email,
          firstName: 'John',
          lastName: 'Smith',
        },
      })

      await prisma.post.create({
        data: {
          user: { connect: { id: userId } },
        },
      })
    })

    test('findFirst', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.findFirst({})
      expect(user?.fullName).toBe('John Smith')
      expectTypeOf(user?.fullName).toEqualTypeOf<string | undefined>()
    })

    test('findFirst using $allModels', async () => {
      const xprisma = prisma.$extends({
        result: {
          $allModels: {
            computed: {
              compute: () => 123,
            },
          },
        },
      })

      const user = await xprisma.user.findFirst({})
      expect(user?.computed).toBe(123)
      expectTypeOf(user?.computed).toEqualTypeOf<number | undefined>()
    })

    test('findUnique', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.findUnique({ where: { email } })
      expect(user?.fullName).toBe('John Smith')
      expectTypeOf(user?.fullName).toEqualTypeOf<string | undefined>()
    })

    test('findMany', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.findMany({})
      expect(user[0].fullName).toBe('John Smith')
      expectTypeOf(user[0].fullName).toEqualTypeOf<string>()
    })

    test('create', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.create({
        data: {
          firstName: 'Max',
          lastName: 'Mustermann',
          email: faker.internet.email(),
        },
      })
      expect(user.fullName).toBe('Max Mustermann')
      expectTypeOf(user.fullName).toEqualTypeOf<string>()
    })

    test('update', async () => {
      const xprisma = prismaWithExtension()
      const user = await xprisma.user.update({
        where: { email },
        data: { firstName: 'Jane' },
      })

      expect(user.fullName).toBe('Jane Smith')
      expectTypeOf(user.fullName).toEqualTypeOf<string>()
    })

    test('upsert - update', async () => {
      const xprisma = prismaWithExtension()
      const user = await xprisma.user.upsert({
        where: { email },
        update: { firstName: 'Jane' },
        create: { email, firstName: 'Create', lastName: 'Shouldnothappen' },
      })

      expect(user.fullName).toBe('Jane Smith')
      expectTypeOf(user.fullName).toEqualTypeOf<string>()
    })

    test('upsert - create', async () => {
      const nonExistingEmail = faker.internet.email()
      const xprisma = prismaWithExtension()
      const user = await xprisma.user.upsert({
        where: { email: nonExistingEmail },
        update: { firstName: 'Update', lastName: 'Shouldnothappen' },
        create: { email: nonExistingEmail, firstName: 'Jane', lastName: 'Smith' },
      })

      expect(user.fullName).toBe('Jane Smith')
    })

    test('when using select', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.findFirst({
        select: {
          fullName: true,
        },
      })
      expect(user?.fullName).toBe('John Smith')
      expect(user).not.toHaveProperty('firstName')
      expect(user).not.toHaveProperty('lastName')
      expectTypeOf(user?.fullName).toEqualTypeOf<string | undefined>()
      expectTypeOf(user).not.toHaveProperty('firstName')
      expectTypeOf(user).not.toHaveProperty('lastName')
    })

    test('when using select and $allModels', async () => {
      const xprisma = prisma.$extends({
        result: {
          $allModels: {
            computed: {
              compute: () => 123,
            },
          },
        },
      })

      const user = await xprisma.user.findFirst({
        select: {
          id: true, // TODO: since computed field has no dependencies,
          // we need to query at least one non-computed field in order for query to succeed
          computed: true,
        },
      })
      expect(user?.computed).toBe(123)
      expectTypeOf(user?.computed).toEqualTypeOf<number | undefined>()
    })

    test('relationships: with include', async () => {
      const xprisma = prismaWithExtension()
      const post = await xprisma.post.findFirst({ include: { user: true } })

      expect(post?.user.fullName).toBe('John Smith')
      expectTypeOf(post?.user.fullName).toEqualTypeOf<string | undefined>()
    })

    test('relationships: with select', async () => {
      const xprisma = prismaWithExtension()
      const post = await xprisma.post.findFirst({ select: { user: true } })

      expect(post?.user.fullName).toBe('John Smith')
      expectTypeOf(post?.user.fullName).toEqualTypeOf<string | undefined>()
    })

    test('relationships: with deep select', async () => {
      const xprisma = prismaWithExtension()
      const post = await xprisma.post.findFirst({ select: { user: { select: { fullName: true } } } })

      expect(post?.user.fullName).toBe('John Smith')
      expectTypeOf(post?.user.fullName).toEqualTypeOf<string | undefined>()
    })

    test('relationships: mixed include and select', async () => {
      const xprisma = prismaWithExtension()
      const post = await xprisma.post.findFirst({ include: { user: { select: { fullName: true } } } })

      expect(post?.user.fullName).toBe('John Smith')
      expectTypeOf(post?.user.fullName).toEqualTypeOf<string | undefined>()
    })

    test('nested reads: include applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const user = await xprisma.user.findFirstOrThrow({
        include: {
          posts: true,
        },
      })

      expect(user.posts[0].postLabel).toBe(`post-${user.posts[0].id}`)
    })

    test('nested reads: select applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const user = await xprisma.user.findFirstOrThrow({
        select: {
          posts: {
            select: {
              postLabel: true,
            },
          },
        },
      })

      expect(user.posts[0].postLabel).toBeDefined()
    })

    test('nested writes (create): include applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const createdUser = await xprisma.user.create({
        data: {
          email: faker.internet.email(),
          firstName: 'Nested',
          lastName: 'Create',
          posts: {
            create: [{}],
          },
        },
        include: {
          posts: true,
        },
      })

      expect(createdUser.posts[0].postLabel).toBe(`post-${createdUser.posts[0].id}`)
    })

    test('nested writes (create): select applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const createdUser = await xprisma.user.create({
        data: {
          email: faker.internet.email(),
          firstName: 'Nested',
          lastName: 'Create',
          posts: {
            create: [{}],
          },
        },
        select: {
          posts: {
            select: {
              postLabel: true,
            },
          },
        },
      })

      expect(createdUser.posts[0].postLabel).toBeDefined()
    })

    test('nested writes (update): include applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const updatedUser = await xprisma.user.update({
        where: { email },
        data: {
          firstName: 'Nested Update',
          posts: {
            create: [{}],
          },
        },
        include: {
          posts: true,
        },
      })

      expect(updatedUser.posts[0].postLabel).toBe(`post-${updatedUser.posts[0].id}`)
    })

    test('nested writes (update): select applies result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const updatedUser = await xprisma.user.update({
        where: { email },
        data: {
          firstName: 'Nested Update',
          posts: {
            create: [{}],
          },
        },
        select: {
          posts: {
            select: {
              postLabel: true,
            },
          },
        },
      })

      expect(updatedUser.posts[0].postLabel).toBeDefined()
    })

    test('fluent reads apply result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const posts = await xprisma.user.findUniqueOrThrow({ where: { email } }).posts()

      expect(posts[0].postLabel).toBe(`post-${posts[0].id}`)
    })

    test('fluent writes (create) apply result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const posts = await xprisma.user
        .create({
          data: {
            email: faker.internet.email(),
            firstName: 'Fluent',
            lastName: 'Create',
            posts: {
              create: [{}],
            },
          },
        })
        .posts()

      expect(posts[0].postLabel).toBe(`post-${posts[0].id}`)
    })

    test('fluent writes (update) apply result extensions to nested models', async () => {
      const xprisma = prismaWithUserAndPostExtensions()

      const posts = await xprisma.user
        .update({
          where: { email },
          data: {
            firstName: 'Fluent Update',
            posts: {
              create: [{}],
            },
          },
        })
        .posts()

      expect(posts[0].postLabel).toBe(`post-${posts[0].id}`)
    })

    test('dependencies between computed fields', async () => {
      const xprisma = prismaWithExtension().$extends({
        result: {
          user: {
            loudName: {
              needs: { fullName: true },
              compute(user) {
                expectTypeOf(user.fullName).toEqualTypeOf<string>()
                return user.fullName.toUpperCase()
              },
            },
          },
        },
      })

      const user = await xprisma.user.findFirst()
      expect(user?.loudName).toBe('JOHN SMITH')
      expectTypeOf(user?.loudName).toEqualTypeOf<string | undefined>()
    })

    test('shadowing dependency', async () => {
      const xprisma = prisma.$extends({
        result: {
          user: {
            firstName: {
              needs: { firstName: true },
              compute(user) {
                return user.firstName.toUpperCase()
              },
            },
          },
        },
      })

      const user = await xprisma.user.findFirst()
      expect(user?.firstName).toBe('JOHN')
      expectTypeOf(user?.firstName).toEqualTypeOf<string | undefined>()
    })

    test('shadowing dependency multiple times', async () => {
      const xprisma = prisma
        .$extends({
          result: {
            user: {
              firstName: {
                needs: { firstName: true },
                compute(user) {
                  return user.firstName.toUpperCase()
                },
              },
            },
          },
        })
        .$extends({
          result: {
            user: {
              firstName: {
                needs: { firstName: true },
                compute(user) {
                  return `${user.firstName}!!!`
                },
              },
            },
          },
        })

      const user = await xprisma.user.findFirst()
      expect(user?.firstName).toBe('JOHN!!!')
      expectTypeOf(user?.firstName).toEqualTypeOf<string | undefined>()
    })

    test('empty extension does nothing', async () => {
      const xprisma = prismaWithExtension()
        .$extends({
          result: {},
        })
        .$extends({
          result: {
            user: {},
          },
        })

      const user = await xprisma.user.findFirst({})
      expect(user?.fullName).toBe('John Smith')
      expectTypeOf(user?.fullName).toEqualTypeOf<string | undefined>()
    })

    test('with null result', async () => {
      const xprisma = prismaWithExtension()

      const user = await xprisma.user.findUnique({ where: { email: 'nothere@example.com' } })
      expect(user).toBeNull()
      expectTypeOf(user).toBeNullable()
    })

    test('error in computed field', async () => {
      const xprisma = prisma.$extends({
        name: 'Faulty extension',
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute() {
                throw new Error('oops!')
              },
            },
          },
        },
      })

      const user = await xprisma.user.findFirstOrThrow({})
      expect(() => user.fullName).toThrowErrorMatchingInlineSnapshot(`"oops!"`)
      expectTypeOf(() => user.fullName).toEqualTypeOf<() => never>()
    })

    test('error in computed field with no name', async () => {
      const xprisma = prisma.$extends({
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute() {
                throw new Error('oops!')
              },
            },
          },
        },
      })

      const user = await xprisma.user.findFirstOrThrow({})
      expect(() => user.fullName).toThrowErrorMatchingInlineSnapshot(`"oops!"`)
      expectTypeOf(() => user.fullName).toEqualTypeOf<() => never>()
    })

    test('nested includes should include scalars and relations', async () => {
      const xprisma = prisma.$extends({
        result: {
          user: {
            fullName: {
              needs: { firstName: true, lastName: true },
              compute(user) {
                return `${user.firstName} ${user.lastName}`
              },
            },
          },
        },
      })

      const user = await xprisma.user.findFirstOrThrow({
        include: {
          posts: {
            where: {}, // testing with where as it caused issues
            include: {
              user: {
                include: {
                  posts: true,
                },
              },
            },
          },
        },
      })

      expectTypeOf(user.id).toEqualTypeOf<string>()
      expectTypeOf(user.posts[0].id).toEqualTypeOf<string>()
      expectTypeOf(user.posts[0].user.id).toEqualTypeOf<string>()
      expectTypeOf(user.posts[0].user.posts[0].id).toEqualTypeOf<string>()
      expectTypeOf(user.posts[0].user.posts[0]).not.toHaveProperty('user')
    })

    test('when any type is passed as an input default selection type is returned', () => {
      ;async () => {
        const xprisma = prisma.$extends({})

        const data = await xprisma.user.findFirstOrThrow({} as any)
        expectTypeOf(data).toEqualTypeOf<User>()
      }
    })

    test('when args have both include and select and one of them is optional, result includes both', () => {
      ;async () => {
        const xprisma = prisma.$extends({})

        const userFindMany: PrismaNamespace.UserFindManyArgs = {}

        // testing for extended client
        const usersXPrisma = await xprisma.user.findMany({
          ...userFindMany,
          include: {
            posts: true,
          },
        })

        // regular client should be the same
        const usersPrisma = await prisma.user.findMany({
          ...userFindMany,
          include: {
            posts: true,
          },
        })

        expectTypeOf(usersXPrisma[0].email).toEqualTypeOf<string>()
        expectTypeOf(usersXPrisma[0].posts).toEqualTypeOf<Post[]>()

        expectTypeOf(usersPrisma[0].email).toEqualTypeOf<string>()
        expectTypeOf(usersPrisma[0].posts).toEqualTypeOf<Post[]>()
      }
    })
  },
  {
    skip(when, suiteConfig) {
      when(
        suiteConfig.previewFeatures?.includes('relationJoins') === true,
        'https://github.com/prisma/prisma/issues/22971',
      )
    },
    skipDriverAdapter: {
      from: [AdapterProviders.JS_LIBSQL],
      reason: 'js_libsql: SIGABRT due to panic in libsql (not yet implemented: array)', // TODO: ORM-867
    },
  },
)
