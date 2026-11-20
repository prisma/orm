import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon, PrismaNeonHttp } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
// import { withAccelerate } from '@prisma/extension-accelerate'
// import { readReplicas } from '@prisma/extension-read-replicas'
import { PrismaClient } from 'db'
import { PrismaClientKnownRequestError as E1 } from 'db/runtime/client'
import { PrismaClientKnownRequestError as E2 } from 'db/runtime/client.js'
import ws from 'ws'

// Setup
neonConfig.webSocketConstructor = ws

const connectionString = 'just-a-string'

export const errors = [E1, E2]

// export const client = new PrismaClient()
// void client.user.findMany()

// export const accelerateClient = client.$extends(withAccelerate())
// void accelerateClient.user.findMany()

// export const replicaClient = client.$extends(readReplicas({ url: '' }))
// void replicaClient.user.findMany()

/* Driver Adapters */
export const neonPrismaClient = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
})
void neonPrismaClient.user.findMany()

export const neonHttpPrismaClient = new PrismaClient({
  adapter: new PrismaNeonHttp('postgresql://user:password@example.com/dbname', {
    arrayMode: false,
    fullResults: true,
  }),
})
void neonHttpPrismaClient.user.findMany()

export const pgPrismaClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})
void pgPrismaClient.user.findMany()
