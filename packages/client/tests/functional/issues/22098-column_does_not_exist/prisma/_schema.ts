import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }

    datasource db {
      provider   = "${provider}"
    }

    model test {
      id             ${idForProvider(provider)}
      TESTE_N_MERICO String @unique @map("TESTE_NÚMERICO")
    }
      `
})
