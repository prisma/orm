import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
    previewFeatures = ["relationJoins"]
  }

  datasource db {
    provider = "${provider}"
  }

  model User {
    id    BigInt  @id
    name  String
    posts Post[]
  }

  model Post {
    id       BigInt  @id
    title    String
    authorId BigInt
    author   User    @relation(fields: [authorId], references: [id])
  }
  `
})
