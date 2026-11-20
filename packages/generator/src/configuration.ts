import type * as DMMF from '@prisma/dmmf'

import { SqlQueryOutput } from './typedSql'

export interface GeneratorConfig {
  name: string
  output: EnvValue | null
  isCustomOutput?: boolean
  provider: EnvValue
  config: {
    /** `output` is a reserved name and will only be available directly at `generator.output` */
    output?: never
    /** `provider` is a reserved name and will only be available directly at `generator.provider` */
    provider?: never
    /** `binaryTargets` is a reserved name and will only be available directly at `generator.binaryTargets` */
    binaryTargets?: never
    /** `previewFeatures` is a reserved name and will only be available directly at `generator.previewFeatures` */
    previewFeatures?: never
  } & {
    [key: string]: string | string[] | undefined
  }
  binaryTargets: BinaryTargetsEnvValue[]
  // TODO why is this not optional?
  previewFeatures: string[]
  sourceFilePath: string
}

export interface EnvValue {
  fromEnvVar: null | string
  value: null | string
}

export interface BinaryTargetsEnvValue {
  fromEnvVar: string | null
  value: string
  native?: boolean
}

export type ConnectorType =
  | 'mysql'
  | 'mongodb'
  | 'sqlite'
  | 'postgresql'
  | 'postgres' // TODO: we could normalize postgres to postgresql this in engines to reduce the complexity?
  | 'prisma+postgres' // Note: used for Prisma Postgres, managed by PDP
  | 'sqlserver'
  | 'cockroachdb'

export type ActiveConnectorType = Exclude<ConnectorType, 'postgres' | 'prisma+postgres'>

export interface DataSource {
  name: string
  provider: ConnectorType
  // In Rust, this comes from `Connector::provider_name()`
  activeProvider: ActiveConnectorType
  schemas: string[] | []
  sourceFilePath: string
}

export type BinaryPaths = {
  schemaEngine?: { [binaryTarget: string]: string } // key: target, value: path
}

/** The options passed to the generator implementations */
export type GeneratorOptions = {
  generator: GeneratorConfig
  // TODO: what is otherGenerators for?
  otherGenerators: GeneratorConfig[]
  schemaPath: string
  dmmf: DMMF.Document
  datasources: DataSource[]
  // TODO deprecate datamodel & rename to schema?
  datamodel: string
  // TODO is it really always version hash? Feature is unclear.
  version: string // version hash
  binaryPaths?: BinaryPaths
  noHints?: boolean
  allowNoModels?: boolean
  typedSql?: SqlQueryOutput[]
}

export type EngineType = 'schemaEngine'

export type GeneratorManifest = {
  prettyName?: string
  defaultOutput?: string
  denylists?: {
    models?: string[]
    fields?: string[]
  }
  requiresGenerators?: string[]
  requiresEngines?: EngineType[]
  version?: string
  requiresEngineVersion?: string
}
