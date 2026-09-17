import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPrisma7Project } from '../../src/commands/init/prisma7-detect';
import { createTestProjectDir } from '../utils/test-project-dir';

const POSTGRES_SCHEMA = `
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id String @id
}
`;

const MONGO_SCHEMA = `
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
`;

const PRISMA_8_CONFIG = 'export default { $prismaConfig: 1, orm: {} };\n';

function prisma7Config(schema: string | number | undefined): string {
  const field = schema === undefined ? '' : `schema: ${JSON.stringify(schema)}, `;
  return `export default { ${field}migrations: { path: 'prisma/migrations' } };\n`;
}

let projectDir: string;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-detect');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function writeManifest(manifest: Record<string, unknown>): void {
  writeProjectFile('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeInstalledPackage(name: string, version: string): void {
  writeProjectFile(
    join('node_modules', name, 'package.json'),
    `${JSON.stringify({ name, version })}\n`,
  );
}

function detect(schemaPath?: string) {
  return detectPrisma7Project({ cwd: projectDir, schemaPath });
}

describe('detectPrisma7Project', () => {
  it('finds nothing in an empty directory and names the default schema path', async () => {
    await expect(detect()).resolves.toEqual({
      config: { kind: 'none' },
      schema: { kind: 'absent', path: 'prisma/schema.prisma' },
      schemaPathSource: 'default',
      cli: { kind: 'none' },
      warnings: [],
    });
  });

  describe('schema path', () => {
    it('reads the provider from the schema at the default path', async () => {
      writeProjectFile('prisma/schema.prisma', POSTGRES_SCHEMA);

      const detection = await detect();

      expect(detection.schema).toEqual({
        kind: 'datasource',
        path: 'prisma/schema.prisma',
        provider: 'postgresql',
      });
      expect(detection.schemaPathSource).toBe('default');
    });

    it(
      'prefers an explicit path over the Prisma 7 config schema field',
      async () => {
        writeProjectFile('prisma.config.ts', prisma7Config('db/schema.prisma'));
        writeProjectFile('db/schema.prisma', MONGO_SCHEMA);
        writeProjectFile('custom/schema.prisma', POSTGRES_SCHEMA);

        const detection = await detect('custom/schema.prisma');

        expect(detection.schema).toEqual({
          kind: 'datasource',
          path: 'custom/schema.prisma',
          provider: 'postgresql',
        });
        expect(detection.schemaPathSource).toBe('flag');
      },
      timeouts.coldTransformImport,
    );

    it(
      'reads the schema field of the Prisma 7 config when no path is given',
      async () => {
        writeProjectFile('prisma.config.ts', prisma7Config('db/schema.prisma'));
        writeProjectFile('db/schema.prisma', MONGO_SCHEMA);
        writeProjectFile('prisma/schema.prisma', POSTGRES_SCHEMA);

        const detection = await detect();

        expect(detection.schema).toEqual({
          kind: 'datasource',
          path: 'db/schema.prisma',
          provider: 'mongodb',
        });
        expect(detection.schemaPathSource).toBe('config');
      },
      timeouts.coldTransformImport,
    );

    it(
      'falls back to the default path when the Prisma 7 config has no string schema field',
      async () => {
        writeProjectFile('prisma.config.ts', prisma7Config(42));
        writeProjectFile('prisma/schema.prisma', POSTGRES_SCHEMA);

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'prisma7',
          path: 'prisma.config.ts',
          schema: undefined,
        });
        expect(detection.schema).toMatchObject({ path: 'prisma/schema.prisma' });
        expect(detection.schemaPathSource).toBe('default');
      },
      timeouts.coldTransformImport,
    );

    it('finds the datasource block across the files of a schema directory', async () => {
      writeProjectFile('prisma/schema/models/user.prisma', 'model User {\n  id String @id\n}\n');
      writeProjectFile(
        'prisma/schema/base.prisma',
        'datasource db {\n  provider = "postgresql"\n}\n',
      );
      writeProjectFile('prisma/schema/notes.txt', 'datasource db {\n  provider = "mongodb"\n}\n');

      const detection = await detect('prisma/schema');

      expect(detection.schema).toEqual({
        kind: 'datasource',
        path: 'prisma/schema',
        provider: 'postgresql',
      });
    });

    it('reports a schema file without a datasource block', async () => {
      writeProjectFile('prisma/schema.prisma', 'model User {\n  id String @id\n}\n');

      const detection = await detect();

      expect(detection.schema).toEqual({ kind: 'no-datasource', path: 'prisma/schema.prisma' });
    });

    it('ignores a datasource block that is commented out', async () => {
      writeProjectFile(
        'prisma/schema.prisma',
        '// datasource db {\n//   provider = "postgresql"\n// }\nmodel User {\n  id String @id\n}\n',
      );

      const detection = await detect();

      expect(detection.schema).toEqual({ kind: 'no-datasource', path: 'prisma/schema.prisma' });
    });

    it('reports a datasource block whose provider is not a string literal', async () => {
      writeProjectFile('prisma/schema.prisma', 'datasource db {\n  url = env("DATABASE_URL")\n}\n');

      const detection = await detect();

      expect(detection.schema).toEqual({
        kind: 'datasource',
        path: 'prisma/schema.prisma',
        provider: undefined,
      });
    });

    it('reports an explicit path that does not exist', async () => {
      const detection = await detect('missing/schema.prisma');

      expect(detection.schema).toEqual({ kind: 'absent', path: 'missing/schema.prisma' });
      expect(detection.schemaPathSource).toBe('flag');
    });
  });

  describe('Prisma 7 config discovery', () => {
    it(
      'recognises a config with the $prismaConfig marker as Prisma 8, not Prisma 7',
      async () => {
        writeProjectFile('prisma.config.ts', PRISMA_8_CONFIG);

        const detection = await detect();

        expect(detection.config).toEqual({ kind: 'prisma8', path: 'prisma.config.ts' });
        expect(detection.warnings).toEqual([]);
      },
      timeouts.coldTransformImport,
    );

    it(
      'carries an evaluation failure as a warning and keeps the default schema path',
      async () => {
        writeProjectFile('prisma.config.ts', "throw new Error('config module exploded');\n");
        writeProjectFile('prisma/schema.prisma', POSTGRES_SCHEMA);

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'unreadable',
          path: 'prisma.config.ts',
          why: expect.stringContaining('config module exploded'),
          prisma7ConfigPath: undefined,
        });
        expect(detection.schema).toMatchObject({ kind: 'datasource', provider: 'postgresql' });
        expect(detection.schemaPathSource).toBe('default');
        expect(detection.warnings).toEqual([
          expect.stringContaining('prisma.config.ts could not be evaluated'),
        ]);
      },
      timeouts.coldTransformImport,
    );

    it(
      'carries an unresolvable config import as a warning',
      async () => {
        writeProjectFile(
          'prisma.config.ts',
          // Not `prisma/config`: the workspace's pnpm store hoists a Prisma 7 for the
          // examples, and the loader's resolver falls back to it.
          "import { defineConfig } from 'a-package-that-is-not-installed/config';\nexport default defineConfig({ schema: 'prisma/schema.prisma' });\n",
        );

        const detection = await detect();

        expect(detection.config).toMatchObject({ kind: 'unreadable', path: 'prisma.config.ts' });
        expect(detection.warnings).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );

    it(
      'names the prisma7.config.* beside an unreadable prisma.config.ts',
      async () => {
        writeProjectFile('prisma.config.ts', "throw new Error('config module exploded');\n");
        writeProjectFile('prisma7.config.mts', prisma7Config('db/schema.prisma'));

        const detection = await detect();

        expect(detection.config).toMatchObject({
          kind: 'unreadable',
          path: 'prisma.config.ts',
          prisma7ConfigPath: 'prisma7.config.mts',
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'reads the schema field of a prisma7.config.* beside an unreadable prisma.config.ts',
      async () => {
        writeProjectFile('prisma.config.ts', "throw new Error('config module exploded');\n");
        writeProjectFile('prisma7.config.ts', prisma7Config('db/schema.prisma'));
        writeProjectFile('db/schema.prisma', POSTGRES_SCHEMA);
        writeProjectFile('prisma/schema.prisma', MONGO_SCHEMA);

        const detection = await detect();

        expect(detection).toMatchObject({
          config: {
            kind: 'unreadable',
            path: 'prisma.config.ts',
            prisma7ConfigPath: 'prisma7.config.ts',
            schema: 'db/schema.prisma',
          },
          schema: { kind: 'datasource', path: 'db/schema.prisma', provider: 'postgresql' },
          schemaPathSource: 'config',
          warnings: [expect.stringContaining('prisma.config.ts could not be evaluated')],
        });
        expect(detection.warnings[0]).not.toContain('default schema path');
      },
      timeouts.coldTransformImport,
    );

    it(
      'accepts prisma7.config.* alone as the Prisma 7 config',
      async () => {
        writeProjectFile('prisma7.config.ts', prisma7Config('db/schema.prisma'));

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'prisma7',
          path: 'prisma7.config.ts',
          schema: 'db/schema.prisma',
        });
        expect(detection.schema).toMatchObject({ path: 'db/schema.prisma' });
        expect(detection.schemaPathSource).toBe('config');
      },
      timeouts.coldTransformImport,
    );

    it(
      'reads prisma7.config.* beside a Prisma 8 prisma.config.ts',
      async () => {
        writeProjectFile('prisma.config.ts', PRISMA_8_CONFIG);
        writeProjectFile('prisma7.config.ts', prisma7Config('db/schema.prisma'));

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'prisma7',
          path: 'prisma7.config.ts',
          schema: 'db/schema.prisma',
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'reports a Prisma 7 prisma.config.ts beside a prisma7.config.* as a collision',
      async () => {
        writeProjectFile('prisma.config.ts', prisma7Config('prisma/schema.prisma'));
        writeProjectFile('prisma7.config.mts', prisma7Config('db/schema.prisma'));

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'collision',
          prismaConfigPath: 'prisma.config.ts',
          prisma7ConfigPath: 'prisma7.config.mts',
        });
        expect(detection.schemaPathSource).toBe('default');
        expect(detection.warnings).toEqual([expect.stringContaining('prisma7.config.mts')]);
      },
      timeouts.coldTransformImport,
    );

    it.each([
      ['an array', 'export default [];\n'],
      ['null', 'export default null;\n'],
      ['a string', "export default 'prisma/schema.prisma';\n"],
      ['absent', "export const schema = 'db/schema.prisma';\n"],
    ])(
      'does not label a module whose default export is %s as a Prisma 7 config',
      async (_label, source) => {
        writeProjectFile('prisma.config.ts', source);

        const detection = await detect();

        expect(detection.config).toMatchObject({ kind: 'unreadable', path: 'prisma.config.ts' });
        expect(detection.warnings).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );

    it(
      'ignores a prisma7.config.* that carries the $prismaConfig marker',
      async () => {
        writeProjectFile('prisma7.config.ts', PRISMA_8_CONFIG);

        const detection = await detect();

        expect(detection.config).toEqual({ kind: 'none' });
        expect(detection.warnings).toEqual([]);
      },
      timeouts.coldTransformImport,
    );

    it(
      'discovers the config under every supported extension',
      async () => {
        writeProjectFile('prisma.config.mjs', prisma7Config('db/schema.prisma'));

        const detection = await detect();

        expect(detection.config).toEqual({
          kind: 'prisma7',
          path: 'prisma.config.mjs',
          schema: 'db/schema.prisma',
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('Prisma 7 CLI', () => {
    it('reads a declared prisma range below 8 from devDependencies', async () => {
      writeManifest({
        name: 'app',
        devDependencies: { prisma: '^7.3.0' },
        dependencies: { '@prisma/client': '^7.3.0' },
      });

      const detection = await detect();

      expect(detection.cli).toEqual({
        kind: 'earlier',
        version: '^7.3.0',
        major: 7,
        source: 'declared',
        clientVersion: '^7.3.0',
      });
    });

    it('reads a declared prisma range below 8 from dependencies', async () => {
      writeManifest({ name: 'app', dependencies: { prisma: '~6.2.0' } });

      const detection = await detect();

      expect(detection.cli).toEqual({
        kind: 'earlier',
        version: '~6.2.0',
        major: 6,
        source: 'declared',
        clientVersion: undefined,
      });
    });

    it('prefers the installed version under node_modules over the declared range', async () => {
      writeManifest({
        name: 'app',
        devDependencies: { prisma: '^7' },
        dependencies: { '@prisma/client': '^7' },
      });
      writeInstalledPackage('prisma', '7.4.1');
      writeInstalledPackage('@prisma/client', '7.4.1');

      const detection = await detect();

      expect(detection.cli).toEqual({
        kind: 'earlier',
        version: '7.4.1',
        major: 7,
        source: 'installed',
        clientVersion: '7.4.1',
      });
    });

    it('reports nothing when the installed prisma is already 8 despite a declared 7 range', async () => {
      writeManifest({ name: 'app', devDependencies: { prisma: '^7' } });
      writeInstalledPackage('prisma', '8.0.0-rc.11');

      const detection = await detect();

      expect(detection.cli).toEqual({ kind: 'none' });
    });

    it('reports nothing for prisma at major 8 or above', async () => {
      writeManifest({ name: 'app', devDependencies: { prisma: '8.0.0-rc.11' } });

      await expect(detect()).resolves.toMatchObject({ cli: { kind: 'none' } });
    });

    it('reports nothing for a range whose major cannot be read', async () => {
      writeManifest({ name: 'app', devDependencies: { prisma: 'latest' } });

      await expect(detect()).resolves.toMatchObject({ cli: { kind: 'none' } });
    });

    it('reports nothing when package.json is missing or unreadable', async () => {
      await expect(detect()).resolves.toMatchObject({ cli: { kind: 'none' } });

      writeProjectFile('package.json', '{ not json');

      await expect(detect()).resolves.toMatchObject({ cli: { kind: 'none' } });
    });

    it('reports a declared @prisma/prisma7 as the side-by-side setup already done', async () => {
      writeManifest({
        name: 'app',
        devDependencies: { prisma: '^7.3.0', '@prisma/prisma7': '^7.10.0' },
      });

      await expect(detect()).resolves.toMatchObject({ cli: { kind: 'side-by-side' } });
    });
  });
});
