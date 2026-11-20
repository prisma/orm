import { PrismaNeonHttp } from '@prisma/adapter-neon'
import { smokeTest } from './test'

async function main() {
  const connectionString = `${process.env.JS_NEON_DATABASE_URL as string}`

  const adapter = new PrismaNeonHttp(connectionString, {
    arrayMode: false,
    fullResults: true,
  })

  await smokeTest(adapter)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
