import { foreignKeyForProvider, idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }

  model User1 {
    email      ${idForProvider(provider)}
    relation1 Relation1[]
  }

  model Relation1 {
    id     ${idForProvider(provider)}
    user   User1 @relation(fields: [email], references: [email])
    email  ${foreignKeyForProvider(provider)}
  }

  model User2 {
    id        ${idForProvider(provider)}
    relation2 Relation2[]
  }

  model Relation2 {
    field  ${idForProvider(provider)}
    user   User2 @relation(fields: [email], references: [id])
    email  ${foreignKeyForProvider(provider)}
  }
  `
})
