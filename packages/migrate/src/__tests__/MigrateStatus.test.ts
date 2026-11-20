import { MigrateStatus } from '../commands/MigrateStatus'
import { describeMatrix, postgresOnly, sqliteOnly } from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

describe('prisma.config.ts', () => {
  it('should require a datasource in the config', async () => {
    ctx.fixture('no-config')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The datasource.url property is required in your Prisma config file when using prisma migrate status."`,
    )
  })
})

describe('common', () => {
  it('should fail if no schema file', async () => {
    ctx.fixture('empty')
    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
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

describeMatrix(sqliteOnly, 'SQLite', () => {
  it('should fail if no sqlite db - empty schema', async () => {
    ctx.fixture('schema-only-sqlite')
    ctx.setConfigFile('empty.config.ts')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"P1003: Database \`dev.db\` does not exist"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('existing-db-1-failed-migration', async () => {
    ctx.fixture('existing-db-1-failed-migration')
    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "Following migration have failed:
      20201231000000_failed

      During development if the failed migration(s) have not been deployed to a production database you can then fix the migration(s) and run prisma migrate dev.

      The failed migration(s) can be marked as rolled back or applied:

      - If you rolled back the migration(s) manually:
      prisma migrate resolve --rolled-back "20201231000000_failed"

      - If you fixed the database manually (hotfix):
      prisma migrate resolve --applied "20201231000000_failed"

      Read more about how to resolve migration issues in a production database:
      https://pris.ly/d/migrate-resolve"
    `)
    expect(ctx.recordedExitCode()).toBe(1)
  })

  it('should error when database needs to be baselined', async () => {
    ctx.fixture('baseline-sqlite')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      No migration found in prisma/migrations
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "The current database is not managed by Prisma Migrate.

      Read more about how to baseline an existing production database:
      https://pris.ly/d/migrate-baseline"
    `)
    expect(ctx.recordedExitCode()).toBe(1)
  })

  it('existing-db-1-migration', async () => {
    ctx.fixture('existing-db-1-migration')
    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"Database schema is up to date!"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('schema-folder-db-exists', async () => {
    ctx.fixture('schema-folder-sqlite-db-exists')
    ctx.setConfigFile('folder.config.ts')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"Database schema is up to date!"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('existing-db-1-migration-conflict', async () => {
    ctx.fixture('existing-db-1-migration-conflict')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations
      Following migration have not yet been applied:
      20201231000000_init

      To apply migrations in development run prisma migrate dev.
      To apply migrations in production run prisma migrate deploy.
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.recordedExitCode()).toBe(1)
  })

  it('existing-db-brownfield', async () => {
    ctx.fixture('existing-db-brownfield')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      No migration found in prisma/migrations
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "The current database is not managed by Prisma Migrate.

      Read more about how to baseline an existing production database:
      https://pris.ly/d/migrate-baseline"
    `)
    expect(ctx.recordedExitCode()).toBe(1)
  })

  it('existing-db-warnings', async () => {
    ctx.fixture('existing-db-warnings')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      No migration found in prisma/migrations
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "The current database is not managed by Prisma Migrate.

      Read more about how to baseline an existing production database:
      https://pris.ly/d/migrate-baseline"
    `)
    expect(ctx.recordedExitCode()).toBe(1)
  })

  it('reset', async () => {
    ctx.fixture('reset')
    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`"Database schema is up to date!"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      1 migration found in prisma/migrations

      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })

  it('existing-db-histories-diverge', async () => {
    ctx.fixture('existing-db-histories-diverge')

    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 1"`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      2 migrations found in prisma/migrations
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`
      "Your local migration history and the migrations table from your database are different:

      The last common migration is: 20201231000000_init

      The migration have not yet been applied:
      20201231000000_catage

      The migration from the database are not found locally in prisma/migrations:
      20201231000000_dogage"
    `)
    expect(ctx.recordedExitCode()).toBe(1)
  })
})

describeMatrix(postgresOnly, 'postgres', () => {
  it('should fail if cannot connect', async () => {
    ctx.fixture('schema-only-postgresql')
    ctx.setConfigFile('invalid-url.config.ts')
    const result = MigrateStatus.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      "P1001: Can't reach database server at \`doesnotexist:5432\`

      Please make sure your database server is running at \`doesnotexist:5432\`."
    `)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/invalid-url.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "mydb", schema "public" <location placeholder>
      "
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot('""')
  })
})
