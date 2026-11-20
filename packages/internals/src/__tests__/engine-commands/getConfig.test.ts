import { serialize } from '@prisma/get-platform/src/test-utils/vitest-snapshot-serializer'
import { describe, expect, test } from 'vitest'

import { getConfig, isRustPanic } from '../..'

describe('getConfig', () => {
  test('should raise a Rust panic when given arguments of the wrong type', async () => {
    expect.assertions(1)

    try {
      // @ts-expect-error
      await getConfig({ datamodel: true })
    } catch (e) {
      const error = e as Error
      expect(isRustPanic(error)).toBe(true)
    }
  })

  test('empty config', async () => {
    const config = await getConfig({
      datamodel: `
      datasource db {
        provider = "sqlite"
      }

      model A {
        id Int @id
        name String
      }`,
    })

    expect(config.datasources).toHaveLength(1)
    expect(config.datasources[0].provider).toEqual('sqlite')
    expect(config.generators).toHaveLength(0)
    expect(config.warnings).toHaveLength(0)
    expect(serialize(JSON.stringify(config, null, 2))).toMatchSnapshot()
  })

  test('with generator and datasource', async () => {
    const config = await getConfig({
      datamodel: `
    datasource db {
      provider = "sqlite"
    }

    generator gen {
      provider = "fancy-provider"
      binaryTargets = ["native"]
    }

    model A {
      id Int @id
      name String
    }`,
    })

    expect(config.datasources).toHaveLength(1)
    expect(config.generators).toHaveLength(1)
    expect(config.warnings).toHaveLength(0)
    expect(serialize(JSON.stringify(config, null, 2))).toMatchSnapshot()
  })

  test('datasource with env var', async () => {
    process.env.TEST_POSTGRES_URI_FOR_DATASOURCE = 'postgres://user:password@something:5432/db'

    const config = await getConfig({
      datamodel: `
      datasource db {
        provider = "postgresql"
      }
      `,
    })

    expect(serialize(JSON.stringify(config, null, 2))).toMatchSnapshot()
  })

  test('with engineType="library"', async () => {
    const libraryConfig = await getConfig({
      datamodel: `
      datasource db {
        provider = "sqlite"
      }

      generator gen {
        provider = "fancy-provider"
        engineType = "library"
      }

      model A {
        id Int @id
        name String
      }`,
    })

    expect(serialize(JSON.stringify(libraryConfig, null, 2))).toMatchInlineSnapshot(`
      ""{
        "generators": [
          {
            "name": "gen",
            "provider": {
              "fromEnvVar": null,
              "value": "fancy-provider"
            },
            "output": null,
            "config": {
              "engineType": "library"
            },
            "binaryTargets": [
              {
                "fromEnvVar": null,
                "value": "TEST_PLATFORM",
                "native": true
              }
            ],
            "previewFeatures": [],
            "sourceFilePath": "schema.prisma"
          }
        ],
        "datasources": [
          {
            "name": "db",
            "provider": "sqlite",
            "activeProvider": "sqlite",
            "schemas": [],
            "sourceFilePath": "schema.prisma"
          }
        ],
        "warnings": []
      }""
    `)
  })
})
