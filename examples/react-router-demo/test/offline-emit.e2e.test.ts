import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const exampleDir = dirname(dirname(fileURLToPath(import.meta.url)));
// The workspace root links the local prisma bin; the example itself
// names no @internal/* package (lint:consumer-internal-imports).
const prismaBin = join(exampleDir, 'node_modules', '.bin', 'prisma');
const contractJsonPath = join(exampleDir, 'src', 'prisma', 'contract.json');
const contractDtsPath = join(exampleDir, 'src', 'prisma', 'contract.d.ts');

// Locks in AC9: `prisma contract emit` must succeed when DATABASE_URL is
// unset, so a fresh checkout / CI typegen step does not need a database. The
// example's `prisma.config.ts` was specifically modified (commit
// `6d11148af`) to keep `db.connection` undefined when DATABASE_URL is missing
// rather than throwing at config-load time. Without this test, a future
// regression of that path would only surface as a CI failure outside this
// example.
describe('react-router-demo offline emit (e2e)', () => {
  let contractJsonBaseline: Buffer | null = null;
  let contractDtsBaseline: Buffer | null = null;

  beforeEach(async () => {
    contractJsonBaseline = await readFile(contractJsonPath);
    contractDtsBaseline = await readFile(contractDtsPath);
  });

  afterEach(async () => {
    // The emit writes both artifacts with the same byte content as the
    // committed baselines (the schema is unchanged), so this restore is
    // belt-and-braces — but it guarantees AC10's working-tree-clean invariant
    // even if a future change to the emitter's serialization (timestamps,
    // hash format, …) makes the rewrite non-idempotent.
    if (contractJsonBaseline !== null) {
      await writeFile(contractJsonPath, contractJsonBaseline);
      contractJsonBaseline = null;
    }
    if (contractDtsBaseline !== null) {
      await writeFile(contractDtsPath, contractDtsBaseline);
      contractDtsBaseline = null;
    }
  });

  it('emits contract artifacts with no DATABASE_URL set', async () => {
    expect(existsSync(prismaBin)).toBe(true);

    // Strip DATABASE_URL (and any sibling PG* vars libpq would silently honour
    // as a fallback) from the child env. Vitest forwards process.env to the
    // child by default; passing an explicit env without these guarantees the
    // emit is exercising the no-connection path.
    const baseEnv = { ...process.env };
    delete baseEnv['DATABASE_URL'];
    delete baseEnv['PGHOST'];
    delete baseEnv['PGPORT'];
    delete baseEnv['PGUSER'];
    delete baseEnv['PGPASSWORD'];
    delete baseEnv['PGDATABASE'];

    const { stdout, stderr } = await execFileAsync(prismaBin, ['contract', 'emit'], {
      cwd: exampleDir,
      env: baseEnv,
    });

    expect(stderr).toContain('Emitted contract.json and contract.d.ts');
    expect(stdout).toBe('src/prisma/contract.json\nsrc/prisma/contract.d.ts\n');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    // Sanity: the rewritten contract.json should be valid JSON with the
    // expected top-level shape.
    const reEmittedContract: unknown = JSON.parse(await readFile(contractJsonPath, 'utf-8'));
    expect(reEmittedContract).toMatchObject({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                user: { columns: { email: expect.anything() } },
              },
            },
          },
        },
      },
    });
  });
});
