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

    model TestModel {
      id    Int    @id @map("_id")
      field String
    }
  `
})
