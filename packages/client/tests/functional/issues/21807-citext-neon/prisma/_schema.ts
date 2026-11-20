import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider        = "prisma-client-js"
    previewFeatures = ["postgresqlExtensions"]
  }

  datasource db {
    provider   = "${provider}"
    extensions = [citext]
  }

  model Model {
    id   ${idForProvider(provider)}
    slug String @unique @default("") @db.Citext
  }
  `
})
