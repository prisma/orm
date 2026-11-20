import { Providers } from '../providers'

export type ComputeSchemaHeader = {
  provider: Providers
  relationMode: string
}

export function computeSchemaHeader({ provider, relationMode }: ComputeSchemaHeader): string {
  // if relationModeLine is not defined, we do not add the line, if
  // relationModeLine is defined we add the line only if the provider is not
  // MongoDB, since MongoDB doesn't need the setting, it's on by default
  const relationModeLine = provider === Providers.MONGODB || !relationMode ? '' : `relationMode = "${relationMode}"`

  const schemaHeader = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  ${relationModeLine}
}
  `

  return schemaHeader
}
