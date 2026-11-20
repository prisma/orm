// describeMatrix making eslint unhappy about the test names
/* eslint-disable jest/no-identical-title */

import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { DbExecute } from '../commands/DbExecute'
import { setupCockroach, tearDownCockroach } from '../utils/setupCockroach'
import { setupMSSQL, tearDownMSSQL } from '../utils/setupMSSQL'
import { setupMysql, tearDownMysql } from '../utils/setupMysql'
import type { SetupParams } from '../utils/setupPostgres'
import { setupPostgres, tearDownPostgres } from '../utils/setupPostgres'
import {
  cockroachdbOnly,
  describeMatrix,
  mongodbOnly,
  mysqlOnly,
  noDriverAdapters,
  postgresOnly,
  sqliteOnly,
  sqlServerOnly,
} from './__helpers__/conditionalTests'
import { createDefaultTestContext } from './__helpers__/context'

const exec = util.promisify(childProcess.exec)

const ctx = createDefaultTestContext()
const testIf = (condition: boolean) => (condition ? test : test.skip)

describe('db execute', () => {
  describe('prisma.config.ts', () => {
    it('should require a datasource in the config', async () => {
      ctx.fixture('no-config')

      fs.writeFileSync('script.sql', '-- noop')

      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The datasource.url property is required in your Prisma config file when using prisma db execute."`,
      )
    })
  })

  describe('generic', () => {
    describe.each(['prisma', 'prisma7'] as const)('%s', (cliCommand) => {
      it('renders help and help errors with the selected executable', async () => {
        const command = DbExecute.new(cliCommand)
        const otherCliCommand = cliCommand === 'prisma' ? 'prisma7' : 'prisma'

        expect(command.help()).toContain(`${cliCommand} db execute --file ./script.sql`)
        expect(command.help()).not.toContain(`${otherCliCommand} db execute --file ./script.sql`)

        ctx.fixture('valid-config-only')
        const result = command.parse([], await ctx.config(), ctx.configDir())
        await expect(result).rejects.toThrow(`Either --stdin or --file must be provided.`)
        await expect(result).rejects.toThrow(`See \`${cliCommand} db execute -h\``)
        await expect(result).rejects.not.toThrow(`See \`${otherCliCommand} db execute -h\``)
      })
    })

    it('should fail if missing --file and --stdin', async () => {
      ctx.fixture('valid-config-only')

      const result = DbExecute.new('prisma').parse([], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Either --stdin or --file must be provided.
        See \`prisma db execute -h\`"
      `)
    })

    it('should fail if both --file and --stdin are provided', async () => {
      ctx.fixture('valid-config-only')

      const result = DbExecute.new('prisma').parse(['--file=1', '--stdin'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "--stdin and --file cannot be used at the same time. Only 1 must be provided.
        See \`prisma db execute -h\`"
      `)
    })

    it('should fail if --file does no exists', async () => {
      ctx.fixture('valid-config-only')
      expect.assertions(2)

      try {
        ctx.setDatasource({ url: 'file:./dev.db' })
        await DbExecute.new('prisma').parse(['--file=./doesnotexists.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual(undefined)
        expect(e.message).toMatchInlineSnapshot(`"Provided --file at ./doesnotexists.sql doesn't exist."`)
      }
    })
  })

  describeMatrix(mongodbOnly, 'mongodb', () => {
    it('should fail with not supported error when using MongoDB', async () => {
      ctx.fixture('schema-only-mongodb')

      fs.writeFileSync('script.js', 'Something for MongoDB')
      const result = DbExecute.new('prisma').parse(['--file=./script.js'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "dbExecute is not supported on MongoDB

        "
      `)
    })
  })

  describeMatrix(sqliteOnly, 'SQLite', () => {
    const pathToBin = path.resolve('src/bin.ts')
    const sqlScript = `-- Drop & Create & Drop
DROP TABLE IF EXISTS 'test-dbexecute';
CREATE TABLE 'test-dbexecute' ("id" INTEGER PRIMARY KEY);
DROP TABLE 'test-dbexecute';`

    // On Windows: snapshot output = "-- Drop & Create & Drop".
    // TODO: check why it fails locally with `env: tsx: No such file or directory`.
    testIf(process.platform !== 'win32')(
      'should pass with --stdin',
      async () => {
        ctx.fixture('schema-only-sqlite')

        const { stdout, stderr } = await exec(`echo "${sqlScript}" | ${pathToBin} db execute --stdin`)
        expect(stderr).toBeFalsy()
        expect(stdout).toMatchInlineSnapshot(`
          "Script executed successfully.
          "
        `)
        // This is a slow test and macOS machine can be even slower and fail the test
      },
      30_000,
    )

    it('should pass with --file', async () => {
      ctx.fixture('schema-only-sqlite')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with schema folder fixture', async () => {
      ctx.fixture('schema-folder-sqlite')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass using a transaction with --file', async () => {
      ctx.fixture('schema-only-sqlite')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
BEGIN;

${sqlScript}

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    describeMatrix(noDriverAdapters, 'non driver adapter', () => {
      it('should pass when datasource is provided programmatically', async () => {
        ctx.fixture('valid-config-only')
        fs.writeFileSync('script.sql', sqlScript)

        ctx.setDatasource({ url: 'file:./dev.db' })
        const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
        await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
      })

      it('should pass with datasource pointing to file:dev.db', async () => {
        ctx.fixture('introspection/sqlite')
        fs.writeFileSync('script.sql', sqlScript)

        ctx.setDatasource({ url: 'file:dev.db' })
        const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
        await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
      })

      it('should pass with empty script', async () => {
        ctx.fixture('introspection/sqlite')
        fs.writeFileSync('script.sql', '')

        ctx.setDatasource({ url: 'file:dev.db' })
        const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
        await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
      })

      it('should fail with P1013 error when datasource URL is invalid', async () => {
        ctx.fixture('schema-only-sqlite')
        expect.assertions(2)

        fs.writeFileSync('script.sql', '-- empty')

        ctx.setDatasource({ url: 'invalidurl' })
        try {
          await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
        } catch (e) {
          expect(e.code).toEqual('P1013')
          expect(e.message).toMatchInlineSnapshot(`
                      "P1013

                      The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
                      "
                  `)
        }
      })

      it('should create the SQLite database if it does not exist', async () => {
        ctx.fixture('introspection/sqlite')
        fs.writeFileSync('script.sql', sqlScript)

        ctx.setDatasource({ url: 'file:doesnotexists.db' })
        const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
        await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
      })
    })

    // TODO we could have a generic error code in prisma-engines for a "SQL error"
    it('should fail when there is a database error', async () => {
      ctx.fixture('schema-only-sqlite')
      expect.assertions(1)

      fs.writeFileSync('script.sql', 'DROP TABLE "test-doesnotexists";')
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.message).toContain('no such table: test-doesnotexists')
      }
    })

    it('should fail with invalid SQL error from database', async () => {
      ctx.fixture('schema-only-sqlite')
      expect.assertions(2)

      fs.writeFileSync('script.sql', 'ThisisnotSQL,itshouldfail')
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual(undefined)
        expect(e.message).toContain('near "ThisisnotSQL": syntax error')
      }
    })
  })

  describeMatrix(postgresOnly, 'postgres', () => {
    const connectionString = process.env.TEST_POSTGRES_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-db-execute')

    const setupParams: SetupParams = {
      connectionString,
      dirname: '',
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

    const sqlScript = `-- Drop & Create & Drop
DROP SCHEMA IF EXISTS "test-dbexecute";
CREATE SCHEMA "test-dbexecute";
DROP SCHEMA "test-dbexecute";`

    it('should pass with --file', async () => {
      ctx.fixture('schema-only-postgresql')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with schema folder fixture', async () => {
      ctx.fixture('schema-folder-postgres')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass using a transaction with --file', async () => {
      ctx.fixture('schema-only-postgresql')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
BEGIN;

${sqlScript}

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with empty script', async () => {
      ctx.fixture('schema-only-postgresql')

      fs.writeFileSync('script.sql', '')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    // Limitation of postgresql
    // DROP DATABASE cannot be executed from a function or multi-command string
    // on GitHub Actions, for macOS and Windows it errors with
    // DROP DATABASE cannot run inside a transaction block
    it('should fail if DROP DATABASE is attempted', async () => {
      ctx.fixture('schema-only-postgresql')
      expect.assertions(2)

      fs.writeFileSync(
        'script.sql',
        `-- Drop & Create & Drop
      DROP DATABASE IF EXISTS "test-dbexecute";
      CREATE DATABASE "test-dbexecute";
      DROP DATABASE "test-dbexecute";`,
      )
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual(undefined)
        expect(e.message).toContain('ERROR: DROP DATABASE cannot')
      }
    })

    it('should fail with P1013 error when datasource URL is invalid', async () => {
      ctx.fixture('schema-only-postgresql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'postgresql://johndoe::::////::randompassword@doesnotexist/mydb' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. invalid port number in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1013 error when datasource provider is invalid', async () => {
      ctx.fixture('schema-only-postgresql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'invalidurl' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1001 error when datasource is unreachable', async () => {
      ctx.fixture('schema-only-postgresql')
      expect.assertions(2)

      // In CI, sometimes 5s is not enough
      if (process.env.CI) {
        jest.setTimeout(10_000)
      }

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'postgresql://johndoe:randompassword@doesnotexist:5432/mydb?schema=public' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1001')
        expect(e.message).toMatchInlineSnapshot(`
          "P1001

          Can't reach database server at \`doesnotexist:5432\`

          Please make sure your database server is running at \`doesnotexist:5432\`.
          "
        `)
      }
    })

    it('should fail with P1003 error when database does not exist', async () => {
      ctx.fixture('schema-only-postgresql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', 'DROP DATABASE "test-doesnotexists";')
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1003')
        expect(e.message).toMatchInlineSnapshot(`
          "P1003

          Database \`test-doesnotexists\` does not exist
          "
        `)
      }
    })

    it('should fail with invalid SQL error from database', async () => {
      ctx.fixture('schema-only-postgresql')

      fs.writeFileSync('script.sql', 'ThisisnotSQLitshouldfail')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "ERROR: syntax error at or near "ThisisnotSQLitshouldfail"

        "
      `)
    })
  })

  describeMatrix(cockroachdbOnly, 'cockroachdb', () => {
    if (!process.env.TEST_SKIP_COCKROACHDB && !process.env.TEST_COCKROACH_URI_MIGRATE) {
      throw new Error('You must set a value for process.env.TEST_COCKROACH_URI_MIGRATE. See TESTING.md')
    }
    // Without `|| ''`, the conditional test would return
    // a Type Error on `undefined.replace()` even though the test is skipped
    const connectionString = (process.env.TEST_COCKROACH_URI_MIGRATE || '').replace(
      'tests-migrate',
      'tests-migrate-db-execute',
    )

    const setupParams = {
      connectionString,
      dirname: '',
    }

    beforeAll(async () => {
      await tearDownCockroach(setupParams).catch((e) => {
        console.error(e)
      })
    })

    beforeEach(async () => {
      await setupCockroach(setupParams).catch((e) => {
        console.error(e)
      })

      ctx.setDatasource({ url: connectionString })
    })

    afterEach(async () => {
      await tearDownCockroach(setupParams).catch((e) => {
        console.error(e)
      })
    })

    const sqlScript = `-- Drop & Create & Drop
DROP SCHEMA IF EXISTS "test-dbexecute";
CREATE SCHEMA "test-dbexecute";
DROP SCHEMA "test-dbexecute";`

    it('should pass with --file', async () => {
      ctx.fixture('schema-only-cockroachdb')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    }, 10_000)

    it('should pass with schema folder fixture', async () => {
      ctx.fixture('schema-folder-cockroachdb')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    }, 10_000)

    it('should pass using a transaction with --file', async () => {
      ctx.fixture('schema-only-cockroachdb')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
BEGIN;

${sqlScript}

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    }, 10_000)

    it('should pass with empty script', async () => {
      ctx.fixture('schema-only-cockroachdb')

      fs.writeFileSync('script.sql', '')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    }, 10_000)

    // Cockroachdb doesn't have the same limitation as Postgres, as it can drop and create a database
    // with a single SQL script.
    it('should succeed if DROP DATABASE is attempted', async () => {
      ctx.fixture('schema-only-cockroachdb')
      expect.assertions(0)

      fs.writeFileSync(
        'script.sql',
        `-- Drop & Create & Drop
      DROP DATABASE IF EXISTS "test-dbexecute";
      CREATE DATABASE "test-dbexecute";
      DROP DATABASE "test-dbexecute";`,
      )
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual(undefined)
      }
    })

    it('should fail with P1013 error when datasource URL is invalid', async () => {
      ctx.fixture('schema-only-cockroachdb')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'postgresql://johndoe::::////::randompassword@doesnotexist/mydb' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. invalid port number in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1013 error when datasource provider is invalid', async () => {
      ctx.fixture('schema-only-cockroachdb')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'invalidurl' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1001 error when datasource is unreachable', async () => {
      ctx.fixture('schema-only-cockroachdb')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      ctx.setDatasource({ url: 'postgresql://johndoe:randompassword@doesnotexist:5432/mydb?schema=public' })
      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1001')
        expect(e.message).toMatchInlineSnapshot(`
          "P1001

          Can't reach database server at \`doesnotexist:5432\`

          Please make sure your database server is running at \`doesnotexist:5432\`.
          "
        `)
      }
    })

    it('should fail with invalid SQL error from database', async () => {
      ctx.fixture('schema-only-cockroachdb')

      fs.writeFileSync('script.sql', 'ThisisnotSQLitshouldfail')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "ERROR: at or near "thisisnotsqlitshouldfail": syntax error
        DETAIL: source SQL:
        ThisisnotSQLitshouldfail
        ^

        "
      `)
    })
  })

  describeMatrix(mysqlOnly, 'mysql', () => {
    const connectionString = process.env.TEST_MYSQL_URI_MIGRATE!.replace('tests-migrate', 'tests-migrate-db-execute')

    const setupParams: SetupParams = {
      connectionString,
      dirname: '',
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

    const sqlScript = `-- Drop & Create & Drop
DROP DATABASE IF EXISTS \`test-dbexecute\`;
CREATE DATABASE \`test-dbexecute\`;
DROP DATABASE \`test-dbexecute\`;`

    it('should pass with --file', async () => {
      ctx.fixture('schema-only-mysql')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with schema folder fixture', async () => {
      ctx.fixture('schema-folder-mysql')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    // Only fails on MySQL
    it('should fail with empty script', async () => {
      ctx.fixture('schema-only-mysql')

      fs.writeFileSync('script.sql', '')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Query was empty

        "
      `)
    })

    it('should pass using a transaction with --file', async () => {
      ctx.fixture('schema-only-mysql')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
START TRANSACTION;

${sqlScript}

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should fail with P1013 error when datasource URL is invalid', async () => {
      ctx.fixture('schema-only-mysql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({ url: 'mysql://johndoe::::////::randompassword@doesnotexist:3306/mydb' })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. invalid port number in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })
    it('should fail with P1013 error when datasource provider is invalid', async () => {
      ctx.fixture('schema-only-mysql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({ url: 'invalidurl' })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1001 error when datasource is unreachable', async () => {
      ctx.fixture('schema-only-mysql')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({ url: 'mysql://johndoe:randompassword@doesnotexist:3306/mydb' })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1001')
        expect(e.message).toMatchInlineSnapshot(`
          "P1001

          Can't reach database server at \`doesnotexist:3306\`

          Please make sure your database server is running at \`doesnotexist:3306\`.
          "
        `)
      }
    })

    it('should fail with SQL error from database', async () => {
      ctx.fixture('schema-only-mysql')

      fs.writeFileSync('script.sql', 'DROP DATABASE `test-doesnotexists`;')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Can't drop database 'test-doesnotexists'; database doesn't exist

        "
      `)
    })

    it('should fail with invalid SQL error from database', async () => {
      ctx.fixture('schema-only-mysql')

      fs.writeFileSync('script.sql', 'This is not SQL, it should fail')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'This is not SQL, it should fail' at line 1

        "
      `)
    })
  })

  describeMatrix(sqlServerOnly, 'sqlserver', () => {
    if (!process.env.TEST_SKIP_MSSQL && !process.env.TEST_MSSQL_JDBC_URI_MIGRATE) {
      throw new Error('You must set a value for process.env.TEST_MSSQL_JDBC_URI_MIGRATE. See TESTING.md')
    }

    const jdbcConnectionString = process.env.TEST_MSSQL_JDBC_URI_MIGRATE?.replace(
      'tests-migrate',
      'tests-migrate-db-execute',
    )

    const databaseName = 'tests-migrate-db-execute'
    const setupParams: SetupParams = {
      connectionString: process.env.TEST_MSSQL_URI!,
      dirname: '',
    }

    beforeAll(async () => {
      await tearDownMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })
    })

    beforeEach(async () => {
      await setupMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })

      const shadowDatabaseUrl = process.env.TEST_MSSQL_SHADOWDB_JDBC_URI_MIGRATE?.replace(
        'tests-migrate-shadowdb',
        `${databaseName}-shadowdb`,
      )
      ctx.setDatasource({ url: jdbcConnectionString!, shadowDatabaseUrl })
    })

    afterEach(async () => {
      await tearDownMSSQL(setupParams, databaseName).catch((e) => {
        console.error(e)
      })
    })

    const sqlScript = `-- Drop & Create & Drop
DROP DATABASE IF EXISTS "test-dbexecute";
CREATE DATABASE "test-dbexecute";
DROP DATABASE "test-dbexecute";`

    it('should pass with --file', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with schema folder fixture', async () => {
      ctx.fixture('schema-folder-sqlserver')

      fs.writeFileSync('script.sql', sqlScript)
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass with empty script', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync('script.sql', '')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    it('should pass using a transaction with --file --schema', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
BEGIN TRANSACTION;

SELECT 1

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).resolves.toMatchInlineSnapshot(`"Script executed successfully."`)
    })

    // Limitation of sqlserver
    // DROP DATABASE statement cannot be used inside a user transaction.
    it('should fail if DROP DATABASE in a transaction with --file --schema', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync(
        'script.sql',
        `-- start a transaction
BEGIN TRANSACTION;

${sqlScript}

-- commit changes
COMMIT;`,
      )
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "DROP DATABASE statement cannot be used inside a user transaction.

        "
      `)
    })

    it('should fail with P1013 error when datasource URL is invalid', async () => {
      ctx.fixture('schema-only-sqlserver')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({
          url: 'sqlserver://doesnotexist:1433;;;;database=tests-migrate;user=SA;password=Pr1sm4_Pr1sm4;trustServerCertificate=true;',
        })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. Error parsing connection string: Conversion error: Invalid property key in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1013 error when datasource provider is invalid', async () => {
      ctx.fixture('schema-only-sqlserver')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({ url: 'invalidurl' })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1013')
        expect(e.message).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('should fail with P1001 error when datasource is unreachable', async () => {
      ctx.fixture('schema-only-sqlserver')
      expect.assertions(2)

      fs.writeFileSync('script.sql', '-- empty')
      try {
        ctx.setDatasource({
          url: 'sqlserver://doesnotexist:1433;database=tests-migrate;user=SA;password=Pr1sm4_Pr1sm4;trustServerCertificate=true;',
        })
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(e.code).toEqual('P1001')
        expect(e.message).toMatchInlineSnapshot(`
          "P1001

          Can't reach database server at \`doesnotexist:1433\`

          Please make sure your database server is running at \`doesnotexist:1433\`.
          "
        `)
      }
    })

    it('should fail with SQL error from database', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync('script.sql', 'DROP DATABASE "test-doesnotexists";')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Cannot drop the database 'test-doesnotexists', because it does not exist or you do not have permission.

        "
      `)
    })

    it('should fail with invalid SQL error from database', async () => {
      ctx.fixture('schema-only-sqlserver')

      fs.writeFileSync('script.sql', 'ThisisnotSQLitshouldfail')
      const result = DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`
        "Could not find stored procedure 'ThisisnotSQLitshouldfail'.

        "
      `)
    })
  })
})
