import { jestContext } from '@prisma/get-platform'

import { redactCommandArray, SENSITIVE_CLI_OPTIONS, tryToReadDataFromSchema } from '../utils/checkpoint'

const ctx = jestContext.new().assemble()

it('should redact --option [value]', () => {
  for (const option of SENSITIVE_CLI_OPTIONS) {
    expect(redactCommandArray(['cmd', option, 'secret'])).toEqual(['cmd', option, '[redacted]'])
  }
})

it('should redact --option=[value]', () => {
  for (const option of SENSITIVE_CLI_OPTIONS) {
    expect(redactCommandArray(['cmd', `${option}=secret`])).toEqual(['cmd', `${option}=[redacted]`])
  }
})

it('should redact a PostgreSQL connection string', () => {
  expect(redactCommandArray(['init', '--url', '"postgresql://janedoe:mypassword@localhost:5432/mydb?schema=sample"']))
    .toMatchInlineSnapshot(`
    [
      "init",
      "--url",
      "[redacted]",
    ]
  `)
})

it('should redact a MySQL connection string', () => {
  expect(
    redactCommandArray([
      'init',
      `--url "mysql://janedoe:mypassword@localhost:3306/mydb?connection_limit=5&socket_timeout"`,
    ]),
  ).toMatchInlineSnapshot(`
    [
      "init",
      "--url=[redacted]",
    ]
  `)
})

it('should redact a MongoDB connection string', () => {
  expect(
    redactCommandArray([
      'init',
      `--url "mongodb+srv://root:<password>@cluster0.ab1cd.mongodb.net/myDatabase?retryWrites=true&w=majority"`,
    ]),
  ).toMatchInlineSnapshot(`
    [
      "init",
      "--url=[redacted]",
    ]
  `)
})

it('should redact a SQLite connection string', () => {
  expect(redactCommandArray(['init', '--url', '"file:./dev.db"'])).toMatchInlineSnapshot(`
    [
      "init",
      "--url",
      "[redacted]",
    ]
  `)
})

it('should redact a SQL Server connection string', () => {
  expect(
    redactCommandArray([
      'init',
      `--url="sqlserver://localhost:1433;initial catalog=sample;user=sa;password=mypassword;"`,
    ]),
  ).toMatchInlineSnapshot(`
    [
      "init",
      "--url=[redacted]",
    ]
  `)
})

it('should redact a path with for example --schema', () => {
  expect(redactCommandArray(['cmd', '--schema', '../../../../directory/my_schema.prisma'])).toMatchInlineSnapshot(`
    [
      "cmd",
      "--schema",
      "[redacted]",
    ]
  `)
})

it('should redact a name with for example --name', () => {
  expect(redactCommandArray(['cmd', '--name', '1234_my_name'])).toMatchInlineSnapshot(`
    [
      "cmd",
      "--name",
      "[redacted]",
    ]
  `)
})

it('should read data from Prisma schema', async () => {
  ctx.fixture('checkpoint-read-schema')

  await expect(tryToReadDataFromSchema({ cliProvidedPath: './schema.prisma' })).resolves.toMatchInlineSnapshot(`
    {
      "schemaGeneratorsProviders": [
        "prisma-client",
        "prisma-client-js",
        "something",
      ],
      "schemaPreviewFeatures": [
        "extendedIndexes",
        "fullTextSearch",
      ],
      "schemaProvider": "sqlite",
    }
  `)
})

it('should redact token from Platform commands', () => {
  expect(redactCommandArray(['platform', '--token="foo"'])).toMatchInlineSnapshot(`
    [
      "platform",
      "--token=[redacted]",
    ]
  `)
})

it('should redact a database url from Platform accelerate enable command', () => {
  expect(redactCommandArray(['platform', 'accelerate', 'enable', '--url="foo"'])).toMatchInlineSnapshot(`
    [
      "platform",
      "accelerate",
      "enable",
      "--url=[redacted]",
    ]
  `)
})
