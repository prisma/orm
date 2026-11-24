import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { afterEach, expect, test } from 'vitest'

import { resolvePrismaClient } from '../src/resolvePrismaClient'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

test('missing @prisma/client recovery uses the selected executable', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prisma-client-generator-js-'))
  tempDirs.push(tempDir)

  await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'tmp', private: true }))
  await fs.writeFile(path.join(tempDir, 'package-lock.json'), '{}')

  await expect(resolvePrismaClient(tempDir, 'prisma7')).rejects.toThrowErrorMatchingInlineSnapshot(`
    [Error: Could not resolve @prisma/client.
    Please try to install it with npm i @prisma/client and rerun npx "prisma7 generate" 🙏.]
  `)
})

test('missing @prisma/client recovery keeps ordinary prisma explicit', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prisma-client-generator-js-'))
  tempDirs.push(tempDir)

  await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'tmp', private: true }))
  await fs.writeFile(path.join(tempDir, 'package-lock.json'), '{}')

  expect.assertions(2)

  try {
    await resolvePrismaClient(tempDir, 'prisma')
  } catch (error) {
    const message = stripVTControlCharacters((error as Error).message)

    expect(message).toContain('prisma generate')
    expect(message).not.toContain('prisma7 generate')
  }
})
