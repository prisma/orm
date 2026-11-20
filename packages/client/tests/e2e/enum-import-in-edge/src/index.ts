import { PrismaD1 } from '@prisma/adapter-d1'
import { Prisma, PrismaClient, Role } from '@prisma/client/edge'

export default {
  fetch() {
    const adapter = new PrismaD1({
      CLOUDFLARE_DATABASE_ID: '',
      CLOUDFLARE_D1_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: '',
    })
    // When using Prisma Client in an edge runtime it would error like this:
    // ... is unable to run in an edge runtime. As an alternative, try Accelerate: https://pris.ly/d/accelerate.
    // But that should only happen when executing a query
    // This tests that creating an instance of PrismaClient does not error
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const db = new PrismaClient({ adapter })

    const data = {
      Role,
      ModelName: Prisma.ModelName,
    }

    return new Response(JSON.stringify(data))
  },
}
