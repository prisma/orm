import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePathsPlugin } from './resolvePathsPlugin'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../')
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

beforeEach(() => {
  process.chdir(repoRoot)
})

async function bundleImport(importPath: string, external: string[] = []) {
  return esbuild.build({
    absWorkingDir: repoRoot,
    bundle: true,
    external,
    format: 'esm',
    metafile: true,
    platform: 'node',
    plugins: [resolvePathsPlugin],
    stdin: {
      contents: `import '${importPath}'`,
      resolveDir: repoRoot,
      sourcefile: 'entry.ts',
    },
    tsconfig: 'tsconfig.build.bundle.json',
    write: false,
  })
}

describe('resolvePathsPlugin', () => {
  it.each([
    ['prisma', 'packages/cli/src/types.ts'],
    ['@prisma/prisma7', 'packages/prisma7/src/index.ts'],
    ['prisma/config', 'packages/cli/src/config.ts'],
    ['@prisma/prisma7/config', 'packages/prisma7/src/config.ts'],
  ])('resolves %s to %s', async (importPath, resolvedPath) => {
    const result = await bundleImport(importPath)

    expect(Object.keys(result.metafile.inputs)).toContain(resolvedPath)
  })

  it.each([
    ['prisma/config', 'packages/cli/src/config.ts'],
    ['@prisma/prisma7/config', 'packages/prisma7/src/config.ts'],
  ])('preserves exact external alias %s', async (importPath, resolvedPath) => {
    const result = await bundleImport(importPath, [importPath])

    expect(Object.keys(result.metafile.inputs)).not.toContain(resolvedPath)
    expect(result.outputFiles[0]?.text).toContain(`import "${importPath}";`)
  })
})
