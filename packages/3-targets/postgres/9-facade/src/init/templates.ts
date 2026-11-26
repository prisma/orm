import type { ContractEntryExpression, ContractEntryInput } from '@internal/cli/init-contribution';
import type { ContractSourceFormat } from '@internal/config/config-types';
import {
  POSTGRES_MIN_SERVER_VERSION,
  POSTGRES_NEWEST_VERSION,
} from '@internal/target-postgres/server-version';
import type { JsonValue } from '@internal/utils/json';
import { moduleBase } from '../config/module-base';

export const configModule = `${moduleBase}/config`;
const builder = `${moduleBase}/contract-builder`;

/** The config's `contract:` entry, stating the newest PostgreSQL version the target knows; a TypeScript contract states it in `defineContract`. */
export function contractEntry(input: ContractEntryInput): ContractEntryExpression {
  if (input.kind === 'prisma7-schema') {
    return {
      call: {
        moduleSpecifier: configModule,
        symbol: 'prisma7Schema',
        args: [input.path, { databaseVersion: POSTGRES_NEWEST_VERSION }],
      },
    };
  }
  return input.mode === 'typescript'
    ? { value: input.path }
    : { value: { path: input.path, databaseVersion: POSTGRES_NEWEST_VERSION } };
}

function sampleSource(value: JsonValue): string {
  if (typeof value === 'string') {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map(sampleSource).join(', ')}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) =>
      `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : sampleSource(key)}: ${sampleSource(item)}`,
  );
  return `{ ${entries.join(', ')} }`;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** The contract entry as the quick reference shows it, in the quick reference's own quoting. */
export function contractEntrySample(input: ContractEntryInput): string {
  const entry = contractEntry(input);
  return 'value' in entry
    ? sampleSource(entry.value)
    : `${entry.call.symbol}(${entry.call.args.map(sampleSource).join(', ')})`;
}

export function starterContract(mode: ContractSourceFormat): string {
  return mode === 'typescript' ? starterContractTs() : starterContractPsl();
}

export function contractSample(mode: ContractSourceFormat): string {
  return mode === 'typescript' ? contractSampleTs() : contractSamplePsl();
}

/** The type a query result gives `id` in the starter contract: an integer in PSL, UUID text in TypeScript. */
export function starterIdType(mode: ContractSourceFormat): string {
  return mode === 'typescript' ? 'string' : 'number';
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
  { databaseVersion: ${POSTGRES_NEWEST_VERSION} },
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

export const contract = defineContract({ databaseVersion: ${POSTGRES_NEWEST_VERSION} }, ({ field, model, rel, gen, type }) => {
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
