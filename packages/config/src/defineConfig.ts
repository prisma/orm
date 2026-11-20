import { Debug } from '@prisma/debug'
import { Either } from 'effect'
import type { DeepMutable } from 'effect/Types'

import { defaultConfig } from './defaultConfig'
import type { PrismaConfig, PrismaConfigInternal } from './PrismaConfig'

/**
 * Validates that experimental features are enabled when using corresponding configuration options.
 */
function validateExperimentalFeatures(config: PrismaConfig): Either.Either<PrismaConfig, Error> {
  const experimental = config.experimental || {}

  // Check external tables configuration
  if (config.tables?.external && !experimental.externalTables) {
    return Either.left(
      new Error('The `tables.external` configuration requires `experimental.externalTables` to be set to `true`.'),
    )
  }

  // Check migrations initShadowDb configuration
  if (config.migrations?.initShadowDb && !experimental.externalTables) {
    return Either.left(
      new Error(
        'The `migrations.initShadowDb` configuration requires `experimental.externalTables` to be set to `true`.',
      ),
    )
  }

  if (config['extensions'] !== undefined && !experimental.extensions) {
    return Either.left(
      new Error('The `extensions` configuration requires `experimental.extensions` to be set to `true`.'),
    )
  }

  return Either.right(config)
}

export type { PrismaConfigInternal }

const debug = Debug('prisma:config:defineConfig')

/**
 * Define the configuration for the Prisma Development Kit.
 */
export function defineConfig(configInput: PrismaConfig): PrismaConfigInternal {
  // First validate the experimental feature gates
  const validationResult = validateExperimentalFeatures(configInput)
  if (validationResult._tag === 'Left') {
    throw validationResult.left
  }

  /**
   * We temporarily treat config as mutable, to simplify the implementation of this function.
   */
  const config = defaultConfig()
  debug('[default]: %o', config)

  defineExperimentalConfig(config, configInput)
  defineSchemaConfig(config, configInput)
  defineDatasource(config, configInput)
  defineMigrationsConfig(config, configInput)
  defineTablesConfig(config, configInput)
  defineEnumsConfig(config, configInput)
  defineTypedSqlConfig(config, configInput)
  defineViewsConfig(config, configInput)
  defineExtensionsConfig(config, configInput)

  /**
   * We cast the type of `config` back to its original, deeply-nested
   * `Readonly` type
   */
  return config as PrismaConfigInternal
}

/**
 * `configInput.experimental` is forwarded to `config.experimental` as is.
 */
function defineExperimentalConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.experimental) {
    return
  }

  config.experimental = configInput.experimental
  debug('[config.experimental]: %o', config.experimental)
}

/**
 * `configInput.schema` is forwarded to `config.schema` as is.
 */
function defineSchemaConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.schema) {
    return
  }

  config.schema = configInput.schema
  debug('[config.schema]: %o', config.schema)
}

/**
 * `configInput.migrations` is forwarded to `config.migrations` as is.
 */
function defineMigrationsConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.migrations) {
    return
  }

  config.migrations = configInput.migrations
  debug('[config.migrations]: %o', config.migrations)
}

/**
 * `configInput.typedSql` is forwarded to `config.typedSql` as is.
 */
function defineTypedSqlConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.typedSql) {
    return
  }

  config.typedSql = configInput.typedSql
  debug('[config.typedSql]: %o', config.typedSql)
}

/**
 * `configInput.views` is forwarded to `config.views` as is.
 */
function defineViewsConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.views) {
    return
  }

  config.views = configInput.views
  debug('[config.views]: %o', config.views)
}

/**
 * `configInput.tables` is forwarded to `config.tables` as is.
 */
function defineTablesConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.tables) {
    return
  }

  config.tables = configInput.tables
  debug('[config.tables]: %o', config.tables)
}

/**
 * `configInput.enums` is forwarded to `config.enums` as is.
 */
function defineEnumsConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput.enums) {
    return
  }

  config.enums = configInput.enums
  debug('[config.enums]: %o', config.enums)
}

function defineDatasource(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  const { datasource } = configInput
  Object.assign(config, { datasource })
  debug('[config.datasource]: %o', datasource)
}

function defineExtensionsConfig(config: DeepMutable<PrismaConfigInternal>, configInput: PrismaConfig) {
  if (!configInput['extensions']) {
    return
  }

  config['extensions'] = configInput['extensions']
  debug('[config.extensions]: %o', config['extensions'])
}
