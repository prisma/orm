import prompt from 'prompts'

import { MigrateReset } from '../commands/MigrateReset'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

describe('prisma.config.ts', () => {
  it('should require a datasource in the config', async () => {
    ctx.fixture('no-config')

    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The datasource.url property is required in your Prisma config file when using prisma migrate reset."`,
    )
  })
})

describe('common', () => {
  it('wrong flag', async () => {
    const commandInstance = MigrateReset.new('prisma')
    const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

    await commandInstance.parse(['--something'], await ctx.config(), ctx.configDir())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('help flag', async () => {
    const commandInstance = MigrateReset.new('prisma')
    const spy = jest.spyOn(commandInstance, 'help').mockImplementation(() => 'Help Me')

    await commandInstance.parse(['--help'], await ctx.config(), ctx.configDir())
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('should fail if no schema file', async () => {
    ctx.fixture('empty')
    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "Could not find Prisma Schema that is required for this command.
      You can either provide it with \`--schema\` argument,
      set it in your Prisma Config file (e.g., \`prisma7.config.ts\`),
      set it as \`prisma.schema\` in your package.json,
      or put it into the default location (\`./prisma/schema.prisma\`, or \`./schema.prisma\`.
      Checked following paths:

      schema.prisma: file not found
      prisma/schema.prisma: file not found

      See also https://pris.ly/d/prisma-schema-location"
    `)
  })
})

describe('reset', () => {
  it('should work (prompt)', async () => {
    ctx.fixture('reset')

    prompt.inject(['y']) // simulate user yes input

    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>



      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql
      "
    `)
  })

  it('should work (--force)', async () => {
    ctx.fixture('reset')

    const result = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql
      "
    `)
  })

  it('should work with nested config and schema', async () => {
    ctx.fixture('prisma-config-nested-sqlite')
    ctx.setConfigFile('config/prisma.config.ts')

    const result = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      Database reset successful

      "
    `)
  })

  it('should work with folder (--force)', async () => {
    ctx.fixture('schema-folder-sqlite-migration-exists')

    ctx.setConfigFile('folder.config.ts')

    const result = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql
      "
    `)
  })

  it('with missing db', async () => {
    ctx.fixture('reset')
    ctx.fs.remove('prisma/dev.db')

    const result = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      The following migration(s) have been applied:

      migrations/
        └─ 20201231000000_init/
          └─ migration.sql
      "
    `)
  })

  it('without the migrations directory should fail (prompt)', async () => {
    ctx.fixture('reset')
    ctx.fs.remove('prisma/migrations')

    prompt.inject(['y']) // simulate user yes input

    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      "
    `)
  })

  it('should be cancelled if user send n (prompt)', async () => {
    ctx.fixture('reset')

    prompt.inject([new Error()]) // simulate user cancellation

    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Reset cancelled.
      "
    `)

    expect(ctx.recordedExitCode()).toEqual(130)
  })

  it('reset should error in unattended environment', async () => {
    ctx.fixture('reset')
    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      "Prisma Migrate has detected that the environment is non-interactive. It is recommended to run this command in an interactive environment.

      Use --force to run this command without user interaction.
      See https://pris.ly/d/migrate-reset"
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('rejects unsupported Accelerate URLs before printing datasource info', async () => {
    ctx.fixture('schema-only-data-proxy')
    ctx.setDatasource({
      url: 'prisma://aws-us-east-1.prisma-data.com/?api_key=MY_API_KEY',
    })

    const result = MigrateReset.new('prisma').parse(['--force'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      Using an Accelerate URL is not supported for this CLI command prisma migrate reset yet.
      Please use a direct connection to your database in \`prisma7.config.ts\`.

      More information about this limitation: https://pris.ly/d/accelerate-limitations
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toBe('')
  })

  test('reset - seed.js in prisma.config.ts', async () => {
    ctx.fixture('seed-from-prisma-config/seed-sqlite-js')
    prompt.inject(['y']) // simulate user yes input

    const result = MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>


      Database reset successful

      "
    `)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
