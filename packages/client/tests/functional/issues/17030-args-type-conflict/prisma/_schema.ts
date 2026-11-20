import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Character {
    id   ${idForProvider(provider)}
    info CharacterInfo[]
  }

  model CharacterInfo {
    entryId       ${idForProvider(provider)}
    entryLanguage String    
    characterId   String    
    details       Character @relation(fields: [characterId], references: [id])

    @@unique([entryLanguage, characterId])
  }
  `
})
