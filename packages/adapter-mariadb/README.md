# @prisma/adapter-mariadb

This package contains the driver adapter for Prisma ORM that enables usage of the [`mariadb`](https://github.com/mariadb-corporation/mariadb-connector-nodejs) database driver for MariaDB and MySQL databases.

`mariadb` is the official MariaDB connector for Node.js, providing high-performance access to MariaDB and MySQL databases. It can be used with any MariaDB or MySQL database that's accessed via TCP, including cloud-hosted instances.

## Usage

This section explains how you can use it with Prisma ORM and the `@prisma/adapter-mariadb` driver adapter. Be sure that the `DATABASE_URL` environment variable is set to your MariaDB/MySQL connection string (e.g. loaded using `dotenv` from a `.env` file).

### 1. Install the dependencies

Install the MariaDB Prisma ORM driver adapter:

```
npm install @prisma/adapter-mariadb
```

### 2. Instantiate Prisma Client using the driver adapter

```ts
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaMariaDb({
  host: 'localhost', // your database host
  user: 'your_username', // your database username
  password: 'your_password', // your database password
  database: 'your_database', // optional, your database name
})
const prisma = new PrismaClient({ adapter })
```

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.

If you have any feedback, leave a comment in [this GitHub discussion](https://github.com/prisma/prisma/discussions/22899).
