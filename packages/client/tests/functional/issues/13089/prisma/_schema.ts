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
    
    model users {
      id        String @id @map("_id") @default(auto()) @db.ObjectId
      firstName String @unique
    }
  `
})
