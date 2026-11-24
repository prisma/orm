import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  getGlobalLocalVersionMismatchWarning,
  getInstalledPackageVersionFromNodeModules,
} from '../utils/global-local-version-mismatch'

const GLOBAL_VERSION = '7.5.0'

function buildWarning(
  options: Partial<Parameters<typeof getGlobalLocalVersionMismatchWarning>[0]> = {},
): Promise<string | null> {
  return getGlobalLocalVersionMismatchWarning({
    cwd: '/tmp/project',
    globalVersion: GLOBAL_VERSION,
    identity: 'prisma',
    isGlobalInstall: () => 'npm',
    getInstalledPackageVersion: () => Promise.resolve(null),
    ...options,
  })
}

describe('getGlobalLocalVersionMismatchWarning', () => {
  test('returns null when the current Prisma binary is not global', async () => {
    const getInstalledPackageVersion = jest.fn()
    const result = await buildWarning({
      isGlobalInstall: () => false,
      getInstalledPackageVersion,
    })

    expect(result).toBeNull()
    expect(getInstalledPackageVersion).not.toHaveBeenCalled()
  })

  test('returns null when no local Prisma packages are installed', async () => {
    const result = await buildWarning()

    expect(result).toBeNull()
  })

  test('returns null when local Prisma packages match the global version', async () => {
    const result = await buildWarning({
      getInstalledPackageVersion: () => Promise.resolve(GLOBAL_VERSION),
    })

    expect(result).toBeNull()
  })

  test('warns when only local prisma differs from the global CLI', async () => {
    const result = await buildWarning({
      getInstalledPackageVersion: (packageName) => Promise.resolve(packageName === 'prisma' ? '7.4.0' : GLOBAL_VERSION),
    })

    expect(result).toContain('prisma@7.5.0')
    expect(result).toContain('prisma@7.4.0')
    expect(result).not.toContain('@prisma/client@7.4.0')
    expect(result).toContain('npx prisma generate')
  })

  test('warns when only local @prisma/client differs from the global CLI', async () => {
    const result = await buildWarning({
      getInstalledPackageVersion: (packageName) =>
        Promise.resolve(packageName === '@prisma/client' ? '7.4.0' : GLOBAL_VERSION),
    })

    expect(result).toContain('prisma@7.5.0')
    expect(result).toContain('@prisma/client@7.4.0')
    expect(result).not.toContain('prisma@7.4.0')
  })

  test('warns about both local packages when both differ from the global CLI', async () => {
    const result = await buildWarning({
      getInstalledPackageVersion: (packageName) => Promise.resolve(packageName === 'prisma' ? '7.4.0' : '7.3.0'),
    })

    expect(result).toContain('prisma@7.4.0')
    expect(result).toContain('@prisma/client@7.3.0')
  })

  test('warns with the scoped prisma7 package name and prisma7 command guidance', async () => {
    const result = await buildWarning({
      identity: 'prisma7',
      getInstalledPackageVersion: (packageName) =>
        Promise.resolve(packageName === '@prisma/prisma7' ? '7.4.0' : GLOBAL_VERSION),
    })

    expect(result).toContain('@prisma/prisma7@7.5.0')
    expect(result).toContain('@prisma/prisma7@7.4.0')
    expect(result).not.toContain('The globally installed prisma7@7.5.0')
    expect(result).toContain('npx prisma7 generate')
  })

  test('returns null for an empty global version', async () => {
    const getInstalledPackageVersion = jest.fn()
    const result = await buildWarning({
      globalVersion: ' ',
      getInstalledPackageVersion,
    })

    expect(result).toBeNull()
    expect(getInstalledPackageVersion).not.toHaveBeenCalled()
  })
})

describe('getInstalledPackageVersionFromNodeModules', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prisma-global-local-version-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { force: true, recursive: true })
  })

  test('reads local prisma, @prisma/prisma7, and @prisma/client versions from an ancestor node_modules directory', async () => {
    const schemaRootDir = path.join(tempDir, 'prisma')
    await fs.promises.mkdir(schemaRootDir)
    await writePackageVersion('prisma', '7.4.0')
    await writePackageVersion('@prisma/prisma7', '7.4.1')
    await writePackageVersion('@prisma/client', '7.3.0')

    await expect(getInstalledPackageVersionFromNodeModules('prisma', schemaRootDir)).resolves.toBe('7.4.0')
    await expect(getInstalledPackageVersionFromNodeModules('@prisma/prisma7', schemaRootDir)).resolves.toBe('7.4.1')
    await expect(getInstalledPackageVersionFromNodeModules('@prisma/client', schemaRootDir)).resolves.toBe('7.3.0')
  })

  test('returns null when the package cannot be resolved', async () => {
    await expect(getInstalledPackageVersionFromNodeModules('prisma', tempDir)).resolves.toBeNull()
  })

  async function writePackageVersion(
    packageName: 'prisma' | '@prisma/prisma7' | '@prisma/client',
    version: string,
  ): Promise<void> {
    const packageDir = path.join(tempDir, 'node_modules', ...packageName.split('/'))
    await fs.promises.mkdir(packageDir, { recursive: true })
    await fs.promises.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ version }), 'utf-8')
  }
})
