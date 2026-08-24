import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitScaffoldedContract } from '../../src/orm/init-emit';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'init-emit-subprocess-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'scaffolded-app', private: true, type: 'module' }),
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/**
 * Installs a fake `prisma` package into the project's `node_modules`,
 * with a bin entry pointing at the given script — the shape the registry
 * package has, without the registry.
 */
function installFakePrismaCli(
  binSource: string,
  bin: string | Record<string, string> = { prisma: './bin/prisma.mjs' },
): void {
  const packageDir = join(projectDir, 'node_modules/prisma');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'prisma',
      version: '0.0.0-test',
      type: 'module',
      bin,
    }),
  );
  writeFileSync(join(packageDir, 'bin/prisma.mjs'), binSource);
}

async function emitFailure(): Promise<Error> {
  try {
    await emitScaffoldedContract({ cwd: projectDir });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('emitScaffoldedContract resolved, expected it to reject');
}

describe('emitScaffoldedContract', () => {
  it(
    'runs the project-local prisma bin with `contract emit` in the project directory',
    async () => {
      installFakePrismaCli(
        [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync('emit-invocation.json', JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));",
          '',
        ].join('\n'),
      );

      await emitScaffoldedContract({ cwd: projectDir });

      const invocation = JSON.parse(
        readFileSync(join(projectDir, 'emit-invocation.json'), 'utf-8'),
      ) as { argv: string[]; cwd: string };
      expect(invocation.argv).toEqual(['contract', 'emit']);
      expect(realpathSync(invocation.cwd)).toBe(realpathSync(projectDir));
    },
    timeouts.databaseOperation,
  );

  it(
    'throws the tail of the child stderr, redacted, when the child exits non-zero',
    async () => {
      const lines = Array.from({ length: 40 }, (_, i) => `line-${String(i).padStart(2, '0')}`);
      installFakePrismaCli(
        [
          `for (const line of ${JSON.stringify(lines)}) process.stderr.write(line + '\\n');`,
          "process.stderr.write('could not reach https://alice:hunter2@registry.example.com/\\n');",
          'process.exit(3);',
          '',
        ].join('\n'),
      );

      const error = await emitFailure();

      expect(error.message).toContain('line-39');
      expect(error.message).not.toContain('line-00');
      expect(error.message).toContain('***@registry.example.com');
      expect(error.message).not.toContain('hunter2');
      expect(error.message).toContain('3');
    },
    timeouts.databaseOperation,
  );

  it(
    'falls back to the child stdout when stderr carried nothing',
    async () => {
      installFakePrismaCli(
        [
          "process.stdout.write('emit blew up, reported on stdout\\n');",
          'process.exit(1);',
          '',
        ].join('\n'),
      );

      const error = await emitFailure();

      expect(error.message).toContain('emit blew up, reported on stdout');
    },
    timeouts.databaseOperation,
  );

  it(
    'accepts a string-form bin field',
    async () => {
      installFakePrismaCli(
        [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync('emit-invocation.json', JSON.stringify({ argv: process.argv.slice(2) }));",
          '',
        ].join('\n'),
        './bin/prisma.mjs',
      );

      await emitScaffoldedContract({ cwd: projectDir });

      const invocation = JSON.parse(
        readFileSync(join(projectDir, 'emit-invocation.json'), 'utf-8'),
      ) as { argv: string[] };
      expect(invocation.argv).toEqual(['contract', 'emit']);
    },
    timeouts.databaseOperation,
  );

  it(
    'names the signal when the child is killed instead of exiting',
    async () => {
      installFakePrismaCli("process.kill(process.pid, 'SIGKILL');\n");

      const error = await emitFailure();

      expect(error.message).toContain('SIGKILL');
    },
    timeouts.databaseOperation,
  );

  it(
    'names the manifest path when the installed manifest is not valid JSON',
    async () => {
      // Real resolution already rejects a corrupt package.json ("Invalid
      // package config"), so the parse branch is reached via the seam, which
      // hands back the corrupt manifest path directly.
      const manifestPath = join(projectDir, 'package.json');
      writeFileSync(manifestPath, '{ not json');

      const error = await emitScaffoldedContract(
        { cwd: projectDir },
        { resolveFromBaseDir: () => manifestPath },
      ).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(manifestPath);
      expect((error as Error).message).toMatch(/not valid JSON/);
    },
    timeouts.databaseOperation,
  );

  it(
    'reports that prisma is not installed when resolution fails',
    async () => {
      // vitest wraps `createRequire` and resolves the workspace prisma package
      // package from any directory, so a genuinely missing install cannot be
      // produced with real resolution here — the seam stands in for the
      // MODULE_NOT_FOUND a real Node process raises.
      const error = await emitScaffoldedContract(
        { cwd: projectDir },
        {
          resolveFromBaseDir: () => {
            throw new Error("Cannot find module 'prisma/package.json'");
          },
        },
      ).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/`prisma` is not installed/);
      expect(message).toContain(projectDir);
      expect(message).toContain("Cannot find module 'prisma/package.json'");
    },
    timeouts.databaseOperation,
  );

  it(
    'reports an installed prisma that declares no bin',
    async () => {
      const packageDir = join(projectDir, 'node_modules/prisma');
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({ name: 'prisma', version: '0.0.0-test' }),
      );

      const error = await emitFailure();

      expect(error.message).toMatch(/declares no `prisma` bin/);
    },
    timeouts.databaseOperation,
  );
});
