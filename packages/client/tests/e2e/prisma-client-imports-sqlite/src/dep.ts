import { D1Database } from '@cloudflare/workers-types'
import { PrismaD1 } from '@prisma/adapter-d1'
// import { withAccelerate } from '@prisma/extension-accelerate'
// import { readReplicas } from '@prisma/extension-read-replicas'
import { PrismaClient } from 'db'
import { PrismaClientKnownRequestError as E1 } from 'db/runtime/client'
import { PrismaClientKnownRequestError as E2 } from 'db/runtime/client.js'

// Setup
export const errors = [E1, E2]

// export const client = new PrismaClient()
// void client.user.findMany()

// export const accelerateClient = client.$extends(withAccelerate())
// void accelerateClient.user.findMany()

// export const replicaClient = client.$extends(readReplicas({ url: '' }))
// void replicaClient.user.findMany()

/* Driver Adapters */
const d1Db = {} as D1Database
export const d1PrismaClient = new PrismaClient({
  adapter: new PrismaD1(d1Db),
})
void d1PrismaClient.user.findMany()
