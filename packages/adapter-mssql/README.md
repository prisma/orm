# @prisma/adapter-mssql

This package contains the driver adapter for Prisma ORM that enables usage of the [`mssql`](https://www.npmjs.com/package/mssql) database driver for Microsoft SQL Server.

The `mssql` driver is one of the most popular drivers in the JavaScript ecosystem for Microsoft SQL Server databases. It can be used with any SQL Server database that's accessed via TCP, including Azure SQL Database.

## Usage

This section explains how you can use it with Prisma ORM and the `@prisma/adapter-mssql` driver adapter. Be sure that the `DATABASE_URL` environment variable is set to your SQL Server connection string (e.g. loaded using `dotenv` from a `.env` file).

### 1. Install the dependencies

Install the Prisma ORM's driver adapter:

```
npm install @prisma/adapter-mssql
```

### 2. Instantiate Prisma Client using the driver adapter

Finally, when you instantiate Prisma Client, you need to pass an instance of Prisma ORM's driver adapter to the `PrismaClient` constructor:

```ts
import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient } from '@prisma/client'

const config = {
  server: 'localhost',
  port: 1433,
  database: 'mydb',
  user: 'sa',
  password: 'mypassword',
  options: {
    encrypt: true, // Use this if you're on Windows Azure
    trustServerCertificate: true, // Use this if you're using self-signed certificates
  },
}

const adapter = new PrismaMssql(config)
const prisma = new PrismaClient({ adapter })
```

You can also instantiate the adapter with a [JDBC](https://learn.microsoft.com/en-us/sql/connect/jdbc/building-the-connection-url?view=sql-server-ver15) connection string:

```ts
import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaMssql('sqlserver://localhost:1433;database=testdb;user=sa;password=mypassword;encrypt=true')
const prisma = new PrismaClient({ adapter })
```

### 3. Entra ID Authentication (formerly Azure Active Directory)

Entra ID authentication is supported by the mssql driver used by this adapter.

For options using the config object, see the options documentation for the [Tedious driver](https://github.com/tediousjs/node-mssql?tab=readme-ov-file#tedious).

For example, using the config object to configure [DefaultAzureCredential](https://learn.microsoft.com/en-gb/azure/developer/javascript/sdk/authentication/credential-chains#use-defaultazurecredential-for-flexibility):

```ts
import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient } from '@prisma/client'

const config = {
  server: 'localhost',
  port: 1433,
  database: 'mydb',
  authentication: {
    type: 'azure-active-directory-default',
  },
  options: {
    encrypt: true,
  },
}

const adapter = new PrismaMssql(config)
const prisma = new PrismaClient({ adapter })
```

Connection string parsing also supports authentication options, as per below:

- to use [DefaultAzureCredential](https://learn.microsoft.com/en-gb/azure/developer/javascript/sdk/authentication/credential-chains#use-defaultazurecredential-for-flexibility), set:
  - `authentication=DefaultAzureCredential` in your connection string
- to use an Entra username/password, set:
  - `authentication=ActiveDirectoryPassword`
  - `userName=<value>`
  - `password=<value>`
  - `clientId=<value>`
- to use an Entra managed identity, set:
  - `authentication=ActiveDirectoryManagedIdentity`
  - `clientId=<value>` (optional)
- to use a Service Principal with clientId and secret, set:
  - `authentication=ActiveDirectoryServicePrincipal`
  - `userName=<client id>`
  - `password=<client secret>`
