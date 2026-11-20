import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const adapter = new PrismaPg({
  connectionString: process.env['TEST_E2E_POSTGRES_URI']!,
})

async function main() {
  const prisma = new PrismaClient({ adapter })

  const script = fs.readFileSync('./src/init.sql', 'utf-8')

  for (const stmt of script.split(';')) {
    if (!stmt.trim()) continue // Skip empty statements
    await prisma.$executeRawUnsafe(stmt.trim())
  }
}

void main()
