import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
  }

  model User {
    id       ${idForProvider(provider)}
    login    String @unique
    posts    Post[]
    comments Comment[]
  }

  model Post {
    id       ${idForProvider(provider)}
    author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId ${foreignKeyForProvider(provider)}
    title    String
    content  String
    comments Comment[]
  }

  model Comment {
    id       ${idForProvider(provider)}
    body     String
    post     Post @relation(fields: [postId], references: [id], onDelete: Cascade)
    postId   ${foreignKeyForProvider(provider)}
    author   User @relation(fields: [authorId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    authorId ${foreignKeyForProvider(provider)}
  }
  `
})
