import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  const schemaHeader = /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  // We are testing that this is still valid:
  referentialIntegrity = "prisma"
}
  `

  const schema = /* Prisma */ `
${schemaHeader}

//
// 1:1 relation
//
model UserOneToOne {
  id      String @id @default(cuid())
  profile ProfileOneToOne?
  enabled Boolean?
}
model ProfileOneToOne {
  id       String @id @default(cuid())
  user     UserOneToOne @relation(fields: [userId], references: [id], onUpdate: Cascade, onDelete: Cascade)
  userId   String @unique
  enabled  Boolean?
}
  `

  return schema
})
