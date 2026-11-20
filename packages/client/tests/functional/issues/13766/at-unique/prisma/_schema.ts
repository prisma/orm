import { idForProvider } from '../../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }
    
    datasource db {
      provider = "${provider}"
      relationMode = "prisma"
    }

    model Order {
      id               ${idForProvider(provider)}
      orderId          String @unique
      paid             Boolean?
      statusMilestones OrderStatusHistory[]
    }

    model OrderStatusHistory {
      id                   ${idForProvider(provider)}
      orderStatusHistoryId String
      orderId              String
      status               String
      createdAt            DateTime    @default(now())
      order                Order       @relation(fields: [orderId], references: [orderId], onUpdate: Restrict, onDelete: Cascade)
    }
  `
})
