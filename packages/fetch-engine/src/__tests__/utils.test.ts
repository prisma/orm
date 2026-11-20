import os from 'node:os'
import path from 'node:path'

import findCacheDir from 'find-cache-dir'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { getRootCacheDir } from '../utils'

vi.mock('find-cache-dir')

describe('getRootCacheDir', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  test('on Windows, prefers APPDATA over a cwd-relative cache dir', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.stubEnv('APPDATA', 'C:\\Users\\test\\AppData\\Roaming')

    await expect(getRootCacheDir()).resolves.toBe(path.join('C:\\Users\\test\\AppData\\Roaming', 'Prisma'))
    // Never falls back to a cache dir that's relative to whichever package happened to trigger the call, which is
    // what caused duplicate `.cache` directories to appear inside `node_modules` (prisma/prisma#22574).
    expect(findCacheDir).not.toHaveBeenCalled()
  })

  test('on Windows, falls back to find-cache-dir when APPDATA is not set', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.stubEnv('APPDATA', '')
    vi.mocked(findCacheDir).mockReturnValue('/fallback/cache/dir')

    await expect(getRootCacheDir()).resolves.toBe('/fallback/cache/dir')
  })
})
