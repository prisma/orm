import { readFileSync } from 'node:fs';
import type { ReadmeInput } from '@internal/cli/init-contribution';
import type { ContractSourceFormat } from '@internal/config/config-types';
import { MONGO_MIN_SERVER_VERSION } from '@internal/target-mongo/server-version';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import contribution from '../../src/exports/init';

const INIT_DIR = join(import.meta.dirname, '../../src/init');

function placeholders(templateFile: string): Set<string> {
  const content = readFileSync(join(INIT_DIR, templateFile), 'utf-8');
  return new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ''));
}

const REQUIREMENTS = [
  '## Requirements',
  '',
  '- **MongoDB 8.0 or newer.** Older servers are not supported. Run `db.runCommand({ buildInfo: 1 })` against your server to verify.',
  '- The CLI never connects to your database without explicit consent. Pass `--probe-db` to `pnpm prisma orm init` if you want `init` to verify the server version itself.',
].join('\n');

function quickReferenceFor(mode: ContractSourceFormat, schemaPath: string): string {
  return contribution.quickReference({
    mode,
    schemaPath,
    cliCommand: 'pnpm prisma',
    requirements: REQUIREMENTS,
  });
}

function readme(input: ReadmeInput): string {
  if (contribution.readme === undefined) {
    throw new Error('the contribution writes no README');
  }
  return contribution.readme(input);
}

