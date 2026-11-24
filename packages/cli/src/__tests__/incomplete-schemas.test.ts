// describeIf is making eslint unhappy about the test names
/* eslint-disable jest/no-identical-title */
import { stripVTControlCharacters } from 'node:util'

import { jestContext } from '@prisma/get-platform'
import { DbExecute, DbPull, DbPush, MigrateDev, MigrateReset } from '@prisma/migrate'
import fs from 'fs'

import { Format } from '../Format'
import { Validate } from '../Validate'
import { configContextContributor } from './_utils/config-context'

const ctx = jestContext.new().add(configContextContributor()).assemble()

/**
 * Commands:
 * - wasm engine
 *   - format
 * - library engine
 *   - validate
 *   - db push
 *   - db pull
 *   - db execute (doesn't use neither getDmmf nor getConfig directly)
 *   - migrate reset
 *   - migrate dev
 */

const dbExecuteSQLScript = `-- Drop & Create & Drop
DROP TABLE IF EXISTS 'test-dbexecute';
CREATE TABLE 'test-dbexecute' ("id" INTEGER PRIMARY KEY);
DROP TABLE 'test-dbexecute';`

describe('[wasm] incomplete-schemas', () => {
  describe('datasource-block-url-env-set-invalid', () => {
    beforeEach(() => {
      ctx.fixture('incomplete-schemas/datasource-block-url-env-set-invalid')
    })

    it('db push', async () => {
      expect.assertions(1)
      try {
        await DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchSnapshot()
      }
    })

    it('db pull', async () => {
      expect.assertions(1)
      try {
        await DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. \`datasource.url\` in \`prisma.config.ts\` is invalid: must start with the protocol \`postgresql://\` or \`postgres://\`.
          "
        `)
      }
    })

    it('db execute', async () => {
      fs.writeFileSync('script.sql', dbExecuteSQLScript)
      expect.assertions(1)

      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
          "P1013

          The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters.
          "
        `)
      }
    })

    it('migrate reset', async () => {
      expect.assertions(1)
      try {
        await MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"P1013: The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters."`,
        )
      }
    })

    it('migrate dev', async () => {
      expect.assertions(1)
      try {
        await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"P1013: The provided database string is invalid. The scheme is not recognized in database URL. Please refer to the documentation in https://pris.ly/d/config-url for constructing a correct connection string. In some cases, certain characters must be escaped. Please check the string for any illegal characters."`,
        )
      }
    })
  })

  describe('datasource-block-url-env-unset', () => {
    beforeEach(() => {
      ctx.fixture('incomplete-schemas/datasource-block-url-env-unset')
    })

    it('validate', async () => {
      expect.assertions(1)
      try {
        await Validate.new('prisma').parse([], await ctx.config())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('db push', async () => {
      expect.assertions(1)
      try {
        await DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('db pull', async () => {
      expect.assertions(1)
      try {
        await DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('db execute', async () => {
      fs.writeFileSync('script.sql', dbExecuteSQLScript)
      expect.assertions(1)

      try {
        const config = await ctx.config()
        await DbExecute.new('prisma').parse(['--file=./script.sql'], config, ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('migrate reset', async () => {
      expect.assertions(1)
      try {
        await MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('migrate dev', async () => {
      expect.assertions(1)
      try {
        await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('validate', async () => {
      expect.assertions(1)
      try {
        await Validate.new('prisma').parse([], await ctx.config())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })

    it('format', async () => {
      expect.assertions(1)

      try {
        await Format.new('prisma').parse([], await ctx.config())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"Failed to load config file "/tmp/dir" as a TypeScript/JavaScript module. Error: PrismaConfigEnvError: Cannot resolve environment variable: SOME_UNDEFINED_DB."`,
        )
      }
    })
  })

  describe('empty-schema', () => {
    beforeEach(() => {
      ctx.fixture('incomplete-schemas/empty-schema')
    })

    it('validate', async () => {
      await expect(Validate.new('prisma').parse([], await ctx.config())).resolves.not.toThrow()
    })

    it('format', async () => {
      await expect(Format.new('prisma').parse([], await ctx.config())).resolves.not.toThrow()
    })
  })

  describe('datasource-block-no-url', () => {
    beforeEach(() => {
      ctx.fixture('incomplete-schemas/datasource-block-no-url')
    })

    it('db push', async () => {
      expect.assertions(1)
      try {
        await DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"The datasource.url property is required in your Prisma config file when using prisma db push."`,
        )
      }
    })

    it('db pull', async () => {
      expect.assertions(1)
      try {
        await DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"The datasource.url property is required in your Prisma config file when using prisma db pull."`,
        )
      }
    })

    it('db execute', async () => {
      fs.writeFileSync('script.sql', dbExecuteSQLScript)
      expect.assertions(1)

      try {
        await DbExecute.new('prisma').parse(['--file=./script.sql'], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"The datasource.url property is required in your Prisma config file when using prisma db execute."`,
        )
      }
    })

    it('migrate reset', async () => {
      expect.assertions(1)
      try {
        await MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"The datasource.url property is required in your Prisma config file when using prisma migrate reset."`,
        )
      }
    })

    it('migrate dev', async () => {
      expect.assertions(1)
      try {
        await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
          `"The datasource.url property is required in your Prisma config file when using prisma migrate dev."`,
        )
      }
    })
  })
})

describe('[normalized library/binary] incomplete-schemas', () => {
  describe('empty-schema', () => {
    beforeEach(() => {
      ctx.fixture('incomplete-schemas/empty-schema')
    })

    it('db push', async () => {
      expect.assertions(1)
      try {
        await DbPush.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`"Schema must contain a datasource block"`)
      }
    })

    it('db pull', async () => {
      expect.assertions(1)
      try {
        await DbPull.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`"Schema must contain a datasource block"`)
      }
    })

    it('migrate reset', async () => {
      expect.assertions(1)
      try {
        await MigrateReset.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`"Schema must contain a datasource block"`)
      }
    })

    it('migrate dev', async () => {
      expect.assertions(1)
      try {
        await MigrateDev.new('prisma').parse([], await ctx.config(), ctx.configDir())
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`"Schema must contain a datasource block"`)
      }
    })
  })
})
