import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { TsConfigJsonResolved } from 'get-tsconfig'
import { packageUpSync } from 'package-up'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { inferModuleFormat } from '../src/module-format'

vi.mock('package-up', () => ({
  packageUpSync: vi.fn(),
}))

function tsconfigWithModule(module: string): TsConfigJsonResolved {
  return { compilerOptions: { module } } as TsConfigJsonResolved
}

const tempDirs: string[] = []

afterEach(() => {
  vi.mocked(packageUpSync).mockReset()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeTempPackageJson(packageJson: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-format-test-'))
  tempDirs.push(dir)
  const packageJsonPath = path.join(dir, 'package.json')
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson))
  return packageJsonPath
}

describe('inferModuleFormat', () => {
  test('module: commonjs is always cjs, regardless of package.json', () => {
    vi.mocked(packageUpSync).mockReturnValue(writeTempPackageJson({ type: 'module' }))

    expect(
      inferModuleFormat({
        tsconfig: tsconfigWithModule('commonjs'),
        generatedFileExtension: 'ts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('cjs')
  })

  test('module: esnext is always esm, regardless of package.json', () => {
    vi.mocked(packageUpSync).mockReturnValue(writeTempPackageJson({}))

    expect(
      inferModuleFormat({
        tsconfig: tsconfigWithModule('esnext'),
        generatedFileExtension: 'ts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('esm')
  })

  test.each(['node16', 'nodenext', 'NodeNext', 'Node16'])(
    'module: %s infers esm when the nearest package.json has "type": "module"',
    (module) => {
      vi.mocked(packageUpSync).mockReturnValue(writeTempPackageJson({ type: 'module' }))

      expect(
        inferModuleFormat({
          tsconfig: tsconfigWithModule(module),
          generatedFileExtension: 'ts',
          importFileExtension: 'js',
          outputDir: '/irrelevant',
        }),
      ).toBe('esm')
    },
  )

  test.each(['node16', 'nodenext'])(
    'module: %s infers cjs when the nearest package.json has no "type" field',
    (module) => {
      vi.mocked(packageUpSync).mockReturnValue(writeTempPackageJson({}))

      expect(
        inferModuleFormat({
          tsconfig: tsconfigWithModule(module),
          generatedFileExtension: 'ts',
          importFileExtension: 'js',
          outputDir: '/irrelevant',
        }),
      ).toBe('cjs')
    },
  )

  test('module: nodenext infers cjs when the nearest package.json has "type": "commonjs"', () => {
    vi.mocked(packageUpSync).mockReturnValue(writeTempPackageJson({ type: 'commonjs' }))

    expect(
      inferModuleFormat({
        tsconfig: tsconfigWithModule('nodenext'),
        generatedFileExtension: 'ts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('cjs')
  })

  test('module: nodenext infers cjs when no package.json can be found', () => {
    vi.mocked(packageUpSync).mockReturnValue(undefined)

    expect(
      inferModuleFormat({
        tsconfig: tsconfigWithModule('nodenext'),
        generatedFileExtension: 'ts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('cjs')
  })

  test('falls back to the extension-based heuristic when tsconfig has no "module" set', () => {
    expect(
      inferModuleFormat({
        tsconfig: { compilerOptions: {} } as TsConfigJsonResolved,
        generatedFileExtension: 'cts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('cjs')

    expect(
      inferModuleFormat({
        tsconfig: undefined,
        generatedFileExtension: 'ts',
        importFileExtension: 'cjs',
        outputDir: '/irrelevant',
      }),
    ).toBe('cjs')

    expect(
      inferModuleFormat({
        tsconfig: undefined,
        generatedFileExtension: 'ts',
        importFileExtension: 'js',
        outputDir: '/irrelevant',
      }),
    ).toBe('esm')

    expect(packageUpSync).not.toHaveBeenCalled()
  })
})
