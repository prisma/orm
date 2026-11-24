import fs from 'node:fs/promises'
import path from 'node:path'

import prompt from 'prompts'

import { DbDrop } from '../commands/DbDrop'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

// TODO: prepare custom fixtures for `db drop`, which isn't used in the CLI.
describe('drop', () => {
  describe.each(['prisma', 'prisma7'] as const)('%s', (cliCommand) => {
    it('renders help with the selected executable', () => {
      const result = DbDrop.new(cliCommand).help()
      const otherCliCommand = cliCommand === 'prisma' ? 'prisma7' : 'prisma'

      expect(result).toContain(`${cliCommand} db drop [options] --preview-feature`)
      expect(result).not.toContain(`${otherCliCommand} db drop [options] --preview-feature`)
    })
  })

  describe('prisma.config.ts', () => {
    it('should require a datasource in the config', async () => {
      ctx.fixture('no-config')

      const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The datasource.url property is required in your Prisma config file when using prisma db drop."`,
      )
    })
  })

  it('requires --preview-feature flag', async () => {
    ctx.fixture('empty')

    const result = DbDrop.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "This feature is currently in Preview. There may be bugs and it's not recommended to use it in production environments.
      Please provide the --preview-feature flag to use this command."
    `)
  })

  it('should fail if no schema file', async () => {
    ctx.fixture('empty')

    const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
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

  it('with missing db should fail (prompt)', async () => {
    ctx.fixture('reset')
    ctx.fs.remove('dev.db')

    prompt.inject(['y']) // simulate user yes input

    const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"The database name entered "y" doesn't match "dev.db"."`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('with missing db should fail (--force)', async () => {
    ctx.fixture('reset')
    ctx.fs.remove('dev.db')

    const result = DbDrop.new('prisma').parse(['--preview-feature', '--force'], await ctx.config(), ctx.configDir())
    // Schema engine error:
    // Failed to delete SQLite database at \`dev.db\`.
    // On Linux/macOS:
    // No such file or directory (os error 2)
    // On Windows:
    // No such file or directory (os error 2)
    await expect(result).rejects.toThrow(`Failed to delete SQLite database at \`dev.db\`.`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('should work (prompt)', async () => {
    ctx.fixture('reset')

    prompt.inject(['dev.db']) // simulate user input

    const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toContain(`The SQLite database "dev.db" from "file:dev.db" was successfully dropped.`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('should work (--force)', async () => {
    ctx.fixture('reset')

    const result = DbDrop.new('prisma').parse(['--preview-feature', '--force'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toContain(`The SQLite database "dev.db" from "file:dev.db" was successfully dropped.`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('should work (-f)', async () => {
    ctx.fixture('reset')
    const result = DbDrop.new('prisma').parse(['--preview-feature', '-f'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toContain(`The SQLite database "dev.db" from "file:dev.db" was successfully dropped.`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('should work with nested config and schema', async () => {
    ctx.fixture('prisma-config-nested-sqlite')
    ctx.setConfigFile('config/prisma.config.ts')

    await fs.writeFile(path.join(ctx.configDir(), 'dev.db'), '')

    const result = DbDrop.new('prisma').parse(['--preview-feature', '-f'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toContain(`The SQLite database "dev.db" from "file:dev.db" was successfully dropped.`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('should be cancelled (prompt)', async () => {
    ctx.fixture('reset')
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((number) => {
      throw new Error('process.exit: ' + number)
    })

    prompt.inject([new Error()]) // simulate cancel

    const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>


      Drop cancelled.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(mockExit).toHaveBeenCalledWith(130)
  })

  it('should ask for --force if not provided if CI', async () => {
    ctx.fixture('reset')
    process.env.GITHUB_ACTIONS = '1'

    const result = DbDrop.new('prisma').parse(['--preview-feature'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(
      `"Use the --force flag to use the drop command in an unattended environment like prisma db drop --force --preview-feature"`,
    )
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  it('rejects unsupported Accelerate URLs before printing datasource info', async () => {
    ctx.fixture('schema-only-data-proxy')
    ctx.setDatasource({
      url: 'prisma://aws-us-east-1.prisma-data.com/?api_key=MY_API_KEY',
    })

    const result = DbDrop.new('prisma').parse(['--preview-feature', '--force'], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      Using an Accelerate URL is not supported for this CLI command prisma db drop yet.
      Please use a direct connection to your database in \`prisma7.config.ts\`.

      More information about this limitation: https://pris.ly/d/accelerate-limitations
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toBe('')
  })
})
