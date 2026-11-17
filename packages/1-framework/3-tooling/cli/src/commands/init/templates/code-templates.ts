import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';

export type TargetId = 'postgres' | 'mongo';
export type AuthoringId = 'psl' | 'typescript';

/**
 * The published package a scaffolded project for `target` depends on and
 * imports from. A scaffold names only this package and its entrypoints, and
 * `init` installs the same name, so the files and the dependency agree.
 */
export function targetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@prisma/orm-postgres' : '@prisma/orm-mongo';
}

/**
 * The workspace package of `target`, which projects scaffolded by earlier
 * versions of `init` may still declare. Tests pass it to the templates to
 * typecheck a scaffold inside this repository.
 */
export function workspaceTargetPackageName(target: TargetId): string {
  return target === 'postgres' ? '@internal/postgres' : '@internal/mongo';
}

// biome-ignore lint/plugin/no-family-vocabulary: the driver the target package declares as a required peer dependency, which init installs with it
const DRIVER_PEERS: ReadonlyMap<TargetId, string> = new Map([['mongo', 'mongodb']]);

/** Packages the target package declares as required peer dependencies; init installs them with it. */
export function targetPeerPackages(target: TargetId): readonly string[] {
  const driver = DRIVER_PEERS.get(target);
  return driver === undefined ? [] : [driver];
}

/** One entrypoint of the scaffolded project's target package. */
export function targetEntrypoint(targetPackage: string, subpath: string): string {
  return `${targetPackage}/${subpath}`;
}

export function targetLabel(target: TargetId): string {
  return target === 'postgres' ? 'PostgreSQL' : 'MongoDB';
}

export function defaultSchemaPath(authoring: AuthoringId): string {
  if (authoring === 'typescript') {
    return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.ts`;
  }
  return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.prisma`;
}

export function starterSchema(
  target: TargetId,
  authoring: AuthoringId,
  targetPackage: string,
): string {
  if (authoring === 'typescript') {
    const builder = targetEntrypoint(targetPackage, 'contract-builder');
    return target === 'mongo' ? starterSchemaTsMongo(builder) : starterSchemaTsPostgres(builder);
  }
  return target === 'mongo' ? starterSchemaPslMongo() : starterSchemaPslPostgres();
}

/**
 * Renders a short authoring-appropriate schema sample for embedding in
 * `prisma-8.md`. Returns a complete fenced markdown code block.
 *
 * The sample intentionally shows just one model: it's illustrative, not
 * a substitute for the full scaffolded contract file. The TS samples use
 * the same outer shape as `starterSchemaTs*` so a user reading the doc and
 * the file side-by-side sees the same structure.
 */
export function schemaSample(
  target: TargetId,
  authoring: AuthoringId,
  targetPackage: string,
): string {
  if (authoring === 'typescript') {
    const builder = targetEntrypoint(targetPackage, 'contract-builder');
    return target === 'mongo' ? schemaSampleTsMongo(builder) : schemaSampleTsPostgres(builder);
  }
  return target === 'mongo' ? schemaSamplePslMongo() : schemaSamplePslPostgres();
}

function schemaSamplePslPostgres(): string {
  return `\`\`\`prisma
model User {
  id       Int     @id @default(autoincrement())
  email    String  @unique
  username String?
  name     String?
}
\`\`\``;
}

function schemaSamplePslMongo(): string {
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

function schemaSampleTsPostgres(builder: string): string {
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

function schemaSampleTsMongo(builder: string): string {
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

function starterSchemaPslPostgres(): string {
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

function starterSchemaPslMongo(): string {
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

function starterSchemaTsPostgres(builder: string): string {
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

function starterSchemaTsMongo(builder: string): string {
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

export function configFile(contractPath: string, targetPackage: string): string {
  const configEntrypoint = targetEntrypoint(targetPackage, 'config');
  return `import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '${configEntrypoint}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: ${JSON.stringify(contractPath)},
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}

/**
 * The config for a project whose contract source is its Prisma 7 schema:
 * `prisma7Schema` beside `defineConfig`, from the same entrypoint, with the
 * schema path as the user gave it and the emitted artifacts under Prisma 8's
 * own directory (`output` is the directory; the facade names `contract.json`).
 */
export function prisma7ConfigFile(
  schemaPath: string,
  outputDir: string,
  targetPackage: string,
): string {
  const configEntrypoint = targetEntrypoint(targetPackage, 'config');
  return `import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, prisma7Schema } from '${configEntrypoint}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema(${JSON.stringify(schemaPath)}),
    output: ${JSON.stringify(outputDir)},
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}

export function dbFile(target: TargetId, targetPackage: string): string {
  const runtime = targetEntrypoint(targetPackage, 'runtime');
  const staticEntry = targetEntrypoint(targetPackage, 'static');
  const factory = target === 'postgres' ? 'postgres' : 'mongo';
  return `import 'dotenv/config';
import ${factory} from '${runtime}';
import { contractFromJson } from '${staticEntry}';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = ${factory}({
  contract,
  url: process.env['DATABASE_URL']!,
});
`;
}
