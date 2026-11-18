import type { AuthoringMode } from '@internal/cli/init-contribution';
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version';
import { moduleBase } from '../config/module-base';

export const configModule = `${moduleBase}/config`;
const builder = `${moduleBase}/contract-builder`;

export function starterContract(mode: AuthoringMode): string {
  return mode === 'typescript' ? starterContractTs() : starterContractPsl();
}

export function contractSample(mode: AuthoringMode): string {
  return mode === 'typescript' ? contractSampleTs() : contractSamplePsl();
}

function contractSamplePsl(): string {
  return `\`\`\`prisma
model User {
  id       Int     @id @default(autoincrement())
  email    String  @unique
  username String?
  name     String?
}
\`\`\``;
}

function contractSampleTs(): string {
  return `\`\`\`typescript
import { defineContract } from '${builder}';

export const contract = defineContract(
  {},
  ({ field, model, gen, type }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.column(type.Uuid()).id().onCreate(gen.uuid(7)),
          email: field.column(type.String()).unique(),
          username: field.column(type.String()).optional(),
          name: field.column(type.String()).optional(),
        },
      }),
    },
  }),
);
\`\`\``;
}

function starterContractPsl(): string {
  return `// use prisma-8

model User {
  id        Int                @id @default(autoincrement())
  email     String             @unique
  username  String?
  name      String?
  posts     Post[]
  createdAt DateTime           @default(now()) @onCreate(now())
  updatedAt temporal.UpdatedAt
}

model Post {
  id        Int                @id @default(autoincrement())
  title     String
  content   String?
  author    User               @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime           @default(now()) @onCreate(now())
  updatedAt temporal.UpdatedAt
}
`;
}

function starterContractTs(): string {
  return `import { defineContract, now } from '${builder}';

export const contract = defineContract({}, ({ field, model, rel, gen, type }) => {
  const User = model('User', {
    fields: {
      id: field.column(type.Uuid()).id().onCreate(gen.uuid(7)),
      email: field.column(type.String()).unique(),
      username: field.column(type.String()).optional(),
      name: field.column(type.String()).optional(),
      createdAt: field.column(type.DateTime()).default(now()).onCreate(gen.now()),
      updatedAt: field.column(type.temporal.UpdatedAt()),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.column(type.Uuid()).id().onCreate(gen.uuid(7)),
      title: field.column(type.String()),
      content: field.column(type.String()).optional(),
      authorId: field.column(type.Uuid()),
      createdAt: field.column(type.DateTime()).default(now()).onCreate(gen.now()),
      updatedAt: field.column(type.temporal.UpdatedAt()),
    },
  });

  return {
    models: {
      User: User.relations({
        posts: rel.hasMany(Post, { by: 'authorId' }),
      }),
      Post: Post.relations({
        author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
      }),
    },
  };
});
`;
}

/**
 * The config for a project whose contract source is its Prisma 7 schema:
 * `prisma7Schema` beside `defineConfig`, from the same entrypoint, with the
 * schema path as the user gave it and the emitted artifacts under Prisma 8's
 * own directory (`output` is the directory; the facade names `contract.json`).
 */
export function prisma7ConfigFile(input: {
  readonly schemaPath: string;
  readonly outputDir: string;
}): string {
  return `import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, prisma7Schema } from '${configModule}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema(${JSON.stringify(input.schemaPath)}),
    output: ${JSON.stringify(input.outputDir)},
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}

export function databaseFile(): string {
  return `import 'dotenv/config';
import postgres from '${moduleBase}/runtime';
import { contractFromJson } from '${moduleBase}/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL']!,
});
`;
}

export function envExample(): string {
  return [
    '# Connection string for PostgreSQL.',
    `# Requires PostgreSQL >= ${POSTGRES_MIN_SERVER_VERSION}.`,
    '',
    'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"',
    '',
  ].join('\n');
}
