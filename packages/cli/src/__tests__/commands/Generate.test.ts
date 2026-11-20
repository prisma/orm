import path from 'node:path'

import { BaseContext, jestConsoleContext, jestContext } from '@prisma/get-platform'
import stripAnsi from 'strip-ansi'

import { Generate } from '../../Generate'
import { configContextContributor } from '../_utils/config-context'

// The real Watcher watches the filesystem forever; an immediately-ending
// iterator lets watch-mode parse() return so tests can assert on it.
jest.mock('../../generate/Watcher', () => ({
  Watcher: class {
    add() {}
    async *[Symbol.asyncIterator]() {}
  },
}))

const ctx = jestContext.new().add(jestConsoleContext()).add(configContextContributor()).assemble()

describe('prisma.config.ts', () => {
  it('should not require a datasource in the config by default', async () => {
    ctx.fixture('no-config')

    const result = Generate.new('prisma').parse([], await ctx.config())
    await expect(result).resolves.toBeDefined()
  })

  it('using `--sql` should require a datasource in the config', async () => {
    ctx.fixture('no-config')

    const result = Generate.new('prisma').parse(['--sql'], await ctx.config())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The datasource.url property is required in your Prisma config file when using prisma generate --sql."`,
    )
  })

  it('renders no-generator guidance with the selected executable', async () => {
    ctx.fixture('no-generator')

    const generate = new Generate(
      () => Promise.resolve(),
      () => Promise.resolve({ prompted: false }),
      { identity: 'prisma7' },
    )
    const result = await generate.parse([], await ctx.config())

    expect(result).toContain('$ prisma7 generate')
    expect(result).not.toContain('$ prisma generate')
  })
})

