/**
 * What the generator builds the next set from: each project's config and the contract source at each migration. A set saves the config and the final source, so changing these changes only the sets written after.
 */

export const postgresConfig = `import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [pgvector],
    contract: {
      ...prismaContract('./contract.prisma', {
        output: 'contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: '@internal/postgres/contract-types',
    },
    db: { connection: '{{DB_URL}}' },
    migrations: { dir: 'migrations', module: '@internal/postgres/migration' },
  }),
});
`;

export const mongoConfig = `import { defineConfig as mongo } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: mongo({
    contract: './contract.prisma',
    output: 'output',
    db: { connection: '{{DB_URL}}' },
  }),
});
`;

const postgresPreamble = `// use prisma-8

types {
  Embedding3 = pgvector.Vector(3)
}

enum Role {
  @@type("pg/text@1")
  USER
  ADMIN
}
`;

const postgresDocument = `
model Document {
  id        Int         @id @default(autoincrement())
  title     String
  embedding Embedding3?

  @@map("document")
}
`;

const postgresPost = `
model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@map("post")
}
`;

function postgresUser(fields: string): string {
  return `
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  role  Role
${fields}
  @@map("user")
}
`;
}

export const postgresSources = {
  initial: postgresPreamble + postgresUser('') + postgresDocument,
  posts: postgresPreamble + postgresUser('  posts Post[]\n') + postgresPost + postgresDocument,
  displayName:
    postgresPreamble +
    postgresUser('  displayName String\n  posts Post[]\n') +
    postgresPost +
    postgresDocument,
};

const mongoPreamble = `// use prisma-8

enum Role {
  USER
  ADMIN
}
`;

const mongoPost = `
model Post {
  id       ObjectId @id @map("_id")
  title    String
  authorId ObjectId
  author   User     @relation(fields: [authorId], references: [id])

  @@index([authorId])
  @@map("posts")
}
`;

function mongoUser(fields: string): string {
  return `
model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  role  Role
${fields}
  @@map("users")
}
`;
}

export const mongoSources = {
  initial: mongoPreamble + mongoUser(''),
  posts: mongoPreamble + mongoUser('  posts Post[]\n') + mongoPost,
  name: mongoPreamble + mongoUser('  name  String\n  posts Post[]\n') + mongoPost,
};
