import { Datasource, PrismaConfig, SchemaEngineConfigInternal } from '@prisma/config'
import { green, red } from 'kleur/colors'

import { type RequireKey } from '../types'
import { setClassName } from './setClassName'

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
  }
}

setClassName(ConfigValidationError, 'ConfigValidationError')

/**
 * A Prisma Config that has been validated w.r.t. the command that is being executed.
 */
export type PrismaConfigWithDatasource = RequireKey<PrismaConfig, 'datasource'> & {
  datasource: RequireKey<Datasource, 'url'>
}

function isValidPrismaConfig(prismaConfig: SchemaEngineConfigInternal): prismaConfig is PrismaConfigWithDatasource {
  return prismaConfig.datasource !== undefined && typeof prismaConfig.datasource.url === 'string'
}

type ValidatePrismaConfigWithDatasourceInput = {
  config: Pick<PrismaConfig, 'datasource'>
  command: string
}

export function validatePrismaConfigWithDatasource({
  config,
  command,
}: ValidatePrismaConfigWithDatasourceInput): PrismaConfigWithDatasource {
  if (!isValidPrismaConfig(config)) {
    throw new ConfigValidationError(
      `The ${red(`datasource.url`)} property is required in your Prisma config file when using ${green(command)}.`,
    )
  }

  return config
}
