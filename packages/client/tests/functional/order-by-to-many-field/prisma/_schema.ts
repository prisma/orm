import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }

    datasource db {
      provider = "${provider}"
    }

    model Item {
      id           ${idForProvider(provider)}
      localization ItemI18n[]
    }

    model ItemI18n {
      id     ${idForProvider(provider)}
      name   String
      itemId ${foreignKeyForProvider(provider)}
      item   Item   @relation(fields: [itemId], references: [id])

      @@index([itemId])
    }
  `
})
