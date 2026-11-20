import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider  = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    model Contact {
      id ${idForProvider(provider, { includeDefault: true })}
      analytics ContactAnalytics[]
    }

    model ContactAnalytics {
      id ${idForProvider(provider, { includeDefault: true })}
      contactId String
      contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
      date1 DateTime?
      date2 DateTime?
      date3 DateTime?
      date4 DateTime?
      date5 DateTime?
      date6 DateTime?
      date7 DateTime?
      val1 Int?
      val2 Int?
      val3 Int?
      val4 Int?
      val5 Int?
      float1 Float?
      float2 Float?
      bool1 Boolean?
      bool2 Boolean?
      bool3 Boolean?
    }
  `
})
