import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }
      
      datasource db {
        provider = "${provider}"
      }
      
      model Visit {
        id        Int      @id @default(autoincrement())
        visitTime DateTime @default(now())
      }
      `
})
