import path from 'node:path'

import { type ExecaChildProcess, execaNode } from 'execa'
import fs from 'fs-jetpack'
import type { FSJetpack, InspectTreeResult } from 'fs-jetpack/types'
import tempy from 'tempy'
import { afterEach, beforeEach, type MockInstance, vi } from 'vitest'

/**
 * Base test context.
 */
export type BaseContext = {
  tmpDir: string
  fs: FSJetpack
  mocked: {
    cwd: string
  }
  /**
   * Set up the temporary directory based on the contents of some fixture.
   */
  fixture: (name: string) => void
  /**
   * Spawn the Prisma cli using the temporary directory as the CWD.
   *
   * @remarks
   *
   * For this to work the source must be built
   */
  cli: (...input: string[]) => ExecaChildProcess<string>

  printDir(dir: string, extensions: string[]): void
  /**
   * JavaScript-friendly implementation of the `tree` command. It skips the `node_modules` directory.
   * @param itemPath The path to start the tree from, defaults to the root of the temporary directory
   * @param indent How much to indent each level of the tree, defaults to ''
   * @returns String representation of the directory tree
   */
  tree: (itemPath?: string, indent?: string) => void
}

/**
 * Create test context to use in tests. Provides the following:
 *
 * - A temporary directory
 * - an fs-jetpack instance bound to the temporary directory
 * - Mocked process.cwd via Node process.chdir
 * - Fixture loader for bootstrapping the temporary directory with content
 */
export const vitestContext = {
  new: function (ctx: BaseContext = {} as any) {
    const c = ctx as BaseContext

    beforeEach(() => {
      const originalCwd = process.cwd()

      c.mocked = c.mocked ?? {
        cwd: process.cwd(),
      }

      c.tmpDir = tempy.directory()
      c.fs = fs.cwd(c.tmpDir)
      c.tree = (startFrom = c.tmpDir, indent = '') => {
        function* generateDirectoryTree(children: InspectTreeResult[], indent = ''): Generator<String> {
          for (const child of children) {
            if (child.name === 'node_modules' || child.name === '.git') {
              continue
            }

            if (child.type === 'dir') {
              yield `${indent}└── ${child.name}/`
              yield* generateDirectoryTree(child.children, indent + '    ')
            } else if (child.type === 'symlink') {
              yield `${indent} -> ${child.relativePath}`
            } else {
              yield `${indent}└── ${child.name}`
            }
          }
        }

        const children = c.fs.inspectTree(startFrom, { relativePath: true, symlinks: 'report' })?.children || []

        return `
${[...generateDirectoryTree(children, indent)].join('\n')}
`
      }

      c.fixture = (name: string) => {
        // copy the specific fixture directory in isolated tmp directory
        c.fs.copy(path.join(originalCwd, 'src', '__tests__', 'fixtures', name), '.', {
          overwrite: true,
        })
        // symlink to local client version in tmp dir
        c.fs.symlink(path.join(originalCwd, '..', 'client'), path.join(c.fs.cwd(), 'node_modules', '@prisma', 'client'))
        c.fs.symlink(path.join(originalCwd, '..', 'config'), path.join(c.fs.cwd(), 'node_modules', '@prisma', 'config'))
      }

      c.cli = (...input) => {
        return execaNode(path.join(originalCwd, '../cli/build/index.js'), input, {
          cwd: c.fs.cwd(),
          stdio: 'pipe',
          all: true,
        })
      }
      c.printDir = (dir, extensions) => {
        const content = c.fs.list(dir) ?? []
        content.sort((a, b) => a.localeCompare(b))
        return content
          .filter((name) => extensions.includes(path.extname(name)))
          .map((name) => `${name}:\n\n${c.fs.read(path.join(dir, name))}`)
          .join('\n\n')
      }
      process.chdir(c.tmpDir)
    })

    afterEach(() => {
      process.chdir(c.mocked.cwd)
    })

    return factory(ctx)
  },
}

/**
 * A function that provides additional test context.
 */
type ContextContributor<Context, NewContext> = (ctx: Context) => Context & NewContext

/**
 * Main context builder API that permits recursively building up context.
 */

