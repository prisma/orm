import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { getBinaryTargetForCurrentPlatform } from '@prisma/get-platform'
import { vitestConsoleContext, vitestContext } from '@prisma/get-platform/src/test-utils/vitestContext'
import { afterEach, describe, expect, it, test, vi } from 'vitest'

import { loadSchemaContext } from '../../cli/schemaContext'
import { GeneratorRegistry, getGenerators } from '../../get-generators/getGenerators'
import { omit } from '../../utils/omit'
import { pick } from '../../utils/pick'

const ctx = vitestContext.new().add(vitestConsoleContext()).assemble()

vi.setConfig({
  testTimeout: process.env.CI ? 60_000 : 20_000,
})

let generatorPath = path.join(__dirname, 'generator')

if (process.platform === 'win32') {
  generatorPath += '.cmd'
}

expect.addSnapshotSerializer({
  test: (val) =>
    val && typeof val === 'object' && typeof val['sourceFilePath'] === 'string' && path.isAbsolute(val.sourceFilePath),
  serialize(val, config, indentation, depth, refs, printer) {
    const newVal = { ...val, sourceFilePath: path.relative(__dirname, val.sourceFilePath) }
    return printer(newVal, config, indentation, depth, refs)
  },
})

expect.addSnapshotSerializer({
  test: (val) => typeof val === 'string' && val.includes(__dirname),
  serialize(val, config, indentation, depth, refs, printer) {
    const newVal = val.replaceAll(__dirname, '/project')
    return printer(newVal, config, indentation, depth, refs)
  },
})

const registry = {
  'predefined-generator': {
    type: 'rpc',
    generatorPath: generatorPath,
  },
} satisfies GeneratorRegistry

