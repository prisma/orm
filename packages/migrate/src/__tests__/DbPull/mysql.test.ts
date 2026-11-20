import path from 'path'

import { DbPull } from '../../commands/DbPull'
import { setupMysql, tearDownMysql } from '../../utils/setupMysql'
import { SetupParams } from '../../utils/setupPostgres'
import { describeMatrix } from '../__helpers__/conditionalTests'
import { createDefaultTestContext } from '../__helpers__/context'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(60_000)
}

const ctx = createDefaultTestContext()

describeMatrix({ providers: { mysql: true } }, 'mysql', () => {
  const connectionString = process.env.TEST_MYSQL_URI!.replace('tests-migrate', 'tests-migrate-db-pull-mysql')

  const setupParams: SetupParams = {
    connectionString: process.env.TEST_MYSQL_URI!,
    // Note: at this location there is a setup.sql file
    // which will be executed a SQL file so the database is not empty
    dirname: path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'introspection', 'mysql'),
  }

  beforeAll(async () => {
    await tearDownMysql(setupParams).catch((e) => {
      console.error(e)
    })
  })

  beforeEach(async () => {
    await setupMysql(setupParams).catch((e) => {
      console.error(e)
    })

    ctx.setDatasource({ url: connectionString })
  })

  afterEach(async () => {
    await tearDownMysql(setupParams).catch((e) => {
      console.error(e)
    })
  })

  test('basic introspection', async () => {
    ctx.fixture('introspection/mysql')
    const introspect = DbPull.new('prisma')
    const result = introspect.parse(['--print'], await ctx.config(), ctx.configDir())
    await expect(result).resolves.toMatchInlineSnapshot(`""`)
    expect(ctx.normalizedCapturedStdout()).toMatchInlineSnapshot(`
      "datasource db {
        provider = "mysql"
      }

      model your_log {
        click_id     Int      @id @default(autoincrement())
        click_time   DateTime @db.DateTime(0)
        shorturl     String   @db.VarChar(200)
        referrer     String   @db.VarChar(200)
        user_agent   String   @db.VarChar(255)
        ip_address   String   @db.VarChar(41)
        country_code String   @db.Char(2)

        @@index([shorturl], map: "shorturl")
      }

      model your_options {
        option_id    BigInt @default(autoincrement()) @db.UnsignedBigInt
        option_name  String @default("") @db.VarChar(64)
        option_value String @db.LongText

        @@id([option_id, option_name])
        @@index([option_name], map: "option_name")
      }

      model your_url {
        keyword   String   @id @db.VarChar(200)
        url       String   @db.Text
        title     String?  @db.Text
        timestamp DateTime @default(now()) @db.Timestamp(0)
        ip        String   @db.VarChar(41)
        clicks    Int      @db.UnsignedInt

        @@index([ip], map: "ip")
        @@index([timestamp], map: "timestamp")
      }

      "
    `)

    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
