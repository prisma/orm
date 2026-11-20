import { idForProvider } from '../../../_utils/idForProvider'

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
    id ${id}
    email String @unique
    posts Post[]
  }

  model Post {
    id ${id}
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId String
  }
  `
}
