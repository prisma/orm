import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
} from '@internal/framework-components/emission';
import { createScaffoldSpecifierResolver } from '@internal/publish-surface/import-roots';

export type TargetId = 'postgres' | 'mongo';
export type AuthoringId = 'psl' | 'typescript';

/**
 * The resolver a scaffold for `target` is written against.
 *
 * A scaffold is always on the facade root: `init` writes an application around
 * one database package, and the workspace names are not published, so a project
 * scaffolded against them could not install (ADR 242). Both the files `init`
 * writes and the dependency it adds go through this, so they cannot disagree.
 */
export function scaffoldSpecifierResolverFor(target: TargetId): ImportSpecifierResolver {
  return createScaffoldSpecifierResolver({
    mode: 'facade',
    facade: target === 'postgres' ? '@prisma/orm-postgres' : '@prisma/orm-mongo',
  });
}

/**
 * The package name a scaffolded project depends on and imports from, for the
 * import root it is being scaffolded against.
 *
 * Every specifier the scaffold writes derives from this one, and `init` builds
 * a single resolver and hands it to both the file templates and the dependency
 * it installs — so the two cannot disagree. The one caller that deliberately
 * does not thread a resolver is the re-init cleanup in `inputs.ts`, which
 * inspects a manifest an earlier run wrote rather than writing one.
 *
 * Resolvers for scaffolding should come from `createScaffoldSpecifierResolver`
 * in the publish-surface package, which rejects the roots a facade-shaped
 * scaffold cannot express. (Named without its scope on purpose: JSDoc survives
 * into the published bundle, where an internal package name would trip the
 * shell tarball checks.)
 */
export function targetPackageName(
  target: TargetId,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  return resolveImportSpecifier(target === 'postgres' ? '@internal/postgres' : '@internal/mongo');
}

/** One entrypoint of the scaffolded project's target package. */
export function targetEntrypoint(
  target: TargetId,
  subpath: string,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const internal = target === 'postgres' ? '@internal/postgres' : '@internal/mongo';
  return resolveImportSpecifier(`${internal}/${subpath}`);
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
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  if (authoring === 'typescript') {
    const builder = targetEntrypoint(target, 'contract-builder', resolveImportSpecifier);
    return target === 'mongo' ? starterSchemaTsMongo(builder) : starterSchemaTsPostgres(builder);
  }
  return target === 'mongo' ? starterSchemaPslMongo() : starterSchemaPslPostgres();
}

/**
 * Renders a short authoring-appropriate schema sample for embedding in
 * `prisma-next.md`. Returns a complete fenced markdown code block.
 *
 * The sample intentionally shows just one model: it's illustrative, not
 * a substitute for the full scaffolded contract file. The TS samples use
 * the same outer shape as `starterSchemaTs*` so a user reading the doc and
 * the file side-by-side sees the same structure.
 */
export function schemaSample(
  target: TargetId,
  authoring: AuthoringId,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  if (authoring === 'typescript') {
    const builder = targetEntrypoint(target, 'contract-builder', resolveImportSpecifier);
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
  ({ field, model }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.id.uuidv7String(),
          email: field.text().unique(),
          username: field.text().optional(),
          name: field.text().optional(),
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
  ({ field, model }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          _id: field.objectId(),
          email: field.string(),
          username: field.string().optional(),
          name: field.string().optional(),
        },
      }),
    },
  }),
);
\`\`\``;
}

function starterSchemaPslPostgres(): string {
  return `// use prisma-next

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  username  String?
  name      String?
  posts     Post[]
  createdAt TimestamptzString @default(now())
  updatedAt temporal.updatedAtString()
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt TimestamptzString @default(now())
  updatedAt temporal.updatedAtString()
}
`;
}

function starterSchemaPslMongo(): string {
  return `// use prisma-next

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
  return `import { defineContract } from '${builder}';

export const contract = defineContract({}, ({ field, model, rel }) => {
  const User = model('User', {
    fields: {
      id: field.id.uuidv7String(),
      email: field.text().unique(),
      username: field.text().optional(),
      name: field.text().optional(),
      createdAt: field.temporal.createdAtString(),
      updatedAt: field.temporal.updatedAtString(),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.id.uuidv7String(),
      title: field.text(),
      content: field.text().optional(),
      authorId: field.uuidString(),
      createdAt: field.temporal.createdAtString(),
      updatedAt: field.temporal.updatedAtString(),
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
  ({ field, model, rel }) => ({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          _id: field.objectId(),
          email: field.string(),
          username: field.string().optional(),
          name: field.string().optional(),
        },
        relations: {
          posts: rel.hasMany('Post', { from: '_id', to: 'authorId' }),
        },
      }),

      Post: model('Post', {
        collection: 'posts',
        fields: {
          _id: field.objectId(),
          title: field.string(),
          content: field.string().optional(),
          authorId: field.objectId(),
        },
        relations: {
          author: rel.belongsTo('User', { from: 'authorId', to: '_id' }),
        },
      }),
    },
  }),
);
`;
}

export function configFile(
  target: TargetId,
  contractPath: string,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const configEntrypoint = targetEntrypoint(target, 'config', resolveImportSpecifier);
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

export function dbFile(
  target: TargetId,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const runtime = targetEntrypoint(target, 'runtime', resolveImportSpecifier);
  if (target === 'postgres') {
    return `import 'dotenv/config';
import postgres from '${runtime}';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
`;
  }

  return `import 'dotenv/config';
import mongo from '${runtime}';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = mongo<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
`;
}
