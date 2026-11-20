import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { SetupParams, setupPostgres, tearDownPostgres } from '../../utils/setupPostgres'
import { describeMatrix, postgresOnly } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix(postgresOnly, 'postgresql', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-pull-postgresql',
  )

  const setupParams: SetupParams = {
    connectionString,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'postgresql'),
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

  test('basic introspection', async () => {
    ctx.fixture('introspection/postgresql')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)

    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "datasource db {
        provider = "postgres"
      }

      model Post {
        id        String    @id
        createdAt DateTime  @default(now())
        updatedAt DateTime  @default(dbgenerated("'1970-01-01 00:00:00'::timestamp without time zone"))
        published Boolean   @default(false)
        title     String
        content   String?
        authorId  String?
        jsonData  Json?
        coinflips Boolean[]
        User      User?     @relation(fields: [authorId], references: [id])
      }

      model User {
        id    String  @id
        email String  @unique(map: "User.email")
        name  String?
        Post  Post[]
      }

      enum Role {
        USER
        ADMIN
      }

      "
    `)
    expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`""`)
  })

  describe('empty or incomplete schema', () => {
    test('basic introspection config + empty schema', async () => {
      ctx.fixture('empty-schema')
      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toMatchInlineSnapshot(`"Schema must contain a datasource block"`)

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`""`)
    })

    test('basic introspection config + schema with no linebreak after generator block', async () => {
      ctx.fixture('generator-only')
      const introspect = DbPull.new('prisma')
      const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toMatchInlineSnapshot(`"Schema must contain a datasource block"`)

      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`""`)
    })

    test('introspection with postgresql provider but schema has a sqlite provider should fail', async () => {
      ctx.fixture('schema-only-sqlite')

      // TODO: this error is not entirely correct: the invalid URL is in the config file,
      // not in the datasource block. The message needs to be updated when removing the
      // `url` property from the PSL.
      await expect(DbPull.new('prisma').parse(['--print'], await ctx.config(), ctx.configDir())).rejects
        .toMatchInlineSnapshot(`
        "P1013

        The provided database string is invalid. \`datasource.url\` in \`prisma.config.ts\` is invalid: must start with the protocol \`file:\`.
        "
      `)

      expect(ctx.normalizedCapturedStderr()).toMatchInlineSnapshot(`""`)
      expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
        "
        "
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })
  })
})
