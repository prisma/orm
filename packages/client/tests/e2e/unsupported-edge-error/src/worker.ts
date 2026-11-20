// Import the browser build explicitly to test the browser stub error in edge runtime
// @ts-expect-error - index-browser is a generated file
import { PrismaClient } from '@prisma/client/index-browser'

export interface Env {}

export default {
  // eslint-disable-next-line @typescript-eslint/require-await
  async fetch(): Promise<Response> {
    try {
      // This should raise an error, because it has no adapter or accelerate URL passed in.
      // The error happens when accessing a property on PrismaClient (via Proxy get trap)
      const prisma = new PrismaClient()

      // Accessing prisma.user triggers the Proxy's get trap which throws the error
      const _user = prisma.user

      return new Response('No Error')
    } catch (e: unknown) {
      // Extract just the part we want to test (the main error message)
      const message = e instanceof Error ? e.message : String(e)
      // The error message contains the part we're testing for
      // Extract from "In order to run Prisma Client on edge runtime" to the end of the driver adapters line
      const match = message.match(
        /In order to run Prisma Client on edge runtime, either:[\s\S]*?Use Driver Adapters: https:\/\/pris\.ly\/d\/driver-adapters/,
      )
      if (match) {
        return new Response(match[0], { status: 200 })
      }
      return new Response(message, { status: 200 })
    }
  },
}
