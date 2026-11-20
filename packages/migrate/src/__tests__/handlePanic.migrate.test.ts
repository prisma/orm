import { inferDirectoryConfig, loadSchemaContext, RustPanic } from '@prisma/internals'
import { join } from 'path'

import { Migrate } from '../Migrate'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

const isWindows = ['win32'].includes(process.platform)

describe('handlePanic migrate', () => {
  beforeEach(() => {
    jest.resetModules() // most important - it clears the cache
  })

  it('engine panic no interactive mode in CI', async () => {
    process.env.FORCE_PANIC_SCHEMA_ENGINE = '1'
    ctx.fixture('handle-panic')

    expect.assertions(isWindows ? 4 : 5)

    const schemaPath = join(ctx.tmpDir, 'schema.prisma')
    const schemaContext = await loadSchemaContext({ schemaPath: { cliProvidedPath: schemaPath } })
    const { migrationsDirPath } = inferDirectoryConfig(schemaContext)

    try {
      const migrate = await Migrate.setup({
        migrationsDirPath,
        schemaContext,
        schemaEngineConfig: await ctx.config(),
        baseDir: ctx.configDir(),
      })
      await migrate.createMigration({
        migrationName: 'setup',
        draft: false,
        schema: migrate.getPrismaSchema(),
      })
    } catch (e) {
      const error = e as RustPanic

      expect(error).toMatchInlineSnapshot(`
        "Error in Schema engine.
        Reason: [/some/rust/path:0:0] This is the debugPanic artificial panic
        "
      `)
      expect(JSON.parse(JSON.stringify(error))).toMatchObject({
        area: 'LIFT_CLI',
      })
      expect(error.message).toContain('This is the debugPanic artificial panic')
      expect(error.rustStack).toContain('[EXIT_PANIC]')

      if (!isWindows) {
        expect(error.rustStack).toContain('std::panicking::')
      }
    }
  })
})
