import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Post {
    id   Int           @id
    tags TagsOnPosts[]
    @@map("post")
  }

  model Tag {
    id    Int           @id
    posts TagsOnPosts[]
    @@map("tag")
  }

  model TagsOnPosts {
    postId Int
    tagId  Int
    post   Post @relation(fields: [postId], references: [id], onDelete: Cascade)
    tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
    @@id([postId, tagId])
  }
  `
})
