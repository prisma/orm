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
    id        String     @id
    chatUsers ChatUser[]
  }

  model ChatUser {
    chatId String
    userId String

    chat Chat @relation(fields: [chatId], references: [id])
    user User @relation(fields: [userId], references: [id])

    @@id([chatId, userId])
  }

  model Chat {
    id        String     @id
    chatUsers ChatUser[]
  }
  `
})
