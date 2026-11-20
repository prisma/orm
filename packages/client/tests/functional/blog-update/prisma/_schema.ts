import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }
    
    datasource db {
      provider = "${provider}"
    }

    model User {
      id ${idForProvider(provider)}
      email       String    @unique
      name        String?
      posts       Post[]
      profile     Profile?
      wakesUpAt   DateTime? @default(now())
      lastLoginAt DateTime? @default(now())
    }

    model Profile {
      id ${idForProvider(provider)}
      bio            String?
      notrequired    String?
      user           User      @relation(fields: [userId], references: [id])
      userId         String    @unique
      goesToBedAt    DateTime? @default(now())
      goesToOfficeAt DateTime? @default(now())
    }

    model Post {
      id ${idForProvider(provider)}
      createdAt       DateTime  @default(now())
      updatedAt       DateTime  @updatedAt
      published       Boolean
      title           String
      content         String?
      optional        String?
      authorId        String?   @map("author")
      author          User?     @relation(fields: [authorId], references: [id])
      lastReviewedAt  DateTime? @default(now())
      lastPublishedAt DateTime? @default(now())
    }
  `
})
