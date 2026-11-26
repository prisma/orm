import { describe, expect, it } from 'vitest';
import type { ContractEntryExpression } from '../../../src/commands/init/init-contribution';
import {
  configFile,
  defaultContractEntry,
} from '../../../src/commands/init/templates/code-templates';
import { requirementsBlock } from '../../../src/commands/init/templates/quick-reference';

const CONFIG_MODULES = {
  postgres: '@internal/postgres/config',
  mongo: '@internal/mongo/config',
} as const;

function defaultConfig(configModule: string, contractPath: string): string {
  return configFile({
    configModule,
    contract: defaultContractEntry(configModule, {
      kind: 'starter',
      mode: contractPath.endsWith('.ts') ? 'typescript' : 'psl',
      path: contractPath,
    }),
    output: undefined,
  });
}

function configFor(target: keyof typeof CONFIG_MODULES, contractPath: string): string {
  return defaultConfig(CONFIG_MODULES[target], contractPath);
}

describe('templates', () => {
  describe('module names in the generated configs', () => {
    it('writes a module name with a quote or a backslash as a valid string literal', () => {
      for (const source of [
        defaultConfig("acme-db/config'v8", './prisma/contract.prisma'),
        configFile({
          configModule: "acme-db/config'v8",
          contract: defaultContractEntry("acme-db/config'v8", {
            kind: 'prisma7-schema',
            path: 'prisma/schema.prisma',
          }),
          output: 'src/prisma',
        }),
      ]) {
        expect(source).toContain("from 'acme-db/config\\'v8';");
      }
    });
  });

  describe('configFile', () => {
    it('generates a config with dotenv and a single import from the config module', () => {
      const config = configFor('postgres', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@internal/postgres/config'");
      expect(config).toContain('contract: "./prisma/contract.prisma"');
      const importLines = config.split('\n').filter((l) => l.includes("from '@internal/"));
      expect(importLines).toHaveLength(1);
    });

    it('writes a value entry as a literal and adds no import', () => {
      const contract: ContractEntryExpression = {
        value: { path: './prisma/contract.acme', level: 3, tags: ['a'], strict: true },
      };

      expect(configFile({ configModule: 'acme-db/config', contract, output: undefined })).toBe(
        [
          "import 'dotenv/config';",
          "import { definePrismaConfig } from '@prisma/cli-engine';",
          "import { defineConfig as ormConfig } from 'acme-db/config';",
          '',
          'export default definePrismaConfig({',
          '  orm: ormConfig({',
          '    contract: { path: "./prisma/contract.acme", level: 3, tags: ["a"], strict: true },',
          '    db: {',
          "      connection: process.env['DATABASE_URL']!,",
          '    },',
          '  }),',
          '});',
          '',
        ].join('\n'),
      );
    });

    it('writes a call entry and merges its import with its own', () => {
      const sameModule: ContractEntryExpression = {
        call: {
          moduleSpecifier: 'acme-db/config',
          symbol: 'acmeContract',
          args: ['./prisma/contract.acme', { level: 3 }],
        },
      };
      const otherModule: ContractEntryExpression = {
        call: { moduleSpecifier: 'acme-db/levels', symbol: 'levelled', args: [] },
      };

      expect(
        configFile({ configModule: 'acme-db/config', contract: sameModule, output: 'src/acme' }),
      ).toBe(
        [
          "import 'dotenv/config';",
          "import { definePrismaConfig } from '@prisma/cli-engine';",
          "import { acmeContract, defineConfig as ormConfig } from 'acme-db/config';",
          '',
          'export default definePrismaConfig({',
          '  orm: ormConfig({',
          '    contract: acmeContract("./prisma/contract.acme", { level: 3 }),',
          '    output: "src/acme",',
          '    db: {',
          "      connection: process.env['DATABASE_URL']!,",
          '    },',
          '  }),',
          '});',
          '',
        ].join('\n'),
      );
      const other = configFile({
        configModule: 'acme-db/config',
        contract: otherModule,
        output: undefined,
      });
      expect(other).toContain(
        "import { defineConfig as ormConfig } from 'acme-db/config';\nimport { levelled } from 'acme-db/levels';\n",
      );
      expect(other).toContain('    contract: levelled(),\n');
    });
  });

  describe('requirementsBlock (FR8.2)', () => {
    it('states the minimum server version and the command that checks it', () => {
      expect(
        requirementsBlock(
          'Example DB',
          { minVersion: '15', checkCommand: 'SELECT version()' },
          'pnpm prisma',
          true,
        ),
      ).toBe(
        [
          '## Requirements',
          '',
          '- **Example DB 15 or newer.** Older servers are not supported. Run `SELECT version()` against your server to verify.',
          '- The CLI never connects to your database without explicit consent. Pass `--probe-db` to `pnpm prisma orm init` if you want `init` to verify the server version itself.',
        ].join('\n'),
      );
    });

    it('leaves out the --probe-db advice when the target package has no probe', () => {
      expect(
        requirementsBlock(
          'Example DB',
          { minVersion: '15', checkCommand: 'SELECT version()' },
          'pnpm prisma',
          false,
        ),
      ).toBe(
        [
          '## Requirements',
          '',
          '- **Example DB 15 or newer.** Older servers are not supported. Run `SELECT version()` against your server to verify.',
        ].join('\n'),
      );
    });

    it('is empty when the target package states no requirement', () => {
      expect(requirementsBlock('Example DB', undefined, 'pnpm prisma', true)).toBe('');
    });
  });

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

        it('configFile is stable', () => {
          expect(configFor(target, `./${schemaPath}`)).toMatchSnapshot();
        });
      });
    }
  });
});
