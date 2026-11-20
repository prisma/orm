import { PrismaClient } from '@prisma/client'
import { expectType } from 'tsd'

// This file will not be executed, just compiled to check if the typings are valid
async function main() {
  const prisma = new PrismaClient()

  const x = await prisma.user.groupBy({
    by: ['name', 'count', 'min', 'sum', 'max', 'avg'],
    where: {
      age: {
        gt: -1,
      },
    },
    orderBy: [
      {
        name: 'desc',
      },
    ],
    skip: 0,
    take: 10_000,
    _avg: {
      age: true,
      avg: true,
    },
    _count: {
      age: true,
      email: true,
      count: true,
      _all: true,
    },
    _max: {
      age: true,
      max: true,
    },
    _min: {
      age: true,
      min: true,
    },
    _sum: {
      age: true,
      sum: true,
      grades: true,
    },
    having: {
      name: '',
    },
  })
  type X0 = {
    name: string | null
    count: number
    min: number
    sum: number
    max: number
    avg: number

    _avg: {
      age: number | null
      avg: number | null
    }
    _sum: {
      age: number | null
      sum: number | null
      grades: number[] | null
    }
    _count: {
      age: number | null
      count: number | null
      email: number | null
      _all: number | null
    }
    _min: {
      age: number | null
      min: number | null
    }
    _max: {
      age: number | null
      max: number | null
    }
  }
  expectType<X0[]>(x)

  const y = await prisma.user.groupBy({
    by: ['name'],
    _count: true,
    having: {
      name: '',
      email: {
        _min: {
          contains: '',
        },
      },
    },
  })
  expectType<
    {
      _count: number
      name: string | null
    }[]
  >(y)

  const z = await prisma.user.groupBy({
    by: ['name'],
    having: {
      OR: [
        {
          AND: [
            {
              NOT: [
                {
                  email: {
                    _max: {
                      contains: '',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  })
  expectType<
    {
      name: string | null
    }[]
  >(z)
}

main().catch((e) => {
  console.error(e)
})
