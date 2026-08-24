import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  configFile,
  dbFile,
  starterSchema,
  targetPackageName,
} from '../../../src/commands/init/templates/code-templates';
import {
  quickReferenceMd,
  variables as quickRefVars,
} from '../../../src/commands/init/templates/quick-reference';
import {
  minimalProjectReadmeMd,
  mongoVariables as readmeMongoVars,
  postgresVariables as readmePostgresVars,
} from '../../../src/commands/init/templates/readme';
import {
  defaultTsConfig,
  mergeTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../src/commands/init/templates/tsconfig';

const TEMPLATES_DIR = join(import.meta.dirname, '../../../src/commands/init/templates');

function extractPlaceholders(templateFile: string): Set<string> {
  const content = readFileSync(join(TEMPLATES_DIR, templateFile), 'utf-8');
  return new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ''));
}

describe('templates', () => {
  describe('starterSchema', () => {
    it('contains User and Post models for postgres PSL', () => {
      const schema = starterSchema('postgres', 'psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('username  String?');
      expect(schema).toContain('@default(autoincrement())');
    });

    it('includes a relation between User and Post for postgres PSL', () => {
      const schema = starterSchema('postgres', 'psl');

      expect(schema).toContain('posts     Post[]');
      expect(schema).toContain('author    User');
    });

    it('uses ObjectId ids for mongo PSL', () => {
      const schema = starterSchema('mongo', 'psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('username String?');
      expect(schema).toContain('ObjectId @id @map("_id")');
      expect(schema).not.toContain('autoincrement');
    });

    it('includes @@map collection names for mongo PSL', () => {
      const schema = starterSchema('mongo', 'psl');

      expect(schema).toContain('@@map("users")');
      expect(schema).toContain('@@map("posts")');
    });

    it('uses defineContract for postgres TypeScript imported from facade', () => {
      const schema = starterSchema('postgres', 'typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@internal/postgres/contract-builder'");
      expect(schema).toContain('username: field.text().optional()');
    });

    it('uses defineContract for mongo TypeScript imported from facade', () => {
      const schema = starterSchema('mongo', 'typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@internal/mongo/contract-builder'");
      expect(schema).toContain('username: field.string().optional()');
    });

    it('only imports from the facade package for postgres TypeScript', () => {
      const schema = starterSchema('postgres', 'typescript');

      const imports = schema.match(/from '@internal\/[^']+'/g) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const importLine of imports) {
        expect(importLine).toMatch(/from '@internal\/postgres(\/[^']+)?'/);
      }
    });

    it('only imports from the facade package for mongo TypeScript', () => {
      const schema = starterSchema('mongo', 'typescript');

      const imports = schema.match(/from '@internal\/[^']+'/g) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const importLine of imports) {
        expect(importLine).toMatch(/from '@internal\/mongo(\/[^']+)?'/);
      }
    });

    // FR5.3: TS schema templates for Postgres and Mongo share a single
    // builder shape — same defineContract signature, same relation
    // reference syntax, same outer structure. The four divergence axes
    // called out in F17 are reconciled.
    describe('TS template reconciliation (FR5.3)', () => {
      it('both targets use the same callback-factory defineContract signature', () => {
        const pg = starterSchema('postgres', 'typescript');
        const mongo = starterSchema('mongo', 'typescript');

        // The SQL starter uses model tokens (models first, relations attached
        // via .relations()), which needs a block-bodied callback; the mongo
        // builder has no token chain, so its starter keeps the expression
        // body. The shared signature is the callback destructure itself.
        for (const schema of [pg, mongo]) {
          expect(schema).toMatch(
            /defineContract\(\s*\{\s*\},\s*\(\{ field, model, rel \}\) => [({]/,
          );
          expect(schema).not.toMatch(/\{ family:/);
          expect(schema).toContain('models: {');
        }
      });

      it('neither target imports field/model/rel as bare top-level helpers', () => {
        const pg = starterSchema('postgres', 'typescript');
        const mongo = starterSchema('mongo', 'typescript');

        for (const schema of [pg, mongo]) {
          expect(schema).not.toMatch(/import \{[^}]*\bfield\b[^}]*\} from/);
          expect(schema).not.toMatch(/import \{[^}]*\bmodel\b[^}]*\} from/);
          expect(schema).not.toMatch(/import \{[^}]*\brel\b[^}]*\} from/);
        }
      });

      it('the SQL starter references models by token, the form the framework recommends', () => {
        const pg = starterSchema('postgres', 'typescript');

        // String refs here would make a fresh scaffold emit
        // PN_CONTRACT_TYPED_FALLBACK_AVAILABLE warnings on its first emit.
        expect(pg).toContain('rel.belongsTo(User');
        expect(pg).toContain('rel.hasMany(Post');
        expect(pg).not.toMatch(/rel\.\w+\('/);
        expect(pg).toMatch(/\.relations\(\{/);
      });

      it('the mongo starter keeps string references and inline relations — its builder has no token chain', () => {
        const mongo = starterSchema('mongo', 'typescript');

        expect(mongo).toContain("rel.belongsTo('User'");
        expect(mongo).toContain('relations: {');
        expect(mongo).not.toMatch(/\}\)\.relations\(/);
      });
    });
  });

  describe('configFile', () => {
    it('generates postgres config with dotenv and single import from facade', () => {
      const config = configFile('postgres', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@internal/postgres/config'");
      expect(config).toContain('contract: "./prisma/contract.prisma"');
      const importLines = config.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(importLines).toHaveLength(1);
    });

    it('generates mongo config with dotenv and single import from facade', () => {
      const config = configFile('mongo', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@internal/mongo/config'");
      const importLines = config.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(importLines).toHaveLength(1);
    });
  });

  describe('dbFile', () => {
    it('generates postgres db.ts with lazy facade and DATABASE_URL binding', () => {
      const db = dbFile('postgres');

      expect(db).toContain("from '@internal/postgres/runtime'");
      expect(db).toContain('postgres<Contract>({');
      expect(db).toContain('contractJson,');
      expect(db).toContain("url: process.env['DATABASE_URL']!,");
      expect(db).not.toContain('await db.connect');
      const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(prismaNextImports).toHaveLength(1);
    });

    it('generates mongo db.ts with lazy facade and DATABASE_URL binding', () => {
      const db = dbFile('mongo');

      expect(db).toContain("from '@internal/mongo/runtime'");
      expect(db).toContain('mongo<Contract>({');
      expect(db).toContain('contractJson,');
      expect(db).toContain("url: process.env['DATABASE_URL']!,");
      expect(db).not.toContain('await db.connect');
      const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(prismaNextImports).toHaveLength(1);
    });
  });

  describe('targetPackageName', () => {
    it('returns postgres package name', () => {
      expect(targetPackageName('postgres')).toBe('@internal/postgres');
    });

    it('returns mongo package name', () => {
      expect(targetPackageName('mongo')).toBe('@internal/mongo');
    });
  });

  describe('quickReferenceMd', () => {
    it('contains file locations for postgres', () => {
      const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('src/prisma/contract.prisma');
      expect(md).toContain('src/prisma/contract.json');
      expect(md).toContain('src/prisma/db.ts');
      expect(md).toContain('prisma.config.ts');
    });

    it('contains postgres-specific content', () => {
      const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@internal/postgres');
      expect(md).toContain('postgresql://');
    });

    it('contains ORM query example for postgres', () => {
      const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('db.orm.public.User');
      expect(md).toContain('.where(');
      expect(md).toContain('.first()');
    });

    it('contains common commands', () => {
      const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
    });

    it('contains mongo-specific content', () => {
      const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@internal/mongo');
      expect(md).toContain('mongodb://');
    });

    it('contains lazy ORM query example for mongo (no manual connect step)', () => {
      const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('db.orm.users');
      expect(md).toContain('.where({ email:');
      expect(md).toContain('.first()');
      expect(md).not.toContain('await db.connect(');
      expect(md).not.toContain('client.orm.User');
    });

    // FR8.2: Requirements section surfaces the minimum supported server
    // version on the user-facing quick reference, so a freshly-init'd
    // project does not silently lie about which servers it supports.
    describe('Requirements section (FR8.2)', () => {
      it('postgres: documents the minimum PostgreSQL version and only the postgres verify command', () => {
        const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

        expect(md).toMatch(/## Requirements/);
        expect(md).toMatch(/PostgreSQL \d+ or newer/);
        expect(md).toContain('SELECT version()');
        // Postgres scaffolds shouldn't ship Mongo's verify command.
        expect(md).not.toContain('buildInfo');
        expect(md).not.toContain('db.runCommand');
      });

      it('mongo: documents the minimum MongoDB version and only the mongo verify command', () => {
        const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

        expect(md).toMatch(/## Requirements/);
        expect(md).toMatch(/MongoDB \d/);
        expect(md).toContain('buildInfo');
        expect(md).toContain('db.runCommand');
        // Mongo scaffolds shouldn't ship Postgres' verify command.
        expect(md).not.toContain('SELECT version()');
      });

      it('mentions the --probe-db opt-in so users know init does not connect by default', () => {
        const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

        expect(md).toContain('--probe-db');
      });
    });

    it('documents the replica-set requirement for transactions and change streams', () => {
      const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('replica set');
      expect(md).toContain('TML-2313');
    });

    it('documents the escape hatches and steers users away from db.runtime() for mongo', () => {
      const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

      expect(md).toContain('db.query');
      expect(md).toContain('mongoClient');
      expect(md).not.toMatch(/drop down[^\n]*via `db\.runtime\(\)`/);
      expect(md).not.toMatch(/use `db\.runtime\(\)`[^.\n]*if you need transactions/i);
    });

    // FR5.1: schema sample block differentiates by authoring.
    describe('schema sample (FR5.1)', () => {
      it('postgres + psl: shows a PSL `model { ... }` block', () => {
        const md = quickReferenceMd('postgres', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

        expect(md).toContain('```prisma');
        expect(md).toContain('model User');
        expect(md).toContain('@id @default(autoincrement())');
        expect(md).not.toContain('defineContract');
      });

      it('postgres + typescript: shows a TS `defineContract` block (no PSL)', () => {
        const md = quickReferenceMd(
          'postgres',
          'typescript',
          'src/prisma/contract.ts',
          'pnpm prisma',
        );

        expect(md).toContain('```typescript');
        expect(md).toContain('defineContract');
        expect(md).toContain("from '@internal/postgres/contract-builder'");
        expect(md).not.toContain('```prisma');
        expect(md).not.toMatch(/^model User \{/m);
      });

      it('mongo + psl: shows a PSL `model { ... }` block', () => {
        const md = quickReferenceMd('mongo', 'psl', 'src/prisma/contract.prisma', 'pnpm prisma');

        expect(md).toContain('```prisma');
        expect(md).toContain('model User');
        expect(md).toContain('ObjectId @id @map("_id")');
        expect(md).not.toContain('defineContract');
      });

      it('mongo + typescript: shows a TS `defineContract` block (no PSL)', () => {
        const md = quickReferenceMd('mongo', 'typescript', 'src/prisma/contract.ts', 'pnpm prisma');

        expect(md).toContain('```typescript');
        expect(md).toContain('defineContract');
        expect(md).toContain("from '@internal/mongo/contract-builder'");
        expect(md).not.toContain('```prisma');
        expect(md).not.toMatch(/^model User \{/m);
      });
    });
  });

  describe('tsconfig', () => {
    describe('defaultTsConfig', () => {
      it('includes all required compiler options', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
      });

      it('sets strict: true', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        expect(opts['strict']).toBe(true);
      });

      it('sets skipLibCheck: true', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        expect(opts['skipLibCheck']).toBe(true);
      });

      it('produces valid JSON', () => {
        expect(() => JSON.parse(defaultTsConfig())).not.toThrow();
      });
    });

    describe('mergeTsConfig', () => {
      it('adds required options to an empty compilerOptions', () => {
        const existing = JSON.stringify({ compilerOptions: {} }, null, 2);
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
      });

      it('preserves existing non-conflicting options', () => {
        const existing = JSON.stringify(
          { compilerOptions: { outDir: './dist', strict: true, declaration: true } },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        expect(opts['outDir']).toBe('./dist');
        expect(opts['strict']).toBe(true);
        expect(opts['declaration']).toBe(true);
      });

      it('overrides conflicting options with required values', () => {
        const existing = JSON.stringify(
          {
            compilerOptions: {
              module: 'commonjs',
              moduleResolution: 'node',
              resolveJsonModule: false,
            },
          },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        expect(opts['module']).toBe('preserve');
        expect(opts['moduleResolution']).toBe('bundler');
        expect(opts['resolveJsonModule']).toBe(true);
      });

      it('preserves non-compilerOptions fields', () => {
        const existing = JSON.stringify(
          {
            compilerOptions: { strict: true },
            include: ['src/**/*.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;

        expect(merged['include']).toEqual(['src/**/*.ts']);
        expect(merged['exclude']).toEqual(['node_modules']);
      });

      it('creates compilerOptions if missing', () => {
        const existing = JSON.stringify({ include: ['src'] }, null, 2);
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
        expect(merged['include']).toEqual(['src']);
      });

      it('produces valid JSON', () => {
        const existing = JSON.stringify({ compilerOptions: { target: 'ES2020' } }, null, 2);
        expect(() => JSON.parse(mergeTsConfig(existing))).not.toThrow();
      });
    });
  });

  // FR5.4: snapshot tests cover all four (target × authoring) cells.
  // The companion FR2.3 / FR5.4 typecheck guarantee against the published
  // facade lives in `test/integration/test/cli.init-templates.e2e.test.ts`.
  describe('per-cell snapshots (FR5.4)', () => {
    const cells = [
      { target: 'postgres', authoring: 'psl' },
      { target: 'postgres', authoring: 'typescript' },
      { target: 'mongo', authoring: 'psl' },
      { target: 'mongo', authoring: 'typescript' },
    ] as const;

    for (const { target, authoring } of cells) {
      describe(`${target} + ${authoring}`, () => {
        const schemaPath =
          authoring === 'typescript' ? 'src/prisma/contract.ts' : 'src/prisma/contract.prisma';

        it('starterSchema is stable', () => {
          expect(starterSchema(target, authoring)).toMatchSnapshot();
        });

        it('configFile is stable', () => {
          expect(configFile(target, `./${schemaPath}`)).toMatchSnapshot();
        });

        it('dbFile is stable', () => {
          expect(dbFile(target)).toMatchSnapshot();
        });

        it('quickReferenceMd is stable', () => {
          expect(quickReferenceMd(target, authoring, schemaPath, 'pnpm prisma')).toMatchSnapshot();
        });
      });
    }
  });

  describe('template variable consistency', () => {
    it('quick-reference-postgres.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('quick-reference-postgres.md');
      expect(mdVars).toEqual(new Set(quickRefVars));
    });

    it('quick-reference-mongo.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('quick-reference-mongo.md');
      expect(mdVars).toEqual(new Set(quickRefVars));
    });

    it('readme-postgres.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('readme-postgres.md');
      expect(mdVars).toEqual(new Set(readmePostgresVars));
    });

    it('readme-mongo.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('readme-mongo.md');
      expect(mdVars).toEqual(new Set(readmeMongoVars));
    });
  });

  describe('minimalProjectReadmeMd', () => {
    it('postgres: leads with db:init before dev', () => {
      const md = minimalProjectReadmeMd('postgres', 'prisma/contract.prisma', 'my-app', 'npm');

      expect(md).toMatch(/## First run/);
      expect(md).toContain('npm run db:init');
      expect(md).toContain('npm run dev');
      expect(md.indexOf('npm run db:init')).toBeLessThan(md.indexOf('npm run dev'));
      expect(md).not.toContain('Run the migration and seed scripts first');
    });

    it('mongo: leads with db:up before dev', () => {
      const md = minimalProjectReadmeMd('mongo', 'prisma/contract.prisma', 'my-app', 'npm');

      expect(md).toMatch(/## First run/);
      expect(md).toContain('npm run db:up');
      expect(md).toContain('npm run dev');
      expect(md.indexOf('npm run db:up')).toBeLessThan(md.indexOf('npm run dev'));
      expect(md).not.toContain('Run the migration and seed scripts first');
    });

    it('lists migration scripts under Available scripts, not First run', () => {
      const md = minimalProjectReadmeMd('postgres', 'prisma/contract.prisma', 'my-app', 'npm');
      const firstRunEnd = md.indexOf('## Available scripts');

      expect(firstRunEnd).toBeGreaterThan(-1);
      expect(md.slice(0, firstRunEnd)).not.toContain('migration:plan');
      expect(md).toContain('## Available scripts');
      expect(md).toContain('migration:plan');
    });

    describe('per-target snapshots', () => {
      it('postgres readme is stable', () => {
        expect(
          minimalProjectReadmeMd('postgres', 'prisma/contract.prisma', 'my-app', 'pnpm'),
        ).toMatchSnapshot();
      });

      it('mongo readme is stable', () => {
        expect(
          minimalProjectReadmeMd('mongo', 'prisma/contract.ts', 'my-app', 'pnpm'),
        ).toMatchSnapshot();
      });
    });
  });
});
