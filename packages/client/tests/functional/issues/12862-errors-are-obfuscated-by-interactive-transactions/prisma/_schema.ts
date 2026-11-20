import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
      previewFeatures = ["interactiveTransactions"]
    }
    
    datasource db {
      provider = "${provider}"
    }
    
    model User {
      id    ${idForProvider(provider)}
      email String  @unique
      name  String?
      posts Post[]
    }

    model Post {
      id        ${idForProvider(provider)}
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
      title     String
      content   String?
      published Boolean  @default(false)
      viewCount Int      @default(0)
      author    User?    @relation(fields: [authorId], references: [id])
      authorId  String?
    }
  `
})
