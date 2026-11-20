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

model User {
  id    ${idForProvider(provider)}
  email String  @unique
  bio   Bio?
}

model Bio {
  id     ${idForProvider(provider)}
  text   String?
  user   User?   @relation(fields: [userId], references: [id])
  userId String? @unique
}
`
})
