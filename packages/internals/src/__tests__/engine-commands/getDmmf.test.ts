import fs from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getDMMF, MultipleSchemas } from '../..'
import { fixturesPath } from '../__utils__/fixtures'

function restoreEnvSnapshot(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

if (process.env.CI) {
  // 10s is not always enough for the "big schema" test on macOS CI.
  vi.setConfig({ testTimeout: 60_000 })
}

describe('getDMMF', () => {
  // Note: to run these tests locally, prepend the env vars `FORCE_COLOR=0` and `CI=1` to your test command,
  // as `chalk` follows different conventions than the Rust `colored` crate (and uses `FORCE_COLOR=0` to disable colors rather than `NO_COLOR=1`).
  describe.skip('colors', () => {
    // backup env vars
    const OLD_ENV = { ...process.env }

    beforeEach(() => {
      // jest.resetModules()
      restoreEnvSnapshot(OLD_ENV)
      delete process.env.NO_COLOR
      process.env.FORCE_COLOR = '0'
      process.env.CI = '1'
    })

    afterEach(() => {
      // reset env vars to backup state
      restoreEnvSnapshot(OLD_ENV)
    })

    test('failures should have colors by default', async () => {
      expect.assertions(1)
      const datamodel = `
        datasource db {
      `

      try {
        await getDMMF({ datamodel })
      } catch (e) {
        expect(e.message).toMatchInlineSnapshot(`
          "Prisma schema validation - (get-dmmf wasm)
          Error code: P1012
          [1;91merror[0m: [1mError validating: This line is invalid. It does not start with any known Prisma schema keyword.[0m
            [1;94m-->[0m  [4mschema.prisma:2[0m
          [1;94m   | [0m
          [1;94m 1 | [0m
          [1;94m 2 | [0m        [1;91mdatasource db {[0m
          [1;94m 3 | [0m      
          [1;94m   | [0m

          Validation Error Count: 1
          [Context: getDmmf]

          Prisma CLI Version : 0.0.0"
        `)
      }
    })

    // Note(jkomyno): this fails locally because the colored crate used in Wasm forces the coloring on tty (but apparently not on CI?).
    // On standard terminals, the NO_COLOR env var is actually working as expected (it prints plain uncolored text).
    // See: https://github.com/prisma/prisma-private/issues/210
    test('failures should not have colors when the NO_COLOR env var is set', async () => {
      process.env.NO_COLOR = '1'
      expect.assertions(1)
      const datamodel = `
        datasource db {
      `

      try {
        await getDMMF({ datamodel })
      } catch (e) {
        expect(e.message).toMatchInlineSnapshot(`
          "Prisma schema validation - (get-dmmf wasm)
          Error code: P1012
          error: Error validating: This line is invalid. It does not start with any known Prisma schema keyword.
            -->  schema.prisma:2
             | 
           1 | 
           2 |         datasource db {
           3 |       
             | 

          Validation Error Count: 1
          [Context: getDmmf]

          Prisma CLI Version : 0.0.0"
        `)
      }
    })
  })

  describe('errors', () => {
    test('model with autoincrement should fail if sqlite', async () => {
      expect.assertions(1)
      const datamodel = `
        datasource db {
          provider = "sqlite"
        }
        model User {
          id        Int      @default(autoincrement())
          email     String   @unique
          @@map("users")
        }`

      try {
        await getDMMF({ datamodel })
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
          "Prisma schema validation - (get-dmmf wasm)
          Error code: P1012
          error: Error parsing attribute "@default": The \`autoincrement()\` default value is used on a non-id field even though the datasource does not support this.
            -->  schema.prisma:6
             | 
           5 |         model User {
           6 |           id        Int      @default(autoincrement())
           7 |           email     String   @unique
             | 
          error: Error parsing attribute "@default": The \`autoincrement()\` default value is used on a non-indexed field even though the datasource does not support this.
            -->  schema.prisma:6
             | 
           5 |         model User {
           6 |           id        Int      @default(autoincrement())
           7 |           email     String   @unique
             | 

          Validation Error Count: 2
          [Context: getDmmf]

          Prisma CLI Version : 0.0.0"
        `)
      }
    })

    test('model with autoincrement should fail if mysql', async () => {
      expect.assertions(1)
      const datamodel = `
        datasource db {
          provider = "mysql"
        }
        model User {
          id        Int      @default(autoincrement())
          email     String   @unique
          @@map("users")
        }`

      try {
        await getDMMF({ datamodel })
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
          "Prisma schema validation - (get-dmmf wasm)
          Error code: P1012
          error: Error parsing attribute "@default": The \`autoincrement()\` default value is used on a non-indexed field even though the datasource does not support this.
            -->  schema.prisma:6
             | 
           5 |         model User {
           6 |           id        Int      @default(autoincrement())
           7 |           email     String   @unique
             | 

          Validation Error Count: 1
          [Context: getDmmf]

          Prisma CLI Version : 0.0.0"
        `)
      }
    })

    test('validation errors', async () => {
      expect.assertions(1)
      const datamodel = `generator client {
        provider = "prisma-client-js"
      }
      
      datasource my_db {
        provider = "sqlite"
      }
      
      model User {
        id           String     @id @default(cuid())
        id           String     @id @default(cuid())
        name         String
        email        String     @unique
        status       String     @default("")
        permissions  Permission @default()
        permissions  Permission @default("")
        posts        Post[]
        posts        Post[]
      }
      
      model Post {
        id        String   @id @default(cuid())
        name      String
        email     String   @unique
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
      }
      
      enum Permission {
        ADMIN
        USER
        OWNER
        COLLABORATOR
      }
      `
      try {
        await getDMMF({ datamodel })
      } catch (e) {
        expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
          "Prisma schema validation - (get-dmmf wasm)
          Error code: P1012
          error: Field "id" is already defined on model "User".
            -->  schema.prisma:11
             | 
          10 |         id           String     @id @default(cuid())
          11 |         id           String     @id @default(cuid())
             | 
          error: Field "permissions" is already defined on model "User".
            -->  schema.prisma:16
             | 
          15 |         permissions  Permission @default()
          16 |         permissions  Permission @default("")
             | 
          error: Field "posts" is already defined on model "User".
            -->  schema.prisma:18
             | 
          17 |         posts        Post[]
          18 |         posts        Post[]
             | 
          error: Error validating model "User": At most one field must be marked as the id field with the \`@id\` attribute.
            -->  schema.prisma:9
             | 
           8 |       
           9 |       model User {
          10 |         id           String     @id @default(cuid())
          11 |         id           String     @id @default(cuid())
          12 |         name         String
          13 |         email        String     @unique
          14 |         status       String     @default("")
          15 |         permissions  Permission @default()
          16 |         permissions  Permission @default("")
          17 |         posts        Post[]
          18 |         posts        Post[]
          19 |       }
             | 
          error: Argument "value" is missing.
            -->  schema.prisma:15
             | 
          14 |         status       String     @default("")
          15 |         permissions  Permission @default()
             | 
          error: Error parsing attribute "@default": Expected an enum value, but found \`""\`.
            -->  schema.prisma:16
             | 
          15 |         permissions  Permission @default()
          16 |         permissions  Permission @default("")
             | 

          Validation Error Count: 6
          [Context: getDmmf]

          Prisma CLI Version : 0.0.0"
        `)
      }
    })
  })

  describe('success', () => {
    test(`if a datamodel is provided, succeeds even when a non-existing datamodel path is given`, async () => {
      expect.assertions(2)

      const datamodel = /* prisma */ `
        generator client {
          provider = "prisma-client-js"
        }
        
        datasource my_db {
          provider = "sqlite"
        }
      `

      const dmmf = await getDMMF({ datamodel })
      expect(dmmf.datamodel).toMatchInlineSnapshot(`
        {
          "enums": [],
          "indexes": [],
          "models": [],
          "types": [],
        }
      `)
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, no datasource', async () => {
      const dmmf = await getDMMF({
        datamodel: `model A {
          id Int @id
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, sqlite', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "sqlite"
        }
        model A {
          id Int @id
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('multiple files', async () => {
      const files: MultipleSchemas = [
        [
          'ds.prisma',
          `datasource db {
            provider = "sqlite"
          }`,
        ],
        [
          'A.prisma',
          `model A {
            id Int @id
            name String
          }`,
        ],
        [
          'B.prisma',
          `model B {
            id String @id
            title String
          }`,
        ],
      ]
      const dmmf = await getDMMF({ datamodel: files })
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, postgresql', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "postgresql"
        }
        model A {
          id Int @id
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, mysql', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "mysql"
        }
        model A {
          id Int @id
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, sql server', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "sqlserver"
        }
        model A {
          id Int @id
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('simple model, mongodb', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "mongodb"
        }
        model A {
          id Int @id @map("_id")
          name String
        }`,
      })

      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('@@map model', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "postgresql"
        }
        model User {
          id        Int      @default(autoincrement())
          email     String   @unique
          @@map("users")
        }`,
      })
      expect(dmmf.datamodel).toMatchSnapshot()
      expect(dmmf).toMatchSnapshot()
    })

    test('@@unique model', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "postgres"
        }
  
        // From https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-schema/data-model#examples-3
        // Specify a multi-field unique attribute that includes a relation field
        model Post {
          id        Int     @default(autoincrement())
          author    User    @relation(fields: [authorId], references: [id])
          authorId  Int
          title     String
          published Boolean @default(false)
          
          @@unique([authorId, title])
        }
        model User {
          id    Int    @id @default(autoincrement())
          email String @unique
          posts Post[]
        }
  
        // Specify a multi-field unique attribute on two String fields
        model User1 {
          id        Int     @default(autoincrement())
          firstName String
          lastName  String
          isAdmin   Boolean @default(false)
          @@unique([firstName, lastName])
        }
        
        // Specify a multi-field unique attribute on two String fields and one Boolean field
        model User2 {
          id        Int     @default(autoincrement())
          firstName String
          lastName  String
          isAdmin   Boolean @default(false)
          @@unique([firstName, lastName, isAdmin])
        }
    `,
      })

      expect(dmmf).toMatchSnapshot()
    })

    test('@@id model', async () => {
      const dmmf = await getDMMF({
        datamodel: `
        datasource db {
          provider = "postgres"
        }
        generator client {
          provider = "prisma-client-js"
        }
        
        model User1 {
          id        Int     @default(autoincrement())
          firstName String
          lastName  String
          isAdmin   Boolean @default(false)
          @@id(fields: [firstName, lastName], name: "customName") // with name
        }
        
        // Specify a multi-field id attribute on two String fields and one Boolean field
        model User2 {
          id        Int     @default(autoincrement())
          firstName String
          lastName  String
          isAdmin   Boolean @default(false)
          @@id([firstName, lastName, isAdmin])
        }
    `,
      })

      expect(dmmf).toMatchSnapshot()
    })

    test('chinook introspected schema', async () => {
      const file = await fs.promises.readFile(path.join(fixturesPath, 'chinook.prisma'), 'utf-8')
      const dmmf = await getDMMF({
        datamodel: file,
      })
      const str = JSON.stringify(dmmf)
      expect(str.length).toMatchSnapshot()
    })

    test('odoo introspected schema', async () => {
      const file = await fs.promises.readFile(path.join(fixturesPath, 'odoo.prisma'), 'utf-8')
      const dmmf = await getDMMF({
        datamodel: file,
      })
      const str = JSON.stringify(dmmf)
      expect(str.length).toMatchSnapshot()
    })

    test('big schema read', async () => {
      const file = await fs.promises.readFile(path.join(fixturesPath, 'bigschema.prisma'), 'utf-8')
      const dmmf = await getDMMF({
        datamodel: file,
      })
      const str = JSON.stringify(dmmf)
      expect(str.length).toMatchSnapshot()
    })
  })
})
