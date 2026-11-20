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

  model Organization {
    id    ${idForProvider(provider, { includeDefault: true })}
    types OrganizationType[]
  }

  model OrganizationType {
    organizationId String
    type           Int
    organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
    @@id([organizationId, type])
  }
  `
})
