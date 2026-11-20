import { mysqlClient, postgresClient } from './database'

async function main() {
  // First query to PostgreSQL - works fine
  const postgresData = await postgresClient.user.findFirst()
  console.log('PostgreSQL query succeeded:', postgresData)

  // Second query to MySQL - fails with error
  const mysqlData = await mysqlClient.user.findFirst()
  console.log('MySQL query succeeded:', mysqlData)

  process.exit(0)
}

void main()
