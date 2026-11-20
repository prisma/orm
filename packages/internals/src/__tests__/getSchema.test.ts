import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { expect, it, vi } from 'vitest'

import { createSchemaPathInput, getSchemaWithPath } from '../cli/getSchema'
import { fixturesPath } from './__utils__/fixtures'

if (process.env.CI) {
  // 5s is often not enough for the "finds the schema path in the root
  // package.json of a yarn workspace from a child package" test on macOS CI.
  vi.setConfig({ testTimeout: 60_000 })
}

process.env.npm_config_user_agent = 'yarn/1.22.4 npm/? node/v12.18.3 darwin x64'

const FIXTURE_CWD = path.resolve(fixturesPath, 'getSchema')

function toUnixPath(path: string) {
  return path.replace(/\\/g, '/')
}

async function testSchemaPath({
  fixtureName,
  schemaPathFromArgs,
  schemaPathFromConfig,
}: {
  fixtureName: string
  schemaPathFromArgs?: string
  schemaPathFromConfig?: string
}) {
  const cwd = path.resolve(FIXTURE_CWD, fixtureName)

  let asyncResult: string | null | Error

  try {
    const schemaPath = createSchemaPathInput({ schemaPathFromArgs, schemaPathFromConfig, baseDir: cwd })
    asyncResult = (await getSchemaWithPath({ schemaPath, cwd }))?.schemaPath ?? null
  } catch (e) {
    asyncResult = e as Error
  }

  if (typeof asyncResult === 'string') {
    asyncResult = stripVTControlCharacters(toUnixPath(path.relative('.', asyncResult)))
  }

  if (asyncResult instanceof Error) {
    asyncResult.message = stripVTControlCharacters(toUnixPath(asyncResult.message.replace(__dirname, '.')))
  }

  return asyncResult
}

it('throws error if schema is not found', async () => {
  const res = await testSchemaPath({ fixtureName: 'no-schema' })

  expect(res).toMatchInlineSnapshot(`
    [Error: Could not find Prisma Schema that is required for this command.
    You can either provide it with \`--schema\` argument,
    set it in your Prisma Config file (e.g., \`prisma7.config.ts\`),
    set it as \`prisma.schema\` in your package.json,
    or put it into the default location (\`./prisma/schema.prisma\`, or \`./schema.prisma\`.
    Checked following paths:

    schema.prisma: file not found
    prisma/schema.prisma: file not found

    See also https://pris.ly/d/prisma-schema-location]
  `)
})

it('reads from --schema args first even if path is provided in Prisma config file (e.g., `prisma.config.ts`)', async () => {
  const res = await testSchemaPath({
    fixtureName: 'unconventional-path',
    schemaPathFromArgs: path.resolve(FIXTURE_CWD, 'unconventional-path', 'db', 'schema.prisma'),
    schemaPathFromConfig: path.resolve(FIXTURE_CWD, 'unconventional-path-folder', 'db', 'schema.prisma'),
  })

  expect(res).toMatchInlineSnapshot(`"src/__tests__/__fixtures__/getSchema/unconventional-path/db/schema.prisma"`)
})

it('reads from path provided by prisma.config.ts', async () => {
  const res = await testSchemaPath({
    fixtureName: 'unconventional-path',
    schemaPathFromConfig: path.resolve(FIXTURE_CWD, 'unconventional-path', 'db', 'schema.prisma'),
  })

  expect(res).toMatchInlineSnapshot(`"src/__tests__/__fixtures__/getSchema/unconventional-path/db/schema.prisma"`)
})

it('reads from directory provided by prisma.config.ts', async () => {
  const res = await testSchemaPath({
    fixtureName: 'unconventional-path-folder',
    schemaPathFromConfig: path.resolve(FIXTURE_CWD, 'unconventional-path-folder', 'db'),
  })

  expect(res).toMatchInlineSnapshot(`"src/__tests__/__fixtures__/getSchema/unconventional-path-folder/db"`)
})

it('throws error if prisma.config.ts with single file is used but schema file cannot be found', async () => {
  const res = await testSchemaPath({
    fixtureName: 'no-schema',
    schemaPathFromConfig: path.resolve(FIXTURE_CWD, 'no-schema', 'db', 'schema.prisma'),
  })

  expect(res).toMatchInlineSnapshot(
    `[Error: Could not load schema from \`./__fixtures__/getSchema/no-schema/db/schema.prisma\` provided by the Prisma config file: file or directory not found]`,
  )
})

it('throws error if prisma.config.ts with folder is used but schema files cannot be found', async () => {
  const res = await testSchemaPath({
    fixtureName: 'no-schema',
    schemaPathFromConfig: path.resolve(FIXTURE_CWD, 'no-schema', 'db'),
  })

  expect(res).toMatchInlineSnapshot(
    `[Error: Could not load schema from \`./__fixtures__/getSchema/no-schema/db\` provided by the Prisma config file: file or directory not found]`,
  )
})

it('finds the conventional prisma/schema path without configuration', async () => {
  const res = await testSchemaPath({ fixtureName: 'conventional-path' })

  expect(res).toMatchInlineSnapshot(`"src/__tests__/__fixtures__/getSchema/conventional-path/prisma/schema.prisma"`)
})

it('fails with no schema in workspaces', async () => {
  const res = await testSchemaPath({ fixtureName: 'no-schema-workspaces' })

  expect(res).toMatchInlineSnapshot(`
    [Error: Could not find Prisma Schema that is required for this command.
    You can either provide it with \`--schema\` argument,
    set it in your Prisma Config file (e.g., \`prisma7.config.ts\`),
    set it as \`prisma.schema\` in your package.json,
    or put it into the default location (\`./prisma/schema.prisma\`, or \`./schema.prisma\`.
    Checked following paths:

    schema.prisma: file not found
    prisma/schema.prisma: file not found

    See also https://pris.ly/d/prisma-schema-location]
  `)
})
