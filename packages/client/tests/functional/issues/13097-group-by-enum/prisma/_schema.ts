import { idForProvider } from '../../../_utils/idForProvider'
import { Providers } from '../../../_utils/providers'
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

    enum Enum {
      A
    }

    model Resource {
      id        ${idForProvider(provider)}
      enumValue Enum?
      ${provider !== Providers.MYSQL ? `enumArray Enum[]` : ''}
    }
  `
})
