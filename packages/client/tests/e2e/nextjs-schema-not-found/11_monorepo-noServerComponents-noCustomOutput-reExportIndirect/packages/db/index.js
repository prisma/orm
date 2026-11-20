const { PrismaPg } = require('@prisma/adapter-pg')
const { PrismaClient } = require('@prisma/client')

const adapter = new PrismaPg({
  connectionString: process.env['TEST_E2E_POSTGRES_URI'],
})
const db = new PrismaClient({ adapter })

module.exports = { db }
