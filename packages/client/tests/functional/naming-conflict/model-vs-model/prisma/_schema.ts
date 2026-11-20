import { foreignKeyForProvider, idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, conflictingModel }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Model {
    id ${idForProvider(provider)}
    otherId ${foreignKeyForProvider(provider)} @unique
    other ${conflictingModel} @relation(fields: [otherId], references: [id])
  }

  model ${conflictingModel} {
    id ${idForProvider(provider)}
    name String
    model Model?
  }
  `
})
