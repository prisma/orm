import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "${provider}"
      }

      model TestData {
        id          String    @id @default(uuid())
        date        DateTime  @db.Date
        timestamp   DateTime  @db.Timestamp
        timestamptz DateTime  @db.Timestamptz
      }
      `
})
