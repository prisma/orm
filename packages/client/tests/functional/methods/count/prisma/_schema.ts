import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, foreignKeyId }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }
      
      datasource db {
        provider = "${provider}"
      }
      
      model User {
        id ${idForProvider(provider)}
        email String  @unique
        age   Int
        name  String?
        posts Post[]
      }

      model Post {
        id ${idForProvider(provider)}
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
        published Boolean
        title     String
        content   String?
        authorId  ${foreignKeyId}
        author    User?    @relation(fields: [authorId], references: [id])
      }
    `
})
