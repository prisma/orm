import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, previewFeatures }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
    previewFeatures = [${previewFeatures}]
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model User {
    id ${idForProvider(provider)}
    email String @unique
    name String
    createdAt DateTime @default(now())
    published Boolean @default(false)
    organizationId ${foreignKeyForProvider(provider)} @unique
    organization Organization @relation(fields: [organizationId], references: [id])
  }

  model Organization {
    id   ${idForProvider(provider)}
    user User?
  }

  model Pet {
    id ${idForProvider(provider)}
    name String
  }
  `
})
