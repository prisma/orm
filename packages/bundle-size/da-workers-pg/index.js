import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './client/edge'

export default {
  async fetch(request, env) {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter })

    const users = await prisma.user.findMany()
    const result = JSON.stringify(users)

    return new Response(result)
  },
}
