import { PrismaLibSql } from '@prisma/adapter-libsql'

import { PrismaClient } from './client/edge'

export default {
  async fetch(request, env) {
    const adapter = new PrismaLibSql({
      url: env.DRIVER_ADAPTERS_TURSO_CF_BASIC_DATABASE_URL,
      authToken: env.DRIVER_ADAPTERS_TURSO_CF_BASIC_TOKEN,
    })
    const prisma = new PrismaClient({ adapter })

    const users = await prisma.user.findMany()
    const result = JSON.stringify(users)

    return new Response(result)
  },
}
