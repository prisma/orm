import { expectTypeOf } from 'expect-type'

import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

// Note: test snapshots fail if one runs this test with `--generator-type prisma-client-js` vs `--generator-type prisma-client-ts`.
// For now, I worked around the problem by adjusting the snapshots conditionally to the generator type.
// TODO: figure out why this problem exists, and fix it.
// Alternatively, stop testing this on `prisma-client-js` altogether.
testMatrix.setupTestSuite(({ provider }) => {
  test('non-existing true field in omit throw validation error', async () => {
    const result = prisma.user.findFirstOrThrow({
      omit: {
        // @ts-expect-error
        notThere: true,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.findFirstOrThrow()\` invocation in
      /client/tests/functional/omit/test.ts:0:0

        XX // Alternatively, stop testing this on \`prisma-client-js\` altogether.
        XX testMatrix.setupTestSuite(({ provider }) => {
        XX   test('non-existing true field in omit throw validation error', async () => {
      → XX     const result = prisma.user.findFirstOrThrow({
                 omit: {
                   notThere: true,
                   ~~~~~~~~
               ?   id?: true,
               ?   name?: true,
               ?   password?: true,
               ?   email?: true,
               ?   _count?: true
                 }
               })

      Unknown field \`notThere\` for omit statement on model \`User\`. Available options are marked with ?."
    `)
  })

  test('non-existing false field in omit throw validation error', async () => {
    const result = prisma.user.findFirstOrThrow({
      omit: {
        // @ts-expect-error
        notThere: false,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.findFirstOrThrow()\` invocation in
      /client/tests/functional/omit/test.ts:0:0

        XX })
        XX 
        XX test('non-existing false field in omit throw validation error', async () => {
      → XX   const result = prisma.user.findFirstOrThrow({
               omit: {
                 notThere: false,
                 ~~~~~~~~
             ?   id?: true,
             ?   name?: true,
             ?   password?: true,
             ?   email?: true,
             ?   _count?: true
               }
             })

      Unknown field \`notThere\` for omit statement on model \`User\`. Available options are marked with ?."
    `)
  })

  test('omit + select throws validation error', async () => {
    // @ts-expect-error
    const result = prisma.user.findFirstOrThrow({
      select: {
        name: true,
      },
      omit: {
        password: true,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.findFirstOrThrow()\` invocation in
      /client/tests/functional/omit/test.ts:0:0

        XX 
        XX test('omit + select throws validation error', async () => {
        XX   // @ts-expect-error
      → XX   const result = prisma.user.findFirstOrThrow({
               select: {
               ~~~~~~
                 name: true
               },
               omit: {
               ~~~~
                 password: true
               }
             })

      Please either use \`omit\` or \`select\`, but not both at the same time."
    `)
  })

  test('deeply nested omit + select throws validation error', async () => {
    const result = prisma.user.findFirstOrThrow({
      select: {
        name: true,
        posts: {
          select: { id: true },
          omit: { title: true },
        },
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.findFirstOrThrow()\` invocation in
      /client/tests/functional/omit/test.ts:0:0

        XX })
        XX 
        XX test('deeply nested omit + select throws validation error', async () => {
      → XX   const result = prisma.user.findFirstOrThrow({
                select: {
                  name: true,
                  posts: {
                    select: {
                    ~~~~~~
                      id: true
                    },
                    omit: {
                    ~~~~
                      title: true
                    }
                  }
                }
              })

      Please either use \`omit\` or \`select\`, but not both at the same time."
    `)
  })

  test('excluding all fields of a model throws validation error', async () => {
    const result = prisma.user.findFirstOrThrow({
      omit: {
        id: true,
        name: true,
        email: true,
        password: true,
      },
    })

    await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
      "
      Invalid \`prisma.user.findFirstOrThrow()\` invocation in
      /client/tests/functional/omit/test.ts:0:0

        XX })
        XX 
        XX test('excluding all fields of a model throws validation error', async () => {
      → XX   const result = prisma.user.findFirstOrThrow({
                omit: {
              ?   id?: false,
              ?   name?: false,
              ?   password?: false,
              ?   email?: false,
              ?   posts?: false,
              ?   _count?: false
                }
              })

      The omit statement includes every field of the model User. At least one field must be included in the result"
    `)
  })

  test('create', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Steve the Rat',
        password: 'cheese',
        email: 'steve@rats.com',
        posts: {
          create: {
            title: '100 places to visit before you die',
          },
        },
      },
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  // Not implemented for SQL Server, MongoDB, and MySQL
  skipTestIf([Providers.SQLSERVER, Providers.MONGODB, Providers.MYSQL].includes(provider))(
    'createManyAndReturn',
    async () => {
      // @ts-test-if: provider !== Providers.SQLSERVER && provider !== Providers.MONGODB && provider !== Providers.MYSQL
      const user = await prisma.user.createManyAndReturn({
        data: [
          {
            name: 'Steve the Rat - The Sequel',
            password: 'cheese',
            email: 'steve2@rats.com',
          },
        ],
        omit: {
          password: true,
        },
      })

      // Cleanup
      await prisma.user.delete({
        where: {
          id: user[0].id,
        },
      })

      expect(user[0].name).toBe('Steve the Rat - The Sequel')
      expect(user[0]).not.toHaveProperty('password')
      expectTypeOf(user[0]).toHaveProperty('id')
      expectTypeOf(user[0]).toHaveProperty('name')
      // @ts-test-if: provider !== Providers.SQLSERVER && provider !== Providers.MONGODB && provider !== Providers.MYSQL
      expectTypeOf(user[0]).not.toHaveProperty('password')
    },
  )

  test('findUnique', async () => {
    const user = await prisma.user.findUnique({
      where: {
        email: 'steve@rats.com',
      },
      omit: {
        password: true,
      },
    })

    expect(user!.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user!).toHaveProperty('id')
    expectTypeOf(user!).toHaveProperty('name')
    expectTypeOf(user!).not.toHaveProperty('password')
  })

  test('findFirst', async () => {
    const user = await prisma.user.findFirst({
      omit: {
        password: true,
      },
    })

    expect(user?.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user!).toHaveProperty('id')
    expectTypeOf(user!).toHaveProperty('name')
    expectTypeOf(user!).not.toHaveProperty('password')
  })

  test('findFirstOrThrow', async () => {
    const user = await prisma.user.findFirstOrThrow({
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  test('findUniqueOrThrow', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        email: 'steve@rats.com',
      },
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  test('update', async () => {
    const user = await prisma.user.update({
      where: {
        email: 'steve@rats.com',
      },
      data: {
        email: 'steven@rats.com',
      },
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  test('upsert', async () => {
    const user = await prisma.user.upsert({
      where: {
        email: 'steven@rats.com',
      },
      update: {},
      create: {
        name: 'Steve the Rat',
        password: 'cheese',
        email: 'steven@rats.com',
      },
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  test('false value', async () => {
    const user = await prisma.user.findFirstOrThrow({
      omit: {
        password: false,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user.password).toBe('cheese')
  })

  test('omit combined with include', async () => {
    const user = await prisma.user.findFirstOrThrow({
      include: {
        posts: true,
      },
      omit: {
        password: true,
      },
    })

    expect(user.name).toBe('Steve the Rat')
    expect(user.posts).toHaveLength(1)
    expectTypeOf(user).toHaveProperty('posts')
    expectTypeOf(user).not.toHaveProperty('password')
  })

  test('omit nested in select', async () => {
    const post = await prisma.post.findFirstOrThrow({
      select: {
        author: {
          omit: {
            password: true,
          },
        },
      },
    })

    expect(post.author.name).toBe('Steve the Rat')
    expect(post.author).not.toHaveProperty('password')
    expectTypeOf(post.author).not.toHaveProperty('password')
  })

  test('omit nested in include', async () => {
    const post = await prisma.post.findFirstOrThrow({
      include: {
        author: {
          omit: {
            password: true,
          },
        },
      },
    })

    expect(post.author.name).toBe('Steve the Rat')
    expect(post.author).not.toHaveProperty('password')
    expectTypeOf(post.author).not.toHaveProperty('password')
  })

  test('excluding computed fields', async () => {
    const xprisma = prisma.$extends({
      result: {
        user: {
          superSecretInfo: {
            needs: {},
            compute() {
              return "it's a secret to everybody"
            },
          },
        },
      },
    })

    const user = await xprisma.user.findFirstOrThrow({
      omit: {
        superSecretInfo: true,
      },
    })

    expect(user).not.toHaveProperty('superSecretInfo')

    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).toHaveProperty('password')
    expectTypeOf(user).not.toHaveProperty('superSecretInfo')
  })

  test('excluding dependency of a computed field', async () => {
    const xprisma = prisma.$extends({
      result: {
        user: {
          sanitizedPassword: {
            needs: { password: true },
            compute(user) {
              return `secret(${user.password})`
            },
          },
        },
      },
    })

    const user = await xprisma.user.findFirstOrThrow({
      omit: {
        password: true,
      },
    })

    expect(user).not.toHaveProperty('password')
    expect(user.sanitizedPassword).toBe('secret(cheese)')

    expectTypeOf(user).toHaveProperty('id')
    expectTypeOf(user).toHaveProperty('name')
    expectTypeOf(user).not.toHaveProperty('password')
    expectTypeOf(user).toHaveProperty('sanitizedPassword')
  })
})
