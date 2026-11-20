import { PrismaPostgresAdapter } from '@prisma/adapter-ppg'
import { smokeTest } from './test'

async function main() {
  const connectionString = `${process.env.JS_PPG_DATABASE_URL as string}`

  const adapter = new PrismaPostgresAdapter({
    connectionString,
  })

  await smokeTest(adapter)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