function factory<Context>(ctx: Context) {
  return {
    add<NewContext>(contextContributor: ContextContributor<Context, NewContext>) {
      const newCtx = contextContributor(ctx)
      return factory<Context & NewContext>(newCtx)
    },
    assemble(): Context {
      return ctx
    },
  }
}

/**
 * Test context contributor. Mocks console.error with a Vitest spy before each test.
 */

type ConsoleContext = {
  mocked: {
    'console.error': MockInstance<typeof console.error>
    'console.log': MockInstance<typeof console.log>
    'console.info': MockInstance<typeof console.info>
    'console.warn': MockInstance<typeof console.warn>
  }
}

export const vitestConsoleContext =
  <Ctx extends BaseContext>() =>
  (c: Ctx) => {
    const ctx = c as Ctx & ConsoleContext

    beforeEach(() => {
      ctx.mocked['console.error'] = vi.spyOn(console, 'error').mockImplementation(() => {})
      ctx.mocked['console.log'] = vi.spyOn(console, 'log').mockImplementation(() => {})
      ctx.mocked['console.info'] = vi.spyOn(console, 'info').mockImplementation(() => {})
      ctx.mocked['console.warn'] = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      ctx.mocked['console.error'].mockRestore()
      ctx.mocked['console.log'].mockRestore()
      ctx.mocked['console.info'].mockRestore()
      ctx.mocked['console.warn'].mockRestore()
    })

    return ctx
  }

/**
 * Test context contributor. Mocks process.std(out|err).write with a Vitest spy before each test.
 */

type ProcessContext = {
  mocked: {
    'process.stderr.write': MockInstance<typeof process.stderr.write>
    'process.stdout.write': MockInstance<typeof process.stdout.write>
  }
  normalizedCapturedStdout: () => string
  normalizedCapturedStderr: () => string
  clearCapturedStdout: () => void
  clearCapturedStderr: () => void
}

type NormalizationRule = [RegExp | string, string]

export type ProcessContextSettings = {
  normalizationRules: NormalizationRule[]
}

export const vitestStdoutContext =
  <Ctx extends BaseContext>({ normalizationRules }: ProcessContextSettings = { normalizationRules: [] }) =>
  (c: Ctx) => {
    const ctx = c as Ctx & ProcessContext

    const normalize = (text: string, rules: NormalizationRule[]) => {
      for (const [pattern, replacement] of rules) {
        text = text.replace(pattern, replacement)
      }
      return text
    }

    beforeEach(() => {
      ctx.mocked['process.stderr.write'] = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      ctx.mocked['process.stdout.write'] = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      ctx.normalizedCapturedStdout = () =>
        normalize(
          ctx.mocked['process.stdout.write'].mock.calls.map((call) => call[0] as string).join(''),
          normalizationRules,
        )
      ctx.normalizedCapturedStderr = () =>
        normalize(
          ctx.mocked['process.stderr.write'].mock.calls.map((call) => call[0] as string).join(''),
          normalizationRules,
        )
      ctx.clearCapturedStdout = () => ctx.mocked['process.stdout.write'].mockClear()
      ctx.clearCapturedStderr = () => ctx.mocked['process.stderr.write'].mockClear()
    })

    afterEach(() => {
      ctx.mocked['process.stderr.write'].mockRestore()
      ctx.mocked['process.stdout.write'].mockRestore()
    })

    return ctx
  }

/**
 * Test context contributor. Mocks process.exit with a spy and records the exit code.
 */

type ProcessExitContext = {
  mocked: {
    'process.exit': MockInstance<typeof process.exit>
  }
  recordedExitCode: () => number
}

export const vitestProcessExitContext =
  <C extends BaseContext>() =>
  (c: C) => {
    const ctx = c as C & ProcessExitContext

    beforeEach(() => {
      ctx.mocked['process.exit'] = vi.spyOn(process, 'exit').mockImplementation((number) => {
        throw new Error('process.exit: ' + number)
      })
      ctx.recordedExitCode = () => Number(ctx.mocked['process.exit'].mock.calls[0]?.[0] ?? 0)
    })

    afterEach(() => {
      ctx.mocked['process.exit'].mockRestore()
    })

    return ctx
  }

export const processExitContext = vitestProcessExitContext
