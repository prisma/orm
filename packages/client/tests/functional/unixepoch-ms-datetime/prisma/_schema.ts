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
    name String
    uuid String @default(uuid())
    createdAt DateTime @default(now())

    @@id([uuid, createdAt])
  }
  `
})
