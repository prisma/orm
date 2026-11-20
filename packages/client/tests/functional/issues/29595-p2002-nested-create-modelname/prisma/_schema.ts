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
    model AppMajorVersion {
      id       ${idForProvider(provider)}
      appId    String
      number   Int
      versions AppVersion[]

      @@unique([appId, number])
      @@map("app_major_versions")
    }
    model AppVersion {
      id             ${idForProvider(provider)}
      majorVersionId String
      number         Int
      majorVersion   AppMajorVersion @relation(fields: [majorVersionId], references: [id])

      @@unique([majorVersionId, number])
    }
  `
})
