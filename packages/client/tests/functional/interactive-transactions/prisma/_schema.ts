import { idForProvider } from '../../_utils/idForProvider'

export default ({ provider }) => {
  const id = idForProvider(provider)
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
  }

  model User {
    id    ${id}
    email String  @unique
    name  String?
    posts Post[]
    val   Int?
  }

  model Post {
    id        ${id}
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    published Boolean
    title     String
    content   String?
    authorId  String?
    author    User?    @relation(fields: [authorId], references: [id])
  }
  `
}
