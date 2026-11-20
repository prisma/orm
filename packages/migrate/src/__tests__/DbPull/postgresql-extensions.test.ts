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

describeMatrix(postgresOnly, 'postgresql-extensions', () => {
  const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace(
    'tests-migrate',
    'tests-migrate-db-pull-extensions-postgresql',
  )

  const setupParams: SetupParams = {
    connectionString,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'postgresql-extensions'),
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

  test('introspection should succeed and add extensions property to the schema.prisma file', async () => {
    ctx.fixture('introspection/postgresql-extensions')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print', '--schema', 'schema.prisma'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    const introspectedSchema = ctx.normalizedCapturedStdout()
    expect(introspectedSchema).toMatchInlineSnapshot(`
      "generator client {
        provider        = "prisma-client-js"
        previewFeatures = ["postgresqlExtensions"]
      }

      datasource db {
        provider   = "postgresql"
        extensions = [citext(schema: "public")]
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
    expect(introspectedSchema).toContain('[citext(schema:')

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('re-introspection should succeed and keep defined extension in schema.prisma file', async () => {
    ctx.fixture('introspection/postgresql-extensions')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(
      ['--print', '--schema', 'schema-extensions-citext.prisma'],
      await ctx.config(),
      ctx.configDir(),
    )
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    const introspectedSchema = ctx.normalizedCapturedStdout()
    expect(introspectedSchema).toMatchInlineSnapshot(`
      "generator client {
        provider        = "prisma-client-js"
        previewFeatures = ["postgresqlExtensions"]
      }

      datasource db {
        provider   = "postgresql"
        extensions = [citext(schema: "public")]
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
    expect(introspectedSchema).toContain('[citext(schema:')

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
