import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from './client/edge'

export default {
  async fetch(request, env) {
    const adapter = new PrismaMariaDb({
      host: env.DATABASE_URL,
    })
    const prisma = new PrismaClient({ adapter })

    const users = await prisma.user.findMany()
    const result = JSON.stringify(users)

    return new Response(result)
  },
}
