import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
}

model Account {
  id      Int @id
  balance Int
}

model Item {
  id   Int    @id @default(autoincrement())
  name String
}
  `
})
