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
      id          Int       @id
      json        Json
      string_list String[]
      bInt_list   BigInt[]
      date        DateTime  @db.Date
      time        DateTime  @db.Time(3)
    }
  `
})
