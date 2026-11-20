import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  const id = idForProvider(provider)
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    model User {
      id         ${id}
      email      String   @unique
      name       String?
      age        Int?
      posts      Post[]
      likes      Like[]
      property   Property? @relation(fields: [propertyId], references: [id])
      propertyId String?
      Banking    Banking?
    }

    model Property {
      id      ${id}
      house   House  @relation(fields: [houseId], references: [id])
      users   User[]
      houseId String
    }

    model House {
      id         ${id}
      like       Like       @relation(fields: [likeId], references: [id])
      properties Property[]
      likeId     String
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
      Like      Like[]
    }

    model Like {
      id     ${id}
      userId String
      user   User   @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
      postId String
      post   Post   @relation(fields: [postId], references: [id], onDelete: NoAction, onUpdate: NoAction)

      House House[]
      @@unique([userId, postId])
    }

    model Banking {
      id     ${id}
      userId String @unique
      user   User?  @relation(fields: [userId], references: [id])
      iban   String
      bic    String
    }
  `
})
