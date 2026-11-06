import testMatrix from '../_matrix'

export default testMatrix.setupSchema(
  ({ provider, relationMode }) => /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
    relationMode = "${relationMode}"
  }

  model Counter {
    id        String   @id @map("counter_id")
    clicks    Int
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@map("counters")
  }

  model CompoundCounter {
    scope  String
    name   String
    clicks Int

    @@id([scope, name])
  }

  model RelatedCounter {
    id       String @id
    clicks   Int
    children Child[]
  }

  model Child {
    id        Int @id
    counterId String
    counter   RelatedCounter @relation(fields: [counterId], references: [id])
  }

  model MultipleKeys {
    id     Int    @id
    name   String @unique
    clicks Int
  }

  model PrefixKey {
    id     String @id(length: 5) @db.VarChar(20)
    clicks Int
  }
`,
)
