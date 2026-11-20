import { idForProvider } from '../../_utils/idForProvider'
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
      id       ${idForProvider(provider)}
      uint64 Bytes?   @db.Bit(64)
      bool1  Boolean? @db.Bit(1)
      bool2  Boolean? @db.Bit(1)
    }
  `
})
