import type { AuthoringMode } from '@internal/cli/init-contribution';
import { MONGO_MIN_SERVER_VERSION } from '@internal/target-mongo/server-version';
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
  id       ObjectId @id @map("_id")
  email    String   @unique
  username String?
  name     String?
  @@map("users")
}
\`\`\``;
}

function contractSampleTs(): string {
  return `\`\`\`typescript
import { defineContract } from '${builder}';

export const contract = defineContract(
  {},
  ({ field, model, type }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          email: field.scalar(type.String()),
          username: field.scalar(type.String()).optional(),
          name: field.scalar(type.String()).optional(),
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
  id       ObjectId @id @map("_id")
  email    String   @unique
  username String?
  name     String?
  posts    Post[]
  @@map("users")
}

model Post {
  id       ObjectId @id @map("_id")
  title    String
  content  String?
  author   User     @relation(fields: [authorId], references: [id])
  authorId ObjectId
  @@map("posts")
}
`;
}

function starterContractTs(): string {
  return `import { defineContract } from '${builder}';

export const contract = defineContract(
  {},
  ({ field, model, rel, type }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          email: field.scalar(type.String()),
          username: field.scalar(type.String()).optional(),
          name: field.scalar(type.String()).optional(),
        },
        relations: {
          posts: rel.hasMany('Post', { from: 'id', to: 'authorId' }),
        },
      }),

      Post: model('Post', {
        collection: 'posts',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          title: field.scalar(type.String()),
          content: field.scalar(type.String()).optional(),
          authorId: field.scalar(type.ObjectId()),
        },
        relations: {
          author: rel.belongsTo('User', { from: 'authorId', to: 'id' }),
        },
      }),
    },
  }),
);
`;
}

export function databaseFile(): string {
  return `import 'dotenv/config';
import mongo from '${moduleBase}/runtime';
import { contractFromJson } from '${moduleBase}/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = mongo({
  contract,
  url: process.env['DATABASE_URL']!,
});
`;
}

export function envExample(): string {
  return [
    '# Connection string for MongoDB.',
    `# Requires MongoDB >= ${MONGO_MIN_SERVER_VERSION}.`,
    '',
    '# Standalone local mongod / `docker run mongo:8` — no replica set required for first-run queries.',
    '# Transactions and change streams need a replica set; add ?replicaSet=... only after initiating one.',
    '',
    'DATABASE_URL="mongodb://user:password@localhost:27017/mydb"',
    '',
  ].join('\n');
}
