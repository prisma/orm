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

  model User {
    id    ${idForProvider(provider)}
    posts Post[]
  }

  model Post {
    id        ${idForProvider(provider)}
    author    User?   @relation(fields: [authorId], references: [id])
    authorId  ${foreignKeyForProvider(provider, { optional: true })}
  }
  `
})
