import path from 'path'
import prompt from 'prompts'

import { DbPush } from '../commands/DbPush'
import { Migrate } from '../Migrate'
import { agentMatchers } from '../utils/ai-safety'
import { setupMongo, SetupParams, tearDownMongo } from '../utils/setupMongo'
import { setupPostgres, tearDownPostgres } from '../utils/setupPostgres'
import { describeMatrix, mongodbOnly, postgresOnly } from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const ctx = createDefaultTestContext()

const agentEnvVars = [
  ...new Set(agentMatchers.flatMap((matcher) => matcher.envVars)),
  'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
]

beforeEach(() => {
  // Pushing data loss changes goes through the AI safety checkpoint, and the
  // tests themselves may be running under an AI agent, so the inherited
  // markers must be cleared before each test.
  for (const name of agentEnvVars) {
    delete process.env[name]
  }
})

describe('push', () => {
  // A test that requires docker (e.g, because it relies on extensions being installed)
  const inDockerIt = process.env.TEST_NO_DOCKER ? it.skip : it

  describe('prisma.config.ts', () => {
    it('should require a datasource in the config', async () => {
      ctx.fixture('no-config')

      const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The datasource.url property is required in your Prisma config file when using prisma db push."`,
      )
    })
  })

  it('should fail if no schema file', async () => {
    ctx.fixture('empty')

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
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

  it('should fail if nativeTypes VarChar on sqlite', async () => {
    ctx.fixture('nativeTypes-sqlite')
    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
      "P1012

      error: Native type VarChar is not supported for sqlite connector.
        -->  prisma/schema.prisma:11
         | 
      10 |   id   Int    @id
      11 |   name String @db.VarChar(100)
         | 

      "
    `)
  })

  it('already in sync', async () => {
    ctx.fixture('reset')
    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('should work with nested config and schema', async () => {
    ctx.fixture('prisma-config-nested-sqlite')
    ctx.setConfigFile('config/prisma.config.ts')

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": SQLite database "dev.db" <location placeholder>

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  inDockerIt('should load extensions from the config', async () => {
    ctx.fixture('prisma-config-extensions')
    const result = DbPush.new('prisma').parse(['--force-reset'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-prisma-config-extensions" <location placeholder>

      PostgreSQL database tests-migrate-prisma-config-extensions created at localhost:5432

      The PostgreSQL database "tests-migrate-prisma-config-extensions" at "localhost:5432" was successfully reset.

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('should ask for --accept-data-loss if not provided in CI', async () => {
    ctx.fixture('existing-db-warnings')
    process.env.GITHUB_ACTIONS = '1'

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(
      `"Use the --accept-data-loss flag to ignore the data loss warnings like prisma db push --accept-data-loss"`,
    )
  })

  it('dataloss warnings accepted (prompt)', async () => {
    ctx.fixture('existing-db-warnings')

    prompt.inject(['y'])

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      ⚠️  There might be data loss when applying the changes:

        • You are about to drop the \`Blog\` table, which is not empty (1 rows).




      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('dataloss warnings cancelled (prompt)', async () => {
    ctx.fixture('existing-db-warnings')

    prompt.inject([new Error()]) // simulate user cancellation

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      ⚠️  There might be data loss when applying the changes:

        • You are about to drop the \`Blog\` table, which is not empty (1 rows).



      Push cancelled.
      "
    `)

    expect(ctx.recordedExitCode()).toEqual(130)
  })

  it('--accept-data-loss flag', async () => {
    ctx.fixture('existing-db-warnings')
    const result = DbPush.new('prisma').parse(['--accept-data-loss'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      ⚠️  There might be data loss when applying the changes:

        • You are about to drop the \`Blog\` table, which is not empty (1 rows).



      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it.each(['--accept-data-loss', '--force-reset'])('%s triggers the AI safety checkpoint', async (flag) => {
    ctx.fixture('existing-db-warnings')
    process.env.CLAUDECODE = '1'

    const result = DbPush.new('prisma').parse([flag], await ctx.config(), ctx.configDir())

    await expect(result).rejects.toThrow('invoked by Claude Code')
  })

  it('interactive confirmation triggers the AI safety checkpoint', async () => {
    ctx.fixture('existing-db-warnings')
    process.env.CLAUDECODE = '1'
    const push = jest.spyOn(Migrate.prototype, 'push')

    prompt.inject(['y'])

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())

    await expect(result).rejects.toThrow('invoked by Claude Code')
    expect(push).not.toHaveBeenCalledWith({ force: true })
  })

  it('unexecutable - drop allowed (--force-reset)', async () => {
    ctx.fixture('existing-db-1-unexecutable-schema-change')

    const sqliteDbSizeBefore = ctx.fs.inspect('dev.db')!.size

    const result = DbPush.new('prisma').parse(['--force-reset'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    const sqliteDbSizeAfter = ctx.fs.inspect('dev.db')!.size

    expect(sqliteDbSizeBefore).toBeGreaterThan(10_000)
    expect(sqliteDbSizeAfter).toBeGreaterThan(10_000)
    expect(sqliteDbSizeAfter).toBeLessThan(sqliteDbSizeBefore)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      The SQLite database "dev.db" at "file:dev.db" was successfully reset.

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('unexecutable - drop refused', async () => {
    ctx.fixture('existing-db-warnings')

    prompt.inject([new Error()]) // simulate user cancellation

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`"process.exit: 130"`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      ⚠️  There might be data loss when applying the changes:

        • You are about to drop the \`Blog\` table, which is not empty (1 rows).



      Push cancelled.
      "
    `)

    expect(ctx.recordedExitCode()).toEqual(130)
  })

  it('unexecutable - should ask for --force-reset in CI', async () => {
    ctx.fixture('existing-db-1-unexecutable-schema-change')
    process.env.GITHUB_ACTIONS = '1'

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).rejects.toMatchInlineSnapshot(`
      "
      ⚠️ We found changes that cannot be executed:

        • Made the column \`fullname\` on table \`Blog\` required, but there are 1 existing NULL values.

      You may use the --force-reset flag to drop the database before push like prisma db push --force-reset
      All data will be lost.
            "
    `)
  })

  it('--url overrides config datasource URL when datasource exists in config', async () => {
    ctx.fixture('reset')
    ctx.setDatasource({
      url: 'file:./other.db',
    })

    const result = DbPush.new('prisma').parse(['--url=file:./dev.db'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('--url works when no datasource exists in config', async () => {
    ctx.fixture('reset')

    const result = DbPush.new('prisma').parse(['--url=file:./dev.db'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": SQLite database "dev.db" <location placeholder>

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })
})

describeMatrix(postgresOnly, 'postgres', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-db-push')

  const setupParams: SetupParams = {
    connectionString,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '__tests__', 'fixtures', 'introspection', 'postgresql'),
  }

  beforeAll(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  beforeEach(async () => {
    await setupPostgres(setupParams).catch((e) => {
      console.error(e)
    })
    ctx.setDatasource({ url: connectionString })
  })

  afterEach(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('--force-reset should succeed and display a log', async () => {
    ctx.fixture('schema-only-postgresql')

    prompt.inject(['y'])

    const result = DbPush.new('prisma').parse(['--force-reset'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`
      "Prisma schema loaded from prisma/schema.prisma.
      "
    `)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": PostgreSQL database "tests-migrate-db-push", schema "public" <location placeholder>

      The PostgreSQL database "tests-migrate-db-push" schema "public" at "localhost:5432" was successfully reset.

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('should exclude external tables', async () => {
    ctx.fixture('external-tables')

    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    // Note the missing warnings about the User table as it is marked as external and won't be modified
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-db-push", schema "public" <location placeholder>

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })
})

describeMatrix(postgresOnly, 'postgres-multischema', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-push-multischema',
  )

  const setupParams: SetupParams = {
    connectionString,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '__tests__', 'fixtures', 'introspection', 'postgresql-multischema'),
  }

  beforeAll(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  beforeEach(async () => {
    await setupPostgres(setupParams).catch((e) => {
      console.error(e)
    })
    ctx.setDatasource({ url: connectionString })
  })

  afterEach(async () => {
    await tearDownPostgres(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('multiSchema: --force-reset should succeed and display a log', async () => {
    ctx.fixture('introspection/postgresql-multischema')

    prompt.inject(['y'])

    const result = DbPush.new('prisma').parse(['--force-reset'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "db": PostgreSQL database "tests-migrate-db-push-multischema", schemas "base, transactional" <location placeholder>

      The PostgreSQL database "tests-migrate-db-push-multischema" schemas "base, transactional" at "localhost:5432" were successfully reset.

      Your database is now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })
})

describeMatrix(mongodbOnly, 'push existing-db with mongodb', () => {
  if (!process.env.TEST_SKIP_MONGODB && !process.env.TEST_MONGO_URI_MIGRATE_EXISTING_DB) {
    throw new Error('You must set a value for process.env.TEST_MONGO_URI_MIGRATE_EXISTING_DB')
  }
  const setupParams: SetupParams = {
    connectionString: process.env.TEST_MONGO_URI_MIGRATE_EXISTING_DB!,
    dirname: path.join(__dirname, '..', '__tests__', 'fixtures', 'existing-db-warnings-mongodb'),
  }

  beforeAll(async () => {
    await tearDownMongo(setupParams).catch((e) => {
      console.error(e)
    })
  })

  beforeEach(async () => {
    await setupMongo(setupParams)
  })

  afterEach(async () => {
    await tearDownMongo(setupParams).catch((e) => {
      console.error(e)
    })
  })

  it('--force-reset should succeed and print a log', async () => {
    ctx.fixture('existing-db-warnings-mongodb')

    const result = DbPush.new('prisma').parse(['--force-reset'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate-existing-db" <location placeholder>

      The MongoDB database "tests-migrate-existing-db" at "localhost:27017" was successfully reset.
      Applying the following changes:

      [+] Collection \`Post\`


      Your database indexes are now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })

  it('does not create data loss warnings', async () => {
    ctx.fixture('existing-db-warnings-mongodb')
    const result = DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "Datasource "my_db": MongoDB database "tests-migrate-existing-db" <location placeholder>
      Applying the following changes:

      [+] Collection \`Post\`


      Your database indexes are now in sync with your Prisma schema. Done in XXXms
      "
    `)
  })
})
