import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient as MySQLClient } from '../generated/mysql-client/client'
import { PrismaClient as PostgresClient } from '../generated/postgres-client/client'

// PostgreSQL client
const postgresClient = new PostgresClient({
  adapter: new PrismaPg({ connectionString: process.env.POSTGRES_URL! }, { schema: 'public' }),
})

// MySQL client
const mysqlUrl = new URL(process.env.MYSQL_URL!)
const mysqlClient = new MySQLClient({
  adapter: new PrismaMariaDb({
    host: mysqlUrl.hostname,
    user: mysqlUrl.username,
    password: mysqlUrl.password,
    database: mysqlUrl.pathname.slice(1),
    port: Number(mysqlUrl.port),
  }),
})

export { mysqlClient, postgresClient }