describe('getGenerators', () => {
  afterEach(() => {
    // Clean up environment variables set by tests
    delete process.env.BINARY_TARGETS_ENV_VAR_TEST
  })

  test('basic', async () => {
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen {
        provider      = "predefined-generator"
        binaryTargets = ["darwin"]
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    expect(omit(generators[0].options!.generator, ['output'])).toMatchInlineSnapshot(`
      {
        "binaryTargets": [
          {
            "fromEnvVar": null,
            "value": "darwin",
          },
        ],
        "config": {},
        "name": "gen",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema.prisma",
      }
    `)

    generators.forEach((g) => g.stop())
  })

  it('basic - binaryTargets - native string', async () => {
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema-binaryTargets.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen_env {
        provider      = "predefined-generator"
        binaryTargets = "native"
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema-binaryTargets.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    const generator = omit(generators[0].options!.generator, ['output'])
    const binaryTarget = await getBinaryTargetForCurrentPlatform()

    expect(generator.binaryTargets).toHaveLength(1)
    expect(generator.binaryTargets[0].value).toEqual(binaryTarget)
    expect(generator.binaryTargets[0].fromEnvVar).toEqual(null)

    expect(omit(generator, ['binaryTargets'])).toMatchInlineSnapshot(`
      {
        "config": {},
        "name": "gen_env",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema-binaryTargets.prisma",
      }
    `)

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    generators.forEach((g) => g.stop())
  })

  it('basic - binaryTargets as env var - native string', async () => {
    process.env.BINARY_TARGETS_ENV_VAR_TEST = '"native"'

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema-binaryTargets-env-var.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen_env {
        provider      = "predefined-generator"
        binaryTargets = env("BINARY_TARGETS_ENV_VAR_TEST")
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    const generator = omit(generators[0].options!.generator, ['output'])
    const binaryTarget = await getBinaryTargetForCurrentPlatform()

    expect(generator.binaryTargets).toHaveLength(1)
    expect(generator.binaryTargets[0].value).toEqual(binaryTarget)
    expect(generator.binaryTargets[0].fromEnvVar).toEqual('BINARY_TARGETS_ENV_VAR_TEST')

    expect(omit(generator, ['binaryTargets'])).toMatchInlineSnapshot(`
      {
        "config": {},
        "name": "gen_env",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
      }
    `)

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    generators.forEach((g) => g.stop())
  })

  it('basic - binaryTargets as env var - native (in array)', async () => {
    process.env.BINARY_TARGETS_ENV_VAR_TEST = '["native"]'

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema-binaryTargets-env-var.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen_env {
        provider      = "predefined-generator"
        binaryTargets = env("BINARY_TARGETS_ENV_VAR_TEST")
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    const generator = omit(generators[0].options!.generator, ['output'])
    const binaryTarget = await getBinaryTargetForCurrentPlatform()

    expect(generator.binaryTargets).toHaveLength(1)
    expect(generator.binaryTargets[0].value).toEqual(binaryTarget)
    expect(generator.binaryTargets[0].fromEnvVar).toEqual(null)

    expect(omit(generator, ['binaryTargets'])).toMatchInlineSnapshot(`
      {
        "config": {},
        "name": "gen_env",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
      }
    `)

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    generators.forEach((g) => g.stop())
  })

  it('basic - binaryTargets as env var - darwin, windows, debian', async () => {
    process.env.BINARY_TARGETS_ENV_VAR_TEST =
      '["darwin", "darwin-arm64", "windows", "debian-openssl-1.1.x", "debian-openssl-3.0.x"]'

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema-binaryTargets-env-var.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen_env {
        provider      = "predefined-generator"
        binaryTargets = env("BINARY_TARGETS_ENV_VAR_TEST")
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    expect(omit(generators[0].options!.generator, ['output'])).toMatchInlineSnapshot(`
      {
        "binaryTargets": [
          {
            "fromEnvVar": null,
            "value": "darwin",
          },
          {
            "fromEnvVar": null,
            "value": "darwin-arm64",
          },
          {
            "fromEnvVar": null,
            "value": "windows",
          },
          {
            "fromEnvVar": null,
            "value": "debian-openssl-1.1.x",
          },
          {
            "fromEnvVar": null,
            "value": "debian-openssl-3.0.x",
          },
        ],
        "config": {},
        "name": "gen_env",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
      }
    `)

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    generators.forEach((g) => g.stop())
  })

  it('basic - binaryTargets as env var - linux-musl (missing current platform)', async () => {
    process.env.BINARY_TARGETS_ENV_VAR_TEST = '["linux-musl"]'

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'valid-minimal-schema-binaryTargets-env-var.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
    })

    expect(generators.map((g) => g.manifest)).toMatchInlineSnapshot(`
      [
        {
          "defaultOutput": "/project",
          "denylist": [
            "SomeForbiddenType",
          ],
          "prettyName": "This is a pretty name",
          "requiresEngines": [
            "schemaEngine",
          ],
        },
      ]
    `)

    expect(pick(generators[0].options!, ['datamodel', 'datasources', 'otherGenerators'])).toMatchInlineSnapshot(`
      {
        "datamodel": "datasource db {
        provider = "sqlite"
      }

      generator gen_env {
        provider      = "predefined-generator"
        binaryTargets = env("BINARY_TARGETS_ENV_VAR_TEST")
      }

      model User {
        id   Int    @id
        name String
      }
      ",
        "datasources": [
          {
            "activeProvider": "sqlite",
            "name": "db",
            "provider": "sqlite",
            "schemas": [],
            "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
          },
        ],
        "otherGenerators": [],
      }
    `)

    expect(omit(generators[0].options!.generator, ['output'])).toMatchInlineSnapshot(`
      {
        "binaryTargets": [
          {
            "fromEnvVar": null,
            "value": "linux-musl",
          },
        ],
        "config": {},
        "name": "gen_env",
        "previewFeatures": [],
        "provider": {
          "fromEnvVar": null,
          "value": "predefined-generator",
        },
        "sourceFilePath": "valid-minimal-schema-binaryTargets-env-var.prisma",
      }
    `)

    const consoleLog = stripVTControlCharacters(ctx.mocked['console.log'].mock.calls.join('\n'))
    expect(consoleLog).toContain('Warning: Your current platform')
    expect(consoleLog).toContain(`s not included in your generator's \`binaryTargets\` configuration`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    generators.forEach((g) => g.stop())
  })

  test('filter generator names', async () => {
    const registry = {
      'predefined-generator-1': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
      'predefined-generator-2': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
      'predefined-generator-3': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
    } satisfies GeneratorRegistry

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'multiple-generators-schema.prisma') },
    })
    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
      generatorNames: ['client_1', 'client_3'],
    })

    expect(generators).toHaveLength(2)
    expect(generators[0].config.name).toEqual('client_1')
    expect(generators[0].getProvider()).toEqual('predefined-generator-1')
    expect(generators[1].config.name).toEqual('client_3')
    expect(generators[1].getProvider()).toEqual('predefined-generator-3')

    generators.forEach((g) => g.stop())
  })

  test('fail on invalid binaryTarget', async () => {
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'invalid-binary-target-schema.prisma') },
    })

    await expect(
      getGenerators({
        schemaContext,
        registry,
        cliCommand: 'prisma',
      }),
    ).rejects.toThrow('Unknown')

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('fail if datasource is missing', async () => {
    expect.assertions(5)
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-datasource-schema.prisma') },
    })

    try {
      await getGenerators({
        schemaContext,
        registry,
        cliCommand: 'prisma',
      })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
        "
        You don't have any datasource defined in your schema.prisma.
        You can define a datasource like this:

        datasource db {
          provider = "postgresql"
        }

        More information in our documentation:
        https://pris.ly/d/prisma-schema
        "
      `)
    }

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('fail if no model(s) found and allow-no-models flag is false - prisma7 sqlite guidance', async () => {
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-sqlite-schema.prisma') },
    })

    await expect(
      getGenerators({
        schemaContext,
        registry,
        allowNoModels: false,
        cliCommand: 'prisma7',
      }),
    ).rejects.toThrow('  $ prisma7 generate')

    await expect(
      getGenerators({
        schemaContext,
        registry,
        allowNoModels: false,
        cliCommand: 'prisma7',
      }),
    ).rejects.not.toThrow('  $ prisma generate')
  })

  test('fail if no model(s) found and allow-no-models flag is false - sqlite', async () => {
    expect.assertions(5)
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-sqlite-schema.prisma') },
    })

    try {
      await getGenerators({
        schemaContext,
        registry,
        cliCommand: 'prisma',
        allowNoModels: false,
      })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
        "
        You don't have any models defined in your schema.prisma, so nothing will be generated.

        Prisma Client is typically generated from models defined in your schema. If you plan to use raw SQL queries only (e.g. $queryRaw), remove the --require-models flag to generate the client without models:

          $ prisma generate

        Otherwise, you can define a model like this:

        model User {
          id    Int     @id @default(autoincrement())
          email String  @unique
          name  String?
        }

        More information in our documentation:
        https://pris.ly/d/prisma-schema
        "
      `)
    }

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('fail if no model(s) found and allow-no-models flag is false - prisma7 mongodb guidance', async () => {
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-mongodb-schema.prisma') },
    })

    await expect(
      getGenerators({
        schemaContext,
        registry,
        allowNoModels: false,
        cliCommand: 'prisma7',
      }),
    ).rejects.toThrow('  $ prisma7 generate')

    await expect(
      getGenerators({
        schemaContext,
        registry,
        allowNoModels: false,
        cliCommand: 'prisma7',
      }),
    ).rejects.not.toThrow('  $ prisma generate')
  })

  test('fail if no model(s) found and allow-no-models flag is false - mongodb', async () => {
    expect.assertions(5)
    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-mongodb-schema.prisma') },
    })

    try {
      await getGenerators({
        schemaContext,
        registry,
        cliCommand: 'prisma',
        allowNoModels: false,
      })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
        "
        You don't have any models defined in your schema.prisma, so nothing will be generated.

        Prisma Client is typically generated from models defined in your schema. If you plan to use raw queries only, remove the --require-models flag to generate the client without models:

          $ prisma generate

        Otherwise, you can define a model like this:

        model User {
          id    String  @id @default(auto()) @map("_id") @db.ObjectId
          email String  @unique
          name  String?
        }

        More information in our documentation:
        https://pris.ly/d/prisma-schema
        "
      `)
    }

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.info'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })

  test('fail if generator not found', async () => {
    expect.assertions(1)

    const registry = {
      'predefined-generator-1': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
      'predefined-generator-2': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
      'predefined-generator-3': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
    } satisfies GeneratorRegistry

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'multiple-generators-schema.prisma') },
    })

    try {
      await getGenerators({
        schemaContext,
        registry,
        cliCommand: 'prisma',
        generatorNames: ['client_1', 'invalid_generator'],
      })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(
        `"The generator invalid_generator specified via --generator does not exist in your Prisma schema"`,
      )
    }
  })

  test('pass if no model(s) found but allow-no-models flag is true - sqlite', async () => {
    expect.assertions(1)

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-sqlite-schema.prisma') },
    })

    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
      allowNoModels: true,
    })

    for (const generator of generators) {
      generator.stop()
    }

    return expect(generators.length).toBeGreaterThanOrEqual(1)
  })

  test('pass if no model(s) found but allow-no-models flag is true - mongodb', async () => {
    expect.assertions(1)

    const registry = {
      'prisma-client-js': {
        type: 'rpc',
        generatorPath: generatorPath,
      },
    } satisfies GeneratorRegistry

    const schemaContext = await loadSchemaContext({
      schemaPath: { cliProvidedPath: path.join(__dirname, 'missing-models-mongodb-schema.prisma') },
    })

    const generators = await getGenerators({
      schemaContext,
      registry,
      cliCommand: 'prisma',
      allowNoModels: true,
    })

    expect(generators.length).toBeGreaterThanOrEqual(1)

    generators.forEach((g) => g.stop())
  })
})
