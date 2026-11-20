import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider  = "prisma-client-js"
      previewFeatures = ["views"]
    }

    datasource db {
      provider = "${provider}"
    }

    model users {
      id              Int                 @id @default(autoincrement())
      posts           posts[]
      userPostSummary user_post_summary[]
    }

    model posts {
      id              Int                 @id @default(autoincrement())
      user_id         Int
      users           users               @relation(fields: [user_id], references: [id])
      userPostSummary user_post_summary[]

      @@index([user_id])
    }

    view user_post_summary {
      user_id      Int       @unique
      last_post_id Int?
      users        users?    @relation(fields: [user_id], references: [id])
      last_post    posts?    @relation(fields: [last_post_id], references: [id])
    }
  `
})
