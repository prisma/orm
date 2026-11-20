import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    enum SuggestionStatus {
      PENDING  @map("pending")
      ACCEPTED @map("accepted")
      REJECTED @map("rejected")

      @@map("SuggestionStatus")
    }

    model SuggestionModel {
      id                 Int              @id @default(autoincrement())
      suggestedContent   String           @map("suggested_content")
      status             SuggestionStatus @default(PENDING)

      @@index([status])
      @@map("snippet_suggestions")
    }
  `
})