describe('using cli', () => {
  it('should work with a custom output dir', async () => {
    ctx.fixture('example-project')
    const data = await ctx.cli('generate')

    const stdout = data.stdout

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma."
    `)
  }, 60_000) // timeout

  it('should work with prisma schema folder', async () => {
    ctx.fixture('multi-schema-files/valid-custom-output')
    const data = await ctx.cli('generate', '--schema=./prisma/schema')
    const stdout = data.stdout

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./prisma/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`"Prisma schema loaded from prisma/schema."`)
  })

  it('should display the right yarn command for custom outputs', async () => {
    ctx.fixture('custom-output-yarn')
    const data = await ctx.cli('generate')
    const stdout = data.stdout

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma."
    `)
  })

  it('should display the right npm command for custom outputs', async () => {
    ctx.fixture('custom-output-npm')
    const data = await ctx.cli('generate')
    const stdout = data.stdout

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma."
    `)
  })

  it('should display the right pnpm command for custom outputs', async () => {
    ctx.fixture('custom-output-pnpm')
    const data = await ctx.cli('generate')
    const stdout = data.stdout

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma."
    `)
  })

  it('displays basic instructions in default outputs', async () => {
    ctx.fixture('default-output')
    const data = await ctx.cli('generate')

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    // use regex to extract the output location below with a dummy location
    const outputLocation = data.stdout.match(/to (.*) in/)?.[1]
    let stdout = data.stdout
    stdout = stdout.replace(outputLocation!, '<output>')

    expect(stdout).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to <output> in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
    expect(data.stderr).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from prisma/schema.prisma."
    `)
  })
})

describe('prisma-client-js should work with no models', () => {
  const generateWithNoModels = async (ctx: BaseContext) => {
    const data = await ctx.cli('generate')

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    return data
  }

  test('with sqlite', async () => {
    ctx.fixture('no-models-prisma-client-js/sqlite')
    await generateWithNoModels(ctx)
  })

  test('with mysql', async () => {
    ctx.fixture('no-models-prisma-client-js/mysql')
    await generateWithNoModels(ctx)
  })

  test('with postgresql', async () => {
    ctx.fixture('no-models-prisma-client-js/postgresql')
    await generateWithNoModels(ctx)
  })

  test('with sqlserver', async () => {
    ctx.fixture('no-models-prisma-client-js/sqlserver')
    await generateWithNoModels(ctx)
  })

  test('with mongo', async () => {
    ctx.fixture('no-models-prisma-client-js/mongo')
    await generateWithNoModels(ctx)
  })
})

describe('prisma-client should work with no models', () => {
  const generateWithNoModels = async (ctx: BaseContext) => {
    const data = await ctx.cli('generate')

    if (typeof data.signal === 'number' && data.signal !== 0) {
      throw new Error(data.stderr + data.stdout)
    }

    return data
  }

  test('with sqlite', async () => {
    ctx.fixture('no-models-prisma-client/sqlite')
    await generateWithNoModels(ctx)
  })

  test('with mysql', async () => {
    ctx.fixture('no-models-prisma-client/mysql')
    await generateWithNoModels(ctx)
  })

  test('with postgresql', async () => {
    ctx.fixture('no-models-prisma-client/postgresql')
    await generateWithNoModels(ctx)
  })

  test('with sqlserver', async () => {
    ctx.fixture('no-models-prisma-client/sqlserver')
    await generateWithNoModels(ctx)
  })
})

it('should hide hints with --no-hints', async () => {
  ctx.fixture('example-project')
  const data = await ctx.cli('generate', '--no-hints')

  if (typeof data.signal === 'number' && data.signal !== 0) {
    throw new Error(data.stderr + data.stdout)
  }

  expect(data.stdout).toMatchInlineSnapshot(`
    "
    ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms
    "
  `)
  expect(data.stderr).toMatchInlineSnapshot(`
    "Loaded Prisma config from prisma.config.ts.

    Prisma schema loaded from prisma/schema.prisma."
  `)
})

it('should still show the global/local version warning with --no-hints', async () => {
  ctx.fixture('example-project')
  const generate = new Generate(jest.fn(), jest.fn().mockResolvedValue({ prompted: false }), {
    identity: 'prisma',
    getGlobalLocalVersionMismatchWarning: () => Promise.resolve('warn global/local version mismatch'),
  })
  const output = await generate.parse(['--no-hints'], await ctx.config())

  expect(output).toContain('warn global/local version mismatch')
  expect(output).not.toContain('Start by importing your Prisma Client')
}, 60_000)

it('should not fail generate when the global/local version warning lookup fails', async () => {
  ctx.fixture('example-project')
  const getGlobalLocalVersionMismatchWarning = jest.fn().mockRejectedValue(new Error('version lookup failed'))
  const generate = new Generate(jest.fn(), jest.fn().mockResolvedValue({ prompted: false }), {
    identity: 'prisma',
    getGlobalLocalVersionMismatchWarning,
  })
  const output = stripAnsi((await generate.parse([], await ctx.config())).toString())

  expect(getGlobalLocalVersionMismatchWarning).toHaveBeenCalledTimes(1)
  expect(output).toContain('Generated Prisma Client')
  expect(output).not.toContain('version lookup failed')
}, 60_000)

it('should check local package versions from the schema root directory', async () => {
  ctx.fixture('generate-from-parent-dir')
  const getGlobalLocalVersionMismatchWarning = jest.fn().mockResolvedValue(null)
  const generate = new Generate(jest.fn(), jest.fn().mockResolvedValue({ prompted: false }), {
    identity: 'prisma',
    getGlobalLocalVersionMismatchWarning,
  })

  await generate.parse(['--schema=./subdirectory/schema.prisma'], await ctx.config())

  expect(getGlobalLocalVersionMismatchWarning).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: path.join(process.cwd(), 'subdirectory'),
    }),
  )
}, 60_000)

it('should show the global/local version warning without a prisma-client-js generator', async () => {
  ctx.fixture('no-config')
  const generate = new Generate(jest.fn(), jest.fn().mockResolvedValue({ prompted: false }), {
    identity: 'prisma',
    getGlobalLocalVersionMismatchWarning: () => Promise.resolve('warn global/local version mismatch'),
  })
  const output = await generate.parse([], await ctx.config())

  expect(output).toContain('warn global/local version mismatch')
}, 60_000)

it('should run the skills offer before the survey handler when hints are not disabled', async () => {
  ctx.fixture('example-project')
  const calls: string[] = []
  const surveyHandler = jest.fn(() => {
    calls.push('survey')
    return Promise.resolve()
  })
  const offerHandler = jest.fn(() => {
    calls.push('offer')
    return Promise.resolve({ prompted: false })
  })
  const generate = new Generate(surveyHandler, offerHandler, { identity: 'prisma' })
  await generate.parse([], await ctx.config())
  expect(calls).toEqual(['offer', 'survey'])
})

it('should skip the survey handler when the skills offer prompted', async () => {
  ctx.fixture('example-project')
  const surveyHandler = jest.fn()
  const offerHandler = jest.fn().mockResolvedValue({ prompted: true })
  const generate = new Generate(surveyHandler, offerHandler, { identity: 'prisma' })
  await generate.parse([], await ctx.config())
  expect(offerHandler).toHaveBeenCalledTimes(1)
  expect(surveyHandler).not.toHaveBeenCalled()
})

it('should call neither the skills offer nor the survey handler when hints are disabled', async () => {
  ctx.fixture('example-project')
  const surveyHandler = jest.fn()
  const offerHandler = jest.fn()
  const generate = new Generate(surveyHandler, offerHandler, { identity: 'prisma' })
  await generate.parse(['--no-hints'], await ctx.config())
  expect(offerHandler).not.toHaveBeenCalled()
  expect(surveyHandler).not.toHaveBeenCalled()
})

it('should call neither the skills offer nor the survey handler in watch mode', async () => {
  ctx.fixture('example-project')
  const surveyHandler = jest.fn()
  const offerHandler = jest.fn()
  const generate = new Generate(surveyHandler, offerHandler, { identity: 'prisma' })
  await generate.parse(['--watch'], await ctx.config())
  expect(offerHandler).not.toHaveBeenCalled()
  expect(surveyHandler).not.toHaveBeenCalled()
})

it('should error with exit code 1 with incorrect schema', async () => {
  ctx.fixture('broken-example-project')
  await expect(ctx.cli('generate').catch((e) => e.exitCode)).resolves.toEqual(1)
})

it('should work with a custom generator', async () => {
  ctx.fixture('custom-generator')
  const data = await ctx.cli('generate')

  if (typeof data.signal === 'number' && data.signal !== 0) {
    throw new Error(data.stderr + data.stdout)
  }

  // Output written by the generator process itself, forwarded through the CLI's stdout.
  expect(data.stdout).toContain(`minimal generator: generate`)
  // The generator's `prettyName`, as reported by the CLI once generation finished.
  expect(data.stdout).toContain(`I am a minimal generator`)
})

describe('prisma-client-ts validation', () => {
  it('should throw errors for an unknown compilerBuild', async () => {
    ctx.fixture('invalid-compiler-build')
    const output = Generate.new('prisma').parse([], await ctx.config())
    await expect(output).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid compiler build: "invalid", expected one of: "fast", "small"

      "
    `)
  })
})

