import { getTestClient } from '../../../../utils/getTestClient'
import { sanitizeEvents } from '../../__helpers__/sanitizeEvents'

// describe, because we need to run them sequentially
describe('transaction', () => {
  test('queryRaw', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const res = await prisma.$transaction([
      prisma.$queryRaw`SELECT * FROM "User"`,
      prisma.$queryRaw`SELECT * FROM "Post"`,
    ])
    await prisma.$disconnect()

    expect(sanitizeEvents(queries)).toMatchInlineSnapshot(`
      [
        {
          params: [],
          query: BEGIN,
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "User",
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "Post",
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: COMMIT,
          target: quaint::connector::trace,
        },
      ]
    `)

    expect(res).toMatchInlineSnapshot(`
      [
        [
          {
            email: a@a.de,
            id: 576eddf9-2434-421f-9a86-58bede16fd95,
            name: Alice,
          },
        ],
        [],
      ]
    `)
  })

  test('queryRaw & updateMany 1', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const updateUsers = prisma.user.updateMany({
      where: {
        name: 'A',
      },
      data: {
        name: 'B',
      },
    })

    const res = await prisma.$transaction([
      prisma.$queryRaw`SELECT * FROM "User"`,
      updateUsers,
      prisma.$queryRaw`SELECT * FROM "Post"`,
    ])
    await prisma.$disconnect()

    expect(sanitizeEvents(queries)).toMatchInlineSnapshot(`
      [
        {
          params: [],
          query: BEGIN,
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "User",
          target: quaint::connector::trace,
        },
        {
          params: ["B","A"],
          query: UPDATE \`main\`.\`User\` SET \`name\` = ? WHERE \`main\`.\`User\`.\`name\` = ?,
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "Post",
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: COMMIT,
          target: quaint::connector::trace,
        },
      ]
    `)

    expect(res).toMatchInlineSnapshot(`
      [
        [
          {
            email: a@a.de,
            id: 576eddf9-2434-421f-9a86-58bede16fd95,
            name: Alice,
          },
        ],
        {
          count: 0,
        },
        [],
      ]
    `)
  })

  test('queryRaw & updateMany 2', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const updateUsers = prisma.user.updateMany({
      where: {
        name: 'A',
      },
      data: {
        name: 'B',
      },
    })

    const res = await prisma.$transaction([
      updateUsers,
      prisma.$queryRaw`SELECT * FROM "User"`,
      prisma.$queryRaw`SELECT * FROM "Post"`,
    ])
    await prisma.$disconnect()

    expect(sanitizeEvents(queries)).toMatchInlineSnapshot(`
      [
        {
          params: [],
          query: BEGIN,
          target: quaint::connector::trace,
        },
        {
          params: ["B","A"],
          query: UPDATE \`main\`.\`User\` SET \`name\` = ? WHERE \`main\`.\`User\`.\`name\` = ?,
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "User",
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: SELECT * FROM "Post",
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: COMMIT,
          target: quaint::connector::trace,
        },
      ]
    `)

    expect(res).toMatchInlineSnapshot(`
      [
        {
          count: 0,
        },
        [
          {
            email: a@a.de,
            id: 576eddf9-2434-421f-9a86-58bede16fd95,
            name: Alice,
          },
        ],
        [],
      ]
    `)
  })

  test('executeRaw', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const res = await prisma.$transaction([
      prisma.$executeRaw`UPDATE User SET name = ${'blub1'} WHERE id = ${'THIS_DOES_NOT_EXIT1'};`,
      prisma.$executeRaw`UPDATE User SET name = ${'blub2'} WHERE id = ${'THIS_DOES_NOT_EXIT2'};`,
    ])
    await prisma.$disconnect()

    expect(sanitizeEvents(queries)).toMatchInlineSnapshot(`
      [
        {
          params: [],
          query: BEGIN,
          target: quaint::connector::trace,
        },
        {
          params: ["blub1","THIS_DOES_NOT_EXIT1"],
          query: UPDATE User SET name = ? WHERE id = ?;,
          target: quaint::connector::trace,
        },
        {
          params: ["blub2","THIS_DOES_NOT_EXIT2"],
          query: UPDATE User SET name = ? WHERE id = ?;,
          target: quaint::connector::trace,
        },
        {
          params: [],
          query: COMMIT,
          target: quaint::connector::trace,
        },
      ]
    `)

    expect(res).toMatchInlineSnapshot(`
      [
        0,
        0,
      ]
    `)
  })

  test('queryRaw & executeRaw in separate transactions', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const res = await Promise.all([
      prisma.$transaction([prisma.$queryRaw`SELECT * FROM "User"`, prisma.$queryRaw`SELECT * FROM "Post"`]),
      prisma.$transaction([prisma.user.findFirst(), prisma.post.findFirst()]),
    ])
    await prisma.$disconnect()

    // as Promise.all does things in parallel, the order is not clear
    // one query finishes first, but we don't know, which one that is
    expect(queries.filter((q) => q.query === 'BEGIN').length).toBe(2)
    expect(queries.filter((q) => q.query === 'COMMIT').length).toBe(2)

    expect(res).toMatchInlineSnapshot(`
      [
        [
          [
            {
              email: a@a.de,
              id: 576eddf9-2434-421f-9a86-58bede16fd95,
              name: Alice,
            },
          ],
          [],
        ],
        [
          {
            email: a@a.de,
            id: 576eddf9-2434-421f-9a86-58bede16fd95,
            name: Alice,
          },
          null,
        ],
      ]
    `)
  })

  // TODO: Enable this test, once query engine allows it
  // will be fixed in https://github.com/prisma/prisma-engines/issues/1481
  /* eslint-disable-next-line jest/no-disabled-tests */
  test.skip('all mixed', async () => {
    const PrismaClient = await getTestClient()
    const prisma = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    })
    const queries: any[] = []
    prisma.$on('query', (q) => {
      queries.push(q)
    })

    const updateUsers = prisma.user.updateMany({
      where: {
        name: 'A',
      },
      data: {
        name: 'B',
      },
    })

    const res = await prisma.$transaction([
      // prisma.$queryRaw`SELECT * FROM "Post"`,
      prisma.$executeRaw`UPDATE User SET name = ${'blub1'} WHERE id = ${'THIS_DOES_NOT_EXIT1'};`,
      updateUsers,
      // prisma.$queryRaw`SELECT * FROM "User"`,
      // prisma.$executeRaw`UPDATE User SET name = ${'blub2'} WHERE id = ${'THIS_DOES_NOT_EXIT2'};`,
    ])
    await prisma.$disconnect()

    expect(sanitizeEvents(queries)).toMatchInlineSnapshot(`
          [
            {
              duration: 0,
              params: [],
              query: BEGIN,
              target: quaint::connector::trace,
            },
            {
              duration: 0,
              params: [],
              query: SELECT * FROM "Post",
              target: quaint::connector::trace,
            },
            {
              duration: 0,
              params: ["blub1","THIS_DOES_NOT_EXIT1"],
              query: UPDATE User SET name = ? WHERE id = ?;,
              target: quaint::connector::trace,
            },
            {
              duration: 0,
              params: [],
              query: SELECT * FROM "User",
              target: quaint::connector::trace,
            },
            {
              duration: 0,
              params: ["blub2","THIS_DOES_NOT_EXIT2"],
              query: UPDATE User SET name = ? WHERE id = ?;,
              target: quaint::connector::trace,
            },
            {
              duration: 0,
              params: [],
              query: COMMIT,
              target: quaint::connector::trace,
            },
          ]
      `)

    expect(res).toMatchInlineSnapshot(`
          [
            [],
            0,
            [
              {
                email: a@a.de,
                id: 576eddf9-2434-421f-9a86-58bede16fd95,
                name: Alice,
              },
            ],
            0,
          ]
      `)
  })
})
