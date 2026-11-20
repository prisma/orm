import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { $ } from 'zx'

describe('diagnostics related to prisma.config.ts should not influence structured output commands', () => {
  beforeEach(() => {
    // To hide "Update available 0.0.0 -> x.x.x"
    vi.stubEnv('PRISMA_HIDE_UPDATE_MESSAGE', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('prisma migrate diff --script', async () => {
    const { stdout, stderr, exitCode } =
      await $`pnpm prisma migrate diff --from-empty --to-schema ./prisma/schema.prisma --script`
    expect(exitCode).toBe(0)
    expect(stdout).toMatchInlineSnapshot(`
      "-- CreateTable
      CREATE TABLE "User" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "email" TEXT NOT NULL
      );

      -- CreateIndex
      CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

      "
    `)
    expect(stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      "
    `)
  })

  test('prisma version --json', async () => {
    const { stdout, stderr, exitCode } = await $`pnpm prisma version --json`

    expect(exitCode).toBe(0)
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma.
      "
    `)
  })
})