describe('prisma-client-js validation', () => {
  it('should throw errors for an unknown compilerBuild', async () => {
    ctx.fixture('invalid-compiler-build-client-js')
    const output = Generate.new('prisma').parse([], await ctx.config())
    await expect(output).rejects.toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid compiler build: "invalid", expected one of: "fast", "small"

      "
    `)
  })
})

describe('--schema from project directory', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1)
  })

  afterEach(() => {
    jest.spyOn(Math, 'random').mockRestore()
  })

  it('--schema relative path: should work', async () => {
    expect.assertions(1)
    ctx.fixture('generate-from-project-dir')
    const result = await Generate.new('prisma').parse(['--schema=./schema.prisma'], await ctx.config())

    expect(result).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./@prisma/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--schema relative path: should fail - invalid path', async () => {
    ctx.fixture('generate-from-project-dir')
    const result = Generate.new('prisma').parse(['--schema=./doesnotexists.prisma'], await ctx.config())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Could not load \`--schema\` from provided path \`doesnotexists.prisma\`: file or directory not found"`,
    )
  })

  it('--schema absolute path: should work', async () => {
    ctx.fixture('generate-from-project-dir')
    const absoluteSchemaPath = path.resolve('./schema.prisma')
    const output = await Generate.new('prisma').parse([`--schema=${absoluteSchemaPath}`], await ctx.config())

    expect(output).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./@prisma/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--schema absolute path: should fail - invalid path', async () => {
    ctx.fixture('generate-from-project-dir')
    const absoluteSchemaPath = path.resolve('./doesnotexists.prisma')
    const result = Generate.new('prisma').parse([`--schema=${absoluteSchemaPath}`], await ctx.config())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Could not load \`--schema\` from provided path \`doesnotexists.prisma\`: file or directory not found"`,
    )
  })

  it('should throw errors if schema does not exist at default path', async () => {
    ctx.fixture('empty')
    const output = Generate.new('prisma').parse([], await ctx.config())
    await expect(output).rejects.toThrowErrorMatchingInlineSnapshot(`
      "Could not find Prisma Schema that is required for this command.
      You can either provide it with \`--schema\` argument,
      set it in your Prisma Config file (e.g., \`prisma7.config.ts\`),
      set it as \`prisma.schema\` in your package.json,
      or put it into the default location (\`./prisma/schema.prisma\`, or \`./schema.prisma\`.
      Checked following paths:

      schema.prisma: file not found
      prisma/schema.prisma: file not found

      See also https://pris.ly/d/prisma-schema-location"
    `)
  })
})

