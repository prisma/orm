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

    model Clip {
      id      Int      @id
      markers Marker[]
    }

    model Marker {
      id     Int   @id
      clipId Int
      beat   Float
      clip   Clip  @relation(fields: [clipId], references: [id])
    }
  `
})
