import { Providers } from '../../../_utils/providers'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, relationMode }) => {
  // if relationMode is not defined, we do not add the line
  // if relationMode is defined
  // we add the line only if the provider is not MongoDB, since MongoDB doesn't need the setting, it's on by default
  const relationModeLine = provider === Providers.MONGODB || !relationMode ? '' : `relationMode = "${relationMode}"`

  const schemaHeader = /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  ${relationModeLine}
}
  `

  const schema = /* Prisma */ `
${schemaHeader}

model User {
  id         String              @id @default(cuid())
  email      String              @unique
  workspaces UsersOnWorkspaces[]
  name       String?
}

model Workspace {
  id        String              @id @default(cuid())
  users     UsersOnWorkspaces[]
  name      String
}

model UsersOnWorkspaces {
  user        User           @relation(fields: [userId], references: [id])
  userId      String
  workspace   Workspace      @relation(fields: [workspaceId], references: [id])
  workspaceId String

  @@id([userId, workspaceId])
}
  `

  return schema
})
