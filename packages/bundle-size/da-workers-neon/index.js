import { PrismaNeon } from '@prisma/adapter-neon'

import { PrismaClient } from './client/edge'

export default {
  async fetch(request, env) {
    const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter })

    const users = await prisma.user.findMany()
    const result = JSON.stringify(users)

    return new Response(result)
  },
}
