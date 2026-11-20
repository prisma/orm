import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getPackedPackage } from './../getPackedPackage'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
vi.setConfig({
  testTimeout: isMacOrWindowsCI ? 60_000 : 20_000,
})

describe('getPackedPackage', () => {
  it('test argument vulnerability', async () => {
    const outputDir = '/tmp/some-prisma-target-folder'
    const packageDir = 'foo`touch /tmp/getPackedPackage-exploit`'

    try {
      await getPackedPackage('@prisma/client', path.join(__dirname, outputDir), packageDir)
    } catch (e) {
      //
    } finally {
      expect(fs.existsSync('/tmp/getPackedPackage-exploit')).toBe(false)
    }
  })
})
