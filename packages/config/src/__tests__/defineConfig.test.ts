import { describe, expect, test } from 'vitest'

import { defaultConfig } from '../defaultConfig'
import { defaultTestConfig } from '../defaultTestConfig'
import { defineConfig } from '../defineConfig'
import type { PrismaConfig, PrismaConfigInternal } from '../PrismaConfig'

describe('defineConfig', () => {
  const baselineConfig = {} satisfies PrismaConfig

  test('defaultConfig', () => {
    const config = defaultConfig() satisfies PrismaConfigInternal
    expect(config).toMatchInlineSnapshot(`
      {
        "loadedFromFile": null,
      }
    `)
    expect(typeof config.__brand).toEqual('symbol')
  })

  test('defaultTestConfig', () => {
    const config = defaultTestConfig() satisfies PrismaConfigInternal
    expect(config).toMatchInlineSnapshot(`
      {
        "loadedFromFile": null,
      }
    `)
    expect(typeof config.__brand).toEqual('symbol')
  })

  describe('experimental', () => {
    test('if `experimental` is not provided, it should be undefined', () => {
      const config = defineConfig(baselineConfig)
      expect(config.experimental).toBeUndefined()
      expect(typeof config.__brand).toEqual('symbol')
    })

    test('if `experimental` features are provided, they should be configured', () => {
      const config = defineConfig({
        experimental: {
          externalTables: true,
        },
      })
      expect(config.experimental).toEqual({
        externalTables: true,
      })
      expect(typeof config.__brand).toEqual('symbol')
    })
  })

  describe('datasource', () => {
    test('when `datasource` configuration is provided, it should set the datasource URLs', () => {
      const config = defineConfig({
        datasource: {
          url: 'postgresql://DATABASE_URL',
          shadowDatabaseUrl: 'postgresql://SHADOW_DATABASE_URL',
        },
      })
      expect(config.datasource).toMatchObject({
        url: 'postgresql://DATABASE_URL',
        shadowDatabaseUrl: 'postgresql://SHADOW_DATABASE_URL',
      })
    })
  })

  describe('migrations', () => {
    test('if `seed` is provided, it should be included in the migrations config', () => {
      const config = defineConfig({
        migrations: {
          seed: 'tsx seed.ts',
        },
      })
      expect(config.migrations?.seed).toStrictEqual('tsx seed.ts')
    })
  })

  describe('experimental validation', () => {
    test('should throw error when tables.external is used without experimental.externalTables', () => {
      expect(() =>
        defineConfig({
          tables: {
            external: ['users'],
          },
        }),
      ).toThrow('The `tables.external` configuration requires `experimental.externalTables` to be set to `true`.')
    })

    test('should throw error when migrations.initShadowDb is used without experimental.externalTables', () => {
      expect(() =>
        defineConfig({
          migrations: {
            initShadowDb: 'CREATE TABLE users();',
          },
        }),
      ).toThrow(
        'The `migrations.initShadowDb` configuration requires `experimental.externalTables` to be set to `true`.',
      )
    })

    test.each([{ whatever: true }, false])(
      'should throw an error when extensions are used without the experimental flag (%o)',
      (extensions) => {
        const newLocal = {
          experimental: {},
          extensions,
        }
        expect(() => defineConfig(newLocal)).toThrow(
          'The `extensions` configuration requires `experimental.extensions` to be set to `true`.',
        )
      },
    )
  })
})