describe('--schema from parent directory', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1)
  })

  afterEach(() => {
    jest.spyOn(Math, 'random').mockRestore()
  })

  it('--schema relative path: should work', async () => {
    expect.assertions(1)
    ctx.fixture('generate-from-parent-dir')
    const result = await Generate.new('prisma').parse(['--schema=./subdirectory/schema.prisma'], await ctx.config())

    expect(result).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./subdirectory/@prisma/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--schema relative path: should fail - invalid path', async () => {
    ctx.fixture('generate-from-parent-dir')

    const result = Generate.new('prisma').parse(['--schema=./subdirectory/doesnotexists.prisma'], await ctx.config())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Could not load \`--schema\` from provided path \`subdirectory/doesnotexists.prisma\`: file or directory not found"`,
    )
  })

  it('--schema absolute path: should work', async () => {
    expect.assertions(1)
    ctx.fixture('generate-from-parent-dir')
    const absoluteSchemaPath = path.resolve('./subdirectory/schema.prisma')
    const result = await Generate.new('prisma').parse([`--schema=${absoluteSchemaPath}`], await ctx.config())

    expect(result).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./subdirectory/@prisma/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--schema absolute path: should fail - invalid path', async () => {
    ctx.fixture('generate-from-parent-dir')

    const absoluteSchemaPath = path.resolve('./subdirectory/doesnotexists.prisma')
    const result = Generate.new('prisma').parse([`--schema=${absoluteSchemaPath}`], await ctx.config())
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Could not load \`--schema\` from provided path \`subdirectory/doesnotexists.prisma\`: file or directory not found"`,
    )
  })

  it('should load schema located next to a nested config', async () => {
    ctx.fixture('prisma-config-nested')

    const result = await Generate.new('prisma').parse(
      ['--config=./config/prisma.config.ts'],
      await ctx.config(),
      path.join(process.cwd(), 'config'),
    )

    expect(result).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--generator: should work - valid generator names', async () => {
    ctx.fixture('example-project')
    const result = await Generate.new('prisma').parse(
      ['--schema=./prisma/multiple-generator.prisma', '--generator=client', '--generator=client_3'],
      await ctx.config(),
    )

    expect(result).toMatchInlineSnapshot(`
      "
      ✔ Generated Prisma Client (v0.0.0) to ./generated/client in XXXms

      ✔ Generated Prisma Client (v0.0.0) to ./generated/client_3 in XXXms

      Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

      "
    `)
  })

  it('--generator: should fail - single invalid generator name', async () => {
    ctx.fixture('example-project')

    await expect(
      Generate.new('prisma').parse(
        ['--schema=./prisma/multiple-generator.prisma', '--generator=client', '--generator=invalid_client'],
        await ctx.config(),
      ),
    ).rejects.toMatchInlineSnapshot(
      `"The generator invalid_client specified via --generator does not exist in your Prisma schema"`,
    )
  })

  it('--generator: should fail - multiple invalid generator names', async () => {
    ctx.fixture('example-project')

    await expect(
      Generate.new('prisma').parse(
        [
          '--schema=./prisma/multiple-generator.prisma',
          '--generator=client',
          '--generator=invalid_client',
          '--generator=invalid_client_2',
        ],
        await ctx.config(),
      ),
    ).rejects.toMatchInlineSnapshot(
      `"The generators invalid_client, invalid_client_2 specified via --generator do not exist in your Prisma schema"`,
    )
  })
})

describe('with --sql', () => {
  it('should throw error on invalid sql', async () => {
    ctx.fixture('typed-sql-invalid')
    await expect(Generate.new('prisma').parse(['--sql'], await ctx.config())).rejects.toMatchInlineSnapshot(`
      "Errors while reading sql files:

      In prisma/sql/invalidQuery.sql:
      Error: Error describing the query.
      error returned from database: (code: 1) near "Not": syntax error


      "
    `)
  })

  it('throws error on mssql', async () => {
    ctx.fixture('typed-sql-invalid-mssql')
    await expect(Generate.new('prisma').parse(['--sql'], await ctx.config())).rejects.toMatchInlineSnapshot(
      `"Typed SQL is supported only for postgresql, cockroachdb, mysql, sqlite providers"`,
    )
  })

  it('throws error on mongo', async () => {
    ctx.fixture('typed-sql-invalid-mongo')
    await expect(Generate.new('prisma').parse(['--sql'], await ctx.config())).rejects.toMatchInlineSnapshot(
      `"Typed SQL is supported only for postgresql, cockroachdb, mysql, sqlite providers"`,
    )
  })
})
