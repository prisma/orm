/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import path from 'node:path'

import { vitestContext } from '@prisma/get-platform/src/test-utils/vitestContext'
import type { ParseError } from 'effect/ParseResult'
import { PrismaConfigInternal } from 'src/PrismaConfig'
import { beforeEach, describe, expect, it, test, vi } from 'vitest'

import { defaultConfig } from '../defaultConfig'
import {
  findPrismaConfigFile,
  loadConfigFromFile,
  type LoadConfigFromFileError,
  SUPPORTED_EXTENSIONS,
} from '../loadConfigFromFile'

const ctx = vitestContext.new().assemble()

describe('loadConfigFromFile', () => {
  function assertConfigDefined(config: PrismaConfigInternal | undefined): asserts config is PrismaConfigInternal {
    expect(config).toBeDefined()
  }

  function assertErrorConfigLoadError(error: LoadConfigFromFileError | undefined): asserts error is {
    _tag: 'ConfigLoadError'
    error: Error
  } {
    expect(error).toMatchObject({ _tag: 'ConfigLoadError' })
  }

  function assertErrorConfigFileSyntaxError(error: LoadConfigFromFileError | undefined): asserts error is {
    _tag: 'ConfigFileSyntaxError'
    error: ParseError
  } {
    expect(error).toMatchObject({ _tag: 'ConfigFileSyntaxError' })
  }

  describe('no-define-config', () => {
    it('successfully loads a Prisma config file that does not use the `defineConfig` function', async () => {
      ctx.fixture('loadConfigFromFile/no-define-config')
      const cwd = ctx.fs.cwd()

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
      expect(error).toBeUndefined()
      assertConfigDefined(config)
      expect(config).toMatchObject({
        experimental: {
          externalTables: true,
        },
        schema: path.join(cwd, 'schema.prisma'),
        tables: {
          external: ['table1', 'specific_schema.table2'],
        },
      })
    })

    test('when `datasource` configuration is provided, it should set the datasource URLs', async () => {
      ctx.fixture('loadConfigFromFile/datasource')

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
      expect(error).toBeUndefined()
      assertConfigDefined(config)
      expect(config.datasource).toMatchObject({
        url: 'postgresql://DATABASE_URL',
        shadowDatabaseUrl: 'postgresql://SHADOW_DATABASE_URL',
      })
    })
  })

  describe('paths', () => {
    it('supports relative paths', async () => {
      ctx.fixture('loadConfigFromFile/relative-paths')
      const cwd = ctx.fs.cwd()

      const { config, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
        schema: path.join(cwd, 'custom', 'schema.prisma'),
        migrations: {
          path: path.join(cwd, 'custom', 'migrations'),
        },
        typedSql: {
          path: path.join(cwd, 'custom', 'typedSql'),
        },
        views: {
          path: path.join(cwd, 'custom', 'views'),
        },
      })
    }, 15_000) // Somehow, this test is flaky on Windows, so we increase the timeout

    it('supports absolute paths', async () => {
      ctx.fixture('loadConfigFromFile/absolute-paths')
      const cwd = ctx.fs.cwd()

      const { config, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
        schema: path.join(cwd, 'custom', 'schema.prisma'),
        migrations: {
          path: path.join(cwd, 'custom', 'migrations'),
        },
        typedSql: {
          path: path.join(cwd, 'custom', 'typedSql'),
        },
        views: {
          path: path.join(cwd, 'custom', 'views'),
        },
      })
    }, 15_000) // Somehow, this test is flaky on Windows, so we increase the timeout
  })

  describe('tables', () => {
    it('loads tables config', async () => {
      ctx.fixture('loadConfigFromFile/tables')
      const { config, error } = await loadConfigFromFile({})
      expect(config).toMatchObject({
        tables: {
          external: ['table1', 'specific_schema.table2'],
        },
      })
      expect(error).toBeUndefined()
    })
  })

  describe('enums', () => {
    it('loads enums config', async () => {
      ctx.fixture('loadConfigFromFile/enums')
      const { config, error } = await loadConfigFromFile({})
      expect(config).toMatchObject({
        enums: {
          external: ['some_enum'],
        },
      })
      expect(error).toBeUndefined()
    })
  })

  describe('migrations', () => {
    it('loads initShadowDb', async () => {
      ctx.fixture('loadConfigFromFile/setup-external-tables')
      const { config, error } = await loadConfigFromFile({})
      expect(config).toMatchObject({
        migrations: {
          initShadowDb: `CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL);`,
        },
      })
      expect(error).toBeUndefined()
    })
  })

  describe('schema', () => {
    describe('single', () => {
      it('succeeds when it points to a single Prisma schema file that exists via an absolute path', async () => {
        ctx.fixture('loadConfigFromFile/schema/single-exists')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema.prisma'),
        })
      })

      it('[.config/prisma.ts] succeeds when it points to a single Prisma schema file that exists via an absolute path', async () => {
        ctx.fixture('loadConfigFromFile/schema/with-config-dir-proposal/single-exists')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, '.config', 'prisma.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema.prisma'),
        })
      })

      it('succeeds when it points to a single Prisma schema file that exists via a relative path', async () => {
        ctx.fixture('loadConfigFromFile/schema/single-exists-relative')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema.prisma'),
        })
      })

      it('[.config/prisma.ts] succeeds when it points to a single Prisma schema file that exists via a relative path', async () => {
        ctx.fixture('loadConfigFromFile/schema/with-config-dir-proposal/single-exists-relative')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, '.config', 'prisma.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema.prisma'),
        })
      })

      it('succeeds when it points to a single Prisma schema file that does not exists', async () => {
        ctx.fixture('loadConfigFromFile/schema/single-does-not-exist')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema.prisma'),
        })
      })
    })

    describe('multi', () => {
      it('succeeds when it points to multiple Prisma schema files that exist via an absolute path', async () => {
        ctx.fixture('loadConfigFromFile/schema/multi-exist')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })

      it('[.config/prisma.ts] succeeds when it points to multiple Prisma schema files that exist via an absolute path', async () => {
        ctx.fixture('loadConfigFromFile/schema/with-config-dir-proposal/multi-exist')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, '.config', 'prisma.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })

      it('succeeds when it points to multiple Prisma schema files that exist via a relative path ', async () => {
        ctx.fixture('loadConfigFromFile/schema/multi-exist-relative')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })

      it('[.config/prisma.ts] succeeds when it points to multiple Prisma schema files that exist via a relative path ', async () => {
        ctx.fixture('loadConfigFromFile/schema/with-config-dir-proposal/multi-exist-relative')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, '.config', 'prisma.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })

      it('succeeds when it points to multiple Prisma schema files that do not exist', async () => {
        ctx.fixture('loadConfigFromFile/schema/multi-do-not-exist')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, 'prisma.config.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })

      it('[.config/prisma.ts] succeeds when it points to multiple Prisma schema files that do not exist', async () => {
        ctx.fixture('loadConfigFromFile/schema/with-config-dir-proposal/multi-do-not-exist')
        const cwd = ctx.fs.cwd()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(cwd, '.config', 'prisma.ts'))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
          schema: path.join(cwd, 'prisma', 'schema'),
        })
      })
    })
  })

  describe('invalid', () => {
    it('fails with `ConfigLoadError` when the Prisma config file has a syntax error', async () => {
      ctx.fixture('loadConfigFromFile/invalid/syntax-error')

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
      expect(config).toBeUndefined()
      assertErrorConfigLoadError(error)

      const { message: errorMessage } = error.error
      const { normalisedPath } = (() => {
        if (process.platform === 'win32') {
          const actualPath = resolvedPath.replace(/\\/g, '/')
          return { normalisedPath: actualPath }
        } else {
          return { normalisedPath: resolvedPath }
        }
      })()

      expect(errorMessage).toContain('ParseError:')
      expect(errorMessage).toContain('Unexpected token')
      expect(errorMessage).toContain(normalisedPath)
    })

    // TODO: if we want to support the behavior of this test suite, we need c12@2.0.1, jiti@2.2.0, or we need to patch
    // https://github.com/unjs/c12/blob/1efbcbce0e094a8f8a0ba676324affbef4a0ba8b/src/loader.ts#L401-L403 to remove
    // `{ default: true }` from `jiti!.import(...)` and explicitly look for `configModule['default']` in `loadConfigFromFile`.
    describe.skip('default-export', () => {
      it('fails with `ConfigFileSyntaxError` when the Prisma config file has no default export', async () => {
        ctx.fixture('loadConfigFromFile/invalid/no-default-export')

        // const { createJiti } = await import('jiti')
        // const jiti = createJiti(path.join(ctx.fs.cwd(), 'prisma.config'), {
        //   interopDefault: false,
        //   moduleCache: false,
        //   extensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
        // })

        // const modDefault = await jiti.import(path.join(ctx.fs.cwd(), 'prisma.config'), { default: true })
        // expect(modDefault).toEqual({})

        // const mod = await jiti.import(path.join(ctx.fs.cwd(), 'prisma.config'))
        // expect(mod).toEqual({})
        // // @ts-ignore
        // expect(mod['default']).toBeUndefined()

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
        expect(config).toBeUndefined()
        assertErrorConfigFileSyntaxError(error)
        expect(error.error.message.replaceAll(resolvedPath!, '<prisma-config>.ts')).toMatchInlineSnapshot(`
          "{ readonly experimental?: { readonly externalTables?: boolean | undefined; readonly extensions?: boolean | undefined } | undefined; readonly datasource?: { readonly url: string; readonly shadowDatabaseUrl?: string | undefined } | undefined; readonly schema?: string | undefined; readonly migrations?: { readonly path?: string | undefined; readonly initShadowDb?: string | undefined; readonly seed?: NonEmptyString | undefined } | undefined; readonly tables?: { readonly external?: ReadonlyArray<string> | undefined } | undefined; readonly enums?: { readonly external?: ReadonlyArray<string> | undefined } | undefined; readonly views?: { readonly path?: string | undefined } | undefined; readonly typedSql?: { readonly path?: string | undefined } | undefined; readonly extensions?: any | undefined; readonly loadedFromFile: string | null }
          └─ ["__esModule"]
             └─ is unexpected, expected: "experimental" | "datasource" | "schema" | "migrations" | "tables" | "enums" | "views" | "typedSql" | "extensions" | "loadedFromFile""
        `)
      })

      it(`fails with \`ConfigFileSyntaxError\` when the default export in the Prisma config file does
            not conform to the expected schema shape`, async () => {
        ctx.fixture('loadConfigFromFile/invalid/no-schema-shape-conformance')

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
        expect(config).toBeUndefined()
        assertErrorConfigFileSyntaxError(error)
        expect(error.error.message.replaceAll(resolvedPath!, '<prisma-config>.ts')).toMatchInlineSnapshot(`
          "{ readonly experimental?: { readonly externalTables?: boolean | undefined; readonly extensions?: boolean | undefined } | undefined; readonly datasource?: { readonly url: string; readonly shadowDatabaseUrl?: string | undefined } | undefined; readonly schema?: string | undefined; readonly migrations?: { readonly path?: string | undefined; readonly initShadowDb?: string | undefined; readonly seed?: NonEmptyString | undefined } | undefined; readonly tables?: { readonly external?: ReadonlyArray<string> | undefined } | undefined; readonly enums?: { readonly external?: ReadonlyArray<string> | undefined } | undefined; readonly views?: { readonly path?: string | undefined } | undefined; readonly typedSql?: { readonly path?: string | undefined } | undefined; readonly extensions?: any | undefined; readonly loadedFromFile: string | null }
          └─ ["thisShouldFail"]
             └─ is unexpected, expected: "experimental" | "datasource" | "schema" | "migrations" | "tables" | "enums" | "views" | "typedSql" | "extensions" | "loadedFromFile""
        `)
      })
    })
  })

  describe('Prisma 7-specific discovery', () => {
    function writeConfig(configPath: string, config: Record<string, unknown> = {}) {
      const extension = path.extname(configPath)
      const serializedConfig = JSON.stringify(config)
      const source = ['.js', '.cjs'].includes(extension)
        ? `module.exports = ${serializedConfig}`
        : `export default ${serializedConfig}`

      ctx.fs.write(configPath, source)
    }

    describe('non-executing legacy selection', () => {
      describe.each([
        { basename: 'prisma.config', description: 'prisma.config' },
        { basename: path.join('.config', 'prisma'), description: '.config/prisma' },
        { basename: path.join('.config', 'prisma.config'), description: '.config/prisma.config' },
      ])('$description', ({ basename }) => {
        it.each(SUPPORTED_EXTENSIONS)('discovers the flat%s config', (extension) => {
          ctx.fixture('loadConfigFromFile/default-location/ignore')
          const configPath = `${basename}${extension}`
          writeConfig(configPath)

          expect(findPrismaConfigFile(ctx.fs.cwd())).toBe(path.join(ctx.fs.cwd(), configPath))
        })

        it.each(SUPPORTED_EXTENSIONS)('discovers index%s', (extension) => {
          ctx.fixture('loadConfigFromFile/default-location/ignore')
          const configPath = path.join(basename, `index${extension}`)
          writeConfig(configPath)

          expect(findPrismaConfigFile(ctx.fs.cwd())).toBe(path.join(ctx.fs.cwd(), configPath))
        })
      })

      it.each(['.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml'])(
        'does not select the legacy %s data format',
        (extension) => {
          ctx.fixture('loadConfigFromFile/default-location/ignore')
          writeConfig(`prisma.config${extension}`)

          expect(findPrismaConfigFile(ctx.fs.cwd())).toBeNull()
        },
      )

      it.each([
        {
          selected: path.join('prisma.config', 'index.cts'),
          lowerPrecedence: path.join('.config', 'prisma.js'),
        },
        {
          selected: path.join('.config', 'prisma', 'index.cts'),
          lowerPrecedence: path.join('.config', 'prisma.config.js'),
        },
      ])('matches c12 when $selected competes with $lowerPrecedence', async ({ selected, lowerPrecedence }) => {
        ctx.fixture('loadConfigFromFile/default-location/ignore')
        writeConfig(selected)
        writeConfig(lowerPrecedence)

        const { error, resolvedPath } = await loadConfigFromFile({})

        expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), selected))
        expect(findPrismaConfigFile(ctx.fs.cwd())).toBe(resolvedPath)
        expect(error).toBeUndefined()
      })

      it.each([
        { selected: 'prisma.config.cts', index: path.join('prisma.config', 'index.js') },
        {
          selected: path.join('.config', 'prisma.cts'),
          index: path.join('.config', 'prisma', 'index.js'),
        },
        {
          selected: path.join('.config', 'prisma.config.cts'),
          index: path.join('.config', 'prisma.config', 'index.js'),
        },
      ])('matches c12 flat-before-index precedence for $selected', async ({ selected, index }) => {
        ctx.fixture('loadConfigFromFile/default-location/ignore')
        writeConfig(selected)
        writeConfig(index)

        const { error, resolvedPath } = await loadConfigFromFile({})

        expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), selected))
        expect(findPrismaConfigFile(ctx.fs.cwd())).toBe(resolvedPath)
        expect(error).toBeUndefined()
      })
    })

    describe.each([
      { directory: '', basename: 'prisma7.config' },
      { directory: '.config', basename: 'prisma7' },
    ])('$directory', ({ directory, basename }) => {
      describe.each(SUPPORTED_EXTENSIONS)('extension: %s', (extension) => {
        it('discovers the versioned config before a legacy config', async () => {
          ctx.fixture('loadConfigFromFile/default-location/ignore')
          const configPath = path.join(directory, `${basename}${extension}`)
          writeConfig(configPath)
          writeConfig('prisma.config.js')

          const { config, error, resolvedPath } = await loadConfigFromFile({})

          expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), configPath))
          expect(config).toMatchObject({ loadedFromFile: resolvedPath })
          expect(error).toBeUndefined()
        })
      })
    })

    it.each([
      { directory: '', basename: 'prisma7.config', location: 'root' },
      { directory: '.config', basename: 'prisma7', location: '.config' },
    ])('uses extension precedence within the $location location', async ({ directory, basename }) => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      for (const extension of SUPPORTED_EXTENSIONS) {
        writeConfig(path.join(directory, `${basename}${extension}`))
      }

      const { error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), directory, `${basename}.js`))
      expect(error).toBeUndefined()
    })

    it('uses every root candidate before the .config location', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      writeConfig('prisma7.config.cts')
      writeConfig(path.join('.config', 'prisma7.js'))

      const { error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), 'prisma7.config.cts'))
      expect(error).toBeUndefined()
    })

    it('uses every versioned candidate before legacy discovery', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      writeConfig(path.join('.config', 'prisma7.cts'))
      writeConfig('prisma.config.js')

      const { error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), '.config', 'prisma7.cts'))
      expect(error).toBeUndefined()
    })

    it('keeps an explicit config path authoritative', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      writeConfig('prisma7.config.js', { schema: 'versioned/schema.prisma' })
      writeConfig(path.join('custom', 'selected.ts'), { schema: 'explicit/schema.prisma' })

      const { config, error, resolvedPath } = await loadConfigFromFile({
        configFile: path.join('custom', 'selected.ts'),
      })

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), 'custom', 'selected.ts'))
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
        schema: path.join(ctx.fs.cwd(), 'custom', 'explicit', 'schema.prisma'),
      })
      expect(error).toBeUndefined()
    })

    it.each([
      { configPath: 'prisma7.config.ts', description: 'Prisma 7-specific' },
      { configPath: path.join('custom', 'selected.ts'), description: 'custom' },
    ])('attributes an explicit invalid $description config to its requested path', async ({ configPath }) => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      ctx.fs.write(configPath, 'export default {')
      writeConfig(path.join('.config', 'prisma7.js'))
      writeConfig('prisma.config.js')
      const expectedResolvedPath = path.resolve(ctx.fs.cwd(), configPath)

      const { config, error, resolvedPath } = await loadConfigFromFile({ configFile: configPath })

      expect(resolvedPath).toBe(expectedResolvedPath)
      expect(config).toBeUndefined()
      assertErrorConfigLoadError(error)
    })

    it('does not fall back when the selected versioned config fails to load', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      ctx.fs.write('prisma7.config.ts', 'export default {')
      writeConfig('prisma.config.js')

      const { config, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), 'prisma7.config.ts'))
      expect(config).toBeUndefined()
      assertErrorConfigLoadError(error)
      expect(error.error.message.replaceAll('\\', '/')).toContain(resolvedPath.replaceAll('\\', '/'))
    })

    it('does not fall back when the selected versioned config fails validation', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')
      writeConfig(path.join('.config', 'prisma7.ts'), { unsupportedProperty: true })
      writeConfig('prisma.config.js')

      const { config, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), '.config', 'prisma7.ts'))
      expect(config).toBeUndefined()
      assertErrorConfigFileSyntaxError(error)
      expect(error.error.message).toContain('unsupportedProperty')
    })

    it.each([
      { fixture: 'loadConfigFromFile/default-location/ts', configPath: 'prisma.config.ts' },
      {
        fixture: 'loadConfigFromFile/default-location/with-config-dir-proposal',
        configPath: path.join('.config', 'prisma.ts'),
      },
    ])('preserves warning-free legacy fallback for $configPath', async ({ fixture, configPath }) => {
      ctx.fixture(fixture)

      const { config, diagnostics, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), configPath))
      expect(config).toMatchObject({ loadedFromFile: resolvedPath })
      expect(error).toBeUndefined()
      expect(diagnostics.map(({ _tag }) => _tag)).toEqual(['log'])
    })

    it('preserves warning-free default config when no config family exists', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')

      const { config, diagnostics, error, resolvedPath } = await loadConfigFromFile({})

      expect(resolvedPath).toBeNull()
      expect(config).toMatchObject(defaultConfig())
      expect(error).toBeUndefined()
      expect(diagnostics).toEqual([])
    })

    describe.each([{ configPath: 'prisma7.config.ts' }, { configPath: path.join('.config', 'prisma7.ts') }])(
      '$configPath',
      ({ configPath }) => {
        it('resolves relative paths from the selected config file', async () => {
          ctx.fixture('loadConfigFromFile/default-location/ignore')
          writeConfig(configPath, {
            schema: path.join('custom', 'schema.prisma'),
            migrations: { path: path.join('custom', 'migrations') },
            typedSql: { path: path.join('custom', 'typedSql') },
            views: { path: path.join('custom', 'views') },
          })
          const configDirectory = path.dirname(path.join(ctx.fs.cwd(), configPath))

          const { config, error, resolvedPath } = await loadConfigFromFile({})

          expect(resolvedPath).toBe(path.join(ctx.fs.cwd(), configPath))
          expect(config).toMatchObject({
            loadedFromFile: resolvedPath,
            schema: path.join(configDirectory, 'custom', 'schema.prisma'),
            migrations: { path: path.join(configDirectory, 'custom', 'migrations') },
            typedSql: { path: path.join(configDirectory, 'custom', 'typedSql') },
            views: { path: path.join(configDirectory, 'custom', 'views') },
          })
          expect(error).toBeUndefined()
        })
      },
    )
  })

  describe('precedence', () => {
    it('prisma.config.js is 1st choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.js'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    it('prisma.config.ts is 2nd choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await ctx.fs.removeAsync('prisma.config.js')

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    it('prisma.config.mjs is 3rd choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([ctx.fs.removeAsync('prisma.config.js'), ctx.fs.removeAsync('prisma.config.ts')])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.mjs'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    it('prisma.config.cjs is 4th choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.cjs'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    it('prisma.config.mts is 5th choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
        ctx.fs.removeAsync('prisma.config.cjs'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.mts'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    it('prisma.config.cts is 6th choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
        ctx.fs.removeAsync('prisma.config.cjs'),
        ctx.fs.removeAsync('prisma.config.mts'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.cts'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })

    // Note: As of c12@3.1.0, it tries loading `.json` even when such extension is excluded
    // from `jiti` or `jitiOptions.extensions`.
    // See: https://github.com/unjs/c12/blob/1efbcbce0e094a8f8a0ba676324affbef4a0ba8b/src/loader.ts#L443.
    it('prisma.config.json is 7th choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
        ctx.fs.removeAsync('prisma.config.cjs'),
        ctx.fs.removeAsync('prisma.config.mts'),
        ctx.fs.removeAsync('prisma.config.cts'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.json'))
      expect(error).toMatchObject({
        _tag: 'ConfigLoadError',
        error: {
          message: expect.stringContaining('Unsupported Prisma config file extension: .json'),
        },
      })
      expect(config).toBeUndefined()
    })

    // Note: As of c12@3.1.0, it tries loading `.jsonc` even when such extension is excluded
    // from `jiti` or `jitiOptions.extensions`.
    // This is because there's currently no way to exclude confbox options.
    // See: https://github.com/unjs/c12/blob/1efbcbce0e094a8f8a0ba676324affbef4a0ba8b/src/loader.ts#L44-L49.
    it('prisma.config.jsonc is 8th choice', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
        ctx.fs.removeAsync('prisma.config.cjs'),
        ctx.fs.removeAsync('prisma.config.mts'),
        ctx.fs.removeAsync('prisma.config.cts'),
        ctx.fs.removeAsync('prisma.config.json'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.jsonc'))
      expect(error).toMatchObject({
        _tag: 'ConfigLoadError',
        error: {
          message: expect.stringContaining('Unsupported Prisma config file extension: .jsonc'),
        },
      })
      expect(config).toBeUndefined()
    })

    it('.config/prisma.js is chosen when no other `prisma.config.*` exists', async () => {
      ctx.fixture('loadConfigFromFile/precedence')
      await Promise.all([
        ctx.fs.removeAsync('prisma.config.js'),
        ctx.fs.removeAsync('prisma.config.ts'),
        ctx.fs.removeAsync('prisma.config.mjs'),
        ctx.fs.removeAsync('prisma.config.cjs'),
        ctx.fs.removeAsync('prisma.config.mts'),
        ctx.fs.removeAsync('prisma.config.cts'),
        ctx.fs.removeAsync('prisma.config.json'),
        ctx.fs.removeAsync('prisma.config.jsonc'),
      ])

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), '.config', 'prisma.js'))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })
  })

  describe('default-location', () => {
    describe.each(SUPPORTED_EXTENSIONS)(`extension: %s`, (extension) => {
      it('succeeds when the Prisma config file exists and is in a valid format', async () => {
        ctx.fixture(`loadConfigFromFile/default-location/${extension.slice(1)}`)

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), `prisma.config${extension}`))
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
        })
        expect(error).toBeUndefined()
      })

      it('succeeds when the explicitly specified Prisma config file exists and is in a valid format', async () => {
        ctx.fixture(`loadConfigFromFile/default-location/${extension.slice(1)}`)

        const { config, error, resolvedPath } = await loadConfigFromFile({ configFile: `prisma.config${extension}` })
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), `prisma.config${extension}`))
        expect(error).toBeUndefined()
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
        })
      })
    })

    describe('.config', () => {
      it('succeeds when the Prisma config file exists and is in a valid format', async () => {
        ctx.fixture(`loadConfigFromFile/default-location/with-config-dir-proposal`)

        const { config, error, resolvedPath } = await loadConfigFromFile({})
        expect(error).toBeUndefined()
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), '.config', 'prisma.ts'))
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
        })
      })

      it('succeeds when the explicitly specified Prisma config file exists and is in a valid format', async () => {
        ctx.fixture(`loadConfigFromFile/default-location/with-config-dir-proposal`)

        const { config, error, resolvedPath } = await loadConfigFromFile({
          configFile: path.join(ctx.fs.cwd(), '.config', 'prisma.ts'),
        })
        expect(error).toBeUndefined()
        expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), '.config', 'prisma.ts'))
        expect(config).toMatchObject({
          loadedFromFile: resolvedPath,
        })
      })
    })

    it('fails when trying to load a .json config file', async () => {
      ctx.fixture('loadConfigFromFile/default-location/json')

      const { config, error, resolvedPath } = await loadConfigFromFile({ configFile: 'prisma.config.json' })
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.json'))
      expect(config).toBeUndefined()
      expect(error).toMatchObject({
        _tag: 'ConfigLoadError',
        error: {
          message: expect.stringContaining('Unsupported Prisma config file extension: .json'),
        },
      })
    })

    it('fails when trying to load a .rc config file', async () => {
      ctx.fixture('loadConfigFromFile/default-location/rc')

      const { config, error, resolvedPath } = await loadConfigFromFile({ configFile: 'prisma.config.rc' })
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.rc'))
      expect(config).toBeUndefined()
      expect(error).toMatchObject({
        _tag: 'ConfigLoadError',
        error: {
          message: expect.stringContaining('Unknown file extension ".rc"'),
        },
      })
    })

    it('fails when the explicitly specified Prisma config file does not exist', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ts')

      const { config, error, resolvedPath } = await loadConfigFromFile({ configFile: 'prisma.config.js' })
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.js'))
      expect(config).toBeUndefined()
      expect(error).toMatchObject({
        _tag: 'ConfigFileNotFound',
      })
    })

    it('returns default config when the Prisma config file does not exist', async () => {
      ctx.fixture('loadConfigFromFile/default-location/ignore')

      const { config, error, resolvedPath } = await loadConfigFromFile({})
      expect(resolvedPath).toBeNull()
      expect(error).toBeUndefined()
      expect(config).toMatchObject(defaultConfig())
    })
  })

  describe('custom-location', () => {
    beforeEach(() => {
      ctx.fixture('loadConfigFromFile/custom-location')
    })

    it('fails when the given file does not exist', async () => {
      const customConfigPath = path.join('does', 'not', 'exist.ts')

      const { config, error, resolvedPath } = await loadConfigFromFile({
        configFile: customConfigPath,
      })
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), customConfigPath))
      expect(error).toMatchObject({ _tag: 'ConfigFileNotFound' })
      expect(config).toBeUndefined()
    })

    it('succeeds when TypeScript file exists and is in a valid format', async () => {
      const customConfigPath = path.join('valid', 'prisma-config.ts')

      const { config, error, resolvedPath } = await loadConfigFromFile({
        configFile: customConfigPath,
      })
      expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), customConfigPath))
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })
    })
  })

  it('typescript-cjs-ext-ts', async () => {
    ctx.fixture('loadConfigFromFile/typescript-cjs-ext-ts')

    const { config, error, resolvedPath } = await loadConfigFromFile({})
    expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
    expect(config).toMatchObject({
      experimental: {
        externalTables: true,
      },
      tables: {
        external: ['table1', 'specific_schema.table2'],
      },
      loadedFromFile: resolvedPath,
    })
    expect(error).toBeUndefined()
  })

  it('typescript-esm-ext-ts', async () => {
    ctx.fixture('loadConfigFromFile/typescript-esm-ext-ts')

    const { config, error, resolvedPath } = await loadConfigFromFile({})
    expect(resolvedPath).toMatch(path.join(ctx.fs.cwd(), 'prisma.config.ts'))
    expect(config).toMatchObject({
      experimental: {
        externalTables: true,
      },
      tables: {
        external: ['table1', 'specific_schema.table2'],
      },
      loadedFromFile: resolvedPath,
    })
    expect(error).toBeUndefined()
  })

  describe('environment variables', () => {
    function assertLoadConfigFromFileErrorIsUndefined(
      error: LoadConfigFromFileError | undefined,
    ): asserts error is undefined {
      expect(error).toBeUndefined()
    }

    it('succeeds when a property is set to undefined via env var', async () => {
      ctx.fixture('loadConfigFromFile/datasource-url-undefined')
      const { config, error } = await loadConfigFromFile({})
      expect(error).toBeUndefined()
      expect(config).toMatchObject({
        datasource: {
          url: undefined,
        },
      })
    })

    it('fails when a property is using the `env` helper with an undefined env var', async () => {
      ctx.fixture('loadConfigFromFile/datasource-url-undefined-env')
      const { config, error } = await loadConfigFromFile({})
      expect(config).toBeUndefined()
      assertErrorConfigLoadError(error)
      expect(error).toMatchObject({
        _tag: 'ConfigLoadError',
        error: {
          name: 'PrismaConfigEnvError',
          message: 'Cannot resolve environment variable: UNDEFINED_VARIABLE.',
        },
      })
    })

    test('if no custom env-var loading function is imported, it should skip loading any environment variables', async () => {
      vi.stubEnv('TEST_CONNECTION_STRING', undefined)

      ctx.fixture('loadConfigFromFile/env-baseline')
      const { config, error } = await loadConfigFromFile({})
      assertLoadConfigFromFileErrorIsUndefined(error)
      expect(config).toMatchObject({})

      expect(process.env.TEST_CONNECTION_STRING).toBeUndefined()
    })

    test('if a sync custom env-var loading function is imported, it should load environment variables using the provided function', async () => {
      vi.stubEnv('TEST_CONNECTION_STRING', undefined)

      ctx.fixture('loadConfigFromFile/env-load-cjs')
      const { config, error } = await loadConfigFromFile({})
      assertLoadConfigFromFileErrorIsUndefined(error)
      expect(config).toMatchObject({})

      expect(process.env.TEST_CONNECTION_STRING).toEqual('postgres://test-connection-string-from-env-cjs')
    })

    test('if an async custom env-var loading function is used, it should load environment variables using the provided function', async () => {
      ctx.fixture('loadConfigFromFile/env-load-esm')
      const { config, error, resolvedPath } = await loadConfigFromFile({})

      assertLoadConfigFromFileErrorIsUndefined(error)
      expect(config).toMatchObject({
        loadedFromFile: resolvedPath,
      })

      expect(process.env.TEST_CONNECTION_STRING).toEqual('postgres://test-connection-string-from-env-esm')
    })
  })
})
