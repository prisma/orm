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
      appId     Int
      createdAt DateTime @db.Date
      value     Int

      @@id([appId, createdAt])
    }
  `
})
