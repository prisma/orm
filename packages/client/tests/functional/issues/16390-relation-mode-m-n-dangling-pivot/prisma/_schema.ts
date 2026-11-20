import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, relationMode }) => {
  // if relationMode is not defined, we do not add the line
  const relationModeLine = relationMode ? `relationMode = "${relationMode}"` : ''

  const schemaHeader = /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  ${relationModeLine}
}
  `
  return /* Prisma */ `
${schemaHeader}

model Item {
  id         Int        @id @default(autoincrement())
  categories Category[]
  createdAt  DateTime   @default(now())
  updatedAt  DateTime?  @updatedAt
}

model Category {
  id        Int       @id @default(autoincrement())
  items     Item[]
  createdAt DateTime  @default(now())
  updatedAt DateTime? @updatedAt
}
  `
})