describe('templates', () => {
  it('states the server version the target package supports', () => {
    expect(contribution.serverRequirement).toEqual({
      minVersion: MONGO_MIN_SERVER_VERSION,
      checkCommand: 'db.runCommand({ buildInfo: 1 })',
    });
  });

  it('installs the driver it declares as a peer dependency', () => {
    expect(contribution.peerPackages).toEqual(['mongodb']);
  });

  it('cannot take a Prisma 7 schema', () => {
    expect(contribution.prisma7QuickReference).toBeUndefined();
  });

  describe('starterContract', () => {
    it('uses ObjectId ids for PSL', () => {
      const schema = contribution.starterContract('psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('username String?');
      expect(schema).toContain('ObjectId @id @map("_id")');
      expect(schema).not.toContain('autoincrement');
    });

    it('includes @@map collection names for PSL', () => {
      const schema = contribution.starterContract('psl');

      expect(schema).toContain('@@map("users")');
      expect(schema).toContain('@@map("posts")');
    });

    it('uses defineContract for TypeScript imported from facade', () => {
      const schema = contribution.starterContract('typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@internal/mongo/contract-builder'");
      expect(schema).toContain('username: field.scalar(type.String()).optional()');
    });

    it('only imports from the facade package for TypeScript', () => {
      const schema = contribution.starterContract('typescript');

      const specifiers = [
        ...schema.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g),
      ].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier).toMatch(/^@internal\/mongo(\/.+)?$/);
      }
    });

    it('uses the callback-factory defineContract signature', () => {
      const schema = contribution.starterContract('typescript');

      expect(schema).toMatch(
        /defineContract\(\s*\{\s*\},\s*\(\{ field, model, rel(, gen)?, type \}\) => [({]/,
      );
      expect(schema).not.toMatch(/\{ family:/);
      expect(schema).toContain('models: {');
    });

    it('does not import field/model/rel as bare top-level helpers', () => {
      const schema = contribution.starterContract('typescript');

      expect(schema).not.toMatch(/import \{[^}]*\bfield\b[^}]*\} from/);
      expect(schema).not.toMatch(/import \{[^}]*\bmodel\b[^}]*\} from/);
      expect(schema).not.toMatch(/import \{[^}]*\brel\b[^}]*\} from/);
    });

    it('keeps string references and inline relations — its builder has no token chain', () => {
      const schema = contribution.starterContract('typescript');

      expect(schema).toContain("rel.belongsTo('User'");
      expect(schema).toContain('relations: {');
      expect(schema).not.toMatch(/\}\)\.relations\(/);
    });
  });

  describe('databaseFile', () => {
    it('generates db.ts with lazy facade and DATABASE_URL binding', () => {
      const db = contribution.databaseFile();

      expect(db).toContain("import mongo from '@internal/mongo/runtime'");
      expect(db).toContain("import { contractFromJson } from '@internal/mongo/static'");
      expect(db).toContain('export const contract = contractFromJson<Contract>(contractJson);');
      expect(db).toContain('mongo({\n  contract,\n');
      expect(db).toContain("url: process.env['DATABASE_URL']!,");
      expect(db).not.toContain('await db.connect');
      const internalImports = db.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(internalImports).toHaveLength(2);
    });
  });

  describe('envExample', () => {
    it('states the connection string shape and the minimum server version', () => {
      expect(contribution.envExample()).toBe(
        [
          '# Connection string for MongoDB.',
          '# Requires MongoDB >= 8.0.',
          '',
          '# Standalone local mongod / `docker run mongo:8` — no replica set required for first-run queries.',
          '# Transactions and change streams need a replica set; add ?replicaSet=... only after initiating one.',
          '',
          'DATABASE_URL="mongodb://user:password@localhost:27017/mydb"',
          '',
        ].join('\n'),
      );
    });
  });

  describe('quickReference', () => {
    it('contains mongo-specific content', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@internal/mongo');
      expect(md).toContain('mongodb://');
    });

    it('contains lazy ORM query example (no manual connect step)', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('db.orm.users');
      expect(md).toContain('.where({ email:');
      expect(md).toContain('.first()');
      expect(md).not.toContain('await db.connect(');
      expect(md).not.toContain('client.orm.User');
    });

    it('places the requirements it is given', () => {
      expect(quickReferenceFor('psl', 'src/prisma/contract.prisma')).toContain(REQUIREMENTS);
    });

    it('documents the replica-set requirement for transactions and change streams', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('replica set');
      expect(md).toContain('TML-2313');
    });

    it('documents the escape hatches and steers users away from db.runtime()', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('db.query');
      expect(md).toContain('mongoClient');
      expect(md).not.toMatch(/drop down[^\n]*via `db\.runtime\(\)`/);
      expect(md).not.toMatch(/use `db\.runtime\(\)`[^.\n]*if you need transactions/i);
    });

    describe('schema sample (FR5.1)', () => {
      it('psl: shows a PSL `model { ... }` block', () => {
        const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

        expect(md).toContain('```prisma');
        expect(md).toContain('model User');
        expect(md).toContain('ObjectId @id @map("_id")');
        expect(md).not.toContain('defineContract');
      });

      it('typescript: shows a TS `defineContract` block (no PSL)', () => {
        const md = quickReferenceFor('typescript', 'src/prisma/contract.ts');

        expect(md).toContain('```typescript');
        expect(md).toContain('defineContract');
        expect(md).toContain("from '@internal/mongo/contract-builder'");
        expect(md).not.toContain('```prisma');
        expect(md).not.toMatch(/^model User \{/m);
      });
    });
  });

  describe('rendering', () => {
    it('inserts values as they are, even ones that look like placeholders or patterns', () => {
      const schemaPath = 'src/cost$&$$/{{pkg}}/contract.prisma';

      const md = quickReferenceFor('psl', schemaPath);

      expect(md).toContain(schemaPath);
    });
  });

  describe('per-cell snapshots (FR5.4)', () => {
    for (const authoring of ['psl', 'typescript'] as const) {
      describe(`mongo + ${authoring}`, () => {
        const schemaPath =
          authoring === 'typescript' ? 'src/prisma/contract.ts' : 'src/prisma/contract.prisma';

        it('starterSchema is stable', () => {
          expect(contribution.starterContract(authoring)).toMatchSnapshot();
        });

        it('dbFile is stable', () => {
          expect(contribution.databaseFile()).toMatchSnapshot();
        });

        it('quickReferenceMd is stable', () => {
          expect(quickReferenceFor(authoring, schemaPath)).toMatchSnapshot();
        });
      });
    }
  });

  describe('template variable consistency', () => {
    it('init-quick-reference.md has the placeholders the quick reference fills', () => {
      expect(placeholders('init-quick-reference.md')).toEqual(
        new Set([
          'schemaPath',
          'schemaDir',
          'dbImportPath',
          'pkgRun',
          'pkg',
          'configEntrypoint',
          'schemaSample',
          'requirements',
        ]),
      );
    });

    it('init-readme.md has the placeholders the README fills', () => {
      expect(placeholders('init-readme.md')).toEqual(
        new Set([
          'projectName',
          'contractPath',
          'runDev',
          'runContractEmit',
          'runDbUp',
          'runDbDown',
          'runDbReset',
          'runMigrationPlan',
          'runMigrate',
          'runDbSeed',
        ]),
      );
    });
  });

  describe('minimalProjectReadmeMd', () => {
    it('leads with db:up before dev', () => {
      const md = readme({
        projectName: 'my-app',
        contractPath: 'prisma/contract.prisma',
        runScript: (script) => `npm run ${script}`,
      });

      expect(md).toMatch(/## First run/);
      expect(md).toContain('npm run db:up');
      expect(md).toContain('npm run dev');
      expect(md.indexOf('npm run db:up')).toBeLessThan(md.indexOf('npm run dev'));
      expect(md).not.toContain('Run the migration and seed scripts first');
    });

    describe('per-target snapshots', () => {
      it('mongo readme is stable', () => {
        expect(
          readme({
            projectName: 'my-app',
            contractPath: 'prisma/contract.ts',
            runScript: (script) => `pnpm run ${script}`,
          }),
        ).toMatchSnapshot();
      });
    });
  });
});
