import { idForProvider } from '../../../_utils/idForProvider'
import { Providers } from '../../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  const foreignKey = provider === Providers.MONGODB ? 'String? @db.ObjectId' : 'String?'
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Dictionary {
    id     ${idForProvider(provider)}
    entries Entry[]
  }

  model Entry {
    id           ${idForProvider(provider)}
    term         String
    dictionaryID ${foreignKey}

    Dictionary Dictionary? @relation(fields: [dictionaryID], references: [id])
  }
  `
})
