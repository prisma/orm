import { idForProvider } from '../../../_utils/idForProvider'
import { Providers } from '../../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  const compatibleTypes =
    provider !== Providers.SQLITE
      ? `
          date DateTime @db.Date 
          time DateTime @db.Time
        `
      : ''

  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }
    
    datasource db {
      provider = "${provider}"
    }
    
    model User {
      id ${idForProvider(provider)}
      dateTime DateTime
      uuid String @default(uuid())
      ${compatibleTypes}
    }
  `
})
