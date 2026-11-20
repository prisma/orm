import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
        previewFeatures = ["strictUndefinedChecks"]
      }

      datasource db {
        provider = "${provider}"
      }

      model User {
        id ${idForProvider(provider)}
        email String @unique
        name String @default("Test User")
        posts Post[]
      }

      model Post {
        id ${idForProvider(provider)}
        title String
        content String?
        authorId ${foreignKeyForProvider(provider)}
        author User @relation(fields: [authorId], references: [id])
      }
      `
})
