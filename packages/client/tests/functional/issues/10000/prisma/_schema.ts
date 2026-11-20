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

model Event {
  id          String    @id
  name        String
  sessions    Session[]

  @@map("events")
}

model Session {
  id          String
  name        String
  event       Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  eventId     String   @map("event_id")

  @@id([id, eventId])
  @@map("sessions")
}
  `

  // console.log('schema', schema)

  return schema
})
