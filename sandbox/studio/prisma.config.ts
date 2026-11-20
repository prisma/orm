import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@prisma/config'
import 'dotenv/config'
 
const SQLITE_PATH = 'file:dev.db'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

if (process.env.PROVIDER === 'postgres') {
  const {default: postgres} = await import('postgres')

  const sql = await readFile(join(__dirname, 'postgres.sql'), 'utf-8')
  
  const pool = postgres(process.env.DATABASE_URL_POSTGRES!, { max: 1 })

  await pool.unsafe(sql).finally(() => pool.end())
}

if (process.env.PROVIDER === 'mysql') {
  const { createConnection } = await import('mysql2/promise')

  const sql = await readFile(join(__dirname, 'mysql.sql'), 'utf-8')

  const connection = await createConnection({
    multipleStatements: true,
    uri: process.env.DATABASE_URL_MYSQL!,
  })

  await connection.query(sql).finally(() => connection.end())
}

if (process.env.PROVIDER === 'sqlite') {
  let database: any

  const path = SQLITE_PATH.replace('file:', '')

  try {
    const { DatabaseSync } = await import('node:sqlite' as never)
  
    database = new DatabaseSync(path)
  } catch {
    try {
      const { Database } = await import('bun:sqlite' as never)
    
      database = new Database(path)

    } catch {
      const { default: Database } = await import('better-sqlite3')
      
      database = new Database(path)
    }
  }

  const sql = await readFile(join(__dirname, 'sqlite.sql'), 'utf-8')

  try {
    database.exec(sql)
  } finally {
    database.close()
  }
}

export default defineConfig({
  datasource: {
    url: {
      mysql: () => {
        const url = new URL(process.env.DATABASE_URL_MYSQL!)
        url.pathname = '/Northwind'
        return url.toString()
      },
      postgres: () => process.env.DATABASE_URL_POSTGRES!,
      sqlite: () => SQLITE_PATH,
    }[process.env.PROVIDER || 'postgres'](),
  },
})
