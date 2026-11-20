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

    model Child {
      id ${idForProvider(provider)}
      parent Resource? @relation(fields: [parentId], references: [id])
      parentId String?
    }
    
    model Resource {
      id ${idForProvider(provider)}
      children Child[]
    }
  `
})
