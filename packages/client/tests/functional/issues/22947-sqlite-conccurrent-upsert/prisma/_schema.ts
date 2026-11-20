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
      id       String  @id() @default(cuid()) @map("_id")
      name     String
      username String  @unique()
      email    String  @unique()
      avatar   String
      password String
      bio      String  @default("")
      banned   Boolean @default(false)
      verified Boolean @default(false)

      videos   Video[]
      sessions Session[]

      createdAt DateTime @default(now()) @map("created_at")
      updatedAt DateTime @default(now()) @updatedAt() @map("updated_at")

      @@map("users")
    }

    model Session {
      id        String @id() @default(cuid()) @map("_id")
      token     String @unique()
      ip        String
      userAgent String @map("user_agent")
      device    String

      userId String @map("user_id")
      user   User   @relation(fields: [userId], references: [id])

      @@map("sessions")
    }

    model Video {
      id          String @id() @default(cuid()) @map("_id")
      title       String
      description String
      url         String @unique()

      userId String     @map("user_id")
      user   User       @relation(fields: [userId], references: [id])
      tags   VideoTag[]

      @@map("videos")
    }

    model Tag {
      id   String @id() @default(cuid()) @map("_id")
      name String @unique()

      videos VideoTag[]

      @@map("tags")
    }

    model VideoTag {
      id      String @id() @default(cuid()) @map("_id")
      videoId String @map("video_id")
      tagId   String @map("tag_id")

      video Video @relation(fields: [videoId], references: [id])
      tag   Tag   @relation(fields: [tagId], references: [id])

      @@unique([videoId, tagId])
      @@map("video_tags")
    }
  `
})
