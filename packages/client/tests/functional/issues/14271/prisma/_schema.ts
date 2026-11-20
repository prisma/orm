import { Providers } from '../../../_utils/providers'
import { computeReferentialActionLine } from '../../../_utils/relationMode/computeReferentialActionLine'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, relationMode, referentialActions }) => {
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

  const { referentialActionLine } = computeReferentialActionLine({ ...referentialActions })

  return /* Prisma */ `
${schemaHeader}

model Hub {
  id                    Int                    @id @default(autoincrement())
  name                  String @unique
  batteryLevels         BatteryLevel[]
}
model BatteryLevel {
  id        Int      @id @default(autoincrement())
  name      String   @unique
  hubId     Int?
  hub       Hub?     @relation(fields: [hubId], references: [id] ${referentialActionLine})
}
  `
})
