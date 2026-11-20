import { Providers } from '../../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, relationMode }) => {
  // if relationMode is not defined, we do not add the line
  // if relationMode is defined
  // we add the line only if the provider is not MongoDB, since MongoDB doesn't need the setting, it's on by default
  const relationModeLine = provider === Providers.MONGODB || !relationMode ? '' : `relationMode = "${relationMode}"`

  const schemaHeader = /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  ${relationModeLine}
}
  `

  const schema = /* Prisma */ `
${schemaHeader}

model Category {
  id     String  @id @default(cuid())
  name   String  @unique
  brands Brand[]
}

model Brand {
  id         String     @id @default(cuid())
  name       String     @unique
  categories Category[] 
}
  `

  // console.log('schema', schema)

  return schema
})
