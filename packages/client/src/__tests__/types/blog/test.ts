import type { Post, User } from '@prisma/client'
import { Prisma, PrismaClient } from '@prisma/client'

// This file will not be executed, just compiled to check if the typings are valid
async function main() {
  const prisma = new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
    ],
  })

  prisma.$on('query', (a: Prisma.QueryEvent) => {
    //
  })

  let v: string = Prisma.prismaVersion.client

  const x: Prisma.Sql = Prisma.sql`SELECT * FROM ${Prisma.raw('User')} WHERE 'id' in ${Prisma.join([1, 2, 3])} ${
    Prisma.empty
  } `

  const queryRaw1 = await prisma.$queryRaw`SELECT * FROM User WHERE id = 1`
  const queryRaw2 = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1}`
  const queryRaw3 = await prisma.$queryRawUnsafe(`SELECT * FROM User WHERE id = $1`, 2)
  const queryRaw4 = await prisma.$queryRaw(Prisma.sql`SELECT * FROM User WHERE id = ${1}`)
  const queryRaw5 = await prisma.$queryRaw(Prisma.sql`SELECT * FROM User ${Prisma.sql`WHERE id = ${1}`}`)

  const executeRaw1 = await prisma.$executeRaw`SELECT * FROM User WHERE id = 1`
  const executeRaw2 = await prisma.$executeRaw`SELECT * FROM User WHERE id = ${1}`
  const executeRaw3 = await prisma.$executeRawUnsafe(`SELECT * FROM User WHERE id = $1`, 2)
  const executeRaw4 = await prisma.$executeRaw(Prisma.sql`SELECT * FROM User WHERE id = ${1}`)
  const executeRaw5 = await prisma.$executeRaw(Prisma.sql`SELECT * FROM User ${Prisma.sql`WHERE id = ${1}`}`)

  const result1 = await prisma.user.findMany({
    where: {
      posts: {
        some: {
          author: {
            AND: {
              id: '5',
              posts: {
                some: {
                  author: {
                    posts: {
                      some: {
                        title: '5',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  result1[0]!.email
  result1[0]!.id
  result1[0]!.name

  const result2: {
    id: string
    createdAt: Date
    updatedAt: Date
    published: boolean
    title: string
    content: string | null
    author: User | null
  } | null = await prisma.post.findUnique({
    where: {
      id: '',
    },
    include: {
      author: true,
    },
  })

  const result4: Array<{
    id: string
    author: {
      name: string | null
    } | null
  }> = await prisma.post.findMany({
    select: {
      id: true,
      author: {
        select: {
          name: true,
        },
      },
    },
  })

  const result5: Post = await prisma.post.create({
    data: {
      published: false,
      title: 'Title',
    },
  })

  await prisma.post.delete({
    where: {
      id: '',
    },
  })

  await prisma.post.upsert({
    create: {
      published: false,
      title: 'Title',
    },
    update: {
      published: true,
    },
    where: {
      id: '6',
    },
  })

  await prisma.post.updateMany({
    data: {
      published: false,
    },
  })

  const count: number = await prisma.post.count({
    where: {
      published: false,
    },
  })

  const $disconnect: Promise<void> = prisma.$disconnect()

  // Trick to define a "positive" test, if "include" is NOT in "FindManyMachineDataArgs"
  type X = keyof Prisma.MachineDataFindManyArgs
  type Y = 'include' extends X ? number : string
  const y: Y = 'string'

  // Test for https://github.com/prisma/prisma-client-js/issues/615
  const users = await prisma.user.findMany({
    include: {
      posts: {
        include: {
          author: true,
        },
        orderBy: {
          title: 'asc',
        },
      },
    },
  })

  const id = users[0].posts[0].author?.id

  const like = await prisma.like.findUnique({
    where: {
      userId_postId: {
        postId: '',
        userId: '',
      },
    },
    include: { post: true },
  })

  like!.post

  const like2 = await prisma.like.upsert({
    where: {
      userId_postId: {
        userId: '',
        postId: '',
      },
    },
    create: {
      post: { connect: { id: '' } },
      user: { connect: { id: '' } },
    },
    update: {},
    include: { post: true },
  })

  like2!.post

  // make sure, that null is not allowed for this type
  type LikeUpdateIdType = Prisma.LikeUpdateManyArgs['data']['id']
  type AllowsNull = null extends LikeUpdateIdType ? true : false
  const allowsNull: AllowsNull = false

  // check if listing of `set` is done in nested relations
  // https://github.com/prisma/prisma/issues/3497
  await prisma.user.update({
    where: {
      id: '6',
    },
    data: {
      posts: {
        update: {
          data: {
            title: 'something',
          },
          where: {
            id: 'whatever',
          },
        },
      },
    },
  })

  await prisma.user.update({
    where: {
      id: '6',
    },
    data: {
      posts: {
        updateMany: {
          data: {
            title: 'something',
          },
          where: {
            id: 'whatever',
          },
        },
      },
    },
  })

  await prisma.post.update({
    where: {
      id: '6',
    },
    data: {
      author: {
        update: {
          name: 'something',
        },
      },
    },
  })

  await prisma.atAtId.findUnique({
    where: {
      key1_key2: {
        key1: 'hmm',
        key2: 1,
      },
    },
  })
}

main().catch((e) => {
  console.error(e)
})
