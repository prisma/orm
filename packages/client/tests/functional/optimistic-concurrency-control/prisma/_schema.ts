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

    model Resource {
      id       ${idForProvider(provider)}
      occStamp Int @default(0) @unique
      child    Child?
    }

    model Child {
      id       ${idForProvider(provider)}
      parent   Resource @relation(fields: [parentId], references: [id], onDelete: Cascade)
      parentId String @unique
    }
  `
})
