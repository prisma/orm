import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
  }

  model User {
    id ${idForProvider(provider)}
    email String @unique
    posts Post[]
    comments Comment[]
  }


  model Post {
    id ${idForProvider(provider)}
    userId String
    user User @relation(fields: [userId], references: [id])
  }

  model Comment {
    id ${idForProvider(provider)}
    userId String
    user User @relation(fields: [userId], references: [id])
  }
  `
})
