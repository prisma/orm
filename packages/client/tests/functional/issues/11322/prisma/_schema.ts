import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Component {
    id         BigInt              @id @default(autoincrement()) @db.BigInt
    title      String
    categories ComponentCategory[]
  }

  model ComponentCategory {
    id         BigInt      @id @default(autoincrement()) @db.BigInt
    name       String
    components Component[]
  }
  `
})
