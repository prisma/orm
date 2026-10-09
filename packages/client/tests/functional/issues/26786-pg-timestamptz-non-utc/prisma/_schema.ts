import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    model Event {
      id          Int      @id @default(autoincrement())
      happenedAt  DateTime @db.Timestamptz
    }
  `
})
