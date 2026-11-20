import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model User {
    id ${idForProvider(provider)}
    email String @unique
    firstName String
    lastName String @map("last_name")
    posts Post[]
  }

  model Post {
    id ${idForProvider(provider)}
    user User @relation(fields: [userId], references: [id])
    userId ${foreignKeyForProvider(provider)}
  }
  `
})
