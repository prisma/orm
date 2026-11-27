import { readFileSync } from 'node:fs';
import type { ContractEntryInput, ReadmeInput } from '@internal/cli/init-contribution';
import type { ContractSourceFormat } from '@internal/config/config-types';
import {
  POSTGRES_MIN_SERVER_VERSION,
  POSTGRES_NEWEST_VERSION,
} from '@internal/target-postgres/server-version-range';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Schema } from '../../src/config/prisma7-schema';
import { postgres18, postgresDriver } from '../../src/contract/contract-capabilities';
import * as configModuleExports from '../../src/exports/config';
import contribution from '../../src/exports/init';

const INIT_DIR = join(import.meta.dirname, '../../src/init');

function placeholders(templateFile: string): Set<string> {
  const content = readFileSync(join(INIT_DIR, templateFile), 'utf-8');
  return new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ''));
}

const REQUIREMENTS = [
  '## Requirements',
  '',
  '- **PostgreSQL 15 or newer.** Older servers are not supported. Run `SELECT version()` against your server to verify.',
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

function contractEntryOf(input: ContractEntryInput) {
  if (contribution.contractEntry === undefined) {
    throw new Error('the contribution gives no contract entry');
  }
  return contribution.contractEntry(input);
}

function npmRun(script: string): string {
  return `npm run ${script}`;
}

function pnpmRun(script: string): string {
  return `pnpm run ${script}`;
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
      minVersion: POSTGRES_MIN_SERVER_VERSION,
      checkCommand: 'SELECT version()',
    });
  });

  it('imports defineConfig from its own config entrypoint', () => {
    expect(contribution.configModule).toBe('@internal/postgres/config');
  });

  describe('contractEntry', () => {
    const required = `requiredCapabilities: [...postgres${POSTGRES_NEWEST_VERSION}, ...postgresDriver]`;
    const capabilityImports = [
      {
        moduleSpecifier: '@internal/postgres/config',
        symbol: `postgres${POSTGRES_NEWEST_VERSION}`,
      },
      { moduleSpecifier: '@internal/postgres/config', symbol: 'postgresDriver' },
    ];

    it('lists the newest PostgreSQL version’s and the driver’s capabilities beside a Prisma schema contract', () => {
      const entry = contractEntryOf({
        kind: 'starter',
        mode: 'psl',
        path: './prisma/contract.prisma',
      });

      expect(entry.renderTypeScript()).toBe(`{ path: "./prisma/contract.prisma", ${required} }`);
      expect(entry.importRequirements()).toEqual(capabilityImports);
      expect(entry.contractValue(configModuleExports)).toEqual({
        path: './prisma/contract.prisma',
        requiredCapabilities: [...postgres18, ...postgresDriver],
      });
    });

    it('is the path of a TypeScript contract, which lists its required capabilities in defineContract', () => {
      const entry = contractEntryOf({
        kind: 'starter',
        mode: 'typescript',
        path: './prisma/contract.ts',
      });

      expect(entry.renderTypeScript()).toBe('"./prisma/contract.ts"');
      expect(entry.importRequirements()).toEqual([]);
      expect(entry.contractValue(configModuleExports)).toBe('./prisma/contract.ts');
      expect(contribution.starterContract('typescript')).toContain(
        `defineContract({ ${required} }`,
      );
    });

    it('calls prisma7Schema from its config module, and builds the config the call builds', () => {
      const entry = contractEntryOf({ kind: 'prisma7-schema', path: 'prisma/schema.prisma' });

      expect(entry.renderTypeScript()).toBe(
        `prisma7Schema("prisma/schema.prisma", { ${required} })`,
      );
      expect(entry.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/postgres/config', symbol: 'prisma7Schema' },
        ...capabilityImports,
      ]);
      expect(JSON.stringify(entry.contractValue(configModuleExports))).toEqual(
        JSON.stringify(
          prisma7Schema('prisma/schema.prisma', {
            requiredCapabilities: [...postgres18, ...postgresDriver],
          }),
        ),
      );
    });
    it('builds its value from the exports it imports, by the names its text imports them by', () => {
      const exports = {
        prisma7Schema: (path: string, options: object) => ({ path, options }),
        [`postgres${POSTGRES_NEWEST_VERSION}`]: ['sql.fromTheVersion'],
        postgresDriver: ['sql.fromTheDriver'],
      };

      expect(
        contractEntryOf({ kind: 'prisma7-schema', path: 'prisma/schema.prisma' }).contractValue(
          exports,
        ),
      ).toEqual({
        path: 'prisma/schema.prisma',
        options: { requiredCapabilities: ['sql.fromTheVersion', 'sql.fromTheDriver'] },
      });
    });
  });

  describe('the quick references show the config init writes', () => {
    const configImports = [
      `import { defineConfig as ormConfig, postgres${POSTGRES_NEWEST_VERSION}, postgresDriver } from '@internal/postgres/config';`,
      "import { definePrismaConfig } from '@prisma/cli-engine';",
    ].join('\n');

    it.each(['psl', 'typescript'] as const)('for a %s starter', (mode) => {
      const schemaPath = mode === 'psl' ? 'src/prisma/contract.prisma' : 'src/prisma/contract.ts';
      const entry = contractEntryOf({ kind: 'starter', mode, path: `./${schemaPath}` });
      const reference = quickReferenceFor(mode, schemaPath);

      expect(reference).toContain(`\n    contract: ${entry.renderTypeScript()},\n`);
      if (mode === 'psl') expect(reference).toContain(configImports);
    });

    it('for a Prisma 7 schema', () => {
      const reference = contribution.prisma7QuickReference?.({
        schemaPath: 'prisma/schema.prisma',
        outputDir: 'src/prisma',
        cliCommand: 'pnpm prisma',
        requirements: REQUIREMENTS,
        prisma7Config: undefined,
      });

      expect(reference).toContain(
        `import { defineConfig as ormConfig, postgres${POSTGRES_NEWEST_VERSION}, postgresDriver, prisma7Schema } from '@internal/postgres/config';`,
      );
      expect(reference).toContain(
        `\n    contract: prisma7Schema("prisma/schema.prisma", { requiredCapabilities: [...postgres${POSTGRES_NEWEST_VERSION}, ...postgresDriver] }),\n`,
      );
    });
  });

  describe('starterContract', () => {
    it('contains User and Post models for PSL', () => {
      const schema = contribution.starterContract('psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('username  String?');
      expect(schema).toContain('@default(autoincrement())');
    });

    it('includes a relation between User and Post for PSL', () => {
      const schema = contribution.starterContract('psl');

      expect(schema).toContain('posts     Post[]');
      expect(schema).toContain('author    User');
    });

    it('uses defineContract for TypeScript imported from facade', () => {
      const schema = contribution.starterContract('typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@internal/postgres/contract-builder'");
      expect(schema).toContain('username: field.column(type.String()).optional()');
      expect(schema).toContain('id: field.column(type.Uuid()).id().onCreate(gen.uuid(7))');
      expect(schema).toContain('authorId: field.column(type.Uuid())');
      expect(schema).not.toContain('type.Char(');
      expect(schema).toContain('updatedAt: field.column(type.temporal.UpdatedAt())');
      expect(schema).not.toMatch(/field\.(id|temporal)\.|field\.(text|uuidString)\(/);
    });

    it('writes no field preset into the PSL starter schema', () => {
      expect(contribution.starterContract('psl')).toContain('updatedAt temporal.UpdatedAt\n');
    });

    it('only imports from the facade package for TypeScript', () => {
      const schema = contribution.starterContract('typescript');

      const specifiers = [
        ...schema.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g),
      ].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier).toMatch(/^@internal\/postgres(\/.+)?$/);
      }
    });

    it('uses the callback-factory defineContract signature, requiring the newest PostgreSQL version’s and the driver’s capabilities', () => {
      const schema = contribution.starterContract('typescript');

      expect(POSTGRES_NEWEST_VERSION).toBe(18);
      expect(schema).toContain(
        "import { defineContract, now, postgres18, postgresDriver } from '@internal/postgres/contract-builder';",
      );
      expect(schema).toMatch(
        /defineContract\(\s*\{ requiredCapabilities: \[\.\.\.postgres18, \.\.\.postgresDriver\] \},\s*\(\{ field, model, rel(, gen)?, type \}\) => [({]/,
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

    it('references models by token, the form the framework recommends', () => {
      const schema = contribution.starterContract('typescript');

      // String refs here would make a fresh scaffold emit
      // PN_CONTRACT_TYPED_FALLBACK_AVAILABLE warnings on its first emit.
      expect(schema).toContain('rel.belongsTo(User');
      expect(schema).toContain('rel.hasMany(Post');
      expect(schema).not.toMatch(/rel\.\w+\('/);
      expect(schema).toMatch(/\.relations\(\{/);
    });
  });

  describe('databaseFile', () => {
    it('generates db.ts with lazy facade and DATABASE_URL binding', () => {
      const db = contribution.databaseFile();

      expect(db).toContain("import postgres from '@internal/postgres/runtime'");
      expect(db).toContain("import { contractFromJson } from '@internal/postgres/static'");
      expect(db).toContain('export const contract = contractFromJson<Contract>(contractJson);');
      expect(db).toContain('postgres({\n  contract,\n');
      expect(db).toContain("url: process.env['DATABASE_URL']!,");
      expect(db).not.toContain('await db.connect');
      const internalImports = db.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(internalImports).toHaveLength(2);
    });
  });

  describe('envExample', () => {
    it('states the connection string shape and the minimum server version', () => {
      expect(contribution.envExample()).toBe(
        '# Connection string for PostgreSQL.\n# Requires PostgreSQL >= 15.\n\nDATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n',
      );
    });
  });

  describe('quickReference', () => {
    it('contains file locations', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('src/prisma/contract.prisma');
      expect(md).toContain('src/prisma/contract.json');
      expect(md).toContain('src/prisma/db.ts');
      expect(md).toContain('prisma.config.ts');
    });

    it('contains postgres-specific content', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@internal/postgres');
      expect(md).toContain('postgresql://');
    });

    it('contains ORM query example', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('db.orm.public.User');
      expect(md).toContain('.where(');
      expect(md).toContain('.first()');
    });

    it('contains common commands', () => {
      const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
    });

    it('places the requirements it is given', () => {
      expect(quickReferenceFor('psl', 'src/prisma/contract.prisma')).toContain(REQUIREMENTS);
    });

    describe('schema sample (FR5.1)', () => {
      it('psl: shows a PSL `model { ... }` block', () => {
        const md = quickReferenceFor('psl', 'src/prisma/contract.prisma');

        expect(md).toContain('```prisma');
        expect(md).toContain('model User');
        expect(md).toContain('@id @default(autoincrement())');
        expect(md).not.toContain('defineContract');
      });

      it.each([
        ['psl', 'src/prisma/contract.prisma', 'number'],
        ['typescript', 'src/prisma/contract.ts', 'string'],
      ] as const)(
        '%s: names the id type its starter contract gives',
        (mode, schemaPath, idType) => {
          expect(quickReferenceFor(mode, schemaPath)).toContain(
            `// { id: ${idType}; email: string;`,
          );
        },
      );

      it('typescript: shows a TS `defineContract` block (no PSL)', () => {
        const md = quickReferenceFor('typescript', 'src/prisma/contract.ts');

        expect(md).toContain('```typescript');
        expect(md).toContain('defineContract');
        expect(md).toContain("from '@internal/postgres/contract-builder'");
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
      describe(`postgres + ${authoring}`, () => {
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
          'configImports',
          'contractEntry',
          'schemaSample',
          'idType',
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
          'runDbInit',
          'runDbUpdate',
          'runMigrationPlan',
          'runMigrate',
          'runDbSeed',
        ]),
      );
    });

    it('init-quick-reference-prisma7.md has the placeholders the Prisma 7 quick reference fills', () => {
      expect(placeholders('init-quick-reference-prisma7.md')).toEqual(
        new Set([
          'schemaPath',
          'outputDir',
          'dbImportPath',
          'pkgRun',
          'pkg',
          'configImports',
          'contractEntry',
          'requirements',
          'prisma7ConfigSentence',
          'prisma7ConfigRow',
        ]),
      );
    });
  });

  describe('minimalProjectReadmeMd', () => {
    it('leads with db:init before dev', () => {
      const md = readme({
        projectName: 'my-app',
        contractPath: 'prisma/contract.prisma',
        runScript: npmRun,
      });

      expect(md).toMatch(/## First run/);
      expect(md).toContain('npm run db:init');
      expect(md).toContain('npm run dev');
      expect(md.indexOf('npm run db:init')).toBeLessThan(md.indexOf('npm run dev'));
      expect(md).not.toContain('Run the migration and seed scripts first');
    });

    it('lists migration scripts under Available scripts, not First run', () => {
      const md = readme({
        projectName: 'my-app',
        contractPath: 'prisma/contract.prisma',
        runScript: npmRun,
      });
      const firstRunEnd = md.indexOf('## Available scripts');

      expect(firstRunEnd).toBeGreaterThan(-1);
      expect(md.slice(0, firstRunEnd)).not.toContain('migration:plan');
      expect(md).toContain('## Available scripts');
      expect(md).toContain('migration:plan');
    });

    describe('per-target snapshots', () => {
      it('postgres readme is stable', () => {
        expect(
          readme({
            projectName: 'my-app',
            contractPath: 'prisma/contract.prisma',
            runScript: pnpmRun,
          }),
        ).toMatchSnapshot();
      });
    });
  });
});
