import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { vitestConsoleContext, vitestContext } from '@prisma/get-platform/src/test-utils/vitestContext'
import { describe, expect, test, vi } from 'vitest'

import { getCliProvidedSchemaFile } from '../../cli/getSchema'
import { formatSchema } from '../../engine-commands'
import { extractSchemaContent, type MultipleSchemas } from '../../utils/schemaFileInput'
import { fixturesPath } from '../__utils__/fixtures'

if (process.env.CI) {
  vi.setConfig({ testTimeout: 20_000 })
}

const ctx = vitestContext.new().add(vitestConsoleContext()).assemble()

describe('schema wasm', () => {
  describe('diff', () => {
    async function testAgainstPreformatted(schemaFilename: string) {
      const { schemas } = await getCliProvidedSchemaFile(path.join(fixturesPath, 'format', schemaFilename))
      const { schemas: preformatted } = await getCliProvidedSchemaFile(
        path.join(fixturesPath, 'format', 'schema.prisma'),
      )
      const formattedByWasm = await formatSchema({ schemas })

      const preformattedContent: string[] = extractSchemaContent(preformatted)
      const formattedByWasmContent: string[] = extractSchemaContent(formattedByWasm)

      expect(preformattedContent).toEqual(formattedByWasmContent)
    }

    test('2-spaces', async () => {
      await testAgainstPreformatted('schema-2-spaces.prisma')
    })

    test('2-spaces-as-tab', async () => {
      await testAgainstPreformatted('schema-2-spaces-as-tab.prisma')
    })

    test('4-spaces', async () => {
      await testAgainstPreformatted('schema-4-spaces.prisma')
    })

    test('4-spaces-as-tab', async () => {
      await testAgainstPreformatted('schema-4-spaces-as-tab.prisma')
    })
  })
})

describe('format custom options', () => {
  const schema = /* prisma */ `
  datasource db {
   provider = "sqlite"
  }
  
  model User {
   id String @default(cuid()) @id
   email String @unique
   name String?
   posts Post[]
  }
`
  const schemas: MultipleSchemas = [['/* schemaPath */', schema]]

  test('tabSize=2', async () => {
    const formatted = await formatSchema({ schemas }, { tabSize: 2 })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchInlineSnapshot(`
      "datasource db {
        provider = "sqlite"
      }

      model User {
        id    String  @id @default(cuid())
        email String  @unique
        name  String?
        posts Post[]
      }
      "
    `)
  })

  test('tabSize=4', async () => {
    const formatted = await formatSchema({ schemas }, { tabSize: 4 })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchInlineSnapshot(`
      "datasource db {
          provider = "sqlite"
      }

      model User {
          id    String  @id @default(cuid())
          email String  @unique
          name  String?
          posts Post[]
      }
      "
    `)
  })
})

describe('format', () => {
  test('valid blog schemaPath', async () => {
    const { schemas } = await getCliProvidedSchemaFile(path.join(fixturesPath, 'blog.prisma'))
    const formatted = await formatSchema({ schemas })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchSnapshot()
  })

  test('valid blog schema', async () => {
    const formatted = await formatSchema({
      schemas: [
        [
          '/* schemaPath */',
          `
      datasource db {
        provider = "sqlite"
      }
      
      generator client {
        provider      = "prisma-client-js"
        binaryTargets = ["native"]
      }
      
      model User {
        id    String  @default(cuid()) @id
        email String  @unique
        name  String?
        posts Post[]
      }
      
      model Post {
        id        String   @default(cuid()) @id
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
        published Boolean
        title     String
        content   String?
        authorId  String?
        author    User?    @relation(fields: [authorId], references: [id])
      }
      
      model Like {
        id     String @default(cuid()) @id
        userId String
        user   User   @relation(fields: [userId], references: [id])
        postId String
        post   Post   @relation(fields: [postId], references: [id])
      
        @@unique([userId, postId])
      }`,
        ],
      ] as const,
    })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)

    expect(formattedContent[0]).toMatchSnapshot()
  })

  test('valid schema with 1 preview feature flag warning', async () => {
    const schema = /* prisma */ `
      generator client {
        provider = "prisma-client-js"
        previewFeatures = ["cockroachdb"]
      }

      datasource db {
        provider = "cockroachdb"
      }

      model SomeUser {
        id   Int    @id
      }
    `
    const schemas: MultipleSchemas = [['/* schemaPath */', schema]]

    const formatted = await formatSchema({ schemas })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchSnapshot()

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(stripVTControlCharacters(ctx.mocked['console.warn'].mock.calls.join('\n'))).toMatchInlineSnapshot(`
      "
      Prisma schema warning:
      - Preview feature "cockroachdb" is deprecated. The functionality can be used without specifying it as a preview feature."
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('valid schema with 3 preview feature flag warnings', async () => {
    const schema = /* prisma */ `
      generator client {
        provider = "prisma-client-js"
        previewFeatures = ["cockroachdb", "mongoDb", "microsoftSqlServer"]
      }

      datasource db {
        provider = "cockroachdb"
      }

      model SomeUser {
        id   Int    @id
      }
    `

    const schemas: MultipleSchemas = [['/* schemaPath */', schema]]

    const formatted = await formatSchema({ schemas })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchSnapshot()

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(stripVTControlCharacters(ctx.mocked['console.warn'].mock.calls.join('\n'))).toMatchInlineSnapshot(`
      "
      Prisma schema warnings:
      - Preview feature "cockroachdb" is deprecated. The functionality can be used without specifying it as a preview feature.
      - Preview feature "mongoDb" is deprecated. The functionality can be used without specifying it as a preview feature.
      - Preview feature "microsoftSqlServer" is deprecated. The functionality can be used without specifying it as a preview feature."
    `)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('invalid schema', async () => {
    const schema = /* prisma */ `
      generator client {
        provider  = "prisma-client-js"
      }

      datasource db {
        provider = "cockroachdb"
      }

      model SomeUser {
        id      Int      @id
        profile Profile?
      }

      model Profile {
        id     Int      @id
        user   SomeUser @relation(fields: [userId], references: [id], onUpdate: SetNull)
        userId Int      @unique
      }
    `

    const schemas: MultipleSchemas = [['/* schemaPath */', schema]]

    const formatted = await formatSchema({ schemas })
    const formattedContent: string[] = extractSchemaContent(formatted)
    expect(formattedContent.length).toBe(1)
    expect(formattedContent[0]).toMatchInlineSnapshot(`
      "generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "cockroachdb"
      }

      model SomeUser {
        id      Int      @id
        profile Profile?
      }

      model Profile {
        id     Int      @id
        user   SomeUser @relation(fields: [userId], references: [id], onUpdate: SetNull)
        userId Int      @unique
      }
      "
    `)

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})
