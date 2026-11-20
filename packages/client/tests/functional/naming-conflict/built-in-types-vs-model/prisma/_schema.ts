import { foreignKeyForProvider, idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, typeName }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model ${typeName} {
    id ${idForProvider(provider)}
    isUserProvidedType Boolean
    holder RelationHolder?
  }

  model RelationHolder {
    id ${idForProvider(provider)}
    modelId ${foreignKeyForProvider(provider)} @unique
    model ${typeName} @relation(fields: [modelId], references: [id])
  }
  `
})
