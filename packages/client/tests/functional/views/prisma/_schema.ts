import { idForProvider } from '../../_utils/idForProvider'
import { Providers } from '../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
      previewFeatures = ["views"]
    }

    datasource db {
      provider = "${provider}"
    }

    model User {
      id ${idForProvider(provider)}
      email   String   @unique
      name    String?
      profile Profile?
    }

    model Profile {
      id ${idForProvider(provider)}
      bio       String
      user      User      @relation(fields: [userId], references: [id])
      userId    ${provider === Providers.MONGODB ? 'String @db.ObjectId' : 'String'} @unique
    }

    view UserInfo {
      id    String
      email String
      name  String
      bio   String
    }
  `
})
