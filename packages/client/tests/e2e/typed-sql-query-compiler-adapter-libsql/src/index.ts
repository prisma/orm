import { PrismaLibSql } from '@prisma/adapter-libsql'

import { PrismaClient } from './generated/prisma/client'
import { conversionByVariant, filterTrackingEvents, getTrackingEvents } from './generated/prisma/sql'

async function main() {
  const adapter = new PrismaLibSql({
    url: 'file:./prisma/dev.db',
  })
  const prisma = new PrismaClient({ adapter })

  const stats = await prisma.$queryRawTyped(conversionByVariant())
  console.log(stats)

  const rows = await prisma.$queryRawTyped(
    filterTrackingEvents(
      JSON.stringify(['PageOpened', 'ButtonClicked']),
      JSON.stringify(['BlueBuyButton', 'RedBuyButton']),
    ),
  )
  console.log(rows)

  const result = await prisma.$queryRawTyped(getTrackingEvents(5))
  console.log(result)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
