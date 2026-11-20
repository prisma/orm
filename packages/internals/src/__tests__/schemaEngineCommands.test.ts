import { serialize } from '@prisma/get-platform/src/test-utils/vitest-snapshot-serializer'
import tempy from 'tempy'
import { describe, expect, test, vi } from 'vitest'

import { credentialsToUri, uriToCredentials } from '../convertCredentials'
import { canConnectToDatabase, createDatabase, dropDatabase, execaCommand } from '../schemaEngineCommands'

if (process.env.CI) {
  // 5s is often not enough for the "postgresql - create database" test on macOS CI.
  vi.setConfig({ testTimeout: 60_000 })
}

const testIf = (condition: boolean) => (condition ? test : test.skip)

describe('execaCommand', () => {
  test('check if connection string is in error', async () => {
    try {
      await execaCommand({
        connectionString: 'postgresql://user:mysecret@localhost',
        cwd: process.cwd(),
        schemaEnginePath: undefined,
        engineCommandName: 'drop-database',
      })
    } catch (e) {
      const message = e.message as string
      expect(message.includes('mysecret')).toBeFalsy()
      expect(message.includes('<REDACTED>')).toBeTruthy()
    }
  })
})

describe('canConnectToDatabase', () => {
  test('sqlite - can', async () => {
    await expect(canConnectToDatabase('file:./introspection/blog.db', __dirname)).resolves.toEqual(true)
  })

  test('sqlite - cannot', async () => {
    await expect(canConnectToDatabase('file:./doesnotexist.db')).resolves.toMatchInlineSnapshot(`
      {
        "code": "P1003",
        "message": "Database \`doesnotexist.db\` does not exist",
      }
    `)
  })

  test('postgresql - server does not exist', async () => {
    await expect(
      canConnectToDatabase('postgresql://johndoe:randompassword@doesnotexist:5432/mydb?schema=public', __dirname),
    ).resolves.toMatchInlineSnapshot(`
      {
        "code": "P1001",
        "message": "Can't reach database server at \`doesnotexist:5432\`

      Please make sure your database server is running at \`doesnotexist:5432\`.",
      }
    `)
  }, 10_000)
})

describe('createDatabase', () => {
  test('sqlite - already exists', async () => {
    await expect(createDatabase('file:./introspection/blog.db', __dirname)).resolves.toEqual(false)
  })

  test('sqlite - file does not exists', async () => {
    await expect(createDatabase('file:./doesnotexist.db', tempy.directory())).resolves.toEqual(true)
  })

  testIf(!process.env.PRISMA_SCHEMA_ENGINE_BINARY)(
    'sqlite - invalid cwd (file path instead of directory)',
    async () => {
      expect.assertions(1)
      try {
        await createDatabase('file:./doesnotexist.db', tempy.file())
      } catch (e) {
        expect(serialize(e)).toMatchInlineSnapshot(`
          ""Schema engine exited. Error: Command failed with ENOENT: /engines/schema-engine-TEST_PLATFORM --datasource {"url":"<REDACTED>"} cli can-connect-to-database
          spawn /engines/schema-engine-TEST_PLATFORM ENOENT""
        `)
      }
    },
  )

  test('postgresql - create database', async () => {
    const uri = process.env.TEST_POSTGRES_URI!.replace('tests', 'tests-createDatabase')
    const credentials = uriToCredentials(uri)
    credentials.database = 'can-create-a-db'
    const uriFromCredentials = credentialsToUri(credentials)
    try {
      await dropDatabase(uriFromCredentials, __dirname)
    } catch (e) {}
    await expect(createDatabase(uriFromCredentials, __dirname)).resolves.toEqual(true)
  })

  test('postgresql - server does not exist', async () => {
    await expect(createDatabase('postgresql://johndoe:randompassword@doesnotexist:5432/mydb?schema=public', __dirname))
      .rejects.toThrowErrorMatchingInlineSnapshot(`
      [Error: P1001: Can't reach database server at \`doesnotexist:5432\`

      Please make sure your database server is running at \`doesnotexist:5432\`.]
    `)
  }, 30_000)

  test('postgresql - database already exists', async () => {
    const uri = process.env.TEST_POSTGRES_URI!
    const credentials = uriToCredentials(uri)
    credentials.database = 'postgres'
    const uriFromCredentials = credentialsToUri(credentials)
    await expect(createDatabase(uriFromCredentials, __dirname)).resolves.toEqual(false)
  })

  test('mysql - create database', async () => {
    const uri = process.env.TEST_MYSQL_URI!.replace('tests', 'tests-createDatabase')
    const credentials = uriToCredentials(uri)
    credentials.database = 'can-create-a-db'
    const uriFromCredentials = credentialsToUri(credentials)
    try {
      await dropDatabase(uriFromCredentials, __dirname)
    } catch (e) {}
    await expect(createDatabase(uriFromCredentials, __dirname)).resolves.toEqual(true)
  })

  test('mysql - database already exists', async () => {
    const uri = process.env.TEST_MYSQL_URI!.replace('tests', 'tests-createDatabase-already-exists')
    const credentials = uriToCredentials(uri)
    credentials.database = 'alreadyexists'
    const uriFromCredentials = credentialsToUri(credentials)

    try {
      await dropDatabase(uriFromCredentials, __dirname)
    } catch (e) {}
    await expect(createDatabase(uriFromCredentials, __dirname)).resolves.toEqual(true)
    await expect(createDatabase(uriFromCredentials, __dirname)).resolves.toEqual(false)
  })

  testIf(!process.env.TEST_SKIP_MSSQL)('sqlserver - create database', async () => {
    if (!process.env.TEST_MSSQL_JDBC_URI) {
      throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI. See TESTING.md')
    }
    const connectionString = process.env.TEST_MSSQL_JDBC_URI.replace(/database=(.*?);/, 'database=can-create-a-db;')
    try {
      await dropDatabase(connectionString, __dirname)
    } catch (e) {}
    await expect(createDatabase(connectionString, __dirname)).resolves.toEqual(true)
  })

  testIf(!process.env.TEST_SKIP_MSSQL)('sqlserver - database already exists', async () => {
    if (!process.env.TEST_MSSQL_JDBC_URI) {
      throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI. See TESTING.md')
    }
    const connectionString = process.env.TEST_MSSQL_JDBC_URI
    await expect(createDatabase(connectionString, __dirname)).resolves.toEqual(false)
  })

  test('invalid database type', async () => {
    await expect(createDatabase('invalid:somedburl')).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: P1013: The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.]`,
    )
  })

  test('empty connection string', async () => {
    await expect(createDatabase('')).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Connection url is empty. See https://pris.ly/d/config-url]`,
    )
  })
})
