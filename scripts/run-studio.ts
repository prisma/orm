#!/usr/bin/env tsx

import { defaultTestConfig } from '@prisma/config'

import { Studio } from '../packages/cli/src/Studio'

function printUsage(): void {
  console.error(`Usage:
  STUDIO_DATABASE_URL='<postgres-url>' pnpm exec tsx scripts/run-studio.ts
  pnpm exec tsx scripts/run-studio.ts '<postgres-url>' [port] [browser]

Environment variables:
  STUDIO_DATABASE_URL  Database URL to connect Studio to
  STUDIO_PORT          Port to bind to (default: 5555)
  STUDIO_BROWSER       Browser to launch (default: none)
`)
}

async function main(): Promise<void> {
  const url = process.env.STUDIO_DATABASE_URL ?? process.argv[2]
  const port = process.env.STUDIO_PORT ?? process.argv[3] ?? '5555'
  const browser = process.env.STUDIO_BROWSER ?? process.argv[4] ?? 'none'

  if (!url) {
    printUsage()
    process.exitCode = 1
    return
  }

  const result = await Studio.new('prisma').parse(
    ['--url', url, '--port', port, '--browser', browser],
    defaultTestConfig(),
  )

  if (result instanceof Error) {
    throw result
  }
}

void main()
